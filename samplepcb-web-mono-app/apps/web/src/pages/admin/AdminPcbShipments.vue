<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  PCB_PO_STATUS_LABELS,
  bomShipmentStatusLabel,
  type AdminPcbShipmentTabType,
} from '@sp/api-contract';
import {
  useAdminPcbPoWork,
  useAdminPcbShipmentWork,
  type AdminPcbPoWorkFilters,
  type AdminPcbShipmentFilters,
} from '../../admin/useAdminPcbPos';
import { fmtKstDate as fmtDate } from '@sp/utils';

// PCB 선적·배송 워크큐(P3) — 물류 담당의 화면. 큐 흐름:
//   발송 대기(생산완료·미편성 — 발주서 축) → 입고·처리 대기(내 차례) → 이동 중 → 입고 완료.
// 첫 탭이 발주서 축인 이유: 발송 문서가 생기기 전 건은 선적 축 모수에 들어올 수 없어
// "이제 보내야 할 것"이 이 화면에 없었다. 조작(전이/입고확인/송장)은 Case 상세.

type ShipTabKey = AdminPcbShipmentTabType | 'to_ship';

const router = useRouter();
const tab = ref<ShipTabKey>('to_ship');
const filters = ref<AdminPcbShipmentFilters>({ page: 1, pageSize: 20, tab: 'pending' });
const list = useAdminPcbShipmentWork(filters);

// 발송 대기 = 발주서 축(produced·미편성) — 선적 문서가 아직 없으니 PO 워크큐에서 가져온다.
const poFilters = ref<AdminPcbPoWorkFilters>({ page: 1, pageSize: 20, tab: 'to_ship', q: '' });
const poQuery = useAdminPcbPoWork(poFilters);
const toShipRows = computed(() => poQuery.data.value?.data.items ?? []);
const toShipTotal = computed(() => poQuery.data.value?.data.total ?? 0);
const toShipPages = computed(() => Math.max(1, Math.ceil(toShipTotal.value / poFilters.value.pageSize)));

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

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
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 선적·배송</h1>

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
              <td colspan="6" class="px-4 py-10 text-center text-sm text-gray-400">
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
              <th class="px-4 py-2.5">보내는 곳 → 받는 곳</th>
              <th class="whitespace-nowrap px-4 py-2.5">구분</th>
              <th class="whitespace-nowrap px-4 py-2.5">상태</th>
              <th class="whitespace-nowrap px-4 py-2.5">입고</th>
              <th class="whitespace-nowrap px-4 py-2.5">생성일</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="row in rows"
              :key="row.shipmentId"
              class="cursor-pointer hover:bg-blue-50/40"
              :class="row.adminTurn ? 'bg-amber-50/50' : ''"
              @click="openCase(row.specId)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
                SH-{{ row.shipmentId }}
                <span v-if="row.poCount > 1" class="ml-1 rounded bg-indigo-100 px-1 text-[11px] font-semibold text-indigo-700">묶음 {{ row.poCount }}</span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                <span class="font-mono text-xs text-gray-400">Q{{ row.specId }}</span>
                {{ row.projectName }}
              </td>
              <td class="px-4 py-2.5 text-gray-600">
                {{ row.senderName }} → {{ row.receiverName }}
                <span v-if="row.receiverKind === 'md'" class="ml-1 text-xs text-indigo-500">(MD 입고)</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                {{ row.mode === 'domestic' ? '국내(택배)' : '국제' }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.status]">
                  {{ bomShipmentStatusLabel(row.mode, row.status) }}
                </span>
                <span v-if="row.adminTurn" class="ml-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                  내 차례
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span v-if="row.receivedAt !== null" class="text-xs font-semibold text-emerald-600">{{ fmtDate(row.receivedAt) }}</span>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.createdAt) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  type="button"
                  class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  @click.stop="openCase(row.specId)"
                >
                  Case 열기 →
                </button>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="8" class="px-4 py-10 text-center text-sm text-gray-400">
                해당 상태의 발송이 없습니다 — 발송은 협력사 포털(또는 Case 상세 대행)에서 시작합니다.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
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
    </template>
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
