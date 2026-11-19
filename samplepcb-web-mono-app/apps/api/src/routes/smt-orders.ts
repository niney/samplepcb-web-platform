import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { SmtMyOrderListQuery, SmtMyOrderListResponse } from '@sp/api-contract';
import { listSmtOrdersOf, smartsmtOpenUrl } from '../lib/smartsmt-orders';

// ── /api/smt/orders — 고객 본인의 SMT 의뢰 목록 (docs/SMARTSMT_INTEGRATION.md §10) ─────────────────
// 마이페이지 견적관리(sp-php /shop/quotes)가 PCB · 부품 견적과 함께 SMT 의뢰를 보이려고 부른다.
// 회원 JWT 의 mbId 로만 찾는다 — 다른 회원의 의뢰는 나오지 않는다. 금액은 부가세 포함 합계다.
// 견적서 본문은 싣지 않는다(관리자 전용 값이 들어 있다). 자세한 내용은 SmartSMT 화면(openUrl)에서 본다.

export const smtOrderRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get(
    '/smt/orders',
    { schema: { querystring: SmtMyOrderListQuery, response: { 200: SmtMyOrderListResponse } } },
    async (request, reply) => {
      const { total, items } = await listSmtOrdersOf(request.user.mbId, request.query.page, request.query.pageSize);
      reply.header('cache-control', 'no-store');
      return {
        result: true as const,
        data: {
          total,
          items: items.map((row) => ({
            orderId: row.orderId,
            title: row.title,
            processes: row.processes,
            quoteId: row.quoteId,
            requestedAt: row.requestedAt.toISOString(),
            reviewStatus: row.confirmed ? ('confirmed' as const) : ('reviewing' as const),
            estimatedTotal: row.estimatedTotal,
            confirmedTotal: row.confirmedTotal,
            currency: row.currency,
            openUrl: smartsmtOpenUrl(row.orderId),
          })),
        },
      };
    },
  );

  done();
};
