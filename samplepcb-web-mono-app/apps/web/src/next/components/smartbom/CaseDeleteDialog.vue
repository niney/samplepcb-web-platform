<script setup lang="ts">
import { computed, ref } from 'vue';
import { TriangleAlertIcon } from '@lucide/vue';
import type { AdminBomCaseDeleteResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  SMARTBOM_DELETE_BLOCKER_TEXT,
  SMARTBOM_DELETE_WARNING_TEXT,
  SMARTBOM_STATUS_META,
} from '@/admin/smartbom';
import { useAdminBomCaseDeletePreview, useDeleteAdminBomCase } from '@/admin/useAdminBomQuotes';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
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
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';

// SmartBOM Case 영구 삭제 — 옛 BomCaseDeleteModal 의 짝(같은 props·emits). 3단: ① 서버가 계산한 삭제
// 영향(관계 수·주문·선적 연결·차단/경고) → ② 기록 모드(감사 남김/안 남김)·결제 주문 강제·사유·복구 불가
// 확인 → ③ 결과. 미리보기 토큰이 낡았거나(STALE_PREVIEW) 그 사이 결제·엔진 잡이 생기면 영향부터 다시 본다.
// 부모가 v-if 로 마운트한다(열린 채로 마운트 — 닫힘은 close/deleted).
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

