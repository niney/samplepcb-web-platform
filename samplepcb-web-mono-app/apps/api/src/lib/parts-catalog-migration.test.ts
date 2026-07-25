import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveManufacturer } from './manufacturer-alias';
import { catalogSearchSamples, parseCatalogMigrationEnvelope } from './parts-catalog-migration';

const catalogFile = fileURLToPath(
  new URL('../../catalog-migrations/yeonho-connectors-2026-07-17/catalog-envelope.json', import.meta.url),
);

function catalogArtifact(): unknown {
  return JSON.parse(readFileSync(catalogFile, 'utf8'));
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
  it('연호 카탈로그 820건을 DB upsert 키로 유일하게 해석한다', () => {
    const parsed = parseCatalogMigrationEnvelope(catalogArtifact());
    expect(parsed.records).toHaveLength(820);
    expect(new Set(parsed.records.map((record) => record.key)).size).toBe(820);
    expect(parsed.records.every((record) => record.manufacturerNorm === 'yeonho')).toBe(true);
    expect(parsed.records.flatMap((record) => record.offers)).toHaveLength(820);
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

  it('한글 연호 제조사 표기도 동일 upsert 키로 정규화한다', () => {
    expect(resolveManufacturer('YEONHO ELECTRONICS').norm).toBe('yeonho');
    expect(resolveManufacturer('연호전자').norm).toBe('yeonho');
    expect(resolveManufacturer('연호').norm).toBe('yeonho');
  });

  it('분석 수량과 실제 후보 수량이 다르면 거부한다', () => {
    const artifact = mutableArtifact();
    const analysis = artifact.analysis as Record<string, unknown>;
    analysis.outputUniqueParts = 819;
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
    analysis.outputUniqueParts = 821;
    expect(() => parseCatalogMigrationEnvelope(artifact)).toThrow('DB upsert 키가 중복');
  });

  it('확인되지 않은 이미지를 정본으로 승격한 파일을 거부한다', () => {
    const artifact = mutableArtifact();
    const candidate = components(artifact).flatMap(candidates)
      .find((value) => {
        const metadata = product(value).catalog_metadata as Record<string, unknown>;
        return metadata.imageStatus !== '수집완료';
      });
    if (candidate === undefined) throw new Error('이미지 확인 필요 픽스처가 없습니다');
    product(candidate).image_url = 'https://example.com/unverified.jpg';
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
});
