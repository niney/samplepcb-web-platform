// Smart BOM 입고 스캔 주문 여정 — 고객 주문이 붙은 Case 에서 DigiKey·Mouser 봉투를 스캔해
// 선적 단계 없이 입고 완료(D42 2단계) → 고객 배송 큐(배송 처리 대기) 진입 → 배송 → 완료.
//
// bom-receiving-scan 은 주문 없는 시드라 고객 배송 큐 대상이 아니다(ctId null). 이 여정은
// 고객이 실제로 '주문하기'를 눌러 만든 주문(io_id=bom-<quoteId>)과 입금 확인까지 거친 뒤,
// 공급사 발주서 2장을 스캔으로 닫으면 주문 축(admin-bom-orders to_ship)이 열리는지까지 잇는다.
// 공급사 API 는 부르지 않는다 — 발주서는 직접 시드(실 발행은 Mouser 카트 API 를 치므로).
// 생성물은 자동 정리하지 않는다(여정 관례). 실행: pnpm -F e2e journey:bom:receiving
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
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const RS = String.fromCharCode(0x1e);
const GS = String.fromCharCode(0x1d);
const ecia = (...fields: string[]): string => `[)>${RS}06${GS}${fields.join(GS)}`;

// 실제 품번(다른 무대와 겹치지 않는 것으로) — DigiKey 는 공급사 품번(P)으로, Mouser 는 MPN 으로 대조된다
const DK = { mpn: 'TPS62160DSGR', sku: '296-28895-1-ND', maker: 'Texas Instruments', qty: 20, unitKrw: 1_960 };
const MO = { mpn: 'LM2596S-5.0/NOPB', sku: null, maker: 'Texas Instruments', qty: 6, unitKrw: 3_500 };
const DK_LABEL = ecia(`P${DK.sku}`, `1P${DK.mpn}`, 'K', `1K7299${RUN_KEY.slice(-4)}`, '10K85781337', '11K1', '4LPH', 'Q10');
const MO_LABEL = ecia(`K${RUN_KEY.slice(-8)}`, '14K001', `1P${MO.mpn}`, 'Q3', '11K073121337', '4LMX', '1VTI', '1TLOT-R1', '9D2534');

interface Seed { quoteId: string; title: string; orderAmount: number }
interface Pos { digikeyPoId: number; digikeyItemId: number; mouserPoId: number; mouserItemId: number }
interface Candidate { poItemId: number; poId: number; matchedBy: string }
interface OrderRow { odId: string; odStatus: string; cases: { quoteId: string; poCount: number; poReceivedCount: number; openShortageCount: number }[] }

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function ensureSupplier(code: 'digikey' | 'mouser'): Promise<bigint> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({ where: { supplierCode: code } });
  if (existing !== null) return existing.id;
  const created = await prisma.spPartner.create({
    data: { type: 'supplier', name: code === 'digikey' ? 'DigiKey' : 'Mouser Electronics', supplierCode: code, country: 'US', defaultCurrency: 'USD', capabilities: ['part_sale'], status: 'approved', memo: `[입고 스캔 주문 여정 ${RUN_KEY}]` },
  });
  return created.id;
}

async function seedQuote(mbId: string): Promise<Seed> {
  const prisma = getPrisma();
  const now = new Date();
  const shippingFee = 6_000;
  const managementFee = 4_000;
  const lines = [DK, MO];
  const itemsTotal = lines.reduce((sum, line) => sum + line.unitKrw * line.qty, 0);
  const confirmedTotal = itemsTotal + shippingFee + managementFee;
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId, title: `[입고 스캔 주문 여정] ${RUN_KEY}`, sourceKind: 'single_search', status: 'answered', buildStatus: 'ready', enrichStatus: 'done',
        setQty: 1, spareQty: 0, itemsTotal, shippingFee, managementFee, finalTotal: confirmedTotal, usdKrwRateUsed: 1_400, uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 120_000), answeredAt: now, answerNote: 'DigiKey·Mouser 구매조건으로 확정한 입고 스캔 여정 견적입니다.',
        adminMemo: `[입고 스캔 주문 여정 ${RUN_KEY}]`, confirmedShippingFee: shippingFee, confirmedManagementFee: managementFee, confirmedTotal,
      },
    });
    for (const [index, line] of lines.entries()) {
      await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id, rowIdx: index, included: true, mpn: line.mpn, manufacturerName: line.maker, description: index === 0 ? 'Step-down converter 1A' : 'Simple switcher 3A', bomQty: line.qty, orderQty: line.qty,
          matchStatus: 'auto', selectionSource: 'auto', selectedCandidateKey: `rcv-order-${String(index)}`, lineTotalKrw: line.unitKrw * line.qty,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: { offerKey: `rcv-order:${String(index)}`, supplier: index === 0 ? 'digikey' : 'mouser', supplierSku: line.sku ?? '', packaging: null, breakQty: line.qty, unitPrice: line.unitKrw / 1_400, currency: 'USD', unitPriceKrw: line.unitKrw, moq: 1, orderMultiple: 1, stock: 500, priceBreaks: [{ qty: 1, price: line.unitKrw / 1_400 }], fetchedAt: now.toISOString(), pinned: true },
        },
      });
    }
    return { quoteId: String(quote.id), title: quote.title, orderAmount: Math.round(confirmedTotal * 1.1) };
  });
}

