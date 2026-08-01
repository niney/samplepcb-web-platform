<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { AdminBomQuoteSummaryType, BomQuoteStatusType } from '@sp/api-contract';
import { useAdminBomQuotes, usePatchAdminBomQuote } from '../../admin/useAdminBomQuotes';
import BomCaseBulkDeleteModal from '../../components/admin/smartbom/BomCaseBulkDeleteModal.vue';
import {
  SMARTBOM_STATUS_META,
  smartbomCaseNo,
  smartbomFmtDate,
  smartbomFmtWon,
} from '../../admin/smartbom';

// 견적관리 워크큐(관리자 메뉴 재편) — 견적 담당의 화면. 진행현황(12단계 조감)과 달리
// 견적 흐름만 본다: 검토 대기 → RFQ 발송·회신 수집(reviewing 의 실황을 RFQ n/m 로
// 노출) → 고객 회신(answered). RFQ 발송·비교·선정은 Case 상세(RFQ 패널)가 전담.

const router = useRouter();
const statusFilter = ref<BomQuoteStatusType | null>('requested');
const page = ref(1);
const list = useAdminBomQuotes(statusFilter, page);
const patch = usePatchAdminBomQuote();

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));
const selectedIds = ref<Set<string>>(new Set());
const bulkDeleteIds = ref<string[]>([]);
const bulkDeleteCoversPage = ref(false);
const bulkDeleteOpen = ref(false);
const selectedCount = computed(() => selectedIds.value.size);
const allRowsSelected = computed(() =>
  rows.value.length > 0 && rows.value.every((row) => selectedIds.value.has(row.id)),
);
const someRowsSelected = computed(() =>
  !allRowsSelected.value && rows.value.some((row) => selectedIds.value.has(row.id)),
);

const TABS: { key: BomQuoteStatusType | null; label: string }[] = [
  { key: 'requested', label: '검토 대기' },
  { key: 'reviewing', label: 'RFQ 진행' },
  { key: 'answered', label: '회신 완료' },
  { key: 'closed', label: '종료' },
  { key: null, label: '전체' },
];

const tabCount = (key: BomQuoteStatusType | null): number | null => {
  if (counts.value === null) return null;
  return key === null ? counts.value.all : counts.value[key];
};

// RFQ 실황 — reviewing 인데 미발송이면 다음 액션이 "RFQ 보내기"임을 큐에서 바로 보이게.
const rfqBadge = (
  q: AdminBomQuoteSummaryType,
): { label: string; cls: string } => {
  if (q.rfqTotal === 0) {
    return q.status === 'reviewing'
      ? { label: 'RFQ 미발송', cls: 'bg-amber-100 text-amber-700' }
      : { label: '—', cls: 'text-gray-300' };
  }
  const done = q.rfqReplied >= q.rfqTotal;
  return {
    label: `회신 ${String(q.rfqReplied)}/${String(q.rfqTotal)}`,
    cls: done ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700',
  };
};

// from=quotes — Case 상세가 견적 관련 섹션만 펼치고 RFQ 패널로 스크롤(§6.12)
function openCase(id: string): void {
  void router.push({ name: 'admin-smartbom-case', params: { id }, query: { from: 'quotes' } });
}

