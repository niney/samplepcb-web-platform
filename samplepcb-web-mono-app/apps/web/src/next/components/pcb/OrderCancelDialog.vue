<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CircleCheckIcon, ExternalLinkIcon, TriangleAlertIcon } from '@lucide/vue';
import { PCB_ORDER_CANCEL_BLOCK_LABELS } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useCancelPcbOrder, usePcbOrderCancelPreview } from '@/admin/useAdminPcbOrders';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';

// PCB 주문 취소 — 옛 PcbOrderCancelModal 의 짝(props·emits 동일: 주문·결제 목록과 Case 상세가 함께 쓴다).
// 서버 미리보기가 취소 가능 여부·범위(줄만 / 주문 전체)를 정하고, 화면은 그 판정을 보여 준 뒤
// 사유를 받아 실행한다. 결제가 끝났거나 협력 진행이 있으면 여기서 막고 갈 곳(영카트·Case)을 안내한다
// — 결제 승인 취소·환불을 확인하기 전에 로컬 주문 상태를 먼저 바꾸지 않는다.

const props = defineProps<{ specId: number }>();
const emit = defineEmits<{ close: []; done: []; openCase: [] }>();

const specIdRef = computed<number | null>(() => props.specId);
const previewQuery = usePcbOrderCancelPreview(specIdRef);
const preview = computed(() => previewQuery.data.value?.data ?? null);
const reason = ref('');
const validationError = ref('');
const cancelOrder = useCancelPcbOrder();

watch(reason, () => {
  validationError.value = '';
});

const actionError = computed(() => {
  const error = cancelOrder.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : '주문 취소에 실패했습니다.';
});

const previewError = computed(() => {
  const error = previewQuery.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : '취소 가능 여부를 확인하지 못했습니다.';
});

const showOpenCase = computed(
  () => preview.value !== null && !preview.value.cancelable && preview.value.blockReason === 'PARTNER_PROCESS_EXISTS',
);
const showYoungcart = computed(
  () =>
    preview.value !== null &&
    !preview.value.cancelable &&
    (preview.value.blockReason === 'PAYMENT_RECEIVED' || preview.value.blockReason === 'YOUNGCART_REQUIRED'),
);

async function submit(): Promise<void> {
  const value = reason.value.trim();
  if (value.length < 2) {
    validationError.value = '취소 사유를 2자 이상 입력해 주세요.';
    return;
  }
  validationError.value = '';
  try {
    await cancelOrder.mutateAsync({ specId: props.specId, reason: value });
  } catch {
    // mutation.error 를 본문에 표시한다. 버튼 이벤트의 Promise rejection 은 여기서 소비한다.
  }
}

function close(): void {
  if (cancelOrder.isPending.value) return;
  if (cancelOrder.isSuccess.value) emit('done');
  else emit('close');
}

