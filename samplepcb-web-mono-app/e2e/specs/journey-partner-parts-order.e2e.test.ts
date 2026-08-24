/**
 * 협력사 보유 부품 — 단일검색 담기부터 **실제 주문 완주**까지 (docs/PARTNER_PARTS.md)
 *
 * 앞선 고객 여정은 "확정 전에는 막힌다"까지만 봤다. 막히는 것은 봤으니 이제 **열리는 것**을
 * 본다 — 가격 있는 실공급사 부품과 가격 없는 협력사 부품을 **한 카트에 섞어** 담고,
 * 관리자가 확정가를 넣은 뒤 고객이 주문까지 가는 한 줄이다.
 *
 * 왜 섞어서 보나: 협력사 행만 있으면 "금액이 없으니 막힌다"만 확인된다. 섞였을 때
 * **실공급사 금액은 살고 협력사 행은 0 으로 남는지**, 그리고 그 상태로 주문이 서는지가
 * 진짜 질문이다(0원 행이 조용히 합계에 섞이면 돈이 틀어진다).
 *
 * ⚠ 이 스펙은 **실제 g5 장바구니 행**을 만든다. 서명 토큰에는 cartId 클레임이 없어
 * 주문이 NO_CART_ID 로 먼저 끊기므로(여정 10호가 기록한 함정), 화면이 쓰는 경로
 * (/spcb/api/me 세션→JWT 브리지)로 진짜 토큰을 얻는다. 끝나면 카트 행을 지운다.
 *
 * 실행: pnpm -F e2e e2e journey-partner-parts-order   (PORTAL_E2E=1 · API + sp-engine + nginx)
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
  newPhpSession,
  requireCustomerCreds,
  signJwt,
  snap,
  type E2eSession,
} from '../helpers';

const PARTNER_NAME = 'e2e주문협력';
const PARTNER_OWNER = 'e2e-order-owner';

/** 협력사만 가진 품번 — 가격이 없는 행을 만든다. */
const PARTNER_MPN = 'ZZORDER-PARTNERONLY-0001';
/** 실공급사가 가진 흔한 품번 — 가격 있는 행을 만든다(카탈로그에 이미 있다). */
const PRICED_MPN = 'STM32F030F4P6';

const admin = (): string => signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
const owner = (): string => signJwt({ mbId: PARTNER_OWNER, ttlSec: 7_200 });

let customer: E2eSession;
let customerId = '';
let quoteId = '';

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

const dropQuotes = async (): Promise<void> => {
  if (customerId === '') return;
  const prisma = getPrisma();
  const quotes = await prisma.spBomQuote.findMany({
    where: { mbId: customerId, title: { startsWith: '[e2e 협력사 주문]' } },
    select: { id: true },
  });
  for (const quote of quotes) {
    await prisma.spBomQuoteItemReview.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteSelectionEvent.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteCandidate.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }
  // 단일검색 바구니(제목 없는 draft)도 이 스펙이 만든 것만 치운다.
  const carts = await prisma.spBomQuote.findMany({
    where: { mbId: customerId, sourceKind: 'single_search' },
    select: { id: true },
  });
  for (const cart of carts) {
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: cart.id } });
    await prisma.spBomQuote.delete({ where: { id: cart.id } });
  }
};

/** 화면이 쓰는 진짜 토큰 — 서명 토큰에는 cartId 가 없어 주문이 먼저 끊긴다. */
const customerToken = async (): Promise<string> => {
  const token: string = await customer.page.evaluate(() =>
    fetch('/spcb/api/me', { credentials: 'include' })
      .then((response) => response.json())
      .then((me: any) => String(me.token ?? '')),
  );
  expect(token, '고객 세션 토큰(/spcb/api/me)').not.toBe('');
  return token;
};

