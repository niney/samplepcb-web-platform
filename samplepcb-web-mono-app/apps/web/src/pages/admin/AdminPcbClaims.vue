<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_CLAIM_FAULT_LABELS,
  PCB_CLAIM_KIND_LABELS,
  PCB_CLAIM_REMEDY_LABELS,
  PCB_CLAIM_RESOLUTION_LABELS,
  PCB_CLAIM_STATUS_LABELS,
  type AdminPcbClaimListQueryType,
  type PcbClaimFaultTypeType,
  type PcbClaimResolutionType,
  type PcbClaimStatusType,
} from '@sp/api-contract';
import {
  downloadAdminPcbClaimFile,
  useAdminPcbClaimReturn,
  useAdminPcbClaims,
  useTransitionAdminPcbClaim,
  useUploadAdminPcbClaimFile,
  type AdminPcbClaimFilters,
} from '../../admin/useAdminPcbClaims';
import { useAdminPcbAsCandidates } from '../../admin/useAdminPcbAsCases';

// PCB 클레임(A/S 접수) 워크큐(P5) — AdminSmartbomClaims 미러 + PCB 판정 축:
// 귀책(faultType)·처리(resolutionKind)·재생산 핸드오프(대상 협력사 지정 시 A/S 케이스
// 초안 생성)·금액 기록·회수 메모. 실행(재생산 회신·환불 실집행)은 각자의 창구
// (A/S 패널·주문 환불 기록)가 맡고, 여기는 고객 회신과 판정 원장이다.

type ClaimTab = AdminPcbClaimListQueryType['status'];

const page = ref(1);
const status = ref<ClaimTab>('pending');
const searchDraft = ref('');
const search = ref('');
const filters = computed<AdminPcbClaimFilters>(() => ({
  page: page.value,
  pageSize: 20,
  status: status.value,
  search: search.value,
}));
const listQuery = useAdminPcbClaims(filters);
const counts = computed(
  () =>
    listQuery.data.value?.data.counts ?? {
      all: 0,
      pending: 0,
      open: 0,
      reviewing: 0,
      resolved: 0,
      rejected: 0,
    },
);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const totalPages = computed(
  () => Math.max(1, Math.ceil((listQuery.data.value?.data.total ?? 0) / 20)),
);

const tabs = computed(() => [
  { key: 'pending' as const, label: '처리 필요', count: counts.value.pending },
  { key: 'open' as const, label: '새 접수', count: counts.value.open },
  { key: 'reviewing' as const, label: '검토 중', count: counts.value.reviewing },
  { key: 'resolved' as const, label: '처리 완료', count: counts.value.resolved },
  { key: 'rejected' as const, label: '처리 불가', count: counts.value.rejected },
  { key: 'all' as const, label: '전체', count: counts.value.all },
]);

watch(status, () => {
  page.value = 1;
});

function applySearch(): void {
  search.value = searchDraft.value.trim();
  page.value = 1;
}

const selectedClaimId = ref<string | null>(null);
// 목록 응답이 상세 전량(files·events 포함)을 싣는다 — 전이 후엔 목록 무효화로 새로 온다.
const selectedClaim = computed(
  () => items.value.find((item) => item.id === selectedClaimId.value) ?? null,
);
const transitionClaim = useTransitionAdminPcbClaim();
const returnMutation = useAdminPcbClaimReturn();
const uploadFile = useUploadAdminPcbClaimFile();

const resolutionKind = ref<PcbClaimResolutionType>('reproduce');
const faultType = ref<PcbClaimFaultTypeType>('manufacturing');
const responseText = ref('');
const targetPartnerId = ref<number | null>(null);
const chargeAmountText = ref('');
const refundAmountText = ref('');
const returnRequired = ref(false);
const returnNote = ref('');
const actionError = ref('');
const pageRoot = ref<HTMLElement | null>(null);
const dialogEl = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let focusPageAfterClose = false;

// 재생산 대상 협력사 — A/S 케이스 후보 API 재사용(원주문 발주를 보유한 leaf).
const candidateSpecId = computed<number | null>(() =>
  selectedClaim.value === null ? null : Number(selectedClaim.value.specId),
);
const candidatesEnabled = computed(
  () =>
    selectedClaim.value?.status === 'reviewing' && resolutionKind.value === 'reproduce',
);
const candidatesQuery = useAdminPcbAsCandidates(candidateSpecId, candidatesEnabled);
const candidates = computed(() => candidatesQuery.data.value?.data.candidates ?? []);
watch(candidates, (list) => {
  // 후보가 1곳이면 자동 선택(A/S 접수 모달과 같은 관례).
  if (targetPartnerId.value === null && list.length === 1) {
    targetPartnerId.value = list[0]?.partnerId ?? null;
  }
});

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
  const target =
    focusPageAfterClose || previousFocus?.isConnected !== true ? pageRoot.value : previousFocus;
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
    resolutionKind.value = 'reproduce';
    faultType.value = 'manufacturing';
    responseText.value = '';
    targetPartnerId.value = null;
    chargeAmountText.value = '';
    refundAmountText.value = '';
    const claim = selectedClaim.value;
    returnRequired.value = claim?.returnRequired ?? false;
    returnNote.value = claim?.returnNote ?? '';
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

