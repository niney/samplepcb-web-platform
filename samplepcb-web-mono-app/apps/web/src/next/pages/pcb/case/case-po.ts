import { computed, nextTick, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PAYMENT_TERM_CUSTOM_DATE,
  PCB_PAYMENT_TERM_NET_7,
  isPcbDeliveryOverdue,
  lastPcbEqRejectedAt,
  lastPcbEqRejection,
  lastPcbStencilInquiry,
  pcbEqForwardLabel,
  pcbEqRejectActionLabel,
  type AdminPcbPoViewType,
  type PcbEqFileTypeType,
  type PcbEqRejection,
} from '@sp/api-contract';
import { fmtKstDate, kstDateInput, kstDateOnly, kstToday } from '@sp/utils';
import {
  useAdminPcbEqSubstitute,
  useAdminRevertPcbEq,
  useApprovePcbEq,
  useCreatePcbPo,
  useDeleteAdminPcbEqFile,
  useDeletePcbPo,
  usePatchPcbPo,
  useRejectPcbEq,
  useUploadAdminPcbEqFile,
  type AdminPcbEqSubstituteAction,
} from '@/admin/useAdminPcbPos';
import { pcbEqReviewState, pcbEqReviewTitle, type PcbEqReviewDisplay } from '@/lib/pcb-eq-review';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import { addDateOnlyDays, type CaseCore } from './case-core';
import type { CaseRfq } from './case-rfq';

// PCB Case 상세 — 발주서·EQ 패널의 조작. 발행은 결제(paid) 후(게이트는 서버), 프리필은 선정 견적행.
// EQ 승인/반려(스텐실: 확인/보완)는 관리자 몫이고, 협력사 몫 전이는 대행(D11)으로 열어 둔다.

const SUBSTITUTE_LABELS: Record<AdminPcbEqSubstituteAction, string> = {
  'eq-request': 'EQ 요청 대행',
  'production-start': '생산 시작 대행',
  'production-complete': '생산 완료 대행',
};

export const substituteActionOf = (status: string): AdminPcbEqSubstituteAction | null =>
  status === 'issued'
    ? 'eq-request'
    : status === 'eq_done'
      ? 'production-start'
      : status === 'producing'
        ? 'production-complete'
        : null;

/** 대행 버튼 문구 — 갈리는 건 제출 대행 하나다(스텐실엔 'EQ 요청'이라는 단계가 없다). */
export const substituteLabelOf = (po: AdminPcbPoViewType, action: AdminPcbEqSubstituteAction): string =>
  action === 'eq-request' && po.track === 'stencil' ? '확인 요청 대행' : SUBSTITUTE_LABELS[action];

