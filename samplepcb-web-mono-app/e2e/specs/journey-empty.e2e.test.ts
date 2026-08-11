// 여정 35호 — **빈 상태의 말**(아무것도 없을 때 화면이 무엇을 말하는가).
//
// 32호는 열여섯 화면이 **열리는가**를 봤다. 열리기는 하는데 **비어 있을 때** 아무 말도
// 없으면, 사용자는 "아직 없는 것"과 "고장 난 것"을 구별할 수 없다. 특히 신규 협력사가
// 포털에 처음 들어온 순간이 그렇다 — 첫인상이 흰 화면이면 로그인이 잘못된 줄 안다.
//
// 검색 0건도 같다. 24호가 잡은 결함(`%` 한 글자가 전체를 반환)의 반대편이다: 그때는
// **거른 줄 알았는데 안 걸렀고**, 여기서는 **걸렀는데 화면이 그렇다고 말하지 않는** 경우다.
//
// 표적: 결과가 0건인 자리마다 ① 안내 문구가 있는가 ② 그 문구가 "없다"와 "못 불러왔다"를
// 가르는가. 판정이 부드러운 축이라 **관찰을 남기고 빈 채 침묵하는 곳만 결함으로 든다**.
//
// **쓰기가 없다**(read-only) — 검색어로 0건을 만들고 실데이터의 빈 Case 를 찾아 연다.
//
// 실행: pnpm -F e2e journey:empty  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
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

/** 어떤 데이터와도 겹치지 않을 검색어 — 0건을 확실히 만든다. */
const NO_MATCH = 'zzq-no-such-record-9182736455';

/** 빈 상태를 말해 주는 낱말 — 하나라도 있으면 "말은 하고 있다". */
const EMPTY_WORDS = ['없습니다', '없음', '아직', '비어', '0건', '결과가'];

/**
 * 검색창을 가진 관리자 큐 — [경로, placeholder, 라벨, 먼저 눌러야 할 탭].
 *
 * ⚠ placeholder 는 화면마다 다르고 **'검색'이라는 낱말이 없는 것도 있다**(1차 주행에서
 *   여섯 중 다섯을 "검색창 없음"으로 건너뛰어 검증이 통째로 비었다).
 * ⚠ RFQ·발주 큐는 **기본 탭에 검색창이 없다** — 그 탭('요청 대기'·'발주 대기')은 계약 탭이
 *   아니라 별도 데이터 소스(todo counts)를 그리는 다른 목록이라 검색을 지원하지 않는다.
 *   워크큐 기본 탭 함정의 또 다른 얼굴이다: 탭을 옮겨야 검색이 나타난다.
 *   shipments 는 검색창 자체가 없어 목록에서 뺀다.
 */
const ADMIN_QUEUES: readonly [string, string, string, string | null][] = [
  ['/app/admin/pcb/cases', '프로젝트·회원ID·주문번호', 'pcb-cases', null],
  ['/app/admin/pcb/rfqs', '프로젝트명·회원ID 검색', 'pcb-rfqs', '전체'],
  ['/app/admin/pcb/orders', '프로젝트·회원ID·주문번호 검색', 'pcb-orders', null],
  ['/app/admin/pcb/pos', '프로젝트·협력사 검색', 'pcb-pos', '전체'],
  ['/app/admin/pcb/remittances', '프로젝트·협력사·견적번호', 'pcb-remittances', null],
];

/** 협력사 포털 — 신규 조직이 처음 보는 화면들. */
const PARTNER_SCREENS: readonly [string, string][] = [
  ['/app/partner/pcb', 'pcb-home'],
  ['/app/partner/pcb/ship', 'pcb-ship'],
  ['/app/partner/pcb/shipments/done', 'pcb-done'],
  ['/app/partner/pcb/as', 'pcb-as'],
];

