// Smart BOM 완주 여정 3호 — 고객 회신 뒤 잘못된 원본 부품을 교체하고 누락 부품을
// 수동 추가한 다음, 기존 RFQ에서 재회신받아 수정 견적·주문·발주·배송까지 완주한다.
//
// 1·2호의 정상 조달 조합과 달리 "이미 진행된 업무를 안전하게 되돌리는가"를 고정한다.
// - 원본 BOM 행은 제거하지 못하고, 관리자 수동 추가 행만 제거할 수 있다.
// - 강제 교체는 같은 RFQ ID·매직링크를 유지하면서 해당 품목의 옛 회신만 무효화한다.
// - 교체·추가 뒤 과거 관리자 확인 지문은 재사용하지 않고 고객 재회신을 막는다.
// - 수정 전 고객 메일·선택 이력은 보존하되 새 주문·PO에는 수정된 스냅샷만 들어간다.
//
// 생성한 거래 문서는 자동 정리하지 않는다. 실행 결과의 생성물 대장을 보고 수동 정리한다.
// 실행: pnpm -F e2e journey:bom:3
// 사전 조건: nginx·API(3333)·웹(5173)·sp-engine(8400)·Mailpit + 고객 자격.
import { join } from 'node:path';
import type { Locator } from 'playwright-core';
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
  signJwt,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_CSV = join(monoRoot, 'e2e', 'fixtures', 'bom-journey-3-revision.csv');
const PARTNER_NAME = '협력1';
const RUN_KEY = String(Date.now());
const QUOTE_TITLE = `[BOM 여정 3호] 회신 후 부품 정정 ${RUN_KEY}`;
const FIRST_REPLY_EMAIL = `bom-revision-before-${RUN_KEY}@example.test`;
const REVISED_REPLY_EMAIL = `bom-revision-after-${RUN_KEY}@example.test`;

const OLD_MPN = 'GRM155R61H104KE14D';
const REPLACEMENT_MPN = 'GRM155R71A104KA01D';
const STABLE_MPN = 'LTST-C190KGKT';
const ADD_MPN = 'B2B-EH-A';
const REMOVE_MPN = 'GRM155C81A225ME44D';

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
  answeredAt: Date | null;
  answerNote: string | null;
}

interface AdminQuoteItem {
  id: string;
  included: boolean;
  mpn: string;
  manufacturerName: string | null;
  partId: string | null;
  orderQty: number;
  lineTotalKrw: number | null;
  selectionSource: string;
  sourceSheetIndex: number | null;
  manualEntry?: boolean;
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
  confirmedDeliveryDate: string | null;
  answerNote: string | null;
  items: AdminQuoteItem[];
}

interface PartnerRfqLine {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  orderQty: number;
  reply: { unitPrice: number | null } | null;
}

interface PartnerRfqDetailData {
  rfqId: number;
  status: string;
  currency: string;
  respondedAt: string | null;
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
  respondedAt: string | null;
  magicToken: string | null;
  requestedItemIds: string[] | null;
  items: AdminRfqItem[];
}

interface AdminRfqListData {
  rfqs: AdminRfqRow[];
}

