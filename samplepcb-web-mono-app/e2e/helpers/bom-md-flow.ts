// BOM 외화 회신 + 마스터딜러 중개 흐름 도구(docs/SMARTBOM_PARTNER_RFQ.md §6.41~6.44).
//
// 견적요청 발송부터 송금 기록까지의 열세 칸을 **한 칸씩 끊어 실행**할 수 있게 묶었다. 흔적 주행
// (demo-bom-md-trail-keep)은 칸마다 Case 를 하나씩 멈춰 남기고, 상세 여정(journey-bom-md-detail)은
// 필요한 칸까지 올린 뒤 경계를 찌른다. 각 칸은 스스로 검증하고(expect) 무슨 값이 나왔는지를
// facts 로 돌려준다 — 흔적 대장에 그대로 적힌다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'vitest';
import { api } from './api';
import { getPrisma, num } from './db';
import { placeOrderFromBomQuote, type JourneyReport, type JourneySession } from './journey';
import { signJwt } from './jwt';
import { ensureStagePartner, type PartnerFixture } from './seed';

// ── 무대(상설 픽스처) — 이름에 검사 문구(통화 코드·기호)를 넣지 않는다 ─────────────
export const BOM_MD_ORGS = {
  md: { mbId: 'e2e-bommd-m', orgName: 'e2e부품중개상사', country: 'CN', currency: 'USD' },
  outsider: { mbId: 'e2e-bommd-x', orgName: 'e2e남의협력사', country: 'KR', currency: 'KRW' },
  cny: { mbId: 'e2e-bomfx-b', orgName: 'e2e해외부품나', country: 'CN', currency: 'CNY' },
  krw: { mbId: 'e2e-bomfx-c', orgName: 'e2e국내부품다', country: 'KR', currency: 'KRW' },
} as const;

export const BOM_MD_CHILDREN = {
  a: { name: 'e2e하위부품가', country: 'CN', currency: 'CNY', email: 'e2e-bommd-child-a@test.local' },
  b: { name: 'e2e하위부품나', country: 'US', currency: 'USD', email: null },
} as const;

export interface BomMdStage {
  md: PartnerFixture;
  outsider: PartnerFixture;
  cny: PartnerFixture;
  krw: PartnerFixture;
  childAId: number;
  childBId: number;
  /** 관리자 · 마스터딜러 · 위안 협력사 · 원화 협력사 · 제3자 토큰 */
  A: string;
  M: string;
  C: string;
  K: string;
  X: string;
}

/** 무대 확보 — 조직·계정은 ensureStagePartner, 하위 둘은 마스터딜러가 포털 API 로 등록한다(멱등). */
export async function ensureBomMdStage(): Promise<BomMdStage> {
  const cap = { capabilities: ['bom_rfq'] };
  const md = await ensureStagePartner({ ...BOM_MD_ORGS.md, ...cap });
  const outsider = await ensureStagePartner({ ...BOM_MD_ORGS.outsider, ...cap });
  const cny = await ensureStagePartner({ ...BOM_MD_ORGS.cny, ...cap });
  const krw = await ensureStagePartner({ ...BOM_MD_ORGS.krw, ...cap });
  for (const org of [md, outsider, cny, krw]) {
    if (org.mbId === null) throw new Error(`${org.name} 연결 계정이 없습니다`);
  }
  const token = (org: PartnerFixture): string => signJwt({ mbId: org.mbId ?? '', ttlSec: 7_200 });
  const M = token(md);
  const list = await api(M, 'GET', '/api/partner/children');
  expect(list.status, JSON.stringify(list.json)).toBe(200);
  let children: { partnerId: number; name: string }[] = list.json?.data?.items ?? [];
  for (const child of Object.values(BOM_MD_CHILDREN)) {
    if (children.some((item) => item.name === child.name)) continue;
    const created = await api(M, 'POST', '/api/partner/children', {
      name: child.name,
      country: child.country,
      settlementCurrency: child.currency,
      contactEmail: child.email,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    children = created.json?.data?.items ?? [];
  }
  const idOf = (name: string): number => children.find((item) => item.name === name)?.partnerId ?? 0;
  const childAId = idOf(BOM_MD_CHILDREN.a.name);
  const childBId = idOf(BOM_MD_CHILDREN.b.name);
  expect(childAId, '하위 가').toBeGreaterThan(0);
  expect(childBId, '하위 나').toBeGreaterThan(0);
  return {
    md,
    outsider,
    cny,
    krw,
    childAId,
    childBId,
    A: signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 }),
    M,
    C: token(cny),
    K: token(krw),
    X: token(outsider),
  };
}

