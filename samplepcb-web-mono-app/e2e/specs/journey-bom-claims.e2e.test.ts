// Smart BOM 완주 여정 11호 — 배송 후 고객 문제 접수 → 관리자 검토·해결.
//
// 1~10호가 주문·조달·물류·Case 삭제 경계를 검증했다면, 11호는 배송이 시작된 뒤의
// 고객 대응 원장을 검증한다. 접수 전 배송 게이트, 복수 부품·수량 스냅샷, 중복 접수와
// Case 삭제 차단, 관리자 순차 처리·낙관적 잠금, 고객 답변 확인을 실 UI/API/DB로 교차
// 확인한다. 주문 취소·환불·재발송은 자동 실행하지 않으며 생성물은 대장에 남긴다.
// 실행: pnpm -F e2e journey:bom:11
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  getPartner,
  getPrisma,
  newPhpSession,
  newSession,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const CLAIM_SUBJECT = `커넥터 누락 확인 요청 ${RUN_KEY}`;
const CLAIM_DESCRIPTION = '밀봉 포장을 개봉해 수량을 확인했으며 두 종류 부품의 일부가 누락되었습니다.';
const ADMIN_RESPONSE = '누락 수량을 확인했으며 대체품을 다음 영업일에 별도 발송하겠습니다.';

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  unitPrice: number;
}

interface SeededQuote {
  quoteId: string;
  title: string;
  orderAmount: number;
  appliedSetQty: number;
  lines: Array<SeedLine & { itemId: string }>;
}

interface ClaimDto {
  id: string;
  quoteId: string;
  odId: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  version: number;
  activeKey?: string | null;
  orderSnapshot: {
    odId: string;
    odStatus: string;
    ctStatus: string;
    settleCase: string;
    receiptPrice: number;
  };
  items: Array<{
    quoteItemId: string;
    mpn: string;
    orderedQty: number;
    affectedQty: number;
  }>;
  events: Array<{ action: string; toStatus: string }>;
  adminResponse: string | null;
  resolutionKind: string | null;
}

interface OrderDbRow {
  status: string;
  settleCase: string;
  receiptPrice: number | bigint | string;
  misu: number | bigint | string;
  cartPrice: number | bigint | string;
}

interface OrderSnapshot {
  status: string;
  settleCase: string;
  receiptPrice: number;
  misu: number;
  cartPrice: number;
}

