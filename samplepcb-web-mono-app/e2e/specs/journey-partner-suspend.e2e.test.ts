// 여정 13호 — **협력사 정지(운영 배제) 중의 진행 건**.
//
// 12호가 "포털 계정이 **없는** 조직"이었다면 이 편은 "계정이 **있었는데 막힌** 조직"이다.
// 조직 삭제는 문서 이력이 있으면 거부되고(PARTNER_HAS_PCB_DOCS), 라우트 주석이 **"운영
// 배제는 suspended"** 라고 못 박는다 — 즉 정지가 **정식 배제 경로**다. 계약 종료·분쟁·휴업
// 처럼 실무에서 흔한데, **정지 시점에 진행 중이던 발주가 어떻게 마무리되는지**는 아무도
// 검증한 적이 없다.
//
// requirePartner 는 status!=='approved' 를 403 으로 막는다(토큰 재발급 없이 즉시 반영).
// 그래서 정지 뒤 협력사는 아무것도 못 하고, 일을 마칠 사람은 관리자뿐이다(D11 만능 대행).
// 이 편이 겨냥하는 빈칸 셋:
//   ① **매직링크 경계** — 매직링크는 requirePartner 를 타지 않는다. 정지된 조직이 견적
//      회신은 계속할 수 있다면, "배제했다"는 판단과 실제 권한이 어긋난다.
//   ② **메일** — 정지 조직에 포털 CTA 가 계속 가면, 협력사는 눌러도 403 을 본다(12호가
//      무계정에 대해 고친 것과 같은 계열의 문제다).
//   ③ **관리자 화면** — 12호가 세운 '대행 필요' 배지는 **계정 유무만** 본다. 정지 조직은
//      멤버가 있으니 배지가 안 뜨는데 실제로는 포털을 못 쓴다 → 관리자는 협력사가 할 거라
//      믿고 기다린다. 기다리면 영영 안 온다.
//
// 주인공은 **이 편 전용 상설 조직** `e2e정지협력`(KR/KRW)이다. 협력2 를 정지시켰다가
// 복구에 실패하면 다른 여정이 전부 깨지므로 절대 쓰지 않는다. 계정은 1번 고객 행을 복제한
// `e2e-partner-susp`(cloneG5Member — 비밀번호 원문이 어디에도 늘지 않는다).
//
// 실행: pnpm -F e2e journey:suspend  (PORTAL_E2E=1 + JOURNEY=1 — 거버·Mailpit 필요)
// 스크린샷 접두사는 **S** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  cloneG5Member,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  mailpitDelete,
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
/** 이 편 전용 상설 조직 — 정지·해제를 반복하므로 다른 여정과 절대 공유하지 않는다. */
const SUSP_ORG = 'e2e정지협력';
/** 그 조직의 연결 계정(상설) — 1번 고객 행 복제. */
const SUSP_MB = 'e2e-partner-susp';
const SUSPEND_REASON = '[여정 13호] 계약 종료 — 운영 배제 검증';

