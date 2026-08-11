<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
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
const listErrorEl = ref<HTMLElement | null>(null);
const deleteDialogEl = ref<HTMLElement | null>(null);
const deleteResultEl = ref<HTMLElement | null>(null);
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
  teardownDeleteDialog();
});

const list = useMyBomQuotes(page, computed(() => auth.isLoggedIn), {
  pageSize: PAGE_SIZE,
  search: searchQuery,
  status: statusQuery,
});

watch(() => list.isError.value, async (isError) => {
  if (!isError) return;
  await nextTick();
  listErrorEl.value?.focus();
});
const items = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const deletableCount = computed(() => list.data.value?.data.deletableCount ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const deletableOnPage = computed(() => items.value.filter((item) => isDeletableStatus(item.status)));
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

function isDeletableStatus(status: BomQuoteStatusType): boolean {
  return status === 'draft' || status === 'canceled';
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
const deleteError = ref('');
const deleteQuotes = useDeleteBomQuotes();
let deleteOpener: HTMLElement | null = null;
let previousBodyOverflow = '';
let deleteDialogActive = false;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableDeleteElements(): HTMLElement[] {
  const dialog = deleteDialogEl.value;
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function onDeleteDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!deleteQuotes.isPending.value) void closeDeleteDialog();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = deleteDialogEl.value;
  if (dialog === null) return;
  const focusable = focusableDeleteElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function teardownDeleteDialog(): void {
  if (!deleteDialogActive) return;
  window.removeEventListener('keydown', onDeleteDialogKeydown);
  document.body.style.overflow = previousBodyOverflow;
  deleteDialogActive = false;
}

async function openDeleteDialog(intent: DeleteIntent): Promise<void> {
  deleteOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousBodyOverflow = document.body.style.overflow;
  deleteError.value = '';
  deleteResult.value = null;
  deleteQuotes.reset();
  deleteIntent.value = intent;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onDeleteDialogKeydown);
  deleteDialogActive = true;
  await nextTick();
  deleteDialogEl.value?.focus();
}

async function closeDeleteDialog(restoreFocus = true): Promise<void> {
  if (deleteQuotes.isPending.value) return;
  deleteIntent.value = null;
  deleteError.value = '';
  teardownDeleteDialog();
  const opener = deleteOpener;
  deleteOpener = null;
  if (!restoreFocus) return;
  await nextTick();
  opener?.focus();
}

function requestSingleDelete(item: BomQuoteSummaryType): void {
  if (!isDeletableStatus(item.status)) return;
  void openDeleteDialog({ scope: 'single', quoteIds: [item.id], label: displayName(item) });
}

function requestSelectedDelete(): void {
  if (selectedIds.value.length === 0) return;
  void openDeleteDialog({
    scope: 'selected',
    quoteIds: [...selectedIds.value],
    label: `선택한 ${String(selectedIds.value.length)}건`,
  });
}

function requestAllDelete(): void {
  if (deletableCount.value === 0) return;
  void openDeleteDialog({
    scope: 'all',
    quoteIds: [],
    label: `작성 중·취소 견적 전체 ${String(deletableCount.value)}건`,
  });
}

function deleteSuccessMessage(deletedCount: number, retainedCount: number): string {
  if (deletedCount === 0 && retainedCount > 0) {
    return `삭제 직전에 진행 상태가 바뀐 ${String(retainedCount)}건은 삭제하지 않고 보호했습니다.`;
  }
  return `${String(deletedCount)}건을 삭제했습니다.${retainedCount > 0 ? ` 보호 상태 ${String(retainedCount)}건은 유지했습니다.` : ''}`;
}

async function retryList(): Promise<void> {
  await list.refetch();
}

async function confirmDelete(): Promise<void> {
  const intent = deleteIntent.value;
  if (intent === null) return;
  deleteResult.value = null;
  deleteError.value = '';
  try {
    const result = await deleteQuotes.mutateAsync(
      intent.scope === 'all'
        ? { scope: 'all' }
        : { scope: 'selected', quoteIds: intent.quoteIds },
    );
    selectedIds.value = [];
    deleteResult.value = {
      tone: 'success',
      message: deleteSuccessMessage(result.data.deletedCount, result.data.retainedCount),
    };
    await closeDeleteDialog(false);
    await list.refetch();
    if (page.value > pageCount.value) page.value = pageCount.value;
    await nextTick();
    deleteResultEl.value?.focus();
  } catch (reason) {
    deleteError.value = reason instanceof ApiRequestError
      ? reason.message
      : '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden p-5">
    <header class="flex flex-wrap items-start justify-between gap-4 px-1">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">BOM history</p>
        <h1 class="mt-1 text-[22px] font-bold text-ink-strong">BOM 분석 내역</h1>
        <p class="mt-1 text-[13px] text-ink-muted">업로드한 BOM과 견적 진행 상태를 확인하고 관리합니다.</p>
      </div>
      <div class="flex flex-wrap items-start justify-end gap-2">
        <div class="flex flex-col items-end gap-0.5">
          <button
            type="button"
            class="min-h-[38px] rounded-lg border border-rose-200 bg-surface px-4 py-2 text-[13px] font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            :aria-label="`작성 중·취소 전체 삭제${deletableCount > 0 ? ` (${String(deletableCount)})` : ''}`"
            :disabled="deletableCount === 0"
            @click="requestAllDelete"
          >
            작성 중·취소 전체 삭제<span v-if="deletableCount > 0"> ({{ deletableCount }})</span>
          </button>
          <span v-if="deletableCount > 0" class="text-[10px] text-ink-faint">검색·필터와 관계없이 적용</span>
        </div>
        <button type="button" class="h-[38px] rounded-lg bg-brand-strong px-4 text-[13px] font-semibold text-white hover:bg-blue-700" @click="router.push({ name: 'bom' })">
          + 새 BOM 업로드
        </button>
      </div>
    </header>

    <div
      v-if="deleteResult !== null"
      ref="deleteResultEl"
      class="mt-4 flex items-center justify-between rounded-lg border px-4 py-2.5 text-[13px]"
      :class="deleteResult.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'"
      role="status"
      tabindex="-1"
    >
      <span>{{ deleteResult.message }}</span>
      <button type="button" class="ml-4 font-bold" aria-label="알림 닫기" @click="deleteResult = null">×</button>
    </div>

    <section class="mt-4 flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface shadow-[0_4px_18px_rgba(19,33,68,0.05)]">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div class="flex flex-1 flex-wrap items-center gap-2">
          <label class="relative min-w-[220px] max-w-[380px] flex-1">
            <span class="sr-only">파일명 또는 견적명 검색</span>
            <input
              v-model="searchInput"
              type="search"
              placeholder="파일명 또는 견적명 검색"
              class="h-[38px] w-full rounded-lg border border-line bg-surface pl-3 pr-9 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
          </label>
          <select v-model="statusSelection" class="h-[38px] rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-muted outline-none focus:border-blue-500" aria-label="견적 상태 필터">
            <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[12px] text-ink-subtle">총 <b class="tabular-nums text-ink">{{ total }}</b>건</span>
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

      <div
        v-if="list.isError.value"
        ref="listErrorEl"
        class="m-4 flex min-h-[260px] flex-1 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-5 py-10 text-center outline-none focus:ring-2 focus:ring-red-200"
        role="alert"
        aria-labelledby="bom-history-load-error-title"
        tabindex="-1"
      >
        <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-red-500">Load failed</p>
        <h2 id="bom-history-load-error-title" class="mt-2 text-[16px] font-bold text-red-800">BOM 내역을 불러오지 못했습니다</h2>
        <p class="mt-2 text-[13px] leading-6 text-red-700">빈 내역이 아닙니다. 연결을 확인한 뒤 같은 화면에서 다시 불러와 주세요.</p>
        <button
          type="button"
          class="mt-4 min-h-10 rounded-lg border border-red-300 bg-white px-4 text-[13px] font-bold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-50"
          :disabled="list.isFetching.value"
          @click="retryList"
        >
          {{ list.isFetching.value ? '다시 불러오는 중…' : '다시 불러오기' }}
        </button>
      </div>

      <p v-else-if="items.length > 0" class="border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] font-medium text-blue-700 xl:hidden">
        표를 좌우로 밀어 상태·금액·관리 열을 확인하세요.
      </p>

      <div v-if="!list.isError.value" class="min-h-0 flex-1 overflow-auto">
        <table class="w-full min-w-[900px] table-fixed">
          <thead class="sticky top-0 z-10 bg-surface-sunken shadow-[0_1px_0_var(--color-line-soft)]">
            <tr class="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
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
              <th class="w-[120px] px-3 py-3">부품 / 선정</th>
              <th class="w-[130px] px-3 py-3 text-right">예상 금액</th>
              <th class="w-[170px] px-3 py-3">최근 수정</th>
              <th class="w-[90px] px-3 py-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-soft">
            <tr v-for="item in items" :key="item.id" class="group hover:bg-surface-raised" :class="selectedIds.includes(item.id) ? 'bg-blue-50/60' : ''">
              <td class="px-3 py-3 text-center">
                <input
                  v-if="isDeletableStatus(item.status)"
                  type="checkbox"
                  class="size-4 rounded border-gray-300 text-blue-600"
                  :checked="selectedIds.includes(item.id)"
                  :aria-label="`${displayName(item)} 선택`"
                  @change="toggleSelection(item.id, eventChecked($event))"
                >
                <span v-else class="text-[11px] text-gray-300" title="요청·검토·답변·종료 견적은 보호됩니다">—</span>
              </td>
              <td class="px-3 py-3">
                <RouterLink :to="{ name: 'bom-quote', params: { id: item.id } }" class="block truncate text-[13px] font-semibold text-ink-strong hover:text-blue-600" :title="displayName(item)">
                  {{ displayName(item) }}
                </RouterLink>
                <p v-if="item.fileName !== null && item.title !== item.fileName" class="mt-0.5 truncate text-[11px] text-ink-subtle">{{ item.title }}</p>
              </td>
              <td class="px-3 py-3">
                <span class="inline-flex rounded-full px-2 py-1 text-[11px] font-semibold" :class="statusClass(item.status)">{{ STATUS_LABEL[item.status] }}</span>
              </td>
              <td class="px-3 py-3 text-[12px] text-ink-muted">
                <p><b class="tabular-nums text-ink">{{ item.itemCount }}</b>개 부품</p>
                <p class="mt-0.5 text-[11px] text-ink-subtle">선정 {{ item.matchedCount }}/{{ item.itemCount }}</p>
              </td>
              <td class="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-ink">{{ fmtWon(item.finalTotal) }}</td>
              <td class="px-3 py-3 text-[12px] tabular-nums text-ink-subtle">{{ fmtDate(item.updatedAt) }}</td>
              <td class="px-3 py-3 text-right">
                <button
                  v-if="isDeletableStatus(item.status)"
                  type="button"
                  class="rounded-md border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 opacity-80 hover:bg-rose-50 hover:opacity-100"
                  @click="requestSingleDelete(item)"
                >
                  삭제
                </button>
                <span v-else class="text-[10px] text-ink-faint">보호됨</span>
              </td>
            </tr>
            <tr v-if="items.length === 0 && !list.isLoading.value">
              <td colspan="7" class="px-4 py-16 text-center">
                <p class="text-[14px] font-semibold text-ink-subtle">조건에 맞는 BOM 내역이 없습니다.</p>
                <p class="mt-1 text-[12px] text-ink-faint">검색어 또는 상태 필터를 변경해 보세요.</p>
              </td>
            </tr>
            <tr v-if="list.isLoading.value">
              <td colspan="7" class="px-4 py-16 text-center text-[13px] text-ink-subtle">BOM 내역을 불러오는 중입니다…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!list.isError.value" class="flex min-h-[54px] items-center justify-between gap-3 border-t border-line px-4 py-2">
        <p class="text-[11px] text-ink-subtle">작성 중·취소 상태만 삭제할 수 있으며 요청·검토·답변·종료 견적은 보호됩니다.</p>
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
      <div v-if="deleteIntent !== null" class="fixed inset-0 z-[90] grid place-items-center bg-slate-950/50 p-4" @mousedown.self="closeDeleteDialog()">
        <section
          ref="deleteDialogEl"
          class="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl outline-none focus:ring-2 focus:ring-rose-200"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-bom-title"
          aria-describedby="delete-bom-description"
          tabindex="-1"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-500">Delete BOM</p>
              <h2 id="delete-bom-title" class="mt-1 text-[18px] font-bold text-ink-strong">{{ deleteIntent.label }} 삭제</h2>
            </div>
            <button type="button" class="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100" aria-label="삭제 확인 닫기" :disabled="deleteQuotes.isPending.value" @click="closeDeleteDialog()">×</button>
          </div>
          <p id="delete-bom-description" class="mt-4 text-[13px] leading-6 text-ink-muted">이 작업은 되돌릴 수 없으며 업로드한 원본 파일과 분석 결과가 함께 삭제됩니다.</p>
          <div v-if="deleteIntent.scope === 'all'" class="mt-2 space-y-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
            <p class="font-semibold">현재 검색어·상태 필터와 관계없이 이 계정의 작성 중·취소 견적 전체에 적용됩니다.</p>
            <p>요청·검토·답변·종료 상태는 업무 이력 보호를 위해 삭제하지 않고 유지합니다.</p>
          </div>
          <div v-if="deleteError !== ''" class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-800" role="alert">
            <p class="font-bold">삭제를 완료하지 못했습니다.</p>
            <p>{{ deleteError }}</p>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="h-9 rounded-lg border border-gray-300 px-4 text-[13px] font-semibold text-gray-600 hover:bg-gray-50" :disabled="deleteQuotes.isPending.value" @click="closeDeleteDialog()">취소</button>
            <button type="button" class="h-9 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50" :disabled="deleteQuotes.isPending.value" @click="confirmDelete">
              {{ deleteQuotes.isPending.value ? '삭제 중…' : deleteError !== '' ? '다시 삭제 시도' : '삭제 확인' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
