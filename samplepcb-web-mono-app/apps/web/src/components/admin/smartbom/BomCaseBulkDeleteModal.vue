<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type {
  AdminBomCaseDeleteImpactType,
  AdminBomCaseDeleteWarningType,
} from '@sp/api-contract';
import {
  SMARTBOM_DELETE_BLOCKER_TEXT,
  SMARTBOM_DELETE_WARNING_TEXT,
  SMARTBOM_STATUS_META,
} from '../../../admin/smartbom';
import {
  useAdminBomCaseDeletePreviews,
  useDeleteAdminBomCases,
  type AdminBomCaseBulkDeleteResult,
} from '../../../admin/useAdminBomQuotes';

const props = defineProps<{ quoteIds: string[] }>();
const emit = defineEmits<{ close: []; deleted: [caseIds: string[]] }>();

type DeleteStep = 'impact' | 'confirm' | 'result';

const step = ref<DeleteStep>('impact');
const enabled = ref(true);
const quoteIdsRef = computed(() => props.quoteIds);
const previewQuery = useAdminBomCaseDeletePreviews(quoteIdsRef, enabled);
const previewItems = computed(() => previewQuery.data.value ?? []);
const deletableItems = computed(() =>
  previewItems.value.filter((item) => item.preview?.canDelete === true),
);
const paidOrderForceItems = computed(() =>
  previewItems.value.filter(
    (item) => item.preview !== null
      && !item.preview.canDelete
      && item.preview.order.action === 'delete-paid-order'
      && item.preview.blockers.length > 0
      && item.preview.blockers.every((blocker) => blocker === 'PAID_ORDER'),
  ),
);
const protectedItems = computed(() =>
  previewItems.value.filter(
    (item) => item.preview?.canDelete === false && !paidOrderForceItems.value.includes(item),
  ),
);
const previewFailedItems = computed(() =>
  previewItems.value.filter((item) => item.preview === null),
);

const resetMode = ref(false);
const forceDeletePaidOrder = ref(false);
const reason = ref('');
const acknowledgeIrreversible = ref(false);
const deleteCases = useDeleteAdminBomCases();
const result = ref<AdminBomCaseBulkDeleteResult | null>(null);
const localError = ref('');
const candidateItems = computed(() => [...deletableItems.value, ...paidOrderForceItems.value]);
const executionItems = computed(() => [
  ...deletableItems.value,
  ...(forceDeletePaidOrder.value ? paidOrderForceItems.value : []),
]);

const EMPTY_IMPACT: AdminBomCaseDeleteImpactType = {
  quoteItems: 0,
  quoteSheets: 0,
  candidates: 0,
  selectionEvents: 0,
  analysisRecords: 0,
  supplierSearchRecords: 0,
  engineJobs: 0,
  rfqs: 0,
  rfqItems: 0,
  pos: 0,
  poItems: 0,
  quoteFiles: 0,
  shipments: 0,
  shipmentFiles: 0,
};

const addImpact = (
  left: AdminBomCaseDeleteImpactType,
  right: AdminBomCaseDeleteImpactType,
): AdminBomCaseDeleteImpactType => ({
  quoteItems: left.quoteItems + right.quoteItems,
  quoteSheets: left.quoteSheets + right.quoteSheets,
  candidates: left.candidates + right.candidates,
  selectionEvents: left.selectionEvents + right.selectionEvents,
  analysisRecords: left.analysisRecords + right.analysisRecords,
  supplierSearchRecords: left.supplierSearchRecords + right.supplierSearchRecords,
  engineJobs: left.engineJobs + right.engineJobs,
  rfqs: left.rfqs + right.rfqs,
  rfqItems: left.rfqItems + right.rfqItems,
  pos: left.pos + right.pos,
  poItems: left.poItems + right.poItems,
  quoteFiles: left.quoteFiles + right.quoteFiles,
  shipments: left.shipments + right.shipments,
  shipmentFiles: left.shipmentFiles + right.shipmentFiles,
});

const previewImpact = computed(() =>
  candidateItems.value.reduce(
    (total, item) => item.preview === null ? total : addImpact(total, item.preview.impact),
    EMPTY_IMPACT,
  ),
);

