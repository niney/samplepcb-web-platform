// 3호 완주 여정 — **묶음 발송**(국제). 고객 주문 두 건이 한 박스로 묶여 나가고, 입고 뒤
// 다시 각각의 주문으로 갈라져 배송된다.
//
// 협력사 축의 묶음 메커니즘(합류·대표 승계·게이팅·묶음 전이)은 pcb-ship-board 스펙이
// 시드 발주로 이미 지킨다. 여기서만 되는 것은 **고객 축과의 접합**이다:
//   ① 서로 다른 스펙(=서로 다른 주문)의 발주가 같은 컨텍스트라 한 박스에 합류하고,
//   ② 그 박스가 통째로 전이되며(Invoice 는 박스에 한 번),
//   ③ 입고확인 뒤 **두 주문이 모두** 고객 배송 대기 큐에 오른다.
//
// ③ 이 이 여정의 존재 이유다. 선적 문서의 specId 는 대표 한 건뿐이라 그걸로 판정하면
// 동반 주문이 큐에서 사라진다 — 서버는 발주서 축으로 조인해 그 함정을 피하는데
// (admin-pcb-orders.ts PCB_SHIP_JOIN 주석), 주문이 둘 있어야 비로소 시험된다.
//
// 실행: pnpm -F e2e journey:batch  (PORTAL_E2E=1 + JOURNEY=1)
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
const PARTNER_NAME = '협력2'; // CN — 관리자행이라 국제(Invoice 필수) 경로가 된다

/** 한 건의 여정 상태 — 두 건을 같은 절차로 밀어야 해서 묶어 둔다. */
interface Lane {
  label: string;
  specId: number | null;
  rfqId: number | null;
  odId: string | null;
  poId: number | null;
  price: number;
}

