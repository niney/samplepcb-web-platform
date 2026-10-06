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
  DEVELOP_TASK_PHASE_LABELS,
  developAreaBadge,
} from '@sp/api-contract';
import type { AdminDevelopRequestListItemType, DevelopAdminSignalType, DevelopAdminTabType } from '@sp/api-contract';
import { emptyDevelopFilters, useAdminDevelopList } from '@/admin/useAdminDevelop';
import type { DevelopQueueColumn } from '@/components/admin/develop/develop-queue';
import { formatDate, formatDateTime, formatKrw } from '@/lib/format';
import { developDetailTo, developQueueQuery, developQueueState } from '@/next/develop-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { developRequestModeVariant, developStatusBadge } from '@/next/components/develop/develop-badges';
import DevelopAiChips from './DevelopAiChips.vue';
import DevelopProgressBar from '@/next/components/develop/DevelopProgressBar.vue';

// 개발 모듈 워크큐 공용 표(docs/DEVELOP_FLOW.md §14) — 옛 components/admin/develop/DevelopQueueTable.vue 의 짝(같은 props).
// 탭 counts · 검색 · 신호 토글 · 열 프리셋 · 행 클릭 딥링크. 큐 화면(접수·검토 / 견적·계약 / …)은 이 표에 탭·열·신호만
// 넘기는 얇은 래퍼다. 전체 의뢰 화면도 같은 표를 쓴다.
// 탭·신호·검색·페이지는 URL 쿼리에 둔다(옛 규약) — 새로고침·뒤로가기에 살고, 행 클릭이 `from`+목록 상태를 상세에 실어
// 「← 목록으로」가 이 자리로 돌아온다. 기본값과 같은 값은 쿼리에 쓰지 않는다.
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
  const state = developQueueState(route.query);
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
  const defaults = { tab: props.defaultTab, signal: props.signal ?? null };
  const next = developQueueQuery(filters.value, defaults);
  const current = developQueueQuery({ ...fromQuery() }, defaults);
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
// 탭 줄에 검색까지 한 줄로 들어가는 큐(합산 탭 + 하위 상태 2칸 = 3칸). 전체 의뢰(10칸)는 검색을 아래 줄로.
const inlineSearch = computed(() => props.tabs.length <= 5);
const rows = computed(() => data.value?.data.items ?? []);
const total = computed(() => data.value?.data.total ?? 0);

// 탭 — 메뉴 배지와 같은 "관리자 차례" 상태(접수·결제 대기·검수 중)는 건수를 경고 배지로 띄운다.
const ATTENTION_TABS: readonly DevelopAdminTabType[] = ['received', 'accepted', 'delivered'];
const queueTabs = computed<QueueTab<DevelopAdminTabType>[]>(() =>
  props.tabs.map((key) => ({
    key,
    label: DEVELOP_ADMIN_TAB_LABELS[key],
    count: data.value?.data.counts[key] ?? null,
    attention: ATTENTION_TABS.includes(key),
  })),
);
const activeTab = computed<DevelopAdminTabType>({
  get: () => filters.value.tab,
  set: (tab) => {
    filters.value = { ...filters.value, tab, page: 1 };
  },
});

