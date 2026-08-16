// Smart BOM 완주 여정 5호 — 결제·원 발주 뒤 협력사 부분 공급 차질 → 잔량 대체발주 →
// 국내 공급분+국제 잔량 분할 입고 → 전량 입고 뒤 고객 배송.
//
// 1~4호가 정상 조달·분할 선정·품목 정정·재주문을 고정했다면 5호는 결제 이후의 실패 복구를
// 다룬다. 원 PO와 고객 확정가는 불변이어야 하며, 실제 선적 수량만 부족분을 제외한다.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-shortage-recovery.md 대장으로
// 확인한 뒤 수동 정리한다. 실행: pnpm -F e2e journey:bom:5
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
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const PARTNER_A_NAME = '협력1';
const PARTNER_B_NAME = '협력2';
const SHORTAGE_MPN = 'GRM188R71H104KA93D';
const SHORTAGE_QTY = 7;

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  sourceUnitPrice: number;
  recoveryUnitPrice: number;
}

const LINES: readonly SeedLine[] = [
  {
    mpn: 'STM32F103C8T6',
    manufacturerName: 'STMicroelectronics',
    description: 'Arm Cortex-M3 MCU 64 KB LQFP-48',
    bomQty: 1,
    orderQty: 5,
    sourceUnitPrice: 4_500,
    recoveryUnitPrice: 4_900,
  },
  {
    mpn: SHORTAGE_MPN,
    manufacturerName: 'Murata',
    description: '0.1 µF 50 V X7R 0603 MLCC',
    bomQty: 4,
    orderQty: 20,
    sourceUnitPrice: 360,
    recoveryUnitPrice: 410,
  },
  {
    mpn: 'B2B-XH-A',
    manufacturerName: 'JST',
    description: '2-position 2.5 mm wire-to-board header',
    bomQty: 2,
    orderQty: 10,
    sourceUnitPrice: 1_100,
    recoveryUnitPrice: 1_250,
  },
  {
    mpn: 'LTST-C190KGKT',
    manufacturerName: 'Lite-On',
    description: 'Green 0603 SMD LED',
    bomQty: 6,
    orderQty: 30,
    sourceUnitPrice: 180,
    recoveryUnitPrice: 220,
  },
] as const;

interface SeededQuote {
  quoteId: string;
  title: string;
  confirmedTotal: number;
  orderAmount: number;
  sourceRfqId: number;
  recoveryRfqId: number;
  shortageQuoteItemId: string;
  recoveryRfqItemId: number;
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
  mpn: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  shortage: {
    shortageId: number;
    shortageQty: number;
    suppliedQty: number;
    suppliedAmount: number;
    recovery: { poId: number; partnerId: number; qty: number } | null;
  } | null;
  recoverySource: { shortageId: number; sourcePoId: number; shortageQty: number } | null;
}

interface PoRow {
  poId: number;
  partnerId: number;
  partnerName: string;
  status: string;
  totalAmount: number;
  actualSupplyAmount: number;
  items: PoItem[];
}

interface PoListData {
  pos: PoRow[];
}

interface PoCreateData extends PoListData {
  created: number;
}

interface ShipmentCreateData {
  shipmentId: number;
  primaryPoId: number;
  mode: 'domestic' | 'international';
  status: string;
}

interface PackingListItem {
  poItemId: number;
  mpn: string;
  expectedQty: number;
}

interface PackingListData {
  shipmentId: number;
  editable: boolean;
  totalQuantity: number;
  items: PackingListItem[];
}

interface AdminOrderCase {
  quoteId: string;
  poCount: number;
  poReceivedCount: number;
  openShortageCount: number;
}

interface AdminOrderItem {
  odId: string;
  odStatus: string;
  cases: AdminOrderCase[];
}

interface AdminOrderData {
  items: AdminOrderItem[];
}

