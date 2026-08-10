// Smart BOM 완주 여정 4호 — 확정 견적 2건 묶음 주문 → 한 Case만 미입금 취소 →
// 잔여 Case 결제·발주 → 취소 Case 재주문·결제·발주 → 한 박스 입고 → 두 주문 배송 완료.
//
// 1~3호가 견적 생성·선정·정정의 상류를 다루므로, 4호는 서로 다른 부품 예시를 가진
// answered Case 2건을 거래 스냅샷으로 준비하고 주문 이후의 상태 경계를 깊게 검증한다.
// 핵심 정본은 주문 헤더가 아니라 BOM 카트행이다. 과거 취소행은 재주문·배송 뒤에도
// 불변 감사 원장으로 남고, 발주·입고·배송 큐에는 최신 활성 주문 시도만 참여해야 한다.
//
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-reorder.md 대장으로 확인한 뒤
// 수동 정리한다. 실행: pnpm -F e2e journey:bom:4
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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
  mailpitList,
  newPhpSession,
  newSession,
  num,
  placeBatchOrderFromBomQuotes,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const PARTNER_NAME = '협력1';
const RUN_KEY = String(Date.now());
const CANCEL_REASON = `[BOM 여정 4호 ${RUN_KEY}] 고객 요청으로 결제 전 일부 취소`;

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  unitPrice: number;
}

interface SeedQuoteInput {
  title: string;
  setQty: number;
  spareQty: number;
  shippingFee: number;
  managementFee: number;
  lines: SeedLine[];
}

interface SeededQuote {
  quoteId: string;
  title: string;
  confirmedTotal: number;
  orderAmount: number;
  rfqId: number;
  itemIds: string[];
}

interface CartRow {
  ctId: bigint | number;
  ioId: string;
  odId: bigint | string;
  ctStatus: string;
  ioPrice: bigint | number;
  ctHistory: string;
}

interface OrderRow {
  odStatus: string;
  cartPrice: bigint | number;
  cancelPrice: bigint | number;
  receiptPrice: bigint | number;
  misu: bigint | number;
  modHistory: string;
}

interface AdminOrderCase {
  quoteId: string;
  ctId: number;
  ctStatus: string;
  isCurrentAttempt: boolean;
  isCanceled: boolean;
  poCount: number;
  poReceivedCount: number;
}

interface AdminOrderItem {
  odId: string;
  orderPrice: number;
  cancelPrice: number;
  isPaid: boolean;
  cases: AdminOrderCase[];
}

interface AdminOrderData {
  items: AdminOrderItem[];
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
}

interface PoRow {
  poId: number;
  partnerId: number;
  status: string;
  items: PoItem[];
}

interface PoCreateData {
  created: number;
  pos: PoRow[];
}

interface ShipmentCreateData {
  shipmentId: number;
  primaryPoId: number;
  mode: string;
  status: string;
}

interface PackingListItem {
  poItemId: number;
  expectedQty: number;
}

interface PackingListData {
  editable: boolean;
  items: PackingListItem[];
}

const capabilityList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

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

async function readCartRows(ioIds: string[]): Promise<CartRow[]> {
  if (ioIds.length === 0) return [];
  const rows: CartRow[] = await getPrisma().$queryRawUnsafe(
    `SELECT ct_id AS ctId, io_id AS ioId, od_id AS odId, ct_status AS ctStatus,
            io_price AS ioPrice, ct_history AS ctHistory
       FROM g5_shop_cart
      WHERE io_id IN (${ioIds.map(() => '?').join(',')})
      ORDER BY ct_id ASC`,
    ...ioIds,
  );
  return rows;
}

async function readOrder(odId: string): Promise<OrderRow | null> {
  const rows: OrderRow[] = await getPrisma().$queryRawUnsafe(
    `SELECT od_status AS odStatus, od_cart_price AS cartPrice,
            od_cancel_price AS cancelPrice, od_receipt_price AS receiptPrice,
            od_misu AS misu, od_mod_history AS modHistory
       FROM g5_shop_order WHERE od_id = ?`,
    odId,
  );
  return rows[0] ?? null;
}

