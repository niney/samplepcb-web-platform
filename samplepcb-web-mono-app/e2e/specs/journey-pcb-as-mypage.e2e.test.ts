// 여정 44호 — PCB 처음부터 끝까지 + **마이페이지 "A/S 접수" 진입점으로 A/S 완주**
//
// 앞부분은 여정 1호(거버 → RFQ → 주문·입금 → 발주 → EQ 고객확인(PHP) → 생산 → 국제 발송 →
// 입고 → 배송 → 완료)를 그대로 밟는다. 새로 검증하는 것은 그 뒤다:
//   ① 마이페이지 [문의 > A/S 접수](/shop/as)의 **접수할 주문**에 방금 완료된 주문이 뜬다
//   ② [접수하기] 딥링크 → 주문 상세 A/S 폼(사진 동반 multipart) → 접수 — **실 브라우저 UI**
//   ③ /shop/as 접수 내역·회색 배지·[내용 보기] 앵커 착지, 접수할 주문에서는 빠짐(활성 1건)
//   ④ 관리자 검토(검토 중 이 마이페이지에 그대로) → 판정(재생산) → A/S 케이스 → 협력사 수락
//      → 회차 발주 → 회차 EQ·생산·발송·입고(재발송 완주)
//   ⑤ 종결 뒤 /shop/as: 진행 중 0(배지 사라짐)·전체에 '처리 완료 · 답변 있음(재생산)'·
//      **재접수 개방**(접수할 주문에 다시 선다) · 주문 상세에 답변 본문
//
// 실행: pnpm -F e2e journey:asmypage   (PORTAL_E2E=1 + JOURNEY=1)
// 남기기: JOURNEY_KEEP=1 이면 정리하지 않고 대장만 출력한다.
// 사전: nginx · API(3333) · 웹(5173) · 거버(8040) · Mailpit · e2e/.env.e2e 고객 자격.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  monoRoot,
  newPhpSession,
  newSession,
  num,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const KEEP = process.env.JOURNEY_KEEP === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');
const PROJECT = 'arduino-uno.zip';
const PARTNER_NAME = '협력2';

