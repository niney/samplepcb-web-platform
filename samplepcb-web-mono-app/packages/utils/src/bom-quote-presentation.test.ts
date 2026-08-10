import { describe, expect, it } from 'vitest';
import type { BomQuoteItemType } from '@sp/api-contract';
import {
  bomQuoteAdminAttention,
  bomQuoteItemMatchGroup,
  isBomQuoteAlternativePendingReview,
  isBomQuotePendingReview,
  isBomQuoteStockShort,
  summarizeBomQuoteItems,
} from './bom-quote-presentation';

function item(overrides: Partial<BomQuoteItemType> = {}): BomQuoteItemType {
  return {
    id: '1',
    rowIdx: 0,
    included: true,
    mpn: 'PART-1',
    manufacturerName: null,
    description: null,
    bomQty: 1,
    orderQty: 1,
    matchStatus: 'none',
    matchEvidence: null,
    recommendedCandidateKey: null,
    selectedCandidateKey: null,
    selectionSource: 'none',
    partId: null,
    selectedOffer: null,
    sourceRow: null,
    sourceSheetIndex: 0,
    sourceSheetName: 'BOM',
    lineTotalKrw: null,
    partImageUrl: null,
    partDatasheetUrl: null,
    catalogInquiry: false,
    quantityState: 'verified',
    identityPreview: null,
    ...overrides,
  };
}

