// Smart BOM 완주 여정 7호 — 공급사 구매조건 선정 → 외부 실행 실패 가시화 →
// 구매담당 수동 주문 확인 → 관리자 대리 국제 물류 → 고객 배송 완료.
//
// 1~6호는 사람 협력사 RFQ를 조달 원장으로 사용한다. 7호는 RFQ 없이 Mouser 구매조건을
// 선정한 Case가 결제 뒤 공급사 PO로 발행되고, SKU 누락으로 자동 카트 실행이 불가능해도
// 구매담당이 수동 주문을 확인해 물류를 계속할 수 있는지 검증한다. 실제 공급사 API 호출을
// 피하도록 모든 행의 supplierSku를 비워 실패 복구 경로만 안전하게 실증한다.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-supplier-procurement.md 대장으로
// 확인한 뒤 수동 정리한다. 실행: pnpm -F e2e journey:bom:7
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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
  num,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const SUPPLIER_NAME = 'Mouser Electronics';

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  unitPriceKrw: number;
}

const LINES: readonly SeedLine[] = [
  {
    mpn: 'LM358DR',
    manufacturerName: 'Texas Instruments',
    description: 'Dual operational amplifier SOIC-8',
    bomQty: 2,
    orderQty: 10,
    unitPriceKrw: 620,
  },
  {
    mpn: 'SN74HC595DR',
    manufacturerName: 'Texas Instruments',
    description: '8-bit shift register SOIC-16',
    bomQty: 1,
    orderQty: 5,
    unitPriceKrw: 1_180,
  },
] as const;

interface SeededQuote {
  quoteId: string;
  title: string;
  confirmedTotal: number;
  orderAmount: number;
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
  mpn: string;
  supplierSku: string | null;
  qty: number;
}

interface PoExternalRef {
  state: 'ok' | 'failed';
  error?: string;
  skippedNoSku?: number;
}

interface ShipmentRow {
  shipmentId: number;
  status: string;
  receivedAt: string | null;
}

interface PoRow {
  poId: number;
  partnerId: number;
  partnerName: string;
  supplierCode: string | null;
  status: string;
  totalAmount: number;
  externalRef: PoExternalRef | null;
  shipment: ShipmentRow | null;
  items: PoItem[];
}

interface PoCreateData {
  created: number;
  pos: PoRow[];
}

interface PoMutationData {
  pos: PoRow[];
}

interface PackingListItem {
  poItemId: number;
  mpn: string;
  expectedQty: number;
}

interface PackingListData {
  editable: boolean;
  items: PackingListItem[];
}

interface AdminOrderCase {
  quoteId: string;
  poCount: number;
  poReceivedCount: number;
}

interface AdminOrderRow {
  odId: string;
  cases: AdminOrderCase[];
}

interface AdminOrderData {
  items: AdminOrderRow[];
}

interface FormApiResult {
  status: number;
  json: unknown;
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

const futureDate = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function apiForm(
  token: string,
  path: string,
  fileType: 'invoice' | 'airwaybill',
  fileName: string,
): Promise<FormApiResult> {
  const form = new FormData();
  form.append('fileType', fileType);
  form.append(
    'file',
    new Blob(['%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'], {
      type: 'application/pdf',
    }),
    fileName,
  );
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function seedSupplierQuote(mbId: string): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const shippingFee = 6_000;
  const managementFee = 4_000;
  const itemsTotal = LINES.reduce(
    (sum, line) => sum + line.unitPriceKrw * line.orderQty,
    0,
  );
  const confirmedTotal = itemsTotal + shippingFee + managementFee;

  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 7호] 외부공급사 수동 복구 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 2,
        spareQty: 1,
        itemsTotal,
        shippingFee,
        managementFee,
        finalTotal: confirmedTotal,
        usdKrwRateUsed: 1_400,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 120_000),
        answeredAt: now,
        answerNote: 'Mouser 구매조건을 기준으로 확정한 테스트 견적입니다.',
        adminMemo: `[BOM 여정 7호 ${RUN_KEY}] supplier procurement fixture`,
        confirmedShippingFee: shippingFee,
        confirmedManagementFee: managementFee,
        confirmedTotal,
      },
    });
    for (const [index, line] of LINES.entries()) {
      await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          bomQty: line.bomQty,
          orderQty: line.orderQty,
          matchStatus: 'auto',
          selectionSource: 'auto',
          selectedCandidateKey: `journey-7-mouser-${String(index)}`,
          lineTotalKrw: line.unitPriceKrw * line.orderQty,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: {
            offerKey: `mouser:journey-7:${String(index)}`,
            supplier: 'mouser',
            supplierSku: '',
            packaging: null,
            breakQty: line.orderQty,
            unitPrice: line.unitPriceKrw / 1_400,
            currency: 'USD',
            unitPriceKrw: line.unitPriceKrw,
            moq: 1,
            orderMultiple: 1,
            stock: line.orderQty + 500,
            priceBreaks: [{ qty: 1, price: line.unitPriceKrw / 1_400 }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
    }
    return {
      quoteId: String(quote.id),
      title: quote.title,
      confirmedTotal,
      orderAmount: Math.round(confirmedTotal * 1.1),
    };
  });
}

