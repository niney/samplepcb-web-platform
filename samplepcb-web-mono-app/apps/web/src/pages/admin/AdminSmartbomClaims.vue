<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_CLAIM_KIND_LABELS,
  BOM_CLAIM_RESOLUTION_LABELS,
  BOM_CLAIM_STATUS_LABELS,
  type AdminBomClaimListQueryType,
  type BomClaimResolutionKindType,
  type BomClaimStatusType,
} from '@sp/api-contract';
import {
  useAdminBomClaim,
  useAdminBomClaims,
  useTransitionAdminBomClaim,
  type AdminBomClaimFilters,
} from '../../admin/useAdminBomClaims';

type ClaimTab = AdminBomClaimListQueryType['status'];

const page = ref(1);
const status = ref<ClaimTab>('pending');
const searchDraft = ref('');
const search = ref('');
const filters = computed<AdminBomClaimFilters>(() => ({
  page: page.value,
  pageSize: 20,
  status: status.value,
  search: search.value,
}));
const listQuery = useAdminBomClaims(filters);
const counts = computed(() => listQuery.data.value?.data.counts ?? {
  all: 0,
  pending: 0,
  open: 0,
  reviewing: 0,
  resolved: 0,
  rejected: 0,
});
const items = computed(() => listQuery.data.value?.data.items ?? []);
const totalPages = computed(() => Math.max(1, Math.ceil((listQuery.data.value?.data.total ?? 0) / 20)));

const tabs = computed(() => [
  { key: 'pending' as const, label: '처리 필요', count: counts.value.pending },
  { key: 'open' as const, label: '새 접수', count: counts.value.open },
  { key: 'reviewing' as const, label: '검토 중', count: counts.value.reviewing },
  { key: 'resolved' as const, label: '해결 완료', count: counts.value.resolved },
  { key: 'rejected' as const, label: '처리 불가', count: counts.value.rejected },
  { key: 'all' as const, label: '전체', count: counts.value.all },
]);

watch(status, () => { page.value = 1; });

function applySearch(): void {
  search.value = searchDraft.value.trim();
  page.value = 1;
}

const selectedClaimId = ref<string | null>(null);
const detailEnabled = computed(() => selectedClaimId.value !== null);
const detailQuery = useAdminBomClaim(selectedClaimId, detailEnabled);
const selectedClaim = computed(() => {
  const detail = detailQuery.data.value?.data;
  if (detail !== undefined) return detail;
  return items.value.find((item) => item.id === selectedClaimId.value) ?? null;
});
const transitionClaim = useTransitionAdminBomClaim();
const resolutionKind = ref<BomClaimResolutionKindType>('replacement');
const responseText = ref('');
const actionError = ref('');
const pageRoot = ref<HTMLElement | null>(null);
const dialogEl = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let focusPageAfterClose = false;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  if (dialogEl.value === null) return [];
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function restoreDialogEnvironment(): void {
  window.removeEventListener('keydown', onDialogKeydown);
  document.body.style.overflow = previousBodyOverflow;
  const target = focusPageAfterClose || previousFocus?.isConnected !== true
    ? pageRoot.value
    : previousFocus;
  focusPageAfterClose = false;
  target?.focus();
  previousFocus = null;
}

function closeDetail(): void {
  if (transitionClaim.isPending.value) return;
  selectedClaimId.value = null;
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (selectedClaimId.value === null) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDetail();
    return;
  }
  if (event.key !== 'Tab' || dialogEl.value === null) return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialogEl.value.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialogEl.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialogEl.value.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

watch(selectedClaimId, async (claimId) => {
  if (claimId !== null) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onDialogKeydown);
    resolutionKind.value = 'replacement';
    responseText.value = '';
    actionError.value = '';
    await nextTick();
    dialogEl.value?.focus();
    return;
  }
  restoreDialogEnvironment();
});

