import { computed, ref } from 'vue';
import {
  pcbMarginPercent,
  pcbSellingPrice,
  type AdminPcbRfqViewType,
  type PcbRfqReplyBodyType,
} from '@sp/api-contract';
import { kstDateInput, kstDateOnly, kstToday } from '@sp/utils';
import { useConfirmPrice } from '@/admin/useAdminQuotes';
import { useAdminPartnerList, type AdminPartnerFilters } from '@/admin/useAdminPartners';
import { fetchPcbExchangeRate } from '@/admin/pcbExchangeRate';
import {
  pcbMagicReplyUrl,
  useAdminPcbRfqReply,
  useReissuePcbMagicLink,
  useSelectPcbRfq,
  useSendPcbRfqs,
  useUnselectPcbRfq,
} from '@/admin/useAdminPcbRfqs';
import { confirmDialog } from '@/next/lib/dialog';
import type { BadgeVariant } from '@/next/components/pcb/pcb-badges';
import type { CaseCore } from './case-core';

// PCB Case 상세 — 협력사 RFQ 패널의 조작(확정가 등록·배정·대리 회신·선정/해제·매직링크).
// 프로세스: 회신 비교 → [선정] → [확정가 등록](담김/주문됨 409) → 고객 주문. 옛 화면과 같은 식.

