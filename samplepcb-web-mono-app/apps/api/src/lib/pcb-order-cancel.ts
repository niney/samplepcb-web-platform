import type { PcbOrderCancelBlockReasonType } from '@sp/api-contract';

const CANCELED_LINE_STATUSES = new Set(['취소', '반품', '품절', '삭제']);

export interface PcbOrderCancelPolicyInput {
  odStatus: string;
  ctStatus: string;
  settleCase: string;
  receiptPrice: number;
  hasPgTransaction: boolean;
  poCount: number;
}

export interface PcbOrderCancelPolicy {
  cancelable: boolean;
  blockReason: PcbOrderCancelBlockReasonType | null;
}

/** 카트행 기준 취소 완료 판정 — 부분취소에서는 주문 헤더보다 이 값이 우선한다. */
export const isPcbOrderLineCanceled = (status: string): boolean =>
  CANCELED_LINE_STATUSES.has(status);

/** 취소 이후 발주 같은 후속 이행을 열지 않기 위한 주문·라인 공통 종료 판정. */
export const isPcbOrderFulfillmentClosed = (odStatus: string, ctStatus: string): boolean =>
  isPcbOrderLineCanceled(ctStatus) || odStatus === '취소' || odStatus === '완료';

/** 주문 안에 남은 활성 형제 수 계산용. 쇼핑은 주문행이 아니고 취소류·삭제는 이미 비활성이다. */
export const isActivePcbOrderLine = (status: string): boolean =>
  status !== '쇼핑' && !isPcbOrderLineCanceled(status);

/**
 * sp-vue에서 즉시 실행해도 되는 좁은 취소 범위.
 *
 * 영카트 원본은 PG 전체취소도 지원하지만 현재 sp-node 이식 경로는 무통장 카트행 취소만
 * 보장한다. 결제·수납 증거가 있으면 로컬 상태를 먼저 바꾸지 않고 영카트 환불 경로로 보낸다.
 */
export const resolvePcbOrderCancelPolicy = (
  input: PcbOrderCancelPolicyInput,
): PcbOrderCancelPolicy => {
  if (isPcbOrderLineCanceled(input.ctStatus) || input.odStatus === '취소') {
    return { cancelable: false, blockReason: 'ALREADY_CANCELED' };
  }
  if (input.odStatus === '완료') {
    return { cancelable: false, blockReason: 'ORDER_CLOSED' };
  }
  if (input.poCount > 0) {
    return { cancelable: false, blockReason: 'PARTNER_PROCESS_EXISTS' };
  }
  if (input.settleCase !== '무통장') {
    return { cancelable: false, blockReason: 'YOUNGCART_REQUIRED' };
  }
  if (input.odStatus !== '주문' || input.receiptPrice !== 0 || input.hasPgTransaction) {
    return { cancelable: false, blockReason: 'PAYMENT_RECEIVED' };
  }
  return { cancelable: true, blockReason: null };
};
