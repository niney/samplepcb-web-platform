<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import type { AdminBomOrderListItemType, AdminBomPoCrossItemType } from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { useAdminBomOrders, type AdminBomOrderFilters } from '@/admin/useAdminBomOrders';
import { useAdminBomPoCross, type AdminBomPoCrossFilters } from '@/admin/useAdminBomPos';
import { smartbomFmtWon } from '@/admin/smartbom';
import { queryPage, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import CustomerCell from '@/next/components/common/CustomerCell.vue';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { bomPoShipmentBadge, bomPoStatusBadge, type BomBadge } from '@/next/components/smartbom/smartbom-badges';

// 발주 워크큐 — 구매 담당의 화면. 큐 흐름: 발주 대기(결제 완료+미발주, 주문 축) → 확인 대기(issued) →
// 진행 중(confirmed) → 마감. 발주서 발행·상세 조작은 Case 상세(발주 패널)가 전담 — 여기선 큐와 진입만.

type TabKey = 'awaiting' | 'issued' | 'confirmed' | 'closed';
const TAB_KEYS: readonly TabKey[] = ['awaiting', 'issued', 'confirmed', 'closed'];
const TAB_LABELS: Record<TabKey, string> = {
  awaiting: '발주 대기',
  issued: '확인 대기',
  confirmed: '진행 중',
  closed: '마감',
};

const route = useRoute();
const router = useRouter();
const tab = ref<TabKey>(queryTab(route.query.tab, TAB_KEYS, 'awaiting'));
const initialPage = queryPage(route.query.page);

// 발주 대기 = 주문 축(paid_unissued — PO 가 아직 없어 주문으로 센다)
const orderFilters = ref<AdminBomOrderFilters>({
  page: tab.value === 'awaiting' ? initialPage : 1,
  pageSize: 20,
  tab: 'paid_unissued',
});
const orderQuery = useAdminBomOrders(orderFilters);
const awaitingItems = computed(() => orderQuery.data.value?.data.items ?? []);
const awaitingTotal = computed(() => orderQuery.data.value?.data.total ?? 0);

// 확인 대기/진행 중/마감 = 발주서 축(횡단 목록)
const poFilters = ref<AdminBomPoCrossFilters>({
  page: tab.value === 'awaiting' ? 1 : initialPage,
  pageSize: 20,
  tab: tab.value === 'awaiting' ? 'issued' : tab.value,
});
const poQuery = useAdminBomPoCross(poFilters);
const poItems = computed(() => poQuery.data.value?.data.items ?? []);
const poTotal = computed(() => poQuery.data.value?.data.total ?? 0);
const poCounts = computed(() => poQuery.data.value?.data.counts ?? null);

const tabCount = (key: TabKey): number | null => {
  if (key === 'awaiting') {
    const counts = orderQuery.data.value?.data.counts ?? null;
    return counts === null ? null : counts.paidUnissued;
  }
  return poCounts.value === null ? null : poCounts.value[key];
};
// 발주 대기가 구매 담당의 "지금 할 일" 칸이다.
const tabs = computed<QueueTab<TabKey>[]>(() =>
  TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key], count: tabCount(key), attention: key === 'awaiting' })),
);

watch(tab, (key) => {
  if (key === 'awaiting') orderFilters.value = { ...orderFilters.value, page: 1 };
  else poFilters.value = { ...poFilters.value, tab: key, page: 1 };
});
const currentPage = computed(() => (tab.value === 'awaiting' ? orderFilters.value.page : poFilters.value.page));
watch(
  [tab, currentPage],
  ([key, page]) => {
    replaceListQuery(router, route.query, { tab: key, page, q: '' });
  },
  { immediate: true },
);

// 발행·조작은 Case 상세 발주 패널로 — from=pos 는 발주 섹션만 펼친다(§6.12).
const poCaseTo = (quoteId: string) => smartbomCaseTo(quoteId, 'pos');
const firstUnissued = (item: AdminBomOrderListItemType): string | null =>
  (item.cases.find((entry) => entry.poCount === 0) ?? item.cases[0])?.quoteId ?? null;
