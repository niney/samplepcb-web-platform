// me.php(그누보드 인증 브리지)와 동일한 클레임 골격의 HS256 JWT 를 로컬 서명한다.
// 전제: 로컬 dev 는 PHP(SPCB_JWT_SECRET)와 Fastify(JWT_SECRET)가 같은 시크릿을 공유
// 하므로, 여기서 서명한 토큰이 실 API 인증을 그대로 통과한다(스모크 검증 완료 패턴).
// iat/exp 는 @sp/api-contract JwtClaims 가 필수로 요구한다.
import { createHmac } from 'node:crypto';
import { requireJwtSecret } from './env';

export interface JwtIdentity {
  mbId: string;
  /** 기본 mbId 동일 */
  mbNick?: string;
  /** 기본: 관리자 10, 일반 2 */
  level?: number;
  /** 관리자 API(requireAdmin)·/app/admin 가드 통과용 */
  isAdmin?: boolean;
  /** 기본 30분 — 시나리오 중 만료를 피한다(me.php 는 10분) */
  ttlSec?: number;
}

export function signJwt(identity: JwtIdentity): string {
  const isAdmin = identity.isAdmin ?? false;
  const { mbId, mbNick = mbId, level = isAdmin ? 10 : 2, ttlSec = 1800 } = identity;
  const b64u = (s: string): string => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ mbId, mbNick, level, isAdmin, iat: now, exp: now + ttlSec }));
  const sig = createHmac('sha256', requireJwtSecret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