describe.skipIf(!RUN)('협력사 보유 부품 — 담기부터 주문 완주까지', () => {
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
    const partner = await prisma.spPartner.create({
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
    // 협력사 원장 한 줄 — 카탈로그로 투영되며 색인까지 간다.
    const form = new FormData();
    form.append(
      'file',
      new File([`Parts No.,Brand,QTY.,Lead Time\n${PARTNER_MPN},Acme Semi,555,Stock\n`],
        'order.csv', { type: 'text/csv' }),
    );
    const uploaded = await fetch(`${API_URL}/api/partner/parts/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner()}` },
      body: form,
    });
    const uploadJson: any = await uploaded.json();
    expect(uploaded.status, JSON.stringify(uploadJson)).toBe(201);
    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(uploadJson.data.upload.uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(partner.id).toBeDefined();

    customer = await newPhpSession(creds);
  }, 300_000);

  afterAll(async () => {
    // 실제 장바구니 행을 남기지 않는다.
    // ⚠ 템플릿 상품 id 는 `sp-bom-parts` 다 — `bom%` 로 짚으면 아무것도 안 지워지고
    //    실제 장바구니 행이 남는다(실제로 두 번 남겼다). 견적별 옵션 키로 정확히 짚는다.
    if (quoteId !== '') {
      const prisma = getPrisma();
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_cart WHERE io_id = ?`,
        `bom-${quoteId}`,
      );
    }
    await dropQuotes();
    await dropPartner();
    await closeBrowser();
    await disconnectPrisma();
  }, 180_000);

  test('고객: 실공급사 부품과 협력사 부품을 한 카트에 담는다', async () => {
    const token = await customerToken();
    for (const mpn of [PRICED_MPN, PARTNER_MPN]) {
      const search = await api(
        token,
        'GET',
        `/api/bom/parts-search?q=${encodeURIComponent(mpn)}&needed=5`,
      );
      expect(search.status, `${mpn} 검색: ${JSON.stringify(search.json)}`).toBe(200);
      const hit = (search.json.data.items as any[]).find((item) => item.mpn === mpn);
      expect(hit, `${mpn} 이 검색에 잡혀야 한다`).toBeDefined();

      // 가격 있는 부품은 구매 조건으로, 협력사 부품은 `partner_stock` 으로 담는다.
      const priced = (hit.offerOptions as any[]).find(
        (offer) => offer.offerKind === 'supplier_offer' && offer.applied !== null,
      );
      const selection = mpn === PARTNER_MPN
        ? { kind: 'partner_stock' as const }
        : {
            kind: 'supplier_offer' as const,
            supplier: String(priced?.supplier ?? ''),
            supplierSku: String(priced?.supplierSku ?? ''),
          };
      if (mpn === PRICED_MPN) {
        expect(priced, '실공급사 구매 조건이 있어야 이 여정이 성립한다').toBeDefined();
      }
      const added = await api(token, 'POST', '/api/bom/search-cart/items', {
        partId: hit.id,
        bomQty: 5,
        selection,
      });
      expect(added.status, `${mpn} 담기: ${JSON.stringify(added.json)}`).toBe(200);
    }

    const prisma = getPrisma();
    const cart = await prisma.spBomQuote.findFirstOrThrow({
      where: { mbId: customerId, sourceKind: 'single_search' },
      include: { items: true },
    });
    quoteId = String(cart.id);
    expect(cart.items.length, '두 행이 담겨야 한다').toBe(2);

    // 섞였을 때가 핵심 — 실공급사 행은 금액이 살고, 협력사 행은 비어 있어야 한다.
    interface CartRow { selectionSource: string; lineTotalKrw: unknown }
    const partnerRow = (cart.items as CartRow[]).find((row) => row.selectionSource === 'partner');
    const pricedRow = (cart.items as CartRow[]).find((row) => row.selectionSource !== 'partner');
    expect(partnerRow?.lineTotalKrw, '협력사 행은 금액을 만들지 않는다').toBeNull();
    expect(pricedRow?.lineTotalKrw, '실공급사 행 금액은 살아 있어야 한다').not.toBeNull();
    expect(Number(pricedRow?.lineTotalKrw ?? 0)).toBeGreaterThan(0);
  }, 300_000);

  test('관리자: 검토 → 품목 확인 → 확정가 등록', async () => {
    const token = await customerToken();
    const requested = await api(token, 'POST', `/api/bom/quotes/${quoteId}/request`, {
      title: '[e2e 협력사 주문] 실공급사+협력사 혼합',
    });
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);

    const toReviewing = await api(admin(), 'PATCH', `/api/admin/bom-quotes/${quoteId}`, {
      status: 'reviewing',
    });
    expect(toReviewing.status, JSON.stringify(toReviewing.json)).toBe(200);

    // 품목 확인 — 확인이 남으면 확정이 409 로 막힌다(그 게이트가 이 여정의 앞 관문이다).
    const detail = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const itemIds = (detail.json.data.items as any[]).map((item) => String(item.id));
    const reviewed = await api(admin(), 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
      itemIds,
      completed: true,
      expectedQuoteUpdatedAt: detail.json.data.updatedAt,
    });
    expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);

    // 확정가는 사람이 넣는다 — 협력사 행이 0 이라는 사실을 보고 정하는 값이다.
    const completed = await api(admin(), 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      confirmedTotal: 100_000,
      answerNote: '협력사 보유분은 견적요청 회신 기준으로 반영했습니다.',
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);
  }, 300_000);

  test('고객: 확정 후 주문이 서고 장바구니 행이 실제로 생긴다', async () => {
    const token = await customerToken();
    const ordered = await api(token, 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(ordered.status, `주문: ${JSON.stringify(ordered.json)}`).toBe(200);
    expect(ordered.json.data.redirectUrl, '주문서로 보낸다').toBeTruthy();

    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.findUniqueOrThrow({
      where: { id: BigInt(quoteId) },
      select: { ctId: true, confirmedTotal: true, status: true },
    });
    expect(quote.status).toBe('answered');
    expect(quote.ctId, '견적이 장바구니 행에 묶여야 한다').not.toBeNull();

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_id, ct_price, io_price, ct_qty, ct_status FROM g5_shop_cart WHERE ct_id = ?`,
      Number(quote.ctId),
    );
    expect(rows.length, '실제 g5 장바구니 행이 있어야 한다').toBe(1);
    // ⚠ 영카트 관례 — 본체가는 0 이고 금액은 **옵션가(io_price)** 에 들어간다.
    //    ct_price 를 보면 늘 0 이라 '금액이 안 실렸다'로 오독한다.
    expect(Number(rows[0].ct_price), '본체가는 관례상 0').toBe(0);
    // 관리자 확정가의 부가세 포함액 — 협력사 0원 행이 합계에 섞이지 않았다는 뜻이다.
    expect(Number(rows[0].io_price)).toBe(Math.round(100_000 * 1.1));
    expect(String(rows[0].ct_status), '아직 장바구니 단계').toBe('쇼핑');

    // 두 번 주문하면 같은 행을 갱신한다(중복 담기 금지).
    const again = await api(token, 'POST', `/api/bom/quotes/${quoteId}/order`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const after: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM g5_shop_cart WHERE io_id = ?`,
      `bom-${quoteId}`,
    );
    expect(Number(after[0].c), '재주문이 카트 행을 늘리면 안 된다').toBe(1);

    await customer.page.goto('/app/bom', { waitUntil: 'networkidle' });
    await snap(customer.page, 'journey-partner-order-done');
  }, 300_000);
});
