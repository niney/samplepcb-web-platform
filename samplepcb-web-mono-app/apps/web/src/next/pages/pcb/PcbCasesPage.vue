<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import type { AdminPcbCaseItemType, AdminPcbCaseTabType } from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { useAdminPcbCases, type AdminPcbCaseFilters } from '@/admin/useAdminPcbCases';
import { useRowSelection } from '@/admin/useRowSelection';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CustomerCell from '@/next/components/pcb/CustomerCell.vue';
import DeleteQuoteDialog from '@/next/components/pcb/DeleteQuoteDialog.vue';
import SelectionBar from '@/next/components/pcb/SelectionBar.vue';
import {
  pcbAsRoundBadge,
  pcbOrderStatusBadge,
  pcbQuoteBadge,
  pcbRfqReplyBadge,
  pcbStepBadge,
  type PcbBadge,
} from '@/next/components/pcb/pcb-badges';

// PCB 진행현황 — 모듈 홈, 총괄의 화면. 견적요청부터 선적·배송까지를 순서대로 조감한다: 행마다
// 12단계 파생 단계(PCB_STEPS)를 칩으로 보이고, 탭은 큰 구간으로 나눈다. 단계는 저장 상태가 아니라
// 원장(RFQ·발주·선적·od)에서 서버가 계산한 표시값. 조작은 언제나 Case 상세 — 여기서는 조감과 진입만
// (역할별 대기 큐는 각 워크큐 첫 탭).

// 탭 = 흐름 구간. 기본은 '발주·생산'(지금 굴러가는 건) — 완료 2만 건이 모수를 덮지 않게.
type CaseTab = Extract<AdminPcbCaseTabType, 'quoting' | 'unpaid' | 'production' | 'closed' | 'all'>;
const TAB_KEYS: readonly CaseTab[] = ['quoting', 'unpaid', 'production', 'closed', 'all'];

