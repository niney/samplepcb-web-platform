<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ApiRequestError, apiGet, apiSend } from '@sp/shared';
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
const supplierSearch = computed(() => query.data.value?.supplierSearch ?? null);
const engineMaxCalls = computed(() => supplierSearch.value?.engine.maxCallsPerJob ?? null);
const maxCallsInvalid = computed(() => {
  const configured = form.value?.supplierSearchMaxCalls;
  return configured !== undefined
    && engineMaxCalls.value !== null
    && configured > engineMaxCalls.value;
});
const effectiveMaxCalls = computed(() => {
  const configured = form.value?.supplierSearchMaxCalls;
  if (configured === undefined || engineMaxCalls.value === null) return null;
  return Math.min(configured, engineMaxCalls.value);
});

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
  onError: (reason: unknown) => {
    error.value = reason instanceof ApiRequestError ? reason.message : '저장에 실패했습니다.';
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
  if (form.value === null || maxCallsInvalid.value) return;
  error.value = '';
  // 환율 빈 입력 → null(미환산 표시)
  const rate = form.value.usdKrwRate;
  save.mutate({ ...form.value, usdKrwRate: rate === null || Number.isNaN(rate) || rate <= 0 ? null : rate });
}

function supplierLabel(value: string): string {
  return ({ digikey: 'DigiKey', mouser: 'Mouser', unikeyic: 'UniKeyIC' } as Record<string, string>)[value] ?? value;
}

