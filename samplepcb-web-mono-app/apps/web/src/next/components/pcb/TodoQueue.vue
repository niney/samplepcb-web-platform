<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import type { AdminPcbCaseTabType } from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { useAdminPcbCases, type AdminPcbCaseFilters } from '@/admin/useAdminPcbCases';
import { useRowSelection } from '@/admin/useRowSelection';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { pcbCaseTo, type PcbAdminSection } from '@/next/pcb-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import CustomerCell from '@/next/components/common/CustomerCell.vue';
import DeleteQuoteDialog from './DeleteQuoteDialog.vue';
import SelectionBar from '@/next/components/common/SelectionBar.vue';
import { pcbCategoryBadge } from './pcb-badges';

// PCB 대기 큐(= 그 역할이 아직 시작하지 않은 일) — 견적요청·발주 화면의 첫 탭이 공유한다.
// 조작은 언제나 Case 상세가 전담하므로 여기서는 큐와 진입만 제공한다. 대기 큐는 잘못 만든
// 견적이 모이는 자리라 배치 삭제도 둔다(규칙·툴바·대화상자는 진행현황과 같은 공용).
const props = defineProps<{
  /** todo_rfq(요청 대기) | todo_po(발주 대기) */
  kind: Extract<AdminPcbCaseTabType, 'todo_rfq' | 'todo_po'>;
  /** Case 상세 진입 시 붙일 ?from= (활성 메뉴·복귀 링크). */
  from: PcbAdminSection;
  /** 행 우측 진입 버튼 문구(화살표는 자동). */
  actionLabel: string;
  emptyText: string;
}>();

const route = useRoute();
const router = useRouter();
const filters = ref<AdminPcbCaseFilters>({ page: 1, pageSize: 20, tab: props.kind, q: '' });
const list = useAdminPcbCases(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);

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

const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
  selection.clear();
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
  selection.clear();
};

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, props.from, route.fullPath));
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted-foreground text-sm">
        <template v-if="kind === 'todo_rfq'">
          협력사 견적요청을 아직 보내지 않은 건입니다 — 행을 열어 RFQ 패널에서 시작하세요.
        </template>
        <template v-else>결제가 끝났는데 발주서가 없는 건입니다 — 행을 열어 발주 패널에서 발행하세요.</template>
        레거시 이관 건은 이 큐에서 제외됩니다.
      </p>
      <SearchInput v-model="searchText" placeholder="프로젝트·고객명·아이디·주문번호" @search="applySearch" />
    </div>

    <SelectionBar :count="selection.selectedIds.value.length" @delete="deleteIds = [...selection.selectedIds.value]" />

    <TableCard>
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
              <span class="text-muted-foreground font-mono text-xs">Q{{ row.specId }}</span>
            </TableCell>
            <TableCell>
              <span class="block max-w-xs truncate font-medium" :title="row.projectName">{{ row.projectName }}</span>
            </TableCell>
            <TableCell>
              <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
            </TableCell>
            <!-- 분류는 배지로 — 요청 대기 큐는 "무엇을 협력사에 물어볼지" 고르는 자리라 물건 종류가 더 필요하다 -->
            <TableCell>
              <span class="inline-flex items-center gap-1.5">
                <Badge :variant="pcbCategoryBadge(row.category).variant">{{ pcbCategoryBadge(row.category).label }}</Badge>
                <span class="tabular-nums">{{ row.qty }}매</span>
              </span>
            </TableCell>
            <TableCell>
              <span v-if="row.odId === null" class="text-muted-foreground text-xs">주문 전</span>
              <span v-else class="inline-flex items-center gap-1.5">
                <span class="text-muted-foreground font-mono text-xs">{{ row.odId }}</span>
                <Badge variant="info">{{ row.odStatus }}</Badge>
              </span>
            </TableCell>
            <TableCell class="text-right">
              <span class="tabular-nums">{{ fmtPcbAmount('KRW', row.finalPrice) }}</span>
            </TableCell>
            <TableCell>
              <span class="text-muted-foreground">{{ fmtDate(row.createdAt) }}</span>
            </TableCell>
            <TableCell class="text-right">
              <Button size="sm" @click.stop="openCase(row.specId)">
                {{ actionLabel }}
                <ArrowRightIcon />
              </Button>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="rows.length === 0" :colspan="9" :loading="list.isFetching.value" :text="emptyText" />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />

    <DeleteQuoteDialog v-if="deleteIds !== null" :ids="deleteIds" @close="deleteIds = null" @deleted="onDeleted" />
  </div>
</template>
