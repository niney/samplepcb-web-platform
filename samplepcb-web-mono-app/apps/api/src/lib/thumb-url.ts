import { createHmac, timingSafeEqual } from 'node:crypto';

// 거버 썸네일 서명 URL — pathToken 을 클라이언트에 내보내지 않기 위한 프록시 링크.
// pathToken 은 파일서버 삭제 API(GET /api/delete/:pathToken, 무인증)까지 열어주는
// 토큰이라 노출 금지(HANDOFF 2장 · docs/GERBER_ORDER_FLOW.md 보안 메모).
// <img src> 는 Authorization 헤더를 못 실으므로 JWT 대신 만료 있는 HMAC 서명 쿼리로
// 보호한다. 서명은 목록 API 가 본인(mbId) 소유 spec 의 썸네일에만 발급하므로
// 소유권 검증이 URL 발급 시점에 내장된다. 무상태(HMAC)라 DB 컬럼이 필요 없다.

const THUMB_TTL_SECONDS = 15 * 60; // JWT(10분)와 같은 급의 짧은 만료 — 목록 재조회마다 재발급

const secret = (): string => {
  const s = process.env.JWT_SECRET;
  if (s === undefined || s === '') {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return s;
};

const sign = (fileId: string, exp: number): string =>
  createHmac('sha256', secret())
    .update(`thumb:${fileId}:${String(exp)}`)
    .digest('base64url');

export const signedThumbUrl = (fileId: bigint): string => {
  const exp = Math.floor(Date.now() / 1000) + THUMB_TTL_SECONDS;
  return `/api/pcb-thumbs/${String(fileId)}?exp=${String(exp)}&sig=${sign(String(fileId), exp)}`;
};

export const verifyThumbSig = (fileId: string, exp: number, sig: string): boolean => {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(fileId, exp));
  return given.length === expected.length && timingSafeEqual(given, expected);
};
