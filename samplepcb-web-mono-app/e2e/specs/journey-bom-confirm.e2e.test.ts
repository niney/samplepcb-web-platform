// Smart BOM 완주 여정 22호 — 결제 후 부품 확인 요청(D43, A안: 원 주문 유지 + 차액 정산).
//
// 결제한 BOM 주문에서 재고 소진·MOQ 증가가 생기면 관리자가 품목을 지정해 선택지를 보내고
// (재고 소진: 대체품·입고 대기·사급 / MOQ 증가: MOQ 구매·전량 사급 + 상담), 고객이 마이페이지
// '확인 요청 › 부품 확인' → 주문 상세(#bomc-{id})에서 분석근거를 보고 고르며, 관리자가 적용·정산한다.
// 추가결제는 별도 주문(앵커 sp-bom-extra), 환불은 원 BOM 행 감액(과입금) → 환불 기록.
// 게이트(발주 CONFIRM_PENDING·배송 BOM_FULFILLMENT_INCOMPLETE·Case 삭제 OPEN_CONFIRM)와
// '먼저 온 것 먼저' 분할 발송(첫 배송 → 두 번째 발송 기록)까지 실 UI/API/DB 로 교차 확인한다.
// 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39. 생성물은 대장에 남긴다(주문·정산 자동 정리 없음).
// 실행: pnpm -F e2e journey:bom:22
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  completeBankTransferOrder,
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
const SET_QTY = 2;
const SPARE_QTY = 1;
const FACTOR = SET_QTY + SPARE_QTY; // neededQty = bomQty × (setQty + spareQty)
const BUYER = 'e2eBOM부품확인';

interface LinePlan {
  key: 'stock' | 'moq' | 'normal' | 'supply';
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  unitPrice: number;
}

const LINES: LinePlan[] = [
  { key: 'stock', mpn: `E2E-BOMC-STOCK-${RUN_KEY}`, manufacturerName: 'Murata', description: 'MLCC 100nF 50V 0402 (재고 소진 fixture)', bomQty: 2, unitPrice: 500 },
  { key: 'moq', mpn: `E2E-BOMC-MOQ-${RUN_KEY}`, manufacturerName: 'Texas Instruments', description: 'LDO regulator (MOQ 증가 fixture)', bomQty: 1, unitPrice: 1_200 },
  { key: 'normal', mpn: `E2E-BOMC-NORMAL-${RUN_KEY}`, manufacturerName: 'TE Connectivity', description: 'Connector (정상 조달 fixture)', bomQty: 1, unitPrice: 2_000 },
  { key: 'supply', mpn: `E2E-BOMC-SUPPLY-${RUN_KEY}`, manufacturerName: 'Nexperia', description: 'ESD diode (사급·환불 fixture)', bomQty: 1, unitPrice: 800 },
];
const SUB_MPN = `E2E-BOMC-SUB-${RUN_KEY}`;
const SUB_UNIT = 650;
const MOQ_QTY = 10;
const SPLIT_FEE = 3_000;
const SHIPPING_FEE = 3_000;
const MANAGEMENT_FEE = 1_500;

const vat = (n: number): number => Math.round(n * 1.1);
const needed = (line: LinePlan): number => line.bomQty * FACTOR;
const lineTotal = (line: LinePlan): number => needed(line) * line.unitPrice;
const line = (key: LinePlan['key']): LinePlan => {
  const found = LINES.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`fixture line ${key} 없음`);
  return found;
};

// 금액 기대값 — 관리자 입력 차액 = 서버 참고값(새 라인 − 원 라인, ×1.1)과 같게 넣는다.
const SUB_DELTA = vat(needed(line('stock')) * SUB_UNIT) - vat(lineTotal(line('stock')));
const MOQ_DELTA = vat(MOQ_QTY * line('moq').unitPrice) - vat(lineTotal(line('moq')));
const STOCK_SUPPLY_DELTA = -vat(lineTotal(line('stock')));
const MOQ_SUPPLY_DELTA = -vat(lineTotal(line('moq')));
const SUPPLY_REFUND = vat(lineTotal(line('supply')));
const ITEMS_TOTAL = LINES.reduce((sum, entry) => sum + lineTotal(entry), 0);
const CONFIRMED_TOTAL = ITEMS_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE;
const ORDER_AMOUNT = vat(CONFIRMED_TOTAL);
// 요청 #1 고객 선택: 재고 소진 = B 입고 대기(나눠 받기, 두 번째 배송비) · MOQ 증가 = A MOQ 구매.
const CHARGE_AMOUNT = SPLIT_FEE + MOQ_DELTA;

const won = (n: number): string => `${Math.abs(n).toLocaleString('ko-KR')}원`;

