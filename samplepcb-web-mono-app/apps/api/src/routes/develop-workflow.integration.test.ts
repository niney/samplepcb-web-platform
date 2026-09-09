import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { DevelopRequestDetailResponse, WorkResponse, WorkState } from '@sp/api-contract';
import type { WorkCommandType, WorkViewType } from '@sp/api-contract';
import auth from '../plugins/auth';
import { prisma } from '../lib/prisma';
import { markMilestonePaid, ensureDevelopLazy } from '../lib/develop-payment';
import { sendMail } from '../lib/mailer';
import { adminDevelopWorkflowRoutes, developWorkflowRoutes } from './develop-workflow';
import { adminDevelopRequestRoutes } from './admin-develop-requests';
import { developRequestRoutes } from './develop-requests';
import type * as ReviewRunner from '../lib/ai/runner';
import type * as AiUsecases from '../lib/ai/usecases';

vi.mock('../lib/mailer', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/file-server', () => ({
  uploadToFileServer: vi.fn().mockResolvedValue([{ uploadFileName: 'test.pdf', originFileName: 'test.pdf', pathToken: 'private-token', size: 4 }]),
  downloadFromFileServer: vi.fn().mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'application/pdf' }),
}));
vi.mock('../lib/ai/runner', async (original) => {
  const module = await original<typeof ReviewRunner>();
  return { ...module, chatWithOptionFallback: vi.fn().mockResolvedValue({ text: '확인된 자료만 정리한 초안', elapsedMs: 1 }) };
});
vi.mock('../lib/ai/usecases', async (original) => {
  const module = await original<typeof AiUsecases>();
  return { ...module, getAiUsecaseRuntime: vi.fn().mockResolvedValue({ enabled: true, model: 'test', think: 'off', timeoutMs: 1000 }), getAiConnection: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1', apiKey: null }) };
});

// 기본 테스트에서는 실행하지 않는다. 전용 MariaDB 인스턴스/DB를 이중 확인하고 원본 DB는 사용하지 않는다.
describe.skipIf(process.env.WORKFLOW_INTEGRATION !== '1')('수행관리 격리 DB 통합', () => {
  const app = Fastify(); const ids: bigint[] = [];
  let adminToken = ''; let ownerToken = ''; let strangerToken = '';
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    expect(url.hostname).toBe('127.0.0.1'); expect(['3340', '3344']).toContain(url.port); expect(url.pathname).toBe('/samplepcb_develop_workflow_proto');
    expect(process.env.G5_DATABASE_URL).toBe(process.env.DATABASE_URL);
    await prisma.$connect();
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible); await app.register(multipart); await app.register(auth);
    await app.register(adminDevelopWorkflowRoutes, { prefix: '/api/admin' });
    await app.register(developWorkflowRoutes, { prefix: '/api' });
    await app.register(adminDevelopRequestRoutes, { prefix: '/api/admin' });
    await app.register(developRequestRoutes, { prefix: '/api' });
    await app.ready();
    const claims = { mbNick: '테스트', level: 2, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
    adminToken = app.jwt.sign({ ...claims, mbId: 'wf-test-admin', isAdmin: true });
    ownerToken = app.jwt.sign({ ...claims, mbId: 'wf-test-owner', isAdmin: false });
    strangerToken = app.jwt.sign({ ...claims, mbId: 'wf-test-stranger', isAdmin: false });
  });
  afterEach(async () => {
    await prisma.spFile.deleteMany({ where: { refType: 'sp_develop_workflow', refId: { in: ids } } });
    await prisma.spDevelopWorkflowAudit.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.spDevelopWorkflow.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.spMailLog.deleteMany({ where: { refType: 'develop_request', refId: { in: ids.map(String) } } });
    await prisma.spDevelopRequest.deleteMany({ where: { id: { in: ids } } }); ids.length = 0;
    vi.mocked(sendMail).mockClear();
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const path = (id: bigint, admin = true): string => `/api${admin ? '/admin' : ''}/develop/requests/${String(id)}/workflow`;
  async function get(id: bigint, admin = true): Promise<WorkViewType> { const res = await app.inject({ method: 'GET', url: path(id, admin), headers: headers(admin ? adminToken : ownerToken) }); expect(res.statusCode, res.body).toBe(200); return WorkResponse.parse(res.json()).data; }
  async function command(id: bigint, cmd: WorkCommandType, admin = true, revision?: number) {
    return app.inject({ method: 'POST', url: path(id, admin), headers: headers(admin ? adminToken : ownerToken), payload: { revision: revision ?? (await get(id, admin)).revision, command: cmd } });
  }
  async function ok(id: bigint, cmd: WorkCommandType, admin = true): Promise<WorkViewType> { const res = await command(id, cmd, admin); expect(res.statusCode, res.body).toBe(200); return WorkResponse.parse(res.json()).data; }
  async function fixture(enroll = true) {
    const r = await prisma.spDevelopRequest.create({ data: { mbId: 'wf-test-owner', title: '수행관리 통합 검증', serviceAreas: ['pcb'], description: '테스트용 의뢰', contactName: '테스트', contactPhone: '010-0000-0000', contactEmail: 'workflow@example.invalid', budgetRange: 'under1000', status: 'accepted', aiConsent: true } }); ids.push(r.id);
    const quote = await prisma.spDevelopQuote.create({ data: { requestId: r.id, version: 1, kind: 'initial', status: 'accepted', title: '테스트 견적', terms: '기존 합의 조건', validUntil: '2099-12-31', createdBy: 'wf-test-admin', supplyAmount: 100, vatAmount: 10, totalAmount: 110, acceptedAt: new Date(), acceptedName: '테스트',
      items: { create: [{ seq: 1, title: '개발비', amount: 100 }] }, milestones: { create: [{ requestId: r.id, seq: 1, title: '착수금', amount: 55, trigger: 'on_accept', status: 'pending', paymentKey: crypto.randomUUID() }, { requestId: r.id, seq: 2, title: '잔금', amount: 55, trigger: 'on_completion', status: 'pending', paymentKey: crypto.randomUUID(), unlocksDeliverables: true }] },
    }, include: { milestones: true } });
    if (enroll) await ok(r.id, { type: 'enable' });
    return { r, quote };
  }
  async function makeDocument(id: bigint, kind: 'review' | 'contract' | 'delivery' = 'review') { const key = crypto.randomUUID().replace(/-/g, ''); await ok(id, { type: 'document.create', kind, id: key }); return key; }

  it('인증·소유권·관리자 작성 권한을 서버에서 제한한다', async () => {
    const { r } = await fixture();
    expect((await app.inject({ method: 'GET', url: path(r.id) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: path(r.id, false), headers: headers(strangerToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: path(r.id), headers: headers(ownerToken) })).statusCode).toBe(403);
    expect((await command(r.id, { type: 'readiness.save', materialsReady: true, materialsNote: '' }, false)).statusCode).toBe(403);
  });
  it('동시에 같은 revision을 수정하면 하나만 성공한다', async () => {
    const { r } = await fixture(); const revision = (await get(r.id)).revision;
    const responses = await Promise.all([command(r.id, { type: 'readiness.save', materialsReady: true, materialsNote: 'A' }, true, revision), command(r.id, { type: 'readiness.save', materialsReady: true, materialsNote: 'B' }, true, revision)]);
    expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    expect((await get(r.id)).revision).toBe(revision + 1);
  });
  it('결제해도 자동 착수하지 않고 필수자료 확인 후 착수한다', async () => {
    const { r, quote } = await fixture(); const first = quote.milestones[0]; if (!first) throw new Error('fixture');
    await markMilestonePaid(first, 'admin', null, app.log, 'wf-test-admin');
    expect((await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('accepted');
    expect((await command(r.id, { type: 'start' })).statusCode).toBe(409);
    await ok(r.id, { type: 'readiness.save', materialsReady: true, materialsNote: '자료 확인' });
    await ok(r.id, { type: 'start' });
    expect((await get(r.id)).context?.requestStatus).toBe('in_progress');
  });
  it('기존 관리자 상태 API로 착수 조건을 우회하지 못한다', async () => {
    const { r } = await fixture(); const res = await app.inject({ method: 'POST', url: `/api/admin/develop/requests/${String(r.id)}/status`, headers: headers(adminToken), payload: { to: 'in_progress' } });
    expect(res.statusCode).toBe(409); expect(res.body).toContain('WORKFLOW_ACTION_REQUIRED');
  });
  it('초안은 고객에게 숨기고 공개한 버전만 보여준다', async () => {
    const { r } = await fixture(); const key = await makeDocument(r.id);
    expect((await get(r.id, false)).state?.documents).toEqual([]);
    await ok(r.id, { type: 'document.publish', id: key });
    const adminView = await get(r.id); const draft = adminView.state?.documents[0]?.draft; if (!draft) throw new Error('fixture');
    draft.content.fields['주요 설계 결정'] = '아직 공개하지 않은 내용';
    await ok(r.id, { type: 'document.save', id: key, draft });
    const customer = await get(r.id, false);
    expect(customer.state?.documents[0]?.draft).toBeNull(); expect(JSON.stringify(customer)).not.toContain('아직 공개하지 않은 내용');
  });
  it('고객 승인을 버전에 귀속하고 재발행 후 구버전·중복 응답을 거부한다', async () => {
    const { r } = await fixture(); const key = await makeDocument(r.id); await ok(r.id, { type: 'document.publish', id: key });
    await ok(r.id, { type: 'document.decide', id: key, version: 1, decision: 'approved', note: '확인' }, false);
    expect((await command(r.id, { type: 'document.decide', id: key, version: 1, decision: 'approved', note: '' }, false)).statusCode).toBe(409);
    await ok(r.id, { type: 'document.publish', id: key });
    expect((await command(r.id, { type: 'document.decide', id: key, version: 1, decision: 'approved', note: '' }, false)).statusCode).toBe(409);
    const row = await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: r.id } });
    expect(WorkState.parse(row.state).documents[0]?.versions[0]?.decision?.note).toBe('확인');
  });
  it('계약의 금액·조건을 수락 견적에서 고정한다', async () => {
    const { r, quote } = await fixture(); const key = await makeDocument(r.id, 'contract'); await ok(r.id, { type: 'document.publish', id: key });
    await prisma.spDevelopQuote.update({ where: { id: quote.id }, data: { terms: '나중에 바뀐 내용' } });
    const snapshot = (await get(r.id, false)).state?.documents[0]?.versions[0]?.quote;
    expect(snapshot?.terms).toBe('기존 합의 조건'); expect(snapshot?.totalAmount).toBe(110);
  });
  it('파일은 이 의뢰의 공개 버전에 포함돼야 다운로드할 수 있다', async () => {
    const { r } = await fixture(); const key = await makeDocument(r.id);
    const file = await prisma.spFile.create({ data: { refType: 'sp_develop_workflow', refId: r.id, originFileName: '검토.pdf', uploadFileName: 'test.pdf', pathToken: 'never-public', size: 4, writeDate: new Date() } });
    const url = `${path(r.id, false)}/files/${String(file.id)}`;
    expect((await app.inject({ method: 'GET', url, headers: headers(ownerToken) })).statusCode).toBe(403);
    const draft = (await get(r.id)).state?.documents[0]?.draft; if (!draft) throw new Error('fixture'); draft.fileIds = [Number(file.id)];
    await ok(r.id, { type: 'document.save', id: key, draft }); await ok(r.id, { type: 'document.publish', id: key });
    expect((await app.inject({ method: 'GET', url, headers: headers(ownerToken) })).statusCode).toBe(200);
    expect(JSON.stringify(await get(r.id, false))).not.toContain('never-public');
    await ok(r.id, { type: 'document.withdraw', id: key });
    expect((await app.inject({ method: 'GET', url, headers: headers(ownerToken) })).statusCode).toBe(403);
  });
  it('납품 문서 승인으로 검수를 완료하고 잔금 전 다운로드는 제한한다', async () => {
    const { r, quote } = await fixture(); await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { status: 'in_progress' } }); const key = await makeDocument(r.id, 'delivery');
    const file = await prisma.spFile.create({ data: { refType: 'sp_develop_workflow', refId: r.id, originFileName: 'final.zip', uploadFileName: 'final.zip', pathToken: 'secret', size: 4, writeDate: new Date() } });
    const draft = (await get(r.id)).state?.documents[0]?.draft; if (!draft) throw new Error('fixture'); draft.fileIds = [Number(file.id)]; await ok(r.id, { type: 'document.save', id: key, draft }); await ok(r.id, { type: 'document.publish', id: key });
    const url = `${path(r.id, false)}/files/${String(file.id)}`;
    expect((await app.inject({ method: 'GET', url, headers: headers(ownerToken) })).statusCode).toBe(403);
    expect((await get(r.id)).state?.documents[0]?.versions[0]?.files[0]?.locked).toBe(false);
    expect((await app.inject({ method: 'GET', url: `${path(r.id)}/files/${String(file.id)}`, headers: headers(adminToken) })).statusCode).toBe(200);
    await ok(r.id, { type: 'document.decide', id: key, version: 1, decision: 'approved', note: '' }, false);
    expect((await get(r.id)).context?.requestStatus).toBe('completed');
    await prisma.spDevelopMilestone.updateMany({ where: { quoteId: quote.id }, data: { status: 'paid' } });
    expect((await app.inject({ method: 'GET', url, headers: headers(ownerToken) })).statusCode).toBe(200);
  });
  it('기존 검수 자동확정을 문서 승인 이력에도 반영한다', async () => {
    const { r } = await fixture(); await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { status: 'in_progress' } }); const key = await makeDocument(r.id, 'delivery'); await ok(r.id, { type: 'document.publish', id: key });
    const delivered = await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { deliveredAt: new Date('2020-01-01') } });
    await ensureDevelopLazy(delivered, app.log);
    expect((await get(r.id, false)).state?.documents[0]?.versions[0]?.decision?.actor).toBe('검수기간 경과');
  });
  it('메일은 최신 공개 버전만 보내고 실패를 성공으로 표시하지 않는다', async () => {
    const { r } = await fixture(); const key = await makeDocument(r.id);
    const payload = { documentId: key, version: 1, subject: '<시험>', body: '<script>test</script>' };
    expect((await app.inject({ method: 'POST', url: `${path(r.id)}/mail`, headers: headers(adminToken), payload })).statusCode).toBe(409);
    await ok(r.id, { type: 'document.publish', id: key });
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('test SMTP failure'));
    const failed = await app.inject({ method: 'POST', url: `${path(r.id)}/mail`, headers: headers(adminToken), payload }); expect(failed.body).toContain('"sent":false');
    const success = await app.inject({ method: 'POST', url: `${path(r.id)}/mail`, headers: headers(adminToken), payload }); expect(success.body).toContain('"sent":true');
    expect(vi.mocked(sendMail).mock.calls.at(-1)?.[0].html).toContain('&lt;script&gt;');
  });
  it('수동 청구를 열면 기존 견적의 결제 가능 상태와 checkout에 반영한다', async () => {
    const { r, quote } = await fixture(); const first = quote.milestones[0]; if (!first) throw new Error('fixture');
    await prisma.spDevelopMilestone.update({ where: { id: first.id }, data: { trigger: 'manual' } });
    const checkout = `/api/develop/requests/${String(r.id)}/milestones/${String(first.id)}/checkout`;
    expect((await app.inject({ method: 'POST', url: checkout, headers: headers(ownerToken) })).body).toContain('NOT_PAYABLE');
    await ok(r.id, { type: 'milestone.open', milestoneId: Number(first.id) });
    const detail = await app.inject({ method: 'GET', url: `/api/develop/requests/${String(r.id)}`, headers: headers(ownerToken) });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(DevelopRequestDetailResponse.parse(detail.json()).data.quotes[0]?.milestones[0]?.payable).toBe(true);
    // 결제 가능 판정은 통과하고, 테스트 토큰에 없는 영카트 세션에서 멈춘다. 실제 주문은 생성하지 않는다.
    expect((await app.inject({ method: 'POST', url: checkout, headers: headers(ownerToken) })).body).toContain('NO_CART_ID');
  });
  it('기존 중간 확인 요청 두 건 중 하나만 승인해도 나머지 대기를 유지한다', async () => {
    const { r } = await fixture(false); await prisma.spDevelopMilestone.updateMany({ where: { requestId: r.id }, data: { status: 'paid' } });
    const first = await prisma.spDevelopEvent.create({ data: { requestId: r.id, type: 'review_request', title: '회로도', byAdmin: true } });
    await prisma.spDevelopEvent.create({ data: { requestId: r.id, type: 'review_request', title: 'PCB', byAdmin: true } });
    await prisma.spDevelopEvent.create({ data: { requestId: r.id, type: 'review_approved', title: '회로도 승인', byAdmin: false, payload: { eventId: Number(first.id) } } });
    const detail = await app.inject({ method: 'GET', url: `/api/develop/requests/${String(r.id)}`, headers: headers(ownerToken) });
    expect(detail.statusCode, detail.body).toBe(200); expect(DevelopRequestDetailResponse.parse(detail.json()).data.nextAction).toBe('answer_review');
  });
  it('AI는 동의를 확인하고 초안만 반환하며 문서를 자동 공개하지 않는다', async () => {
    const { r } = await fixture(); const key = await makeDocument(r.id);
    const response = await app.inject({ method: 'POST', url: `${path(r.id)}/ai-draft`, headers: headers(adminToken), payload: { documentId: key, input: '회로도를 검토하고 있습니다' } });
    expect(response.statusCode, response.body).toBe(200); expect(response.body).toContain('확인된 자료만');
    expect((await get(r.id, false)).state?.documents).toEqual([]);
    await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { aiConsent: false } });
    const denied = await app.inject({ method: 'POST', url: `${path(r.id)}/ai-draft`, headers: headers(adminToken), payload: { documentId: key, input: '자료' } });
    expect(denied.statusCode).toBe(409); expect(denied.body).toContain('AI_CONSENT_REQUIRED');
  });
  it('별도 환경변수 없이 제공하며 의뢰별 중단 시 데이터를 보존하고 기존 결제를 처리한다', async () => {
    const { r, quote } = await fixture(); const key = await makeDocument(r.id); await ok(r.id, { type: 'document.publish', id: key });
    const before = await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: r.id } });
    await ok(r.id, { type: 'disable' });
    const customer = await get(r.id, false);
    expect(customer.available).toBe(true); expect(customer.enabled).toBe(false); expect(customer.state).toBeNull();
    const first = quote.milestones[0]; if (!first) throw new Error('fixture'); await markMilestonePaid(first, 'admin', null, app.log, 'wf-test-admin');
    expect((await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('in_progress');
    const after = await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: r.id } }); expect(after.state).toEqual(before.state);
  });
});
