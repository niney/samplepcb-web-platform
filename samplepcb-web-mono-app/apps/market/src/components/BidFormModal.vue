<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { MarketBidSubmitBodyType, MarketMyBidType } from '@sp/api-contract';
import { won } from '../lib/market-format';

const props = defineProps<{
  open: boolean;
  mode: 'create' | 'edit';
  initial: MarketMyBidType | null;
  feeRateBp: number;
  pending: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; submit: [body: MarketBidSubmitBodyType] }>();

const form = reactive({
  amount: '', // 입력은 문자열, 제출 시 정수화
  durationDays: '',
  warranty: '납품 후 90일',
  message: '',
});

watch(
  () => [props.open, props.initial] as const,
  () => {
    if (!props.open) return;
    if (props.initial !== null) {
      form.amount = String(props.initial.amount);
      form.durationDays = String(props.initial.durationDays);
      form.warranty = props.initial.warranty ?? '';
      form.message = props.initial.message;
    }
  },
  { immediate: true },
);

const amountNum = computed(() => {
  const n = Number(form.amount.replaceAll(',', ''));
  return Number.isInteger(n) && n > 0 ? n : null;
});
const daysNum = computed(() => {
  const n = Number(form.durationDays);
  return Number.isInteger(n) && n > 0 && n <= 3650 ? n : null;
});
// 전문가측 수수료 공제 후 실수령(참고 표시 — 계산 정본은 2차 정산에서 서버).
const payout = computed(() =>
  amountNum.value !== null
    ? amountNum.value - Math.round((amountNum.value * props.feeRateBp) / 10000)
    : null,
);
const valid = computed(
  () => amountNum.value !== null && daysNum.value !== null && form.message.trim().length >= 10,
);

function submit(): void {
  if (!valid.value || props.pending || amountNum.value === null || daysNum.value === null) return;
  const warranty = form.warranty.trim();
  emit('submit', {
    amount: amountNum.value,
    durationDays: daysNum.value,
    ...(warranty !== '' ? { warranty } : {}),
    message: form.message.trim(),
  });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <p class="font-mono text-[11px] tracking-widest text-tx-3">BLIND QUOTE</p>
      <h2 class="mt-1 text-lg font-extrabold text-tx-1">
        {{ mode === 'create' ? '블라인드 견적 제출' : '견적 수정 (재제출)' }}
      </h2>
      <p class="mt-1.5 text-xs text-tx-3">제출한 견적은 의뢰인만 볼 수 있습니다.</p>

      <div class="mt-4 grid gap-3">
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          견적 금액(원) <span class="text-red-500">*</span>
          <input
            v-model="form.amount"
            type="text"
            inputmode="numeric"
            placeholder="예: 4200000"
            class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
          >
          <span v-if="amountNum !== null" class="font-normal text-tx-3">
            {{ won(amountNum) }} · 수수료 {{ (feeRateBp / 100).toFixed(1) }}% 공제 후 실수령
            <b class="text-tx-1">{{ payout !== null ? won(payout) : '-' }}</b>
          </span>
        </label>
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          작업 기간(일) <span class="text-red-500">*</span>
          <input
            v-model="form.durationDays"
            type="number"
            min="1"
            placeholder="예: 38"
            class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
          >
        </label>
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          하자보수 <span class="font-normal text-tx-3">(선택)</span>
          <input
            v-model="form.warranty"
            type="text"
            class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
          >
        </label>
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          제안 메시지 <span class="text-red-500">*</span>
          <textarea
            v-model="form.message"
            rows="4"
            placeholder="접근 방식, 유사 경험, 산출물 범위를 적어주세요. (10자 이상)"
            class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
          />
        </label>
      </div>

      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
          @click="emit('close')"
        >
          닫기
        </button>
        <button
          type="button"
          class="rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
          :disabled="!valid || pending"
          @click="submit"
        >
          {{ pending ? '제출 중…' : mode === 'create' ? '견적 제출' : '재제출' }}
        </button>
      </div>
    </div>
  </div>
</template>