function toggleRow(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function toggleAllRows(): void {
  const next = new Set(selectedIds.value);
  if (allRowsSelected.value) {
    for (const row of rows.value) next.delete(row.id);
  } else {
    for (const row of rows.value) next.add(row.id);
  }
  selectedIds.value = next;
}

function clearSelection(): void {
  selectedIds.value = new Set();
}

function openBulkDelete(): void {
  bulkDeleteIds.value = rows.value
    .filter((row) => selectedIds.value.has(row.id))
    .map((row) => row.id);
  bulkDeleteCoversPage.value = rows.value.length > 0
    && rows.value.every((row) => selectedIds.value.has(row.id));
  bulkDeleteOpen.value = bulkDeleteIds.value.length > 0;
}

function closeBulkDelete(): void {
  bulkDeleteOpen.value = false;
  bulkDeleteIds.value = [];
  bulkDeleteCoversPage.value = false;
}

function finishBulkDelete(deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  const next = new Set(selectedIds.value);
  for (const id of deleted) next.delete(id);
  const currentPageEmptied = bulkDeleteCoversPage.value
    && bulkDeleteIds.value.every((id) => deleted.has(id));
  selectedIds.value = next;
  closeBulkDelete();
  if (currentPageEmptied && page.value > 1) page.value -= 1;
}

watch([statusFilter, page], () => {
  clearSelection();
});

const startError = ref('');
async function startReview(id: string): Promise<void> {
  startError.value = '';
  try {
    await patch.mutateAsync({ quoteId: id, body: { status: 'reviewing' } });
    openCase(id);
  } catch {
    startError.value = '검토 시작에 실패했습니다 — 목록을 새로고침해 주세요.';
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">견적관리</h1>

    <!-- 견적 흐름 탭 -->
    <div class="flex flex-wrap gap-1 border-b border-gray-200">
      <button
        v-for="tab in TABS"
        :key="tab.key ?? 'all'"
        type="button"
        class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
        :class="statusFilter === tab.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
        @click="statusFilter = tab.key; page = 1"
      >
        {{ tab.label }}
        <span v-if="tabCount(tab.key) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(tab.key) }}</span>
      </button>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p class="text-xs text-gray-500">
        현재 페이지에서 Case를 체크해 함께 삭제할 수 있습니다.
        <b v-if="selectedCount > 0" class="ml-1 text-gray-800">{{ selectedCount }}건 선택</b>
      </p>
      <button
        type="button"
        class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
        :disabled="selectedCount === 0"
        @click="openBulkDelete"
      >
        선택 {{ selectedCount }}건 영구 삭제
      </button>
    </div>

    <p v-if="startError !== ''" class="text-xs font-semibold text-red-600">{{ startError }}</p>

    <!-- 견적 목록 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="w-10 px-3 py-2.5 text-center" @click.stop>
              <input
                type="checkbox"
                class="size-4 accent-red-600"
                aria-label="현재 페이지 Case 전체 선택"
                :checked="allRowsSelected"
                :indeterminate="someRowsSelected"
                :disabled="rows.length === 0"
                @change="toggleAllRows"
              >
            </th>
            <th class="whitespace-nowrap px-4 py-2.5">Case</th>
            <th class="px-4 py-2.5">견적명</th>
            <th class="px-4 py-2.5">고객</th>
            <th class="whitespace-nowrap px-4 py-2.5">품목(매칭)</th>
            <th class="whitespace-nowrap px-4 py-2.5">RFQ</th>
            <th class="whitespace-nowrap px-4 py-2.5">예상 합계</th>
            <th class="whitespace-nowrap px-4 py-2.5">요청일</th>
            <th class="px-4 py-2.5">상태</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="q in rows"
            :key="q.id"
            class="cursor-pointer hover:bg-blue-50/40"
            :class="selectedIds.has(q.id) ? 'bg-red-50/40' : ''"
            @click="openCase(q.id)"
          >
            <td class="px-3 py-2.5 text-center" @click.stop>
              <input
                type="checkbox"
                class="size-4 accent-red-600"
                :aria-label="`${smartbomCaseNo(q.id, q.requestedAt, q.createdAt)} 선택`"
                :checked="selectedIds.has(q.id)"
                @change="toggleRow(q.id)"
              >
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
              {{ smartbomCaseNo(q.id, q.requestedAt, q.createdAt) }}
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ q.title }}</td>
            <td class="px-4 py-2.5 text-gray-600">{{ q.mbId }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
              {{ q.includedCount }}/{{ q.itemCount }} ({{ q.matchedCount }})
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="rfqBadge(q).cls">
                {{ rfqBadge(q).label }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">{{ smartbomFmtWon(q.finalTotal) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ smartbomFmtDate(q.requestedAt) }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="SMARTBOM_STATUS_META[q.status].cls">
                {{ SMARTBOM_STATUS_META[q.status].label }}
              </span>
              <!-- 회신은 됐지만 확정가가 없어 고객 주문이 잠긴 건 — 견적 담당의 남은 일 -->
              <span
                v-if="q.status === 'answered' && q.confirmedTotal === null && q.orderState === 'none'"
                class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                title="확정 총액을 등록해야 고객이 주문할 수 있습니다"
              >
                확정가 미등록
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                v-if="q.status === 'requested'"
                type="button"
                class="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
                :disabled="patch.isPending.value"
                @click.stop="startReview(q.id)"
              >
                검토 시작
              </button>
              <button
                v-else-if="q.status === 'reviewing'"
                type="button"
                class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                @click.stop="openCase(q.id)"
              >
                RFQ 관리 →
              </button>
              <button
                v-else
                type="button"
                class="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                @click.stop="openCase(q.id)"
              >
                Case 열기
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
              해당 상태의 견적이 없습니다.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 페이지네이션 -->
    <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
      <button
        type="button"
        class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
        :disabled="page <= 1"
        @click="page -= 1"
      >
        이전
      </button>
      <span class="text-gray-500">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
        :disabled="page >= totalPages"
        @click="page += 1"
      >
        다음
      </button>
    </div>

    <BomCaseBulkDeleteModal
      v-if="bulkDeleteOpen"
      :quote-ids="bulkDeleteIds"
      @close="closeBulkDelete"
      @deleted="finishBulkDelete"
    />
  </div>
</template>
