// Smart BOM 완주 여정 13호 — 고객 내역 검색·보호·삭제 복구.
//
// 12호가 고객 Case 소유권과 직접 URL을 지켰다면 13호는 고객이 그 Case들을 실제로
// 정리하는 목록 화면을 검증한다. 별도 가상 회원에게 상태 6종·26건을 만들고 검색,
// 필터, 페이지 이동, 선택 초기화, 목록 503 복구, 단건/선택/전체 삭제, 삭제 직전 상태
// 경합, 모바일 가로 탐색을 실 UI/API/DB로 교차 확인한다. 제품 삭제로 사라진 파일
// 참조와 보호 상태로 남은 파일 참조도 각각 원장에 맞아야 한다.
// 실행: pnpm -F e2e journey:bom:13
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page, Route } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newSession,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const OWNER_ID = `e2e-bom-history-${RUN_KEY}`;
const SEARCH_KEY = `BOM13-${RUN_KEY}`;
const FILE_REF_TYPE = 'sp_bom_quote';

type QuoteStatus = 'draft' | 'requested' | 'reviewing' | 'answered' | 'closed' | 'canceled';

interface SeedPlan {
  key: string;
  label: string;
  status: QuoteStatus;
}

interface SeededQuote extends SeedPlan {
  id: string;
  fileName: string;
  pathToken: string | null;
}

const CORE_PLANS: SeedPlan[] = [
  { key: 'singleDraft', label: '01 단건 실패 복구', status: 'draft' },
  { key: 'selectedDraft', label: '02 선택 작성 중', status: 'draft' },
  { key: 'protectedCanceled', label: '03 취소 보호', status: 'canceled' },
  { key: 'staleDraft', label: '04 삭제 직전 상태 변경', status: 'draft' },
  { key: 'globalDraft', label: '05 필터 밖 전체 삭제', status: 'draft' },
  { key: 'requested', label: '06 견적 요청 보호', status: 'requested' },
  { key: 'reviewing', label: '07 검토 중 보호', status: 'reviewing' },
  { key: 'answered', label: '08 답변 완료 보호', status: 'answered' },
  { key: 'closed', label: '09 종료 보호', status: 'closed' },
];

