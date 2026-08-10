// Smart BOM 완주 여정 2호 — 단일검색으로 견적 구성 → 두 협력사 부분 RFQ →
// 품목별 분할 선정 → 2개 PO → 국내·국제 동시 물류 → 전량 입고 뒤 고객 배송.
//
// 1호(파일 업로드·국내 한 곳)와 겹치지 않는 계약을 고정한다.
// - 정확 MPN 단일검색에서 이미지·제조사·설명·구매 조건을 실제 화면으로 확인한다.
// - 가격이 없는 정확 일치 품목은 견적에 남기되 금액·발주 합계에서 제외한다.
// - 부분 RFQ 범위는 협력사마다 서로 다르고, 범위 밖 회신은 서버가 거부한다.
// - 협력사별 선정 품목 집합은 서로소이며 2개 PO의 합집합과 정확히 일치한다.
// - 고객 배송 큐는 입고 0/2·1/2에는 닫히고 2/2에서만 열린다.
//
// 생성한 거래 문서는 1호와 같은 이유로 자동 정리하지 않는다. 단, 실카탈로그에 영구적인
// 가짜 품목을 남기지 않도록 정확 일치·무가격 표시용 E2E offer 한 행만 afterAll에서 제거한다.
// 실행: pnpm -F e2e journey:bom:2
// 사전 조건: nginx·API(3333)·웹(5173)·sp-engine(8400)·Mailpit + 고객 자격.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  mailpitList,
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
const PARTNER_A_NAME = '협력1';
const PARTNER_B_NAME = '협력2';
const ANSWER_EMAIL = `bom-split-${RUN_KEY}@example.test`;
const INQUIRY_OFFER_SKU = 'E2E-BOM-JOURNEY-2-INQUIRY';
const INQUIRY_MPN = 'MT25QL01GBBB8E12-0SIT';
const INQUIRY_MANUFACTURER = 'Micron';

interface SearchPart {
  mpn: string;
  manufacturer: string;
  supplier: string;
  quantity: number;
  inquiry?: boolean;
}

const SEARCH_PARTS: readonly SearchPart[] = [
  {
    mpn: 'STM32F030F4P6',
    manufacturer: 'STMicroelectronics',
    supplier: 'Mouser',
    quantity: 5,
  },
  {
    mpn: 'LTST-C190KGKT',
    manufacturer: 'Lite-On Inc.',
    supplier: 'Digikey',
    quantity: 20,
  },
  {
    mpn: 'B2B-XH-A',
    manufacturer: 'JST Sales America Inc.',
    supplier: 'Digikey',
    quantity: 8,
  },
  {
    mpn: INQUIRY_MPN,
    manufacturer: INQUIRY_MANUFACTURER,
    supplier: 'SamplePCB',
    quantity: 2,
    inquiry: true,
  },
] as const;

interface SearchCartItem {
  id: string;
  mpn: string;
  manufacturerName: string | null;
  partId: string | null;
  bomQty: number;
  orderQty: number;
  lineTotalKrw: number | null;
  selectedOffer: { supplier: string; offerKey: string } | null;
}

interface SearchCartData {
  id: string;
  sourceKind: string;
  status: string;
  uncostedCount: number;
  items: SearchCartItem[];
}

interface PartnerRfqLine {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  orderQty: number;
}

interface PartnerRfqDetailData {
  rfqId: number;
  status: string;
  currency: string;
  items: PartnerRfqLine[];
}

interface AdminRfqItem {
  rfqItemId: number;
  quoteItemId: string;
  unitPrice: number | null;
}

interface AdminRfqRow {
  rfqId: number;
  partnerId: number;
  partnerName: string;
  status: string;
  requestedItemIds: string[] | null;
  items: AdminRfqItem[];
}

interface AdminRfqListData {
  added?: number;
  kept?: number;
  removed?: number;
  rfqs: AdminRfqRow[];
}

interface AdminQuoteItem {
  id: string;
  mpn: string;
  included: boolean;
  selectionSource: string;
  lineTotalKrw: number | null;
  selectedOffer: { supplier: string; offerKey: string } | null;
  adminReview: {
    required: boolean;
    completed: boolean;
    stale: boolean;
  };
}

interface AdminQuoteData {
  status: string;
  updatedAt: string;
  uncostedCount: number;
  confirmedTotal: number | null;
  items: AdminQuoteItem[];
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
  qty: number;
  unitPrice: number;
}

interface PoRow {
  poId: number;
  partnerId: number;
  partnerName: string;
  status: string;
  totalAmount: number;
  currency: string;
  items: PoItem[];
}

interface PoCreateData {
  created: number;
  pos: PoRow[];
}

interface ShipmentCreateData {
  shipmentId: number;
  primaryPoId: number;
  mode: 'domestic' | 'international';
  status: string;
}

interface PackingListItem {
  poItemId: number;
  expectedQty: number;
}

interface PackingListData {
  shipmentId: number;
  editable: boolean;
  items: PackingListItem[];
}

interface BomOrderQueueCase {
  quoteId: string;
  poCount: number;
  poReceivedCount: number;
}

interface BomOrderQueueItem {
  odId: string;
  customerEmail: string;
  recipientName: string;
  cases: BomOrderQueueCase[];
}

interface BomOrderQueueData {
  items: BomOrderQueueItem[];
}

interface FormApiResult {
  status: number;
  json: unknown;
}

interface MailpitSearchData {
  total?: number;
  messages?: unknown[];
}

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const futureDate = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const capabilityList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

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

