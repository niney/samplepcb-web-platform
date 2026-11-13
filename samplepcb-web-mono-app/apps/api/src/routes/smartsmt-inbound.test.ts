import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSmartsmtReceiveLogLimit } from '../lib/smartsmt';
import { buildSampleEnvelope, buildSampleMultipart, sampleFiles } from '../lib/smartsmt-sample';
import type { SmartsmtSampleFile } from '../lib/smartsmt-sample';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken } from '../lib/smartsmt-token';
import { smartsmtInboundRoutes } from './smartsmt-inbound';

const { db, tx, upload, remove } = vi.hoisted(() => {
  const txMock = {
    spSmtOrder: { upsert: vi.fn(), update: vi.fn() },
    spSmtQuote: { create: vi.fn() },
    spFile: { create: vi.fn() },
  };
  return {
    tx: txMock,
    db: {
      spSmtQuote: { findUnique: vi.fn() },
      spSmtReceiveLog: { create: vi.fn() },
      $transaction: vi.fn(),
    },
    upload: vi.fn(),
    remove: vi.fn(),
  };
});
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/file-server', () => ({ uploadToFileServer: upload, deleteFromFileServer: remove }));

const SECRET = 'route-test-secret-0123456789abcdefghijklmnopqrstuv';
const JWT_SECRET = 'route-test-jwt-secret-0123456789abcdefghijklmnop';
const app = Fastify();

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 64 * 1024 } });
  await app.register(smartsmtInboundRoutes, { prefix: '/api' });
  await app.ready();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SMARTSMT_SHARED_SECRET', SECRET);
  vi.stubEnv('JWT_SECRET', JWT_SECRET);
  resetSmartsmtReceiveLogLimit();
  db.spSmtQuote.findUnique.mockResolvedValue(null);
  db.spSmtReceiveLog.create.mockResolvedValue({});
  db.$transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  tx.spSmtOrder.upsert.mockResolvedValue({ id: 7n });
  tx.spSmtQuote.create.mockResolvedValue({ id: 70n });
  upload.mockImplementation((files: { filename: string; buffer: Buffer }[]) =>
    Promise.resolve(files.map((file) => ({
      uploadFileName: `stored-${file.filename}`,
      originFileName: file.filename,
      pathToken: `token-${file.filename}`,
      size: file.buffer.length,
    }))));
  remove.mockResolvedValue(undefined);
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

const validToken = (): string => signSmartsmtToken(SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF });

const send = (options: {
  token?: string | null;
  envelope?: unknown;
  files?: readonly SmartsmtSampleFile[];
  ids?: { quoteId?: string; orderId?: string };
} = {}) => {
  const files = options.files ?? sampleFiles();
  const envelope = options.envelope === undefined ? buildSampleEnvelope({ files: sampleFiles() }) : options.envelope;
  const { boundary, body } = buildSampleMultipart(envelope, files, options.ids ?? { quoteId: 'Q-123456-123456-123abc', orderId: '123456789abc' });
  const token = options.token === undefined ? validToken() : options.token;
  return app.inject({
    method: 'POST',
    url: '/api/smartsmt/quotes',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    payload: body,
  });
};

const lastLog = (): Record<string, unknown> =>
  (db.spSmtReceiveLog.create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;
const reasonOf = (res: { json: () => unknown }): unknown => (res.json() as { detail?: { reason?: unknown } }).detail?.reason;
const noBodyWork = (): void => {
  expect(db.spSmtQuote.findUnique).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
};

describe('SmartSMT 견적서 수신 — 인증은 본문보다 먼저', () => {
  it('공유 비밀이 설정되지 않았으면 닫혀 있다 (503)', async () => {
    vi.stubEnv('SMARTSMT_SHARED_SECRET', '');
    const res = await send();
    expect(res.statusCode).toBe(503);
    expect(reasonOf(res)).toBe('NOT_CONFIGURED');
    noBodyWork();
  });

  it('비밀이 JWT_SECRET 과 같은 값이어도 닫는다', async () => {
    vi.stubEnv('SMARTSMT_SHARED_SECRET', JWT_SECRET);
    const res = await send({ token: signSmartsmtToken(JWT_SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF }) });
    expect(res.statusCode).toBe(503);
    noBodyWork();
  });

  it.each([
    ['토큰 없음', null, 'NO_TOKEN'],
    ['다른 비밀로 서명', signSmartsmtToken('wrong-secret-0123456789abcdefghijklmnopqrstuvwx', { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF }), 'BAD_TOKEN'],
    ['우리 JWT_SECRET 으로 서명', signSmartsmtToken(JWT_SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF }), 'BAD_TOKEN'],
    ['우리가 SmartSMT 로 보내는 토큰', signSmartsmtToken(SECRET, { iss: SMARTSMT_SELF, aud: SMARTSMT_PEER }), 'WRONG_AUDIENCE'],
    ['로그인 인계용 토큰', signSmartsmtToken(SECRET, { iss: SMARTSMT_SELF, aud: 'smartsmt-login' }), 'WRONG_AUDIENCE'],
    ['만료된 토큰', signSmartsmtToken(SECRET, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF }, Math.floor(Date.now() / 1000) - 600), 'EXPIRED'],
  ])('%s → 401, 본문을 읽지 않는다', async (_label, token, reason) => {
    const res = await send({ token });
    expect(res.statusCode).toBe(401);
    expect(reasonOf(res)).toBe(reason);
    noBodyWork();
    expect(lastLog()).toMatchObject({ result: 'rejected', reason, httpStatus: 401 });
  });

  it('인증 실패 기록은 시간당 30건까지만 남긴다', async () => {
    for (let i = 0; i < 35; i += 1) await send({ token: null });
    expect(db.spSmtReceiveLog.create).toHaveBeenCalledTimes(30);
  });
});

