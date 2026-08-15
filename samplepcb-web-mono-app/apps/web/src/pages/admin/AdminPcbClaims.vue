<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import { fmtKstDate as fmtDate } from '@sp/utils';
import {
  downloadAdminPcbClaimFile,
  useAdminPcbClaimReturn,
  useAdminPcbClaims,
  useTransitionAdminPcbClaim,
  useUploadAdminPcbClaimFile,
  type AdminPcbClaimFilters,
} from '../../admin/useAdminPcbClaims';
import { useAdminPcbAsCandidates } from '../../admin/useAdminPcbAsCases';
import {
  pcbDetailQuery,
  queryPage,
  queryString,
  queryTab,
  replacePcbListQuery,
} from '../../admin/pcb-navigation';

// PCB A/S·클레임 워크큐(P5) — 배송 후 고객 접수를 검토·판정하는 단일 창구.
// 다른 PCB 워크큐(주문·발주·선적)와 같은 골격: 탭바+검색(URL 쿼리 동기화 — 마지막 작업
// 위치 복원 합류)·테이블·Case 딥링크(?from=claims). 판정의 PCB 고유 축: 귀책(faultType)·
// 처리(resolutionKind)·재생산 핸드오프(대상 협력사 지정 시 A/S 케이스 초안 생성·연결)·
// 금액 기록·회수 메모. 실행(재생산 회신·환불 실집행)은 각자의 창구가 맡는다.

type ClaimTab = AdminPcbClaimListQueryType['status'];
const TABS: ClaimTab[] = ['pending', 'open', 'reviewing', 'resolved', 'rejected', 'all'];
const TAB_LABELS: Record<ClaimTab, string> = {
  pending: '처리 필요',
  open: '새 접수',
  reviewing: '검토 중',
  resolved: '처리 완료',
  rejected: '처리 불가',
  all: '전체',
};

const route = useRoute();
const router = useRouter();
const filters = ref<{ page: number; pageSize: number; tab: ClaimTab; q: string }>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: queryTab(route.query.tab, TABS, 'pending'),
  q: queryString(route.query.q),
});
const hookFilters = computed<AdminPcbClaimFilters>(() => ({
  page: filters.value.page,
  pageSize: filters.value.pageSize,
  status: filters.value.tab,
  search: filters.value.q,
}));
const listQuery = useAdminPcbClaims(hookFilters);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const counts = computed(() => listQuery.data.value?.data.counts ?? null);
const total = computed(() => listQuery.data.value?.data.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));
const tabCount = (key: ClaimTab): number | null =>
  counts.value === null ? null : counts.value[key];
const setTab = (tab: ClaimTab): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
watch(
  filters,
  (value) => {
    replacePcbListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

function openCase(specId: string): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: specId },
    query: pcbDetailQuery('claims', route.fullPath),
  });
}

// ── 처리 모달 — 이 화면이 판정의 단일 창구다(행 클릭=처리 열기, Case 는 별도 버튼) ──
const selectedClaimId = ref<string | null>(null);
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

// 재생산 대상 협력사 — A/S 케이스 후보 API 재사용(원주문 발주를 보유한 leaf).
const candidateSpecId = computed<number | null>(() =>
  selectedClaim.value === null ? null : Number(selectedClaim.value.specId),
);
const candidatesEnabled = computed(
  () => selectedClaim.value?.status === 'reviewing' && resolutionKind.value === 'reproduce',
);
const candidatesQuery = useAdminPcbAsCandidates(candidateSpecId, candidatesEnabled);
const candidates = computed(() => candidatesQuery.data.value?.data.candidates ?? []);
watch(candidates, (list) => {
  // 후보가 1곳이면 자동 선택(A/S 접수 모달과 같은 관례).
  if (targetPartnerId.value === null && list.length === 1) {
    targetPartnerId.value = list[0]?.partnerId ?? null;
  }
});

function openDetail(claimId: string): void {
  selectedClaimId.value = claimId;
  resolutionKind.value = 'reproduce';
  faultType.value = 'manufacturing';
  responseText.value = '';
  targetPartnerId.value = null;
  chargeAmountText.value = '';
  refundAmountText.value = '';
  const claim = items.value.find((item) => item.id === claimId) ?? null;
  returnRequired.value = claim?.returnRequired ?? false;
  returnNote.value = claim?.returnNote ?? '';
  actionError.value = '';
}

function closeDetail(): void {
  if (transitionClaim.isPending.value) return;
  selectedClaimId.value = null;
}

