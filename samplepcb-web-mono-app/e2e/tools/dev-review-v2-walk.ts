// AI 사전 검토서 v2 실브라우저 완주(관찰용, 자동 판정 없음) — 위저드 2스텝 → 실 LLM 생성 →
// 등록 → 상세 → 관리자 드로어를 playwright-core 로 걷고 스크린샷을 e2e/output/dev-review-v2/ 에 남긴다.
// 로그인은 helpers/browser 의 /spcb/api/me 스텁(로컬 서명 JWT). 실행(e2e 디렉터리):
//   E2E_BASE_URL=http://127.0.0.1:5300 pnpm exec tsx tools/dev-review-v2-walk.ts
// 환경: WALK_ADMIN_URL(기본 http://127.0.0.1:5173) · WALK_MB_ID(기본 e2e-customer) · WALK_KEEP=1(정리 생략)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { closeBrowser, newSession } from '../helpers/browser';
import { disconnectPrisma, getPrisma } from '../helpers/db';
import { outputDir } from '../helpers/env';

const ADMIN_URL = process.env.WALK_ADMIN_URL ?? 'http://127.0.0.1:5173';
const MB_ID = process.env.WALK_MB_ID ?? 'e2e-customer';
const KEEP = process.env.WALK_KEEP === '1';
const dir = join(outputDir, 'dev-review-v2');
mkdirSync(dir, { recursive: true });

const TITLE = `반려견 자동 급식기 제어 보드 (v2 walk ${new Date().toISOString().slice(11, 19)})`;
const DESCRIPTION =
  '집을 비울 때 정해진 시간에 사료를 주는 자동 급식기를 만들고 싶습니다. 스마트폰으로 급식 시간을 설정하고 급식 기록을 확인하고 싶어요. 집 Wi-Fi 에 연결해서 쓰면 좋겠습니다. 아직 아이디어 단계라 회로나 부품은 정해진 게 없습니다. 사료가 나오는 부분은 기구 업체가 따로 만들 예정입니다.';

const shot = async (page: Page, name: string, fullPage = true): Promise<void> => {
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path, fullPage });
  console.log(`  📷 ${path}`);
};

async function main(): Promise<void> {
  const startedAt = new Date();
  const customer = await newSession({ mbId: MB_ID, mbNick: 'v2워크', level: 2, isAdmin: false });
  const { page } = customer;
  let projectId: number | null = null;
  try {
    // ── 1단계: 의뢰 내용 ──
    await page.goto('/market/request');
    await page.getByText('어떤 개발이 필요한가요?').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: '잘 모르겠어요 — 전부 맡길게요' }).click();
    await page.getByPlaceholder('예: 화분 물 주기 알림 장치').fill(TITLE);
    await page.locator('textarea').first().fill(DESCRIPTION);
    await page.getByRole('button', { name: '아이디어만 있어요', exact: true }).click();
    await page.getByRole('button', { name: '시제품 1~10개', exact: true }).click();
    await page.getByPlaceholder('예: 먼저 3개, 이후 월 200개').fill('먼저 3개');
    await page.getByRole('button', { name: '스마트폰 앱', exact: true }).click();
    await page.getByRole('button', { name: '3개월 안', exact: true }).click();
    await shot(page, '01-step1-describe');

    // ── 2단계: 검토서 생성(실 LLM) → 미리보기 ──
    await page.getByRole('button', { name: '다음' }).click();
    await page.getByText('검토서 작성 중', { exact: false }).or(page.getByText('첨부 확인 중')).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    await shot(page, '02-step2-generating', false);
    const t0 = Date.now();
    await page.getByText('이 검토서를 의뢰에 포함').waitFor({ timeout: 360_000 });
    console.log(`  검토서 생성 ${String(Math.round((Date.now() - t0) / 1000))}s`);
    await page.waitForTimeout(800);
    await shot(page, '03-step2-review');
    const diagram = page.locator('[aria-label="제안 시스템 구성도 크게 보기"]').first();
    await diagram.screenshot({ path: join(dir, '04-diagram-preview.png') });
    await diagram.click();
    await page.getByRole('button', { name: /닫기/ }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '05-diagram-modal', false);
    await page.keyboard.press('Escape');

    // ── 등록 ──
    await page.getByRole('button', { name: '의뢰 등록' }).click();
    await page.getByText('의뢰가 등록되었습니다').waitFor({ timeout: 30_000 });
    const href = await page.getByRole('link', { name: '프로젝트 확인' }).getAttribute('href');
    const m = /projects\/(\d+)/.exec(href ?? '');
    projectId = m?.[1] === undefined ? null : Number(m[1]);
    console.log(`  등록된 프로젝트 #${String(projectId)}`);
    await shot(page, '06-registered', false);

    // ── 상세 ──
    if (projectId !== null) {
      await page.goto(`/market/projects/${String(projectId)}`);
      await page.getByText('AI 사전 검토서').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await shot(page, '07-detail');
    }
    console.log(`  pageErrors: ${String(customer.pageErrors.length)}${customer.pageErrors.length > 0 ? ` — ${customer.pageErrors.join(' | ')}` : ''}`);
  } finally {
    await customer.close();
  }

  // ── 관리자 드로어 ──
  if (projectId !== null) {
    const admin = await newSession({ mbId: MB_ID, mbNick: '관리자', level: 10, isAdmin: true });
    try {
      await admin.page.goto(`${ADMIN_URL}/app/admin/market/projects`);
      await admin.page.getByText(TITLE.slice(0, 20), { exact: false }).first().waitFor({ timeout: 30_000 });
      await admin.page.getByText(TITLE.slice(0, 20), { exact: false }).first().click();
      await admin.page.getByText('AI 사전 검토서').first().waitFor({ timeout: 30_000 });
      await admin.page.waitForTimeout(1000);
      await shot(admin.page, '08-admin-drawer', false);
      const drawer = admin.page.locator('.fixed.inset-0 > div').last();
      await drawer.screenshot({ path: join(dir, '09-admin-drawer-full.png') }).catch(() => undefined);
      console.log(`  admin pageErrors: ${String(admin.pageErrors.length)}`);
    } finally {
      await admin.close();
    }
  }

  await closeBrowser();

  // ── 정리 — 이 걸음이 만든 의뢰·AI 잡만 지운다 ──
  if (!KEEP && projectId !== null) {
    const prisma = getPrisma();
    await prisma.spMarketProject.delete({ where: { id: BigInt(projectId) } });
    const jobs = await prisma.spAiJob.deleteMany({ where: { mbId: MB_ID, startedAt: { gte: startedAt } } });
    console.log(`  정리: 프로젝트 #${String(projectId)} 삭제, AI 잡 ${String(jobs.count)}건 삭제`);
    await disconnectPrisma();
  } else if (projectId !== null) {
    console.log(`  유지: 프로젝트 #${String(projectId)} (WALK_KEEP=1)`);
    await disconnectPrisma();
  }
}

main().catch(async (err: unknown) => {
  console.error(err);
  await closeBrowser().catch(() => undefined);
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
