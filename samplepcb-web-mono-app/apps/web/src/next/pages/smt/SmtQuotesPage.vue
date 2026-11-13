<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDownToLineIcon, ArrowRightIcon, CircleCheckIcon, InfoIcon } from '@lucide/vue';
import {
  ADMIN_SMT_ORDER_TABS,
  SMARTSMT_STRATEGY_LABELS,
  smartsmtLabel,
  type AdminSmtOrderItemType,
  type AdminSmtOrderTab,
  type AdminSmtPullResponseType,
} from '@sp/api-contract';
import { promptDialog } from '@/next/lib/dialog';
import { queryPage, queryString, queryTab, replaceSmtListQuery, smtQuoteTo } from '@/next/smt-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import {
  smtBlockedBadge,
  smtMemberBadge,
  smtQuoteStatusBadge,
  smtSourceBadge,
} from '@/next/components/smt/smt-badges';
import { smtAmount, smtCount, smtDateTime } from '@/next/components/smt/smt-format';
import {
  findSmtQuoteRowId,
  useAdminSmtOrders,
  usePullSmtQuote,
  type AdminSmtOrderFilters,
} from '@/next/components/smt/useAdminSmt';

// SMT 받은 견적 — docs/SMARTSMT_INTEGRATION.md §4.6. SmartSMT 가 계산을 끝내 보낸 견적서를 주문 단위로 본다
// (한 주문에 견적이 여럿이면 마지막에 받은 견적이 한 줄을 대표한다). 줄을 누르면 그 견적의 상세로 간다.
// 금액: **최종 금액 = 통합 합계(finalTotal)**, null 이면 '미정'(0원이 아니다) — 그때는 SMT 작업비(smtTotal)를 보조로 보인다.
// 견적서 가져오기 = 전송을 놓쳤을 때 주문 번호로 SmartSMT 에서 당겨 오기(파일 없음, SmartSMT 보관 24시간).

const route = useRoute();
const router = useRouter();

