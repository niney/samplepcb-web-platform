import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import auth from '../plugins/auth';
import { downloadFromFileServer } from '../lib/file-server';
import { listSmtOrdersOf, loadSmtOrderOf } from '../lib/smartsmt-orders';
import type * as SmartsmtOrders from '../lib/smartsmt-orders';
import type { SmtOrderDetail, SmtOrderRow } from '../lib/smartsmt-orders';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken } from '../lib/smartsmt-token';
import { smartsmtOrderRoutes } from './smartsmt-orders';
import { smtOrderRoutes } from './smt-orders';

// 의뢰 읽기 주소 — SmartSMT 서버용(/api/smartsmt/orders…)과 고객용(/api/smt/orders). 조회는 흉내로 바꾼다.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/file-server', () => ({ downloadFromFileServer: vi.fn(), uploadToFileServer: vi.fn(), deleteFromFileServer: vi.fn() }));
vi.mock('../lib/smartsmt-orders', async (original) => ({
  ...(await original<typeof SmartsmtOrders>()),
  listSmtOrdersOf: vi.fn(),
  loadSmtOrderOf: vi.fn(),
}));

const list = vi.mocked(listSmtOrdersOf);
const load = vi.mocked(loadSmtOrderOf);
const download = vi.mocked(downloadFromFileServer);
const SECRET = 'orders-test-secret-0123456789abcdefghijklmnopqrstu';
const JWT_SECRET = 'orders-test-jwt-secret-0123456789abcdefghijklmnop';
const app = Fastify();

const row = (over: Partial<SmtOrderRow> = {}): SmtOrderRow => ({
  orderId: 'a49af3b5fa9f',
  title: 'MULTI_MAIN_REV0',
  processes: ['pcb', 'parts', 'smt'],
  quoteId: 'Q-KEPT',
  requestedAt: new Date('2026-11-18T15:57:01.000Z'),
  confirmed: false,
  estimatedTotal: 2138950,
  confirmedTotal: null,
  currency: 'KRW',
  ...over,
});
const detail = (over: Partial<SmtOrderDetail> = {}): SmtOrderDetail => ({
  row: row(),
  envelope: { kind: 'smartsmt.quote', header: { order_id: 'a49af3b5fa9f' }, quote: {} },
  confirmedEnvelope: null,
  confirmedAt: null,
  customerNote: '',
  state: null,
  files: [{ part: 'cpl', name: 'Pick Place 좌표.csv', bytes: 5, sha256: 'c'.repeat(64), pathToken: 'secret-path-token' }],
  ...over,
});

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  vi.stubEnv('JWT_SECRET', JWT_SECRET);
  await app.register(sensible);
  await app.register(auth);
  await app.register(smartsmtOrderRoutes, { prefix: '/api' });
  await app.register(smtOrderRoutes, { prefix: '/api' });
  await app.ready();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', JWT_SECRET);
  vi.stubEnv('SMARTSMT_SHARED_SECRET', SECRET);
  vi.stubEnv('SMARTSMT_BASE_URL', 'https://smteyes.samplepcb.co.kr');
  vi.stubEnv('SMARTSMT_OPEN_URL_TEMPLATE', '');
  list.mockResolvedValue({ total: 0, items: [] });
  load.mockResolvedValue(null);
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

/** SmartSMT 서버처럼 부른다 — 기본은 올바른 토큰(iss=smartsmt, aud=samplepcb). */
const peer = (url: string, token: string | null = signSmartsmtToken(SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF })) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: token === null ? {} : { authorization: `Bearer ${token}` } });
const reasonOf = (res: { json: () => unknown }): unknown => (res.json() as { detail?: { reason?: unknown } }).detail?.reason;