async function ensureMouserSupplier(): Promise<PartnerFixture> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({
    where: { supplierCode: 'mouser' },
    include: { members: { orderBy: { id: 'asc' } } },
  });
  const row = existing ?? await prisma.spPartner.create({
    data: {
      type: 'supplier',
      name: SUPPLIER_NAME,
      supplierCode: 'mouser',
      country: 'US',
      defaultCurrency: 'USD',
      capabilities: ['part_sale'],
      status: 'approved',
      memo: `[BOM 여정 7호 ${RUN_KEY}] 표준 공급사 시드`,
    },
    include: { members: { orderBy: { id: 'asc' } } },
  });
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    capabilities: row.capabilities,
    mbId: row.members[0]?.mbId ?? null,
  };
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 7호 — 외부공급사 수동 복구·관리자 물류', () => {
  const rp = createJourneyReport(
    'findings-bom-supplier-procurement',
    'BOM 여정 7호 외부공급사 수동 복구·관리자 물류 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let supplier: PartnerFixture;
  let A = '';
  let seeded: SeededQuote | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let shipmentId: number | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    supplier = await ensureMouserSupplier();
    const supplierRow = await getPrisma().spPartner.findUnique({
      where: { id: supplier.id },
      select: { type: true, supplierCode: true, country: true },
    });
    expect(supplierRow?.type, '공급사 조직 전제').toBe('supplier');
    expect(supplierRow?.supplierCode, 'Mouser 매핑 전제').toBe('mouser');
    expect(supplierRow?.country, '국제 물류 전제').not.toBe('KR');
    ledger.push(`sp_partner #${String(supplier.id)}(${SUPPLIER_NAME}, 표준 공급사 시드)`);

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

  test('G01. 공급사 구매조건 확정 Case 생성 → 고객 확정 견적 표시', async () => {
    seeded = await seedSupplierQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}`);
    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'G01-customer-supplier-quote', [
      seeded.title,
      '확정 견적',
      ...LINES.map((line) => line.mpn),
      'Mouser',
      '주문하기',
    ]);
    const rfqCount = await getPrisma().spBomRfq.count({
      where: { quoteId: BigInt(seeded.quoteId) },
    });
    expect(rfqCount, '공급사 직접 선정은 RFQ를 만들지 않음').toBe(0);
  });

  test('G02. 고객 주문 → 관리자 입금 확인', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'G02',
      prefix: 'G02-supplier-procurement-order',
      buyerName: 'e2eBOM공급사구매고객',
      expectedOrderAmount: seeded.orderAmount,
      expectedAppliedSetQty: 3,
    });
    odId = placed.odId;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    ledger.push(`g5_shop_order ${odId}`);
  }, 240_000);

  test('G03. 관리자 UI: 공급사 PO 발행 → SKU 누락 자동실행 실패 가시화', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: '발주서 생성', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '발주서 생성' });
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    const supplierGroup = dialog.locator('label').filter({ hasText: SUPPLIER_NAME }).first();
    await supplierGroup.getByText('발행 시 자동 실행', { exact: true }).waitFor();
    expect(await supplierGroup.getByText('SKU 없음', { exact: true }).count()).toBe(LINES.length);

    const issueWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/pos`),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: '발주서 발행 (1곳)' }).click();
    const issueResponse = await issueWait;
    expect(issueResponse.status()).toBe(200);
    const issueJson = (await issueResponse.json()) as { data?: PoCreateData };
    const po = issueJson.data?.pos.find((entry) => entry.partnerId === num(supplier.id));
    if (po === undefined) throw new Error('Mouser 공급사 PO가 생성되지 않았습니다');
    poId = po.poId;
    expect(issueJson.data?.created).toBe(1);
    expect(po.supplierCode).toBe('mouser');
    expect(po.items).toHaveLength(LINES.length);
    expect(po.items.every((item) => item.supplierSku === null)).toBe(true);
    expect(po.externalRef?.state, 'SKU 누락 실행 실패 박제').toBe('failed');
    expect(po.externalRef?.skippedNoSku).toBe(LINES.length);

    const poRow = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first();
    await poRow
      .getByText('자동 실행 실패 · 수동 주문 필요', { exact: true })
      .waitFor({ timeout: 30_000 });
    await poRow.getByText(`SKU 없음 ${String(LINES.length)}행 제외`, { exact: true }).waitFor();
    expect(await poRow.getByRole('button', { name: '자동 실행 재시도' }).count()).toBe(0);
    ledger.push(`sp_bom_po #${String(poId)}(${SUPPLIER_NAME})`);
  });

  test('G04. 미확인 공급사 PO 선적 차단 → 구매담당 수동 주문 확인', async (ctx) => {
    if (seeded === null || poId === null) return ctx.skip();
    const blocked = await api(
      A,
      'PUT',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment`,
      {},
    );
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('PO_NOT_CONFIRMED');

    const page = adminView.page;
    const poRow = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first();
    const shipmentButton = poRow.getByRole('button', { name: '선적 관리' });
    expect(await shipmentButton.isDisabled()).toBe(true);
    const confirmButton = poRow.getByRole('button', { name: '구매 완료 처리' });
    await confirmButton.click();
    const confirmDialog = page
      .getByRole('alertdialog')
      .filter({ hasText: '공급사 사이트에서 실제 주문·결제를 완료했나요?' });
    await confirmDialog.waitFor({ state: 'visible', timeout: 30_000 });
    const confirmWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(
          `/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/pos/${String(poId)}/confirm`,
        ),
      { timeout: 30_000 },
    );
    await confirmDialog.getByRole('button', { name: '구매 완료', exact: true }).click();
    expect((await confirmWait).status()).toBe(200);
    await expect.poll(() => shipmentButton.isDisabled()).toBe(false);
    await poRow.getByText('구매 완료', { exact: true }).waitFor({ timeout: 30_000 });
    await poRow
      .getByText('자동 실행 실패 · 수동 구매 완료', { exact: true })
      .waitFor({ timeout: 30_000 });

    const duplicate = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/confirm`,
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.json?.error).toBe('PO_NOT_CONFIRMABLE');
    F('G04', 'obs', '자동 실행 실패 후 수동 구매 완료를 박제해야 선적 업무가 열림');
  });

  test('G05. 관리자 대리 국제 포장·Invoice·AWB → 통관·입고', async (ctx) => {
    if (seeded === null || poId === null) return ctx.skip();
    const created = await api(
      A,
      'PUT',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment`,
      {},
    );
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const createdData: PoMutationData | undefined = created.json?.data;
    const po = createdData?.pos.find((entry) => entry.poId === poId);
    if (po?.shipment === null || po?.shipment === undefined) {
      throw new Error('공급사 국제 발송이 생성되지 않았습니다');
    }
    shipmentId = po.shipment.shipmentId;
    expect(po.shipment.status).toBe('preparing');

    const draftResponse = await api(
      A,
      'GET',
      `/api/admin/bom-shipments/${String(shipmentId)}/packing-list`,
    );
    expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
    const draft: PackingListData | undefined = draftResponse.json?.data;
    if (draft === undefined) throw new Error('선적 리스트 초안이 없습니다');
    expect(draft.editable).toBe(true);
    expect(draft.items).toHaveLength(LINES.length);
    const savedPacking = await api(
      A,
      'PUT',
      `/api/admin/bom-shipments/${String(shipmentId)}/packing-list`,
      {
        items: draft.items.map((item, index) => ({
          poItemId: item.poItemId,
          packages: [
            {
              packageId: null,
              quantity: item.expectedQty,
              lotNo: `SUP7-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
              dateCode: '25+',
            },
          ],
        })),
      },
    );
    expect(savedPacking.status, JSON.stringify(savedPacking.json)).toBe(200);
    const printed = await api(
      A,
      'POST',
      `/api/admin/bom-shipments/${String(shipmentId)}/packing-list/print`,
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);

    const invoiceDraft = await api(
      A,
      'GET',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/invoice?fresh=true`,
    );
    expect(invoiceDraft.status, JSON.stringify(invoiceDraft.json)).toBe(200);
    const invoiceSaved = await api(
      A,
      'PUT',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/invoice`,
      invoiceDraft.json?.data,
    );
    expect(invoiceSaved.status, JSON.stringify(invoiceSaved.json)).toBe(200);
    const invoiceUpload = await apiForm(
      A,
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/files`,
      'invoice',
      `supplier-invoice-${RUN_KEY}.pdf`,
    );
    expect(invoiceUpload.status, JSON.stringify(invoiceUpload.json)).toBe(200);
    const requested = await api(
      A,
      'PUT',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment`,
      { status: 'requested', shipDate: futureDate(3) },
    );
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    const awbUpload = await apiForm(
      A,
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/files`,
      'airwaybill',
      `supplier-awb-${RUN_KEY}.pdf`,
    );
    expect(awbUpload.status, JSON.stringify(awbUpload.json)).toBe(200);

    for (const body of [
      {
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: `SUP7-US-${RUN_KEY}`,
        trackingUrl: `https://example.test/supplier7/${RUN_KEY}`,
      },
      { status: 'arrived' },
      { status: 'customs' },
    ] as const) {
      const advanced = await api(
        A,
        'PUT',
        `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment`,
        body,
      );
      expect(advanced.status, `${body.status}: ${JSON.stringify(advanced.json)}`).toBe(200);
    }
    const received = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/receive`,
      { note: `[BOM 여정 7호 ${RUN_KEY}] 공급사 국제 입고 완료` },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);
    const dbShipment = await getPrisma().spBomShipment.findUnique({
      where: { id: BigInt(shipmentId) },
    });
    expect(dbShipment?.status).toBe('done');
    expect(dbShipment?.receivedAt).not.toBeNull();
    ledger.push(`sp_bom_shipment #${String(shipmentId)}(international)`);
  }, 180_000);

  test('G06. 고객 배송·완료 → 공급사 직접 선정·모바일 작업 가시성 재검사', async (ctx) => {
    if (seeded === null || odId === null || poId === null || shipmentId === null) return ctx.skip();
    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const queueData: AdminOrderData | undefined = queue.json?.data;
    const order = queueData?.items.find((entry) => entry.odId === odId);
    const orderCase = order?.cases.find((entry) => entry.quoteId === seeded?.quoteId);
    expect(orderCase?.poCount).toBe(1);
    expect(orderCase?.poReceivedCount).toBe(1);

    const shipped = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `CUSTOMER-SUP7-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const selectedRows = await getPrisma().spBomQuoteItem.findMany({
      where: { quoteId: BigInt(seeded.quoteId) },
      select: { selectedRfqItemId: true, selectedOffer: true },
    });
    expect(
      selectedRows.every(
        (row: { selectedRfqItemId: bigint | null; selectedOffer: unknown }) =>
          row.selectedRfqItemId === null,
      ),
    ).toBe(true);
    expect(
      selectedRows.every(
        (row: { selectedRfqItemId: bigint | null; selectedOffer: unknown }) =>
          typeof row.selectedOffer === 'object'
          && row.selectedOffer !== null
          && 'supplier' in row.selectedOffer
          && row.selectedOffer.supplier === 'mouser',
      ),
    ).toBe(true);

    await adminView.page.setViewportSize({ width: 390, height: 844 });
    await adminView.page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    const poTable = adminView.page.locator('table').filter({ hasText: SUPPLIER_NAME }).first();
    await poTable.waitFor({ state: 'visible', timeout: 30_000 });
    const tableScroll = poTable.locator('..').first();
    const mobileMetrics = await tableScroll.evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(mobileMetrics.overflow).toBe(true);
    await adminView.page.getByText(/좌우로 이동해 선적·입고 상태와 작업 버튼/).waitFor();
    await adminView.page.getByRole('button', { name: '발주 표 오른쪽으로 이동' }).click();
    await expect.poll(() => tableScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(
      await adminView.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '모바일 문서 전체 가로 넘침',
    ).toBe(true);
    await rp.shot(adminView, 'G06-admin-supplier-po-mobile-390');

    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'G06-customer-complete', [
      seeded.title,
      '완료',
      'Mouser',
    ]);
    F(
      'G06',
      'obs',
      `BOM 7호 완주 — quote=${seeded.quoteId} od=${odId} po=${String(poId)} shipment=${String(shipmentId)}`,
    );
  }, 180_000);
});
