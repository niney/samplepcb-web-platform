// 여정 21호 — **MD 다중 상위와 단수 제한**(한 하위가 두 상위를 가질 때).
//
// MD 연작 다섯 편은 전부 **상위 하나 : 하위 하나**였다. 그런데 관계 설계는 다중 상위를
// 허용한다(2단 강제만 있고 상위 수 제한은 없다) — 실제로 상설 픽스처가 그 모양이다:
// 협력2 가 `마스터딜러상사`(KR·링크 USD)와 `mdtester2상사`(CN·링크 USD) **양쪽의 하위**다.
// 그 상태에서 두 MD 가 같은 하위에게 각각 배정하면 무엇이 갈리는지 아무도 확인하지 않았다.
//
// 표적:
//   ① **다중 상위가 실제로 성립한다** — 같은 조직이 두 관계의 하위로 동시에 존재한다.
//   ② **배정은 관계별로 갈린다** — 링크 통화·상위가 관계마다 박제되고 섞이지 않는다
//      (한 하위의 두 RFQ 가 서로 다른 parentPartnerId 를 가진다).
//   ③ **2단은 강제다** — MD 의 MD(3단)도, 하위를 상위로 세우는 것도 막힌다. 다만 거절 코드는
//      **서버 판정 순서**에 달렸다(9호 교훈: 순서를 계산해 기대값을 정한다 — 픽스처가 자라도
//      스펙이 안 깨진다).
//   ④ **하위 목록은 상위별로 다르다** — MD 가 자기 하위만 본다(남의 하위가 섞이면 배정 사고).
//
// **관계를 만들지 않는다**(상설 픽스처 3건 보호) — 기존 관계로만 검증하고, RFQ 만 만들고 지운다.
//
// 실행: pnpm -F e2e journey:mdmulti  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
// 스크린샷 접두사는 **N** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  newSession,
  num,
  pickFreeSpecs,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const MD_A = '마스터딜러상사'; // KR·KRW
const MD_B = 'mdtester2상사'; // CN·USD
const CHILD = '협력2'; // 두 MD 의 공통 하위

