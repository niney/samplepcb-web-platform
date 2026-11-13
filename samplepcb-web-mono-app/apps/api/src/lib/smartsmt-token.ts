import { createHmac, timingSafeEqual } from 'node:crypto';

// SmartSMT 연동 토큰 — 두 서버가 나눠 갖는 전용 비밀로 서명한 2분짜리 JWT(HS256).
// 정본: docs/SMARTSMT_INTEGRATION.md §4.2 · SmartSMT 전달 규격 docs/SMARTSMT_AUTH_REQUEST.html 3장.
//
// 쓰임은 aud 가 가른다.
//   회원 로그인 인계        iss=samplepcb aud=smartsmt-login  (sp-php spcb/sso/smartsmt.php 가 발급)
//   우리 → SmartSMT 호출    iss=samplepcb aud=smartsmt
//   SmartSMT → 우리 호출    iss=smartsmt  aud=samplepcb
//
// ⚠ 이 비밀은 JWT_SECRET 과 다른 값이어야 한다. JWT_SECRET 은 회원·관리자 토큰을 서명하므로
//   SmartSMT 가 그 값을 가지면 로그인 없이 우리 관리자 API 를 부를 수 있다. 그래서 @fastify/jwt
//   (JWT_SECRET 으로 등록됨)를 쓰지 않고 여기서 따로 서명·검증한다.

export const SMARTSMT_SELF = 'samplepcb';
export const SMARTSMT_PEER = 'smartsmt';
/** 토큰 수명(초) — 만드는 쪽 규칙. */
export const SMARTSMT_TOKEN_TTL_SECONDS = 120;
/** 받는 쪽이 봐주는 시계 오차(초). */
export const SMARTSMT_TOKEN_LEEWAY_SECONDS = 30;

/** 인증 실패 사유 — 응답 본문 `detail.reason` 에 그대로 싣는다. */
export type SmartsmtTokenFailure = 'NO_TOKEN' | 'BAD_TOKEN' | 'WRONG_AUDIENCE' | 'EXPIRED';

export interface SmartsmtTokenClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  /** 로그인 토큰만 — samplepcb 회원 아이디. */
  sub?: string;
  /** 로그인 토큰만 — 회원 이름(표시용). */
  name?: string;
}

export type SmartsmtTokenResult =
  | { ok: true; claims: SmartsmtTokenClaims }
  | { ok: false; reason: SmartsmtTokenFailure };

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 4096;

/**
 * 설정된 공유 비밀. 없거나 쓰면 안 되는 값이면 null — 호출부는 연동을 닫는다(503).
 * JWT_SECRET 과 같은 값을 넣는 실수가 가장 위험하므로 여기서 한 번 더 막는다.
 */
export function smartsmtSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env.SMARTSMT_SHARED_SECRET ?? '').trim();
  if (value.length < MIN_SECRET_LENGTH) return null;
  if (value === (env.JWT_SECRET ?? '').trim()) return null;
  return value;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const hmac = (signingInput: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(signingInput).digest();

/** 서버 간 호출용 토큰을 만든다. 요청마다 새로 만든다(만드는 비용이 거의 없다). */
export function signSmartsmtToken(
  secret: string,
  target: { iss: string; aud: string },
  now: number = nowSeconds(),
): string {
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: target.iss,
    aud: target.aud,
    iat: now,
    exp: now + SMARTSMT_TOKEN_TTL_SECONDS,
  })}`;
  return `${signingInput}.${hmac(signingInput, secret).toString('base64url')}`;
}

/** `Authorization: Bearer …` 에서 토큰만 꺼낸다. 없거나 모양이 다르면 null. */
export function readBearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  return /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1] ?? null;
}

function decodeObject(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 받은 토큰을 검사한다. 순서: 서명 방식·서명 → iss·aud → 만료.
 * `expected.aud` 는 이 자리에서 받을 쓰임 하나 — 로그인 토큰과 호출 토큰이 서로 바뀌어 쓰이지 않는다.
 */
export function verifySmartsmtToken(
  token: string | null,
  secret: string,
  expected: { iss: string; aud: string },
  now: number = nowSeconds(),
): SmartsmtTokenResult {
  if (token === null || token === '') return { ok: false, reason: 'NO_TOKEN' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'BAD_TOKEN' };

  const parts = token.split('.');
  const [headerPart, payloadPart, signaturePart] = parts;
  if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    return { ok: false, reason: 'BAD_TOKEN' };
  }

  // 서명 방식은 HS256 하나만 받는다 — `none` 이나 다른 방식으로 내려 보내는 공격을 막는다.
  if (decodeObject(headerPart)?.alg !== 'HS256') return { ok: false, reason: 'BAD_TOKEN' };

  const given = Buffer.from(signaturePart, 'base64url');
  const wanted = hmac(`${headerPart}.${payloadPart}`, secret);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: 'BAD_TOKEN' };
  }

  const payload = decodeObject(payloadPart);
  if (payload === null) return { ok: false, reason: 'BAD_TOKEN' };
  const { iss, aud, iat, exp, sub, name } = payload;
  if (typeof iss !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') {
    return { ok: false, reason: 'BAD_TOKEN' };
  }
  // JWT 표준은 aud 를 배열로도 허용한다 — 우리 쓰임이 들어 있으면 받는다.
  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : null;
  if (audiences === null) return { ok: false, reason: 'BAD_TOKEN' };

  if (iss !== expected.iss || !audiences.includes(expected.aud)) {
    return { ok: false, reason: 'WRONG_AUDIENCE' };
  }
  if (now > exp + SMARTSMT_TOKEN_LEEWAY_SECONDS) return { ok: false, reason: 'EXPIRED' };

  return {
    ok: true,
    claims: {
      iss,
      aud: expected.aud,
      iat,
      exp,
      ...(typeof sub === 'string' ? { sub } : {}),
      ...(typeof name === 'string' ? { name } : {}),
    },
  };
}
