// 로컬 프로토타입 전용 서버. 운영 server.ts는 이 파일을 import하지 않는다.
// 격리 DB + 별도 포트 + 명시적 실행 플래그를 모두 검사한 뒤 데모 인증을 제공한다.
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WorkState } from '@sp/api-contract';
import auth from '../plugins/auth';
import { prisma } from '../lib/prisma';
import { applyWorkflow } from '../lib/develop-workflow';
import { adminDevelopWorkflowRoutes, developWorkflowRoutes } from '../routes/develop-workflow';
import { adminDevelopRequestRoutes } from '../routes/admin-develop-requests';
import { developRequestRoutes } from '../routes/develop-requests';
import { adminDevelopQuoteRoutes } from '../routes/admin-develop-quotes';
import { adminDevelopSettingsRoutes } from '../routes/admin-develop-settings';
import { meRoutes } from '../routes/me';
import { healthRoutes } from '../routes/health';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (process.env.WORKFLOW_PREVIEW !== '1' || url.hostname !== '127.0.0.1' || url.port !== '3340' || url.pathname !== '/samplepcb_develop_workflow_proto' || process.env.G5_DATABASE_URL !== process.env.DATABASE_URL) throw new Error('격리된 로컬 수행관리 DB와 WORKFLOW_PREVIEW=1이 필요합니다');
if (process.env.FILE_SERVER_URL !== 'http://127.0.0.1:3449' || process.env.SMTP_HOST !== '127.0.0.1' || process.env.SMTP_PORT !== '2529') throw new Error('로컬 파일·메일 대역 설정이 필요합니다');
const root = resolve(process.cwd(), '../../../.tmp/develop-workflow');
const filesRoot = resolve(root, 'files'); const mailRoot = resolve(root, 'mail');
await mkdir(filesRoot, { recursive: true }); await mkdir(mailRoot, { recursive: true });

const fileApp = Fastify(); await fileApp.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
fileApp.post('/api/uploadFileByAnonymous', async (request) => {
  const data: { uploadFileName: string; originFileName: string; pathToken: string; size: number }[] = [];
  for await (const part of request.parts()) {
    if (part.type !== 'file') continue;
    const buffer = await part.toBuffer(); const token = randomUUID().replace(/-/g, '');
    await writeFile(resolve(filesRoot, token), buffer);
    data.push({ uploadFileName: token, originFileName: part.filename, pathToken: token, size: buffer.length });
  }
  return { result: true, data };
});
fileApp.get<{ Params: { token: string } }>('/api/download/:token', async (request, reply) => {
  if (!/^[a-f0-9]{32}$/.test(request.params.token)) return reply.code(404).send();
  try { return await reply.type('application/octet-stream').send(await readFile(resolve(filesRoot, request.params.token))); }
  catch { return reply.code(404).send(); }
});
await fileApp.listen({ host: '127.0.0.1', port: 3449 });

