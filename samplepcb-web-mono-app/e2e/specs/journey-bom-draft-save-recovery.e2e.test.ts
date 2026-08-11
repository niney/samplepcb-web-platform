// Smart BOM 완주 여정 15호 — 고객 초안 편집·자동저장·이탈 복구.
//
// 두 개의 작성 중 견적을 같은 고객에게 만들어 저장 중 추가 편집, PATCH 일시 실패,
// 다른 견적으로 이동, 브라우저 이탈, 견적요청 직전 저장 실패를 실 UI/API/DB로
// 교차 검증한다. 실패한 변경은 화면에 남아 직접 재시도할 수 있어야 하고, 저장되지
// 않은 값으로 견적요청이 동결되거나 다른 견적에 섞여서는 안 된다.
// 실행: pnpm -F e2e journey:bom:15
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page, Route } from 'playwright-core';
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
const OWNER_ID = `e2e-bom-draft-save-${RUN_KEY}`;
const TITLE_A = `[BOM 여정 15호] 편집 초안 A ${RUN_KEY}`;
const TITLE_B = `[BOM 여정 15호] 이동 대상 B ${RUN_KEY}`;

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
  mpn: string;
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

async function seedDraft(
  title: string,
  mpn: string,
  setQty: number,
  bomQty: number,
  unitPrice: number,
  createdAt: Date,
): Promise<SeededQuote> {
  const orderQty = setQty * bomQty;
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
      spareQty: 0,
      itemsTotal: lineTotal,
      shippingFee: 0,
      managementFee: 0,
      finalTotal: lineTotal,
      uncostedCount: 0,
      customerMemo: '15호 자동저장과 이탈 복구 경계를 검증하는 E2E fixture',
      createdAt,
      updatedAt: createdAt,
      items: {
        create: {
          rowIdx: 0,
          included: true,
          mpn,
          manufacturerName: 'E2E Components',
          description: `${title} 자동저장 표본`,
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
            stock: 100_000,
            priceBreaks: [{ qty: 1, price: unitPrice }],
            fetchedAt: createdAt.toISOString(),
            pinned: true,
          },
        },
      },
    },
    include: { items: { select: { id: true } } },
  });
  const item = quote.items[0];
  if (item === undefined) throw new Error(`15호 fixture ${title} 품목이 없습니다`);
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
        select: { orderQty: true, mpn: true },
      },
    },
  });
  const item = row?.items[0];
  if (row === null || row === undefined || item === undefined) {
    throw new Error(`15호 fixture #${quote.id}를 읽지 못했습니다`);
  }
  return {
    status: row.status,
    setQty: row.setQty,
    spareQty: row.spareQty,
    orderQty: item.orderQty,
    mpn: item.mpn,
  };
}