const resultImpact = computed(() =>
  (result.value?.deleted ?? []).reduce(
    (total, item) => addImpact(total, item.deleted),
    EMPTY_IMPACT,
  ),
);

const warnings = computed(() => {
  const values = new Set<AdminBomCaseDeleteWarningType>();
  for (const item of candidateItems.value) {
    for (const warning of item.preview?.warnings ?? []) values.add(warning);
  }
  return [...values];
});

const orderDeleteCount = computed(() =>
  candidateItems.value.filter((item) => item.preview?.order.action === 'delete-unpaid-order').length,
);
const paidOrderDeleteCount = computed(() => paidOrderForceItems.value.length);
const cartRemoveCount = computed(() =>
  candidateItems.value.filter((item) => item.preview?.order.action === 'remove-cart-row').length,
);
const inProgressShipmentCount = computed(() =>
  candidateItems.value.reduce((total, item) => total + (item.preview?.shipment.inProgress ?? 0), 0),
);
const paidRelatedRecordCount = computed(() =>
  paidOrderForceItems.value.reduce(
    (total, item) => total + (item.preview?.order.relatedRecords ?? 0),
    0,
  ),
);

const canContinue = computed(() =>
  !previewQuery.isLoading.value
  && !previewQuery.isError.value
  && candidateItems.value.length > 0,
);

const canSubmit = computed(() => {
  if (deleteCases.isPending.value || executionItems.value.length === 0) return false;
  if (!resetMode.value && reason.value.trim().length < 2) return false;
  return acknowledgeIrreversible.value;
});

const mutationError = computed(() => {
  const error = deleteCases.error.value;
  return error instanceof Error ? error.message : '';
});
const combinedError = computed(() => localError.value || mutationError.value);

function openConfirm(): void {
  if (!canContinue.value) return;
  step.value = 'confirm';
  localError.value = '';
  deleteCases.reset();
}

function backToImpact(): void {
  if (deleteCases.isPending.value) return;
  step.value = 'impact';
  resetMode.value = false;
  forceDeletePaidOrder.value = false;
  reason.value = '';
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCases.reset();
}

function toggleResetMode(): void {
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCases.reset();
}

function toggleForcePaidOrder(): void {
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCases.reset();
}

async function submitDelete(): Promise<void> {
  if (!canSubmit.value) return;
  const targets = executionItems.value.flatMap((item) =>
    item.preview === null
      ? []
      : [{ quoteId: item.quoteId, previewToken: item.preview.previewToken }],
  );
  localError.value = '';
  try {
    result.value = resetMode.value
      ? await deleteCases.mutateAsync({
          targets,
          mode: 'reset',
          forceDeletePaidOrder: forceDeletePaidOrder.value,
        })
      : await deleteCases.mutateAsync({
          targets,
          mode: 'audited',
          reason: reason.value.trim(),
          forceDeletePaidOrder: forceDeletePaidOrder.value,
        });
    step.value = 'result';
  } catch {
    localError.value = '일괄 삭제 작업을 완료하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.';
  }
}

function caseLabel(quoteId: string): string {
  const item = previewItems.value.find((entry) => entry.quoteId === quoteId);
  return item?.preview?.case.caseNo ?? `Case #${quoteId}`;
}

