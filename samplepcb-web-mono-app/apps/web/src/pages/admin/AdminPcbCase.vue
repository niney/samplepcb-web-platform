<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PO_STATUS_LABELS,
  PCB_RFQ_STATUS_LABELS,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type AdminPcbPoViewType,
  type AdminPcbRfqViewType,
  type PcbRfqReplyBodyType,
  type PcbShipmentAdvanceBodyType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import { fmtKstDate, kstDateInput, kstDateOnly, kstToday } from '@sp/utils';
import { downloadAdminFile, useAdminQuoteDetail, useConfirmPrice } from '../../admin/useAdminQuotes';
import { useAdminPartnerList, type AdminPartnerFilters } from '../../admin/useAdminPartners';
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
import { useConfirmPcbOrderReceipt } from '../../admin/useAdminPcbOrders';
import { fmtPcbAmount, pcbKrwSuffix, pcbMoneyWithSub } from '../../lib/pcb-money';
import { pcbSpecEntries } from '../../lib/pcb-spec';
import PcbRfqReplyForm from '../../components/pcb/PcbRfqReplyForm.vue';
import DeleteQuoteModal from '../../components/admin/DeleteQuoteModal.vue';
import InvoiceEditorModal from '../../components/smartbom/InvoiceEditorModal.vue';
import PcbRemittancePanel from '../../components/admin/pcb/PcbRemittancePanel.vue';
import PcbEqReviewPanel from '../../components/admin/pcb/PcbEqReviewPanel.vue';

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

