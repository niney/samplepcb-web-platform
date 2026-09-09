import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { DevelopRequestCreateResponse, WorkResponse } from '@sp/api-contract';
import {
  AdminDevelopDocumentResponse,
  AdminDevelopRequestListResponse as CList,
} from '@sp/api-contract/develop-c';
import { prisma } from '../lib/prisma';
import auth from '../plugins/auth';
import { adminDevelopRequestRoutes } from './admin-develop-requests';
import { developRequestRoutes } from './develop-requests';
import { adminDevelopQuoteRoutes } from './admin-develop-quotes';
import { adminDevelopWorkspaceRoutes } from './admin-develop-workspace';
import { adminDevelopWorkflowRoutes, developWorkflowRoutes } from './develop-workflow';
import { adminDevelopSettingsRoutes } from './admin-develop-settings';
import { adminDevelopRequestRoutes as cAdmin } from './admin-develop-c-requests';
import { developRequestRoutes as cCustomer } from './develop-c-requests';
import { adminDevelopQuoteRoutes as cQuotes } from './admin-develop-c-quotes';
import { adminDevelopDocRoutes as cDocs } from './admin-develop-c-docs';
import { adminDevelopSettingsRoutes as cSettings } from './admin-develop-c-settings';
import { getDevelopSettings, getDevelopSettingsForRequest } from '../lib/develop-settings';
import { chromium } from '../../../../e2e/node_modules/playwright-core/index';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

vi.mock('../lib/mailer', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/file-server', () => ({
  uploadToFileServer: vi
    .fn()
    .mockResolvedValue([
      {
        uploadFileName: 'test.txt',
        originFileName: 'test.txt',
        pathToken: 'coexist-test-file',
        size: 4,
      },
    ]),
  downloadFromFileServer: vi
    .fn()
    .mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'text/plain' }),
}));

