import type { Prisma, SpPart, SpPartOffer, SpPartPriceBreak } from '@prisma/client';
import {
  SPEC_SI_FIELD,
  normalizePackageCode,
  packageVariants,
  roundSig,
  variantsFor,
  type SpecKind,
} from '@sp/utils';
import { esClient } from '../es/client';
import { SP_PARTS_WRITE, type SpPartDoc } from '../es/sp-parts-index';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import {
  isCatalogInquiryOffer,
  partOffersForDisplay,
} from './parts-offer-kind';

// SpPart(DB 진실원본) → sp-parts 검색 요약 문서 빌드 + 색인.
// 문서는 언제든 DB 에서 재구축 가능(parts:reindex) — ES 는 파생물이다.

export type PartWithOffers = SpPart & { offers: (SpPartOffer & { priceBreaks: SpPartPriceBreak[] })[] };

const KIND_BY_FIELD = Object.fromEntries(
  Object.entries(SPEC_SI_FIELD).map(([kind, field]) => [field, kind as SpecKind]),
) as Record<string, SpecKind>;

/** specsSi Json → 숫자 레코드(SPEC_SI_FIELD 키만, 유효 6자리). */
export function specsSiRecord(specsSi: Prisma.JsonValue): Record<string, number> {
  const out: Record<string, number> = {};
  if (specsSi === null || typeof specsSi !== 'object' || Array.isArray(specsSi)) return out;
  for (const [field, value] of Object.entries(specsSi)) {
    if (KIND_BY_FIELD[field] !== undefined && typeof value === 'number' && Number.isFinite(value)) {
      out[field] = roundSig(value);
    }
  }
  return out;
}

export function buildPartDoc(part: PartWithOffers): SpPartDoc {
  const si = specsSiRecord(part.specsSi);
  const specs = part.specsJson !== null
    && typeof part.specsJson === 'object'
    && !Array.isArray(part.specsJson)
    ? part.specsJson
    : {};
  const partType = typeof specs.part_type === 'string'
    ? specs.part_type.trim().toLowerCase()
    : null;
  const dielectric = typeof specs.dielectric === 'string'
    ? specs.dielectric.trim().toUpperCase()
    : null;

  // Track B: 관행 표기 변형 — SI 값마다 kind 별 생성
  const specVariants = new Set<string>();
  for (const [field, value] of Object.entries(si)) {
    const kind = KIND_BY_FIELD[field];
    if (kind === undefined) continue;
    for (const v of variantsFor(kind, value)) specVariants.add(v);
  }

  // 패키지: 임페리얼 정준이면 [임페리얼, 메트릭] 양코드 색인(0402↔1005)
  let pkgVariants: string[] = [];
  if (part.packageCode !== null && part.packageCode !== '') {
    const canon = normalizePackageCode(part.packageCode);
    pkgVariants = canon === null ? [part.packageCode] : canon.flatMap((c) => packageVariants(c));
  }

  // 구매 조건 요약 — 대표 단가는 각 구매 조건의 최소수량 구간 단가 중 최저(통화 병기).
  // 제조사 카탈로그 원천은 DB 사실·출처 추적용이며 구매 공급사가 아니다. 같은
  // 카탈로그의 SamplePCB 문의 견적 채널만 공급사로 노출한다.
  const visibleOffers = partOffersForDisplay(part.offers);
  const suppliers = [...new Set(visibleOffers.map((offer) => offer.supplier))];
  // 집계(재고·최저가)는 실공급사만 — samplepcb 파생/문의 견적 채널을 넣으면 원천과
  // 이중 계산된다.
  const realOffers = visibleOffers.filter((offer) => offer.supplier !== SAMPLEPCB_SUPPLIER);
  const ownCatalogOffers = visibleOffers.filter(
    (offer) =>
      offer.supplier === SAMPLEPCB_SUPPLIER
      && isCatalogInquiryOffer(offer.rawJson),
  );
  const freshnessOffers = realOffers.length === 0 ? ownCatalogOffers : realOffers;
  let minPrice: number | null = null;
  let minPriceCurrency: string | null = null;
  let totalStock = 0;
  let offersFetchedAt: Date | null = null;
  for (const offer of realOffers) {
    totalStock += offer.stock ?? 0;
    if (offersFetchedAt === null || offer.fetchedAt > offersFetchedAt) offersFetchedAt = offer.fetchedAt;
    const first = [...offer.priceBreaks].sort((a, b) => a.qty - b.qty)[0];
    if (first !== undefined) {
      const p = Number(first.price);
      if (Number.isFinite(p) && p > 0 && (minPrice === null || p < minPrice)) {
        minPrice = p;
        minPriceCurrency = first.currency !== '' ? first.currency : (offer.currency ?? null);
      }
    }
  }

  return {
    partId: String(part.id),
    mpn: part.mpn,
    mpnNorm: part.mpnNorm,
    manufacturerName: part.manufacturerName,
    manufacturerNorm: part.manufacturerNorm,
    description: part.description,
    category: part.category,
    partType: partType === '' ? null : partType,
    dielectric: dielectric === '' ? null : dielectric,
    packageCode: part.packageCode,
    packageVariants: pkgVariants,
    lifecycle: part.lifecycle,
    imageUrl: part.imageUrl,
    specVariants: [...specVariants],
    ...si,
    suppliers,
    offerCount: realOffers.length + ownCatalogOffers.length,
    minPrice,
    minPriceCurrency,
    totalStock,
    offersFetchedAt: (
      offersFetchedAt
      ?? freshnessOffers.reduce<Date | null>(
        (latest, offer) => latest === null || offer.fetchedAt > latest ? offer.fetchedAt : latest,
        null,
      )
    )?.toISOString() ?? null,
    hasSpecConflict:
      part.specConflicts !== null &&
      typeof part.specConflicts === 'object' &&
      Object.keys(part.specConflicts).length > 0,
    hasCatalogInquiryOffer: visibleOffers.some((offer) => isCatalogInquiryOffer(offer.rawJson)),
    updatedAt: part.lastSeenAt.toISOString(),
  };
}

export async function indexPartDoc(doc: SpPartDoc): Promise<void> {
  await esClient().index({ index: SP_PARTS_WRITE, id: doc.partId, document: doc });
}

/** 재색인용 벌크 — 실패 항목 수를 반환(0 이면 전량 성공). */
export async function bulkIndexPartDocs(docs: SpPartDoc[]): Promise<number> {
  if (docs.length === 0) return 0;
  const operations = docs.flatMap((doc) => [
    { index: { _index: SP_PARTS_WRITE, _id: doc.partId } },
    doc,
  ]);
  const res = await esClient().bulk({ operations, refresh: false });
  if (!res.errors) return 0;
  return res.items.filter((item) => item.index?.error !== undefined).length;
}

/** 벌크 실행들이 끝난 뒤 쓰기 alias를 한 번만 refresh한다. */
export async function refreshPartsIndex(): Promise<void> {
  await esClient().indices.refresh({ index: SP_PARTS_WRITE });
}
