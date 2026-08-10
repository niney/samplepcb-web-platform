// 1호 완주 여정 — 거버 견적요청 → RFQ 루프 → 주문·결제 → 발주·EQ(고객확인) → 생산 →
// 국제 발송 → 입고 → 고객 배송 → 완료. (docs: HANDOFF_E2E_TEST.md 여정 설계)
//
// 목적이 둘이다: ① 완주 자체(연결 검증) ② sp-php 고객화면 미숙함·타 화면 버그 발견.
// 그래서 이 스펙은 "탐색 주행" 모드다 — 매 단계 스크린샷·pageerror·HTTP≥400 을 수집해
// output/journey/ 에 남기고, 미숙한 부분은 fail 대신 findings 로 기록하며 완주를 잇는다.
// **생성물은 정리하지 않는다** — 마지막에 대장(ledger)을 출력하고, 발견 확인 후 수동 정리
// (재고 앵커 주의: g5.ts deleteOrderHard 주석). 반복 실행용 회귀 스펙이 아니다.
//
// 정리 순서(1차 주행 실증): ① 주문을 force-status '주문'으로 내려 재고 복원(배송·완료
// 진입 시 옵션 재고 차감됨) → ② g5_shop_order/cart 삭제 → ③ spec 관련 sp_* 삭제.
// ⚠ DELETE /api/pcb-projects/:id 는 **소유자(고객) 기준** — admin 토큰이면 404. 고객
//   토큰으로 삭제하거나(단 shipment 존재 시 D13 가드) DB 직접 삭제(sp_file→shipment_po→
//   shipment→eq_review→po→rfq→file(spec)→order_spec 순).
//
// 1차 완주 발견(2026-08-10):
//   [BUG후보] EQ 고객확인 — 주문내역(orderinquiryview) [승인] 클릭 후에도 review
//     status='requested'·decidedAt=null 로 미반영(스텝 S9). spDialog confirm 의 [승인]이
//     실제 POST 를 안 하거나 자동화가 못 짚는 마크업 — sp-php D16 고객화면 재확인 필요.
//   [OBS] 주문 '완료' 인데 od_misu=55000·무통장 미입금 유지 — force-status 는 결제와
//     무관하게 상태만 올린다(설계). "완료인데 미결제" 표시가 고객 주문내역에 그대로 노출.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey  (PORTAL_E2E=1 + JOURNEY=1)
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
  measureQuotesRowWidths,
  submitGerberRfq,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

