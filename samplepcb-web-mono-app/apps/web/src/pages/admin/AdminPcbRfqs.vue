<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AdminPcbRfqCaseItemType, AdminPcbRfqTabType } from '@sp/api-contract';
import { pcbMarginPercent } from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { useAdminPcbRfqCases, type AdminPcbRfqCaseFilters } from '../../admin/useAdminPcbRfqs';
import { useAdminPcbTodoCounts } from '../../admin/useAdminPcbCases';
import DeleteQuoteModal from '../../components/admin/DeleteQuoteModal.vue';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';
import PcbSelectionBar from '../../components/admin/pcb/PcbSelectionBar.vue';
import PcbTodoQueue from '../../components/admin/pcb/PcbTodoQueue.vue';
import { useRowSelection } from '../../admin/useRowSelection';
import { fmtPcbAmount, pcbKrwSuffix } from '../../lib/pcb-money';

// PCB 견적요청(RFQ) 워크큐 — docs/PCB_PARTNER_TRACK.md §5.4. 큐 흐름:
//   요청 대기(RFQ 미발송 — 스펙 축) → 회신 대기 → 선정 대기(내 차례) → 선정 완료.
// 첫 탭이 스펙 축인 이유: RFQ 행이 없는 건은 RFQ 축 모수에 들어올 수 없어 "요청해야
// 할 건"이 이 화면에 없었다. 배정·비교·선정 조작은 Case 상세(RFQ 패널)가 전담.

type RfqTabKey = AdminPcbRfqTabType | 'todo';

const router = useRouter();
const tab = ref<RfqTabKey>('todo');
const filters = ref<AdminPcbRfqCaseFilters>({ page: 1, pageSize: 20, tab: 'pending', q: '' });
const list = useAdminPcbRfqCases(filters);
const isAdminUser = computed(() => true); // 이 화면 자체가 관리자 전용 라우트
const { todoRfq } = useAdminPcbTodoCounts(isAdminUser);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const TABS: { key: RfqTabKey; label: string }[] = [
  { key: 'todo', label: '요청 대기' },
  { key: 'pending', label: '회신 대기' },
  { key: 'quoted', label: '선정 대기' },
  { key: 'selected', label: '선정 완료' },
  { key: 'all', label: '전체' },
];
const tabCount = (key: RfqTabKey): number | null =>
  key === 'todo' ? todoRfq.value : counts.value === null ? null : counts.value[key];

// 배치 삭제 선택 — 진행현황과 같은 공용 규칙·툴바·모달. RFQ 축 목록도 행은 견적(Case)
// 단위라 그대로 대상이 된다(차단·경고·사유 판정은 서버가 정본 — 여기서도 발주·선적이
// 걸린 건은 지워지지 않고, RFQ 만 나간 건은 "메일은 회수되지 않는다" 경고가 붙는다).
const pageIds = computed(() => rows.value.map((r) => r.specId));
const selection = useRowSelection(pageIds);
const deleteIds = ref<number[] | null>(null);
const onDeleted = (): void => {
  deleteIds.value = null;
  selection.clear();
};

const setTab = (key: RfqTabKey): void => {
  tab.value = key;
  if (key !== 'todo') filters.value = { ...filters.value, tab: key, page: 1 };
  selection.clear();
};

const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
  selection.clear();
};

const QUOTE_LABEL: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
};

