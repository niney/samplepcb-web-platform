<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  ADMIN_PCB_ORDER_TAB_LABELS,
  type AdminPcbOrderItemType,
  type AdminPcbOrderTabType,
} from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import {
  useAdminPcbOrderWork,
  useConfirmPcbOrderReceipt,
  type AdminPcbOrderFilters,
} from '@/admin/useAdminPcbOrders';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { confirmDialog } from '@/next/lib/dialog';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
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
import CustomerCell from '@/next/components/common/CustomerCell.vue';
import OrderCancelDialog from '@/next/components/pcb/OrderCancelDialog.vue';
import { pcbOrderStatusBadge } from '@/next/components/pcb/pcb-badges';

// PCB 주문·결제 워크큐(P3.5) — 경리 관점 조감: 입금 대기 → 진행 중 → 완료/취소.
// 레거시 이관 주문 2만여 건이 이력 모수(서버 페이지네이션). od 상태 변경은 코어 주문 관리의 몫 —
// 여기서는 무통장 입금확인과 Case 진입만. 발주 시작은 Case 상세 발주 패널.

// 경리 관점 5탭만 — 고객 배송 탭(to_ship/shipping)은 선적·배송 화면 몫(P4.6).
type ScreenTab = Exclude<AdminPcbOrderTabType, 'to_ship' | 'shipping'>;
const TAB_KEYS: readonly ScreenTab[] = ['awaiting', 'active', 'done', 'canceled', 'all'];

