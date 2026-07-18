<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type {
  BomSupplierOptionsType,
  BomSupplierResultType,
  BomSupplierViewType,
} from '@sp/api-contract';
import {
  useStartSupplierSearch,
  useSupplierPreflight,
  useSupplierSearchResult,
  useSupplierSearchStatus,
} from '../../admin/useAdminBom';

const props = defineProps<{
  jobId: string;
  initialSupplier: BomSupplierViewType;
}>();

const emit = defineEmits<{
  result: [result: BomSupplierResultType];
  showResults: [];
}>();

const jobId = ref(props.jobId);
const maxCalls = ref(700);
const cacheOnly = ref(false);
const resetCache = ref(false);
const supplierStarted = ref(props.initialSupplier.status !== null);
const error = ref('');

const preflight = useSupplierPreflight();
const startSupplier = useStartSupplierSearch();
const status = useSupplierSearchStatus(jobId, supplierStarted);
const supplierView = computed(() => status.data.value?.data ?? props.initialSupplier);
const supplierDone = computed(() => supplierView.value.status === 'completed');
const supplierResult = useSupplierSearchResult(jobId, supplierDone);
const plan = computed(() => preflight.data.value?.data ?? null);
const result = computed(() => supplierResult.data.value?.data ?? null);
const running = computed(() => supplierView.value.status === 'running');
const limitTooLow = computed(() => {
  const current = plan.value;
  return current !== null && current.plan.estimated_api_calls > maxCalls.value;
});

watch([maxCalls, cacheOnly, resetCache], () => {
  preflight.reset();
});

watch(result, (next) => {
  if (next !== null) emit('result', next);
}, { immediate: true });

watch(() => supplierResult.error.value, (reason) => {
  if (reason !== null) error.value = errorMessage(reason);
});

function options(): BomSupplierOptionsType {
  return {
    max_calls: maxCalls.value,
    cache_only: cacheOnly.value,
    reset_cache: resetCache.value,
  };
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ApiRequestError) return reason.message;
  return '공급사 검색 처리에 실패했습니다. 잠시 후 다시 시도하세요.';
}

async function runPreflight(): Promise<void> {
  error.value = '';
  try {
    await preflight.mutateAsync({ jobId: props.jobId, options: options() });
  } catch (reason) {
    error.value = errorMessage(reason);
  }
}

