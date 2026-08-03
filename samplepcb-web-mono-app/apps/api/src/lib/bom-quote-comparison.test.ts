import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  buildQuoteComparisonRows,
  comparisonStatus,
  toBomExtractionSource,
} from './bom-quote';

function candidatePayload(candidateKey: string, technicalRank: number) {
  return {
    candidateKey,
    technicalRank,
    status: 'spec_compatible',
    selectionMode: 'spec-compatible',
    safety: 'safe',
    autoEligible: true,
    mpn: `MPN-${candidateKey}`,
    manufacturerName: 'Maker',
    description: 'Stored candidate',
    category: 'Capacitor',
    packageCode: '0603',
    lifecycleStatus: 'Active',
    datasheetUrl: null,
    imageUrl: null,
    identityConfidence: 0.95,
    specificationConfidence: 0.9,
    conflicts: [],
    missingRequirements: [],
    reasons: ['capacitance_f_match'],
    corroboratingSuppliers: ['mouser'],
    verifiedRequirementCount: 1,
    requiredRequirementCount: 1,
    normalizedSpecs: { capacitance_f: 0.000001 },
    specComparisons: {
      capacitance_f: {
        state: 'match',
        expected_display: '1 µF',
        actual_display: '1 µF',
      },
    },
    packageComparison: null,
    offers: [{
      offerKey: `offer-${candidateKey}`,
      supplier: 'mouser',
      supplierSku: `sku-${candidateKey}`,
      packaging: 'Cut Tape',
      stock: 100,
      moq: 1,
      orderMultiple: 1,
      productUrl: 'https://example.com/part',
      leadTime: null,
      fetchedAt: '2026-07-20T00:00:00.000Z',
      priceBreaks: [{ qty: 1, price: 10, currency: 'KRW' }],
    }],
  };
}

describe('BOM 전체 비교 영속 스냅샷', () => {
  it.each([
    ['confirmationRequired', { componentStatus: 'verified_exact', confirmationRequired: true, selectedReplacementSources: ['engine_stock_fallback'] }],
    ['provisional_selected', { componentStatus: 'verified_exact', selectionApplicationState: 'provisional_selected', selectedReplacementSources: ['engine_mpn_fallback'] }],
  ] satisfies [string, Prisma.JsonValue][])('%s 대체품 행은 기술상 일치해도 비교 화면에서 확인 필요로 분류한다', (_label, evidence) => {
    expect(comparisonStatus('auto', evidence)).toBe('attention');
  });

  it('일반 스펙 후보의 임시 선정 플래그는 비교 화면에서 기존 매칭을 유지한다', () => {
    expect(comparisonStatus('auto', {
      componentStatus: 'spec_compatible',
      selectionApplicationState: 'provisional_selected',
      confirmationRequired: true,
      selectedReplacementSources: [],
      selectedReplacementForMpn: null,
    })).toBe('matched');
  });

  it('관리자가 명시 확정한 행은 구버전 검토 플래그가 남아도 비교 화면에서 매칭으로 본다', () => {
    expect(comparisonStatus('manual', {
      componentStatus: 'verified_exact',
      selectionApplicationState: 'provisional_selected',
      confirmationRequired: true,
      selectedReplacementSources: ['engine_stock_fallback'],
      selectedReplacementForMpn: 'ORIGINAL-PART',
    })).toBe('matched');
  });

  it('후보 패널에도 미래 필드를 포함한 ComponentRecord 원본을 그대로 전달한다', () => {
    expect(toBomExtractionSource({
      id: 7n,
      engineComponentId: 'engine-component-7',
      reviewStatus: 'extracted',
      confidence: 0.95,
      payload: { part_number: 'ABC-123', future_field: { retained: true } },
    })).toEqual({
      analysisComponentId: '7',
      engineComponentId: 'engine-component-7',
      reviewStatus: 'extracted',
      confidence: 0.95,
      payload: { part_number: 'ABC-123', future_field: { retained: true } },
    });
  });

  it('엔진 잡 없이 DB 후보 payload를 행·기술순위로 복원한다', () => {
    const rows = buildQuoteComparisonRows([
      { itemId: '9', payload: candidatePayload('second', 2) },
      { itemId: '4', payload: candidatePayload('other-row', 1) },
      { itemId: '9', payload: candidatePayload('first', 1) },
    ], [
      { itemId: '9', rowIdx: 9, extraction: null },
      { itemId: '4', rowIdx: 4, extraction: null },
    ]);

    expect(rows.map((row) => row.rowIdx)).toEqual([4, 9]);
    expect(rows[1]?.candidates.map((candidate) => candidate.candidateKey)).toEqual(['first', 'second']);
    expect(rows[1]?.candidates[0]?.offers[0]).toMatchObject({
      supplier: 'mouser',
      supplierSku: 'sku-first',
      priceBreaks: [{ qty: 1, price: 10, currency: 'KRW' }],
    });
  });

  it('손상된 구버전 후보만 격리하고 같은 견적의 정상 후보는 유지한다', () => {
    const rows = buildQuoteComparisonRows([
      { itemId: '1', payload: { candidateKey: 'broken' } },
      { itemId: '2', payload: candidatePayload('healthy', 1) },
    ], [
      {
        itemId: '1',
        rowIdx: 1,
        extraction: {
          analysisComponentId: '101',
          engineComponentId: 'engine-1',
          reviewStatus: 'extracted',
          confidence: 0.95,
          payload: { future_engine_field: { preserved: true } },
        },
      },
      { itemId: '2', rowIdx: 2, extraction: null },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.candidates).toEqual([]);
    expect(rows[0]?.extraction?.payload.future_engine_field).toEqual({ preserved: true });
    expect(rows[1]?.candidates[0]?.candidateKey).toBe('healthy');
  });
});
