// Smart BOM 완주 여정 14호 — 다중 시트 분석 영속·복구.
//
// 실제 XLSX 두 개로 BOM/비BOM 시트 구분, prepare 일시 실패의 같은 잡 재시도,
// 엔진 잡 삭제 뒤 DB 분석 스냅샷 계산, 시트 제외·복원의 라인 보존, 유효 BOM이 없는
// 워크북의 회복 화면과 모바일 표시를 실 UI/API/DB로 교차 검증한다. 테스트가 만든
// 작성 중 Case와 엔진 잡은 종료 훅에서 모두 정리한다.
// 실행: pnpm -F e2e journey:bom:14
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page, Route } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  monoRoot,
  newSession,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const OWNER_ID = `e2e-bom-workbook-${RUN_KEY}`;
const MULTI_SHEET_XLSX = join(monoRoot, 'e2e', 'fixtures', 'bom-journey-14-multi-sheet.xlsx');
const NO_BOM_XLSX = join(monoRoot, 'e2e', 'fixtures', 'bom-journey-14-no-bom.xlsx');

interface QuoteState {
  id: bigint;
  status: string;
  buildStatus: string;
  enrichStatus: string;
  engineJobId: string | null;
  activeAnalysisRunId: bigint | null;
}

interface QuoteItemRow {
  id: bigint;
  mpn: string;
  bomQty: number;
  sourceSheetIndex: number | null;
  sourceSheetName: string | null;
  analysisComponentId: bigint | null;
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

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

async function waitForQuoteState(
  quoteId: string,
  label: string,
  predicate: (state: QuoteState) => boolean,
  timeoutMs = 180_000,
): Promise<QuoteState> {
  const deadline = Date.now() + timeoutMs;
  let last: QuoteState | null = null;
  while (Date.now() < deadline) {
    last = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quoteId) },
      select: {
        id: true,
        status: true,
        buildStatus: true,
        enrichStatus: true,
        engineJobId: true,
        activeAnalysisRunId: true,
      },
    });
    if (last !== null && predicate(last)) return last;
    await delay(500);
  }
  throw new Error(
    `${label} 대기 시간 초과 — 마지막 상태 ${last === null ? '없음' : `${last.status}/${last.buildStatus}/${last.enrichStatus}`}`,
  );
}

function quoteIdFromPage(page: Page): string {
  const match = /^\/app\/bom\/(\d+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined)
    throw new Error(`업로드 뒤 quoteId를 찾지 못했습니다: ${page.url()}`);
  return match[1];
}

