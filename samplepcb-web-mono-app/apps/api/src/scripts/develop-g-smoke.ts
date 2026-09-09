import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import playwright from '../../../../e2e/node_modules/playwright-core/index.js';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
} from '../../../../e2e/node_modules/playwright-core/index.js';
import {
  AdminDevelopRequestDetailResponse,
  AdminDevelopQuoteResponse,
  DevelopRequestCreateResponse,
  DevelopRequestDetailResponse,
  DevelopRequestStatus,
  MarketDevReview,
  WorkResponse,
} from '@sp/api-contract';
import type { WorkCommandType, WorkDocumentKind, WorkPlanType } from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  getCfAdminId,
  ensureLocalGSmokeMember,
  closeLocalGSmokeMemberConnection,
} from '../lib/g5-db';
import {
  deleteGSmokeFile,
  gSmokeCheckpoint,
  GSmokeRegistration,
  GSmokeRunId,
  gSmokePrefix,
  gSmokeRoot,
  gSmokeRunDirectory,
  registerGSmokeRun,
  requireLocalGSmoke,
} from '../lib/local-g-smoke';
import { developPrototypeWhere } from '../lib/develop-prototype';

const STAGES = [
  ['접수', 'received', 'content'],
  ['검토서 공개', 'reviewing', 'review'],
  ['견적 발송', 'quoted', 'quotes'],
  ['착수금 대기', 'accepted', 'quotes'],
  ['필수자료 대기', 'accepted', 'workflow'],
  ['착수 준비 완료', 'accepted', 'workflow'],
  ['개발 진행', 'in_progress', 'plan'],
  ['고객 승인 대기', 'in_progress', 'documents'],
  ['고객 수정 요청', 'in_progress', 'documents'],
  ['수정본 승인·진행', 'in_progress', 'plan'],
  ['납품·검수 대기', 'delivered', 'delivery'],
  ['검수 완료·잔금 대기', 'completed', 'quotes'],
  ['잔금 완료·파일 해제', 'completed', 'delivery'],
] as const;
const Credential = z.object({
  ownerId: z.string().regex(/^g_smoke_[a-f0-9]{8}$/),
  password: z.string().min(16),
  passwordHash: z.string(),
});
const Case = z.object({
  step: z.number(),
  label: z.string(),
  requestId: z.number(),
  expectedStatus: DevelopRequestStatus,
  adminUrl: z.string(),
  customerUrl: z.string(),
  passed: z.boolean(),
  finalFileId: z.number().nullable(),
});
const Check = z.object({ name: z.string(), passed: z.boolean(), detail: z.string() });
const Manifest = z.object({
  format: z.literal(1),
  runId: GSmokeRunId,
  target: GSmokeRegistration.shape.target,
  ownerId: z.string(),
  createdAt: z.string(),
  commit: z.string(),
  status: z.enum(['running', 'passed', 'failed', 'cleaned']),
  cases: z.array(Case),
  checks: z.array(Check),
  failure: z.string().nullable(),
});
type ManifestType = z.infer<typeof Manifest>;
const target = requireLocalGSmoke();
const operation = process.argv[2] ?? 'run';
let secretToRedact = '';
const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const day = (offset = 0): string =>
  new Date(Date.now() + (offset * 24 + 9) * 3600000).toISOString().slice(0, 10);

