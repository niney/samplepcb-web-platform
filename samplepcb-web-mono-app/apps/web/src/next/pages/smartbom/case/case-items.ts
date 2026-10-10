import { computed, nextTick, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type {
  AdminBomQuoteItemAddBodyType,
  AdminBomQuoteItemPartnerHolderType,
  AdminBomQuoteItemRemoveBodyType,
  AdminBomQuoteItemSelectionBodyType,
  AdminBomQuoteItemType,
  AdminBomRfqViewType,
  BomQuoteCandidateType,
  BomQuoteItemType,
  PartHitType,
} from '@sp/api-contract';
import { bomQuoteAdminAttention, neededQty, type BomQuoteAdminAttention, type OfferPick } from '@sp/utils';
import {
  useAddAdminBomQuoteItem,
  useAdminBomQuoteCandidates,
  useRemoveAdminBomQuoteItem,
  useReviewAdminBomQuoteItems,
  useSelectAdminBomQuoteItem,
} from '@/admin/useAdminBomQuotes';
import { useAdminBomQuotePartnerStock } from '@/admin/useAdminBomRfqs';
import { confirmDialog } from '@/next/lib/dialog';
import type { CaseCore } from './case-core';
import {
  ADMIN_ATTENTION_META,
  ADMIN_ATTENTION_REASON_LABEL,
  ITEM_RFQ_BADGE_ORDER,
  type ItemRfqBadgeTone,
} from '@/next/components/smartbom/smartbom-badges';

// 품목·검토 — RFQ 행 선택(§6.13)·협력사 보유 칩·품목 관점 RFQ 현황·관리자 품목 확인 대기열·
// 부품 교체(D25)·부품 추가/수동 행 제거(D26). 옛 화면 스크립트의 같은 부분을 의미 그대로 옮겼다.

// 부품 유형 판단은 Vue 문자열 추측이 아니라 sp-engine 의 정규화 결과만 소비한다.
// 빠른 선택은 '제외' 방식이다(저항은 A사, 나머지는 B사) — 엔진이 저항·캐패시터로 분류한 행만 빼고
// 나머지는 남긴다. 미분류(엔진 유형 enum 에 없는 IC, 과거 견적·수동 행)를 함께 빼면 '저항+캐패시터
// 제외'가 IC 를 전부 놓치므로, 미분류는 저항·캐패시터로 보지 않고 선택에 남긴다.
type RfqPassiveComponentType = 'resistor' | 'capacitor';

export const rfqEngineComponentType = (item: BomQuoteItemType) =>
  item.matchEvidence?.searchRequirementGuidance?.componentType ?? null;

interface RfqQuickSelectionGroups {
  resistorIds: string[];
  capacitorIds: string[];
  passiveIds: string[];
  /** 저항을 뺀 나머지(미분류 포함) — [저항 제외]. */
  withoutResistorIds: string[];
  withoutCapacitorIds: string[];
  withoutPassiveIds: string[];
  unofferedIds: string[];
  unclassifiedCount: number;
}

export interface ItemRfqBadge {
  rfq: AdminBomRfqViewType;
  tone: ItemRfqBadgeTone;
  label: string;
  unitPrice: number | null;
  currency: string;
}

export type AdminItemFilter =
  | 'all'
  | 'attention'
  | 'blocking'
  | 'procurement'
  | 'technical'
  | 'inquiry'
  | 'ready'
  | 'excluded';

export interface AdminItemView {
  item: AdminBomQuoteItemType;
  attention: BomQuoteAdminAttention;
  pending: boolean;
}

export const ADMIN_ITEM_FILTER_OPTIONS: readonly { key: AdminItemFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'attention', label: '확인 필요' },
  { key: 'blocking', label: '즉시 처리' },
  { key: 'procurement', label: '구매 확인' },
  { key: 'technical', label: '기술 검토' },
  { key: 'inquiry', label: '문의' },
  { key: 'ready', label: '정상·완료' },
  { key: 'excluded', label: '제외' },
];

