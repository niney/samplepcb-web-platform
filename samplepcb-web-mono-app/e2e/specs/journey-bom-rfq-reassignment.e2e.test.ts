// Smart BOM 완주 여정 6호 — 미응답 RFQ 회수 → 다른 협력사 재배정 → 매직링크 회전·
// 무로그인 회신 → 국제 발주·입고 → 고객 배송 완료.
//
// 1~5호가 정상·분할·정정·부분취소·공급차질을 고정했다면 6호는 견적요청 단계에서
// 응답하지 않는 협력사를 안전하게 제외하는 실패 복구를 다룬다. 회수된 RFQ와 구 토큰이
// 하류 선정·PO에 남지 않아야 하며, 새 협력사는 계정 없이도 회신을 끝낼 수 있어야 한다.
// 생성물은 자동 정리하지 않는다. output/journey/findings-bom-rfq-reassignment.md 대장으로
// 확인한 뒤 수동 정리한다. 실행: pnpm -F e2e journey:bom:6
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
const INITIAL_PARTNER_NAME = '협력1';
const REASSIGNED_PARTNER_NAME = '협력2';

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  unitPrice: number;
}

const LINES: readonly SeedLine[] = [
  {
    mpn: 'STM32F103C8T6',
    manufacturerName: 'STMicroelectronics',
    description: 'Arm Cortex-M3 MCU 64 KB LQFP-48',
    bomQty: 1,
    orderQty: 5,
    unitPrice: 4_850,
  },
  {
    mpn: 'GRM188R71H104KA93D',
    manufacturerName: 'Murata',
    description: '0.1 µF 50 V X7R 0603 MLCC',
    bomQty: 4,
    orderQty: 20,
    unitPrice: 405,
  },
  {
    mpn: 'B2B-XH-A',
    manufacturerName: 'JST',
    description: '2-position 2.5 mm wire-to-board header',
    bomQty: 2,
    orderQty: 10,
    unitPrice: 1_240,
  },
] as const;

interface SeededQuote {
  quoteId: string;
  title: string;
  itemIds: string[];
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
  status: 'requested' | 'quoted' | 'closed';
  magicToken: string | null;
  items: AdminRfqItem[];
}

interface AdminRfqListData {
  rfqs: AdminRfqRow[];
}

interface AdminQuoteItem {
  id: string;
  selectionSource: string;
  selectedRfqItemId: number | null;
  adminReview: { required: boolean; completed: boolean };
}

interface AdminQuoteData {
  status: string;
  updatedAt: string;
  items: AdminQuoteItem[];
}

interface PoItem {
  poItemId: number;
  quoteItemId: string;
  mpn: string;
  qty: number;
}

interface PoRow {
  poId: number;
  partnerId: number;
  partnerName: string;
  status: string;
  totalAmount: number;
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
  mpn: string;
  expectedQty: number;
}

interface PackingListData {
  editable: boolean;
  items: PackingListItem[];
}

interface AdminOrderCase {
  quoteId: string;
  poCount: number;
  poReceivedCount: number;
}

interface AdminOrderRow {
  odId: string;
  cases: AdminOrderCase[];
}

interface AdminOrderData {
  items: AdminOrderRow[];
}

interface FormApiResult {
  status: number;
  json: unknown;
}

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