// 신호 토글 — 큐 고정 신호(props.signal)가 있으면 그것이 기본값이라 토글은 쓰지 않는다.
const setSignal = (signal: DevelopAdminSignalType | null): void => {
  filters.value = { ...filters.value, signal, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};

// 분야 배지 — 시스템개발은 분야가 6개 전부라 배지 문구도 '시스템개발' 이다(레지스트리 fullBadge).
// 의뢰 방식 배지와 같은 말을 두 번 쓰지 않도록, 겹치면 분야 배지를 지운다.
const areaBadge = (r: AdminDevelopRequestListItemType): string => {
  const badge = developAreaBadge(r.serviceAreas);
  return badge === DEVELOP_REQUEST_MODE_LABELS[r.requestMode] ? '' : badge;
};
const openDetail = (requestId: number): void => {
  void router.push(
    developDetailTo(requestId, {
      tab: props.detailTab,
      from: route.name,
      list: { tab: filters.value.tab, signal: filters.value.signal, q: filters.value.q, page: filters.value.page },
    }),
  );
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 탭 바(단일 탭 큐는 감춘다) + 도구(신호 토글·검색). 탭이 적으면 검색을 탭 줄 오른쪽에, 많으면(전체 의뢰 10칸)
         탭 밑줄이 검색 줄 아래로 밀려 떠 보이지 않게 따로 아래 줄에 둔다. -->
    <QueueTabs v-if="tabs.length > 1 && inlineSearch" v-model="activeTab" :tabs="queueTabs">
      <template #end>
        <div class="flex items-center gap-2">
          <SearchInput v-model="qInput" :placeholder="t('admin.develop.searchPlaceholder')" class="sm:w-72" @search="applySearch" />
          <Button type="button" variant="outline" @click="applySearch">{{ t('admin.develop.search') }}</Button>
        </div>
      </template>
    </QueueTabs>
    <QueueTabs v-else-if="tabs.length > 1" v-model="activeTab" :tabs="queueTabs" />
    <div v-if="tabs.length <= 1 || !inlineSearch" class="flex flex-wrap items-center justify-between gap-3">
      <!-- 신호 토글 — 상태가 아니라 "지금 관리자 차례"인 조건으로 큐를 좁힌다. -->
      <ButtonGroup v-if="signalToggles !== undefined && signalToggles.length > 0" :aria-label="t('admin.develop.queue.filterAll')">
        <Button
          type="button"
          size="sm"
          :variant="filters.signal === null ? 'default' : 'outline'"
          :aria-pressed="filters.signal === null"
          @click="setSignal(null)"
        >
          {{ t('admin.develop.queue.filterAll') }}
        </Button>
        <Button
          v-for="sig in signalToggles"
          :key="sig"
          type="button"
          size="sm"
          :variant="filters.signal === sig ? 'warning' : 'outline'"
          :aria-pressed="filters.signal === sig"
          @click="setSignal(sig)"
        >
          {{ DEVELOP_ADMIN_SIGNAL_LABELS[sig] }}
        </Button>
      </ButtonGroup>
      <span v-else />
      <div class="flex items-center gap-2">
        <SearchInput v-model="qInput" :placeholder="t('admin.develop.searchPlaceholder')" class="sm:w-72" @search="applySearch" />
        <Button type="button" variant="outline" @click="applySearch">{{ t('admin.develop.search') }}</Button>
      </div>
    </div>

    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead v-for="column in columns" :key="column">{{ t(`admin.develop.col.${column}`) }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rows" :key="r.requestId" class="cursor-pointer" @click="openDetail(r.requestId)">
            <TableCell v-if="has('title')" class="align-top">
              <span class="block max-w-72 truncate font-medium" :title="r.title">{{ r.title }}</span>
              <span class="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-xs">
                <Badge :variant="developRequestModeVariant(r.requestMode)">
                  {{ DEVELOP_REQUEST_MODE_LABELS[r.requestMode] }}
                </Badge>
                <span v-if="areaBadge(r) !== ''">{{ areaBadge(r) }} ·</span>
                <span>{{ DEVELOP_BUDGET_RANGE_LABELS[r.budgetRange] }}</span>
              </span>
            </TableCell>
            <TableCell v-if="has('status')" class="align-top">
              <Badge :variant="developStatusBadge(r.status).variant">{{ developStatusBadge(r.status).label }}</Badge>
            </TableCell>
            <TableCell v-if="has('owner')" class="align-top">
              <span class="block">{{ r.owner.name === '' ? r.owner.mbId : r.owner.name }}</span>
              <span class="text-muted-foreground block text-xs">{{ r.owner.email ?? r.owner.mbId }}</span>
            </TableCell>
            <TableCell v-if="has('contact')" class="align-top">
              <span class="block">{{ r.contact.name }}<template v-if="r.contact.company !== null"> · {{ r.contact.company }}</template></span>
              <span class="text-muted-foreground block text-xs tabular-nums">{{ r.contact.phone }}</span>
            </TableCell>
            <TableCell v-if="has('ai')" class="align-top">
              <DevelopAiChips :ai="r.ai" :ai-consent="r.aiConsent" />
            </TableCell>
            <TableCell v-if="has('quote')" class="align-top">
              <template v-if="r.latestQuote !== null">
                <span class="block whitespace-nowrap">
                  v{{ r.latestQuote.version }} · {{ DEVELOP_QUOTE_KIND_LABELS[r.latestQuote.kind] }}
                  <span class="text-muted-foreground">({{ DEVELOP_QUOTE_STATUS_LABELS[r.latestQuote.status] }})</span>
                </span>
                <span class="block text-xs font-semibold tabular-nums">{{ formatKrw(r.latestQuote.totalAmount) }}</span>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <!-- 달성도·현재 단계·업무 수 — 전부 서버 파생(ops)이라 화면이 다시 계산하지 않는다. -->
            <TableCell v-if="has('progress')" class="align-top">
              <span class="flex items-center gap-2">
                <span class="w-20"><DevelopProgressBar :pct="r.ops.progressPct" :label="t('admin.develop.col.progress')" /></span>
                <span class="text-xs font-semibold tabular-nums">{{ r.ops.progressPct }}%</span>
              </span>
              <span class="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-xs">
                {{ r.ops.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[r.ops.currentPhase] }}
                <template v-if="r.ops.taskCount > 0"> · {{ t('admin.develop.queue.taskCount', { n: r.ops.taskCount }) }}</template>
                <!-- 지연 = 완료일 경과 ∧ 미완료(날짜 파생, 서버 ops). -->
                <Badge v-if="r.ops.overdueTasks > 0" variant="danger">
                  {{ t('admin.develop.queue.overdueTasks', { n: r.ops.overdueTasks }) }}
                </Badge>
              </span>
            </TableCell>
            <!-- 고객 회신 대기(sent 승인형 문서) + 가장 이른 회신 요청일. 기한 초과면 위험색. -->
            <TableCell v-if="has('docs')" class="align-top">
              <template v-if="r.ops.pendingApprovals > 0">
                <Badge :variant="r.ops.replyOverdue ? 'danger' : 'warning'">
                  {{ t('admin.develop.queue.docsPending', { n: r.ops.pendingApprovals }) }}
                </Badge>
                <span
                  v-if="r.ops.nextReplyDueOn !== null"
                  class="mt-1 block text-xs tabular-nums"
                  :class="r.ops.replyOverdue ? 'text-destructive font-semibold' : 'text-muted-foreground'"
                >
                  {{ t('admin.develop.queue.replyDue', { date: r.ops.nextReplyDueOn }) }}
                  <template v-if="r.ops.replyOverdue"> · {{ t('admin.develop.queue.overdue') }}</template>
                </span>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <!-- 수납·미수납(수락 견적 마일스톤만) + 열어야 할 수동 청구 — 전부 서버 ops. -->
            <TableCell v-if="has('money')" class="align-top">
              <template v-if="r.ops.paidAmount > 0 || r.ops.pendingAmount > 0 || r.ops.openableMilestones > 0">
                <span class="block text-xs tabular-nums">{{ t('admin.develop.queue.paid', { amount: formatKrw(r.ops.paidAmount) }) }}</span>
                <span
                  class="block text-xs tabular-nums"
                  :class="r.ops.pendingAmount > 0 ? 'font-semibold' : 'text-muted-foreground'"
                >
                  {{ t('admin.develop.queue.pending', { amount: formatKrw(r.ops.pendingAmount) }) }}
                </span>
                <Badge v-if="r.ops.openableMilestones > 0" variant="warning" class="mt-1">
                  {{ t('admin.develop.queue.openable', { n: r.ops.openableMilestones }) }}
                </Badge>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <!-- 미답변 문의 = 마지막 담당자 답변 뒤에 온 고객 문의·A/S(이벤트가 진실). -->
            <TableCell v-if="has('inquiry')" class="align-top">
              <template v-if="r.ops.openInquiries > 0">
                <Badge variant="warning">{{ t('admin.develop.queue.inquiryOpen', { n: r.ops.openInquiries }) }}</Badge>
                <template v-if="r.ops.lastInquiry !== null">
                  <span class="mt-1 flex max-w-72 items-center gap-1 text-xs">
                    <Badge v-if="r.ops.lastInquiry.type === 'as_request'" variant="danger">{{ t('admin.develop.queue.asRequest') }}</Badge>
                    <span class="truncate" :title="r.ops.lastInquiry.excerpt">{{ r.ops.lastInquiry.excerpt }}</span>
                  </span>
                  <span class="text-muted-foreground block text-xs tabular-nums">{{ formatDateTime(r.ops.lastInquiry.at) }}</span>
                </template>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell v-if="has('assignee')" class="text-muted-foreground align-top">{{ r.assigneeMbId ?? '—' }}</TableCell>
            <TableCell v-if="has('createdAt')" class="text-muted-foreground align-top whitespace-nowrap tabular-nums">
              {{ formatDate(r.createdAt) }}
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="rows.length === 0"
            :colspan="columns.length"
            :loading="isFetching"
            :text="emptyText ?? t('admin.develop.empty')"
          />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination v-if="data !== undefined" :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage">
      <template #summary>{{ t('admin.develop.total', { total }) }}</template>
    </ListPagination>
  </div>
</template>