const route = useRoute();
const router = useRouter();
const tab = ref<CaseTab>(queryTab(route.query.tab, TAB_KEYS, 'production'));
const filters = ref<AdminPcbCaseFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: tab.value,
  q: queryString(route.query.q),
});
const list = useAdminPcbCases(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const tabs = computed<QueueTab<CaseTab>[]>(() => [
  { key: 'quoting', label: '견적', count: counts.value?.quoting ?? null },
  { key: 'unpaid', label: '주문·결제', count: counts.value?.unpaid ?? null },
  { key: 'production', label: '발주·생산', count: counts.value?.production ?? null },
  { key: 'closed', label: '완료·취소', count: counts.value?.closed ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);

// 배치 삭제 선택 — 차단·경고·사유 판정은 서버가 정본이라 협력 발주·선적이 걸린 건은 여기서도
// 그냥 지워지지 않는다.
const pageIds = computed(() => rows.value.map((r) => r.specId));
const selection = useRowSelection(pageIds);
const headerChecked = computed<boolean | 'indeterminate'>(() =>
  selection.allSelected.value ? true : selection.someSelected.value ? 'indeterminate' : false,
);
const deleteIds = ref<number[] | null>(null);
const onDeleted = (): void => {
  deleteIds.value = null;
  selection.clear();
};

watch(tab, (key) => {
  filters.value = { ...filters.value, tab: key, page: 1 };
  selection.clear();
});
const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
  selection.clear();
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
  selection.clear();
};
watch(
  filters,
  (value) => {
    replacePcbListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

// 주문 열 — 장바구니 전이면 고객 견적 상태, 담겼으면 장바구니, 주문됐으면 od 상태(주문 화면과 같은 색).
const orderBadge = (row: AdminPcbCaseItemType): PcbBadge =>
  row.cartState === 'none'
    ? pcbQuoteBadge(row.quoteStatus)
    : row.cartState === 'cart'
      ? { label: '장바구니', variant: 'warning' }
      : pcbOrderStatusBadge(row.odStatus ?? '');

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'cases', route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="PCB 진행현황">
      <template #description>
        전 견적건을 견적요청 → 주문·결제 → 발주·생산 → 선적·배송 순서로 조감합니다. 각 역할이
        <span class="text-foreground font-medium">시작해야 할 일</span>은 견적요청·발주·EQ·선적·배송 메뉴의 첫 탭에
        있습니다.
      </template>
    </PageHeader>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput v-model="searchText" placeholder="프로젝트·고객명·아이디·주문번호" @search="applySearch" />
      </template>
    </QueueTabs>

    <SelectionBar :count="selection.selectedIds.value.length" @delete="deleteIds = [...selection.selectedIds.value]" />

    <TableCard>
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-10">
                <RowCheckbox
                  :checked="headerChecked"
                  label="현재 페이지 전체 선택"
                  :disabled="rows.length === 0"
                  @change="selection.toggleAll"
                />
              </TableHead>
              <TableHead>견적</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>고객명</TableHead>
              <TableHead class="text-right">수량</TableHead>
              <TableHead>단계</TableHead>
              <TableHead>협력사</TableHead>
              <TableHead>주문</TableHead>
              <TableHead class="text-right">확정가</TableHead>
              <TableHead>신청일</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="row in rows"
              :key="row.specId"
              class="cursor-pointer"
              :data-state="selection.isSelected(row.specId) ? 'selected' : undefined"
              @click="openCase(row.specId)"
            >
              <TableCell>
                <RowCheckbox
                  :checked="selection.isSelected(row.specId)"
                  :label="`Q${String(row.specId)} 선택`"
                  @change="selection.toggleOne(row.specId)"
                />
              </TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  <span class="text-muted-foreground font-mono text-xs">Q{{ row.specId }}</span>
                  <Badge v-if="row.isLegacy" variant="outline" title="레거시 이관 건">이관</Badge>
                </span>
              </TableCell>
              <TableCell>
                <span class="block max-w-xs truncate font-medium" :title="row.projectName">{{ row.projectName }}</span>
              </TableCell>
              <TableCell>
                <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums">{{ row.qty }}</span>
              </TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  <Badge :variant="pcbStepBadge(row.step).variant">{{ pcbStepBadge(row.step).label }}</Badge>
                  <!-- A/S 회차(정책 확정 08-10) — 진행 중이면 od 완료여도 '발주·생산' 구간에 선다
                       (판정 축 = 최상위 발주의 최신 회차). 종결 회차는 이력 신호만. -->
                  <Tooltip v-if="row.asRound > 0">
                    <TooltipTrigger as-child>
                      <Badge :variant="pcbAsRoundBadge(row.asRound, row.asOpen).variant">
                        {{ pcbAsRoundBadge(row.asRound, row.asOpen).label }}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        row.asOpen
                          ? 'A/S 재생산 회차가 진행 중입니다 — 주문이 완료여도 진행 구간에 섭니다'
                          : 'A/S 회차가 종결된 건입니다'
                      }}
                    </TooltipContent>
                  </Tooltip>
                </span>
              </TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  <span v-if="row.rfqTotal === 0" class="text-muted-foreground">—</span>
                  <Badge v-else-if="row.rfqSelected" variant="success">선정 완료</Badge>
                  <Badge v-else :variant="pcbRfqReplyBadge(row.rfqQuoted, row.rfqTotal).variant">
                    {{ pcbRfqReplyBadge(row.rfqQuoted, row.rfqTotal).label }}
                  </Badge>
                  <Badge v-if="row.poCount > 0" variant="secondary">발주 {{ row.poCount }}</Badge>
                </span>
              </TableCell>
              <TableCell>
                <Badge :variant="orderBadge(row).variant">{{ orderBadge(row).label }}</Badge>
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums">{{ fmtPcbAmount('KRW', row.finalPrice) }}</span>
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground">{{ fmtDate(row.createdAt) }}</span>
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
              :colspan="11"
              :loading="list.isFetching.value"
              text="해당 구간의 견적건이 없습니다."
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </TableCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />

    <!-- 배치 영구 삭제 — 견적 관리와 같은 대화상자(차단·경고·사유 판정은 서버가 정본) -->
    <DeleteQuoteDialog v-if="deleteIds !== null" :ids="deleteIds" @close="deleteIds = null" @deleted="onDeleted" />
  </div>
</template>