function formatDuration(value: number | null): string {
  if (value === null) return '—';
  if (value >= 60_000) return `${(value / 60_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}분`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
  return `${Math.round(value).toLocaleString('ko-KR')}ms`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function runStatusLabel(value: string): string {
  return ({ preparing: '준비', running: '검색 중', completed: '완료', failed: '실패' } as Record<string, string>)[value] ?? value;
}
</script>

<template>
  <p v-if="query.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
  <form v-else-if="form !== null" class="max-w-5xl space-y-4" @submit.prevent="submit">
    <section class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div class="mb-4">
        <h2 class="font-semibold text-gray-900">견적 비용 기본값</h2>
        <p class="mt-1 text-sm text-gray-500">고객 화면에는 예상 금액으로 표시되며 확정가는 관리자 검토에서 결정합니다.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block text-sm"><span class="text-gray-600">기본 운송료(원)</span><input v-model.number="form.defaultShippingFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums"></label>
        <label class="block text-sm"><span class="text-gray-600">기본 관리비(원)</span><input v-model.number="form.defaultManagementFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums"></label>
      </div>
    </section>

    <section class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div class="mb-4"><h2 class="font-semibold text-gray-900">USD 환율</h2><p class="mt-1 text-sm text-gray-500">자동 고시 환율과 장애 시 사용할 수동 폴백을 관리합니다.</p></div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label class="block text-sm"><span class="text-gray-600">적용 방식</span><select v-model="form.usdKrwRateMode" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"><option value="auto">수출입은행 자동 환율</option><option value="manual">관리자 수동 환율</option></select></label>
        <label class="block text-sm"><span class="text-gray-600">수동 환율 / 장애 폴백(원)</span><input v-model.number="form.usdKrwRate" type="number" min="0" step="0.01" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums" placeholder="예: 1400"></label>
        <label class="block text-sm"><span class="text-gray-600">자동 환율 기준</span><select v-model="form.usdKrwAutoRateType" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100"><option value="dealBasR">매매기준율</option><option value="tts">송금 보낼 때(TTS)</option></select></label>
        <label class="block text-sm"><span class="text-gray-600">안전계수(%)</span><input v-model.number="form.usdKrwSafetyMarginPercent" type="number" min="0" max="20" step="0.1" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums disabled:bg-gray-100"></label>
        <label class="block text-sm"><span class="text-gray-600">최대 경과일</span><input v-model.number="form.usdKrwMaxAgeDays" type="number" min="1" max="30" :disabled="form.usdKrwRateMode !== 'auto'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums disabled:bg-gray-100"></label>
      </div>
      <div v-if="exchangeRate !== null" class="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
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
    </section>

    <section class="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="font-semibold text-gray-900">공급사 검색 운영</h2><p class="mt-1 text-sm text-gray-500">업무 한도와 엔진 안전 상한, 실제 검색 사용량을 함께 확인합니다.</p></div>
        <span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="supplierSearch?.engine.available ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'">{{ supplierSearch?.engine.available ? '엔진 연결됨' : '엔진 연결 실패' }}</span>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <article class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><p class="text-xs text-slate-500">관리자 설정</p><strong class="mt-0.5 block text-lg tabular-nums">{{ form.supplierSearchMaxCalls.toLocaleString('ko-KR') }}회</strong></article>
        <article class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><p class="text-xs text-slate-500">엔진 안전 상한</p><strong class="mt-0.5 block text-lg tabular-nums">{{ engineMaxCalls?.toLocaleString('ko-KR') ?? '확인 불가' }}<template v-if="engineMaxCalls !== null">회</template></strong></article>
        <article class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5"><p class="text-xs text-blue-600">실제 적용 한도</p><strong class="mt-0.5 block text-lg text-blue-800 tabular-nums">{{ effectiveMaxCalls?.toLocaleString('ko-KR') ?? '확인 불가' }}<template v-if="effectiveMaxCalls !== null">회</template></strong></article>
        <article class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><p class="text-xs text-slate-500">오늘 검색</p><strong class="mt-0.5 block text-lg tabular-nums">{{ supplierSearch?.todayUsage.totalSearches.toLocaleString('ko-KR') ?? 0 }}회</strong><p class="text-[11px] text-slate-400">회원 {{ supplierSearch?.todayUsage.memberCount ?? 0 }}명 · 최대 {{ supplierSearch?.todayUsage.maxMemberSearches ?? 0 }}/{{ form.memberDailySearchLimit }}</p></article>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-3">
        <label class="block text-sm"><span class="text-gray-600">검색 1회 최대 API 호출</span><input v-model.number="form.supplierSearchMaxCalls" type="number" min="1" :max="engineMaxCalls ?? 1000" class="mt-1 w-full rounded-md border px-3 py-2 text-right tabular-nums" :class="maxCallsInvalid ? 'border-red-400 bg-red-50' : 'border-gray-300'"><small class="mt-1 block text-gray-400">예상치는 경고, 실제 호출은 이 값에서 제한</small></label>
        <label class="block text-sm"><span class="text-gray-600">회원별 일일 검색 한도</span><input v-model.number="form.memberDailySearchLimit" type="number" min="1" max="1000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums"><small class="mt-1 block text-gray-400">KST 자정 기준·DB 영속</small></label>
        <label class="block text-sm"><span class="text-gray-600">데이터 신선 임계(시간)</span><input v-model.number="form.freshnessHours" type="number" min="1" max="720" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums"><small class="mt-1 block text-gray-400">초과 시 업로드 때 자동 보강</small></label>
      </div>
      <p v-if="maxCallsInvalid" class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">현재 엔진 안전 상한 {{ engineMaxCalls }}회를 넘을 수 없습니다.</p>

      <div v-if="supplierSearch !== null" class="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
        <span v-for="supplier in supplierSearch.engine.suppliers" :key="supplier.supplier" class="rounded-full border px-2.5 py-1 font-medium" :class="supplier.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'">{{ supplierLabel(supplier.supplier) }} {{ supplier.configured ? '연결' : '키 없음' }}</span>
        <span v-if="supplierSearch.engine.cache !== null" class="ml-auto text-slate-500">캐시 {{ supplierSearch.engine.cache.mode === 'normal' ? '일반' : '전용' }} · {{ supplierSearch.engine.cache.entryCount.toLocaleString('ko-KR') }}건 · 키워드 TTL {{ Math.round(supplierSearch.engine.cache.keywordTtlSeconds / 3600) }}시간</span>
        <span v-else class="ml-auto text-red-600">{{ supplierSearch.engine.error }}</span>
      </div>

      <details v-if="supplierSearch !== null" class="mt-4 rounded-lg border border-slate-200">
        <summary class="cursor-pointer px-3 py-2.5 text-sm font-semibold text-slate-700">최근 검색 실행 {{ supplierSearch.recentRuns.length }}건</summary>
        <div class="overflow-x-auto border-t border-slate-200">
          <table class="min-w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500"><tr><th class="px-3 py-2">시각/견적</th><th class="px-3 py-2">대상</th><th class="px-3 py-2">예상→실제</th><th class="px-3 py-2">한도/캐시</th><th class="px-3 py-2">소요</th><th class="px-3 py-2">결과</th></tr></thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="run in supplierSearch.recentRuns" :key="run.id">
                <td class="px-3 py-2"><p class="font-medium text-slate-800">#{{ run.quoteId }} {{ run.quoteTitle }}</p><p class="text-[11px] text-slate-400">{{ formatDate(run.createdAt) }} · {{ run.memberId }}</p></td>
                <td class="px-3 py-2 tabular-nums">{{ run.componentCount ?? '—' }}행</td>
                <td class="px-3 py-2 tabular-nums">{{ run.estimatedApiCalls ?? '—' }} → <strong>{{ run.actualApiCalls ?? '—' }}</strong></td>
                <td class="px-3 py-2 tabular-nums">{{ run.maxCalls ?? '—' }}회 / 캐시 {{ run.cacheHits ?? '—' }}</td>
                <td class="px-3 py-2 tabular-nums">{{ formatDuration(run.elapsedMs) }}</td>
                <td class="px-3 py-2"><span class="font-medium" :class="run.status === 'completed' ? 'text-emerald-700' : run.status === 'failed' ? 'text-red-700' : 'text-blue-700'">{{ runStatusLabel(run.status) }}</span><p v-if="run.budgetExhaustedCount" class="text-[11px] text-amber-700">한도 소진 {{ run.budgetExhaustedCount }}행</p><p v-if="run.error" class="max-w-48 truncate text-[11px] text-red-500" :title="run.error">{{ run.error }}</p></td>
              </tr>
              <tr v-if="supplierSearch.recentRuns.length === 0"><td colspan="6" class="px-3 py-6 text-center text-slate-400">검색 실행 이력이 없습니다.</td></tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <div class="sticky bottom-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      <button type="submit" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" :disabled="save.isPending.value || maxCallsInvalid">
        {{ save.isPending.value ? '저장 중…' : '저장' }}
      </button>
      <span v-if="saved" class="text-sm text-emerald-600">저장되었습니다.</span>
      <span v-if="error !== ''" class="text-sm text-red-600">{{ error }}</span>
    </div>
  </form>
</template>
