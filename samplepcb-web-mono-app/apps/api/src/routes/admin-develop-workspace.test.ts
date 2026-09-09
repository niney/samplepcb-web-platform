import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import auth from '../plugins/auth';
import { adminDevelopWorkspaceRoutes } from './admin-develop-workspace';
import { AdminDevelopWorkspaceResponse } from '@sp/api-contract';

const db = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    spDevelopRequest: db,
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  },
}));

describe('개발 업무 목록 API', () => {
  const app = Fastify();
  let admin = '';
  let customer = '';
  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'develop-workspace-unit-test-secret');
    app.setSerializerCompiler(serializerCompiler);
    app.setValidatorCompiler(validatorCompiler);
    await app.register(sensible);
    await app.register(auth);
    await app.register(adminDevelopWorkspaceRoutes, { prefix: '/api/admin' });
    const claims = {
      mbId: 'test',
      mbNick: 'test',
      level: 2,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    admin = app.jwt.sign({ ...claims, isAdmin: true });
    customer = app.jwt.sign({ ...claims, isAdmin: false });
  });
  beforeEach(() => {
    db.findMany.mockReset().mockResolvedValue([]);
    db.groupBy.mockReset().mockResolvedValue([]);
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
  const headers = () => ({ authorization: `Bearer ${admin}` });
  it('비로그인과 일반 고객은 DB에 접근하기 전에 차단한다', async () => {
    expect((await app.inject('/api/admin/develop/workspace')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/admin/develop/workspace',
          headers: { authorization: `Bearer ${customer}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(db.findMany).not.toHaveBeenCalled();
  });
  it('업무·검색·상태를 페이지 조회에 적용하고 총 건수는 전체 범위에서 계산한다', async () => {
    db.groupBy.mockResolvedValue([
      { status: 'in_progress', _count: { _all: 21 } },
      { status: 'completed', _count: { _all: 2 } },
    ]);
    const res = await app.inject({
      url: '/api/admin/develop/workspace?section=payments&tab=in_progress&q=alpha&page=2&pageSize=20',
      headers: headers(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(AdminDevelopWorkspaceResponse.parse(res.json()).data).toMatchObject({
      total: 21,
      page: 2,
      counts: { all: 23, in_progress: 21, completed: 2 },
    });
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: {
          AND: [
            {
              AND: [
                { quotes: { some: { status: 'accepted', milestones: { some: {} } } } },
                { OR: [
                  { title: { contains: 'alpha' } }, { contactName: { contains: 'alpha' } },
                  { contactCompany: { contains: 'alpha' } }, { mbId: { contains: 'alpha' } },
                  { assigneeMbId: { contains: 'alpha' } },
                ] },
              ],
            },
            { status: { in: ['in_progress'] } },
          ],
        },
      }),
    );
  });
  it('잘못된 메뉴·페이지 요청은 거부하고 빈 결과도 계약을 지킨다', async () => {
    for (const query of ['section=unknown', 'page=0', 'pageSize=1000']) {
      expect(
        (await app.inject({ url: `/api/admin/develop/workspace?${query}`, headers: headers() }))
          .statusCode,
      ).toBe(400);
    }
    const res = await app.inject({
      url: '/api/admin/develop/workspace?section=documents',
      headers: headers(),
    });
    expect(AdminDevelopWorkspaceResponse.parse(res.json()).data).toMatchObject({
      items: [],
      total: 0,
      counts: { all: 0 },
    });
  });
});