describe('SmartSMT 견적서 수신 — 저장', () => {
  it('정상 견적서 → 200, 견적서 전체와 파일 3개를 저장한다', async () => {
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: true, data: { quoteId: 'Q-123456-123456-123abc', orderId: '123456789abc', duplicate: false } });

    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls.map((call: unknown[]) => call[1])).toEqual(['smt', 'smt', 'smt']);

    const order = tx.spSmtOrder.upsert.mock.calls[0]?.[0] as { where: unknown; create: Record<string, unknown> };
    expect(order.where).toEqual({ orderId: '123456789abc' });
    expect(order.create).toMatchObject({ ownerMbId: 'hong123', ownerName: '홍길동', quoteCount: 1 });

    const quote = (tx.spSmtQuote.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(quote).toMatchObject({
      orderRefId: 7n,
      quoteId: 'Q-123456-123456-123abc',
      source: 'push',
      envelopeVersion: '3',
      quoteStatus: 'CALCULATED',
      quantity: 20,
    });
    // 최종 금액은 통합 합계, SMT 작업비는 따로.
    expect(String(quote.finalTotal)).toBe('1186232');
    expect(String(quote.smtTotal)).toBe('1042826');
    // envelope 는 application/json 파트라 객체로 들어온다 — 그래도 견적서 전체가 글자로 남아야 한다.
    const stored = JSON.parse(quote.envelope as string) as { kind: string; header: { rates: Record<string, number>; labor_charge: unknown } };
    expect(stored.kind).toBe('smartsmt.quote');
    expect(stored.header.rates['placement.chip_base']).toBe(58);
    expect(stored.header.labor_charge).toBeDefined();
    expect((quote.files as { check: string }[]).map((file) => file.check)).toEqual(['match', 'match', 'match']);

    expect(tx.spSmtOrder.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { latestQuoteId: 70n } });
    expect(tx.spFile.create.mock.calls.map((call) => (call[0] as { data: { slot: string; fileType: string; refId: bigint; refType: string } }).data))
      .toMatchObject([
        { slot: 'gerber_archive', fileType: 'gerber', refId: 70n, refType: 'sp_smt_quote' },
        { slot: 'bom', fileType: 'bom' },
        { slot: 'cpl', fileType: 'cpl' },
      ]);
    expect(lastLog()).toMatchObject({ result: 'accepted', httpStatus: 200, quoteId: 'Q-123456-123456-123abc', orderId: '123456789abc' });
  });

  it('모르는 코드·모르는 칸·모르는 판이어도 받는다 (재시도가 없다)', async () => {
    const envelope = buildSampleEnvelope() as Record<string, unknown> & { quote: Record<string, unknown> };
    envelope.envelope_version = '9';
    envelope.brand_new_section = { anything: true };
    envelope.quote.quote_status = 'SOMETHING_NEW';
    const res = await send({ envelope });
    expect(res.statusCode).toBe(200);
    const quote = (tx.spSmtQuote.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(quote).toMatchObject({ envelopeVersion: '9', quoteStatus: 'SOMETHING_NEW' });
    expect(JSON.parse(quote.envelope as string)).toHaveProperty('brand_new_section.anything', true);
  });

  it('파일 없이 와도 받는다 — 목록의 파일은 missing 으로 적는다', async () => {
    const res = await send({ files: [] });
    expect(res.statusCode).toBe(200);
    expect(upload).not.toHaveBeenCalled();
    const quote = (tx.spSmtQuote.create.mock.calls[0]?.[0] as { data: { files: { check: string }[] } }).data;
    expect(quote.files.map((file) => file.check)).toEqual(['missing', 'missing', 'missing']);
  });

  it('이미 받은 quote_id → 200 duplicate, 파일을 다시 올리지 않는다', async () => {
    db.spSmtQuote.findUnique.mockResolvedValue({ id: 70n });
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { duplicate: true } });
    expect(upload).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ result: 'duplicate', httpStatus: 200 });
  });

  const uniqueViolation = (): Error =>
    new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

  it('같은 quote_id 가 동시에 와서 유니크 제약에 걸리면 duplicate 로 답하고 올린 파일을 되돌린다', async () => {
    // 사전 확인 때는 없었고, 충돌 뒤 다시 보니 다른 요청이 이미 저장해 둔 경우.
    db.spSmtQuote.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 70n });
    db.$transaction.mockRejectedValueOnce(uniqueViolation());
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { duplicate: true } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('새 주문의 서로 다른 견적 두 건이 동시에 와서 주문 행에서 부딪치면 한 번 더 써서 저장한다', async () => {
    // 충돌은 났지만 이 quote_id 는 아직 없다 → 중복이 아니다. 중복으로 답하면 견적을 잃는다.
    db.$transaction.mockRejectedValueOnce(uniqueViolation());
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { duplicate: false } });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.spSmtQuote.create).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ result: 'accepted' });
  });

  it('두 번째에도 부딪치면 올린 파일을 되돌리고 오류로 끝낸다 (2xx 로 답하지 않는다)', async () => {
    db.$transaction.mockRejectedValue(uniqueViolation());
    const res = await send();
    expect(res.statusCode).toBe(500);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(lastLog()).toMatchObject({ result: 'failed', httpStatus: 500 });
  });
});

