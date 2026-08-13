<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PO_STATUS_LABELS,
  type AdminPcbOrderItemType,
  type AdminPcbShipmentTabType,
} from '@sp/api-contract';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '../../lib/pcb-shipment-label';
import {
  adminPcbPackageApi,
  useAdminPcbPoWork,
  useAdminPcbShipmentWork,
  type AdminPcbPoWorkFilters,
  type AdminPcbShipmentFilters,
} from '../../admin/useAdminPcbPos';
import {
  useAdminPcbOrderWork,
  usePcbCompleteCustomerOrder,
  type AdminPcbOrderFilters,
} from '../../admin/useAdminPcbOrders';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';
import PcbCustomerShipModal from '../../components/admin/pcb/PcbCustomerShipModal.vue';
import PcbPackageLabelsModal from '../../components/pcb/PcbPackageLabelsModal.vue';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { fmtPcbAmount } from '../../lib/pcb-money';
import { confirmDialog } from '../../lib/confirmDialog';

// PCB 선적·배송 워크큐(P3·P4.6) — 물류 담당의 화면. SmartBOM 물류와 같은 두 섹션 골격
// (D9 미러 — 흐름이 위→아래로 이어진다):
//   ① 협력사 선적(협력사 → 자사·MD): 발송 대기(생산완료·미편성 — 발주서 축) →
//      입고·처리 대기(내 차례) → 이동 중 → 입고 완료 — 선적 축.
//   ② 고객 배송(자사 → 고객): 배송 처리 대기 → 배송 중 — 주문 축.
// 축이 세 번 바뀌는 이유: 발송 문서가 생기기 전 건은 선적 축 모수에 없고(발주서 축),
// 입고확인은 협력 축의 종점이라 그 다음 일(고객 발송)은 od 를 모수로 잡아야 보인다.
// 방향이 뒤집히는 지점(자사 → 고객)만 섹션 경계다 — 두 상태를 동시에 조감해야
// "들어오는 것"과 "나갈 것"이 한눈에 잡힌다. 협력 축 조작(전이/입고확인/송장)은
// Case 상세, 고객 발송·구매확정만 여기서 바로 처리한다.

type ShipTabKey = AdminPcbShipmentTabType | 'to_ship';

const router = useRouter();
const tab = ref<ShipTabKey>('to_ship');
const filters = ref<AdminPcbShipmentFilters>({ page: 1, pageSize: 20, tab: 'pending', q: '' });
const list = useAdminPcbShipmentWork(filters);

// 발송 대기 = 발주서 축(produced·미편성) — 선적 문서가 아직 없으니 PO 워크큐에서 가져온다.
const poFilters = ref<AdminPcbPoWorkFilters>({
  page: 1,
  pageSize: 20,
  tab: 'to_ship',
  q: '',
  deliveryFrom: '',
  deliveryTo: '',
});
const poQuery = useAdminPcbPoWork(poFilters);
const toShipRows = computed(() => poQuery.data.value?.data.items ?? []);
const toShipTotal = computed(() => poQuery.data.value?.data.total ?? 0);
const toShipPages = computed(() => Math.max(1, Math.ceil(toShipTotal.value / poFilters.value.pageSize)));

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
// 행은 구성원(발주) 단위로 펼치므로 총계는 "박스 N · 발주 M"으로 병기한다.
const poTotal = computed(() => list.data.value?.data.poTotal ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));
const labelShipmentId = ref<number | null>(null);
const labelsApi = computed(() =>
  labelShipmentId.value === null ? null : adminPcbPackageApi(labelShipmentId.value),
);

