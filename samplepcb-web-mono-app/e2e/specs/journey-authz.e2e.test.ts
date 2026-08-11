// 여정 25호 — **역할 경계 매트릭스**(누가 어느 문을 열 수 있는가).
//
// 22호가 본 것은 **파일 다운로드** 경계였다. 이 편은 그 위 층 — **엔드포인트 전반**이다.
// 네 주체(무인증·일반 회원·협력사·관리자)가 대표 엔드포인트를 두드렸을 때의 응답을 한 판에
// 세운다. 개별 라우트는 각 여정이 정상 경로로 지나가지만, **"권한 없는 쪽에서 두드리면"** 은
// 라우트를 새로 추가할 때마다 빠지기 쉬운 검사다(preHandler 를 안 붙이면 조용히 열린다).
//
// 표적:
//   ① **무인증은 401** — 토큰 없이 열리는 문이 있으면 안 된다(매직링크는 토큰 자체가 인가라
//      별개 경로다 — 13·14호가 다뤘다).
//   ② **일반 회원은 관리자·협력사 문을 못 연다** — 로그인만 했다고 열리면 안 된다.
//   ③ **협력사는 관리자 문을 못 연다** — 자기 포털만이다.
//   ④ **협력사는 남의 발주·RFQ 를 id 로 직접 못 본다** — 목록에 안 보이는 것과 별개 검사다
//      (id 는 순번이라 추측된다 — 22호가 파일에서 본 것과 같은 논리).
//   ⑤ **관리자는 열린다**(양성 대조) — 이게 없으면 위의 거절들이 "라우트가 없어서"일 수 있다.
//
// **쓰기가 없다**(read-only) — GET 만 두드린다. 거절 자체가 관찰 대상이라 상태 변화가 필요 없다.
//
// 실행: pnpm -F e2e journey:authz  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  requireCustomerCreds,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

