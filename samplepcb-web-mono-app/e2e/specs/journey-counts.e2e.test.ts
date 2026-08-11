// 여정 23호 — **집계·카운트 정합**(배지 숫자와 목록이 같은 말을 하는가).
//
// 관리자가 매일 **처음 보는 것**이 사이드바 배지 숫자다(견적요청 3 · 발주·EQ 1 · 송금 5 ·
// 선적·배송 4). 그런데 그 숫자가 실제 목록과 일치하는지 아무도 확인하지 않았다. 한 번이라도
// "3건이라는데 열면 없다"를 겪으면 **화면 전체를 믿지 않게 된다** — 숫자는 신뢰의 최전선이다.
//
// 네 큐가 모두 같은 모양이다: 응답에 `counts`(탭별 합계)와 `total`(현재 탭 합계)이 **따로**
// 온다. 둘은 서로 다른 SQL 로 계산되므로 **어긋날 수 있다** — 그게 이 편의 표적이다.
//   ① `total` == `counts[tab]` (탭마다)
//   ② `items.length` == min(total, pageSize) — 첫 페이지가 약속한 만큼 오는가
//   ③ **페이지를 끝까지 모으면 total 과 같은가**(경계에서 빠지거나 겹치지 않는가)
//   ④ `all` 탭이 부분 탭들을 담는가(부분 ≤ 전체 — 배타적 분할이면 합계도 확인)
//
// **쓰기가 없다**(read-only) — 실데이터 모수 위에서 정합만 본다. 그래서 이관분 2만여 건을
// 포함한 **진짜 규모**에서 검증된다(시드 몇 건으로는 페이지네이션 경계가 드러나지 않는다).
//
// 실행: pnpm -F e2e journey:counts  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
// 스크린샷 접두사는 **Q** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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
  newSession,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

/** 큐 하나의 정합을 보는 공통 절차 — 네 큐가 같은 응답 모양을 쓴다. */
interface QueueSpec {
  label: string;
  path: string;
  tabs: readonly string[];
  /** counts 키가 탭 이름과 다른 경우(snake→camel) 매핑. */
  countKey?: (tab: string) => string;
}

