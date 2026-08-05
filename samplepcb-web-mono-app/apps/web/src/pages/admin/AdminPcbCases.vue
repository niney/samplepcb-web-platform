<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PCB_STEPS, type AdminPcbCaseTabType } from '@sp/api-contract';
import { useAdminPcbCases, type AdminPcbCaseFilters } from '../../admin/useAdminPcbCases';
import { fmtPcbAmount } from '../../lib/pcb-money';

// PCB 진행현황(P3.5 → 2026-08-05 개편) — 모듈 홈, 총괄의 화면. 견적요청부터 선적·
// 배송까지를 **순서대로** 조감한다: 행마다 12단계 파생 타임라인(PCB_STEPS)을 칩으로
// 보이고, 탭은 큰 구간(견적 → 주문·결제 → 발주·생산 → 완료·취소)으로 나눈다.
// 단계는 저장 상태가 아니라 원장(RFQ·발주·선적·od)에서 서버가 계산한 표시값이다.
// 조작은 언제나 Case 상세 — 여기서는 조감과 진입만(역할별 대기 큐는 각 워크큐 첫 탭).

const router = useRouter();
const filters = ref<AdminPcbCaseFilters>({ page: 1, pageSize: 20, tab: 'production', q: '' });
const list = useAdminPcbCases(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

// 탭 = 흐름 구간. 기본은 '발주·생산'(지금 굴러가는 건) — 완료 2만 건이 모수를 덮지 않게.
type CaseTab = Extract<AdminPcbCaseTabType, 'quoting' | 'unpaid' | 'production' | 'closed' | 'all'>;
const TABS: { key: CaseTab; label: string }[] = [
  { key: 'quoting', label: '견적' },
  { key: 'unpaid', label: '주문·결제' },
  { key: 'production', label: '발주·생산' },
  { key: 'closed', label: '완료·취소' },
  { key: 'all', label: '전체' },
];
const tabCount = (key: CaseTab): number | null =>
  counts.value === null ? null : counts.value[key];
const setTab = (tab: CaseTab): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

// 단계 칩 — 구간별 색으로 흐름을 읽히게(견적 → 주문 → 생산 → 완료).
const stepLabel = (step: number): string => `${String(step)}. ${PCB_STEPS[step - 1] ?? ''}`;
const stepCls = (step: number): string =>
  step <= 5
    ? 'bg-amber-100 text-amber-700'
    : step <= 7
      ? 'bg-sky-100 text-sky-700'
      : step <= 10
        ? 'bg-indigo-100 text-indigo-700'
        : 'bg-emerald-100 text-emerald-700';

const QUOTE_CLS: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
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
      전 견적건을 견적요청 → 주문·결제 → 발주·생산 → 선적·배송 순서로 조감합니다.
      각 역할이 <b>시작해야 할 일</b>은 견적요청·발주·EQ·선적·배송 메뉴의 첫 탭에 있습니다.
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
          placeholder="프로젝트·회원ID·주문번호"
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
            <th class="whitespace-nowrap px-4 py-2.5">단계</th>
            <th class="whitespace-nowrap px-4 py-2.5">협력사</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문</th>
            <th class="whitespace-nowrap px-4 py-2.5">확정가</th>
            <th class="whitespace-nowrap px-4 py-2.5">신청일</th>
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
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
              Q{{ row.specId }}
              <span v-if="row.isLegacy" class="ml-1 rounded bg-gray-100 px-1 text-[11px] text-gray-500" title="레거시 이관 건">이관</span>
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.mbId ?? '비회원' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">{{ row.qty }}</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="stepCls(row.step)">
                {{ stepLabel(row.step) }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span v-if="row.rfqTotal === 0" class="text-xs text-gray-300">—</span>
              <span
                v-else
                class="rounded px-1.5 py-0.5 text-xs font-semibold"
                :class="row.rfqSelected ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'"
              >
                {{ row.rfqSelected ? '선정 완료' : `회신 ${row.rfqQuoted}/${row.rfqTotal}` }}
              </span>
              <span v-if="row.poCount > 0" class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">
                발주 {{ row.poCount }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <template v-if="row.cartState === 'none'">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="QUOTE_CLS[row.quoteStatus]?.cls">
                  {{ QUOTE_CLS[row.quoteStatus]?.label }}
                </span>
              </template>
              <template v-else-if="row.cartState === 'cart'">
                <span class="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">장바구니</span>
              </template>
              <template v-else>
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="row.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
                  {{ row.odStatus }}
                </span>
              </template>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
              {{ fmtPcbAmount('KRW', row.finalPrice) }}
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
            <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ list.isFetching.value ? '불러오는 중…' : '해당 구간의 견적건이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between text-sm">
      <p class="text-gray-500">총 {{ total }}건</p>
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
