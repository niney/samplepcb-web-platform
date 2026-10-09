import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { JwtClaims, type JwtClaimsType } from '@sp/api-contract';
import { readActAsPartnerId } from '../lib/partner-act-as';
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
    partnerContext?: {
      partnerId: bigint;
      partnerName: string;
      role: string;
      /** 관리자 대리 접속 — 관리자가 이 조직의 포털에 들어와 있다(이력 주체는 ADMIN). */
      actingAdmin: boolean;
    };
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
    // 관리자 대리 접속 — 관리자가 그 조직의 자리에서 포털을 쓴다. 소속 계정이 없어도, 조직이
    // 정지돼 있어도 들어간다(정지 조직의 진행 건을 대행으로 마무리해야 하므로). 쓰기 요청은
    // 아래 onResponse 훅이 원장에 남긴다.
    const actAs = readActAsPartnerId(request.headers);
    if (actAs !== null) {
      if (!request.user.isAdmin) {
        throw app.httpErrors.forbidden('관리자만 대리 접속할 수 있습니다');
      }
      const partner =
        actAs === 'invalid' ? null : await prisma.spPartner.findUnique({ where: { id: actAs } });
      if (partner === null) throw app.httpErrors.notFound('대리 접속할 파트너가 없습니다');
      request.partnerContext = {
        partnerId: partner.id,
        partnerName: partner.name,
        role: 'owner',
        actingAdmin: true,
      };
      return;
    }
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
      actingAdmin: false,
    };
  };
  app.decorate('requirePartner', requirePartner);

  // 대리 접속 원장 — 관리자가 조직의 자리에서 한 쓰기 요청을 1건씩 남긴다. 발주·발송 이력은
  // 각자의 주체 표기(ADMIN)를 따르지만 표기 자리가 없는 쓰기(견적 회신·하위 등록 등)도 있어,
  // "누가 그 조직으로 무엇을 했는가"의 단일 근거는 이 원장이다. 기록 실패는 요청을 막지 않는다.
  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.partnerContext;
    if (ctx?.actingAdmin !== true) return;
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    try {
      await prisma.spPartnerActLog.create({
        data: {
          partnerId: ctx.partnerId,
          partnerName: ctx.partnerName,
          adminMbId: request.user.mbId,
          method: request.method,
          path: (request.url.split('?')[0] ?? request.url).slice(0, 255),
          statusCode: reply.statusCode,
        },
      });
    } catch (err) {
      request.log.error({ err }, 'partner act log write failed');
    }
  });
});
