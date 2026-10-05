<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { PCB_CURRENCIES, type PcbCurrencyType, type PcbRfqReplyBodyType } from '@sp/api-contract';
import { kstDateInput } from '@sp/utils';
import { usePartnerI18n } from '@/partner/i18n';
import { fmtPcbAmount as originalFmtPcbAmount } from '@/lib/pcb-money';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';

// PCB 견적 회신 폼 — 옛 components/pcb/PcbRfqReplyForm.vue 의 짝(관리자 대리 입력용).
// 포털·매직링크는 옛 폼을 계속 쓴다. 저장 경로·검증은 같다: 금액은 "입력통화" 기준 원본으로
// 제출하고 환산·박제는 서버 몫(§5.2). 예상 배송일은 필수(레거시 승계 — 선정 판단 신호).
// 문구는 partner i18n 원문 키(pt)를 그대로 쓴다 — 키가 곧 원문이라 바꾸면 번역이 끊긴다.

const { pt, pm, enabled, locale } = usePartnerI18n();
const fmtPcbAmount = (currency: string, value: number | null): string =>
  enabled.value ? (value === null ? '—' : pm(value, currency)) : originalFmtPcbAmount(currency, value);

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
  useInputCurrency.value && inputOption.value !== null ? inputOption.value : props.settlementCurrency,
);

// 기존 회신 요약 — 결제통화 금액 + (있으면) 입력통화 원본. 옛 폼과 같은 두 문구를 이어 붙인다.
const currentReplyText = computed((): string | null => {
  const initial = props.initial;
  if (initial?.priceOriginal == null) return null;
  const main = pt('현재 회신: {value1}', { value1: fmtPcbAmount(props.settlementCurrency, initial.priceOriginal) });
  return initial.subCurrency !== null && initial.subPriceOriginal !== null
    ? main + pt('(입력 원본 {value1})', { value1: fmtPcbAmount(initial.subCurrency, initial.subPriceOriginal) })
    : main;
});

const fieldId = useId();
const priceId = `${fieldId}-price`;
const dateId = `${fieldId}-date`;
const memoId = `${fieldId}-memo`;

function submit(): void {
  error.value = '';
  const price = Number(priceText.value.replaceAll(',', ''));
  if (!Number.isFinite(price) || price <= 0) {
    error.value = pt('견적가를 입력해 주세요.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate.value)) {
    error.value = pt('예상 배송일을 선택해 주세요(필수).');
    return;
  }
  const inputCcy = useInputCurrency.value && inputOption.value !== null ? inputOption.value : undefined;
  emit('submit', {
    price,
    ...(inputCcy === undefined ? {} : { inputCurrency: inputCcy }),
    quotedDeliveryDate: deliveryDate.value,
    memo: memo.value.trim() === '' ? null : memo.value.trim(),
  });
}

// 언어가 바뀌면 일시 피드백만 지운다(입력값은 유지).
watch(locale, () => {
  error.value = '';
});
</script>

<template>
  <div class="space-y-4">
    <!-- 통화 토글 — 입력통화 설정이 결제통화와 다를 때만(위안화 입력 관행) -->
    <div v-if="inputOption !== null" class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-muted-foreground">{{ pt('입력 통화') }}</span>
      <ButtonGroup>
        <Button
          size="sm"
          :variant="!useInputCurrency ? 'default' : 'outline'"
          :aria-pressed="!useInputCurrency"
          :disabled="readOnly"
          @click="useInputCurrency = false"
        >
          {{ pt('{value1} (결제통화)', { value1: settlementCurrency }) }}
        </Button>
        <Button
          size="sm"
          :variant="useInputCurrency ? 'default' : 'outline'"
          :aria-pressed="useInputCurrency"
          :disabled="readOnly"
          @click="useInputCurrency = true"
        >
          {{ pt('{value1} 로 입력', { value1: inputOption }) }}
        </Button>
      </ButtonGroup>
      <span v-if="useInputCurrency" class="text-muted-foreground text-xs">
        {{ pt('제출 시 결제통화({value1})로 환산·박제됩니다', { value1: settlementCurrency }) }}
      </span>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel :for="priceId">{{ pt('견적가 ({value1}) *', { value1: activeCurrency }) }}</FieldLabel>
        <Input
          :id="priceId"
          :model-value="priceText"
          type="text"
          inputmode="decimal"
          :placeholder="activeCurrency === 'KRW' ? pt('예) 1500000') : pt('예) 1080.50')"
          :disabled="readOnly || busy"
          @update:model-value="(value: string | number) => (priceText = String(value))"
        />
      </Field>
      <Field>
        <FieldLabel :for="dateId">
          {{ pt('예상 배송일 *') }}
          <span v-if="suggestedDeliveryDate !== null && suggestedDeliveryDate !== ''" class="text-muted-foreground font-normal">
            {{ pt('(요청: {value1})', { value1: dateOnly(suggestedDeliveryDate) }) }}
          </span>
        </FieldLabel>
        <Input
          :id="dateId"
          :model-value="deliveryDate"
          type="date"
          :disabled="readOnly || busy"
          @update:model-value="(value: string | number) => (deliveryDate = String(value))"
        />
      </Field>
    </div>

    <Field>
      <FieldLabel :for="memoId">{{ pt('메모') }}</FieldLabel>
      <Textarea
        :id="memoId"
        :model-value="memo"
        rows="2"
        :placeholder="pt('재질/납기 조건 등 참고 사항')"
        :disabled="readOnly || busy"
        @update:model-value="(value: string | number) => (memo = String(value))"
      />
    </Field>

    <p v-if="currentReplyText !== null" class="text-muted-foreground text-xs tabular-nums">{{ currentReplyText }}</p>

    <p v-if="error !== ''" class="text-destructive text-sm font-medium" role="alert">{{ error }}</p>

    <Button v-if="!readOnly" :disabled="busy" @click="submit">
      {{ busy ? pt('저장 중…') : pt('회신 저장') }}
    </Button>
  </div>
</template>
