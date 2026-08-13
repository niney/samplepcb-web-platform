<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  ADMIN_PCB_ORDER_TAB_LABELS,
  type AdminPcbOrderItemType,
  type AdminPcbOrderTabType,
} from '@sp/api-contract';
import {
  useAdminPcbOrderWork,
  useConfirmPcbOrderReceipt,
  type AdminPcbOrderFilters,
} from '../../admin/useAdminPcbOrders';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { fmtPcbAmount } from '../../lib/pcb-money';
import { confirmDialog } from '../../lib/confirmDialog';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';
import PcbOrderCancelModal from '../../components/admin/pcb/PcbOrderCancelModal.vue';
import {
  pcbDetailQuery,
  queryPage,
  queryString,
  queryTab,
  replacePcbListQuery,
} from '../../admin/pcb-navigation';

// PCB 주문·결제 워크큐(P3.5) — 경리 관점 조감: 입금 대기 → 진행 중 → 완료/취소.
// 레거시 이관 주문 2만여 건이 이력 모수(서버 페이지네이션). od 상태 변경은 코어
// 주문 관리의 몫 — 여기서는 열람과 Case 진입만. 발주 시작은 Case 상세 발주 패널.

// 이 화면은 경리 관점 5탭만 — 고객 배송 탭(to_ship/shipping)은 선적·배송 화면 몫(P4.6).
type ScreenTab = Exclude<AdminPcbOrderTabType, 'to_ship' | 'shipping'>;
const TABS: ScreenTab[] = ['awaiting', 'active', 'done', 'canceled', 'all'];