// 종결된 클레임이 현재 탭(예: 처리 필요)에서 빠지면 상세의 근거 데이터도 사라진다 —
// 빈 모달을 세워 두지 않고 닫는다(목록 무효화 후 재조회가 끝난 시점에 발화).
watch(selectedClaim, (claim) => {
  if (claim === null && selectedClaimId.value !== null && !transitionClaim.isPending.value) {
    selectedClaimId.value = null;
  }
});

function openDetail(claimId: string): void {
  selectedClaimId.value = claimId;
}

async function handleTransitionError(error: unknown): Promise<void> {
  actionError.value =
    error instanceof ApiRequestError
      ? error.message
      : '클레임 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (error instanceof ApiRequestError && error.status === 409) {
    await listQuery.refetch();
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

const parseAmount = (text: string): number | undefined => {
  const trimmed = text.trim().replaceAll(',', '');
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
};

async function finish(action: 'resolve' | 'reject'): Promise<void> {
  const claim = selectedClaim.value;
  const response = responseText.value.trim();
  if (claim === null || response.length < 5) {
    actionError.value = '고객에게 전달할 답변을 5자 이상 입력해 주세요.';
    return;
  }
  if (
    action === 'resolve' &&
    resolutionKind.value === 'reproduce' &&
    candidates.value.length > 0 &&
    targetPartnerId.value === null
  ) {
    actionError.value = '재생산을 맡길 협력사를 선택해 주세요.';
    return;
  }
  actionError.value = '';
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body:
        action === 'resolve'
          ? {
              action: 'resolve',
              expectedVersion: claim.version,
              resolutionKind: resolutionKind.value,
              faultType: faultType.value,
              response,
              ...(resolutionKind.value === 'reproduce' && targetPartnerId.value !== null
                ? { targetPartnerId: targetPartnerId.value }
                : {}),
              ...(parseAmount(chargeAmountText.value) === undefined
                ? {}
                : { chargeAmount: parseAmount(chargeAmountText.value) }),
              ...(parseAmount(refundAmountText.value) === undefined
                ? {}
                : { refundAmount: parseAmount(refundAmountText.value) }),
            }
          : { action: 'reject', expectedVersion: claim.version, faultType: faultType.value, response },
    });
    focusPageAfterClose = true;
  } catch (error) {
    await handleTransitionError(error);
  }
}

