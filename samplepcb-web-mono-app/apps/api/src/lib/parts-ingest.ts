import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { normalizeMpn, normalizePackageCode } from '@sp/utils';
import { prisma } from './prisma';
import { resolveManufacturer } from './manufacturer-alias';
import { bulkIndexPartDocs, buildPartDoc, indexPartDoc, type PartWithOffers } from './parts-es';
import {
  SAMPLEPCB_POLICY_VERSION,
  SAMPLEPCB_SUPPLIER,
  deriveSamplepcbOffer,
  resolvePartFacts,
  type FactsSource,
} from './parts-facts';
import { normalizeSupplierPackaging } from './supplier-packaging';

// BOM 공급사 검색 결과(sp-engine envelope) → 부품 카탈로그 자동 인제스트.
// 전 경로 idempotent: part=(mpnNorm,manufacturerNorm) · offer=(partId,supplier,sku) upsert.
// 동일/stale 오퍼는 no-op, 내용이 바뀐 가격구간만 replace-all. 변경 부품은 DB 커밋 뒤 ES bulk
// 색인하며 실패·색인 중 재변경은 큐에 적재한다(드레인이 최신 DB 상태로 재시도).
// VERIFIED 등 매칭 상태는 BOM 문맥이므로 저장하지 않는다(카탈로그=사실 데이터).
//
// 부품 정본(스펙·설명)과 자체(samplepcb) 오퍼는 "전체 실공급사 오퍼"의 함수(parts-facts)로,
// facts fingerprint가 바뀐 경우만 applyPartFacts가 재계산한다 — 영속은 캐시, 소유권은 함수.

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
    image_url: z.string().nullish(),
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
  skippedParts: number;
  skippedOffers: number;
}

export interface IngestTiming {
  dbElapsedMs: number;
  indexElapsedMs: number;
  elapsedMs: number;
}

export interface CatalogIngestResult {
  runId: string | null;
  fingerprint: string | null;
  reused: boolean;
  stats: IngestStats;
  timing: IngestTiming;
}

export const PART_INGEST_POLICY_VERSION = 'part-ingest-v2';
const PART_FACTS_FINGERPRINT_VERSION = `part-facts-v2:${String(SAMPLEPCB_POLICY_VERSION)}`;
const PART_INDEX_FINGERPRINT_VERSION = 'sp-parts-doc-v1';
const INGEST_LEASE_MS = 30 * 60 * 1_000;
const INGEST_WAIT_MS = 500;
const INGEST_WAIT_MAX_MS = 35 * 60 * 1_000;
const INDEX_BATCH_SIZE = 200;
const DB_WRITE_CONCURRENCY = 4;
const DEADLOCK_MAX_ATTEMPTS = 8;
const DEADLOCK_BASE_DELAY_MS = 50;

const completedIngests = new Map<string, Promise<CatalogIngestResult>>();

function emptyStats(): IngestStats {
  return { parts: 0, offers: 0, indexed: 0, queued: 0, skippedParts: 0, skippedOffers: 0 };
}

function emptyTiming(): IngestTiming {
  return { dbElapsedMs: 0, indexElapsedMs: 0, elapsedMs: 0 };
}

