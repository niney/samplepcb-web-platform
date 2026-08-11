// 여정 32호 — **화면 렌더 회귀**(어느 화면도 조용히 깨지지 않는가).
//
// 앞의 서른한 편은 각자 **필요한 화면만** 열었다. 그래서 "어느 여정도 열지 않는 화면"이 남는다 —
// 거기가 깨지면 아무 테스트도 빨개지지 않고, 관리자가 클릭한 순간에야 발견된다. 계약 필드를
// 늘리거나 라우트를 손볼 때 가장 조용히 무너지는 자리다.
//
// 이 편은 **넓고 얕게** 본다: 세 역할(관리자·협력사·고객)의 주요 화면을 열어
//   ① **pageerror 0**(JS 예외가 나면 화면 일부가 통째로 안 그려진다)
//   ② **HTTP 5xx 0**(서버가 죽은 응답을 주는데 화면은 빈 채로 서 있는 경우)
//   ③ **내용이 있다**(빈 껍데기가 아니다 — 라우트 매칭 실패는 흰 화면으로 나타난다, 13호 교훈)
// 만 확인한다. 각 화면의 **의미**는 해당 여정이 이미 지킨다 — 여기서는 "열리는가"만 본다.
//
// **쓰기가 없다**(read-only). 실데이터 위에서 그대로 연다.
//
// 실행: pnpm -F e2e journey:screens  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  newPhpSession,
  newSession,
  requireCustomerCreds,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

/** 관리자 콘솔 — PCB 모듈 전 화면 + 공통 관리(여정이 안 여는 것 포함). */
const ADMIN_SCREENS: readonly [string, string][] = [
  ['/app/admin/pcb/cases', 'pcb-cases'],
  ['/app/admin/pcb/rfqs', 'pcb-rfqs'],
  ['/app/admin/pcb/orders', 'pcb-orders'],
  ['/app/admin/pcb/pos', 'pcb-pos'],
  ['/app/admin/pcb/remittances', 'pcb-remittances'],
  ['/app/admin/pcb/shipments', 'pcb-shipments'],
  ['/app/admin/partners', 'partners'],
  ['/app/admin/mail-logs', 'mail-logs'],
  ['/app/admin/orders', 'orders'],
  ['/app/admin/members', 'members'],
];

/** 협력사 포털 — 실제 라우트만(13호 교훈: `pcb/pos` 목록은 없다). */
const PARTNER_SCREENS: readonly [string, string][] = [
  ['/app/partner', 'entry'],
  ['/app/partner/pcb', 'pcb-home'],
  ['/app/partner/pcb/ship', 'pcb-ship'],
  ['/app/partner/pcb/shipments/done', 'pcb-done'],
  ['/app/partner/pcb/as', 'pcb-as'],
];

