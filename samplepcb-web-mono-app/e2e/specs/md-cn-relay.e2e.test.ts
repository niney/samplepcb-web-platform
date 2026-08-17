// MD 시나리오 5 — **CN 마스터딜러**(mdtester2상사·상설 픽스처 신설). 2편(국내 MD)·4편
// (전 구간 국내)이 못 밟은 마지막 국가 조합 — MD 가 해외(CN)라 물류 모드가 다시 뒤집힌다:
//
//   협력2(CN) → mdtester2상사(CN) : **비KR domestic 최초** — 국내 3단계는 KR 전유물이 아니라
//                                   "발송자국가=수신국가" 파생임을 실증(CN→CN, Invoice 불요)
//   mdtester2상사(CN) → 관리자(KR): 국제 6단계 — Invoice·AWB, 관리자 입고확인은 검수 기록
//
// 상설 픽스처(idempotent — 있으면 재사용, cleanup-md 사용 금지):
//   조직 mdtester2상사(CN/USD/pcb_rfq — 관리자 API 생성) + 계정 mdtester2 연결(관리자
//   members API — g5 회원 검증에 걸리면 g5_member 에 mdtester 행 미러 INSERT 후 재시도;
//   스텁 로그인은 /spcb/api/me 라 g5 무관) + 관계 mdtester2상사→협력2(USD — 협력2의
//   다중 상위는 허용 규칙이라 마스터딜러상사 소속과 공존한다).
//
// 실행: pnpm -F e2e md:cn  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
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
const MD2_MB_ID = 'mdtester2';
const MD2_ORG_NAME = 'mdtester2상사';
const CHILD_NAME = '협력2'; // CN·USD — 링크 통화 USD
const MARGIN_RATE = 15;
const CHILD_PRICE = 250; // 협력2 회신(USD)

