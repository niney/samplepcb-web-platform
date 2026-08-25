// Smart BOM 완주 여정 1호 — 다양한 BOM 업로드 → 협력사 RFQ → 고객 회신·이메일 →
// 영카트 주문·입금 → 발주·실물 포장 → 국내 배송·입고 → 고객 주문 완료.
//
// PCB 완주 여정과 같은 탐색 주행 규약을 쓴다. 화면은 고객·관리자·협력사 역할별 핵심
// 구간을 실제 브라우저로 관찰하고, 반복 입력이 큰 업무 전이는 API로 실행한 뒤 DB로
// 확정한다. 생성물은 자동 정리하지 않는다 — output/journey/findings-bom.md 대장으로
// 확인한 뒤 수동 정리한다. 협력1 마스터 데이터는 읽기만 하고, 이 Case에 속한 신규
// RFQ·PO·선적만 만든다.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:bom
// 사전 조건: nginx·API(3333)·웹(5173)·sp-engine(8400)·Mailpit + 고객 자격.
import { join } from 'node:path';
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
  monoRoot,
  newPhpSession,
  newSession,
  num,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  resetSupplierSearchQuota,
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_CSV = join(monoRoot, 'e2e', 'fixtures', 'bom-journey-1-diverse.csv');
const PARTNER_NAME = '협력1'; // KR·KRW·bom_rfq — 마스터는 변경하지 않는다.
const RUN_KEY = String(Date.now());
const QUOTE_TITLE = `[BOM 여정 1호] 혼합 부품 ${RUN_KEY}`;
const FIRST_REPLY_EMAIL = `bom-journey-${RUN_KEY}@example.test`;
const RESEND_EMAIL = `bom-resend-${RUN_KEY}@example.test`;

interface QuoteState {
  id: bigint;
  title: string;
  status: string;
  buildStatus: string;
  enrichStatus: string;
  setQty: number;
  spareQty: number;
  ctId: number | null;
  confirmedTotal: number | null;
}

