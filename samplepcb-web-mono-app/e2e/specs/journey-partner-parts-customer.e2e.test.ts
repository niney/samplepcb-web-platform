/**
 * 협력사 보유 부품 — 고객 여정 (docs/PARTNER_PARTS.md)
 *
 * 지금까지의 검증은 전부 **관리자 토큰**으로 했다. 그래서 안 본 자리가 셋 남았고,
 * 셋 다 조각 테스트로는 안 드러나는 **경계**에 있다(이번 기능의 결함이 전부 경계에서 나왔다).
 *
 *  ① 고객 세션에서 조직 이름이 새지 않는가 (P5)
 *     — 마스킹은 서버 코드로 확인했지만 **고객 계정으로 화면을 본 적이 없다**.
 *       화면이 다른 경로(후보·카트·견적 상세)로 이름을 끌어올 수 있다. 정책 위반은
 *       바로 사업 리스크라 실제 세션으로 본다.
 *  ② 금액 없는 협력사 행이 주문으로 새지 않는가
 *     — 게이트가 막을 거라 **믿고만** 있었다. 돈이 걸린 자리는 믿지 말고 태운다.
 *  ③ 두 협력사가 같은 신규 품번을 **동시에** 반영하면
 *     — 인제스트는 `upsertWithRaceRecovery` 로 방어하는데 투영은 안 쓴다(코드 갭).
 *
 * 실행: pnpm -F e2e e2e journey-partner-parts-customer   (PORTAL_E2E=1 · API + sp-engine)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  newSession,
  signJwt,
  snap,
} from '../helpers';

const PARTNER_A = 'e2e여정협력A';
const PARTNER_B = 'e2e여정협력B';
const OWNER_A = 'e2e-journey-owner-a';
const OWNER_B = 'e2e-journey-owner-b';
const CUSTOMER = 'e2e-journey-buyer';

// 두 협력사가 **같은 신규 품번**을 갖는다 — ③ 동시 반영이 이 겹침에서 터진다.
const SHARED_MPN = 'ZZJOURNEY-SHARED-0001';
// 한 품번만 겹치면 임계 구간이 찰나라 경합이 재현되지 않는다 — 겹치는 품번을 넓힌다.
const SHARED_BULK = Array.from(
  { length: 60 },
  (_unused, index) => `ZZJOURNEY-BULK-${String(index).padStart(4, '0')}`,
);
const ONLY_A = 'ZZJOURNEY-ONLYA-0002';

const csvFor = (mpns: readonly string[]): string =>
  ['Parts No.,Brand,QTY.,Lead Time', ...mpns.map((mpn) => `${mpn},Acme Semi,777,Stock`)].join('\n');

const admin = (): string => signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
const owner = (mbId: string): string => signJwt({ mbId, ttlSec: 7_200 });
const buyer = (): string => signJwt({ mbId: CUSTOMER, ttlSec: 7_200 });

let quoteId: string;

const uploadCsv = async (token: string, path: string, csv: string, filename: string) => {
  const form = new FormData();
  form.append('file', new File([csv], filename, { type: 'text/csv' }));
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, json: (await res.json()) as any };
};

const createPartner = async (name: string, mbId: string): Promise<bigint> => {
  const prisma = getPrisma();
  const created = await prisma.spPartner.create({
    data: {
      type: 'partner',
      name,
      country: 'KR',
      defaultCurrency: 'KRW',
      capabilities: ['bom_rfq', 'part_sale'],
      status: 'approved',
      members: { create: { mbId, role: 'owner' } },
    },
  });
  return created.id;
};

const dropPartner = async (name: string): Promise<void> => {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findFirst({ where: { name } });
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

const dropQuotes = async (): Promise<void> => {
  const prisma = getPrisma();
  const quotes = await prisma.spBomQuote.findMany({
    where: { mbId: CUSTOMER },
    select: { id: true },
  });
  for (const quote of quotes) {
    await prisma.spBomSupplierSearchTrace.deleteMany({
      where: { supplierSearchRun: { quoteId: quote.id } },
    });
    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: { activeSupplierSearchRunId: null },
    });
    await prisma.spBomSupplierSearchRun.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteSelectionEvent.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteCandidate.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }
};

describe.skipIf(!RUN)('협력사 보유 부품 — 고객 여정', () => {
  beforeAll(async () => {
    const engine = await fetch(`${BOM_ENGINE_URL}/health`).catch(() => null);
    if (engine === null || !engine.ok) {
      throw new Error(`sp-engine(${BOM_ENGINE_URL}) 이 떠 있어야 합니다 — ./run.sh`);
    }
    await dropQuotes();
    await dropPartner(PARTNER_A);
    await dropPartner(PARTNER_B);
    await createPartner(PARTNER_A, OWNER_A);
    await createPartner(PARTNER_B, OWNER_B);
  }, 180_000);

  afterAll(async () => {
    await dropQuotes();
    await dropPartner(PARTNER_A);
    await dropPartner(PARTNER_B);
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  // ── ③ 동시 반영 ────────────────────────────────────────────────────────────
  test('두 협력사가 같은 신규 품번을 동시에 반영해도 부품은 하나다', async () => {
    const prisma = getPrisma();
    const uploads = await Promise.all([
      uploadCsv(owner(OWNER_A), '/api/partner/parts/uploads', csvFor([SHARED_MPN, ONLY_A, ...SHARED_BULK]), 'a.csv'),
      uploadCsv(owner(OWNER_B), '/api/partner/parts/uploads', csvFor([SHARED_MPN, ...SHARED_BULK]), 'b.csv'),
    ]);
    for (const uploaded of uploads) expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(201);

    // 같은 순간에 반영한다 — 카탈로그 부품 생성이 겹치는 지점이다.
    const commits = await Promise.all(
      uploads.map((uploaded, index) =>
        api(
          owner(index === 0 ? OWNER_A : OWNER_B),
          'POST',
          `/api/partner/parts/uploads/${String(uploaded.json.data.upload.uploadId)}/commit`,
          { mode: 'replace' },
        )),
    );
    for (const commit of commits) {
      expect(commit.status, `동시 반영이 실패하면 안 된다: ${JSON.stringify(commit.json)}`).toBe(200);
    }

    // 부품은 하나, 구매 조건은 둘 — 유니크 충돌로 한쪽이 죽으면 안 된다.
    const parts = await prisma.spPart.findMany({
      where: { mpnNorm: 'ZZJOURNEYSHARED0001' },
      select: { id: true },
    });
    expect(parts.length, '같은 품번이 두 레코드로 갈리면 안 된다').toBe(1);
    const offers = await prisma.spPartOffer.count({
      where: { supplier: 'partner', partId: parts[0]?.id },
    });
    expect(offers, '두 협력사의 구매 조건이 모두 서야 한다').toBe(2);

    // 겹친 60 품번 전부 같은 계약을 지켜야 한다 — 하나라도 갈리면 경합이 샌 것이다.
    const bulkNorms = SHARED_BULK.map((mpn) => mpn.replace(/[^0-9A-Za-z]/g, '').toUpperCase());
    const bulkParts = await prisma.spPart.groupBy({
      by: ['mpnNorm'],
      where: { mpnNorm: { in: bulkNorms } },
      _count: { _all: true },
    });
    expect(bulkParts.length, '겹친 품번이 모두 카탈로그에 서야 한다').toBe(SHARED_BULK.length);
    for (const group of bulkParts) {
      expect(group._count._all, `${group.mpnNorm} 가 두 레코드로 갈렸다`).toBe(1);
    }
  }, 300_000);

  // ── ① 고객 세션 노출 ───────────────────────────────────────────────────────
  test('단일검색 Distributor에는 협력사명이 보이고 카트에는 공급망 상세가 이어지지 않는다 (P5)', async () => {
    const session = await newSession({ mbId: CUSTOMER });
    try {
      await session.page.goto('/app/bom/search', { waitUntil: 'networkidle' });
      const input = session.page.locator('input[type=search], input[type=text]').first();
      await input.waitFor({ state: 'visible', timeout: 20_000 });
      await input.fill(SHARED_MPN);
      await input.press('Enter');
      await session.page.waitForTimeout(3_000);

      const section = session.page.locator('section', { hasText: '협력사 보유' }).first();
      expect(await section.isVisible(), '고객에게도 보유 사실은 보인다').toBe(true);

      // 정책 변경: 단일검색 Distributor에는 현재 보유 협력사명을 명시한다.
      const body = await session.page.locator('body').innerText();
      for (const name of [PARTNER_A, PARTNER_B]) {
        expect(body.includes(name), `단일검색 Distributor에 협력사명이 있어야 한다: ${name}`).toBe(true);
      }
      await snap(session.page, 'journey-customer-search');

      // RFQ로 담은 뒤에도 카트는 특정 협력사를 선정한 상태가 아니므로 일반 표기를 유지한다.
      await section.locator('button', { hasText: 'RFQ' }).first().click();
      await session.page.waitForTimeout(2_500);
      const afterAdd = await session.page.locator('aside', { hasText: '부품 견적' }).innerText();
      for (const name of [PARTNER_A, PARTNER_B]) {
        expect(afterAdd.includes(name), `카트가 특정 협력사를 선정한 것처럼 보이면 안 된다: ${name}`).toBe(false);
      }
      await snap(session.page, 'journey-customer-cart');
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
    }

    // API도 이름만 공개하고 조직 식별자·연락처·개별 재고는 내리지 않는다.
    const search = await api(
      buyer(),
      'GET',
      `/api/bom/parts-search?q=${encodeURIComponent(SHARED_MPN)}&needed=1`,
    );
    const hit = (search.json.data.items as any[]).find((item) => item.mpn === SHARED_MPN);
    expect(hit?.hasPartnerStock).toBe(true);
    expect(hit?.partnerStock?.partnerCount, '곳 수는 보인다').toBe(2);
    expect(hit?.partnerStock?.partnerNames).toEqual(expect.arrayContaining([PARTNER_A, PARTNER_B]));
    expect(hit?.partnerStock).not.toHaveProperty('partnerIds');
    expect(hit?.partnerStock).not.toHaveProperty('contactEmail');
  }, 300_000);

  // ── ② 주문 게이트 ──────────────────────────────────────────────────────────
  test('금액 없는 협력사 행은 확정 전에 주문으로 새지 않는다', async () => {
    const prisma = getPrisma();
    const cart = await prisma.spBomQuote.findFirstOrThrow({
      where: { mbId: CUSTOMER, sourceKind: 'single_search' },
      select: { id: true, items: { select: { mpn: true, lineTotalKrw: true, selectionSource: true } } },
    });
    quoteId = String(cart.id);
    expect(cart.items.length, '앞 케이스가 담은 협력사 행이 있어야 한다').toBeGreaterThan(0);
    const partnerRow = cart.items.find(
      (row: { selectionSource: string; lineTotalKrw: unknown }) => row.selectionSource === 'partner',
    );
    expect(partnerRow, '협력사 행이 담겨 있어야 한다').toBeDefined();
    expect(partnerRow?.lineTotalKrw, '가격을 만들지 않는다').toBeNull();

    // ① 확정가 없이 주문 → 막힌다. 게이트는 라인 단위가 아니라 **관리자 확정가**다.
    const tooEarly = await api(buyer(), 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(tooEarly.status, JSON.stringify(tooEarly.json)).toBe(409);
    expect(['NOT_ANSWERED', 'NOT_CONFIRMED', 'NO_CART_ID']).toContain(tooEarly.json.error);

    // ② 견적요청 후에도 확정 전이면 여전히 막힌다.
    const requested = await api(buyer(), 'POST', `/api/bom/quotes/${quoteId}/request`, {
      title: '협력사 보유 여정 견적',
    });
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    const stillBlocked = await api(buyer(), 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(stillBlocked.status).toBe(409);

    // ③ 관리자 화면에서 이 행은 **문의**로 잡혀야 한다 — 값이 없다는 사실이 확정가를
    //    넣는 사람에게 보여야 0원 행이 조용히 합계에 섞이지 않는다.
    const detail = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    const item = (detail.json.data.items as any[]).find((row) => row.mpn === SHARED_MPN);
    expect(item, '관리자 상세에 그 행이 있어야 한다').toBeDefined();
    expect(item.lineTotalKrw, '금액이 비어 있다').toBeNull();
    // ⚠ 수동으로 담은 행에는 `matchEvidence` 가 없다 — 그건 엔진 검색 투영이 만드는 것이고,
    //    단일검색 담기는 그 경로를 안 탄다. 그래서 '누가 가졌나'는 아래 관리자 전용 조회가
    //    품번으로 따로 찾는다(그 화면의 `협력사 보유 · 이름` 칩도 같은 조회를 쓴다).
    //    관리자가 확정가를 넣을 때 필요한 신호는 **금액이 비었다**는 사실이고 그건 위에서 봤다.
    expect(item.matchEvidence?.partnerStock ?? null, '수동 담기 행은 엔진 근거가 없다').toBeNull();
    // 관리자에게는 이름이 보인다(고객과 갈리는 지점).
    const holders = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}/partner-stock`);
    const names = Object.values(holders.json.data.itemHolders as Record<string, any[]>)
      .flat()
      .map((holder: { partnerName: string }) => holder.partnerName);
    expect(names, '관리자에게는 조직 이름이 보인다').toContain(PARTNER_A);
  }, 300_000);
});
