import type { BomQuoteCandidateOfferType, BomQuoteItemType } from '@sp/api-contract';
import { isSevereOrderSurplus } from './bom-pricing';

export type BomQuoteItemMatchGroup = 'matched' | 'review' | 'unmatched' | 'nostock' | 'excluded';

/**
 * 관리자 Case 품목 표의 업무 우선순위. 엔진의 기술 판정을 바꾸지 않고, 이미 저장된
 * 판정·구매 근거를 관리자가 처리하기 쉬운 한 가지 대표 상태로 투영한다.
 */
export type BomQuoteAdminAttentionKind =
  | 'blocking'
  | 'procurement'
  | 'technical'
  | 'inquiry'
  | 'ready'
  | 'excluded';

export type BomQuoteAdminAttentionReason =
  | 'quantity_missing'
  | 'unmatched'
  | 'uncosted'
  | 'out_of_stock'
  | 'insufficient_stock'
  | 'stock_unverified'
  | 'selected_stock_short'
  | 'replacement_pending'
  | 'confirmation_required'
  | 'engine_review'
  | 'lifecycle_attention'
  | 'requirement_conflict'
  | 'requirement_missing'
  | 'technical_fallback'
  | 'supplier_search_limited'
  | 'catalog_inquiry';

export interface BomQuoteAdminAttention {
  kind: BomQuoteAdminAttentionKind;
  reasons: BomQuoteAdminAttentionReason[];
  /** 제외·정상 외에 관리자가 명시적으로 확인해야 하는 품목인지 여부. */
  reviewRequired: boolean;
}

export interface BomQuotePresentationStats {
  total: number;
  matched: number;
  matchedPct: number;
  nostock: number;
  nostockPct: number;
  review: number;
  unmatched: number;
  excluded: number;
  unresolved: number;
  included: number;
  uncosted: number;
  pendingReview: number;
  itemsTotal: number;
}

/**
 * 후보 카드가 서버의 구매 조건 판정을 다시 만들지 않고, 공급사별 차단 근거를
 * 사용자에게 설명할 수 있도록 저장된 offer 판정 사유를 표시용 건수로 집계한다.
 * 한 구매 조건에 가격·재고·과다수량 문제가 함께 있으면 각 항목에 모두 집계한다.
 */
export interface BomQuoteCandidateOfferIssueCounts {
  priceUnavailable: number;
  outOfStock: number;
  insufficientStock: number;
  stockUnverified: number;
  excessiveOrder: number;
  other: number;
}

/** 서버가 구매 가능으로 판정했고 현재 필요수량에 적용 결과까지 있는 조건만 센다. */
export function hasBomQuotePurchasableOffer(
  offers: readonly BomQuoteCandidateOfferType[],
): boolean {
  return offers.some((offer) => offer.purchasable && offer.applied !== null);
}

export function summarizeBomQuoteCandidateOfferIssues(
  offers: readonly BomQuoteCandidateOfferType[],
  neededQty: number,
): BomQuoteCandidateOfferIssueCounts {
  const counts: BomQuoteCandidateOfferIssueCounts = {
    priceUnavailable: 0,
    outOfStock: 0,
    insufficientStock: 0,
    stockUnverified: 0,
    excessiveOrder: 0,
    other: 0,
  };

  for (const offer of offers) {
    if (offer.offerKind === 'manufacturer_catalog') continue;
    const reasons = new Set(offer.decisionReasonCodes);
    let recognized = false;

    if (
      reasons.has('price_unavailable')
      || reasons.has('price_break_unavailable_for_quantity')
      || reasons.has('currency_rate_missing')
      || offer.priceBreaks.length === 0
      || offer.applied?.unitPriceKrw === null
    ) {
      counts.priceUnavailable += 1;
      recognized = true;
    }

    if (offer.stock === 0) {
      counts.outOfStock += 1;
      recognized = true;
    } else if (
      offer.applied?.stockShort === true
      || reasons.has('stock_short')
      || reasons.has('stock_shortage_not_allowed')
    ) {
      counts.insufficientStock += 1;
      recognized = true;
    } else if (
      offer.stock === null
      || reasons.has('stock_unverified')
      || reasons.has('stock_unverified_not_allowed')
    ) {
      counts.stockUnverified += 1;
      recognized = true;
    }

    if (
      reasons.has('automatic_selection_excessive')
      || (
        offer.applied !== null
        && isSevereOrderSurplus(neededQty, offer.applied.orderQty)
      )
    ) {
      counts.excessiveOrder += 1;
      recognized = true;
    }

    if (!offer.purchasable && !recognized) counts.other += 1;
  }

  return counts;
}

