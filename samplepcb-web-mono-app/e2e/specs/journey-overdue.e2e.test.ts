// 여정 14호 — **시간이 지난 건**(기한 초과 축).
//
// 앞의 열세 편은 전부 "제때 진행되는 건"을 밟았다. 그런데 실무에서 손이 가는 쪽은 **멈춰
// 있는 건**이다 — 고객이 EQ 확인을 안 하고, 협력사가 납기를 넘기고, 메일 링크는 만료된다.
// 이 편은 시계를 뒤로 돌려(DB 의 날짜 필드를 과거로 밀어) 그 세 가지가 화면·판정에서
// 어떻게 드러나는지 본다.
//
// 표적 셋:
//   ① **납기 경과** — 발주 큐·Case 는 납기를 회색 날짜로만 찍는다(AdminPcbPos.vue:183 ·
//      AdminPcbCase.vue:1566). 지났는지 여부가 어디에도 없으면 관리자는 목록에서 날짜를
//      하나하나 오늘과 비교해야 한다. 계약에 지연 파생이 있는지부터 본다.
//   ② **EQ 고객확인 기한 초과** — 여기는 설계가 있다: `isOverdue`(pcb-eq-review.ts)가
//      requested+dueOn 경과를 재촉 신호로 삼고, 그러면 `awaitingCustomer` 가 풀려 발주가
//      **관리자 차례로 돌아온다**(pcb-po.ts:1195 주석). 그 왕복이 실제로 도는지 확인한다.
//   ③ **매직링크 TTL(30일)** — 만료 토큰이 어떻게 거절되는지. 13호가 정지 조직 링크를
//      409 PARTNER_SUSPENDED 로 닫았으니, 만료는 그와 구별되는 응답이어야 한다.
//
// 시계를 돌리는 것은 **DB 직접 UPDATE** 뿐이다(라이브러리 시간 모킹은 서버 프로세스 밖이라
// 닿지 않는다). 되돌릴 필요는 없다 — 주행이 만든 행만 밀고 끝에 통째로 지운다.
//
// 실행: pnpm -F e2e journey:overdue  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 스크린샷 접두사는 **T** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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
/** 납기 경과 쪽(선정·발주) — 회신·선정까지 밟아야 발주가 자연스럽다. */
const LATE_ORG = '협력2';
/** 납기 여유 쪽(대조군) — 같은 화면에 나란히 서야 "갈리는지"를 볼 수 있다. */
const ONTIME_ORG = 'e2e한국협력';

const DAY = 86_400_000;

