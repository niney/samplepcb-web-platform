import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError, PartnerInviteAcceptResponse, PartnerInviteInfoResponse } from '@sp/api-contract';
import { partnerInviteStateOf } from '../lib/partner-children';
import { prisma } from '../lib/prisma';

// ── /api/partner-invite/:token — 포털 초대 수락 ─────────────────────────────
// docs/PARTNER_PORTAL.md "하위 협력사 직접 관리". 계정 없이 등록된 조직의 담당자가
// **자기 계정으로** 포털에 들어오게 하는 1회용 링크다(회원을 대신 만들지 않는다).
//  · GET  — 공개. 토큰(64hex)이 근거이고 조직명·초대한 조직·상태만 돌려준다.
//  · POST — 로그인 필요. 수락한 계정이 조직에 owner 로 연결된다(1계정=1조직 가드는 관리자
//           계정 연결과 같은 규칙).

const TokenParams = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

const STATE_ERRORS = {
  expired: { error: 'INVITE_EXPIRED', message: '기한이 지난 초대입니다 — 초대를 다시 요청해 주세요.' },
  accepted: { error: 'INVITE_ACCEPTED', message: '이미 수락된 초대입니다.' },
  unavailable: {
    error: 'PARTNER_UNAVAILABLE',
    message: '현재 이용할 수 없는 조직입니다 — 초대한 곳에 문의해 주세요.',
  },
} as const;

const loadInvite = (token: string) =>
  prisma.spPartnerInvite.findUnique({
    where: { token },
    include: { partner: { include: { owner: { select: { name: true } } } } },
  });

export const partnerInviteRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/partner-invite/:token',
    { schema: { params: TokenParams, response: { 200: PartnerInviteInfoResponse } } },
    async (request, reply) => {
      const invite = await loadInvite(request.params.token);
      if (invite === null) return reply.notFound('유효하지 않은 초대 링크입니다');
      return {
        result: true as const,
        data: {
          partnerName: invite.partner.name,
          inviterName: invite.partner.owner?.name ?? null,
          state: partnerInviteStateOf(invite, invite.partner.status),
        },
      };
    },
  );

  fastify.post(
    '/partner-invite/:token/accept',
    {
      preHandler: fastify.authenticate,
      schema: {
        params: TokenParams,
        response: { 200: PartnerInviteAcceptResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const invite = await loadInvite(request.params.token);
      if (invite === null) return reply.notFound('유효하지 않은 초대 링크입니다');
      const state = partnerInviteStateOf(invite, invite.partner.status);
      if (state !== 'valid') return reply.status(409).send(STATE_ERRORS[state]);

      const mbId = request.user.mbId;
      // 1계정=1조직 — requirePartner 판정의 단순성 유지(관리자 계정 연결과 같은 가드).
      const linkedElsewhere = await prisma.spPartnerMember.findFirst({
        where: { mbId, NOT: { partnerId: invite.partnerId } },
      });
      if (linkedElsewhere !== null) {
        return reply.status(409).send({
          error: 'MEMBER_ALREADY_LINKED',
          message: '이 계정은 이미 다른 파트너에 연결돼 있습니다 — 다른 계정으로 로그인해 주세요.',
        });
      }

      // 1회용 — 먼저 초대를 닫고(동시 수락은 한쪽만 통과) 그다음 계정을 연결한다.
      const claimed = await prisma.spPartnerInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date(), acceptedBy: mbId },
      });
      if (claimed.count === 0) return reply.status(409).send(STATE_ERRORS.accepted);
      try {
        await prisma.spPartnerMember.create({
          data: { partnerId: invite.partnerId, mbId, role: 'owner' },
        });
      } catch (e) {
        // 이미 이 조직에 연결된 계정이 수락했다 — 결과는 같다.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
      return { result: true as const, data: { partnerName: invite.partner.name } };
    },
  );

  done();
};
