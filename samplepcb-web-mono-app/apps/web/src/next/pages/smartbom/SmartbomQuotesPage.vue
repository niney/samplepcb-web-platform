<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon, MailIcon } from '@lucide/vue';
import type { AdminBomQuoteSummaryType, BomQuoteStatusType } from '@sp/api-contract';
import { useAdminBomQuotes, usePatchAdminBomQuote } from '@/admin/useAdminBomQuotes';
import { smartbomCaseNo, smartbomFmtDate, smartbomFmtWon } from '@/admin/smartbom';
import { queryPage, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SelectionBar from '@/next/components/common/SelectionBar.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CaseBulkDeleteDialog from '@/next/components/smartbom/CaseBulkDeleteDialog.vue';
import QuickMailComposer from '@/next/components/smartbom/QuickMailComposer.vue';
import { smartbomQuoteStatusBadge, smartbomRfqBadge } from '@/next/components/smartbom/smartbom-badges';
import { useCaseBulkDelete } from '@/next/components/smartbom/cases/useCaseBulkDelete';

// 견적관리 워크큐 — 견적 담당의 화면. 진행현황(12단계 조감)과 달리 견적 흐름만 본다: 검토 대기 →
// RFQ 발송·회신 수집(reviewing 의 실황을 RFQ n/m 로) → 고객 회신(answered). RFQ 발송·비교·선정은
// Case 상세(RFQ 패널)가 전담 — 진입은 ?from=quotes 로(견적 관련 섹션만 펼침, §6.12).

type QuoteTab = BomQuoteStatusType | 'all';
const TAB_KEYS: readonly QuoteTab[] = ['requested', 'reviewing', 'answered', 'closed', 'all'];

const route = useRoute();
const router = useRouter();
const tab = ref<QuoteTab>(queryTab(route.query.tab, TAB_KEYS, 'requested'));
const page = ref(queryPage(route.query.page));
const statusFilter = computed<BomQuoteStatusType | null>(() => (tab.value === 'all' ? null : tab.value));
const list = useAdminBomQuotes(statusFilter, page);
const patch = usePatchAdminBomQuote();

const rows = computed(() => list.data.value?.data.items ?? []);
// 행마다 RFQ 실황 배지를 한 번만 계산해 둔다(템플릿에서 null 판정 뒤 그대로 쓰게).
const rowViews = computed(() => rows.value.map((q) => ({ q, rfq: smartbomRfqBadge(q) })));
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

const tabs = computed<QueueTab<QuoteTab>[]>(() => [
  { key: 'requested', label: '검토 대기', count: counts.value?.requested ?? null, attention: true },
  { key: 'reviewing', label: 'RFQ 진행', count: counts.value?.reviewing ?? null },
  { key: 'answered', label: '회신 완료', count: counts.value?.answered ?? null },
  { key: 'closed', label: '마감', count: counts.value?.closed ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);

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

function openCase(id: string): void {
  void router.push(smartbomCaseTo(id, 'quotes'));
}

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
      title="견적관리"
      description="검토 대기 → RFQ 발송·회신 수집 → 고객 회신 순서의 견적 흐름입니다. RFQ 발송·비교·선정은 Case 상세의 RFQ 패널에서 합니다."
    />

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
              <TableHead>RFQ</TableHead>
              <TableHead class="text-right">예상 합계</TableHead>
              <TableHead>요청일</TableHead>
              <TableHead>견적 상태</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="{ q, rfq } in rowViews"
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
              <TableCell>
                <Badge v-if="rfq !== null" :variant="rfq.variant">{{ rfq.label }}</Badge>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
              <TableCell class="text-right tabular-nums whitespace-nowrap">{{ smartbomFmtWon(q.finalTotal) }}</TableCell>
              <TableCell class="text-muted-foreground whitespace-nowrap">{{ smartbomFmtDate(q.requestedAt) }}</TableCell>
              <TableCell>
                <span class="inline-flex flex-wrap items-center gap-1">
                  <Badge :variant="smartbomQuoteStatusBadge(q.status).variant">
                    {{ smartbomQuoteStatusBadge(q.status).label }}
                  </Badge>
                  <!-- 회신은 됐지만 확정가가 없어 고객 주문이 잠긴 건 — 견적 담당의 남은 일 -->
                  <Tooltip v-if="q.status === 'answered' && q.confirmedTotal === null && q.orderState === 'none'">
                    <TooltipTrigger as-child>
                      <Badge variant="warning">확정가 미등록</Badge>
                    </TooltipTrigger>
                    <TooltipContent>확정 총액을 등록해야 고객이 주문할 수 있습니다</TooltipContent>
                  </Tooltip>
                </span>
              </TableCell>
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
                  <Button v-else-if="q.status === 'reviewing'" size="sm" @click.stop="openCase(q.id)">
                    RFQ 관리
                    <ArrowRightIcon />
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
              text="해당 상태의 견적이 없습니다."
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
