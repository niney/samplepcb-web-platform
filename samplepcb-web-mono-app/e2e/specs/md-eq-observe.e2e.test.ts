// MD 관전·대행 회귀(2026-08-13 실주행 교정) — 마스터딜러가 하위 협력사 EQ 를 **지켜보고**,
// 필요하면 **대신 진행**하는 것이 기본으로 동작하는가.
//
// 실주행에서 확정된 결함 4건이 표적이다:
//   ① MD 수주 발주의 "하위 발주 대기"(delegation.blocked)가 내 차례로 안 세어져
//      홈이 "할 일 없음"으로 침묵 → myTurn+eqBlocked 신호
//   ② 하위 발주 상세에 상대(수주 협력사) 이름이 없어 "하위 발주: 자기조직명" 오표기
//      → counterpartyName
//   ③ 하위가 EQ 반려로 돌아와도 MD 목록에 신호가 없다 → issued 방향 rejectedAt
//   ④ 대행 실효 — MD 토큰의 파일 업로드는 MASTER_DEALER 로, 전이는 byRole
//      MASTER_DEALER 로 박제(관전과 대행이 이력에서 갈린다)
//
// 무대는 자기창조(ensureStagePartner/ensureMdRelation) — DB 복구로 픽스처가 사라져도
// e2e 전용 계정(e2e-*)으로 다시 세운다. 실계정(mdtester)은 건드리지 않는다(1계정=1조직).
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run md-eq-observe
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  cleanupPcbPos,
  countPcbResidue,
  createPcbPo,
  disconnectPrisma,
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };

const uploadEqFile = async (
  token: string,
  poId: number,
  fileType: 'eq' | 'working',
  name: string,
): Promise<number> => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
  const form = new FormData();
  form.set('fileType', fileType);
  form.set('file', new File([bytes], name));
  const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(poId)}/eq-files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
};

