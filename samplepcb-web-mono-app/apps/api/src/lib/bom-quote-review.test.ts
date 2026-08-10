import { describe, expect, it } from 'vitest';
import {
  canEditBomQuoteReview,
  hasBomQuoteReviewChanges,
} from './bom-quote-review';

describe('BOM 견적 검토 수정 게이트', () => {
  it('요청·검토 중에만 검토 내용을 수정할 수 있다', () => {
    expect(canEditBomQuoteReview('requested')).toBe(true);
    expect(canEditBomQuoteReview('reviewing')).toBe(true);
    expect(canEditBomQuoteReview('answered')).toBe(false);
    expect(canEditBomQuoteReview('closed')).toBe(false);
    expect(canEditBomQuoteReview('canceled')).toBe(false);
  });

  it('상태만 마감하는 요청과 검토 내용 변경 요청을 구분한다', () => {
    expect(hasBomQuoteReviewChanges({ status: 'closed' })).toBe(false);
    expect(hasBomQuoteReviewChanges({ confirmedTotal: 10_000 })).toBe(true);
    expect(hasBomQuoteReviewChanges({ answerNote: null })).toBe(true);
  });
});
