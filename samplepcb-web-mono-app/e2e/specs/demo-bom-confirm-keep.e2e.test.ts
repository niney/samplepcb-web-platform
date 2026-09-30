// 데모 주행 — **결제 후 부품 확인 요청(D43) 보내기 직전**에서 멈추고 남긴다(정리 없음 · 2026-09-30 사용자 요청).
//
// 사람이 이어서 화면으로 시험할 수 있게, 데모 고객 계정(e2e/.env.e2e 의 E2E_DEMO_CUSTOMER_ID/PW)으로
//   확정 BOM 견적 → 고객 주문(무통장, 실제 PHP 주문서) → 관리자 입금 확인
// 까지만 실주행한다. 그 다음 칸 — 관리자 [확인 요청 보내기] → 고객 회신(마이페이지 부품 확인·주문 상세)
// → 관리자 적용·정산 — 은 **사람이 화면에서 직접** 이어 가도록 손대지 않는다.
//
// 품목은 시험하기 좋게 네 가지를 깐다(모두 UniKeyIC 구매 조건 — 발주서를 만들어도 실제 공급사 카트 API 를
// 부르지 않는다; Mouser·DigiKey 는 자동 카트 호출이 있다, docs §6.39 여정 23호 주석):
//   ① 재고 소진 + 대체 후보(엔진 필수조건 4행 판정 박제) ② MOQ 증가 ③ 재고 소진(입고 대기·나눠 받기 시험용) ④ 정상(비교용)
//
// 실행: pnpm -F e2e demo:bom-confirm
// 사전: nginx · API(3333) · 웹(5173) · Mailpit(127.0.0.1:25/8025 — 고객 메일이 밖으로 나가지 않고 여기 쌓인다)
// 정리(원할 때 수동): 주행 끝에 찍히는 대장 참고 — Case 는 관리자 Case 상세의 [Case 강제 영구 삭제].
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  MAILPIT_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  newSession,
  placeOrderFromBomQuote,
  requireDemoCustomerCreds,
  signJwt,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const DEMO = process.env.DEMO_KEEP === '1';
const STAMP = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
const SET_QTY = 10;
const SPARE_QTY = 2;
const FACTOR = SET_QTY + SPARE_QTY; // 필요수량 = BOM 수량 × (세트 + 예비)
const SHIPPING_FEE = 3_000;
const MANAGEMENT_FEE = 1_500;

interface DemoLine {
  key: 'stock' | 'moq' | 'wait' | 'normal';
  mpn: string;
  manufacturerName: string;
  description: string;
  packageCode: string;
  refs: string[];
  sourceRow: number;
  bomQty: number;
  unitPrice: number; // KRW, VAT 별도
  scenario: string; // 사람에게 안내할 시험 거리
}

const LINES: DemoLine[] = [
  {
    key: 'stock',
    mpn: 'GRM155R71H104KE14D',
    manufacturerName: 'Murata',
    description: 'CAP CER 0.1UF 50V X7R 0402',
    packageCode: '0402',
    refs: ['C1', 'C2', 'C3', 'C4', 'C7', 'C8', 'C11', 'C12'],
    sourceRow: 5,
    bomQty: 8,
    unitPrice: 15,
    scenario: "재고 소진 — [대체 부품 고르기]에 대체 후보 CL05B104KB5NNNC(엔진 판정 4행)가 뜬다",
  },
  {
    key: 'moq',
    mpn: 'TPS7A2033PDBVR',
    manufacturerName: 'Texas Instruments',
    description: 'IC REG LINEAR 3.3V 300MA SOT23-5',
    packageCode: 'SOT-23-5',
    refs: ['U2'],
    sourceRow: 9,
    bomQty: 1,
    unitPrice: 420,
    scenario: 'MOQ 증가 — [MOQ 증가]로 바꾸고 실제 구매 수량 예: 50',
  },
  {
    key: 'wait',
    mpn: 'ESD9B5.0ST5G',
    manufacturerName: 'onsemi',
    description: 'TVS DIODE 5VWM SOD923',
    packageCode: 'SOD-923',
    refs: ['D1', 'D2'],
    sourceRow: 12,
    bomQty: 2,
    unitPrice: 90,
    scenario: "재고 소진 — 입고 대기에 '먼저 온 부품 먼저 받기' 허용·두 번째 배송비 시험",
  },
  {
    key: 'normal',
    mpn: 'B2B-XH-A(LF)(SN)',
    manufacturerName: 'JST',
    description: 'CONN HEADER VERT 2POS 2.5MM',
    packageCode: 'THT',
    refs: ['J1', 'J2'],
    sourceRow: 15,
    bomQty: 2,
    unitPrice: 70,
    scenario: '정상 품목(비교용 — 확인 요청 없이 조달)',
  },
];
const SUB_MPN = 'CL05B104KB5NNNC';
const SUB_UNIT = 18;

