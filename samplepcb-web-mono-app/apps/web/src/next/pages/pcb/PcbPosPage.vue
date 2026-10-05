<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import { isPcbDeliveryOverdue, type AdminPcbPoTabType, type AdminPcbPoWorkItemType } from '@sp/api-contract';
import { fmtKstDate as fmtDate, kstDateOnly, kstToday } from '@sp/utils';
import { useAdminPcbPoWork, type AdminPcbPoWorkFilters } from '@/admin/useAdminPcbPos';
import { useAdminPcbTodoCounts } from '@/admin/useAdminPcbCases';
import { fmtPcbAmount, pcbKrwSuffix } from '@/lib/pcb-money';
import { pcbEqReviewTitle } from '@/lib/pcb-eq-review';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CustomerCell from '@/next/components/pcb/CustomerCell.vue';
import TodoQueue from '@/next/components/pcb/TodoQueue.vue';
import PoDeliveryFilter from '@/next/components/pcb/pos/PoDeliveryFilter.vue';
import { pcbEqReviewBadge, pcbPoStatusBadge } from '@/next/components/pcb/pos/pos-badges';

// PCB 발주·EQ 워크큐(P2) — 구매 담당의 화면. 큐 흐름:
//   발주 대기(결제 완료+미발주 — 스펙 축) → 협력사 진행 → EQ 승인 대기 → 생산 진행 → 생산완료.
// 첫 탭이 스펙 축인 이유: 발주서가 없는 건은 PO 축 모수에 들어올 수 없어 "발주해야 할 건"이
// 어느 화면에도 안 보였다. 행은 실작업 발주서 단위(MD 경유 상위는 서버가 제외), 조작은 전부 Case 상세.

type PosTabKey = AdminPcbPoTabType | 'awaiting';

const route = useRoute();
const router = useRouter();
const TAB_KEYS: readonly PosTabKey[] = ['awaiting', 'waiting', 'eq_pending', 'producing', 'produced', 'all'];
const tab = ref<PosTabKey>(queryTab(route.query.tab, TAB_KEYS, 'awaiting'));
const filters = ref<AdminPcbPoWorkFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: tab.value === 'awaiting' ? 'eq_pending' : tab.value,
  q: queryString(route.query.q),
  deliveryFrom: queryString(route.query.deliveryFrom),
  deliveryTo: queryString(route.query.deliveryTo),
});
const list = useAdminPcbPoWork(filters);
const isAdminUser = computed(() => true); // 이 화면 자체가 관리자 전용 라우트
const { todoPo } = useAdminPcbTodoCounts(isAdminUser);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

