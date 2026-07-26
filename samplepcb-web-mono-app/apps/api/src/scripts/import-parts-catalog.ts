import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PartSearchQuery } from '@sp/api-contract';
import { normalizeMpn } from '@sp/utils';
import type { estypes } from '@elastic/elasticsearch';
import { esClient } from '../es/client';
import {
  SP_PARTS_READ,
  SP_PARTS_WRITE,
  bootstrapPartsIndex,
  type SpPartDoc,
} from '../es/sp-parts-index';
import { engineFetch } from '../lib/engine-client';
import { prisma } from '../lib/prisma';
import {
  applyPartFacts,
  ingestSupplierSearchResultOnce,
  supplierSearchIngestFingerprint,
  tryIndexPart,
} from '../lib/parts-ingest';
import { refreshPartsIndex } from '../lib/parts-es';
import {
  catalogOfferRawMatch,
  catalogMigrationSuppliers,
  catalogSearchSamples,
  isCatalogOfferFromSource,
  parseCatalogMigrationEnvelope,
  type CatalogMigrationRecord,
  type ParsedCatalogMigration,
} from '../lib/parts-catalog-migration';
import { partOffersForDisplay } from '../lib/parts-offer-kind';
import { buildYeonhoCatalogEnvelope } from '../lib/yeonho-catalog-workbook';
import { buildWalsinRlcCatalogEnvelope } from '../lib/walsin-rlc-catalog-workbook';
import { buildPartSort, buildSearchQuery } from '../routes/admin-parts';

type Mode = 'dry-run' | 'apply' | 'replace' | 'verify' | 'verify-search' | 'rollback';

interface CliOptions {
  mode: Mode;
  source: CatalogSourceKey;
  file: string;
  manifest: string;
  retireSourceSha: string | undefined;
}

interface CatalogSource {
  /** 워크북 기본 경로(리포 상대) */
  defaultFile: string;
  /** 워크북 → supplier-search ingest envelope */
  build: (file: string) => Promise<{ envelope: unknown; stats: Record<string, unknown> }>;
}

/**
 * 제조사 카탈로그 원본 등록부.
 *
 * 원본마다 워크북 구조와 불변식이 다르므로 파서를 분리하고, CLI는 키로만 고른다.
 * `--source`를 주지 않으면 기존 연호 운영 명령이 그대로 동작한다.
 */
const CATALOG_SOURCES = {
  yeonho: {
    defaultFile:
      'catalog-migrations/yeonho-connectors-2026-07-17/연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
    build: async (file) => {
      const { envelope, stats } = await buildYeonhoCatalogEnvelope(file);
      return { envelope, stats: { ...stats } };
    },
  },
  'walsin-rlc': {
    defaultFile: 'catalog-migrations/walsin/Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
    build: async (file) => {
      const { envelope, stats } = await buildWalsinRlcCatalogEnvelope(file);
      return { envelope, stats: { ...stats } };
    },
  },
} satisfies Record<string, CatalogSource>;

type CatalogSourceKey = keyof typeof CATALOG_SOURCES;

const DEFAULT_SOURCE: CatalogSourceKey = 'yeonho';

function isCatalogSourceKey(value: string): value is CatalogSourceKey {
  return Object.hasOwn(CATALOG_SOURCES, value);
}

type PartWithOffers = Prisma.SpPartGetPayload<{
  include: { offers: { include: { priceBreaks: true } } };
}>;

const PriceBreakSnapshotSchema = z.object({
  qty: z.number().int(),
  price: z.string(),
  currency: z.string(),
});

const OfferSnapshotSchema = z.object({
  supplier: z.string(),
  supplierSku: z.string(),
  productUrl: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  packaging: z.string().nullable(),
  currency: z.string().nullable(),
  leadTime: z.string().nullable(),
  rawJson: z.unknown(),
  fetchedAt: z.string(),
  contentFingerprint: z.string().nullable(),
  priceBreaks: z.array(PriceBreakSnapshotSchema),
});

const PartSnapshotSchema = z.object({
  mpn: z.string(),
  manufacturerName: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycle: z.string().nullable(),
  datasheetUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  specsJson: z.unknown(),
  specsSi: z.unknown(),
  specConflicts: z.unknown().nullable(),
  lastSeenAt: z.string(),
});

const RecordSnapshotSchema = z.object({
  key: z.string(),
  mpnNorm: z.string(),
  manufacturerNorm: z.string(),
  existingPartId: z.string().nullable(),
  part: PartSnapshotSchema.nullable(),
  offers: z.array(OfferSnapshotSchema),
});

const RetirementStateSchema = z.object({
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  candidatePartIds: z.array(z.string().regex(/^\d+$/)),
  completedAt: z.string().nullable(),
});