async function openQuote(page: Page, quote: SeededQuote): Promise<void> {
  await page.goto(`${BASE_URL}/app/bom/${quote.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: quote.title, exact: true }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.getByText(quote.mpn, { exact: true }).first().waitFor({ state: 'visible' });
}

async function recentQuoteLink(page: Page, quote: SeededQuote) {
  return page.getByRole('link', { name: quote.title, exact: true });
}

function patchPattern(quote: SeededQuote): string {
  return `**/api/bom/quotes/${quote.id}`;
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 15호 — 고객 초안 편집·자동저장·이탈 복구', () => {
  const rp = createJourneyReport(
    'findings-bom-draft-save-recovery',
    'BOM 여정 15호 고객 초안 편집·자동저장·이탈 복구 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: E2eSession;
  let quoteA!: SeededQuote;
  let quoteB!: SeededQuote;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    const now = Date.now();
    quoteB = await seedDraft(TITLE_B, `E2E-DRAFT-B-${RUN_KEY}`, 7, 3, 700, new Date(now - 60_000));
    quoteA = await seedDraft(TITLE_A, `E2E-DRAFT-A-${RUN_KEY}`, 1, 2, 500, new Date(now));
    customer = await newSession({ mbId: OWNER_ID, mbNick: 'BOM 초안 E2E 고객' });
    await customer.page.setViewportSize({ width: 1720, height: 900 });
    rp.watchHttp(customer, '초안 고객');
    ledger.push(
      `sp_bom_quote #${quoteA.id}(${quoteA.title}, 종료 시 fixture 정리)`,
      `sp_bom_quote #${quoteB.id}(${quoteB.title}, 종료 시 fixture 정리)`,
    );
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await getPrisma().spBomQuote.deleteMany({ where: { mbId: OWNER_ID } });
    expect(
      await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } }),
      '15호 견적 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('O01. 저장 요청 중 추가 편집 → 마지막 값까지 직렬 저장', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);

    let patchCount = 0;
    let releaseFirst!: () => void;
    const firstRequestReached = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let continueFirst!: () => void;
    const firstRequestRelease = new Promise<void>((resolve) => {
      continueFirst = resolve;
    });
    const handler = async (route: Route): Promise<void> => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchCount += 1;
      if (patchCount === 1) {
        releaseFirst();
        await firstRequestRelease;
      }
      await route.continue();
    };
    await page.route(patchPattern(quoteA), handler);

    await page.getByRole('button', { name: '세트 수량 늘리기', exact: true }).click();
    await firstRequestReached;
    await page.getByRole('button', { name: '세트 수량 늘리기', exact: true }).click();
    continueFirst();

    await page.waitForTimeout(2_000);
    const saved = await snapshot(quoteA);
    expect(saved.setQty, '저장 중 추가한 마지막 세트 수량').toBe(3);
    expect(saved.orderQty, '마지막 세트 수량으로 재계산한 주문수량').toBe(6);
    expect(await page.getByLabel('세트 수량', { exact: true }).inputValue()).toBe('3');
    expect(patchCount, '직렬 저장 요청 횟수').toBe(2);
    await page.unroute(patchPattern(quoteA), handler);
    F(
      'O01',
      'obs',
      `저장 중 추가 편집 결과: DB setQty=${String(saved.setQty)}, PATCH ${String(patchCount)}회`,
    );
  }, 120_000);

  test('O02. PATCH 503 → 변경 유지 안내·명시적 재시도·DB 회복', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);
    let failed = false;
    const handler = async (route: Route): Promise<void> => {
      if (!failed && route.request().method() === 'PATCH') {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            result: false,
            error: 'BOM_DRAFT_SAVE_TEMPORARILY_UNAVAILABLE',
            message: '초안 저장 서버가 잠시 응답하지 않습니다.',
          }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(patchPattern(quoteA), handler);

    await page.getByRole('button', { name: '예비 수량 늘리기', exact: true }).click();
    await page.waitForTimeout(1_500);
    const alerts = page.getByRole('alert');
    const retry = page.getByRole('button', { name: '변경사항 다시 저장', exact: true });
    expect(await alerts.filter({ hasText: '변경사항' }).count(), '저장 실패 role=alert').toBe(1);
    expect(await retry.count(), '명시적 저장 재시도 버튼').toBe(1);
    expect((await snapshot(quoteA)).spareQty, '실패 전 DB는 변경되지 않음').toBe(0);
    await rp.shot(customer, 'O02-draft-save-error-retry');
    await retry.click();
    await expect.poll(async () => (await snapshot(quoteA)).spareQty, { timeout: 30_000 }).toBe(1);
    expect(await page.getByText('자동 저장됨', { exact: true }).count()).toBe(1);
    await page.unroute(patchPattern(quoteA), handler);
    F('O02', 'obs', '503 뒤 로컬 변경을 보존하고 같은 화면에서 저장을 재시도함');
  }, 120_000);

  test('O03. 저장 실패 상태에서 다른 견적 이동 → 이동 차단 후 복구·상태 격리', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);
    let rejectPatch = true;
    const handler = async (route: Route): Promise<void> => {
      if (rejectPatch && route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'BOM_DRAFT_SAVE_TEMPORARILY_UNAVAILABLE' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(patchPattern(quoteA), handler);
    await page.getByRole('button', { name: '예비 수량 늘리기', exact: true }).click();
    await page.waitForTimeout(1_500);

    const linkB = await recentQuoteLink(page, quoteB);
    await linkB.click();
    await page.waitForTimeout(500);
    await rp.shot(customer, 'O03-navigation-blocked-by-unsaved-draft');
    expect(new URL(page.url()).pathname, '저장 실패 중에는 현재 견적에 머묾').toBe(
      `/app/bom/${quoteA.id}`,
    );
    expect(
      await page.getByText(quoteA.mpn, { exact: true }).count(),
      'A 화면 유지',
    ).toBeGreaterThan(0);

    const retry = page.getByRole('button', { name: '변경사항 다시 저장', exact: true });
    rejectPatch = false;
    await retry.waitFor({ state: 'visible' });
    await retry.click();
    await expect.poll(async () => (await snapshot(quoteA)).spareQty, { timeout: 30_000 }).toBe(2);
    await (await recentQuoteLink(page, quoteB)).click();
    await page.waitForURL(`**/app/bom/${quoteB.id}`, { timeout: 30_000 });
    await page.getByRole('heading', { name: quoteB.title, exact: true }).waitFor();
    expect(
      await page.getByText(quoteB.mpn, { exact: true }).count(),
      'B 품목만 표시',
    ).toBeGreaterThan(0);
    expect(await page.getByText(quoteA.mpn, { exact: true }).count(), 'A 품목 누출 없음').toBe(0);
    expect(await page.getByLabel('세트 수량', { exact: true }).inputValue(), 'B 세트 수량').toBe(
      '7',
    );
    await page.unroute(patchPattern(quoteA), handler);
    F(
      'O03',
      new URL(page.url()).pathname === `/app/bom/${quoteB.id}` ? 'obs' : 'bug',
      '저장 실패 중 이동을 막고 복구 뒤 서로 다른 초안 상태를 격리함',
    );
  }, 120_000);

  test('O04. 디바운스 대기 중 내부 이동 → 먼저 저장한 뒤 대상 견적 표시', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);
    let patchBCount = 0;
    const quoteBHandler = async (route: Route): Promise<void> => {
      if (route.request().method() === 'PATCH') patchBCount += 1;
      await route.continue();
    };
    await page.route(patchPattern(quoteB), quoteBHandler);
    await page.getByRole('button', { name: '세트 수량 늘리기', exact: true }).click();
    await (await recentQuoteLink(page, quoteB)).click();
    await page.waitForTimeout(2_000);
    const afterMove = await snapshot(quoteA);
    expect(afterMove.setQty, '이동 전에 저장된 A 세트 수량').toBe(4);
    expect(new URL(page.url()).pathname, '저장 성공 뒤 B로 이동').toBe(`/app/bom/${quoteB.id}`);
    await page.getByRole('heading', { name: quoteB.title, exact: true }).waitFor();
    expect(await page.getByLabel('세트 수량', { exact: true }).inputValue()).toBe('7');
    expect(await page.getByText(quoteA.mpn, { exact: true }).count()).toBe(0);
    expect(patchBCount, 'A의 편집이 B API로 누출되지 않음').toBe(0);
    await page.unroute(patchPattern(quoteB), quoteBHandler);
    F('O04', 'obs', '1초 디바운스가 남아 있어도 내부 이동 전에 A를 저장하고 B를 새 상태로 렌더함');
  }, 120_000);

  test('O05. 저장 전 브라우저 이탈 → 기본 이탈 경고 활성화', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);
    await page.getByRole('button', { name: '예비 수량 늘리기', exact: true }).click();
    const dialogPromise = page.waitForEvent('dialog', { timeout: 10_000 });
    const reloadAttempt = page
      .reload({ waitUntil: 'domcontentloaded', timeout: 3_000 })
      .catch(() => null);
    const dialog = await dialogPromise;
    expect(dialog.type(), '브라우저 기본 이탈 경고 종류').toBe('beforeunload');
    await dialog.dismiss();
    await reloadAttempt;
    expect(new URL(page.url()).pathname, '이탈 취소 뒤 현재 견적 유지').toBe(
      `/app/bom/${quoteA.id}`,
    );
    await expect.poll(async () => (await snapshot(quoteA)).spareQty, { timeout: 30_000 }).toBe(3);
    F(
      'O05',
      'obs',
      '저장되지 않은 변경이 있을 때 실제 beforeunload 경고를 띄우고 이탈 취소 뒤 저장을 완료함',
    );
  }, 120_000);

  test('O06. 견적요청 모달·저장 실패 → 최신 초안 저장 전 요청 동결 금지', async () => {
    const page = customer.page;
    await openQuote(page, quoteA);
    const requestTrigger = page.getByRole('button', { name: '견적요청', exact: true });
    const overflowBefore = await page.evaluate(() => document.body.style.overflow);
    await requestTrigger.click();

    const accessibleDialog = page.getByRole('dialog', { name: '견적요청', exact: true });
    expect(await accessibleDialog.count(), '이름 있는 dialog').toBe(1);
    expect(await page.evaluate(() => document.body.style.overflow), '모달 배경 스크롤 잠금').toBe(
      'hidden',
    );
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      '모달 초기 포커스',
    ).toBe('견적명');
    const initialSend = page.getByRole('button', { name: '견적요청 보내기', exact: true });
    await initialSend.focus();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      '마지막에서 첫 요소로 Tab 순환',
    ).toBe('견적명');
    await page.keyboard.press('Shift+Tab');
    expect(
      await initialSend.evaluate((element) => element === document.activeElement),
      '첫 요소에서 마지막으로 Shift+Tab 순환',
    ).toBe(true);
    await page.keyboard.press('Escape');
    expect(
      await page.getByText('견적요청 보내기', { exact: true }).count(),
      'Escape로 모달 닫힘',
    ).toBe(0);
    expect(
      await requestTrigger.evaluate((element) => element === document.activeElement),
      '트리거 포커스 복원',
    ).toBe(true);
    if ((await page.getByText('견적요청 보내기', { exact: true }).count()) > 0) {
      await page.getByRole('button', { name: '취소', exact: true }).click();
    }
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(overflowBefore);

    let rejectPatch = true;
    let requestCount = 0;
    const patchHandler = async (route: Route): Promise<void> => {
      if (rejectPatch && route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'BOM_DRAFT_SAVE_TEMPORARILY_UNAVAILABLE' }),
        });
        return;
      }
      await route.continue();
    };
    const requestHandler = async (route: Route): Promise<void> => {
      if (route.request().method() === 'POST') {
        requestCount += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'E2E_REQUEST_MUST_NOT_RUN' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(patchPattern(quoteA), patchHandler);
    await page.route(`**/api/bom/quotes/${quoteA.id}/request`, requestHandler);
    await page.getByRole('button', { name: '세트 수량 늘리기', exact: true }).click();
    await requestTrigger.click();
    await page.getByRole('button', { name: '견적요청 보내기', exact: true }).click();
    await page.waitForTimeout(500);
    expect(requestCount, '저장 실패 뒤 /request 미호출').toBe(0);
    expect((await snapshot(quoteA)).status).toBe('draft');
    const requestSaveAlert = accessibleDialog
      .getByRole('alert')
      .filter({ hasText: /변경사항.*저장/ });
    expect(await requestSaveAlert.count(), '모달 안 저장 실패 안내').toBe(1);
    expect(await page.getByRole('alert').count(), '모달 중 중복 오류 알림 없음').toBe(1);
    expect(
      await requestSaveAlert.evaluate((element) => element === document.activeElement),
      '저장 실패 안내 포커스',
    ).toBe(true);
    await rp.shot(customer, 'O06-request-blocked-by-save-error');

    rejectPatch = false;
    await page.unroute(`**/api/bom/quotes/${quoteA.id}/request`, requestHandler);
    await page.getByRole('button', { name: '견적요청 보내기', exact: true }).click();
    await expect
      .poll(async () => (await snapshot(quoteA)).status, { timeout: 30_000 })
      .toBe('requested');
    const final = await snapshot(quoteA);
    expect(final.setQty, '견적요청에 동결된 최신 세트 수량').toBe(5);
    expect(final.orderQty, '최신 세트·예비 수량 기반 주문수량').toBe(16);
    expect(
      await page.evaluate(() => document.body.style.overflow),
      '요청 완료 뒤 배경 스크롤 복구',
    ).toBe(overflowBefore);
    await page.unroute(patchPattern(quoteA), patchHandler);
    F(
      'O06',
      requestCount === 0 ? 'obs' : 'bug',
      `저장 실패 중 request 호출 ${String(requestCount)}회, 회복 뒤 상태=${final.status}`,
    );
  }, 120_000);

  test('O07. 모바일 저장 오류·견적요청 모달 → 화면 안에서 완전 표시', async () => {
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuote(page, quoteB);

    let rejectPatch = true;
    const handler = async (route: Route): Promise<void> => {
      if (rejectPatch && route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ result: false, error: 'BOM_DRAFT_SAVE_TEMPORARILY_UNAVAILABLE' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(patchPattern(quoteB), handler);
    await page.getByRole('button', { name: '분석·견적 상세', exact: true }).click();
    const sidePanel = page.getByRole('dialog', { name: 'BOM 분석 및 예상 견적', exact: true });
    await sidePanel.waitFor({ state: 'visible' });
    await sidePanel.getByRole('button', { name: '세트 수량 늘리기', exact: true }).click();
    await page.waitForTimeout(1_500);
    await sidePanel.getByRole('button', { name: '분석 및 견적 패널 닫기', exact: true }).click();

    const alert = page.getByRole('alert').filter({ hasText: '변경사항 저장 실패' });
    await alert.waitFor({ state: 'visible' });
    const alertBox = await alert.boundingBox();
    expect(alertBox, '모바일 저장 오류 영역').not.toBeNull();
    expect((alertBox?.x ?? -1) >= 0, '오류 영역 왼쪽이 화면 안').toBe(true);
    expect((alertBox?.x ?? 391) + (alertBox?.width ?? 0) <= 390, '오류 영역 오른쪽이 화면 안').toBe(
      true,
    );
    expect(
      await alert.evaluate((element) => element.scrollWidth <= element.clientWidth),
      '오류 문구 내부 잘림 없음',
    ).toBe(true);
    const compareBox = await page
      .getByRole('button', { name: 'BOM 비교', exact: true })
      .boundingBox();
    const addBox = await page.getByRole('button', { name: /추가$/ }).boundingBox();
    expect(compareBox, '모바일 BOM 비교 버튼').not.toBeNull();
    expect(
      (compareBox?.x ?? -1) >= 0 && (compareBox?.x ?? 391) + (compareBox?.width ?? 0) <= 390,
      'BOM 비교 버튼 완전 표시',
    ).toBe(true);
    expect(addBox, '모바일 추가 버튼').not.toBeNull();
    expect(
      (addBox?.x ?? -1) >= 0 && (addBox?.x ?? 391) + (addBox?.width ?? 0) <= 390,
      '추가 버튼 완전 표시',
    ).toBe(true);
    await rp.shot(customer, 'O07-mobile-draft-save-error');

    rejectPatch = false;
    await alert.getByRole('button', { name: '변경사항 다시 저장', exact: true }).click();
    await expect.poll(async () => (await snapshot(quoteB)).setQty, { timeout: 30_000 }).toBe(8);
    await page.getByRole('button', { name: '분석·견적 상세', exact: true }).click();
    const requestTrigger = sidePanel.getByRole('button', { name: '견적요청', exact: true });
    await requestTrigger.click();
    const requestDialog = page.getByRole('dialog', { name: '견적요청', exact: true });
    await requestDialog.waitFor({ state: 'visible' });
    const dialogBox = await requestDialog.boundingBox();
    expect(dialogBox, '모바일 견적요청 모달').not.toBeNull();
    expect(
      (dialogBox?.x ?? -1) >= 0 && (dialogBox?.x ?? 391) + (dialogBox?.width ?? 0) <= 390,
      '모달 가로 완전 표시',
    ).toBe(true);
    expect(
      (dialogBox?.y ?? -1) >= 0 && (dialogBox?.y ?? 845) + (dialogBox?.height ?? 0) <= 844,
      '모달 세로 완전 표시',
    ).toBe(true);
    await rp.shot(customer, 'O07-mobile-request-dialog');
    await page.keyboard.press('Escape');
    expect(
      await requestTrigger.evaluate((element) => element === document.activeElement),
      '모바일 트리거 포커스 복원',
    ).toBe(true);
    await sidePanel.getByRole('button', { name: '분석 및 견적 패널 닫기', exact: true }).click();
    await page.unroute(patchPattern(quoteB), handler);
    await page.setViewportSize({ width: 1720, height: 900 });
    expect(customer.pageErrors, '15호 브라우저 pageerror').toEqual([]);
    F('O07', 'obs', '390px 화면에서 저장 오류·재시도와 견적요청 모달을 잘림 없이 조작함');
  }, 120_000);
});
