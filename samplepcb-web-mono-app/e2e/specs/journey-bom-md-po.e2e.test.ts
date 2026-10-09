// Smart BOM 여정 — 마스터딜러 중개(발주·지급 단계). docs/SMARTBOM_PARTNER_RFQ.md §6.43·§6.44.
//
// 견적 때 정한 계획(품목마다 고른 하위·그때 굳힌 하위 회신가)이 발주 뒤에 문서로 이어지는지 본다:
//   샘플피씨비 → 마스터딜러 발주(달러) → 마스터딜러 → 하위 발주(하위 통화·견적 때 굳힌 단가) →
//   하위 확인·출고(계정 없는 하위는 마스터딜러가 대행) → 마스터딜러 수령 →
//   샘플피씨비의 송금 기록(분할 지급·실제 환율·환차·초과 지급).
// 무대는 견적 단계 여정(journey-bom-md-rfq)과 같은 상설 픽스처를 쓴다.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-md-po.md 대장으로 확인한 뒤
// 수동 정리한다. 실행: pnpm -F e2e journey:bom:mdpo
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
const ACT_AS = 'x-sp-act-as-partner';

const MD = { mbId: 'e2e-bommd-m', orgName: 'e2e부품중개상사', country: 'CN', currency: 'USD' } as const;
const OUTSIDER = { mbId: 'e2e-bommd-x', orgName: 'e2e남의협력사', country: 'KR', currency: 'KRW' } as const;
const CHILD_A = { name: 'e2e하위부품가', country: 'CN', currency: 'CNY', email: 'e2e-bommd-child-a@test.local' } as const;
const CHILD_B = { name: 'e2e하위부품나', country: 'US', currency: 'USD', email: null } as const;

const LINES = [
  { mpn: 'RC0402FR-0710KL', manufacturerName: 'YAGEO', description: '10 kΩ 1% 0402', bomQty: 100, orderQty: 2_000 },
  { mpn: 'STM32F103C8T6', manufacturerName: 'STMicroelectronics', description: 'MCU LQFP-48', bomQty: 1, orderQty: 20 },
  { mpn: 'B2B-XH-A', manufacturerName: 'JST', description: '2P 2.5 mm header', bomQty: 2, orderQty: 40 },
] as const;

/** 하위 회신가 — 0번은 하위 가(위안), 1번은 하위 나(달러). 2번은 마스터딜러가 직접 조달한다. */
const CHILD_A_PRICE = 0.024;
const CHILD_B_PRICE = 3.31;
const MD_DIRECT_PRICE = 0.11;

