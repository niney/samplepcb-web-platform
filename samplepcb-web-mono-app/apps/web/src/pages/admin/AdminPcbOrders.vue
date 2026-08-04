<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
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
import { fmtPcbAmount } from '../../lib/pcb-money';

// PCB 주문·결제 워크큐(P3.5) — 경리 관점 조감: 입금 대기 → 진행 중 → 완료/취소.
// 레거시 이관 주문 2만여 건이 이력 모수(서버 페이지네이션). od 상태 변경은 코어
// 주문 관리의 몫 — 여기서는 열람과 Case 진입만. 발주 시작은 Case 상세 발주 패널.

const router = useRouter();
const filters = ref<AdminPcbOrderFilters>({ page: 1, pageSize: 20, tab: 'awaiting', q: '' });
const list = useAdminPcbOrderWork(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const TABS: AdminPcbOrderTabType[] = ['awaiting', 'active', 'done', 'canceled', 'all'];
const tabCount = (key: AdminPcbOrderTabType): number | null =>
  counts.value === null ? null : counts.value[key];
const setTab = (tab: AdminPcbOrderTabType): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

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

// ── 입금확인 — 무통장 미입금만(서버 가드 동일). 그 외 전이는 통합 관리 주문내역이 전담. ──
const receipt = useConfirmPcbOrderReceipt();
const actionError = ref('');
const canConfirmReceipt = (item: AdminPcbOrderItemType): boolean =>
  !item.isPaid && item.settleCase.includes('무통장');

async function confirmReceipt(item: AdminPcbOrderItemType): Promise<void> {
  if (
    !window.confirm(
      `주문 ${item.odId} 입금확인 처리할까요?\n고객에게 입금 확인 메일이 발송됩니다.`,
    )
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
    query: { from: 'orders' },
  });
}
const fmtDate = (v: string | null): string => (v === null ? '—' : v.slice(0, 10));
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
          placeholder="프로젝트·회원ID·주문번호 검색"
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
            <th class="px-4 py-2.5">회원</th>
            <th class="whitespace-nowrap px-4 py-2.5">수량</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문 상태</th>
            <th class="whitespace-nowrap px-4 py-2.5">결제수단</th>
            <th class="whitespace-nowrap px-4 py-2.5">수납액</th>
            <th class="whitespace-nowrap px-4 py-2.5">발주</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문일</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="row in rows"
            :key="`${String(row.specId)}-${row.odId}`"
            class="cursor-pointer hover:bg-blue-50/40"
            :class="row.odStatus === '주문' ? 'bg-amber-50/50' : ''"
            @click="openCase(row.specId)"
          >
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
              {{ row.odId }}
              <span class="ml-1 text-gray-300">Q{{ row.specId }}</span>
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.mbId ?? '비회원' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">{{ row.qty }}</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="OD_CLS[row.odStatus] ?? 'bg-gray-100 text-gray-600'">
                {{ row.odStatus }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">{{ row.settleCase || '—' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
              {{ fmtPcbAmount('KRW', row.receiptPrice) }}
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
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.orderedAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                v-if="canConfirmReceipt(row)"
                type="button"
                class="mr-1 rounded-md bg-blue-600 px-2.5 py-[3px] text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                :disabled="receipt.isPending.value"
                @click.stop="void confirmReceipt(row)"
              >
                입금확인
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
          <tr v-if="rows.length === 0">
            <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
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