interface AdminPartSelectionImpact {
  forceReason: string | null;
  affectedRfqCount: number;
  invalidatedReplyCount: number;
  poCount: number;
  hasOrderSnapshot: boolean;
  reopensQuote: boolean;
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

interface PendingAdminPartRemove {
  item: BomQuoteItemType;
  body: AdminBomQuoteItemRemoveBodyType;
  impact: AdminPartSelectionImpact;
}

export function itemRows(item: BomQuoteItemType): number[] {
  const value = item.sourceRow?.sourceRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0);
}

export function itemLocation(item: BomQuoteItemType): string {
  const rows = itemRows(item);
  if (item.sourceSheetName === null) return '수동 추가';
  return rows.length === 0 ? item.sourceSheetName : `${item.sourceSheetName} · ${rows.join(', ')}행`;
}

export function itemLabel(item: BomQuoteItemType): string {
  if (item.mpn.trim() !== '') return item.mpn;
  const raw = item.sourceRow?.valueRaw;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : '품번 미기재';
}

export const isManualQuoteItem = (item: BomQuoteItemType): boolean => item.manualEntry === true;

/** 품목 표의 'RFQ 발송 행 선택' 툴바 — 발송 대화상자에서 이리로 데려온다(focusRfqRowPicker). */
export const RFQ_ROW_PICKER_ID = 'smartbom-rfq-row-picker';

