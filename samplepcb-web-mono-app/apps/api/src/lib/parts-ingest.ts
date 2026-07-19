import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { normalizeMpn, normalizePackageCode } from '@sp/utils';
import { prisma } from './prisma';
import { resolveManufacturer } from './manufacturer-alias';
import { buildPartDoc, indexPartDoc, type PartWithOffers } from './parts-es';
import {
  SAMPLEPCB_POLICY_VERSION,
  SAMPLEPCB_SUPPLIER,
  deriveSamplepcbOffer,
  resolvePartFacts,
  type FactsSource,
} from './parts-facts';

// BOM 공급사 검색 결과(sp-engine envelope) → 부품 카탈로그 자동 인제스트.
// 전 경로 idempotent: part=(mpnNorm,manufacturerNorm) · offer=(partId,supplier,sku) upsert,
// price break 는 fetch 단위 replace-all. DB 성공 후 ES 색인 — 실패는 큐 적재(드레인이 재시도).
// VERIFIED 등 매칭 상태는 BOM 문맥이므로 저장하지 않는다(카탈로그=사실 데이터).
//
// 부품 정본(스펙·설명)과 자체(samplepcb) 오퍼는 "전체 실공급사 오퍼"의 함수(parts-facts)로,
// 오퍼 upsert 뒤 항상 applyPartFacts 가 재계산한다 — 영속은 캐시, 소유권은 함수.

// ── 엔진 페이로드 계약(느슨한 재검증 — 원본 pydantic 이 진실원본, 여긴 방어선) ──
const EnginePriceBreak = z.object({
  quantity: z.number().int(),
  unit_price: z.number(),
  currency: z.string().default(''),
});

const EngineOffer = z
  .object({
    supplier: z.string(),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nullish(),
    moq: z.number().int().nullish(),
    order_multiple: z.number().int().nullish(),
    price_breaks: z.array(EnginePriceBreak).default([]),
    lead_time: z.string().nullish(),
    product_url: z.string().nullish(),
    fetched_at: z.string(),
  })
  .passthrough();