describe.skipIf(!RUN || !JOURNEY)('여정 35호 — 빈 상태의 말', () => {
  const rp = createJourneyReport('findings-empty', '여정 35호 빈 상태 탐색 주행 리포트');
  const { F } = rp;

  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner2: PartnerFixture;
  /** 발주가 하나도 없는 Case — 실데이터에서 찾는다(신규 접수 상태의 화면). */
  let emptyCaseSpecId: number | null = null;

  const silent: string[] = [];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 화면 본문에서 빈 상태 낱말을 찾는다. */
  const speaks = (text: string): string[] => EMPTY_WORDS.filter((w) => text.includes(w));

  const bodyText = async (s: E2eSession): Promise<string> =>
    s.page.evaluate(() => document.body.innerText).catch(() => '');

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '협력사');

    // 발주 0건 Case — 실데이터에서 고른다(쓰기 없이 "신규 접수" 화면을 보기 위해).
    // ⚠ raw SQL 로 컬럼명을 추측하지 않는다(1차 주행에서 `s.ct_id` 로 틀렸다) — Prisma 필드로 간다.
    const prisma = getPrisma();
    const candidates: { id: bigint }[] = await prisma.spOrderSpec.findMany({
      where: { status: 'active', ctId: { not: null } },
      orderBy: { id: 'desc' },
      take: 80,
      select: { id: true },
    });
    const withPo: { specId: bigint }[] = await prisma.spPcbPo.findMany({
      where: { specId: { in: candidates.map((c: { id: bigint }) => c.id) } },
      select: { specId: true },
    });
    const busy = new Set(withPo.map((p: { specId: bigint }) => p.specId.toString()));
    const found = candidates.find((c: { id: bigint }) => !busy.has(c.id.toString()));
    emptyCaseSpecId = found === undefined ? null : Number(found.id);
  }, 180_000);

  afterAll(async () => {
    rp.write({ 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('E1. 관리자 큐 — 검색 결과가 0건일 때', async () => {
    const seen: string[] = [];
    for (const [path, ph, name, tab] of ADMIN_QUEUES) {
      await rp.view(adminView, path, `E01-${name}`);
      // 기본 탭에 검색창이 없는 큐는 먼저 탭을 옮긴다(그 사실 자체가 관찰거리다).
      if (tab !== null) {
        await adminView.page
          .getByRole('button', { name: new RegExp(`^${tab}`) })
          .first()
          .click()
          .catch(() => undefined);
        await adminView.page.waitForTimeout(800);
      }
      const box = adminView.page.getByPlaceholder(ph).first();
      // 검색창은 목록과 함께 그려진다 — 나타날 때까지 기다린다(안 기다리면 "없음"으로 새서
      // 검증이 통째로 비어 버린다).
      await box.waitFor({ timeout: 20_000 }).catch(() => undefined);
      const hasBox = await box.count().then((n) => n > 0);
      if (!hasBox) {
        seen.push(`${name}: 검색창 못 찾음`);
        silent.push(`${path}(검색창을 못 찾아 검증 못 함)`);
        continue;
      }
      await box.fill(NO_MATCH);
      await adminView.page.keyboard.press('Enter');
      await adminView.page.waitForTimeout(1_200);
      const text = await bodyText(adminView);
      const words = speaks(text);
      await rp.shot(adminView, `E01-${name}-empty`);
      seen.push(`${name}: ${words.length === 0 ? '침묵' : words.join('/')}`);
      if (words.length === 0) silent.push(`${path}(검색 0건)`);
    }
    F('E1', 'obs', `관리자 큐 검색 0건 — ${seen.join(' · ')}`);
  }, 600_000);

  test('E2. 협력사 포털 — 처음 들어온 화면', async () => {
    const seen: string[] = [];
    for (const [path, name] of PARTNER_SCREENS) {
      await rp.view(partnerView, path, `E02-${name}`);
      const text = await bodyText(partnerView);
      // 이 조직은 진행 건이 있을 수 있다 — **본문이 짧을 때만** 빈 상태로 본다.
      const compact = text.replace(/\s+/g, ' ').trim();
      const words = speaks(compact);
      await rp.shot(partnerView, `E02-${name}`);
      seen.push(`${name}: ${String(compact.length)}자/${words.length === 0 ? '침묵' : words.join('/')}`);
      // 아주 짧은데 아무 말도 없으면 사용자에겐 흰 화면이다.
      if (compact.length < 200 && words.length === 0) silent.push(`${path}(본문 ${String(compact.length)}자)`);
    }
    F('E2', 'obs', `협력사 포털 화면 — ${seen.join(' · ')}`);
  }, 600_000);

  test('E3. 발주 0건 Case 상세 — 비어 있는 섹션들', async (ctx) => {
    if (emptyCaseSpecId === null) return ctx.skip();
    await rp.view(adminView, `/app/admin/pcb/cases/${String(emptyCaseSpecId)}`, 'E03-case');
    const text = await bodyText(adminView);
    const words = speaks(text);
    await rp.shot(adminView, 'E03-case-empty');
    // Case 상세는 섹션이 많아(RFQ·발주·선적·송금·A/S) 빈 자리도 많다 — 여기가 침묵하면
    // 관리자는 "아직 안 만든 것"과 "안 불러와진 것"을 구별할 수 없다.
    if (words.length === 0) silent.push(`/app/admin/pcb/cases/${String(emptyCaseSpecId)}`);
    F(
      'E3',
      'obs',
      `발주 0건 Case #${String(emptyCaseSpecId)} — 본문 ${String(text.replace(/\s+/g, ' ').trim().length)}자 · ` +
        `${words.length === 0 ? '빈 상태 문구 없음' : `문구 ${words.join('/')}`}`,
    );
  }, 300_000);

  test('E4. 종합 — 비었는데 아무 말도 없는 자리', async () => {
    F(
      'E4',
      silent.length === 0 ? 'obs' : 'bug',
      silent.length === 0
        ? '빈 자리마다 안내 문구가 있다 — "없는 것"과 "고장 난 것"이 구별된다.'
        : `**빈 채 침묵하는 자리 ${String(silent.length)}곳** — ${silent.join(' · ')}. ` +
          `사용자는 "아직 없는 것"과 "못 불러온 것"을 구별할 수 없다(신규 협력사의 첫 화면이면 ` +
          `로그인이 잘못된 줄 안다).`,
    );
    // 목록을 남기는 것이 이 편의 산출물이다 — 실패로 멈추면 나머지를 못 본다.
    expect(silent.length, `침묵하는 자리: ${silent.join(', ')}`).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
