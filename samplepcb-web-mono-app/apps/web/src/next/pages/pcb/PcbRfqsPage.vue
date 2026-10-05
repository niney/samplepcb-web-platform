<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import type { AdminPcbRfqCaseItemType, AdminPcbRfqTabType } from '@sp/api-contract';
import { pcbMarginPercent } from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { useAdminPcbRfqCases, type AdminPcbRfqCaseFilters } from '@/admin/useAdminPcbRfqs';
import { useAdminPcbTodoCounts } from '@/admin/useAdminPcbCases';
import { useRowSelection } from '@/admin/useRowSelection';
import { fmtPcbAmount, pcbKrwSuffix } from '@/lib/pcb-money';
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
import CustomerCell from '@/next/components/common/CustomerCell.vue';
import DeleteQuoteDialog from '@/next/components/pcb/DeleteQuoteDialog.vue';
import SelectionBar from '@/next/components/common/SelectionBar.vue';
import TodoQueue from '@/next/components/pcb/TodoQueue.vue';
import { pcbCategoryBadge, pcbQuoteBadge, pcbRfqReplyBadge } from '@/next/components/pcb/pcb-badges';

// PCB 견적요청(RFQ) 워크큐 — docs/PCB_PARTNER_TRACK.md §5.4. 큐 흐름:
//   요청 대기(RFQ 미발송 — 스펙 축) → 회신 대기 → 선정 대기(내 차례) → 확정가 대기 → 견적 완료.
// 첫 탭이 스펙 축인 이유: RFQ 행이 없는 건은 RFQ 축 모수에 들어올 수 없다. 배정·비교·선정
// 조작은 Case 상세(RFQ 패널)가 전담하고, 여기서는 조감과 진입만.

type RfqTabKey = AdminPcbRfqTabType | 'todo';

const route = useRoute();
const router = useRouter();
const TAB_KEYS: readonly RfqTabKey[] = ['todo', 'pending', 'quoted', 'awaiting_price', 'priced', 'all'];
const initialTab = queryTab(route.query.tab, TAB_KEYS, 'todo');
const tab = ref<RfqTabKey>(initialTab);
const filters = ref<AdminPcbRfqCaseFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: initialTab === 'todo' ? 'pending' : initialTab,
  q: queryString(route.query.q),
});
const list = useAdminPcbRfqCases(filters);
const isAdminUser = computed(() => true); // 이 화면 자체가 관리자 전용 라우트
const { todoRfq } = useAdminPcbTodoCounts(isAdminUser);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

