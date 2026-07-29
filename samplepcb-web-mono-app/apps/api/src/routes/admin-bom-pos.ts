import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomPoCreateBody,
  AdminBomPoCreateResponse,
  AdminBomPoListResponse,
  AdminBomPoMutationResponse,
  ApiError,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { createBomPos, loadAdminPos } from '../lib/bom-po';
import { buildBomPoIssuedEmail, sendBomRfqMail } from '../lib/rfq-email';

// ── /api/admin/bom-quotes/:id/pos — 협력사 발주서(D18) ───────────────────────
// 생성은 all-or-nothing(신중 액션): 결제 확인(od isPaid) 게이트 + 대상 행 재집계·박제.
// issued(미확인)만 삭제 가능(재발행 = 삭제 후 재생성), 마감은 issued|confirmed → closed.
// 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const PoParams = z.object({ id: z.coerce.bigint(), poId: z.coerce.bigint() });

const CREATE_ERROR_MESSAGE: Record<string, string> = {
  QUOTE_NOT_FOUND: '견적을 찾을 수 없습니다.',
  NOT_PAID: '결제 확인(입금) 후에 발주할 수 있습니다.',
  NO_ELIGIBLE_ROWS: '협력사 회신으로 선정된 부품행이 없는 협력사가 포함되어 있습니다.',
  ALREADY_ISSUED: '이미 발주서가 발행된 협력사가 포함되어 있습니다(재발행은 삭제 후).',
};

export const adminBomPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET — 발주서 목록(행 포함) ──────────────────────────────────────────────
  fastify.get(
    '/bom-quotes/:id/pos',
    { schema: { params: IdParams, response: { 200: AdminBomPoListResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      return { result: true as const, data: { pos: await loadAdminPos(quote.id) } };
    },
  );

  // ── POST — 발주서 생성(선택 협력사, all-or-nothing) + 메일 ──────────────────
  fastify.post(
    '/bom-quotes/:id/pos',
    {
      schema: {
        params: IdParams,
        body: AdminBomPoCreateBody,
        response: { 200: AdminBomPoCreateResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

      const result = await createBomPos(
        quote.id,
        request.body.partnerIds,
        request.body.memo ?? null,
      );
      if (!result.ok) {
        return reply.status(409).send({
          error: result.error,
          message: CREATE_ERROR_MESSAGE[result.error] ?? '발주서 생성에 실패했습니다.',
        });
      }

      // 발행 알림 — 비차단(실패는 로그).
      const pos = await loadAdminPos(quote.id);
      for (const partner of result.partners) {
        const po = pos.find((entry) => entry.partnerId === Number(partner.id));
        if (po === undefined) continue;
        void sendBomRfqMail(
          request.log,
          partner.contactEmail,
          buildBomPoIssuedEmail({
            partnerName: partner.name,
            quoteTitle: quote.title,
            itemCount: po.itemCount,
            totalAmount: po.totalAmount,
          }),
        );
      }
      return {
        result: true as const,
        data: { created: result.partners.length, pos },
      };
    },
  );

  // ── DELETE — 발행 취소(issued 만 — confirmed 는 협력사가 이미 본 문서) ──────
  fastify.delete(
    '/bom-quotes/:id/pos/:poId',
    {
      schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const removed = await prisma.spBomPo.deleteMany({
        where: { id: po.id, status: 'issued' },
      });
      if (removed.count === 0) {
        return reply.status(409).send({
          error: 'PO_NOT_DELETABLE',
          message: '협력사가 확인한 발주서는 삭제할 수 없습니다.',
        });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  // ── POST — 마감(issued|confirmed → closed) ──────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/pos/:poId/close',
    {
      schema: { params: PoParams, response: { 200: AdminBomPoMutationResponse, 409: ApiError } },
    },
    async (request, reply) => {
      const po = await prisma.spBomPo.findUnique({ where: { id: request.params.poId } });
      if (po?.quoteId !== request.params.id) {
        return reply.notFound('발주서를 찾을 수 없습니다');
      }
      const updated = await prisma.spBomPo.updateMany({
        where: { id: po.id, status: { in: ['issued', 'confirmed'] } },
        data: { status: 'closed', closedAt: new Date() },
      });
      if (updated.count === 0) {
        return reply
          .status(409)
          .send({ error: 'PO_ALREADY_CLOSED', message: '이미 마감된 발주서입니다.' });
      }
      return { result: true as const, data: { pos: await loadAdminPos(request.params.id) } };
    },
  );

  done();
};
