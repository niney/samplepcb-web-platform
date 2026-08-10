// MD 시나리오 4 — **전 구간 국내**(KR MD·상설 픽스처). 2편(md-order-relay)이 하위 CN→MD KR
// 국제 + MD→관리자 국내 조합이었다면, 여기는 하위도 KR(협력1)이라 **두 구간 모두 국내**다:
//
//   하위(협력1·KR) → MD(KR)  : 국내 3단계 — Invoice 불요, **받는측 md 인 domestic 최초**,
//                              MD 입고확인이 종점을 닫는다(P4.10 — receive 가 delivered 전이)
//   MD(KR) → 관리자(KR)      : 국내 3단계 — RECEIVE_REQUIRED 를 지나 입고확인이 종점
//
// 핵심 검증: **하위 leg 가 국내여도 출고 게이팅이 동작**하는가 — 게이트 해제 열쇠는 모드가
// 아니라 shipment.receivedAt 이므로(isPcbOutboundBlocked), 국내에서도 하위 입고확인 전에는
// 상위 담기가 409 OUTBOUND_BLOCKED 여야 한다(배송 중이어도 마찬가지).
//
// 픽스처는 2편과 같은 상설 무대(마스터딜러상사·mdtester) + 관계 →협력1(KRW, 3편이 생성) —
// idempotent 확인만 한다. ⚠ 협력1 은 진행 중 실데이터 보유(HANDOFF §5) — 조직·기존 문서는
// 읽기 전용, 이 주행이 새로 만드는 스펙 축의 RFQ·PO·선적 행만 만들고 정리한다.
//
// 실행: pnpm -F e2e md:domestic  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts 스펙 축 훑기 — 상설 무접촉).
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
const MD_MB_ID = 'mdtester';
const MD_ORG_NAME = '마스터딜러상사';
const CHILD_NAME = '협력1'; // KR·KRW — 링크 통화 KRW(3편 관계). 실데이터 조직: 읽기 전용
const MARGIN_RATE = 15;
const CHILD_PRICE = 300_000; // 협력1 회신(KRW)

