// Smart BOM 완주 여정 12호 — 고객 BOM 소유권·직접 URL·오류 복구.
//
// 1~11호가 견적 생성 이후의 조달·물류·삭제·클레임을 검증했다면, 12호는 그 모든
// 업무의 입구인 고객 Case 소유권을 검증한다. 소유자/타 회원/관리자/익명 세션을 한
// 리소스에 교차 적용해 목록·상세·변경·주문·클레임·관리자 경계를 확인하고, 존재하지
// 않는 ID와 타인 ID가 같은 404·같은 화면으로 은닉되는지 본다. 일시적 503은 영구
// 404와 달리 같은 화면에서 재시도해 회복되어야 한다.
// 실행: pnpm -F e2e journey:bom:12
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
  getPrisma,
  newSession,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const TITLE = `[BOM 여정 12호] 소유권·직접 URL ${RUN_KEY}`;
const MPN = `E2E-ACCESS-CTRL-${RUN_KEY}`;
const INTRUDER_ID = `e2e-bom-intruder-${RUN_KEY}`;
const MISSING_ID = '9223372036854775000';
const OUT_OF_RANGE_ID = '9223372036854775808';

interface SeededQuote {
  quoteId: string;
  itemId: string;
  title: string;
}

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

async function seedRequestedQuote(mbId: string): Promise<SeededQuote> {
  const now = new Date();
  const quote = await getPrisma().spBomQuote.create({
    data: {
      mbId,
      title: TITLE,
      sourceKind: 'single_search',
      status: 'requested',
      buildStatus: 'ready',
      enrichStatus: 'done',
      setQty: 1,
      spareQty: 0,
      itemsTotal: 1_200,
      shippingFee: 0,
      managementFee: 0,
      finalTotal: 1_200,
      uncostedCount: 0,
      customerMemo: '소유권과 직접 URL 경계를 검증하는 E2E fixture',
      requestedAt: now,
      items: {
        create: {
          rowIdx: 0,
          included: true,
          mpn: MPN,
          manufacturerName: 'Texas Instruments',
          description: 'Customer ownership boundary fixture',
          bomQty: 2,
          orderQty: 2,
          matchStatus: 'manual',
          selectionSource: 'admin',
          lineTotalKrw: 1_200,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: {
            offerKey: `manual:access-${RUN_KEY}`,
            supplier: 'E2E Local Supplier',
            supplierSku: `ACCESS-${RUN_KEY}`,
            packaging: null,
            breakQty: 2,
            unitPrice: 600,
            currency: 'KRW',
            unitPriceKrw: 600,
            moq: 1,
            orderMultiple: 1,
            stock: 100,
            priceBreaks: [{ qty: 1, price: 600 }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      },
    },
    include: { items: { select: { id: true } } },
  });
  const item = quote.items[0];
  if (item === undefined) throw new Error('12호 소유권 fixture 품목이 생성되지 않았습니다');
  return { quoteId: String(quote.id), itemId: String(item.id), title: quote.title };
}

async function quoteSnapshot(quoteId: string): Promise<Record<string, unknown>> {
  const id = BigInt(quoteId);
  const [row, claimCount] = await Promise.all([
    getPrisma().spBomQuote.findUnique({
      where: { id },
      select: {
        mbId: true,
        title: true,
        status: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
    }),
    getPrisma().spBomClaim.count({ where: { quoteId: id } }),
  ]);
  if (row === null) throw new Error(`소유권 검증 Case #${quoteId}가 사라졌습니다`);
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    claimCount,
  };
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 12호 — 고객 소유권·직접 URL·오류 복구', () => {
  const rp = createJourneyReport(
    'findings-bom-access-control',
    'BOM 여정 12호 고객 BOM 소유권·직접 URL·오류 복구 탐색 주행 리포트',
  );
  const { F, ledger } = rp;

  let owner!: E2eSession;
  let intruder!: E2eSession;
  let admin!: E2eSession;
  let ownerMbId = '';
  let ownerToken = '';
  let intruderToken = '';
  let adminToken = '';
  let seeded: SeededQuote | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    ownerMbId = requireCustomerCreds().id;
    owner = await newSession({ mbId: ownerMbId, mbNick: 'BOM 소유 고객' });
    intruder = await newSession({ mbId: INTRUDER_ID, mbNick: '타 회원' });
    admin = await newSession({ mbId: 'e2e-admin', mbNick: 'E2E 관리자', isAdmin: true });
    rp.watchHttp(owner, '소유 고객');
    rp.watchHttp(intruder, '타 회원');
    rp.watchHttp(admin, '관리자');
    ownerToken = signJwt({ mbId: ownerMbId, ttlSec: 7_200 });
    intruderToken = signJwt({
      mbId: INTRUDER_ID,
      cartId: `e2e-cart-intruder-${RUN_KEY}`,
      ttlSec: 7_200,
    });
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 180_000);

  afterAll(async () => {
    rp.write({ '소유 고객': owner, '타 회원': intruder, 관리자: admin });
    if (seeded !== null) {
      await getPrisma().spBomQuote.deleteMany({ where: { id: BigInt(seeded.quoteId) } });
      expect(
        await getPrisma().spBomQuote.count({ where: { id: BigInt(seeded.quoteId) } }),
        '12호 소유권 fixture 잔재',
      ).toBe(0);
    }
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('L01. 소유 고객 → 내역과 직접 URL에서 같은 Case를 조회', async () => {
    seeded = await seedRequestedQuote(ownerMbId);
    ledger.push(`sp_bom_quote #${seeded.quoteId}(${seeded.title}, 종료 시 fixture 정리)`);

    const detail = await api(ownerToken, 'GET', `/api/bom/quotes/${seeded.quoteId}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    expect(detail.json?.data).toMatchObject({
      id: seeded.quoteId,
      title: seeded.title,
      status: 'requested',
    });
    await rp.assertView(owner, `/app/bom/${seeded.quoteId}`, 'L01-owner-detail', [
      seeded.title,
      MPN,
      '견적요청 접수',
    ]);
    await rp.assertView(owner, '/app/bom/history', 'L01-owner-history', [
      'BOM 분석 내역',
      seeded.title,
    ]);
    F('L01', 'obs', '소유 고객의 API·상세·내역이 동일한 Case와 품목을 표시함');
  }, 180_000);

  test('L02. 타 회원 API → 조회·변경·주문·클레임을 모두 동일한 404로 은닉', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const before = await quoteSnapshot(seeded.quoteId);
    const missing = await api(intruderToken, 'GET', `/api/bom/quotes/${MISSING_ID}`);
    expect(missing.status, JSON.stringify(missing.json)).toBe(404);

    const attempts = [
      await api(intruderToken, 'GET', `/api/bom/quotes/${seeded.quoteId}`),
      await api(intruderToken, 'GET', `/api/bom/quotes/${seeded.quoteId}/file`),
      await api(intruderToken, 'PATCH', `/api/bom/quotes/${seeded.quoteId}`, {
        title: `탈취 시도 ${RUN_KEY}`,
      }),
      await api(intruderToken, 'POST', `/api/bom/quotes/${seeded.quoteId}/request`, {
        title: `탈취 요청 ${RUN_KEY}`,
      }),
      await api(intruderToken, 'POST', `/api/bom/quotes/${seeded.quoteId}/order`),
      await api(intruderToken, 'GET', `/api/bom/quotes/${seeded.quoteId}/claims`),
      await api(intruderToken, 'POST', `/api/bom/quotes/${seeded.quoteId}/claims`, {
        kind: 'missing',
        subject: '타 회원의 접근 시도는 접수되지 않아야 합니다',
        description: '소유권을 먼저 검증하고 존재하지 않는 견적과 같은 응답을 반환해야 합니다.',
        items: [{ quoteItemId: seeded.itemId, affectedQty: 1 }],
        acknowledgeNoAutomaticRefund: true,
      }),
      await api(intruderToken, 'DELETE', `/api/bom/quotes/${seeded.quoteId}`),
    ];
    for (const [index, attempt] of attempts.entries()) {
      expect(attempt.status, `타 회원 차단 #${String(index + 1)} ${JSON.stringify(attempt.json)}`).toBe(404);
      expect(attempt.json?.message).toBe(missing.json?.message);
    }

    const batch = await api(intruderToken, 'POST', '/api/bom/quotes/order', {
      ids: [seeded.quoteId],
    });
    expect(batch.status, JSON.stringify(batch.json)).toBe(409);
    expect(batch.json).toMatchObject({
      error: 'NO_ORDERABLE_ITEMS',
      failed: [{ quoteId: seeded.quoteId, error: 'NOT_FOUND' }],
    });
    expect(await quoteSnapshot(seeded.quoteId)).toEqual(before);
    F('L02', 'obs', '타 회원의 읽기·파일·수정·요청·주문·클레임·삭제가 모두 비존재와 같은 응답이며 DB 불변');
  }, 120_000);

  test('L03. 타 회원 390px 직접 URL → 제목 노출 없이 복구 가능한 404 화면', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const page = intruder.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/app/bom/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' });
    const alert = page.getByRole('alert');
    await alert.getByRole('heading', { name: 'BOM 견적을 찾을 수 없습니다', exact: true }).waitFor({
      timeout: 30_000,
    });
    expect(await page.getByText(seeded.title, { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await alert.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect((await alert.getByRole('button').allTextContents()).map((text) => text.trim())).toEqual([
      '내 BOM 내역',
      '새 BOM 업로드',
    ]);
    expect(await alert.getByRole('button', { name: '내 BOM 내역' }).getAttribute('class')).toContain('bg-blue-600');
    await rp.shot(intruder, 'L03-intruder-not-found-mobile');

    await alert.getByRole('button', { name: '내 BOM 내역', exact: true }).click();
    await page.waitForURL('**/app/bom/history');
    await page.getByRole('heading', { name: 'BOM 분석 내역', exact: true }).waitFor();
    expect(await page.getByText(seeded.title, { exact: true }).count()).toBe(0);

    await page.goto(`${BASE_URL}/app/bom/${MISSING_ID}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'BOM 견적을 찾을 수 없습니다', exact: true }).waitFor();

    const malformedRequests: string[] = [];
    const collectMalformedRequest = (request: { url: () => string }): void => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.includes('/api/bom/quotes/not-a-number')
        || pathname.includes(`/api/bom/quotes/${OUT_OF_RANGE_ID}`)
      ) {
        malformedRequests.push(request.url());
      }
    };
    page.on('request', collectMalformedRequest);
    try {
      await page.goto(`${BASE_URL}/app/bom/not-a-number`, { waitUntil: 'domcontentloaded' });
      const malformed = page.getByRole('alert');
      await malformed.getByRole('heading', { name: 'BOM 견적 주소가 올바르지 않습니다', exact: true }).waitFor();
      expect(await malformed.getByRole('button', { name: '다시 시도' }).count()).toBe(0);
      await page.goto(`${BASE_URL}/app/bom/${OUT_OF_RANGE_ID}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'BOM 견적 주소가 올바르지 않습니다', exact: true }).waitFor();
    } finally {
      page.off('request', collectMalformedRequest);
    }
    expect(malformedRequests).toEqual([]);
    F('L03', 'obs', '타인·미기록 ID는 같은 404, 비숫자 주소는 API 호출 없는 영구 오류로 구분하고 내역을 첫 행동으로 제공');
  }, 180_000);

  test('L04. 일시적 503 → 영구 404와 구분하고 같은 화면에서 재시도해 복구', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const detailPath = `/api/bom/quotes/${seeded.quoteId}`;
    let injected = false;
    await owner.context.route(`**${detailPath}`, async (route) => {
      const requestUrl = new URL(route.request().url());
      if (!injected && route.request().method() === 'GET' && requestUrl.pathname === detailPath) {
        injected = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'TEMPORARY_OUTAGE', message: '일시 장애 fixture' }),
        });
        return;
      }
      await route.continue();
    });
    try {
      await owner.page.goto(`${BASE_URL}/app/bom/${seeded.quoteId}`, { waitUntil: 'domcontentloaded' });
      const alert = owner.page.getByRole('alert');
      await alert.getByRole('heading', { name: 'BOM 견적을 불러오지 못했습니다', exact: true }).waitFor({
        timeout: 30_000,
      });
      await alert.getByText('잠시 후 다시 시도해 주세요.', { exact: false }).waitFor();
      const retry = alert.getByRole('button', { name: '다시 시도', exact: true });
      await retry.click();
      await owner.page.getByRole('heading', { name: seeded.title, exact: true }).waitFor({
        timeout: 30_000,
      });
      expect(await owner.page.getByRole('alert').count()).toBe(0);
      await rp.shot(owner, 'L04-owner-recovered-after-retry');
    } finally {
      await owner.context.unroute(`**${detailPath}`);
    }
    F('L04', 'obs', '503은 삭제·권한 404로 오인하지 않고 같은 상세에서 명시적 재시도로 정상 복구됨');
  }, 180_000);

  test('L05. 익명·비관리자 직접 URL → 로그인 왕복과 관리자 홈 가드', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const anonymous = await newSession(null);
    try {
      await anonymous.page.goto(`${BASE_URL}/app/bom/${seeded.quoteId}`, {
        waitUntil: 'domcontentloaded',
      });
      await anonymous.page.waitForURL('**/bbs/login.php?**', { timeout: 30_000 });
      const login = new URL(anonymous.page.url());
      expect(login.pathname).toBe('/bbs/login.php');
      expect(login.searchParams.get('url')).toBe(`/app/bom/${seeded.quoteId}`);
    } finally {
      await anonymous.close();
    }

    const adminRequests: string[] = [];
    const collectAdminRequest = (request: { url: () => string }): void => {
      if (new URL(request.url()).pathname.startsWith('/api/admin/')) adminRequests.push(request.url());
    };
    intruder.page.on('request', collectAdminRequest);
    try {
      await intruder.page.goto(`${BASE_URL}/app/admin/smartbom/cases/${seeded.quoteId}`, {
        waitUntil: 'domcontentloaded',
      });
      await intruder.page.waitForURL((url) => url.pathname === '/app/' || url.pathname === '/app', {
        timeout: 30_000,
      });
    } finally {
      intruder.page.off('request', collectAdminRequest);
    }
    expect(adminRequests).toEqual([]);
    const forbidden = await api(
      intruderToken,
      'GET',
      `/api/admin/bom-quotes/${seeded.quoteId}`,
    );
    expect(forbidden.status, JSON.stringify(forbidden.json)).toBe(403);
    F('L05', 'obs', '익명은 원 URL을 보존해 로그인으로, 비관리자는 관리자 API 호출 없이 앱 홈으로 복귀함');
  }, 180_000);

  test('L06. 관리자 경계 → 운영 화면은 조회하되 고객 API 소유권은 우회하지 않음', async (ctx) => {
    if (seeded === null) return ctx.skip();
    const customerEndpointAsAdmin = await api(
      adminToken,
      'GET',
      `/api/bom/quotes/${seeded.quoteId}`,
    );
    expect(customerEndpointAsAdmin.status, JSON.stringify(customerEndpointAsAdmin.json)).toBe(404);
    const adminEndpoint = await api(
      adminToken,
      'GET',
      `/api/admin/bom-quotes/${seeded.quoteId}`,
    );
    expect(adminEndpoint.status, JSON.stringify(adminEndpoint.json)).toBe(200);
    expect(adminEndpoint.json?.data).toMatchObject({ id: seeded.quoteId, title: seeded.title });

    await rp.assertView(
      admin,
      `/app/admin/smartbom/cases/${seeded.quoteId}`,
      'L06-admin-case-boundary',
      [seeded.title, MPN, '검토·고객 회신'],
    );
    expect(owner.pageErrors, '소유 고객 pageerror').toEqual([]);
    expect(intruder.pageErrors, '타 회원 pageerror').toEqual([]);
    expect(admin.pageErrors, '관리자 pageerror').toEqual([]);
    expect(await getPrisma().spBomQuote.count({ where: { id: BigInt(seeded.quoteId) } })).toBe(1);
    F('L06', 'obs', '관리자는 전용 API·운영 화면에서 조회하지만 고객 API는 관리자 토큰에도 회원 소유권을 유지함');
  }, 180_000);
});