interface DeletePreview {
  canDelete: boolean;
  blockers: string[];
  previewToken: string;
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

async function expectFocusInside(dialog: Locator, label: string): Promise<void> {
  await expect
    .poll(
      () => dialog.evaluate((element) => element.contains(document.activeElement)),
      { message: `${label} 모달 내부로 포커스가 이동해야 합니다` },
    )
    .toBe(true);
}

async function seedAnsweredQuote(mbId: string): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const setQty = 2;
  const spareQty = 1;
  const baseLines = [
    {
      mpn: `E2E-CLAIM-CONN-${RUN_KEY}`,
      manufacturerName: 'TE Connectivity',
      description: 'Board-to-wire connector claim fixture',
      bomQty: 2,
      orderQty: 2 * setQty + spareQty,
      unitPrice: 740,
    },
    {
      mpn: `E2E-CLAIM-REG-${RUN_KEY}`,
      manufacturerName: 'Texas Instruments',
      description: 'Linear regulator claim fixture',
      bomQty: 3,
      orderQty: 3 * setQty + spareQty,
      unitPrice: 520,
    },
  ] satisfies SeedLine[];
  const itemsTotal = baseLines.reduce((sum, line) => sum + line.orderQty * line.unitPrice, 0);
  const shippingFee = 3_000;
  const managementFee = 1_500;
  const confirmedTotal = itemsTotal + shippingFee + managementFee;

  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 11호] 배송 후 클레임 ${RUN_KEY}`,
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
        answerNote: '배송 후 고객 문제 접수와 순차 처리를 검증하는 확정 견적입니다.',
        adminMemo: `[BOM 여정 11호 ${RUN_KEY}] claim workflow fixture`,
        confirmedShippingFee: shippingFee,
        confirmedManagementFee: managementFee,
        confirmedTotal,
      },
    });
    const lines: SeededQuote['lines'] = [];
    for (const [index, line] of baseLines.entries()) {
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          bomQty: line.bomQty,
          orderQty: line.orderQty,
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: line.orderQty * line.unitPrice,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: {
            offerKey: `manual:claim-${String(quote.id)}-${String(index)}`,
            supplier: 'E2E Local Supplier',
            supplierSku: `CLAIM-${String(index + 1)}`,
            packaging: null,
            breakQty: line.orderQty,
            unitPrice: line.unitPrice,
            currency: 'KRW',
            unitPriceKrw: line.unitPrice,
            moq: 1,
            orderMultiple: 1,
            stock: line.orderQty + 100,
            priceBreaks: [{ qty: 1, price: line.unitPrice }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
      lines.push({ ...line, itemId: String(item.id) });
    }
    return {
      quoteId: String(quote.id),
      title: quote.title,
      orderAmount: Math.round(confirmedTotal * 1.1),
      appliedSetQty: setQty + spareQty,
      lines,
    };
  });
}

async function seedReceivedFulfillment(quote: SeededQuote): Promise<{ poId: string; shipmentId: string }> {
  const partner = await getPartner('협력2');
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.spBomPo.create({
      data: {
        quoteId: BigInt(quote.quoteId),
        partnerId: partner.id,
        status: 'closed',
        totalAmount: quote.lines.reduce((sum, line) => sum + line.orderQty * line.unitPrice, 0),
        currency: 'KRW',
        memo: `[BOM 여정 11호 ${RUN_KEY}] 선행 조달·입고 완료 fixture`,
        confirmedAt: now,
        closedAt: now,
        items: {
          create: quote.lines.map((line) => ({
            quoteItemId: BigInt(line.itemId),
            mpn: line.mpn,
            manufacturerName: line.manufacturerName,
            description: line.description,
            qty: line.orderQty,
            unitPrice: line.unitPrice,
            lineTotal: line.orderQty * line.unitPrice,
            moq: 1,
            stock: line.orderQty + 100,
          })),
        },
      },
      include: { items: true },
    });
    const shipment = await tx.spBomShipment.create({
      data: {
        poId: po.id,
        quoteId: BigInt(quote.quoteId),
        mode: 'domestic',
        status: 'delivered',
        carrier: 'E2E 국내택배',
        trackingNumber: `CLAIM-INBOUND-${RUN_KEY}`,
        shippedAt: new Date(now.getTime() - 60_000),
        receivedAt: now,
        receivedNote: `[BOM 여정 11호 ${RUN_KEY}] 전량 입고 확인`,
        completedAt: now,
      },
    });
    await tx.spBomShipmentPo.create({
      data: { shipmentId: shipment.id, poId: po.id },
    });
    await tx.spBomShipmentItem.createMany({
      data: po.items.map((item: { id: bigint; qty: number }) => ({
        shipmentId: shipment.id,
        poItemId: item.id,
        expectedQty: item.qty,
      })),
    });
    return { poId: String(po.id), shipmentId: String(shipment.id) };
  });
}

async function readOrderSnapshot(odId: string): Promise<OrderSnapshot> {
  const rows = await getPrisma().$queryRawUnsafe(
    `SELECT od_status AS status,
            od_settle_case AS settleCase,
            od_receipt_price AS receiptPrice,
            od_misu AS misu,
            od_cart_price AS cartPrice
       FROM g5_shop_order WHERE od_id = ?`,
    odId,
  ) as OrderDbRow[];
  const row = rows[0];
  if (row === undefined) throw new Error(`주문 ${odId}를 찾을 수 없습니다`);
  return {
    status: String(row.status),
    settleCase: String(row.settleCase),
    receiptPrice: Number(row.receiptPrice),
    misu: Number(row.misu),
    cartPrice: Number(row.cartPrice),
  };
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 11호 — 배송 후 클레임 접수·해결', () => {
  const rp = createJourneyReport(
    'findings-bom-claims',
    'BOM 여정 11호 배송 후 고객 문제 접수·관리자 해결 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let customerToken = '';
  let adminToken = '';
  let seeded: SeededQuote | null = null;
  let odId: string | null = null;
  let claimId: string | null = null;
  let pendingBefore = 0;
  let orderBeforeClaim: OrderSnapshot | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    customerToken = signJwt({ mbId: customer.mbId, ttlSec: 7_200 });
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    const pending = await api(
      adminToken,
      'GET',
      '/api/admin/bom-claims?page=1&pageSize=1&status=pending',
    );
    expect(pending.status, JSON.stringify(pending.json)).toBe(200);
    pendingBefore = Number(pending.json?.data?.counts?.pending ?? 0);
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K01. 주문·입금 전후 → 배송 전 고객 접수는 화면과 API에서 차단', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title})`);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'K01',
      prefix: 'K01-claim-order',
      buyerName: 'e2eBOM클레임고객',
      expectedOrderAmount: seeded.orderAmount,
      expectedAppliedSetQty: seeded.appliedSetQty,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId}(클레임 처리 불변 확인 대상)`);

    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);

    const eligibility = await api(
      customerToken,
      'GET',
      `/api/bom/quotes/${seeded.quoteId}/claims`,
    );
    expect(eligibility.status, JSON.stringify(eligibility.json)).toBe(200);
    expect(eligibility.json?.data?.eligibility).toMatchObject({
      canSubmit: false,
      reason: 'NOT_DELIVERED',
      activeClaimId: null,
    });
    const blocked = await api(
      customerToken,
      'POST',
      `/api/bom/quotes/${seeded.quoteId}/claims`,
      {
        kind: 'missing',
        subject: CLAIM_SUBJECT,
        description: CLAIM_DESCRIPTION,
        items: [{ quoteItemId: seeded.lines[0]?.itemId, affectedQty: 1 }],
        acknowledgeNoAutomaticRefund: true,
      },
    );
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('NOT_DELIVERED');

    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'K01-customer-before-delivery', [
      seeded.title,
      '배송 후 문제 접수',
      '배송이 시작된 뒤 누락·파손·오배송 문제를 접수할 수 있습니다.',
    ]);
    expect(await customer.page.getByRole('button', { name: '문제 접수', exact: true }).count()).toBe(0);
    F('K01', 'obs', '입금만 된 주문은 접수 안내는 보이되 문제 접수 버튼과 직접 API 모두 차단됨');
  }, 240_000);

  test('K02. 선행 조달·입고 → 배송·완료 상태에서 접수 자격 개방', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const fulfillment = await seedReceivedFulfillment(seeded);
    ledger.push(
      `sp_bom_po #${fulfillment.poId}(11호 선행 입고 fixture)`,
      `sp_bom_shipment #${fulfillment.shipmentId}(domestic received)`,
    );
    const shipped = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `CUSTOMER-CLAIM-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    const afterShipping = await api(
      customerToken,
      'GET',
      `/api/bom/quotes/${seeded.quoteId}/claims`,
    );
    expect(afterShipping.status, JSON.stringify(afterShipping.json)).toBe(200);
    expect(afterShipping.json?.data?.eligibility).toMatchObject({ canSubmit: true, reason: null });

    const completed = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    orderBeforeClaim = await readOrderSnapshot(odId);
    expect(orderBeforeClaim.status).toBe('완료');

    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'K02-customer-completed', [
      seeded.title,
      '완료',
      '배송 후 문제 접수',
      '문제 접수',
    ]);
    F('K02', 'obs', '배송 진입부터 자격이 열리고 완료 뒤에도 같은 주문·Case 기준으로 유지됨');
  }, 180_000);

  test('K03. 고객 390px UI → 두 부품·문제 수량을 명시해 접수', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/app/bom/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' });
    const panelTrigger = page.getByRole('button', { name: '주문·문제 접수', exact: true });
    await panelTrigger.waitFor({ state: 'visible', timeout: 30_000 });
    await panelTrigger.click();
    const supportPanel = page.getByRole('dialog', { name: 'BOM 주문 및 배송 후 지원', exact: true });
    await supportPanel.waitFor({ state: 'visible' });
    const trigger = supportPanel.getByRole('button', { name: '문제 접수', exact: true }).first();
    await trigger.waitFor({ state: 'visible', timeout: 30_000 });
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'BOM 부품 문제 접수', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await expectFocusInside(dialog, '고객 문제 접수');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await expect.poll(() => trigger.evaluate((element) => document.activeElement === element)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);

    await trigger.click();
    await dialog.waitFor({ state: 'visible' });
    const submit = dialog.getByRole('button', { name: '문제 접수', exact: true });
    expect(await submit.isDisabled(), '필수 입력 전 접수 버튼').toBe(true);
    const first = seeded.lines[0];
    const second = seeded.lines[1];
    if (first === undefined || second === undefined) throw new Error('클레임 fixture 품목이 없습니다');
    await dialog.getByRole('checkbox', { name: `${first.mpn} 문제 부품 선택` }).check();
    await dialog.getByLabel(`${first.mpn} 문제 수량`).fill('2');
    await dialog.getByRole('checkbox', { name: `${second.mpn} 문제 부품 선택` }).check();
    await dialog.getByLabel(`${second.mpn} 문제 수량`).fill('1');
    await dialog.getByLabel('제목').fill(CLAIM_SUBJECT);
    await dialog.getByLabel('상세 내용').fill(CLAIM_DESCRIPTION);
    await dialog.getByRole('checkbox', { name: /주문 취소·환불을 자동 처리하지 않으며/ }).check();
    expect(await submit.isEnabled()).toBe(true);

    const createWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/bom/quotes/${seeded?.quoteId ?? ''}/claims`),
      { timeout: 30_000 },
    );
    await submit.click();
    const createdResponse = await createWait;
    expect(createdResponse.status()).toBe(201);
    const createdJson = (await createdResponse.json()) as { data?: ClaimDto };
    const created = createdJson.data;
    if (created === undefined) throw new Error('생성된 클레임 응답이 없습니다');
    claimId = created.id;
    ledger.push(`sp_bom_claim #${claimId}(접수→검토→해결 원장)`);
    await dialog.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);
    await page.getByText(CLAIM_SUBJECT, { exact: true }).waitFor({ timeout: 30_000 });
    await page.getByText('접수됨', { exact: true }).waitFor();
    const claimPanel = supportPanel.locator('[aria-labelledby="bom-claim-panel-title"]');
    await expect.poll(
      () => claimPanel.evaluate((element) => document.activeElement === element),
      { message: '접수 버튼 제거 뒤 새 접수 상태 패널로 포커스가 이동해야 합니다' },
    ).toBe(true);
    await rp.shot(customer, 'K03-customer-claim-submitted-mobile');

    expect(created).toMatchObject({
      quoteId: seeded.quoteId,
      odId,
      status: 'open',
      version: 1,
      orderSnapshot: { odId, odStatus: '완료' },
      items: [
        { quoteItemId: first.itemId, mpn: first.mpn, orderedQty: first.orderQty, affectedQty: 2 },
        { quoteItemId: second.itemId, mpn: second.mpn, orderedQty: second.orderQty, affectedQty: 1 },
      ],
      events: [{ action: 'submitted', toStatus: 'open' }],
    });
    F('K03', 'obs', '390px 모달의 포커스·스크롤 잠금·필수 확인과 복수 품목 수량 스냅샷을 확인');
  }, 180_000);

  test('K04. 활성 접수 → 중복 접수와 결제 주문 Case 강제 삭제도 차단', async (ctx) => {
    if (seeded === null || claimId === null) return ctx.skip();
    const first = seeded.lines[0];
    if (first === undefined) throw new Error('클레임 fixture 품목이 없습니다');
    const duplicate = await api(
      customerToken,
      'POST',
      `/api/bom/quotes/${seeded.quoteId}/claims`,
      {
        kind: 'damaged',
        subject: `중복 접수 차단 ${RUN_KEY}`,
        description: '처리 중인 접수가 있는 동안 두 번째 접수를 만들지 않아야 합니다.',
        items: [{ quoteItemId: first.itemId, affectedQty: 1 }],
        acknowledgeNoAutomaticRefund: true,
      },
    );
    expect(duplicate.status, JSON.stringify(duplicate.json)).toBe(409);
    expect(duplicate.json?.error).toBe('ACTIVE_CLAIM');

    const previewResponse = await api(
      adminToken,
      'GET',
      `/api/admin/bom-quotes/${seeded.quoteId}/force-delete-preview`,
    );
    expect(previewResponse.status, JSON.stringify(previewResponse.json)).toBe(200);
    const preview: DeletePreview | undefined = previewResponse.json?.data;
    if (preview === undefined) throw new Error('클레임 Case 삭제 프리뷰가 없습니다');
    expect(preview.canDelete).toBe(false);
    expect(preview.blockers).toEqual(expect.arrayContaining(['PAID_ORDER', 'OPEN_CLAIM']));

    const bypass = await api(
      adminToken,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/force-delete`,
      {
        mode: 'reset',
        previewToken: preview.previewToken,
        acknowledgeIrreversible: true,
        forceDeletePaidOrder: true,
      },
    );
    expect(bypass.status, JSON.stringify(bypass.json)).toBe(409);
    expect(bypass.json?.error).toBe('DELETE_BLOCKED');
    expect(await getPrisma().spBomClaim.count({ where: { id: BigInt(claimId) } })).toBe(1);
    expect(await getPrisma().spBomQuote.count({ where: { id: BigInt(seeded.quoteId) } })).toBe(1);
    F('K04', 'obs', '활성 접수는 DB 유일키로 중복을 막고 결제 강제 플래그보다 높은 Case 보존 사유로 동작');
  });

  test('K05. 관리자 완료·클레임 큐 → 검토 시작과 stale 관리자 경합 방어', async (ctx) => {
    if (claimId === null) return ctx.skip();
    const pending = await api(
      adminToken,
      'GET',
      '/api/admin/bom-claims?page=1&pageSize=20&status=pending',
    );
    expect(pending.status, JSON.stringify(pending.json)).toBe(200);
    expect(Number(pending.json?.data?.counts?.pending)).toBe(pendingBefore + 1);

    const page = adminView.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/app/admin/smartbom/claims`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '완료·클레임', exact: true }).waitFor();
    await page.getByText(CLAIM_SUBJECT, { exact: true }).waitFor({ timeout: 30_000 });
    await page.getByText(`처리 필요 ${String(pendingBefore + 1)}건`, { exact: true }).waitFor();
    const trigger = page.getByRole('button', { name: `${CLAIM_SUBJECT} 클레임 상세 열기` });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: `클레임 #${claimId} 상세`, exact: true });
    await dialog.waitFor({ state: 'visible' });
    await expectFocusInside(dialog, '관리자 클레임 상세');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await dialog.getByText('1. 검토 시작', { exact: true }).waitFor();

    const reviewWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/admin/bom-claims/${claimId ?? ''}`),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: '검토 시작', exact: true }).click();
    expect((await reviewWait).status()).toBe(200);
    await dialog.getByText('2. 고객 답변 후 닫기', { exact: true }).waitFor({ timeout: 30_000 });
    await dialog.getByText('검토 중', { exact: true }).first().waitFor();

    const stale = await api(adminToken, 'PATCH', `/api/admin/bom-claims/${claimId}`, {
      action: 'resolve',
      expectedVersion: 1,
      resolutionKind: 'replacement',
      response: ADMIN_RESPONSE,
    });
    expect(stale.status, JSON.stringify(stale.json)).toBe(409);
    expect(stale.json?.error).toBe('STALE_CLAIM');
    const dbClaim = await getPrisma().spBomClaim.findUnique({ where: { id: BigInt(claimId) } });
    expect(dbClaim).toMatchObject({ status: 'reviewing', version: 2, activeKey: expect.any(String) });
    F('K05', 'obs', '관리자 큐에서 접수→검토 순서를 강제하고 이전 version 처리 요청은 409로 거부');
  }, 180_000);

  test('K06. 관리자 390px 상세 → 구체적 답변과 해결 방식으로 종료', async (ctx) => {
    if (claimId === null) return ctx.skip();
    const page = adminView.page;
    const dialog = page.getByRole('dialog', { name: `클레임 #${claimId} 상세`, exact: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.waitFor({ state: 'visible' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const partsScroll = dialog.locator('table').locator('..');
    expect(
      await partsScroll.evaluate((element) => element.scrollWidth > element.clientWidth),
      '작은 화면 문제 부품 표의 내부 가로 스크롤',
    ).toBe(true);
    await dialog.getByLabel('해결 방식').selectOption('replacement');
    await dialog.getByLabel('고객 답변').fill(ADMIN_RESPONSE);

    const resolveWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/admin/bom-claims/${claimId ?? ''}`),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: '해결 완료', exact: true }).click();
    expect((await resolveWait).status()).toBe(200);
    await dialog.getByText('해결 완료', { exact: true }).first().waitFor({ timeout: 30_000 });
    await dialog.getByText('최종 답변 · 대체품 발송', { exact: true }).waitFor();
    await dialog.getByText(ADMIN_RESPONSE, { exact: true }).last().waitFor();
    await rp.shot(adminView, 'K06-admin-claim-resolved-mobile');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    const pending = await api(
      adminToken,
      'GET',
      '/api/admin/bom-claims?page=1&pageSize=1&status=pending',
    );
    expect(pending.status, JSON.stringify(pending.json)).toBe(200);
    expect(Number(pending.json?.data?.counts?.pending)).toBe(pendingBefore);
    const dbClaim = await getPrisma().spBomClaim.findUnique({
      where: { id: BigInt(claimId) },
      include: { items: true, events: { orderBy: { id: 'asc' } } },
    });
    expect(dbClaim).toMatchObject({
      status: 'resolved',
      version: 3,
      activeKey: null,
      adminMbId: 'e2e-admin',
      adminResponse: ADMIN_RESPONSE,
      resolutionKind: 'replacement',
    });
    expect(dbClaim?.events.map((event: { action: string }) => event.action)).toEqual([
      'submitted',
      'review_started',
      'resolved',
    ]);
    expect(dbClaim?.closedAt).not.toBeNull();
    F('K06', 'obs', '390px에서도 외부 body는 넘치지 않고 부품 표만 이동하며 3단계 감사 이벤트로 종료됨');
  }, 180_000);

  test('K07. 고객 최종 답변 확인 → 주문 불변·다음 접수 자격·오류 0건', async (ctx) => {
    if (seeded === null || odId === null || claimId === null || orderBeforeClaim === null) {
      return ctx.skip();
    }
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/app/bom/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' });
    const panelTrigger = page.getByRole('button', { name: '주문·문제 접수', exact: true });
    await panelTrigger.waitFor({ state: 'visible', timeout: 30_000 });
    await panelTrigger.click();
    const supportPanel = page.getByRole('dialog', { name: 'BOM 주문 및 배송 후 지원', exact: true });
    await supportPanel.getByText(CLAIM_SUBJECT, { exact: true }).waitFor({ timeout: 30_000 });
    await supportPanel.getByText('해결 완료', { exact: true }).waitFor();
    await supportPanel.getByText('담당자 답변 · 대체품 발송', { exact: true }).waitFor();
    await supportPanel.getByText(ADMIN_RESPONSE, { exact: true }).waitFor();
    await supportPanel.getByText('처리 이력 3건', { exact: true }).waitFor();
    await supportPanel.getByRole('button', { name: '문제 접수', exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await rp.shot(customer, 'K07-customer-claim-resolved-mobile');

    const history = await api(
      customerToken,
      'GET',
      `/api/bom/quotes/${seeded.quoteId}/claims`,
    );
    expect(history.status, JSON.stringify(history.json)).toBe(200);
    expect(history.json?.data?.eligibility).toMatchObject({
      canSubmit: true,
      reason: null,
      activeClaimId: null,
    });
    const claim: ClaimDto | undefined = history.json?.data?.claims?.[0];
    expect(claim).toMatchObject({
      id: claimId,
      status: 'resolved',
      version: 3,
      adminResponse: ADMIN_RESPONSE,
      resolutionKind: 'replacement',
    });

    const orderAfterClaim = await readOrderSnapshot(odId);
    expect(orderAfterClaim, '클레임 접수·처리는 영카트 주문/결제 상태를 바꾸지 않음').toEqual(
      orderBeforeClaim,
    );
    const quote = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(seeded.quoteId) },
      select: { status: true, ctId: true, confirmedTotal: true },
    });
    expect(quote).toMatchObject({ status: 'answered', confirmedTotal: expect.any(Number) });
    expect(quote?.ctId).not.toBeNull();

    const previewResponse = await api(
      adminToken,
      'GET',
      `/api/admin/bom-quotes/${seeded.quoteId}/force-delete-preview`,
    );
    expect(previewResponse.status, JSON.stringify(previewResponse.json)).toBe(200);
    const preview: DeletePreview | undefined = previewResponse.json?.data;
    expect(preview?.blockers).toContain('PAID_ORDER');
    expect(preview?.blockers).not.toContain('OPEN_CLAIM');

    expect(rp.httpErrors, '브라우저 HTTP 4xx/5xx').toHaveLength(0);
    expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
    expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
    F(
      'K07',
      'obs',
      `BOM 11호 완주 — claim=${claimId}, order=${odId} 불변, 해결 뒤 다음 접수 자격 재개`,
    );
  }, 180_000);
});
