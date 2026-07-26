import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { normalizeMpn } from '@sp/utils';
import { resolveManufacturer } from './manufacturer-alias';
import type { CatalogMigrationRecord } from './parts-catalog-migration';
import { WALSIN_RLC_SOURCE_SHA256 } from './walsin-rlc-catalog-workbook';

export const WALSIN_PRICE_SNAPSHOT_VERSION =
  'walsin-catalog-price-snapshot/v1' as const;
export const WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION =
  'walsin-catalog-price-snapshot-manifest/v1' as const;

const SnapshotPriceBreak = z.object({
  quantity: z.number().int().positive(),
  unit_price: z.number().positive(),
  currency: z.string().min(1),
});

const SnapshotOffer = z
  .object({
    supplier: z.string().min(1).max(32),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nonnegative().nullish(),
    // 공급사 원문은 "미제공"을 null뿐 아니라 0으로도 표현한다. 인제스트 계약과
    // 동일하게 보존하고, 실제 주문수량 계산 계층에서 최소 1로 해석한다.
    moq: z.number().int().nonnegative().nullish(),
    order_multiple: z.number().int().nonnegative().nullish(),
    price_breaks: z.array(SnapshotPriceBreak).default([]),
    lead_time: z.string().nullish(),
    product_url: z.string().nullish(),
    fetched_at: z.string().datetime(),
  })
  .passthrough();