async function save(run: ManifestType): Promise<void> {
  const folder = gSmokeRunDirectory(run.runId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(run, null, 2), { mode: 0o600 });
  const rows = run.cases
    .map(
      (c) =>
        `<tr><td>${String(c.step)}</td><td>${esc(c.label)}</td><td>#${String(c.requestId)}</td><td>${c.passed ? '통과' : '진행 중'}</td><td><a href="${esc(c.adminUrl)}" target="_blank">관리자</a> · <a href="${esc(c.customerUrl)}" target="_blank">고객</a></td><td><a href="screens/${String(c.step)}-admin.png">관리자 화면</a> · <a href="screens/${String(c.step)}-customer.png">고객 화면</a></td></tr>`,
    )
    .join('');
  await writeFile(
    join(folder, 'report.html'),
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>개발(G) 단계별 스모크</title><style>body{font:15px system-ui;max-width:1200px;margin:40px auto;padding:0 20px;color:#172136}table{border-collapse:collapse;width:100%}td,th{padding:14px;border-bottom:1px solid #ddd;text-align:left}a{color:#2563eb}small{color:#64748b}.ok{color:#168454}</style><h1>개발(G) 단계별 스모크</h1><p>${esc(run.runId)} · ${esc(run.status)} · ${String(run.checks.filter((c) => c.passed).length)}/${String(run.checks.length)} 검사 통과</p><p>고객 계정: <b>${esc(run.ownerId)}</b>. 비밀번호는 <a href="../../credentials.json">로컬 로그인 정보</a>에 있습니다. 관리자 링크는 기존 관리자 로그인으로 확인하세요.</p><p>실 PG 결제는 차단되며 메일은 <a href="mail/">로컬 메일 기록</a>으로 보관합니다. 견적/검수 유효기간은 30일이며 시간이 지나면 상태가 바뀔 수 있습니다.</p><table><thead><tr><th>단계</th><th>보존 상태</th><th>의뢰</th><th>결과</th><th>바로가기</th><th>스크린샷</th></tr></thead><tbody>${rows}</tbody></table><h2>검증 기록</h2><ol>${run.checks.map((c) => `<li class="${c.passed ? 'ok' : ''}">${esc(c.name)} — ${esc(c.detail)}</li>`).join('')}</ol>${run.failure ? `<pre>${esc(run.failure)}</pre>` : ''}<small>실행 커밋: ${esc(run.commit)}. 단계별 상태 JSON은 states/에 보관합니다.</small></html>`,
  );
}
async function credentials() {
  const file = join(gSmokeRoot, 'credentials.json');
  await mkdir(gSmokeRoot, { recursive: true });
  let value: z.infer<typeof Credential>;
  try {
    value = Credential.parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const ownerId = `g_smoke_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(15).toString('base64url');
    const salt = randomBytes(24).toString('base64');
    // sp-php lib/pbkdf2.compat.php(create_hash)의 sha256:12000:salt:hash 규약.
    const passwordHash = `sha256:12000:${salt}:${pbkdf2Sync(password, salt, 12000, 24, 'sha256').toString('base64')}`;
    value = { ownerId, password, passwordHash };
    await writeFile(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  }
  secretToRedact = value.password;
  await ensureLocalGSmokeMember(value.ownerId, value.passwordHash);
  return value;
}
function token(mbId: string, isAdmin: boolean): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('기존 JWT_SECRET이 없습니다.');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      mbId,
      mbNick: isAdmin ? '관리자' : 'G시험 고객',
      level: isAdmin ? 10 : 2,
      isAdmin,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7200,
    }),
  ).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}
const payload = (title: string, ownerId: string) => ({
  title,
  requestMode: 'individual',
  serviceAreas: ['pcb', 'app'],
  tools: { version: 1, byArea: {} },
  description:
    '보존 스모크 시험: BLE 온습도 로거. 배터리 동작, 스마트폰 상태 확인, PCB 및 앱 개발.',
  answers: [
    { code: 'pcb.type', choices: ['new'] },
    { code: 'app.flow', choices: [], note: '로그인 → 장치 등록 → 온습도 확인' },
  ],
  currentStage: 'idea',
  targetStage: 'prototype_done',
  wishDate: null,
  wishNote: '계약 후 3개월',
  budgetRange: 'after_quote',
  expertDelegate: false,
  production: {
    prototype: 'count',
    prototypeQty: 5,
    scopes: ['pcb_fab', 'smt'],
    annualQty: 100,
    priority: 'cost',
    sourcing: 'samplepcb_all',
    delivery: 'pcba',
  },
  ndaWanted: false,
  aiConsent: false,
  contact: {
    name: 'G시험 고객',
    company: '로컬 검증용',
    phone: '010-0000-0000',
    email: `${ownerId}@example.invalid`,
    hours: null,
  },
});
function review() {
  return MarketDevReview.parse({
    version: 4,
    brief: {
      serviceAreas: ['pcb', 'app'],
      answers: [
        { code: 'pcb.type', choices: ['new'] },
        { code: 'app.flow', choices: [], note: '장치 상태 확인' },
      ],
    },
    summary: '스모크 검증용 수동 작성 검토서입니다. 실제 AI 호출은 하지 않았습니다.',
    requirements: [{ text: 'BLE 온습도 측정 및 스마트폰 조회', evidence: '시험 의뢰' }],
    areas: ['pcb', 'app'].map((area) => ({
      area,
      summary: `${area} 개발 범위`,
      spec: [{ item: '전원', text: '배터리 3.7V', evidence: '시험 사양' }],
      observations: [],
    })),
    openQuestions: [
      {
        question: '외장 형상은 확정됐나요?',
        why: '배치 확인',
        area: 'pcb',
        resolution: '시험용 표준 외장',
      },
    ],
    checks: [],
    meta: {
      jobId: 'smoke-fixture',
      model: 'manual-fixture',
      promptVersion: 'dev-review.v5',
      inputHash: 'local-smoke',
      generatedAt: new Date().toISOString(),
      attachmentFiles: [],
    },
    adminComment: '보존 상태와 화면 동작을 확인하는 시험 자료입니다.',
    schedule: {
      phases: [
        {
          name: '회로·앱 설계',
          minWeeks: 2,
          maxWeeks: 3,
          output: '설계도·화면',
          prerequisite: '요구사항 확정',
          note: '',
        },
        {
          name: '시제품 시험',
          minWeeks: 1,
          maxWeeks: 2,
          output: '시험 결과',
          prerequisite: '시제품 입고',
          note: '',
        },
      ],
      wishCode: 'm2_3',
      assumptions: '시험용 일정',
    },
  });
}

async function run(): Promise<void> {
  const selection = process.argv
    .find((arg) => arg.startsWith('--steps='))
    ?.slice(8)
    .split(',')
    .map((value) => z.coerce.number().int().min(1).max(STAGES.length).parse(value));
  const owner = await credentials();
  const adminId = await getCfAdminId();
  if (!adminId) throw new Error('관리자 계정이 없습니다.');
  const adminToken = token(adminId, true);
  const ownerToken = token(owner.ownerId, false);
  const runId = `${new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')}-${randomBytes(3).toString('hex')}`;
  const state: ManifestType = {
    format: 1,
    runId,
    target,
    ownerId: owner.ownerId,
    createdAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    status: 'running',
    cases: [],
    checks: [],
    failure: null,
  };
  await registerGSmokeRun({ format: 1, runId, ownerId: owner.ownerId, target });
  await save(state);
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  const api: APIRequestContext = context.request;
  const check = (name: string, passed: boolean, detail: string): void => {
    state.checks.push({ name, passed, detail });
    if (!passed) throw new Error(`${name}: ${detail}`);
  };
  async function call(
    method: string,
    path: string,
    body?: unknown,
    who = adminToken,
    status = 200,
  ) {
    const response = await api.fetch(`${target.origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${who}` },
      ...(body === undefined ? {} : { data: body }),
    });
    const text = await response.text();
    check(
      `${method} ${path}`,
      response.status() === status,
      `${String(response.status())} / 기대 ${String(status)}${response.status() === status ? '' : ` ${text.slice(0, 350)}`}`,
    );
    return JSON.parse(text) as unknown;
  }
  const detail = async (id: number) =>
    AdminDevelopRequestDetailResponse.parse(
      await call('GET', `/api/admin/develop/requests/${String(id)}`),
    ).data;
  const work = async (id: number, who = adminToken) =>
    WorkResponse.parse(
      await call(
        'GET',
        `/api${who === adminToken ? '/admin' : ''}/develop/requests/${String(id)}/workflow`,
        undefined,
        who,
      ),
    ).data;
  const command = async (id: number, value: WorkCommandType, who = adminToken, status = 200) =>
    call(
      'POST',
      `/api${who === adminToken ? '/admin' : ''}/develop/requests/${String(id)}/workflow`,
      { revision: (await work(id, who)).revision, command: value },
      who,
      status,
    );
  async function doc(
    id: number,
    key: string,
    kind: WorkDocumentKind,
    fields: Record<string, string>,
  ) {
    await command(id, { type: 'document.create', id: key, kind });
    const draft = (await work(id)).state?.documents.find((d) => d.id === key)?.draft;
    if (!draft) throw new Error('문서 초안 없음');
    draft.content.fields = fields;
    await command(id, { type: 'document.save', id: key, draft });
    await command(id, { type: 'document.publish', id: key });
  }
  const download = async (id: number, fileId: number, status: number) => {
    const response = await api.get(
      `${target.origin}/api/develop/requests/${String(id)}/workflow/files/${String(fileId)}`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
    );
    check(
      `의뢰 ${String(id)} 납품 파일 잠금`,
      response.status() === status,
      `${String(response.status())} / 기대 ${String(status)}`,
    );
    if (status === 200)
      check(
        `의뢰 ${String(id)} 파일 원문`,
        (await response.body()).toString().includes('G SMOKE FINAL'),
        '로컬 납품 파일 본문 일치',
      );
  };
  try {
    for (let index = 0; index < STAGES.length; index++) {
      if (selection !== undefined && !selection.includes(index + 1)) continue;
      const stage = STAGES[index];
      if (!stage) throw new Error('단계 없음');
      const title = `${gSmokePrefix(runId)} ${String(index + 1).padStart(2, '0')} ${stage[0]} — BLE 로거`;
      const response = await api.post(`${target.origin}/api/develop/requests`, {
        headers: { authorization: `Bearer ${ownerToken}` },
        multipart: { payload: JSON.stringify(payload(title, owner.ownerId)) },
      });
      check(
        `단계 ${String(index + 1)} 의뢰 등록`,
        response.status() === 200,
        String(response.status()),
      );
      const id = DevelopRequestCreateResponse.parse(await response.json()).data.requestId;
      const entry: z.infer<typeof Case> = {
        step: index + 1,
        label: stage[0],
        requestId: id,
        expectedStatus: stage[1],
        adminUrl: `${target.origin}/app/admin/develop/requests/${String(id)}?tab=${stage[2]}&from=overview`,
        customerUrl: `${target.origin}/develop/requests/${String(id)}`,
        passed: false,
        finalFileId: null,
      };
      state.cases.push(entry);
      await save(state);
      if (index >= 1) {
        await call('POST', `/api/admin/develop/requests/${String(id)}/status`, { to: 'reviewing' });
        await call('PUT', `/api/admin/develop/requests/${String(id)}/review`, { review: review() });
        await call('POST', `/api/admin/develop/requests/${String(id)}/review/publish`);
      }
      if (index >= 2) {
        const quote = AdminDevelopQuoteResponse.parse(
          await call('POST', `/api/admin/develop/requests/${String(id)}/quotes`, {
            kind: 'initial',
            title: '시험용 개발 견적',
            vatMode: 'separate',
            durationDays: 30,
            terms: '로컬 스모크용 가상 견적. 실제 결제·외부 메일 없음.',
            validUntil: day(30),
            reviewDays: 30,
            deliverables: ['시험용 설계자료', '완료 보고서'],
            items: [{ title: '회로·앱 설계', amount: 1000000 }],
            milestones: [
              { title: '착수금', ratioBp: 3000, trigger: 'on_accept' },
              { title: '중도금', ratioBp: 4000, trigger: 'manual' },
              { title: '잔금', ratioBp: 3000, trigger: 'on_completion', unlocksDeliverables: true },
            ],
          }),
        ).data;
        await call('POST', `/api/admin/develop/quotes/${String(quote.quoteId)}/send`);
        if (index >= 3) {
          await call(
            'POST',
            `/api/develop/requests/${String(id)}/quotes/${String(quote.quoteId)}/accept`,
            { agree: true, name: 'G시험 고객' },
            ownerToken,
          );
          await command(id, { type: 'enable' });
          await doc(id, 'contract', 'contract', {
            '개발 목적': '로컬 단계별 상태 검증',
            '상세 수행범위': 'BLE 로거 PCB 및 앱 개발',
            '고객 제공사항': '시험용 사양서',
            '착수 조건': '착수금 및 자료 확인',
            '추가 합의사항': '실결제 없는 스모크 데이터',
          });
          const ms = (await detail(id)).quotes[0]?.milestones;
          const first = ms?.[0];
          const middle = ms?.[1];
          const last = ms?.[2];
          if (!first || !middle || !last) throw new Error('결제 단계 없음');
          const blocked = await call(
            'POST',
            `/api/develop/requests/${String(id)}/milestones/${String(first.milestoneId)}/checkout`,
            undefined,
            ownerToken,
            409,
          );
          check(
            `의뢰 ${String(id)} 실 PG 차단`,
            z.object({ error: z.string() }).parse(blocked).error === 'LOCAL_SMOKE_PAYMENT',
            '로컬 보존 의뢰의 PG 진입 차단',
          );
          await command(id, { type: 'start' }, adminToken, 409);
          if (index >= 4) {
            await call(
              'POST',
              `/api/admin/develop/milestones/${String(first.milestoneId)}/mark-paid`,
              { note: '스모크 가상 입금 확인' },
            );
            check(
              `의뢰 ${String(id)} 입금 후 착수 대기`,
              (await detail(id)).status === 'accepted',
              '자동 착수하지 않음',
            );
            await command(id, { type: 'start' }, adminToken, 409);
          }
          if (index >= 5)
            await command(id, {
              type: 'readiness.save',
              materialsReady: true,
              materialsNote: '시험 사양·회로·담당자 확인 완료',
            });
          if (index >= 6) {
            await command(id, { type: 'start' });
            const plan: WorkPlanType = {
              baseStart: day(),
              baselineEnd: day(20),
              forecastEnd: day(20),
              completedReport: '요구사항 검토',
              currentReport: '설계 준비',
              nextReport: '고객 검토 및 PCB 설계',
              tasks: [
                {
                  id: 'requirements',
                  title: '요구사항 정리',
                  assignee: adminId,
                  status: 'in_progress',
                  start: day(),
                  end: day(3),
                  weight: 20,
                  progress: 50,
                  customerVisible: true,
                  dependencies: [],
                  approvalDocumentIds: [],
                  note: '',
                },
                {
                  id: 'pcb',
                  title: 'PCB·앱 설계',
                  assignee: adminId,
                  status: 'planned',
                  start: day(4),
                  end: day(20),
                  weight: 80,
                  progress: 0,
                  customerVisible: true,
                  dependencies: ['requirements'],
                  approvalDocumentIds: [],
                  note: '고객 검토 이후 진행',
                },
              ],
            };
            await command(id, { type: 'plan.save', plan });
            await command(id, { type: 'plan.publish' });
            if (index >= 7) {
              await doc(id, 'review', 'review', {
                '검토 단계': '회로·앱 설계',
                '검토 목적': '고객 확인',
                '완료한 업무': '요구사항 정리',
                '주요 설계 결정': '회로 Rev A, 장치 상태 화면',
                '고객 결정 요청사항': '전원부와 화면 확인',
                '승인 후 다음 업무': 'PCB 설계 착수',
              });
              const task = plan.tasks[0];
              const pcb = plan.tasks[1];
              if (!task || !pcb) throw new Error('작업 없음');
              task.status = 'completed';
              task.progress = 100;
              pcb.approvalDocumentIds = ['review'];
              await command(id, { type: 'plan.save', plan });
              await command(id, { type: 'plan.publish' });
              const attempt = structuredClone(plan);
              const blockedTask = attempt.tasks[1];
              if (!blockedTask) throw new Error('작업 없음');
              blockedTask.status = 'in_progress';
              blockedTask.progress = 20;
              await command(id, { type: 'plan.save', plan: attempt }, adminToken, 409);
              if (index >= 8)
                await command(
                  id,
                  {
                    type: 'document.decide',
                    id: 'review',
                    version: 1,
                    decision: 'changes',
                    note: '배터리 보호 회로를 보완해 주세요.',
                  },
                  ownerToken,
                );
              if (index >= 9) {
                const draft = (await work(id)).state?.documents.find(
                  (d) => d.id === 'review',
                )?.draft;
                if (!draft) throw new Error('초안 없음');
                draft.content.fields['주요 설계 결정'] = '회로 Rev B: 보호회로 보완 및 화면 확인';
                await command(id, { type: 'document.save', id: 'review', draft });
                await command(id, { type: 'document.publish', id: 'review' });
                await command(
                  id,
                  {
                    type: 'document.decide',
                    id: 'review',
                    version: 1,
                    decision: 'approved',
                    note: '',
                  },
                  ownerToken,
                  409,
                );
                await command(
                  id,
                  {
                    type: 'document.decide',
                    id: 'review',
                    version: 2,
                    decision: 'approved',
                    note: '보완 내용을 확인했습니다.',
                  },
                  ownerToken,
                );
                pcb.status = 'in_progress';
                pcb.progress = 50;
                await command(id, { type: 'plan.save', plan });
                await command(id, { type: 'plan.publish' });
                await command(id, { type: 'milestone.open', milestoneId: middle.milestoneId });
                await call(
                  'POST',
                  `/api/admin/develop/milestones/${String(middle.milestoneId)}/mark-paid`,
                  { note: '스모크 중도금 확인' },
                );
              }
              if (index >= 10) {
                pcb.status = 'completed';
                pcb.progress = 100;
                plan.currentReport = '납품 및 검수';
                plan.nextReport = '잔금 확인';
                await command(id, { type: 'plan.save', plan });
                await command(id, { type: 'plan.publish' });
                await command(id, { type: 'document.create', id: 'delivery', kind: 'delivery' });
                const current = await work(id);
                const uploaded = await api.post(
                  `${target.origin}/api/admin/develop/requests/${String(id)}/workflow/files`,
                  {
                    headers: { authorization: `Bearer ${adminToken}` },
                    multipart: {
                      payload: JSON.stringify({
                        revision: current.revision,
                        documentId: 'delivery',
                      }),
                      files: {
                        name: 'final-report.txt',
                        mimeType: 'text/plain',
                        buffer: Buffer.from(`G SMOKE FINAL\n${runId}\n시험용 최종 납품 자료`),
                      },
                    },
                  },
                );
                check(
                  `의뢰 ${String(id)} 로컬 납품 파일 업로드`,
                  uploaded.status() === 200,
                  `${String(uploaded.status())} ${uploaded.status() === 200 ? '' : await uploaded.text()}`,
                );
                const prepared = await work(id);
                const delivery = prepared.state?.documents.find((d) => d.id === 'delivery')?.draft;
                if (!delivery) throw new Error('납품 초안 없음');
                delivery.content.fields['계약 범위 대비 완료 결과'] = '설계·시험 완료, 가상 납품';
                delivery.content.fields['납품일·방법'] = `${day()} 문서 전달`;
                await command(id, { type: 'document.save', id: 'delivery', draft: delivery });
                await command(id, { type: 'document.publish', id: 'delivery' });
                const file = delivery.fileIds[0];
                if (file === undefined) throw new Error('납품 파일 없음');
                entry.finalFileId = file;
                await download(id, file, 403);
                if (index >= 11) {
                  await command(
                    id,
                    {
                      type: 'document.decide',
                      id: 'delivery',
                      version: 1,
                      decision: 'approved',
                      note: '검수 완료',
                    },
                    ownerToken,
                  );
                  await download(id, file, 403);
                }
                if (index >= 12) {
                  await call(
                    'POST',
                    `/api/admin/develop/milestones/${String(last.milestoneId)}/mark-paid`,
                    { note: '스모크 잔금 확인' },
                  );
                  await download(id, file, 200);
                }
              }
            }
          }
        }
      }
      const actual = await detail(id);
      check(
        `단계 ${String(index + 1)} 상태`,
        actual.status === stage[1],
        `${actual.status} / ${stage[1]}`,
      );
      const customer = DevelopRequestDetailResponse.parse(
        await call('GET', `/api/develop/requests/${String(id)}`, undefined, ownerToken),
      ).data;
      await call('GET', `/api/admin/develop-c/requests/${String(id)}`, undefined, adminToken, 404);
      const folder = join(gSmokeRunDirectory(runId), 'states');
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, `${String(index + 1)}-admin.json`),
        JSON.stringify({ detail: actual, workflow: await work(id) }, null, 2),
      );
      await writeFile(
        join(folder, `${String(index + 1)}-customer.json`),
        JSON.stringify({ detail: customer, workflow: await work(id, ownerToken) }, null, 2),
      );
      entry.passed = true;
      await save(state);
      console.log(
        `${String(index + 1).padStart(2, '0')} ${stage[0]}: #${String(id)} ${actual.status}`,
      );
    }
    await captureViews(state, context, browser, owner, adminId, adminToken, check);
    state.status = 'passed';
    await save(state);
    console.log(
      `PASS ${String(state.checks.length)} checks; ${String(state.cases.length)} retained cases\nReport: ${join(gSmokeRunDirectory(runId), 'report.html')}\nCredentials: ${join(gSmokeRoot, 'credentials.json')}`,
    );
  } catch (error) {
    state.status = 'failed';
    state.failure = (error instanceof Error ? error.message : String(error)).replaceAll(
      owner.password,
      '[redacted]',
    );
    await save(state);
    throw new Error(
      `${state.failure}\n실행 기록: ${join(gSmokeRunDirectory(runId), 'report.html')}`,
      { cause: error },
    );
  } finally {
    await browser.close();
  }
}

