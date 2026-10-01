// Smart BOM 완주 여정 24호 — 부품 확인 요청 유형 확장(D44, docs/SMARTBOM_PARTNER_RFQ.md §6.40).
//
// 규칙 한 줄: 고객이 받는 것(부품·금액·수량·도착일)이 바뀌면 묻고, 고른 대로 처리한다(오르면 더 받고
// 내리면 환불). 22·23호가 품절·MOQ 를 봤다면 여기서는 새 유형을 실 API/DB/고객 화면으로 교차 확인한다.
//   T02 알림·질문 섞기와 단가 없는 가격 유형은 작성 단계에서 막힌다
//   T03 가격 인상 — '오른 가격으로 구매'(같은 부품, 단가 비교 박제) → 추가결제 → 결제 전 적용 막힘 → 선적용
//   T04 산 뒤 — 발주서에 든 품목의 제조정보: '그대로 진행'은 적용되고, 품목을 바꾸는 선택지는 ITEM_IN_PO(2차 이월)
//   T05 알림 — 가격 인하+단종 한 요청: 답 없이 종결·게이트 무관·고객 차례 아님 → 환불(감액→기록) → 처리 완료
//   T06 단종만 알림 — 돈이 없으면 만들자마자 처리 완료
//   T07 고객 주문 상세 — 알림 '안내' 표기·가격 비교·새 유형 이름
// 생성물은 대장에 남긴다(주문·정산 자동 정리 없음). 실행: pnpm -F e2e journey:bom:24
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  newPhpSession,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  signJwt,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const SET_QTY = 2;
const SPARE_QTY = 1;
const FACTOR = SET_QTY + SPARE_QTY; // neededQty = bomQty × (setQty + spareQty)
const BUYER = 'e2eBOM유형확장';

interface LinePlan {
  key: 'price' | 'decrease' | 'dc' | 'eol';
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  unitPrice: number;
}

const LINES: LinePlan[] = [
  { key: 'price', mpn: `E2E-BOMT-PRICE-${RUN_KEY}`, manufacturerName: 'Texas Instruments', description: 'Op-amp (가격 인상 fixture)', bomQty: 1, unitPrice: 1_000 },
  { key: 'decrease', mpn: `E2E-BOMT-DECR-${RUN_KEY}`, manufacturerName: 'Murata', description: 'MLCC (가격 인하 fixture)', bomQty: 2, unitPrice: 800 },
  { key: 'dc', mpn: `E2E-BOMT-DC-${RUN_KEY}`, manufacturerName: 'Nexperia', description: 'Diode (제조정보·발주서 fixture)', bomQty: 1, unitPrice: 500 },
  { key: 'eol', mpn: `E2E-BOMT-EOL-${RUN_KEY}`, manufacturerName: 'Microchip', description: 'MCU (단종 안내 fixture)', bomQty: 1, unitPrice: 2_000 },
];
const PRICE_UP_UNIT = 1_300;
const PRICE_DOWN_UNIT = 700;
const SHIPPING_FEE = 3_000;
const MANAGEMENT_FEE = 1_500;

const vat = (n: number): number => Math.round(n * 1.1);
const needed = (entry: LinePlan): number => entry.bomQty * FACTOR;
const lineTotal = (entry: LinePlan): number => needed(entry) * entry.unitPrice;
const line = (key: LinePlan['key']): LinePlan => {
  const found = LINES.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`fixture line ${key} 없음`);
  return found;
};
const won = (n: number): string => `${Math.abs(n).toLocaleString('ko-KR')}원`;

// 서버 참고값과 같은 식 — 새 라인(관찰 단가 × 주문 수량) − 원 라인, ×1.1.
const PRICE_UP_DELTA = vat(PRICE_UP_UNIT * needed(line('price'))) - vat(lineTotal(line('price')));
const PRICE_DOWN_DELTA = vat(PRICE_DOWN_UNIT * needed(line('decrease'))) - vat(lineTotal(line('decrease')));
const ITEMS_TOTAL = LINES.reduce((sum, entry) => sum + lineTotal(entry), 0);
const CONFIRMED_TOTAL = ITEMS_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE;
const ORDER_AMOUNT = vat(CONFIRMED_TOTAL);

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
}

