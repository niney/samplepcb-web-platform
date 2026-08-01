<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type AdminBomOrderListItemType,
  type AdminBomShipmentCrossItemType,
} from '@sp/api-contract';
import {
  useAdminBomOrders,
  useCompleteBomOrder,
  useShipBomOrder,
  type AdminBomOrderFilters,
} from '../../admin/useAdminBomOrders';
import {
  useAdminBomPos,
  useAdminBomShipmentCross,
  type AdminBomShipmentCrossFilters,
} from '../../admin/useAdminBomPos';
import { nowLocalDateTime, toG5DateTime } from '../../admin/useAdminOrders';
import { smartbomFmtWon } from '../../admin/smartbom';
import UiPagination from '../../components/ui/UiPagination.vue';
import BomShipmentModal from '../../components/admin/smartbom/BomShipmentModal.vue';

// 선적·배송 워크큐(관리자 메뉴 재편) — 물류 담당의 화면. 흐름이 위→아래로 이어진다:
// ① 협력사 선적(내 차례→진행 중→입고 완료, D22 핑퐁) → ② 입고 끝난 주문을 고객에게
// 발송(배송 처리·구매확정 — 주문·결제 화면에서 이동해 온 D21-3 액션).

const router = useRouter();

// ── ① 협력사 선적 — 횡단 목록 + BomShipmentModal(대표 발주서 경유) ───────────
const shipFilters = ref<AdminBomShipmentCrossFilters>({ page: 1, pageSize: 20, tab: 'admin_pending' });
const shipQuery = useAdminBomShipmentCross(shipFilters);
const shipItems = computed(() => shipQuery.data.value?.data.items ?? []);
const shipTotal = computed(() => shipQuery.data.value?.data.total ?? 0);
const shipCounts = computed(() => shipQuery.data.value?.data.counts ?? null);

const SHIP_TABS = [
  { key: 'admin_pending', label: '내 차례' },
  { key: 'active', label: '진행 중' },
  { key: 'received', label: '입고 완료' },
] as const;

const shipTabCount = (key: (typeof SHIP_TABS)[number]['key']): number | null => {
  if (shipCounts.value === null) return null;
  return key === 'admin_pending'
    ? shipCounts.value.adminPending
    : key === 'active'
      ? shipCounts.value.active
      : shipCounts.value.received;
};

// 선적 처리 = 기존 Case 상세의 선적 모달 재사용 — 대표 발주서(quoteId+poId)로 연다.
const selected = ref<{ quoteId: string; poId: number } | null>(null);
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

// from=logistics — Case 상세가 발주(선적 진입점) 섹션만 펼치고 스크롤(§6.12)
function openCase(quoteId: string): void {
  void router.push({
    name: 'admin-smartbom-case',
    params: { id: quoteId },
    query: { from: 'logistics' },
  });
}

const fmtDate = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));

// ── ② 고객 배송 — 주문 축(to_ship=배송 처리 대기 / shipping=배송 중) ─────────
const orderFilters = ref<AdminBomOrderFilters>({ page: 1, pageSize: 20, tab: 'to_ship' });
const orderQuery = useAdminBomOrders(orderFilters);
const orderItems = computed(() => orderQuery.data.value?.data.items ?? []);
const orderTotal = computed(() => orderQuery.data.value?.data.total ?? 0);

const ORDER_TABS = [
  { key: 'to_ship', label: '배송 처리 대기' },
  { key: 'shipping', label: '배송 중' },
] as const;

const orderTabCount = (key: (typeof ORDER_TABS)[number]['key']): number | null => {
  const counts = orderQuery.data.value?.data.counts ?? null;
  if (counts === null) return null;
  return key === 'to_ship' ? counts.toShip : counts.shipping;
};

// 연결 Case 전 발주 입고 완료 여부 — 미입고 배송 시 확인 경고에 사용.
const allReceived = (item: AdminBomOrderListItemType): boolean =>
  item.cases.every((c) => c.poCount > 0 && c.poReceivedCount >= c.poCount);

const actionError = ref('');

// 배송 처리(D21-3) — 운송장 입력 → force-status '배송'(부품 주문은 제작 단계 생략)
const shipMut = useShipBomOrder();
const completeMut = useCompleteBomOrder();
const shipTarget = ref<AdminBomOrderListItemType | null>(null);
const shipCompany = ref('');
const shipInvoiceNo = ref('');
const shipInvoiceTime = ref('');
const shipError = ref('');

