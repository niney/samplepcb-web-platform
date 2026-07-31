import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AdminBomOrderListQuery,
  AdminBomOrderListResponse,
} from '@sp/api-contract';
import type {
  AdminBomOrderCountsType,
  AdminBomOrderListItemType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { loadReceivedPoCounts } from '../lib/bom-po';
import { getCartOrderLinks, getOrderHeadersLite } from '../lib/g5-db';

// ── /api/admin/bom-orders — 스마트 BOM 주문·결제(주문 축) 파생 목록 (D19) ────
// 저장 없음: ctId 보유 견적 → 카트(od) → 주문 헤더 batch 로 BOM 주문만 수집하고
// Case 칩·poCount 를 결합한다. D17 배치 주문이면 한 주문에 Case 여러 개.
// 규모가 작아(월 수십 건) 전체 파생 후 메모리 페이지네이션 — 커지면 커서 재설계.
// 입금확인 등 전이 액션은 기존 PATCH /api/admin/orders/status 재사용(조작 경로 단일).

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
      const ctIds = quotes.flatMap((quote) => (quote.ctId === null ? [] : [quote.ctId]));
      const quoteIds = quotes.map((quote) => quote.id);
      const [links, poGroups, receivedCounts] = await Promise.all([
        getCartOrderLinks(ctIds),
        prisma.spBomPo.groupBy({
          by: ['quoteId'],
          where: { quoteId: { in: quoteIds } },
          _count: { _all: true },
        }),
        // 입고 발주서 수 — §6.10 조인 기반(묶음이 여러 Case 를 걸칠 수 있음)
        loadReceivedPoCounts(quoteIds),
      ]);
      const poCounts = new Map(poGroups.map((group) => [group.quoteId, group._count._all]));

      // 실주문 라인(ct_status ≠ '쇼핑')만 주문 축으로 승격 — 담김(cart)은 주문 아님.
      const quotesByOd = new Map<string, typeof quotes>();
      for (const quote of quotes) {
        if (quote.ctId === null) continue;
        const link = links.get(quote.ctId);
        if (!link?.ordered) continue;
        const list = quotesByOd.get(link.odId) ?? [];
        list.push(quote);
        quotesByOd.set(link.odId, list);
      }
      const headers = await getOrderHeadersLite([...quotesByOd.keys()]);

      const all: AdminBomOrderListItemType[] = [];
      for (const [odId, grouped] of quotesByOd) {
        const header = headers.get(odId);
        if (header === undefined) continue; // 헤더 소실(수동 삭제 등) — 목록에서 제외
        all.push({
          odId,
          orderedAt: header.orderedAt,
          mbId: header.mbId,
          odStatus: header.odStatus,
          isPaid: header.isPaid,
          settleCase: header.settleCase,
          cartPrice: header.cartPrice,
          receiptPrice: header.receiptPrice,
          misu: header.misu,
          cases: grouped.map((quote) => ({
            quoteId: String(quote.id),
            title: quote.title,
            requestedAt: quote.requestedAt?.toISOString() ?? null,
            createdAt: quote.createdAt.toISOString(),
            confirmedTotal: quote.confirmedTotal,
            poCount: poCounts.get(quote.id) ?? 0,
            poReceivedCount: receivedCounts.get(quote.id) ?? 0,
          })),
        });
      }
      all.sort((a, b) => {
        const left = a.orderedAt ?? '';
        const right = b.orderedAt ?? '';
        return left < right ? 1 : left > right ? -1 : (a.odId < b.odId ? 1 : -1);
      });

      const isAwaiting = (item: AdminBomOrderListItemType): boolean => !item.isPaid;
      const isPaidUnissued = (item: AdminBomOrderListItemType): boolean =>
        item.isPaid && item.cases.some((entry) => entry.poCount === 0);
      const counts: AdminBomOrderCountsType = {
        all: all.length,
        awaitingPayment: all.filter(isAwaiting).length,
        paidUnissued: all.filter(isPaidUnissued).length,
        done: all.filter((item) => !isAwaiting(item) && !isPaidUnissued(item)).length,
      };

      const filtered =
        tab === 'awaiting_payment'
          ? all.filter(isAwaiting)
          : tab === 'paid_unissued'
            ? all.filter(isPaidUnissued)
            : tab === 'done'
              ? all.filter((item) => !isAwaiting(item) && !isPaidUnissued(item))
              : all;
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);

      return {
        result: true as const,
        data: { items, total: filtered.length, page, pageSize, counts },
      };
    },
  );

  done();
};
