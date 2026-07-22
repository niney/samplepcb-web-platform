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

  // 오퍼 요약 — 대표 단가는 각 오퍼의 최소수량 구간 단가 중 최저(통화 병기).
  // 집계(재고·건수·최저가)는 실공급사만 — samplepcb 파생 오퍼를 넣으면 원천과
  // 이중 계산된다. 패싯(suppliers)에는 samplepcb 포함(검색 필터 가치).
  const suppliers = [...new Set(part.offers.map((o) => o.supplier))];
  const realOffers = part.offers.filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER);
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
    packageCode: part.packageCode,
    packageVariants: pkgVariants,
    lifecycle: part.lifecycle,
    imageUrl: part.imageUrl,
    specVariants: [...specVariants],
    ...si,
    suppliers,
    offerCount: realOffers.length,
    minPrice,
    minPriceCurrency,
    totalStock,
    offersFetchedAt: offersFetchedAt?.toISOString() ?? null,
    hasSpecConflict:
      part.specConflicts !== null &&
      typeof part.specConflicts === 'object' &&
      Object.keys(part.specConflicts).length > 0,
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
  // 완료 상태를 브라우저에 공개하는 즉시 검색 결과에도 보여야 하므로 refresh를 기다린다.
  const res = await esClient().bulk({ operations, refresh: 'wait_for' });
  if (!res.errors) return 0;
  return res.items.filter((item) => item.index?.error !== undefined).length;
}