// 앞 넷은 "무엇을 기다리는가", 마지막만 종결 — 이름만 보고 다음 행동이 읽히게 한다.
// 선정(협력사 축)과 확정가(고객 축)는 따로 일어나 선정 뒤를 두 칸으로 가른다.
// 요청 대기·선정 대기·확정가 대기는 지금 관리자가 움직일 칸이라 건수를 강조한다.
const tabs = computed<QueueTab<RfqTabKey>[]>(() => [
  { key: 'todo', label: '요청 대기', count: todoRfq.value, attention: true },
  { key: 'pending', label: '회신 대기', count: counts.value?.pending ?? null },
  { key: 'quoted', label: '선정 대기', count: counts.value?.quoted ?? null, attention: true },
  { key: 'awaiting_price', label: '확정가 대기', count: counts.value?.awaiting_price ?? null, attention: true },
  { key: 'priced', label: '견적 완료', count: counts.value?.priced ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);

// 배치 삭제 선택 — 행은 견적(Case) 단위라 진행현황과 같은 규칙·툴바·대화상자를 쓴다
// (차단·경고·사유 판정은 서버가 정본 — RFQ 만 나간 건은 "메일은 회수되지 않는다" 경고가 붙는다).
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
  if (key !== 'todo') filters.value = { ...filters.value, tab: key, page: 1 };
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
  [tab, filters],
  () => {
    replacePcbListQuery(router, route.query, { tab: tab.value, page: filters.value.page, q: filters.value.q });
  },
  { deep: true, immediate: true },
);

// 마진 — '고객 견적'(확정가)은 VAT 포함 판매가, 선정가는 원가라 눈으로 빼면 10%p 가까이 부풀어
// 보인다. 계약의 순수 함수가 VAT 를 걷어낸 뒤 나눈다(선정 모달과 같은 식). 확정가 전이거나
// KRW 환산이 없으면 계산하지 않는다.
const marginOf = (row: AdminPcbRfqCaseItemType): number | null =>
  row.finalPrice === null || row.selectedKrwAmount === null
    ? null
    : pcbMarginPercent(row.finalPrice, row.selectedKrwAmount);

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'rfqs', route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="PCB 견적요청 (RFQ)"
      description="협력사 견적요청부터 선정·확정가까지 — 배정·비교·선정은 Case 상세의 RFQ 패널에서 합니다."
    />

    <QueueTabs v-model="tab" :tabs="tabs">
      <template v-if="tab !== 'todo'" #end>
        <SearchInput v-model="searchText" placeholder="프로젝트명·고객명·아이디 검색" @search="applySearch" />
      </template>
    </QueueTabs>

    <!-- 요청 대기 — RFQ 행이 아직 없는 스펙 축(RFQ 축에는 존재하지 않는 모수) -->
    <TodoQueue v-if="tab === 'todo'" kind="todo_rfq" from="rfqs" action-label="견적요청" empty-text="요청 대기 건이 없습니다." />

    <template v-else>
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
                <TableHead>분류/수량</TableHead>
                <TableHead>고객 견적</TableHead>
                <TableHead>협력사 RFQ</TableHead>
                <TableHead>선정 협력사</TableHead>
                <TableHead>최근 요청</TableHead>
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
                  <span class="text-muted-foreground font-mono text-xs">Q{{ row.specId }}</span>
                </TableCell>
                <TableCell>
                  <span class="block max-w-xs truncate font-medium" :title="row.projectName">{{ row.projectName }}</span>
                </TableCell>
                <TableCell>
                  <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
                </TableCell>
                <!-- 분류는 배지로 — standard 와 advance 는 공정·단가가 다른 물건이라 행을 훑을 때 갈려야 한다 -->
                <TableCell>
                  <span class="inline-flex items-center gap-1.5">
                    <Badge :variant="pcbCategoryBadge(row.category).variant">
                      {{ pcbCategoryBadge(row.category).label }}
                    </Badge>
                    <span class="tabular-nums">{{ row.qty }}매</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span class="inline-flex items-center gap-1.5">
                    <Badge :variant="pcbQuoteBadge(row.quoteStatus).variant">{{ pcbQuoteBadge(row.quoteStatus).label }}</Badge>
                    <span v-if="row.finalPrice !== null" class="text-muted-foreground text-xs tabular-nums">
                      {{ fmtPcbAmount('KRW', row.finalPrice) }}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <Badge :variant="pcbRfqReplyBadge(row.rfqQuoted, row.rfqTotal).variant">
                    {{ pcbRfqReplyBadge(row.rfqQuoted, row.rfqTotal).label }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <!-- 선정가(우리 원가) — 확정가를 매기러 행을 열지 않아도 목록에서 판단이 서게 한다.
                       값은 선정 시점 박제라 오늘 환율로 흔들리지 않는다. -->
                  <div v-if="row.selectedPartnerName !== null" class="space-y-0.5">
                    <Badge variant="outline">{{ row.selectedPartnerName }}</Badge>
                    <p v-if="row.selectedPrice !== null" class="flex items-center gap-1.5 text-xs tabular-nums">
                      {{ fmtPcbAmount(row.selectedCurrency ?? 'KRW', row.selectedPrice) }}
                      <span class="text-muted-foreground">
                        {{ pcbKrwSuffix(row.selectedCurrency ?? 'KRW', row.selectedKrwAmount) }}
                      </span>
                      <Tooltip v-if="marginOf(row) !== null">
                        <TooltipTrigger as-child>
                          <Badge :variant="(marginOf(row) ?? 0) < 0 ? 'danger' : 'secondary'">마진 {{ marginOf(row) }}%</Badge>
                        </TooltipTrigger>
                        <TooltipContent>확정가에서 VAT 를 걷어낸 뒤 선정가와 비교한 값입니다 — 선정 모달의 마진%와 같은 식.</TooltipContent>
                      </Tooltip>
                    </p>
                  </div>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell>
                  <span class="text-muted-foreground">{{ fmtDate(row.latestRequestedAt) }}</span>
                </TableCell>
                <TableCell class="text-right">
                  <Button variant="outline" size="sm" @click.stop="openCase(row.specId)">
                    RFQ 관리
                    <ArrowRightIcon />
                  </Button>
                </TableCell>
              </TableRow>
              <TableEmptyRow
                v-if="rows.length === 0"
                :colspan="10"
                :loading="list.isFetching.value"
                text="해당 상태의 견적요청이 없습니다 — 시작은 [요청 대기] 탭에서 합니다."
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </TableCard>

      <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
    </template>

    <!-- 배치 영구 삭제 — 진행현황·견적 관리와 같은 대화상자(서버 판정이 정본) -->
    <DeleteQuoteDialog v-if="deleteIds !== null" :ids="deleteIds" @close="deleteIds = null" @deleted="onDeleted" />
  </div>
</template>