// 마진 — 옆 열의 '고객 견적'(확정가)은 **VAT 포함 판매가**고 선정가는 원가라, 두 수의
// 차액을 눈으로 빼면 마진이 10%p 가까이 부풀어 보인다. 계약의 순수 함수가 VAT 를 걷어낸
// 뒤 나눈다(선정 모달이 쓰는 식과 같은 것 — 거기서 입력한 마진%가 여기 그대로 나온다).
// 확정가 전이거나 KRW 환산이 없으면 계산하지 않는다(선정만 하고 가격 미확정인 구간).
const marginOf = (row: AdminPcbRfqCaseItemType): number | null =>
  row.finalPrice === null || row.selectedKrwAmount === null
    ? null
    : pcbMarginPercent(row.finalPrice, row.selectedKrwAmount);

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
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 견적요청 (RFQ)</h1>

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
      <form v-if="tab !== 'todo'" class="pb-1" @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트명·고객명·아이디 검색"
          class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <!-- 요청 대기 — RFQ 행이 아직 없는 스펙 축(RFQ 축에는 존재하지 않는 모수) -->
    <PcbTodoQueue
      v-if="tab === 'todo'"
      kind="todo_rfq"
      from="rfqs"
      action-label="견적요청 →"
      empty-text="요청 대기 건이 없습니다."
    />

    <template v-else>
      <PcbSelectionBar
        :count="selection.selectedIds.value.length"
        @delete="deleteIds = [...selection.selectedIds.value]"
      />
      <div class="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="w-10 px-3 py-2.5 text-center" @click.stop>
                <input
                  type="checkbox"
                  class="size-4 accent-red-600"
                  :checked="selection.allSelected.value"
                  :indeterminate="selection.someSelected.value"
                  aria-label="현재 페이지 전체 선택"
                  :disabled="rows.length === 0"
                  @change="selection.toggleAll(($event.target as HTMLInputElement).checked)"
                >
              </th>
              <th class="whitespace-nowrap px-4 py-2.5">견적</th>
              <th class="px-4 py-2.5">프로젝트</th>
              <th class="px-4 py-2.5">고객명</th>
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
              :class="selection.isSelected(row.specId) ? 'bg-red-50/40' : ''"
              @click="openCase(row.specId)"
            >
              <td class="px-3 py-2.5 text-center" @click.stop>
                <input
                  type="checkbox"
                  class="size-4 accent-red-600"
                  :checked="selection.isSelected(row.specId)"
                  :aria-label="`Q${row.specId} 선택`"
                  @change="selection.toggleOne(row.specId)"
                >
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">Q{{ row.specId }}</td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
              <td class="px-4 py-2.5 text-gray-600">
                <PcbCustomerCell :name="row.customerName" :mb-id="row.mbId" />
              </td>
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
                <template v-if="row.selectedPartnerName !== null">
                  <span class="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
                    {{ row.selectedPartnerName }}
                  </span>
                  <!-- 선정가(우리 원가) — 확정가를 매기러 행을 열지 않아도 목록에서 판단이
                       서게 한다. 값은 선정 시점 박제라 오늘 환율로 흔들리지 않는다. -->
                  <span v-if="row.selectedPrice !== null" class="mt-0.5 block text-xs tabular-nums text-gray-600">
                    {{ fmtPcbAmount(row.selectedCurrency ?? 'KRW', row.selectedPrice) }}
                    <span class="text-gray-400">{{ pcbKrwSuffix(row.selectedCurrency ?? 'KRW', row.selectedKrwAmount) }}</span>
                    <span
                      v-if="marginOf(row) !== null"
                      class="ml-1 rounded px-1 py-0.5 text-[11px] font-semibold"
                      :class="(marginOf(row) ?? 0) < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'"
                      title="확정가에서 VAT 를 걷어낸 뒤 선정가와 비교한 값입니다 — 선정 모달의 마진%와 같은 식."
                    >
                      마진 {{ marginOf(row) }}%
                    </span>
                  </span>
                </template>
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
              <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
                해당 상태의 견적요청이 없습니다 — 시작은 [요청 대기] 탭에서 합니다.
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
          @click="filters = { ...filters, page: filters.page - 1 }; selection.clear()"
        >
          이전
        </button>
        <span class="text-gray-500">{{ filters.page }} / {{ totalPages }}</span>
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
          :disabled="filters.page >= totalPages"
          @click="filters = { ...filters, page: filters.page + 1 }; selection.clear()"
        >
          다음
        </button>
      </div>
    </template>

    <!-- 배치 영구 삭제 — 진행현황·견적 관리와 같은 모달(서버 판정이 정본) -->
    <DeleteQuoteModal
      v-if="deleteIds !== null"
      :ids="deleteIds"
      @close="deleteIds = null"
      @deleted="onDeleted"
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
