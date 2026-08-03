import { z } from 'zod';
import type { PartDetailType } from '@sp/api-contract';
import { prisma } from './prisma';
import { specsSiRecord } from './parts-es';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import {
  isCatalogInquiryOffer,
  partOfferDerivedFrom,
  partOfferKind,
  partOffersForDisplay,
} from './parts-offer-kind';
import { normalizeSupplierPackaging } from './supplier-packaging';

// 부품 상세(DB) DTO 빌더 — 관리자 카탈로그 상세와 고객 BOM 오퍼 변경 모달이 공유.
// 집계는 실공급사만(파생 samplepcb 오퍼는 원천과 이중 계산) — 목록(hit)과 동일 기준.

const SpecConflictsJson = z.record(
  z.string(),
  z.array(z.object({ value: z.unknown(), suppliers: z.array(z.string()), fetchedAt: z.string() })),
);

export async function loadPartDetailDto(id: bigint): Promise<PartDetailType | null> {
  const part = await prisma.spPart.findUnique({
    where: { id },
    include: { offers: { include: { priceBreaks: true } } },
  });
  if (part === null) return null;
  const visibleOffers = partOffersForDisplay(part.offers);
  const realOffers = visibleOffers.filter((offer) => offer.supplier !== SAMPLEPCB_SUPPLIER);
  const ownCatalogOffers = visibleOffers.filter(
    (offer) =>
      offer.supplier === SAMPLEPCB_SUPPLIER
      && isCatalogInquiryOffer(offer.rawJson),
  );
  const freshnessOffers = realOffers.length === 0 ? ownCatalogOffers : realOffers;
  const conflicts = SpecConflictsJson.safeParse(part.specConflicts);
  return {
    id: String(part.id),
    mpn: part.mpn,
    manufacturerName: part.manufacturerName,
    description: part.description,
    category: part.category,
    packageCode: part.packageCode,
    lifecycle: part.lifecycle,
    imageUrl: part.imageUrl,
    specsSi: specsSiRecord(part.specsSi),
    specsJson:
      typeof part.specsJson === 'object' && part.specsJson !== null && !Array.isArray(part.specsJson)
        ? part.specsJson
        : {},
    specConflicts: conflicts.success ? conflicts.data : null,
    hasSpecConflict: conflicts.success && Object.keys(conflicts.data).length > 0,
    suppliers: [...new Set(visibleOffers.map((offer) => offer.supplier))],
    offerCount: realOffers.length + ownCatalogOffers.length,
    minPrice: null,
    minPriceCurrency: null,
    totalStock: realOffers.reduce((sum, o) => sum + (o.stock ?? 0), 0),
    offersFetchedAt:
      freshnessOffers.length === 0
        ? null
        : new Date(Math.max(...freshnessOffers.map((offer) => offer.fetchedAt.getTime()))).toISOString(),
    score: null,
    hasCatalogInquiryOffer: visibleOffers.some((offer) => isCatalogInquiryOffer(offer.rawJson)),
    firstSeenAt: part.firstSeenAt.toISOString(),
    lastSeenAt: part.lastSeenAt.toISOString(),
    offers: visibleOffers.map((o) => {
      const derivedFrom = o.supplier === SAMPLEPCB_SUPPLIER
        ? partOfferDerivedFrom(o.rawJson)
        : null;
      return {
        supplier: o.supplier,
        offerKind: partOfferKind(o.rawJson),
        supplierSku: o.supplierSku,
        productUrl: o.productUrl,
        stock: o.stock,
        moq: o.moq,
        orderMultiple: o.orderMultiple,
        packaging: normalizeSupplierPackaging(derivedFrom?.supplier ?? o.supplier, o.packaging),
        leadTime: o.leadTime,
        currency: o.currency,
        priceBreaks: [...o.priceBreaks]
          .sort((a, b) => a.qty - b.qty)
          .map((pb) => ({ qty: pb.qty, price: Number(pb.price) })),
        fetchedAt: o.fetchedAt.toISOString(),
        derivedFrom,
      };
    }),
  };
}
