<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError, useAuthStore } from '@sp/shared';
import type { BomQuoteStatusType, BomQuoteSummaryType } from '@sp/api-contract';
import { useDeleteBomQuotes, useMyBomQuotes } from '../../bom/useBom';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: 'all' | BomQuoteStatusType; label: string }[] = [
  { value: 'all', label: '전체 상태' },
  { value: 'draft', label: '작성 중' },
  { value: 'requested', label: '견적 요청' },
  { value: 'reviewing', label: '검토 중' },
  { value: 'answered', label: '답변 완료' },
  { value: 'closed', label: '종료' },
  { value: 'canceled', label: '취소' },
];

const STATUS_LABEL: Record<BomQuoteStatusType, string> = {
  draft: '작성 중',
  requested: '견적 요청',
  reviewing: '검토 중',
  answered: '답변 완료',
  closed: '종료',
  canceled: '취소',
};

const router = useRouter();
const auth = useAuthStore();
const page = ref(1);
const searchInput = ref('');
const searchQuery = ref('');
const statusSelection = ref<'all' | BomQuoteStatusType>('all');
const statusQuery = computed<BomQuoteStatusType | null>(() => (
  statusSelection.value === 'all' ? null : statusSelection.value
));
const selectedIds = ref<string[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchInput, (value) => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery.value = value.trim();
  }, 250);
});

watch([searchQuery, statusQuery], () => {
  page.value = 1;
  selectedIds.value = [];
});

watch(page, () => {
  selectedIds.value = [];
});

onBeforeUnmount(() => {
  if (searchTimer !== null) clearTimeout(searchTimer);
});