function kstYmd(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

interface Seeded {
  quoteId: string;
  title: string;
  itemIds: Record<LinePlan['key'], string>;
  candidateKey: string;
  offerKey: string;
}

function selectedOffer(entry: LinePlan, index: number): Record<string, unknown> {
  return {
    offerKey: `ok2:e2e22-${entry.key}-${RUN_KEY}`,
    supplier: 'digikey', // 공급사 구매 조건 — DigiKey 파트너(supplierCode) 그룹으로 발주 초안이 잡힌다
    supplierSku: `E2E22-${entry.key.toUpperCase()}-${String(index + 1)}`,
    packaging: 'Cut Tape',
    breakQty: 1,
    unitPrice: entry.unitPrice,
    currency: 'KRW',
    unitPriceKrw: entry.unitPrice,
    moq: 1,
    orderMultiple: 1,
    stock: 10_000,
    priceBreaks: [{ qty: 1, price: entry.unitPrice }],
    fetchedAt: new Date().toISOString(),
    pinned: true,
  };
}

/** 재고 소진 품목의 대체 후보 — 엔진 필수조건 판정(requirementAssessments)까지 박제된 스냅샷. */
function substituteCandidate(candidateKey: string, offerKey: string, requiredQty: number): Record<string, unknown> {
  const unitPrice = SUB_UNIT;
  const lineTotalKrw = unitPrice * requiredQty;
  return {
    candidateKey,
    identityKey: candidateKey,
    technicalRank: 1,
    technicalReviewRank: null,
    selectionRecommendation: 'candidate_only',
    reviewRecommended: false,
    status: 'matched',
    selectionMode: 'spec-compatible',
    safety: 'safe',
    selectionEligibility: 'manual_review',
    autoEligible: false,
    manualSelectable: true,
    selectionReasonCodes: ['fixture-spec-compatible'],
    mpn: SUB_MPN,
    manufacturerName: 'Samsung Electro-Mechanics',
    description: 'MLCC 100nF 100V 0402 X7R (대체 후보)',
    category: 'capacitor',
    packageCode: '0402',
    lifecycleStatus: 'Active',
    lifecycleState: 'active',
    lifecycleCode: 'active',
    lastBuyDate: null,
    lifecycleSources: [],
    replacementSources: [],
    replacementForMpn: null,
    replacementType: null,
    datasheetUrl: 'https://example.com/e2e22-datasheet.pdf',
    imageUrl: null,
    identityConfidence: 0.9,
    specificationConfidence: 1,
    conflicts: [],
    missingRequirements: [],
    reasons: ['정전용량·패키지가 같고 정격전압이 더 높습니다.'],
    corroboratingSuppliers: ['digikey'],
    verifiedRequirementCount: 3,
    requiredRequirementCount: 3,
    requirementAssessments: [
      { key: 'capacitance_f', comparison: 'eq', state: 'match', verified: true, expectedDisplay: '100 nF', actualDisplay: '100 nF', source: 'bom' },
      { key: 'voltage_v', comparison: 'gte', state: 'match', verified: true, expectedDisplay: '50 V', actualDisplay: '100 V', source: 'bom' },
      { key: 'package', comparison: 'eq', state: 'match', verified: true, expectedDisplay: '0402', actualDisplay: '0402', source: 'bom' },
    ],
    verificationComplete: true,
    strictCategoryCoverage: true,
    technicalEvidenceKey: candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: { capacitance_f: 1e-7, voltage_v: 100, package: '0402' },
    specComparisons: {},
    packageComparison: null,
    offers: [
      {
        offerKey,
        supplier: 'digikey',
        offerKind: 'supplier_offer',
        supplierSku: `E2E22-SUB-${RUN_KEY}`,
        packaging: 'Cut Tape',
        stock: 8_000,
        moq: 1,
        orderMultiple: 1,
        productUrl: null,
        leadTime: '재고 즉시',
        fetchedAt: new Date().toISOString(),
        priceBreaks: [{ qty: 1, price: unitPrice, currency: 'KRW' }],
        procurementDecision: {
          procurement_policy_version: 'supplier-procurement-decision-v1',
          procurement_mode: 'sample',
          offer_key_version: 'supplier-offer-key-v2',
          rank_scope: 'identity_and_technical_evidence',
          offer_key: offerKey,
          calculation_status: 'calculated',
          required_quantity: requiredQty,
          order_quantity: requiredQty,
          applied_price_break_quantity: 1,
          source_unit_price: unitPrice,
          source_currency: 'KRW',
          exchange_rate: 1,
          target_currency: 'KRW',
          converted_unit_price: unitPrice,
          line_total: lineTotalKrw,
          stock_short: false,
          stock_short_quantity: 0,
          surplus_quantity: 0,
          excessive_order: false,
          price_rank: 1,
          purchase_fit_rank: 1,
          purchasable: true,
          recommendation: 'manual_review',
          reason_codes: [],
        },
      },
    ],
    procurementDecision: {
      procurement_policy_version: 'supplier-procurement-decision-v1',
      selection_application_policy_version: 'supplier-selection-application-v3',
      status: 'review_recommended',
      selection_application_state: 'provisional_selected',
      confirmation_required: true,
      unavailability_reason_policy_version: 'supplier-procurement-unavailability-v1',
      primary_unavailability_reason: null,
      required_quantity: requiredQty,
      target_currency: 'KRW',
      currency_rate_snapshot_id: `e2e-journey-22-${RUN_KEY}`,
      currency_rate_as_of: new Date().toISOString(),
      currency_rate_source: 'e2e-fixture',
      technical_preselection_identity_key: candidateKey,
      technical_preselection_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      application_candidate_identity_key: candidateKey,
      application_candidate_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      technical_fallback_used: false,
      price_optimization_used: false,
      automatic_offer_key: null,
      review_offer_key: offerKey,
      recommendation_reason_codes: ['fixture-review'],
    },
    engineCandidates: [],
    procurementDisposition: 'eligible',
    quantityResolution: 'verified',
    dispositionReasonCodes: [],
  };
}

async function seedAnsweredQuote(mbId: string): Promise<Seeded> {
  const prisma = getPrisma();
  const now = new Date();
  const candidateKey = `ik1:e2e22-sub-${RUN_KEY}`;
  const offerKey = `ok2:e2e22-sub-${RUN_KEY}`;
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 22호] 결제 후 부품 확인 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: SET_QTY,
        spareQty: SPARE_QTY,
        itemsTotal: ITEMS_TOTAL,
        shippingFee: SHIPPING_FEE,
        managementFee: MANAGEMENT_FEE,
        finalTotal: CONFIRMED_TOTAL,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 60_000),
        answeredAt: now,
        answerNote: '결제 후 부품 확인 요청(D43) 여정 확정 견적입니다.',
        adminMemo: `[BOM 여정 22호 ${RUN_KEY}] post-payment confirm fixture`,
        confirmedShippingFee: SHIPPING_FEE,
        confirmedManagementFee: MANAGEMENT_FEE,
        confirmedTotal: CONFIRMED_TOTAL,
      },
    });
    const itemIds = {} as Record<LinePlan['key'], string>;
    for (const [index, entry] of LINES.entries()) {
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          mpn: entry.mpn,
          manufacturerName: entry.manufacturerName,
          description: entry.description,
          bomQty: entry.bomQty,
          orderQty: needed(entry),
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: lineTotal(entry),
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: selectedOffer(entry, index),
        },
      });
      itemIds[entry.key] = String(item.id);
      if (entry.key === 'stock') {
        await tx.spBomQuoteCandidate.create({
          data: {
            quoteId: quote.id,
            quoteItemId: item.id,
            candidateKey,
            technicalRank: 1,
            status: 'matched',
            selectionMode: 'spec-compatible',
            safety: 'safe',
            autoEligible: false,
            mpn: SUB_MPN,
            manufacturerName: 'Samsung Electro-Mechanics',
            payload: substituteCandidate(candidateKey, offerKey, needed(entry)),
          },
        });
      }
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds, candidateKey, offerKey };
  });
}

