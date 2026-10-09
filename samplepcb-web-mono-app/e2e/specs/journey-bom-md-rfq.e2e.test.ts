// Smart BOM 여정 — 마스터딜러 중개(견적 단계). docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개".
//
// 마스터딜러는 샘플피씨비가 보낸 견적요청을 자기 하위 협력사에 다시 요청하고, 품목마다 하위
// 회신을 골라 마진을 얹어 자기 회신으로 올린다. 이 여정은 그 약속을 끝까지 따라간다:
//   하위 등록(부품 조달 트랙) → 재요청(내 하위만·링크 통화 박제) → 하위의 무계정 회신 →
//   품목별 선정(교차환율·마진 산출, 환율은 고른 순간에 굳는다) → 관리자 열람·대리 접속 →
//   하위가 다시 회신하면 '바뀜'으로 알림 → 마스터딜러 견적요청을 회수하면 하위 재요청도 함께 회수.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-md-rfq.md 대장으로 확인한 뒤
// 수동 정리한다. 실행: pnpm -F e2e journey:bom:md
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
  newSession,
  num,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const ACT_AS = 'x-sp-act-as-partner';

// 무대 — e2e 전용 계정·조직(상설 픽스처). 하위 둘은 마스터딜러가 포털에서 직접 등록한다(계정 없음).
const MD = { mbId: 'e2e-bommd-m', orgName: 'e2e부품중개상사', country: 'CN', currency: 'USD' } as const;
const OUTSIDER = { mbId: 'e2e-bommd-x', orgName: 'e2e남의협력사', country: 'KR', currency: 'KRW' } as const;
const CHILD_A = { name: 'e2e하위부품가', country: 'CN', currency: 'CNY', email: 'e2e-bommd-child-a@test.local' } as const;
const CHILD_B = { name: 'e2e하위부품나', country: 'US', currency: 'USD', email: null } as const;

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
}

const LINES: readonly SeedLine[] = [
  { mpn: 'RC0402FR-0710KL', manufacturerName: 'YAGEO', description: '10 kΩ 1% 0402', bomQty: 100, orderQty: 2_000 },
  { mpn: 'STM32F103C8T6', manufacturerName: 'STMicroelectronics', description: 'MCU LQFP-48', bomQty: 1, orderQty: 20 },
  { mpn: 'B2B-XH-A', manufacturerName: 'JST', description: '2P 2.5 mm header', bomQty: 2, orderQty: 40 },
] as const;

/** 하위 회신 단가 — A 는 위안으로 0·1번, B 는 달러로 1·2번 품목. */
const CHILD_A_PRICE = [0.024, 24.9] as const;
const CHILD_B_PRICE = [3.31, 0.082] as const;
const MD_DIRECT_PRICE = 0.11;

interface ChildItem {
  rfqItemId: number;
  quoteItemId: string;
  unitPrice: number;
  unitPriceInParent: number | null;
}

interface ChildRfq {
  rfqId: number;
  partnerId: number;
  partnerName: string;
  status: string;
  currency: string;
  magicToken: string | null;
  hasPortalAccount: boolean;
  items: ChildItem[];
}

interface ChildrenData {
  myCurrency: string;
  candidates: { partnerId: number; name: string; currency: string }[];
  rfqs: ChildRfq[];
  added?: number;
  kept?: number;
  removed?: number;
}

interface ChildSelection {
  childRfqId: number;
  childPartnerName: string;
  marginRate: number;
  sourceCurrency: string;
  sourceUnitPrice: number;
  sourceRate: number;
  stale: boolean;
}

interface PartnerLine {
  quoteItemId: string;
  reply: { unitPrice: number | null; childSelection: ChildSelection | null } | null;
}

interface PartnerDetail {
  currency: string;
  status: string;
  canFanOut: boolean;
  requesterName: string | null;
  totalAmount: number | null;
  items: PartnerLine[];
}

interface AdminRfq {
  rfqId: number;
  partnerId: number;
  status: string;
  currency: string;
  children: ChildRfq[];
  items: { rfqItemId: number; quoteItemId: string; unitPrice: number | null; childSelection: ChildSelection | null }[];
}