describe.skipIf(!RUN)('MD 관전·대행 — 하위 EQ 를 보고, 필요하면 대신 민다', () => {
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = '';
  let M = '';
  let C = '';
  let specId: bigint | null = null;
  let topPoId: number | null = null;
  let childPoId: number | null = null;
  let childRfqId: bigint | null = null;
  const poIds: bigint[] = [];

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);

    md = await ensureStagePartner(MD);
    sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'USD');
    if (md.mbId === null || sub.mbId === null) throw new Error('무대 계정 연결 실패');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: sub.mbId, ttlSec: 3600 });

    const [spec] = await pickFreeSpecs(1);
    specId = spec.id;
    // 상위 발주 직삽입(관리자→MD·발주접수) — 관리자 발주 라우트는 paid 게이트라
    // 주문 시드까지 필요해진다. 이 스펙의 표적은 발주 이후의 관전·대행 축이므로
    // 발주서만 세운다(pcb-caseref 관례).
    const top = await createPcbPo({
      specId: spec.id,
      partnerId: md.id,
      status: 'issued',
      currency: 'KRW',
      priceOriginal: 700000,
    });
    poIds.push(top.id);
    topPoId = Number(top.id);
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    // EQ 첨부(DB) → RFQ → PO 순 정리(leaf-first). 무대(계정·조직·관계)는 상설로 남긴다.
    await prisma.spFile.deleteMany({
      where: { refType: 'sp_pcb_po_eq', refId: { in: poIds } },
    });
    if (childRfqId !== null) {
      await prisma.spPcbRfq.deleteMany({ where: { id: childRfqId } });
    }
    if (specId !== null) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: String(specId) },
      });
    }
    await cleanupPcbPos(poIds);
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    expect(
      await prisma.spFile.count({ where: { refType: 'sp_pcb_po_eq', refId: { in: poIds } } }),
      'EQ 첨부 잔재',
    ).toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('O1. 하위 발주 대기 = MD 의 차례 — myTurn·eqBlocked 신호', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    const list = await api(M, 'GET', '/api/partner/pcb-pos');
    expect(list.status).toBe(200);
    const row = (list.json?.data?.items ?? []).find((r: any) => Number(r.poId) === topPoId);
    expect(row, '수주 행 존재').toBeTruthy();
    expect(row.direction).toBe('received');
    // ①의 회귀 — 발주를 받아 놓고 "할 일 없음"이면 MD 는 시작조차 못 한다.
    expect(row.myTurn, '하위 발주 대기가 내 차례로 선다').toBe(true);
    expect(row.eqBlocked, '하위 발주 필요 배지 신호').toBe(true);

    const detail = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(detail.json?.data?.eq?.blocked, '상세도 같은 판정').toBe(true);
  });

  test('O2. 하위 발주 → 상세 상대 표기·위임 전환', async (ctx) => {
    if (topPoId === null || specId === null) return ctx.skip();
    const prisma = getPrisma();
    // 하위 회신(selected) 직삽입 — round 0 하위 발주는 childRfqId 필수(CHILD_RFQ_REQUIRED).
    const rfq = await prisma.spPcbRfq.create({
      data: {
        specId,
        partnerId: sub.id,
        parentPartnerId: md.id,
        reorderRound: 0,
        status: 'selected',
        currency: 'USD',
        priceOriginal: 400,
        quotedDeliveryDate: new Date('2026-08-27T00:00:00+09:00'),
        requestedAt: new Date(),
        respondedAt: new Date(),
      },
    });
    childRfqId = rfq.id;

    const created = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId: Number(rfq.id),
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const child = (created.json?.data?.children ?? [])[0];
    expect(child, '하위 발주 생성').toBeTruthy();
    childPoId = Number(child.poId);
    poIds.push(BigInt(childPoId));

    // ②의 회귀 — MD 가 하위 발주서를 열면 상대(수주 협력사)가 보여야 한다.
    const childDetail = await api(M, 'GET', `/api/partner/pcb-pos/${String(childPoId)}`);
    expect(childDetail.status).toBe(200);
    expect(childDetail.json?.data?.direction).toBe('issued');
    expect(childDetail.json?.data?.counterpartyName, '하위 협력사 이름').toBe(sub.name);
    // 수주자(하위) 관점은 발주처=MD.
    const subView = await api(C, 'GET', `/api/partner/pcb-pos/${String(childPoId)}`);
    expect(subView.json?.data?.direction).toBe('received');
    expect(subView.json?.data?.counterpartyName, '발주처=MD 조직').toBe(md.name);

    // 상위는 위임으로 전환 — 하위 발주 대기 신호는 걷힌다.
    const list = await api(M, 'GET', '/api/partner/pcb-pos');
    const topRow = (list.json?.data?.items ?? []).find((r: any) => Number(r.poId) === topPoId);
    expect(topRow.eqBlocked, '위임 후 차단 신호 해제').toBe(false);
    expect(topRow.myTurn, '위임 중은 내 차례가 아니다(관전)').toBe(false);
    const topDetail = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(Number(topDetail.json?.data?.eq?.delegatePoId), '위임 대상').toBe(childPoId);
  });

  test('O3. 하위 EQ 반려 — MD 목록의 관전 신호(rejectedAt)와 fallback 개방', async (ctx) => {
    if (childPoId === null || specId === null) return ctx.skip();
    expect(await uploadEqFile(C, childPoId, 'working', 'sub-working-v1.zip'), '하위 업로드').toBe(200);
    const req = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);

    const rejected = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(childPoId)}/eq-reject`,
      { reason: '스택업 확인 필요 — 4층 구성 재검토' },
    );
    expect(rejected.status).toBe(200);

    // ③의 회귀 — 하위가 반려로 돌아온 사실이 MD 목록(발주 축)에 신호로 선다.
    const list = await api(M, 'GET', '/api/partner/pcb-pos');
    const childRow = (list.json?.data?.items ?? []).find(
      (r: any) => Number(r.poId) === childPoId,
    );
    expect(childRow.direction).toBe('issued');
    expect(childRow.status).toBe('issued');
    expect(childRow.rejectedAt, '반려 관전 신호').not.toBeNull();

    // 대행의 문 — MD 는 fallback RECEIVER 다(관전 화면에서 대행 버튼의 근거).
    const detail = await api(M, 'GET', `/api/partner/pcb-pos/${String(childPoId)}`);
    expect(detail.json?.data?.eq?.myRole).toBe('RECEIVER');
    expect(detail.json?.data?.eq?.fallback, 'MD 대행 표시').toBe(true);
  });

  test('O4. MD 대행 — 업로드는 MASTER_DEALER, 전이는 byRole 로 박제', async (ctx) => {
    if (childPoId === null || specId === null) return ctx.skip();
    expect(await uploadEqFile(M, childPoId, 'working', 'md-fix-v2.zip'), 'MD 대행 업로드').toBe(200);
    const prisma = getPrisma();
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(childPoId) },
      orderBy: { id: 'asc' },
    });
    // ④의 회귀 — 관전과 대행이 이력에서 갈린다(하위 것과 섞이면 대행 사실이 사라진다).
    expect(files.at(-1)?.uploadedBy, '대행 업로드 주체').toBe('MASTER_DEALER');
    expect(files.at(0)?.uploadedBy, '하위 업로드는 그대로').toBe('PARTNER');

    const req = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/eq-request`, {});
    expect(req.status, JSON.stringify(req.json)).toBe(200);
    const po = await prisma.spPcbPo.findUnique({ where: { id: BigInt(childPoId) } });
    const history = (po?.eqHistory ?? []) as any[];
    expect(history.at(-1)?.byRole, '대행 전이 주체').toBe('MASTER_DEALER');

    // 관리자 승인 → 하위·상위(미러) 동시 확인으로 관전 축을 닫는다.
    const approved = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(childPoId)}/eq-approve`,
      {},
    );
    expect(approved.status).toBe(200);
    const top = await prisma.spPcbPo.findUnique({ where: { id: BigInt(topPoId ?? 0) } });
    expect(String(top?.status), '상위 미러').toBe('eq_done');
  });
});