const list = useMyBomQuotes(page, computed(() => auth.isLoggedIn), {
  pageSize: PAGE_SIZE,
  search: searchQuery,
  status: statusQuery,
});
const items = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const deletableCount = computed(() => list.data.value?.data.deletableCount ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const deletableOnPage = computed(() => items.value.filter((item) => item.status === 'draft'));
const allPageSelected = computed(() => (
  deletableOnPage.value.length > 0
  && deletableOnPage.value.every((item) => selectedIds.value.includes(item.id))
));
const somePageSelected = computed(() => (
  !allPageSelected.value && deletableOnPage.value.some((item) => selectedIds.value.includes(item.id))
));
const visiblePages = computed(() => {
  const first = Math.max(1, page.value - 2);
  const last = Math.min(pageCount.value, first + 4);
  const adjustedFirst = Math.max(1, last - 4);
  return Array.from({ length: last - adjustedFirst + 1 }, (_, index) => adjustedFirst + index);
});

function displayName(item: BomQuoteSummaryType): string {
  return item.fileName ?? item.title;
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtWon(value: number | null): string {
  return value === null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function statusClass(status: BomQuoteStatusType): string {
  if (status === 'draft') return 'bg-blue-50 text-blue-700';
  if (status === 'requested') return 'bg-violet-50 text-violet-700';
  if (status === 'reviewing') return 'bg-amber-50 text-amber-700';
  if (status === 'answered') return 'bg-emerald-50 text-emerald-700';
  if (status === 'closed') return 'bg-slate-100 text-slate-700';
  return 'bg-rose-50 text-rose-700';
}

function eventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function toggleSelection(id: string, checked: boolean): void {
  selectedIds.value = checked
    ? [...selectedIds.value, id]
    : selectedIds.value.filter((selectedId) => selectedId !== id);
}

function togglePageSelection(checked: boolean): void {
  selectedIds.value = checked ? deletableOnPage.value.map((item) => item.id) : [];
}

interface DeleteIntent {
  scope: 'single' | 'selected' | 'all';
  quoteIds: string[];
  label: string;
}

const deleteIntent = ref<DeleteIntent | null>(null);
const deleteResult = ref<{ tone: 'success' | 'error'; message: string } | null>(null);
const deleteQuotes = useDeleteBomQuotes();

function requestSingleDelete(item: BomQuoteSummaryType): void {
  if (item.status !== 'draft') return;
  deleteIntent.value = { scope: 'single', quoteIds: [item.id], label: displayName(item) };
}

function requestSelectedDelete(): void {
  if (selectedIds.value.length === 0) return;
  deleteIntent.value = {
    scope: 'selected',
    quoteIds: [...selectedIds.value],
    label: `선택한 ${String(selectedIds.value.length)}건`,
  };
}

function requestAllDelete(): void {
  if (deletableCount.value === 0) return;
  deleteIntent.value = {
    scope: 'all',
    quoteIds: [],
    label: `작성 중 견적 전체 ${String(deletableCount.value)}건`,
  };
}

async function confirmDelete(): Promise<void> {
  const intent = deleteIntent.value;
  if (intent === null) return;
  deleteResult.value = null;
  try {
    const result = await deleteQuotes.mutateAsync(
      intent.scope === 'all'
        ? { scope: 'all' }
        : { scope: 'selected', quoteIds: intent.quoteIds },
    );
    selectedIds.value = [];
    deleteIntent.value = null;
    deleteResult.value = {
      tone: 'success',
      message: `${String(result.data.deletedCount)}건을 삭제했습니다.${result.data.retainedCount > 0 ? ` 보호 상태 ${String(result.data.retainedCount)}건은 유지했습니다.` : ''}`,
    };
    await list.refetch();
    if (page.value > pageCount.value) page.value = pageCount.value;
  } catch (reason) {
    deleteResult.value = {
      tone: 'error',
      message: reason instanceof ApiRequestError ? reason.message : '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden p-5">
    <header class="flex flex-wrap items-start justify-between gap-4 px-1">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">BOM history</p>
        <h1 class="mt-1 text-[22px] font-bold text-[#061023]">BOM 분석 내역</h1>
        <p class="mt-1 text-[13px] text-[#687386]">업로드한 BOM과 견적 진행 상태를 확인하고 관리합니다.</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-[38px] rounded-lg border border-rose-200 bg-white px-4 text-[13px] font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="deletableCount === 0"
          @click="requestAllDelete"
        >
          전체 삭제<span v-if="deletableCount > 0"> ({{ deletableCount }})</span>
        </button>
        <button type="button" class="h-[38px] rounded-lg bg-[#1e64fd] px-4 text-[13px] font-semibold text-white hover:bg-blue-700" @click="router.push({ name: 'bom' })">
          + 새 BOM 업로드
        </button>
      </div>
    </header>

    <div
      v-if="deleteResult !== null"
      class="mt-4 flex items-center justify-between rounded-lg border px-4 py-2.5 text-[13px]"
      :class="deleteResult.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'"
      role="status"
    >
      <span>{{ deleteResult.message }}</span>
      <button type="button" class="ml-4 font-bold" aria-label="알림 닫기" @click="deleteResult = null">×</button>
    </div>

    <section class="mt-4 flex min-h-0 flex-1 flex-col rounded-xl border border-[#e1e6ef] bg-white shadow-[0_4px_18px_rgba(19,33,68,0.05)]">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ebf0] px-4 py-3">
        <div class="flex flex-1 flex-wrap items-center gap-2">
          <label class="relative min-w-[220px] max-w-[380px] flex-1">
            <span class="sr-only">파일명 또는 견적명 검색</span>
            <input
              v-model="searchInput"
              type="search"
              placeholder="파일명 또는 견적명 검색"
              class="h-[38px] w-full rounded-lg border border-[#d6dde8] bg-white pl-3 pr-9 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
          </label>
          <select v-model="statusSelection" class="h-[38px] rounded-lg border border-[#d6dde8] bg-white px-3 text-[13px] font-medium text-[#4f5b6e] outline-none focus:border-blue-500" aria-label="견적 상태 필터">
            <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[12px] text-[#778194]">총 <b class="tabular-nums text-[#293346]">{{ total }}</b>건</span>
          <button
            type="button"
            class="h-[34px] rounded-lg bg-rose-600 px-3 text-[12px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-35"
            :disabled="selectedIds.length === 0"
            @click="requestSelectedDelete"
          >
            선택 삭제<span v-if="selectedIds.length > 0"> ({{ selectedIds.length }})</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full min-w-[900px] table-fixed">
          <thead class="sticky top-0 z-10 bg-[#f8fafc] shadow-[0_1px_0_#e5e8ed]">
            <tr class="text-left text-[11px] uppercase tracking-wide text-[#8e97a5]">
              <th class="w-[48px] px-3 py-3 text-center">
                <input
                  type="checkbox"
                  class="size-4 rounded border-gray-300 text-blue-600"
                  :checked="allPageSelected"
                  :indeterminate="somePageSelected"
                  :disabled="deletableOnPage.length === 0"
                  aria-label="현재 페이지의 삭제 가능한 견적 전체 선택"
                  @change="togglePageSelection(eventChecked($event))"
                >
              </th>
              <th class="w-[31%] px-3 py-3">파일 / 견적명</th>
              <th class="w-[110px] px-3 py-3">상태</th>
              <th class="w-[120px] px-3 py-3">부품 / 매칭</th>
              <th class="w-[130px] px-3 py-3 text-right">예상 금액</th>
              <th class="w-[170px] px-3 py-3">최근 수정</th>
              <th class="w-[90px] px-3 py-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#edf0f4]">
            <tr v-for="item in items" :key="item.id" class="group hover:bg-[#f9fbff]" :class="selectedIds.includes(item.id) ? 'bg-blue-50/60' : ''">
              <td class="px-3 py-3 text-center">
                <input
                  v-if="item.status === 'draft'"
                  type="checkbox"
                  class="size-4 rounded border-gray-300 text-blue-600"
                  :checked="selectedIds.includes(item.id)"
                  :aria-label="`${displayName(item)} 선택`"
                  @change="toggleSelection(item.id, eventChecked($event))"
                >
                <span v-else class="text-[11px] text-gray-300" title="진행 중이거나 완료된 견적은 보호됩니다">—</span>
              </td>
              <td class="px-3 py-3">
                <RouterLink :to="{ name: 'bom-quote', params: { id: item.id } }" class="block truncate text-[13px] font-semibold text-[#172033] hover:text-blue-600" :title="displayName(item)">
                  {{ displayName(item) }}
                </RouterLink>
                <p v-if="item.fileName !== null && item.title !== item.fileName" class="mt-0.5 truncate text-[11px] text-[#8a94a5]">{{ item.title }}</p>
              </td>
              <td class="px-3 py-3">
                <span class="inline-flex rounded-full px-2 py-1 text-[11px] font-semibold" :class="statusClass(item.status)">{{ STATUS_LABEL[item.status] }}</span>
              </td>
              <td class="px-3 py-3 text-[12px] text-[#5f697a]">
                <p><b class="tabular-nums text-[#293346]">{{ item.itemCount }}</b>개 부품</p>
                <p class="mt-0.5 text-[11px] text-[#8a94a5]">매칭 {{ item.matchedCount }}/{{ item.itemCount }}</p>
              </td>
              <td class="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-[#293346]">{{ fmtWon(item.finalTotal) }}</td>
              <td class="px-3 py-3 text-[12px] tabular-nums text-[#697487]">{{ fmtDate(item.updatedAt) }}</td>
              <td class="px-3 py-3 text-right">
                <button
                  v-if="item.status === 'draft'"
                  type="button"
                  class="rounded-md border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 opacity-80 hover:bg-rose-50 hover:opacity-100"
                  @click="requestSingleDelete(item)"
                >
                  삭제
                </button>
                <span v-else class="text-[10px] text-[#a0a8b5]">보호됨</span>
              </td>
            </tr>
            <tr v-if="items.length === 0 && !list.isLoading.value">
              <td colspan="7" class="px-4 py-16 text-center">
                <p class="text-[14px] font-semibold text-[#6f798b]">조건에 맞는 BOM 내역이 없습니다.</p>
                <p class="mt-1 text-[12px] text-[#9aa3b2]">검색어 또는 상태 필터를 변경해 보세요.</p>
              </td>
            </tr>
            <tr v-if="list.isLoading.value">
              <td colspan="7" class="px-4 py-16 text-center text-[13px] text-[#7d8798]">BOM 내역을 불러오는 중입니다…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="flex min-h-[54px] items-center justify-between gap-3 border-t border-[#e8ebf0] px-4 py-2">
        <p class="text-[11px] text-[#8a94a5]">작성 중 상태만 삭제할 수 있으며 요청·검토·답변 견적은 보호됩니다.</p>
        <nav v-if="pageCount > 1" class="flex items-center gap-1" aria-label="BOM 내역 페이지">
          <button type="button" class="grid size-8 place-items-center rounded-md border border-gray-200 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-35" :disabled="page <= 1" aria-label="이전 페이지" @click="page -= 1">‹</button>
          <button
            v-for="number in visiblePages"
            :key="number"
            type="button"
            class="grid size-8 place-items-center rounded-md text-[12px] font-semibold"
            :class="number === page ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'"
            :aria-current="number === page ? 'page' : undefined"
            @click="page = number"
          >
            {{ number }}
          </button>
          <button type="button" class="grid size-8 place-items-center rounded-md border border-gray-200 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-35" :disabled="page >= pageCount" aria-label="다음 페이지" @click="page += 1">›</button>
        </nav>
      </footer>
    </section>

    <Teleport to="body">
      <div v-if="deleteIntent !== null" class="fixed inset-0 z-[90] grid place-items-center bg-slate-950/50 p-4" @mousedown.self="!deleteQuotes.isPending.value && (deleteIntent = null)">
        <section class="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-bom-title">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-500">Delete BOM</p>
              <h2 id="delete-bom-title" class="mt-1 text-[18px] font-bold text-[#172033]">{{ deleteIntent.label }} 삭제</h2>
            </div>
            <button type="button" class="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100" aria-label="삭제 확인 닫기" :disabled="deleteQuotes.isPending.value" @click="deleteIntent = null">×</button>
          </div>
          <p class="mt-4 text-[13px] leading-6 text-[#596578]">이 작업은 되돌릴 수 없으며 업로드한 원본 파일과 분석 결과가 함께 삭제됩니다.</p>
          <p v-if="deleteIntent.scope === 'all'" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">견적 요청 이후 단계의 내역은 업무 이력 보호를 위해 삭제하지 않고 유지합니다.</p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="h-9 rounded-lg border border-gray-300 px-4 text-[13px] font-semibold text-gray-600 hover:bg-gray-50" :disabled="deleteQuotes.isPending.value" @click="deleteIntent = null">취소</button>
            <button type="button" class="h-9 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50" :disabled="deleteQuotes.isPending.value" @click="confirmDelete">
              {{ deleteQuotes.isPending.value ? '삭제 중…' : '삭제 확인' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
