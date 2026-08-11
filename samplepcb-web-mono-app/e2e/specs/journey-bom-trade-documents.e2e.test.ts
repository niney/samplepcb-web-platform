// Smart BOM 완주 여정 8호 — 국내 협력사 PO 2건 → 한 박스 묶음 선적 →
// PO별 협력사 견적서·선적별 거래명세서 → 입고·고객 배송 완료.
//
// D27 구현 당시 실데이터 UI 검증이 남아 있었다. 관리자와 협력사가 같은 서버 문서 원본을
// 보고, PO 발행 뒤 조직 정보가 바뀌어도 견적서와 거래명세서는 발행 시점 정보를 유지하며,
// Packing List 수량·revision이 묶음 거래명세서에 정확히 반영되는지 검증한다.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-trade-documents.md 대장으로
// 확인한 뒤 수동 정리한다. 실행: pnpm -F e2e journey:bom:8
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
  placeBatchOrderFromBomQuotes,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const PARTNER_MB_ID = 'e2e-bom-trade-partner';
const PARTNER_NAME = 'E2E 국내전자부품';

const BASELINE_PROFILE = {
  contactName: '문서담당',
  contactPhone: '02-7777-8888',
  contactEmail: 'trade-partner@example.test',
  businessNo: '777-88-12345',
  ownerName: '문서대표',
  businessZip: '08390',
  businessAddress: '서울특별시 구로구 디지털로 88',
  businessType: '도소매업',
  businessItem: '전자부품',
  fax: '02-7777-8899',
} as const;

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
  itemsTotal: number;
  itemIds: string[];
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
  mpn: string;
  qty: number;
}

interface PoRow {
  poId: number;
  partnerId: number;
  status: string;
  totalAmount: number;
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
  mpn: string;
  expectedQty: number;
}

interface PackingListData {
  editable: boolean;
  revision: number;
  items: PackingListItem[];
}

interface TradeParty {
  companyName: string;
  businessNo: string;
  ownerName: string;
  zip: string;
  address: string;
  businessType: string;
  businessItem: string;
  contactName: string;
  tel: string;
  fax: string;
  email: string;
  country: string;
}

