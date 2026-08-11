// 여정 24호 — **검색 정확성**(찾는 것을 찾고, 아닌 것은 안 찾는가).
//
// 23호가 "숫자가 맞는가"였다면 이 편은 **"검색이 맞는 것을 찾는가"**다. 관리자가 주문번호로
// 검색했는데 안 나오면 그 건을 영영 못 찾고, 반대로 엉뚱한 게 섞이면 목록을 믿을 수 없다.
//
// 표적:
//   ① **정확·부분 일치** — 프로젝트명·회원ID·주문번호 어느 키로든 자기 건을 찾는다.
//   ② **없는 것은 0건** — 검색이 조용히 전체를 돌려주면 "찾았다"고 오해한다.
//   ③ **와일드카드 문자**(이 편의 표적) — LIKE 검색은 `%`·`_` 를 패턴으로 읽는다. escape 하지
//      않으면 `%` 한 글자가 **전체를 반환**하고, `_` 는 "임의의 한 글자"가 된다. 이 트랙의
//      프로젝트명은 **업로드 파일명**이라 `_` 가 흔하다(DDC_ESP32.zip·TEL_SUB.zip) — 실무에서
//      바로 오탐이 난다. 같은 파일(g5-db.ts)에 `escapeLike` 가 있고 회원·주문 검색은 쓰는데
//      PCB 큐 검색 두 곳만 빠져 있었다.
//   ④ **검색 × 탭은 교집합** — 검색이 탭을 무시하고 전체에서 찾으면 분류가 무의미해진다.
//
// **쓰기가 없다**(read-only) — 실데이터 모수(2만여 건) 위에서 검색만 두드린다. 시드 몇 건으로는
// "전체가 나온다"를 구별할 수 없다.
//
// 실행: pnpm -F e2e journey:search  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
    RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  signJwt,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

describe.skipIf(!RUN || !JOURNEY)('여정 24호 — 검색 정확성', () => {
  const rp = createJourneyReport('findings-search', '여정 24호 검색 정확성 탐색 주행 리포트');
  const { F } = rp;

  let A = '';
  /** 실데이터에서 고른 표본 — 이름·회원·주문번호가 다 있는 건. */
  let sample: { specId: number; projectName: string; mbId: string; odId: string } | null = null;
  let totalAll = 0;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 주문·결제 큐 검색 — 세 키(프로젝트명·회원ID·주문번호)를 한 번에 훑는 자리다. */
  const search = async (q: string, tab = 'all'): Promise<{ total: number; items: any[] }> => {
    const res = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=${tab}&page=1&pageSize=100&q=${encodeURIComponent(q)}`,
    );
    expect(res.status, `검색("${q}"): ${JSON.stringify(res.json)}`).toBe(200);
    return { total: Number(res.json?.data?.total ?? -1), items: res.json?.data?.items ?? [] };
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });

    // 표본을 실데이터에서 고른다 — 주문이 연결된 활성 스펙 하나.
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT s.id, s.projectName, s.mbId, c.od_id
         FROM sp_order_spec s
         JOIN g5_shop_cart c ON c.ct_id = s.ctId
        WHERE s.status = 'active' AND s.ctId IS NOT NULL AND c.ct_status <> '쇼핑'
          AND s.projectName IS NOT NULL AND s.projectName <> ''
          AND s.mbId IS NOT NULL AND s.mbId <> ''
        ORDER BY s.id DESC
        LIMIT 1`,
    );
    if (rows.length > 0) {
      sample = {
        specId: Number(rows[0].id),
        projectName: String(rows[0].projectName),
        mbId: String(rows[0].mbId),
        odId: String(rows[0].od_id),
      };
    }
    const all = await search('');
    totalAll = all.total;
  }, 120_000);

  afterAll(async () => {
    rp.write({});
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('W1. 세 키로 자기 건을 찾는다', async (ctx) => {
    if (sample === null) return ctx.skip();

    for (const [label, q] of [
      ['프로젝트명', sample.projectName],
      ['회원ID', sample.mbId],
      ['주문번호', sample.odId],
    ] as const) {
      const r = await search(q);
      expect(r.total, `${label} 검색 결과 있음("${q}")`).toBeGreaterThan(0);
      expect(
        r.items.some((i: any) => Number(i.specId) === sample?.specId),
        `${label} 검색에 표본 포함`,
      ).toBe(true);
      // 전체가 그대로 나오면 "검색이 안 걸린 것"이다 — 찾은 게 아니다.
      expect(r.total, `${label} 검색이 전체를 반환하지 않는다`).toBeLessThan(totalAll);
    }
    F(
      'W1',
      'obs',
      `세 키 검색 실측 — 표본 spec=${String(sample.specId)}(${sample.projectName} · ` +
        `${sample.mbId} · ${sample.odId}) 모두 적중 · 전체(${String(totalAll)})보다 좁다`,
    );
  }, 300_000);

  test('W2. 없는 것은 0건', async () => {
    const r = await search('__존재하지않는검색어_zzz9999__');
    expect(r.total, '없는 것은 0건').toBe(0);
    expect(r.items.length, '목록도 비어 있다').toBe(0);
    F('W2', 'obs', `없는 검색어 — 0건(조용히 전체를 돌려주지 않는다)`);
  }, 180_000);

  test('W3. 와일드카드 문자가 패턴으로 새지 않는다', async () => {
    // `%` 는 LIKE 에서 "아무 문자열"이다. escape 하지 않으면 **전체가 나온다** — 검색창에
    // 한 글자를 잘못 넣은 것만으로 목록이 통째로 뒤집힌다.
    const percent = await search('%');
    expect(percent.total, '"%" 검색이 전체를 반환하지 않는다').toBeLessThan(totalAll);

    // `_` 는 "임의의 한 글자"다. 이 트랙의 프로젝트명은 업로드 파일명이라 `_` 가 흔하고,
    // escape 하지 않으면 **다른 이름까지 매치**한다.
    const underscore = await search('_');
    expect(underscore.total, '"_" 검색이 전체를 반환하지 않는다').toBeLessThan(totalAll);

    F(
      'W3',
      'obs',
      `와일드카드 escape 실측 — "%"=${String(percent.total)}건 · "_"=${String(underscore.total)}건 ` +
        `(전체 ${String(totalAll)}건 대비)`,
    );
  }, 300_000);

  test('W4. 검색 × 탭은 교집합이다', async (ctx) => {
    if (sample === null) return ctx.skip();

    const all = await search(sample.odId, 'all');
    expect(all.total, '전체 탭에서 표본 검색').toBeGreaterThan(0);

    // 각 탭의 합이 전체 검색 결과를 넘으면 안 된다(같은 건이 여러 탭에 중복 계상되지 않는다).
    let sum = 0;
    for (const tab of ['awaiting', 'active', 'done', 'canceled'] as const) {
      const r = await search(sample.odId, tab);
      sum += r.total;
      // 탭 안의 결과는 전부 검색어와 맞아야 한다(탭이 검색을 무시하면 안 된다).
      for (const it of r.items) {
        expect(String(it.odId), `${tab} 탭 결과가 검색어와 일치`).toBe(sample.odId);
      }
    }
    expect(sum, '탭별 합 == 전체 탭 결과(배타적 분할)').toBe(all.total);
    F('W4', 'obs', `검색×탭 교집합 실측 — 전체 ${String(all.total)}건 = 탭별 합 ${String(sum)}건`);
  }, 300_000);
});