/** 공급사 발주서 2장(issued) — 실 발행 API 는 Mouser 카트를 치므로 원장만 직접 만든다. */
async function seedPos(quoteId: string, digikeyPartnerId: bigint, mouserPartnerId: bigint): Promise<Pos> {
  const prisma = getPrisma();
  const items = await prisma.spBomQuoteItem.findMany({ where: { quoteId: BigInt(quoteId) }, orderBy: { rowIdx: 'asc' } });
  const out: Partial<Pos> = {};
  for (const [index, line] of [DK, MO].entries()) {
    const quoteItem = items[index];
    if (quoteItem === undefined) throw new Error('견적 품목 시드 누락');
    const po = await prisma.spBomPo.create({ data: { quoteId: BigInt(quoteId), partnerId: index === 0 ? digikeyPartnerId : mouserPartnerId, status: 'issued', totalAmount: line.unitKrw * line.qty, currency: 'KRW', issuedAt: new Date() } });
    const poItem = await prisma.spBomPoItem.create({
      data: { poId: po.id, quoteItemId: quoteItem.id, rfqItemId: null, mpn: line.mpn, manufacturerName: line.maker, description: 'e2e', supplierSku: line.sku, qty: line.qty, unitPrice: line.unitKrw, lineTotal: line.unitKrw * line.qty },
    });
    if (index === 0) { out.digikeyPoId = num(po.id); out.digikeyItemId = num(poItem.id); } else { out.mouserPoId = num(po.id); out.mouserItemId = num(poItem.id); }
  }
  return out as Pos;
}

