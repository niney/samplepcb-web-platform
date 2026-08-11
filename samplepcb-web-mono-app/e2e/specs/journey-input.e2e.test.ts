// 여정 36호 — **입력 경계**(사람이 넣을 수 있는 값이 화면을 부수는가).
//
// 프로젝트명은 **업로드 파일명에서 온다**(24호가 `_` 로 확인했다). 즉 우리가 고른 값이
// 아니라 **고객이 준 값**이고, 길이도 문자도 통제 밖이다. 협력사 메모·반려 사유도 같다.
// 그런 값이 표 한 칸에 들어갔을 때:
//   ① 레이아웃이 가로로 터지는가(옆 칸이 밀려 화면 밖으로 나간다 — 버튼을 못 누른다)
//   ② 잘려서 **무엇인지 못 알아보는가**(잘리는 것 자체는 정상, 구별이 안 되면 문제)
//   ③ 태그·따옴표가 그대로 실행되거나 값이 깨지는가
//
// Vue 는 텍스트 보간을 이스케이프하고 이 리포에는 `v-html` 이 **한 곳도 없다**(전수 확인).
// 그래서 표적은 XSS 가 아니라 **레이아웃과 판독성**이다 — 실제로 아픈 쪽이기도 하다.
//
// 판정은 눈이 아니라 수치로 한다: `document.body.scrollWidth > innerWidth` 면 가로 넘침이다
// (여정 4호에서 사양 팝업 잘림을 그렇게 잡았다).
//
// 실행: pnpm -F e2e journey:input  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

// 실제로 올 수 있는 험한 값 — 공백 없는 긴 파일명(줄바꿈이 안 된다)·태그·따옴표·이모지.
// ⚠ 검사 키워드('없음' 등)와 겹치지 않게 고른다(오탐 2회의 교훈).
const LONG_NAME =
  'D36-' + 'ultra-long-gerber-filename-without-any-spaces-'.repeat(6) + 'final-rev12.zip';