const round4 = (value: number): number => Math.round(Number((value * 10_000).toPrecision(12))) / 10_000;

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
  method: 'GET' | 'POST' | 'PUT',
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

async function seedReviewingQuote(mbId: string, label: string): Promise<{ quoteId: string; title: string; itemIds: string[] }> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정] 중개 견적 ${label} ${RUN_KEY}`,
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
        adminMemo: `[BOM 여정 ${RUN_KEY}] md rfq fixture`,
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

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 — 마스터딜러 중개(견적 단계)', () => {
  const rp = createJourneyReport(
    'findings-bom-md-rfq',
    'BOM 여정 마스터딜러 중개(견적 단계) 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

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
  let mdRfqId = 0;
  let childARfq: ChildRfq | null = null;
  let childBRfq: ChildRfq | null = null;
  let stampedRate = 0;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    md = await ensureStagePartner({ ...MD, capabilities: ['bom_rfq'] });
    outsider = await ensureStagePartner({ ...OUTSIDER, capabilities: ['bom_rfq'] });
    if (md.mbId === null) throw new Error('마스터딜러 무대 계정이 없습니다');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mdView = await newSession({ mbId: md.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(mdView, '마스터딜러');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    M = signJwt({ mbId: md.mbId, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ 관리자: adminView, 마스터딜러: mdView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  const loadChildren = async (rfqId: number): Promise<ChildrenData> => {
    const response = await api(M, 'GET', `/api/partner/rfqs/${String(rfqId)}/children`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    return response.json?.data as ChildrenData;
  };

  const loadMdDetail = async (): Promise<PartnerDetail> => {
    const response = await api(M, 'GET', `/api/partner/rfqs/${String(mdRfqId)}`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    return response.json?.data as PartnerDetail;
  };

  const loadAdminMdRfq = async (): Promise<{ rfq: AdminRfq; all: AdminRfq[]; partnerFx: { CNY: unknown } }> => {
    const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const all: AdminRfq[] = response.json?.data?.rfqs ?? [];
    const rfq = all.find((entry) => entry.partnerId === num(md.id));
    if (rfq === undefined) throw new Error('마스터딜러 견적요청이 없습니다');
    return { rfq, all, partnerFx: response.json?.data?.partnerFx };
  };

  test('M01. 마스터딜러가 포털에서 하위를 등록한다 — 부품 조달만 하는 조직도 하위를 둘 수 있다', async () => {
    const list = await api(M, 'GET', '/api/partner/children');
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    expect(list.json?.data?.eligibility?.allowed, '부품 조달 트랙만으로 등록 가능').toBe(true);
    expect(list.json?.data?.parentTracks).toEqual(['bom_rfq']);
    let items: { partnerId: number; name: string; tracks: string[] }[] = list.json?.data?.items ?? [];

    for (const child of [CHILD_A, CHILD_B]) {
      if (items.some((item) => item.name === child.name)) continue; // 상설 무대 — 있으면 그대로 쓴다
      const created = await api(M, 'POST', '/api/partner/children', {
        name: child.name,
        country: child.country,
        settlementCurrency: child.currency,
        contactEmail: child.email,
      });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      items = created.json?.data?.items ?? [];
    }
    const a = items.find((item) => item.name === CHILD_A.name);
    const b = items.find((item) => item.name === CHILD_B.name);
    if (a === undefined || b === undefined) throw new Error('하위 무대가 없습니다');
    childAId = a.partnerId;
    childBId = b.partnerId;
    // 맡길 일을 따로 고르지 않으면 내 트랙을 물려받는다 — 여기서는 부품 조달.
    expect(a.tracks).toEqual(['bom_rfq']);
    expect(b.tracks).toEqual(['bom_rfq']);

    // 내게 없는 트랙은 줄 수 없다.
    const denied = await api(M, 'PUT', `/api/partner/children/${String(childAId)}`, { tracks: ['pcb_rfq'] });
    expect(denied.status, JSON.stringify(denied.json)).toBe(409);
    expect(denied.json?.error).toBe('TRACK_NOT_ALLOWED');
  }, 120_000);

  test('M02. 샘플피씨비가 보낸 견적요청만 하위에 다시 요청할 수 있다 — 내 하위에게만', async (ctx) => {
    if (childAId === 0) return ctx.skip();
    const seeded = await seedReviewingQuote('e2e-admin', '본편');
    quoteId = seeded.quoteId;
    title = seeded.title;
    itemIds = seeded.itemIds;
    ledger.push(`sp_bom_quote #${quoteId}`);

    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, {
      partnerIds: [num(md.id)],
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    mdRfqId = (await loadAdminMdRfq()).rfq.rfqId;

    const detail = await loadMdDetail();
    expect(detail.canFanOut).toBe(true);
    expect(detail.requesterName, '샘플피씨비 직접 요청').toBeNull();
    expect(detail.currency).toBe('USD');

    const before = await loadChildren(mdRfqId);
    expect(before.myCurrency).toBe('USD');
    // 무대는 상설이라 다른 여정이 하위를 더 붙였을 수 있다 — 내 하위 둘이 후보에 있는지만 본다.
    expect(before.candidates.map((child) => child.name)).toEqual(
      expect.arrayContaining([CHILD_A.name, CHILD_B.name]),
    );
    expect(before.candidates.some((child) => child.name === OUTSIDER.orgName), '남의 협력사는 후보가 아니다').toBe(false);
    expect(before.candidates.find((child) => child.partnerId === childAId)?.currency).toBe('CNY');

    // 남의 협력사에게는 못 보낸다.
    const foreign = await api(M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [num(outsider.id)],
    });
    expect(foreign.status, JSON.stringify(foreign.json)).toBe(400);
    expect(foreign.json?.error).toBe('NOT_MY_CHILD');
    // 받은 범위 밖의 품목도 못 보낸다.
    const outOfScope = await api(M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [childAId],
      requestedItemIds: ['999999999'],
    });
    expect(outOfScope.status, JSON.stringify(outOfScope.json)).toBe(400);
    expect(outOfScope.json?.error).toBe('ITEM_OUT_OF_SCOPE');

    const fanned = await api(M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [childAId, childBId],
    });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);
    const data = fanned.json?.data as ChildrenData;
    expect(data.added).toBe(2);
    childARfq = data.rfqs.find((rfq) => rfq.partnerId === childAId) ?? null;
    childBRfq = data.rfqs.find((rfq) => rfq.partnerId === childBId) ?? null;
    if (childARfq === null || childBRfq === null) throw new Error('하위 재요청이 없습니다');
    // 하위 재요청의 통화는 마스터딜러↔하위 링크 통화다.
    expect(childARfq.currency).toBe('CNY');
    expect(childBRfq.currency).toBe('USD');
    expect(childARfq.magicToken, '계정 없는 하위는 매직링크로 회신한다').not.toBeNull();
    expect(childARfq.hasPortalAccount).toBe(false);
    ledger.push(
      `sp_bom_rfq #${String(mdRfqId)}(${MD.orgName}) → 하위 #${String(childARfq.rfqId)}·#${String(childBRfq.rfqId)}`,
    );

    // 관리자 직접 트랙에는 하위 재요청이 섞이지 않는다 — 마스터딜러 행 아래에만 보인다.
    const admin = await loadAdminMdRfq();
    expect(admin.all.map((rfq) => rfq.partnerId)).toEqual([num(md.id)]);
    expect(admin.rfq.children.map((child) => child.partnerId).sort()).toEqual([childAId, childBId].sort());
    // 견적 고정 환율은 샘플피씨비↔협력사 변환점의 것 — 하위 링크 통화(위안)로는 굳히지 않는다.
    expect(admin.partnerFx.CNY).toBeNull();

    // 하위에게 가는 메일은 누가 요청했는지 밝힌다.
    const deadline = Date.now() + 20_000;
    let mailed = false;
    while (Date.now() < deadline && !mailed) {
      const result = await mailpitSearch(`to:"${CHILD_A.email}" subject:"부품 견적요청"`);
      for (const message of (result.messages ?? []) as { ID: string; Subject?: string }[]) {
        if (!(message.Subject ?? '').includes(title)) continue;
        const full: { HTML?: string } = await mailpitMessage(message.ID);
        const html = full.HTML ?? '';
        if (html.includes(MD.orgName) && html.includes(`/app/rfq-reply/${childARfq.magicToken ?? ''}`)) {
          mailed = true;
        }
      }
      if (!mailed) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(mailed, '하위 견적요청 메일(요청 조직명 + 매직링크)').toBe(true);
  }, 180_000);

  test('M03. 하위는 계정 없이 자기 통화로 회신한다 — 하위는 다시 재요청하지 못한다', async (ctx) => {
    if (childARfq === null || childBRfq === null) return ctx.skip();
    const tokenA = childARfq.magicToken ?? '';
    const tokenB = childBRfq.magicToken ?? '';

    const opened = await api(null, 'GET', `/api/rfq-reply/${tokenA}`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json?.data?.rfq?.requesterName, '누가 요청했는지').toBe(MD.orgName);
    expect(opened.json?.data?.rfq?.currency).toBe('CNY');
    expect(opened.json?.data?.rfq?.canFanOut).toBe(false);

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

    // 매직링크로는 남의 회신을 끌어올 수 없다(하위 선정은 계정 화면의 것).
    const sneaky = await api(null, 'PUT', `/api/rfq-reply/${tokenA}`, {
      items: [line(0, 1, { childRfqId: childBRfq.rfqId, marginRate: 0 })],
      deliveryDate: null,
      memo: null,
    });
    expect(sneaky.status, JSON.stringify(sneaky.json)).toBe(400);
    expect(sneaky.json?.error).toBe('CHILD_SELECTION_NOT_ALLOWED');

    const repliedA = await api(null, 'PUT', `/api/rfq-reply/${tokenA}`, {
      items: [line(0, CHILD_A_PRICE[0]), line(1, CHILD_A_PRICE[1])],
      deliveryDate: null,
      memo: `[BOM 여정 ${RUN_KEY}] 하위 가`,
    });
    expect(repliedA.status, JSON.stringify(repliedA.json)).toBe(200);
    const repliedB = await api(null, 'PUT', `/api/rfq-reply/${tokenB}`, {
      items: [line(1, CHILD_B_PRICE[0]), line(2, CHILD_B_PRICE[1])],
      deliveryDate: null,
      memo: `[BOM 여정 ${RUN_KEY}] 하위 나`,
    });
    expect(repliedB.status, JSON.stringify(repliedB.json)).toBe(200);

    // 하위 조직으로 대리 접속해도 재요청 화면은 없다 — 2단 제한.
    const nested = await actAs(A, childAId, 'GET', `/api/partner/rfqs/${String(childARfq.rfqId)}/children`);
    expect(nested.status, '하위의 재요청 화면').toBe(404);
    const nestedSend = await actAs(A, childAId, 'POST', `/api/partner/rfqs/${String(childARfq.rfqId)}/children`, {
      partnerIds: [childBId],
    });
    expect(nestedSend.status, '하위의 재요청 발송').toBe(404);
  }, 120_000);

  test('M04. 마스터딜러는 품목마다 하위 회신을 골라 마진을 얹는다 — 단가는 서버가 산출한다', async (ctx) => {
    if (childARfq === null || childBRfq === null) return ctx.skip();
    const children = await loadChildren(mdRfqId);
    const a = children.rfqs.find((rfq) => rfq.partnerId === childAId);
    const b = children.rfqs.find((rfq) => rfq.partnerId === childBId);
    expect(a?.status).toBe('quoted');
    expect(b?.status).toBe('quoted');
    // 위안 회신가는 내 통화(달러)로 환산해 곁들인다 — 지금 환율의 참고값.
    const a0 = a?.items.find((item) => item.quoteItemId === itemIds[0]);
    expect(a0?.unitPrice).toBe(CHILD_A_PRICE[0]);
    expect(a0?.unitPriceInParent, '위안→달러 교차환율').not.toBeNull();
    // 같은 통화(달러) 하위는 환산이 그대로다.
    expect(b?.items.find((item) => item.quoteItemId === itemIds[2])?.unitPriceInParent).toBe(CHILD_B_PRICE[1]);

    const body = (marginA: number) => ({
      items: [
        // 0번 — 하위 가(위안) + 마진. 단가 입력은 무시된다(서버 산출).
        { quoteItemId: itemIds[0], unitPrice: 999, replyQty: LINES[0]!.orderQty, moq: 1, stock: 6_000, dateCode: '25+', leadTime: '10영업일', memo: null, childRfqId: childARfq?.rfqId, marginRate: marginA },
        // 1번 — 하위 나(달러) + 5%.
        { quoteItemId: itemIds[1], unitPrice: 999, replyQty: LINES[1]!.orderQty, moq: 1, stock: 60, dateCode: '25+', leadTime: '10영업일', memo: null, childRfqId: childBRfq?.rfqId, marginRate: 5 },
        // 2번 — 직접 회신.
        { quoteItemId: itemIds[2], unitPrice: MD_DIRECT_PRICE, replyQty: LINES[2]!.orderQty, moq: 1, stock: 500, dateCode: '24+', leadTime: '재고', memo: null },
      ],
      deliveryDate: null,
      memo: `[BOM 여정 ${RUN_KEY}] 중개 회신`,
    });

    // 마진 없이 고르면 거절된다.
    const noMargin = await api(M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, {
      ...body(10),
      items: body(10).items.map((item, index) => (index === 0 ? { ...item, marginRate: null } : item)),
    });
    expect(noMargin.status, JSON.stringify(noMargin.json)).toBe(400);
    expect(noMargin.json?.error).toBe('MARGIN_REQUIRED');
    // 회신하지 않은 품목의 하위는 고를 수 없다(하위 가는 2번을 회신하지 않았다).
    const notPriced = await api(M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, {
      ...body(10),
      items: [{ ...body(10).items[2], childRfqId: childARfq.rfqId, marginRate: 3 }],
    });
    expect(notPriced.status, JSON.stringify(notPriced.json)).toBe(409);
    expect(notPriced.json?.error).toBe('CHILD_NOT_PRICED');

    const saved = await api(M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, body(10));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const detail = saved.json?.data as PartnerDetail;
    expect(detail.status).toBe('quoted');
    const l0 = detail.items.find((item) => item.quoteItemId === itemIds[0])?.reply;
    const l1 = detail.items.find((item) => item.quoteItemId === itemIds[1])?.reply;
    const l2 = detail.items.find((item) => item.quoteItemId === itemIds[2])?.reply;
    stampedRate = l0?.childSelection?.sourceRate ?? 0;
    expect(stampedRate, '위안→달러 환율이 굳는다').toBeGreaterThan(0);
    expect(l0?.childSelection).toMatchObject({
      childRfqId: childARfq.rfqId,
      childPartnerName: CHILD_A.name,
      marginRate: 10,
      sourceCurrency: 'CNY',
      sourceUnitPrice: CHILD_A_PRICE[0],
      stale: false,
    });
    expect(l0?.unitPrice, '하위 회신가 × 환율 × (1 + 마진)').toBe(round4(CHILD_A_PRICE[0] * stampedRate * 1.1));
    expect(l1?.childSelection?.sourceRate, '같은 통화는 환율 1').toBe(1);
    expect(l1?.unitPrice).toBe(round4(CHILD_B_PRICE[0] * 1.05));
    expect(l2?.childSelection ?? null, '직접 회신').toBeNull();
    expect(l2?.unitPrice).toBe(MD_DIRECT_PRICE);

    // 마진만 고쳐 다시 저장 — 환율은 처음 고른 순간의 값을 물려받는다.
    const resaved = await api(M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, body(12));
    expect(resaved.status, JSON.stringify(resaved.json)).toBe(200);
    const again = (resaved.json?.data as PartnerDetail).items.find((item) => item.quoteItemId === itemIds[0])?.reply;
    expect(again?.childSelection?.sourceRate).toBe(stampedRate);
    expect(again?.childSelection?.marginRate).toBe(12);
    expect(again?.unitPrice).toBe(round4(CHILD_A_PRICE[0] * stampedRate * 1.12));
    F('M04', 'obs', `위안→달러 ${String(stampedRate)} 로 굳음 · 0번 품목 ${String(again?.unitPrice ?? '?')} USD`);

    // 화면 — 재요청 패널과 품목별 공급 경로.
    await rp.assertView(mdView, `/app/partner/bom/rfqs/${String(mdRfqId)}`, 'M04-md-portal-rfq', [
      title,
      '하위 협력사에 다시 요청',
      '공급 경로 · 마진',
      CHILD_A.name,
      CHILD_B.name,
    ]);
  }, 180_000);

  test('M05. 관리자는 하위 재요청을 전부 보고, 마스터딜러로 대리 접속해 대신 처리할 수 있다', async (ctx) => {
    if (childARfq === null || stampedRate === 0) return ctx.skip();
    const { rfq } = await loadAdminMdRfq();
    expect(rfq.status).toBe('quoted');
    expect(rfq.children).toHaveLength(2);
    const stamped = rfq.items.find((item) => item.quoteItemId === itemIds[0]);
    expect(stamped?.childSelection?.childPartnerName).toBe(CHILD_A.name);
    expect(stamped?.childSelection?.sourceRate).toBe(stampedRate);

    // 하위 회신을 관리자가 직접 고를 수는 없다 — 마스터딜러 회신으로 올라온 뒤에야 후보다.
    const childItem = rfq.children.find((child) => child.partnerId === childAId)?.items[0];
    const direct = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
      kind: 'partner',
      itemId: itemIds[0],
      rfqItemId: childItem?.rfqItemId,
    });
    expect(direct.status, JSON.stringify(direct.json)).toBe(409);
    expect(direct.json?.error).toBe('RFQ_ITEM_NOT_FOUND');
    // 마스터딜러 회신은 고를 수 있다 — 달러 회신이라 견적 고정 환율로 원화 박제.
    const picked = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
      kind: 'partner',
      itemId: itemIds[0],
      rfqItemId: stamped?.rfqItemId,
    });
    expect(picked.status, JSON.stringify(picked.json)).toBe(200);
    const quote = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const offer = (quote.json?.data?.items ?? []).find((item: { id: string }) => item.id === itemIds[0])?.selectedOffer;
    expect(offer?.sourcePrice?.currency).toBe('USD');
    expect(offer?.sourcePrice?.unitPrice).toBe(stamped?.unitPrice);

    // 대리 접속 — 관리자 토큰 + 조직 지정으로 마스터딜러의 화면·동작을 그대로 쓴다.
    const acting = await actAs(A, md.id, 'GET', `/api/partner/rfqs/${String(mdRfqId)}/children`);
    expect(acting.status, '대리 접속 열람').toBe(200);
    expect((acting.json?.data as ChildrenData).rfqs).toHaveLength(2);
    const actingSend = await actAs(A, md.id, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [childAId, childBId],
    });
    expect(actingSend.status, '대리 접속 발송(유지분 그대로)').toBe(200);
    expect((actingSend.json?.data as ChildrenData).kept).toBe(2);

    await rp.assertView(adminView, `/app/admin/smartbom/cases/${quoteId}`, 'M05-admin-case-children', [
      MD.orgName,
      '하위 재요청',
      CHILD_A.name,
      '마스터딜러 포털로 대리 접속',
    ]);
  }, 180_000);

  test('M06. 하위가 다시 회신하면 마스터딜러 회신은 그대로 두고 바뀌었다고 알린다', async (ctx) => {
    if (childARfq === null || stampedRate === 0) return ctx.skip();
    const before = (await loadMdDetail()).items.find((item) => item.quoteItemId === itemIds[0])?.reply;
    const bumped = round4(CHILD_A_PRICE[0] * 1.5);
    const again = await api(null, 'PUT', `/api/rfq-reply/${childARfq.magicToken ?? ''}`, {
      items: [
        { quoteItemId: itemIds[0], unitPrice: bumped, replyQty: LINES[0]!.orderQty, moq: 1, stock: 6_000, dateCode: '25+', leadTime: '7영업일', memo: null },
        { quoteItemId: itemIds[1], unitPrice: CHILD_A_PRICE[1], replyQty: LINES[1]!.orderQty, moq: 1, stock: 60, dateCode: '25+', leadTime: '7영업일', memo: null },
      ],
      deliveryDate: null,
      memo: null,
    });
    expect(again.status, JSON.stringify(again.json)).toBe(200);

    const after = (await loadMdDetail()).items.find((item) => item.quoteItemId === itemIds[0])?.reply;
    expect(after?.unitPrice, '올린 회신은 그대로').toBe(before?.unitPrice);
    expect(after?.childSelection?.stale).toBe(true);
    expect(after?.childSelection?.sourceUnitPrice, '고를 때의 하위 회신가').toBe(CHILD_A_PRICE[0]);
    expect((await loadAdminMdRfq()).rfq.items.find((item) => item.quoteItemId === itemIds[0])?.childSelection?.stale).toBe(true);

    // 하위 선정을 모르는 경로(관리자 대리 입력)가 단가를 그대로 저장하면 근거를 물려받는다.
    const proxy = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/rfqs/${String(mdRfqId)}/reply`, {
      items: (await loadMdDetail()).items.flatMap((item) =>
        item.reply?.unitPrice == null
          ? []
          : [{ quoteItemId: item.quoteItemId, unitPrice: item.reply.unitPrice, replyQty: null, moq: null, stock: null, dateCode: null, leadTime: null, memo: null }],
      ),
      deliveryDate: null,
      memo: null,
    });
    expect(proxy.status, JSON.stringify(proxy.json)).toBe(200);
    const kept = (await loadMdDetail()).items.find((item) => item.quoteItemId === itemIds[0])?.reply;
    expect(kept?.childSelection?.childRfqId, '대리 입력 뒤에도 하위 선정 근거 유지').toBe(childARfq.rfqId);
    expect(kept?.childSelection?.sourceRate).toBe(stampedRate);
  }, 120_000);

  test('M07. 마스터딜러 견적요청을 회수하면 하위 재요청도 함께 회수된다', async (ctx) => {
    if (childBId === 0) return ctx.skip();
    const second = await seedReviewingQuote('e2e-admin', '회수편');
    ledger.push(`sp_bom_quote #${second.quoteId}(회수편)`);
    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${second.quoteId}/rfqs`, {
      partnerIds: [num(md.id)],
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const rfqId: number = sent.json?.data?.rfqs?.[0]?.rfqId;
    const fanned = await api(M, 'POST', `/api/partner/rfqs/${String(rfqId)}/children`, {
      partnerIds: [childBId],
    });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);
    const childToken = (fanned.json?.data as ChildrenData).rfqs[0]?.magicToken ?? '';
    expect((await api(null, 'GET', `/api/rfq-reply/${childToken}`)).status).toBe(200);

    // 미회신 요청 회수 — 선택 협력사 집합을 비운다.
    const withdrawn = await api(A, 'POST', `/api/admin/bom-quotes/${second.quoteId}/rfqs`, {
      partnerIds: [],
    });
    expect(withdrawn.status, JSON.stringify(withdrawn.json)).toBe(200);
    expect(withdrawn.json?.data?.removed).toBe(1);
    const left = await getPrisma().spBomRfq.count({ where: { quoteId: BigInt(second.quoteId) } });
    expect(left, '하위 재요청까지 회수').toBe(0);
    expect((await api(null, 'GET', `/api/rfq-reply/${childToken}`)).status, '하위 매직링크 무효').toBe(404);
    expect((await api(M, 'GET', `/api/partner/rfqs/${String(rfqId)}`)).status).toBe(404);
  }, 120_000);
});
