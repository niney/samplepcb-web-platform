// AI 사전 검토서 v3 실브라우저 완주(관찰용, 자동 판정 없음) — 위저드 3스텝(의뢰 내용 → 몇 가지만 더 → 검토·등록) → 실 LLM 생성 →
// 등록 → 상세 → 관리자 드로어를 playwright-core 로 걷고 스크린샷을 e2e/output/dev-review-v2/ 에 남긴다.
// 로그인은 helpers/browser 의 /spcb/api/me 스텁(로컬 서명 JWT). 실행(e2e 디렉터리):
//   E2E_BASE_URL=http://127.0.0.1:5300 pnpm exec tsx tools/dev-review-v2-walk.ts
// 환경: WALK_ADMIN_URL(기본 http://127.0.0.1:5173) · WALK_MB_ID(기본 e2e-customer) · WALK_KEEP=1(정리 생략)
//       WALK_SCENARIO=feeder(기본, 아이디어만·첨부 없음) | bus-led-mismatch(픽스처 08 — docx 첨부 + 답변↔자료 어긋남, §12.10 R9)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { closeBrowser, newSession } from '../helpers/browser';
import { disconnectPrisma, getPrisma } from '../helpers/db';
import { readFileSync } from 'node:fs';
import { monoRoot, outputDir } from '../helpers/env';

const ADMIN_URL = process.env.WALK_ADMIN_URL ?? 'http://127.0.0.1:5173';
const MB_ID = process.env.WALK_MB_ID ?? 'e2e-customer';
const KEEP = process.env.WALK_KEEP === '1';
const SCENARIO = process.env.WALK_SCENARIO === 'bus-led-mismatch' ? 'bus-led-mismatch' : 'feeder';
const dir = join(outputDir, 'dev-review-v2');
mkdirSync(dir, { recursive: true });

