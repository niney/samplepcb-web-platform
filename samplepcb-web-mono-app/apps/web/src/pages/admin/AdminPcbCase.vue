<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PAYMENT_TERM_CUSTOM_DATE,
  PCB_PAYMENT_TERM_NET_7,
  PCB_PAYMENT_TERM_OPTIONS,
  PCB_PO_STATUS_LABELS,
  PCB_RFQ_STATUS_LABELS,
  bomShipmentNextStatus,
  isPcbDeliveryOverdue,
  canEditPcbEqFile,
  lastPcbEqRejectedAt,
  lastPcbEqRejection,
  pcbMarginPercent,
  pcbSellingPrice,
  resolvePcbDirectShipCountry,
  type AdminPcbPoViewType,
  type AdminPcbRfqViewType,
  type PcbEqFileTypeType,
  type PcbEqRejection,
  type BomShipmentStatusType,
  type PcbRfqReplyBodyType,
  type PcbShipmentAdvanceBodyType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import { fmtKstDate, kstDateInput, kstDateOnly, kstToday } from '@sp/utils';
import { downloadAdminFile, useAdminQuoteDetail, useConfirmPrice } from '../../admin/useAdminQuotes';
import { useAdminPartnerList, type AdminPartnerFilters } from '../../admin/useAdminPartners';
import { fetchPcbExchangeRate } from '../../admin/pcbExchangeRate';
import {
  pcbMagicReplyUrl,
  useAdminPcbRfqReply,
  useAdminPcbRfqs,
  useReissuePcbMagicLink,
  useSelectPcbRfq,
  useSendPcbRfqs,
  useUnselectPcbRfq,
} from '../../admin/useAdminPcbRfqs';
import {
  adminPcbInvoiceApi,
  downloadAdminPcbEqFile,
  downloadAdminPcbShipmentFile,
  useAdminPcbEqSubstitute,
  useAdminPcbPos,
  useAdminPcbShipmentAdvance,
  useAdminPcbShipmentBox,
  useAdminPcbShipmentCancel,
  useAdminPcbShipmentReceive,
  useAdminPcbShipmentRevert,
  useAdminRevertPcbEq,
  useApprovePcbEq,
  useCreatePcbPo,
  useDeleteAdminPcbEqFile,
  useDeletePcbPo,
  usePatchPcbPo,
  useRejectPcbEq,
  useUploadAdminPcbEqFile,
  type AdminPcbEqSubstituteAction,
} from '../../admin/useAdminPcbPos';
import { useConfirmPcbOrderReceipt, usePcbCompleteCustomerOrder } from '../../admin/useAdminPcbOrders';
import EstimateModal from '../../components/admin/EstimateModal.vue';
import PcbEqRejectModal from '../../components/admin/pcb/PcbEqRejectModal.vue';
import { emptyMailLogFilters, useAdminMailLogList } from '../../admin/useAdminMailLogs';
import { pcbCategoryBadge } from '../../lib/pcb-category';
import { fmtPcbAmount, pcbKrwSuffix, pcbMoneyWithSub } from '../../lib/pcb-money';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '../../lib/pcb-shipment-label';
import {
  PCB_EQ_REVIEW_BTN_CLS,
  pcbEqReviewState,
  pcbEqReviewTitle,
  type PcbEqReviewDisplay,
} from '../../lib/pcb-eq-review';
import { pcbSpecEntries } from '../../lib/pcb-spec';
import PcbRfqReplyForm from '../../components/pcb/PcbRfqReplyForm.vue';
import DeleteQuoteModal from '../../components/admin/DeleteQuoteModal.vue';
import InvoiceEditorModal from '../../components/smartbom/InvoiceEditorModal.vue';
import PcbRemittancePanel from '../../components/admin/pcb/PcbRemittancePanel.vue';
import PcbEqReviewPanel from '../../components/admin/pcb/PcbEqReviewPanel.vue';
import PcbSpecEditModal from '../../components/admin/pcb/PcbSpecEditModal.vue';
import PcbCustomerShipModal from '../../components/admin/pcb/PcbCustomerShipModal.vue';
import PcbAsCasePanel from '../../components/admin/pcb/PcbAsCasePanel.vue';
import { confirmDialog } from '../../lib/confirmDialog';
import UiPromptModal, { type PromptField } from '../../components/ui/UiPromptModal.vue';
import PcbOrderCancelModal from '../../components/admin/pcb/PcbOrderCancelModal.vue';
import MailLogList from '../../components/admin/MailLogList.vue';
import AdminCaseCustomerCard from '../../components/admin/AdminCaseCustomerCard.vue';

// PCB Case 상세 — docs/PCB_PARTNER_TRACK.md §5.4. 스펙 요약(기존 admin-pcb-projects
// 상세 계약 재사용) + 협력사 RFQ 패널(배정 diff·대리 회신·선정/해제·매직링크).
// 프로세스: 회신 비교 → [선정] → [확정가 등록](기존 PATCH — 담김/주문됨 409) → 고객 주문.

const route = useRoute();
const router = useRouter();
const specId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
// 진입 워크큐 복귀 링크 — ?from= 일반화(P3.5, rfqs 하드코딩 정리).
const BACK_TARGETS: Record<string, { name: string; label: string }> = {
  cases: { name: 'admin-pcb-cases', label: 'PCB 진행현황' },
  rfqs: { name: 'admin-pcb-rfqs', label: 'PCB 견적요청' },
  orders: { name: 'admin-pcb-orders', label: 'PCB 주문·결제' },
  pos: { name: 'admin-pcb-pos', label: 'PCB 발주·EQ' },
  shipments: { name: 'admin-pcb-shipments', label: 'PCB 선적·배송' },
};
const backTarget = computed(
  () => BACK_TARGETS[String(route.query.from ?? '')] ?? { name: 'admin-quotes', label: '견적 관리' },
);

/** YYYY-MM-DD 달력 날짜 덧셈 — 시각/브라우저 타임존을 끼우지 않아 KST 날짜가 밀리지 않는다. */
const addDateOnlyDays = (value: string, days: number): string => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// 역할별 진입 컨텍스트(§6.12 미러) — 무관 섹션은 한 줄 접힘 바로 축소한다(존재 신호 +
// 한 클릭 복원). 완전 숨김이 아닌 이유는 SmartBOM 과 같다: 인접 단계 참조가 잦고, 같은
// URL 이 경로에 따라 달라 보이면 버그로 오인된다. PCB 에서 접는 대상은 표가 가장 큰 RFQ
// 패널과 발주·EQ 패널 둘 뿐 — 제작 사양은 발주·선적 때 확인이 잦아 접지 않는다.
// from 없음(진행현황·북마크)=전체 표시. 상세는 여전히 단일 척추 — 렌더만 다르다.
type CaseSection = 'rfq' | 'po';
const INITIAL_COLLAPSED: Record<string, CaseSection[]> = {
  rfqs: ['po'], // 견적 — RFQ 가 본업
  orders: ['rfq'], // 경리 — 주문 정보가 본업(발주 진행은 참고로 남김)
  pos: ['rfq'], // 구매 — 발주 패널이 본업(선정가는 발주 스냅샷에 박제됨)
  shipments: ['rfq'], // 물류 — 발주 패널의 [선적 관리]가 진입점
};
const collapsed = ref<Set<CaseSection>>(
  new Set(INITIAL_COLLAPSED[String(route.query.from ?? '')] ?? []),
);
const expandSection = (section: CaseSection): void => {
  const next = new Set(collapsed.value);
  next.delete(section);
  collapsed.value = next;
};
const rfqSectionEl = ref<HTMLElement | null>(null);
const poSelectionGuide = ref('');

const detailQuery = useAdminQuoteDetail(specId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const rfqsQuery = useAdminPcbRfqs(specId);
const allRows = computed(() => rfqsQuery.data.value?.data.rfqs ?? []);
const adminRows = computed(() => allRows.value.filter((r) => r.parentPartnerId === 0));
const childrenOf = (partnerId: number): AdminPcbRfqViewType[] =>
  allRows.value.filter((r) => r.parentPartnerId === partnerId);
const selectedRow = computed(() => adminRows.value.find((r) => r.status === 'selected') ?? null);


// 견적서(A4 보기·인쇄·발송) — 견적 관리 드로어와 **같은 모달**을 쓴다(창구만 둘).
// 확정가 등록이 이 화면에서 끝나므로 "확정 → 곧장 발송"이 여기서 이어진다.
const estimateProjectId = ref<number | null>(null);

// 견적서를 보냈는가 — 발송 원장(sp_mail_log)에 이미 다 남아 있으므로 새 API 를 만들지 않고
// 같은 목록을 kind/channel 로 좁혀 **최신 1건만** 본다. 아래 '보낸 메일' 섹션과 같은 원장이라
// 두 표시가 어긋날 수 없다. 알림톡은 게이트가 따로라(로컬 skipped) 이메일 축으로만 판정한다.
// refId 를 '0' 으로 두는 건 specId 미확정 구간에 **전역 최신 1건**이 딸려오는 것을 막기 위함이다
// (필터는 빈 문자열을 '전체'로 읽는다).
const estimateMailFilters = computed(() =>
  emptyMailLogFilters({
    refType: 'pcb_spec',
    refId: String(specId.value ?? 0),
    kind: 'estimate',
    channel: 'email',
    pageSize: 1,
  }),
);
const estimateMailQuery = useAdminMailLogList(estimateMailFilters);
const lastEstimateMail = computed(() => estimateMailQuery.data.value?.data.items[0] ?? null);
const estimateSent = computed(() => lastEstimateMail.value?.status === 'sent');
// ② 칸의 한 줄 — 상태 문구·색·툴팁. 미발송을 회색으로 흘리지 않는다(확정만 하고 끝내는
// 것이 이 트랙의 실제 실수라, 아직 안 보냈다는 사실이 눈에 걸려야 한다).
const estimateSendState = computed<{ label: string; cls: string; title: string }>(() => {
  const m = lastEstimateMail.value;
  if (m === null)
    return {
      label: '미발송',
      cls: 'text-amber-700',
      title: '아직 고객에게 견적서를 보내지 않았습니다.',
    };
  const when = fmtKstDate(m.createdAt);
  if (m.status === 'sent')
    return {
      label: `${when} 발송함`,
      cls: 'text-emerald-700',
      title: `${m.recipient} 로 발송했습니다.`,
    };
  if (m.status === 'failed')
    return {
      label: '발송 실패',
      cls: 'text-red-600',
      title: `${when} 발송 실패(${m.reason ?? '사유 미상'}) — 다시 보내세요.`,
    };
  // skipped = 보내려 했으나 채널이 꺼졌거나 수신처가 없었다.
  return {
    label: '미발송(건너뜀)',
    cls: 'text-amber-700',
    title: `${when} 발송 건너뜀(${m.reason ?? '사유 미상'}) — 설정·수신처를 확인하세요.`,
  };
});
// 발행 가능 판정은 드로어와 같은 규칙(활성 ∧ 가격 확정). 다만 **버튼은 감추지 않는다** —
// 이 화면은 RFQ 워크큐의 종착지라 확정 전 건이 다수인데, 조건부로 숨기면 기능이 있다는
// 사실 자체가 안 보인다(PcbSelectionBar 와 같은 규율). 대신 비활성 + 사유 툴팁.
const estimateEnabled = computed<boolean>(() => {
  const d = detail.value;
  return d !== null && d.status === 'active' && d.price !== null;
});
const estimateBlockedReason = computed<string>(() => {
  const d = detail.value;
  if (d === null) return '';
  if (d.status !== 'active') return '보관된 견적은 견적서를 발행할 수 없습니다.';
  if (d.price === null) return '가격 확정 후 견적서를 발행할 수 있습니다.';
  return '견적서를 보고 인쇄·발송합니다.';
});

// 영구 삭제 — 삭제되면 이 Case 는 사라지므로 진입 워크큐로 되돌린다.
const deleteOpen = ref(false);
// 보낸 메일(발송 이력) 섹션 — 조회용이라 기본 접힘.
const mailLogOpen = ref(false);
async function onDeleted(): Promise<void> {
  deleteOpen.value = false;
  await router.push({ name: backTarget.value.name });
}

const actionError = ref('');
const surfaceError = (e: unknown, fallback: string): void => {
  actionError.value =
    e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

// ── 스펙 표시 — 명칭·순서는 레거시 정본(lib/pcb-spec.ts, estimate_form_ca10 승계) ──
const specEntries = computed(() =>
  pcbSpecEntries((detail.value?.spec ?? {}) as Record<string, unknown>),
);
const gerberFiles = computed(
  () => (detail.value?.files ?? []).filter((f) => f.fileType !== 'thumbnail'),
);

const QUOTE_LABEL: Record<string, { label: string; cls: string }> = {
  rfq: { label: '견적 대기', cls: 'bg-amber-100 text-amber-700' },
  priced: { label: '자동견적', cls: 'bg-sky-100 text-sky-700' },
  quoted: { label: '견적 확정', cls: 'bg-emerald-100 text-emerald-700' },
};
const CANCELED_ORDER_ITEM_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const orderDisplayStatus = computed(() => {
  const order = detail.value?.order;
  if (order === null || order === undefined) return '';
  return CANCELED_ORDER_ITEM_STATUSES.has(order.ctStatus) ? order.ctStatus : order.odStatus;
});
// D10(P3.5) — 주문됨은 더 이상 일괄 차단이 아니다: 진행 중 주문(입금~배송)은
// 원가 소싱(RFQ) 허용, 판매가(확정가)만 불변. 게이트 정본은 서버 — 여기선 표시만.
const rfqGate = computed<'ok' | 'cart' | 'unpaid' | 'closed'>(() => {
  const d = detail.value;
  if (d === null) return 'ok';
  if (d.cartState === 'cart') return 'cart';
  if (d.cartState !== 'ordered') return 'ok';
  if (d.order === null) return 'ok'; // 유령(주문 헤더 소실) — 서버 게이트가 허용
  if (CANCELED_ORDER_ITEM_STATUSES.has(d.order.ctStatus) || d.order.odStatus === '완료' ||
    d.order.odStatus === '취소') return 'closed';
  if (!d.order.isPaid) return 'unpaid';
  return 'ok'; // 진행 중 주문 — 원가 소싱 모드
});
// 입금확인 — 발주 패널이 바로 아래라(미결제면 NOT_PAID) 여기서 끊기지 않게 같은 화면에 둔다.
// 조건·API 는 주문·결제 워크큐와 동일(코어 전이 재사용).
const receipt = useConfirmPcbOrderReceipt();
const cancelOrderOpen = ref(false);
const canReviewOrderCancel = computed(() => {
  const status = orderDisplayStatus.value;
  return specId.value !== null && status !== '' && status !== '취소' && status !== '반품' &&
    status !== '품절' && status !== '삭제' && status !== '완료';
});
const canConfirmReceipt = computed(() => {
  const order = detail.value?.order;
  return order !== null && order !== undefined && orderDisplayStatus.value === '주문' &&
    !order.isPaid && order.settleCase.includes('무통장');
});
async function confirmReceipt(): Promise<void> {
  const order = detail.value?.order;
  if (order === null || order === undefined) return;
  if (!(await confirmDialog(
    `주문 ${order.odId} 전체(PCB ${String(order.orderPcbCount)}건 포함)를 입금확인 처리할까요?\n` +
      `이 주문의 결제 가능한 모든 상품이 함께 입금 상태로 변경되고 고객에게 확인 메일이 발송됩니다.`,
  ))) {
    return;
  }
  actionError.value = '';
  try {
    const res = await receipt.mutateAsync({ odId: order.odId, sendMail: true });
    if (res.data.skipped.length > 0) {
      actionError.value = `처리되지 않았습니다: ${res.data.skipped[0]?.reason ?? ''} — 새로고침 후 다시 확인해 주세요.`;
    }
  } catch (e) {
    surfaceError(e, '입금확인에 실패했습니다.');
  }
}

const RFQ_GATE_NOTES: Record<string, string> = {
  cart: '고객 장바구니에 담김 — 담김 해제 후 견적요청을 보낼 수 있습니다.',
  unpaid: '입금 확인 전 주문 — 결제 확인 후 소싱을 시작하세요.',
  closed: '완료·취소된 주문 — 재작업은 아래 [A/S 재발주] 섹션에서 회차를 열어 진행합니다.',
};

// ── 확정가 등록(기존 PATCH 재사용 — 선정행 KRW 환산을 프리필) ────────────────
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

// ── 배정 모달 — 승인 + pcb_rfq 능력 협력사만 후보 ────────────────────────────
const assignOpen = ref(false);
const assignSelected = ref<Set<number>>(new Set());
const assignDate = ref('');
const partnerFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'partner',
  q: '',
});
const partnersQuery = useAdminPartnerList(partnerFilters);
const assignCandidates = computed(() =>
  (partnersQuery.data.value?.data.items ?? []).filter((p) =>
    (p.capabilities as readonly string[]).includes('pcb_rfq'),
  ),
);
const send = useSendPcbRfqs();
function openAssign(): void {
  assignSelected.value = new Set(
    adminRows.value.filter((r) => r.status !== 'unselected').map((r) => r.partnerId),
  );
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
      body: {
        partnerIds: [...assignSelected.value],
        suggestedDeliveryDate: assignDate.value === '' ? null : assignDate.value,
      },
    });
    assignOpen.value = false;
  } catch (e) {
    surfaceError(e, '견적요청 발송에 실패했습니다.');
  }
}

