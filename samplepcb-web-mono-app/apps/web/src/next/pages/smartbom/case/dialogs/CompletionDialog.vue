<script setup lang="ts">
import { FileTextIcon, TriangleAlertIcon } from '@lucide/vue';
import { smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import { useSmartbomCaseContext } from '../useSmartbomCase';

// 고객 회신 확정 — 검토 결과·가안 견적서·이메일 선택을 한 자리에서 최종 점검한다. 확정가가 없으면
// "주문하기·확정 견적서 인쇄 불가" 확인을 받아야 확정 버튼이 열린다(옛 화면과 같은 게이트).
const {
  detail,
  patch,
  completeReview,
  completionOpen,
  completionSendEmail,
  completionEmail,
  completionWithoutPriceConfirmed,
  completionError,
  completionEmailValid,
  adminReviewPendingCount,
  finalConfirmedTotal,
  openEstimatePreview,
  submitCompletion,
} = useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !completeReview.isPending.value) completionOpen.value = false;
};
const onSendEmail = (value: boolean | 'indeterminate'): void => {
  completionSendEmail.value = value === true;
};
const onWithoutPrice = (value: boolean | 'indeterminate'): void => {
  completionWithoutPriceConfirmed.value = value === true;
};
</script>

<template>
  <Dialog :open="completionOpen && detail !== null" @update:open="onOpenChange">
    <DialogContent v-if="detail !== null" class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>고객 회신 확정</DialogTitle>
        <DialogDescription>검토 결과와 고객에게 전달할 내용을 마지막으로 확인해 주세요.</DialogDescription>
      </DialogHeader>

      <DialogScrollBody class="flex flex-col gap-3">
        <Panel tone="muted">
          <dl class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt class="text-muted-foreground">품목 확인</dt>
              <dd class="mt-1 text-sm font-semibold">
                {{ adminReviewPendingCount === 0 ? '모두 완료' : `${String(adminReviewPendingCount)}건 남음` }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">확정 총액(VAT 별도)</dt>
              <dd class="mt-1 text-sm font-semibold tabular-nums" :class="finalConfirmedTotal === null ? 'text-warning' : ''">
                {{ finalConfirmedTotal === null ? '미등록' : smartbomFmtWon(finalConfirmedTotal) }}
              </dd>
            </div>
          </dl>
        </Panel>

        <Alert v-if="detail.uncostedCount > 0" variant="warning" size="sm">
          <TriangleAlertIcon />
          <AlertDescription>
            금액 미산정 품목 {{ detail.uncostedCount }}건은 확정 견적과 고객 주문 금액에 포함되지 않습니다. 회신 메모에도 조달
            범위를 안내해 주세요.
          </AlertDescription>
        </Alert>

        <Panel tone="info" class="flex items-center justify-between gap-3">
          <p class="text-xs">고객에게 보일 견적서를 가안 상태로 먼저 확인할 수 있습니다.</p>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="patch.isPending.value || completeReview.isPending.value"
            @click="void openEstimatePreview()"
          >
            <FileTextIcon />
            견적서 미리보기
          </Button>
        </Panel>

        <Panel class="flex flex-col gap-3">
          <FieldLabel for="bom-completion-send-email">
            <Field orientation="horizontal">
              <Checkbox id="bom-completion-send-email" :model-value="completionSendEmail" @update:model-value="onSendEmail" />
              <FieldContent>
                <FieldTitle>고객에게 견적 회신 이메일 보내기</FieldTitle>
                <FieldDescription>기본 선택이며 아래 주소로 발송합니다.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <Field :data-invalid="!completionEmailValid || undefined">
            <FieldLabel for="bom-completion-email">받는 이메일</FieldLabel>
            <Input
              id="bom-completion-email"
              v-model="completionEmail"
              type="email"
              inputmode="email"
              autocomplete="off"
              placeholder="customer@example.com"
              :aria-invalid="!completionEmailValid || undefined"
              :disabled="!completionSendEmail || completeReview.isPending.value"
            />
            <FieldDescription>
              고객 회원정보의 이메일을 기본값으로 채웁니다. 수정한 주소는 이번 발송에만 사용하며 회원정보는 변경하지 않습니다.
            </FieldDescription>
            <FieldError v-if="!completionEmailValid">올바른 받는 이메일 주소를 입력해 주세요.</FieldError>
          </Field>
        </Panel>

        <FieldLabel v-if="finalConfirmedTotal === null" for="bom-completion-without-price">
          <Field orientation="horizontal">
            <Checkbox
              id="bom-completion-without-price"
              :model-value="completionWithoutPriceConfirmed"
              @update:model-value="onWithoutPrice"
            />
            <FieldContent>
              <FieldTitle>
                <span class="text-warning">
                  확정 총액 없이 고객 회신을 확정하면 주문하기와 확정 견적서 인쇄를 사용할 수 없음을 확인했습니다.
                </span>
              </FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>

        <Alert v-if="completionError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ completionError }}</AlertDescription>
        </Alert>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" :disabled="completeReview.isPending.value" @click="completionOpen = false">취소</Button>
        <Button
          :disabled="
            patch.isPending.value ||
              completeReview.isPending.value ||
              !completionEmailValid ||
              adminReviewPendingCount > 0 ||
              (finalConfirmedTotal === null && !completionWithoutPriceConfirmed)
          "
          @click="void submitCompletion()"
        >
          <Spinner v-if="completeReview.isPending.value" />
          {{ completeReview.isPending.value ? '회신 확정 중…' : '고객 회신 확정' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