async function captureViews(
  state: ManifestType,
  context: BrowserContext,
  browser: Browser,
  owner: z.infer<typeof Credential>,
  adminId: string,
  adminToken: string,
  check: (name: string, passed: boolean, detail: string) => void,
): Promise<void> {
  const runId = state.runId;
  const screenshots = join(gSmokeRunDirectory(runId), 'screens');
  await mkdir(screenshots, { recursive: true });
  await context.route('**/spcb/api/me', (route) =>
    route.fulfill({
      json: {
        token: adminToken,
        member: { mbId: adminId, mbNick: '관리자', level: 10, isAdmin: true },
      },
    }),
  );
  const adminPage = await context.newPage();
  const customerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 1000 },
  });
  const customerPage = await customerContext.newPage();
  const pageErrors: string[] = [];
  for (const page of [adminPage, customerPage])
    page.on('pageerror', (error) => pageErrors.push(error.message));
  await customerPage.goto(
    `${target.origin}/bbs/login.php?url=${encodeURIComponent(`${target.origin}/develop/me`)}`,
  );
  await customerPage.locator('input[name="mb_id"]:visible').fill(owner.ownerId);
  await customerPage.locator('input[name="mb_password"]:visible').fill(owner.password);
  await customerPage
    .locator('form')
    .filter({ has: customerPage.locator('input[name="mb_password"]') })
    .locator('button[type="submit"],input[type="submit"]')
    .first()
    .click();
  await customerPage.waitForURL((url) => url.pathname.startsWith('/develop'), { timeout: 15000 });
  const me = await customerContext.request.get(`${target.origin}/spcb/api/me`);
  const identity = z.object({ member: z.object({ mbId: z.string() }) }).parse(await me.json());
  check(
    '실제 PHP 고객 로그인',
    identity.member.mbId === owner.ownerId,
    '그누보드 세션과 고객 계정 일치',
  );
  for (const entry of state.cases) {
    if (entry.step === 8 || entry.step === 9) {
      const url = new URL(entry.adminUrl);
      url.searchParams.set('doc', 'review');
      entry.adminUrl = url.toString();
    }
    if (entry.step >= 4)
      entry.customerUrl = `${target.origin}/develop/requests/${String(entry.requestId)}#workflow`;
    await adminPage.goto(entry.adminUrl);
    await adminPage
      .getByRole('heading', { level: 1 })
      .filter({ hasText: gSmokePrefix(runId) })
      .waitFor();
    await customerPage.goto(entry.customerUrl);
    await customerPage
      .getByRole('heading', { level: 1 })
      .filter({ hasText: gSmokePrefix(runId) })
      .waitFor();
    if (entry.step >= 4) {
      await adminPage.locator('.develop-workflow .workflow-header').waitFor({ state: 'attached' });
      await customerPage.locator('.develop-workflow .workflow-header').waitFor();
    }
    if ([8, 9, 11, 12, 13].includes(entry.step)) {
      const panel = customerPage.locator('.develop-workflow');
      await panel
        .locator('.workflow-nav')
        .getByRole('button', { name: /문서·승인/ })
        .click();
      const name = entry.step < 11 ? '중간 개발검토서' : '납품 완료확인서';
      await panel
        .locator('.document-nav')
        .getByRole('button', { name: new RegExp(name) })
        .click();
      await panel
        .locator('.document-main')
        .getByRole('heading', { name, exact: true })
        .first()
        .waitFor();
      check(`단계 ${String(entry.step)} 고객 문서 선택`, true, name);
    }
    check(
      `단계 ${String(entry.step)} 브라우저`,
      (await adminPage.locator('body').innerText()).includes(entry.label) &&
        (await customerPage.locator('body').innerText()).includes(entry.label),
      '관리자·고객 상세 표시',
    );
    await adminPage.screenshot({
      path: join(screenshots, `${String(entry.step)}-admin.png`),
      fullPage: true,
    });
    const customerShot = join(screenshots, `${String(entry.step)}-customer.png`);
    if (entry.step >= 4)
      await customerPage.locator('.develop-workflow').screenshot({ path: customerShot });
    else await customerPage.screenshot({ path: customerShot, fullPage: true });
    if ([8, 13].includes(entry.step)) {
      await customerPage.setViewportSize({ width: 390, height: 844 });
      check(
        `단계 ${String(entry.step)} 고객 모바일`,
        await customerPage.evaluate<boolean>(
          'document.documentElement.scrollWidth <= window.innerWidth + 1',
        ),
        '가로 넘침 없음',
      );
      await customerPage
        .locator('.develop-workflow')
        .screenshot({ path: join(screenshots, `${String(entry.step)}-customer-mobile.png`) });
      await customerPage.setViewportSize({ width: 1280, height: 1000 });
    }
  }
  check('브라우저 실행 오류', pageErrors.length === 0, pageErrors.join('\n') || '0건');
  const mailFiles = await readdir(join(gSmokeRunDirectory(runId), 'mail'));
  check('메일 대역 기록', mailFiles.length > 0, `${String(mailFiles.length)}개 로컬 수신 기록`);
}

