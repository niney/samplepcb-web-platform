// 부품 검색 쿼리 빌더의 비연결 회귀 테스트.
// 실 DB·ES 통합 테스트가 skip 되는 CI에서도 필터 승격과 정렬 계약을 고정한다.
import { describe, expect, it } from 'vitest';
import { PartSearchQuery } from '@sp/api-contract';
import { buildExactSearchIntent, buildPartSort, buildSearchQuery } from './admin-parts';

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
