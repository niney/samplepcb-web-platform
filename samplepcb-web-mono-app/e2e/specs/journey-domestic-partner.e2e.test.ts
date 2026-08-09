// 2호 완주 여정 — **국내 협력사** 경로. 1호(협력2·CN·USD·국제 선적)와 같은 고객 흐름을
// 타지만, 협력사가 국내(KR·KRW)라 갈라지는 지점이 셋이다:
//   ① 선정에 환율이 없다 — KRW 회신은 그대로 원가가 된다(exchangeRate 미전송 경로).
//   ② 선적이 국내 3단계다 — preparing → shipping(협력사: 택배사+송장) → delivered(관리자).
//      국제의 requested(Invoice 필수)·arrived·customs 가 통째로 없다.
//   ③ 상업송장(Invoice)이 필요 없다 — 첨부 없이 발송이 진행돼야 한다.
//
// 그리고 1호가 밟지 않은 축을 하나 더 검증한다: **EQ 고객 반려 → 관리자 반려 → 파트너 보완
// 재요청 → 고객 승인**. P4.8 에서 "관리자가 EQ 를 움직이면 열린 고객 확인 요청을 닫는다"를
// 넣었는데, 그게 없으면 재요청이 ALREADY_OPEN 으로 막히고 고객 화면엔 죽은 폼이 남는다.
//
// 협력사는 협력1(KR/KRW/tester)을 쓰되 **기존 행은 건드리지 않는다** — 이 주행이 만든
// 새 spec 에 붙는 RFQ·발주·선적만 생성하고, 정리도 그것만 지운다.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:domestic  (PORTAL_E2E=1 + JOURNEY=1)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(8040)·Mailpit + e2e/.env.e2e 고객 자격.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  closeBrowser,
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
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');
const PARTNER_NAME = '협력1'; // KR·KRW — 국내 경로의 주인공