const EngineProduct = z
  .object({
    supplier: z.string(),
    manufacturer_part_number: z.string(),
    manufacturer: z.string().nullish(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    package: z.string().nullish(),
    lifecycle_status: z.string().nullish(),
    datasheet_url: z.string().nullish(),
    normalized_specs: z.record(z.string(), z.unknown()).default({}),
    offers: z.array(EngineOffer).default([]),
  })
  .passthrough();

const EngineEnvelope = z
  .object({
    search: z
      .object({
        components: z
          .array(
            z
              .object({
                candidates: z.array(z.object({ product: EngineProduct }).passthrough()).default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

type EngineProductT = z.infer<typeof EngineProduct>;
type EngineOfferT = z.infer<typeof EngineOffer>;

export interface IngestStats {
  parts: number;
  offers: number;
  indexed: number;
  queued: number;
}

interface ProductGroup {
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
  products: EngineProductT[];
}

function groupProducts(products: EngineProductT[]): ProductGroup[] {
  const byKey = new Map<string, ProductGroup>();
  for (const p of products) {
    const mpn = p.manufacturer_part_number.trim();
    const mpnNorm = normalizeMpn(mpn);
    if (mpnNorm === '') continue;
    const mfr = resolveManufacturer(p.manufacturer);
    const key = `${mpnNorm}:${mfr.norm}`;
    const group = byKey.get(key);
    if (group === undefined) {
      byKey.set(key, { mpn, mpnNorm, manufacturerName: mfr.name, manufacturerNorm: mfr.norm, products: [p] });
    } else {
      group.products.push(p);
    }
  }
  return [...byKey.values()];
}

/** 오퍼 병합: (supplier, sku) 당 최신 fetched_at 1건. */
function mergeOffers(group: ProductGroup): { offer: EngineOfferT; raw: EngineProductT }[] {
  const byKey = new Map<string, { offer: EngineOfferT; raw: EngineProductT }>();
  for (const p of group.products) {
    for (const offer of p.offers) {
      const key = `${offer.supplier}:${offer.supplier_sku ?? ''}`;
      const prev = byKey.get(key);
      if (prev === undefined || prev.offer.fetched_at < offer.fetched_at) byKey.set(key, { offer, raw: p });
    }
  }
  return [...byKey.values()];
}

async function upsertGroup(group: ProductGroup): Promise<{ partId: bigint; offers: number }> {
  const now = new Date();

  // 정본 필드(스펙·설명 등)는 여기서 채우지 않는다 — 오퍼 upsert 뒤 applyPartFacts 가
  // "전체 오퍼" 기준으로 계산한다(이번 봉투만 보던 병합의 시간축 유실 방지).
  const part = await prisma.spPart.upsert({
    where: { mpnNorm_manufacturerNorm: { mpnNorm: group.mpnNorm, manufacturerNorm: group.manufacturerNorm } },
    create: {
      mpn: group.mpn,
      mpnNorm: group.mpnNorm,
      manufacturerNorm: group.manufacturerNorm,
      manufacturerName: group.manufacturerName,
      specsJson: {},
      specsSi: {},
      lastSeenAt: now,
    },
    update: { manufacturerName: group.manufacturerName, lastSeenAt: now },
    select: { id: true },
  });

  const merged = mergeOffers(group);
  for (const { offer, raw } of merged) {
    const sku = (offer.supplier_sku ?? '').slice(0, 191);
    const fetchedAt = new Date(offer.fetched_at);
    const offerData = {
      productUrl: offer.product_url?.slice(0, 1000) ?? null,
      stock: offer.stock ?? null,
      moq: offer.moq ?? null,
      orderMultiple: offer.order_multiple ?? null,
      packaging: offer.packaging?.slice(0, 64) ?? null,
      currency: offer.price_breaks[0]?.currency.slice(0, 8) ?? null,
      leadTime: offer.lead_time?.slice(0, 64) ?? null,
      rawJson: raw as unknown as Prisma.InputJsonValue,
      fetchedAt,
    };
    // 오퍼 upsert + price break replace-all — 오퍼 단위 트랜잭션
    await prisma.$transaction(async (tx) => {
      const unique = {
        partId_supplier_supplierSku: {
          partId: part.id,
          supplier: offer.supplier,
          supplierSku: sku,
        },
      };
      const existing = await tx.spPartOffer.findUnique({
        where: unique,
        select: { fetchedAt: true },
      });
      // 늦게 도착한 과거 검색 결과가 최신 재고·가격구간을 되돌리지 않게 한다.
      if (existing !== null && existing.fetchedAt > fetchedAt) return;
      const row = await tx.spPartOffer.upsert({
        where: unique,
        create: { partId: part.id, supplier: offer.supplier, supplierSku: sku, ...offerData },
        update: offerData,
        select: { id: true },
      });
      await tx.spPartPriceBreak.deleteMany({ where: { offerId: row.id } });
      if (offer.price_breaks.length > 0) {
        await tx.spPartPriceBreak.createMany({
          data: offer.price_breaks.map((pb) => ({
            offerId: row.id,
            qty: pb.quantity,
            price: pb.unit_price,
            currency: pb.currency.slice(0, 8),
          })),
        });
      }
    });
  }

  await applyPartFacts(part.id);
  return { partId: part.id, offers: merged.length };
}

// rawJson(공급사 원본 product) 중 정본 계산에 쓰는 필드만 — 느슨한 재검증
const RawProductFacts = z
  .object({
    normalized_specs: z.record(z.string(), z.unknown()).default({}),
    description: z.string().nullish(),
    category: z.string().nullish(),
    package: z.string().nullish(),
    lifecycle_status: z.string().nullish(),
    datasheet_url: z.string().nullish(),
  })
  .passthrough();

/**
 * 부품 정본(스펙·설명·specConflicts) + 자체(samplepcb) 오퍼 재계산 — 전체 실공급사
 * 오퍼 기준. 인제스트·수동 갱신·백필 모든 경로의 종착점(idempotent).
 */
export async function applyPartFacts(partId: bigint): Promise<void> {
  const part = await loadPartWithOffers(partId);
  if (part === null) return;
  const real = part.offers.filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER);
  if (real.length === 0) return; // 원천 없음 — 기존 정본을 비우지 않는다(방어)

  const sources: FactsSource[] = real.map((o) => {
    const raw = RawProductFacts.safeParse(o.rawJson);
    const d = raw.success ? raw.data : undefined;
    return {
      supplier: o.supplier,
      fetchedAt: o.fetchedAt,
      specs: d?.normalized_specs ?? {},
      description: d?.description ?? null,
      category: d?.category ?? null,
      packageCode: d?.package ?? null,
      lifecycle: d?.lifecycle_status ?? null,
      datasheetUrl: d?.datasheet_url ?? null,
    };
  });
  const facts = resolvePartFacts(sources);
  const canonPkg = facts.packageCode === null ? null : normalizePackageCode(facts.packageCode);
  const packageCode = (canonPkg?.[0] ?? facts.packageCode?.toUpperCase() ?? null)?.slice(0, 32) ?? null;
  const hasConflicts = Object.keys(facts.specConflicts).length > 0;

  await prisma.spPart.update({
    where: { id: partId },
    data: {
      description: facts.description,
      category: facts.category,
      packageCode,
      lifecycle: facts.lifecycle,
      datasheetUrl: facts.datasheetUrl?.slice(0, 500) ?? null,
      specsJson: facts.specsJson as Prisma.InputJsonValue,
      specsSi: facts.specsSi,
      specConflicts: hasConflicts ? (facts.specConflicts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  // 자체(samplepcb) 오퍼 — 원천 1개에서 통째 복사(공급사 간 브레이크 혼합 금지)
  const chosen = deriveSamplepcbOffer(
    real.map((o) => ({
      supplier: o.supplier,
      supplierSku: o.supplierSku,
      productUrl: o.productUrl,
      stock: o.stock,
      moq: o.moq,
      orderMultiple: o.orderMultiple,
      packaging: o.packaging,
      currency: o.currency,
      leadTime: o.leadTime,
      fetchedAt: o.fetchedAt,
      priceBreaks: o.priceBreaks.map((pb) => ({ qty: pb.qty, price: Number(pb.price), currency: pb.currency })),
    })),
  );

  if (chosen === null) {
    await prisma.spPartOffer.deleteMany({ where: { partId, supplier: SAMPLEPCB_SUPPLIER } });
    return;
  }
  const sku = part.mpnNorm.slice(0, 191);
  const offerData = {
    productUrl: null, // 자체 오퍼 — 외부 상품 링크는 derivedFrom 으로만 추적
    stock: chosen.stock,
    moq: chosen.moq,
    orderMultiple: chosen.orderMultiple,
    packaging: chosen.packaging,
    currency: chosen.currency,
    leadTime: chosen.leadTime,
    rawJson: {
      derivedFrom: {
        supplier: chosen.supplier,
        supplierSku: chosen.supplierSku,
        fetchedAt: chosen.fetchedAt.toISOString(),
      },
      policyVersion: SAMPLEPCB_POLICY_VERSION,
    } as Prisma.InputJsonValue,
    fetchedAt: chosen.fetchedAt, // 데이터 나이 표시의 정직성 — 원천 시각 그대로
  };
  await prisma.$transaction(async (tx) => {
    // sku 정책 변경 등으로 남은 과거 파생 행 정리
    await tx.spPartOffer.deleteMany({
      where: { partId, supplier: SAMPLEPCB_SUPPLIER, NOT: { supplierSku: sku } },
    });
    const row = await tx.spPartOffer.upsert({
      where: { partId_supplier_supplierSku: { partId, supplier: SAMPLEPCB_SUPPLIER, supplierSku: sku } },
      create: { partId, supplier: SAMPLEPCB_SUPPLIER, supplierSku: sku, ...offerData },
      update: offerData,
      select: { id: true },
    });
    await tx.spPartPriceBreak.deleteMany({ where: { offerId: row.id } });
    if (chosen.priceBreaks.length > 0) {
      await tx.spPartPriceBreak.createMany({
        data: chosen.priceBreaks.map((pb) => ({ offerId: row.id, qty: pb.qty, price: pb.price, currency: pb.currency })),
      });
    }
  });
}

async function loadPartWithOffers(partId: bigint): Promise<PartWithOffers | null> {
  return prisma.spPart.findUnique({
    where: { id: partId },
    include: { offers: { include: { priceBreaks: true } } },
  });
}

export async function tryIndexPart(partId: bigint): Promise<boolean> {
  const part = await loadPartWithOffers(partId);
  if (part === null) return false;
  try {
    await indexPartDoc(buildPartDoc(part));
    await prisma.spPart.update({ where: { id: partId }, data: { indexedAt: new Date() } });
    return true;
  } catch (error) {
    await prisma.spPartIndexQueue.create({
      data: { partId, reason: String(error).slice(0, 191) },
    });
    return false;
  }
}

/** 공급사 검색 결과(envelope) 인제스트 — 파싱 실패는 조용히 0 통계(로그는 호출부). */
export async function ingestSupplierSearchResult(envelope: unknown): Promise<IngestStats> {
  const stats: IngestStats = { parts: 0, offers: 0, indexed: 0, queued: 0 };
  const parsed = EngineEnvelope.safeParse(envelope);
  if (!parsed.success) return stats;

  const products = parsed.data.search.components.flatMap((c) => c.candidates.map((cand) => cand.product));
  for (const group of groupProducts(products)) {
    const { partId, offers } = await upsertGroup(group);
    stats.parts += 1;
    stats.offers += offers;
    if (await tryIndexPart(partId)) stats.indexed += 1;
    else stats.queued += 1;
  }
  return stats;
}

/** 색인 실패 큐 드레인 — 기동 시·주기 호출. 성공 시 해당 partId 큐 행 제거. */
export async function drainIndexQueue(limit = 200): Promise<{ drained: number; remaining: number }> {
  const rows = await prisma.spPartIndexQueue.findMany({
    orderBy: { queuedAt: 'asc' },
    take: limit,
  });
  const partIds = [...new Set(rows.map((r) => r.partId))];
  let drained = 0;
  for (const partId of partIds) {
    const part = await loadPartWithOffers(partId);
    if (part === null) {
      await prisma.spPartIndexQueue.deleteMany({ where: { partId } });
      continue;
    }
    try {
      await indexPartDoc(buildPartDoc(part));
      await prisma.spPart.update({ where: { id: partId }, data: { indexedAt: new Date() } });
      await prisma.spPartIndexQueue.deleteMany({ where: { partId } });
      drained += 1;
    } catch {
      await prisma.spPartIndexQueue.updateMany({
        where: { partId },
        data: { attempts: { increment: 1 } },
      });
    }
  }
  const remaining = await prisma.spPartIndexQueue.count();
  return { drained, remaining };
}
