<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AdminBomCaseDeleteResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  SMARTBOM_DELETE_BLOCKER_TEXT,
  SMARTBOM_DELETE_WARNING_TEXT,
  SMARTBOM_STATUS_META,
} from '../../../admin/smartbom';
import {
  useAdminBomCaseDeletePreview,
  useDeleteAdminBomCase,
} from '../../../admin/useAdminBomQuotes';

const props = defineProps<{ quoteId: string }>();
const emit = defineEmits<{ close: []; deleted: [] }>();

type DeleteStep = 'impact' | 'confirm' | 'result';

const step = ref<DeleteStep>('impact');
const quoteIdRef = computed(() => props.quoteId);
const enabled = ref(true);
const previewQuery = useAdminBomCaseDeletePreview(quoteIdRef, enabled);
const preview = computed(() => previewQuery.data.value?.data ?? null);
const deleteCase = useDeleteAdminBomCase();

const resetMode = ref(false);
const forceDeletePaidOrder = ref(false);
const reason = ref('');
const acknowledgeIrreversible = ref(false);
const result = ref<AdminBomCaseDeleteResponseType['data'] | null>(null);
const localError = ref('');

const paidOrderForceAvailable = computed(() => {
  const data = preview.value;
  return data !== null
    && data.order.action === 'delete-paid-order'
    && data.blockers.length > 0
    && data.blockers.every((blocker) => blocker === 'PAID_ORDER');
});

const canContinue = computed(() => preview.value?.canDelete === true || paidOrderForceAvailable.value);

const canSubmit = computed(() => {
  const data = preview.value;
  if (data === null || !canContinue.value || deleteCase.isPending.value) return false;
  if (paidOrderForceAvailable.value && !forceDeletePaidOrder.value) return false;
  if (!resetMode.value && reason.value.trim().length < 2) return false;
  return acknowledgeIrreversible.value;
});

const mutationError = computed(() => {
  const error = deleteCase.error.value;
  if (error === null) return '';
  if (error instanceof ApiRequestError) return error.payload?.message ?? error.message;
  return 'Case 삭제에 실패했습니다.';
});

const combinedError = computed(() => localError.value || mutationError.value);

function openConfirm(): void {
  if (!canContinue.value) return;
  step.value = 'confirm';
  localError.value = '';
  deleteCase.reset();
}

function backToImpact(): void {
  if (deleteCase.isPending.value) return;
  step.value = 'impact';
  resetMode.value = false;
  forceDeletePaidOrder.value = false;
  reason.value = '';
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCase.reset();
}

function toggleResetMode(): void {
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCase.reset();
}

function toggleForcePaidOrder(): void {
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCase.reset();
}

async function submitDelete(): Promise<void> {
  const data = preview.value;
  if (data === null || !canSubmit.value) return;
  localError.value = '';
  try {
    const common = {
      previewToken: data.previewToken,
      acknowledgeIrreversible: true as const,
      ...(paidOrderForceAvailable.value && forceDeletePaidOrder.value
        ? { forceDeletePaidOrder: true as const }
        : {}),
    };
    const response = resetMode.value
      ? await deleteCase.mutateAsync({
          quoteId: props.quoteId,
          body: { mode: 'reset', ...common },
        })
      : await deleteCase.mutateAsync({
          quoteId: props.quoteId,
          body: { mode: 'audited', reason: reason.value.trim(), ...common },
        });
    result.value = response.data;
    step.value = 'result';
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.payload?.error === 'STALE_PREVIEW' ||
        error.payload?.error === 'PAID_ORDER' ||
        error.payload?.error === 'ENGINE_JOB_ACTIVE')
    ) {
      await previewQuery.refetch();
      step.value = 'impact';
      resetMode.value = false;
      forceDeletePaidOrder.value = false;
      acknowledgeIrreversible.value = false;
      localError.value = error.payload.message;
      deleteCase.reset();
    }
  }
}

