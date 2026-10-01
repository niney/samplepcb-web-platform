// 데모 주행 — **부품 확인 요청 유형 확장(D44, §6.40) 보내기 직전**에서 멈추고 남긴다(정리 없음 · 2026-10-01 사용자 요청).
//
// 사람이 새 유형 11개를 화면에서 하나씩 시험할 수 있게, 데모 고객 계정(e2e/.env.e2e 의 E2E_DEMO_CUSTOMER_ID/PW)으로
//   확정 BOM 견적(품목 11 — 유형마다 1개) → 고객 주문(무통장, 실제 PHP 주문서) → 관리자 입금 확인
//   + 산 뒤 유형 4개용 품목은 확인된 발주서(협력1)에 넣어 둔다
// 까지만 실주행한다. 관리자 [확인 요청 보내기] 부터는 **사람이 화면에서 직접** 이어 간다.
//
// 모든 품목은 UniKeyIC 구매 조건 — 발주서를 만들어도 실제 공급사 카트 API 를 부르지 않는다(§6.39 여정 23호 주석).
// 실행: pnpm -F e2e demo:bom-confirm-types
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
  getPartner,
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
const PO_PARTNER = '협력1';

type LineKey =
  | 'stock' | 'moq' | 'price' | 'change' | 'unofficial'
  | 'delay' | 'quality' | 'dc' | 'docs'
  | 'decrease' | 'eol';

interface DemoLine {
  key: LineKey;
  /** 이 품목으로 시험할 유형(작성 화면의 유형 버튼 이름). */
  type: string;
  mpn: string;
  manufacturerName: string;
  description: string;
  packageCode: string;
  refs: string[];
  sourceRow: number;
  bomQty: number;
  unitPrice: number; // KRW, VAT 별도
  /** 산 뒤 — 확인된 발주서에 넣어 둔다. */
  inPo: boolean;
  scenario: string; // 사람에게 안내할 시험 거리
}

