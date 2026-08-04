<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAdminQuoteList, type AdminQuoteFilters } from '../../admin/useAdminQuotes';
import { fmtPcbAmount } from '../../lib/pcb-money';

// PCB 진행현황(P3.5) — 모듈 홈. 견적 관리와 같은 목록 계약(AdminQuoteList)을 PCB
// 맥락으로 조감한다: RFQ 가능(비담김+유령 — 협력사 소싱 시작 진입점) / 견적 대기 /
// 전체. 주문 축(입금·진행·이력)은 '주문·결제' 메뉴가 전담한다. 조작은 Case 상세.

const router = useRouter();
const filters = ref<AdminQuoteFilters>({
  page: 1,
  pageSize: 20,
  tab: 'preorder',
  includeDeleted: false,
  category: '',
  q: '',
  from: '',
  to: '',
});
const list = useAdminQuoteList(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const TABS: { key: AdminQuoteFilters['tab']; label: string }[] = [
  { key: 'preorder', label: 'RFQ 가능(주문 전)' },
  { key: 'rfq', label: '견적 대기' },
  { key: 'all', label: '전체' },
];
const tabCount = (key: AdminQuoteFilters['tab']): number | null => {
  if (counts.value === null) return null;
  if (key === 'preorder') return counts.value.preorder;
  if (key === 'rfq') return counts.value.rfq;
  return counts.value.total;
};
const setTab = (tab: AdminQuoteFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

const QUOTE_CLS: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
};
const CART_CLS: Record<string, { label: string; cls: string }> = {
  cart: { label: '담김', cls: 'bg-orange-100 text-orange-700' },
  ordered: { label: '주문됨', cls: 'bg-violet-100 text-violet-700' },
};

function openCase(specId: number): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: { from: 'cases' },
  });
}
const fmtDate = (iso: string): string => iso.slice(0, 10);
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 진행현황</h1>
    <p class="text-sm text-gray-500">
      전 견적건을 PCB 협력 관점으로 조감합니다 — RFQ 가능 탭이 협력사 소싱의 시작점입니다.
      주문·입금·이력은 <b>주문·결제</b> 메뉴에서 봅니다.
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
      <div class="flex flex-wrap gap-1">
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
      <form class="pb-1" @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트·회원ID 검색"
          class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-4 py-2.5">견적</th>
            <th class="px-4 py-2.5">프로젝트</th>
            <th class="px-4 py-2.5">신청자</th>
            <th class="whitespace-nowrap px-4 py-2.5">수량</th>
            <th class="whitespace-nowrap px-4 py-2.5">상태</th>
            <th class="whitespace-nowrap px-4 py-2.5">협력사 RFQ</th>
            <th class="whitespace-nowrap px-4 py-2.5">가격</th>
            <th class="whitespace-nowrap px-4 py-2.5">신청일</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="row in rows"
            :key="row.projectId"
            class="cursor-pointer hover:bg-blue-50/40"
            @click="openCase(row.projectId)"
          >
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">Q{{ row.projectId }}</td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
              {{ row.applicant === null ? '비회원' : (row.applicant.name || row.applicant.mbId) }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">{{ row.qty }}</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="QUOTE_CLS[row.quoteStatus]?.cls">
                {{ QUOTE_CLS[row.quoteStatus]?.label }}
              </span>
              <span
                v-if="row.cartState !== 'none'"
                class="ml-1 rounded px-1.5 py-0.5 text-xs font-semibold"
                :class="CART_CLS[row.cartState]?.cls"
              >
                {{ CART_CLS[row.cartState]?.label }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span v-if="row.pcbRfq === null" class="text-xs text-gray-300">—</span>
              <template v-else>
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="row.pcbRfq.selected ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'">
                  {{ row.pcbRfq.selected ? '선정 완료' : `회신 ${row.pcbRfq.quoted}/${row.pcbRfq.total}` }}
                </span>
              </template>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
              {{ fmtPcbAmount('KRW', row.price) }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.createdAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                type="button"
                class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                @click.stop="openCase(row.projectId)"
              >
                Case 열기 →
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
              해당 조건의 견적건이 없습니다 — 신규 견적(거버 업로드)이 들어오면 'RFQ 가능' 탭에 나타납니다.
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