const onOpenChange = (open: boolean): void => {
  if (!open) close();
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          <span class="text-destructive">PCB 주문 취소</span>
        </DialogTitle>
        <DialogDescription>영카트 주문행과 PCB 협력 진행 상태를 함께 확인합니다.</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <p
          v-if="previewQuery.isLoading.value"
          class="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
        >
          <Spinner />
          취소 가능 여부를 확인하고 있습니다…
        </p>
        <p
          v-else-if="previewError !== ''"
          class="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {{ previewError }}
        </p>
        <template v-else-if="preview !== null">
          <dl class="bg-muted/40 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 rounded-lg border px-3 py-3 text-sm">
            <dt class="text-muted-foreground">대상</dt>
            <dd class="font-medium">Q{{ preview.specId }} · {{ preview.projectName }}</dd>
            <dt class="text-muted-foreground">주문번호</dt>
            <dd class="text-muted-foreground font-mono text-xs leading-5">{{ preview.odId }}</dd>
            <dt class="text-muted-foreground">주문 / 항목</dt>
            <dd>{{ preview.odStatus }} / {{ preview.ctStatus }}</dd>
            <dt class="text-muted-foreground">결제</dt>
            <dd>
              {{ preview.settleCase || '—' }} · 수납
              <span class="tabular-nums">{{ fmtPcbAmount('KRW', preview.receiptPrice) }}</span>
            </dd>
          </dl>

          <template v-if="preview.cancelable && !cancelOrder.isSuccess.value">
            <div
              class="rounded-lg border px-3 py-2.5 text-sm"
              :class="
                preview.cancelsWholeOrder
                  ? 'border-destructive/30 bg-destructive-soft text-destructive'
                  : 'border-warning/30 bg-warning-soft text-warning'
              "
            >
              <p v-if="preview.cancelsWholeOrder" class="font-semibold">
                이 PCB가 마지막 활성 항목이어서 주문 전체가 취소됩니다.
              </p>
              <p v-else class="font-semibold">
                이 PCB 항목만 취소되며 다른 활성 항목 {{ preview.activeSiblingCount }}개는 유지됩니다.
              </p>
              <p class="mt-1 text-xs opacity-80">취소금액·미수금·세액과 재고는 영카트 규칙으로 다시 계산됩니다.</p>
            </div>

            <p
              v-if="preview.rfqCount > 0"
              class="border-warning/30 bg-warning-soft text-warning rounded-lg border px-3 py-2 text-xs"
            >
              협력사 견적 이력 {{ preview.rfqCount }}건은 감사 이력으로 유지되며, 취소 후 신규 발주는 차단됩니다.
            </p>

            <Field>
              <FieldLabel for="pcb-order-cancel-reason">
                취소 사유
                <span class="text-destructive">*</span>
              </FieldLabel>
              <Textarea
                id="pcb-order-cancel-reason"
                v-model="reason"
                rows="3"
                maxlength="500"
                placeholder="예: 고객 요청으로 결제 전 주문 취소"
              />
              <FieldDescription>관리자 주문 변경이력에 기록됩니다.</FieldDescription>
            </Field>
            <p v-if="validationError !== ''" class="text-destructive text-sm">{{ validationError }}</p>
            <p
              v-if="actionError !== ''"
              class="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border px-3 py-2 text-sm"
            >
              {{ actionError }}
            </p>
            <p class="text-muted-foreground text-xs leading-5">
              영카트 관리자 취소와 동일하게 고객 안내 메일은 자동 발송되지 않습니다.
            </p>
          </template>

          <div
            v-else-if="!preview.cancelable"
            class="border-warning/30 bg-warning-soft text-warning rounded-lg border px-3 py-3 text-sm"
          >
            <p class="flex items-start gap-1.5 font-semibold">
              <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
              {{
                preview.blockReason === null
                  ? '이 화면에서 취소할 수 없습니다.'
                  : PCB_ORDER_CANCEL_BLOCK_LABELS[preview.blockReason]
              }}
            </p>
            <p v-if="preview.poCount > 0" class="mt-1 text-xs">연결된 협력사 발주서 {{ preview.poCount }}건</p>
            <p class="mt-1 text-xs opacity-80">결제 승인 취소나 환불을 확인하기 전에 로컬 주문 상태를 먼저 변경하지 않습니다.</p>
          </div>

          <div v-else class="border-success/30 bg-success-soft text-success rounded-lg border px-3 py-3 text-sm">
            <p class="flex items-center gap-1.5 font-semibold">
              <CircleCheckIcon class="size-4 shrink-0" />
              주문 취소가 완료되었습니다.
            </p>
            <p class="mt-1 text-xs">
              {{
                cancelOrder.data.value?.data.orderCancelled === true
                  ? '주문 전체가 취소 상태로 이동했습니다.'
                  : '선택한 PCB 항목이 취소되었습니다.'
              }}
            </p>
          </div>
        </template>
      </div>

      <DialogFooter>
        <Button v-if="showOpenCase" variant="outline" @click="emit('openCase')">PCB Case 확인</Button>
        <Button v-if="showYoungcart && preview !== null" variant="outline" as-child>
          <a :href="preview.youngcartOrderUrl" target="_blank" rel="noopener noreferrer">
            영카트 주문관리에서 처리
            <ExternalLinkIcon />
          </a>
        </Button>
        <Button variant="outline" :disabled="cancelOrder.isPending.value" @click="close">
          {{ cancelOrder.isSuccess.value ? '확인' : '닫기' }}
        </Button>
        <Button
          v-if="preview?.cancelable === true && !cancelOrder.isSuccess.value"
          variant="destructive"
          :disabled="cancelOrder.isPending.value"
          @click="void submit()"
        >
          <Spinner v-if="cancelOrder.isPending.value" />
          {{ cancelOrder.isPending.value ? '취소 처리 중…' : 'PCB 주문 취소' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
