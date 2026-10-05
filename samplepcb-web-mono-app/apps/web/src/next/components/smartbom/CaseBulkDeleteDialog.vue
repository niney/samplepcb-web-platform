<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleAlertIcon, TriangleAlertIcon } from '@lucide/vue';
import type { AdminBomCaseDeleteImpactType, AdminBomCaseDeleteWarningType } from '@sp/api-contract';
import {
  SMARTBOM_DELETE_BLOCKER_TEXT,
  SMARTBOM_DELETE_WARNING_TEXT,
  SMARTBOM_STATUS_META,
} from '@/admin/smartbom';
import {
  useAdminBomCaseDeletePreviews,
  useDeleteAdminBomCases,
  type AdminBomCaseBulkDeleteResult,
} from '@/admin/useAdminBomQuotes';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { Label } from '@/next/components/ui/label';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';

// SmartBOM Case 일괄 영구 삭제 — 옛 components/admin/smartbom/BomCaseBulkDeleteModal.vue 의 포트(같은
// props·emits). 호출부가 v-if 로 띄우고 close·deleted 로 내린다(열린 채로 마운트된다).
//   ① impact  — 선택한 모든 Case 의 최신 삭제 영향과 차단 사유(서버 판정이 정본)
//   ② confirm — 공통 기록 모드(감사 생략)·결제 주문 강제·사유·복구 불가 최종 확인
//   ③ result  — 삭제·유지·실행 직전 검증 실패를 한 화면에서
// 결제 주문(PAID_ORDER)만 걸린 건은 '결제 강제 가능'으로 따로 모아 별도 체크로만 넘긴다.
const props = defineProps<{ quoteIds: string[] }>();
const emit = defineEmits<{ close: []; deleted: [caseIds: string[]] }>();

type DeleteStep = 'impact' | 'confirm' | 'result';
const step = ref<DeleteStep>('impact');

const quoteIdsRef = computed(() => props.quoteIds);
const previewQuery = useAdminBomCaseDeletePreviews(quoteIdsRef, ref(true));
const previewItems = computed(() => previewQuery.data.value ?? []);
const deletableItems = computed(() => previewItems.value.filter((item) => item.preview?.canDelete === true));
const paidOrderForceItems = computed(() =>
  previewItems.value.filter(
    (item) =>
      item.preview !== null &&
      !item.preview.canDelete &&
      item.preview.order.action === 'delete-paid-order' &&
      item.preview.blockers.length > 0 &&
      item.preview.blockers.every((blocker) => blocker === 'PAID_ORDER'),
  ),
);
const protectedItems = computed(() =>
  previewItems.value.filter((item) => item.preview?.canDelete === false && !paidOrderForceItems.value.includes(item)),
);
const previewFailedItems = computed(() => previewItems.value.filter((item) => item.preview === null));

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
  shipmentItems: 0,
  shipmentPackages: 0,
  shipmentPackageEvents: 0,
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
  shipmentItems: left.shipmentItems + right.shipmentItems,
  shipmentPackages: left.shipmentPackages + right.shipmentPackages,
  shipmentPackageEvents: left.shipmentPackageEvents + right.shipmentPackageEvents,
});

const previewImpact = computed(() =>
  candidateItems.value.reduce(
    (total, item) => (item.preview === null ? total : addImpact(total, item.preview.impact)),
    EMPTY_IMPACT,
  ),
);
const resultImpact = computed(() =>
  (result.value?.deleted ?? []).reduce((total, item) => addImpact(total, item.deleted), EMPTY_IMPACT),
);

const warnings = computed(() => {
  const values = new Set<AdminBomCaseDeleteWarningType>();
  for (const item of candidateItems.value) {
    for (const warning of item.preview?.warnings ?? []) values.add(warning);
  }
  return [...values];
});

