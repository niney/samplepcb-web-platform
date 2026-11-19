import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSampleEnvelope } from './smartsmt-sample';
import { verifySmartsmtToken } from './smartsmt-token';

const { db, tx, upload } = vi.hoisted(() => ({
  tx: {
    spSmtOrder: { upsert: vi.fn(), update: vi.fn() },
    spSmtQuote: { create: vi.fn() },
    spFile: { create: vi.fn() },
  },
  db: { spSmtQuote: { findUnique: vi.fn() }, spSmtOrder: { findUnique: vi.fn() }, $transaction: vi.fn() },
  upload: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: db }));
vi.mock('./file-server', () => ({ uploadToFileServer: upload, deleteFromFileServer: vi.fn() }));

const { pullSmartsmtQuote, smartsmtBaseUrl } = await import('./smartsmt-pull');

const SECRET = 'pull-test-secret-0123456789abcdefghijklmnopqrstuv';
const BASE = 'http://smartsmt.test:8090';
const ORDER = '123456789abc';
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

/** SmartSMT 의 응답을 흉내 낸다. 받은 요청은 calls 에 쌓인다. */
const peer = (status: number, body: string) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};
const peerError = (reason: string): string => JSON.stringify({ detail: { reason, message: '…' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SMARTSMT_SHARED_SECRET', SECRET);
  vi.stubEnv('JWT_SECRET', 'pull-test-jwt-secret-0123456789abcdefghijklmnop');
  vi.stubEnv('SMARTSMT_BASE_URL', `${BASE}/`);
  db.spSmtQuote.findUnique.mockResolvedValue(null);
  db.spSmtOrder.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  tx.spSmtOrder.upsert.mockResolvedValue({ id: 7n });
  tx.spSmtQuote.create.mockResolvedValue({ id: 70n });
});

describe('SmartSMT 견적서 가져오기 — 요청', () => {
  it('주문 번호를 주소에 싣고, SmartSMT 용 토큰(iss=samplepcb, aud=smartsmt)으로 부른다', async () => {
    const { fetchImpl, calls } = peer(404, peerError('NOT_FOUND'));
    await pullSmartsmtQuote('A B/1&x', log, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/pricing/envelope?orderId=A%20B%2F1%26x`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.redirect).toBe('manual');
    const header = (calls[0]?.init.headers as Record<string, string>).authorization ?? '';
    expect(header.startsWith('Bearer ')).toBe(true);
    expect(verifySmartsmtToken(header.slice(7), SECRET, { iss: 'samplepcb', aud: 'smartsmt' }).ok).toBe(true);
    // 로그인 인계용이나 우리 수신용 자리에서는 통하지 않는 토큰이다.
    expect(verifySmartsmtToken(header.slice(7), SECRET, { iss: 'smartsmt', aud: 'samplepcb' }).ok).toBe(false);
  });

  it('주소나 공유 비밀이 없으면 부르지 않는다 (503)', async () => {
    const { fetchImpl, calls } = peer(200, '{}');
    vi.stubEnv('SMARTSMT_BASE_URL', '');
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toMatchObject({ ok: false, status: 503, error: 'SMARTSMT_NOT_CONFIGURED' });
    vi.stubEnv('SMARTSMT_BASE_URL', BASE);
    vi.stubEnv('SMARTSMT_SHARED_SECRET', '');
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toMatchObject({ ok: false, status: 503, error: 'SMARTSMT_NOT_CONFIGURED' });
    expect(calls).toHaveLength(0);
  });

  it('주소 설정은 http(s) 만 받고 끝의 / 를 뗀다', () => {
    expect(smartsmtBaseUrl({ SMARTSMT_BASE_URL: ' http://1.2.3.4:8090// ' })).toBe('http://1.2.3.4:8090');
    expect(smartsmtBaseUrl({ SMARTSMT_BASE_URL: 'ftp://x' })).toBeNull();
    expect(smartsmtBaseUrl({ SMARTSMT_BASE_URL: 'smartsmt' })).toBeNull();
    expect(smartsmtBaseUrl({})).toBeNull();
  });
});

describe('SmartSMT 견적서 가져오기 — 저장', () => {
  // 실제 응답 글자 — 숫자 표기(1.0)까지 받은 그대로 남는지 본다.
  const body = JSON.stringify(buildSampleEnvelope({ orderId: ORDER })).replace('"volume_factor":1,', '"volume_factor":1.0,');

  it('200 견적서 → 저장한다 (출처 pull, 파일은 전부 missing, 견적서는 받은 글자 그대로)', async () => {
    const { fetchImpl } = peer(200, body);
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toEqual({
      ok: true,
      quoteId: 'Q-123456-123456-123abc',
      orderId: ORDER,
      duplicate: false,
    });
    const quote = (tx.spSmtQuote.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(quote).toMatchObject({ source: 'pull', quoteId: 'Q-123456-123456-123abc', orderId: ORDER });
    expect(quote.envelope).toBe(body);
    expect(quote.envelope as string).toContain('"volume_factor":1.0,');
    expect((quote.files as { check: string }[]).map((file) => file.check)).toEqual(['missing', 'missing', 'missing']);
    expect(String(quote.finalTotal)).toBe('1186232');
    expect(upload).not.toHaveBeenCalled();
    expect(tx.spFile.create).not.toHaveBeenCalled();
  });

  it('이미 갖고 있는 견적이면 저장하지 않고 duplicate 로 답한다', async () => {
    db.spSmtQuote.findUnique.mockResolvedValue({ id: 70n });
    const { fetchImpl } = peer(200, body);
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toMatchObject({ ok: true, duplicate: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('다른 주문의 견적서가 오면 저장하지 않는다', async () => {
    const { fetchImpl } = peer(200, body);
    expect(await pullSmartsmtQuote('OTHER-ORDER', log, fetchImpl)).toMatchObject({ ok: false, status: 502, error: 'SMARTSMT_BAD_RESPONSE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON 이 아닌 응답', '<html>oops</html>'],
    ['견적서가 아닌 JSON', '{"hello":"world"}'],
    ['꼭 있어야 하는 칸이 없는 견적서', JSON.stringify({ kind: 'smartsmt.quote', envelope_version: '3', header: { quote_id: 'Q' }, quote: {} })],
  ])('%s → 502 SMARTSMT_BAD_RESPONSE, 저장하지 않는다', async (_label, text) => {
    const { fetchImpl } = peer(200, text);
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toMatchObject({ ok: false, status: 502, error: 'SMARTSMT_BAD_RESPONSE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('SmartSMT 견적서 가져오기 — SmartSMT 가 거절할 때', () => {
  it.each([
    [403, 'BAD_KEY', 502, 'SMARTSMT_AUTH_REJECTED', 'BAD_KEY'],
    [401, 'EXPIRED', 502, 'SMARTSMT_AUTH_REJECTED', 'EXPIRED'],
    [404, 'NOT_FOUND', 404, 'SMARTSMT_NOT_FOUND', '24시간'],
    [409, 'NO_INPUTS', 409, 'SMARTSMT_NOT_READY', '계산하지 않은'],
    [409, 'NOT_PUBLISHABLE', 409, 'SMARTSMT_NOT_READY', '확정되지 않은'],
    [503, 'NO_KEY', 502, 'SMARTSMT_BAD_RESPONSE', 'NO_KEY'],
    [500, '', 502, 'SMARTSMT_BAD_RESPONSE', 'HTTP 500'],
    [302, '', 502, 'SMARTSMT_BAD_RESPONSE', 'HTTP 302'],
  ])('HTTP %i %s → %i %s', async (peerStatus, reason, status, error, hint) => {
    const { fetchImpl } = peer(peerStatus, reason === '' ? 'not json' : peerError(reason));
    const result = await pullSmartsmtQuote(ORDER, log, fetchImpl);
    expect(result).toMatchObject({ ok: false, status, error });
    expect(result.ok ? '' : result.message).toContain(hint);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('접속 실패 · 시간 초과 → 502 SMARTSMT_UNREACHABLE', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toMatchObject({ ok: false, status: 502, error: 'SMARTSMT_UNREACHABLE' });
  });
});

describe('SmartSMT 견적서 가져오기 — 같은 견적인지는 주문 번호와 내용으로 가린다', () => {
  // SmartSMT 는 읽을 때마다 견적번호 · 만든 시각을 새로 만든다 — 번호만 보면 같은 견적이 계속 새 견적으로 쌓인다.
  const stored = (over: Record<string, unknown> = {}): string =>
    JSON.stringify(buildSampleEnvelope({ review: true, orderId: ORDER, quoteId: 'Q-KEPT', madeAt: '2026-11-19T01:01:02+09:00', ...over }));
  const pulled = (over: Record<string, unknown> = {}): string =>
    JSON.stringify(buildSampleEnvelope({ review: true, orderId: ORDER, quoteId: 'Q-NEW', madeAt: '2026-11-19T01:06:45+09:00', ...over }));

  it('마지막 견적과 내용이 같으면 저장하지 않고, 우리가 보관한 견적번호를 돌려준다', async () => {
    db.spSmtOrder.findUnique.mockResolvedValue({ latestQuote: { quoteId: 'Q-KEPT', envelope: stored() } });
    const { fetchImpl } = peer(200, pulled());
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toEqual({ ok: true, quoteId: 'Q-KEPT', orderId: ORDER, duplicate: true });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.spSmtOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: ORDER } }));
  });

  it('내용이 달라졌으면 새 견적으로 저장한다', async () => {
    db.spSmtOrder.findUnique.mockResolvedValue({ latestQuote: { quoteId: 'Q-KEPT', envelope: stored({ ownerName: '다른 이름' }) } });
    const { fetchImpl } = peer(200, pulled());
    expect(await pullSmartsmtQuote(ORDER, log, fetchImpl)).toEqual({ ok: true, quoteId: 'Q-NEW', orderId: ORDER, duplicate: false });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('처음 받는 주문이거나 보관한 견적서를 읽을 수 없으면 저장한다', async () => {
    const first = peer(200, pulled());
    expect(await pullSmartsmtQuote(ORDER, log, first.fetchImpl)).toMatchObject({ ok: true, duplicate: false });
    db.spSmtOrder.findUnique.mockResolvedValue({ latestQuote: { quoteId: 'Q-KEPT', envelope: '{broken' } });
    const second = peer(200, pulled());
    expect(await pullSmartsmtQuote(ORDER, log, second.fetchImpl)).toMatchObject({ ok: true, duplicate: false });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});