describe('SmartSMT 견적서 수신 — 거절', () => {
  it('envelope 파트가 없으면 400 INVALID_ENVELOPE', async () => {
    const boundary = 'x-boundary';
    const res = await app.inject({
      method: 'POST',
      url: '/api/smartsmt/quotes',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${validToken()}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="quote_id"\r\n\r\nQ-1\r\n--${boundary}--\r\n`,
    });
    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('INVALID_ENVELOPE');
    expect(lastLog()).toMatchObject({ result: 'rejected', quoteId: 'Q-1' });
  });

  it('꼭 있어야 하는 칸이 없으면 어느 칸인지 알려 준다', async () => {
    const envelope = buildSampleEnvelope() as { header: Record<string, unknown> };
    delete envelope.header.order_id;
    const res = await send({ envelope });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ detail: { reason: 'INVALID_ENVELOPE', message: expect.stringContaining('header.order_id') as unknown } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('다른 종류의 문서(kind)는 받지 않는다', async () => {
    const res = await send({ envelope: { ...buildSampleEnvelope(), kind: 'something.else' } });
    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('INVALID_ENVELOPE');
  });

  it('multipart 의 번호가 견적서와 다르면 400 ID_MISMATCH', async () => {
    const res = await send({ ids: { quoteId: 'Q-OTHER', orderId: '123456789abc' } });
    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('ID_MISMATCH');
    expect(upload).not.toHaveBeenCalled();
  });

  it('번호 파트가 없으면 견적서의 번호로 받는다', async () => {
    const res = await send({ ids: {} });
    expect(res.statusCode).toBe(200);
  });

  it('파일 내용이 견적서의 해시와 다르면 400 FILE_MISMATCH, 아무것도 저장하지 않는다', async () => {
    const files = sampleFiles().map((file) => (file.part === 'bom' ? { ...file, buffer: Buffer.from('tampered') } : file));
    const res = await send({ files });
    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('FILE_MISMATCH');
    expect(upload).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('파일서버가 중간에 실패하면 502, 앞서 올린 파일을 되돌리고 견적을 남기지 않는다', async () => {
    upload.mockImplementationOnce((files: { filename: string; buffer: Buffer }[]) =>
      Promise.resolve(files.map((file) => ({ uploadFileName: 'a', originFileName: file.filename, pathToken: 'token-first', size: file.buffer.length }))));
    upload.mockRejectedValueOnce(new Error('file server HTTP 500'));
    const res = await send();
    expect(res.statusCode).toBe(502);
    expect(reasonOf(res)).toBe('FILE_STORE_FAILED');
    expect(remove).toHaveBeenCalledExactlyOnceWith('token-first');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ result: 'failed', reason: 'FILE_STORE_FAILED', httpStatus: 502 });
  });

  it('파일이 한도를 넘으면 413 TOO_LARGE', async () => {
    const files = sampleFiles().map((file) => (file.part === 'gerber_archive' ? { ...file, buffer: Buffer.alloc(80 * 1024, 1) } : file));
    const res = await send({ files, envelope: buildSampleEnvelope({ files }) });
    expect(res.statusCode).toBe(413);
    expect(reasonOf(res)).toBe('TOO_LARGE');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('multipart 가 아니면 400 INVALID_REQUEST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/smartsmt/quotes',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${validToken()}` },
      payload: JSON.stringify(buildSampleEnvelope()),
    });
    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('INVALID_REQUEST');
  });
});