describe.skipIf(!RUN || !JOURNEY)('여정 1호 — 거버 견적요청 → 배송 완료(탐색 주행)', () => {
  // 관찰 규약·고객 조작은 2호(국내)와 공유한다 — helpers/journey.ts
  const rp = createJourneyReport('findings', '여정 1호 탐색 주행 리포트');
  const { F, ledger, view, shot } = rp;

  let customer: PhpLoginResult; // 실로그인(PHP+거버 — 전 구간 단일 세션)
  let adminView: E2eSession; // 관리자 화면 관찰용(스텁)
  let partnerView: E2eSession; // 파트너 화면 관찰용(스텁 tester2)
  let partner2: PartnerFixture;
  let A = ''; // 관리자 API 토큰
  let P = ''; // 협력2 API 토큰

  // 여정 상태 — 앞 단계가 만들면 뒷 단계가 쓴다(실패 시 ctx.skip)
  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let reviewId: number | null = null;

  // multipart 업로드(선적 첨부) — File 은 Node 20+ 글로벌
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

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds(); // 없으면 안내 throw

    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('S1. 고객: 거버 업로드 → 견적요청 제출 → 견적관리 도착', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 1호] 거버 견적요청 완주 — 확인 후 정리 예정',
      prefix: 'S01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '제출 직후 상태').toBe('rfq');
    // 레이아웃 회귀 가드(§9) — rfq 행은 우측 열에 안내 문구가 붙는 자리라, 그 문구가 길면
    // 사양 열이 0 폭으로 밀려 글자가 세로로 쪼개진다. 같은 열이 두 번 무너졌기에 굳힌다.
    expect(await measureQuotesRowWidths(customer.page), '견적관리 사양 열 붕괴 행').toEqual([]);
  }, 180_000);

  test('S3. 관리자: 협력사 견적요청 발송(협력2)', async (ctx) => {
    if (specId === null) return ctx.skip();
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = (r.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner2.id));
    expect(row, 'RFQ 행 생성').toBeTruthy();
    rfqId = row.rfqId;
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → 협력2)`);

    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'S03-admin-case-rfq-sent');
  });

  test('S4. 파트너: 포털에서 회신(가격·납기)', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    // 포털 화면 관찰(회신할 견적 노출) 후 API 로 회신 — 조작 UI 자체는 2차 회귀에서.
    await view(partnerView, `/app/partner/pcb/rfqs/${String(rfqId)}`, 'S04-partner-rfq-detail');

    const r = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 300,
      quotedDeliveryDate: '2026-08-20',
      memo: '[여정 1호] 회신',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  test('S5. 관리자: 선정+확정가 한 번에(quoted 전이, 환율 자동)', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    // 환율 생략 = 당일 수출입은행 캐시 자동 적용. 캐시 미준비(키 미설정 로컬)면
    // 400 EXCHANGE_RATE_REQUIRED — 그때만 명시 환율로 재시도한다.
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 55_000 },
    );
    if (sel.status === 400) {
      F('S5', 'obs', `당일 환율 캐시 없음 — 명시 환율 폴백: ${JSON.stringify(sel.json)}`);
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
    expect(Number(spec?.finalPrice ?? 0), '확정가 반영').toBe(55_000);
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'S05-admin-selected-priced');
  });

  test('S6. 고객: 견적관리 확정가 확인 → 바로 주문 → 무통장 주문 완료', async (ctx) => {
    if (specId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'S6',
      prefix: 'S06',
      buyerName: 'e2e여정고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);
    F('S6', 'obs', `주문 생성 od=${odId} status=${order.status}`);

    // 주문 직후·입금 전 = ORDER_NOT_PAID 게이트의 실상태 — 가드 스펙(pcb-guards)이
    // 실데이터 부재로 스킵하는 케이스를 여정의 자연스러운 중간 상태에서 박제한다.
    // 같은 partnerIds 재전송은 diff 무변화라 게이트 검사만 받고 부작용이 없다.
    const gate = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(gate.status, `입금 전 배정 게이트: ${JSON.stringify(gate.json)}`).toBe(409);
    expect(gate.json?.error, '미입금 주문 게이트').toBe('ORDER_NOT_PAID');
  }, 240_000);

  test('S7. 관리자: 입금 확인(실 UI 경로) → 발주서 발행(선정 프리필)', async (ctx) => {
    if (odId === null || specId === null) return ctx.skip();
    // 관리자 화면의 [입금확인]은 어느 화면이든 PATCH /orders/status 한 번이다
    // (useAdminPcbOrders.useConfirmPcbOrderReceipt). 그 안에서 od_receipt_price=od_misu·
    // od_misu=0 까지 처리하고 고객 입금 확인 메일도 보낸다. 이전 주행은 receipt+force-status
    // 2단계를 썼는데 그건 실 UI 가 밟지 않는 경로였다 — 메일 발송까지 통째로 미검증이었다.
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    expect(paid.json?.data?.skipped ?? [], `입금확인 스킵: ${JSON.stringify(paid.json)}`).toHaveLength(0);

    // 수납이 함께 잡혔는지(미수금 0) — 상태만 오르는 회귀를 여기서 잡는다.
    const prisma = getPrisma();
    const paidRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu, od_receipt_price FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(Number(paidRow[0]?.od_misu ?? -1), '입금확인 후 미수금').toBe(0);
    F('S7', 'obs', `입금확인 반영 — status=${paidRow[0]?.od_status} 수납=${String(paidRow[0]?.od_receipt_price)}`);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner2.id));
    expect(po, '발주서 행').toBeTruthy();
    poId = po.poId;
    ledger.push(`sp_pcb_po #${String(poId)} (협력2)`);
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'S07-po-issued');
  });

  test('S8. 파트너: EQ·Working 첨부 없이 승인요청', async (ctx) => {
    if (poId === null) return ctx.skip();
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);
    F('S8', 'obs', 'EQ·Working 첨부 없이 EQ 승인요청 허용');
    await view(partnerView, `/app/partner/pcb/pos/${String(poId)}`, 'S08-eq-requested');
  });

  test('S9. 관리자: EQ 고객확인 요청 → 고객: 주문내역에서 승인(PHP)', async (ctx) => {
    if (poId === null || odId === null) return ctx.skip();
    const create = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 1호] 사양 확인 부탁드립니다',
      dueOn: '2026-08-14',
      sharedFileIds: [],
    });
    expect(create.status, `고객확인 요청: ${JSON.stringify(create.json)}`).toBe(200);
    reviewId = create.json?.data?.reviewId ?? create.json?.data?.id ?? null;
    ledger.push(`sp_pcb_eq_review (po ${String(poId)})`);

    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await shot(customer, 'S09-orderview-eq-request');
    // EQ 승인 — 폼 승인(.sp_eq_approve) → spDialog 확인(.sp-dlg-ok). 1차 주행은 셀렉터가
    // 모호했다: 폼과 spDialog 둘 다 '승인' 텍스트라 getByRole name 이 폼 버튼을 재클릭,
    // form.submit() 이 안 일어나 미반영이었다(테스트 코드 문제). 클래스로 명확히 짚는다.
    await page.locator('.sp_eq_approve').first().click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await shot(customer, 'S09-eq-confirm-dialog');
    // form.submit() → eq-decide POST → orderinquiryview 로 되돌아옴(?sp_msg=success)
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await shot(customer, 'S09-eq-approved');

    // 실제 반영 검증(DB) — 1차 주행에서 requested·null 로 남았던 그 지점
    const prisma = getPrisma();
    const rv = await prisma.spPcbEqReview.findFirst({ where: { poId: BigInt(poId) }, orderBy: { id: 'desc' } });
    reviewId = rv === null ? null : num(rv.id);
    if (rv?.status === 'approved') {
      F('S9', 'obs', `EQ 고객 승인 반영 확인 — review #${String(reviewId)} status=approved`);
    } else {
      F('S9', 'bug', `EQ 승인 미반영: status=${rv?.status ?? 'null'} decidedAt=${rv?.decidedAt ?? 'null'}`);
    }
    expect(rv?.status, 'EQ 고객 승인 DB 반영').toBe('approved');
  }, 120_000);

  test('S10. 관리자 EQ 승인 → 파트너 생산 시작·완료', async (ctx) => {
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

  test('S11. 파트너: 보드 담기 → 송장 첨부 → 국제 발송 체인', async (ctx) => {
    if (poId === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    ledger.push(`sp_pcb_shipment (po ${String(poId)} 대표)`);
    await view(partnerView, '/app/partner/pcb/ship', 'S11-ship-board-boxed');

    // 국제 requested 는 Invoice 첨부 필수 — 최소 PDF 를 invoice 슬롯에 업로드
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/shipment/files`,
      { fileType: 'invoice' },
      'file',
      'invoice-journey.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);

    // 선적요청(파트너: 출고예정일) → 이후 단계는 관리자 만능 대행으로 소진(운송장 제공)
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);

    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'JRN-0810', trackingUrl: null },
      );
      if (adv.status !== 200) {
        if (adv.json?.error === 'ALREADY_FINAL') break;
        F('S11', 'obs', `발송 체인 중단: ${JSON.stringify(adv.json)}`);
        break;
      }
    }
    await view(partnerView, '/app/partner/pcb/ship', 'S11-shipment-final');
  });

  test('S12. 관리자: 입고확인 → 고객 배송(운송장) → 완료', async (ctx) => {
    if (poId === null || specId === null || odId === null) return ctx.skip();
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/receive`,
      { note: '[여정 1호] 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: 'JRN-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) {
      F('S12', 'obs', `배송 전이 바디 확인 필요: ${JSON.stringify(ship.json)}`);
    }
    // 고객 배송 큐(P4.6)는 '선적·배송' 화면의 두 번째 섹션이다 — 주문·결제 화면엔 그 탭이
    // 없고(AdminPcbOrders.vue:31) 두 워크큐 다 URL 쿼리로 탭을 받지 않는다.
    await view(adminView, '/app/admin/pcb/shipments', 'S12-admin-shipping');

    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await shot(customer, 'S12-customer-shipping');

    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '완료',
    });
    if (fin.status !== 200) F('S12', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await shot(customer, 'S13-customer-complete');

    // 완주 상태 최종 검증(DB) — 미수금 0(정상 입금확인 반영) + 완료 상태
    const prisma = getPrisma();
    const odRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    const misu = Number(odRow[0]?.od_misu ?? -1);
    if (misu === 0) F('S12', 'obs', `미수금 0 확인(정상 입금확인 반영) — status=${odRow[0]?.od_status}`);
    else F('S12', 'bug', `완료인데 미수금 ${String(misu)} 잔존 — 입금확인 경로 재확인`);
    expect(misu, '완주 후 미수금 0').toBe(0);
    await view(partnerView, '/app/partner/pcb/shipments/done', 'S13-partner-done-archive');
    F('S12', 'obs', `완주 도달 — od=${odId} spec=${String(specId)} po=${String(poId)} review=${String(reviewId)}`);
  }, 120_000);
});
