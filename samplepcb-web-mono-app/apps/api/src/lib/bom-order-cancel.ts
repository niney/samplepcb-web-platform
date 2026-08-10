import type { BomOrderCancelBlockReasonType } from '@sp/api-contract';

const CANCELED_LINE_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const PAID_LINE_STATUSES = new Set([
  '입금',
  '준비',
  '가격확인',
  '파일검사',
  'EQ',
  '생산시작',
  '생산중',
  '품질시험',
  '생산완료',
  'A/S',
  '배송',
  '완료',
]);

export interface BomOrderCancelPolicyInput {
  odStatus: string;
  ctStatus: string;
  settleCase: string;
  receiptPrice: number;
  hasPgTransaction: boolean;
  poCount: number;
}

export interface BomOrderCancelPolicy {
  cancelable: boolean;
  blockReason: BomOrderCancelBlockReasonType | null;
}

/** 부분취소에서는 주문 헤더가 아니라 해당 BOM 카트행으로 취소 완료를 판정한다. */
export const isBomOrderLineCanceled = (status: string): boolean =>
  CANCELED_LINE_STATUSES.has(status);

/** 주문 안에 남은 활성 형제 수 계산용. 쇼핑·취소류는 주문 이행 대상이 아니다. */
export const isActiveBomOrderLine = (status: string): boolean =>
  status !== '쇼핑' && !isBomOrderLineCanceled(status);

/** 발주 게이트가 주문 헤더의 넓은 isPaid 판정을 사용하지 않도록 하는 행 단위 결제 상태. */
export const isBomOrderLinePaid = (status: string): boolean => PAID_LINE_STATUSES.has(status);

/** 취소·완료 Case에는 새 발주 같은 후속 이행을 열지 않는다. */
export const isBomOrderFulfillmentClosed = (odStatus: string, ctStatus: string): boolean =>
  isBomOrderLineCanceled(ctStatus) || odStatus === '취소' || odStatus === '완료' || ctStatus === '완료';

/**
 * sp-vue에서 즉시 처리해도 되는 안전한 Smart BOM 주문 취소 범위.
 *
 * 묶음 주문의 한 Case만 취소할 수 있지만 해당 행과 주문 헤더가 모두 미입금 주문이어야 한다.
 * 수납·PG·발주 흔적이 있으면 로컬 상태를 먼저 바꾸지 않고 영카트/운영 절차로 보낸다.
 */
export const resolveBomOrderCancelPolicy = (
  input: BomOrderCancelPolicyInput,
): BomOrderCancelPolicy => {
  if (isBomOrderLineCanceled(input.ctStatus) || input.odStatus === '취소') {
    return { cancelable: false, blockReason: 'ALREADY_CANCELED' };
  }
  if (input.odStatus === '완료' || input.ctStatus === '완료') {
    return { cancelable: false, blockReason: 'ORDER_CLOSED' };
  }
  if (input.poCount > 0) {
    return { cancelable: false, blockReason: 'PARTNER_PROCESS_EXISTS' };
  }
  if (input.settleCase !== '무통장') {
    return { cancelable: false, blockReason: 'YOUNGCART_REQUIRED' };
  }
  if (
    input.odStatus !== '주문'
    || input.ctStatus !== '주문'
    || input.receiptPrice !== 0
    || input.hasPgTransaction
  ) {
    return { cancelable: false, blockReason: 'PAYMENT_RECEIVED' };
  }
  return { cancelable: true, blockReason: null };
};
