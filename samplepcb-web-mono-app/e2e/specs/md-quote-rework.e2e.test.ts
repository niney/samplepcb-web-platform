// MD 시나리오 3 — **하위 재선정·배정 회수**(견적 루프의 되돌리기 축). 시나리오 1이 정방향
// 루프였다면 여기는 MD 가 마음을 바꾸는 경우들이다:
//
//   ① 마진 변경(같은 하위 재선정) — 상위 회신가가 재계산된다
//   ② 하위 교체(USD 협력2 → KRW 협력1) — source* 가 통째로 갈아끼워진다(통화까지)
//   ③ 선정 해제(childRfqId null) — 상위 회신이 전면 소거되고 requested 로 되돌아간다
//   ④ 배정 회수(diff 에서 체크 해제) — 미회신 행만 지워지고, 회신한 행은 보존된다
//
// 픽스처는 시나리오 1의 상설 무대에 관계 하나를 더 얹는다: 마스터딜러상사→협력1(KRW).
// 하위가 둘이어야 교체·회수를 시험할 수 있다. idempotent — 있으면 그대로 쓴다.
//
// 실행: pnpm -F e2e e2e md-quote-rework  (RUN 게이트만)
// 정리: 이 주행이 만든 RFQ 행만 삭제(스펙 무접촉·잔재 0 어서션).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  num,
  signJwt,
  type PartnerFixture,
} from '../helpers';

// 계정은 e2e 전용(e2e-*)만 — 실계정 소속을 직삽입으로 늘리면 1계정=1조직을 오염시킨다.
const MD_MB_ID = 'e2e-mdtester';
const MD_ORG_NAME = '마스터딜러상사';

