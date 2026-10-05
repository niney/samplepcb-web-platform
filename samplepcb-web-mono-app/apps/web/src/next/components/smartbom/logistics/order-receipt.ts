import type { AdminBomOrderListItemType } from '@sp/api-contract';

// 고객 배송 판정(선적·배송 화면 ② 표와 배송 처리 대화상자가 함께 쓴다).
// 재주문 전의 취소 이력은 배송 대상이 아니다. 현재 활성 Case만 표시·판정하고, 빈 배열의
// every=true 때문에 발송 가능으로 오인하지 않도록 하나 이상 존재하는지도 확인한다.

export const activeOrderCases = (item: AdminBomOrderListItemType) =>
  item.cases.filter((entry) => entry.isCurrentAttempt && !entry.isCanceled);

export const allOrderCasesReceived = (item: AdminBomOrderListItemType): boolean => {
  const cases = activeOrderCases(item);
  return (
    cases.length > 0 &&
    cases.every((entry) => entry.poCount > 0 && entry.openShortageCount === 0 && entry.poReceivedCount >= entry.poCount)
  );
};

export const openShortageCount = (item: AdminBomOrderListItemType): number =>
  activeOrderCases(item).reduce((sum, entry) => sum + entry.openShortageCount, 0);
