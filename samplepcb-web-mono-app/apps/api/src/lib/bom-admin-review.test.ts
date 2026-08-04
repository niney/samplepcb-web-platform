import { describe, expect, it } from 'vitest';
import type { QuoteItemRow } from './bom-quote';
import {
  bomQuoteItemReviewFingerprint,
  resolveBomQuoteItemReviewState,
} from './bom-admin-review';

const row = (overrides: Partial<QuoteItemRow> = {}): QuoteItemRow => ({
  id: 1n,
  quoteId: 1n,
  analysisComponentId: null,
  rowIdx: 0,
  included: true,
  mpn: 'PART-1',
  manufacturerName: null,
  description: null,
  bomQty: 1,
  orderQty: 1,
  matchStatus: 'auto',
  matchEvidence: { conflicts: [], missingRequirements: [] },
  searchRequirements: null,
  recommendedCandidateKey: null,
  selectedCandidateKey: null,
  selectionSource: 'auto',
  partId: null,
  selectedOffer: null,
  selectedRfqItemId: null,
  lineTotalKrw: null,
  sourceRow: null,
  sourceSheetIndex: 0,
  sourceSheetName: 'BOM',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
  ...overrides,
});

describe('관리자 BOM 품목 검토 지문', () => {
  it('JSON 키 순서가 달라도 같은 행은 같은 지문을 만든다', () => {
    const first = row({ matchEvidence: { conflicts: [], componentStatus: 'matched' } });
    const second = row({ matchEvidence: { componentStatus: 'matched', conflicts: [] } });
    expect(bomQuoteItemReviewFingerprint(first)).toBe(bomQuoteItemReviewFingerprint(second));
  });

  it('선정 구매 조건이나 수량이 바뀌면 기존 확인을 무효화할 지문이 달라진다', () => {
    const original = row();
    expect(bomQuoteItemReviewFingerprint(row({ orderQty: 2 })))
      .not.toBe(bomQuoteItemReviewFingerprint(original));
    expect(bomQuoteItemReviewFingerprint(row({ selectedOffer: { supplier: 'mouser' } })))
      .not.toBe(bomQuoteItemReviewFingerprint(original));
  });

  it('같은 지문의 확인만 완료로 인정하고 행 변경 시 재확인 대상으로 되돌린다', () => {
    const original = row();
    const review = {
      action: 'confirmed',
      fingerprint: bomQuoteItemReviewFingerprint(original),
      actorMbId: 'admin',
      reason: '구매 조건 확인',
      createdAt: new Date('2026-08-04T01:00:00.000Z'),
    };
    expect(resolveBomQuoteItemReviewState(original, true, review)).toMatchObject({
      required: true,
      completed: true,
      stale: false,
      reviewedBy: 'admin',
    });
    expect(resolveBomQuoteItemReviewState(row({ orderQty: 2 }), true, review)).toMatchObject({
      required: true,
      completed: false,
      stale: true,
      reviewedBy: null,
    });
  });

  it('재검토 이벤트는 같은 행 지문이어도 완료로 보지 않는다', () => {
    const original = row();
    expect(resolveBomQuoteItemReviewState(original, true, {
      action: 'reopened',
      fingerprint: bomQuoteItemReviewFingerprint(original),
      actorMbId: 'admin',
      reason: null,
      createdAt: new Date('2026-08-04T01:00:00.000Z'),
    })).toMatchObject({ completed: false, stale: false });
  });

  it('현재 정상 품목이면 과거 확인 지문이 달라도 재확인을 요구하지 않는다', () => {
    const current = row({ orderQty: 2 });
    expect(resolveBomQuoteItemReviewState(current, false, {
      action: 'confirmed',
      fingerprint: bomQuoteItemReviewFingerprint(row()),
      actorMbId: 'admin',
      reason: null,
      createdAt: new Date('2026-08-04T01:00:00.000Z'),
    })).toMatchObject({ required: false, completed: true, stale: false });
  });
});