const STAMP = new Date().toISOString().slice(11, 19);
const FIXTURE_DIR = join(monoRoot, 'apps', 'api', 'src', 'scripts', 'fixtures', 'dev-review');
// answers = [현재 상태, 수량, 함께 쓰는 것, 완료 시점, 목표 단계, 인도 범위] — 뒤 3개는 공통 조건(필수).
interface Scenario { title: string; description: string; areas: readonly string[] | 'all'; answers: readonly string[]; quantityNote: string; attachments: readonly string[] }
const SCENARIOS: Record<typeof SCENARIO, Scenario> = {
  feeder: {
    title: `반려견 자동 급식기 제어 보드 (v2 walk ${STAMP})`,
    description:
      '집을 비울 때 정해진 시간에 사료를 주는 자동 급식기를 만들고 싶습니다. 스마트폰으로 급식 시간을 설정하고 급식 기록을 확인하고 싶어요. 집 Wi-Fi 에 연결해서 쓰면 좋겠습니다. 아직 아이디어 단계라 회로나 부품은 정해진 게 없습니다. 사료가 나오는 부분은 기구 업체가 따로 만들 예정입니다.',
    areas: 'all',
    answers: ['아이디어만 있어요', '시제품 1~10개', '스마트폰 앱', '2~3개월', '동작하는 시제품', '전체 원본과 소스'],
    quantityNote: '먼저 3개',
    attachments: [],
  },
  'bus-led-mismatch': (() => {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, '08-bus-led-mismatch.json'), 'utf8')) as { title: string; description: string; attachments: string[] };
    return {
      title: `${fx.title} (v2 walk ${STAMP})`,
      description: fx.description,
      areas: ['회로 개발'],
      answers: ['아이디어만 있어요', '시제품 1~10개', '없어요(장치 단독)', '1개월 안', '동작하는 시제품', '제작·유지보수 가능한 범위'],
      quantityNote: '4대',
      attachments: fx.attachments.map((f) => join(FIXTURE_DIR, f)),
    };
  })(),
};
const SC = SCENARIOS[SCENARIO];
const TITLE = SC.title;
const DESCRIPTION = SC.description;

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
    if (SC.areas === 'all') await page.getByRole('button', { name: '잘 모르겠어요 — 전부 맡길게요' }).click();
    else {
      for (const a of SC.areas) {
        const card = page.locator('button', { hasText: a }).first();
        await card.click();
        // 첫 클릭이 하이드레이션 전에 떨어지면 안 잡힌다 — 선택 클래스로 확인하고 한 번 더.
        if (!((await card.getAttribute('class')) ?? '').includes('bg-ink-900')) await card.click();
      }
    }
    await page.getByPlaceholder('예: 화분 물 주기 알림 장치').fill(TITLE);
    await page.locator('textarea').first().fill(DESCRIPTION);
    if (SC.attachments.length > 0) {
      await page.locator('input[type="file"]').first().setInputFiles([...SC.attachments]);
      await page.waitForTimeout(500);
    }
    await shot(page, '01-step1-describe');

    // ── 2단계: 프로젝트 공통 조건(필수 6) + 공통 질문 3 + 분야별 카드 ──
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByText('프로젝트 공통 조건').waitFor({ timeout: 30_000 });
    const [stage, quantity, external, timeline, targetStage, deliverable] = SC.answers;
    await page.getByLabel(/예상 개발 예산/).selectOption('r500_2000');
    await page.getByRole('button', { name: timeline ?? '', exact: true }).click();
    await page.getByRole('button', { name: targetStage ?? '', exact: true }).click();
    await page.getByRole('button', { name: deliverable ?? '', exact: true }).click();
    console.log(`  공통 조건 ${(await page.locator('text=/\\d+ \\/ \\d+ 완료/').first().textContent())?.trim()}`);
    await page.getByRole('button', { name: stage ?? '', exact: true }).click();
    await page.getByRole('button', { name: quantity ?? '', exact: true }).click();
    await page.getByPlaceholder('예: 먼저 3개, 이후 월 200개').fill(SC.quantityNote);
    await page.getByRole('button', { name: external ?? '', exact: true }).click();
    // 분야 맞춤 질문 — 첫 카드의 첫 문항에서 '전문가 추천' 하나만 찍어 탈출구 동선을 확인한다.
    const expertPick = page.getByRole('button', { name: '전문가 추천', exact: true }).first();
    if (await expertPick.isVisible().catch(() => false)) await expertPick.click();
    await shot(page, '01b-step2-details');

    // ── 3단계: 검토서 생성(실 LLM) → 미리보기 ──
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByText('검토서 작성 중', { exact: false }).or(page.getByText('첨부 확인 중')).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    await shot(page, '02-step2-generating', false);
    const t0 = Date.now();
    await page.getByText('이 검토서를 의뢰에 포함').waitFor({ timeout: 360_000 });
    console.log(`  검토서 생성 ${String(Math.round((Date.now() - t0) / 1000))}s`);
    await page.waitForTimeout(800);
    await shot(page, '03-step2-review');
    // ── 등록 ──
    await page.getByRole('button', { name: '의뢰 등록' }).click();
    await page.getByText('의뢰가 등록되었습니다').waitFor({ timeout: 30_000 });
    const href = await page.getByRole('link', { name: '프로젝트 확인' }).getAttribute('href');
    const m = /projects\/(\d+)/.exec(href ?? '');
    projectId = m?.[1] === undefined ? null : Number(m[1]);
    console.log(`  등록된 프로젝트 #${String(projectId)}`);
    await shot(page, '06-registered', false);
    // 플로팅 트레이(§13.7) — 등록 뒤 화면 어디서든 구성도 진행을 알린다. 3단계에서 병렬 시작됐으면 알약이 떠 있다.
    const tray = page.getByRole('button', { name: /시스템 구성도/ }).first();
    const trayVisible = await tray.isVisible().catch(() => false);
    console.log(`  트레이 ${trayVisible ? '표시' : '없음(구성도 생략·비활성)'}`);
    if (trayVisible) {
      await tray.click();
      await page.waitForTimeout(400);
      await shot(page, '06b-tray-open', false);
    }

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
