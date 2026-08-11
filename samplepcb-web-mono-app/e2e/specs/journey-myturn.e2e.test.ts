// 여정 42호 — **"내 차례"의 정확성**(협력사 보드가 시키는 일이 진짜 내 일인가).
//
// 협력사가 매일 처음 보는 화면은 포털 보드다. 거기 네 칸이 "지금 당신이 할 일"을 말한다 —
// 회신할 견적 · 진행할 발주 · 보낼 물건 · 진행 중 발송. 그 숫자가 틀리면 두 방향으로 아프다:
//   · **부풀면** 내 차례가 아닌 건(관리자 승인 대기 등)을 열었다가 할 게 없어 돌아온다
//   · **모자라면** 내 차례인 건을 못 보고 며칠 묵힌다 — 협력사는 재촉을 받고서야 안다
//
// 23호가 관리자 큐의 `counts` 정합을 봤다면 이 편은 **협력사 쪽 같은 물음**이다. 다만
// 판정 기준이 다르다: 관리자 큐는 "탭 합 = 전체"였지만, 보드는 **상태 기계의 주체**가
// 기준이다(PCB_EQ_FORWARD 의 actor 가 RECEIVER 인 단계만 협력사 차례다).
//
// **쓰기가 없다**(read-only) — 협력2가 이미 여러 상태의 발주를 갖고 있어 실데이터로 잰다.
//
// 실행: pnpm -F e2e journey:myturn  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newSession,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

/** 협력사(수주자)가 실제로 움직일 수 있는 발주 상태 — PCB_EQ_FORWARD 의 actor='RECEIVER'. */
const RECEIVER_STATUSES = new Set(['issued', 'eq_done', 'producing']);
/** 관리자 차례 — 협력사 보드의 '진행할 발주'에 서면 안 되는 상태. */
const ORDERER_STATUSES = new Set(['eq_requested']);

describe.skipIf(!RUN || !JOURNEY)('여정 42호 — 내 차례의 정확성', () => {
  const rp = createJourneyReport('findings-myturn', '여정 42호 내 차례 탐색 주행 리포트');
  const { F } = rp;

  let partnerView: E2eSession;
  let partner2: PartnerFixture;
  let P = '';

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
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '협력사');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('P1. 보드가 말하는 "진행할 발주"가 정말 내 차례인가', async () => {
    const r = await api(P, 'GET', '/api/partner/pcb-pos');
    expect(r.status, `포털 발주 목록: ${JSON.stringify(r.json).slice(0, 200)}`).toBe(200);
    const items: any[] = r.json?.data?.items ?? r.json?.data?.myTurn ?? r.json?.data ?? [];
    expect(Array.isArray(items), `응답이 배열: ${JSON.stringify(r.json).slice(0, 200)}`).toBe(true);

    // 수주(received) 방향만 협력사 차례의 대상이다 — 발주(issued) 방향은 MD 로서 남에게 준 것.
    const received = items.filter((i: any) => i.direction === undefined || i.direction === 'received');
    const wrongTurn = received.filter((i: any) => ORDERER_STATUSES.has(String(i.status)));
    const mine = received.filter((i: any) => RECEIVER_STATUSES.has(String(i.status)));

    F(
      'P1',
      'obs',
      `포털 발주 목록 실측 — 전체 ${String(items.length)}건 · 수주 ${String(received.length)}건 · ` +
        `내가 움직일 수 있는 상태 ${String(mine.length)}건 · 관리자 차례(eq_requested) ` +
        `${String(wrongTurn.length)}건이 목록에 함께 온다(목록은 전부 주고 **보드가 골라 세운다**)`,
    );
  }, 300_000);

  test('P2. 화면의 네 칸 숫자와 실제 상태 분포', async () => {
    await rp.view(partnerView, '/app/partner/pcb', 'P02-board');
    await partnerView.page.waitForTimeout(1_500);
    const text = await partnerView.page.evaluate(() => document.body.innerText).catch(() => '');
    await rp.shot(partnerView, 'P02-board');

    // DB 로 실제 분포를 센다 — 화면 숫자의 대조군이다.
    const prisma = getPrisma();
    const pos = await prisma.spPcbPo.findMany({
      where: { partnerId: BigInt(partner2.id) },
      select: { status: true, parentPartnerId: true },
    });
    const byStatus = new Map<string, number>();
    for (const p of pos as { status: string }[]) {
      byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    }
    const receiverCount = (pos as { status: string }[]).filter((p) =>
      RECEIVER_STATUSES.has(p.status),
    ).length;

    // '진행할 발주 (N)' 을 화면 문구에서 뽑는다.
    const m = /진행할 발주 \((\d+)\)/.exec(text);
    const shown = m?.[1] === undefined ? null : Number(m[1]);

    F(
      'P2',
      'obs',
      `보드 실측 — 화면 '진행할 발주' ${shown === null ? '표시 없음' : String(shown)}건 · ` +
        `DB 수주 발주 ${String(pos.length)}건 분포 [${[...byStatus].map(([k, v]) => `${k}:${String(v)}`).join(' ')}] · ` +
        `RECEIVER 차례 상태 합 ${String(receiverCount)}건`,
    );
  }, 300_000);

  test('P3. 상태 기계와 어긋나는 칸이 있는가 — 열어서 확인', async () => {
    // 보드가 세운 건 하나를 실제로 열어 **행동 버튼이 있는지** 본다. 내 차례라고 세웠는데
    // 열었을 때 누를 게 없으면 그 숫자는 거짓말이다(협력사는 헛걸음한다).
    await rp.view(partnerView, '/app/partner/pcb', 'P03-board');
    await partnerView.page.waitForTimeout(1_200);
    const link = partnerView.page.getByRole('link', { name: /진행하기/ }).first();
    const has = await link.count().then((n) => n > 0);
    if (!has) {
      F('P3', 'obs', `보드에 '진행할 발주'가 없어(0건) 열어 볼 대상이 없다 — 이 축은 건너뛴다.`);
      return;
    }
    await link.click();
    await partnerView.page.waitForTimeout(1_500);
    const text = await partnerView.page.evaluate(() => document.body.innerText).catch(() => '');
    await rp.shot(partnerView, 'P03-po-detail');

    // 협력사가 누를 수 있는 전진 버튼(EQ 승인요청·생산 시작·생산 완료) 중 하나는 있어야 한다.
    const actions = ['EQ 승인요청', '생산 시작', '생산 완료', '입고 확인'].filter((w) =>
      text.includes(w),
    );
    F(
      'P3',
      actions.length === 0 ? 'bug' : 'obs',
      actions.length === 0
        ? `**보드가 "진행할 발주"로 세운 건을 열었는데 누를 버튼이 없다** — 협력사는 시킨 대로 ` +
          `들어왔다가 할 일을 못 찾는다.`
        : `열어 본 결과 실측 — 행동 버튼 ${actions.join('/')} 존재(보드가 세운 것이 실제 내 차례다)`,
    );
  }, 300_000);
});
