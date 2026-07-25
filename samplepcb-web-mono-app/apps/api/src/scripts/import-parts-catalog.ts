import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PartSearchQuery } from '@sp/api-contract';
import type { estypes } from '@elastic/elasticsearch';
import { esClient } from '../es/client';
import {
  SP_PARTS_READ,
  SP_PARTS_WRITE,
  bootstrapPartsIndex,
  type SpPartDoc,
} from '../es/sp-parts-index';
import { prisma } from '../lib/prisma';
import {
  applyPartFacts,
  ingestSupplierSearchResultOnce,
  supplierSearchIngestFingerprint,
  tryIndexPart,
} from '../lib/parts-ingest';
import { refreshPartsIndex } from '../lib/parts-es';
import {
  catalogSearchSamples,
  parseCatalogMigrationEnvelope,
  type CatalogMigrationRecord,
  type ParsedCatalogMigration,
} from '../lib/parts-catalog-migration';
import { buildPartSort, buildSearchQuery } from '../routes/admin-parts';

type Mode = 'dry-run' | 'apply' | 'verify' | 'verify-search' | 'rollback';

interface CliOptions {
  mode: Mode;
  file: string;
  manifest: string;
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
});

type MigrationManifest = z.infer<typeof MigrationManifestSchema>;
type OfferSnapshot = z.infer<typeof OfferSnapshotSchema>;
type PartSnapshot = z.infer<typeof PartSnapshotSchema>;

const DEFAULT_FILE = path.resolve(
  process.cwd(),
  'catalog-migrations/yeonho-connectors-2026-07-17/catalog-envelope.json',
);

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
    ['--verify', 'verify'],
    ['--verify-search', 'verify-search'],
    ['--rollback', 'rollback'],
  ];
  const selected = modes.filter(([flag]) => args.includes(flag));
  if (selected.length !== 1) {
    throw new Error('실행 모드를 하나만 지정하세요: --dry-run|--apply|--verify|--verify-search|--rollback');
  }
  const mode = selected[0]?.[1];
  if (mode === undefined) throw new Error('실행 모드가 없습니다');
  const file = path.resolve(optionValue(args, '--file') ?? DEFAULT_FILE);
  const manifest = path.resolve(
    optionValue(args, '--manifest') ?? path.join(path.dirname(file), 'migration-state.json'),
  );
  return { mode, file, manifest };
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

async function loadInput(file: string): Promise<{ raw: unknown; parsed: ParsedCatalogMigration; fingerprint: string }> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
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
      throw new Error(`다른 입력의 migration-state가 이미 존재합니다: ${file}`);
    }
    if (current.rolledBackAt === null) return current;
    const archive = `${file}.${current.rolledBackAt.replace(/[:.]/g, '-')}.bak`;
    await rename(file, archive);
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
      if (offer.priceBreaks.length !== 0) {
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
    const expectedSuppliers = new Set(part.offers.map((offer) => offer.supplier));
    for (const supplier of expectedSuppliers) {
      if (!item._source.suppliers.includes(supplier)) failures.push(`ES 공급사 누락: ${part.mpn}/${supplier}`);
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

async function verifySearch(parsed: ParsedCatalogMigration): Promise<{ checks: SearchCheck[]; failures: string[] }> {
  const samples = catalogSearchSamples(parsed.records);
  const checks: SearchCheck[] = [];
  for (const sample of samples) {
    const supplier = sample.offers[0]?.supplier;
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
    const supplier = representative.offers[0]?.supplier;
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
  const failures = [...database.failures, ...esFailures, ...search.failures];
  const result = {
    result: failures.length === 0,
    inputParts: parsed.records.length,
    dbParts: database.parts.length,
    esDocuments: database.parts.length - esFailures.filter((failure) => failure.startsWith('ES 문서 누락')).length,
    searchChecks: search.checks,
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
        return !isDeepStrictEqual(offer.rawJson, record.product)
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
  const input = await loadInput(options.file);
  if (options.mode === 'dry-run') {
    const existing = await loadExistingParts(input.parsed.records);
    console.log(json(preflightSummary(input.parsed, input.fingerprint, existing)));
    return;
  }
  await bootstrapPartsIndex(console);
  if (options.mode === 'apply') {
    const existing = await loadExistingParts(input.parsed.records);
    const manifest = await ensureApplyManifest(options.manifest, input.parsed, input.fingerprint, existing);
    if (manifest.appliedAt !== null) {
      try {
        const verification = await verifyAll(input.parsed, true);
        console.log(json({
          result: true,
          mode: options.mode,
          reused: true,
          manifest: options.manifest,
          verification,
        }));
        return;
      } catch {
        // DB·ES가 적용 완료 원장에서 이탈했다면 동일 fingerprint를 failed로 되돌려
        // 기존 idempotent 인제스트가 누락분을 복구할 수 있게 한다.
        await prisma.spPartIngestRun.updateMany({
          where: { fingerprint: input.fingerprint, status: 'completed' },
          data: { status: 'failed', error: 'catalog migration verification requested replay' },
        });
      }
    }
    const result = await ingestSupplierSearchResultOnce(input.raw, `catalog:${input.parsed.sourceFile}`);
    manifest.appliedAt = new Date().toISOString();
    manifest.runId = result.runId;
    await writeManifest(options.manifest, manifest);
    const verification = await verifyAll(input.parsed, true);
    console.log(json({
      result: true,
      mode: options.mode,
      manifest: options.manifest,
      ingest: result,
      verification,
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