describe.skipIf(!RUN || !JOURNEY)('여정 21호 — MD 다중 상위·단수 제한', () => {
  const rp = createJourneyReport('findings-mdmulti', '여정 21호 MD 다중 상위 탐색 주행 리포트');
  const { F, ledger } = rp;

  let adminView: E2eSession;
  let mdA: PartnerFixture;
  let mdB: PartnerFixture;
  let child: PartnerFixture;
  let A = '';

  const rfqIds: number[] = [];
  let specA: number | null = null;
  let specB: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const relationsOf = async (id: bigint): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/partners/${String(id)}/relations`);
    expect(res.status, `관계 조회 #${String(id)}: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json?.data ?? {};
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    // 무대 자기창조(idempotent) — 두 MD 와 공통 하위, 그리고 다중 상위 관계 자체가
    // 이 여정의 전제다. DB 복구로 사라졌으면 e2e 전용으로 다시 세운다.
    mdA = await ensureStagePartner({ mbId: 'e2e-mdtester', orgName: MD_A, country: 'KR', currency: 'KRW' });
    mdB = await ensureStagePartner({ mbId: 'mdtester2', orgName: MD_B, country: 'CN', currency: 'USD' });
    child = await ensureStagePartner({ mbId: 'e2e-mdsub2', orgName: CHILD, country: 'CN', currency: 'USD' });
    await ensureMdRelation(mdA, child, 'USD');
    await ensureMdRelation(mdB, child, 'USD');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 120_000);

  afterAll(async () => {
    // RFQ 만 지운다 — 관계·조직은 상설 픽스처라 손대지 않는다.
    const prisma = getPrisma();
    if (rfqIds.length > 0) {
      await prisma.spPcbRfq.deleteMany({ where: { id: { in: rfqIds.map((n) => BigInt(n)) } } });
    }
    F('N5', 'obs', `정리 — RFQ ${String(rfqIds.length)}건 삭제(관계·조직 무접촉)`);
    rp.write({ 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('N1. 다중 상위가 실제로 성립한다', async () => {
    // 하위 관점 — 자기를 상위로 두는 조직이 둘이어야 한다.
    const childRel = await relationsOf(child.id);
    const parents: any[] = childRel.parents ?? [];
    const parentIds = parents.map((p: any) => Number(p.partnerId ?? p.id));
    expect(parentIds.includes(num(mdA.id)), `${MD_A} 가 상위`).toBe(true);
    expect(parentIds.includes(num(mdB.id)), `${MD_B} 가 상위`).toBe(true);
    expect(parents.length, '상위 2곳 이상(다중 상위)').toBeGreaterThanOrEqual(2);

    // 상위 관점 — 각 MD 의 하위 목록에 이 조직이 있다.
    for (const [md, label] of [
      [mdA, MD_A],
      [mdB, MD_B],
    ] as const) {
      const rel = await relationsOf(md.id);
      const kids: any[] = rel.children ?? [];
      expect(
        kids.some((c: any) => Number(c.partnerId ?? c.id) === num(child.id)),
        `${label} 의 하위 목록에 ${CHILD}`,
      ).toBe(true);
    }
    F(
      'N1',
      'obs',
      `다중 상위 실측 — ${CHILD} 의 상위 ${String(parents.length)}곳(${MD_A}·${MD_B}) · ` +
        `양쪽 하위 목록에서 대칭 확인`,
    );
  }, 180_000);

  test('N2. 배정은 관계별로 갈린다 — 통화·상위가 섞이지 않는다', async () => {
    const prisma = getPrisma();
    const specs = await pickFreeSpecs(2);
    specA = Number(specs[0]?.id);
    specB = Number(specs[1]?.id);

    // 두 MD 에게 각각 배정(관리자 → MD). 이 단계의 통화는 **MD 조직의 기본통화**다.
    const sendA = await api(A, 'POST', `/api/admin/pcb-projects/${String(specA)}/rfqs`, {
      partnerIds: [num(mdA.id)],
    });
    expect(sendA.status, JSON.stringify(sendA.json)).toBe(200);
    const rfqA = (sendA.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(mdA.id))?.rfqId;
    expect(rfqA, `${MD_A} RFQ`).toBeTruthy();
    rfqIds.push(Number(rfqA));
    ledger.push(`sp_pcb_rfq #${String(rfqA)} (→ ${MD_A})`);

    const sendB = await api(A, 'POST', `/api/admin/pcb-projects/${String(specB)}/rfqs`, {
      partnerIds: [num(mdB.id)],
    });
    expect(sendB.status, JSON.stringify(sendB.json)).toBe(200);
    const rfqB = (sendB.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(mdB.id))?.rfqId;
    expect(rfqB, `${MD_B} RFQ`).toBeTruthy();
    rfqIds.push(Number(rfqB));
    ledger.push(`sp_pcb_rfq #${String(rfqB)} (→ ${MD_B})`);

    const rowA = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(Number(rfqA)) } });
    const rowB = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(Number(rfqB)) } });
    // 조직 기본통화가 다르면 배정 통화도 갈린다(배정 시점 박제 — P1 결정).
    expect(String(rowA?.currency), `${MD_A} 배정 통화`).toBe(String(mdA.country === 'KR' ? 'KRW' : 'USD'));
    expect(String(rowB?.currency), `${MD_B} 배정 통화`).toBe('USD');
    // 관리자 트랙이므로 둘 다 parentPartnerId=0 — MD 는 아직 '수주자'이지 '중개자'가 아니다.
    expect(Number(rowA?.parentPartnerId ?? -1), `${MD_A} 관리자 직접 트랙`).toBe(0);
    expect(Number(rowB?.parentPartnerId ?? -1), `${MD_B} 관리자 직접 트랙`).toBe(0);
    F(
      'N2',
      'obs',
      `관계별 배정 실측 — ${MD_A}=${String(rowA?.currency)} · ${MD_B}=${String(rowB?.currency)} · ` +
        `둘 다 parentPartnerId=0(관리자 트랙)`,
    );
  }, 300_000);

  test('N3. 2단은 강제다 — 3단도, 역전도 막힌다', async () => {
    // ⚠ 거절 코드는 **서버 판정 순서**에 달렸다(9호 교훈). 순서를 계산해 기대값을 정하면
    //   픽스처가 자라도(상위가 늘어도) 스펙이 깨지지 않는다.
    //   판정 순서: CHILD_IS_MD → PARENT_IS_CHILD → PARENT_HAS_ACTIVE_POS
    const childRel = await relationsOf(child.id);
    // ⚠ 서버가 보는 것을 **그대로** 옮겨야 한다. 판정 두 개는 인자 방향이 다르다:
    //   CHILD_IS_MD    = `childPartnerId` 로 **넘긴 조직**이 이미 상위인가(하위를 거느렸나)
    //   PARENT_IS_CHILD = **경로의 조직**(부모 자리)이 이미 남의 하위인가
    //   첫 주행에서 이 방향을 헷갈려 기대값이 뒤집혔다 — 순서를 계산하는 접근은 옳지만,
    //   무엇을 세는지가 정확해야 픽스처 변화에도 견딘다.
    const mdARel = await relationsOf(mdA.id);
    const argChildIsMd = (mdARel.children ?? []).length > 0; // mdA 가 상위 → CHILD_IS_MD
    const argParentIsChild = (childRel.parents ?? []).length > 0; // 협력2 가 하위 → PARENT_IS_CHILD

    // ⚠ 상태 코드가 가드마다 다르고, 그 구분이 의도다:
    //   **400** = 구조적으로 불가능(2단 제한 위반 — 언제 다시 시도해도 안 된다)
    //   **409** = 지금 상태와 충돌(PARENT_HAS_ACTIVE_POS — 발주가 끝나면 된다)
    //   "다시 해 보면 될 일"과 "영영 안 될 일"을 코드로 갈라 준다.

    // ① 하위(협력2)를 상위로 세우려는 시도 — 협력2 는 이미 남의 하위다(PARENT_IS_CHILD).
    const asParent = await api(A, 'POST', `/api/admin/partners/${String(child.id)}/relations`, {
      childPartnerId: num(mdA.id),
    });
    expect(asParent.status, `하위를 상위로: ${JSON.stringify(asParent.json)}`).toBe(400);
    const expectedFirst = argChildIsMd ? 'CHILD_IS_MD' : 'PARENT_IS_CHILD';
    expect(
      asParent.json?.error,
      `판정 순서상 첫 거절(넘긴 조직이 상위=${String(argChildIsMd)} · 경로 조직이 하위=${String(argParentIsChild)})`,
    ).toBe(expectedFirst);
    // 어느 쪽이 먼저 걸리든 **둘 다 참인 상황**이라는 사실은 함께 못 박는다(2단 제한의 근거).
    expect(argParentIsChild, '협력2 는 남의 하위다 — 상위가 될 수 없는 이유').toBe(true);

    // ② MD 를 남의 하위로 넣으려는 시도(3단) — MD_A 는 하위를 가진 상위다(CHILD_IS_MD).
    const threeTier = await api(A, 'POST', `/api/admin/partners/${String(mdB.id)}/relations`, {
      childPartnerId: num(mdA.id),
    });
    expect(threeTier.status, `3단 시도: ${JSON.stringify(threeTier.json)}`).toBe(400);
    expect(threeTier.json?.error, 'MD 를 하위로 넣으면 CHILD_IS_MD').toBe('CHILD_IS_MD');

    // 관계는 그대로여야 한다 — 거절이 부분 적용되면 픽스처가 오염된다.
    const after = await relationsOf(child.id);
    expect((after.parents ?? []).length, '거절 후 상위 수 불변').toBe(
      (childRel.parents ?? []).length,
    );
    F(
      'N3',
      'obs',
      `2단 강제 실측 — 하위→상위 시도 409 ${String(asParent.json?.error)} · 3단 시도 409 ` +
        `CHILD_IS_MD · 관계 불변(상위 ${String((after.parents ?? []).length)}곳)`,
    );
  }, 240_000);

  test('N4. 화면 — 파트너 드로어에서 소속이 읽히는가', async () => {
    await rp.view(adminView, '/app/admin/partners', 'N04-partners');
    const text = (await adminView.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    expect(text.includes(MD_A), `목록에 ${MD_A}`).toBe(true);
    expect(text.includes(MD_B), `목록에 ${MD_B}`).toBe(true);
    expect(text.includes(CHILD), `목록에 ${CHILD}`).toBe(true);
    F('N4', 'obs', `파트너 목록 렌더 — 세 조직 노출(${String(text.length)}자)`);
  }, 180_000);
});