export const WalsinPriceSnapshotProduct = z
  .object({
    supplier: z.string().min(1).max(32),
    manufacturer_part_number: z.string().min(1).max(191),
    manufacturer: z.string().nullish(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    package: z.string().nullish(),
    lifecycle_status: z.string().nullish(),
    datasheet_url: z.string().nullish(),
    image_url: z.string().nullish(),
    normalized_specs: z.record(z.string(), z.unknown()).default({}),
    offers: z.array(SnapshotOffer).default([]),
  })
  .passthrough();

const SnapshotTerminalStatus = z.enum([
  'priced',
  'found_without_price',
  'not_found',
]);

export const WalsinPriceSnapshotRecord = z.object({
  key: z.string().min(1),
  mpn: z.string().min(1),
  mpnNorm: z.string().min(1),
  manufacturerName: z.string().min(1),
  manufacturerNorm: z.string().min(1),
  status: SnapshotTerminalStatus,
  products: z.array(WalsinPriceSnapshotProduct),
  warnings: z.array(z.string()),
  apiCalls: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

const SnapshotSummary = z.object({
  targets: z.number().int().positive(),
  priced: z.number().int().nonnegative(),
  foundWithoutPrice: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative(),
  exactProducts: z.number().int().nonnegative(),
  supplierOffers: z.number().int().nonnegative(),
  pricedOffers: z.number().int().nonnegative(),
  priceBreaks: z.number().int().nonnegative(),
  apiCalls: z.number().int().nonnegative(),
  supplierErrorRecords: z.number().int().nonnegative(),
});

export const WalsinPriceSnapshotArtifact = z.object({
  schemaVersion: z.literal(WALSIN_PRICE_SNAPSHOT_VERSION),
  generatedAt: z.string().datetime(),
  source: z.object({
    file: z.string().min(1),
    sha256: z.literal(WALSIN_RLC_SOURCE_SHA256),
  }),
  summary: SnapshotSummary,
  records: z.array(WalsinPriceSnapshotRecord),
});

export const WalsinPriceSnapshotManifest = z.object({
  schemaVersion: z.literal(WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION),
  generatedAt: z.string().datetime(),
  sourceFile: z.string().min(1),
  sourceSha256: z.literal(WALSIN_RLC_SOURCE_SHA256),
  snapshotFile: z.string().min(1),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotBytes: z.number().int().positive(),
  summary: SnapshotSummary,
});

const RefreshEnvelope = z.object({
  search: z
    .object({
      components: z.array(
        z
          .object({
            component_id: z.string().min(1).optional(),
            candidates: z.array(
              z.object({ product: WalsinPriceSnapshotProduct }).passthrough(),
            ).default([]),
            warnings: z.array(z.string()).default([]),
            api_calls: z.number().int().nonnegative().default(0),
          })
          .passthrough(),
      ).default([]),
      api_calls: z.number().int().nonnegative().default(0),
    })
    .passthrough(),
});

export type WalsinPriceSnapshotProductType = z.infer<
  typeof WalsinPriceSnapshotProduct
>;
export type WalsinPriceSnapshotRecordType = z.infer<
  typeof WalsinPriceSnapshotRecord
>;
export type WalsinPriceSnapshotArtifactType = z.infer<
  typeof WalsinPriceSnapshotArtifact
>;
export type WalsinPriceSnapshotManifestType = z.infer<
  typeof WalsinPriceSnapshotManifest
>;
export type WalsinPriceSnapshotSummary = z.infer<typeof SnapshotSummary>;

export interface WalsinPriceSnapshotTarget {
  key: string;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
}

const EXTERNAL_SUPPLIER_WARNING = /^(?:digikey|mouser|unikeyic):\s+/i;
const INCOMPLETE_SEARCH_WARNING =
  /(?:공급사 검색이 작업 시간 상한 .*초를 초과|실시간 공급사 갱신이 작업 시간 상한을 초과|공급사 검색 작업을 완료하지 못했습니다)/;

export function walsinSnapshotSupplierErrors(warnings: string[]): string[] {
  return warnings.filter(
    (warning) =>
      EXTERNAL_SUPPLIER_WARNING.test(warning)
      || INCOMPLETE_SEARCH_WARNING.test(warning),
  );
}

export function walsinSnapshotBlockingErrors(warnings: string[]): string[] {
  return warnings.filter((warning) =>
    INCOMPLETE_SEARCH_WARNING.test(warning),
  );
}

function canonicalProduct(
  product: WalsinPriceSnapshotProductType,
): WalsinPriceSnapshotProductType {
  return {
    ...product,
    offers: [...product.offers]
      .map((offer) => ({
        ...offer,
        price_breaks: canonicalPriceBreaks(offer.price_breaks),
      }))
      .sort((a, b) =>
        a.supplier.localeCompare(b.supplier)
        || (a.supplier_sku ?? '').localeCompare(b.supplier_sku ?? '')),
  };
}

function canonicalPriceBreaks(
  priceBreaks: z.infer<typeof SnapshotPriceBreak>[],
): z.infer<typeof SnapshotPriceBreak>[] {
  const byQuantity = new Map<number, z.infer<typeof SnapshotPriceBreak>>();
  for (const priceBreak of priceBreaks) {
    const current = byQuantity.get(priceBreak.quantity);
    if (
      current === undefined
      || priceBreak.unit_price < current.unit_price
      || (
        priceBreak.unit_price === current.unit_price
        && priceBreak.currency < current.currency
      )
    ) {
      byQuantity.set(priceBreak.quantity, priceBreak);
    }
  }
  return [...byQuantity.values()].sort((a, b) => a.quantity - b.quantity);
}

function productKey(product: WalsinPriceSnapshotProductType): string {
  return [
    product.supplier,
    resolveManufacturer(product.manufacturer).norm,
    normalizeMpn(product.manufacturer_part_number),
    product.offers.map((offer) => `${offer.supplier}:${offer.supplier_sku ?? ''}`).join('|'),
  ].join('\u0000');
}

function canonicalRecord(
  record: WalsinPriceSnapshotRecordType,
): WalsinPriceSnapshotRecordType {
  const products = new Map<string, WalsinPriceSnapshotProductType>();
  for (const value of record.products) {
    const product = canonicalProduct(value);
    products.set(productKey(product), product);
  }
  const canonicalProducts = [...products.values()].sort((a, b) =>
    a.supplier.localeCompare(b.supplier)
    || a.manufacturer_part_number.localeCompare(b.manufacturer_part_number));
  const priced = canonicalProducts.some((product) =>
    product.offers.some((offer) => offer.price_breaks.length > 0),
  );
  return WalsinPriceSnapshotRecord.parse({
    ...record,
    status: canonicalProducts.length === 0
      ? 'not_found'
      : priced
        ? 'priced'
        : 'found_without_price',
    products: canonicalProducts,
    warnings: [...new Set(record.warnings)].sort(),
  });
}

function exactProducts(
  envelope: unknown,
  target: Pick<WalsinPriceSnapshotTarget, 'mpnNorm' | 'manufacturerNorm'>,
  componentId?: string,
): {
  products: WalsinPriceSnapshotProductType[];
  warnings: string[];
  apiCalls: number;
} {
  const parsed = RefreshEnvelope.parse(envelope);
  const components = componentId === undefined
    ? parsed.search.components
    : parsed.search.components.filter(
        (component) => component.component_id === componentId,
      );
  if (componentId !== undefined && components.length !== 1) {
    throw new Error(
      `배치 가격 응답 component_id가 없거나 중복입니다: ${componentId}`,
    );
  }
  const products = new Map<string, WalsinPriceSnapshotProductType>();
  const warnings = new Set<string>();
  for (const component of components) {
    for (const warning of component.warnings) warnings.add(warning);
    for (const candidate of component.candidates) {
      const product = candidate.product;
      if (
        normalizeMpn(product.manufacturer_part_number) !== target.mpnNorm
        || resolveManufacturer(product.manufacturer).norm !== target.manufacturerNorm
      ) continue;
      const canonical = canonicalProduct(product);
      products.set(productKey(canonical), canonical);
    }
  }
  return {
    products: [...products.values()].sort((a, b) =>
      a.supplier.localeCompare(b.supplier)
      || a.manufacturer_part_number.localeCompare(b.manufacturer_part_number)),
    warnings: [...warnings].sort(),
    apiCalls: componentId === undefined
      ? parsed.search.api_calls
      : components.reduce(
          (total, component) => total + component.api_calls,
          0,
        ),
  };
}

export function exactWalsinPriceSnapshotRecord(
  envelope: unknown,
  target: WalsinPriceSnapshotTarget,
  updatedAt = new Date().toISOString(),
  componentId?: string,
): WalsinPriceSnapshotRecordType {
  const exact = exactProducts(envelope, target, componentId);
  const priced = exact.products.some((product) =>
    product.offers.some((offer) => offer.price_breaks.length > 0),
  );
  return WalsinPriceSnapshotRecord.parse({
    ...target,
    status: exact.products.length === 0
      ? 'not_found'
      : priced
        ? 'priced'
        : 'found_without_price',
    products: exact.products,
    warnings: exact.warnings,
    apiCalls: exact.apiCalls,
    updatedAt,
  });
}

export function walsinPriceSnapshotEnvelopeApiCalls(envelope: unknown): number {
  return RefreshEnvelope.parse(envelope).search.api_calls;
}

export function summarizeWalsinPriceSnapshotRecords(
  records: WalsinPriceSnapshotRecordType[],
): WalsinPriceSnapshotSummary {
  const products = records.flatMap((record) => record.products);
  const offers = products.flatMap((product) => product.offers);
  return {
    targets: records.length,
    priced: records.filter((record) => record.status === 'priced').length,
    foundWithoutPrice: records.filter(
      (record) => record.status === 'found_without_price',
    ).length,
    notFound: records.filter((record) => record.status === 'not_found').length,
    exactProducts: products.length,
    supplierOffers: offers.length,
    pricedOffers: offers.filter((offer) => offer.price_breaks.length > 0).length,
    priceBreaks: offers.reduce(
      (total, offer) => total + offer.price_breaks.length,
      0,
    ),
    apiCalls: records.reduce((total, record) => total + record.apiCalls, 0),
    supplierErrorRecords: records.filter(
      (record) => walsinSnapshotSupplierErrors(record.warnings).length > 0,
    ).length,
  };
}

export function validateWalsinPriceSnapshotCoverage(
  artifactValue: unknown,
  records: CatalogMigrationRecord[],
): WalsinPriceSnapshotArtifactType {
  const artifact = WalsinPriceSnapshotArtifact.parse(artifactValue);
  const expected = new Map(records.map((record) => [record.key, record]));
  const seen = new Set<string>();
  for (const snapshot of artifact.records) {
    const record = expected.get(snapshot.key);
    if (record === undefined) {
      throw new Error(`가격 스냅샷에 원본 밖 부품이 있습니다: ${snapshot.key}`);
    }
    if (seen.has(snapshot.key)) {
      throw new Error(`가격 스냅샷 key가 중복됩니다: ${snapshot.key}`);
    }
    seen.add(snapshot.key);
    if (
      snapshot.mpnNorm !== record.mpnNorm
      || snapshot.manufacturerNorm !== record.manufacturerNorm
    ) {
      throw new Error(`가격 스냅샷 identity가 원본과 다릅니다: ${snapshot.key}`);
    }
    for (const product of snapshot.products) {
      if (
        normalizeMpn(product.manufacturer_part_number) !== snapshot.mpnNorm
        || resolveManufacturer(product.manufacturer).norm !== snapshot.manufacturerNorm
      ) {
        throw new Error(`가격 스냅샷 exact identity 위반: ${snapshot.key}`);
      }
    }
    const canonical = canonicalRecord(snapshot);
    if (canonical.status !== snapshot.status) {
      throw new Error(`가격 스냅샷 상태와 오퍼 가격이 다릅니다: ${snapshot.key}`);
    }
    if (
      JSON.stringify(canonical.products) !== JSON.stringify(snapshot.products)
      || JSON.stringify(canonical.warnings) !== JSON.stringify(snapshot.warnings)
    ) {
      throw new Error(`가격 스냅샷 레코드가 정준 형식이 아닙니다: ${snapshot.key}`);
    }
    const blockingErrors = walsinSnapshotBlockingErrors(snapshot.warnings);
    if (blockingErrors.length > 0) {
      throw new Error(
        `가격 스냅샷에 미완료 검색이 남았습니다: ${snapshot.key}/${blockingErrors.join('|')}`,
      );
    }
  }
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((key) => !seen.has(key));
    throw new Error(
      `가격 스냅샷 대상이 부족합니다: ${String(seen.size)}/${String(expected.size)}`
      + ` (${missing.slice(0, 3).join(', ')})`,
    );
  }
  const summary = summarizeWalsinPriceSnapshotRecords(artifact.records);
  if (JSON.stringify(summary) !== JSON.stringify(artifact.summary)) {
    throw new Error('가격 스냅샷 summary가 records와 일치하지 않습니다');
  }
  return artifact;
}

export function buildWalsinPriceSnapshotArtifact(
  sourceFile: string,
  records: WalsinPriceSnapshotRecordType[],
  generatedAt = new Date().toISOString(),
): WalsinPriceSnapshotArtifactType {
  const sorted = records
    .map((record) => canonicalRecord(record))
    .sort((a, b) => a.key.localeCompare(b.key));
  return WalsinPriceSnapshotArtifact.parse({
    schemaVersion: WALSIN_PRICE_SNAPSHOT_VERSION,
    generatedAt,
    source: {
      file: path.basename(sourceFile),
      sha256: WALSIN_RLC_SOURCE_SHA256,
    },
    summary: summarizeWalsinPriceSnapshotRecords(sorted),
    records: sorted,
  });
}

export function walsinPriceSnapshotIngestEnvelope(
  artifactValue: unknown,
): unknown {
  const artifact = WalsinPriceSnapshotArtifact.parse(artifactValue);
  return {
    supplier_search_schema_version: 'sp-supplier-search-envelope/v1',
    search: {
      search_schema_version: '1.7',
      source_file: artifact.source.file,
      components: artifact.records.flatMap((record) =>
        record.products.length === 0
          ? []
          : [{
              component_id: `walsin-price:${record.key}`,
              status: record.status,
              candidates: record.products.map((product) => ({ product })),
              warnings: record.warnings,
            }]),
      unique_query_count: artifact.records.length,
      api_calls: artifact.summary.apiCalls,
      cache_hits: 0,
      elapsed_ms: 0,
    },
  };
}

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function readWalsinPriceSnapshot(
  file: string,
): Promise<WalsinPriceSnapshotArtifactType> {
  const bytes = await readFile(file);
  const jsonBytes = path.extname(file).toLowerCase() === '.gz'
    ? gunzipSync(bytes)
    : bytes;
  const raw: unknown = JSON.parse(jsonBytes.toString('utf8'));
  return WalsinPriceSnapshotArtifact.parse(raw);
}

export async function readVerifiedWalsinPriceSnapshot(
  file: string,
  manifestFile = path.join(path.dirname(file), 'manifest.json'),
): Promise<{
  artifact: WalsinPriceSnapshotArtifactType;
  manifest: WalsinPriceSnapshotManifestType;
}> {
  const bytes = await readFile(file);
  const artifact = await readWalsinPriceSnapshot(file);
  const manifestRaw: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
  const manifest = WalsinPriceSnapshotManifest.parse(manifestRaw);
  if (manifest.snapshotFile !== path.basename(file)) {
    throw new Error('가격 스냅샷 manifest의 파일명이 실제 파일과 다릅니다');
  }
  if (manifest.snapshotBytes !== bytes.byteLength) {
    throw new Error('가격 스냅샷 manifest의 바이트 수가 실제 파일과 다릅니다');
  }
  if (manifest.snapshotSha256 !== sha256(bytes)) {
    throw new Error('가격 스냅샷 manifest의 SHA-256이 실제 파일과 다릅니다');
  }
  if (manifest.generatedAt !== artifact.generatedAt) {
    throw new Error('가격 스냅샷 manifest의 생성 시각이 실제 파일과 다릅니다');
  }
  if (manifest.sourceFile !== artifact.source.file) {
    throw new Error('가격 스냅샷 manifest의 원본 파일명이 실제 파일과 다릅니다');
  }
  if (JSON.stringify(manifest.summary) !== JSON.stringify(artifact.summary)) {
    throw new Error('가격 스냅샷 manifest의 summary가 실제 파일과 다릅니다');
  }
  return { artifact, manifest };
}
