import { createHash } from 'node:crypto';
import { normalizeMpn } from '@sp/utils';
import { z } from 'zod';
import {
  CatalogPriceSnapshotProduct,
  type CatalogPriceSnapshotProductType,
  type CatalogPriceSnapshotTarget,
} from './catalog-price-snapshot';
import { resolveManufacturer } from './manufacturer-alias';

export const CATALOG_MARKET_PRICE_CAPTURE_VERSION =
  'catalog-market-price-capture/v1' as const;
export const CATALOG_MARKET_PRICE_MANIFEST_VERSION =
  'catalog-market-price-capture-manifest/v1' as const;
export const MARKET_PRICE_SITES = ['eleparts', 'icbanq'] as const;

export type MarketPriceSite = typeof MARKET_PRICE_SITES[number];

export const CatalogMarketPriceObservation = z.object({
  site: z.enum(MARKET_PRICE_SITES),
  targetKey: z.string().min(1),
  supplierSku: z.string().min(1),
  productUrl: z.string().url(),
  manufacturerName: z.string().min(1),
  manufacturerNorm: z.string().min(1),
  mpn: z.string().min(1),
  mpnNorm: z.string().min(1),
  unitPriceKrw: z.number().positive(),
  sourceLabel: z.string().nullish(),
  fetchedAt: z.string().datetime(),
  searchResponseSha256: z.string().regex(/^[0-9a-f]{64}$/),
  detailResponseSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
});

export type CatalogMarketPriceObservationType = z.infer<
  typeof CatalogMarketPriceObservation
>;

