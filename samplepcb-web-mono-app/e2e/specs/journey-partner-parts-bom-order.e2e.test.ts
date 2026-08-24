/**
 * 협력사 보유 부품 — **BOM 분석** 경로로 주문 완주 (docs/PARTNER_PARTS.md)
 *
 * 앞 주문 여정은 단일검색 담기였다. 고객이 실제로 더 많이 쓰는 길은 **BOM 파일 업로드**이고,
 * 협력사 부품은 그 경로에서 `local_products` 주입으로 후보에 오른다 — 담기와는 다른 기계다.
 * 그래서 같은 질문을 이 길로 다시 묻는다: 협력사만 가진 품번이 섞인 BOM 을 올려 검색을
 * 끝내고, 견적요청 → 관리자 확정 → 주문까지 가면서 **실공급사 금액은 살고 협력사 행은
 * 0 으로 남는가**, 고객에게 협력사 이름은 새지 않는가, 그 상태로 주문이 서는가.
 *
 * 픽스처는 실검색 스펙과 같은 짝을 쓴다(품번은 실물 EUREKA 재고표에서 뽑았다):
 *  · `partner-stock-eureka-sample.csv` — 협력사 재고표
 *  · `bom-partner-stock-match.csv`     — 흔한 부품(실공급사 有)·단종/희귀(협력사만)·미보유·없는 품번
 *
 * ⚠ 실제 g5 장바구니 행을 만든다. 서명 토큰엔 cartId 가 없어 `/spcb/api/me` 브리지 토큰을
 * 쓰고, 끝나면 `io_id='bom-{quoteId}'` 로 정확히 짚어 지운다(`it_id LIKE` 는 안 지워진다).
 *
 * 실행: pnpm -F e2e e2e journey-partner-parts-bom-order  (PORTAL_E2E=1 · API + sp-engine + nginx)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  cleanupPartnerCatalog,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  monoRoot,
  newPhpSession,
  requireCustomerCreds,
  signJwt,
  snap,
  type E2eSession,
} from '../helpers';

const PARTNER_NAME = 'e2eBOM주문협력';
const PARTNER_OWNER = 'e2e-bom-order-owner';
const BOM_FILE = 'bom-partner-stock-match.csv';

/** 실공급사가 잡히는 흔한 품번 — 금액이 서야 한다. */
const PRICED_MPN = 'STM32F030F4P6';
/** 협력사만 가진 단종 품번 — 금액 없이 협력사 근거만 붙어야 한다. */
const PARTNER_ONLY = ['88PW886-B1-NFHIC000-T', 'ADUC7020BCPZ62I-R7'];
/** 협력사도 없는 품번 — 근거도 금액도 없어야 한다. */
const NOBODY = 'ZZ9-NOSUCHPART-0001';

const admin = (): string => signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
const owner = (): string => signJwt({ mbId: PARTNER_OWNER, ttlSec: 7_200 });
const fixture = (name: string): Buffer => readFileSync(join(monoRoot, 'e2e', 'fixtures', name));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let customer: E2eSession;
let customerId = '';
let quoteId = '';
let itemsByMpn = new Map<string, any>();

const uploadFile = async (
  token: string,
  path: string,
  body: Buffer,
  filename: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: any }> => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(body)], filename, { type: 'text/csv' }));
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, json: (await res.json()) as any };
};

/** 화면이 쓰는 진짜 토큰 — 서명 토큰엔 cartId 가 없어 주문이 NO_CART_ID 로 먼저 끊긴다. */
const customerToken = async (): Promise<string> => {
  const token: string = await customer.page.evaluate(() =>
    fetch('/spcb/api/me', { credentials: 'include' })
      .then((response) => response.json())
      .then((me: any) => String(me.token ?? '')),
  );
  expect(token, '고객 세션 토큰(/spcb/api/me)').not.toBe('');
  return token;
};

const dropPartner = async (): Promise<void> => {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findFirst({ where: { name: PARTNER_NAME } });
  if (existing === null) return;
  await cleanupPartnerCatalog(existing.id);
  const parts = await prisma.spPartnerPart.findMany({
    where: { partnerId: existing.id },
    select: { id: true },
  });
  if (parts.length > 0) {
    await prisma.spPartnerPartKey.deleteMany({
      where: { partId: { in: parts.map((row: { id: bigint }) => row.id) } },
    });
  }
  await prisma.spPartnerPart.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerPartUpload.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerMember.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartner.delete({ where: { id: existing.id } });
};

