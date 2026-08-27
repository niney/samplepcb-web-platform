import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { BomEngineAnalysisResult, bomEngineComponentId } from './bom-analysis';
import {
  buildSingleSearchComparisonAnalysis,
  singleSearchPartnerComparisonTarget,
} from './bom-single-search-comparison';

const quoteId = 589n;

function item(overrides: Partial<{
  id: bigint;
  rowIdx: number;
  included: boolean;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  bomQty: number;
  selectionSource: string;
  sourceRow: Prisma.JsonObject;
}> = {}) {
  return {
    id: 57410n,
    rowIdx: 2,
    included: true,
    mpn: 'ADN2525ACPZ',
    manufacturerName: 'ADI',
    description: 'Laser diode driver',
    bomQty: 1,
    selectionSource: 'partner',
    sourceRow: { manualAdded: true, singleSearch: true },
    ...overrides,
  };
}

describe('단일검색 협력사 공급사 비교 분석', () => {
  it('엔진 후보가 없어도 명시적으로 담은 협력사 행을 비교 대상으로 만든다', () => {
    const target = singleSearchPartnerComparisonTarget(quoteId, item());

    expect(target).toEqual({
      itemId: '57410',
      rowIdx: 2,
      componentId: bomEngineComponentId('single-search-quote-589', 0, [4]),
      partNumber: 'ADN2525ACPZ',
      manufacturer: 'ADI',
    });
    expect(singleSearchPartnerComparisonTarget(
      quoteId,
      item({ selectionSource: 'catalog' }),
    )).toBeNull();
    expect(singleSearchPartnerComparisonTarget(
      quoteId,
      item({ sourceRow: { manualAdded: true } }),
    )).toBeNull();
  });

  it('현재 단일검색 행 전체를 기존 supplier-job이 읽을 수 있는 영속 분석 계약으로 만든다', () => {
    const plan = buildSingleSearchComparisonAnalysis(quoteId, [
      item({ rowIdx: 2 }),
      item({
        id: 55109n,
        rowIdx: 1,
        mpn: 'C1210C104K5RACTU',
        manufacturerName: 'KEMET',
        selectionSource: 'catalog',
      }),
      item({ id: 1n, rowIdx: 3, included: false }),
    ]);

    expect(BomEngineAnalysisResult.parse(plan.analysis)).toEqual(plan.analysis);
    expect(plan.targets.map((target) => target.partNumber)).toEqual([
      'C1210C104K5RACTU',
      'ADN2525ACPZ',
    ]);
    expect(plan.analysis.components).toHaveLength(2);
    expect(plan.analysis.components[1]).toMatchObject({
      part_number: 'ADN2525ACPZ',
      manufacturer: 'ADI',
      quantity_resolution: 'verified',
      search_disposition: 'search',
      procurement_disposition: 'eligible',
      review_status: 'extracted',
      part_number_supported: true,
    });
  });
});