interface QuotationItem {
  poItemId: number;
  mpn: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

interface QuotationDocument {
  kind: 'quotation';
  quotationNo: string;
  poId: number;
  quoteId: string;
  quoteTitle: string;
  currency: string;
  issuer: TradeParty;
  recipient: TradeParty;
  items: QuotationItem[];
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  snapshotAt: string;
}

interface StatementItem {
  poId: number;
  quoteId: string;
  quoteTitle: string;
  poItemId: number;
  mpn: string;
  orderedQty: number;
  shippedQty: number;
  unitPrice: number;
  lineTotal: number;
  lotNos: string[];
  dateCodes: string[];
}

interface StatementDocument {
  kind: 'statement';
  statementNo: string;
  shipmentId: number;
  packingRevision: number;
  isDraft: boolean;
  issuedAt: string;
  finalizedAt: string | null;
  mode: string;
  currency: string;
  issuer: TradeParty;
  recipient: TradeParty;
  carrier: string | null;
  trackingNumber: string | null;
  items: StatementItem[];
  totalQuantity: number;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  snapshotAt: string;
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

async function ensureTradePartner(): Promise<PartnerFixture> {
  const prisma = getPrisma();
  const membership = await prisma.spPartnerMember.findFirst({
    where: { mbId: PARTNER_MB_ID },
    include: { partner: true },
  });
  const partner = membership === null
    ? await prisma.spPartner.create({
        data: {
          type: 'partner',
          name: PARTNER_NAME,
          country: 'KR',
          defaultCurrency: 'KRW',
          capabilities: ['bom_rfq'],
          status: 'approved',
          ...BASELINE_PROFILE,
          memo: 'BOM 여정 8호 국내 거래문서 전용 표준 파트너',
          members: { create: { mbId: PARTNER_MB_ID, role: 'owner' } },
        },
        include: { members: true },
      })
    : await prisma.spPartner.update({
        where: { id: membership.partnerId },
        data: {
          type: 'partner',
          name: PARTNER_NAME,
          country: 'KR',
          defaultCurrency: 'KRW',
          capabilities: ['bom_rfq'],
          status: 'approved',
          ...BASELINE_PROFILE,
        },
        include: { members: true },
      });
  return {
    id: partner.id,
    name: partner.name,
    country: partner.country,
    capabilities: partner.capabilities,
    mbId: partner.members.find((entry: { mbId: string }) => entry.mbId === PARTNER_MB_ID)?.mbId ?? null,
  };
}

async function seedAnsweredQuote(
  mbId: string,
  partner: PartnerFixture,
  title: string,
  lines: readonly SeedLine[],
): Promise<SeededQuote> {
  const prisma = getPrisma();
  const now = new Date();
  const shippingFee = 2_000;
  const managementFee = 1_000;
  const itemsTotal = lines.reduce((sum, line) => sum + line.unitPrice * line.orderQty, 0);
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
        setQty: 2,
        spareQty: 1,
        itemsTotal,
        shippingFee,
        managementFee,
        finalTotal: confirmedTotal,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 120_000),
        answeredAt: now,
        answerNote: '국내 거래문서 검증용 확정 견적입니다.',
        adminMemo: `[BOM 여정 8호 ${RUN_KEY}] trade document fixture`,
        confirmedShippingFee: shippingFee,
        confirmedManagementFee: managementFee,
        confirmedTotal,
      },
    });
    const rfq = await tx.spBomRfq.create({
      data: {
        quoteId: quote.id,
        partnerId: partner.id,
        status: 'closed',
        totalAmount: itemsTotal,
        currency: 'KRW',
        deliveryDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1_000),
        memo: `[BOM 여정 8호 ${RUN_KEY}] 거래조건 박제`,
        requestedAt: new Date(now.getTime() - 180_000),
        respondedAt: new Date(now.getTime() - 150_000),
      },
    });
    const itemIds: string[] = [];
    for (const [index, line] of lines.entries()) {
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
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
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
          moq: 1,
          stock: line.orderQty + 200,
          dateCode: index % 2 === 0 ? '25+' : '24+',
          leadTime: index % 2 === 0 ? '재고 보유' : '3영업일',
          memo: `${line.mpn} 문서 스냅샷`,
        },
      });
      await tx.spBomQuoteItem.update({
        where: { id: item.id },
        data: {
          selectedRfqItemId: rfqItem.id,
          selectedOffer: {
            offerKey: `rfq:${String(rfqItem.id)}`,
            supplier: partner.name,
            supplierSku: '',
            packaging: null,
            breakQty: line.orderQty,
            unitPrice: line.unitPrice,
            currency: 'KRW',
            unitPriceKrw: line.unitPrice,
            moq: 1,
            orderMultiple: 1,
            stock: line.orderQty + 200,
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
      orderAmount: Math.round(confirmedTotal * 1.1),
      itemsTotal,
      itemIds,
    };
  });
}

