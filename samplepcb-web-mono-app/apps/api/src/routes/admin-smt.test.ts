import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../plugins/auth';
import { downloadFromFileServer } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import { pullSmartsmtQuote } from '../lib/smartsmt-pull';
import type * as SmartsmtPull from '../lib/smartsmt-pull';
import { adminSmtRoutes } from './admin-smt';

const { db } = vi.hoisted(() => ({
  db: {
    spSmtOrder: { findMany: vi.fn(), count: vi.fn() },
    spSmtQuote: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    spFile: { findMany: vi.fn(), findUnique: vi.fn() },
    spSmtReceiveLog: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  },
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/g5-db', () => ({ getMembersByIds: vi.fn() }));
vi.mock('../lib/file-server', () => ({ downloadFromFileServer: vi.fn(), uploadToFileServer: vi.fn(), deleteFromFileServer: vi.fn() }));
vi.mock('../lib/smartsmt-pull', async (original) => ({
  ...(await original<typeof SmartsmtPull>()),
  pullSmartsmtQuote: vi.fn(),
}));

const pull = vi.mocked(pullSmartsmtQuote);
const members = vi.mocked(getMembersByIds);
const download = vi.mocked(downloadFromFileServer);
const app = Fastify();
const admin = { mbId: 'admin', mbNick: '관리자', level: 10, isAdmin: true };
const member = { mbId: 'hong123', mbNick: '홍길동', level: 2, isAdmin: false };
const JWT_SECRET = 'admin-smt-unit-test-secret-0123456789abcdef';
const SHARED = 'admin-smt-shared-secret-0123456789abcdefghijklmn';

/** 응답 본문의 느슨한 모양 — 단언에 필요한 칸만. */
interface Body {
  data: Record<string, unknown> & { items: Record<string, unknown>[]; total: number; counts: unknown };
}

const at = (iso: string): Date => new Date(iso);
const quoteRow = (over: Record<string, unknown> = {}) => ({
  id: 70n,
  quoteId: 'Q-1',
  source: 'push',
  madeAt: at('2026-11-13T03:00:00Z'),
  receivedAt: at('2026-11-13T03:00:05Z'),
  currency: 'KRW',
  strategy: 'SAMPLE',
  quoteStatus: 'CALCULATED',
  quantity: 20,
  smtTotal: new Prisma.Decimal(1042826),
  finalTotal: new Prisma.Decimal(1186232),
  smtEstimatedTotal: null,
  finalEstimatedTotal: null,
  blockedBy: [],
  ...over,
});
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 7n,
  orderId: 'O-1',
  ownerMbId: 'hong123',
  ownerName: '홍길동',
  latestQuoteId: 70n,
  quoteCount: 2,
  adminMemo: null,
  firstReceivedAt: at('2026-11-12T01:00:00Z'),
  lastReceivedAt: at('2026-11-13T03:00:05Z'),
  createdAt: at('2026-11-12T01:00:00Z'),
  updatedAt: at('2026-11-13T03:00:05Z'),
  ...over,
});

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  vi.stubEnv('JWT_SECRET', JWT_SECRET);
  await app.register(sensible);
  await app.register(auth);
  await app.register(adminSmtRoutes, { prefix: '/api/admin' });
  await app.ready();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', JWT_SECRET);
  vi.stubEnv('SMARTSMT_SHARED_SECRET', SHARED);
  vi.stubEnv('SMARTSMT_BASE_URL', 'http://smartsmt.test:8090/');
  members.mockResolvedValue(new Map());
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

const call = (method: 'GET' | 'POST', url: string, options: { identity?: typeof admin | null; body?: unknown } = {}) => {
  const identity = options.identity === undefined ? admin : options.identity;
  return app.inject({
    method,
    url: `/api/admin${url}`,
    headers: identity === null ? {} : { authorization: `Bearer ${app.jwt.sign(identity, { expiresIn: '10m' })}` },
    ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
  });
};

describe('SmartSMT 관리자 API — 권한', () => {
  it.each([
    ['GET', '/smt/orders'],
    ['GET', '/smt/quotes/70'],
    ['GET', '/smt/files/5'],
    ['GET', '/smt/receive-logs'],
    ['GET', '/smt/link-status'],
    ['POST', '/smt/pull'],
  ] as const)('%s %s — 비로그인 401, 일반 회원 403, 아무것도 조회하지 않는다', async (method, url) => {
    const body = method === 'POST' ? { orderId: 'O-1' } : undefined;
    expect((await call(method, url, { identity: null, body })).statusCode).toBe(401);
    expect((await call(method, url, { identity: member, body })).statusCode).toBe(403);
    for (const model of Object.values(db)) for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});

describe('SmartSMT 관리자 API — 받은 견적 목록', () => {
  beforeEach(() => {
    db.spSmtOrder.count.mockResolvedValue(0);
    db.spSmtOrder.findMany.mockResolvedValue([]);
  });

  it('주문 한 줄에 마지막 견적을 붙여 준다 — 금액은 숫자, 미정은 null', async () => {
    db.spSmtOrder.findMany.mockResolvedValue([
      { ...orderRow(), latestQuote: quoteRow() },
      { ...orderRow({ id: 8n, orderId: 'O-2', ownerMbId: 'ghost', latestQuoteId: 80n }), latestQuote: quoteRow({ id: 80n, quoteId: 'Q-2', finalTotal: null, blockedBy: ['PCB'], quoteStatus: 'REVIEW_REQUIRED' }) },
      { ...orderRow({ id: 9n, orderId: 'O-3', ownerMbId: null, ownerName: null, latestQuoteId: null }), latestQuote: null },
    ]);
    db.spSmtOrder.count.mockResolvedValueOnce(3).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    members.mockResolvedValue(new Map([['hong123', {} as never]]));

    const res = await call('GET', '/smt/orders');
    expect(res.statusCode).toBe(200);
    const data = res.json<Body>().data;
    expect(data.total).toBe(3);
    expect(data.counts).toEqual({ all: 3, review: 1, undetermined: 1 });
    expect(data.items[0]).toMatchObject({
      id: 7,
      orderId: 'O-1',
      ownerIsMember: true,
      quoteCount: 2,
      latest: { id: 70, quoteId: 'Q-1', smtTotal: 1042826, finalTotal: 1186232, blockedBy: [], madeAt: '2026-11-13T03:00:00.000Z' },
    });
    // 우리 회원이 아닌 아이디는 false, 아이디가 오지 않았으면 null(모름).
    expect(data.items[1]).toMatchObject({ ownerIsMember: false, latest: { finalTotal: null, blockedBy: ['PCB'] } });
    expect(data.items[2]).toMatchObject({ ownerIsMember: null, latest: null });
    expect(members).toHaveBeenCalledWith(['hong123', 'ghost']);
    // 목록은 견적서 본문을 읽지 않는다.
    const args = db.spSmtOrder.findMany.mock.calls[0]?.[0] as { include: { latestQuote: { select: Record<string, unknown> } } };
    expect(args.include.latestQuote.select).not.toHaveProperty('envelope');
  });

  it('확정 금액이 미정인 견적은 추정 금액을 따로 준다 — 확정 자리에 넣지 않는다', async () => {
    db.spSmtOrder.findMany.mockResolvedValue([
      {
        ...orderRow(),
        latestQuote: quoteRow({
          smtTotal: null,
          finalTotal: null,
          smtEstimatedTotal: new Prisma.Decimal(396979),
          finalEstimatedTotal: new Prisma.Decimal(509575),
          blockedBy: ['PARTS', 'SHIPPING', 'DETAIL'],
          quoteStatus: 'REVIEW_REQUIRED',
        }),
      },
    ]);
    const res = await call('GET', '/smt/orders');
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().data.items[0]?.latest).toMatchObject({
      smtTotal: null,
      finalTotal: null,
      smtEstimatedTotal: 396979,
      finalEstimatedTotal: 509575,
    });
  });

  it('탭과 검색어가 조건으로 들어간다', async () => {
    await call('GET', '/smt/orders?tab=review');
    expect((db.spSmtOrder.findMany.mock.calls[0]?.[0] as { where: unknown }).where).toEqual({
      latestQuote: { is: { quoteStatus: 'REVIEW_REQUIRED' } },
    });
    await call('GET', '/smt/orders?tab=undetermined&search=hong&page=2&pageSize=10');
    const args = db.spSmtOrder.findMany.mock.calls[1]?.[0] as { where: Record<string, unknown>; skip: number; take: number };
    expect(args.where).toEqual({
      latestQuote: { is: { finalTotal: null } },
      OR: [{ orderId: { contains: 'hong' } }, { ownerMbId: { contains: 'hong' } }, { ownerName: { contains: 'hong' } }],
    });
    expect(args).toMatchObject({ skip: 10, take: 10 });
    expect((await call('GET', '/smt/orders?tab=nope')).statusCode).toBe(400);
  });

  it('회원 조회가 실패해도 목록은 뜬다 — 회원 여부는 모름(null)', async () => {
    db.spSmtOrder.findMany.mockResolvedValue([{ ...orderRow(), latestQuote: quoteRow() }]);
    members.mockRejectedValue(new Error('g5 down'));
    const res = await call('GET', '/smt/orders');
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().data.items[0]?.ownerIsMember).toBeNull();
  });
});

describe('SmartSMT 관리자 API — 견적 상세', () => {
  const envelope = { kind: 'smartsmt.quote', header: { quote_id: 'Q-1', labor_charge: { placement: { seconds: 3, krw: 5 } } }, quote: {} };
  const detailRow = (over: Record<string, unknown> = {}) => ({
    ...quoteRow(),
    orderRefId: 7n,
    orderId: 'O-1',
    envelopeVersion: '3',
    lang: 'ko',
    finalSupplyPrice: new Prisma.Decimal(1078393),
    finalVat: new Prisma.Decimal(107839),
    files: [
      { part: 'gerber_archive', name: 'board.zip', bytes: 24, sha256: 'a'.repeat(64), check: 'match' },
      { part: 'bom', name: 'bom.csv', bytes: 33, sha256: 'b'.repeat(64), check: 'missing' },
    ],
    envelope: JSON.stringify(envelope),
    order: orderRow(),
    ...over,
  });

  it('견적서 전체 · 파일 · 이력을 준다', async () => {
    db.spSmtQuote.findUnique.mockResolvedValue(detailRow());
    db.spSmtQuote.findMany.mockResolvedValue([quoteRow(), quoteRow({ id: 60n, quoteId: 'Q-0' })]);
    db.spFile.findMany.mockResolvedValue([{ id: 5n, slot: 'gerber_archive' }]);
    members.mockResolvedValue(new Map([['hong123', {} as never]]));

    const res = await call('GET', '/smt/quotes/70');
    expect(res.statusCode).toBe(200);
    const data = res.json<Body>().data;
    expect(data.order).toMatchObject({ orderId: 'O-1', ownerIsMember: true });
    expect(data.quote).toMatchObject({ id: 70, envelopeVersion: '3', finalSupplyPrice: 1078393, finalVat: 107839, isLatest: true });
    expect(data.envelope).toEqual(envelope);
    // 저장된 파일만 내려받을 수 있다(fileId). 경로 토큰은 어디에도 없다.
    expect(data.files).toEqual([
      { part: 'gerber_archive', name: 'board.zip', bytes: 24, sha256: 'a'.repeat(64), check: 'match', fileId: 5 },
      { part: 'bom', name: 'bom.csv', bytes: 33, sha256: 'b'.repeat(64), check: 'missing', fileId: null },
    ]);
    expect(res.body).not.toContain('pathToken');
    expect(data.history).toMatchObject([{ id: 70, isLatest: true }, { id: 60, quoteId: 'Q-0', isLatest: false }]);
    expect(db.spFile.findMany).toHaveBeenCalledWith({ where: { refType: 'sp_smt_quote', refId: 70n }, select: { id: true, slot: true } });
  });

  it('없는 견적은 404, 번호가 숫자가 아니면 400', async () => {
    db.spSmtQuote.findUnique.mockResolvedValue(null);
    expect((await call('GET', '/smt/quotes/999')).statusCode).toBe(404);
    expect((await call('GET', '/smt/quotes/abc')).statusCode).toBe(400);
  });

  it('저장된 견적서를 읽지 못해도 화면은 뜬다 (빈 견적서)', async () => {
    db.spSmtQuote.findUnique.mockResolvedValue(detailRow({ envelope: '{broken', files: null }));
    db.spSmtQuote.findMany.mockResolvedValue([]);
    db.spFile.findMany.mockResolvedValue([]);
    const res = await call('GET', '/smt/quotes/70');
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().data).toMatchObject({ envelope: {}, files: [] });
  });
});

