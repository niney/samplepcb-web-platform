import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { JwtClaims, type JwtClaimsType } from '@sp/api-contract';
import { prisma } from '../lib/prisma';

// 타입 보강 ----------------------------------------------------------------
// `authenticate` 데코레이터(라우트 preHandler 로 사용)와 `request.user`(JWT 클레임) 타입.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePartner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** requirePartner 통과 시 세팅되는 소속 조직 컨텍스트. */
    partnerContext?: { partnerId: bigint; partnerName: string; role: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // request.user 의 반환 타입 = 그누보드가 발급한 JWT 클레임
    user: JwtClaimsType;
  }
}

// 그누보드(extend/)가 발급한 JWT 를 검증만 한다. Node 는 그누보드 DB 에 직접 접근하지 않고
// 회원 식별을 JWT 클레임(mbId/mbNick/level/isAdmin)으로만 한다.
// 데코레이터를 형제 라우트 플러그인과 공유하기 위해 fastify-plugin 으로 캡슐화를 깬다.
export default fp(async (app: FastifyInstance) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  await app.register(fastifyJwt, { secret });

  const authenticate: FastifyInstance['authenticate'] = async (request) => {
    try {
      await request.jwtVerify();
      // 검증된 토큰 페이로드를 계약(Zod)으로 한 번 더 검사해 request.user 에 둔다.
      request.user = JwtClaims.parse(request.user);
    } catch {
      throw app.httpErrors.unauthorized('Invalid or missing authentication token');
    }
  };

  app.decorate('authenticate', authenticate);

  // 관리자 전용 가드 — authenticate 를 내부 호출로 조합해 라우트에 이것 하나만 건다
  // (preHandler 배열식은 authenticate 누락 사고 여지). isAdmin 판정은 그누보드
  // me.php(cf_admin 1인)가 하며 여기서는 서명된 클레임만 신뢰한다.
  const requireAdmin: FastifyInstance['requireAdmin'] = async (request, reply) => {
    await authenticate(request, reply);
    if (!request.user.isAdmin) {
      throw app.httpErrors.forbidden('관리자 권한이 필요합니다');
    }
  };
  app.decorate('requireAdmin', requireAdmin);

  // 파트너(협력사) 가드 — JWT 에 조직 클레임을 싣지 않고 sp_partner_member 를 매 요청
  // 서버 판정한다(server-single-truth, docs/SMARTBOM_PARTNER_RFQ.md §1.2). 연결 해제·
  // 정지가 토큰 재발급 없이 즉시 반영된다. sp_* 는 Node 소유 테이블이라 "그누보드 DB
  // 비접근" 원칙과 무관하다. 1계정=1조직 운영 가드(관리자 API)로 소속은 최대 1행.
  const requirePartner: FastifyInstance['requirePartner'] = async (request, reply) => {
    await authenticate(request, reply);
    const membership = await prisma.spPartnerMember.findFirst({
      where: { mbId: request.user.mbId },
      include: { partner: true },
      orderBy: { id: 'asc' },
    });
    if (membership === null) {
      throw app.httpErrors.forbidden('승인된 파트너 계정이 아닙니다');
    }
    if (membership.partner.status !== 'approved') {
      throw app.httpErrors.forbidden('승인된 파트너 계정이 아닙니다');
    }
    request.partnerContext = {
      partnerId: membership.partnerId,
      partnerName: membership.partner.name,
      role: membership.role,
    };
  };
  app.decorate('requirePartner', requirePartner);
});
