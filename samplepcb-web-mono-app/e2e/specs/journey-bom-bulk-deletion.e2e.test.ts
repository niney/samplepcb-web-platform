// Smart BOM 완주 여정 10호 — 목록 일괄 삭제의 혼합 성공·보호·경합 결과.
//
// 한 번의 선택에 일반 Case, 결제 주문, 실행 직전 변경, 공유 주문 보호가 섞여도
// 삭제 가능한 Case만 지우고 나머지는 선택·원장을 유지해야 한다. 실행 중 만든 Case만
// 대상으로 쓰며, 성공 표본은 제품 삭제 경로로 정리하고 공유 주문 표본만 대장에 남긴다.
// 실행: pnpm -F e2e journey:bom:10
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  newSession,
  placeBatchOrderFromBomQuotes,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const DELETE_REASON = `[BOM 여정 10호 ${RUN_KEY}] 혼합 일괄 삭제 검증`;

interface SeededQuote {
  quoteId: string;
  title: string;
  orderAmount: number;
  appliedSetQty: number;
}

interface DeletePreview {
  case: { id: string; title: string };
  blockers: string[];
  previewToken: string;
}

interface CountRow {
  count: bigint | number;
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

async function seedAnsweredQuote(mbId: string, title: string, sequence: number): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const setQty = 2;
  const spareQty = 1;
  const bomQty = sequence % 3 + 1;
  const orderQty = bomQty * setQty + spareQty;
  const unitPrice = 410 + sequence * 25;
  const itemsTotal = orderQty * unitPrice;
  const shippingFee = 2_000;
  const managementFee = 1_000;
  const confirmedTotal = itemsTotal + shippingFee + managementFee;

  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty,
        spareQty,
        itemsTotal,
        shippingFee,
        managementFee,
        finalTotal: confirmedTotal,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 60_000),
        answeredAt: now,
        answerNote: 'Case 일괄 삭제 혼합 결과 검증용 확정 견적입니다.',
        adminMemo: `[BOM 여정 10호 ${RUN_KEY}] bulk-delete fixture ${String(sequence)}`,
        confirmedShippingFee: shippingFee,
        confirmedManagementFee: managementFee,
        confirmedTotal,
      },
    });
    await tx.spBomQuoteItem.create({
      data: {
        quoteId: quote.id,
        rowIdx: 0,
        included: true,
        mpn: `E2E-BULK-DELETE-${String(sequence)}-${String(quote.id)}`,
        manufacturerName: 'E2E Components',
        description: `Smart BOM bulk deletion fixture ${String(sequence)}`,
        bomQty,
        orderQty,
        matchStatus: 'manual',
        selectionSource: 'admin',
        lineTotalKrw: itemsTotal,
        sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        selectedOffer: {
          offerKey: `manual:bulk-delete-${String(quote.id)}`,
          supplier: 'E2E Local Supplier',
          supplierSku: '',
          packaging: null,
          breakQty: orderQty,
          unitPrice,
          currency: 'KRW',
          unitPriceKrw: unitPrice,
          moq: 1,
          orderMultiple: 1,
          stock: orderQty + 100,
          priceBreaks: [{ qty: 1, price: unitPrice }],
          fetchedAt: now.toISOString(),
          pinned: true,
        },
      },
    });
    return {
      quoteId: String(quote.id),
      title: quote.title,
      orderAmount: Math.round(confirmedTotal * 1.1),
      appliedSetQty: setQty + spareQty,
    };
  });
}

async function getPreview(token: string, quote: SeededQuote): Promise<DeletePreview> {
  const response = await api(
    token,
    'GET',
    `/api/admin/bom-quotes/${quote.quoteId}/force-delete-preview`,
  );
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  const preview: DeletePreview | undefined = response.json?.data;
  if (preview === undefined) throw new Error(`Case #${quote.quoteId} 삭제 프리뷰가 없습니다`);
  expect(preview.case).toMatchObject({ id: quote.quoteId, title: quote.title });
  return preview;
}

async function countG5(sql: string, ...params: (string | number)[]): Promise<number> {
  const rows: CountRow[] = await getPrisma().$queryRawUnsafe(sql, ...params);
  return Number(rows[0]?.count ?? 0);
}