export function useCaseItems(core: CaseCore) {
  const { detailId, detail, detailQuery, scopeItems, rfqs, rfqQuery, pos, poQuery } = core;

  // ── RFQ 부분 행 선택(§6.13 개정) — 판단 근거(선정 구매 조건·매칭)가 있는 품목 표에서 체크하고,
  // 발송 대화상자는 요약·확인만 한다(편집 창구 단일). 선택 없음 = 전체 발송.
  const rfqItemSelection = ref<Set<string>>(new Set());
  const scopeItemIds = computed(() => new Set(scopeItems.value.map((item) => item.id)));
  const rfqSelectable = (item: BomQuoteItemType): boolean => scopeItemIds.value.has(item.id);
  const allRfqRowsSelected = computed(
    () => scopeItems.value.length > 0 && rfqItemSelection.value.size === scopeItems.value.length,
  );

  const rfqQuickSelectionGroups = computed<RfqQuickSelectionGroups>(() => {
    const groups: RfqQuickSelectionGroups = {
      resistorIds: [],
      capacitorIds: [],
      passiveIds: [],
      withoutResistorIds: [],
      withoutCapacitorIds: [],
      withoutPassiveIds: [],
      unofferedIds: [],
      unclassifiedCount: 0,
    };
    for (const item of scopeItems.value) {
      const componentType = rfqEngineComponentType(item);
      if (componentType === 'resistor') groups.resistorIds.push(item.id);
      else groups.withoutResistorIds.push(item.id);
      if (componentType === 'capacitor') groups.capacitorIds.push(item.id);
      else groups.withoutCapacitorIds.push(item.id);
      if (componentType === 'resistor' || componentType === 'capacitor') groups.passiveIds.push(item.id);
      else groups.withoutPassiveIds.push(item.id);
      if (componentType === null) groups.unclassifiedCount += 1;
      if (item.selectedOffer === null) groups.unofferedIds.push(item.id);
    }
    return groups;
  });

  function applyRfqQuickSelection(ids: readonly string[]): void {
    // 빈 선택은 계약상 '전체 발송'이므로 0건 퀵 액션이 기존 선택을 지우지 않게 방어한다.
    if (ids.length === 0) return;
    rfqItemSelection.value = new Set(ids);
  }
  /** [저항 제외]·[캐패시터 제외]·[저항+캐패시터 제외] — 그 유형을 뺀 나머지를 선택한다. */
  function selectRfqRowsExcluding(componentType: RfqPassiveComponentType | 'passive'): void {
    const groups = rfqQuickSelectionGroups.value;
    applyRfqQuickSelection(
      componentType === 'resistor'
        ? groups.withoutResistorIds
        : componentType === 'capacitor'
          ? groups.withoutCapacitorIds
          : groups.withoutPassiveIds,
    );
  }
  function toggleRfqRow(itemId: string): void {
    const next = new Set(rfqItemSelection.value);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    rfqItemSelection.value = next;
  }
  function toggleAllRfqRows(): void {
    rfqItemSelection.value = allRfqRowsSelected.value ? new Set() : new Set(scopeItems.value.map((item) => item.id));
  }
  function useFullRfqScope(): void {
    rfqItemSelection.value = new Set();
  }
  // 발송 대화상자 [품목 표에서 고르기] — 발송 버튼(RFQ 패널)과 체크(품목 표)가 떨어져 있어 찾기 어려웠다.
  // 접혀 있으면 펼치고(§6.12) 선택 툴바로 데려가 잠깐 테두리를 칠한다.
  const rfqRowPickerFlash = ref(false);
  let rfqRowPickerFlashTimer: number | undefined;
  async function focusRfqRowPicker(): Promise<void> {
    core.expandSection('items');
    await nextTick();
    const el = document.getElementById(RFQ_ROW_PICKER_ID);
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    rfqRowPickerFlash.value = true;
    window.clearTimeout(rfqRowPickerFlashTimer);
    rfqRowPickerFlashTimer = window.setTimeout(() => {
      rfqRowPickerFlash.value = false;
    }, 1800);
  }
  // 실무 퀵 액션 — 공급사 구매 조건이 없는 행만 협력사에 문의하는 흔한 패턴.
  function selectUnofferedRfqRows(): void {
    applyRfqQuickSelection(rfqQuickSelectionGroups.value.unofferedIds);
  }

  // ── 협력사 보유 부품(docs/PARTNER_PARTS.md) — "이 행을 누가 갖고 있나"는 발송 판단의 근거다.
  // 제한은 두지 않으므로(사용자 결정) 강제하지 않고 고르기 쉽게만 한다: 행 칩 + 퀵 액션.
  const partnerStockQuery = useAdminBomQuotePartnerStock(detailId);
  const partnerHoldersByItem = computed(() => partnerStockQuery.data.value?.data.itemHolders ?? {});
  const partnerItemsByPartner = computed(() => partnerStockQuery.data.value?.data.partnerItems ?? {});
  const itemPartnerHolders = (itemId: string): AdminBomQuoteItemPartnerHolderType[] =>
    partnerHoldersByItem.value[itemId] ?? [];
  const partnerStockItemIds = computed(() =>
    scopeItems.value.filter((item) => itemPartnerHolders(item.id).length > 0).map((item) => item.id),
  );
  function selectPartnerStockRows(): void {
    applyRfqQuickSelection(partnerStockItemIds.value);
  }
  const partnerHolderTitle = (itemId: string): string => {
    const holders = itemPartnerHolders(itemId);
    if (holders.length === 0) return '';
    return holders
      .map((holder) => {
        const parts = [holder.partnerName];
        if (holder.stockQty !== null) parts.push(`재고 ${holder.stockQty.toLocaleString('ko-KR')}`);
        if (holder.dateCode !== null) parts.push(holder.dateCode);
        if (!holder.rfqEligible) parts.push('BOM 견적 트랙 없음');
        return parts.join(' · ');
      })
      .join('\n');
  };

  // ── 품목 관점 RFQ 현황 — RFQ 패널(협력사 관점)의 역방향 인덱스. 현재 유효 범위 안에서 이 행을 요청한
  // 협력사와 행별 회신 상태를 보인다. 문서가 quoted 여도 특정 행 회신이 없을 수 있어 '행 미회신'을 둔다.
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
  const rfqBadgesFor = (itemId: string): readonly ItemRfqBadge[] => itemRfqBadges.value.get(itemId) ?? [];
  function itemRfqBadgeTitle(badge: ItemRfqBadge): string {
    const requestScope = badge.rfq.requestedItemIds === null ? '전체 요청' : '부분 요청';
    const price = badge.unitPrice === null ? '' : ` · ${badge.unitPrice.toLocaleString('ko-KR')} ${badge.currency}`;
    return `${badge.rfq.partnerName} · ${requestScope} · ${badge.label}${price} — 클릭하면 회신을 엽니다`;
  }

  // ── 관리자 부품 교체(D25) — 업무 영향은 2차 확인 뒤 강제 변경 가능 ───────────────
  const candidateItemId = ref<string | null>(null);
  const candidateDrawerView = ref<'candidates' | 'search'>('candidates');
  const candidateQuery = useAdminBomQuoteCandidates(detailId, candidateItemId);
  const candidateSelection = useSelectAdminBomQuoteItem();
  const candidateSelectionError = ref('');
  const partAdd = useAddAdminBomQuoteItem();
  const partRemove = useRemoveAdminBomQuoteItem();
  const itemReview = useReviewAdminBomQuoteItems();

  const candidateItem = computed(() =>
    candidateItemId.value === null ? null : (detail.value?.items.find((item) => item.id === candidateItemId.value) ?? null),
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
  const partChangeUnavailableReason = (_item: BomQuoteItemType): string | null => partMutationUnavailableReason();

  function partChangeForceReason(item: BomQuoteItemType): string | null {
    const quote = detail.value;
    if (quote === null) return null;
    if (quote.status !== 'requested' && quote.status !== 'reviewing') {
      return '이미 고객 회신 확정 또는 마감 단계에 진입한 견적입니다';
    }
    if (quote.orderState !== 'none' || quote.orderInfo !== null) return '장바구니 또는 주문으로 전환된 견적입니다';
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
    return item === null || candidateSelectionUnavailableReason.value !== null ? null : partChangeForceReason(item);
  });
  const candidateSelectionNotice = computed(
    () => candidateSelectionUnavailableReason.value ?? candidateSelectionForceReason.value,
  );
  const candidateForceSelectionAllowed = computed(
    () => candidateSelectionUnavailableReason.value === null && candidateSelectionForceReason.value !== null,
  );

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

  const pendingPartSelection = ref<PendingAdminPartSelection | null>(null);
  const forcePartSelectionConfirmed = ref(false);
  const pendingLineDelta = computed(() => {
    const pending = pendingPartSelection.value;
    const previousLineTotalKrw = pending?.previousLineTotalKrw;
    const nextLineTotalKrw = pending?.nextLineTotalKrw;
    if (
      previousLineTotalKrw === null ||
      previousLineTotalKrw === undefined ||
      nextLineTotalKrw === null ||
      nextLineTotalKrw === undefined
    )
      return null;
    return Math.round((nextLineTotalKrw - previousLineTotalKrw) * 100) / 100;
  });

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
    const offer =
      appliedOfferKey === null ? null : (candidate.offers.find((entry) => entry.offerKey === appliedOfferKey) ?? null);
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
    const nextLineTotalKrw =
      pick?.unitPriceKrw === null || pick?.unitPriceKrw === undefined
        ? null
        : Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
    const impact = partSelectionImpact(item);
    forcePartSelectionConfirmed.value = false;
    pendingPartSelection.value = {
      body: {
        kind: 'catalog',
        partId: part.id,
        offer: pick === null ? null : { supplier: pick.offer.supplier, supplierSku: pick.offer.supplierSku },
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
      candidateSelectionError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '부품 변경을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      pendingPartSelection.value = null;
      forcePartSelectionConfirmed.value = false;
      await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
    }
  }

  // ── 관리자 부품 추가·수동 행 제거(D26) — 업로드 원본 행은 제거하지 않는다. 추가는 카탈로그 정체성과
  // 세트당 수량만 보내고, 서버가 구매 조건·MOQ·주문배수·환율과 RFQ 범위를 트랜잭션 안에서 다시 판단한다.
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
    if (quote.orderState !== 'none' || quote.orderInfo !== null) return '장바구니 또는 주문으로 전환된 견적입니다';
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
    const lineTotalKrw =
      pick?.unitPriceKrw === null || pick?.unitPriceKrw === undefined
        ? null
        : Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
    forcePartAddConfirmed.value = false;
    pendingPartAdd.value = {
      body: {
        partId: part.id,
        offer: pick === null ? null : { supplier: pick.offer.supplier, supplierSku: pick.offer.supplierSku },
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
      partAddError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '부품을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      pendingPartAdd.value = null;
      forcePartAddConfirmed.value = false;
      await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
    }
  }

  const pendingPartRemove = ref<PendingAdminPartRemove | null>(null);
  const forcePartRemoveConfirmed = ref(false);
  const partRemoveError = ref('');

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
      body: { expectedQuoteUpdatedAt: quote.updatedAt, force: impact.forceReason !== null },
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
      partRemoveError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '수동 추가 부품을 제거하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      pendingPartRemove.value = null;
      forcePartRemoveConfirmed.value = false;
      await Promise.all([detailQuery.refetch(), rfqQuery.refetch(), poQuery.refetch()]);
    }
  }

  // ── 관리자 품목 확인 대기열 — 엔진 판정은 그대로 두고 업무 우선순위·완료 이력만 투영한다 ─────
  const adminItemFilter = ref<AdminItemFilter>('all');
  const adminItemSearch = ref('');
  // 기본은 원본 Excel 행 순서. 관리자가 필요할 때만 확인 대상을 앞으로 모은다.
  const attentionFirst = ref(false);
  const itemReviewError = ref('');
  const reviewingItemIds = ref<Set<string>>(new Set());

  const adminItemViews = computed<AdminItemView[]>(() =>
    (detail.value?.items ?? []).map((item) => {
      const attention = bomQuoteAdminAttention(item);
      return { item, attention, pending: attention.reviewRequired && !item.adminReview.completed };
    }),
  );

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
          view.attention.kind === 'blocking' ||
          view.attention.kind === 'procurement' ||
          view.attention.kind === 'technical' ||
          view.attention.kind === 'inquiry'
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
      if (adminItemFilter.value === 'ready') return view.attention.kind !== 'excluded' && !view.pending;
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

  const canUpdateItemReview = computed(
    () => detail.value?.status === 'requested' || detail.value?.status === 'reviewing',
  );

  const adminReviewSummaryLabel = computed(() => {
    if (adminReviewPendingCount.value === 0) return '확인 완료';
    if (canUpdateItemReview.value) return `${String(adminReviewPendingCount.value)}건 남음`;
    return `${String(adminReviewPendingCount.value)}건 확인 기록 없음`;
  });
  /** 요약 배지 — 다 끝났으면 완료, 남았는데 검토 중이면 문제(먼저 끝내야 회신 확정), 회신 뒤면 이력. */
  const adminReviewSummaryVariant = computed<'success' | 'danger' | 'secondary'>(() => {
    if (adminReviewPendingCount.value === 0) return 'success';
    return canUpdateItemReview.value ? 'danger' : 'secondary';
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
    const labels = view.attention.reasons.slice(0, 2).map((reason) => ADMIN_ATTENTION_REASON_LABEL[reason]);
    const suffix = view.attention.reasons.length > 2 ? ` 외 ${String(view.attention.reasons.length - 2)}` : '';
    const prefix = !view.pending && labels.length > 0 ? '참고 · ' : '';
    return `${prefix}${labels.join(' · ')}${suffix}`;
  }

  function itemReviewActionLabel(view: AdminItemView): string {
    if (view.item.adminReview.completed) return '재검토';
    return view.attention.reasons.includes('unmatched') ? '미매칭 상태 확인' : '확인 완료';
  }

  async function updateItemReviews(itemIds: readonly string[], completed: boolean): Promise<void> {
    const quote = detail.value;
    if (detailId.value === null || quote === null || itemIds.length === 0) return;
    itemReviewError.value = '';
    reviewingItemIds.value = new Set(itemIds);
    try {
      await itemReview.mutateAsync({
        quoteId: detailId.value,
        body: { itemIds: [...itemIds], completed, expectedQuoteUpdatedAt: quote.updatedAt },
      });
    } catch (error) {
      itemReviewError.value =
        error instanceof ApiRequestError
          ? (error.payload?.message ?? error.message)
          : '품목 검토 상태를 저장하지 못했습니다.';
    } finally {
      reviewingItemIds.value = new Set();
    }
  }

  async function completeItemReviews(itemIds: readonly string[]): Promise<void> {
    const targetIds = new Set(itemIds);
    const unmatchedCount = adminItemViews.value.filter(
      (view) => targetIds.has(view.item.id) && view.pending && view.attention.reasons.includes('unmatched'),
    ).length;
    if (
      unmatchedCount > 0 &&
      !(await confirmDialog({
        title: '미매칭 상태 확인',
        message: `선택한 품목 중 미매칭 ${String(unmatchedCount)}건을 현재 상태로 확인할까요?\n\n부품 선정과 가격은 생성되지 않고 금액 미산출 상태로 남습니다. 이 처리는 미매칭 해결이 아니라 관리자의 예외 수용이며, 모든 품목 확인이 끝나면 고객 회신 확정이 가능해집니다.`,
        confirmLabel: '미매칭 상태 확인',
      }))
    )
      return;
    await updateItemReviews(itemIds, true);
  }

  return {
    rfqItemSelection,
    rfqSelectable,
    allRfqRowsSelected,
    rfqQuickSelectionGroups,
    selectRfqRowsExcluding,
    toggleRfqRow,
    toggleAllRfqRows,
    useFullRfqScope,
    rfqRowPickerFlash,
    focusRfqRowPicker,
    selectUnofferedRfqRows,
    partnerHoldersByItem,
    partnerItemsByPartner,
    itemPartnerHolders,
    partnerStockItemIds,
    selectPartnerStockRows,
    partnerHolderTitle,
    rfqBadgesFor,
    itemRfqBadgeTitle,
    candidateItemId,
    candidateDrawerView,
    candidateQuery,
    candidateSelection,
    candidateSelectionError,
    candidateItem,
    candidateSelectionUnavailableReason,
    candidateSelectionNotice,
    candidateForceSelectionAllowed,
    partMutationUnavailableReason,
    partChangeButtonTitle,
    pendingPartSelection,
    forcePartSelectionConfirmed,
    pendingLineDelta,
    openPartSelection,
    closePartSelection,
    requestCandidateSelection,
    requestCatalogSelection,
    cancelPendingPartSelection,
    confirmPartSelection,
    partAdd,
    partAddOpen,
    partAddError,
    pendingPartAdd,
    forcePartAddConfirmed,
    partAddUnavailableReason,
    openPartAdd,
    closePartAdd,
    requestPartAdd,
    cancelPendingPartAdd,
    confirmPartAdd,
    partRemove,
    pendingPartRemove,
    forcePartRemoveConfirmed,
    partRemoveError,
    requestPartRemove,
    cancelPendingPartRemove,
    confirmPartRemove,
    itemReview,
    adminItemFilter,
    adminItemSearch,
    attentionFirst,
    itemReviewError,
    reviewingItemIds,
    adminItemFilterCounts,
    adminReviewPendingCount,
    visibleAdminItemViews,
    visiblePendingReviewIds,
    canUpdateItemReview,
    adminReviewSummaryLabel,
    adminReviewSummaryVariant,
    adminAttentionTitle,
    adminAttentionReasonSummary,
    itemReviewActionLabel,
    updateItemReviews,
    completeItemReviews,
  };
}

export type CaseItems = ReturnType<typeof useCaseItems>;
