<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronLeftIcon, ChevronRightIcon, PackageIcon, ScanLineIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  SHIPMENT_TRANSPORT_LABELS,
  type AdminBomOrderListItemType,
  type AdminBomShipmentCrossItemType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { useAdminBomOrders, useCompleteBomOrder, type AdminBomOrderFilters } from '@/admin/useAdminBomOrders';
import {
  useAdminBomPos,
  useAdminBomShipmentCross,
  type AdminBomShipmentCrossFilters,
} from '@/admin/useAdminBomPos';
import { smartbomFmtWon } from '@/admin/smartbom';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import ReceivingPanel from '@/next/components/smartbom/ReceivingPanel.vue';
import ShipmentDialog from '@/next/components/smartbom/ShipmentDialog.vue';
import CustomerShipDialog from '@/next/components/smartbom/logistics/CustomerShipDialog.vue';
import {
  bomShipmentRowBadge,
  orderCaseBadge,
  orderShipStateBadge,
  receivingScanVariant,
} from '@/next/components/smartbom/smartbom-badges';
import {
  activeOrderCases,
  allOrderCasesReceived,
  openShortageCount,
} from '@/next/components/smartbom/logistics/order-receipt';
import { confirmDialog } from '@/next/lib/dialog';
import { NEXT_SMARTBOM_ROUTES, smartbomCaseTo } from '@/next/smartbom-navigation';

// 선적·배송 워크큐 — 물류 담당의 화면(옛 pages/admin/AdminSmartbomLogistics.vue 의 짝). 흐름이 위→아래로
// 이어진다: ① 조달 선적(내 차례→진행 중→입고 완료, D22 핑퐁) → ② 입고 끝난 주문을 고객에게 발송
// (배송 처리·구매확정 — 주문·결제 화면에서 이동해 온 D21-3 액션). 맨 위 통합 스캔 박스는 우리 포장 QR 과
// 공급사 봉투 라벨(D42)을 한 입력으로 받는다.

const router = useRouter();

// QR 리더기(키보드 입력)·라벨 수기 코드를 같은 진입점으로 받는다. 휴대폰 카메라로 QR URL을 읽으면
// 이 입력을 거치지 않고 패키지 라우트로 바로 온다.
const packageScan = ref('');
const packageScanError = ref('');

function normalizePackageCode(raw: string): string {
  const value = raw.trim();
  if (value === '') return '';
  if (value.toUpperCase().startsWith('SPB1:')) return value.slice(5).trim();
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return value;
  }
}

// 통합 스캔 박스(D42) — 우리 포장 QR/라벨(PKG-…·64자 토큰·QR URL)은 추적 화면으로, 공급사 봉투
// 라벨(ECIA [)>… ·1D)은 아래 입고 패널로.
const scanInput = ref<{ $el: HTMLInputElement } | null>(null);
const receivingPanel = ref<{ scan: (raw: string) => Promise<void> } | null>(null);
const receivingOpen = ref(false);

function isPackageCode(raw: string): boolean {
  const value = raw.trim();
  if (/^SPB1:/i.test(value) || /^PKG-/i.test(value) || /^[a-f0-9]{64}$/i.test(value)) return true;
  try {
    return new URL(value).pathname.includes('/smartbom/packages/');
  } catch {
    return false;
  }
}

function focusScanInput(): void {
  void nextTick(() => scanInput.value?.$el.focus());
}

function openPackageScan(): void {
  const raw = packageScan.value;
  if (raw.trim() === '') {
    packageScanError.value = 'QR·라벨 코드 또는 공급사 봉투 바코드를 입력해 주세요.';
    return;
  }
  packageScanError.value = '';
  if (isPackageCode(raw)) {
    const code = normalizePackageCode(raw);
    void router.push({ name: NEXT_SMARTBOM_ROUTES.package, params: { code } });
    return;
  }
  // 공급사 봉투 라벨 → 입고 패널(대조·기록). 입력은 비우고 포커스는 패널이 끝나면 되돌린다.
  packageScan.value = '';
  receivingOpen.value = true;
  void receivingPanel.value?.scan(raw);
}

