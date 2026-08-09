// 하네스 자가 검증 — 헬퍼(JWT·API·DB 시드/정리·브라우저 스텁 로그인·Mailpit)가
// 실서버에서 동작함을 증명한다. 시나리오 작성 시 이 파일의 패턴을 복사해 시작할 것.
// 실행: pnpm -F e2e e2e  (옵트인 PORTAL_E2E=1 — 없으면 전부 skip)
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  countPcbResidue,
  cleanupPcbPos,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  gotoApp,
  mailpitList,
  newSession,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
  } catch (e) {
    throw new Error(
      `${url} 도달 실패 — ${hint}\n(${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

describe.skipIf(!RUN)('E2E 하네스 자가 검증', () => {
  let partner2: PartnerFixture; // 협력2(CN) — 쓰기 시나리오 전용 조직(HANDOFF §5)
  const createdPoIds: bigint[] = [];

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'API 서버를 켜세요: pnpm dev:api (127.0.0.1:3333)');
    await mustReach(`${BASE_URL}/app/`, 'nginx(Windows 서비스)와 웹(pnpm dev:web, 5173) 구동 확인 — 또는 E2E_BASE_URL 오버라이드');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 조직에 연결 계정이 없습니다(HANDOFF §4)');
  });

  afterAll(async () => {
    await cleanupPcbPos(createdPoIds);
    await closeBrowser();
    await disconnectPrisma();
  });

  test('JWT 로컬 서명 → 파트너 API 인증·tracks(R1) 확인', async () => {
    const token = signJwt({ mbId: partner2.mbId ?? '' });
    const r = await api(token, 'GET', '/api/partner/access');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.data?.isPartner).toBe(true);
    expect(r.json?.data?.partnerName).toBe('협력2');
    // 협력2 는 bom_rfq+pcb_rfq 둘 다(트랙 2 케이스 재현용 기준 조직)
    expect(r.json?.data?.tracks).toEqual({ bom: true, pcb: true });
  });

  test('관리자 JWT(isAdmin 클레임) → 관리자 API 통과', async () => {
    const admin = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    const r = await api(admin, 'GET', '/api/admin/partners?page=1&pageSize=5');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // 비관리자 토큰은 같은 라우트에서 403
    const member = signJwt({ mbId: partner2.mbId ?? '' });
    const forbidden = await api(member, 'GET', '/api/admin/partners?page=1&pageSize=5');
    expect(forbidden.status).toBe(403);
  });

  test('DB 직삽입 시드 → 무잔재 정리 (공유 DB 관례)', async () => {
    const [spec] = await pickFreeSpecs(1);
    const po = await createPcbPo({ specId: spec.id, partnerId: partner2.id });
    createdPoIds.push(po.id);
    expect((await countPcbResidue([po.id])).pos).toBe(1);
    await cleanupPcbPos([po.id]);
    expect(await countPcbResidue([po.id])).toEqual({ pos: 0, shipments: 0, memberships: 0 });
  });

  test('브라우저: 스텁 로그인 → /partner 진입 리졸버 → BOM 홈(기억 없음 기본)', async () => {
    const s = await newSession({ mbId: partner2.mbId ?? '' });
    try {
      await gotoApp(s.page, '/partner');
      await s.page.waitForURL('**/app/partner/bom', { timeout: 20_000 });
      expect(s.pageErrors, s.pageErrors.join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  });

  test('브라우저: 기억값 pcb → PCB 홈 복원 (localStorage 프리셋 헬퍼)', async () => {
    const s = await newSession({ mbId: partner2.mbId ?? '' }, { partnerModule: 'pcb' });
    try {
      await gotoApp(s.page, '/partner');
      await s.page.waitForURL('**/app/partner/pcb', { timeout: 20_000 });
    } finally {
      await s.close();
    }
  });

  test('브라우저: 익명 → 그누보드 로그인 왕복 URL', async () => {
    // nginx 통합 도메인이라 /bbs/login.php 실화면까지 뜬다(vite 직결 오버라이드 시엔
    // /bbs 미프록시 404 화면이지만 리다이렉트 URL 검증은 동일하게 유효).
    const s = await newSession(null);
    try {
      await gotoApp(s.page, '/partner');
      await s.page.waitForURL('**/bbs/login.php*', { timeout: 20_000 });
      expect(s.page.url()).toContain(encodeURIComponent('/app/partner'));
    } finally {
      await s.close();
    }
  });

  test('Mailpit 도달성', async () => {
    const list = await mailpitList(1);
    expect(list).not.toBeNull();
  });
});
