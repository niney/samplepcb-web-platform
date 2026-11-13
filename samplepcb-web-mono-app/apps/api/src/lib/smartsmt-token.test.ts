import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SMARTSMT_PEER,
  SMARTSMT_SELF,
  SMARTSMT_TOKEN_LEEWAY_SECONDS,
  SMARTSMT_TOKEN_TTL_SECONDS,
  readBearerToken,
  signSmartsmtToken,
  smartsmtSecret,
  verifySmartsmtToken,
} from './smartsmt-token';

// docs/SMARTSMT_AUTH_REQUEST.html 7.3 의 검증 견본 — SmartSMT 가 자기 검사 코드를 시험하는 데 쓰는 값이다.
// 우리 검사 코드가 같은 견본에 같은 결과를 내야 두 구현이 같은 규격을 보고 있다고 말할 수 있다.
// (요청서를 고치면 .tmp/smt-tools/check-auth-doc.cjs 로 문서 쪽을, 여기서 코드 쪽을 맞춘다.)
const DOC_SECRET = 'EXAMPLE-ONLY-do-not-use-this-secret-0123456789';
const DOC_LOGIN_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzYW1wbGVwY2IiLCJhdWQiOiJzbWFydHNtdC1sb2dpbiIsInN1YiI6ImhvbmcxMjMiLCJuYW1lIjoi7ZmN6ri464-ZIiwiaWF0IjoxNzk0NTM4ODAwLCJleHAiOjE3OTQ1Mzg5MjB9.dJAixi3lK9Gyfmopw_x1YCHwaAC3vgJ8T449IIhBLec';
const DOC_API_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzYW1wbGVwY2IiLCJhdWQiOiJzbWFydHNtdCIsImlhdCI6MTc5NDUzODgwMCwiZXhwIjoxNzk0NTM4OTIwfQ.U2xa1D1bXR_Zs4ZvYi8ZTp1dZ_ce2UxAZgyeeSaXt2I';
const DOC_IAT = 1794538800; // 2026-11-13T12:00:00+09:00

const SECRET = 'unit-test-secret-0123456789abcdefghijklmnopqrstuv';
const NOW = 1_800_000_000;
const INBOUND = { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF };

/** 규격을 벗어난 토큰을 손으로 만든다(머리·내용을 마음대로). */
const craft = (header: unknown, payload: unknown, secret = SECRET): string => {
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};

