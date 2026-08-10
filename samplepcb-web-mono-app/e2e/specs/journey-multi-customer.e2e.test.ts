// 여정 9호 — **다중 고객 × 묶음 발송**. 3호(묶음)를 고객 축으로 한 칸 넓힌다: 지금까지의
// 모든 여정은 고객이 **하나**였다. 주문이 둘이어도 주인이 같았으므로, "남의 것이 안 보인다"는
// 성질은 한 번도 시험된 적이 없다 — 소유 판정이 통째로 빠져 있어도 전부 green 이었다.
//
// 이 여정만 할 수 있는 것이 둘이다.
//   ① **박스 키에 고객 축이 없다는 설계의 실증** — 협력2(CN) 같은 회차·같은 직송지면
//      주인이 달라도 한 박스에 합류한다(contextKey = 받는측:조직:직송지:회차). 물류는
//      "누가 주문했나"를 모른다. 그게 의도이며, 여기서 처음 두 고객으로 확인된다.
//   ② **정보 격리** — 같은 박스·같은 선적을 공유하면서도 고객 축은 완전히 갈라져야 한다.
//      화면(주문내역·주문 상세·진행 카드)과 API(pcb-progress·pcb-eq-reviews·EQ decide)
//      양쪽에서, **남의 odId·프로젝트명이 새지 않고 남의 리뷰를 대신 결정할 수 없음**을
//      본다. 격리 검증은 음성(빈 배열)만으로는 못 믿는다 — 자기 것으로 같은 호출을 한 번
//      더 쳐서 **양성 대조**를 붙인다(라우트가 통째로 죽어도 빈 배열이 나오므로).
//
//   ③ 덤으로 **cross-member 배송 큐** — 3호의 to_ship 큐 검증은 두 주문의 회원이 같았다.
//      회원이 갈린 두 주문이 한 입고로 함께 큐에 오르는지는 여기가 처음이다.
//
// 2번 고객(e2e-customer2)은 1번 고객 회원 행 복제로 만드는 **상설 픽스처**다
// (ensureSecondCustomer — 비밀번호 해시까지 같아 자격은 아이디만 다르다). 주행 뒤에도
// 남긴다: 지우면 다음 주행이 다시 만들 뿐이고, 두 고객의 차이가 '누구냐' 하나로 좁혀져
// 있어야 격리의 대조가 성립한다.
//
// 실행: pnpm -F e2e journey:multi  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts 두 고객 축 훑기·회원 픽스처 무접촉).
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
  ensureSecondCustomer,
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
const PARTNER_NAME = '협력2'; // CN — 관리자행이라 국제(Invoice 필수) 경로가 된다(3호 동일)
/** 주행마다 갈리는 표식 — 두 고객의 프로젝트명이 서로 달라야 격리 문자열 검사가 성립한다. */
const RUN_TAG = String(Date.now()).slice(-6);

/** 한 고객의 여정 상태 — 두 사람을 같은 절차로 밀어야 해서 묶어 둔다(3호 Lane 의 고객판). */
interface Lane {
  label: string;
  /** 이 레인의 주인 — 격리 검증의 유일한 변수 */
  mbId: string;
  session: PhpLoginResult;
  /** 고객 본인 토큰(API 교차 접근 검증용) */
  token: string;
  projectName: string;
  specId: number | null;
  rfqId: number | null;
  odId: string | null;
  poId: number | null;
  price: number;
  invoiceNo: string;
}

