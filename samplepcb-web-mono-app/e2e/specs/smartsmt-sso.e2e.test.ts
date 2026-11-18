// SmartSMT 로그인 인계 — GET /spcb/sso/smartsmt (docs/SMARTSMT_INTEGRATION.md §4.2)
//
// 무엇을 지키는가:
//   ① 로그인한 회원은 등록된 SmartSMT 주소로 302 되고, 주소에 실린 토큰이 규격대로다
//      (HS256 · iss=samplepcb · aud=smartsmt-login · sub=회원 아이디 · 수명 2분)
//   ② 토큰은 SmartSMT 전용 비밀로만 검증된다 — 우리 JWT_SECRET 으로는 검증되지 않는다
//      (같은 값이면 SmartSMT 가 우리 회원·관리자 토큰을 만들 수 있게 된다)
//   ③ 비로그인은 토큰 없이 그누보드 로그인 화면으로 간다(돌아올 주소 = 인계 주소)
//   ④ state 는 좁은 글자만 받고 그대로 돌려준다
//   ⑤ 회사명 · 연락처 · 이메일은 값이 있을 때만 싣고, 그 밖의 회원 정보는 싣지 않는다
//
// 302 를 따라가지 않는다 — 따라가면 진짜 토큰이 SmartSMT 개발 서버로 나간다.
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run smartsmt-sso
// 사전: nginx · PHP(8888) · e2e/.env.e2e 고객 자격 · spcb/lib/secret.php 의 SmartSMT 설정
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  BASE_URL,
  RUN,
  apiDir,
  closeBrowser,
  disconnectPrisma,
  getBrowser,
  getPrisma,
  newPhpSession,
  requireCustomerCreds,
  requireJwtSecret,
  type PhpLoginResult,
} from '../helpers';

const SSO_URL = `${BASE_URL}/spcb/sso/smartsmt`;

/** apps/api/.env 의 SmartSMT 전용 비밀 — 값은 로그·단언 메시지에 싣지 않는다. */
function readSmartsmtSecret(): string {
  const text = readFileSync(join(apiDir, '.env'), 'utf8');
  const value = /^SMARTSMT_SHARED_SECRET=(.*)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
  if (value === '') throw new Error('apps/api/.env 에 SMARTSMT_SHARED_SECRET 이 없습니다');
  return value;
}

const signatureOf = (signingInput: string, secret: string): string =>
  createHmac('sha256', secret).update(signingInput).digest('base64url');

function decodeToken(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signingInput: string; signature: string } {
  const [h = '', p = '', s = ''] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>,
    signingInput: `${h}.${p}`,
    signature: s,
  };
}

