<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  MARKET_CONTRACT_STATUS_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_PROJECT_CATEGORY_LABELS,
  MARKET_PROJECT_STATUS_LABELS,
  apiRoutes,
} from '@sp/api-contract';
import { ApiRequestError, apiGetBlob } from '@sp/shared';
import {
  useAdminCancelContract,
  useAdminMarketContractDetail,
  useAdminMarketContractList,
  useContractHold,
  useContractSettle,
  useContractUnhold,
  type AdminMarketContractFilters,
} from '../../admin/useAdminMarket';
import UiPagination from '../../components/ui/UiPagination.vue';

// 재능마켓 계약(정산) — 목록(탭 counts)·상세 드로어·정산 완료 기록/자동확정 정지·해제/운영 취소.
// 상태·금액 라벨은 @sp/api-contract 정본을 그대로 쓴다. 관리자는 블라인드 예외(원 식별자·계좌 노출).

const filters = ref<AdminMarketContractFilters>({ page: 1, pageSize: 20, tab: 'all', q: '' });
const qInput = ref('');
const { data, isFetching } = useAdminMarketContractList(filters);

const selectedId = ref<number | null>(null);
const detailQ = useAdminMarketContractDetail(selectedId);
const detail = computed(() => detailQ.data.value?.data);

const settle = useContractSettle();
const hold = useContractHold();
const unhold = useContractUnhold();
const cancel = useAdminCancelContract();

const settleNote = ref('');
const holdReason = ref('');
const cancelReason = ref('');
const actionError = ref('');

// 탭 표기는 실무형(정산 대기 병기 등). counts 키는 MARKET_CONTRACT_STATUSES 와 정렬.
const TABS = ['all', 'pending', 'paid', 'delivered', 'completed', 'settled', 'cancelled'] as const;
const tabLabel: Record<(typeof TABS)[number], string> = {
  all: '전체',
  pending: '결제 대기',
  paid: '작업 진행',
  delivered: '납품 완료',
  completed: '검수 확정(정산 대기)',
  settled: '정산 완료',
  cancelled: '취소',
};

const setTab = (tab: AdminMarketContractFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

function openDetail(id: number): void {
  selectedId.value = id;
  settleNote.value = '';
  holdReason.value = '';
  cancelReason.value = '';
  actionError.value = '';
}

const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
const feePct = (bp: number): string => (bp / 100).toFixed(bp % 100 === 0 ? 0 : 2);
const dt = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

function actionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.payload?.message ?? err.message;
  return fallback;
}

// 목록·드로어 공통 "주요 시각" — 상태별로 가장 의미 있는 타임스탬프.
const primaryTime = (
  c: { status: string; createdAt: string; paidAt: string | null; deliveredAt: string | null; completedAt: string | null; settledAt: string | null; cancelledAt: string | null },
): { label: string; at: string } => {
  if (c.status === 'settled' && c.settledAt !== null) return { label: '정산', at: c.settledAt };
  if (c.status === 'cancelled' && c.cancelledAt !== null) return { label: '취소', at: c.cancelledAt };
  if (c.status === 'completed' && c.completedAt !== null) return { label: '확정', at: c.completedAt };
  if (c.status === 'delivered' && c.deliveredAt !== null) return { label: '납품', at: c.deliveredAt };
  if (c.status === 'paid' && c.paidAt !== null) return { label: '결제', at: c.paidAt };
  return { label: '생성', at: c.createdAt };
};

const statusBadge = (s: string): string =>
  s === 'settled'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'completed'
      ? 'bg-teal-100 text-teal-700'
      : s === 'delivered'
        ? 'bg-indigo-100 text-indigo-700'
        : s === 'paid'
          ? 'bg-blue-100 text-blue-700'
          : s === 'pending'
            ? 'bg-amber-100 text-amber-700'
            : s === 'cancelled'
              ? 'bg-red-100 text-red-700'
              : 'bg-gray-100 text-gray-600';

async function onSettle(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  try {
    await settle.mutateAsync({ contractId: selectedId.value, note: settleNote.value.trim() });
    settleNote.value = '';
  } catch (err) {
    actionError.value = actionErrorMessage(err, '정산 완료 기록에 실패했습니다.');
  }
}

async function onHold(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  if (holdReason.value.trim() === '') {
    actionError.value = '정지 사유를 입력해 주세요.';
    return;
  }
  try {
    await hold.mutateAsync({ contractId: selectedId.value, reason: holdReason.value.trim() });
    holdReason.value = '';
  } catch (err) {
    actionError.value = actionErrorMessage(err, '자동확정 정지에 실패했습니다.');
  }
}

