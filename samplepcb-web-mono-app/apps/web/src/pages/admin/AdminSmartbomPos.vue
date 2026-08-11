<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BOM_PO_STATUS_LABELS,
  bomShipmentStatusLabel,
  type AdminBomPoCrossItemType,
} from '@sp/api-contract';
import { useAdminBomOrders, type AdminBomOrderFilters } from '../../admin/useAdminBomOrders';
import { useAdminBomPoCross, type AdminBomPoCrossFilters } from '../../admin/useAdminBomPos';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { smartbomFmtWon } from '../../admin/smartbom';
import UiPagination from '../../components/ui/UiPagination.vue';

// 발주 워크큐(관리자 메뉴 재편) — 구매 담당의 화면. 큐 흐름:
// 발주 대기(결제 완료+미발주, 주문 축) → 확인 대기(issued) → 진행 중(confirmed) → 마감.
// 발주서 발행·상세 조작은 Case 상세(발주 패널)가 전담 — 여기선 큐와 진입만.

const router = useRouter();

type TabKey = 'awaiting' | 'issued' | 'confirmed' | 'closed';
const tab = ref<TabKey>('awaiting');

// 발주 대기 = 주문 축(paid_unissued — PO 가 아직 없어 주문으로 센다)
const orderFilters = ref<AdminBomOrderFilters>({ page: 1, pageSize: 20, tab: 'paid_unissued' });
const orderQuery = useAdminBomOrders(orderFilters);
const awaitingItems = computed(() => orderQuery.data.value?.data.items ?? []);
const awaitingTotal = computed(() => orderQuery.data.value?.data.total ?? 0);

// 확인 대기/진행 중/마감 = 발주서 축(횡단 목록)
const poFilters = ref<AdminBomPoCrossFilters>({ page: 1, pageSize: 20, tab: 'issued' });
const poQuery = useAdminBomPoCross(poFilters);
const poItems = computed(() => poQuery.data.value?.data.items ?? []);
const poTotal = computed(() => poQuery.data.value?.data.total ?? 0);
const poCounts = computed(() => poQuery.data.value?.data.counts ?? null);

const TABS: { key: TabKey; label: string }[] = [
  { key: 'awaiting', label: '발주 대기' },
  { key: 'issued', label: '확인 대기' },
  { key: 'confirmed', label: '진행 중' },
  { key: 'closed', label: '마감' },
];

const tabCount = (key: TabKey): number | null => {
  if (key === 'awaiting') {
    const counts = orderQuery.data.value?.data.counts ?? null;
    return counts === null ? null : counts.paidUnissued;
  }
  return poCounts.value === null ? null : poCounts.value[key];
};

function setTab(key: TabKey): void {
  tab.value = key;
  if (key === 'awaiting') {
    orderFilters.value = { ...orderFilters.value, page: 1 };
  } else {
    poFilters.value = { ...poFilters.value, tab: key, page: 1 };
  }
}

// 발행·조작은 Case 상세 발주 패널로 — from=pos 는 발주 섹션만 펼치고 스크롤(§6.12)
function openCasePo(quoteId: string): void {
  void router.push({
    name: 'admin-smartbom-case',
    params: { id: quoteId },
    query: { from: 'pos' },
  });
}

const statusCls = (status: AdminBomPoCrossItemType['status']): string =>
  status === 'issued'
    ? 'bg-blue-100 text-blue-700'
    : status === 'confirmed'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-gray-200 text-gray-600';

const statusLabel = (item: AdminBomPoCrossItemType): string => {
  if (item.supplierCode === null) return BOM_PO_STATUS_LABELS[item.status];
  if (item.status === 'issued') return '구매 확인 대기';
  if (item.status === 'confirmed') return '구매 완료';
  return BOM_PO_STATUS_LABELS[item.status];
};

