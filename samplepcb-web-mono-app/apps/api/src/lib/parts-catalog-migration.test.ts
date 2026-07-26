import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveManufacturer } from './manufacturer-alias';
import {
  catalogSearchSamples,
  catalogSourceProvenance,
  isCatalogOfferFromSource,
  parseCatalogMigrationEnvelope,
} from './parts-catalog-migration';
import {
  buildYeonhoCatalogEnvelope,
  YEONHO_REV2_SOURCE_SHA256,
  YEONHO_RETIRED_SOURCE_SHA256,
} from './yeonho-catalog-workbook';

const catalogFile = fileURLToPath(
  new URL(
    '../../catalog-migrations/yeonho-connectors-2026-07-17/연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
    import.meta.url,
  ),
);
let loadedArtifact: unknown;

function catalogArtifact(): unknown {
  if (loadedArtifact === undefined) throw new Error('워크북 테스트 픽스처가 로드되지 않았습니다');
  return loadedArtifact;
}

function mutableArtifact(): Record<string, unknown> {
  return structuredClone(catalogArtifact()) as Record<string, unknown>;
}

function components(artifact: Record<string, unknown>): Record<string, unknown>[] {
  const search = artifact.search as Record<string, unknown>;
  return search.components as Record<string, unknown>[];
}

function candidates(component: Record<string, unknown>): Record<string, unknown>[] {
  return component.candidates as Record<string, unknown>[];
}

function product(candidate: Record<string, unknown>): Record<string, unknown> {
  return candidate.product as Record<string, unknown>;
}

