import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { SpPartner } from '@prisma/client';
import { PartnerAccessResponse } from '@sp/api-contract';
import { toCapabilities } from '../lib/partner';
import { readActAsPartnerId } from '../lib/partner-act-as';
import { canManageChildren } from '../lib/partner-children';
import { prisma } from '../lib/prisma';

// ── /api/partner/access — 상단 메뉴용 협력사 접근 판정 ─────────────────────
// 포털 본문 API와 같은 소속·승인 기준을 사용하되, 메뉴 표시만 필요한 계정에는
// RFQ·발주 데이터를 읽지 않고 접근 여부·조직명·참여 트랙만 반환한다.
// tracks(포털 재설계 R1) = 조직 capabilities 파생 — 모듈 스위처·진입 리졸버의
// 단일 근거. 관리자가 파트너 관리에서 트랙을 바꾸면 다음 조회부터 반영된다.
// 관리자 대리 접속(ACT_AS_PARTNER_HEADER)이면 그 조직의 판정을 돌려준다 — 정지된 조직도
// 연다(requirePartner 와 같은 규칙, lib/partner-act-as.ts).

const NO_ACCESS = {
  isPartner: false,
  partnerName: null,
  tracks: { bom: false, pcb: false, parts: false },
  canManageChildren: false,
  actingAdmin: false,
};

const accessOf = async (partner: SpPartner, actingAdmin: boolean) => {
  const capabilities = toCapabilities(partner.capabilities);
  return {
    isPartner: true,
    partnerName: partner.name,
    tracks: {
      bom: capabilities.includes('bom_rfq'),
      pcb: capabilities.includes('pcb_rfq'),
      // parts 는 모듈이 아니라 공통 영역(수금과 같은 자리) — 스위처에 뜨지 않는다.
      parts: capabilities.includes('part_sale'),
    },
    canManageChildren: await canManageChildren(partner),
    actingAdmin,
  };
};

export const partnerAccessRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/partner/access',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: PartnerAccessResponse } },
    },
    async (request, reply) => {
      const actAs = readActAsPartnerId(request.headers);
      if (actAs !== null) {
        if (!request.user.isAdmin) return reply.forbidden('관리자만 대리 접속할 수 있습니다');
        const partner =
          actAs === 'invalid' ? null : await prisma.spPartner.findUnique({ where: { id: actAs } });
        if (partner === null) return reply.notFound('대리 접속할 파트너가 없습니다');
        return { result: true as const, data: await accessOf(partner, true) };
      }

      const membership = await prisma.spPartnerMember.findFirst({
        where: { mbId: request.user.mbId },
        include: { partner: true },
        orderBy: { id: 'asc' },
      });
      if (membership?.partner.status !== 'approved') {
        return { result: true as const, data: NO_ACCESS };
      }
      return { result: true as const, data: await accessOf(membership.partner, false) };
    },
  );

  done();
};