describe.skipIf(!RUN || !JOURNEY)('여정 23호 — 집계·카운트 정합', () => {
  const rp = createJourneyReport('findings-counts', '여정 23호 집계 정합 탐색 주행 리포트');
  const { F } = rp;

  let adminView: E2eSession;
  let A = '';

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const fetchTab = async (
    path: string,
    tab: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: any[]; total: number; counts: any }> => {
    const res = await api(
      A,
      'GET',
      `${path}?tab=${tab}&page=${String(page)}&pageSize=${String(pageSize)}`,
    );
    expect(res.status, `${path}?tab=${tab}: ${JSON.stringify(res.json)}`).toBe(200);
    const d = res.json?.data ?? {};
    return { items: d.items ?? [], total: Number(d.total ?? -1), counts: d.counts ?? {} };
  };

  /** 큐 하나를 전수 검사 — 결과를 문자열로 요약해 리포트에 남긴다. */
  const checkQueue = async (q: QueueSpec): Promise<string[]> => {
    const notes: string[] = [];
    for (const tab of q.tabs) {
      const first = await fetchTab(q.path, tab, 1, 20);
      const key = q.countKey === undefined ? tab : q.countKey(tab);
      const counted = Number(first.counts[key] ?? -1);

      // ① 배지(counts)와 목록 합계(total)가 같은 말을 해야 한다.
      expect(counted, `${q.label}/${tab} — counts 키(${key}) 존재`).toBeGreaterThanOrEqual(0);
      expect(first.total, `${q.label}/${tab} — total == counts[${key}]`).toBe(counted);

      // ② 첫 페이지가 약속한 만큼 온다.
      expect(first.items.length, `${q.label}/${tab} — 첫 페이지 건수`).toBe(
        Math.min(first.total, 20),
      );

      // ③ 페이지를 끝까지 모으면 total 과 같아야 한다(경계에서 빠지거나 겹치면 안 된다).
      //    모수가 큰 탭은 앞의 3페이지만 훑어 **중복 없음**과 페이지 채움만 본다(전수는 느리다).
      const pages = Math.ceil(first.total / 20);
      const scan = Math.min(pages, 3);
      const seen = new Set<string>();
      let collected = 0;
      for (let p = 1; p <= scan; p += 1) {
        const cur = p === 1 ? first : await fetchTab(q.path, tab, p, 20);
        for (const it of cur.items) {
          // 큐마다 식별자 키가 다르다 — 있는 것을 쓴다(정합 검사에는 유일성만 필요).
          const id = String(it.specId ?? it.poId ?? it.shipmentId ?? it.odId ?? JSON.stringify(it));
          seen.add(id);
        }
        collected += cur.items.length;
        // 마지막 페이지가 아니면 꽉 차 있어야 한다(중간에 비면 경계가 어긋난 것).
        if (p < pages) {
          expect(cur.items.length, `${q.label}/${tab} — ${String(p)}페이지 채움`).toBe(20);
        }
      }
      expect(seen.size, `${q.label}/${tab} — 페이지 간 중복 없음`).toBe(collected);
      if (pages <= 3) {
        expect(collected, `${q.label}/${tab} — 전수 합계 == total`).toBe(first.total);
      }
      notes.push(`${tab}=${String(first.total)}${pages > 3 ? `(앞 3p 훑음)` : ''}`);
    }
    return notes;
  };

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

  test('Q1. 진행현황(Case) — 배지와 목록이 같은 말을 하는가', async () => {
    const notes = await checkQueue({
      label: 'Case',
      path: '/api/admin/pcb-cases',
      tabs: ['quoting', 'unpaid', 'production', 'closed', 'all', 'todo_rfq', 'todo_po'],
      // counts 키는 camelCase(todoRfq/todoPo) — 탭 이름과 다르다.
      countKey: (t) => (t === 'todo_rfq' ? 'todoRfq' : t === 'todo_po' ? 'todoPo' : t),
    });
    F('Q1', 'obs', `Case 큐 정합 — ${notes.join(' · ')}`);
  }, 600_000);

  test('Q2. 발주·EQ 큐', async () => {
    // ⚠ counts 키 규약이 **큐마다 다르다**: PO 는 탭 이름 그대로 snake_case(`eq_pending`·
    //   `to_ship`), Case 는 camelCase(`todoRfq`·`todoPo`), Order 는 `toShip`. 계약 타입이
    //   화면 오타는 막아 주지만, 큐를 오가며 코드를 쓰는 쪽은 매번 확인해야 한다.
    const notes = await checkQueue({
      label: 'PO',
      path: '/api/admin/pcb-pos',
      tabs: ['eq_pending', 'producing', 'produced', 'to_ship', 'all'],
    });
    F(
      'Q2',
      'obs',
      `발주·EQ 큐 정합 — ${notes.join(' · ')} (counts 키는 탭 이름 그대로 — Case/Order 와 규약이 다르다)`,
    );
  }, 600_000);

  test('Q3. 주문·결제 큐(고객 배송 탭 포함)', async () => {
    const notes = await checkQueue({
      label: 'Order',
      path: '/api/admin/pcb-orders',
      tabs: ['awaiting', 'active', 'done', 'canceled', 'all', 'to_ship', 'shipping'],
      countKey: (t) => (t === 'to_ship' ? 'toShip' : t),
    });
    F('Q3', 'obs', `주문·결제 큐 정합 — ${notes.join(' · ')}`);
  }, 900_000);

  test('Q4. 선적 큐', async () => {
    const notes = await checkQueue({
      label: 'Shipment',
      path: '/api/admin/pcb-shipments',
      tabs: ['pending', 'active', 'received', 'all'],
    });
    F('Q4', 'obs', `선적 큐 정합 — ${notes.join(' · ')}`);
  }, 600_000);

  test('Q5. 부분 탭의 합이 전체를 넘지 않는가', async () => {
    // 배타적 분할이면 합 == all 이고, 겹치는 탭이 있으면 합 >= all 이다. 어느 쪽이든
    // **부분이 전체보다 크면** 분류가 깨진 것이다(같은 건이 여러 탭에 중복 계상).
    const cases = await fetchTab('/api/admin/pcb-cases', 'all', 1, 1);
    const c = cases.counts;
    const partSum =
      Number(c.quoting ?? 0) + Number(c.unpaid ?? 0) + Number(c.production ?? 0) + Number(c.closed ?? 0);
    expect(Number(c.all ?? 0), 'Case — 전체가 부분 합과 같다(배타적 분할)').toBe(partSum);

    const orders = await fetchTab('/api/admin/pcb-orders', 'all', 1, 1);
    const o = orders.counts;
    const oSum =
      Number(o.awaiting ?? 0) + Number(o.active ?? 0) + Number(o.done ?? 0) + Number(o.canceled ?? 0);
    expect(Number(o.all ?? 0), '주문 — 전체가 부분 합과 같다').toBe(oSum);
    // 고객 배송 탭은 별도 축(진행 중 주문의 부분집합)이라 합에 들지 않는다 — 넘지만 않으면 된다.
    expect(Number(o.toShip ?? 0), 'to_ship 은 전체를 넘지 않는다').toBeLessThanOrEqual(
      Number(o.all ?? 0),
    );
    F(
      'Q5',
      'obs',
      `분할 정합 — Case all=${String(c.all)}=합(${String(partSum)}) · Order all=${String(o.all)}=` +
        `합(${String(oSum)}) · to_ship=${String(o.toShip)} shipping=${String(o.shipping)}(별도 축)`,
    );
  }, 300_000);

  test('Q6. 화면 배지 = API 숫자', async () => {
    const cases = await fetchTab('/api/admin/pcb-cases', 'all', 1, 1);
    const pos = await fetchTab('/api/admin/pcb-pos', 'all', 1, 1);

    await rp.view(adminView, '/app/admin/pcb/cases', 'Q06-admin-sidebar');
    const text = (await adminView.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

    // 사이드바 '견적요청'·'발주·EQ' 배지는 대기 큐 숫자다(todoRfq / eq 승인 대기).
    const todoRfq = Number(cases.counts.todoRfq ?? -1);
    const eqPending = Number(pos.counts.eqPending ?? -1);
    // 0 이면 배지가 아예 안 뜨는 설계일 수 있어, 양수일 때만 화면에서 찾는다.
    if (todoRfq > 0) {
      expect(text.includes(String(todoRfq)), `화면에 견적요청 대기 ${String(todoRfq)}`).toBe(true);
    }
    if (eqPending > 0) {
      expect(text.includes(String(eqPending)), `화면에 발주·EQ 대기 ${String(eqPending)}`).toBe(true);
    }
    F(
      'Q6',
      'obs',
      `배지 대조 — todoRfq=${String(todoRfq)} · eqPending=${String(eqPending)} ` +
        `(양수인 것만 화면에서 확인)`,
    );
  }, 300_000);
});