describe.skipIf(!RUN || !JOURNEY)('여정 3호 — 묶음 발송(주문 2건 → 한 박스 → 각자 배송)', () => {
  const rp = createJourneyReport('findings-batch', '여정 3호 묶음 발송 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  const lanes: Lane[] = [
    { label: 'A', specId: null, rfqId: null, odId: null, poId: null, price: 51_000 },
    { label: 'B', specId: null, rfqId: null, odId: null, poId: null, price: 52_000 },
  ];
  /** 박스 대표 발주서 — 전이·입고확인은 대표로 친다(어느 멤버로 접근하든 같은 선적). */
  let boxRepPoId: number | null = null;

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: contentType }));
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
    // 국제 판정 전제(발송자 CN ≠ 받는측 KR) — 깨지면 Invoice 경로가 아니게 된다.
    expect(partner.country, `${PARTNER_NAME} 국가(국제 경로 전제)`).not.toBe('KR');

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

  test('B1. 고객: 거버 2건 업로드 → 견적요청 2건', async () => {
    for (const lane of lanes) {
      lane.specId = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 3호-${lane.label}] 묶음 발송 완주 — 확인 후 정리 예정`,
        prefix: `B01-${lane.label}`,
      });
      ledger.push(`sp_order_spec #${String(lane.specId)} (${lane.label})`);
    }
    // 같은 파일명이라도 별개 견적이어야 한다 — 겹치면 이후 전 단계가 한 건으로 뭉친다.
    expect(lanes[0]?.specId, 'A/B 견적 분리').not.toBe(lanes[1]?.specId);
  }, 300_000);

  test('B2. 관리자·파트너: 각 건 RFQ → 회신 → 선정+확정가', async (ctx) => {
    if (lanes.some((l) => l.specId === null)) return ctx.skip();
    for (const lane of lanes) {
      const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(lane.specId)}/rfqs`, {
        partnerIds: [num(partner.id)],
      });
      expect(send.status, `${lane.label} RFQ: ${JSON.stringify(send.json)}`).toBe(200);
      const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id));
      expect(row, `${lane.label} RFQ 행`).toBeTruthy();
      lane.rfqId = row.rfqId;
      ledger.push(`sp_pcb_rfq #${String(lane.rfqId)} (${lane.label})`);

      const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(lane.rfqId)}`, {
        price: 300,
        quotedDeliveryDate: '2026-08-20',
        memo: `[여정 3호-${lane.label}] 회신`,
      });
      expect(reply.status, `${lane.label} 회신: ${JSON.stringify(reply.json)}`).toBe(200);

      // 환율은 생략 — 당일 수출입은행 캐시가 자동 적용된다(P4.7). 없으면 명시값 폴백.
      let sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(lane.specId)}/rfqs/${String(lane.rfqId)}/select`,
        { finalPrice: lane.price },
      );
      if (sel.status === 400) {
        F('B2', 'obs', `${lane.label} 당일 환율 캐시 없음 — 명시 환율 폴백`);
        sel = await api(
          A,
          'POST',
          `/api/admin/pcb-projects/${String(lane.specId)}/rfqs/${String(lane.rfqId)}/select`,
          { exchangeRate: 1400, finalPrice: lane.price },
        );
      }
      expect(sel.status, `${lane.label} 선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
    }
  }, 120_000);

  test('B3. 고객: 두 건을 각각 주문(서로 다른 주문번호)', async (ctx) => {
    if (lanes.some((l) => l.specId === null)) return ctx.skip();
    for (const lane of lanes) {
      const order = await placeOrderFromQuotes(customer, rp, {
        specId: lane.specId ?? 0,
        step: 'B3',
        prefix: `B03-${lane.label}`,
        buyerName: 'e2e묶음고객',
      });
      lane.odId = order.odId;
      ledger.push(`g5_shop_order od_id=${order.odId} (${lane.label})`);
      F('B3', 'obs', `${lane.label} 주문 생성 od=${order.odId}`);
    }
    // 묶음의 전제 — 주문이 갈라져 있어야 "한 박스 → 두 주문" 접합을 시험할 수 있다.
    expect(lanes[0]?.odId, 'A/B 주문 분리').not.toBe(lanes[1]?.odId);
  }, 480_000);

  test('B4. 관리자: 입금확인 2건 → 발주 2건', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    for (const lane of lanes) {
      const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [lane.odId],
        sendMail: true,
        sendSms: false,
      });
      expect(paid.status, `${lane.label} 입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

      const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(lane.specId)}/pos`, {
        partnerId: num(partner.id),
        rfqId: lane.rfqId,
      });
      expect(issue.status, `${lane.label} 발주: ${JSON.stringify(issue.json)}`).toBe(200);
      const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id));
      expect(po, `${lane.label} 발주서 행`).toBeTruthy();
      lane.poId = po.poId;
      ledger.push(`sp_pcb_po #${String(lane.poId)} (${lane.label})`);
    }
  }, 120_000);

  test('B5. 파트너·관리자: EQ 2건 → 생산완료 2건', async (ctx) => {
    if (lanes.some((l) => l.poId === null)) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const lane of lanes) {
      for (const fileType of ['eq', 'working'] as const) {
        const up = await apiForm(
          P,
          `/api/partner/pcb-pos/${String(lane.poId)}/eq-files`,
          { fileType },
          `${fileType}-${lane.label}.zip`,
          bytes,
          'application/zip',
        );
        expect(up.status, `${lane.label} ${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
      }
      const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/eq-request`, {});
      expect(req.status, `${lane.label} 승인요청`).toBe(200);
      const ap = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(lane.specId)}/pos/${String(lane.poId)}/eq-approve`,
        {},
      );
      expect(ap.status, `${lane.label} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
      const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/production-start`, {});
      expect(st.status, `${lane.label} 생산시작`).toBe(200);
      const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/production-complete`, {});
      expect(done.status, `${lane.label} 생산완료`).toBe(200);
    }
  }, 180_000);

  test('B6. 파트너: 두 건이 같은 박스에 합류한다', async (ctx) => {
    if (lanes.some((l) => l.poId === null)) return ctx.skip();
    const first = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: lanes[0]?.poId });
    expect(first.status, `A 담기: ${JSON.stringify(first.json)}`).toBe(200);
    const second = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: lanes[1]?.poId });
    expect(second.status, `B 담기: ${JSON.stringify(second.json)}`).toBe(200);

    // 받는측·회차·직송지가 같으니 새 박스가 생기지 않고 기존 박스에 합류해야 한다.
    const myBoxes = (second.json?.data?.boxes ?? []).filter((b: any) =>
      (b.groupPos ?? []).some((g: any) => g.poId === lanes[0]?.poId || g.poId === lanes[1]?.poId),
    );
    expect(myBoxes.length, '두 건이 한 박스로').toBe(1);
    const box = myBoxes[0];
    expect(box.groupPos.length, '박스 구성 2건').toBe(2);
    expect(box.mode, '국제 발송').toBe('international');
    boxRepPoId = box.poId;
    ledger.push(`sp_pcb_shipment (대표 po ${String(boxRepPoId)} — 2건 묶음)`);
    F('B6', 'obs', `박스 합류 확인 — 대표 po=${String(boxRepPoId)} 구성 2건`);
    await rp.view(partnerView, '/app/partner/pcb/ship', 'B06-box-merged');
  }, 120_000);

  test('B7. 파트너: Invoice 첨부(박스에 한 번) → 묶음이 통째로 전이', async (ctx) => {
    if (boxRepPoId === null) return ctx.skip();
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(boxRepPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-batch.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);

    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(boxRepPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(adv.status, `선적요청: ${JSON.stringify(adv.json)}`).toBe(200);

    // 대표로 전이했지만 동반 건도 같은 선적이라 함께 움직여야 한다.
    const mate = lanes.find((l) => l.poId !== boxRepPoId);
    const detail = await api(P, 'GET', `/api/partner/pcb-pos/${String(mate?.poId ?? 0)}`);
    expect(detail.json?.data?.shipment?.status, '동반 건도 선적요청').toBe('requested');
    expect(detail.json?.data?.shipment?.poIds?.length, '동반 건이 보는 묶음 크기').toBe(2);
    F('B7', 'obs', 'Invoice 1건으로 묶음 전체가 선적요청까지 이동');
  }, 120_000);

  test('B8. 관리자: 국제 체인 완주 → 입고확인(묶음 1회)', async (ctx) => {
    if (boxRepPoId === null) return ctx.skip();
    const repLane = lanes.find((l) => l.poId === boxRepPoId);
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(repLane?.specId)}/pos/${String(boxRepPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'BATCH-0810', trackingUrl: null },
      );
      if (adv.status !== 200) {
        if (adv.json?.error === 'ALREADY_FINAL') break;
        F('B8', 'obs', `체인 중단: ${JSON.stringify(adv.json)}`);
        break;
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(repLane?.specId)}/pos/${String(boxRepPoId)}/shipment/receive`,
      { note: '[여정 3호] 묶음 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(boxRepPoId) } } },
    });
    expect(shipment?.receivedAt, '입고 시각').not.toBeNull();
    F('B8', 'obs', `묶음 입고확인 1회 — 선적 #${String(shipment?.id ?? 0)}`);
  }, 180_000);

  test('B9. 두 주문 모두 배송 대기 큐에 오른다(대표 아닌 건 포함)', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    const queue = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const items = queue.json?.data?.items ?? [];

    // 이 여정의 핵심 — 선적 문서의 specId 는 대표 한 건뿐이라, 그걸로 판정하면 동반
    // 주문이 큐에서 사라진다. 서버는 발주서 축으로 조인해 둘 다 올린다.
    for (const lane of lanes) {
      const row = items.find((i: any) => i.odId === lane.odId);
      if (row === undefined) {
        F('B9', 'bug', `${lane.label} 주문이 배송 대기 큐에 없음 — 묶음 cross-spec 판정 회귀`);
      }
      expect(row, `${lane.label} 주문(od=${String(lane.odId)}) 큐 진입`).toBeTruthy();
      expect(row.receivedPoCount, `${lane.label} 입고 수`).toBe(1);
    }
    F('B9', 'obs', '묶음 입고 1회로 두 주문이 모두 배송 대기 — cross-spec 판정 정상');
    await rp.view(adminView, '/app/admin/pcb/shipments', 'B09-admin-to-ship');
  }, 120_000);

  test('B10. 관리자: 주문별 개별 배송 → 완료', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    const prisma = getPrisma();
    for (const [i, lane] of lanes.entries()) {
      // 묶어서 받았어도 고객에게는 각자 나간다 — 운송장도 주문마다 다르다.
      const ship = await api(A, 'PATCH', `/api/admin/orders/${String(lane.odId)}/force-status`, {
        target: '배송',
        delivery: {
          deliveryCompany: 'CJ대한통운',
          invoiceNo: `BATCH-D-${String(i + 1)}`,
          invoiceTime: '2026-08-10 18:00:00',
        },
      });
      if (ship.status !== 200) F('B10', 'obs', `${lane.label} 배송 전이: ${JSON.stringify(ship.json)}`);
      const fin = await api(A, 'PATCH', `/api/admin/orders/${String(lane.odId)}/force-status`, {
        target: '완료',
      });
      if (fin.status !== 200) F('B10', 'obs', `${lane.label} 완료 전이: ${JSON.stringify(fin.json)}`);

      const row: any[] = await prisma.$queryRawUnsafe(
        `SELECT od_status, od_misu, od_invoice FROM g5_shop_order WHERE od_id = ?`,
        lane.odId,
      );
      expect(row[0]?.od_status, `${lane.label} 최종 상태`).toBe('완료');
      expect(Number(row[0]?.od_misu ?? -1), `${lane.label} 미수금`).toBe(0);
      expect(String(row[0]?.od_invoice ?? ''), `${lane.label} 운송장(주문별로 다름)`).toBe(
        `BATCH-D-${String(i + 1)}`,
      );
    }
    await customer.page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
    await rp.shot(customer, 'B10-customer-orders');
    F('B10', 'obs', `묶음 완주 — ${lanes.map((l) => `${l.label}:${String(l.odId)}`).join(' ')}`);
  }, 180_000);
});
