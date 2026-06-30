import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { JwtClaims, type JwtClaimsType } from '@sp/api-contract';

// 타입 보강 ----------------------------------------------------------------
// `authenticate` 데코레이터(라우트 preHandler 로 사용)와 `request.user`(JWT 클레임) 타입.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
});
