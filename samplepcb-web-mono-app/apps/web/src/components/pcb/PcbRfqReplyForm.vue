<script setup lang="ts">
import { computed, ref } from 'vue';
import { PCB_CURRENCIES, type PcbCurrencyType, type PcbRfqReplyBodyType } from '@sp/api-contract';
import { kstDateInput } from '@sp/utils';
import { fmtPcbAmount } from '../../lib/pcb-money';

// PCB 견적 회신 폼 — 포털·매직링크·관리자 대리 입력 3곳 공용(저장 경로 단일 원칙).
// 금액은 "입력통화" 기준 원본으로 제출하고 환산·박제는 서버 몫(§5.2). 예상 배송일은
// 필수(레거시 승계 — 선정 판단 신호).

const props = withDefaults(
  defineProps<{
    /** 이 링크의 결제통화(행에 박제된 값). */
    settlementCurrency: string;
    /** 조직 입력통화 설정 — 결제통화와 다를 때만 토글 노출(null=토글 없음). */
    inputCurrencyOption?: string | null;
    initial?: {
      priceOriginal: number | null;
      subCurrency: string | null;
      subPriceOriginal: number | null;
      quotedDeliveryDate: string | null; // ISO
      memo: string | null;
    } | null;
    suggestedDeliveryDate?: string | null; // ISO — 미회신 시 기본값
    busy?: boolean;
    readOnly?: boolean;
  }>(),
  { inputCurrencyOption: null, initial: null, suggestedDeliveryDate: null, busy: false, readOnly: false },
);

const emit = defineEmits<{ submit: [body: PcbRfqReplyBodyType] }>();

const asCcy = (v: string | null | undefined): PcbCurrencyType | null =>
  v !== null && v !== undefined && (PCB_CURRENCIES as readonly string[]).includes(v)
    ? (v as PcbCurrencyType)
    : null;

const inputOption = computed(() => {
  const ccy = asCcy(props.inputCurrencyOption);
  return ccy !== null && ccy !== props.settlementCurrency ? ccy : null;
});

// 기존 회신이 입력통화 원본(sub_*)을 가지면 그 모드·값으로 복원.
const initialUsesInput = asCcy(props.initial?.subCurrency ?? null) !== null;
const useInputCurrency = ref(initialUsesInput);
const priceText = ref(
  initialUsesInput
    ? String(props.initial?.subPriceOriginal ?? '')
    : props.initial?.priceOriginal !== null && props.initial?.priceOriginal !== undefined
      ? String(props.initial.priceOriginal)
      : '',
);
// 날짜 입력 프리필·표시 모두 KST — UTC 슬라이스는 납기를 하루 앞당긴다(kst-date.ts).
const dateOnly = kstDateInput;
const deliveryDate = ref(
  dateOnly(props.initial?.quotedDeliveryDate) !== ''
    ? dateOnly(props.initial?.quotedDeliveryDate)
    : dateOnly(props.suggestedDeliveryDate),
);
const memo = ref(props.initial?.memo ?? '');
const error = ref('');

const activeCurrency = computed(() =>
  useInputCurrency.value && inputOption.value !== null
    ? inputOption.value
    : props.settlementCurrency,
);

function submit(): void {
  error.value = '';
  const price = Number(priceText.value.replaceAll(',', ''));
  if (!Number.isFinite(price) || price <= 0) {
    error.value = '견적가를 입력해 주세요.';
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate.value)) {
    error.value = '예상 배송일을 선택해 주세요(필수).';
    return;
  }
  const inputCcy =
    useInputCurrency.value && inputOption.value !== null ? inputOption.value : undefined;
  emit('submit', {
    price,
    ...(inputCcy === undefined ? {} : { inputCurrency: inputCcy }),
    quotedDeliveryDate: deliveryDate.value,
    memo: memo.value.trim() === '' ? null : memo.value.trim(),
  });
}
</script>

<template>
  <div class="space-y-3">
    <!-- 통화 토글 — 입력통화 설정이 결제통화와 다를 때만(위안화 입력 관행) -->
    <div v-if="inputOption !== null" class="flex items-center gap-2 text-sm">
      <span class="text-gray-500">입력 통화</span>
      <div class="flex rounded-lg border border-gray-200 p-0.5 text-xs font-semibold">
        <button
          type="button"
          class="rounded-md px-2.5 py-1"
          :class="!useInputCurrency ? 'bg-blue-600 text-white' : 'text-gray-500'"
          :disabled="readOnly"
          @click="useInputCurrency = false"
        >
          {{ settlementCurrency }} (결제통화)
        </button>
        <button
          type="button"
          class="rounded-md px-2.5 py-1"
          :class="useInputCurrency ? 'bg-blue-600 text-white' : 'text-gray-500'"
          :disabled="readOnly"
          @click="useInputCurrency = true"
        >
          {{ inputOption }} 로 입력
        </button>
      </div>
      <span v-if="useInputCurrency" class="text-xs text-gray-400">
        제출 시 결제통화({{ settlementCurrency }})로 환산·박제됩니다
      </span>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="text-xs font-semibold text-gray-500">견적가 ({{ activeCurrency }}) *</span>
        <input
          v-model="priceText"
          type="text"
          inputmode="decimal"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          :placeholder="activeCurrency === 'KRW' ? '예) 1500000' : '예) 1080.50'"
          :disabled="readOnly || busy"
        >
      </label>
      <label class="block">
        <span class="text-xs font-semibold text-gray-500">
          예상 배송일 *
          <template v-if="suggestedDeliveryDate !== null && suggestedDeliveryDate !== ''">
            <span class="ml-1 font-normal text-gray-400">(요청: {{ dateOnly(suggestedDeliveryDate) }})</span>
          </template>
        </span>
        <input
          v-model="deliveryDate"
          type="date"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          :disabled="readOnly || busy"
        >
      </label>
    </div>

    <label class="block">
      <span class="text-xs font-semibold text-gray-500">메모</span>
      <textarea
        v-model="memo"
        rows="2"
        class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        placeholder="재질/납기 조건 등 참고 사항"
        :disabled="readOnly || busy"
      />
    </label>

    <p v-if="initial?.priceOriginal != null" class="text-xs text-gray-400">
      현재 회신: {{ fmtPcbAmount(settlementCurrency, initial.priceOriginal) }}
      <template v-if="initial.subCurrency !== null && initial.subPriceOriginal !== null">
        (입력 원본 {{ fmtPcbAmount(initial.subCurrency, initial.subPriceOriginal) }})
      </template>
    </p>

    <p v-if="error !== ''" class="text-sm font-semibold text-red-600">{{ error }}</p>

    <button
      v-if="!readOnly"
      type="button"
      class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
      :disabled="busy"
      @click="submit"
    >
      {{ busy ? '저장 중…' : '회신 저장' }}
    </button>
  </div>
</template>
