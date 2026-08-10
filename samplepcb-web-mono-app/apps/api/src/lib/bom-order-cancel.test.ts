import { describe, expect, it } from 'vitest';
import {
  isActiveBomOrderLine,
  isBomOrderFulfillmentClosed,
  isBomOrderLineCanceled,
  isBomOrderLinePaid,
  resolveBomOrderCancelPolicy,
  type BomOrderCancelPolicyInput,
} from './bom-order-cancel';

const input = (overrides: Partial<BomOrderCancelPolicyInput> = {}): BomOrderCancelPolicyInput => ({
  odStatus: '주문',
  ctStatus: '주문',
  settleCase: '무통장',
  receiptPrice: 0,
  hasPgTransaction: false,
  poCount: 0,
  ...overrides,
});

describe('resolveBomOrderCancelPolicy', () => {
  it('미입금·무통장·발주 전 BOM 카트행만 즉시 취소한다', () => {
    expect(resolveBomOrderCancelPolicy(input())).toEqual({
      cancelable: true,
      blockReason: null,
    });
  });

  it.each(['취소', '반품', '품절', '삭제'])(
    '이미 비활성인 %s 행은 다시 취소하지 않는다',
    (ctStatus) => {
      expect(resolveBomOrderCancelPolicy(input({ ctStatus }))).toEqual({
        cancelable: false,
        blockReason: 'ALREADY_CANCELED',
      });
    },
  );

  it('완료 주문은 취소 대신 별도 고객 대응으로 보낸다', () => {
    expect(resolveBomOrderCancelPolicy(input({ odStatus: '완료' })).blockReason).toBe(
      'ORDER_CLOSED',
    );
  });

  it('발주서가 있으면 결제수단보다 조달 진행을 먼저 막는다', () => {
    expect(
      resolveBomOrderCancelPolicy(input({ poCount: 1, settleCase: '신용카드' })).blockReason,
    ).toBe('PARTNER_PROCESS_EXISTS');
  });

  it('PG·기타 결제는 영카트 승인취소 경로로 보낸다', () => {
    expect(resolveBomOrderCancelPolicy(input({ settleCase: '신용카드' })).blockReason).toBe(
      'YOUNGCART_REQUIRED',
    );
  });

  it('헤더나 대상 행 중 하나라도 입금 이후면 즉시 취소하지 않는다', () => {
    expect(resolveBomOrderCancelPolicy(input({ receiptPrice: 1000 })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
    expect(resolveBomOrderCancelPolicy(input({ odStatus: '입금' })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
    expect(resolveBomOrderCancelPolicy(input({ ctStatus: '입금' })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
    expect(resolveBomOrderCancelPolicy(input({ hasPgTransaction: true })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
  });
});

describe('BOM 주문행 상태 판정', () => {
  it('취소류와 결제 상태를 주문 헤더와 독립적으로 구분한다', () => {
    expect(isBomOrderLineCanceled('취소')).toBe(true);
    expect(isBomOrderLineCanceled('입금')).toBe(false);
    expect(isActiveBomOrderLine('입금')).toBe(true);
    expect(isActiveBomOrderLine('취소')).toBe(false);
    expect(isActiveBomOrderLine('쇼핑')).toBe(false);
    expect(isBomOrderLinePaid('입금')).toBe(true);
    expect(isBomOrderLinePaid('주문')).toBe(false);
    expect(isBomOrderLinePaid('취소')).toBe(false);
    expect(isBomOrderFulfillmentClosed('입금', '취소')).toBe(true);
    expect(isBomOrderFulfillmentClosed('완료', '완료')).toBe(true);
    expect(isBomOrderFulfillmentClosed('입금', '입금')).toBe(false);
  });
});