export const CatalogMarketPriceRecord = z.object({
  site: z.enum(MARKET_PRICE_SITES),
  key: z.string().min(1),
  mpn: z.string().min(1),
  mpnNorm: z.string().min(1),
  manufacturerName: z.string().min(1),
  manufacturerNorm: z.string().min(1),
  status: z.enum([
    'priced',
    'found_without_price',
    'manufacturer_conflict',
    'not_found',
    'error',
  ]),
  observations: z.array(CatalogMarketPriceObservation),
  warnings: z.array(z.string()),
  requestCount: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
  error: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type CatalogMarketPriceRecordType = z.infer<
  typeof CatalogMarketPriceRecord
>;

const CatalogMarketPriceSummary = z.object({
  targets: z.number().int().positive(),
  priced: z.number().int().nonnegative(),
  foundWithoutPrice: z.number().int().nonnegative(),
  manufacturerConflict: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  observations: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  manufacturerCounts: z.record(
    z.string(),
    z.object({
      targets: z.number().int().nonnegative(),
      priced: z.number().int().nonnegative(),
      observations: z.number().int().nonnegative(),
    }),
  ),
});

export type CatalogMarketPriceSummaryType = z.infer<
  typeof CatalogMarketPriceSummary
>;

export const CatalogMarketPriceCapture = z.object({
  schemaVersion: z.literal(CATALOG_MARKET_PRICE_CAPTURE_VERSION),
  site: z.enum(MARKET_PRICE_SITES),
  generatedAt: z.string().datetime(),
  source: z.object({
    file: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  summary: CatalogMarketPriceSummary,
  records: z.array(CatalogMarketPriceRecord),
});

export type CatalogMarketPriceCaptureType = z.infer<
  typeof CatalogMarketPriceCapture
>;

export const CatalogMarketPriceManifest = z.object({
  schemaVersion: z.literal(CATALOG_MARKET_PRICE_MANIFEST_VERSION),
  site: z.enum(MARKET_PRICE_SITES),
  generatedAt: z.string().datetime(),
  sourceFile: z.string().min(1),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  captureFile: z.string().min(1),
  captureSha256: z.string().regex(/^[0-9a-f]{64}$/),
  captureBytes: z.number().int().positive(),
  summary: CatalogMarketPriceSummary,
});

export type CatalogMarketPriceManifestType = z.infer<
  typeof CatalogMarketPriceManifest
>;

export interface IcbanqMarketCandidate {
  prodCode: string;
  mpn: string;
  mpnNorm: string;
  sourceLabel: string | null;
  unitPriceNetKrw: number;
  productUrl: string;
}

function responseSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll(',', '').trim();
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .trim();
}

function canonicalObservations(
  observations: readonly CatalogMarketPriceObservationType[],
): CatalogMarketPriceObservationType[] {
  const values = new Map<string, CatalogMarketPriceObservationType>();
  for (const observation of observations) {
    const parsed = CatalogMarketPriceObservation.parse(observation);
    const key = `${parsed.site}\0${parsed.supplierSku}`;
    const current = values.get(key);
    if (
      current === undefined
      || parsed.unitPriceKrw < current.unitPriceKrw
      || (
        parsed.unitPriceKrw === current.unitPriceKrw
        && parsed.fetchedAt > current.fetchedAt
      )
    ) {
      values.set(key, parsed);
    }
  }
  // 한 판매처 안의 upstream 공급사·상품 SKU를 각각 DB 구매 조건으로 만들지 않는다.
  // 사이트가 실제 판매 주체이므로 부가세 포함 대표가격 최저 → SKU 순으로
  // 하나만 남겨 부품당 eleparts/icbanq 구매 조건이 최대 한 개가 되게 한다.
  return [...values.values()]
    .sort((a, b) =>
      a.unitPriceKrw - b.unitPriceKrw
      || a.supplierSku.localeCompare(b.supplierSku))
    .slice(0, 1);
}

export function canonicalCatalogMarketPriceRecord(
  recordValue: CatalogMarketPriceRecordType,
): CatalogMarketPriceRecordType {
  const record = CatalogMarketPriceRecord.parse(recordValue);
  const observations = canonicalObservations(record.observations);
  return CatalogMarketPriceRecord.parse({
    ...record,
    status: observations.length > 0 ? 'priced' : record.status,
    observations,
  });
}

function recordStatus(
  observations: readonly CatalogMarketPriceObservationType[],
  exactProducts: number,
  manufacturerConflicts: number,
): CatalogMarketPriceRecordType['status'] {
  if (observations.length > 0) return 'priced';
  if (exactProducts > 0) return 'found_without_price';
  return manufacturerConflicts > 0 ? 'manufacturer_conflict' : 'not_found';
}

interface ElepartsProductSeed {
  manufacturer: string;
  mpn: string;
  block: string;
}

function elepartsProductSeeds(listHtml: string): ElepartsProductSeed[] {
  const goodsMatches = [...listHtml.matchAll(/\/goods\/view\?no=(\d+)/gu)];
  const blocks: { start: number; end: number }[] = [];
  let previous = '';
  for (const match of goodsMatches) {
    const goodsSeq = match[1] ?? '';
    const start = match.index;
    if (goodsSeq === previous) continue;
    const prior = blocks.at(-1);
    if (prior !== undefined) prior.end = start;
    blocks.push({ start, end: listHtml.length });
    previous = goodsSeq;
  }
  const result: ElepartsProductSeed[] = [];
  for (const range of blocks) {
    const block = listHtml.slice(range.start, range.end);
    const identity =
      /<span class="cate">\[([^\]]+)\]<\/span>\s*([^\s<]+)/iu.exec(block);
    if (identity === null) continue;
    result.push({
      manufacturer: decodeHtml(identity[1] ?? ''),
      mpn: decodeHtml(identity[2] ?? ''),
      block,
    });
  }
  return result;
}

function elepartsSupplierLabel(block: string): string | null {
  for (const match of block.matchAll(/ico ico--([a-z][a-z0-9]+)\b/giu)) {
    const value = match[1];
    if (value !== undefined && value !== 'nocancel') return value;
  }
  return null;
}

export function parseElepartsMarketResponse(
  target: CatalogPriceSnapshotTarget,
  payload: string,
  fetchedAt = new Date().toISOString(),
  attempts = 1,
): CatalogMarketPriceRecordType {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    throw new Error('eleparts 응답을 JSON으로 해석할 수 없습니다');
  }
  const raw = unknownRecord(parsedPayload);
  if (raw === null || typeof raw.list !== 'string') {
    throw new Error('eleparts 응답의 list가 문자열이 아닙니다');
  }
  const searchResponseSha256 = responseSha256(payload);
  const observations: CatalogMarketPriceObservationType[] = [];
  let exactProducts = 0;
  let manufacturerConflicts = 0;
  for (const seed of elepartsProductSeeds(raw.list)) {
    const mpnNorm = normalizeMpn(seed.mpn);
    if (mpnNorm !== target.mpnNorm) continue;
    const manufacturer = resolveManufacturer(seed.manufacturer);
    if (manufacturer.norm !== target.manufacturerNorm) {
      manufacturerConflicts += 1;
      continue;
    }
    exactProducts += 1;
    const goodsSeq =
      /\/goods\/view\?no=(\d+)/u.exec(seed.block)?.[1]
      ?? /goods_seq="(\d+)"/u.exec(seed.block)?.[1]
      ?? null;
    const unitPriceKrw = finiteNumber(
      /salep-val="([\d.,]+)"/u.exec(seed.block)?.[1],
    );
    if (
      goodsSeq === null
      || unitPriceKrw === null
      || unitPriceKrw <= 0
    ) continue;
    observations.push(CatalogMarketPriceObservation.parse({
      site: 'eleparts',
      targetKey: target.key,
      supplierSku: goodsSeq,
      productUrl: `https://www.eleparts.co.kr/goods/view?no=${goodsSeq}`,
      manufacturerName: target.manufacturerName,
      manufacturerNorm: target.manufacturerNorm,
      mpn: target.mpn,
      mpnNorm: target.mpnNorm,
      unitPriceKrw,
      sourceLabel: elepartsSupplierLabel(seed.block),
      fetchedAt,
      searchResponseSha256,
      detailResponseSha256: null,
    }));
  }
  const canonical = canonicalObservations(observations);
  return canonicalCatalogMarketPriceRecord(CatalogMarketPriceRecord.parse({
    site: 'eleparts',
    ...target,
    status: recordStatus(canonical, exactProducts, manufacturerConflicts),
    observations: canonical,
    warnings: [],
    requestCount: 1,
    attempts,
    error: null,
    updatedAt: fetchedAt,
  }));
}

export function parseIcbanqMarketCandidates(
  target: CatalogPriceSnapshotTarget,
  payload: string,
): IcbanqMarketCandidate[] {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    throw new Error('아이씨뱅큐 응답을 JSON으로 해석할 수 없습니다');
  }
  const raw = unknownRecord(parsedPayload);
  if (raw === null || !Array.isArray(raw.resultList)) {
    throw new Error('아이씨뱅큐 응답의 resultList가 배열이 아닙니다');
  }
  const candidates = new Map<string, IcbanqMarketCandidate>();
  for (const value of raw.resultList) {
    const row = unknownRecord(value);
    if (row === null) continue;
    const mpn = stringValue(row.prod_name);
    const prodCode = stringValue(row.prod_code);
    const price = finiteNumber(
      row.dmall_prices ?? row.prod_priceS ?? row.prod_priceD,
    );
    if (
      mpn === null
      || normalizeMpn(mpn) !== target.mpnNorm
      || prodCode === null
      || price === null
      || price <= 0
    ) continue;
    const candidate: IcbanqMarketCandidate = {
      prodCode,
      mpn,
      mpnNorm: target.mpnNorm,
      sourceLabel: stringValue(row.prod_location),
      unitPriceNetKrw: price,
      productUrl: `https://www.icbanq.com/${prodCode}`,
    };
    const current = candidates.get(prodCode);
    if (
      current === undefined
      || candidate.unitPriceNetKrw < current.unitPriceNetKrw
    ) {
      candidates.set(prodCode, candidate);
    }
  }
  return [...candidates.values()].sort((a, b) =>
    a.unitPriceNetKrw - b.unitPriceNetKrw
    || a.prodCode.localeCompare(b.prodCode));
}

