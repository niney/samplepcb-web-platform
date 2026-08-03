import type { BomQuoteItemType } from '@sp/api-contract';

export type BomQuoteItemMatchGroup = 'matched' | 'review' | 'unmatched' | 'nostock' | 'excluded';

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