interface EmailDelivery {
  requested: boolean;
  status: string;
  toEmail: string | null;
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

interface CartRow {
  ctId: bigint | number;
  ioPrice: number;
  odId: string;
}

interface OrderPaymentRow {
  odStatus: string;
  odMisu: bigint | number;
  deliveryCompany: string;
  invoiceNo: string;
  invoiceTime: string;
}

interface MailpitSearchData {
  total?: number;
  messages?: unknown[];
}

interface CatalogFixture {
  partId: string;
  supplier: string;
  supplierSku: string;
}

interface DbQuoteItemRow {
  id: bigint;
  mpn: string;
  sourceSheetIndex: number | null;
  analysisComponentId: bigint | null;
}

interface DbPoItemRow {
  quoteItemId: bigint;
  mpn: string;
  qty: number;
  lineTotal: number;
}

interface DbSelectionEventRow {
  previousMpn: string | null;
  selectedMpn: string | null;
  reasonCodes: unknown;
}

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const capabilityList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const KST_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const KST_DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const futureDate = (days: number): string =>
  KST_DATE.format(new Date(Date.now() + days * 24 * 60 * 60 * 1_000));

const g5KstDateTime = (now = new Date()): string => KST_DATE_TIME.format(now);

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
      answeredAt: true,
      answerNote: true,
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
  const lastLabel = last === null
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
  throw new Error(`Mailpit에서 ${recipient} 수신 메일을 찾지 못했습니다(현재 ${String(count)}건)`);
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

async function catalogFixture(mpn: string): Promise<CatalogFixture> {
  const part = await getPrisma().spPart.findFirst({
    where: {
      mpn,
      indexedAt: { not: null },
      offers: {
        some: {
          supplier: { not: 'samplepcb' },
          priceBreaks: { some: { price: { gt: 0 } } },
        },
      },
    },
    include: {
      offers: {
        where: {
          supplier: { not: 'samplepcb' },
          priceBreaks: { some: { price: { gt: 0 } } },
        },
        orderBy: { fetchedAt: 'desc' },
      },
    },
  });
  const offer = part?.offers[0];
  if (part === null || offer === undefined) {
    throw new Error(`${mpn} 색인 부품과 가격 구매 조건이 없습니다`);
  }
  return {
    partId: String(part.id),
    supplier: offer.supplier,
    supplierSku: offer.supplierSku,
  };
}

async function loadAdminDetail(adminToken: string, quoteId: string): Promise<AdminQuoteData> {
  const response = await api(adminToken, 'GET', `/api/admin/bom-quotes/${quoteId}`);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  const data: AdminQuoteData | undefined = response.json?.data;
  if (data === undefined) throw new Error(`관리자 BOM 상세 #${quoteId} 응답이 없습니다`);
  return data;
}

async function loadRfqs(adminToken: string, quoteId: string): Promise<AdminRfqRow[]> {
  const response = await api(adminToken, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  const data: AdminRfqListData | undefined = response.json?.data;
  if (data === undefined) throw new Error(`관리자 RFQ #${quoteId} 응답이 없습니다`);
  return data.rfqs;
}

async function chooseCatalogPart(
  dialog: Locator,
  mpn: string,
  actionName: RegExp,
): Promise<void> {
  const input = dialog.getByPlaceholder(
    '품번·스펙·패키지 자유 검색 (예: GRM155 / 4k7 0402 / 100nF 16V)',
  );
  await input.fill(mpn);
  await dialog.getByRole('button', { name: '검색', exact: true }).click();
  const result = dialog.locator('button').filter({ hasText: mpn }).filter({ hasText: '구매 조건 보기' }).first();
  await result.waitFor({ state: 'visible', timeout: 180_000 });
  await result.click({ timeout: 180_000 });
  const action = dialog.getByRole('button', { name: actionName }).last();
  await action.waitFor({ state: 'visible', timeout: 180_000 });
  await action.click({ timeout: 180_000 });
}

async function forceConfirm(dialog: Locator, buttonName: string): Promise<void> {
  const applyButton = dialog.getByRole('button', { name: buttonName, exact: true });
  expect(await applyButton.isDisabled(), `${buttonName} 영향 확인 전 잠금`).toBe(true);
  await dialog.getByRole('checkbox').check();
  expect(await applyButton.isEnabled(), `${buttonName} 영향 확인 후 활성`).toBe(true);
  await applyButton.click();
}

describe.skipIf(!RUN || !JOURNEY)(
  'BOM 여정 3호 — 고객 회신 후 부품 정정·재회신·수정 주문 완주',
  () => {
    const rp = createJourneyReport(
      'findings-bom-revision',
      'BOM 여정 3호 회신 후 품목 정정 탐색 주행 리포트',
    );
    const { F, ledger } = rp;

    let customer: PhpLoginResult;
    let adminView: E2eSession;
    let partnerView: E2eSession;
    let partner: PartnerFixture;
    let A = '';
    let P = '';
    let addCatalog: CatalogFixture;

    let quoteId: string | null = null;
    let rfqId: number | null = null;
    let originalItemId: string | null = null;
    let replacementItemId: string | null = null;
    let addedItemId: string | null = null;
    let removedItemId: string | null = null;
    let poId: number | null = null;
    let shipmentId: number | null = null;
    let odId: string | null = null;
    let firstConfirmedTotal = 0;
    let revisedConfirmedTotal = 0;
    let revisedPartnerTotal = 0;
    let firstMailLogCount = 0;
    let staleVersionBeforeReplacement = '';

    beforeAll(async () => {
      await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
      await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
      await mustReach(`${BOM_ENGINE_URL}/health`, 'samplepcb-parts-engine ./run.sh');
      await mailpitList(1);

      partner = await getPartner(PARTNER_NAME);
      if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정이 없습니다`);
      expect(partner.country, `${PARTNER_NAME} 국내 선적 전제`).toBe('KR');
      expect(capabilityList(partner.capabilities)).toContain('bom_rfq');

      for (const mpn of [OLD_MPN, REPLACEMENT_MPN, STABLE_MPN, ADD_MPN, REMOVE_MPN]) {
        await catalogFixture(mpn);
      }
      addCatalog = await catalogFixture(ADD_MPN);

      const creds = requireCustomerCreds();
      // 공급사 최신 확인은 회원별 일일 20회 정책을 실제로 거친다. 반복 주행끼리 서로를
      // 오염시키지 않도록 로컬 E2E 전용 계정의 오늘 사용량만 초기화한다.
      const kstDayKey = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
      await getPrisma().spBomSupplierDailyUsage.updateMany({
        where: { mbId: { in: ['e2e-admin', creds.id] }, dayKey: kstDayKey },
        data: { searchCount: 0 },
      });
      customer = await newPhpSession(creds);
      rp.watchHttp(customer, '고객');
      adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
      rp.watchHttp(adminView, '관리자');
      partnerView = await newSession(
        { mbId: partner.mbId },
        { partnerModule: 'bom' },
      );
      rp.watchHttp(partnerView, '협력사');

      A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7200 });
      P = signJwt({ mbId: partner.mbId, ttlSec: 7200 });
    }, 180_000);

    afterAll(async () => {
      rp.write({ 고객: customer, 관리자: adminView, 협력사: partnerView });
      await closeBrowser();
      await disconnectPrisma();
    }, 60_000);

    test('D01. 고객: 정정 대상이 있는 원본 BOM 업로드·견적요청', async () => {
      const page = customer.page;
      await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
      await fileInput.setInputFiles(FIXTURE_CSV);
      await page.waitForURL((url) => /^\/app\/bom\/\d+$/.test(url.pathname), { timeout: 60_000 });

      const match = /^\/app\/bom\/(\d+)$/.exec(new URL(page.url()).pathname);
      if (match?.[1] === undefined) throw new Error(`업로드 뒤 quoteId를 찾지 못했습니다: ${page.url()}`);
      quoteId = match[1];
      ledger.push(`sp_bom_quote #${quoteId} (${customer.mbId}, ${QUOTE_TITLE})`);

      await waitForQuoteState(
        quoteId,
        'BOM 3호 분석·공급사 확인',
        (state) => state.buildStatus === 'ready' && state.enrichStatus !== 'searching',
        600_000,
      );
      const quote: { items: DbQuoteItemRow[] } | null = await getPrisma().spBomQuote.findUnique({
        where: { id: BigInt(quoteId) },
        include: { items: true },
      });
      expect(quote?.items, '3호 원본 견적 품목').toHaveLength(3);
      const original = quote?.items.find((item) => item.mpn === OLD_MPN);
      expect(original, `${OLD_MPN} 원본 행`).toBeTruthy();
      expect(original?.sourceSheetIndex, '원본 시트 연결').not.toBeNull();
      expect(original?.analysisComponentId, '분석 컴포넌트 연결').not.toBeNull();
      originalItemId = original === undefined ? null : String(original.id);

      const setInput = page.locator('input[aria-label="세트 수량"]');
      const spareInput = page.locator('input[aria-label="예비 수량"]');
      await setInput.fill('2');
      await setInput.press('Tab');
      await spareInput.fill('1');
      await spareInput.press('Tab');
      await waitForQuoteState(
        quoteId,
        '3호 세트·예비 수량 저장',
        (state) => state.setQty === 2 && state.spareQty === 1,
      );

      await page.getByRole('button', { name: '견적요청', exact: true }).click();
      await page.getByPlaceholder('견적명').fill(QUOTE_TITLE);
      await page.getByRole('button', { name: '견적요청 보내기' }).click();
      await waitForQuoteState(quoteId, '3호 견적요청', (state) => state.status === 'requested');
      await rp.shot(customer, 'D01-customer-revision-bom-requested');
    }, 660_000);

    test('D02. 관리자: 검토 시작·전체 범위 RFQ 발송', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'D02-admin-requested',
        ['다음 작업 · 검토 시작', OLD_MPN, STABLE_MPN],
      );
      const page = adminView.page;
      await page.getByRole('button', { name: '검토 시작', exact: true }).click();
      await waitForQuoteState(quoteId, '3호 관리자 검토 시작', (state) => state.status === 'reviewing');

      await page.getByRole('button', { name: '협력사 견적요청 보내기' }).click();
      const sendDialog = page.getByRole('dialog', { name: '협력사 견적요청' });
      await sendDialog.waitFor({ state: 'visible', timeout: 30_000 });
      const partnerRow = sendDialog.locator('label').filter({ hasText: PARTNER_NAME }).first();
      await partnerRow.locator('input[type="checkbox"]').check();
      const responseWait = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && response.url().endsWith(`/api/admin/bom-quotes/${quoteId}/rfqs`),
        { timeout: 30_000 },
      );
      await sendDialog.getByRole('button', { name: '발송 (1곳)' }).click();
      expect((await responseWait).status(), '3호 전체 RFQ 발송').toBe(200);

      const rfqs = await loadRfqs(A, quoteId);
      const rfq = rfqs.find((entry) => entry.partnerId === num(partner.id));
      if (rfq === undefined) throw new Error('3호 협력사 RFQ가 없습니다');
      rfqId = rfq.rfqId;
      expect(rfq.status).toBe('requested');
      expect(rfq.requestedItemIds, '전체 범위 RFQ').toBeNull();
      expect(rfq.magicToken, '재사용할 RFQ 매직링크').not.toBeNull();
      ledger.push(`sp_bom_rfq #${String(rfqId)} (quote ${quoteId} → ${PARTNER_NAME})`);
      await waitForMailLog('bom_rfq_request', 'bom_quote', quoteId);
      await rp.assertView(
        partnerView,
        `/app/partner/bom/rfqs/${String(rfqId)}`,
        'D02-partner-rfq-received',
        [QUOTE_TITLE, '회신 저장'],
      );
    }, 120_000);