describe.skipIf(!RUN || !JOURNEY)('여정 9호 — 다중 고객 × 묶음 발송(한 박스, 두 주인)', () => {
  const rp = createJourneyReport('findings-multi', '여정 9호 다중 고객 탐색 주행 리포트');
  const { F, ledger } = rp;

  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  // beforeAll 이 채운다(세션·토큰은 로그인 뒤에야 생긴다).
  const lanes: Lane[] = [
    {
      label: 'A',
      mbId: '',
      session: null as unknown as PhpLoginResult,
      token: '',
      projectName: `J9-A-${RUN_TAG}`,
      specId: null,
      rfqId: null,
      odId: null,
      poId: null,
      price: 71_000,
      invoiceNo: `MULTI-A-${RUN_TAG}`,
    },
    {
      label: 'B',
      mbId: '',
      session: null as unknown as PhpLoginResult,
      token: '',
      projectName: `J9-B-${RUN_TAG}`,
      specId: null,
      rfqId: null,
      odId: null,
      poId: null,
      price: 72_000,
      invoiceNo: `MULTI-B-${RUN_TAG}`,
    },
  ];
  const laneA = (): Lane => lanes[0] as Lane;
  const laneB = (): Lane => lanes[1] as Lane;
  /** 박스 대표 발주서 — 전이·입고확인은 대표로 친다(어느 멤버로 접근하든 같은 선적). */
  let boxRepPoId: number | null = null;
  /** A 건에만 만드는 EQ 고객확인 요청 — B 가 대신 결정하지 못함을 U7 이 시험한다. */
  let reviewIdA: number | null = null;

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

  /** 페이지 전문(innerText) — 격리 검사는 "무엇이 없다"라 화면 전체를 봐야 한다. */
  const bodyTextOf = async (s: { page: any }): Promise<string> =>
    s.page.evaluate(() => document.body.innerText) as Promise<string>;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');

    // 2번 고객은 상설 픽스처 — 없으면 1번 고객 행 복제로 세운다(idempotent).
    const second = await ensureSecondCustomer();
    if (second.created) console.log(`  [setup] 2번 고객 생성: ${second.mbId} (1번 고객 행 복제)`);

    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    // 국제 판정 전제(발송자 CN ≠ 받는측 KR) — 깨지면 Invoice 경로가 아니게 된다.
    expect(partner.country, `${PARTNER_NAME} 국가(국제 경로 전제)`).not.toBe('KR');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    // 두 고객의 PHP 세션을 **동시에** 유지한다 — newPhpSession 은 호출마다 새
    // BrowserContext 라 쿠키가 섞이지 않는다(같은 컨텍스트면 나중 로그인이 앞을 덮는다).
    for (const [i, lane] of lanes.entries()) {
      const creds = requireCustomerCreds(i === 0 ? 1 : 2);
      lane.mbId = creds.id;
      lane.session = await newPhpSession(creds);
      lane.token = signJwt({ mbId: creds.id, ttlSec: 3600 });
      rp.watchHttp(lane.session, `고객${lane.label}`);
    }
    expect(laneA().mbId, '두 고객이 서로 다른 회원').not.toBe(laneB().mbId);

    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 240_000);

  afterAll(async () => {
    // 회원 픽스처(e2e-customer2)는 상설 — 지우지 않는다. 문서 생성물만 대장으로 넘긴다.
    rp.write({
      고객A: lanes[0]?.session,
      고객B: lanes[1]?.session,
      관리자: adminView,
      파트너: partnerView,
    });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('U1. 두 고객이 각자 거버 제출 → 견적요청(세션 동시 유지)', async () => {
    const prisma = getPrisma();
    for (const lane of lanes) {
      lane.specId = await submitGerberRfq(lane.session, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 9호-${lane.label}] 다중 고객 묶음 — 확인 후 정리 예정`,
        prefix: `U01-${lane.label}`,
      });
      ledger.push(`sp_order_spec #${String(lane.specId)} (${lane.label}·${lane.mbId})`);
      // 같은 픽스처 zip 이라 프로젝트명이 둘 다 'arduino-uno.zip' 이다 — 그대로 두면
      // "남의 프로젝트명이 안 보인다"는 검사가 자기 것과 구별되지 않아 무의미해진다.
      // 소유자만 다른 두 건을 **이름으로 구별 가능**하게 만드는 것이 격리 검증의 전제다.
      await prisma.spOrderSpec.update({
        where: { id: BigInt(lane.specId) },
        data: { projectName: lane.projectName },
      });
    }
    expect(laneA().specId, 'A/B 견적 분리').not.toBe(laneB().specId);

    // 소유가 실제로 갈렸는지 원장에서 확인 — 이후 모든 격리 판정의 뿌리다.
    const owners = await prisma.spOrderSpec.findMany({
      where: { id: { in: lanes.map((l) => BigInt(l.specId ?? 0)) } },
      select: { id: true, mbId: true },
    });
    expect(new Set(owners.map((o: any) => o.mbId)).size, '두 견적의 주인이 서로 다름').toBe(2);
    F('U1', 'obs', `견적 2건 — A(${laneA().mbId}) #${String(laneA().specId)} · B(${laneB().mbId}) #${String(laneB().specId)}`);
  }, 420_000);

  test('U2. 관리자·파트너: 각 건 RFQ(협력2) → 회신 → 선정+확정가', async (ctx) => {
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
        price: 320,
        quotedDeliveryDate: '2026-08-20',
        memo: `[여정 9호-${lane.label}] 회신`,
      });
      expect(reply.status, `${lane.label} 회신: ${JSON.stringify(reply.json)}`).toBe(200);

      // 환율은 생략 — 당일 수출입은행 캐시가 자동 적용된다(P4.7). 없으면 명시값 폴백.
      const selectPath = `/api/admin/pcb-projects/${String(lane.specId)}/rfqs/${String(lane.rfqId)}/select`;
      let sel = await api(A, 'POST', selectPath, { finalPrice: lane.price });
      if (sel.status === 400) {
        F('U2', 'obs', `${lane.label} 당일 환율 캐시 없음 — 명시 환율 폴백`);
        sel = await api(A, 'POST', selectPath, { exchangeRate: 1400, finalPrice: lane.price });
      }
      expect(sel.status, `${lane.label} 선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
    }
  }, 180_000);

  test('U3. 각 고객이 **자기 견적만** 주문 → 서로 다른 od_id·서로 다른 mb_id', async (ctx) => {
    if (lanes.some((l) => l.specId === null)) return ctx.skip();
    for (const lane of lanes) {
      const order = await placeOrderFromQuotes(lane.session, rp, {
        specId: lane.specId ?? 0,
        step: 'U3',
        prefix: `U03-${lane.label}`,
        buyerName: `e2e다중고객${lane.label}`,
      });
      lane.odId = order.odId;
      ledger.push(`g5_shop_order od_id=${order.odId} (${lane.label}·${lane.mbId})`);
    }
    expect(laneA().odId, 'A/B 주문번호 분리').not.toBe(laneB().odId);

    // 주문 헤더의 회원까지 갈렸는지 — 배송 큐의 cross-member 판정(U8)의 전제다.
    const prisma = getPrisma();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_id, mb_id FROM g5_shop_order WHERE od_id IN (?, ?)`,
      laneA().odId,
      laneB().odId,
    );
    expect(rows.length, '주문 2건').toBe(2);
    for (const lane of lanes) {
      const row = rows.find((r) => String(r.od_id) === lane.odId);
      expect(String(row?.mb_id ?? ''), `${lane.label} 주문 회원`).toBe(lane.mbId);
    }

    for (const lane of lanes) {
      const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [lane.odId],
        sendMail: false,
        sendSms: false,
      });
      expect(paid.status, `${lane.label} 입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    }
    F(
      'U3',
      'obs',
      `주문 2건(주인 분리) — A ${String(laneA().odId)}/${laneA().mbId} · B ${String(laneB().odId)}/${laneB().mbId}`,
    );
  }, 600_000);

  test('U4. 관리자·파트너: 발주 2건 → EQ(파일 2종·요청·승인) → 생산완료 2건 + A 건 고객확인 요청', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const lane of lanes) {
      const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(lane.specId)}/pos`, {
        partnerId: num(partner.id),
        rfqId: lane.rfqId,
      });
      expect(issue.status, `${lane.label} 발주: ${JSON.stringify(issue.json)}`).toBe(200);
      const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id));
      expect(po, `${lane.label} 발주서 행`).toBeTruthy();
      lane.poId = po.poId;
      ledger.push(`sp_pcb_po #${String(lane.poId)} (${lane.label})`);

      for (const fileType of ['eq', 'working'] as const) {
        const up = await apiForm(
          P,
          `/api/partner/pcb-pos/${String(lane.poId)}/eq-files`,
          { fileType },
          `${fileType}-${lane.label}-${RUN_TAG}.zip`,
          bytes,
          'application/zip',
        );
        expect(up.status, `${lane.label} ${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
      }
      const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/eq-request`, {});
      expect(req.status, `${lane.label} 승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    }

    // ── EQ 고객확인은 **A 건에만** 만든다 — 이 비대칭이 U7 의 교차 결정 검증의 재료다.
    //    (B 는 자기 주문에 열린 요청이 없으므로, B 가 A 의 리뷰를 건드릴 길도 없어야 한다.)
    const create = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(laneA().poId)}`, {
      message: '[여정 9호-A] 사양 확인 부탁드립니다',
      // 계약 키는 dueOn 이다 — dueDate 로 보내면 조용히 버려져 회신 기한이 null 로
      // 남는다(2026-08-10 실측). 기한 배지·'회신 기한 지남' 분기가 전 여정에서 한 번도
      // 시험되지 않고 있었다.
      dueOn: '2026-08-14',
      sharedFileIds: [],
    });
    expect(create.status, `A 고객확인 요청: ${JSON.stringify(create.json)}`).toBe(200);
    const prisma = getPrisma();
    const rv = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(laneA().poId ?? 0) },
      orderBy: { id: 'desc' },
    });
    expect(rv, 'A EQ 리뷰 행').toBeTruthy();
    reviewIdA = num(rv?.id ?? 0n);
    ledger.push(`sp_pcb_eq_review #${String(reviewIdA)} (A — po ${String(laneA().poId)})`);

    // 교차 결정 시도는 **리뷰가 살아 있는 지금** 해야 의미가 있다(닫힌 뒤엔 소유 판정이
    // 아니라 상태 가드로도 막히므로, 격리를 시험하는 것이 아니게 된다).
    const crossDecide = await api(laneB().token, 'POST', `/api/pcb-eq-reviews/${String(reviewIdA)}/decide`, {
      decision: 'approve',
      note: '[여정 9호] B 가 A 의 리뷰를 대신 승인 시도',
    });
    if (crossDecide.status !== 404 && crossDecide.status !== 403) {
      F(
        'U4',
        'bug',
        `격리 위반 — B 토큰이 A 의 EQ 리뷰 #${String(reviewIdA)} 를 결정: ` +
          `HTTP ${String(crossDecide.status)} ${JSON.stringify(crossDecide.json)}`,
      );
    }
    expect([403, 404], `남의 EQ 리뷰 결정 차단: ${JSON.stringify(crossDecide.json)}`).toContain(
      crossDecide.status,
    );
    const afterCross = await prisma.spPcbEqReview.findFirst({ where: { id: BigInt(reviewIdA) } });
    expect(afterCross?.status, '차단 후 리뷰 상태 불변').toBe('requested');
    expect(afterCross?.decidedBy, '남의 결정 흔적 없음').toBeNull();

    // 주인(A)은 같은 리뷰를 결정할 수 있어야 한다 — 격리의 **양성 대조**.
    const ownDecide = await api(laneA().token, 'POST', `/api/pcb-eq-reviews/${String(reviewIdA)}/decide`, {
      decision: 'approve',
      note: '[여정 9호] A 본인 승인',
    });
    expect(ownDecide.status, `본인 EQ 승인: ${JSON.stringify(ownDecide.json)}`).toBe(200);
    const decided = await prisma.spPcbEqReview.findFirst({ where: { id: BigInt(reviewIdA) } });
    expect(decided?.status, 'A 본인 승인 반영').toBe('approved');
    expect(decided?.decidedBy, '결정자 = 주인').toBe(laneA().mbId);
    F('U4', 'obs', `EQ 리뷰 #${String(reviewIdA)} — B 결정 ${String(crossDecide.status)} 차단 · A 본인 승인 반영`);

    for (const lane of lanes) {
      const ap = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(lane.specId)}/pos/${String(lane.poId)}/eq-approve`,
        {},
      );
      expect(ap.status, `${lane.label} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
      const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/production-start`, {});
      expect(st.status, `${lane.label} 생산시작: ${JSON.stringify(st.json)}`).toBe(200);
      const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(lane.poId)}/production-complete`, {});
      expect(done.status, `${lane.label} 생산완료: ${JSON.stringify(done.json)}`).toBe(200);
    }
  }, 300_000);

  test('U5. 파트너: 고객이 달라도 **같은 박스에 합류**(박스 키에 고객 축 없음)', async (ctx) => {
    if (lanes.some((l) => l.poId === null)) return ctx.skip();
    const first = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: laneA().poId });
    expect(first.status, `A 담기: ${JSON.stringify(first.json)}`).toBe(200);
    const second = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: laneB().poId });
    expect(second.status, `B 담기: ${JSON.stringify(second.json)}`).toBe(200);

    // 받는측·회차·직송지가 같으면 합류한다 — 주인(mbId)은 컨텍스트 키에 없다.
    const myBoxes = (second.json?.data?.boxes ?? []).filter((b: any) =>
      (b.groupPos ?? []).some((g: any) => g.poId === laneA().poId || g.poId === laneB().poId),
    );
    expect(myBoxes.length, '두 고객의 발주가 한 박스로').toBe(1);
    const box = myBoxes[0];
    expect(box.groupPos.length, '박스 구성 2건').toBe(2);
    expect(box.mode, '국제 발송').toBe('international');
    // 키의 네 축은 받는측·받는조직·직송지·회차뿐이다(pcbShipContextKey) — 주인은 없다.
    expect(String(box.contextKey ?? ''), '컨텍스트 키에 고객 축 없음(받는측:조직:직송지:회차)').toBe(
      'admin:0:-:r0',
    );
    boxRepPoId = box.poId;
    ledger.push(`sp_pcb_shipment (대표 po ${String(boxRepPoId)} — 주인 다른 2건 묶음)`);

    // 같은 박스인데 주인이 갈렸다는 사실을 원장에서 한 번 더 못 박는다.
    const prisma = getPrisma();
    const owners = await prisma.spOrderSpec.findMany({
      where: { id: { in: lanes.map((l) => BigInt(l.specId ?? 0)) } },
      select: { mbId: true },
    });
    expect(new Set(owners.map((o: any) => o.mbId)).size, '한 박스 · 두 주인').toBe(2);
    F(
      'U5',
      'obs',
      `박스 합류 확인 — contextKey=${String(box.contextKey)} 구성 2건(주인 ${laneA().mbId}·${laneB().mbId}) 대표 po=${String(boxRepPoId)}`,
    );
    await rp.view(partnerView, '/app/partner/pcb/ship', 'U05-box-two-owners');
  }, 180_000);

  test('U6. Invoice 1회 → 국제 6단계 완주 → 관리자 입고확인 1회', async (ctx) => {
    if (boxRepPoId === null) return ctx.skip();
    const repLane = lanes.find((l) => l.poId === boxRepPoId);
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(boxRepPoId)}/shipment/files`,
      { fileType: 'invoice' },
      `invoice-multi-${RUN_TAG}.pdf`,
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(boxRepPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);

    // 동반 건도 같은 선적이라 함께 움직인다(주인이 달라도 물류는 하나다).
    const mate = lanes.find((l) => l.poId !== boxRepPoId);
    const detail = await api(P, 'GET', `/api/partner/pcb-pos/${String(mate?.poId ?? 0)}`);
    expect(detail.json?.data?.shipment?.status, '동반 건도 선적요청').toBe('requested');
    expect(detail.json?.data?.shipment?.poIds?.length, '동반 건이 보는 묶음 크기').toBe(2);

    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(repLane?.specId)}/pos/${String(boxRepPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: `MULTI-AWB-${RUN_TAG}`, trackingUrl: null },
      );
      if (adv.status !== 200) {
        if (adv.json?.error === 'ALREADY_FINAL') break;
        F('U6', 'obs', `체인 중단: ${JSON.stringify(adv.json)}`);
        break;
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(repLane?.specId)}/pos/${String(boxRepPoId)}/shipment/receive`,
      { note: '[여정 9호] 다중 고객 묶음 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(boxRepPoId) } } },
    });
    expect(shipment?.receivedAt, '입고 시각').not.toBeNull();
    F('U6', 'obs', `묶음 입고확인 1회 — 선적 #${String(shipment?.id ?? 0)} (주인 2인 공유)`);
  }, 240_000);

  test('U7. 정보 격리 — 화면(주문내역·상세·진행 카드)에 남의 것이 없다', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    for (const [self, other] of [
      [laneA(), laneB()],
      [laneB(), laneA()],
    ] as const) {
      // ① 주문내역 목록 — 남의 주문번호가 한 글자도 없어야 한다.
      await rp.view(self.session, '/shop/orderinquiry.php', `U07-${self.label}-orders`);
      const list = await bodyTextOf(self.session);
      expect(list, `${self.label} 주문내역에 자기 주문`).toContain(self.odId ?? '');
      if (list.includes(other.odId ?? '')) {
        F('U7', 'bug', `격리 위반 — ${self.label} 주문내역에 ${other.label} 주문번호(${String(other.odId)}) 노출`);
      }
      expect(list.includes(other.odId ?? ''), `${self.label} 주문내역에 남의 주문번호 부재`).toBe(false);
      if (list.includes(other.projectName)) {
        F('U7', 'bug', `격리 위반 — ${self.label} 주문내역에 ${other.label} 프로젝트명(${other.projectName}) 노출`);
      }
      expect(list.includes(other.projectName), `${self.label} 주문내역에 남의 프로젝트명 부재`).toBe(
        false,
      );

      // ② 주문 상세 + 제작 진행 카드(P4.13) — 자기 것만 떠야 한다.
      await rp.view(
        self.session,
        `/shop/orderinquiryview.php?od_id=${String(self.odId)}`,
        `U07-${self.label}-order-detail`,
      );
      const detail = await bodyTextOf(self.session);
      expect(detail, `${self.label} 상세에 진행 카드`).toContain('제작 진행 상황');
      expect(detail, `${self.label} 진행 카드에 자기 프로젝트`).toContain(self.projectName);
      if (detail.includes(other.projectName)) {
        F(
          'U7',
          'bug',
          `격리 위반 — ${self.label} 진행 카드에 ${other.label} 프로젝트명(${other.projectName}) 노출`,
        );
      }
      expect(detail.includes(other.projectName), `${self.label} 상세에 남의 프로젝트명 부재`).toBe(
        false,
      );
      expect(detail.includes(other.odId ?? ''), `${self.label} 상세에 남의 주문번호 부재`).toBe(false);

      // ③ 남의 주문 상세 URL 직접 접근 — 코어 소유 가드. 어떤 화면이 나오든 **남의
      //    프로젝트명·진행 카드가 새지 않는 것**이 여기서 판정할 몫이다.
      await rp.view(
        self.session,
        `/shop/orderinquiryview.php?od_id=${String(other.odId)}`,
        `U07-${self.label}-cross-detail`,
      );
      const cross = await bodyTextOf(self.session);
      if (cross.includes(other.projectName)) {
        F(
          'U7',
          'bug',
          `격리 위반 — ${self.label} 이 ${other.label} 주문 상세(${String(other.odId)})에서 프로젝트명을 봄`,
        );
      }
      expect(cross.includes(other.projectName), `${self.label} 의 남의 주문 상세 접근 차단`).toBe(false);
    }
    F('U7', 'obs', '화면 격리 — 목록·상세·진행 카드·남의 상세 직접 접근 4축 모두 자기 것만 노출');
  }, 240_000);

  test('U8. 정보 격리 — API 교차 접근(pcb-progress·pcb-eq-reviews)은 빈 배열', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    for (const [self, other] of [
      [laneA(), laneB()],
      [laneB(), laneA()],
    ] as const) {
      // 양성 대조 먼저 — 자기 주문으로 같은 호출이 **차 있어야** 빈 배열이 격리의 증거가
      // 된다(라우트가 통째로 죽어 있어도 교차 호출은 빈 배열을 내므로).
      const own = await api(self.token, 'GET', `/api/pcb-progress?odId=${String(self.odId)}`);
      expect(own.status, `${self.label} 자기 진행: ${JSON.stringify(own.json)}`).toBe(200);
      expect((own.json?.data?.items ?? []).length, `${self.label} 자기 진행 카드 존재(양성 대조)`).toBe(1);
      expect(own.json?.data?.items?.[0]?.projectName, `${self.label} 자기 프로젝트`).toBe(
        self.projectName,
      );

      const cross = await api(self.token, 'GET', `/api/pcb-progress?odId=${String(other.odId)}`);
      expect(cross.status, `${self.label}→${other.label} 진행 조회`).toBe(200);
      const crossItems = cross.json?.data?.items ?? [];
      if (crossItems.length > 0) {
        F(
          'U8',
          'bug',
          `격리 위반 — ${self.label} 토큰이 ${other.label} 주문의 진행 카드를 봄: ${JSON.stringify(crossItems)}`,
        );
      }
      expect(crossItems.length, `${self.label}→${other.label} 진행 카드 차단`).toBe(0);

      const crossRv = await api(self.token, 'GET', `/api/pcb-eq-reviews?odId=${String(other.odId)}`);
      expect(crossRv.status, `${self.label}→${other.label} EQ 리뷰 조회`).toBe(200);
      const crossReviews = crossRv.json?.data?.reviews ?? [];
      if (crossReviews.length > 0) {
        F(
          'U8',
          'bug',
          `격리 위반 — ${self.label} 토큰이 ${other.label} 주문의 EQ 리뷰를 봄: ${JSON.stringify(crossReviews)}`,
        );
      }
      expect(crossReviews.length, `${self.label}→${other.label} EQ 리뷰 차단`).toBe(0);
    }
    // A 의 EQ 리뷰는 A 자신에게는 보여야 한다 — 리뷰 축의 양성 대조.
    const ownRv = await api(laneA().token, 'GET', `/api/pcb-eq-reviews?odId=${String(laneA().odId)}`);
    expect(ownRv.status, `A 자기 EQ 리뷰: ${JSON.stringify(ownRv.json)}`).toBe(200);
    expect((ownRv.json?.data?.reviews ?? []).length, 'A 자기 EQ 리뷰 존재(양성 대조)').toBeGreaterThan(
      0,
    );
    F('U8', 'obs', 'API 격리 — pcb-progress·pcb-eq-reviews 교차 0건 / 자기 것 양성 대조 통과');
  }, 180_000);

  test('U9. 배송 큐: **회원이 다른** 두 주문 모두 to_ship → 개별 운송장 배송 → 완료', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    const queue = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=100');
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const items = queue.json?.data?.items ?? [];

    // 3호와 갈리는 지점 — 거기선 두 주문의 회원이 같았다. 묶음 cross-spec 조인이 회원
    // 경계까지 넘어 동작하는지는 여기가 처음이다.
    for (const lane of lanes) {
      const row = items.find((i: any) => i.odId === lane.odId);
      if (row === undefined) {
        F('U9', 'bug', `${lane.label}(${lane.mbId}) 주문이 배송 대기 큐에 없음 — cross-member 판정 결함`);
      }
      expect(row, `${lane.label} 주문(od=${String(lane.odId)}) 큐 진입`).toBeTruthy();
      expect(row.mbId, `${lane.label} 큐 행 회원`).toBe(lane.mbId);
      expect(row.receivedPoCount, `${lane.label} 입고 수`).toBe(1);
    }
    const queuedMbIds = lanes.map((l) => items.find((i: any) => i.odId === l.odId)?.mbId);
    expect(new Set(queuedMbIds).size, '큐에 오른 두 주문의 회원이 서로 다름').toBe(2);
    await rp.view(adminView, '/app/admin/pcb/shipments', 'U09-admin-to-ship-cross-member');

    const prisma = getPrisma();
    for (const lane of lanes) {
      const ship = await api(A, 'PATCH', `/api/admin/orders/${String(lane.odId)}/force-status`, {
        target: '배송',
        delivery: {
          deliveryCompany: 'CJ대한통운',
          invoiceNo: lane.invoiceNo,
          invoiceTime: '2026-08-10 18:00:00',
        },
      });
      if (ship.status !== 200) F('U9', 'obs', `${lane.label} 배송 전이: ${JSON.stringify(ship.json)}`);
      const fin = await api(A, 'PATCH', `/api/admin/orders/${String(lane.odId)}/force-status`, {
        target: '완료',
      });
      if (fin.status !== 200) F('U9', 'obs', `${lane.label} 완료 전이: ${JSON.stringify(fin.json)}`);

      const row: any[] = await prisma.$queryRawUnsafe(
        `SELECT od_status, od_misu, od_invoice FROM g5_shop_order WHERE od_id = ?`,
        lane.odId,
      );
      expect(row[0]?.od_status, `${lane.label} 최종 상태`).toBe('완료');
      expect(Number(row[0]?.od_misu ?? -1), `${lane.label} 미수금`).toBe(0);
      expect(String(row[0]?.od_invoice ?? ''), `${lane.label} 운송장(주문별로 다름)`).toBe(
        lane.invoiceNo,
      );
    }
    F(
      'U9',
      'obs',
      `cross-member 배송 큐 통과 — 한 입고로 회원 다른 두 주문이 큐에 오르고 각자 운송장으로 종결`,
    );
  }, 300_000);

  test('U10. 각 고객 주문내역에서 **자기 운송장만** 확인(격리 마무리 + 화면 실측)', async (ctx) => {
    if (lanes.some((l) => l.odId === null)) return ctx.skip();
    for (const [self, other] of [
      [laneA(), laneB()],
      [laneB(), laneA()],
    ] as const) {
      await rp.view(
        self.session,
        `/shop/orderinquiryview.php?od_id=${String(self.odId)}`,
        `U10-${self.label}-delivered`,
      );
      const text = await bodyTextOf(self.session);
      expect(text, `${self.label} 자기 운송장`).toContain(self.invoiceNo);
      if (text.includes(other.invoiceNo)) {
        F('U10', 'bug', `격리 위반 — ${self.label} 주문 상세에 ${other.label} 운송장(${other.invoiceNo}) 노출`);
      }
      expect(text.includes(other.invoiceNo), `${self.label} 상세에 남의 운송장 부재`).toBe(false);
      // 완료 전이 뒤에는 코어 배송정보가 정본 — 협력 축 진행 카드는 사라져야 한다(#4).
      expect(text.includes('제작 진행 상황'), `${self.label} 완료 이후 진행 카드 숨김`).toBe(false);

      await rp.view(self.session, '/shop/orderinquiry.php', `U10-${self.label}-orders-final`);
      const list = await bodyTextOf(self.session);
      expect(list.includes(other.odId ?? ''), `${self.label} 최종 목록에 남의 주문 부재`).toBe(false);
    }
    F('U10', 'obs', '완주 — 두 고객이 한 박스를 공유하고도 화면·API 어디서도 서로를 보지 못함');
  }, 240_000);
});
