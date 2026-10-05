<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon, MailIcon } from '@lucide/vue';
import type { AdminBomQuoteSummaryType, BomQuoteStatusType } from '@sp/api-contract';
import { useAdminBomQuotes, usePatchAdminBomQuote } from '@/admin/useAdminBomQuotes';
import { smartbomCaseNo, smartbomFmtDate, smartbomFmtWon, smartbomStepOf } from '@/admin/smartbom';
import { queryPage, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SelectionBar from '@/next/components/common/SelectionBar.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CaseBulkDeleteDialog from '@/next/components/smartbom/CaseBulkDeleteDialog.vue';
import QuickMailComposer from '@/next/components/smartbom/QuickMailComposer.vue';
import CaseStepBar from '@/next/components/smartbom/cases/CaseStepBar.vue';
import { smartbomQuoteStatusBadge } from '@/next/components/smartbom/smartbom-badges';
import { useCaseBulkDelete } from '@/next/components/smartbom/cases/useCaseBulkDelete';

// 스마트 BOM 진행현황 — 모듈 홈. 요약 카드(관제) + 단계 필터 탭(작업 큐) + 행 인라인 다음 액션.
// 행 클릭 = Case 상세. 데이터는 /api/admin/bom-quotes 재사용(docs/SMARTBOM_PARTNER_RFQ.md §3.3).

type CaseTab = BomQuoteStatusType | 'all';
const TAB_KEYS: readonly CaseTab[] = ['all', 'requested', 'reviewing', 'answered', 'closed', 'canceled'];

const route = useRoute();
const router = useRouter();
const tab = ref<CaseTab>(queryTab(route.query.tab, TAB_KEYS, 'all'));
const page = ref(queryPage(route.query.page));
const statusFilter = computed<BomQuoteStatusType | null>(() => (tab.value === 'all' ? null : tab.value));
const list = useAdminBomQuotes(statusFilter, page);
const patch = usePatchAdminBomQuote();

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

const tabs = computed<QueueTab<CaseTab>[]>(() => [
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
  { key: 'requested', label: '견적요청', count: counts.value?.requested ?? null, attention: true },
  { key: 'reviewing', label: '검토 중', count: counts.value?.reviewing ?? null },
  { key: 'answered', label: '회신 완료', count: counts.value?.answered ?? null },
  { key: 'closed', label: '마감', count: counts.value?.closed ?? null },
  { key: 'canceled', label: '취소', count: counts.value?.canceled ?? null },
]);

const SUMMARY_CARDS: { key: 'all' | 'requested' | 'reviewing' | 'answered'; label: string; hint: string }[] = [
  { key: 'all', label: '전체 Case', hint: '요청 이후 전체' },
  { key: 'requested', label: '견적요청', hint: '검토 대기' },
  { key: 'reviewing', label: '검토 중', hint: '견적 작업 중' },
  { key: 'answered', label: '회신 완료', hint: '고객 견적 발송 완료' },
];

// 현재 쪽 Case 체크 + 일괄 영구 삭제(차단·경고·사유 판정은 서버가 정본).
const bulk = useCaseBulkDelete(computed(() => rows.value.map((row) => row.id)), page);

watch(tab, () => {
  page.value = 1;
});
watch([tab, page], () => {
  bulk.clear();
});
watch(
  [tab, page],
  () => {
    replaceListQuery(router, route.query, { tab: tab.value, page: page.value, q: '' });
  },
  { immediate: true },
);

// 행 단계 — 주문·결제·발주·선적·검수·배송·완료 파생을 상세와 같은 입력으로 계산한다.
const stepOf = (q: AdminBomQuoteSummaryType): number =>
  smartbomStepOf(q.status, {
    orderState: q.orderState,
    isPaid: q.orderIsPaid ?? undefined,
    poCount: q.poCount,
    poReceivedCount: q.poReceivedCount,
    hasShipment: q.hasShipment,
    odStatus: q.orderStatus ?? undefined,
  });

function openCase(id: string): void {
  void router.push(smartbomCaseTo(id));
}

// 인라인 다음 액션 — requested 는 목록에서 바로 검토 시작, 이후엔 Case 진입.
const startError = ref('');
async function startReview(id: string): Promise<void> {
  startError.value = '';
  try {
    await patch.mutateAsync({ quoteId: id, body: { status: 'reviewing' } });
    openCase(id);
  } catch {
    startError.value = '검토 시작에 실패했습니다 — 목록을 새로고침해 주세요.';
  }
}

// 빠른 메일(§6.15) — 행 [메일] → 우하단 컴포즈 레이어(다른 행을 누르면 교체).
const mailTarget = ref<{ quoteId: string; caseNo: string; title: string; confirmedTotal: number | null } | null>(
  null,
);
function openMail(q: AdminBomQuoteSummaryType): void {
  mailTarget.value = {
    quoteId: q.id,
    caseNo: smartbomCaseNo(q.id, q.requestedAt, q.createdAt),
    title: q.title,
    confirmedTotal: q.confirmedTotal,
  };
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="스마트 BOM 진행현황"
      description="요청 이후 전 Case 를 조감합니다. 행을 열면 Case 상세 — 견적요청 건은 목록에서 바로 검토를 시작할 수 있습니다."
    />

    <!-- 요약 카드 -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Panel v-for="card in SUMMARY_CARDS" :key="card.key" size="md">
        <p class="text-muted-foreground text-xs">{{ card.label }}</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ counts === null ? '—' : counts[card.key] }}</p>
        <p class="text-muted-foreground mt-0.5 text-xs">{{ card.hint }}</p>
      </Panel>
    </div>

    <QueueTabs v-model="tab" :tabs="tabs" />

    <SelectionBar :count="bulk.selectedCount.value" @delete="bulk.openDialog" />

    <Alert v-if="startError !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ startError }}</AlertDescription>
    </Alert>

    <TableCard>
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-10">
                <RowCheckbox
                  :checked="bulk.headerChecked.value"
                  label="현재 페이지 Case 전체 선택"
                  :disabled="rows.length === 0"
                  @change="bulk.toggleAll"
                />
              </TableHead>
              <TableHead>Case</TableHead>
              <TableHead>견적명</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>품목(선정)</TableHead>
              <TableHead class="text-right">예상 합계</TableHead>
              <TableHead>현재 단계</TableHead>
              <TableHead>견적 상태</TableHead>
              <TableHead>요청일</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="q in rows"
              :key="q.id"
              class="cursor-pointer"
              :data-state="bulk.isSelected(q.id) ? 'selected' : undefined"
              @click="openCase(q.id)"
            >
              <TableCell>
                <RowCheckbox
                  :checked="bulk.isSelected(q.id)"
                  :label="`${smartbomCaseNo(q.id, q.requestedAt, q.createdAt)} 선택`"
                  @change="bulk.toggleRow(q.id)"
                />
              </TableCell>
              <TableCell class="text-muted-foreground font-mono text-xs whitespace-nowrap">
                {{ smartbomCaseNo(q.id, q.requestedAt, q.createdAt) }}
              </TableCell>
              <TableCell>
                <span class="block max-w-xs truncate font-medium" :title="q.title">{{ q.title }}</span>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ q.mbId }}</TableCell>
              <TableCell class="text-muted-foreground tabular-nums whitespace-nowrap">
                {{ q.includedCount }}/{{ q.itemCount }} ({{ q.matchedCount }})
              </TableCell>
              <TableCell class="text-right tabular-nums whitespace-nowrap">{{ smartbomFmtWon(q.finalTotal) }}</TableCell>
              <TableCell>
                <span v-if="q.status === 'canceled'" class="text-muted-foreground text-xs">—</span>
                <CaseStepBar v-else :step="stepOf(q)" :order-canceled="q.orderState === 'canceled'" />
              </TableCell>
              <TableCell>
                <span class="inline-flex flex-wrap items-center gap-1">
                  <Badge :variant="smartbomQuoteStatusBadge(q.status).variant">
                    {{ smartbomQuoteStatusBadge(q.status).label }}
                  </Badge>
                  <!-- 협력사가 선적 단계를 넘겨 관리자 처리 차례인 건(D22) — 메일을 놓쳐도 보이게 -->
                  <Tooltip v-if="q.shipmentAdminPending">
                    <TooltipTrigger as-child>
                      <Badge>선적 처리 필요</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      협력사가 선적 단계를 진행했습니다 — Case 상세 [선적 관리]에서 다음 단계를 처리해 주세요
                    </TooltipContent>
                  </Tooltip>
                  <!-- 회신은 됐지만 확정가가 없어 고객 주문이 잠긴 건 -->
                  <Tooltip v-if="q.status === 'answered' && q.confirmedTotal === null && q.orderState === 'none'">
                    <TooltipTrigger as-child>
                      <Badge variant="warning">확정가 미등록</Badge>
                    </TooltipTrigger>
                    <TooltipContent>확정 총액을 등록해야 고객이 주문할 수 있습니다</TooltipContent>
                  </Tooltip>
                  <Tooltip v-else-if="q.orderState === 'canceled'">
                    <TooltipTrigger as-child>
                      <Badge variant="danger">주문 취소 · 재주문 대기</Badge>
                    </TooltipTrigger>
                    <TooltipContent>이전 주문이 취소되어 고객이 확정 견적으로 다시 주문할 수 있습니다</TooltipContent>
                  </Tooltip>
                  <!-- 주문은 됐는데 발주서가 없는 건 — 결제 확인 후 발주가 다음 액션(D18) -->
                  <Tooltip v-else-if="q.orderState === 'ordered' && q.poCount === 0">
                    <TooltipTrigger as-child>
                      <Badge variant="info">발주 전</Badge>
                    </TooltipTrigger>
                    <TooltipContent>결제 확인 후 Case 에서 발주서를 발행하세요</TooltipContent>
                  </Tooltip>
                </span>
              </TableCell>
              <TableCell class="text-muted-foreground whitespace-nowrap">{{ smartbomFmtDate(q.requestedAt) }}</TableCell>
              <TableCell class="text-right whitespace-nowrap">
                <span class="inline-flex items-center gap-1">
                  <!-- 빠른 메일(§6.15) — 고객에게 바로 한 통 -->
                  <Button variant="ghost" size="sm" title="고객에게 빠른 메일 보내기" @click.stop="openMail(q)">
                    <MailIcon />
                    메일
                  </Button>
                  <Button
                    v-if="q.status === 'requested'"
                    size="sm"
                    :disabled="patch.isPending.value"
                    @click.stop="void startReview(q.id)"
                  >
                    검토 시작
                  </Button>
                  <Button v-else variant="outline" size="sm" @click.stop="openCase(q.id)">
                    Case 열기
                    <ArrowRightIcon />
                  </Button>
                </span>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="rows.length === 0"
              :colspan="10"
              :loading="list.isFetching.value"
              text="해당 상태의 Case 가 없습니다."
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </TableCard>

    <ListPagination :page="page" :page-size="20" :total="total" @update:page="page = $event" />

    <CaseBulkDeleteDialog
      v-if="bulk.dialogIds.value !== null"
      :quote-ids="bulk.dialogIds.value"
      @close="bulk.closeDialog"
      @deleted="bulk.finish"
    />

    <!-- 빠른 메일 컴포즈(§6.15) — 우하단 도킹, 행을 바꾸면 key 로 새로 연다 -->
    <QuickMailComposer
      v-if="mailTarget !== null"
      :key="mailTarget.quoteId"
      :quote-id="mailTarget.quoteId"
      :case-no="mailTarget.caseNo"
      :case-title="mailTarget.title"
      :confirmed-total="mailTarget.confirmedTotal"
      @close="mailTarget = null"
    />
  </div>
</template>
