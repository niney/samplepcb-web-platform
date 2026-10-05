// 결제 후 부품 확인 요청(D43) — 고객 라우트. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// 소비자: sp-php 브리지(extend/sp_bom_confirm.extend.php — 주문 상세 섹션·마이페이지 목록,
// spcb/api/bom-confirm-answer.php — 회신 POST)와 주문 상세의 추가결제 버튼(브라우저 JS, me.php 토큰).
// 소유권은 mbId 로 판정하고, 남의 요청·없는 요청은 같은 404 다.
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomConfirmAnswerBody,
  CustomerBomConfirmAnswerResponse,
  CustomerBomConfirmListQuery,
  CustomerBomConfirmListResponse,
  CustomerBomConfirmMineQuery,
  CustomerBomConfirmMineResponse,
  CustomerBomSettlementCheckoutResponse,
} from '@sp/api-contract';
import { clientIp } from '../lib/client-ip';
import {
  CHARGE_CHECKOUT_ERROR_MESSAGES,
  CONFIRM_ANSWER_ERROR_MESSAGES,
  answerConfirmRequest,
  checkoutChargeSettlement,
  listCustomerConfirmsByOrder,
  listCustomerConfirmsMine,
} from '../lib/bom-confirm';
import { prisma } from '../lib/prisma';

const RequestParams = z.object({ requestId: z.coerce.bigint() });
const SettlementParams = z.object({ settlementId: z.coerce.bigint() });

export const bomConfirmRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── 주문 상세 — 이 주문의 확인 요청 ────────────────────────────────────────
  fastify.get(
    '/bom/confirms',
    { schema: { querystring: CustomerBomConfirmListQuery, response: { 200: CustomerBomConfirmListResponse } } },
    async (request) => ({
      result: true as const,
      data: { requests: await listCustomerConfirmsByOrder(request.query.odId, request.user.mbId) },
    }),
  );

  // ── 마이페이지 — 주문을 가로지르는 내 확인 요청 ────────────────────────────
  fastify.get(
    '/bom/confirms/mine',
    { schema: { querystring: CustomerBomConfirmMineQuery, response: { 200: CustomerBomConfirmMineResponse } } },
    async (request) => ({
      result: true as const,
      data: await listCustomerConfirmsMine(request.user.mbId, request.query.scope),
    }),
  );

  // ── 회신 — 브리지가 POST+CSRF 로 중계한다(메일 링크 GET 은 아무것도 바꾸지 않는다) ─
  fastify.post(
    '/bom/confirms/:requestId/answer',
    {
      schema: {
        params: RequestParams,
        body: BomConfirmAnswerBody,
        response: { 200: CustomerBomConfirmAnswerResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await answerConfirmRequest(request.log, request.params.requestId, request.body, {
        role: 'customer',
        mbId: request.user.mbId,
      });
      if (!result.ok) {
        const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'NOT_OPEN' || result.error === 'STALE_VERSION' ? 409 : 400;
        return reply.status(status).send({ error: result.error, message: CONFIRM_ANSWER_ERROR_MESSAGES[result.error] });
      }
      const answered = await prisma.spBomConfirmRequest.findUnique({
        where: { id: request.params.requestId },
        select: { odId: true },
      });
      const requests = answered === null ? [] : await listCustomerConfirmsByOrder(answered.odId, request.user.mbId);
      const dto = requests.find((entry) => entry.id === String(request.params.requestId));
      if (dto === undefined) return reply.notFound('확인 요청을 찾을 수 없습니다');
      return { result: true as const, data: { request: dto } };
    },
  );

  // ── 추가결제 주문서 직행 ───────────────────────────────────────────────────
  fastify.post(
    '/bom/confirms/settlements/:settlementId/checkout',
    {
      schema: {
        params: SettlementParams,
        response: { 200: CustomerBomSettlementCheckoutResponse, 404: ApiError, 409: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      const result = await checkoutChargeSettlement(
        request.log,
        request.params.settlementId,
        request.user.mbId,
        request.user.cartId,
        clientIp(request),
      );
      if (!result.ok) {
        const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'ANCHOR_ITEM_MISSING' || result.error === 'CART_INSERT_FAILED' ? 503 : 409;
        return reply.status(status).send({ error: result.error, message: CHARGE_CHECKOUT_ERROR_MESSAGES[result.error] });
      }
      return { result: true as const, data: { redirectUrl: result.redirectUrl } };
    },
  );

  done();
};
