// Smart BOM 완주 여정 23호 — 결제 후 부품 확인(D43) 관리자 화면 조작 + 예외 경로.
//
// 22호가 요청·적용·정산을 API 로 부르고 고객 화면(PHP)을 조작했다면, 23호는 **관리자 화면(sp-vue)을 손으로**
// 조작한다: 요청 작성 패널(넓은 오른쪽 패널 — 품목 선택·유형 전환·선택지 켜고 끄기·후보 서랍에서 대체품 고르기·MOQ 수량·입고
// 대기 근거·기한), 대리 회신 모달, 적용·선적용 확인창, 감액·환불 기록·정산 취소·요청 취소 입력창, 업무 목록
// 탭·검색·Case 열기. 그리고 22호가 지나지 않은 예외 경로를 연다:
//   · 발주서에 든 품목 — 공급사 [구매 완료] CONFIRM_PENDING → 적용 ITEM_IN_PO → 발주서 삭제 뒤 적용 → 사급은 발주 초안 제외
//   · 추가결제 주문을 이미 낸 요청 — 요청 취소 NOT_CANCELABLE · 정산 취소 CHARGE_ORDER_PLACED → 선적용 → 입금 뒤 자동 완료
//   · 주문서만 연 추가결제 — 정산 취소가 담긴 카트행을 치운다 → 당사 부담으로 적용
//   · '모아서 한 번에' 입고 대기 — 입고 전 배송 차단·진행 '입고를 기다리는 부품' → 입고 뒤 배송
//   · 상담 요청은 변경 없이 닫힘 · 기한 지남 표시 · 다른 고객 404 · 열린 화면에서 요청이 취소된 뒤 제출
//   · 메일 — 고객 메일은 주문 상세(#bomc-{id})로 가는 링크 하나뿐, 선택 버튼·공급망 정보 없음(Mailpit)
// 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39. 생성물은 대장에 남긴다.
// 실행: pnpm -F e2e journey:bom:23   (Mailpit 127.0.0.1:8025/25 필요 — docs/LOCAL_MAIL_TESTING.md)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  MAILPIT_URL,
  RUN,
  SECOND_CUSTOMER_ID,
  api,
  closeBrowser,
  completeBankTransferOrder,
  createJourneyReport,
  disconnectPrisma,
  ensureSecondCustomer,
  getPartner,
  getPrisma,
  mailpitMessage,
  mailpitSearch,
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
const BUYER = 'e2eBOM부품확인2';
const SHIPPING_FEE = 3_000;
const MANAGEMENT_FEE = 1_500;

type LineKey = 'sub' | 'po' | 'together' | 'consult' | 'moq';
interface LinePlan {
  key: LineKey;
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number; // setQty 1 · spareQty 0 → 필요수량 = bomQty
  unitPrice: number;
  supplier: 'digikey' | 'unikeyic';
}

const LINES: LinePlan[] = [
  { key: 'sub', mpn: `E2E-BOMC23-SUB-${RUN_KEY}`, manufacturerName: 'Murata', description: 'MLCC 100nF 50V 0402 (대체품 fixture)', bomQty: 10, unitPrice: 100, supplier: 'digikey' },
  { key: 'po', mpn: `E2E-BOMC23-PO-${RUN_KEY}`, manufacturerName: 'Vishay', description: 'Resistor array (발주서 선행 fixture)', bomQty: 5, unitPrice: 400, supplier: 'unikeyic' },
  { key: 'together', mpn: `E2E-BOMC23-WAIT-${RUN_KEY}`, manufacturerName: 'ROHM', description: 'Schottky diode (모아서 입고 대기 fixture)', bomQty: 4, unitPrice: 250, supplier: 'digikey' },
  { key: 'consult', mpn: `E2E-BOMC23-CONSULT-${RUN_KEY}`, manufacturerName: 'STMicroelectronics', description: 'MCU (상담 요청 fixture)', bomQty: 2, unitPrice: 1_000, supplier: 'digikey' },
  { key: 'moq', mpn: `E2E-BOMC23-MOQ-${RUN_KEY}`, manufacturerName: 'Texas Instruments', description: 'Op-amp (정산 취소 fixture)', bomQty: 3, unitPrice: 600, supplier: 'digikey' },
];
const SUB_MPN = `E2E-BOMC23-ALT-${RUN_KEY}`;
const SUB_UNIT = 130;
const CONSULT_MOQ = 50;
const MOQ_QTY = 10;

const vat = (n: number): number => Math.round(n * 1.1);
const line = (key: LineKey): LinePlan => {
  const found = LINES.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`fixture line ${key} 없음`);
  return found;
};
const lineTotal = (entry: LinePlan): number => entry.bomQty * entry.unitPrice;
const SUB_DELTA = vat(line('sub').bomQty * SUB_UNIT) - vat(lineTotal(line('sub')));
const PO_SUPPLY_REFUND = vat(lineTotal(line('po')));
const MOQ_DELTA = vat(MOQ_QTY * line('moq').unitPrice) - vat(lineTotal(line('moq')));
const ITEMS_TOTAL = LINES.reduce((sum, entry) => sum + lineTotal(entry), 0);
const CONFIRMED_TOTAL = ITEMS_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE;
const ORDER_AMOUNT = vat(CONFIRMED_TOTAL);

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
  itemIds: Record<LineKey, string>;
  candidateKey: string;
}