interface MdPoItem {
  poItemId: number;
  mpn: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

interface MdPo {
  mdPoId: number;
  partnerId: number;
  partnerName: string;
  parentPartnerName: string;
  hasPortalAccount: boolean;
  status: string;
  currency: string;
  totalAmount: number;
  carrier: string | null;
  trackingNo: string | null;
  items: MdPoItem[];
  actions?: string[];
  canDelete?: boolean;
  viewerRole?: string;
}

interface PlanGroup {
  partnerId: number;
  partnerName: string;
  currency: string;
  totalAmount: number;
  items: MdPoItem[];
  mdPo: MdPo | null;
}

interface PlanData {
  canIssue: boolean;
  directItemCount: number;
  groups: PlanGroup[];
}

interface RemittanceSummary {
  currency: string;
  poAmount: number;
  paidAmount: number;
  balance: number;
  status: string;
  count: number;
  fxDiffKrw?: number | null;
}

interface RemittanceData {
  summary: RemittanceSummary;
  bookedRate: number | null;
  items: { id: number; amount: number; exchangeRate: number | null; krwAmount: number | null; fxDiffKrw: number | null }[];
}

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

/** 대리 접속 호출 — 공용 api() 는 헤더를 못 싣는다. */
async function actAs(
  token: string,
  partnerId: bigint | number,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: { data?: unknown; error?: string } | null }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [ACT_AS]: String(partnerId),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null;
  return { status: res.status, json };
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 — 마스터딜러 중개(발주·지급 단계)', () => {
  const rp = createJourneyReport(
    'findings-bom-md-po',
    'BOM 여정 마스터딜러 중개(발주·지급 단계) 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let mdView: E2eSession;
  let md: PartnerFixture;
  let outsider: PartnerFixture;
  let A = '';
  let M = '';
  let childAId = 0;
  let childBId = 0;
  let quoteId = '';
  let title = '';
  let itemIds: string[] = [];
  let poId = 0;
  let poTotalUsd = 0;
  let bookedRate = 0;
  let mdPoA: MdPo | null = null;
  let mdPoB: MdPo | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    md = await ensureStagePartner({ ...MD, capabilities: ['bom_rfq'] });
    outsider = await ensureStagePartner({ ...OUTSIDER, capabilities: ['bom_rfq'] });
    if (md.mbId === null || outsider.mbId === null) throw new Error('무대 계정이 없습니다');
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mdView = await newSession({ mbId: md.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(mdView, '마스터딜러');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    M = signJwt({ mbId: md.mbId, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 마스터딜러: mdView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  const loadPlan = async (): Promise<PlanData> => {
    const response = await api(M, 'GET', `/api/partner/pos/${String(poId)}/child-pos`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    return response.json?.data as PlanData;
  };

  const advance = (token: string, mdPoId: number, body: Record<string, unknown>) =>
    api(token, 'POST', `/api/partner/md-pos/${String(mdPoId)}/advance`, body);

  test('P01. 준비 — 하위 재요청·품목별 선정을 거쳐 마스터딜러에게 달러 발주가 나간다', async () => {
    // 하위 무대 — 마스터딜러가 포털에서 등록한 조직(있으면 그대로 쓴다).
    const list = await api(M, 'GET', '/api/partner/children');
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    let children: { partnerId: number; name: string }[] = list.json?.data?.items ?? [];
    for (const child of [CHILD_A, CHILD_B]) {
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
    childAId = children.find((item) => item.name === CHILD_A.name)?.partnerId ?? 0;
    childBId = children.find((item) => item.name === CHILD_B.name)?.partnerId ?? 0;
    expect(childAId).toBeGreaterThan(0);
    expect(childBId).toBeGreaterThan(0);

    // 견적 — 검토 중 상태로 심는다(고객은 실계정: 주문을 실제로 낸다).
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: customer.mbId,
        title: `[BOM 여정] 중개 발주 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'reviewing',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 20,
        spareQty: 0,
        itemsTotal: 0,
        shippingFee: 5_000,
        managementFee: 3_500,
        finalTotal: 8_500,
        uncostedCount: LINES.length,
        requestedAt: new Date(),
        adminMemo: `[BOM 여정 ${RUN_KEY}] md po fixture`,
      },
    });
    quoteId = String(quote.id);
    title = quote.title;
    for (const [index, line] of LINES.entries()) {
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
      itemIds.push(String(item.id));
    }
    ledger.push(`sp_bom_quote #${quoteId}`);

    // 샘플피씨비 → 마스터딜러 → 하위 둘.
    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, { partnerIds: [num(md.id)] });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const mdRfqId: number = sent.json?.data?.rfqs?.[0]?.rfqId;
    const fanned = await api(M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [childAId, childBId],
    });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);
    const childRfqs: { rfqId: number; partnerId: number; magicToken: string }[] = fanned.json?.data?.rfqs ?? [];
    const rfqA = childRfqs.find((rfq) => rfq.partnerId === childAId);
    const rfqB = childRfqs.find((rfq) => rfq.partnerId === childBId);
    if (rfqA === undefined || rfqB === undefined) throw new Error('하위 재요청이 없습니다');

    const line = (index: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
      quoteItemId: itemIds[index],
      unitPrice,
      replyQty: LINES[index]!.orderQty,
      moq: 1,
      stock: LINES[index]!.orderQty * 3,
      dateCode: '25+',
      leadTime: '7영업일',
      memo: null,
      ...extra,
    });
    for (const [token, items] of [
      [rfqA.magicToken, [line(0, CHILD_A_PRICE)]],
      [rfqB.magicToken, [line(1, CHILD_B_PRICE)]],
    ] as const) {
      const replied = await api(null, 'PUT', `/api/rfq-reply/${token}`, { items, deliveryDate: null, memo: null });
      expect(replied.status, JSON.stringify(replied.json)).toBe(200);
    }
    // 마스터딜러 회신 — 0번 하위 가 +10%, 1번 하위 나 +5%, 2번 직접.
    const mdReply = await api(M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, {
      items: [
        line(0, 0, { childRfqId: rfqA.rfqId, marginRate: 10 }),
        line(1, 0, { childRfqId: rfqB.rfqId, marginRate: 5 }),
        line(2, MD_DIRECT_PRICE),
      ],
      deliveryDate: null,
      memo: null,
    });
    expect(mdReply.status, JSON.stringify(mdReply.json)).toBe(200);

    // 관리자 — 세 품목 모두 마스터딜러 회신으로 선정 → 검토 완료 → 고객 회신.
    const rfqs = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    const mdItems: { rfqItemId: number; quoteItemId: string }[] = rfqs.json?.data?.rfqs?.[0]?.items ?? [];
    for (const item of mdItems) {
      const picked = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
        kind: 'partner',
        itemId: item.quoteItemId,
        rfqItemId: item.rfqItemId,
      });
      expect(picked.status, JSON.stringify(picked.json)).toBe(200);
    }
    let detail = (await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`)).json?.data;
    const pending = (detail?.items ?? []).filter(
      (item: { adminReview?: { required: boolean; completed: boolean } }) =>
        item.adminReview?.required === true && !item.adminReview.completed,
    );
    if (pending.length > 0) {
      const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
        itemIds: pending.map((item: { id: string }) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: detail.updatedAt,
        reason: `[BOM 여정 ${RUN_KEY}] 중개 회신 확인`,
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      detail = (await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`)).json?.data;
    }
    const completed = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      adminMemo: `[BOM 여정 ${RUN_KEY}] 중개 발주 확정`,
      answerNote: '협력 공급처 재고를 확인해 확정했습니다.',
      confirmedShippingFee: 5_000,
      confirmedManagementFee: 3_500,
      confirmedTotal: Math.ceil(detail.itemsTotal) + 8_500,
      sendEmail: false,
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    // 고객 주문·입금 → 마스터딜러 발주(달러).
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId,
      step: 'P01',
      prefix: 'P01-md-po-order',
      buyerName: 'e2eBOM중개발주고객',
    });
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [placed.odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const issued = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, {
      partnerIds: [num(md.id)],
      memo: `[BOM 여정 ${RUN_KEY}] 중개 발주`,
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const po = (issued.json?.data?.pos ?? []).find((entry: { partnerId: number }) => entry.partnerId === num(md.id));
    poId = po.poId;
    poTotalUsd = po.totalOriginal;
    bookedRate = po.exchangeRate;
    expect(po.currency).toBe('USD');
    expect(po.items).toHaveLength(LINES.length);
    expect(po.childPos, '발행 직후 하위 발주 없음').toEqual([]);
    expect(po.remittance?.status).toBe('unpaid');
    expect(po.remittance?.poAmount).toBe(poTotalUsd);
    ledger.push(`g5_shop_order ${placed.odId}`, `sp_bom_po #${String(poId)}(${MD.orgName} · USD ${String(poTotalUsd)})`);
  }, 420_000);

  test('P02. 발주 계획 — 견적 때 고른 하위별로 묶이고, 단가는 그때 굳힌 하위 회신가다', async (ctx) => {
    if (poId === 0) return ctx.skip();
    const detail = await api(M, 'GET', `/api/partner/pos/${String(poId)}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    expect(detail.json?.data?.hasChildItems).toBe(true);

    const plan = await loadPlan();
    expect(plan.canIssue).toBe(true);
    expect(plan.directItemCount, '직접 조달 품목(2번)').toBe(1);
    expect(plan.groups).toHaveLength(2);
    const a = plan.groups.find((group) => group.partnerId === childAId);
    const b = plan.groups.find((group) => group.partnerId === childBId);
    // 하위 가 — 위안. 마스터딜러가 붙인 마진·환율은 하위 발주에 들어가지 않는다.
    expect(a?.currency).toBe('CNY');
    expect(a?.items).toHaveLength(1);
    expect(a?.items[0]?.mpn).toBe(LINES[0].mpn);
    expect(a?.items[0]?.unitPrice).toBe(CHILD_A_PRICE);
    expect(a?.items[0]?.qty).toBe(LINES[0].orderQty);
    expect(a?.totalAmount).toBe(round2(CHILD_A_PRICE * LINES[0].orderQty));
    expect(a?.mdPo).toBeNull();
    expect(b?.currency).toBe('USD');
    expect(b?.totalAmount).toBe(round2(CHILD_B_PRICE * LINES[1].orderQty));

    // 남의 발주서에서는 계획도 볼 수 없다.
    const stranger = await api(signJwt({ mbId: outsider.mbId ?? '', ttlSec: 600 }), 'GET', `/api/partner/pos/${String(poId)}/child-pos`);
    expect(stranger.status).toBe(404);
  }, 120_000);

  test('P03. 하위 발주 발행 — 하위마다 한 건, 하위에게 품목이 실린 메일이 간다', async (ctx) => {
    if (poId === 0) return ctx.skip();
    // 이 발주서에 맡길 품목이 없는 조직에게는 못 낸다.
    const wrong = await api(M, 'POST', `/api/partner/pos/${String(poId)}/child-pos`, {
      partnerIds: [num(outsider.id)],
    });
    expect(wrong.status, JSON.stringify(wrong.json)).toBe(409);
    expect(wrong.json?.error).toBe('NO_CHILD_ITEMS');

    const issued = await api(M, 'POST', `/api/partner/pos/${String(poId)}/child-pos`, {
      partnerIds: [childAId, childBId],
      memo: `[BOM 여정 ${RUN_KEY}] 하위 발주`,
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const plan = issued.json?.data as PlanData;
    mdPoA = plan.groups.find((group) => group.partnerId === childAId)?.mdPo ?? null;
    mdPoB = plan.groups.find((group) => group.partnerId === childBId)?.mdPo ?? null;
    if (mdPoA === null || mdPoB === null) throw new Error('하위 발주가 없습니다');
    expect(mdPoA.status).toBe('issued');
    expect(mdPoA.currency).toBe('CNY');
    expect(mdPoA.totalAmount).toBe(round2(CHILD_A_PRICE * LINES[0].orderQty));
    expect(mdPoA.parentPartnerName).toBe(MD.orgName);
    expect(mdPoA.hasPortalAccount).toBe(false);
    ledger.push(`sp_bom_md_po #${String(mdPoA.mdPoId)}(${CHILD_A.name}) · #${String(mdPoB.mdPoId)}(${CHILD_B.name})`);

    // 같은 하위에게 두 번 내지 않는다.
    const again = await api(M, 'POST', `/api/partner/pos/${String(poId)}/child-pos`, {
      partnerIds: [childAId],
    });
    expect(again.status, JSON.stringify(again.json)).toBe(409);
    expect(again.json?.error).toBe('ALREADY_ISSUED');

    // 메일 — 발주처 이름으로, 품번·수량·금액이 본문에 있다(계정 없는 하위는 포털을 못 연다).
    const deadline = Date.now() + 20_000;
    let mailed = false;
    while (Date.now() < deadline && !mailed) {
      const result = await mailpitSearch(`to:"${CHILD_A.email}" subject:"부품 발주서"`);
      for (const message of (result.messages ?? []) as { ID: string; Subject?: string }[]) {
        if (!(message.Subject ?? '').includes(title)) continue;
        const html: string = ((await mailpitMessage(message.ID)) as { HTML?: string }).HTML ?? '';
        if (
          (message.Subject ?? '').includes(MD.orgName) &&
          html.includes(LINES[0].mpn) &&
          html.includes(`¥${round2(CHILD_A_PRICE * LINES[0].orderQty).toFixed(2)}`)
        ) {
          mailed = true;
        }
      }
      if (!mailed) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(mailed, '하위 발주 메일(발주처 이름 + 품목 + 하위 통화 금액)').toBe(true);

    // 화면 — 마스터딜러 발주서 상세에 하위 발주 영역과 대행 버튼이 선다.
    await rp.assertView(mdView, `/app/partner/bom/pos/${String(poId)}`, 'P03-md-portal-child-pos', [
      title,
      '하위 협력사 발주',
      CHILD_A.name,
      CHILD_B.name,
      '확인 처리(대행)',
      '포털 계정 없음',
    ]);
  }, 180_000);

  test('P04. 진행 — 하위는 확인·출고까지, 수령은 발주처. 계정 없는 하위는 마스터딜러가 대신 찍는다', async (ctx) => {
    if (mdPoA === null || mdPoB === null) return ctx.skip();
    // 제3자에게는 존재하지 않는 문서다.
    const stranger = signJwt({ mbId: outsider.mbId ?? '', ttlSec: 600 });
    expect((await api(stranger, 'GET', `/api/partner/md-pos/${String(mdPoA.mdPoId)}`)).status).toBe(404);
    expect((await advance(stranger, mdPoA.mdPoId, { action: 'confirm' })).status).toBe(404);

    // 하위 가 — 하위의 자리에서(대리 접속): 받은 목록에 보이고 확인까지는 한다.
    const received = await actAs(A, childAId, 'GET', '/api/partner/md-pos');
    expect(received.status).toBe(200);
    expect(((received.json?.data as { items: MdPo[] }).items ?? []).some((row) => row.mdPoId === mdPoA?.mdPoId)).toBe(true);
    const asChild = await actAs(A, childAId, 'GET', `/api/partner/md-pos/${String(mdPoA.mdPoId)}`);
    expect((asChild.json?.data as MdPo).viewerRole).toBe('child');
    expect((asChild.json?.data as MdPo).actions).toEqual(['confirm']);
    expect((asChild.json?.data as MdPo).canDelete).toBe(false);
    const childConfirm = await actAs(A, childAId, 'POST', `/api/partner/md-pos/${String(mdPoA.mdPoId)}/advance`, { action: 'confirm' });
    expect(childConfirm.status).toBe(200);
    // 순서를 건너뛸 수 없고, 수령은 하위가 찍을 수 없다.
    const skip = await actAs(A, childAId, 'POST', `/api/partner/md-pos/${String(mdPoA.mdPoId)}/advance`, { action: 'receive' });
    expect(skip.status).toBe(409);
    const childShip = await actAs(A, childAId, 'POST', `/api/partner/md-pos/${String(mdPoA.mdPoId)}/advance`, {
      action: 'ship',
      carrier: 'SF Express',
      trackingNo: `SF${RUN_KEY}`,
    });
    expect(childShip.status).toBe(200);
    expect((childShip.json?.data as MdPo).actions, '하위는 수령을 못 찍는다').toEqual(['revert']);
    const childReceive = await actAs(A, childAId, 'POST', `/api/partner/md-pos/${String(mdPoA.mdPoId)}/advance`, { action: 'receive' });
    expect(childReceive.status, '수령은 발주처의 것').toBe(409);

    // 마스터딜러 — 수령으로 닫는다. 출고된 문서는 지울 수 없다.
    const mdSees = await api(M, 'GET', `/api/partner/md-pos/${String(mdPoA.mdPoId)}`);
    expect(mdSees.json?.data?.viewerRole).toBe('parent');
    expect(mdSees.json?.data?.carrier).toBe('SF Express');
    expect((await api(M, 'DELETE', `/api/partner/md-pos/${String(mdPoA.mdPoId)}`)).status, '출고 뒤 삭제 거절').toBe(409);
    const mdReceive = await advance(M, mdPoA.mdPoId, { action: 'receive' });
    expect(mdReceive.status, JSON.stringify(mdReceive.json)).toBe(200);
    expect(mdReceive.json?.data?.status).toBe('received');
    // 되돌리기 — 발주처는 한 칸씩.
    const reverted = await advance(M, mdPoA.mdPoId, { action: 'revert' });
    expect(reverted.json?.data?.status).toBe('shipped');
    expect((await advance(M, mdPoA.mdPoId, { action: 'receive' })).json?.data?.status).toBe('received');

    // 하위 나 — 계정도 이메일도 없다. 마스터딜러가 확인을 대신 찍고, 출고 전이라 지우고 다시 낼 수 있다.
    const proxy = await advance(M, mdPoB.mdPoId, { action: 'confirm' });
    expect(proxy.status, JSON.stringify(proxy.json)).toBe(200);
    expect(proxy.json?.data?.canDelete).toBe(true);
    expect((await api(M, 'DELETE', `/api/partner/md-pos/${String(mdPoB.mdPoId)}`)).status).toBe(200);
    expect((await loadPlan()).groups.find((group) => group.partnerId === childBId)?.mdPo).toBeNull();
    const reissued = await api(M, 'POST', `/api/partner/pos/${String(poId)}/child-pos`, { partnerIds: [childBId] });
    expect(reissued.status, JSON.stringify(reissued.json)).toBe(200);
    mdPoB = (reissued.json?.data as PlanData).groups.find((group) => group.partnerId === childBId)?.mdPo ?? null;
    expect(mdPoB?.status).toBe('issued');
  }, 180_000);

  test('P05. 관리자는 하위 발주를 상위 발주서 아래에서 전부 본다', async (ctx) => {
    if (mdPoA === null) return ctx.skip();
    const pos = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/pos`);
    expect(pos.status, JSON.stringify(pos.json)).toBe(200);
    const all: { poId: number; partnerId: number; childPos: MdPo[] }[] = pos.json?.data?.pos ?? [];
    // 샘플피씨비의 발주 원장에는 마스터딜러 발주 한 건뿐이다 — 하위 발주는 섞이지 않는다.
    expect(all.map((po) => po.partnerId)).toEqual([num(md.id)]);
    const children = all[0]?.childPos ?? [];
    expect(children).toHaveLength(2);
    expect(children.find((row) => row.partnerId === childAId)?.status).toBe('received');
    expect(children.find((row) => row.partnerId === childBId)?.status).toBe('issued');
    // 관리자도 마스터딜러 자리에서 대신 처리할 수 있다(대리 접속).
    const acting = await actAs(A, md.id, 'POST', `/api/partner/md-pos/${String(mdPoB?.mdPoId ?? 0)}/advance`, { action: 'confirm' });
    expect(acting.status, '대리 접속으로 하위 발주 확인').toBe(200);
  }, 120_000);

  test('P06. 송금 기록 — 분할 지급·실제 환율·환차·초과 지급', async (ctx) => {
    if (poId === 0) return ctx.skip();
    const path = `/api/admin/bom-pos/${String(poId)}/remittances`;
    const empty = await api(A, 'GET', path);
    expect(empty.status, JSON.stringify(empty.json)).toBe(200);
    expect((empty.json?.data as RemittanceData).bookedRate).toBe(bookedRate);
    expect((empty.json?.data as RemittanceData).summary).toMatchObject({
      currency: 'USD',
      poAmount: poTotalUsd,
      paidAmount: 0,
      balance: poTotalUsd,
      status: 'unpaid',
    });

    // 1차 — 절반을 장부보다 30원 비싼 환율로 보냈다.
    const half = round2(poTotalUsd / 2);
    const paidRate = bookedRate + 30;
    const first = await api(A, 'POST', path, {
      remittedOn: new Date().toISOString().slice(0, 10),
      amount: half,
      exchangeRate: paidRate,
      memo: `[BOM 여정 ${RUN_KEY}] 선금`,
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    let data = first.json?.data as RemittanceData;
    expect(data.summary.status).toBe('partial');
    expect(data.summary.balance).toBe(round2(poTotalUsd - half));
    const row = data.items[0];
    expect(row?.krwAmount).toBe(Math.round(half * paidRate));
    // 환차 = 실제 원화 − 장부 환율로 본 원화.
    const expectedDiff = Math.round(half * paidRate) - Math.round(half * bookedRate);
    expect(row?.fxDiffKrw).toBe(expectedDiff);
    expect(data.summary.fxDiffKrw).toBe(expectedDiff);
    F('P06', 'obs', `달러 ${String(half)} 지급 — 장부 ${String(bookedRate)} · 실제 ${String(paidRate)} · 환차 ${String(expectedDiff)}원`);

    // 2차 — 잔액. 환율을 비우면 그날 고시 환율로 채운다.
    const second = await api(A, 'POST', path, {
      remittedOn: new Date().toISOString().slice(0, 10),
      amount: round2(poTotalUsd - half),
    });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    data = second.json?.data as RemittanceData;
    expect(data.summary.status).toBe('paid');
    expect(data.summary.balance).toBe(0);
    expect(data.items[1]?.exchangeRate, '고시 환율로 채움').toBeGreaterThan(0);

    // 협력사 포털 — 받은 금액·잔액만 본다(환차는 샘플피씨비 회계).
    const mine = await api(M, 'GET', `/api/partner/pos/${String(poId)}`);
    expect(mine.json?.data?.remittance).toMatchObject({ currency: 'USD', paidAmount: poTotalUsd, balance: 0, status: 'paid' });
    expect(JSON.stringify(mine.json?.data?.remittance)).not.toContain('fxDiff');

    // 초과 지급도 사실이면 적는다 — 상태가 드러낸다. 지우면 되돌아온다.
    const over = await api(A, 'POST', path, { remittedOn: new Date().toISOString().slice(0, 10), amount: 1, exchangeRate: paidRate });
    data = over.json?.data as RemittanceData;
    expect(data.summary.status).toBe('over');
    expect(data.summary.balance).toBe(-1);
    const removed = await api(A, 'DELETE', `${path}/${String(data.items[2]?.id ?? 0)}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect((removed.json?.data as RemittanceData).summary.status).toBe('paid');
    // 남의 발주서 번호로는 지울 수 없다.
    expect((await api(A, 'DELETE', `/api/admin/bom-pos/999999999/remittances/${String(data.items[0]?.id ?? 0)}`)).status).toBe(404);

    // 관리자 발주 목록에도 같은 요약이 실린다.
    const pos = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/pos`);
    expect(pos.json?.data?.pos?.[0]?.remittance?.status).toBe('paid');

    // 화면 — 관리자 Case 의 발주 줄 아래: 송금 요약·환차·하위 발주, 그리고 송금 기록 펼침.
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, { waitUntil: 'domcontentloaded' });
    const extras = page.locator('[data-testid="bom-po-extras"]').first();
    await extras.waitFor({ state: 'visible', timeout: 60_000 });
    const extrasText = (await extras.innerText()).replace(/\s+/g, ' ');
    expect(extrasText).toContain('지급 완료');
    expect(extrasText).toContain('환차');
    expect(extrasText).toContain('하위 발주 2건');
    expect(extrasText).toContain(CHILD_A.name);
    await extras.getByRole('button', { name: '송금 기록', exact: true }).click();
    const editor = page.locator('[data-testid="bom-remittance-editor"]').first();
    await editor.getByRole('button', { name: '송금 기록 추가' }).waitFor({ timeout: 30_000 });
    expect(await editor.locator('tbody tr').count(), '송금 2건').toBe(2);
    await rp.shot(adminView, 'P06-admin-po-remittance');

    // 협력사 포털 — 받은 금액·잔액이 발주서에 보인다.
    await rp.assertView(mdView, `/app/partner/bom/pos/${String(poId)}`, 'P06-md-portal-remittance', [
      title,
      '입금',
      '잔액',
    ]);
  }, 240_000);
});