function close(): void {
  if (deleteCase.isPending.value) return;
  if (result.value !== null) emit('deleted');
  else emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/45" @click="close" />

      <!-- 1차 레이어: 실제 관계를 서버가 계산한 삭제 영향 -->
      <section
        v-if="step === 'impact'"
        class="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bom-case-delete-impact-title"
      >
        <header class="border-b border-red-100 bg-red-50 px-6 py-4">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-500">1차 경고 · 삭제 영향 확인</p>
          <h2 id="bom-case-delete-impact-title" class="mt-1 text-lg font-extrabold text-red-800">
            SmartBOM Case를 영구 삭제합니다
          </h2>
        </header>

        <div class="max-h-[68vh] overflow-y-auto px-6 py-5">
          <p v-if="previewQuery.isLoading.value" class="py-12 text-center text-sm text-gray-400">
            주문·발주·선적·파일 관계를 확인하는 중…
          </p>
          <div v-else-if="previewQuery.isError.value || preview === null" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            삭제 영향을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
          <template v-else>
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p class="font-mono text-xs font-bold text-gray-500">{{ preview.case.caseNo }}</p>
              <p class="mt-1 text-base font-bold text-gray-900">{{ preview.case.title }}</p>
              <p class="mt-1 text-xs text-gray-500">고객 {{ preview.case.mbId }} · 상태 {{ SMARTBOM_STATUS_META[preview.case.status].label }}</p>
            </div>

            <div v-if="preview.blockers.length > 0" class="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
              <p class="text-sm font-extrabold text-red-800">
                {{ paidOrderForceAvailable ? '결제 주문 강제 삭제 확인이 필요합니다' : '이 Case는 영구 삭제할 수 없습니다' }}
              </p>
              <ul class="mt-2 space-y-1 text-xs leading-5 text-red-700">
                <li v-for="item in preview.blockers" :key="item">• {{ SMARTBOM_DELETE_BLOCKER_TEXT[item] }}</li>
              </ul>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">품목 · 시트</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.quoteItems }} · {{ preview.impact.quoteSheets }}</p>
              </div>
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">후보 · 선택 이력</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.candidates }} · {{ preview.impact.selectionEvents }}</p>
              </div>
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">분석 · 검색 · 엔진 잡</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.analysisRecords }} · {{ preview.impact.supplierSearchRecords }} · {{ preview.impact.engineJobs }}</p>
              </div>
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">RFQ · 회신 행</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.rfqs }} · {{ preview.impact.rfqItems }}</p>
              </div>
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">발주서 · 발주 품목</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.pos }} · {{ preview.impact.poItems }}</p>
              </div>
              <div class="rounded-lg border border-gray-200 p-3">
                <p class="text-[11px] text-gray-500">영구 삭제 파일</p>
                <p class="mt-1 font-bold tabular-nums">{{ preview.impact.quoteFiles + preview.impact.shipmentFiles }}</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border border-gray-200 p-4 text-xs">
                <p class="font-bold text-gray-800">주문 연결</p>
                <p class="mt-2 text-gray-600">
                  상태 {{ preview.order.state }}
                  <template v-if="preview.order.odId !== null"> · 주문 {{ preview.order.odId }} ({{ preview.order.odStatus }})</template>
                </p>
                <p v-if="preview.order.action === 'remove-cart-row'" class="mt-1 font-semibold text-amber-700">해당 장바구니 행과 옵션을 제거합니다.</p>
                <p v-else-if="preview.order.action === 'delete-unpaid-order'" class="mt-1 font-semibold text-amber-700">단독 미입금 주문과 연결 장바구니 행을 함께 삭제합니다.</p>
                <template v-else-if="preview.order.action === 'delete-paid-order'">
                  <p class="mt-1 font-semibold text-red-700">강제 확인 시 단독 결제 주문과 로컬 결제 관련 기록을 함께 삭제합니다.</p>
                  <p class="mt-1 text-red-600">주문 보조 기록 {{ preview.order.relatedRecords }}건 · 외부 PG 환불/승인취소는 실행하지 않음</p>
                </template>
                <p v-else-if="preview.order.state === 'none'" class="mt-1 text-gray-400">연결된 주문 데이터가 없습니다.</p>
              </div>
              <div class="rounded-xl border border-gray-200 p-4 text-xs">
                <p class="font-bold text-gray-800">선적 연결</p>
                <p class="mt-2 text-gray-600">전체 {{ preview.shipment.total }} · 공유 {{ preview.shipment.shared }} · 함께 삭제 {{ preview.shipment.willDelete }}</p>
                <p v-if="preview.shipment.inProgress > 0" class="mt-1 font-semibold text-red-700">진행·완료 선적 {{ preview.shipment.inProgress }}건도 강제 정리합니다.</p>
                <p v-if="preview.shipment.shared > 0" class="mt-1 font-semibold text-blue-700">공유 선적은 보존하고 이 Case 소속만 분리합니다.</p>
                <p v-else-if="preview.shipment.total === 0" class="mt-1 text-gray-400">연결된 선적이 없습니다.</p>
              </div>
            </div>

            <ul v-if="preview.warnings.length > 0" class="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
              <li v-for="item in preview.warnings" :key="item">⚠ {{ SMARTBOM_DELETE_WARNING_TEXT[item] }}</li>
            </ul>

            <p v-if="combinedError !== ''" class="mt-3 text-sm font-semibold text-red-600">{{ combinedError }}</p>
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button type="button" class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" @click="close">취소</button>
          <button
            type="button"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canContinue"
            @click="openConfirm"
          >
            {{ paidOrderForceAvailable ? '결제 주문 강제 삭제 확인' : '강제 삭제 계속' }}
          </button>
        </footer>
      </section>

      <!-- 2차 레이어: 삭제 기록 모드 + 복구 불가 최종 확인 -->
      <section
        v-else-if="step === 'confirm' && preview !== null"
        class="relative max-h-[90vh] w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bom-case-delete-confirm-title"
      >
        <header class="border-b border-red-200 bg-red-700 px-6 py-4 text-white">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-100">2차 경고 · 최종 확인</p>
          <h2 id="bom-case-delete-confirm-title" class="mt-1 text-lg font-extrabold">되돌릴 수 없는 영구 삭제입니다</h2>
        </header>

        <div class="max-h-[68vh] space-y-4 overflow-y-auto px-6 py-5">
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p class="font-mono text-xs font-bold">{{ preview.case.caseNo }}</p>
            <p class="mt-1 font-bold">{{ preview.case.title }}</p>
            <p class="mt-2 text-xs leading-5">삭제가 시작되면 원본 BOM, 분석·후보, RFQ·회신, 발주 데이터와 소유 파일을 복원할 수 없습니다.</p>
          </div>

          <label
            class="flex cursor-pointer gap-3 rounded-xl border border-red-300 bg-red-50 p-4"
          >
            <input
              v-model="resetMode"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="toggleResetMode"
            >
            <span>
              <b class="text-sm text-red-800">삭제 감사기록도 남기지 않음</b>
              <span class="mt-1 block text-xs leading-5 text-gray-600">
                SmartBOM 삭제 감사행과 영카트 주문 삭제 백업을 남기지 않습니다. 서버 접속 로그·DB 백업·발송 이메일·외부 시스템 기록까지 없어진다는 뜻은 아닙니다.
              </span>
            </span>
          </label>

          <label
            v-if="paidOrderForceAvailable"
            class="flex cursor-pointer gap-3 rounded-xl border-2 border-red-500 bg-red-50 p-4"
          >
            <input
              v-model="forceDeletePaidOrder"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="toggleForcePaidOrder"
            >
            <span>
              <b class="text-sm text-red-900">결제 이력·주문까지 강제 삭제</b>
              <span class="mt-1 block text-xs font-semibold leading-5 text-red-700">
                영카트 주문, 장바구니 행, 쿠폰·포인트·PG 로컬 로그를 함께 삭제하고 차감 재고를 복원합니다. 외부 결제사 승인 취소·환불은 별도로 처리해야 합니다.
              </span>
            </span>
          </label>

          <label v-if="!resetMode" class="block text-xs font-semibold text-gray-700">
            삭제 사유 <span class="text-red-600">필수</span>
            <textarea
              v-model="reason"
              rows="3"
              maxlength="1000"
              class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              placeholder="중복 등록, 잘못 생성된 Case 등"
            />
          </label>

          <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input v-model="acknowledgeIrreversible" type="checkbox" class="mt-0.5 size-4 accent-red-700">
            <span>외부 이메일·공급사 작업은 회수되지 않으며 삭제 데이터는 복구할 수 없음을 확인했습니다.</span>
          </label>

          <p v-if="combinedError !== ''" class="text-sm font-semibold text-red-600">{{ combinedError }}</p>
        </div>

        <footer class="flex justify-between border-t border-gray-200 px-6 py-4">
          <button type="button" class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" :disabled="deleteCase.isPending.value" @click="backToImpact">이전</button>
          <button
            type="button"
            class="rounded-lg bg-red-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSubmit"
            @click="submitDelete"
          >
            {{ deleteCase.isPending.value ? '관련 데이터 삭제 중…' : resetMode ? '기록 없이 관련 데이터 영구 삭제' : 'Case 영구 삭제' }}
          </button>
        </footer>
      </section>

      <!-- 완료 결과도 레이어 안에서 확인한 뒤 목록으로 이동 -->
      <section
        v-else-if="step === 'result' && result !== null"
        class="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <p class="text-xs font-bold uppercase tracking-wider text-emerald-600">삭제 완료</p>
        <h2 class="mt-1 text-lg font-extrabold text-gray-900">SmartBOM Case가 영구 삭제되었습니다</h2>
        <p class="mt-3 text-sm text-gray-600">
          품목 {{ result.deleted.quoteItems }}건 · RFQ {{ result.deleted.rfqs }}건 · 발주 {{ result.deleted.pos }}건 · 엔진 잡 {{ result.engineJobsDeleted }}건 · 파일 {{ result.filesDeleted }}건을 정리했습니다.
        </p>
        <p class="mt-2 text-xs text-gray-500">
          {{ result.auditRetained ? '관리자·사유·삭제 영향의 최소 감사기록을 보존했습니다.' : '요청대로 SmartBOM 삭제 감사기록을 남기지 않았습니다.' }}
        </p>
        <p v-if="result.paidOrderDeleted" class="mt-2 text-xs font-semibold text-red-700">
          로컬 결제 주문 기록을 강제 삭제했습니다. 외부 PG 환불·승인 취소 여부는 결제사에서 별도로 확인해야 합니다.
        </p>
        <div class="mt-5 flex justify-end">
          <button type="button" class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black" @click="close">Case 목록으로</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