function selectedOffer(entry: LinePlan, index: number): Record<string, unknown> {
  return {
    offerKey: `ok2:e2e23-${entry.key}-${RUN_KEY}`,
    supplier: entry.supplier, // supplierCode 매핑 — DigiKey·UniKeyIC 공급사 파트너 그룹으로 발주 초안이 잡힌다
    supplierSku: `E2E23-${entry.key.toUpperCase()}-${String(index + 1)}`,
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

/** 대체 후보 스냅샷(22호와 같은 모양) — 관리자 후보 서랍에 '검토 후 선택'으로 뜬다. */
function substituteCandidate(candidateKey: string, requiredQty: number): Record<string, unknown> {
  const offerKey = `ok2:e2e23-alt-${RUN_KEY}`;
  const decision = {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    procurement_mode: 'sample',
    offer_key_version: 'supplier-offer-key-v2',
    rank_scope: 'identity_and_technical_evidence',
    offer_key: offerKey,
    calculation_status: 'calculated',
    required_quantity: requiredQty,
    order_quantity: requiredQty,
    applied_price_break_quantity: 1,
    source_unit_price: SUB_UNIT,
    source_currency: 'KRW',
    exchange_rate: 1,
    target_currency: 'KRW',
    converted_unit_price: SUB_UNIT,
    line_total: SUB_UNIT * requiredQty,
    stock_short: false,
    stock_short_quantity: 0,
    surplus_quantity: 0,
    excessive_order: false,
    price_rank: 1,
    purchase_fit_rank: 1,
    purchasable: true,
    recommendation: 'manual_review',
    reason_codes: [],
  };
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
    datasheetUrl: null,
    imageUrl: null,
    identityConfidence: 0.9,
    specificationConfidence: 1,
    conflicts: [],
    missingRequirements: [],
    reasons: ['정전용량·패키지가 같고 정격전압이 더 높습니다.'],
    corroboratingSuppliers: ['digikey'],
    verifiedRequirementCount: 2,
    requiredRequirementCount: 2,
    requirementAssessments: [
      { key: 'capacitance_f', comparison: 'eq', state: 'match', verified: true, expectedDisplay: '100 nF', actualDisplay: '100 nF', source: 'bom' },
      { key: 'voltage_v', comparison: 'gte', state: 'match', verified: true, expectedDisplay: '50 V', actualDisplay: '100 V', source: 'bom' },
    ],
    verificationComplete: true,
    strictCategoryCoverage: true,
    technicalEvidenceKey: candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: { capacitance_f: 1e-7, voltage_v: 100 },
    specComparisons: {},
    packageComparison: null,
    offers: [{
      offerKey,
      supplier: 'digikey',
      offerKind: 'supplier_offer',
      supplierSku: `E2E23-ALT-SKU-${RUN_KEY}`,
      packaging: 'Cut Tape',
      stock: 8_000,
      moq: 1,
      orderMultiple: 1,
      productUrl: null,
      leadTime: '재고 즉시',
      fetchedAt: new Date().toISOString(),
      priceBreaks: [{ qty: 1, price: SUB_UNIT, currency: 'KRW' }],
      procurementDecision: decision,
    }],
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
      currency_rate_snapshot_id: `e2e-journey-23-${RUN_KEY}`,
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
  const candidateKey = `ik1:e2e23-alt-${RUN_KEY}`;
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 23호] 부품 확인 관리자 조작 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 1,
        spareQty: 0,
        itemsTotal: ITEMS_TOTAL,
        shippingFee: SHIPPING_FEE,
        managementFee: MANAGEMENT_FEE,
        finalTotal: CONFIRMED_TOTAL,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 60_000),
        answeredAt: now,
        answerNote: '결제 후 부품 확인(D43) 관리자 화면 여정 확정 견적입니다.',
        adminMemo: `[BOM 여정 23호 ${RUN_KEY}] admin confirm UI fixture`,
        confirmedShippingFee: SHIPPING_FEE,
        confirmedManagementFee: MANAGEMENT_FEE,
        confirmedTotal: CONFIRMED_TOTAL,
      },
    });
    const itemIds = {} as Record<LineKey, string>;
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
          orderQty: entry.bomQty,
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: lineTotal(entry),
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: selectedOffer(entry, index),
        },
      });
      itemIds[entry.key] = String(item.id);
      if (entry.key === 'sub') {
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
            payload: substituteCandidate(candidateKey, entry.bomQty),
          },
        });
      }
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds, candidateKey };
  });
}

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
        memo: `[BOM 여정 23호 ${RUN_KEY}] 선행 입고 fixture`,
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
        trackingNumber: `BOMC23-INBOUND-${partnerName}-${RUN_KEY}`,
        shippedAt: new Date(now.getTime() - 60_000),
        receivedAt: now,
        receivedNote: `[BOM 여정 23호 ${RUN_KEY}] 입고 확인`,
        completedAt: now,
      },
    });
    await tx.spBomShipmentPo.create({ data: { shipmentId: shipment.id, poId: po.id } });
    await tx.spBomShipmentItem.createMany({
      data: po.items.map((item: { id: bigint; qty: number }) => ({ shipmentId: shipment.id, poItemId: item.id, expectedQty: item.qty })),
    });
    return { poId: String(po.id), shipmentId: String(shipment.id) };
  });
}

async function readCartRows(where: { odId?: string; ioId?: string }): Promise<Array<{ ctId: number; itId: string; ioId: string; ioPrice: number; ctStatus: string }>> {
  const clause = where.odId !== undefined ? 'od_id = ?' : 'io_id = ?';
  const rows = await getPrisma().$queryRawUnsafe(
    `SELECT ct_id AS ctId, it_id AS itId, io_id AS ioId, io_price AS ioPrice, ct_status AS ctStatus
       FROM g5_shop_cart WHERE ${clause} ORDER BY ct_id`,
    where.odId ?? where.ioId,
  ) as any[];
  return rows.map((row) => ({
    ctId: Number(row.ctId),
    itId: String(row.itId),
    ioId: String(row.ioId),
    ioPrice: Number(row.ioPrice),
    ctStatus: String(row.ctStatus),
  }));
}