describe.skipIf(!RUN || !JOURNEY)('여정 44호 — PCB 완주 + 마이페이지 A/S 접수 진입점', () => {
  const rp = createJourneyReport('as-mypage', '여정 44호 — PCB 완주 + 마이페이지 A/S 접수');
  const { F, ledger, view, shot } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let claimId = '';
  let claimVersion = 0;
  let asCaseId: number | null = null;
  let roundPoId: number | null = null;
  let orderQty = 0;

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileField: string,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set(fileField, new File([bytes], fileName, { type: contentType }));
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, json };
  };

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 발주서 하나를 EQ 승인요청 → 고객확인 없이 관리자 승인 → 생산 → 국제 발송 → 입고까지. */
  const runPoToReceived = async (targetPoId: number, tag: string): Promise<void> => {
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(targetPoId)}/eq-request`, {});
    expect(req.status, `${tag} EQ 승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(targetPoId)}/eq-approve`,
      {},
    );
    expect(ap.status, `${tag} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(targetPoId)}/production-start`, {});
    expect(st.status, `${tag} 생산 시작: ${JSON.stringify(st.json)}`).toBe(200);
    const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(targetPoId)}/production-complete`, {});
    expect(done.status, `${tag} 생산 완료: ${JSON.stringify(done.json)}`).toBe(200);

    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: targetPoId });
    expect(box.status, `${tag} 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(targetPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'file',
      `invoice-${tag}.pdf`,
      pdf,
      'application/pdf',
    );
    expect(up.status, `${tag} invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(targetPoId)}/shipment/advance`, {
      shipDate: '2026-09-01',
    });
    expect(reqd.status, `${tag} 선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(targetPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: `J44-${tag}`, trackingUrl: null },
      );
      if (adv.status !== 200) {
        if (adv.json?.error === 'ALREADY_FINAL') break;
        throw new Error(`${tag} 발송 체인 중단: ${JSON.stringify(adv.json)}`);
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(targetPoId)}/shipment/receive`,
      { note: `[여정 44호] ${tag} 입고` },
    );
    expect(recv.status, `${tag} 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
  };

  /** /shop/as 를 읽어 구조화 — 사이드바 배지·접수할 주문·접수 내역. */
  const readAsPage = async (query = ''): Promise<{
    badge: number | null;
    badgeRed: boolean;
    claimable: { name: string; odId: string; href: string }[];
    claims: { id: string; status: string; hasReply: boolean; href: string }[];
    forms: number;
  }> => {
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/as${query}`, { waitUntil: 'networkidle' });
    return page.evaluate(() => {
      const link = [...document.querySelectorAll('.smb_nav a')].find(
        (a) => a.querySelector('.lbl')?.textContent?.trim() === 'A/S 접수',
      );
      const badgeEl = link?.querySelector('.nav_badge');
      return {
        badge: badgeEl === null || badgeEl === undefined ? null : Number(badgeEl.textContent?.trim() ?? 0),
        badgeRed: badgeEl?.classList.contains('on') ?? false,
        claimable: [...document.querySelectorAll('#sp-as-claimable .sp-eqm__item')].map((li) => ({
          name: li.querySelector('.sp-eqm__proj')?.textContent?.trim() ?? '',
          odId: (li.querySelector('.sp-eqm__sub')?.textContent ?? '').match(/주문 (\d+)/)?.[1] ?? '',
          href: (li.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href ?? '',
        })),
        claims: [...document.querySelectorAll('#sp-as-claims .sp-eqm__item')].map((li) => ({
          id: ((li.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href ?? '').match(/#as-(\d+)/)?.[1] ?? '',
          status: li.querySelector('.sp_eq_badge')?.textContent?.trim() ?? '',
          hasReply: (li.querySelector('.sp-eqm__meta')?.textContent ?? '').includes('답변 있음'),
          href: (li.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href ?? '',
        })),
        forms: document.querySelectorAll('.sp-asm form').length,
      };
    });
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    if (KEEP || specId === null) {
      console.log(`[여정 44호] 남김 — spec ${String(specId)} · 주문 ${String(odId)} · claim ${claimId} · case ${String(asCaseId)}`);
    } else {
      // 정리 순서(1호 실증): 주문을 '주문'으로 내려 재고 복원 → g5 삭제 → sp_* 삭제.
      const prisma = getPrisma();
      if (odId !== null) {
        await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '주문' });
      }
      const sid = BigInt(specId);
      const claims = await prisma.spPcbClaim.findMany({ where: { specId: sid }, select: { id: true } });
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_claim', refId: { in: claims.map((c: any) => c.id) } } });
      await prisma.spPcbClaim.deleteMany({ where: { specId: sid } });
      const cases = await prisma.spPcbAsCase.findMany({ where: { specId: sid }, select: { id: true } });
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_as_case', refId: { in: cases.map((c: any) => c.id) } } });
      await prisma.spPcbAsCase.deleteMany({ where: { specId: sid } });
      const pos = await prisma.spPcbPo.findMany({ where: { specId: sid }, select: { id: true } });
      const poIds = pos.map((p: any) => p.id);
      const ships = await prisma.spPcbShipment.findMany({ where: { poId: { in: poIds } }, select: { id: true } });
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_shipment', refId: { in: ships.map((s: any) => s.id) } } });
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: { in: poIds } } });
      await cleanupPcbPos(poIds); // eq_review 는 PO cascade
      await prisma.spPcbRfq.deleteMany({ where: { specId: sid } });
      await prisma.spMailLog.deleteMany({ where: { refType: 'pcb_spec', refId: String(specId) } });
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: sid }, select: { quoteId: true, ctId: true } });
      if (odId !== null) {
        await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_cart WHERE od_id = ?`, odId);
        await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_order WHERE od_id = ?`, odId);
      }
      await prisma.spFile.deleteMany({ where: { refType: 'sp_order_spec', refId: sid } });
      await prisma.spOrderSpec.deleteMany({ where: { id: sid } });
      if (spec?.quoteId) await prisma.spQuote.deleteMany({ where: { id: spec.quoteId } });
      const residue = await countPcbResidue(poIds);
      expect(residue, '발주 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    }
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  // ── 1부: 여정 1호 경로(거버 → 완료) ─────────────────────────────────────────

  test('S1. 고객: 거버 업로드 → 견적요청 → 관리자 RFQ → 협력사 회신 → 선정+확정가', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: PROJECT,
      memo: '[여정 44호] 완주 + 마이페이지 A/S — 정리 예정',
      prefix: 'S01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    rfqId = (r.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId ?? null;
    expect(rfqId).not.toBeNull();
    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 300,
      quotedDeliveryDate: '2026-09-10',
      memo: '[여정 44호] 회신',
    });
    expect(reply.status, JSON.stringify(reply.json)).toBe(200);
    let sel = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`, {
      finalPrice: 55_000,
    });
    if (sel.status === 400) {
      sel = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`, {
        exchangeRate: 1400,
        finalPrice: 55_000,
      });
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 240_000);

  test('S2. 고객 주문(무통장) → 관리자 입금확인 → 발주서 발행', async (ctx) => {
    if (specId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'S2',
      prefix: 'S02',
      buyerName: 'e2e여정44',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId}`);
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id))?.poId ?? null;
    expect(poId).not.toBeNull();
    ledger.push(`sp_pcb_po #${String(poId)}`);
    const spec = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    orderQty = Number(spec?.qty ?? 0);
    expect(orderQty, '주문 수량').toBeGreaterThan(0);
  }, 240_000);

  test('S3. EQ 승인요청 → 고객확인 요청 → 고객 주문내역에서 승인(PHP) → 관리자 승인 → 생산·발송·입고', async (ctx) => {
    if (poId === null || odId === null) return ctx.skip();
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);
    const create = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 44호] 사양 확인 부탁드립니다',
      dueOn: '2026-09-05',
      sharedFileIds: [],
    });
    expect(create.status, `고객확인 요청: ${JSON.stringify(create.json)}`).toBe(200);

    // 고객: 제조 확인 메뉴에서 시작 — 배지 1 → 목록 → 주문 상세 승인(P4.1-b 진입점도 함께 태운다)
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/eq`, { waitUntil: 'networkidle' });
    await shot(customer, 'S03-eq-mypage');
    const eqLink = page.locator('#sp_eq_wrap, .sp-eqm').first();
    expect(await eqLink.count()).toBeGreaterThan(0);
    await page.locator('.sp-eqm__go').first().click();
    await page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 });
    await page.locator('.sp_eq_approve').first().click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    const rv = await getPrisma().spPcbEqReview.findFirst({ where: { poId: BigInt(poId) }, orderBy: { id: 'desc' } });
    expect(rv?.status, 'EQ 고객 승인 DB 반영').toBe('approved');

    const ap = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`, {});
    expect(ap.status, JSON.stringify(ap.json)).toBe(200);
    const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {});
    expect(st.status).toBe(200);
    const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {});
    expect(done.status).toBe(200);
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(P, `/api/partner/pcb-pos/${String(poId)}/shipment/files`, { fileType: 'invoice' }, 'file', 'invoice-r0.pdf', pdf, 'application/pdf');
    expect(up.status, `invoice: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, { shipDate: '2026-08-28' });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/advance`, { carrier: 'DHL', trackingNumber: 'J44-R0', trackingUrl: null });
      if (adv.status !== 200) {
        if (adv.json?.error === 'ALREADY_FINAL') break;
        throw new Error(`발송 체인 중단: ${JSON.stringify(adv.json)}`);
      }
    }
    const recv = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/receive`, { note: '[여정 44호] 입고' });
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
  }, 240_000);

  test('S4. 관리자: 고객 배송(운송장) → 완료 — 배송 전엔 A/S 접수 불가·완료 뒤 접수할 주문에 선다', async (ctx) => {
    if (odId === null) return ctx.skip();
    // 배송 전: 마이페이지 접수할 주문에 없어야 한다(NOT_DELIVERED 게이트).
    const before = await readAsPage();
    expect(before.claimable.some((c) => c.odId === odId), '배송 전인데 접수할 주문에 있음').toBe(false);

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: { deliveryCompany: 'CJ대한통운', invoiceNo: 'J44-D', invoiceTime: '2026-08-25 18:00:00' },
    });
    expect(ship.status, `배송 전이: ${JSON.stringify(ship.json)}`).toBe(200);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(fin.status, `완료 전이: ${JSON.stringify(fin.json)}`).toBe(200);

    const after = await readAsPage();
    await shot(customer, 'S04-as-claimable');
    const row = after.claimable.find((c) => c.odId === odId);
    expect(row, '완료 주문이 접수할 주문에 없음').toBeTruthy();
    expect(row?.name).toBe(PROJECT);
    expect(row?.href).toContain(`orderinquiryview.php?od_id=${odId}#sp_as_wrap`);
    expect(after.badge, '접수 전 배지 없음').toBeNull();
    expect(after.forms, '목록 페이지에 폼 없음').toBe(0);
    F('S4', 'obs', `완료 주문 ${odId} 이 접수할 주문에 등장`);
  }, 120_000);

  // ── 2부: 마이페이지 A/S 접수 진입점으로 완주 ────────────────────────────────

  test('A1. 고객: [접수하기] 딥링크 → 주문 상세 A/S 폼(사진 동반) → 접수', async (ctx) => {
    if (odId === null || specId === null) return ctx.skip();
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/as`, { waitUntil: 'networkidle' });
    const go = page.locator('#sp-as-claimable .sp-eqm__item', { hasText: odId }).locator('.sp-eqm__go');
    await Promise.all([page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }), go.click()]);
    await page.waitForLoadState('domcontentloaded');
    expect(page.url(), '접수하기 딥링크').toContain('#sp_as_wrap');

    const wrap = page.locator(`#sp_as_wrap .sp_eq_item`, { hasText: PROJECT }).first();
    await wrap.locator('details.sp_as_form_wrap summary').click();
    await shot(customer, 'A01-as-form-open');
    const form = wrap.locator('form.sp_as_form');
    // 1차 주행 캡처가 잡은 결함 — 증상 설명 textarea 가 EQ 폼 규칙(.sp_eq_form textarea)만 타서
    // A/S 폼에선 인라인 기본 크기로 찌그러졌다. 폼 폭 대비 90% 이상을 못박는다.
    const ratio = await form.evaluate((f) => {
      const ta = f.querySelector('textarea[name=description]') as HTMLElement | null;
      return ta === null ? 0 : ta.offsetWidth / (f as HTMLElement).offsetWidth;
    });
    expect(ratio, '증상 설명 칸이 폼 폭을 채운다').toBeGreaterThan(0.9);
    await form.locator('select[name=kind]').selectOption('quality');
    await form.locator('input[name=affected_qty]').fill(String(Math.min(2, orderQty)));
    await form.locator('select[name=requested_remedy]').selectOption('reproduce');
    await form.locator('textarea[name=description]').fill('[여정 44호] 5장 중 2장이 전원 인가 시 동작하지 않습니다.');
    await form.locator('input[name="photos[]"]').setInputFiles({
      name: 'defect.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    await form.locator('input[name=acknowledge]').check();
    // 이미 orderinquiryview 에 있으므로 waitForURL 은 즉시 풀린다 — **다음** 내비게이션
    // (claim-create POST → 리다이렉트)을 기다려야 DB 검사가 접수보다 먼저 달리지 않는다.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }),
      form.locator('button[type=submit]').click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await shot(customer, 'A01-as-submitted');

    const claim = await getPrisma().spPcbClaim.findFirst({ where: { specId: BigInt(specId) }, orderBy: { id: 'desc' } });
    expect(claim, '접수 행').toBeTruthy();
    expect(claim?.status).toBe('open');
    expect(claim?.createdByRole).toBe('customer');
    claimId = String(claim?.id);
    claimVersion = Number(claim?.version ?? 1);
    ledger.push(`sp_pcb_claim #${claimId}`);
    const files = await getPrisma().spFile.count({ where: { refType: 'sp_pcb_claim', refId: BigInt(claimId) } });
    expect(files, '사진 첨부 박제').toBe(1);
    F('A1', 'obs', `고객 UI 접수 — claim #${claimId} (사진 ${String(files)}장)`);
  }, 120_000);

  test('A2. /shop/as — 접수 내역·회색 배지 1·접수할 주문에서 빠짐·[내용 보기] 앵커 착지', async (ctx) => {
    if (claimId === '') return ctx.skip();
    const v = await readAsPage();
    await shot(customer, 'A02-as-listed');
    expect(v.badge, '진행 중 배지').toBe(1);
    expect(v.badgeRed, '회색 배지').toBe(false);
    expect(v.claimable.some((c) => c.odId === odId), '활성 접수 중엔 접수할 주문에서 빠진다').toBe(false);
    const row = v.claims.find((c) => c.id === claimId);
    expect(row, '접수 내역 행').toBeTruthy();
    expect(row?.status).toBe('접수됨');
    expect(row?.hasReply).toBe(false);

    const { page } = customer;
    await page.goto(row?.href ?? '', { waitUntil: 'networkidle' });
    const landed = await page.evaluate((cid: string) => ({
      row: document.querySelector(`#as-${cid}.sp_as_claim`) !== null,
      closed: document.body.innerText.includes('처리 중인 접수가 있어 새 접수는 잠시 닫혀 있습니다'),
    }), claimId);
    expect(landed.row, '내용 보기 앵커 착지').toBe(true);
    expect(landed.closed, '주문 상세도 활성 1건으로 새 접수를 닫는다').toBe(true);
  }, 120_000);

  test('A3. 관리자 검토 시작 → 마이페이지 "검토 중" → 판정(재생산) → A/S 케이스 자동 생성', async (ctx) => {
    if (claimId === '') return ctx.skip();
    const review = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimId}`, {
      action: 'start_review',
      expectedVersion: claimVersion,
    });
    expect(review.status, JSON.stringify(review.json)).toBe(200);
    claimVersion = Number(review.json?.data?.claim?.version);
    const mid = await readAsPage();
    expect(mid.claims.find((c) => c.id === claimId)?.status, '검토 중 반영').toBe('검토 중');
    expect(mid.badge, '검토 중도 진행 중').toBe(1);
    await view(adminView, '/app/admin/pcb/claims', 'A03-admin-claims');

    const resolve = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimId}`, {
      action: 'resolve',
      expectedVersion: claimVersion,
      resolutionKind: 'reproduce',
      faultType: 'manufacturing',
      response: '제조 불량으로 확인되어 2장 무상 재생산으로 진행합니다. 완제품은 재발송됩니다.',
      targetPartnerId: num(partner.id),
    });
    expect(resolve.status, JSON.stringify(resolve.json)).toBe(200);
    expect(resolve.json?.data?.claim?.status).toBe('resolved');
    asCaseId = resolve.json?.data?.claim?.asCaseId ?? null;
    expect(asCaseId, 'A/S 케이스 자동 생성').not.toBeNull();
    ledger.push(`sp_pcb_as_case #${String(asCaseId)}`);
  }, 120_000);

  test('A4. 케이스 전송 → 협력사 수락 → 재발주 진행(회차 1) → 회차 EQ·생산·발송·입고(재발송 완주)', async (ctx) => {
    if (asCaseId === null) return ctx.skip();
    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);
    const pv = await api(P, 'GET', `/api/partner/pcb-as-cases/${String(asCaseId)}`);
    expect(pv.status).toBe(200);
    expect((pv.json?.data?.asCase?.claim?.files ?? []).length, '협력사가 고객 사진을 본다').toBe(1);
    const accept = await api(P, 'POST', `/api/partner/pcb-as-cases/${String(asCaseId)}/accept`, {
      reason: '[여정 44호] 불량 확인 — 재생산 가능',
    });
    expect(accept.status, JSON.stringify(accept.json)).toBe(200);
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/proceed`, {});
    expect(proceed.status, JSON.stringify(proceed.json)).toBe(200);
    expect(proceed.json?.data?.reorderRound).toBe(1);
    roundPoId = Number(proceed.json?.data?.poId ?? 0);
    expect(roundPoId).toBeGreaterThan(0);
    ledger.push(`sp_pcb_po #${String(roundPoId)} (회차 1)`);

    await runPoToReceived(roundPoId, 'R1');
    const round = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(roundPoId) } });
    expect(round?.reorderRound).toBe(1);
    F('A4', 'obs', `회차 1 발주 #${String(roundPoId)} 재발송 입고까지 완주`);
  }, 240_000);

  test('A5. 종결 뒤 /shop/as — 진행 중 0·배지 없음·전체에 처리 완료+답변·재접수 개방·주문 상세 답변', async (ctx) => {
    if (claimId === '') return ctx.skip();
    const open = await readAsPage();
    expect(open.badge, '종결 뒤 배지 없음').toBeNull();
    expect(open.claims.some((c) => c.id === claimId), '진행 중 목록에서 빠짐').toBe(false);
    expect(open.claimable.some((c) => c.odId === odId), '종결로 activeKey 해제 → 재접수 개방').toBe(true);

    const all = await readAsPage('?scope=all');
    await shot(customer, 'A05-as-all');
    const row = all.claims.find((c) => c.id === claimId);
    expect(row?.status).toBe('처리 완료');
    expect(row?.hasReply, '답변 있음 표기').toBe(true);

    const { page } = customer;
    await page.goto(row?.href ?? '', { waitUntil: 'networkidle' });
    await shot(customer, 'A05-orderview-reply');
    const reply = await page.evaluate((cid: string) => document.querySelector(`#as-${cid} .sp_as_reply`)?.textContent ?? '', claimId);
    expect(reply, '주문 상세에 답변 본문').toContain('무상 재생산');
    expect(reply).toContain('재생산(A/S 재발주)');
    // 1차 주행이 잡은 결함 — A/S 접수 버튼이 EQ 스크립트의 .sp_eq_btns 셀렉터에 걸려 TypeError.
    // 제출은 됐지만 콘솔 오류였다. 고객 화면 전 구간 pageerror 0 을 못박는다.
    expect(customer.pageErrors, '고객 화면 pageerror').toEqual([]);
    F('A5', 'obs', '마이페이지 A/S 접수 진입점으로 접수→검토→재생산 회차→종결까지 완주');
  }, 120_000);
});
