import { z } from 'zod';
import { normalizeMpn } from '@sp/utils';
import { resolveManufacturer } from './manufacturer-alias';

const CatalogPriceBreak = z.object({
  quantity: z.number().int().positive(),
  unit_price: z.number().positive(),
  currency: z.string(),
});

const CatalogOffer = z
  .object({
    supplier: z.string().min(1).max(32),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nonnegative().nullish(),
    moq: z.number().int().positive().nullish(),
    order_multiple: z.number().int().positive().nullish(),
    price_breaks: z.array(CatalogPriceBreak).default([]),
    lead_time: z.string().nullish(),
    product_url: z.string().url().nullish(),
    fetched_at: z.string().min(1),
  })
  .passthrough();

const CatalogMetadata = z
  .object({
    sourceDataset: z.string().min(1),
    sourceRecordIds: z.array(z.number().int().positive()).min(1),
    seriesIds: z.array(z.number().int().positive()).min(1),
    imageStatus: z.string().min(1),
    catalogOnly: z.literal(true),
    generatedMpn: z.boolean(),
    commercialDataAvailable: z.boolean(),
  })
  .passthrough();

const CatalogProduct = z
  .object({
    supplier: z.string().min(1).max(32),
    manufacturer_part_number: z.string().min(1).max(191),
    manufacturer: z.string().min(1).max(191),
    description: z.string().nullish(),
    category: z.string().nullish(),
    package: z.string().nullish(),
    lifecycle_status: z.string().nullish(),
    datasheet_url: z.string().url().nullish(),
    image_url: z.string().url().nullish(),
    normalized_specs: z.record(z.string(), z.unknown()).default({}),
    catalog_metadata: CatalogMetadata,
    offers: z.array(CatalogOffer).min(1),
  })
  .passthrough();