    test('D03. 협력사 1차 회신·관리자 선정·고객 최초 회신', async (ctx) => {
      if (quoteId === null || rfqId === null) return ctx.skip();
      const partnerDetailResponse = await api(P, 'GET', `/api/partner/rfqs/${String(rfqId)}`);
      expect(partnerDetailResponse.status, JSON.stringify(partnerDetailResponse.json)).toBe(200);
      const partnerDetail: PartnerRfqDetailData | undefined = partnerDetailResponse.json?.data;
      if (partnerDetail === undefined) throw new Error('3호 협력사 RFQ 상세가 없습니다');
      expect(partnerDetail.items).toHaveLength(3);
      expect(partnerDetail.items.map((item) => item.mpn)).toContain(OLD_MPN);

      let firstPartnerTotal = 0;
      const firstReply = await api(P, 'PUT', `/api/partner/rfqs/${String(rfqId)}`, {
        items: partnerDetail.items.map((item, index) => {
          const unitPrice = 300 + index * 70;
          firstPartnerTotal += unitPrice * item.orderQty;
          return {
            quoteItemId: item.quoteItemId,
            unitPrice,
            replyQty: item.orderQty,
            moq: 1,
            stock: item.orderQty + 500,
            dateCode: '25+',
            leadTime: '재고 보유',
            memo: `[3호 최초] ${item.mpn}`,
          };
        }),
        deliveryDate: futureDate(5),
        memo: `[BOM 여정 3호 ${RUN_KEY}] 최초 회신`,
      });
      expect(firstReply.status, JSON.stringify(firstReply.json)).toBe(200);

      const firstRfq = (await loadRfqs(A, quoteId)).find((entry) => entry.rfqId === rfqId);
      if (firstRfq === undefined) throw new Error('3호 최초 회신 RFQ를 찾지 못했습니다');
      expect(firstRfq.status).toBe('quoted');
      expect(firstRfq.items).toHaveLength(3);
      for (const item of firstRfq.items) {
        const selected = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
          itemId: item.quoteItemId,
          rfqItemId: item.rfqItemId,
        });
        expect(selected.status, JSON.stringify(selected.json)).toBe(200);
      }

