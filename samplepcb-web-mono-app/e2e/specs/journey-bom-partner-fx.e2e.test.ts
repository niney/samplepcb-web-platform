// Smart BOM 여정 — 협력사 외화 회신(docs/SMARTBOM_PARTNER_RFQ.md "외화 회신").
//
// 협력사는 자기 결제통화(링크 통화: KRW·USD·CNY)로 단가만 말한다. 관리자 비교와 고객가는
// 견적에 한 번 굳힌 환율로 환산한 원화로 하고, 발주 장부에는 발행 시점의 실제 환율을 적는다.
// 이 여정은 세 통화 협력사를 한 견적에 세워 그 약속이 끝까지 지켜지는지 본다:
//   배정 시 통화 박제 → 결제통화 회신 → 환율 고정·직접 입력·재환산 → 선정 박제(원본 보존) →
//   고객 응답에 공급망 정보 미노출 → 주문·입금 → 외화 발주(결제통화 정본 + 실제 환율 회계값).
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-partner-fx.md 대장으로 확인한 뒤
// 수동 정리한다. 실행: pnpm -F e2e journey:bom:fx
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  ensureStagePartner,
  getPrisma,
  mailpitMessage,
  mailpitSearch,
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

// 무대 — e2e 전용 계정·조직(상설 픽스처). 이름에 검사 문구(통화 코드·기호)를 넣지 않는다.
const STAGE = {
  usd: { mbId: 'e2e-bomfx-a', orgName: 'e2e해외부품가', country: 'US', currency: 'USD' },
  cny: { mbId: 'e2e-bomfx-b', orgName: 'e2e해외부품나', country: 'CN', currency: 'CNY' },
  krw: { mbId: 'e2e-bomfx-c', orgName: 'e2e국내부품다', country: 'KR', currency: 'KRW' },
} as const;
type StageKey = keyof typeof STAGE;

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  /** 협력사별 회신 단가(각자의 결제통화). */
  price: Record<StageKey, number>;
  /** 이 품목을 누구에게서 살지. */
  pick: StageKey;
}

const LINES: readonly SeedLine[] = [
  {
    mpn: 'RC0402FR-0710KL',
    manufacturerName: 'YAGEO',
    description: '10 kΩ 1% 0402 chip resistor',
    bomQty: 200,
    orderQty: 3_000,
    price: { usd: 0.0035, cny: 0.024, krw: 5 },
    pick: 'usd',
  },
  {
    mpn: 'STM32F103C8T6',
    manufacturerName: 'STMicroelectronics',
    description: 'Arm Cortex-M3 MCU 64 KB LQFP-48',
    bomQty: 1,
    orderQty: 15,
    price: { usd: 3.47, cny: 24.9, krw: 4_950 },
    pick: 'cny',
  },
  {
    mpn: 'B2B-XH-A',
    manufacturerName: 'JST',
    description: '2-position 2.5 mm wire-to-board header',
    bomQty: 2,
    orderQty: 30,
    price: { usd: 0.086, cny: 0.61, krw: 125 },
    pick: 'krw',
  },
] as const;

const SHIPPING_FEE = 5_000;
const MANAGEMENT_FEE = 3_500;
/** 관리자가 직접 굳히는 위안 환율 — 고시와 겹치지 않을 값. */
const MANUAL_CNY_RATE = 203.77;

interface FxRate {
  rate: number;
  sourceRate: number;
  safetyMarginPercent: number;
  source: 'quote-usd' | 'koreaexim' | 'manual';
}

interface AdminRfqItem {
  rfqItemId: number;
  quoteItemId: string;
  unitPrice: number | null;
  currency: string;
  unitPriceKrw: number | null;
}

interface AdminRfqRow {
  rfqId: number;
  partnerId: number;
  status: string;
  currency: string;
  totalAmount: number | null;
  totalAmountKrw: number | null;
  items: AdminRfqItem[];
}

