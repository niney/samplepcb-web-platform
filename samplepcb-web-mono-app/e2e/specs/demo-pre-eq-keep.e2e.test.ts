// 데모 주행 — **EQ 확인 단계 직전**(발주서 발행 완료)에서 멈추고 남긴다
// (정리 없음 · 2026-08-25 사용자 요청).
//
// 여정 1호(journey-gerber-rfq)의 S1~S7 만 실주행한다:
//   거버 업로드 → 견적요청 → 관리자 RFQ 발송 → 협력사 회신 → 선정+확정가 →
//   고객 주문(무통장) → 관리자 입금확인 → 발주서 발행.
// 그 다음 칸(협력사 EQ 승인요청 → 관리자 고객확인 요청 → 고객 승인 → 관리자 EQ 승인)은
// **사람이 화면에서 직접** 이어가라고 손대지 않는다.
//
// 실행: cd e2e && PORTAL_E2E=1 DEMO_KEEP=1 npx vitest run demo-pre-eq-keep
// 사전: nginx · API(3333) · 웹(5173) · 거버(8040) · Mailpit · e2e/.env.e2e 고객 자격
// 정리(원할 때 수동): 주행 끝의 대장(ledger) 출력 참고 — sp_file→shipment_po→shipment→
//   eq_review→po→rfq→file(spec)→order_spec, 주문은 force-status '주문' 으로 내린 뒤 삭제.
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

const DEMO = process.env.DEMO_KEEP === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');
// 협력사는 **사람이 그누보드로 로그인할 수 있는 실계정 조직**을 기본으로 둔다 —
// e2e 전용 조직(협력1/협력2 …)은 비번 없는 @test.local 이라 화면으로 이어갈 수 없다.
const PARTNER_NAME = process.env.DEMO_PARTNER ?? 'tester2협력';

describe.skipIf(!RUN || !DEMO)('데모 — PCB EQ 확인 직전까지(남김)', () => {
  const rp = createJourneyReport('pre-eq-keep', 'EQ 직전 남김 주행 리포트');
  const { F, ledger, view } = rp;

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
    console.log(
      '\n[demo-pre-eq] 남긴 것 — 다음 칸은 사람이 화면에서:\n' +
        `  spec #${String(specId)} · rfq #${String(rfqId)} · 주문 ${String(odId)} · PO #${String(poId)}\n` +
        `  협력사 발주서: ${BASE_URL}/app/partner/pcb/pos/${String(poId)}  → [EQ 승인요청]\n` +
        `  관리자 Case:  ${BASE_URL}/app/admin/pcb/cases/${String(specId)} → [EQ 고객확인 요청]\n` +
        `  고객 주문내역: ${BASE_URL}/shop/orderinquiry (od ${String(odId)}) → EQ 승인\n`,
    );
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K1. 고객: 거버 업로드 → 견적요청 제출 → 견적관리 도착', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[EQ 직전 남김] 데모 주행 — 확인 후 정리 예정',
      prefix: 'K01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId})`);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '제출 직후 상태').toBe('rfq');
  }, 180_000);

  test('K2. 관리자: 협력사 견적요청 발송', async (ctx) => {
    if (specId === null) return ctx.skip();
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = (r.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id));
    expect(row, 'RFQ 행 생성').toBeTruthy();
    rfqId = row.rfqId;
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${PARTNER_NAME})`);
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'K02-admin-case-rfq-sent');
  });

  test('K3. 파트너: 포털에서 회신(가격·납기)', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    await view(partnerView, `/app/partner/pcb/rfqs/${String(rfqId)}`, 'K03-partner-rfq-detail');
    const r = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 300,
      quotedDeliveryDate: '2026-09-10',
      memo: '[EQ 직전 남김] 회신',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  test('K4. 관리자: 선정 + 확정가', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 55_000 },
    );
    if (sel.status === 400) {
      F('K4', 'obs', `당일 환율 캐시 없음 — 명시 환율 폴백: ${JSON.stringify(sel.json)}`);
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 55_000 },
      );
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '선정+확정가 후 상태').toBe('quoted');
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'K04-admin-selected-priced');
  });

  test('K5. 고객: 견적관리 → 주문(무통장)', async (ctx) => {
    if (specId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'K5',
      prefix: 'K05',
      buyerName: 'e2e데모고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);
    F('K5', 'obs', `주문 생성 od=${odId} status=${order.status}`);
  }, 240_000);

  test('K6. 관리자: 입금확인 → 발주서 발행 (여기까지 — EQ 는 사람 몫)', async (ctx) => {
    if (odId === null || specId === null) return ctx.skip();
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    const prisma = getPrisma();
    const paidRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(Number(paidRow[0]?.od_misu ?? -1), '입금확인 후 미수금').toBe(0);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id));
    expect(po, '발주서 행').toBeTruthy();
    const issuedPoId = num(po.poId);
    poId = issuedPoId;
    ledger.push(`sp_pcb_po #${String(poId)} (${PARTNER_NAME})`);

    // EQ 는 아직 아무것도 하지 않은 상태여야 한다 — 남기는 지점의 정의.
    const reviews = await prisma.spPcbEqReview.count({ where: { poId: BigInt(issuedPoId) } });
    expect(reviews, 'EQ 고객확인 요청은 남기지 않는다').toBe(0);

    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'K06-po-issued');
    await view(partnerView, `/app/partner/pcb/pos/${String(poId)}`, 'K06-partner-po');
  });
});