const route = useRoute();
const router = useRouter();
const tab = ref<ScreenTab>(queryTab(route.query.tab, TAB_KEYS, 'awaiting'));
const filters = ref<AdminPcbOrderFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: tab.value,
  q: queryString(route.query.q),
});
const list = useAdminPcbOrderWork(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
// 한 주문서(od)에 PCB 줄이 여럿이면 주문 단위 칸(주문번호·고객·결제수단·주문 결제·주문일)을 묶는다.
interface PcbOrderGroup {
  odId: string;
  header: AdminPcbOrderItemType;
  items: AdminPcbOrderItemType[];
}
const orderGroups = computed<PcbOrderGroup[]>(() => {
  const groups: PcbOrderGroup[] = [];
  const byOdId = new Map<string, PcbOrderGroup>();
  for (const item of rows.value) {
    const existing = byOdId.get(item.odId);
    if (existing !== undefined) {
      existing.items.push(item);
      continue;
    }
    const group = { odId: item.odId, header: item, items: [item] };
    byOdId.set(item.odId, group);
    groups.push(group);
  }
  return groups;
});
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
// 입금 대기가 경리의 "지금 할 일" 칸이다.
const tabs = computed<QueueTab<ScreenTab>[]>(() =>
  TAB_KEYS.map((key) => ({
    key,
    label: ADMIN_PCB_ORDER_TAB_LABELS[key],
    count: counts.value === null ? null : counts.value[key],
    attention: key === 'awaiting',
  })),
);

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
  filters,
  (value) => {
    replacePcbListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

// 줄 상태 — 영카트는 줄 단위로 취소하고 전량일 때만 od_status 를 내린다. 줄이 취소·반품·품절·삭제면
// 그 줄 상태를, 아니면 주문 상태를 보인다.
const CANCELED_ITEM_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const displayStatus = (item: AdminPcbOrderItemType): string =>
  CANCELED_ITEM_STATUSES.has(item.ctStatus) ? item.ctStatus : item.odStatus;
const canReviewCancel = (item: AdminPcbOrderItemType): boolean =>
  !CANCELED_ITEM_STATUSES.has(item.ctStatus) && item.odStatus !== '취소' && item.odStatus !== '완료';
const cancelSpecId = ref<number | null>(null);

// ── 입금확인 — 무통장 미입금만(서버 가드 동일). 그 외 전이는 통합 관리 주문내역이 전담. ──
const receipt = useConfirmPcbOrderReceipt();
const actionError = ref('');
const canConfirmReceipt = (item: AdminPcbOrderItemType): boolean =>
  item.odStatus === '주문' && !item.isPaid && item.settleCase.includes('무통장');

async function confirmReceipt(item: AdminPcbOrderItemType): Promise<void> {
  if (
    !(await confirmDialog({
      title: '입금확인',
      message:
        `주문 ${item.odId} 전체(PCB ${String(item.orderPcbCount)}건 포함)를 입금확인 처리할까요?\n` +
        '이 주문의 결제 가능한 모든 상품이 함께 입금 상태로 변경되고 고객에게 확인 메일이 발송됩니다.',
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

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'orders', route.fullPath));
}

function openCancelCase(): void {
  const id = cancelSpecId.value;
  cancelSpecId.value = null;
  if (id !== null) openCase(id);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="PCB 주문·결제">
      <template #description>
        주문 축 조감(레거시 이관 주문 포함) — 무통장 <span class="text-foreground font-medium">입금확인</span>은 여기서,
        그 밖의 상태 변경은 통합 관리 주문내역에서, 협력사 발주 시작은 Case 상세에서 합니다.
      </template>
    </PageHeader>

    <Alert v-if="actionError !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput v-model="searchText" placeholder="프로젝트·고객명·아이디·주문번호 검색" @search="applySearch" />
      </template>
    </QueueTabs>

    <TableCard>
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>주문번호</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>고객명</TableHead>
              <TableHead class="text-right">수량</TableHead>
              <TableHead class="text-right">PCB 금액</TableHead>
              <TableHead>주문 상태</TableHead>
              <TableHead>결제수단</TableHead>
              <TableHead>주문 결제</TableHead>
              <TableHead>발주</TableHead>
              <TableHead>주문일</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-for="group in orderGroups" :key="group.odId">
              <TableRow
                v-for="(row, rowIndex) in group.items"
                :key="`${String(row.specId)}-${row.odId}`"
                class="cursor-pointer"
                @click="openCase(row.specId)"
              >
                <!-- 주문 단위 칸 — 같은 주문서의 줄을 rowspan 으로 묶는다 -->
                <TableCell v-if="rowIndex === 0" :rowspan="group.items.length" class="align-top">
                  <span class="text-muted-foreground font-mono text-xs">{{ group.odId }}</span>
                  <span class="text-primary mt-1 block text-xs">PCB {{ group.header.orderPcbCount }}건 포함</span>
                </TableCell>
                <TableCell class="max-w-xs">
                  <span class="block truncate" :title="row.projectName">
                    <span class="sr-only">주문 {{ row.odId }}</span>
                    <span class="text-muted-foreground mr-1.5 font-mono text-xs">Q{{ row.specId }}</span>
                    <span class="font-medium">{{ row.projectName }}</span>
                  </span>
                </TableCell>
                <TableCell v-if="rowIndex === 0" :rowspan="group.items.length" class="align-top">
                  <CustomerCell :name="group.header.customerName" :mb-id="group.header.mbId" />
                </TableCell>
                <TableCell class="text-right">
                  <span class="text-muted-foreground tabular-nums">{{ row.qty }}</span>
                </TableCell>
                <TableCell class="text-right">
                  <span class="font-medium tabular-nums">{{ fmtPcbAmount('KRW', row.lineAmount) }}</span>
                </TableCell>
                <TableCell>
                  <span class="inline-flex items-center gap-1.5">
                    <Badge :variant="pcbOrderStatusBadge(displayStatus(row)).variant">
                      {{ pcbOrderStatusBadge(displayStatus(row)).label }}
                    </Badge>
                    <!-- 줄 축 — 이 배지가 없으면 부분 취소된 줄이 살아 있는 줄과 똑같이 '입금'으로 보이고,
                         서버 가드는 막는데 화면은 진행 중이라 말한다(od 가 통째로 취소면 겹치니 제외). -->
                    <Tooltip v-if="row.lineCanceled && row.odStatus !== '취소'">
                      <TooltipTrigger as-child>
                        <Badge variant="secondary">줄 취소</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        이 주문 줄만 취소됐습니다(주문서의 다른 줄은 살아 있습니다) — 협력 트랙 진행은 서버가 막습니다.
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </TableCell>
                <TableCell v-if="rowIndex === 0" :rowspan="group.items.length" class="align-top">
                  <span class="text-muted-foreground text-xs">{{ group.header.settleCase || '—' }}</span>
                </TableCell>
                <TableCell v-if="rowIndex === 0" :rowspan="group.items.length" class="min-w-44 align-top">
                  <dl class="space-y-0.5 text-xs tabular-nums">
                    <div class="flex justify-between gap-3">
                      <dt class="text-muted-foreground">주문</dt>
                      <dd class="font-semibold">{{ fmtPcbAmount('KRW', group.header.orderAmount) }}</dd>
                    </div>
                    <div class="flex justify-between gap-3">
                      <dt class="text-muted-foreground">현금수납</dt>
                      <dd>{{ fmtPcbAmount('KRW', group.header.receiptPrice) }}</dd>
                    </div>
                    <div v-if="group.header.receiptPoint !== 0" class="flex justify-between gap-3">
                      <dt class="text-muted-foreground">포인트</dt>
                      <dd>{{ fmtPcbAmount('KRW', group.header.receiptPoint) }}</dd>
                    </div>
                    <div v-if="group.header.refundPrice !== 0" class="text-destructive flex justify-between gap-3">
                      <dt>환불</dt>
                      <dd>-{{ fmtPcbAmount('KRW', group.header.refundPrice) }}</dd>
                    </div>
                    <div
                      v-if="group.header.refundPrice !== 0 || group.header.receiptPoint !== 0"
                      class="text-success flex justify-between gap-3 border-t pt-0.5 font-semibold"
                    >
                      <dt>순결제</dt>
                      <dd>{{ fmtPcbAmount('KRW', group.header.netReceipt) }}</dd>
                    </div>
                  </dl>
                  <!-- 상태는 결제됨인데 미수가 남은 건 = 수납 없이 상태만 올린 주문(force-status).
                       PCB 축은 상태로만 isPaid 를 파생해 그대로 두면 영영 드러나지 않는다. -->
                  <Tooltip v-if="group.header.isPaid && group.header.misu > 0 && group.header.odStatus !== '취소'">
                    <TooltipTrigger as-child>
                      <Badge variant="danger" class="mt-1.5">미수 {{ fmtPcbAmount('KRW', group.header.misu) }}</Badge>
                    </TooltipTrigger>
                    <TooltipContent>수납액이 결제금액에 못 미칩니다 — 통합 주문내역의 [입금 조정]으로 맞춰 주세요.</TooltipContent>
                  </Tooltip>
                  <!-- 반대 방향 — 돌려줄 돈. 취소 주문에도 남으므로 상태로 거르지 않는다. -->
                  <Tooltip v-else-if="group.header.misu < 0">
                    <TooltipTrigger as-child>
                      <Badge variant="warning" class="mt-1.5">과입금 {{ fmtPcbAmount('KRW', -group.header.misu) }}</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      수납액이 결제금액을 넘습니다 — 돌려줄 돈이 남아 있습니다(환불 실행은 주문 관리·결제사에서).
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Badge v-if="row.poCount > 0" variant="secondary">발주 {{ row.poCount }}건</Badge>
                  <Badge v-else-if="row.isPaid && row.odStatus !== '완료' && row.odStatus !== '취소'" variant="danger">
                    발주 대기
                  </Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell v-if="rowIndex === 0" :rowspan="group.items.length" class="align-top">
                  <span class="text-muted-foreground">{{ fmtDate(group.header.orderedAt) }}</span>
                </TableCell>
                <TableCell class="text-right">
                  <span class="inline-flex items-center justify-end gap-1">
                    <Button
                      v-if="rowIndex === 0 && canConfirmReceipt(group.header)"
                      size="sm"
                      :disabled="receipt.isPending.value"
                      @click.stop="void confirmReceipt(group.header)"
                    >
                      입금확인
                    </Button>
                    <Button v-if="canReviewCancel(row)" variant="outline" size="sm" @click.stop="cancelSpecId = row.specId">
                      취소
                    </Button>
                    <Button variant="outline" size="sm" @click.stop="openCase(row.specId)">
                      Case 열기
                      <ArrowRightIcon />
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            </template>
            <TableEmptyRow
              v-if="rows.length === 0"
              :colspan="11"
              :loading="list.isFetching.value"
              text="해당 상태의 주문이 없습니다."
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </TableCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />

    <OrderCancelDialog
      v-if="cancelSpecId !== null"
      :spec-id="cancelSpecId"
      @close="cancelSpecId = null"
      @done="cancelSpecId = null"
      @open-case="openCancelCase"
    />
  </div>
</template>