const draftComparable = (document: StatementDocument): Omit<StatementDocument, 'issuedAt' | 'snapshotAt'> => {
  const { issuedAt: _issuedAt, snapshotAt: _snapshotAt, ...stable } = document;
  return stable;
};

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 8호 — 국내 묶음 거래문서·인쇄 UX', () => {
  const rp = createJourneyReport(
    'findings-bom-trade-documents',
    'BOM 여정 8호 국내 묶음 거래문서·인쇄 UX 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let caseA: SeededQuote | null = null;
  let caseB: SeededQuote | null = null;
  let odId: string | null = null;
  let poA: number | null = null;
  let poB: number | null = null;
  let primaryPoId: number | null = null;
  let shipmentId: number | null = null;
  let trackingNumber = '';
  let finalStatement: StatementDocument | null = null;
  const quotations = new Map<number, QuotationDocument>();

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await ensureTradePartner();
    if (partner.mbId === null) throw new Error('거래문서 파트너 연결 계정이 없습니다');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '파트너');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    P = signJwt({ mbId: partner.mbId, ttlSec: 7_200 });
    ledger.push(`sp_partner #${String(partner.id)}(${partner.name}, 거래문서 표준 파트너)`);
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    if (partner !== undefined) {
      await getPrisma().spPartner.update({
        where: { id: partner.id },
        data: { ...BASELINE_PROFILE },
      });
    }
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('H01. 국내 협력사 확정 Case 2건 → 고객 묶음 주문 대상 표시', async () => {
    caseA = await seedAnsweredQuote(
      customer.mbId,
      partner,
      `[BOM 여정 8호-A] 수동소자 거래문서 ${RUN_KEY}`,
      [
        {
          mpn: 'RC0603FR-0710KL',
          manufacturerName: 'Yageo',
          description: '10 kΩ 1% 0603 chip resistor',
          bomQty: 8,
          orderQty: 24,
          unitPrice: 75,
        },
        {
          mpn: 'GRM188R71H104KA93D',
          manufacturerName: 'Murata',
          description: '0.1 µF 50 V X7R 0603 MLCC',
          bomQty: 4,
          orderQty: 12,
          unitPrice: 130,
        },
      ],
    );
    caseB = await seedAnsweredQuote(
      customer.mbId,
      partner,
      `[BOM 여정 8호-B] IC·커넥터 거래문서 ${RUN_KEY}`,
      [
        {
          mpn: 'LM358DR',
          manufacturerName: 'Texas Instruments',
          description: 'Dual operational amplifier SOIC-8',
          bomQty: 2,
          orderQty: 8,
          unitPrice: 620,
        },
        {
          mpn: 'B2B-EH-A',
          manufacturerName: 'JST',
          description: '2-position 2.5 mm wire-to-board header',
          bomQty: 2,
          orderQty: 6,
          unitPrice: 900,
        },
      ],
    );
    ledger.push(`sp_bom_quote #${caseA.quoteId}(${caseA.title})`, `sp_bom_quote #${caseB.quoteId}(${caseB.title})`);
    await rp.assertView(customer, '/shop/quotes#bom', 'H01-two-trade-document-quotes', [
      caseA.title,
      caseB.title,
      '회신 완료',
    ]);
  });

  test('H02. 고객 묶음 주문 → 관리자 입금 확인', async (ctx) => {
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
      step: 'H02',
      prefix: 'H02-trade-documents-order',
      buyerName: 'e2eBOM거래문서고객',
    });
    odId = placed.odId;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    ledger.push(`g5_shop_order ${odId}(BOM Case 2건 묶음)`);
  }, 240_000);

  test('H03. PO별 견적서 발행 스냅샷 → 관리자·협력사 동일 원본', async (ctx) => {
    if (caseA === null || caseB === null || odId === null) return ctx.skip();
    for (const fixture of [caseA, caseB]) {
      const issued = await api(A, 'POST', `/api/admin/bom-quotes/${fixture.quoteId}/pos`, {
        partnerIds: [num(partner.id)],
        memo: `[BOM 여정 8호 ${RUN_KEY}] 국내 거래문서 발주`,
      });
      expect(issued.status, JSON.stringify(issued.json)).toBe(200);
      const data: PoCreateData | undefined = issued.json?.data;
      const po = data?.pos.find((entry) => entry.partnerId === num(partner.id));
      if (po === undefined) throw new Error(`${fixture.quoteId} 국내 협력사 PO가 없습니다`);
      expect(data?.created).toBe(1);
      expect(po.items).toHaveLength(fixture.itemIds.length);
      expect(po.totalAmount).toBe(fixture.itemsTotal);
      if (fixture === caseA) poA = po.poId;
      else poB = po.poId;

      const adminDocResponse = await api(A, 'GET', `/api/admin/bom-pos/${String(po.poId)}/quotation`);
      const partnerDocResponse = await api(P, 'GET', `/api/partner/pos/${String(po.poId)}/quotation`);
      expect(adminDocResponse.status, JSON.stringify(adminDocResponse.json)).toBe(200);
      expect(partnerDocResponse.status, JSON.stringify(partnerDocResponse.json)).toBe(200);
      const adminDoc: QuotationDocument = adminDocResponse.json?.data;
      const partnerDoc: QuotationDocument = partnerDocResponse.json?.data;
      expect(adminDoc).toEqual(partnerDoc);
      expect(adminDoc).toMatchObject({
        quotationNo: `PQT-SPB-${String(po.poId)}`,
        quoteId: fixture.quoteId,
        supplyAmount: fixture.itemsTotal,
        vatAmount: Math.round(fixture.itemsTotal * 0.1),
        issuer: {
          companyName: PARTNER_NAME,
          businessNo: BASELINE_PROFILE.businessNo,
          ownerName: BASELINE_PROFILE.ownerName,
          contactName: BASELINE_PROFILE.contactName,
        },
      });
      quotations.set(po.poId, adminDoc);
      const confirmed = await api(P, 'POST', `/api/partner/pos/${String(po.poId)}/confirm`);
      expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    }
    if (poA === null || poB === null) throw new Error('묶음 대상 PO 2건이 준비되지 않았습니다');
    ledger.push(`sp_bom_po #${String(poA)} + #${String(poB)}(국내 견적서 2건)`);

    await getPrisma().spPartner.update({
      where: { id: partner.id },
      data: {
        businessNo: '999-99-99999',
        ownerName: '발행후변경대표',
        contactName: '발행후변경담당',
        contactPhone: '02-9999-9999',
      },
    });
    for (const poId of [poA, poB]) {
      const reloaded = await api(A, 'GET', `/api/admin/bom-pos/${String(poId)}/quotation`);
      expect(reloaded.status, JSON.stringify(reloaded.json)).toBe(200);
      expect(reloaded.json?.data, 'PO 발행 뒤 조직정보 변경의 소급 차단').toEqual(quotations.get(poId));
    }
  });

  test('H04. PO 2건 한 박스 생성 → Packing List 전 거래명세서 초안', async (ctx) => {
    if (poA === null || poB === null) return ctx.skip();
    const created = await api(P, 'POST', '/api/partner/shipments', { poIds: [poA, poB] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const shipment: ShipmentCreateData | undefined = created.json?.data;
    if (shipment === undefined) throw new Error('국내 묶음 선적이 생성되지 않았습니다');
    shipmentId = shipment.shipmentId;
    primaryPoId = shipment.primaryPoId;
    expect(shipment).toMatchObject({ mode: 'domestic', status: 'preparing' });
    ledger.push(`sp_bom_shipment #${String(shipmentId)}(PO ${String(poA)} + ${String(poB)})`);

    const adminDraftResponse = await api(A, 'GET', `/api/admin/bom-shipments/${String(shipmentId)}/statement`);
    const partnerDraftResponse = await api(P, 'GET', `/api/partner/shipments/${String(shipmentId)}/statement`);
    expect(adminDraftResponse.status, JSON.stringify(adminDraftResponse.json)).toBe(200);
    expect(partnerDraftResponse.status, JSON.stringify(partnerDraftResponse.json)).toBe(200);
    const adminDraft: StatementDocument = adminDraftResponse.json?.data;
    const partnerDraft: StatementDocument = partnerDraftResponse.json?.data;
    expect(draftComparable(adminDraft)).toEqual(draftComparable(partnerDraft));
    expect(adminDraft).toMatchObject({
      statementNo: `STMT-SPB-${String(shipmentId)}-R0`,
      packingRevision: 0,
      isDraft: true,
      mode: 'domestic',
      issuer: {
        businessNo: BASELINE_PROFILE.businessNo,
        ownerName: BASELINE_PROFILE.ownerName,
      },
    });
    expect(new Set(adminDraft.items.map((item) => item.poId))).toEqual(new Set([poA, poB]));
    expect(adminDraft.items).toHaveLength((caseA?.itemIds.length ?? 0) + (caseB?.itemIds.length ?? 0));
  });

  test('H05. 포장 revision·LOT 수량 반영 → 국내 배송 전 거래명세서 확정', async (ctx) => {
    if (shipmentId === null || primaryPoId === null) return ctx.skip();
    const packingResponse = await api(P, 'GET', `/api/partner/shipments/${String(shipmentId)}/packing-list`);
    expect(packingResponse.status, JSON.stringify(packingResponse.json)).toBe(200);
    const packing: PackingListData | undefined = packingResponse.json?.data;
    if (packing === undefined) throw new Error('국내 묶음 Packing List가 없습니다');
    expect(packing.items).toHaveLength(4);

    const saved = await api(P, 'PUT', `/api/partner/shipments/${String(shipmentId)}/packing-list`, {
      items: packing.items.map((item, index) => ({
        poItemId: item.poItemId,
        packages: index === 0
          ? [
              {
                packageId: null,
                quantity: 1,
                lotNo: `TRADE-${RUN_KEY}-A`,
                dateCode: '25+',
              },
              {
                packageId: null,
                quantity: item.expectedQty - 1,
                lotNo: `TRADE-${RUN_KEY}-B`,
                dateCode: '25+',
              },
            ]
          : [
              {
                packageId: null,
                quantity: item.expectedQty,
                lotNo: `TRADE-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
                dateCode: index % 2 === 0 ? '25+' : '24+',
              },
            ],
      })),
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json?.data?.revision).toBe(1);

    const savedDraftResponse = await api(P, 'GET', `/api/partner/shipments/${String(shipmentId)}/statement`);
    const savedDraft: StatementDocument = savedDraftResponse.json?.data;
    expect(savedDraft.isDraft).toBe(true);
    expect(savedDraft.packingRevision).toBe(1);
    expect(savedDraft.items.find((item) => item.poItemId === packing.items[0]?.poItemId)?.lotNos).toEqual([
      `TRADE-${RUN_KEY}-A`,
      `TRADE-${RUN_KEY}-B`,
    ]);
    const printed = await api(P, 'POST', `/api/partner/shipments/${String(shipmentId)}/packing-list/print`);
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);

    trackingNumber = `TRADE-DOC-${RUN_KEY}`;
    const shipped = await api(P, 'POST', `/api/partner/pos/${String(primaryPoId)}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber,
      trackingUrl: `https://example.test/trade-documents/${RUN_KEY}`,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    expect(shipped.json?.data?.shipment?.status).toBe('shipping');

    const adminFinalResponse = await api(A, 'GET', `/api/admin/bom-shipments/${String(shipmentId)}/statement`);
    const partnerFinalResponse = await api(P, 'GET', `/api/partner/shipments/${String(shipmentId)}/statement`);
    const adminFinal: StatementDocument = adminFinalResponse.json?.data;
    const partnerFinal: StatementDocument = partnerFinalResponse.json?.data;
    expect(adminFinalResponse.status, JSON.stringify(adminFinalResponse.json)).toBe(200);
    expect(partnerFinalResponse.status, JSON.stringify(partnerFinalResponse.json)).toBe(200);
    expect(adminFinal).toEqual(partnerFinal);
    expect(adminFinal).toMatchObject({
      statementNo: `STMT-SPB-${String(shipmentId)}-R1`,
      packingRevision: 1,
      isDraft: false,
      carrier: 'CJ대한통운',
      trackingNumber,
      issuer: {
        businessNo: BASELINE_PROFILE.businessNo,
        ownerName: BASELINE_PROFILE.ownerName,
      },
    });
    expect(adminFinal.finalizedAt).not.toBeNull();
    expect(adminFinal.totalQuantity).toBe(packing.items.reduce((sum, item) => sum + item.expectedQty, 0));
    expect(adminFinal.supplyAmount).toBe((caseA?.itemsTotal ?? 0) + (caseB?.itemsTotal ?? 0));
    expect(adminFinal.vatAmount).toBe(Math.round(adminFinal.supplyAmount * 0.1));
    finalStatement = adminFinal;
  }, 120_000);

  test('H06. 관리자·협력사 문서 UI → 포커스·모바일 좌우 탐색', async (ctx) => {
    if (caseA === null || shipmentId === null || finalStatement === null || trackingNumber === '') return ctx.skip();
    const partnerPage = partnerView.page;
    await partnerPage.goto(`${BASE_URL}/app/partner/bom`, { waitUntil: 'domcontentloaded' });
    const shipmentCard = partnerPage.locator('div.rounded-xl.border.bg-surface.p-4').filter({ hasText: trackingNumber }).first();
    await shipmentCard.waitFor({ state: 'visible', timeout: 30_000 });
    const quoteTrigger = shipmentCard.getByRole('button', { name: /^견적서/ }).first();
    await quoteTrigger.click();
    const quoteDialog = partnerPage.getByRole('dialog', { name: /협력사 견적서/ });
    await quoteDialog.waitFor({ state: 'visible', timeout: 30_000 });
    await expect.poll(() => quoteDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await quoteDialog.getByText(BASELINE_PROFILE.businessNo, { exact: true }).waitFor();
    await partnerPage.keyboard.press('Shift+Tab');
    expect(await quoteDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await quoteDialog.getByRole('button', { name: '닫기', exact: true }).click();
    await expect.poll(() => quoteTrigger.evaluate((element) => document.activeElement === element)).toBe(true);

    await partnerPage.setViewportSize({ width: 390, height: 844 });
    const statementTrigger = shipmentCard.getByRole('button', { name: '거래명세서', exact: true });
    const statementRoute = `**/api/partner/shipments/${String(shipmentId)}/statement`;
    let invalidResponsePending = true;
    await partnerPage.route(statementRoute, async (route) => {
      if (!invalidResponsePending) {
        await route.continue();
        return;
      }
      invalidResponsePending = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: true, data: {} }),
      });
    });
    await statementTrigger.click();
    const statementDialog = partnerPage.getByRole('dialog', { name: '거래명세서', exact: true });
    await statementDialog.waitFor({ state: 'visible', timeout: 30_000 });
    await statementDialog.getByRole('alert').waitFor();
    await statementDialog.getByRole('button', { name: '다시 시도', exact: true }).click();
    await statementDialog.getByText(finalStatement.statementNo, { exact: false }).waitFor();
    await partnerPage.unroute(statementRoute);
    await statementDialog.getByText('좌우로 이동해 거래 문서 전체를 확인하세요.', { exact: true }).waitFor();
    const scroll = statementDialog.locator('[data-trade-document-scroll]');
    expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await statementDialog.getByRole('button', { name: '거래 문서 오른쪽으로 이동' }).click();
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(
      await partnerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '거래문서 모바일 전체 문서 가로 넘침',
    ).toBe(true);
    await rp.shot(partnerView, 'H06-partner-statement-mobile-390');
    await statementDialog.getByRole('button', { name: '닫기', exact: true }).click();
    await partnerPage.setViewportSize({ width: 1440, height: 900 });

    const adminPage = adminView.page;
    await adminPage.goto(`${BASE_URL}/app/admin/smartbom/cases/${caseA.quoteId}`, { waitUntil: 'domcontentloaded' });
    await adminPage.getByRole('button', { name: '선적 관리', exact: true }).click();
    await adminPage.getByRole('heading', { name: `선적 관리 — ${PARTNER_NAME}` }).waitFor();
    await adminPage.getByRole('button', { name: '거래명세서', exact: true }).click();
    const adminStatementDialog = adminPage.getByRole('dialog', { name: '거래명세서', exact: true });
    await adminStatementDialog.getByText(finalStatement.statementNo, { exact: false }).waitFor({ timeout: 30_000 });
    await adminStatementDialog.getByText(trackingNumber, { exact: false }).waitFor();
    F('H06', 'obs', '관리자·협력사 동일 거래문서와 390px 포커스·좌우 이동을 확인');
  }, 120_000);

  test('H07. 묶음 입고·고객 완료 뒤에도 확정 거래명세서 불변', async (ctx) => {
    if (
      caseA === null
      || caseB === null
      || odId === null
      || primaryPoId === null
      || shipmentId === null
      || finalStatement === null
    ) return ctx.skip();
    const primaryQuoteId = primaryPoId === poA ? caseA.quoteId : caseB.quoteId;
    const received = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${primaryQuoteId}/pos/${String(primaryPoId)}/shipment/receive`,
      { note: `[BOM 여정 8호 ${RUN_KEY}] 거래문서 묶음 전량 입고` },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);

    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=100');
    const queueData: AdminOrderData | undefined = queue.json?.data;
    const order = queueData?.items.find((entry) => entry.odId === odId);
    expect(order?.cases.find((entry) => entry.quoteId === caseA?.quoteId)).toMatchObject({ poCount: 1, poReceivedCount: 1 });
    expect(order?.cases.find((entry) => entry.quoteId === caseB?.quoteId)).toMatchObject({ poCount: 1, poReceivedCount: 1 });

    const delivered = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `CUSTOMER-TRADE-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(delivered.status, JSON.stringify(delivered.json)).toBe(200);
    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const afterComplete = await api(A, 'GET', `/api/admin/bom-shipments/${String(shipmentId)}/statement`);
    expect(afterComplete.status, JSON.stringify(afterComplete.json)).toBe(200);
    expect(afterComplete.json?.data, '입고·고객 완료 뒤 문서 불변').toEqual(finalStatement);
    for (const fixture of [caseA, caseB]) {
      await rp.assertView(customer, `/app/bom/${fixture.quoteId}`, `H07-customer-${fixture.quoteId}-complete`, [
        fixture.title,
        '완료',
      ]);
    }
    F('H07', 'obs', `BOM 8호 완주 — order=${odId} shipment=${String(shipmentId)} statement=${finalStatement.statementNo}`);
  }, 180_000);
});