describe('BOM 견적 화면 표시 집계', () => {
  it('엔진 제외, 재고, 선정, 검토, 미선정을 화면과 같은 우선순위로 분류한다', () => {
    expect(bomQuoteItemMatchGroup(item({
      matchEvidence: {
        componentStatus: 'excluded',
      } as BomQuoteItemType['matchEvidence'],
    }))).toBe('excluded');
    expect(bomQuoteItemMatchGroup(item({ matchStatus: 'auto' }))).toBe('matched');
    expect(bomQuoteItemMatchGroup(item({
      matchEvidence: {
        selectionMode: 'review',
      } as BomQuoteItemType['matchEvidence'],
    }))).toBe('review');
    expect(bomQuoteItemMatchGroup(item())).toBe('unmatched');
  });

  it.each(['out_of_stock', 'insufficient_stock', 'stock_unverified'] as const)(
    '%s 재고 제약은 검토나 미선정보다 재고 상태를 우선한다',
    (reason) => {
      expect(bomQuoteItemMatchGroup(item({
        matchEvidence: {
          selectionMode: 'review',
          procurementUnavailabilityReason: reason,
        } as BomQuoteItemType['matchEvidence'],
      }))).toBe('nostock');
    },
  );

  it('선정 구매 조건의 수량 부족도 재고 부족으로 집계한다', () => {
    const stockShortItem = item({
      matchStatus: 'auto',
      orderQty: 5,
      selectedOffer: {
        stock: 4,
      } as BomQuoteItemType['selectedOffer'],
    });

    expect(isBomQuoteStockShort(stockShortItem)).toBe(true);
    expect(bomQuoteItemMatchGroup(stockShortItem)).toBe('nostock');
  });

  it.each([
    ['confirmationRequired', { confirmationRequired: true }],
    ['provisional_selected', { selectionApplicationState: 'provisional_selected' }],
  ] as const)('%s 플래그만 있는 일반 스펙 선정은 기존처럼 Matched로 유지한다', (_label, evidence) => {
    const pending = item({
      matchStatus: 'auto',
      matchEvidence: evidence as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuotePendingReview(pending)).toBe(true);
    expect(isBomQuoteAlternativePendingReview(pending)).toBe(false);
    expect(bomQuoteItemMatchGroup(pending)).toBe('matched');
  });

  it.each([
    'digikey_substitution',
    'mouser_suggested',
    'engine_stock_fallback',
    'engine_mpn_fallback',
  ] as const)('%s 대체품 임시 선정만 재고 상태보다 Review를 우선한다', (source) => {
    const alternative = item({
      matchStatus: 'auto',
      orderQty: 5,
      selectedOffer: { stock: 0 } as BomQuoteItemType['selectedOffer'],
      matchEvidence: {
        selectionApplicationState: 'provisional_selected',
        confirmationRequired: true,
        selectedReplacementSources: [source],
        selectedReplacementForMpn: 'ORIGINAL-PART',
      } as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuoteAlternativePendingReview(alternative)).toBe(true);
    expect(bomQuoteItemMatchGroup(alternative)).toBe('review');
  });

  it('대체 출처가 없는 구버전 근거도 원품번이 있으면 Review로 분류한다', () => {
    const alternative = item({
      matchStatus: 'auto',
      matchEvidence: {
        confirmationRequired: true,
        selectedReplacementSources: [],
        selectedReplacementForMpn: 'ORIGINAL-PART',
      } as unknown as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuoteAlternativePendingReview(alternative)).toBe(true);
    expect(bomQuoteItemMatchGroup(alternative)).toBe('review');
  });

  it('빈 대체 원품번은 일반 스펙 선정으로 유지한다', () => {
    const pending = item({
      matchStatus: 'auto',
      matchEvidence: {
        confirmationRequired: true,
        selectedReplacementSources: [],
        selectedReplacementForMpn: '  ',
      } as unknown as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuoteAlternativePendingReview(pending)).toBe(false);
    expect(bomQuoteItemMatchGroup(pending)).toBe('matched');
  });

  it('명시적 수동 선택은 구버전 검토 플래그가 남아도 확정 매칭으로 본다', () => {
    const confirmed = item({
      matchStatus: 'manual',
      selectionSource: 'admin',
      matchEvidence: {
        selectionApplicationState: 'provisional_selected',
        confirmationRequired: true,
        selectedReplacementSources: ['engine_stock_fallback'],
        selectedReplacementForMpn: 'ORIGINAL-PART',
      } as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuotePendingReview(confirmed)).toBe(false);
    expect(isBomQuoteAlternativePendingReview(confirmed)).toBe(false);
    expect(bomQuoteItemMatchGroup(confirmed)).toBe('matched');
  });

  it('재고 상태는 미선정과 중복 집계하지 않는다', () => {
    const stats = summarizeBomQuoteItems([
      item({
        matchEvidence: {
          selectionMode: 'review',
          procurementUnavailabilityReason: 'stock_unverified',
        } as BomQuoteItemType['matchEvidence'],
      }),
    ]);

    expect(stats.nostock).toBe(1);
    expect(stats.review).toBe(0);
    expect(stats.unmatched).toBe(0);
  });

  it('화면 카드 수치와 금액을 한 번에 집계한다', () => {
    const stats = summarizeBomQuoteItems([
      item({
        id: '1',
        matchStatus: 'auto',
        lineTotalKrw: 100.4,
        selectionSource: 'auto',
        matchEvidence: {
          selectionApplicationState: 'provisional_selected',
          confirmationRequired: true,
        } as BomQuoteItemType['matchEvidence'],
      }),
      item({
        id: '2',
        matchEvidence: {
          selectionMode: 'review',
        } as BomQuoteItemType['matchEvidence'],
      }),
      item({
        id: '3',
        included: false,
        matchEvidence: {
          componentStatus: 'excluded',
        } as BomQuoteItemType['matchEvidence'],
      }),
    ]);

    expect(stats).toEqual({
      total: 3,
      matched: 1,
      matchedPct: 33,
      nostock: 0,
      nostockPct: 0,
      review: 1,
      unmatched: 0,
      excluded: 1,
      unresolved: 1,
      included: 2,
      uncosted: 1,
      pendingReview: 1,
      itemsTotal: 100,
    });
  });

  it('관리자 상태는 수량 누락과 미매칭을 즉시 처리로 우선한다', () => {
    expect(bomQuoteAdminAttention(item({ quantityState: 'missing' }))).toMatchObject({
      kind: 'blocking',
      reviewRequired: true,
    });
    const unmatched = bomQuoteAdminAttention(item());
    expect(unmatched.kind).toBe('blocking');
    expect(unmatched.reasons).toContain('unmatched');
    expect(unmatched.reasons).toContain('uncosted');
  });

  it('재고·문의·대체품을 서로 다른 관리자 업무로 구분한다', () => {
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      matchEvidence: {
        procurementUnavailabilityReason: 'out_of_stock',
      } as BomQuoteItemType['matchEvidence'],
    })).kind).toBe('procurement');
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      catalogInquiry: true,
    })).kind).toBe('inquiry');
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      lineTotalKrw: 100,
      matchEvidence: {
        confirmationRequired: true,
        selectedReplacementSources: ['engine_stock_fallback'],
        selectedReplacementForMpn: 'ORIGINAL',
      } as BomQuoteItemType['matchEvidence'],
    })).kind).toBe('technical');
  });

  it('엔진이 검토 모드로 선정한 관리자 부품은 수동 선택 후에도 확인 대상으로 유지한다', () => {
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'manual',
      lineTotalKrw: 100,
      selectionSource: 'admin',
      matchEvidence: {
        selectionMode: 'review',
      } as BomQuoteItemType['matchEvidence'],
    }))).toMatchObject({
      kind: 'technical',
      reasons: ['engine_review'],
      reviewRequired: true,
    });
  });

  it('정상 산출 품목과 제외 품목은 관리자 확인 대상이 아니다', () => {
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      lineTotalKrw: 100,
    }))).toEqual({ kind: 'ready', reasons: [], reviewRequired: false });
    expect(bomQuoteAdminAttention(item({ included: false }))).toEqual({
      kind: 'excluded',
      reasons: [],
      reviewRequired: false,
    });
  });
});
