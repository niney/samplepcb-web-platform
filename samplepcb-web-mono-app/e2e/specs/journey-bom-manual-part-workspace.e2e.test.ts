// Smart BOM 완주 여정 17호 — 고객 수동 부품 검색·추가·변경·실패 복구.
//
// 업로드 BOM 상세의 `+ 추가` 전체화면 작업공간을 실제 로컬 카탈로그 검색과 연결해
// 원본 행 보존, 같은 부품 upsert, 수량·삭제 일시 실패 복구, 키보드·모바일 경계를
// UI/API/DB로 교차 검증한다. 공급사 실시간 보강만 결정적 빈 200 응답으로 격리하고
// 카탈로그 GET과 manual-items mutation은 실 서버를 통과한다.
// 실행: pnpm -F e2e journey:bom:17
/* eslint-disable @typescript-eslint/no-explicit-any */
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
const OWNER_ID = `e2e-bom-manual-part-${RUN_KEY}`;
const OWNER = { mbId: OWNER_ID, mbNick: 'BOM 수동 추가 E2E 고객' };
const PRIMARY_MPN = 'GRM155R61H104KE14D';
const RECOVERY_MPN = 'GRM155C81A225ME44D';

interface SeededQuote {
  id: string;
  itemId: string;
  title: string;
  fileName: string;
  originalMpn: string;
}

interface CatalogFixture {
  partId: string;
  mpn: string;
}

interface ManualRowSnapshot {
  id: string;
  partId: string | null;
  mpn: string;
  bomQty: number;
  orderQty: number;
  sourceSheetIndex: number | null;
  analysisComponentId: string | null;
  supplier: string | null;
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

async function catalogFixture(mpn: string): Promise<CatalogFixture> {
  const part = await getPrisma().spPart.findFirst({
    where: {
      mpn,
      indexedAt: { not: null },
      offers: {
        some: {
          supplier: { in: ['mouser', 'digikey'] },
          priceBreaks: { some: { price: { gt: 0 } } },
        },
      },
    },
    select: { id: true, mpn: true },
    orderBy: { id: 'asc' },
  });
  if (part === null) throw new Error(`${mpn} 색인 부품과 가격 구매 조건이 없습니다`);
  return { partId: String(part.id), mpn: part.mpn };
}

async function seedDraft(index: number): Promise<SeededQuote> {
  const title = `[BOM 여정 17호] 수동 부품 작업공간 ${String(index)} ${RUN_KEY}`;
  const fileName = `bom-journey-17-${String(index)}-${RUN_KEY}.xlsx`;
  const originalMpn = `E2E-ORIGINAL-${String(index)}-${RUN_KEY}`;
  const quote = await getPrisma().spBomQuote.create({
    data: {
      mbId: OWNER_ID,
      title,
      fileName,
      sourceKind: 'upload',
      status: 'draft',
      buildStatus: 'ready',
      enrichStatus: 'done',
      setQty: 1,
      spareQty: 0,
      itemsTotal: 0,
      shippingFee: 0,
      managementFee: 0,
      finalTotal: 0,
      uncostedCount: 1,
      customerMemo: '17호 고객 수동 부품 작업공간 E2E fixture',
      sheets: {
        create: {
          sheetIndex: 0,
          sheetName: 'BOM',
          status: 'parsed',
          componentCount: 1,
          selected: true,
        },
      },
      items: {
        create: {
          rowIdx: 0,
          included: true,
          mpn: originalMpn,
          manufacturerName: 'E2E Original Components',
          description: `${title} 원본 업로드 행`,
          bomQty: 1,
          orderQty: 1,
          matchStatus: 'none',
          selectionSource: 'none',
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          sourceSheetIndex: 0,
          sourceSheetName: 'BOM',
        },
      },
    },
    include: { items: { select: { id: true } } },
  });
  const item = quote.items[0];
  if (item === undefined) throw new Error(`17호 fixture ${title} 원본 품목이 없습니다`);
  return {
    id: String(quote.id),
    itemId: String(item.id),
    title,
    fileName,
    originalMpn,
  };
}

async function routeStableSupplement(page: Page): Promise<void> {
  await page.route('**/api/bom/parts-search/supplement', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: true,
        data: {
          items: [],
          total: 0,
          pricingContext: {
            targetCurrency: 'KRW',
            usdKrwRate: 1_400,
            rateDate: null,
            source: null,
            stale: false,
          },
          engine: { apiCalls: 0, cacheHits: 0, warnings: [] },
          catalog: { status: 'queued', stats: null },
        },
      }),
    });
  });
}

