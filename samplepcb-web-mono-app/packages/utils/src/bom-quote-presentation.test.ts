import { describe, expect, it } from 'vitest';
import type { BomQuoteItemType } from '@sp/api-contract';
import {
  bomQuoteItemMatchGroup,
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
    ...overrides,
  };
}

describe('BOM 견적 화면 표시 집계', () => {
  it('엔진 제외, 선정, 검토, 미선정을 화면과 같은 우선순위로 분류한다', () => {
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

  it('재고 제약이 있는 review 행은 검토가 아니라 미선정으로 분류한다', () => {
    expect(bomQuoteItemMatchGroup(item({
      matchEvidence: {
        selectionMode: 'review',
        procurementUnavailabilityReason: 'out_of_stock',
      } as BomQuoteItemType['matchEvidence'],
    }))).toBe('unmatched');
  });

  it('선정 오퍼의 수량 부족도 재고 부족으로 집계한다', () => {
    expect(isBomQuoteStockShort(item({
      orderQty: 5,
      selectedOffer: {
        stock: 4,
      } as BomQuoteItemType['selectedOffer'],
    }))).toBe(true);
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
});