onBeforeUnmount(() => {
  if (selectedClaimId.value !== null) restoreDialogEnvironment();
});

function openDetail(claimId: string): void {
  selectedClaimId.value = claimId;
}

async function handleTransitionError(error: unknown): Promise<void> {
  actionError.value = error instanceof ApiRequestError
    ? error.message
    : '클레임 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (error instanceof ApiRequestError && error.status === 409) {
    await detailQuery.refetch();
  }
}

async function startReview(): Promise<void> {
  const claim = selectedClaim.value;
  if (claim === null) return;
  actionError.value = '';
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body: { action: 'start_review', expectedVersion: claim.version },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

async function finish(action: 'resolve' | 'reject'): Promise<void> {
  const claim = selectedClaim.value;
  const response = responseText.value.trim();
  if (claim === null || response.length < 10) {
    actionError.value = '고객에게 전달할 답변을 10자 이상 입력해 주세요.';
    return;
  }
  actionError.value = '';
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body: action === 'resolve'
        ? {
            action: 'resolve',
            expectedVersion: claim.version,
            resolutionKind: resolutionKind.value,
            response,
          }
        : { action: 'reject', expectedVersion: claim.version, response },
    });
    // 처리 완료 뒤 현재 카드가 대기 목록에서 빠지므로 닫을 때 안정적인 화면 루트로 복귀한다.
    focusPageAfterClose = true;
  } catch (error) {
    await handleTransitionError(error);
  }
}

const fmtDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const statusClass = (claimStatus: BomClaimStatusType): string =>
  claimStatus === 'open'
    ? 'bg-amber-100 text-amber-800'
    : claimStatus === 'reviewing'
      ? 'bg-blue-100 text-blue-800'
      : claimStatus === 'resolved'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-gray-200 text-gray-700';
</script>