async function captureExisting(runId: string): Promise<void> {
  const state = await existingRun(runId);
  if (state.status === 'cleaned') throw new Error('정리된 실행은 다시 촬영할 수 없습니다.');
  const owner = await credentials();
  if (owner.ownerId !== state.ownerId) throw new Error('테스트 고객 계정이 일치하지 않습니다.');
  const adminId = await getCfAdminId();
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  const check = (name: string, passed: boolean, detail: string): void => {
    state.checks.push({ name, passed, detail });
    if (!passed) throw new Error(name + ': ' + detail);
  };
  try {
    await captureViews(state, context, browser, owner, adminId, token(adminId, true), check);
    state.status =
      state.cases.every((entry) => entry.passed) && state.checks.every((entry) => entry.passed)
        ? 'passed'
        : 'failed';
    state.failure = null;
    await save(state);
    console.log('단계별 화면 재촬영 완료: ' + join(gSmokeRunDirectory(runId), 'report.html'));
  } catch (error) {
    state.status = 'failed';
    state.failure = (error instanceof Error ? error.message : String(error)).replaceAll(
      owner.password,
      '[redacted]',
    );
    await save(state);
    throw error;
  } finally {
    await browser.close();
  }
}

async function existingRun(runId: string): Promise<ManifestType> {
  const run = Manifest.parse(
    JSON.parse(await readFile(join(gSmokeRunDirectory(runId), 'manifest.json'), 'utf8')) as unknown,
  );
  if (JSON.stringify(run.target) !== JSON.stringify(target))
    throw new Error('이 실행의 DB 대상이 현재 로컬 DB와 다릅니다.');
  return run;
}
async function cleanup(runId: string): Promise<void> {
  const run = await existingRun(runId);
  const prefix = `${gSmokePrefix(runId)} `;
  const rows = await prisma.spDevelopRequest.findMany({
    where: {
      OR: [
        { id: { in: run.cases.map((c) => BigInt(c.requestId)) } },
        { AND: [{ mbId: run.ownerId, title: { startsWith: prefix } }, developPrototypeWhere('g')] },
      ],
    },
    select: { id: true, mbId: true, title: true, prototype: { select: { variant: true } } },
  });
  for (const row of rows)
    if (row.mbId !== run.ownerId || !row.title.startsWith(prefix) || row.prototype?.variant === 'c')
      throw new Error('실행 범위 밖 의뢰가 포함되어 정리를 중단했습니다.');
  const ids = rows.map((r) => r.id);
  const milestones = await prisma.spDevelopMilestone.findMany({
    where: { requestId: { in: ids } },
    select: { ctId: true, paidOdId: true },
  });
  if (milestones.some((m) => m.ctId !== null || m.paidOdId !== null))
    throw new Error('실제 주문과 연결된 의뢰는 자동으로 정리하지 않습니다.');
  const [events, quotes] = await Promise.all([
    prisma.spDevelopEvent.findMany({ where: { requestId: { in: ids } }, select: { id: true } }),
    prisma.spDevelopQuote.findMany({ where: { requestId: { in: ids } }, select: { id: true } }),
  ]);
  const fileWhere = {
    OR: [
      { refType: { in: ['sp_develop_request', 'sp_develop_workflow'] }, refId: { in: ids } },
      { refType: 'sp_develop_event', refId: { in: events.map((e) => e.id) } },
      { refType: 'sp_develop_quote', refId: { in: quotes.map((q) => q.id) } },
    ],
  };
  const files = await prisma.spFile.findMany({
    where: fileWhere,
    select: { id: true, pathToken: true },
  });
  if (files.some((f) => !f.pathToken.startsWith(`local-g-smoke:${runId}:`)))
    throw new Error('외부 첨부가 추가되어 정리를 중단했습니다. 해당 첨부를 먼저 확인해 주세요.');
  if (process.argv.includes('--dry-run')) {
    console.log(
      `정리 대상: 의뢰 ${String(ids.length)}개, 파일 ${String(files.length)}개. DB 변경 없음.`,
    );
    return;
  }
  await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM sp_develop_request WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`,
      );
      const current = await tx.spDevelopRequest.findMany({
        where: { id: { in: ids } },
        select: { mbId: true, title: true },
      });
      if (current.some((row) => row.mbId !== run.ownerId || !row.title.startsWith(prefix)))
        throw new Error('의뢰 내용이 바뀌어 정리를 중단했습니다.');
      const linked = await tx.spDevelopMilestone.count({
        where: {
          requestId: { in: ids },
          OR: [{ ctId: { not: null } }, { paidOdId: { not: null } }],
        },
      });
      if (linked > 0) throw new Error('실제 주문 연결이 생겨 정리를 중단했습니다.');
    }
    await tx.spDevelopWorkflowAudit.deleteMany({ where: { requestId: { in: ids } } });
    await tx.spDevelopWorkflow.deleteMany({ where: { requestId: { in: ids } } });
    await tx.spFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
    await tx.spMailLog.deleteMany({
      where: { refType: 'develop_request', refId: { in: ids.map(String) } },
    });
    await tx.spDevelopRequest.deleteMany({
      where: { id: { in: ids }, mbId: run.ownerId, title: { startsWith: prefix } },
    });
  });
  for (const file of files) await deleteGSmokeFile(file.pathToken);
  await unlink(join(gSmokeRoot, 'registry', `${runId}.json`)).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  });
  run.status = 'cleaned';
  await save(run);
  console.log(
    `정리 완료: ${String(ids.length)}개 의뢰. 계정과 보고서·스크린샷·메일 기록은 보존했습니다.`,
  );
}
async function status(runId: string): Promise<void> {
  const run = await existingRun(runId);
  const api = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  const auth = { authorization: `Bearer ${token(await getCfAdminId(), true)}` };
  const result: { requestId: number; matches: boolean; status: string }[] = [];
  try {
    for (const c of run.cases) {
      const response = await api.get(
        `${target.origin}/api/admin/develop/requests/${String(c.requestId)}`,
        { headers: auth },
      );
      if (response.status() === 404) {
        result.push({ requestId: c.requestId, matches: false, status: '조회 불가' });
        continue;
      }
      if (response.status() !== 200) throw new Error('의뢰 조회에 실패했습니다.');
      const detail = AdminDevelopRequestDetailResponse.parse(await response.json()).data;
      const workflowResponse = await api.get(
        `${target.origin}/api/admin/develop/requests/${String(c.requestId)}/workflow`,
        { headers: auth },
      );
      const workflow = WorkResponse.parse(await workflowResponse.json()).data;
      const expected = z
        .object({
          detail: AdminDevelopRequestDetailResponse.shape.data,
          workflow: WorkResponse.shape.data,
        })
        .parse(
          JSON.parse(
            await readFile(
              join(gSmokeRunDirectory(runId), 'states', `${String(c.step)}-admin.json`),
              'utf8',
            ),
          ) as unknown,
        );
      const matches =
        gSmokeCheckpoint(detail, workflow) === gSmokeCheckpoint(expected.detail, expected.workflow);
      result.push({ requestId: c.requestId, matches, status: detail.status });
      console.log(
        `${String(c.step)} #${String(c.requestId)} ${c.label}: ${detail.status} ${matches ? 'OK' : '변경됨'}`,
      );
    }
    await writeFile(
      join(gSmokeRunDirectory(runId), 'status-check.json'),
      JSON.stringify({ checkedAt: new Date().toISOString(), cases: result }, null, 2),
    );
  } finally {
    await api.dispose();
  }
}
try {
  if (operation === 'run') await run();
  else if (operation === 'capture') await captureExisting(GSmokeRunId.parse(process.argv[3]));
  else if (operation === 'cleanup') await cleanup(GSmokeRunId.parse(process.argv[3]));
  else if (operation === 'status') await status(GSmokeRunId.parse(process.argv[3]));
  else
    throw new Error(
      '사용: develop:g-smoke run [--steps=1,8,13] | capture <runId> | status <runId> | cleanup <runId> [--dry-run]',
    );
} catch (error) {
  console.error(
    (error instanceof Error ? error.message : String(error)).replaceAll(
      secretToRedact || '\u0000',
      '[redacted]',
    ),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await closeLocalGSmokeMemberConnection();
}
