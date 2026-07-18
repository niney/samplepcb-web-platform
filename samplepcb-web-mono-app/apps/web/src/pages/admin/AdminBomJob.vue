<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import type {
  BomComponentType,
  BomSupplierResultType,
  BomSupplierSearchComponentType,
} from '@sp/api-contract';
import BomComponentsTable from '../../components/admin/BomComponentsTable.vue';
import BomEvidenceDrawer from '../../components/admin/BomEvidenceDrawer.vue';
import BomSummaryCards from '../../components/admin/BomSummaryCards.vue';
import BomSupplierDetailDrawer from '../../components/admin/BomSupplierDetailDrawer.vue';
import BomSupplierPanel from '../../components/admin/BomSupplierPanel.vue';
import BomSupplierResults from '../../components/admin/BomSupplierResults.vue';
import { useBomJob, useBomResult } from '../../admin/useAdminBom';

const route = useRoute();
const router = useRouter();
const jobId = computed(() => {
  const id = route.params.id;
  return typeof id === 'string' ? id : null;
});

const job = useBomJob(jobId);
const jobView = computed(() => job.data.value?.data ?? null);
const completed = computed(() => jobView.value?.status === 'completed');
const resultQuery = useBomResult(jobId, completed);
const result = computed(() => resultQuery.data.value?.data ?? null);
const resultLoadError = computed(() => {
  if (!resultQuery.isError.value) return null;
  const reason = resultQuery.error.value;
  if (reason instanceof ApiRequestError) return reason.message;
  return '추출 결과 형식을 확인하지 못했습니다. 엔진 상태를 확인한 뒤 다시 시도하세요.';
});
const selectedSheet = ref('');
const inspected = ref<BomComponentType | null>(null);
const activeResultTab = ref<'components' | 'suppliers'>('components');
const supplierResult = ref<BomSupplierResultType | null>(null);
const inspectedSupplier = ref<BomSupplierSearchComponentType | null>(null);

const supplierIssueCount = computed(() => {
  const counts = supplierResult.value?.summary.status_counts;
  if (counts === undefined) return 0;
  const accepted = new Set(['verified_exact', 'verified_variant', 'spec_compatible']);
  return Object.entries(counts).reduce(
    (total, [status, count]) => total + (accepted.has(status) ? 0 : count),
    0,
  );
});

watch(result, (next) => {
  if (next !== null && (selectedSheet.value === '' || !next.sheets.some((sheet) => sheet.sheet_name === selectedSheet.value))) {
    selectedSheet.value = next.sheets[0]?.sheet_name ?? '';
  }
}, { immediate: true });

function statusLabel(value: 'running' | 'completed' | 'failed'): string {
  if (value === 'running') return '분석 중';
  if (value === 'completed') return '완료';
  return '실패';
}