const shipmentBadge = (item: AdminBomPoCrossItemType): string | null => {
  if (item.shipment === null) return null;
  if (item.shipment.receivedAt !== null) return '입고 완료';
  return bomShipmentStatusLabel(item.shipment.mode, item.shipment.status);
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">발주</h1>

    <!-- 워크큐 탭 -->
    <div class="flex flex-wrap gap-1 border-b border-gray-200">
      <button
        v-for="entry in TABS"
        :key="entry.key"
        type="button"
        class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
        :class="tab === entry.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
        @click="setTab(entry.key)"
      >
        {{ entry.label }}
        <span v-if="tabCount(entry.key) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(entry.key) }}</span>
      </button>
    </div>

    <!-- 발주 대기 — 결제 완료 주문의 미발주 Case (주문 축) -->
    <template v-if="tab === 'awaiting'">
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">주문번호</th>
              <th class="px-4 py-2.5">고객</th>
              <th class="px-4 py-2.5">Case</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">주문 금액</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="item in awaitingItems" :key="item.odId" class="hover:bg-blue-50/30">
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{{ item.odId }}</td>
              <td class="px-4 py-2.5 text-gray-600">{{ item.mbId }}</td>
              <td class="px-4 py-2.5">
                <button
                  v-for="entry in item.cases"
                  :key="entry.quoteId"
                  type="button"
                  class="mb-0.5 mr-1 rounded-full border px-2 py-0.5 text-xs hover:bg-blue-50"
                  :class="entry.poCount === 0 ? 'border-amber-300 text-amber-700' : 'border-blue-200 text-blue-700'"
                  :title="entry.title"
                  @click="openCasePo(entry.quoteId)"
                >
                  <span class="max-w-40 truncate align-middle">{{ entry.title }}</span>
                  <span v-if="entry.poCount === 0" class="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">발주 전</span>
                </button>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{{ smartbomFmtWon(item.cartPrice) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  v-if="item.cases.length > 0"
                  type="button"
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                  @click="openCasePo(item.cases.find((c) => c.poCount === 0)?.quoteId ?? item.cases[0]!.quoteId)"
                >
                  발주하기 →
                </button>
              </td>
            </tr>
            <tr v-if="awaitingItems.length === 0">
              <td colspan="5" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ orderQuery.isFetching.value ? '불러오는 중…' : '발주 대기 주문이 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">총 {{ awaitingTotal }}건</p>
        <UiPagination
          :page="orderFilters.page"
          :page-size="orderFilters.pageSize"
          :total="awaitingTotal"
          @update:page="(p) => (orderFilters = { ...orderFilters, page: p })"
        />
      </div>
    </template>

    <!-- 확인 대기/진행 중/마감 — 발주서 축(횡단) -->
    <template v-else>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">발주번호</th>
              <th class="px-4 py-2.5">Case</th>
              <th class="px-4 py-2.5">구매처</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">품목</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">발주 금액</th>
              <th class="whitespace-nowrap px-4 py-2.5">발행일</th>
              <th class="whitespace-nowrap px-4 py-2.5">확인일</th>
              <th class="px-4 py-2.5">상태</th>
              <th class="px-4 py-2.5">선적</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="item in poItems"
              :key="item.poId"
              class="cursor-pointer hover:bg-blue-50/30"
              @click="openCasePo(item.quoteId)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">PO-{{ item.poId }}</td>
              <td class="max-w-52 truncate px-4 py-2.5 text-gray-800" :title="item.quoteTitle">{{ item.quoteTitle }}</td>
              <td class="px-4 py-2.5 text-gray-600">
                {{ item.partnerName }}
                <span v-if="item.supplierCode !== null" class="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">공급사</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{{ item.itemCount }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{{ smartbomFmtWon(item.totalAmount) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(item.issuedAt) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(item.confirmedAt) }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(item.status)">
                  {{ statusLabel(item) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span
                  v-if="shipmentBadge(item) !== null"
                  class="rounded px-1.5 py-0.5 text-xs font-semibold"
                  :class="item.shipment?.receivedAt !== null ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'"
                >
                  {{ shipmentBadge(item) }}
                </span>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
            </tr>
            <tr v-if="poItems.length === 0">
              <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ poQuery.isFetching.value ? '불러오는 중…' : '해당 상태의 발주서가 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">총 {{ poTotal }}건</p>
        <UiPagination
          :page="poFilters.page"
          :page-size="poFilters.pageSize"
          :total="poTotal"
          @update:page="(p) => (poFilters = { ...poFilters, page: p })"
        />
      </div>
    </template>
  </div>
</template>