<template>
  <div ref="pageRoot" tabindex="-1" class="mx-auto w-full max-w-7xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:p-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-orange-600">After delivery care</p>
        <h1 class="mt-1 text-2xl font-bold text-gray-950">완료·클레임</h1>
        <p class="mt-1 text-sm text-gray-500">배송 후 고객 문제를 접수 순서대로 검토하고 답변합니다. 주문·환불 상태는 자동으로 바꾸지 않습니다.</p>
      </div>
      <div class="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-900">
        처리 필요 <b class="ml-1 text-lg tabular-nums">{{ counts.pending }}</b>건
      </div>
    </header>

    <nav class="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="클레임 상태 필터">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold"
        :class="status === tab.key ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300'"
        :aria-pressed="status === tab.key"
        @click="status = tab.key"
      >
        {{ tab.label }} {{ tab.count }}
      </button>
    </nav>

    <form class="mt-4 flex gap-2" role="search" @submit.prevent="applySearch">
      <label class="sr-only" for="bom-claim-search">클레임 검색</label>
      <input id="bom-claim-search" v-model="searchDraft" class="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm" placeholder="Case명·고객 ID·주문번호·제목 검색">
      <button type="submit" class="shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white">검색</button>
    </form>

    <p v-if="listQuery.isFetching.value" class="mt-6 text-sm text-gray-400">클레임 목록을 확인하는 중…</p>
    <p v-if="listQuery.isError.value" role="alert" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
      클레임 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
    </p>
    <div v-else-if="items.length === 0 && !listQuery.isFetching.value" class="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
      이 조건에 맞는 클레임이 없습니다.
    </div>

    <section v-else class="mt-5 grid gap-3 lg:grid-cols-2" aria-label="클레임 목록">
      <article v-for="claim in items" :key="claim.id" class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-xs font-bold" :class="statusClass(claim.status)">{{ BOM_CLAIM_STATUS_LABELS[claim.status] }}</span>
          <span class="text-xs font-semibold text-gray-500">{{ BOM_CLAIM_KIND_LABELS[claim.kind] }}</span>
          <span class="ml-auto text-xs text-gray-400">#{{ claim.id }} · {{ fmtDate(claim.submittedAt) }}</span>
        </div>
        <h2 class="mt-3 truncate text-base font-bold text-gray-950">{{ claim.subject }}</h2>
        <p class="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-gray-600">{{ claim.description }}</p>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-gray-50 p-3 text-xs">
          <dt class="text-gray-400">Case</dt><dd class="truncate font-semibold text-gray-700">{{ claim.quoteTitle }}</dd>
          <dt class="text-gray-400">고객</dt><dd class="truncate font-semibold text-gray-700">{{ claim.mbId }}</dd>
          <dt class="text-gray-400">주문</dt><dd class="truncate font-semibold text-gray-700">{{ claim.odId }} · {{ claim.orderSnapshot.odStatus }}</dd>
          <dt class="text-gray-400">품목</dt><dd class="font-semibold text-gray-700">{{ claim.items.length }}종 · 문제 {{ claim.items.reduce((sum, item) => sum + item.affectedQty, 0) }}개</dd>
        </dl>
        <button
          type="button"
          class="mt-3 w-full rounded-xl border border-orange-300 bg-orange-50 py-2.5 text-sm font-bold text-orange-800 hover:bg-orange-100"
          :aria-label="`${claim.subject} 클레임 상세 열기`"
          @click="openDetail(claim.id)"
        >
          처리 내용 확인
        </button>
      </article>
    </section>

    <footer v-if="totalPages > 1" class="mt-6 flex items-center justify-center gap-3">
      <button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
      <span class="text-sm tabular-nums text-gray-500">{{ page }} / {{ totalPages }}</span>
      <button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">다음</button>
    </footer>
  </div>

  <div v-if="selectedClaimId !== null" class="fixed inset-0 z-[90] grid place-items-center p-3 sm:p-6">
    <button type="button" class="absolute inset-0 bg-slate-950/55" aria-label="클레임 상세 닫기" @click="closeDetail" />
    <section
      ref="dialogEl"
      role="dialog"
      aria-modal="true"
      :aria-label="selectedClaim === null ? '클레임 상세 불러오는 중' : `클레임 #${selectedClaim.id} 상세`"
      tabindex="-1"
      class="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
    >
      <header class="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-4 sm:px-6">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-orange-600">고객 접수 원장</p>
          <h2 class="mt-1 text-lg font-bold text-gray-950">{{ selectedClaim === null ? '클레임 확인 중…' : `클레임 #${selectedClaim.id}` }}</h2>
        </div>
        <button type="button" class="grid size-9 place-items-center rounded-lg border border-gray-300 bg-white text-xl text-gray-500" aria-label="클레임 상세 닫기" @click="closeDetail">×</button>
      </header>

      <div v-if="detailQuery.isLoading.value && selectedClaim === null" class="p-10 text-center text-sm text-gray-500">최신 처리 상태를 불러오는 중…</div>
      <div v-else-if="selectedClaim !== null" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-xs font-bold" :class="statusClass(selectedClaim.status)">{{ BOM_CLAIM_STATUS_LABELS[selectedClaim.status] }}</span>
          <span class="text-sm font-semibold text-gray-600">{{ BOM_CLAIM_KIND_LABELS[selectedClaim.kind] }}</span>
          <RouterLink
            :to="{ name: 'admin-smartbom-case', params: { id: selectedClaim.quoteId }, query: { from: 'claims' } }"
            class="ml-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"
          >
            Case 열기
          </RouterLink>
        </div>

        <section>
          <h3 class="text-base font-bold text-gray-950">{{ selectedClaim.subject }}</h3>
          <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{{ selectedClaim.description }}</p>
          <p class="mt-2 text-xs text-gray-400">{{ selectedClaim.mbId }} · 주문 {{ selectedClaim.odId }} · {{ fmtDate(selectedClaim.submittedAt) }}</p>
        </section>

        <section>
          <h3 class="text-sm font-bold text-gray-900">문제 부품</h3>
          <div class="mt-2 overflow-x-auto rounded-xl border border-gray-200">
            <table class="min-w-[560px] w-full text-left text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500"><tr><th class="px-3 py-2">MPN</th><th class="px-3 py-2">제조사</th><th class="px-3 py-2 text-right">문제/주문</th></tr></thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="item in selectedClaim.items" :key="item.id">
                  <td class="px-3 py-2 font-semibold text-gray-900">{{ item.mpn }}</td>
                  <td class="px-3 py-2 text-gray-600">{{ item.manufacturerName ?? '—' }}</td>
                  <td class="px-3 py-2 text-right font-bold tabular-nums">{{ item.affectedQty }} / {{ item.orderedQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-1 text-[11px] text-gray-500">작은 화면에서는 부품 표를 좌우로 이동할 수 있습니다.</p>
        </section>

        <section class="rounded-xl border border-gray-200 p-4">
          <h3 class="text-sm font-bold text-gray-900">처리 이력</h3>
          <ol class="mt-3 space-y-3 border-l-2 border-gray-200 pl-4">
            <li v-for="event in selectedClaim.events" :key="event.id" class="relative text-sm">
              <span class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-orange-500" />
              <p class="font-bold text-gray-800">{{ BOM_CLAIM_STATUS_LABELS[event.toStatus] }}</p>
              <p class="text-xs text-gray-400">{{ event.actorMbId }} · {{ fmtDate(event.createdAt) }}</p>
              <p v-if="event.note !== null" class="mt-1 whitespace-pre-wrap text-gray-600">{{ event.note }}</p>
            </li>
          </ol>
        </section>

        <section v-if="selectedClaim.status === 'open'" class="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 class="text-sm font-bold text-blue-950">1. 검토 시작</h3>
          <p class="mt-1 text-xs leading-5 text-blue-800">담당자가 접수를 확인했다는 상태를 고객에게 먼저 표시합니다.</p>
          <button type="button" class="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" :disabled="transitionClaim.isPending.value" @click="startReview">
            {{ transitionClaim.isPending.value ? '처리 중…' : '검토 시작' }}
          </button>
        </section>

        <section v-else-if="selectedClaim.status === 'reviewing'" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 class="text-sm font-bold text-emerald-950">2. 고객 답변 후 닫기</h3>
          <p class="mt-1 text-xs leading-5 text-emerald-800">실제 환불·재발송은 별도 운영 절차로 진행하고, 여기에는 고객에게 약속한 처리 내용을 남깁니다.</p>
          <label class="mt-3 block text-xs font-bold text-gray-700">
            해결 방식
            <select v-model="resolutionKind" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option v-for="(label, value) in BOM_CLAIM_RESOLUTION_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="mt-3 block text-xs font-bold text-gray-700">
            고객 답변
            <textarea v-model="responseText" rows="5" maxlength="2000" class="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="확인 결과와 후속 일정 또는 처리 불가 사유를 구체적으로 적어 주세요." />
          </label>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" :disabled="transitionClaim.isPending.value" @click="finish('resolve')">해결 완료</button>
            <button type="button" class="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40" :disabled="transitionClaim.isPending.value" @click="finish('reject')">처리 불가로 닫기</button>
          </div>
        </section>

        <section v-else-if="selectedClaim.adminResponse !== null" class="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 class="text-sm font-bold text-gray-900">
            최종 답변<span v-if="selectedClaim.resolutionKind !== null"> · {{ BOM_CLAIM_RESOLUTION_LABELS[selectedClaim.resolutionKind] }}</span>
          </h3>
          <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{{ selectedClaim.adminResponse }}</p>
        </section>

        <p v-if="actionError !== ''" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{{ actionError }}</p>
      </div>
    </section>
  </div>
</template>
