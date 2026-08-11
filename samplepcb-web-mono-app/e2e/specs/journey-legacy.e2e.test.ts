// 여정 17호 — **레거시 이관분 접합**(DB 의 대부분은 신규가 아니다).
//
// 앞의 열여섯 편은 전부 **이 주행이 방금 만든 건**을 밟았다. 그런데 실제 DB 는 이관분이
// 압도적이다 — 주문 2만여 건 중 협력 기록 없이 '완료'인 레거시가 19,665건이다. 신규 경로가
// 아무리 튼튼해도, 관리자가 매일 여는 화면에는 그 이관분이 함께 뜬다.
//
// 이 편은 **쓰기를 하지 않는다**(read-only). 실데이터를 건드리지 않고 "이관분이 신규 트랙의
// 화면·판정에 얹혔을 때 깨지지 않는가"만 본다. 표적 넷:
//   ① **_legacy 메타 방어** — 이관 specJson 엔 `_legacy` 객체(내부 id·PII memberContact)가
//      섞여 있다. spec 을 응답에 싣는 라우트가 그대로 흘리면 Fastify 직렬화가 500 을 내고
//      (FST_ERR_RESPONSE_SERIALIZATION), 흘리지 않더라도 **협력사에게 고객 PII 가 샌다**.
//      `stripInternalSpecKeys` 가 그 방어인데, 실데이터로 확인된 적이 없다.
//   ② **대기 큐 제외** — 이관분은 레거시에서 이미 처리됐는데 그 이력은 이관 대상이 아니었다.
//      제외하지 않으면 요청 대기·발주 대기가 영구히 눌러앉아 **실제로 해야 할 몇 건이 묻힌다**
//      (사용자 결정 2026-08-05). 그 규칙이 지금도 사는지 센다.
//   ③ **진행현황에는 보인다** — 제외는 "재촉 목록에서만"이다. 조감·주문 결제에는 그대로
//      보여야 한다(D10 — 필요하면 언제든 소싱을 시작할 수 있어야 하니까).
//   ④ **완료 주문의 게이트** — 이관분 대부분이 '완료'다. RFQ 시작이 어떻게 판정되는가.
//
// 실행: pnpm -F e2e journey:legacy  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요, 쓰기 없음)
// 스크린샷 접두사는 **L** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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
  getPrisma,
  newSession,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

