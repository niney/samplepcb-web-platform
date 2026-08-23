import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  BomRfqReplyBody,
  PartnerRfqDetailResponse,
  PartnerRfqListResponse,
} from '@sp/api-contract';
import { loadOwnStockForItems } from '../lib/partner-parts';
import { prisma } from '../lib/prisma';
import {
  filterScopeForRfq,
  loadRfqScopeItems,
  saveRfqReply,
  toPartnerDetail,
  toPartnerListItem,
} from '../lib/bom-rfq';

// ── /api/partner/rfqs — 협력사 포털(받은 견적요청 워크큐·회신) ────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §4. requirePartner 가 매 요청 소속을 서버 판정.
// 노출은 부품행(MPN·제조사·수량)과 자신의 회신뿐 — 고객 식별정보·목표단가는
// 계약 스키마에 없어 구조적으로 탈락한다(D8). 재회신은 마감(closed) 전까지 허용.

const RfqIdParams = z.object({ rfqId: z.coerce.bigint() });

export const partnerRfqRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  // ── GET /api/partner/rfqs — 워크큐(회신할 것/회신한 것은 클라 분리) ────────
  fastify.get(
    '/partner/rfqs',
    { schema: { response: { 200: PartnerRfqListResponse } } },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfqs = await prisma.spBomRfq.findMany({
        where: { partnerId: ctx.partnerId },
        include: { items: true, quote: { select: { title: true } } },
        orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      });
      const items = await Promise.all(
        rfqs.map(async (rfq) => {
          // 부분 행 선택(§6.13) — 협력사가 보는 품목 수 = 자기 요청 범위만
          const scope = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId), rfq);
          return toPartnerListItem(rfq, scope.length);
        }),
      );
      return { result: true as const, data: { items, partnerName: ctx.partnerName } };
    },
  );

  // ── GET /api/partner/rfqs/:rfqId — 상세(부품행 + 내 회신) ──────────────────
  fastify.get(
    '/partner/rfqs/:rfqId',
    { schema: { params: RfqIdParams, response: { 200: PartnerRfqDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({
        where: { id: request.params.rfqId },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.partnerId !== ctx.partnerId) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      const scope = filterScopeForRfq(await loadRfqScopeItems(rfq.quoteId), rfq);
      return { result: true as const, data: toPartnerDetail(rfq, scope, await loadOwnStockForItems(rfq.partnerId, scope)) };
    },
  );

  // ── PUT /api/partner/rfqs/:rfqId — 회신 저장(행 일괄 replace-all) ──────────
  fastify.put(
    '/partner/rfqs/:rfqId',
    {
      schema: {
        params: RfqIdParams,
        body: BomRfqReplyBody,
        response: { 200: PartnerRfqDetailResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const rfq = await prisma.spBomRfq.findUnique({ where: { id: request.params.rfqId } });
      if (rfq === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      if (rfq.partnerId !== ctx.partnerId) {
        return reply.notFound('견적요청을 찾을 수 없습니다');
      }
      const saved = await saveRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'RFQ_CLOSED') {
          return reply
            .status(409)
            .send({ error: saved.error, message: '마감된 견적요청에는 회신할 수 없습니다.' });
        }
        return reply
          .status(400)
          .send({ error: saved.error, message: '요청 범위에 없는 부품행이 포함되어 있습니다.' });
      }
      const updated = await prisma.spBomRfq.findUnique({
        where: { id: rfq.id },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (updated === null) return reply.notFound('견적요청을 찾을 수 없습니다');
      const scope = filterScopeForRfq(await loadRfqScopeItems(updated.quoteId), updated);
      return { result: true as const, data: toPartnerDetail(updated, scope, await loadOwnStockForItems(updated.partnerId, scope)) };
    },
  );

  done();
};
