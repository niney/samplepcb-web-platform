// 여정 27호 — **삭제의 위계**(상대가 있는 기록은 혼자 없앨 수 없다).
//
// 15호가 "되돌리기"였다면 이 편은 **"지우기"** 다. 삭제는 되돌릴 수 없어 가드가 겹겹이 걸려
// 있는데, 그 위계에는 실측으로 얻은 이유가 있다: 주석(pcb-projects.ts)에 남은 기록 —
// **"고객이 보관함에서 한 번 더 지우면 협력사에 메일이 나간 견적요청이 통째로 cascade 로
// 사라졌다"**(2026-08-06). RFQ 는 주문 전 스펙에도 보낼 수 있어(D10 게이트) 고객 손이 닿는
// 자리였다. 그래서 규칙이 생겼다 — **상대가 있는 기록은 고객 단독으로 없앨 수 없다.**
//
// 표적:
//   ① **협력 트랙이 있으면 고객 삭제가 막힌다**(RFQ 한 건만 있어도) — 그 가드가 지금도 사는가
//   ② **가드가 풀리면 지워진다** — 출구 없는 잠금이 아니다(정리 순서가 있다)
//   ③ **지운 뒤 잔재가 없다** — 스펙·파일이 함께 사라지고 고아가 남지 않는다
//   ④ **조직은 이력이 있으면 못 지운다**(대조군 — 삭제 대신 정지가 배제 경로다, 13호)
//
// 자기가 만든 스펙만 다룬다(거버 제출로 새로 만든 것) — 실데이터는 건드리지 않는다.
//
// 실행: pnpm -F e2e journey:delete  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  monoRoot,
  newPhpSession,
  num,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');
const PARTNER_NAME = '협력2';