interface AnalysisComponentRow {
  componentType: string | null;
  partNumber: string | null;
  quantity: number | null;
  payload: unknown;
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

interface AdminRfqReplyItem {
  rfqItemId: number;
  quoteItemId: string;
  unitPrice: number | null;
}

interface AdminRfqRow {
  rfqId: number;
  partnerId: number;
  status: string;
  items: AdminRfqReplyItem[];
}

interface AdminRfqListData {
  rfqs: AdminRfqRow[];
}

interface AdminQuoteItem {
  id: string;
  included: boolean;
  selectionSource: string;
  adminReview: {
    required: boolean;
    completed: boolean;
    stale: boolean;
  };
}

interface AdminQuoteData {
  status: string;
  updatedAt: string;
  customerEmail: string | null;
  confirmedTotal: number | null;
  items: AdminQuoteItem[];
}

interface EmailDelivery {
  requested: boolean;
  status: string;
  toEmail: string | null;
  reason: string | null;
}

interface CompleteResponseData {
  data: AdminQuoteData;
  email: EmailDelivery;
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
  mode: string;
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

interface DbPackingItem {
  packages: { status: string }[];
}

interface MailpitSearchData {
  total?: number;
  messages?: unknown[];
}

interface CartRow {
  ctId: bigint | number;
  ioId: string;
  ctQty: number;
  ctPrice: number;
  ioPrice: number;
  ctStatus: string;
  odId: string;
}

interface OrderPaymentRow {
  odStatus: string;
  odMisu: bigint | number;
  odReceiptPrice: bigint | number;
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
  recipientPhone: string;
  recipientAddress: string;
  cases: BomOrderQueueCase[];
}

interface BomOrderQueueData {
  items: BomOrderQueueItem[];
}

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const objectField = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
};

const capabilityList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const futureDate = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

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

async function readQuoteState(quoteId: string): Promise<QuoteState | null> {
  return getPrisma().spBomQuote.findUnique({
    where: { id: BigInt(quoteId) },
    select: {
      id: true,
      title: true,
      status: true,
      buildStatus: true,
      enrichStatus: true,
      setQty: true,
      spareQty: true,
      ctId: true,
      confirmedTotal: true,
    },
  });
}

async function waitForQuoteState(
  quoteId: string,
  label: string,
  predicate: (state: QuoteState) => boolean,
  timeoutMs = 120_000,
): Promise<QuoteState> {
  const deadline = Date.now() + timeoutMs;
  let last: QuoteState | null = null;
  while (Date.now() < deadline) {
    last = await readQuoteState(quoteId);
    if (last !== null && predicate(last)) return last;
    await delay(1_000);
  }
  const lastLabel =
    last === null
      ? '없음'
      : `${last.status}/${last.buildStatus}/${last.enrichStatus} set=${String(last.setQty)} spare=${String(last.spareQty)}`;
  throw new Error(`${label} 대기 시간 초과 — 마지막 상태: ${lastLabel}`);
}

async function waitForMail(recipient: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let count = 0;
  while (Date.now() < deadline) {
    const result: MailpitSearchData = await mailpitSearch(`to:"${recipient}"`);
    count = result.total ?? result.messages?.length ?? 0;
    if (count > 0) return;
    await delay(500);
  }
  throw new Error(
    `Mailpit에서 ${recipient} 수신 메일을 찾지 못했습니다(마지막 ${String(count)}건)`,
  );
}

async function waitForMailLog(
  kind: string,
  refType: 'bom_quote' | 'order',
  refId: string,
  minimum = 1,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await getPrisma().spMailLog.count({ where: { kind, refType, refId } });
    if (count >= minimum) return;
    await delay(250);
  }
  throw new Error(
    `sp_mail_log ${kind}/${refType}/${refId} ${String(minimum)}건 대기 실패 — 현재 ${String(count)}건`,
  );
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 1호 — 다양한 BOM → 국내 배송 완료', () => {
  const rp = createJourneyReport('findings-bom', 'BOM 여정 1호 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  let quoteId: string | null = null;
  let rfqId: number | null = null;
  let poId: number | null = null;
  let shipmentId: number | null = null;
  let odId: string | null = null;
  let partnerReplyTotal = 0;
  let confirmedTotal = 0;
  let rfqQuoteItemIds: string[] = [];

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(`${BOM_ENGINE_URL}/health`, 'samplepcb-parts-engine ./run.sh');
    await mailpitList(1);

    const creds = requireCustomerCreds();
    // 반복 주행이 한도(20/일)를 소진하면 검색이 429 라 후보가 0건이 되고, 수량·선정이
    // 비어 B02 같은 무관한 어서션이 깨진다(2026-08-16 실측) — 오늘치만 되돌린다.
    await resetSupplierSearchQuota(['e2e-admin', creds.id]);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정이 없습니다`);
    expect(partner.country, `${PARTNER_NAME} 국내 선적 전제`).toBe('KR');
    expect(capabilityList(partner.capabilities), `${PARTNER_NAME} BOM RFQ 권한`).toContain(
      'bom_rfq',
    );

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'bom' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('B01. 고객: 다양한 CSV 업로드 → 분석·공급사 확인 완료', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
    await fileInput.setInputFiles(FIXTURE_CSV);
    await page.waitForURL((url) => /^\/app\/bom\/\d+$/.test(url.pathname), { timeout: 60_000 });

    const match = /^\/app\/bom\/(\d+)$/.exec(new URL(page.url()).pathname);
    if (match?.[1] === undefined)
      throw new Error(`업로드 뒤 quoteId를 찾지 못했습니다: ${page.url()}`);
    quoteId = match[1];
    ledger.push(`sp_bom_quote #${quoteId} (${customer.mbId}, ${QUOTE_TITLE})`);

    const settled = await waitForQuoteState(
      quoteId,
      'BOM 분석·공급사 확인',
      (state) => state.buildStatus === 'ready' && state.enrichStatus !== 'searching',
      600_000,
    );
    if (settled.enrichStatus === 'failed') {
      F('B01', 'obs', '공급사 자동 확인은 실패 상태로 종료 — 협력사 RFQ 경로는 계속 검증');
    }

    const quote = await getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quoteId) },
      include: {
        items: true,
        activeAnalysisRun: { include: { components: true } },
      },
    });
    expect(quote, '업로드 Case 영속').not.toBeNull();
    const components: AnalysisComponentRow[] = quote?.activeAnalysisRun?.components ?? [];
    expect(components, '혼합 BOM 추출 행').toHaveLength(12);
    const componentTypes = new Set(components.map((component) => component.componentType));
    for (const type of [
      'ic',
      'resistor',
      'capacitor',
      'diode',
      'inductor',
      'led',
      'connector',
      'transistor',
    ]) {
      expect(componentTypes.has(type), `${type} 예시 추출`).toBe(true);
    }
    const dnp = components.find((component) => component.partNumber === 'BLM18AG601SN1D');
    expect(dnp?.quantity, 'DNP 수량 0 보존').toBe(0);
    expect(objectField(dnp?.payload, 'search_disposition'), 'DNP 공급사 검색 제외').toBe(
      'excluded',
    );
    expect(quote?.items.length ?? 0, '후속 RFQ용 견적 품목').toBeGreaterThanOrEqual(8);
    await rp.shot(customer, 'B01-bom-analysis-ready');
  }, 660_000);

  test('B02. 고객: 세트·예비 수량 조정 → 견적요청', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const page = customer.page;
    const setInput = page.locator('input[aria-label="세트 수량"]');
    const spareInput = page.locator('input[aria-label="예비 수량"]');
    await setInput.waitFor({ state: 'visible', timeout: 30_000 });
    await setInput.fill('3');
    await setInput.press('Tab');
    await spareInput.fill('1');
    await spareInput.press('Tab');
    await waitForQuoteState(
      quoteId,
      '세트·예비 수량 저장',
      (state) => state.setQty === 3 && state.spareQty === 1,
    );
    await rp.shot(customer, 'B02-bom-quantity-adjusted');

    await page.getByRole('button', { name: '견적요청', exact: true }).click();
    const titleInput = page.getByPlaceholder('견적명');
    await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
    await titleInput.fill(QUOTE_TITLE);
    await page.getByRole('button', { name: '견적요청 보내기' }).click();
    const requested = await waitForQuoteState(
      quoteId,
      '견적요청 상태',
      (state) => state.status === 'requested',
    );
    expect(requested.title).toBe(QUOTE_TITLE);
    expect(requested.setQty).toBe(3);
    expect(requested.spareQty).toBe(1);
    const quantityRows: { id: bigint; bomQty: number; orderQty: number }[] =
      await getPrisma().spBomQuoteItem.findMany({
        where: { quoteId: BigInt(quoteId), included: true },
        select: { id: true, bomQty: true, orderQty: true },
      });
    expect(quantityRows.length, '견적요청 포함 품목').toBeGreaterThan(0);
    for (const item of quantityRows) {
      expect(
        item.orderQty,
        `품목 ${String(item.id)} 세트 3+예비 1 필요수량 반영`,
      ).toBeGreaterThanOrEqual(item.bomQty * 4);
    }
    await rp.shot(customer, 'B02-bom-requested');
  }, 180_000);

  test('B03. 관리자: Case 검토 시작(requested → reviewing)', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteId}`,
      'B03-admin-requested',
      ['다음 작업 · 검토 시작', '협력사 견적요청'],
    );
    await adminView.page.getByRole('button', { name: '검토 시작', exact: true }).click();
    await waitForQuoteState(quoteId, '관리자 UI 검토 시작', (state) => state.status === 'reviewing');
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteId}`,
      'B03-admin-reviewing',
      ['검토·고객 회신', '협력사 견적요청 보내기'],
    );
  });

  test('B04. 관리자: 국내 협력사에 활성 품목 전체 RFQ 발송', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const page = adminView.page;
    await page.getByRole('button', { name: '협력사 견적요청 보내기' }).click();
    await page.getByRole('heading', { name: '협력사 견적요청' }).waitFor({ timeout: 30_000 });
    const emptySubmit = page.getByRole('button', { name: '협력사를 선택해 주세요' });
    expect(await emptySubmit.isDisabled(), '첫 RFQ에서 0곳 제출 차단').toBe(true);
    const partnerRow = page.locator('label').filter({ hasText: PARTNER_NAME }).first();
    await partnerRow.waitFor({ state: 'visible', timeout: 30_000 });
    await partnerRow.locator('input[type="checkbox"]').check();
    const responseWait = page.waitForResponse(
      (response: { request: () => { method: () => string }; url: () => string }) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-quotes/${quoteId}/rfqs`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '발송 (1곳)' }).click();
    const uiResponse = await responseWait;
    expect(uiResponse.status(), '관리자 UI RFQ 발송').toBe(200);

    const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const data: AdminRfqListData | undefined = response.json?.data;
    const row = data?.rfqs.find((entry) => entry.partnerId === num(partner.id));
    expect(row, '협력사 RFQ 행').toBeTruthy();
    if (row === undefined) throw new Error('발송 응답에 협력사 RFQ가 없습니다');
    rfqId = row.rfqId;
    expect(row.status).toBe('requested');
    ledger.push(`sp_bom_rfq #${String(rfqId)} (quote ${quoteId} → ${PARTNER_NAME})`);
    await waitForMailLog('bom_rfq_request', 'bom_quote', quoteId);
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteId}`,
      'B04-admin-rfq-sent',
      [PARTNER_NAME, '회신 대기'],
    );
    await rp.assertView(
      partnerView,
      `/app/partner/bom/rfqs/${String(rfqId)}`,
      'B04-partner-rfq-received',
      [QUOTE_TITLE, '회신 저장'],
    );
  });

  test('B05. 협력사: 품목별 가격·재고·Date Code·납기 회신', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    const detailResponse = await api(P, 'GET', `/api/partner/rfqs/${String(rfqId)}`);
    expect(detailResponse.status, JSON.stringify(detailResponse.json)).toBe(200);
    const detail: PartnerRfqDetailData | undefined = detailResponse.json?.data;
    if (detail === undefined) throw new Error('협력사 RFQ 상세 응답이 없습니다');
    expect(detail.currency).toBe('KRW');
    expect(detail.items.length, 'RFQ 활성 품목 수').toBeGreaterThanOrEqual(8);
    rfqQuoteItemIds = detail.items.map((item) => item.quoteItemId);

    partnerReplyTotal = 0;
    const items = detail.items.map((item, index) => {
      const unitPrice = 90 + index * 15;
      partnerReplyTotal += unitPrice * item.orderQty;
      return {
        quoteItemId: item.quoteItemId,
        unitPrice,
        replyQty: item.orderQty,
        moq: index % 3 === 0 ? 1 : null,
        stock: item.orderQty + 100 + index,
        dateCode: index % 2 === 0 ? '25+' : '24+',
        leadTime: index % 2 === 0 ? '재고 보유' : '5영업일',
        memo: `${item.mpn === '' ? '무품번 스펙품' : item.mpn} · ${item.manufacturerName ?? '제조사 미지정'}`,
      };
    });
    const reply = await api(P, 'PUT', `/api/partner/rfqs/${String(rfqId)}`, {
      items,
      deliveryDate: futureDate(7),
      memo: `[BOM 여정 1호 ${RUN_KEY}] 전 품목 회신`,
    });
    expect(reply.status, JSON.stringify(reply.json)).toBe(200);
    const replied: PartnerRfqDetailData | undefined = reply.json?.data;
    expect(replied?.status).toBe('quoted');
    expect(replied?.items.filter((item) => item.orderQty > 0)).toHaveLength(items.length);
    await rp.assertView(
      partnerView,
      `/app/partner/bom/rfqs/${String(rfqId)}`,
      'B05-partner-rfq-quoted',
      ['회신', 'KRW'],
    );
  });

  test('B06. 관리자: 회신 전 품목 선정 → 필요한 품목 검토 확인', async (ctx) => {
    if (quoteId === null || rfqId === null) return ctx.skip();
    const rfqsResponse = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(rfqsResponse.status, JSON.stringify(rfqsResponse.json)).toBe(200);
    const rfqData: AdminRfqListData | undefined = rfqsResponse.json?.data;
    const rfq = rfqData?.rfqs.find((entry) => entry.rfqId === rfqId);
    if (rfq === undefined) throw new Error('관리자 RFQ 현황에서 회신 문서를 찾지 못했습니다');
    expect(rfq.status).toBe('quoted');
    expect(rfq.items).toHaveLength(rfqQuoteItemIds.length);

    for (const item of rfq.items) {
      expect(item.unitPrice, `품목 ${item.quoteItemId} 회신 단가`).not.toBeNull();
      const selected = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
        kind: 'partner', // 계약이 partner|supplier 판별 union 으로 바뀌었다(08-25)
        itemId: item.quoteItemId,
        rfqItemId: item.rfqItemId,
      });
      expect(
        selected.status,
        `품목 ${item.quoteItemId} 선정: ${JSON.stringify(selected.json)}`,
      ).toBe(200);
    }

    let detailResponse = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    expect(detailResponse.status, JSON.stringify(detailResponse.json)).toBe(200);
    let detail: AdminQuoteData | undefined = detailResponse.json?.data;
    if (detail === undefined) throw new Error('관리자 BOM 상세 응답이 없습니다');
    const selectedIds = new Set(rfqQuoteItemIds);
    for (const item of detail.items.filter((entry) => selectedIds.has(entry.id))) {
      expect(item.selectionSource, `품목 ${item.id} 협력사 선정`).toBe('partner');
    }

    const pending = detail.items.filter(
      (item) => item.adminReview.required && !item.adminReview.completed,
    );
    if (pending.length > 0) {
      const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
        itemIds: pending.map((item) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: detail.updatedAt,
        reason: `[BOM 여정 1호 ${RUN_KEY}] 협력사 회신·수량 확인`,
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
    }
    detailResponse = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    detail = detailResponse.json?.data;
    expect(
      detail?.items.filter((item) => item.adminReview.required && !item.adminReview.completed),
      '회신 전 미완료 관리자 검토',
    ).toHaveLength(0);
    F(
      'B06',
      'obs',
      `협력사 회신 ${String(rfq.items.length)}개 선정·관리자 확인 ${String(pending.length)}개 완료`,
    );
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteId}`,
      'B06-admin-selected-reviewed',
      ['확인 완료', '고객 회신 확정'],
    );
  }, 180_000);

  test('B07. 관리자: 확정 견적 회신 → 변경 주소 재발송', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const before = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const beforeData: AdminQuoteData | undefined = before.json?.data;
    expect(beforeData?.customerEmail, '관리자 화면 기본 고객 이메일').toMatch(/@/);

    confirmedTotal = Math.ceil((partnerReplyTotal * 1.15 + 15_000) / 1_000) * 1_000;
    const response = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      adminMemo: `[BOM 여정 1호 ${RUN_KEY}] 회신 확정`,
      answerNote: '협력사 재고와 납기를 확인했습니다. VAT 포함 금액은 주문 단계에서 확인해 주세요.',
      confirmedShippingFee: 5_000,
      confirmedManagementFee: 10_000,
      confirmedTotal,
      sendEmail: true,
      toEmail: FIRST_REPLY_EMAIL,
    });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const completed: CompleteResponseData = response.json;
    expect(completed.data.status).toBe('answered');
    expect(completed.data.confirmedTotal).toBe(confirmedTotal);
    expect(completed.email.status, JSON.stringify(completed.email)).toBe('sent');
    expect(completed.email.toEmail).toBe(FIRST_REPLY_EMAIL);
    await waitForMail(FIRST_REPLY_EMAIL);

    const resend = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/answer-email`, {
      toEmail: RESEND_EMAIL,
    });
    expect(resend.status, JSON.stringify(resend.json)).toBe(200);
    const resendDelivery: EmailDelivery | undefined = resend.json?.data;
    expect(resendDelivery?.status, JSON.stringify(resendDelivery)).toBe('sent');
    expect(resendDelivery?.toEmail).toBe(RESEND_EMAIL);
    await waitForMail(RESEND_EMAIL);
    await waitForMailLog('bom_quote_answered', 'bom_quote', quoteId, 2);

    const state = await readQuoteState(quoteId);
    expect(state?.status, '재발송 후 업무 상태 유지').toBe('answered');
    expect(state?.confirmedTotal).toBe(confirmedTotal);
    ledger.push(`Mailpit 회신 ${FIRST_REPLY_EMAIL} + 재발송 ${RESEND_EMAIL}`);
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${quoteId}`,
      'B07-admin-answered',
      ['회신 이메일 다시 보내기', '확정 총액'],
    );
    await rp.assertView(
      customer,
      `/app/bom/${quoteId}`,
      'B07-customer-answered-estimate',
      ['확정 견적', '견적서 보기·인쇄', '주문하기'],
    );
    const customerBody = await customer.page.locator('body').textContent();
    expect(customerBody).not.toContain('AI로 산출한 가견적입니다.');
    expect(customerBody).not.toContain('정확한 가격은 담당자 확정 시 안내드립니다.');
  }, 120_000);

  test('B08. 고객: 견적서 확인 → 주문하기 → 영카트 무통장 주문', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const order = await placeOrderFromBomQuote(customer, rp, {
      quoteId,
      step: 'B08',
      prefix: 'B08',
      buyerName: 'e2eBOM고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + BOM g5_shop_cart (quote ${quoteId})`);

    const rows: CartRow[] = await getPrisma().$queryRawUnsafe(
      `SELECT ct_id AS ctId, io_id AS ioId, ct_qty AS ctQty, ct_price AS ctPrice,
              io_price AS ioPrice,
              ct_status AS ctStatus, od_id AS odId
         FROM g5_shop_cart WHERE od_id = ? AND io_id = ?`,
      odId,
      `bom-${quoteId}`,
    );
    expect(rows, 'BOM 주문 카트 1행').toHaveLength(1);
    const cart = rows[0];
    expect(cart?.ioId).toBe(`bom-${quoteId}`);
    expect(Number(cart?.ctQty ?? 0), '견적 전체 1건 수량').toBe(1);
    expect(Number(cart?.ctPrice ?? -1), 'BOM 계약행 기준가').toBe(0);
    expect(Number(cart?.ioPrice ?? 0), 'VAT 포함 주문가').toBe(
      Math.round(confirmedTotal * 1.1),
    );
    const state = await readQuoteState(quoteId);
    expect(state?.ctId, '견적↔영카트 연결').toBe(Number(cart?.ctId));
    F('B08', 'obs', `BOM 주문 생성 — od=${odId} status=${order.status} ct=${String(cart?.ctId)}`);
  }, 240_000);

  test('B09. 관리자: 입금 확인(미수금 0)', async (ctx) => {
    if (odId === null) return ctx.skip();
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json?.data?.skipped ?? [], '입금 확인 스킵').toHaveLength(0);
    const rows: OrderPaymentRow[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_status AS odStatus, od_misu AS odMisu, od_receipt_price AS odReceiptPrice
         FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(rows[0]?.odStatus).toBe('입금');
    expect(Number(rows[0]?.odMisu ?? -1)).toBe(0);
    expect(Number(rows[0]?.odReceiptPrice ?? 0)).toBeGreaterThan(0);
    await waitForMailLog('order_deposit', 'order', odId);
    await rp.assertView(
      adminView,
      '/app/admin/smartbom/orders',
      'B09-admin-payment-confirmed',
      ['주문·결제'],
    );
  });

  test('B10. 관리자 발주 → 협력사 발주 확인', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const issue = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, {
      partnerIds: [num(partner.id)],
      memo: `[BOM 여정 1호 ${RUN_KEY}] 전 품목 국내 발주`,
    });
    expect(issue.status, JSON.stringify(issue.json)).toBe(200);
    const data: PoCreateData | undefined = issue.json?.data;
    expect(data?.created).toBe(1);
    const po = data?.pos.find((entry) => entry.partnerId === num(partner.id));
    if (po === undefined) throw new Error('생성 응답에 협력사 발주서가 없습니다');
    poId = po.poId;
    expect(po.status).toBe('issued');
    expect(po.currency).toBe('KRW');
    expect(po.items).toHaveLength(rfqQuoteItemIds.length);
    expect(po.totalAmount).toBe(partnerReplyTotal);
    ledger.push(`sp_bom_po #${String(poId)} (${PARTNER_NAME}, quote ${quoteId})`);
    await waitForMailLog('bom_po_issued', 'bom_quote', quoteId);

    await rp.assertView(
      partnerView,
      `/app/partner/bom/pos/${String(poId)}`,
      'B10-partner-po-issued',
      [QUOTE_TITLE, '발주 확인'],
    );
    const confirmed = await api(P, 'POST', `/api/partner/pos/${String(poId)}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    expect(confirmed.json?.data?.status).toBe('confirmed');
    await rp.assertView(
      partnerView,
      `/app/partner/bom/pos/${String(poId)}`,
      'B10-partner-po-confirmed',
      ['발주', '확인'],
    );
  });

  test('B11. 협력사: 발송 생성 → 품목별 QR 포장 → 국내 택배 발송', async (ctx) => {
    if (poId === null) return ctx.skip();
    const created = await api(P, 'POST', '/api/partner/shipments', { poIds: [poId] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const shipment: ShipmentCreateData | undefined = created.json?.data;
    if (shipment === undefined) throw new Error('발송 생성 응답이 없습니다');
    shipmentId = shipment.shipmentId;
    expect(shipment.primaryPoId).toBe(poId);
    expect(shipment.mode).toBe('domestic');
    expect(shipment.status).toBe('preparing');
    ledger.push(`sp_bom_shipment #${String(shipmentId)} (po ${String(poId)}, domestic)`);

    const draftResponse = await api(
      P,
      'GET',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
    );
    expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
    const draft: PackingListData | undefined = draftResponse.json?.data;
    if (draft === undefined) throw new Error('선적 리스트 초안 응답이 없습니다');
    expect(draft.editable).toBe(true);
    expect(draft.items).toHaveLength(rfqQuoteItemIds.length);
    const saved = await api(P, 'PUT', `/api/partner/shipments/${String(shipmentId)}/packing-list`, {
      items: draft.items.map((item, index) => ({
        poItemId: item.poItemId,
        packages: [
          {
            packageId: null,
            quantity: item.expectedQty,
            lotNo: `LOT-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
            dateCode: index % 2 === 0 ? '25+' : '24+',
          },
        ],
      })),
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const printed = await api(
      P,
      'POST',
      `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);

    const trackingNumber = `BOM-${RUN_KEY}`;
    const advanced = await api(P, 'POST', `/api/partner/pos/${String(poId)}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber,
      trackingUrl: `https://example.test/track/${trackingNumber}`,
    });
    expect(advanced.status, JSON.stringify(advanced.json)).toBe(200);
    expect(advanced.json?.data?.shipment?.status).toBe('shipping');

    const dbShipment = await getPrisma().spBomShipment.findUnique({
      where: { id: BigInt(shipmentId) },
      include: { packingItems: { include: { packages: true } } },
    });
    expect(dbShipment?.status).toBe('shipping');
    const packingItems: DbPackingItem[] = dbShipment?.packingItems ?? [];
    expect(packingItems).toHaveLength(rfqQuoteItemIds.length);
    expect(packingItems.every((item) => item.packages.length === 1)).toBe(true);
    await waitForMailLog('bom_shipment_turn_admin', 'bom_quote', quoteId ?? '');
    await rp.assertView(
      partnerView,
      '/app/partner/bom',
      'B11-partner-domestic-shipping',
      ['배송', trackingNumber],
    );
  }, 120_000);

  test('B12. 관리자 입고 → 고객 배송·완료 → 전 역할 종점 확인', async (ctx) => {
    if (quoteId === null || poId === null || shipmentId === null || odId === null)
      return ctx.skip();
    const received = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${quoteId}/pos/${String(poId)}/shipment/receive`,
      { note: `[BOM 여정 1호 ${RUN_KEY}] 수량·외관 이상 없음` },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);
    const shipment = await getPrisma().spBomShipment.findUnique({
      where: { id: BigInt(shipmentId) },
      include: { packingItems: { include: { packages: true } } },
    });
    expect(shipment?.status).toBe('delivered');
    expect(shipment?.receivedAt).not.toBeNull();
    const receivedPackingItems: DbPackingItem[] = shipment?.packingItems ?? [];
    expect(
      receivedPackingItems
        .flatMap((item) => item.packages)
        .every((pkg) => pkg.status === 'received'),
      'QR 포장 일괄 입고 처리',
    ).toBe(true);
    await waitForMailLog('bom_shipment_received', 'bom_quote', quoteId);

    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=50');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const queueData: BomOrderQueueData | undefined = queue.json?.data;
    const order = queueData?.items.find((item) => item.odId === odId);
    const queueCase = order?.cases.find((entry) => entry.quoteId === quoteId);
    expect(queueCase?.poCount).toBe(1);
    expect(queueCase?.poReceivedCount).toBe(1);
    expect(order?.customerEmail, '배송 안내 주문 이메일').toMatch(/@/);
    expect(order?.recipientName.trim(), '받는 분 표시').not.toBe('');
    expect(order?.recipientPhone.trim(), '받는 분 연락처 표시').not.toBe('');
    expect(order?.recipientAddress.trim(), '배송지 표시').not.toBe('');
    await rp.assertView(
      adminView,
      '/app/admin/smartbom/logistics',
      'B12-admin-received-to-ship',
      [odId, order?.recipientName ?? '', order?.customerEmail ?? ''],
    );

    const page = adminView.page;
    const orderRow = page.locator('tr').filter({ hasText: odId }).first();
    await orderRow.getByRole('button', { name: '배송 처리', exact: true }).click();
    await page.getByRole('heading', { name: `배송 처리 — ${odId}` }).waitFor({ timeout: 30_000 });
    expect(await page.getByLabel('배송 안내 이메일 발송').isChecked()).toBe(true);
    await page.getByLabel('택배사').fill('우체국택배');
    await page.getByLabel('송장번호').fill(`CUSTOMER-${RUN_KEY}`);
    const shippingWait = page.waitForResponse(
      (response: { request: () => { method: () => string }; url: () => string }) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/admin/orders/${odId}/force-status`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '배송 처리 · 메일 발송', exact: true }).click();
    const shipping = await shippingWait;
    expect(shipping.status(), '관리자 UI 고객 배송 처리').toBe(200);
    const shippingBody: unknown = await shipping.json();
    expect(objectField(objectField(shippingBody, 'data'), 'notify')).toMatchObject({ mail: 'sent' });
    await waitForMailLog('order_delivery', 'order', odId);
    await page.waitForFunction(
      (email: string) => document.body.innerText.includes(`${email}로 배송 안내 이메일을 발송했습니다.`),
      order?.customerEmail ?? '',
      { timeout: 30_000 },
    );

    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const rows: OrderPaymentRow[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_status AS odStatus, od_misu AS odMisu, od_receipt_price AS odReceiptPrice
         FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(rows[0]?.odStatus).toBe('완료');
    expect(Number(rows[0]?.odMisu ?? -1)).toBe(0);
    expect((await readQuoteState(quoteId))?.status, '견적 회신 상태 보존').toBe('answered');

    await rp.assertView(
      customer,
      `/shop/orderinquiryview.php?od_id=${odId}`,
      'B12-customer-order-complete',
      [odId, '완료'],
    );
    await rp.assertView(
      partnerView,
      '/app/partner/bom/shipments/done',
      'B12-partner-shipment-done',
      ['완료된 발송', `발송 #${String(shipmentId)}`],
    );
    const expectedMailKinds = [
      'bom_rfq_request',
      'bom_quote_answered',
      'order_deposit',
      'bom_po_issued',
      'bom_shipment_turn_admin',
      'bom_shipment_received',
      'order_delivery',
    ];
    const mailLogs: { kind: string; status: string }[] = await getPrisma().spMailLog.findMany({
      where: {
        OR: [
          { refType: 'bom_quote', refId: quoteId },
          { refType: 'order', refId: odId },
        ],
      },
      select: { kind: true, status: true },
    });
    const loggedKinds = new Set(mailLogs.map((entry) => entry.kind));
    for (const kind of expectedMailKinds) {
      expect(loggedKinds.has(kind), `${kind} 감사 로그`).toBe(true);
    }
    expect(
      mailLogs.filter((entry) => entry.status === 'failed'),
      '메일 감사 로그 실패',
    ).toHaveLength(0);
    expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
    expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
    expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
    expect(partnerView.pageErrors, '파트너 pageerror').toHaveLength(0);
    F(
      'B12',
      'obs',
      `BOM 완주 — quote=${quoteId} od=${odId} rfq=${String(rfqId)} po=${String(poId)} shipment=${String(shipmentId)}`,
    );
  }, 120_000);
});