async function onUnhold(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  try {
    await unhold.mutateAsync(selectedId.value);
  } catch (err) {
    actionError.value = actionErrorMessage(err, '정지 해제에 실패했습니다.');
  }
}

async function onCancel(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  if (cancelReason.value.trim() === '') {
    actionError.value = '취소 사유를 입력해 주세요.';
    return;
  }
  try {
    await cancel.mutateAsync({ contractId: selectedId.value, reason: cancelReason.value.trim() });
    cancelReason.value = '';
  } catch (err) {
    actionError.value = actionErrorMessage(err, '운영 취소에 실패했습니다.');
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminMarketFiles}/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const anyPending = computed(
  () =>
    settle.isPending.value ||
    hold.isPending.value ||
    unhold.isPending.value ||
    cancel.isPending.value,
);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">마켓 계약 · 정산</h1>

    <!-- 탭 + 검색 -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 text-xs font-semibold">
        <button
          v-for="t in TABS"
          :key="t"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(t)"
        >
          {{ tabLabel[t] }}
          <span v-if="data !== undefined" class="ml-1 text-[11px] opacity-70">
            {{ data.data.counts[t] }}
          </span>
        </button>
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          placeholder="프로젝트명·회원ID 검색"
          class="h-9 w-56 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button
          type="button"
          class="h-9 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white"
          @click="applySearch"
        >
          검색
        </button>
      </div>
    </div>

    <!-- 목록 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3">계약 / 프로젝트</th>
            <th class="px-4 py-3">의뢰인</th>
            <th class="px-4 py-3">전문가</th>
            <th class="px-4 py-3 text-right">금액 / 수수료 / 실수령</th>
            <th class="px-4 py-3">상태</th>
            <th class="px-4 py-3">주요 시각</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in data?.data.items ?? []"
            :key="c.contractId"
            class="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
            @click="openDetail(c.contractId)"
          >
            <td class="max-w-64 px-4 py-3">
              <div class="truncate font-semibold text-gray-900">{{ c.projectTitle }}</div>
              <div class="text-[11px] text-gray-400">#{{ c.contractId }}</div>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">
              {{ c.clientName !== '' ? `${c.clientName} (${c.clientMbId})` : c.clientMbId }}
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ c.expertDisplayName }}</td>
            <td class="px-4 py-3 text-right text-xs">
              <div class="font-semibold text-gray-900">{{ won(c.amount) }}</div>
              <div class="text-[11px] text-gray-400">
                수수료 {{ won(c.feeAmount) }} · 실수령 {{ won(c.payoutAmount) }}
              </div>
            </td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap items-center gap-1">
                <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(c.status)">
                  {{ MARKET_CONTRACT_STATUS_LABELS[c.status] }}
                </span>
                <span v-if="c.holdAt !== null" class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  정지
                </span>
                <span v-if="c.confirmedBy === 'auto'" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                  자동확정
                </span>
              </div>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">
              <span class="text-gray-400">{{ primaryTime(c).label }}</span>
              {{ primaryTime(c).at.slice(0, 10) }}
            </td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-xs text-gray-400">
              {{ isFetching ? '불러오는 중…' : '대상이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ data.data.total }}건</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>

    <!-- 상세 드로어 -->
    <div v-if="selectedId !== null" class="fixed inset-0 z-40 flex justify-end bg-black/30" @click.self="selectedId = null">
      <div class="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">계약 상세</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="selectedId = null">✕</button>
        </div>

        <div v-if="detail === undefined" class="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
        <template v-else>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(detail.status)">
              {{ MARKET_CONTRACT_STATUS_LABELS[detail.status] }}
            </span>
            <span v-if="detail.holdAt !== null" class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
              자동확정 정지
            </span>
            <span v-if="detail.confirmedBy === 'auto'" class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
              자동확정
            </span>
            <span class="text-[11px] text-gray-400">#{{ detail.contractId }}</span>
          </div>
          <h3 class="mt-2 text-base font-bold text-gray-900">{{ detail.projectTitle }}</h3>
          <p class="mt-0.5 text-xs text-gray-500">
            {{ MARKET_PROJECT_CATEGORY_LABELS[detail.project.category] }} ·
            {{ MARKET_METHOD_LABELS[detail.project.method] }} ·
            프로젝트 {{ MARKET_PROJECT_STATUS_LABELS[detail.project.status] }}
            <span class="text-gray-400">(#{{ detail.projectId }})</span>
          </p>

          <!-- 당사자 -->
          <dl class="mt-4 grid grid-cols-[96px_1fr] gap-y-2 text-xs">
            <dt class="text-gray-500">의뢰인</dt>
            <dd>{{ detail.clientName !== '' ? detail.clientName : '(탈퇴)' }} ({{ detail.clientMbId }})</dd>
            <dt class="text-gray-500">전문가</dt>
            <dd>{{ detail.expertDisplayName }} ({{ detail.expertMbId }})</dd>
          </dl>

          <!-- 금액 -->
          <div class="mt-4 rounded-xl border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-500">정산 금액</p>
            <dl class="mt-2 grid grid-cols-2 gap-y-1.5 text-xs">
              <dt class="text-gray-500">계약 총액(VAT 포함)</dt>
              <dd class="text-right font-semibold text-gray-900">{{ won(detail.amount) }}</dd>
              <dt class="text-gray-500">수수료({{ feePct(detail.feeRateBp) }}%)</dt>
              <dd class="text-right text-gray-700">− {{ won(detail.feeAmount) }}</dd>
              <dt class="font-bold text-gray-700">전문가 실수령</dt>
              <dd class="text-right font-bold text-emerald-700">{{ won(detail.payoutAmount) }}</dd>
            </dl>
          </div>

          <!-- 결제(od 파생) — 항상 표시. 승격 래칫과 od 현재 상태 괴리 가시화 -->
          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">결제(주문 파생)</p>
            <div v-if="detail.payment !== null" class="mt-1.5 rounded-lg bg-gray-50 p-3 text-xs">
              <dl class="grid grid-cols-[88px_1fr] gap-y-1">
                <dt class="text-gray-500">주문번호</dt>
                <dd class="font-mono">{{ detail.payment.odId }}</dd>
                <dt class="text-gray-500">주문상태</dt>
                <dd>{{ detail.payment.odStatus }}<span class="text-gray-400"> · {{ detail.payment.settleCase }}</span></dd>
                <dt class="text-gray-500">수납액</dt>
                <dd>{{ won(detail.payment.receiptPrice) }}</dd>
                <dt class="text-gray-500">미수금</dt>
                <dd :class="detail.payment.misu > 0 ? 'font-bold text-red-600' : 'text-gray-700'">
                  {{ won(detail.payment.misu) }}
                </dd>
              </dl>
            </div>
            <p v-else class="mt-1.5 rounded-lg bg-gray-50 p-3 text-xs text-gray-400">주문 없음</p>
          </div>

          <!-- 전문가 정산 계좌(관리자만) -->
          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">전문가 정산 계좌</p>
            <p class="mt-1 text-xs text-gray-700">
              {{ detail.bankName ?? '-' }} {{ detail.bankAccount ?? '' }}
              <span class="text-gray-500">({{ detail.bankHolder ?? '-' }})</span>
            </p>
          </div>

          <!-- 진행 시각 -->
          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">진행 이력</p>
            <dl class="mt-1.5 grid grid-cols-[96px_1fr] gap-y-1 text-xs text-gray-700">
              <dt class="text-gray-500">생성</dt>
              <dd>{{ dt(detail.createdAt) }}</dd>
              <template v-if="detail.paidAt !== null">
                <dt class="text-gray-500">결제</dt>
                <dd>{{ dt(detail.paidAt) }}</dd>
              </template>
              <template v-if="detail.deliveredAt !== null">
                <dt class="text-gray-500">납품</dt>
                <dd>{{ dt(detail.deliveredAt) }}</dd>
              </template>
              <template v-if="detail.autoConfirmAt !== null">
                <dt class="text-gray-500">자동확정 예정</dt>
                <dd class="font-semibold text-indigo-600">{{ dt(detail.autoConfirmAt) }}</dd>
              </template>
              <template v-if="detail.holdAt !== null">
                <dt class="text-gray-500">정지</dt>
                <dd class="text-red-600">
                  {{ dt(detail.holdAt) }}<span v-if="detail.holdReason !== null"> · {{ detail.holdReason }}</span>
                </dd>
              </template>
              <template v-if="detail.completedAt !== null">
                <dt class="text-gray-500">검수 확정</dt>
                <dd>{{ dt(detail.completedAt) }}<span v-if="detail.confirmedBy !== null" class="text-gray-400"> ({{ detail.confirmedBy === 'auto' ? '자동' : '의뢰인' }})</span></dd>
              </template>
              <template v-if="detail.settledAt !== null">
                <dt class="text-gray-500">정산 완료</dt>
                <dd>
                  {{ dt(detail.settledAt) }}<span v-if="detail.settledBy !== null" class="text-gray-400"> · {{ detail.settledBy }}</span>
                </dd>
              </template>
              <template v-if="detail.cancelledAt !== null">
                <dt class="text-gray-500">취소</dt>
                <dd class="text-red-600">
                  {{ dt(detail.cancelledAt) }}<span v-if="detail.cancelReason !== null"> · {{ detail.cancelReason }}</span>
                </dd>
              </template>
            </dl>
          </div>

          <!-- 정산 메모(기록됨) -->
          <div v-if="detail.settleNote !== null" class="mt-4">
            <p class="text-xs font-bold text-gray-500">정산 메모</p>
            <p class="mt-1 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
              {{ detail.settleNote }}
            </p>
          </div>

          <!-- 납품 노트 -->
          <div v-if="detail.deliveryNote !== null" class="mt-4">
            <p class="text-xs font-bold text-gray-500">납품 노트</p>
            <p class="mt-1 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
              {{ detail.deliveryNote }}
            </p>
          </div>

          <!-- 산출물 -->
          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">산출물 ({{ detail.files.length }})</p>
            <ul class="mt-1.5 grid gap-1">
              <li
                v-for="f in detail.files"
                :key="f.fileId"
                class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <button type="button" class="font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
                  다운로드
                </button>
              </li>
              <li v-if="detail.files.length === 0" class="text-xs text-gray-400">산출물 없음</li>
            </ul>
          </div>

          <!-- 액션 -->
          <div
            v-if="detail.status === 'delivered' || detail.status === 'completed' || detail.status === 'pending' || detail.status === 'paid'"
            class="mt-6 space-y-3"
          >
            <p v-if="actionError !== ''" class="text-xs font-semibold text-red-600">{{ actionError }}</p>

            <!-- delivered: 자동확정 정지 / 정지 해제 -->
            <div v-if="detail.status === 'delivered'" class="rounded-xl border border-gray-200 p-4">
              <p class="text-xs font-bold text-gray-700">자동확정 관리</p>
              <template v-if="detail.holdAt === null">
                <p class="mt-1 text-[11px] text-gray-500">
                  분쟁·검수 지연 시 7일 자동확정을 멈춥니다(사유 필수).
                </p>
                <input
                  v-model="holdReason"
                  type="text"
                  placeholder="정지 사유"
                  class="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
                >
                <button
                  type="button"
                  class="mt-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40"
                  :disabled="anyPending"
                  @click="onHold"
                >
                  자동확정 정지
                </button>
              </template>
              <template v-else>
                <p class="mt-1 text-[11px] text-gray-500">현재 자동확정이 정지된 상태입니다.</p>
                <button
                  type="button"
                  class="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                  :disabled="anyPending"
                  @click="onUnhold"
                >
                  정지 해제
                </button>
              </template>
            </div>

            <!-- completed: 정산 완료 기록 -->
            <div v-if="detail.status === 'completed'" class="rounded-xl border border-emerald-200 p-4">
              <p class="text-xs font-bold text-emerald-700">정산 완료 기록</p>
              <p class="mt-1 text-[11px] text-gray-500">
                계좌이체는 수동입니다 — 여기는 정산 완료 사실만 기록합니다(메모 선택).
              </p>
              <input
                v-model="settleNote"
                type="text"
                placeholder="정산 메모(선택)"
                class="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
              >
              <button
                type="button"
                class="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="anyPending"
                @click="onSettle"
              >
                정산 완료 기록
              </button>
            </div>

            <!-- pending·paid·delivered: 운영 취소 -->
            <div
              v-if="detail.status === 'pending' || detail.status === 'paid' || detail.status === 'delivered'"
              class="rounded-xl border border-red-200 p-4"
            >
              <p class="text-xs font-bold text-red-600">운영 취소 (신고·분쟁 대응)</p>
              <p class="mt-1 text-[11px] text-gray-500">
                환불 실행은 주문 관리/PG에서 — 여기는 계약 취소만 기록합니다(사유 필수).
              </p>
              <input
                v-model="cancelReason"
                type="text"
                placeholder="취소 사유"
                class="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
              >
              <button
                type="button"
                class="mt-2 rounded-lg border border-red-300 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
                :disabled="anyPending"
                @click="onCancel"
              >
                운영 취소
              </button>
            </div>
          </div>

          <p v-else-if="detail.status === 'settled'" class="mt-6 text-xs text-gray-400">
            정산이 완료된 계약입니다 — 추가 액션이 없습니다.
          </p>
          <p v-else-if="detail.status === 'cancelled'" class="mt-6 text-xs text-gray-400">
            취소된 계약입니다 — 추가 액션이 없습니다.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