async function saveReturn(): Promise<void> {
  const claim = selectedClaim.value;
  if (claim === null) return;
  actionError.value = '';
  try {
    await returnMutation.mutateAsync({
      claimId: claim.id,
      body: {
        returnRequired: returnRequired.value,
        ...(returnNote.value.trim() === '' ? {} : { returnNote: returnNote.value.trim() }),
      },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

function pickAdminFile(): void {
  const claim = selectedClaim.value;
  if (claim === null) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    actionError.value = '';
    try {
      await uploadFile.mutateAsync({ claimId: claim.id, file });
    } catch (error) {
      await handleTransitionError(error);
    }
  };
  input.click();
}

const fmtDate = (value: string): string =>
  new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

const statusClass = (claimStatus: PcbClaimStatusType): string =>
  claimStatus === 'open'
    ? 'bg-amber-100 text-amber-800'
    : claimStatus === 'reviewing'
      ? 'bg-blue-100 text-blue-800'
      : claimStatus === 'resolved'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-gray-200 text-gray-700';
</script>

<template>
  <div
    ref="pageRoot"
    tabindex="-1"
    class="mx-auto w-full max-w-7xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:p-6"
  >
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-wider text-teal-600">After delivery care</p>
        <h1 class="mt-1 text-2xl font-bold text-gray-950">A/S·클레임</h1>
        <p class="mt-1 text-sm text-gray-500">
          배송 후 고객 문제를 접수 순서대로 검토하고 판정합니다. 재생산은 A/S 케이스로,
          환불은 주문 환불 기록으로 이어집니다 — 주문 상태를 자동으로 바꾸지 않습니다.
        </p>
      </div>
      <div class="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900">
        처리 필요 <b class="ml-1 text-lg tabular-nums">{{ counts.pending }}</b>건
      </div>
    </header>

    <nav class="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="클레임 상태 필터">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold"
        :class="status === tab.key ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-teal-300'"
        :aria-pressed="status === tab.key"
        @click="status = tab.key"
      >
        {{ tab.label }} {{ tab.count }}
      </button>
    </nav>

    <form class="mt-4 flex gap-2" role="search" @submit.prevent="applySearch">
      <label class="sr-only" for="pcb-claim-search">클레임 검색</label>
      <input
        id="pcb-claim-search"
        v-model="searchDraft"
        class="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm"
        placeholder="프로젝트명·고객 ID·주문번호 검색"
      >
      <button type="submit" class="shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white">검색</button>
    </form>

    <p v-if="listQuery.isFetching.value" class="mt-6 text-sm text-gray-400">클레임 목록을 확인하는 중…</p>
    <p
      v-if="listQuery.isError.value"
      role="alert"
      class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
    >
      클레임 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
    </p>
    <div
      v-else-if="items.length === 0 && !listQuery.isFetching.value"
      class="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500"
    >
      이 조건에 맞는 클레임이 없습니다.
    </div>

    <section v-else class="mt-5 grid gap-3 lg:grid-cols-2" aria-label="클레임 목록">
      <article v-for="claim in items" :key="claim.id" class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-xs font-bold" :class="statusClass(claim.status)">
            {{ PCB_CLAIM_STATUS_LABELS[claim.status] }}
          </span>
          <span class="text-xs font-semibold text-gray-500">{{ PCB_CLAIM_KIND_LABELS[claim.kind] }}</span>
          <span
            v-if="claim.createdByRole === 'admin'"
            class="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700"
            title="관리자가 전화·메일 접수를 대신 입력한 건"
          >대리 접수</span>
          <span class="ml-auto text-xs text-gray-400">#{{ claim.id }} · {{ fmtDate(claim.submittedAt) }}</span>
        </div>
        <h2 class="mt-3 truncate text-base font-bold text-gray-950">{{ claim.projectName }}</h2>
        <p class="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-gray-600">{{ claim.description }}</p>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-gray-50 p-3 text-xs">
          <dt class="text-gray-400">고객</dt>
          <dd class="truncate font-semibold text-gray-700">{{ claim.mbId }}</dd>
          <dt class="text-gray-400">주문</dt>
          <dd class="truncate font-semibold text-gray-700">{{ claim.odId }} · {{ claim.orderSnapshot.odStatus }}</dd>
          <dt class="text-gray-400">문제 수량</dt>
          <dd class="font-semibold text-gray-700 tabular-nums">{{ claim.affectedQty }} / {{ claim.orderedQty }}</dd>
          <dt class="text-gray-400">고객 희망</dt>
          <dd class="font-semibold text-gray-700">{{ PCB_CLAIM_REMEDY_LABELS[claim.requestedRemedy] }}</dd>
        </dl>
        <button
          type="button"
          class="mt-3 w-full rounded-xl border border-teal-300 bg-teal-50 py-2.5 text-sm font-bold text-teal-800 hover:bg-teal-100"
          :aria-label="`${claim.projectName} 클레임 상세 열기`"
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
      :aria-label="selectedClaim === null ? '클레임 상세' : `클레임 #${selectedClaim.id} 상세`"
      tabindex="-1"
      class="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
    >
      <header class="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-4 sm:px-6">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-teal-600">고객 접수 원장</p>
          <h2 class="mt-1 text-lg font-bold text-gray-950">
            {{ selectedClaim === null ? '클레임' : `클레임 #${selectedClaim.id}` }}
          </h2>
        </div>
        <button type="button" class="grid size-9 place-items-center rounded-lg border border-gray-300 bg-white text-xl text-gray-500" aria-label="클레임 상세 닫기" @click="closeDetail">×</button>
      </header>

      <div v-if="selectedClaim !== null" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-xs font-bold" :class="statusClass(selectedClaim.status)">
            {{ PCB_CLAIM_STATUS_LABELS[selectedClaim.status] }}
          </span>
          <span class="text-sm font-semibold text-gray-600">{{ PCB_CLAIM_KIND_LABELS[selectedClaim.kind] }}</span>
          <span
            v-if="selectedClaim.createdByRole === 'admin'"
            class="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700"
          >대리 접수</span>
          <RouterLink
            :to="{ name: 'admin-pcb-case', params: { id: selectedClaim.specId }, query: { from: 'claims' } }"
            class="ml-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"
          >
            Case 열기
          </RouterLink>
        </div>

        <section>
          <h3 class="text-base font-bold text-gray-950">{{ selectedClaim.projectName }}</h3>
          <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{{ selectedClaim.description }}</p>
          <p class="mt-2 text-xs text-gray-400">
            {{ selectedClaim.mbId }} · 주문 {{ selectedClaim.odId }} · 문제 수량
            {{ selectedClaim.affectedQty }}/{{ selectedClaim.orderedQty }} ·
            {{ PCB_CLAIM_REMEDY_LABELS[selectedClaim.requestedRemedy] }} · {{ fmtDate(selectedClaim.submittedAt) }}
          </p>
        </section>

        <!-- 첨부 — 고객 사진(CUSTOMER)·관리자 대리 첨부(ADMIN). 열린 상태에선 추가 가능. -->
        <section v-if="selectedClaim.files.length > 0 || selectedClaim.status === 'open' || selectedClaim.status === 'reviewing'">
          <h3 class="text-sm font-bold text-gray-900">첨부</h3>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <button
              v-for="f in selectedClaim.files"
              :key="f.fileId"
              type="button"
              class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
              :title="`${f.name} · ${f.uploadedBy === 'ADMIN' ? '관리자' : '고객'} 업로드`"
              @click="void downloadAdminPcbClaimFile(selectedClaim.id, f.fileId, f.name)"
            >
              ⬇ {{ f.name }}
            </button>
            <span v-if="selectedClaim.files.length === 0" class="text-gray-300">첨부 없음</span>
            <button
              v-if="selectedClaim.status === 'open' || selectedClaim.status === 'reviewing'"
              type="button"
              class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
              :disabled="uploadFile.isPending.value"
              @click="pickAdminFile"
            >
              ⬆ 첨부 추가
            </button>
          </div>
        </section>

        <!-- 회수 기록(자유 메모) — 정식 역물류 모델 보류(08-15 결정), 운송장 등 텍스트 박제 -->
        <section
          v-if="selectedClaim.status === 'open' || selectedClaim.status === 'reviewing' || selectedClaim.returnRequired"
          class="rounded-xl border border-gray-200 p-4"
        >
          <h3 class="text-sm font-bold text-gray-900">불량품 회수</h3>
          <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <label class="flex items-center gap-2">
              <input
                v-model="returnRequired"
                type="checkbox"
                :disabled="selectedClaim.status !== 'open' && selectedClaim.status !== 'reviewing'"
              >
              회수 필요
            </label>
            <input
              v-model="returnNote"
              type="text"
              maxlength="500"
              placeholder="회수 방법·운송장 번호 등 메모"
              class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              :disabled="selectedClaim.status !== 'open' && selectedClaim.status !== 'reviewing'"
            >
            <button
              v-if="selectedClaim.status === 'open' || selectedClaim.status === 'reviewing'"
              type="button"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              :disabled="returnMutation.isPending.value"
              @click="void saveReturn()"
            >
              저장
            </button>
          </div>
        </section>

        <section class="rounded-xl border border-gray-200 p-4">
          <h3 class="text-sm font-bold text-gray-900">처리 이력</h3>
          <ol class="mt-3 space-y-3 border-l-2 border-gray-200 pl-4">
            <li v-for="event in selectedClaim.events" :key="event.id" class="relative text-sm">
              <span class="absolute -left-[21px] top-1 size-2.5 rounded-full bg-teal-500" />
              <p class="font-bold text-gray-800">{{ PCB_CLAIM_STATUS_LABELS[event.toStatus] }}</p>
              <p class="text-xs text-gray-400">
                {{ event.actorRole === 'customer' ? '고객' : '관리자' }} {{ event.actorMbId }} · {{ fmtDate(event.createdAt) }}
              </p>
              <p v-if="event.note !== null" class="mt-1 whitespace-pre-wrap text-gray-600">{{ event.note }}</p>
            </li>
          </ol>
        </section>

        <section v-if="selectedClaim.status === 'open'" class="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 class="text-sm font-bold text-blue-950">1. 검토 시작</h3>
          <p class="mt-1 text-xs leading-5 text-blue-800">담당자가 접수를 확인했다는 상태를 고객에게 먼저 표시합니다.</p>
          <button
            type="button"
            class="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            :disabled="transitionClaim.isPending.value"
            @click="startReview"
          >
            {{ transitionClaim.isPending.value ? '처리 중…' : '검토 시작' }}
          </button>
        </section>

        <section v-else-if="selectedClaim.status === 'reviewing'" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 class="text-sm font-bold text-emerald-950">2. 판정 — 귀책·처리 방식 확정 후 고객 회신</h3>
          <p class="mt-1 text-xs leading-5 text-emerald-800">
            재생산은 A/S 케이스(협력사 합의)로 이어지고, 환불 실집행은 주문의 환불 기록 창구에서 합니다.
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="block text-xs font-bold text-gray-700">
              귀책 판정
              <select v-model="faultType" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option v-for="(label, value) in PCB_CLAIM_FAULT_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label class="block text-xs font-bold text-gray-700">
              처리 방식
              <select v-model="resolutionKind" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option v-for="(label, value) in PCB_CLAIM_RESOLUTION_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
          </div>

          <template v-if="resolutionKind === 'reproduce'">
            <label v-if="candidates.length > 0" class="mt-3 block text-xs font-bold text-gray-700">
              재생산 협력사 <span class="text-red-500">*</span>
              <select v-model="targetPartnerId" class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option :value="null" disabled>선택</option>
                <option v-for="c in candidates" :key="c.partnerId" :value="c.partnerId">
                  {{ c.partnerName }}{{ c.parentPartnerName === null ? '' : ` (MD 경유 · ${c.parentPartnerName})` }}
                </option>
              </select>
              <span class="mt-1 block font-normal text-gray-500">
                확정 시 A/S 케이스 초안이 만들어져 연결됩니다 — 접수 전송·회신·재발주는 Case 상세 A/S 패널에서.
              </span>
            </label>
            <p v-else class="mt-3 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-800">
              원주문 발주 협력사가 없어 케이스 자동 생성 없이 방침만 기록됩니다.
            </p>
            <label class="mt-3 block text-xs font-bold text-gray-700">
              유상 청구액 기록 <span class="font-normal text-gray-500">(원 · 선택 — 고객 데이터 귀책 등 유상 처리 시)</span>
              <input v-model="chargeAmountText" type="text" inputmode="numeric" placeholder="예) 150000" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums">
            </label>
          </template>
          <label v-if="resolutionKind === 'refund_coordination'" class="mt-3 block text-xs font-bold text-gray-700">
            환불 협의액 기록 <span class="font-normal text-gray-500">(원 · 선택 — 실집행은 주문 환불 기록 창구)</span>
            <input v-model="refundAmountText" type="text" inputmode="numeric" placeholder="예) 66000" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums">
          </label>

          <label class="mt-3 block text-xs font-bold text-gray-700">
            고객 답변 <span class="text-red-500">*</span>
            <textarea
              v-model="responseText"
              rows="4"
              maxlength="2000"
              class="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="판정 결과와 후속 일정(또는 처리 불가 사유)을 구체적으로 적어 주세요 — 고객 메일로 그대로 나갑니다."
            />
          </label>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              :disabled="transitionClaim.isPending.value"
              @click="finish('resolve')"
            >
              처리 확정
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40"
              :disabled="transitionClaim.isPending.value"
              @click="finish('reject')"
            >
              처리 불가로 닫기
            </button>
          </div>
        </section>

        <section v-else class="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 class="text-sm font-bold text-gray-900">
            최종 판정
            <span v-if="selectedClaim.faultType !== null"> · {{ PCB_CLAIM_FAULT_LABELS[selectedClaim.faultType] }}</span>
            <span v-if="selectedClaim.resolutionKind !== null"> · {{ PCB_CLAIM_RESOLUTION_LABELS[selectedClaim.resolutionKind] }}</span>
          </h3>
          <p v-if="selectedClaim.adminResponse !== null" class="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
            {{ selectedClaim.adminResponse }}
          </p>
          <p class="mt-2 text-xs text-gray-500">
            <template v-if="selectedClaim.asCaseId !== null">A/S 케이스 #{{ selectedClaim.asCaseId }} 연결 — Case 상세 A/S 패널에서 진행 · </template>
            <template v-if="selectedClaim.chargeAmount !== null">유상 청구 기록 ₩{{ selectedClaim.chargeAmount.toLocaleString('ko-KR') }} · </template>
            <template v-if="selectedClaim.refundAmount !== null">환불 협의 기록 ₩{{ selectedClaim.refundAmount.toLocaleString('ko-KR') }} · </template>
            {{ selectedClaim.closedAt === null ? '' : fmtDate(selectedClaim.closedAt) }}
          </p>
        </section>

        <p v-if="actionError !== ''" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{{ actionError }}</p>
      </div>
    </section>
  </div>
</template>
