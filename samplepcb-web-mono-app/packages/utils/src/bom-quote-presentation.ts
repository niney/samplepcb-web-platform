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

export function bomQuoteItemMatchGroup(item: BomQuoteItemType): BomQuoteItemMatchGroup {
  if (isBomQuoteEngineSearchExcluded(item)) return 'excluded';
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
    if (
      item.selectionSource === 'auto'
      && item.matchEvidence?.selectionApplicationState === 'provisional_selected'
      && item.matchEvidence.confirmationRequired
    ) {
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