describe.skipIf(!RUN || !JOURNEY)('여정 27호 — 삭제의 위계', () => {
  const rp = createJourneyReport('findings-delete', '여정 27호 삭제 위계 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let partner: PartnerFixture;
  let A = '';
  let C = '';
  let specId: number | null = null;
  let rfqId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const specRow = async (): Promise<any> =>
    getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId ?? 0) } });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner = await getPartner(PARTNER_NAME);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    // 남아 있으면 지운다(주행이 중간에 끊긴 경우) — 자기 스펙만.
    const prisma = getPrisma();
    if (rfqId !== null) await prisma.spPcbRfq.deleteMany({ where: { id: BigInt(rfqId) } });
    if (specId !== null) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_order_spec', refId: BigInt(specId) },
      });
      await prisma.spOrderSpec.deleteMany({ where: { id: BigInt(specId) } });
    }
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('X1. 준비 — 주문 전 스펙에 견적요청까지(고객 손이 닿는 자리)', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 27호] 삭제 위계 검증 — 주행이 직접 정리',
      prefix: 'X01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (이 편이 만들고 이 편이 지운다)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId;
    expect(rfqId, 'RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (협력사에 메일이 나간 기록)`);

    // 주문은 하지 않는다 — 주문 전이라야 "고객이 지울 수 있는 자리"가 된다(D10 게이트).
    const spec = await specRow();
    expect(spec?.ctId ?? null, '주문 전(비담김)').toBeNull();
    F('X1', 'obs', `준비 — spec=${String(specId)}(주문 전) · rfq #${String(rfqId)} 배정 완료`);
  }, 600_000);

  test('X2. 협력 트랙이 있으면 고객 혼자 못 지운다', async (ctx) => {
    if (specId === null) return ctx.skip();

    // ⚠ 삭제는 **2단계**다: 첫 DELETE 는 **보관함**(soft, status='deleted'), 보관함에서 한 번 더
    //   지르는 것이 **영구 삭제**다. 사고가 난 자리도 거기였다("보관함에서 한 번 더 지우면").
    const soft = await api(C, 'DELETE', `/api/pcb-projects/${String(specId)}`);
    expect(soft.status, `1단계(보관함): ${JSON.stringify(soft.json)}`).toBe(200);
    expect(String(soft.json?.data?.status), '보관함 상태').toBe('deleted');
    expect(String((await specRow())?.status), '스펙은 남고 상태만 바뀐다').toBe('deleted');

    // 2단계 — 여기가 막혀야 한다. 협력사에 메일이 나간 RFQ 가 딸려 있기 때문이다.
    const hard = await api(C, 'DELETE', `/api/pcb-projects/${String(specId)}`);
    expect(hard.status, `2단계(영구 삭제) 차단: ${JSON.stringify(hard.json)}`).toBeGreaterThanOrEqual(
      400,
    );
    // 스펙도 RFQ 도 그대로여야 한다 — 부분 삭제가 일어나면 그게 더 나쁘다.
    expect(await specRow(), '스펙 존속').toBeTruthy();
    const rfqLeft = await getPrisma().spPcbRfq.count({ where: { id: BigInt(rfqId ?? 0) } });
    expect(rfqLeft, 'RFQ 존속(cascade 로 사라지지 않는다)').toBe(1);
    F(
      'X2',
      'obs',
      `삭제 2단계 실측 — 1단계 보관함 200(deleted) · 2단계 영구 삭제 ${String(hard.status)} ` +
        `${String(hard.json?.error ?? '')} 차단 · 스펙·RFQ 모두 존속(2026-08-06 cascade 사고의 가드가 산다)`,
    );
  }, 300_000);

  test('X3. 가드가 풀리면 지워진다 — 출구 없는 잠금이 아니다', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    const prisma = getPrisma();

    // 정리 순서: 협력 기록을 먼저 없앤다(관리자 몫) → 그러면 고객 삭제가 열린다.
    await prisma.spPcbRfq.deleteMany({ where: { id: BigInt(rfqId) } });
    const gone = await prisma.spPcbRfq.count({ where: { id: BigInt(rfqId) } });
    expect(gone, 'RFQ 정리').toBe(0);

    // 이미 보관함(deleted) 상태다 — 이번 DELETE 가 곧 영구 삭제다.
    const del = await api(C, 'DELETE', `/api/pcb-projects/${String(specId)}`);
    expect(del.status, `정리 후 영구 삭제: ${JSON.stringify(del.json)}`).toBe(200);
    F(
      'X3',
      'obs',
      `정리 후 영구 삭제 성공 — RFQ 제거 → 200(잠김 → 정리 → 열림 순환이 삭제에도 성립)`,
    );
  }, 300_000);

  test('X4. 지운 뒤 잔재가 없다', async (ctx) => {
    if (specId === null) return ctx.skip();
    const prisma = getPrisma();

    const spec = await specRow();
    // 보관함(soft delete)인지 물리 삭제인지 — 어느 쪽이든 **활성 목록에서 사라져야** 한다.
    const status = spec === null ? '(물리 삭제)' : String(spec.status);
    if (spec !== null) {
      expect(status, '활성 상태가 아니다').not.toBe('active');
    }

    // 관리자 큐에서도 안 보여야 한다(활성 모수 기준).
    const list = await api(
      A,
      'GET',
      `/api/admin/pcb-cases?tab=all&page=1&pageSize=100&q=${String(specId)}`,
    );
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const found = (list.json?.data?.items ?? []).some((i: any) => Number(i.specId) === specId);
    expect(found, '삭제된 견적은 큐에서 사라진다').toBe(false);

    // 고아 파일이 남지 않아야 한다(스펙이 없어졌는데 파일만 남으면 파일서버에 쓰레기가 쌓인다).
    if (spec === null) {
      const orphanFiles = await prisma.spFile.count({
        where: { refType: 'sp_order_spec', refId: BigInt(specId) },
      });
      expect(orphanFiles, '고아 스펙 파일 0').toBe(0);
    }
    specId = null; // afterAll 이 다시 지우려 하지 않게
    rfqId = null;
    F('X4', 'obs', `삭제 후 상태 ${status} · 관리자 큐 비노출 · 고아 파일 0`);
  }, 300_000);

  test('X5. 조직은 이력이 있으면 못 지운다 — 삭제 대신 정지', async () => {
    // 대조군 — 같은 위계가 조직에도 있다(13호가 "운영 배제는 suspended" 로 확인한 그 규칙).
    const del = await api(A, 'DELETE', `/api/admin/partners/${String(partner.id)}`);
    expect(del.status, `이력 있는 조직 삭제: ${JSON.stringify(del.json)}`).toBe(409);
    expect(
      ['PARTNER_HAS_PCB_DOCS', 'PARTNER_HAS_RFQS'].includes(String(del.json?.error)),
      '거절 코드',
    ).toBe(true);
    const still = await getPrisma().spPartner.count({ where: { id: partner.id } });
    expect(still, '조직 존속').toBe(1);
    F(
      'X5',
      'obs',
      `조직 삭제 차단 — 409 ${String(del.json?.error)} · 존속 확인(배제는 정지로 한다)`,
    );
  }, 300_000);
});