export function hasBomQuoteEngineStockConstraint(item: BomQuoteItemType): boolean {
  const reason = item.matchEvidence?.procurementUnavailabilityReason;
  return reason === 'out_of_stock'
    || reason === 'insufficient_stock'
    || reason === 'stock_unverified';
}

export function isBomQuoteStockShort(item: BomQuoteItemType): boolean {
  const reason = item.matchEvidence?.procurementUnavailabilityReason;
  if (reason === 'out_of_stock' || reason === 'insufficient_stock') return true;
  const offer = item.selectedOffer;
  return offer !== null && offer.stock !== null && offer.stock < item.orderQty;
}

export function isBomQuoteEngineSearchExcluded(item: BomQuoteItemType): boolean {
  return item.matchEvidence?.componentStatus === 'excluded'
    || item.matchEvidence?.searchRequirementGuidance?.readiness === 'excluded';
}

function isBomQuoteReviewPending(
  matchStatus: string,
  matchEvidence: unknown,
): boolean {
  // 고객·관리자가 명시적으로 선택한 행은 임시 엔진 선정을 확정한 것으로 본다.
  // 구버전 저장 근거에 검토 플래그가 남아 있어도 수동 확정을 다시 Review로 되돌리지 않는다.
  if (
    matchStatus === 'manual'
    || typeof matchEvidence !== 'object'
    || matchEvidence === null
    || Array.isArray(matchEvidence)
  ) {
    return false;
  }
  const evidence = matchEvidence as Record<string, unknown>;
  return evidence.confirmationRequired === true
    || evidence.selectionApplicationState === 'provisional_selected';
}

export function isBomQuotePendingReview(item: BomQuoteItemType): boolean {
  return isBomQuoteReviewPending(item.matchStatus, item.matchEvidence);
}

/**
 * 재고 부족 이후 찾은 대체품 중 아직 명시 확정되지 않은 선택만 메인 결과의 Review로 올린다.
 * 일반 스펙 검색의 안전 후보는 검토 권장 상태를 보존하되 기존처럼 Matched로 집계한다.
 */
export function isBomQuoteAlternativeReviewPending(
  matchStatus: string,
  matchEvidence: unknown,
): boolean {
  if (!isBomQuoteReviewPending(matchStatus, matchEvidence)) return false;
  const evidence = matchEvidence as Record<string, unknown>;
  const replacementSources = evidence.selectedReplacementSources;
  const replacementForMpn = evidence.selectedReplacementForMpn;
  return (Array.isArray(replacementSources) && replacementSources.length > 0)
    || (typeof replacementForMpn === 'string' && replacementForMpn.trim() !== '');
}

export function isBomQuoteAlternativePendingReview(item: BomQuoteItemType): boolean {
  return isBomQuoteAlternativeReviewPending(item.matchStatus, item.matchEvidence);
}

export function bomQuoteItemMatchGroup(item: BomQuoteItemType): BomQuoteItemMatchGroup {
  if (isBomQuoteEngineSearchExcluded(item)) return 'excluded';
  if (isBomQuoteAlternativePendingReview(item)) return 'review';
  if (hasBomQuoteEngineStockConstraint(item) || isBomQuoteStockShort(item)) return 'nostock';
  if (item.matchStatus !== 'none') return 'matched';
  if (item.matchEvidence?.selectionMode === 'review') return 'review';
  return 'unmatched';
}

const lifecycleNeedsAdminAttention = (item: BomQuoteItemType): boolean => {
  const requested = item.matchEvidence?.requestedLifecycle?.code;
  const selected = item.matchEvidence?.selectedLifecycle?.code;
  return (requested !== undefined && requested !== 'active' && requested !== 'unknown')
    || (selected !== undefined && selected !== 'active' && selected !== 'unknown');
};

/**
 * 관리자 검토 상태는 sp-engine의 판정을 재계산하지 않는다. 수량·금액처럼 sp-node가
 * 소유하는 업무 상태와 엔진이 내려준 근거를 합쳐 대표 상태와 상세 사유만 만든다.
 */