describe.skipIf(!RUN || !JOURNEY)('여정 14호 — 기한 초과(납기·EQ 확인·매직링크 TTL)', () => {
  const rp = createJourneyReport('findings-overdue', '여정 14호 기한 초과 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let lateOrg: PartnerFixture;
  let onTimeOrg: PartnerFixture;
  let A = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let latePoId: number | null = null; // 납기 경과 발주
  let onTimePoId: number | null = null; // 납기 여유 발주(대조군)
  let reviewId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const bodyTextOf = async (s: E2eSession): Promise<string> =>
    (await s.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  /** 발주 큐(탭별) 행 — 화면과 같은 모수를 API 로 집는다(페이지네이션 무관). */
  const queueRow = async (tab: string, poId: number): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-pos?tab=${tab}&page=1&pageSize=100`);
    expect(res.status, `큐 조회(${tab}): ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.items ?? []).find((i: any) => i.poId === poId) ?? null;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    lateOrg = await getPartner(LATE_ORG);
    onTimeOrg = await getPartner(ONTIME_ORG);

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('T1. 준비 — 한 Case 에 발주 2장(납기 경과 ↔ 납기 여유)', async () => {
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 14호] 기한 축 검증 — 확인 후 정리 예정',
      prefix: 'T01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(lateOrg.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(lateOrg.id))?.rfqId;
    expect(rfqId, 'RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${LATE_ORG})`);

    const reply = await api(
      A,
      'PUT',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/reply`,
      { price: 40, quotedDeliveryDate: '2026-08-20', exchangeRate: 1380, memo: '[여정 14호]' },
    );
    expect(reply.status, `회신: ${JSON.stringify(reply.json)}`).toBe(200);
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 70_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'T1',
      prefix: 'T01',
      buyerName: 'e2e기한검증고객',
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

    // 발주 2장 — 같은 Case 안에서 납기만 다르게. 한 화면에 나란히 서야 대조가 성립한다.
    const issueLate = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(lateOrg.id),
      rfqId,
    });
    expect(issueLate.status, `발행(경과 예정): ${JSON.stringify(issueLate.json)}`).toBe(200);
    latePoId = (issueLate.json?.data?.pos ?? []).find(
      (p: any) => p.partnerId === num(lateOrg.id),
    )?.poId;
    expect(latePoId, '경과 예정 발주').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(latePoId)} (${LATE_ORG} — 납기 경과 대상)`);

    const issueOnTime = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(onTimeOrg.id),
      priceOriginal: 50_000,
    });
    expect(issueOnTime.status, `발행(대조군): ${JSON.stringify(issueOnTime.json)}`).toBe(200);
    onTimePoId = (issueOnTime.json?.data?.pos ?? []).find(
      (p: any) => p.partnerId === num(onTimeOrg.id),
    )?.poId;
    expect(onTimePoId, '대조군 발주').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(onTimePoId)} (${ONTIME_ORG} — 납기 여유 대조군)`);

    // 납기를 심는다 — 경과분은 **어제**, 대조군은 **한 달 뒤**.
    const now = Date.now();
    await prisma.spPcbPo.update({
      where: { id: BigInt(latePoId ?? 0) },
      data: { deliveryDate: new Date(now - 1 * DAY) },
    });
    await prisma.spPcbPo.update({
      where: { id: BigInt(onTimePoId ?? 0) },
      data: { deliveryDate: new Date(now + 30 * DAY) },
    });
    F(
      'T1',
      'obs',
      `준비 완료 — spec=${String(specId)} 납기 경과 po=${String(latePoId)}(어제) · ` +
        `대조군 po=${String(onTimePoId)}(+30일), 둘 다 발주접수(issued)`,
    );
  }, 600_000);

  test('T2. 납기 경과가 판정·화면에서 갈리는가', async (ctx) => {
    if (latePoId === null || onTimePoId === null || specId === null) return ctx.skip();

    // 두 발주는 상태가 같고 납기만 다르다 — 갈리는 신호가 있다면 그건 납기 축뿐이다.
    const detail = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/pos`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    const rows: any[] = detail.json?.data?.pos ?? [];
    const late = rows.find((p) => p.poId === latePoId);
    const onTime = rows.find((p) => p.poId === onTimePoId);
    expect(late?.status, '두 발주 상태 동일(경과분)').toBe('issued');
    expect(onTime?.status, '두 발주 상태 동일(대조군)').toBe('issued');

    // 계약에 지연 파생이 있는가 — 없으면 화면은 날짜만 보고 스스로 판단해야 한다.
    const lateKeys = Object.keys(late ?? {});
    const delayKeys = lateKeys.filter((k) => /overdue|delay|late/i.test(k));

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'T02-case-two-due-dates');
    const caseText = await bodyTextOf(adminView);

    // 교정(08-11) — 판정은 계약의 순수 함수 isPcbDeliveryOverdue, 표시는 두 화면 공통.
    // 서버 파생을 늘리지 않은 건 상태·납기 둘 다 이미 응답에 있어서다(계산이 곧 규칙).
    expect(delayKeys.length, '지연은 파생 필드가 아니라 순수 함수 판정이다').toBe(0);
    expect(caseText, 'Case — 납기 초과 표기').toContain('납기 초과');
    // **대조군이 물들지 않았는가** — 한쪽만 보면 "전부 빨갛게"도 통과한다.
    const overdueMarks = (caseText.match(/납기 초과/g) ?? []).length;
    expect(overdueMarks, '초과 표기는 경과분 1건에만').toBe(1);
    F(
      'T2',
      'obs',
      `납기 경과 표기 — 같은 Case 두 발주 중 경과분(po ${String(latePoId)})만 '납기 초과', ` +
        `대조군(po ${String(onTimePoId)}, +30일)은 평소 표기. 판정=계약 순수 함수(KST 날짜 비교).`,
    );

    // 큐에서도 같은 규칙인지(모수는 API 로 — 화면은 페이지네이션이라 밀린다).
    const qLate = await queueRow('eq_pending', latePoId);
    F(
      'T2',
      'obs',
      `발주 큐(eq_pending) 행 확인 — 경과분 진입=${String(qLate !== null)} · ` +
        `행 납기=${String(qLate?.deliveryDate ?? '—')}`,
    );
  }, 240_000);

  test('T3. EQ 고객확인 기한 초과 — 공이 관리자에게 돌아오는가', async (ctx) => {
    if (latePoId === null || specId === null) return ctx.skip();
    const prisma = getPrisma();
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(latePoId)}`;

    // EQ 승인요청까지 올린 뒤 고객 확인을 요청한다(관리자 → 고객으로 공이 넘어간다).
    const req = await api(A, 'POST', `${base}/eq-request`, {});
    expect(req.status, `EQ 승인요청: ${JSON.stringify(req.json)}`).toBe(200);

    // 라우트는 poId 가 **경로**에 있다(`/pcb-eq-reviews/:poId`) — 본문이 아니다.
    const ask = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(latePoId)}`, {
      message: '[여정 14호] 고객 확인 요청(기한 축)',
      dueOn: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10),
    });
    expect(ask.status, `고객확인 요청: ${JSON.stringify(ask.json)}`).toBe(200);
    const review = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(latePoId) },
      orderBy: { id: 'desc' },
    });
    reviewId = review === null ? null : Number(review.id);
    expect(reviewId, '리뷰 행').toBeTruthy();
    ledger.push(`sp_pcb_eq_review #${String(reviewId)} (po ${String(latePoId)})`);

    // 기한 안 — 공은 고객에게 있다(관리자 차례가 아니다).
    const before = await queueRow('eq_pending', latePoId);
    expect(before, '기한 안 — EQ 승인 대기 큐 진입').toBeTruthy();
    expect(before?.adminTurn, '기한 안 — 관리자 차례 아님').toBe(false);
    expect(before?.eqReview?.overdue, '기한 안 — overdue 아님').toBe(false);

    // ── 시계를 돌린다 — dueOn 을 이틀 전으로.
    await prisma.spPcbEqReview.update({
      where: { id: BigInt(reviewId ?? 0) },
      data: { dueOn: new Date(Date.now() - 2 * DAY) },
    });

    const after = await queueRow('eq_pending', latePoId);
    expect(after?.eqReview?.overdue, '기한 초과 판정').toBe(true);
    // 설계 의도(pcb-po.ts:1195) — 기한이 지나면 재촉이 관리자 몫이라 차례가 되돌아온다.
    expect(after?.adminTurn, '기한 초과 — 관리자 차례 복귀').toBe(true);
    F(
      'T3',
      'obs',
      `EQ 기한 초과 왕복 실동작 — dueOn 을 -2일로 민 뒤 overdue=true·adminTurn=false→true. ` +
        `"답이 올 때까지 공은 고객에게, 기한이 지나면 재촉은 관리자 몫"이 판정으로 구현돼 있다.`,
    );

    // ⚠ 기본 탭은 '발주 대기'(다른 모수)라 이 건이 거기 없다 — 탭을 옮겨야 배지를 본다.
    await rp.view(adminView, '/app/admin/pcb/pos', 'T03-po-queue-overdue');
    await adminView.page.getByRole('button', { name: /^EQ 승인 대기/ }).click();
    await adminView.page.getByText('고객 기한초과').first().waitFor({ timeout: 15_000 });
    await rp.shot(adminView, 'T03-po-queue-overdue');
    const queueText = await bodyTextOf(adminView);
    // 판정만 되고 화면이 조용하면 관리자는 "왜 내 차례인지"를 모른다 — 배지가 근거다.
    expect(queueText, '큐 — 기한 초과 배지').toContain('고객 기한초과');
    F('T3', 'obs', `발주 큐 화면 — '고객 기한초과' 배지 노출 확인(P4.4 팔레트 red)`);
  }, 300_000);

  test('T4. 매직링크 TTL(30일) — 만료 토큰의 응답', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    const prisma = getPrisma();

    const row = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId) } });
    const token = String((row as any)?.magicToken ?? '');
    expect(token, '매직링크 토큰').not.toBe('');

    // 발급 시각을 31일 전으로 — TTL(30일) 밖이다.
    await prisma.spPcbRfq.update({
      where: { id: BigInt(rfqId) },
      data: { magicTokenAt: new Date(Date.now() - 31 * DAY) },
    });

    const openRes = await fetch(`${API_URL}/api/pcb-rfq-reply/${token}`);
    const openJson: any = await openRes.json().catch(() => null);
    // 만료는 "링크가 없다"와 같은 취급(404) — 13호의 정지(409 PARTNER_SUSPENDED)와 구별된다.
    expect(openRes.status, `만료 토큰 열람: ${JSON.stringify(openJson)}`).toBe(404);

    const putRes = await fetch(`${API_URL}/api/pcb-rfq-reply/${token}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ price: 41, quotedDeliveryDate: '2026-09-01' }),
    });
    expect(putRes.status, '만료 토큰 회신').toBe(404);
    F(
      'T4',
      'obs',
      `매직링크 TTL — magicTokenAt 을 -31일로 민 뒤 GET·PUT 모두 404(만료=링크 없음 취급). ` +
        `13호의 정지 차단(409 PARTNER_SUSPENDED)과 응답이 갈려, 협력사가 "만료"와 "배제"를 ` +
        `구분해 문의할 수 있다.`,
    );
  }, 240_000);

  test('T5. 정리 — 주문 되돌리기(재고 복원) + 생성물 대장', async (ctx) => {
    if (odId === null) return ctx.skip();
    // 문서(spec/rfq/po/review)는 cleanup-probe 가 스펙 축으로 훑어 지운다 — 여기서는
    // 재고 앵커만 되돌린다(force-status '주문' = 차감 재고 복원, 여정 공통 관례).
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('T5', 'obs', `정리 준비 — od=${odId} '주문' 복귀(재고 복원). 문서는 cleanup-probe 로.`);
  }, 180_000);
});