describe.skipIf(!RUN || !JOURNEY)('여정 2호 — 국내 협력사 완주(KRW·국내 선적)', () => {
  const rp = createJourneyReport('findings-domestic', '여정 2호 국내 협력사 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;

  // multipart 업로드(EQ 파일) — File 은 Node 20+ 글로벌
  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: 'application/zip' }));
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

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();

    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    // 국내 판정은 발송자 국가로 갈린다(resolvePcbShipContext) — 전제가 깨지면 여정이 무의미하다.
    expect(partner.country, `${PARTNER_NAME} 국가(국내 경로 전제)`).toBe('KR');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('D1. 고객: 거버 업로드 → 견적요청 제출', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 2호] 국내 협력사 완주 — 확인 후 정리 예정',
      prefix: 'D01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '제출 직후 상태').toBe('rfq');
  }, 180_000);

  test('D2. 관리자: 국내 협력사로 견적요청 발송', async (ctx) => {
    if (specId === null) return ctx.skip();
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = (r.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id));
    expect(row, 'RFQ 행 생성').toBeTruthy();
    rfqId = row.rfqId;
    // 배정 시점 통화 박제 — 국내 협력사는 KRW 여야 이후 환율 없는 선정이 성립한다.
    expect(row.currency, '배정 박제 통화').toBe('KRW');
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${PARTNER_NAME})`);
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'D02-admin-case-rfq-sent');
  });

  test('D3. 파트너: 포털에서 KRW 회신', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    await rp.view(partnerView, `/app/partner/pcb/rfqs/${String(rfqId)}`, 'D03-partner-rfq-detail');
    const r = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 42_000,
      quotedDeliveryDate: '2026-08-20',
      memo: '[여정 2호] 국내 회신',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  test('D4. 관리자: 선정+확정가(환율 없는 KRW 경로)', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    // KRW 회신은 환율을 보내지 않는다 — 서버가 그대로 원가(krwAmount)로 박제해야 한다.
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 60_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const prisma = getPrisma();
    const rfq = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId) } });
    expect(rfq?.status, '선정 상태').toBe('selected');
    expect(Number(rfq?.krwAmount ?? 0), 'KRW 원가 박제(회신가 그대로)').toBe(42_000);
    expect(rfq?.exchangeRate, 'KRW 는 환율을 박제하지 않는다').toBeNull();

    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '확정가 등록 후 상태').toBe('quoted');
    expect(Number(spec?.finalPrice ?? 0), '확정가').toBe(60_000);
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'D04-admin-selected-priced');
  });

  test('D5. 고객: 견적관리 → 바로 주문 → 무통장 주문 완료', async (ctx) => {
    if (specId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'D5',
      prefix: 'D05',
      buyerName: 'e2e국내고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);
    F('D5', 'obs', `주문 생성 od=${odId} status=${order.status}`);
  }, 240_000);

  test('D6. 관리자: 입금확인 → 발주서 발행', async (ctx) => {
    if (odId === null || specId === null) return ctx.skip();
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    expect(paid.json?.data?.skipped ?? [], '입금확인 스킵').toHaveLength(0);

    const prisma = getPrisma();
    const row: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(Number(row[0]?.od_misu ?? -1), '입금확인 후 미수금').toBe(0);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id));
    expect(po, '발주서 행').toBeTruthy();
    poId = po.poId;
    // 선정 스냅샷 승계 — 국내는 결제통화도 KRW 라 발주가가 회신가 그대로여야 한다.
    expect(Number(po.priceOriginal ?? 0), '발주가(선정 프리필)').toBe(42_000);
    ledger.push(`sp_pcb_po #${String(poId)} (${PARTNER_NAME})`);
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'D06-po-issued');
  });

  test('D7. 파트너: EQ·Working 업로드 → 승인요청', async (ctx) => {
    if (poId === null) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // 최소 zip 헤더(더미)
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-domestic.zip`,
        bytes,
      );
      expect(up.status, `${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);
    await rp.view(partnerView, `/app/partner/pcb/pos/${String(poId)}`, 'D07-eq-requested');
  });

  test('D8. EQ 반려 왕복: 고객 반려 → 관리자 반려 → 파트너 재요청 → 고객 승인', async (ctx) => {
    if (poId === null || odId === null) return ctx.skip();
    const prisma = getPrisma();

    // ① 관리자가 고객 확인을 건다
    const ask1 = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 2호] 실크 위치를 확인해 주세요',
      dueDate: '2026-08-14',
      sharedFileIds: [],
    });
    expect(ask1.status, `고객확인 요청: ${JSON.stringify(ask1.json)}`).toBe(200);
    ledger.push(`sp_pcb_eq_review (po ${String(poId)} — 반려 왕복 2건)`);

    // ② 고객이 주문내역에서 반려(사유 필수 — 폼 검증 2자 이상)
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await rp.shot(customer, 'D08-orderview-eq-request');
    // 반려는 사유 2자 이상이 아니면 spDialog.alert 로 막힌다(폼 검증). 버튼 클릭이
    // hidden decision 을 'reject' 로 바꾸고, 그다음 spDialog 확인에서 실제 제출이 일어난다.
    await page.locator('form.sp_eq_form textarea[name="note"]').first().fill('실크 위치를 좌측으로 옮겨 주세요');
    await page.locator('.sp_eq_reject').first().click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await rp.shot(customer, 'D08-eq-rejected-by-customer');

    const rejected = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'desc' },
    });
    if (rejected?.status !== 'rejected') {
      F('D8', 'bug', `고객 반려 미반영: status=${rejected?.status ?? 'null'}`);
    }
    expect(rejected?.status, '고객 반려 DB 반영').toBe('rejected');
    F('D8', 'obs', `고객 반려 사유 저장 확인 — "${rejected?.decisionNote ?? ''}"`);

    // ③ 관리자가 그 사유로 협력사에 EQ 반려 → 발주는 issued 로 내려간다
    const rej = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId ?? 0)}/pos/${String(poId)}/eq-reject`, {
      reason: rejected?.decisionNote ?? '고객 요청 반영 필요',
    });
    expect(rej.status, `EQ 반려: ${JSON.stringify(rej.json)}`).toBe(200);

    // P4.8 회귀 — 관리자가 EQ 를 움직이면 열린 고객 확인 요청이 닫혀야 한다.
    // (안 닫히면 고객 화면에 죽은 폼이 남고, 아래 ⑤ 재요청이 ALREADY_OPEN 409 로 막힌다)
    const openAfterReject = await prisma.spPcbEqReview.count({
      where: { poId: BigInt(poId), status: 'requested' },
    });
    expect(openAfterReject, 'EQ 반려 후 열린 고객확인 요청').toBe(0);

    // ④ 파트너가 보완해 다시 올리고 재요청
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { fileType: 'eq' },
      'eq-domestic-rev2.zip',
      bytes,
    );
    expect(up.status, `보완 EQ 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const req2 = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req2.status, `재승인요청: ${JSON.stringify(req2.json)}`).toBe(200);

    // ⑤ 관리자가 고객 확인을 다시 건다 — 옛 요청이 닫혔으니 ALREADY_OPEN 이 아니어야 한다
    const ask2 = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 2호] 실크 위치 수정본입니다 — 재확인 부탁드립니다',
      dueDate: '2026-08-15',
      sharedFileIds: [],
    });
    expect(ask2.status, `재확인 요청(ALREADY_OPEN 회귀): ${JSON.stringify(ask2.json)}`).toBe(200);

    // ⑥ 고객이 이번엔 승인
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('.sp_eq_approve').first().click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await rp.shot(customer, 'D08-eq-approved-by-customer');

    const approved = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'desc' },
    });
    expect(approved?.status, '재확인 승인 DB 반영').toBe('approved');
    F('D8', 'obs', 'EQ 반려 왕복 완료 — 반려 시 열린 요청 종료·재요청 통과·재승인 확인');
  }, 180_000);

  test('D9. 관리자 EQ 승인 → 파트너 생산 시작·완료', async (ctx) => {
    if (poId === null || specId === null) return ctx.skip();
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`,
      {},
    );
    expect(ap.status, `승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {});
    expect(st.status, JSON.stringify(st.json)).toBe(200);
    const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {});
    expect(done.status, JSON.stringify(done.json)).toBe(200);
  });

  test('D10. 파트너: 보드 담기 → 국내 발송(Invoice 없이 택배사+송장)', async (ctx) => {
    if (poId === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    ledger.push(`sp_pcb_shipment (po ${String(poId)} 대표 — domestic)`);
    await rp.view(partnerView, '/app/partner/pcb/ship', 'D10-ship-board-boxed');

    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    // 국내 판정(발송자 KR = 받는측 KR)·받는측 관리자 — 여기서 갈리면 이후 체인이 통째로 다르다.
    expect(shipment?.mode, '선적 모드').toBe('domestic');
    expect(shipment?.receiverKind, '받는측').toBe('admin');

    // 국내 다음 단계는 shipping(협력사 몫) — 국제와 달리 Invoice 첨부 없이 진행돼야 한다.
    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber: 'KR-JRN-0810',
    });
    expect(adv.status, `국내 발송(Invoice 없이): ${JSON.stringify(adv.json)}`).toBe(200);

    const shipped = await prisma.spPcbShipment.findFirst({
      where: { id: shipment?.id },
    });
    expect(shipped?.status, '국내 체인 다음 단계').toBe('shipping');
    F('D10', 'obs', `국내 발송 확인 — mode=domestic status=shipping 운송장=${shipped?.trackingNumber ?? ''}`);
    await rp.view(partnerView, '/app/partner/pcb/ship', 'D10-shipment-shipping');
  });

  test('D11. 관리자: 입고 완료(delivered)+입고확인 → 고객 배송 → 완료', async (ctx) => {
    if (poId === null || specId === null || odId === null) return ctx.skip();
    // 국내 마지막 단계 delivered('입고 완료')는 **관리자 advance** 몫이고(사전
    // domestic: shipping=PARTNER, delivered=ADMIN), 입고확인(receivedAt)은 그와 별개 축이다
    // — receive 는 상태를 올리지 않고 검수 시각·메모만 남긴다. 둘 다 밟아야 종점이다.
    const adv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/advance`,
      {},
    );
    expect(adv.status, `입고 완료 전이: ${JSON.stringify(adv.json)}`).toBe(200);

    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/receive`,
      { note: '[여정 2호] 국내 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const prisma = getPrisma();
    const delivered = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    expect(delivered?.status, '국내 체인 종점').toBe('delivered');
    expect(delivered?.receivedAt, '입고확인 시각').not.toBeNull();

    // 고객 배송 큐(P4.6) — 입고 신호가 잡혀 '배송 처리 대기'로 올라와야 한다.
    const queue = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=50');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const mine = (queue.json?.data?.items ?? []).find((i: any) => i.odId === odId);
    if (mine === undefined) F('D11', 'bug', '입고확인 후에도 고객 배송 대기 큐에 안 보임');
    else F('D11', 'obs', `배송 대기 큐 진입 확인 — 입고 ${String(mine.receivedPoCount)}/${String(mine.poCount)}`);
    await rp.view(adminView, '/app/admin/pcb/orders?tab=to_ship', 'D11-admin-to-ship');

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: '우체국택배',
        invoiceNo: 'KR-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) F('D11', 'obs', `배송 전이: ${JSON.stringify(ship.json)}`);

    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    if (fin.status !== 200) F('D11', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    await customer.page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await rp.shot(customer, 'D11-customer-complete');

    const odRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(Number(odRow[0]?.od_misu ?? -1), '완주 후 미수금 0').toBe(0);
    await rp.view(partnerView, '/app/partner/pcb/shipments/done', 'D11-partner-done-archive');
    F('D11', 'obs', `국내 완주 도달 — od=${odId} spec=${String(specId)} po=${String(poId)}`);
  }, 120_000);
});