const orderDeleteCount = computed(
  () => candidateItems.value.filter((item) => item.preview?.order.action === 'delete-unpaid-order').length,
);
const paidOrderDeleteCount = computed(() => paidOrderForceItems.value.length);
const cartRemoveCount = computed(
  () => candidateItems.value.filter((item) => item.preview?.order.action === 'remove-cart-row').length,
);
const inProgressShipmentCount = computed(() =>
  candidateItems.value.reduce((total, item) => total + (item.preview?.shipment.inProgress ?? 0), 0),
);
const paidRelatedRecordCount = computed(() =>
  paidOrderForceItems.value.reduce((total, item) => total + (item.preview?.order.relatedRecords ?? 0), 0),
);
const impactCells = computed(() => [
  { label: '품목 · 시트', value: `${String(previewImpact.value.quoteItems)} · ${String(previewImpact.value.quoteSheets)}` },
  { label: 'RFQ · 발주', value: `${String(previewImpact.value.rfqs)} · ${String(previewImpact.value.pos)}` },
  { label: '선적 · 진행/완료', value: `${String(previewImpact.value.shipments)} · ${String(inProgressShipmentCount.value)}` },
  {
    label: '파일 · 엔진 잡',
    value: `${String(previewImpact.value.quoteFiles + previewImpact.value.shipmentFiles)} · ${String(previewImpact.value.engineJobs)}`,
  },
]);