function hiddenInput(html: string, name: string): string | null {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `<input[^>]+name=["']${escaped}["'][^>]+value=["']([^"']*)["'][^>]*>`,
    'iu',
  ).exec(html)
    ?? new RegExp(
      `<input[^>]+value=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`,
      'iu',
    ).exec(html);
  return match === null ? null : decodeHtml(match[1] ?? '');
}

export function parseIcbanqMarketDetail(
  target: CatalogPriceSnapshotTarget,
  candidate: IcbanqMarketCandidate,
  searchPayload: string,
  detailHtml: string,
  fetchedAt = new Date().toISOString(),
): {
  observation: CatalogMarketPriceObservationType | null;
  manufacturerConflict: boolean;
} {
  const mpn = hiddenInput(detailHtml, 'prod_name');
  const manufacturerName = hiddenInput(detailHtml, 'prod_mfg');
  const grossPrice = finiteNumber(
    /id=["']Tax_Sales_Price["'][^>]*>\s*([\d,.]+)\s*원/iu.exec(
      detailHtml,
    )?.[1],
  );
  if (mpn === null || manufacturerName === null) {
    throw new Error(`아이씨뱅큐 상세 identity가 없습니다: ${candidate.prodCode}`);
  }
  const exactMpn = normalizeMpn(mpn) === target.mpnNorm;
  const manufacturer = resolveManufacturer(manufacturerName);
  const exactManufacturer = manufacturer.norm === target.manufacturerNorm;
  if (!exactMpn || !exactManufacturer) {
    return {
      observation: null,
      manufacturerConflict: exactMpn && !exactManufacturer,
    };
  }
  if (grossPrice === null || grossPrice <= 0) {
    return { observation: null, manufacturerConflict: false };
  }
  return {
    observation: CatalogMarketPriceObservation.parse({
      site: 'icbanq',
      targetKey: target.key,
      supplierSku: candidate.prodCode,
      productUrl: candidate.productUrl,
      manufacturerName: target.manufacturerName,
      manufacturerNorm: target.manufacturerNorm,
      mpn: target.mpn,
      mpnNorm: target.mpnNorm,
      unitPriceKrw: grossPrice,
      sourceLabel: candidate.sourceLabel,
      fetchedAt,
      searchResponseSha256: responseSha256(searchPayload),
      detailResponseSha256: responseSha256(detailHtml),
    }),
    manufacturerConflict: false,
  };
}