/** 이 스펙이 만든 견적만 — 실계정이라 픽스처 파일명으로 좁힌다. */
const dropQuotes = async (): Promise<void> => {
  if (customerId === '') return;
  const prisma = getPrisma();
  const quotes = await prisma.spBomQuote.findMany({
    where: { mbId: customerId, fileName: BOM_FILE },
    select: { id: true },
  });
  for (const quote of quotes) {
    await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_cart WHERE io_id = ?`, `bom-${String(quote.id)}`);
    await prisma.spBomSupplierSearchTrace.deleteMany({
      where: { supplierSearchRun: { quoteId: quote.id } },
    });
    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: { activeSupplierSearchRunId: null },
    });
    await prisma.spBomSupplierSearchRun.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteItemReview.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteSelectionEvent.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteCandidate.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }
};

describe.skipIf(!RUN)('협력사 보유 부품 — BOM 분석으로 주문 완주', () => {
  beforeAll(async () => {
    const engine = await fetch(`${BOM_ENGINE_URL}/health`).catch(() => null);
    if (engine === null || !engine.ok) {
      throw new Error(`sp-engine(${BOM_ENGINE_URL}) 이 떠 있어야 합니다 — ./run.sh`);
    }
    const creds = requireCustomerCreds();
    customerId = creds.id;
    await dropQuotes();
    await dropPartner();

    const prisma = getPrisma();
    // 실검색을 태우므로 회원 일일 한도를 먹는다 — 자기 몫만 비운다.
    await prisma.spBomSupplierDailyUsage.deleteMany({ where: { mbId: customerId } });
    await prisma.spPartner.create({
      data: {
        type: 'partner',
        name: PARTNER_NAME,
        country: 'KR',
        defaultCurrency: 'KRW',
        capabilities: ['bom_rfq', 'part_sale'],
        status: 'approved',
        members: { create: { mbId: PARTNER_OWNER, role: 'owner' } },
      },
    });
    const uploaded = await uploadFile(
      owner(),
      '/api/partner/parts/uploads',
      fixture('partner-stock-eureka-sample.csv'),
      'partner-stock-eureka-sample.csv',
    );
    expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(201);
    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(uploaded.json.data.upload.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);

    customer = await newPhpSession(creds);
  }, 300_000);

  afterAll(async () => {
    await dropQuotes();
    await dropPartner();
    await closeBrowser();
    await disconnectPrisma();
  }, 180_000);

  test('고객: 협력사 품번이 섞인 BOM 을 올려 공급사 검색을 끝낸다', async () => {
    const token = await customerToken();
    const created = await uploadFile(token, '/api/bom/quotes', fixture(BOM_FILE), BOM_FILE, {
      procurementMode: 'sample',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    quoteId = created.json.data.quoteId as string;

    let prepared: any = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await api(token, 'POST', `/api/bom/quotes/${quoteId}/prepare`);
      if (res.status === 200 && res.json.data.buildStatus !== 'parsing') {
        prepared = res.json.data;
        break;
      }
      await sleep(1_000);
    }
    expect(prepared?.buildStatus, '파싱이 끝나야 한다').toBe('selecting');
    const sheetIndexes = (prepared.sheets as any[])
      .filter((sheet) => sheet.status === 'parsed')
      .map((sheet) => sheet.sheetIndex);
    const built = await api(token, 'POST', `/api/bom/quotes/${quoteId}/build`, { sheetIndexes });
    expect(built.status, JSON.stringify(built.json)).toBe(200);

    let searchStatus: string | null = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const res = await api(token, 'GET', `/api/bom/quotes/${quoteId}/supplier-search`);
      searchStatus = res.json?.data?.status ?? null;
      if (searchStatus === 'completed' || searchStatus === 'failed') break;
      await sleep(2_000);
    }
    expect(searchStatus, '공급사 검색이 끝나야 한다').toBe('completed');

    // ⚠ status=completed 여도 견적 행 투영은 한 박자 뒤다 — 근거가 붙을 때까지 기다린다.
    let detail: any = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await api(token, 'GET', `/api/bom/quotes/${quoteId}`);
      const items = (res.json?.data?.items ?? []) as any[];
      if (items.length > 0 && items.some((item) => item.matchEvidence !== null)) {
        detail = res.json.data;
        break;
      }
      await sleep(1_000);
    }
    expect(detail, '견적 행 투영이 끝나야 한다').not.toBeNull();
    itemsByMpn = new Map(
      (detail.items as any[]).map((item) => [String(item.mpn).toUpperCase(), item]),
    );

    // 실공급사 행 — 금액이 선다(자동 선정).
    const priced = itemsByMpn.get(PRICED_MPN);
    expect(priced?.lineTotalKrw, `${PRICED_MPN} 은 금액이 서야 한다`).not.toBeNull();
    expect(Number(priced?.lineTotalKrw ?? 0)).toBeGreaterThan(0);

    // 협력사만 가진 행 — 근거는 붙되 **금액은 없다**. 가격은 RFQ 회신이 정본이다.
    for (const mpn of PARTNER_ONLY) {
      const item = itemsByMpn.get(mpn.toUpperCase());
      const stock = item?.matchEvidence?.partnerStock ?? null;
      expect(stock, `${mpn}: 협력사 근거가 붙어야 한다`).not.toBeNull();
      expect(stock.partnerCount).toBeGreaterThanOrEqual(1);
      expect(stock.partnerIds, `${mpn}: 고객 응답에 조직 식별자가 있으면 안 된다 (P5)`).toEqual([]);
      expect(item.lineTotalKrw, `${mpn}: 협력사 행은 금액을 만들지 않는다`).toBeNull();
    }
    // 아무도 없는 행 — 근거도 금액도 없다(오탐 대조군).
    const nobody = itemsByMpn.get(NOBODY);
    expect(nobody?.matchEvidence?.partnerStock ?? null).toBeNull();
    expect(nobody?.lineTotalKrw ?? null).toBeNull();
  }, 900_000);

  test('고객 화면: 견적 상세 어디에도 협력사 이름이 없다 (P5)', async () => {
    await customer.page.goto(`/app/bom/${quoteId}`, { waitUntil: 'networkidle' });
    await customer.page.waitForSelector(`text=${PRICED_MPN}`, { timeout: 30_000 });
    await customer.page.waitForTimeout(1_500);
    const body = await customer.page.locator('body').innerText();
    expect(body.includes(PARTNER_NAME), '고객 견적 상세에 협력사 이름이 샜다').toBe(false);
    await snap(customer.page, 'journey-bom-order-customer-quote');
    expect(customer.pageErrors, customer.pageErrors.join('\n')).toEqual([]);
  }, 120_000);

  test('견적요청 → 관리자 확정 → 주문: 협력사 0원 행이 합계에 섞이지 않는다', async () => {
    const token = await customerToken();
    const requested = await api(token, 'POST', `/api/bom/quotes/${quoteId}/request`, {
      title: '[e2e 협력사 BOM 주문] 실공급사+협력사 혼합',
    });
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);

    // 관리자에게는 이름이 보인다 — 고객과 갈리는 지점.
    const holders = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}/partner-stock`);
    expect(holders.status).toBe(200);
    const names = Object.values(holders.json.data.itemHolders as Record<string, any[]>)
      .flat()
      .map((holder: { partnerName: string }) => holder.partnerName);
    expect(names, '관리자에게는 조직 이름이 보인다').toContain(PARTNER_NAME);

    const toReviewing = await api(admin(), 'PATCH', `/api/admin/bom-quotes/${quoteId}`, {
      status: 'reviewing',
    });
    expect(toReviewing.status, JSON.stringify(toReviewing.json)).toBe(200);
    const detail = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const itemIds = (detail.json.data.items as any[]).map((item) => String(item.id));
    const reviewed = await api(admin(), 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
      itemIds,
      completed: true,
      expectedQuoteUpdatedAt: detail.json.data.updatedAt,
    });
    expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);

    // 확정 전 주문은 막힌다.
    const tooEarly = await api(token, 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(tooEarly.status).toBe(409);

    // 확정가는 사람이 정한다 — 협력사 행이 0 인 것을 보고 회신 기준으로 넣는 값이다.
    const completed = await api(admin(), 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      confirmedTotal: 250_000,
      answerNote: '협력사 보유분은 견적요청 회신 기준으로 반영했습니다.',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const ordered = await api(token, 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(ordered.status, `주문: ${JSON.stringify(ordered.json)}`).toBe(200);

    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.findUniqueOrThrow({
      where: { id: BigInt(quoteId) },
      select: { ctId: true, status: true },
    });
    expect(quote.status).toBe('answered');
    expect(quote.ctId, '견적이 장바구니 행에 묶여야 한다').not.toBeNull();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_price, io_price, ct_status FROM g5_shop_cart WHERE ct_id = ?`,
      Number(quote.ctId),
    );
    expect(rows.length, '실제 g5 장바구니 행이 있어야 한다').toBe(1);
    // 금액은 옵션가(io_price)에 실린다 — 관리자 확정가 ×1.1. 협력사 0원 행이 안 섞였다는 뜻.
    expect(Number(rows[0].io_price)).toBe(Math.round(250_000 * 1.1));
    expect(String(rows[0].ct_status)).toBe('쇼핑');
  }, 300_000);
});
