<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AcceptableValue } from 'reka-ui';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PO_SHORTAGE_REASON_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  type AdminBomPoViewType,
  type BomPoItemViewType,
} from '@sp/api-contract';
import { useAdminBomShortageCandidates, useRecoverBomShortage } from '@/admin/useAdminBomPos';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';

// 잔량 대체발주(D31) — 옛 components/admin/smartbom/BomShortageRecoveryModal.vue 의 짝(같은 props·emits).
// 협력사가 부족 공급한 품목의 부족분만, 다른 협력사 회신 단가로 새 PO 를 낸다. 고객 확정·결제 금액과
// 원 PO 의 수량·금액은 바꾸지 않는다. 발주할 협력사는 관리자가 직접 고른다(자동 선택 없음).
const props = defineProps<{
  open: boolean;
  quoteId: string;
  po: AdminBomPoViewType | null;
  item: BomPoItemViewType | null;
}>();
const emit = defineEmits<{ close: []; recovered: [] }>();

const queryQuoteId = computed(() => (props.open && props.quoteId !== '' ? props.quoteId : null));
const queryShortageId = computed(() => (props.open ? (props.item?.shortage?.shortageId ?? null) : null));
const candidatesQuery = useAdminBomShortageCandidates(queryQuoteId, queryShortageId);
const candidates = computed(() => candidatesQuery.data.value?.data.candidates ?? []);
const selectedRfqItemId = ref<number | null>(null);
const memo = ref('');
const error = ref('');
const recoverMut = useRecoverBomShortage();

const visible = computed(
  () => props.open && props.po !== null && props.item !== null && props.item.shortage !== null,
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selectedRfqItemId.value = null;
    memo.value = '';
    error.value = '';
  },
);
watch(
  candidates,
  (rows) => {
    if (rows.some((row) => row.rfqItemId === selectedRfqItemId.value && row.eligible)) return;
    selectedRfqItemId.value = null;
  },
  { immediate: true },
);

function close(): void {
  if (recoverMut.isPending.value) return;
  emit('close');
}

const onOpenChange = (open: boolean): void => {
  if (!open) close();
};

function onCandidateChange(value: AcceptableValue): void {
  const parsed = Number(value);
  selectedRfqItemId.value = Number.isInteger(parsed) ? parsed : null;
}

async function submit(): Promise<void> {
  const shortage = props.item?.shortage ?? null;
  if (shortage === null || selectedRfqItemId.value === null || props.quoteId === '') return;
  error.value = '';
  try {
    await recoverMut.mutateAsync({
      quoteId: props.quoteId,
      shortageId: shortage.shortageId,
      body: {
        rfqItemId: selectedRfqItemId.value,
        memo: memo.value.trim() === '' ? null : memo.value.trim(),
      },
    });
    emit('recovered');
    emit('close');
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '잔량 대체발주를 생성하지 못했습니다.';
  }
}

const fmt = (value: number): string => value.toLocaleString('ko-KR');
const shipmentLabel = (mode: 'domestic' | 'international' | null): string =>
  mode === null ? '발송 방식 결정 불가' : `${BOM_SHIPMENT_MODE_LABELS[mode]} · ${mode === 'domestic' ? '3단계' : '6단계'}`;
const candidateId = (rfqItemId: number): string => `next-shortage-candidate-${String(rfqItemId)}`;
</script>