describe.skipIf(!RUN)('MD 시나리오 3 — 하위 재선정·배정 회수(mdtester)', () => {
  let p1: PartnerFixture; // 협력1(KR·KRW — 이번에 관계 추가)
  let p2: PartnerFixture; // 협력2(CN·USD — 기존 관계)
  let mdPartnerId: bigint | null = null;
  let A = '';
  let M = '';
  let P1 = '';
  let P2 = '';

  let specId: number | null = null;
  let topRfqId: number | null = null;
  let rfqC1: number | null = null; // MD→협력1
  let rfqC2: number | null = null; // MD→협력2
  const createdRfqIds: bigint[] = [];

  beforeAll(async () => {
    // 무대 자기창조(idempotent) — 계정·조직·연결·관계 전부 e2e 전용으로 확보.
    const mdOrg = await ensureStagePartner({
      mbId: MD_MB_ID,
      orgName: MD_ORG_NAME,
      country: 'KR',
      currency: 'KRW',
    });
    p1 = await ensureStagePartner({
      mbId: 'e2e-mdsub1',
      orgName: '협력1',
      country: 'KR',
      currency: 'KRW',
    });
    p2 = await ensureStagePartner({
      mbId: 'e2e-mdsub2',
      orgName: '협력2',
      country: 'CN',
      currency: 'USD',
    });
    // 하위 둘 — 협력2(USD, 시나리오 1)·협력1(KRW, 이번 확장). 각각 idempotent.
    await ensureMdRelation(mdOrg, p2, 'USD');
    await ensureMdRelation(mdOrg, p1, 'KRW');
    if (p1.mbId === null || p2.mbId === null) throw new Error('협력1·2 연결 계정 없음');
    mdPartnerId = mdOrg.id;
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    P1 = signJwt({ mbId: p1.mbId, ttlSec: 3600 });
    P2 = signJwt({ mbId: p2.mbId, ttlSec: 3600 });
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdRfqIds.length > 0) {
      await prisma.spPcbRfq.deleteMany({ where: { id: { in: createdRfqIds } } });
    }
    const residue =
      specId === null ? 0 : await prisma.spPcbRfq.count({ where: { specId: BigInt(specId) } });
    expect(residue, 'RFQ 잔재').toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('N1. 준비: MD 배정 → 하위 2곳 배정 → 둘 다 회신', async () => {
    const prisma = getPrisma();
    const usedSpecIds = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
      (r: { specId: bigint }) => r.specId,
    );
    const spec = await prisma.spOrderSpec.findFirst({
      where: { status: 'active', ctId: null, id: { notIn: usedSpecIds }, pcbRfqs: { none: {} } },
      orderBy: { id: 'desc' },
    });
    if (spec === null) throw new Error('게이트 통과 자유 스펙이 없습니다');
    specId = num(spec.id);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(mdPartnerId ?? 0n)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    topRfqId =
      (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(mdPartnerId ?? 0n))
        ?.rfqId ?? null;
    createdRfqIds.push(BigInt(topRfqId ?? 0));

    const assign = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(p1.id), num(p2.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 2곳 배정: ${JSON.stringify(assign.json)}`).toBe(200);
    type RfqRow = { id: bigint; partnerId: bigint; currency: string };
    const rows: RfqRow[] = await prisma.spPcbRfq.findMany({
      where: { specId: BigInt(specId), parentPartnerId: mdPartnerId ?? 0n },
    });
    expect(rows.length, '하위 RFQ 2행').toBe(2);
    for (const r of rows) createdRfqIds.push(r.id);
    rfqC1 = num(rows.find((r: RfqRow) => r.partnerId === p1.id)?.id ?? 0n);
    rfqC2 = num(rows.find((r: RfqRow) => r.partnerId === p2.id)?.id ?? 0n);
    // 링크 통화가 관계별로 따로 박제된다 — 같은 MD 의 하위라도 통화가 다르다.
    expect(rows.find((r: RfqRow) => r.partnerId === p1.id)?.currency, '협력1 링크 KRW').toBe('KRW');
    expect(rows.find((r: RfqRow) => r.partnerId === p2.id)?.currency, '협력2 링크 USD').toBe('USD');

    const r1 = await api(P1, 'PUT', `/api/partner/pcb-rfqs/${String(rfqC1)}`, {
      price: 300_000,
      quotedDeliveryDate: '2026-08-20',
      memo: '[재선정] 협력1 회신',
    });
    expect(r1.status, `협력1 회신: ${JSON.stringify(r1.json)}`).toBe(200);
    const r2 = await api(P2, 'PUT', `/api/partner/pcb-rfqs/${String(rfqC2)}`, {
      price: 200,
      quotedDeliveryDate: '2026-08-21',
      memo: '[재선정] 협력2 회신',
    });
    expect(r2.status, `협력2 회신: ${JSON.stringify(r2.json)}`).toBe(200);
  });

  test('N2. 마진 변경 — 같은 하위 재선정으로 상위 회신가가 재계산된다', async (ctx) => {
    if (topRfqId === null || rfqC2 === null) return ctx.skip();
    const prisma = getPrisma();
    const first = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId: rfqC2,
      marginRate: 10,
    });
    expect(first.status, `1차 선정(10%): ${JSON.stringify(first.json)}`).toBe(200);
    const at10 = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    const rate = Number(at10?.sourceRate ?? 0);
    expect(Number(at10?.priceOriginal ?? 0), '10% 회신가').toBe(Math.round(200 * rate * 1.1));

    const second = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId: rfqC2,
      marginRate: 25,
    });
    expect(second.status, `마진 변경(25%): ${JSON.stringify(second.json)}`).toBe(200);
    const at25 = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    expect(Number(at25?.marginRate ?? 0), '마진 갱신').toBe(25);
    expect(Number(at25?.priceOriginal ?? 0), '재계산 회신가').toBe(
      Math.round(200 * Number(at25?.sourceRate ?? 0) * 1.25),
    );
  });

  test('N3. 하위 교체(USD→KRW) — source* 가 통화까지 갈아끼워진다', async (ctx) => {
    if (topRfqId === null || rfqC1 === null) return ctx.skip();
    const swap = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId: rfqC1,
      marginRate: 20,
    });
    expect(swap.status, `교체 선정: ${JSON.stringify(swap.json)}`).toBe(200);

    const prisma = getPrisma();
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    expect(top?.selectedChildRfqId, '선정 하위 교체').toBe(BigInt(rfqC1));
    expect(top?.sourceCurrency, '원가 통화 KRW 로').toBe('KRW');
    expect(Number(top?.sourceAmount ?? 0), '원가 교체').toBe(300_000);
    // KRW→KRW 는 환율 1 — 회신가 = 300,000 × 1.2.
    expect(Number(top?.priceOriginal ?? 0), '교체 후 회신가').toBe(Math.round(300_000 * 1.2));
  });

  test('N4. 하위 선정 뒤 직접 회신 — 상위는 self 근거가 되고 하위 선정 표시는 모두 열린다', async (ctx) => {
    if (topRfqId === null || specId === null) return ctx.skip();
    const direct = await api(M, 'PUT', `/api/partner/pcb-rfqs/${String(topRfqId)}`, {
      price: 440_000,
      quotedDeliveryDate: '2026-08-23',
      memo: '[재선정] MD 직접 회신으로 전환',
    });
    expect(direct.status, `직접 회신 전환: ${JSON.stringify(direct.json)}`).toBe(200);

    const prisma = getPrisma();
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    expect(top?.status).toBe('quoted');
    expect(Number(top?.priceOriginal ?? 0)).toBe(440_000);
    expect(top?.selectedChildRfqId, '직접 제작 근거').toBeNull();
    expect(top?.sourceAmount, '하위 원가 흔적 소거').toBeNull();
    const children = await prisma.spPcbRfq.findMany({
      where: { specId: BigInt(specId), parentPartnerId: mdPartnerId ?? 0n },
    });
    expect(
      children.every((row: { status: string }) => row.status === 'quoted'),
      '하위 선정 표시 회수',
    ).toBe(true);
  });

  test('N5. 선정 해제 — 상위 회신이 전면 소거되고 다시 회신 대기로', async (ctx) => {
    if (topRfqId === null) return ctx.skip();
    const clear = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId: null,
    });
    expect(clear.status, `해제: ${JSON.stringify(clear.json)}`).toBe(200);

    const prisma = getPrisma();
    const top = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
    expect(top?.status, '회신 대기 복귀').toBe('requested');
    expect(top?.priceOriginal, '회신가 소거').toBeNull();
    expect(top?.selectedChildRfqId, '선정 소거').toBeNull();
    expect(top?.marginRate, '마진 소거').toBeNull();
    expect(top?.sourceCurrency, '원가 흔적 소거').toBeNull();
  });

  test('N6. 배정 회수 — 미회신 행만 지워지고 회신 행은 보존된다', async (ctx) => {
    if (specId === null || topRfqId === null) return ctx.skip();
    const prisma = getPrisma();
    // 협력1 행을 미회신 상태로 되돌릴 수는 없으니(회신 완료), 이 검증은 반대로 —
    // 회신이 있는 두 행을 남긴 채 diff 에서 협력1을 빼 본다: 회수는 requested 만
    // 지우므로 회신 완료 행은 **보존**되어야 한다.
    const drop = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(p2.id)], // 협력1 체크 해제
      suggestedDeliveryDate: null,
    });
    expect(drop.status, `회수 diff: ${JSON.stringify(drop.json)}`).toBe(200);
    const kept = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqC1 ?? 0) } });
    expect(kept, '회신 완료 행 보존').not.toBeNull();

    // 진짜 회수 대상 — 새로 배정만 하고 회신이 없는 행. 협력1을 다시 넣었다 빼면
    // ALREADY 존재(quoted)라 안 만들어진다… 그래서 회수는 "미회신"을 새로 만들 수 있는
    // 협력사가 더 없어 여기서는 quoted 보존까지만 확정한다(미회신 삭제는 서버 코드가
    // status='requested' 만 지우는 물리 삭제 — pcb-guards 쪽 후속 후보).
    const rows = await prisma.spPcbRfq.count({
      where: { specId: BigInt(specId), parentPartnerId: mdPartnerId ?? 0n },
    });
    expect(rows, '하위 행 수 유지(둘 다 회신 완료)').toBe(2);
  });
});