describe.skipIf(!RUN || !JOURNEY)('입고 스캔 주문 여정 — 주문 붙은 Case 의 DigiKey·Mouser 스캔 입고 → 고객 배송', () => {
  const rp = createJourneyReport('findings-bom-receiving-order', '입고 스캔 주문 여정 — 스캔 입고 완료 → 고객 배송 큐 → 배송·완료');
  const { ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let A = '';
  let seeded: Seed | null = null;
  let odId: string | null = null;
  let pos: Pos | null = null;

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

  const ordersTab = async (tab: string): Promise<OrderRow[]> => {
    const r = await api(A, 'GET', `/api/admin/bom-orders?tab=${tab}&page=1&pageSize=100`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.data.items as OrderRow[];
  };
  const scanOnce = async (label: string, expectPoId: number, quantity: number): Promise<void> => {
    const scan = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: label });
    expect(scan.status, JSON.stringify(scan.json)).toBe(200);
    const candidates = scan.json.data.candidates as Candidate[];
    const mine = candidates.filter((c) => c.poId === expectPoId);
    expect(mine, '이 여정의 발주 품목이 후보에 있어야 한다').toHaveLength(1);
    const rec = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: label, poItemId: mine[0]?.poItemId ?? null, quantity, note: null });
    expect(rec.status, JSON.stringify(rec.json)).toBe(200);
  };

  test('B01. 확정 견적 → 고객 주문 → 관리자 입금 확인', async () => {
    seeded = await seedQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}`);
    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'B01-customer-quote', [seeded.title, DK.mpn, MO.mpn]);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId, step: 'B01', prefix: 'B01-receiving-order', buyerName: 'e2e입고스캔고객', expectedOrderAmount: seeded.orderAmount, expectedAppliedSetQty: 1,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId}`);
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', { target: '입금', odIds: [odId], sendMail: false, sendSms: false });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    // 주문·결제 큐(paid)에는 있고, 발주서가 없으니 '발주 대기'(paid_unissued)
    expect((await ordersTab('paid_unissued')).some((row) => row.odId === odId), '발주 전 = 발주 대기').toBe(true);
    expect((await ordersTab('to_ship')).some((row) => row.odId === odId), '입고 전엔 배송 큐에 없다').toBe(false);
  }, 240_000);

  test('B02. 공급사 발주서 2장(DigiKey·Mouser) — 발주 뒤에도 입고 전이라 배송 큐에 없다', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const [dk, mo] = await Promise.all([ensureSupplier('digikey'), ensureSupplier('mouser')]);
    pos = await seedPos(seeded.quoteId, dk, mo);
    ledger.push(`sp_bom_po #${String(pos.digikeyPoId)}(DigiKey) · #${String(pos.mouserPoId)}(Mouser)`);
    const row = (await ordersTab('paid')).find((r) => r.odId === odId);
    const c = row?.cases.find((entry) => entry.quoteId === seeded?.quoteId);
    expect(c).toMatchObject({ poCount: 2, poReceivedCount: 0, openShortageCount: 0 });
    expect((await ordersTab('paid_unissued')).some((r) => r.odId === odId), '발주했으니 발주 대기에서 빠진다').toBe(false);
    expect((await ordersTab('to_ship')).some((r) => r.odId === odId)).toBe(false);
    await rp.assertView(adminView, `/app/admin/smartbom/cases/${seeded.quoteId}`, 'B02-admin-case-pos', ['DigiKey', 'Mouser']);
  }, 120_000);

  test('B03. 봉투 스캔 → 전량 → 입고 완료 처리(선적 단계 생략) — DigiKey 먼저, 한 장으로는 배송 큐가 안 열린다', async (ctx) => {
    if (seeded === null || odId === null || pos === null) return ctx.skip();
    await scanOnce(DK_LABEL, pos.digikeyPoId, 10);
    await scanOnce(DK_LABEL, pos.digikeyPoId, 10);
    const dkDone = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(pos.digikeyPoId)}/complete`);
    expect(dkDone.status, JSON.stringify(dkDone.json)).toBe(200);
    expect(dkDone.json.data).toMatchObject({ packages: 2, scans: 2, poConfirmedNow: true });
    ledger.push(`sp_bom_shipment #${String(dkDone.json.data.shipmentId)}(DigiKey, 스캔 입고)`);
    const half = (await ordersTab('paid')).find((r) => r.odId === odId)?.cases.find((entry) => entry.quoteId === seeded?.quoteId);
    expect(half).toMatchObject({ poCount: 2, poReceivedCount: 1 });
    expect((await ordersTab('to_ship')).some((r) => r.odId === odId), '한 장만 입고 = 아직 배송 불가').toBe(false);

    await scanOnce(MO_LABEL, pos.mouserPoId, 3);
    const short = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(pos.mouserPoId)}/complete`);
    expect(short.status).toBe(409);
    expect(short.json?.error).toBe('NOT_COMPLETE');
    await scanOnce(MO_LABEL, pos.mouserPoId, 3);
    const moDone = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(pos.mouserPoId)}/complete`);
    expect(moDone.status, JSON.stringify(moDone.json)).toBe(200);
    expect(moDone.json.data).toMatchObject({ packages: 2, scans: 2, poConfirmedNow: true });
    ledger.push(`sp_bom_shipment #${String(moDone.json.data.shipmentId)}(Mouser, 스캔 입고)`);

    // 선적·배송 화면 — 입고 완료 탭 배지(입고 스캔 n/n) + 고객 배송 '배송 처리 대기' 에 주문
    await rp.assertView(adminView, '/app/admin/smartbom/logistics', 'B03-logistics-received', ['선적·배송']);
  }, 180_000);

  test('B04. 고객 배송 큐 — 전 발주 입고 완료라 배송 처리 대기에 뜨고, 배송(송장) → 완료', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const row = (await ordersTab('to_ship')).find((r) => r.odId === odId);
    expect(row, '두 발주서 모두 입고 → 배송 처리 대기').toBeDefined();
    expect(row?.cases.find((entry) => entry.quoteId === seeded?.quoteId)).toMatchObject({ poCount: 2, poReceivedCount: 2, openShortageCount: 0 });

    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/logistics`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /배송 처리 대기/ }).first().click();
    await page.waitForFunction((id: string) => document.body.innerText.includes(id), odId, { timeout: 30_000 });
    await rp.shot(adminView, 'B04-logistics-to-ship');

    const shipped = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '배송', delivery: { deliveryCompany: '우체국택배', invoiceNo: `RCV-${RUN_KEY}`, invoiceTime: new Date().toISOString().slice(0, 19).replace('T', ' ') }, sendMail: false, sendSms: false });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    expect((await ordersTab('shipping')).some((r) => r.odId === odId), '배송 중 탭').toBe(true);
    expect((await ordersTab('to_ship')).some((r) => r.odId === odId)).toBe(false);
    await rp.assertView(customer, `/shop/orderinquiryview.php?od_id=${odId}`, 'B04-customer-order-shipping', [`RCV-${RUN_KEY}`]);

    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    expect((await ordersTab('completed')).some((r) => r.odId === odId), '완료 탭').toBe(true);
    const order: { od_status: string }[] = await getPrisma().$queryRawUnsafe('SELECT od_status FROM g5_shop_order WHERE od_id = ?', odId);
    expect(order[0]?.od_status).toBe('완료');
  }, 180_000);
});