interface FormApiResult {
  status: number;
  json: unknown;
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

async function seedAnsweredQuote(
  mbId: string,
  sourcePartner: PartnerFixture,
  recoveryPartner: PartnerFixture,
): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const shippingFee = 5_000;
  const managementFee = 3_500;
  const itemsTotal = LINES.reduce(
    (sum, line) => sum + line.sourceUnitPrice * line.orderQty,
    0,
  );
  const confirmedTotal = itemsTotal + shippingFee + managementFee;

  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 5호] 결제 후 공급 차질 복구 ${RUN_KEY}`,
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
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 120_000),
        answeredAt: now,
        answerNote: '재고와 납기를 확인한 테스트 확정 견적입니다.',
        adminMemo: `[BOM 여정 5호 ${RUN_KEY}] disruption recovery fixture`,
        confirmedShippingFee: shippingFee,
        confirmedManagementFee: managementFee,
        confirmedTotal,
      },
    });
    const sourceRfq = await tx.spBomRfq.create({
      data: {
        quoteId: quote.id,
        partnerId: sourcePartner.id,
        status: 'closed',
        totalAmount: itemsTotal,
        currency: 'KRW',
        deliveryDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1_000),
        memo: '국내 재고 보유 회신',
        requestedAt: new Date(now.getTime() - 300_000),
        respondedAt: new Date(now.getTime() - 240_000),
      },
    });
    const recoveryRfq = await tx.spBomRfq.create({
      data: {
        quoteId: quote.id,
        partnerId: recoveryPartner.id,
        status: 'closed',
        totalAmount: LINES.reduce(
          (sum, line) => sum + line.recoveryUnitPrice * line.orderQty,
          0,
        ),
        currency: 'KRW',
        deliveryDate: new Date(now.getTime() + 9 * 24 * 60 * 60 * 1_000),
        memo: '해외 대체 재고 회신',
        requestedAt: new Date(now.getTime() - 300_000),
        respondedAt: new Date(now.getTime() - 210_000),
      },
    });

    const itemIds: string[] = [];
    let shortageQuoteItemId = '';
    let recoveryRfqItemId = 0;
    for (const [index, line] of LINES.entries()) {
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
          lineTotalKrw: line.sourceUnitPrice * line.orderQty,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        },
      });
      const sourceReply = await tx.spBomRfqItem.create({
        data: {
          rfqId: sourceRfq.id,
          quoteItemId: item.id,
          source: 'manual',
          unitPrice: line.sourceUnitPrice,
          currency: 'KRW',
          replyQty: line.orderQty,
          stock: line.orderQty + 200,
          dateCode: '25+',
          leadTime: '재고 보유',
          memo: `${line.mpn} 국내 회신`,
        },
      });
      const recoveryReply = await tx.spBomRfqItem.create({
        data: {
          rfqId: recoveryRfq.id,
          quoteItemId: item.id,
          source: 'manual',
          unitPrice: line.recoveryUnitPrice,
          currency: 'KRW',
          replyQty: line.orderQty,
          stock: line.orderQty + 300,
          dateCode: '25+',
          leadTime: '7영업일',
          memo: `${line.mpn} 해외 대체 회신`,
        },
      });
      await tx.spBomQuoteItem.update({
        where: { id: item.id },
        data: {
          selectedRfqItemId: sourceReply.id,
          selectedOffer: {
            offerKey: `rfq:${String(sourceReply.id)}`,
            supplier: sourcePartner.name,
            supplierSku: '',
            packaging: null,
            breakQty: line.orderQty,
            unitPrice: line.sourceUnitPrice,
            currency: 'KRW',
            unitPriceKrw: line.sourceUnitPrice,
            moq: null,
            orderMultiple: null,
            stock: line.orderQty + 200,
            priceBreaks: [{ qty: 1, price: line.sourceUnitPrice }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
      itemIds.push(String(item.id));
      if (line.mpn === SHORTAGE_MPN) {
        shortageQuoteItemId = String(item.id);
        recoveryRfqItemId = Number(recoveryReply.id);
      }
    }
    await Promise.all([
      tx.spBomRfq.update({
        where: { id: sourceRfq.id },
        data: { requestedItemIds: itemIds },
      }),
      tx.spBomRfq.update({
        where: { id: recoveryRfq.id },
        data: { requestedItemIds: itemIds },
      }),
    ]);
    return {
      quoteId: String(quote.id),
      title: quote.title,
      confirmedTotal,
      orderAmount: Math.round(confirmedTotal * 1.1),
      sourceRfqId: Number(sourceRfq.id),
      recoveryRfqId: Number(recoveryRfq.id),
      shortageQuoteItemId,
      recoveryRfqItemId,
    };
  });
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 5호 — 공급 차질 → 잔량 대체발주', () => {
  const rp = createJourneyReport(
    'findings-bom-shortage-recovery',
    'BOM 여정 5호 공급 차질·잔량 대체발주 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerAView: E2eSession;
  let partnerBView: E2eSession;
  let partnerA: PartnerFixture;
  let partnerB: PartnerFixture;
  let A = '';
  let PA = '';
  let PB = '';
  let seeded: SeededQuote | null = null;
  let odId: string | null = null;
  let poAId: number | null = null;
  let poBId: number | null = null;
  let shortageId: number | null = null;
  let poAShortageItemId: number | null = null;
  let shipmentAId: number | null = null;
  let shipmentBId: number | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mailpitList(1);
    partnerA = await getPartner(PARTNER_A_NAME);
    partnerB = await getPartner(PARTNER_B_NAME);
    if (partnerA.mbId === null || partnerB.mbId === null) {
      throw new Error('협력1·협력2 모두 연결 계정이 필요합니다');
    }
    expect(partnerA.country, '원 공급사 국내 전제').toBe('KR');
    expect(partnerB.country, '대체 공급사 국제 전제').not.toBe('KR');
    expect(capabilityList(partnerA.capabilities)).toContain('bom_rfq');
    expect(capabilityList(partnerB.capabilities)).toContain('bom_rfq');

    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerAView = await newSession({ mbId: partnerA.mbId }, { partnerModule: 'bom' });
    partnerBView = await newSession({ mbId: partnerB.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerAView, '원 협력사');
    rp.watchHttp(partnerBView, '대체 협력사');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7200 });
    PA = signJwt({ mbId: partnerA.mbId, ttlSec: 7200 });
    PB = signJwt({ mbId: partnerB.mbId, ttlSec: 7200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 원협력사: partnerAView, 대체협력사: partnerBView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  async function readOrderCase(): Promise<AdminOrderCase | null> {
    if (seeded === null || odId === null) return null;
    const response = await api(A, 'GET', '/api/admin/bom-orders?tab=all&page=1&pageSize=100');
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const data: AdminOrderData | undefined = response.json?.data;
    return data?.items
      .find((item) => item.odId === odId)
      ?.cases.find((entry) => entry.quoteId === seeded?.quoteId) ?? null;
  }

  async function preparePacking(
    token: string,
    shipmentId: number,
    expected: Record<number, number>,
    lotPrefix: string,
  ): Promise<PackingListData> {
    const draftResponse = await api(
      token,
      'GET',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
    );
    expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
    const draft: PackingListData | undefined = draftResponse.json?.data;
    if (draft === undefined) throw new Error('선적 리스트 초안을 읽지 못했습니다');
    expect(draft.editable).toBe(true);
    for (const item of draft.items) {
      const qty = expected[item.poItemId];
      if (qty !== undefined) expect(item.expectedQty, `${item.mpn} 실제 포장 수량`).toBe(qty);
    }
    const saved = await api(
      token,
      'PUT',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
      {
        items: draft.items.map((item, index) => ({
          poItemId: item.poItemId,
          packages: [
            {
              packageId: null,
              quantity: item.expectedQty,
              lotNo: `${lotPrefix}-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
              dateCode: '25+',
            },
          ],
        })),
      },
    );
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const printed = await api(
      token,
      'POST',
      `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    return draft;
  }

  test('E01. 결제 전 확정 견적: 4개 품목과 원·대체 협력사 회신을 준비', async () => {
    seeded = await seedAnsweredQuote(customer.mbId, partnerA, partnerB);
    ledger.push(
      `sp_bom_quote #${seeded.quoteId}`,
      `sp_bom_rfq #${String(seeded.sourceRfqId)}(${partnerA.name})`,
      `sp_bom_rfq #${String(seeded.recoveryRfqId)}(${partnerB.name}, 대체 후보)`,
    );
    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'E01-customer-answered', [
      seeded.title,
      'STM32F103C8T6',
      SHORTAGE_MPN,
      'B2B-XH-A',
      'LTST-C190KGKT',
      '주문하기',
    ]);
  });

  test('E02. 고객 주문·관리자 입금·원 협력사 4품목 PO 발행', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'E02',
      prefix: 'E02-shortage-order',
      buyerName: 'e2eBOM차질복구고객',
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
    const issued = await api(A, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos`, {
      partnerIds: [num(partnerA.id)],
      memo: `[BOM 여정 5호 ${RUN_KEY}] 원 협력사 발주`,
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const data: PoCreateData | undefined = issued.json?.data;
    const po = data?.pos.find((entry) => entry.partnerId === num(partnerA.id));
    if (po === undefined) throw new Error('원 협력사 PO가 생성되지 않았습니다');
    poAId = po.poId;
    expect(data?.created).toBe(1);
    expect(po.items).toHaveLength(LINES.length);
    expect(po.totalAmount).toBe(
      LINES.reduce((sum, line) => sum + line.sourceUnitPrice * line.orderQty, 0),
    );
    const shortageItem = po.items.find((item) => item.mpn === SHORTAGE_MPN);
    if (shortageItem === undefined) throw new Error('부족 대상 PO 품목이 없습니다');
    poAShortageItemId = shortageItem.poItemId;
    expect(shortageItem.qty).toBe(20);
    ledger.push(`g5_shop_order ${odId}`, `sp_bom_po #${String(poAId)}(${partnerA.name}, 원 PO)`);
  }, 240_000);

  test('E03. 원 협력사 UI: 부족 신고를 수정·취소·재등록한 뒤 7개로 확정', async (ctx) => {
    if (seeded === null || poAId === null || poAShortageItemId === null || odId === null) {
      return ctx.skip();
    }
    const page = partnerAView.page;
    await page.goto(`${BASE_URL}/app/partner/bom/pos/${String(poAId)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: '발주 확인', exact: true }).click();
    await page.getByText('실제 공급할 수 없는 수량이 있으면').waitFor({ timeout: 30_000 });
    const targetRow = page.locator('tr').filter({ hasText: SHORTAGE_MPN }).first();
    await targetRow.getByRole('button', { name: '공급 부족 신고' }).click();
    await expect.poll(() => page.getByText('수정하거나 취소할 수 있으며').count()).toBe(1);
    await page.getByLabel('부족 수량').fill(String(SHORTAGE_QTY));
    await page.getByLabel('사유').selectOption('insufficient_stock');
    await page.getByLabel('상세 메모 (선택)').fill('20개 중 13개만 확보되어 7개 대체 조달 요청');
    const reportWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/partner/pos/${String(poAId)}/shortages`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '부족 수량 신고', exact: true }).click();
    expect((await reportWait).status(), '협력사 부족 신고 API').toBe(200);
    await expect.poll(() => targetRow.innerText(), { timeout: 30_000 }).toContain('실제 공급 13/20개');

    const initialShortage = await getPrisma().spBomPoShortage.findUnique({
      where: { sourcePoItemId: BigInt(poAShortageItemId) },
    });
    if (initialShortage === null) throw new Error('공급 부족 기록이 생성되지 않았습니다');

    await targetRow.getByRole('button', { name: '신고 수정', exact: true }).click();
    await page.getByLabel('부족 수량').fill('6');
    const updateWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(
          `/api/partner/pos/${String(poAId)}/shortages/${String(initialShortage.id)}`,
        ),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '신고 수정', exact: true }).last().click();
    expect((await updateWait).status(), '협력사 부족 신고 수정 API').toBe(200);
    await expect.poll(() => targetRow.innerText(), { timeout: 30_000 }).toContain('실제 공급 14/20개');
    expect(
      (
        await getPrisma().spBomPoShortage.findUnique({
          where: { id: initialShortage.id },
        })
      )?.shortageQty,
    ).toBe(6);

    const cancelWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE'
        && response.url().endsWith(
          `/api/partner/pos/${String(poAId)}/shortages/${String(initialShortage.id)}`,
        ),
      { timeout: 30_000 },
    );
    await targetRow.getByRole('button', { name: '신고 취소', exact: true }).click();
    const confirmCancel = page.getByRole('alertdialog');
    await confirmCancel.waitFor({ state: 'visible', timeout: 30_000 });
    await confirmCancel.getByRole('button', { name: '신고 취소', exact: true }).click();
    expect((await cancelWait).status(), '협력사 부족 신고 취소 API').toBe(200);
    await targetRow.getByRole('button', { name: '공급 부족 신고', exact: true }).waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    expect(
      await getPrisma().spBomPoShortage.findUnique({ where: { id: initialShortage.id } }),
    ).toBeNull();

    await targetRow.getByRole('button', { name: '공급 부족 신고', exact: true }).click();
    await page.getByLabel('부족 수량').fill(String(SHORTAGE_QTY));
    await page.getByLabel('사유').selectOption('insufficient_stock');
    await page.getByLabel('상세 메모 (선택)').fill('정정 완료: 20개 중 13개 공급, 7개 대체 요청');
    const finalReportWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/partner/pos/${String(poAId)}/shortages`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '부족 수량 신고', exact: true }).click();
    expect((await finalReportWait).status(), '협력사 부족 신고 재등록 API').toBe(200);
    await expect.poll(() => targetRow.innerText(), { timeout: 30_000 }).toContain('실제 공급 13/20개');
    const shortage = await getPrisma().spBomPoShortage.findUnique({
      where: { sourcePoItemId: BigInt(poAShortageItemId) },
    });
    if (shortage === null) throw new Error('정정한 공급 부족 기록이 생성되지 않았습니다');
    shortageId = Number(shortage.id);
    expect(shortage.shortageQty).toBe(SHORTAGE_QTY);
    expect(shortage.recoveryPoItemId).toBeNull();
    ledger.push(`sp_bom_po_shortage #${String(shortageId)} (20 중 7 부족)`);
    await rp.shot(partnerAView, 'E03-partner-shortage-corrected');

    const orderCase = await readOrderCase();
    expect(orderCase).toMatchObject({ poCount: 1, poReceivedCount: 0, openShortageCount: 1 });
    const blocked = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      preserveCanceled: true,
    });
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('BOM_FULFILLMENT_INCOMPLETE');
    const sourceItem = await getPrisma().spBomPoItem.findUnique({
      where: { id: BigInt(poAShortageItemId) },
    });
    expect(sourceItem?.qty, '원 PO 발주 수량 불변').toBe(20);
    expect(sourceItem?.lineTotal, '원 PO 금액 불변').toBe(20 * 360);
  }, 120_000);

  test('E04. 관리자 UI: 다른 협력사 회신으로 부족 7개만 대체 PO 발행', async (ctx) => {
    if (seeded === null || poAId === null || shortageId === null) return ctx.skip();
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=pos`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText('대체발주 대기 1').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: '잔량 대체발주', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '잔량 대체발주' });
    await modal.waitFor({ state: 'visible', timeout: 30_000 });
    // 후보는 **비동기 쿼리**다 — 모달이 뜬 직후엔 "후보를 확인하는 중…"만 있다.
    // 여기서 바로 innerText 를 읽으면 원 PO 헤더('원 PO #N · 협력1')에 들어 있는
    // partnerA 만 우연히 통과하고 partnerB 에서 깨진다(2026-08-16 실측 — 서버는
    // 두 후보를 정상 반환했고 화면도 로딩을 옳게 표시했다. 성급한 건 이 스펙이었다).
    const recoveryCandidate = modal.locator('label').filter({ hasText: partnerB.name }).first();
    await recoveryCandidate.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await modal.innerText()).toContain(partnerA.name);
    expect(await modal.innerText()).toContain(partnerB.name);
    expect(await modal.innerText()).toContain('고객이 이미 확정·결제한 견적 금액');
    expect(await modal.innerText()).toContain('발주할 협력사를 직접 선택해 주세요');
    const recoverButton = modal.getByRole('button', {
      name: `부족 ${String(SHORTAGE_QTY)}개 대체발주`,
    });
    expect(await recoverButton.isDisabled(), '후보를 고르기 전 발행 차단').toBe(true);
    const candidateText = await recoveryCandidate.innerText();
    expect(candidateText).toContain(`출발국 ${partnerB.country ?? ''}`);
    expect(candidateText).toContain('국외 발송 · 6단계');
    expect(candidateText).toContain(`대체 발주 ${(SHORTAGE_QTY * 410).toLocaleString('ko-KR')}원`);
    await recoveryCandidate.getByRole('radio').check();
    expect(await recoverButton.isEnabled(), '후보를 직접 고른 뒤 발행 허용').toBe(true);
    await modal.getByLabel('대체 발주 메모 (선택)').fill('해외 재고 7개 즉시 확보 요청');
    const recoverWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(
          `/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/shortages/${String(shortageId)}/recover`,
        ),
      { timeout: 30_000 },
    );
    await recoverButton.click();
    expect((await recoverWait).status(), '관리자 대체발주 API').toBe(200);
    await modal.waitFor({ state: 'hidden', timeout: 30_000 });

    const posResponse = await api(A, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/pos`);
    expect(posResponse.status, JSON.stringify(posResponse.json)).toBe(200);
    const data: PoListData | undefined = posResponse.json?.data;
    const sourcePo = data?.pos.find((po) => po.poId === poAId);
    const recoveryPo = data?.pos.find((po) => po.partnerId === num(partnerB.id));
    if (sourcePo === undefined || recoveryPo === undefined) {
      throw new Error('원 PO와 대체 PO가 함께 조회되지 않았습니다');
    }
    poBId = recoveryPo.poId;
    expect(recoveryPo.items).toHaveLength(1);
    expect(recoveryPo.items[0]).toMatchObject({
      quoteItemId: seeded.shortageQuoteItemId,
      mpn: SHORTAGE_MPN,
      qty: SHORTAGE_QTY,
      unitPrice: 410,
      lineTotal: SHORTAGE_QTY * 410,
    });
    expect(recoveryPo.totalAmount).toBe(SHORTAGE_QTY * 410);
    expect(recoveryPo.actualSupplyAmount).toBe(SHORTAGE_QTY * 410);
    expect(recoveryPo.items[0]?.recoverySource).toMatchObject({
      shortageId,
      sourcePoId: poAId,
      shortageQty: SHORTAGE_QTY,
    });
    const sourceShortage = sourcePo.items.find((item) => item.mpn === SHORTAGE_MPN)?.shortage;
    expect(sourceShortage?.recovery).toMatchObject({
      poId: poBId,
      partnerId: num(partnerB.id),
      qty: SHORTAGE_QTY,
    });
    expect(sourceShortage?.suppliedAmount).toBe((20 - SHORTAGE_QTY) * 360);
    expect(sourcePo.actualSupplyAmount).toBe(sourcePo.totalAmount - SHORTAGE_QTY * 360);
    await expect.poll(() => page.getByText('실제 공급 43,580원', { exact: true }).count()).toBe(1);
    ledger.push(`sp_bom_po #${String(poBId)}(${partnerB.name}, 대체 7개)`);

    const duplicate = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/shortages/${String(shortageId)}/recover`,
      { rfqItemId: seeded.recoveryRfqItemId },
    );
    expect(duplicate.status, JSON.stringify(duplicate.json)).toBe(409);
    expect(duplicate.json?.error).toBe('ALREADY_RECOVERED');
    expect(await readOrderCase()).toMatchObject({
      poCount: 2,
      poReceivedCount: 0,
      openShortageCount: 0,
    });
    const quote = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(seeded.quoteId) },
    });
    expect(quote?.confirmedTotal, '고객 확정 합계 불변').toBe(seeded.confirmedTotal);
    await rp.shot(adminView, 'E04-admin-recovery-po-created');
  }, 120_000);

  test('E05. 두 협력사 포장: 원 PO는 13개, 대체 PO는 정확히 7개', async (ctx) => {
    if (
      seeded === null
      || poAId === null
      || poBId === null
      || poAShortageItemId === null
      || odId === null
    ) return ctx.skip();
    const confirmedB = await api(PB, 'POST', `/api/partner/pos/${String(poBId)}/confirm`);
    expect(confirmedB.status, JSON.stringify(confirmedB.json)).toBe(200);

    const createdA = await api(PA, 'POST', '/api/partner/shipments', { poIds: [poAId] });
    const createdB = await api(PB, 'POST', '/api/partner/shipments', { poIds: [poBId] });
    expect(createdA.status, JSON.stringify(createdA.json)).toBe(200);
    expect(createdB.status, JSON.stringify(createdB.json)).toBe(200);
    const shipmentA: ShipmentCreateData | undefined = createdA.json?.data;
    const shipmentB: ShipmentCreateData | undefined = createdB.json?.data;
    if (shipmentA === undefined || shipmentB === undefined) throw new Error('발송 2건 생성 실패');
    shipmentAId = shipmentA.shipmentId;
    shipmentBId = shipmentB.shipmentId;
    expect(shipmentA.mode).toBe('domestic');
    expect(shipmentB.mode).toBe('international');

    const draftA = await preparePacking(
      PA,
      shipmentAId,
      { [poAShortageItemId]: 20 - SHORTAGE_QTY },
      'SOURCE',
    );
    expect(draftA.items).toHaveLength(LINES.length);
    expect(draftA.totalQuantity).toBe(
      LINES.reduce((sum, line) => sum + line.orderQty, 0) - SHORTAGE_QTY,
    );
    const recoveryPo = await getPrisma().spBomPo.findUnique({
      where: { id: BigInt(poBId) },
      include: { items: true },
    });
    const recoveryPoItemId = Number(recoveryPo?.items[0]?.id ?? 0);
    const draftB = await preparePacking(
      PB,
      shipmentBId,
      { [recoveryPoItemId]: SHORTAGE_QTY },
      'RECOVERY',
    );
    expect(draftB.items).toHaveLength(1);
    expect(draftB.totalQuantity).toBe(SHORTAGE_QTY);

    const domesticTracking = `BOM-SOURCE-${RUN_KEY}`;
    const shippingA = await api(
      PA,
      'POST',
      `/api/partner/pos/${String(poAId)}/shipment/advance`,
      {
        carrier: 'CJ대한통운',
        trackingNumber: domesticTracking,
        trackingUrl: `https://example.test/source/${RUN_KEY}`,
      },
    );
    expect(shippingA.status, JSON.stringify(shippingA.json)).toBe(200);

    const invoiceDraft = await api(
      PB,
      'GET',
      `/api/partner/pos/${String(poBId)}/shipment/invoice?fresh=true`,
    );
    expect(invoiceDraft.status, JSON.stringify(invoiceDraft.json)).toBe(200);
    expect(invoiceDraft.json?.data?.items).toHaveLength(1);
    expect(invoiceDraft.json?.data?.items?.[0]?.qty).toBe(String(SHORTAGE_QTY));
    expect(invoiceDraft.json?.data?.items?.[0]?.totalValue).toBe(SHORTAGE_QTY * 410);
    const invoiceSaved = await api(
      PB,
      'PUT',
      `/api/partner/pos/${String(poBId)}/shipment/invoice`,
      invoiceDraft.json?.data,
    );
    expect(invoiceSaved.status, JSON.stringify(invoiceSaved.json)).toBe(200);
    const invoiceFile = await apiForm(
      PB,
      `/api/partner/pos/${String(poBId)}/shipment/files`,
      'invoice',
      `shortage-recovery-${RUN_KEY}.pdf`,
    );
    expect(invoiceFile.status, JSON.stringify(invoiceFile.json)).toBe(200);
    const requestedB = await api(
      PB,
      'POST',
      `/api/partner/pos/${String(poBId)}/shipment/advance`,
      { shipDate: futureDate(3) },
    );
    expect(requestedB.status, JSON.stringify(requestedB.json)).toBe(200);

    const awb = await apiForm(
      A,
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poBId)}/shipment/files`,
      'airwaybill',
      `shortage-recovery-awb-${RUN_KEY}.pdf`,
    );
    expect(awb.status, JSON.stringify(awb.json)).toBe(200);
    for (const body of [
      {
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: `BOM-RECOVERY-${RUN_KEY}`,
        trackingUrl: `https://example.test/recovery/${RUN_KEY}`,
      },
      { status: 'arrived' },
      { status: 'customs' },
    ] as const) {
      const advanced = await api(
        A,
        'PUT',
        `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poBId)}/shipment`,
        body,
      );
      expect(advanced.status, `${body.status}: ${JSON.stringify(advanced.json)}`).toBe(200);
    }

    const receivedA = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poAId)}/shipment/receive`,
      { note: `[BOM 여정 5호 ${RUN_KEY}] 원 공급분 부분 입고` },
    );
    expect(receivedA.status, JSON.stringify(receivedA.json)).toBe(200);
    expect(await readOrderCase()).toMatchObject({
      poCount: 2,
      poReceivedCount: 1,
      openShortageCount: 0,
    });
    const blocked = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      preserveCanceled: true,
    });
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('BOM_FULFILLMENT_INCOMPLETE');

    const statement = await api(
      A,
      'GET',
      `/api/admin/bom-shipments/${String(shipmentAId)}/statement`,
    );
    expect(statement.status, JSON.stringify(statement.json)).toBe(200);
    const statementItem = statement.json?.data?.items?.find(
      (item: { mpn?: string }) => item.mpn === SHORTAGE_MPN,
    );
    expect(statementItem).toMatchObject({ orderedQty: 20, shippedQty: 13 });
    F('E05', 'obs', '첫 입고는 PO 1/2로 유지되고 고객 배송 직접 호출도 서버에서 차단됨');
  }, 180_000);

  test('E06. 대체 7개 입고 뒤에만 고객 배송 큐 개방·배송 완료', async (ctx) => {
    if (seeded === null || poBId === null || shipmentBId === null || odId === null) {
      return ctx.skip();
    }
    const receivedB = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poBId)}/shipment/receive`,
      { note: `[BOM 여정 5호 ${RUN_KEY}] 대체 잔량 7개 통관·입고` },
    );
    expect(receivedB.status, JSON.stringify(receivedB.json)).toBe(200);
    expect(await readOrderCase()).toMatchObject({
      poCount: 2,
      poReceivedCount: 2,
      openShortageCount: 0,
    });
    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const queueData: AdminOrderData | undefined = queue.json?.data;
    expect(queueData?.items.some((item) => item.odId === odId)).toBe(true);

    await rp.assertView(adminView, '/app/admin/smartbom/logistics', 'E06-all-received-to-ship', [
      odId,
      '입고 완료',
      '발송 가능',
      '배송 처리',
    ]);
    const row = adminView.page.locator('tr').filter({ hasText: odId }).first();
    await row.getByRole('button', { name: '배송 처리', exact: true }).click();
    await adminView.page.getByLabel('택배사').fill('우체국택배');
    await adminView.page.getByLabel('송장번호').fill(`CUSTOMER-RECOVERY-${RUN_KEY}`);
    const sendMail = adminView.page.getByLabel('배송 안내 이메일 발송');
    if (await sendMail.isChecked()) await sendMail.uncheck();
    const shipWait = adminView.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/admin/orders/${odId}/force-status`),
      { timeout: 30_000 },
    );
    await adminView.page.getByRole('button', { name: '배송 처리', exact: true }).last().click();
    expect((await shipWait).status()).toBe(200);
    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
      preserveCanceled: true,
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    await rp.assertView(
      customer,
      `/shop/orderinquiryview.php?od_id=${odId}`,
      'E06-customer-order-complete',
      [odId, '완료'],
    );
  }, 120_000);

  test('E07. 종점 감사: 원 문서·고객 금액 보존, 복구 링크·화면 오류 0건', async (ctx) => {
    if (
      seeded === null
      || poAId === null
      || poBId === null
      || shortageId === null
      || shipmentBId === null
      || odId === null
    ) return ctx.skip();
    const [sourcePo, recoveryPo, shortage, quote] = await Promise.all([
      getPrisma().spBomPo.findUnique({ where: { id: BigInt(poAId) }, include: { items: true } }),
      getPrisma().spBomPo.findUnique({ where: { id: BigInt(poBId) }, include: { items: true } }),
      getPrisma().spBomPoShortage.findUnique({ where: { id: BigInt(shortageId) } }),
      getPrisma().spBomQuote.findUnique({ where: { id: BigInt(seeded.quoteId) } }),
    ]);
    const originalTarget = sourcePo?.items.find(
      (item: { mpn: string }) => item.mpn === SHORTAGE_MPN,
    );
    expect(originalTarget).toMatchObject({ qty: 20, lineTotal: 7_200 });
    expect(sourcePo?.items).toHaveLength(LINES.length);
    expect(recoveryPo?.items).toHaveLength(1);
    expect(recoveryPo?.items[0]).toMatchObject({ qty: SHORTAGE_QTY, lineTotal: 2_870 });
    expect(shortage).toMatchObject({ shortageQty: SHORTAGE_QTY });
    expect(shortage?.recoveryPoItemId).toBe(recoveryPo?.items[0]?.id);
    expect(quote?.confirmedTotal).toBe(seeded.confirmedTotal);

    const orderRows: { odStatus: string; cartPrice: bigint | number }[] =
      await getPrisma().$queryRawUnsafe(
        'SELECT od_status AS odStatus, od_cart_price AS cartPrice FROM g5_shop_order WHERE od_id = ?',
        odId,
      );
    expect(orderRows[0]?.odStatus).toBe('완료');
    expect(Number(orderRows[0]?.cartPrice ?? 0)).toBe(seeded.orderAmount);
    await rp.assertView(
      partnerBView,
      '/app/partner/bom/shipments/done',
      'E07-recovery-partner-done',
      ['완료된 발송', `발송 #${String(shipmentBId)}`, '완료된 발송 · 문서 잠금'],
    );
    const doneCard = partnerBView.page
      .getByText(`📦 발송 #${String(shipmentBId)}`, { exact: true })
      .locator('../..');
    expect(
      await doneCard.getByText('완료된 발송 · 문서 잠금', { exact: false }).count(),
    ).toBe(1);
    expect(await doneCard.getByRole('button', { name: '삭제', exact: true }).count()).toBe(0);
    expect(await doneCard.getByText('교체', { exact: true }).count()).toBe(0);
    expect(await doneCard.getByRole('button', { name: '🧾 만들기', exact: true }).count()).toBe(0);

    const savedInvoice = await api(
      PB,
      'GET',
      `/api/partner/pos/${String(poBId)}/shipment/invoice?fresh=false`,
    );
    expect(savedInvoice.status, JSON.stringify(savedInvoice.json)).toBe(200);
    const lockedInvoiceUpdate = await api(
      PB,
      'PUT',
      `/api/partner/pos/${String(poBId)}/shipment/invoice`,
      savedInvoice.json?.data,
    );
    expect(lockedInvoiceUpdate.status, JSON.stringify(lockedInvoiceUpdate.json)).toBe(409);
    expect(lockedInvoiceUpdate.json?.error).toBe('SHIPMENT_DOCUMENTS_LOCKED');

    const invoiceFile = await getPrisma().spFile.findFirst({
      where: {
        refType: 'sp_bom_shipment',
        refId: BigInt(shipmentBId ?? 0),
        fileType: 'invoice',
      },
    });
    if (invoiceFile === null) throw new Error('완료 문서 잠금 검증용 Invoice가 없습니다');
    const lockedDelete = await api(
      PB,
      'DELETE',
      `/api/partner/pos/${String(poBId)}/shipment/files/${String(invoiceFile.id)}`,
    );
    expect(lockedDelete.status, JSON.stringify(lockedDelete.json)).toBe(409);
    expect(lockedDelete.json?.error).toBe('SHIPMENT_DOCUMENTS_LOCKED');
    expect(await getPrisma().spFile.findUnique({ where: { id: invoiceFile.id } })).not.toBeNull();
    const lockedReplacement = await apiForm(
      PB,
      `/api/partner/pos/${String(poBId)}/shipment/files`,
      'invoice',
      `locked-replacement-${RUN_KEY}.pdf`,
    );
    expect(lockedReplacement.status, JSON.stringify(lockedReplacement.json)).toBe(409);
    expect(lockedReplacement.json).toMatchObject({ error: 'SHIPMENT_DOCUMENTS_LOCKED' });

    expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
    expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
    expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
    expect(partnerAView.pageErrors, '원 협력사 pageerror').toHaveLength(0);
    expect(partnerBView.pageErrors, '대체 협력사 pageerror').toHaveLength(0);
  }, 120_000);

  test('E08. 반응형 회귀: 태블릿 상태 배지와 모바일 물류 표 이동 안내', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const page = adminView.page;
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=pos`, {
      waitUntil: 'domcontentloaded',
    });
    const statusBadge = page.locator('span').filter({ hasText: /^협력사 확인$/ }).first();
    await statusBadge.waitFor({ state: 'visible', timeout: 30_000 });
    const statusStyle = await statusBadge.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { whiteSpace: style.whiteSpace, width: rect.width, height: rect.height };
    });
    expect(statusStyle.whiteSpace).toBe('nowrap');
    expect(statusStyle.width).toBeGreaterThan(45);
    expect(statusStyle.height).toBeLessThanOrEqual(30);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/app/admin/smartbom/logistics`, {
      waitUntil: 'domcontentloaded',
    });
    const shipmentGuide = page.getByText('좌우로 이동해 출고예정·운송장·입고일과 처리 버튼을 확인하세요.');
    const orderGuide = page.getByText('좌우로 이동해 배송지·입고 상태·주문 금액과 작업 버튼을 확인하세요.');
    await shipmentGuide.waitFor({ state: 'visible', timeout: 30_000 });
    await orderGuide.waitFor({ state: 'visible', timeout: 30_000 });
    const shipmentScroll = shipmentGuide.locator('../..');
    const orderScroll = orderGuide.locator('../..');
    expect(await shipmentScroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await orderScroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    // 조달 선적 표의 첫 열은 '구매처'다 — 외부공급사 조달이 들어오며 '협력사'에서
    // 바뀌었는데(e9877bd98) 이 스펙만 옛 이름에 머물러 있었다(2026-08-16 규명).
    const mobileHeader = page.getByRole('columnheader', { name: '구매처', exact: true }).first();
    expect(await mobileHeader.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    await page.getByRole('button', { name: '조달 선적 표 오른쪽으로 이동' }).click();
    await expect.poll(() => shipmentScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }, 120_000);
});