describe.skipIf(!RUN || !JOURNEY)('여정 17호 — 레거시 이관분 접합(read-only)', () => {
  const rp = createJourneyReport('findings-legacy', '여정 17호 레거시 이관분 탐색 주행 리포트');
  const { F } = rp;

  let adminView: E2eSession;
  let A = '';
  /** 이관 스펙 표본 — specJson.$._legacy 가 있는 행. */
  let legacySpecIds: number[] = [];

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

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 120_000);

  afterAll(async () => {
    rp.write({ 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('L1. 이관분 모수 — 무엇이 얼마나 얹혀 있는가', async () => {
    const prisma = getPrisma();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, ctId,
              JSON_UNQUOTE(JSON_EXTRACT(specJson, '$._legacy.stage')) AS stage
         FROM sp_order_spec
        WHERE JSON_EXTRACT(specJson, '$._legacy') IS NOT NULL
          AND status = 'active'
        ORDER BY id DESC
        LIMIT 200`,
    );
    // 이관분이 없는 환경(초기화된 dev)이라면 이 편은 검증할 대상 자체가 없다 — 그 사실을
    // 조용히 통과시키지 말고 리포트에 남긴다(다음 사람이 "왜 green 인지" 알아야 한다).
    if (rows.length === 0) {
      F('L1', 'obs', '이관분 0건 — 이 DB 에는 레거시 스펙이 없다(검증 대상 없음, 이하 skip).');
      return;
    }
    legacySpecIds = rows.slice(0, 8).map((r) => Number(r.id));
    const withOrder = rows.filter((r) => r.ctId !== null).length;
    const stages = [...new Set(rows.map((r) => String(r.stage ?? '—')))];
    F(
      'L1',
      'obs',
      `이관 스펙 표본 ${String(rows.length)}건(최신순 200 한도) — 주문 연결 ${String(withOrder)}건 · ` +
        `stage 종류 [${stages.join(', ')}] · 상세 검증 표본 ${String(legacySpecIds.length)}건`,
    );
  }, 120_000);

  test('L2. _legacy 메타 방어 — 상세 응답이 500 없이, PII 없이 나오는가', async (ctx) => {
    if (legacySpecIds.length === 0) return ctx.skip();

    let ok = 0;
    const failures: string[] = [];
    for (const specId of legacySpecIds) {
      // 발주 패널(spec 을 응답에 싣는 대표 라우트) — 여기가 이관 메타를 그대로 흘리면
      // 직렬화에서 죽는다(FST_ERR_RESPONSE_SERIALIZATION).
      const res = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/pos`);
      if (res.status !== 200) {
        failures.push(`spec ${String(specId)} → ${String(res.status)} ${JSON.stringify(res.json)}`);
        continue;
      }
      ok += 1;
      // 응답 어디에도 내부 메타가 남으면 안 된다 — 이 응답은 협력사 화면의 재료이기도 하다.
      const raw = JSON.stringify(res.json);
      expect(raw.includes('_legacy'), `spec ${String(specId)} — _legacy 소거`).toBe(false);
      expect(raw.includes('memberContact'), `spec ${String(specId)} — PII 키 소거`).toBe(false);
    }
    expect(failures, `이관 스펙 상세가 500 없이 열려야 한다`).toEqual([]);
    F(
      'L2',
      'obs',
      `_legacy 방어 실측 — 이관 스펙 ${String(ok)}건 상세 200 · 응답에 _legacy·memberContact 0건 ` +
        `(stripInternalSpecKeys 가 실데이터에서 동작).`,
    );
  }, 300_000);

  test('L3. 대기 큐는 이관분을 세지 않는다 — 진짜 할 일이 묻히지 않게', async (ctx) => {
    if (legacySpecIds.length === 0) return ctx.skip();
    const prisma = getPrisma();

    // 대기 큐(요청 대기·발주 대기)의 모수에 이관분이 섞이면, 레거시에서 이미 끝난 수백 건이
    // 영구히 눌러앉는다(사용자 결정 2026-08-05 — 제외는 "재촉 목록에서만").
    // counts 는 별도 라우트가 아니라 목록 응답에 함께 실린다.
    const todoRfq = await api(A, 'GET', '/api/admin/pcb-cases?tab=todo_rfq&page=1&pageSize=100');
    expect(todoRfq.status, JSON.stringify(todoRfq.json)).toBe(200);
    const todoIds = (todoRfq.json?.data?.items ?? []).map((i: any) => Number(i.specId));

    // 표본이 아니라 **큐에 실제로 뜬 것 전부**를 검사한다(표본만 보면 빠져나갈 수 있다).
    const legacyInQueue =
      todoIds.length === 0
        ? []
        : ((await prisma.$queryRawUnsafe(
            `SELECT id FROM sp_order_spec
              WHERE id IN (${todoIds.map((n: number) => String(n)).join(',')})
                AND JSON_EXTRACT(specJson, '$._legacy') IS NOT NULL`,
          )) as any[]);
    expect(legacyInQueue.length, '요청 대기 큐에 이관분 0건').toBe(0);
    F(
      'L3',
      'obs',
      `대기 큐 제외 실측 — todo_rfq ${String(todoIds.length)}건 중 이관분 0건 ` +
        `(NOT_LEGACY 조건이 산다).`,
    );
  }, 240_000);

  test('L4. 진행현황·주문 결제에는 보인다 — 제외는 재촉 목록에서만', async (ctx) => {
    if (legacySpecIds.length === 0) return ctx.skip();

    // 같은 이관 스펙이 조감(all)에는 떠야 한다 — 안 보이면 "필요하면 언제든 소싱 시작"
    // (D10)이 불가능해진다. 검색으로 한 건을 정확히 집는다.
    const target = legacySpecIds[0] ?? 0;
    const all = await api(A, 'GET', `/api/admin/pcb-cases?tab=all&page=1&pageSize=100&q=${String(target)}`);
    expect(all.status, JSON.stringify(all.json)).toBe(200);
    const found = (all.json?.data?.items ?? []).some((i: any) => Number(i.specId) === target);
    expect(found, `이관 스펙 ${String(target)} 이 조감(all)에는 보인다`).toBe(true);
    F('L4', 'obs', `조감 노출 실측 — 이관 스펙 ${String(target)} 이 all 탭에 존재(제외는 재촉 목록 한정).`);
  }, 240_000);

  test('L5. 화면 — 이관 Case 를 열어도 깨지지 않는가', async (ctx) => {
    if (legacySpecIds.length === 0) return ctx.skip();
    const target = legacySpecIds[0] ?? 0;

    await rp.view(adminView, `/app/admin/pcb/cases/${String(target)}`, 'L05-legacy-case');
    const text = await bodyTextOf(adminView);
    // 빈 화면(라우트 실패)·오류 문구가 아니라 Case 가 실제로 그려져야 한다.
    expect(text.length, '이관 Case 화면이 비어 있지 않다').toBeGreaterThan(200);
    expect(text.includes('_legacy'), '화면에 내부 메타 노출 없음').toBe(false);
    F(
      'L5',
      'obs',
      `이관 Case 화면 실측 — spec ${String(target)} 렌더 ${String(text.length)}자 · 내부 메타 비노출`,
    );
  }, 240_000);
});
