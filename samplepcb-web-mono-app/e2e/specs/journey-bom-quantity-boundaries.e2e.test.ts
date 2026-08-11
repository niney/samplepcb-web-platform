// Smart BOM 완주 여정 16호 — 수량 직접 입력·경계값·키보드·견적요청 안전성.
//
// 세트·예비·행 주문수량을 버튼이 아닌 숫자 입력으로 편집할 때 빈 값, 음수, 소수,
// 상한 초과를 실제 UI/API/DB로 교차 검증한다. 화면은 허용 범위의 정수로 즉시
// 보정하고 이유를 알려야 하며, 잘못된 값이나 DB 정수 상한 초과 요청이 저장·견적요청에
// 섞여서는 안 된다. 실행: pnpm -F e2e journey:bom:16
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newSession,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const OWNER_ID = `e2e-bom-quantity-${RUN_KEY}`;
const OWNER = { mbId: OWNER_ID, mbNick: 'BOM 수량 경계 E2E 고객' };
const MAX_QUOTE_QTY = 100_000;
const MAX_DATABASE_INT = 2_147_483_647;

interface SeededQuote {
  id: string;
  itemId: string;
  title: string;
  mpn: string;
}

interface QuoteSnapshot {
  status: string;
  setQty: number;
  spareQty: number;
  orderQty: number;
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

async function seedDraft(index: number, setQty = 1, spareQty = 0): Promise<SeededQuote> {
  const title = `[BOM 여정 16호] 수량 경계 ${String(index)} ${RUN_KEY}`;
  const mpn = `E2E-QTY-${String(index)}-${RUN_KEY}`;
  const bomQty = 2;
  const orderQty = bomQty * (setQty + spareQty);
  const unitPrice = 25;
  const lineTotal = orderQty * unitPrice;
  const quote = await getPrisma().spBomQuote.create({
    data: {
      mbId: OWNER_ID,
      title,
      sourceKind: 'single_search',
      status: 'draft',
      buildStatus: 'ready',
      enrichStatus: 'done',
      setQty,
      spareQty,
      itemsTotal: lineTotal,
      shippingFee: 0,
      managementFee: 0,
      finalTotal: lineTotal,
      uncostedCount: 0,
      customerMemo: '16호 숫자 입력 경계와 견적요청 안전성을 검증하는 E2E fixture',
      items: {
        create: {
          rowIdx: 0,
          included: true,
          mpn,
          manufacturerName: 'E2E Components',
          description: `${title} 직접 입력 표본`,
          bomQty,
          orderQty,
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: lineTotal,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: {
            offerKey: `manual:${mpn}`,
            supplier: 'E2E Local Supplier',
            supplierSku: `${mpn}-SKU`,
            packaging: 'Cut Tape',
            breakQty: 1,
            unitPrice,
            currency: 'KRW',
            unitPriceKrw: unitPrice,
            moq: 1,
            orderMultiple: 1,
            stock: 1_000_000,
            priceBreaks: [{ qty: 1, price: unitPrice }],
            fetchedAt: new Date().toISOString(),
            pinned: true,
          },
        },
      },
    },
    include: { items: { select: { id: true } } },
  });
  const item = quote.items[0];
  if (item === undefined) throw new Error(`16호 fixture ${title} 품목이 없습니다`);
  return { id: String(quote.id), itemId: String(item.id), title, mpn };
}

async function snapshot(quote: SeededQuote): Promise<QuoteSnapshot> {
  const row = await getPrisma().spBomQuote.findUnique({
    where: { id: BigInt(quote.id) },
    select: {
      status: true,
      setQty: true,
      spareQty: true,
      items: {
        where: { id: BigInt(quote.itemId) },
        select: { orderQty: true },
      },
    },
  });
  const item = row?.items[0];
  if (row === null || row === undefined || item === undefined) {
    throw new Error(`16호 fixture #${quote.id}를 읽지 못했습니다`);
  }
  return {
    status: row.status,
    setQty: row.setQty,
    spareQty: row.spareQty,
    orderQty: item.orderQty,
  };
}

async function createCustomer(label: string): Promise<E2eSession> {
  const session = await newSession(OWNER);
  session.page.setDefaultTimeout(30_000);
  sessions.push(session);
  rp.watchHttp(session, label);
  return session;
}

async function openQuote(page: Page, quote: SeededQuote): Promise<void> {
  await page.goto(`${BASE_URL}/app/bom/${quote.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: quote.title, exact: true }).waitFor({ state: 'visible' });
  await page.getByText(quote.mpn, { exact: true }).first().waitFor({ state: 'visible' });
}

async function enterAndBlur(input: Locator, raw: string): Promise<string> {
  await input.fill(raw);
  await input.press('Tab');
  await input.page().waitForTimeout(80);
  return input.inputValue();
}

async function expectNormalized(
  input: Locator,
  raw: string,
  expected: string,
  label: string,
): Promise<string> {
  const actual = await enterAndBlur(input, raw);
  expect.soft(actual, `${label} 입력 직후 보정`).toBe(expected);
  if (actual !== expected) {
    await enterAndBlur(input, expected);
  }
  return actual;
}

const rp = createJourneyReport(
  'findings-bom-quantity-boundaries',
  'BOM 여정 16호 수량 직접 입력·경계값·키보드·견적요청 탐색 주행 리포트',
);
const { F, ledger } = rp;
const sessions: E2eSession[] = [];
const quotes: SeededQuote[] = [];

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 16호 — 수량 직접 입력·경계값·키보드·견적요청', () => {
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    for (let index = 1; index <= 6; index += 1) {
      quotes.push(await seedDraft(index));
    }
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
      '16호 견적 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('O01. 세트 수량 빈 값·음수·소수·상한 초과 → 정수 범위로 보정', async () => {
    const quote = quotes[0];
    if (quote === undefined) throw new Error('16호 O01 fixture가 없습니다');
    const customer = await createCustomer('세트 수량 고객');
    await openQuote(customer.page, quote);
    const input = customer.page.getByLabel('세트 수량', { exact: true });

    const observed = [
      await expectNormalized(input, '', '1', '빈 세트 수량'),
      await expectNormalized(input, '0', '1', '0 세트 수량'),
      await expectNormalized(input, '-7', '1', '음수 세트 수량'),
      await expectNormalized(input, '1.6', '2', '소수 세트 수량'),
      await expectNormalized(input, '100001', String(MAX_QUOTE_QTY), '상한 초과 세트 수량'),
    ];
    const feedback = customer.page.getByRole('status').filter({ hasText: '세트 수량' });
    expect.soft(await feedback.count(), '세트 수량 보정 사유를 화면·보조기기에 알림').toBe(1);
    await expect
      .poll(async () => (await snapshot(quote)).setQty, { timeout: 30_000 })
      .toBe(MAX_QUOTE_QTY);
    const saved = await snapshot(quote);
    expect(saved.orderQty, '보정한 세트 수량 기반 주문수량').toBe(200_000);
    F('O01', 'obs', `세트 수량 입력 관측값 ${observed.join(' / ')}, DB=${String(saved.setQty)}`);
    expect(customer.pageErrors, 'O01 pageerror').toEqual([]);
  }, 120_000);

  test('O02. 예비 수량 빈 값·음수·소수·상한 초과 → 0~100,000으로 보정', async () => {
    const quote = quotes[1];
    if (quote === undefined) throw new Error('16호 O02 fixture가 없습니다');
    const customer = await createCustomer('예비 수량 고객');
    await openQuote(customer.page, quote);
    const input = customer.page.getByLabel('예비 수량', { exact: true });

    const observed = [
      await expectNormalized(input, '', '0', '빈 예비 수량'),
      await expectNormalized(input, '-9', '0', '음수 예비 수량'),
      await expectNormalized(input, '2.6', '3', '소수 예비 수량'),
      await expectNormalized(input, '100001', String(MAX_QUOTE_QTY), '상한 초과 예비 수량'),
    ];
    const feedback = customer.page.getByRole('status').filter({ hasText: '예비 수량' });
    expect.soft(await feedback.count(), '예비 수량 보정 사유를 화면·보조기기에 알림').toBe(1);
    await expect
      .poll(async () => (await snapshot(quote)).spareQty, { timeout: 30_000 })
      .toBe(MAX_QUOTE_QTY);
    const saved = await snapshot(quote);
    expect(saved.orderQty, '보정한 예비 수량 기반 주문수량').toBe(200_002);
    F('O02', 'obs', `예비 수량 입력 관측값 ${observed.join(' / ')}, DB=${String(saved.spareQty)}`);
    expect(customer.pageErrors, 'O02 pageerror').toEqual([]);
  }, 120_000);

  test('O03. 행 주문수량 경계·접근 이름·raw DB 상한 초과 → UI 보정과 API 400', async () => {
    const quote = quotes[2];
    if (quote === undefined) throw new Error('16호 O03 fixture가 없습니다');
    const customer = await createCustomer('행 주문수량 고객');
    await openQuote(customer.page, quote);
    const row = customer.page.locator('#bom-results-table tbody tr').filter({ hasText: quote.mpn });
    const input = row.locator('input[type="number"]');
    const expectedLabel = `${quote.mpn} 주문 수량`;
    expect
      .soft(await input.getAttribute('aria-label'), '행 주문수량 접근 가능한 이름')
      .toBe(expectedLabel);

    const observed = [
      await expectNormalized(input, '', '1', '빈 주문수량'),
      await expectNormalized(input, '-3', '1', '음수 주문수량'),
      await expectNormalized(input, '12.6', '13', '소수 주문수량'),
      await expectNormalized(
        input,
        String(MAX_DATABASE_INT + 1),
        String(MAX_DATABASE_INT),
        'DB 상한 초과 주문수량',
      ),
    ];
    const feedback = row.getByRole('status').filter({ hasText: '주문 수량' });
    expect.soft(await feedback.count(), '행 주문수량 보정 사유 표시').toBe(1);
    await customer.page.locator('#bom-results-table').evaluate((table) => {
      const scroller = table.parentElement;
      if (scroller !== null) scroller.scrollLeft = scroller.scrollWidth;
    });
    await rp.shot(customer, 'O03-row-quantity-adjustment');
    // 거대한 경계값은 서버에 보내기 전에 안전한 값으로 다시 바꿔 디바운스 요청을 대체한다.
    await enterAndBlur(input, '13');
    await expect.poll(async () => (await snapshot(quote)).orderQty, { timeout: 30_000 }).toBe(13);

    const token = signJwt(OWNER);
    const oversized = await api(token, 'PATCH', `/api/bom/quotes/${quote.id}`, {
      items: [{ id: quote.itemId, included: true, orderQty: MAX_DATABASE_INT + 1 }],
    });
    expect.soft(oversized.status, 'DB 정수 상한 초과 raw PATCH는 검증 오류').toBe(400);
    expect((await snapshot(quote)).orderQty, '실패한 raw PATCH 뒤 DB 불변').toBe(13);
    F(
      'O03',
      'obs',
      `행 수량 입력 관측값 ${observed.join(' / ')}, oversized PATCH=${String(oversized.status)}`,
    );
    expect(customer.pageErrors, 'O03 pageerror').toEqual([]);
  }, 120_000);

  test('O04. 키보드 증감·최솟값 버튼 → 실제 변경만 저장', async () => {
    const quote = quotes[3];
    if (quote === undefined) throw new Error('16호 O04 fixture가 없습니다');
    const customer = await createCustomer('키보드 수량 고객');
    await openQuote(customer.page, quote);
    const page = customer.page;
    let patchCount = 0;
    page.on('response', (response) => {
      if (
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}`)
      )
        patchCount += 1;
    });
    const setInput = page.getByLabel('세트 수량', { exact: true });
    await setInput.focus();
    await setInput.press('ArrowUp');
    await setInput.press('Tab');
    await expect.poll(async () => (await snapshot(quote)).setQty, { timeout: 30_000 }).toBe(2);
    await setInput.focus();
    await setInput.press('ArrowDown');
    await setInput.press('Tab');
    await expect.poll(async () => (await snapshot(quote)).setQty, { timeout: 30_000 }).toBe(1);
    const changedPatchCount = patchCount;

    await page.getByRole('button', { name: '세트 수량 줄이기', exact: true }).click();
    await page.getByRole('button', { name: '예비 수량 줄이기', exact: true }).click();
    await page.waitForTimeout(1_500);
    expect.soft(patchCount, '최솟값에서 값이 바뀌지 않으면 PATCH 생략').toBe(changedPatchCount);
    F(
      'O04',
      'obs',
      `키보드 왕복 PATCH ${String(changedPatchCount)}회, 최솟값 클릭 뒤 ${String(patchCount)}회`,
    );
    expect(customer.pageErrors, 'O04 pageerror').toEqual([]);
  }, 120_000);

  test('O05. 상한 초과 편집 직후 견적요청 → 보정값 저장 후에만 동결', async () => {
    const quote = quotes[4];
    if (quote === undefined) throw new Error('16호 O05 fixture가 없습니다');
    const customer = await createCustomer('견적요청 수량 고객');
    await openQuote(customer.page, quote);
    const page = customer.page;
    let requestCount = 0;
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/request`)
      )
        requestCount += 1;
    });

    const setInput = page.getByLabel('세트 수량', { exact: true });
    await setInput.fill('100001');
    await page.getByRole('button', { name: '견적요청', exact: true }).click();
    expect
      .soft(await setInput.inputValue(), '모달 진입 blur에서 상한 보정')
      .toBe(String(MAX_QUOTE_QTY));
    const dialog = page.getByRole('dialog', { name: '견적요청', exact: true });
    await dialog.getByRole('button', { name: '견적요청 보내기', exact: true }).click();
    await page.waitForTimeout(2_000);
    let saved = await snapshot(quote);
    expect.soft(saved.status, '보정 성공 뒤 견적요청 상태').toBe('requested');
    expect.soft(saved.setQty, '동결된 세트 수량은 보정 상한').toBe(MAX_QUOTE_QTY);
    expect.soft(requestCount, '견적요청 API 한 번만 호출').toBe(1);

    // 구버전 탐색 주행에서도 다음 테스트와 fixture 정리를 방해하지 않도록 정상값으로 회복한다.
    if (saved.status !== 'requested') {
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
      await enterAndBlur(setInput, String(MAX_QUOTE_QTY));
      await page.getByRole('button', { name: '견적요청', exact: true }).click();
      await page
        .getByRole('dialog', { name: '견적요청', exact: true })
        .getByRole('button', { name: '견적요청 보내기', exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(quote)).status, { timeout: 30_000 })
        .toBe('requested');
      saved = await snapshot(quote);
    }
    F(
      'O05',
      'obs',
      `견적요청 결과 status=${saved.status}, setQty=${String(saved.setQty)}, request=${String(requestCount)}회`,
    );
    expect(customer.pageErrors, 'O05 pageerror').toEqual([]);
  }, 120_000);

  test('O06. 390px 수량 입력 → 숫자 키패드 힌트·보정 안내가 패널 안에 표시', async () => {
    const quote = quotes[5];
    if (quote === undefined) throw new Error('16호 O06 fixture가 없습니다');
    const customer = await createCustomer('모바일 수량 고객');
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuote(page, quote);
    await page.getByRole('button', { name: '분석·견적 상세', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'BOM 분석 및 예상 견적', exact: true });
    const input = panel.getByLabel('세트 수량', { exact: true });
    expect.soft(await input.getAttribute('inputmode'), '모바일 숫자 키패드 힌트').toBe('numeric');
    const observed = await enterAndBlur(input, '-1');
    expect.soft(observed, '모바일 음수 입력 즉시 보정').toBe('1');
    const feedback = panel.getByRole('status').filter({ hasText: '세트 수량' });
    expect.soft(await feedback.count(), '모바일 보정 안내 표시').toBe(1);
    if ((await feedback.count()) > 0) {
      const box = await feedback.boundingBox();
      expect.soft(box, '모바일 보정 안내 영역').not.toBeNull();
      expect.soft((box?.x ?? -1) >= 0, '보정 안내 왼쪽이 화면 안').toBe(true);
      expect
        .soft((box?.x ?? 391) + (box?.width ?? 0) <= 390, '보정 안내 오른쪽이 화면 안')
        .toBe(true);
    }
    await rp.shot(customer, 'O06-mobile-quantity-adjustment');
    if (observed !== '1') await enterAndBlur(input, '1');
    await panel.getByRole('button', { name: '분석 및 견적 패널 닫기', exact: true }).click();
    F('O06', 'obs', `390px 세트 음수 입력 뒤 표시값=${observed}`);
    expect(customer.pageErrors, 'O06 pageerror').toEqual([]);
  }, 120_000);
});
