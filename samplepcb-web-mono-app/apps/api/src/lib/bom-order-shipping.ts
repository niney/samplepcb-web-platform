import { isActiveBomOrderLine } from './bom-order-cancel';
import { confirmReceiptFields, loadConfirmShippingStates } from './bom-confirm-gates';
import { getCartRowsByOdId } from './g5-db';
import { prisma } from './prisma';

export interface BomOrderReceiptCase {
  poCount: number;
  poReceivedCount: number;
  openShortageCount: number;
  /** D43 — 열린 부품 확인 이슈(고객 대기·결정됨 미적용). 하나라도 있으면 배송하지 않는다. */
  openConfirmIssueCount?: number;
  /** D43 — '먼저 온 것 먼저' 입고 대기로 첫 배송에서 빼는 발주서 수와 그중 입고된 수. */
  deferredPoCount?: number;
  deferredPoReceivedCount?: number;
  /** D43 — '모아서 한 번에' 입고 대기 중 아직 받지 못한 품목 수. */
  blockingBackorderCount?: number;
}

/**
 * 고객 배송을 열 수 있는 입고 상태인지 판정한다.
 *
 * Case마다 발주서가 최소 1건 있어야 하며, 연결된 모든 발주서가 입고 완료여야 한다.
 * 빈 Case나 일부 입고를 true로 취급하면 관리자 배송 큐가 조달보다 먼저 열리므로 명시적으로 막는다.
 * 부품 확인 요청(D43-14): 열린 이슈·'모아서' 입고 대기 미입고는 막고, '먼저 온 것 먼저' 입고 대기가 든
 * 발주서는 첫 배송 계산에서 뺀다(발주서가 입고 단위라 분할도 발주서 단위다).
 */
export const areAllBomOrderCasesReceived = (
  cases: readonly BomOrderReceiptCase[],
): boolean =>
  cases.length > 0 &&
  cases.every((entry) => {
    const deferred = entry.deferredPoCount ?? 0;
    const required = entry.poCount - deferred;
    const receivedRequired = entry.poReceivedCount - (entry.deferredPoReceivedCount ?? 0);
    return (
      required > 0 &&
      entry.openShortageCount === 0 &&
      (entry.openConfirmIssueCount ?? 0) === 0 &&
      (entry.blockingBackorderCount ?? 0) === 0 &&
      receivedRequired >= required
    );
  });

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
  const confirmStates = await loadConfirmShippingStates(quotes.map((quote) => quote.id));
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
    ...confirmReceiptFields(confirmStates.get(String(quote.id))),
  }));
  return {
    hasBomCases: quotes.length > 0,
    ready: quotes.length === 0 || areAllBomOrderCasesReceived(cases),
    cases,
  };
};