/** 선행 조달·입고 완료 fixture — 닫힌 발주서 + 도착한 선적(배송 게이트의 입고 계산 대상). */
async function seedReceivedPo(
  quoteId: string,
  partnerName: string,
  items: Array<{ itemId: string; entry: LinePlan; qty: number }>,
): Promise<{ poId: string; shipmentId: string }> {
  const partner = await getPartner(partnerName);
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.spBomPo.create({
      data: {
        quoteId: BigInt(quoteId),
        partnerId: partner.id,
        status: 'closed',
        totalAmount: items.reduce((sum, row) => sum + row.qty * row.entry.unitPrice, 0),
        currency: 'KRW',
        memo: `[BOM 여정 22호 ${RUN_KEY}] 선행 입고 fixture`,
        confirmedAt: now,
        closedAt: now,
        items: {
          create: items.map((row) => ({
            quoteItemId: BigInt(row.itemId),
            mpn: row.entry.mpn,
            manufacturerName: row.entry.manufacturerName,
            description: row.entry.description,
            qty: row.qty,
            unitPrice: row.entry.unitPrice,
            lineTotal: row.qty * row.entry.unitPrice,
            moq: 1,
            stock: row.qty + 100,
          })),
        },
      },
      include: { items: true },
    });
    const shipment = await tx.spBomShipment.create({
      data: {
        poId: po.id,
        quoteId: BigInt(quoteId),
        mode: 'domestic',
        status: 'delivered',
        carrier: 'E2E 국내택배',
        trackingNumber: `BOMC-INBOUND-${partnerName}-${RUN_KEY}`,
        shippedAt: new Date(now.getTime() - 60_000),
        receivedAt: now,
        receivedNote: `[BOM 여정 22호 ${RUN_KEY}] 입고 확인`,
        completedAt: now,
      },
    });
    await tx.spBomShipmentPo.create({ data: { shipmentId: shipment.id, poId: po.id } });
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

interface OrderMoney {
  status: string;
  cartPrice: number;
  receiptPrice: number;
  refundPrice: number;
  misu: number;
}

async function readOrderMoney(odId: string): Promise<OrderMoney> {
  const rows = await getPrisma().$queryRawUnsafe(
    `SELECT od_status AS status, od_cart_price AS cartPrice, od_receipt_price AS receiptPrice,
            od_refund_price AS refundPrice, od_misu AS misu
       FROM g5_shop_order WHERE od_id = ?`,
    odId,
  ) as any[];
  const row = rows[0];
  if (row === undefined) throw new Error(`주문 ${odId} 없음`);
  return {
    status: String(row.status),
    cartPrice: Number(row.cartPrice),
    receiptPrice: Number(row.receiptPrice),
    refundPrice: Number(row.refundPrice),
    misu: Number(row.misu),
  };
}

async function readCartRows(odId: string): Promise<Array<{ itId: string; ioId: string; ioPrice: number; ctStatus: string }>> {
  const rows = await getPrisma().$queryRawUnsafe(
    `SELECT it_id AS itId, io_id AS ioId, io_price AS ioPrice, ct_status AS ctStatus
       FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id`,
    odId,
  ) as any[];
  return rows.map((row) => ({
    itId: String(row.itId),
    ioId: String(row.ioId),
    ioPrice: Number(row.ioPrice),
    ctStatus: String(row.ctStatus),
  }));
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 22호 — 결제 후 부품 확인 요청(차액 정산)', () => {
  const rp = createJourneyReport(
    'findings-bom-confirm',
    'BOM 여정 22호 결제 후 부품 확인 요청(재고 소진·MOQ 증가 → 고객 선택 → 적용·정산) 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let customerToken = '';
  let adminToken = '';
  let seeded: Seeded | null = null;
  let odId: string | null = null;
  let extraOdId: string | null = null;
  let r1: any = null; // 요청 #1 — 재고 소진 + MOQ 증가(추가결제 경로)
  let r2: any = null; // 요청 #2 — 재고 소진(사급 → 환불 경로)

  const adminCase = async (): Promise<any> => {
    const res = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded?.quoteId ?? '0'}/confirms`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data;
  };
  const adminRequest = async (id: string): Promise<any> => {
    const data = await adminCase();
    const found = data.requests.find((request: any) => request.id === id);
    if (found === undefined) throw new Error(`관리자 Case 뷰에 요청 #${id} 없음`);
    return found;
  };
  const customerRequests = async (): Promise<any[]> => {
    const res = await api(customerToken, 'GET', `/api/bom/confirms?odId=${odId ?? ''}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data.requests;
  };
  const issueOf = (request: any, itemKey: LinePlan['key']): any => {
    const found = request.issues.find((issue: any) => issue.quoteItemId === seeded?.itemIds[itemKey]
      || issue.evidence?.part?.mpn === line(itemKey).mpn);
    if (found === undefined) throw new Error(`요청 #${String(request.id)} 에 ${itemKey} 이슈 없음`);
    return found;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    customerToken = signJwt({ mbId: customer.mbId, ttlSec: 7_200 });
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('B01. 확정 견적 주문 → 결제 전 요청 차단(NOT_PAID) → 입금 → 요청 가능', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}) — 품목 4·대체 후보 1`);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'B01',
      prefix: 'B01-bomc-order',
      buyerName: BUYER,
      expectedOrderAmount: ORDER_AMOUNT,
      expectedAppliedSetQty: FACTOR,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId}(원 BOM 주문 — 환불 감액 대상)`);

    const before = await adminCase();
    expect(before.eligibility).toMatchObject({ canCreate: false, reason: 'NOT_PAID', odId });
    const early = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.stock,
        issueType: 'stock_out',
        description: '결제 전에는 품목 교체+재회신 경로를 쓴다.',
        observation: {},
        options: [{ kind: 'customer_supply', priceDelta: STOCK_SUPPLY_DELTA }],
      }],
    });
    expect(early.status, JSON.stringify(early.json)).toBe(409);
    expect(early.json?.error).toBe('NOT_PAID');

    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const after = await adminCase();
    expect(after.eligibility).toMatchObject({ canCreate: true, reason: null, odId });
    expect(after.items.map((item: any) => item.fulfillment)).toEqual(['normal', 'normal', 'normal', 'normal']);
    const money = await readOrderMoney(odId);
    expect(money).toMatchObject({ status: '입금', cartPrice: ORDER_AMOUNT, misu: 0 });
    F('B01', 'obs', `결제 전 요청은 NOT_PAID, 입금 뒤 요청 가능 — 원 주문 ${won(ORDER_AMOUNT)}`);
  }, 300_000);

  test('B02. 관리자 요청 2건 — 유형별 선택지(A·B·C + 상담)·근거 박제·고객 DTO 비노출', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const dueOn = kstYmd(3);
    const created1 = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      message: '[여정 22호] 결제 후 구매 단계에서 두 부품에 문제가 생겼습니다. 부품마다 처리 방법을 골라 주세요.',
      dueOn,
      sendMail: true,
      issues: [
        {
          quoteItemId: seeded.itemIds.stock,
          issueType: 'stock_out',
          description: '주문확정 후 지정부품 재고가 소진되었습니다.',
          observation: { sourceLabel: 'DigiKey', stock: 0, leadTime: '12주', note: '공급사 재고 0 — 입고 예정 공지 확인' },
          options: [
            { kind: 'substitute', priceDelta: SUB_DELTA, replacement: { source: 'candidate', candidateKey: seeded.candidateKey, offerKey: seeded.offerKey } },
            {
              kind: 'wait_restock',
              priceDelta: 0,
              restock: { expectedOn: kstYmd(14), basis: 'DigiKey 입고 예정 공지', maxWaitOn: kstYmd(30), splitAllowed: true, splitShippingFee: SPLIT_FEE },
            },
            { kind: 'customer_supply', priceDelta: STOCK_SUPPLY_DELTA },
          ],
        },
        {
          quoteItemId: seeded.itemIds.moq,
          issueType: 'moq_increase',
          description: '실제 공급사 MOQ가 계약수량보다 많습니다.',
          observation: { sourceLabel: 'DigiKey', stock: 5_000, moq: MOQ_QTY },
          options: [
            { kind: 'moq_purchase', priceDelta: MOQ_DELTA, moqOrderQty: MOQ_QTY },
            { kind: 'customer_supply', priceDelta: MOQ_SUPPLY_DELTA },
          ],
        },
      ],
    });
    expect(created1.status, JSON.stringify(created1.json)).toBe(200);
    r1 = created1.json.data.request;
    ledger.push(`sp_bom_confirm_request #${String(r1.id)}(재고 소진+MOQ 증가 — 추가결제 경로)`);
    F('B02', 'obs', `요청 메일(bom_confirm_request) 전달 상태=${String(created1.json.data.mail.status)}${created1.json.data.mail.reason ? ` (${String(created1.json.data.mail.reason)})` : ''}`);

    expect(r1).toMatchObject({ status: 'requested', odId, version: 1, netDelta: null, settlement: null });
    const stock = issueOf(r1, 'stock');
    const moq = issueOf(r1, 'moq');
    expect(stock.options.map((option: any) => `${String(option.code)}:${String(option.kind)}`)).toEqual([
      'A:substitute', 'B:wait_restock', 'C:customer_supply', 'D:consult',
    ]);
    expect(moq.options.map((option: any) => `${String(option.code)}:${String(option.kind)}`)).toEqual([
      'A:moq_purchase', 'B:customer_supply', 'C:consult',
    ]);
    expect(moq.options[1].title, 'MOQ 증가의 사급은 전량 사급').toBe('고객 사급(해당 부품 전량)');
    // 근거 박제 — 원 부품·관찰·대체품(엔진 판정)·MOQ 계획
    expect(stock.evidence.part).toMatchObject({
      mpn: line('stock').mpn,
      neededQty: needed(line('stock')),
      orderQty: needed(line('stock')),
      unitPriceKrw: line('stock').unitPrice,
      supplierLabel: 'DigiKey',
    });
    expect(stock.evidence.observation).toMatchObject({ stock: 0, leadTime: '12주' });
    const substitute = stock.options[0];
    expect(substitute.referenceDelta, '서버 참고 차액').toBe(SUB_DELTA);
    expect(substitute.replacement).toMatchObject({
      source: 'candidate',
      mpn: SUB_MPN,
      unitPriceKrw: SUB_UNIT,
      orderQty: needed(line('stock')),
      leadTime: '재고 즉시',
    });
    expect(substitute.replacement.engine).toMatchObject({ selectionMode: 'spec-compatible', safety: 'safe' });
    expect(substitute.replacement.engine.requirements.map((row: any) => row.label)).toEqual(['정전용량', '정격전압', '패키지']);
    expect(moq.options[0].moq).toMatchObject({
      neededQty: needed(line('moq')),
      orderQty: MOQ_QTY,
      surplusQty: MOQ_QTY - needed(line('moq')),
    });
    expect(moq.options[0].referenceDelta).toBe(MOQ_DELTA);
    expect(stock.options[1].restock).toMatchObject({ splitAllowed: true, splitShippingFee: SPLIT_FEE });

    const created2 = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      message: '[여정 22호] 보호 다이오드 한 종의 재고가 소진되었습니다.',
      dueOn,
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.supply,
        issueType: 'stock_out',
        description: '주문확정 후 지정부품 재고가 소진되었습니다.',
        observation: { sourceLabel: 'DigiKey', stock: 0 },
        options: [
          { kind: 'wait_restock', priceDelta: 0, restock: { expectedOn: kstYmd(21), basis: '제조사 생산 일정', splitAllowed: false } },
          { kind: 'customer_supply', priceDelta: -SUPPLY_REFUND },
        ],
      }],
    });
    expect(created2.status, JSON.stringify(created2.json)).toBe(200);
    r2 = created2.json.data.request;
    ledger.push(`sp_bom_confirm_request #${String(r2.id)}(사급 → 환불 경로)`);

    // 한 품목에는 열린 이슈 한 건 — 같은 품목으로 또 물을 수 없다.
    const dup = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.stock,
        issueType: 'stock_out',
        description: '중복 요청 시도입니다.',
        observation: {},
        options: [{ kind: 'customer_supply', priceDelta: STOCK_SUPPLY_DELTA }],
      }],
    });
    expect(dup.status, JSON.stringify(dup.json)).toBe(409);
    expect(dup.json?.error).toBe('ITEM_HAS_OPEN_ISSUE');

    // 고객 DTO — 내부 키·원가 참고값이 없다(협력사명·후보 키·RFQ id·SKU).
    const list = await customerRequests();
    const mine = list.filter((request) => request.id === String(r1.id) || request.id === String(r2.id));
    expect(mine.length).toBe(2);
    const raw = JSON.stringify(mine);
    for (const secret of ['candidateKey', 'offerKey', 'supplierSku', 'rfqItemId', 'referenceDelta', 'partId', 'E2E22-SUB']) {
      expect(raw.includes(secret), `고객 DTO 에 ${secret}`).toBe(false);
    }
    const customerStock = issueOf(mine.find((request) => request.id === String(r1.id)), 'stock');
    expect(customerStock.options[0].replacement.engine.requirements.length).toBe(3);
    F('B02', 'obs', `요청 #${String(r1.id)}(2품목)·#${String(r2.id)}(1품목) — 고객 DTO 내부 키 0, 엔진 판정 3행 박제`);
  }, 180_000);

  test('B03. 게이트 — 발주 CONFIRM_PENDING · 배송 BOM_FULFILLMENT_INCOMPLETE · Case 삭제 OPEN_CONFIRM · 워크큐', async (ctx) => {
    if (seeded === null || odId === null || r1 === null || r2 === null) return ctx.skip();
    const normal = line('normal');
    const po1 = await seedReceivedPo(seeded.quoteId, '협력2', [{ itemId: seeded.itemIds.normal, entry: normal, qty: needed(normal) }]);
    ledger.push(`sp_bom_po #${po1.poId}(협력2 — 정상 품목 입고 fixture)`, `sp_bom_shipment #${po1.shipmentId}`);

    const digikey = await getPrisma().spPartner.findFirst({ where: { type: 'supplier', supplierCode: 'digikey' } });
    if (digikey === null) throw new Error('DigiKey 공급사 파트너(supplierCode=digikey)가 없습니다');
    const po = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos`, { partnerIds: [Number(digikey.id)] });
    expect(po.status, JSON.stringify(po.json)).toBe(409);
    expect(po.json?.error).toBe('CONFIRM_PENDING');

    const ship = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `BOMC-EARLY-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(ship.status, JSON.stringify(ship.json)).toBe(409);
    expect(ship.json?.error).toBe('BOM_FULFILLMENT_INCOMPLETE');
    expect(String(ship.json?.message)).toContain('부품 확인 요청');

    const preview = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/force-delete-preview`);
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    expect(preview.json?.data?.blockers ?? []).toContain('OPEN_CONFIRM');

    // 고객 진행 — 정상 품목 발주서만 입고됐어도 확인 중 품목이 보류라 '입고 완료'가 아니다(22호 실측 교정).
    const progress = await api(customerToken, 'GET', `/api/order-progress?odId=${odId}`);
    expect(progress.status, JSON.stringify(progress.json)).toBe(200);
    const bomProgress = (progress.json.data.items as any[]).find((entry) => entry.track === 'bom' && entry.refId === seeded?.quoteId);
    expect(bomProgress).toMatchObject({ stage: 'procuring', shortLabel: '조달 중' });
    expect(String(bomProgress?.label)).toContain('확인이 필요한 부품');

    const queue = await api(adminToken, 'GET', `/api/admin/bom-confirms?tab=awaiting_customer&pageSize=100&search=${encodeURIComponent(seeded.quoteId)}`);
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const ids = (queue.json.data.items as any[]).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([String(r1.id), String(r2.id)]));
    F('B03', 'obs', '열린 확인 요청이 발주(DigiKey 그룹)·배송·Case 삭제를 막고 워크큐 고객 회신 대기에 선다');
  }, 180_000);

  test('B04. 고객 — 사이드바 배지·목록 → 주문 상세(4칸 형식·분석근거 팝업) → 입고 대기(나눠 받기)+MOQ 구매 회신', async (ctx) => {
    if (seeded === null || odId === null || r1 === null || r2 === null) return ctx.skip();
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/parts-confirm`, { waitUntil: 'domcontentloaded' });
    await rp.shot(customer, 'B04-parts-confirm-list');

    const mineBefore = await api(customerToken, 'GET', '/api/bom/confirms/mine?scope=open');
    expect(mineBefore.status).toBe(200);
    const nav = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.smb_nav .nav_group')].map((g) => ({
        label: g.querySelector('.nav_glabel')?.textContent?.trim() ?? '',
        items: [...g.querySelectorAll('a')].map((a) => ({
          text: a.querySelector('.lbl')?.textContent?.trim() ?? '',
          badge: a.querySelector('.nav_badge')?.textContent?.trim() ?? '',
          blue: a.querySelector('.nav_badge')?.classList.contains('on') ?? false,
          current: a.getAttribute('aria-current') === 'page',
        })),
      }));
      return groups;
    });
    const item = nav.find((g) => g.label === '확인 요청')?.items.find((i) => i.text === '부품 확인');
    expect(item, '확인 요청 › 부품 확인 메뉴').toBeTruthy();
    expect(item?.current).toBe(true);
    expect(Number(item?.badge ?? 0), '사이드바 배지 = sp-node openCount(같은 모수)').toBe(Number(mineBefore.json.data.openCount));
    expect(item?.blue, '고객 차례 파랑').toBe(true);

    const rowLinks = await page.evaluate(() =>
      [...document.querySelectorAll('.sp-eqm__item .sp-eqm__go')].map((a) => (a as HTMLAnchorElement).href));
    expect(rowLinks.some((href) => href.endsWith(`#bomc-${String(r1.id)}`))).toBe(true);
    expect(rowLinks.some((href) => href.endsWith(`#bomc-${String(r2.id)}`))).toBe(true);
    expect(await page.locator('.sp-eqm form, .sp-eqm input[type=radio]').count(), '목록에는 결정 폼이 없다').toBe(0);

    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator(`.sp-eqm__go[href$="#bomc-${String(r1.id)}"]`).click(),
    ]);
    const card = page.locator(`#bomc-${String(r1.id)}`);
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    const cardText = await card.innerText();
    for (const text of [
      '기술타입', '문제설명', '당사제안', '참고자료',
      '재고 부족', 'MOQ·주문단위 증가', '주문확정 후 지정부품 재고가 소진되었습니다.', '실제 공급사 MOQ가 계약수량보다 많습니다.',
      '대체품 승인', '입고 대기', '고객 사급', 'MOQ 구매 승인', '고객 사급(해당 부품 전량)', '상담 요청',
      `+${SUB_DELTA.toLocaleString('ko-KR')}원 추가결제`, `${(-STOCK_SUPPLY_DELTA).toLocaleString('ko-KR')}원 환불`,
    ]) {
      expect(cardText, `주문 상세 부품 확인 카드 문구: ${text}`).toContain(text);
    }
    expect(cardText.includes('E2E22-SUB'), '고객 화면에 공급사 SKU 없음').toBe(false);

    // 분석근거 팝업 — 원 부품·확인한 문제·대체품·엔진 판정 비교표
    const stockIssue = issueOf(r1, 'stock');
    const moqIssue = issueOf(r1, 'moq');
    await card.locator(`button[data-dialog="bomc-ev-${String(stockIssue.id)}"]`).click();
    const dialog = page.locator(`#bomc-ev-${String(stockIssue.id)}`);
    await dialog.waitFor({ state: 'visible' });
    const dialogText = await dialog.innerText();
    for (const text of [line('stock').mpn, '주문하신 부품', '확인한 문제', 'DigiKey', '12주', SUB_MPN, '호환 판정', '정전용량', '정격전압', '100 V', '같음']) {
      expect(dialogText, `분석근거 문구: ${text}`).toContain(text);
    }
    await rp.shot(customer, 'B04-evidence-dialog');
    await dialog.locator('[data-close]').click();
    await dialog.waitFor({ state: 'hidden' });

    // 좁은 폭에서도 가로로 터지지 않는다.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390px 가로 넘침').toBe(true);
    await rp.shot(customer, 'B04-order-detail-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });

    await card.locator(`input[name="choice[${String(stockIssue.id)}]"][value="B"]`).check();
    const ship = card.locator(`fieldset.sp_bomc_ship[data-for="B"]`);
    await ship.waitFor({ state: 'visible' });
    await ship.locator(`input[name="ship[${String(stockIssue.id)}]"][value="split"]`).check();
    await card.locator(`input[name="choice[${String(moqIssue.id)}]"][value="A"]`).check();
    await expect.poll(() => card.locator('[data-bomc-total]').innerText()).toBe(`추가결제 ${won(CHARGE_AMOUNT)}`);
    await card.locator('textarea[name="note"]').fill('여정 22호 — 나머지는 먼저 받겠습니다.');
    await rp.shot(customer, 'B04-answer-filled');

    await card.locator('.sp_eq_approve').click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.sp-dlg-msg').waitFor({ state: 'visible', timeout: 10_000 });
    expect(await page.locator('.sp-dlg-msg').innerText()).toContain(`추가결제 ${CHARGE_AMOUNT.toLocaleString('ko-KR')}원`);
    await rp.shot(customer, 'B04-answered');
    await page.locator('.sp-dlg-ok').click();

    const fresh = await adminRequest(String(r1.id));
    expect(fresh).toMatchObject({ status: 'answered', answeredRole: 'customer', answerChannel: 'web', netDelta: CHARGE_AMOUNT });
    expect(fresh.customerNote).toContain('나머지는 먼저');
    expect(issueOf(fresh, 'stock')).toMatchObject({ status: 'decided', chosenCode: 'B', shipPreference: 'split' });
    expect(issueOf(fresh, 'moq')).toMatchObject({ status: 'decided', chosenCode: 'A' });
    expect(fresh.settlement).toMatchObject({ kind: 'charge', status: 'pending', amount: CHARGE_AMOUNT, chargeKey: `bomx-${String(fresh.settlement.id)}` });
    r1 = fresh;
    F('B04', 'obs', `고객 웹 회신 — 순액 +${won(CHARGE_AMOUNT)}(분할 배송비 ${won(SPLIT_FEE)} + MOQ ${won(MOQ_DELTA)}) → 추가결제 정산 생성`);
  }, 300_000);

  test('B05. 대리 회신(전화 — 사급) → 환불 정산 · 추가결제 전 적용 차단(입고 대기는 허용)', async (ctx) => {
    if (seeded === null || r1 === null || r2 === null) return ctx.skip();
    const supplyIssue = issueOf(r2, 'supply');
    const proxy = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r2.id)}/answer`, {
      expectedVersion: r2.version,
      channel: 'phone',
      choices: [{ issueId: String(supplyIssue.id), code: 'B' }],
      note: '고객 통화 — 해당 부품은 직접 보내겠다고 함',
    });
    expect(proxy.status, JSON.stringify(proxy.json)).toBe(200);
    r2 = await adminRequest(String(r2.id));
    expect(r2).toMatchObject({ status: 'answered', answeredRole: 'admin', answerChannel: 'phone', netDelta: -SUPPLY_REFUND });
    expect(r2.settlement).toMatchObject({ kind: 'refund', status: 'pending', amount: SUPPLY_REFUND, odId });

    const moqIssue = issueOf(r1, 'moq');
    const blocked = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r1.id)}/issues/${String(moqIssue.id)}/apply`, {
      expectedVersion: r1.version,
    });
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('PAYMENT_PENDING');

    // 입고 대기는 돈이 드는 조달 변경이 아니라 결제 전에도 표시할 수 있다(backorder + 예상일).
    const stockIssue = issueOf(r1, 'stock');
    const wait = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r1.id)}/issues/${String(stockIssue.id)}/apply`, {
      expectedVersion: r1.version,
      note: '입고 예정일 추적',
    });
    expect(wait.status, JSON.stringify(wait.json)).toBe(200);
    const stockRow = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.stock) } });
    expect(stockRow?.fulfillment).toBe('backorder');
    expect(stockRow?.fulfillmentOn?.toISOString().slice(0, 10)).toBe(new Date(`${kstYmd(14)}T00:00:00+09:00`).toISOString().slice(0, 10));
    expect(stockRow?.mpn, '입고 대기는 부품을 바꾸지 않는다').toBe(line('stock').mpn);
    r1 = await adminRequest(String(r1.id));
    expect(r1.status, '추가결제 전이라 아직 처리 중').toBe('answered');
    F('B05', 'obs', '대리 회신(phone) 기록·환불 정산 생성, MOQ 적용은 PAYMENT_PENDING, 입고 대기는 선반영');
  }, 180_000);

  test('B06. 추가결제 — 주문 상세 [추가결제 하기] → sp-bom-extra 주문서 → 무통장 → 입금 확인 대기 → 입금 → paid', async (ctx) => {
    if (seeded === null || odId === null || r1 === null) return ctx.skip();
    const page = customer.page;
    // ⚠ 해시만 바꾸면 같은 문서 조각 이동이라 새로 불러오지 않는다 — 쿼리를 바꿔 새 문서로 연다(23호 C09 실측).
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}&_t=${String(Date.now())}#bomc-${String(r1.id)}`, { waitUntil: 'domcontentloaded' });
    const card = page.locator(`#bomc-${String(r1.id)}`);
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await card.innerText()).toContain(`추가결제 ${CHARGE_AMOUNT.toLocaleString('ko-KR')}원`);
    await rp.shot(customer, 'B06-charge-pending');
    await Promise.all([
      page.waitForURL('**/shop/orderform*', { timeout: 30_000 }),
      card.locator('.sp_bomc_pay').click(),
    ]);
    const orderList = await page.locator('#sod_list').innerText();
    expect(orderList).toContain('부품 BOM 추가결제');
    expect(orderList).toContain(CHARGE_AMOUNT.toLocaleString('ko-KR'));
    expect(orderList.includes('부품 BOM 주문'), '추가결제 주문서에 원 BOM 행이 섞이지 않는다').toBe(false);
    await rp.shot(customer, 'B06-extra-orderform');

    const extra = await completeBankTransferOrder(customer, rp, {
      step: 'B06',
      prefix: 'B06-extra',
      buyerName: BUYER,
      previousOdId: odId,
    });
    extraOdId = extra.odId;
    ledger.push(`g5_shop_order ${extraOdId}(부품 추가결제 주문 — sp-bom-extra)`);
    const rows = await readCartRows(extraOdId);
    expect(rows).toEqual([{ itId: 'sp-bom-extra', ioId: `bomx-${String(r1.settlement.id)}`, ioPrice: CHARGE_AMOUNT, ctStatus: '주문' }]);

    const pending = (await customerRequests()).find((request) => request.id === String(r1.id));
    expect(pending?.settlement).toMatchObject({ status: 'pending', orderPending: true, canCheckout: false, statusLabel: '입금 확인 대기' });
    const mine = await api(customerToken, 'GET', '/api/bom/confirms/mine?scope=open');
    expect((mine.json.data.requests as any[]).some((row) => row.id === String(r1.id)), '입금 확인 대기는 고객 차례가 아니다').toBe(false);

    // 추가결제 주문 상세 → 원 주문으로 잇는 안내
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${extraOdId}`, { waitUntil: 'domcontentloaded' });
    const origin = page.locator('#sp_bomc_origin');
    await origin.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await origin.innerText()).toContain('추가결제');
    expect(await origin.locator('a').getAttribute('href')).toContain(`od_id=${odId}#bomc-${String(r1.id)}`);
    await rp.shot(customer, 'B06-extra-order-origin');

    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [extraOdId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const settled = (await customerRequests()).find((request) => request.id === String(r1.id));
    expect(settled?.settlement).toMatchObject({ status: 'paid', canCheckout: false, orderPending: false });
    const again = await api(customerToken, 'POST', `/api/bom/confirms/settlements/${String(r1.settlement.id)}/checkout`);
    expect(again.status, JSON.stringify(again.json)).toBe(409);
    expect(again.json?.error).toBe('ALREADY_PAID');
    F('B06', 'obs', `추가결제 주문 ${extraOdId} — 무통장 주문 시 '입금 확인 대기', 입금 뒤 lazy 승격 paid(재결제 409)`);
  }, 300_000);

  test('B07. 적용 — MOQ 구매는 그 행만 바뀐다(확정가·다른 행 불변) → 요청 자동 처리 완료', async (ctx) => {
    if (seeded === null || r1 === null) return ctx.skip();
    const prisma = getPrisma();
    const quoteBefore = await prisma.spBomQuote.findUnique({ where: { id: BigInt(seeded.quoteId) } });
    const normalBefore = await prisma.spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.normal) } });
    r1 = await adminRequest(String(r1.id));
    const moqIssue = issueOf(r1, 'moq');
    const applied = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r1.id)}/issues/${String(moqIssue.id)}/apply`, {
      expectedVersion: r1.version,
    });
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);

    const moqRow = await prisma.spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.moq) } });
    expect(moqRow?.orderQty).toBe(MOQ_QTY);
    expect(Number(moqRow?.lineTotalKrw)).toBe(MOQ_QTY * line('moq').unitPrice);
    const quoteAfter = await prisma.spBomQuote.findUnique({ where: { id: BigInt(seeded.quoteId) } });
    expect(quoteAfter?.confirmedTotal, '확정가 불변(D25 회귀 아님)').toBe(quoteBefore?.confirmedTotal);
    expect(quoteAfter?.status, '견적 상태 불변').toBe('answered');
    const normalAfter = await prisma.spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.normal) } });
    expect(normalAfter?.orderQty).toBe(normalBefore?.orderQty);
    expect(Number(normalAfter?.lineTotalKrw)).toBe(Number(normalBefore?.lineTotalKrw));
    const event = await prisma.spBomQuoteSelectionEvent.findFirst({
      where: { quoteItemId: BigInt(seeded.itemIds.moq) },
      orderBy: { id: 'desc' },
    });
    expect(event?.reasonCodes).toEqual(expect.arrayContaining(['post-order-amend']));

    r1 = await adminRequest(String(r1.id));
    expect(r1.status, '모든 이슈 적용 + 추가결제 완료 → 자동 처리 완료').toBe('resolved');
    F('B07', 'obs', `MOQ 적용 — 그 행만 ${String(needed(line('moq')))}→${String(MOQ_QTY)}개, 확정가 ${String(quoteBefore?.confirmedTotal)} 불변, 요청 #${String(r1.id)} resolved`);
  }, 180_000);

  test('B08. 환불 — 사급 적용(발주 초안 제외) → 원 주문 감액(과입금) → 환불 기록(미수 0) → 처리 완료', async (ctx) => {
    if (seeded === null || odId === null || r2 === null) return ctx.skip();
    r2 = await adminRequest(String(r2.id));
    const supplyIssue = issueOf(r2, 'supply');
    const applied = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r2.id)}/issues/${String(supplyIssue.id)}/apply`, {
      expectedVersion: r2.version,
    });
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);
    const supplyRow = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.supply) } });
    expect(supplyRow?.fulfillment).toBe('customer_supply');

    const before = await readOrderMoney(odId);
    const settlementId = String(r2.settlement.id);
    const reduced = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/settlements/${settlementId}/reduce`, {});
    expect(reduced.status, JSON.stringify(reduced.json)).toBe(200);
    const bomRow = (await readCartRows(odId)).find((row) => row.itId === 'sp-bom-parts');
    expect(bomRow?.ioPrice, 'BOM 주문행 금액 감액').toBe(ORDER_AMOUNT - SUPPLY_REFUND);
    const afterReduce = await readOrderMoney(odId);
    expect(afterReduce.cartPrice).toBe(before.cartPrice - SUPPLY_REFUND);
    expect(afterReduce.misu, '과입금(미수 음수)').toBe(-SUPPLY_REFUND);

    const refunded = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/settlements/${settlementId}/refund`, {
      note: '여정 22호 무통장 송금',
    });
    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    const afterRefund = await readOrderMoney(odId);
    expect(afterRefund.refundPrice).toBe(before.refundPrice + SUPPLY_REFUND);
    expect(afterRefund.misu, '환불 기록 뒤 미수 0').toBe(0);

    r2 = await adminRequest(String(r2.id));
    expect(r2.status).toBe('resolved');
    expect(r2.settlement).toMatchObject({ status: 'refunded' });
    F('B08', 'obs', `환불 ${won(SUPPLY_REFUND)} — 행 감액(미수 ${String(afterReduce.misu)}) → 환불 기록(미수 ${String(afterRefund.misu)}), 요청 #${String(r2.id)} resolved`);
  }, 180_000);

  test('B09. 배송 — 먼저 온 부품 먼저(입고 대기 제외) 첫 배송 → 새 요청 ORDER_CLOSED → 두 번째 발송 기록', async (ctx) => {
    if (seeded === null || odId === null || r1 === null) return ctx.skip();
    const moq = line('moq');
    const po2 = await seedReceivedPo(seeded.quoteId, '협력1', [{ itemId: seeded.itemIds.moq, entry: moq, qty: MOQ_QTY }]);
    ledger.push(`sp_bom_po #${po2.poId}(협력1 — MOQ 구매 입고 fixture)`, `sp_bom_shipment #${po2.shipmentId}`);

    // 나눠 받기 입고 대기는 첫 배송을 막지 않으니 진행도 붙잡지 않는다(배송 게이트와 같은 기준).
    const progress = await api(customerToken, 'GET', `/api/order-progress?odId=${odId}`);
    const bomProgress = (progress.json.data.items as any[]).find((entry) => entry.track === 'bom' && entry.refId === seeded?.quoteId);
    expect(bomProgress).toMatchObject({ stage: 'received' });

    const shipped = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `BOMC-FIRST-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);

    const late = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.normal,
        issueType: 'stock_out',
        description: '배송 뒤에는 클레임으로 처리한다.',
        observation: {},
        options: [{ kind: 'customer_supply', priceDelta: -1 }],
      }],
    });
    expect(late.status, JSON.stringify(late.json)).toBe(409);
    expect(late.json?.error).toBe('ORDER_CLOSED');

    r1 = await adminRequest(String(r1.id));
    const stockIssue = issueOf(r1, 'stock');
    const followup = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${String(r1.id)}/issues/${String(stockIssue.id)}/followup`, {
      expectedVersion: r1.version,
      carrier: 'CJ대한통운',
      invoice: `BOMC-SECOND-${RUN_KEY}`,
    });
    expect(followup.status, JSON.stringify(followup.json)).toBe(200);
    const stockRow = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.stock) } });
    expect(stockRow?.fulfillment, '두 번째 발송 뒤 입고 대기 해제').toBe('normal');
    F('B09', 'obs', '나눠 받기 입고 대기는 첫 배송을 막지 않고, 두 번째 발송(택배사·송장)이 이슈에 기록됨');
  }, 180_000);

  test('B10. 고객·관리자 화면 — 처리 완료·추가결제 완료·환불 완료·두 번째 발송·대리 회신 표기', async (ctx) => {
    if (seeded === null || odId === null || r1 === null || r2 === null) return ctx.skip();
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, { waitUntil: 'domcontentloaded' });
    const card1 = page.locator(`#bomc-${String(r1.id)}`);
    await card1.waitFor({ state: 'visible', timeout: 30_000 });
    const text1 = await card1.innerText();
    for (const text of ['처리 완료', '선택하신 처리', '반영 완료', '먼저 온 부품 먼저 받기', '나머지 부품 발송', 'CJ대한통운', `BOMC-SECOND-${RUN_KEY}`, '추가결제 완료']) {
      expect(text1, `요청 #1 완료 카드: ${text}`).toContain(text);
    }
    expect(await card1.locator('form, .sp_bomc_pay').count(), '끝난 요청에는 폼·결제 버튼이 없다').toBe(0);
    const text2 = await page.locator(`#bomc-${String(r2.id)}`).innerText();
    for (const text of ['처리 완료', '환불 완료', '전화·메일로 주신 회신을 담당자가 대신 입력했습니다.']) {
      expect(text2, `요청 #2 완료 카드: ${text}`).toContain(text);
    }
    await rp.shot(customer, 'B10-order-detail-done');

    await page.goto(`${BASE_URL}/shop/parts-confirm?scope=all`, { waitUntil: 'domcontentloaded' });
    const allText = await page.locator('.sp-eqm__list').innerText();
    expect(allText).toContain(seeded.title);
    expect(allText).toContain('처리 완료');
    const mine = await api(customerToken, 'GET', '/api/bom/confirms/mine?scope=open');
    const openIds = (mine.json.data.requests as any[]).map((row) => row.id);
    expect(openIds).not.toContain(String(r1.id));
    expect(openIds).not.toContain(String(r2.id));
    await rp.shot(customer, 'B10-parts-confirm-all');

    await rp.assertView(adminView, `/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms`, 'B10-admin-case-confirm-panel', [
      '부품 확인 요청',
      '처리 완료',
      '추가결제 완료',
      '환불 완료',
    ]);
    await rp.assertView(adminView, '/app/admin/smartbom/confirms', 'B10-admin-confirm-queue', ['부품 확인']);
    const preview = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/force-delete-preview`);
    expect(preview.json?.data?.blockers ?? []).not.toContain('OPEN_CONFIRM');
    F('B10', 'obs', '고객 주문 상세·목록·관리자 패널이 같은 결말(처리 완료·정산 완료)을 보이고 Case 삭제 차단이 풀림');
  }, 240_000);
});
