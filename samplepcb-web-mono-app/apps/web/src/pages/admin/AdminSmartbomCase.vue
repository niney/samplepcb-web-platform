<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiGet, apiGetBlob } from '@sp/shared';
import { AdminBomQuoteRecipientEmail, BomQuotePrintResponse, apiRoutes } from '@sp/api-contract';
import type {
  AdminBomQuoteItemType,
  AdminBomQuoteEmailDeliveryType,
  AdminBomQuoteItemAddBodyType,
  AdminBomQuoteItemRemoveBodyType,
  AdminBomQuoteItemSelectionBodyType,
  BomQuoteCandidateType,
  BomQuoteItemType,
  BomQuoteStatusType,
  PartHitType,
} from '@sp/api-contract';
import {
  bomQuoteAdminAttention,
  neededQty,
  type BomQuoteAdminAttention,
  type BomQuoteAdminAttentionKind,
  type BomQuoteAdminAttentionReason,
  type OfferPick,
} from '@sp/utils';
import type { AdminBomPoViewType, AdminBomRfqViewType, BomRfqReplyBodyType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAddAdminBomQuoteItem,
  useAdminBomQuote,
  useAdminBomQuoteCandidates,
  useCompleteAdminBomQuote,
  usePatchAdminBomQuote,
  useRemoveAdminBomQuoteItem,
  useReviewAdminBomQuoteItems,
  useSendAdminBomQuoteAnswerEmail,
  useSelectAdminBomQuoteItem,
} from '../../admin/useAdminBomQuotes';
import {
  useAdminBomRfqs,
  useAdminRfqReply,
  useReissueRfqMagicLink,
} from '../../admin/useAdminBomRfqs';
import {
  useAdminBomPos,
  useCloseBomPo,
  useCreateBomPos,
  useDeleteBomPo,
  useExecuteExternalPo,
} from '../../admin/useAdminBomPos';
import {
  SMARTBOM_STATUS_META,
  SMARTBOM_STEPS,
  smartbomCaseNo,
  smartbomFmtDate,
  smartbomFmtWon,
  smartbomStepOf,
} from '../../admin/smartbom';
import BomCandidateDrawer from '../../components/admin/bom/BomCandidateDrawer.vue';
import BomCaseDeleteModal from '../../components/admin/smartbom/BomCaseDeleteModal.vue';
import BomPartAddModal from '../../components/admin/smartbom/BomPartAddModal.vue';
import BomEstimateModal from '../../components/smartbom/BomEstimateModal.vue';
import BomPoCreateModal from '../../components/admin/smartbom/BomPoCreateModal.vue';
import BomPoPanel from '../../components/admin/smartbom/BomPoPanel.vue';
import BomShipmentModal from '../../components/admin/smartbom/BomShipmentModal.vue';
import BomRfqCompareModal from '../../components/admin/smartbom/BomRfqCompareModal.vue';
import BomRfqPanel from '../../components/admin/smartbom/BomRfqPanel.vue';
import BomRfqSendModal from '../../components/admin/smartbom/BomRfqSendModal.vue';
import QuickMailComposer from '../../components/admin/smartbom/QuickMailComposer.vue';
import MailLogList from '../../components/admin/MailLogList.vue';
import AdminCaseCustomerCard from '../../components/admin/AdminCaseCustomerCard.vue';
import RfqReplyForm, { type RfqReplyFormRow } from '../../components/smartbom/RfqReplyForm.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 스마트 BOM Case 상세 — 고객 견적요청 1건의 운영 화면(docs/SMARTBOM_PARTNER_RFQ.md §3.4).
// 데이터·검토 로직은 /api/admin/bom-quotes 그대로(BOM 견적요청 화면과 동일 계약).
// 협력사 RFQ 패널·발송 모달·비교 뷰는 이 화면 위에 단계적으로 확장한다(§5-4~6).