async function apiForm(
  token: string,
  path: string,
  fileType: 'invoice' | 'airwaybill',
  fileName: string,
): Promise<FormApiResult> {
  const bytes = new TextEncoder()
    .encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    .buffer as ArrayBuffer;
  const form = new FormData();
  form.set('fileType', fileType);
  form.set('file', new File([bytes], fileName, { type: 'application/pdf' }));
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // 바이너리·빈 응답은 이 업로드 경로의 정상 응답은 아니지만 진단 상태는 보존한다.
  }
  return { status: response.status, json };
}

async function waitForMail(recipient: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result: MailpitSearchData = await mailpitSearch(`to:"${recipient}"`);
    if ((result.total ?? result.messages?.length ?? 0) > 0) return;
    await delay(500);
  }
  throw new Error(`Mailpit에서 ${recipient} 수신 메일을 찾지 못했습니다`);
}

async function waitForMailLog(kind: string, refId: string, minimum = 1): Promise<void> {
  const deadline = Date.now() + 15_000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await getPrisma().spMailLog.count({
      where: { kind, refType: 'bom_quote', refId },
    });
    if (count >= minimum) return;
    await delay(250);
  }
  throw new Error(`sp_mail_log ${kind}/bom_quote/${refId} ${String(minimum)}건 대기 실패`);
}