describe.skipIf(!RUN || !JOURNEY)('여정 13호 — 협력사 정지 중의 진행 건', () => {
  const rp = createJourneyReport('findings-suspend', '여정 13호 협력사 정지 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession | null = null;
  let org: PartnerFixture;
  let orgEmail = '';
  let A = '';
  let P = ''; // 정지 대상 조직의 포털 토큰

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  /** **정지 전에** 배정해 미회신으로 남겨 두는 RFQ — 매직링크 경계(S5)의 진짜 표적.
   *  정지 후 새 배정은 서버가 막지만(INVALID_PARTNER), 이미 나간 링크는 메일함에 남는다. */
  let preSpecId: number | null = null;
  let preRfqId: number | null = null;
  let preToken = '';
  let shipmentId: bigint | null = null;
  const seenMailIds = new Set<string>();

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const mailQuery = (to: string, subject: string): string => `to:"${to}" subject:"${subject}"`;
  const mailBaseline = async (to: string, subject: string): Promise<string | null> =>
    (await mailpitSearch(mailQuery(to, subject)))?.messages?.[0]?.ID ?? null;
  const waitMail = async (
    to: string,
    subject: string,
    baseline: string | null,
  ): Promise<{ ID: string; Subject: string; HTML: string } | null> => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const found = (await mailpitSearch(mailQuery(to, subject)))?.messages?.[0] ?? null;
      if (found !== null && found.ID !== baseline) {
        seenMailIds.add(String(found.ID));
        const body = await mailpitMessage(String(found.ID));
        return {
          ID: String(found.ID),
          Subject: String(body?.Subject ?? ''),
          HTML: String(body?.HTML ?? ''),
        };
      }
    }
    return null;
  };

  const bodyTextOf = async (s: E2eSession): Promise<string> =>
    (await s.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  /** 조직 상태 전환 — 정지는 사유가 필수다(계약 refine). */
  const setStatus = async (status: string, reason?: string): Promise<{ status: number; json: any }> =>
    api(A, 'POST', `/api/admin/partners/${String(org.id)}/status`, { status, reason });

  const partnerGet = async (path: string): Promise<{ status: number; json: any }> =>
    api(P, 'GET', path);

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });

    // ── 상설 픽스처 확보(idempotent) — 조직·계정·연결 셋 다 있으면 그대로 쓴다.
    const prisma = getPrisma();
    let row = await prisma.spPartner.findFirst({ where: { name: SUSP_ORG } });
    if (row === null) {
      const created = await api(A, 'POST', '/api/admin/partners', {
        type: 'partner',
        name: SUSP_ORG,
        country: 'KR',
        defaultCurrency: 'KRW',
        capabilities: ['pcb_rfq'],
        contactEmail: `${SUSP_MB}@test.local`,
      });
      if (created.status !== 200) {
        throw new Error(`정지 검증용 조직 생성 실패: ${JSON.stringify(created.json)}`);
      }
      row = await prisma.spPartner.findFirst({ where: { name: SUSP_ORG } });
      console.log(`  [setup] 조직 신설: #${String(row?.id)} ${SUSP_ORG} (KR/KRW)`);
    }
    // 승인 상태로 시작해야 한다 — 지난 주행이 정지에서 끝났을 수 있다(안전망).
    if (row !== null && row.status !== 'approved') {
      await api(A, 'POST', `/api/admin/partners/${String(row.id)}/status`, { status: 'approved' });
    }
    await cloneG5Member(SUSP_MB, 'e2e정지협력담당');
    const linked = await prisma.spPartnerMember.count({ where: { mbId: SUSP_MB } });
    if (linked === 0) {
      const add = await api(A, 'POST', `/api/admin/partners/${String(row?.id)}/members`, {
        mbId: SUSP_MB,
        role: 'owner',
      });
      if (add.status !== 200) {
        throw new Error(`계정 연결 실패: ${JSON.stringify(add.json)}`);
      }
      console.log(`  [setup] 계정 연결: ${SUSP_MB} → ${SUSP_ORG}`);
    }

    org = await getPartner(SUSP_ORG);
    orgEmail = org.contactEmail ?? '';
    if (orgEmail === '') throw new Error(`${SUSP_ORG} contactEmail 이 비어 있습니다`);
    P = signJwt({ mbId: SUSP_MB, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    // ⚠ 조직은 상설이다 — **반드시 승인으로 되돌린다**. 정지된 채 남으면 다음 주행의
    //   beforeAll 이 복구하긴 하지만, 그 사이 다른 편이 이 조직을 보면 상태가 오염된다.
    try {
      const cur = await getPrisma().spPartner.findFirst({ where: { name: SUSP_ORG } });
      if (cur !== null && cur.status !== 'approved') {
        await api(A, 'POST', `/api/admin/partners/${String(cur.id)}/status`, {
          status: 'approved',
        });
      }
    } catch {
      /* 복구 실패는 리포트로 드러난다 */
    }
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('S1. 전제 — 계정이 살아 있는 조직이 포털로 정상 일한다(정지 전 대조군)', async () => {
    expect(org.country, `${SUSP_ORG} 국가`).toBe('KR');
    expect(org.mbId, `${SUSP_ORG} 연결 계정 있음(12호와 반대 전제)`).toBe(SUSP_MB);
    const prisma = getPrisma();
    const cur = await prisma.spPartner.findUnique({ where: { id: org.id } });
    expect(cur?.status, '주행 시작 상태').toBe('approved');

    // 포털이 실제로 열린다 — 이 200 이 있어야 나중의 403 이 "정지 때문"임이 증명된다.
    const pos = await partnerGet('/api/partner/pcb-pos');
    expect(pos.status, `포털 발주 목록(승인 상태): ${JSON.stringify(pos.json)}`).toBe(200);
    const board = await partnerGet('/api/partner/pcb-shipments');
    expect(board.status, '포털 발송 보드(승인 상태)').toBe(200);
    F('S1', 'obs', `정지 전 대조 — ${SUSP_ORG}(계정 ${SUSP_MB}) 포털 200(발주 목록·발송 보드)`);
  }, 120_000);

  test('S2. 협력사가 일하는 중 — 포털 회신 → 선정 → 주문 → 입금 → 발주', async (ctx) => {
    if (org === undefined) return ctx.skip();
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      // ⚠ 메모는 Case 화면에 그대로 찍힌다 — S7 이 화면에서 '정지' 문구를 찾으므로
      //   시드 문구에 그 낱말을 쓰면 자기가 심은 글자를 자기가 찾는다(첫 두 주행의 오탐).
      memo: '[여정 13호] 조직 상태 전환 검증 — 확인 후 정리 예정',
      prefix: 'S02',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(org.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(org.id))?.rfqId;
    expect(rfqId, 'RFQ 행 생성').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${SUSP_ORG})`);

    // ── 회신을 **포털로** 넣는다(대리 입력 아님) — 이 조직이 스스로 일하던 상태를 만든다.
    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 42_000,
      quotedDeliveryDate: '2026-08-22',
      memo: '[여정 13호] 협력사 포털 회신',
    });
    expect(reply.status, `포털 회신: ${JSON.stringify(reply.json)}`).toBe(200);
    const saved = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId ?? 0) } });
    expect(saved?.status, '포털 회신 후 상태').toBe('quoted');

    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 60_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'S2',
      prefix: 'S02',
      buyerName: 'e2e정지검증고객',
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
      partnerId: num(org.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(org.id))?.poId;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)} (${SUSP_ORG} — 정지 전 발행)`);

    // 협력사가 자기 발주를 포털에서 보고 있다(정지 직전 상태).
    const mine = await partnerGet('/api/partner/pcb-pos');
    expect(mine.status, '포털 발주 목록').toBe(200);
    expect(
      (mine.json?.data?.items ?? []).some((p: any) => Number(p.poId) === poId),
      '자기 발주가 포털에 보인다(정지 전)',
    ).toBe(true);
    // ── 매직링크 경계(S5)의 표적을 **정지 전에** 심어 둔다: 회신하지 않은 견적요청 1건.
    //    실무에서 정지는 "메일이 이미 나간 뒤"에 일어난다 — 메일함의 링크는 회수되지 않는다.
    preSpecId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 13호] 사전 발급 링크 표적 — 확인 후 정리 예정',
      prefix: 'S02b',
    });
    ledger.push(`sp_order_spec #${String(preSpecId)} (정지 전 매직링크 표적)`);
    const preSend = await api(A, 'POST', `/api/admin/pcb-projects/${String(preSpecId)}/rfqs`, {
      partnerIds: [num(org.id)],
    });
    expect(preSend.status, `정지 전 RFQ 배정: ${JSON.stringify(preSend.json)}`).toBe(200);
    preRfqId = (preSend.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(org.id))?.rfqId;
    expect(preRfqId, '정지 전 RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(preRfqId)} (미회신 — 매직링크 표적)`);
    const preRow = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(preRfqId ?? 0) } });
    preToken = String((preRow as any)?.magicToken ?? '');
    expect(preToken, '매직링크 토큰 발급').not.toBe('');

    F('S2', 'obs', `정지 전 진행 상태 완성 — spec=${String(specId)} po=${String(poId)} od=${odId} (포털 회신·포털 열람 실동작) · 미회신 RFQ #${String(preRfqId)} 매직링크 보유`);
  }, 600_000);

  test('S3. 정지 — 진행 중 발주가 있어도 배제된다(삭제와 대조)', async (ctx) => {
    if (poId === null) return ctx.skip();

    // 삭제는 문서 이력을 이유로 거부된다 — "그럼 어떻게 배제하나"의 답이 정지다.
    const del = await api(A, 'DELETE', `/api/admin/partners/${String(org.id)}`);
    expect(del.status, `문서 있는 조직 삭제: ${JSON.stringify(del.json)}`).toBe(409);
    expect(del.json?.error, '삭제 거부 코드').toBe('PARTNER_HAS_PCB_DOCS');

    // 사유 없는 정지는 계약이 막는다(감사 기록이 목적).
    const noReason = await setStatus('suspended');
    expect(noReason.status, '사유 없는 정지는 거절').toBe(400);

    const susp = await setStatus('suspended', SUSPEND_REASON);
    expect(susp.status, `정지: ${JSON.stringify(susp.json)}`).toBe(200);
    const after = await getPrisma().spPartner.findUnique({ where: { id: org.id } });
    expect(after?.status, '정지 반영').toBe('suspended');
    expect(after?.statusReason, '사유 박제').toBe(SUSPEND_REASON);
    F(
      'S3',
      'obs',
      `정지 성립 — 진행 중 발주 #${String(poId)} 가 있어도 200(정식 배제 경로). ` +
        `삭제는 같은 조건에서 409 PARTNER_HAS_PCB_DOCS.`,
    );
  }, 120_000);

  test('S4. 포털 즉시 차단 — 같은 토큰이 403(재발급 불필요)', async (ctx) => {
    if (poId === null) return ctx.skip();
    // 토큰은 그대로다. 정지가 **요청 시점 조회**로 판정되므로 즉시 막혀야 한다.
    for (const path of [
      '/api/partner/pcb-pos',
      '/api/partner/pcb-rfqs',
      '/api/partner/pcb-shipments',
      '/api/partner/pcb-as-cases',
    ]) {
      const res = await partnerGet(path);
      expect(res.status, `정지 후 ${path}`).toBe(403);
    }
    // 쓰기도 같이 막혀야 한다(읽기만 막고 쓰기가 열리면 배제가 아니다).
    const advance = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(advance.status, '정지 후 EQ 전이 시도').toBe(403);

    // 포털 화면 — 협력사가 실제로 보는 것(빈 화면인지, 이유가 적혀 있는지).
    partnerView = await newSession({ mbId: SUSP_MB }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '협력사(정지)');
    // ⚠ 포털에는 `pcb/pos`(목록) 라우트가 없다 — 상세 `pcb/pos/:id` 와 홈 `pcb` 뿐이다
    //   (`/admin/pcb/pos` 는 관리자 쪽). 없는 경로로 가면 Vue Router 가 아무것도 그리지
    //   않아 **빈 화면**이 되는데, 그건 정지와 무관한 404 다(첫 주행이 이걸 결함으로 오독).
    //   메일이 실제로 가리키는 두 자리(홈·발주 상세 딥링크)에서 확인한다.
    for (const [path, name] of [
      ['/app/partner/pcb', 'S04-portal-suspended'],
      [`/app/partner/pcb/pos/${String(poId)}`, 'S04-portal-deeplink-suspended'],
    ] as const) {
      await rp.view(partnerView, path, name);
      const text = await bodyTextOf(partnerView);
      expect(text, `정지 포털(${path}) — 이유 안내`).toContain('포털을 이용할 수 없는 계정입니다');
      expect(text, `정지 포털(${path}) — 진행 건 처리 안내`).toContain('담당자가 대신 처리');
    }
    F(
      'S4',
      'obs',
      `정지 후 포털 4경로 + 쓰기 1건 전부 403(토큰 재발급 없이 즉시). 홈·딥링크 두 화면 ` +
        `모두 사유 안내 렌더(진입 리졸버를 지나치는 딥링크가 실제 위험 자리).`,
    );
  }, 180_000);

  test('S5. 매직링크 경계 — 정지 전에 나간 링크가 정지 후에도 통하는가', async (ctx) => {
    if (preRfqId === null || preToken === '') return ctx.skip();
    const prisma = getPrisma();

    // ① 정지 **후** 새 배정 — 서버가 조직 상태를 본다(경계의 절반은 이미 닫혀 있다).
    const lateSpecCheck = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(org.id)],
    });
    expect(lateSpecCheck.status, '정지 조직 신규 배정은 거절').toBe(400);
    expect(lateSpecCheck.json?.error, '거절 코드').toBe('INVALID_PARTNER');

    // ② 정지 **전**에 나간 링크 — 메일함에 남아 있고 회수되지 않는다. requirePartner 를
    //    타지 않는 무인증 경로라, 조직 상태를 이 라우트가 따로 보지 않으면 그대로 열린다.
    const openRes = await fetch(`${API_URL}/api/pcb-rfq-reply/${preToken}`);
    const openJson: any = await openRes.json().catch(() => null);
    const putRes = await fetch(`${API_URL}/api/pcb-rfq-reply/${preToken}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        price: 39_000,
        quotedDeliveryDate: '2026-08-25',
        memo: '[여정 13호] 정지 중 매직링크 회신 시도',
      }),
    });
    const putJson: any = await putRes.json().catch(() => null);
    const after = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(preRfqId) } });

    // 교정(08-11) — 토큰은 회수할 수 없으므로 쓰는 순간 조직 상태를 본다.
    expect(putRes.status, `정지 조직 매직링크 회신: ${JSON.stringify(putJson)}`).toBe(409);
    expect(putJson?.error, '차단 코드').toBe('PARTNER_SUSPENDED');
    // 열람도 함께 막는다 — 이 링크는 고객 도면·사양까지 여는 통로다.
    expect(openRes.status, `정지 조직 매직링크 열람: ${JSON.stringify(openJson)}`).toBe(409);
    // 그리고 **아무것도 저장되지 않아야** 한다(막았다면 회신이 남을 리 없다).
    expect(after?.status, '회신 미저장').toBe('requested');
    expect(after?.priceOriginal ?? null, '회신가 미기록').toBeNull();
    F(
      'S5',
      'obs',
      `정지 전 발급 매직링크도 닫힌다(교정 08-11) — GET 409 · PUT 409 PARTNER_SUSPENDED · ` +
        `rfq #${String(preRfqId)} status=${String(after?.status)}(미회신 유지). ` +
        `신규 배정은 INVALID_PARTNER, 포털은 requirePartner 403 — 세 경로가 같은 판정을 쓴다.`,
    );
  }, 300_000);

  test('S6. 메일 — 정지 조직에 포털 CTA 가 계속 가는가', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();

    // 발주 이후 통지 중 하나를 정지 상태에서 발사한다(EQ 결정 메일).
    // 협력사 몫 전이는 관리자가 대행해야 하므로, 대행 자체가 S8 의 예고편이 된다.
    const base = await mailBaseline(orgEmail, 'PCB EQ');
    const req = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-request`,
      {},
    );
    expect(req.status, `EQ 승인요청 대행: ${JSON.stringify(req.json)}`).toBe(200);
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`,
      {},
    );
    expect(ap.status, `EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);

    const mail = await waitMail(orgEmail, 'PCB EQ', base);
    if (mail === null) {
      F('S6', 'obs', 'EQ 결정 메일 미수신 — 발송 경로 확인 필요');
      return;
    }
    // 교정(08-11) — CTA 판정이 **멤버 존재 ∧ 조직 승인**으로 바뀌었다. 계정이 없어서 못
    // 쓰는 것과 배제돼서 못 쓰는 것은 협력사가 보는 결과가 같으므로, 같은 대행 안내로 간다.
    expect(mail.HTML.includes('/app/partner'), '정지 조직 — 포털 링크 소거').toBe(false);
    expect(mail.HTML, '정지 조직 — 대행 안내로 치환').toContain('담당자가 대행합니다');
    expect(mail.Subject, '메일 종류').toContain('EQ');
    F('S6', 'obs', `정지 조직 메일 — 포털 CTA 소거·대행 안내 치환("${mail.Subject}")`);
  }, 300_000);

  test('S7. 관리자 화면 — 정지가 보이는가(대행이 필요한 줄인지)', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();

    const detail = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/pos`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    const row = (detail.json?.data?.pos ?? []).find((p: any) => p.poId === poId);
    expect(row, '발주 행').toBeTruthy();
    // 12호가 세운 파생 — 계정 유무만 본다. 정지 조직은 멤버가 있어 true 가 된다.
    const hasPortal = row?.partnerHasPortal;

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'S07-case-suspended');
    const caseText = await bodyTextOf(adminView);
    // ⚠ 이 조직의 **이름 자체에 '정지'가 들어 있다**(e2e정지협력) — 이름을 지우고 봐야 한다.
    //   첫 주행이 이 오탐에 걸려 "정지 표기 있음"으로 잘못 읽혔다(스크린샷에는 없었다).
    const withoutName = caseText.split(SUSP_ORG).join('');
    const showsSuspend = withoutName.includes('정지') || withoutName.includes('운영 배제');

    // 교정(08-11) — 12호가 세운 축('멤버 존재')은 "포털을 쓸 수 있는가"를 대변하지 못했다.
    // 정지 조직도 못 쓰는 것은 같으므로 같은 배지가 서야 한다(판정은 승인까지 본다).
    expect(hasPortal, '정지 조직 — 포털 사용 불가로 판정').toBe(false);
    expect(caseText, 'Case — 대행 필요 배지').toContain('대행 필요');
    F(
      'S7',
      'obs',
      `관리자 화면이 대행 필요를 안다 — partnerHasPortal=${String(hasPortal)} · ` +
        `'대행 필요' 배지 있음 · 화면 정지 낱말=${String(showsSuspend)}(조직명·메모 제외 후)`,
    );
  }, 180_000);

  test('S8. 관리자 대행으로 완주 — 배제된 조직의 일도 끝은 난다', async (ctx) => {
    if (specId === null || poId === null || odId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    const start = await api(A, 'POST', `${base}/production-start`, {});
    expect(start.status, `생산 시작 대행: ${JSON.stringify(start.json)}`).toBe(200);
    const done = await api(A, 'POST', `${base}/production-complete`, {});
    expect(done.status, `생산 완료 대행: ${JSON.stringify(done.json)}`).toBe(200);

    // 발송 시작(담기)은 12호가 연 관리자 동선 — 정지 조직에도 그대로 필요하다.
    const box = await api(A, 'POST', `${base}/shipment/box`, {});
    expect(box.status, `발송 시작(담기) 대행: ${JSON.stringify(box.json)}`).toBe(200);
    const adv = await api(A, 'POST', `${base}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber: 'KR-SUSP-0811',
    });
    expect(adv.status, `배송 중 대행: ${JSON.stringify(adv.json)}`).toBe(200);

    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    shipmentId = shipment?.id ?? null;
    expect(shipment?.mode, '국내 파생').toBe('domestic');
    ledger.push(`sp_pcb_shipment #${String(shipmentId)} (po ${String(poId)} — 정지 조직 대행)`);

    const recv = await api(A, 'POST', `${base}/shipment/receive`, {
      note: '[여정 13호] 정지 조직 건 입고',
    });
    expect(recv.status, `입고 확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findUnique({ where: { id: shipmentId ?? 0n } });
    expect(closed?.receivedAt, '입고 시각 기록').not.toBeNull();

    // EQ 이력이 전부 관리자 손인지 — 정지 뒤로는 협력사 주체가 있을 수 없다.
    const po = await prisma.spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    const history: any[] = Array.isArray(po?.eqHistory) ? po.eqHistory : [];
    const afterSuspend = history.filter((e) => e.byRole !== undefined);
    expect(
      afterSuspend.every((e) => e.byRole === 'ADMIN'),
      `정지 후 전이 주체는 전부 ADMIN — 실측 [${afterSuspend.map((e) => String(e.byRole)).join(', ')}]`,
    ).toBe(true);
    F(
      'S8',
      'obs',
      `정지 조직 건 완주 — 생산·발송·입고 전부 관리자 대행(byRole ` +
        `[${afterSuspend.map((e) => String(e.byRole)).join(', ')}]), 포털 무접촉.`,
    );
  }, 480_000);

  test('S9. 정지 해제 → 포털 복귀 + 상설 픽스처 원복', async (ctx) => {
    if (org === undefined) return ctx.skip();

    const back = await setStatus('approved');
    expect(back.status, `정지 해제: ${JSON.stringify(back.json)}`).toBe(200);
    // 같은 토큰이 다시 통해야 한다(정지가 상태 조회 판정이라는 것의 반대 방향 증거).
    const pos = await partnerGet('/api/partner/pcb-pos');
    expect(pos.status, '해제 후 포털 복귀').toBe(200);
    // 같은 상태로 다시 바꾸는 것은 409(동시 클릭 1회 수렴).
    const again = await setStatus('approved');
    expect(again.status, '동일 상태 재설정').toBe(409);
    expect(again.json?.error, '재설정 코드').toBe('ALREADY_IN_STATUS');

    const cur = await getPrisma().spPartner.findUnique({ where: { id: org.id } });
    expect(cur?.status, '상설 픽스처 원복').toBe('approved');
    F('S9', 'obs', `정지 해제 → 포털 200 복귀(토큰 동일) · 조직 ${SUSP_ORG} approved 원복`);

    if (seenMailIds.size > 0) {
      await mailpitDelete([...seenMailIds]);
      F('S9', 'obs', `Mailpit 정리 — 이번 주행분 ${String(seenMailIds.size)}통 삭제`);
    }
  }, 180_000);
});
