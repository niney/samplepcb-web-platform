<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEV_DIAGRAM_DISCLAIMER,
  MARKET_BID_STATUS_LABELS,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_DEV_DIAGRAM_STATUS_LABELS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_PROJECT_STATUS_LABELS,
  MarketDevReview,
  apiRoutes,
  isMarketAnswerUnknown,
  marketAnswerText,
  marketAreaBadge,
  marketAreaLabel,
  marketQuestion,
  marketSlotLabel,
  marketToolRows,
} from '@sp/api-contract';
import type { MarketDevDiagramStatusType } from '@sp/api-contract';
import { ApiRequestError, apiGetBlob } from '@sp/shared';
import {
  useAdminCancelProject,
  useAdminMarketProjectDetail,
  useAdminMarketProjectList,
  useAdminRequestDevDiagram,
  type AdminMarketProjectFilters,
} from '../../admin/useAdminMarket';
import DevReviewSummary from '../../components/admin/DevReviewSummary.vue';
import UiPagination from '../../components/ui/UiPagination.vue';
import { formatDateTime } from '../../lib/format';

// 재능마켓 프로젝트 모니터 — 관리자는 블라인드·마스킹 예외(입찰 전체·의뢰인 원명·NDA 서명자).

const { t } = useI18n();

const filters = ref<AdminMarketProjectFilters>({
  page: 1,
  pageSize: 20,
  tab: 'all',
  method: '',
  q: '',
});
const qInput = ref('');
const { data, isFetching } = useAdminMarketProjectList(filters);

const selectedId = ref<number | null>(null);
const detailQ = useAdminMarketProjectDetail(selectedId);
const detail = computed(() => detailQ.data.value?.data);

// apiGet 은 `ZodType<T>`(입력·출력 동일) 로 스키마를 받아 .catch() 가 섞인 필드에서
// 추론이 입력 형태로 무너진다. 런타임 값은 이미 응답 스키마를 통과한 출력 형태이므로
// 한 번 더 parse 해 출력 타입으로 좁힌다(실질 no-op).
const devReview = computed(() => {
  const raw = detail.value?.devReview;
  return raw === undefined || raw === null ? null : MarketDevReview.parse(raw);
});

// 분야 배지 — 레지스트리(market-areas) 정본 하나로. 레지스트리에서 빠진 옛 코드는
// sortMarketAreas 가 걸러내므로 배지는 현행 분야만 보인다(docs/AI_DEV_REVIEW.md §13).
const areaBadge = computed(() => marketAreaBadge(detail.value?.serviceAreas ?? []));

// 분야별 희망 툴 — 빈 목록은 "전문가 추천"(레지스트리 규약: 빈 배열 = 미지정).
const toolRows = computed(() =>
  detail.value === undefined ? [] : marketToolRows(detail.value.tools, detail.value.serviceAreas),
);

// 질문 답변 표 — 공통 4문항 + 분야별 문항. 사전에서 사라진 문항 코드는 코드를 그대로 보인다.
interface AnswerRow {
  code: string;
  label: string;
  question: string;
  value: string;
  unknown: boolean;
}
const answerRows = computed<AnswerRow[]>(() =>
  (detail.value?.answers ?? []).map((answer) => {
    const question = marketQuestion(answer.code);
    return {
      code: answer.code,
      label: question?.short ?? answer.code,
      question: question?.label ?? '',
      value: marketAnswerText(answer),
      unknown: isMarketAnswerUnknown(answer),
    };
  }),
);

// ── 정밀 시스템 구성도(비동기 산출물) ────────────────────────────────────────
// 본문 HTML 은 서버가 살균한 LLM 산출이라 v-html 로 흘리지 않고 sandbox="" iframe srcdoc 으로만
// 렌더한다(검토서 구성도와 같은 규칙). 미리보기는 높이 고정, 전체보기는 모달.
const devDiagram = computed(() => detail.value?.devDiagram ?? { meta: null, html: null });
const diagramMeta = computed(() => devDiagram.value.meta);
const diagramHtml = computed(() => devDiagram.value.html);
const diagramStatusLabel = computed(() =>
  diagramMeta.value === null ? t('admin.devDiagram.notRequested') : MARKET_DEV_DIAGRAM_STATUS_LABELS[diagramMeta.value.status],
);
const diagramStatusBadge = (status: MarketDevDiagramStatusType | null): string =>
  status === 'done'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'queued' || status === 'running'
      ? 'bg-blue-100 text-blue-700'
      : status === 'error'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600';