const initialTab = queryTab(route.query.tab, ADMIN_SMT_ORDER_TABS, 'all');
const tab = ref<AdminSmtOrderTab>(initialTab);
const filters = ref<AdminSmtOrderFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: initialTab,
  q: queryString(route.query.q),
});
const list = useAdminSmtOrders(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

// 건수는 검색어를 뺀 탭별 주문 수(서버). 검토 필요는 담당자가 볼 차례라 건수를 강조한다.
const tabs = computed<QueueTab<AdminSmtOrderTab>[]>(() => [
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
  { key: 'review', label: '검토 필요', count: counts.value?.review ?? null, attention: true },
  { key: 'undetermined', label: '합계 미확정', count: counts.value?.undetermined ?? null },
]);

watch(tab, (key) => {
  filters.value = { ...filters.value, tab: key, page: 1 };
});

const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
watch(
  [tab, filters],
  () => {
    replaceSmtListQuery(router, route.query, { tab: tab.value, page: filters.value.page, q: filters.value.q });
  },
  { deep: true, immediate: true },
);

// 줄마다 배지를 한 번만 고른다(템플릿에서 같은 함수를 여러 번 부르지 않게).
const viewRows = computed(() =>
  rows.value.map((row) => ({
    row,
    latest: row.latest,
    member: smtMemberBadge(row.ownerIsMember),
    status: row.latest === null ? null : smtQuoteStatusBadge(row.latest.quoteStatus),
    blocked: row.latest === null ? null : smtBlockedBadge(row.latest.blockedBy),
    pulled: row.latest?.source === 'pull' ? smtSourceBadge(row.latest.source) : null,
  })),
);

function openRow(row: AdminSmtOrderItemType): void {
  if (row.latest === null) return;
  void router.push(smtQuoteTo(row.latest.id, route.fullPath));
}

// ── 견적서 가져오기 ─────────────────────────────────────────────────────────────────────────
// 대화상자를 연 채로 가져오고(실패하면 입력을 둔 채 서버 문장을 보인다), 성공하면 그 견적 상세로 간다.
// 응답에는 견적 번호만 오므로 상세 주소의 행 번호는 목록에서 찾는다(findSmtQuoteRowId). 이미 받아 둔 견적이면
// 새로 생긴 것이 없으니 이동하지 않고 알린 뒤 그 주문을 목록에 띄운다.
interface PullNotice {
  duplicate: boolean;
  orderId: string;
  quoteId: string;
  quoteRowId: number | null;
}
const pull = usePullSmtQuote();
const pullNotice = ref<PullNotice | null>(null);

async function openPull(): Promise<void> {
  const pulled = ref<AdminSmtPullResponseType['data'] | null>(null);
  const values = await promptDialog({
    title: '견적서 가져오기',
    description:
      'SmartSMT 에서 주문 번호로 그 주문의 견적서를 가져옵니다. 동봉 파일은 오지 않고, SmartSMT 보관 기간(24시간)이 지난 주문은 가져올 수 없습니다.',
    fields: [{ name: 'orderId', label: '주문 번호', required: true, maxlength: 100, placeholder: 'SmartSMT 주문 번호' }],
    confirmLabel: '가져오기',
    submit: async (input) => {
      pulled.value = (await pull.mutateAsync(input.orderId ?? '')).data;
    },
    errorFallback: '견적서를 가져오지 못했습니다.',
  });
  const result = pulled.value;
  if (values === null || result === null) return;

  const rowId = await findSmtQuoteRowId(result.orderId, result.quoteId).catch(() => null);
  if (!result.duplicate && rowId !== null) {
    await router.push(smtQuoteTo(rowId, route.fullPath));
    return;
  }
  pullNotice.value = { duplicate: result.duplicate, orderId: result.orderId, quoteId: result.quoteId, quoteRowId: rowId };
  searchText.value = result.orderId;
  tab.value = 'all';
  applySearch();
}

function openPulledQuote(): void {
  const id = pullNotice.value?.quoteRowId ?? null;
  if (id !== null) void router.push(smtQuoteTo(id, route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="받은 견적"
      description="SmartSMT 가 계산해 보낸 SMT 견적서 — 주문 한 건에 한 줄(마지막 견적 기준). 최종 금액은 PCB·부품·배송까지 더한 통합 합계입니다."
    >
      <template #actions>
        <Button @click="void openPull()">
          <ArrowDownToLineIcon />
          견적서 가져오기
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="pullNotice !== null" :variant="pullNotice.duplicate ? 'info' : 'success'" size="sm" role="status">
      <InfoIcon v-if="pullNotice.duplicate" />
      <CircleCheckIcon v-else />
      <AlertDescription>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {{ pullNotice.duplicate ? '이미 받아 둔 견적입니다' : '견적서를 가져왔습니다' }} — 주문
            <span class="font-mono">{{ pullNotice.orderId }}</span> · 견적
            <span class="font-mono">{{ pullNotice.quoteId }}</span>
          </span>
          <Button v-if="pullNotice.quoteRowId !== null" variant="link" size="xs" @click="openPulledQuote">
            견적 보기
            <ArrowRightIcon />
          </Button>
          <Button variant="ghost" size="xs" class="ml-auto" @click="pullNotice = null">닫기</Button>
        </div>
      </AlertDescription>
    </Alert>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput v-model="searchText" placeholder="주문 번호·고객 이름·아이디 검색" @search="applySearch" />
      </template>
    </QueueTabs>

    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>주문 번호</TableHead>
            <TableHead>고객</TableHead>
            <TableHead>구분</TableHead>
            <TableHead class="text-right">수량</TableHead>
            <TableHead class="text-right">최종 금액</TableHead>
            <TableHead>상태</TableHead>
            <TableHead class="text-right">견적 수</TableHead>
            <TableHead>받은 시각</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="v in viewRows"
            :key="v.row.id"
            :class="v.latest === null ? '' : 'cursor-pointer'"
            :data-testid="`smt-order-${v.row.orderId}`"
            @click="openRow(v.row)"
          >
            <TableCell class="font-mono text-xs font-medium">{{ v.row.orderId }}</TableCell>
            <TableCell>
              <!-- 이름을 앞세우고 아이디를 작게. 아이디가 없으면 '—'(비회원이라 단정하지 않는다), 회원 대조에 실패한 아이디만 '회원 아님'. -->
              <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span
                  v-if="v.row.ownerName !== null && v.row.ownerName !== ''"
                  class="max-w-48 truncate font-medium"
                  :title="v.row.ownerName"
                >
                  {{ v.row.ownerName }}
                </span>
                <span class="text-muted-foreground text-xs whitespace-nowrap">{{ v.row.ownerMbId ?? '—' }}</span>
                <Badge v-if="v.member !== null" :variant="v.member.variant">{{ v.member.label }}</Badge>
              </span>
            </TableCell>
            <TableCell>{{ smartsmtLabel(SMARTSMT_STRATEGY_LABELS, v.latest?.strategy) }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ smtCount(v.latest?.quantity ?? null) }}</TableCell>
            <TableCell class="text-right">
              <template v-if="v.latest !== null">
                <div class="font-medium tabular-nums" :class="v.latest.finalTotal === null ? 'text-warning' : ''">
                  {{ smtAmount(v.latest.finalTotal, v.latest.currency) }}
                </div>
                <!-- 최종 금액이 미정이면 아는 것(SMT 작업비)을 보조로 — 최종 금액으로 읽히지 않게 이름을 붙인다. -->
                <div v-if="v.latest.finalTotal === null" class="text-muted-foreground text-xs tabular-nums">
                  SMT 작업비 {{ smtAmount(v.latest.smtTotal, v.latest.currency) }}
                </div>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell>
              <span v-if="v.status !== null" class="inline-flex flex-wrap items-center gap-1">
                <Badge :variant="v.status.variant">{{ v.status.label }}</Badge>
                <Badge v-if="v.blocked !== null" :variant="v.blocked.variant">{{ v.blocked.label }}</Badge>
                <Badge v-if="v.pulled !== null" :variant="v.pulled.variant">{{ v.pulled.label }}</Badge>
              </span>
              <span v-else class="text-muted-foreground">견적 없음</span>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ v.row.quoteCount }}</TableCell>
            <TableCell class="text-muted-foreground tabular-nums">
              {{ smtDateTime(v.latest?.receivedAt ?? v.row.lastReceivedAt) }}
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="rows.length === 0"
            :colspan="8"
            :loading="list.isFetching.value"
            :text="filters.q.trim() === ''
              ? '받은 견적이 없습니다 — SmartSMT 가 견적서를 보내면 여기에 쌓입니다.'
              : '검색 결과가 없습니다.'"
          />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
  </div>
</template>
