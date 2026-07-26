// 부품 검색 쿼리 빌더의 비연결 회귀 테스트.
// 실 DB·ES 통합 테스트가 skip 되는 CI에서도 필터 승격과 정렬 계약을 고정한다.
import { describe, expect, it } from 'vitest';
import { PartBulkDeleteFilter, PartSearchQuery } from '@sp/api-contract';
import {
  buildExactSearchIntent,
  buildPartDeletionPreview,
  buildPartSort,
  buildSearchQuery,
} from './admin-parts';

function serializedQuery(input: Record<string, unknown>): string {
  return JSON.stringify(buildSearchQuery(PartSearchQuery.parse(input)));
}

describe('buildSearchQuery', () => {
  it('모호한 숫자 4700은 값으로 다중 해석하되 패키지 필터로 승격하지 않는다', () => {
    const query = serializedQuery({ q: '4700' });
    expect(query).toContain('resistanceOhm');
    expect(query).toContain('capacitanceF');
    expect(query).not.toContain('packageVariants');
  });

  it('알려진 패키지 0402는 구조화 필터로 승격한다', () => {
    const query = serializedQuery({ q: '4k7 0402' });
    expect(query).toContain('"filter":[{"terms":{"packageVariants":["0402"]}}]');
    expect(query).toContain('"packageVariants":["0402"],"boost":6');
    expect(query).toContain('"minimum_should_match":1');
  });

  it('메트릭 패키지 1005를 0402로 정규화하고 단독 검색 의도로 인정한다', () => {
    const query = serializedQuery({ q: '1005' });
    expect(query).toContain('"filter":[{"terms":{"packageVariants":["0402"]}}]');
    expect(query).toContain('"packageVariants":["0402"],"boost":6');
  });

  it('재고·제조사·공급사와 SI 범위 필터를 동시에 보존한다', () => {
    const query = serializedQuery({
      q: '',
      manufacturer: 'Murata Electronics',
      supplier: 'mouser',
      inStockOnly: true,
      capacitanceMin: 9e-8,
      capacitanceMax: 1.1e-7,
      voltageMin: 15,
      voltageMax: 17,
    });
    expect(query).toContain('manufacturerName');
    expect(query).toContain('Murata Electronics');
    expect(query).toContain('suppliers');
    expect(query).toContain('totalStock');
    expect(query).toContain('capacitanceF');
    expect(query).toContain('voltageV');
  });

  it('빈 검색어는 should 최소 매칭을 만들지 않아 필터 전용 검색이 가능하다', () => {
    expect(buildSearchQuery(PartSearchQuery.parse({ q: '', inStockOnly: true }))).toEqual({
      bool: { filter: [{ range: { totalStock: { gt: 0 } } }] },
    });
  });

  it('BOM 규격 검색은 고신뢰 규격을 모두 exact 필터로 승격한다', () => {
    const params = PartSearchQuery.parse({ q: '560nF 16V' });
    const intent = buildExactSearchIntent(params);
    expect(intent?.interpretedSpecCount).toBe(2);
    expect(JSON.stringify(intent?.query)).toContain('"filter":[{"range":{"capacitanceF"');
    expect(JSON.stringify(intent?.query)).toContain('{"range":{"voltageV"');
    expect(JSON.stringify(intent?.query)).not.toContain('"minimum_should_match"');
  });

  it('MPN 텍스트 검색은 exact 규격 의도로 오인하지 않는다', () => {
    expect(buildExactSearchIntent(PartSearchQuery.parse({ q: 'GRM155R71C104KA88D' }))).toBeNull();
  });
});

describe('buildPartSort', () => {
  it('관련도·가격·재고 정렬을 ES 필드에 고정한다', () => {
    expect(buildPartSort('relevance')).toEqual(['_score']);
    expect(buildPartSort('price')).toEqual([{ minPrice: { order: 'asc', missing: '_last' } }]);
    expect(buildPartSort('stock')).toEqual([{ totalStock: { order: 'desc' } }]);
  });
});

