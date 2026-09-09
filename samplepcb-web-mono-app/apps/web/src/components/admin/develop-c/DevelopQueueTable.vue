<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  DEVELOP_ADMIN_SIGNAL_LABELS,
  DEVELOP_ADMIN_TAB_LABELS,
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_REQUEST_MODE_LABELS,
  DEVELOP_REQUEST_STATUS_LABELS,
  DEVELOP_TASK_PHASE_LABELS,
  developAreaBadge,
} from '@sp/api-contract/develop-c';
import type {
  AdminDevelopRequestListItemType,
  DevelopAdminSignalType,
  DevelopAdminTabType,
} from '@sp/api-contract/develop-c';
import { UiPagination } from '@sp/ui';
import { developCDetailTo, developCQueueQuery, developCQueueState } from '../../../admin/develop-c-navigation';
import { emptyDevelopFilters, useAdminDevelopList } from '../../../admin/useAdminDevelopC';
import DevelopAiChips from './DevelopAiChips.vue';
import { developStatusBadgeClass } from './develop-badge';
import type { DevelopQueueColumn } from './develop-queue';
import { formatDate, formatDateTime, formatKrw } from '../../../lib/format';

// 개발 모듈 워크큐 공용 표(docs/DEVELOP_FLOW.md §14) — 탭 counts · 검색 · 신호 토글 ·
// 열 프리셋 · 행 클릭 딥링크. 큐 페이지(접수·검토 / 견적·계약 / …)는 이 컴포넌트에
// 탭·열·신호만 넘기는 얇은 래퍼다. 전체 의뢰 화면도 같은 표를 쓴다(열 8개 그대로).
// 탭·신호·검색·페이지는 URL 쿼리에 둔다(2026-09-10, G 이식) — 새로고침·뒤로가기에 살고, 행 클릭이 `from`+목록 상태를
// 상세에 실어 「← 목록으로」가 이 자리로 돌아온다. 기본값과 같은 값은 쿼리에 쓰지 않는다.
const props = defineProps<{
  /** 탭 바에 그릴 탭(1개면 탭 바를 감춘다). */
  tabs: readonly DevelopAdminTabType[];
  defaultTab: DevelopAdminTabType;
  columns: readonly DevelopQueueColumn[];
  /** 큐 고정 신호 필터(예: 문의·A/S = inquiries_open). */
  signal?: DevelopAdminSignalType;
  /** 상단 신호 토글(진행 프로젝트: 회신 대기만 · 기한 초과만). */
  signalToggles?: readonly DevelopAdminSignalType[];
  /** 행 클릭 시 상세 딥링크 탭(?tab=). 없으면 의뢰 내용 탭. */
  detailTab?: string;
  /** 빈 상태 문구(없으면 공용 "해당하는 의뢰가 없습니다"). */
  emptyText?: string;
}>();

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

// URL → 필터. 이 큐에 없는 탭·토글에 없는 신호는 무시한다(다른 큐의 쿼리가 섞여 들어와도 안전).
const fromQuery = () => {
  const state = developCQueueState(route.query);
  const tab = state.tab !== null && props.tabs.includes(state.tab) ? state.tab : props.defaultTab;
  const signal =
    props.signal ?? (state.signal !== null && (props.signalToggles ?? []).includes(state.signal) ? state.signal : null);
  return { ...emptyDevelopFilters(), tab, signal, q: state.q, page: state.page };
};
const filters = ref(fromQuery());
const qInput = ref(filters.value.q);
const { data, isFetching } = useAdminDevelopList(filters);

// 필터 → URL(replace — 히스토리를 더럽히지 않는다). 큐 고정 신호(props.signal)는 기본값이라 쓰지 않는다.
const syncQuery = (): void => {
  const next = developCQueueQuery(filters.value, { tab: props.defaultTab, signal: props.signal ?? null });
  const current = developCQueueQuery({ ...fromQuery() }, { tab: props.defaultTab, signal: props.signal ?? null });
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  void router.replace({ query: next });
};
watch(filters, syncQuery, { deep: true });
// 뒤로가기 등으로 URL 이 바뀌면 필터를 따라간다.
watch(
  () => route.query,
  () => {
    const next = fromQuery();
    if (JSON.stringify(next) !== JSON.stringify(filters.value)) {
      filters.value = next;
      qInput.value = next.q;
    }
  },
);

const has = (column: DevelopQueueColumn): boolean => props.columns.includes(column);
const colCount = computed(() => props.columns.length);