describe.skipIf(!RUN || !JOURNEY)('여정 25호 — 역할 경계 매트릭스', () => {
  const rp = createJourneyReport('findings-authz', '여정 25호 역할 경계 탐색 주행 리포트');
  const { F } = rp;

  let A = ''; // 관리자
  let P = ''; // 협력사(협력2)
  let C = ''; // 일반 회원(고객)
  let partner: PartnerFixture;

  /** 협력2 **가 아닌** 조직의 발주·RFQ — 남의 것 접근 검사용(실데이터에서 고른다). */
  let othersPoId: number | null = null;
  let othersRfqId: number | null = null;

  /** 관리자 전용 대표 엔드포인트(각 워크큐의 입구). */
  const ADMIN_PATHS = [
    '/api/admin/pcb-cases?tab=all&page=1&pageSize=1',
    '/api/admin/pcb-orders?tab=all&page=1&pageSize=1',
    '/api/admin/pcb-pos?tab=all&page=1&pageSize=1',
    '/api/admin/pcb-shipments?tab=all&page=1&pageSize=1',
    '/api/admin/partners?page=1&pageSize=1',
  ];

  /** 협력사 전용 대표 엔드포인트. */
  const PARTNER_PATHS = [
    '/api/partner/pcb-pos',
    '/api/partner/pcb-rfqs',
    '/api/partner/pcb-shipments',
    '/api/partner/pcb-as-cases',
    '/api/partner/pcb-remittances',
  ];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 토큰 없이 — 헤더 자체를 안 붙인다. */
  const anon = async (path: string): Promise<number> => {
    const res = await fetch(`${API_URL}${path}`);
    return res.status;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    partner = await getPartner('협력2');
    if (partner.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: requireCustomerCreds().id, ttlSec: 3600 });

    // 남의 것 — 협력2 가 수주자도 상위도 아닌 발주/RFQ 를 실데이터에서 찾는다.
    const prisma = getPrisma();
    const po = await prisma.spPcbPo.findFirst({
      where: { partnerId: { not: partner.id }, parentPartnerId: { not: partner.id } },
      orderBy: { id: 'desc' },
    });
    othersPoId = po === null ? null : Number(po.id);
    const rfq = await prisma.spPcbRfq.findFirst({
      where: { partnerId: { not: partner.id }, parentPartnerId: { not: partner.id } },
      orderBy: { id: 'desc' },
    });
    othersRfqId = rfq === null ? null : Number(rfq.id);
  }, 120_000);

  afterAll(async () => {
    rp.write({});
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('Z1. 무인증은 어느 문도 열지 못한다', async () => {
    const results: string[] = [];
    for (const path of [...ADMIN_PATHS, ...PARTNER_PATHS]) {
      const status = await anon(path);
      // 401(인증 없음)이 정석이지만 403 도 "막혔다"는 뜻이다 — 200 만 아니면 된다.
      expect(status, `무인증 ${path}`).toBeGreaterThanOrEqual(400);
      results.push(String(status));
    }
    F(
      'Z1',
      'obs',
      `무인증 ${String(ADMIN_PATHS.length + PARTNER_PATHS.length)}경로 전부 차단 — ` +
        `상태 [${[...new Set(results)].join(', ')}]`,
    );
  }, 300_000);

  test('Z2. 일반 회원은 관리자·협력사 문을 못 연다', async () => {
    const adminBlocked: number[] = [];
    for (const path of ADMIN_PATHS) {
      const res = await api(C, 'GET', path);
      expect(res.status, `고객 → 관리자 ${path}: ${JSON.stringify(res.json)}`).toBeGreaterThanOrEqual(
        400,
      );
      adminBlocked.push(res.status);
    }
    const partnerBlocked: number[] = [];
    for (const path of PARTNER_PATHS) {
      const res = await api(C, 'GET', path);
      expect(res.status, `고객 → 협력사 ${path}: ${JSON.stringify(res.json)}`).toBeGreaterThanOrEqual(
        400,
      );
      partnerBlocked.push(res.status);
    }
    F(
      'Z2',
      'obs',
      `일반 회원 차단 — 관리자 경로 [${[...new Set(adminBlocked)].join(', ')}] · ` +
        `협력사 경로 [${[...new Set(partnerBlocked)].join(', ')}]`,
    );
  }, 300_000);

  test('Z3. 협력사는 관리자 문을 못 연다', async () => {
    const blocked: number[] = [];
    for (const path of ADMIN_PATHS) {
      const res = await api(P, 'GET', path);
      expect(res.status, `협력사 → 관리자 ${path}: ${JSON.stringify(res.json)}`).toBeGreaterThanOrEqual(
        400,
      );
      blocked.push(res.status);
    }
    // 반대로 자기 포털은 열려야 한다 — 이 200 이 있어야 위 거절이 "역할 때문"임이 증명된다.
    for (const path of PARTNER_PATHS) {
      const res = await api(P, 'GET', path);
      expect(res.status, `협력사 → 자기 포털 ${path}: ${JSON.stringify(res.json)}`).toBe(200);
    }
    F(
      'Z3',
      'obs',
      `협력사 차단 — 관리자 경로 [${[...new Set(blocked)].join(', ')}] · ` +
        `자기 포털 ${String(PARTNER_PATHS.length)}경로 200(양성 대조)`,
    );
  }, 300_000);

  test('Z4. 협력사는 남의 발주·RFQ 를 id 로 직접 못 본다', async (ctx) => {
    if (othersPoId === null && othersRfqId === null) return ctx.skip();

    // 목록에 안 보이는 것과 **id 로 직접 두드리는 것**은 다른 검사다(id 는 순번이라 추측된다).
    if (othersPoId !== null) {
      const po = await api(P, 'GET', `/api/partner/pcb-pos/${String(othersPoId)}`);
      expect(po.status, `남의 발주 상세 #${String(othersPoId)}`).toBeGreaterThanOrEqual(400);
    }
    if (othersRfqId !== null) {
      const rfq = await api(P, 'GET', `/api/partner/pcb-rfqs/${String(othersRfqId)}`);
      expect(rfq.status, `남의 RFQ 상세 #${String(othersRfqId)}`).toBeGreaterThanOrEqual(400);
    }
    F(
      'Z4',
      'obs',
      `남의 문서 직접 접근 차단 — po #${String(othersPoId)} · rfq #${String(othersRfqId)} ` +
        `(목록 은닉과 별개로 id 접근도 막힌다)`,
    );
  }, 300_000);

  test('Z5. 관리자는 열린다 — 양성 대조', async () => {
    for (const path of ADMIN_PATHS) {
      const res = await api(A, 'GET', path);
      expect(res.status, `관리자 ${path}: ${JSON.stringify(res.json)}`).toBe(200);
    }
    // 관리자가 협력사 포털 경로를 두드리면? 역할이 다르므로 막히는 것이 정상이다
    // (관리자 대행은 **관리자 경로**로 한다 — 12호가 그 동선을 세웠다).
    const crossed: number[] = [];
    for (const path of PARTNER_PATHS) {
      const res = await api(A, 'GET', path);
      crossed.push(res.status);
    }
    F(
      'Z5',
      'obs',
      `관리자 ${String(ADMIN_PATHS.length)}경로 200(양성 대조) · 관리자→협력사 포털 경로 ` +
        `[${[...new Set(crossed)].join(', ')}](대행은 관리자 경로로 한다)`,
    );
  }, 300_000);
});
