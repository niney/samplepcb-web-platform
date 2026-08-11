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
  { key: 'selectedCanceled', label: '03 선택 취소', status: 'canceled' },
  { key: 'staleDraft', label: '04 삭제 직전 상태 변경', status: 'draft' },
  { key: 'globalCanceled', label: '05 필터 밖 전체 삭제', status: 'canceled' },
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

function isDeletable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'canceled';
}

async function seedQuotes(): Promise<Map<string, SeededQuote>> {
  const prisma = getPrisma();
  const plans = allPlans();
  const baseTime = Date.now();
  const seeded = new Map<string, SeededQuote>();

  for (const [index, plan] of plans.entries()) {
    const fileName = `${SEARCH_KEY}-${plan.label}.xlsx`;
    const requestedAt =
      plan.status === 'draft' || plan.status === 'canceled'
        ? null
        : new Date(baseTime - index * 60_000);
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

    const pathToken = isDeletable(plan.status) ? `e2e/bom-history/${RUN_KEY}/${plan.key}` : null;
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
      `sp_file 5건(작성 중·취소 삭제 원장, 보호 전환 1건은 종료 시 정리)`,
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
          name: '작성 중·취소 전체 삭제 (5)',
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

  test('M04. 작성 중+취소 선택 삭제 → 2건만 제거하고 보호 상태는 유지', async () => {
    const page = customer.page;
    const draft = quote(seeded, 'selectedDraft');
    const canceled = quote(seeded, 'selectedCanceled');
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await quoteRow(page, draft)
      .getByRole('checkbox', { name: `${draft.fileName} 선택`, exact: true })
      .check();
    await quoteRow(page, canceled)
      .getByRole('checkbox', { name: `${canceled.fileName} 선택`, exact: true })
      .check();
    await page.getByRole('button', { name: '선택 삭제 (2)', exact: true }).click();

    const dialog = page.getByRole('alertdialog', { name: '선택한 2건 삭제', exact: true });
    await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await page
      .getByRole('status')
      .getByText('2건을 삭제했습니다.', { exact: true })
      .waitFor({ timeout: 30_000 });
    expect(
      await getPrisma().spBomQuote.count({
        where: { id: { in: [BigInt(draft.id), BigInt(canceled.id)] } },
      }),
    ).toBe(0);
    expect(
      await getPrisma().spFile.count({
        where: { refType: FILE_REF_TYPE, refId: { in: [BigInt(draft.id), BigInt(canceled.id)] } },
      }),
    ).toBe(0);
    expect(
      await getPrisma().spBomQuote.count({
        where: { mbId: OWNER_ID, status: { in: ['requested', 'reviewing', 'answered', 'closed'] } },
      }),
    ).toBe(21);
    F('M04', 'obs', '선택한 작성 중·취소 2건과 파일 참조만 제거되고 진행 상태 21건은 불변');
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
    await refreshedRow.getByText('견적 요청', { exact: true }).waitFor();
    await refreshedRow.getByText('보호됨', { exact: true }).waitFor();
    F(
      'M05',
      'ux',
      '삭제 직전 상태 경합은 0건 삭제 성공처럼 말하지 않고 진행 이력 보호 사유를 안내함',
    );
  }, 120_000);

  test('M06. 요청 필터 안에서 전역 삭제 → 범위를 명시하고 필터 밖 취소 1건만 삭제', async () => {
    const page = customer.page;
    const globalTarget = quote(seeded, 'globalCanceled');
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
        name: '작성 중·취소 전체 삭제 (1)',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: '작성 중·취소 견적 전체 1건 삭제',
      exact: true,
    });
    await dialog
      .getByText(
        '현재 검색어·상태 필터와 관계없이 이 계정의 작성 중·취소 견적 전체에 적용됩니다.',
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
      .getByText('1건을 삭제했습니다. 보호 상태 22건은 유지했습니다.', { exact: true })
      .waitFor({ timeout: 30_000 });
    expect(
      await getPrisma().spBomQuote.findUnique({ where: { id: BigInt(globalTarget.id) } }),
    ).toBeNull();
    expect(await fileCount(globalTarget)).toBe(0);
    expect(await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } })).toBe(22);
    expect(
      await getPrisma().spBomQuote.count({
        where: { mbId: OWNER_ID, status: { in: ['draft', 'canceled'] } },
      }),
    ).toBe(0);
    expect(
      await getPrisma().spFile.count({
        where: { pathToken: { startsWith: `e2e/bom-history/${RUN_KEY}/` } },
      }),
    ).toBe(1);
    F(
      'M06',
      'ux',
      '필터 밖까지 적용되는 전체 삭제 범위를 버튼·확인문에 명시하고 보호 22건을 유지함',
    );
  }, 120_000);

  test('M07. 390px 22건 표 → 문서 넘침 없이 가로 탐색 안내와 2페이지 접근', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('searchbox', { name: /파일명 또는 견적명 검색/ }).fill(SEARCH_KEY);
    await waitForBodyText(page, '총 22건');
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