// 종결된 클레임이 현재 탭(예: 처리 필요)에서 빠지면 상세의 근거 데이터도 사라진다 —
// 빈 모달을 세워 두지 않고 닫는다(목록 무효화 후 재조회가 끝난 시점에 발화).
watch(selectedClaim, (claim) => {
  if (claim === null && selectedClaimId.value !== null && !transitionClaim.isPending.value) {
    selectedClaimId.value = null;
  }
});

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && selectedClaimId.value !== null) closeDetail();
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

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
          : {
              action: 'reject',
              expectedVersion: claim.version,
              faultType: faultType.value,
              response,
            },
    });
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

const claimOpen = (status: PcbClaimStatusType): boolean =>
  status === 'open' || status === 'reviewing';

const STATUS_CLS: Record<PcbClaimStatusType, string> = {
  open: 'bg-amber-100 text-amber-700',
  reviewing: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-gray-200 text-gray-600',
};
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB A/S·클레임</h1>
    <p class="text-sm text-gray-500">
      배송 후 고객 접수를 검토하고 <b>귀책·처리 방식을 판정</b>합니다 — 재생산은 A/S 케이스로,
      환불은 주문 환불 기록으로 이어지며 주문 상태를 자동으로 바꾸지 않습니다. 대리 접수는 Case 상세에서.
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="tab in TABS"
          :key="tab"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="filters.tab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="setTab(tab)"
        >
          {{ TAB_LABELS[tab] }}
          <span v-if="tabCount(tab) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(tab) }}</span>
        </button>
      </div>
      <form class="pb-1" @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트·고객 아이디·주문번호 검색"
          class="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-4 py-2.5">접수일</th>
            <th class="whitespace-nowrap px-4 py-2.5">상태</th>
            <th class="px-4 py-2.5">프로젝트</th>
            <th class="whitespace-nowrap px-4 py-2.5">유형</th>
            <th class="px-4 py-2.5">증상</th>
            <th class="whitespace-nowrap px-4 py-2.5">고객</th>
            <th class="whitespace-nowrap px-4 py-2.5">문제 수량</th>
            <th class="whitespace-nowrap px-4 py-2.5">고객 희망</th>
            <th class="whitespace-nowrap px-4 py-2.5">판정</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="claim in items"
            :key="claim.id"
            class="cursor-pointer hover:bg-blue-50/40"
            :class="claim.status === 'open' ? 'bg-amber-50/50' : ''"
            @click="openDetail(claim.id)"
          >
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(claim.submittedAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[claim.status]">
                {{ PCB_CLAIM_STATUS_LABELS[claim.status] }}
              </span>
              <span
                v-if="claim.createdByRole === 'admin'"
                class="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700"
                title="관리자가 전화·메일 접수를 대신 입력한 건"
              >대리</span>
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
              <span class="mr-1 font-mono text-xs text-gray-300">Q{{ claim.specId }}</span>
              {{ claim.projectName }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ PCB_CLAIM_KIND_LABELS[claim.kind] }}</td>
            <td class="max-w-sm truncate px-4 py-2.5 text-gray-500" :title="claim.description">
              {{ claim.description }}
              <span v-if="claim.files.length > 0" class="ml-1 text-xs text-gray-400">📎{{ claim.files.length }}</span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
              {{ claim.mbId }}
              <span class="block font-mono text-xs text-gray-400">{{ claim.odId }}</span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
              {{ claim.affectedQty }} / {{ claim.orderedQty }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
              {{ PCB_CLAIM_REMEDY_LABELS[claim.requestedRemedy] }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <template v-if="claim.resolutionKind !== null">
                <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {{ PCB_CLAIM_RESOLUTION_LABELS[claim.resolutionKind] }}
                </span>
                <span v-if="claim.asCaseId !== null" class="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                  A/S #{{ claim.asCaseId }}
                </span>
              </template>
              <span v-else-if="claim.status === 'rejected'" class="text-xs text-gray-400">처리 불가</span>
              <span v-else class="text-xs text-gray-300">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                v-if="claimOpen(claim.status)"
                type="button"
                class="mr-1 rounded-md bg-blue-600 px-2.5 py-[3px] text-xs font-semibold text-white hover:bg-blue-700"
                @click.stop="openDetail(claim.id)"
              >
                처리
              </button>
              <button
                v-else
                type="button"
                class="mr-1 rounded-md border border-gray-200 px-2.5 py-[3px] text-xs font-semibold text-gray-500 hover:bg-gray-50"
                @click.stop="openDetail(claim.id)"
              >
                내용
              </button>
              <button
                type="button"
                class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                @click.stop="openCase(claim.specId)"
              >
                Case 열기 →
              </button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ listQuery.isFetching.value ? '클레임 목록을 확인하는 중…' : '해당 상태의 접수가 없습니다.' }}
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

    <!-- 처리 모달 — UiPromptModal 과 같은 결(가운데 카드·bg-surface·배경 클릭 닫기·Esc) -->
    <Teleport to="body">
      <div
        v-if="selectedClaim !== null"
        class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
        @click.self="closeDetail"
      >
        <div
          class="pcb-readable flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          :aria-label="`클레임 #${selectedClaim.id} 처리`"
        >
          <div class="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
            <div>
              <h2 class="text-base font-bold text-gray-800">
                클레임 #{{ selectedClaim.id }}
                <span class="ml-1 rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[selectedClaim.status]">
                  {{ PCB_CLAIM_STATUS_LABELS[selectedClaim.status] }}
                </span>
                <span
                  v-if="selectedClaim.createdByRole === 'admin'"
                  class="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700"
                >대리 접수</span>
              </h2>
              <p class="mt-0.5 text-xs text-gray-400">
                {{ selectedClaim.mbId }} · 주문 {{ selectedClaim.odId }} · {{ fmtDate(selectedClaim.submittedAt) }} 접수
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                @click="openCase(selectedClaim.specId)"
              >
                Case 열기 →
              </button>
              <button type="button" class="text-gray-400 hover:text-gray-700" aria-label="닫기" @click="closeDetail">✕</button>
            </div>
          </div>

          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            <!-- 접수 원문 -->
            <div class="rounded-lg border border-gray-100 p-3">
              <p class="text-xs font-bold text-gray-500">
                {{ PCB_CLAIM_KIND_LABELS[selectedClaim.kind] }} · 문제 수량
                <span class="tabular-nums">{{ selectedClaim.affectedQty }}/{{ selectedClaim.orderedQty }}</span> ·
                {{ PCB_CLAIM_REMEDY_LABELS[selectedClaim.requestedRemedy] }}
              </p>
              <p class="mt-1 truncate text-sm font-semibold text-gray-800">
                <span class="mr-1 font-mono text-xs font-normal text-gray-400">Q{{ selectedClaim.specId }}</span>
                {{ selectedClaim.projectName }}
              </p>
              <p class="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-gray-700">{{ selectedClaim.description }}</p>
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
                <button
                  v-if="claimOpen(selectedClaim.status)"
                  type="button"
                  class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
                  :disabled="uploadFile.isPending.value"
                  @click="pickAdminFile"
                >
                  ⬆ 첨부 추가
                </button>
              </div>
            </div>

            <!-- 회수 기록(자유 메모) — 정식 역물류 모델 보류(08-15 결정) -->
            <div
              v-if="claimOpen(selectedClaim.status) || selectedClaim.returnRequired"
              class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm"
            >
              <label class="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                <input v-model="returnRequired" type="checkbox" :disabled="!claimOpen(selectedClaim.status)">
                불량품 회수 필요
              </label>
              <input
                v-model="returnNote"
                type="text"
                maxlength="500"
                placeholder="회수 방법·운송장 번호 등 메모"
                class="h-8 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-xs focus:border-blue-500 focus:outline-none"
                :disabled="!claimOpen(selectedClaim.status)"
              >
              <button
                v-if="claimOpen(selectedClaim.status)"
                type="button"
                class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                :disabled="returnMutation.isPending.value"
                @click="void saveReturn()"
              >
                저장
              </button>
            </div>

            <!-- 판정 — 검토 시작(open) → 판정 폼(reviewing) → 최종 기록(종결) -->
            <div v-if="selectedClaim.status === 'open'" class="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p class="text-sm font-bold text-blue-900">① 검토 시작</p>
              <p class="mt-0.5 text-xs text-blue-700">고객에게 "확인 중" 상태가 표시됩니다 — 판정 입력은 그 다음.</p>
              <button
                type="button"
                class="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                :disabled="transitionClaim.isPending.value"
                @click="void startReview()"
              >
                {{ transitionClaim.isPending.value ? '처리 중…' : '검토 시작' }}
              </button>
            </div>

            <div v-else-if="selectedClaim.status === 'reviewing'" class="rounded-lg border border-blue-200 p-3">
              <p class="text-sm font-bold text-gray-800">② 판정 — 귀책·처리 확정 후 고객 회신</p>
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                <label class="block text-xs font-semibold text-gray-500">
                  귀책 판정
                  <select v-model="faultType" class="mt-1 h-9 w-full rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option v-for="(label, value) in PCB_CLAIM_FAULT_LABELS" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <label class="block text-xs font-semibold text-gray-500">
                  처리 방식
                  <select v-model="resolutionKind" class="mt-1 h-9 w-full rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option v-for="(label, value) in PCB_CLAIM_RESOLUTION_LABELS" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
              </div>

              <template v-if="resolutionKind === 'reproduce'">
                <label v-if="candidates.length > 0" class="mt-2 block text-xs font-semibold text-gray-500">
                  재생산 협력사 <span class="text-red-500">*</span>
                  <select v-model="targetPartnerId" class="mt-1 h-9 w-full rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option :value="null" disabled>선택</option>
                    <option v-for="c in candidates" :key="c.partnerId" :value="c.partnerId">
                      {{ c.partnerName }}{{ c.parentPartnerName === null ? '' : ` (MD 경유 · ${c.parentPartnerName})` }}
                    </option>
                  </select>
                  <span class="mt-1 block text-[11px] font-normal text-gray-400">
                    확정 시 A/S 케이스 초안이 만들어져 연결됩니다 — 접수 전송·회신·재발주는 Case 상세 A/S 패널에서.
                  </span>
                </label>
                <p v-else class="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  원주문 발주 협력사가 없어 케이스 자동 생성 없이 방침만 기록됩니다.
                </p>
                <label class="mt-2 block text-xs font-semibold text-gray-500">
                  유상 청구액 기록 <span class="font-normal text-gray-400">(원 · 선택 — 실청구는 별도)</span>
                  <input v-model="chargeAmountText" type="text" inputmode="numeric" placeholder="예) 150000" class="mt-1 h-9 w-48 rounded-md border border-gray-300 px-3 text-sm tabular-nums focus:border-blue-500 focus:outline-none">
                </label>
              </template>
              <label v-if="resolutionKind === 'refund_coordination'" class="mt-2 block text-xs font-semibold text-gray-500">
                환불 협의액 기록 <span class="font-normal text-gray-400">(원 · 선택 — 실집행은 주문 환불 기록 창구)</span>
                <input v-model="refundAmountText" type="text" inputmode="numeric" placeholder="예) 66000" class="mt-1 h-9 w-48 rounded-md border border-gray-300 px-3 text-sm tabular-nums focus:border-blue-500 focus:outline-none">
              </label>

              <label class="mt-2 block text-xs font-semibold text-gray-500">
                고객 답변 <span class="text-red-500">*</span>
                <textarea
                  v-model="responseText"
                  rows="3"
                  maxlength="2000"
                  class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="판정 결과와 후속 일정(또는 처리 불가 사유)을 적어 주세요 — 고객 메일로 그대로 나갑니다."
                />
              </label>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                  :disabled="transitionClaim.isPending.value"
                  @click="void finish('resolve')"
                >
                  처리 확정
                </button>
                <button
                  type="button"
                  class="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                  :disabled="transitionClaim.isPending.value"
                  @click="void finish('reject')"
                >
                  처리 불가로 닫기
                </button>
              </div>
            </div>

            <div v-else class="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p class="text-sm font-bold text-gray-800">
                최종 판정
                <span v-if="selectedClaim.faultType !== null" class="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
                  {{ PCB_CLAIM_FAULT_LABELS[selectedClaim.faultType] }}
                </span>
                <span v-if="selectedClaim.resolutionKind !== null" class="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {{ PCB_CLAIM_RESOLUTION_LABELS[selectedClaim.resolutionKind] }}
                </span>
              </p>
              <p v-if="selectedClaim.adminResponse !== null" class="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                {{ selectedClaim.adminResponse }}
              </p>
              <p class="mt-1.5 text-xs text-gray-500">
                <template v-if="selectedClaim.asCaseId !== null">A/S 케이스 #{{ selectedClaim.asCaseId }} 연결 · </template>
                <template v-if="selectedClaim.chargeAmount !== null">유상 청구 기록 ₩{{ selectedClaim.chargeAmount.toLocaleString('ko-KR') }} · </template>
                <template v-if="selectedClaim.refundAmount !== null">환불 협의 기록 ₩{{ selectedClaim.refundAmount.toLocaleString('ko-KR') }} · </template>
                {{ selectedClaim.closedAt === null ? '' : fmtDate(selectedClaim.closedAt) }}
              </p>
            </div>

            <!-- 처리 이력(원장) -->
            <div class="rounded-lg border border-gray-100 p-3">
              <p class="text-xs font-bold text-gray-500">처리 이력</p>
              <ol class="mt-1.5 space-y-1.5">
                <li v-for="event in selectedClaim.events" :key="event.id" class="text-xs text-gray-500">
                  <b class="text-gray-700">{{ PCB_CLAIM_STATUS_LABELS[event.toStatus] }}</b>
                  · {{ event.actorRole === 'customer' ? '고객' : '관리자' }} {{ event.actorMbId }}
                  · {{ fmtDate(event.createdAt) }}
                  <span v-if="event.note !== null" class="block whitespace-pre-wrap pl-2 text-gray-600">↳ {{ event.note }}</span>
                </li>
              </ol>
            </div>

            <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {{ actionError }}
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(다른 PCB 워크큐와 동일 스케일). */
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
