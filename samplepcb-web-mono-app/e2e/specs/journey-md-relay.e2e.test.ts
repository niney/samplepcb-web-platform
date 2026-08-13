// 4호 완주 여정 — **MD(마스터딜러) 경유 2단**. 관리자가 중개상에게 맡기고, 중개상이 다시
// 제조사에게 맡기는 구조가 끝까지 도는지 본다.
//
// 1~3호가 모두 관리자 직수주라 MD 축은 시드 발주로만 부분 검증돼 있었다. 여기서만 되는 것:
//   ① **2단 견적**: MD 가 하위에 배정 → 하위 회신 → MD 가 마진%를 얹으면 상위 회신가가
//      서버에서 자동 산출된다(하위가 × 환율 × (1+마진%)).
//   ② **EQ 위임**: 관계를 가진 조직이 수주한 상위 발주는 자체 EQ 를 못 한다 — 하위 발주로
//      트랙이 넘어간다(eqDelegatePoId).
//   ③ **출고 게이팅**: 하위 입고확인 전에는 MD 가 상위로 출고할 수 없다(OUTBOUND_BLOCKED).
//      그 차단이 풀리는 순간이 하위 입고확인이라는 것까지 확인한다.
//   ④ **2단 물류**: 하위 → MD 로 한 번, MD → 관리자로 다시 한 번. 받는측이 md 인 발송은
//      1~3호가 밟지 못한 조합이다(전부 관리자행이었다).
//
// MD 관계(sp_partner_relation)는 이 주행이 만들고 끝나면 지운다 — dev DB 에는 관계가 없다.
// MD 는 **진행 중 수주 발주가 없는 조직**만 될 수 있다(전환 시 EQ 주체가 위임으로 바뀌므로
// 서버가 PARENT_HAS_ACTIVE_POS 로 막는다). 그래서 발주가 비어 있는 협력2를 MD 로 세운다.
//
// 실행: pnpm -F e2e journey:md  (PORTAL_E2E=1 + JOURNEY=1)
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
// MD 는 **자신이 남의 하위가 아닌** 해외 조직이어야 한다(2단 제한). 협력2 를 쓰던 것을
// mdtester2상사로 옮긴다 — MD 1·5편이 협력2 를 두 MD 의 하위로 만들어 두면서(상설 픽스처)
// 협력2 는 더 이상 상위가 될 수 없어졌다(2026-08-10 실측: 관계 생성이 PARENT_IS_CHILD 400).
// mdtester2상사는 이미 하위(협력2)를 거느린 CN 조직이라 이 여정의 KR 하위를 하나 더 붙여도
// 2단 제한에 걸리지 않는다. 조합(하위 KR → MD CN → 관리자 KR, 양쪽 국제)은 그대로다.
const MD_NAME = 'mdtester2상사';
const CHILD_NAME = '협력1';
const MARGIN_RATE = 20; // MD 마진 %