async function createCustomer(label: string): Promise<E2eSession> {
  const session = await newSession(OWNER);
  session.page.setDefaultTimeout(30_000);
  await routeStableSupplement(session.page);
  sessions.push(session);
  rp.watchHttp(session, label);
  return session;
}

async function openQuote(page: Page, quote: SeededQuote): Promise<void> {
  await page.goto(`${BASE_URL}/app/bom/${quote.id}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: quote.fileName, exact: true })
    .waitFor({ state: 'visible' });
  await page.getByText(quote.originalMpn, { exact: true }).first().waitFor({ state: 'visible' });
}

async function openAddWorkspace(page: Page): Promise<Locator> {
  await page.locator('button[title="단일 검색 방식으로 부품 추가"]').click();
  const dialog = page.getByRole('dialog', { name: 'BOM에 부품 추가', exact: true });
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

async function searchOfferRow(page: Page, mpn: string, supplier: string): Promise<Locator> {
  const input = page.getByPlaceholder('MPN, 사양 또는 패키지로 검색');
  await input.fill(mpn);
  const responseWait = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/bom/parts-search?') &&
      response.url().includes(encodeURIComponent(mpn)),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: '검색', exact: true }).click();
  expect((await responseWait).status(), `${mpn} 실제 카탈로그 검색`).toBe(200);
  const row = offerRow(page, mpn, supplier);
  await row.waitFor({ state: 'visible', timeout: 60_000 });
  return row;
}

function offerRow(page: Page, mpn: string, supplier: string): Locator {
  return page
    .locator('table tbody tr')
    .filter({ hasText: mpn })
    .filter({ hasText: supplier })
    .first();
}

async function manualRows(quote: SeededQuote): Promise<ManualRowSnapshot[]> {
  const rows = await getPrisma().spBomQuoteItem.findMany({
    where: {
      quoteId: BigInt(quote.id),
      sourceSheetIndex: null,
      analysisComponentId: null,
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      partId: true,
      mpn: true,
      bomQty: true,
      orderQty: true,
      sourceSheetIndex: true,
      analysisComponentId: true,
      selectedOffer: true,
    },
  });
  return rows.map((row: any) => ({
    id: String(row.id),
    partId: row.partId === null ? null : String(row.partId),
    mpn: row.mpn,
    bomQty: row.bomQty,
    orderQty: row.orderQty,
    sourceSheetIndex: row.sourceSheetIndex,
    analysisComponentId: row.analysisComponentId === null ? null : String(row.analysisComponentId),
    supplier:
      row.selectedOffer !== null &&
      typeof row.selectedOffer === 'object' &&
      !Array.isArray(row.selectedOffer) &&
      typeof row.selectedOffer.supplier === 'string'
        ? row.selectedOffer.supplier
        : null,
  }));
}

function transientFailure(route: Route): Promise<void> {
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      result: false,
      error: 'E2E_TRANSIENT',
      message: '일시적인 연결 문제입니다. 다시 시도해 주세요.',
    }),
  });
}

async function visibleAddPanel(page: Page): Promise<Locator> {
  const panels = page.locator('aside').filter({ hasText: '현재 BOM에 추가' });
  const count = await panels.count();
  for (let index = 0; index < count; index += 1) {
    const panel = panels.nth(index);
    if (await panel.isVisible()) return panel;
  }
  throw new Error('표시 중인 추가 부품 패널이 없습니다');
}

const rp = createJourneyReport(
  'findings-bom-manual-part-workspace',
  'BOM 여정 17호 고객 수동 부품 검색·추가·실패 복구 탐색 주행 리포트',
);
const { F, ledger } = rp;
const sessions: E2eSession[] = [];
const quotes: SeededQuote[] = [];
let primary: CatalogFixture;
let recovery: CatalogFixture;

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 17호 — 고객 수동 부품 검색·추가·변경·실패 복구', () => {
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    primary = await catalogFixture(PRIMARY_MPN);
    recovery = await catalogFixture(RECOVERY_MPN);
    for (let index = 1; index <= 4; index += 1) quotes.push(await seedDraft(index));
    for (const quote of quotes) {
      ledger.push(`sp_bom_quote #${quote.id}(${quote.title}, 종료 시 fixture 정리)`);
    }
  }, 180_000);

  afterAll(async () => {
    rp.write(
      Object.fromEntries(sessions.map((session, index) => [`고객${String(index + 1)}`, session])),
    );
    for (const session of sessions) await session.close().catch(() => undefined);
    await getPrisma().spBomQuote.deleteMany({ where: { mbId: OWNER_ID } });
    expect(
      await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } }),
      '17호 견적 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('O01. 미저장 수량→추가 작업공간: 선저장·초점·스크롤 잠금·키보드 경계', async () => {
    const quote = quotes[0];
    if (quote === undefined) throw new Error('17호 O01 fixture가 없습니다');
    const customer = await createCustomer('작업공간 키보드 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const trigger = page.locator('button[title="단일 검색 방식으로 부품 추가"]');
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    await page.getByLabel('세트 수량', { exact: true }).fill('2');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'BOM에 부품 추가', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await expect
      .poll(
        async () =>
          (
            await getPrisma().spBomQuote.findUnique({
              where: { id: BigInt(quote.id) },
              select: { setQty: true },
            })
          )?.setQty,
        { timeout: 30_000 },
      )
      .toBe(2);

    const searchInput = page.getByPlaceholder('MPN, 사양 또는 패키지로 검색');
    expect
      .soft(await searchInput.getAttribute('aria-label'), '검색창 접근 이름')
      .toBe('부품 검색어');
    expect
      .soft(
        await searchInput.evaluate((input) => document.activeElement === input),
        '열릴 때 검색창 초점',
      )
      .toBe(true);
    expect
      .soft(await page.evaluate(() => document.body.style.overflow), '배경 스크롤 잠금')
      .toBe('hidden');

    await dialog.evaluate((root) => {
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      focusable.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    expect
      .soft(
        await dialog.evaluate((root) => root.contains(document.activeElement)),
        'Tab 초점이 모달 안에 순환',
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect
      .soft(await page.evaluate(() => document.body.style.overflow), '닫은 뒤 스크롤 복원')
      .toBe(previousOverflow);
    await expect
      .poll(async () => trigger.evaluate((button) => document.activeElement === button), {
        timeout: 2_000,
        message: '닫은 뒤 추가 버튼 초점 복원',
      })
      .toBe(true);
    F('O01', 'obs', '미저장 세트 수량을 먼저 저장한 뒤 전체화면 작업공간 키보드 경계를 확인');
    expect(customer.pageErrors, 'O01 pageerror').toEqual([]);
  }, 120_000);

  test('O02. 실제 MPN 검색→Mouser 추가→Digikey 변경: 같은 수동 행 upsert', async () => {
    const quote = quotes[1];
    if (quote === undefined) throw new Error('17호 O02 fixture가 없습니다');
    const customer = await createCustomer('수동 부품 upsert 고객');
    const page = customer.page;
    await openQuote(page, quote);
    await openAddWorkspace(page);

    let row = await searchOfferRow(page, PRIMARY_MPN, 'Mouser');
    await row.getByLabel('BOM 수량', { exact: true }).fill('3');
    let responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/manual-items`),
    );
    await row.getByRole('button', { name: 'BOM 추가', exact: true }).click();
    expect((await responseWait).status(), 'Mouser 수동 추가').toBe(200);
    let saved = await manualRows(quote);
    expect(saved).toHaveLength(1);
    const firstId = saved[0]?.id;
    expect.soft(saved[0]?.partId, '카탈로그 partId 저장').toBe(primary.partId);
    expect.soft(saved[0]?.bomQty, 'BOM 수량 저장').toBe(3);
    expect.soft(saved[0]?.supplier, 'Mouser 구매 조건 저장').toBe('mouser');
    expect.soft(saved[0]?.sourceSheetIndex, '수동 행은 원본 시트와 분리').toBeNull();
    expect.soft(saved[0]?.analysisComponentId, '수동 행은 분석 원본과 분리').toBeNull();

    // 같은 검색어 안의 다른 공급사 행은 검색 캐시를 그대로 사용한다.
    row = offerRow(page, PRIMARY_MPN, 'Digikey');
    await row.waitFor({ state: 'visible' });
    expect
      .soft(
        await row.getByRole('button', { name: '변경', exact: true }).count(),
        '같은 부품의 다른 구매 조건은 변경으로 안내',
      )
      .toBe(1);
    await row.getByLabel('BOM 수량', { exact: true }).fill('4');
    responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/manual-items`),
    );
    await row.getByRole('button', { name: '변경', exact: true }).click();
    expect((await responseWait).status(), 'Digikey 구매 조건 변경').toBe(200);
    saved = await manualRows(quote);
    expect(saved, '같은 partId 수동 행 중복 없음').toHaveLength(1);
    expect.soft(saved[0]?.id, 'upsert 뒤 안정 행 ID').toBe(firstId);
    expect.soft(saved[0]?.bomQty, '변경한 BOM 수량').toBe(4);
    expect.soft(saved[0]?.supplier, '변경한 공급사').toBe('digikey');
    expect(
      await getPrisma().spBomQuoteItem.count({
        where: { quoteId: BigInt(quote.id), id: BigInt(quote.itemId) },
      }),
      '업로드 원본 행 보존',
    ).toBe(1);
    const panel = await visibleAddPanel(page);
    await panel.getByText('직접 추가 부품 1개', { exact: true }).waitFor({ state: 'visible' });
    await rp.shot(customer, 'O02-manual-part-upsert');
    F('O02', 'obs', `실검색 ${primary.mpn}을 한 안정 행으로 Mouser→Digikey 변경`);
    expect(customer.pageErrors, 'O02 pageerror').toEqual([]);
  }, 180_000);

  test('O03. 신규 추가 POST 503: 오류 초점·DB 불변·같은 화면 재시도', async () => {
    const quote = quotes[2];
    if (quote === undefined) throw new Error('17호 O03 fixture가 없습니다');
    const customer = await createCustomer('추가 실패 복구 고객');
    const page = customer.page;
    await openQuote(page, quote);
    await openAddWorkspace(page);
    const row = await searchOfferRow(page, RECOVERY_MPN, 'Mouser');
    await row.getByLabel('BOM 수량', { exact: true }).fill('2');

    const pattern = `**/api/bom/quotes/${quote.id}/manual-items`;
    const failHandler = (route: Route): Promise<void> => transientFailure(route);
    await page.route(pattern, failHandler);
    await row.getByRole('button', { name: 'BOM 추가', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: '일시적인 연결 문제' });
    await alert.waitFor({ state: 'visible' });
    expect
      .soft(
        await alert.evaluate((element) => document.activeElement === element),
        '추가 실패 안내로 초점 이동',
      )
      .toBe(true);
    expect(await manualRows(quote), '실패한 신규 추가는 DB에 없음').toHaveLength(0);

    await page.unroute(pattern, failHandler);
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/manual-items`),
    );
    await row.getByRole('button', { name: 'BOM 추가', exact: true }).click();
    expect((await responseWait).status(), '신규 추가 재시도').toBe(200);
    const saved = await manualRows(quote);
    expect(saved).toHaveLength(1);
    expect.soft(saved[0]?.partId).toBe(recovery.partId);
    expect.soft(saved[0]?.bomQty).toBe(2);
    expect.soft(saved[0]?.supplier).toBe('mouser');
    F('O03', 'obs', '신규 추가 일시 실패 뒤 검색·수량을 유지한 채 재시도 성공');
    expect(customer.pageErrors, 'O03 pageerror').toEqual([]);
  }, 180_000);

  test('O04. 패널 수량 POST 503: 실패값 롤백·인접 오류·재시도', async () => {
    const quote = quotes[2];
    if (quote === undefined) throw new Error('17호 O04 fixture가 없습니다');
    const customer = sessions[2];
    if (customer === undefined) throw new Error('17호 O03 세션이 없습니다');
    const page = customer.page;
    const panel = await visibleAddPanel(page);
    const article = panel.locator('article').filter({ hasText: RECOVERY_MPN });
    const input = article.getByLabel('BOM 수량', { exact: true });
    const pattern = `**/api/bom/quotes/${quote.id}/manual-items`;
    const failHandler = (route: Route): Promise<void> => transientFailure(route);
    await page.route(pattern, failHandler);
    await input.fill('5');
    await input.press('Tab');
    await page
      .getByRole('alert')
      .filter({ hasText: '일시적인 연결 문제' })
      .waitFor({ state: 'visible' });
    const panelAlert = panel.getByRole('alert').filter({ hasText: '일시적인 연결 문제' });
    expect.soft(await panelAlert.count(), '수량 실패 안내가 조작 패널 안에 표시').toBe(1);
    if ((await panelAlert.count()) === 1) {
      expect
        .soft(
          await panelAlert.evaluate((element) => document.activeElement === element),
          '패널 실패 안내로 초점 이동',
        )
        .toBe(true);
    }
    expect.soft(await input.inputValue(), '실패한 로컬 수량을 서버값으로 롤백').toBe('2');
    expect((await manualRows(quote))[0]?.bomQty, '실패 뒤 DB 수량 불변').toBe(2);
    await rp.shot(customer, 'O04-panel-quantity-error');

    await page.unroute(pattern, failHandler);
    // 수정 전 탐색 주행에서도 실패한 로컬값과 같은 값을 다시 쓰면 change가 생략될 수
    // 있으므로 서버 정본으로 한 번 맞춘 뒤 실제 재시도 값을 입력한다.
    await input.fill('2');
    await input.press('Tab');
    await input.fill('5');
    await input.press('Tab');
    await expect
      .poll(async () => (await manualRows(quote))[0]?.bomQty, { timeout: 30_000 })
      .toBe(5);
    expect(await input.inputValue(), '재시도 성공 수량 표시').toBe('5');
    F('O04', 'obs', '패널 수량 실패는 서버값으로 복구하고 같은 입력에서 재시도 성공');
    expect(customer.pageErrors, 'O04 pageerror').toEqual([]);
  }, 120_000);

  test('O05. 패널 삭제 DELETE 503: 행 보존·인접 오류·재시도', async () => {
    const quote = quotes[2];
    if (quote === undefined) throw new Error('17호 O05 fixture가 없습니다');
    const customer = sessions[2];
    if (customer === undefined) throw new Error('17호 O03 세션이 없습니다');
    const page = customer.page;
    const existing = (await manualRows(quote))[0];
    if (existing === undefined) throw new Error('17호 O05 제거 대상이 없습니다');
    const panel = await visibleAddPanel(page);
    const article = panel.locator('article').filter({ hasText: RECOVERY_MPN });
    const pattern = `**/api/bom/quotes/${quote.id}/manual-items/${existing.id}`;
    const failHandler = (route: Route): Promise<void> => transientFailure(route);
    await page.route(pattern, failHandler);
    await article.getByRole('button', { name: '추가 부품 제거', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: '일시적인 연결 문제' })
      .waitFor({ state: 'visible' });
    const panelAlert = panel.getByRole('alert').filter({ hasText: '일시적인 연결 문제' });
    expect.soft(await panelAlert.count(), '삭제 실패 안내가 제거 버튼과 같은 패널에 표시').toBe(1);
    if ((await panelAlert.count()) === 1) {
      expect
        .soft(
          await panelAlert.evaluate((element) => document.activeElement === element),
          '삭제 실패 안내로 초점 이동',
        )
        .toBe(true);
    }
    expect(await manualRows(quote), '실패한 삭제 뒤 수동 행 보존').toHaveLength(1);

    await page.unroute(pattern, failHandler);
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/manual-items/${existing.id}`),
    );
    await article.getByRole('button', { name: '추가 부품 제거', exact: true }).click();
    expect((await responseWait).status(), '삭제 재시도').toBe(200);
    await expect.poll(async () => (await manualRows(quote)).length, { timeout: 30_000 }).toBe(0);
    F('O05', 'obs', '삭제 일시 실패 뒤 행을 보존하고 같은 패널에서 재시도 성공');
    expect(customer.pageErrors, 'O05 pageerror').toEqual([]);
  }, 120_000);

  test('O06. 390px 검색 결과 액션·추가 목록·완료 동선이 화면 안에 표시', async () => {
    const quote = quotes[3];
    if (quote === undefined) throw new Error('17호 O06 fixture가 없습니다');
    const customer = await createCustomer('모바일 수동 추가 고객');
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuote(page, quote);
    await openAddWorkspace(page);
    const row = await searchOfferRow(page, PRIMARY_MPN, 'Mouser');
    const action = row.getByRole('button', { name: 'BOM 추가', exact: true });
    const scroller = row.locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');
    const initialBox = await action.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    expect.soft(initialBox, '모바일 추가 액션 위치').not.toBeNull();
    const initiallyInViewport =
      initialBox !== null &&
      scrollerBox !== null &&
      initialBox.x >= Math.max(0, scrollerBox.x) &&
      initialBox.x + initialBox.width <= Math.min(390, scrollerBox.x + scrollerBox.width);
    expect.soft(initiallyInViewport, '가로 스크롤 전 BOM 추가 액션 인지 가능').toBe(true);
    await rp.shot(customer, 'O06-mobile-manual-part-search');
    if (!initiallyInViewport) {
      await scroller.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
    }
    await action.click();
    await expect.poll(async () => (await manualRows(quote)).length, { timeout: 30_000 }).toBe(1);

    const floating = page.getByRole('button', { name: '추가 부품 목록 열기', exact: true });
    await floating.waitFor({ state: 'visible' });
    expect.soft(await floating.textContent(), '모바일 추가 개수').toContain('1');
    await floating.click();
    let sheet = page.getByRole('dialog', { name: '추가 부품 목록', exact: true });
    expect.soft(await sheet.count(), '하단 추가 목록의 대화상자 의미').toBe(1);
    const closeButton = page.locator('button[aria-label="추가 부품 목록 닫기"]:visible').last();
    expect
      .soft(
        await closeButton.evaluate((button) => document.activeElement === button),
        '하단 목록을 열면 닫기 버튼에 초점',
      )
      .toBe(true);
    if ((await sheet.count()) === 1) {
      await sheet.evaluate((root) => {
        const focusable = [
          ...root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        focusable.at(-1)?.focus();
      });
      await page.keyboard.press('Tab');
      expect
        .soft(
          await sheet.evaluate((root) => root.contains(document.activeElement)),
          '하단 목록 안에서 Tab 순환',
        )
        .toBe(true);
    }

    await page.keyboard.press('Escape');
    const workspace = page.getByRole('dialog', { name: 'BOM에 부품 추가', exact: true });
    const workspaceStillOpen = await workspace.isVisible();
    expect.soft(workspaceStillOpen, 'Esc는 하단 목록만 닫고 검색 작업공간은 유지').toBe(true);
    expect
      .soft(
        workspaceStillOpen &&
          (await floating.evaluate((button) => document.activeElement === button)),
        '하단 목록을 닫으면 열기 버튼으로 초점 복원',
      )
      .toBe(true);
    if (!workspaceStillOpen) await openAddWorkspace(page);
    await page.getByRole('button', { name: '추가 부품 목록 열기', exact: true }).click();
    sheet = page.getByRole('dialog', { name: '추가 부품 목록', exact: true });
    if ((await sheet.count()) === 1) await sheet.waitFor({ state: 'visible' });
    const panel = await visibleAddPanel(page);
    await panel.getByText(PRIMARY_MPN, { exact: true }).waitFor({ state: 'visible' });
    const panelBox = await panel.boundingBox();
    expect.soft(panelBox, '모바일 추가 목록 패널 위치').not.toBeNull();
    if (panelBox !== null) {
      expect
        .soft(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, '추가 목록 가로 경계')
        .toBe(true);
      expect
        .soft(panelBox.y >= 0 && panelBox.y + panelBox.height <= 844, '추가 목록 세로 경계')
        .toBe(true);
    }
    await rp.shot(customer, 'O06-mobile-manual-part-panel');
    await panel.getByRole('button', { name: '추가 완료 · BOM으로 돌아가기', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'BOM에 부품 추가', exact: true })
      .waitFor({ state: 'hidden' });
    F('O06', 'obs', `390px 최초 액션 화면 내=${String(initiallyInViewport)}, 추가 목록·완료 확인`);
    expect(customer.pageErrors, 'O06 pageerror').toEqual([]);
  }, 180_000);
});