async function execute(): Promise<void> {
  if (plan.value === null || limitTooLow.value) return;
  error.value = '';
  try {
    await startSupplier.mutateAsync({ jobId: props.jobId, options: options() });
    supplierStarted.value = true;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
}

function formatMs(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}초`;
  }
  return `${Math.round(value).toLocaleString('ko-KR')}ms`;
}

function useCacheOnly(): void {
  if (cacheOnly.value) resetCache.value = false;
}

function useResetCache(): void {
  if (resetCache.value) cacheOnly.value = false;
}
</script>

<template>
  <section class="rounded-xl border border-blue-200 bg-white shadow-sm">
    <div class="flex flex-col gap-4 border-b border-blue-100 bg-blue-50/50 p-5 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <p class="text-xs font-bold tracking-[0.15em] text-blue-700">SUPPLIER VERIFICATION</p>
        <h2 class="mt-1 text-lg font-semibold text-gray-900">공급사 검색</h2>
        <p class="mt-1 text-sm text-gray-500">전체 BOM의 캐시·쿼터를 먼저 계산하고 검색 실행 시 바로 API를 호출합니다.</p>
      </div>
      <div v-if="result !== null" class="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-emerald-900">검색 완료</p>
          <p class="mt-0.5 text-xs text-emerald-700">API {{ result.summary.api_calls }}회 · 캐시 {{ result.summary.cache_hits }}건 · {{ formatMs(result.timing.search_elapsed_ms) }}</p>
        </div>
        <button type="button" class="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800" @click="emit('showResults')">결과 보기</button>
      </div>
    </div>

    <div class="space-y-4 p-5">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
        <label class="grid gap-1.5 text-sm font-medium text-gray-700">
          <span>최대 API 호출</span>
          <input v-model.number="maxCalls" type="number" min="1" max="1000" :disabled="running" class="h-10 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100">
        </label>
        <label class="inline-flex h-10 cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input v-model="cacheOnly" type="checkbox" :disabled="running || resetCache" class="h-4 w-4 rounded border-gray-300 text-blue-600" @change="useCacheOnly">
          캐시만 사용
        </label>
        <label class="inline-flex h-10 cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input v-model="resetCache" type="checkbox" :disabled="running || cacheOnly" class="h-4 w-4 rounded border-gray-300 text-blue-600" @change="useResetCache">
          캐시 초기화 후 검색
        </label>
        <div class="flex gap-2">
          <button type="button" class="h-10 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="preflight.isPending.value || running" @click="runPreflight">
            {{ preflight.isPending.value ? '계산 중…' : '사전점검' }}
          </button>
          <button type="button" class="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="plan === null || limitTooLow || startSupplier.isPending.value || running" @click="execute">
            {{ startSupplier.isPending.value ? '시작 중…' : '검색 실행' }}
          </button>
        </div>
      </div>

      <p v-if="resetCache" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">검색 실행 시 공급사 응답 캐시를 비웁니다. API 일일·분당 사용량 기록은 유지됩니다.</p>
      <p v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>

      <details v-if="plan !== null" class="rounded-lg border border-gray-200 bg-gray-50" open>
        <summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-800">사전점검 결과 · 대상 {{ plan.plan.component_count }}개 · 예상 API {{ plan.plan.estimated_api_calls }}회</summary>
        <div class="space-y-3 border-t border-gray-200 p-4">
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-lg border border-gray-200 bg-white p-3"><p class="text-xs text-gray-500">검색 대상</p><strong class="mt-1 block text-xl text-gray-900">{{ plan.plan.component_count.toLocaleString('ko-KR') }}</strong><p class="mt-1 text-xs text-gray-400">고유 질의 {{ plan.plan.unique_query_count }}</p></article>
            <article class="rounded-lg border border-gray-200 bg-white p-3"><p class="text-xs text-gray-500">예상 호출</p><strong class="mt-1 block text-xl text-gray-900">{{ plan.plan.estimated_api_calls.toLocaleString('ko-KR') }}</strong><p class="mt-1 text-xs text-gray-400">재시도 최악 {{ plan.plan.retry_worst_case_api_calls }}</p></article>
            <article class="rounded-lg border border-gray-200 bg-white p-3"><p class="text-xs text-gray-500">캐시</p><strong class="mt-1 block text-xl text-gray-900">{{ resetCache ? 0 : plan.plan.fresh_cache_requests }}</strong><p class="mt-1 text-xs text-gray-400">stale {{ plan.plan.stale_cache_requests }}</p></article>
            <article class="rounded-lg border border-gray-200 bg-white p-3"><p class="text-xs text-gray-500">사전점검 시간</p><strong class="mt-1 block text-xl text-gray-900">{{ formatMs(plan.preflight_elapsed_ms) }}</strong><p class="mt-1 text-xs text-gray-400">API 호출 없음</p></article>
          </div>

          <p v-if="limitTooLow" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">예상 호출 {{ plan.plan.estimated_api_calls }}회가 최대 호출 수보다 큽니다.</p>

          <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-gray-50 text-xs uppercase text-gray-500"><tr><th class="px-3 py-2">공급사</th><th class="px-3 py-2">예상 호출</th><th class="px-3 py-2">최악 호출</th><th class="px-3 py-2">일일 잔여</th><th class="px-3 py-2">분당 잔여</th></tr></thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="budget in plan.plan.supplier_budgets" :key="budget.supplier"><td class="px-3 py-2 font-medium text-gray-900">{{ budget.supplier }}</td><td class="px-3 py-2">{{ budget.estimated_calls }}</td><td class="px-3 py-2">{{ budget.retry_worst_case_calls }}</td><td class="px-3 py-2">{{ budget.daily_remaining ?? '제한 미설정' }}</td><td class="px-3 py-2">{{ budget.minute_remaining ?? '제한 미설정' }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <div v-if="supplierStarted && supplierView.status !== null && result === null" class="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div class="flex items-center justify-between gap-4"><div><p class="font-semibold text-gray-900">{{ supplierView.message }}</p><p v-if="supplierView.error" class="mt-1 text-sm text-red-700">{{ supplierView.error }}</p></div><span class="text-sm font-bold text-blue-700">{{ supplierView.progress }}%</span></div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"><div class="h-full bg-blue-600 transition-all" :style="{ width: `${supplierView.progress}%` }" /></div>
      </div>
    </div>
  </section>
</template>