const MigrationManifestSchema = z.object({
  version: z.literal(1),
  sourceFile: z.string(),
  sourceSha256: z.string(),
  ingestFingerprint: z.string(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
  rolledBackAt: z.string().nullable(),
  runId: z.string().nullable(),
  records: z.array(RecordSnapshotSchema),
  retirement: RetirementStateSchema.optional(),
});

type MigrationManifest = z.infer<typeof MigrationManifestSchema>;
type OfferSnapshot = z.infer<typeof OfferSnapshotSchema>;
type PartSnapshot = z.infer<typeof PartSnapshotSchema>;

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseOptions(args: string[]): CliOptions {
  const modes: [string, Mode][] = [
    ['--dry-run', 'dry-run'],
    ['--apply', 'apply'],
    ['--replace', 'replace'],
    ['--verify', 'verify'],
    ['--verify-search', 'verify-search'],
    ['--rollback', 'rollback'],
  ];
  const selected = modes.filter(([flag]) => args.includes(flag));
  if (selected.length !== 1) {
    throw new Error(
      '실행 모드를 하나만 지정하세요: --dry-run|--apply|--replace|--verify|--verify-search|--rollback',
    );
  }
  const mode = selected[0]?.[1];
  if (mode === undefined) throw new Error('실행 모드가 없습니다');
  const sourceKey = optionValue(args, '--source') ?? DEFAULT_SOURCE;
  if (!isCatalogSourceKey(sourceKey)) {
    throw new Error(`알 수 없는 카탈로그 원본입니다: ${sourceKey} (${Object.keys(CATALOG_SOURCES).join('|')})`);
  }
  const file = path.resolve(
    optionValue(args, '--file') ?? path.resolve(process.cwd(), CATALOG_SOURCES[sourceKey].defaultFile),
  );
  const baseName = path.parse(file).name;
  const manifest = path.resolve(
    optionValue(args, '--manifest')
      ?? path.join(path.dirname(file), `migration-state-${baseName}.json`),
  );
  const retireSourceSha = optionValue(args, '--retire-source-sha')?.toLowerCase();
  if (retireSourceSha !== undefined && !/^[0-9a-f]{64}$/.test(retireSourceSha)) {
    throw new Error('--retire-source-sha는 64자리 SHA-256이어야 합니다');
  }
  if (mode === 'replace' && retireSourceSha === undefined) {
    throw new Error('--replace에는 --retire-source-sha가 필요합니다');
  }
  return { mode, source: sourceKey, file, manifest, retireSourceSha };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? String(item) : item, 2);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadInput(
  file: string,
  source: CatalogSourceKey,
): Promise<{ raw: unknown; parsed: ParsedCatalogMigration; fingerprint: string }> {
  const raw: unknown = path.extname(file).toLowerCase() === '.xlsx'
    ? (await CATALOG_SOURCES[source].build(file)).envelope
    : JSON.parse(await readFile(file, 'utf8'));
  const parsed = parseCatalogMigrationEnvelope(raw);
  const fingerprint = supplierSearchIngestFingerprint(raw);
  if (fingerprint === null) throw new Error('기존 부품 인제스트 계약으로 해석할 수 없는 파일입니다');
  return { raw, parsed, fingerprint };
}

function partKey(part: Pick<PartWithOffers, 'mpnNorm' | 'manufacturerNorm'>): string {
  return `${part.manufacturerNorm}:${part.mpnNorm}`;
}

async function loadExistingParts(records: CatalogMigrationRecord[]): Promise<Map<string, PartWithOffers>> {
  const found = new Map<string, PartWithOffers>();
  for (const batch of chunks(records, 100)) {
    const parts = await prisma.spPart.findMany({
      where: {
        OR: batch.map((record) => ({
          mpnNorm: record.mpnNorm,
          manufacturerNorm: record.manufacturerNorm,
        })),
      },
      include: { offers: { include: { priceBreaks: true } } },
    });
    for (const part of parts) found.set(partKey(part), part);
  }
  return found;
}

function targetOfferKeys(record: CatalogMigrationRecord): Set<string> {
  return new Set(record.offers.map((offer) => `${offer.supplier}:${offer.supplierSku}`));
}

function offerSnapshot(part: PartWithOffers, record: CatalogMigrationRecord): OfferSnapshot[] {
  const targets = targetOfferKeys(record);
  return part.offers
    .filter((offer) => targets.has(`${offer.supplier}:${offer.supplierSku}`))
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
      rawJson: offer.rawJson,
      fetchedAt: offer.fetchedAt.toISOString(),
      contentFingerprint: offer.contentFingerprint,
      priceBreaks: offer.priceBreaks.map((priceBreak) => ({
        qty: priceBreak.qty,
        price: priceBreak.price.toString(),
        currency: priceBreak.currency,
      })),
    }));
}

function partSnapshot(part: PartWithOffers): PartSnapshot {
  return {
    mpn: part.mpn,
    manufacturerName: part.manufacturerName,
    description: part.description,
    category: part.category,
    packageCode: part.packageCode,
    lifecycle: part.lifecycle,
    datasheetUrl: part.datasheetUrl,
    imageUrl: part.imageUrl,
    specsJson: part.specsJson,
    specsSi: part.specsSi,
    specConflicts: part.specConflicts,
    lastSeenAt: part.lastSeenAt.toISOString(),
  };
}

function makeManifest(
  parsed: ParsedCatalogMigration,
  fingerprint: string,
  existing: Map<string, PartWithOffers>,
): MigrationManifest {
  return {
    version: 1,
    sourceFile: parsed.sourceFile,
    sourceSha256: parsed.sourceSha256,
    ingestFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
    appliedAt: null,
    rolledBackAt: null,
    runId: null,
    records: parsed.records.map((record) => {
      const part = existing.get(record.key);
      return {
        key: record.key,
        mpnNorm: record.mpnNorm,
        manufacturerNorm: record.manufacturerNorm,
        existingPartId: part === undefined ? null : String(part.id),
        part: part === undefined ? null : partSnapshot(part),
        offers: part === undefined ? [] : offerSnapshot(part, record),
      };
    }),
  };
}

async function readManifest(file: string): Promise<MigrationManifest> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  return MigrationManifestSchema.parse(raw);
}