async function expectFocusInside(dialog: Locator, label: string): Promise<void> {
  await expect
    .poll(
      () => dialog.evaluate((element) => element.contains(document.activeElement)),
      { message: `${label} 모달 내부로 포커스가 이동해야 합니다` },
    )
    .toBe(true);
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 10호 — 일괄 삭제 혼합 성공·보호·경합', () => {
  const rp = createJourneyReport(
    'findings-bom-bulk-deletion',
    'BOM 여정 10호 일괄 삭제 혼합 성공·보호·경합 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let A = '';
  let ordinary: SeededQuote | null = null;
  let stale: SeededQuote | null = null;
  let retry: SeededQuote | null = null;
  let paid: SeededQuote | null = null;
  let shared: SeededQuote | null = null;
  let sharedSibling: SeededQuote | null = null;
  let paidOrderId: string | null = null;
  let sharedOrderId: string | null = null;
  let previewRoute = '';
  let previewRouteRegistered = false;
  let allowRetryPreview = false;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    if (previewRouteRegistered) await adminView.page.unroute(previewRoute).catch(() => undefined);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('J01. 혼합 Case 준비 → 진행현황 목록에서 정확히 5건 선택', async () => {
    ordinary = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-A] 일반 삭제 ${RUN_KEY}`,
      1,
    );
    stale = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-B] 실행 직전 변경 ${RUN_KEY}`,
      2,
    );
    retry = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-C] 프리뷰 재시도 ${RUN_KEY}`,
      3,
    );
    paid = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-D] 결제 강제 ${RUN_KEY}`,
      4,
    );
    shared = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-E1] 공유 주문 보호 ${RUN_KEY}`,
      5,
    );
    sharedSibling = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 10호-E2] 공유 주문 동반 ${RUN_KEY}`,
      6,
    );

    const placedPaid = await placeOrderFromBomQuote(customer, rp, {
      quoteId: paid.quoteId,
      step: 'J01',
      prefix: 'J01-bulk-paid',
      buyerName: 'e2eBOM일괄결제고객',
      expectedOrderAmount: paid.orderAmount,
      expectedAppliedSetQty: paid.appliedSetQty,
    });
    paidOrderId = placedPaid.odId;
    const paidResponse = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [placedPaid.odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paidResponse.status, JSON.stringify(paidResponse.json)).toBe(200);

    const placedShared = await placeBatchOrderFromBomQuotes(customer, rp, {
      quotes: [shared, sharedSibling].map((quote) => ({
        quoteId: quote.quoteId,
        title: quote.title,
        expectedOrderAmount: quote.orderAmount,
        expectedAppliedSetQty: quote.appliedSetQty,
      })),
      step: 'J01',
      prefix: 'J01-bulk-shared',
      buyerName: 'e2eBOM일괄공유보호고객',
    });
    sharedOrderId = placedShared.odId;
    ledger.push(
      `일괄 선택 ${ordinary.quoteId}, ${stale.quoteId}, ${retry.quoteId}, ${paid.quoteId}, ${shared.quoteId}`,
      `sp_bom_quote #${shared.quoteId} + #${sharedSibling.quoteId}(공유 주문 보호 보존 표본)`,
      `g5_shop_order ${placedShared.odId}(Case 2건 공유, 삭제하지 않음)`,
    );

    const page = adminView.page;
    previewRoute = `**/api/admin/bom-quotes/${retry.quoteId}/force-delete-preview`;
    await page.route(previewRoute, async (route) => {
      if (allowRetryPreview) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: true, data: {} }),
      });
    });
    previewRouteRegistered = true;

    await page.goto(`${BASE_URL}/app/admin/smartbom`, { waitUntil: 'domcontentloaded' });
    for (const quote of [ordinary, stale, retry, paid, shared]) {
      const row = page.getByRole('row').filter({ hasText: quote.title }).first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      await row.getByRole('checkbox').check();
    }
    await page.getByRole('button', { name: '선택 5건 영구 삭제', exact: true }).waitFor();
    await rp.shot(adminView, 'J01-five-cases-selected');
  }, 300_000);

  test('J02. 일부 프리뷰 실패 → 같은 레이어 재조회·모바일 영향 구분', async (ctx) => {
    if (retry === null) return ctx.skip();
    const page = adminView.page;
    const trigger = page.getByRole('button', { name: '선택 5건 영구 삭제', exact: true });
    await trigger.click();
    const impact = page.getByRole('alertdialog', {
      name: '선택한 SmartBOM Case 5건을 확인합니다',
      exact: true,
    });
    await impact.waitFor({ state: 'visible', timeout: 30_000 });
    await expectFocusInside(impact, '일괄 1차 영향 확인');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await impact.getByText('보호되거나 조회하지 못한 2건은 삭제하지 않고 목록에 남깁니다.', { exact: true }).waitFor();
    await impact.getByText(`Case #${retry.quoteId}`, { exact: true }).waitFor();

    const retryButton = impact.getByRole('button', { name: '삭제 영향 다시 확인', exact: true });
    await retryButton.waitFor({ state: 'visible' });
    allowRetryPreview = true;
    await retryButton.click();
    await impact.getByText('보호되거나 조회하지 못한 1건은 삭제하지 않고 목록에 남깁니다.', { exact: true }).waitFor();
    await impact.getByRole('button', { name: '삭제·강제 가능 4건 계속', exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '390px에서 일괄 삭제 레이어가 문서 전체 가로 스크롤을 만들면 안 됩니다',
    ).toBe(true);
    await rp.shot(adminView, 'J02-bulk-impact-mobile-390');
    await page.setViewportSize({ width: 1440, height: 900 });
    F('J02', 'obs', '개별 프리뷰 실패 1건을 같은 레이어에서 복구하고 보호·강제·삭제 가능 수를 다시 계산');
  }, 120_000);

  test('J03. 결제 강제 선택·재확인 → 한 Case를 stale로 만든 뒤 일괄 실행', async (ctx) => {
    if (stale === null) return ctx.skip();
    const page = adminView.page;
    const impact = page.getByRole('alertdialog', { name: '선택한 SmartBOM Case 5건을 확인합니다' });
    await impact.getByRole('button', { name: '삭제·강제 가능 4건 계속', exact: true }).click();
    const confirm = page.getByRole('alertdialog', {
      name: '선택한 Case 4건의 최종 삭제 대상을 확인합니다',
      exact: true,
    });
    await confirm.waitFor({ state: 'visible' });
    await expectFocusInside(confirm, '일괄 2차 최종 확인');
    await confirm.locator('textarea').fill(DELETE_REASON);
    const irreversible = confirm.getByRole('checkbox', { name: /외부 이메일·공급사 작업은 회수되지 않으며/ });
    await irreversible.check();
    await confirm.getByRole('button', { name: '3건 영구 삭제', exact: true }).waitFor();
    await confirm.getByRole('checkbox', { name: /결제 이력·주문 1건도 강제 삭제/ }).check();
    expect(await irreversible.isChecked(), '대상 범위 변경 시 기존 복구 불가 확인 무효화').toBe(false);
    await irreversible.check();
    await confirm.getByRole('button', { name: '4건 영구 삭제', exact: true }).waitFor();

    await getPrisma().spBomQuote.update({
      where: { id: BigInt(stale.quoteId) },
      data: { adminMemo: `[BOM 여정 10호 ${RUN_KEY}] 프리뷰 이후 실행 직전 변경` },
    });
    await confirm.getByRole('button', { name: '4건 영구 삭제', exact: true }).click();
  }, 120_000);

  test('J04. 부분 성공 결과 → 3건 삭제·stale 1건 실패·공유 1건 유지', async (ctx) => {
    if (stale === null) return ctx.skip();
    const page = adminView.page;
    const result = page.getByRole('dialog', { name: '3건 삭제 · 2건 유지', exact: true });
    await result.waitFor({ state: 'visible', timeout: 30_000 });
    await expectFocusInside(result, '일괄 삭제 결과');
    await result.getByText('실행 직전 검증·삭제 실패 1건', { exact: true }).waitFor();
    await result.getByText('처음부터 보호되거나 조회하지 못했거나 결제 강제 삭제를 선택하지 않은 1건은 삭제 대상에서 제외했습니다.', { exact: true }).waitFor();
    await result.getByText(/결제 주문 1건의 로컬 기록을 강제 삭제했습니다/).waitFor();
    await result.getByText(/삭제 영향이 변경되었습니다/).waitFor();

    const expectedStaleErrors = rp.httpErrors.filter(
      (entry) => entry.includes('관리자 409')
        && entry.includes(`/api/admin/bom-quotes/${stale?.quoteId ?? ''}/force-delete`),
    );
    expect(expectedStaleErrors, '의도한 stale Case 409 한 건').toHaveLength(1);
    const expectedIndex = rp.httpErrors.indexOf(expectedStaleErrors[0] ?? '');
    if (expectedIndex >= 0) rp.httpErrors.splice(expectedIndex, 1);
    await rp.shot(adminView, 'J04-bulk-partial-result');
    F('J04', 'obs', '일괄 작업이 성공 3건을 완료하면서 stale 1건과 공유 주문 1건을 결과에 분리해 유지');
  }, 90_000);

  test('J05. 목록 선택·DB·영카트 원장 → 삭제된 3건만 제거', async (ctx) => {
    if (
      ordinary === null
      || stale === null
      || retry === null
      || paid === null
      || shared === null
      || sharedSibling === null
      || paidOrderId === null
      || sharedOrderId === null
    ) return ctx.skip();
    const page = adminView.page;
    const result = page.getByRole('dialog', { name: '3건 삭제 · 2건 유지', exact: true });
    await result.getByRole('button', { name: '목록으로', exact: true }).click();
    const remainingTrigger = page.getByRole('button', { name: '선택 2건 영구 삭제', exact: true });
    await remainingTrigger.waitFor({ state: 'visible', timeout: 30_000 });
    await expect.poll(() => remainingTrigger.evaluate((element) => document.activeElement === element)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    for (const deleted of [ordinary, retry, paid]) {
      await expect.poll(() => page.getByText(deleted.title, { exact: true }).count()).toBe(0);
      expect(await getPrisma().spBomQuote.findUnique({
        where: { id: BigInt(deleted.quoteId) },
      })).toBeNull();
    }
    for (const retained of [stale, shared, sharedSibling]) {
      expect(await getPrisma().spBomQuote.findUnique({
        where: { id: BigInt(retained.quoteId) },
      })).not.toBeNull();
    }
    await page.getByText(stale.title, { exact: true }).waitFor();
    await page.getByText(shared.title, { exact: true }).waitFor();

    const audits = await getPrisma().spDeleteAudit.findMany({
      where: {
        subjectType: 'bom_case',
        subjectId: { in: [ordinary.quoteId, retry.quoteId, paid.quoteId, stale.quoteId, shared.quoteId] },
      },
      orderBy: { id: 'asc' },
    });
    expect(audits).toHaveLength(3);
    expect(new Set(audits.map((audit: { subjectId: string }) => audit.subjectId))).toEqual(
      new Set([ordinary.quoteId, retry.quoteId, paid.quoteId]),
    );
    expect(new Set(audits.map((audit: { reason: string }) => audit.reason))).toEqual(new Set([DELETE_REASON]));
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order WHERE od_id = ?', paidOrderId)).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order_delete WHERE de_key = ?', paidOrderId)).toBe(1);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order WHERE od_id = ?', sharedOrderId)).toBe(1);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_cart WHERE od_id = ?', sharedOrderId)).toBe(2);
    F('J05', 'obs', '목록 선택도 성공 ID 3건만 해제되고 감사·주문 백업과 보호 원장이 정확히 일치');
  }, 120_000);

  test('J06. 공유 주문만 다시 선택 → 실행 불가·Escape 복귀, stale 표본 정리', async (ctx) => {
    if (stale === null || shared === null) return ctx.skip();
    const page = adminView.page;
    const staleRow = page.getByRole('row').filter({ hasText: stale.title }).first();
    await staleRow.getByRole('checkbox').uncheck();
    const trigger = page.getByRole('button', { name: '선택 1건 영구 삭제', exact: true });
    await trigger.click();
    const impact = page.getByRole('alertdialog', {
      name: '선택한 SmartBOM Case 1건을 확인합니다',
      exact: true,
    });
    await impact.waitFor({ state: 'visible' });
    await expectFocusInside(impact, '보호 Case 영향 확인');
    expect(await impact.getByRole('button', { name: '삭제·강제 가능 0건 계속', exact: true }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape');
    await impact.waitFor({ state: 'detached' });
    await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);

    const preview = await getPreview(A, stale);
    const cleanup = await api(A, 'POST', `/api/admin/bom-quotes/${stale.quoteId}/force-delete`, {
      mode: 'reset',
      previewToken: preview.previewToken,
      acknowledgeIrreversible: true,
    });
    expect(cleanup.status, JSON.stringify(cleanup.json)).toBe(200);
    await page.unroute(previewRoute);
    previewRouteRegistered = false;
    F('J06', 'obs', '보호 Case만 선택하면 실행 CTA가 비활성이고 닫은 뒤 목록 트리거로 포커스가 복귀');
  }, 90_000);

  test('J07. 브라우저 오류·예상 밖 HTTP 오류 없이 일괄 안전 경계 완주', () => {
    expect(customer.pageErrors, '고객 pageerror').toEqual([]);
    expect(adminView.pageErrors, '관리자 pageerror').toEqual([]);
    expect(rp.httpErrors, '예상 stale 409를 제외한 관찰 화면 HTTP 오류').toEqual([]);
    expect(
      rp.findings.filter((finding) => finding.kind === 'bug' || finding.kind === 'blocker'),
      '수정 뒤 남은 확정 결함',
    ).toEqual([]);
    F('J07', 'obs', 'BOM 10호 완주 — 선택·프리뷰·부분 성공·목록·DB/G5 원장을 전 단계 교차 검증');
  });
});