describe.skipIf(process.env.WORKFLOW_INTEGRATION !== '1')('개발 G/C 의뢰 격리', () => {
  const app = Fastify();
  const ids: bigint[] = [];
  let admin = '';
  let owner = '';
  let stranger = '';
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('3344');
    expect(url.pathname).toBe('/samplepcb_develop_workflow_proto');
    expect(process.env.G5_DATABASE_URL).toBe(process.env.DATABASE_URL);
    await prisma.$connect();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(sensible);
    await app.register(multipart);
    await app.register(auth);
    for (const route of [
      adminDevelopRequestRoutes,
      adminDevelopQuoteRoutes,
      adminDevelopSettingsRoutes,
      adminDevelopWorkspaceRoutes,
      adminDevelopWorkflowRoutes,
      cAdmin,
      cQuotes,
      cDocs,
      cSettings,
    ])
      await app.register(route, { prefix: '/api/admin' });
    for (const route of [developRequestRoutes, developWorkflowRoutes, cCustomer])
      await app.register(route, { prefix: '/api' });
    await app.ready();
    const claims = {
      mbNick: '시험',
      level: 2,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    admin = app.jwt.sign({ ...claims, mbId: 'coexist-admin', isAdmin: true });
    owner = app.jwt.sign({ ...claims, mbId: 'coexist-owner', isAdmin: false });
    stranger = app.jwt.sign({ ...claims, mbId: 'coexist-stranger', isAdmin: false });
  });
  afterEach(async () => {
    const docs = await prisma.spDevelopDocument.findMany({
      where: { requestId: { in: ids } },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: {
        OR: [
          { refType: 'sp_develop_document', refId: { in: docs.map((d) => d.id) } },
          { refType: { in: ['sp_develop_request', 'sp_develop_workflow'] }, refId: { in: ids } },
        ],
      },
    });
    await prisma.spDevelopWorkflowAudit.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.spDevelopWorkflow.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.spMailLog.deleteMany({
      where: { refType: 'develop_request', refId: { in: ids.map(String) } },
    });
    await prisma.spDevelopRequest.deleteMany({ where: { id: { in: ids } } });
    ids.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  const headers = (token = admin) => ({ authorization: `Bearer ${token}` });
  const detailPath = (id: bigint, variant: 'g' | 'c', customer = false) =>
    `/api${customer ? '' : '/admin'}/develop${variant === 'c' ? '-c' : ''}/requests/${String(id)}`;
  async function fixture(variant: 'g' | 'c') {
    const r = await prisma.spDevelopRequest.create({
      data: {
        mbId: 'coexist-owner',
        title: `coexist-${variant}`,
        status: 'accepted',
        description: '분리 시험',
        serviceAreas: ['pcb'],
        budgetRange: 'after_quote',
        contactName: '시험',
        contactPhone: '010-0000-0000',
        contactEmail: 'test@example.invalid',
        ...(variant === 'c' ? { prototype: { create: { variant: 'c' } } } : {}),
      },
    });
    ids.push(r.id);
    const q = await prisma.spDevelopQuote.create({
      data: {
        requestId: r.id,
        version: 1,
        kind: 'initial',
        status: 'accepted',
        title: '시험 견적',
        terms: '시험',
        validUntil: '2099-12-31',
        createdBy: 'coexist-admin',
        totalAmount: 100,
        supplyAmount: 100,
        acceptedAt: new Date(),
        acceptedName: '시험',
        items: { create: [{ seq: 1, title: '설계', amount: 100 }] },
        milestones: {
          create: [
            {
              requestId: r.id,
              seq: 1,
              title: '착수금',
              amount: 100,
              trigger: 'on_accept',
              status: 'pending',
              paymentKey: crypto.randomUUID(),
            },
          ],
        },
      },
      include: { milestones: true },
    });
    return { r, q };
  }
  async function cDocument(
    id: bigint,
    type: 'change_request' | 'delivery_confirm' | 'design_review',
  ) {
    const content =
      type === 'change_request'
        ? { change: '시험 변경' }
        : type === 'delivery_confirm'
          ? { result: '납품 완료' }
          : { purpose: '설계 검토' };
    const res = await app.inject({
      method: 'POST',
      url: `${detailPath(id, 'c')}/documents`,
      headers: headers(),
      payload: { type, content },
    });
    expect(res.statusCode, res.body).toBe(200);
    return AdminDevelopDocumentResponse.parse(res.json()).data;
  }
  async function send(docId: number) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/develop-c/documents/${String(docId)}/send`,
      headers: headers(),
      payload: { mailSubject: '시험 문서', mailBody: '본문 확인', sendMail: false },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  it('기존 의뢰는 G, C 등록은 소속을 원자적으로 고정하고 목록·배지에서 분리한다', async () => {
    const { r: g } = await fixture('g');
    const boundary = 'coexist-boundary';
    const payload = {
      title: 'C 등록 시험',
      requestMode: 'individual',
      serviceAreas: ['pcb', 'app'],
      tools: { version: 1, byArea: {} },
      description: '분리된 개발 의뢰 등록 시험입니다.',
      answers: [
        { code: 'pcb.type', choices: ['new'] },
        { code: 'app.flow', choices: [], note: '로그인 후 상태 확인' },
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
        scopes: ['pcb_fab'],
        annualQty: 100,
        priority: 'cost',
        sourcing: 'samplepcb_all',
        delivery: 'pcba',
      },
      ndaWanted: false,
      aiConsent: false,
      contact: {
        name: '시험',
        company: null,
        phone: '010-0000-0000',
        email: 'test@example.invalid',
        hours: null,
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/develop-c/requests',
      headers: { ...headers(owner), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`,
      ),
    });
    expect(res.statusCode, res.body).toBe(200);
    const c = BigInt(DevelopRequestCreateResponse.parse(res.json()).data.requestId);
    ids.push(c);
    expect(await prisma.spDevelopPrototype.findUnique({ where: { requestId: c } })).toMatchObject({
      variant: 'c',
    });
    const cList = await app.inject({ url: '/api/admin/develop-c/requests', headers: headers() });
    expect(cList.statusCode, cList.body).toBe(200);
    expect(CList.parse(cList.json()).data.items.map((x) => x.requestId)).toContain(Number(c));
    expect(CList.parse(cList.json()).data.items.map((x) => x.requestId)).not.toContain(
      Number(g.id),
    );
    for (const url of [
      '/api/admin/develop/requests',
      '/api/admin/develop/workspace',
      '/api/develop/my/requests',
    ]) {
      const response = await app.inject({
        url,
        headers: headers(url.includes('/admin/') ? admin : owner),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toContain('C 등록 시험');
      expect(response.body).toContain('coexist-g');
    }
  });
  it('관리자·고객이 다른 쪽 의뢰 URL로 읽거나 수정·승인·작업표를 처리할 수 없다', async () => {
    const { r: g } = await fixture('g');
    const { r: c } = await fixture('c');
    for (const [id, wrong] of [
      [g.id, 'c'],
      [c.id, 'g'],
    ] as const) {
      for (const customer of [true, false])
        expect(
          (
            await app.inject({
              url: detailPath(id, wrong, customer),
              headers: headers(customer ? owner : admin),
            })
          ).statusCode,
        ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: detailPath(id, wrong),
            headers: headers(),
            payload: { internalMemo: '교차 수정' },
          })
        ).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `${detailPath(g.id, 'c')}/tasks`,
          headers: headers(),
          payload: { tasks: [] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${detailPath(c.id, 'g')}/workflow`,
          headers: headers(),
          payload: { revision: 0, command: { type: 'enable' } },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: detailPath(c.id, 'c', true), headers: headers(stranger) }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ url: detailPath(c.id, 'c') })).statusCode).toBe(401);
    expect(await prisma.spDevelopWorkflow.findUnique({ where: { requestId: c.id } })).toBeNull();
  });
  it('견적·결제 ID만 있는 엔드포인트도 소속을 검사하고 C 결제는 G 의뢰에 영향을 주지 않는다', async () => {
    const { r: g, q: gq } = await fixture('g');
    const { r: c, q: cq } = await fixture('c');
    const mid = cq.milestones[0]?.id;
    if (mid === undefined) throw new Error('milestone missing');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/admin/develop/milestones/${String(mid)}/mark-paid`,
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/develop-c/quotes/${String(gq.id)}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    const paid = await app.inject({
      method: 'POST',
      url: `/api/admin/develop-c/milestones/${String(mid)}/mark-paid`,
      headers: headers(),
      payload: {},
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect((await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'in_progress',
    );
    expect((await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: g.id } })).status).toBe(
      'accepted',
    );
    expect(
      (
        await prisma.spDevelopMilestone.findUniqueOrThrow({
          where: { id: gq.milestones[0]?.id ?? 0n },
        })
      ).status,
    ).toBe('pending');
  });
  it('C의 문서 결정·추가 견적·납품 완료는 G 수행관리 상태와 원장을 변경하지 않는다', async () => {
    const { r: g } = await fixture('g');
    const { r: c } = await fixture('c');
    const enabled = await app.inject({
      method: 'POST',
      url: `${detailPath(g.id, 'g')}/workflow`,
      headers: headers(),
      payload: { revision: 0, command: { type: 'enable' } },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const before = WorkResponse.parse(enabled.json()).data;
    const change = await cDocument(c.id, 'change_request');
    await send(change.documentId);
    const decided = await app.inject({
      method: 'POST',
      url: `${detailPath(c.id, 'c', true)}/documents/${String(change.documentId)}/decide`,
      headers: headers(owner),
      payload: { decision: 'approved', name: '시험 고객' },
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(await prisma.spDevelopQuote.count({ where: { requestId: c.id, kind: 'change' } })).toBe(
      1,
    );
    expect(await prisma.spDevelopQuote.count({ where: { requestId: g.id, kind: 'change' } })).toBe(
      0,
    );
    await prisma.spDevelopRequest.update({
      where: { id: c.id },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
    const delivery = await cDocument(c.id, 'delivery_confirm');
    await send(delivery.documentId);
    const approved = await app.inject({
      method: 'POST',
      url: `${detailPath(c.id, 'c', true)}/documents/${String(delivery.documentId)}/decide`,
      headers: headers(owner),
      payload: { decision: 'approved', name: '시험 고객' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'completed',
    );
    const after = await app.inject({
      url: `${detailPath(g.id, 'g')}/workflow`,
      headers: headers(),
    });
    expect(WorkResponse.parse(after.json()).data).toEqual(before);
  });
  it('C 업무 설정은 별도 행에 저장하고 결제·AI가 의뢰 소속 설정을 읽는다', async () => {
    const { r: g } = await fixture('g');
    const { r: c } = await fixture('c');
    const gBefore = await getDevelopSettings();
    const cBefore = await prisma.spDevelopSettings.findUnique({ where: { id: 2 } });
    expect(cBefore).toBeNull();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/develop-c/settings',
        headers: headers(),
        payload: { defaultTerms: 'C 전용 시험 조건', defaultReviewDays: 11, aiAutoDraft: false },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(await getDevelopSettings()).toEqual(gBefore);
      expect((await getDevelopSettingsForRequest(c.id)).defaultTerms).toBe('C 전용 시험 조건');
      expect(await getDevelopSettingsForRequest(g.id)).toEqual(gBefore);
    } finally {
      await prisma.spDevelopSettings.deleteMany({ where: { id: 2 } });
    }
  });
  it('문서와 파일 ID를 이용해도 반대 프로토타입의 첨부를 읽거나 변경하지 못한다', async () => {
    const { r: c } = await fixture('c');
    const doc = await cDocument(c.id, 'design_review');
    const boundary = 'coexist-file';
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/admin/develop-c/documents/${String(doc.documentId)}/files`,
      headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\ntest\r\n--${boundary}--\r\n`,
      ),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const file = await prisma.spFile.findFirstOrThrow({
      where: { refType: 'sp_develop_document', refId: BigInt(doc.documentId) },
    });
    expect(
      (await app.inject({ url: `/api/admin/develop/files/${String(file.id)}`, headers: headers() }))
        .statusCode,
    ).toBe(404);
    const downloaded = await app.inject({
      url: `/api/admin/develop-c/files/${String(file.id)}`,
      headers: headers(),
    });
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(
      (
        await app.inject({
          url: `${detailPath(c.id, 'g', true)}/files/${String(file.id)}`,
          headers: headers(owner),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `${detailPath(c.id, 'c', true)}/files/${String(file.id)}`,
          headers: headers(owner),
        })
      ).statusCode,
    ).not.toBe(200);
  });
  it.skipIf(process.env.PROTOTYPE_BROWSER !== '1')(
    '한 화면에서 G/C 메뉴와 고객 상세를 오가며 의뢰를 분리한다',
    async () => {
      const { r: g } = await fixture('g');
      const { r: c } = await fixture('c');
      const doc = await cDocument(c.id, 'design_review');
      await send(doc.documentId);
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      const errors: string[] = [];
      const folder = resolve('../../../.tmp/develop-coexist');
      await mkdir(folder, { recursive: true });
      try {
        const context = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: 1440, height: 1000 },
        });
        await context.route(
          (url) => url.pathname.startsWith('/api/'),
          async (route) => {
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: `${address}${url.pathname}${url.search}` });
            await route.fulfill({ response });
          },
        );
        await context.route('**/spcb/api/me', (route) =>
          route.fulfill({
            json: {
              token: admin,
              member: { mbId: 'coexist-admin', mbNick: '시험 관리자', level: 10, isAdmin: true },
            },
          }),
        );
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        const diagnostics: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.location().url.includes('/api/'))
            diagnostics.push(message.text() + ' ' + message.location().url);
        });
        page.on('requestfailed', (request) => {
          if (!request.url().includes('/api/'))
            diagnostics.push(request.url() + ' ' + (request.failure()?.errorText ?? 'unknown'));
        });
        const base = 'https://local-web.samplepcb.co.kr';
        await page.goto(`${base}/app/admin/develop`);
        await page.getByRole('link', { name: '개발(G)', exact: true }).waitFor();
        await page.getByRole('link', { name: '개발(C)', exact: true }).waitFor();
        await page.getByRole('link', { name: 'coexist-g', exact: true }).waitFor();
        expect(await page.getByText('coexist-c', { exact: true }).count()).toBe(0);
        await page.getByRole('link', { name: '개발(C)', exact: true }).click();
        await page.getByText('coexist-c', { exact: true }).first().waitFor();
        expect(await page.getByText('coexist-g', { exact: true }).count()).toBe(0);
        await page.screenshot({ path: resolve(folder, 'admin-c.png'), fullPage: true });
        await page.goto(`${base}/app/admin/develop-c/requests/${String(c.id)}?tab=documents`);
        await page.getByRole('tab', { name: '프로젝트 문서', exact: false }).waitFor();
        await page.locator(':text("DR-01"):visible').first().waitFor();
        await page.screenshot({ path: resolve(folder, 'admin-c-documents.png'), fullPage: true });
        await page.locator('aside > nav').getByRole('link', { name: '설정', exact: true }).click();
        await page.getByRole('heading', { name: '개발의뢰 설정', exact: true }).waitFor();
        expect(page.url()).toContain('/develop-c/settings');
        await context.route('**/spcb/api/me', (route) =>
          route.fulfill({
            json: {
              token: owner,
              member: { mbId: 'coexist-owner', mbNick: '시험 고객', level: 2, isAdmin: false },
            },
          }),
        );
        await page.goto(`${base}/develop/c/me`);
        await page
          .getByText('coexist-c', { exact: true })
          .waitFor({ timeout: 10000 })
          .catch(async () => {
            await page.screenshot({
              path: resolve(folder, 'customer-c-failure.png'),
              fullPage: true,
            });
            throw new Error(
              JSON.stringify({
                errors,
                diagnostics,
                url: page.url(),
                text: await page.locator('body').innerText(),
              }),
            );
          });
        expect(await page.getByText('coexist-g', { exact: true }).count()).toBe(0);
        await page.goto(`${base}/develop/c/requests/${String(c.id)}`);
        await page.locator(':text("DR-01"):visible').first().waitFor();
        await page.screenshot({ path: resolve(folder, 'customer-c.png'), fullPage: true });
        await page.getByRole('radio', { name: '승인합니다', exact: true }).check();
        await page.getByRole('checkbox', { name: /문서 내용을 확인/ }).check();
        await page.getByRole('button', { name: '회신 보내기', exact: true }).click();
        await expect
          .poll(
            async () =>
              (
                await prisma.spDevelopDocument.findUniqueOrThrow({
                  where: { id: BigInt(doc.documentId) },
                })
              ).status,
          )
          .toBe('approved');
        expect(
          (await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: g.id } })).status,
        ).toBe('accepted');
        await page.goto(
          `${base}/develop/c/requests/${String(c.id)}/documents/${String(doc.documentId)}/print`,
        );
        await page.locator(':text("DR-01"):visible').first().waitFor();
        await page.goto(`${base}/develop/me`);
        await page.getByText('coexist-g', { exact: true }).waitFor();
        expect(await page.getByText('coexist-c', { exact: true }).count()).toBe(0);
        await page.goto(`${base}/develop/c/request`);
        await page.getByText('개발(C)', { exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${base}/develop/c/requests/${String(c.id)}`);
        await page.locator(':text("DR-01"):visible').first().waitFor();
        expect(
          await page.evaluate<boolean>(
            'document.documentElement.scrollWidth > window.innerWidth + 1',
          ),
        ).toBe(false);
        await page.screenshot({ path: resolve(folder, 'customer-c-mobile.png'), fullPage: true });
        await context.route('**/spcb/api/me', (route) =>
          route.fulfill({
            json: {
              token: admin,
              member: { mbId: 'coexist-admin', mbNick: '시험 관리자', level: 10, isAdmin: true },
            },
          }),
        );
        await page.goto(`${base}/app/admin/develop-c`);
        await page.getByText('coexist-c', { exact: true }).first().waitFor();
        expect(
          await page.evaluate<boolean>(
            'document.documentElement.scrollWidth > window.innerWidth + 1',
          ),
        ).toBe(false);
        await page.getByRole('button', { name: '관리자 메뉴 열기', exact: true }).click();
        await page
          .locator('aside > nav')
          .getByRole('link', { name: '문의·A/S', exact: true })
          .waitFor();
        await page.screenshot({ path: resolve(folder, 'admin-c-mobile.png'), fullPage: true });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    90000,
  );
});
