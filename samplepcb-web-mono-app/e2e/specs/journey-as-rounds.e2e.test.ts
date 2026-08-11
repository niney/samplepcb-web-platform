// 여정 29호 — **A/S 다회차**(3차·4차까지 갔을 때).
//
// 5호가 1차를, 7호가 2차(거절→재접수 포함)를 밟았다. 그런데 **회차가 더 늘면**? 재발주는 같은
// 보드를 다시 만드는 일이라 실무에서 두세 번은 흔하고, 그때마다 채번·박스·집계가 회차 축을
// 정확히 따라야 한다. 회차는 **박스 합류 키의 한 축**(`받는측:조직:직송지:회차`)이라 틀리면
// 3차 물건이 1차 박스에 섞인다.
//
// 표적:
//   ① **채번이 MAX+1 로 이어진다** — 1 → 2 → 3. 건너뛰거나 겹치면 회차 축이 무너진다.
//   ② **회차마다 발주가 따로 선다** — 같은 스펙·같은 조직인데 UK(specId+partnerId+parent+round)
//      가 회차로 갈려 공존한다.
//   ③ **박스가 회차로 갈린다** — 3차 발주가 1·2차 박스에 합류하지 않는다.
//   ④ **원발주는 그대로다** — 회차를 아무리 쌓아도 round 0 의 발주·선적은 건드려지지 않는다.
//
// 시드 발주로 빠르게 만든다(고객 주문 없이 — 회차 축은 주문과 무관하다). 정리는 레지스트리.
//
// 실행: pnpm -F e2e journey:asrounds  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createJourneyReport,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  num,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const PARTNER_NAME = '협력2';
const ROUNDS = 3;