function openShip(item: AdminBomOrderListItemType): void {
  shipTarget.value = item;
  shipCompany.value = '';
  shipInvoiceNo.value = '';
  shipInvoiceTime.value = nowLocalDateTime();
  shipError.value = '';
}

async function submitShip(): Promise<void> {
  const item = shipTarget.value;
  if (item === null) return;
  shipError.value = '';
  if (shipCompany.value.trim() === '' || shipInvoiceNo.value.trim() === '') {
    shipError.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  if (
    !allReceived(item) &&
    !window.confirm('아직 입고 확인되지 않은 발주가 있습니다. 그래도 배송 처리할까요?')
  ) {
    return;
  }
  try {
    await shipMut.mutateAsync({
      odId: item.odId,
      delivery: {
        deliveryCompany: shipCompany.value.trim(),
        invoiceNo: shipInvoiceNo.value.trim(),
        invoiceTime: toG5DateTime(shipInvoiceTime.value),
      },
    });
    shipTarget.value = null;
  } catch (e) {
    shipError.value = e instanceof ApiRequestError ? e.message : '배송 처리에 실패했습니다.';
  }
}

async function completeOrder(item: AdminBomOrderListItemType): Promise<void> {
  if (!window.confirm(`주문 ${item.odId} 을 구매확정(완료) 처리할까요?`)) return;
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '구매확정에 실패했습니다.';
  }
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold">선적·배송</h1>

    <!-- ① 협력사 선적 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-700">협력사 선적 — 입고까지</h2>
      <div class="flex flex-wrap gap-1 border-b border-gray-200">
        <button
          v-for="entry in SHIP_TABS"
          :key="entry.key"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="shipFilters.tab === entry.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="shipFilters = { ...shipFilters, tab: entry.key, page: 1 }"
        >
          {{ entry.label }}
          <span v-if="shipTabCount(entry.key) !== null" class="ml-0.5 text-xs opacity-60">{{ shipTabCount(entry.key) }}</span>
        </button>
      </div>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2.5">협력사</th>
              <th class="px-4 py-2.5">Case</th>
              <th class="whitespace-nowrap px-4 py-2.5">구분</th>
              <th class="px-4 py-2.5">상태</th>
              <th class="whitespace-nowrap px-4 py-2.5">출고예정</th>
              <th class="px-4 py-2.5">운송장</th>
              <th class="whitespace-nowrap px-4 py-2.5">입고일</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="item in shipItems"
              :key="item.shipmentId"
              class="hover:bg-blue-50/30"
              :class="item.adminPending ? 'bg-amber-50/40' : ''"
            >
              <td class="px-4 py-2.5 font-medium text-gray-800">{{ item.partnerName }}</td>
              <td class="max-w-52 px-4 py-2.5">
                <button
                  type="button"
                  class="max-w-full truncate text-left text-blue-700 hover:underline"
                  :title="item.quoteTitle"
                  @click="openCase(item.quoteId)"
                >
                  {{ item.quoteTitle }}
                </button>
                <span v-if="item.groupPos.length > 1" class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                  📦 {{ item.groupPos.length }}건 묶음
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">{{ BOM_SHIPMENT_MODE_LABELS[item.mode] }}</td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="item.receivedAt !== null ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'">
                  {{ item.receivedAt !== null ? '입고 완료' : bomShipmentStatusLabel(item.mode, item.status) }}
                </span>
                <span v-if="item.adminPending" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">처리 필요</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(item.shipDate) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                <template v-if="item.trackingNumber !== null">{{ item.carrier ?? '' }} {{ item.trackingNumber }}</template>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(item.receivedAt) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-xs font-semibold"
                  :class="item.adminPending ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'"
                  @click="openShipment(item)"
                >
                  {{ item.adminPending ? '처리' : '보기' }}
                </button>
              </td>
            </tr>
            <tr v-if="shipItems.length === 0">
              <td colspan="8" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ shipQuery.isFetching.value ? '불러오는 중…' : '해당 상태의 선적이 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">총 {{ shipTotal }}건</p>
        <UiPagination
          :page="shipFilters.page"
          :page-size="shipFilters.pageSize"
          :total="shipTotal"
          @update:page="(p) => (shipFilters = { ...shipFilters, page: p })"
        />
      </div>
    </section>

    <!-- ② 고객 배송 -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-700">고객 배송 — 입고 끝난 주문 발송</h2>
      <div class="flex flex-wrap gap-1 border-b border-gray-200">
        <button
          v-for="entry in ORDER_TABS"
          :key="entry.key"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="orderFilters.tab === entry.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="orderFilters = { ...orderFilters, tab: entry.key, page: 1 }"
        >
          {{ entry.label }}
          <span v-if="orderTabCount(entry.key) !== null" class="ml-0.5 text-xs opacity-60">{{ orderTabCount(entry.key) }}</span>
        </button>
      </div>

      <p v-if="actionError !== ''" class="text-xs font-semibold text-red-600">{{ actionError }}</p>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">주문번호</th>
              <th class="px-4 py-2.5">고객</th>
              <th class="px-4 py-2.5">연결 Case · 입고</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">주문 금액</th>
              <th class="px-4 py-2.5">상태</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="item in orderItems" :key="item.odId" class="hover:bg-blue-50/30">
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{{ item.odId }}</td>
              <td class="px-4 py-2.5 text-gray-600">{{ item.mbId }}</td>
              <td class="px-4 py-2.5">
                <button
                  v-for="entry in item.cases"
                  :key="entry.quoteId"
                  type="button"
                  class="mb-0.5 mr-1 rounded-full border border-blue-200 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                  :title="entry.title"
                  @click="openCase(entry.quoteId)"
                >
                  <span class="max-w-40 truncate align-middle">{{ entry.title }}</span>
                  <span v-if="entry.poCount > 0 && entry.poReceivedCount >= entry.poCount" class="ml-1 rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-700">입고 완료</span>
                  <span v-else class="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">입고 {{ entry.poReceivedCount }}/{{ entry.poCount }}</span>
                </button>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{{ smartbomFmtWon(item.cartPrice) }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="item.odStatus === '배송' ? 'bg-blue-100 text-blue-700' : allReceived(item) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
                  {{ item.odStatus === '배송' ? '배송 중' : allReceived(item) ? '발송 가능' : '입고 대기' }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  v-if="orderFilters.tab === 'to_ship'"
                  type="button"
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                  :disabled="shipMut.isPending.value"
                  @click="openShip(item)"
                >
                  배송 처리
                </button>
                <button
                  v-else
                  type="button"
                  class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  :disabled="completeMut.isPending.value"
                  @click="completeOrder(item)"
                >
                  구매확정
                </button>
              </td>
            </tr>
            <tr v-if="orderItems.length === 0">
              <td colspan="6" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ orderQuery.isFetching.value ? '불러오는 중…' : '해당 상태의 주문이 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">총 {{ orderTotal }}건</p>
        <UiPagination
          :page="orderFilters.page"
          :page-size="orderFilters.pageSize"
          :total="orderTotal"
          @update:page="(p) => (orderFilters = { ...orderFilters, page: p })"
        />
      </div>
    </section>

    <!-- 선적 처리 모달(Case 상세와 동일 컴포넌트 재사용) -->
    <BomShipmentModal
      :open="selected !== null && selectedPo !== null"
      :quote-id="selectedQuoteId ?? ''"
      :po="selectedPo"
      @close="selected = null"
    />

    <!-- 배송 처리 다이얼로그(D21-3) — 운송장 입력 → 준비(필요 시)→배송 전이 -->
    <div
      v-if="shipTarget !== null"
      class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
      @click.self="shipTarget = null"
    >
      <div class="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">배송 처리 — {{ shipTarget.odId }}</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="shipTarget = null">✕</button>
        </div>
        <p v-if="!allReceived(shipTarget)" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          입고 확인이 끝나지 않은 발주가 있습니다 — 검수 후 발송을 권장합니다.
        </p>
        <div class="mt-3 grid gap-2 text-xs">
          <label class="text-gray-500">택배사
            <input v-model="shipCompany" type="text" maxlength="50" placeholder="예: CJ대한통운" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2">
          </label>
          <label class="text-gray-500">송장번호
            <input v-model="shipInvoiceNo" type="text" maxlength="100" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 font-mono">
          </label>
          <label class="text-gray-500">발송일시
            <input v-model="shipInvoiceTime" type="datetime-local" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2">
          </label>
          <p class="text-[11px] text-gray-400">
            알림 메일은 발송되지 않습니다 — 배송 안내가 필요하면 통합 주문내역에서 처리해 주세요.
          </p>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="shipTarget = null">
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="shipMut.isPending.value"
            @click="submitShip"
          >
            배송 처리
          </button>
        </div>
        <p v-if="shipError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ shipError }}</p>
      </div>
    </div>
  </div>
</template>
