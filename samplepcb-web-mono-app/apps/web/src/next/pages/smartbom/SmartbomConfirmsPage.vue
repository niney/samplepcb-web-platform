<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) 워크큐 — 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// 처리는 Case 상세의 '부품 확인 요청' 패널에서 한다(목록은 목록만 — 결정 UI 를 두 곳에 두지 않는다).
// 탭은 겹칠 수 있다: 한 요청이 '처리 필요'(적용할 품목)와 '환불 대기'(감액·환불 기록)에 함께 들 수 있다.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import {
  ADMIN_BOM_CONFIRM_TAB_LABELS,
  BOM_CONFIRM_ISSUE_TYPE_LABELS,
  BOM_SETTLEMENT_KIND_LABELS,
  type AdminBomConfirmTabType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { useAdminBomConfirmList, type AdminBomConfirmFilters } from '@/admin/useAdminBomConfirms';
import { smartbomFmtWon } from '@/admin/smartbom';
import { queryPage, queryString, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import CustomerCell from '@/next/components/common/CustomerCell.vue';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { bomConfirmStatusBadge } from '@/next/components/smartbom/smartbom-badges';

const TAB_ORDER: readonly AdminBomConfirmTabType[] = [
  'needs_action',
  'awaiting_customer',
  'awaiting_payment',
  'awaiting_refund',
  'backorder',
  'done',
  'canceled',
];
const PAGE_SIZE = 20;

const route = useRoute();
const router = useRouter();
const tab = ref<AdminBomConfirmTabType>(queryTab(route.query.tab, TAB_ORDER, 'needs_action'));
const page = ref(queryPage(route.query.page));
const search = ref(queryString(route.query.q));
const searchDraft = ref(search.value);
const filters = computed<AdminBomConfirmFilters>(() => ({
  tab: tab.value,
  page: page.value,
  pageSize: PAGE_SIZE,
  search: search.value,
}));
const listQuery = useAdminBomConfirmList(filters);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const counts = computed(() => listQuery.data.value?.data.counts ?? null);
const total = computed(() => listQuery.data.value?.data.total ?? 0);

// 처리 필요가 관리자의 "지금 할 일" 칸이다.
const tabs = computed<QueueTab<AdminBomConfirmTabType>[]>(() =>
  TAB_ORDER.map((key) => ({
    key,
    label: ADMIN_BOM_CONFIRM_TAB_LABELS[key],
    count: counts.value === null ? null : counts.value[key],
    attention: key === 'needs_action',
  })),
);

watch(tab, () => {
  page.value = 1;
});
function applySearch(): void {
  search.value = searchDraft.value.trim();
  page.value = 1;
}
watch(
  filters,
  (value) => {
    replaceListQuery(router, route.query, { tab: value.tab, page: value.page, q: value.search });
  },
  { immediate: true },
);

const deltaText = (value: number | null): string => {
  if (value === null) return '회신 전';
  if (value === 0) return '변동 없음';
  return value > 0 ? `+${smartbomFmtWon(value)}` : `−${smartbomFmtWon(-value)}`;
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="부품 확인"
      description="결제 뒤 재고 소진·MOQ 증가로 고객에게 물은 요청입니다. 적용·정산은 Case 상세의 부품 확인 패널에서 합니다."
    >
      <template v-if="counts !== null" #actions>
        <Badge :variant="counts.needs_action > 0 ? 'warning' : 'secondary'">처리 필요 {{ counts.needs_action }}건</Badge>
      </template>
    </PageHeader>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput
          v-model="searchDraft"
          placeholder="Case명·고객 ID·고객명·주문번호·Case 번호 검색"
          @search="applySearch"
        />
      </template>
    </QueueTabs>

    <Alert v-if="listQuery.isError.value" variant="destructive" size="sm">
      <AlertDescription>목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</AlertDescription>
    </Alert>

    <TableCard v-else>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>상태</TableHead>
            <TableHead>Case</TableHead>
            <TableHead>고객</TableHead>
            <TableHead>문제</TableHead>
            <TableHead>요청·기한</TableHead>
            <TableHead class="text-right">순액</TableHead>
            <TableHead>정산</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in items" :key="row.id">
            <TableCell class="align-top">
              <Badge :variant="bomConfirmStatusBadge(row.status).variant">{{ bomConfirmStatusBadge(row.status).label }}</Badge>
              <span v-if="row.pendingApplyCount > 0" class="text-warning mt-1 block text-xs font-medium">
                적용 대기 {{ row.pendingApplyCount }}
              </span>
              <span v-if="row.backorderCount > 0" class="text-info mt-1 block text-xs font-medium">
                입고 대기 {{ row.backorderCount }}
              </span>
            </TableCell>
            <TableCell class="max-w-56 align-top">
              <span class="block truncate font-medium" :title="row.quoteTitle">{{ row.quoteTitle }}</span>
              <span class="text-muted-foreground block text-xs">#{{ row.quoteId }} · 주문 {{ row.odId }}</span>
            </TableCell>
            <TableCell class="align-top">
              <CustomerCell :name="row.customerName ?? ''" :mb-id="row.mbId" />
            </TableCell>
            <TableCell class="align-top">
              {{ row.issueCount }}건 · {{ row.issueTypes.map((type) => BOM_CONFIRM_ISSUE_TYPE_LABELS[type]).join(', ') }}
            </TableCell>
            <TableCell class="align-top">
              <span class="block">{{ fmtKstDate(row.requestedAt) }}</span>
              <span
                v-if="row.dueOn !== null"
                class="block text-xs"
                :class="row.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'"
              >
                기한 {{ row.dueOn }}{{ row.overdue ? ' · 지남' : '' }}
              </span>
            </TableCell>
            <TableCell class="text-right align-top font-semibold tabular-nums">{{ deltaText(row.netDelta) }}</TableCell>
            <TableCell class="align-top">
              <template v-if="row.settlement !== null">
                <span class="block font-medium">
                  {{ BOM_SETTLEMENT_KIND_LABELS[row.settlement.kind] }} {{ smartbomFmtWon(row.settlement.amount) }}
                </span>
                <span class="text-muted-foreground block text-xs">{{ row.settlement.statusLabel }}</span>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="text-right align-top">
              <Button variant="outline" size="sm" as-child>
                <RouterLink :to="smartbomCaseTo(row.quoteId, 'confirms', `#bomc-admin-${String(row.id)}`)">
                  Case 열기
                  <ArrowRightIcon />
                </RouterLink>
              </Button>
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="items.length === 0"
            :colspan="8"
            :loading="listQuery.isFetching.value"
            text="이 탭에 해당하는 요청이 없습니다."
          />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="(p: number) => (page = p)" />
  </div>
</template>
