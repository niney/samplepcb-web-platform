<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AdminPcbRfqTabType } from '@sp/api-contract';
import { useAdminPcbRfqCases, type AdminPcbRfqCaseFilters } from '../../admin/useAdminPcbRfqs';
import { fmtPcbAmount } from '../../lib/pcb-money';

// PCB 견적요청(RFQ) 워크큐 — docs/PCB_PARTNER_TRACK.md §5.4. 스펙(견적건) 단위로
// 협력사 견적 진행을 조감한다: 회신 대기 → 선정 대기(내 차례) → 선정 완료(확정가
// 등록으로 마무리). 배정·비교·선정 조작은 Case 상세(RFQ 패널)가 전담.

const router = useRouter();
const filters = ref<AdminPcbRfqCaseFilters>({ page: 1, pageSize: 20, tab: 'all', q: '' });
const list = useAdminPcbRfqCases(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const TABS: { key: AdminPcbRfqTabType; label: string }[] = [
  { key: 'pending', label: '회신 대기' },
  { key: 'quoted', label: '선정 대기' },
  { key: 'selected', label: '선정 완료' },
  { key: 'all', label: '전체' },
];
const tabCount = (key: AdminPcbRfqTabType): number | null =>
  counts.value === null ? null : counts.value[key];

const setTab = (tab: AdminPcbRfqTabType): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};

const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

const QUOTE_LABEL: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
};

const rfqBadge = (row: { rfqTotal: number; rfqQuoted: number }): { label: string; cls: string } => ({
  label: `회신 ${String(row.rfqQuoted)}/${String(row.rfqTotal)}`,
  cls:
    row.rfqQuoted >= row.rfqTotal
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-blue-100 text-blue-700',
});

// from=rfqs — Case 상세가 워크큐 복귀 링크·활성 메뉴 동기화에 사용.
function openCase(specId: number): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: { from: 'rfqs' },
  });
}

const fmtDate = (iso: string): string => iso.slice(0, 10);
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 견적요청 (RFQ)</h1>

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
          placeholder="프로젝트명·회원ID 검색"
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
            <th class="px-4 py-2.5">고객</th>
            <th class="whitespace-nowrap px-4 py-2.5">분류/수량</th>
            <th class="whitespace-nowrap px-4 py-2.5">고객 견적</th>
            <th class="whitespace-nowrap px-4 py-2.5">협력사 RFQ</th>
            <th class="whitespace-nowrap px-4 py-2.5">선정 협력사</th>
            <th class="whitespace-nowrap px-4 py-2.5">최근 요청</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="row in rows"
            :key="row.specId"
            class="cursor-pointer hover:bg-blue-50/40"
            @click="openCase(row.specId)"
          >
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">Q{{ row.specId }}</td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
            <td class="px-4 py-2.5 text-gray-600">{{ row.mbId ?? '비회원' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.category }} · {{ row.qty }}매</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span
                class="rounded px-1.5 py-0.5 text-xs font-semibold"
                :class="QUOTE_LABEL[row.quoteStatus]?.cls ?? 'bg-gray-100 text-gray-600'"
              >
                {{ QUOTE_LABEL[row.quoteStatus]?.label ?? row.quoteStatus }}
              </span>
              <span v-if="row.finalPrice !== null" class="ml-1 text-xs tabular-nums text-gray-500">
                {{ fmtPcbAmount('KRW', row.finalPrice) }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="rfqBadge(row).cls">
                {{ rfqBadge(row).label }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span v-if="row.selectedPartnerName !== null" class="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
                {{ row.selectedPartnerName }}
              </span>
              <span v-else class="text-xs text-gray-300">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.latestRequestedAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                type="button"
                class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                @click.stop="openCase(row.specId)"
              >
                RFQ 관리 →
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
              해당 상태의 견적요청이 없습니다 — 배정은 견적 관리 또는 Case 상세에서 시작합니다.
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
