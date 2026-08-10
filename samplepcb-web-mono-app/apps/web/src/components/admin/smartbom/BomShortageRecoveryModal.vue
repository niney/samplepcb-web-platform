<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PO_SHORTAGE_REASON_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  type AdminBomPoViewType,
  type BomPoItemViewType,
} from '@sp/api-contract';
import {
  useAdminBomShortageCandidates,
  useRecoverBomShortage,
} from '../../../admin/useAdminBomPos';

const props = defineProps<{
  open: boolean;
  quoteId: string;
  po: AdminBomPoViewType | null;
  item: BomPoItemViewType | null;
}>();
const emit = defineEmits<{ close: []; recovered: [] }>();

const queryQuoteId = computed(() => (props.open && props.quoteId !== '' ? props.quoteId : null));
const queryShortageId = computed(() =>
  props.open ? (props.item?.shortage?.shortageId ?? null) : null,
);
const candidatesQuery = useAdminBomShortageCandidates(queryQuoteId, queryShortageId);
const candidates = computed(() => candidatesQuery.data.value?.data.candidates ?? []);
const selectedRfqItemId = ref<number | null>(null);
const memo = ref('');
const error = ref('');
const recoverMut = useRecoverBomShortage();

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
    error.value =
      cause instanceof ApiRequestError ? cause.message : '잔량 대체발주를 생성하지 못했습니다.';
  }
}

const fmt = (value: number): string => value.toLocaleString('ko-KR');
const shipmentLabel = (mode: 'domestic' | 'international' | null): string =>
  mode === null
    ? '발송 방식 결정 불가'
    : `${BOM_SHIPMENT_MODE_LABELS[mode]} · ${mode === 'domestic' ? '3단계' : '6단계'}`;
</script>

<template>
  <div
    v-if="open && po !== null && item !== null && item.shortage !== null"
    class="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bom-shortage-recovery-title"
    @click.self="close"
  >
    <form class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" @submit.prevent="submit">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 id="bom-shortage-recovery-title" class="text-lg font-bold">잔량 대체발주</h2>
          <p class="mt-0.5 text-xs text-gray-500">원 PO #{{ po.poId }} · {{ po.partnerName }}</p>
        </div>
        <button type="button" class="text-gray-400 hover:text-gray-700" aria-label="잔량 대체발주 닫기" @click="close">✕</button>
      </div>

      <div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p class="font-bold">
          {{ item.mpn || '품번 미기재' }} · {{ BOM_PO_SHORTAGE_REASON_LABELS[item.shortage.reason] }}
        </p>
        <p class="mt-1">
          원 발주 {{ fmt(item.qty) }}개 중 공급 {{ fmt(item.shortage.suppliedQty) }}개 ·
          대체 필요 <b>{{ fmt(item.shortage.shortageQty) }}개</b>
        </p>
        <p v-if="item.shortage.note !== null" class="mt-1 text-xs text-red-700">협력사 메모 · {{ item.shortage.note }}</p>
      </div>

      <p class="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
        아래 회신 단가로 부족 수량만 새 PO를 발행합니다. 고객이 이미 확정·결제한 견적 금액과
        원 PO의 수량·금액은 변경하지 않습니다. 발주할 협력사를 직접 선택해 주세요.
      </p>

      <div class="mt-4">
        <p class="text-sm font-bold text-gray-800">대체 협력사 회신</p>
        <p v-if="candidatesQuery.isLoading.value" class="mt-3 text-sm text-gray-400">후보를 확인하는 중…</p>
        <div v-else-if="candidatesQuery.isError.value" class="mt-3 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <p class="font-semibold">대체 후보를 불러오지 못했습니다.</p>
          <button type="button" class="mt-2 rounded border border-red-300 px-2 py-1 text-xs font-bold hover:bg-red-100" @click="candidatesQuery.refetch()">다시 시도</button>
        </div>
        <p v-else-if="candidates.length === 0" class="mt-3 rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
          이 품목에 회신한 다른 협력사가 없습니다. RFQ 회신을 먼저 확보해 주세요.
        </p>
        <div v-else class="mt-2 grid gap-2">
          <label
            v-for="candidate in candidates"
            :key="candidate.rfqItemId"
            class="flex gap-3 rounded-xl border px-3 py-3 text-sm"
            :class="candidate.eligible
              ? selectedRfqItemId === candidate.rfqItemId
                ? 'cursor-pointer border-emerald-400 bg-emerald-50'
                : 'cursor-pointer border-gray-200 hover:border-emerald-300'
              : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-65'"
          >
            <input v-model="selectedRfqItemId" type="radio" :value="candidate.rfqItemId" :disabled="!candidate.eligible" class="mt-1 size-4">
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center justify-between gap-2">
                <b>{{ candidate.partnerName }}</b>
                <span class="font-bold tabular-nums">{{ fmt(candidate.unitPrice) }}원/개</span>
              </span>
              <span class="mt-1 block text-xs text-gray-600">
                재고 {{ candidate.stock === null ? '미확인' : `${fmt(candidate.stock)}개` }}
                <template v-if="candidate.leadTime !== null"> · 납기 {{ candidate.leadTime }}</template>
                <template v-if="candidate.dateCode !== null"> · Date code {{ candidate.dateCode }}</template>
              </span>
              <span class="mt-1 block text-xs font-semibold text-indigo-700">
                출발국 {{ candidate.partnerCountry ?? '미등록' }} · {{ shipmentLabel(candidate.shipmentMode) }}
                · 대체 발주 {{ fmt(candidate.unitPrice * item.shortage.shortageQty) }}원
              </span>
              <span v-if="candidate.ineligibleReason !== null" class="mt-1 block text-xs font-semibold text-red-600">{{ candidate.ineligibleReason }}</span>
            </span>
          </label>
        </div>
        <p
          v-if="candidates.some((candidate) => candidate.eligible) && selectedRfqItemId === null"
          class="mt-2 text-xs font-semibold text-amber-700"
        >
          발주할 협력사를 선택해야 대체발주 버튼이 활성화됩니다.
        </p>
      </div>

      <label class="mt-4 block text-sm font-medium text-gray-700">대체 발주 메모 (선택)
        <textarea v-model="memo" rows="3" maxlength="2000" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="납기 확인 요청 등 대체 협력사에 전달할 내용을 적어 주세요." />
      </label>
      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold hover:bg-gray-50" :disabled="recoverMut.isPending.value" @click="close">취소</button>
        <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40" :disabled="selectedRfqItemId === null || recoverMut.isPending.value">
          {{ recoverMut.isPending.value ? '발행 중…' : `부족 ${fmt(item.shortage.shortageQty)}개 대체발주` }}
        </button>
      </div>
    </form>
  </div>
</template>