async function seedAnsweredQuote(mbId: string): Promise<Seeded> {
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 24호] 부품 확인 유형 확장 ${RUN_KEY}`,
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
        answerNote: '부품 확인 유형 확장(D44) 여정 확정 견적입니다.',
        adminMemo: `[BOM 여정 24호 ${RUN_KEY}] confirm types fixture`,
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
          selectedOffer: {
            offerKey: `ok2:e2e24-${entry.key}-${RUN_KEY}`,
            supplier: 'digikey',
            supplierSku: `E2E24-${entry.key.toUpperCase()}-${String(index + 1)}`,
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
          },
        },
      });
      itemIds[entry.key] = String(item.id);
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds };
  });
}

/** 산 뒤 fixture — 이미 공급사에 낸(확인된) 발주서에 든 품목. */
async function seedConfirmedPo(quoteId: string, itemId: string, entry: LinePlan): Promise<string> {
  const partner = await getPartner('협력1');
  const now = new Date();
  const po = await getPrisma().spBomPo.create({
    data: {
      quoteId: BigInt(quoteId),
      partnerId: partner.id,
      status: 'confirmed',
      totalAmount: needed(entry) * entry.unitPrice,
      currency: 'KRW',
      memo: `[BOM 여정 24호 ${RUN_KEY}] 산 뒤 fixture`,
      confirmedAt: now,
      items: {
        create: [{
          quoteItemId: BigInt(itemId),
          mpn: entry.mpn,
          manufacturerName: entry.manufacturerName,
          description: entry.description,
          qty: needed(entry),
          unitPrice: entry.unitPrice,
          lineTotal: needed(entry) * entry.unitPrice,
          moq: 1,
          stock: 1_000,
        }],
      },
    },
  });
  return String(po.id);
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 24호 — 부품 확인 요청 유형 확장(D44)', () => {
  const rp = createJourneyReport(
    'findings-bom-confirm-types',
    'BOM 여정 24호 부품 확인 요청 유형 확장(가격 인상·산 뒤 제조정보·알림) 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer!: PhpLoginResult;
  let customerToken = '';
  let adminToken = '';
  let seeded: Seeded | null = null;
  let odId: string | null = null;
  let noticeRequestId: string | null = null;

  const base = (): string => `/api/admin/bom-quotes/${seeded?.quoteId ?? '0'}`;
  const adminCase = async (): Promise<any> => {
    const res = await api(adminToken, 'GET', `${base()}/confirms`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data;
  };
  const adminRequest = async (id: string): Promise<any> => {
    const found = (await adminCase()).requests.find((request: any) => request.id === id);
    if (found === undefined) throw new Error(`관리자 Case 뷰에 요청 #${id} 없음`);
    return found;
  };
  const customerRequest = async (id: string): Promise<any> => {
    const res = await api(customerToken, 'GET', `/api/bom/confirms?odId=${odId ?? ''}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const found = res.json.data.requests.find((request: any) => request.id === id);
    if (found === undefined) throw new Error(`고객 DTO 에 요청 #${id} 없음`);
    return found;
  };
  const createRequest = async (body: Record<string, unknown>): Promise<any> => {
    const res = await api(adminToken, 'POST', `${base()}/confirms`, { sendMail: false, ...body });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data.request;
  };
  const apply = async (request: any, issue: any, preApply = false): Promise<{ status: number; json: any }> =>
    api(adminToken, 'POST', `${base()}/confirms/${String(request.id)}/issues/${String(issue.id)}/apply`, {
      expectedVersion: request.version,
      preApply,
    });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
    customerToken = signJwt({ mbId: customer.mbId, ttlSec: 7_200 });
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('T01. 확정 견적 주문 → 입금 → 요청 가능', async () => {
    seeded = await seedAnsweredQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}) — 품목 4`);
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'T01',
      prefix: 'T01-bomt-order',
      buyerName: BUYER,
      expectedOrderAmount: ORDER_AMOUNT,
      expectedAppliedSetQty: FACTOR,
    });
    odId = placed.odId;
    ledger.push(`g5_shop_order ${odId}(원 BOM 주문 — 가격 인하 환불 감액 대상)`);
    const paid = await api(adminToken, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect((await adminCase()).eligibility).toMatchObject({ canCreate: true, reason: null, odId });
    F('T01', 'obs', `원 주문 ${won(ORDER_AMOUNT)} 입금 — 확인 요청 가능`);
  }, 300_000);

  test('T02. 작성 검증 — 알림·질문 섞기와 단가 없는 가격 유형은 막힌다', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const mixed = await api(adminToken, 'POST', `${base()}/confirms`, {
      sendMail: false,
      issues: [
        {
          quoteItemId: seeded.itemIds.dc,
          issueType: 'manufacturing_info',
          description: '입고 부품 Date Code 가 오래되었습니다.',
          observation: {},
          options: [{ kind: 'accept_as_is', priceDelta: 0 }],
        },
        {
          quoteItemId: seeded.itemIds.eol,
          issueType: 'eol_notice',
          description: '단종 예정 부품입니다.',
          observation: {},
          options: [{ kind: 'notice', priceDelta: 0 }],
        },
      ],
    });
    expect(mixed.status, JSON.stringify(mixed.json)).toBe(400);
    const noUnit = await api(adminToken, 'POST', `${base()}/confirms`, {
      sendMail: false,
      issues: [{
        quoteItemId: seeded.itemIds.price,
        issueType: 'price_increase',
        description: '공급 가격이 올랐습니다.',
        observation: {},
        options: [{ kind: 'price_accept', priceDelta: PRICE_UP_DELTA }],
      }],
    });
    expect(noUnit.status, JSON.stringify(noUnit.json)).toBe(400);
    F('T02', 'obs', '알림+질문 섞기 400 · 단가 없는 가격 인상 400');
  }, 60_000);

  test('T03. 가격 인상 — 오른 가격으로 구매(단가 비교 박제) → 추가결제 → 결제 전 적용 막힘 → 선적용(품목 그대로)', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const price = line('price');
    const request = await createRequest({
      issues: [{
        quoteItemId: seeded.itemIds.price,
        issueType: 'price_increase',
        description: '주문 확정 후 공급 가격이 올랐습니다.',
        observation: { unitPriceKrw: PRICE_UP_UNIT },
        options: [
          { kind: 'price_accept', priceDelta: PRICE_UP_DELTA },
          { kind: 'customer_supply', priceDelta: -vat(lineTotal(price)) },
        ],
      }],
    });
    ledger.push(`sp_bom_confirm_request #${String(request.id)}(가격 인상 — 추가결제 경로)`);
    expect(request.notice).toBe(false);
    const issue = request.issues[0];
    expect(issue.evidence.observation.unitPriceKrw).toBe(PRICE_UP_UNIT);
    expect(issue.options.map((option: any) => `${String(option.code)}:${String(option.kind)}`))
      .toEqual(['A:price_accept', 'B:customer_supply', 'C:consult']);
    expect(issue.options[0]).toMatchObject({
      title: '오른 가격으로 구매',
      referenceDelta: PRICE_UP_DELTA,
      price: { beforeUnitKrw: price.unitPrice, afterUnitKrw: PRICE_UP_UNIT, orderQty: needed(price), lineTotalKrw: PRICE_UP_UNIT * needed(price) },
    });

    const customerView = await customerRequest(String(request.id));
    const customerOption = customerView.issues[0].options[0];
    expect(customerOption.price, '고객 DTO 에도 단가 비교가 간다').toMatchObject({ beforeUnitKrw: price.unitPrice, afterUnitKrw: PRICE_UP_UNIT });
    expect(customerOption.referenceDelta, '서버 참고값은 고객에게 내리지 않는다').toBeUndefined();
    expect(customerView.notice).toBe(false);

    const answered = await api(customerToken, 'POST', `/api/bom/confirms/${String(request.id)}/answer`, {
      expectedVersion: customerView.version,
      choices: [{ issueId: issue.id, code: 'A' }],
    });
    expect(answered.status, JSON.stringify(answered.json)).toBe(200);
    let admin = await adminRequest(String(request.id));
    expect(admin.status).toBe('answered');
    expect(admin.settlement).toMatchObject({ kind: 'charge', amount: PRICE_UP_DELTA, status: 'pending' });

    const early = await apply(admin, admin.issues[0]);
    expect(early.status, '같은 부품 값 인상도 먼저 사고 돈을 못 받는 일을 막는다').toBe(409);
    expect(early.json?.error).toBe('PAYMENT_PENDING');
    const pre = await apply(admin, admin.issues[0], true);
    expect(pre.status, JSON.stringify(pre.json)).toBe(200);
    admin = await adminRequest(String(request.id));
    expect(admin.issues[0].status).toBe('applied');
    const row = await getPrisma().spBomQuoteItem.findUnique({ where: { id: BigInt(seeded.itemIds.price) } });
    expect(row?.mpn, '품목은 그대로').toBe(price.mpn);
    expect(row?.fulfillment).toBe('normal');
    F('T03', 'obs', `가격 인상 참고 차액 ${won(PRICE_UP_DELTA)} = 고객 선택 A → 추가결제 대기 → PAYMENT_PENDING → 선적용(품목 불변)`);
  }, 120_000);

  test('T04. 산 뒤 — 발주서에 든 품목의 제조정보: 그대로 진행은 적용, 품목을 바꾸는 선택지는 ITEM_IN_PO', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const dc = line('dc');
    const poId = await seedConfirmedPo(seeded.quoteId, seeded.itemIds.dc, dc);
    ledger.push(`sp_bom_po #${poId}(확인된 발주서 — 산 뒤 fixture)`);
    const itemRow = (await adminCase()).items.find((item: any) => item.quoteItemId === seeded?.itemIds.dc);
    expect(itemRow?.po, '발주서에 든 품목').toMatchObject({ poId });

    const first = await createRequest({
      issues: [{
        quoteItemId: seeded.itemIds.dc,
        issueType: 'manufacturing_info',
        description: '입고된 부품의 제조일(Date Code)이 2년 넘게 지났습니다.',
        observation: { note: 'D/C 2318' },
        options: [
          { kind: 'accept_as_is', priceDelta: 0 },
          { kind: 'wait_restock', priceDelta: 0, restock: { expectedOn: '2026-10-30', basis: '공급사 새 Lot 입고 예정' } },
          { kind: 'customer_supply', priceDelta: -vat(lineTotal(dc)) },
        ],
      }],
    });
    ledger.push(`sp_bom_confirm_request #${String(first.id)}(제조정보 — 그대로 진행)`);
    expect(first.issues[0].options.map((option: any) => option.title))
      .toEqual(['그대로 진행', '교체품 기다리기', '고객 사급', '상담 요청']);
    const view = await customerRequest(String(first.id));
    const answered = await api(customerToken, 'POST', `/api/bom/confirms/${String(first.id)}/answer`, {
      expectedVersion: view.version,
      choices: [{ issueId: view.issues[0].id, code: 'A' }],
    });
    expect(answered.status, JSON.stringify(answered.json)).toBe(200);
    let admin = await adminRequest(String(first.id));
    expect(admin.settlement, '그대로 진행은 돈이 오가지 않는다').toBeNull();
    const applied = await apply(admin, admin.issues[0]);
    expect(applied.status, `발주서에 든 품목도 그대로 진행은 적용된다: ${JSON.stringify(applied.json)}`).toBe(200);
    admin = await adminRequest(String(first.id));
    expect(admin.issues[0].status).toBe('applied');
    expect(admin.status, '돈도 할 일도 없으면 자동 처리 완료').toBe('resolved');

    const second = await createRequest({
      issues: [{
        quoteItemId: seeded.itemIds.dc,
        issueType: 'documents',
        description: '평소 함께 오던 CoC 서류가 없습니다.',
        observation: {},
        options: [
          { kind: 'accept_as_is', priceDelta: 0 },
          { kind: 'customer_supply', priceDelta: -vat(lineTotal(dc)) },
        ],
      }],
    });
    ledger.push(`sp_bom_confirm_request #${String(second.id)}(증빙 — 사급 선택 후 취소)`);
    const view2 = await customerRequest(String(second.id));
    const answered2 = await api(customerToken, 'POST', `/api/bom/confirms/${String(second.id)}/answer`, {
      expectedVersion: view2.version,
      choices: [{ issueId: view2.issues[0].id, code: 'B' }],
    });
    expect(answered2.status, JSON.stringify(answered2.json)).toBe(200);
    const admin2 = await adminRequest(String(second.id));
    const blocked = await apply(admin2, admin2.issues[0]);
    expect(blocked.status, '품목을 바꾸는 선택지는 발주서 정리 뒤(확인된 발주서 적용은 2차)').toBe(409);
    expect(blocked.json?.error).toBe('ITEM_IN_PO');
    const canceled = await api(adminToken, 'POST', `${base()}/confirms/${String(second.id)}/cancel`, {
      expectedVersion: admin2.version,
      reason: '여정 24호 — 2차 이월 확인 후 정리',
    });
    expect(canceled.status, JSON.stringify(canceled.json)).toBe(200);
    F('T04', 'obs', `확인된 발주서 #${poId} 품목 — 그대로 진행 적용·자동 완료, 사급은 ITEM_IN_PO(2차 이월) → 요청 취소`);
  }, 120_000);

  test('T05. 알림 — 가격 인하+단종: 답 없이 종결·게이트 무관·고객 차례 아님 → 환불(감액→기록) → 처리 완료', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const mineBefore = await api(customerToken, 'GET', '/api/bom/confirms/mine?scope=all');
    expect(mineBefore.status).toBe(200);
    const request = await createRequest({
      issues: [
        {
          quoteItemId: seeded.itemIds.decrease,
          issueType: 'price_decrease',
          description: '공급 가격이 내려 차액을 환불해 드립니다.',
          observation: { unitPriceKrw: PRICE_DOWN_UNIT },
          options: [{ kind: 'notice', priceDelta: PRICE_DOWN_DELTA }],
        },
        {
          quoteItemId: seeded.itemIds.eol,
          issueType: 'eol_notice',
          description: '이 부품은 단종 예정입니다. 이번 주문은 그대로 진행됩니다.',
          observation: { note: 'LTB 2027-03' },
          options: [{ kind: 'notice', priceDelta: 0 }],
        },
      ],
    });
    noticeRequestId = String(request.id);
    ledger.push(`sp_bom_confirm_request #${noticeRequestId}(알림 — 가격 인하 환불 + 단종 안내)`);
    expect(request).toMatchObject({ notice: true, status: 'answered', dueOn: null, netDelta: PRICE_DOWN_DELTA });
    expect(request.issues.map((issue: any) => [issue.status, issue.chosenCode, issue.options.length]))
      .toEqual([['closed', 'A', 1], ['closed', 'A', 1]]);
    expect(request.issues[0].options[0]).toMatchObject({ title: '차액 환불', referenceDelta: PRICE_DOWN_DELTA });
    expect(request.settlement, '가격 인하는 환불 정산이 바로 열린다').toMatchObject({ kind: 'refund', amount: -PRICE_DOWN_DELTA, status: 'pending' });
    expect(request.events.map((event: any) => event.action)).toContain('notified');

    const items = (await adminCase()).items;
    for (const key of ['decrease', 'eol'] as const) {
      const row = items.find((item: any) => item.quoteItemId === seeded?.itemIds[key]);
      expect(row?.activeIssueId ?? null, `${key}: 알림은 열린 이슈가 아니다(발주·배송 게이트 무관)`).toBeNull();
    }
    const mine = await api(customerToken, 'GET', '/api/bom/confirms/mine?scope=all');
    const mineRow = mine.json.data.requests.find((row: any) => row.id === noticeRequestId);
    expect(mineRow).toMatchObject({ notice: true, statusLabel: '안내', customerTurn: false });
    expect(mine.json.data.openCount, '알림은 고객 차례 배지에 들지 않는다').toBe(mineBefore.json.data.openCount);

    const settlementId = String(request.settlement.id);
    const reduced = await api(adminToken, 'POST', `${base()}/settlements/${settlementId}/reduce`, {});
    expect(reduced.status, JSON.stringify(reduced.json)).toBe(200);
    const refunded = await api(adminToken, 'POST', `${base()}/settlements/${settlementId}/refund`, { note: '여정 24호 가격 인하 환불' });
    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    const after = await adminRequest(noticeRequestId);
    expect(after.status, '환불 기록 뒤 자동 처리 완료').toBe('resolved');
    expect(after.settlement).toMatchObject({ status: 'refunded' });
    F('T05', 'obs', `알림 요청 #${noticeRequestId} — 답 없이 종결·배지 제외, 환불 ${won(PRICE_DOWN_DELTA)} 감액→기록 → resolved`);
  }, 120_000);

  test('T06. 단종만 알림 — 돈이 없으면 만들자마자 처리 완료', async (ctx) => {
    if (seeded === null || odId === null) return ctx.skip();
    const request = await createRequest({
      issues: [{
        quoteItemId: seeded.itemIds.eol,
        issueType: 'eol_notice',
        description: '후속 품번 안내 — 다음 생산부터 대체품 검토가 필요합니다.',
        observation: {},
        options: [{ kind: 'notice', priceDelta: 0 }],
      }],
    });
    ledger.push(`sp_bom_confirm_request #${String(request.id)}(단종 안내만)`);
    expect(request).toMatchObject({ notice: true, status: 'resolved', settlement: null, netDelta: 0 });
    expect(request.resolvedAt).not.toBeNull();
    F('T06', 'obs', `단종 안내 #${String(request.id)} — 만들자마자 resolved, 정산 없음`);
  }, 60_000);

  test('T07. 고객 주문 상세 — 알림은 안내로, 새 유형 이름과 가격 비교가 보인다', async (ctx) => {
    if (seeded === null || odId === null || noticeRequestId === null) return ctx.skip();
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}&_t=${String(Date.now())}#bomc-${noticeRequestId}`, { waitUntil: 'domcontentloaded' });
    const noticeCard = page.locator(`#bomc-${noticeRequestId}`);
    await noticeCard.waitFor({ state: 'visible', timeout: 30_000 });
    await rp.shot(customer, 'T07-notice-card');
    const noticeText = await noticeCard.innerText();
    for (const text of ['안내', '가격 인하', '단종·EOL', '차액 환불', '단종 안내', '안내 완료', '따로 하실 일은 없습니다']) {
      expect(noticeText, `알림 카드 문구: ${text}`).toContain(text);
    }
    expect(noticeText, '알림에는 고르는 표시가 없다').not.toContain('선택하신 처리');
    expect(await noticeCard.locator('input[type=radio]').count(), '알림에는 선택 폼이 없다').toBe(0);

    const wrap = page.locator('#sp_bomc_wrap');
    const wrapText = await wrap.innerText();
    for (const text of ['가격 인상', '오른 가격으로 구매', '제조정보', '그대로 진행']) {
      expect(wrapText, `부품 확인 이력 문구: ${text}`).toContain(text);
    }
    expect(wrapText, '가격 비교 요약').toContain(`${PRICE_UP_UNIT.toLocaleString('ko-KR')}원`);
    F('T07', 'obs', '주문 상세 — 알림은 안내·안내 완료·폼 없음, 가격 인상·제조정보 이력과 단가 비교 표시');
  }, 120_000);
});