describe('SmartSMT 관리자 API — 동봉 파일 내려받기', () => {
  const file = { id: 5n, refType: 'sp_smt_quote', refId: 70n, originFileName: '보드 A.zip', pathToken: 'secret-token' };

  it('SmartSMT 견적의 파일을 서버 경유로 내준다', async () => {
    db.spFile.findUnique.mockResolvedValue(file);
    download.mockResolvedValue({ buffer: Buffer.from('PK'), contentType: 'application/zip' });
    const res = await call('GET', '/smt/files/5');
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('PK');
    expect(res.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('보드 A.zip')}`);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(download).toHaveBeenCalledWith('secret-token');
  });

  it('다른 모듈의 파일 번호로는 내려받을 수 없다 (404, 파일서버를 부르지 않는다)', async () => {
    db.spFile.findUnique.mockResolvedValue({ ...file, refType: 'sp_bom_quote' });
    expect((await call('GET', '/smt/files/5')).statusCode).toBe(404);
    db.spFile.findUnique.mockResolvedValue(null);
    expect((await call('GET', '/smt/files/5')).statusCode).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it('파일서버에 파일이 없으면 404', async () => {
    db.spFile.findUnique.mockResolvedValue(file);
    download.mockResolvedValue(null);
    expect((await call('GET', '/smt/files/5')).statusCode).toBe(404);
  });
});

describe('SmartSMT 관리자 API — 수신 기록 · 연동 상태', () => {
  it('수신 기록을 최근 것부터 준다', async () => {
    db.spSmtReceiveLog.findMany.mockResolvedValue([
      { id: 3n, result: 'rejected', reason: 'BAD_TOKEN', httpStatus: 401, quoteId: null, orderId: null, bytes: 3861n, durationMs: 1, remoteAddr: '1.2.3.4', message: '토큰', createdAt: at('2026-11-13T04:00:00Z') },
    ]);
    db.spSmtReceiveLog.count.mockResolvedValue(1);
    const res = await call('GET', '/smt/receive-logs?result=rejected');
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().data.items).toEqual([
      { id: 3, result: 'rejected', reason: 'BAD_TOKEN', httpStatus: 401, quoteId: null, orderId: null, bytes: 3861, durationMs: 1, remoteAddr: '1.2.3.4', message: '토큰', createdAt: '2026-11-13T04:00:00.000Z' },
    ]);
    expect((db.spSmtReceiveLog.findMany.mock.calls[0]?.[0] as { where: unknown }).where).toEqual({ result: 'rejected' });
    expect((await call('GET', '/smt/receive-logs?result=nope')).statusCode).toBe(400);
  });

  it('연동 상태는 설정 여부만 알린다 — 비밀 값은 응답에 없다', async () => {
    db.spSmtReceiveLog.groupBy.mockResolvedValue([
      { result: 'accepted', _count: { _all: 4 } },
      { result: 'rejected', _count: { _all: 2 } },
    ]);
    db.spSmtQuote.findFirst.mockResolvedValue({ receivedAt: at('2026-11-13T03:00:05Z') });
    const res = await call('GET', '/smt/link-status');
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().data).toEqual({
      secretConfigured: true,
      baseUrl: 'http://smartsmt.test:8090',
      timeoutMs: 10000,
      inboundPath: '/api/smartsmt/quotes',
      ssoPath: '/spcb/sso/smartsmt',
      fileServiceType: 'smt',
      lastAcceptedAt: '2026-11-13T03:00:05.000Z',
      last24h: { accepted: 4, duplicate: 0, rejected: 2, failed: 0 },
    });
    expect(res.body).not.toContain(SHARED);
    expect(res.body).not.toContain(JWT_SECRET);
  });

  it('비밀이 없거나 JWT_SECRET 과 같으면 미설정으로 알린다', async () => {
    db.spSmtReceiveLog.groupBy.mockResolvedValue([]);
    db.spSmtQuote.findFirst.mockResolvedValue(null);
    vi.stubEnv('SMARTSMT_SHARED_SECRET', JWT_SECRET);
    vi.stubEnv('SMARTSMT_BASE_URL', '');
    const data = (await call('GET', '/smt/link-status')).json<Body>().data;
    expect(data).toMatchObject({ secretConfigured: false, baseUrl: null, lastAcceptedAt: null });
  });
});

describe('SmartSMT 관리자 API — 견적서 가져오기', () => {
  it('가져온 결과를 그대로 돌려준다', async () => {
    pull.mockResolvedValue({ ok: true, quoteId: 'Q-1', orderId: 'O-1', duplicate: false });
    const res = await call('POST', '/smt/pull', { body: { orderId: '  O-1  ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: true, data: { quoteId: 'Q-1', orderId: 'O-1', duplicate: false } });
    // 앞뒤 공백을 뗀 주문 번호로 부른다.
    expect(pull.mock.calls[0]?.[0]).toBe('O-1');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    [404, 'SMARTSMT_NOT_FOUND'],
    [409, 'SMARTSMT_NOT_READY'],
    [502, 'SMARTSMT_AUTH_REJECTED'],
    [502, 'SMARTSMT_UNREACHABLE'],
    [503, 'SMARTSMT_NOT_CONFIGURED'],
  ] as const)('실패는 상태 코드 %i 와 코드 %s 로 답한다', async (status, error) => {
    pull.mockResolvedValue({ ok: false, status, error, message: '사유' });
    const res = await call('POST', '/smt/pull', { body: { orderId: 'O-1' } });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error, message: '사유' });
  });

  it('주문 번호가 비어 있거나 너무 길면 400, SmartSMT 를 부르지 않는다', async () => {
    expect((await call('POST', '/smt/pull', { body: { orderId: '   ' } })).statusCode).toBe(400);
    expect((await call('POST', '/smt/pull', { body: {} })).statusCode).toBe(400);
    expect((await call('POST', '/smt/pull', { body: { orderId: 'x'.repeat(101) } })).statusCode).toBe(400);
    expect(pull).not.toHaveBeenCalled();
  });
});