async function writeManifest(file: string, manifest: MigrationManifest): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${json(manifest)}\n`, 'utf8');
}

async function ensureApplyManifest(
  file: string,
  parsed: ParsedCatalogMigration,
  fingerprint: string,
  existing: Map<string, PartWithOffers>,
): Promise<MigrationManifest> {
  if (await fileExists(file)) {
    const current = await readManifest(file);
    if (current.ingestFingerprint !== fingerprint) {
      if (current.appliedAt === null && current.rolledBackAt === null) {
        throw new Error(`완료되지 않은 다른 입력의 migration-state가 이미 존재합니다: ${file}`);
      }
      const supersededAt = current.rolledBackAt ?? current.appliedAt ?? current.createdAt;
      const archive = `${file}.${supersededAt.replace(/[:.]/g, '-')}.superseded.bak`;
      await rename(file, archive);
    } else {
      if (current.rolledBackAt === null) return current;
      const archive = `${file}.${current.rolledBackAt.replace(/[:.]/g, '-')}.bak`;
      await rename(file, archive);
    }
  }
  const manifest = makeManifest(parsed, fingerprint, existing);
  await writeManifest(file, manifest);
  return manifest;
}

function preflightSummary(
  parsed: ParsedCatalogMigration,
  fingerprint: string,
  existing: Map<string, PartWithOffers>,
): Record<string, unknown> {
  let existingCatalogOffers = 0;
  for (const record of parsed.records) {
    const part = existing.get(record.key);
    if (part === undefined) continue;
    existingCatalogOffers += offerSnapshot(part, record).length;
  }
  return {
    result: true,
    mode: 'dry-run',
    sourceFile: parsed.sourceFile,
    sourceSha256: parsed.sourceSha256,
    ingestFingerprint: fingerprint,
    inputParts: parsed.records.length,
    existingParts: existing.size,
    newParts: parsed.records.length - existing.size,
    existingCatalogOffers,
    newCatalogOffers: parsed.records.reduce((total, record) => total + record.offers.length, 0)
      - existingCatalogOffers,
    generatedMpnParts: parsed.records.filter((record) => record.product.catalog_metadata.generatedMpn).length,
    commercialOffers: parsed.records.flatMap((record) => record.product.offers)
      .filter((offer) => offer.price_breaks.length > 0 || offer.stock !== null && offer.stock !== undefined).length,
  };
}

type SourceOfferWithPart = Prisma.SpPartOfferGetPayload<{
  include: { part: { include: { offers: true } } };
}>;

interface SourceRetirementItem {
  key: string;
  partId: bigint;
  mpn: string;
  targetOfferIds: bigint[];
  replacementPresent: boolean;
  remainingRealOffers: number;
  quoteReferences: number;
}

interface SourceRetirementPlan {
  suppliers: string[];
  sourceSha256: string;
  targetOffers: number;
  items: SourceRetirementItem[];
  blocked: SourceRetirementItem[];
}

async function loadSourceRetirementPlan(
  parsed: ParsedCatalogMigration,
  sourceSha256: string,
): Promise<SourceRetirementPlan> {
  const suppliers = catalogMigrationSuppliers(parsed);
  const supplierOffers: SourceOfferWithPart[] = await prisma.spPartOffer.findMany({
    where: { supplier: { in: suppliers } },
    include: { part: { include: { offers: true } } },
  });
  const targets = supplierOffers.filter((offer) =>
    isCatalogOfferFromSource(offer.rawJson, offer.supplier, sourceSha256),
  );
  const byPart = new Map<string, SourceOfferWithPart[]>();
  for (const offer of targets) {
    const id = String(offer.partId);
    const values = byPart.get(id) ?? [];
    values.push(offer);
    byPart.set(id, values);
  }
  const partIds = [...byPart.values()].flatMap((offers) => {
    const first = offers[0];
    return first === undefined ? [] : [first.partId];
  });
  const quoteRows = partIds.length === 0
    ? []
    : await prisma.spBomQuoteItem.findMany({
        where: { partId: { in: partIds } },
        select: { partId: true },
      });
  const quotesByPart = new Map<string, number>();
  for (const row of quoteRows) {
    if (row.partId === null) continue;
    const id = String(row.partId);
    quotesByPart.set(id, (quotesByPart.get(id) ?? 0) + 1);
  }
  const replacementKeys = new Set(parsed.records.map((record) => record.key));
  const items = [...byPart.values()].flatMap((offers): SourceRetirementItem[] => {
    const first = offers[0];
    if (first === undefined) return [];
    const targetIds = new Set(offers.map((offer) => String(offer.id)));
    const key = partKey(first.part);
    return [{
      key,
      partId: first.partId,
      mpn: first.part.mpn,
      targetOfferIds: offers.map((offer) => offer.id),
      replacementPresent: replacementKeys.has(key),
      remainingRealOffers: first.part.offers.filter(
        (offer) => offer.supplier !== 'samplepcb' && !targetIds.has(String(offer.id)),
      ).length,
      quoteReferences: quotesByPart.get(String(first.partId)) ?? 0,
    }];
  }).sort((a, b) => a.key.localeCompare(b.key));
  const blocked = items.filter(
    (item) => !item.replacementPresent && item.remainingRealOffers === 0 && item.quoteReferences > 0,
  );
  return {
    suppliers,
    sourceSha256,
    targetOffers: targets.length,
    items,
    blocked,
  };
}

function retirementSummary(plan: SourceRetirementPlan): Record<string, unknown> {
  return {
    suppliers: plan.suppliers,
    retiredSourceSha256: plan.sourceSha256,
    oldSourceOffers: plan.targetOffers,
    oldSourceParts: plan.items.length,
    overlappingReplacementParts: plan.items.filter((item) => item.replacementPresent).length,
    retireOnlyParts: plan.items.filter((item) => !item.replacementPresent).length,
    retainedByOtherSupplier: plan.items.filter(
      (item) => !item.replacementPresent && item.remainingRealOffers > 0,
    ).length,
    blockedQuoteReferences: plan.blocked.map((item) => ({
      key: item.key,
      quoteReferences: item.quoteReferences,
    })),
  };
}

async function retireCatalogSource(
  plan: SourceRetirementPlan,
  candidatePartIds: string[],
): Promise<Record<string, unknown>> {
  if (plan.blocked.length > 0) {
    throw new Error(
      `구 원본 제거 안전 검사 실패\n${plan.blocked
        .map((item) => `${item.key}: 견적 참조 ${String(item.quoteReferences)}건`)
        .join('\n')}`,
    );
  }
  let removedPartsThisRun = 0;
  let deletedOffers = 0;
  for (const item of plan.items) {
    const outcome = await prisma.$transaction(async (tx): Promise<'deleted' | 'reindex' | 'skipped'> => {
      const currentOffers = await tx.spPartOffer.findMany({
        where: { id: { in: item.targetOfferIds } },
        select: { id: true, supplier: true, rawJson: true },
      });
      const currentTargetIds = currentOffers.filter((offer) =>
        isCatalogOfferFromSource(offer.rawJson, offer.supplier, plan.sourceSha256),
      ).map((offer) => offer.id);
      if (currentTargetIds.length === 0) return 'skipped';

      const remainingRealOffers = await tx.spPartOffer.count({
        where: {
          partId: item.partId,
          supplier: { not: 'samplepcb' },
          id: { notIn: currentTargetIds },
        },
      });
      if (remainingRealOffers === 0) {
        const quoteReferences = await tx.spBomQuoteItem.count({ where: { partId: item.partId } });
        if (quoteReferences > 0) {
          throw new Error(`${item.key}: 제거 직전 견적 참조 ${String(quoteReferences)}건 감지`);
        }
        const removed = await tx.spPartOffer.deleteMany({ where: { id: { in: currentTargetIds } } });
        deletedOffers += removed.count;
        await tx.spPartIndexQueue.deleteMany({ where: { partId: item.partId } });
        await tx.spPart.delete({ where: { id: item.partId } });
        return 'deleted';
      }
      const removed = await tx.spPartOffer.deleteMany({ where: { id: { in: currentTargetIds } } });
      deletedOffers += removed.count;
      return 'reindex';
    });
    if (outcome === 'deleted') {
      removedPartsThisRun += 1;
    }
  }

  const candidateIds = [...new Set(candidatePartIds)].map((id) => BigInt(id));
  const retainedParts = candidateIds.length === 0
    ? []
    : await prisma.spPart.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, mpn: true },
      });
  for (const part of retainedParts) {
    await applyPartFacts(part.id);
    if (!await tryIndexPart(part.id, { force: true })) {
      throw new Error(`구 카탈로그 제거 후 재색인 실패: ${part.mpn}`);
    }
  }
  const retainedIds = new Set(retainedParts.map((part) => String(part.id)));
  const deletedPartIds = candidatePartIds.filter((id) => !retainedIds.has(id));
  if (deletedPartIds.length > 0) {
    const response = await esClient().bulk({
      operations: deletedPartIds.map((id) => ({ delete: { _index: SP_PARTS_WRITE, _id: id } })),
      refresh: false,
    });
    const failures = response.items.filter((item) => {
      const operation = item.delete;
      return operation?.error !== undefined && operation.status !== 404;
    });
    if (failures.length > 0) {
      throw new Error(`구 카탈로그 ES 문서 삭제 중 ${String(failures.length)}건 오류가 발생했습니다`);
    }
  }
  if (candidatePartIds.length > 0) await refreshPartsIndex();
  return {
    deletedOffers,
    deletedParts: deletedPartIds.length,
    removedPartsThisRun,
    reindexedParts: retainedParts.length,
  };
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

async function verifyDatabase(
  parsed: ParsedCatalogMigration,
): Promise<{ parts: PartWithOffers[]; failures: string[] }> {
  const partsByKey = await loadExistingParts(parsed.records);
  const failures: string[] = [];
  const parts: PartWithOffers[] = [];
  for (const record of parsed.records) {
    const part = partsByKey.get(record.key);
    if (part === undefined) {
      failures.push(`DB 부품 누락: ${record.key}`);
      continue;
    }
    parts.push(part);
    const offersByKey = new Map(part.offers.map((offer) => [`${offer.supplier}:${offer.supplierSku}`, offer]));
    for (const expected of record.offers) {
      const offer = offersByKey.get(`${expected.supplier}:${expected.supplierSku}`);
      if (offer === undefined) {
        failures.push(`DB 오퍼 누락: ${record.key}/${expected.supplier}:${expected.supplierSku}`);
        continue;
      }
      const rawMatch = catalogOfferRawMatch(offer.rawJson, record.product, expected.supplier);
      if (rawMatch === 'mismatch') {
        failures.push(`DB rawJson 원본 변경: ${record.key}/${expected.supplier}:${expected.supplierSku}`);
      }
      const raw = jsonObject(offer.rawJson);
      const metadata = raw === null ? null : jsonObject(raw.catalog_metadata ?? null);
      if (metadata?.sourceDataset !== parsed.sourceFile) {
        failures.push(`DB rawJson 출처 불일치: ${record.key}/${expected.supplier}:${expected.supplierSku}`);
      }
      if (
        metadata?.sourceDatasetSha256 !== undefined
        && metadata.sourceDatasetSha256 !== parsed.sourceSha256
      ) {
        failures.push(`DB rawJson 원본 해시 불일치: ${record.key}/${expected.supplier}:${expected.supplierSku}`);
      }
      if (raw?.manufacturer_part_number !== record.mpn) {
        failures.push(`DB rawJson MPN 불일치: ${record.key}/${expected.supplier}:${expected.supplierSku}`);
      }
      if (
        offer.priceBreaks.length !== 0
        && rawMatch !== 'samplepcb-price-overlay'
      ) {
        failures.push(`가격이 없는 카탈로그 오퍼에 가격구간 존재: ${record.key}`);
      }
      if (offer.stock !== null) failures.push(`가격이 없는 카탈로그 오퍼에 재고 존재: ${record.key}`);
    }
  }
  return { parts, failures };
}

interface MgetItem {
  _id: string;
  found?: boolean;
  _source?: SpPartDoc;
}

async function verifyElasticsearch(parts: PartWithOffers[]): Promise<string[]> {
  const failures: string[] = [];
  const byId = new Map(parts.map((part) => [String(part.id), part]));
  const response = await esClient().mget<SpPartDoc>({
    index: SP_PARTS_READ,
    ids: [...byId.keys()],
  });
  const items = response.docs as unknown as MgetItem[];
  for (const item of items) {
    const part = byId.get(item._id);
    if (part === undefined) continue;
    if (item.found !== true || item._source === undefined) {
      failures.push(`ES 문서 누락: ${item._id}/${part.mpn}`);
      continue;
    }
    if (item._source.mpnNorm !== part.mpnNorm || item._source.manufacturerNorm !== part.manufacturerNorm) {
      failures.push(`ES 정체성 불일치: ${item._id}/${part.mpn}`);
    }
    const expectedSuppliers = new Set(
      partOffersForDisplay(part.offers).map((offer) => offer.supplier),
    );
    const indexedSuppliers = new Set(item._source.suppliers);
    for (const supplier of expectedSuppliers) {
      if (!indexedSuppliers.has(supplier)) failures.push(`ES 공급사 누락: ${part.mpn}/${supplier}`);
    }
    for (const supplier of indexedSuppliers) {
      if (!expectedSuppliers.has(supplier)) failures.push(`ES 공급사 초과: ${part.mpn}/${supplier}`);
    }
  }
  if (items.length !== parts.length) {
    failures.push(`ES mget 응답 수량 불일치: ${String(items.length)} != ${String(parts.length)}`);
  }
  const queued = await prisma.spPartIndexQueue.count({ where: { partId: { in: parts.map((part) => part.id) } } });
  if (queued > 0) failures.push(`대상 부품 ES 재시도 큐 잔여: ${String(queued)}`);
  return failures;
}

interface SearchCheck {
  query: string;
  supplier: string;
  expectedMpn: string;
  found: boolean;
  topMpn: string | null;
}

interface EngineCatalogCheck {
  supplier: string;
  category: string;
  expectedMpn: string;
  status: string | null;
  candidateFound: boolean;
}

const CatalogEvaluationResponse = z.object({
  items: z.array(
    z.object({
      component_id: z.string(),
      candidates: z.array(
        z.object({
          product: z.object({
            manufacturer_part_number: z.string(),
          }).passthrough(),
        }).passthrough(),
      ),
      procurement_decision: z.object({
        status: z.string(),
      }).passthrough(),
    }).passthrough(),
  ),
});

async function searchOnce(query: string, supplier: string, expectedMpnNorm: string): Promise<SearchCheck> {
  const params = PartSearchQuery.parse({ q: query, supplier, page: 1, pageSize: 100, sort: 'relevance' });
  const request = {
    index: SP_PARTS_READ,
    query: buildSearchQuery(params),
    sort: buildPartSort(params.sort),
    size: params.pageSize,
  } as unknown as estypes.SearchRequest;
  const response = await esClient().search<SpPartDoc>(request);
  const hits = response.hits.hits.flatMap((hit) => hit._source === undefined ? [] : [hit._source]);
  return {
    query,
    supplier,
    expectedMpn: expectedMpnNorm,
    found: hits.some((hit) => hit.mpnNorm === expectedMpnNorm),
    topMpn: hits[0]?.mpn ?? null,
  };
}

function searchSupplier(record: CatalogMigrationRecord): string | undefined {
  return partOffersForDisplay(
    record.product.offers.map((offer) => ({
      supplier: offer.supplier,
      rawJson: record.product,
    })),
  )[0]?.supplier;
}

function catalogEvaluationSamples(records: CatalogMigrationRecord[]): CatalogMigrationRecord[] {
  const bySupplierCategory = new Map<string, CatalogMigrationRecord>();
  for (const record of records) {
    const supplier = record.offers[0]?.supplier;
    if (supplier === undefined) continue;
    const normalizedCategory = record.product.category?.trim();
    const category = normalizedCategory === undefined || normalizedCategory === ''
      ? '(uncategorized)'
      : normalizedCategory;
    const key = `${supplier}\u0000${category}`;
    const existing = bySupplierCategory.get(key);
    if (existing === undefined || record.mpn.localeCompare(existing.mpn, undefined, { numeric: true }) < 0) {
      bySupplierCategory.set(key, record);
    }
  }
  return [...bySupplierCategory.values()].sort(
    (a, b) => (a.offers[0]?.supplier ?? '').localeCompare(b.offers[0]?.supplier ?? '')
      || (a.product.category ?? '').localeCompare(b.product.category ?? '')
      || a.mpn.localeCompare(b.mpn, undefined, { numeric: true }),
  );
}

async function verifyCatalogEvaluation(
  parsed: ParsedCatalogMigration,
): Promise<{ checks: EngineCatalogCheck[]; failures: string[] }> {
  const samples = catalogEvaluationSamples(parsed.records);
  const expectedById = new Map<string, CatalogMigrationRecord>();
  const items = samples.map((record, index) => {
    const componentId = `catalog-verify-${String(index + 1)}`;
    expectedById.set(componentId, record);
    const partType = record.product.normalized_specs.part_type;
    return {
      query: {
        component_id: componentId,
        mode: 'identity',
        part_number: record.mpn,
        manufacturer: record.manufacturerName,
        ...(typeof partType === 'string'
          ? { part_type: partType, category_policy: partType }
          : {}),
        quantity: 1,
      },
      products: [record.product],
    };
  });
  const response = await engineFetch('/supplier-search/catalog-evaluate-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    return {
      checks: [],
      failures: [`엔진 카탈로그 평가 실패: HTTP ${String(response.status)}`],
    };
  }
  const body = CatalogEvaluationResponse.safeParse(await response.json());
  if (!body.success) {
    return { checks: [], failures: ['엔진 카탈로그 평가 응답 계약이 올바르지 않습니다'] };
  }
  const checks: EngineCatalogCheck[] = [];
  const failures: string[] = [];
  const returned = new Set<string>();
  for (const item of body.data.items) {
    returned.add(item.component_id);
    const expected = expectedById.get(item.component_id);
    if (expected === undefined) {
      failures.push(`엔진 카탈로그 평가에 알 수 없는 component가 있습니다: ${item.component_id}`);
      continue;
    }
    const supplier = expected.offers[0]?.supplier ?? '(missing)';
    const candidateFound = item.candidates.some(
      (candidate) => normalizeMpn(candidate.product.manufacturer_part_number) === expected.mpnNorm,
    );
    checks.push({
      supplier,
      category: expected.product.category ?? '(uncategorized)',
      expectedMpn: expected.mpn,
      status: item.procurement_decision.status,
      candidateFound,
    });
    if (!candidateFound) {
      failures.push(`엔진 카탈로그 후보 누락: ${supplier}/${expected.mpn}`);
    }
    const eligible = expected.product.catalog_metadata.autoQuoteEligible !== false;
    if (eligible && item.procurement_decision.status !== 'catalog_selected') {
      failures.push(`선정 가능 카탈로그가 선택되지 않음: ${supplier}/${expected.mpn}`);
    }
    if (!eligible && item.procurement_decision.status === 'catalog_selected') {
      failures.push(`선정 불가 카탈로그가 선택됨: ${supplier}/${expected.mpn}`);
    }
  }
  for (const [componentId, expected] of expectedById) {
    if (!returned.has(componentId)) {
      failures.push(`엔진 카탈로그 평가 응답 누락: ${expected.offers[0]?.supplier ?? '(missing)'}/${expected.mpn}`);
    }
  }
  return { checks, failures };
}

async function verifySearch(parsed: ParsedCatalogMigration): Promise<{ checks: SearchCheck[]; failures: string[] }> {
  const samples = catalogSearchSamples(parsed.records);
  const checks: SearchCheck[] = [];
  for (const sample of samples) {
    const supplier = searchSupplier(sample);
    if (supplier === undefined) {
      checks.push({
        query: sample.mpn,
        supplier: '(missing)',
        expectedMpn: sample.mpnNorm,
        found: false,
        topMpn: null,
      });
      continue;
    }
    checks.push(await searchOnce(sample.mpn, supplier, sample.mpnNorm));
    checks.push(await searchOnce(sample.mpnNorm, supplier, sample.mpnNorm));
  }
  const representative = samples[0];
  if (representative !== undefined) {
    const supplier = searchSupplier(representative);
    if (supplier !== undefined) {
      checks.push(await searchOnce(representative.mpnNorm.slice(0, 8), supplier, representative.mpnNorm));
      if (representative.mpnNorm.length >= 8) {
        checks.push(await searchOnce(representative.mpnNorm.slice(2, 8), supplier, representative.mpnNorm));
      }
    }
  }
  return {
    checks,
    failures: checks.filter((check) => !check.found)
      .map((check) => `검색 실패: ${check.query} → ${check.expectedMpn}`),
  };
}

async function verifyAll(
  parsed: ParsedCatalogMigration,
  includeSearch: boolean,
): Promise<Record<string, unknown>> {
  const database = await verifyDatabase(parsed);
  const esFailures = await verifyElasticsearch(database.parts);
  const search = includeSearch ? await verifySearch(parsed) : { checks: [], failures: [] };
  const engineCatalog = includeSearch
    ? await verifyCatalogEvaluation(parsed)
    : { checks: [], failures: [] };
  const failures = [
    ...database.failures,
    ...esFailures,
    ...search.failures,
    ...engineCatalog.failures,
  ];
  const result = {
    result: failures.length === 0,
    inputParts: parsed.records.length,
    dbParts: database.parts.length,
    esDocuments: database.parts.length - esFailures.filter((failure) => failure.startsWith('ES 문서 누락')).length,
    searchChecks: search.checks,
    engineCatalogChecks: engineCatalog.checks,
    failures,
  };
  if (failures.length > 0) throw new Error(`마이그레이션 검증 실패\n${json(result)}`);
  return result;
}

async function restoreOffer(partId: bigint, snapshot: OfferSnapshot): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const unique = {
      partId_supplier_supplierSku: {
        partId,
        supplier: snapshot.supplier,
        supplierSku: snapshot.supplierSku,
      },
    };
    const offer = await tx.spPartOffer.upsert({
      where: unique,
      create: {
        partId,
        supplier: snapshot.supplier,
        supplierSku: snapshot.supplierSku,
        productUrl: snapshot.productUrl,
        stock: snapshot.stock,
        moq: snapshot.moq,
        orderMultiple: snapshot.orderMultiple,
        packaging: snapshot.packaging,
        currency: snapshot.currency,
        leadTime: snapshot.leadTime,
        rawJson: snapshot.rawJson as Prisma.InputJsonValue,
        fetchedAt: new Date(snapshot.fetchedAt),
        contentFingerprint: snapshot.contentFingerprint,
      },
      update: {
        productUrl: snapshot.productUrl,
        stock: snapshot.stock,
        moq: snapshot.moq,
        orderMultiple: snapshot.orderMultiple,
        packaging: snapshot.packaging,
        currency: snapshot.currency,
        leadTime: snapshot.leadTime,
        rawJson: snapshot.rawJson as Prisma.InputJsonValue,
        fetchedAt: new Date(snapshot.fetchedAt),
        contentFingerprint: snapshot.contentFingerprint,
      },
      select: { id: true },
    });
    await tx.spPartPriceBreak.deleteMany({ where: { offerId: offer.id } });
    if (snapshot.priceBreaks.length > 0) {
      await tx.spPartPriceBreak.createMany({
        data: snapshot.priceBreaks.map((priceBreak) => ({
          offerId: offer.id,
          qty: priceBreak.qty,
          price: priceBreak.price,
          currency: priceBreak.currency,
        })),
      });
    }
  });
}

async function restorePartFacts(partId: bigint, snapshot: PartSnapshot): Promise<void> {
  await prisma.spPart.update({
    where: { id: partId },
    data: {
      mpn: snapshot.mpn,
      manufacturerName: snapshot.manufacturerName,
      description: snapshot.description,
      category: snapshot.category,
      packageCode: snapshot.packageCode,
      lifecycle: snapshot.lifecycle,
      datasheetUrl: snapshot.datasheetUrl,
      imageUrl: snapshot.imageUrl,
      specsJson: snapshot.specsJson as Prisma.InputJsonValue,
      specsSi: snapshot.specsSi as Prisma.InputJsonValue,
      specConflicts: snapshot.specConflicts === null
        ? Prisma.DbNull
        : snapshot.specConflicts as Prisma.InputJsonValue,
      lastSeenAt: new Date(snapshot.lastSeenAt),
      factsFingerprint: null,
      indexFingerprint: null,
      indexedAt: null,
    },
  });
}

async function rollback(
  parsed: ParsedCatalogMigration,
  manifestFile: string,
  fingerprint: string,
): Promise<Record<string, unknown>> {
  if (!await fileExists(manifestFile)) throw new Error(`rollback manifest가 없습니다: ${manifestFile}`);
  const manifest = await readManifest(manifestFile);
  if (manifest.ingestFingerprint !== fingerprint) throw new Error('입력 파일과 rollback manifest가 다릅니다');
  if (manifest.rolledBackAt !== null) throw new Error(`이미 rollback되었습니다: ${manifest.rolledBackAt}`);
  if (manifest.retirement !== undefined) {
    throw new Error(
      '--replace는 구 source 제거를 포함하므로 이 CLI의 부분 rollback을 허용하지 않습니다. 운영 DB 백업을 복원하세요.',
    );
  }

  const recordsByKey = new Map(parsed.records.map((record) => [record.key, record]));
  const blocked: string[] = [];
  for (const snapshot of manifest.records) {
    const part = await prisma.spPart.findUnique({
      where: {
        mpnNorm_manufacturerNorm: {
          mpnNorm: snapshot.mpnNorm,
          manufacturerNorm: snapshot.manufacturerNorm,
        },
      },
      include: { offers: true },
    });
    if (part === null) continue;
    const record = recordsByKey.get(snapshot.key);
    if (record === undefined) throw new Error(`manifest key가 입력에 없습니다: ${snapshot.key}`);
    const targets = targetOfferKeys(record);
    const previousOffers = new Map(
      snapshot.offers.map((offer) => [`${offer.supplier}:${offer.supplierSku}`, offer]),
    );
    const changedTargetOffers = part.offers.filter(
      (offer) => {
        const key = `${offer.supplier}:${offer.supplierSku}`;
        if (!targets.has(key)) return false;
        const previous = previousOffers.get(key);
        return catalogOfferRawMatch(offer.rawJson, record.product, offer.supplier) === 'mismatch'
          && (previous === undefined || !isDeepStrictEqual(offer.rawJson, previous.rawJson));
      },
    );
    if (changedTargetOffers.length > 0) {
      blocked.push(`${snapshot.key}: 적용 후 동일 공급사 오퍼가 다시 변경됨`);
      continue;
    }
    if (snapshot.existingPartId !== null) continue;
    const remainingRealOffers = part.offers.filter(
      (offer) => offer.supplier !== 'samplepcb' && !targets.has(`${offer.supplier}:${offer.supplierSku}`),
    );
    const quoteReferences = await prisma.spBomQuoteItem.count({ where: { partId: part.id } });
    if (remainingRealOffers.length === 0 && quoteReferences > 0) {
      blocked.push(`${snapshot.key}: 견적 참조 ${String(quoteReferences)}건`);
    }
  }
  if (blocked.length > 0) throw new Error(`rollback 안전 검사 실패\n${blocked.join('\n')}`);

  const deletedPartIds: string[] = [];
  const reindexedPartIds: string[] = [];
  for (const snapshot of manifest.records) {
    const record = recordsByKey.get(snapshot.key);
    if (record === undefined) throw new Error(`manifest key가 입력에 없습니다: ${snapshot.key}`);
    const part = await prisma.spPart.findUnique({
      where: {
        mpnNorm_manufacturerNorm: {
          mpnNorm: snapshot.mpnNorm,
          manufacturerNorm: snapshot.manufacturerNorm,
        },
      },
      include: { offers: true },
    });
    if (part === null) continue;

    const restoredKeys = new Set(snapshot.offers.map((offer) => `${offer.supplier}:${offer.supplierSku}`));
    for (const identity of record.offers) {
      if (restoredKeys.has(`${identity.supplier}:${identity.supplierSku}`)) continue;
      await prisma.spPartOffer.deleteMany({
        where: { partId: part.id, supplier: identity.supplier, supplierSku: identity.supplierSku },
      });
    }
    for (const offer of snapshot.offers) await restoreOffer(part.id, offer);

    const realOfferCount = await prisma.spPartOffer.count({
      where: { partId: part.id, supplier: { not: 'samplepcb' } },
    });
    if (snapshot.existingPartId === null && realOfferCount === 0) {
      await prisma.$transaction([
        prisma.spPartIndexQueue.deleteMany({ where: { partId: part.id } }),
        prisma.spPart.delete({ where: { id: part.id } }),
      ]);
      deletedPartIds.push(String(part.id));
      continue;
    }

    if (realOfferCount === 0 && snapshot.part !== null) await restorePartFacts(part.id, snapshot.part);
    else await applyPartFacts(part.id);
    if (!await tryIndexPart(part.id, { force: true })) throw new Error(`rollback 재색인 실패: ${part.mpn}`);
    reindexedPartIds.push(String(part.id));
  }

  if (deletedPartIds.length > 0) {
    const response = await esClient().bulk({
      operations: deletedPartIds.map((id) => ({ delete: { _index: SP_PARTS_WRITE, _id: id } })),
      refresh: false,
    });
    if (response.errors) throw new Error('rollback ES 문서 삭제 중 오류가 발생했습니다');
  }
  if (deletedPartIds.length > 0 || reindexedPartIds.length > 0) await refreshPartsIndex();
  await prisma.spPartIngestRun.updateMany({
    where: { fingerprint },
    data: {
      status: 'failed',
      error: 'reverted by parts catalog migration CLI',
      completedAt: null,
      leaseUntil: null,
    },
  });
  manifest.rolledBackAt = new Date().toISOString();
  await writeManifest(manifestFile, manifest);
  return {
    result: true,
    deletedParts: deletedPartIds.length,
    reindexedParts: reindexedPartIds.length,
    manifest: manifestFile,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const input = await loadInput(options.file, options.source);
  if (options.mode === 'dry-run') {
    const existing = await loadExistingParts(input.parsed.records);
    const replacement = options.retireSourceSha === undefined
      ? null
      : await loadSourceRetirementPlan(input.parsed, options.retireSourceSha);
    console.log(json({
      ...preflightSummary(input.parsed, input.fingerprint, existing),
      ...(replacement === null ? {} : { replacement: retirementSummary(replacement) }),
    }));
    return;
  }
  await bootstrapPartsIndex(console);
  if (options.mode === 'apply' || options.mode === 'replace') {
    if (
      options.mode === 'replace'
      && options.retireSourceSha === input.parsed.sourceSha256
    ) {
      throw new Error('새 원본과 제거 원본의 SHA-256이 같습니다');
    }
    const replacementBefore = options.mode === 'replace'
      ? await loadSourceRetirementPlan(input.parsed, options.retireSourceSha ?? '')
      : null;
    if (replacementBefore !== null && replacementBefore.blocked.length > 0) {
      throw new Error(
        `교체 적용 전 안전 검사 실패\n${replacementBefore.blocked
          .map((item) => `${item.key}: 견적 참조 ${String(item.quoteReferences)}건`)
          .join('\n')}`,
      );
    }
    const existing = await loadExistingParts(input.parsed.records);
    const manifest = await ensureApplyManifest(options.manifest, input.parsed, input.fingerprint, existing);
    let reused = false;
    let ingest: Awaited<ReturnType<typeof ingestSupplierSearchResultOnce>> | null = null;
    let verification: Record<string, unknown> | null = null;
    if (manifest.appliedAt !== null) {
      try {
        verification = await verifyAll(input.parsed, true);
        reused = true;
      } catch {
        // DB·ES가 적용 완료 원장에서 이탈했다면 동일 fingerprint를 failed로 되돌려
        // 기존 idempotent 인제스트가 누락분을 복구할 수 있게 한다.
        await prisma.spPartIngestRun.updateMany({
          where: { fingerprint: input.fingerprint, status: 'completed' },
          data: { status: 'failed', error: 'catalog migration verification requested replay' },
        });
      }
    }
    if (!reused) {
      ingest = await ingestSupplierSearchResultOnce(input.raw, `catalog:${input.parsed.sourceFile}`);
      manifest.appliedAt = new Date().toISOString();
      manifest.runId = ingest.runId;
      await writeManifest(options.manifest, manifest);
      verification = await verifyAll(input.parsed, true);
    }
    if (verification === null) throw new Error('적용 후 검증 결과가 없습니다');
    if (options.mode === 'apply') {
      console.log(json({
        result: true,
        mode: options.mode,
        reused,
        manifest: options.manifest,
        ingest,
        verification,
      }));
      return;
    }

    const replacementAfter = await loadSourceRetirementPlan(
      input.parsed,
      options.retireSourceSha ?? '',
    );
    if (
      manifest.retirement !== undefined
      && manifest.retirement.sourceSha256 !== options.retireSourceSha
    ) {
      throw new Error('manifest에 다른 구 원본 제거 작업이 기록되어 있습니다');
    }
    const candidatePartIds = [...new Set([
      ...(manifest.retirement?.candidatePartIds ?? []),
      ...replacementAfter.items.map((item) => String(item.partId)),
    ])];
    const alreadyRetired = manifest.retirement?.completedAt !== null
      && manifest.retirement?.completedAt !== undefined
      && replacementAfter.targetOffers === 0;
    let retirement: Record<string, unknown>;
    if (alreadyRetired) {
      retirement = {
        reused: true,
        candidateParts: candidatePartIds.length,
        completedAt: manifest.retirement?.completedAt,
      };
    } else {
      manifest.retirement = {
        sourceSha256: options.retireSourceSha ?? '',
        candidatePartIds,
        completedAt: null,
      };
      // DB 제거 전에 대상 part ID를 저장한다. DB 성공 후 ES 실패·프로세스 종료가 나도
      // 다음 실행이 사라진 DB 행의 ES 문서까지 다시 삭제할 수 있다.
      await writeManifest(options.manifest, manifest);
      retirement = await retireCatalogSource(replacementAfter, candidatePartIds);
    }
    const remaining = await loadSourceRetirementPlan(
      input.parsed,
      options.retireSourceSha ?? '',
    );
    if (remaining.targetOffers > 0) {
      throw new Error(`구 원본 오퍼가 ${String(remaining.targetOffers)}건 남았습니다`);
    }
    const finalVerification = await verifyAll(input.parsed, true);
    manifest.retirement = {
      sourceSha256: options.retireSourceSha ?? '',
      candidatePartIds,
      completedAt: new Date().toISOString(),
    };
    await writeManifest(options.manifest, manifest);
    console.log(json({
      result: true,
      mode: options.mode,
      reused,
      manifest: options.manifest,
      ingest,
      verification,
      replacementBefore: replacementBefore === null ? null : retirementSummary(replacementBefore),
      retirement,
      retiredSourceRemainingOffers: remaining.targetOffers,
      finalVerification,
    }));
    return;
  }
  if (options.mode === 'rollback') {
    console.log(json(await rollback(input.parsed, options.manifest, input.fingerprint)));
    return;
  }
  console.log(json(await verifyAll(input.parsed, options.mode === 'verify-search')));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
