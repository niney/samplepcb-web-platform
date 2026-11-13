<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_VAT_MODE_LABELS } from '@sp/api-contract';
import type { DevelopQuoteViewType } from '@sp/api-contract';
import { won } from '../../lib/format';

// 견적 금액 — panel = 견적 요약 장의 왼쪽 위(큰 합계 + 공급가 · 부가세), band = 산출 내역 표 마지막 장 아래의 합계 띠
// (일정 표 아래 합계 띠와 같은 자리 · 같은 모양). 값은 서버가 저장한 것을 그대로 적는다(화면이 다시 계산하지 않는다).
const props = withDefaults(defineProps<{ quote: DevelopQuoteViewType; variant?: 'panel' | 'band' }>(), { variant: 'panel' });
const vat = computed(() => DEVELOP_VAT_MODE_LABELS[props.quote.vatMode]);
</script>

<template>
  <div v-if="variant === 'band'" class="mt-[14px] flex flex-wrap items-end justify-end gap-x-[40px] gap-y-[10px]">
    <div class="shrink-0 text-right">
      <p class="text-[14px] leading-[1.4] text-tx-2">공급가</p>
      <p class="text-[20px] font-semibold leading-[1.3] tabular-nums">{{ won(quote.supplyAmount) }}</p>
    </div>
    <div class="shrink-0 text-right">
      <p class="text-[14px] leading-[1.4] text-tx-2">부가세 ({{ vat }})</p>
      <p class="text-[20px] font-semibold leading-[1.3] tabular-nums">{{ won(quote.vatAmount) }}</p>
    </div>
    <div class="shrink-0 text-right">
      <p class="text-[14px] leading-[1.4] text-tx-2">합계</p>
      <p class="text-[34px] font-bold leading-[1.15] tabular-nums text-brand-600">{{ won(quote.totalAmount) }}</p>
    </div>
  </div>

  <div v-else class="flex flex-wrap items-end gap-x-[36px] gap-y-[10px]">
    <div class="shrink-0">
      <p class="text-[14px] leading-[1.4] text-tx-2">견적 금액 (합계)</p>
      <p class="text-[38px] font-bold leading-[1.05] tabular-nums text-brand-600 sm:text-[46px]" data-deck="quote-total">{{ won(quote.totalAmount) }}</p>
    </div>
    <dl class="flex flex-wrap gap-x-[32px] gap-y-[6px] pb-[4px]">
      <div>
        <dt class="text-[14px] leading-[1.4] text-tx-2">공급가</dt>
        <dd class="text-[19px] font-semibold leading-[1.35] tabular-nums">{{ won(quote.supplyAmount) }}</dd>
      </div>
      <div>
        <dt class="text-[14px] leading-[1.4] text-tx-2">부가세 ({{ vat }})</dt>
        <dd class="text-[19px] font-semibold leading-[1.35] tabular-nums">{{ won(quote.vatAmount) }}</dd>
      </div>
    </dl>
  </div>
</template>
