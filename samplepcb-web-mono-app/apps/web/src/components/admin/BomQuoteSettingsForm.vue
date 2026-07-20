<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  BomQuoteConfigResponse,
  BomQuoteExchangeRateRefreshResponse,
  apiRoutes,
  type BomQuoteConfigType,
} from '@sp/api-contract';

// 고객 BOM 견적 비용·검색 한도(sp_config bom_quote) — 레거시 하드코딩
// (운송료 30000·관리비 25000)의 관리자 설정 승격. 고객 화면엔 '예상' 라벨로 표시된다.

const path = `${apiRoutes.adminSettings}/bom-quote`;
const qc = useQueryClient();
const queryKey = ['admin', 'settings', 'bom-quote'] as const;
const query = useQuery({
  queryKey,
  queryFn: () => apiGet(path, BomQuoteConfigResponse),
  retry: false,
});

const form = ref<BomQuoteConfigType | null>(null);
const saved = ref(false);
const error = ref('');
const refreshMessage = ref('');
const exchangeRate = computed(() => query.data.value?.exchangeRate ?? null);

watch(
  () => query.data.value?.data,
  (d) => {
    if (d !== undefined && form.value === null) form.value = { ...d };
  },
  { immediate: true },
);

const save = useMutation({
  mutationFn: (body: BomQuoteConfigType) => apiSend('PUT', path, body, BomQuoteConfigResponse),
  onSuccess: (res) => {
    form.value = { ...res.data };
    saved.value = true;
    void qc.invalidateQueries({ queryKey });
    setTimeout(() => (saved.value = false), 2_000);
  },
  onError: () => {
    error.value = '저장에 실패했습니다.';
  },
});

const refreshRate = useMutation({
  mutationFn: () => apiSend('POST', `${path}/exchange-rate/refresh`, undefined, BomQuoteExchangeRateRefreshResponse),
  onSuccess: (res) => {
    qc.setQueryData(queryKey, res);
    refreshMessage.value = res.exchangeRate.lastRefreshError ?? '최신 고시 환율을 반영했습니다.';
  },
  onError: () => {
    refreshMessage.value = '환율 갱신 요청에 실패했습니다.';
  },
});

function submit(): void {
  if (form.value === null) return;
  error.value = '';
  // 환율 빈 입력 → null(미환산 표시)
  const rate = form.value.usdKrwRate;
  save.mutate({ ...form.value, usdKrwRate: rate === null || Number.isNaN(rate) || rate <= 0 ? null : rate });
}
</script>

<template>
  <p v-if="query.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
  <form v-else-if="form !== null" class="max-w-2xl space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" @submit.prevent="submit">
    <p class="text-sm text-gray-500">
      고객 스마트 BOM 견적의 예상 비용 기본값과 공급사 검색 한도입니다. 고객 화면에는 "예상 견적 — 확정 시 변동" 라벨로 표시되고, 확정가는 견적요청 검토에서 입력합니다.
    </p>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block text-sm">
        <span class="text-gray-600">기본 운송료(원)</span>
        <input v-model.number="form.defaultShippingFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">기본 관리비(원)</span>
        <input v-model.number="form.defaultManagementFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">USD 환율 적용 방식</span>
        <select v-model="form.usdKrwRateMode" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2">
          <option value="auto">수출입은행 자동 환율</option>
          <option value="manual">관리자 수동 환율</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">수동 환율 / 자동 장애 폴백(원)</span>
        <input v-model.number="form.usdKrwRate" type="number" min="0" step="0.01" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums" placeholder="예: 1400">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">자동 환율 기준</span>
        <select v-model="form.usdKrwAutoRateType" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100">
          <option value="dealBasR">매매기준율</option>
          <option value="tts">송금 보낼 때(TTS)</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">자동 환율 안전계수(%)</span>
        <input v-model.number="form.usdKrwSafetyMarginPercent" type="number" min="0" max="20" step="0.1" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums disabled:bg-gray-100">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">자동 환율 최대 경과일</span>
        <input v-model.number="form.usdKrwMaxAgeDays" type="number" min="1" max="30" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums disabled:bg-gray-100">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">검색 1회 최대 API 호출 (부품 1건당 약 3콜 — 100라인 ≈ 300)</span>
        <input v-model.number="form.supplierSearchMaxCalls" type="number" min="1" max="1000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">회원별 일일 검색 한도</span>
        <input v-model.number="form.memberDailySearchLimit" type="number" min="1" max="1000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">데이터 신선 임계(시간) — 초과 시 업로드 때 자동 보강</span>
        <input v-model.number="form.freshnessHours" type="number" min="1" max="720" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
    </div>
    <div v-if="exchangeRate !== null" class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="font-semibold text-slate-800">현재 실효 USD 환율</p>
          <p v-if="exchangeRate.effective !== null" class="mt-1 text-slate-600">
            1 USD = <strong class="text-slate-900">{{ exchangeRate.effective.appliedRate.toLocaleString('ko-KR') }}원</strong>
            · {{ exchangeRate.effective.source === 'koreaexim' ? '수출입은행' : '관리자 수동값' }}
            <template v-if="exchangeRate.effective.rateDate !== null"> · 기준 {{ exchangeRate.effective.rateDate }}</template>
          </p>
          <p v-else class="mt-1 text-amber-700">적용 가능한 환율이 없어 USD 오퍼는 합계에서 제외됩니다.</p>
          <p v-if="exchangeRate.effective?.fallbackReason === 'manual-rate'" class="mt-1 text-amber-700">자동 환율이 없거나 오래되어 수동 폴백값을 사용 중입니다.</p>
          <p v-else-if="exchangeRate.effective?.fallbackReason === 'stale-cache'" class="mt-1 text-amber-700">오래된 마지막 정상 환율을 사용 중입니다. 갱신 상태를 확인해 주세요.</p>
          <p v-if="exchangeRate.cache !== null" class="mt-1 text-xs text-slate-500">
            캐시: 매매기준 {{ exchangeRate.cache.dealBasR.toLocaleString('ko-KR') }}원 · TTS {{ exchangeRate.cache.tts.toLocaleString('ko-KR') }}원
          </p>
          <p v-if="!exchangeRate.apiConfigured" class="mt-1 text-xs text-amber-700">서버에 KOREAEXIM_API_KEY가 설정되지 않았습니다.</p>
        </div>
        <button type="button" class="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50" :disabled="refreshRate.isPending.value" @click="refreshRate.mutate()">
          {{ refreshRate.isPending.value ? '환율 조회 중…' : '지금 갱신' }}
        </button>
      </div>
      <p v-if="refreshMessage !== ''" class="mt-2 text-xs" :class="exchangeRate.lastRefreshError === null ? 'text-emerald-700' : 'text-red-600'">{{ refreshMessage }}</p>
    </div>
    <div class="flex items-center gap-3">
      <button type="submit" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" :disabled="save.isPending.value">
        {{ save.isPending.value ? '저장 중…' : '저장' }}
      </button>
      <span v-if="saved" class="text-sm text-emerald-600">저장되었습니다.</span>
      <span v-if="error !== ''" class="text-sm text-red-600">{{ error }}</span>
    </div>
  </form>
</template>