const LINES: DemoLine[] = [
  {
    key: 'stock', type: '재고 부족', mpn: 'ESD9B5.0ST5G', manufacturerName: 'onsemi', description: 'TVS DIODE 5VWM SOD923',
    packageCode: 'SOD-923', refs: ['D1', 'D2'], sourceRow: 5, bomQty: 2, unitPrice: 90, inPo: false,
    scenario: "확인 근거 재고 예: 10(필요 24 중 일부만) → 입고 기다리기에 '먼저 온 부품 먼저 받기' 허용 시험",
  },
  {
    key: 'moq', type: 'MOQ·주문단위 증가', mpn: 'TLV9001IDBVR', manufacturerName: 'Texas Instruments', description: 'IC OPAMP GP 1 CIRCUIT SOT23-5',
    packageCode: 'SOT-23-5', refs: ['U3'], sourceRow: 7, bomQty: 1, unitPrice: 380, inPo: false,
    scenario: 'MOQ로 구매 — 실제 구매 수량 예: 50(차액 자동 계산)',
  },
  {
    key: 'price', type: '가격 인상', mpn: 'LM358DR', manufacturerName: 'Texas Instruments', description: 'IC OPAMP GP 2 CIRCUIT 8SOIC',
    packageCode: 'SOIC-8', refs: ['U4', 'U5'], sourceRow: 9, bomQty: 2, unitPrice: 250, inPo: false,
    scenario: '확인 근거 "지금 공급 단가" 예: 320 → 오른 가격으로 구매(개당 250원 → 320원)',
  },
  {
    key: 'change', type: '부품·사양 변경', mpn: 'GRM155R71H104KE14D', manufacturerName: 'Murata', description: 'CAP CER 0.1UF 50V X7R 0402',
    packageCode: '0402', refs: ['C1', 'C2', 'C3', 'C4', 'C7', 'C8', 'C11', 'C12'], sourceRow: 11, bomQty: 8, unitPrice: 15, inPo: false,
    scenario: '[대체 부품 고르기]에 후보 CL05B104KB5NNNC(엔진 판정 4행) → 바뀐 부품으로 진행',
  },
  {
    key: 'unofficial', type: '비공식 공급처', mpn: 'TPS7A2033PDBVR', manufacturerName: 'Texas Instruments', description: 'IC REG LINEAR 3.3V 300MA SOT23-5',
    packageCode: 'SOT-23-5', refs: ['U2'], sourceRow: 13, bomQty: 1, unitPrice: 420, inPo: false,
    scenario: '[같은 부품 다른 구매 조건 고르기]에 같은 품번 다른 조건(개당 560원) → 비공식 공급처에서 구매',
  },
  {
    key: 'delay', type: '입고 지연', mpn: 'B2B-XH-A(LF)(SN)', manufacturerName: 'JST', description: 'CONN HEADER VERT 2POS 2.5MM',
    packageCode: 'THT', refs: ['J1', 'J2'], sourceRow: 15, bomQty: 2, unitPrice: 70, inPo: true,
    scenario: '산 뒤 — 입고 기다리기(모아서/먼저 받기)는 적용, 대체품·고객 사급은 ITEM_IN_PO(2차)',
  },
  {
    key: 'quality', type: '품질 문제', mpn: 'BAT54S,215', manufacturerName: 'Nexperia', description: 'DIODE ARRAY SCHOTTKY 30V SOT23',
    packageCode: 'SOT-23', refs: ['D3', 'D4'], sourceRow: 17, bomQty: 2, unitPrice: 35, inPo: true,
    scenario: '산 뒤 — 교체품 기다리기(그대로 진행 선택지는 없음)',
  },
  {
    key: 'dc', type: '제조정보', mpn: 'RC0603FR-0710KL', manufacturerName: 'YAGEO', description: 'RES 10K OHM 1% 1/10W 0603',
    packageCode: '0603', refs: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'], sourceRow: 19, bomQty: 10, unitPrice: 5, inPo: true,
    scenario: '산 뒤 — 메모 예: D/C 2318 → 그대로 진행(발주서에 든 품목에도 적용)',
  },
  {
    key: 'docs', type: '증빙', mpn: 'SN74LVC1G08DBVR', manufacturerName: 'Texas Instruments', description: 'IC GATE AND 1CH 2-INP SOT23-5',
    packageCode: 'SOT-23-5', refs: ['U6'], sourceRow: 21, bomQty: 1, unitPrice: 160, inPo: true,
    scenario: '산 뒤 — 그대로 진행 또는 교체품 기다리기',
  },
  {
    key: 'decrease', type: '가격 인하', mpn: 'CL10A106KP8NNNC', manufacturerName: 'Samsung Electro-Mechanics', description: 'CAP CER 10UF 10V X5R 0603',
    packageCode: '0603', refs: ['C5', 'C6', 'C9', 'C10'], sourceRow: 23, bomQty: 4, unitPrice: 40, inPo: false,
    scenario: '알림 — 지금 공급 단가 예: 30 → 차액 환불 자동 계산(보내면 바로 종결·환불 정산 열림)',
  },
  {
    key: 'eol', type: '단종·EOL', mpn: 'ATMEGA328P-AU', manufacturerName: 'Microchip', description: 'IC MCU 8BIT 32KB FLASH 32TQFP',
    packageCode: 'TQFP-32', refs: ['U1'], sourceRow: 25, bomQty: 1, unitPrice: 3_200, inPo: false,
    scenario: '알림 — 금액 없이 안내(보내면 바로 처리 완료)',
  },
];
const CHANGE_SUB = { mpn: 'CL05B104KB5NNNC', manufacturerName: 'Samsung Electro-Mechanics', description: 'CAP CER 0.1UF 50V X7R 0402', unit: 18 };
const UNOFFICIAL_UNIT = 560;