describe.skipIf(!RUN || !JOURNEY)('여정 29호 — A/S 다회차(3차까지)', () => {
  const rp = createJourneyReport('findings-asrounds', '여정 29호 A/S 다회차 탐색 주행 리포트');
  const { F, ledger } = rp;

  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let specId: number | null = null;
  let originPoId: bigint | null = null;
  const poIds: bigint[] = [];
  const roundPoIds: number[] = [];
  const caseIds: number[] = [];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** A/S 한 바퀴 — 접수 → 수락 → 진행. 회차 번호와 발주 id 를 돌려준다. */
  const runOneRound = async (label: string): Promise<{ round: number; poId: number }> => {
    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(partner.id),
      caseType: 'product_defect',
      description: `[여정 29호] ${label} 재생산 요청`,
    });
    expect(create.status, `${label} 케이스 생성: ${JSON.stringify(create.json)}`).toBe(200);
    const caseId = Number(create.json?.data?.asCase?.id ?? 0);
    caseIds.push(caseId);
    ledger.push(`sp_pcb_as_case #${String(caseId)} (${label})`);

    expect(
      (await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/submit`, {})).status,
      `${label} 접수`,
    ).toBe(200);
    expect(
      (
        await api(P, 'POST', `/api/partner/pcb-as-cases/${String(caseId)}/accept`, {
          reason: `[여정 29호] ${label} 수락`,
        })
      ).status,
      `${label} 수락`,
    ).toBe(200);

    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/proceed`, {});
    expect(proceed.status, `${label} 진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    const round = Number(proceed.json?.data?.reorderRound ?? -1);
    const poId = Number(proceed.json?.data?.poId ?? 0);
    poIds.push(BigInt(poId));
    roundPoIds.push(poId);
    ledger.push(`sp_pcb_po #${String(poId)} (A/S ${String(round)}차)`);
    return { round, poId };
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    // A/S 케이스는 발주보다 먼저(참조 관계) — 그다음 발주·선적을 레지스트리로.
    if (caseIds.length > 0) {
      await prisma.spPcbAsCase.deleteMany({
        where: { id: { in: caseIds.map((n) => BigInt(n)) } },
      });
    }
    await cleanupPcbPos(poIds);
    const residue = await countPcbResidue(poIds);
    F(
      'A5',
      'obs',
      `정리 — A/S 케이스 ${String(caseIds.length)}건·발주 ${String(poIds.length)}건 삭제 · ` +
        `잔재 pos=${String(residue.pos)} shipments=${String(residue.shipments)}`,
    );
    rp.write({});
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('A1. 준비 — 원발주(round 0) 생산완료', async () => {
    const specs = await pickFreeSpecs(1);
    specId = Number(specs[0]?.id);
    const po = await createPcbPo({
      specId: BigInt(specId),
      partnerId: partner.id,
      status: 'produced',
      currency: 'USD',
      priceOriginal: 120,
    });
    originPoId = po.id;
    poIds.push(po.id);
    ledger.push(`sp_pcb_po #${String(po.id)} (원발주 round 0)`);
    expect(Number(po.reorderRound), '원발주 회차').toBe(0);
    F('A1', 'obs', `준비 — spec=${String(specId)} 원발주 #${String(originPoId)}(round 0, produced)`);
  }, 180_000);

  test('A2. 채번이 1 → 2 → 3 으로 이어진다', async (ctx) => {
    if (specId === null) return ctx.skip();

    const rounds: number[] = [];
    for (let i = 1; i <= ROUNDS; i += 1) {
      const r = await runOneRound(`${String(i)}차`);
      rounds.push(r.round);
      // 회차 발주는 다시 생산완료까지 밀어야 다음 A/S 를 접수할 수 있다(개시 가드).
      const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(r.poId)}`;
      // EQ 없이 바로 밀 수 없으므로 DB 로 상태만 맞춘다(이 편의 표적은 회차 축이지 EQ 가 아니다).
      await getPrisma().spPcbPo.update({
        where: { id: BigInt(r.poId) },
        data: { status: 'produced' },
      });
      expect(base.length, '경로 구성').toBeGreaterThan(0);
    }

    // 건너뛰거나 겹치면 회차 축이 무너진다 — 박스 키가 회차를 쓰기 때문이다.
    expect(rounds, '채번 1→2→3').toEqual([1, 2, 3]);
    F('A2', 'obs', `채번 실측 — ${rounds.join(' → ')} (MAX+1 이 회차마다 이어진다)`);
  }, 600_000);

  test('A3. 회차마다 발주가 따로 서고 원발주는 그대로다', async (ctx) => {
    if (specId === null || originPoId === null) return ctx.skip();
    const prisma = getPrisma();

    const all = await prisma.spPcbPo.findMany({
      where: { specId: BigInt(specId) },
      orderBy: { reorderRound: 'asc' },
    });
    // 같은 스펙·같은 조직인데 회차로 갈려 공존한다(UK 에 reorderRound 가 있다).
    expect(all.length, '원발주 + 회차 3건').toBe(ROUNDS + 1);
    expect(
      all.map((p: any) => Number(p.reorderRound)),
      '회차 0·1·2·3 공존',
    ).toEqual([0, 1, 2, 3]);

    // 원발주는 아무리 회차를 쌓아도 건드려지지 않는다.
    const origin = all.find((p: any) => Number(p.reorderRound) === 0);
    expect(Number(origin?.id ?? 0), '원발주 동일성').toBe(Number(originPoId));
    expect(String(origin?.status), '원발주 상태 불변').toBe('produced');
    F(
      'A3',
      'obs',
      `회차 공존 실측 — po ${all.map((p: any) => `#${String(p.id)}(r${String(p.reorderRound)})`).join(' · ')}`,
    );
  }, 300_000);

  test('A4. 박스가 회차로 갈린다 — 3차가 1차 박스에 섞이지 않는다', async (ctx) => {
    if (roundPoIds.length < ROUNDS) return ctx.skip();
    const prisma = getPrisma();

    // 회차마다 담는다 — contextKey 에 회차가 있으므로 서로 다른 박스가 나와야 한다.
    for (const poId of roundPoIds) {
      const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
      expect(box.status, `담기 #${String(poId)}: ${JSON.stringify(box.json)}`).toBe(200);
    }

    const shipments = await prisma.spPcbShipment.findMany({
      where: { pos: { some: { poId: { in: roundPoIds.map((n) => BigInt(n)) } } } },
      orderBy: { id: 'asc' },
    });
    // 회차가 다르면 컨텍스트가 달라 합류하지 않는다 — 섞이면 3차 물건이 1차 송장에 실린다.
    expect(shipments.length, '회차 수만큼 박스가 갈린다').toBe(ROUNDS);

    // ⚠ 회차는 **발주에 있는 값**이다(sp_pcb_shipment 에는 저장되지 않는다 — 계약 뷰의
    //   `reorderRound` 는 대표 발주에서 파생한다). 대표 발주를 따라가 회차를 읽는다.
    const repRounds: number[] = [];
    for (const s of shipments) {
      const rep = await prisma.spPcbPo.findUnique({ where: { id: (s as any).poId } });
      repRounds.push(Number(rep?.reorderRound ?? -1));
    }
    repRounds.sort((a: number, b: number) => a - b);
    // 박스마다 회차가 하나씩 — 같은 회차 박스가 둘이거나 한 박스에 두 회차가 섞이면 실패다.
    expect(repRounds, '박스별 대표 회차가 1·2·3').toEqual([1, 2, 3]);
    // 각 박스에 발주가 하나씩만(합류 0건).
    for (const s of shipments) {
      const members = await prisma.spPcbShipmentPo.count({ where: { shipmentId: (s as any).id } });
      expect(members, `박스 #${String((s as any).id)} 구성원 1건`).toBe(1);
    }
    F(
      'A4',
      'obs',
      `박스 분리 실측 — 박스 ${String(shipments.length)}개(대표 회차 ${repRounds.join('·')}) · ` +
        `각 박스 구성원 1건(합류 0 — 회차 축이 키에서 살아 있다)`,
    );
  }, 420_000);
});