async function seedAnsweredQuote(
  mbId: string,
  partnerId: bigint,
  partnerName: string,
  input: SeedQuoteInput,
): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const itemsTotal = input.lines.reduce(
    (sum, line) => sum + line.unitPrice * line.orderQty,
    0,
  );
  const confirmedTotal = itemsTotal + input.shippingFee + input.managementFee;

  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: input.title,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: input.setQty,
        spareQty: input.spareQty,
        itemsTotal,
        shippingFee: input.shippingFee,
        managementFee: input.managementFee,
        finalTotal: confirmedTotal,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 60_000),
        answeredAt: now,
        answerNote: '재고·납기를 확인한 테스트 확정 견적입니다.',
        adminMemo: `[BOM 여정 4호 ${RUN_KEY}] downstream fixture`,
        confirmedShippingFee: input.shippingFee,
        confirmedManagementFee: input.managementFee,
        confirmedTotal,
      },
    });
    const rfq = await tx.spBomRfq.create({
      data: {
        quoteId: quote.id,
        partnerId,
        status: 'closed',
        totalAmount: itemsTotal,
        currency: 'KRW',
        deliveryDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
        memo: `[BOM 여정 4호 ${RUN_KEY}] 선정 회신 스냅샷`,
        requestedAt: new Date(now.getTime() - 120_000),
        respondedAt: new Date(now.getTime() - 90_000),
      },
    });
    const itemIds: string[] = [];
    for (const [index, line] of input.lines.entries()) {
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
          selectionSource: 'partner',
          lineTotalKrw: line.unitPrice * line.orderQty,
          sourceRow: {
            quantityConfirmed: true,
            procurementDisposition: 'included',
          },
        },
      });
      const rfqItem = await tx.spBomRfqItem.create({
        data: {
          rfqId: rfq.id,
          quoteItemId: item.id,
          source: 'manual',
          unitPrice: line.unitPrice,
          currency: 'KRW',
          replyQty: line.orderQty,
          stock: line.orderQty + 100,
          dateCode: index % 2 === 0 ? '25+' : '24+',
          leadTime: index % 2 === 0 ? '재고 보유' : '5영업일',
          memo: `${line.mpn} 선정 회신`,
        },
      });
      await tx.spBomQuoteItem.update({
        where: { id: item.id },
        data: {
          selectedRfqItemId: rfqItem.id,
          selectedOffer: {
            offerKey: `rfq:${String(rfqItem.id)}`,
            supplier: partnerName,
            supplierSku: '',
            packaging: null,
            breakQty: line.orderQty,
            unitPrice: line.unitPrice,
            currency: 'KRW',
            unitPriceKrw: line.unitPrice,
            moq: null,
            orderMultiple: null,
            stock: line.orderQty + 100,
            priceBreaks: [{ qty: 1, price: line.unitPrice }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
      itemIds.push(String(item.id));
    }
    await tx.spBomRfq.update({
      where: { id: rfq.id },
      data: { requestedItemIds: itemIds },
    });
    return {
      quoteId: String(quote.id),
      title: quote.title,
      confirmedTotal,
      orderAmount: Math.round(confirmedTotal * 1.1),
      rfqId: Number(rfq.id),
      itemIds,
    };
  });
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 4호 — 부분취소 → 재주문 → 조달 완료', () => {
  const rp = createJourneyReport(
    'findings-bom-reorder',
    'BOM 여정 4호 부분취소·재주문 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let C = '';
  let P = '';
  let caseA: SeededQuote | null = null;
  let caseB: SeededQuote | null = null;
  let originalOdId: string | null = null;
  let reorderOdId: string | null = null;
  let originalCtA: number | null = null;
  let originalCtB: number | null = null;
  let reorderCtA: number | null = null;
  let poA: number | null = null;
  let poB: number | null = null;
  let shipmentId: number | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mailpitList(1);

    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정이 없습니다`);
    expect(partner.country, `${PARTNER_NAME} 국내 선적 전제`).toBe('KR');
    expect(capabilityList(partner.capabilities), `${PARTNER_NAME} BOM RFQ 권한`).toContain(
      'bom_rfq',
    );

    const creds = requireCustomerCreds();
    customer = await newPhpSession(creds);
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '파트너');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    C = signJwt({ mbId: customer.mbId, ttlSec: 3600 });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('E01. 확정 Case 2건: 서로 다른 부품·수량·금액을 고객 견적관리에 표시', async () => {
    caseA = await seedAnsweredQuote(customer.mbId, partner.id, partner.name, {
      title: `[BOM 여정 4호-A] 수동소자 ${RUN_KEY}`,
      setQty: 2,
      spareQty: 1,
      shippingFee: 3_000,
      managementFee: 2_500,
      lines: [
        {
          mpn: 'RC0603FR-0710KL',
          manufacturerName: 'Yageo',
          description: '10 kΩ 1% 0603 칩 저항',
          bomQty: 5,
          orderQty: 15,
          unitPrice: 600,
        },
        {
          mpn: 'GRM188R71H104KA93D',
          manufacturerName: 'Murata',
          description: '0.1 µF 50 V X7R 0603 MLCC',
          bomQty: 3,
          orderQty: 10,
          unitPrice: 350,
        },
      ],
    });
    caseB = await seedAnsweredQuote(customer.mbId, partner.id, partner.name, {
      title: `[BOM 여정 4호-B] IC·커넥터 ${RUN_KEY}`,
      setQty: 1,
      spareQty: 2,
      shippingFee: 4_000,
      managementFee: 2_500,
      lines: [
        {
          mpn: 'STM32F103C8T6',
          manufacturerName: 'STMicroelectronics',
          description: 'Arm Cortex-M3 MCU 64 KB LQFP-48',
          bomQty: 1,
          orderQty: 3,
          unitPrice: 4_500,
        },
        {
          mpn: 'B2B-EH-A',
          manufacturerName: 'JST',
          description: '2-position 2.5 mm wire-to-board header',
          bomQty: 2,
          orderQty: 5,
          unitPrice: 1_200,
        },
      ],
    });
    ledger.push(
      `sp_bom_quote #${caseA.quoteId} + RFQ #${String(caseA.rfqId)} (${caseA.title})`,
      `sp_bom_quote #${caseB.quoteId} + RFQ #${String(caseB.rfqId)} (${caseB.title})`,
    );

    await rp.assertView(customer, '/shop/quotes#bom', 'E01-bom-two-answered', [
      caseA.title,
      caseB.title,
      '회신 완료',
    ]);
    for (const fixture of [caseA, caseB]) {
      const checkbox = customer.page.locator(`#sp-bom-check-${fixture.quoteId}`);
      expect(await checkbox.isEnabled(), `Case ${fixture.quoteId} 주문 선택 가능`).toBe(true);
    }
  });

  test('E02. 고객: 두 Case를 한 무통장 주문으로 묶고 주문:Case=1:2를 확정', async (ctx) => {
    if (caseA === null || caseB === null) return ctx.skip();
    const placed = await placeBatchOrderFromBomQuotes(customer, rp, {
      quotes: [
        {
          quoteId: caseA.quoteId,
          title: caseA.title,
          expectedOrderAmount: caseA.orderAmount,
          expectedAppliedSetQty: 3,
        },
        {
          quoteId: caseB.quoteId,
          title: caseB.title,
          expectedOrderAmount: caseB.orderAmount,
          expectedAppliedSetQty: 3,
        },
      ],
      step: 'E02',
      prefix: 'E02-batch',
      buyerName: 'e2eBOM묶음고객',
    });
    originalOdId = placed.odId;
    ledger.push(`g5_shop_order od_id=${originalOdId} (BOM Case 2건 묶음)`);

    const rows = await readCartRows([`bom-${caseA.quoteId}`, `bom-${caseB.quoteId}`]);
    const rowA = rows.find(
      (row) => String(row.odId) === originalOdId && row.ioId === `bom-${caseA?.quoteId ?? ''}`,
    );
    const rowB = rows.find(
      (row) => String(row.odId) === originalOdId && row.ioId === `bom-${caseB?.quoteId ?? ''}`,
    );
    if (rowA === undefined || rowB === undefined) {
      throw new Error(`묶음 주문 ${originalOdId}에서 BOM 카트행 2건을 찾지 못했습니다`);
    }
    expect(rowA?.ctStatus).toBe('주문');
    expect(rowB?.ctStatus).toBe('주문');
    expect(Number(rowA?.ioPrice ?? 0)).toBe(caseA.orderAmount);
    expect(Number(rowB?.ioPrice ?? 0)).toBe(caseB.orderAmount);
    originalCtA = Number(rowA?.ctId);
    originalCtB = Number(rowB?.ctId);
    const order = await readOrder(originalOdId);
    expect(order?.odStatus).toBe('주문');
    expect(Number(order?.cartPrice ?? 0)).toBe(caseA.orderAmount + caseB.orderAmount);
    expect(Number(order?.cancelPrice ?? -1)).toBe(0);
    expect(Number(order?.misu ?? 0)).toBe(caseA.orderAmount + caseB.orderAmount);

    await rp.assertView(adminView, '/app/admin/smartbom/orders', 'E02-admin-batch-order', [
      originalOdId,
      caseA.title,
      caseB.title,
      '입금 대기',
    ]);
  }, 240_000);

  test('E03. 관리자: 묶음 중 A만 안전 취소하고 B의 주문·미수금은 유지', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || originalOdId === null
      || originalCtA === null
      || originalCtB === null
    ) return ctx.skip();
    const beforeMailLogs = await getPrisma().spMailLog.count({
      where: {
        OR: [
          { refType: 'bom_quote', refId: caseA.quoteId },
          { refType: 'order', refId: originalOdId },
        ],
      },
    });
    const page = adminView.page;
    const orderRow = page.locator('tr').filter({ hasText: originalOdId }).first();
    await orderRow.getByRole('button', { name: `${caseA.title} 주문 취소` }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Smart BOM 주문 취소' });
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    await expect.poll(
      () => dialog.locator('textarea').evaluate((element) => document.activeElement === element),
      { timeout: 10_000 },
    ).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect.poll(() => dialog.innerText()).toContain('다른 활성 항목 1개는 유지됩니다');
    await dialog.locator('textarea').fill(CANCEL_REASON);
    const cancelWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-orders/${caseA?.quoteId ?? ''}/cancel`),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: 'BOM 주문 취소', exact: true }).click();
    const cancelResponse = await cancelWait;
    expect(cancelResponse.status(), '관리자 BOM 부분취소 API').toBe(200);
    await dialog.getByText('BOM 주문 취소가 완료되었습니다.').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(750);
    expect(await dialog.innerText()).toContain('BOM 주문 취소가 완료되었습니다.');
    expect(await dialog.innerText()).not.toContain('이미 취소된 BOM 주문');
    await rp.shot(adminView, 'E03-partial-cancel-done');
    await dialog.getByRole('button', { name: '확인', exact: true }).click();

    const rows = await readCartRows([`bom-${caseA.quoteId}`, `bom-${caseB.quoteId}`]);
    const rowA = rows.find((row) => Number(row.ctId) === originalCtA);
    const rowB = rows.find((row) => Number(row.ctId) === originalCtB);
    expect(rowA?.ctStatus, '취소 대상 A 행').toBe('취소');
    expect(rowB?.ctStatus, '동반 B 행 유지').toBe('주문');
    const order = await readOrder(originalOdId);
    expect(order?.odStatus, '부분취소 주문 헤더 유지').toBe('주문');
    expect(Number(order?.cartPrice ?? 0), '원 주문 상품합계 보존').toBe(
      caseA.orderAmount + caseB.orderAmount,
    );
    expect(Number(order?.cancelPrice ?? 0), 'A 취소 금액').toBe(caseA.orderAmount);
    expect(Number(order?.misu ?? 0), 'B만 남은 미수금').toBe(caseB.orderAmount);
    expect(order?.modHistory).toContain(CANCEL_REASON);
    const afterMailLogs = await getPrisma().spMailLog.count({
      where: {
        OR: [
          { refType: 'bom_quote', refId: caseA.quoteId },
          { refType: 'order', refId: originalOdId },
        ],
      },
    });
    expect(afterMailLogs, '취소 시 자동 메일 미발송').toBe(beforeMailLogs);

    const customerDetail = await api(C, 'GET', `/api/bom/quotes/${caseA.quoteId}`);
    expect(customerDetail.status, JSON.stringify(customerDetail.json)).toBe(200);
    expect(customerDetail.json?.data?.orderState).toBe('canceled');
    await rp.assertView(customer, `/app/bom/${caseA.quoteId}`, 'E03-customer-reorder-ready', [
      '이전 주문이 취소되었습니다',
      '다시 주문하기',
      '국내 배송비는 주문서에서 별도 계산됩니다',
    ]);
  }, 120_000);

  test('E04. 잔여 B 입금·발주: 취소 A는 주문 헤더가 입금이어도 발주 차단', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || originalOdId === null
      || originalCtA === null
      || originalCtB === null
    ) return ctx.skip();
    const quoteA = caseA;
    const quoteB = caseB;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [originalOdId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json?.data?.skipped ?? []).toHaveLength(0);
    const rows = await readCartRows([`bom-${caseA.quoteId}`, `bom-${caseB.quoteId}`]);
    expect(rows.find((row) => Number(row.ctId) === originalCtA)?.ctStatus).toBe('취소');
    expect(rows.find((row) => Number(row.ctId) === originalCtB)?.ctStatus).toBe('입금');
    const order = await readOrder(originalOdId);
    expect(order?.odStatus).toBe('입금');
    expect(Number(order?.receiptPrice ?? 0)).toBe(caseB.orderAmount);
    expect(Number(order?.misu ?? -1)).toBe(0);

    const blocked = await api(A, 'POST', `/api/admin/bom-quotes/${caseA.quoteId}/pos`, {
      partnerIds: [num(partner.id)],
      memo: '취소행 발주 차단 검증',
    });
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('ORDER_CLOSED');

    const issue = await api(A, 'POST', `/api/admin/bom-quotes/${caseB.quoteId}/pos`, {
      partnerIds: [num(partner.id)],
      memo: `[BOM 여정 4호 ${RUN_KEY}] 잔여 B 발주`,
    });
    expect(issue.status, JSON.stringify(issue.json)).toBe(200);
    const data: PoCreateData | undefined = issue.json?.data;
    expect(data?.created).toBe(1);
    const po = data?.pos.find((entry) => entry.partnerId === num(partner.id));
    if (po === undefined) throw new Error('잔여 B 발주서가 생성되지 않았습니다');
    poB = po.poId;
    expect(po.items).toHaveLength(quoteB.itemIds.length);
    ledger.push(`sp_bom_po #${String(poB)} (잔여 B, order ${originalOdId})`);

    const list = await api(A, 'GET', '/api/admin/bom-orders?tab=all&page=1&pageSize=100');
    const listData: AdminOrderData | undefined = list.json?.data;
    const listed = listData?.items.find((item) => item.odId === originalOdId);
    expect(listed?.isPaid).toBe(true);
    expect(listed?.orderPrice).toBe(quoteB.orderAmount);
    expect(listed?.cases.find((entry) => entry.quoteId === quoteA.quoteId)).toMatchObject({
      isCurrentAttempt: true,
      isCanceled: true,
      ctStatus: '취소',
    });
    expect(listed?.cases.find((entry) => entry.quoteId === quoteB.quoteId)).toMatchObject({
      isCurrentAttempt: true,
      isCanceled: false,
      ctStatus: '입금',
    });
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteA.quoteId}?from=orders`,
      'E04-admin-canceled-case-blocked',
      ['고객 재주문 가능', '취소된 주문입니다'],
    );
    const canceledStep = adminView.page.locator('[data-smartbom-step="6"]');
    await expect.poll(() => canceledStep.innerText()).toContain('주문 취소 · 재주문 대기');
  });

  test('E05. 고객 A 재주문: 새 ct·새 주문을 만들고 과거 취소행·원주문 연결 보존', async (ctx) => {
    if (caseA === null || caseB === null || originalOdId === null || originalCtA === null)
      return ctx.skip();
    const quoteA = caseA;
    const beforeRows = await readCartRows([`bom-${quoteA.quoteId}`]);
    const oldBefore = beforeRows.find((row) => Number(row.ctId) === originalCtA);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: quoteA.quoteId,
      step: 'E05',
      prefix: 'E05-reorder',
      buyerName: 'e2eBOM재주문고객',
      expectedOrderAmount: quoteA.orderAmount,
      expectedAppliedSetQty: 3,
    });
    reorderOdId = placed.odId;
    ledger.push(`g5_shop_order od_id=${reorderOdId} (취소 A 재주문)`);

    const afterRows = await readCartRows([`bom-${quoteA.quoteId}`]);
    expect(afterRows, '동일 io_id의 취소 이력+새 주문').toHaveLength(2);
    const oldAfter = afterRows.find((row) => Number(row.ctId) === originalCtA);
    const fresh = afterRows.find((row) => String(row.odId) === reorderOdId);
    expect(oldAfter).toEqual(oldBefore);
    expect(oldAfter?.ctStatus).toBe('취소');
    expect(String(oldAfter?.odId)).toBe(originalOdId);
    expect(fresh?.ctStatus).toBe('주문');
    expect(Number(fresh?.ioPrice ?? 0)).toBe(quoteA.orderAmount);
    reorderCtA = Number(fresh?.ctId);
    expect(reorderCtA).not.toBe(originalCtA);
    const quote = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quoteA.quoteId) },
      select: { ctId: true, status: true },
    });
    expect(quote?.ctId).toBe(reorderCtA);
    expect(quote?.status).toBe('answered');

    const list = await api(A, 'GET', '/api/admin/bom-orders?tab=all&page=1&pageSize=100');
    const listData: AdminOrderData | undefined = list.json?.data;
    const oldOrder = listData?.items.find((item) => item.odId === originalOdId);
    const newOrder = listData?.items.find((item) => item.odId === reorderOdId);
    expect(oldOrder?.cases.find((entry) => entry.quoteId === quoteA.quoteId)).toMatchObject({
      ctId: originalCtA,
      isCurrentAttempt: false,
      isCanceled: true,
    });
    expect(newOrder?.cases.find((entry) => entry.quoteId === quoteA.quoteId)).toMatchObject({
      ctId: reorderCtA,
      isCurrentAttempt: true,
      isCanceled: false,
      ctStatus: '주문',
    });
    await rp.assertView(adminView, '/app/admin/smartbom/orders', 'E05-admin-history-and-reorder', [
      originalOdId,
      reorderOdId,
      '이전 주문 · 취소',
      quoteA.title,
    ]);
  }, 240_000);

  test('E06. 재주문 A 결제·발주 후 두 PO를 한 국내 발송으로 묶기', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || reorderOdId === null
      || poB === null
      || reorderCtA === null
    ) return ctx.skip();
    const quoteA = caseA;
    const quoteB = caseB;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [reorderOdId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json?.data?.skipped ?? []).toHaveLength(0);
    const issue = await api(A, 'POST', `/api/admin/bom-quotes/${quoteA.quoteId}/pos`, {
      partnerIds: [num(partner.id)],
      memo: `[BOM 여정 4호 ${RUN_KEY}] 재주문 A 발주`,
    });
    expect(issue.status, JSON.stringify(issue.json)).toBe(200);
    const issueData: PoCreateData | undefined = issue.json?.data;
    const createdA = issueData?.pos.find((entry) => entry.partnerId === num(partner.id));
    if (createdA === undefined) throw new Error('재주문 A 발주서가 생성되지 않았습니다');
    poA = createdA.poId;
    expect(createdA.items).toHaveLength(quoteA.itemIds.length);
    ledger.push(`sp_bom_po #${String(poA)} (재주문 A, order ${reorderOdId})`);

    for (const poId of [poB, poA]) {
      const confirmed = await api(P, 'POST', `/api/partner/pos/${String(poId)}/confirm`);
      expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
      expect(confirmed.json?.data?.status).toBe('confirmed');
    }
    const created = await api(P, 'POST', '/api/partner/shipments', { poIds: [poB, poA] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const shipment: ShipmentCreateData | undefined = created.json?.data;
    if (shipment === undefined) throw new Error('묶음 발송이 생성되지 않았습니다');
    shipmentId = shipment.shipmentId;
    expect(shipment.mode).toBe('domestic');
    expect(shipment.status).toBe('preparing');
    ledger.push(
      `sp_bom_shipment #${String(shipmentId)} (PO ${String(poB)} + ${String(poA)} 묶음)`,
    );

    const draftResponse = await api(
      P,
      'GET',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
    );
    const draft: PackingListData | undefined = draftResponse.json?.data;
    expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
    expect(draft?.editable).toBe(true);
    expect(draft?.items).toHaveLength(quoteA.itemIds.length + quoteB.itemIds.length);
    if (draft === undefined) throw new Error('묶음 포장 목록을 읽지 못했습니다');
    const saved = await api(P, 'PUT', `/api/partner/shipments/${String(shipmentId)}/packing-list`, {
      items: draft.items.map((item, index) => ({
        poItemId: item.poItemId,
        packages: [
          {
            packageId: null,
            quantity: item.expectedQty,
            lotNo: `REORDER-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
            dateCode: index % 2 === 0 ? '25+' : '24+',
          },
        ],
      })),
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const printed = await api(
      P,
      'POST',
      `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    const trackingNumber = `REORDER-${RUN_KEY}`;
    const advanced = await api(
      P,
      'POST',
      `/api/partner/pos/${String(shipment.primaryPoId)}/shipment/advance`,
      {
        carrier: 'CJ대한통운',
        trackingNumber,
        trackingUrl: `https://example.test/track/${trackingNumber}`,
      },
    );
    expect(advanced.status, JSON.stringify(advanced.json)).toBe(200);
    expect(advanced.json?.data?.shipment?.status).toBe('shipping');
    await rp.assertView(partnerView, '/app/partner/bom', 'E06-partner-batch-shipping', [
      trackingNumber,
      '배송',
    ]);
  }, 120_000);

  test('E07. 관리자 입고·배송: 두 현재 Case만 큐에 참여하고 과거 취소행은 불변', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || originalOdId === null
      || reorderOdId === null
      || originalCtA === null
      || originalCtB === null
      || reorderCtA === null
      || poA === null
      || poB === null
      || shipmentId === null
    ) return ctx.skip();
    const quoteA = caseA;
    const quoteB = caseB;
    const shipment = await getPrisma().spBomShipment.findUnique({
      where: { id: BigInt(shipmentId) },
      select: { poId: true },
    });
    if (shipment === null) throw new Error('입고할 묶음 발송이 없습니다');
    const primaryPoId = Number(shipment.poId);
    const primaryQuoteId = primaryPoId === poA ? quoteA.quoteId : quoteB.quoteId;
    const received = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${primaryQuoteId}/pos/${String(primaryPoId)}/shipment/receive`,
      { note: `[BOM 여정 4호 ${RUN_KEY}] 묶음 전량 입고` },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);

    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const queueData: AdminOrderData | undefined = queue.json?.data;
    const originalOrder = queueData?.items.find((item) => item.odId === originalOdId);
    const reorderOrder = queueData?.items.find((item) => item.odId === reorderOdId);
    expect(originalOrder, '잔여 B 원주문 배송 큐').toBeTruthy();
    expect(reorderOrder, '재주문 A 배송 큐').toBeTruthy();
    expect(
      originalOrder?.cases.find((entry) => entry.quoteId === quoteA.quoteId),
      '과거 A 감사 연결',
    ).toMatchObject({ isCurrentAttempt: false, isCanceled: true, poCount: 0 });
    expect(
      originalOrder?.cases.find((entry) => entry.quoteId === quoteB.quoteId),
      '현재 B 입고 완료',
    ).toMatchObject({ isCurrentAttempt: true, isCanceled: false, poCount: 1, poReceivedCount: 1 });
    expect(
      reorderOrder?.cases.find((entry) => entry.quoteId === quoteA.quoteId),
      '현재 A 입고 완료',
    ).toMatchObject({ isCurrentAttempt: true, isCanceled: false, poCount: 1, poReceivedCount: 1 });

    await rp.assertView(adminView, '/app/admin/smartbom/logistics', 'E07-two-orders-to-ship', [
      originalOdId,
      reorderOdId,
      '발송 가능',
    ]);
    const originalRow = adminView.page.locator('tr').filter({ hasText: originalOdId }).first();
    const reorderRow = adminView.page.locator('tr').filter({ hasText: reorderOdId }).first();
    expect(await originalRow.innerText()).toContain(quoteB.title);
    expect(await originalRow.innerText()).not.toContain(quoteA.title);
    expect(await reorderRow.innerText()).toContain(quoteA.title);

    // 원주문은 UI 경로로 배송해 Smart BOM 훅이 preserveCanceled=true를 보내는지 검증한다.
    await originalRow.getByRole('button', { name: '배송 처리', exact: true }).click();
    await adminView.page.getByRole('heading', { name: `배송 처리 — ${originalOdId}` }).waitFor({
      timeout: 30_000,
    });
    const sendMail = adminView.page.getByLabel('배송 안내 이메일 발송');
    if (await sendMail.isChecked()) await sendMail.uncheck();
    await adminView.page.getByLabel('택배사').fill('우체국택배');
    await adminView.page.getByLabel('송장번호').fill(`ORIGINAL-${RUN_KEY}`);
    const shipWait = adminView.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/admin/orders/${originalOdId}/force-status`),
      { timeout: 30_000 },
    );
    await adminView.page.getByRole('button', { name: '배송 처리', exact: true }).last().click();
    expect((await shipWait).status(), '원주문 UI 배송 처리').toBe(200);

    const reorderedShip = await api(A, 'PATCH', `/api/admin/orders/${reorderOdId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: '우체국택배',
        invoiceNo: `REORDERED-${RUN_KEY}`,
        invoiceTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
      },
      sendMail: false,
      preserveCanceled: true,
    });
    expect(reorderedShip.status, JSON.stringify(reorderedShip.json)).toBe(200);
    for (const odId of [originalOdId, reorderOdId]) {
      const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
        target: '완료',
        preserveCanceled: true,
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    }

    const finalRows = await readCartRows([`bom-${quoteA.quoteId}`, `bom-${quoteB.quoteId}`]);
    expect(finalRows.find((row) => Number(row.ctId) === originalCtA)?.ctStatus).toBe('취소');
    expect(finalRows.find((row) => Number(row.ctId) === originalCtB)?.ctStatus).toBe('완료');
    expect(finalRows.find((row) => Number(row.ctId) === reorderCtA)?.ctStatus).toBe('완료');
    expect((await readOrder(originalOdId))?.odStatus).toBe('완료');
    expect((await readOrder(reorderOdId))?.odStatus).toBe('완료');
  }, 120_000);

  test('E08. 종점: 고객·관리자 완료 표시와 주문 이력·화면 오류 0건', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || originalOdId === null
      || reorderOdId === null
      || shipmentId === null
    ) return ctx.skip();
    const quoteA = caseA;
    const quoteB = caseB;
    const completedList = await api(
      A,
      'GET',
      '/api/admin/bom-orders?tab=completed&page=1&pageSize=100',
    );
    const completedData: AdminOrderData | undefined = completedList.json?.data;
    expect(completedData?.items.some((item) => item.odId === originalOdId)).toBe(true);
    expect(completedData?.items.some((item) => item.odId === reorderOdId)).toBe(true);
    const quotes: { id: bigint; status: string; ctId: number | null }[] =
      await getPrisma().spBomQuote.findMany({
      where: { id: { in: [BigInt(quoteA.quoteId), BigInt(quoteB.quoteId)] } },
      select: { id: true, status: true, ctId: true },
    });
    expect(quotes.every((quote) => quote.status === 'answered')).toBe(true);
    expect(quotes.find((quote) => String(quote.id) === quoteA.quoteId)?.ctId).toBe(reorderCtA);
    const shipmentLinks = await getPrisma().spBomShipmentPo.count({
      where: { shipmentId: BigInt(shipmentId) },
    });
    expect(shipmentLinks).toBe(2);

    await rp.assertView(
      customer,
      `/shop/orderinquiryview.php?od_id=${originalOdId}`,
      'E08-customer-original-complete',
      [originalOdId, '완료'],
    );
    await rp.assertView(
      customer,
      `/shop/orderinquiryview.php?od_id=${reorderOdId}`,
      'E08-customer-reorder-complete',
      [reorderOdId, '완료'],
    );
    await rp.assertView(adminView, '/app/admin/smartbom/orders', 'E08-admin-orders-complete', [
      originalOdId,
      reorderOdId,
    ]);
    expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
    expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
    expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
    expect(partnerView.pageErrors, '파트너 pageerror').toHaveLength(0);
    F(
      'E08',
      'obs',
      `부분취소·재주문 완주 — original=${originalOdId}, reorder=${reorderOdId}, shipment=${String(shipmentId)}`,
    );
  }, 120_000);
});
