import { isActiveBomOrderLine } from './bom-order-cancel';
import { getCartRowsByOdId } from './g5-db';
import { prisma } from './prisma';

export interface BomOrderReceiptCase {
  poCount: number;
  poReceivedCount: number;
  openShortageCount: number;
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
  cases.every(
    (entry) =>
      entry.poCount > 0 &&
      entry.openShortageCount === 0 &&
      entry.poReceivedCount >= entry.poCount,
  );

export interface BomOrderShippingReadiness {
  hasBomCases: boolean;
  ready: boolean;
  cases: BomOrderReceiptCase[];
}

/** force-status 직접 호출도 UI 경고를 우회하지 못하게 주문의 현재 활성 BOM Case를 다시
 * 읽어 배송 준비 상태를 서버에서 판정한다. BOM이 아닌 주문은 이 게이트의 대상이 아니다. */
export const loadBomOrderShippingReadiness = async (
  odId: string,
): Promise<BomOrderShippingReadiness> => {
  const cartRows = (await getCartRowsByOdId(odId)).filter((row) =>
    isActiveBomOrderLine(row.ctStatus),
  );
  const ctIds = cartRows.map((row) => row.ctId);
  if (ctIds.length === 0) return { hasBomCases: false, ready: true, cases: [] };

  const quotes = await prisma.spBomQuote.findMany({
    where: { ctId: { in: ctIds } },
    select: {
      id: true,
      pos: {
        select: {
          shipmentLink: { select: { shipment: { select: { receivedAt: true } } } },
          items: {
            select: { shortage: { select: { recoveryPoItemId: true } } },
          },
        },
      },
    },
  });
  const cases = quotes.map((quote) => ({
    poCount: quote.pos.length,
    poReceivedCount: quote.pos.filter(
      (po) => po.shipmentLink?.shipment.receivedAt != null,
    ).length,
    openShortageCount: quote.pos.reduce(
      (count, po) =>
        count +
        po.items.filter(
          (item) => item.shortage !== null && item.shortage.recoveryPoItemId === null,
        ).length,
      0,
    ),
  }));
  return {
    hasBomCases: quotes.length > 0,
    ready: quotes.length === 0 || areAllBomOrderCasesReceived(cases),
    cases,
  };
};