describe.skipIf(!RUN || !JOURNEY)(
  'BOM 여정 2호 — 단일검색 → 2개 협력사 분할 조달 → 전량 입고',
  () => {
    const rp = createJourneyReport(
      'findings-bom-split',
      'BOM 여정 2호 단일검색·분할조달 탐색 주행 리포트',
    );
    const { F, ledger } = rp;

    let customer: PhpLoginResult;
    let adminView: E2eSession;
    let partnerAView: E2eSession;
    let partnerBView: E2eSession;
    let partnerA: PartnerFixture;
    let partnerB: PartnerFixture;
    let A = '';
    let C = '';
    let PA = '';
    let PB = '';
    let inquiryOfferId: bigint | null = null;
    let inquiryImageUrl: string | null = null;
    let pricedImageUrl: string | null = null;

    let quoteId: string | null = null;
    let quoteTitle = '';
    let odId: string | null = null;
    let rfqAId: number | null = null;
    let rfqBId: number | null = null;
    let poAId: number | null = null;
    let poBId: number | null = null;
    let shipmentAId: number | null = null;
    let shipmentBId: number | null = null;
    let confirmedTotal = 0;
    let partnerReplyTotal = 0;
    let groupAItemIds: string[] = [];
    let groupBItemIds: string[] = [];
    let uncostedItemId: string | null = null;

    beforeAll(async () => {
      await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
      await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
      await mustReach(`${BOM_ENGINE_URL}/health`, 'samplepcb-parts-engine ./run.sh');
      await mailpitList(1);

      partnerA = await getPartner(PARTNER_A_NAME);
      partnerB = await getPartner(PARTNER_B_NAME);
      if (partnerA.mbId === null || partnerB.mbId === null) {
        throw new Error('협력1·협력2 모두 연결 계정이 필요합니다');
      }
      expect(partnerA.country, '협력1 국내 조달 전제').toBe('KR');
      expect(partnerB.country, '협력2 국제 조달 전제').not.toBe('KR');
      expect(capabilityList(partnerA.capabilities)).toContain('bom_rfq');
      expect(capabilityList(partnerB.capabilities)).toContain('bom_rfq');

      const creds = requireCustomerCreds();
      customer = await newPhpSession(creds);
      rp.watchHttp(customer, '고객');
      adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
      rp.watchHttp(adminView, '관리자');
      partnerAView = await newSession(
        { mbId: partnerA.mbId },
        { partnerModule: 'bom' },
      );
      rp.watchHttp(partnerAView, '국내 협력사');
      partnerBView = await newSession(
        { mbId: partnerB.mbId },
        { partnerModule: 'bom' },
      );
      rp.watchHttp(partnerBView, '국제 협력사');

      A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7200 });
      C = signJwt({ mbId: customer.mbId, ttlSec: 7200 });
      PA = signJwt({ mbId: partnerA.mbId, ttlSec: 7200 });
      PB = signJwt({ mbId: partnerB.mbId, ttlSec: 7200 });

      // 중단된 이전 2호 실행의 활성 단일검색 draft만 정상 UI 삭제 경로로 비운다.
      const active = await api(C, 'GET', '/api/bom/search-cart');
      const activeCart: SearchCartData | null | undefined = active.json?.data;
      for (const item of activeCart?.items ?? []) {
        const removed = await api(C, 'DELETE', `/api/bom/search-cart/items/${item.id}`);
        expect(removed.status, JSON.stringify(removed.json)).toBe(200);
      }

      // 현재 카탈로그의 정확 일치·무가격 Mouser 품목에 E2E 전용 SamplePCB 문의 채널을
      // 잠시 붙인다. 부품 자체와 ES 문서는 건드리지 않아 실제 검색 경로를 그대로 탄다.
      const inquiryPart = await getPrisma().spPart.findFirst({
        where: { mpn: INQUIRY_MPN, manufacturerName: INQUIRY_MANUFACTURER },
      });
      if (inquiryPart === null || inquiryPart.indexedAt === null) {
        throw new Error(`${INQUIRY_MPN} 색인 품목이 없습니다 — 카탈로그 상태를 확인하세요`);
      }
      await getPrisma().spPartOffer.deleteMany({
        where: {
          partId: inquiryPart.id,
          supplier: 'samplepcb',
          supplierSku: INQUIRY_OFFER_SKU,
        },
      });
      const inquiryOffer = await getPrisma().spPartOffer.create({
        data: {
          partId: inquiryPart.id,
          supplier: 'samplepcb',
          supplierSku: INQUIRY_OFFER_SKU,
          productUrl: null,
          stock: null,
          moq: null,
          orderMultiple: null,
          packaging: null,
          currency: null,
          leadTime: '담당자 확인',
          rawJson: {
            supplier: 'samplepcb',
            manufacturer_part_number: INQUIRY_MPN,
            manufacturer: INQUIRY_MANUFACTURER,
            offer_kind: 'manufacturer_catalog',
            catalog_metadata: {
              sourceDataset: 'e2e-bom-journey-2',
              catalogOnly: true,
              commercialDataAvailable: false,
              samplepcbPreferred: true,
            },
          },
          fetchedAt: new Date(),
        },
      });
      inquiryOfferId = inquiryOffer.id;
      inquiryImageUrl = inquiryPart.imageUrl;
      pricedImageUrl = (
        await getPrisma().spPart.findFirst({
          where: { mpn: SEARCH_PARTS[0]?.mpn ?? '' },
          select: { imageUrl: true },
        })
      )?.imageUrl ?? null;
    }, 180_000);

    afterAll(async () => {
      rp.write({
        고객: customer,
        관리자: adminView,
        국내협력사: partnerAView,
        국제협력사: partnerBView,
      });
      if (inquiryOfferId !== null) {
        await getPrisma().spPartOffer.deleteMany({ where: { id: inquiryOfferId } });
      }
      await closeBrowser();
      await disconnectPrisma();
    }, 60_000);

    async function searchAndAdd(part: SearchPart, expectedCount: number): Promise<void> {
      const page = customer.page;
      const landingInput = page.getByLabel('부품 검색어');
      if (await landingInput.isVisible()) {
        await landingInput.fill(part.mpn);
      } else {
        await page.locator('form[role="search"] input[type="search"]').first().fill(part.mpn);
      }
      await page.getByRole('button', { name: '검색', exact: true }).click();
      const matchingRows = page
        .locator('tbody tr')
        .filter({ hasText: part.mpn })
        .filter({ hasText: part.manufacturer });
      // 제조사 카탈로그 문의 채널은 공급사명 "SamplePCB"를 그대로 노출하지 않고
      // "<제조사> 직접 견적"으로 보여준다. 가격 구매 조건만 유통사명을 검증한다.
      const row = (part.inquiry === true
        ? matchingRows.filter({ hasText: '직접 견적' })
        : matchingRows.filter({ hasText: part.supplier })).first();
      await row.waitFor({ state: 'visible', timeout: 180_000 });
      const rowText = await row.textContent();
      expect(rowText?.toLocaleLowerCase(), `${part.mpn} 정확 일치 제조사`).toContain(
        part.manufacturer.toLocaleLowerCase(),
      );
      if (part.inquiry === true) {
        expect(rowText, `${part.mpn} 제조사 직접 견적 채널`).toContain(
          `${part.manufacturer} 직접 견적`,
        );
        expect(rowText, `${part.mpn} 상업 조건 미확정 표시`).toContain('담당자 확인');
        expect(rowText, `${part.mpn} 문의 행동`).toContain('견적담기');
      } else {
        expect(rowText, `${part.mpn} 공급 채널`).toContain(part.supplier);
      }
      const quantityLabel = part.inquiry === true ? '견적 수량' : '담을 수량';
      await row.getByLabel(quantityLabel).fill(String(part.quantity));
      const responseWait = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && response.url().endsWith('/api/bom/search-cart/items'),
        { timeout: 60_000 },
      );
      await row
        .getByRole('button', { name: part.inquiry === true ? '견적담기' : '담기', exact: true })
        .click();
      const response = await responseWait;
      expect(response.status(), `${part.mpn} 단일검색 견적 담기`).toBe(200);
      await customer.page.waitForFunction(
        (count: number) => document.body.innerText.includes(`Cart (${String(count)})`),
        expectedCount,
        { timeout: 30_000 },
      );
    }

    async function loadOrderQueue(tab: 'paid' | 'to_ship'): Promise<BomOrderQueueData> {
      const response = await api(
        A,
        'GET',
        `/api/admin/bom-orders?tab=${tab}&page=1&pageSize=100`,
      );
      expect(response.status, JSON.stringify(response.json)).toBe(200);
      const data: BomOrderQueueData | undefined = response.json?.data;
      if (data === undefined) throw new Error(`BOM 주문 큐(${tab}) 응답이 없습니다`);
      return data;
    }

    async function assertReceiptGate(received: number, ready: boolean): Promise<void> {
      if (quoteId === null || odId === null) throw new Error('입고 게이트 선행 데이터가 없습니다');
      const paid = await loadOrderQueue('paid');
      const order = paid.items.find((item) => item.odId === odId);
      const queueCase = order?.cases.find((entry) => entry.quoteId === quoteId);
      expect(queueCase?.poCount, `입고 ${String(received)}/2 발주 수`).toBe(2);
      expect(queueCase?.poReceivedCount, `입고 ${String(received)}/2 수령 수`).toBe(received);
      const toShip = await loadOrderQueue('to_ship');
      const inQueue = toShip.items.some((item) => item.odId === odId);
      expect(inQueue, `입고 ${String(received)}/2 고객 배송 큐`).toBe(ready);
    }

    async function preparePacking(
      token: string,
      shipmentId: number,
      expectedItems: number,
      prefix: string,
    ): Promise<void> {
      const draftResponse = await api(
        token,
        'GET',
        `/api/partner/shipments/${String(shipmentId)}/packing-list`,
      );
      expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
      const draft: PackingListData | undefined = draftResponse.json?.data;
      if (draft === undefined) throw new Error(`발송 #${String(shipmentId)} 포장 초안이 없습니다`);
      expect(draft.editable).toBe(true);
      expect(draft.items).toHaveLength(expectedItems);
      const saved = await api(
        token,
        'PUT',
        `/api/partner/shipments/${String(shipmentId)}/packing-list`,
        {
          items: draft.items.map((item, index) => ({
            poItemId: item.poItemId,
            packages: [
              {
                packageId: null,
                quantity: item.expectedQty,
                lotNo: `${prefix}-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
                dateCode: index % 2 === 0 ? '25+' : '24+',
              },
            ],
          })),
        },
      );
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const printed = await api(
        token,
        'POST',
        `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
      );
      expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    }

    test('C01. 고객: 단일검색에서 가격품 3개 + 정확 일치 무가격품 1개 담기', async () => {
      await customer.page.goto(`${BASE_URL}/app/bom/search`, { waitUntil: 'domcontentloaded' });
      for (const [index, part] of SEARCH_PARTS.entries()) {
        await searchAndAdd(part, index + 1);
        if (index === 0) await rp.shot(customer, 'C01-single-search-first-exact');
      }

      const cartResponse = await api(C, 'GET', '/api/bom/search-cart');
      expect(cartResponse.status, JSON.stringify(cartResponse.json)).toBe(200);
      const cart: SearchCartData | null | undefined = cartResponse.json?.data;
      if (cart === undefined || cart === null) throw new Error('단일검색 견적 바구니가 없습니다');
      expect(cart.sourceKind).toBe('single_search');
      expect(cart.status).toBe('draft');
      expect(cart.items).toHaveLength(4);
      expect(cart.uncostedCount, '정확 일치·무가격 품목 1건').toBe(1);
      for (const part of SEARCH_PARTS) {
        const item = cart.items.find((entry) => entry.mpn === part.mpn);
        expect(item?.manufacturerName, `${part.mpn} 제조사 보존`).toBe(part.manufacturer);
        expect(item?.bomQty, `${part.mpn} 입력 수량 보존`).toBe(part.quantity);
      }
      expect(cart.items.find((item) => item.mpn === INQUIRY_MPN)?.selectedOffer).toBeNull();
      expect(cart.items.find((item) => item.mpn === INQUIRY_MPN)?.lineTotalKrw).toBeNull();
      await rp.shot(customer, 'C01-search-cart-four-items');

      const requestWait = customer.page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && /\/api\/bom\/quotes\/\d+\/request$/.test(response.url()),
        { timeout: 60_000 },
      );
      await customer.page.getByRole('button', { name: '견적요청', exact: true }).click();
      const requested = await requestWait;
      expect(requested.status(), '단일검색 견적요청 UI').toBe(200);
      await customer.page.waitForURL((url) => /^\/app\/bom\/\d+$/.test(url.pathname), {
        timeout: 60_000,
      });
      const matched = /^\/app\/bom\/(\d+)$/.exec(new URL(customer.page.url()).pathname);
      if (matched?.[1] === undefined) throw new Error('단일검색 quoteId를 찾지 못했습니다');
      quoteId = matched[1];
      const quote = await getPrisma().spBomQuote.findUnique({
        where: { id: BigInt(quoteId) },
        include: { items: true },
      });
      expect(quote?.status).toBe('requested');
      expect(quote?.sourceKind).toBe('single_search');
      expect(quote?.activeSearchCartKey).toBeNull();
      quoteTitle = quote?.title ?? '';
      expect(quoteTitle).toMatch(/^단일검색 견적 /);
      ledger.push(`sp_bom_quote #${quoteId} (${quoteTitle}, 단일검색 4품목·미산정 1)`);
      await rp.shot(customer, 'C01-single-search-requested');
    }, 660_000);

    test('C02. 관리자: 검토 시작 → 서로소 부분 RFQ 2건 발송', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      const start = await api(A, 'PATCH', `/api/admin/bom-quotes/${quoteId}`, {
        status: 'reviewing',
      });
      expect(start.status, JSON.stringify(start.json)).toBe(200);
      const detail: AdminQuoteData | undefined = start.json?.data;
      if (detail === undefined) throw new Error('관리자 BOM 상세 응답이 없습니다');
      const byMpn = new Map(detail.items.map((item) => [item.mpn, item] as const));
      groupAItemIds = SEARCH_PARTS.slice(0, 2).map((part) => {
        const item = byMpn.get(part.mpn);
        if (item === undefined) throw new Error(`${part.mpn} 견적행이 없습니다`);
        return item.id;
      });
      const groupBItem = byMpn.get(SEARCH_PARTS[2]?.mpn ?? '');
      const uncosted = byMpn.get(INQUIRY_MPN);
      if (groupBItem === undefined || uncosted === undefined) {
        throw new Error('그룹 B 또는 무가격 견적행이 없습니다');
      }
      groupBItemIds = [groupBItem.id];
      uncostedItemId = uncosted.id;

      const first = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, {
        partnerIds: [num(partnerA.id)],
        itemIds: groupAItemIds,
      });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      const firstData: AdminRfqListData | undefined = first.json?.data;
      expect(firstData?.added).toBe(1);

      const second = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, {
        partnerIds: [num(partnerA.id), num(partnerB.id)],
        itemIds: groupBItemIds,
      });
      expect(second.status, JSON.stringify(second.json)).toBe(200);
      const secondData: AdminRfqListData | undefined = second.json?.data;
      expect(secondData?.added).toBe(1);
      expect(secondData?.kept).toBe(1);
      expect(secondData?.removed).toBe(0);
      const rowA = secondData?.rfqs.find((row) => row.partnerId === num(partnerA.id));
      const rowB = secondData?.rfqs.find((row) => row.partnerId === num(partnerB.id));
      if (rowA === undefined || rowB === undefined) throw new Error('분할 RFQ 2건이 없습니다');
      rfqAId = rowA.rfqId;
      rfqBId = rowB.rfqId;
      expect(new Set(rowA.requestedItemIds ?? [])).toEqual(new Set(groupAItemIds));
      expect(new Set(rowB.requestedItemIds ?? [])).toEqual(new Set(groupBItemIds));
      expect(rowA.requestedItemIds).not.toContain(uncostedItemId);
      expect(rowB.requestedItemIds).not.toContain(uncostedItemId);
      await waitForMailLog('bom_rfq_request', quoteId, 2);
      ledger.push(
        `sp_bom_rfq #${String(rfqAId)}(${PARTNER_A_NAME} ${String(groupAItemIds.length)}행) + #${String(rfqBId)}(${PARTNER_B_NAME} ${String(groupBItemIds.length)}행)`,
      );
      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'C02-admin-two-partial-rfqs',
        [PARTNER_A_NAME, PARTNER_B_NAME, '부분'],
      );
    }, 120_000);

    test('C03. 협력사: 자기 범위만 조회·범위 밖 회신 거부·각자 회신', async (ctx) => {
      if (rfqAId === null || rfqBId === null || quoteId === null) return ctx.skip();
      const [responseA, responseB] = await Promise.all([
        api(PA, 'GET', `/api/partner/rfqs/${String(rfqAId)}`),
        api(PB, 'GET', `/api/partner/rfqs/${String(rfqBId)}`),
      ]);
      expect(responseA.status, JSON.stringify(responseA.json)).toBe(200);
      expect(responseB.status, JSON.stringify(responseB.json)).toBe(200);
      const detailA: PartnerRfqDetailData | undefined = responseA.json?.data;
      const detailB: PartnerRfqDetailData | undefined = responseB.json?.data;
      if (detailA === undefined || detailB === undefined) throw new Error('협력사 RFQ 상세가 없습니다');
      expect(new Set(detailA.items.map((item) => item.quoteItemId))).toEqual(
        new Set(groupAItemIds),
      );
      expect(new Set(detailB.items.map((item) => item.quoteItemId))).toEqual(
        new Set(groupBItemIds),
      );
      // 현재 BOM 협력사 RFQ는 파트너 기본 통화와 무관하게 KRW 전용이다.
      expect(detailA.currency).toBe('KRW');
      expect(detailB.currency).toBe('KRW');
      F('C03', 'obs', '협력2(CN·기본 USD)도 현재 BOM RFQ 계약에 따라 KRW로 회신');

      const crossRead = await api(PA, 'GET', `/api/partner/rfqs/${String(rfqBId)}`);
      expect(crossRead.status, '다른 협력사 RFQ 은닉').toBe(404);
      const outside = await api(PA, 'PUT', `/api/partner/rfqs/${String(rfqAId)}`, {
        items: [
          {
            quoteItemId: groupBItemIds[0],
            unitPrice: 1,
            replyQty: 1,
            moq: null,
            stock: 1,
            dateCode: '25+',
            leadTime: '즉시',
            memo: '범위 밖 회신 거부 검증',
          },
        ],
        deliveryDate: futureDate(5),
        memo: '범위 밖 회신은 저장되면 안 됨',
      });
      expect(outside.status, JSON.stringify(outside.json)).toBe(400);
      expect(outside.json?.error).toBe('ITEM_OUT_OF_SCOPE');

      partnerReplyTotal = 0;
      const replyItemsA = detailA.items.map((item, index) => {
        const unitPrice = 120 + index * 35;
        partnerReplyTotal += unitPrice * item.orderQty;
        return {
          quoteItemId: item.quoteItemId,
          unitPrice,
          replyQty: item.orderQty,
          moq: 1,
          stock: item.orderQty + 500,
          dateCode: index % 2 === 0 ? '25+' : '24+',
          leadTime: '국내 재고 · 3영업일',
          memo: `${item.mpn} 국내 분할 조달`,
        };
      });
      const replyA = await api(PA, 'PUT', `/api/partner/rfqs/${String(rfqAId)}`, {
        items: replyItemsA,
        deliveryDate: futureDate(5),
        memo: `[BOM 여정 2호 ${RUN_KEY}] 국내 그룹 A`,
      });
      expect(replyA.status, JSON.stringify(replyA.json)).toBe(200);

      const replyItemsB = detailB.items.map((item, index) => {
        const unitPrice = 260 + index * 40;
        partnerReplyTotal += unitPrice * item.orderQty;
        return {
          quoteItemId: item.quoteItemId,
          unitPrice,
          replyQty: item.orderQty,
          moq: 1,
          stock: item.orderQty + 100,
          dateCode: '25+',
          leadTime: '중국 출고 · 7영업일',
          memo: `${item.mpn} 국제 분할 조달`,
        };
      });
      const replyB = await api(PB, 'PUT', `/api/partner/rfqs/${String(rfqBId)}`, {
        items: replyItemsB,
        deliveryDate: futureDate(8),
        memo: `[BOM 여정 2호 ${RUN_KEY}] 국제 그룹 B`,
      });
      expect(replyB.status, JSON.stringify(replyB.json)).toBe(200);

      await rp.assertView(
        partnerAView,
        `/app/partner/bom/rfqs/${String(rfqAId)}`,
        'C03-partner-a-quoted',
        [quoteTitle, '회신', 'KRW'],
      );
      await rp.assertView(
        partnerBView,
        `/app/partner/bom/rfqs/${String(rfqBId)}`,
        'C03-partner-b-quoted',
        [quoteTitle, '회신', 'KRW'],
      );
    }, 120_000);

    test('C04. 관리자: 비교 팝업에서 협력사별 품목 선정 → 팝업 자동 닫힘', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      await adminView.page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, {
        waitUntil: 'domcontentloaded',
      });
      const compareButton = adminView.page.getByRole('button', {
        name: '회신 비교·선정',
        exact: true,
      });
      await compareButton.waitFor({ state: 'visible', timeout: 60_000 });
      await compareButton.click();
      const heading = adminView.page.getByRole('heading', { name: '협력사 회신 비교·선정' });
      await heading.waitFor({ state: 'visible', timeout: 30_000 });
      const dialog = adminView.page.locator('div.fixed.inset-0').filter({ has: heading });
      for (const part of SEARCH_PARTS.slice(0, 3)) {
        const row = dialog.locator('tbody tr').filter({ hasText: part.mpn }).first();
        await row.waitFor({ state: 'visible', timeout: 30_000 });
        const radios = row.locator('input[type="radio"]');
        expect(await radios.count(), `${part.mpn} 유지+해당 협력사 선택지`).toBe(2);
        await radios.nth(1).check();
      }
      await rp.shot(adminView, 'C04-admin-split-comparison');
      await adminView.page.getByRole('button', { name: '선정 적용', exact: true }).click();
      await heading.waitFor({ state: 'hidden', timeout: 60_000 });

      const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
      expect(response.status, JSON.stringify(response.json)).toBe(200);
      let detail: AdminQuoteData | undefined = response.json?.data;
      if (detail === undefined) throw new Error('선정 뒤 관리자 상세가 없습니다');
      for (const id of [...groupAItemIds, ...groupBItemIds]) {
        const item = detail.items.find((entry) => entry.id === id);
        expect(item?.selectionSource, `품목 ${id} 협력사 선정`).toBe('partner');
      }
      const uncosted = detail.items.find((item) => item.id === uncostedItemId);
      expect(uncosted?.selectedOffer).toBeNull();
      expect(uncosted?.lineTotalKrw).toBeNull();
      expect(detail.uncostedCount).toBe(1);

      const pending = detail.items.filter(
        (item) => item.adminReview.required && !item.adminReview.completed,
      );
      if (pending.length > 0) {
        const reviewed = await api(
          A,
          'PUT',
          `/api/admin/bom-quotes/${quoteId}/item-reviews`,
          {
            itemIds: pending.map((item) => item.id),
            completed: true,
            expectedQuoteUpdatedAt: detail.updatedAt,
            reason: `[BOM 여정 2호 ${RUN_KEY}] 분할 회신·무가격 제외 확인`,
          },
        );
        expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      }
      const refreshed = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
      detail = refreshed.json?.data;
      expect(
        detail?.items.filter((item) => item.adminReview.required && !item.adminReview.completed),
      ).toHaveLength(0);
      await rp.shot(adminView, 'C04-admin-comparison-closed-reviewed');
    }, 180_000);

    test('C05. 관리자 회신: 미산정 1건을 명시하고 고객 화면·견적서 자료 확인', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      confirmedTotal = Math.ceil((partnerReplyTotal * 1.15 + 15_000) / 1_000) * 1_000;
      const completed = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
        adminMemo: `[BOM 여정 2호 ${RUN_KEY}] 2개 협력사 분할 조달`,
        answerNote: `${INQUIRY_MPN} 1개 품목은 금액 미산정으로 이번 주문 금액에서 제외됩니다.`,
        confirmedShippingFee: 5_000,
        confirmedManagementFee: 10_000,
        confirmedTotal,
        sendEmail: true,
        toEmail: ANSWER_EMAIL,
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);
      const detail: AdminQuoteData | undefined = completed.json?.data;
      expect(detail?.status).toBe('answered');
      expect(detail?.uncostedCount).toBe(1);
      expect(detail?.confirmedTotal).toBe(confirmedTotal);
      expect(completed.json?.email?.status).toBe('sent');
      await waitForMail(ANSWER_EMAIL);

      await rp.assertView(
        customer,
        `/app/bom/${quoteId}`,
        'C05-customer-confirmed-with-uncosted',
        ['확정 견적', '금액 미산정 품목 1건', INQUIRY_MPN],
      );
      const bodyText = await customer.page.locator('body').textContent();
      expect(bodyText).toContain(INQUIRY_MANUFACTURER);
      expect(bodyText).toContain('NOR 플래시');
      expect(bodyText).not.toContain('AI로 산출한 가견적입니다.');
      expect(bodyText).not.toContain('부품 확인됨 · 재고 대기');
      const imageSources = await customer.page
        .locator('img')
        .evaluateAll((images) => images.map((image) => image.getAttribute('src')));
      if (pricedImageUrl !== null) expect(imageSources).toContain(pricedImageUrl);
      if (inquiryImageUrl !== null) expect(imageSources).toContain(inquiryImageUrl);
      ledger.push(`Mailpit 고객 회신 ${ANSWER_EMAIL} · 미산정 1건 명시`);
    }, 120_000);

    test('C06. 고객 주문·입금 → 협력사별 2개 PO의 서로소 합집합 검증', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      const order = await placeOrderFromBomQuote(customer, rp, {
        quoteId,
        step: 'C06',
        prefix: 'C06',
        buyerName: 'e2eBOM분할고객',
      });
      odId = order.odId;
      const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: true,
        sendSms: false,
      });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(paid.json?.data?.skipped ?? []).toHaveLength(0);

      const issued = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, {
        partnerIds: [num(partnerA.id), num(partnerB.id)],
        memo: `[BOM 여정 2호 ${RUN_KEY}] 국내·국제 분할 발주`,
      });
      expect(issued.status, JSON.stringify(issued.json)).toBe(200);
      const poData: PoCreateData | undefined = issued.json?.data;
      expect(poData?.created).toBe(2);
      const poA = poData?.pos.find((po) => po.partnerId === num(partnerA.id));
      const poB = poData?.pos.find((po) => po.partnerId === num(partnerB.id));
      if (poA === undefined || poB === undefined) throw new Error('분할 발주서 2건이 없습니다');
      poAId = poA.poId;
      poBId = poB.poId;
      expect(new Set(poA.items.map((item) => item.quoteItemId))).toEqual(
        new Set(groupAItemIds),
      );
      expect(new Set(poB.items.map((item) => item.quoteItemId))).toEqual(
        new Set(groupBItemIds),
      );
      const intersection = poA.items.filter((item) =>
        poB.items.some((other) => other.quoteItemId === item.quoteItemId));
      expect(intersection, 'PO 품목 집합 서로소').toHaveLength(0);
      expect(
        new Set([...poA.items, ...poB.items].map((item) => item.quoteItemId)),
        'PO 합집합 = 가격 선정 3품목',
      ).toEqual(new Set([...groupAItemIds, ...groupBItemIds]));
      expect([...poA.items, ...poB.items].some((item) => item.quoteItemId === uncostedItemId))
        .toBe(false);
      await waitForMailLog('bom_po_issued', quoteId, 2);

      const [confirmedA, confirmedB] = await Promise.all([
        api(PA, 'POST', `/api/partner/pos/${String(poAId)}/confirm`),
        api(PB, 'POST', `/api/partner/pos/${String(poBId)}/confirm`),
      ]);
      expect(confirmedA.status, JSON.stringify(confirmedA.json)).toBe(200);
      expect(confirmedB.status, JSON.stringify(confirmedB.json)).toBe(200);
      ledger.push(
        `g5_shop_order ${odId} · sp_bom_po #${String(poAId)}(${PARTNER_A_NAME}) + #${String(poBId)}(${PARTNER_B_NAME})`,
      );
      await assertReceiptGate(0, false);
      await rp.assertView(
        partnerAView,
        `/app/partner/bom/pos/${String(poAId)}`,
        'C06-partner-a-po-confirmed',
        [quoteTitle, '발주', '확인'],
      );
      await rp.assertView(
        partnerBView,
        `/app/partner/bom/pos/${String(poBId)}`,
        'C06-partner-b-po-confirmed',
        [quoteTitle, '발주', '확인'],
      );
    }, 300_000);

    test('C07. 국내 협력사: QR 포장·택배 발송 → 첫 입고 1/2, 배송 큐 잠금', async (ctx) => {
      if (quoteId === null || poAId === null) return ctx.skip();
      const created = await api(PA, 'POST', '/api/partner/shipments', { poIds: [poAId] });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      const shipment: ShipmentCreateData | undefined = created.json?.data;
      if (shipment === undefined) throw new Error('국내 발송 생성 응답이 없습니다');
      shipmentAId = shipment.shipmentId;
      expect(shipment.mode).toBe('domestic');
      expect(shipment.status).toBe('preparing');
      await preparePacking(PA, shipmentAId, groupAItemIds.length, 'KR-LOT');
      const trackingNumber = `BOM-KR-${RUN_KEY}`;
      const shipping = await api(
        PA,
        'POST',
        `/api/partner/pos/${String(poAId)}/shipment/advance`,
        {
          carrier: 'CJ대한통운',
          trackingNumber,
          trackingUrl: `https://example.test/track/${trackingNumber}`,
        },
      );
      expect(shipping.status, JSON.stringify(shipping.json)).toBe(200);
      expect(shipping.json?.data?.shipment?.status).toBe('shipping');
      const received = await api(
        A,
        'POST',
        `/api/admin/bom-quotes/${quoteId}/pos/${String(poAId)}/shipment/receive`,
        { note: `[BOM 여정 2호 ${RUN_KEY}] 국내 그룹 입고` },
      );
      expect(received.status, JSON.stringify(received.json)).toBe(200);
      await assertReceiptGate(1, false);
      F('C07', 'obs', '첫 입고 뒤 1/2 — 고객 배송 대기 큐에는 아직 노출되지 않음');
      await rp.assertView(
        partnerAView,
        '/app/partner/bom/shipments/done',
        'C07-domestic-shipment-received',
        ['완료된 발송', `발송 #${String(shipmentAId)}`],
      );
    }, 180_000);

    test('C08. 국제 협력사: QR 포장·Invoice → 관리자 AWB·선적·도착·통관', async (ctx) => {
      if (quoteId === null || poBId === null) return ctx.skip();
      const created = await api(PB, 'POST', '/api/partner/shipments', { poIds: [poBId] });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      const shipment: ShipmentCreateData | undefined = created.json?.data;
      if (shipment === undefined) throw new Error('국제 발송 생성 응답이 없습니다');
      shipmentBId = shipment.shipmentId;
      expect(shipment.mode).toBe('international');
      expect(shipment.status).toBe('preparing');
      await preparePacking(PB, shipmentBId, groupBItemIds.length, 'CN-LOT');

      const invoiceDraft = await api(
        PB,
        'GET',
        `/api/partner/pos/${String(poBId)}/shipment/invoice?fresh=true`,
      );
      expect(invoiceDraft.status, JSON.stringify(invoiceDraft.json)).toBe(200);
      const invoiceData: unknown = invoiceDraft.json?.data;
      const invoiceSaved = await api(
        PB,
        'PUT',
        `/api/partner/pos/${String(poBId)}/shipment/invoice`,
        invoiceData,
      );
      expect(invoiceSaved.status, JSON.stringify(invoiceSaved.json)).toBe(200);
      const invoiceUpload = await apiForm(
        PB,
        `/api/partner/pos/${String(poBId)}/shipment/files`,
        'invoice',
        `bom-invoice-${RUN_KEY}.pdf`,
      );
      expect(invoiceUpload.status, JSON.stringify(invoiceUpload.json)).toBe(200);

      const requested = await api(
        PB,
        'POST',
        `/api/partner/pos/${String(poBId)}/shipment/advance`,
        { shipDate: futureDate(3) },
      );
      expect(requested.status, JSON.stringify(requested.json)).toBe(200);
      expect(requested.json?.data?.shipment?.status).toBe('requested');

      const awbUpload = await apiForm(
        A,
        `/api/admin/bom-quotes/${quoteId}/pos/${String(poBId)}/shipment/files`,
        'airwaybill',
        `bom-awb-${RUN_KEY}.pdf`,
      );
      expect(awbUpload.status, JSON.stringify(awbUpload.json)).toBe(200);
      const transitions = [
        {
          status: 'shipped',
          carrier: 'DHL',
          trackingNumber: `BOM-CN-${RUN_KEY}`,
          trackingUrl: `https://example.test/intl/${RUN_KEY}`,
        },
        { status: 'arrived' },
        { status: 'customs' },
      ] as const;
      for (const body of transitions) {
        const advanced = await api(
          A,
          'PUT',
          `/api/admin/bom-quotes/${quoteId}/pos/${String(poBId)}/shipment`,
          body,
        );
        expect(advanced.status, `${body.status}: ${JSON.stringify(advanced.json)}`).toBe(200);
      }
      const dbShipment = await getPrisma().spBomShipment.findUnique({
        where: { id: BigInt(shipmentBId) },
      });
      expect(dbShipment?.status).toBe('customs');
      expect(dbShipment?.receivedAt).toBeNull();
      const files = await getPrisma().spFile.findMany({
        where: { refType: 'sp_bom_shipment', refId: BigInt(shipmentBId) },
        select: { fileType: true },
      });
      expect(new Set(files.map((file: { fileType: string }) => file.fileType))).toEqual(
        new Set(['invoice', 'airwaybill']),
      );
      await assertReceiptGate(1, false);
      await rp.assertView(
        adminView,
        '/app/admin/smartbom/logistics',
        'C08-international-customs-half-received',
        [PARTNER_B_NAME, '통관'],
      );
    }, 180_000);

    test('C09. 국제 입고로 2/2 → 고객 배송 큐 개방 → 배송·완료', async (ctx) => {
      if (
        quoteId === null
        || poBId === null
        || shipmentBId === null
        || odId === null
      ) return ctx.skip();
      const received = await api(
        A,
        'POST',
        `/api/admin/bom-quotes/${quoteId}/pos/${String(poBId)}/shipment/receive`,
        { note: `[BOM 여정 2호 ${RUN_KEY}] 국제 그룹 통관·수량 확인 완료` },
      );
      expect(received.status, JSON.stringify(received.json)).toBe(200);
      const dbShipment = await getPrisma().spBomShipment.findUnique({
        where: { id: BigInt(shipmentBId) },
      });
      expect(dbShipment?.status).toBe('done');
      expect(dbShipment?.receivedAt).not.toBeNull();
      await assertReceiptGate(2, true);
      await waitForMailLog('bom_shipment_received', quoteId, 2);

      await rp.assertView(
        adminView,
        '/app/admin/smartbom/logistics',
        'C09-all-received-customer-to-ship',
        [odId, '입고 완료', '발송 가능', '배송 처리'],
      );
      const row = adminView.page.locator('tr').filter({ hasText: odId }).first();
      await row.getByRole('button', { name: '배송 처리', exact: true }).click();
      await adminView.page
        .getByRole('heading', { name: `배송 처리 — ${odId}` })
        .waitFor({ timeout: 30_000 });
      expect(await adminView.page.getByLabel('배송 안내 이메일 발송').isChecked()).toBe(true);
      await adminView.page.getByLabel('택배사').fill('우체국택배');
      await adminView.page.getByLabel('송장번호').fill(`CUSTOMER-SPLIT-${RUN_KEY}`);
      const shippingWait = adminView.page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH'
          && response.url().endsWith(`/api/admin/orders/${odId}/force-status`),
        { timeout: 30_000 },
      );
      await adminView.page
        .getByRole('button', { name: '배송 처리 · 메일 발송', exact: true })
        .click();
      const shipping = await shippingWait;
      expect(shipping.status()).toBe(200);
      const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
        target: '완료',
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);

      await rp.assertView(
        customer,
        `/shop/orderinquiryview.php?od_id=${odId}`,
        'C09-customer-order-complete',
        [odId, '완료'],
      );
      await rp.assertView(
        partnerBView,
        '/app/partner/bom/shipments/done',
        'C09-international-shipment-done',
        ['완료된 발송', `발송 #${String(shipmentBId)}`],
      );

      const orderRows: { odStatus: string; odMisu: bigint | number }[] =
        await getPrisma().$queryRawUnsafe(
          'SELECT od_status AS odStatus, od_misu AS odMisu FROM g5_shop_order WHERE od_id = ?',
          odId,
        );
      expect(orderRows[0]?.odStatus).toBe('완료');
      expect(Number(orderRows[0]?.odMisu ?? -1)).toBe(0);
      expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
      expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
      expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
      expect(partnerAView.pageErrors, '국내 협력사 pageerror').toHaveLength(0);
      expect(partnerBView.pageErrors, '국제 협력사 pageerror').toHaveLength(0);
      F(
        'C09',
        'obs',
        `BOM 분할조달 완주 — quote=${quoteId} od=${odId} rfq=${String(rfqAId)}/${String(rfqBId)} po=${String(poAId)}/${String(poBId)} shipment=${String(shipmentAId)}/${String(shipmentBId)}`,
      );
    }, 180_000);
  },
);
