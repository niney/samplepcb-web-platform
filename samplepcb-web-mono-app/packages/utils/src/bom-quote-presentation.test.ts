import { describe, expect, it } from 'vitest';
import type { BomQuoteCandidateOfferType, BomQuoteItemType } from '@sp/api-contract';
import {
  bomQuoteAdminAttention,
  bomQuoteItemMatchGroup,
  hasBomQuotePurchasableOffer,
  isBomQuoteAlternativePendingReview,
  isBomQuotePendingReview,
  isBomQuoteStockShort,
  summarizeBomQuoteCandidateOfferIssues,
  summarizeBomQuoteItems,
} from './bom-quote-presentation';

function offer(
  overrides: Partial<BomQuoteCandidateOfferType> = {},
): BomQuoteCandidateOfferType {
  return {
    offerKey: 'offer-1',
    supplier: 'digikey',
    offerKind: 'supplier_offer',
    supplierSku: 'SKU-1',
    packaging: 'Cut Tape',
    stock: 100,
    moq: 1,
    orderMultiple: 1,
    productUrl: null,
    fetchedAt: '2026-08-18T00:00:00.000Z',
    priceBreaks: [{ qty: 1, price: 100, currency: 'KRW' }],
    priceRank: null,
    purchaseFitRank: null,
    purchasable: false,
    recommendation: 'none',
    decisionReasonCodes: [],
    applied: {
      orderQty: 2,
      breakQty: 1,
      unitPrice: 100,
      currency: 'KRW',
      unitPriceKrw: 100,
      lineTotalKrw: 200,
      stockShort: false,
    },
    ...overrides,
  };
}

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
  it('서버 구매 가능 판정과 적용 결과가 모두 있는 구매 조건만 선택 가능으로 센다', () => {
    expect(hasBomQuotePurchasableOffer([
      offer({ purchasable: true }),
    ])).toBe(true);
    expect(hasBomQuotePurchasableOffer([
      offer({ purchasable: true, applied: null }),
      offer({ purchasable: false }),
    ])).toBe(false);
  });

  it('혼합 구매 불가 사유를 공급사 조건별 표시 건수로 집계한다', () => {
    const issues = summarizeBomQuoteCandidateOfferIssues([
      offer({
        offerKey: 'unikey-no-price',
        supplier: 'unikeyic',
        stock: 362,
        moq: 100,
        priceBreaks: [],
        decisionReasonCodes: ['price_unavailable', 'price_break_unavailable_for_quantity'],
        applied: null,
      }),
      offer({
        offerKey: 'mouser-no-stock',
        supplier: 'mouser',
        stock: 0,
        decisionReasonCodes: ['stock_short', 'stock_shortage_not_allowed'],
        applied: {
          orderQty: 2,
          breakQty: 1,
          unitPrice: 156,
          currency: 'KRW',
          unitPriceKrw: 156,
          lineTotalKrw: 312,
          stockShort: true,
        },
      }),
      offer({
        offerKey: 'digikey-excessive',
        stock: 0,
        moq: 10_000,
        decisionReasonCodes: [
          'stock_short',
          'stock_shortage_not_allowed',
          'automatic_selection_excessive',
        ],
        applied: {
          orderQty: 10_000,
          breakQty: 1,
          unitPrice: 2,
          currency: 'KRW',
          unitPriceKrw: 2,
          lineTotalKrw: 20_000,
          stockShort: true,
        },
      }),
    ], 2);

    expect(issues).toEqual({
      priceUnavailable: 1,
      outOfStock: 2,
      insufficientStock: 0,
      stockUnverified: 0,
      excessiveOrder: 1,
      other: 0,
    });
  });

  it('판정 근거가 없는 구버전 구매 조건과 제조사 문의 조건을 구분한다', () => {
    expect(summarizeBomQuoteCandidateOfferIssues([
      offer({ applied: null, priceBreaks: [{ qty: 1, price: 100, currency: 'KRW' }] }),
      offer({
        offerKey: 'catalog-inquiry',
        offerKind: 'manufacturer_catalog',
        applied: null,
        priceBreaks: [],
      }),
    ], 2)).toMatchObject({ other: 1, priceUnavailable: 0 });
  });

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
  ] as const)('%s 플래그가 남은 자동 선정은 명시 확인 전 Review로 표시한다', (_label, evidence) => {
    const pending = item({
      matchStatus: 'auto',
      matchEvidence: evidence as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuotePendingReview(pending)).toBe(true);
    expect(isBomQuoteAlternativePendingReview(pending)).toBe(false);
    expect(bomQuoteItemMatchGroup(pending)).toBe('review');
  });

  it.each([
    'digikey_substitution',
    'mouser_suggested',
    'engine_stock_fallback',
    'engine_procurement_fallback',
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

  it('빈 대체 원품번이어도 일반 검토 플래그는 명시 확인 전 Review로 유지한다', () => {
    const pending = item({
      matchStatus: 'auto',
      matchEvidence: {
        confirmationRequired: true,
        selectedReplacementSources: [],
        selectedReplacementForMpn: '  ',
      } as unknown as BomQuoteItemType['matchEvidence'],
    });

    expect(isBomQuoteAlternativePendingReview(pending)).toBe(false);
    expect(bomQuoteItemMatchGroup(pending)).toBe('review');
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
      matched: 0,
      matchedPct: 0,
      nostock: 0,
      nostockPct: 0,
      review: 2,
      unmatched: 0,
      excluded: 1,
      unresolved: 2,
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

  it('엔진 review 후보도 고객·관리자가 명시 선택하면 기술 확인 완료로 본다', () => {
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'manual',
      lineTotalKrw: 100,
      selectionSource: 'admin',
      selectedCandidateKey: 'candidate-1',
      selectedOffer: { supplier: 'digikey' } as BomQuoteItemType['selectedOffer'],
      matchEvidence: {
        selectionMode: 'review',
        missingRequirements: ['package'],
        technicalFallbackUsed: true,
      } as BomQuoteItemType['matchEvidence'],
    }))).toEqual({
      kind: 'ready',
      reasons: ['engine_review', 'requirement_missing', 'technical_fallback'],
      reviewRequired: false,
    });
  });

  it('엔진 자동 확정·가격 산출 품목의 보조 스펙 누락과 불일치는 정보로만 유지한다', () => {
    const attention = bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      lineTotalKrw: 100,
      selectedCandidateKey: 'candidate-1',
      selectedOffer: { supplier: 'digikey' } as BomQuoteItemType['selectedOffer'],
      matchEvidence: {
        selectionMode: 'exact',
        selectionApplicationState: 'automatic_selected',
        confirmationRequired: false,
        technicalFallbackUsed: true,
        conflicts: ['package_mismatch'],
        missingRequirements: ['voltage_v'],
      } as BomQuoteItemType['matchEvidence'],
    }));

    expect(attention).toEqual({
      kind: 'ready',
      reasons: ['requirement_conflict', 'requirement_missing', 'technical_fallback'],
      reviewRequired: false,
    });
  });

  it.each([
    ['임시 선정', { selectionApplicationState: 'provisional_selected', confirmationRequired: true }],
    ['엔진 review', { selectionMode: 'review', selectionApplicationState: 'not_selected' }],
  ] as const)('%s의 누락 근거는 계속 관리자 확인 대상으로 유지한다', (_label, evidence) => {
    expect(bomQuoteAdminAttention(item({
      matchStatus: 'auto',
      lineTotalKrw: 100,
      selectedCandidateKey: 'candidate-1',
      selectedOffer: { supplier: 'digikey' } as BomQuoteItemType['selectedOffer'],
      matchEvidence: {
        ...evidence,
        missingRequirements: ['package'],
      } as BomQuoteItemType['matchEvidence'],
    }))).toMatchObject({ kind: 'technical', reviewRequired: true });
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