describe('SmartSMT 토큰 — 요청서 7.3 의 검증 견본', () => {
  const loginAt = { iss: 'samplepcb', aud: 'smartsmt-login' };
  const apiAt = { iss: 'samplepcb', aud: 'smartsmt' };

  it('수명 안에서는 두 견본이 통과하고, 로그인 견본의 한글 이름이 깨지지 않는다', () => {
    const login = verifySmartsmtToken(DOC_LOGIN_TOKEN, DOC_SECRET, loginAt, DOC_IAT + 10);
    expect(login).toEqual({
      ok: true,
      claims: { iss: 'samplepcb', aud: 'smartsmt-login', sub: 'hong123', name: '홍길동', iat: DOC_IAT, exp: DOC_IAT + 120 },
    });
    expect(verifySmartsmtToken(DOC_API_TOKEN, DOC_SECRET, apiAt, DOC_IAT + 10).ok).toBe(true);
  });

  it('지금 시각으로 검사하면 EXPIRED', () => {
    expect(verifySmartsmtToken(DOC_LOGIN_TOKEN, DOC_SECRET, loginAt)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(verifySmartsmtToken(DOC_API_TOKEN, DOC_SECRET, apiAt)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('쓰임이 다른 자리에서는 WRONG_AUDIENCE', () => {
    expect(verifySmartsmtToken(DOC_LOGIN_TOKEN, DOC_SECRET, apiAt, DOC_IAT + 10)).toEqual({ ok: false, reason: 'WRONG_AUDIENCE' });
    expect(verifySmartsmtToken(DOC_API_TOKEN, DOC_SECRET, loginAt, DOC_IAT + 10)).toEqual({ ok: false, reason: 'WRONG_AUDIENCE' });
  });

  it('마지막 글자를 바꾸면 BAD_TOKEN', () => {
    const tampered = `${DOC_API_TOKEN.slice(0, -3)}AAA`;
    expect(verifySmartsmtToken(tampered, DOC_SECRET, apiAt, DOC_IAT + 10)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
  });
});

describe('SmartSMT 토큰 — 만들기와 검사', () => {
  it('만든 토큰은 받는 쪽 자리에서 통과하고 수명이 2분이다', () => {
    const token = signSmartsmtToken(SECRET, INBOUND, NOW);
    const result = verifySmartsmtToken(token, SECRET, INBOUND, NOW);
    expect(result).toEqual({
      ok: true,
      claims: { iss: 'smartsmt', aud: 'samplepcb', iat: NOW, exp: NOW + SMARTSMT_TOKEN_TTL_SECONDS },
    });
  });

  it('만료는 시계 오차만큼만 봐준다', () => {
    const token = signSmartsmtToken(SECRET, INBOUND, NOW);
    const edge = NOW + SMARTSMT_TOKEN_TTL_SECONDS + SMARTSMT_TOKEN_LEEWAY_SECONDS;
    expect(verifySmartsmtToken(token, SECRET, INBOUND, edge).ok).toBe(true);
    expect(verifySmartsmtToken(token, SECRET, INBOUND, edge + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('다른 비밀로 만든 토큰은 BAD_TOKEN — 우리 JWT_SECRET 으로 만든 토큰도 통하지 않는다', () => {
    const token = signSmartsmtToken('another-secret-0123456789abcdefghijklmnopqrstuv', INBOUND, NOW);
    expect(verifySmartsmtToken(token, SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
  });

  it('우리가 SmartSMT 로 보낸 토큰을 되돌려 보내도 받지 않는다 (iss·aud 반대)', () => {
    const outbound = signSmartsmtToken(SECRET, { iss: SMARTSMT_SELF, aud: SMARTSMT_PEER }, NOW);
    expect(verifySmartsmtToken(outbound, SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'WRONG_AUDIENCE' });
  });

  it('토큰이 없으면 NO_TOKEN', () => {
    expect(verifySmartsmtToken(null, SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'NO_TOKEN' });
    expect(verifySmartsmtToken('', SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'NO_TOKEN' });
  });

  it('서명 방식이 HS256 이 아니면 서명이 맞아도 BAD_TOKEN', () => {
    const payload = { iss: 'smartsmt', aud: 'samplepcb', iat: NOW, exp: NOW + 120 };
    expect(verifySmartsmtToken(craft({ alg: 'none', typ: 'JWT' }, payload), SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
    expect(verifySmartsmtToken(craft({ alg: 'HS512', typ: 'JWT' }, payload), SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
    // 서명 없는 none 토큰
    const unsigned = `${craft({ alg: 'none' }, payload).split('.').slice(0, 2).join('.')}.`;
    expect(verifySmartsmtToken(unsigned, SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
  });

  it('필수 칸이 없거나 모양이 다르면 BAD_TOKEN', () => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const cases: unknown[] = [
      { iss: 'smartsmt', aud: 'samplepcb', iat: NOW }, // exp 없음
      { iss: 'smartsmt', aud: 'samplepcb', exp: NOW + 120 }, // iat 없음
      { aud: 'samplepcb', iat: NOW, exp: NOW + 120 }, // iss 없음
      { iss: 'smartsmt', iat: NOW, exp: NOW + 120 }, // aud 없음
      { iss: 'smartsmt', aud: 'samplepcb', iat: NOW, exp: String(NOW + 120) }, // exp 가 글자
      ['not', 'an', 'object'],
    ];
    for (const payload of cases) {
      expect(verifySmartsmtToken(craft(header, payload), SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
    }
    for (const garbage of ['abc', 'a.b', 'a.b.c.d', '!!!.???.***', 'x'.repeat(5000)]) {
      expect(verifySmartsmtToken(garbage, SECRET, INBOUND, NOW)).toEqual({ ok: false, reason: 'BAD_TOKEN' });
    }
  });

  it('aud 가 배열이어도 우리 쓰임이 들어 있으면 받는다', () => {
    const token = craft({ alg: 'HS256', typ: 'JWT' }, { iss: 'smartsmt', aud: ['other', 'samplepcb'], iat: NOW, exp: NOW + 120 });
    expect(verifySmartsmtToken(token, SECRET, INBOUND, NOW).ok).toBe(true);
  });
});

describe('SmartSMT 토큰 — 헤더와 설정', () => {
  it('Authorization 헤더에서 토큰만 꺼낸다', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearerToken('bearer   abc.def.ghi  ')).toBe('abc.def.ghi');
    expect(readBearerToken(undefined)).toBeNull();
    expect(readBearerToken('abc.def.ghi')).toBeNull();
    expect(readBearerToken('Basic abc')).toBeNull();
    expect(readBearerToken('Bearer a b')).toBeNull();
  });

  it('비밀이 없거나 짧거나 JWT_SECRET 과 같으면 연동을 닫는다', () => {
    expect(smartsmtSecret({})).toBeNull();
    expect(smartsmtSecret({ SMARTSMT_SHARED_SECRET: 'short' })).toBeNull();
    expect(smartsmtSecret({ SMARTSMT_SHARED_SECRET: SECRET, JWT_SECRET: SECRET })).toBeNull();
    expect(smartsmtSecret({ SMARTSMT_SHARED_SECRET: ` ${SECRET} `, JWT_SECRET: 'something-else' })).toBe(SECRET);
  });
});