// ── 이야기 — 다섯 품목, 세 통화, 마스터딜러와 하위 둘 ─────────────────────────────
//   0·1번  마스터딜러가 하위 회신(가=위안, 나=달러)에 마진을 얹어 회신
//   2번    마스터딜러가 직접 조달
//   3번    위안 협력사 직접 선정(원화 협력사도 회신 — 비교 대상)
//   4번    원화 협력사 직접 선정(위안 협력사도 회신 — 비교 대상)
export const FLOW_LINES = [
  { mpn: 'RC0402FR-0710KL', manufacturerName: 'YAGEO', description: '10 kΩ 1% 0402', bomQty: 100, orderQty: 2_000 },
  { mpn: 'STM32F103C8T6', manufacturerName: 'STMicroelectronics', description: 'MCU LQFP-48', bomQty: 1, orderQty: 20 },
  { mpn: 'B2B-XH-A', manufacturerName: 'JST', description: '2P 2.5 mm header', bomQty: 2, orderQty: 40 },
  { mpn: 'GRM188R71H104KA93D', manufacturerName: 'Murata', description: '0.1 µF 50 V X7R 0603', bomQty: 20, orderQty: 400 },
  { mpn: 'LTST-C190KGKT', manufacturerName: 'Lite-On', description: 'Green LED 0603', bomQty: 5, orderQty: 100 },
] as const;

export const FLOW_PRICES = {
  /** 하위 가 → 0번(위안) · 하위 나 → 1번(달러) */
  childA: 0.024,
  childB: 3.31,
  marginA: 10,
  marginB: 5,
  /** 마스터딜러 직접 → 2번(달러) */
  mdDirect: 0.11,
  /** 직접 협력사 회신 — [3번, 4번] */
  cny: [0.035, 0.31],
  krw: [9, 42],
  /** 관리자가 직접 굳히는 위안 환율(고시와 겹치지 않는 값) */
  manualCnyRate: 205.5,
  shippingFee: 5_000,
  managementFee: 3_500,
} as const;

export const round4 = (value: number): number =>
  Math.round(Number((value * 10_000).toPrecision(12))) / 10_000;
export const round2 = (value: number): number =>
  Math.round(Number((value * 100).toPrecision(12))) / 100;

const today = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

const replyLine = (
  quoteItemId: string,
  index: number,
  unitPrice: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  quoteItemId,
  unitPrice,
  replyQty: FLOW_LINES[index]!.orderQty,
  moq: 1,
  stock: FLOW_LINES[index]!.orderQty * 3,
  dateCode: '25+',
  leadTime: '7영업일',
  memo: null,
  ...extra,
});

export interface ChildRfqRef {
  rfqId: number;
  partnerId: number;
  currency: string;
  magicToken: string;
}

export const FLOW_STEP_COUNT = 13;

/** 한 견적(Case)의 진행 — 칸을 순서대로 부른다(advanceTo). 값은 다음 칸이 쓰도록 여기 쌓인다. */
export class BomMdCase {
  quoteId = '';
  itemIds: string[] = [];
  mdRfqId = 0;
  cnyRfqId = 0;
  krwRfqId = 0;
  childA: ChildRfqRef | null = null;
  childB: ChildRfqRef | null = null;
  usdRate = 0;
  cnyRate = 0;
  /** 위안→달러 — 마스터딜러가 하위 가를 고른 순간에 굳은 환율 */
  crossRate = 0;
  itemsTotal = 0;
  confirmedTotal = 0;
  odId = '';
  mdPoId = 0;
  cnyPoId = 0;
  krwPoId = 0;
  mdPoTotal = 0;
  mdPoBookedRate = 0;
  mdPoA = 0;
  mdPoB = 0;
  step = 0;