const route = useRoute();
const router = useRouter();
const detailId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = useAdminBomQuote(detailId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const reviewEditable = computed(() =>
  detail.value?.status === 'requested' || detail.value?.status === 'reviewing',
);
const detailNotFound = computed(() => {
  const reason = detailQuery.error.value;
  return reason instanceof ApiRequestError && reason.status === 404;
});
const detailErrorMessage = computed(() => {
  const reason = detailQuery.error.value;
  if (!(reason instanceof ApiRequestError)) {
    return '상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (reason.status === 401) return '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.';
  if (reason.status === 403) return '이 Case를 조회할 권한이 없습니다.';
  if (reason.status >= 500) {
    return 'Case 상세 조회 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  }
  return reason.payload?.message ?? reason.message;
});
const caseDeleteOpen = ref(false);

function retryDetail(): void {
  void detailQuery.refetch();
}

async function onCaseDeleted(): Promise<void> {
  caseDeleteOpen.value = false;
  await router.push({ name: 'admin-smartbom' });
}

// 역할별 메뉴 진입 컨텍스트(§6.12 개정) — ?from=quotes|orders|pos|logistics 로 들어오면
// 무관 섹션을 한 줄 접힘 바로 축소(존재 신호+한 클릭 복원). 접힘만으로 관련 섹션이
// 화면 상단에 오므로 별도 스크롤·강조는 두지 않는다(사용자 결정으로 제거).
// 진행현황·북마크(from 없음)는 전체 표시. 상세는 여전히 단일 척추 — 렌더만 다르다.
type CaseSection = 'rfq' | 'po' | 'items';
type CaseFrom = 'quotes' | 'orders' | 'pos' | 'logistics';
const fromParam = ((): CaseFrom | null => {
  const raw = route.query.from;
  return raw === 'quotes' || raw === 'orders' || raw === 'pos' || raw === 'logistics'
    ? raw
    : null;
})();
const INITIAL_COLLAPSED: Record<CaseFrom, CaseSection[]> = {
  quotes: ['po'], // 견적 담당 — 품목·검토+RFQ 가 본업
  orders: ['rfq', 'items'], // 경리 — 주문 정보(요약 스트립)+발주 현황만
  pos: ['rfq', 'items'], // 구매 — 발주 패널이 본업(선정가는 발주 스냅샷에 박제됨)
  logistics: ['rfq', 'items'], // 물류 — 발주 패널의 [선적 관리]가 진입점
};
const collapsed = ref<Set<CaseSection>>(
  new Set(fromParam === null ? [] : INITIAL_COLLAPSED[fromParam]),
);
const expandSection = (section: CaseSection): void => {
  const next = new Set(collapsed.value);
  next.delete(section);
  collapsed.value = next;
};

// 견적서 인쇄(§6.8) — 모달 open 시 로더 콜백으로 fetch(관리자 print 라우트).
const estimateOpen = ref(false);
// 빠른 메일(§6.15) — 헤더 [✉ 메일] → 우하단 컴포즈.
const mailOpen = ref(false);
// 보낸 메일(발송 이력) 섹션 — 조회용이라 기본 접힘.
const mailLogOpen = ref(false);
const loadEstimatePrint = async () => {
  const res = await apiGet(
    `${apiRoutes.adminBomQuotes}/${detailId.value ?? ''}/print`,
    BomQuotePrintResponse,
  );
  return res.data;
};
const patch = usePatchAdminBomQuote();
const completeReview = useCompleteAdminBomQuote();
const sendAnswerEmail = useSendAdminBomQuoteAnswerEmail();
const candidateItemId = ref<string | null>(null);
const candidateDrawerView = ref<'candidates' | 'search'>('candidates');
const candidateQuery = useAdminBomQuoteCandidates(detailId, candidateItemId);
const candidateSelection = useSelectAdminBomQuoteItem();
const candidateSelectionError = ref('');
const partAdd = useAddAdminBomQuoteItem();
const partRemove = useRemoveAdminBomQuoteItem();
const itemReview = useReviewAdminBomQuoteItems();

// RFQ 반영 파생 단계 — reviewing 에서 RFQ 가 있으면 ③(발송)·④(회신 도착)로 세분화(§3.3).
const rfqQuery = useAdminBomRfqs(detailId);
const rfqs = computed(() => rfqQuery.data.value?.data.rfqs ?? []);
const poQuery = useAdminBomPos(detailId);
const pos = computed(() => poQuery.data.value?.data.pos ?? []);
const currentStep = computed(() => {
  if (detail.value === null) return 0;
  // 주문·발주·물류 파생이 우선(⑥~⑫) — 이후 RFQ 세분화(③④), 마지막이 상태 기반.
  const orderStep = smartbomStepOf(detail.value.status, {
    orderState: detail.value.orderState,
    isPaid: detail.value.orderInfo?.isPaid ?? false,
    poCount: pos.value.length,
    poReceivedCount: pos.value.filter((po) => po.shipment?.receivedAt != null).length,
    hasShipment: pos.value.some((po) => po.shipment !== null),
    odStatus: detail.value.orderInfo?.odStatus,
  });
  if (orderStep >= 6) return orderStep;
  const base = smartbomStepOf(detail.value.status);
  if (detail.value.status !== 'reviewing' || rfqs.value.length === 0) return base;
  return rfqs.value.some((r) => r.status === 'quoted') ? 4 : 3;
});
const orderCanceled = computed(() => detail.value?.orderState === 'canceled');

const timelineScroll = ref<HTMLElement | null>(null);
const adminItemsTableScroll = ref<HTMLElement | null>(null);

function moveTimeline(direction: -1 | 1): void {
  timelineScroll.value?.scrollBy({ left: direction * 260, behavior: 'smooth' });
}

function moveAdminItemsTable(direction: -1 | 1): void {
  adminItemsTableScroll.value?.scrollBy({ left: direction * 320, behavior: 'smooth' });
}

// 작은 화면에서도 현재 단계가 첫 화면 밖에 숨지 않도록 진행 변화 때 중앙에 맞춘다.
watch(currentStep, (step) => {
  if (step <= 0) return;
  void nextTick(() => {
    const container = timelineScroll.value;
    const target = container?.querySelector<HTMLElement>(`[data-smartbom-step="${String(step)}"]`);
    if (container === null || target === undefined || target === null) return;
    container.scrollTo({
      left: Math.max(0, target.offsetLeft - (container.clientWidth - target.offsetWidth) / 2),
      behavior: 'smooth',
    });
  });
}, { immediate: true });

// 요청 부품행 범위(서버 loadRfqScopeItems 와 동일 파생) — 시트 선택 + included.
const scopeItems = computed(() => {
  if (detail.value === null) return [];
  const sheets = detail.value.sheets;
  const selected = new Set(sheets.filter((s) => s.selected).map((s) => s.sheetIndex));
  return detail.value.items.filter(
    (item) =>
      item.included &&
      (sheets.length === 0 || item.sourceSheetIndex === null || selected.has(item.sourceSheetIndex)),
  );
});

// RFQ 부분 행 선택(§6.13 개정) — 판단 근거(선정 구매 조건·매칭)가 있는 품목 테이블에서
// 체크하고, 발송 모달은 요약·확인만 한다(편집 창구 단일). 선택 없음 = 전체 발송.
const rfqItemSelection = ref<Set<string>>(new Set());
const scopeItemIds = computed(() => new Set(scopeItems.value.map((item) => item.id)));
const rfqSelectable = (item: BomQuoteItemType): boolean => scopeItemIds.value.has(item.id);
const allRfqRowsSelected = computed(
  () => scopeItems.value.length > 0 && rfqItemSelection.value.size === scopeItems.value.length,
);

// 부품 유형 판단은 Vue 문자열 추측이 아니라 sp-engine의 정규화 결과만 소비한다.
// 과거 견적·수동 행처럼 guidance가 없으면 미분류로 남겨 자동 선택하지 않는다.
type RfqPassiveComponentType = 'resistor' | 'capacitor';

const rfqEngineComponentType = (item: BomQuoteItemType) =>
  item.matchEvidence?.searchRequirementGuidance?.componentType ?? null;

interface RfqQuickSelectionGroups {
  resistorIds: string[];
  capacitorIds: string[];
  passiveIds: string[];
  unofferedIds: string[];
  unclassifiedCount: number;
}

const rfqQuickSelectionGroups = computed<RfqQuickSelectionGroups>(() => {
  const groups: RfqQuickSelectionGroups = {
    resistorIds: [],
    capacitorIds: [],
    passiveIds: [],
    unofferedIds: [],
    unclassifiedCount: 0,
  };
  for (const item of scopeItems.value) {
    const componentType = rfqEngineComponentType(item);
    if (componentType === 'resistor') {
      groups.resistorIds.push(item.id);
      groups.passiveIds.push(item.id);
    } else if (componentType === 'capacitor') {
      groups.capacitorIds.push(item.id);
      groups.passiveIds.push(item.id);
    } else if (componentType === null) {
      groups.unclassifiedCount += 1;
    }
    if (item.selectedOffer === null) groups.unofferedIds.push(item.id);
  }
  return groups;
});

function applyRfqQuickSelection(ids: readonly string[]): void {
  // 빈 선택은 계약상 '전체 발송'이므로 0건 퀵 액션이 기존 선택을 지우지 않게 방어한다.
  if (ids.length === 0) return;
  rfqItemSelection.value = new Set(ids);
}

function selectRfqComponentRows(componentType: RfqPassiveComponentType | 'passive'): void {
  const groups = rfqQuickSelectionGroups.value;
  applyRfqQuickSelection(
    componentType === 'resistor'
      ? groups.resistorIds
      : componentType === 'capacitor'
        ? groups.capacitorIds
        : groups.passiveIds,
  );
}

function toggleRfqRow(itemId: string): void {
  const next = new Set(rfqItemSelection.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  rfqItemSelection.value = next;
}

function toggleAllRfqRows(): void {
  rfqItemSelection.value = allRfqRowsSelected.value
    ? new Set()
    : new Set(scopeItems.value.map((item) => item.id));
}

function useFullRfqScope(): void {
  rfqItemSelection.value = new Set();
}

// 실무 퀵 액션 — 공급사 구매 조건이 없는 행만 협력사에 문의하는 흔한 패턴.
function selectUnofferedRfqRows(): void {
  applyRfqQuickSelection(rfqQuickSelectionGroups.value.unofferedIds);
}

// 품목 관점 RFQ 현황 — RFQ 패널(협력사 관점)의 역방향 인덱스. 현재 유효 scope 안에서
// 이 행을 요청한 협력사와 행별 회신 상태를 한눈에 보여준다. 문서가 quoted 여도 특정
// 행 회신이 없을 수 있으므로 '행 미회신'을 별도로 둔다.
type ItemRfqBadgeTone = 'waiting' | 'replied' | 'missing' | 'closed';
interface ItemRfqBadge {
  rfq: AdminBomRfqViewType;
  tone: ItemRfqBadgeTone;
  label: string;
  unitPrice: number | null;
  currency: string;
}

const ITEM_RFQ_BADGE_CLASSES = {
  waiting: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  replied: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  missing: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  closed: 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100',
} as const satisfies Record<ItemRfqBadgeTone, string>;

const ITEM_RFQ_BADGE_ORDER = {
  missing: 0,
  waiting: 1,
  replied: 2,
  closed: 3,
} as const satisfies Record<ItemRfqBadgeTone, number>;

const itemRfqBadges = computed(() => {
  const byItem = new Map<string, ItemRfqBadge[]>();
  const activeScopeIds = scopeItemIds.value;

  for (const rfq of rfqs.value) {
    const replyByItem = new Map(rfq.items.map((item) => [item.quoteItemId, item]));
    const requestedIds = rfq.requestedItemIds ?? [...activeScopeIds];

    for (const itemId of requestedIds) {
      if (!activeScopeIds.has(itemId)) continue;
      const reply = replyByItem.get(itemId);
      const hasReply = reply !== undefined && reply.unitPrice !== null;

      let tone: ItemRfqBadgeTone;
      let label: string;
      if (hasReply) {
        tone = 'replied';
        label = rfq.status === 'closed' ? '회신·마감' : '회신';
      } else if (rfq.status === 'closed') {
        tone = 'closed';
        label = '마감';
      } else if (rfq.status === 'quoted') {
        tone = 'missing';
        label = '행 미회신';
      } else {
        tone = 'waiting';
        label = '요청중';
      }

      const badge: ItemRfqBadge = {
        rfq,
        tone,
        label,
        unitPrice: reply?.unitPrice ?? null,
        currency: reply?.currency ?? rfq.currency,
      };
      const existing = byItem.get(itemId);
      if (existing === undefined) byItem.set(itemId, [badge]);
      else existing.push(badge);
    }
  }

  for (const badges of byItem.values()) {
    badges.sort(
      (a, b) =>
        ITEM_RFQ_BADGE_ORDER[a.tone] - ITEM_RFQ_BADGE_ORDER[b.tone] ||
        a.rfq.partnerName.localeCompare(b.rfq.partnerName, 'ko'),
    );
  }
  return byItem;
});

const rfqBadgesFor = (itemId: string): readonly ItemRfqBadge[] =>
  itemRfqBadges.value.get(itemId) ?? [];

function itemRfqBadgeTitle(badge: ItemRfqBadge): string {
  const requestScope = badge.rfq.requestedItemIds === null ? '전체 요청' : '부분 요청';
  const price =
    badge.unitPrice === null
      ? ''
      : ` · ${badge.unitPrice.toLocaleString('ko-KR')} ${badge.currency}`;
  return `${badge.rfq.partnerName} · ${requestScope} · ${badge.label}${price} — 클릭하면 회신을 엽니다`;
}

// ── 관리자 부품 교체(D25) — 업무 영향은 2차 확인 뒤 강제 변경 가능 ─────────
const candidateItem = computed(() =>
  candidateItemId.value === null
    ? null
    : detail.value?.items.find((item) => item.id === candidateItemId.value) ?? null,
);

function partMutationUnavailableReason(): string | null {
  const quote = detail.value;
  if (quote === null) return '견적 정보를 불러온 뒤 변경할 수 있습니다';
  if (quote.buildStatus !== 'ready' || quote.enrichStatus === 'searching') {
    return 'BOM 계산과 공급사 확인이 완료된 뒤 변경할 수 있습니다';
  }
  if (poQuery.isLoading.value || poQuery.isFetching.value) return '발주 이력을 확인하고 있습니다';
  if (poQuery.isError.value) return '발주 이력을 확인할 수 없어 변경을 잠갔습니다';
  if (rfqQuery.isLoading.value || rfqQuery.isFetching.value) return '협력사 RFQ 이력을 확인하고 있습니다';
  if (rfqQuery.isError.value) return '협력사 RFQ 이력을 확인할 수 없어 변경을 잠갔습니다';
  return null;
}

function partChangeUnavailableReason(_item: BomQuoteItemType): string | null {
  return partMutationUnavailableReason();
}

function partChangeForceReason(item: BomQuoteItemType): string | null {
  const quote = detail.value;
  if (quote === null) return null;
  if (quote.status !== 'requested' && quote.status !== 'reviewing') {
    return '이미 고객 회신 확정 또는 마감 단계에 진입한 견적입니다';
  }
  if (quote.orderState !== 'none' || quote.orderInfo !== null) {
    return '장바구니 또는 주문으로 전환된 견적입니다';
  }
  if (pos.value.length > 0) return '발주서가 생성된 견적입니다';
  if (rfqBadgesFor(item.id).length > 0) return '이 품목은 협력사 RFQ에 포함되어 있습니다';
  return null;
}

const candidateSelectionUnavailableReason = computed(() => {
  const item = candidateItem.value;
  return item === null ? '변경할 품목을 선택해 주세요' : partChangeUnavailableReason(item);
});
const candidateSelectionForceReason = computed(() => {
  const item = candidateItem.value;
  return item === null || candidateSelectionUnavailableReason.value !== null
    ? null
    : partChangeForceReason(item);
});
const candidateSelectionNotice = computed(
  () => candidateSelectionUnavailableReason.value ?? candidateSelectionForceReason.value,
);
const candidateForceSelectionAllowed = computed(
  () => candidateSelectionUnavailableReason.value === null && candidateSelectionForceReason.value !== null,
);

interface AdminPartSelectionImpact {
  forceReason: string | null;
  affectedRfqCount: number;
  invalidatedReplyCount: number;
  poCount: number;
  hasOrderSnapshot: boolean;
  reopensQuote: boolean;
}

function partSelectionImpact(item: BomQuoteItemType): AdminPartSelectionImpact {
  const quote = detail.value;
  const badges = rfqBadgesFor(item.id);
  return {
    forceReason: partChangeForceReason(item),
    affectedRfqCount: badges.length,
    invalidatedReplyCount: badges.filter((badge) => badge.unitPrice !== null).length,
    poCount: pos.value.length,
    hasOrderSnapshot: quote !== null && (quote.orderState !== 'none' || quote.orderInfo !== null),
    reopensQuote: quote !== null && quote.status !== 'requested' && quote.status !== 'reviewing',
  };
}

function partChangeButtonTitle(item: BomQuoteItemType): string {
  const unavailable = partChangeUnavailableReason(item);
  if (unavailable !== null) return `검색·비교 가능 · 현재 적용 불가: ${unavailable}`;
  const forceReason = partChangeForceReason(item);
  return forceReason === null
    ? '추천 후보 또는 전체 카탈로그에서 부품 검색·변경'
    : `검색·비교 가능 · 관리자 강제 변경: ${forceReason}`;
}

function openPartSelection(item: BomQuoteItemType, view: 'candidates' | 'search'): void {
  candidateSelectionError.value = '';
  candidateDrawerView.value = view;
  candidateItemId.value = item.id;
}

function closePartSelection(): void {
  candidateItemId.value = null;
  candidateSelectionError.value = '';
  pendingPartSelection.value = null;
  forcePartSelectionConfirmed.value = false;
}

interface PendingAdminPartSelection {
  body: AdminBomQuoteItemSelectionBodyType;
  previousMpn: string;
  nextMpn: string;
  nextManufacturer: string | null;
  nextSupplier: string | null;
  nextOrderQty: number;
  previousLineTotalKrw: number | null;
  nextLineTotalKrw: number | null;
  sourceLabel: string;
  impact: AdminPartSelectionImpact;
}

const pendingPartSelection = ref<PendingAdminPartSelection | null>(null);
const forcePartSelectionConfirmed = ref(false);
const pendingLineDelta = computed(() => {
  const pending = pendingPartSelection.value;
  const previousLineTotalKrw = pending?.previousLineTotalKrw;
  const nextLineTotalKrw = pending?.nextLineTotalKrw;
  if (
    previousLineTotalKrw === null
    || previousLineTotalKrw === undefined
    || nextLineTotalKrw === null
    || nextLineTotalKrw === undefined
  ) return null;
  return Math.round((nextLineTotalKrw - previousLineTotalKrw) * 100) / 100;
});

function requestCandidateSelection(candidateKey: string, offerKey: string | null): void {
  const item = candidateItem.value;
  const quote = detail.value;
  const context = candidateQuery.data.value?.data;
  if (item === null || quote === null || context === undefined) return;
  const unavailableReason = partChangeUnavailableReason(item);
  if (unavailableReason !== null) {
    candidateSelectionError.value = unavailableReason;
    return;
  }
  const candidate: BomQuoteCandidateType | undefined = context.candidates.find(
    (entry) => entry.candidateKey === candidateKey,
  );
  if (candidate === undefined) {
    candidateSelectionError.value = '선택 후보를 찾을 수 없습니다. 후보를 새로고침해 주세요.';
    return;
  }
  const appliedOfferKey = offerKey ?? candidate.bestOfferKey;
  const offer = appliedOfferKey === null
    ? null
    : candidate.offers.find((entry) => entry.offerKey === appliedOfferKey) ?? null;
  const impact = partSelectionImpact(item);
  forcePartSelectionConfirmed.value = false;
  pendingPartSelection.value = {
    body: {
      kind: 'candidate',
      candidateKey,
      offerKey,
      expectedQuoteUpdatedAt: quote.updatedAt,
      force: impact.forceReason !== null,
    },
    previousMpn: item.mpn,
    nextMpn: candidate.mpn,
    nextManufacturer: candidate.manufacturerName,
    nextSupplier: offer?.supplier ?? null,
    nextOrderQty: offer?.applied?.orderQty ?? neededQty(item.bomQty, quote.setQty, quote.spareQty),
    previousLineTotalKrw: item.lineTotalKrw,
    nextLineTotalKrw: offer?.applied?.lineTotalKrw ?? null,
    sourceLabel: '엔진 후보',
    impact,
  };
}

function requestCatalogSelection(part: PartHitType, pick: OfferPick | null): void {
  const item = candidateItem.value;
  const quote = detail.value;
  if (item === null || quote === null) return;
  const unavailableReason = partChangeUnavailableReason(item);
  if (unavailableReason !== null) {
    candidateSelectionError.value = unavailableReason;
    return;
  }
  const nextLineTotalKrw = pick?.unitPriceKrw === null || pick?.unitPriceKrw === undefined
    ? null
    : Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
  const impact = partSelectionImpact(item);
  forcePartSelectionConfirmed.value = false;
  pendingPartSelection.value = {
    body: {
      kind: 'catalog',
      partId: part.id,
      offer: pick === null
        ? null
        : { supplier: pick.offer.supplier, supplierSku: pick.offer.supplierSku },
      expectedQuoteUpdatedAt: quote.updatedAt,
      force: impact.forceReason !== null,
    },
    previousMpn: item.mpn,
    nextMpn: part.mpn,
    nextManufacturer: part.manufacturerName,
    nextSupplier: pick?.offer.supplier ?? (part.hasCatalogInquiryOffer ? '문의 견적' : null),
    nextOrderQty: pick?.orderQty ?? neededQty(item.bomQty, quote.setQty, quote.spareQty),
    previousLineTotalKrw: item.lineTotalKrw,
    nextLineTotalKrw,
    sourceLabel: '전체 카탈로그',
    impact,
  };
}

function cancelPendingPartSelection(): void {
  if (candidateSelection.isPending.value) return;
  pendingPartSelection.value = null;
  forcePartSelectionConfirmed.value = false;
}

async function confirmPartSelection(): Promise<void> {
  const pending = pendingPartSelection.value;
  const quoteId = detailId.value;
  const itemId = candidateItemId.value;
  if (pending === null || quoteId === null || itemId === null) return;
  if (pending.body.force && !forcePartSelectionConfirmed.value) return;
  candidateSelectionError.value = '';
  try {
    await candidateSelection.mutateAsync({ quoteId, itemId, body: pending.body });
    if (pending.body.force) await rfqQuery.refetch();
    pendingPartSelection.value = null;
    closePartSelection();
  } catch (error) {
    candidateSelectionError.value = error instanceof ApiRequestError
      ? error.payload?.message ?? error.message
      : '부품 변경을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    pendingPartSelection.value = null;
    forcePartSelectionConfirmed.value = false;
    await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
  }
}

// ── 관리자 부품 추가·수동 행 제거(D26) ───────────────────────────────────
// 업로드 원본 행은 제거하지 않는다. 추가는 카탈로그 정체성과 세트당 수량만 전송하며
// 서버가 현재 구매 조건·MOQ·주문배수·환율과 RFQ 범위를 트랜잭션 안에서 다시 판단한다.
interface AdminPartAddImpact {
  forceReason: string | null;
  dynamicFullRfqCount: number;
  partialRfqCount: number;
  poCount: number;
  hasOrderSnapshot: boolean;
  reopensQuote: boolean;
}

interface PendingAdminPartAdd {
  body: AdminBomQuoteItemAddBodyType;
  mpn: string;
  manufacturerName: string | null;
  supplier: string | null;
  needed: number;
  orderQty: number;
  lineTotalKrw: number | null;
  impact: AdminPartAddImpact;
}

const partAddOpen = ref(false);
const partAddError = ref('');
const pendingPartAdd = ref<PendingAdminPartAdd | null>(null);
const forcePartAddConfirmed = ref(false);
const partAddUnavailableReason = computed(() => partMutationUnavailableReason());

function partAddForceReason(): string | null {
  const quote = detail.value;
  if (quote === null) return null;
  if (quote.status !== 'requested' && quote.status !== 'reviewing') {
    return '이미 고객 회신 확정 또는 마감 단계에 진입한 견적입니다';
  }
  if (quote.orderState !== 'none' || quote.orderInfo !== null) {
    return '장바구니 또는 주문으로 전환된 견적입니다';
  }
  if (pos.value.length > 0) return '발주서가 생성된 견적입니다';
  if (rfqs.value.length > 0) return '협력사 RFQ가 이미 발송된 견적입니다';
  return null;
}

function partAddImpact(): AdminPartAddImpact {
  const quote = detail.value;
  return {
    forceReason: partAddForceReason(),
    dynamicFullRfqCount: rfqs.value.filter((rfq) => rfq.requestedItemIds === null).length,
    partialRfqCount: rfqs.value.filter((rfq) => rfq.requestedItemIds !== null).length,
    poCount: pos.value.length,
    hasOrderSnapshot: quote !== null && (quote.orderState !== 'none' || quote.orderInfo !== null),
    reopensQuote: quote !== null && quote.status !== 'requested' && quote.status !== 'reviewing',
  };
}

function openPartAdd(): void {
  partAddError.value = '';
  pendingPartAdd.value = null;
  forcePartAddConfirmed.value = false;
  partAddOpen.value = true;
}

function closePartAdd(): void {
  if (partAdd.isPending.value) return;
  partAddOpen.value = false;
  partAddError.value = '';
  pendingPartAdd.value = null;
  forcePartAddConfirmed.value = false;
}

function requestPartAdd(part: PartHitType, pick: OfferPick | null, bomQty: number): void {
  const quote = detail.value;
  const unavailableReason = partMutationUnavailableReason();
  if (quote === null || unavailableReason !== null) {
    partAddError.value = unavailableReason ?? '견적 정보를 다시 불러와 주세요.';
    return;
  }
  const needed = neededQty(bomQty, quote.setQty, quote.spareQty);
  const impact = partAddImpact();
  const lineTotalKrw = pick?.unitPriceKrw === null || pick?.unitPriceKrw === undefined
    ? null
    : Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
  forcePartAddConfirmed.value = false;
  pendingPartAdd.value = {
    body: {
      partId: part.id,
      offer: pick === null
        ? null
        : { supplier: pick.offer.supplier, supplierSku: pick.offer.supplierSku },
      bomQty,
      expectedQuoteUpdatedAt: quote.updatedAt,
      force: impact.forceReason !== null,
    },
    mpn: part.mpn,
    manufacturerName: part.manufacturerName,
    supplier: pick?.offer.supplier ?? (part.hasCatalogInquiryOffer ? '문의 견적' : null),
    needed,
    orderQty: pick?.orderQty ?? needed,
    lineTotalKrw,
    impact,
  };
}

function cancelPendingPartAdd(): void {
  if (partAdd.isPending.value) return;
  pendingPartAdd.value = null;
  forcePartAddConfirmed.value = false;
}

async function confirmPartAdd(): Promise<void> {
  const pending = pendingPartAdd.value;
  const quoteId = detailId.value;
  if (pending === null || quoteId === null) return;
  if (pending.body.force && !forcePartAddConfirmed.value) return;
  partAddError.value = '';
  try {
    await partAdd.mutateAsync({ quoteId, body: pending.body });
    if (pending.impact.dynamicFullRfqCount > 0) await rfqQuery.refetch();
    closePartAdd();
  } catch (error) {
    partAddError.value = error instanceof ApiRequestError
      ? error.payload?.message ?? error.message
      : '부품을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    pendingPartAdd.value = null;
    forcePartAddConfirmed.value = false;
    await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
  }
}

interface PendingAdminPartRemove {
  item: BomQuoteItemType;
  body: AdminBomQuoteItemRemoveBodyType;
  impact: AdminPartSelectionImpact;
}

const pendingPartRemove = ref<PendingAdminPartRemove | null>(null);
const forcePartRemoveConfirmed = ref(false);
const partRemoveError = ref('');

function isManualQuoteItem(item: BomQuoteItemType): boolean {
  return item.manualEntry === true;
}

function requestPartRemove(item: BomQuoteItemType): void {
  const quote = detail.value;
  if (quote === null || !isManualQuoteItem(item)) return;
  const unavailableReason = partChangeUnavailableReason(item);
  if (unavailableReason !== null) {
    partRemoveError.value = unavailableReason;
    return;
  }
  const impact = partSelectionImpact(item);
  partRemoveError.value = '';
  forcePartRemoveConfirmed.value = false;
  pendingPartRemove.value = {
    item,
    body: {
      expectedQuoteUpdatedAt: quote.updatedAt,
      force: impact.forceReason !== null,
    },
    impact,
  };
}

function cancelPendingPartRemove(): void {
  if (partRemove.isPending.value) return;
  pendingPartRemove.value = null;
  forcePartRemoveConfirmed.value = false;
}

async function confirmPartRemove(): Promise<void> {
  const pending = pendingPartRemove.value;
  const quoteId = detailId.value;
  if (pending === null || quoteId === null) return;
  if (pending.body.force && !forcePartRemoveConfirmed.value) return;
  partRemoveError.value = '';
  try {
    await partRemove.mutateAsync({ quoteId, itemId: pending.item.id, body: pending.body });
    const nextSelection = new Set(rfqItemSelection.value);
    nextSelection.delete(pending.item.id);
    rfqItemSelection.value = nextSelection;
    if (pending.impact.affectedRfqCount > 0) await rfqQuery.refetch();
    pendingPartRemove.value = null;
    forcePartRemoveConfirmed.value = false;
  } catch (error) {
    partRemoveError.value = error instanceof ApiRequestError
      ? error.payload?.message ?? error.message
      : '수동 추가 부품을 제거하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    pendingPartRemove.value = null;
    forcePartRemoveConfirmed.value = false;
    await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
  }
}

// ── 발주(D18) — 결제 확인 후 발행, all-or-nothing ───────────────────────────
const poCreateOpen = ref(false);
const poError = ref('');
// 선적 관리(D21) — 대상 발주서를 모달로
const shipmentPo = ref<AdminBomPoViewType | null>(null);
const createPos = useCreateBomPos();
const deletePo = useDeleteBomPo();
const closePo = useCloseBomPo();
const executeExternal = useExecuteExternalPo();
const poBusy = computed(
  () =>
    createPos.isPending.value ||
    deletePo.isPending.value ||
    closePo.isPending.value ||
    executeExternal.isPending.value,
);

async function retryExternalPo(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  poError.value = '';
  try {
    await executeExternal.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '외부 실행에 실패했습니다.';
  }
}
const PO_TERMINAL_ORDER_STATUSES = new Set(['완료', '취소', '반품', '품절']);
const PO_TERMINAL_LINE_STATUSES = new Set(['완료', '취소', '반품', '품절', '삭제']);
const canIssuePo = computed(() => {
  const info = detail.value?.orderInfo;
  return info?.isPaid === true
    && !PO_TERMINAL_ORDER_STATUSES.has(info.odStatus)
    && !PO_TERMINAL_LINE_STATUSES.has(info.ctStatus);
});
const issueDisabledReason = computed(() => {
  if (detail.value?.orderState === 'canceled') {
    return '취소된 주문입니다. 고객이 다시 주문하고 입금된 뒤 발주할 수 있습니다';
  }
  if (detail.value?.orderState !== 'ordered') return '고객 주문 후에 발주할 수 있습니다';
  if (detail.value.orderInfo !== null && PO_TERMINAL_LINE_STATUSES.has(detail.value.orderInfo.ctStatus)) {
    return `BOM 주문 항목 상태가 ${detail.value.orderInfo.ctStatus}이므로 발주서를 추가할 수 없습니다`;
  }
  if (detail.value.orderInfo?.isPaid !== true) return '결제 확인(입금) 후에 발주할 수 있습니다';
  if (detail.value.orderInfo.odStatus === '완료') return '완료된 주문에는 발주서를 추가할 수 없습니다';
  if (PO_TERMINAL_ORDER_STATUSES.has(detail.value.orderInfo.odStatus)) {
    return `주문 상태가 ${detail.value.orderInfo.odStatus}이므로 발주서를 추가할 수 없습니다`;
  }
  return '';
});

async function removePo(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  if (
    !(await confirmDialog({
      message: `'${po.partnerName}' 발주서 발행을 취소할까요? (미확인 발주서만 가능)`,
      confirmLabel: '발행 취소',
      tone: 'danger',
    }))
  ) {
    return;
  }
  poError.value = '';
  try {
    await deletePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '발행 취소에 실패했습니다.';
  }
}

async function closePoRow(po: { poId: number; partnerName: string }): Promise<void> {
  if (detailId.value === null) return;
  if (!(await confirmDialog(`'${po.partnerName}' 발주서를 마감할까요?`))) return;
  poError.value = '';
  try {
    await closePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
  } catch (e) {
    poError.value = e instanceof ApiRequestError ? e.message : '마감에 실패했습니다.';
  }
}

// ── RFQ 발송·대리 입력·비교 선정 ────────────────────────────────────────────
const sendOpen = ref(false);
const compareOpen = ref(false);
const replyRfq = ref<AdminBomRfqViewType | null>(null);
const replyError = ref('');
const rfqReply = useAdminRfqReply();

function openRfqReply(rfq: AdminBomRfqViewType): void {
  replyRfq.value = rfq;
  replyError.value = '';
}

// 매직링크 재발급(§6.9) — 확인은 패널이 담당, 여기선 호출만.
const reissueLink = useReissueRfqMagicLink();
function reissueMagicLink(rfq: AdminBomRfqViewType): void {
  if (detailId.value === null) return;
  void reissueLink.mutateAsync({ quoteId: detailId.value, rfqId: rfq.rfqId });
}

const replyRows = computed<RfqReplyFormRow[]>(() => {
  const rfq = replyRfq.value;
  if (rfq === null) return [];
  const replyByItem = new Map(rfq.items.map((item) => [item.quoteItemId, item]));
  const visibleItems =
    rfq.requestedItemIds === null
      ? scopeItems.value
      : scopeItems.value.filter((item) => rfq.requestedItemIds?.includes(item.id) === true);
  return visibleItems.map((item) => {
    const reply = replyByItem.get(item.id);
    const price = reply?.unitPrice ?? null;
    return {
      quoteItemId: item.id,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderQty: item.orderQty,
      reply:
        reply === undefined || price === null
          ? null
          : {
              unitPrice: price,
              replyQty: reply.replyQty,
              moq: reply.moq,
              stock: reply.stock,
              dateCode: reply.dateCode,
              leadTime: reply.leadTime,
              memo: reply.memo,
            },
    };
  });
});

async function submitReply(body: BomRfqReplyBodyType): Promise<void> {
  if (detailId.value === null || replyRfq.value === null) return;
  replyError.value = '';
  try {
    await rfqReply.mutateAsync({ quoteId: detailId.value, rfqId: replyRfq.value.rfqId, body });
    replyRfq.value = null;
  } catch (e) {
    replyError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

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
const emailActionFeedback = ref<{
  tone: 'success' | 'warning' | 'error';
  text: string;
} | null>(null);

watch(detailId, () => {
  completionOpen.value = false;
  resendEmailOpen.value = false;
  quoteClosingOpen.value = false;
  emailActionFeedback.value = null;
});

// 확정가 = 토글식 직접 입력 — 기본은 예상(자동) 금액만 보여 관리자 혼동을 막는다.
// 토글 OFF 저장 = 확정 해제(고객에게 예상 금액 안내), ON 시 예상값으로 프리필.
const confirmedOverride = ref(false);

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
  form.value = {
    adminMemo: d.adminMemo ?? '',
    answerNote: d.answerNote ?? '',
    confirmedShippingFee: d.confirmedShippingFee,
    confirmedManagementFee: d.confirmedManagementFee,
    confirmedTotal: d.confirmedTotal,
  };
  confirmedOverride.value =
    d.confirmedShippingFee !== null || d.confirmedManagementFee !== null || d.confirmedTotal !== null;
  actionError.value = '';
});

function toggleConfirmedOverride(): void {
  if (!reviewEditable.value) return;
  confirmedOverride.value = !confirmedOverride.value;
  const d = detail.value;
  if (!confirmedOverride.value || d === null) return;
  // 켜는 순간 예상값(운송료·관리비 기본값 + 선정 반영 총액)으로 제안 프리필 — 기존 확정값은 유지.
  form.value.confirmedShippingFee ??= d.shippingFee;
  form.value.confirmedManagementFee ??= d.managementFee;
  form.value.confirmedTotal ??= d.finalTotal;
}

// v-model.number 는 빈 입력을 '' 로 만들 수 있어 저장 직전 정규화한다.
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const finalConfirmedTotal = computed(() =>
  confirmedOverride.value ? numOrNull(form.value.confirmedTotal) : null,
);

// 부가세는 저장·계산하지 않는 정책(전 금액 VAT 별도) — 참고 환산 표시만 한다.
const withVat = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 1.1).toLocaleString('ko-KR')}원`;
const confirmedTotalVat = computed(() => withVat(numOrNull(form.value.confirmedTotal)));

function itemRows(item: BomQuoteItemType): number[] {
  const value = item.sourceRow?.sourceRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0);
}

function itemLocation(item: BomQuoteItemType): string {
  const rows = itemRows(item);
  if (item.sourceSheetName === null) return '수동 추가';
  return rows.length === 0 ? item.sourceSheetName : `${item.sourceSheetName} · ${rows.join(', ')}행`;
}

function itemLabel(item: BomQuoteItemType): string {
  if (item.mpn.trim() !== '') return item.mpn;
  const raw = item.sourceRow?.valueRaw;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : '품번 미기재';
}

type AdminItemFilter =
  | 'all'
  | 'attention'
  | 'blocking'
  | 'procurement'
  | 'technical'
  | 'inquiry'
  | 'ready'
  | 'excluded';

interface AdminItemView {
  item: AdminBomQuoteItemType;
  attention: BomQuoteAdminAttention;
  pending: boolean;
}

const ADMIN_ATTENTION_META: Record<BomQuoteAdminAttentionKind, {
  label: string;
  badgeClass: string;
  rowClass: string;
  priority: number;
}> = {
  blocking: {
    label: '즉시 처리',
    badgeClass: 'border-red-300 bg-red-100 text-red-800',
    rowClass: 'border-l-4 border-l-red-500 bg-red-50/70',
    priority: 0,
  },
  procurement: {
    label: '구매 확인',
    badgeClass: 'border-orange-300 bg-orange-100 text-orange-800',
    rowClass: 'border-l-4 border-l-orange-400 bg-orange-50/65',
    priority: 1,
  },
  technical: {
    label: '기술 검토',
    badgeClass: 'border-amber-300 bg-amber-100 text-amber-800',
    rowClass: 'border-l-4 border-l-amber-400 bg-amber-50/55',
    priority: 2,
  },
  inquiry: {
    label: '문의 진행',
    badgeClass: 'border-blue-300 bg-blue-100 text-blue-800',
    rowClass: 'border-l-4 border-l-blue-400 bg-blue-50/55',
    priority: 3,
  },
  ready: {
    label: '정상',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rowClass: 'border-l-4 border-l-transparent bg-surface',
    priority: 4,
  },
  excluded: {
    label: '제외',
    badgeClass: 'border-gray-200 bg-gray-100 text-gray-500',
    rowClass: 'border-l-4 border-l-gray-300 bg-gray-50/70 opacity-55',
    priority: 5,
  },
};

const ADMIN_ATTENTION_REASON_LABEL: Record<BomQuoteAdminAttentionReason, string> = {
  quantity_missing: '수량 확인 필요',
  unmatched: '매칭 없음',
  uncosted: '금액 미산출',
  out_of_stock: '재고 없음',
  insufficient_stock: '재고 부족',
  stock_unverified: '재고 미확인',
  selected_stock_short: '선정 재고 부족',
  replacement_pending: '대체품 확인 필요',
  confirmation_required: '엔진 선정 확인 필요',
  engine_review: '엔진 검토 대상',
  lifecycle_attention: '단종·수명주기 확인',
  requirement_conflict: '스펙 정보 충돌',
  requirement_missing: '필수 스펙 누락',
  technical_fallback: '구매 가능 차순위 선정',
  supplier_search_limited: '일부 공급사 미검색',
  catalog_inquiry: '가격·재고 문의',
};

const adminItemFilter = ref<AdminItemFilter>('all');
const adminItemSearch = ref('');
// 기본은 원본 Excel 행 순서. 관리자가 필요할 때만 확인 대상을 앞으로 모은다.
const attentionFirst = ref(false);
const itemReviewError = ref('');
const reviewingItemIds = ref<Set<string>>(new Set());
const ADMIN_ITEM_FILTER_OPTIONS: readonly { key: AdminItemFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'attention', label: '확인 필요' },
  { key: 'blocking', label: '즉시 처리' },
  { key: 'procurement', label: '구매 확인' },
  { key: 'technical', label: '기술 검토' },
  { key: 'inquiry', label: '문의' },
  { key: 'ready', label: '정상·완료' },
  { key: 'excluded', label: '제외' },
];

const adminItemViews = computed<AdminItemView[]>(() => (detail.value?.items ?? []).map((item) => {
  const attention = bomQuoteAdminAttention(item);
  return {
    item,
    attention,
    pending: attention.reviewRequired && !item.adminReview.completed,
  };
}));

const adminItemFilterCounts = computed<Record<AdminItemFilter, number>>(() => {
  const counts: Record<AdminItemFilter, number> = {
    all: adminItemViews.value.length,
    attention: 0,
    blocking: 0,
    procurement: 0,
    technical: 0,
    inquiry: 0,
    ready: 0,
    excluded: 0,
  };
  for (const view of adminItemViews.value) {
    if (view.pending) {
      counts.attention += 1;
      if (
        view.attention.kind === 'blocking'
        || view.attention.kind === 'procurement'
        || view.attention.kind === 'technical'
        || view.attention.kind === 'inquiry'
      ) {
        counts[view.attention.kind] += 1;
      }
    } else if (view.attention.kind === 'excluded') {
      counts.excluded += 1;
    } else {
      counts.ready += 1;
    }
  }
  return counts;
});

const adminReviewPendingCount = computed(() => adminItemFilterCounts.value.attention);

const visibleAdminItemViews = computed(() => {
  const query = adminItemSearch.value.trim().toLocaleLowerCase('ko-KR');
  const matchesFilter = (view: AdminItemView): boolean => {
    if (adminItemFilter.value === 'all') return true;
    if (adminItemFilter.value === 'attention') return view.pending;
    if (adminItemFilter.value === 'ready') {
      return view.attention.kind !== 'excluded' && !view.pending;
    }
    if (adminItemFilter.value === 'excluded') return view.attention.kind === 'excluded';
    return view.pending && view.attention.kind === adminItemFilter.value;
  };
  const result = adminItemViews.value.filter((view) => {
    if (!matchesFilter(view)) return false;
    if (query === '') return true;
    const item = view.item;
    return [
      itemLabel(item),
      item.manufacturerName ?? '',
      item.description ?? '',
      item.sourceSheetName ?? '',
      itemLocation(item),
      item.selectedOffer?.supplier ?? '',
    ].some((value) => value.toLocaleLowerCase('ko-KR').includes(query));
  });
  if (!attentionFirst.value) return [...result].sort((a, b) => a.item.rowIdx - b.item.rowIdx);
  return [...result].sort((left, right) => {
    const leftPriority = left.pending ? ADMIN_ATTENTION_META[left.attention.kind].priority : 4;
    const rightPriority = right.pending ? ADMIN_ATTENTION_META[right.attention.kind].priority : 4;
    return leftPriority - rightPriority || left.item.rowIdx - right.item.rowIdx;
  });
});

const visiblePendingReviewIds = computed(() =>
  visibleAdminItemViews.value.filter((view) => view.pending).map((view) => view.item.id),
);

const canUpdateItemReview = computed(() =>
  detail.value?.status === 'requested' || detail.value?.status === 'reviewing',
);

const adminReviewSummaryLabel = computed(() => {
  if (adminReviewPendingCount.value === 0) return '확인 완료';
  if (canUpdateItemReview.value) return `${String(adminReviewPendingCount.value)}건 남음`;
  return `${String(adminReviewPendingCount.value)}건 확인 기록 없음`;
});

const adminReviewSummaryClass = computed(() => {
  if (adminReviewPendingCount.value === 0) return 'bg-emerald-100 text-emerald-700';
  return canUpdateItemReview.value
    ? 'bg-red-100 text-red-700'
    : 'bg-gray-200 text-gray-600';
});

function adminAttentionTitle(view: AdminItemView): string {
  const reasons = view.attention.reasons.map((reason) => ADMIN_ATTENTION_REASON_LABEL[reason]);
  if (view.item.adminReview.stale) reasons.unshift('품목 변경으로 이전 확인 무효');
  if (view.item.adminReview.completed && view.item.adminReview.reviewedBy !== null) {
    reasons.unshift(`확인: ${view.item.adminReview.reviewedBy}`);
  }
  return reasons.length === 0 ? ADMIN_ATTENTION_META[view.attention.kind].label : reasons.join('\n');
}

function adminAttentionReasonSummary(view: AdminItemView): string {
  const labels = view.attention.reasons
    .slice(0, 2)
    .map((reason) => ADMIN_ATTENTION_REASON_LABEL[reason]);
  const suffix = view.attention.reasons.length > 2
    ? ` 외 ${String(view.attention.reasons.length - 2)}`
    : '';
  return `${labels.join(' · ')}${suffix}`;
}

function adminAttentionRowClass(view: AdminItemView): string {
  if (!view.pending && view.attention.kind !== 'excluded') {
    return 'border-l-4 border-l-transparent bg-surface';
  }
  return ADMIN_ATTENTION_META[view.attention.kind].rowClass;
}

async function updateItemReviews(itemIds: readonly string[], completed: boolean): Promise<void> {
  const quote = detail.value;
  if (detailId.value === null || quote === null || itemIds.length === 0) return;
  itemReviewError.value = '';
  reviewingItemIds.value = new Set(itemIds);
  try {
    await itemReview.mutateAsync({
      quoteId: detailId.value,
      body: {
        itemIds: [...itemIds],
        completed,
        expectedQuoteUpdatedAt: quote.updatedAt,
      },
    });
  } catch (error) {
    itemReviewError.value = error instanceof ApiRequestError
      ? (error.payload?.message ?? error.message)
      : '품목 검토 상태를 저장하지 못했습니다.';
  } finally {
    reviewingItemIds.value = new Set();
  }
}

function reviewFields() {
  return {
    adminMemo: form.value.adminMemo === '' ? null : form.value.adminMemo,
    answerNote: form.value.answerNote === '' ? null : form.value.answerNote,
    // 토글 OFF = 확정 해제(null). 검토 중에는 관리자 초안으로만 저장한다.
    confirmedShippingFee: confirmedOverride.value ? numOrNull(form.value.confirmedShippingFee) : null,
    confirmedManagementFee: confirmedOverride.value ? numOrNull(form.value.confirmedManagementFee) : null,
    confirmedTotal: finalConfirmedTotal.value,
  };
}

async function saveReview(nextStatus?: BomQuoteStatusType): Promise<void> {
  if (detailId.value === null) return;
  actionError.value = '';
  try {
    await patch.mutateAsync({
      quoteId: detailId.value,
      body: {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...reviewFields(),
      },
    });
  } catch (error) {
    actionError.value = error instanceof ApiRequestError
      ? (error.payload?.message ?? error.message)
      : '저장에 실패했습니다 — 상태 전이 가능 여부를 확인하세요.';
  }
}

function emailFeedback(
  delivery: AdminBomQuoteEmailDeliveryType,
  action: 'complete' | 'resend' = 'complete',
): {
  tone: 'success' | 'warning' | 'error';
  text: string;
} {
  if (delivery.status === 'sent') {
    return {
      tone: 'success',
      text: action === 'resend'
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
      await patch.mutateAsync({
        quoteId: detailId.value,
        body: reviewFields(),
      });
    } catch (error) {
      const message = error instanceof ApiRequestError
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
    completionError.value = error instanceof ApiRequestError
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
    const response = await sendAnswerEmail.mutateAsync({
      quoteId: detailId.value,
      body: { toEmail },
    });
    resendEmailOpen.value = false;
    emailActionFeedback.value = emailFeedback(response.data, 'resend');
  } catch (error) {
    resendEmailError.value = error instanceof ApiRequestError
      ? (error.payload?.message ?? error.message)
      : '회신 이메일을 다시 보내지 못했습니다.';
  }
}

function openQuoteClosing(event?: Event): void {
  if (detail.value?.status !== 'answered') {
    actionError.value = '고객 회신이 확정된 견적만 마감할 수 있습니다.';
    return;
  }
  const trigger = event?.currentTarget;
  if (trigger instanceof HTMLElement) trigger.closest('details')?.removeAttribute('open');
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
    await patch.mutateAsync({
      quoteId: detailId.value,
      body: { status: 'closed' },
    });
    quoteClosingOpen.value = false;
  } catch (error) {
    quoteClosingError.value = error instanceof ApiRequestError
      ? (error.payload?.message ?? error.message)
      : '견적을 마감하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.';
  }
}

const emailActionFeedbackClass = computed(() => {
  if (emailActionFeedback.value?.tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (emailActionFeedback.value?.tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-red-200 bg-red-50 text-red-700';
});

async function downloadOriginal(): Promise<void> {
  const fileUrl = detail.value?.fileUrl ?? null;
  if (fileUrl === null) return;
  const blob = await apiGetBlob(fileUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = detail.value?.fileName ?? 'bom.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="admin-case-readable space-y-4">
    <!-- 헤더 -->
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'admin-smartbom' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 진행현황
      </RouterLink>
      <template v-if="detail !== null">
        <span class="font-mono text-xs text-gray-500">
          {{ smartbomCaseNo(detail.id, detail.requestedAt, detail.createdAt) }}
        </span>
        <h1 class="text-xl font-bold">{{ detail.title }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="SMARTBOM_STATUS_META[detail.status].cls">
          {{ SMARTBOM_STATUS_META[detail.status].label }}
        </span>
        <!-- 견적서(§6.8) — 확정 전이면 시트가 "가안" 표기 -->
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="patch.isPending.value"
          @click="openEstimatePreview"
        >
          견적서 미리보기
        </button>
        <!-- 빠른 메일(§6.15) — 고객에게 바로 한 통 -->
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
          @click="mailOpen = true"
        >
          메일
        </button>
      </template>
    </div>

    <BomEstimateModal
      v-if="detailId !== null"
      :open="estimateOpen"
      :load="loadEstimatePrint"
      @close="estimateOpen = false"
    />

    <!-- 고객 회신 확정 — 검토 결과·가안 견적서·이메일 선택을 한 자리에서 최종 점검한다. -->
    <div
      v-if="completionOpen && detail !== null"
      class="fixed inset-0 z-[55] grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smartbom-completion-title"
    >
      <div class="max-h-[calc(100dvh-2rem)] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="smartbom-completion-title" class="text-base font-bold text-gray-900">고객 회신 확정</h2>
            <p class="mt-1 text-xs leading-5 text-gray-500">검토 결과와 고객에게 전달할 내용을 마지막으로 확인해 주세요.</p>
          </div>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-lg text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            :disabled="completeReview.isPending.value"
            aria-label="고객 회신 확정 확인 닫기"
            @click="completionOpen = false"
          >
            ×
          </button>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-xs">
          <div>
            <dt class="text-gray-400">품목 확인</dt>
            <dd class="mt-1 font-semibold text-gray-800">{{ adminReviewPendingCount === 0 ? '모두 완료' : `${adminReviewPendingCount}건 남음` }}</dd>
          </div>
          <div>
            <dt class="text-gray-400">확정 총액(VAT 별도)</dt>
            <dd class="mt-1 font-semibold" :class="finalConfirmedTotal === null ? 'text-amber-600' : 'text-gray-800'">
              {{ finalConfirmedTotal === null ? '미등록' : smartbomFmtWon(finalConfirmedTotal) }}
            </dd>
          </div>
        </dl>

        <p v-if="detail.uncostedCount > 0" class="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-amber-900">
          금액 미산정 품목 {{ detail.uncostedCount }}건은 확정 견적과 고객 주문 금액에 포함되지 않습니다. 회신 메모에도 조달 범위를 안내해 주세요.
        </p>

        <div class="mt-3 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
          <p class="text-xs leading-5 text-blue-800">고객에게 보일 견적서를 가안 상태로 먼저 확인할 수 있습니다.</p>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="patch.isPending.value || completeReview.isPending.value"
            @click="openEstimatePreview"
          >
            견적서 미리보기
          </button>
        </div>

        <div class="mt-3 rounded-xl border border-gray-200 px-3 py-3">
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="completionSendEmail" type="checkbox" class="mt-0.5 size-4 rounded border-gray-300 text-blue-600">
            <span>
              <span class="block text-sm font-semibold text-gray-800">고객에게 견적 회신 이메일 보내기</span>
              <span class="mt-0.5 block text-xs leading-5 text-gray-500">기본 선택이며 아래 주소로 발송합니다.</span>
            </span>
          </label>
          <label class="mt-3 block border-t border-gray-100 pt-3 text-xs font-semibold text-gray-600">
            받는 이메일
            <input
              v-model.trim="completionEmail"
              type="email"
              inputmode="email"
              autocomplete="off"
              placeholder="customer@example.com"
              class="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm font-normal text-gray-800 outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
              :class="completionEmailValid ? 'border-gray-300 focus:border-blue-400' : 'border-red-300 focus:border-red-400'"
              :disabled="!completionSendEmail || completeReview.isPending.value"
            >
          </label>
          <p class="mt-1.5 text-[11px] leading-4 text-gray-400">
            고객 회원정보의 이메일을 기본값으로 채웁니다. 수정한 주소는 이번 발송에만 사용하며 회원정보는 변경하지 않습니다.
          </p>
          <p v-if="!completionEmailValid" class="mt-1 text-[11px] text-red-600">올바른 받는 이메일 주소를 입력해 주세요.</p>
        </div>

        <label
          v-if="finalConfirmedTotal === null"
          class="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3"
        >
          <input v-model="completionWithoutPriceConfirmed" type="checkbox" class="mt-0.5 size-4 rounded border-amber-400 text-amber-600">
          <span class="text-xs leading-5 text-amber-800">
            확정 총액 없이 고객 회신을 확정하면 주문하기와 확정 견적서 인쇄를 사용할 수 없음을 확인했습니다.
          </span>
        </label>

        <p v-if="completionError !== ''" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{{ completionError }}</p>

        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            :disabled="completeReview.isPending.value"
            @click="completionOpen = false"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="patch.isPending.value || completeReview.isPending.value || !completionEmailValid || adminReviewPendingCount > 0 || (finalConfirmedTotal === null && !completionWithoutPriceConfirmed)"
            @click="submitCompletion"
          >
            {{ completeReview.isPending.value ? '회신 확정 중…' : '고객 회신 확정' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 회신 이메일 재발송은 상태를 바꾸지 않는 별도 명령이다. -->
    <div
      v-if="resendEmailOpen && detail !== null"
      class="fixed inset-0 z-[55] grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smartbom-resend-title"
    >
      <div class="w-full max-w-[420px] rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <h2 id="smartbom-resend-title" class="text-base font-bold text-gray-900">회신 이메일 다시 보내기</h2>
        <p class="mt-2 text-xs leading-5 text-gray-500">
          현재 확정 금액과 회신 메모로 공식 회신 이메일을 다시 보냅니다. 회신 상태와 완료 시각은 변경되지 않습니다.
        </p>
        <label class="mt-4 block text-xs font-semibold text-gray-600">
          받는 이메일
          <input
            v-model.trim="resendEmail"
            type="email"
            inputmode="email"
            autocomplete="off"
            placeholder="customer@example.com"
            class="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm font-normal text-gray-800 outline-none"
            :class="resendEmailValid ? 'border-gray-300 focus:border-blue-400' : 'border-red-300 focus:border-red-400'"
            :disabled="sendAnswerEmail.isPending.value"
          >
        </label>
        <p class="mt-1.5 text-[11px] leading-4 text-gray-400">
          고객 회원정보의 이메일이 기본값입니다. 수정해도 이번 재발송에만 적용됩니다.
        </p>
        <p v-if="!resendEmailValid" class="mt-1 text-[11px] text-red-600">올바른 받는 이메일 주소를 입력해 주세요.</p>
        <p v-if="resendEmailError !== ''" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{{ resendEmailError }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            :disabled="sendAnswerEmail.isPending.value"
            @click="resendEmailOpen = false"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="sendAnswerEmail.isPending.value || !resendEmailValid"
            @click="resendAnswerEmail"
          >
            {{ sendAnswerEmail.isPending.value ? '발송 중…' : '이메일 다시 보내기' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 견적 마감은 Case 완료가 아니라 고객의 신규 주문을 닫는 보조 작업이다. -->
    <div
      v-if="quoteClosingOpen && detail !== null"
      class="fixed inset-0 z-[55] grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smartbom-closing-title"
    >
      <div class="w-full max-w-[440px] rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <h2 id="smartbom-closing-title" class="text-base font-bold text-gray-900">견적 마감</h2>
        <p class="mt-2 text-sm leading-6 text-gray-600">
          고객이 이 견적으로 더 진행하지 않는 경우에만 마감해 주세요. 마감 후에는 고객이 새 주문을 시작할 수 없습니다.
        </p>
        <div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
          기존 견적·회신 이력은 보존됩니다. 견적 마감은 주문·결제·발주·배송까지 완료됐다는 의미가 아닙니다.
        </div>
        <p v-if="quoteClosingError !== ''" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {{ quoteClosingError }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            :disabled="patch.isPending.value"
            @click="quoteClosingOpen = false"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="patch.isPending.value"
            @click="submitQuoteClosing"
          >
            {{ patch.isPending.value ? '마감 중…' : '견적 마감' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 빠른 메일 컴포즈(§6.15) — 우하단 도킹 -->
    <QuickMailComposer
      v-if="mailOpen && detail !== null && detailId !== null"
      :quote-id="detailId"
      :case-no="smartbomCaseNo(detail.id, detail.requestedAt, detail.createdAt)"
      :case-title="detail.title"
      :confirmed-total="detail.confirmedTotal"
      @close="mailOpen = false"
    />

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detailQuery.isError.value && detailNotFound" class="text-sm text-gray-400">
      Case를 찾을 수 없습니다.
    </p>
    <div
      v-else-if="detailQuery.isError.value"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <span>{{ detailErrorMessage }}</span>
      <button
        type="button"
        class="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-red-100 disabled:opacity-50"
        :disabled="detailQuery.isFetching.value"
        @click="retryDetail"
      >
        {{ detailQuery.isFetching.value ? '다시 불러오는 중…' : '다시 시도' }}
      </button>
    </div>
    <p v-else-if="detail === null" class="text-sm text-gray-400">Case를 찾을 수 없습니다.</p>

    <template v-else>
      <!-- 12단계 파생 타임라인 -->
      <div class="overflow-hidden rounded-xl border border-gray-200 bg-surface">
        <div
          v-if="orderCanceled"
          class="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
          role="status"
        >
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-red-600 text-[11px] text-white" aria-hidden="true">×</span>
          <span>주문 취소 · 확정 견적 유지 · 고객 재주문 대기</span>
        </div>
        <div class="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-3 py-1.5 text-[10px] font-medium text-blue-700 min-[1200px]:hidden">
          <span class="min-w-0 flex-1">12단계 진행 현황 · 현재 단계가 자동으로 보이며 좌우로 전체 단계를 확인할 수 있습니다.</span>
          <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="진행 단계 왼쪽으로 이동" @click="moveTimeline(-1)">←</button>
          <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="진행 단계 오른쪽으로 이동" @click="moveTimeline(1)">→</button>
        </div>
        <div ref="timelineScroll" class="overflow-x-auto px-4 py-3 [scrollbar-color:theme(colors.blue.300)_theme(colors.gray.100)] [scrollbar-width:thin]">
          <ol class="flex min-w-max items-center gap-1">
            <li v-for="(step, idx) in SMARTBOM_STEPS" :key="step" class="flex items-center gap-1" :data-smartbom-step="idx + 1">
              <div class="flex flex-col items-center gap-1">
                <span
                  class="grid size-5 place-items-center rounded-full text-[10px] font-bold"
                  :class="idx + 1 === currentStep && orderCanceled
                    ? 'bg-red-600 text-white'
                    : idx + 1 === currentStep
                      ? 'bg-blue-600 text-white'
                      : idx + 1 < currentStep
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-400'"
                >
                  {{ idx + 1 }}
                </span>
                <span
                  class="whitespace-nowrap text-[10px]"
                  :class="idx + 1 === currentStep && orderCanceled
                    ? 'font-bold text-red-700'
                    : idx + 1 === currentStep
                      ? 'font-bold text-blue-700'
                      : idx + 1 < currentStep ? 'text-gray-600' : 'text-gray-400'"
                >
                  {{ idx + 1 === currentStep && orderCanceled ? '주문 취소 · 재주문 대기' : step }}
                </span>
              </div>
              <span
                v-if="idx < SMARTBOM_STEPS.length - 1"
                class="mb-4 h-px w-4"
                :class="idx + 1 < currentStep ? (orderCanceled && idx + 2 === currentStep ? 'bg-red-300' : 'bg-blue-300') : 'bg-gray-200'"
              />
            </li>
          </ol>
        </div>
      </div>

      <AdminCaseCustomerCard :customer="detail.customer" />

      <!-- 요약 스트립 -->
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-gray-600">세트 {{ detail.setQty }} · 예비 {{ detail.spareQty }}</span>
        <span class="text-gray-600">부품 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></span>
        <span class="text-gray-600">
          예상 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b>
          <span class="text-xs text-gray-400">
            (운송료 {{ smartbomFmtWon(detail.shippingFee) }} · 관리비 {{ smartbomFmtWon(detail.managementFee) }} · VAT 별도)
          </span>
        </span>
        <span v-if="detail.uncostedCount > 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          미산정 {{ detail.uncostedCount }}건
        </span>
        <span class="text-xs text-gray-400">요청 {{ smartbomFmtDate(detail.requestedAt) }}</span>
        <!-- 주문·결제 파생(D16) — ct/od 조인, 저장 아님 -->
        <span
          v-if="detail.orderInfo !== null"
          class="rounded px-1.5 py-0.5 text-xs font-semibold"
          :class="detail.orderState === 'canceled'
            ? 'bg-red-100 text-red-700'
            : detail.orderInfo.isPaid
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-blue-100 text-blue-700'"
        >
          <template v-if="detail.orderState === 'canceled'">
            이전 주문 {{ detail.orderInfo.odId }} · {{ detail.orderInfo.ctStatus }} · 고객 재주문 가능
          </template>
          <template v-else>
            주문 {{ detail.orderInfo.odId }} · {{ detail.orderInfo.odStatus }}
            <template v-if="detail.orderInfo.isPaid"> · 수납 {{ smartbomFmtWon(detail.orderInfo.receiptPrice) }}</template>
          </template>
        </span>
        <span v-else-if="detail.orderState === 'cart'" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          고객 장바구니 담김
        </span>
        <button
          v-if="detail.fileUrl !== null"
          type="button"
          class="text-xs text-blue-600 hover:underline"
          @click="downloadOriginal"
        >
          원본 BOM 다운로드
        </button>
      </div>
      <p v-if="detail.customerMemo" class="rounded bg-surface-sunken p-2 text-xs text-gray-600">
        고객 메모: {{ detail.customerMemo }}
      </p>

      <!-- requested 상태의 첫 행동을 긴 품목표보다 앞에 둔다. 이후 RFQ·품목 검토가 열리는
           순서를 화면에서도 서버 상태 머신(requested→reviewing)과 같게 보장한다. -->
      <section
        v-if="detail.status === 'requested'"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        aria-label="다음 작업"
      >
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold text-amber-900">다음 작업 · 검토 시작</p>
          <p class="mt-0.5 text-[11px] leading-5 text-amber-800">
            검토를 시작하면 품목 확인과 협력사 견적요청을 순서대로 진행할 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="patch.isPending.value"
          @click="saveReview('reviewing')"
        >
          {{ patch.isPending.value ? '시작 중…' : '검토 시작' }}
        </button>
      </section>

      <!-- 협력사 RFQ 현황 — 무관 파트 진입 시 한 줄 접힘(§6.12) -->
      <button
        v-if="collapsed.has('rfq')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('rfq')"
      >
        <span>▸ 협력사 RFQ ({{ rfqs.length }}건)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <BomRfqPanel
        v-else
        :rfqs="rfqs"
        :loading="rfqQuery.isLoading.value"
        :can-send="detail.status === 'reviewing'"
        :busy="reissueLink.isPending.value"
        @send="sendOpen = true"
        @compare="compareOpen = true"
        @reply="openRfqReply"
        @reissue-link="reissueMagicLink"
      />

      <!-- 협력사 발주(D18) — 결제 확인 후 -->
      <button
        v-if="collapsed.has('po')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('po')"
      >
        <span>▸ 협력사 발주 ({{ pos.length }}건)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <BomPoPanel
        v-else
        :pos="pos"
        :loading="poQuery.isLoading.value"
        :can-issue="canIssuePo"
        :issue-disabled-reason="issueDisabledReason"
        :busy="poBusy"
        @create="poCreateOpen = true; poError = '';"
        @remove="removePo"
        @close="closePoRow"
        @external="retryExternalPo"
        @shipment="(po) => { shipmentPo = po; }"
      />
      <p v-if="poError !== ''" class="text-xs font-semibold text-red-600">{{ poError }}</p>

      <!-- 품목 표+검토 — 견적 담당 외 진입에선 접힘(가장 큰 몸통, §6.12) -->
      <button
        v-if="collapsed.has('items')"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="expandSection('items')"
      >
        <span>▸ 품목·검토 ({{ detail.items.length }}행)</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <div v-else class="grid gap-4 min-[1760px]:grid-cols-[minmax(0,1fr)_340px]">
        <!-- 품목 -->
        <div class="order-2 min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-surface min-[1760px]:order-1">
          <!-- 관리자 확인 대기열 — 엔진 판정은 그대로 두고 업무 우선순위·완료 이력만 투영한다. -->
          <div class="space-y-2 border-b border-gray-200 bg-slate-50/80 px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-bold text-gray-800">관리자 품목 확인</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="adminReviewSummaryClass"
                :title="!canUpdateItemReview && adminReviewPendingCount > 0
                  ? '검토 이력 기능 도입 전에 회신된 견적입니다. 기존 회신 상태는 변경하지 않습니다.'
                  : undefined"
              >
                {{ adminReviewSummaryLabel }}
              </span>
              <button
                v-if="canUpdateItemReview && visiblePendingReviewIds.length > 0"
                type="button"
                class="ml-auto rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="itemReview.isPending.value"
                title="현재 검색·필터에 표시된 확인 대상만 완료 처리합니다"
                @click="updateItemReviews(visiblePendingReviewIds, true)"
              >
                표시된 {{ visiblePendingReviewIds.length }}건 확인 완료
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="option in ADMIN_ITEM_FILTER_OPTIONS"
                :key="option.key"
                type="button"
                class="rounded-full border px-2 py-1 text-[10px] font-semibold transition"
                :class="adminItemFilter === option.key
                  ? 'border-blue-400 bg-blue-600 text-white'
                  : 'border-gray-200 bg-surface text-gray-600 hover:border-blue-200 hover:bg-blue-50'"
                @click="adminItemFilter = option.key"
              >
                {{ option.label }} {{ adminItemFilterCounts[option.key] }}
              </button>
              <label class="ml-auto flex min-w-52 items-center gap-1.5 rounded-md border border-gray-200 bg-surface px-2 py-1">
                <span class="text-gray-400">⌕</span>
                <input
                  v-model="adminItemSearch"
                  type="search"
                  class="min-w-0 flex-1 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                  placeholder="MPN·제조사·Excel 행 검색"
                >
              </label>
              <label class="flex cursor-pointer items-center gap-1 text-[10px] font-medium text-gray-500">
                <input v-model="attentionFirst" type="checkbox" class="size-3.5">
                확인 대상 우선
              </label>
            </div>
            <p v-if="itemReviewError !== ''" class="text-[11px] font-semibold text-red-600">{{ itemReviewError }}</p>
          </div>
          <!-- RFQ 행 선택 툴바(§6.13) — 체크는 이 표에서, 발송 모달은 확인만.
               min-h 로 배지("n행 선택됨") 등장 시 높이 점프 방지(사용자 피드백) -->
          <div class="flex min-h-9 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-1 text-[11px] text-gray-500">
            <span>다음 RFQ 발송 행 선택 — 선택 없으면 전체 {{ scopeItems.length }}행 발송</span>
            <span v-if="rfqItemSelection.size > 0" class="rounded bg-blue-100 px-1.5 py-0.5 font-bold text-blue-700">
              {{ rfqItemSelection.size }}행 선택됨
            </span>
            <span class="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                class="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 hover:bg-emerald-100"
                :title="partAddUnavailableReason ?? '카탈로그에서 부품을 검색해 견적에 수동 행으로 추가합니다'"
                @click="openPartAdd"
              >
                ＋ 부품 추가
              </button>
              <button
                type="button"
                class="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-700 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="rfqQuickSelectionGroups.resistorIds.length === 0"
                title="sp-engine이 저항으로 분류한 행만 선택합니다"
                @click="selectRfqComponentRows('resistor')"
              >
                저항 {{ rfqQuickSelectionGroups.resistorIds.length }}
              </button>
              <button
                type="button"
                class="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-semibold text-cyan-700 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="rfqQuickSelectionGroups.capacitorIds.length === 0"
                title="sp-engine이 캐패시터로 분류한 행만 선택합니다"
                @click="selectRfqComponentRows('capacitor')"
              >
                캐패시터 {{ rfqQuickSelectionGroups.capacitorIds.length }}
              </button>
              <button
                type="button"
                class="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="rfqQuickSelectionGroups.passiveIds.length === 0"
                title="sp-engine이 저항 또는 캐패시터로 분류한 행을 함께 선택합니다"
                @click="selectRfqComponentRows('passive')"
              >
                저항+캐패시터 {{ rfqQuickSelectionGroups.passiveIds.length }}
              </button>
              <button
                type="button"
                class="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-300"
                :disabled="rfqQuickSelectionGroups.unofferedIds.length === 0"
                title="선정 구매 조건이 없는 행만 선택합니다"
                @click="selectUnofferedRfqRows"
              >
                구매 조건 없음 {{ rfqQuickSelectionGroups.unofferedIds.length }}
              </button>
              <span
                v-if="rfqQuickSelectionGroups.unclassifiedCount > 0"
                class="text-gray-400"
                title="엔진 부품 유형이 없는 과거 견적·수동 행은 유형 자동 선택에서 제외됩니다"
              >
                분류 미확인 {{ rfqQuickSelectionGroups.unclassifiedCount }}행 제외
              </span>
              <button
                v-if="rfqItemSelection.size > 0"
                type="button"
                class="rounded border border-gray-200 bg-surface px-1.5 py-0.5 font-semibold text-gray-600 hover:bg-gray-100"
                title="체크 선택을 지우고 전체 발송 상태로 돌아갑니다"
                @click="useFullRfqScope"
              >
                선택 해제(전체 발송)
              </button>
            </span>
          </div>
          <p v-if="partRemoveError !== ''" class="border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
            {{ partRemoveError }}
          </p>
          <div class="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-3 py-1.5 text-[10px] font-medium text-blue-700 min-[1760px]:hidden">
            <span class="min-w-0 flex-1">좌우로 이동해 협력사 RFQ, 주문수량, 합계와 작업 버튼을 확인할 수 있습니다.</span>
            <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="품목표 왼쪽으로 이동" @click="moveAdminItemsTable(-1)">←</button>
            <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="품목표 오른쪽으로 이동" @click="moveAdminItemsTable(1)">→</button>
          </div>
          <div ref="adminItemsTableScroll" class="overflow-x-auto [scrollbar-color:theme(colors.blue.300)_theme(colors.gray.100)] [scrollbar-width:thin]">
            <table class="min-w-[1040px] divide-y divide-gray-100 text-xs">
              <thead class="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th class="px-2 py-2 text-center text-[10px] font-semibold" title="다음 협력사 RFQ에 포함할 품목 선택">
                    <span class="sr-only">RFQ 전체 선택</span>
                    <input
                      type="checkbox"
                      class="size-3.5 align-middle"
                      title="다음 RFQ 발송 행 전체 선택/해제"
                      :checked="allRfqRowsSelected"
                      @change="toggleAllRfqRows"
                    >
                    <span class="mt-0.5 block">RFQ</span>
                  </th>
                  <th class="min-w-28 px-3 py-2">검토 상태</th>
                  <th class="px-3 py-2">Excel 위치</th>
                  <th class="px-3 py-2">부품</th>
                  <th class="px-3 py-2">선정 구매 조건</th>
                  <th class="px-3 py-2">협력사 RFQ</th>
                  <th class="px-3 py-2 text-right">주문수량</th>
                  <th class="px-3 py-2 text-right">합계</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <tr
                  v-for="view in visibleAdminItemViews"
                  :key="view.item.id"
                  :class="adminAttentionRowClass(view)"
                >
                  <td class="px-2 py-2">
                    <input
                      v-if="rfqSelectable(view.item)"
                      type="checkbox"
                      class="size-3.5 align-middle"
                      :checked="rfqItemSelection.has(view.item.id)"
                      :aria-label="`${itemLabel(view.item)} RFQ 포함`"
                      @change="toggleRfqRow(view.item.id)"
                    >
                  </td>
                  <td class="min-w-28 px-3 py-2 align-top">
                    <span
                      class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold"
                      :class="view.attention.reviewRequired && view.item.adminReview.completed
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : ADMIN_ATTENTION_META[view.attention.kind].badgeClass"
                      :title="adminAttentionTitle(view)"
                    >
                      <template v-if="view.attention.reviewRequired && view.item.adminReview.completed">✓ 확인 완료</template>
                      <template v-else-if="view.item.adminReview.stale">재확인 필요</template>
                      <template v-else>{{ ADMIN_ATTENTION_META[view.attention.kind].label }}</template>
                    </span>
                    <p
                      v-if="view.attention.reasons.length > 0"
                      class="mt-1 max-w-32 text-[9px] leading-3 text-gray-500"
                      :title="adminAttentionTitle(view)"
                    >
                      {{ adminAttentionReasonSummary(view) }}
                    </p>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ itemLocation(view.item) }}</td>
                  <td class="px-3 py-2">
                    <div class="flex flex-wrap items-center gap-1">
                      <span class="font-medium">{{ itemLabel(view.item) }}</span>
                      <span
                        v-if="rfqEngineComponentType(view.item) === 'resistor'"
                        class="rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[9px] font-semibold text-orange-700"
                        title="sp-engine 분류"
                      >저항</span>
                      <span
                        v-else-if="rfqEngineComponentType(view.item) === 'capacitor'"
                        class="rounded border border-cyan-200 bg-cyan-50 px-1 py-0.5 text-[9px] font-semibold text-cyan-700"
                        title="sp-engine 분류"
                      >캐패시터</span>
                    </div>
                    <div class="text-gray-400">{{ view.item.manufacturerName }}</div>
                  </td>
                  <td class="px-3 py-2">
                    <template v-if="view.item.selectedOffer !== null">
                      {{ view.item.selectedOffer.supplier }} · {{ view.item.selectedOffer.unitPrice }} {{ view.item.selectedOffer.currency }} @{{ view.item.selectedOffer.breakQty }}+
                    </template>
                    <span v-else class="text-amber-600">{{ view.item.matchStatus === 'none' ? '미매칭' : '구매 조건 없음' }}</span>
                  </td>
                  <td class="min-w-52 px-3 py-2">
                    <div v-if="rfqBadgesFor(view.item.id).length > 0" class="flex flex-wrap gap-1">
                      <button
                        v-for="badge in rfqBadgesFor(view.item.id)"
                        :key="badge.rfq.rfqId"
                        type="button"
                        class="inline-flex max-w-48 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                        :class="ITEM_RFQ_BADGE_CLASSES[badge.tone]"
                        :title="itemRfqBadgeTitle(badge)"
                        @click="openRfqReply(badge.rfq)"
                      >
                        <span class="truncate">{{ badge.rfq.partnerName }}</span>
                        <span class="shrink-0">· {{ badge.label }}</span>
                      </button>
                    </div>
                    <span v-else-if="rfqSelectable(view.item)" class="text-[11px] text-gray-300">미요청</span>
                    <span v-else class="text-gray-200">—</span>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ view.item.orderQty.toLocaleString('ko-KR') }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ view.item.lineTotalKrw === null ? '—' : smartbomFmtWon(Math.round(view.item.lineTotalKrw)) }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <div class="flex flex-col items-end gap-1">
                      <button
                        v-if="view.attention.reviewRequired && canUpdateItemReview"
                        type="button"
                        class="rounded border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        :class="view.item.adminReview.completed
                          ? 'border-gray-200 bg-surface text-gray-500 hover:bg-gray-50'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'"
                        :disabled="!canUpdateItemReview || reviewingItemIds.has(view.item.id)"
                        :title="view.item.adminReview.completed ? '품목을 다시 확인 대상으로 돌립니다' : adminAttentionTitle(view)"
                        @click="updateItemReviews([view.item.id], !view.item.adminReview.completed)"
                      >
                        {{ view.item.adminReview.completed ? '재검토' : '확인 완료' }}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                        @click="openPartSelection(view.item, 'candidates')"
                      >
                        {{ view.pending ? '검토하기' : '후보·근거' }}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-violet-200 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50"
                        :title="partChangeButtonTitle(view.item)"
                        @click="openPartSelection(view.item, 'search')"
                      >
                        부품 검색·변경
                      </button>
                      <button
                        v-if="isManualQuoteItem(view.item)"
                        type="button"
                        class="rounded border border-red-200 px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="partRemove.isPending.value || partMutationUnavailableReason() !== null"
                        :title="partMutationUnavailableReason() ?? '관리자가 수동 추가한 이 품목을 견적에서 제거합니다'"
                        @click="requestPartRemove(view.item)"
                      >
                        수동 행 제거
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="visibleAdminItemViews.length === 0">
                  <td colspan="9" class="px-4 py-10 text-center text-xs text-gray-400">
                    검색·필터 조건에 맞는 품목이 없습니다.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 검토 폼 -->
        <div class="order-1 h-fit space-y-3 rounded-xl border border-gray-200 bg-surface p-4 text-sm min-[1760px]:order-2">
          <p class="text-xs font-bold text-gray-700">검토·고객 회신</p>
          <!-- 비용 — 기본은 예상(자동: 부품 합계 + 설정 기본 운송료·관리비) 읽기 전용 표시.
               확정가는 토글을 켠 경우에만 입력(D9 수동 확정 — 관리자 혼동 방지 UX) -->
          <div class="space-y-0.5 rounded bg-surface-sunken px-2.5 py-2 text-xs text-gray-600">
            <div
              class="mb-2 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2 text-blue-900"
              title="세트당 BOM 수량에 제작·예비 세트 수를 합산 적용한 뒤 MOQ와 주문배수를 반영해 주문수량을 계산합니다."
            >
              <p class="text-[10px] font-semibold text-blue-600">수량 기준</p>
              <p class="mt-0.5 flex flex-wrap items-baseline gap-x-1 tabular-nums">
                <span>제작 <b>{{ detail.setQty.toLocaleString('ko-KR') }}세트</b></span>
                <span class="text-blue-400">+</span>
                <span>예비 <b>{{ detail.spareQty.toLocaleString('ko-KR') }}세트</b></span>
                <span class="text-blue-400">=</span>
                <strong class="text-blue-800">적용 {{ (detail.setQty + detail.spareQty).toLocaleString('ko-KR') }}세트</strong>
              </p>
              <p class="mt-0.5 text-[10px] text-blue-500">주문수량·부품 합계 산정 기준</p>
            </div>
            <div class="flex justify-between"><span>부품 합계(선정 반영)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></div>
            <div class="flex justify-between"><span>운송료(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.shippingFee) }}</span></div>
            <div class="flex justify-between"><span>관리비(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.managementFee) }}</span></div>
            <div class="flex justify-between border-t border-gray-200 pt-1"><span>예상 총액(VAT 별도)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b></div>
            <div class="flex justify-between text-gray-400"><span>참고: VAT 포함 시</span><span class="tabular-nums">{{ withVat(detail.finalTotal) }}</span></div>
          </div>

          <!-- 확정가 = 고객 주문 게이트(D16-1). "선택적 커스텀"이 아니라 필수 단계임이
               보이도록, 미등록 상태를 경고 톤으로 상시 표시한다(사용자 피드백 반영) -->
          <label class="flex items-start gap-2 text-xs font-bold text-gray-800" :class="reviewEditable ? 'cursor-pointer' : 'cursor-not-allowed'">
            <input type="checkbox" class="mt-0.5 size-3.5 shrink-0" :checked="confirmedOverride" :disabled="!reviewEditable" @change="toggleConfirmedOverride">
            <span class="shrink-0 whitespace-nowrap">확정가 등록</span>
            <span class="font-medium text-amber-700">— 등록 시 고객 주문 가능</span>
          </label>
          <p v-if="!confirmedOverride" class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-[16px] text-amber-800">
            ⚠ 확정가 미등록 — 고객은 예상 금액만 볼 수 있고 주문(결제)할 수 없습니다.
            체크 후 확정 총액을 저장하세요. 끈 채 저장하면 기존 확정가도 해제됩니다.
          </p>
          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs text-gray-500">확정 운송료
                <input v-model.number="form.confirmedShippingFee" type="number" min="0" :disabled="!reviewEditable" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums disabled:bg-gray-100 disabled:text-gray-500">
              </label>
              <label class="text-xs text-gray-500">확정 관리비
                <input v-model.number="form.confirmedManagementFee" type="number" min="0" :disabled="!reviewEditable" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums disabled:bg-gray-100 disabled:text-gray-500">
              </label>
            </div>
            <label class="block text-xs text-gray-500">확정 총액(VAT 별도)
              <input v-model.number="form.confirmedTotal" type="number" min="0" :disabled="!reviewEditable" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums disabled:bg-gray-100 disabled:text-gray-500">
            </label>
            <p class="text-[11px] text-gray-400">
              참고: VAT 포함 시 {{ confirmedTotalVat }} — 부가세는 저장하지 않습니다(전 금액 VAT 별도).
              검토 중 저장값은 관리자 초안이며, 고객 회신 확정 후 공개되고 [주문하기]가 열립니다.
            </p>
          </template>
          <label class="block text-xs text-gray-500">고객 회신 메모(고객에게 표시)
            <textarea v-model="form.answerNote" rows="3" :disabled="!reviewEditable" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-100 disabled:text-gray-500" />
          </label>
          <label class="block text-xs text-gray-500">내부 메모(고객 미노출)
            <textarea v-model="form.adminMemo" rows="2" :disabled="!reviewEditable" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-100 disabled:text-gray-500" />
          </label>
          <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
            <button
              v-if="reviewEditable"
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              :disabled="patch.isPending.value"
              @click="saveReview()"
            >
              저장
            </button>
            <button
              v-if="detail.status === 'reviewing'"
              type="button"
              class="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="patch.isPending.value"
              @click="openEstimatePreview"
            >
              견적서 미리보기
            </button>
            <span
              v-if="detail.status === 'reviewing' && adminReviewPendingCount > 0"
              class="self-center text-[11px] font-semibold text-amber-700"
              role="status"
            >
              확인 필요 {{ adminReviewPendingCount }}건
            </span>
            <button
              v-if="detail.status === 'reviewing'"
              type="button"
              class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="patch.isPending.value || completeReview.isPending.value || adminReviewPendingCount > 0"
              :title="adminReviewPendingCount > 0 ? `관리자 확인이 끝나지 않은 품목이 ${String(adminReviewPendingCount)}개 있습니다` : ''"
              @click="openCompletion"
            >
              고객 회신 확정
            </button>
            <button
              v-if="detail.status === 'answered' || detail.status === 'closed'"
              type="button"
              class="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              :disabled="sendAnswerEmail.isPending.value"
              @click="openResendEmail"
            >
              회신 이메일 다시 보내기
            </button>
            <details v-if="detail.status === 'answered'" class="relative ml-auto">
              <summary
                class="cursor-pointer list-none rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 [&::-webkit-details-marker]:hidden"
              >
                추가 작업
              </summary>
              <div class="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  class="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100"
                  :disabled="patch.isPending.value"
                  @click="openQuoteClosing"
                >
                  견적 마감
                </button>
                <p class="px-3 pb-1 pt-0.5 text-[11px] leading-4 text-gray-400">더 진행하지 않는 견적의 신규 주문을 닫습니다.</p>
              </div>
            </details>
          </div>
          <p v-if="!reviewEditable" class="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] leading-4 text-gray-600">
            현재 견적 상태에서는 금액과 회신 내용을 변경할 수 없습니다.
            <template v-if="detail.status === 'answered' || detail.status === 'closed'"> 이메일은 확정된 내용으로 다시 보낼 수 있습니다.</template>
          </p>
          <p v-if="actionError !== ''" class="text-xs text-red-600">{{ actionError }}</p>
          <p
            v-if="emailActionFeedback !== null"
            class="rounded-md border px-2.5 py-2 text-xs leading-5"
            :class="emailActionFeedbackClass"
          >
            {{ emailActionFeedback.text }}
          </p>
        </div>
      </div>

      <!-- 보낸 메일 — 이 Case 컨텍스트의 발송 이력(§6.19 후속, 전 채널 원장 임베드) -->
      <button
        v-if="!mailLogOpen"
        type="button"
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        @click="mailLogOpen = true"
      >
        <span>▸ 보낸 메일</span>
        <span class="text-xs text-gray-400">펼치기</span>
      </button>
      <div v-else class="space-y-3 rounded-xl border border-gray-200 bg-surface p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold text-gray-900">보낸 메일</h2>
          <button
            type="button"
            class="text-xs text-gray-400 hover:text-gray-600"
            @click="mailLogOpen = false"
          >
            접기
          </button>
        </div>
        <MailLogList
          v-if="detailId !== null"
          :fixed="{ refType: 'bom_quote', refId: detailId }"
          :page-size="10"
        />
      </div>

      <!-- 위험 구역 — 목록 행에서 오작동하지 않도록 Case 상세 단건에만 둔다. -->
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div>
          <p class="text-xs font-extrabold text-red-800">위험 구역</p>
          <p class="mt-0.5 text-[11px] text-red-600">주문·선적 관계를 다시 검사한 뒤 Case와 관련 업무 데이터를 영구 삭제합니다.</p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-red-300 bg-surface px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
          @click="caseDeleteOpen = true"
        >
          Case 강제 영구 삭제
        </button>
      </div>
    </template>

    <BomCaseDeleteModal
      v-if="caseDeleteOpen && detailId !== null"
      :quote-id="detailId"
      @close="caseDeleteOpen = false"
      @deleted="onCaseDeleted"
    />

    <BomPartAddModal
      v-if="partAddOpen && detail !== null"
      :set-qty="detail.setQty"
      :spare-qty="detail.spareQty"
      :usd-krw-rate="detail.usdKrwRateUsed"
      :selecting="partAdd.isPending.value"
      :read-only="partAddUnavailableReason !== null"
      :locked-reason="partAddUnavailableReason ?? ''"
      :error="partAddError"
      @select="requestPartAdd"
      @close="closePartAdd"
    />

    <Teleport to="body">
      <div
        v-if="pendingPartAdd !== null"
        class="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-4"
        role="presentation"
        @mousedown.self="cancelPendingPartAdd"
      >
        <section class="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-200 bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="admin-part-add-confirm-title">
          <header class="border-b border-emerald-200 bg-emerald-50 px-5 py-4">
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Admin item addition</p>
            <h3 id="admin-part-add-confirm-title" class="mt-1 text-lg font-bold text-slate-950">이 부품을 견적에 추가할까요?</h3>
            <p class="mt-1 text-xs leading-5 text-emerald-900">카탈로그·구매 조건·수량을 서버가 다시 읽고 최종 주문수량과 견적 합계를 계산합니다.</p>
          </header>
          <div class="space-y-3 p-5 text-sm">
            <div class="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span class="text-xs font-semibold text-slate-500">추가 부품</span>
              <div>
                <strong class="break-all text-emerald-800">{{ pendingPartAdd.mpn }}</strong>
                <p class="mt-0.5 text-xs text-slate-500">{{ pendingPartAdd.manufacturerName ?? '제조사 미확인' }}</p>
              </div>
              <span class="text-xs font-semibold text-slate-500">수량</span>
              <span class="tabular-nums text-slate-700">세트당 {{ pendingPartAdd.body.bomQty.toLocaleString('ko-KR') }}개 · 필요 {{ pendingPartAdd.needed.toLocaleString('ko-KR') }}개 · 주문 {{ pendingPartAdd.orderQty.toLocaleString('ko-KR') }}개</span>
              <span class="text-xs font-semibold text-slate-500">구매 조건</span>
              <span class="text-slate-700">{{ pendingPartAdd.supplier ?? '가격·공급사 미확정' }}</span>
              <span class="text-xs font-semibold text-slate-500">행 금액</span>
              <strong class="tabular-nums text-slate-800">{{ pendingPartAdd.lineTotalKrw === null ? '미산정' : smartbomFmtWon(Math.round(pendingPartAdd.lineTotalKrw)) }}</strong>
            </div>
            <p class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900">
              추가하면 기존 확정금액은 초기화됩니다. 업로드 원본에는 합치지 않고 “수동 추가” 행으로 분리하며, 필요하면 이 행만 다시 제거할 수 있습니다.
            </p>
            <section v-if="pendingPartAdd.body.force" class="space-y-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-950">
              <div>
                <p class="font-bold">관리자 강제 추가</p>
                <p class="mt-0.5">{{ pendingPartAdd.impact.forceReason }}</p>
              </div>
              <ul class="list-disc space-y-1 pl-4">
                <li v-if="pendingPartAdd.impact.dynamicFullRfqCount > 0">
                  전체 품목 RFQ {{ pendingPartAdd.impact.dynamicFullRfqCount }}건은 새 부품을 자동 포함하고 요청중으로 되돌립니다. 기존 행별 회신은 보존되지만 문서 합계·납기·메모는 다시 받아야 합니다.
                </li>
                <li v-if="pendingPartAdd.impact.partialRfqCount > 0">
                  부분 품목 RFQ {{ pendingPartAdd.impact.partialRfqCount }}건에는 새 부품을 자동 추가하지 않습니다. 필요하면 새 범위로 별도 RFQ를 보내야 합니다.
                </li>
                <li v-if="pendingPartAdd.impact.hasOrderSnapshot">기존 장바구니·주문은 당시 품목·금액 스냅샷을 유지하므로 변경 견적과 다를 수 있습니다.</li>
                <li v-if="pendingPartAdd.impact.poCount > 0">기존 발주서 {{ pendingPartAdd.impact.poCount }}건은 발행 당시 품목·금액 스냅샷을 그대로 보존합니다.</li>
                <li v-if="pendingPartAdd.impact.reopensQuote">회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.</li>
              </ul>
              <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-surface px-3 py-2 font-bold">
                <input v-model="forcePartAddConfirmed" type="checkbox" class="mt-0.5 size-4 accent-rose-700">
                <span>RFQ 범위와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다.</span>
              </label>
            </section>
          </div>
          <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button type="button" class="h-10 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100" :disabled="partAdd.isPending.value" @click="cancelPendingPartAdd">취소</button>
            <button
              type="button"
              class="h-10 rounded-lg px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              :class="pendingPartAdd.body.force ? 'bg-rose-700 hover:bg-rose-800' : 'bg-emerald-700 hover:bg-emerald-800'"
              :disabled="partAdd.isPending.value || (pendingPartAdd.body.force && !forcePartAddConfirmed)"
              @click="confirmPartAdd"
            >
              {{ partAdd.isPending.value ? '추가 중…' : pendingPartAdd.body.force ? '강제 추가 적용' : '부품 추가' }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="pendingPartRemove !== null"
        class="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-4"
        role="presentation"
        @mousedown.self="cancelPendingPartRemove"
      >
        <section class="w-full max-w-lg overflow-hidden rounded-2xl border border-red-200 bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="admin-part-remove-title">
          <header class="border-b border-red-200 bg-red-50 px-5 py-4">
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-red-700">Admin item removal</p>
            <h3 id="admin-part-remove-title" class="mt-1 text-lg font-bold text-slate-950">수동 추가 부품을 제거할까요?</h3>
            <p class="mt-1 text-xs leading-5 text-red-900">업로드 원본 행에는 영향을 주지 않지만 이 수동 행은 복구되지 않습니다.</p>
          </header>
          <div class="space-y-3 p-5 text-sm">
            <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <strong class="break-all text-slate-900">{{ itemLabel(pendingPartRemove.item) }}</strong>
              <p class="mt-1 text-xs text-slate-500">{{ pendingPartRemove.item.manufacturerName ?? '제조사 미확인' }} · 주문 {{ pendingPartRemove.item.orderQty.toLocaleString('ko-KR') }}개 · {{ pendingPartRemove.item.lineTotalKrw === null ? '금액 미산정' : smartbomFmtWon(Math.round(pendingPartRemove.item.lineTotalKrw)) }}</p>
            </div>
            <p class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900">
              제거하면 견적 합계를 다시 계산하고 기존 확정금액을 초기화합니다.
            </p>
            <section v-if="pendingPartRemove.body.force" class="space-y-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-950">
              <div>
                <p class="font-bold">관리자 강제 제거</p>
                <p class="mt-0.5">{{ pendingPartRemove.impact.forceReason }}</p>
              </div>
              <ul class="list-disc space-y-1 pl-4">
                <li v-if="pendingPartRemove.impact.affectedRfqCount > 0">이 부품을 요청한 RFQ {{ pendingPartRemove.impact.affectedRfqCount }}건에서 대상과 해당 행 회신을 제거하고, 남은 품목이 있으면 요청중으로 되돌립니다.</li>
                <li v-if="pendingPartRemove.impact.invalidatedReplyCount > 0">이 부품의 기존 협력사 회신 {{ pendingPartRemove.impact.invalidatedReplyCount }}건도 함께 삭제됩니다.</li>
                <li v-if="pendingPartRemove.impact.hasOrderSnapshot">기존 장바구니·주문은 당시 품목·금액 스냅샷을 유지합니다.</li>
                <li v-if="pendingPartRemove.impact.poCount > 0">기존 발주서 {{ pendingPartRemove.impact.poCount }}건은 발행 당시 품목·금액 스냅샷을 유지합니다.</li>
                <li v-if="pendingPartRemove.impact.reopensQuote">회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.</li>
              </ul>
              <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-surface px-3 py-2 font-bold">
                <input v-model="forcePartRemoveConfirmed" type="checkbox" class="mt-0.5 size-4 accent-rose-700">
                <span>RFQ 회신 삭제와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다.</span>
              </label>
            </section>
          </div>
          <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button type="button" class="h-10 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100" :disabled="partRemove.isPending.value" @click="cancelPendingPartRemove">취소</button>
            <button
              type="button"
              class="h-10 rounded-lg bg-red-700 px-5 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              :disabled="partRemove.isPending.value || (pendingPartRemove.body.force && !forcePartRemoveConfirmed)"
              @click="confirmPartRemove"
            >
              {{ partRemove.isPending.value ? '제거 중…' : pendingPartRemove.body.force ? '강제 제거 적용' : '수동 행 제거' }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <BomCandidateDrawer
      :open="candidateItemId !== null"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      :read-only="candidateSelectionUnavailableReason !== null"
      :selecting="candidateSelection.isPending.value"
      :catalog-selecting="candidateSelection.isPending.value"
      :selection-error="candidateSelectionError"
      :selection-locked-reason="candidateSelectionNotice ?? ''"
      :force-selection-allowed="candidateForceSelectionAllowed"
      :interaction-locked="candidateSelection.isPending.value"
      :initial-view="candidateDrawerView"
      :search-initial-query="candidateItem?.mpn ?? ''"
      :current-part-id="candidateItem?.partId ?? null"
      :needed="candidateItem === null || detail === null ? 1 : neededQty(candidateItem.bomQty, detail.setQty, detail.spareQty)"
      :usd-krw-rate="detail?.usdKrwRateUsed ?? null"
      :search-refresh-enabled="false"
      @select="requestCandidateSelection"
      @catalog-select="requestCatalogSelection"
      @close="closePartSelection"
    />

    <Teleport to="body">
      <div
        v-if="pendingPartSelection !== null"
        class="fixed inset-0 z-[95] grid place-items-center bg-slate-950/55 p-4"
        role="presentation"
        @mousedown.self="cancelPendingPartSelection"
      >
        <section
          class="w-full max-w-lg overflow-hidden rounded-2xl border border-violet-200 bg-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-part-selection-title"
        >
          <header class="border-b border-violet-200 bg-violet-50 px-5 py-4">
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-700">Admin part replacement</p>
            <h3 id="admin-part-selection-title" class="mt-1 text-lg font-bold text-slate-950">이 부품으로 변경할까요?</h3>
            <p class="mt-1 text-xs leading-5 text-violet-900">{{ pendingPartSelection.sourceLabel }} 선택을 서버가 다시 검증하고 견적 금액을 재계산합니다.</p>
          </header>
          <div class="space-y-3 p-5 text-sm">
            <div class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span class="text-xs font-semibold text-slate-500">기존 부품</span>
              <strong class="break-all text-slate-800">{{ pendingPartSelection.previousMpn || '품번 미기재' }}</strong>
              <span class="text-xs font-semibold text-slate-500">변경 부품</span>
              <div>
                <strong class="break-all text-violet-800">{{ pendingPartSelection.nextMpn }}</strong>
                <p class="mt-0.5 text-xs text-slate-500">{{ pendingPartSelection.nextManufacturer ?? '제조사 미확인' }}</p>
              </div>
              <span class="text-xs font-semibold text-slate-500">구매 조건</span>
              <span class="text-slate-700">{{ pendingPartSelection.nextSupplier ?? '가격·공급사 미확정' }} · {{ pendingPartSelection.nextOrderQty.toLocaleString('ko-KR') }}개</span>
              <span class="text-xs font-semibold text-slate-500">행 금액</span>
              <div class="flex flex-wrap items-center gap-2">
                <strong class="tabular-nums text-slate-800">{{ pendingPartSelection.nextLineTotalKrw === null ? '미산정' : smartbomFmtWon(Math.round(pendingPartSelection.nextLineTotalKrw)) }}</strong>
                <span v-if="pendingLineDelta !== null" class="rounded px-1.5 py-0.5 text-[11px] font-bold" :class="pendingLineDelta > 0 ? 'bg-rose-100 text-rose-700' : pendingLineDelta < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'">
                  {{ pendingLineDelta > 0 ? '+' : '' }}{{ smartbomFmtWon(Math.round(pendingLineDelta)) }}
                </span>
              </div>
            </div>
            <p class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900">
              적용하면 기존 확정금액은 초기화되며 다시 확인해야 합니다. 원본 BOM과 이전 선택 이력은 보존됩니다.
            </p>
            <section
              v-if="pendingPartSelection.body.force"
              class="space-y-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-950"
            >
              <div>
                <p class="font-bold">관리자 강제 변경</p>
                <p class="mt-0.5">{{ pendingPartSelection.impact.forceReason }}</p>
              </div>
              <ul class="list-disc space-y-1 pl-4">
                <li v-if="pendingPartSelection.impact.affectedRfqCount > 0">
                  협력사 RFQ {{ pendingPartSelection.impact.affectedRfqCount }}건은 같은 링크에서 새 부품으로 바뀌며 재안내가 필요합니다.
                </li>
                <li v-if="pendingPartSelection.impact.invalidatedReplyCount > 0">
                  이 품목의 기존 협력사 회신 {{ pendingPartSelection.impact.invalidatedReplyCount }}건은 무효화되고 다시 회신받아야 합니다.
                </li>
                <li v-if="pendingPartSelection.impact.hasOrderSnapshot">
                  기존 장바구니·주문 금액은 과거 스냅샷으로 유지되어 변경 견적과 다를 수 있습니다.
                </li>
                <li v-if="pendingPartSelection.impact.poCount > 0">
                  기존 발주서 {{ pendingPartSelection.impact.poCount }}건은 발행 당시 부품·금액 스냅샷을 그대로 보존합니다.
                </li>
                <li v-if="pendingPartSelection.impact.reopensQuote">
                  회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.
                </li>
              </ul>
              <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-surface px-3 py-2 font-bold">
                <input v-model="forcePartSelectionConfirmed" type="checkbox" class="mt-0.5 size-4 accent-rose-700">
                <span>관련 RFQ 회신 무효화와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다.</span>
              </label>
            </section>
          </div>
          <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button type="button" class="h-10 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100" :disabled="candidateSelection.isPending.value" @click="cancelPendingPartSelection">취소</button>
            <button
              type="button"
              class="h-10 rounded-lg px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              :class="pendingPartSelection.body.force ? 'bg-rose-700 hover:bg-rose-800' : 'bg-violet-700 hover:bg-violet-800'"
              :disabled="candidateSelection.isPending.value || (pendingPartSelection.body.force && !forcePartSelectionConfirmed)"
              @click="confirmPartSelection"
            >
              {{ candidateSelection.isPending.value ? '적용 중…' : pendingPartSelection.body.force ? '강제 변경 적용' : '변경 적용' }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <BomRfqSendModal
      v-if="detail !== null && detailId !== null"
      :open="sendOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :selected-item-ids="[...rfqItemSelection]"
      :rfqs="rfqs"
      @close="sendOpen = false"
      @sent="useFullRfqScope"
    />

    <BomRfqCompareModal
      v-if="detail !== null && detailId !== null"
      :open="compareOpen"
      :quote-id="detailId"
      :rfqs="rfqs"
      :scope-items="scopeItems"
      @close="compareOpen = false"
    />

    <BomPoCreateModal
      v-if="detail !== null && detailId !== null"
      :open="poCreateOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :rfqs="rfqs"
      :existing-pos="pos"
      @close="poCreateOpen = false"
    />

    <BomShipmentModal
      v-if="detailId !== null"
      :open="shipmentPo !== null"
      :quote-id="detailId"
      :po="pos.find((entry) => entry.poId === shipmentPo?.poId) ?? shipmentPo"
      @close="shipmentPo = null"
    />

    <!-- 대리 입력(회신 보기·수정) 모달 — 포털 회신과 같은 폼·저장 경로 -->
    <div
      v-if="replyRfq !== null"
      class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
      @click.self="replyRfq = null"
    >
      <div class="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">
            {{ replyRfq.partnerName }} — {{ replyRfq.status === 'closed' ? '회신 보기' : replyRfq.status === 'quoted' ? '회신 수정' : '회신 대리 입력' }}
          </h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="replyRfq = null">✕</button>
        </div>
        <p class="mt-1 text-xs text-gray-500">
          {{ replyRfq.status === 'closed'
            ? '마감된 RFQ의 최종 회신 내용입니다. 기록 보존을 위해 읽기 전용으로 표시합니다.'
            : '전화·메일로 받은 회신을 기록합니다 — 협력사 포털 회신과 같은 저장 경로(source=manual)입니다.' }}
        </p>
        <div class="mt-4">
          <RfqReplyForm
            :rows="replyRows"
            :currency="replyRfq.currency"
            :delivery-date="replyRfq.deliveryDate"
            :memo="replyRfq.memo"
            :busy="rfqReply.isPending.value"
            :read-only="replyRfq.status === 'closed'"
            @submit="submitReply"
          />
        </div>
        <p v-if="replyError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ replyError }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 관리자 상세는 장시간 검토하는 화면이므로 밀도보다 판독성을 우선한다. */
.admin-case-readable :deep([class~='text-[9px]']) {
  font-size: 11px;
  line-height: 15px;
}

.admin-case-readable :deep([class~='text-[10px]']) {
  font-size: 12px;
  line-height: 16px;
}

.admin-case-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.admin-case-readable :deep(.text-xs),
.admin-case-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.admin-case-readable :deep(.text-sm),
.admin-case-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
