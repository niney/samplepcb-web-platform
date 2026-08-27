import type { FastifyPluginOptions, FastifyRequest } from 'fastify';

// ── 서비스 액터 — 사내 다른 서비스가 부르는 BOM API(/api/svc) 의 인증 대체 ─────
// 라우트 본문은 request.user.mbId 만 보므로, 고정 회원 ID 를 주입하면 회원 경로와
// 똑같은 코드가 그대로 돈다(라우트·계약 복제 없음). 소유 확인(assertJobAccess·
// loadOwnQuote)이 살아 있어 실제 고객의 잡·견적은 이 경로에서도 계속 차단된다.
// 접근 통제는 네트워크 경계(nginx 의 /api/svc allow/deny)가 담당한다.
export interface ActorRouteOptions extends FastifyPluginOptions {
  /** 'service' = 사내 서비스 호출(/api/svc). 생략하면 회원 JWT 인증. */
  actor?: 'member' | 'service';
}

export const SERVICE_MB_ID = process.env.SVC_BOM_MB_ID ?? 'apibot';

/** 서비스 액터 소유인지 — 회원 단위 비용 게이트를 면제할 때 쓴다. */
export function isServiceMbId(mbId: string): boolean {
  return mbId === SERVICE_MB_ID;
}

/** preHandler — JWT 검증 대신 서비스 계정 클레임을 세운다(만료 개념 없음).
 *  Fastify 훅은 done 을 부르거나 thenable 을 돌려줘야 한다 — 동기 void 훅은 요청이 멈춘다. */
export function serviceActorHook(request: FastifyRequest): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  request.user = {
    mbId: SERVICE_MB_ID,
    mbNick: 'API',
    level: 1,
    isAdmin: false,
    iat: now,
    exp: now + 600,
  };
  return Promise.resolve();
}