describe('SmartSMT 의뢰 읽기 — 인증', () => {
  const urls = ['/smartsmt/orders?owner=hong123', '/smartsmt/orders/o1?owner=hong123', '/smartsmt/orders/o1/files/bom?owner=hong123'];

  it.each(urls)('%s — 토큰이 없거나 방향이 다르면 401, 아무것도 조회하지 않는다', async (url) => {
    const none = await peer(url, null);
    expect(none.statusCode).toBe(401);
    expect(reasonOf(none)).toBe('NO_TOKEN');
    // 우리가 SmartSMT 를 부를 때 쓰는 토큰(반대 방향)과 로그인 인계 토큰은 통하지 않는다.
    for (const aud of [SMARTSMT_PEER, 'smartsmt-login']) {
      const wrong = await peer(url, signSmartsmtToken(SECRET, { iss: SMARTSMT_SELF, aud }));
      expect(wrong.statusCode).toBe(401);
      expect(reasonOf(wrong)).toBe('WRONG_AUDIENCE');
    }
    const forged = await peer(url, signSmartsmtToken('another-secret-0123456789abcdefghijklmnopqrstuv', { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF }));
    expect(reasonOf(forged)).toBe('BAD_TOKEN');
    expect(list).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('회원 · 관리자 로그인 토큰으로는 읽을 수 없다', async () => {
    const adminToken = app.jwt.sign({ mbId: 'admin', mbNick: '관리자', level: 10, isAdmin: true }, { expiresIn: '10m' });
    const res = await peer(urls[0] ?? '', adminToken);
    expect(res.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('공유 비밀이 설정되지 않았으면 닫혀 있다 (503)', async () => {
    vi.stubEnv('SMARTSMT_SHARED_SECRET', '');
    const res = await peer(urls[0] ?? '');
    expect(res.statusCode).toBe(503);
    expect(reasonOf(res)).toBe('NOT_CONFIGURED');
  });
});

describe('SmartSMT 의뢰 읽기 — 목록', () => {
  it('owner 가 없으면 400 — 조회하지 않는다', async () => {
    for (const url of ['/smartsmt/orders', '/smartsmt/orders?owner=', '/smartsmt/orders?owner=%20']) {
      const res = await peer(url);
      expect(res.statusCode).toBe(400);
      expect(reasonOf(res)).toBe('INVALID_REQUEST');
    }
    expect((await peer('/smartsmt/orders?owner=hong123&page_size=1000')).statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('그 회원의 의뢰를 밑줄 표기로 준다', async () => {
    list.mockResolvedValue({
      total: 2,
      items: [row({ confirmed: true, confirmedTotal: 2171950 }), row({ orderId: 'o2', quoteId: 'Q-2', estimatedTotal: null })],
    });
    const res = await peer('/smartsmt/orders?owner=hong%40example.com&page=2&page_size=5');
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith('hong@example.com', 2, 5);
    expect(res.json()).toEqual({
      result: true,
      data: {
        total: 2,
        items: [
          {
            order_id: 'a49af3b5fa9f',
            title: 'MULTI_MAIN_REV0',
            processes: ['pcb', 'parts', 'smt'],
            quote_id: 'Q-KEPT',
            requested_at: '2026-11-18T15:57:01.000Z',
            review_status: 'CONFIRMED',
            estimated_total: 2138950,
            confirmed_total: 2171950,
            currency: 'KRW',
          },
          expect.objectContaining({ order_id: 'o2', review_status: 'REVIEWING', estimated_total: null, confirmed_total: null }),
        ],
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('쪽 · 쪽 크기를 주지 않으면 1쪽 · 20건', async () => {
    await peer('/smartsmt/orders?owner=hong123');
    expect(list).toHaveBeenCalledWith('hong123', 1, 20);
  });
});

describe('SmartSMT 의뢰 읽기 — 한 건 · 파일', () => {
  it('없는 의뢰 · 남의 의뢰는 똑같이 404 다', async () => {
    const res = await peer('/smartsmt/orders/o1?owner=someone-else');
    expect(res.statusCode).toBe(404);
    expect(reasonOf(res)).toBe('NOT_FOUND');
    expect(load).toHaveBeenCalledWith('someone-else', 'o1');
    expect((await peer('/smartsmt/orders/o1')).statusCode).toBe(400);
  });

  it('확정 전 — 받은 견적서 · 작업 상태 · 파일 목록을 준다 (파일서버 토큰은 싣지 않는다)', async () => {
    load.mockResolvedValue(detail({ state: { step: 'order' } }));
    const res = await peer('/smartsmt/orders/a49af3b5fa9f?owner=hong123');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      result: true,
      data: {
        order_id: 'a49af3b5fa9f',
        title: 'MULTI_MAIN_REV0',
        quote_id: 'Q-KEPT',
        requested_at: '2026-11-18T15:57:01.000Z',
        review_status: 'REVIEWING',
        confirmed_at: null,
        customer_note: '',
        envelope: { kind: 'smartsmt.quote', header: { order_id: 'a49af3b5fa9f' }, quote: {} },
        confirmed_envelope: null,
        state: { step: 'order' },
        files: [{ part: 'cpl', name: 'Pick Place 좌표.csv', bytes: 5, sha256: 'c'.repeat(64) }],
      },
    });
    expect(res.body).not.toContain('secret-path-token');
  });

  it('확정 — 확정 금액을 채운 견적서와 안내 글을 함께 준다', async () => {
    load.mockResolvedValue(
      detail({
        row: row({ confirmed: true, confirmedTotal: 314116 }),
        confirmedEnvelope: { review_status: 'CONFIRMED', quote: { integrated: { totals: { total: 314116 } } } },
        confirmedAt: new Date('2026-11-19T01:30:00.000Z'),
        customerNote: '배송비를 반영했습니다.',
      }),
    );
    const data = (await peer('/smartsmt/orders/a49af3b5fa9f?owner=hong123')).json<{ data: Record<string, unknown> }>().data;
    expect(data).toMatchObject({
      review_status: 'CONFIRMED',
      confirmed_at: '2026-11-19T01:30:00.000Z',
      customer_note: '배송비를 반영했습니다.',
      confirmed_envelope: { review_status: 'CONFIRMED', quote: { integrated: { totals: { total: 314116 } } } },
      state: null,
    });
  });

  it('원본 파일을 파일서버를 거쳐 그대로 준다', async () => {
    load.mockResolvedValue(detail());
    download.mockResolvedValue({ buffer: Buffer.from('X,Y\n1') } as never);
    const res = await peer('/smartsmt/orders/a49af3b5fa9f/files/cpl?owner=hong123');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('Pick Place 좌표.csv')}`);
    expect(res.body).toBe('X,Y\n1');
    expect(download).toHaveBeenCalledWith('secret-path-token');
  });

  it('없는 파트 · 남의 의뢰 · 파일서버에 없는 파일은 404 — 남의 의뢰는 파일서버를 부르지 않는다', async () => {
    load.mockResolvedValue(detail());
    expect((await peer('/smartsmt/orders/a49af3b5fa9f/files/bom?owner=hong123')).statusCode).toBe(404);
    load.mockResolvedValue(null);
    expect((await peer('/smartsmt/orders/a49af3b5fa9f/files/cpl?owner=someone-else')).statusCode).toBe(404);
    expect(download).not.toHaveBeenCalled();
    load.mockResolvedValue(detail());
    download.mockResolvedValue(null);
    const gone = await peer('/smartsmt/orders/a49af3b5fa9f/files/cpl?owner=hong123');
    expect(gone.statusCode).toBe(404);
    expect(reasonOf(gone)).toBe('NOT_FOUND');
  });
});

describe('고객 본인의 SMT 의뢰 — GET /api/smt/orders', () => {
  const member = (mbId: string) =>
    ({ authorization: `Bearer ${app.jwt.sign({ mbId, mbNick: mbId, level: 2, isAdmin: false }, { expiresIn: '10m' })}` });

  it('로그인하지 않으면 401 — SmartSMT 토큰으로도 읽을 수 없다', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/smt/orders' })).statusCode).toBe(401);
    const peerToken = signSmartsmtToken(SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF });
    expect((await app.inject({ method: 'GET', url: '/api/smt/orders', headers: { authorization: `Bearer ${peerToken}` } })).statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('토큰의 회원 아이디로만 찾는다 — 주소로 남의 아이디를 넘겨도 무시한다', async () => {
    list.mockResolvedValue({ total: 1, items: [row({ confirmed: true, confirmedTotal: 314116 })] });
    const res = await app.inject({ method: 'GET', url: '/api/smt/orders?owner=someone-else&pageSize=10', headers: member('hong123') });
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith('hong123', 1, 10);
    expect(res.json()).toEqual({
      result: true,
      data: {
        total: 1,
        items: [
          {
            orderId: 'a49af3b5fa9f',
            title: 'MULTI_MAIN_REV0',
            processes: ['pcb', 'parts', 'smt'],
            quoteId: 'Q-KEPT',
            requestedAt: '2026-11-18T15:57:01.000Z',
            reviewStatus: 'confirmed',
            estimatedTotal: 2138950,
            confirmedTotal: 314116,
            currency: 'KRW',
            openUrl: 'https://smteyes.samplepcb.co.kr/quote?order=a49af3b5fa9f',
          },
        ],
      },
    });
  });

  it('열기 주소 설정이 있으면 그 주소로, SmartSMT 주소가 없으면 링크를 주지 않는다', async () => {
    list.mockResolvedValue({ total: 1, items: [row()] });
    vi.stubEnv('SMARTSMT_OPEN_URL_TEMPLATE', 'https://smteyes.samplepcb.co.kr/open?order={order_id}');
    const withTemplate = await app.inject({ method: 'GET', url: '/api/smt/orders', headers: member('hong123') });
    expect(withTemplate.json<{ data: { items: { openUrl: string | null }[] } }>().data.items[0]?.openUrl).toBe(
      'https://smteyes.samplepcb.co.kr/open?order=a49af3b5fa9f',
    );
    vi.stubEnv('SMARTSMT_OPEN_URL_TEMPLATE', '');
    vi.stubEnv('SMARTSMT_BASE_URL', '');
    const without = await app.inject({ method: 'GET', url: '/api/smt/orders', headers: member('hong123') });
    expect(without.json<{ data: { items: { openUrl: string | null; reviewStatus: string }[] } }>().data.items[0]).toMatchObject({
      openUrl: null,
      reviewStatus: 'reviewing',
    });
  });
});