export function useCasePo(core: CaseCore, rfq: CaseRfq) {
  const {
    specId,
    detail,
    detailQuery,
    adminRows,
    allPos,
    latestRoundRfqs,
    selectedPoRfq,
    rfqsQuery,
    rfqGate,
    poSelectionGuide,
    expandSection,
    rfqSectionEl,
    actionError,
    surfaceError,
  } = core;

  // ── 발주서 발행 ────────────────────────────────────────────────────────────
  const poModalOpen = ref(false);
  const poPartnerId = ref<number | null>(null);
  const poPrice = ref('');
  const poRate = ref('');
  const poTerms = ref('');
  const poRemittanceDue = ref('');
  const poDelivery = ref('');
  const poMemo = ref('');
  const createPo = useCreatePcbPo();
  const poIsNet7 = computed(() => poTerms.value.trim() === PCB_PAYMENT_TERM_NET_7);
  const poIsCustomPaymentDate = computed(() => poTerms.value.trim() === PCB_PAYMENT_TERM_CUSTOM_DATE);
  const poRemittanceDuePreview = computed(() => (poIsNet7.value ? addDateOnlyDays(kstToday(), 7) : poRemittanceDue.value));
  const poTargetRfq = computed(() => (selectedPoRfq.value?.partnerId === poPartnerId.value ? selectedPoRfq.value : null));
  const poCanSubmit = computed(
    () =>
      !createPo.isPending.value &&
      poPartnerId.value !== null &&
      poTargetRfq.value !== null &&
      (!poIsCustomPaymentDate.value || poRemittanceDue.value !== ''),
  );
  const poCurrencyOf = (partnerId: number | null): string =>
    adminRows.value.find((r) => r.partnerId === partnerId)?.currency ??
    rfq.assignCandidates.value.find((p) => p.partnerId === partnerId)?.defaultCurrency ??
    'KRW';
  const poSelectionGuideMessage = computed(() => {
    if (latestRoundRfqs.value.some((row) => row.status === 'quoted')) {
      return '발주 전에 협력사를 선정해 주세요. 아래 회신 완료 행의 [선정]을 눌러 주세요.';
    }
    if (latestRoundRfqs.value.length === 0) {
      return '먼저 협력사 견적요청을 보내고, 회신이 오면 협력사를 선정해 주세요.';
    }
    return '아직 선정 가능한 회신이 없습니다. 회신을 기다리거나 [대리 회신]을 등록한 뒤 선정해 주세요.';
  });

  function guidePoSelection(message = poSelectionGuideMessage.value): void {
    poModalOpen.value = false;
    poSelectionGuide.value = message;
    expandSection('rfq');
    void nextTick(() => {
      const section = rfqSectionEl.value;
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const selectButton = section?.querySelector<HTMLButtonElement>('[data-pcb-rfq-select]');
      const nextAction = section?.querySelector<HTMLButtonElement>('[data-pcb-rfq-reply], [data-pcb-rfq-assign]');
      (selectButton ?? nextAction ?? section)?.focus({ preventScroll: true });
    });
  }

  async function openPoModal(): Promise<void> {
    if (rfqGate.value === 'closed') return;
    let selected = selectedPoRfq.value;
    // 진입 직후 RFQ 조회보다 발주 버튼이 먼저 보일 수 있다 — 빈 캐시로 "미배정" 안내를 만들면 곧
    // 회신 행이 떠도 잘못된 안내·포커스가 남는다. 미선정 경로만 한 번 동기화한 뒤 판정한다.
    if (selected === null) {
      await rfqsQuery.refetch();
      selected = selectedPoRfq.value;
    }
    if (selected === null) {
      guidePoSelection();
      return;
    }
    poSelectionGuide.value = '';
    poPartnerId.value = selected.partnerId;
    poPrice.value = '';
    poRate.value = '';
    poTerms.value = '';
    poRemittanceDue.value = '';
    poDelivery.value = kstDateInput(selected.quotedDeliveryDate);
    poMemo.value = '';
    poModalOpen.value = true;
  }
  async function submitPo(): Promise<void> {
    if (specId.value === null) return;
    if (poPartnerId.value === null || poTargetRfq.value === null) {
      guidePoSelection();
      return;
    }
    if (poIsCustomPaymentDate.value && poRemittanceDue.value === '') return;
    actionError.value = '';
    const priceRaw = poPrice.value.replaceAll(',', '').trim();
    const rateRaw = poRate.value.replaceAll(',', '').trim();
    try {
      await createPo.mutateAsync({
        specId: specId.value,
        body: {
          partnerId: poPartnerId.value,
          rfqId: poTargetRfq.value.rfqId,
          ...(priceRaw === '' ? {} : { priceOriginal: Number(priceRaw) }),
          ...(rateRaw === '' ? {} : { exchangeRate: Number(rateRaw) }),
          paymentTerms: poTerms.value.trim() === '' ? null : poTerms.value.trim(),
          remittanceDueOn: poIsCustomPaymentDate.value ? poRemittanceDue.value : null,
          deliveryDate: poDelivery.value === '' ? null : poDelivery.value,
          memo: poMemo.value.trim() === '' ? null : poMemo.value.trim(),
        },
      });
      poModalOpen.value = false;
    } catch (e) {
      if (e instanceof ApiRequestError && e.payload?.error === 'RFQ_NOT_SELECTED') {
        await rfqsQuery.refetch();
        guidePoSelection('선정 상태가 변경되었습니다. 협력사를 다시 선정한 뒤 발주해 주세요.');
        return;
      }
      surfaceError(e, '발주서 발행에 실패했습니다.');
    }
  }

  const approveEq = useApprovePcbEq();
  const rejectEq = useRejectPcbEq();
  const revertEqAdmin = useAdminRevertPcbEq();
  const deletePoMut = useDeletePcbPo();

  // ── 발주 조건 수정 — 발행 뒤에도 결제조건·납기·메모를 고친다. 금액·환율은 서버가 issued 상태로만
  //    허용하는 별도 규칙이라 다루지 않고, 송금은 원장([송금] 패널)이 정본이라 여기 없다. ────────
  const patchPo = usePatchPcbPo();
  const editPo = ref<AdminPcbPoViewType | null>(null);
  const editTerms = ref('');
  const editRemittanceDue = ref('');
  const editDelivery = ref('');
  const editMemo = ref('');
  const editIsNet7 = computed(() => editTerms.value.trim() === PCB_PAYMENT_TERM_NET_7);
  const editIsCustomPaymentDate = computed(() => editTerms.value.trim() === PCB_PAYMENT_TERM_CUSTOM_DATE);
  const editRemittanceDuePreview = computed(() => {
    if (!editIsNet7.value) return editRemittanceDue.value;
    const issuedOn = kstDateOnly(editPo.value?.issuedAt) ?? kstToday();
    return addDateOnlyDays(issuedOn, 7);
  });
  const editCanSubmit = computed(
    () => !patchPo.isPending.value && (!editIsCustomPaymentDate.value || editRemittanceDue.value !== ''),
  );
  function openPoEdit(po: AdminPcbPoViewType): void {
    editPo.value = po;
    editTerms.value = po.paymentTerms ?? '';
    editRemittanceDue.value = kstDateInput(po.remittanceDueOn);
    editDelivery.value = kstDateInput(po.deliveryDate);
    editMemo.value = po.memo ?? '';
  }
  async function submitPoEdit(): Promise<void> {
    const target = editPo.value;
    if (specId.value === null || target === null) return;
    if (editIsCustomPaymentDate.value && editRemittanceDue.value === '') return;
    actionError.value = '';
    try {
      await patchPo.mutateAsync({
        specId: specId.value,
        poId: target.poId,
        body: {
          paymentTerms: editTerms.value.trim() === '' ? null : editTerms.value.trim(),
          remittanceDueOn: editIsCustomPaymentDate.value ? editRemittanceDue.value : null,
          deliveryDate: editDelivery.value === '' ? null : editDelivery.value,
          memo: editMemo.value.trim() === '' ? null : editMemo.value.trim(),
        },
      });
      editPo.value = null;
    } catch (e) {
      surfaceError(e, '발주 조건 수정에 실패했습니다.');
    }
  }

  /** 송금 원장 패널 — 워크큐(송금 메뉴)와 같은 컴포넌트. */
  const remittancePoId = ref<number | null>(null);
  /** EQ 고객 확인 패널 — 승인 전에 고객에게 물어보는 별도 축. */
  const eqReviewPo = ref<AdminPcbPoViewType | null>(null);

  // EQ 고객 확인 표시 — 대화상자를 열지 않아도 "보냈는지·답했는지"가 보인다. 버튼 하나가 상태를
  // 입는다: 미요청 → 확인중 → 승인/반려. 판정은 lib/pcb-eq-review 공용(워크큐 배지와 같은 상태).
  const eqReviewStateOf = (po: AdminPcbPoViewType): PcbEqReviewDisplay => pcbEqReviewState(po.eqReview);
  /** 버튼 문구 — 목록 배지와 달리 결정 일자까지 싣는다(자리가 있다). */
  const eqReviewLabelOf = (po: AdminPcbPoViewType): string => {
    const r = po.eqReview;
    switch (eqReviewStateOf(po)) {
      case 'pending':
        return '고객 확인중';
      case 'overdue':
        return '고객 회신 기한초과';
      case 'approved':
        return `고객 승인 ${fmtKstDate(r?.decidedAt ?? null)}`;
      case 'rejected':
        return `고객 반려 ${fmtKstDate(r?.decidedAt ?? null)}`;
      default:
        return '고객 확인';
    }
  };
  const eqReviewTitleOf = (po: AdminPcbPoViewType): string => pcbEqReviewTitle(po.eqReview);

  /** 제작 사양 수정 — 저장하면 견적이 새로 발급되므로 상세를 다시 읽는다. */
  const editableSpec = computed<Record<string, string | number>>(() => detail.value?.spec ?? {});
  const specEditOpen = ref(false);
  const specEditSaved = (): void => {
    void detailQuery.refetch();
  };

  // ── D11 — EQ·생산 대행(협력사 포털 미온보딩 조직 대비) ───────────────────────────
  const eqSubstitute = useAdminPcbEqSubstitute();
  const uploadEqAdmin = useUploadAdminPcbEqFile();
  const deleteEqAdmin = useDeleteAdminPcbEqFile();

  // 스텐실 제출 대행은 입력 대화상자로 — 고객문의사항(선택)을 함께 실을 수 있는 유일한 순간이고(제출
  // 뒤엔 잠긴다), 좌표파일 게이트는 서버가 강제한다(대행이라고 요건이 빠지지 않는다).
  async function substituteStencilRequest(po: AdminPcbPoViewType): Promise<void> {
    actionError.value = '';
    await promptDialog({
      title: '확인 요청 대행',
      description: `${po.partnerName} 대신 확인 요청을 올립니다(이력에 관리자 대행으로 남습니다). 좌표파일이 먼저 첨부돼 있어야 합니다.`,
      fields: [
        {
          name: 'note',
          label: '고객문의사항 (선택)',
          type: 'textarea',
          placeholder: '협력사가 전달한 문의사항이 있으면 적어 주세요.',
        },
      ],
      confirmLabel: '확인 요청',
      // 좌표파일이 없으면 서버가 COORD_FILE_REQUIRED 로 끊는다 — 그 문구가 대화상자 안에 그대로 보인다.
      errorFallback: '대행 진행에 실패했습니다.',
      submit: async (values) => {
        if (specId.value === null) return;
        await eqSubstitute.mutateAsync({ specId: specId.value, poId: po.poId, action: 'eq-request', note: values.note ?? '' });
      },
    });
  }
  async function runSubstitute(po: AdminPcbPoViewType): Promise<void> {
    if (specId.value === null) return;
    const action = substituteActionOf(po.status);
    if (action === null) return;
    if (action === 'eq-request' && po.track === 'stencil') {
      await substituteStencilRequest(po);
      return;
    }
    if (
      !(await confirmDialog(
        `${po.partnerName} 대신 [${substituteLabelOf(po, action)}]을 진행할까요? (이력에 관리자 대행으로 남습니다)`,
      ))
    )
      return;
    actionError.value = '';
    try {
      await eqSubstitute.mutateAsync({ specId: specId.value, poId: po.poId, action });
    } catch (e) {
      surfaceError(e, '대행 진행에 실패했습니다.');
    }
  }
  function pickEqFileAdmin(po: AdminPcbPoViewType, fileType: PcbEqFileTypeType): void {
    if (specId.value === null) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      actionError.value = '';
      try {
        await uploadEqAdmin.mutateAsync({ specId: specId.value ?? 0, poId: po.poId, file, fileType });
      } catch (e) {
        surfaceError(e, '파일 업로드에 실패했습니다.');
      }
    };
    input.click();
  }
  async function removeEqFileAdmin(po: AdminPcbPoViewType, fileId: number): Promise<void> {
    if (specId.value === null) return;
    if (!(await confirmDialog({ message: '이 첨부를 삭제할까요?', confirmLabel: '삭제', tone: 'danger' }))) return;
    actionError.value = '';
    try {
      await deleteEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId, fileId });
    } catch (e) {
      surfaceError(e, '파일 삭제에 실패했습니다.');
    }
  }
  async function approvePo(po: AdminPcbPoViewType): Promise<void> {
    if (specId.value === null) return;
    // 고객 확인을 띄워 놓고도 답을 기다리지 않거나, 반려된 건을 그대로 승인하는 사고를 막는다. 서버는
    // 막지 않는다 — 관리자 만능 대행(D11)이 원칙이라 여기서 되묻기만 한다. 어휘는 계약 라벨 사전 하나.
    const approveWord = pcbEqForwardLabel('eq_requested', po.track);
    const state = eqReviewStateOf(po);
    const note = po.eqReview?.decisionNote ?? null;
    const ask =
      state === 'rejected'
        ? `고객이 반려한 건입니다${note === null ? '' : `\n사유: ${note}`}\n\n그래도 ${approveWord} 처리할까요?`
        : state === 'pending' || state === 'overdue'
          ? `고객 회신을 기다리는 중입니다.\n\n답을 기다리지 않고 ${approveWord} 처리할까요?`
          : null;
    if (ask !== null && !(await confirmDialog({ message: ask, confirmLabel: '그래도 진행', tone: 'danger' }))) return;
    actionError.value = '';
    try {
      await approveEq.mutateAsync({ specId: specId.value, poId: po.poId });
    } catch (e) {
      surfaceError(e, `${approveWord}에 실패했습니다.`);
    }
  }

  // EQ 반려는 사유와 수정지시 첨부를 함께 받는다(전용 대화상자). ⚠ 대상은 **id 로** 들고 목록에서 다시
  // 찾는다 — 행 스냅샷을 잡아 두면 대화상자 안에서 첨부를 올려도 갱신되지 않는다.
  const rejectPoId = ref<number | null>(null);
  const rejectTarget = computed<AdminPcbPoViewType | null>(() =>
    rejectPoId.value === null ? null : (allPos.value.find((p) => p.poId === rejectPoId.value) ?? null),
  );
  // 고객이 반려한 건이면 그 사유를 채워 둔다(다시 타이핑하지 않게).
  const rejectPrefill = computed<string>(() => {
    const po = rejectTarget.value;
    return po?.eqReview?.status === 'rejected' ? (po.eqReview.decisionNote ?? '') : '';
  });
  async function submitReject(reason: string): Promise<void> {
    const po = rejectTarget.value;
    if (specId.value === null || po === null) return;
    actionError.value = '';
    try {
      await rejectEq.mutateAsync({ specId: specId.value, poId: po.poId, reason });
      rejectPoId.value = null;
    } catch (e) {
      surfaceError(e, `${pcbEqRejectActionLabel(po.track)}에 실패했습니다.`);
    }
  }
  async function revertPo(po: AdminPcbPoViewType): Promise<void> {
    if (specId.value === null) return;
    if (
      !(await confirmDialog({
        message:
          po.track === 'stencil' ? '확인 완료를 취소(한 단계 되돌리기)할까요?' : 'EQ 승인을 취소(한 단계 되돌리기)할까요?',
        confirmLabel: '되돌리기',
        tone: 'danger',
      }))
    )
      return;
    actionError.value = '';
    try {
      await revertEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
    } catch (e) {
      surfaceError(e, '되돌리기에 실패했습니다.');
    }
  }
  async function removePo(po: AdminPcbPoViewType): Promise<void> {
    if (specId.value === null) return;
    if (
      !(await confirmDialog({
        message: `${po.partnerName} 발주서를 취소할까요? (발주접수 상태만 가능)`,
        confirmLabel: '발주 취소',
        tone: 'danger',
      }))
    )
      return;
    actionError.value = '';
    try {
      await deletePoMut.mutateAsync({ specId: specId.value, poId: po.poId });
    } catch (e) {
      surfaceError(e, '발주 취소에 실패했습니다.');
    }
  }

  // 납기 경과 — 발주 큐와 같은 순수 함수. KST 날짜로 넘긴다(납기는 KST 자정 앵커라 ISO 를 자르면
  // 하루 앞당겨진다).
  const isPoOverdue = (po: AdminPcbPoViewType): boolean =>
    isPcbDeliveryOverdue(po.status, kstDateOnly(po.deliveryDate), kstToday());

  // EQ 첨부는 **누적**이다(같은 종류를 다시 올려도 이전 파일을 지우지 않는다). 기본은 종류별 최신만
  // 펼치고 이전 것은 접는다 — 전부 늘어놓으면 맨 앞(=가장 오래된) 버튼을 눌러 옛 도면을 보고 승인한다
  // (여정 22호). 최신 판정·정렬은 서버가 계약(orderPcbEqFiles)으로 해서 내려 준다.
  const eqHistoryOpen = ref<number[]>([]);
  const toggleEqHistory = (poId: number): void => {
    eqHistoryOpen.value = eqHistoryOpen.value.includes(poId)
      ? eqHistoryOpen.value.filter((id) => id !== poId)
      : [...eqHistoryOpen.value, poId];
  };
  // 협력사 산출물(eq·working)과 관리자 회신(reply)은 방향이 반대라 한 줄에 섞지 않는다.
  const partnerEqFiles = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
    po.eqFiles.filter((f) => f.fileType !== 'reply');
  const eqFilesShown = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
    eqHistoryOpen.value.includes(po.poId) ? partnerEqFiles(po) : partnerEqFiles(po).filter((f) => f.isLatest);
  const eqOlderCount = (po: AdminPcbPoViewType): number => partnerEqFiles(po).filter((f) => !f.isLatest).length;
  /** 관리자 회신 첨부 — 반려하며 돌려보내는 수정지시. 협력사는 못 지운다. */
  const replyFilesOf = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
    po.eqFiles.filter((f) => f.fileType === 'reply');
  /** 직전 반려(시각+사유) — 상태 칸이 "돌려보낸 건"임을 말하고 사유를 보여 준다. */
  const poRejection = (po: AdminPcbPoViewType): PcbEqRejection | null => lastPcbEqRejection(po.eqHistory);
  /** 스텐실 — 협력사가 확인 요청에 실어 보낸 고객문의사항(현행 제출분). */
  const stencilInquiryOf = (po: AdminPcbPoViewType): { at: string; note: string } | null =>
    po.track === 'stencil' ? lastPcbStencilInquiry(po.eqHistory) : null;
  // 반려 뒤 보완 — 첨부는 승인요청 뒤 잠기므로 보완 파일은 반려와 재요청 **사이**에만 올라온다. 그 구간이
  // 비었는데 다시 승인요청이 와 있으면 같은 도면으로 재요청한 것이다(승인 버튼 옆에서 말한다).
  const eqUnfixedAfterReject = (po: AdminPcbPoViewType): boolean =>
    po.status === 'eq_requested' && lastPcbEqRejectedAt(po.eqHistory) !== null && !po.eqFiles.some((f) => f.afterReject);

  return {
    poModalOpen,
    poPartnerId,
    poPrice,
    poRate,
    poTerms,
    poRemittanceDue,
    poDelivery,
    poMemo,
    createPo,
    poIsNet7,
    poIsCustomPaymentDate,
    poRemittanceDuePreview,
    poTargetRfq,
    poCanSubmit,
    poCurrencyOf,
    openPoModal,
    submitPo,
    approveEq,
    rejectEq,
    editPo,
    editTerms,
    editRemittanceDue,
    editDelivery,
    editMemo,
    editIsNet7,
    editIsCustomPaymentDate,
    editRemittanceDuePreview,
    editCanSubmit,
    openPoEdit,
    submitPoEdit,
    remittancePoId,
    eqReviewPo,
    eqReviewStateOf,
    eqReviewLabelOf,
    eqReviewTitleOf,
    editableSpec,
    specEditOpen,
    specEditSaved,
    runSubstitute,
    pickEqFileAdmin,
    removeEqFileAdmin,
    approvePo,
    rejectPoId,
    rejectTarget,
    rejectPrefill,
    submitReject,
    revertPo,
    removePo,
    isPoOverdue,
    eqHistoryOpen,
    toggleEqHistory,
    eqFilesShown,
    eqOlderCount,
    replyFilesOf,
    poRejection,
    stencilInquiryOf,
    eqUnfixedAfterReject,
  };
}

export type CasePo = ReturnType<typeof useCasePo>;