function formatMs(value: number | undefined): string {
  if (value === undefined) return '측정 없음';
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}초`;
  return `${Math.round(value).toLocaleString('ko-KR')}ms`;
}

function failureReason(reason: string | null | undefined): string {
  if (reason === 'header_not_found') return '헤더를 찾지 못했습니다.';
  return reason ?? '분석 대상에서 제외되었습니다.';
}

function receiveSupplierResult(next: BomSupplierResultType): void {
  supplierResult.value = next;
}

function showSupplierResults(): void {
  activeResultTab.value = 'suppliers';
}
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6">
    <button type="button" class="text-sm font-medium text-gray-500 hover:text-gray-900" @click="router.push({ name: 'admin-bom' })">← 새 BOM 분석</button>

    <div v-if="job.isError.value" class="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
      <h1 class="font-semibold">분석 작업을 찾을 수 없습니다.</h1>
      <p class="mt-2 text-sm">엔진이 재시작됐거나 보관 기간이 끝난 임시 작업일 수 있습니다. 새 BOM을 업로드해 다시 분석하세요.</p>
    </div>

    <template v-else-if="jobView !== null">
      <header class="flex flex-col gap-4 border-b border-gray-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span class="font-mono text-xs font-semibold text-blue-700">{{ jobView.job_id.slice(0, 8) }}</span>
            <span
              class="rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="{
                'bg-blue-100 text-blue-800': jobView.status === 'running',
                'bg-emerald-100 text-emerald-800': jobView.status === 'completed',
                'bg-red-100 text-red-800': jobView.status === 'failed',
              }"
            >{{ statusLabel(jobView.status) }}</span>
          </div>
          <h1 class="mt-3 break-words text-2xl font-semibold tracking-tight text-gray-900">{{ jobView.filename }}</h1>
          <p class="mt-2 text-sm text-gray-500">SMARTBOM · {{ result?.parser_version ?? '규칙 엔진' }}<template v-if="result !== null"> · {{ formatMs(result.summary.processing_ms) }} · 외부 LLM 전송 없음</template></p>
        </div>
        <button type="button" class="self-start rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 lg:self-auto" @click="router.push({ name: 'admin-bom' })">다른 BOM 분석</button>
      </header>

      <section v-if="jobView.status === 'running'" class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-live="polite">
        <div class="flex items-start justify-between gap-4"><div><p class="text-xs font-bold tracking-[0.15em] text-blue-700">LIVE ANALYSIS</p><h2 class="mt-2 font-semibold text-gray-900">{{ jobView.message }}</h2><p class="mt-1 text-sm text-gray-500">파일 읽기, 헤더 탐지, 구조화 결과 생성을 순서대로 진행합니다.</p></div><strong class="text-xl text-blue-700">{{ jobView.progress }}%</strong></div>
        <div class="mt-5 h-2 overflow-hidden rounded-full bg-gray-100"><div class="h-full bg-blue-600 transition-all" :style="{ width: `${jobView.progress}%` }" /></div>
        <ol class="mt-5 grid gap-2 text-sm sm:grid-cols-3"><li class="rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">1. 파일 읽기</li><li class="rounded-lg px-3 py-2" :class="jobView.progress >= 55 ? 'bg-emerald-50 font-medium text-emerald-800' : 'bg-gray-50 text-gray-500'">2. 헤더·부품 분석</li><li class="rounded-lg px-3 py-2" :class="jobView.progress >= 90 ? 'bg-emerald-50 font-medium text-emerald-800' : 'bg-gray-50 text-gray-500'">3. 결과 생성</li></ol>
      </section>

      <section v-else-if="jobView.status === 'failed'" class="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
        <h2 class="font-semibold">BOM 분석에 실패했습니다.</h2>
        <p class="mt-2 break-words text-sm">{{ jobView.error ?? '알 수 없는 오류가 발생했습니다.' }}</p>
      </section>

      <template v-else-if="result !== null">
        <BomSummaryCards :summary="result.summary" :sheets="result.sheets" />

        <BomSupplierPanel
          :job-id="jobView.job_id"
          :initial-supplier="jobView.supplier_search"
          @result="receiveSupplierResult"
          @show-results="showSupplierResults"
        />

        <section class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="flex border-b border-gray-200" role="tablist" aria-label="BOM 결과 구분">
            <button
              type="button"
              role="tab"
              :aria-selected="activeResultTab === 'components'"
              class="flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-4 py-4 text-sm font-semibold transition"
              :class="activeResultTab === 'components' ? 'border-blue-600 bg-blue-50/50 text-blue-800' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'"
              @click="activeResultTab = 'components'"
            >
              <span>추출 컴포넌트</span>
              <span class="rounded-full bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200">{{ result.components.length.toLocaleString('ko-KR') }}</span>
              <span v-if="(result.summary.review_component_count ?? 0) > 0" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">검토 {{ result.summary.review_component_count }}</span>
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeResultTab === 'suppliers'"
              class="flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-4 py-4 text-sm font-semibold transition"
              :class="activeResultTab === 'suppliers' ? 'border-emerald-600 bg-emerald-50/50 text-emerald-800' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'"
              @click="activeResultTab = 'suppliers'"
            >
              <span>공급사 결과</span>
              <span class="rounded-full bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200">{{ supplierResult?.summary.component_count ?? 0 }}</span>
              <span v-if="supplierIssueCount > 0" class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">확인 {{ supplierIssueCount }}</span>
            </button>
          </div>
        </section>

        <template v-if="activeResultTab === 'components'">
          <section class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 class="font-semibold text-gray-900">시트</h2><p class="mt-1 text-sm text-gray-500">분석할 컴포넌트 범위를 선택하세요.</p></div><span class="text-sm text-gray-400">헤더 매핑 {{ result.headers.length }}개</span></div>
            <div class="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Excel 시트">
              <button v-for="sheet in result.sheets" :key="sheet.sheet_name" type="button" role="tab" :aria-selected="selectedSheet === sheet.sheet_name" class="min-w-[168px] rounded-lg border px-3 py-2 text-left transition" :class="selectedSheet === sheet.sheet_name ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'" @click="selectedSheet = sheet.sheet_name"><span class="block truncate text-sm font-semibold text-gray-800">{{ sheet.sheet_name }}</span><span class="mt-1 flex items-center justify-between gap-3 text-xs text-gray-500"><span>{{ sheet.status === 'parsed' ? '파싱 완료' : sheet.status === 'not_bom' ? '헤더 미탐' : '오류' }}</span><strong>{{ sheet.component_count }}</strong></span></button>
            </div>
          </section>

          <section v-if="result.failures.length > 0" class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <h2 class="font-semibold">파싱하지 못한 시트 {{ result.failures.length }}건</h2>
            <ul class="mt-2 space-y-1 text-sm"><li v-for="failure in result.failures" :key="`${failure.sheet_name}-${failure.status}`">{{ failure.sheet_name }} · {{ failureReason(failure.reason) }}</li></ul>
          </section>

          <BomComponentsTable :components="result.components" :selected-sheet="selectedSheet" @inspect="inspected = $event" />

          <section class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-200 p-5"><h2 class="font-semibold text-gray-900">헤더 매핑</h2><p class="mt-1 text-sm text-gray-500">원본 컬럼이 어떤 의미로 해석됐는지 보여줍니다. 분류 점수를 정확도처럼 표시하지 않습니다.</p></div>
            <div v-if="result.headers.filter((header) => header.sheet_name === selectedSheet).length > 0" class="grid divide-x divide-y divide-gray-200 sm:grid-cols-2 xl:grid-cols-3">
              <article v-for="header in result.headers.filter((item) => item.sheet_name === selectedSheet)" :key="`${header.sheet_name}-${header.column_1based}-${header.semantic_field}`" class="min-h-28 p-4"><div class="flex items-start justify-between gap-3"><span class="font-mono text-xs font-bold text-blue-700">COL {{ header.column_1based }}</span><span class="text-xs text-gray-400">{{ header.source === 'rule' ? '규칙 일치' : '로컬 분류' }}</span></div><strong class="mt-4 block break-words text-sm text-gray-900">{{ header.raw_header }}</strong><p class="mt-1 text-sm text-gray-500">→ {{ header.semantic_field }}</p></article>
            </div>
            <p v-else class="p-5 text-sm text-gray-400">표시할 헤더 매핑이 없습니다.</p>
          </section>
        </template>

        <template v-else>
          <BomSupplierResults v-if="supplierResult !== null" :result="supplierResult" @inspect="inspectedSupplier = $event" />
          <section v-else class="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
            <span class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gray-100 text-xl text-gray-500" aria-hidden="true">⌕</span>
            <h2 class="mt-4 font-semibold text-gray-900">아직 공급사 결과가 없습니다.</h2>
            <p class="mt-2 text-sm text-gray-500">위의 공급사 검색에서 사전점검 후 검색을 실행하면 이 탭에 결과가 표시됩니다.</p>
          </section>
        </template>
      </template>

      <section v-else-if="resultLoadError !== null" class="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
        <h2 class="font-semibold">추출 결과를 불러오지 못했습니다.</h2>
        <p class="mt-2 text-sm">{{ resultLoadError }}</p>
        <button type="button" class="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100" @click="resultQuery.refetch()">다시 시도</button>
      </section>

      <section v-else class="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">추출 결과를 불러오는 중입니다.</section>
    </template>

    <section v-else class="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">분석 작업을 불러오는 중입니다.</section>
    <BomEvidenceDrawer :component="inspected" @close="inspected = null" />
    <BomSupplierDetailDrawer :component="inspectedSupplier" @close="inspectedSupplier = null" />
  </div>
</template>
