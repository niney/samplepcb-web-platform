import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Me, MeContact } from '@sp/api-contract';
import { getMemberContactRow } from '../lib/g5-db';
import { resolveMemberCompany } from '../lib/member-company';
import { prisma } from '../lib/prisma';

// GET /api/me — authenticate preHandler 로 JWT 검증 후 클레임(request.user)을 Me 로 반환.
export const meRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/me',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: Me } },
    },
    (request) => request.user,
  );

  // 회원정보 기본값 — 타인의 mbId 를 입력받지 않고 JWT 소유자만 조회한다.
  fastify.get(
    '/me/contact',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: MeContact } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const mbId = request.user.mbId;
      const row = await getMemberContactRow(mbId);
      if (row === null) throw fastify.httpErrors.notFound('회원정보를 찾을 수 없습니다');
      const profile = await prisma.spMemberProfile.findUnique({
        where: { mbId },
        select: { companyName: true },
      });
      return {
        mbId,
        name: row.name.trim() || null,
        company: resolveMemberCompany(profile?.companyName ?? null, row.legacyCompany),
        phone: row.hp.trim() || row.tel.trim() || null,
        email: row.email.trim() || null,
      };
    },
  );

  done();
};
