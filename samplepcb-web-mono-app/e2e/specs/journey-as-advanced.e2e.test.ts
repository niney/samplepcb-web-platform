// 7호 완주 여정 — A/S 심화: **MD 경유 트랙의 A/S 회차**와 **다회차(거절→재접수→2회차)**를
// 잇는다. 5호(직거래 A/S 1회차)가 못 밟은 두 축이다:
//
//   ① MD 경유 proceed 분기 — 케이스 대상은 leaf(협력2)인데 회차 발주 A 는 **MD(관리자→MD)**
//      로 선다(topPartnerIdOf). 하위 B 는 MD 가 포털에서 이어받아 발주(회차 상속)하고,
//      포털 A/S 목록의 roundPoId 딥링크는 보는 조직마다 다르다(MD=A · 협력2=하위 B — #9).
//   ② 회차 채번의 케이스 축 — 거절(rejected)된 케이스는 round 를 점유하지 않으므로(NULL)
//      다음 진행은 MAX+1 로 **2** 가 되어야 한다. 유상(paid) 2회차는 송금 큐에 서고,
//      무상(free) 1회차는 잔액 0 으로 눕는다(무상 제외 수정의 대조 — isFreeAs).
//
// 원주문 구간(T1)은 MD 5편(md-cn-relay)의 경로를 축약 재사용한다 — 상설 픽스처
// mdtester2상사(CN/USD)+관계→협력2(USD)를 그대로 쓴다(**cleanup-md 금지** — 관계가 끊긴다).
// 회차 발송은 MD 입고까지 1칸에서 멈춘다 — 전 구간은 원주문(T1)이 이미 걸었고, 이 여정의
// 목적은 회차 축의 분기(케이스·발주·딥링크·돈)가 트랙(MD 경유)과 얽히는 지점이다.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:as2  (PORTAL_E2E=1 + JOURNEY=1)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(8040)·Mailpit + e2e/.env.e2e 고객 자격.
// **생성물은 정리하지 않는다** — 대장(ledger) 기록 후 cleanup-probe.mts(스펙 축 훑기 —
// 상설 픽스처 무접촉, A/S 케이스는 스펙 FK cascade 소멸). 첨부는 이 여정에선 안 만든다.
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
  mailpitMessage,
  mailpitSearch,
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
const MD2_MB_ID = 'mdtester2';
const MD2_ORG_NAME = 'mdtester2상사';
const CHILD_NAME = '협력2'; // CN·USD — 링크 통화 USD
const MARGIN_RATE = 15;
const CHILD_PRICE = 250; // 협력2 회신(USD) → MD 회신가 287.50 = 250 × 1.15

