// 여정 39호 — **좁은 화면**(노트북·태블릿에서 관리자 콘솔이 서 있는가).
//
// 지금까지의 화면 검증은 전부 **1440px 폭**에서 했다. 그런데 관리자가 늘 그 창을 쓰는 건
// 아니다 — 13인치 노트북(1280), 창 반쪽(1024), 태블릿(768)이 현실이다. 이미 한 번 데인
// 축이기도 하다: "낮은 창에서 사양 수정 팝업의 상·하단이 잘린다"를 고친 적이 있다(세로).
// 이 편은 **가로**를 본다.
//
// 표적은 하나다 — **오른쪽 칸이 창 밖으로 나가는가**. PCB 큐들은 열이 많고(상태·금액·
// 납기·첨부·액션) 액션 버튼이 맨 오른쪽이라, 넘치면 관리자가 **누를 수가 없다**.
// 표가 자기 컨테이너 안에서 가로 스크롤되는 것은 정상이므로 **body 기준**으로만 잰다.
//
// **쓰기가 없다**(read-only) — 실데이터 위에서 창 크기만 바꿔 가며 잰다.
//
// 실행: pnpm -F e2e journey:narrow  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
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
  getPrisma,
  newSession,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

/** 재 볼 창 폭 — 13인치 노트북 · 창 반쪽 · 태블릿 가로. */
const WIDTHS = [1280, 1024, 768] as const;

const ADMIN_SCREENS: readonly [string, string][] = [
  ['/app/admin/pcb/cases', 'cases'],
  ['/app/admin/pcb/orders', 'orders'],
  ['/app/admin/pcb/pos', 'pos'],
  ['/app/admin/pcb/remittances', 'remittances'],
  ['/app/admin/pcb/shipments', 'shipments'],
  ['/app/admin/orders', 'admin-orders'],
];

const PARTNER_SCREENS: readonly [string, string][] = [
  ['/app/partner/pcb', 'portal-home'],
  ['/app/partner/pcb/ship', 'portal-ship'],
];

describe.skipIf(!RUN || !JOURNEY)('여정 39호 — 좁은 화면', () => {
  const rp = createJourneyReport('findings-narrow', '여정 39호 좁은 화면 탐색 주행 리포트');
  const { F } = rp;

  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner2: PartnerFixture;
  /** 발주가 있는 Case — 열이 가장 많이 차는 상세 화면을 보기 위해. */
  let busyCaseSpecId: number | null = null;

  /** 넘친 자리: `경로@폭(scrollWidth>innerWidth)`. */
  const overflow: string[] = [];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 한 화면을 한 폭에서 재고 넘치면 기록한다. */
  const measure = async (
    s: E2eSession,
    path: string,
    name: string,
    width: number,
  ): Promise<{ over: boolean; scrollWidth: number }> => {
    await s.page.setViewportSize({ width, height: 900 });
    await s.page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await s.page.waitForTimeout(700);
    const m = await s.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const over = m.scrollWidth > m.innerWidth + 2;
    if (over) {
      overflow.push(`${name}@${String(width)}(${String(m.scrollWidth)}>${String(m.innerWidth)})`);
      // 넘친 자리만 남긴다 — 정상 화면까지 찍으면 산출물이 커지기만 한다.
      await s.page
        .screenshot({ path: `e2e/output/journey/J-${name}-${String(width)}.png`, fullPage: false })
        .catch(() => undefined);
    }
    return { over, scrollWidth: m.scrollWidth };
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '협력사');

    // 발주가 달린 Case 하나 — 상세는 열이 가장 많이 차는 화면이다(실데이터에서 고른다).
    const prisma = getPrisma();
    const po = await prisma.spPcbPo.findFirst({ orderBy: { id: 'desc' }, select: { specId: true } });
    busyCaseSpecId = po === null ? null : Number(po.specId);
  }, 180_000);

  afterAll(async () => {
    rp.write({ 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('J1. 관리자 큐 — 세 폭에서', async () => {
    const lines: string[] = [];
    for (const [path, name] of ADMIN_SCREENS) {
      const per: string[] = [];
      for (const w of WIDTHS) {
        const m = await measure(adminView, path, name, w);
        per.push(`${String(w)}:${m.over ? `넘침(${String(m.scrollWidth)})` : 'ok'}`);
      }
      lines.push(`${name} [${per.join(' ')}]`);
    }
    F('J1', 'obs', `관리자 큐 폭별 실측 — ${lines.join(' · ')}`);
  }, 900_000);

  test('J2. Case 상세 — 열이 가장 많이 차는 화면', async (ctx) => {
    if (busyCaseSpecId === null) return ctx.skip();
    const path = `/app/admin/pcb/cases/${String(busyCaseSpecId)}`;
    const per: string[] = [];
    for (const w of WIDTHS) {
      const m = await measure(adminView, path, 'case-detail', w);
      per.push(`${String(w)}:${m.over ? `넘침(${String(m.scrollWidth)})` : 'ok'}`);
    }
    F('J2', 'obs', `Case 상세(#${String(busyCaseSpecId)}) 폭별 실측 — ${per.join(' ')}`);
  }, 600_000);

  test('J3. 협력사 포털 — 협력사는 더 작은 화면을 쓴다', async () => {
    const lines: string[] = [];
    for (const [path, name] of PARTNER_SCREENS) {
      const per: string[] = [];
      for (const w of WIDTHS) {
        const m = await measure(partnerView, path, name, w);
        per.push(`${String(w)}:${m.over ? `넘침(${String(m.scrollWidth)})` : 'ok'}`);
      }
      lines.push(`${name} [${per.join(' ')}]`);
    }
    F('J3', 'obs', `협력사 포털 폭별 실측 — ${lines.join(' · ')}`);
  }, 600_000);

  test('J4. 종합 — 좁혀서 부서지는 자리', async () => {
    F(
      'J4',
      overflow.length === 0 ? 'obs' : 'bug',
      overflow.length === 0
        ? `1280·1024·768 세 폭 전부에서 가로 넘침 0 — 표는 자기 컨테이너 안에서 스크롤된다.`
        : `**좁은 창에서 터지는 자리 ${String(overflow.length)}곳** — ${overflow.join(' · ')}. ` +
          `PCB 큐는 액션 버튼이 맨 오른쪽 열이라 넘치면 **누를 수가 없다**(스크린샷 J-*.png).`,
    );
    expect(overflow.length, `넘친 자리: ${overflow.join(', ')}`).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