describe('parts catalog migration artifact', () => {
  beforeAll(async () => {
    loadedArtifact = (await buildYeonhoCatalogEnvelope(catalogFile)).envelope;
  });

  it('연호 Rev2 공식품번 1,606건을 DB upsert 키로 유일하게 해석한다', () => {
    const parsed = parseCatalogMigrationEnvelope(catalogArtifact());
    expect(parsed.records).toHaveLength(1_606);
    expect(new Set(parsed.records.map((record) => record.key)).size).toBe(1_606);
    expect(parsed.records.every((record) => record.manufacturerNorm === 'yeonho')).toBe(true);
    expect(parsed.records.flatMap((record) => record.offers)).toHaveLength(1_606);
    expect(parsed.sourceSha256).toBe(YEONHO_REV2_SOURCE_SHA256);
    expect(parsed.records.filter((record) => record.product.catalog_metadata.generatedMpn)).toHaveLength(367);
  });

  it('검색 표본을 6개 카테고리에서 하나씩 고른다', () => {
    const parsed = parseCatalogMigrationEnvelope(catalogArtifact());
    const samples = catalogSearchSamples(parsed.records);
    expect(samples.map((record) => record.product.category)).toEqual([
      'Board to Board',
      'FFC/BOARD',
      'FFC/FPC',
      'I/O Connector',
      'Wire to Board',
      'Wire to Wire',
    ]);
  });

  it('12505 가상 품번은 제외하고 승인도 공식 품번을 보존한다', () => {
    const mpns = new Set(parseCatalogMigrationEnvelope(catalogArtifact()).records.map((record) => record.mpnNorm));
    expect(mpns.has('1250508')).toBe(false);
    for (const expected of ['12505WS08', '12505HS08', '12505WR08', '12505TS1']) {
      expect(mpns.has(expected)).toBe(true);
    }
  });

  it('핀 수가 없는 terminal·connector 32건도 선택 필드로 안전하게 보존한다', () => {
    const parsed = parseCatalogMigrationEnvelope(catalogArtifact());
    const withoutPins = parsed.records.filter(
      (record) => record.product.normalized_specs.pin_count === undefined,
    );
    expect(withoutPins).toHaveLength(32);
    expect(new Set(withoutPins.map(
      (record) => record.product.normalized_specs.connector_component_type,
    ))).toEqual(new Set(['Terminal', 'Connector']));
  });

  it('한글 연호 제조사 표기도 동일 upsert 키로 정규화한다', () => {
    expect(resolveManufacturer('YEONHO ELECTRONICS').norm).toBe('yeonho');
    expect(resolveManufacturer('연호전자').norm).toBe('yeonho');
    expect(resolveManufacturer('연호').norm).toBe('yeonho');
  });

  it('분석 수량과 실제 후보 수량이 다르면 거부한다', () => {
    const artifact = mutableArtifact();
    const analysis = artifact.analysis as Record<string, unknown>;
    analysis.outputUniqueParts = 1_605;
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('분석 수량과 후보 수량');
  });

  it('동일 DB upsert 키가 둘 이상이면 거부한다', () => {
    const artifact = mutableArtifact();
    const firstComponent = components(artifact)[0];
    if (firstComponent === undefined) throw new Error('테스트 픽스처에 component가 없습니다');
    const values = candidates(firstComponent);
    const first = values[0];
    if (first === undefined) throw new Error('테스트 픽스처에 candidate가 없습니다');
    values.push(structuredClone(first));
    const analysis = artifact.analysis as Record<string, unknown>;
    analysis.outputUniqueParts = 1_607;
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('DB upsert 키가 중복');
  });

  it('확인되지 않은 이미지를 정본으로 승격한 파일을 거부한다', () => {
    const artifact = mutableArtifact();
    const candidate = components(artifact).flatMap(candidates)[0];
    if (candidate === undefined) throw new Error('이미지 확인 필요 픽스처가 없습니다');
    const metadata = product(candidate).catalog_metadata as Record<string, unknown>;
    metadata.imageStatus = '확인필요';
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('확인되지 않은 이미지');
  });

  it('상업 데이터가 없다는 표식과 재고가 충돌하면 거부한다', () => {
    const artifact = mutableArtifact();
    const firstComponent = components(artifact)[0];
    const firstCandidate = firstComponent === undefined ? undefined : candidates(firstComponent)[0];
    if (firstCandidate === undefined) throw new Error('테스트 픽스처에 candidate가 없습니다');
    const offers = product(firstCandidate).offers as Record<string, unknown>[];
    const firstOffer = offers[0];
    if (firstOffer === undefined) throw new Error('테스트 픽스처에 offer가 없습니다');
    firstOffer.stock = 10;
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('가격·재고가 존재');
  });

  it('같은 상품 안의 공급사 오퍼 키 중복을 거부한다', () => {
    const artifact = mutableArtifact();
    const firstComponent = components(artifact)[0];
    const firstCandidate = firstComponent === undefined ? undefined : candidates(firstComponent)[0];
    if (firstCandidate === undefined) throw new Error('테스트 픽스처에 candidate가 없습니다');
    const offers = product(firstCandidate).offers as Record<string, unknown>[];
    const firstOffer = offers[0];
    if (firstOffer === undefined) throw new Error('테스트 픽스처에 offer가 없습니다');
    offers.push(structuredClone(firstOffer));
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('오퍼 키가 중복');
  });

  it('catalog-only supplier와 source hash가 모두 맞을 때만 제거 대상으로 판정한다', () => {
    const parsed = parseCatalogMigrationEnvelope(catalogArtifact());
    const raw = parsed.records[0]?.product;
    if (raw === undefined) throw new Error('테스트 픽스처에 상품이 없습니다');
    expect(catalogSourceProvenance(raw)).toEqual({
      supplier: 'yeonho',
      sourceDataset: '연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
      sourceSha256: YEONHO_REV2_SOURCE_SHA256,
    });
    expect(isCatalogOfferFromSource(raw, 'yeonho', YEONHO_REV2_SOURCE_SHA256)).toBe(true);
    expect(isCatalogOfferFromSource(raw, 'yeonho', YEONHO_RETIRED_SOURCE_SHA256)).toBe(false);
    expect(isCatalogOfferFromSource(raw, 'digikey', YEONHO_REV2_SOURCE_SHA256)).toBe(false);
    expect(isCatalogOfferFromSource({
      ...raw,
      catalog_metadata: { ...raw.catalog_metadata, catalogOnly: false },
    }, 'yeonho', YEONHO_REV2_SOURCE_SHA256)).toBe(false);
  });
});