const diagramRunning = computed(
  () => diagramMeta.value?.status === 'queued' || diagramMeta.value?.status === 'running',
);

const diagramZoomed = ref(false);
function onDiagramKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') diagramZoomed.value = false;
}
watch(diagramZoomed, (open) => {
  if (open) window.addEventListener('keydown', onDiagramKey);
  else window.removeEventListener('keydown', onDiagramKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDiagramKey);
});

const requestDiagram = useAdminRequestDevDiagram();
const diagramNotice = ref('');
const diagramNoticeError = ref(false);

async function onRequestDiagram(): Promise<void> {
  if (selectedId.value === null) return;
  diagramNotice.value = '';
  diagramNoticeError.value = false;
  try {
    const res = await requestDiagram.mutateAsync(selectedId.value);
    diagramNotice.value = t('admin.devDiagram.requested', {
      status: MARKET_DEV_DIAGRAM_STATUS_LABELS[res.data.status],
    });
  } catch (error) {
    diagramNoticeError.value = true;
    diagramNotice.value =
      error instanceof ApiRequestError && error.status === 409
        ? t('admin.devDiagram.alreadyRunning')
        : t('admin.devDiagram.requestFail');
  }
}

const cancelProject = useAdminCancelProject();
const confirmCancel = ref(false);
const actionError = ref('');

const TABS = ['all', 'bidding', 'awarded', 'closed', 'cancelled'] as const;
const tabLabel: Record<(typeof TABS)[number], string> = {
  all: '전체',
  bidding: '입찰중',
  awarded: '선정완료',
  closed: '마감',
  cancelled: '취소',
};