// ── ① 조달 선적 — 횡단 목록 + 선적 대화상자(대표 발주서 경유) ─────────────────
type ShipTab = AdminBomShipmentCrossFilters['tab'];
const shipFilters = ref<AdminBomShipmentCrossFilters>({ page: 1, pageSize: 20, tab: 'admin_pending' });
const shipQuery = useAdminBomShipmentCross(shipFilters);
const shipItems = computed(() => shipQuery.data.value?.data.items ?? []);
const shipTotal = computed(() => shipQuery.data.value?.data.total ?? 0);
const shipCounts = computed(() => shipQuery.data.value?.data.counts ?? null);
const shipTab = computed<ShipTab>({
  get: () => shipFilters.value.tab,
  set: (tab) => {
    shipFilters.value = { ...shipFilters.value, tab, page: 1 };
  },
});
const shipTabs = computed<QueueTab<ShipTab>[]>(() => [
  { key: 'admin_pending', label: '내 차례', count: shipCounts.value?.adminPending ?? null, attention: true },
  { key: 'active', label: '진행 중', count: shipCounts.value?.active ?? null },
  { key: 'received', label: '입고 완료', count: shipCounts.value?.received ?? null },
]);

// 선적 처리 = Case 상세와 같은 선적 대화상자 — 대표 발주서(quoteId+poId)로 연다.
const selected = ref<{ quoteId: string; poId: number } | null>(null);
const shipmentTableScroll = ref<HTMLElement | null>(null);
const orderTableScroll = ref<HTMLElement | null>(null);

function moveTable(target: 'shipment' | 'order', direction: -1 | 1): void {
  const element = target === 'shipment' ? shipmentTableScroll.value : orderTableScroll.value;
  element?.querySelector<HTMLElement>('[data-slot="table-container"]')?.scrollBy({ left: direction * 300, behavior: 'smooth' });
}
const selectedQuoteId = computed(() => selected.value?.quoteId ?? null);
const selectedPoQuery = useAdminBomPos(selectedQuoteId);
const selectedPo = computed(() => {
  if (selected.value === null) return null;
  const pos = selectedPoQuery.data.value?.data.pos ?? [];
  return pos.find((po) => po.poId === selected.value?.poId) ?? null;
});

function openShipment(item: AdminBomShipmentCrossItemType): void {
  const primary = item.groupPos.find((entry) => entry.isPrimary) ?? item.groupPos[0];
  if (primary === undefined) return;
  selected.value = { quoteId: item.quoteId, poId: primary.poId };
}

// ── ② 고객 배송 — 주문 축(to_ship=배송 처리 대기 / shipping=배송 중) ─────────
type OrderTab = 'to_ship' | 'shipping';
const orderFilters = ref<AdminBomOrderFilters>({ page: 1, pageSize: 20, tab: 'to_ship' });
const orderQuery = useAdminBomOrders(orderFilters);
const orderItems = computed(() => orderQuery.data.value?.data.items ?? []);
const orderTotal = computed(() => orderQuery.data.value?.data.total ?? 0);
const orderTab = computed<OrderTab>({
  get: () => (orderFilters.value.tab === 'shipping' ? 'shipping' : 'to_ship'),
  set: (tab) => {
    orderFilters.value = { ...orderFilters.value, tab, page: 1 };
  },
});
const orderTabs = computed<QueueTab<OrderTab>[]>(() => {
  const counts = orderQuery.data.value?.data.counts ?? null;
  return [
    { key: 'to_ship', label: '배송 처리 대기', count: counts?.toShip ?? null, attention: true },
    { key: 'shipping', label: '배송 중', count: counts?.shipping ?? null },
  ];
});

const actionError = ref('');
const actionFeedback = ref<{ tone: 'success' | 'warning'; text: string } | null>(null);
const shipTarget = ref<AdminBomOrderListItemType | null>(null);
const completeMut = useCompleteBomOrder();

function openShip(item: AdminBomOrderListItemType): void {
  actionFeedback.value = null;
  shipTarget.value = item;
}
function onShipped(feedback: { tone: 'success' | 'warning'; text: string }): void {
  actionFeedback.value = feedback;
  shipTarget.value = null;
}

