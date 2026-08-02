import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PartnerAccessResponse } from '@sp/api-contract';
import { prisma } from '../lib/prisma';

// ── /api/partner/access — 상단 메뉴용 협력사 접근 판정 ─────────────────────
// 포털 본문 API와 같은 소속·승인 기준을 사용하되, 메뉴 표시만 필요한 계정에는
// RFQ·발주 데이터를 읽지 않고 접근 여부와 조직명만 반환한다.

export const partnerAccessRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/partner/access',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: PartnerAccessResponse } },
    },
    async (request) => {
      const membership = await prisma.spPartnerMember.findFirst({
        where: { mbId: request.user.mbId },
        include: { partner: { select: { name: true, status: true } } },
        orderBy: { id: 'asc' },
      });
      const isPartner = membership?.partner.status === 'approved';
      return {
        result: true as const,
        data: {
          isPartner,
          partnerName: isPartner ? membership.partner.name : null,
        },
      };
    },
  );

  done();
};
