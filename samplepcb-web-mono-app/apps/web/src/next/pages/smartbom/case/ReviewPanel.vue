<script setup lang="ts">
import { CheckCheckIcon, EllipsisIcon, FileTextIcon, MailIcon, SaveIcon, TriangleAlertIcon } from '@lucide/vue';
import { smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/next/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';
import { EMAIL_FEEDBACK_VARIANT } from '@/next/components/smartbom/smartbom-badges';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 검토·고객 회신 — 비용(예상 자동값 읽기 전용) · 확정가(체크박스 없이 바로 입력 — 2026-10-06 사용자 결정,
// docs/SMARTBOM_PARTNER_RFQ.md §6) · 회신 메모 · 내부 메모 · 저장/미리보기/회신 확정/재발송/마감.
// 확정가 = 고객 주문 게이트(D16-1). 검토 중 미등록이면 예상값을 제안으로 채우고, 비어 있으면 경고를 상시 보인다.
const {
  detail,
  reviewEditable,
  form,
  patch,
  completeReview,
  sendAnswerEmail,
  actionError,
  emailActionFeedback,
  fillConfirmedFromExpected,
  clearConfirmed,
  setConfirmedField,
  finalConfirmedTotal,
  confirmedIsSuggestion,
  confirmedTotalDiff,
  withVat,
  confirmedTotalVat,
  saveReview,
  openEstimatePreview,
  openCompletion,
  openResendEmail,
  openQuoteClosing,
  adminReviewPendingCount,
} = useSmartbomCaseContext();
</script>

<template>
  <SectionCard v-if="detail !== null" title="검토·고객 회신">
    <!-- 비용 — 예상(자동: 부품 합계 + 설정 기본 운송료·관리비) 읽기 전용 표시. -->
    <Panel tone="muted" class="flex flex-col gap-1 text-sm">
      <Panel
        size="xs"
        tone="info"
        class="mb-1"
        title="세트당 BOM 수량에 제작·예비 세트 수를 합산 적용한 뒤 MOQ와 주문배수를 반영해 주문수량을 계산합니다."
      >
        <p class="text-xs font-medium">수량 기준</p>
        <p class="text-foreground flex flex-wrap items-baseline gap-x-1 tabular-nums">
          <span>제작 <b>{{ detail.setQty.toLocaleString('ko-KR') }}세트</b></span>
          <span class="text-muted-foreground">+</span>
          <span>예비 <b>{{ detail.spareQty.toLocaleString('ko-KR') }}세트</b></span>
          <span class="text-muted-foreground">=</span>
          <strong class="text-info">적용 {{ (detail.setQty + detail.spareQty).toLocaleString('ko-KR') }}세트</strong>
        </p>
        <p class="text-xs">주문수량·부품 합계 산정 기준</p>
      </Panel>
      <div class="flex justify-between">
        <span class="text-muted-foreground">부품 합계(선정 반영)</span>
        <b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b>
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">운송료(설정 기본값)</span>
        <span class="tabular-nums">{{ smartbomFmtWon(detail.shippingFee) }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted-foreground">관리비(설정 기본값)</span>
        <span class="tabular-nums">{{ smartbomFmtWon(detail.managementFee) }}</span>
      </div>
      <div class="flex justify-between border-t pt-1">
        <span class="text-muted-foreground">예상 총액(VAT 별도)</span>
        <b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b>
      </div>
      <div class="text-muted-foreground flex justify-between text-xs">
        <span>참고: VAT 포함 시</span>
        <span class="tabular-nums">{{ withVat(detail.finalTotal) }}</span>
      </div>
    </Panel>

    <!-- 확정가 — 체크박스 없이 바로 입력 -->
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-semibold">
        확정가 <span class="text-warning text-xs font-medium">— 등록 시 고객 주문 가능</span>
      </p>
      <div v-if="reviewEditable" class="flex shrink-0 gap-1">
        <Button
          variant="outline"
          size="xs"
          title="운송료·관리비 기본값과 선정 반영 예상 총액으로 채웁니다"
          @click="fillConfirmedFromExpected"
        >
          예상값으로
        </Button>
        <Button
          variant="ghost"
          size="xs"
          title="확정가 없이 회신하려면 비우고 저장하세요 — 고객은 예상 금액만 보고 주문할 수 없습니다"
          @click="clearConfirmed"
        >
          비우기
        </Button>
      </div>
    </div>
    <Alert v-if="finalConfirmedTotal === null" variant="warning" size="sm">
      <TriangleAlertIcon />
      <AlertTitle>확정가 없음 — 고객은 예상 금액만 볼 수 있고 주문(결제)할 수 없습니다.</AlertTitle>
      <AlertDescription>확정 총액을 입력하거나 [예상값으로]를 누른 뒤 저장하세요.</AlertDescription>
    </Alert>
    <Alert v-else-if="confirmedIsSuggestion" variant="info" size="sm">
      <AlertDescription>예상값을 확정가 제안으로 채웠습니다 — 저장하거나 고객 회신을 확정하면 이 금액으로 등록됩니다.</AlertDescription>
    </Alert>
    <div class="grid grid-cols-2 gap-2">
      <Field>
        <FieldLabel for="bom-confirmed-shipping">확정 운송료</FieldLabel>
        <Input
          id="bom-confirmed-shipping"
          type="number"
          min="0"
          inputmode="numeric"
          :model-value="form.confirmedShippingFee ?? ''"
          :disabled="!reviewEditable"
          @update:model-value="setConfirmedField('confirmedShippingFee', $event)"
        />
      </Field>
      <Field>
        <FieldLabel for="bom-confirmed-management">확정 관리비</FieldLabel>
        <Input
          id="bom-confirmed-management"
          type="number"
          min="0"
          inputmode="numeric"
          :model-value="form.confirmedManagementFee ?? ''"
          :disabled="!reviewEditable"
          @update:model-value="setConfirmedField('confirmedManagementFee', $event)"
        />
      </Field>
    </div>
    <Field>
      <FieldLabel for="bom-confirmed-total">확정 총액(VAT 별도)</FieldLabel>
      <Input
        id="bom-confirmed-total"
        type="number"
        min="0"
        inputmode="numeric"
        :model-value="form.confirmedTotal ?? ''"
        :disabled="!reviewEditable"
        @update:model-value="setConfirmedField('confirmedTotal', $event)"
      />
    </Field>
    <p v-if="reviewEditable && confirmedTotalDiff !== null" class="text-warning text-xs font-medium">
      지금 예상 총액({{ smartbomFmtWon(detail.finalTotal) }})과
      {{ confirmedTotalDiff > 0 ? '+' : '−' }}{{ smartbomFmtWon(Math.abs(confirmedTotalDiff)) }} 차이 — 품목 선정이
      바뀌었으면 [예상값으로]로 맞추세요.
    </p>
    <p class="text-muted-foreground text-xs">
      참고: VAT 포함 시 {{ confirmedTotalVat }} — 부가세는 저장하지 않습니다(전 금액 VAT 별도). 검토 중 저장값은
      관리자 초안이며, 고객 회신 확정 후 공개되고 [주문하기]가 열립니다.
    </p>

    <Field>
      <FieldLabel for="bom-answer-note">고객 회신 메모(고객에게 표시)</FieldLabel>
      <Textarea id="bom-answer-note" v-model="form.answerNote" rows="3" :disabled="!reviewEditable" />
    </Field>
    <Field>
      <FieldLabel for="bom-admin-memo">내부 메모(고객 미노출)</FieldLabel>
      <Textarea id="bom-admin-memo" v-model="form.adminMemo" rows="2" :disabled="!reviewEditable" />
    </Field>

    <div class="flex flex-wrap items-center gap-2 border-t pt-3">
      <Button v-if="reviewEditable" variant="outline" size="sm" :disabled="patch.isPending.value" @click="void saveReview()">
        <SaveIcon />
        저장
      </Button>
      <Button
        v-if="detail.status === 'reviewing'"
        variant="outline"
        size="sm"
        :disabled="patch.isPending.value"
        @click="void openEstimatePreview()"
      >
        <FileTextIcon />
        견적서 미리보기
      </Button>
      <span
        v-if="detail.status === 'reviewing' && adminReviewPendingCount > 0"
        class="text-warning text-xs font-medium"
        role="status"
      >
        확인 필요 {{ adminReviewPendingCount }}건
      </span>
      <Button
        v-if="detail.status === 'reviewing'"
        size="sm"
        :disabled="patch.isPending.value || completeReview.isPending.value || adminReviewPendingCount > 0"
        :title="adminReviewPendingCount > 0 ? `관리자 확인이 끝나지 않은 품목이 ${String(adminReviewPendingCount)}개 있습니다` : ''"
        @click="openCompletion"
      >
        <CheckCheckIcon />
        고객 회신 확정
      </Button>
      <Button
        v-if="detail.status === 'answered' || detail.status === 'closed'"
        variant="outline"
        size="sm"
        :disabled="sendAnswerEmail.isPending.value"
        @click="openResendEmail"
      >
        <MailIcon />
        회신 이메일 다시 보내기
      </Button>
      <DropdownMenu v-if="detail.status === 'answered'">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="ml-auto">
            <EllipsisIcon />
            추가 작업
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-60">
          <DropdownMenuItem :disabled="patch.isPending.value" @select="openQuoteClosing">
            <div class="flex flex-col">
              <span class="font-medium">견적 마감</span>
              <span class="text-muted-foreground text-xs">더 진행하지 않는 견적의 신규 주문을 닫습니다.</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Alert v-if="!reviewEditable" variant="muted" size="sm">
      <AlertDescription>
        현재 견적 상태에서는 금액과 회신 내용을 변경할 수 없습니다.
        <template v-if="detail.status === 'answered' || detail.status === 'closed'"> 이메일은 확정된 내용으로 다시 보낼 수 있습니다.</template>
      </AlertDescription>
    </Alert>
    <Alert v-if="actionError !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>
    <Alert v-if="emailActionFeedback !== null" :variant="EMAIL_FEEDBACK_VARIANT[emailActionFeedback.tone]" size="sm">
      <AlertDescription>{{ emailActionFeedback.text }}</AlertDescription>
    </Alert>
  </SectionCard>
</template>