// 외부 전송을 하지 않는 SMTP 수신함. 메일은 .tmp의 eml 파일로만 남는다.
const smtp = createServer((socket) => {
  let buffer = ''; let message = ''; let dataMode = false;
  socket.write('220 workflow-preview ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let end = buffer.indexOf('\r\n');
    while (end >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (dataMode) {
        if (line === '.') {
          dataMode = false;
          void writeFile(resolve(mailRoot, `${randomUUID()}.eml`), message).then(() => { socket.write('250 captured locally\r\n'); }).catch(() => { socket.write('451 local storage failed\r\n'); });
          message = '';
        } else message += `${line}\r\n`;
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 workflow-preview\r\n');
      else if (/^DATA/i.test(line)) { dataMode = true; socket.write('354 End with dot\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
      end = buffer.indexOf('\r\n');
    }
  });
  socket.on('error', () => { socket.destroy(); });
});
await new Promise<void>((ready, reject) => { smtp.once('error', reject); smtp.listen(2529, '127.0.0.1', ready); });

let demo = await prisma.spDevelopRequest.findFirst({ where: { mbId: 'workflow-preview-client' } });
if (demo === null) {
  demo = await prisma.spDevelopRequest.create({ data: { mbId: 'workflow-preview-client', title: '스마트 센서 제어보드 개발', serviceAreas: ['circuit', 'pcb', 'firmware', 'mech', 'app', 'server'], requestMode: 'system', description: '매장 센서 값을 수집하고 원격에서 확인하는 제어보드와 시제품 개발', contactName: '시연 고객', contactCompany: '샘플 프로젝트', contactPhone: '010-0000-0000', contactEmail: 'preview@example.invalid', budgetRange: 'r1000_3000', status: 'accepted', aiConsent: false } });
  await prisma.spDevelopQuote.create({ data: { requestId: demo.id, version: 1, kind: 'initial', status: 'accepted', title: '시제품 개발 견적', supplyAmount: 10000000, vatAmount: 1000000, totalAmount: 11000000, durationDays: 56, terms: '합의한 범위의 설계·시제품 개발. 변경 사항은 추가 견적으로 협의합니다.', exclusions: '양산·인증 수수료 별도', deliverables: ['회로·PCB 설계자료', '펌웨어 소스', '시제품 및 시험 기록'], warrantyDays: 180, validUntil: '2099-12-31', acceptedAt: new Date(), acceptedName: '시연 고객', createdBy: 'workflow-preview-admin',
    items: { create: [{ seq: 1, title: '회로·PCB 설계', amount: 5000000 }, { seq: 2, title: '펌웨어·시제품 검증', amount: 5000000 }] }, milestones: { create: [{ requestId: demo.id, seq: 1, title: '착수금', amount: 5500000, trigger: 'on_accept', status: 'paid', paidAt: new Date(), paidBy: 'admin', paymentKey: randomUUID() }, { requestId: demo.id, seq: 2, title: '잔금', amount: 5500000, trigger: 'on_completion', status: 'pending', paymentKey: randomUUID(), unlocksDeliverables: true }] },
  } });
  const id = demo.id;
  const apply = async (command: Parameters<typeof applyWorkflow>[1]['command']): Promise<void> => { const row = await prisma.spDevelopWorkflow.findUnique({ where: { requestId: id } }); await applyWorkflow(id, { revision: row?.revision ?? 0, command }, { mbId: 'workflow-preview-admin', admin: true }); };
  await apply({ type: 'enable' }); await apply({ type: 'readiness.save', materialsReady: true, materialsNote: '센서 샘플과 인터페이스 요구사항 확인' }); await apply({ type: 'start' });
  await apply({ type: 'document.create', id: 'demo-contract', kind: 'contract' }); await apply({ type: 'document.publish', id: 'demo-contract' });
  await apply({ type: 'document.create', id: 'demo-review', kind: 'review' });
  const initial = WorkState.parse((await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: id } })).state);
  const draft = initial.documents.find((d) => d.id === 'demo-review')?.draft;
  if (draft) { draft.content.fields['검토 단계'] = '회로설계'; draft.content.fields['주요 설계 결정'] = '전원부와 센서 입력부 구성을 확정하고 PCB 배치 전에 확인합니다.'; draft.content.fields['고객 결정 요청사항'] = '커넥터 방향과 센서 설치 위치를 확인해 주세요.'; draft.content.fields['승인 후 다음 업무'] = 'PCB 부품 배치와 배선'; await apply({ type: 'document.save', id: 'demo-review', draft }); }
  await apply({ type: 'document.publish', id: 'demo-review' });
  const state = WorkState.parse((await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: id } })).state);
  state.plan.baseStart = '2026-09-09'; state.plan.baselineEnd = '2026-11-03'; state.plan.forecastEnd = '2026-11-03'; state.plan.completedReport = '착수회의와 주요 요구사항 확인'; state.plan.currentReport = '회로설계·인터페이스 검토'; state.plan.nextReport = '고객 검토 후 PCB 배치 시작';
  state.plan.tasks.forEach((task, i) => { const start = new Date(Date.UTC(2026, 8, 9 + i * 6)); const end = new Date(Date.UTC(2026, 8, 14 + i * 6)); task.start = start.toISOString().slice(0, 10); task.end = end.toISOString().slice(0, 10); if (i === 0) { task.status = 'completed'; task.progress = 100; } else if (i === 1) { task.status = 'in_progress'; task.progress = 65; } if (task.title.includes('PCB')) task.approvalDocumentIds = ['demo-review']; });
  await apply({ type: 'plan.save', plan: state.plan }); await apply({ type: 'plan.publish' });
}

const app = Fastify({ logger: true }); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
await app.register(sensible); await app.register(multipart); await app.register(auth);
const demoMe = (admin: boolean) => {
  const member = { mbId: admin ? 'workflow-preview-admin' : 'workflow-preview-client', mbNick: admin ? '시연 관리자' : '시연 고객', level: admin ? 10 : 2, isAdmin: admin };
  return { member, token: app.jwt.sign(member, { expiresIn: '10m' }) };
};
app.get('/spcb/api/me', () => demoMe(false));
app.get('/admin-auth/spcb/api/me', () => demoMe(true));
await app.register(healthRoutes, { prefix: '/api' });
await app.register(meRoutes, { prefix: '/api' });
await app.register(adminDevelopWorkflowRoutes, { prefix: '/api/admin' }); await app.register(developWorkflowRoutes, { prefix: '/api' });
await app.register(adminDevelopRequestRoutes, { prefix: '/api/admin' }); await app.register(developRequestRoutes, { prefix: '/api' });
await app.register(adminDevelopQuoteRoutes, { prefix: '/api/admin' }); await app.register(adminDevelopSettingsRoutes, { prefix: '/api/admin' });
await app.listen({ host: '127.0.0.1', port: 3339 });
await writeFile(resolve(root, 'preview.json'), JSON.stringify({ requestId: Number(demo.id), adminUrl: `http://127.0.0.1:5183/app/admin/develop/requests/${String(demo.id)}?tab=workflow`, customerUrl: `http://127.0.0.1:5182/develop/requests/${String(demo.id)}` }, null, 2));
console.log(`수행관리 시연 의뢰 #${String(demo.id)} (127.0.0.1 전용, 외부 메일 발송 없음)`);
