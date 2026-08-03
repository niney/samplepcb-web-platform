import type { PartOfferKindType } from '@sp/api-contract';
import { z } from 'zod';

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

/**
 * SamplePCB 취급 카탈로그에서 제조사 원천 정보는 기술 사실과 원본 추적을 위한 원천이다.
 * 같은 rawJson을 쓰는 SamplePCB 구매 조건만 실제 문의·판매 창구이므로 제조사 원천 정보를 공급사
 * 패싯과 구매 조건 목록에 노출하지 않는다.
 */
export function isCatalogProvenanceOffer(
  supplier: string,
  rawJson: unknown,
): boolean {
  if (!isCatalogInquiryOffer(rawJson)) return false;
  const product = objectValue(rawJson);
  const metadata = objectValue(product?.catalog_metadata);
  const sourceSupplier = product?.supplier;
  return metadata?.samplepcbPreferred === true
    && typeof sourceSupplier === 'string'
    && sourceSupplier.trim().toLowerCase() === supplier.trim().toLowerCase()
    && supplier.trim().toLowerCase() !== 'samplepcb';
}

export function partOffersForDisplay<
  T extends { supplier: string; rawJson: unknown },
>(offers: readonly T[]): T[] {
  return offers.filter((offer) =>
    !isCatalogProvenanceOffer(offer.supplier, offer.rawJson));
}

const DerivedFrom = z.object({
  supplier: z.string(),
  supplierSku: z.string(),
  fetchedAt: z.string(),
});

const DerivedFromRaw = z.object({ derivedFrom: DerivedFrom });
const SamplepcbPricingRaw = z.object({
  samplepcbPricing: z.object({ derivedFrom: DerivedFrom }),
});

/** 기존 파생 구매 조건과 카탈로그 가격 오버레이의 원천 표기를 모두 복원한다. */
export function partOfferDerivedFrom(
  rawJson: unknown,
): z.infer<typeof DerivedFrom> | null {
  const direct = DerivedFromRaw.safeParse(rawJson);
  if (direct.success) return direct.data.derivedFrom;
  const pricing = SamplepcbPricingRaw.safeParse(rawJson);
  return pricing.success ? pricing.data.samplepcbPricing.derivedFrom : null;
}
