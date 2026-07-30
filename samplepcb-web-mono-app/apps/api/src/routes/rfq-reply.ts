import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError, BomRfqReplyBody, MagicRfqResponse } from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { loadRfqByMagicToken, loadRfqScopeItems, saveRfqReply, toPartnerDetail } from '../lib/bom-rfq';

// ── /api/rfq-reply/:token — 매직링크 무로그인 회신(§6.9) ─────────────────────
// 인증 = 토큰 자체(메일함 소유 = 신원). 로그인·세션 없음, 권한은 이 RFQ 1건 스코프.
// 토큰은 256bit 랜덤(무차별 대입 비현실) + 30일 상한 + 재발급 회전(lib 판정).
// GET 은 마감(closed)돼도 열람 허용(포털과 동일 — 상태를 화면이 설명), PUT 만 거부.

const TokenParams = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

export const rfqReplyRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/rfq-reply/:token',
    { schema: { params: TokenParams, response: { 200: MagicRfqResponse } } },
    async (request, reply) => {
      const rfq = await loadRfqByMagicToken(request.params.token);
      if (rfq === null) return reply.notFound('유효하지 않은 링크입니다');
      const scope = await loadRfqScopeItems(rfq.quoteId);
      return {
        result: true as const,
        data: { partnerName: rfq.partner.name, rfq: toPartnerDetail(rfq, scope) },
      };
    },
  );

  fastify.put(
    '/rfq-reply/:token',
    {
      schema: {
        params: TokenParams,
        body: BomRfqReplyBody,
        response: { 200: MagicRfqResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const rfq = await loadRfqByMagicToken(request.params.token);
      if (rfq === null) return reply.notFound('유효하지 않은 링크입니다');
      const saved = await saveRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'RFQ_CLOSED') {
          return reply.status(409).send({
            error: saved.error,
            message: '이미 마감된 견적요청입니다 — 샘플피씨비 담당자에게 문의해 주세요.',
          });
        }
        return reply
          .status(400)
          .send({ error: saved.error, message: '요청 범위에 없는 부품행이 포함되어 있습니다.' });
      }
      const fresh = await prisma.spBomRfq.findUnique({
        where: { id: rfq.id },
        include: {
          items: { orderBy: { id: 'asc' } },
          quote: { select: { title: true } },
          partner: true,
        },
      });
      if (fresh === null) return reply.notFound('유효하지 않은 링크입니다');
      const scope = await loadRfqScopeItems(fresh.quoteId);
      return {
        result: true as const,
        data: { partnerName: fresh.partner.name, rfq: toPartnerDetail(fresh, scope) },
      };
    },
  );

  done();
};