describe.skipIf(!RUN || !JOURNEY)('MD 시나리오 5 — CN MD 완주(mdtester2상사·상설 픽스처)', () => {
  const rp = createJourneyReport('findings-md5', 'MD 시나리오 5 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let md2View: E2eSession;
  let child: PartnerFixture;
  let md2PartnerId: bigint | null = null;
  let A = '';
  let M2 = '';
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

  /** g5_member 미러 INSERT(idempotent) — mdtester 행을 복제해 mb_id 만 바꾼다(mb_level 2).
   *  members API 의 "정상 가입 회원" 검증(getMembersByIds)을 통과시키기 위한 로컬 dev 시드.
   *  컬럼은 information_schema 로 전수 미러(PK mb_no 만 제외) — strict mode NOT NULL 안전. */
  const ensureG5Member = async (): Promise<void> => {
    const prisma = getPrisma();
    const exists: any[] = await prisma.$queryRawUnsafe(
      `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
      MD2_MB_ID,
    );
    if (exists.length > 0) return;
    const cols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME AS name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'g5_member' ORDER BY ORDINAL_POSITION`,
    );
    const names = cols.map((c: any) => String(c.name)).filter((n: string) => n !== 'mb_no');
    const exprs = names.map((n: string) =>
      n === 'mb_id' ? `'${MD2_MB_ID}'` : n === 'mb_level' ? '2' : `\`${n}\``,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_member (${names.map((n: string) => `\`${n}\``).join(',')})
        SELECT ${exprs.join(',')} FROM g5_member WHERE mb_id = 'mdtester'`,
    );
    console.log(`  [setup] g5_member 미러 INSERT: ${MD2_MB_ID} (mdtester 복제·mb_level 2)`);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    const prisma = getPrisma();

    // 하위 무대 자기창조 — DB 복구로 협력2가 사라져도 e2e 전용 계정으로 다시 세운다.
    child = await ensureStagePartner({
      mbId: 'e2e-mdsub2',
      orgName: CHILD_NAME,
      country: 'CN',
      currency: 'USD',
    });
    if (child.mbId === null) throw new Error(`${CHILD_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M2 = signJwt({ mbId: MD2_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

    // ── 상설 픽스처 신설(idempotent) — 조직·연결·관계 셋 다 관리자 API 경유 ──────
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
      // 관리자 API 는 g5 회원 존재를 검증한다 — 없으면 미러 INSERT 후 1회 재시도.
      let add = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/members`, {
        mbId: MD2_MB_ID,
        role: 'owner',
      });
      if (add.status === 404 && add.json?.error === 'MEMBER_NOT_FOUND') {
        await ensureG5Member();
        add = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/members`, {
          mbId: MD2_MB_ID,
          role: 'owner',
        });
      }
      if (add.status !== 200) {
        throw new Error(`계정 연결 실패(${String(add.status)}): ${JSON.stringify(add.json)}`);
      }
      console.log(`  [setup] ${MD2_MB_ID} → ${MD2_ORG_NAME} 연결`);
    }

    const relation = await prisma.spPartnerRelation.findFirst({
      where: { parentPartnerId: org.id, childPartnerId: child.id },
    });
    if (relation === null) {
      // 협력2는 이미 마스터딜러상사의 하위 — **다중 상위 허용** 규칙의 실증을 겸한다.
      const rel = await api(A, 'POST', `/api/admin/partners/${String(num(org.id))}/relations`, {
        childPartnerId: num(child.id),
        settlementCurrency: 'USD',
      });
      if (rel.status !== 200) {
        throw new Error(`MD 관계 생성 실패(${String(rel.status)}): ${JSON.stringify(rel.json)}`);
      }
      console.log(`  [setup] 관계 신설: ${MD2_ORG_NAME} → ${CHILD_NAME} (USD·다중 상위)`);
    }

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    md2View = await newSession({ mbId: MD2_MB_ID }, { partnerModule: 'pcb' });
    rp.watchHttp(md2View, 'MD2');
  }, 180_000);

  afterAll(async () => {
    // 픽스처(조직·연결·관계)는 상설 — 정리하지 않는다. 문서 생성물만 대장으로.
    rp.write({ 고객: customer, 관리자: adminView, MD2: md2View });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('N1. 견적 루프: 거버 → MD 배정(USD) → 하위 회신(USD) → 마진 → 선정+확정가(환율)', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[MD 5편] CN MD 완주 — 확인 후 정리 예정',
      prefix: 'N01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(md2PartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const topRow = (send.json?.data?.rfqs ?? []).find(
      (v: any) => v.partnerId === num(md2PartnerId ?? 0n),
    );
    topRfqId = topRow?.rfqId ?? null;
    expect(topRfqId, 'MD RFQ').not.toBeNull();
    expect(topRow?.currency, '관리자↔MD 통화(조직 기본 USD)').toBe('USD');
    ledger.push(`sp_pcb_rfq #${String(topRfqId)} (관리자→MD2)`);

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
    expect(childRfq.currency, 'MD2↔협력2 링크 통화 USD').toBe('USD');
    ledger.push(`sp_pcb_rfq #${String(childRfqId)} (MD2→하위)`);

    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: CHILD_PRICE,
      quotedDeliveryDate: '2026-08-22',
      memo: '[MD 5편] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const pick = await api(M2, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);
    // USD→USD 는 환율 1 — 상위 회신가 = 250 × 1 × 1.15 = 287.50 (USD 2자리 HALF_UP).
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId ?? 0) } });
    expect(Number(top?.sourceRate ?? 0), 'USD→USD 환율 1').toBe(1);
    expect(Number(top?.priceOriginal ?? 0), 'MD 회신가 자동 산출(USD)').toBe(
      Math.round(CHILD_PRICE * (1 + MARGIN_RATE / 100) * 100) / 100,
    );

    // USD 선정은 KRW 환산 필요 — 당일 환율 캐시 자동, 미준비 로컬이면 명시 환율 폴백(P4.7).
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: 620_000 },
    );
    if (sel.status === 400) {
      F('N1', 'obs', `당일 환율 캐시 없음 — 명시 환율 폴백: ${JSON.stringify(sel.json)}`);
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 620_000 },
      );
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 300_000);

  test('N2. 고객 주문 → 입금 → MD 발주(USD·selected 견적행 근거)', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'N2',
      prefix: 'N02',
      buyerName: 'e2eMD5고객',
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
      partnerId: num(md2PartnerId ?? 0n),
      rfqId: topRfqId,
    });
    expect(issue.status, `MD 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    topPoId =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(md2PartnerId ?? 0n))
        ?.poId ?? null;
    expect(topPoId, 'MD 발주서').not.toBeNull();
    // 외화(USD) 발주 — 선정 박제 환율이 KRW 회계로 승계되는지(EXCHANGE_RATE_REQUIRED 미발생).
    const prisma = getPrisma();
    const po = await prisma.spPcbPo.findUnique({ where: { id: BigInt(topPoId ?? 0) } });
    expect(po?.currency, '발주 통화 USD').toBe('USD');
    expect(Number(po?.krwAmount ?? 0), 'KRW 회계 박제').toBeGreaterThan(0);
    ledger.push(`sp_pcb_po #${String(topPoId)} (관리자→MD2)`);
  }, 480_000);

  test('N3. EQ 위임 → 하위 발주 → 하위 EQ 완주(생산완료)', async (ctx) => {
    if (topPoId === null || childRfqId === null) return ctx.skip();
    const before = await api(M2, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(before.json?.data?.eq?.blocked, 'delegated 하위 발주 전 EQ 시작 불가').toBe(true);

    // 회귀 — 원발주(round 0)의 하위 발주는 childRfqId 필수 규율 유지. 회차 조건 복사
    // 경로(여정 7호 교정)가 계약을 optional 로 완화했지만 round 0 은 서버가 끊는다
    // (partnerId 를 줘도 마찬가지 — 복사 경로는 회차 전용).
    const noRfq = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {});
    expect(noRfq.status, `round 0 childRfqId 생략: ${JSON.stringify(noRfq.json)}`).toBe(400);
    expect(noRfq.json?.error, 'round 0 규율 — 하위 회신 필수').toBe('CHILD_RFQ_REQUIRED');
    const noRfqWithPartner = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      partnerId: num(child.id),
    });
    expect(noRfqWithPartner.status, JSON.stringify(noRfqWithPartner.json)).toBe(400);
    expect(noRfqWithPartner.json?.error, 'partnerId 로도 우회 불가').toBe('CHILD_RFQ_REQUIRED');

    const create = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId,
    });
    expect(create.status, `하위 발주: ${JSON.stringify(create.json)}`).toBe(200);
    const prisma = getPrisma();
    const childPo = await prisma.spPcbPo.findFirst({
      where: {
        specId: BigInt(specId ?? 0),
        partnerId: child.id,
        parentPartnerId: md2PartnerId ?? 0n,
      },
      orderBy: { id: 'desc' },
    });
    childPoId = num(childPo.id);
    ledger.push(`sp_pcb_po #${String(childPoId)} (MD2→하위)`);

    const after = await api(M2, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(after.json?.data?.eq?.delegatePoId, 'EQ 위임 대상').toBe(childPoId);

    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        C,
        `/api/partner/pcb-pos/${String(childPoId)}/eq-files`,
        { fileType },
        `${fileType}-md5.zip`,
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

  test('N4. 협력2(CN) → MD2(CN) 국내 발송 — 비KR domestic 최초, MD 입고확인이 종점', async (ctx) => {
    if (childPoId === null || topPoId === null) return ctx.skip();
    // 게이팅 — 하위 입고 전 MD 상위 출고 불가.
    const blocked = await api(M2, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(blocked.status, `하위 입고 전 상위 담기: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error).toBe('OUTBOUND_BLOCKED');

    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, `하위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(childPoId) } } },
      orderBy: { id: 'desc' },
    });
    // 이 편의 차별점 ① — **CN→CN 국내**: domestic 은 KR 전유물이 아니라 국가 동일 파생.
    expect(shipment?.receiverKind, '받는측 md').toBe('md');
    expect(shipment?.mode, '협력2(CN)→MD2(CN) 국내').toBe('domestic');
    ledger.push(`sp_pcb_shipment (하위→MD2, po ${String(childPoId)})`);

    // 국내 전이 — Invoice 불요, 택배사+송장만(비KR 이어도 동일).
    const adv = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      carrier: 'SF Express',
      trackingNumber: 'MD5-CN-CHILD-0810',
    });
    expect(adv.status, `국내 발송(Invoice 불요): ${JSON.stringify(adv.json)}`).toBe(200);

    const recv = await api(M2, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[MD 5편] MD2 입고',
    });
    expect(recv.status, `MD2 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findFirst({ where: { id: shipment?.id ?? 0n } });
    expect(closed?.status, 'MD 입고확인이 국내 종점을 닫음').toBe('delivered');
    F('N4', 'obs', '협력2(CN)→MD2(CN) 국내 3단계 완주 — 비KR domestic 실증(모드=국가 동일 파생)');
  }, 240_000);

  test('N5. MD2(CN) → 관리자(KR) 국제 발송 — Invoice·AWB 6단계, 관리자 입고확인', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    const box = await api(M2, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `입고 후 상위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const topShip = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    // 차별점 ② — MD 가 CN 이라 관리자행이 **국제**다(2·4편은 국내였다).
    expect(topShip?.receiverKind, '받는측 관리자').toBe('admin');
    expect(topShip?.mode, 'MD2(CN)→관리자(KR) 국제').toBe('international');
    ledger.push(`sp_pcb_shipment (MD2→관리자, po ${String(topPoId)})`);
    await rp.view(md2View, '/app/partner/pcb/ship', 'N05-md2-ship-board');

    // 국제 requested 는 Invoice 첨부 필수.
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(
      M2,
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-md5.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice: ${JSON.stringify(up.json)}`).toBe(200);
    const reqd = await api(M2, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);

    // 받는측이 관리자인 국제 체인 — 선적요청 이후는 관리자 차례다. 보내는측(MD2)이 밀면 409.
    const notYourTurn = await api(
      M2,
      'POST',
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`,
      { trackingNumber: 'MD5-AWB-0810' },
    );
    expect(notYourTurn.status, `선적요청 후 보내는측 전이: ${JSON.stringify(notYourTurn.json)}`).toBe(409);
    expect(notYourTurn.json?.error, '관리자 차례').toBe('NOT_YOUR_TURN');

    // 관리자 대행으로 나머지 체인 소진(선적=AWB 필수 → 국내도착 → 통관 → 완료).
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'MD5-AWB-0810' },
      );
      if (adv.status !== 200) {
        expect(adv.json?.error, `체인 중단: ${JSON.stringify(adv.json)}`).toBe('ALREADY_FINAL');
        break;
      }
    }
    const final = await prisma.spPcbShipment.findFirst({ where: { id: topShip?.id ?? 0n } });
    expect(final?.status, '국제 체인 최종 done').toBe('done');

    // 관리자 입고확인 — 국제는 체인이 이미 닫혔고 검수 시각만 박제된다(조기 확인 허용 설계).
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/receive`,
      { note: '[MD 5편] 관리자 입고' },
    );
    expect(recv.status, `관리자 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const received = await prisma.spPcbShipment.findFirst({ where: { id: topShip?.id ?? 0n } });
    expect(received?.receivedAt, 'receivedAt 박제').not.toBeNull();
    F('N5', 'obs', 'MD2(CN)→관리자(KR) 국제 6단계 — Invoice·AWB·NOT_YOUR_TURN·입고확인 완주');
  }, 240_000);

  test('N6. 고객 배송 → 완료 — 완주 검증', async (ctx) => {
    if (odId === null) return ctx.skip();
    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: 'MD5-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) F('N6', 'obs', `배송 전이: ${JSON.stringify(ship.json)}`);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    if (fin.status !== 200) F('N6', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    const prisma = getPrisma();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(rows[0]?.od_status, '최종 상태').toBe('완료');
    expect(Number(rows[0]?.od_misu ?? -1), '미수금').toBe(0);
    F(
      'N6',
      'obs',
      `MD 5편 완주 — od=${odId} 상위po=${String(topPoId)} 하위po=${String(childPoId)} (CN 국내·CN→KR 국제)`,
    );
  }, 120_000);
});
