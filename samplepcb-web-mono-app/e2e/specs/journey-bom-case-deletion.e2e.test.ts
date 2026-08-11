// Smart BOM 완주 여정 9호 — Case 영구 삭제·초기화 안전 경계.
//
// 삭제는 성공 경로보다 오삭제 방지가 더 중요하다. 이 스펙은 실행 중 만든 Case만 대상으로
// audited/reset 차이, 단독 미입금·결제 주문의 로컬 정리, 공유 주문의 절대 차단,
// 프리뷰 이후 변경 감지를 실 UI/API/DB로 교차 검증한다. 공유 주문 차단 표본은 보호 검증을
// 위해 그대로 남기고, 나머지 표본은 제품 삭제 경로 자체로 정리한다.
// 실행: pnpm -F e2e journey:bom:9
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

interface SeededQuote {
  quoteId: string;
  title: string;
  orderAmount: number;
  appliedSetQty: number;
}

interface DeletePreview {
  case: { id: string; title: string };
  impact: { quoteItems: number };
  order: {
    action: 'none' | 'remove-cart-row' | 'delete-unpaid-order' | 'delete-paid-order';
    odId: string | null;
    paymentProtected: boolean;
    siblingCount: number;
  };
  canDelete: boolean;
  blockers: string[];
  warnings: string[];
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

async function seedAnsweredQuote(mbId: string, title: string): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const setQty = 2;
  const spareQty = 1;
  const bomQty = 3;
  const orderQty = bomQty * setQty + spareQty;
  const unitPrice = 540;
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
        answerNote: 'Case 삭제 안전 경계 검증용 확정 견적입니다.',
        adminMemo: `[BOM 여정 9호 ${RUN_KEY}] delete-boundary fixture`,
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
        mpn: `E2E-DELETE-${String(quote.id)}`,
        manufacturerName: 'E2E Components',
        description: 'Smart BOM case deletion boundary fixture',
        bomQty,
        orderQty,
        matchStatus: 'manual',
        selectionSource: 'admin',
        lineTotalKrw: itemsTotal,
        sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        selectedOffer: {
          offerKey: `manual:delete-${String(quote.id)}`,
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

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 9호 — Case 영구 삭제·초기화 안전 경계', () => {
  const rp = createJourneyReport(
    'findings-bom-case-deletion',
    'BOM 여정 9호 Case 영구 삭제·초기화 안전 경계 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let A = '';

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
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('I01. 일반 Case → 영향 확인·감사 사유를 거쳐 audited 영구 삭제', async () => {
    const quote = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-A] 감사 삭제 ${RUN_KEY}`,
    );
    const prisma = getPrisma();
    const page = adminView.page;
    ledger.push(`sp_bom_quote #${quote.quoteId}(${quote.title}, audited 삭제 표본)`);

    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quote.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    const trigger = page.getByRole('button', { name: 'Case 강제 영구 삭제', exact: true });
    await trigger.waitFor({ state: 'visible', timeout: 30_000 });
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    await trigger.click();

    const impact = page.getByRole('alertdialog', {
      name: 'SmartBOM Case를 영구 삭제합니다',
      exact: true,
    });
    await impact.waitFor({ state: 'visible', timeout: 30_000 });
    await impact.getByText(quote.title, { exact: true }).waitFor();
    await expectFocusInside(impact, '1차 영향 확인');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await rp.shot(adminView, 'I01-audited-impact');

    await impact.getByRole('button', { name: '강제 삭제 계속', exact: true }).click();
    const confirm = page.getByRole('alertdialog', {
      name: '되돌릴 수 없는 영구 삭제입니다',
      exact: true,
    });
    await confirm.waitFor({ state: 'visible' });
    await expectFocusInside(confirm, '2차 최종 확인');
    await confirm.locator('textarea').fill(`[BOM 여정 9호 ${RUN_KEY}] 테스트 일반 Case 정리`);
    await confirm.getByRole('checkbox', { name: /외부 이메일·공급사 작업은 회수되지 않으며/ }).check();
    await confirm.getByRole('button', { name: 'Case 영구 삭제', exact: true }).click();

    const result = page.getByRole('dialog', {
      name: 'SmartBOM Case가 영구 삭제되었습니다',
      exact: true,
    });
    await result.waitFor({ state: 'visible', timeout: 30_000 });
    await expectFocusInside(result, '삭제 결과');
    await result.getByText('관리자·사유·삭제 영향의 최소 감사기록을 보존했습니다.', { exact: true }).waitFor();
    await result.getByRole('button', { name: 'Case 목록으로', exact: true }).click();
    await page.waitForURL('**/app/admin/smartbom');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);

    expect(await prisma.spBomQuote.findUnique({ where: { id: BigInt(quote.quoteId) } })).toBeNull();
    const audits = await prisma.spDeleteAudit.findMany({
      where: { subjectType: 'bom_case', subjectId: quote.quoteId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      title: quote.title,
      mbId: customer.mbId,
      actorMbId: 'e2e-admin',
      reason: `[BOM 여정 9호 ${RUN_KEY}] 테스트 일반 Case 정리`,
    });
    expect(audits[0]?.snapshot).toMatchObject({ impact: { quoteItems: 1 } });
    F('I01', 'obs', '2단계 UI 확인 뒤 Case는 사라지고 관리자·사유·영향 감사행 1건만 보존됨');
  }, 120_000);

  test('I02. 단독 미입금 주문 Case → 감사·영카트 백업 없는 reset', async () => {
    const quote = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-B] 미입금 초기화 ${RUN_KEY}`,
    );
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: quote.quoteId,
      step: 'I02',
      prefix: 'I02-unpaid-reset',
      buyerName: 'e2eBOM초기화고객',
      expectedOrderAmount: quote.orderAmount,
      expectedAppliedSetQty: quote.appliedSetQty,
    });
    const preview = await getPreview(A, quote);
    expect(preview).toMatchObject({
      canDelete: true,
      blockers: [],
      order: {
        action: 'delete-unpaid-order',
        odId: placed.odId,
        paymentProtected: false,
        siblingCount: 0,
      },
    });
    expect(preview.warnings).toContain('UNPAID_ORDER_DELETED');
    ledger.push(`g5_shop_order ${placed.odId}(reset 경로로 삭제)`);

    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quote.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'Case 강제 영구 삭제', exact: true }).click();
    const impact = page.getByRole('alertdialog', { name: 'SmartBOM Case를 영구 삭제합니다' });
    await impact.getByText('단독 미입금 주문과 연결 장바구니 행을 함께 삭제합니다.', { exact: true }).waitFor();
    await impact.getByRole('button', { name: '강제 삭제 계속', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: '되돌릴 수 없는 영구 삭제입니다' });
    await confirm.getByRole('checkbox', { name: /삭제 감사기록도 남기지 않음/ }).check();
    await confirm.getByRole('checkbox', { name: /외부 이메일·공급사 작업은 회수되지 않으며/ }).check();
    await confirm.getByRole('button', { name: '기록 없이 관련 데이터 영구 삭제', exact: true }).click();
    const result = page.getByRole('dialog', { name: 'SmartBOM Case가 영구 삭제되었습니다' });
    await result.getByText('요청대로 SmartBOM 삭제 감사기록을 남기지 않았습니다.', { exact: true }).waitFor();
    await result.getByRole('button', { name: 'Case 목록으로', exact: true }).click();

    const prisma = getPrisma();
    expect(await prisma.spBomQuote.findUnique({ where: { id: BigInt(quote.quoteId) } })).toBeNull();
    expect(await prisma.spDeleteAudit.count({
      where: { subjectType: 'bom_case', subjectId: quote.quoteId },
    })).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order WHERE od_id = ?', placed.odId)).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_cart WHERE od_id = ?', placed.odId)).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order_delete WHERE de_key = ?', placed.odId)).toBe(0);
    F('I02', 'obs', 'reset은 단독 미입금 주문·cart·Case를 지우되 두 감사 원장을 모두 남기지 않음');
  }, 240_000);

  test('I03. 단독 결제 주문 Case → 명시적 강제 확인 뒤 audited 삭제', async () => {
    const quote = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-C] 결제 주문 강제 삭제 ${RUN_KEY}`,
    );
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: quote.quoteId,
      step: 'I03',
      prefix: 'I03-paid-audited',
      buyerName: 'e2eBOM결제삭제고객',
      expectedOrderAmount: quote.orderAmount,
      expectedAppliedSetQty: quote.appliedSetQty,
    });
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [placed.odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);

    const preview = await getPreview(A, quote);
    expect(preview).toMatchObject({
      canDelete: false,
      blockers: ['PAID_ORDER'],
      order: {
        action: 'delete-paid-order',
        odId: placed.odId,
        paymentProtected: true,
        siblingCount: 0,
      },
    });
    expect(preview.warnings).toContain('PAID_ORDER_PERMANENTLY_DELETED');
    ledger.push(`g5_shop_order ${placed.odId}(paid audited 강제 삭제)`);

    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quote.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'Case 강제 영구 삭제', exact: true }).click();
    const impact = page.getByRole('alertdialog', { name: 'SmartBOM Case를 영구 삭제합니다' });
    await impact.getByText('결제 주문 강제 삭제 확인이 필요합니다', { exact: true }).waitFor();
    await impact.getByRole('button', { name: '결제 주문 강제 삭제 확인', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: '되돌릴 수 없는 영구 삭제입니다' });
    const submit = confirm.getByRole('button', { name: 'Case 영구 삭제', exact: true });
    await confirm.locator('textarea').fill(`[BOM 여정 9호 ${RUN_KEY}] 결제 주문 로컬 정리`);
    const irreversible = confirm.getByRole('checkbox', { name: /외부 이메일·공급사 작업은 회수되지 않으며/ });
    await irreversible.check();
    expect(await submit.isDisabled(), '결제 주문 강제 확인 전 제출 차단').toBe(true);
    await confirm.getByRole('checkbox', { name: /결제 이력·주문까지 강제 삭제/ }).check();
    expect(await irreversible.isChecked(), '위험 조건 변경 시 기존 복구 불가 확인을 무효화').toBe(false);
    expect(await submit.isDisabled()).toBe(true);
    await irreversible.check();
    expect(await submit.isEnabled()).toBe(true);
    await submit.click();

    const result = page.getByRole('dialog', { name: 'SmartBOM Case가 영구 삭제되었습니다' });
    await result.getByText(/로컬 결제 주문 기록을 강제 삭제했습니다/).waitFor({ timeout: 30_000 });
    await result.getByRole('button', { name: 'Case 목록으로', exact: true }).click();

    const prisma = getPrisma();
    expect(await prisma.spBomQuote.findUnique({ where: { id: BigInt(quote.quoteId) } })).toBeNull();
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order WHERE od_id = ?', placed.odId)).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_cart WHERE od_id = ?', placed.odId)).toBe(0);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order_delete WHERE de_key = ?', placed.odId)).toBe(1);
    const audit = await prisma.spDeleteAudit.findFirst({
      where: { subjectType: 'bom_case', subjectId: quote.quoteId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.snapshot).toMatchObject({
      forceDeletePaidOrder: true,
      order: { action: 'delete-paid-order', odId: placed.odId },
    });
    F('I03', 'obs', '결제 주문은 별도 체크 전 제출 불가, 강제 후 주문 백업·SmartBOM 감사행을 각각 1건 보존');
  }, 240_000);

  test('I04. Case 2건 공유 주문 → UI와 직접 API 모두 영구 삭제 차단', async () => {
    const quoteA = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-D1] 공유 주문 보호 ${RUN_KEY}`,
    );
    const quoteB = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-D2] 공유 주문 보호 ${RUN_KEY}`,
    );
    const placed = await placeBatchOrderFromBomQuotes(customer, rp, {
      quotes: [quoteA, quoteB].map((quote) => ({
        quoteId: quote.quoteId,
        title: quote.title,
        expectedOrderAmount: quote.orderAmount,
        expectedAppliedSetQty: quote.appliedSetQty,
      })),
      step: 'I04',
      prefix: 'I04-shared-order-protection',
      buyerName: 'e2eBOM공유주문보호고객',
    });
    const preview = await getPreview(A, quoteA);
    expect(preview).toMatchObject({
      canDelete: false,
      blockers: ['SHARED_ORDER'],
      order: { odId: placed.odId, siblingCount: 1 },
    });
    ledger.push(
      `sp_bom_quote #${quoteA.quoteId} + #${quoteB.quoteId}(공유 주문 차단 보존 표본)`,
      `g5_shop_order ${placed.odId}(Case 2건 공유, 삭제하지 않음)`,
    );

    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteA.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    const trigger = page.getByRole('button', { name: 'Case 강제 영구 삭제', exact: true });
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    await trigger.click();
    const impact = page.getByRole('alertdialog', { name: 'SmartBOM Case를 영구 삭제합니다' });
    await impact.getByText('이 Case는 영구 삭제할 수 없습니다', { exact: true }).waitFor();
    expect(await impact.getByRole('button', { name: '강제 삭제 계속', exact: true }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape');
    await impact.waitFor({ state: 'detached' });
    await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);

    const bypass = await api(A, 'POST', `/api/admin/bom-quotes/${quoteA.quoteId}/force-delete`, {
      mode: 'reset',
      previewToken: preview.previewToken,
      acknowledgeIrreversible: true,
      forceDeletePaidOrder: true,
    });
    expect(bypass.status, JSON.stringify(bypass.json)).toBe(409);
    expect(bypass.json).toMatchObject({ error: 'DELETE_BLOCKED' });
    expect(await getPrisma().spBomQuote.count({
      where: { id: { in: [BigInt(quoteA.quoteId), BigInt(quoteB.quoteId)] } },
    })).toBe(2);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_order WHERE od_id = ?', placed.odId)).toBe(1);
    expect(await countG5('SELECT COUNT(*) AS count FROM g5_shop_cart WHERE od_id = ?', placed.odId)).toBe(2);
    F('I04', 'obs', '공유 주문은 결제 강제 플래그를 보내도 UI·서버 양쪽에서 차단되고 두 Case와 주문이 불변');
  }, 240_000);

  test('I05. 프리뷰 뒤 Case 변경 → 오래된 토큰을 거부하고 최신 토큰만 허용', async () => {
    const quote = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-E] 프리뷰 경합 ${RUN_KEY}`,
    );
    const stalePreview = await getPreview(A, quote);
    await getPrisma().spBomQuote.update({
      where: { id: BigInt(quote.quoteId) },
      data: { adminMemo: `[BOM 여정 9호 ${RUN_KEY}] preview 이후 변경` },
    });

    const staleDelete = await api(A, 'POST', `/api/admin/bom-quotes/${quote.quoteId}/force-delete`, {
      mode: 'reset',
      previewToken: stalePreview.previewToken,
      acknowledgeIrreversible: true,
    });
    expect(staleDelete.status, JSON.stringify(staleDelete.json)).toBe(409);
    expect(staleDelete.json).toMatchObject({ error: 'STALE_PREVIEW' });
    expect(await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quote.quoteId) },
    })).not.toBeNull();

    const freshPreview = await getPreview(A, quote);
    expect(freshPreview.previewToken).not.toBe(stalePreview.previewToken);
    const deleted = await api(A, 'POST', `/api/admin/bom-quotes/${quote.quoteId}/force-delete`, {
      mode: 'reset',
      previewToken: freshPreview.previewToken,
      acknowledgeIrreversible: true,
    });
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200);
    expect(deleted.json?.data).toMatchObject({ caseId: quote.quoteId, mode: 'reset' });
    expect(await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quote.quoteId) },
    })).toBeNull();
    F('I05', 'obs', 'Case updatedAt이 바뀌면 같은 영향 개수여도 오래된 SHA-256 프리뷰 토큰을 거부');
  }, 90_000);

  test('I06. 영향 조회 실패 → 명시적 재시도·390px 안전 표시·포커스 복귀', async () => {
    const quote = await seedAnsweredQuote(
      customer.mbId,
      `[BOM 여정 9호-F] 프리뷰 재시도 ${RUN_KEY}`,
    );
    const page = adminView.page;
    await page.setViewportSize({ width: 390, height: 844 });
    const previewRoute = `**/api/admin/bom-quotes/${quote.quoteId}/force-delete-preview`;
    let allowRealPreview = false;
    await page.route(previewRoute, async (route) => {
      if (allowRealPreview) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: true, data: {} }),
      });
    });

    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quote.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    const trigger = page.getByRole('button', { name: 'Case 강제 영구 삭제', exact: true });
    await trigger.click();
    const impact = page.getByRole('alertdialog', { name: 'SmartBOM Case를 영구 삭제합니다' });
    await impact.getByRole('alert').waitFor({ timeout: 30_000 });
    const retry = impact.getByRole('button', { name: '삭제 영향 다시 확인', exact: true });
    await retry.waitFor({ state: 'visible' });
    allowRealPreview = true;
    await retry.click();
    await impact.getByText(quote.title, { exact: true }).waitFor({ timeout: 30_000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '390px에서 삭제 레이어가 문서 전체 가로 스크롤을 만들면 안 됩니다',
    ).toBe(true);
    await rp.shot(adminView, 'I06-delete-preview-mobile-390');
    await impact.getByRole('button', { name: '취소', exact: true }).click();
    await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);
    await page.unroute(previewRoute);
    await page.setViewportSize({ width: 1440, height: 900 });

    const preview = await getPreview(A, quote);
    const cleanup = await api(A, 'POST', `/api/admin/bom-quotes/${quote.quoteId}/force-delete`, {
      mode: 'reset',
      previewToken: preview.previewToken,
      acknowledgeIrreversible: true,
    });
    expect(cleanup.status, JSON.stringify(cleanup.json)).toBe(200);
    F('I06', 'obs', '실패 메시지에서 실제 재조회 가능, 모바일 가로 넘침 없음, 취소 뒤 위험구역 버튼으로 포커스 복귀');
  }, 120_000);

  test('I07. 브라우저 오류·예상 밖 HTTP 오류 없이 안전 경계 완주', () => {
    expect(customer.pageErrors, '고객 pageerror').toEqual([]);
    expect(adminView.pageErrors, '관리자 pageerror').toEqual([]);
    expect(rp.httpErrors, '관찰 화면 HTTP 오류').toEqual([]);
    expect(
      rp.findings.filter((finding) => finding.kind === 'bug' || finding.kind === 'blocker'),
      '수정 뒤 남은 확정 결함',
    ).toEqual([]);
    F('I07', 'obs', 'BOM 9호 완주 — 삭제 대상 식별·프리뷰·2차 확인·DB 결과를 전 단계 교차 검증');
  });
});
