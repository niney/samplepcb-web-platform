import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomOrderCancelPreviewResponse,
  AdminBomOrderCancelRequest,
  AdminBomOrderCancelResponse,
  AdminBomOrderListQuery,
  AdminBomOrderListResponse,
  ApiError,
  BOM_ORDER_CANCEL_BLOCK_LABELS,
} from '@sp/api-contract';
import type {
  AdminBomOrderCountsType,
  AdminBomOrderListItemType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { loadReceivedPoCounts } from '../lib/bom-po';
import { areAllBomOrderCasesReceived } from '../lib/bom-order-shipping';
import {
  getCartOrderAttemptsByIoIds,
  getOrderHeadersLite,
  getOrderInfoByCtId,
  setOrderItemsStatus,
} from '../lib/g5-db';
import {
  isActiveBomOrderLine,
  isBomOrderLineCanceled,
  isBomOrderLinePaid,
  resolveBomOrderCancelPolicy,
} from '../lib/bom-order-cancel';

// ── /api/admin/bom-orders — 스마트 BOM 주문·결제(주문 축) 파생 목록 (D19) ────
// 저장 없음: ctId 보유 견적 → 카트(od) → 주문 헤더 batch 로 BOM 주문만 수집하고
// Case 칩·poCount 를 결합한다. D17 배치 주문이면 한 주문에 Case 여러 개.
// 규모가 작아(월 수십 건) 전체 파생 후 메모리 페이지네이션 — 커지면 커서 재설계.
// 입금확인 등 전이 액션은 기존 PATCH /api/admin/orders/status 재사용(조작 경로 단일).

const firstNonEmpty = (...values: string[]): string =>
  values.map((value) => value.trim()).find((value) => value !== '') ?? '';

const joinNonEmpty = (values: string[], separator: string): string =>
  values.map((value) => value.trim()).filter((value) => value !== '').join(separator);

const QuoteIdParams = z.object({ quoteId: z.coerce.bigint() });

async function loadCancelPreview(quoteId: bigint) {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { id: true, title: true, ctId: true },
  });
  if (quote?.ctId === null || quote?.ctId === undefined) return null;

  const [order, poCount] = await Promise.all([
    getOrderInfoByCtId(quote.ctId),
    prisma.spBomPo.count({ where: { quoteId: quote.id } }),
  ]);
  if (order === null) return null;

  const activeSiblingCount = order.siblingCarts.filter((row) =>
    isActiveBomOrderLine(row.ctStatus),
  ).length;
  const policy = resolveBomOrderCancelPolicy({
    odStatus: order.odStatus,
    ctStatus: order.rowCtStatus,
    settleCase: order.settleCase,
    receiptPrice: order.receiptPrice,
    hasPgTransaction: order.hasPgTransaction,
    poCount,
  });

  return {
    quoteId: quote.id,
    ctId: quote.ctId,
    data: {
      quoteId: String(quote.id),
      title: quote.title,
      ctId: quote.ctId,
      odId: order.odId,
      odStatus: order.odStatus,
      ctStatus: order.rowCtStatus,
      settleCase: order.settleCase,
      receiptPrice: order.receiptPrice,
      poCount,
      activeSiblingCount,
      cancelsWholeOrder: activeSiblingCount === 0,
      cancelable: policy.cancelable,
      blockReason: policy.blockReason,
      youngcartOrderUrl: `/adm/shop_admin/orderform.php?od_id=${encodeURIComponent(order.odId)}`,
    },
  };
}