describe('part bulk delete preview', () => {
  const filter = PartBulkDeleteFilter.parse({ manufacturer: 'YEONHO ELECTRONICS' });
  const parts = [
    {
      id: '1',
      mpn: 'OLD-1',
      manufacturerName: 'YEONHO ELECTRONICS',
      offers: [{
        supplier: 'yeonho',
        supplierSku: 'OLD-1',
        rawJson: {
          supplier: 'yeonho',
          catalog_metadata: {
            catalogOnly: true,
            sourceDataset: 'old.xlsx',
            sourceDatasetSha256: 'a'.repeat(64),
          },
        },
      }],
    },
    {
      id: '2',
      mpn: 'SHARED-2',
      manufacturerName: 'YEONHO ELECTRONICS',
      offers: [
        { supplier: 'yeonho', supplierSku: 'SHARED-2', rawJson: {} },
        { supplier: 'digikey', supplierSku: 'DK-SHARED-2', rawJson: {} },
      ],
    },
  ];

  it('견적 연결 부품은 보호하고 DB에 없는 ES 문서는 삭제 가능 대상으로 분리한다', () => {
    const preview = buildPartDeletionPreview(
      filter,
      ['3', '2', '1'],
      parts,
      [
        { partId: '2', quoteId: '100' },
        { partId: '2', quoteId: '101' },
      ],
    );
    expect(preview.deletableIds).toEqual(['1', '3']);
    expect(preview.data).toMatchObject({
      matchedParts: 3,
      existingParts: 2,
      deletableParts: 2,
      protectedParts: 1,
      protectedQuoteItems: 2,
      staleIndexDocuments: 1,
      multiSupplierParts: 1,
      confirmation: 'DELETE 2',
      supplierOffers: [
        { value: 'digikey', count: 1 },
        { value: 'yeonho', count: 2 },
      ],
      catalogSources: [{
        supplier: 'yeonho',
        sourceDataset: 'old.xlsx',
        sourceSha256: 'a'.repeat(64),
        count: 1,
      }],
      protectedSample: [{
        partId: '2',
        mpn: 'SHARED-2',
        quoteCount: 2,
        quoteIds: ['100', '101'],
      }],
    });
  });

  it('입력 순서와 무관하게 같은 hash이며 견적 연결이 바뀌면 hash도 바뀐다', () => {
    const first = buildPartDeletionPreview(
      filter,
      ['2', '1'],
      parts,
      [{ partId: '2', quoteId: '100' }],
    );
    const reordered = buildPartDeletionPreview(
      filter,
      ['1', '2'],
      [...parts].reverse(),
      [{ partId: '2', quoteId: '100' }],
    );
    const changed = buildPartDeletionPreview(filter, ['1', '2'], parts, []);
    expect(reordered.data.previewHash).toBe(first.data.previewHash);
    expect(changed.data.previewHash).not.toBe(first.data.previewHash);
  });

  it('SamplePCB 취급 카탈로그의 제조사 원천을 구매 공급사와 분리한다', () => {
    const rawJson = {
      supplier: 'walsin',
      catalog_metadata: {
        catalogOnly: true,
        commercialDataAvailable: false,
        samplepcbPreferred: true,
        sourceDataset: 'walsin.xlsx',
        sourceDatasetSha256: 'b'.repeat(64),
      },
    };
    const preview = buildPartDeletionPreview(
      PartBulkDeleteFilter.parse({ manufacturer: 'Walsin' }),
      ['10'],
      [{
        id: '10',
        mpn: 'WR06X1002FTL',
        manufacturerName: 'Walsin',
        offers: [
          { supplier: 'walsin', supplierSku: 'WR06X1002FTL', rawJson },
          { supplier: 'samplepcb', supplierSku: 'WR06X1002FTL', rawJson },
        ],
      }],
      [],
    );

    expect(preview.data.supplierOffers).toEqual([
      { value: 'samplepcb', count: 1 },
    ]);
    expect(preview.data.catalogSources).toEqual([{
      supplier: 'walsin',
      sourceDataset: 'walsin.xlsx',
      sourceSha256: 'b'.repeat(64),
      count: 1,
    }]);
    expect(preview.data.multiSupplierParts).toBe(0);
  });

  it('검색어·필터가 전혀 없는 전체 삭제 요청은 계약에서 거부한다', () => {
    expect(PartBulkDeleteFilter.safeParse({}).success).toBe(false);
    expect(PartBulkDeleteFilter.safeParse({ supplier: 'yeonho' }).success).toBe(true);
  });
});
