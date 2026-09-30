<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) 워크큐 — 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// 처리는 Case 상세의 '부품 확인 요청' 패널에서 한다(목록은 목록만 — 결정 UI 를 두 곳에 두지 않는다).
// 탭은 겹칠 수 있다: 한 요청이 '처리 필요'(적용할 품목)와 '환불 대기'(감액·환불 기록)에 함께 들 수 있다.
import { computed, ref, watch } from 'vue';
import {
  ADMIN_BOM_CONFIRM_TAB_LABELS,
  BOM_CONFIRM_ISSUE_TYPE_LABELS,
  BOM_CONFIRM_REQUEST_STATUS_LABELS,
  BOM_SETTLEMENT_KIND_LABELS,
  type AdminBomConfirmListRowType,
  type AdminBomConfirmTabType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { useAdminBomConfirmList, type AdminBomConfirmFilters } from '../../admin/useAdminBomConfirms';
import { smartbomFmtWon } from '../../admin/smartbom';

const TAB_ORDER: readonly AdminBomConfirmTabType[] = [
  'needs_action',
  'awaiting_customer',
  'awaiting_payment',
  'awaiting_refund',
  'backorder',
  'done',
  'canceled',
];

const tab = ref<AdminBomConfirmTabType>('needs_action');
const page = ref(1);
const searchDraft = ref('');
const search = ref('');
const filters = computed<AdminBomConfirmFilters>(() => ({ tab: tab.value, page: page.value, pageSize: 20, search: search.value }));
const listQuery = useAdminBomConfirmList(filters);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const counts = computed(() => listQuery.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil((listQuery.data.value?.data.total ?? 0) / 20)));

watch(tab, () => { page.value = 1; });

function applySearch(): void {
  search.value = searchDraft.value.trim();
  page.value = 1;
}

const STATUS_TONE: Record<AdminBomConfirmListRowType['status'], string> = {
  requested: 'bg-sky-100 text-sky-800',
  answered: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  canceled: 'bg-gray-200 text-gray-600',
};

const deltaText = (value: number | null): string => {
  if (value === null) return '회신 전';
  if (value === 0) return '변동 없음';
  return value > 0 ? `+${smartbomFmtWon(value)}` : `−${smartbomFmtWon(-value)}`;
};
</script>

<template>
  <div class="mx-auto w-full max-w-7xl p-4 sm:p-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-sky-600">After payment · D43</p>
        <h1 class="mt-1 text-2xl font-bold text-gray-950">부품 확인</h1>
        <p class="mt-1 text-sm text-gray-500">결제 뒤 재고 소진·MOQ 증가로 고객에게 물은 요청입니다. 적용·정산은 Case 상세의 부품 확인 패널에서 합니다.</p>
      </div>
      <div v-if="counts !== null" class="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
        처리 필요 <b class="ml-1 text-lg tabular-nums">{{ counts.needs_action }}</b>건
      </div>
    </header>

    <nav class="mt-6 flex gap-1 overflow-x-auto border-b border-gray-200" aria-label="부품 확인 요청 탭">
      <button
        v-for="key in TAB_ORDER"
        :key="key"
        type="button"
        class="shrink-0 border-b-2 px-3 py-2 text-sm font-semibold"
        :class="tab === key ? 'border-sky-600 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-800'"
        :aria-pressed="tab === key"
        @click="tab = key"
      >
        {{ ADMIN_BOM_CONFIRM_TAB_LABELS[key] }}
        <span class="ml-1 tabular-nums text-xs">{{ counts?.[key] ?? 0 }}</span>
      </button>
    </nav>

    <form class="mt-4 flex gap-2" role="search" @submit.prevent="applySearch">
      <label class="sr-only" for="bom-confirm-search">부품 확인 요청 검색</label>
      <input id="bom-confirm-search" v-model="searchDraft" class="min-w-0 flex-1 rounded-xl border border-gray-300 bg-surface px-4 py-2.5 text-sm" placeholder="Case명·고객 ID·고객명·주문번호·Case 번호 검색">
      <button type="submit" class="shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white">검색</button>
    </form>

    <p v-if="listQuery.isError.value" role="alert" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
      목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
    </p>
    <div v-else-if="items.length === 0 && !listQuery.isFetching.value" class="mt-6 rounded-2xl border border-dashed border-gray-300 bg-surface p-12 text-center text-sm text-gray-500">
      이 탭에 해당하는 요청이 없습니다.
    </div>

    <div v-else class="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-surface">
      <table class="min-w-[980px] w-full divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="px-3 py-2">상태</th>
            <th class="px-3 py-2">Case</th>
            <th class="px-3 py-2">고객</th>
            <th class="px-3 py-2">문제</th>
            <th class="px-3 py-2">요청·기한</th>
            <th class="px-3 py-2 text-right">순액</th>
            <th class="px-3 py-2">정산</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="row in items" :key="row.id">
            <td class="px-3 py-2">
              <span class="rounded-full px-2 py-0.5 font-bold" :class="STATUS_TONE[row.status]">{{ BOM_CONFIRM_REQUEST_STATUS_LABELS[row.status] }}</span>
              <p v-if="row.pendingApplyCount > 0" class="mt-1 font-semibold text-amber-700">적용 대기 {{ row.pendingApplyCount }}</p>
              <p v-if="row.backorderCount > 0" class="mt-1 font-semibold text-sky-700">입고 대기 {{ row.backorderCount }}</p>
            </td>
            <td class="px-3 py-2">
              <p class="max-w-[220px] truncate font-semibold text-gray-900">{{ row.quoteTitle }}</p>
              <p class="text-gray-400">#{{ row.quoteId }} · 주문 {{ row.odId }}</p>
            </td>
            <td class="px-3 py-2">
              <p class="font-semibold text-gray-700">{{ row.customerName ?? '—' }}</p>
              <p class="text-gray-400">{{ row.mbId }}</p>
            </td>
            <td class="px-3 py-2">
              {{ row.issueCount }}건 · {{ row.issueTypes.map((type) => BOM_CONFIRM_ISSUE_TYPE_LABELS[type]).join(', ') }}
            </td>
            <td class="px-3 py-2">
              <p>{{ fmtKstDate(row.requestedAt) }}</p>
              <p v-if="row.dueOn !== null" :class="row.overdue ? 'font-bold text-rose-600' : 'text-gray-400'">기한 {{ row.dueOn }}{{ row.overdue ? ' · 지남' : '' }}</p>
            </td>
            <td class="px-3 py-2 text-right tabular-nums font-semibold">{{ deltaText(row.netDelta) }}</td>
            <td class="px-3 py-2">
              <template v-if="row.settlement !== null">
                <span class="font-semibold text-gray-700">{{ BOM_SETTLEMENT_KIND_LABELS[row.settlement.kind] }} {{ smartbomFmtWon(row.settlement.amount) }}</span>
                <p class="text-gray-500">{{ row.settlement.statusLabel }}</p>
              </template>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="px-3 py-2 text-right">
              <RouterLink
                :to="{ name: 'admin-smartbom-case', params: { id: row.quoteId }, query: { from: 'confirms' }, hash: `#bomc-admin-${row.id}` }"
                class="rounded-lg border border-sky-300 px-3 py-1.5 font-bold text-sky-700 hover:bg-sky-50"
              >
                Case 열기
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer v-if="totalPages > 1" class="mt-6 flex items-center justify-center gap-3">
      <button type="button" class="rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
      <span class="text-sm tabular-nums text-gray-500">{{ page }} / {{ totalPages }}</span>
      <button type="button" class="rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">다음</button>
    </footer>
  </div>
</template>
