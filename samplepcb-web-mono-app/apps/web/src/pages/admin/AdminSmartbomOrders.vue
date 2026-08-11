<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import type { AdminBomOrderListItemType } from '@sp/api-contract';
import {
  useAdminBomOrders,
  useConfirmBomOrderReceipt,
  type AdminBomOrderFilters,
} from '../../admin/useAdminBomOrders';
import { smartbomFmtWon } from '../../admin/smartbom';
import UiPagination from '../../components/ui/UiPagination.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 스마트 BOM 주문·결제(주문 축, D19 — 관리자 메뉴 재편으로 결제 관점만 남김) —
// 경리/CS 의 화면: 입금 대기 → 입금확인. D17 배치 주문이면 한 주문에 Case 여러 개(칩).
// 발주 대기 큐는 [발주] 메뉴, 배송 처리·구매확정은 [선적·배송] 메뉴가 담당한다.
// 주문 편집·취소는 통합 관리 주문내역 위임.

const router = useRouter();
const filters = ref<AdminBomOrderFilters>({ page: 1, pageSize: 20, tab: 'all' });
const { data, isFetching } = useAdminBomOrders(filters);

const items = computed(() => data.value?.data.items ?? []);
const counts = computed(() => data.value?.data.counts ?? null);
const total = computed(() => data.value?.data.total ?? 0);

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'awaiting_payment', label: '입금 대기' },
  { key: 'paid', label: '결제 완료' },
  { key: 'completed', label: '완료' },
] as const;

const tabCount = (key: (typeof TABS)[number]['key']): number | null => {
  if (counts.value === null) return null;
  return key === 'all'
    ? counts.value.all
    : key === 'awaiting_payment'
      ? counts.value.awaitingPayment
      : key === 'paid'
        ? counts.value.paid
        : counts.value.completed;
};

const setTab = (tab: AdminBomOrderFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};

// from=orders — Case 상세가 주문 정보+발주 현황만 펼침(§6.12)
function openCase(quoteId: string): void {
  void router.push({ name: 'admin-smartbom-case', params: { id: quoteId }, query: { from: 'orders' } });
}

const statusCls = (item: AdminBomOrderListItemType): string =>
  !item.isPaid
    ? 'bg-amber-100 text-amber-700'
    : item.odStatus === '취소'
      ? 'bg-red-100 text-red-600'
      : 'bg-emerald-100 text-emerald-700';

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

// ── 입금확인 — 기존 주문 전이 API(코어 미러 + 알림 브리지) 재사용 ─────────────
const receipt = useConfirmBomOrderReceipt();
const actionError = ref('');

async function confirmReceipt(item: AdminBomOrderListItemType): Promise<void> {
  // 메일 없이 처리하는 예외 케이스는 통합 관리 주문내역(체크박스 게이트)에서 — 여기선 단순 1확인.
  if (
    !(await confirmDialog(
      `주문 ${item.odId} 입금확인 처리할까요?\n고객에게 입금 확인 메일이 발송됩니다.`,
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
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">주문·결제</h1>
      <div class="flex items-center gap-2">
        <RouterLink
          :to="{ name: 'admin-smartbom-logistics' }"
          class="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          title="고객 배송 처리·구매확정은 선적·배송 메뉴에서"
        >
          선적·배송 →
        </RouterLink>
        <RouterLink
          :to="{ name: 'admin-orders' }"
          class="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          title="주문 편집·취소는 통합 관리 주문내역에서"
        >
          통합 주문내역 →
        </RouterLink>
      </div>
    </div>

    <!-- 워크큐 탭 -->
    <div class="flex flex-wrap gap-1 border-b border-gray-200">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
        :class="filters.tab === tab.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
        @click="setTab(tab.key)"
      >
        {{ tab.label }}
        <span v-if="tabCount(tab.key) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(tab.key) }}</span>
      </button>
    </div>

    <p v-if="actionError !== ''" class="text-xs font-semibold text-red-600">{{ actionError }}</p>

    <!-- 주문 목록(주문 축 — 배치 주문이면 Case 칩 여러 개) -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-4 py-2.5">주문번호</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문일시</th>
            <th class="px-4 py-2.5">고객</th>
            <th class="px-4 py-2.5">연결 Case</th>
            <th class="whitespace-nowrap px-4 py-2.5">결제수단</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">주문 금액</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">수납 / 미수</th>
            <th class="px-4 py-2.5">상태</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="item in items" :key="item.odId" class="hover:bg-blue-50/30">
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{{ item.odId }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(item.orderedAt) }}</td>
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
              </button>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-600">{{ item.settleCase || '—' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{{ smartbomFmtWon(item.cartPrice) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-xs">
              {{ smartbomFmtWon(item.receiptPrice) }}
              <span v-if="item.misu > 0" class="text-red-600"> / 미수 {{ smartbomFmtWon(item.misu) }}</span>
              <!-- 음수는 돌려줄 돈 — 표시하지 않으면 과입금 주문이 정상 건과 구분되지 않는다. -->
              <span v-else-if="item.misu < 0" class="text-amber-600"> / 과입금 {{ smartbomFmtWon(-item.misu) }}</span>
            </td>
            <td class="px-4 py-2.5">
              <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(item)">
                {{ item.isPaid ? item.odStatus : '입금 대기' }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                v-if="!item.isPaid && item.settleCase.includes('무통장')"
                type="button"
                class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                :disabled="receipt.isPending.value"
                @click="confirmReceipt(item)"
              >
                입금확인
              </button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ isFetching ? '불러오는 중…' : '해당 상태의 주문이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ total }}건</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>
  </div>
</template>
