import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  AdminBomQuoteRecipientEmail,
  type AdminBomQuoteEmailDeliveryType,
  type BomQuoteStatusType,
} from '@sp/api-contract';
import {
  useCompleteAdminBomQuote,
  usePatchAdminBomQuote,
  useSendAdminBomQuoteAnswerEmail,
} from '@/admin/useAdminBomQuotes';
import type { CaseCore } from './case-core';
import type { CaseItems } from './case-items';
import type { CaseRfq } from './case-rfq';
import type { EmailFeedbackTone } from '@/next/components/smartbom/smartbom-badges';

// 검토·고객 회신 — 검토 폼(확정가·회신 메모·내부 메모), 검토 시작·저장, 견적서 미리보기, 고객 회신 확정,
// 회신 이메일 재발송, 견적 마감. 옛 화면 스크립트의 같은 부분 그대로(의미 변경 없음).

export type ConfirmedField = 'confirmedShippingFee' | 'confirmedManagementFee' | 'confirmedTotal';

export function useCaseReview(core: CaseCore, rfq: CaseRfq, items: CaseItems) {
  const { detailId, detail, detailQuery, rfqQuery, reviewEditable, estimateOpen } = core;
  const { rfqLinkNotice, rfqLinkError, startSupplierRefresh } = rfq;
  const { adminReviewPendingCount, adminItemFilter } = items;

  const patch = usePatchAdminBomQuote();
  const completeReview = useCompleteAdminBomQuote();
  const sendAnswerEmail = useSendAdminBomQuoteAnswerEmail();

  // 검토 폼(상세 로드 시 프리필) — BOM 견적요청 화면과 동일 로직.
  const form = ref({
    adminMemo: '',
    answerNote: '',
    confirmedShippingFee: null as number | null,
    confirmedManagementFee: null as number | null,
    confirmedTotal: null as number | null,
  });
  const actionError = ref('');
  const completionOpen = ref(false);
  const completionSendEmail = ref(true);
  const completionEmail = ref('');
  const completionWithoutPriceConfirmed = ref(false);
  const completionError = ref('');
  const resendEmailOpen = ref(false);
  const resendEmail = ref('');
  const resendEmailError = ref('');
  const quoteClosingOpen = ref(false);
  const quoteClosingError = ref('');
  const emailActionFeedback = ref<{ tone: EmailFeedbackTone; text: string } | null>(null);

  watch(detailId, () => {
    completionOpen.value = false;
    resendEmailOpen.value = false;
    quoteClosingOpen.value = false;
    emailActionFeedback.value = null;
  });

  // 확정가 = 체크박스 없이 바로 입력(2026-10-06 사용자 결정 — 옛 '확정가 등록' 토글을 걷었다,
  // 정본 docs/SMARTBOM_PARTNER_RFQ.md §6). 검토 중이고 저장된 확정가가 없으면 예상값(운송료·관리비 기본값
  // + 선정 반영 총액)을 제안으로 채운다 — 저장하거나 고객 회신을 확정해야 등록된다. 관리자가 고치지 않은
  // 동안은 상세가 다시 불릴 때마다 예상값을 따라가고(품목 선정이 바뀌면 총액도 따라감), 고친 뒤에는 고정한 채
  // 예상 총액과의 차이를 보인다. 확정가 없이 회신하려면 [비우기] — 회신 확정 대화상자가 한 번 더 확인한다.
  const confirmedEdited = ref(false);

  const validRecipientEmail = (value: string): string | null => {
    const parsed = AdminBomQuoteRecipientEmail.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const completionEmailValid = computed(
    () => !completionSendEmail.value || validRecipientEmail(completionEmail.value) !== null,
  );
  const resendEmailValid = computed(() => validRecipientEmail(resendEmail.value) !== null);

  watch(detail, (d) => {
    if (d === null) return;
    const saved = d.confirmedShippingFee !== null || d.confirmedManagementFee !== null || d.confirmedTotal !== null;
    // 저장된 확정가가 없는 검토 중 건만 제안으로 채운다 — 회신된 건의 '확정가 없음'은 사실이라 그대로 둔다.
    const suggest = !saved && (d.status === 'requested' || d.status === 'reviewing');
    form.value = {
      adminMemo: d.adminMemo ?? '',
      answerNote: d.answerNote ?? '',
      confirmedShippingFee: suggest ? d.shippingFee : d.confirmedShippingFee,
      confirmedManagementFee: suggest ? d.managementFee : d.confirmedManagementFee,
      confirmedTotal: suggest ? d.finalTotal : d.confirmedTotal,
    };
    // 저장값이 예상값과 같으면 '고치지 않은' 것으로 본다 — 예상값을 계속 따라간다.
    confirmedEdited.value =
      saved &&
      (d.confirmedShippingFee !== d.shippingFee ||
        d.confirmedManagementFee !== d.managementFee ||
        d.confirmedTotal !== d.finalTotal);
    actionError.value = '';
  });

  function fillConfirmedFromExpected(): void {
    const d = detail.value;
    if (!reviewEditable.value || d === null) return;
    form.value.confirmedShippingFee = d.shippingFee;
    form.value.confirmedManagementFee = d.managementFee;
    form.value.confirmedTotal = d.finalTotal;
    confirmedEdited.value = false;
  }
  function clearConfirmed(): void {
    if (!reviewEditable.value) return;
    form.value.confirmedShippingFee = null;
    form.value.confirmedManagementFee = null;
    form.value.confirmedTotal = null;
    confirmedEdited.value = true;
  }
  /** 관리자가 칸을 직접 고쳤다 — 이후로는 예상값을 따라가지 않는다(옛 @input 과 같은 시점). */
  function setConfirmedField(field: ConfirmedField, value: string | number): void {
    const text = String(value).trim();
    const parsed = Number(text);
    form.value[field] = text === '' || !Number.isFinite(parsed) ? null : parsed;
    confirmedEdited.value = true;
  }

  // 빈 입력·소수는 저장 직전 정규화한다(옛 v-model.number 와 같은 규칙).
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  const finalConfirmedTotal = computed(() => numOrNull(form.value.confirmedTotal));
  // 저장 전 제안(예상값으로 채운 상태) — 저장·회신 확정 때 등록된다는 사실을 칸 위에 밝힌다.
  const confirmedIsSuggestion = computed(
    () => detail.value?.confirmedTotal === null && finalConfirmedTotal.value !== null && !confirmedEdited.value,
  );
  // 고친 확정 총액과 지금 예상 총액의 차이 — 품목 선정이 바뀐 뒤 옛 확정가가 남는 것을 알린다.
  const confirmedTotalDiff = computed(() => {
    const expected = detail.value?.finalTotal ?? null;
    const total = finalConfirmedTotal.value;
    return total === null || expected === null || total === expected ? null : total - expected;
  });

  // 부가세는 저장·계산하지 않는 정책(전 금액 VAT 별도) — 참고 환산 표시만 한다.
  const withVat = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 1.1).toLocaleString('ko-KR')}원`);
  const confirmedTotalVat = computed(() => withVat(numOrNull(form.value.confirmedTotal)));

  function reviewFields() {
    return {
      adminMemo: form.value.adminMemo === '' ? null : form.value.adminMemo,
      answerNote: form.value.answerNote === '' ? null : form.value.answerNote,
      // 빈 칸 = 확정 해제(null). 검토 중에는 관리자 초안으로만 저장한다(고객 공개는 회신 확정 때).
      confirmedShippingFee: numOrNull(form.value.confirmedShippingFee),
      confirmedManagementFee: numOrNull(form.value.confirmedManagementFee),
      confirmedTotal: finalConfirmedTotal.value,
    };
  }

  async function saveReview(nextStatus?: BomQuoteStatusType): Promise<void> {
    const quoteId = detailId.value;
    const current = detail.value;
    if (quoteId === null) return;
    const startsSingleSearchReview =
      nextStatus === 'reviewing' && current?.status === 'requested' && current.sourceKind === 'single_search';
    actionError.value = '';
    try {
      await patch.mutateAsync({
        quoteId,
        body: { ...(nextStatus !== undefined ? { status: nextStatus } : {}), ...reviewFields() },
      });
      if (!startsSingleSearchReview) return;
      rfqLinkNotice.value = '';
      rfqLinkError.value = '';
      try {
        const response = await startSupplierRefresh.mutateAsync({ quoteId });
        rfqLinkNotice.value = response.data.message;
        await Promise.all([detailQuery.refetch(), rfqQuery.refetch()]);
      } catch (error) {
        rfqLinkError.value =
          error instanceof ApiRequestError
            ? `검토는 시작됐지만 공급사 시세 확인을 시작하지 못했습니다: ${error.message}`
            : '검토는 시작됐지만 공급사 시세 확인을 시작하지 못했습니다.';
        await Promise.all([detailQuery.refetch(), rfqQuery.refetch()]);
      }
    } catch (error) {
      actionError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '저장에 실패했습니다 — 상태 전이 가능 여부를 확인하세요.';
    }
  }

  function emailFeedback(
    delivery: AdminBomQuoteEmailDeliveryType,
    action: 'complete' | 'resend' = 'complete',
  ): { tone: EmailFeedbackTone; text: string } {
    if (delivery.status === 'sent') {
      return {
        tone: 'success',
        text:
          action === 'resend'
            ? `${delivery.toEmail ?? '고객 이메일'}로 회신 이메일을 다시 발송했습니다.`
            : `고객 회신을 확정하고 ${delivery.toEmail ?? '고객 이메일'}로 이메일을 발송했습니다.`,
      };
    }
    if (delivery.reason === 'disabled') {
      return { tone: 'warning', text: '고객 회신을 확정했습니다. 이메일은 관리자 선택으로 발송하지 않았습니다.' };
    }
    if (delivery.reason === 'missing_recipient') {
      return { tone: 'warning', text: '고객 회신은 확정됐지만 회원정보에 이메일이 없어 발송하지 못했습니다.' };
    }
    if (delivery.reason === 'mail_unavailable') {
      return { tone: 'warning', text: '고객 회신은 확정됐지만 현재 이메일 발송 기능이 비활성화되어 있습니다.' };
    }
    return { tone: 'error', text: '고객 회신은 확정됐지만 이메일 발송에 실패했습니다. 다시 보내기를 이용해 주세요.' };
  }

  /** 미리보기에는 현재 입력값이 보여야 하므로 회신 전 상태에서는 관리자 초안을 먼저 저장한다. */
  async function openEstimatePreview(): Promise<void> {
    const quote = detail.value;
    if (detailId.value === null || quote === null) return;
    if (quote.status === 'requested' || quote.status === 'reviewing') {
      actionError.value = '';
      completionError.value = '';
      try {
        await patch.mutateAsync({ quoteId: detailId.value, body: reviewFields() });
      } catch (error) {
        const message =
          error instanceof ApiRequestError
            ? (error.payload?.message ?? error.message)
            : '현재 입력값을 저장하지 못해 견적서를 열 수 없습니다.';
        if (completionOpen.value) completionError.value = message;
        else actionError.value = message;
        return;
      }
    }
    estimateOpen.value = true;
  }

  function openCompletion(): void {
    if (detail.value?.status !== 'reviewing') {
      actionError.value = '먼저 검토 시작을 진행해 주세요.';
      return;
    }
    if (adminReviewPendingCount.value > 0) {
      actionError.value = `관리자 확인이 끝나지 않은 품목이 ${String(adminReviewPendingCount.value)}개 있습니다.`;
      adminItemFilter.value = 'attention';
      return;
    }
    completionSendEmail.value = true;
    completionEmail.value = detail.value.customerEmail ?? '';
    completionWithoutPriceConfirmed.value = false;
    completionError.value = '';
    completionOpen.value = true;
  }

  async function submitCompletion(): Promise<void> {
    if (detailId.value === null) return;
    const toEmail = validRecipientEmail(completionEmail.value);
    if (completionSendEmail.value && toEmail === null) {
      completionError.value = '올바른 받는 이메일 주소를 입력해 주세요.';
      return;
    }
    if (finalConfirmedTotal.value === null && !completionWithoutPriceConfirmed.value) {
      completionError.value = '확정 총액 없이 회신하려면 주의사항을 확인해 주세요.';
      return;
    }
    completionError.value = '';
    actionError.value = '';
    try {
      const response = await completeReview.mutateAsync({
        quoteId: detailId.value,
        body: {
          ...reviewFields(),
          sendEmail: completionSendEmail.value,
          ...(completionSendEmail.value && toEmail !== null ? { toEmail } : {}),
        },
      });
      completionOpen.value = false;
      emailActionFeedback.value = emailFeedback(response.email);
    } catch (error) {
      completionError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '고객 회신 확정에 실패했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.';
    }
  }

  function openResendEmail(): void {
    resendEmail.value = detail.value?.customerEmail ?? '';
    resendEmailError.value = '';
    resendEmailOpen.value = true;
  }

  async function resendAnswerEmail(): Promise<void> {
    if (detailId.value === null) return;
    const toEmail = validRecipientEmail(resendEmail.value);
    if (toEmail === null) {
      resendEmailError.value = '올바른 받는 이메일 주소를 입력해 주세요.';
      return;
    }
    resendEmailError.value = '';
    try {
      const response = await sendAnswerEmail.mutateAsync({ quoteId: detailId.value, body: { toEmail } });
      resendEmailOpen.value = false;
      emailActionFeedback.value = emailFeedback(response.data, 'resend');
    } catch (error) {
      resendEmailError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '회신 이메일을 다시 보내지 못했습니다.';
    }
  }

  function openQuoteClosing(): void {
    if (detail.value?.status !== 'answered') {
      actionError.value = '고객 회신이 확정된 견적만 마감할 수 있습니다.';
      return;
    }
    quoteClosingError.value = '';
    quoteClosingOpen.value = true;
  }

  async function submitQuoteClosing(): Promise<void> {
    if (detailId.value === null || detail.value?.status !== 'answered') {
      quoteClosingError.value = '견적 상태가 변경되었습니다. 최신 상태를 확인해 주세요.';
      return;
    }
    quoteClosingError.value = '';
    try {
      await patch.mutateAsync({ quoteId: detailId.value, body: { status: 'closed' } });
      quoteClosingOpen.value = false;
    } catch (error) {
      quoteClosingError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '견적을 마감하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.';
    }
  }

  return {
    patch,
    completeReview,
    sendAnswerEmail,
    form,
    actionError,
    completionOpen,
    completionSendEmail,
    completionEmail,
    completionWithoutPriceConfirmed,
    completionError,
    completionEmailValid,
    resendEmailOpen,
    resendEmail,
    resendEmailError,
    resendEmailValid,
    quoteClosingOpen,
    quoteClosingError,
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
    submitCompletion,
    openResendEmail,
    resendAnswerEmail,
    openQuoteClosing,
    submitQuoteClosing,
  };
}

export type CaseReview = ReturnType<typeof useCaseReview>;