// 협력사 진행 = 관리자가 누를 것은 없지만 재촉해야 할 대상(반려 뒤 보완 대기 포함)이라 조감한다.
// 발주 대기·EQ 승인 대기는 지금 관리자가 움직일 칸이라 건수를 강조한다.
const tabs = computed<QueueTab<PosTabKey>[]>(() => [
  { key: 'awaiting', label: '발주 대기', count: todoPo.value, attention: true },
  { key: 'waiting', label: '협력사 진행', count: counts.value?.waiting ?? null },
  { key: 'eq_pending', label: 'EQ 승인 대기', count: counts.value?.eq_pending ?? null, attention: true },
  { key: 'producing', label: '생산 진행', count: counts.value?.producing ?? null },
  { key: 'produced', label: '생산완료', count: counts.value?.produced ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);

watch(tab, (key) => {
  if (key !== 'awaiting') filters.value = { ...filters.value, tab: key, page: 1 };
});

const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
// 발주 대기 탭은 아직 발주서·확정 납기가 없으므로 필터 자체를 띄우지 않는다.
const applyDelivery = (from: string, to: string): void => {
  filters.value = { ...filters.value, deliveryFrom: from, deliveryTo: to, page: 1 };
};
const clearDelivery = (): void => {
  filters.value = { ...filters.value, deliveryFrom: '', deliveryTo: '', page: 1 };
};
watch(
  [tab, filters],
  () => {
    replacePcbListQuery(router, route.query, {
      tab: tab.value,
      page: filters.value.page,
      q: filters.value.q,
      extra: { deliveryFrom: filters.value.deliveryFrom, deliveryTo: filters.value.deliveryTo },
    });
  },
  { deep: true, immediate: true },
);

// 납기 경과 — 판정은 계약의 순수 함수(Case 상세와 같은 규칙). KST 날짜로 넘긴다:
// 납기는 KST 자정 앵커라 ISO 를 그냥 자르면 하루 앞당겨진다.
const isOverdueRow = (row: AdminPcbPoWorkItemType): boolean =>
  isPcbDeliveryOverdue(row.status, kstDateOnly(row.deliveryDate), kstToday());

// EQ 고객 확인 축(D16) — 'EQ 승인 대기' 행은 모두 eq_requested 라 "지금 승인하면 되는 건"과
// "고객 답을 기다리는 건"이 섞인다. 그 갈림을 배지가 말한다. 승인 대기가 아니어도 결정이 있으면
// 남긴다(승인의 근거 — Case 와 동형).
const showEqReview = (row: AdminPcbPoWorkItemType): boolean =>
  row.status === 'eq_requested' || row.eqReview !== null;

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'pos', route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="PCB 발주·EQ"
      description="발주 대기부터 EQ 승인·생산완료까지 — 발주서 발행·EQ 승인은 Case 상세의 발주 패널에서 합니다."
    />

    <QueueTabs v-model="tab" :tabs="tabs">
      <template v-if="tab !== 'awaiting'" #end>
        <div class="flex flex-wrap items-start justify-end gap-2">
          <PoDeliveryFilter
            :from="filters.deliveryFrom"
            :to="filters.deliveryTo"
            @apply="applyDelivery"
            @clear="clearDelivery"
          />
          <SearchInput v-model="searchText" placeholder="프로젝트·협력사·고객명 검색" @search="applySearch" />
        </div>
      </template>
    </QueueTabs>

    <!-- 발주 대기 — 발주서가 아직 없는 스펙 축(PO 축에는 존재하지 않는 모수) -->
    <TodoQueue v-if="tab === 'awaiting'" kind="todo_po" from="pos" action-label="발주하기" empty-text="발주 대기 건이 없습니다." />

    <template v-else>
      <TableCard>
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>발주</TableHead>
                <TableHead>프로젝트</TableHead>
                <TableHead>고객명</TableHead>
                <TableHead>협력사</TableHead>
                <TableHead>발주가</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>납기</TableHead>
                <TableHead>발주일</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in rows" :key="row.poId" class="cursor-pointer" @click="openCase(row.specId)">
                <TableCell>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="text-muted-foreground font-mono text-xs">PO-{{ row.poId }}</span>
                    <Badge v-if="row.reorderRound > 0" variant="danger">{{ row.reorderRound }}차</Badge>
                  </span>
                </TableCell>
                <TableCell>
                  <span class="flex max-w-xs items-baseline gap-1.5" :title="row.projectName">
                    <span class="text-muted-foreground font-mono text-xs">Q{{ row.specId }}</span>
                    <span class="truncate font-medium">{{ row.projectName }}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
                </TableCell>
                <TableCell>
                  <span class="inline-flex flex-wrap items-center gap-1.5">
                    <span>{{ row.partnerName }}</span>
                    <span v-if="row.parentPartnerName !== null" class="text-info text-xs">(MD {{ row.parentPartnerName }})</span>
                    <!-- 포털 계정 없는 조직 — 이 줄은 협력사가 스스로 진행할 수 없어 큐에서 기다리면 영영 안 온다. -->
                    <Tooltip v-if="!row.partnerHasPortal">
                      <TooltipTrigger as-child>
                        <Badge variant="warning">대행 필요</Badge>
                      </TooltipTrigger>
                      <TooltipContent>포털 연결 계정이 없는 조직입니다 — 이 단계는 관리자 대행으로만 진행됩니다.</TooltipContent>
                    </Tooltip>
                  </span>
                </TableCell>
                <TableCell>
                  <span class="tabular-nums">
                    {{ fmtPcbAmount(row.currency, row.priceOriginal) }}
                    <span class="text-muted-foreground text-xs">{{ pcbKrwSuffix(row.currency, row.krwAmount) }}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span class="inline-flex flex-wrap items-center gap-1.5">
                    <Badge :variant="pcbPoStatusBadge(row.track, row.status).variant">
                      {{ pcbPoStatusBadge(row.track, row.status).label }}
                    </Badge>
                    <Badge v-if="row.adminTurn">내 차례</Badge>
                    <!-- 반려 뒤 보완 대기 — 같은 '발주접수'라도 "아직 안 온 건"과 "돌려보낸 건"은 할 말이 다르다. -->
                    <Tooltip v-if="row.status === 'issued' && row.rejectedAt !== null">
                      <TooltipTrigger as-child>
                        <Badge variant="danger">반려됨 {{ fmtDate(row.rejectedAt) }}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ fmtDate(row.rejectedAt) }} 반려 — 협력사가 보완 중입니다. 사유·회신 첨부는 Case 상세에서 볼 수 있습니다.
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="showEqReview(row)">
                      <TooltipTrigger as-child>
                        <Badge :variant="pcbEqReviewBadge(row.eqReview).variant">{{ pcbEqReviewBadge(row.eqReview).label }}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>{{ pcbEqReviewTitle(row.eqReview) }}</TooltipContent>
                    </Tooltip>
                  </span>
                </TableCell>
                <!-- 납기가 지났으면 그렇게 말한다(여정 14호) — 날짜만 찍으면 오늘과 하나하나 비교해야 한다. -->
                <TableCell>
                  <span v-if="isOverdueRow(row)" class="inline-flex items-center gap-1.5">
                    <span class="text-destructive font-semibold">{{ fmtDate(row.deliveryDate) }}</span>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge variant="danger">납기 초과</Badge>
                      </TooltipTrigger>
                      <TooltipContent>납기일이 지났는데 아직 생산완료가 아닙니다.</TooltipContent>
                    </Tooltip>
                  </span>
                  <span v-else class="text-muted-foreground">{{ fmtDate(row.deliveryDate) }}</span>
                </TableCell>
                <TableCell>
                  <span class="text-muted-foreground">{{ fmtDate(row.issuedAt) }}</span>
                </TableCell>
                <TableCell class="text-right">
                  <Button variant="outline" size="sm" @click.stop="openCase(row.specId)">
                    Case 열기
                    <ArrowRightIcon />
                  </Button>
                </TableCell>
              </TableRow>
              <TableEmptyRow
                v-if="rows.length === 0"
                :colspan="9"
                :loading="list.isFetching.value"
                text="해당 상태의 발주서가 없습니다 — 발행은 [발주 대기] 탭에서 시작합니다."
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </TableCard>

      <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
    </template>
  </div>
</template>