async function readOrderMisu(odId: string): Promise<{ status: string; misu: number; refundPrice: number }> {
  const rows = await getPrisma().$queryRawUnsafe(
    'SELECT od_status AS status, od_misu AS misu, od_refund_price AS refundPrice FROM g5_shop_order WHERE od_id = ?',
    odId,
  ) as any[];
  const row = rows[0];
  if (row === undefined) throw new Error(`주문 ${odId} 없음`);
  return { status: String(row.status), misu: Number(row.misu), refundPrice: Number(row.refundPrice) };
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 23호 — 부품 확인 관리자 화면 조작·예외 경로', () => {
  const rp = createJourneyReport(
    'findings-bom-confirm-admin',
    'BOM 여정 23호 결제 후 부품 확인 — 관리자 화면(작성·대리 회신·적용·정산·목록) 조작과 예외 경로 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let customerToken = '';
  let otherToken = '';
  let adminToken = '';
  let seeded: Seeded | null = null;
  let odId: string | null = null;
  let supplierPoId: string | null = null;
  let r1: string | null = null; // 대체품(후보 서랍) — 대리 회신 → 추가결제 주문 제출 → 선적용
  let r2: string | null = null; // 발주서 품목·모아서 입고 대기·상담 — 고객 PHP 회신 → 환불
  let r3: string | null = null; // MOQ — 주문서만 열고 정산 취소 → 당사 부담 적용
  let r4: string | null = null; // 열린 화면에서 요청 취소 → 늦은 제출

  const adminPage = (): Page => adminView.page;
  const adminCase = async (): Promise<any> => {
    const res = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded?.quoteId ?? '0'}/confirms`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data;
  };
  const adminRequest = async (id: string | null): Promise<any> => {
    const data = await adminCase();
    const found = data.requests.find((request: any) => request.id === id);
    if (found === undefined) throw new Error(`관리자 Case 뷰에 요청 #${String(id)} 없음`);
    return found;
  };
  const issueOf = (request: any, key: LineKey): any => {
    const found = request.issues.find((issue: any) => issue.evidence.part.mpn === line(key).mpn);
    if (found === undefined) throw new Error(`요청 #${String(request.id)} 에 ${key} 이슈 없음`);
    return found;
  };

  /** 관리자 Case 상세 → 부품 확인 패널. 매번 새로 불러 서버 상태(itemState·버전)를 받는다. */
  const openPanel = async (): Promise<Locator> => {
    const page = adminPage();
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded?.quoteId ?? '0'}?from=confirms`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('section[aria-labelledby="bom-confirm-panel-title"]');
    await panel.waitFor({ state: 'visible', timeout: 30_000 });
    // 요청 목록이 그려졌거나(첫 요청 전이면) 빈 안내가 떴을 때까지 — 로딩 중 버튼을 누르지 않게.
    await expect.poll(
      async () => (await panel.locator('ol > li').count()) > 0 || (await panel.getByText('보낸 확인 요청이 없습니다.').count()) > 0,
      { timeout: 30_000, message: '부품 확인 패널 로딩' },
    ).toBe(true);
    return panel;
  };
  /** 패널 안내 — 앞 조작의 안내가 남아 있을 수 있어 기대 문구가 뜰 때까지 기다린다. */
  const expectNotice = async (panel: Locator, ...texts: string[]): Promise<string> => {
    const notice = panel.locator('p[role="status"]');
    await notice.waitFor({ state: 'visible', timeout: 30_000 });
    for (const text of texts) {
      await expect.poll(() => notice.innerText(), { timeout: 30_000, message: `패널 안내: ${text}` }).toContain(text);
    }
    return notice.innerText();
  };
  /** 공용 확인창(UiConfirmHost, role=alertdialog)에서 버튼을 누른다. */
  const confirmHost = async (label: string): Promise<void> => {
    const dialog = adminPage().locator('[role="alertdialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 });
  };
  /** 입력 모달(UiPromptModal) — 제목으로 찾아 채우고 [확인]. */
  const promptModal = async (title: string, fill: (dialog: Locator) => Promise<void>): Promise<void> => {
    const page = adminPage();
    const dialog = page.locator('[role="dialog"]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await fill(dialog);
    await dialog.getByRole('button', { name: '확인', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  };
  const issueArticle = (panel: Locator, requestId: string | null, key: LineKey): Locator =>
    panel.locator(`#bomc-admin-${String(requestId)} article`).filter({ hasText: line(key).mpn });
  /** 업무 목록 — Case 번호로 검색하고 탭을 눌러 그 요청 행(Case 열기 링크)이 있는지. */
  const queueHas = async (tabLabel: string, requestId: string | null): Promise<boolean> => {
    const page = adminPage();
    await page.goto(`${BASE_URL}/app/admin/smartbom/confirms`, { waitUntil: 'domcontentloaded' });
    await page.locator('#bom-confirm-search').fill(seeded?.quoteId ?? '');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.locator('nav[aria-label="부품 확인 요청 탭"] button').filter({ hasText: tabLabel }).click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(300);
    return (await page.locator(`a[href$="#bomc-admin-${String(requestId)}"]`).count()) > 0;
  };
  /**
   * 고객 주문 상세의 그 요청 카드. ⚠ 같은 주소에 해시(#bomc-…)만 바꿔 goto 하면 브라우저는 문서 안
   * 조각 이동으로 처리해 **다시 불러오지 않는다** — 그 뒤에 생긴 요청은 화면에 없다(23호 C09 실측).
   * 그래서 매번 새 문서로 연다.
   */
  const openOrderDetail = async (requestId: string | null): Promise<Locator> => {
    const page = customer.page;
    await page.goto(
      `${BASE_URL}/shop/orderinquiryview.php?od_id=${odId ?? ''}&_t=${String(Date.now())}#bomc-${String(requestId)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const card = page.locator(`#bomc-${String(requestId)}`);
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    return card;
  };
  const customerRequests = async (token = customerToken): Promise<any[]> => {
    const res = await api(token, 'GET', `/api/bom/confirms?odId=${odId ?? ''}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data.requests;
  };
  /** 요청 메일 — Mailpit 에서 이 요청의 메일을 찾는다(요청 생성이 SMTP 수락까지 기다린다). */
  const requestMail = async (requestId: string | null): Promise<any> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const found = await mailpitSearch(`subject:"${RUN_KEY}"`);
      for (const message of (found?.messages ?? []) as any[]) {
        const full = await mailpitMessage(String(message.ID));
        if (String(full?.HTML ?? '').includes(`#bomc-${String(requestId)}`)) return full;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`요청 #${String(requestId)} 메일이 Mailpit 에 없습니다`);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(`${MAILPIT_URL}/api/v1/messages?limit=1`, 'mailpit --smtp 127.0.0.1:25 --listen 127.0.0.1:8025');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    adminView.page.setDefaultTimeout(30_000);
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    await ensureSecondCustomer();
    customerToken = signJwt({ mbId: customer.mbId, ttlSec: 7_200 });
    otherToken = signJwt({ mbId: SECOND_CUSTOMER_ID, ttlSec: 7_200 });
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('C01. 확정 견적 주문·입금 → 대체 후보 선택 가능 확인 → UniKeyIC 공급사 발주서 선행 발행', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}) — 품목 5·대체 후보 1`);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'C01',
      prefix: 'C01-bomc23-order',
      buyerName: BUYER,
      expectedOrderAmount: ORDER_AMOUNT,
      expectedAppliedSetQty: 1,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId}(원 BOM 주문)`);
    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', { target: '입금', odIds: [odId], sendMail: false, sendSms: false });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);

    const candidates = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/items/${seeded.itemIds.sub}/candidates`);
    expect(candidates.status, JSON.stringify(candidates.json)).toBe(200);
    const candidate = (candidates.json.data.candidates as any[]).find((entry) => entry.candidateKey === seeded?.candidateKey);
    expect(candidate, '대체 후보가 서랍에 뜬다').toMatchObject({ mpn: SUB_MPN, manualSelectable: true, selectionEligibility: 'manual_review' });
    expect(candidate?.bestOfferKey, '구매 가능한 조건이 있다').not.toBeNull();

    // 확인 요청 전에 UniKeyIC 그룹 발주서를 먼저 낸다 — 뒤에서 '발주서에 든 품목' 경로를 연다.
    // ⚠ Mouser·DigiKey 는 발주서 생성이 실제 공급사 카트 API 를 부른다(EXTERNAL_AUTOMATED_SUPPLIERS, D41) —
    //   자동 실행 대상이 아닌 UniKeyIC 로 외부 호출 없이 같은 경로를 연다.
    const supplier = await getPrisma().spPartner.findFirst({ where: { type: 'supplier', supplierCode: 'unikeyic' } });
    if (supplier === null) throw new Error('UniKeyIC 공급사 파트너(supplierCode=unikeyic)가 없습니다');
    const po = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos`, { partnerIds: [Number(supplier.id)] });
    expect(po.status, JSON.stringify(po.json)).toBe(200);
    const supplierPo = (po.json.data.pos as any[]).find((entry) => entry.partnerName === supplier.name);
    expect(supplierPo, 'UniKeyIC 발주서').toBeTruthy();
    supplierPoId = String(supplierPo.poId);
    expect(supplierPo.itemCount, 'UniKeyIC 그룹 = 발주서 품목 하나').toBe(1);
    expect(supplierPo.externalRef ?? null, '자동 실행 대상 아님 — 외부 카트 호출 없음').toBeNull();
    ledger.push(`sp_bom_po #${supplierPoId}(UniKeyIC — 뒤에서 삭제)`);
    F('C01', 'obs', `원 주문 ${won(ORDER_AMOUNT)} 입금 · 대체 후보 서랍 선택 가능 · UniKeyIC 발주서 #${supplierPoId} 선행`);
  }, 300_000);

  test('C02. 관리자 화면 — 오른쪽 작성 패널(미리보기·초안 유지)에서 후보 서랍으로 대체품을 골라 보낸다 → 고객 메일은 링크 하나', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const page = adminPage();
    const panel = await openPanel();
    await panel.getByRole('button', { name: '확인 요청 보내기', exact: true }).click();
    const compose = page.locator('[role="dialog"][aria-labelledby="bom-confirm-compose-title"]');
    await compose.waitFor({ state: 'visible' });
    // 넓은 오른쪽 패널 — 화면 오른쪽 끝에 붙어 전체 높이, 너비는 1200px 이하(가운데 팝업 아님).
    const viewport = page.viewportSize();
    const box = await compose.boundingBox();
    expect(box, '작성 패널 위치').not.toBeNull();
    if (box !== null && viewport !== null) {
      expect(Math.round(box.x + box.width), '오른쪽 끝에 붙는다').toBe(viewport.width);
      expect(Math.round(box.height), '전체 높이').toBe(viewport.height);
      expect(box.width, '최대 1200px').toBeLessThanOrEqual(1200);
    }
    const itemRow = compose.locator(`[data-bomc-item="${seeded.itemIds.po}"]`);
    expect(await itemRow.innerText(), '발주서에 든 품목은 목록에 발주서가 보인다').toContain(`#${String(supplierPoId)}`);

    await compose.locator(`#bomc-item-${seeded.itemIds.sub}`).check();
    const section = compose.locator('section').filter({ has: page.getByRole('heading', { name: line('sub').mpn, exact: true }) });
    await section.waitFor({ state: 'visible' });
    await compose.locator(`#bomc-opt-${seeded.itemIds.sub}-wait_restock`).uncheck();
    await section.getByLabel('리드타임').fill('16주');

    await section.getByRole('button', { name: '대체 부품 고르기' }).click();
    const drawer = page.locator('aside[role="dialog"][aria-labelledby="candidate-drawer-title"]');
    await drawer.waitFor({ state: 'visible' });
    await drawer.getByText(SUB_MPN).first().waitFor({ state: 'visible', timeout: 30_000 });
    await rp.shot(adminView, 'C02-candidate-drawer');
    await drawer.getByRole('button', { name: '검토 후 선택' }).first().click();
    const review = page.locator('[role="dialog"][aria-labelledby="review-selection-title"]');
    await review.waitFor({ state: 'visible' });
    await review.getByRole('button', { name: '확인 후 선택' }).click();
    await drawer.waitFor({ state: 'hidden' });
    expect(await section.innerText(), '고른 대체품이 선택지에 붙는다').toContain(SUB_MPN);
    // 차액 칸은 참고값(새 라인 − 원 라인, ×1.1)으로 미리 채워진다.
    const deltas = await section.locator('input[inputmode="numeric"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(deltas).toEqual(expect.arrayContaining([String(SUB_DELTA), String(-vat(lineTotal(line('sub'))))]));

    await compose.getByLabel('고객 안내 문구(선택)').fill('[여정 23호] 지정 부품 재고가 소진되어 대체품을 제안드립니다.');
    // 고객 미리보기(오른쪽 열) — 고객 화면과 같은 4칸 형식이 초안을 따라 그려진다.
    const preview = compose.getByText('고객에게 보일 모습').locator('xpath=ancestor::div[2]');
    const previewText = await preview.innerText();
    for (const text of ['기술타입', '재고 부족', '당사제안', '대체품 승인', `+${SUB_DELTA.toLocaleString('ko-KR')}원 추가결제`, '상담 요청', '분석근거 보기']) {
      expect(previewText, `고객 미리보기: ${text}`).toContain(text);
    }
    await rp.shot(adminView, 'C02-compose-filled');

    // 닫아도 초안은 남는다 — 패널 버튼이 '작성 이어가기'가 되고, 다시 열면 고른 품목·대체품이 그대로.
    await compose.getByRole('button', { name: '닫기', exact: true }).first().click();
    await compose.waitFor({ state: 'detached' });
    await panel.getByRole('button', { name: '작성 이어가기', exact: true }).click();
    await compose.waitFor({ state: 'visible' });
    expect(await compose.locator(`#bomc-item-${seeded.itemIds.sub}`).isChecked(), '초안 유지 — 고른 품목').toBe(true);
    expect(await section.innerText(), '초안 유지 — 고른 대체품').toContain(SUB_MPN);
    await compose.getByRole('button', { name: '확인 요청 보내기', exact: true }).click();
    await compose.waitFor({ state: 'detached', timeout: 30_000 });
    await expectNotice(panel, '고객 메일도 나갔습니다');

    const data = await adminCase();
    const created = (data.requests as any[]).find((request) => request.issues.some((issue: any) => issue.evidence.part.mpn === line('sub').mpn));
    r1 = String(created.id);
    ledger.push(`sp_bom_confirm_request #${r1}(화면 작성 — 대체품)`);
    const issue = issueOf(created, 'sub');
    expect(issue.options.map((option: any) => `${String(option.code)}:${String(option.kind)}`)).toEqual(['A:substitute', 'B:customer_supply', 'C:consult']);
    expect(issue.options[0]).toMatchObject({ priceDelta: SUB_DELTA, referenceDelta: SUB_DELTA });
    expect(issue.options[0].replacement).toMatchObject({ source: 'candidate', mpn: SUB_MPN, candidateKey: seeded.candidateKey });
    expect(issue.evidence.observation).toMatchObject({ stock: 0, leadTime: '16주', sourceLabel: 'DigiKey' });

    // 메일 — 링크는 주문 상세 하나뿐, 선택 버튼(POST 폼)·공급사 SKU·원가가 없다.
    const mail = await requestMail(r1);
    const html = String(mail.HTML);
    expect(String(mail.Subject)).toContain('부품 확인 요청');
    expect((mail.To as any[]).map((to) => String(to.Address))).toContain('e2e-customer@test.local');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(hrefs, '메일 링크는 하나').toHaveLength(1);
    expect(hrefs[0]).toContain(`/shop/orderinquiryview.php?od_id=${odId}#bomc-${r1}`);
    for (const secret of ['<form', 'E2E23-ALT-SKU', 'E2E23-SUB-1', '/api/']) {
      expect(html.includes(secret), `메일에 ${secret}`).toBe(false);
    }
    expect(html).toContain('A 대체품 승인');
    F('C02', 'obs', `요청 #${r1} 화면 작성(후보 서랍 → 차액 참고값 +${String(SUB_DELTA)}) · 메일 링크 1개(주문 상세)`);
  }, 300_000);

  test('C03. 관리자 화면 — 세 품목 한 번에(유형 전환·선택지 끄기·MOQ 수량·입고 근거·지난 기한) → 공급사 [구매 완료] 보류', async (ctx) => {
    if (seeded === null || odId === null || supplierPoId === null) return ctx.skip();
    const page = adminPage();
    const panel = await openPanel();
    await panel.getByRole('button', { name: '확인 요청 보내기', exact: true }).click();
    const compose = page.locator('[role="dialog"][aria-labelledby="bom-confirm-compose-title"]');
    await compose.waitFor({ state: 'visible' });
    // 진행 중 요청이 걸린 품목은 고를 수 없다(한 품목 한 이슈).
    expect(await compose.locator(`#bomc-item-${seeded.itemIds.sub}`).isDisabled(), '확인 요청 진행 중 품목 잠김').toBe(true);

    const sectionOf = (key: LineKey): Locator =>
      compose.locator('section').filter({ has: page.getByRole('heading', { name: line(key).mpn, exact: true }) });
    for (const key of ['po', 'together', 'consult'] as const) await compose.locator(`#bomc-item-${seeded.itemIds[key]}`).check();

    // 발주서 품목 — 대체품 끄고 입고 대기(모아서)·사급
    await compose.locator(`#bomc-opt-${seeded.itemIds.po}-substitute`).uncheck();
    await sectionOf('po').getByPlaceholder('예: 공급사 입고 예정 공지').fill('UniKeyIC 입고 예정 공지');
    // 모아서 입고 대기 — 입고 대기만(대체품·사급 끔), 나눠 받기 허용 안 함
    await compose.locator(`#bomc-opt-${seeded.itemIds.together}-substitute`).uncheck();
    await compose.locator(`#bomc-opt-${seeded.itemIds.together}-customer_supply`).uncheck();
    await sectionOf('together').getByPlaceholder('예: 공급사 입고 예정 공지').fill('제조사 생산 재개 공지');
    // 상담 — MOQ·주문단위 증가로 유형 전환 → 선택지가 MOQ 프리셋으로 바뀐다 → 다른 공급사 끄고 MOQ 수량 입력
    await sectionOf('consult').getByRole('radio', { name: 'MOQ·주문단위 증가' }).check();
    await expect.poll(async () => sectionOf('consult').innerText()).toContain('MOQ 구매 승인');
    await compose.locator(`#bomc-opt-${seeded.itemIds.consult}-alt_supplier`).uncheck();
    const moqInput = sectionOf('consult').getByLabel('실제 구매 수량');
    await moqInput.fill(String(CONSULT_MOQ));
    await moqInput.press('Tab');
    const consultRef = vat(CONSULT_MOQ * line('consult').unitPrice) - vat(lineTotal(line('consult')));
    await expect.poll(async () => sectionOf('consult').innerText()).toContain(`+${consultRef.toLocaleString('ko-KR')}원 추가결제`);

    await compose.getByLabel('회신 기한').fill(kstYmd(-1));
    await rp.shot(adminView, 'C03-compose-three-items');
    // 1280px 미만 — 미리보기 열이 접히고 [작성 | 고객 미리보기] 탭으로 오간다. 모바일은 한 열, 가로 넘침 없음.
    await page.setViewportSize({ width: 1100, height: 820 });
    const tabs = compose.getByRole('tablist', { name: '작성·고객 미리보기 전환' });
    await tabs.waitFor({ state: 'visible' });
    await tabs.getByRole('tab', { name: '고객 미리보기', exact: true }).click();
    await compose.locator('p:visible', { hasText: '고객에게 보일 모습' }).waitFor({ state: 'visible' });
    expect(await compose.locator('article:visible').count(), '미리보기 — 고른 세 품목').toBe(3);
    await rp.shot(adminView, 'C03-compose-narrow-preview');
    await tabs.getByRole('tab', { name: '작성', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await compose.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), '모바일 가로 넘침').toBe(true);
    await rp.shot(adminView, 'C03-compose-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });
    await compose.getByRole('button', { name: '확인 요청 보내기', exact: true }).click();
    await compose.waitFor({ state: 'detached', timeout: 30_000 });
    await expectNotice(panel, '확인 요청을 보냈습니다');

    const data = await adminCase();
    const created = (data.requests as any[]).find((request) => request.issues.some((issue: any) => issue.evidence.part.mpn === line('po').mpn));
    r2 = String(created.id);
    ledger.push(`sp_bom_confirm_request #${r2}(화면 작성 — 발주서 품목·모아서 입고 대기·상담)`);
    expect(created.overdue, '지난 기한').toBe(true);
    expect(issueOf(created, 'po').options.map((option: any) => option.kind)).toEqual(['wait_restock', 'customer_supply', 'consult']);
    expect(issueOf(created, 'po').options[0].restock).toMatchObject({ splitAllowed: false, basis: 'UniKeyIC 입고 예정 공지' });
    expect(issueOf(created, 'together').options.map((option: any) => option.kind)).toEqual(['wait_restock', 'consult']);
    const consult = issueOf(created, 'consult');
    expect(consult.issueType).toBe('moq_increase');
    expect(consult.options.map((option: any) => `${String(option.code)}:${String(option.kind)}`)).toEqual(['A:moq_purchase', 'B:customer_supply', 'C:consult']);
    expect(consult.options[0]).toMatchObject({ priceDelta: consultRef, moq: { orderQty: CONSULT_MOQ } });
    expect(consult.options[1].title).toBe('고객 사급(해당 부품 전량)');
    expect(issueOf(created, 'po').itemState.po).toMatchObject({ poId: supplierPoId, status: 'issued' });

    // 공급사 발주서의 [구매 완료] — 확인 중인 품목이 들어 있어 보류된다.
    const confirmPo = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos/${supplierPoId}/confirm`);
    expect(confirmPo.status, JSON.stringify(confirmPo.json)).toBe(409);
    expect(confirmPo.json?.error).toBe('CONFIRM_PENDING');
    expect(String(confirmPo.json?.message)).toContain(line('po').mpn);

    const mail = await requestMail(r2);
    expect(String(mail.HTML)).toContain(kstYmd(-1));
    F('C03', 'obs', `요청 #${r2} — 3품목·유형 전환·선택지 끄기·MOQ ${String(CONSULT_MOQ)}·기한 지남, UniKeyIC [구매 완료] CONFIRM_PENDING`);
  }, 300_000);

  test('C04. 대리 회신 모달(메일 경로) → 추가결제 대기 · 업무 목록 탭·검색·Case 열기', async (ctx) => {
    if (seeded === null || r1 === null || r2 === null) return ctx.skip();
    const page = adminPage();
    const panel = await openPanel();
    const before = await adminRequest(r1);
    await panel.locator(`#bomc-admin-${r1}`).getByRole('button', { name: '대리 회신', exact: true }).click();
    const proxy = page.locator('[role="dialog"][aria-labelledby="bomc-proxy-title"]');
    await proxy.waitFor({ state: 'visible' });
    const record = proxy.getByRole('button', { name: '대리 회신 기록', exact: true });
    expect(await record.isDisabled(), '고르기 전에는 기록 불가').toBe(true);
    await proxy.locator(`input[name="proxy-${String(issueOf(before, 'sub').id)}"][value="A"]`).check();
    await proxy.getByLabel('받은 경로').selectOption('email');
    await proxy.getByLabel('메모(선택)').fill('고객 메일 회신 — 대체품으로 진행 요청');
    await rp.shot(adminView, 'C04-proxy-modal');
    await record.click();
    await proxy.waitFor({ state: 'detached', timeout: 30_000 });
    await expectNotice(panel, '대리 회신을 기록했습니다');

    const answered = await adminRequest(r1);
    expect(answered).toMatchObject({ status: 'answered', answeredRole: 'admin', answerChannel: 'email', netDelta: SUB_DELTA });
    expect(answered.settlement).toMatchObject({ kind: 'charge', status: 'pending', amount: SUB_DELTA });

    expect(await queueHas('추가결제 대기', r1), '추가결제 대기 탭에 #1').toBe(true);
    expect(await queueHas('고객 회신 대기', r2), '고객 회신 대기 탭에 #2').toBe(true);
    const row = page.locator('tr').filter({ has: page.locator(`a[href$="#bomc-admin-${r2}"]`) });
    expect(await row.innerText(), '목록 기한 지남').toContain('지남');
    await rp.shot(adminView, 'C04-queue-awaiting-customer');
    await Promise.all([
      page.waitForURL(`**/app/admin/smartbom/cases/${seeded.quoteId}**`, { timeout: 30_000 }),
      page.locator(`a[href$="#bomc-admin-${r2}"]`).click(),
    ]);
    await page.locator(`#bomc-admin-${r2}`).waitFor({ state: 'visible', timeout: 30_000 });
    F('C04', 'obs', '대리 회신(메일) 기록 → 추가결제 대기, 업무 목록 탭·검색·Case 열기(#bomc-admin) 이동');
  }, 240_000);

  test('C05. 고객 — 기한 지남 목록 → 선택 없이 제출은 막힘 → 사급·입고 대기(모아서)·상담 회신 → 환불 예정', async (ctx) => {
    if (seeded === null || odId === null || r2 === null) return ctx.skip();
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/parts-confirm`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('.sp-eqm__item').filter({ has: page.locator(`.sp-eqm__go[href$="#bomc-${r2}"]`) });
    expect(await row.innerText(), '목록 기한 지남 배지').toContain('회신 기한 지남');

    const card = await openOrderDetail(r2);
    expect(await card.innerText()).toContain('회신 기한 지남');
    await card.locator('.sp_eq_approve').click();
    await page.locator('.sp-dlg-msg').waitFor({ state: 'visible', timeout: 10_000 });
    expect(await page.locator('.sp-dlg-msg').innerText()).toContain('부품마다 처리 방법을 하나씩 골라 주세요');
    await page.locator('.sp-dlg-ok').click();

    const request = await adminRequest(r2);
    const po = issueOf(request, 'po');
    const together = issueOf(request, 'together');
    const consult = issueOf(request, 'consult');
    await card.locator(`input[name="choice[${String(po.id)}]"][value="B"]`).check();
    await card.locator(`input[name="choice[${String(together.id)}]"][value="A"]`).check();
    expect(await card.locator('fieldset.sp_bomc_ship').count(), '나눠 받기를 허용하지 않은 입고 대기엔 받는 방법이 없다').toBe(0);
    await card.locator(`input[name="choice[${String(consult.id)}]"][value="C"]`).check();
    await expect.poll(() => card.locator('[data-bomc-total]').innerText()).toBe(`환불 ${won(PO_SUPPLY_REFUND)}`);
    await card.locator('.sp_eq_approve').click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.locator('.sp-dlg-msg').waitFor({ state: 'visible', timeout: 10_000 });
    expect(await page.locator('.sp-dlg-msg').innerText()).toContain(`${PO_SUPPLY_REFUND.toLocaleString('ko-KR')}원은 처리 후 환불해 드립니다`);
    await page.locator('.sp-dlg-ok').click();

    const answered = await adminRequest(r2);
    expect(answered).toMatchObject({ status: 'answered', answeredRole: 'customer', netDelta: -PO_SUPPLY_REFUND });
    expect(issueOf(answered, 'together')).toMatchObject({ chosenCode: 'A', shipPreference: 'together' });
    expect(answered.settlement).toMatchObject({ kind: 'refund', status: 'pending', amount: PO_SUPPLY_REFUND });
    F('C05', 'obs', `고객 회신 #${r2} — 선택 누락 차단, 사급·모아서 입고 대기·상담 → 환불 ${won(PO_SUPPLY_REFUND)} 예정`);
  }, 240_000);

  test('C06. 추가결제 주문을 낸 뒤 — 요청 취소·정산 취소 거절 → 선적용(대체품 1행 교체) → 입금 뒤 자동 처리 완료', async (ctx) => {
    if (seeded === null || odId === null || r1 === null) return ctx.skip();
    const page = customer.page;
    const card = await openOrderDetail(r1);
    expect(await card.innerText(), '대리 회신 표기').toContain('전화·메일로 주신 회신을 담당자가 대신 입력했습니다');
    await Promise.all([
      page.waitForURL('**/shop/orderform*', { timeout: 30_000 }),
      card.locator('.sp_bomc_pay').click(),
    ]);
    const extra = await completeBankTransferOrder(customer, rp, { step: 'C06', prefix: 'C06-extra', buyerName: BUYER, previousOdId: odId });
    ledger.push(`g5_shop_order ${extra.odId}(추가결제 주문 — 무통장 미입금 상태에서 거절 경로)`);

    const panel = await openPanel();
    const requestCard = panel.locator(`#bomc-admin-${r1}`);
    await requestCard.getByRole('button', { name: '요청 취소', exact: true }).click();
    await promptModal('확인 요청 취소', async (dialog) => {
      await dialog.locator('textarea').fill('여정 23호 — 추가결제 주문을 낸 뒤 취소 시도');
    });
    await expectNotice(panel, '이미 적용했거나 돈이 오간 요청은 취소할 수 없습니다');
    await requestCard.getByRole('button', { name: '정산 취소', exact: true }).click();
    await promptModal('정산 취소', async (dialog) => {
      await dialog.locator('textarea').fill('여정 23호 — 주문서 제출 뒤 정산 취소 시도');
    });
    await expectNotice(panel, '고객이 추가결제 주문서를 이미 냈습니다');

    const prisma = getPrisma();
    const quoteBefore = await prisma.spBomQuote.findUnique({ where: { id: BigInt(seeded.quoteId) } });
    const applyButton = issueArticle(panel, r1, 'sub').getByRole('button', { name: '선적용', exact: true });
    await applyButton.click();
    await confirmHost('선적용');
    await expectNotice(panel, '대체품 승인 적용했습니다');
    const subRow = await prisma.spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.sub) } });
    expect(subRow).toMatchObject({ mpn: SUB_MPN, selectedCandidateKey: seeded.candidateKey, orderQty: line('sub').bomQty, fulfillment: 'normal' });
    expect(Number(subRow?.lineTotalKrw)).toBe(line('sub').bomQty * SUB_UNIT);
    const quoteAfter = await prisma.spBomQuote.findUnique({ where: { id: BigInt(seeded.quoteId) } });
    expect(quoteAfter?.confirmedTotal, '확정가 불변').toBe(quoteBefore?.confirmedTotal);
    expect((await adminRequest(r1)).status, '입금 전이라 아직 처리 중').toBe('answered');
    const events = (await adminRequest(r1)).events as any[];
    expect(events.some((event) => event.action === 'applied' && String(event.note).includes('선적용'))).toBe(true);

    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', { target: '입금', odIds: [extra.odId], sendMail: false, sendSms: false });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const resolved = await adminRequest(r1);
    expect(resolved.status, '입금 확인(lazy) → 자동 처리 완료').toBe('resolved');
    expect(resolved.settlement).toMatchObject({ status: 'paid', paidOdId: extra.odId });
    F('C06', 'obs', `주문서 제출 뒤 요청 취소 NOT_CANCELABLE·정산 취소 CHARGE_ORDER_PLACED → 선적용(${line('sub').mpn}→${SUB_MPN}) → 입금 → resolved`);
  }, 300_000);

  test('C07. 발주서 품목 — 화면 선차단·API ITEM_IN_PO → 발주서 삭제 뒤 적용 → 입고 대기·상담 적용 → 감액·환불 기록 → 사급은 발주 초안 제외', async (ctx) => {
    if (seeded === null || odId === null || r2 === null || supplierPoId === null) return ctx.skip();
    let panel = await openPanel();
    await issueArticle(panel, r2, 'po').getByRole('button', { name: '적용', exact: true }).click();
    await expectNotice(panel, `발주서 #${supplierPoId}`, '삭제한 뒤 적용하세요');
    const request = await adminRequest(r2);
    const blocked = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms/${r2}/issues/${String(issueOf(request, 'po').id)}/apply`, {
      expectedVersion: request.version,
    });
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('ITEM_IN_PO');

    const removed = await api(adminToken, 'DELETE', `/api/admin/bom-quotes/${seeded.quoteId}/pos/${supplierPoId}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    F('C07', 'obs', `UniKeyIC 발주서 #${supplierPoId} 삭제(발행됨) — 적용 길이 열린다`);

    panel = await openPanel();
    for (const key of ['po', 'together', 'consult'] as const) {
      await issueArticle(panel, r2, key).getByRole('button', { name: '적용', exact: true }).click();
      await confirmHost('적용');
      await expect.poll(async () => issueOf(await adminRequest(r2), key).status).not.toBe('decided');
    }
    const afterApply = await adminRequest(r2);
    expect(issueOf(afterApply, 'po')).toMatchObject({ status: 'applied', itemState: { fulfillment: 'customer_supply' } });
    expect(issueOf(afterApply, 'together')).toMatchObject({ status: 'applied', itemState: { fulfillment: 'backorder' } });
    expect(issueOf(afterApply, 'consult').status, '상담은 변경 없이 닫힘').toBe('closed');
    const consultRow = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.consult) } });
    expect(consultRow?.orderQty, '상담 — 품목 불변').toBe(line('consult').bomQty);
    expect(afterApply.status, '환불 전이라 처리 중').toBe('answered');

    panel = await openPanel();
    const card = panel.locator(`#bomc-admin-${r2}`);
    await card.getByRole('button', { name: '주문 금액 감액', exact: true }).click();
    await confirmHost('감액');
    await expectNotice(panel, '주문 금액을 줄였습니다');
    const bomRow = (await readCartRows({ odId })).find((row) => row.itId === 'sp-bom-parts');
    expect(bomRow?.ioPrice).toBe(ORDER_AMOUNT - PO_SUPPLY_REFUND);
    expect((await readOrderMisu(odId)).misu).toBe(-PO_SUPPLY_REFUND);
    await card.getByRole('button', { name: '환불 기록', exact: true }).click();
    await promptModal('환불 기록', async (dialog) => {
      await dialog.locator('input[type="text"]').fill('여정 23호 무통장 송금');
    });
    await expect.poll(async () => (await adminRequest(r2)).status).toBe('resolved');
    expect((await readOrderMisu(odId)).misu, '환불 기록 뒤 미수 0').toBe(0);
    await rp.shot(adminView, 'C07-refund-recorded');

    // 사급이 된 발주서 품목은 발주 초안에서 빠진다 — UniKeyIC 그룹이 비었다.
    const supplier = await getPrisma().spPartner.findFirst({ where: { type: 'supplier', supplierCode: 'unikeyic' } });
    const again = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos`, { partnerIds: [Number(supplier?.id ?? 0)] });
    expect(again.status, JSON.stringify(again.json)).toBe(409);
    expect(again.json?.error).toBe('NO_ELIGIBLE_ROWS');
    F('C07', 'obs', `요청 #${r2} — 사급·입고 대기(모아서)·상담 적용, 감액→환불 기록(미수 0), 사급 품목 발주 초안 제외`);
  }, 300_000);

  test('C08. 주문서만 연 추가결제 → 정산 취소가 담긴 카트행을 치운다 → 당사 부담으로 적용 → 처리 완료', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const created = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.moq,
        issueType: 'moq_increase',
        description: '실제 공급사 MOQ가 계약수량보다 많습니다.',
        observation: { sourceLabel: 'DigiKey', moq: MOQ_QTY },
        options: [{ kind: 'moq_purchase', priceDelta: MOQ_DELTA, moqOrderQty: MOQ_QTY }],
      }],
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    r3 = String(created.json.data.request.id);
    ledger.push(`sp_bom_confirm_request #${r3}(MOQ — 정산 취소 경로)`);
    const moqIssue = issueOf(created.json.data.request, 'moq');
    const answer = await api(customerToken, 'POST', `/api/bom/confirms/${r3}/answer`, {
      expectedVersion: created.json.data.request.version,
      choices: [{ issueId: String(moqIssue.id), code: 'A' }],
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);

    const page = customer.page;
    const card = await openOrderDetail(r3);
    await Promise.all([
      page.waitForURL('**/shop/orderform*', { timeout: 30_000 }),
      card.locator('.sp_bomc_pay').click(),
    ]);
    const settlement = (await adminRequest(r3)).settlement;
    const chargeKey = String(settlement.chargeKey);
    const shopping = await readCartRows({ ioId: chargeKey });
    expect(shopping.map((row) => row.ctStatus), '주문서만 연 상태 = 담긴 카트행').toEqual(['쇼핑']);

    const panel = await openPanel();
    await panel.locator(`#bomc-admin-${r3}`).getByRole('button', { name: '정산 취소', exact: true }).click();
    await promptModal('정산 취소', async (dialog) => {
      await dialog.locator('textarea').fill('MOQ 차액은 당사가 부담하기로 함');
    });
    await expect.poll(async () => (await adminRequest(r3)).settlement?.status).toBe('canceled');
    expect(await readCartRows({ ioId: chargeKey }), '담긴 카트행이 치워진다').toEqual([]);

    const refreshed = await openPanel();
    const apply = issueArticle(refreshed, r3, 'moq').getByRole('button', { name: '적용', exact: true });
    await apply.click();
    await confirmHost('적용');
    await expect.poll(async () => (await adminRequest(r3)).status).toBe('resolved');
    const moqRow = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.moq) } });
    expect(moqRow?.orderQty).toBe(MOQ_QTY);

    const doneCard = await openOrderDetail(r3);
    expect(await doneCard.locator('.sp_bomc_pay, .sp_bomc_settle').count(), '정산 취소 뒤 고객 결제 칸 없음').toBe(0);
    F('C08', 'obs', `요청 #${r3} — 담긴 추가결제 카트행(${chargeKey}) 정산 취소로 정리 → 결제 없이 적용(당사 부담) → resolved`);
  }, 240_000);

  test('C09. 다른 고객은 못 본다 → 열어 둔 화면에서 요청이 취소된 뒤 제출하면 안내 → 요청 취소 표시', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const created = await api(adminToken, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.sub,
        issueType: 'stock_out',
        description: '교체한 대체품도 재고가 줄었습니다.',
        observation: { sourceLabel: 'DigiKey', stock: 3 },
        options: [{ kind: 'customer_supply', priceDelta: -vat(line('sub').bomQty * SUB_UNIT) }],
      }],
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    r4 = String(created.json.data.request.id);
    ledger.push(`sp_bom_confirm_request #${r4}(열린 화면 취소 경로)`);
    const issue = created.json.data.request.issues[0];

    // 다른 고객 — 목록에 없고, 회신·결제는 없는 요청과 같은 404.
    expect((await customerRequests(otherToken)).length, '다른 고객에게 이 주문의 요청 0건').toBe(0);
    const foreignAnswer = await api(otherToken, 'POST', `/api/bom/confirms/${r4}/answer`, {
      expectedVersion: 1,
      choices: [{ issueId: String(issue.id), code: 'A' }],
    });
    expect(foreignAnswer.status, JSON.stringify(foreignAnswer.json)).toBe(404);
    const foreignMine = await api(otherToken, 'GET', '/api/bom/confirms/mine?scope=all');
    expect((foreignMine.json.data.requests as any[]).some((row) => row.id === r4)).toBe(false);
    const r1Settlement = (await adminRequest(r1)).settlement;
    const foreignCheckout = await api(otherToken, 'POST', `/api/bom/confirms/settlements/${String(r1Settlement.id)}/checkout`);
    expect(foreignCheckout.status, JSON.stringify(foreignCheckout.json)).toBe(404);

    const page = customer.page;
    const card = await openOrderDetail(r4);
    await card.locator(`input[name="choice[${String(issue.id)}]"][value="A"]`).check();

    const panel = await openPanel();
    await panel.locator(`#bomc-admin-${r4}`).getByRole('button', { name: '요청 취소', exact: true }).click();
    await promptModal('확인 요청 취소', async (dialog) => {
      await dialog.locator('textarea').fill('고객과 통화 — 대체품 재고 재확인 뒤 다시 요청');
    });
    await expect.poll(async () => (await adminRequest(r4)).status).toBe('canceled');

    await card.locator('.sp_eq_approve').click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.locator('.sp-dlg-msg').waitFor({ state: 'visible', timeout: 10_000 });
    expect(await page.locator('.sp-dlg-msg').innerText()).toContain('이미 회신했거나 담당자가 요청을 닫았습니다');
    await page.locator('.sp-dlg-ok').click();
    const canceledCard = page.locator(`#bomc-${r4}`);
    await canceledCard.waitFor({ state: 'visible' });
    const text = await canceledCard.innerText();
    expect(text).toContain('요청 취소');
    expect(text).toContain('담당자가 요청을 취소했습니다');
    expect(await canceledCard.locator('form').count()).toBe(0);
    F('C09', 'obs', `요청 #${r4} — 다른 고객 404·목록 0, 열린 화면 늦은 제출은 NOT_OPEN 안내 → 요청 취소 표시`);
  }, 240_000);

  test('C10. 모아서 받기 입고 대기 — 입고 전 배송 차단·진행 보류 표시 → 입고 뒤 배송 · 업무 목록 결말', async (ctx) => {
    if (seeded === null || odId === null || r1 === null || r2 === null || r3 === null || r4 === null) return ctx.skip();
    const po1 = await seedReceivedPo(seeded.quoteId, '협력1', [
      { itemId: seeded.itemIds.sub, entry: line('sub'), qty: line('sub').bomQty },
      { itemId: seeded.itemIds.consult, entry: line('consult'), qty: line('consult').bomQty },
      { itemId: seeded.itemIds.moq, entry: line('moq'), qty: MOQ_QTY },
    ]);
    ledger.push(`sp_bom_po #${po1.poId}(협력1 — 입고 대기 외 품목 입고 fixture)`, `sp_bom_shipment #${po1.shipmentId}`);

    const progress = async (): Promise<any> => {
      const res = await api(customerToken, 'GET', `/api/order-progress?odId=${odId ?? ''}`);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      return (res.json.data.items as any[]).find((entry) => entry.track === 'bom' && entry.refId === seeded?.quoteId);
    };
    const held = await progress();
    expect(held).toMatchObject({ stage: 'procuring', shortLabel: '조달 중' });
    expect(String(held?.label)).toContain('입고를 기다리는 부품');

    const early = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송', carrier: '우체국택배', trackingNumber: `BOMC23-EARLY-${RUN_KEY}`, sendMail: false, sendSms: false,
    });
    expect(early.status, JSON.stringify(early.json)).toBe(409);
    expect(early.json?.error).toBe('BOM_FULFILLMENT_INCOMPLETE');
    expect(String(early.json?.message)).toContain('모아서 받기로 한 입고 대기 부품');
    expect(await queueHas('입고 대기', r2), '입고 대기 탭에 #2').toBe(true);

    const po2 = await seedReceivedPo(seeded.quoteId, '협력2', [
      { itemId: seeded.itemIds.together, entry: line('together'), qty: line('together').bomQty },
    ]);
    ledger.push(`sp_bom_po #${po2.poId}(협력2 — 입고 대기 품목 입고)`, `sp_bom_shipment #${po2.shipmentId}`);
    expect((await progress())?.stage, '입고 뒤엔 보류 없음').toBe('received');
    const shipped = await api(adminToken, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송', carrier: '우체국택배', trackingNumber: `BOMC23-SHIP-${RUN_KEY}`, sendMail: false, sendSms: false,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);

    expect(await queueHas('입고 대기', r2), '배송 뒤 입고 대기 탭에서 빠진다').toBe(false);
    for (const id of [r1, r2, r3]) expect(await queueHas('완료', id), `완료 탭에 #${id}`).toBe(true);
    expect(await queueHas('취소', r4), '취소 탭에 #4').toBe(true);
    await rp.shot(adminView, 'C10-queue-canceled');
    await rp.assertView(adminView, `/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms`, 'C10-admin-case-final', [
      '부품 확인 요청', '처리 완료', '요청 취소', '추가결제 완료', '환불 완료', '정산 취소',
    ]);
    F('C10', 'obs', "'모아서' 입고 대기가 배송·진행을 붙잡고, 그 품목 입고 뒤 배송 → 업무 목록 완료 3·취소 1");
  }, 300_000);
});