const vat = (n: number): number => Math.round(n * 1.1);
const needed = (line: DemoLine): number => line.bomQty * FACTOR;
const lineTotal = (line: DemoLine): number => needed(line) * line.unitPrice;
const lineOf = (key: LineKey): DemoLine => {
  const found = LINES.find((line) => line.key === key);
  if (found === undefined) throw new Error(`데모 품목 ${key} 없음`);
  return found;
};
const ITEMS_TOTAL = LINES.reduce((sum, line) => sum + lineTotal(line), 0);
const CONFIRMED_TOTAL = ITEMS_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE;
const ORDER_AMOUNT = vat(CONFIRMED_TOTAL);
const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
const signed = (n: number): string => (n >= 0 ? `+${won(n)}` : `−${won(-n)}`);

interface CandidateSpec {
  candidateKey: string;
  mpn: string;
  manufacturerName: string;
  description: string;
  packageCode: string;
  unit: number;
  requiredQty: number;
  selectionMode: 'exact' | 'spec-compatible';
  assessments: string[][]; // [key, comparison, expected, actual]
  reason: string;
}

/** 후보 스냅샷 — 관리자 후보 서랍에 '검토 후 선택'으로 뜨고, 고객 분석근거에 판정표로 보인다. */
function candidatePayload(spec: CandidateSpec): Record<string, unknown> {
  const offerKey = `ok2:demo-bomt-${spec.candidateKey.slice(-14)}`;
  return {
    candidateKey: spec.candidateKey,
    identityKey: spec.candidateKey,
    technicalRank: 1,
    technicalReviewRank: null,
    selectionRecommendation: 'candidate_only',
    reviewRecommended: false,
    status: 'matched',
    selectionMode: spec.selectionMode,
    safety: 'safe',
    selectionEligibility: 'manual_review',
    autoEligible: false,
    manualSelectable: true,
    selectionReasonCodes: ['demo-candidate'],
    mpn: spec.mpn,
    manufacturerName: spec.manufacturerName,
    description: spec.description,
    category: 'demo',
    packageCode: spec.packageCode,
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
    identityConfidence: spec.selectionMode === 'exact' ? 1 : 0.92,
    specificationConfidence: 1,
    conflicts: [],
    missingRequirements: [],
    reasons: [spec.reason],
    corroboratingSuppliers: ['unikeyic'],
    verifiedRequirementCount: spec.assessments.length,
    requiredRequirementCount: spec.assessments.length,
    requirementAssessments: spec.assessments.map(([key, comparison, expectedDisplay, actualDisplay]) => ({
      key, comparison, state: 'match', verified: true, expectedDisplay, actualDisplay, source: 'bom',
    })),
    verificationComplete: true,
    strictCategoryCoverage: true,
    technicalEvidenceKey: spec.candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: {},
    specComparisons: {},
    packageComparison: null,
    offers: [{
      offerKey,
      supplier: 'unikeyic',
      offerKind: 'supplier_offer',
      supplierSku: `DEMO-ALT-${spec.mpn}`,
      packaging: 'Cut Tape',
      stock: 50_000,
      moq: 1,
      orderMultiple: 1,
      productUrl: null,
      leadTime: '재고 즉시',
      fetchedAt: new Date().toISOString(),
      priceBreaks: [{ qty: 1, price: spec.unit, currency: 'KRW' }],
      procurementDecision: {
        procurement_policy_version: 'supplier-procurement-decision-v1',
        procurement_mode: 'sample',
        offer_key_version: 'supplier-offer-key-v2',
        rank_scope: 'identity_and_technical_evidence',
        offer_key: offerKey,
        calculation_status: 'calculated',
        required_quantity: spec.requiredQty,
        order_quantity: spec.requiredQty,
        applied_price_break_quantity: 1,
        source_unit_price: spec.unit,
        source_currency: 'KRW',
        exchange_rate: 1,
        target_currency: 'KRW',
        converted_unit_price: spec.unit,
        line_total: spec.unit * spec.requiredQty,
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
      required_quantity: spec.requiredQty,
      target_currency: 'KRW',
      currency_rate_snapshot_id: `demo-bomt-${spec.candidateKey.slice(-12)}`,
      currency_rate_as_of: new Date().toISOString(),
      currency_rate_source: 'demo-fixture',
      technical_preselection_identity_key: spec.candidateKey,
      technical_preselection_evidence_key: spec.candidateKey.replace('ik1:', 'ek1:'),
      application_candidate_identity_key: spec.candidateKey,
      application_candidate_evidence_key: spec.candidateKey.replace('ik1:', 'ek1:'),
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

function candidateFor(line: DemoLine, itemId: string): CandidateSpec | null {
  if (line.key === 'change') {
    return {
      candidateKey: `ik1:demo-bomt-chg-${itemId}`,
      mpn: CHANGE_SUB.mpn,
      manufacturerName: CHANGE_SUB.manufacturerName,
      description: CHANGE_SUB.description,
      packageCode: line.packageCode,
      unit: CHANGE_SUB.unit,
      requiredQty: needed(line),
      selectionMode: 'spec-compatible',
      assessments: [
        ['capacitance_f', 'eq', '100 nF', '100 nF'],
        ['voltage_v', 'gte', '50 V', '50 V'],
        ['dielectric', 'eq', 'X7R', 'X7R'],
        ['package', 'eq', '0402', '0402'],
      ],
      reason: '정전용량·정격전압·유전체·패키지가 모두 같습니다.',
    };
  }
  if (line.key === 'unofficial') {
    return {
      candidateKey: `ik1:demo-bomt-alt-${itemId}`,
      mpn: line.mpn,
      manufacturerName: line.manufacturerName,
      description: line.description,
      packageCode: line.packageCode,
      unit: UNOFFICIAL_UNIT,
      requiredQty: needed(line),
      selectionMode: 'exact',
      assessments: [
        ['part_number', 'eq', line.mpn, line.mpn],
        ['manufacturer', 'eq', line.manufacturerName, line.manufacturerName],
      ],
      reason: '같은 품번 — 정식 유통 재고가 없어 다른 구매 조건으로만 구할 수 있습니다(데모).',
    };
  }
  return null;
}

interface Seeded {
  quoteId: string;
  title: string;
  itemIds: Record<LineKey, string>;
}

async function seedAnsweredQuote(mbId: string): Promise<Seeded> {
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[데모] 부품 확인 유형 확장 ${STAMP}`,
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
        answerNote: '데모 확정 견적입니다 — 부품 확인 요청 새 유형 11개를 화면에서 시험하세요.',
        adminMemo: `[데모 ${STAMP}] 부품 확인 유형 확장(D44) 직전 남김 — demo-bom-confirm-types-keep`,
        confirmedShippingFee: SHIPPING_FEE,
        confirmedManagementFee: MANAGEMENT_FEE,
        confirmedTotal: CONFIRMED_TOTAL,
      },
    });
    const itemIds = {} as Record<LineKey, string>;
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
            offerKey: `ok2:demo-bomt-${line.key}-${String(quote.id)}`,
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
      const candidate = candidateFor(line, String(item.id));
      if (candidate !== null) {
        await tx.spBomQuoteCandidate.create({
          data: {
            quoteId: quote.id,
            quoteItemId: item.id,
            candidateKey: candidate.candidateKey,
            technicalRank: 1,
            status: 'matched',
            selectionMode: candidate.selectionMode,
            safety: 'safe',
            autoEligible: false,
            mpn: candidate.mpn,
            manufacturerName: candidate.manufacturerName,
            payload: candidatePayload(candidate),
          },
        });
      }
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds };
  });
}

/** 산 뒤 유형용 — 이미 공급사에 낸(확인된) 발주서에 넣어 둔다. */
async function seedConfirmedPo(seeded: Seeded): Promise<string> {
  const partner = await getPartner(PO_PARTNER);
  const lines = LINES.filter((line) => line.inPo);
  const po = await getPrisma().spBomPo.create({
    data: {
      quoteId: BigInt(seeded.quoteId),
      partnerId: partner.id,
      status: 'confirmed',
      totalAmount: lines.reduce((sum, line) => sum + lineTotal(line), 0),
      currency: 'KRW',
      memo: `[데모 ${STAMP}] 산 뒤 유형(입고 지연·품질·제조정보·증빙) 시험용 확인된 발주서`,
      confirmedAt: new Date(),
      items: {
        create: lines.map((line) => ({
          quoteItemId: BigInt(seeded.itemIds[line.key]),
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          qty: needed(line),
          unitPrice: line.unitPrice,
          lineTotal: lineTotal(line),
          moq: 1,
          stock: 10_000,
        })),
      },
    },
  });
  return String(po.id);
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (response.status >= 500) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

describe.skipIf(!RUN || !DEMO)('데모 — 부품 확인 요청 유형 확장 보내기 직전까지(남김)', () => {
  const rp = createJourneyReport('demo-bom-confirm-types-keep', '부품 확인 유형 확장 직전 남김 주행 리포트');
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let adminView!: E2eSession;
  let adminToken = '';
  let seeded: Seeded | null = null;
  let odId: string | null = null;
  let poId: string | null = null;
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
      const price = lineOf('price');
      const decrease = lineOf('decrease');
      const change = lineOf('change');
      const unofficial = lineOf('unofficial');
      const moq = lineOf('moq');
      const ref = (unit: number, line: DemoLine): number => vat(unit * needed(line)) - vat(lineTotal(line));
      console.log(
        '\n[demo-bom-confirm-types] 부품 확인 요청 보내기 직전까지 남겼습니다 — 다음은 화면에서:\n' +
          `  Case #${seeded.quoteId} ${seeded.title}\n` +
          `  주문 ${odId} (${customer.mbId}) · 결제 ${won(ORDER_AMOUNT)} 입금 확인 완료\n` +
          `  산 뒤 품목 4개는 ${PO_PARTNER} 발주서 #${poId ?? '—'}(확인됨)에 들어 있습니다\n\n` +
          `  ① 관리자: ${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms → [확인 요청 보내기]\n` +
          '     품목마다 [유형] 을 고르고 보내 보세요. 알림 2개(가격 인하·단종)는 질문과 따로 보내야 합니다.\n' +
          LINES.map((line) => `       · [${line.type}] ${line.mpn} (필요 ${String(needed(line))}개 · 개당 ${won(line.unitPrice)} · 라인 ${won(lineTotal(line))}) — ${line.scenario}`).join('\n') + '\n' +
          `     참고 차액(VAT 포함): 가격 인상 320원이면 ${signed(ref(320, price))} · 가격 인하 30원이면 ${signed(ref(30, decrease))}` +
          ` · 바뀐 부품 ${signed(ref(CHANGE_SUB.unit, change))} · 비공식 ${signed(ref(UNOFFICIAL_UNIT, unofficial))}` +
          ` · MOQ 50개면 ${signed(vat(50 * moq.unitPrice) - vat(lineTotal(moq)))}\n` +
          `  ② 고객(${customer.mbId}): 로그인 → ${BASE_URL}/shop/parts-confirm (확인 요청 › 부품 확인)\n` +
          `       또는 주문 상세 ${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}\n` +
          '  ③ 관리자: Case 상세 부품 확인 패널에서 적용 → 정산(추가결제 확인·감액·환불 기록), 목록은 스마트 BOM › 부품 확인\n' +
          `  메일: ${MAILPIT_URL} (Mailpit — 실제 메일 주소로는 나가지 않습니다)\n` +
          '  ⚠ UniKeyIC 구매 조건이라 발주서를 만들어도 외부 공급사 카트 API 를 부르지 않습니다.\n',
      );
    }
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('D1. 데모 고객 확정 견적(품목 11) → 실제 주문서(무통장) → 관리자 입금 확인 → 산 뒤 품목 발주서', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}) — 품목 11·후보 2 (mbId=${customer.mbId})`);
    const nameRows = await getPrisma().$queryRawUnsafe('SELECT mb_name AS name FROM g5_member WHERE mb_id = ?', customer.mbId) as any[];
    const buyerName = String(nameRows[0]?.name ?? '').trim() || customer.mbId;
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'D1',
      prefix: 'D1-demo-bomt',
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
    poId = await seedConfirmedPo(seeded);
    ledger.push(`sp_bom_po #${poId}(${PO_PARTNER} · 확인됨 — 산 뒤 품목 4)`);
    F('D1', 'obs', `주문 ${odId} ${won(ORDER_AMOUNT)} 입금 확인 · 산 뒤 발주서 #${poId}`);
  }, 300_000);

  test('D2. 남기는 지점 확인 — 확인 요청 0건·보낼 수 있음·후보·발주서·화면 준비', async (ctx) => {
    if (seeded === null || odId === null || poId === null) return ctx.skip();
    const view = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/confirms`);
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    expect(view.json.data.eligibility, '확인 요청을 보낼 수 있는 상태').toMatchObject({ canCreate: true, reason: null, odId });
    expect(view.json.data.requests, '확인 요청은 아직 없다 — 남기는 지점의 정의').toEqual([]);
    const items = view.json.data.items as any[];
    expect(items.map((item) => `${String(item.mpn)}:${String(item.fulfillment)}:${String(item.activeIssueId)}`))
      .toEqual(LINES.map((line) => `${line.mpn}:normal:null`));
    for (const line of LINES) {
      const row = items.find((item) => item.mpn === line.mpn);
      if (line.inPo) expect(row?.po, `${line.mpn}: 산 뒤 — 발주서에 든 품목`).toMatchObject({ poId });
      else expect(row?.po ?? null, `${line.mpn}: 아직 발주 전`).toBeNull();
    }
    for (const key of ['change', 'unofficial'] as const) {
      const candidates = await api(adminToken, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/items/${seeded.itemIds[key]}/candidates`);
      expect(candidates.status, JSON.stringify(candidates.json)).toBe(200);
      const pick = (candidates.json.data.candidates as any[]).find((entry) => entry.manualSelectable === true);
      expect(pick?.bestOfferKey ?? null, `${key}: 후보 서랍에서 고를 수 있는 구매 조건`).not.toBeNull();
    }

    // 관리자 화면 — 패널과 [확인 요청 보내기]가 열려 있다(누르지는 않는다).
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}?from=confirms`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('section[aria-labelledby="bom-confirm-panel-title"]');
    await panel.waitFor({ state: 'visible', timeout: 30_000 });
    await panel.getByText('보낸 확인 요청이 없습니다.').waitFor({ state: 'visible', timeout: 30_000 });
    expect(await panel.getByRole('button', { name: '확인 요청 보내기', exact: true }).isEnabled(), '[확인 요청 보내기] 활성').toBe(true);
    await rp.shot(adminView, 'D2-admin-before-confirm-types');

    // 고객 화면 — 주문 상세에 부품 확인 섹션은 아직 없다.
    const customerPage = customer.page;
    await customerPage.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, { waitUntil: 'domcontentloaded' });
    expect(await customerPage.locator('#sp_bomc_wrap').count(), '주문 상세에 부품 확인 섹션은 아직 없다').toBe(0);
    await rp.shot(customer, 'D2-customer-order-paid-types');
    ready = true;
    F('D2', 'obs', `Case #${seeded.quoteId} — 확인 요청 0건·보낼 수 있음·후보 2·산 뒤 발주서 #${poId}, 여기서 멈춤`);
  }, 180_000);
});