      let detail = await loadAdminDetail(A, quoteId);
      const pending = detail.items.filter((item) => item.adminReview.required && !item.adminReview.completed);
      if (pending.length > 0) {
        const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
          itemIds: pending.map((item) => item.id),
          completed: true,
          expectedQuoteUpdatedAt: detail.updatedAt,
          reason: `[BOM 여정 3호 ${RUN_KEY}] 최초 회신 검토`,
        });
        expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      }
      detail = await loadAdminDetail(A, quoteId);
      expect(detail.items.filter((item) => item.adminReview.required && !item.adminReview.completed)).toHaveLength(0);

      firstConfirmedTotal = Math.ceil((firstPartnerTotal + 9_000) / 1_000) * 1_000;
      const completed = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
        adminMemo: `[BOM 여정 3호 ${RUN_KEY}] 최초 확정`,
        answerNote: '최초 회신입니다. 주문 전 품목을 다시 확인해 주세요.',
        confirmedShippingFee: 4_000,
        confirmedManagementFee: 5_000,
        confirmedTotal: firstConfirmedTotal,
        sendEmail: true,
        toEmail: FIRST_REPLY_EMAIL,
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);
      const completedData: CompleteResponseData = completed.json;
      expect(completedData.data.status).toBe('answered');
      expect(completedData.email.status).toBe('sent');
      await waitForMail(FIRST_REPLY_EMAIL);
      await waitForMailLog('bom_quote_answered', 'bom_quote', quoteId);
      firstMailLogCount = await getPrisma().spMailLog.count({
        where: { kind: 'bom_quote_answered', refType: 'bom_quote', refId: quoteId },
      });
      staleVersionBeforeReplacement = completedData.data.updatedAt;

      const closedRfq = (await loadRfqs(A, quoteId)).find((entry) => entry.rfqId === rfqId);
      expect(closedRfq?.status, '고객 회신 뒤 RFQ 마감').toBe('closed');
      await rp.assertView(
        customer,
        `/app/bom/${quoteId}`,
        'D03-customer-first-answer',
        ['확정 견적', '견적서 보기·인쇄', '주문하기'],
      );
    }, 180_000);

    test('D04. 서버 가드: 원본 행 제거·오래된 화면 변경 차단', async (ctx) => {
      if (quoteId === null || originalItemId === null) return ctx.skip();
      const detail = await loadAdminDetail(A, quoteId);
      const originalRemoval = await api(
        A,
        'DELETE',
        `/api/admin/bom-quotes/${quoteId}/items/${originalItemId}`,
        { expectedQuoteUpdatedAt: detail.updatedAt, force: true },
      );
      expect(originalRemoval.status, JSON.stringify(originalRemoval.json)).toBe(409);
      expect(originalRemoval.json?.error).toBe('ORIGINAL_QUOTE_ITEM');
      expect((await loadAdminDetail(A, quoteId)).items.some((item) => item.id === originalItemId)).toBe(true);
      F('D04', 'obs', '업로드 원본 행 DELETE는 force=true여도 ORIGINAL_QUOTE_ITEM 409');
    });

    test('D05. 관리자 UI: 회신 완료 원본 품목 강제 교체', async (ctx) => {
      if (quoteId === null || originalItemId === null || rfqId === null) return ctx.skip();
      const page = adminView.page;
      await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, { waitUntil: 'domcontentloaded' });
      const oldRow = page.locator('tbody tr').filter({ hasText: OLD_MPN }).first();
      await oldRow.waitFor({ state: 'visible', timeout: 30_000 });
      await oldRow.getByRole('button', { name: '부품 검색·변경', exact: true }).click();

      const drawer = page.getByRole('dialog', { name: '부품 선택' });
      await drawer.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await drawer.textContent()).toContain('관리자 강제 변경으로 적용할 수 있습니다.');
      await chooseCatalogPart(drawer, REPLACEMENT_MPN, /선택한 구매 조건으로 부품 변경/);

      const confirmDialog = page.getByRole('dialog', { name: '이 부품으로 변경할까요?' });
      await confirmDialog.waitFor({ state: 'visible', timeout: 30_000 });
      const confirmText = await confirmDialog.textContent();
      expect(confirmText).toContain(OLD_MPN);
      expect(confirmText).toContain(REPLACEMENT_MPN);
      expect(confirmText).toContain('같은 링크에서 새 부품으로 바뀌며');
      const mutationWait = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && response.url().endsWith(`/api/admin/bom-quotes/${quoteId}/items/${originalItemId}/selection`),
        { timeout: 60_000 },
      );
      await forceConfirm(confirmDialog, '강제 변경 적용');
      expect((await mutationWait).status(), '관리자 UI 강제 교체').toBe(200);

      const detail = await loadAdminDetail(A, quoteId);
      expect(detail.status, '강제 변경 뒤 검토 중 회귀').toBe('reviewing');
      expect(detail.confirmedTotal, '기존 확정금액 초기화').toBeNull();
      expect(detail.answerNote, '기존 고객 회신 문구 해제').toBeNull();
      const replacement = detail.items.find((item) => item.id === originalItemId);
      if (replacement === undefined) throw new Error('교체 뒤 안정 품목 ID가 사라졌습니다');
      replacementItemId = replacement.id;
      expect(replacement.mpn).toBe(REPLACEMENT_MPN);
      expect(replacement.selectionSource).toBe('admin');
      expect(replacement.sourceSheetIndex, '교체 뒤 원본 위치 보존').not.toBeNull();
      expect(replacement.adminReview.stale, '이전 확인 지문 무효화').toBe(true);

      const reopened = (await loadRfqs(A, quoteId)).find((entry) => entry.rfqId === rfqId);
      expect(reopened?.status).toBe('requested');
      expect(reopened?.respondedAt).toBeNull();
      expect(reopened?.items.some((item) => item.quoteItemId === originalItemId), '옛 회신 행 제거').toBe(false);
      expect(reopened?.items.length, '영향 없는 기존 회신 보존').toBe(2);

      const mailCount = await getPrisma().spMailLog.count({
        where: { kind: 'bom_quote_answered', refType: 'bom_quote', refId: quoteId },
      });
      expect(mailCount, '최초 고객 메일 감사 원장 보존').toBe(firstMailLogCount);

      const staleAdd = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/items`, {
        partId: addCatalog.partId,
        offer: { supplier: addCatalog.supplier, supplierSku: addCatalog.supplierSku },
        bomQty: 1,
        expectedQuoteUpdatedAt: staleVersionBeforeReplacement,
        force: true,
      });
      expect(staleAdd.status, JSON.stringify(staleAdd.json)).toBe(409);
      expect(staleAdd.json?.error).toBe('STALE_QUOTE');
      expect((await loadAdminDetail(A, quoteId)).items.some((item) => item.mpn === ADD_MPN)).toBe(false);

      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'D05-admin-replacement-reopened',
        [REPLACEMENT_MPN, '재확인 필요', '회신 대기'],
      );
    }, 300_000);

    test('D06. 관리자 UI: 누락 부품 추가·실수 수동 행 제거', async (ctx) => {
      if (quoteId === null) return ctx.skip();
      const page = adminView.page;

      async function addPart(mpn: string, bomQty: number): Promise<void> {
        await page.getByRole('button', { name: '＋ 부품 추가', exact: true }).click();
        const addDialog = page.getByRole('dialog', { name: '견적에 부품 추가' });
        await addDialog.waitFor({ state: 'visible', timeout: 30_000 });
        await addDialog.locator('input[type="number"]').fill(String(bomQty));
        await chooseCatalogPart(addDialog, mpn, /선택한 구매 조건으로 부품 추가/);

        const confirmDialog = page.getByRole('dialog', { name: '이 부품을 견적에 추가할까요?' });
        await confirmDialog.waitFor({ state: 'visible', timeout: 30_000 });
        expect(await confirmDialog.textContent()).toContain(mpn);
        expect(await confirmDialog.textContent()).toContain('전체 품목 RFQ 1건은 새 부품을 자동 포함');
        const responseWait = page.waitForResponse(
          (response) => response.request().method() === 'POST'
            && response.url().endsWith(`/api/admin/bom-quotes/${quoteId}/items`),
          { timeout: 60_000 },
        );
        await forceConfirm(confirmDialog, '강제 추가 적용');
        expect((await responseWait).status(), `${mpn} 관리자 UI 강제 추가`).toBe(200);
        await page.getByText(mpn, { exact: true }).last().waitFor({ state: 'visible', timeout: 30_000 });
      }

      await addPart(ADD_MPN, 2);
      let detail = await loadAdminDetail(A, quoteId);
      const added = detail.items.find((item) => item.mpn === ADD_MPN);
      if (added === undefined) throw new Error(`${ADD_MPN} 수동 추가 행이 없습니다`);
      addedItemId = added.id;
      expect(added.manualEntry).toBe(true);
      expect(added.sourceSheetIndex).toBeNull();
      expect(added.selectionSource).toBe('admin');

      await addPart(REMOVE_MPN, 1);
      detail = await loadAdminDetail(A, quoteId);
      const toRemove = detail.items.find((item) => item.mpn === REMOVE_MPN);
      if (toRemove === undefined) throw new Error(`${REMOVE_MPN} 제거 대상 수동 행이 없습니다`);
      removedItemId = toRemove.id;
      const removeRow = page.locator('tbody tr').filter({ hasText: REMOVE_MPN }).first();
      await removeRow.getByRole('button', { name: '수동 행 제거', exact: true }).click();
      const removeDialog = page.getByRole('dialog', { name: '수동 추가 부품을 제거할까요?' });
      await removeDialog.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await removeDialog.textContent()).toContain(REMOVE_MPN);
      const removeWait = page.waitForResponse(
        (response) => response.request().method() === 'DELETE'
          && response.url().endsWith(`/api/admin/bom-quotes/${quoteId}/items/${toRemove.id}`),
        { timeout: 60_000 },
      );
      await forceConfirm(removeDialog, '강제 제거 적용');
      expect((await removeWait).status(), '수동 행 강제 제거').toBe(200);

      detail = await loadAdminDetail(A, quoteId);
      expect(detail.items.some((item) => item.id === toRemove.id)).toBe(false);
      expect(detail.items.some((item) => item.mpn === ADD_MPN)).toBe(true);
      const addEvent = await getPrisma().spBomQuoteSelectionEvent.findFirst({
        where: { quoteId: BigInt(quoteId), quoteItemId: BigInt(added.id) },
        orderBy: { id: 'desc' },
      });
      expect(Array.isArray(addEvent?.reasonCodes) ? addEvent.reasonCodes : []).toContain('admin-add');
      await rp.shot(adminView, 'D06-admin-manual-add-remove');
    }, 420_000);

    test('D07. 재검토 게이트·동일 RFQ 재회신·수정 견적 확정', async (ctx) => {
      if (
        quoteId === null
        || rfqId === null
        || replacementItemId === null
        || addedItemId === null
      ) return ctx.skip();

      const beforeReview = await loadAdminDetail(A, quoteId);
      const blocked = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
        answerNote: '검토를 우회하면 안 됩니다.',
        confirmedTotal: firstConfirmedTotal,
        sendEmail: false,
      });
      expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
      expect(blocked.json?.error).toBe('BOM_ITEM_REVIEW_REQUIRED');
      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'D07-admin-review-blocked',
        ['확인 필요', '고객 회신 확정'],
      );
      const completionButton = adminView.page.getByRole('button', { name: '고객 회신 확정' });
      expect(await completionButton.isDisabled(), '미검토 품목이 있으면 고객 회신 확정 비활성')
        .toBe(true);

      const partnerResponse = await api(P, 'GET', `/api/partner/rfqs/${String(rfqId)}`);
      expect(partnerResponse.status, JSON.stringify(partnerResponse.json)).toBe(200);
      const partnerDetail: PartnerRfqDetailData | undefined = partnerResponse.json?.data;
      if (partnerDetail === undefined) throw new Error('3호 재회신 RFQ 상세가 없습니다');
      expect(partnerDetail.rfqId, '동일 RFQ ID 재사용').toBe(rfqId);
      expect(partnerDetail.status).toBe('requested');
      const currentMpns = partnerDetail.items.map((item) => item.mpn);
      expect(currentMpns).toContain(REPLACEMENT_MPN);
      expect(currentMpns).toContain(ADD_MPN);
      expect(currentMpns).not.toContain(OLD_MPN);
      expect(currentMpns).not.toContain(REMOVE_MPN);
      expect(partnerDetail.items).toHaveLength(4);

      revisedPartnerTotal = 0;
      const revisedDeliveryDate = futureDate(4);
      const revisedReply = await api(P, 'PUT', `/api/partner/rfqs/${String(rfqId)}`, {
        items: partnerDetail.items.map((item, index) => {
          const unitPrice = 520 + index * 90;
          revisedPartnerTotal += unitPrice * item.orderQty;
          return {
            quoteItemId: item.quoteItemId,
            unitPrice,
            replyQty: item.orderQty,
            moq: 1,
            stock: item.orderQty + 1_000,
            dateCode: '26+',
            leadTime: '3영업일',
            memo: `[3호 수정] ${item.mpn}`,
          };
        }),
        deliveryDate: revisedDeliveryDate,
        memo: `[BOM 여정 3호 ${RUN_KEY}] 변경 품목 재회신`,
      });
      expect(revisedReply.status, JSON.stringify(revisedReply.json)).toBe(200);

      const quoted = (await loadRfqs(A, quoteId)).find((entry) => entry.rfqId === rfqId);
      if (quoted === undefined) throw new Error('수정 회신 RFQ를 찾지 못했습니다');
      expect(quoted.status).toBe('quoted');
      expect(quoted.items).toHaveLength(4);
      for (const item of quoted.items) {
        const selected = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, {
          itemId: item.quoteItemId,
          rfqItemId: item.rfqItemId,
        });
        expect(selected.status, JSON.stringify(selected.json)).toBe(200);
      }

      let detail = await loadAdminDetail(A, quoteId);
      const pending = detail.items.filter((item) => item.adminReview.required && !item.adminReview.completed);
      expect(pending.map((item) => item.id), '엔진 검토 신호가 있는 변경 행 재검토 대상')
        .toContain(replacementItemId);
      expect(
        detail.items.find((item) => item.id === addedItemId)?.adminReview,
        '관리자가 직접 추가·선정한 정상 행은 중복 확인을 요구하지 않음',
      ).toMatchObject({ required: false, completed: true, stale: false });
      const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
        itemIds: pending.map((item) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: detail.updatedAt,
        reason: `[BOM 여정 3호 ${RUN_KEY}] 변경 품목 재검토`,
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      detail = await loadAdminDetail(A, quoteId);
      expect(detail.items.filter((item) => item.adminReview.required && !item.adminReview.completed)).toHaveLength(0);

      revisedConfirmedTotal = Math.ceil((revisedPartnerTotal + 12_000) / 1_000) * 1_000;
      const completed = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
        adminMemo: `[BOM 여정 3호 ${RUN_KEY}] 수정 견적 확정`,
        answerNote: `${OLD_MPN}을 ${REPLACEMENT_MPN}으로 정정하고 ${ADD_MPN}을 추가했습니다.`,
        confirmedShippingFee: 5_000,
        confirmedManagementFee: 7_000,
        confirmedTotal: revisedConfirmedTotal,
        sendEmail: true,
        toEmail: REVISED_REPLY_EMAIL,
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);
      const completedData: CompleteResponseData = completed.json;
      expect(completedData.data.status).toBe('answered');
      expect(completedData.data.confirmedTotal).toBe(revisedConfirmedTotal);
      expect(
        completedData.data.confirmedDeliveryDate === null
          ? null
          : KST_DATE.format(new Date(completedData.data.confirmedDeliveryDate)),
      ).toBe(revisedDeliveryDate);
      expect(completedData.email.status).toBe('sent');
      await waitForMail(REVISED_REPLY_EMAIL);
      await waitForMailLog('bom_quote_answered', 'bom_quote', quoteId, firstMailLogCount + 1);

      const selectionEvents: DbSelectionEventRow[] = await getPrisma().spBomQuoteSelectionEvent.findMany({
        where: { quoteId: BigInt(quoteId), quoteItemId: BigInt(replacementItemId) },
        orderBy: { id: 'desc' },
      });
      const selectionEvent = selectionEvents.find((event) =>
        Array.isArray(event.reasonCodes) && event.reasonCodes.includes('admin-force-choice'));
      expect(selectionEvent, '관리자 강제 교체 감사 이벤트').toBeTruthy();
      expect(selectionEvent?.previousMpn).toBe(OLD_MPN);
      expect(selectionEvent?.selectedMpn).toBe(REPLACEMENT_MPN);
      expect(Array.isArray(selectionEvent?.reasonCodes) ? selectionEvent.reasonCodes : []).toContain('admin-force-choice');

      await rp.assertView(
        customer,
        `/app/bom/${quoteId}`,
        'D07-customer-revised-answer',
        [REPLACEMENT_MPN, ADD_MPN, '확정 견적', revisedDeliveryDate, '주문하기'],
      );
      expect(beforeReview.items.some((item) => item.id === replacementItemId && item.adminReview.stale)).toBe(true);
    }, 240_000);

    test('D08. 고객 수정 주문·입금·PO 스냅샷 검증', async (ctx) => {
      if (quoteId === null || rfqId === null) return ctx.skip();
      const order = await placeOrderFromBomQuote(customer, rp, {
        quoteId,
        step: 'D08',
        prefix: 'D08',
        buyerName: 'e2eBOM정정고객',
        expectedOrderAmount: Math.round(revisedConfirmedTotal * 1.1),
      });
      odId = order.odId;
      ledger.push(`g5_shop_order od_id=${odId} + BOM 정정 주문(quote ${quoteId})`);

      const cartRows: CartRow[] = await getPrisma().$queryRawUnsafe(
        `SELECT ct_id AS ctId, io_price AS ioPrice, od_id AS odId
           FROM g5_shop_cart WHERE od_id = ? AND io_id = ?`,
        odId,
        `bom-${quoteId}`,
      );
      expect(cartRows).toHaveLength(1);
      expect(Number(cartRows[0]?.ioPrice ?? 0), '수정 확정가 VAT 포함 카트 스냅샷')
        .toBe(Math.round(revisedConfirmedTotal * 1.1));

      const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: true,
        sendSms: false,
      });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(paid.json?.data?.skipped ?? []).toHaveLength(0);
      await waitForMailLog('order_deposit', 'order', odId);

      const issue = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, {
        partnerIds: [num(partner.id)],
        memo: `[BOM 여정 3호 ${RUN_KEY}] 수정 스냅샷 발주`,
      });
      expect(issue.status, JSON.stringify(issue.json)).toBe(200);
      const data: PoCreateData | undefined = issue.json?.data;
      const po = data?.pos.find((entry) => entry.partnerId === num(partner.id));
      if (po === undefined) throw new Error('3호 수정 발주서가 없습니다');
      poId = po.poId;
      expect(data?.created).toBe(1);
      expect(po.status).toBe('issued');
      expect(po.totalAmount).toBe(revisedPartnerTotal);

      const poItems: DbPoItemRow[] = await getPrisma().spBomPoItem.findMany({
        where: { poId: BigInt(poId) },
        select: { quoteItemId: true, mpn: true, qty: true, lineTotal: true },
      });
      const poMpns = poItems.map((item) => item.mpn);
      expect(poMpns).toContain(REPLACEMENT_MPN);
      expect(poMpns).toContain(ADD_MPN);
      expect(poMpns).not.toContain(OLD_MPN);
      expect(poMpns).not.toContain(REMOVE_MPN);
      expect(poItems.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(revisedPartnerTotal);
      expect(poItems.some((item) => String(item.quoteItemId) === removedItemId)).toBe(false);
      ledger.push(`sp_bom_po #${String(poId)} (정정품 ${REPLACEMENT_MPN}, 추가품 ${ADD_MPN})`);
      await waitForMailLog('bom_po_issued', 'bom_quote', quoteId);
      await rp.assertView(
        partnerView,
        `/app/partner/bom/pos/${String(poId)}`,
        'D08-partner-revised-po',
        [REPLACEMENT_MPN, ADD_MPN, '발주 확인'],
      );
      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'D08-admin-po-issued',
        ['협력사 발주 (PO)', '발주서 생성'],
      );
      await adminView.page.getByRole('button', { name: '발주서 생성', exact: true }).click();
      const zeroPoButton = adminView.page.getByRole('button', { name: '발주서 발행 (0곳)' });
      await zeroPoButton.waitFor({ state: 'visible', timeout: 15_000 });
      expect(await zeroPoButton.isDisabled(), '추가 발주 대상 0곳이면 발행 비활성').toBe(true);
      await adminView.page.getByRole('button', { name: '발주서 생성 닫기' }).click();
    }, 300_000);

    test('D09. 수정 발주 국내 배송·입고·고객 완료', async (ctx) => {
      if (quoteId === null || poId === null || odId === null) return ctx.skip();
      const confirmed = await api(P, 'POST', `/api/partner/pos/${String(poId)}/confirm`);
      expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);

      const created = await api(P, 'POST', '/api/partner/shipments', { poIds: [poId] });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      const shipment: ShipmentCreateData | undefined = created.json?.data;
      if (shipment === undefined) throw new Error('3호 발송 생성 응답이 없습니다');
      shipmentId = shipment.shipmentId;
      expect(shipment.mode).toBe('domestic');
      expect(shipment.status).toBe('preparing');
      ledger.push(`sp_bom_shipment #${String(shipmentId)} (수정 발주 ${String(poId)})`);

      const packingResponse = await api(
        P,
        'GET',
        `/api/partner/shipments/${String(shipmentId)}/packing-list`,
      );
      expect(packingResponse.status, JSON.stringify(packingResponse.json)).toBe(200);
      const packing: PackingListData | undefined = packingResponse.json?.data;
      if (packing === undefined) throw new Error('3호 선적 리스트가 없습니다');
      expect(packing.editable).toBe(true);
      const saved = await api(
        P,
        'PUT',
        `/api/partner/shipments/${String(shipmentId)}/packing-list`,
        {
          items: packing.items.map((item, index) => ({
            poItemId: item.poItemId,
            packages: [{
              packageId: null,
              quantity: item.expectedQty,
              lotNo: `REV-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
              dateCode: '26+',
            }],
          })),
        },
      );
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const printed = await api(
        P,
        'POST',
        `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
      );
      expect(printed.status, JSON.stringify(printed.json)).toBe(200);

      const trackingNumber = `REVISION-${RUN_KEY}`;
      const shipped = await api(P, 'POST', `/api/partner/pos/${String(poId)}/shipment/advance`, {
        carrier: 'CJ대한통운',
        trackingNumber,
        trackingUrl: `https://example.test/track/${trackingNumber}`,
      });
      expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
      await waitForMailLog('bom_shipment_turn_admin', 'bom_quote', quoteId);

      const received = await api(
        A,
        'POST',
        `/api/admin/bom-quotes/${quoteId}/pos/${String(poId)}/shipment/receive`,
        { note: `[BOM 여정 3호 ${RUN_KEY}] 수정 발주 수량 확인` },
      );
      expect(received.status, JSON.stringify(received.json)).toBe(200);
      await waitForMailLog('bom_shipment_received', 'bom_quote', quoteId);

      const customerTrackingNumber = `CUSTOMER-REV-${RUN_KEY}`;
      const invoiceTime = g5KstDateTime();
      const shipping = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
        target: '배송',
        delivery: {
          deliveryCompany: '우체국택배',
          invoiceNo: customerTrackingNumber,
          invoiceTime,
        },
        sendMail: true,
      });
      expect(shipping.status, JSON.stringify(shipping.json)).toBe(200);
      expect(shipping.json?.data?.notify?.mail).toBe('sent');
      await waitForMailLog('order_delivery', 'order', odId);
      const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
        target: '완료',
      });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);

      const orderRows: OrderPaymentRow[] = await getPrisma().$queryRawUnsafe(
        `SELECT od_status AS odStatus, od_misu AS odMisu,
                od_delivery_company AS deliveryCompany, od_invoice AS invoiceNo,
                DATE_FORMAT(od_invoice_time, '%Y-%m-%d %H:%i:%s') AS invoiceTime
           FROM g5_shop_order WHERE od_id = ?`,
        odId,
      );
      expect(orderRows[0]?.odStatus).toBe('완료');
      expect(Number(orderRows[0]?.odMisu ?? -1)).toBe(0);
      expect(orderRows[0]?.deliveryCompany).toBe('우체국택배');
      expect(orderRows[0]?.invoiceNo).toBe(customerTrackingNumber);
      expect(orderRows[0]?.invoiceTime).toBe(invoiceTime);
      expect((await readQuoteState(quoteId))?.status).toBe('answered');

      await rp.assertView(
        customer,
        `/shop/orderinquiryview.php?od_id=${odId}`,
        'D09-customer-revision-order-complete',
        [odId, '완료', '우체국택배', customerTrackingNumber],
      );
      const orderTableViewport = customer.page.locator('#sod_fin_list .tbl_head03');
      const orderStatusCell = orderTableViewport.locator('tbody tr').first().locator('td').last();
      const [viewportBox, statusBox, statusPosition] = await Promise.all([
        orderTableViewport.boundingBox(),
        orderStatusCell.boundingBox(),
        orderStatusCell.evaluate((element: Element) => getComputedStyle(element).position),
      ]);
      expect(statusPosition, '주문상태 셀 sticky 적용').toBe('sticky');
      expect(viewportBox, '주문상품 표 뷰포트').not.toBeNull();
      expect(statusBox, '주문상태 셀').not.toBeNull();
      if (viewportBox !== null && statusBox !== null) {
        expect(
          statusBox.x + statusBox.width,
          '주문상태 셀이 표의 보이는 오른쪽 경계 안에 있어야 함',
        ).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 1);
      }
      await rp.assertView(
        adminView,
        `/app/admin/smartbom/cases/${quoteId}`,
        'D09-admin-revision-complete',
        ['완료', '발주서 생성'],
      );
      const completedPoButton = adminView.page.getByRole('button', {
        name: '발주서 생성',
        exact: true,
      });
      expect(await completedPoButton.isDisabled(), '완료 주문 추가 발주 차단').toBe(true);
      expect(await completedPoButton.getAttribute('title')).toBe(
        '완료된 주문에는 발주서를 추가할 수 없습니다',
      );
      await rp.assertView(
        partnerView,
        '/app/partner/bom/shipments/done',
        'D09-partner-revision-shipment-done',
        ['완료된 발송', `발송 #${String(shipmentId)}`],
      );

      expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
      expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
      expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
      expect(partnerView.pageErrors, '협력사 pageerror').toHaveLength(0);
      F(
        'D09',
        'obs',
        `BOM 정정 완주 — quote=${quoteId} rfq=${String(rfqId)} po=${String(poId)} shipment=${String(shipmentId)} od=${odId}`,
      );
    }, 240_000);
  },
);
