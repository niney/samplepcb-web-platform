import { describe, expect, it } from 'vitest';
import {
  isActivePcbOrderLine,
  isPcbOrderFulfillmentClosed,
  isPcbOrderLineCanceled,
  resolvePcbOrderCancelPolicy,
  type PcbOrderCancelPolicyInput,
} from './pcb-order-cancel';

const input = (overrides: Partial<PcbOrderCancelPolicyInput> = {}): PcbOrderCancelPolicyInput => ({
  odStatus: '주문',
  ctStatus: '주문',
  settleCase: '무통장',
  receiptPrice: 0,
  hasPgTransaction: false,
  poCount: 0,
  ...overrides,
});

describe('resolvePcbOrderCancelPolicy', () => {
  it('미입금·무통장·발주 전 PCB 카트행만 즉시 취소한다', () => {
    expect(resolvePcbOrderCancelPolicy(input())).toEqual({
      cancelable: true,
      blockReason: null,
    });
  });

  it.each(['취소', '반품', '품절', '삭제'])(
    '이미 비활성인 %s 행은 다시 취소하지 않는다',
    (ctStatus) => {
      expect(resolvePcbOrderCancelPolicy(input({ ctStatus }))).toEqual({
        cancelable: false,
        blockReason: 'ALREADY_CANCELED',
      });
    },
  );

  it('완료 주문은 반품·A/S로 안내한다', () => {
    expect(resolvePcbOrderCancelPolicy(input({ odStatus: '완료' })).blockReason).toBe(
      'ORDER_CLOSED',
    );
  });

  it('발주서가 있으면 결제수단보다 PCB 협력 진행을 먼저 막는다', () => {
    expect(
      resolvePcbOrderCancelPolicy(input({ poCount: 1, settleCase: '신용카드' })).blockReason,
    ).toBe('PARTNER_PROCESS_EXISTS');
  });

  it('PG·기타 결제는 영카트 승인취소 경로로 보낸다', () => {
    expect(resolvePcbOrderCancelPolicy(input({ settleCase: '신용카드' })).blockReason).toBe(
      'YOUNGCART_REQUIRED',
    );
  });

  it('무통장이라도 수납액이나 입금 이후 상태가 있으면 환불 검토를 요구한다', () => {
    expect(resolvePcbOrderCancelPolicy(input({ receiptPrice: 1000 })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
    expect(resolvePcbOrderCancelPolicy(input({ odStatus: '입금' })).blockReason).toBe(
      'PAYMENT_RECEIVED',
    );
  });
});

describe('PCB 주문행 상태 판정', () => {
  it('취소류·삭제만 취소 완료이고 쇼핑은 주문 활성행이 아니다', () => {
    expect(isPcbOrderLineCanceled('취소')).toBe(true);
    expect(isPcbOrderLineCanceled('입금')).toBe(false);
    expect(isActivePcbOrderLine('입금')).toBe(true);
    expect(isActivePcbOrderLine('취소')).toBe(false);
    expect(isActivePcbOrderLine('쇼핑')).toBe(false);
    expect(isPcbOrderFulfillmentClosed('입금', '취소')).toBe(true);
    expect(isPcbOrderFulfillmentClosed('취소', '입금')).toBe(true);
    expect(isPcbOrderFulfillmentClosed('완료', '완료')).toBe(true);
    expect(isPcbOrderFulfillmentClosed('입금', '입금')).toBe(false);
  });
});
