import type { PartOfferKindType } from '@sp/api-contract';

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * DB offer.rawJson은 공급사 product 원문이다. 명시적인 offer_kind를 우선하고,
 * 기존 제조사 카탈로그 데이터는 catalog_metadata로도 복원한다.
 */
export function partOfferKind(rawJson: unknown): PartOfferKindType {
  const product = objectValue(rawJson);
  if (product?.offer_kind === 'manufacturer_catalog') return 'manufacturer_catalog';

  const metadata = objectValue(product?.catalog_metadata);
  if (metadata?.catalogOnly === true && metadata.commercialDataAvailable !== true) {
    return 'manufacturer_catalog';
  }
  return 'supplier_offer';
}

export function isCatalogInquiryOffer(rawJson: unknown): boolean {
  return partOfferKind(rawJson) === 'manufacturer_catalog';
}