export function buildIcbanqMarketRecord(
  target: CatalogPriceSnapshotTarget,
  observations: readonly CatalogMarketPriceObservationType[],
  candidateCount: number,
  manufacturerConflicts: number,
  requestCount: number,
  updatedAt = new Date().toISOString(),
  attempts = 1,
): CatalogMarketPriceRecordType {
  const canonical = canonicalObservations(observations);
  return canonicalCatalogMarketPriceRecord(CatalogMarketPriceRecord.parse({
    site: 'icbanq',
    ...target,
    status: recordStatus(
      canonical,
      candidateCount > 0 && manufacturerConflicts < candidateCount ? 1 : 0,
      manufacturerConflicts,
    ),
    observations: canonical,
    warnings: [],
    requestCount,
    attempts,
    error: null,
    updatedAt,
  }));
}

export function summarizeCatalogMarketPriceRecords(
  records: readonly CatalogMarketPriceRecordType[],
): CatalogMarketPriceSummaryType {
  const manufacturerCounts: CatalogMarketPriceSummaryType['manufacturerCounts'] = {};
  for (const record of records) {
    const current = manufacturerCounts[record.manufacturerNorm] ?? {
      targets: 0,
      priced: 0,
      observations: 0,
    };
    current.targets += 1;
    if (record.status === 'priced') current.priced += 1;
    current.observations += record.observations.length;
    manufacturerCounts[record.manufacturerNorm] = current;
  }
  return CatalogMarketPriceSummary.parse({
    targets: records.length,
    priced: records.filter((record) => record.status === 'priced').length,
    foundWithoutPrice: records.filter(
      (record) => record.status === 'found_without_price',
    ).length,
    manufacturerConflict: records.filter(
      (record) => record.status === 'manufacturer_conflict',
    ).length,
    notFound: records.filter((record) => record.status === 'not_found').length,
    errors: records.filter((record) => record.status === 'error').length,
    observations: records.reduce(
      (total, record) => total + record.observations.length,
      0,
    ),
    requests: records.reduce(
      (total, record) => total + record.requestCount,
      0,
    ),
    manufacturerCounts: Object.fromEntries(
      Object.entries(manufacturerCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

export function marketObservationToSnapshotProduct(
  observation: CatalogMarketPriceObservationType,
): CatalogPriceSnapshotProductType {
  return CatalogPriceSnapshotProduct.parse({
    supplier: observation.site,
    manufacturer_part_number: observation.mpn,
    manufacturer: observation.manufacturerName,
    description: null,
    category: null,
    package: null,
    lifecycle_status: null,
    datasheet_url: null,
    image_url: null,
    normalized_specs: {},
    offers: [{
      supplier: observation.site,
      supplier_sku: observation.supplierSku,
      packaging: null,
      stock: null,
      moq: null,
      order_multiple: null,
      price_breaks: [{
        quantity: 1,
        unit_price: observation.unitPriceKrw,
        currency: 'KRW',
      }],
      lead_time: null,
      product_url: observation.productUrl,
      fetched_at: observation.fetchedAt,
      marketPriceEvidence: {
        sourceLabel: observation.sourceLabel,
        searchResponseSha256: observation.searchResponseSha256,
        detailResponseSha256: observation.detailResponseSha256,
        priceIncludesVat: true,
      },
    }],
  });
}