describe.skipIf(!RUN || !JOURNEY)('여정 4호 — MD 경유 2단(중개상이 제조사에 재위탁)', () => {
  const rp = createJourneyReport('findings-md', '여정 4호 MD 경유 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let mdView: E2eSession;
  let md: PartnerFixture;
  let child: PartnerFixture;
  let A = '';
  let M = ''; // MD 토큰
  let C = ''; // 하위 토큰

  let specId: number | null = null;
  let topRfqId: number | null = null; // 관리자 → MD
  let childRfqId: number | null = null; // MD → 하위
  let odId: string | null = null;
  let topPoId: number | null = null; // 관리자 → MD 발주
  let childPoId: number | null = null; // MD → 하위 발주
  let relationCreated = false;

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

    // 무대 자기창조(idempotent) — DB 복구로 픽스처가 사라져도 e2e 전용으로 다시 세운다.
    md = await ensureStagePartner({
      mbId: 'mdtester2',
      orgName: MD_NAME,
      country: 'CN',
      currency: 'USD',
    });
    child = await ensureStagePartner({
      mbId: 'e2e-mdsub1',
      orgName: CHILD_NAME,
      country: 'KR',
      currency: 'KRW',
    });
    if (md.mbId === null || child.mbId === null) throw new Error('MD·하위 연결 계정 없음');
    // MD 가 해외라 두 구간 모두 국제가 된다(하위 KR → MD CN → 관리자 KR).
    // 국내 체인은 2호가 지키므로, 여기서는 받는측이 md 인 발송 자체가 새 조합이다.
    expect(md.country, `${MD_NAME} 국가`).not.toBe('KR');
    expect(child.country, `${CHILD_NAME} 국가`).toBe('KR');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: child.mbId, ttlSec: 3600 });

    // MD 전환 가드 박제 — 진행 중 수주 발주가 있는 조직은 MD 가 될 수 없다(전환 시 EQ
    // 주체가 위임으로 뒤집히므로). 이 여정의 첫 주행이 실제로 여기 걸렸다. dev DB 에
    // 협력1의 진행 발주가 있을 때만 확인하고, 없으면 기록만 남긴다(전제 의존 어서션).
    // 역방향(하위를 상위로 뒤집기)은 반드시 막혀야 한다. **어느 가드가 막는지는 픽스처
    // 상태에 달렸으므로**(상설 관계가 늘면 순서가 바뀐다 — 2026-08-10 드리프트로 이 어서션이
    // 깨졌었다) 서버의 판정 순서를 그대로 계산해 기대값을 세운다. 순서 자체가 계약이다:
    //   CHILD_IS_MD(400) → PARENT_IS_CHILD(400) → 첫 하위일 때만 PARENT_HAS_ACTIVE_POS(409)
    const prisma = getPrisma();
    const [mdHasChildren, childHasParent, childActivePos] = await Promise.all([
      prisma.spPartnerRelation.count({ where: { parentPartnerId: md.id } }),
      prisma.spPartnerRelation.count({ where: { childPartnerId: child.id } }),
      prisma.spPcbPo.count({
        where: { partnerId: child.id, parentPartnerId: 0n, status: { not: 'produced' } },
      }),
    ]);
    const expected =
      mdHasChildren > 0
        ? { status: 400, error: 'CHILD_IS_MD' }
        : childHasParent > 0
          ? { status: 400, error: 'PARENT_IS_CHILD' }
          : childActivePos > 0
            ? { status: 409, error: 'PARENT_HAS_ACTIVE_POS' }
            : null;
    if (expected !== null) {
      const blocked = await api(A, 'POST', `/api/admin/partners/${String(num(child.id))}/relations`, {
        childPartnerId: num(md.id),
        settlementCurrency: 'USD',
      });
      expect(blocked.status, `MD 역전 전환 차단: ${JSON.stringify(blocked.json)}`).toBe(expected.status);
      expect(blocked.json?.error, 'MD 전환 가드').toBe(expected.error);
      F('R0', 'obs', `MD 전환 가드 확인 — ${expected.error}(${String(expected.status)})`);
    } else {
      F('R0', 'obs', '차단 전제가 없어(관계·진행 발주 모두 0) MD 전환 가드 확인 생략');
    }

    // MD 관계 시드 — 이게 있어야 조직이 MD 로 동작한다(플래그가 아니라 관계의 존재).
    const rel = await api(A, 'POST', `/api/admin/partners/${String(num(md.id))}/relations`, {
      childPartnerId: num(child.id),
      settlementCurrency: 'USD',
    });
    if (rel.status !== 200) {
      throw new Error(`MD 관계 생성 실패(${String(rel.status)}): ${JSON.stringify(rel.json)}`);
    }
    relationCreated = true;
    ledger.push(`sp_partner_relation ${MD_NAME}→${CHILD_NAME} (주행 종료 시 해제)`);

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    mdView = await newSession({ mbId: md.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(mdView, 'MD');
  }, 180_000);

  afterAll(async () => {
    // 관계는 이 주행이 만든 것이라 반드시 되돌린다(진행 중 문서가 남아 있으면 409 —
    // 그때는 리포트에 남겨 수동 정리로 넘긴다).
    if (relationCreated) {
      const del = await api(
        A,
        'DELETE',
        `/api/admin/partners/${String(num(md.id))}/relations/${String(num(child.id))}`,
      );
      if (del.status !== 200) {
        F('정리', 'obs', `MD 관계 해제 실패(${String(del.status)}) — 생성물 정리 후 수동 해제 필요`);
      }
    }
    rp.write({ 고객: customer, 관리자: adminView, MD: mdView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('R1. 고객: 거버 업로드 → 견적요청', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 4호] MD 경유 완주 — 확인 후 정리 예정',
      prefix: 'R01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);
  }, 180_000);

  test('R2. 관리자: MD 에게 견적요청', async (ctx) => {
    if (specId === null) return ctx.skip();
    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(md.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(md.id));
    expect(row, 'MD RFQ 행').toBeTruthy();
    topRfqId = row.rfqId;
    // 관리자↔MD 는 조직 기본 통화, MD↔하위는 관계에 박제된 링크 통화 — 둘은 별개다.
    const mdOrg = await getPrisma().spPartner.findUnique({ where: { id: md.id } });
    expect(row.currency, 'MD 결제통화(조직 기본)').toBe(mdOrg?.defaultCurrency);
    ledger.push(`sp_pcb_rfq #${String(topRfqId)} (관리자→MD)`);
  });

  test('R3. MD: 하위에 배정 → 하위 회신 → 마진 얹어 상위 회신가 자동 산출', async (ctx) => {
    if (topRfqId === null) return ctx.skip();
    // ① MD 가 자기 하위에게 넘긴다(소속 조직만 허용 — 관계가 없으면 400).
    const assign = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(child.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 배정: ${JSON.stringify(assign.json)}`).toBe(200);

    const prisma = getPrisma();
    const childRfq = await prisma.spPcbRfq.findFirst({
      where: { specId: BigInt(specId ?? 0), partnerId: child.id, parentPartnerId: md.id },
      orderBy: { id: 'desc' },
    });
    expect(childRfq, '하위 RFQ 생성').not.toBeNull();
    childRfqId = num(childRfq.id);
    // 링크 통화 — MD↔하위는 관계에 박제된 USD(조직 기본 통화가 아니다).
    expect(childRfq.currency, 'MD↔하위 링크 통화').toBe('USD');
    ledger.push(`sp_pcb_rfq #${String(childRfqId)} (MD→하위)`);

    // ② 하위가 회신한다.
    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: 250,
      quotedDeliveryDate: '2026-08-20',
      memo: '[여정 4호] 하위 회신',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    // ③ MD 가 하위를 고르고 마진을 얹으면 상위 회신가는 서버가 계산한다.
    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: MARGIN_RATE,
    });
    expect(pick.status, `하위 선정: ${JSON.stringify(pick.json)}`).toBe(200);

    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    expect(top?.selectedChildRfqId, '선정 하위 박제').toBe(BigInt(childRfqId));
    expect(Number(top?.marginRate ?? 0), '마진%').toBe(MARGIN_RATE);
    expect(Number(top?.sourceAmount ?? 0), '원가(하위 회신가)').toBe(250);
    // 상위 회신가 = 하위가 × 환율(USD→KRW) × 1.2 — 환율은 그 시점 값이라 범위로 본다.
    const priced = Number(top?.priceOriginal ?? 0);
    const rate = Number(top?.sourceRate ?? 0);
    expect(rate, '변환 환율 박제').toBeGreaterThan(0);
    expect(priced, 'MD 회신가 = 하위가×환율×(1+마진)').toBe(
      Math.round(250 * rate * (1 + MARGIN_RATE / 100)),
    );
    F(
      'R3',
      'obs',
      `2단 견적 — 하위 ${String(childRfq.currency)} 250 × ${String(rate)} × ${String(1 + MARGIN_RATE / 100)}` +
        ` = ${String(top?.currency)} ${String(priced)}`,
    );
  }, 120_000);

  test('R4. 관리자: 선정+확정가 → 고객 주문 → 입금확인 → MD 발주', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    // MD 회신은 KRW 라 환율 없이 선정된다.
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: 640_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'R4',
      prefix: 'R04',
      buyerName: 'e2eMD고객',
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
      partnerId: num(md.id),
      rfqId: topRfqId,
    });
    expect(issue.status, `MD 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(md.id));
    expect(po, 'MD 발주서').toBeTruthy();
    topPoId = po.poId;
    ledger.push(`sp_pcb_po #${String(topPoId)} (관리자→MD)`);
  }, 480_000);

  test('R5. MD: 자체 EQ 는 위임되고, 하위 발주로 트랙이 넘어간다', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    // MD 는 제조를 직접 하지 않는다 — 상위 발주의 EQ 는 하위 발주로 위임된다.
    const before = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    expect(before.json?.data?.eq?.blocked, '하위 발주 전 EQ 시작 불가').toBe(true);

    const create = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId,
    });
    expect(create.status, `하위 발주: ${JSON.stringify(create.json)}`).toBe(200);
    const prisma = getPrisma();
    const childPo = await prisma.spPcbPo.findFirst({
      where: { specId: BigInt(specId ?? 0), partnerId: child.id, parentPartnerId: md.id },
      orderBy: { id: 'desc' },
    });
    expect(childPo, '하위 발주서 생성').not.toBeNull();
    childPoId = num(childPo.id);
    ledger.push(`sp_pcb_po #${String(childPoId)} (MD→하위)`);

    const after = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(after.json?.data?.eq?.delegatePoId, 'EQ 위임 대상이 하위 발주').toBe(childPoId);
    F('R5', 'obs', `EQ 위임 확인 — 상위 po=${String(topPoId)} → 하위 po=${String(childPoId)}`);
    await rp.view(mdView, `/app/partner/pcb/pos/${String(topPoId)}`, 'R05-md-delegated');
  }, 120_000);

  test('R6. 하위: EQ → 관리자 승인 → 생산완료', async (ctx) => {
    if (childPoId === null) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        C,
        `/api/partner/pcb-pos/${String(childPoId)}/eq-files`,
        { fileType },
        `${fileType}-md.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);
    // EQ 승인 주체는 관리자다(D3) — MD 를 거쳐도 그대로다.
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(childPoId)}/eq-approve`,
      {},
    );
    expect(ap.status, `EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/production-start`, {});
    expect(st.status, JSON.stringify(st.json)).toBe(200);
    const done = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/production-complete`, {});
    expect(done.status, JSON.stringify(done.json)).toBe(200);
  }, 180_000);

  test('R7. 하위 → MD 발송(국제) — 그 전에 MD 상위 출고는 막힌다', async (ctx) => {
    if (childPoId === null || topPoId === null) return ctx.skip();
    // 게이팅의 핵심 — 하위가 아직 MD 에 도착하지 않았으면 MD 는 상위로 내보낼 수 없다.
    const blocked = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(blocked.status, `하위 입고 전 상위 담기: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error, '출고 게이팅').toBe('OUTBOUND_BLOCKED');
    F('R7', 'obs', '하위 입고 전 MD 상위 출고 차단 확인(OUTBOUND_BLOCKED)');

    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, `하위 담기: ${JSON.stringify(box.json)}`).toBe(200);

    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(childPoId) } } },
      orderBy: { id: 'desc' },
    });
    // 받는측이 MD — 1~3호는 전부 관리자행이라 이 조합은 여기서만 지난다.
    expect(shipment?.receiverKind, '받는측 MD').toBe('md');
    expect(shipment?.mode, '하위(KR)→MD(CN) 국제').toBe('international');
    ledger.push(`sp_pcb_shipment (하위→MD, po ${String(childPoId)})`);

    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      C,
      `/api/partner/pcb-pos/${String(childPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-md.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);

    const reqd = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청: ${JSON.stringify(reqd.json)}`).toBe(200);
    // 국제 체인의 나머지는 받는측(MD)이 민다.
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
        trackingNumber: 'MD-AWB-0810',
      });
      if (adv.status !== 200) break;
    }
  }, 180_000);

  test('R8. MD 입고확인 → 게이트 해제 → MD → 관리자 발송', async (ctx) => {
    if (childPoId === null || topPoId === null) return ctx.skip();
    const recv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[여정 4호] MD 입고',
    });
    expect(recv.status, `MD 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    // 방금까지 막혀 있던 상위 출고가 열려야 한다 — 이 전후 대비가 게이팅의 실증이다.
    const box = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `입고 후 상위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    F('R8', 'obs', 'MD 입고확인으로 상위 출고 게이트 해제 확인');

    const prisma = getPrisma();
    const topShip = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    expect(topShip?.receiverKind, '받는측 관리자').toBe('admin');
    expect(topShip?.mode, 'MD(CN)→관리자(KR) 국제').toBe('international');
    ledger.push(`sp_pcb_shipment (MD→관리자, po ${String(topPoId)})`);

    // 상위 구간도 국제라 Invoice 가 다시 필요하다 — 구간마다 서류가 따로 붙는다.
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      M,
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-md-top.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `상위 Invoice: ${JSON.stringify(up.json)}`).toBe(200);

    const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      shipDate: '2026-08-13',
    });
    expect(adv.status, `상위 선적요청: ${JSON.stringify(adv.json)}`).toBe(200);
    await rp.view(mdView, '/app/partner/pcb/ship', 'R08-md-ship-board');
  }, 180_000);

  test('R9. 관리자: 국제 체인 완주 → 입고 확인 → 고객 배송 → 완료', async (ctx) => {
    if (topPoId === null || odId === null) return ctx.skip();
    // 상위 구간의 나머지 국제 단계는 받는측(관리자)이 민다.
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'MD-TOP-0810', trackingUrl: null },
      );
      if (adv.status !== 200) break;
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/receive`,
      { note: '[여정 4호] 관리자 입고' },
    );
    expect(recv.status, `관리자 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    const prisma = getPrisma();
    const topShip = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    expect(topShip?.receivedAt, '관리자 입고 시각').not.toBeNull();

    const queue = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=100');
    const mine = (queue.json?.data?.items ?? []).find((i: any) => i.odId === odId);
    if (mine === undefined) F('R9', 'bug', 'MD 경유 건이 고객 배송 대기 큐에 안 보임');
    expect(mine, '배송 대기 큐 진입').toBeTruthy();

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: 'MD-D-0810',
        invoiceTime: '2026-08-10 18:00:00',
      },
    });
    if (ship.status !== 200) F('R9', 'obs', `배송 전이: ${JSON.stringify(ship.json)}`);
    const fin = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    if (fin.status !== 200) F('R9', 'obs', `완료 전이: ${JSON.stringify(fin.json)}`);

    const row: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    expect(row[0]?.od_status, '최종 상태').toBe('완료');
    expect(Number(row[0]?.od_misu ?? -1), '미수금').toBe(0);
    F('R9', 'obs', `MD 경유 완주 — od=${odId} 상위po=${String(topPoId)} 하위po=${String(childPoId)}`);
  }, 180_000);
});
