import {
  CatalogPriceSnapshotArtifact,
  CatalogPriceSnapshotManifest,
  CatalogPriceSnapshotProduct,
  CatalogPriceSnapshotRecord,
  WALSIN_PRICE_SNAPSHOT_DEFINITION,
  WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION,
  WALSIN_PRICE_SNAPSHOT_VERSION,
  buildCatalogPriceSnapshotArtifact,
  catalogPriceSnapshotEnvelopeApiCalls,
  catalogPriceSnapshotIngestEnvelope,
  catalogSnapshotBlockingErrors,
  catalogSnapshotSupplierErrors,
  exactCatalogPriceSnapshotRecord,
  readCatalogPriceSnapshot,
  readVerifiedCatalogPriceSnapshot,
  sha256,
  summarizeCatalogPriceSnapshotRecords,
  validateCatalogPriceSnapshotCoverage,
  type CatalogPriceSnapshotArtifactType,
  type CatalogPriceSnapshotManifestType,
  type CatalogPriceSnapshotProductType,
  type CatalogPriceSnapshotRecordType,
  type CatalogPriceSnapshotSummary,
  type CatalogPriceSnapshotTarget,
} from './catalog-price-snapshot';
import type { CatalogMigrationRecord } from './parts-catalog-migration';

// 기존 Walsin v1 import와 산출물 형식을 보존하는 호환 계층이다. 신규 원본은
// catalog-price-snapshot의 공통 구현과 각 원본 definition을 직접 사용한다.
export {
  WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION,
  WALSIN_PRICE_SNAPSHOT_VERSION,
  sha256,
};

export const WalsinPriceSnapshotProduct = CatalogPriceSnapshotProduct;
export const WalsinPriceSnapshotRecord = CatalogPriceSnapshotRecord;
export const WalsinPriceSnapshotArtifact = CatalogPriceSnapshotArtifact;
export const WalsinPriceSnapshotManifest = CatalogPriceSnapshotManifest;

export type WalsinPriceSnapshotProductType = CatalogPriceSnapshotProductType;
export type WalsinPriceSnapshotRecordType = CatalogPriceSnapshotRecordType;
export type WalsinPriceSnapshotArtifactType = CatalogPriceSnapshotArtifactType;
export type WalsinPriceSnapshotManifestType = CatalogPriceSnapshotManifestType;
export type WalsinPriceSnapshotSummary = CatalogPriceSnapshotSummary;
export type WalsinPriceSnapshotTarget = CatalogPriceSnapshotTarget;

export const exactWalsinPriceSnapshotRecord =
  exactCatalogPriceSnapshotRecord;
export const walsinPriceSnapshotEnvelopeApiCalls =
  catalogPriceSnapshotEnvelopeApiCalls;
export const summarizeWalsinPriceSnapshotRecords =
  summarizeCatalogPriceSnapshotRecords;
export const walsinSnapshotSupplierErrors =
  catalogSnapshotSupplierErrors;
export const walsinSnapshotBlockingErrors =
  catalogSnapshotBlockingErrors;

export function validateWalsinPriceSnapshotCoverage(
  artifact: unknown,
  records: CatalogMigrationRecord[],
): WalsinPriceSnapshotArtifactType {
  return validateCatalogPriceSnapshotCoverage(
    artifact,
    records,
    WALSIN_PRICE_SNAPSHOT_DEFINITION,
  );
}

export function buildWalsinPriceSnapshotArtifact(
  sourceFile: string,
  records: WalsinPriceSnapshotRecordType[],
  generatedAt = new Date().toISOString(),
): WalsinPriceSnapshotArtifactType {
  return buildCatalogPriceSnapshotArtifact(
    WALSIN_PRICE_SNAPSHOT_DEFINITION,
    sourceFile,
    records,
    generatedAt,
  );
}

export function walsinPriceSnapshotIngestEnvelope(
  artifact: unknown,
): unknown {
  return catalogPriceSnapshotIngestEnvelope(
    artifact,
    WALSIN_PRICE_SNAPSHOT_DEFINITION,
  );
}

export async function readWalsinPriceSnapshot(
  file: string,
): Promise<WalsinPriceSnapshotArtifactType> {
  return readCatalogPriceSnapshot(file, WALSIN_PRICE_SNAPSHOT_DEFINITION);
}

export async function readVerifiedWalsinPriceSnapshot(
  file: string,
  manifestFile?: string,
): Promise<{
  artifact: WalsinPriceSnapshotArtifactType;
  manifest: WalsinPriceSnapshotManifestType;
}> {
  return manifestFile === undefined
    ? readVerifiedCatalogPriceSnapshot(
        file,
        WALSIN_PRICE_SNAPSHOT_DEFINITION,
      )
    : readVerifiedCatalogPriceSnapshot(
        file,
        WALSIN_PRICE_SNAPSHOT_DEFINITION,
        manifestFile,
      );
}
