import { describe, expect, it } from 'vitest';
import {
  isBomClaimActive,
  resolveBomClaimEligibilityReason,
  resolveBomClaimTransition,
  validateBomClaimItems,
} from './bom-claim';

describe('resolveBomClaimEligibilityReason', () => {
  it('배송 또는 완료된 활성 주문행만 새 접수를 허용한다', () => {
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '배송', ctStatus: '배송' },
      hasActiveClaim: false,
    })).toBeNull();
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '완료', ctStatus: '완료' },
      hasActiveClaim: false,
    })).toBeNull();
  });

  it('주문 전·주문 소실·배송 전을 각각 구분한다', () => {
    expect(resolveBomClaimEligibilityReason({
      ctId: null,
      order: null,
      hasActiveClaim: false,
    })).toBe('NO_ORDER');
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: null,
      hasActiveClaim: false,
    })).toBe('ORDER_NOT_FOUND');
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '입금', ctStatus: '입금' },
      hasActiveClaim: false,
    })).toBe('NOT_DELIVERED');
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '완료', ctStatus: '입금' },
      hasActiveClaim: false,
    })).toBe('NOT_DELIVERED');
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '입금', ctStatus: '배송' },
      hasActiveClaim: false,
    })).toBe('NOT_DELIVERED');
  });

  it.each(['취소', '반품', '품절', '삭제'])('%s 주문행은 새 접수를 막는다', (ctStatus) => {
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '완료', ctStatus },
      hasActiveClaim: false,
    })).toBe('LINE_CLOSED');
  });

  it('같은 주문행에 미처리 접수가 있으면 중복 접수를 막는다', () => {
    expect(resolveBomClaimEligibilityReason({
      ctId: 10,
      order: { odStatus: '완료', ctStatus: '완료' },
      hasActiveClaim: true,
    })).toBe('ACTIVE_CLAIM');
  });
});

describe('resolveBomClaimTransition', () => {
  it('접수→검토→해결 또는 반려의 단방향 전이만 허용한다', () => {
    expect(resolveBomClaimTransition('open', 'review_started')).toBe('reviewing');
    expect(resolveBomClaimTransition('reviewing', 'resolved')).toBe('resolved');
    expect(resolveBomClaimTransition('reviewing', 'rejected')).toBe('rejected');
    expect(resolveBomClaimTransition('open', 'resolved')).toBeNull();
    expect(resolveBomClaimTransition('resolved', 'review_started')).toBeNull();
  });
});

describe('validateBomClaimItems', () => {
  const items = [
    { id: 11n, orderQty: 10 },
    { id: 12n, orderQty: 4 },
  ];

  it('견적 소유 품목의 주문수량 이내 접수를 허용한다', () => {
    expect(validateBomClaimItems(items, [
      { quoteItemId: '11', affectedQty: 3 },
      { quoteItemId: '12', affectedQty: 4 },
    ])).toBeNull();
  });

  it('중복·타 견적 품목·주문수량 초과를 구분한다', () => {
    expect(validateBomClaimItems(items, [
      { quoteItemId: '11', affectedQty: 1 },
      { quoteItemId: '11', affectedQty: 2 },
    ])).toBe('DUPLICATE_ITEM');
    expect(validateBomClaimItems(items, [{ quoteItemId: '99', affectedQty: 1 }])).toBe(
      'ITEM_NOT_FOUND',
    );
    expect(validateBomClaimItems(items, [{ quoteItemId: '12', affectedQty: 5 }])).toBe(
      'AFFECTED_QTY_EXCEEDS_ORDER',
    );
  });
});

describe('isBomClaimActive', () => {
  it('open/reviewing만 미처리로 센다', () => {
    expect(isBomClaimActive('open')).toBe(true);
    expect(isBomClaimActive('reviewing')).toBe(true);
    expect(isBomClaimActive('resolved')).toBe(false);
    expect(isBomClaimActive('rejected')).toBe(false);
  });
});