async function deleteEngineJob(jobId: string | null): Promise<void> {
  if (jobId === null || jobId === '') return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await fetch(`${BOM_ENGINE_URL}/jobs/${encodeURIComponent(jobId)}`);
    if (status.status === 404) return;
    if (!status.ok) throw new Error(`엔진 잡 ${jobId} 조회 실패 HTTP ${String(status.status)}`);
    const body: unknown = await status.json();
    const state =
      body !== null && typeof body === 'object' && 'status' in body ? String(body.status) : '';
    if (state === 'completed' || state === 'failed') {
      const removed = await fetch(`${BOM_ENGINE_URL}/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      if (removed.status !== 204 && removed.status !== 404) {
        throw new Error(`엔진 잡 ${jobId} 삭제 실패 HTTP ${String(removed.status)}`);
      }
      return;
    }
    await delay(500);
  }
  throw new Error(`엔진 잡 ${jobId} 종료 대기 시간 초과`);
}

async function waitForBodyText(page: Page, text: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (expected: string) => document.body.innerText.includes(expected),
    text,
    { timeout },
  );
}

async function cardFitsViewport(page: Page): Promise<boolean> {
  const title = page.getByText('Drag & drop Bom File', { exact: true });
  await title.waitFor({ state: 'visible', timeout: 30_000 });
  const card = title.locator('xpath=../..');
  const box = await card.boundingBox();
  const viewport = page.viewportSize();
  return box !== null && viewport !== null && box.x >= 0 && box.x + box.width <= viewport.width;
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 14호 — 다중 시트 분석 영속·복구', () => {
  const rp = createJourneyReport(
    'findings-bom-workbook-recovery',
    'BOM 여정 14호 다중 시트 분석 영속·복구 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: E2eSession;
  let customerToken = '';
  let multiQuoteId: string | null = null;
  let noBomQuoteId: string | null = null;
  let multiEngineJobId: string | null = null;
  let noBomEngineJobId: string | null = null;
  let optionItemIds: string[] = [];

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(`${BOM_ENGINE_URL}/health`, 'samplepcb-parts-engine ./run.sh');
    customerToken = signJwt({ mbId: OWNER_ID, mbNick: 'BOM 워크북 E2E 고객', ttlSec: 7_200 });
    customer = await newSession({ mbId: OWNER_ID, mbNick: 'BOM 워크북 E2E 고객' });
    rp.watchHttp(customer, '워크북 고객');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    const prisma = getPrisma();
    const rows: { id: bigint; engineJobId: string | null }[] = await prisma.spBomQuote.findMany({
      where: { mbId: OWNER_ID },
      select: { id: true, engineJobId: true },
    });
    for (const row of rows) {
      await deleteEngineJob(row.engineJobId).catch((error: unknown) => {
        F(
          'N99',
          'obs',
          `엔진 잡 사후 정리 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      const removed = await api(customerToken, 'DELETE', `/api/bom/quotes/${String(row.id)}`);
      if (removed.status !== 200 && removed.status !== 404) {
        F(
          'N99',
          'bug',
          `제품 경로 Case #${String(row.id)} 정리 실패 HTTP ${String(removed.status)}`,
        );
      }
    }
    const leftovers: { id: bigint }[] = await prisma.spBomQuote.findMany({
      where: { mbId: OWNER_ID },
      select: { id: true },
    });
    const leftoverIds = leftovers.map((row) => row.id);
    if (leftoverIds.length > 0) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_bom_quote', refId: { in: leftoverIds } },
      });
      await prisma.spBomQuote.deleteMany({ where: { id: { in: leftoverIds } } });
    }
    expect(await prisma.spBomQuote.count({ where: { mbId: OWNER_ID } }), '14호 견적 잔재').toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 180_000);

  test('N01. 390px 업로드 카드 → 좌우 잘림 없이 파일 선택 가능', async () => {
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
    const fits = await cardFitsViewport(page);
    expect.soft(fits, '390px에서 업로드 카드 전체가 보여야 합니다').toBe(true);
    if (!fits) F('N01', 'bug', '640px 고정 업로드 카드가 390px 화면의 좌우를 벗어남');
    expect
      .soft(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        '문서 자체에 불필요한 가로 스크롤이 없어야 합니다',
      )
      .toBe(true);
    await rp.shot(customer, 'N01-mobile-bom-upload');
    await page.setViewportSize({ width: 1440, height: 900 });
  }, 60_000);

  test('N02. prepare 502 → 같은 엔진 잡 재시도 → BOM 2개·비BOM 1개 선택', async () => {
    const page = customer.page;
    let prepareFailed = false;
    const preparePattern = '**/api/bom/quotes/*/prepare';
    const prepareHandler = async (route: Route): Promise<void> => {
      if (!prepareFailed && route.request().method() === 'POST') {
        prepareFailed = true;
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'BOM_ENGINE_UNREACHABLE' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(preparePattern, prepareHandler);
    await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="file"]').first().setInputFiles(MULTI_SHEET_XLSX);
    await page.waitForURL((url) => /^\/app\/bom\/\d+$/.test(url.pathname), { timeout: 60_000 });
    multiQuoteId = quoteIdFromPage(page);
    ledger.push(`sp_bom_quote #${multiQuoteId} (${OWNER_ID}, 다중 시트 실제 XLSX)`);

    await waitForBodyText(page, 'BOM 분석 결과를 불러오지 못했습니다', 240_000);
    const failureAlert = page.getByRole('alert', {
      name: 'BOM 분석 결과를 불러오지 못했습니다',
      exact: true,
    });
    const retryButton = page.getByRole('button', {
      name: '분석 결과 다시 불러오기',
      exact: true,
    });
    const hasRetry = (await retryButton.count()) === 1;
    const hasNamedAlert = (await failureAlert.count()) === 1;
    await rp.shot(customer, 'N02-prepare-retry');
    expect.soft(hasRetry, '일시적 prepare 실패는 같은 잡 재시도를 제공해야 합니다').toBe(true);
    expect.soft(hasNamedAlert, '분석 실패를 보조기기에 즉시 알려야 합니다').toBe(true);
    if (!hasRetry)
      F('N02', 'bug', 'prepare 502가 재업로드만 안내해 완료된 엔진 잡을 재사용할 수 없음');
    if (!hasNamedAlert)
      F('N02', 'ux', '분석 실패 영역에 alert 이름·초기 포커스가 없어 오류 인지가 늦음');

    if (hasRetry) {
      expect
        .soft(await failureAlert.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
      await retryButton.click();
    } else {
      const recovered = await api(customerToken, 'POST', `/api/bom/quotes/${multiQuoteId}/prepare`);
      expect(recovered.status, JSON.stringify(recovered.json)).toBe(200);
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await page.getByRole('heading', { name: '계산할 BOM 시트를 선택해 주세요' }).waitFor({
      state: 'visible',
      timeout: 120_000,
    });
    await rp.shot(customer, 'N02-sheet-selection');
    await page.unroute(preparePattern, prepareHandler);
    expect(prepareFailed).toBe(true);

    const main = page.locator('label').filter({ hasText: 'Main BOM' });
    const option = page.locator('label').filter({ hasText: 'Option BOM' });
    const readMe = page.locator('label').filter({ hasText: 'Read Me' });
    await main.getByText('3개 부품', { exact: false }).waitFor();
    await option.getByText('2개 부품', { exact: false }).waitFor();
    await readMe.getByText('BOM 헤더 미탐', { exact: true }).waitFor();
    expect(await readMe.locator('input[type="checkbox"]').isDisabled()).toBe(true);

    const prepared = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(multiQuoteId) },
      include: {
        sheets: { orderBy: { sheetIndex: 'asc' } },
        activeAnalysisRun: {
          include: {
            sheets: { orderBy: { sheetIndex: 'asc' } },
            components: true,
          },
        },
      },
    });
    expect(prepared?.sheets.map((sheet: { status: string }) => sheet.status)).toEqual([
      'parsed',
      'parsed',
      'not_bom',
    ]);
    expect(prepared?.activeAnalysisRun?.components).toHaveLength(5);
    expect(prepared?.activeAnalysisRunId, '활성 분석 스냅샷').not.toBeNull();
    multiEngineJobId = prepared?.engineJobId ?? null;
    expect(multiEngineJobId).not.toBeNull();

    await deleteEngineJob(multiEngineJobId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '계산할 BOM 시트를 선택해 주세요' }).waitFor();
    await page
      .locator('label')
      .filter({ hasText: 'Main BOM' })
      .locator('input[type="checkbox"]')
      .check();
    await page
      .locator('label')
      .filter({ hasText: 'Option BOM' })
      .locator('input[type="checkbox"]')
      .check();
    await page.getByRole('button', { name: '선택한 2개 시트 계산', exact: true }).click();

    await waitForQuoteState(
      multiQuoteId,
      '엔진 잡 삭제 후 DB 스냅샷 계산',
      (state) => state.buildStatus === 'ready',
      180_000,
    );
    const ready = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(multiQuoteId) },
      include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
    });
    const items: QuoteItemRow[] = ready?.items ?? [];
    expect(items).toHaveLength(5);
    expect(items.filter((item) => item.sourceSheetIndex === 0)).toHaveLength(3);
    expect(items.filter((item) => item.sourceSheetIndex === 1)).toHaveLength(2);
    expect(items.filter((item) => item.mpn === 'RC0603FR-0710KL')).toHaveLength(2);
    expect(items.every((item) => item.analysisComponentId !== null)).toBe(true);
    optionItemIds = items
      .filter((item) => item.sourceSheetIndex === 1)
      .map((item) => String(item.id));
    await waitForQuoteState(
      multiQuoteId,
      '시트 관리 전 공급사 확인 종료',
      (state) => state.buildStatus === 'ready' && state.enrichStatus !== 'searching',
      600_000,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '시트 2/2', exact: true }).waitFor({ timeout: 60_000 });
    await rp.shot(customer, 'N02-ready-from-persisted-analysis');
    F('N02', 'obs', '엔진 잡 삭제·화면 재로드 뒤에도 DB 분석 스냅샷만으로 5개 라인을 계산함');
  }, 720_000);

  test('N03. 시트 관리 키보드 경계·PUT 503 → 선택 유지 재시도 → 제외', async (ctx) => {
    if (multiQuoteId === null) return ctx.skip();
    const quoteId = multiQuoteId;
    const page = customer.page;
    const trigger = page.getByRole('button', { name: '시트 2/2', exact: true });
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    await trigger.click();
    let dialog = page.getByRole('dialog', { name: '견적 시트 관리', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await rp.shot(customer, 'N03-sheet-manager-keyboard');
    const focusInside = await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    );
    const scrollLocked = (await page.evaluate(() => document.body.style.overflow)) === 'hidden';
    expect.soft(focusInside, '시트 관리가 열리면 포커스가 모달 안으로 이동해야 합니다').toBe(true);
    expect.soft(scrollLocked, '시트 관리 중 배경 스크롤을 잠가야 합니다').toBe(true);
    if (!focusInside || !scrollLocked)
      F('N03', 'ux', '시트 관리 모달이 초기 포커스·배경 스크롤을 제어하지 않음');

    await dialog.getByRole('button', { name: '시트 구성 적용', exact: true }).focus();
    await page.keyboard.press('Tab');
    const tabStayedInside = await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    );
    expect.soft(tabStayedInside, 'Tab 순환이 시트 관리 모달을 벗어나면 안 됩니다').toBe(true);
    await page.keyboard.press('Escape');
    const escaped = await dialog.isHidden();
    expect.soft(escaped, 'Escape로 시트 관리 모달을 닫을 수 있어야 합니다').toBe(true);
    if (!tabStayedInside || !escaped)
      F('N03', 'ux', '시트 관리 모달에 Tab 순환 또는 Escape 닫기가 없음');
    if (!escaped) await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    expect.soft(await trigger.evaluate((element) => element === document.activeElement)).toBe(true);
    expect.soft(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);

    await trigger.click();
    dialog = page.getByRole('dialog', { name: '견적 시트 관리', exact: true });
    const optionToggle = dialog.getByRole('button').filter({ hasText: 'Option BOM' });
    await optionToggle.click();

    let updateFailed = false;
    const updatePattern = '**/api/bom/quotes/*/sheets';
    const updateHandler = async (route: Route): Promise<void> => {
      if (!updateFailed && route.request().method() === 'PUT') {
        updateFailed = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'SHEETS_TEMPORARILY_UNAVAILABLE' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(updatePattern, updateHandler);
    await dialog.getByRole('button', { name: '시트 구성 적용', exact: true }).click();
    await dialog
      .getByText('시트 구성을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.', {
        exact: true,
      })
      .waitFor();
    await rp.shot(customer, 'N03-sheet-manager-503');
    const inlineAlert = dialog.getByRole('alert');
    const hasInlineAlert = (await inlineAlert.count()) === 1;
    expect.soft(hasInlineAlert, '시트 변경 실패를 모달 내부 alert로 알려야 합니다').toBe(true);
    if (hasInlineAlert) {
      expect
        .soft(await inlineAlert.evaluate((element) => element === document.activeElement))
        .toBe(true);
    } else {
      F('N03', 'ux', '시트 변경 503 문구가 alert·포커스 없이 작게 표시됨');
    }
    expect(await optionToggle.getAttribute('aria-pressed')).toBe('false');
    expect(
      await getPrisma().spBomQuoteSheet.count({
        where: { quoteId: BigInt(quoteId), selected: true },
      }),
      '실패 시 DB 선택 불변',
    ).toBe(2);

    await dialog.getByRole('button', { name: '시트 구성 적용', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
    await page.unroute(updatePattern, updateHandler);
    expect(updateFailed).toBe(true);
    await expect
      .poll(
        () =>
          getPrisma().spBomQuoteSheet.count({
            where: { quoteId: BigInt(quoteId), selected: true },
          }),
        { timeout: 30_000 },
      )
      .toBe(1);
    expect(
      await getPrisma().spBomQuoteItem.count({ where: { quoteId: BigInt(quoteId) } }),
      '제외 뒤 원본 라인 보존',
    ).toBe(5);
    await page.getByText('3개 부품', { exact: true }).first().waitFor({ timeout: 30_000 });
    F('N03', 'obs', 'PUT 503 뒤 선택을 유지해 재시도했고 Option BOM만 합계에서 제외함');
  }, 180_000);

  test('N04. 제외 시트 복원 → 원래 라인 ID·분석 연결 그대로 재사용', async (ctx) => {
    if (multiQuoteId === null) return ctx.skip();
    const quoteId = multiQuoteId;
    const page = customer.page;
    const trigger = page.getByRole('button', { name: '시트 1/2', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '견적 시트 관리', exact: true });
    await dialog.getByRole('button').filter({ hasText: 'Option BOM' }).click();
    await dialog.getByRole('button', { name: '시트 구성 적용', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
    await expect
      .poll(
        () =>
          getPrisma().spBomQuoteSheet.count({
            where: { quoteId: BigInt(quoteId), selected: true },
          }),
        { timeout: 30_000 },
      )
      .toBe(2);

    const restored: QuoteItemRow[] = await getPrisma().spBomQuoteItem.findMany({
      where: { quoteId: BigInt(quoteId), sourceSheetIndex: 1 },
      orderBy: { id: 'asc' },
    });
    expect(restored.map((item) => String(item.id)).sort()).toEqual([...optionItemIds].sort());
    expect(restored.every((item) => item.analysisComponentId !== null)).toBe(true);
    await page.getByRole('button', { name: '시트 2/2', exact: true }).waitFor();
    F('N04', 'obs', '복원은 삭제·재생성 없이 동일 line ID와 analysisComponent 연결을 재사용함');
  }, 120_000);

  test('N05. 유효 BOM 없는 XLSX → 시트별 이유·영속 실패 화면·모바일 재업로드', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="file"]').first().setInputFiles(NO_BOM_XLSX);
    await page.waitForURL((url) => /^\/app\/bom\/\d+$/.test(url.pathname), { timeout: 60_000 });
    noBomQuoteId = quoteIdFromPage(page);
    ledger.push(`sp_bom_quote #${noBomQuoteId} (${OWNER_ID}, 유효 BOM 없음 실제 XLSX)`);
    const failed = await waitForQuoteState(
      noBomQuoteId,
      '유효 BOM 없음 실패 상태',
      (state) => state.buildStatus === 'failed',
      360_000,
    );
    noBomEngineJobId = failed.engineJobId;
    await page
      .getByRole('heading', {
        name: '계산할 수 있는 BOM 시트를 찾지 못했습니다',
        exact: true,
      })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await rp.shot(customer, 'N05-no-valid-bom');
    await page.getByText('Read Me', { exact: true }).waitFor();
    await page.getByText('Stock Ledger', { exact: true }).waitFor();
    expect(await page.getByText('BOM 헤더 미탐', { exact: false }).count()).toBe(2);

    const failureAlert = page.getByRole('alert', {
      name: '계산할 수 있는 BOM 시트를 찾지 못했습니다',
      exact: true,
    });
    const hasAlert = (await failureAlert.count()) === 1;
    expect.soft(hasAlert, '유효 BOM 없음 화면을 alert로 알려야 합니다').toBe(true);
    if (hasAlert) {
      expect
        .soft(await failureAlert.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    } else {
      F('N05', 'ux', '유효 BOM 없음 결과가 alert·초기 포커스 없이 일반 카드로 표시됨');
    }

    const snapshot = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(noBomQuoteId) },
      include: { sheets: true, activeAnalysisRun: { include: { sheets: true } } },
    });
    expect(snapshot?.activeAnalysisRunId).not.toBeNull();
    expect(snapshot?.sheets).toHaveLength(2);
    expect(snapshot?.sheets.every((sheet: { status: string }) => sheet.status === 'not_bom')).toBe(
      true,
    );
    await deleteEngineJob(noBomEngineJobId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', {
        name: '계산할 수 있는 BOM 시트를 찾지 못했습니다',
        exact: true,
      })
      .waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    for (const sheetName of ['Read Me', 'Stock Ledger']) {
      expect(
        await page.getByText(sheetName, { exact: true }).evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
        `${sheetName} 시트명이 모바일에서 생략되지 않아야 합니다`,
      ).toBe(true);
    }
    expect
      .soft(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        '유효 BOM 없음 화면은 390px에서 문서 가로 스크롤을 만들지 않아야 합니다',
      )
      .toBe(true);
    await rp.shot(customer, 'N05-no-valid-bom-mobile');
    await page.getByRole('button', { name: '새 BOM 업로드', exact: true }).click();
    await page.waitForURL('**/app/bom');
    expect
      .soft(await cardFitsViewport(page), '재업로드 카드도 390px 안에 보여야 합니다')
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    F('N05', 'obs', '엔진 잡 삭제·재로드 뒤에도 비BOM 2개 사유가 DB 스냅샷에서 유지됨');
  }, 480_000);
});