<template>
  <Dialog :open="visible" @update:open="onOpenChange">
    <DialogContent v-if="po !== null && item !== null && item.shortage !== null" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>잔량 대체발주</DialogTitle>
        <DialogDescription>원 PO #{{ po.poId }} · {{ po.partnerName }}</DialogDescription>
      </DialogHeader>

      <DialogScrollBody>
        <form id="next-shortage-recovery-form" class="flex flex-col gap-4" @submit.prevent="submit">
          <Alert variant="destructive">
            <AlertTitle>{{ item.mpn || '품번 미기재' }} · {{ BOM_PO_SHORTAGE_REASON_LABELS[item.shortage.reason] }}</AlertTitle>
            <AlertDescription>
              <p>
                원 발주 {{ fmt(item.qty) }}개 중 공급 {{ fmt(item.shortage.suppliedQty) }}개 · 대체 필요
                <b>{{ fmt(item.shortage.shortageQty) }}개</b>
              </p>
              <p v-if="item.shortage.note !== null" class="text-xs">협력사 메모 · {{ item.shortage.note }}</p>
            </AlertDescription>
          </Alert>

          <Alert variant="info" size="sm">
            <AlertDescription>
              아래 회신 단가로 부족 수량만 새 PO를 발행합니다. 고객이 이미 확정·결제한 견적 금액과 원 PO의 수량·금액은
              변경하지 않습니다. 발주할 협력사를 직접 선택해 주세요.
            </AlertDescription>
          </Alert>

          <div class="flex flex-col gap-2">
            <p class="text-sm font-semibold">대체 협력사 회신</p>
            <p v-if="candidatesQuery.isLoading.value" class="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              후보를 확인하는 중…
            </p>
            <Alert v-else-if="candidatesQuery.isError.value" variant="destructive" size="sm">
              <AlertTitle>대체 후보를 불러오지 못했습니다.</AlertTitle>
              <AlertDescription>
                <Button variant="outline" size="xs" class="mt-1" @click="candidatesQuery.refetch()">다시 시도</Button>
              </AlertDescription>
            </Alert>
            <p v-else-if="candidates.length === 0" class="text-muted-foreground py-4 text-center text-sm">
              이 품목에 회신한 다른 협력사가 없습니다. RFQ 회신을 먼저 확보해 주세요.
            </p>
            <RadioGroup
              v-else
              :model-value="selectedRfqItemId === null ? null : String(selectedRfqItemId)"
              aria-label="대체 협력사 회신"
              @update:model-value="onCandidateChange"
            >
              <FieldLabel v-for="candidate in candidates" :key="candidate.rfqItemId" :for="candidateId(candidate.rfqItemId)">
                <Field orientation="horizontal" :data-disabled="!candidate.eligible ? 'true' : undefined">
                  <RadioGroupItem
                    :id="candidateId(candidate.rfqItemId)"
                    :value="String(candidate.rfqItemId)"
                    :disabled="!candidate.eligible"
                  />
                  <FieldContent>
                    <FieldTitle class="w-full">
                      <span class="flex w-full flex-wrap items-center justify-between gap-2">
                        <span>{{ candidate.partnerName }}</span>
                        <span class="tabular-nums">{{ fmt(candidate.unitPrice) }}원/개</span>
                      </span>
                    </FieldTitle>
                    <FieldDescription>
                      재고 {{ candidate.stock === null ? '미확인' : `${fmt(candidate.stock)}개` }}
                      <template v-if="candidate.leadTime !== null"> · 납기 {{ candidate.leadTime }}</template>
                      <template v-if="candidate.dateCode !== null"> · Date code {{ candidate.dateCode }}</template>
                    </FieldDescription>
                    <span class="text-info text-xs font-medium">
                      출발국 {{ candidate.partnerCountry ?? '미등록' }} · {{ shipmentLabel(candidate.shipmentMode) }} · 대체 발주
                      {{ fmt(candidate.unitPrice * item.shortage.shortageQty) }}원
                    </span>
                    <span v-if="candidate.ineligibleReason !== null" class="text-destructive text-xs font-medium">
                      {{ candidate.ineligibleReason }}
                    </span>
                  </FieldContent>
                </Field>
              </FieldLabel>
            </RadioGroup>
            <p
              v-if="candidates.some((candidate) => candidate.eligible) && selectedRfqItemId === null"
              class="text-warning text-xs font-medium"
            >
              발주할 협력사를 선택해야 대체발주 버튼이 활성화됩니다.
            </p>
          </div>

          <Field>
            <FieldLabel for="next-shortage-recovery-memo">대체 발주 메모 (선택)</FieldLabel>
            <Textarea
              id="next-shortage-recovery-memo"
              v-model="memo"
              rows="3"
              maxlength="2000"
              placeholder="납기 확인 요청 등 대체 협력사에 전달할 내용을 적어 주세요."
            />
          </Field>
          <Alert v-if="error !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </form>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" :disabled="recoverMut.isPending.value" @click="close">취소</Button>
        <Button type="submit" form="next-shortage-recovery-form" :disabled="selectedRfqItemId === null || recoverMut.isPending.value">
          {{ recoverMut.isPending.value ? '발행 중…' : `부족 ${fmt(item.shortage.shortageQty)}개 대체발주` }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