const setTab = (tab: AdminMarketProjectFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

function openDetail(id: number): void {
  selectedId.value = id;
  confirmCancel.value = false;
  actionError.value = '';
  diagramNotice.value = '';
  diagramNoticeError.value = false;
  diagramZoomed.value = false;
}

async function onCancel(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  try {
    await cancelProject.mutateAsync(selectedId.value);
    confirmCancel.value = false;
  } catch {
    actionError.value = '취소 처리에 실패했습니다(상태 변경됨?). 새로고침 후 다시 확인해 주세요.';
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminMarketFiles}/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// 첨부 슬롯 라벨 — 분야별 추가자료(area·slot)만 "분야 · 슬롯", 일반 첨부는 빈 문자열.
const attachmentSlotLabel = (area: string | null, slot: string | null): string =>
  area === null || slot === null ? '' : `${marketAreaLabel(area)} · ${marketSlotLabel(area, slot)}`;

const statusBadge = (s: string): string =>
  s === 'awarded' || s === 'working' || s === 'completed'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'bidding'
      ? 'bg-blue-100 text-blue-700'
      : s === 'cancelled'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600';
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">마켓 프로젝트</h1>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-gray-200 bg-white p-1 text-xs font-semibold">
        <button
          v-for="tabKey in TABS"
          :key="tabKey"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === tabKey ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(tabKey)"
        >
          {{ tabLabel[tabKey] }}
          <span v-if="data !== undefined" class="ml-1 text-[11px] opacity-70">
            {{ data.data.counts[tabKey] }}
          </span>
        </button>
      </div>
      <select
        v-model="filters.method"
        class="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs"
        @change="filters = { ...filters, page: 1 }"
      >
        <option value="">방식 전체</option>
        <option value="open">역견적</option>
        <option value="targeted">지정견적</option>
      </select>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          placeholder="제목·의뢰인ID 검색"
          class="h-9 w-56 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button type="button" class="h-9 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white" @click="applySearch">
          검색
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3">제목</th>
            <th class="px-4 py-3">의뢰인</th>
            <th class="px-4 py-3">방식</th>
            <th class="px-4 py-3">견적</th>
            <th class="px-4 py-3">상태</th>
            <th class="px-4 py-3">마감</th>
            <th class="px-4 py-3">등록일</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in data?.data.items ?? []"
            :key="p.projectId"
            class="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
            @click="openDetail(p.projectId)"
          >
            <td class="max-w-64 truncate px-4 py-3 font-semibold text-gray-900">
              {{ p.title }}
              <span v-if="p.ndaRequired" class="ml-1 text-[10px] text-amber-600">NDA</span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.owner.name }} ({{ p.owner.mbId }})</td>
            <td class="px-4 py-3 text-xs">{{ MARKET_METHOD_LABELS[p.method] }}</td>
            <td class="px-4 py-3 text-xs">{{ p.bidCount }}건</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(p.status)">
                {{ MARKET_PROJECT_STATUS_LABELS[p.status] }}{{ p.status === 'bidding' && p.biddingClosed ? ' (기한만료)' : '' }}
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.bidDeadlineAt.slice(0, 10) }}</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.createdAt.slice(0, 10) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="7" class="px-4 py-10 text-center text-xs text-gray-400">
              {{ isFetching ? '불러오는 중…' : '대상이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ data.data.total }}건</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>

    <!-- 상세 드로어 -->
    <div v-if="selectedId !== null" class="fixed inset-0 z-40 flex justify-end bg-black/30" @click.self="selectedId = null">
      <div class="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">프로젝트 상세</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="selectedId = null">✕</button>
        </div>

        <div v-if="detail === undefined" class="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
        <template v-else>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(detail.status)">
              {{ MARKET_PROJECT_STATUS_LABELS[detail.status] }}
            </span>
            <span class="text-xs text-gray-500">{{ MARKET_METHOD_LABELS[detail.method] }}</span>
            <span class="text-xs text-gray-500">{{ MARKET_REQUEST_TYPE_LABELS[detail.requestType] }}</span>
            <span v-if="areaBadge !== ''" class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{{ areaBadge }}</span>
            <span v-if="detail.ndaRequired" class="text-xs font-bold text-amber-600">NDA</span>
          </div>
          <h3 class="mt-2 text-base font-bold text-gray-900">{{ detail.title }}</h3>

          <dl class="mt-3 grid grid-cols-[96px_1fr] gap-y-2 text-xs">
            <dt class="text-gray-500">의뢰인</dt>
            <dd>{{ detail.owner.name }} ({{ detail.owner.mbId }}) · {{ detail.owner.email ?? '-' }}</dd>
            <dt class="text-gray-500">예산</dt>
            <dd>{{ MARKET_BUDGET_RANGE_LABELS[detail.budgetRange] }}</dd>
            <dt class="text-gray-500">희망 툴</dt>
            <dd>
              <template v-if="toolRows.length === 0">-</template>
              <ul v-else class="grid gap-0.5">
                <li v-for="row in toolRows" :key="row.area">
                  <span class="text-gray-500">{{ row.areaLabel }}:</span>
                  {{ row.labels.length > 0 ? row.labels.join(' · ') : '전문가 추천' }}
                </li>
              </ul>
            </dd>
            <dt class="text-gray-500">마감</dt>
            <dd>{{ detail.bidDeadlineAt.slice(0, 16).replace('T', ' ') }} (UTC)</dd>
            <dt v-if="detail.targetExpert !== null" class="text-gray-500">지정 전문가</dt>
            <dd v-if="detail.targetExpert !== null">
              {{ detail.targetExpert.displayName }} ({{ detail.targetExpert.mbId }})
            </dd>
          </dl>

          <p class="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
            {{ detail.description }}
          </p>

          <!-- 질문 답변 — 공통 4문항 + 분야별 문항. 검토서 없이도 보인다. -->
          <div v-if="answerRows.length > 0" class="mt-4">
            <p class="text-xs font-bold text-gray-500">질문 답변 ({{ answerRows.length }})</p>
            <dl class="mt-1.5 grid grid-cols-[96px_1fr] gap-y-1.5 rounded-lg border border-gray-100 px-3 py-2 text-xs">
              <template v-for="row in answerRows" :key="row.code">
                <dt class="text-gray-500" :title="row.question">{{ row.label }}</dt>
                <dd :class="row.unknown ? 'text-amber-700' : 'text-gray-800'">{{ row.value }}</dd>
              </template>
            </dl>
          </div>

          <!-- AI 사전 검토서 — 관리자 축약본(배지·요약·핵심 요구·분야별 확인 필요·확정할
               항목·구성도·JSON). 본문은 서버 저장분이 정본이라 여기서 고칠 수 없다. -->
          <div v-if="devReview !== null" class="mt-4 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
            <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.title') }}</p>
            <div class="mt-2">
              <DevReviewSummary :review="devReview" :title="detail?.title ?? ''" />
            </div>
          </div>

          <!-- 정밀 시스템 구성도 — 등록 뒤 백그라운드 잡 산출물. 상태·모델·소요·감사 요약과
               본문(sandbox iframe), 강제 (재)생성 버튼. -->
          <div class="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-xs font-bold text-gray-500">{{ t('admin.devDiagram.title') }}</p>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="diagramStatusBadge(diagramMeta?.status ?? null)">
                {{ diagramStatusLabel }}
              </span>
              <span v-if="diagramMeta !== null" class="font-mono text-[10px] text-gray-400">
                {{ t('admin.devDiagram.meta', {
                  model: diagramMeta.model,
                  think: diagramMeta.think,
                  promptVersion: diagramMeta.promptVersion,
                  attempt: diagramMeta.attempt,
                }) }}
              </span>
              <button
                type="button"
                class="ml-auto rounded-lg border border-indigo-300 px-3 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
                :disabled="requestDiagram.isPending.value || diagramRunning"
                @click="onRequestDiagram"
              >
                {{ requestDiagram.isPending.value ? t('admin.devDiagram.requesting') : t('admin.devDiagram.regenerate') }}
              </button>
            </div>
            <p
              v-if="diagramNotice !== ''"
              class="mt-2 text-xs font-semibold"
              :class="diagramNoticeError ? 'text-red-600' : 'text-emerald-700'"
            >
              {{ diagramNotice }}
            </p>

            <template v-if="diagramMeta !== null">
              <dl class="mt-2 grid grid-cols-[96px_1fr] gap-y-1 text-[11px]">
                <dt class="text-gray-500">{{ t('admin.devDiagram.requestedAt') }}</dt>
                <dd>{{ formatDateTime(diagramMeta.requestedAt) }}</dd>
                <template v-if="diagramMeta.generatedAt !== null">
                  <dt class="text-gray-500">{{ t('admin.devDiagram.generatedAt') }}</dt>
                  <dd>
                    {{ formatDateTime(diagramMeta.generatedAt) }}
                    <span v-if="diagramMeta.elapsedSecs !== null" class="text-gray-500">
                      · {{ t('admin.devDiagram.elapsed', { seconds: Math.round(diagramMeta.elapsedSecs) }) }}
                    </span>
                  </dd>
                </template>
                <dt class="text-gray-500">{{ t('admin.devDiagram.corpus') }}</dt>
                <dd>{{ t('admin.devDiagram.corpusChars', { count: diagramMeta.corpusChars }) }}</dd>
                <template v-if="diagramMeta.audit !== null">
                  <dt class="text-gray-500">{{ t('admin.devDiagram.audit') }}</dt>
                  <dd>
                    {{ t('admin.devDiagram.auditSummary', {
                      svg: diagramMeta.audit.svgCount,
                      sections: diagramMeta.audit.sectionCount,
                      stripped: diagramMeta.audit.strippedNodes,
                    }) }}
                  </dd>
                  <template v-if="diagramMeta.audit.ungroundedTokens.length > 0">
                    <dt class="text-amber-700">{{ t('admin.devDiagram.ungrounded') }}</dt>
                    <dd class="text-amber-800">{{ diagramMeta.audit.ungroundedTokens.join(', ') }}</dd>
                  </template>
                  <template v-if="diagramMeta.audit.requiredMissing.length > 0">
                    <dt class="text-amber-700">{{ t('admin.devDiagram.requiredMissing') }}</dt>
                    <dd class="text-amber-800">{{ diagramMeta.audit.requiredMissing.join(', ') }}</dd>
                  </template>
                </template>
                <template v-if="diagramMeta.skipReason !== null">
                  <dt class="text-gray-500">{{ t('admin.devDiagram.skipReason') }}</dt>
                  <dd class="text-gray-700">{{ diagramMeta.skipReason }}</dd>
                </template>
                <template v-if="diagramMeta.error !== null">
                  <dt class="text-red-600">{{ t('admin.devDiagram.error') }}</dt>
                  <dd class="text-red-600">{{ diagramMeta.error }}</dd>
                </template>
              </dl>

              <template v-if="diagramHtml !== null">
                <p class="mt-2 text-[11px] text-gray-500">{{ DEV_DIAGRAM_DISCLAIMER }}</p>
                <div
                  role="button"
                  tabindex="0"
                  :aria-label="t('admin.devDiagram.zoom')"
                  class="group relative mt-1.5 w-full cursor-zoom-in overflow-hidden rounded-md border border-gray-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                  style="height: 520px"
                  @click="diagramZoomed = true"
                  @keydown.enter="diagramZoomed = true"
                >
                  <iframe
                    :srcdoc="diagramHtml"
                    sandbox=""
                    class="pointer-events-none block h-full w-full border-0"
                    :title="t('admin.devDiagram.frameTitle')"
                  />
                  <div class="absolute inset-0 flex items-end justify-end p-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span class="rounded-md bg-gray-900/80 px-2.5 py-1 text-[11px] font-bold text-white">
                      🔍 {{ t('admin.devDiagram.zoom') }}
                    </span>
                  </div>
                </div>
              </template>
              <p v-else-if="diagramMeta.status === 'done'" class="mt-2 text-xs text-gray-400">
                {{ t('admin.devDiagram.noHtml') }}
              </p>
            </template>
            <p v-else class="mt-2 text-xs text-gray-400">{{ t('admin.devDiagram.notRequestedHint') }}</p>
          </div>

          <!-- 정밀 구성도 전체보기 모달 — 스크롤은 iframe 안, ESC·배경 클릭으로 닫힘 -->
          <Teleport to="body">
            <div
              v-if="diagramZoomed && diagramHtml !== null"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
              @click.self="diagramZoomed = false"
            >
              <div class="flex h-[94vh] w-[96vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <div class="flex items-center justify-between gap-6 border-b border-gray-200 px-4 py-2.5">
                  <p class="text-sm font-bold text-gray-800">{{ t('admin.devDiagram.full') }}</p>
                  <button
                    type="button"
                    class="rounded-md border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
                    @click="diagramZoomed = false"
                  >
                    {{ t('admin.devDiagram.close') }} ✕
                  </button>
                </div>
                <iframe
                  :srcdoc="diagramHtml"
                  sandbox=""
                  class="block min-h-0 w-full flex-1 border-0"
                  :title="t('admin.devDiagram.full')"
                />
              </div>
            </div>
          </Teleport>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">첨부 ({{ detail.attachments.length }})</p>
            <ul class="mt-1.5 grid gap-1">
              <li
                v-for="f in detail.attachments"
                :key="f.fileId"
                class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <span
                  v-if="attachmentSlotLabel(f.area, f.slot) !== ''"
                  class="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700"
                >
                  {{ attachmentSlotLabel(f.area, f.slot) }}
                </span>
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <button type="button" class="font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
                  다운로드
                </button>
              </li>
              <li v-if="detail.attachments.length === 0" class="text-xs text-gray-400">없음</li>
            </ul>
          </div>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">입찰 ({{ detail.bids.length }})</p>
            <div class="mt-1.5 grid gap-2">
              <div
                v-for="b in detail.bids"
                :key="b.bidId"
                class="rounded-lg border p-3 text-xs"
                :class="b.status === 'awarded' ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100'"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <b>{{ b.expert.displayName }}</b>
                  <span class="text-gray-500">{{ MARKET_EXPERT_TYPE_LABELS[b.expert.expertType] }} · {{ b.mbId }}</span>
                  <span class="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                    {{ MARKET_BID_STATUS_LABELS[b.status] }}
                  </span>
                </div>
                <p class="mt-1">
                  <b>{{ b.amount.toLocaleString('ko-KR') }}원</b> · {{ b.durationDays }}일
                  <span v-if="b.warranty !== null"> · {{ b.warranty }}</span>
                </p>
                <p class="mt-1 whitespace-pre-line text-gray-600">{{ b.message }}</p>
              </div>
              <p v-if="detail.bids.length === 0" class="text-xs text-gray-400">입찰 없음</p>
            </div>
          </div>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">NDA 서명 ({{ detail.ndaSigns.length }})</p>
            <ul class="mt-1.5 grid gap-1 text-xs text-gray-600">
              <li v-for="s in detail.ndaSigns" :key="s.mbId">
                {{ s.signedName }} ({{ s.mbId }}) · {{ s.textVersion }} · {{ s.signedAt.slice(0, 16).replace('T', ' ') }}
              </li>
              <li v-if="detail.ndaSigns.length === 0" class="text-gray-400">서명 없음</li>
            </ul>
          </div>

          <!-- 운영 취소 -->
          <div
            v-if="detail.status !== 'cancelled' && detail.status !== 'completed'"
            class="mt-6 rounded-xl border border-red-200 p-4"
          >
            <p class="text-xs font-bold text-red-600">운영 취소 (신고·분쟁 대응)</p>
            <p v-if="actionError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ actionError }}</p>
            <div class="mt-2 flex gap-2">
              <template v-if="confirmCancel">
                <button
                  type="button"
                  class="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
                  :disabled="cancelProject.isPending.value"
                  @click="onCancel"
                >
                  취소 확정
                </button>
                <button type="button" class="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600" @click="confirmCancel = false">
                  닫기
                </button>
              </template>
              <button
                v-else
                type="button"
                class="rounded-lg border border-red-300 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                @click="confirmCancel = true"
              >
                프로젝트 취소
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