export function bomQuoteAdminAttention(item: BomQuoteItemType): BomQuoteAdminAttention {
  if (!item.included || isBomQuoteEngineSearchExcluded(item)) {
    return { kind: 'excluded', reasons: [], reviewRequired: false };
  }

  const evidence = item.matchEvidence;
  const reasons: BomQuoteAdminAttentionReason[] = [];
  const group = bomQuoteItemMatchGroup(item);
  const procurementReason = evidence?.procurementUnavailabilityReason;
  // 과거 저장 근거는 최신 계약보다 필드가 적을 수 있으므로 런타임에서도 배열을 확인한다.
  const conflictCount = Array.isArray(evidence?.conflicts) ? evidence.conflicts.length : 0;
  const missingRequirementCount = Array.isArray(evidence?.missingRequirements)
    ? evidence.missingRequirements.length
    : 0;

  if (item.quantityState === 'missing') reasons.push('quantity_missing');
  if (group === 'unmatched') reasons.push('unmatched');
  if (item.lineTotalKrw === null) reasons.push('uncosted');
  if (procurementReason === 'out_of_stock') reasons.push('out_of_stock');
  if (procurementReason === 'insufficient_stock') reasons.push('insufficient_stock');
  if (procurementReason === 'stock_unverified') reasons.push('stock_unverified');
  if (
    item.selectedOffer !== null
    && item.selectedOffer.stock !== null
    && item.selectedOffer.stock < item.orderQty
    && !reasons.includes('out_of_stock')
    && !reasons.includes('insufficient_stock')
  ) {
    reasons.push('selected_stock_short');
  }
  if (isBomQuoteAlternativePendingReview(item)) reasons.push('replacement_pending');
  if (isBomQuotePendingReview(item)) reasons.push('confirmation_required');
  if (evidence?.selectionMode === 'review') reasons.push('engine_review');
  if (lifecycleNeedsAdminAttention(item)) reasons.push('lifecycle_attention');
  if (conflictCount > 0) reasons.push('requirement_conflict');
  if (missingRequirementCount > 0) reasons.push('requirement_missing');
  if (evidence?.technicalFallbackUsed === true) reasons.push('technical_fallback');
  if ((evidence?.searchTraceSummary?.limitReasons?.length ?? 0) > 0) {
    reasons.push('supplier_search_limited');
  }
  if (item.catalogInquiry) reasons.push('catalog_inquiry');

  if (item.quantityState === 'missing' || group === 'unmatched') {
    return { kind: 'blocking', reasons, reviewRequired: true };
  }
  if (item.catalogInquiry) {
    return { kind: 'inquiry', reasons, reviewRequired: true };
  }
  if (group === 'nostock') {
    return { kind: 'procurement', reasons, reviewRequired: true };
  }
  if (
    group === 'review'
    || isBomQuotePendingReview(item)
    || evidence?.selectionMode === 'review'
    || lifecycleNeedsAdminAttention(item)
    || conflictCount > 0
    || missingRequirementCount > 0
    || evidence?.technicalFallbackUsed === true
    || (evidence?.searchTraceSummary?.limitReasons?.length ?? 0) > 0
  ) {
    return { kind: 'technical', reasons, reviewRequired: true };
  }
  if (item.lineTotalKrw === null) {
    return { kind: 'inquiry', reasons, reviewRequired: true };
  }
  return { kind: 'ready', reasons, reviewRequired: false };
}

export function summarizeBomQuoteItems(
  items: readonly BomQuoteItemType[],
): BomQuotePresentationStats {
  let matched = 0;
  let review = 0;
  let unmatched = 0;
  let excluded = 0;
  let nostock = 0;
  let included = 0;
  let uncosted = 0;
  let pendingReview = 0;
  let lineSum = 0;

  for (const item of items) {
    const group = bomQuoteItemMatchGroup(item);
    if (group === 'matched') matched += 1;
    else if (group === 'review') review += 1;
    else if (group === 'unmatched') unmatched += 1;
    else if (group === 'nostock') nostock += 1;
    else excluded += 1;

    if (!item.included) continue;
    included += 1;
    if (isBomQuotePendingReview(item)) {
      pendingReview += 1;
    }
    if (item.lineTotalKrw === null) uncosted += 1;
    else lineSum += item.lineTotalKrw;
  }

  const total = items.length;
  return {
    total,
    matched,
    matchedPct: total === 0 ? 0 : Math.round((matched / total) * 100),
    nostock,
    nostockPct: total === 0 ? 0 : Math.round((nostock / total) * 100),
    review,
    unmatched,
    excluded,
    unresolved: review + unmatched,
    included,
    uncosted,
    pendingReview,
    itemsTotal: Math.round(lineSum),
  };
}