function close(): void {
  if (deleteCases.isPending.value) return;
  if (result.value === null) {
    emit('close');
    return;
  }
  emit('deleted', result.value.deleted.map((item) => item.caseId));
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

      <!-- 1차 레이어: 선택한 모든 Case의 최신 삭제 영향과 차단 사유 -->
      <section
        v-if="step === 'impact'"
        class="relative max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bom-case-bulk-delete-impact-title"
      >
        <header class="border-b border-red-100 bg-red-50 px-6 py-4">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-500">1차 경고 · 일괄 삭제 영향 확인</p>
          <h2 id="bom-case-bulk-delete-impact-title" class="mt-1 text-lg font-extrabold text-red-800">
            선택한 SmartBOM Case {{ quoteIds.length }}건을 확인합니다
          </h2>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-6 py-5">
          <p v-if="previewQuery.isLoading.value" class="py-14 text-center text-sm text-gray-400">
            주문·발주·선적·파일 관계를 Case별로 확인하는 중…
          </p>
          <div v-else-if="previewQuery.isError.value" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            삭제 영향을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
          <template v-else>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
                <p class="text-[11px] text-gray-500">선택</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-gray-900">{{ quoteIds.length }}</p>
              </div>
              <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p class="text-[11px] text-emerald-700">삭제 가능</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-emerald-800">{{ deletableItems.length }}</p>
              </div>
              <div class="rounded-xl border border-orange-300 bg-orange-50 p-3 text-center">
                <p class="text-[11px] text-orange-700">결제 강제 가능</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-orange-800">{{ paidOrderForceItems.length }}</p>
              </div>
              <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                <p class="text-[11px] text-red-600">보호·조회 실패</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-red-700">{{ protectedItems.length + previewFailedItems.length }}</p>
              </div>
            </div>

            <div v-if="candidateItems.length > 0" class="mt-4 rounded-xl border border-red-200 p-4">
              <p class="text-sm font-extrabold text-red-800">삭제 또는 결제 강제 삭제 가능한 {{ candidateItems.length }}건의 합산 영향</p>
              <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">품목 · 시트</p>
                  <p class="mt-1 font-bold tabular-nums">{{ previewImpact.quoteItems }} · {{ previewImpact.quoteSheets }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">RFQ · 발주</p>
                  <p class="mt-1 font-bold tabular-nums">{{ previewImpact.rfqs }} · {{ previewImpact.pos }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">선적 · 진행/완료</p>
                  <p class="mt-1 font-bold tabular-nums">{{ previewImpact.shipments }} · {{ inProgressShipmentCount }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">파일 · 엔진 잡</p>
                  <p class="mt-1 font-bold tabular-nums">{{ previewImpact.quoteFiles + previewImpact.shipmentFiles }} · {{ previewImpact.engineJobs }}</p>
                </div>
              </div>
              <p v-if="orderDeleteCount + cartRemoveCount > 0" class="mt-3 text-xs font-semibold text-amber-700">
                단독 미입금 주문 {{ orderDeleteCount }}건과 장바구니 행 {{ cartRemoveCount }}건도 함께 정리합니다.
              </p>
              <p v-if="paidOrderDeleteCount > 0" class="mt-2 text-xs font-semibold text-red-700">
                별도 체크 시 결제 주문 {{ paidOrderDeleteCount }}건과 로컬 주문 보조 기록 {{ paidRelatedRecordCount }}건도 삭제합니다. 외부 PG 환불·승인 취소는 실행하지 않습니다.
              </p>
            </div>

            <div class="mt-4 space-y-2">
              <div
                v-for="item in previewItems"
                :key="item.quoteId"
                class="rounded-xl border p-3"
                :class="item.preview?.canDelete === true ? 'border-gray-200' : paidOrderForceItems.includes(item) ? 'border-orange-300 bg-orange-50/60' : 'border-red-200 bg-red-50/60'"
              >
                <template v-if="item.preview !== null">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="font-mono text-[11px] font-bold text-gray-500">{{ item.preview.case.caseNo }}</p>
                      <p class="truncate text-sm font-bold text-gray-900">{{ item.preview.case.title }}</p>
                      <p class="mt-0.5 text-[11px] text-gray-500">
                        고객 {{ item.preview.case.mbId }} · {{ SMARTBOM_STATUS_META[item.preview.case.status].label }}
                      </p>
                    </div>
                    <span
                      class="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                      :class="item.preview.canDelete ? 'bg-emerald-100 text-emerald-700' : paidOrderForceItems.includes(item) ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-700'"
                    >
                      {{ item.preview.canDelete ? '삭제 가능' : paidOrderForceItems.includes(item) ? '결제 강제 가능' : '보호됨' }}
                    </span>
                  </div>
                  <p v-if="item.preview.canDelete" class="mt-2 text-[11px] text-gray-500">
                    품목 {{ item.preview.impact.quoteItems }} · RFQ {{ item.preview.impact.rfqs }} · 발주 {{ item.preview.impact.pos }} · 선적 {{ item.preview.impact.shipments }}
                  </p>
                  <p v-else-if="paidOrderForceItems.includes(item)" class="mt-2 text-xs font-semibold leading-5 text-orange-800">
                    결제 주문 {{ item.preview.order.odId }} · 보조 기록 {{ item.preview.order.relatedRecords }}건 · 강제 체크 시 삭제
                  </p>
                  <ul v-else class="mt-2 space-y-1 text-xs leading-5 text-red-700">
                    <li v-for="blocker in item.preview.blockers" :key="blocker">
                      • {{ SMARTBOM_DELETE_BLOCKER_TEXT[blocker] }}
                    </li>
                  </ul>
                </template>
                <template v-else>
                  <p class="font-mono text-[11px] font-bold text-red-500">Case #{{ item.quoteId }}</p>
                  <p class="mt-1 text-xs font-semibold text-red-700">{{ item.error ?? '삭제 영향을 조회하지 못했습니다.' }}</p>
                </template>
              </div>
            </div>

            <ul v-if="warnings.length > 0" class="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
              <li v-for="warning in warnings" :key="warning">⚠ {{ SMARTBOM_DELETE_WARNING_TEXT[warning] }}</li>
            </ul>

            <p v-if="protectedItems.length + previewFailedItems.length > 0" class="mt-3 text-xs font-semibold text-red-700">
              보호되거나 조회하지 못한 {{ protectedItems.length + previewFailedItems.length }}건은 삭제하지 않고 목록에 남깁니다.
            </p>
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
            삭제·강제 가능 {{ candidateItems.length }}건 계속
          </button>
        </footer>
      </section>

      <!-- 2차 레이어: 공통 기록 모드와 복구 불가 최종 확인 -->
      <section
        v-else-if="step === 'confirm'"
        class="relative max-h-[92vh] w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bom-case-bulk-delete-confirm-title"
      >
        <header class="border-b border-red-200 bg-red-700 px-6 py-4 text-white">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-100">2차 경고 · 최종 확인</p>
          <h2 id="bom-case-bulk-delete-confirm-title" class="mt-1 text-lg font-extrabold">
            선택한 Case {{ candidateItems.length }}건의 최종 삭제 대상을 확인합니다
          </h2>
        </header>

        <div class="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p class="font-extrabold">되돌릴 수 없는 일괄 삭제입니다.</p>
            <p class="mt-2 text-xs leading-5">
              원본 BOM, 분석·후보, RFQ·회신, 발주 데이터와 소유 파일을 복원할 수 없습니다. 각 Case는 실행 직전에 다시 검증하며, 상태가 바뀐 Case는 건너뛰고 결과에 표시합니다.
            </p>
          </div>

          <label class="flex cursor-pointer gap-3 rounded-xl border border-red-300 bg-red-50 p-4">
            <input
              v-model="resetMode"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="toggleResetMode"
            >
            <span>
              <b class="text-sm text-red-800">삭제 감사기록도 남기지 않음</b>
              <span class="mt-1 block text-xs leading-5 text-gray-600">
                모든 삭제 대상에 같은 모드를 적용합니다. SmartBOM 삭제 감사행과 영카트 주문 삭제 백업은 남기지 않지만 서버 로그·DB 백업·발송 이메일·외부 시스템 기록까지 없어진다는 뜻은 아닙니다.
              </span>
            </span>
          </label>

          <label
            v-if="paidOrderForceItems.length > 0"
            class="flex cursor-pointer gap-3 rounded-xl border-2 border-red-500 bg-red-50 p-4"
          >
            <input
              v-model="forceDeletePaidOrder"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="toggleForcePaidOrder"
            >
            <span>
              <b class="text-sm text-red-900">결제 이력·주문 {{ paidOrderForceItems.length }}건도 강제 삭제</b>
              <span class="mt-1 block text-xs font-semibold leading-5 text-red-700">
                해당 Case의 영카트 주문, 장바구니 행, 쿠폰·포인트·PG 로컬 로그를 삭제하고 차감 재고를 복원합니다. 외부 결제사 승인 취소·환불은 별도로 처리해야 합니다.
              </span>
            </span>
          </label>

          <label v-if="!resetMode" class="block text-xs font-semibold text-gray-700">
            공통 삭제 사유 <span class="text-red-600">필수</span>
            <textarea
              v-model="reason"
              rows="3"
              maxlength="1000"
              class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              placeholder="중복 등록된 Case 일괄 정리 등"
            />
          </label>

          <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input v-model="acknowledgeIrreversible" type="checkbox" class="mt-0.5 size-4 accent-red-700">
            <span>외부 이메일·공급사 작업은 회수되지 않으며 선택한 데이터는 복구할 수 없음을 확인했습니다.</span>
          </label>

          <p v-if="combinedError !== ''" class="text-sm font-semibold text-red-600">{{ combinedError }}</p>
        </div>

        <footer class="flex justify-between border-t border-gray-200 px-6 py-4">
          <button type="button" class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" :disabled="deleteCases.isPending.value" @click="backToImpact">이전</button>
          <button
            type="button"
            class="rounded-lg bg-red-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSubmit"
            @click="submitDelete"
          >
            {{ deleteCases.isPending.value ? 'Case별 관련 데이터 삭제 중…' : executionItems.length === 0 ? '결제 주문 강제 삭제 체크 필요' : resetMode ? `${executionItems.length}건 기록 없이 영구 삭제` : `${executionItems.length}건 영구 삭제` }}
          </button>
        </footer>
      </section>

      <!-- 완료·부분 실패를 한 화면에서 확인 -->
      <section
        v-else-if="step === 'result' && result !== null"
        class="relative max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bom-case-bulk-delete-result-title"
      >
        <div class="max-h-[75vh] overflow-y-auto p-6">
          <p class="text-xs font-bold uppercase tracking-wider text-emerald-600">일괄 삭제 결과</p>
          <h2 id="bom-case-bulk-delete-result-title" class="mt-1 text-lg font-extrabold text-gray-900">
            {{ result.deleted.length }}건 삭제 · {{ quoteIds.length - result.deleted.length }}건 유지
          </h2>

          <div v-if="result.deleted.length > 0" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p class="font-extrabold">SmartBOM Case {{ result.deleted.length }}건을 영구 삭제했습니다.</p>
            <p class="mt-2 text-xs leading-5">
              품목 {{ resultImpact.quoteItems }}건 · RFQ {{ resultImpact.rfqs }}건 · 발주 {{ resultImpact.pos }}건 · 엔진 잡 {{ resultImpact.engineJobs }}건 · 파일 {{ resultImpact.quoteFiles + resultImpact.shipmentFiles }}건을 정리했습니다.
            </p>
          </div>

          <p v-if="result.deleted.some((item) => item.paidOrderDeleted)" class="mt-3 text-xs font-semibold text-red-700">
            결제 주문 {{ result.deleted.filter((item) => item.paidOrderDeleted).length }}건의 로컬 기록을 강제 삭제했습니다. 외부 PG 환불·승인 취소 여부는 별도로 확인해야 합니다.
          </p>

          <div v-if="quoteIds.length - executionItems.length > 0" class="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
            처음부터 보호되거나 조회하지 못했거나 결제 강제 삭제를 선택하지 않은 {{ quoteIds.length - executionItems.length }}건은 삭제 대상에서 제외했습니다.
          </div>

          <div v-if="result.failed.length > 0" class="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <p class="text-sm font-extrabold text-red-800">실행 직전 검증·삭제 실패 {{ result.failed.length }}건</p>
            <ul class="mt-2 space-y-2 text-xs leading-5 text-red-700">
              <li v-for="failure in result.failed" :key="failure.quoteId">
                <b>{{ caseLabel(failure.quoteId) }}</b> — {{ failure.message }}
              </li>
            </ul>
          </div>

          <p v-if="result.deleted.length > 0" class="mt-3 text-xs text-gray-500">
            {{ resetMode ? '요청대로 삭제된 Case의 SmartBOM 감사기록을 남기지 않았습니다.' : '삭제된 각 Case에 관리자·공통 사유·삭제 영향의 최소 감사기록을 보존했습니다.' }}
          </p>
        </div>
        <footer class="flex justify-end border-t border-gray-200 px-6 py-4">
          <button type="button" class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black" @click="close">목록으로</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