const detailQuery = useAdminQuoteDetail(specId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const rfqsQuery = useAdminPcbRfqs(specId);
const allRows = computed(() => rfqsQuery.data.value?.data.rfqs ?? []);
const adminRows = computed(() => allRows.value.filter((r) => r.parentPartnerId === 0));
const childrenOf = (partnerId: number): AdminPcbRfqViewType[] =>
  allRows.value.filter((r) => r.parentPartnerId === partnerId);
const selectedRow = computed(() => adminRows.value.find((r) => r.status === 'selected') ?? null);


// 영구 삭제 — 삭제되면 이 Case 는 사라지므로 진입 워크큐로 되돌린다.
const deleteOpen = ref(false);
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
// D10(P3.5) — 주문됨은 더 이상 일괄 차단이 아니다: 진행 중 주문(입금~배송)은
// 원가 소싱(RFQ) 허용, 판매가(확정가)만 불변. 게이트 정본은 서버 — 여기선 표시만.
const rfqGate = computed<'ok' | 'cart' | 'unpaid' | 'closed'>(() => {
  const d = detail.value;
  if (d === null) return 'ok';
  if (d.cartState === 'cart') return 'cart';
  if (d.cartState !== 'ordered') return 'ok';
  if (d.order === null) return 'ok'; // 유령(주문 헤더 소실) — 서버 게이트가 허용
  if (!d.order.isPaid) return 'unpaid';
  if (d.order.odStatus === '완료' || d.order.odStatus === '취소') return 'closed';
  return 'ok'; // 진행 중 주문 — 원가 소싱 모드
});
// 입금확인 — 발주 패널이 바로 아래라(미결제면 NOT_PAID) 여기서 끊기지 않게 같은 화면에 둔다.
// 조건·API 는 주문·결제 워크큐와 동일(코어 전이 재사용).
const receipt = useConfirmPcbOrderReceipt();
const canConfirmReceipt = computed(() => {
  const order = detail.value?.order;
  return order !== null && order !== undefined && !order.isPaid && order.settleCase.includes('무통장');
});
async function confirmReceipt(): Promise<void> {
  const order = detail.value?.order;
  if (order === null || order === undefined) return;
  if (!window.confirm(`주문 ${order.odId} 입금확인 처리할까요?\n고객에게 입금 확인 메일이 발송됩니다.`)) {
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
  closed: '완료·취소된 주문 — 재작업은 A/S 재발주(예정)로 진행합니다.',
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

// ── 선정/해제 — 외화는 적용 환율 입력(결제통화→KRW 박제) ─────────────────────
const selectTarget = ref<AdminPcbRfqViewType | null>(null);
const selectRate = ref('');
const selectMut = useSelectPcbRfq();
const unselectMut = useUnselectPcbRfq();
function openSelect(row: AdminPcbRfqViewType): void {
  actionError.value = '';
  selectTarget.value = row;
  selectRate.value = '';
}
async function submitSelect(): Promise<void> {
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
  actionError.value = '';
  try {
    await selectMut.mutateAsync({
      specId: specId.value,
      rfqId: row.rfqId,
      ...(exchangeRate === undefined ? {} : { exchangeRate }),
    });
    selectTarget.value = null;
  } catch (e) {
    surfaceError(e, '선정에 실패했습니다.');
  }
}
async function submitUnselect(row: AdminPcbRfqViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm(`${row.partnerName} 선정을 해제할까요? 형제 회신은 다시 열립니다.`)) return;
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
  if (!window.confirm('매직링크를 재발급할까요? 기존 링크는 즉시 무효화됩니다.')) return;
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
const roundsExpanded = ref(false);
const inLatestRound = (row: { reorderRound: number }): boolean =>
  roundsExpanded.value || row.reorderRound === latestRound.value;
const olderRoundCount = computed(
  () =>
    adminRows.value.filter((r) => r.reorderRound !== latestRound.value).length +
    adminPos.value.filter((p) => p.reorderRound !== latestRound.value).length,
);
const childPosOf = (partnerId: number): AdminPcbPoViewType[] =>
  allPos.value.filter((p) => p.parentPartnerId === partnerId);

const poModalOpen = ref(false);
const poPartnerId = ref<number | null>(null);
const poPrice = ref('');
const poRate = ref('');
const poTerms = ref('');
const poDelivery = ref('');
const poMemo = ref('');
const createPo = useCreatePcbPo();

const poTargetRfq = computed(() =>
  adminRows.value.find((r) => r.partnerId === poPartnerId.value && r.status === 'selected') ??
  adminRows.value.find((r) => r.partnerId === poPartnerId.value && r.priceOriginal !== null) ??
  null,
);
const poCurrencyOf = (partnerId: number | null): string =>
  adminRows.value.find((r) => r.partnerId === partnerId)?.currency ??
  assignCandidates.value.find((p) => p.partnerId === partnerId)?.defaultCurrency ??
  'KRW';

function openPoModal(): void {
  const selected = selectedRow.value;
  poPartnerId.value = selected?.partnerId ?? assignCandidates.value[0]?.partnerId ?? null;
  poPrice.value = '';
  poRate.value = '';
  poTerms.value = '';
  poDelivery.value = kstDateInput(selected?.quotedDeliveryDate);
  poMemo.value = '';
  poModalOpen.value = true;
}
async function submitPo(): Promise<void> {
  if (specId.value === null || poPartnerId.value === null) return;
  actionError.value = '';
  const priceRaw = poPrice.value.replaceAll(',', '').trim();
  const rateRaw = poRate.value.replaceAll(',', '').trim();
  try {
    await createPo.mutateAsync({
      specId: specId.value,
      body: {
        partnerId: poPartnerId.value,
        rfqId: poTargetRfq.value?.rfqId ?? null,
        ...(priceRaw === '' ? {} : { priceOriginal: Number(priceRaw) }),
        ...(rateRaw === '' ? {} : { exchangeRate: Number(rateRaw) }),
        paymentTerms: poTerms.value.trim() === '' ? null : poTerms.value.trim(),
        deliveryDate: poDelivery.value === '' ? null : poDelivery.value,
        memo: poMemo.value.trim() === '' ? null : poMemo.value.trim(),
      },
    });
    poModalOpen.value = false;
  } catch (e) {
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
const editDelivery = ref('');
const editMemo = ref('');

/** 송금 원장 패널 — 워크큐(송금 메뉴)와 같은 컴포넌트를 쓴다. */
const remittancePoId = ref<number | null>(null);
/** EQ 고객 확인 패널(P4.1) — 승인 전에 고객에게 물어보는 별도 축. */
const eqReviewPo = ref<AdminPcbPoViewType | null>(null);

function openPoEdit(po: AdminPcbPoViewType): void {
  editPo.value = po;
  editTerms.value = po.paymentTerms ?? '';
  editDelivery.value = kstDateInput(po.deliveryDate);
  editMemo.value = po.memo ?? '';
}

async function submitPoEdit(): Promise<void> {
  const target = editPo.value;
  if (specId.value === null || target === null) return;
  actionError.value = '';
  try {
    await patchPo.mutateAsync({
      specId: specId.value,
      poId: target.poId,
      body: {
        paymentTerms: editTerms.value.trim() === '' ? null : editTerms.value.trim(),
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
  if (!window.confirm(`${po.partnerName} 대신 [${SUBSTITUTE_LABELS[action]}]을 진행할까요? (이력에 관리자 대행으로 남습니다)`)) return;
  actionError.value = '';
  try {
    await eqSubstitute.mutateAsync({ specId: specId.value, poId: po.poId, action });
  } catch (e) {
    surfaceError(e, '대행 진행에 실패했습니다.');
  }
}
function pickEqFileAdmin(po: AdminPcbPoViewType, fileType: 'eq' | 'working'): void {
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
  if (!window.confirm('이 EQ 첨부를 삭제할까요?')) return;
  actionError.value = '';
  try {
    await deleteEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId, fileId });
  } catch (e) {
    surfaceError(e, '파일 삭제에 실패했습니다.');
  }
}
async function approvePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  actionError.value = '';
  try {
    await approveEq.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, 'EQ 승인에 실패했습니다.');
  }
}
async function rejectPo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  const reason = window.prompt(`${po.partnerName} EQ 반려 사유를 입력하세요`);
  if (reason === null || reason.trim() === '') return;
  actionError.value = '';
  try {
    await rejectEq.mutateAsync({ specId: specId.value, poId: po.poId, reason: reason.trim() });
  } catch (e) {
    surfaceError(e, 'EQ 반려에 실패했습니다.');
  }
}
async function revertPo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm('EQ 승인을 취소(한 단계 되돌리기)할까요?')) return;
  actionError.value = '';
  try {
    await revertEqAdmin.mutateAsync({ specId: specId.value, poId: po.poId });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}
async function removePo(po: AdminPcbPoViewType): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm(`${po.partnerName} 발주서를 취소할까요? (발주접수 상태만 가능)`)) return;
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
// 서브행 v-for 용 — 대표 발주 행에만 1개(묶음은 대표 행 아래 한 번만 표시).
const shipRowsOf = (poId: number): PcbShipmentViewType[] => {
  const s = shipmentByPo.value.get(poId);
  if (s === undefined) return [];
  return s.poId === poId ? [s] : [];
};

const shipAdvanceAdmin = useAdminPcbShipmentAdvance();
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
const shipReceiveAdmin = useAdminPcbShipmentReceive();

async function adminShipAdvance(poId: number, s: PcbShipmentViewType): Promise<void> {
  if (specId.value === null) return;
  const next = bomShipmentNextStatus(s.mode, s.status);
  if (next === null) return;
  let body: PcbShipmentAdvanceBodyType = {};
  if (next === 'requested') {
    const d = window.prompt('출고예정일 (YYYY-MM-DD) — Invoice 첨부도 필요합니다');
    if (d === null || d.trim() === '') return;
    body = { shipDate: d.trim() };
  } else if (next === 'shipping') {
    const carrier = window.prompt('택배사');
    if (carrier === null || carrier.trim() === '') return;
    const tn = window.prompt('송장번호');
    if (tn === null || tn.trim() === '') return;
    body = { carrier: carrier.trim(), trackingNumber: tn.trim() };
  } else if (next === 'shipped') {
    const tn = window.prompt('트래킹 번호(AWB/BL)');
    if (tn === null || tn.trim() === '') return;
    body = { trackingNumber: tn.trim() };
  }
  actionError.value = '';
  try {
    await shipAdvanceAdmin.mutateAsync({ specId: specId.value, poId, body });
  } catch (e) {
    surfaceError(e, '선적 진행에 실패했습니다.');
  }
}
async function adminShipRevert(poId: number): Promise<void> {
  if (specId.value === null) return;
  if (!window.confirm('선적을 한 단계 되돌릴까요?')) return;
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
  if (!window.confirm(`선적을 취소(삭제)할까요? 첨부도 함께 지워집니다.${extra}`)) return;
  actionError.value = '';
  try {
    await shipCancelAdmin.mutateAsync({ specId: specId.value, poId });
  } catch (e) {
    surfaceError(e, '선적 취소에 실패했습니다.');
  }
}
async function adminShipReceive(poId: number): Promise<void> {
  if (specId.value === null) return;
  const note = window.prompt('입고 확인 메모(수량 부족·불량 등 — 없으면 비워두세요)');
  if (note === null) return;
  actionError.value = '';
  try {
    await shipReceiveAdmin.mutateAsync({
      specId: specId.value,
      poId,
      note: note.trim() === '' ? null : note.trim(),
    });
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
      <span
        v-else-if="axisMismatch === 'received-not-delivered'"
        class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
        title="입고가 끝났는데 고객 주문 상태가 아직 배송 전입니다 — 통합 관리 주문내역에서 배송 처리하세요"
      >
        배송 처리 대기
      </span>
      <!-- 영구 삭제 — 차단을 푸는 곳(발주 취소·선적 취소)이 바로 이 화면이라, 정리하고
           곧장 지울 수 있게 둔다. 모달·판정은 견적 관리와 같은 것을 쓴다(창구만 둘). -->
      <button
        v-if="specId !== null"
        type="button"
        class="ml-auto rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        @click="deleteOpen = true"
      >
        견적 삭제
      </button>
    </div>

    <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {{ actionError }}
    </p>

    <div v-if="detail !== null" class="grid gap-4 lg:grid-cols-3">
      <!-- 스펙 요약 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4 lg:col-span-2">
        <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ detail.category }} · {{ detail.orderCategory === 'mass' ? '양산' : '샘플' }} ·
          {{ detail.qty }}매
          <span v-if="detail.applicant !== null" class="ml-2 text-gray-400">
            신청 {{ detail.applicant.name || detail.applicant.mbId }}
          </span>
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
            <dt class="text-gray-500">자동견적가</dt>
            <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.quote?.autoPrice ?? null) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-gray-500">확정가</dt>
            <dd class="font-bold tabular-nums" :class="detail.finalPrice === null ? 'text-gray-300' : 'text-emerald-700'">
              {{ fmtPcbAmount('KRW', detail.finalPrice) }}
            </dd>
          </div>
          <div v-if="selectedRow !== null" class="flex justify-between">
            <dt class="text-gray-500">선정 원가</dt>
            <dd class="tabular-nums text-gray-700">
              {{ pcbMoneyWithSub(selectedRow.currency, selectedRow.priceOriginal, selectedRow.subCurrency, selectedRow.subPriceOriginal) }}{{ pcbKrwSuffix(selectedRow.currency, selectedRow.krwAmount) }}
            </dd>
          </div>
        </dl>
        <!-- 확정가(판매가)는 주문 후 불변 — 주문된 건에선 버튼 자체를 숨긴다(D10). -->
        <button
          v-if="detail.order === null"
          type="button"
          class="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="detail.cartState !== 'none' || detail.status !== 'active'"
          @click="openPriceModal"
        >
          {{ detail.finalPrice === null ? '확정가 등록' : '확정가 수정' }}
        </button>
        <p v-if="detail.order === null" class="mt-1.5 text-[11px] leading-4 text-gray-400">
          확정가를 등록해야 고객이 주문할 수 있습니다(견적 확정). 협력사 선정 시 KRW 환산가가
          프리필됩니다 — 마진을 더해 확정하세요.
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
              <dd class="font-mono text-xs text-gray-600">{{ detail.order.odId }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">상태</dt>
              <dd class="font-semibold" :class="detail.order.isPaid ? 'text-emerald-700' : 'text-amber-600'">
                {{ detail.order.odStatus }}<span v-if="!detail.order.isPaid"> (입금 대기)</span>
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">주문금액</dt>
              <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.cartPrice) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">수납액</dt>
              <dd class="tabular-nums" :class="detail.order.receiptPrice > 0 ? 'text-emerald-700' : 'text-gray-400'">
                {{ fmtPcbAmount('KRW', detail.order.receiptPrice) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-gray-500">결제수단 / 주문일</dt>
              <dd class="text-gray-600">{{ detail.order.settleCase || '—' }} · {{ fmtKstDate(detail.order.orderedAt) }}</dd>
            </div>
          </dl>
          <!-- 미입금이면 여기서 바로 처리 — 아래 발주 패널이 결제 게이트(NOT_PAID)로 막히기 때문. -->
          <button
            v-if="canConfirmReceipt"
            type="button"
            class="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="receipt.isPending.value"
            @click="void confirmReceipt()"
          >
            입금확인
          </button>
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
    <section v-else class="rounded-xl border border-gray-200 bg-surface">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2 class="text-sm font-bold text-gray-700">
          협력사 견적요청
          <span class="ml-1 text-xs font-normal text-gray-400">{{ adminRows.length }}곳</span>
        </h2>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="rfqGate !== 'ok'"
          :title="rfqGate === 'ok' ? '' : RFQ_GATE_NOTES[rfqGate]"
          @click="openAssign"
        >
          협력사 견적요청 {{ adminRows.length > 0 ? '변경' : '보내기' }}
        </button>
      </div>
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
                  <span class="text-xs text-gray-400">{{ pcbKrwSuffix(row.currency, row.krwAmount) }}</span>
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
                    type="button"
                    class="mr-1 rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                    @click="replyTarget = row"
                  >
                    대리 회신
                  </button>
                  <button
                    v-if="row.status === 'quoted'"
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
            <!-- 이전 회차(A/S 재발주) — 지나간 흔적은 지우지 않고 접어 둔다 -->
            <tr v-if="olderRoundCount > 0">
              <td colspan="7" class="px-4 py-2">
                <button
                  type="button"
                  class="text-xs font-semibold text-gray-400 hover:text-gray-700"
                  @click="roundsExpanded = !roundsExpanded"
                >
                  {{ roundsExpanded ? '▾ 이전 회차 접기' : `▸ 이전 회차 ${String(olderRoundCount)}건 보기` }}
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
          <span class="ml-1 text-xs font-normal text-gray-400">{{ adminPos.length }}건</span>
        </h2>
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700"
          @click="openPoModal"
        >
          발주서 발행
        </button>
      </div>
      <p class="border-b border-gray-50 px-4 py-2 text-xs text-gray-400">
        발행은 고객 결제(입금 확인) 후에만 가능합니다. 진행:
        발주접수(협력사 EQ·Working 업로드) → EQ 승인요청 → <b>EQ 승인(관리자)</b> → 생산시작 → 생산완료.
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
                <td class="px-4 py-2.5">
                  <p class="font-medium text-gray-900">
                    {{ po.partnerName }}
                    <span v-if="po.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-semibold text-rose-700">
                      {{ po.reorderRound }}차
                    </span>
                  </p>
                  <p v-if="po.eqDelegatePoId !== null" class="text-[11px] text-indigo-600">MD 경유 — EQ는 하위에서 진행(자동 반영)</p>
                  <p v-else-if="po.eqBlocked" class="text-[11px] text-amber-600">MD 하위 발주 대기 — 발주되면 EQ 시작</p>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="PO_STATUS_CLS[po.status]">
                    {{ PCB_PO_STATUS_LABELS[po.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {{ pcbMoneyWithSub(po.currency, po.priceOriginal, po.subCurrency, po.subPriceOriginal) }}
                  <span class="text-xs text-gray-400">{{ pcbKrwSuffix(po.currency, po.krwAmount) }}</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-600">
                  {{ po.paymentTerms ?? '—' }}
                  <span
                    v-if="po.remittedAt !== null"
                    class="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[11px] font-semibold text-emerald-700"
                  >송금 {{ dateOnly(po.remittedAt) }}</span>
                  <span v-else class="ml-1 text-[11px] text-gray-400">송금 전</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-gray-500">{{ dateOnly(po.deliveryDate) }}</td>
                <td class="px-4 py-2.5">
                  <span v-for="f in po.eqFiles" :key="f.fileId" class="mr-1 inline-flex items-center">
                    <button
                      type="button"
                      class="rounded-l border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                      :title="`${f.fileType.toUpperCase()} · ${f.name}`"
                      @click="specId !== null && void downloadAdminPcbEqFile(specId, po.poId, f.fileId, f.name)"
                    >
                      ⬇ {{ f.fileType }}
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
                  <!-- D11 대행 업로드 — 발주접수(잠금 전)에서만, 협력사 대신 첨부 -->
                  <template v-if="po.status === 'issued'">
                    <button type="button" class="mr-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:bg-gray-50" @click="pickEqFileAdmin(po, 'eq')">
                      ⬆ eq
                    </button>
                    <button type="button" class="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] font-semibold text-gray-400 hover:bg-gray-50" @click="pickEqFileAdmin(po, 'working')">
                      ⬆ working
                    </button>
                  </template>
                  <span v-else-if="po.eqFiles.length === 0" class="text-xs text-gray-300">—</span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                  <template v-if="po.status === 'eq_requested' && po.eqDelegatePoId === null">
                    <!-- 고객 확인(P4.1) — 승인 전에 고객에게 물어볼 수 있다. EQ 전이는 그대로. -->
                    <button type="button" class="mr-1 rounded-md border border-sky-300 px-2 py-1 font-semibold text-sky-700 hover:bg-sky-50" @click="eqReviewPo = po">고객 확인</button>
                    <button type="button" class="mr-1 rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(po)">EQ 승인</button>
                    <button type="button" class="mr-1 rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50" @click="void rejectPo(po)">반려</button>
                  </template>
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
                      {{ bomShipmentStatusLabel(s.mode, s.status) }}
                    </span>
                    <span class="text-gray-500">
                      {{ s.mode === 'domestic' ? '국내(택배)' : '국제' }} · {{ s.senderName }} → {{ s.receiverName }}
                      <template v-if="s.destinationCountry !== null"> · 직송 {{ s.destinationCountry }}</template>
                    </span>
                    <span v-if="s.poIds.length > 1" class="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">묶음 {{ s.poIds.length }}건</span>
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
                    <button
                      v-if="bomShipmentNextStatus(s.mode, s.status) !== null"
                      type="button"
                      class="rounded-md bg-teal-600 px-2 py-1 font-semibold text-white hover:bg-teal-700"
                      @click="void adminShipAdvance(po.poId, s)"
                    >
                      {{ bomShipmentStatusLabel(s.mode, bomShipmentNextStatus(s.mode, s.status) ?? s.status) }} 진행
                    </button>
                    <button
                      v-if="bomShipmentNextStatus(s.mode, s.status) === null && s.receivedAt === null && s.receiverKind === 'admin'"
                      type="button"
                      class="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700"
                      @click="void adminShipReceive(po.poId)"
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
              <tr v-if="childPosOf(po.partnerId).length > 0">
                <td colspan="7" class="bg-indigo-50/30 px-8 py-2">
                  <p class="text-[11px] font-semibold text-indigo-500">하위 발주(MD {{ po.partnerName }} 경유 — 승인/반려는 여기서)</p>
                  <div class="mt-1 grid gap-1">
                    <div v-for="child in childPosOf(po.partnerId)" :key="child.poId" class="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span class="rounded px-1.5 py-0.5 font-semibold" :class="PO_STATUS_CLS[child.status]">
                        {{ PCB_PO_STATUS_LABELS[child.status] }}
                      </span>
                      <span class="font-medium">{{ child.partnerName }}</span>
                      <span class="tabular-nums">{{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}</span>
                      <template v-for="cs in shipRowsOf(child.poId)" :key="`cship-${String(cs.shipmentId)}`">
                        <span class="rounded px-1.5 py-0.5 font-semibold" :class="SHIP_STATUS_CLS[cs.status]">
                          🚚 {{ bomShipmentStatusLabel(cs.mode, cs.status) }}
                        </span>
                        <span v-if="cs.receivedAt !== null" class="font-semibold text-emerald-600">MD 입고완료</span>
                      </template>
                      <button
                        v-for="f in child.eqFiles"
                        :key="f.fileId"
                        type="button"
                        class="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
                        @click="specId !== null && void downloadAdminPcbEqFile(specId, child.poId, f.fileId, f.name)"
                      >
                        ⬇ {{ f.fileType }}
                      </button>
                      <template v-if="child.status === 'eq_requested'">
                        <button type="button" class="rounded-md bg-emerald-600 px-2 py-0.5 font-semibold text-white hover:bg-emerald-700" @click="void approvePo(child)">EQ 승인</button>
                        <button type="button" class="rounded-md border border-red-300 px-2 py-0.5 font-semibold text-red-700 hover:bg-red-50" @click="void rejectPo(child)">반려</button>
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
          </tbody>
        </table>
      </div>
    </section>

    <!-- 발주 모달 -->
    <div v-if="poModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="poModalOpen = false">
      <div class="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">발주서 발행</h3>
        <p class="mt-1 text-xs text-gray-500">
          선정 회신이 있으면 통화·금액·납기가 자동 승계됩니다(비우면 승계값 사용).
        </p>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">협력사 *</span>
          <select v-model="poPartnerId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
            <option v-for="p in assignCandidates" :key="p.partnerId" :value="p.partnerId">
              {{ p.name }} ({{ p.defaultCurrency }})
            </option>
          </select>
          <span v-if="poTargetRfq !== null" class="mt-1 block text-[11px] text-emerald-600">
            회신 승계: {{ pcbMoneyWithSub(poTargetRfq.currency, poTargetRfq.priceOriginal, poTargetRfq.subCurrency, poTargetRfq.subPriceOriginal) }}
            <template v-if="poTargetRfq.quotedDeliveryDate !== null"> · 납기 {{ fmtKstDate(poTargetRfq.quotedDeliveryDate) }}</template>
          </span>
        </label>
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
              <option value="T/T in Advance" />
              <option value="NET30 DAYS" />
              <option value="50% PRE-PAID" />
            </datalist>
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-gray-500">납기</span>
            <input v-model="poDelivery" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
          </label>
        </div>
        <p class="mt-2 text-[11px] text-gray-400">
          송금은 발행 뒤 발주서 행의 <b class="text-gray-500">[송금]</b> 에서 기록합니다 —
          부분 송금과 증빙까지 원장에 남습니다.
        </p>
        <label class="mt-2 block">
          <span class="text-xs font-semibold text-gray-500">메모</span>
          <textarea v-model="poMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="poModalOpen = false">취소</button>
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="createPo.isPending.value || poPartnerId === null" @click="void submitPo()">발행</button>
        </div>
      </div>
    </div>

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
          <input v-model="editTerms" type="text" list="pcb-payment-terms" placeholder="T/T in Advance" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
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
          <button type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="patchPo.isPending.value" @click="void submitPoEdit()">저장</button>
        </div>
      </div>
    </div>

    <!-- 확정가 모달 -->
    <div v-if="priceModalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="priceModalOpen = false">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">확정가 등록</h3>
        <p class="mt-1 text-xs text-gray-500">부가세 포함가 역산 체계 — 고객 결제액의 기준이 됩니다.</p>
        <label class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">확정가 (₩)</span>
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

    <!-- 선정 모달(외화 환율 입력) -->
    <div v-if="selectTarget !== null" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="selectTarget = null">
      <div class="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-sm font-bold text-gray-800">협력사 선정 — {{ selectTarget.partnerName }}</h3>
        <p class="mt-2 text-sm text-gray-600">
          회신 견적가:
          <b class="tabular-nums">{{ pcbMoneyWithSub(selectTarget.currency, selectTarget.priceOriginal, selectTarget.subCurrency, selectTarget.subPriceOriginal) }}</b>
        </p>
        <label v-if="selectTarget.currency !== 'KRW'" class="mt-3 block">
          <span class="text-xs font-semibold text-gray-500">적용 환율 ({{ selectTarget.currency }} → KRW) *</span>
          <input v-model="selectRate" type="text" inputmode="decimal" placeholder="예) 1444.19" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-violet-500 focus:outline-none">
          <span class="mt-1 block text-[11px] text-gray-400">선정 시점에 박제되어 KRW 환산(원가 회계)에 쓰입니다.</span>
        </label>
        <p class="mt-2 text-xs text-gray-400">선정하면 같은 트랙의 다른 회신은 '미선정'이 됩니다. 판매가는 [확정가 등록]에서 별도로 정합니다.</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="selectTarget = null">취소</button>
          <button type="button" class="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40" :disabled="selectMut.isPending.value" @click="void submitSelect()">선정 확정</button>
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
    <DeleteQuoteModal
      v-if="deleteOpen && specId !== null"
      :ids="[specId]"
      @close="deleteOpen = false"
      @deleted="onDeleted"
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
