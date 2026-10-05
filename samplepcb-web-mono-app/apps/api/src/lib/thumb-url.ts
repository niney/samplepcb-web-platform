import { createHmac, timingSafeEqual } from 'node:crypto';

// 거버 썸네일 서명 URL — pathToken 을 클라이언트에 내보내지 않기 위한 프록시 링크.
// pathToken 은 파일서버 삭제 API(GET /api/delete/:pathToken, 무인증)까지 열어주는
// 토큰이라 노출 금지(HANDOFF 2장 · docs/GERBER_ORDER_FLOW.md 보안 메모).
// <img src> 는 Authorization 헤더를 못 실으므로 JWT 대신 만료 있는 HMAC 서명 쿼리로
// 보호한다. 서명은 목록 API 가 본인(mbId) 소유 spec 의 썸네일에만 발급하므로
// 소유권 검증이 URL 발급 시점에 내장된다. 무상태(HMAC)라 DB 컬럼이 필요 없다.

// JWT(10분)와 같은 급의 짧은 만료. 만료 시각은 이 길이의 창 경계에 맞춘다(아래 signedThumbUrl).
const THUMB_TTL_SECONDS = 15 * 60;

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

// exp 를 "지금 + TTL" 로 두면 초마다 URL 이 달라져, 응답의 Cache-Control(max-age)이 있어도 브라우저
// 캐시가 한 번도 적중하지 않는다 — 목록을 볼 때마다 카드 수만큼 파일서버를 왕복했다. 그래서 exp 를
// TTL 창의 경계(다음다음 경계)에 맞춘다: 같은 창 안에서 발급한 URL 은 같고, 남은 유효 시간은
// 항상 TTL 초과 ~ 2×TTL 이하(15~30분)다.
export const thumbExpiry = (nowSeconds: number): number =>
  (Math.floor(nowSeconds / THUMB_TTL_SECONDS) + 2) * THUMB_TTL_SECONDS;

export const signedThumbUrl = (fileId: bigint): string => {
  const exp = thumbExpiry(Math.floor(Date.now() / 1000));
  return `/api/pcb-thumbs/${String(fileId)}?exp=${String(exp)}&sig=${sign(String(fileId), exp)}`;
};

export const verifyThumbSig = (fileId: string, exp: number, sig: string): boolean => {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(fileId, exp));
  return given.length === expected.length && timingSafeEqual(given, expected);
};
