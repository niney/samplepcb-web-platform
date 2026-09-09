import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkState } from '../../packages/api-contract/src/schemas/develop-workflow';
import { prisma } from '../../apps/api/src/lib/prisma';

// preview-develop-workflow.ts의 로컬 데모 인증만 사용한다. 실제 PHP 세션이나 고객 데이터에 연결하지 않는다.
describe.skipIf(process.env.WORKFLOW_BROWSER !== '1')('수행관리 관리자·고객 브라우저 여정', () => {
  let browser: Browser; let admin: Page; let customer: Page; let id: bigint | null = null;
  const pageErrors: string[] = []; const output = resolve('../../.tmp/develop-workflow');
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    expect(url.hostname).toBe('127.0.0.1'); expect(url.port).toBe('3340'); expect(url.pathname).toBe('/samplepcb_develop_workflow_proto');
    await mkdir(output, { recursive: true });
    const r = await prisma.spDevelopRequest.create({ data: { mbId: 'workflow-preview-client', title: '브라우저 수행관리 검증', serviceAreas: ['pcb'], description: '격리된 브라우저 시험용 의뢰', contactName: '시연 고객', contactPhone: '010-0000-0000', contactEmail: 'browser@example.invalid', budgetRange: 'under1000', status: 'accepted', aiConsent: false } }); id = r.id;
    await prisma.spDevelopQuote.create({ data: { requestId: r.id, version: 1, kind: 'initial', status: 'accepted', title: '브라우저 검증 견적', terms: '격리 시험', validUntil: '2099-12-31', createdBy: 'workflow-preview-admin', acceptedAt: new Date(), acceptedName: '시연 고객', totalAmount: 100, supplyAmount: 100,
      items: { create: [{ seq: 1, title: '설계비', amount: 100 }] }, milestones: { create: [{ requestId: r.id, seq: 1, title: '전액', amount: 100, trigger: 'on_accept', status: 'paid', paidAt: new Date(), paymentKey: crypto.randomUUID() }] },
    } });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); customer = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    for (const page of [admin, customer]) page.on('pageerror', (error) => { pageErrors.push(error.message); });
  });
  afterAll(async () => {
    await browser?.close();
    if (id !== null) {
      const files = await prisma.spFile.findMany({ where: { refType: 'sp_develop_workflow', refId: id } });
      for (const f of files) if (/^[a-f0-9]{32}$/.test(f.pathToken)) await unlink(resolve(output, 'files', f.pathToken)).catch(() => undefined);
      await prisma.spFile.deleteMany({ where: { refType: 'sp_develop_workflow', refId: id } });
      await prisma.spDevelopWorkflowAudit.deleteMany({ where: { requestId: id } });
      await prisma.spDevelopWorkflow.deleteMany({ where: { requestId: id } });
      await prisma.spMailLog.deleteMany({ where: { refType: 'develop_request', refId: String(id) } });
      await prisma.spDevelopRequest.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });
  async function saved(page: Page): Promise<void> { await page.locator('.develop-workflow .feedback.success').waitFor(); }
  test('착수 → 문서·첨부 공개 → 승인 제한 → 고객 승인 → 진행·새 버전·모바일·기능 끄기', async () => {
    if (id === null) throw new Error('fixture missing');
    await admin.goto(`http://127.0.0.1:5183/app/admin/develop/requests/${String(id)}?tab=workflow`);
    const panel = admin.locator('.develop-workflow');
    await panel.getByRole('button', { name: '수행관리 켜기', exact: true }).click(); await saved(admin);
    await panel.getByLabel('필수자료 준비 완료').check();
    await panel.getByRole('button', { name: '준비 확인 후 개발 착수', exact: true }).click();
    await expect.poll(async () => (await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: id ?? 0n } })).status).toBe('in_progress');
    await admin.getByRole('tab', { name: '문서·승인', exact: true }).click();
    await panel.getByLabel('새 문서 유형').selectOption('review');
    await panel.getByRole('button', { name: '문서 만들기', exact: true }).click();
    await panel.getByLabel('문서 제목', { exact: true }).fill('브라우저 검토 문서');
    await panel.getByLabel('주요 설계 결정', { exact: true }).fill('회로 Rev A 검토 요청');
    await panel.getByLabel('문서 첨부자료 업로드').setInputFiles({ name: 'review.txt', mimeType: 'text/plain', buffer: Buffer.from('Review A') });
    await panel.getByText('파일을 첨부했습니다.', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '저장하고 고객 공개', exact: true }).click();
    await panel.getByRole('button', { name: '공개 확정', exact: true }).click();
    await panel.getByRole('button', { name: '공개 문서 이메일 작성', exact: true }).waitFor();
    await admin.getByRole('tab', { name: '수행·일정', exact: true }).click();
    await panel.getByRole('textbox', { name: '작업 1 이름', exact: true }).fill('승인 후 PCB 작업');
    if (!await panel.locator('.task-details').isVisible()) await panel.locator('.task-table').getByRole('button', { name: '선행·승인 0건', exact: true }).first().click();
    await panel.locator('.task-details').getByRole('checkbox', { name: /브라우저 검토 문서/ }).check();
    await panel.getByRole('spinbutton', { name: '승인 후 PCB 작업 진행률', exact: true }).fill('20');
    await panel.getByRole('spinbutton', { name: '승인 후 PCB 작업 진행률', exact: true }).press('Tab');
    await panel.getByRole('button', { name: '일정 저장', exact: true }).click();
    await panel.locator('.feedback.error').filter({ hasText: '고객 승인' }).waitFor();

    await customer.goto(`http://127.0.0.1:5182/develop/requests/${String(id)}`);
    const cp = customer.locator('.develop-workflow'); await cp.getByRole('button', { name: /문서·승인/ }).click();
    expect(await cp.innerText()).toContain('회로 Rev A 검토 요청');
    const downloaded = customer.waitForEvent('download');
    await cp.getByRole('button', { name: /review.txt/ }).click(); expect((await downloaded).suggestedFilename()).toBe('review.txt');
    await cp.getByLabel('고객 의견', { exact: true }).fill('확인했습니다');
    await cp.getByRole('button', { name: '승인 기록', exact: true }).click(); await cp.getByText('문서에 대한 응답을 기록했습니다.', { exact: true }).waitFor();
    await cp.screenshot({ path: resolve(output, 'customer-approved.png') });

    await panel.getByRole('button', { name: '일정 저장', exact: true }).click();
    await panel.locator('.feedback.error').filter({ hasText: '다른 변경' }).waitFor();
    expect(await panel.getByRole('spinbutton', { name: '승인 후 PCB 작업 진행률', exact: true }).inputValue()).toBe('20');
    await panel.getByRole('button', { name: '새로 불러오기', exact: true }).click(); await panel.getByRole('button', { name: '불러오기', exact: true }).click();
    await panel.getByRole('textbox', { name: '작업 1 이름', exact: true }).fill('승인 후 PCB 작업');
    if (!await panel.locator('.task-details').isVisible()) await panel.locator('.task-table').getByRole('button', { name: '선행·승인 0건', exact: true }).first().click();
    await panel.locator('.task-details').getByRole('checkbox', { name: /브라우저 검토 문서/ }).check();
    await panel.getByRole('spinbutton', { name: '승인 후 PCB 작업 진행률', exact: true }).fill('20'); await panel.getByRole('spinbutton', { name: '승인 후 PCB 작업 진행률', exact: true }).press('Tab');
    await panel.getByRole('button', { name: '저장하고 현황 공개', exact: true }).click(); await saved(admin);
    await expect.poll(async () => WorkState.parse((await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: id ?? 0n } })).state).publishedPlan?.tasks[0]?.progress).toBe(20);

    await admin.getByRole('tab', { name: '문서·승인', exact: true }).click(); await panel.getByRole('button', { name: '작업본', exact: true }).click();
    await panel.getByLabel('주요 설계 결정', { exact: true }).fill('회로 Rev B 검토 요청');
    await panel.getByRole('button', { name: '작업본 저장', exact: true }).click(); await saved(admin);
    await cp.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect.poll(() => cp.innerText()).toContain('회로 Rev A 검토 요청'); expect(await cp.innerText()).not.toContain('회로 Rev B 검토 요청');
    await panel.getByRole('button', { name: '저장하고 고객 공개', exact: true }).click(); await panel.getByRole('button', { name: '공개 확정', exact: true }).click();
    await panel.getByRole('button', { name: 'v2 · 공개', exact: true }).waitFor();
    await cp.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect.poll(() => cp.innerText()).toContain('회로 Rev B 검토 요청');
    await customer.setViewportSize({ width: 390, height: 844 }); await cp.screenshot({ path: resolve(output, 'customer-mobile.png') });
    const overflow = await customer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); expect(overflow).toBe(false);
    await admin.getByRole('tab', { name: '수행관리', exact: true }).click();
    await panel.getByRole('button', { name: '이 의뢰의 수행관리 끄기', exact: true }).click(); await panel.getByRole('button', { name: '보관하고 끄기', exact: true }).click(); await saved(admin);
    await cp.getByRole('button', { name: '새로 불러오기', exact: true }).click(); await cp.waitFor({ state: 'hidden' });
    const row = await prisma.spDevelopWorkflow.findUniqueOrThrow({ where: { requestId: id } }); expect(row.enabled).toBe(false); expect(WorkState.parse(row.state).documents[0]?.versions).toHaveLength(2);
    // 이전 API와 새 프런트가 잠시 함께 떠도 수행관리 404를 숨김으로 처리한다.
    await customer.route('**/workflow', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not Found"}' }));
    await customer.reload(); await customer.locator('#content').waitFor();
    await cp.waitFor({ state: 'hidden' });
    expect(pageErrors).toEqual([]);
  }, 120000);
});