describe.skipIf(!RUN || !JOURNEY)('여정 32호 — 화면 렌더 회귀', () => {
  const rp = createJourneyReport('findings-screens', '여정 32호 화면 렌더 탐색 주행 리포트');
  const { F } = rp;

  let adminView: E2eSession;
  let partnerView: E2eSession;
  let customer: PhpLoginResult;
  let partner: PartnerFixture;

  /** 화면별 관찰 결과 — 실패해도 계속 돌아 **전수 목록**을 만든다(첫 실패에서 멈추면 나머지를 모른다). */
  const results: { path: string; len: number; errors: number; http5xx: number }[] = [];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 한 화면을 열고 예외·5xx·내용을 잰다. */
  const visit = async (
    s: { page: any },
    path: string,
    name: string,
    prefix: string,
  ): Promise<void> => {
    const errors: string[] = [];
    const http5xx: string[] = [];
    const onError = (e: any): void => {
      errors.push(String(e?.message ?? e));
    };
    const onResponse = (res: any): void => {
      if (Number(res.status()) >= 500) http5xx.push(`${String(res.status())} ${String(res.url())}`);
    };
    s.page.on('pageerror', onError);
    s.page.on('response', onResponse);
    try {
      await s.page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await s.page.waitForTimeout(600);
    } catch {
      /* 이동 실패도 결과에 담는다(len 0 으로 드러난다) */
    }
    const text: string = await s.page
      .evaluate(() => document.body.innerText)
      .catch(() => '');
    try {
      await s.page.screenshot({ path: `e2e/output/journey/${prefix}-${name}.png`, fullPage: false });
    } catch {
      /* 스크린샷 실패는 관찰을 막지 않는다 */
    }
    s.page.off('pageerror', onError);
    s.page.off('response', onResponse);
    results.push({
      path,
      len: text.replace(/\s+/g, ' ').trim().length,
      errors: errors.length,
      http5xx: http5xx.length,
    });
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await getPartner('협력2');
    if (partner.mbId === null) throw new Error('협력2 연결 계정 없음');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'pcb' });
    customer = await newPhpSession(requireCustomerCreds());
  }, 180_000);

  afterAll(async () => {
    rp.write({});
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('S1. 관리자 콘솔 — 열 화면', async () => {
    for (const [path, name] of ADMIN_SCREENS) {
      await visit(adminView, path, name, 'Z01-admin');
    }
    const mine = results.filter((r) => r.path.startsWith('/app/admin'));
    const broken = mine.filter((r) => r.errors > 0 || r.http5xx > 0 || r.len < 100);
    // 전수를 한 번에 보여 준다 — 하나만 빨개지고 나머지를 모르면 고칠 순서를 못 정한다.
    expect(
      broken.map((b) => `${b.path}(len=${String(b.len)} err=${String(b.errors)} 5xx=${String(b.http5xx)})`),
      '관리자 화면 이상 없음',
    ).toEqual([]);
    F(
      'S1',
      'obs',
      `관리자 ${String(mine.length)}화면 렌더 — 평균 ${String(
        Math.round(mine.reduce((a, r) => a + r.len, 0) / Math.max(mine.length, 1)),
      )}자 · pageerror 0 · 5xx 0`,
    );
  }, 600_000);

  test('S2. 협력사 포털 — 다섯 화면', async () => {
    for (const [path, name] of PARTNER_SCREENS) {
      await visit(partnerView, path, name, 'Z02-partner');
    }
    const mine = results.filter((r) => r.path.startsWith('/app/partner'));
    const broken = mine.filter((r) => r.errors > 0 || r.http5xx > 0 || r.len < 50);
    expect(
      broken.map((b) => `${b.path}(len=${String(b.len)} err=${String(b.errors)} 5xx=${String(b.http5xx)})`),
      '포털 화면 이상 없음',
    ).toEqual([]);
    F(
      'S2',
      'obs',
      `협력사 포털 ${String(mine.length)}화면 렌더 — pageerror 0 · 5xx 0 ` +
        `(길이 ${mine.map((r) => String(r.len)).join('/')})`,
    );
  }, 600_000);

  test('S3. 고객 화면 — 주문내역', async () => {
    // PHP 축(테마) — SPA 와 다른 렌더 경로라 함께 본다.
    await visit(customer, '/shop/orderinquiry.php', 'orderinquiry', 'Z03-customer');
    const mine = results.filter((r) => r.path.startsWith('/shop'));
    const broken = mine.filter((r) => r.http5xx > 0 || r.len < 50);
    expect(
      broken.map((b) => `${b.path}(len=${String(b.len)} 5xx=${String(b.http5xx)})`),
      '고객 화면 이상 없음',
    ).toEqual([]);
    F('S3', 'obs', `고객 화면 ${String(mine.length)}건 렌더 — 5xx 0`);
  }, 300_000);

  test('S4. 전수 요약', async () => {
    const total = results.length;
    const withErr = results.filter((r) => r.errors > 0).length;
    const with5xx = results.filter((r) => r.http5xx > 0).length;
    const thin = results.filter((r) => r.len < 100).length;
    F(
      'S4',
      'obs',
      `전수 ${String(total)}화면 — pageerror ${String(withErr)} · 5xx ${String(with5xx)} · ` +
        `빈 화면 ${String(thin)} · 목록 [${results.map((r) => `${r.path}:${String(r.len)}`).join(' · ')}]`,
    );
    expect(withErr + with5xx, '전수 이상 0').toBe(0);
  }, 180_000);
});