interface AdminRfqListData {
  rfqs: AdminRfqRow[];
  partnerFx: { USD: FxRate | null; CNY: FxRate | null };
}

interface SelectedOffer {
  offerKey: string | null;
  unitPrice: number;
  currency: string;
  unitPriceKrw: number | null;
  sourcePrice?: { currency: string; unitPrice: number; rate: number } | null;
}

interface QuoteItem {
  id: string;
  mpn: string;
  orderQty: number;
  selectionSource: string;
  selectedOffer: SelectedOffer | null;
  lineTotalKrw: number | null;
  adminReview?: { required: boolean; completed: boolean };
}

interface QuoteData {
  status: string;
  updatedAt: string;
  itemsTotal: number;
  items: QuoteItem[];
}

interface PoItem {
  quoteItemId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  unitPriceOriginal: number | null;
  lineTotalOriginal: number | null;
}

interface PoRow {
  poId: number;
  partnerId: number;
  currency: string;
  totalAmount: number;
  totalOriginal: number | null;
  exchangeRate: number | null;
  items: PoItem[];
}

/** 서버 반올림(bom-fx)과 같은 규칙 — 단가 4자리·외화 금액 2자리. */
const round4 = (value: number): number => Math.round(Number((value * 10_000).toPrecision(12))) / 10_000;
const round2 = (value: number): number => Math.round(Number((value * 100).toPrecision(12))) / 100;

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