const vat = (n: number): number => Math.round(n * 1.1);
const needed = (line: DemoLine): number => line.bomQty * FACTOR;
const lineTotal = (line: DemoLine): number => needed(line) * line.unitPrice;
const stockLine = LINES[0] as DemoLine;
const ITEMS_TOTAL = LINES.reduce((sum, line) => sum + lineTotal(line), 0);
const CONFIRMED_TOTAL = ITEMS_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE;
const ORDER_AMOUNT = vat(CONFIRMED_TOTAL);
const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;

/** 대체 후보 스냅샷 — 관리자 후보 서랍에 '검토 후 선택'으로 뜨고, 고객 분석근거에 판정표로 보인다. */
function substituteCandidate(candidateKey: string, requiredQty: number): Record<string, unknown> {
  const offerKey = `ok2:demo-bomc-${candidateKey.slice(-12)}`;
  const assessments = [
    ['capacitance_f', 'eq', '100 nF', '100 nF'],
    ['voltage_v', 'gte', '50 V', '50 V'],
    ['dielectric', 'eq', 'X7R', 'X7R'],
    ['package', 'eq', '0402', '0402'],
  ].map(([key, comparison, expectedDisplay, actualDisplay]) => ({
    key, comparison, state: 'match', verified: true, expectedDisplay, actualDisplay, source: 'bom',
  }));
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
    selectionReasonCodes: ['demo-spec-compatible'],
    mpn: SUB_MPN,
    manufacturerName: 'Samsung Electro-Mechanics',
    description: 'CAP CER 0.1UF 50V X7R 0402',
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
    identityConfidence: 0.92,
    specificationConfidence: 1,
    conflicts: [],
    missingRequirements: [],
    reasons: ['정전용량·정격전압·유전체·패키지가 모두 같습니다.'],
    corroboratingSuppliers: ['unikeyic'],
    verifiedRequirementCount: 4,
    requiredRequirementCount: 4,
    requirementAssessments: assessments,
    verificationComplete: true,
    strictCategoryCoverage: true,
    technicalEvidenceKey: candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: { capacitance_f: 1e-7, voltage_v: 50, dielectric: 'X7R', package: '0402' },
    specComparisons: {},
    packageComparison: null,
    offers: [{
      offerKey,
      supplier: 'unikeyic',
      offerKind: 'supplier_offer',
      supplierSku: `DEMO-${SUB_MPN}`,
      packaging: 'Cut Tape',
      stock: 120_000,
      moq: 1,
      orderMultiple: 1,
      productUrl: null,
      leadTime: '재고 즉시',
      fetchedAt: new Date().toISOString(),
      priceBreaks: [{ qty: 1, price: SUB_UNIT, currency: 'KRW' }],
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
      },
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
      currency_rate_snapshot_id: `demo-bomc-${candidateKey.slice(-12)}`,
      currency_rate_as_of: new Date().toISOString(),
      currency_rate_source: 'demo-fixture',
      technical_preselection_identity_key: candidateKey,
      technical_preselection_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      application_candidate_identity_key: candidateKey,
      application_candidate_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      technical_fallback_used: false,
      price_optimization_used: false,
      automatic_offer_key: null,
      review_offer_key: offerKey,
      recommendation_reason_codes: ['demo-review'],
    },
    engineCandidates: [],
    procurementDisposition: 'eligible',
    quantityResolution: 'verified',
    dispositionReasonCodes: [],
  };
}