  constructor(
    readonly stage: BomMdStage,
    readonly title: string,
  ) {}

  /** 검토 중 견적을 심는다 — 고객은 실계정(주문을 실제로 낸다). */
  static async seed(
    stage: BomMdStage,
    customerMbId: string,
    title: string,
    adminMemo: string,
  ): Promise<BomMdCase> {
    const flow = new BomMdCase(stage, title);
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: customerMbId,
        title,
        sourceKind: 'single_search',
        status: 'reviewing',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 20,
        spareQty: 0,
        itemsTotal: 0,
        shippingFee: FLOW_PRICES.shippingFee,
        managementFee: FLOW_PRICES.managementFee,
        finalTotal: FLOW_PRICES.shippingFee + FLOW_PRICES.managementFee,
        uncostedCount: FLOW_LINES.length,
        requestedAt: new Date(),
        customerMemo: '해외 재고가 있으면 함께 비교해 주세요.',
        adminMemo,
      },
    });
    flow.quoteId = String(quote.id);
    for (const [index, line] of FLOW_LINES.entries()) {
      const item = await prisma.spBomQuoteItem.create({
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
      flow.itemIds.push(String(item.id));
    }
    return flow;
  }

  private get A(): string {
    return this.stage.A;
  }

  private get M(): string {
    return this.stage.M;
  }

  async adminRfqs(): Promise<{ rfqs: any[]; partnerFx: { USD: any; CNY: any } }> {
    const res = await api(this.A, 'GET', `/api/admin/bom-quotes/${this.quoteId}/rfqs`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data;
  }

  async adminQuote(): Promise<any> {
    const res = await api(this.A, 'GET', `/api/admin/bom-quotes/${this.quoteId}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data;
  }

  async adminPos(): Promise<any[]> {
    const res = await api(this.A, 'GET', `/api/admin/bom-quotes/${this.quoteId}/pos`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data?.pos ?? [];
  }

  // ── 01 견적요청 발송 — 통화 박제·환율 고정 ──────────────────────────────────
  async sendRfqs(): Promise<string[]> {
    const { md, cny, krw } = this.stage;
    const sent = await api(this.A, 'POST', `/api/admin/bom-quotes/${this.quoteId}/rfqs`, {
      partnerIds: [num(md.id), num(cny.id), num(krw.id)],
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const data = await this.adminRfqs();
    const of = (org: PartnerFixture): any => data.rfqs.find((rfq) => rfq.partnerId === num(org.id));
    this.mdRfqId = of(md).rfqId;
    this.cnyRfqId = of(cny).rfqId;
    this.krwRfqId = of(krw).rfqId;
    expect(of(md).currency).toBe('USD');
    expect(of(cny).currency).toBe('CNY');
    expect(of(krw).currency).toBe('KRW');
    expect(data.partnerFx.USD, '달러 환율 고정').not.toBeNull();
    this.usdRate = data.partnerFx.USD.rate;
    this.cnyRate = data.partnerFx.CNY?.rate ?? 0;
    return [
      `견적요청 #${String(this.mdRfqId)}(마스터딜러·USD) · #${String(this.cnyRfqId)}(CNY) · #${String(this.krwRfqId)}(KRW)`,
      `견적 고정 환율 — 1 USD = ${String(this.usdRate)}원(${String(data.partnerFx.USD.source)}) · 1 CNY = ${
        this.cnyRate === 0 ? '환율원 없음' : `${String(this.cnyRate)}원(${String(data.partnerFx.CNY.source)})`
      }`,
    ];
  }

  // ── 02 마스터딜러 → 하위 재요청 ──────────────────────────────────────────────
  async fanOut(): Promise<string[]> {
    const { childAId, childBId } = this.stage;
    const res = await api(this.M, 'POST', `/api/partner/rfqs/${String(this.mdRfqId)}/children`, {
      partnerIds: [childAId, childBId],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json?.data?.added).toBe(2);
    const rows: ChildRfqRef[] = res.json?.data?.rfqs ?? [];
    this.childA = rows.find((row) => row.partnerId === childAId) ?? null;
    this.childB = rows.find((row) => row.partnerId === childBId) ?? null;
    if (this.childA === null || this.childB === null) throw new Error('하위 재요청이 없습니다');
    expect(this.childA.currency).toBe('CNY');
    expect(this.childB.currency).toBe('USD');
    // 관리자 직접 트랙에는 섞이지 않는다.
    const admin = await this.adminRfqs();
    expect(admin.rfqs).toHaveLength(3);
    expect(admin.rfqs.find((rfq) => rfq.rfqId === this.mdRfqId)?.children).toHaveLength(2);
    return [
      `하위 재요청 #${String(this.childA.rfqId)}(${BOM_MD_CHILDREN.a.name}·CNY) · #${String(this.childB.rfqId)}(${BOM_MD_CHILDREN.b.name}·USD)`,
      '하위 둘 다 포털 계정이 없다 — 매직링크로 회신한다',
    ];
  }

  // ── 03 하위·직접 협력사 회신(마스터딜러는 아직) ──────────────────────────────
  async repliesExceptMd(): Promise<string[]> {
    if (this.childA === null || this.childB === null) throw new Error('하위 재요청이 없습니다');
    const put = async (token: string | null, path: string, items: unknown[], memo: string): Promise<void> => {
      const res = await api(token, 'PUT', path, { items, deliveryDate: null, memo });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
    };
    await put(null, `/api/rfq-reply/${this.childA.magicToken}`, [replyLine(this.itemIds[0]!, 0, FLOW_PRICES.childA)], '하위 가 회신');
    await put(null, `/api/rfq-reply/${this.childB.magicToken}`, [replyLine(this.itemIds[1]!, 1, FLOW_PRICES.childB)], '하위 나 회신');
    await put(
      this.stage.C,
      `/api/partner/rfqs/${String(this.cnyRfqId)}`,
      [replyLine(this.itemIds[3]!, 3, FLOW_PRICES.cny[0]), replyLine(this.itemIds[4]!, 4, FLOW_PRICES.cny[1])],
      '위안 협력사 회신',
    );
    await put(
      this.stage.K,
      `/api/partner/rfqs/${String(this.krwRfqId)}`,
      [replyLine(this.itemIds[3]!, 3, FLOW_PRICES.krw[0]), replyLine(this.itemIds[4]!, 4, FLOW_PRICES.krw[1])],
      '원화 협력사 회신',
    );
    const admin = await this.adminRfqs();
    const md = admin.rfqs.find((rfq) => rfq.rfqId === this.mdRfqId);
    expect(md.status, '마스터딜러는 아직 회신 전').toBe('requested');
    expect(md.children.filter((child: any) => child.status === 'quoted')).toHaveLength(2);
    expect(admin.rfqs.find((rfq) => rfq.rfqId === this.cnyRfqId)?.status).toBe('quoted');
    return [
      `하위 가 0번 ¥${String(FLOW_PRICES.childA)} · 하위 나 1번 $${String(FLOW_PRICES.childB)}`,
      `위안 협력사 3번 ¥${String(FLOW_PRICES.cny[0])}·4번 ¥${String(FLOW_PRICES.cny[1])} / 원화 협력사 3번 ${String(FLOW_PRICES.krw[0])}원·4번 ${String(FLOW_PRICES.krw[1])}원`,
    ];
  }

  // ── 04 마스터딜러 회신 — 품목별 하위 선정 + 마진 ─────────────────────────────
  async mdReply(): Promise<string[]> {
    if (this.childA === null || this.childB === null) throw new Error('하위 재요청이 없습니다');
    const res = await api(this.M, 'PUT', `/api/partner/rfqs/${String(this.mdRfqId)}`, {
      items: [
        replyLine(this.itemIds[0]!, 0, 0, { childRfqId: this.childA.rfqId, marginRate: FLOW_PRICES.marginA }),
        replyLine(this.itemIds[1]!, 1, 0, { childRfqId: this.childB.rfqId, marginRate: FLOW_PRICES.marginB }),
        replyLine(this.itemIds[2]!, 2, FLOW_PRICES.mdDirect),
      ],
      deliveryDate: null,
      memo: '0·1번은 하위 회신에 마진, 2번은 직접',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const items: any[] = res.json?.data?.items ?? [];
    const l0 = items.find((item) => item.quoteItemId === this.itemIds[0])?.reply;
    const l1 = items.find((item) => item.quoteItemId === this.itemIds[1])?.reply;
    this.crossRate = l0?.childSelection?.sourceRate ?? 0;
    expect(this.crossRate, '위안→달러 환율').toBeGreaterThan(0);
    expect(l0.unitPrice).toBe(round4(FLOW_PRICES.childA * this.crossRate * (1 + FLOW_PRICES.marginA / 100)));
    expect(l1.unitPrice).toBe(round4(FLOW_PRICES.childB * (1 + FLOW_PRICES.marginB / 100)));
    return [
      `0번 = ¥${String(FLOW_PRICES.childA)} × ${String(this.crossRate)}(위안→달러, 지금 굳음) × 1.${String(FLOW_PRICES.marginA)} = $${String(l0.unitPrice)}`,
      `1번 = $${String(FLOW_PRICES.childB)} × 1.0${String(FLOW_PRICES.marginB)} = $${String(l1.unitPrice)} · 2번 직접 $${String(FLOW_PRICES.mdDirect)}`,
      `마스터딜러 회신 합계 $${String(res.json?.data?.totalAmount)}`,
    ];
  }

  // ── 05 관리자 선정 — 위안 환율 직접 입력 뒤 외화를 원화로 박제 ───────────────
  async select(): Promise<string[]> {
    const fx = await api(this.A, 'PUT', `/api/admin/bom-quotes/${this.quoteId}/partner-fx`, {
      currency: 'CNY',
      rate: FLOW_PRICES.manualCnyRate,
    });
    expect(fx.status, JSON.stringify(fx.json)).toBe(200);
    this.cnyRate = FLOW_PRICES.manualCnyRate;
    const data = await this.adminRfqs();
    const pick = async (rfqId: number, index: number): Promise<void> => {
      const rfq = data.rfqs.find((row) => row.rfqId === rfqId);
      const item = rfq.items.find((row: any) => row.quoteItemId === this.itemIds[index]);
      const res = await api(this.A, 'POST', `/api/admin/bom-quotes/${this.quoteId}/rfq-selection`, {
        kind: 'partner',
        itemId: this.itemIds[index],
        rfqItemId: item.rfqItemId,
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
    };
    await pick(this.mdRfqId, 0);
    await pick(this.mdRfqId, 1);
    await pick(this.mdRfqId, 2);
    await pick(this.cnyRfqId, 3);
    await pick(this.krwRfqId, 4);
    const quote = await this.adminQuote();
    for (const item of quote.items) {
      expect(item.selectionSource, `${String(item.mpn)} 선정`).toBe('partner');
      expect(item.selectedOffer.currency, '박제는 언제나 원화').toBe('KRW');
    }
    const offer = (index: number): any => quote.items.find((item: any) => item.id === this.itemIds[index]).selectedOffer;
    expect(offer(3).unitPriceKrw).toBe(round4(FLOW_PRICES.cny[0] * this.cnyRate));
    expect(offer(3).sourcePrice).toEqual({ currency: 'CNY', unitPrice: FLOW_PRICES.cny[0], rate: this.cnyRate });
    expect(offer(0).sourcePrice.currency).toBe('USD');
    expect(offer(4).sourcePrice ?? null).toBeNull();
    this.itemsTotal = quote.itemsTotal;
    return [
      `위안 환율을 관리자가 ${String(this.cnyRate)}원으로 직접 굳힘`,
      `0~2번 마스터딜러(달러 → 원화 ${String(this.usdRate)}) · 3번 위안 협력사(→ ${String(this.cnyRate)}) · 4번 원화 협력사`,
      `부품 합계 ${String(Math.round(this.itemsTotal))}원 — 박제는 전부 원화, 원본(통화·단가·환율)은 sourcePrice 에`,
    ];
  }

  // ── 06 고객 회신 확정 ────────────────────────────────────────────────────────
  async complete(): Promise<string[]> {
    let quote = await this.adminQuote();
    const pending = quote.items.filter(
      (item: any) => item.adminReview?.required === true && !item.adminReview.completed,
    );
    if (pending.length > 0) {
      const reviewed = await api(this.A, 'PUT', `/api/admin/bom-quotes/${this.quoteId}/item-reviews`, {
        itemIds: pending.map((item: any) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: quote.updatedAt,
        reason: '외화·중개 회신 확인',
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      quote = await this.adminQuote();
    }
    this.confirmedTotal =
      Math.ceil(quote.itemsTotal) + FLOW_PRICES.shippingFee + FLOW_PRICES.managementFee;
    const done = await api(this.A, 'POST', `/api/admin/bom-quotes/${this.quoteId}/complete`, {
      adminMemo: '외화·중개 회신 확정',
      answerNote: '해외·국내 협력 공급처 재고를 비교해 확정했습니다.',
      confirmedShippingFee: FLOW_PRICES.shippingFee,
      confirmedManagementFee: FLOW_PRICES.managementFee,
      confirmedTotal: this.confirmedTotal,
      sendEmail: false,
    });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json?.data?.status).toBe('answered');
    // 견적이 확정되면 견적요청은 전부 마감된다 — 하위 재요청도.
    const closed = await getPrisma().spBomRfq.count({
      where: { quoteId: BigInt(this.quoteId), status: { not: 'closed' } },
    });
    expect(closed, '열린 견적요청 없음').toBe(0);
    return [
      `확정 총액 ${String(this.confirmedTotal)}원(VAT 별도) — 견적요청 5건(직접 3 + 하위 2) 전부 마감`,
    ];
  }

  // ── 07 고객 주문·입금 ────────────────────────────────────────────────────────
  async orderAndPay(customer: JourneySession, rp: JourneyReport, prefix: string): Promise<string[]> {
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: this.quoteId,
      step: prefix,
      prefix,
      buyerName: 'e2eBOM흔적고객',
      expectedOrderAmount: Math.round(this.confirmedTotal * 1.1),
    });
    this.odId = placed.odId;
    const paid = await api(this.A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [this.odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    return [`주문 ${this.odId} — 결제 ${String(Math.round(this.confirmedTotal * 1.1))}원(VAT 포함) 입금 확인`];
  }

  // ── 08 발주 발행 — 세 통화 ───────────────────────────────────────────────────
  async issuePos(): Promise<string[]> {
    const { md, cny, krw } = this.stage;
    const res = await api(this.A, 'POST', `/api/admin/bom-quotes/${this.quoteId}/pos`, {
      partnerIds: [num(md.id), num(cny.id), num(krw.id)],
      memo: '세 통화 발주',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const pos: any[] = res.json?.data?.pos ?? [];
    const of = (org: PartnerFixture): any => pos.find((po) => po.partnerId === num(org.id));
    const mdPo = of(md);
    const cnyPo = of(cny);
    const krwPo = of(krw);
    this.mdPoId = mdPo.poId;
    this.cnyPoId = cnyPo.poId;
    this.krwPoId = krwPo.poId;
    this.mdPoTotal = mdPo.totalOriginal;
    this.mdPoBookedRate = mdPo.exchangeRate;
    expect(mdPo.currency).toBe('USD');
    expect(mdPo.items).toHaveLength(3);
    expect(cnyPo.currency).toBe('CNY');
    expect(cnyPo.totalOriginal).toBe(round2(FLOW_PRICES.cny[0] * FLOW_LINES[3].orderQty));
    expect(krwPo.currency).toBe('KRW');
    expect(krwPo.totalOriginal ?? null).toBeNull();
    expect(krwPo.totalAmount).toBe(FLOW_PRICES.krw[1] * FLOW_LINES[4].orderQty);
    // 장부 환율은 발행일 실제 환율 — 고객가에 쓴 견적 고정 환율과 다른 값이다.
    expect(cnyPo.exchangeRate, '위안 장부 환율 ≠ 관리자가 굳힌 고객가 환율').not.toBe(this.cnyRate);
    return [
      `발주 #${String(this.mdPoId)} 마스터딜러 $${String(mdPo.totalOriginal)}(장부 ${String(mdPo.exchangeRate)} → ${String(mdPo.totalAmount)}원)`,
      `발주 #${String(this.cnyPoId)} 위안 ¥${String(cnyPo.totalOriginal)}(장부 ${String(cnyPo.exchangeRate)} · 고객가 환율 ${String(this.cnyRate)}) · 발주 #${String(this.krwPoId)} 원화 ${String(krwPo.totalAmount)}원`,
    ];
  }

  // ── 09 마스터딜러 발주 확인 + 하위 발주 발행 ──────────────────────────────────
  async issueChildPos(): Promise<string[]> {
    const confirmed = await api(this.M, 'POST', `/api/partner/pos/${String(this.mdPoId)}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    const res = await api(this.M, 'POST', `/api/partner/pos/${String(this.mdPoId)}/child-pos`, {
      partnerIds: [this.stage.childAId, this.stage.childBId],
      memo: '견적 때 회신가 그대로 발주합니다',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const groups: any[] = res.json?.data?.groups ?? [];
    const a = groups.find((group) => group.partnerId === this.stage.childAId)?.mdPo;
    const b = groups.find((group) => group.partnerId === this.stage.childBId)?.mdPo;
    this.mdPoA = a.mdPoId;
    this.mdPoB = b.mdPoId;
    expect(a.currency).toBe('CNY');
    expect(a.totalAmount).toBe(round2(FLOW_PRICES.childA * FLOW_LINES[0].orderQty));
    expect(b.totalAmount).toBe(round2(FLOW_PRICES.childB * FLOW_LINES[1].orderQty));
    expect(res.json?.data?.directItemCount, '직접 조달 품목(2번)').toBe(1);
    return [
      `하위 발주 #${String(this.mdPoA)}(${BOM_MD_CHILDREN.a.name} ¥${String(a.totalAmount)}) · #${String(this.mdPoB)}(${BOM_MD_CHILDREN.b.name} $${String(b.totalAmount)})`,
      '단가는 견적 때 굳힌 하위 회신가 — 마스터딜러의 마진·환율은 하위 발주에 없다',
    ];
  }

  private async advance(mdPoId: number, body: Record<string, unknown>, to: string): Promise<void> {
    const res = await api(this.M, 'POST', `/api/partner/md-pos/${String(mdPoId)}/advance`, body);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json?.data?.status).toBe(to);
  }

  // ── 10 하위 확인·출고(계정 없는 하위 — 마스터딜러가 대신 찍는다) ──────────────
  async childShip(): Promise<string[]> {
    await this.advance(this.mdPoA, { action: 'confirm' }, 'confirmed');
    await this.advance(this.mdPoA, { action: 'ship', carrier: 'SF Express', trackingNo: `SF-${this.quoteId}` }, 'shipped');
    await this.advance(this.mdPoB, { action: 'confirm' }, 'confirmed');
    return [
      `하위 가 — 확인 → 출고(SF Express SF-${this.quoteId}) · 하위 나 — 확인까지`,
      '둘 다 마스터딜러가 대행으로 찍었다(하위는 포털 계정이 없다)',
    ];
  }

  // ── 11 마스터딜러 수령 ───────────────────────────────────────────────────────
  async mdReceive(): Promise<string[]> {
    await this.advance(this.mdPoA, { action: 'receive' }, 'received');
    await this.advance(this.mdPoB, { action: 'ship', carrier: 'UPS', trackingNo: `1Z-${this.quoteId}` }, 'shipped');
    await this.advance(this.mdPoB, { action: 'receive' }, 'received');
    const mdPo = (await this.adminPos()).find((po) => po.poId === this.mdPoId);
    expect(mdPo.childPos.every((child: any) => child.status === 'received')).toBe(true);
    return ['하위 발주 둘 다 수령 완료 — 이제 샘플피씨비로 출하할 물건이 마스터딜러 손에 있다'];
  }

  private async remit(poId: number, body: Record<string, unknown>): Promise<any> {
    const res = await api(this.A, 'POST', `/api/admin/bom-pos/${String(poId)}/remittances`, {
      remittedOn: today(),
      ...body,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data;
  }

  // ── 12 송금 일부 — 장부보다 비싼 환율로 절반 ─────────────────────────────────
  async remitPartial(): Promise<string[]> {
    const half = round2(this.mdPoTotal / 2);
    const paidRate = this.mdPoBookedRate + 30;
    const data = await this.remit(this.mdPoId, { amount: half, exchangeRate: paidRate, memo: '선금 50%' });
    expect(data.summary.status).toBe('partial');
    const diff = Math.round(half * paidRate) - Math.round(half * this.mdPoBookedRate);
    expect(data.summary.fxDiffKrw).toBe(diff);
    return [
      `마스터딜러 발주 $${String(this.mdPoTotal)} 중 $${String(half)} 지급 — 장부 ${String(this.mdPoBookedRate)} · 실제 ${String(paidRate)} → 환차 +${String(diff)}원`,
      `잔액 $${String(data.summary.balance)}`,
    ];
  }

  // ── 13 송금 완료 — 달러 잔액 + 원화 발주 전액. 위안 발주는 일부러 남긴다 ──────
  async remitRest(): Promise<string[]> {
    const half = round2(this.mdPoTotal / 2);
    const rest = await this.remit(this.mdPoId, { amount: round2(this.mdPoTotal - half), memo: '잔금' });
    expect(rest.summary.status).toBe('paid');
    const krwPo = (await this.adminPos()).find((po) => po.poId === this.krwPoId);
    const krw = await this.remit(this.krwPoId, { amount: krwPo.remittance.poAmount, memo: '원화 전액' });
    expect(krw.summary.status).toBe('paid');
    expect(krw.items[0].exchangeRate, '원화 송금에는 환율이 없다').toBeNull();
    expect(krw.summary.fxDiffKrw).toBeNull();
    const cnyPo = (await this.adminPos()).find((po) => po.poId === this.cnyPoId);
    expect(cnyPo.remittance.status).toBe('unpaid');
    return [
      `마스터딜러 발주 지급 완료(잔금은 환율을 비워 고시 환율 ${String(rest.items[1].exchangeRate)}로 기록) · 환차 합 ${String(rest.summary.fxDiffKrw)}원`,
      `원화 발주 ${String(krwPo.remittance.poAmount)}원 전액 지급 · 위안 발주 ¥${String(cnyPo.remittance.poAmount)}는 미지급으로 남겨 둠(직접 적어 볼 자리)`,
    ];
  }

  /** 칸 n 까지 올린다(이미 지난 칸은 건너뛴다). 칸별 facts 를 순서대로 돌려준다. */
  async advanceTo(
    target: number,
    order?: { customer: JourneySession; rp: JourneyReport; prefix: string },
  ): Promise<string[][]> {
    const steps: (() => Promise<string[]>)[] = [
      () => this.sendRfqs(),
      () => this.fanOut(),
      () => this.repliesExceptMd(),
      () => this.mdReply(),
      () => this.select(),
      () => this.complete(),
      () => {
        if (order === undefined) throw new Error('주문 칸에는 고객 세션이 필요합니다');
        return this.orderAndPay(order.customer, order.rp, order.prefix);
      },
      () => this.issuePos(),
      () => this.issueChildPos(),
      () => this.childShip(),
      () => this.mdReceive(),
      () => this.remitPartial(),
      () => this.remitRest(),
    ];
    const facts: string[][] = [];
    while (this.step < Math.min(target, steps.length)) {
      facts.push(await steps[this.step]!());
      this.step += 1;
    }
    return facts;
  }
}
