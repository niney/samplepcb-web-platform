export interface BomOrderReceiptCase {
  poCount: number;
  poReceivedCount: number;
}

/**
 * 고객 배송을 열 수 있는 입고 상태인지 판정한다.
 *
 * Case마다 발주서가 최소 1건 있어야 하며, 연결된 모든 발주서가 입고 완료여야 한다.
 * 빈 Case나 일부 입고를 true로 취급하면 관리자 배송 큐가 조달보다 먼저 열리므로 명시적으로 막는다.
 */
export const areAllBomOrderCasesReceived = (
  cases: readonly BomOrderReceiptCase[],
): boolean =>
  cases.length > 0 &&
  cases.every((entry) => entry.poCount > 0 && entry.poReceivedCount >= entry.poCount);