describe.skipIf(!RUN || !JOURNEY)('MD 시나리오 4 — 전 구간 국내 완주(KR MD·상설 픽스처)', () => {
  const rp = createJourneyReport('findings-md4', 'MD 시나리오 4 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let mdView: E2eSession;
  let child: PartnerFixture;
  let mdPartnerId: bigint | null = null;
  let A = '';
  let M = '';
  let C = '';

  let specId: number | null = null;
  let topRfqId: number | null = null;
  let childRfqId: number | null = null;
  let odId: string | null = null;
  let topPoId: number | null = null;
  let childPoId: number | null = null;

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
    const prisma = getPrisma();

    child = await getPartner(CHILD_NAME);
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

    // 상설 픽스처 확보 — 1~3편과 같은 idempotent 준비(있으면 그대로 쓴다).
    let org = await prisma.spPartner.findFirst({ where: { name: MD_ORG_NAME } });
    if (org === null) {
      org = await prisma.spPartner.create({
        data: {
          type: 'partner',
          name: MD_ORG_NAME,
          status: 'approved',
          country: 'KR',
          defaultCurrency: 'KRW',
          capabilities: ['pcb_rfq'],
          contactName: '마스터딜러',
          contactEmail: 'mdtester@test.local',
        },
      });
    }
    mdPartnerId = org.id;
    const link = await prisma.spPartnerMember.findFirst({
      where: { partnerId: org.id, mbId: MD_MB_ID },
    });
    if (link === null) {
      await prisma.spPartnerMember.create({
        data: { partnerId: org.id, mbId: MD_MB_ID, role: 'owner' },
      });
    }
    // 관계 →협력1(KRW) — 3편(md-quote-rework)이 만든 상설. 없으면 같은 조건으로 만든다.
    const relation = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: org.id, childPartnerId: child.id },
    });
    if (relation === null) {
      const rel = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/relations`, {
        childPartnerId: num(child.id),
        settlementCurrency: 'KRW',
      });
      if (rel.status !== 200) {
        throw new Error(`MD 관계 생성 실패(${String(rel.status)}): ${JSON.stringify(rel.json)}`);
      }
    }

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    mdView = await newSession({ mbId: MD_MB_ID }, { partnerModule: 'pcb' });
    rp.watchHttp(mdView, 'MD');
  }, 180_000);

  afterAll(async () => {
    // 픽스처(조직·연결·관계)는 상설 — 정리하지 않는다. 문서 생성물만 대장으로.
    rp.write({ 고객: customer, 관리자: adminView, MD: mdView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K1. 견적 루프: 거버 → MD 배정(KRW) → 하위 회신(KRW) → 마진 → 선정+확정가', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[MD 4편] 전 구간 국내 완주 — 확인 후 정리 예정',
      prefix: 'K01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(mdPartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const topRow = (send.json?.data?.rfqs ?? []).find(
      (v: any) => v.partnerId === num(mdPartnerId ?? 0n),
    );
    topRfqId = topRow?.rfqId ?? null;
    expect(topRfqId, 'MD RFQ').not.toBeNull();
    expect(topRow?.currency, '관리자↔MD 통화(조직 기본 KRW)').toBe('KRW');
    ledger.push(`sp_pcb_rfq #${String(topRfqId)} (관리자→MD)`);

    const assign = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(child.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 배정: ${JSON.stringify(assign.json)}`).toBe(200);
    const prisma = getPrisma();
    const childRfq = await prisma.spPcbRfq.findFirst({
      where: { specId: BigInt(specId), partnerId: child.id, parentPartnerId: mdPartnerId ?? 0n },
      orderBy: { id: 'desc' },
    });
    childRfqId = num(childRfq.id);
    // 2편(협력2)과 갈리는 지점 ① — MD↔하위 링크 통화가 KRW(관계 박제).
    expect(childRfq.currency, 'MD↔협력1 링크 통화 KRW').toBe('KRW');
    ledger.push(`sp_pcb_rfq #${String(childRfqId)} (MD→하위)`);

    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: CHILD_PRICE,
      quotedDeliveryDate: '2026-08-22',
      memo: '[MD 4편] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);
    // KRW→KRW 는 환율 1 — 상위 회신가 = 300,000 × 1 × 1.15 (변환점 박제 확인).
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId ?? 0) } });
    expect(Number(top?.sourceRate ?? 0), 'KRW→KRW 환율 1').toBe(1);
    expect(Number(top?.priceOriginal ?? 0), 'MD 회신가 자동 산출').toBe(
      Math.round(CHILD_PRICE * (1 + MARGIN_RATE / 100)),
    );

    // 전 구간 KRW 라 환율 없이 선정+확정가 한 번에(P4.7).
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: 620_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 300_000);

  test('K2. 고객 주문 → 입금 → MD 발주(selected 견적행 근거)', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'K2',
      prefix: 'K02',
      buyerName: 'e2eMD4고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId}`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(mdPartnerId ?? 0n),
      rfqId: topRfqId,
    });
    expect(issue.status, `MD 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    topPoId =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(mdPartnerId ?? 0n))
        ?.poId ?? null;
    expect(topPoId, 'MD 발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(topPoId)} (관리자→MD)`);
  }, 480_000);

  test('K3. EQ 위임 → 하위 발주 → 하위 EQ 완주(생산완료)', async (ctx) => {
    if (topPoId === null || childRfqId === null) return ctx.skip();
    const before = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(before.json?.data?.eq?.blocked, '하위 발주 전 EQ 시작 불가').toBe(true);

    const create = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId,
    });
    expect(create.status, `하위 발주: ${JSON.stringify(create.json)}`).toBe(200);
    const prisma = getPrisma();
    const childPo = await prisma.spPcbPo.findFirst({
      where: { specId: BigInt(specId ?? 0), partnerId: child.id, parentPartnerId: mdPartnerId ?? 0n },
      orderBy: { id: 'desc' },
    });
    childPoId = num(childPo.id);
    ledger.push(`sp_pcb_po #${String(childPoId)} (MD→하위)`);

    const after = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(after.json?.data?.eq?.delegatePoId, 'EQ 위임 대상').toBe(childPoId);

    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        C,
        `/api/partner/pcb-pos/${String(childPoId)}/eq-files`,
        { fileType },
        `${fileType}-md4.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const [path, token] of [
      [`/api/partner/pcb-pos/${String(childPoId)}/eq-request`, C],
      [`/api/admin/pcb-projects/${String(specId)}/pos/${String(childPoId)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(childPoId)}/production-start`, C],
      [`/api/partner/pcb-pos/${String(childPoId)}/production-complete`, C],
    ] as const) {
      const r = await api(token, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  }, 240_000);

  test('K4. 하위(KR) → MD(KR) 국내 발송 — 게이팅 유지, Invoice 불요, MD 입고확인이 종점', async (ctx) => {
    if (childPoId === null || topPoId === null) return ctx.skip();
    // 게이팅 ① — 하위가 MD 에 도착하기 전에는 MD 상위 출고 불가(국내 leg 라도 동일해야 한다).
    const blocked = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(blocked.status, `하위 입고 전 상위 담기: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error).toBe('OUTBOUND_BLOCKED');

    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, `하위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(childPoId) } } },
      orderBy: { id: 'desc' },
    });
    // 이 편의 차별점 — **받는측 md 인 국내** 발송(2편은 하위 CN 이라 국제였다).
    expect(shipment?.receiverKind, '받는측 md').toBe('md');
    expect(shipment?.mode, '하위(KR)→MD(KR) 국내').toBe('domestic');
    ledger.push(`sp_pcb_shipment (하위→MD, po ${String(childPoId)})`);

    // 국내 전이는 Invoice 없이 택배사+송장만으로 배송 중 — 국제(requested=Invoice 필수)와
    // 갈리는 지점을 실증한다(첨부 업로드 없이 바로 전이 성공).
    const adv = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      carrier: '우체국택배',
      trackingNumber: 'MD4-KR-CHILD-0810',
    });
    expect(adv.status, `국내 발송(Invoice 불요): ${JSON.stringify(adv.json)}`).toBe(200);

    // 게이팅 ② — 배송 중이어도 게이트 열쇠는 receivedAt 이다. 입고확인 전 상위 담기는 여전히 409.
    const stillBlocked = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(stillBlocked.status, `배송 중 상위 담기: ${JSON.stringify(stillBlocked.json)}`).toBe(409);
    expect(stillBlocked.json?.error, '게이트 열쇠는 입고확인').toBe('OUTBOUND_BLOCKED');

    // MD 입고확인 — 국내는 receive 가 종점(delivered)을 함께 닫는다(P4.10). 받는측 md 의
    // domestic receive 는 이 편이 처음 밟는 조합이다.
    const recv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[MD 4편] MD 입고',
    });
    expect(recv.status, `MD 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findFirst({ where: { id: shipment?.id ?? 0n } });
    expect(closed?.status, 'MD 입고확인이 국내 종점을 닫음').toBe('delivered');
    expect(closed?.receivedAt, 'receivedAt 박제').not.toBeNull();
    F('K4', 'obs', '하위(KR)→MD(KR) 국내 3단계 — Invoice 불요·게이팅 2회 확인·MD 입고확인=종점');
  }, 240_000);

  test('K5. MD(KR) → 관리자(KR) 국내 발송 — 게이트 해제, RECEIVE_REQUIRED → 입고확인 종점', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    // 방금까지 막혔던 상위 담기가 하위 입고확인으로 열린다.
    const box = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `입고 후 상위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const topShip = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    expect(topShip?.receiverKind, '받는측 관리자').toBe('admin');
    expect(topShip?.mode, 'MD(KR)→관리자(KR) 국내').toBe('domestic');
    ledger.push(`sp_pcb_shipment (MD→관리자, po ${String(topPoId)})`);
    await rp.view(mdView, '/app/partner/pcb/ship', 'K05-md-ship-board');

    const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      carrier: '우체국택배',
      trackingNumber: 'MD4-KR-TOP-0810',
    });
    expect(adv.status, `국내 발송: ${JSON.stringify(adv.json)}`).toBe(200);

    // 국내 종점은 전이가 아니라 입고확인이 닫는다(P4.10) — 전이만 시도하면 409 가 정상.
    const advOnly = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/advance`,
      {},
    );
    expect(advOnly.status, '입고확인 없는 delivered 전이').toBe(409);
    expect(advOnly.json?.error).toBe('RECEIVE_REQUIRED');
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/receive`,
      { note: '[MD 4편] 관리자 입고' },
    );
    expect(recv.status, `관리자 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findFirst({ where: { id: topShip?.id ?? 0n } });
    expect(closed?.status, '입고확인이 종점을 닫음').toBe('delivered');
    F('K5', 'obs', 'MD(KR)→관리자 국내 3단계 — RECEIVE_REQUIRED 확인 후 입고확인으로 종점');
  }, 180_000);

  test('K6. 고객 배송 큐 편입 → 배송 → 완료 — 완주 검증', async (ctx) => {
    if (odId === null) return ctx.skip();
    // 입고확인(K5) 뒤 od 는 아직 '입금' — 고객 배송 큐(P4.6 to_ship)에 올라야 한다.
    // (③여정 6호의 직송 오판 검증과 대비되는 정상 편입 기준선.)
    const queue = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(odId)}&page=1&pageSize=20`,
    );
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const row = (queue.json?.data?.items ?? []).find((r: any) => r.odId === odId);
    expect(row, '입고확인 후 배송 처리 대기 편입').toBeTruthy();
    expect(row?.receivedPoCount, '입고확인 수 enrich').toBeGreaterThan(0);
    F('K6', 'obs', `고객 배송 큐 정상 편입 — od=${odId} receivedPoCount=${String(row?.receivedPoCount)}`);

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: 'MD4-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) F('K6', 'obs', `배송 전이: ${JSON.stringify(ship.json)}`);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    if (fin.status !== 200) F('K6', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    const prisma = getPrisma();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(rows[0]?.od_status, '최종 상태').toBe('완료');
    expect(Number(rows[0]?.od_misu ?? -1), '미수금').toBe(0);
    F(
      'K6',
      'obs',
      `MD 4편 완주 — od=${odId} 상위po=${String(topPoId)} 하위po=${String(childPoId)} (두 구간 모두 국내)`,
    );
  }, 120_000);
});
