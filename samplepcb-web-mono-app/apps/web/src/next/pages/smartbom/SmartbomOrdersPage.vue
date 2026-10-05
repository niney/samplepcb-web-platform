<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { AdminBomOrderCaseType, AdminBomOrderListItemType } from '@sp/api-contract';
import { useAdminBomOrders, useConfirmBomOrderReceipt, type AdminBomOrderFilters } from '@/admin/useAdminBomOrders';
import { smartbomFmtWon } from '@/admin/smartbom';
import { confirmDialog } from '@/next/lib/dialog';
import { queryPage, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { NEXT_SMARTBOM_ROUTES, smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
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
import OrderCancelDialog from '@/next/components/smartbom/OrderCancelDialog.vue';
import { bomOrderCaseBadge, bomOrderStatusBadge } from '@/next/components/smartbom/smartbom-badges';

// 스마트 BOM 주문·결제(주문 축, D19 — 결제 관점만): 경리/CS 의 화면. 입금 대기 → 입금확인.
// D17 배치 주문이면 한 주문에 Case 여러 개. 발주 대기 큐는 [발주], 배송 처리·구매확정은 [선적·배송] 메뉴.
// 미입금 무통장·발주 전 BOM 행은 여기서 안전 취소하고, 결제 승인 취소·환불처럼 영카트 원장이 필요한
// 처리는 통합 주문내역으로 안내한다.

type ScreenTab = Extract<AdminBomOrderFilters['tab'], 'all' | 'awaiting_payment' | 'paid' | 'completed'>;
const TAB_KEYS: readonly ScreenTab[] = ['all', 'awaiting_payment', 'paid', 'completed'];
const TAB_LABELS: Record<ScreenTab, string> = {
  all: '전체',
  awaiting_payment: '입금 대기',
  paid: '결제 완료',
  completed: '완료',
};

const route = useRoute();
const router = useRouter();
const tab = ref<ScreenTab>(queryTab(route.query.tab, TAB_KEYS, 'all'));
const filters = ref<AdminBomOrderFilters>({ page: queryPage(route.query.page), pageSize: 20, tab: tab.value });
const { data, isFetching } = useAdminBomOrders(filters);

const items = computed(() => data.value?.data.items ?? []);
const counts = computed(() => data.value?.data.counts ?? null);
const total = computed(() => data.value?.data.total ?? 0);

const tabCount = (key: ScreenTab): number | null => {
  const c = counts.value;
  if (c === null) return null;
  return key === 'all' ? c.all : key === 'awaiting_payment' ? c.awaitingPayment : key === 'paid' ? c.paid : c.completed;
};
// 입금 대기가 경리의 "지금 할 일" 칸이다.
const tabs = computed<QueueTab<ScreenTab>[]>(() =>
  TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    count: tabCount(key),
    attention: key === 'awaiting_payment',
  })),
);

watch(tab, (key) => {
  filters.value = { ...filters.value, tab: key, page: 1 };
});
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
watch(
  filters,
  (value) => {
    replaceListQuery(router, route.query, { tab: value.tab, page: value.page, q: '' });
  },
  { deep: true, immediate: true },
);

// from=orders — Case 상세가 주문 정보+발주 현황만 펼친다(§6.12).
const caseTo = (quoteId: string) => smartbomCaseTo(quoteId, 'orders');

const canConfirmReceipt = (item: AdminBomOrderListItemType): boolean =>
  item.odStatus === '주문' &&
  item.settleCase.includes('무통장') &&
  item.cases.some((entry) => entry.isCurrentAttempt && !entry.isCanceled && entry.ctStatus === '주문');

const canCancel = (entry: AdminBomOrderCaseType): boolean =>
  entry.isCurrentAttempt && !entry.isCanceled && entry.ctStatus === '주문';

const cancelTarget = ref<AdminBomOrderCaseType | null>(null);
function closeCancel(): void {
  cancelTarget.value = null;
}
function openCancelCase(): void {
  const quoteId = cancelTarget.value?.quoteId;
  cancelTarget.value = null;
  if (quoteId !== undefined) void router.push(caseTo(quoteId));
}

// 주문일시 — 한국 스타일("2026. 7. 30. 오후 6:32"). 서버 값은 'YYYY-MM-DD HH:mm:ss'.
const fmtDate = (v: string | null): string =>
  v === null
    ? '—'
    : new Date(v.replace(' ', 'T')).toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

// 주문 합계 밑 한 줄 — 상품 − 취소 + 배송(0 인 항목은 뺀다).
const priceBreakdown = (item: AdminBomOrderListItemType): string =>
  [
    `상품 ${smartbomFmtWon(item.cartPrice)}`,
    item.cancelPrice > 0 ? `− 취소 ${smartbomFmtWon(item.cancelPrice)}` : '',
    item.shippingPrice > 0 ? `+ 배송 ${smartbomFmtWon(item.shippingPrice)}` : '',
  ]
    .filter((part) => part !== '')
    .join(' ');

// ── 입금확인 — 기존 주문 전이 API(코어 미러 + 알림 브리지) 재사용 ─────────────
const receipt = useConfirmBomOrderReceipt();
const actionError = ref('');