function allPlans(): SeedPlan[] {
  const requestedExtras = Array.from({ length: 17 }, (_, index): SeedPlan => {
    const number = String(index + 10).padStart(2, '0');
    return {
      key: `requestedExtra${number}`,
      label: `${number} 페이지 보호 표본`,
      status: 'requested',
    };
  });
  return [...CORE_PLANS, ...requestedExtras];
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(
      `${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

// 고객이 지울 수 있는 것은 작성 중뿐이다(2026-10-05) — 취소 견적은 보존 기간 뒤 자동 정리가 지운다.
function isDeletable(status: QuoteStatus): boolean {
  return status === 'draft';
}

/** 원본 파일 참조를 심는 무대 — 지워지는 쪽(작성 중)과 남는 쪽(취소)을 모두 원장으로 대조한다. */
function hasSeedFile(status: QuoteStatus): boolean {
  return isDeletable(status) || status === 'canceled';
}

async function seedQuotes(): Promise<Map<string, SeededQuote>> {
  const prisma = getPrisma();
  const plans = allPlans();
  const baseTime = Date.now();
  const seeded = new Map<string, SeededQuote>();

  for (const [index, plan] of plans.entries()) {
    const fileName = `${SEARCH_KEY}-${plan.label}.xlsx`;
    const requestedAt = plan.status === 'draft' ? null : new Date(baseTime - index * 60_000);
    // 취소 견적은 취소 시각과 고객에게 고지한 삭제 예정 시각(30일 뒤)을 가진다.
    const canceledAt = plan.status === 'canceled' ? new Date(baseTime - index * 60_000) : null;
    const purgeAfter = canceledAt === null ? null : new Date(canceledAt.getTime() + 30 * 86_400_000);
    const answeredAt =
      plan.status === 'answered' || plan.status === 'closed'
        ? new Date(baseTime - index * 60_000)
        : null;
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: OWNER_ID,
        title: `[BOM 여정 13호] ${plan.label} ${RUN_KEY}`,
        fileName,
        sourceKind: 'upload',
        status: plan.status,
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 2,
        spareQty: 1,
        itemsTotal: (index + 1) * 1_000,
        shippingFee: 3_000,
        managementFee: 500,
        finalTotal: (index + 1) * 1_000 + 3_500,
        requestedAt,
        answeredAt,
        canceledAt,
        purgeAfter,
        createdAt: new Date(baseTime - index * 60_000),
        updatedAt: new Date(baseTime - index * 60_000),
        items: {
          create: {
            rowIdx: 0,
            included: true,
            mpn: `E2E-HISTORY-${String(index + 1).padStart(2, '0')}`,
            manufacturerName: 'E2E Components',
            description: `13호 ${plan.label} 목록 표본`,
            bomQty: index + 1,
            orderQty: (index + 1) * 2 + 1,
            matchStatus: index % 2 === 0 ? 'manual' : 'none',
            selectionSource: index % 2 === 0 ? 'admin' : 'none',
            lineTotalKrw: (index + 1) * 1_000,
            sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          },
        },
      },
      select: { id: true },
    });

    const pathToken = hasSeedFile(plan.status) ? `e2e/bom-history/${RUN_KEY}/${plan.key}` : null;
    if (pathToken !== null) {
      await prisma.spFile.create({
        data: {
          refType: FILE_REF_TYPE,
          refId: quote.id,
          uploadFileName: `${plan.key}-${RUN_KEY}.xlsx`,
          originFileName: fileName,
          pathToken,
          size: 128n,
          writeDate: new Date(),
          fileType: 'bom',
          uploadedBy: 'E2E',
        },
      });
    }
    seeded.set(plan.key, { ...plan, id: String(quote.id), fileName, pathToken });
  }

  return seeded;
}

function quote(seeded: Map<string, SeededQuote>, key: string): SeededQuote {
  const found = seeded.get(key);
  if (found === undefined) throw new Error(`13호 fixture ${key}가 없습니다`);
  return found;
}

function quoteRow(page: Page, item: SeededQuote): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: item.fileName, exact: true }) });
}

async function waitForBodyText(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (expected: string) => document.body.innerText.includes(expected),
    text,
    { timeout: 30_000 },
  );
}

async function fileCount(item: SeededQuote): Promise<number> {
  return getPrisma().spFile.count({
    where: { refType: FILE_REF_TYPE, refId: BigInt(item.id) },
  });
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 13호 — 고객 내역 검색·보호·삭제 복구', () => {
  const rp = createJourneyReport(
    'findings-bom-history-management',
    'BOM 여정 13호 고객 내역 검색·보호·삭제 복구 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: E2eSession;
  let seeded = new Map<string, SeededQuote>();

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    seeded = await seedQuotes();
    customer = await newSession({ mbId: OWNER_ID, mbNick: 'BOM 내역 E2E 고객' });
    rp.watchHttp(customer, '내역 고객');
    ledger.push(
      `sp_bom_quote ${seeded.size}건(${OWNER_ID}, 종료 시 잔여 fixture 정리)`,
      `sp_file 5건(작성 중 4건 삭제 원장 + 취소 1건 보존 원장, 남은 것은 종료 시 정리)`,
    );
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    const prisma = getPrisma();
    const remaining: { id: bigint }[] = await prisma.spBomQuote.findMany({
      where: { mbId: OWNER_ID },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: { pathToken: { startsWith: `e2e/bom-history/${RUN_KEY}/` } },
    });
    const remainingIds = remaining.map((item) => item.id);
    if (remainingIds.length > 0) {
      await prisma.spBomQuote.deleteMany({ where: { id: { in: remainingIds } } });
    }
    expect(await prisma.spBomQuote.count({ where: { mbId: OWNER_ID } }), '13호 견적 잔재').toBe(0);
    expect(
      await prisma.spFile.count({
        where: { pathToken: { startsWith: `e2e/bom-history/${RUN_KEY}/` } },
      }),
      '13호 파일 참조 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('M01. 26건 검색·상태 필터·페이지 이동 → 선택 범위가 현재 페이지에만 유지', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'BOM 분석 내역', exact: true }).waitFor();
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await waitForBodyText(page, '총 26건');

    const first = quote(seeded, 'singleDraft');
    await quoteRow(page, first)
      .getByRole('checkbox', { name: `${first.fileName} 선택`, exact: true })
      .check();
    await page.getByRole('button', { name: '선택 삭제 (1)', exact: true }).waitFor();
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    expect(await page.getByRole('button', { name: '선택 삭제', exact: true }).isDisabled()).toBe(
      true,
    );
    expect(
      await page.getByRole('button', { name: '2', exact: true }).getAttribute('aria-current'),
    ).toBe('page');

    await page.getByRole('button', { name: '1', exact: true }).click();
    await page
      .getByRole('combobox', { name: '견적 상태 필터', exact: true })
      .selectOption('requested');
    await waitForBodyText(page, '총 18건');
    expect(
      await page
        .getByRole('button', {
          name: '작성 중 전체 삭제 (4)',
          exact: true,
        })
        .isEnabled(),
    ).toBe(true);
    await page.getByRole('combobox', { name: '견적 상태 필터', exact: true }).selectOption('all');
    await waitForBodyText(page, '총 26건');
    F('M01', 'obs', '검색·필터·2페이지 결과가 일치하고 페이지/필터 전환 때 이전 선택이 초기화됨');
  }, 120_000);

  test('M02. 목록 503 → 빈 내역으로 오인하지 않고 같은 화면에서 다시 불러오기', async () => {
    const page = customer.page;
    let failed = false;
    const pattern = '**/api/bom/quotes?**';
    const handler = async (route: Route): Promise<void> => {
      const requestUrl = new URL(route.request().url());
      if (
        !failed &&
        route.request().method() === 'GET' &&
        requestUrl.searchParams.get('pageSize') === '20'
      ) {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            result: false,
            error: 'BOM_LIST_TEMPORARILY_UNAVAILABLE',
            message: 'BOM 내역 서버가 잠시 응답하지 않습니다.',
          }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(pattern, handler);
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });

    const alert = page.getByRole('alert', { name: 'BOM 내역을 불러오지 못했습니다' });
    await alert.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await page.getByText('조건에 맞는 BOM 내역이 없습니다.', { exact: true }).count()).toBe(
      0,
    );
    expect(await alert.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await alert.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await quoteRow(page, quote(seeded, 'singleDraft')).waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    await page.unroute(pattern, handler);
    expect(failed).toBe(true);
    F('M02', 'bug', '목록 503를 빈 검색 결과와 구분하고 포커스된 오류 카드의 재시도로 회복함');
  }, 120_000);

  test('M03. 단건 삭제 → 키보드 모달·503 인라인 오류·재시도·파일 참조 정리', async () => {
    const page = customer.page;
    const target = quote(seeded, 'singleDraft');
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await quoteRow(page, target).waitFor({ state: 'visible', timeout: 30_000 });
    const trigger = quoteRow(page, target).getByRole('button', { name: '삭제', exact: true });
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    await trigger.click();

    let dialog = page.getByRole('alertdialog', { name: `${target.fileName} 삭제`, exact: true });
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    const confirm = dialog.getByRole('button', { name: '삭제 확인', exact: true });
    await confirm.focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      '삭제 확인 닫기',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);
    expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);

    let failed = false;
    const pattern = '**/api/bom/quotes/delete';
    const handler = async (route: Route): Promise<void> => {
      if (!failed && route.request().method() === 'POST') {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            result: false,
            error: 'BOM_DELETE_TEMPORARILY_UNAVAILABLE',
            message: '삭제 서버가 잠시 응답하지 않습니다.',
          }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(pattern, handler);
    await trigger.click();
    dialog = page.getByRole('alertdialog', { name: `${target.fileName} 삭제`, exact: true });
    await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();
    const inlineError = dialog.getByRole('alert');
    await inlineError.getByText('삭제 서버가 잠시 응답하지 않습니다.', { exact: true }).waitFor();
    expect(await dialog.isVisible()).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    expect(
      await getPrisma().spBomQuote.findUnique({ where: { id: BigInt(target.id) } }),
    ).not.toBeNull();
    expect(await fileCount(target)).toBe(1);

    await dialog.getByRole('button', { name: '다시 삭제 시도', exact: true }).click();
    const result = page.getByRole('status');
    await result.getByText('1건을 삭제했습니다.', { exact: true }).waitFor({ timeout: 30_000 });
    expect(await result.evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);
    await page.unroute(pattern, handler);
    expect(
      await getPrisma().spBomQuote.findUnique({ where: { id: BigInt(target.id) } }),
    ).toBeNull();
    expect(await fileCount(target)).toBe(0);
    await rp.shot(customer, 'M03-single-delete-recovered');
    F(
      'M03',
      'bug',
      '삭제 503를 열린 모달 안에 표시하고 재시도 성공 후 견적·파일 참조를 함께 정리함',
    );
  }, 120_000);

  test('M04. 작성 중 선택 삭제 → 그 1건만 제거하고, 취소 견적은 선택 칸 없이 삭제 예정일만 보인다', async () => {
    const page = customer.page;
    const draft = quote(seeded, 'selectedDraft');
    const canceled = quote(seeded, 'protectedCanceled');
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await quoteRow(page, draft)
      .getByRole('checkbox', { name: `${draft.fileName} 선택`, exact: true })
      .check();
    // 취소 견적 — 협력사 회신 같은 업무 기록이 딸려 있어 고객이 지우지 않는다. 대신 언제 사라지는지 보여 준다.
    const canceledRow = quoteRow(page, canceled);
    expect(await canceledRow.getByRole('checkbox').count(), '취소 견적에는 선택 칸이 없다').toBe(0);
    expect(await canceledRow.getByRole('button', { name: '삭제', exact: true }).count()).toBe(0);
    await canceledRow.getByText('자동 삭제 예정', { exact: true }).waitFor();
    expect(await canceledRow.getByTestId('bom-history-purge').innerText()).toContain('이후 자동 삭제');
    await rp.shot(customer, 'M04-canceled-protected');
    await page.getByRole('button', { name: '선택 삭제 (1)', exact: true }).click();

    const dialog = page.getByRole('alertdialog', { name: '선택한 1건 삭제', exact: true });
    await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await page
      .getByRole('status')
      .getByText('1건을 삭제했습니다.', { exact: true })
      .waitFor({ timeout: 30_000 });
    expect(await getPrisma().spBomQuote.count({ where: { id: BigInt(draft.id) } })).toBe(0);
    expect(await fileCount(draft)).toBe(0);
    // 취소 견적과 그 원본 파일 참조는 그대로다.
    expect(await getPrisma().spBomQuote.count({ where: { id: BigInt(canceled.id) } })).toBe(1);
    expect(await fileCount(canceled)).toBe(1);
    expect(
      await getPrisma().spBomQuote.count({
        where: { mbId: OWNER_ID, status: { in: ['requested', 'reviewing', 'answered', 'closed'] } },
      }),
    ).toBe(21);
    F('M04', 'obs', '선택한 작성 중 1건과 파일 참조만 제거된다. 취소 견적은 선택 칸·삭제 버튼 없이 삭제 예정일만 보이고, 진행 상태 21건도 불변');
  }, 120_000);

  test('M05. 삭제 확인 직전 draft→requested 경합 → 0건 성공 오인이 아닌 보호 안내', async () => {
    const page = customer.page;
    const target = quote(seeded, 'staleDraft');
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await quoteRow(page, target).getByRole('button', { name: '삭제', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: `${target.fileName} 삭제`, exact: true });
    await dialog.waitFor({ state: 'visible' });

    await getPrisma().spBomQuote.update({
      where: { id: BigInt(target.id) },
      data: { status: 'requested', requestedAt: new Date() },
    });
    await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();
    const result = page.getByRole('status');
    await result
      .getByText('삭제 직전에 진행 상태가 바뀐 1건은 삭제하지 않고 보호했습니다.', { exact: true })
      .waitFor({ timeout: 30_000 });
    expect(
      await getPrisma().spBomQuote.findUnique({
        where: { id: BigInt(target.id) },
        select: { status: true },
      }),
    ).toMatchObject({ status: 'requested' });
    expect(await fileCount(target)).toBe(1);
    const refreshedRow = quoteRow(page, target);
    // 상태 문구는 고객 화면 공용 사전(BOM_QUOTE_CUSTOMER_STATUS_LABELS, 08-25)의 표시값이다.
    await refreshedRow.getByText('견적요청 접수', { exact: true }).waitFor();
    await refreshedRow.getByText('보호됨', { exact: true }).waitFor();
    F(
      'M05',
      'ux',
      '삭제 직전 상태 경합은 0건 삭제 성공처럼 말하지 않고 진행 이력 보호 사유를 안내함',
    );
  }, 120_000);

  test('M06. 요청 필터 안에서 전역 삭제 → 범위를 명시하고 필터 밖 작성 중 1건만 삭제(취소는 보호)', async () => {
    const page = customer.page;
    const globalTarget = quote(seeded, 'globalDraft');
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await page
      .getByRole('combobox', { name: '견적 상태 필터', exact: true })
      .selectOption('requested');
    await waitForBodyText(page, '총 19건');
    expect(await quoteRow(page, globalTarget).count()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });

    await page
      .getByRole('button', {
        name: '작성 중 전체 삭제 (1)',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: '작성 중 견적 전체 1건 삭제',
      exact: true,
    });
    await dialog
      .getByText(
        '현재 검색어·상태 필터와 관계없이 이 계정의 작성 중 견적 전체에 적용됩니다.',
        { exact: true },
      )
      .waitFor();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await rp.shot(customer, 'M06-global-delete-mobile-confirm');
    await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();

    await page
      .getByRole('status')
      .getByText('1건을 삭제했습니다. 보호 상태 23건은 유지했습니다.', { exact: true })
      .waitFor({ timeout: 30_000 });
    expect(
      await getPrisma().spBomQuote.findUnique({ where: { id: BigInt(globalTarget.id) } }),
    ).toBeNull();
    expect(await fileCount(globalTarget)).toBe(0);
    expect(await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } })).toBe(23);
    expect(await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID, status: 'draft' } })).toBe(0);
    // 전체 삭제도 취소 견적은 건드리지 않는다.
    expect(await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID, status: 'canceled' } })).toBe(1);
    // 남은 파일 참조 = 보호로 바뀐 작성 중 1건 + 취소 1건
    expect(
      await getPrisma().spFile.count({
        where: { pathToken: { startsWith: `e2e/bom-history/${RUN_KEY}/` } },
      }),
    ).toBe(2);
    F(
      'M06',
      'ux',
      '필터 밖까지 적용되는 전체 삭제 범위를 버튼·확인문에 명시하고 보호 23건(취소 1건 포함)을 유지함',
    );
  }, 120_000);

  test('M07. 390px 23건 표 → 문서 넘침 없이 가로 탐색 안내와 2페이지 접근', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await waitForBodyText(page, '총 23건');
    await page
      .getByText('표를 좌우로 밀어 상태·금액·관리 열을 확인하세요.', { exact: true })
      .waitFor();
    const metrics = await page.evaluate(() => {
      const table = document.querySelector('table');
      const scroller = table?.parentElement;
      return {
        documentFits: document.documentElement.scrollWidth <= window.innerWidth,
        tableScrolls:
          scroller !== undefined && scroller !== null
            ? scroller.scrollWidth > scroller.clientWidth
            : false,
      };
    });
    expect(metrics).toEqual({ documentFits: true, tableScrolls: true });
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    expect(
      await page.getByRole('button', { name: '2', exact: true }).getAttribute('aria-current'),
    ).toBe('page');
    expect(await page.getByRole('button', { name: '선택 삭제', exact: true }).isDisabled()).toBe(
      true,
    );
    await rp.shot(customer, 'M07-mobile-table-page-2');
    expect(customer.pageErrors).toEqual([]);
    F(
      'M07',
      'ux',
      '390px에서 문서 가로 넘침 없이 표 내부 스크롤을 발견하고 보호 표본 2페이지까지 접근함',
    );
  }, 120_000);
});