// 결제 주문만이 유일한 차단일 때 — 강제 확인으로 넘길 수 있다(외부 PG 환불은 하지 않음).
const paidOrderForceAvailable = computed(() => {
  const data = preview.value;
  return (
    data !== null &&
    data.order.action === 'delete-paid-order' &&
    data.blockers.length > 0 &&
    data.blockers.every((blocker) => blocker === 'PAID_ORDER')
  );
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
const combinedError = computed(() => (localError.value !== '' ? localError.value : mutationError.value));

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

// 기록 모드·강제 여부를 바꾸면 앞서 한 '복구 불가' 확인은 무효 — 다시 읽고 체크하게 한다.
function setResetMode(value: boolean | 'indeterminate'): void {
  resetMode.value = value === true;
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCase.reset();
}
function setForcePaidOrder(value: boolean | 'indeterminate'): void {
  forceDeletePaidOrder.value = value === true;
  acknowledgeIrreversible.value = false;
  localError.value = '';
  deleteCase.reset();
}
function setAcknowledged(value: boolean | 'indeterminate'): void {
  acknowledgeIrreversible.value = value === true;
}

async function retryPreview(): Promise<void> {
  localError.value = '';
  deleteCase.reset();
  await previewQuery.refetch();
}

async function submitDelete(): Promise<void> {
  const data = preview.value;
  if (data === null || !canSubmit.value) return;
  localError.value = '';
  try {
    const common = {
      previewToken: data.previewToken,
      acknowledgeIrreversible: true as const,
      ...(paidOrderForceAvailable.value && forceDeletePaidOrder.value ? { forceDeletePaidOrder: true as const } : {}),
    };
    const response = resetMode.value
      ? await deleteCase.mutateAsync({ quoteId: props.quoteId, body: { mode: 'reset', ...common } })
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
const onOpenChange = (open: boolean): void => {
  if (!open) close();
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <!-- ① 1차 레이어 — 실제 관계를 서버가 계산한 삭제 영향 -->
    <DialogContent v-if="step === 'impact'" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogDescription>1차 경고 · 삭제 영향 확인</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            SmartBOM Case를 영구 삭제합니다
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody class="space-y-4">
        <p v-if="previewQuery.isLoading.value" class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <Spinner />
          주문·발주·선적·파일 관계를 확인하는 중…
        </p>
        <Alert v-else-if="previewQuery.isError.value || preview === null" variant="destructive">
          <AlertDescription>
            <p>삭제 영향을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>
            <Button class="mt-2" variant="outline" size="sm" :disabled="previewQuery.isFetching.value" @click="void retryPreview()">
              <Spinner v-if="previewQuery.isFetching.value" />
              {{ previewQuery.isFetching.value ? '삭제 영향 확인 중…' : '삭제 영향 다시 확인' }}
            </Button>
          </AlertDescription>
        </Alert>
        <template v-else>
          <Panel muted>
            <p class="text-muted-foreground font-mono text-xs font-semibold">{{ preview.case.caseNo }}</p>
            <p class="mt-1 text-base font-semibold">{{ preview.case.title }}</p>
            <p class="text-muted-foreground mt-1 text-xs">
              고객 {{ preview.case.mbId }} · 상태 {{ SMARTBOM_STATUS_META[preview.case.status].label }}
            </p>
          </Panel>

          <Alert v-if="preview.blockers.length > 0" variant="destructive">
            <AlertTitle>
              {{ paidOrderForceAvailable ? '결제 주문 강제 삭제 확인이 필요합니다' : '이 Case는 영구 삭제할 수 없습니다' }}
            </AlertTitle>
            <AlertDescription>
              <ul class="space-y-1 text-xs">
                <li v-for="item in preview.blockers" :key="item">• {{ SMARTBOM_DELETE_BLOCKER_TEXT[item] }}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <!-- 함께 지워지는 관계 수 — 칸은 같은 Panel, 숫자만 굵게 -->
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Panel>
              <p class="text-muted-foreground text-xs">품목 · 시트</p>
              <p class="mt-1 font-semibold tabular-nums">{{ preview.impact.quoteItems }} · {{ preview.impact.quoteSheets }}</p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">후보 · 선택 이력</p>
              <p class="mt-1 font-semibold tabular-nums">{{ preview.impact.candidates }} · {{ preview.impact.selectionEvents }}</p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">분석 · 검색 · 엔진 잡</p>
              <p class="mt-1 font-semibold tabular-nums">
                {{ preview.impact.analysisRecords }} · {{ preview.impact.supplierSearchRecords }} · {{ preview.impact.engineJobs }}
              </p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">RFQ · 회신 행</p>
              <p class="mt-1 font-semibold tabular-nums">{{ preview.impact.rfqs }} · {{ preview.impact.rfqItems }}</p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">발주서 · 발주 품목</p>
              <p class="mt-1 font-semibold tabular-nums">{{ preview.impact.pos }} · {{ preview.impact.poItems }}</p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">영구 삭제 파일</p>
              <p class="mt-1 font-semibold tabular-nums">{{ preview.impact.quoteFiles + preview.impact.shipmentFiles }}</p>
            </Panel>
            <Panel>
              <p class="text-muted-foreground text-xs">선적 품목 · QR 포장 · 추적 이력</p>
              <p class="mt-1 font-semibold tabular-nums">
                {{ preview.impact.shipmentItems }} · {{ preview.impact.shipmentPackages }} ·
                {{ preview.impact.shipmentPackageEvents }}
              </p>
            </Panel>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Panel size="md" class="text-xs">
              <p class="font-semibold">주문 연결</p>
              <p class="text-muted-foreground mt-2">
                상태 {{ preview.order.state }}
                <template v-if="preview.order.odId !== null"> · 주문 {{ preview.order.odId }} ({{ preview.order.odStatus }})</template>
              </p>
              <p v-if="preview.order.action === 'remove-cart-row'" class="text-warning mt-1 font-medium">
                해당 장바구니 행과 옵션을 제거합니다.
              </p>
              <p v-else-if="preview.order.action === 'delete-unpaid-order'" class="text-warning mt-1 font-medium">
                단독 미입금 주문과 연결 장바구니 행을 함께 삭제합니다.
              </p>
              <template v-else-if="preview.order.action === 'delete-paid-order'">
                <p class="text-destructive mt-1 font-medium">강제 확인 시 단독 결제 주문과 로컬 결제 관련 기록을 함께 삭제합니다.</p>
                <p class="text-destructive mt-1">
                  주문 보조 기록 {{ preview.order.relatedRecords }}건 · 외부 PG 환불/승인취소는 실행하지 않음
                </p>
              </template>
              <p v-else-if="preview.order.state === 'none'" class="text-muted-foreground mt-1">연결된 주문 데이터가 없습니다.</p>
            </Panel>
            <Panel size="md" class="text-xs">
              <p class="font-semibold">선적 연결</p>
              <p class="text-muted-foreground mt-2 tabular-nums">
                전체 {{ preview.shipment.total }} · 공유 {{ preview.shipment.shared }} · 함께 삭제 {{ preview.shipment.willDelete }}
              </p>
              <p v-if="preview.shipment.inProgress > 0" class="text-destructive mt-1 font-medium">
                진행·완료 선적 {{ preview.shipment.inProgress }}건도 강제 정리합니다.
              </p>
              <p v-if="preview.shipment.shared > 0" class="text-info mt-1 font-medium">
                공유 선적은 보존하고 이 Case 소속만 분리합니다.
              </p>
              <p v-else-if="preview.shipment.total === 0" class="text-muted-foreground mt-1">연결된 선적이 없습니다.</p>
            </Panel>
          </div>

          <Alert v-if="preview.warnings.length > 0" variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              <ul class="space-y-1 text-xs">
                <li v-for="item in preview.warnings" :key="item">{{ SMARTBOM_DELETE_WARNING_TEXT[item] }}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <p v-if="combinedError !== ''" class="text-destructive text-sm font-medium">{{ combinedError }}</p>
        </template>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" @click="close">취소</Button>
        <Button variant="destructive" :disabled="!canContinue" @click="openConfirm">
          {{ paidOrderForceAvailable ? '결제 주문 강제 삭제 확인' : '강제 삭제 계속' }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ② 2차 레이어 — 삭제 기록 모드 + 복구 불가 최종 확인 -->
    <DialogContent v-else-if="step === 'confirm' && preview !== null" class="sm:max-w-xl">
      <DialogHeader>
        <DialogDescription>2차 경고 · 최종 확인</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            되돌릴 수 없는 영구 삭제입니다
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody class="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>
            <span class="font-mono text-xs">{{ preview.case.caseNo }}</span> · {{ preview.case.title }}
          </AlertTitle>
          <AlertDescription>
            삭제가 시작되면 원본 BOM, 분석·후보, RFQ·회신, 발주 데이터와 소유 파일을 복원할 수 없습니다.
          </AlertDescription>
        </Alert>

        <!-- 선택 카드(FieldLabel > Field) — 되돌리기 어려운 선택은 제목 글자를 붉게. -->
        <FieldLabel for="bom-case-delete-reset">
          <Field orientation="horizontal">
            <Checkbox id="bom-case-delete-reset" :model-value="resetMode" @update:model-value="setResetMode" />
            <FieldContent>
              <FieldTitle><span class="text-destructive">삭제 감사기록도 남기지 않음</span></FieldTitle>
              <FieldDescription>
                SmartBOM 삭제 감사행과 영카트 주문 삭제 백업을 남기지 않습니다. 서버 접속 로그·DB 백업·발송 이메일·외부
                시스템 기록까지 없어진다는 뜻은 아닙니다.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>

        <FieldLabel v-if="paidOrderForceAvailable" for="bom-case-delete-paid">
          <Field orientation="horizontal">
            <Checkbox id="bom-case-delete-paid" :model-value="forceDeletePaidOrder" @update:model-value="setForcePaidOrder" />
            <FieldContent>
              <FieldTitle><span class="text-destructive">결제 이력·주문까지 강제 삭제</span></FieldTitle>
              <FieldDescription>
                <span class="text-destructive font-medium">
                  영카트 주문, 장바구니 행, 쿠폰·포인트·PG 로컬 로그를 함께 삭제하고 차감 재고를 복원합니다. 외부 결제사 승인
                  취소·환불은 별도로 처리해야 합니다.
                </span>
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>

        <div v-if="!resetMode" class="space-y-1.5">
          <Label for="bom-case-delete-reason">
            삭제 사유 <span class="text-destructive">필수</span>
          </Label>
          <Textarea
            id="bom-case-delete-reason"
            v-model="reason"
            rows="3"
            maxlength="1000"
            placeholder="중복 등록, 잘못 생성된 Case 등"
          />
        </div>

        <FieldLabel for="bom-case-delete-ack">
          <Field orientation="horizontal">
            <Checkbox id="bom-case-delete-ack" :model-value="acknowledgeIrreversible" @update:model-value="setAcknowledged" />
            <FieldContent>
              <FieldTitle>
                <span class="text-warning">외부 이메일·공급사 작업은 회수되지 않으며 삭제 데이터는 복구할 수 없음을 확인했습니다.</span>
              </FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>

        <p v-if="combinedError !== ''" class="text-destructive text-sm font-medium">{{ combinedError }}</p>
      </DialogScrollBody>

      <DialogFooter class="sm:justify-between">
        <Button variant="ghost" :disabled="deleteCase.isPending.value" @click="backToImpact">이전</Button>
        <Button variant="destructive" :disabled="!canSubmit" @click="void submitDelete()">
          <Spinner v-if="deleteCase.isPending.value" />
          {{
            deleteCase.isPending.value
              ? '관련 데이터 삭제 중…'
              : resetMode
                ? '기록 없이 관련 데이터 영구 삭제'
                : 'Case 영구 삭제'
          }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ③ 완료 결과도 대화상자 안에서 확인한 뒤 목록으로 이동 -->
    <DialogContent v-else-if="step === 'result' && result !== null" class="sm:max-w-md">
      <DialogHeader>
        <DialogDescription>삭제 완료</DialogDescription>
        <DialogTitle>SmartBOM Case가 영구 삭제되었습니다</DialogTitle>
      </DialogHeader>
      <div class="space-y-2 text-sm">
        <p class="text-muted-foreground">
          품목 {{ result.deleted.quoteItems }}건 · RFQ {{ result.deleted.rfqs }}건 · 발주 {{ result.deleted.pos }}건 · 엔진 잡
          {{ result.engineJobsDeleted }}건 · 파일 {{ result.filesDeleted }}건을 정리했습니다.
        </p>
        <p class="text-muted-foreground text-xs">
          {{
            result.auditRetained
              ? '관리자·사유·삭제 영향의 최소 감사기록을 보존했습니다.'
              : '요청대로 SmartBOM 삭제 감사기록을 남기지 않았습니다.'
          }}
        </p>
        <Alert v-if="result.paidOrderDeleted" variant="destructive" size="sm">
          <AlertDescription>
            로컬 결제 주문 기록을 강제 삭제했습니다. 외부 PG 환불·승인 취소 여부는 결제사에서 별도로 확인해야 합니다.
          </AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button @click="close">Case 목록으로</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
