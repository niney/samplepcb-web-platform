<script setup lang="ts">
import type { BomQuoteExchangeRateStatusType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';

// 현재 실효 USD 환율 — 옛 BomQuoteSettingsForm 'USD 환율' 섹션 아래 회색 상자 그대로(적용 환율·출처·기준일 →
// 폴백 사유 → 캐시 → 키 미설정 경고, 우측 '지금 갱신'). 갱신 결과 문구는 부모가 갖고 내려준다.
const props = defineProps<{
  exchangeRate: BomQuoteExchangeRateStatusType;
  refreshing: boolean;
  refreshMessage: string;
}>();
const emit = defineEmits<{ refresh: [] }>();
</script>

<template>
  <Panel tone="muted" class="text-sm">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="font-semibold">현재 실효 USD 환율</p>
        <p v-if="props.exchangeRate.effective !== null" class="text-muted-foreground mt-1">
          1 USD =
          <strong class="text-foreground tabular-nums">
            {{ props.exchangeRate.effective.appliedRate.toLocaleString('ko-KR') }}원
          </strong>
          · {{ props.exchangeRate.effective.source === 'koreaexim' ? '수출입은행' : '관리자 수동값' }}
          <template v-if="props.exchangeRate.effective.rateDate !== null"> · 기준 {{ props.exchangeRate.effective.rateDate }}</template>
        </p>
        <p v-else class="text-warning mt-1">적용 가능한 환율이 없어 USD 구매 조건은 합계에서 제외됩니다.</p>
        <p v-if="props.exchangeRate.effective?.fallbackReason === 'manual-rate'" class="text-warning mt-1">
          자동 환율이 없거나 오래되어 수동 폴백값을 사용 중입니다.
        </p>
        <p v-else-if="props.exchangeRate.effective?.fallbackReason === 'stale-cache'" class="text-warning mt-1">
          오래된 마지막 정상 환율을 사용 중입니다. 갱신 상태를 확인해 주세요.
        </p>
        <p v-if="props.exchangeRate.cache !== null" class="text-muted-foreground mt-1 text-xs tabular-nums">
          캐시: 매매기준 {{ props.exchangeRate.cache.dealBasR.toLocaleString('ko-KR') }}원 · TTS
          {{ props.exchangeRate.cache.tts.toLocaleString('ko-KR') }}원
        </p>
        <p v-if="!props.exchangeRate.apiConfigured" class="text-warning mt-1 text-xs">
          서버에 KOREAEXIM_API_KEY가 설정되지 않았습니다.
        </p>
      </div>
      <Button type="button" variant="outline" :disabled="props.refreshing" @click="emit('refresh')">
        <Spinner v-if="props.refreshing" />
        {{ props.refreshing ? '환율 조회 중…' : '지금 갱신' }}
      </Button>
    </div>
    <p
      v-if="props.refreshMessage !== ''"
      class="mt-2 text-xs"
      :class="props.exchangeRate.lastRefreshError === null ? 'text-success' : 'text-destructive'"
    >
      {{ props.refreshMessage }}
    </p>
  </Panel>
</template>