describe.skipIf(!RUN || !JOURNEY)('여정 7호 — A/S 심화(MD 경유·다회차) 탐색 주행', () => {
  const rp = createJourneyReport('findings-as2', '여정 7호 A/S 심화(MD 경유·다회차) 탐색 주행 리포트');
  const { F, ledger, view } = rp;

  let customer: PhpLoginResult; // 실로그인(PHP+거버 — 원주문·EQ 고객확인)
  let adminView: E2eSession; // 관리자 화면 관찰용(스텁)
  let md2View: E2eSession; // MD 화면 관찰용(스텁 mdtester2)
  let partner2View: E2eSession; // 협력2 화면 관찰용(스텁)
  let child: PartnerFixture; // 협력2(CN·USD) — 협력1 은 실데이터라 쓰기 금지
  let md2PartnerId: bigint | null = null;
  let A = ''; // 관리자 API 토큰
  let M2 = ''; // MD(mdtester2) API 토큰
  let C = ''; // 협력2 API 토큰

  // 여정 상태 — 앞 단계가 만들면 뒷 단계가 쓴다(실패 시 ctx.skip)
  let specId: number | null = null;
  let topRfqId: number | null = null; // 관리자→MD (round 0)
  let childRfqId: number | null = null; // MD→협력2 (round 0)
  let odId: string | null = null;
  let topPoId: number | null = null; // A: 관리자→MD (round 0)
  let childPoId: number | null = null; // B: MD→협력2 (round 0)
  let childShipmentId0: string | null = null; // round 0 하위 발송 — T3a 분리 검증의 비교 축
  let case1Id: number | null = null; // 1회차 케이스(불량·무상)
  let case2Id: number | null = null; // 거절 케이스(round 미점유)
  let case3Id: number | null = null; // 2회차 케이스(실수·유상)
  let round1TopPoId: number | null = null; // A′: 관리자→MD (round 1)
  let round1ChildPoId: number | null = null; // B′: MD→협력2 (round 1)
  let round2TopPoId: number | null = null; // A″: 관리자→MD (round 2)

  // multipart 업로드(EQ 파일·선적 Invoice) — File 은 Node 20+ 글로벌
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

  /** 하위(협력2) EQ 파일 2종 업로드 → 승인요청. 원주문(round 0)과 회차(round 1)가 같은
   *  손놀림이라 공용화한다(journey.ts 관례) — 고객확인 삽입 여부만 갈라 승인은 따로 잇는다. */
  const childEqFilesAndRequest = async (poId: number, tag: string): Promise<void> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // 최소 zip 헤더(더미)
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        C,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-${tag}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${tag} ${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(C, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(req.status, `${tag} 승인요청: ${JSON.stringify(req.json)}`).toBe(200);
  };

  /** 관리자 EQ 승인 → 하위 생산 시작·완료. */
  const approveAndProduce = async (spec: number, poId: number, tag: string): Promise<void> => {
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(spec)}/pos/${String(poId)}/eq-approve`,
      {},
    );
    expect(ap.status, `${tag} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(C, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {});
    expect(st.status, `${tag} 생산 시작: ${JSON.stringify(st.json)}`).toBe(200);
    const done = await api(C, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {});
    expect(done.status, `${tag} 생산 완료: ${JSON.stringify(done.json)}`).toBe(200);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds(); // 없으면 안내 throw
    const prisma = getPrisma();

    child = await getPartner(CHILD_NAME);
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    M2 = signJwt({ mbId: MD2_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

    // ── 상설 픽스처 재사용(idempotent — md-cn-relay 미러): 있으면 그대로, 없으면 신설 ──
    let org = await prisma.spPartner.findFirst({ where: { name: MD2_ORG_NAME } });
    if (org === null) {
      const created = await api(A, 'POST', '/api/admin/partners', {
        type: 'partner',
        name: MD2_ORG_NAME,
        country: 'CN',
        defaultCurrency: 'USD',
        capabilities: ['pcb_rfq'],
        contactName: '마스터딜러2',
        contactEmail: 'mdtester2@test.local',
      });
      if (created.status !== 200) {
        throw new Error(`조직 생성 실패(${String(created.status)}): ${JSON.stringify(created.json)}`);
      }
      org = await prisma.spPartner.findFirst({ where: { name: MD2_ORG_NAME } });
      if (org === null) throw new Error('조직 생성 직후 조회 실패');
      console.log(`  [setup] 조직 신설: #${String(org.id)} ${MD2_ORG_NAME} (CN/USD)`);
    }
    md2PartnerId = org.id;

    const link = await prisma.spPartnerMember.findFirst({
      where: { partnerId: org.id, mbId: MD2_MB_ID },
    });
    if (link === null) {
      const add = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/members`, {
        mbId: MD2_MB_ID,
        role: 'owner',
      });
      // g5 회원 미러가 필요한 첫 구축은 md-cn-relay 가 담당한다 — 여기선 존재를 전제.
      if (add.status !== 200) {
        throw new Error(
          `계정 연결 실패(${String(add.status)}): ${JSON.stringify(add.json)} — 먼저 pnpm -F e2e md:cn 으로 픽스처를 구축하세요`,
        );
      }
      console.log(`  [setup] ${MD2_MB_ID} → ${MD2_ORG_NAME} 연결`);
    }

    const relation = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: org.id, childPartnerId: child.id },
    });
    if (relation === null) {
      const rel = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/relations`, {
        childPartnerId: num(child.id),
        settlementCurrency: 'USD',
      });
      if (rel.status !== 200) {
        throw new Error(`MD 관계 생성 실패(${String(rel.status)}): ${JSON.stringify(rel.json)}`);
      }
      console.log(`  [setup] 관계 신설: ${MD2_ORG_NAME} → ${CHILD_NAME} (USD)`);
    }

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    md2View = await newSession({ mbId: MD2_MB_ID }, { partnerModule: 'pcb' });
    rp.watchHttp(md2View, 'MD2');
    partner2View = await newSession({ mbId: child.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partner2View, '협력2');
  }, 180_000);

  afterAll(async () => {
    // 픽스처(조직·연결·관계)는 상설 — 정리하지 않는다. 생성물만 대장으로.
    rp.write({ 고객: customer, 관리자: adminView, MD2: md2View, 협력2: partner2View });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('T1a. 원주문 압축 — 거버 제출 → 2단 RFQ(관리자→MD→협력2) → 회신 → 마진 선정 → 확정가', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정7] A/S 심화(MD 경유) — 확인 후 정리',
      prefix: 'V01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — A/S 심화 원주문)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(md2PartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    topRfqId =
      (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(md2PartnerId ?? 0n))
        ?.rfqId ?? null;
    expect(topRfqId, 'MD RFQ 행').not.toBeNull();
    ledger.push(`sp_pcb_rfq #${String(topRfqId)} (관리자→MD2, round 0)`);

    const assign = await api(M2, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(child.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 배정: ${JSON.stringify(assign.json)}`).toBe(200);
    const prisma = getPrisma();
    const childRfq = await prisma.spPcbRfq.findFirst({
      where: { specId: BigInt(specId), partnerId: child.id, parentPartnerId: md2PartnerId ?? 0n },
      orderBy: { id: 'desc' },
    });
    childRfqId = num(childRfq.id);
    ledger.push(`sp_pcb_rfq #${String(childRfqId)} (MD2→협력2, round 0)`);

    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: CHILD_PRICE,
      quotedDeliveryDate: '2026-08-22',
      memo: '[여정7] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const pick = await api(M2, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);

    // USD 선정은 KRW 환산 필요 — 당일 환율 캐시 자동, 미준비 로컬이면 명시 환율 폴백(관례).
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: 620_000 },
    );
    if (sel.status === 400) {
      F('T1', 'obs', `당일 환율 캐시 없음 — 명시 환율 폴백: ${JSON.stringify(sel.json)}`);
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 620_000 },
      );
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 300_000);

  test('T1b. 원주문 압축 — 주문 → 입금 → 발주 2단(A·B) → 하위 EQ~생산', async (ctx) => {
    if (specId === null || topRfqId === null || childRfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'T1b',
      prefix: 'V02',
      buyerName: 'e2e여정7고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(md2PartnerId ?? 0n),
      rfqId: topRfqId,
    });
    expect(issue.status, `MD 발주(A): ${JSON.stringify(issue.json)}`).toBe(200);
    topPoId =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(md2PartnerId ?? 0n))
        ?.poId ?? null;
    expect(topPoId, '관리자→MD 발주서(round 0)').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(topPoId)} (관리자→MD2, round 0)`);

    const create = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId,
    });
    expect(create.status, `하위 발주(B): ${JSON.stringify(create.json)}`).toBe(200);
    const prisma = getPrisma();
    const childPo = await prisma.spPcbPo.findFirst({
      where: {
        specId: BigInt(specId),
        partnerId: child.id,
        parentPartnerId: md2PartnerId ?? 0n,
        reorderRound: 0,
      },
      orderBy: { id: 'desc' },
    });
    childPoId = num(childPo.id);
    ledger.push(`sp_pcb_po #${String(childPoId)} (MD2→협력2, round 0)`);

    await childEqFilesAndRequest(childPoId, 'r0');
    await approveAndProduce(specId, childPoId, 'r0');
  }, 480_000);

  test('T1c. 원주문 압축 — 하위 국내(CN→CN)→게이팅 해제→MD 국제(CN→KR)→입고→주문 완료', async (ctx) => {
    if (specId === null || topPoId === null || childPoId === null || odId === null) {
      return ctx.skip();
    }
    // 게이팅 — 하위 입고 전 MD 상위 출고 불가(해제 열쇠는 하위 receivedAt).
    const blocked = await api(M2, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(blocked.status, `하위 입고 전 상위 담기: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error).toBe('OUTBOUND_BLOCKED');

    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, `하위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const childLink = await prisma.spPcbShipmentPo.findUnique({
      where: { poId: BigInt(childPoId) },
    });
    expect(childLink, '하위 발주 선적 멤버십').toBeTruthy();
    childShipmentId0 = String(childLink.shipmentId);
    ledger.push(`sp_pcb_shipment #${childShipmentId0} (협력2→MD2, round 0 국내)`);

    const adv = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      carrier: 'SF Express',
      trackingNumber: 'JRN7-CN-CHILD-0810',
    });
    expect(adv.status, `하위 국내 발송(CN→CN): ${JSON.stringify(adv.json)}`).toBe(200);
    const recv = await api(M2, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[여정7] MD2 입고',
    });
    expect(recv.status, `MD2 입고확인(게이팅 해제): ${JSON.stringify(recv.json)}`).toBe(200);

    // 게이팅 해제 — 이제 MD 상위 담기가 열린다.
    const topBox = await api(M2, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(topBox.status, `입고 후 상위 담기: ${JSON.stringify(topBox.json)}`).toBe(200);
    ledger.push(`sp_pcb_shipment (MD2→관리자, po ${String(topPoId)} — round 0 국제)`);

    // 국제 requested 는 Invoice 첨부 필수.
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      M2,
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-as2-origin.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);

    // 이후 체인은 관리자 대행으로 소진(선적 AWB → 국내도착 → 통관 → 완료) → 입고확인.
    for (let i = 0; i < 6; i += 1) {
      const step = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'JRN7-AWB-0810' },
      );
      if (step.status !== 200) {
        expect(step.json?.error, `발송 체인 중단: ${JSON.stringify(step.json)}`).toBe('ALREADY_FINAL');
        break;
      }
    }
    const recvTop = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/receive`,
      { note: '[여정7] 관리자 입고' },
    );
    expect(recvTop.status, `관리자 입고확인: ${JSON.stringify(recvTop.json)}`).toBe(200);

    // A/S 는 완료 건 재생산이 전형 — force-status 로 '완료'까지(재고 앵커: 정리 시 '주문'
    // 으로 되돌려 재고 복원 — cleanup-probe 가 밟는 경로).
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(fin.status, `완료 전이: ${JSON.stringify(fin.json)}`).toBe(200);
    F(
      'T1',
      'obs',
      `원주문 완주 — od=${odId} spec=${String(specId)} A=#${String(topPoId)} B=#${String(childPoId)} (완료 상태에서 A/S 개시)`,
    );
  }, 300_000);

  test('T2a. A/S 후보=협력2(leaf)·MD 경유 트랙 → 접수(불량=무상) → 접수 요청(메일 버튼 유지)', async (ctx) => {
    if (specId === null || childPoId === null) return ctx.skip();
    const cand = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/as-candidates`);
    expect(cand.status, JSON.stringify(cand.json)).toBe(200);
    const cands = cand.json?.data?.candidates ?? [];
    const c2 = cands.find((c: any) => c.partnerId === num(child.id));
    expect(c2, '후보=협력2(생산 주체 leaf)').toBeTruthy();
    expect(c2?.parentPartnerId, '트랙=MD 경유(parent=mdtester2상사)').toBe(num(md2PartnerId ?? 0n));
    expect(c2?.poId, '후보의 근거 발주 = 하위 B(round 0)').toBe(childPoId);
    expect(
      cands.some((c: any) => c.partnerId === num(md2PartnerId ?? 0n)),
      'MD 조직은 중계자라 후보가 아니다',
    ).toBe(false);

    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(child.id),
      caseType: 'product_defect',
      description: '[여정7] 도금 불량 — 재생산 요청(1회차)',
    });
    expect(create.status, `케이스 생성: ${JSON.stringify(create.json)}`).toBe(200);
    const created = create.json?.data?.asCase;
    expect(created?.chargeType, '불량=무상 기본').toBe('free');
    expect(created?.status, '초안 시작').toBe('draft');
    expect(created?.parentPartnerId, '케이스 트랙=MD 경유').toBe(num(md2PartnerId ?? 0n));
    expect(created?.parentPartnerName, 'MD 조직명').toBe(MD2_ORG_NAME);
    case1Id = created?.id ?? null;
    ledger.push(`sp_pcb_as_case #${String(case1Id)} (1회차 — 스펙 FK cascade 소멸)`);

    // Mailpit 기준선(같은 제목의 지난 주행 메일과 구분) → 접수 요청 → 신착 확인.
    const childEmail = (await getPrisma().spPartner.findUnique({ where: { id: child.id } }))
      ?.contactEmail as string | null;
    const query = `to:"${childEmail ?? ''}" subject:"A/S 재생산 검토 요청"`;
    const baseline = childEmail === null ? null : ((await mailpitSearch(query))?.messages?.[0]?.ID ?? null);

    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case1Id)}/submit`, {});
    expect(submit.status, `접수 요청: ${JSON.stringify(submit.json)}`).toBe(200);
    expect(submit.json?.data?.asCase?.status, '접수 상태').toBe('submitted');

    if (childEmail === null || childEmail === '') {
      F('T2', 'obs', '협력2 contactEmail 없음 — 접수 메일 검증 생략');
    } else {
      let mail: any = null;
      for (let i = 0; i < 10 && mail === null; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const found = (await mailpitSearch(query))?.messages?.[0] ?? null;
        if (found !== null && found.ID !== baseline) mail = found;
      }
      expect(mail, '접수 메일 수신(Mailpit)').toBeTruthy();
      const body = await mailpitMessage(mail.ID);
      // 협력2는 연결 계정이 있으므로 포털 CTA 버튼이 유지돼야 한다(무계정 대행 안내 아님).
      expect(String(body?.HTML ?? ''), '포털 버튼 유지(계정 있음)').toContain('파트너 포털에서 회신하기');
      expect(String(body?.HTML ?? '')).not.toContain('관리자 대행 회신');
      F('T2', 'obs', `접수 메일 확인 — ${childEmail} · 포털 CTA 버튼 유지(hasPortalAccount)`);
    }

    // 포털 노출 — 협력2(target)와 MD(중계 열람) 둘 다 보인다.
    const plist = await api(C, 'GET', '/api/partner/pcb-as-cases');
    expect((plist.json?.data?.cases ?? []).find((c: any) => c.id === case1Id)?.status).toBe('submitted');
    const mlist = await api(M2, 'GET', '/api/partner/pcb-as-cases');
    expect(
      (mlist.json?.data?.cases ?? []).find((c: any) => c.id === case1Id),
      'MD 중계 열람(parent=나)',
    ).toBeTruthy();
  }, 120_000);

  test('T2b. 협력2 수락 → proceed — 회차 A는 MD(관리자→MD)로만 생성(조건 복사·납기 null)', async (ctx) => {
    if (specId === null || case1Id === null || topPoId === null) return ctx.skip();
    const accept = await api(C, 'POST', `/api/partner/pcb-as-cases/${String(case1Id)}/accept`, {
      reason: '[여정7] 재생산 가능 — 무상 수락',
    });
    expect(accept.status, `수락: ${JSON.stringify(accept.json)}`).toBe(200);

    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case1Id)}/proceed`, {});
    expect(proceed.status, `진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    expect(proceed.json?.data?.reorderRound, '1차 회차 채번').toBe(1);
    round1TopPoId = proceed.json?.data?.poId ?? null;
    expect(round1TopPoId, 'proceed 응답 poId').not.toBeNull();
    expect(proceed.json?.data?.asCase?.roundPoId, '관리자 케이스 딥링크=A′').toBe(round1TopPoId);
    ledger.push(`sp_pcb_po #${String(round1TopPoId)} (관리자→MD2, A/S round 1)`);

    const prisma = getPrisma();
    const [origin, round] = await Promise.all([
      prisma.spPcbPo.findUnique({ where: { id: BigInt(topPoId) } }),
      prisma.spPcbPo.findUnique({ where: { id: BigInt(round1TopPoId ?? 0) } }),
    ]);
    // MD 경유 proceed 분기(topPartnerIdOf) — 대상은 협력2인데 회차 최상위 발주는 MD 로 선다.
    expect(num(round?.partnerId ?? 0n), '회차 A′ 수주자=MD(대상 아님)').toBe(num(md2PartnerId ?? 0n));
    expect(num(round?.parentPartnerId ?? -1n), '최상위(parent 0)').toBe(0);
    expect(round?.reorderRound, '회차 1').toBe(1);
    expect(round?.status, '회차 발주 issued').toBe('issued');
    expect(String(round?.currency), '통화 원발주(A) 동일').toBe(String(origin?.currency));
    expect(Number(round?.priceOriginal), '가격 원발주(A) 동일').toBe(Number(origin?.priceOriginal));
    expect(round?.krwAmount, 'KRW 회계 승계').toBe(origin?.krwAmount);
    expect(round?.deliveryDate, '납기 비움(stale 교정)').toBeNull();
    expect(JSON.stringify(round?.eqHistory), 'EQ 이력 초기화').toBe('[]');
    // 하위 B′ 는 아직 없다 — MD 가 포털에서 이어받아 발주하는 몫.
    const childCount = await prisma.spPcbPo.count({
      where: { specId: BigInt(specId), parentPartnerId: md2PartnerId ?? 0n, reorderRound: 1 },
    });
    expect(childCount, 'proceed 는 하위 발주를 만들지 않는다').toBe(0);
    F(
      'T2',
      'obs',
      `proceed MD 분기 — A′ #${String(round1TopPoId)} 수주자=MD(${MD2_ORG_NAME})·round 1·` +
        `${String(round?.currency)} ${String(round?.priceOriginal)} 복사·납기 null·하위 미생성`,
    );
  }, 120_000);

  test('T2c. MD 하위 회차 발주 — 회차 상속(현재 동작 박제·경로 막히면 회차 RFQ 직삽입 우회)', async (ctx) => {
    if (specId === null || case1Id === null || round1TopPoId === null || childRfqId === null) {
      return ctx.skip();
    }
    const prisma = getPrisma();
    // MD 관점의 회차 A′ — 하위가 없으니 EQ 는 위임 대기(blocked)로 시작해야 한다.
    const before = await api(M2, 'GET', `/api/partner/pcb-pos/${String(round1TopPoId)}`);
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    expect(before.json?.data?.eq?.blocked, '하위 발주 전 EQ 차단(MD 위임 대기)').toBe(true);
    expect(before.json?.data?.reorderRound, 'A′ 회차 배지 데이터').toBe(1);
    const candidates = before.json?.data?.childRfqs ?? [];

    // ① 실제 포털 경로 그대로 — round 0 하위 회신으로 하위 발주 시도(현재 동작 박제).
    const attempt = await api(M2, 'POST', `/api/partner/pcb-pos/${String(round1TopPoId)}/children`, {
      childRfqId,
    });
    if (attempt.status === 200) {
      F('T2', 'obs', '회차 하위 발주 — round 0 하위 회신으로도 발주 허용(회차 불일치 가드 없음)');
    } else {
      expect(attempt.json?.error, `하위 발주 거부 사유: ${JSON.stringify(attempt.json)}`).toBe(
        'CHILD_RFQ_MISMATCH',
      );
      F(
        'T2',
        'bug',
        `MD 경유 A/S 회차의 하위 발주가 포털에서 불가 — children 은 같은 회차(round 1)의 하위 ` +
          `회신을 요구하는데(CHILD_RFQ_MISMATCH), 회차 하위 RFQ 를 만들 경로가 없다(하위 배정 ` +
          `라우트는 관리자→MD round 0 행 앵커·상세 후보 childRfqs=${String(candidates.length)}건). ` +
          `EQ 도 위임 대기(blocked)라 MD 경유 회차는 여기서 멈춘다 — 문서 §9 P4.12 "하위 발주는 ` +
          `MD 가 포털에서 회차를 이어받아 발주(무변경)"와 어긋나는 지점(서버 무수정·박제).`,
      );
      // ② 회차 하위 RFQ 직삽입(우회 시드) — 경로 부재와 "상속 자체는 동작"을 분리 검증한다.
      const r0 = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(childRfqId) } });
      const seeded = await prisma.spPcbRfq.create({
        data: {
          specId: BigInt(specId),
          partnerId: child.id,
          parentPartnerId: md2PartnerId ?? 0n,
          reorderRound: 1,
          status: 'quoted',
          currency: r0.currency,
          priceOriginal: r0.priceOriginal,
          subCurrency: r0.subCurrency,
          subPriceOriginal: r0.subPriceOriginal,
          subExchangeRate: r0.subExchangeRate,
          quotedDeliveryDate: r0.quotedDeliveryDate,
          respondedAt: new Date(),
          memo: '[여정7] 회차 하위 RFQ 직삽입 시드 — 생성 경로 부재 우회',
        },
      });
      ledger.push(`sp_pcb_rfq #${String(num(seeded.id))} (MD2→협력2, round 1 — 직삽입 시드)`);
      const retry = await api(M2, 'POST', `/api/partner/pcb-pos/${String(round1TopPoId)}/children`, {
        childRfqId: num(seeded.id),
      });
      expect(retry.status, `회차 하위 발주(시드 후): ${JSON.stringify(retry.json)}`).toBe(200);
    }

    const childPo = await prisma.spPcbPo.findFirst({
      where: { specId: BigInt(specId), partnerId: child.id, parentPartnerId: md2PartnerId ?? 0n, reorderRound: 1 },
      orderBy: { id: 'desc' },
    });
    expect(childPo, '회차 하위 발주 B′').toBeTruthy();
    round1ChildPoId = num(childPo.id);
    expect(childPo.reorderRound, 'parentPo.reorderRound 자동 상속=1').toBe(1);
    expect(childPo.status, 'B′ issued').toBe('issued');
    ledger.push(`sp_pcb_po #${String(round1ChildPoId)} (MD2→협력2, A/S round 1)`);

    // 하위가 생겼으니 A′ 의 EQ 위임이 B′ 로 연결된다.
    const after = await api(M2, 'GET', `/api/partner/pcb-pos/${String(round1TopPoId)}`);
    expect(after.json?.data?.eq?.delegatePoId, '회차 EQ 위임 대상=B′').toBe(round1ChildPoId);
  }, 120_000);

  test('T2d. 회차 EQ — 하위 파일→승인요청 → EQ 고객확인(관리자 요청→고객 PHP 승인) → 승인→생산', async (ctx) => {
    if (specId === null || round1ChildPoId === null || odId === null) return ctx.skip();
    await childEqFilesAndRequest(round1ChildPoId, 'r1');

    // 회차 EQ 고객확인(P4.1 — 여정 1호 S9 미러): 요청은 관리자, 승인은 고객 주문내역(PHP).
    const create = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(round1ChildPoId)}`, {
      message: '[여정7] A/S 1차 재생산 사양을 확인해 주세요',
      dueOn: '2026-08-14',
      sharedFileIds: [],
    });
    expect(create.status, `고객확인 요청: ${JSON.stringify(create.json)}`).toBe(200);
    ledger.push(`sp_pcb_eq_review (po ${String(round1ChildPoId)} — 회차 EQ 고객확인)`);

    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, {
      waitUntil: 'domcontentloaded',
    });
    await rp.shot(customer, 'V08-orderview-round-eq-request');
    // 폼 승인(.sp_eq_approve) → spDialog 확인(.sp-dlg-ok) — 1호 S9 의 셀렉터 교훈 승계.
    await page.locator('.sp_eq_approve').first().click();
    await page.locator('.sp-dlg-ok').waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([
      page.waitForURL('**/orderinquiryview.php**', { timeout: 30_000 }),
      page.locator('.sp-dlg-ok').click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await rp.shot(customer, 'V08-round-eq-approved');

    const prisma = getPrisma();
    const rv = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(round1ChildPoId) },
      orderBy: { id: 'desc' },
    });
    expect(rv?.status, '회차 EQ 고객 승인 DB 반영').toBe('approved');
    F('T2', 'obs', `회차 EQ 고객확인 — review #${String(num(rv.id))} approved(주문 od=${odId})`);

    await approveAndProduce(specId, round1ChildPoId, 'r1');
  }, 240_000);

  test('T2e. 포털 A/S 목록 roundPoId — MD 관점=A′·협력2 관점=B′(#9 수정분 회귀)', async (ctx) => {
    if (case1Id === null || round1TopPoId === null || round1ChildPoId === null) return ctx.skip();
    const mdList = await api(M2, 'GET', '/api/partner/pcb-as-cases');
    const mdCase = (mdList.json?.data?.cases ?? []).find((c: any) => c.id === case1Id);
    expect(mdCase?.status, '케이스 진행 종결(proceeded)').toBe('proceeded');
    expect(mdCase?.reorderRound, '회차 1').toBe(1);
    expect(mdCase?.roundPoId, 'MD 딥링크=내가 여는 A′(최상위 회차 수주)').toBe(round1TopPoId);

    const cList = await api(C, 'GET', '/api/partner/pcb-as-cases');
    const cCase = (cList.json?.data?.cases ?? []).find((c: any) => c.id === case1Id);
    expect(cCase?.roundPoId, '협력2 딥링크=내가 여는 하위 B′').toBe(round1ChildPoId);
    F(
      'T2',
      'obs',
      `roundPoId 관점 분기 — MD=A′#${String(round1TopPoId)} · 협력2=B′#${String(round1ChildPoId)}`,
    );
  });

  test('T3a. 1회차 발송 1칸 — 하위(CN)→MD(CN) 국내·MD 입고(round 0 박스와 분리)', async (ctx) => {
    if (round1ChildPoId === null || childShipmentId0 === null) return ctx.skip();
    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: round1ChildPoId });
    expect(box.status, `회차 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const link = await prisma.spPcbShipmentPo.findUnique({
      where: { poId: BigInt(round1ChildPoId) },
    });
    expect(link, '회차 하위 선적 멤버십').toBeTruthy();
    const roundShipmentId = String(link.shipmentId);
    // 같은 받는측(MD)이어도 contextKey 회차 편입으로 round 0 박스와 합류하지 않는다.
    expect(roundShipmentId, 'round 0 하위 발송과 다른 박스').not.toBe(childShipmentId0);
    ledger.push(`sp_pcb_shipment #${roundShipmentId} (협력2→MD2, A/S 1차 — round 0 와 분리)`);

    const adv = await api(
      C,
      'POST',
      `/api/partner/pcb-pos/${String(round1ChildPoId)}/shipment/advance`,
      { carrier: 'SF Express', trackingNumber: 'JRN7-R1-0810' },
    );
    expect(adv.status, `회차 국내 발송: ${JSON.stringify(adv.json)}`).toBe(200);
    const recv = await api(
      M2,
      'POST',
      `/api/partner/pcb-pos/${String(round1ChildPoId)}/shipment/receive`,
      { note: '[여정7] 회차 MD 입고 — 1회차는 여기까지(전 구간은 원주문 몫)' },
    );
    expect(recv.status, `회차 MD 입고: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findUnique({ where: { id: link.shipmentId } });
    expect(closed?.status, '국내 종점 delivered').toBe('delivered');
    F('T3', 'obs', `회차 발송 분리 — shipment #${roundShipmentId} ≠ round0 #${childShipmentId0}`);
  }, 120_000);

  test('T3b. 케이스 2 — 접수→협력2 거절→rejected 종결(proceed 409·삭제 409·round 미점유)', async (ctx) => {
    if (specId === null) return ctx.skip();
    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(child.id),
      caseType: 'product_defect',
      description: '[여정7] 재불량 주장 — 협력2 거절 시나리오',
    });
    expect(create.status, JSON.stringify(create.json)).toBe(200);
    case2Id = create.json?.data?.asCase?.id ?? null;
    ledger.push(`sp_pcb_as_case #${String(case2Id)} (거절 케이스 — round 미점유)`);
    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case2Id)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);

    const reject = await api(C, 'POST', `/api/partner/pcb-as-cases/${String(case2Id)}/reject`, {
      reason: '[여정7] 원자재 단종 — 재생산 불가',
    });
    expect(reject.status, `거절: ${JSON.stringify(reject.json)}`).toBe(200);
    expect(reject.json?.data?.asCase?.status).toBe('rejected');
    expect(reject.json?.data?.asCase?.replyReason, '거절 사유 보존').toContain('원자재 단종');

    // rejected 는 종결 기록 — 진행도 삭제도 막힌다(레거시 갭 교정 회귀).
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case2Id)}/proceed`, {});
    expect(proceed.status, '거절 건 진행 차단').toBe(409);
    expect(proceed.json?.error).toBe('NOT_ACCEPTED');
    const del = await api(A, 'DELETE', `/api/admin/pcb-as-cases/${String(case2Id)}`);
    expect(del.status, '거절 건 삭제 차단(기록 보존)').toBe(409);
    expect(del.json?.error).toBe('NOT_DRAFT');

    const prisma = getPrisma();
    const row = await prisma.spPcbAsCase.findUnique({ where: { id: BigInt(case2Id ?? 0) } });
    expect(row?.reorderRound, '거절 케이스는 회차를 점유하지 않는다(NULL)').toBeNull();
  }, 120_000);

  test('T3c. 케이스 3 — 실수=유상 기본→수락→proceed round 2 채번(rejected 건너뜀)', async (ctx) => {
    if (specId === null) return ctx.skip();
    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(child.id),
      caseType: 'admin_fault',
      description: '[여정7] 사양 전달 실수 — 유상 재생산(2회차)',
    });
    expect(create.status, JSON.stringify(create.json)).toBe(200);
    expect(create.json?.data?.asCase?.chargeType, '관리자 실수=유상 기본').toBe('paid');
    case3Id = create.json?.data?.asCase?.id ?? null;
    ledger.push(`sp_pcb_as_case #${String(case3Id)} (2회차 유상 케이스)`);

    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case3Id)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);
    const accept = await api(C, 'POST', `/api/partner/pcb-as-cases/${String(case3Id)}/accept`, {
      reason: '[여정7] 유상 조건 수락',
    });
    expect(accept.status, `수락: ${JSON.stringify(accept.json)}`).toBe(200);

    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(case3Id)}/proceed`, {});
    expect(proceed.status, `진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    // 핵심 채번 어서션 — 케이스 축 MAX+1: rejected(round NULL)는 건너뛰고 1(케이스1) 다음 2.
    expect(proceed.json?.data?.reorderRound, '2회차 채번(거절 케이스 무점유)').toBe(2);
    round2TopPoId = proceed.json?.data?.poId ?? null;
    expect(round2TopPoId, '회차 2 발주 존재').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(round2TopPoId)} (관리자→MD2, A/S round 2 — 유상)`);

    const prisma = getPrisma();
    const round2 = await prisma.spPcbPo.findUnique({ where: { id: BigInt(round2TopPoId ?? 0) } });
    expect(num(round2?.partnerId ?? 0n), '회차 2 도 MD 로 선다').toBe(num(md2PartnerId ?? 0n));
    expect(round2?.reorderRound).toBe(2);
    expect(round2?.status).toBe('issued');
    F('T3', 'obs', `round 2 채번 — 케이스 3건(1차 proceeded·rejected NULL·2차 proceeded)에서 MAX+1=2`);
  }, 120_000);

  test('T3d. 돈 축 대조 — 유상 2회차는 송금 큐 대기, 무상 1회차는 잔액 0(isFreeAs)', async (ctx) => {
    if (specId === null || round1TopPoId === null || round2TopPoId === null || topPoId === null) {
      return ctx.skip();
    }
    const all = await api(
      A,
      'GET',
      `/api/admin/pcb-remittances?tab=all&q=${String(specId)}&page=1&pageSize=50`,
    );
    expect(all.status, JSON.stringify(all.json)).toBe(200);
    const rows = all.json?.data?.items ?? [];
    const r0 = rows.find((r: any) => r.poId === topPoId);
    const r1 = rows.find((r: any) => r.poId === round1TopPoId);
    const r2 = rows.find((r: any) => r.poId === round2TopPoId);
    expect(r0, '원발주(A) 행').toBeTruthy();
    expect(r1, '무상 1회차(A′) 행').toBeTruthy();
    expect(r2, '유상 2회차(A″) 행').toBeTruthy();
    expect(r1?.isFreeAs, '1회차=무상 A/S 배지').toBe(true);
    expect(r1?.summary?.balance, '무상 회차 잔액 0(지급 대상 아님)').toBe(0);
    expect(r2?.isFreeAs, '2회차=유상(무상 제외의 대조)').toBe(false);
    expect(r2?.summary?.balance, '유상 회차는 잔액이 산다').toBeGreaterThan(0);
    // 모수는 관리자 지급분(parent 0)만 — MD 하위 발주(B·B′)는 큐에 서지 않는다(이중 지급 방지).
    expect(
      rows.some((r: any) => r.poId === childPoId || r.poId === round1ChildPoId),
      'MD 하위 발주는 송금 큐 제외',
    ).toBe(false);

    const pending = await api(
      A,
      'GET',
      `/api/admin/pcb-remittances?tab=pending&q=${String(specId)}&page=1&pageSize=50`,
    );
    const pendingIds = (pending.json?.data?.items ?? []).map((r: any) => r.poId);
    expect(pendingIds, '유상 2회차는 지급 대기 큐에 선다').toContain(round2TopPoId);
    expect(pendingIds, '무상 1회차는 대기 큐에서 빠진다').not.toContain(round1TopPoId);
    F(
      'T3',
      'obs',
      `송금 큐 대조 — A″(유상) pending 편입·balance ${String(r2?.summary?.balance)} ${String(r2?.summary?.currency ?? '')} / A′(무상) isFreeAs·잔액 0`,
    );
  });

  test('T3e. 진행현황(R8 회귀) — production 편입·asRound 2·step 8·closed 제외·2차 배지', async (ctx) => {
    if (specId === null) return ctx.skip();
    const prod = await api(
      A,
      'GET',
      `/api/admin/pcb-cases?tab=production&q=${String(specId)}&page=1&pageSize=20`,
    );
    expect(prod.status, JSON.stringify(prod.json)).toBe(200);
    const row = (prod.json?.data?.items ?? []).find((r: any) => r.specId === specId);
    expect(row, 'od 완료여도 진행(발주·생산) 탭 편입').toBeTruthy();
    expect(row?.asRound, '최신 회차 2').toBe(2);
    expect(row?.asOpen, '회차 미종결(A″ issued·발송 전)').toBe(true);
    expect(row?.step, '판정 축=최신 회차: A″ 발주만 있는 상태 → 8(발주)').toBe(8);
    const closedQ = await api(
      A,
      'GET',
      `/api/admin/pcb-cases?tab=closed&q=${String(specId)}&page=1&pageSize=20`,
    );
    expect(
      (closedQ.json?.data?.items ?? []).find((r: any) => r.specId === specId),
      '완료·취소 탭에서 제외(A/S 진행 중)',
    ).toBeUndefined();

    await view(adminView, '/app/admin/pcb/cases', 'V13-admin-cases-open');
    await adminView.page.fill('input[type="search"]', String(specId));
    await adminView.page.press('input[type="search"]', 'Enter');
    await adminView.page.waitForLoadState('networkidle').catch(() => undefined);
    await adminView.page.getByText(`Q${String(specId)}`).first().waitFor({ timeout: 15_000 });
    const body: string = await adminView.page.evaluate(() => document.body.innerText);
    expect(body, "진행현황 행 'A/S 2차 진행' 배지").toContain('A/S 2차 진행');
    await rp.shot(adminView, 'V13-admin-cases-as2-badge');
    F('T3', 'obs', `진행현황 — production 편입(asRound=2·asOpen·step=8)·closed 제외·'A/S 2차 진행' 배지`);
  }, 120_000);

  test('T4. 화면 실측 — 관리자 Case A/S 패널 3행·포털 MD2(목록·A″ 2차 배지)·협력2 B′ 상세', async (ctx) => {
    if (specId === null || round1ChildPoId === null || round2TopPoId === null) return ctx.skip();
    // 관리자 Case — A/S 패널은 종결 케이스만 남으면 접힘 시작이라 펼쳐서 3행을 확인한다.
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'V14-admin-case-top');
    const asBar = adminView.page.getByText(/A\/S 재발주 \(3건/);
    await asBar.first().waitFor({ timeout: 15_000 });
    await asBar.first().click();
    await adminView.page.waitForLoadState('networkidle').catch(() => undefined);
    const adminBody: string = await adminView.page.evaluate(() => document.body.innerText);
    expect(adminBody, 'A/S 패널 — 재발주 진행(proceeded) 행').toContain('재발주 진행');
    expect(adminBody, 'A/S 패널 — 재생산 불가(rejected) 행').toContain('재생산 불가');
    expect(adminBody, 'A/S 패널 — MD 경유 트랙 라벨').toContain(`MD 경유 · ${MD2_ORG_NAME}`);
    expect(adminBody, '회차 배지 1차').toContain('1차');
    expect(adminBody, '회차 배지 2차').toContain('2차');
    expect(adminBody, '발주 패널 이전 회차 접힘 카운트').toContain('이전 회차');
    await rp.shot(adminView, 'V14-admin-case-as-panel-3rows');

    // 포털 MD2 — A/S 목록(중계 열람 3건·딥링크)과 회차 A″ 상세의 'A/S 2차' 배지.
    await view(md2View, '/app/partner/pcb/as', 'V15-md2-as-list');
    const mdBody: string = await md2View.page.evaluate(() => document.body.innerText);
    expect(mdBody, 'MD A/S 목록 — 1차 딥링크(A′)').toContain(`PO-${String(round1TopPoId)}`);
    expect(mdBody, 'MD A/S 목록 — 2차 딥링크(A″)').toContain(`PO-${String(round2TopPoId)}`);
    await view(md2View, `/app/partner/pcb/pos/${String(round2TopPoId)}`, 'V15-md2-round2-po');
    const mdPoBody: string = await md2View.page.evaluate(() => document.body.innerText);
    expect(mdPoBody, "A″ 상세 'A/S 2차' 배지").toContain('A/S 2차');

    // 포털 협력2 — 하위 회차 B′ 상세의 'A/S 1차' 배지.
    await view(partner2View, `/app/partner/pcb/pos/${String(round1ChildPoId)}`, 'V16-partner2-round1-child-po');
    const cBody: string = await partner2View.page.evaluate(() => document.body.innerText);
    expect(cBody, "B′ 상세 'A/S 1차' 배지").toContain('A/S 1차');
    F(
      'T4',
      'obs',
      `화면 실측 — Case A/S 패널 3행(1차·rejected·2차)+이전 회차 접힘·MD 목록 딥링크 ` +
        `A′#${String(round1TopPoId)}/A″#${String(round2TopPoId)}·협력2 B′#${String(round1ChildPoId)} 1차 배지`,
    );
  }, 180_000);
});
