import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeContact } from '@sp/api-contract';
import auth from '../plugins/auth';
import { getMemberContactRow } from '../lib/g5-db';
import { meRoutes } from './me';

vi.mock('../lib/g5-db', () => ({ getMemberContactRow: vi.fn() }));
const { profile } = vi.hoisted(() => ({ profile: vi.fn<() => Promise<{ companyName: string | null } | null>>() }));
vi.mock('../lib/prisma', () => ({ prisma: { spMemberProfile: { findUnique: profile } } }));

const member = vi.mocked(getMemberContactRow);
const app = Fastify();
const identity = { mbId: 'contact-owner', mbNick: '닉네임', level: 2, isAdmin: false };
const row = { name: ' 홍길동 ', email: ' owner@example.com ', hp: '010-1234-5678', tel: '02-123-4567', legacyCompany: '기존 회사' };

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'me-contact-unit-test-secret');
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(auth);
  await app.register(meRoutes, { prefix: '/api' });
  await app.ready();
});
beforeEach(() => {
  vi.clearAllMocks();
  member.mockResolvedValue(row);
  profile.mockResolvedValue(null);
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

const get = (url = '/api/me/contact') => app.inject({
  method: 'GET',
  url,
  headers: { authorization: `Bearer ${app.jwt.sign(identity, { expiresIn: '10m' })}` },
});

describe('본인 연락처 조회', () => {
  it('인증 없이는 DB 를 조회하지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/contact' });
    expect(res.statusCode).toBe(401);
    expect(member).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalled();
  });

  it('query 의 타인 ID 를 사용하지 않고 실명·휴대전화·회사·이메일만 반환한다', async () => {
    const res = await get('/api/me/contact?mbId=someone-else');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(member).toHaveBeenCalledExactlyOnceWith(identity.mbId);
    expect(profile).toHaveBeenCalledExactlyOnceWith({ where: { mbId: identity.mbId }, select: { companyName: true } });
    expect(res.json()).toEqual({
      mbId: identity.mbId, name: '홍길동', company: '기존 회사', phone: row.hp, email: 'owner@example.com',
    });
  });

  it('프로필 회사명을 우선하고 휴대전화가 없으면 일반전화를 사용한다', async () => {
    profile.mockResolvedValue({ companyName: ' 프로필 회사 ' });
    member.mockResolvedValue({ ...row, hp: ' ' });
    const res = await get();
    expect(MeContact.parse(res.json())).toMatchObject({ company: '프로필 회사', phone: row.tel });
  });

  it('미등록 회원정보를 닉네임이나 아이디로 추측해 채우지 않는다', async () => {
    member.mockResolvedValue({ name: '', email: '', hp: '', tel: '', legacyCompany: '' });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mbId: identity.mbId, name: null, company: null, phone: null, email: null });
  });

  it('미존재·탈퇴·차단 조회 결과는 404 이고 프로필도 반환하지 않는다', async () => {
    member.mockResolvedValue(null);
    expect((await get()).statusCode).toBe(404);
    expect(profile).not.toHaveBeenCalled();
  });

  it('기존 /me 로그인 계약에는 연락처를 추가하지 않는다', async () => {
    const res = await get('/api/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(identity);
    expect(member).not.toHaveBeenCalled();
  });
});