const futureDate = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function apiForm(
  token: string,
  path: string,
  fileType: 'invoice' | 'airwaybill',
  fileName: string,
): Promise<FormApiResult> {
  const form = new FormData();
  form.append('fileType', fileType);
  form.append(
    'file',
    new Blob(['%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'], {
      type: 'application/pdf',
    }),
    fileName,
  );
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function seedRequestedQuote(mbId: string): Promise<SeededQuote> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId,
        title: `[BOM 여정 6호] RFQ 미응답 회수·재배정 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'requested',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 2,
        spareQty: 1,
        itemsTotal: 0,
        shippingFee: 5_000,
        managementFee: 3_500,
        finalTotal: 8_500,
        uncostedCount: LINES.length,
        requestedAt: new Date(),
        customerMemo: '1차 협력사 미응답 시 재배정해 주세요.',
        adminMemo: `[BOM 여정 6호 ${RUN_KEY}] RFQ reassignment fixture`,
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

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 6호 — RFQ 미응답 회수·재배정·매직링크 회신', () => {
  const rp = createJourneyReport(
    'findings-bom-rfq-reassignment',
    'BOM 여정 6호 RFQ 미응답 회수·재배정 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let initialPartnerView: E2eSession;
  let reassignedPartnerView: E2eSession;
  let publicView: E2eSession;
  let initialPartner: PartnerFixture;
  let reassignedPartner: PartnerFixture;
  let A = '';
  let PB = '';
  let seeded: SeededQuote | null = null;
  let initialRfqId: number | null = null;
  let initialMagicToken: string | null = null;
  let reassignedRfqId: number | null = null;
  let oldReassignedToken: string | null = null;
  let activeMagicToken: string | null = null;
  let replyTotal = 0;
  let confirmedTotal = 0;
  let odId: string | null = null;
  let poId: number | null = null;
  let shipmentId: number | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    initialPartner = await getPartner(INITIAL_PARTNER_NAME);
    reassignedPartner = await getPartner(REASSIGNED_PARTNER_NAME);
    if (initialPartner.mbId === null || reassignedPartner.mbId === null) {
      throw new Error('협력1·협력2 모두 연결 계정이 필요합니다');
    }
    expect(initialPartner.country, '1차 협력사 국내 전제').toBe('KR');
    expect(reassignedPartner.country, '재배정 협력사 국제 전제').not.toBe('KR');
    expect(capabilityList(initialPartner.capabilities)).toContain('bom_rfq');
    expect(capabilityList(reassignedPartner.capabilities)).toContain('bom_rfq');

    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    initialPartnerView = await newSession(
      { mbId: initialPartner.mbId },
      { partnerModule: 'bom' },
    );
    reassignedPartnerView = await newSession(
      { mbId: reassignedPartner.mbId },
      { partnerModule: 'bom' },
    );
    publicView = await newSession(null);
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(initialPartnerView, '1차 협력사');
    rp.watchHttp(reassignedPartnerView, '재배정 협력사');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    PB = signJwt({ mbId: reassignedPartner.mbId, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({
      고객: customer,
      관리자: adminView,
      '1차협력사': initialPartnerView,
      재배정협력사: reassignedPartnerView,
      무로그인회신: publicView,
    });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  async function loadRfqs(): Promise<AdminRfqRow[]> {
    if (seeded === null) return [];
    const response = await api(A, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}/rfqs`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const data: AdminRfqListData | undefined = response.json?.data;
    return data?.rfqs ?? [];
  }

  test('F01. 고객 요청 스냅샷 생성 → 관리자 검토 시작', async () => {
    seeded = await seedRequestedQuote(customer.mbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}`);
    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'F01-customer-requested', [
      seeded.title,
      ...LINES.map((line) => line.mpn),
    ]);
    await rp.assertView(
      adminView,
      `/app/admin/smartbom/cases/${seeded.quoteId}`,
      'F01-admin-requested',
      ['다음 작업 · 검토 시작', '협력사 견적요청'],
    );
    await adminView.page.getByRole('button', { name: '검토 시작', exact: true }).click();
    await expect
      .poll(async () => {
        const row = await getPrisma().spBomQuote.findUnique({
          where: { id: BigInt(seeded?.quoteId ?? '0') },
          select: { status: true },
        });
        return row?.status;
      })
      .toBe('reviewing');
  });

  test('F02. 관리자 UI: 1차 협력사 RFQ 발송·포털 노출', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: '협력사 견적요청 보내기' }).click();
    const row = page.locator('label').filter({ hasText: INITIAL_PARTNER_NAME }).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    await row.locator('input[type="checkbox"]').check();
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/rfqs`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '발송 (1곳)' }).click();
    expect((await responseWait).status()).toBe(200);

    const rfq = (await loadRfqs()).find((entry) => entry.partnerId === num(initialPartner.id));
    if (rfq === undefined || rfq.magicToken === null) {
      throw new Error('1차 협력사 RFQ·매직링크가 생성되지 않았습니다');
    }
    initialRfqId = rfq.rfqId;
    initialMagicToken = rfq.magicToken;
    ledger.push(`sp_bom_rfq #${String(initialRfqId)}(${INITIAL_PARTNER_NAME}, 후속 회수)`);
    const partnerRead = await api(
      signJwt({ mbId: initialPartner.mbId ?? '', ttlSec: 3_600 }),
      'GET',
      `/api/partner/rfqs/${String(initialRfqId)}`,
    );
    expect(partnerRead.status, JSON.stringify(partnerRead.json)).toBe(200);
    await rp.assertView(
      initialPartnerView,
      `/app/partner/bom/rfqs/${String(initialRfqId)}`,
      'F02-initial-partner-requested',
      [seeded.title, '회신 저장'],
    );
  });

  test('F03. 미응답 요청 회수: RFQ·포털 권한·구 매직링크 즉시 차단', async (ctx) => {
    if (seeded === null || initialRfqId === null || initialMagicToken === null) return ctx.skip();
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: '협력사 견적요청 보내기' }).click();
    const row = page.locator('label').filter({ hasText: INITIAL_PARTNER_NAME }).first();
    await row.locator('input[type="checkbox"]').uncheck();
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/rfqs`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '미회신 요청 회수', exact: true }).click();
    expect((await responseWait).status()).toBe(200);
    expect(await loadRfqs(), '회수 후 활성 RFQ').toHaveLength(0);

    const oldPortal = await api(
      signJwt({ mbId: initialPartner.mbId ?? '', ttlSec: 3_600 }),
      'GET',
      `/api/partner/rfqs/${String(initialRfqId)}`,
    );
    expect(oldPortal.status, '회수된 RFQ 포털 은닉').toBe(404);
    await publicView.page.goto(`${BASE_URL}/app/rfq-reply/${initialMagicToken}`, {
      waitUntil: 'domcontentloaded',
    });
    await publicView.page
      .getByText('유효하지 않거나 만료된 링크입니다.')
      .waitFor({ timeout: 30_000 });
    F('F03', 'obs', '1차 미응답 RFQ 회수 즉시 포털 404·구 매직링크 무효화 확인');
  });

  test('F04. 다른 협력사로 재배정 후 매직링크 재발급 회전', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: '협력사 견적요청 보내기' }).click();
    const row = page.locator('label').filter({ hasText: REASSIGNED_PARTNER_NAME }).first();
    await row.locator('input[type="checkbox"]').check();
    const sendWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/rfqs`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '발송 (1곳)' }).click();
    expect((await sendWait).status()).toBe(200);

    let rfq = (await loadRfqs()).find((entry) => entry.partnerId === num(reassignedPartner.id));
    if (rfq === undefined || rfq.magicToken === null) {
      throw new Error('재배정 RFQ·매직링크가 생성되지 않았습니다');
    }
    reassignedRfqId = rfq.rfqId;
    oldReassignedToken = rfq.magicToken;
    ledger.push(`sp_bom_rfq #${String(reassignedRfqId)}(${REASSIGNED_PARTNER_NAME}, 재배정)`);

    const rfqRow = page.locator('tr').filter({ hasText: REASSIGNED_PARTNER_NAME }).first();
    await rfqRow.getByRole('button', { name: '재발급', exact: true }).click();
    const dialog = page
      .getByRole('alertdialog')
      .filter({ hasText: '회신 링크를 재발급할까요?' });
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    const reissueWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(
          `/api/admin/bom-quotes/${seeded?.quoteId ?? ''}/rfqs/${String(reassignedRfqId)}/magic-link`,
        ),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: '재발급', exact: true }).click();
    expect((await reissueWait).status()).toBe(200);
    rfq = (await loadRfqs()).find((entry) => entry.rfqId === reassignedRfqId);
    if (rfq?.magicToken === null || rfq?.magicToken === undefined) {
      throw new Error('재발급된 매직링크가 없습니다');
    }
    activeMagicToken = rfq.magicToken;
    expect(activeMagicToken).not.toBe(oldReassignedToken);

    const reissueNotice = page
      .getByRole('status')
      .filter({ hasText: '새 회신 링크가 발급되었습니다.' });
    await reissueNotice.waitFor({ timeout: 30_000 });
    expect(await reissueNotice.textContent()).toContain('[링크 복사]');

    const activeReplyApi = `**/api/rfq-reply/${activeMagicToken}`;
    await publicView.page.route(
      activeReplyApi,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'TEMPORARY', message: 'temporary E2E fault' }),
        });
      },
      { times: 1 },
    );
    await publicView.page.goto(`${BASE_URL}/app/rfq-reply/${activeMagicToken}`, {
      waitUntil: 'domcontentloaded',
    });
    await publicView.page
      .getByRole('alert')
      .filter({ hasText: '회신 정보를 일시적으로 불러오지 못했습니다.' })
      .waitFor({ timeout: 30_000 });
    expect(
      await publicView.page.getByText('유효하지 않거나 만료된 링크입니다.').count(),
    ).toBe(0);
    await publicView.page.getByRole('button', { name: '다시 불러오기' }).click();
    await publicView.page.getByRole('heading', { name: seeded.title }).waitFor({ timeout: 30_000 });

    await publicView.page.goto(`${BASE_URL}/app/rfq-reply/${oldReassignedToken}`, {
      waitUntil: 'domcontentloaded',
    });
    await publicView.page
      .getByText('유효하지 않거나 만료된 링크입니다.')
      .waitFor({ timeout: 30_000 });
    F('F04', 'obs', '재발급 안내·구 토큰 404·일시 장애 분리 및 같은 화면 재시도 확인');
  });

  test('F05. 무로그인 공개 페이지: 3개 품목 회신 저장·관리자 반영', async (ctx) => {
    if (seeded === null || reassignedRfqId === null || activeMagicToken === null) return ctx.skip();
    const page = publicView.page;
    await page.goto(`${BASE_URL}/app/rfq-reply/${activeMagicToken}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('heading', { name: seeded.title }).waitFor({ timeout: 30_000 });
    const firstLine = LINES[0]!;
    let invalidSaveRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'PUT'
        && request.url().endsWith(`/api/rfq-reply/${activeMagicToken ?? ''}`)
      ) {
        invalidSaveRequests += 1;
      }
    });
    await page.getByLabel(`${firstLine.mpn} 단가(KRW)`).fill(String(firstLine.unitPrice));
    const invalidReplyQty = page.getByLabel(`${firstLine.mpn} 회신수량`);
    await invalidReplyQty.fill('0');
    await page.getByRole('button', { name: '회신 저장', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: `${firstLine.mpn} 회신수량은 1 이상의 정수로 입력해 주세요.` })
      .waitFor({ timeout: 10_000 });
    expect(await invalidReplyQty.getAttribute('aria-invalid')).toBe('true');
    expect(await invalidReplyQty.evaluate((element) => document.activeElement === element)).toBe(true);
    await page.waitForTimeout(300);
    expect(invalidSaveRequests).toBe(0);

    replyTotal = 0;
    for (const [index, line] of LINES.entries()) {
      const row = page.locator('tr').filter({ hasText: line.mpn }).first();
      const inputs = row.locator('input');
      await inputs.nth(0).fill(String(line.unitPrice));
      await inputs.nth(1).fill(String(line.orderQty));
      await inputs.nth(2).fill('1');
      await inputs.nth(3).fill(String(line.orderQty + 200));
      await inputs.nth(4).fill('25+');
      await inputs.nth(5).fill(index === 0 ? '7영업일' : '재고 보유');
      await inputs.nth(6).fill(`${line.mpn} 재배정 회신`);
      replyTotal += line.unitPrice * line.orderQty;
    }
    await page.locator('input[type="date"]').fill(futureDate(9));
    await page
      .getByLabel('회신 메모', { exact: true })
      .fill(`[BOM 여정 6호 ${RUN_KEY}] 계정 없이 회신`);
    const saveWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT'
        && response.url().endsWith(`/api/rfq-reply/${activeMagicToken ?? ''}`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '회신 저장', exact: true }).click();
    expect((await saveWait).status()).toBe(200);
    await page.getByText('회신이 접수되었습니다.').waitFor({ timeout: 30_000 });

    const rfq = (await loadRfqs()).find((entry) => entry.rfqId === reassignedRfqId);
    expect(rfq?.status).toBe('quoted');
    expect(rfq?.items).toHaveLength(LINES.length);
    expect(rfq?.items.every((item) => item.unitPrice !== null)).toBe(true);
    F('F05', 'obs', '잘못된 숫자는 행·필드 안내와 포커스로 차단되고 API 요청은 발생하지 않음');
    await rp.shot(publicView, 'F05-public-rfq-replied');
  });

  test('F06. 관리자 선정·검토 완료 → 고객 확정 회신·매직링크 마감', async (ctx) => {
    if (seeded === null || reassignedRfqId === null || activeMagicToken === null) return ctx.skip();
    const rfq = (await loadRfqs()).find((entry) => entry.rfqId === reassignedRfqId);
    if (rfq === undefined) throw new Error('재배정 RFQ가 없습니다');
    if (rfq.status !== 'quoted' || rfq.items.length !== LINES.length) return ctx.skip();
    for (const item of rfq.items) {
      const selected = await api(
        A,
        'POST',
        `/api/admin/bom-quotes/${seeded.quoteId}/rfq-selection`,
        { itemId: item.quoteItemId, rfqItemId: item.rfqItemId },
      );
      expect(selected.status, JSON.stringify(selected.json)).toBe(200);
    }

    let detailResponse = await api(A, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}`);
    let detail: AdminQuoteData | undefined = detailResponse.json?.data;
    if (detail === undefined) throw new Error('관리자 BOM 상세가 없습니다');
    const pending = detail.items.filter(
      (item) => item.adminReview.required && !item.adminReview.completed,
    );
    if (pending.length > 0) {
      const reviewed = await api(
        A,
        'PUT',
        `/api/admin/bom-quotes/${seeded.quoteId}/item-reviews`,
        {
          itemIds: pending.map((item) => item.id),
          completed: true,
          expectedQuoteUpdatedAt: detail.updatedAt,
          reason: `[BOM 여정 6호 ${RUN_KEY}] 재배정 회신 확인`,
        },
      );
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
    }
    detailResponse = await api(A, 'GET', `/api/admin/bom-quotes/${seeded.quoteId}`);
    detail = detailResponse.json?.data;
    expect(detail?.items.every((item) => item.selectionSource === 'partner')).toBe(true);

    confirmedTotal = replyTotal + 8_500;
    const completed = await api(A, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/complete`, {
      adminMemo: `[BOM 여정 6호 ${RUN_KEY}] 미응답 회수 후 확정`,
      answerNote: '1차 미응답 요청을 회수하고 대체 협력사 재고·납기를 확인했습니다.',
      confirmedShippingFee: 5_000,
      confirmedManagementFee: 3_500,
      confirmedTotal,
      sendEmail: false,
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    expect(completed.json?.data?.status).toBe('answered');
    expect((await loadRfqs()).find((entry) => entry.rfqId === reassignedRfqId)?.status).toBe(
      'closed',
    );

    await pageForClosedLink(publicView, activeMagicToken, seeded.title);
    const closedWrite = await api('', 'PUT', `/api/rfq-reply/${activeMagicToken}`, {
      items: [],
      deliveryDate: null,
      memo: null,
    });
    expect(closedWrite.status).toBe(409);
    await rp.assertView(customer, `/app/bom/${seeded.quoteId}`, 'F06-customer-answered', [
      '확정 견적',
      '주문하기',
      REASSIGNED_PARTNER_NAME,
    ]);
  }, 180_000);

  async function pageForClosedLink(
    session: E2eSession,
    token: string,
    title: string,
  ): Promise<void> {
    await session.page.goto(`${BASE_URL}/app/rfq-reply/${token}`, {
      waitUntil: 'domcontentloaded',
    });
    await session.page.getByRole('heading', { name: title }).waitFor({ timeout: 30_000 });
    await session.page.getByText('마감된 요청입니다(수정 불가)').waitFor({ timeout: 30_000 });
    expect(await session.page.getByRole('button', { name: '회신 저장' }).count()).toBe(0);
  }

  test('F07. 고객 주문·입금 → 재배정 협력사만 국제 PO 발행', async (ctx) => {
    if (seeded === null || activeMagicToken === null || confirmedTotal < 1) return ctx.skip();
    const placed = await placeOrderFromBomQuote(customer, rp, {
      quoteId: seeded.quoteId,
      step: 'F07',
      prefix: 'F07-rfq-reassignment-order',
      buyerName: 'e2eBOMRFQ재배정고객',
      expectedOrderAmount: Math.round(confirmedTotal * 1.1),
      expectedAppliedSetQty: 3,
    });
    odId = placed.odId;
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const issued = await api(A, 'POST', `/api/admin/bom-quotes/${seeded.quoteId}/pos`, {
      partnerIds: [num(reassignedPartner.id)],
      memo: `[BOM 여정 6호 ${RUN_KEY}] 재배정 협력사 단독 발주`,
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const data: PoCreateData | undefined = issued.json?.data;
    const po = data?.pos.find((entry) => entry.partnerId === num(reassignedPartner.id));
    if (po === undefined) throw new Error('재배정 협력사 PO가 없습니다');
    poId = po.poId;
    expect(data?.created).toBe(1);
    expect(po.items).toHaveLength(LINES.length);
    expect(po.totalAmount).toBe(replyTotal);
    expect(data?.pos.some((entry) => entry.partnerId === num(initialPartner.id))).toBe(false);
    const confirmed = await api(PB, 'POST', `/api/partner/pos/${String(poId)}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    ledger.push(`g5_shop_order ${odId}`, `sp_bom_po #${String(poId)}(${REASSIGNED_PARTNER_NAME})`);
  }, 240_000);

  test('F08. 재배정 협력사 국제 포장·Invoice → AWB·선적·통관·입고', async (ctx) => {
    if (seeded === null || poId === null) return ctx.skip();
    const created = await api(PB, 'POST', '/api/partner/shipments', { poIds: [poId] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const shipment: ShipmentCreateData | undefined = created.json?.data;
    if (shipment === undefined) throw new Error('국제 발송이 생성되지 않았습니다');
    shipmentId = shipment.shipmentId;
    expect(shipment.primaryPoId).toBe(poId);
    expect(shipment.mode).toBe('international');
    expect(shipment.status).toBe('preparing');

    const draftResponse = await api(
      PB,
      'GET',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
    );
    expect(draftResponse.status, JSON.stringify(draftResponse.json)).toBe(200);
    const draft: PackingListData | undefined = draftResponse.json?.data;
    if (draft === undefined) throw new Error('선적 리스트 초안이 없습니다');
    expect(draft.editable).toBe(true);
    expect(draft.items).toHaveLength(LINES.length);
    const savedPacking = await api(
      PB,
      'PUT',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
      {
        items: draft.items.map((item, index) => ({
          poItemId: item.poItemId,
          packages: [
            {
              packageId: null,
              quantity: item.expectedQty,
              lotNo: `RFQ6-${RUN_KEY}-${String(index + 1).padStart(2, '0')}`,
              dateCode: '25+',
            },
          ],
        })),
      },
    );
    expect(savedPacking.status, JSON.stringify(savedPacking.json)).toBe(200);
    const printed = await api(
      PB,
      'POST',
      `/api/partner/shipments/${String(shipmentId)}/packing-list/print`,
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);

    const invoiceDraft = await api(
      PB,
      'GET',
      `/api/partner/pos/${String(poId)}/shipment/invoice?fresh=true`,
    );
    expect(invoiceDraft.status, JSON.stringify(invoiceDraft.json)).toBe(200);
    const invoiceSaved = await api(
      PB,
      'PUT',
      `/api/partner/pos/${String(poId)}/shipment/invoice`,
      invoiceDraft.json?.data,
    );
    expect(invoiceSaved.status, JSON.stringify(invoiceSaved.json)).toBe(200);
    const invoiceUpload = await apiForm(
      PB,
      `/api/partner/pos/${String(poId)}/shipment/files`,
      'invoice',
      `rfq-reassignment-invoice-${RUN_KEY}.pdf`,
    );
    expect(invoiceUpload.status, JSON.stringify(invoiceUpload.json)).toBe(200);
    const requested = await api(
      PB,
      'POST',
      `/api/partner/pos/${String(poId)}/shipment/advance`,
      { shipDate: futureDate(3) },
    );
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    expect(requested.json?.data?.shipment?.status).toBe('requested');
    const awbUpload = await apiForm(
      A,
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/files`,
      'airwaybill',
      `rfq-reassignment-awb-${RUN_KEY}.pdf`,
    );
    expect(awbUpload.status, JSON.stringify(awbUpload.json)).toBe(200);
    for (const body of [
      {
        status: 'shipped',
        carrier: 'DHL',
        trackingNumber: `RFQ6-CN-${RUN_KEY}`,
        trackingUrl: `https://example.test/rfq6/${RUN_KEY}`,
      },
      { status: 'arrived' },
      { status: 'customs' },
    ] as const) {
      const advanced = await api(
        A,
        'PUT',
        `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment`,
        body,
      );
      expect(advanced.status, `${body.status}: ${JSON.stringify(advanced.json)}`).toBe(200);
    }
    const received = await api(
      A,
      'POST',
      `/api/admin/bom-quotes/${seeded.quoteId}/pos/${String(poId)}/shipment/receive`,
      { note: `[BOM 여정 6호 ${RUN_KEY}] 재배정 국제 입고 완료` },
    );
    expect(received.status, JSON.stringify(received.json)).toBe(200);
    const dbShipment = await getPrisma().spBomShipment.findUnique({
      where: { id: BigInt(shipmentId) },
    });
    expect(dbShipment?.status).toBe('done');
    expect(dbShipment?.receivedAt).not.toBeNull();
    ledger.push(`sp_bom_shipment #${String(shipmentId)}(international)`);
  }, 180_000);

  test('F09. 고객 배송·완료 → stale RFQ 제거·모바일 회신표 사용성 감사', async (ctx) => {
    if (
      seeded === null
      || odId === null
      || poId === null
      || shipmentId === null
      || activeMagicToken === null
    ) return ctx.skip();
    const queue = await api(A, 'GET', '/api/admin/bom-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const queueData: AdminOrderData | undefined = queue.json?.data;
    const order = queueData?.items.find((entry) => entry.odId === odId);
    const orderCase = order?.cases.find((entry) => entry.quoteId === seeded?.quoteId);
    expect(orderCase?.poCount).toBe(1);
    expect(orderCase?.poReceivedCount).toBe(1);

    const shipped = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      carrier: '우체국택배',
      trackingNumber: `CUSTOMER-RFQ6-${RUN_KEY}`,
      sendMail: false,
      sendSms: false,
    });
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    const completed = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const [staleRfqs, stalePos, selectedItems] = await Promise.all([
      getPrisma().spBomRfq.count({
        where: { quoteId: BigInt(seeded.quoteId), partnerId: initialPartner.id },
      }),
      getPrisma().spBomPo.count({
        where: { quoteId: BigInt(seeded.quoteId), partnerId: initialPartner.id },
      }),
      getPrisma().spBomQuoteItem.findMany({
        where: { quoteId: BigInt(seeded.quoteId) },
        select: { selectedRfqItem: { select: { rfq: { select: { partnerId: true } } } } },
      }),
    ]);
    expect(staleRfqs, '회수된 1차 RFQ 잔존').toBe(0);
    expect(stalePos, '회수된 1차 협력사 PO 잔존').toBe(0);
    expect(
      selectedItems.every(
        (item: { selectedRfqItem: { rfq: { partnerId: bigint } } | null }) =>
          item.selectedRfqItem?.rfq.partnerId === reassignedPartner.id,
      ),
      '모든 선정 포인터가 재배정 협력사를 가리킴',
    ).toBe(true);

    await publicView.page.setViewportSize({ width: 390, height: 844 });
    await pageForClosedLink(publicView, activeMagicToken, seeded.title);
    const tableScroll = publicView.page.locator('table').locator('..').first();
    const mobileMetrics = await tableScroll.evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const scrollGuideCount = await publicView.page.getByText(/좌우로 이동|가로로 이동/).count();
    expect(mobileMetrics.overflow, '모바일 RFQ 표 가로 스크롤 표면').toBe(true);
    expect(scrollGuideCount, '모바일 RFQ 표 이동 안내').toBeGreaterThan(0);
    await publicView.page
      .getByRole('button', { name: 'RFQ 회신 표 오른쪽으로 이동' })
      .click();
    await expect.poll(() => tableScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const unlabeledInputs = await publicView.page.locator('tbody input').evaluateAll((inputs) =>
      inputs.filter((element) => {
        const input = element as HTMLInputElement;
        return (
          input.getAttribute('aria-label') === null
          && input.getAttribute('aria-labelledby') === null
          && input.labels?.length === 0
        );
      }).length,
    );
    expect(unlabeledInputs, '품목·필드별 RFQ 입력 접근성 이름').toBe(0);
    F(
      'F09',
      'obs',
      `390px RFQ 표 ${String(mobileMetrics.clientWidth)}→${String(mobileMetrics.scrollWidth)}px 이동 안내·화살표·입력 21개 이름 확인`,
    );
    await rp.shot(publicView, 'F09-public-rfq-mobile-390');
    await publicView.page.setViewportSize({ width: 1440, height: 900 });

    await rp.assertView(
      customer,
      `/shop/orderinquiryview.php?od_id=${odId}`,
      'F09-customer-order-complete',
      [odId, '완료'],
    );
    expect(rp.httpErrors, '관찰 화면 HTTP 오류').toHaveLength(0);
    expect(customer.pageErrors, '고객 pageerror').toHaveLength(0);
    expect(adminView.pageErrors, '관리자 pageerror').toHaveLength(0);
    expect(initialPartnerView.pageErrors, '1차 협력사 pageerror').toHaveLength(0);
    expect(reassignedPartnerView.pageErrors, '재배정 협력사 pageerror').toHaveLength(0);
    expect(publicView.pageErrors, '무로그인 회신 pageerror').toHaveLength(0);
    F(
      'F09',
      'obs',
      `BOM 6호 완주 — quote=${seeded.quoteId} oldRfq=${String(initialRfqId)} activeRfq=${String(reassignedRfqId)} od=${odId} po=${String(poId)} shipment=${String(shipmentId)}`,
    );
  }, 180_000);
});