// 선적 배지는 있을 수도 없을 수도 있어 0~1개 배열로 그린다(템플릿에서 null 분기 없이).
const shipmentBadges = (item: AdminBomPoCrossItemType): BomBadge[] => {
  const badge = bomPoShipmentBadge(item);
  return badge === null ? [] : [badge];
};
function openCasePo(quoteId: string): void {
  void router.push(poCaseTo(quoteId));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="발주" description="구매 담당의 큐 — 발주서 발행·상세 조작은 Case 상세의 발주 패널에서 합니다." />

    <QueueTabs v-model="tab" :tabs="tabs" />

    <!-- 발주 대기 — 결제 완료 주문의 미발주 Case (주문 축) -->
    <template v-if="tab === 'awaiting'">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>주문번호</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>Case</TableHead>
              <TableHead class="text-right">주문 금액</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in awaitingItems" :key="item.odId">
              <TableCell>
                <span class="text-muted-foreground font-mono text-xs">{{ item.odId }}</span>
              </TableCell>
              <TableCell>
                <CustomerCell :name="item.customerName" :mb-id="item.mbId" />
              </TableCell>
              <TableCell>
                <span class="flex flex-wrap gap-1">
                  <Button
                    v-for="entry in item.cases"
                    :key="entry.quoteId"
                    variant="outline"
                    size="xs"
                    as-child
                  >
                    <RouterLink :to="poCaseTo(entry.quoteId)" :title="entry.title">
                      <span class="max-w-40 truncate">{{ entry.title }}</span>
                      <Badge v-if="entry.poCount === 0" variant="warning">발주 전</Badge>
                    </RouterLink>
                  </Button>
                </span>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ smartbomFmtWon(item.cartPrice) }}</TableCell>
              <TableCell class="text-right">
                <Button v-if="firstUnissued(item) !== null" size="sm" @click="openCasePo(firstUnissued(item) ?? '')">
                  발주하기
                  <ArrowRightIcon />
                </Button>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="awaitingItems.length === 0"
              :colspan="5"
              :loading="orderQuery.isFetching.value"
              text="발주 대기 주문이 없습니다."
            />
          </TableBody>
        </Table>
      </TableCard>
      <ListPagination
        :page="orderFilters.page"
        :page-size="orderFilters.pageSize"
        :total="awaitingTotal"
        @update:page="(p: number) => (orderFilters = { ...orderFilters, page: p })"
      />
    </template>

    <!-- 확인 대기/진행 중/마감 — 발주서 축(횡단) -->
    <template v-else>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>발주번호</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>구매처</TableHead>
              <TableHead class="text-right">품목</TableHead>
              <TableHead class="text-right">발주 금액</TableHead>
              <TableHead>발행일</TableHead>
              <TableHead>확인일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>선적</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in poItems" :key="item.poId" class="cursor-pointer" @click="openCasePo(item.quoteId)">
              <TableCell>
                <span class="text-muted-foreground font-mono text-xs">PO-{{ item.poId }}</span>
              </TableCell>
              <TableCell class="max-w-52">
                <span class="block truncate font-medium" :title="item.quoteTitle">{{ item.quoteTitle }}</span>
              </TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  {{ item.partnerName }}
                  <Badge v-if="item.supplierCode !== null" variant="outline">공급사</Badge>
                </span>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ item.itemCount }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ smartbomFmtWon(item.totalAmount) }}</TableCell>
              <TableCell class="text-muted-foreground">{{ fmtDate(item.issuedAt) }}</TableCell>
              <TableCell class="text-muted-foreground">{{ fmtDate(item.confirmedAt) }}</TableCell>
              <TableCell>
                <Badge :variant="bomPoStatusBadge(item).variant">{{ bomPoStatusBadge(item).label }}</Badge>
              </TableCell>
              <TableCell>
                <Badge v-for="badge in shipmentBadges(item)" :key="badge.label" :variant="badge.variant">
                  {{ badge.label }}
                </Badge>
                <span v-if="item.shipment === null" class="text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="poItems.length === 0"
              :colspan="9"
              :loading="poQuery.isFetching.value"
              text="해당 상태의 발주서가 없습니다."
            />
          </TableBody>
        </Table>
      </TableCard>
      <ListPagination
        :page="poFilters.page"
        :page-size="poFilters.pageSize"
        :total="poTotal"
        @update:page="(p: number) => (poFilters = { ...poFilters, page: p })"
      />
    </template>
  </div>
</template>