const setTab = (tab: DevelopAdminTabType): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
// 신호 토글 — 큐 고정 신호(props.signal)가 있으면 그것이 기본값이라 토글은 쓰지 않는다.
const setSignal = (signal: DevelopAdminSignalType | null): void => {
  filters.value = { ...filters.value, signal, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

// 분야 배지 — 시스템개발은 분야가 6개 전부라 배지 문구도 '시스템개발' 이다(레지스트리 fullBadge).
// 의뢰 방식 칩과 같은 말을 두 번 쓰지 않도록, 겹치면 분야 배지를 지운다.
const areaBadge = (r: AdminDevelopRequestListItemType): string => {
  const badge = developAreaBadge(r.serviceAreas);
  return badge === DEVELOP_REQUEST_MODE_LABELS[r.requestMode] ? '' : badge;
};
const openDetail = (requestId: number): void => {
  void router.push(
    developCDetailTo(requestId, {
      tab: props.detailTab,
      from: route.name,
      list: { tab: filters.value.tab, signal: filters.value.signal, q: filters.value.q, page: filters.value.page },
    }),
  );
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <!-- 탭 바 — 단일 탭 큐(진행 프로젝트·문의·A/S)는 감춘다. -->
      <div v-if="tabs.length > 1" class="flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 text-sm font-semibold">
        <button
          v-for="tabKey in tabs"
          :key="tabKey"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === tabKey ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(tabKey)"
        >
          {{ DEVELOP_ADMIN_TAB_LABELS[tabKey] }}
          <span v-if="data !== undefined" class="ml-1 text-xs opacity-70">{{ data.data.counts[tabKey] }}</span>
        </button>
      </div>

      <!-- 신호 토글 — 상태가 아니라 "지금 관리자 차례"인 조건으로 큐를 좁힌다. -->
      <div
        v-if="signalToggles !== undefined && signalToggles.length > 0"
        class="flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 text-sm font-semibold"
      >
        <button
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.signal === null ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setSignal(null)"
        >
          {{ t('admin.developC.queue.filterAll') }}
        </button>
        <button
          v-for="sig in signalToggles"
          :key="sig"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.signal === sig ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setSignal(sig)"
        >
          {{ DEVELOP_ADMIN_SIGNAL_LABELS[sig] }}
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          :placeholder="t('admin.developC.searchPlaceholder')"
          class="h-9 w-64 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button type="button" class="h-9 rounded-lg bg-gray-800 px-3 text-sm font-bold text-white" @click="applySearch">
          {{ t('admin.developC.search') }}
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-base">
        <thead class="border-b border-gray-200 text-sm text-gray-500">
          <tr>
            <th v-for="column in columns" :key="column" class="px-4 py-3">{{ t(`admin.developC.col.${column}`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in data?.data.items ?? []"
            :key="r.requestId"
            class="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/40"
            @click="openDetail(r.requestId)"
          >
            <td v-if="has('title')" class="max-w-72 px-4 py-3">
              <p class="truncate font-semibold text-gray-900">{{ r.title }}</p>
              <p class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                <span
                  class="rounded-full px-1.5 py-0.5 text-[11px] font-bold"
                  :class="r.requestMode === 'system' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'"
                >
                  {{ DEVELOP_REQUEST_MODE_LABELS[r.requestMode] }}
                </span>
                <span v-if="areaBadge(r) !== ''">{{ areaBadge(r) }} ·</span>
                <span>{{ DEVELOP_BUDGET_RANGE_LABELS[r.budgetRange] }}</span>
              </p>
            </td>
            <td v-if="has('status')" class="px-4 py-3">
              <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" :class="developStatusBadgeClass(r.status)">
                {{ DEVELOP_REQUEST_STATUS_LABELS[r.status] }}
              </span>
            </td>
            <td v-if="has('owner')" class="px-4 py-3 text-sm text-gray-600">
              <p>{{ r.owner.name === '' ? r.owner.mbId : r.owner.name }}</p>
              <p class="text-xs text-gray-400">{{ r.owner.email ?? r.owner.mbId }}</p>
            </td>
            <td v-if="has('contact')" class="px-4 py-3 text-sm text-gray-600">
              <p>{{ r.contact.name }}<span v-if="r.contact.company !== null"> · {{ r.contact.company }}</span></p>
              <p class="text-xs text-gray-400">{{ r.contact.phone }}</p>
            </td>
            <td v-if="has('ai')" class="px-4 py-3">
              <DevelopAiChips :ai="r.ai" :ai-consent="r.aiConsent" />
            </td>
            <td v-if="has('quote')" class="px-4 py-3 text-sm text-gray-600">
              <template v-if="r.latestQuote !== null">
                <p>
                  v{{ r.latestQuote.version }} · {{ DEVELOP_QUOTE_KIND_LABELS[r.latestQuote.kind] }}
                  <span class="text-gray-400">({{ DEVELOP_QUOTE_STATUS_LABELS[r.latestQuote.status] }})</span>
                </p>
                <p class="text-xs font-semibold text-gray-700">{{ formatKrw(r.latestQuote.totalAmount) }}</p>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
            <!-- 달성도·현재 단계·업무 수 — 전부 서버 파생(ops)이라 화면이 다시 계산하지 않는다. -->
            <td v-if="has('progress')" class="px-4 py-3 text-sm text-gray-600">
              <div class="flex items-center gap-2">
                <div class="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
                  <i class="block h-full rounded-full bg-blue-600" :style="{ width: `${String(r.ops.progressPct)}%` }" />
                </div>
                <span class="text-xs font-bold text-gray-700">{{ r.ops.progressPct }}%</span>
              </div>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ r.ops.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[r.ops.currentPhase] }}
                <span v-if="r.ops.taskCount > 0" class="text-gray-400"> · {{ t('admin.developC.queue.taskCount', { n: r.ops.taskCount }) }}</span>
                <!-- 지연 = 완료일 경과 ∧ 미완료(날짜 파생, 서버 ops). -->
                <span v-if="r.ops.overdueTasks > 0" class="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                  {{ t('admin.developC.queue.overdueTasks', { n: r.ops.overdueTasks }) }}
                </span>
              </p>
            </td>
            <!-- 고객 회신 대기(sent 승인형 문서) + 가장 이른 회신 요청일. 기한 초과면 빨강. -->
            <td v-if="has('docs')" class="px-4 py-3 text-sm">
              <template v-if="r.ops.pendingApprovals > 0">
                <span
                  class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold"
                  :class="r.ops.replyOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'"
                >
                  {{ t('admin.developC.queue.docsPending', { n: r.ops.pendingApprovals }) }}
                </span>
                <p v-if="r.ops.nextReplyDueOn !== null" class="mt-0.5 text-xs" :class="r.ops.replyOverdue ? 'font-bold text-red-600' : 'text-gray-500'">
                  {{ t('admin.developC.queue.replyDue', { date: r.ops.nextReplyDueOn }) }}
                  <span v-if="r.ops.replyOverdue"> · {{ t('admin.developC.queue.overdue') }}</span>
                </p>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
            <!-- 수납·미수납(수락 견적 마일스톤만) + 열어야 할 수동 청구 — 전부 서버 ops. -->
            <td v-if="has('money')" class="px-4 py-3 text-sm">
              <template v-if="r.ops.paidAmount > 0 || r.ops.pendingAmount > 0 || r.ops.openableMilestones > 0">
                <p class="text-xs text-gray-700">{{ t('admin.developC.queue.paid', { amount: formatKrw(r.ops.paidAmount) }) }}</p>
                <p class="text-xs" :class="r.ops.pendingAmount > 0 ? 'font-semibold text-gray-800' : 'text-gray-400'">
                  {{ t('admin.developC.queue.pending', { amount: formatKrw(r.ops.pendingAmount) }) }}
                </p>
                <span v-if="r.ops.openableMilestones > 0" class="mt-0.5 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  {{ t('admin.developC.queue.openable', { n: r.ops.openableMilestones }) }}
                </span>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
            <!-- 미답변 문의 = 마지막 담당자 답변 뒤에 온 고객 문의·A/S(이벤트가 진실). -->
            <td v-if="has('inquiry')" class="max-w-72 px-4 py-3 text-sm">
              <template v-if="r.ops.openInquiries > 0">
                <span class="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  {{ t('admin.developC.queue.inquiryOpen', { n: r.ops.openInquiries }) }}
                </span>
                <p v-if="r.ops.lastInquiry !== null" class="mt-0.5 truncate text-xs text-gray-600">
                  <span v-if="r.ops.lastInquiry.type === 'as_request'" class="mr-1 rounded bg-red-50 px-1 text-[11px] font-bold text-red-600">
                    {{ t('admin.developC.queue.asRequest') }}
                  </span>
                  {{ r.ops.lastInquiry.excerpt }}
                </p>
                <p v-if="r.ops.lastInquiry !== null" class="text-xs text-gray-400">{{ formatDateTime(r.ops.lastInquiry.at) }}</p>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
            <td v-if="has('assignee')" class="px-4 py-3 text-sm text-gray-600">{{ r.assigneeMbId ?? '—' }}</td>
            <td v-if="has('createdAt')" class="px-4 py-3 text-sm text-gray-500">{{ formatDate(r.createdAt) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td :colspan="colCount" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ isFetching ? t('admin.developC.loading') : (emptyText ?? t('admin.developC.empty')) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-base text-gray-500">{{ t('admin.developC.total', { total: data.data.total }) }}</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p: number) => (filters = { ...filters, page: p })"
      />
    </div>
  </div>
</template>