export function useCaseRfq(core: CaseCore) {
  const { specId, detail, adminRows, selectedRow, actionError, surfaceError, poSelectionGuide } = core;

  // ── 확정가 등록(선정행 KRW 환산을 프리필) ─────────────────────────────────────
  const priceModalOpen = ref(false);
  const priceInput = ref('');
  const confirmPrice = useConfirmPrice();
  function openPriceModal(): void {
    const prefill = selectedRow.value?.krwAmount ?? detail.value?.price ?? null;
    priceInput.value = prefill === null ? '' : String(prefill);
    priceModalOpen.value = true;
  }
  async function submitPrice(): Promise<void> {
    actionError.value = '';
    const value = Number(priceInput.value.replaceAll(',', ''));
    if (!Number.isFinite(value) || value <= 0) {
      actionError.value = '확정가(원)를 입력해 주세요.';
      return;
    }
    if (specId.value === null) return;
    try {
      await confirmPrice.mutateAsync({ projectId: specId.value, finalPrice: Math.round(value) });
      priceModalOpen.value = false;
    } catch (e) {
      surfaceError(e, '확정가 등록에 실패했습니다.');
    }
  }

  // ── 배정 — 승인 + pcb_rfq 능력 협력사만 후보 ─────────────────────────────────
  const assignOpen = ref(false);
  const assignSelected = ref<Set<number>>(new Set());
  const assignDate = ref('');
  const partnerFilters = ref<AdminPartnerFilters>({ page: 1, pageSize: 100, tab: 'approved', type: 'partner', q: '' });
  const partnersQuery = useAdminPartnerList(partnerFilters);
  const assignCandidates = computed(() =>
    (partnersQuery.data.value?.data.items ?? []).filter((p) => (p.capabilities as readonly string[]).includes('pcb_rfq')),
  );
  const send = useSendPcbRfqs();
  function openAssign(): void {
    assignSelected.value = new Set(adminRows.value.filter((r) => r.status !== 'unselected').map((r) => r.partnerId));
    const current = adminRows.value.find((r) => r.suggestedDeliveryDate !== null);
    assignDate.value = kstDateInput(current?.suggestedDeliveryDate);
    assignOpen.value = true;
  }
  function toggleAssign(partnerId: number): void {
    const next = new Set(assignSelected.value);
    if (next.has(partnerId)) next.delete(partnerId);
    else next.add(partnerId);
    assignSelected.value = next;
  }
  async function submitAssign(): Promise<void> {
    if (specId.value === null) return;
    actionError.value = '';
    try {
      await send.mutateAsync({
        specId: specId.value,
        body: { partnerIds: [...assignSelected.value], suggestedDeliveryDate: assignDate.value === '' ? null : assignDate.value },
      });
      assignOpen.value = false;
    } catch (e) {
      surfaceError(e, '견적요청 발송에 실패했습니다.');
    }
  }

  // ── 대리 회신(포털·매직링크와 같은 저장 코어) ────────────────────────────────
  const replyTarget = ref<AdminPcbRfqViewType | null>(null);
  const adminReply = useAdminPcbRfqReply();
  async function submitAdminReply(body: PcbRfqReplyBodyType): Promise<void> {
    if (specId.value === null || replyTarget.value === null) return;
    actionError.value = '';
    try {
      await adminReply.mutateAsync({ specId: specId.value, rfqId: replyTarget.value.rfqId, body });
      replyTarget.value = null;
    } catch (e) {
      surfaceError(e, '대리 회신 저장에 실패했습니다.');
    }
  }

  // ── 선정/해제 — 외화 환율 자동 프리필(수출입은행 캐시, 수정 가능) + 판매가(확정가) 동시 등록.
  //    판매가 게이트는 [확정가 등록]과 같다(담김·주문 전) — 진행 중 주문이면 선정만 한다. ──────
  const selectTarget = ref<AdminPcbRfqViewType | null>(null);
  const selectRate = ref('');
  const selectRateDate = ref<string | null>(null);
  const selectMargin = ref('');
  const selectFinal = ref('');
  const selectMut = useSelectPcbRfq();
  const unselectMut = useUnselectPcbRfq();
  const canPriceInSelect = computed(() => detail.value?.cartState === 'none' && detail.value.status === 'active');
  // 원가(KRW 환산) 미리보기 — 서버 박제식(priceOriginal×환율, KRW 반올림)과 동형
  const selectCostKrw = computed<number | null>(() => {
    const row = selectTarget.value;
    const price = row?.priceOriginal ?? null;
    if (row === null || price === null) return null;
    if (row.currency === 'KRW') return Math.round(price);
    const rate = Number(selectRate.value.replaceAll(',', ''));
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return Math.round(price * rate);
  });
  const selectFinalValid = computed(() => {
    const value = Number(selectFinal.value.replaceAll(',', ''));
    return Number.isFinite(value) && value > 0;
  });
  // 마진↔판매가 환산식은 계약이 정본 — RFQ 워크큐의 '마진' 배지가 같은 함수를 쓴다.
  function syncFinalFromMargin(): void {
    const cost = selectCostKrw.value;
    const margin = Number(selectMargin.value.replaceAll(',', ''));
    if (cost === null || selectMargin.value.trim() === '' || !Number.isFinite(margin)) return;
    selectFinal.value = String(pcbSellingPrice(cost, margin));
  }
  function syncMarginFromFinal(): void {
    const cost = selectCostKrw.value;
    const final = Number(selectFinal.value.replaceAll(',', ''));
    const margin = cost === null || !Number.isFinite(final) || final <= 0 ? null : pcbMarginPercent(final, cost);
    selectMargin.value = margin === null ? '' : margin.toFixed(1);
  }
  function onSelectRateInput(): void {
    selectRateDate.value = null; // 손으로 고치면 고시 라벨 해제(수동값)
    if (selectMargin.value.trim() !== '') syncFinalFromMargin();
    else if (selectFinal.value.trim() !== '') syncMarginFromFinal();
  }
  function openSelect(row: AdminPcbRfqViewType): void {
    actionError.value = '';
    selectTarget.value = row;
    selectRate.value = '';
    selectRateDate.value = null;
    selectMargin.value = '';
    const prefill = detail.value?.finalPrice ?? null; // 재선정 — 기존 확정가 유지 프리필
    selectFinal.value = prefill === null ? '' : String(prefill);
    if (row.currency !== 'USD' && row.currency !== 'CNY') {
      syncMarginFromFinal(); // KRW — 원가 환산이 필요 없다
      return;
    }
    void fetchPcbExchangeRate(row.currency).then((r) => {
      // 늦은 응답이 사용자의 입력·다른 행 대화상자를 덮지 않게 — 같은 행, 미입력일 때만 반영
      if (selectTarget.value?.rfqId !== row.rfqId || selectRate.value !== '' || r === null) return;
      selectRate.value = String(r.rate);
      selectRateDate.value = r.rateDate;
      if (selectFinal.value.trim() !== '') syncMarginFromFinal();
    });
  }
  async function submitSelect(withPrice: boolean): Promise<void> {
    if (specId.value === null || selectTarget.value === null) return;
    const row = selectTarget.value;
    let exchangeRate: number | undefined;
    if (row.currency !== 'KRW') {
      exchangeRate = Number(selectRate.value.replaceAll(',', ''));
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        actionError.value = `적용 환율(${row.currency}→KRW)을 입력해 주세요.`;
        return;
      }
    }
    let finalPrice: number | undefined;
    if (withPrice) {
      const value = Number(selectFinal.value.replaceAll(',', ''));
      if (!Number.isFinite(value) || value <= 0) {
        actionError.value = '판매가(확정가, 원)를 입력해 주세요.';
        return;
      }
      finalPrice = Math.round(value);
    }
    actionError.value = '';
    try {
      await selectMut.mutateAsync({
        specId: specId.value,
        rfqId: row.rfqId,
        ...(exchangeRate === undefined ? {} : { exchangeRate }),
        ...(finalPrice === undefined ? {} : { finalPrice }),
      });
      poSelectionGuide.value = '';
      selectTarget.value = null;
    } catch (e) {
      surfaceError(e, '선정에 실패했습니다.');
    }
  }
  async function submitUnselect(row: AdminPcbRfqViewType): Promise<void> {
    if (specId.value === null) return;
    if (
      !(await confirmDialog({
        message: `${row.partnerName} 선정을 해제할까요? 형제 회신은 다시 열립니다.`,
        confirmLabel: '선정 해제',
        tone: 'danger',
      }))
    )
      return;
    actionError.value = '';
    try {
      await unselectMut.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
    } catch (e) {
      surfaceError(e, '선정 해제에 실패했습니다.');
    }
  }

  // ── 매직링크 ───────────────────────────────────────────────────────────────
  const reissue = useReissuePcbMagicLink();
  const copiedRfqId = ref<number | null>(null);
  async function copyMagicLink(row: AdminPcbRfqViewType): Promise<void> {
    if (row.magicToken === null) return;
    await navigator.clipboard.writeText(pcbMagicReplyUrl(row.magicToken));
    copiedRfqId.value = row.rfqId;
    window.setTimeout(() => {
      if (copiedRfqId.value === row.rfqId) copiedRfqId.value = null;
    }, 1500);
  }
  async function reissueMagicLink(row: AdminPcbRfqViewType): Promise<void> {
    if (specId.value === null) return;
    if (
      !(await confirmDialog({
        message: '매직링크를 재발급할까요? 기존 링크는 즉시 무효화됩니다.',
        confirmLabel: '재발급',
        tone: 'danger',
      }))
    )
      return;
    actionError.value = '';
    try {
      await reissue.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
    } catch (e) {
      surfaceError(e, '재발급에 실패했습니다.');
    }
  }

  // 납기 신호(레거시 승계) — 제시≠회신이면 '변경', 회신일이 과거면 경고. 비교는 KST 날짜로
  // (UTC 슬라이스는 KST 00~09시에 '지난 날짜'를 오판한다).
  const deliverySignal = (row: AdminPcbRfqViewType): { label: string; variant: BadgeVariant } | null => {
    const quoted = kstDateOnly(row.quotedDeliveryDate);
    if (quoted === null) return null;
    if (quoted < kstToday()) return { label: '지난 날짜', variant: 'danger' };
    if (row.suggestedDeliveryDate !== null) {
      const suggested = kstDateOnly(row.suggestedDeliveryDate) ?? quoted;
      if (suggested !== quoted) {
        const days = Math.round((Date.parse(quoted) - Date.parse(suggested)) / 86_400_000);
        return { label: `변경 ${days > 0 ? '+' : ''}${String(days)}일`, variant: 'warning' };
      }
    }
    return null;
  };
  const editableRow = (row: AdminPcbRfqViewType): boolean => row.status === 'requested' || row.status === 'quoted';

  return {
    priceModalOpen,
    priceInput,
    confirmPrice,
    openPriceModal,
    submitPrice,
    assignOpen,
    assignSelected,
    assignDate,
    assignCandidates,
    send,
    openAssign,
    toggleAssign,
    submitAssign,
    replyTarget,
    adminReply,
    submitAdminReply,
    selectTarget,
    selectRate,
    selectRateDate,
    selectMargin,
    selectFinal,
    selectMut,
    canPriceInSelect,
    selectCostKrw,
    selectFinalValid,
    syncFinalFromMargin,
    syncMarginFromFinal,
    onSelectRateInput,
    openSelect,
    submitSelect,
    submitUnselect,
    copiedRfqId,
    copyMagicLink,
    reissueMagicLink,
    deliverySignal,
    editableRow,
  };
}

export type CaseRfq = ReturnType<typeof useCaseRfq>;
