import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  PartnerPoDetailResponse,
  PartnerPoListResponse,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { toPartnerPoDetail, toPartnerPoListItem } from '../lib/bom-po';

// ── /api/partner/pos — 협력사 포털: 받은 발주(D18-8) ─────────────────────────
// requirePartner 가 매 요청 소속을 서버 판정. 노출은 자기 발주서의 품목·수량·단가뿐
// (고객 식별정보는 계약 스키마에 없다). [발주 확인] = issued → confirmed.

const PoIdParams = z.object({ poId: z.coerce.bigint() });

export const partnerPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  fastify.get(
    '/partner/pos',
    { schema: { response: { 200: PartnerPoListResponse } } },
    async (request) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const pos = await prisma.spBomPo.findMany({
        where: { partnerId: ctx.partnerId },
        include: { items: true, quote: { select: { title: true } } },
        orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      });
      return { result: true as const, data: { items: pos.map(toPartnerPoListItem) } };
    },
  );

  fastify.get(
    '/partner/pos/:poId',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await prisma.spBomPo.findUnique({
        where: { id: request.params.poId },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (po?.partnerId !== ctx.partnerId) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      return { result: true as const, data: toPartnerPoDetail(po) };
    },
  );

  // [발주 확인] — issued → confirmed (동시 클릭도 1회 수렴).
  fastify.post(
    '/partner/pos/:poId/confirm',
    { schema: { params: PoIdParams, response: { 200: PartnerPoDetailResponse, 409: ApiError } } },
    async (request, reply) => {
      const ctx = request.partnerContext;
      if (ctx === undefined) throw fastify.httpErrors.forbidden();
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.partnerId !== ctx.partnerId) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const updated = await prisma.spBomPo.updateMany({
        where: { id: po.id, status: 'issued' },
        data: { status: 'confirmed', confirmedAt: new Date() },
      });
      if (updated.count === 0) {
        return reply
          .status(409)
          .send({ error: 'PO_NOT_CONFIRMABLE', message: '이미 확인되었거나 마감된 발주서입니다.' });
      }
      const fresh = await prisma.spBomPo.findUnique({
        where: { id: po.id },
        include: { items: { orderBy: { id: 'asc' } }, quote: { select: { title: true } } },
      });
      if (fresh === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: toPartnerPoDetail(fresh) };
    },
  );

  done();
};