const CatalogArtifact = z
  .object({
    schemaVersion: z.enum([
      'sp-parts-catalog-ingest-envelope/v1',
      'sp-parts-catalog-ingest-envelope/v2',
    ]),
    source: z
      .object({
        file: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/i),
        basisDate: z.string().min(1),
      })
      .passthrough(),
    analysis: z
      .object({
        outputUniqueParts: z.number().int().positive(),
        conflictingDuplicateGroups: z.array(z.unknown()).default([]),
      })
      .passthrough(),
    search: z
      .object({
        components: z
          .array(
            z
              .object({
                candidates: z.array(z.object({ product: CatalogProduct }).passthrough()),
              })
              .passthrough(),
          )
          .min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type CatalogProductType = z.infer<typeof CatalogProduct>;
export type CatalogOfferType = z.infer<typeof CatalogOffer>;

export interface CatalogOfferIdentity {
  supplier: string;
  supplierSku: string;
}

export interface CatalogMigrationRecord {
  key: string;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
  product: CatalogProductType;
  offers: CatalogOfferIdentity[];
}

export interface ParsedCatalogMigration {
  artifact: z.infer<typeof CatalogArtifact>;
  records: CatalogMigrationRecord[];
  sourceFile: string;
  sourceSha256: string;
}

export interface CatalogSourceProvenance {
  supplier: string;
  sourceDataset: string;
  sourceSha256: string;
}

function recordKey(mpnNorm: string, manufacturerNorm: string): string {
  return `${manufacturerNorm}:${mpnNorm}`;
}

function unknownObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** rawJson에 명시된 catalog-only 원천만 반환한다. 가격 오퍼나 추정 데이터는 제거 대상이 아니다. */
export function catalogSourceProvenance(rawJson: unknown): CatalogSourceProvenance | null {
  const product = unknownObject(rawJson);
  const metadata = unknownObject(product?.catalog_metadata);
  const supplier = product?.supplier;
  const sourceDataset = metadata?.sourceDataset;
  const sourceSha256 = metadata?.sourceDatasetSha256;
  if (
    typeof supplier !== 'string'
    || typeof sourceDataset !== 'string'
    || typeof sourceSha256 !== 'string'
    || metadata?.catalogOnly !== true
    || !/^[0-9a-f]{64}$/i.test(sourceSha256)
  ) return null;
  return {
    supplier,
    sourceDataset,
    sourceSha256: sourceSha256.toLowerCase(),
  };
}

/** supplier와 원본 해시가 모두 일치하는 카탈로그 오퍼에만 파괴 작업을 허용한다. */
export function isCatalogOfferFromSource(
  rawJson: unknown,
  supplier: string,
  sourceSha256: string,
): boolean {
  const provenance = catalogSourceProvenance(rawJson);
  return provenance !== null
    && provenance.supplier === supplier
    && provenance.sourceSha256 === sourceSha256.toLowerCase();
}

function validateCatalogProduct(product: CatalogProductType): void {
  const metadata = product.catalog_metadata;
  if (!metadata.commercialDataAvailable) {
    const commercialOffer = product.offers.find(
      (offer) => (offer.stock !== null && offer.stock !== undefined) || offer.price_breaks.length > 0,
    );
    if (commercialOffer !== undefined) {
      throw new Error(
        `commercialDataAvailable=false인데 가격·재고가 존재합니다: ${product.manufacturer_part_number}`,
      );
    }
  }
  if (metadata.imageStatus !== '수집완료' && product.image_url !== null && product.image_url !== undefined) {
    throw new Error(
      `확인되지 않은 이미지가 정본 image_url에 들어 있습니다: ${product.manufacturer_part_number}`,
    );
  }
  const offerKeys = new Set<string>();
  for (const offer of product.offers) {
    if (!Number.isFinite(new Date(offer.fetched_at).getTime())) {
      throw new Error(`잘못된 fetched_at: ${product.manufacturer_part_number}`);
    }
    const sku = offer.supplier_sku ?? '';
    if (sku.length > 191) {
      throw new Error(`supplier_sku 길이가 DB 제한을 넘습니다: ${product.manufacturer_part_number}`);
    }
    const key = `${offer.supplier}:${sku}`;
    if (offerKeys.has(key)) throw new Error(`상품 안에서 오퍼 키가 중복됩니다: ${product.manufacturer_part_number}/${key}`);
    offerKeys.add(key);
  }
}

/** 카탈로그 결과 파일을 실제 인제스트보다 엄격하게 검증하고 DB upsert 키로 평탄화한다. */
export function parseCatalogMigrationEnvelope(input: unknown): ParsedCatalogMigration {
  const artifact = CatalogArtifact.parse(input);
  if (artifact.analysis.conflictingDuplicateGroups.length > 0) {
    throw new Error('conflictingDuplicateGroups가 남아 있어 마이그레이션할 수 없습니다');
  }

  const products = artifact.search.components.flatMap((component) =>
    component.candidates.map((candidate) => candidate.product),
  );
  if (products.length !== artifact.analysis.outputUniqueParts) {
    throw new Error(
      `분석 수량과 후보 수량이 다릅니다: ${String(artifact.analysis.outputUniqueParts)} != ${String(products.length)}`,
    );
  }

  const seen = new Set<string>();
  const records = products.map((product): CatalogMigrationRecord => {
    validateCatalogProduct(product);
    const mpnNorm = normalizeMpn(product.manufacturer_part_number);
    if (mpnNorm === '') throw new Error(`MPN 정규화 결과가 비었습니다: ${product.manufacturer_part_number}`);
    const manufacturer = resolveManufacturer(product.manufacturer);
    if (manufacturer.norm === 'unknown') {
      throw new Error(`제조사를 정규화할 수 없습니다: ${product.manufacturer_part_number}`);
    }
    const key = recordKey(mpnNorm, manufacturer.norm);
    if (seen.has(key)) throw new Error(`DB upsert 키가 중복됩니다: ${key}`);
    seen.add(key);
    return {
      key,
      mpn: product.manufacturer_part_number,
      mpnNorm,
      manufacturerName: manufacturer.name,
      manufacturerNorm: manufacturer.norm,
      product,
      offers: product.offers.map((offer) => ({
        supplier: offer.supplier,
        supplierSku: offer.supplier_sku ?? '',
      })),
    };
  });

  return {
    artifact,
    records,
    sourceFile: artifact.source.file,
    sourceSha256: artifact.source.sha256.toLowerCase(),
  };
}

/** 카테고리마다 MPN 오름차순 첫 항목을 실제 검색 검증 표본으로 선택한다. */
export function catalogSearchSamples(records: CatalogMigrationRecord[]): CatalogMigrationRecord[] {
  const byCategory = new Map<string, CatalogMigrationRecord[]>();
  for (const record of records) {
    const normalizedCategory = record.product.category?.trim();
    const category = normalizedCategory === undefined || normalizedCategory === ''
      ? '(uncategorized)'
      : normalizedCategory;
    const values = byCategory.get(category) ?? [];
    values.push(record);
    byCategory.set(category, values);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, values]) => {
      const first = [...values].sort((a, b) => a.mpn.localeCompare(b.mpn, undefined, { numeric: true }))[0];
      if (first === undefined) throw new Error('빈 카테고리 그룹');
      return first;
    });
}