const canContinue = computed(
  () => !previewQuery.isLoading.value && !previewQuery.isError.value && candidateItems.value.length > 0,
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

const itemTone = (item: (typeof previewItems.value)[number]): { label: string; variant: 'success' | 'warning' | 'danger' } =>
  item.preview?.canDelete === true
    ? { label: '삭제 가능', variant: 'success' }
    : paidOrderForceItems.value.includes(item)
      ? { label: '결제 강제 가능', variant: 'warning' }
      : { label: '보호됨', variant: 'danger' };

// 기록 모드·강제 선택을 바꾸면 복구 불가 확인을 다시 받는다.
const setResetMode = (value: boolean | 'indeterminate'): void => {
  resetMode.value = value === true;
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCases.reset();
};
const setForcePaidOrder = (value: boolean | 'indeterminate'): void => {
  forceDeletePaidOrder.value = value === true;
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCases.reset();
};
const setAcknowledged = (value: boolean | 'indeterminate'): void => {
  acknowledgeIrreversible.value = value === true;
};

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

async function retryPreviews(): Promise<void> {
  localError.value = '';
  deleteCases.reset();
  await previewQuery.refetch();
}

async function submitDelete(): Promise<void> {
  if (!canSubmit.value) return;
  const targets = executionItems.value.flatMap((item) =>
    item.preview === null ? [] : [{ quoteId: item.quoteId, previewToken: item.preview.previewToken }],
  );
  localError.value = '';
  try {
    result.value = resetMode.value
      ? await deleteCases.mutateAsync({ targets, mode: 'reset', forceDeletePaidOrder: forceDeletePaidOrder.value })
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
  emit(
    'deleted',
    result.value.deleted.map((item) => item.caseId),
  );
}
const onOpenChange = (open: boolean): void => {
  if (!open) close();
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <!-- ① 1차 레이어: 선택한 모든 Case 의 최신 삭제 영향과 차단 사유 -->
    <DialogContent v-if="step === 'impact'" class="sm:max-w-3xl">
      <DialogHeader>
        <DialogDescription>1차 경고 · 일괄 삭제 영향 확인</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            선택한 SmartBOM Case {{ quoteIds.length }}건을 확인합니다
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody class="space-y-4">
        <p
          v-if="previewQuery.isLoading.value"
          class="text-muted-foreground flex items-center justify-center gap-2 py-14 text-sm"
        >
          <Spinner />
          주문·발주·선적·파일 관계를 Case별로 확인하는 중…
        </p>
        <Alert v-else-if="previewQuery.isError.value" variant="destructive">
          <AlertTitle>삭제 영향을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              class="mt-2"
              :disabled="previewQuery.isFetching.value"
              @click="void retryPreviews()"
            >
              {{ previewQuery.isFetching.value ? '삭제 영향 확인 중…' : '삭제 영향 다시 확인' }}
            </Button>
          </AlertDescription>
        </Alert>
        <template v-else>
          <!-- 통계 4칸 — 칸은 같은 Panel, 뜻은 숫자 색으로만 -->
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">선택</p>
              <p class="mt-1 text-xl font-semibold tabular-nums">{{ quoteIds.length }}</p>
            </Panel>
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">삭제 가능</p>
              <p class="text-success mt-1 text-xl font-semibold tabular-nums">{{ deletableItems.length }}</p>
            </Panel>
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">결제 강제 가능</p>
              <p class="text-warning mt-1 text-xl font-semibold tabular-nums">{{ paidOrderForceItems.length }}</p>
            </Panel>
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">보호·조회 실패</p>
              <p class="text-destructive mt-1 text-xl font-semibold tabular-nums">
                {{ protectedItems.length + previewFailedItems.length }}
              </p>
            </Panel>
          </div>

          <!-- 합산 영향 -->
          <Alert v-if="candidateItems.length > 0" variant="destructive">
            <AlertTitle>삭제 또는 결제 강제 삭제 가능한 {{ candidateItems.length }}건의 합산 영향</AlertTitle>
            <AlertDescription>
              <dl class="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                <div v-for="cell in impactCells" :key="cell.label" class="bg-background/60 rounded-md p-3">
                  <dt class="text-muted-foreground text-xs">{{ cell.label }}</dt>
                  <dd class="text-foreground mt-1 font-semibold tabular-nums">{{ cell.value }}</dd>
                </div>
              </dl>
              <p v-if="previewImpact.shipmentPackages > 0" class="mt-3 text-xs font-medium">
                선적 품목 {{ previewImpact.shipmentItems }}건 · QR 포장 {{ previewImpact.shipmentPackages }}건 · 추적 이력
                {{ previewImpact.shipmentPackageEvents }}건도 영구 삭제합니다.
              </p>
              <p v-if="orderDeleteCount + cartRemoveCount > 0" class="text-warning mt-3 text-xs font-medium">
                단독 미입금 주문 {{ orderDeleteCount }}건과 장바구니 행 {{ cartRemoveCount }}건도 함께 정리합니다.
              </p>
              <p v-if="paidOrderDeleteCount > 0" class="mt-2 text-xs font-medium">
                별도 체크 시 결제 주문 {{ paidOrderDeleteCount }}건과 로컬 주문 보조 기록
                {{ paidRelatedRecordCount }}건도 삭제합니다. 외부 PG 환불·승인 취소는 실행하지 않습니다.
              </p>
            </AlertDescription>
          </Alert>

          <!-- 건별 카드 — 판정은 우측 배지, 보호 사유·결제 강제 대가는 글자로 -->
          <ul class="space-y-2">
            <li v-for="item in previewItems" :key="item.quoteId">
              <Panel>
                <template v-if="item.preview !== null">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-muted-foreground font-mono text-xs">{{ item.preview.case.caseNo }}</p>
                      <p class="truncate text-sm font-medium">{{ item.preview.case.title }}</p>
                      <p class="text-muted-foreground mt-0.5 text-xs">
                        고객 {{ item.preview.case.mbId }} · {{ SMARTBOM_STATUS_META[item.preview.case.status].label }}
                      </p>
                    </div>
                    <Badge :variant="itemTone(item).variant">{{ itemTone(item).label }}</Badge>
                  </div>
                  <p v-if="item.preview.canDelete" class="text-muted-foreground mt-2 text-xs">
                    품목 {{ item.preview.impact.quoteItems }} · RFQ {{ item.preview.impact.rfqs }} · 발주
                    {{ item.preview.impact.pos }} · 선적 {{ item.preview.impact.shipments }}
                  </p>
                  <p v-else-if="paidOrderForceItems.includes(item)" class="text-warning mt-2 text-xs font-medium">
                    결제 주문 {{ item.preview.order.odId }} · 보조 기록 {{ item.preview.order.relatedRecords }}건 · 강제 체크
                    시 삭제
                  </p>
                  <ul v-else class="text-destructive mt-2 space-y-1 text-xs">
                    <li v-for="blocker in item.preview.blockers" :key="blocker">
                      • {{ SMARTBOM_DELETE_BLOCKER_TEXT[blocker] }}
                    </li>
                  </ul>
                </template>
                <template v-else>
                  <p class="text-destructive font-mono text-xs">Case #{{ item.quoteId }}</p>
                  <p class="text-destructive mt-1 text-xs font-medium">
                    {{ item.error ?? '삭제 영향을 조회하지 못했습니다.' }}
                  </p>
                </template>
              </Panel>
            </li>
          </ul>

          <Alert v-if="warnings.length > 0" variant="warning">
            <CircleAlertIcon />
            <AlertDescription>
              <ul class="space-y-1 text-xs">
                <li v-for="warning in warnings" :key="warning">{{ SMARTBOM_DELETE_WARNING_TEXT[warning] }}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <Alert v-if="protectedItems.length + previewFailedItems.length > 0" variant="destructive" size="sm">
            <AlertTitle>
              보호되거나 조회하지 못한 {{ protectedItems.length + previewFailedItems.length }}건은 삭제하지 않고 목록에
              남깁니다.
            </AlertTitle>
            <AlertDescription v-if="previewFailedItems.length > 0">
              <Button
                variant="outline"
                size="sm"
                class="mt-1"
                :disabled="previewQuery.isFetching.value"
                @click="void retryPreviews()"
              >
                {{ previewQuery.isFetching.value ? '삭제 영향 확인 중…' : '삭제 영향 다시 확인' }}
              </Button>
            </AlertDescription>
          </Alert>
          <p v-if="combinedError !== ''" class="text-destructive text-sm font-medium">{{ combinedError }}</p>
        </template>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" @click="close">취소</Button>
        <Button variant="destructive" :disabled="!canContinue" @click="openConfirm">
          삭제·강제 가능 {{ candidateItems.length }}건 계속
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ② 2차 레이어: 공통 기록 모드와 복구 불가 최종 확인 -->
    <DialogContent v-else-if="step === 'confirm'" class="sm:max-w-xl">
      <DialogHeader>
        <DialogDescription>2차 경고 · 최종 확인</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            선택한 Case {{ candidateItems.length }}건의 최종 삭제 대상을 확인합니다
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody class="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>되돌릴 수 없는 일괄 삭제입니다.</AlertTitle>
          <AlertDescription>
            원본 BOM, 분석·후보, RFQ·회신, 발주 데이터와 소유 파일을 복원할 수 없습니다. 각 Case는 실행 직전에 다시
            검증하며, 상태가 바뀐 Case는 건너뛰고 결과에 표시합니다.
          </AlertDescription>
        </Alert>

        <!-- 선택 카드(FieldLabel > Field) — 되돌리기 어려운 선택은 제목 글자를 붉게 -->
        <FieldLabel for="bom-bulk-delete-reset">
          <Field orientation="horizontal">
            <Checkbox id="bom-bulk-delete-reset" :model-value="resetMode" @update:model-value="setResetMode" />
            <FieldContent>
              <FieldTitle><span class="text-destructive">삭제 감사기록도 남기지 않음</span></FieldTitle>
              <FieldDescription>
                모든 삭제 대상에 같은 모드를 적용합니다. SmartBOM 삭제 감사행과 영카트 주문 삭제 백업은 남기지 않지만
                서버 로그·DB 백업·발송 이메일·외부 시스템 기록까지 없어진다는 뜻은 아닙니다.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>

        <FieldLabel v-if="paidOrderForceItems.length > 0" for="bom-bulk-delete-force-paid">
          <Field orientation="horizontal">
            <Checkbox
              id="bom-bulk-delete-force-paid"
              :model-value="forceDeletePaidOrder"
              @update:model-value="setForcePaidOrder"
            />
            <FieldContent>
              <FieldTitle>
                <span class="text-destructive">결제 이력·주문 {{ paidOrderForceItems.length }}건도 강제 삭제</span>
              </FieldTitle>
              <FieldDescription>
                해당 Case의 영카트 주문, 장바구니 행, 쿠폰·포인트·PG 로컬 로그를 삭제하고 차감 재고를 복원합니다. 외부
                결제사 승인 취소·환불은 별도로 처리해야 합니다.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>

        <div v-if="!resetMode" class="space-y-1.5">
          <Label for="bom-bulk-delete-reason">
            공통 삭제 사유 <span class="text-destructive font-normal">필수</span>
          </Label>
          <Textarea
            id="bom-bulk-delete-reason"
            v-model="reason"
            rows="3"
            maxlength="1000"
            placeholder="중복 등록된 Case 일괄 정리 등"
          />
        </div>

        <FieldLabel for="bom-bulk-delete-ack">
          <Field orientation="horizontal">
            <Checkbox
              id="bom-bulk-delete-ack"
              :model-value="acknowledgeIrreversible"
              @update:model-value="setAcknowledged"
            />
            <FieldContent>
              <FieldTitle>
                <span class="text-warning">
                  외부 이메일·공급사 작업은 회수되지 않으며 선택한 데이터는 복구할 수 없음을 확인했습니다.
                </span>
              </FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>

        <p v-if="combinedError !== ''" class="text-destructive text-sm font-medium">{{ combinedError }}</p>
      </DialogScrollBody>

      <DialogFooter class="sm:justify-between">
        <Button variant="ghost" :disabled="deleteCases.isPending.value" @click="backToImpact">이전</Button>
        <Button variant="destructive" :disabled="!canSubmit" @click="void submitDelete()">
          <Spinner v-if="deleteCases.isPending.value" />
          {{
            deleteCases.isPending.value
              ? 'Case별 관련 데이터 삭제 중…'
              : executionItems.length === 0
                ? '결제 주문 강제 삭제 체크 필요'
                : resetMode
                  ? `${String(executionItems.length)}건 기록 없이 영구 삭제`
                  : `${String(executionItems.length)}건 영구 삭제`
          }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ③ 완료·부분 실패를 한 화면에서 -->
    <DialogContent v-else-if="step === 'result' && result !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogDescription>일괄 삭제 결과</DialogDescription>
        <DialogTitle>
          {{ result.deleted.length }}건 삭제 · {{ quoteIds.length - result.deleted.length }}건 유지
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody class="space-y-3">
        <Alert v-if="result.deleted.length > 0" variant="success">
          <AlertTitle>SmartBOM Case {{ result.deleted.length }}건을 영구 삭제했습니다.</AlertTitle>
          <AlertDescription>
            품목 {{ resultImpact.quoteItems }}건 · RFQ {{ resultImpact.rfqs }}건 · 발주 {{ resultImpact.pos }}건 · QR 포장
            {{ resultImpact.shipmentPackages }}건 · 추적 이력 {{ resultImpact.shipmentPackageEvents }}건 · 엔진 잡
            {{ resultImpact.engineJobs }}건 · 파일 {{ resultImpact.quoteFiles + resultImpact.shipmentFiles }}건을
            정리했습니다.
          </AlertDescription>
        </Alert>

        <Alert v-if="result.deleted.some((item) => item.paidOrderDeleted)" variant="destructive" size="sm">
          <AlertDescription>
            결제 주문 {{ result.deleted.filter((item) => item.paidOrderDeleted).length }}건의 로컬 기록을 강제
            삭제했습니다. 외부 PG 환불·승인 취소 여부는 별도로 확인해야 합니다.
          </AlertDescription>
        </Alert>

        <Alert v-if="quoteIds.length - executionItems.length > 0" variant="muted" size="sm">
          <AlertDescription>
            처음부터 보호되거나 조회하지 못했거나 결제 강제 삭제를 선택하지 않은
            {{ quoteIds.length - executionItems.length }}건은 삭제 대상에서 제외했습니다.
          </AlertDescription>
        </Alert>

        <Alert v-if="result.failed.length > 0" variant="destructive">
          <AlertTitle>실행 직전 검증·삭제 실패 {{ result.failed.length }}건</AlertTitle>
          <AlertDescription>
            <ul class="space-y-1 text-xs">
              <li v-for="failure in result.failed" :key="failure.quoteId">
                <span class="font-semibold">{{ caseLabel(failure.quoteId) }}</span> — {{ failure.message }}
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        <p v-if="result.deleted.length > 0" class="text-muted-foreground text-xs">
          {{
            resetMode
              ? '요청대로 삭제된 Case의 SmartBOM 감사기록을 남기지 않았습니다.'
              : '삭제된 각 Case에 관리자·공통 사유·삭제 영향의 최소 감사기록을 보존했습니다.'
          }}
        </p>
      </DialogScrollBody>

      <DialogFooter>
        <Button @click="close">목록으로</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