const route = useRoute();
const router = useRouter();
const filters = ref<AdminPcbOrderFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: queryTab(route.query.tab, TABS, 'awaiting'),
  q: queryString(route.query.q),
});
const list = useAdminPcbOrderWork(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
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
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const tabCount = (key: ScreenTab): number | null =>
  counts.value === null ? null : counts.value[key];
const setTab = (tab: ScreenTab): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
watch(
  filters,
  (value) => {
    replacePcbListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

// od 상태 배지 — 코어 주문 상태 문자열을 그대로 노출(정본은 g5), 색만 구간 매핑.
const OD_CLS: Record<string, string> = {
  주문: 'bg-amber-100 text-amber-700',
  입금: 'bg-blue-100 text-blue-700',
  준비: 'bg-sky-100 text-sky-700',
  파일검사: 'bg-sky-100 text-sky-700',
  생산중: 'bg-indigo-100 text-indigo-700',
  생산완료: 'bg-indigo-100 text-indigo-700',
  배송: 'bg-teal-100 text-teal-700',
  완료: 'bg-emerald-100 text-emerald-700',
  취소: 'bg-gray-200 text-gray-500',
};
const CANCELED_ITEM_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const displayStatus = (item: AdminPcbOrderItemType): string =>
  CANCELED_ITEM_STATUSES.has(item.ctStatus) ? item.ctStatus : item.odStatus;
const canReviewCancel = (item: AdminPcbOrderItemType): boolean =>
  !CANCELED_ITEM_STATUSES.has(item.ctStatus) &&
  item.odStatus !== '취소' &&
  item.odStatus !== '완료';
const cancelSpecId = ref<number | null>(null);

// ── 입금확인 — 무통장 미입금만(서버 가드 동일). 그 외 전이는 통합 관리 주문내역이 전담. ──
const receipt = useConfirmPcbOrderReceipt();
const actionError = ref('');
const canConfirmReceipt = (item: AdminPcbOrderItemType): boolean =>
  item.odStatus === '주문' &&
  !item.isPaid &&
  item.settleCase.includes('무통장');

async function confirmReceipt(item: AdminPcbOrderItemType): Promise<void> {
  if (
    !(await confirmDialog(
      `주문 ${item.odId} 전체(PCB ${String(item.orderPcbCount)}건 포함)를 입금확인 처리할까요?\n` +
        `이 주문의 결제 가능한 모든 상품이 함께 입금 상태로 변경되고 고객에게 확인 메일이 발송됩니다.`,
    ))
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
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: pcbDetailQuery('orders', route.fullPath),
  });
}

function openCancelCase(): void {
  const id = cancelSpecId.value;
  cancelSpecId.value = null;
  if (id !== null) openCase(id);
}
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 주문·결제</h1>
    <p class="text-sm text-gray-500">
      주문 축 조감(레거시 이관 주문 포함) — 무통장 <b>입금확인</b>은 여기서, 그 밖의 상태 변경은
      통합 관리 주문내역에서, 협력사 발주 시작은 Case 상세에서 합니다.
    </p>
    <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {{ actionError }}
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="tab in TABS"
          :key="tab"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="filters.tab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="setTab(tab)"
        >
          {{ ADMIN_PCB_ORDER_TAB_LABELS[tab] }}
          <span v-if="tabCount(tab) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(tab) }}</span>
        </button>
      </div>
      <form class="pb-1" @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트·고객명·아이디·주문번호 검색"
          class="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-4 py-2.5">주문번호</th>
            <th class="px-4 py-2.5">프로젝트</th>
            <th class="px-4 py-2.5">고객명</th>
            <th class="whitespace-nowrap px-4 py-2.5">수량</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">PCB 금액</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문 상태</th>
            <th class="whitespace-nowrap px-4 py-2.5">결제수단</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문 결제</th>
            <th class="whitespace-nowrap px-4 py-2.5">발주</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문일</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <template v-for="group in orderGroups" :key="group.odId">
            <tr
              v-for="(row, rowIndex) in group.items"
              :key="`${String(row.specId)}-${row.odId}`"
              class="cursor-pointer hover:bg-blue-50/40"
              :class="displayStatus(row) === '주문' ? 'bg-amber-50/50' : ''"
              @click="openCase(row.specId)"
            >
              <td
                v-if="rowIndex === 0"
                :rowspan="group.items.length"
                class="whitespace-nowrap border-r border-gray-100 px-4 py-2.5 align-top font-mono text-xs text-gray-500"
              >
                {{ group.odId }}
                <span class="mt-1 block font-sans text-[11px] text-blue-600">
                  PCB {{ group.header.orderPcbCount }}건 포함
                </span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                <span class="sr-only">주문 {{ row.odId }}</span>
                <span class="mr-1 font-mono text-xs text-gray-300">Q{{ row.specId }}</span>
                {{ row.projectName }}
              </td>
              <td
                v-if="rowIndex === 0"
                :rowspan="group.items.length"
                class="border-r border-gray-100 px-4 py-2.5 align-top text-gray-600"
              >
                <PcbCustomerCell :name="group.header.customerName" :mb-id="group.header.mbId" />
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">{{ row.qty }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                {{ fmtPcbAmount('KRW', row.lineAmount) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="OD_CLS[displayStatus(row)] ?? 'bg-gray-100 text-gray-600'">
                  {{ displayStatus(row) }}
                </span>
                <!-- 줄 축 — 영카트는 줄 단위로 취소하고 전량일 때만 od_status 를 내린다. 이 배지가
                   없으면 부분 취소된 줄이 살아 있는 줄과 똑같이 '입금'으로 보이고, 서버 가드는
                   막는데 화면은 진행 중이라 말한다(od 가 통째로 취소면 위 배지와 겹치니 제외). -->
                <span
                  v-if="row.lineCanceled && row.odStatus !== '취소'"
                  class="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-600"
                  title="이 주문 줄만 취소됐습니다(주문서의 다른 줄은 살아 있습니다) — 협력 트랙 진행은 서버가 막습니다."
                >
                  줄 취소
                </span>
              </td>
              <td
                v-if="rowIndex === 0"
                :rowspan="group.items.length"
                class="whitespace-nowrap border-r border-gray-100 px-4 py-2.5 align-top text-xs text-gray-500"
              >
                {{ group.header.settleCase || '—' }}
              </td>
              <td
                v-if="rowIndex === 0"
                :rowspan="group.items.length"
                class="min-w-44 whitespace-nowrap border-r border-gray-100 px-4 py-2.5 align-top tabular-nums text-gray-600"
              >
                <dl class="space-y-0.5 text-xs">
                  <div class="flex justify-between gap-3">
                    <dt class="text-gray-400">주문</dt>
                    <dd class="font-semibold text-gray-800">{{ fmtPcbAmount('KRW', group.header.orderAmount) }}</dd>
                  </div>
                  <div class="flex justify-between gap-3">
                    <dt class="text-gray-400">현금수납</dt>
                    <dd>{{ fmtPcbAmount('KRW', group.header.receiptPrice) }}</dd>
                  </div>
                  <div v-if="group.header.receiptPoint !== 0" class="flex justify-between gap-3">
                    <dt class="text-gray-400">포인트</dt>
                    <dd>{{ fmtPcbAmount('KRW', group.header.receiptPoint) }}</dd>
                  </div>
                  <div v-if="group.header.refundPrice !== 0" class="flex justify-between gap-3 text-red-600">
                    <dt>환불</dt>
                    <dd>-{{ fmtPcbAmount('KRW', group.header.refundPrice) }}</dd>
                  </div>
                  <div v-if="group.header.refundPrice !== 0 || group.header.receiptPoint !== 0" class="flex justify-between gap-3 border-t border-gray-100 pt-0.5 font-semibold text-emerald-700">
                    <dt>순결제</dt>
                    <dd>{{ fmtPcbAmount('KRW', group.header.netReceipt) }}</dd>
                  </div>
                </dl>
                <!-- 상태는 결제됨인데 미수가 남은 건 = 수납 없이 상태만 올린 주문(force-status).
                   PCB 축은 상태로만 isPaid 를 파생해 그대로 두면 영영 드러나지 않는다. -->
                <span
                  v-if="group.header.isPaid && group.header.misu > 0 && group.header.odStatus !== '취소'"
                  class="mt-1 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700"
                  :title="`수납액이 결제금액에 못 미칩니다 — 통합 주문내역의 [입금 조정]으로 맞춰 주세요.`"
                >
                  미수 {{ fmtPcbAmount('KRW', group.header.misu) }}
                </span>
                <!-- 반대 방향 — 돌려줄 돈. `> 0` 가드만 두면 과입금 주문이 목록에서 아무 표시도
                   없어 정상 건과 구분되지 않는다. 취소 주문에도 남으므로 상태로 거르지 않는다. -->
                <span
                  v-else-if="group.header.misu < 0"
                  class="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700"
                  :title="`수납액이 결제금액을 넘습니다 — 돌려줄 돈이 남아 있습니다(환불 실행은 주문 관리·결제사에서).`"
                >
                  과입금 {{ fmtPcbAmount('KRW', -group.header.misu) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span v-if="row.poCount > 0" class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                  발주 {{ row.poCount }}건
                </span>
                <span v-else-if="row.isPaid && row.odStatus !== '완료' && row.odStatus !== '취소'" class="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700">
                  발주 대기
                </span>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
              <td
                v-if="rowIndex === 0"
                :rowspan="group.items.length"
                class="whitespace-nowrap border-r border-gray-100 px-4 py-2.5 align-top text-gray-400"
              >
                {{ fmtDate(group.header.orderedAt) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  v-if="rowIndex === 0 && canConfirmReceipt(group.header)"
                  type="button"
                  class="mr-1 rounded-md bg-blue-600 px-2.5 py-[3px] text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                  :disabled="receipt.isPending.value"
                  @click.stop="void confirmReceipt(group.header)"
                >
                  입금확인
                </button>
                <button
                  v-if="canReviewCancel(row)"
                  type="button"
                  class="mr-1 rounded-md border border-red-200 px-2.5 py-[3px] text-xs font-semibold text-red-600 hover:bg-red-50"
                  @click.stop="cancelSpecId = row.specId"
                >
                  취소
                </button>
                <button
                  type="button"
                  class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  @click.stop="openCase(row.specId)"
                >
                  Case 열기 →
                </button>
              </td>
            </tr>
          </template>
          <tr v-if="rows.length === 0">
            <td colspan="11" class="px-4 py-10 text-center text-sm text-gray-400">
              해당 상태의 주문이 없습니다.
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

    <PcbOrderCancelModal
      v-if="cancelSpecId !== null"
      :spec-id="cancelSpecId"
      @close="cancelSpecId = null"
      @done="cancelSpecId = null"
      @open-case="openCancelCase"
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