async function completeOrder(item: AdminBomOrderListItemType): Promise<void> {
  if (!(await confirmDialog({ message: `주문 ${item.odId} 을 구매확정(완료) 처리할까요?`, confirmLabel: '구매확정' }))) return;
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '구매확정에 실패했습니다.';
  }
}

const shipStateBadge = (item: AdminBomOrderListItemType) =>
  orderShipStateBadge(item.odStatus === '배송', allOrderCasesReceived(item), openShortageCount(item));
</script>

<template>
  <div class="flex flex-col gap-8">
    <PageHeader
      title="선적·배송"
      description="위에서 아래로 이어지는 물류 흐름 — 조달 선적을 입고까지 처리하고, 입고 끝난 주문을 고객에게 발송합니다."
    />

    <!-- 통합 스캔 박스(D42) — 우리 포장 QR 은 추적 화면으로, 공급사 봉투 라벨은 입고 패널로. -->
    <SectionCard title="스캔 — 부품 QR·라벨 조회 / 공급사 봉투 입고" data-testid="logistics-scan-box">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          ref="scanInput"
          v-model="packageScan"
          type="text"
          autocomplete="off"
          spellcheck="false"
          class="min-w-64 flex-1"
          aria-label="스캔 — 부품 QR·라벨 코드 또는 공급사 봉투 바코드"
          data-testid="receiving-scan-input"
          placeholder="우리 QR(PKG-…)은 추적 화면으로, DigiKey·Mouser 봉투 2D 바코드는 입고 기록으로 (Enter)"
          @keyup.enter="openPackageScan"
        />
        <Button @click="openPackageScan">
          <ScanLineIcon />
          스캔 처리
        </Button>
        <Button
          variant="outline"
          :aria-expanded="receivingOpen"
          data-testid="receiving-toggle"
          @click="receivingOpen = !receivingOpen"
        >
          {{ receivingOpen ? '입고 패널 접기' : '입고 패널' }}
        </Button>
      </div>
      <p class="text-muted-foreground text-xs">
        휴대폰 카메라로 인쇄된 QR을 읽으면 추적 화면이 바로 열립니다. 공급사 봉투 라벨(ECIA 2D)은 API 없이 읽어 발주 품목
        입고로 남깁니다.
      </p>
      <Alert v-if="packageScanError !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ packageScanError }}</AlertDescription>
      </Alert>
      <div v-show="receivingOpen">
        <ReceivingPanel ref="receivingPanel" @settled="focusScanInput" />
      </div>
    </SectionCard>

    <!-- ① 조달 선적 -->
    <SectionCard title="조달 선적 — 입고까지" flush>
      <div class="p-4">
        <QueueTabs v-model="shipTab" :tabs="shipTabs" />
      </div>
      <div ref="shipmentTableScroll" class="border-t">
        <!-- 좁은 화면 — 표가 넓어 오른쪽 열(출고예정·운송장·입고일·처리)이 가려진다. -->
        <div class="text-muted-foreground flex items-center gap-2 border-b px-4 py-1.5 text-xs xl:hidden">
          <span class="min-w-0 flex-1">좌우로 이동해 출고예정·운송장·입고일과 처리 버튼을 확인하세요.</span>
          <Button variant="outline" size="icon-xs" aria-label="조달 선적 표 왼쪽으로 이동" @click="moveTable('shipment', -1)">
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-xs" aria-label="조달 선적 표 오른쪽으로 이동" @click="moveTable('shipment', 1)">
            <ChevronRightIcon />
          </Button>
        </div>
        <TableCard bare>
          <Table class="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>구매처</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>구분</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>출고예정</TableHead>
                <TableHead>운송장</TableHead>
                <TableHead>입고일</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in shipItems" :key="item.shipmentId">
                <TableCell class="font-medium">{{ item.partnerName }}</TableCell>
                <TableCell class="max-w-52">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <RouterLink
                      :to="smartbomCaseTo(item.quoteId, 'logistics')"
                      class="text-primary min-w-0 truncate hover:underline"
                      :title="item.quoteTitle"
                    >
                      {{ item.quoteTitle }}
                    </RouterLink>
                    <Badge v-if="item.groupPos.length > 1" variant="info">
                      <PackageIcon />
                      {{ item.groupPos.length }}건 묶음
                    </Badge>
                  </span>
                </TableCell>
                <TableCell class="text-muted-foreground text-xs">{{ BOM_SHIPMENT_MODE_LABELS[item.mode] }}</TableCell>
                <TableCell>
                  <span class="flex flex-wrap items-center gap-1">
                    <Badge :variant="bomShipmentRowBadge(item).variant">{{ bomShipmentRowBadge(item).label }}</Badge>
                    <Badge v-if="item.adminPending" variant="warning">처리 필요</Badge>
                    <Badge
                      v-if="item.caseRefPending"
                      variant="warning"
                      title="협력사가 샘플피씨비 운송의 발송 참조번호(Case ID)를 기다리고 있습니다."
                    >
                      Case ID 요청
                    </Badge>
                    <!-- 공급사 봉투 스캔 누적(D42) — 공급사 발주서만. 전량이면 완료, 초과면 문제 -->
                    <Badge
                      v-if="item.receiving !== null"
                      :variant="receivingScanVariant(item.receiving.scannedQty, item.receiving.orderedQty)"
                      title="공급사 봉투 라벨 스캔 누적 / 발주 수량"
                      data-testid="receiving-badge"
                    >
                      입고 스캔 {{ item.receiving.scannedQty }}/{{ item.receiving.orderedQty }}
                    </Badge>
                  </span>
                </TableCell>
                <TableCell class="text-muted-foreground tabular-nums">
                  {{ item.mode === 'international' ? fmtKstDate(item.shipDate) : '—' }}
                </TableCell>
                <TableCell class="text-muted-foreground text-xs">
                  <!-- 운송수단 — 해상은 리드타임이 항공과 자릿수로 다르다(08-16). 박제된 값이 있을 때만
                       (null 은 이 축 도입 전 발송이다). -->
                  <template v-if="item.transport !== null">{{ SHIPMENT_TRANSPORT_LABELS[item.transport] }} · </template>
                  <span v-if="item.trackingNumber !== null" class="font-mono">{{ item.carrier ?? '' }} {{ item.trackingNumber }}</span>
                  <template v-else>—</template>
                </TableCell>
                <TableCell class="text-muted-foreground tabular-nums">{{ fmtKstDate(item.receivedAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button :variant="item.adminPending ? 'default' : 'outline'" size="sm" @click="openShipment(item)">
                    {{ item.adminPending ? '처리' : '보기' }}
                  </Button>
                </TableCell>
              </TableRow>
              <TableEmptyRow
                v-if="shipItems.length === 0"
                :colspan="8"
                :loading="shipQuery.isFetching.value"
                text="해당 상태의 선적이 없습니다."
              />
            </TableBody>
          </Table>
        </TableCard>
      </div>
      <div class="border-t p-4">
        <ListPagination
          :page="shipFilters.page"
          :page-size="shipFilters.pageSize"
          :total="shipTotal"
          @update:page="(page: number) => (shipFilters = { ...shipFilters, page })"
        />
      </div>
    </SectionCard>

    <!-- ② 고객 배송 -->
    <SectionCard title="고객 배송 — 입고 끝난 주문 발송" flush>
      <div class="flex flex-col gap-3 p-4">
        <QueueTabs v-model="orderTab" :tabs="orderTabs" />
        <Alert v-if="actionError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ actionError }}</AlertDescription>
        </Alert>
        <Alert v-if="actionFeedback !== null" :variant="actionFeedback.tone" size="sm">
          <AlertDescription>{{ actionFeedback.text }}</AlertDescription>
        </Alert>
      </div>
      <div ref="orderTableScroll" class="border-t">
        <div class="text-muted-foreground flex items-center gap-2 border-b px-4 py-1.5 text-xs xl:hidden">
          <span class="min-w-0 flex-1">좌우로 이동해 배송지·입고 상태·주문 금액과 작업 버튼을 확인하세요.</span>
          <Button variant="outline" size="icon-xs" aria-label="고객 배송 표 왼쪽으로 이동" @click="moveTable('order', -1)">
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-xs" aria-label="고객 배송 표 오른쪽으로 이동" @click="moveTable('order', 1)">
            <ChevronRightIcon />
          </Button>
        </div>
        <TableCard bare>
          <Table class="min-w-[1120px]">
            <TableHeader>
              <TableRow>
                <TableHead>주문번호</TableHead>
                <TableHead>고객</TableHead>
                <TableHead class="min-w-64">받는 분 · 배송지</TableHead>
                <TableHead>연결 Case · 입고</TableHead>
                <TableHead class="text-right">주문 금액</TableHead>
                <TableHead>상태</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in orderItems" :key="item.odId">
                <TableCell class="text-muted-foreground font-mono text-xs">{{ item.odId }}</TableCell>
                <TableCell>
                  <p class="font-medium">{{ item.customerName || item.mbId }}</p>
                  <p class="text-muted-foreground text-xs">{{ item.customerEmail || '이메일 없음' }}</p>
                </TableCell>
                <TableCell class="min-w-64 text-xs">
                  <p class="font-semibold">{{ item.recipientName || '받는 분 미입력' }} · {{ item.recipientPhone || '연락처 없음' }}</p>
                  <p
                    class="text-muted-foreground mt-0.5 max-w-80 truncate"
                    :title="`${item.recipientZip === '' ? '' : `[${item.recipientZip}] `}${item.recipientAddress}`"
                  >
                    <template v-if="item.recipientZip !== ''">[{{ item.recipientZip }}] </template>{{ item.recipientAddress || '배송지 미입력' }}
                  </p>
                </TableCell>
                <TableCell>
                  <span class="flex flex-wrap gap-1">
                    <Button
                      v-for="entry in activeOrderCases(item)"
                      :key="`${entry.quoteId}-${String(entry.ctId)}`"
                      variant="outline"
                      size="xs"
                      as-child
                    >
                      <RouterLink :to="smartbomCaseTo(entry.quoteId, 'logistics')" :title="entry.title">
                        <span class="max-w-40 truncate">{{ entry.title }}</span>
                        <Badge :variant="orderCaseBadge(entry).variant">{{ orderCaseBadge(entry).label }}</Badge>
                      </RouterLink>
                    </Button>
                  </span>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ smartbomFmtWon(item.orderPrice) }}</TableCell>
                <TableCell>
                  <Badge :variant="shipStateBadge(item).variant">{{ shipStateBadge(item).label }}</Badge>
                </TableCell>
                <TableCell class="text-right">
                  <Button v-if="orderTab === 'to_ship'" size="sm" @click="openShip(item)">배송 처리</Button>
                  <Button v-else size="sm" :disabled="completeMut.isPending.value" @click="void completeOrder(item)">
                    구매확정
                  </Button>
                </TableCell>
              </TableRow>
              <TableEmptyRow
                v-if="orderItems.length === 0"
                :colspan="7"
                :loading="orderQuery.isFetching.value"
                text="해당 상태의 주문이 없습니다."
              />
            </TableBody>
          </Table>
        </TableCard>
      </div>
      <div class="border-t p-4">
        <ListPagination
          :page="orderFilters.page"
          :page-size="orderFilters.pageSize"
          :total="orderTotal"
          @update:page="(page: number) => (orderFilters = { ...orderFilters, page })"
        />
      </div>
    </SectionCard>

    <!-- 선적 처리(Case 상세와 같은 대화상자) -->
    <ShipmentDialog
      :open="selected !== null && selectedPo !== null"
      :quote-id="selectedQuoteId ?? ''"
      :po="selectedPo"
      @close="selected = null"
    />
    <!-- 배송 처리(D21-3) — 운송장 입력 → 준비(필요 시)→배송 전이 -->
    <CustomerShipDialog :item="shipTarget" @close="shipTarget = null" @done="onShipped" />
  </div>
</template>