async function seedReviewingQuote(mbId: string): Promise<{ quoteId: string; title: string; itemIds: string[] }> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정] 협력사 세 통화 회신 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'reviewing',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 15,
        spareQty: 0,
        itemsTotal: 0,
        shippingFee: SHIPPING_FEE,
        managementFee: MANAGEMENT_FEE,
        finalTotal: SHIPPING_FEE + MANAGEMENT_FEE,
        uncostedCount: LINES.length,
        requestedAt: new Date(),
        customerMemo: '해외 재고가 있으면 함께 비교해 주세요.',
        adminMemo: `[BOM 여정 ${RUN_KEY}] partner fx fixture`,
      },
    });
    const itemIds: string[] = [];
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
          selectionSource: 'none',
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        },
      });
      itemIds.push(String(item.id));
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds };
  });
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 — 협력사 외화 회신(세 통화)', () => {
  const rp = createJourneyReport(
    'findings-bom-partner-fx',
    'BOM 여정 협력사 외화 회신 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let usdPartnerView: E2eSession;
  const partners = {} as Record<StageKey, PartnerFixture>;
  const tokens = {} as Record<StageKey, string>;
  const rfqIds = {} as Record<StageKey, number>;
  let A = '';
  let C = '';
  let quoteId = '';
  let title = '';
  let itemIds: string[] = [];
  let usdRate = 0;
  let cnyRate = 0;
  let odId: string | null = null;
  const poIds = {} as Partial<Record<StageKey, number>>;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    for (const key of Object.keys(STAGE) as StageKey[]) {
      const partner = await ensureStagePartner({ ...STAGE[key], capabilities: ['bom_rfq'] });
      if (partner.mbId === null) throw new Error(`${STAGE[key].orgName} 연결 계정이 없습니다`);
      partners[key] = partner;
      tokens[key] = signJwt({ mbId: partner.mbId, ttlSec: 7_200 });
    }
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    usdPartnerView = await newSession({ mbId: partners.usd.mbId ?? '' }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(usdPartnerView, '해외 협력사');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    C = signJwt({ mbId: customer.mbId, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 해외협력사: usdPartnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  async function loadRfqList(): Promise<AdminRfqListData> {
    const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const data: AdminRfqListData | undefined = response.json?.data;
    if (data === undefined) throw new Error('RFQ 현황이 없습니다');
    return data;
  }

  async function loadAdminQuote(): Promise<QuoteData> {
    const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const data: QuoteData | undefined = response.json?.data;
    if (data === undefined) throw new Error('관리자 BOM 상세가 없습니다');
    return data;
  }

  const rfqOf = (list: AdminRfqListData, key: StageKey): AdminRfqRow => {
    const row = list.rfqs.find((entry) => entry.partnerId === num(partners[key].id));
    if (row === undefined) throw new Error(`${STAGE[key].orgName} RFQ 가 없습니다`);
    return row;
  };

  test('X01. 배정하는 순간 결제통화가 박제되고 외화 환율이 견적에 굳는다', async () => {
    const seeded = await seedReviewingQuote(customer.mbId);
    quoteId = seeded.quoteId;
    title = seeded.title;
    itemIds = seeded.itemIds;
    ledger.push(`sp_bom_quote #${quoteId}`);

    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, {
      partnerIds: (Object.keys(STAGE) as StageKey[]).map((key) => num(partners[key].id)),
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);

    const list = await loadRfqList();
    for (const key of Object.keys(STAGE) as StageKey[]) {
      const rfq = rfqOf(list, key);
      rfqIds[key] = rfq.rfqId;
      expect(rfq.currency, `${STAGE[key].orgName} 결제통화 박제`).toBe(STAGE[key].currency);
      ledger.push(`sp_bom_rfq #${String(rfq.rfqId)}(${STAGE[key].orgName} · ${rfq.currency})`);
    }
    // 달러는 환율원이 늘 있다(견적의 달러 환율 또는 실효 환율) — 발송과 함께 굳어야 한다.
    expect(list.partnerFx.USD, '달러 환율 고정').not.toBeNull();
    usdRate = list.partnerFx.USD?.rate ?? 0;
    expect(usdRate).toBeGreaterThan(0);
    F(
      'X01',
      'obs',
      `발송 시 환율 고정 — USD ${String(usdRate)}(${list.partnerFx.USD?.source ?? '?'}) · CNY ${
        list.partnerFx.CNY === null ? '환율원 없음(직접 입력 대기)' : String(list.partnerFx.CNY.rate)
      }`,
    );

    // 이미 보낸 견적요청은 조직의 통화를 바꿔도 그대로다(회신 도중 통화가 바뀌지 않는다).
    const prisma = getPrisma();
    await prisma.spPartner.update({ where: { id: partners.usd.id }, data: { defaultCurrency: 'KRW' } });
    try {
      expect(rfqOf(await loadRfqList(), 'usd').currency).toBe('USD');
    } finally {
      await prisma.spPartner.update({ where: { id: partners.usd.id }, data: { defaultCurrency: 'USD' } });
    }
  }, 120_000);

  test('X02. 협력사는 자기 통화로만 회신한다 — 합계도 그 통화', async (ctx) => {
    if (quoteId === '') return ctx.skip();
    for (const key of Object.keys(STAGE) as StageKey[]) {
      const reply = await api(tokens[key], 'PUT', `/api/partner/rfqs/${String(rfqIds[key])}`, {
        items: LINES.map((line, index) => ({
          quoteItemId: itemIds[index],
          unitPrice: line.price[key],
          replyQty: line.orderQty,
          moq: 1,
          stock: line.orderQty * 4,
          dateCode: '25+',
          leadTime: key === 'krw' ? '국내 재고' : '해외 출고 7영업일',
          memo: null,
        })),
        deliveryDate: futureDate(9),
        memo: `[BOM 여정 ${RUN_KEY}] 세 통화 회신`,
      });
      expect(reply.status, JSON.stringify(reply.json)).toBe(200);
    }

    const totalIn = (key: StageKey): number =>
      LINES.reduce((sum, line) => sum + line.price[key] * line.orderQty, 0);
    const usdTotal = round2(totalIn('usd'));
    const cnyTotal = round2(totalIn('cny'));
    const krwTotal = Math.round(totalIn('krw'));

    // 협력사 포털 — 자기 통화 금액만 본다.
    const usdDetail = await api(tokens.usd, 'GET', `/api/partner/rfqs/${String(rfqIds.usd)}`);
    expect(usdDetail.status, JSON.stringify(usdDetail.json)).toBe(200);
    expect(usdDetail.json?.data?.currency).toBe('USD');
    expect(usdDetail.json?.data?.totalAmount).toBe(usdTotal);
    await rp.assertView(
      usdPartnerView,
      `/app/partner/bom/rfqs/${String(rfqIds.usd)}`,
      'X02-partner-usd-reply',
      [title, '단가(USD)'],
    );

    // 관리자 — 결제통화 합계 + 견적 고정 환율의 원화 환산.
    const list = await loadRfqList();
    const usd = rfqOf(list, 'usd');
    expect(usd.status).toBe('quoted');
    expect(usd.totalAmount).toBe(usdTotal);
    expect(usd.totalAmountKrw).toBe(Math.round(usdTotal * usdRate));
    for (const [index, line] of LINES.entries()) {
      const item = usd.items.find((entry) => entry.quoteItemId === itemIds[index]);
      expect(item?.unitPrice).toBe(line.price.usd);
      expect(item?.unitPriceKrw).toBe(round4(line.price.usd * usdRate));
    }
    expect(rfqOf(list, 'cny').totalAmount).toBe(cnyTotal);
    const krw = rfqOf(list, 'krw');
    expect(krw.totalAmount).toBe(krwTotal);
    expect(krw.totalAmountKrw, '원화 회신은 환산이 필요 없다').toBe(krwTotal);
    expect(krw.items.every((item) => item.unitPriceKrw === item.unitPrice)).toBe(true);

    // 원장 — 원화 전용 합계 컬럼은 외화 회신에서 비운다(통화가 섞인 합을 만들지 않는다).
    const stored = await getPrisma().spBomRfq.findUnique({
      where: { id: BigInt(rfqIds.usd) },
      select: { totalAmount: true, totalOriginal: true, currency: true },
    });
    expect(stored?.totalAmount).toBeNull();
    expect(Number(stored?.totalOriginal)).toBe(usdTotal);
  }, 120_000);

  test('X03. 위안 환율을 관리자가 직접 굳히면 비교표의 원화 환산이 그 값을 따른다', async (ctx) => {
    if (quoteId === '') return ctx.skip();
    const set = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/partner-fx`, {
      currency: 'CNY',
      rate: MANUAL_CNY_RATE,
    });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    const data: AdminRfqListData | undefined = set.json?.data;
    expect(data?.partnerFx.CNY?.source).toBe('manual');
    expect(data?.partnerFx.CNY?.rate).toBe(MANUAL_CNY_RATE);
    expect(data?.partnerFx.CNY?.safetyMarginPercent, '직접 입력은 마진을 얹지 않는다').toBe(0);
    cnyRate = MANUAL_CNY_RATE;
    const cny = rfqOf(await loadRfqList(), 'cny');
    for (const [index, line] of LINES.entries()) {
      const item = cny.items.find((entry) => entry.quoteItemId === itemIds[index]);
      expect(item?.unitPriceKrw).toBe(round4(line.price.cny * cnyRate));
    }

    // 화면 — 환율 띠·통화 배지·원화 환산이 한 표에 보인다.
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    const compare = page.getByRole('button', { name: '공급사 비교·선정', exact: true });
    await compare.waitFor({ state: 'visible', timeout: 60_000 });
    await compare.click();
    await page.getByText('협력사 외화 환율(이 견적에 고정)').waitFor({ timeout: 30_000 });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(body).toContain('1 USD =');
    expect(body).toContain('1 CNY =');
    expect(body).toContain('직접 입력');
    expect(body, '외화 단가 옆 원화 환산').toContain('≈');
    await rp.shot(adminView, 'X03-admin-compare-fx');
  }, 180_000);

  test('X04. 선정 — 원화로 환산해 박제하고 원본(통화·단가·환율)을 남긴다. 고객에게는 안 보인다', async (ctx) => {
    if (quoteId === '' || cnyRate === 0) return ctx.skip();
    const list = await loadRfqList();
    for (const [index, line] of LINES.entries()) {
      const rfqItem = rfqOf(list, line.pick).items.find(
        (entry) => entry.quoteItemId === itemIds[index],
      );
      if (rfqItem === undefined) throw new Error(`${line.mpn} 회신 행이 없습니다`);
      const selected = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
        kind: 'partner',
        itemId: itemIds[index],
        rfqItemId: rfqItem.rfqItemId,
      });
      expect(selected.status, JSON.stringify(selected.json)).toBe(200);
    }

    const detail = await loadAdminQuote();
    const rates: Record<StageKey, number> = { usd: usdRate, cny: cnyRate, krw: 1 };
    let expectedItemsTotal = 0;
    for (const [index, line] of LINES.entries()) {
      const item = detail.items.find((entry) => entry.id === itemIds[index]);
      const expectedKrw = line.pick === 'krw' ? line.price.krw : round4(line.price[line.pick] * rates[line.pick]);
      expect(item?.selectionSource).toBe('partner');
      // 엔진이 아는 통화는 원화·달러뿐이라 박제는 언제나 원화다.
      expect(item?.selectedOffer?.currency, `${line.mpn} 박제 통화`).toBe('KRW');
      expect(item?.selectedOffer?.unitPriceKrw, `${line.mpn} 원화 단가`).toBe(expectedKrw);
      expect(item?.lineTotalKrw).toBe(round2(expectedKrw * line.orderQty));
      if (line.pick === 'krw') {
        expect(item?.selectedOffer?.sourcePrice ?? null, '원화 회신은 원본 표기가 없다').toBeNull();
      } else {
        expect(item?.selectedOffer?.sourcePrice).toEqual({
          currency: STAGE[line.pick].currency,
          unitPrice: line.price[line.pick],
          rate: rates[line.pick],
        });
      }
      expectedItemsTotal += expectedKrw * line.orderQty;
    }
    expect(Math.round(detail.itemsTotal)).toBe(Math.round(expectedItemsTotal));

    // 고객 응답 — 협력사의 결제통화 단가·환율은 공급망 정보다. 한 글자도 나가지 않는다.
    const customerRead = await api(C, 'GET', `/api/bom/quotes/${quoteId}`);
    expect(customerRead.status, JSON.stringify(customerRead.json)).toBe(200);
    const customerItems: QuoteItem[] = customerRead.json?.data?.items ?? [];
    expect(customerItems).toHaveLength(LINES.length);
    for (const item of customerItems) {
      expect(item.selectedOffer?.sourcePrice ?? null, `${item.mpn} 고객 응답`).toBeNull();
    }
    const raw = JSON.stringify(customerRead.json);
    expect(raw).not.toContain('"sourcePrice":{');
    expect(raw, '달러 회신 단가').not.toContain(String(LINES[0]!.price.usd));
    expect(raw, '위안 회신 단가').not.toContain(String(LINES[1]!.price.cny));
  }, 120_000);

  test('X05. 환율을 바꾸면 그 통화로 고른 품목만 다시 환산된다', async (ctx) => {
    if (quoteId === '' || cnyRate === 0) return ctx.skip();
    const before = await loadAdminQuote();
    const nextUsdRate = round2(usdRate + 37.5);
    const set = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/partner-fx`, {
      currency: 'USD',
      rate: nextUsdRate,
    });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    usdRate = nextUsdRate;

    const after = await loadAdminQuote();
    for (const [index, line] of LINES.entries()) {
      const prev = before.items.find((entry) => entry.id === itemIds[index]);
      const item = after.items.find((entry) => entry.id === itemIds[index]);
      if (line.pick === 'usd') {
        expect(item?.selectedOffer?.unitPriceKrw).toBe(round4(line.price.usd * usdRate));
        expect(item?.selectedOffer?.sourcePrice?.rate).toBe(usdRate);
        expect(item?.selectedOffer?.sourcePrice?.unitPrice, '원본 단가는 그대로').toBe(line.price.usd);
      } else {
        expect(item?.selectedOffer?.unitPriceKrw, `${line.mpn} 은 다른 통화 — 불변`).toBe(
          prev?.selectedOffer?.unitPriceKrw,
        );
      }
    }
    expect(after.itemsTotal).not.toBe(before.itemsTotal);
  }, 120_000);

  test('X06. 고객 회신 뒤에는 환율을 바꿀 수 없다', async (ctx) => {
    if (quoteId === '' || cnyRate === 0) return ctx.skip();
    let detail = await loadAdminQuote();
    const pending = detail.items.filter(
      (item) => item.adminReview?.required === true && !item.adminReview.completed,
    );
    if (pending.length > 0) {
      const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
        itemIds: pending.map((item) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: detail.updatedAt,
        reason: `[BOM 여정 ${RUN_KEY}] 세 통화 회신 확인`,
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      detail = await loadAdminQuote();
    }
    const confirmedTotal = Math.ceil(detail.itemsTotal) + SHIPPING_FEE + MANAGEMENT_FEE;
    const completed = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      adminMemo: `[BOM 여정 ${RUN_KEY}] 세 통화 회신 확정`,
      answerNote: '해외·국내 재고를 함께 비교해 확정했습니다.',
      confirmedShippingFee: SHIPPING_FEE,
      confirmedManagementFee: MANAGEMENT_FEE,
      confirmedTotal,
      sendEmail: false,
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    expect(completed.json?.data?.status).toBe('answered');

    const late = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/partner-fx`, {
      currency: 'USD',
      rate: usdRate + 100,
    });
    expect(late.status, '확정 뒤 환율 변경 거부').toBe(409);
    expect(late.json?.error).toBe('INVALID_QUOTE_STATUS');
    expect((await loadRfqList()).partnerFx.USD?.rate).toBe(usdRate);
  }, 180_000);

  test('X07. 주문·입금 → 외화 발주: 결제통화가 정본, 원화는 발행일 실제 환율의 회계값', async (ctx) => {
    if (quoteId === '' || cnyRate === 0) return ctx.skip();
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId,
      step: 'X07',
      prefix: 'X07-partner-fx-order',
      buyerName: 'e2eBOM세통화고객',
    });
    odId = placed.odId;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);

    const issued = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, {
      partnerIds: [num(partners.usd.id), num(partners.cny.id), num(partners.krw.id)],
      memo: `[BOM 여정 ${RUN_KEY}] 세 통화 발주`,
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const pos: PoRow[] = issued.json?.data?.pos ?? [];
    ledger.push(`g5_shop_order ${odId}`);

    for (const key of ['usd', 'cny'] as const) {
      const po = pos.find((entry) => entry.partnerId === num(partners[key].id));
      if (po === undefined) throw new Error(`${STAGE[key].orgName} 발주서가 없습니다`);
      poIds[key] = po.poId;
      ledger.push(`sp_bom_po #${String(po.poId)}(${STAGE[key].orgName} · ${po.currency})`);
      const lines = LINES.map((line, index) => ({ line, id: itemIds[index] })).filter(
        ({ line }) => line.pick === key,
      );
      expect(po.currency).toBe(STAGE[key].currency);
      expect(po.items).toHaveLength(lines.length);
      const rate = po.exchangeRate ?? 0;
      expect(rate, '발행 시점 환율').toBeGreaterThan(0);
      let originalSum = 0;
      let krwSum = 0;
      for (const { line, id } of lines) {
        const item = po.items.find((entry) => entry.quoteItemId === id);
        const lineOriginal = round2(line.price[key] * line.orderQty);
        expect(item?.unitPriceOriginal, `${line.mpn} 결제통화 단가`).toBe(line.price[key]);
        expect(item?.lineTotalOriginal).toBe(lineOriginal);
        // 원화 회계값 = 결제통화 금액 × 실제 환율(단가부터 환산해 곱하지 않는다).
        expect(item?.lineTotal).toBe(Math.round(lineOriginal * rate));
        originalSum += lineOriginal;
        krwSum += Math.round(lineOriginal * rate);
      }
      expect(po.totalOriginal).toBe(round2(originalSum));
      expect(po.totalAmount).toBe(krwSum);

      // 협력사 포털 — 자기 통화 금액만. 원화 회계값·환율은 내보내지 않는다.
      const mine = await api(tokens[key], 'GET', `/api/partner/pos/${String(po.poId)}`);
      expect(mine.status, JSON.stringify(mine.json)).toBe(200);
      expect(mine.json?.data?.currency).toBe(STAGE[key].currency);
      expect(mine.json?.data?.totalAmount).toBe(round2(originalSum));
      const mineItems: PoItem[] = mine.json?.data?.items ?? [];
      for (const { line, id } of lines) {
        const item = mineItems.find((entry) => entry.quoteItemId === id);
        expect(item?.unitPrice).toBe(line.price[key]);
        expect(item?.lineTotal).toBe(round2(line.price[key] * line.orderQty));
        expect(item?.unitPriceOriginal ?? null).toBeNull();
      }
    }

    // 달러 장부 환율은 고객가에 쓴 고정 환율(X05 에서 일부러 비튼 값)이 아니라 실제 환율이다.
    const usdPo = pos.find((entry) => entry.partnerId === num(partners.usd.id));
    expect(usdPo?.exchangeRate, '장부 환율 ≠ 견적 고정 환율').not.toBe(usdRate);
    F(
      'X07',
      'obs',
      `달러 발주 — 고객가 환율 ${String(usdRate)} · 장부 환율 ${String(usdPo?.exchangeRate ?? '?')}`,
    );

    // 원화 협력사 발주는 예전과 같다 — 결제통화 표기가 없다.
    const krwPo = pos.find((entry) => entry.partnerId === num(partners.krw.id));
    expect(krwPo?.currency).toBe('KRW');
    expect(krwPo?.totalOriginal ?? null).toBeNull();
    expect(krwPo?.exchangeRate ?? null).toBeNull();
    const krwLine = LINES.find((line) => line.pick === 'krw');
    expect(krwPo?.totalAmount).toBe((krwLine?.price.krw ?? 0) * (krwLine?.orderQty ?? 0));

    // 화면 — 협력사 발주서는 결제통화로 적힌다.
    await rp.assertView(
      usdPartnerView,
      `/app/partner/bom/pos/${String(poIds.usd)}`,
      'X07-partner-usd-po',
      [title, '단가(USD)'],
    );
  }, 300_000);

  test('X08. 발주 안내 메일의 금액도 협력사 통화다', async (ctx) => {
    if (poIds.usd === undefined) return ctx.skip();
    const recipient = partners.usd.contactEmail;
    if (recipient === null) return ctx.skip();
    const usdLine = LINES.find((line) => line.pick === 'usd');
    const expected = `$${round2((usdLine?.price.usd ?? 0) * (usdLine?.orderQty ?? 0)).toFixed(2)}`;
    const deadline = Date.now() + 20_000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const result = await mailpitSearch(`to:"${recipient}" subject:"발주서 도착"`);
      const messages: { ID: string; Subject?: string }[] = result.messages ?? [];
      for (const message of messages) {
        if (!(message.Subject ?? '').includes(title)) continue;
        const full: { HTML?: string } = await mailpitMessage(message.ID);
        if ((full.HTML ?? '').includes(expected)) found = true;
      }
      if (!found) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(found, `발주 안내 메일에 ${expected} 표기`).toBe(true);
  }, 60_000);
});