export const adminBomOrderRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/bom-orders',
    { schema: { querystring: AdminBomOrderListQuery, response: { 200: AdminBomOrderListResponse } } },
    async (request) => {
      const { page, pageSize, tab } = request.query;

      const quotes = await prisma.spBomQuote.findMany({
        where: { ctId: { not: null } },
        select: {
          id: true,
          title: true,
          requestedAt: true,
          createdAt: true,
          confirmedTotal: true,
          ctId: true,
        },
      });
      const quoteIds = quotes.map((quote) => quote.id);
      const ioIds = quotes.map((quote) => `bom-${String(quote.id)}`);
      const [attemptsByIoId, poGroups, receivedCounts] = await Promise.all([
        getCartOrderAttemptsByIoIds(ioIds),
        prisma.spBomPo.groupBy({
          by: ['quoteId'],
          where: { quoteId: { in: quoteIds } },
          _count: { _all: true },
        }),
        // 입고 발주서 수 — §6.10 조인 기반(묶음이 여러 Case 를 걸칠 수 있음)
        loadReceivedPoCounts(quoteIds),
      ]);
      const poCounts = new Map(poGroups.map((group) => [group.quoteId, group._count._all]));

      // 안정 io_id로 과거 취소 주문까지 보존한다. quote.ctId는 최신 주문 시도만 가리키며,
      // 쇼핑 행은 아직 주문이 아니므로 주문 축에서 제외한다.
      type QuoteRow = (typeof quotes)[number];
      interface QuoteAttempt {
        quote: QuoteRow;
        ctId: number;
        ctStatus: string;
        isCurrentAttempt: boolean;
      }
      const quotesByOd = new Map<string, QuoteAttempt[]>();
      for (const quote of quotes) {
        if (quote.ctId === null) continue;
        const attempts = attemptsByIoId.get(`bom-${String(quote.id)}`) ?? [];
        for (const attempt of attempts) {
          if (!attempt.ordered) continue;
          const list = quotesByOd.get(attempt.odId) ?? [];
          list.push({
            quote,
            ctId: attempt.ctId,
            ctStatus: attempt.ctStatus,
            isCurrentAttempt: quote.ctId === attempt.ctId,
          });
          quotesByOd.set(attempt.odId, list);
        }
      }
      const headers = await getOrderHeadersLite([...quotesByOd.keys()]);

      const all: AdminBomOrderListItemType[] = [];
      for (const [odId, grouped] of quotesByOd) {
        const header = headers.get(odId);
        if (header === undefined) continue; // 헤더 소실(수동 삭제 등) — 목록에서 제외
        const shippingPrice = header.sendCost + header.sendCost2;
        const cases = grouped
          .map((attempt) => {
            const isCanceled = isBomOrderLineCanceled(attempt.ctStatus);
            const activeCurrent = attempt.isCurrentAttempt && !isCanceled;
            return {
              quoteId: String(attempt.quote.id),
              ctId: attempt.ctId,
              title: attempt.quote.title,
              requestedAt: attempt.quote.requestedAt?.toISOString() ?? null,
              createdAt: attempt.quote.createdAt.toISOString(),
              confirmedTotal: attempt.quote.confirmedTotal,
              ctStatus: attempt.ctStatus,
              isCurrentAttempt: attempt.isCurrentAttempt,
              isCanceled,
              poCount: activeCurrent ? (poCounts.get(attempt.quote.id) ?? 0) : 0,
              poReceivedCount: activeCurrent
                ? (receivedCounts.get(attempt.quote.id) ?? 0)
                : 0,
            };
          })
          .sort((left, right) => left.quoteId.localeCompare(right.quoteId));
        all.push({
          odId,
          orderedAt: header.orderedAt,
          mbId: header.mbId,
          customerName: header.customerName,
          customerEmail: header.customerEmail,
          customerPhone: firstNonEmpty(header.customerHp, header.customerTel),
          recipientName: header.recipientName,
          recipientPhone: firstNonEmpty(header.recipientHp, header.recipientTel),
          recipientZip: joinNonEmpty([header.recipientZip1, header.recipientZip2], '-'),
          recipientAddress: joinNonEmpty(
            [header.recipientAddr1, header.recipientAddr2, header.recipientAddr3],
            ' ',
          ),
          odStatus: header.odStatus,
          // 부분취소 주문은 헤더 상태만으로 Case 결제를 판단할 수 없다. 현재 활성 BOM
          // 행 중 하나라도 결제 단계면 주문·결제 화면의 입금 완료 주문으로 본다.
          isPaid: cases.some(
            (entry) =>
              entry.isCurrentAttempt
              && !entry.isCanceled
              && isBomOrderLinePaid(entry.ctStatus),
          ),
          settleCase: header.settleCase,
          cartPrice: header.cartPrice,
          cancelPrice: header.cancelPrice,
          shippingPrice,
          orderPrice: Math.max(0, header.cartPrice - header.cancelPrice) + shippingPrice,
          receiptPrice: header.receiptPrice,
          misu: header.misu,
          cases,
        });
      }
      all.sort((a, b) => {
        const left = a.orderedAt ?? '';
        const right = b.orderedAt ?? '';
        return left < right ? 1 : left > right ? -1 : (a.odId < b.odId ? 1 : -1);
      });

      // 탭 판정 — 역할별 메뉴가 나눠 쓴다: 주문·결제(awaiting_payment|paid|completed),
      // 발주(paid_unissued), 선적·배송 고객 배송 큐(to_ship=전 Case 전 발주 입고 완료,
      // shipping=고객 배송 중).
      const activeCases = (item: AdminBomOrderListItemType) =>
        item.cases.filter((entry) => entry.isCurrentAttempt && !entry.isCanceled);
      const isAwaiting = (item: AdminBomOrderListItemType): boolean =>
        activeCases(item).some((entry) => entry.ctStatus === '주문');
      const isPaid = (item: AdminBomOrderListItemType): boolean =>
        activeCases(item).some((entry) => isBomOrderLinePaid(entry.ctStatus))
        && item.odStatus !== '취소';
      const isPaidUnissued = (item: AdminBomOrderListItemType): boolean =>
        activeCases(item).some(
          (entry) => isBomOrderLinePaid(entry.ctStatus) && entry.poCount === 0,
        );
      const isToShip = (item: AdminBomOrderListItemType): boolean =>
        isPaid(item) &&
        (item.odStatus === '입금' || item.odStatus === '준비') &&
        areAllBomOrderCasesReceived(activeCases(item));
      const isShipping = (item: AdminBomOrderListItemType): boolean =>
        activeCases(item).length > 0 && item.odStatus === '배송';
      const isCompleted = (item: AdminBomOrderListItemType): boolean =>
        activeCases(item).length > 0 && item.odStatus === '완료';
      const counts: AdminBomOrderCountsType = {
        all: all.length,
        awaitingPayment: all.filter(isAwaiting).length,
        paid: all.filter(isPaid).length,
        paidUnissued: all.filter(isPaidUnissued).length,
        toShip: all.filter(isToShip).length,
        shipping: all.filter(isShipping).length,
        completed: all.filter(isCompleted).length,
      };

      const TAB_FILTERS = {
        awaiting_payment: isAwaiting,
        paid: isPaid,
        paid_unissued: isPaidUnissued,
        to_ship: isToShip,
        shipping: isShipping,
        completed: isCompleted,
      } as const;
      const filtered = tab === 'all' ? all : all.filter(TAB_FILTERS[tab]);
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);

      return {
        result: true as const,
        data: { items, total: filtered.length, page, pageSize, counts },
      };
    },
  );

  // 취소 미리보기 — 묶음 주문의 대상 BOM 행·결제·발주를 서버에서 함께 판정한다.
  fastify.get(
    '/bom-orders/:quoteId/cancel-preview',
    {
      schema: {
        params: QuoteIdParams,
        response: { 200: AdminBomOrderCancelPreviewResponse },
      },
    },
    async (request, reply) => {
      const preview = await loadCancelPreview(request.params.quoteId);
      if (preview === null) return reply.notFound('취소할 BOM 주문을 찾을 수 없습니다');
      return { result: true as const, data: preview.data };
    },
  );

  // 미입금·무통장·발주 전 BOM 카트행 취소. 실행 직전 정책을 다시 읽고 g5 UPDATE에도
  // 같은 조건을 원자 가드해 입금확인과의 경합에서 결제된 주문을 취소하지 않는다.
  fastify.post(
    '/bom-orders/:quoteId/cancel',
    {
      schema: {
        params: QuoteIdParams,
        body: AdminBomOrderCancelRequest,
        response: { 200: AdminBomOrderCancelResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const preview = await loadCancelPreview(request.params.quoteId);
      if (preview === null) return reply.notFound('취소할 BOM 주문을 찾을 수 없습니다');
      if (!preview.data.cancelable) {
        const blockReason = preview.data.blockReason ?? 'ORDER_STATE_CHANGED';
        return reply.status(409).send({
          error: blockReason,
          message: BOM_ORDER_CANCEL_BLOCK_LABELS[blockReason],
        });
      }

      const outcome = await setOrderItemsStatus(
        preview.data.odId,
        [preview.ctId],
        '취소',
        request.user.mbId,
        request.ip,
        {
          requireUnpaidBankTransfer: true,
          historyReason: request.body.reason,
        },
      );
      if (!outcome.processed.includes(preview.ctId)) {
        return reply.status(409).send({
          error: 'ORDER_STATE_CHANGED',
          message: BOM_ORDER_CANCEL_BLOCK_LABELS.ORDER_STATE_CHANGED,
        });
      }

      return {
        result: true as const,
        data: {
          quoteId: String(preview.quoteId),
          ctId: preview.ctId,
          odId: preview.data.odId,
          odStatus: outcome.odStatus,
          orderCancelled: outcome.orderCancelled,
        },
      };
    },
  );

  done();
};