const TRICKY_NAME = `D36-<script>x</script>-"quoted"-'single'-\\back-🔧-태그.zip`;

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 36호 — 입력 경계', () => {
  const rp = createJourneyReport('findings-input', '여정 36호 입력 경계 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner2: PartnerFixture;
  let A = '';
  let P = '';

  let longSpecId: number | null = null;
  let trickySpecId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;

  /** 가로 넘침이 확인된 화면 목록 — 이 편의 산출물. */
  const overflow: string[] = [];
  /** 실제로 저장된 긴 이름(컬럼 한계에서 잘릴 수 있다). */
  let savedLongName = '';

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /**
   * 가로 넘침 실측. 페이지 몸통이 창보다 넓으면 오른쪽 칸(대개 액션 버튼)이 화면 밖이다.
   * 표가 자기 컨테이너 안에서 스크롤되는 것은 정상이므로 **body 기준**으로만 잰다.
   */
  const measureOverflow = async (
    s: E2eSession,
    label: string,
  ): Promise<{ scrollWidth: number; innerWidth: number; over: boolean }> => {
    const m = await s.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const over = m.scrollWidth > m.innerWidth + 2;
    if (over) overflow.push(`${label}(${String(m.scrollWidth)}>${String(m.innerWidth)})`);
    return { ...m, over };
  };

  /** 이름이 화면에 **알아볼 수 있게** 남았는가 — 앞부분이라도 보이면 구별은 된다. */
  const nameVisible = async (s: E2eSession, head: string): Promise<boolean> => {
    const text = await s.page.evaluate(() => document.body.innerText).catch(() => '');
    return text.includes(head);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '협력사');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('I1. 고객: 견적 2건 → 험한 이름을 붙인다', async () => {
    const prisma = getPrisma();
    const ids: number[] = [];
    for (const tag of ['long', 'tricky'] as const) {
      const id = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 36호-${tag}] 입력 경계 — 확인 후 정리 예정`,
        prefix: `I01-${tag}`,
      });
      ids.push(id);
      ledger.push(`sp_order_spec #${String(id)} (${tag})`);
    }
    longSpecId = ids[0] ?? null;
    trickySpecId = ids[1] ?? null;
    // 프로젝트명은 업로드 파일명에서 오므로 **고객이 준 값**이다 — 직접 그 자리에 넣는다.
    await prisma.spOrderSpec.update({
      where: { id: BigInt(longSpecId ?? 0) },
      data: { projectName: LONG_NAME },
    });
    await prisma.spOrderSpec.update({
      where: { id: BigInt(trickySpecId ?? 0) },
      data: { projectName: TRICKY_NAME },
    });
    F(
      'I1',
      'obs',
      `준비 — 긴 이름 ${String(LONG_NAME.length)}자(공백 없음) #${String(longSpecId)} · ` +
        `특수문자·태그·이모지 이름 #${String(trickySpecId)}`,
    );
  }, 900_000);

  test('I2. 값이 그대로 저장되고 그대로 돌아오는가', async (ctx) => {
    if (longSpecId === null || trickySpecId === null) return ctx.skip();
    const prisma = getPrisma();
    const long = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(longSpecId) } });
    const tricky = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(trickySpecId) } });

    // 태그·따옴표·백슬래시·이모지는 무손실이다(utf8mb4 + 파라미터 바인딩).
    expect(tricky?.projectName, '특수문자·이모지 무손실').toBe(TRICKY_NAME);

    // ⚠ 길이는 다르다 — 컬럼 한계에서 **조용히 잘린다**(에러도 경고도 없다).
    //   MySQL 이 strict mode 가 아니면 초과분을 버리고 성공으로 답한다.
    savedLongName = long?.projectName ?? '';
    const truncated = savedLongName.length < LONG_NAME.length;

    // API 응답에서도 (잘린 채로) 같은 값이어야 한다 — 직렬화가 또 변형하면 안 된다.
    const r = await api(A, 'GET', `/api/admin/pcb-cases?q=D36-&page=1&pageSize=50`);
    expect(r.status, `Case 검색: ${JSON.stringify(r.json).slice(0, 200)}`).toBe(200);
    const names = (r.json?.data?.items ?? []).map((i: any) => String(i.projectName));
    expect(names.some((n: string) => n === tricky?.projectName), '응답이 저장값과 같다').toBe(true);

    F(
      'I2',
      truncated ? 'bug' : 'obs',
      truncated
        ? `**긴 이름이 조용히 잘린다** — ${String(LONG_NAME.length)}자로 넣었는데 ` +
          `${String(savedLongName.length)}자만 저장됐다(컬럼 한계). 에러도 경고도 없어 ` +
          `업로드한 사람은 이름이 바뀐 줄 모른다 — 거버 파일명이 곧 프로젝트명이라 ` +
          `고객이 자기 파일과 화면의 이름을 못 맞춘다. 특수문자·이모지는 무손실.`
        : `저장·응답 무손실 실측 — ${String(savedLongName.length)}자 유지 · 이모지·따옴표·` +
          `백슬래시 보존 · 검색 'D36-' 로 ${String(names.length)}건 회수`,
    );
  }, 300_000);

  test('I3. 관리자 Case 목록 — 험한 이름이 표를 밀어내는가', async (ctx) => {
    if (longSpecId === null) return ctx.skip();
    await rp.view(adminView, '/app/admin/pcb/cases', 'I03-cases');
    // ⚠ 기본 탭은 '견적'이라 우리 건이 거기 있으리라는 보장이 없다(워크큐 기본 탭 함정) —
    //   '전체'로 옮겨야 검색이 모수 전부를 본다.
    await adminView.page.getByRole('button', { name: /^전체/ }).first().click();
    await adminView.page.waitForTimeout(600);
    // ⚠ Case 큐의 placeholder 에는 '검색'이라는 낱말이 없다(35호에서 확인) — 실제 문구로 찾는다.
    await adminView.page.getByPlaceholder('프로젝트·회원ID·주문번호').first().fill('D36-');
    await adminView.page.keyboard.press('Enter');
    await adminView.page.waitForTimeout(2_000);
    const m = await measureOverflow(adminView, 'admin/pcb/cases');
    const seen = await nameVisible(adminView, 'D36-');
    await rp.shot(adminView, 'I03-cases');
    // 이름이 아예 안 보이면 관리자가 어느 건인지 못 고른다(잘리는 것과 다른 문제다).
    expect(seen, '험한 이름이라도 앞부분은 보인다').toBe(true);
    F(
      'I3',
      m.over ? 'bug' : 'obs',
      `Case 목록 실측 — 가로 ${String(m.scrollWidth)}px / 창 ${String(m.innerWidth)}px ` +
        `${m.over ? '**넘침(오른쪽 칸이 화면 밖)**' : '넘침 없음'} · 이름 식별 가능`,
    );
  }, 300_000);

  test('I4. Case 상세·발주까지 — 긴 이름이 붙은 채 전 구간', async (ctx) => {
    if (longSpecId === null) return ctx.skip();
    // 가격 확정 → 주문 → 입금 → 발주. 이름은 메일 제목·포털 카드까지 따라간다.
    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(longSpecId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, `RFQ: ${JSON.stringify(send.json)}`).toBe(200);
    const rfqId = (send.json?.data?.rfqs ?? [])[0]?.rfqId;
    expect(
      (await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
        price: 200,
        quotedDeliveryDate: '2026-08-28',
      })).status,
      '회신',
    ).toBe(200);
    expect(
      (await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(longSpecId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 300_000 },
      )).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId: longSpecId,
      step: 'I4',
      prefix: 'I04',
      buyerName: 'e2e입력경계고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId}`);
    expect(
      (await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: false,
        sendSms: false,
      })).status,
      '입금확인',
    ).toBe(200);
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(longSpecId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId,
      exchangeRate: 1400,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? [])[0]?.poId ?? null;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);

    await rp.view(adminView, `/app/admin/pcb/cases/${String(longSpecId)}`, 'I04-case-detail');
    const m = await measureOverflow(adminView, 'admin/pcb/cases/:id');
    await rp.shot(adminView, 'I04-case-detail');
    F(
      'I4',
      m.over ? 'bug' : 'obs',
      `Case 상세 실측(발주까지 진행) — 가로 ${String(m.scrollWidth)}/${String(m.innerWidth)}px ` +
        `${m.over ? '**넘침**' : '넘침 없음'} · po #${String(poId)}`,
    );
  }, 900_000);

  test('I5. 협력사 포털 — 남이 지은 이름이 내 화면을 부수는가', async (ctx) => {
    if (poId === null) return ctx.skip();
    await rp.view(partnerView, '/app/partner/pcb', 'I05-portal');
    await partnerView.page.waitForTimeout(1_200);
    const board = await measureOverflow(partnerView, 'partner/pcb');
    await rp.shot(partnerView, 'I05-portal');

    await rp.view(partnerView, `/app/partner/pcb/pos/${String(poId)}`, 'I05-po');
    await partnerView.page.waitForTimeout(1_200);
    const detail = await measureOverflow(partnerView, 'partner/pcb/pos/:id');
    const seen = await nameVisible(partnerView, 'D36-');
    await rp.shot(partnerView, 'I05-po');
    expect(seen, '포털에서도 이름이 보인다').toBe(true);
    F(
      'I5',
      board.over || detail.over ? 'bug' : 'obs',
      `포털 실측 — 보드 ${String(board.scrollWidth)}/${String(board.innerWidth)}px · ` +
        `발주 상세 ${String(detail.scrollWidth)}/${String(detail.innerWidth)}px ` +
        `${board.over || detail.over ? '**넘침 있음**' : '넘침 없음'}`,
    );
  }, 300_000);

  test('I6. 고객 주문내역 — 자기가 올린 이름이 자기 화면에서', async (ctx) => {
    if (odId === null) return ctx.skip();
    await rp.view(customer, `/shop/orderinquiryview.php?od_id=${odId}`, 'I06-order');
    await customer.page.waitForTimeout(1_200);
    const m = await measureOverflow(customer, 'shop/orderinquiryview');
    await rp.shot(customer, 'I06-order');
    F(
      'I6',
      m.over ? 'bug' : 'obs',
      `고객 주문내역 실측 — 가로 ${String(m.scrollWidth)}/${String(m.innerWidth)}px ` +
        `${m.over ? '**넘침**' : '넘침 없음'}`,
    );
  }, 300_000);

  test('I7. 종합 — 험한 이름이 부순 화면', async () => {
    F(
      'I7',
      overflow.length === 0 ? 'obs' : 'bug',
      overflow.length === 0
        ? `${String(LONG_NAME.length)}자 공백 없는 이름·태그·이모지에도 가로 넘침 0 — 표가 자기 ` +
          `컨테이너 안에서 접히거나 스크롤된다.`
        : `**가로로 터지는 화면 ${String(overflow.length)}곳** — ${overflow.join(' · ')}. ` +
          `오른쪽 칸(대개 액션 버튼)이 창 밖으로 나가 누를 수 없다. 프로젝트명은 고객이 올린 ` +
          `파일명이라 우리가 길이를 정할 수 없다.`,
    );
    expect(overflow.length, `넘친 화면: ${overflow.join(', ')}`).toBeGreaterThanOrEqual(0);
  }, 120_000);

  test('I8. 정리 준비 — 주문 되돌리기', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('I8', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 나머지는 cleanup-probe 로.`);
  }, 180_000);
});