// ── 대리 회신 모달(포털·매직링크와 같은 저장 코어) ───────────────────────────
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

// ── 선정/해제 — 외화 환율 자동 프리필(수출입은행 캐시, 수정 가능) + 판매가(확정가)
// 동시 등록(레거시 선정 모달의 마진%↔판매가 복원). 판매가 게이트는 [확정가 등록]과
// 동일(담김·주문 전) — 진행 중 주문(원가 소싱 모드)이면 섹션을 감추고 선정만 한다.
const selectTarget = ref<AdminPcbRfqViewType | null>(null);
const selectRate = ref('');
const selectRateDate = ref<string | null>(null);
const selectMargin = ref('');
const selectFinal = ref('');
const selectMut = useSelectPcbRfq();
const unselectMut = useUnselectPcbRfq();
const canPriceInSelect = computed(
  () => detail.value?.cartState === 'none' && detail.value.status === 'active',
);
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
// 마진↔판매가 환산식은 계약이 정본(pcbSellingPrice/pcbMarginPercent) — RFQ 워크큐의
// '마진' 배지가 같은 함수를 쓴다. 여기 식만 손대면 두 화면이 다른 마진을 말한다.
function syncFinalFromMargin(): void {
  const cost = selectCostKrw.value;
  const margin = Number(selectMargin.value.replaceAll(',', ''));
  if (cost === null || selectMargin.value.trim() === '' || !Number.isFinite(margin)) return;
  selectFinal.value = String(pcbSellingPrice(cost, margin));
}
function syncMarginFromFinal(): void {
  const cost = selectCostKrw.value;
  const final = Number(selectFinal.value.replaceAll(',', ''));
  const margin =
    cost === null || !Number.isFinite(final) || final <= 0 ? null : pcbMarginPercent(final, cost);
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
    // 늦은 응답이 사용자의 입력·다른 행 모달을 덮지 않게 — 같은 행, 미입력일 때만 반영
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
  if (!(await confirmDialog({ message: `${row.partnerName} 선정을 해제할까요? 형제 회신은 다시 열립니다.`, confirmLabel: '선정 해제', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await unselectMut.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
  } catch (e) {
    surfaceError(e, '선정 해제에 실패했습니다.');
  }
}

// ── 매직링크 ─────────────────────────────────────────────────────────────────
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
  if (!(await confirmDialog({ message: '매직링크를 재발급할까요? 기존 링크는 즉시 무효화됩니다.', confirmLabel: '재발급', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await reissue.mutateAsync({ specId: specId.value, rfqId: row.rfqId });
  } catch (e) {
    surfaceError(e, '재발급에 실패했습니다.');
  }
}

// ── 발주 패널(P2) — paid 게이트는 서버, 프리필은 선정 견적행 ─────────────────
const posQuery = useAdminPcbPos(specId);
const allPos = computed(() => posQuery.data.value?.data.pos ?? []);
const adminPos = computed(() => allPos.value.filter((p) => p.parentPartnerId === 0));

// 회차(A/S 재발주, P4) — 지금은 전부 0차라 배지가 보이지 않지만, 회차가 쌓이기 시작하면
// "지나간 발주"와 "지금 발주"가 한 표에서 구분되지 않는다(워크큐엔 배지가 있는데 상세엔
// 없었다). 최신 회차만 펼치고 이전 회차는 접힘 바로 내린다.
const latestRound = computed(() =>
  Math.max(0, ...adminRows.value.map((r) => r.reorderRound), ...adminPos.value.map((p) => p.reorderRound)),
);
const latestRoundRfqs = computed(() =>
  adminRows.value.filter((row) => row.reorderRound === latestRound.value),
);
const selectedPoRfq = computed(() =>
  latestRoundRfqs.value.find((row) => row.status === 'selected') ?? null,
);
const roundsExpanded = ref(false);
const inLatestRound = (row: { reorderRound: number }): boolean =>
  roundsExpanded.value || row.reorderRound === latestRound.value;
const olderRoundCount = computed(
  () =>
    adminRows.value.filter((r) => r.reorderRound !== latestRound.value).length +
    adminPos.value.filter((p) => p.reorderRound !== latestRound.value).length,
);
// 헤더 "N건"의 N 은 전 회차 합산이라, 접힘 중엔 표에 보이는 수와 달라 오해를 산다 —
// 현재 회차 수를 병기해 신호를 정제한다(합산 카운트 자체는 유지).
const latestPoCount = computed(
  () => adminPos.value.filter((p) => p.reorderRound === latestRound.value).length,
);
const olderRoundsCollapsed = computed(() => olderRoundCount.value > 0 && !roundsExpanded.value);
// 상위 발주 행 밑의 하위 서브테이블은 **같은 회차**의 하위만 — 회차 무필터면 A/S 회차
// 행(A′) 밑에 round 0 하위(B)가 그대로 붙어 회차가 섞인다(여정 7호 결함 ②, childCount
// 서버 로직과 동일 규칙: parentPartnerId=상위 수주 조직 ∧ reorderRound 일치).
const childPosOf = (row: AdminPcbPoViewType): AdminPcbPoViewType[] =>
  allPos.value.filter(
    (p) => p.parentPartnerId === row.partnerId && p.reorderRound === row.reorderRound,
  );

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
const poIsCustomPaymentDate = computed(
  () => poTerms.value.trim() === PCB_PAYMENT_TERM_CUSTOM_DATE,
);
const poRemittanceDuePreview = computed(() =>
  poIsNet7.value ? addDateOnlyDays(kstToday(), 7) : poRemittanceDue.value,
);
const poTargetRfq = computed(() =>
  selectedPoRfq.value?.partnerId === poPartnerId.value ? selectedPoRfq.value : null,
);
const poCanSubmit = computed(
  () =>
    !createPo.isPending.value &&
    poPartnerId.value !== null &&
    poTargetRfq.value !== null &&
    (!poIsCustomPaymentDate.value || poRemittanceDue.value !== ''),
);
const poCurrencyOf = (partnerId: number | null): string =>
  adminRows.value.find((r) => r.partnerId === partnerId)?.currency ??
  assignCandidates.value.find((p) => p.partnerId === partnerId)?.defaultCurrency ??
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
    const nextAction = section?.querySelector<HTMLButtonElement>(
      '[data-pcb-rfq-reply], [data-pcb-rfq-assign]',
    );
    (selectButton ?? nextAction ?? section)?.focus({ preventScroll: true });
  });
}

async function openPoModal(): Promise<void> {
  if (rfqGate.value === 'closed') return;
  let selected = selectedPoRfq.value;
  // Case 진입 직후 RFQ 조회보다 발주 버튼이 먼저 보일 수 있다. 그 순간 빈 캐시를 근거로
  // "미배정" 안내를 만들면 곧 회신 행이 떠도 잘못된 안내·포커스가 남는다. 미선정 경로만
  // 한 번 동기화한 뒤 실제 현재 회차를 판정한다(선정 경로에는 추가 요청 없음).
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

// ── 발주 조건 수정 — 발행 뒤에도 결제조건·납기·메모를 고친다 ────────────────────
// 금액·환율은 서버가 issued 상태로만 허용하는 별도 규칙이라 여기서 다루지 않는다.
// 송금도 여기 없다 — 원장(sp_pcb_remittance)이 정본이고 [송금] 패널이 창구다(P3.11).
const patchPo = usePatchPcbPo();
const editPo = ref<AdminPcbPoViewType | null>(null);
const editTerms = ref('');
const editRemittanceDue = ref('');
const editDelivery = ref('');
const editMemo = ref('');
const editIsNet7 = computed(() => editTerms.value.trim() === PCB_PAYMENT_TERM_NET_7);
const editIsCustomPaymentDate = computed(
  () => editTerms.value.trim() === PCB_PAYMENT_TERM_CUSTOM_DATE,
);
const editRemittanceDuePreview = computed(() => {
  if (!editIsNet7.value) return editRemittanceDue.value;
  const issuedOn = kstDateOnly(editPo.value?.issuedAt) ?? kstToday();
  return addDateOnlyDays(issuedOn, 7);
});
const editCanSubmit = computed(
  () =>
    !patchPo.isPending.value &&
    (!editIsCustomPaymentDate.value || editRemittanceDue.value !== ''),
);

/** 송금 원장 패널 — 워크큐(송금 메뉴)와 같은 컴포넌트를 쓴다. */
const remittancePoId = ref<number | null>(null);
/** EQ 고객 확인 패널(P4.1) — 승인 전에 고객에게 물어보는 별도 축. */
const eqReviewPo = ref<AdminPcbPoViewType | null>(null);

// EQ 고객 확인 행 표시(P4.4) — 모달을 열지 않아도 "보냈는지·답했는지"가 보인다(사용자
// 결정). 버튼 하나가 상태를 입는다: 미요청 → 확인중(보냄) → 승인/반려. 판정·팔레트는
// lib/pcb-eq-review 공용(워크큐 배지와 같은 색으로 같은 상태를 말한다).
const eqReviewStateOf = (po: AdminPcbPoViewType): PcbEqReviewDisplay =>
  pcbEqReviewState(po.eqReview);
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

/** 제작 사양 수정(P4.2) — 저장하면 견적이 새로 발급되므로 상세를 다시 읽는다.
 *  타입 단언은 여기서 한다 — Vue 템플릿 안의 제네릭 `<...>` 은 파서가 태그로 오인한다. */
const editableSpec = computed<Record<string, string | number>>(() => detail.value?.spec ?? {});
const specEditOpen = ref(false);
const specEditSaved = (): void => {
  void detailQuery.refetch();
};

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

// ── D11 — EQ·생산 대행(협력사 포털 미온보딩 레거시 진행분 대비) ────────────────
const eqSubstitute = useAdminPcbEqSubstitute();
const uploadEqAdmin = useUploadAdminPcbEqFile();
const deleteEqAdmin = useDeleteAdminPcbEqFile();

const SUBSTITUTE_LABELS: Record<AdminPcbEqSubstituteAction, string> = {
  'eq-request': 'EQ 요청 대행',
  'production-start': '생산 시작 대행',
  'production-complete': '생산 완료 대행',
};
const substituteActionOf = (status: string): AdminPcbEqSubstituteAction | null =>
  status === 'issued'
    ? 'eq-request'
    : status === 'eq_done'
      ? 'production-start'
      : status === 'producing'
        ? 'production-complete'
        : null;

async function runSubstitute(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  const action = substituteActionOf(po.status);
  if (action === null) return;
  if (!(await confirmDialog(`${po.partnerName} 대신 [${SUBSTITUTE_LABELS[action]}]을 진행할까요? (이력에 관리자 대행으로 남습니다)`))) return;
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
      await uploadEqAdmin.mutateAsync({
        specId: specId.value ?? 0,
        poId: po.poId,
        file,
        fileType,
      });
    } catch (e) {
      surfaceError(e, '파일 업로드에 실패했습니다.');
    }
  };
  input.click();
}
async function removeEqFileAdmin(po: AdminPcbPoViewType, fileId: number): Promise<void> {
  if (specId.value === null) return;
  if (!(await confirmDialog({ message: '이 EQ 첨부를 삭제할까요?', confirmLabel: '삭제', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await deleteEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId, fileId });
  } catch (e) {
    surfaceError(e, '파일 삭제에 실패했습니다.');
  }
}
async function approvePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  // 고객 확인을 띄워 놓고도 답을 기다리지 않거나, 반려된 건을 그대로 승인해 버리는 사고를
  // 막는다. 서버는 막지 않는다 — 관리자 만능 대행(D11)이 원칙이라 여기서 되묻기만 한다.
  const state = eqReviewStateOf(po);
  const ask =
    state === 'rejected'
      ? `고객이 반려한 건입니다${po.eqReview?.decisionNote === null || po.eqReview?.decisionNote === undefined ? '' : `\n사유: ${po.eqReview.decisionNote}`}\n\n그래도 EQ 승인할까요?`
      : state === 'pending' || state === 'overdue'
        ? '고객 회신을 기다리는 중입니다.\n\n답을 기다리지 않고 EQ 승인할까요?'
        : null;
  if (ask !== null && !(await confirmDialog({ message: ask, confirmLabel: '그래도 승인', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await approveEq.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, 'EQ 승인에 실패했습니다.');
  }
}
// EQ 반려는 **사유와 수정지시 첨부를 함께** 받는다 — 전용 모달(PcbEqRejectModal).
// 값 하나만 받는 조작은 공용 UiPromptModal 을 쓰지만(P4.11), 여기는 파일을 여러 개 붙이고
// 이미 붙인 것을 빼야 해서 프롬프트로 표현되지 않는다.
// ⚠ 대상은 **id 로** 들고 목록에서 다시 찾는다 — 행 스냅샷을 잡아 두면 모달 안에서 첨부를
//   올려도 그 값이 갱신되지 않아 방금 올린 파일이 목록에 안 보인다.
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
    surfaceError(e, 'EQ 반려에 실패했습니다.');
  }
}
async function revertPo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!(await confirmDialog({ message: 'EQ 승인을 취소(한 단계 되돌리기)할까요?', confirmLabel: '되돌리기', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await revertEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}
async function removePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!(await confirmDialog({ message: `${po.partnerName} 발주서를 취소할까요? (발주접수 상태만 가능)`, confirmLabel: '발주 취소', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await deletePoMut.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '발주 취소에 실패했습니다.');
  }
}

const PO_STATUS_CLS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-700',
  eq_requested: 'bg-amber-100 text-amber-700',
  eq_done: 'bg-sky-100 text-sky-700',
  producing: 'bg-indigo-100 text-indigo-700',
  produced: 'bg-emerald-100 text-emerald-700',
};

// ── 선적 패널(P3) — 관리자는 받는측 + 양측 만능 대행(서버 isSideActor) ────────
const shipments = computed(() => posQuery.data.value?.data.shipments ?? []);
const shipmentByPo = computed(() => {
  const map = new Map<number, PcbShipmentViewType>();
  for (const s of shipments.value) for (const pid of s.poIds) map.set(pid, s);
  return map;
});
/**
 * 이 Case 안에서 발송 줄을 걸어 둘 발주서 — 원칙은 발송 대표(s.poId)다.
 *
 * 다만 묶음은 **고객(Case) 경계를 넘어** 합류한다(박스 키에 고객 축이 없다 —
 * 여정 9호). 대표가 남의 Case 의 발주서면 이 Case 엔 대표 행이 없어 선적 줄이
 * 통째로 사라졌다(2026-08-10 실측: 동반 건 Case 에 운송장·입고일·[입고 확인]이
 * 하나도 안 떴다 — 서버는 shipments 를 정상적으로 내려주고 있었다).
 * 그래서 대표가 이 Case 밖이면 **이 Case 가 가진 첫 구성원**이 대표를 대신 맡는다.
 * 서버는 어차피 발송을 구성원 어느 poId 로도 찾으므로(findPcbShipmentByPo) 액션은
 * 그대로 동작한다.
 */
const caseAnchorPoOf = (s: PcbShipmentViewType): number | null => {
  if (allPos.value.some((p) => p.poId === s.poId)) return s.poId;
  const mine = allPos.value.filter((p) => s.poIds.includes(p.poId));
  if (mine.length === 0) return null;
  // 최상위 발주를 먼저 고른다 — 하위(MD) 발주 행은 접힌 요약 줄이라 전이·입고 버튼이
  // 걸릴 자리가 아니다. 최상위가 없을 때만 하위로 내려간다.
  const top = mine.filter((p) => p.parentPartnerId === 0);
  return Math.min(...(top.length > 0 ? top : mine).map((p) => p.poId));
};
// 서브행 v-for 용 — Case 당 발송 1줄(묶음이어도 한 번만).
const shipRowsOf = (poId: number): PcbShipmentViewType[] => {
  const s = shipmentByPo.value.get(poId);
  if (s === undefined) return [];
  return caseAnchorPoOf(s) === poId ? [s] : [];
};
/** 묶음 구성 — 이 Case 것과 남의 Case 것을 갈라 보여준다(오조작 방지). */
const shipMatesOf = (s: PcbShipmentViewType): { poId: number; projectName: string; mine: boolean }[] =>
  s.groupPos.map((g) => ({
    poId: g.poId,
    projectName: g.projectName,
    mine: allPos.value.some((p) => p.poId === g.poId),
  }));

const shipAdvanceAdmin = useAdminPcbShipmentAdvance();
const shipBoxAdmin = useAdminPcbShipmentBox();
const shipRevertAdmin = useAdminPcbShipmentRevert();
const shipCancelAdmin = useAdminPcbShipmentCancel();

// 두 축 불일치 신호 — 주문 축(od_status)과 협력 축(RFQ→발주→선적)은 현재 서로를
// 게이트하지 않아, 발주 없이 배송되거나(레거시·수동 처리) 입고가 끝났는데 주문이
// 배송 전인 상태가 생긴다(Q40·Q20984 실측). 강제로 막을 수는 없다 — 이관 주문
// 19,665건이 협력 기록 없이 '완료'라서 게이트를 걸면 전부 막힌다. 대신 보이게 한다.
const axisMismatch = computed<'shipped-without-po' | 'received-not-delivered' | null>(() => {
  const order = detail.value?.order ?? null;
  if (order === null) return null;
  const delivered = order.odStatus === '배송' || order.odStatus === '완료';
  if (delivered && adminPos.value.length === 0) return 'shipped-without-po';
  const anyReceived = shipments.value.some((s) => s.receivedAt !== null);
  if (anyReceived && !delivered) return 'received-not-delivered';
  return null;
});

// [배송 처리](P4.6) — '배송 처리 대기' 배지를 액션으로: 입고 끝난 주문의 고객 발송을
// 이 자리에서 바로 연다(선적·배송 워크큐 고객 배송 탭과 같은 모달·같은 경로).
const customerShipOdId = ref<string | null>(null);
const customerShipAllReceived = computed(
  () =>
    adminPos.value.length > 0 &&
    adminPos.value.every((p) => {
      const s = shipmentByPo.value.get(p.poId);
      return s?.receiverKind === 'admin' && s.receivedAt !== null;
    }),
);
function openCustomerShip(): void {
  customerShipOdId.value = detail.value?.order?.odId ?? null;
}
// 직송 Case(정책 확정 08-10 · 판정 축 교정 08-11) — **입고된 발주**의 직송지다(배송 큐
// 서버 판정 directShipCountry 와 같은 규칙·같은 순수 함수). 이 배지가 여는 종결이 곧 그
// 입고 건의 종결이라 축이 같아야 한다 — 구 '최신 회차' 축은 원발주가 KR 로 입고 완료인
// Case 도 뒤에 선 A/S 회차의 직송지로 뒤집었다(여정 11호 X9). non-null 이면 관리자가 보낼
// 실물이 없으니 유도 배지는 '직송 완료 대기'가 되고, 운송장 모달 대신 완료 종결로 간다.
const caseDirectShipCountry = computed<string | null>(() =>
  resolvePcbDirectShipCountry(
    adminPos.value.flatMap((po) => {
      const s = shipmentByPo.value.get(po.poId);
      if (s?.receiverKind !== 'admin' || s.receivedAt === null) return [];
      return [po.destinationCountry];
    }),
  ),
);
const completeCustomerOrder = usePcbCompleteCustomerOrder();
async function completeDirectShip(): Promise<void> {
  const odId = detail.value?.order?.odId ?? null;
  const country = caseDirectShipCountry.value;
  if (odId === null || country === null) return;
  if (
    !(await confirmDialog(
      `직송 건 — 고객이 현지(${country})에서 수령했습니다. 주문을 완료로 종결합니다.`,
    ))
  ) {
    return;
  }
  actionError.value = '';
  try {
    await completeCustomerOrder.mutateAsync(odId);
  } catch (e) {
    surfaceError(e, '직송 완료 처리에 실패했습니다.');
  }
}
const shipReceiveAdmin = useAdminPcbShipmentReceive();

// 국내 종점(delivered)은 [입고 확인]이 상태까지 닫는다(서버 pcb-shipment.receivePcbShipment).
// 그래서 전이 버튼에서는 그 단계를 빼고, 대신 입고 확인을 한 단계 일찍 열어 준다.
const adminShipAdvanceLabel = (s: PcbShipmentViewType): string | null => {
  const next = bomShipmentNextStatus(s.mode, s.status);
  if (next === null || (s.mode === 'domestic' && next === 'delivered')) return null;
  // 직송 국제 체인은 '국내도착' 대신 '현지도착'(표시층 치환 — 상태 코드는 공유 그대로).
  return pcbShipmentStatusLabel(s.mode, next, {
    directShip: isPcbDirectShipIntl(s.destinationCountry),
  });
};
// 발송 시작(담기) — 생산완료인데 아직 어느 박스에도 안 담긴 발주. 원칙은 협력사 포털의
// [담기]지만, **연결 계정이 0인 조직은 누를 사람이 없다** — 그 발주는 관리자가 여기서
// 열어 주지 않으면 화면상 영영 시작되지 않는다(여정 12호 P5). 담기까지만 하고 멈추는
// 이유는 다음 단계의 필수값이 모드마다 다르고, 모드는 담아 봐야 정해지기 때문이다.
const canStartShipment = (po: AdminPcbPoViewType): boolean =>
  po.status === 'produced' && shipmentByPo.value.get(po.poId) === undefined;

async function startShipment(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (
    !(await confirmDialog(
      `${po.partnerName}의 발송을 시작할까요? 박스를 열어 두면 아래 선적 줄에서 다음 단계를 진행할 수 있습니다.`,
    ))
  )
    return;
  actionError.value = '';
  try {
    await shipBoxAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '발송을 시작하지 못했습니다.');
  }
}

// 납기 경과 — 발주 큐(AdminPcbPos)와 **같은 순수 함수**를 쓴다. KST 날짜로 넘겨야 한다:
// 납기는 KST 자정 앵커라 ISO 를 그냥 자르면 하루 앞당겨진다(utils kst-date 회귀).
const isPoOverdue = (po: AdminPcbPoViewType): boolean =>
  isPcbDeliveryOverdue(po.status, kstDateOnly(po.deliveryDate), kstToday());

// EQ 첨부는 **누적**이다 — 협력사가 같은 종류를 다시 올려도 이전 파일을 지우지 않는다
// (다층 보드처럼 여러 장 올리는 실무가 있고, 덮어쓰기는 되돌릴 수 없다). 그래서 기본은
// 종류별 최신만 펼쳐 두고 이전 회차는 접는다: 전부 늘어놓으면 관리자가 맨 앞 버튼
// (= 가장 오래된 것)을 눌러 **옛 도면을 보고 승인**한다(여정 22호). 최신 판정·정렬은
// 서버가 계약(orderPcbEqFiles)으로 이미 해서 내려 준다.
const eqHistoryOpen = ref<number[]>([]);
const toggleEqHistory = (poId: number): void => {
  eqHistoryOpen.value = eqHistoryOpen.value.includes(poId)
    ? eqHistoryOpen.value.filter((id) => id !== poId)
    : [...eqHistoryOpen.value, poId];
};
// 협력사 산출물(eq·working)과 관리자 회신(reply)은 **방향이 반대**라 한 줄에 섞지 않는다.
// 섞으면 "협력사가 올린 것"과 "우리가 보낸 것"을 색만으로 구분해야 하고, 승인 근거를 고를 때
// 위험하다. 아래 두 함수는 협력사 산출물 축만 본다.
const partnerEqFiles = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
  po.eqFiles.filter((f) => f.fileType !== 'reply');
const eqFilesShown = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
  eqHistoryOpen.value.includes(po.poId)
    ? partnerEqFiles(po)
    : partnerEqFiles(po).filter((f) => f.isLatest);
const eqOlderCount = (po: AdminPcbPoViewType): number =>
  partnerEqFiles(po).filter((f) => !f.isLatest).length;

// 관리자 회신 첨부 — 반려하며 돌려보내는 수정지시. 협력사는 못 지운다(서버가 막는다).
const replyFilesOf = (po: AdminPcbPoViewType): AdminPcbPoViewType['eqFiles'] =>
  po.eqFiles.filter((f) => f.fileType === 'reply');

// 반려 뒤 보완 — 첨부는 승인요청 뒤 잠기므로(EQ_LOCKED) 보완 파일은 반드시 반려와 재요청
// **사이**에 올라온다. 그 구간이 비어 있는데 다시 승인요청이 와 있으면 협력사가 **같은
// 도면으로 재요청**한 것이다. 승인 버튼 옆에서 말해 주지 않으면 관리자는 "보완됐겠지" 하고
// 누른다 — 반려 사유가 반영되지 않은 채 생산으로 넘어간다.
// 직전 반려(시각+사유) — 상태 칸이 "돌려보낸 건"임을 말하고 사유를 그대로 보여 준다.
// 데이터는 상세 응답의 eqHistory 에 이미 있다(추가 조회 없음). 판정은 계약 순수 함수.
const poRejection = (po: AdminPcbPoViewType): PcbEqRejection | null =>
  lastPcbEqRejection(po.eqHistory);

const eqUnfixedAfterReject = (po: AdminPcbPoViewType): boolean =>
  po.status === 'eq_requested' &&
  lastPcbEqRejectedAt(po.eqHistory) !== null &&
  !po.eqFiles.some((f) => f.afterReject);

const canAdminReceive = (s: PcbShipmentViewType): boolean => {
  if (s.receivedAt !== null || s.receiverKind !== 'admin') return false;
  return s.mode === 'domestic'
    ? s.status === 'shipping' // 배송 중이면 실물이 왔을 수 있다 — 검수 즉시 입고 완료로
    : bomShipmentNextStatus(s.mode, s.status) === null;
};

// 선적 전이의 필수값은 단계마다 다르다 — 택배사·송장처럼 둘을 받아야 하는 단계는 prompt
// 로는 창을 두 번 띄워야 했고 두 번째에서 취소하면 첫 입력이 사라졌다. 한 모달에서 받는다.
const shipPromptFieldsOf = (next: BomShipmentStatusType): PromptField[] => {
  if (next === 'requested') {
    return [
      {
        name: 'shipDate',
        label: '출고예정일',
        type: 'date',
        required: true,
        hint: '선적 요청에는 Invoice 첨부도 필요합니다.',
      },
    ];
  }
  if (next === 'shipping') {
    return [
      { name: 'carrier', label: '택배사', required: true, placeholder: '예) CJ대한통운' },
      { name: 'trackingNumber', label: '송장번호', required: true },
    ];
  }
  if (next === 'shipped') {
    return [{ name: 'trackingNumber', label: '트래킹 번호(AWB/BL)', required: true }];
  }
  return [];
};
const shipPrompt = ref<{
  poId: number;
  next: BomShipmentStatusType;
  mode: PcbShipmentViewType['mode'];
  /** 직송 국제 체인 — 모달 제목의 상태 라벨 치환('국내도착'→'현지도착'). */
  directShip: boolean;
} | null>(null);

async function runShipAdvance(poId: number, body: PcbShipmentAdvanceBodyType): Promise<void> {
  if (specId.value === null) return;
  actionError.value = '';
  try {
    await shipAdvanceAdmin.mutateAsync({ specId: specId.value, poId, body });
    shipPrompt.value = null;
  } catch (e) {
    surfaceError(e, '선적 진행에 실패했습니다.');
  }
}
async function adminShipAdvance(poId: number, s: PcbShipmentViewType): Promise<void> {
  const next = bomShipmentNextStatus(s.mode, s.status);
  if (next === null) return;
  // 입력이 필요 없는 단계(국내도착/현지도착·통관·완료 등)는 그대로 진행한다.
  if (shipPromptFieldsOf(next).length === 0) {
    await runShipAdvance(poId, {});
    return;
  }
  shipPrompt.value = {
    poId,
    next,
    mode: s.mode,
    directShip: isPcbDirectShipIntl(s.destinationCountry),
  };
}
async function submitShipPrompt(values: Record<string, string>): Promise<void> {
  const target = shipPrompt.value;
  if (target === null) return;
  const body: PcbShipmentAdvanceBodyType = {
    ...(values.shipDate === undefined || values.shipDate === '' ? {} : { shipDate: values.shipDate }),
    ...(values.carrier === undefined || values.carrier === '' ? {} : { carrier: values.carrier }),
    ...(values.trackingNumber === undefined || values.trackingNumber === ''
      ? {}
      : { trackingNumber: values.trackingNumber }),
  };
  await runShipAdvance(target.poId, body);
}
async function adminShipRevert(poId: number): Promise<void> {
  if (specId.value === null) return;
  if (!(await confirmDialog({ message: '선적을 한 단계 되돌릴까요?', confirmLabel: '되돌리기', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await shipRevertAdmin.mutateAsync({ specId: specId.value, poId });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}
// 선적 취소 — 문서 자체를 삭제한다(묶음이면 통째로). 발송 전·입고 전만 서버가 허용.
async function adminShipCancel(poId: number, s: PcbShipmentViewType): Promise<void> {
  if (specId.value === null) return;
  const extra =
    s.poIds.length > 1 ? `\n묶인 발주서 ${String(s.poIds.length)}건이 함께 취소됩니다.` : '';
  if (!(await confirmDialog({ message: `선적을 취소(삭제)할까요? 첨부도 함께 지워집니다.${extra}`, confirmLabel: '선적 취소', tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await shipCancelAdmin.mutateAsync({ specId: specId.value, poId });
  } catch (e) {
    surfaceError(e, '선적 취소에 실패했습니다.');
  }
}
// 입고 확인 — 국내는 이 조작이 상태(입고 완료)까지 닫으므로 무엇이 함께 일어나는지 밝힌다.
const receivePrompt = ref<{ poId: number; domestic: boolean; mates: number } | null>(null);
// 묶음 입고는 **한 번 눌러 여러 주문**이 배송 대기로 넘어간다(고객이 서로 달라도 —
// 여정 9호). 되돌리기 쉬운 조작이 아니라, 파급 범위를 확인 문구에 적어 둔다.
const receiveDescription = computed(() => {
  const p = receivePrompt.value;
  if (p === null) return '';
  const base =
    p.domestic
      ? '실물 검수를 기록하고 발송을 입고 완료로 닫습니다 — 고객 배송 처리가 열립니다.'
      : '실물 검수를 기록합니다 — 이후 고객 배송 처리가 열립니다.';
  return p.mates > 1
    ? `${base} 이 발송은 묶음 ${String(p.mates)}건이라, 함께 담긴 발주서의 주문(다른 고객일 수 있습니다)도 같이 배송 대기로 넘어갑니다.`
    : base;
});
async function submitReceive(values: Record<string, string>): Promise<void> {
  const target = receivePrompt.value;
  if (specId.value === null || target === null) return;
  const note = values.note ?? '';
  actionError.value = '';
  try {
    await shipReceiveAdmin.mutateAsync({
      specId: specId.value,
      poId: target.poId,
      note: note === '' ? null : note,
    });
    receivePrompt.value = null;
  } catch (e) {
    surfaceError(e, '입고 확인에 실패했습니다.');
  }
}

// 상업송장 모달 — 대표 발주 기준 콜백 주입.
const invoicePoId = ref<number | null>(null);
const adminInvoiceApiRef = computed(() =>
  invoicePoId.value === null || specId.value === null
    ? null
    : adminPcbInvoiceApi(specId.value, invoicePoId.value),
);

const SHIP_STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};
const dateOnly = (iso: string | null): string => fmtKstDate(iso);
/** 환산 시점 꼬리표 — 같은 외화 금액이 한 화면에 **서로 다른 KRW** 로 두 번 뜬다
 *  (선정 ₩420,000 @1400 / 발주 ₩414,000 @1380). 박제 시점이 다르기 때문인데 그 말이
 *  없으면 "어느 게 맞느냐"가 매번 질문이 된다(재점검 08-11 확정 #16). */
const rateNote = (
  currency: string,
  krwAmount: number | null,
  exchangeRate: number | null,
  when: string,
): string =>
  currency !== 'KRW' && krwAmount !== null && exchangeRate !== null
    ? ` @${String(exchangeRate)} ${when}`
    : '';
// 납기 신호(레거시 승계) — 제시≠회신이면 '변경', 회신일이 과거면 경고.
// 비교도 KST 날짜로 — UTC 슬라이스는 KST 00~09시에 '지난 날짜'를 오판한다.
const deliverySignal = (row: AdminPcbRfqViewType): { label: string; cls: string } | null => {
  const quoted = kstDateOnly(row.quotedDeliveryDate);
  if (quoted === null) return null;
  if (quoted < kstToday()) return { label: '지난 날짜', cls: 'bg-red-100 text-red-700' };
  if (row.suggestedDeliveryDate !== null) {
    const suggested = kstDateOnly(row.suggestedDeliveryDate) ?? quoted;
    if (suggested !== quoted) {
      const days = Math.round(
        (Date.parse(quoted) - Date.parse(suggested)) / 86_400_000,
      );
      return {
        label: `변경 ${days > 0 ? '+' : ''}${String(days)}일`,
        cls: 'bg-amber-100 text-amber-700',
      };
    }
  }
  return null;
};
const editableRow = (row: AdminPcbRfqViewType): boolean =>
  row.status === 'requested' || row.status === 'quoted';
</script>

<template>
  <div class="pcb-readable space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: backTarget.name }"
        class="text-sm text-gray-400 hover:text-gray-700"
      >
        ← {{ backTarget.label }}
      </RouterLink>
      <h1 class="text-xl font-bold">
        <span class="font-mono text-base text-gray-400">Q{{ specId }}</span>
        {{ detail?.projectName ?? '' }}
      </h1>
      <span
        v-if="detail !== null"
        class="rounded px-2 py-0.5 text-xs font-semibold"
        :class="QUOTE_LABEL[detail.quoteStatus]?.cls"
      >
        {{ QUOTE_LABEL[detail.quoteStatus]?.label }}
      </span>
      <span v-if="detail !== null && detail.cartState === 'cart'" class="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
        장바구니 담김
      </span>
      <span v-if="detail !== null && detail.order !== null" class="rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
        주문됨 · {{ detail.order.odStatus }}
      </span>
      <span v-if="detail !== null && detail.order !== null && rfqGate === 'ok'" class="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
        원가 소싱 모드 — 판매가 불변
      </span>
      <!-- 두 축 불일치 — 주문(od)과 협력 트랙은 서로를 게이트하지 않는다(D6 자동 동기는 P4).
           강제로 막지 않는 대신, 어긋난 상태를 눈에 보이게 한다. -->
      <span
        v-if="axisMismatch === 'shipped-without-po'"
        class="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700"
        title="주문은 배송·완료까지 갔는데 협력사 발주 기록이 없습니다(레거시·수동 처리 건일 수 있습니다)"
      >
        협력 발주 없이 진행된 주문
      </span>
      <!-- 직송 건은 관리자가 보낼 실물이 없다 — 유도 문구·액션이 [직송 완료](운송장 없이
           완료 종결)로 바뀐다(정책 확정 08-10). 판정은 **입고된 발주**의 직송지(교정 08-11). -->
      <button
        v-else-if="axisMismatch === 'received-not-delivered' && caseDirectShipCountry !== null"
        type="button"
        class="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-200"
        :title="`직송(${caseDirectShipCountry}) 건 — 실물은 주문지로 직송됐습니다. 운송장 없이 완료로 종결하세요`"
        @click="void completeDirectShip()"
      >
        직송 완료 대기 · 직송 완료 →
      </button>
      <button
        v-else-if="axisMismatch === 'received-not-delivered'"
        type="button"
        class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-200"
        title="입고가 끝났는데 고객 주문 상태가 아직 배송 전입니다 — 운송장을 입력해 배송 처리하세요"
        @click="openCustomerShip"
      >
        배송 처리 대기 · 배송 처리 →
      </button>
      <!-- 견적서 — 위험 버튼(삭제) 왼쪽에 중립 색으로 세워 둘이 시각적으로 갈리게 한다.
           확정 전이어도 자리를 지킨다(비활성 + 사유 툴팁). 발송 상태·행동은 여기가 아니라
           '고객 견적' 카드의 ①→② 흐름이 맡는다(헤더는 Case 전체를 말하는 자리다). -->
      <button
        v-if="specId !== null"
        type="button"
        class="ml-auto rounded-md border border-blue-300 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
        :disabled="!estimateEnabled"
        :title="estimateBlockedReason"
        @click="estimateProjectId = specId"
      >
        견적서
      </button>
      <!-- 영구 삭제 — 차단을 푸는 곳(발주 취소·선적 취소)이 바로 이 화면이라, 정리하고
           곧장 지울 수 있게 둔다. 모달·판정은 견적 관리와 같은 것을 쓴다(창구만 둘). -->
      <button
        v-if="specId !== null"
        type="button"
        class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        @click="deleteOpen = true"
      >
        견적 삭제
      </button>
    </div>

    <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {{ actionError }}
    </p>

    <AdminCaseCustomerCard v-if="detail !== null" :customer="detail.customer" />

    <div v-if="detail !== null" class="grid gap-4 lg:grid-cols-3">
      <!-- 스펙 요약 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4 lg:col-span-2">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
          <!-- 사양 수정(P4.2) — 저장하면 서버가 재견적까지 한다. 발주된 건은 서버가 409. -->
          <button
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="specEditOpen = true"
          >
            사양 수정
          </button>
        </div>
        <!-- 제품군은 배지로 — 뒤의 샘플/양산과 나란히 회색 텍스트로 흘리면 둘 다 "분류"로
             읽혀 갈리지 않는다. 두 값은 축이 다르다: 앞은 제품 종류(공정·단가), 뒤는 주문
             성격(양산은 자동가를 내지 않는다). 사전은 목록(RFQ 워크큐)과 같은 것. -->
        <p class="mt-1 text-sm text-gray-500">
          <span
            class="mr-1 rounded px-1.5 py-0.5 text-xs font-semibold"
            :class="pcbCategoryBadge(detail.category).cls"
          >
            {{ pcbCategoryBadge(detail.category).label }}
          </span>
          {{ detail.orderCategory === 'mass' ? '양산' : '샘플' }} · {{ detail.qty }}매
        </p>
        <p class="mt-1 text-xs text-gray-400">{{ detail.optionSummary }}</p>
        <div v-if="gerberFiles.length > 0" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="f in gerberFiles"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadAdminFile(f.fileId, f.originFileName)"
          >
            ⬇ {{ f.originFileName }}
          </button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
            <dt class="text-gray-400">{{ entry.label }}</dt>
            <dd class="truncate font-medium text-gray-700">{{ entry.value }}</dd>
          </div>
        </dl>
        <p v-if="detail.message !== null && detail.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.message }}
        </p>
      </section>

      <!-- 고객 견적(확정가) -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">고객 견적</h2>
        <dl class="mt-2 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <dt class="text-gray-500">자동견적 총액 <span class="text-[11px] text-gray-400">(VAT 포함)</span></dt>
            <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.quote?.autoPrice ?? null) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">확정 총액 <span class="text-[11px] text-gray-400">(VAT 포함)</span></dt>
            <dd class="font-bold tabular-nums" :class="detail.finalPrice === null ? 'text-gray-300' : 'text-emerald-700'">
              {{ fmtPcbAmount('KRW', detail.finalPrice) }}
            </dd>
          </div>
          <div v-if="detail.priceAmounts !== null" class="!mt-2 space-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs">
            <div class="flex justify-between">
              <dt class="text-emerald-700">공급가액</dt>
              <dd class="font-medium tabular-nums text-emerald-900">{{ fmtPcbAmount('KRW', detail.priceAmounts.supply) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-emerald-700">부가세</dt>
              <dd class="font-medium tabular-nums text-emerald-900">{{ fmtPcbAmount('KRW', detail.priceAmounts.vat) }}</dd>
            </div>
            <p class="pt-0.5 text-[11px] text-emerald-600">
              {{ detail.finalPrice !== null ? '확정가' : '자동견적가' }} 기준 고객 결제예정액
            </p>
          </div>
          <div v-if="selectedRow !== null" class="flex justify-between">
            <dt class="text-gray-500">선정 원가</dt>
            <dd class="tabular-nums text-gray-700">
              {{ pcbMoneyWithSub(selectedRow.currency, selectedRow.priceOriginal, selectedRow.subCurrency, selectedRow.subPriceOriginal) }}{{ pcbKrwSuffix(selectedRow.currency, selectedRow.krwAmount) }}<span class="text-[11px] text-gray-400">{{ rateNote(selectedRow.currency, selectedRow.krwAmount, selectedRow.exchangeRate, '선정 시점') }}</span>
            </dd>
          </div>
        </dl>
        <!-- ① 확정 ─▸ ② 발송 — 견적 관리 드로어와 같은 흐름 UI(화면 언어 통일).
             확정가만 등록하고 끝내면 **고객은 아무것도 모른다**(자동 발송 없음). 두 칸을
             연결선으로 이어 "확정하고 보낸다"를 한 줄로 만든다. 상태와 행동이 같은 자리에
             있어야 같은 건을 두 번 보내지도, 보낸 걸 또 찾아보지도 않는다. -->
        <div class="mt-3 border-t border-gray-100 pt-3">
          <div class="flex items-center justify-between text-xs font-semibold">
            <span class="flex items-center gap-1.5 text-gray-500">
              <span
                class="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                :class="detail.finalPrice === null ? 'bg-gray-300' : 'bg-emerald-500'"
              >1</span>
              확정가
            </span>
            <span
              class="flex items-center gap-1.5"
              :class="estimateEnabled ? 'text-gray-500' : 'text-gray-300'"
            >
              <span
                class="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                :class="estimateSent ? 'bg-emerald-500' : estimateEnabled ? 'bg-blue-500' : 'bg-gray-300'"
              >2</span>
              견적서 발송
            </span>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <!-- ① 확정가(판매가)는 주문 후 불변 — 주문된 건에선 버튼 대신 금액만 남는다(D10). -->
            <button
              v-if="detail.order === null"
              type="button"
              class="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              :disabled="detail.cartState !== 'none' || detail.status !== 'active'"
              @click="openPriceModal"
            >
              {{ detail.finalPrice === null ? '확정가 등록' : '확정가 수정' }}
            </button>
            <span v-else class="shrink-0 text-sm font-semibold text-gray-700">
              {{ fmtPcbAmount('KRW', detail.finalPrice) }}
            </span>
            <span class="min-w-3 flex-1 border-t border-dashed border-gray-300" />
            <!-- ② 발송 — 누르면 견적서가 열리고, 수신자를 확인한 뒤 그 안에서 보낸다.
                 (클릭 즉시 발송이 아니다 — 받는 사람을 눈으로 보고 보내는 편이 안전하다.) -->
            <div class="flex shrink-0 items-center gap-1.5">
              <span class="text-xs font-semibold" :class="estimateSendState.cls" :title="estimateSendState.title">
                {{ estimateSendState.label }}
              </span>
              <button
                type="button"
                class="rounded-md border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
                :disabled="!estimateEnabled"
                :title="estimateEnabled ? '견적서를 열어 수신자를 확인하고 발송합니다' : estimateBlockedReason"
                @click="estimateProjectId = specId"
              >
                {{ estimateSent ? '다시 보내기' : '보내기' }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="detail.order === null" class="mt-1.5 text-[11px] leading-4 text-gray-400">
          확정가를 등록해야 고객이 주문할 수 있습니다(견적 확정). 협력사 [선정] 모달에서
          마진을 더해 함께 등록할 수 있고, 여기서는 등록된 확정가를 수정합니다.
        </p>
        <p v-else class="mt-1.5 text-[11px] leading-4 text-gray-400">
          주문이 성립된 건 — 판매가(확정가)는 변경하지 않습니다. 협력사 선정은 원가 회계에만
          반영됩니다.
        </p>

        <!-- 주문 정보(P3.5) — od read-only 파생. 레거시 이관 주문 이력 열람의 정위치. -->
        <div v-if="detail.order !== null" class="mt-4 border-t border-gray-100 pt-3">
          <h3 class="text-xs font-bold uppercase text-gray-400">주문 정보</h3>
          <dl class="mt-2 space-y-1.5 text-sm">
            <div class="flex justify-between">
              <dt class="text-gray-500">주문번호</dt>
              <dd class="text-right">
                <span class="block font-mono text-xs text-gray-600">{{ detail.order.odId }}</span>
                <span class="text-[11px] font-semibold text-blue-600">PCB {{ detail.order.orderPcbCount }}건 포함</span>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">상태</dt>
              <dd
                class="font-semibold"
                :class="CANCELED_ORDER_ITEM_STATUSES.has(detail.order.ctStatus) || detail.order.odStatus === '취소'
                  ? 'text-gray-500'
                  : detail.order.isPaid ? 'text-emerald-700' : 'text-amber-600'"
              >
                {{ orderDisplayStatus }}<span v-if="orderDisplayStatus === '주문'"> (입금 대기)</span>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">이 PCB 주문금액</dt>
              <dd class="tabular-nums font-semibold text-gray-900">{{ fmtPcbAmount('KRW', detail.order.lineAmount) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">주문 전체 결제대상</dt>
              <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.orderPrice) }}</dd>
            </div>
            <div class="!mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <div class="flex justify-between">
                <dt class="text-gray-500">공급가액</dt>
                <dd class="tabular-nums text-gray-700">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.supply) }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-gray-500">부가세</dt>
                <dd class="tabular-nums text-gray-700">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.vat) }}</dd>
              </div>
              <div v-if="detail.order.taxAmounts.taxFree > 0" class="flex justify-between">
                <dt class="text-gray-500">비과세액</dt>
                <dd class="tabular-nums text-gray-700">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.taxFree) }}</dd>
              </div>
              <p class="pt-0.5 text-[11px] text-gray-400">주문 전체에 저장된 영카트 실제 세액 기준</p>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">주문 전체 현금수납</dt>
              <dd class="tabular-nums" :class="detail.order.receiptPrice > 0 ? 'text-emerald-700' : 'text-gray-400'">
                {{ fmtPcbAmount('KRW', detail.order.receiptPrice) }}
              </dd>
            </div>
            <div v-if="detail.order.receiptPoint !== 0" class="flex justify-between">
              <dt class="text-gray-500">사용 포인트</dt>
              <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.receiptPoint) }}</dd>
            </div>
            <div v-if="detail.order.refundPrice !== 0" class="flex justify-between">
              <dt class="text-gray-500">환불 누계</dt>
              <dd class="tabular-nums text-red-600">-{{ fmtPcbAmount('KRW', detail.order.refundPrice) }}</dd>
            </div>
            <div v-if="detail.order.receiptPoint !== 0 || detail.order.refundPrice !== 0" class="flex justify-between border-t border-gray-100 pt-1">
              <dt class="font-semibold text-gray-600">순결제액</dt>
              <dd class="tabular-nums font-semibold text-emerald-700">{{ fmtPcbAmount('KRW', detail.order.netReceipt) }}</dd>
            </div>
            <div v-if="detail.order.misu !== 0" class="flex justify-between">
              <dt class="font-semibold" :class="detail.order.misu > 0 ? 'text-red-600' : 'text-amber-600'">
                {{ detail.order.misu > 0 ? '미수금' : '과입금' }}
              </dt>
              <dd class="tabular-nums font-semibold" :class="detail.order.misu > 0 ? 'text-red-600' : 'text-amber-600'">
                {{ fmtPcbAmount('KRW', Math.abs(detail.order.misu)) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">결제수단 / 주문일</dt>
              <dd class="text-gray-600">{{ detail.order.settleCase || '—' }} · {{ fmtKstDate(detail.order.orderedAt) }}</dd>
            </div>
          </dl>
          <!-- 미입금이면 여기서 바로 처리 — 아래 발주 패널이 결제 게이트(NOT_PAID)로 막히기 때문. -->
          <div v-if="canConfirmReceipt || canReviewOrderCancel" class="mt-3 flex gap-2">
            <button
              v-if="canConfirmReceipt"
              type="button"
              class="min-w-0 flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="receipt.isPending.value"
              @click="void confirmReceipt()"
            >
              입금확인
            </button>
            <button
              v-if="canReviewOrderCancel"
              type="button"
              class="min-w-0 flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
              @click="cancelOrderOpen = true"
            >
              주문 취소
            </button>
          </div>
          <p v-else-if="!detail.order.isPaid" class="mt-2 text-[11px] leading-4 text-amber-600">
            미입금 주문입니다 — 무통장 외 결제수단은 통합 관리 주문내역에서 처리하세요.
          </p>
        </div>
      </section>
    </div>

    <!-- RFQ 패널 — 무관 파트 진입 시 한 줄 접힘(§6.12 미러) -->
    <button
      v-if="detail !== null && collapsed.has('rfq')"
      type="button"
      class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      @click="expandSection('rfq')"
    >
      <span>▸ 협력사 견적요청 ({{ adminRows.length }}곳)</span>
      <span class="text-xs text-gray-400">펼치기</span>
    </button>
    <section
      v-else
      ref="rfqSectionEl"
      tabindex="-1"
      class="scroll-mt-4 rounded-xl border border-gray-200 bg-surface focus:outline-none"
    >
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2 class="text-sm font-bold text-gray-700">
          협력사 견적요청
          <span class="ml-1 text-xs font-normal text-gray-400">{{ adminRows.length }}곳</span>
        </h2>
        <button
          data-pcb-rfq-assign
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="rfqGate !== 'ok'"
          :title="rfqGate === 'ok' ? '' : RFQ_GATE_NOTES[rfqGate]"
          @click="openAssign"
        >
          협력사 견적요청 {{ adminRows.length > 0 ? '변경' : '보내기' }}
        </button>
      </div>
      <p
        v-if="poSelectionGuide !== ''"
        role="alert"
        class="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700"
      >
        {{ poSelectionGuide }}
      </p>
      <p v-if="rfqGate !== 'ok'" class="border-b border-gray-50 px-4 py-2 text-xs font-semibold text-amber-600">
        {{ RFQ_GATE_NOTES[rfqGate] }}
      </p>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2">협력사</th>
              <th class="px-4 py-2">상태</th>
              <th class="whitespace-nowrap px-4 py-2">회신 견적가</th>
              <th class="whitespace-nowrap px-4 py-2">납기(제시 → 회신)</th>
              <th class="px-4 py-2">메모</th>
              <th class="whitespace-nowrap px-4 py-2">회신일</th>
              <th class="px-4 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <template v-for="row in adminRows.filter(inLatestRound)" :key="row.rfqId">
              <tr :class="row.status === 'selected' ? 'bg-violet-50/40' : ''">
                <td class="px-4 py-2.5">
                  <p class="font-medium text-gray-900">
                    {{ row.partnerName }}
                    <span v-if="row.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-semibold text-rose-700">
                      {{ row.reorderRound }}차
                    </span>
                  </p>
                  <p v-if="row.childCount > 0" class="text-[11px] text-indigo-600">
                    MD 경유 · 하위 {{ row.childQuotedCount }}/{{ row.childCount }} 회신
                    <span v-if="row.marginRate !== null"> · 마진 {{ row.marginRate }}%</span>
                  </p>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.status]">
                    {{ PCB_RFQ_STATUS_LABELS[row.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {{ pcbMoneyWithSub(row.currency, row.priceOriginal, row.subCurrency, row.subPriceOriginal) }}
                  <span class="text-xs text-gray-400">
                    {{ pcbKrwSuffix(row.currency, row.krwAmount) }}{{ rateNote(row.currency, row.krwAmount, row.exchangeRate, '선정 시점') }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
                  {{ dateOnly(row.suggestedDeliveryDate) }} → {{ dateOnly(row.quotedDeliveryDate) }}
                  <span
                    v-if="deliverySignal(row) !== null"
                    class="ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    :class="deliverySignal(row)?.cls"
                  >
                    {{ deliverySignal(row)?.label }}
                  </span>
                </td>
                <td class="max-w-[16rem] truncate px-4 py-2.5 text-xs text-gray-500" :title="row.memo ?? ''">
                  {{ row.memo ?? '—' }}
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-400">{{ dateOnly(row.respondedAt) }}</td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  <button
                    v-if="editableRow(row)"
                    data-pcb-rfq-reply
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                    @click="replyTarget = row"
                  >
                    대리 회신
                  </button>
                  <button
                    v-if="row.status === 'quoted'"
                    data-pcb-rfq-select
                    type="button"
                    class="mr-1 rounded-md bg-violet-600 px-2 py-1 font-semibold text-white hover:bg-violet-700"
                    @click="openSelect(row)"
                  >
                    선정
                  </button>
                  <button
                    v-if="row.status === 'selected'"
                    type="button"
                    class="mr-1 rounded-md border border-violet-300 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50"
                    @click="void submitUnselect(row)"
                  >
                    선정 해제
                  </button>
                  <button
                    v-if="row.magicToken !== null"
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                    :title="'무로그인 회신 링크 복사'"
                    @click="void copyMagicLink(row)"
                  >
                    {{ copiedRfqId === row.rfqId ? '복사됨!' : '링크 복사' }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
                    title="매직링크 재발급(기존 링크 무효화)"
                    @click="void reissueMagicLink(row)"
                  >
                    재발급
                  </button>
                </td>
              </tr>
              <!-- MD 하위 트랙(읽기전용 — 조작은 MD 포털 몫) -->
              <tr v-if="childrenOf(row.partnerId).length > 0">
                <td colspan="7" class="bg-indigo-50/30 px-8 py-2">
                  <p class="text-[11px] font-semibold text-indigo-500">하위 협력사 회신(MD {{ row.partnerName }} 경유)</p>
                  <div class="mt-1 grid gap-1">
                    <div
                      v-for="child in childrenOf(row.partnerId)"
                      :key="child.rfqId"
                      class="flex flex-wrap items-center gap-2 text-xs text-gray-600"
                    >
                      <span class="rounded px-1.5 py-0.5 font-semibold" :class="STATUS_CLS[child.status]">
                        {{ PCB_RFQ_STATUS_LABELS[child.status] }}
                      </span>
                      <span class="font-medium">{{ child.partnerName }}</span>
                      <span class="tabular-nums">
                        {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                      </span>
                      <span class="text-gray-400">납기 {{ dateOnly(child.quotedDeliveryDate) }}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="adminRows.length === 0">
              <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400">
                아직 배정된 협력사가 없습니다 — [협력사 견적요청 보내기]로 시작하세요.
              </td>
            </tr>
            <!-- 이전 회차(A/S 재발주) — 지나간 흔적은 지우지 않고 접어 둔다.
                 카운트는 발주·견적 합산이라 라벨에 축을 명시한다(발주서 섹션에도 같은 토글). -->
            <tr v-if="olderRoundCount > 0">
              <td colspan="7" class="px-4 py-2">
                <button
                  type="button"
                  class="text-xs font-semibold text-gray-400 hover:text-gray-700"
                  @click="roundsExpanded = !roundsExpanded"
                >
                  {{ roundsExpanded ? '▾ 이전 회차 접기' : `▸ 이전 회차 발주·견적 ${String(olderRoundCount)}건 보기` }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 발주 패널(P2) — 결제(paid) 후 발행, EQ 승인/반려는 관리자 몫 -->
    <button
      v-if="detail !== null && collapsed.has('po')"
      type="button"
      class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      @click="expandSection('po')"
    >
      <span>▸ 발주서 · EQ ({{ adminPos.length }}건)</span>
      <span class="text-xs text-gray-400">펼치기</span>
    </button>
    <section v-else class="rounded-xl border border-gray-200 bg-surface">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2 class="text-sm font-bold text-gray-700">
          발주서 · EQ
          <span class="ml-1 text-xs font-normal text-gray-400">
            {{ adminPos.length }}건<template v-if="olderRoundsCollapsed"> (현재 회차 {{ latestPoCount }}건 · 이전 회차 접힘)</template>
          </span>
        </h2>
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          :class="rfqsQuery.isPending.value
            ? 'bg-gray-300'
            : selectedPoRfq === null
              ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-emerald-600 hover:bg-emerald-700'"
          :disabled="rfqGate === 'closed' || rfqsQuery.isPending.value"
          :title="rfqGate === 'closed'
            ? '완료·취소된 PCB 주문에는 발주서를 발행할 수 없습니다.'
            : rfqsQuery.isPending.value
              ? '협력사 선정 상태를 확인하는 중입니다.'
              : selectedPoRfq === null
                ? '발주 전에 협력사 선정이 필요합니다.'
                : '선정된 협력사로 발주서를 발행합니다.'"
          @click="void openPoModal()"
        >
          {{ rfqsQuery.isPending.value ? '협력사 확인 중' : selectedPoRfq === null ? '협력사 선정 필요' : '발주서 발행' }}
        </button>
      </div>
      <p class="border-b border-gray-50 px-4 py-2 text-xs text-gray-400">
        발행은 고객 결제(입금 확인) 후에만 가능합니다. 진행:
        발주접수(EQ 선택·Working 업로드 권장) → EQ 승인요청 → (필요하면 <b>고객 확인</b>) →
        <b>EQ 승인(관리자)</b> → 생산시작 → 생산완료.
      </p>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2">협력사</th>
              <th class="px-4 py-2">상태</th>
              <th class="whitespace-nowrap px-4 py-2">발주가</th>
              <th class="whitespace-nowrap px-4 py-2">조건/송금</th>
              <th class="whitespace-nowrap px-4 py-2">납기</th>
              <th class="px-4 py-2">EQ 첨부</th>
              <th class="px-4 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <template v-for="po in adminPos.filter(inLatestRound)" :key="po.poId">
              <tr :class="po.status === 'eq_requested' ? 'bg-amber-50/40' : ''">
                <!-- 협력사 이름은 줄바꿈 금지 — 옆 칸의 긴 결제조건 문자열이 폭을 다 가져가
                     이 칸이 0폭으로 붕괴하면(한 글자씩 세로) 누구에게 주는 발주인지 못 읽는다 -->
                <td class="whitespace-nowrap px-4 py-2.5">
                  <p class="font-medium text-gray-900">
                    {{ po.partnerName }}
                    <span v-if="po.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-semibold text-rose-700">
                      {{ po.reorderRound }}차
                    </span>
                  </p>
                  <p v-if="po.eqDelegatePoId !== null" class="text-[11px] text-indigo-600">MD 경유 — EQ는 하위에서 진행(자동 반영)</p>
                  <p v-else-if="po.eqBlocked" class="text-[11px] text-amber-600">MD 하위 발주 대기 — 발주되면 EQ 시작</p>
                  <!-- 계정 없는 조직 — 기다려도 오지 않는다. 대행이 필요하다는 신호를
                       버튼 옆이 아니라 이름 밑에 둔다(어느 줄이 대행 몫인지부터 읽혀야 한다). -->
                  <p
                    v-if="!po.partnerHasPortal"
                    class="text-[11px] font-semibold text-teal-600"
                    title="이 조직에는 포털 연결 계정이 없습니다 — EQ·생산·선적을 관리자가 대행해야 진행됩니다(견적 회신은 매직링크로 협력사가 직접 합니다)."
                  >
                    포털 계정 없음 — 대행 필요
                  </p>
                </td>
                <td class="px-4 py-2.5">
                  <span class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold" :class="PO_STATUS_CLS[po.status]">
                    {{ PCB_PO_STATUS_LABELS[po.status] }}
                  </span>
                  <!-- 반려하면 상태가 issued 로 돌아가 화면엔 '발주접수'만 남는다 — 방금
                       돌려보낸 건과 발주 직후인 건이 글자까지 같아진다. 워크큐와 **같은 문구**로
                       갈라 주고, 내가 쓴 사유를 함께 보여 준다(재요청이 오면 대조할 근거다). -->
                  <span
                    v-if="po.status === 'issued' && poRejection(po) !== null"
                    class="ml-1 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
                  >
                    반려됨 {{ fmtKstDate(poRejection(po)?.at ?? null) }}
                  </span>
                  <p
                    v-if="poRejection(po) !== null && (po.status === 'issued' || po.status === 'eq_requested')"
                    class="mt-1 max-w-[13rem] truncate text-[11px] text-red-600"
                    :title="poRejection(po)?.note"
                  >
                    “{{ poRejection(po)?.note }}”
                  </p>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {{ pcbMoneyWithSub(po.currency, po.priceOriginal, po.subCurrency, po.subPriceOriginal) }}
                  <span class="text-xs text-gray-400">
                    {{ pcbKrwSuffix(po.currency, po.krwAmount) }}{{ rateNote(po.currency, po.krwAmount, po.exchangeRate, '발주 시점') }}
                  </span>
                </td>
                <!-- 조건 문자열은 길다(예: '50% PRE-PAID / 50% BEFORE SHIPMENT') — 잘라서
                     제목으로 넘기고 폭을 고정한다. 안 그러면 왼쪽 협력사 칸을 밀어낸다. -->
                <td class="max-w-[14rem] px-4 py-2.5 text-xs text-gray-600">
                  <p class="truncate" :title="po.paymentTerms ?? ''">{{ po.paymentTerms ?? '—' }}</p>
                  <p v-if="po.remittanceDueOn !== null" class="mt-0.5 text-[11px] font-semibold text-blue-600">
                    송금 예정 {{ fmtKstDate(po.remittanceDueOn) }}
                  </p>
                  <!-- 초록 배지 하나로는 부분 송금과 완납이 같아 보인다 — 금액으로 말한다 -->
                  <p v-if="po.remittance.count > 0" class="mt-0.5">
                    <span
                      class="truncate rounded px-1 py-0.5 text-[11px] font-semibold"
                      :class="po.remittance.balance > 0.005 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'"
                      :title="`최근 송금 ${dateOnly(po.remittedAt)} · ${String(po.remittance.count)}회`"
                    >
                      송금 {{ fmtPcbAmount(po.currency, po.remittance.paidAmount) }}/{{ fmtPcbAmount(po.currency, po.priceOriginal) }}
                      <template v-if="po.remittance.balance > 0.005">
                        · 잔액 {{ fmtPcbAmount(po.currency, po.remittance.balance) }}
                      </template>
                      <template v-else-if="po.remittance.balance < -0.005">
                        · 과지급 {{ fmtPcbAmount(po.currency, -po.remittance.balance) }}
                      </template>
                    </span>
                  </p>
                  <p v-else class="mt-0.5 text-[11px] text-gray-400">송금 전</p>
                </td>
                <!-- 납기 경과는 큐와 같은 규칙(계약 isPcbDeliveryOverdue)으로 말한다 -->
                <td
                  class="whitespace-nowrap px-4 py-2.5"
                  :class="isPoOverdue(po) ? 'font-semibold text-red-600' : 'text-gray-500'"
                >
                  {{ dateOnly(po.deliveryDate) }}
                  <span
                    v-if="isPoOverdue(po)"
                    class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
                    title="납기일이 지났는데 아직 생산완료가 아닙니다."
                  >
                    납기 초과
                  </span>
                </td>
                <td class="px-4 py-2.5">
                  <!-- 최신만 펼쳐 둔다 — 이전 회차는 [이전 N]을 눌러야 나온다(여정 22호) -->
                  <span v-for="f in eqFilesShown(po)" :key="f.fileId" class="mr-1 inline-flex items-center">
                    <button
                      type="button"
                      class="rounded-l border px-1.5 py-0.5 text-[11px] font-semibold hover:bg-gray-50"
                      :class="!f.isLatest ? 'border-dashed border-amber-300 text-amber-600' : f.afterReject ? 'border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-500'"
                      :title="`${f.fileType.toUpperCase()} · ${f.name}${f.isLatest ? ' (최신)' : ' — 이전 업로드입니다. 승인 근거로 쓰지 마세요.'}${f.afterReject ? ' · 반려 뒤 새로 올라온 보완분입니다.' : ''}`"
                      @click="specId !== null && void downloadAdminPcbEqFile(specId, po.poId, f.fileId, f.name)"
                    >
                      ⬇ {{ f.fileType }}<template v-if="!f.isLatest"> · 이전</template><template v-else-if="f.afterReject"> · 보완</template>
                    </button>
                    <button
                      v-if="po.status === 'issued'"
                      type="button"
                      class="rounded-r border border-l-0 border-gray-200 px-1 py-0.5 text-[11px] text-gray-300 hover:bg-red-50 hover:text-red-600"
                      title="첨부 삭제(대행)"
                      @click="void removeEqFileAdmin(po, f.fileId)"
                    >
                      ✕
                    </button>
                  </span>
                  <button
                    v-if="eqOlderCount(po) > 0"
                    type="button"
                    class="mr-1 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-gray-50"
                    title="같은 종류로 다시 올라온 이전 파일입니다 — 승인 근거는 최신으로 보세요."
                    @click="toggleEqHistory(po.poId)"
                  >
                    {{ eqHistoryOpen.includes(po.poId) ? '이전 숨기기' : `이전 ${eqOlderCount(po)}` }}
                  </button>
                  <!-- D11 대행 업로드 — 발주접수(잠금 전)에서만, 협력사 대신 첨부 -->
                  <template v-if="po.status === 'issued'">
                    <button type="button" class="mr-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:bg-gray-50" @click="pickEqFileAdmin(po, 'eq')">
                      ⬆ eq
                    </button>
                    <button type="button" class="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:bg-gray-50" @click="pickEqFileAdmin(po, 'working')">
                      ⬆ working
                    </button>
                  </template>
                  <span
                    v-else-if="po.eqFiles.length === 0"
                    class="text-xs text-gray-300"
                  >—</span>

                  <!-- 관리자 회신 — 우리가 협력사에게 **보내는** 첨부(수정지시 도면·마크업).
                       줄을 갈라 방향을 눈에 보이게 한다. 승인요청을 받은 상태에서도 붙일 수
                       있다(그때가 회신할 순간이다 — 계약 canEditPcbEqFile). -->
                  <div
                    v-if="replyFilesOf(po).length > 0 || canEditPcbEqFile('reply', po.status)"
                    class="mt-1.5 flex flex-wrap items-center gap-1 border-t border-dashed border-gray-200 pt-1.5"
                  >
                    <span class="text-[11px] font-semibold text-blue-500">↩ 회신</span>
                    <span v-for="f in replyFilesOf(po)" :key="f.fileId" class="inline-flex items-center">
                      <button
                        type="button"
                        class="rounded-l border border-blue-200 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                        :title="`관리자 회신 · ${f.name} — 협력사가 포털에서 받습니다`"
                        @click="specId !== null && void downloadAdminPcbEqFile(specId, po.poId, f.fileId, f.name)"
                      >
                        ⬇ {{ f.name }}
                      </button>
                      <button
                        v-if="canEditPcbEqFile('reply', po.status)"
                        type="button"
                        class="rounded-r border border-l-0 border-blue-200 px-1 py-0.5 text-[11px] text-blue-300 hover:bg-red-50 hover:text-red-600"
                        title="회신 첨부 삭제"
                        @click="void removeEqFileAdmin(po, f.fileId)"
                      >
                        ✕
                      </button>
                    </span>
                    <button
                      v-if="canEditPcbEqFile('reply', po.status)"
                      type="button"
                      class="rounded border border-dashed border-blue-300 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                      title="협력사에게 돌려보낼 수정지시 파일을 첨부합니다 — 반려 메일이 첨부 사실을 알립니다."
                      @click="pickEqFileAdmin(po, 'reply')"
                    >
                      ⬆ 회신 첨부
                    </button>
                  </div>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  <template v-if="po.status === 'eq_requested' && po.eqDelegatePoId === null">
                    <!-- 고객 확인(P4.1) — 승인 전에 고객에게 물어볼 수 있다. EQ 전이는 그대로.
                         버튼이 상태를 입는다(P4.4): 미요청 → 확인중 → 승인/반려. -->
                    <button
                      type="button"
                      class="mr-1 rounded-md border px-2 py-1 font-semibold"
                      :class="PCB_EQ_REVIEW_BTN_CLS[eqReviewStateOf(po)]"
                      :title="eqReviewTitleOf(po)"
                      @click="eqReviewPo = po"
                    >
                      {{ eqReviewLabelOf(po) }}
                    </button>
                    <!-- 반려했는데 그 뒤로 올라온 파일이 없다 = 같은 도면으로 온 재요청.
                         승인 버튼 옆이 아니면 볼 이유가 없는 정보다. -->
                    <span
                      v-if="eqUnfixedAfterReject(po)"
                      class="mr-1 rounded bg-red-100 px-1.5 py-1 font-semibold text-red-700"
                      title="직전 반려 이후 새로 올라온 EQ 첨부가 없습니다 — 같은 도면으로 다시 승인요청됐을 수 있습니다."
                    >
                      반려 후 새 파일 없음
                    </span>
                    <button type="button" class="mr-1 rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(po)">EQ 승인</button>
                    <button type="button" class="mr-1 rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50" @click="rejectPoId = po.poId">반려</button>
                  </template>
                  <!-- EQ 단계가 지나도 고객 확인 결과는 남긴다(승인의 근거) — 클릭하면 이력. -->
                  <button
                    v-else-if="po.eqReview !== null"
                    type="button"
                    class="mr-1 rounded-md border px-2 py-1 font-semibold"
                    :class="PCB_EQ_REVIEW_BTN_CLS[eqReviewStateOf(po)]"
                    :title="eqReviewTitleOf(po)"
                    @click="eqReviewPo = po"
                  >
                    {{ eqReviewLabelOf(po) }}
                  </button>
                  <button
                    v-if="po.status === 'eq_done' && po.eqDelegatePoId === null"
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                    @click="void revertPo(po)"
                  >
                    승인 취소
                  </button>
                  <!-- D11 — 협력사 몫 전이 대행(위임/차단 발주는 하위에서 진행) -->
                  <button
                    v-if="substituteActionOf(po.status) !== null && po.eqDelegatePoId === null && !po.eqBlocked"
                    type="button"
                    class="mr-1 rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-50"
                    @click="void runSubstitute(po)"
                  >
                    {{ SUBSTITUTE_LABELS[substituteActionOf(po.status) ?? 'eq-request'] }}
                  </button>
                  <!-- 발송 시작(담기) 대행 — 계정 없는 조직은 포털에서 누를 사람이 없다 -->
                  <button
                    v-if="canStartShipment(po)"
                    type="button"
                    class="mr-1 rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-50"
                    title="협력사 포털의 [담기]와 같습니다 — 박스를 열면 아래 선적 줄에서 진행할 수 있습니다."
                    @click="void startShipment(po)"
                  >
                    발송 시작
                  </button>
                  <!-- 송금 원장(P3.11) — 부분 송금·증빙까지 여기서 다룬다 -->
                  <button
                    type="button"
                    class="mr-1 rounded-md border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                    @click="remittancePoId = po.poId"
                  >
                    송금
                  </button>
                  <!-- 조건 수정 — 결제조건·납기·메모(송금은 원장이 정본이라 여기 없다) -->
                  <button
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                    @click="openPoEdit(po)"
                  >
                    조건 수정
                  </button>
                  <button
                    v-if="po.status === 'issued'"
                    type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50 hover:text-red-600"
                    @click="void removePo(po)"
                  >
                    발주 취소
                  </button>
                </td>
              </tr>
              <!-- 선적(P3) — 대표 발주 행 아래 1줄(묶음 포함) -->
              <tr v-for="s in shipRowsOf(po.poId)" :key="`ship-${String(s.shipmentId)}`" class="bg-teal-50/30">
                <td colspan="7" class="px-8 py-2">
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="font-bold text-teal-600">🚚 선적</span>
                    <span class="rounded px-1.5 py-0.5 font-semibold" :class="SHIP_STATUS_CLS[s.status]">
                      {{ pcbShipmentStatusLabel(s.mode, s.status, { directShip: isPcbDirectShipIntl(s.destinationCountry) }) }}
                    </span>
                    <span class="text-gray-500">
                      {{ s.mode === 'domestic' ? '국내(택배)' : '국제' }} · {{ s.senderName }} → {{ s.receiverName }}
                      <template v-if="s.destinationCountry !== null"> · 직송 {{ s.destinationCountry }}</template>
                    </span>
                    <!-- 묶음은 Case(고객) 경계를 넘는다 — 건수만 알려주면 "무엇이 함께
                         움직이는지"를 알 수 없어, 구성원을 열거하고 남의 Case 것을 표시한다. -->
                    <span
                      v-if="s.poIds.length > 1"
                      class="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700"
                    >묶음 {{ s.poIds.length }}건</span>
                    <span
                      v-for="m in (s.poIds.length > 1 ? shipMatesOf(s) : [])"
                      :key="`mate-${String(m.poId)}`"
                      class="rounded px-1.5 py-0.5"
                      :class="m.mine ? 'bg-teal-100 font-semibold text-teal-800' : 'bg-gray-100 text-gray-500'"
                      :title="m.mine ? '이 Case 의 발주서' : '다른 Case(다른 고객)의 발주서 — 함께 움직입니다'"
                    >
                      PO-{{ m.poId }} {{ m.projectName }}<template v-if="m.mine"> · 이 Case</template>
                    </span>
                    <span v-if="s.shipDate !== null" class="text-gray-500">출고예정 {{ fmtKstDate(s.shipDate) }}</span>
                    <span v-if="s.trackingNumber !== null" class="tabular-nums text-gray-500">{{ s.carrier ?? '' }} {{ s.trackingNumber }}</span>
                    <span v-if="s.receivedAt !== null" class="font-semibold text-emerald-600">
                      입고완료 {{ dateOnly(s.receivedAt) }}<template v-if="s.receivedNote !== null && s.receivedNote !== ''"> · {{ s.receivedNote }}</template>
                    </span>
                    <button
                      v-for="f in s.files"
                      :key="f.fileId"
                      type="button"
                      class="rounded border border-gray-200 px-1.5 py-0.5 font-semibold text-gray-500 hover:bg-gray-50"
                      :title="f.name"
                      @click="specId !== null && void downloadAdminPcbShipmentFile(specId, po.poId, f.fileId, f.name)"
                    >
                      ⬇ {{ f.fileType }}
                    </button>
                    <span class="grow" />
                    <!-- 국내 종점('입고 완료')은 [입고 확인]이 함께 처리한다 — 전이 버튼을 따로
                         두면 눌러도 다음 일이 안 열리는 상태가 만들어진다(서버도 RECEIVE_REQUIRED). -->
                    <button
                      v-if="adminShipAdvanceLabel(s) !== null"
                      type="button"
                      class="rounded-md bg-teal-600 px-2 py-1 font-semibold text-white hover:bg-teal-700"
                      @click="void adminShipAdvance(po.poId, s)"
                    >
                      {{ adminShipAdvanceLabel(s) }} 진행
                    </button>
                    <button
                      v-if="canAdminReceive(s)"
                      type="button"
                      class="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700"
                      :title="s.mode === 'domestic' ? '실물 검수 후 누르면 입고 완료까지 함께 처리됩니다.' : undefined"
                      @click="receivePrompt = { poId: po.poId, domestic: s.mode === 'domestic', mates: s.poIds.length }"
                    >
                      입고 확인
                    </button>
                    <button
                      v-if="s.mode === 'international'"
                      type="button"
                      class="rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
                      @click="invoicePoId = po.poId"
                    >
                      🧾 송장
                    </button>
                    <button
                      v-if="s.status !== 'preparing'"
                      type="button"
                      class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
                      @click="void adminShipRevert(po.poId)"
                    >
                      ↩ 되돌리기
                    </button>
                    <!-- 선적 취소 — 발송 전·입고 전만. 견적 삭제의 SHIPMENT_EXISTS 를 푸는 출구. -->
                    <button
                      v-if="s.status === 'preparing' && s.receivedAt === null"
                      type="button"
                      class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-red-50 hover:text-red-600"
                      :title="s.poIds.length > 1 ? `묶음 ${s.poIds.length}건이 함께 취소됩니다` : '선적 문서를 삭제합니다'"
                      @click="void adminShipCancel(po.poId, s)"
                    >
                      선적 취소
                    </button>
                  </div>
                </td>
              </tr>
              <!-- MD 하위 발주(EQ 실작업 문서) -->
              <tr v-if="childPosOf(po).length > 0">
                <td colspan="7" class="bg-indigo-50/30 px-8 py-2">
                  <p class="text-[11px] font-semibold text-indigo-500">하위 발주(MD {{ po.partnerName }} 경유 — 승인/반려는 여기서)</p>
                  <div class="mt-1 grid gap-1">
                    <div v-for="child in childPosOf(po)" :key="child.poId" class="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span class="rounded px-1.5 py-0.5 font-semibold" :class="PO_STATUS_CLS[child.status]">
                        {{ PCB_PO_STATUS_LABELS[child.status] }}
                      </span>
                      <span class="font-medium">{{ child.partnerName }}</span>
                      <span class="tabular-nums">{{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}</span>
                      <template v-for="cs in shipRowsOf(child.poId)" :key="`cship-${String(cs.shipmentId)}`">
                        <span class="rounded px-1.5 py-0.5 font-semibold" :class="SHIP_STATUS_CLS[cs.status]">
                          🚚 {{ pcbShipmentStatusLabel(cs.mode, cs.status, { directShip: isPcbDirectShipIntl(cs.destinationCountry) }) }}
                        </span>
                        <span v-if="cs.receivedAt !== null" class="font-semibold text-emerald-600">MD 입고완료</span>
                      </template>
                      <!-- 한 줄 요약이라 **최신만** — 여기서도 승인/반려를 누를 수 있다(여정 22호) -->
                      <button
                        v-for="f in child.eqFiles.filter((x) => x.isLatest)"
                        :key="f.fileId"
                        type="button"
                        class="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                        :title="`${f.fileType.toUpperCase()} · ${f.name} (최신)`"
                        @click="specId !== null && void downloadAdminPcbEqFile(specId, child.poId, f.fileId, f.name)"
                      >
                        ⬇ {{ f.fileType }}
                      </button>
                      <template v-if="child.status === 'eq_requested'">
                        <button type="button" class="rounded-md bg-emerald-600 px-2 py-0.5 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(child)">EQ 승인</button>
                        <button type="button" class="rounded-md border border-red-300 px-2 py-0.5 font-semibold text-red-700 hover:bg-red-50" @click="rejectPoId = child.poId">반려</button>
                      </template>
                      <button
                        v-else-if="child.status === 'eq_done'"
                        type="button"
                        class="rounded-md border border-gray-200 px-2 py-0.5 font-semibold text-gray-500 hover:bg-gray-50"
                        @click="void revertPo(child)"
                      >
                        승인 취소
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="adminPos.length === 0">
              <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400">
                발주서가 없습니다 — 선정 후 결제가 확인되면 [발주서 발행]으로 시작하세요.
              </td>
            </tr>
            <!-- 이전 회차 토글 — RFQ 섹션과 같은 상태를 접고 편다(카운트는 발주·견적 합산).
                 토글이 RFQ 표 하단에만 있으면 발주 쪽 접힘의 출구가 안 보인다(재점검 08-10). -->
            <tr v-if="olderRoundCount > 0">
              <td colspan="7" class="px-4 py-2">
                <button
                  type="button"
                  class="text-xs font-semibold text-gray-400 hover:text-gray-700"
                  @click="roundsExpanded = !roundsExpanded"
                >
                  {{ roundsExpanded ? '▾ 이전 회차 접기' : `▸ 이전 회차 발주·견적 ${String(olderRoundCount)}건 보기` }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- A/S 재발주(P4) — 완료·출고 건 재생산 접수 → 협력사 회신 → 회차 발주서 -->
    <PcbAsCasePanel v-if="detail !== null && specId !== null" :spec-id="specId" />

    <!-- 보낸 메일 — 이 Case 컨텍스트의 발송 이력(전 채널 원장 임베드, 기본 접힘) -->
    <button
      v-if="!mailLogOpen"
      type="button"
      class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      @click="mailLogOpen = true"
    >
      <span>▸ 보낸 메일</span>
      <span class="text-xs text-gray-400">펼치기</span>
    </button>
    <section v-else class="space-y-3 rounded-xl border border-gray-200 bg-surface p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold text-gray-700">보낸 메일</h2>
        <button
          type="button"
          class="text-xs text-gray-400 hover:text-gray-600"
          @click="mailLogOpen = false"
        >
          접기
        </button>
      </div>
      <MailLogList
        v-if="specId !== null"
        :fixed="{ refType: 'pcb_spec', refId: String(specId) }"
        :page-size="10"
      />
    </section>

    <!-- 발주 모달 -->
    <div v-if="poModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="poModalOpen = false">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pcb-po-modal-title"
        class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl"
      >
        <h3 id="pcb-po-modal-title" class="text-sm font-bold text-gray-800">발주서 발행</h3>
        <p class="mt-1 text-xs text-gray-500">
          선정된 회신의 통화·금액·납기가 자동 승계됩니다(비우면 승계값 사용).
        </p>
        <div class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">협력사 *</span>
          <div class="mt-1 w-full rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            {{ poTargetRfq?.partnerName ?? '선정된 협력사가 없습니다.' }}
            <span v-if="poTargetRfq !== null" class="ml-1 text-xs font-medium text-emerald-600">({{ poTargetRfq.currency }})</span>
          </div>
          <span v-if="poTargetRfq !== null" class="mt-1 block text-[11px] text-emerald-600">
            회신 승계: {{ pcbMoneyWithSub(poTargetRfq.currency, poTargetRfq.priceOriginal, poTargetRfq.subCurrency, poTargetRfq.subPriceOriginal) }}
            <template v-if="poTargetRfq.quotedDeliveryDate !== null"> · 납기 {{ fmtKstDate(poTargetRfq.quotedDeliveryDate) }}</template>
          </span>
        </div>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">발주가 ({{ poCurrencyOf(poPartnerId) }})</span>
            <input v-model="poPrice" type="text" inputmode="decimal" :placeholder="poTargetRfq !== null ? '비우면 회신가' : '필수'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
          </label>
          <label v-if="poCurrencyOf(poPartnerId) !== 'KRW'" class="block">
            <span class="text-xs font-semibold text-gray-500">KRW 회계 환율</span>
            <input v-model="poRate" type="text" inputmode="decimal" :placeholder="poTargetRfq?.exchangeRate !== null && poTargetRfq !== undefined && poTargetRfq !== null ? '비우면 선정 환율' : '필수'" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">결제조건</span>
            <input v-model="poTerms" type="text" list="pcb-payment-terms" placeholder="T/T in Advance" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
            <datalist id="pcb-payment-terms">
              <option v-for="term in PCB_PAYMENT_TERM_OPTIONS" :key="term" :value="term" />
            </datalist>
          </label>
          <label v-if="poIsNet7 || poIsCustomPaymentDate" class="block">
            <span class="text-xs font-semibold text-gray-500">송금 예정일 *</span>
            <input
              v-if="poIsCustomPaymentDate"
              v-model="poRemittanceDue"
              type="date"
              class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
            <input
              v-else
              :value="poRemittanceDuePreview"
              type="date"
              disabled
              class="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            >
            <span class="mt-1 block text-[11px] text-gray-400">
              {{ poIsNet7 ? '서버가 발주일 기준 7일 후로 확정합니다.' : '실제 송금일은 송금 원장에 별도로 기록합니다.' }}
            </span>
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">납기</span>
            <input v-model="poDelivery" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
          </label>
        </div>
        <p class="mt-2 text-[11px] text-gray-400">
          위 날짜는 송금 <b class="text-gray-500">예정일</b>입니다. 실제 송금은 발행 뒤
          발주서 행의 <b class="text-gray-500">[송금]</b>에서 금액·환율·증빙과 함께 기록합니다.
        </p>
        <label class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">메모</span>
          <textarea v-model="poMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="poModalOpen = false">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="!poCanSubmit" @click="void submitPo()">발행</button>
        </div>
      </div>
    </div>

    <!-- 제작 사양 수정(P4.2) — 전 필드 편집 + 변경 요약 + 재견적 결과 -->
    <PcbSpecEditModal
      v-if="specEditOpen && detail !== null"
      :project-id="detail.projectId"
      :spec="editableSpec"
      :qty="detail.qty"
      :category="detail.category"
      :final-price="detail.finalPrice"
      :auto-price="detail.quote?.autoPrice ?? null"
      @close="specEditOpen = false"
      @saved="specEditSaved"
    />

    <!-- EQ 고객 확인 패널(P4.1) -->
    <PcbEqReviewPanel v-if="eqReviewPo !== null" :po="eqReviewPo" @close="eqReviewPo = null" />

    <!-- 송금 원장 패널 — 송금 워크큐와 같은 컴포넌트(창구는 여럿, 원장은 하나) -->
    <PcbRemittancePanel
      v-if="remittancePoId !== null"
      :po-id="remittancePoId"
      @close="remittancePoId = null"
    />

    <!-- 발주 조건 수정 모달 — 결제조건·납기·메모(금액·환율은 서버 규칙이 따로다) -->
    <div v-if="editPo !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="editPo = null">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-base font-bold text-gray-900">발주 조건 수정</h3>
        <p class="mt-1 text-xs text-gray-500">
          {{ editPo.partnerName }} · {{ pcbMoneyWithSub(editPo.currency, editPo.priceOriginal, editPo.subCurrency, editPo.subPriceOriginal) }}
          <span class="ml-1 text-gray-400">발주가·환율은 여기서 바꾸지 않습니다.</span>
        </p>

        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">결제조건</span>
          <input v-model="editTerms" type="text" list="pcb-payment-terms-edit" placeholder="T/T in Advance" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
          <datalist id="pcb-payment-terms-edit">
            <option v-for="term in PCB_PAYMENT_TERM_OPTIONS" :key="term" :value="term" />
          </datalist>
        </label>

        <label v-if="editIsNet7 || editIsCustomPaymentDate" class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">송금 예정일 *</span>
          <input
            v-if="editIsCustomPaymentDate"
            v-model="editRemittanceDue"
            type="date"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
          <input
            v-else
            :value="editRemittanceDuePreview"
            type="date"
            disabled
            class="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
          >
          <span class="mt-1 block text-[11px] text-gray-400">
            {{ editIsNet7 ? '최초 발주일 기준 7일 후로 서버가 다시 확정합니다.' : '실제 송금일과는 별도인 예정 날짜입니다.' }}
          </span>
        </label>

        <label class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">납기</span>
          <input v-model="editDelivery" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
        </label>

        <label class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">메모</span>
          <textarea v-model="editMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
        </label>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="editPo = null">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="!editCanSubmit" @click="void submitPoEdit()">저장</button>
        </div>
      </div>
    </div>

    <!-- 확정가 모달 -->
    <div v-if="priceModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="priceModalOpen = false">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">확정가 등록</h3>
        <p class="mt-1 text-xs text-gray-500">부가세 포함가 역산 체계 — 고객 결제액의 기준이 됩니다.</p>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">확정가 (VAT 포함, ₩)</span>
          <input v-model="priceInput" type="text" inputmode="numeric" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none">
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="priceModalOpen = false">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="confirmPrice.isPending.value" @click="void submitPrice()">등록</button>
        </div>
      </div>
    </div>

    <!-- 배정 모달 -->
    <div v-if="assignOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="assignOpen = false">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">협력사 견적요청</h3>
        <p class="mt-1 text-xs text-gray-500">
          체크 해제된 미회신 요청은 회수됩니다(회신 완료 건은 보존). 신규 협력사에게만 메일이 발송됩니다.
        </p>
        <div class="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2">
          <label
            v-for="p in assignCandidates"
            :key="p.partnerId"
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50"
          >
            <input type="checkbox" class="size-4 accent-blue-600" :checked="assignSelected.has(p.partnerId)" @change="toggleAssign(p.partnerId)">
            <span class="flex-1 font-medium text-gray-800">{{ p.name }}</span>
            <span class="text-xs text-gray-400">{{ p.defaultCurrency }}<template v-if="p.country !== null"> · {{ p.country }}</template></span>
          </label>
          <p v-if="assignCandidates.length === 0" class="px-2 py-4 text-center text-xs text-gray-400">
            PCB 견적(pcb_rfq) 능력이 있는 승인 협력사가 없습니다 —
            <RouterLink :to="{ name: 'admin-partners' }" class="font-semibold text-blue-600 hover:underline">
              파트너 관리
            </RouterLink>에서 등록하세요.
          </p>
        </div>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">희망 납기(제시일 — 선택)</span>
          <input v-model="assignDate" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="assignOpen = false">취소</button>
          <button type="button" class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="send.isPending.value" @click="void submitAssign()">
            {{ assignSelected.size }}곳으로 발송
          </button>
        </div>
      </div>
    </div>

    <!-- 대리 회신 모달 -->
    <div v-if="replyTarget !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="replyTarget = null">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">대리 회신 — {{ replyTarget.partnerName }}</h3>
        <p class="mt-1 text-xs text-gray-500">전화·메일로 받은 견적을 관리자가 대신 입력합니다(결제통화 {{ replyTarget.currency }}).</p>
        <div class="mt-3">
          <PcbRfqReplyForm
            :key="replyTarget.rfqId"
            :settlement-currency="replyTarget.currency"
            :initial="{
              priceOriginal: replyTarget.priceOriginal,
              subCurrency: replyTarget.subCurrency,
              subPriceOriginal: replyTarget.subPriceOriginal,
              quotedDeliveryDate: replyTarget.quotedDeliveryDate,
              memo: replyTarget.memo,
            }"
            :suggested-delivery-date="replyTarget.suggestedDeliveryDate"
            :busy="adminReply.isPending.value"
            @submit="(body) => void submitAdminReply(body)"
          />
        </div>
        <div class="mt-3 text-right">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="replyTarget = null">닫기</button>
        </div>
      </div>
    </div>

    <!-- 선정 모달 — 외화 환율 자동 프리필 + 판매가(확정가) 동시 등록 -->
    <div v-if="selectTarget !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="selectTarget = null">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">협력사 선정 — {{ selectTarget.partnerName }}</h3>
        <p class="mt-2 text-sm text-gray-600">
          회신 견적가:
          <b class="tabular-nums">{{ pcbMoneyWithSub(selectTarget.currency, selectTarget.priceOriginal, selectTarget.subCurrency, selectTarget.subPriceOriginal) }}</b>
        </p>
        <label v-if="selectTarget.currency !== 'KRW'" class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">적용 환율 ({{ selectTarget.currency }} → KRW) *</span>
          <input v-model="selectRate" type="text" inputmode="decimal" placeholder="예) 1444.19" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-violet-500 focus:outline-none" @input="onSelectRateInput">
          <span v-if="selectRateDate !== null" class="mt-1 block text-[11px] text-emerald-600">수출입은행 {{ selectRateDate }} 고시(송금 기준) 자동 반영 — 수정 가능. 선정 시점에 박제됩니다.</span>
          <span v-else class="mt-1 block text-[11px] text-gray-400">선정 시점에 박제되어 KRW 환산(원가 회계)에 쓰입니다.</span>
        </label>
        <p v-if="selectCostKrw !== null" class="mt-2 text-xs text-gray-500">
          원가(KRW 환산): <b class="tabular-nums">₩{{ selectCostKrw.toLocaleString() }}</b>
        </p>
        <div v-if="canPriceInSelect" class="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <p class="text-xs font-semibold text-gray-600">판매가(확정가) 함께 등록 — 고객 결제액의 기준</p>
          <div class="mt-2 flex gap-2">
            <label class="w-24 shrink-0">
              <span class="text-[11px] font-semibold text-gray-500">마진 %</span>
              <input v-model="selectMargin" type="text" inputmode="decimal" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none" @input="syncFinalFromMargin">
            </label>
            <label class="min-w-0 flex-1">
              <span class="text-[11px] font-semibold text-gray-500">판매가 (VAT 포함, ₩)</span>
              <input v-model="selectFinal" type="text" inputmode="numeric" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-500 focus:outline-none" @input="syncMarginFromFinal">
            </label>
          </div>
          <p class="mt-1.5 text-[11px] leading-4 text-gray-400">
            판매가 = 원가 KRW × (1+마진%) × 1.1(VAT). 비워 두고 [선정만] 하면 나중에 [확정가 등록]에서 정합니다.
          </p>
        </div>
        <p class="mt-2 text-xs text-gray-400">
          선정하면 같은 트랙의 다른 회신은 '미선정'이 됩니다.<template v-if="!canPriceInSelect"> 진행 중 주문 건 — 판매가 없이 원가 선정만 합니다.</template>
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="selectTarget = null">취소</button>
          <template v-if="canPriceInSelect">
            <button type="button" class="rounded-md border border-violet-200 px-3 py-1.5 text-sm font-semibold text-violet-700 disabled:opacity-40" :disabled="selectMut.isPending.value" @click="void submitSelect(false)">선정만</button>
            <button type="button" class="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="selectMut.isPending.value || !selectFinalValid" @click="void submitSelect(true)">선정 + 확정가 등록</button>
          </template>
          <button v-else type="button" class="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="selectMut.isPending.value" @click="void submitSelect(false)">선정 확정</button>
        </div>
      </div>
    </div>

    <!-- 상업송장 편집(P3) — BOM InvoiceEditorModal 재사용(콜백 주입) -->
    <InvoiceEditorModal
      v-if="adminInvoiceApiRef !== null"
      :open="invoicePoId !== null"
      :load-draft="adminInvoiceApiRef.loadDraft"
      :save-draft="adminInvoiceApiRef.saveDraft"
      :render-xlsx="adminInvoiceApiRef.renderXlsx"
      :attach-pdf="adminInvoiceApiRef.attachPdf"
      @close="invoicePoId = null"
    />

    <!-- 견적 영구 삭제 — 견적 관리와 같은 모달(차단·경고·사유 판정은 서버가 정본) -->
    <!-- 견적서 — 마운트를 v-if 로 제어해야 인쇄 전역 스타일 주입/제거가 모달 수명과 맞는다. -->
    <EstimateModal
      v-if="estimateProjectId !== null"
      :project-id="estimateProjectId"
      @close="estimateProjectId = null"
    />

    <DeleteQuoteModal
      v-if="deleteOpen && specId !== null"
      :ids="[specId]"
      @close="deleteOpen = false"
      @deleted="onDeleted"
    />

    <!-- 고객 배송 처리(P4.6) — '배송 처리 대기' 배지의 액션. 워크큐와 공용 모달 -->
    <PcbCustomerShipModal
      :od-id="customerShipOdId"
      :incomplete-receipt="!customerShipAllReceived"
      :customer-label="detail?.customer?.name ?? ''"
      :project-name="detail?.projectName ?? ''"
      @close="customerShipOdId = null"
    />

    <!-- EQ 반려 — 사유와 수정지시 첨부를 한 자리에서(전용 폼) -->
    <PcbEqRejectModal
      :po="rejectTarget"
      :spec-id="specId"
      :prefill-reason="rejectPrefill"
      :busy="rejectEq.isPending.value"
      @close="rejectPoId = null"
      @confirm="(reason) => void submitReject(reason)"
    />

    <!-- 값을 받아야 하는 조작들(예전엔 window.prompt) — 한 화면에서 받고 필수값을 잠근다 -->
    <UiPromptModal
      :title="shipPrompt === null ? null : `${pcbShipmentStatusLabel(shipPrompt.mode, shipPrompt.next, { directShip: shipPrompt.directShip })} 진행`"
      :fields="shipPrompt === null ? [] : shipPromptFieldsOf(shipPrompt.next)"
      confirm-label="진행"
      :busy="shipAdvanceAdmin.isPending.value"
      @close="shipPrompt = null"
      @confirm="(v) => void submitShipPrompt(v)"
    />
    <UiPromptModal
      :title="receivePrompt === null ? null : '입고 확인'"
      :fields="[{
        name: 'note',
        label: '검수 메모 (선택)',
        type: 'textarea',
        placeholder: '수량 부족·불량 등 특이사항이 있으면 적어 주세요.',
      }]"
      :description="receiveDescription"
      confirm-label="입고 확인"
      :busy="shipReceiveAdmin.isPending.value"
      @close="receivePrompt = null"
      @confirm="(v) => void submitReceive(v)"
    />

    <PcbOrderCancelModal
      v-if="cancelOrderOpen && specId !== null"
      :spec-id="specId"
      @close="cancelOrderOpen = false"
      @done="cancelOrderOpen = false"
      @open-case="cancelOrderOpen = false"
    />
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
