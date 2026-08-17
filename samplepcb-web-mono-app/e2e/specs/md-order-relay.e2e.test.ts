// MD 시나리오 2 — **주문 연결 완주**(mdtester 상설 픽스처 기반). 시나리오 1의 견적 루프
// 뒤를 실제 주문에 붙여 배송 완료까지 간다. 여정 4호(관계를 만들고 지우는 CN MD)와 달리
// 여기는 **국내 MD**(마스터딜러상사·KR)라 물류 모드 조합이 뒤집힌다:
//
//   하위(협력2·CN) → MD(KR)  : 국제 6단계 — Invoice 필수, 받는측 md
//   MD(KR) → 관리자(KR)      : 국내 3단계 — 택배, 입고확인이 종점을 닫는다(P4.10)
//
// 여정 4호가 못 밟은 조합(받는측 md 국제 + 관리자행 국내)이 이 편의 차별점이다.
// 픽스처(조직·연결·관계)는 시나리오 1과 같은 사전 준비로 확보한다 — 만들고 지우지 않는다.
//
// 실행: pnpm -F e2e e2e md-order-relay  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 생성물은 자동 정리하지 않는다(대장 → cleanup-md.mts 스타일 수동 정리).
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
  ensureMdRelation,
  ensureStagePartner,
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
// 계정은 e2e 전용(e2e-*)만 — 실계정 소속을 직삽입으로 늘리면 1계정=1조직을 오염시킨다.
const MD_MB_ID = 'e2e-mdtester';
const MD_ORG_NAME = '마스터딜러상사';
const CHILD_NAME = '협력2';
const CHILD_MB_ID = 'e2e-mdsub2';
const MARGIN_RATE = 15;

describe.skipIf(!RUN || !JOURNEY)('MD 시나리오 2 — 주문 연결 완주(국내 MD·상설 픽스처)', () => {
  const rp = createJourneyReport('findings-md2', 'MD 시나리오 2 탐색 주행 리포트');
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

    // 무대 자기창조(idempotent) — 계정·조직·연결·관계 전부 e2e 전용으로 확보.
    const mdOrg = await ensureStagePartner({
      mbId: MD_MB_ID,
      orgName: MD_ORG_NAME,
      country: 'KR',
      currency: 'KRW',
    });
    child = await ensureStagePartner({
      mbId: CHILD_MB_ID,
      orgName: CHILD_NAME,
      country: 'CN',
      currency: 'USD',
    });
    await ensureMdRelation(mdOrg, child, 'USD');
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    mdPartnerId = mdOrg.id;
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

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

  test('D1. 견적 루프: 거버 → MD 배정 → 하위 회신 → MD 마진 → 관리자 선정+확정가', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[MD 2편] 주문 연결 완주 — 확인 후 정리 예정',
      prefix: 'D01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(mdPartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    topRfqId =
      (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(mdPartnerId ?? 0n))
        ?.rfqId ?? null;
    expect(topRfqId, 'MD RFQ').not.toBeNull();
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
    ledger.push(`sp_pcb_rfq #${String(childRfqId)} (MD→하위)`);

    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: 250,
      quotedDeliveryDate: '2026-08-22',
      memo: '[MD 2편] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);

    // MD 회신은 KRW 라 환율 없이 선정+확정가 한 번에(P4.7).
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: 620_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 300_000);

  test('D2. 고객 주문 → 입금 → MD 발주(selected 견적행 근거)', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'D2',
      prefix: 'D02',
      buyerName: 'e2eMD2고객',
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
    const topPo = (issue.json?.data?.pos ?? []).find(
      (p: any) => p.partnerId === num(mdPartnerId ?? 0n),
    );
    expect(topPo?.fulfillmentMode, '하위 선정 근거는 delegated 박제').toBe('delegated');
    ledger.push(`sp_pcb_po #${String(topPoId)} (관리자→MD)`);
  }, 480_000);

  test('D3. EQ 위임 → 하위 발주 → 하위 EQ 완주(생산완료)', async (ctx) => {
    if (topPoId === null || childRfqId === null) return ctx.skip();
    const before = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(before.json?.data?.eq?.blocked, 'delegated 하위 발주 전 EQ 시작 불가').toBe(true);

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
        `${fileType}-md2.zip`,
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

  test('D4. 하위(CN) → MD(KR) 국제 발송 — Invoice 필수, 받는측 md', async (ctx) => {
    if (childPoId === null || topPoId === null) return ctx.skip();
    // 게이팅 — 하위가 MD 에 도착하기 전에는 MD 상위 출고 불가.
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
    // 이 편의 차별점 ① — 받는측 md 인 **국제** 발송(4호는 두 구간 다 국제였지만 MD 가 CN).
    expect(shipment?.receiverKind, '받는측 md').toBe('md');
    expect(shipment?.mode, '하위(CN)→MD(KR) 국제').toBe('international');
    ledger.push(`sp_pcb_shipment (하위→MD, po ${String(childPoId)})`);

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(
      C,
      `/api/partner/pcb-pos/${String(childPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-md2.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    // 국제 체인의 나머지는 받는측(MD)이 민다 — shipped 는 AWB 트래킹 필수.
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
        trackingNumber: 'MD2-AWB-0810',
      });
      if (adv.status !== 200) break;
    }
    const recv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[MD 2편] MD 입고',
    });
    expect(recv.status, `MD 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    F('D4', 'obs', '하위(CN)→MD(KR) 국제 완주 + MD 입고확인 — 게이팅 해제 조건 충족');
  }, 240_000);

  test('D5. MD(KR) → 관리자(KR) 국내 발송 — 게이트 해제, 3단계·입고확인이 종점', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    // 방금까지 막혔던 상위 담기가 열린다.
    const box = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `입고 후 상위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const topShip = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    // 차별점 ② — MD 가 KR 이라 관리자행이 **국내**다(4호는 국제였다).
    expect(topShip?.receiverKind, '받는측 관리자').toBe('admin');
    expect(topShip?.mode, 'MD(KR)→관리자(KR) 국내').toBe('domestic');
    ledger.push(`sp_pcb_shipment (MD→관리자, po ${String(topPoId)})`);
    await rp.view(mdView, '/app/partner/pcb/ship', 'D05-md-ship-board');

    const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      carrier: '우체국택배',
      trackingNumber: 'MD2-KR-0810',
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
      { note: '[MD 2편] 관리자 입고' },
    );
    expect(recv.status, `관리자 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findFirst({ where: { id: topShip?.id ?? 0n } });
    expect(closed?.status, '입고확인이 종점을 닫음').toBe('delivered');
    F('D5', 'obs', 'MD(KR)→관리자 국내 3단계 — RECEIVE_REQUIRED 확인 후 입고확인으로 종점');
  }, 180_000);

  test('D6. 고객 배송 → 완료 — 완주 검증', async (ctx) => {
    if (odId === null) return ctx.skip();
    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: 'MD2-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) F('D6', 'obs', `배송 전이: ${JSON.stringify(ship.json)}`);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    if (fin.status !== 200) F('D6', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    const prisma = getPrisma();
    const row: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(row[0]?.od_status, '최종 상태').toBe('완료');
    expect(Number(row[0]?.od_misu ?? -1), '미수금').toBe(0);
    F(
      'D6',
      'obs',
      `MD 2편 완주 — od=${odId} 상위po=${String(topPoId)} 하위po=${String(childPoId)} (하위→MD 국제·MD→관리자 국내)`,
    );
  }, 120_000);
});