async function confirmReceipt(item: AdminBomOrderListItemType): Promise<void> {
  // 메일 없이 처리하는 예외 케이스는 통합 관리 주문내역(체크박스 게이트)에서 — 여기선 단순 1확인.
  if (
    !(await confirmDialog({
      title: '입금확인',
      message: `주문 ${item.odId} 입금확인 처리할까요?\n고객에게 입금 확인 메일이 발송됩니다.`,
      confirmLabel: '입금확인',
    }))
  ) {
    return;
  }
  actionError.value = '';
  try {
    const res = await receipt.mutateAsync({ odId: item.odId, sendMail: true });
    if (res.data.skipped.length > 0) {
      actionError.value = `처리되지 않았습니다: ${res.data.skipped[0]?.reason ?? ''} — 목록을 새로고침해 주세요.`;
    }
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '입금확인에 실패했습니다.';
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="주문·결제">
      <template #description>
        결제 관점 조감 — 무통장 <span class="text-foreground font-medium">입금확인</span>과 미입금 BOM 행 취소는 여기서,
        결제 승인 취소·환불과 주문 상세 편집은 통합 주문내역에서 합니다.
      </template>
      <template #actions>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: NEXT_SMARTBOM_ROUTES.logistics }" title="고객 배송 처리·구매확정은 선적·배송 메뉴에서">
            선적·배송
            <ArrowRightIcon />
          </RouterLink>
        </Button>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: 'admin-orders' }" title="결제 승인 취소·환불과 주문 상세 편집은 통합 관리 주문내역에서">
            통합 주문내역
            <ArrowRightIcon />
          </RouterLink>
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="actionError !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <QueueTabs v-model="tab" :tabs="tabs" />

    <!-- 주문 목록(주문 축 — 배치 주문이면 Case 여러 줄). 옛 화면은 진행·작업 열을 오른쪽에 고정했는데, 고정 열이
         그 앞 열(수납·미수)을 덮어 숨겼다 — 열 폭을 줄여 한 화면에 들어오게 하고 좁으면 표 안에서 가로 스크롤한다. -->
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>주문번호</TableHead>
            <TableHead>주문일시</TableHead>
            <TableHead>고객</TableHead>
            <TableHead>연결 Case</TableHead>
            <TableHead>결제수단</TableHead>
            <TableHead class="text-right">주문 합계</TableHead>
            <TableHead class="text-right">수납 / 미수</TableHead>
            <TableHead class="text-center">진행 / 작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in items" :key="item.odId">
            <TableCell class="align-top">
              <span class="text-muted-foreground font-mono text-xs">{{ item.odId }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground align-top">{{ fmtDate(item.orderedAt) }}</TableCell>
            <TableCell class="align-top">
              <CustomerCell :name="item.customerName" :mb-id="item.mbId" />
            </TableCell>
            <TableCell class="align-top">
              <ul class="flex flex-col gap-1">
                <li
                  v-for="entry in item.cases"
                  :key="`${entry.quoteId}-${String(entry.ctId)}`"
                  class="flex max-w-60 items-center gap-1.5"
                >
                  <RouterLink
                    :to="caseTo(entry.quoteId)"
                    class="min-w-0 flex-1 truncate text-xs hover:underline"
                    :class="entry.isCanceled || !entry.isCurrentAttempt ? 'text-muted-foreground' : 'text-primary'"
                    :title="entry.title"
                  >
                    {{ entry.title }}
                  </RouterLink>
                  <Badge :variant="bomOrderCaseBadge(entry).variant">{{ bomOrderCaseBadge(entry).label }}</Badge>
                  <Button
                    v-if="canCancel(entry)"
                    variant="outline"
                    size="xs"
                    :aria-label="`${entry.title} 주문 취소`"
                    @click="cancelTarget = entry"
                  >
                    취소
                  </Button>
                </li>
              </ul>
            </TableCell>
            <TableCell class="text-muted-foreground align-top text-xs">{{ item.settleCase || '—' }}</TableCell>
            <TableCell class="text-right align-top tabular-nums">
              <span class="block font-semibold">{{ smartbomFmtWon(item.orderPrice) }}</span>
              <span class="text-muted-foreground mt-0.5 block text-xs">{{ priceBreakdown(item) }}</span>
            </TableCell>
            <TableCell class="text-right align-top text-xs tabular-nums">
              <span class="block">{{ smartbomFmtWon(item.receiptPrice) }}</span>
              <span v-if="item.misu > 0" class="text-destructive block">미수 {{ smartbomFmtWon(item.misu) }}</span>
              <!-- 음수는 돌려줄 돈 — 표시하지 않으면 과입금 주문이 정상 건과 구분되지 않는다. -->
              <span v-else-if="item.misu < 0" class="text-warning block">과입금 {{ smartbomFmtWon(-item.misu) }}</span>
            </TableCell>
            <TableCell class="text-center align-top">
              <span class="flex flex-col items-center gap-1.5">
                <Badge :variant="bomOrderStatusBadge(item).variant">{{ bomOrderStatusBadge(item).label }}</Badge>
                <Button
                  v-if="canConfirmReceipt(item)"
                  size="sm"
                  :disabled="receipt.isPending.value"
                  @click="void confirmReceipt(item)"
                >
                  입금확인
                </Button>
              </span>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="items.length === 0" :colspan="8" :loading="isFetching" text="해당 상태의 주문이 없습니다." />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination
      v-if="data !== undefined"
      :page="filters.page"
      :page-size="filters.pageSize"
      :total="total"
      @update:page="setPage"
    />

    <OrderCancelDialog
      v-if="cancelTarget !== null"
      :quote-id="cancelTarget.quoteId"
      @close="closeCancel"
      @done="closeCancel"
      @open-case="openCancelCase"
    />
  </div>
</template>