function canonicalize(value: unknown, omittedKeys: ReadonlySet<string> = new Set()): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, omittedKeys));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => !omittedKeys.has(key))
        .sort()
        .map((key) => [key, canonicalize(record[key], omittedKeys)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** MySQL Prisma upsert의 read→create 경합(P2002)은 승자가 만든 행을 재조회해 수렴한다. */
async function upsertWithRaceRecovery<T>(
  upsert: () => Promise<T>,
  findAfterUniqueConflict: () => Promise<T | null>,
): Promise<T> {
  let lastError: unknown = new Error('upsert retry exhausted');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await upsert();
    } catch (error) {
      lastError = error;
      if (isPrismaErrorCode(error, 'P2002')) {
        const winner = await findAfterUniqueConflict();
        if (winner !== null) return winner;
      } else if (!isPrismaErrorCode(error, 'P2034')) {
        throw error;
      }
      if (attempt < 3) await wait(25 * (2 ** attempt) + Math.floor(Math.random() * 25));
    }
  }
  throw lastError;
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

function parsedGroups(envelope: unknown): ProductGroup[] | null {
  const parsed = EngineEnvelope.safeParse(envelope);
  if (!parsed.success) return null;
  const products = parsed.data.search.components.flatMap((component) =>
    component.candidates.map((candidate) => candidate.product),
  );
  return groupProducts(products);
}

/**
 * 파일·견적 ID가 아니라 카탈로그에 실제로 쓰이는 공급사 product/offer와 정책으로 만든다.
 * 후보 순서는 의미가 없으므로 정렬하고, fetched_at은 신선도 판정에 필요해 보존한다.
 */
export function supplierSearchIngestFingerprint(envelope: unknown): string | null {
  const groups = parsedGroups(envelope);
  if (groups === null) return null;
  const payload = groups
    .map((group) => ({
      mpnNorm: group.mpnNorm,
      manufacturerNorm: group.manufacturerNorm,
      offers: mergeOffers(group)
        .map(({ offer, raw }) => ({ offer, product: raw }))
        .sort((a, b) => {
          const aKey = `${a.offer.supplier}:${a.offer.supplier_sku ?? ''}:${a.offer.fetched_at}`;
          const bKey = `${b.offer.supplier}:${b.offer.supplier_sku ?? ''}:${b.offer.fetched_at}`;
          return aKey.localeCompare(bKey);
        }),
    }))
    .sort((a, b) => `${a.mpnNorm}:${a.manufacturerNorm}`.localeCompare(`${b.mpnNorm}:${b.manufacturerNorm}`));
  return fingerprint({
    policyVersion: PART_INGEST_POLICY_VERSION,
    factsPolicyVersion: PART_FACTS_FINGERPRINT_VERSION,
    indexPolicyVersion: PART_INDEX_FINGERPRINT_VERSION,
    payload,
  });
}

function offerContentFingerprint(raw: EngineProductT, offer: EngineOfferT): string {
  const priceBreaks = [...offer.price_breaks].sort(
    (a, b) => a.quantity - b.quantity || a.currency.localeCompare(b.currency) || a.unit_price - b.unit_price,
  );
  return fingerprint({
    policyVersion: PART_INGEST_POLICY_VERSION,
    // 공급사 응답의 수집 시각만 달라진 경우 가격구간 replace-all과 facts 재계산을 피한다.
    product: canonicalize(raw, new Set(['fetched_at'])),
    offer: canonicalize({ ...offer, price_breaks: priceBreaks }, new Set(['fetched_at'])),
  });
}

interface GroupUpsertResult {
  partId: bigint;
  offers: number;
  skippedOffers: number;
  changed: boolean;
}

async function upsertGroup(group: ProductGroup): Promise<GroupUpsertResult> {
  const merged = mergeOffers(group).filter(({ offer }) => Number.isFinite(new Date(offer.fetched_at).getTime()));
  if (merged.length === 0) return { partId: 0n, offers: 0, skippedOffers: 0, changed: false };

  // 정본 필드(스펙·설명 등)는 여기서 채우지 않는다. 같은 part의 병렬 인제스트는
  // 아래 FOR UPDATE 한 구역으로 직렬화해 stale 결과가 최신 오퍼를 되돌릴 수 없게 한다.
  const observedAt = new Date();
  const identity = { mpnNorm: group.mpnNorm, manufacturerNorm: group.manufacturerNorm };
  const part = await upsertWithRaceRecovery(
    () => prisma.spPart.upsert({
      where: { mpnNorm_manufacturerNorm: identity },
      create: {
        mpn: group.mpn,
        ...identity,
        manufacturerName: group.manufacturerName,
        specsJson: {},
        specsSi: {},
        lastSeenAt: observedAt,
      },
      update: {},
      select: { id: true },
    }),
    () => prisma.spPart.findUnique({
      where: { mpnNorm_manufacturerNorm: identity },
      select: { id: true },
    }),
  );

  const transact = async (): Promise<GroupUpsertResult> => prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM sp_part WHERE id = ${part.id} FOR UPDATE`;
      const currentPart = await tx.spPart.findUniqueOrThrow({
        where: { id: part.id },
        select: { factsFingerprint: true },
      });
      let offers = 0;
      let skippedOffers = 0;
      let changed = false;

      for (const { offer, raw } of merged) {
        const sku = (offer.supplier_sku ?? '').slice(0, 191);
        const fetchedAt = new Date(offer.fetched_at);
        const contentFingerprint = offerContentFingerprint(raw, offer);
        const unique = {
          partId_supplier_supplierSku: {
            partId: part.id,
            supplier: offer.supplier,
            supplierSku: sku,
          },
        };
        const existing = await tx.spPartOffer.findUnique({
          where: unique,
          select: { id: true, fetchedAt: true, contentFingerprint: true },
        });

        // 늦게 도착한 과거 결과와 완전히 같은 재생 결과는 쓰기 자체를 생략한다.
        if (existing !== null && existing.fetchedAt > fetchedAt) {
          skippedOffers += 1;
          continue;
        }
        if (
          existing !== null &&
          existing.fetchedAt.getTime() === fetchedAt.getTime() &&
          existing.contentFingerprint === contentFingerprint
        ) {
          skippedOffers += 1;
          continue;
        }

        const offerData = {
          productUrl: offer.product_url?.slice(0, 1000) ?? null,
          stock: offer.stock ?? null,
          moq: offer.moq ?? null,
          orderMultiple: offer.order_multiple ?? null,
          packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging)?.slice(0, 64) ?? null,
          currency: offer.price_breaks[0]?.currency.slice(0, 8) ?? null,
          leadTime: offer.lead_time?.slice(0, 64) ?? null,
          rawJson: raw as unknown as Prisma.InputJsonValue,
          fetchedAt,
          contentFingerprint,
        };
        const row = await tx.spPartOffer.upsert({
          where: unique,
          create: { partId: part.id, supplier: offer.supplier, supplierSku: sku, ...offerData },
          update: offerData,
          select: { id: true },
        });
        offers += 1;
        changed = true;

        // 수집 시각만 새로워지고 내용 fingerprint가 같으면 가격구간은 이미 동일하다.
        if (existing?.contentFingerprint === contentFingerprint) continue;
        await tx.spPartPriceBreak.deleteMany({ where: { offerId: row.id } });
        if (offer.price_breaks.length > 0) {
          await tx.spPartPriceBreak.createMany({
            data: offer.price_breaks.map((priceBreak) => ({
              offerId: row.id,
              qty: priceBreak.quantity,
              price: priceBreak.unit_price,
              currency: priceBreak.currency.slice(0, 8),
            })),
          });
        }
      }

      if (changed) {
        await tx.spPart.update({
          where: { id: part.id },
          data: {
            mpn: group.mpn,
            manufacturerName: group.manufacturerName,
            lastSeenAt: observedAt,
          },
        });
      }

      if (changed || currentPart.factsFingerprint === null) {
        changed = (await applyPartFactsInTx(tx, part.id)) || changed;
      }
      return { partId: part.id, offers, skippedOffers, changed };
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
  for (let attempt = 0; attempt < DEADLOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await transact();
    } catch (error) {
      const retryable = isPrismaErrorCode(error, 'P2034');
      if (!retryable || attempt === DEADLOCK_MAX_ATTEMPTS - 1) throw error;
      const backoffMs = DEADLOCK_BASE_DELAY_MS * (2 ** attempt);
      await wait(backoffMs + Math.floor(Math.random() * DEADLOCK_BASE_DELAY_MS));
    }
  }
  throw new Error('unreachable part ingest retry state');
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
    image_url: z.string().nullish(),
  })
  .passthrough();

/**
 * 부품 정본(스펙·설명·specConflicts) + 자체(samplepcb) 오퍼 재계산 — 전체 실공급사
 * 오퍼 기준. 인제스트·수동 갱신·백필 모든 경로의 종착점(idempotent).
 */
async function applyPartFactsInTx(tx: Prisma.TransactionClient, partId: bigint): Promise<boolean> {
  const part = await tx.spPart.findUnique({
    where: { id: partId },
    include: { offers: { include: { priceBreaks: true } } },
  });
  if (part === null) return false;
  const real = part.offers.filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER);
  if (real.length === 0) return false; // 원천 없음 — 기존 정본을 비우지 않는다(방어)

  const factsFingerprint = fingerprint({
    policyVersion: PART_FACTS_FINGERPRINT_VERSION,
    offers: real
      .map((offer) => ({
        supplier: offer.supplier,
        supplierSku: offer.supplierSku,
        productUrl: offer.productUrl,
        stock: offer.stock,
        moq: offer.moq,
        orderMultiple: offer.orderMultiple,
        packaging: offer.packaging,
        currency: offer.currency,
        leadTime: offer.leadTime,
        fetchedAt: offer.fetchedAt,
        rawJson: offer.rawJson,
        priceBreaks: offer.priceBreaks
          .map((priceBreak) => ({
            qty: priceBreak.qty,
            price: Number(priceBreak.price),
            currency: priceBreak.currency,
          }))
          .sort((a, b) => a.qty - b.qty || a.currency.localeCompare(b.currency) || a.price - b.price),
      }))
      .sort((a, b) => `${a.supplier}:${a.supplierSku}`.localeCompare(`${b.supplier}:${b.supplierSku}`)),
  });
  if (part.factsFingerprint === factsFingerprint) return false;

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
      imageUrl: d?.image_url ?? null,
    };
  });
  const facts = resolvePartFacts(sources);
  const canonPkg = facts.packageCode === null ? null : normalizePackageCode(facts.packageCode);
  const packageCode = (canonPkg?.[0] ?? facts.packageCode?.toUpperCase() ?? null)?.slice(0, 32) ?? null;
  const hasConflicts = Object.keys(facts.specConflicts).length > 0;

  await tx.spPart.update({
    where: { id: partId },
    data: {
      description: facts.description,
      category: facts.category,
      packageCode,
      lifecycle: facts.lifecycle,
      datasheetUrl: facts.datasheetUrl?.slice(0, 500) ?? null,
      imageUrl: facts.imageUrl?.slice(0, 500) ?? null,
      specsJson: facts.specsJson as Prisma.InputJsonValue,
      specsSi: facts.specsSi,
      specConflicts: hasConflicts ? (facts.specConflicts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      factsFingerprint,
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
    await tx.spPartOffer.deleteMany({ where: { partId, supplier: SAMPLEPCB_SUPPLIER } });
    return true;
  }
  const sku = part.mpnNorm.slice(0, 191);
  const offerData = {
    productUrl: null, // 자체 오퍼 — 외부 상품 링크는 derivedFrom 으로만 추적
    stock: chosen.stock,
    moq: chosen.moq,
    orderMultiple: chosen.orderMultiple,
    packaging: normalizeSupplierPackaging(chosen.supplier, chosen.packaging),
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
    contentFingerprint: factsFingerprint,
  };
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
      data: chosen.priceBreaks.map((priceBreak) => ({
        offerId: row.id,
        qty: priceBreak.qty,
        price: priceBreak.price,
        currency: priceBreak.currency,
      })),
    });
  }
  return true;
}

export async function applyPartFacts(partId: bigint): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM sp_part WHERE id = ${partId} FOR UPDATE`;
      await applyPartFactsInTx(tx, partId);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

async function loadPartWithOffers(partId: bigint): Promise<PartWithOffers | null> {
  return prisma.spPart.findUnique({
    where: { id: partId },
    include: { offers: { include: { priceBreaks: true } } },
  });
}

export async function tryIndexPart(partId: bigint, options: { force?: boolean } = {}): Promise<boolean> {
  const part = await loadPartWithOffers(partId);
  if (part === null) return false;
  const doc = buildPartDoc(part);
  const indexFingerprint = fingerprint({ policyVersion: PART_INDEX_FINGERPRINT_VERSION, doc });
  if (options.force !== true && part.indexFingerprint === indexFingerprint && part.indexedAt !== null) return true;
  try {
    await indexPartDoc(doc);
    const updated = await prisma.spPart.updateMany({
      where: { id: partId, factsFingerprint: part.factsFingerprint },
      data: { indexedAt: new Date(), indexFingerprint },
    });
    if (updated.count === 1) return true;
    await queuePartIndex(partId, 'part changed during Elasticsearch indexing');
    return false;
  } catch (error) {
    await queuePartIndex(partId, String(error));
    return false;
  }
}

async function queuePartIndex(partId: bigint, reason: string): Promise<void> {
  const queued = await prisma.spPartIndexQueue.findFirst({ where: { partId }, select: { id: true } });
  if (queued !== null) return;
  await prisma.spPartIndexQueue.create({ data: { partId, reason: reason.slice(0, 191) } });
}

async function indexChangedParts(partIds: bigint[]): Promise<Pick<IngestStats, 'indexed' | 'queued'>> {
  let indexed = 0;
  let queued = 0;
  const uniquePartIds = [...new Set(partIds)];
  for (let offset = 0; offset < uniquePartIds.length; offset += INDEX_BATCH_SIZE) {
    const batchIds = uniquePartIds.slice(offset, offset + INDEX_BATCH_SIZE);
    const parts = await prisma.spPart.findMany({
      where: { id: { in: batchIds } },
      include: { offers: { include: { priceBreaks: true } } },
    });
    const pending = parts.flatMap((part) => {
      const doc = buildPartDoc(part);
      const indexFingerprint = fingerprint({ policyVersion: PART_INDEX_FINGERPRINT_VERSION, doc });
      if (part.indexFingerprint === indexFingerprint && part.indexedAt !== null) return [];
      return [{ partId: part.id, factsFingerprint: part.factsFingerprint, indexFingerprint, doc }];
    });
    if (pending.length === 0) continue;

    try {
      const failures = await bulkIndexPartDocs(pending.map((item) => item.doc));
      if (failures > 0) throw new Error(`Elasticsearch bulk indexing failed for ${String(failures)} item(s)`);
      for (const item of pending) {
        const updated = await prisma.spPart.updateMany({
          where: { id: item.partId, factsFingerprint: item.factsFingerprint },
          data: { indexedAt: new Date(), indexFingerprint: item.indexFingerprint },
        });
        if (updated.count === 1) {
          indexed += 1;
        } else {
          await queuePartIndex(item.partId, 'part changed during Elasticsearch bulk indexing');
          queued += 1;
        }
      }
    } catch (error) {
      for (const item of pending) await queuePartIndex(item.partId, String(error));
      queued += pending.length;
    }
  }
  return { indexed, queued };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 공급사 검색 결과(envelope) 인제스트 — 파싱 실패는 조용히 0 통계(로그는 호출부). */
async function ingestSupplierSearchResultWithTiming(
  envelope: unknown,
): Promise<{ stats: IngestStats; timing: IngestTiming }> {
  const startedAt = performance.now();
  const stats = emptyStats();
  const groups = parsedGroups(envelope);
  if (groups === null) return { stats, timing: emptyTiming() };

  const dbStartedAt = performance.now();
  const results = await mapConcurrent(groups, DB_WRITE_CONCURRENCY, upsertGroup);
  const changedPartIds: bigint[] = [];
  for (const result of results) {
    if (result.partId === 0n) continue;
    stats.offers += result.offers;
    stats.skippedOffers += result.skippedOffers;
    if (result.changed) {
      stats.parts += 1;
      changedPartIds.push(result.partId);
    } else {
      stats.skippedParts += 1;
    }
  }
  const dbElapsedMs = elapsedMs(dbStartedAt);

  const indexStartedAt = performance.now();
  const indexStats = await indexChangedParts(changedPartIds);
  stats.indexed = indexStats.indexed;
  stats.queued = indexStats.queued;
  const indexElapsedMs = elapsedMs(indexStartedAt);
  return { stats, timing: { dbElapsedMs, indexElapsedMs, elapsedMs: elapsedMs(startedAt) } };
}

export async function ingestSupplierSearchResult(envelope: unknown): Promise<IngestStats> {
  return (await ingestSupplierSearchResultWithTiming(envelope)).stats;
}

function storedStats(value: Prisma.JsonValue | null): IngestStats {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyStats();
  const record = value as Record<string, Prisma.JsonValue>;
  const number = (key: keyof IngestStats): number =>
    typeof record[key] === 'number' ? Math.max(0, Math.round(record[key])) : 0;
  return {
    parts: number('parts'),
    offers: number('offers'),
    indexed: number('indexed'),
    queued: number('queued'),
    skippedParts: number('skippedParts'),
    skippedOffers: number('skippedOffers'),
  };
}

function storedTiming(value: Prisma.JsonValue | null): IngestTiming {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyTiming();
  const record = value as Record<string, Prisma.JsonValue>;
  const number = (key: keyof IngestTiming): number =>
    typeof record[key] === 'number' ? Math.max(0, Math.round(record[key])) : 0;
  return { dbElapsedMs: number('dbElapsedMs'), indexElapsedMs: number('indexElapsedMs'), elapsedMs: number('elapsedMs') };
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 동일한 공급사 결과는 영속 fingerprint 원장을 통해 프로세스·서버 재시작을 넘어 한 번만
 * 인제스트한다. 다른 프로세스가 실행 중이면 그 결과를 기다렸다가 같은 통계를 재사용한다.
 */
export async function ingestSupplierSearchResultOnce(
  envelope: unknown,
  sourceJobId?: string,
): Promise<CatalogIngestResult> {
  const ingestFingerprint = supplierSearchIngestFingerprint(envelope);
  if (ingestFingerprint === null) {
    return { runId: null, fingerprint: null, reused: false, stats: emptyStats(), timing: emptyTiming() };
  }
  const existing = completedIngests.get(ingestFingerprint);
  if (existing !== undefined) return existing;

  const run = (async (): Promise<CatalogIngestResult> => {
    const row = await upsertWithRaceRecovery(
      () => prisma.spPartIngestRun.upsert({
        where: { fingerprint: ingestFingerprint },
        create: {
          fingerprint: ingestFingerprint,
          policyVersion: PART_INGEST_POLICY_VERSION,
          ...(sourceJobId === undefined ? {} : { sourceJobId: sourceJobId.slice(0, 64) }),
        },
        update: {},
        select: { id: true },
      }),
      () => prisma.spPartIngestRun.findUnique({
        where: { fingerprint: ingestFingerprint },
        select: { id: true },
      }),
    );
    const waitStartedAt = Date.now();
    while (Date.now() - waitStartedAt < INGEST_WAIT_MAX_MS) {
      const current = await prisma.spPartIngestRun.findUniqueOrThrow({ where: { id: row.id } });
      if (current.status === 'completed') {
        return {
          runId: String(current.id),
          fingerprint: ingestFingerprint,
          reused: true,
          stats: storedStats(current.stats),
          timing: storedTiming(current.timing),
        };
      }

      const now = new Date();
      const claimed = await prisma.spPartIngestRun.updateMany({
        where: {
          id: row.id,
          OR: [
            { status: { in: ['queued', 'failed'] } },
            { status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
          ],
        },
        data: {
          status: 'running',
          startedAt: now,
          completedAt: null,
          leaseUntil: new Date(now.getTime() + INGEST_LEASE_MS),
          error: null,
        },
      });
      if (claimed.count === 0) {
        await wait(INGEST_WAIT_MS);
        continue;
      }

      try {
        const result = await ingestSupplierSearchResultWithTiming(envelope);
        await prisma.spPartIngestRun.update({
          where: { id: row.id },
          data: {
            status: 'completed',
            stats: result.stats as unknown as Prisma.InputJsonValue,
            timing: result.timing as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
            leaseUntil: null,
          },
        });
        return {
          runId: String(row.id),
          fingerprint: ingestFingerprint,
          reused: false,
          stats: result.stats,
          timing: result.timing,
        };
      } catch (error) {
        await prisma.spPartIngestRun.update({
          where: { id: row.id },
          data: { status: 'failed', error: String(error).slice(0, 500), leaseUntil: null },
        });
        throw error;
      }
    }
    throw new Error(`catalog ingest wait timeout: ${ingestFingerprint}`);
  })();
  completedIngests.set(ingestFingerprint, run);
  try {
    return await run;
  } finally {
    completedIngests.delete(ingestFingerprint);
  }
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
    if ((await loadPartWithOffers(partId)) === null) {
      await prisma.spPartIndexQueue.deleteMany({ where: { partId } });
      continue;
    }
    // 큐 행은 DB의 indexFingerprint와 무관하게 현재 ES 문서를 신뢰할 수 없다는 신호다.
    // 늦게 도착한 stale bulk가 최신 문서를 덮은 뒤 fingerprint만 최신으로 남은 경우도 강제 복구한다.
    if (await tryIndexPart(partId, { force: true })) {
      await prisma.spPartIndexQueue.deleteMany({ where: { partId } });
      drained += 1;
    } else {
      await prisma.spPartIndexQueue.updateMany({
        where: { partId },
        data: { attempts: { increment: 1 } },
      });
    }
  }
  const remaining = await prisma.spPartIndexQueue.count();
  return { drained, remaining };
}