// 검색 — 두 축(발주서 축 to_ship · 선적 축 나머지 탭) 모두에 같은 검색어를 태운다.
// 탭을 오가며 같은 건을 찾는 화면이라 입력을 하나만 둔다(제출 시 적용 — 발주 큐와 동형).
const searchText = ref('');
const applySearch = (): void => {
  poFilters.value = { ...poFilters.value, q: searchText.value, page: 1 };
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

const TABS: { key: ShipTabKey; label: string }[] = [
  { key: 'to_ship', label: '발송 대기' },
  { key: 'pending', label: '입고·처리 대기' },
  { key: 'active', label: '이동 중' },
  { key: 'received', label: '입고 완료' },
  { key: 'all', label: '전체' },
];
const tabCount = (key: ShipTabKey): number | null =>
  key === 'to_ship'
    ? (poQuery.data.value?.data.counts.to_ship ?? null)
    : counts.value === null
      ? null
      : counts.value[key];
const setTab = (key: ShipTabKey): void => {
  tab.value = key;
  if (key !== 'to_ship') filters.value = { ...filters.value, tab: key, page: 1 };
};

// ── ② 고객 배송 — 주문 축(P4.6): 입고확인이 끝났는데 od 가 배송 전(to_ship)·배송 중.
//    판정·counts 는 서버(/admin/pcb-orders — 협력 축 입고 신호 기반, 이관분 자연 제외).
const orderFilters = ref<AdminPcbOrderFilters>({ page: 1, pageSize: 20, tab: 'to_ship', q: '' });
const orderQuery = useAdminPcbOrderWork(orderFilters);
const orderRows = computed(() => orderQuery.data.value?.data.items ?? []);
const orderTotal = computed(() => orderQuery.data.value?.data.total ?? 0);
const orderPages = computed(() =>
  Math.max(1, Math.ceil(orderTotal.value / orderFilters.value.pageSize)),
);

const ORDER_TABS = [
  { key: 'to_ship', label: '배송 처리 대기' },
  { key: 'shipping', label: '배송 중' },
] as const;
type OrderTabKey = (typeof ORDER_TABS)[number]['key'];
const orderTab = computed(() => orderFilters.value.tab);
const orderTabCount = (key: OrderTabKey): number | null => {
  const c = orderQuery.data.value?.data.counts ?? null;
  if (c === null) return null;
  return key === 'to_ship' ? c.toShip : c.shipping;
};
const setOrderTab = (key: OrderTabKey): void => {
  orderFilters.value = { ...orderFilters.value, tab: key, page: 1 };
};

// 고객 배송 액션 — 배송 처리(공용 모달)·구매확정
const allReceived = (item: AdminPcbOrderItemType): boolean =>
  item.poCount > 0 && item.receivedPoCount >= item.poCount;

const shipOdId = ref<string | null>(null);
const shipIncomplete = ref(false);
// 모달이 "어느 고객 건인지"를 말할 수 있게 행에서 같이 넘긴다(주문번호만으론 확인 불가).
const shipCustomerLabel = ref('');
const shipProjectName = ref('');
function openShip(item: AdminPcbOrderItemType): void {
  shipOdId.value = item.odId;
  shipIncomplete.value = !allReceived(item);
  shipCustomerLabel.value =
    item.customerName !== ''
      ? `${item.customerName} (${item.mbId ?? '비회원'})`
      : (item.mbId ?? '비회원');
  shipProjectName.value = item.projectName;
}

const completeMut = usePcbCompleteCustomerOrder();
const actionError = ref('');
async function completeOrder(item: AdminPcbOrderItemType): Promise<void> {
  if (!(await confirmDialog(`주문 ${item.odId} 을 구매확정(완료) 처리할까요?`))) return;
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '구매확정에 실패했습니다.';
  }
}

// [직송 완료](정책 확정 08-10) — 직송 건은 실물이 자사를 안 거쳐 관리자가 보낼 것이
// 없는데, od 종결 창구는 이 큐뿐이다. 그래서 큐에 남기되 운송장 입력 없이 코어
// force-status '완료'(구매확정과 같은 전이 — 재고 앵커는 완료 진입 차감이라 보존)로 닫는다.
async function completeDirectOrder(item: AdminPcbOrderItemType): Promise<void> {
  if (item.directShipCountry === null) return;
  if (
    !(await confirmDialog(
      `직송 건 — 고객이 현지(${item.directShipCountry})에서 수령했습니다. 주문을 완료로 종결합니다.`,
    ))
  ) {
    return;
  }
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '직송 완료 처리에 실패했습니다.';
  }
}

const STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

function openCase(specId: number): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: { from: 'shipments' },
  });
}
</script>

<template>
  <div class="pcb-readable space-y-6">
    <h1 class="text-xl font-bold">PCB 선적·배송</h1>

    <!-- ① 협력사 선적 — 협력사 발송 → 자사·MD 입고(발주서 축 + 선적 축) -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-700">협력사 선적 — 협력사 발송 → 자사 입고</h2>
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
        <div class="flex flex-wrap gap-1">
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
        <!-- 검색 — 묶음의 동반 건(다른 고객)까지 서버가 구성원 필드로 맞춰 준다. -->
        <form class="pb-1" @submit.prevent="applySearch">
          <input
            v-model="searchText"
            type="search"
            placeholder="고객·프로젝트·PO·운송장 검색"
            class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
        </form>
      </div>

      <!-- 발송 대기 — 생산완료인데 발송 문서가 아직 없는 발주서(선적 축 밖의 모수) -->
      <template v-if="tab === 'to_ship'">
        <p class="text-sm text-gray-500">
          생산이 끝났는데 아직 발송이 시작되지 않은 발주서입니다 — 발송 생성은 협력사 포털이
          원칙이고, 관리자는 Case 상세에서 대행할 수 있습니다.
        </p>
        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="whitespace-nowrap px-4 py-2.5">발주</th>
                <th class="px-4 py-2.5">프로젝트</th>
                <th class="px-4 py-2.5">고객명</th>
                <th class="px-4 py-2.5">협력사</th>
                <th class="whitespace-nowrap px-4 py-2.5">상태</th>
                <th class="whitespace-nowrap px-4 py-2.5">납기</th>
                <th class="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="row in toShipRows"
                :key="row.poId"
                class="cursor-pointer bg-amber-50/40 hover:bg-amber-50"
                @click="openCase(row.specId)"
              >
                <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">PO-{{ row.poId }}</td>
                <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                  <span class="font-mono text-xs text-gray-400">Q{{ row.specId }}</span>
                  {{ row.projectName }}
                </td>
                <td class="px-4 py-2.5 text-gray-600">
                  <PcbCustomerCell :name="row.customerName" :mb-id="row.mbId" />
                </td>
                <td class="px-4 py-2.5 text-gray-600">
                  {{ row.partnerName }}
                  <span v-if="row.parentPartnerName !== null" class="ml-1 text-xs text-indigo-500">
                    (MD {{ row.parentPartnerName }})
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {{ PCB_PO_STATUS_LABELS[row.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-gray-500">{{ fmtDate(row.deliveryDate) }}</td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right">
                  <button
                    type="button"
                    class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700"
                    @click.stop="openCase(row.specId)"
                  >
                    발송 관리 →
                  </button>
                </td>
              </tr>
              <tr v-if="toShipRows.length === 0">
                <td colspan="7" class="px-4 py-10 text-center text-sm text-gray-400">
                  {{ poQuery.isFetching.value ? '불러오는 중…' : '발송 대기 발주서가 없습니다.' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between text-sm">
          <p class="text-gray-500">총 {{ toShipTotal }}건</p>
          <div v-if="toShipPages > 1" class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
              :disabled="poFilters.page <= 1"
              @click="poFilters = { ...poFilters, page: poFilters.page - 1 }"
            >
              이전
            </button>
            <span class="text-gray-500">{{ poFilters.page }} / {{ toShipPages }}</span>
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
              :disabled="poFilters.page >= toShipPages"
              @click="poFilters = { ...poFilters, page: poFilters.page + 1 }"
            >
              다음
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="whitespace-nowrap px-4 py-2.5">발송</th>
                <th class="px-4 py-2.5">프로젝트</th>
                <th class="px-4 py-2.5">고객명</th>
                <th class="px-4 py-2.5">보내는 곳 → 받는 곳</th>
                <th class="whitespace-nowrap px-4 py-2.5">구분</th>
                <th class="whitespace-nowrap px-4 py-2.5">상태</th>
                <th class="whitespace-nowrap px-4 py-2.5">입고</th>
                <th class="whitespace-nowrap px-4 py-2.5">생성일</th>
                <th class="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <!-- 박스 1개 = 구성원 행 N개(여정 9호 후속 — 다중 고객 묶음의 동반 건도
                   1급 행으로). 물리 사실(운송장·상태·입고 — 박스당 한 번의 사건)은
                   rowspan 셀로 한 번만 서고, "무엇이·누구 것인지"(프로젝트·고객·Case)는
                   구성원마다 한 줄씩 선다. 구성원 경계선이 rowspan 열엔 안 그어져
                   그룹이 눈에 잡힌다. 액션이 행마다 늘지 않는 이유: 이 표의 액션은
                   내비게이션뿐이고, 전이·입고확인은 Case 상세가 박스 단위로 다룬다. -->
              <template v-for="row in rows" :key="row.shipmentId">
                <tr
                  v-for="(m, mi) in row.members"
                  :key="`${String(row.shipmentId)}-${String(m.poId)}`"
                  class="cursor-pointer hover:bg-blue-50/40"
                  :class="row.adminTurn ? 'bg-amber-50/50' : ''"
                  @click="openCase(m.specId)"
                >
                  <td
                    v-if="mi === 0"
                    :rowspan="row.members.length"
                    class="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-gray-500"
                  >
                    SH-{{ row.shipmentId }}
                    <span v-if="row.poCount > 1" class="ml-1 rounded bg-indigo-100 px-1 font-sans text-[11px] font-semibold text-indigo-700">묶음 {{ row.poCount }}</span>
                    <span v-if="row.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 font-sans text-[11px] font-semibold text-rose-700">{{ row.reorderRound }}차</span>
                    <span v-if="row.trackingNumber !== null" class="mt-0.5 block text-[11px] text-gray-400">
                      {{ row.carrier ?? '' }} {{ row.trackingNumber }}
                    </span>
                    <button
                      type="button"
                      class="mt-2 block rounded-md border border-teal-200 bg-teal-50 px-2 py-1 font-sans text-[11px] font-bold text-teal-700 hover:bg-teal-100"
                      @click.stop="labelShipmentId = row.shipmentId"
                    >
                      ▦ QR 라벨 {{ row.poCount }}장
                    </button>
                  </td>
                  <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                    <span class="font-mono text-xs text-gray-400">Q{{ m.specId }}</span>
                    {{ m.projectName }}
                  </td>
                  <!-- 송장·입고를 다루는 사람이 읽는 열 — 묶음이면 회원이 다른 줄이
                       나란히 선다(주문자명 정본 — 서버 lib/pcb-customer). -->
                  <td class="px-4 py-2.5 text-gray-600">
                    <PcbCustomerCell :name="m.customerName" :mb-id="m.mbId" />
                  </td>
                  <td v-if="mi === 0" :rowspan="row.members.length" class="px-4 py-2.5 align-top text-gray-600">
                    {{ row.senderName }} → {{ row.receiverName }}
                    <span v-if="row.receiverKind === 'md'" class="ml-1 text-xs text-indigo-500">(MD 입고)</span>
                    <!-- 직송(D5) — 받는 곳이 자사여도 실물은 이 나라의 고객에게 간다 -->
                    <span
                      v-if="row.destinationCountry !== null"
                      class="ml-1 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700"
                      title="직송 — 실물은 자사 입고 없이 주문지로 갑니다"
                    >직송 {{ row.destinationCountry }}</span>
                  </td>
                  <td v-if="mi === 0" :rowspan="row.members.length" class="whitespace-nowrap px-4 py-2.5 align-top text-xs text-gray-500">
                    {{ row.mode === 'domestic' ? '국내(택배)' : '국제' }}
                  </td>
                  <td v-if="mi === 0" :rowspan="row.members.length" class="whitespace-nowrap px-4 py-2.5 align-top">
                    <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.status]">
                      {{ pcbShipmentStatusLabel(row.mode, row.status, { directShip: isPcbDirectShipIntl(row.destinationCountry) }) }}
                    </span>
                    <span v-if="row.adminTurn" class="ml-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      내 차례
                    </span>
                    <!-- 협력사가 이 값을 기다리며 발송을 멈춘 상태 — Case 선적 줄에서 입력 -->
                    <span
                      v-if="row.caseRefPending"
                      class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                      title="협력사가 발송 참조번호(Case ID)를 기다리고 있습니다 — Case 선적 줄에서 입력하세요."
                    >Case ID 요청</span>
                  </td>
                  <td v-if="mi === 0" :rowspan="row.members.length" class="whitespace-nowrap px-4 py-2.5 align-top">
                    <span v-if="row.receivedAt !== null" class="text-xs font-semibold text-emerald-600">{{ fmtDate(row.receivedAt) }}</span>
                    <span v-else class="text-xs text-gray-300">—</span>
                  </td>
                  <td v-if="mi === 0" :rowspan="row.members.length" class="whitespace-nowrap px-4 py-2.5 align-top text-gray-400">
                    {{ fmtDate(row.createdAt) }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 text-right">
                    <button
                      type="button"
                      class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                      @click.stop="openCase(m.specId)"
                    >
                      Case 열기 →
                    </button>
                  </td>
                </tr>
              </template>
              <tr v-if="rows.length === 0">
                <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
                  {{
                    filters.q !== ''
                      ? '검색과 일치하는 발송이 없습니다.'
                      : '해당 상태의 발송이 없습니다 — 발송은 협력사 포털(또는 Case 상세 대행)에서 시작합니다.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between text-sm">
          <!-- 행이 발주 단위로 펼쳐지므로 페이징 축(박스)과 눈에 보이는 행 수를 함께 말한다. -->
          <p class="text-gray-500">박스 {{ total }}건 · 발주 {{ poTotal }}건</p>
          <div v-if="totalPages > 1" class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
              :disabled="filters.page <= 1"
              @click="filters = { ...filters, page: filters.page - 1 }"
            >
              이전
            </button>
            <span class="text-gray-500">{{ filters.page }} / {{ totalPages }}</span>
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
              :disabled="filters.page >= totalPages"
              @click="filters = { ...filters, page: filters.page + 1 }"
            >
              다음
            </button>
          </div>
        </div>
      </template>
    </section>

    <!-- ② 고객 배송(P4.6) — 입고 끝난 주문을 고객에게 발송(주문 축). 판정은 협력 축
         입고확인(관리자 수신 선적 receivedAt)이라 이관·수동 처리 건은 여기 안 뜬다. -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-700">고객 배송 — 입고 끝난 주문 발송</h2>
      <div class="flex flex-wrap gap-1 border-b border-gray-200">
        <button
          v-for="entry in ORDER_TABS"
          :key="entry.key"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="orderTab === entry.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="setOrderTab(entry.key)"
        >
          {{ entry.label }}
          <span v-if="orderTabCount(entry.key) !== null" class="ml-0.5 text-xs opacity-60">{{ orderTabCount(entry.key) }}</span>
        </button>
      </div>

      <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
        {{ actionError }}
      </p>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">주문번호</th>
              <th class="px-4 py-2.5">프로젝트</th>
              <th class="px-4 py-2.5">고객명</th>
              <th class="whitespace-nowrap px-4 py-2.5">입고</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">결제액</th>
              <th class="px-4 py-2.5">{{ orderTab === 'to_ship' ? '상태' : '운송장' }}</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="item in orderRows"
              :key="item.odId"
              class="cursor-pointer hover:bg-blue-50/40"
              :class="orderTab === 'to_ship' ? 'bg-amber-50/40' : ''"
              @click="openCase(item.specId)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{{ item.odId }}</td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                <span class="font-mono text-xs text-gray-400">Q{{ item.specId }}</span>
                <!-- 직송(D5) — 실물이 자사를 안 거쳤다: 이 행의 종결은 [직송 완료]다 -->
                <span
                  v-if="item.directShipCountry !== null"
                  class="mr-0.5 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700"
                  title="직송 — 실물은 자사 입고 없이 주문지로 갔습니다. 운송장 없이 [직송 완료]로 종결하세요."
                >직송 {{ item.directShipCountry }}</span>
                {{ item.projectName }}
              </td>
              <!-- 송장을 붙이는 사람이 읽는 열 — 로그인 아이디만으로는 누구 물건인지 모른다.
                   묶음 발송이면 회원이 다른 두 주문이 나란히 서므로 주문자명이 정본이다
                   (주문자명이 비면 회원 이름으로 메운다 — 서버 lib/pcb-customer). -->
              <td class="px-4 py-2.5 text-gray-600">
                <PcbCustomerCell :name="item.customerName" :mb-id="item.mbId" />
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span
                  v-if="allReceived(item)"
                  class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700"
                >입고 완료</span>
                <span
                  v-else
                  class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700"
                >입고 {{ item.receivedPoCount }}/{{ item.poCount }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {{ fmtPcbAmount('KRW', item.receiptPrice) }}
              </td>
              <td class="px-4 py-2.5">
                <span
                  v-if="orderTab === 'to_ship'"
                  class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700"
                >{{ item.odStatus }}</span>
                <span v-else class="text-xs text-gray-600">
                  {{ item.deliveryCompany !== '' ? item.deliveryCompany : '—' }}
                  <span v-if="item.invoiceNo !== ''" class="ml-1 font-mono text-gray-500">{{ item.invoiceNo }}</span>
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <!-- 직송 건 — 보낼 실물이 없다: 운송장 모달 대신 확인 후 완료 종결 -->
                <button
                  v-if="orderTab === 'to_ship' && item.directShipCountry !== null"
                  type="button"
                  class="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
                  :disabled="completeMut.isPending.value"
                  @click.stop="completeDirectOrder(item)"
                >
                  직송 완료
                </button>
                <button
                  v-else-if="orderTab === 'to_ship'"
                  type="button"
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700"
                  @click.stop="openShip(item)"
                >
                  배송 처리
                </button>
                <button
                  v-else
                  type="button"
                  class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                  :disabled="completeMut.isPending.value"
                  @click.stop="completeOrder(item)"
                >
                  구매확정
                </button>
                <button
                  type="button"
                  class="ml-1 rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  @click.stop="openCase(item.specId)"
                >
                  Case →
                </button>
              </td>
            </tr>
            <tr v-if="orderRows.length === 0">
              <td colspan="7" class="px-4 py-10 text-center text-sm text-gray-400">
                {{
                  orderQuery.isFetching.value
                    ? '불러오는 중…'
                    : orderTab === 'to_ship'
                      ? '배송 처리 대기 주문이 없습니다 — 입고확인이 끝나면 여기로 들어옵니다.'
                      : '배송 중인 주문이 없습니다.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between text-sm">
        <p class="text-gray-500">총 {{ orderTotal }}건</p>
        <div v-if="orderPages > 1" class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="orderFilters.page <= 1"
            @click="orderFilters = { ...orderFilters, page: orderFilters.page - 1 }"
          >
            이전
          </button>
          <span class="text-gray-500">{{ orderFilters.page }} / {{ orderPages }}</span>
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="orderFilters.page >= orderPages"
            @click="orderFilters = { ...orderFilters, page: orderFilters.page + 1 }"
          >
            다음
          </button>
        </div>
      </div>
    </section>

    <PcbCustomerShipModal
      :od-id="shipOdId"
      :incomplete-receipt="shipIncomplete"
      :customer-label="shipCustomerLabel"
      :project-name="shipProjectName"
      @close="shipOdId = null"
    />
    <PcbPackageLabelsModal
      v-if="labelsApi !== null"
      :open="labelShipmentId !== null"
      :load="labelsApi.load"
      :mark-printed="labelsApi.markPrinted"
      @close="labelShipmentId = null"
    />
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