async function seedAnsweredQuote(mbId: string): Promise<{ quoteId: string; title: string; itemIds: Record<DemoLine['key'], string> }> {
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[데모] 결제 후 부품 확인 ${STAMP}`,
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
        requestedAt: new Date(now.getTime() - 3_600_000),
        answeredAt: now,
        answerNote: '데모 확정 견적입니다 — 결제 후 부품 확인 요청을 화면에서 시험하세요.',
        adminMemo: `[데모 ${STAMP}] 결제 후 부품 확인(D43) 직전 남김 — demo-bom-confirm-keep`,
        confirmedShippingFee: SHIPPING_FEE,
        confirmedManagementFee: MANAGEMENT_FEE,
        confirmedTotal: CONFIRMED_TOTAL,
      },
    });
    const itemIds = {} as Record<DemoLine['key'], string>;
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
          orderQty: needed(line),
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: lineTotal(line),
          sourceSheetName: 'BOM',
          sourceRow: {
            quantityConfirmed: true,
            procurementDisposition: 'included',
            sourceRows: [line.sourceRow],
            referenceDesignators: line.refs,
            packageCode: line.packageCode,
          },
          selectedOffer: {
            offerKey: `ok2:demo-bomc-${line.key}-${String(quote.id)}`,
            supplier: 'unikeyic',
            supplierSku: `DEMO-${line.mpn}`,
            packaging: 'Cut Tape',
            breakQty: 1,
            unitPrice: line.unitPrice,
            currency: 'KRW',
            unitPriceKrw: line.unitPrice,
            moq: 1,
            orderMultiple: 1,
            stock: 50_000,
            priceBreaks: [{ qty: 1, price: line.unitPrice }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
      itemIds[line.key] = String(item.id);
      if (line.key === 'stock') {
        const candidateKey = `ik1:demo-bomc-${String(item.id)}`;
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
            payload: substituteCandidate(candidateKey, needed(line)),
          },
        });
      }
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds };
  });
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (response.status >= 500) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

describe.skipIf(!RUN || !DEMO)('데모 — 결제 후 부품 확인 요청 보내기 직전까지(남김)', () => {
  const rp = createJourneyReport('demo-bom-confirm-keep', '결제 후 부품 확인 직전 남김 주행 리포트');
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let adminToken = '';
  let seeded: { quoteId: string; title: string; itemIds: Record<DemoLine['key'], string> } | null = null;
  let odId: string | null = null;
  let ready = false;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(`${MAILPIT_URL}/api/v1/messages?limit=1`, 'mailpit --smtp 127.0.0.1:25 --listen 127.0.0.1:8025 (고객 메일이 밖으로 나가지 않게)');
    customer = await newPhpSession(requireDemoCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3_600 });
  }, 180_000);

  afterAll(async () => {
    if (ready && seeded !== null && odId !== null) {
      const stock = stockLine;
      const moq = LINES[1] as DemoLine;
      const subDelta = vat(needed(stock) * SUB_UNIT) - vat(lineTotal(stock));
      const moqExample = 50;
      const moqDelta = vat(moqExample * moq.unitPrice) - vat(lineTotal(moq));
      console.log(
        '\n[demo-bom-confirm] 결제 후 부품 확인 요청 보내기 직전까지 남겼습니다 — 다음은 화면에서:\n' +
          `  Case #${seeded.quoteId} ${seeded.title}\n` +
          `  주문 ${odId} (${customer.mbId}) · 결제 ${won(ORDER_AMOUNT)} 입금 확인 완료\n\n` +
          `  ① 관리자: ${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms → [확인 요청 보내기]\n` +
          LINES.map((line) => `       · ${line.mpn} (필요 ${String(needed(line))}개 · 라인 ${won(lineTotal(line))}) — ${line.scenario}`).join('\n') + '\n' +
          `       참고 차액: 대체품 +${won(subDelta)} · ${stock.mpn} 사급 −${won(vat(lineTotal(stock)))} · MOQ ${String(moqExample)}개면 +${won(moqDelta)}\n` +
          `  ② 고객(${customer.mbId}): 로그인 → ${BASE_URL}/shop/parts-confirm (확인 요청 › 부품 확인)\n` +
          `       또는 주문 상세 ${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}\n` +
          '  ③ 관리자: Case 상세 부품 확인 패널에서 적용 → 정산(추가결제 확인·감액·환불 기록), 목록은 스마트 BOM › 부품 확인\n' +
          `  메일: ${MAILPIT_URL} (Mailpit — 실제 메일 주소로는 나가지 않습니다)\n` +
          '  ⚠ 이 Case 는 UniKeyIC 구매 조건이라 발주서를 만들어도 외부 공급사 카트 API 를 부르지 않습니다.\n',
      );
    }
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('D1. 데모 고객 확정 견적 → 실제 주문서(무통장) → 관리자 입금 확인', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}) — 품목 4·대체 후보 1 (mbId=${customer.mbId})`);
    const nameRows = await getPrisma().$queryRawUnsafe('SELECT mb_name AS name FROM g5_member WHERE mb_id = ?', customer.mbId) as any[];
    const buyerName = String(nameRows[0]?.name ?? '').trim() || customer.mbId;
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'D1',
      prefix: 'D1-demo-bomc',
      buyerName,
      expectedOrderAmount: ORDER_AMOUNT,
      expectedAppliedSetQty: FACTOR,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId} + g5_shop_cart (${customer.mbId})`);
    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금 확인: ${JSON.stringify(paid.json)}`).toBe(200);
    F('D1', 'obs', `주문 ${odId} ${won(ORDER_AMOUNT)} 입금 확인(입금 안내 메일은 Mailpit)`);
  }, 300_000);

  test('D2. 남기는 지점 확인 — 확인 요청 0건·보낼 수 있음·대체 후보 선택 가능·화면 준비', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const view = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`);
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    expect(view.json.data.eligibility, '확인 요청을 보낼 수 있는 상태').toMatchObject({ canCreate: true, reason: null, odId });
    expect(view.json.data.requests, '확인 요청은 아직 없다 — 남기는 지점의 정의').toEqual([]);
    expect((view.json.data.items as any[]).map((item) => `${String(item.mpn)}:${String(item.fulfillment)}:${String(item.activeIssueId)}`))
      .toEqual(LINES.map((line) => `${line.mpn}:normal:null`));

    const candidates = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/items/${seeded.itemIds.stock}/candidates`);
    expect(candidates.status, JSON.stringify(candidates.json)).toBe(200);
    const substitute = (candidates.json.data.candidates as any[]).find((entry) => entry.mpn === SUB_MPN);
    expect(substitute, '후보 서랍에 대체 후보').toMatchObject({ manualSelectable: true });
    expect(substitute?.bestOfferKey, '구매 가능한 조건').not.toBeNull();

    // 관리자 화면 — 패널과 [확인 요청 보내기]가 열려 있다(누르지는 않는다).
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('section[aria-labelledby="bom-confirm-panel-title"]');
    await panel.waitFor({ state: 'visible', timeout: 30_000 });
    await panel.getByText('보낸 확인 요청이 없습니다.').waitFor({ state: 'visible', timeout: 30_000 });
    expect(await panel.getByRole('button', { name: '확인 요청 보내기', exact: true }).isEnabled(), '[확인 요청 보내기] 활성').toBe(true);
    await rp.shot(adminView, 'D2-admin-before-confirm');

    // 고객 화면 — 부품 확인 메뉴가 서 있고(부품 주문 회원) 아직 할 일은 없다.
    const customerPage = customer.page;
    await customerPage.goto(`${BASE_URL}/shop/parts-confirm`, { waitUntil: 'domcontentloaded' });
    const menu = customerPage.locator('.smb_nav a').filter({ hasText: '부품 확인' });
    expect(await menu.count(), '확인 요청 › 부품 확인 메뉴').toBeGreaterThan(0);
    await rp.shot(customer, 'D2-customer-parts-confirm-empty');
    await customerPage.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, { waitUntil: 'domcontentloaded' });
    expect(await customerPage.locator('#sp_bomc_wrap').count(), '주문 상세에 부품 확인 섹션은 아직 없다').toBe(0);
    await rp.shot(customer, 'D2-customer-order-paid');
    ready = true;
    F('D2', 'obs', `Case #${seeded.quoteId} — 확인 요청 0건·보낼 수 있음, 여기서 멈춤`);
  }, 180_000);
});