describe.skipIf(!RUN)('SmartSMT 로그인 인계 — /spcb/sso/smartsmt', () => {
  let customer: PhpLoginResult;

  beforeAll(async () => {
    customer = await newPhpSession(requireCustomerCreds());
  });

  afterAll(async () => {
    await customer?.close();
    await closeBrowser();
    await disconnectPrisma();
  });

  test('로그인한 회원 → 등록된 주소로 302, 토큰이 규격대로다', async () => {
    const state = 'k3Jx8QpL_-09';
    const before = Math.floor(Date.now() / 1000);
    const res = await customer.context.request.get(`${SSO_URL}?state=${state}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['cache-control']).toContain('no-store');

    const location = new URL(res.headers().location ?? '');
    // 돌려보내는 곳은 설정값뿐 — 우리 사이트가 아니어야 하고 state 가 그대로 돌아온다.
    expect(location.origin).not.toBe(new URL(BASE_URL).origin);
    expect(location.searchParams.get('state')).toBe(state);

    const token = location.searchParams.get('token') ?? '';
    const { header, claims, signingInput, signature } = decodeToken(token);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(claims.iss).toBe('samplepcb');
    expect(claims.aud).toBe('smartsmt-login');
    expect(claims.sub).toBe(customer.mbId);
    expect(typeof claims.name).toBe('string');
    expect(Number(claims.exp) - Number(claims.iat)).toBe(120);
    expect(Math.abs(Number(claims.iat) - before)).toBeLessThanOrEqual(60);
    // 넘기는 회원 정보 — 아이디 · 이름은 늘, 회사명 · 연락처 · 이메일은 값이 있을 때만. 그 밖의 칸은 없다.
    const rows = (await getPrisma().$queryRawUnsafe(
      `SELECT m.mb_hp, m.mb_tel, m.mb_email, m.mb_2, p.companyName
         FROM g5_member m LEFT JOIN sp_member_profile p ON p.mbId = m.mb_id
        WHERE m.mb_id = ?`,
      customer.mbId,
    )) as { mb_hp: string | null; mb_tel: string | null; mb_email: string | null; mb_2: string | null; companyName: string | null }[];
    const row = rows[0];
    if (row === undefined) throw new Error('g5_member 에 고객 계정이 없습니다');
    const clean = (value: string | null): string => (value ?? '').trim();
    const email = clean(row.mb_email);
    const expected: Record<string, string> = {};
    const company = clean(row.companyName) || clean(row.mb_2);
    const phone = clean(row.mb_hp) || clean(row.mb_tel);
    if (company !== '') expected.company = company;
    if (phone !== '') expected.phone = phone;
    if (email !== '' && email.toLowerCase() !== customer.mbId.toLowerCase()) expected.email = email;

    expect(Object.keys(claims).sort()).toEqual([...Object.keys(expected), 'aud', 'exp', 'iat', 'iss', 'name', 'sub'].sort());
    for (const [key, value] of Object.entries(expected)) expect(claims[key]).toBe(value);
    // 빈 글자를 보내지 않는다 — 없는 값은 칸 자체가 없다.
    for (const key of ['company', 'phone', 'email']) expect(claims[key]).not.toBe('');

    // SmartSMT 전용 비밀로는 검증되고, 우리 JWT_SECRET 으로는 검증되지 않는다.
    expect(signatureOf(signingInput, readSmartsmtSecret()) === signature).toBe(true);
    expect(signatureOf(signingInput, requireJwtSecret()) === signature).toBe(false);
  });

  test('state 없이도 동작하고, 주소에 state 를 붙이지 않는다', async () => {
    const res = await customer.context.request.get(SSO_URL, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = new URL(res.headers().location ?? '');
    expect(location.searchParams.has('state')).toBe(false);
    expect(location.searchParams.get('token')).not.toBe('');
  });

  test('state 에 허용하지 않는 글자 → 400, 토큰을 만들지 않는다', async () => {
    for (const bad of ['a b', '<script>', 'x'.repeat(201), 'a&token=evil', 'https://evil.example']) {
      const res = await customer.context.request.get(`${SSO_URL}?state=${encodeURIComponent(bad)}`, { maxRedirects: 0 });
      expect(res.status(), bad.slice(0, 20)).toBe(400);
      expect(res.headers().location).toBeUndefined();
    }
  });

  test('우리 로그인 토큰(/spcb/api/me)은 SmartSMT 화면에 주지 않는다 — 다른 하위 도메인은 그대로', async () => {
    // /spcb/api/me 의 토큰은 그 회원으로 우리 /api 전체를 부를 수 있다. SmartSMT 는 인계 주소의 별도 토큰만 받는다.
    const me = `${BASE_URL}/spcb/api/me`;
    const blocked = await customer.context.request.get(me, { headers: { origin: 'https://smteyes.samplepcb.co.kr' } });
    expect(blocked.headers()['access-control-allow-origin']).toBeUndefined();
    expect(blocked.headers()['access-control-allow-credentials']).toBeUndefined();
    // 대소문자를 바꿔도 통하지 않는다.
    const mixed = await customer.context.request.get(me, { headers: { origin: 'https://SMTEYES.samplepcb.co.kr' } });
    expect(mixed.headers()['access-control-allow-origin']).toBeUndefined();
    // 우리 거버 뷰어(다른 하위 도메인)는 지금처럼 받는다.
    const gerber = await customer.context.request.get(me, { headers: { origin: 'https://local-gerber.samplepcb.co.kr' } });
    expect(gerber.headers()['access-control-allow-origin']).toBe('https://local-gerber.samplepcb.co.kr');
    expect(gerber.headers()['access-control-allow-credentials']).toBe('true');
  });

  test('비로그인 → 토큰 없이 로그인 화면으로, 돌아올 주소는 인계 주소다', async () => {
    const browser = await getBrowser();
    const anonymous = await browser.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    try {
      const res = await anonymous.request.get(`${SSO_URL}?state=abc`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      const location = new URL(res.headers().location ?? '');
      expect(location.origin).toBe(new URL(BASE_URL).origin);
      expect(location.pathname).toBe('/bbs/login.php');
      expect(location.searchParams.get('url')).toBe(`${SSO_URL}?state=abc`);
      expect(location.searchParams.has('token')).toBe(false);
    } finally {
      await anonymous.close();
    }
  });
});
