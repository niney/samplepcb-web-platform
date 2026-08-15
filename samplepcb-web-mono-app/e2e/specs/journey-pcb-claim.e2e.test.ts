// 여정 — PCB 고객 클레임 완주(P5): 접수에서 재생산 회차 선적 요청까지, 그리고 환불 갈래.
//
// pcb-claim.e2e(기본 회귀 4케이스)가 게이트·전이를 박제했다면, 이 여정은 **실무
// 스토리 전체**를 한 호흡으로 밟는다:
//
//   A(재생산 완주): 완료 주문 → 고객 접수(사진 2장) → 검토 시작 → 회수 기록(운송장
//     메모) → 판정(제조불량·재생산·협력사 지정) → A/S 케이스 자동 생성·연결 →
//     접수 전송 → 협력사가 클레임 원문·사진을 보고 [재생산 가능] → [재발주 진행]
//     → 회차 1 발주(조건 복사·납기 비움) → 회차 EQ 완주 → 담기(회차 박스) →
//     인보이스 → 선적 요청 — 재생산 실물이 공급망에 실리는 지점까지.
//   B(환불 갈래): 관리자 대리 접수(파손·환불 희망) → 판정(운송 파손·환불 협의
//     ₩33,000 기록) → **기존 주문 환불 창구(PATCH orders/:odId/refund) 실집행**
//     → od_refund_price 반영 — 기록(클레임)과 실집행(주문 원장)의 분업 실증.
//   공통: 종결로 activeKey 가 풀려 재접수가 열리고, 고객 조회에 답변·처리방식이
//     서고, 메일 원장(pcb_claim_received/decided·pcb_as_submitted/replied)이 남는다.
//
// 원주문 완주는 압축(스펙+완료 주문+원발주 round 0 직시드 — 여정 5호 전례).
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run journey-pcb-claim
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
  getPartner,
  getPrisma,
  num,
  signJwt,
  type PartnerFixture,
} from '../helpers';

// ⚠ 하위 관계를 가진 조직(tester2협력 등 MD)은 직수주 발주도 EQ 가 DELEGATED 로
// 위임 차단된다(실측) — 회차 EQ 를 직접 밟아야 하는 이 여정은 비-MD 조직을 쓴다.
const PARTNER_NAME = '협력2'; // CN·비-MD — 회차 선적이 국제 체인을 타게
const CUST_MB = 'e2e-jclaim-cust';
const PROJECT_A = 'E2E-JCLAIM-A-board.zip';
const PROJECT_B = 'E2E-JCLAIM-B-board.zip';
const REFUND_KRW = 33000;

describe.skipIf(!RUN)('여정 — 고객 클레임 완주(재생산 회차·환불 갈래)', () => {
  let partner: PartnerFixture;
  let A = '';
  let CU = '';
  let P = '';
  const specIds: bigint[] = [];
  const quoteIds: bigint[] = [];
  const poIds: bigint[] = [];
  const odIds: string[] = [];
  const ctIds: number[] = [];
  let claimAId: string | null = null;
  let claimAVersion = 1;
  let claimBId: string | null = null;
  let asCaseId: number | null = null;
  let roundPoId: number | null = null;

  const prismaOf = () => getPrisma();

  /** 완료(배송 후) 주문 직시드 — 행 복제 패턴(여정 관례), 상태만 '완료'. */
  const seedDeliveredOrder = async (projectName: string, seq: number): Promise<number> => {
    const prisma = prismaOf();
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
    const odId = String(Number(kst) + seq);
    odIds.push(odId);
    const orderCols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_order'`,
    );
    const odOverrides: Record<string, string> = {
      od_id: `'${odId}'`,
      mb_id: `'${CUST_MB}'`,
      od_name: `'여정클레임고객'`,
      od_email: `'${CUST_MB}@test.local'`,
      od_status: `'완료'`,
      od_misu: '0',
      od_refund_price: '0',
      od_time: 'NOW()',
    };
    const odNames = orderCols.map((c: any) => String(c.COLUMN_NAME));
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_shop_order (${odNames.map((n: string) => `\`${n}\``).join(', ')})
        SELECT ${odNames.map((n: string) => odOverrides[n] ?? `\`${n}\``).join(', ')}
          FROM g5_shop_order WHERE od_status = '완료' ORDER BY od_id DESC LIMIT 1`,
    );
    const cartCols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_cart' AND COLUMN_NAME <> 'ct_id'`,
    );
    const ctOverrides: Record<string, string> = {
      od_id: `'${odId}'`,
      mb_id: `'${CUST_MB}'`,
      it_name: `'${projectName}'`,
      ct_status: `'완료'`,
      ct_qty: '1',
      io_id: `''`,
      io_price: '0',
      ct_time: 'NOW()',
    };
    const ctNames = cartCols.map((c: any) => String(c.COLUMN_NAME));
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_shop_cart (${ctNames.map((n: string) => `\`${n}\``).join(', ')})
        SELECT ${ctNames.map((n: string) => ctOverrides[n] ?? `\`${n}\``).join(', ')}
          FROM g5_shop_cart WHERE ct_status <> '쇼핑' ORDER BY ct_id DESC LIMIT 1`,
    );
    const inserted: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_id FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id DESC LIMIT 1`,
      odId,
    );
    const ctId = Number(inserted[0]?.ct_id ?? 0);
    ctIds.push(ctId);
    return ctId;
  };

  const seedSpecWithOrder = async (projectName: string, seq: number): Promise<bigint> => {
    const prisma = prismaOf();
    const ctId = await seedDeliveredOrder(projectName, seq);
    const quote = await prisma.spQuote.create({
      data: {
        category: 'standard',
        orderCategory: 'sample',
        qty: 20,
        specJson: { layers: '2' },
        specHash: `e2e-jclaim-${String(seq)}`,
        autoPrice: 66000,
        priceVersion: 'e2e-jclaim',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    });
    quoteIds.push(quote.id);
    const spec = await prisma.spOrderSpec.create({
      data: {
        mbId: CUST_MB,
        quoteId: quote.id,
        ctId,
        projectName,
        category: 'standard',
        orderCategory: 'sample',
        qty: 20,
        specJson: { layers: '2' },
        status: 'active',
        quoteStatus: 'quoted',
      },
    });
    specIds.push(spec.id);
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: partner.id,
      status: 'produced',
      currency: 'USD',
      priceOriginal: 180,
    });
    poIds.push(po.id);
    return spec.id;
  };

  const claimForm = (fields: Record<string, string>, files: [string, string][] = []): FormData => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (const [i, [name, body]] of files.entries()) {
      form.set(`file${String(i)}`, new File([new TextEncoder().encode(body)], name, { type: 'application/pdf' }));
    }
    return form;
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    CU = signJwt({ mbId: CUST_MB, ttlSec: 3600 });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    await seedSpecWithOrder(PROJECT_A, 0);
    await seedSpecWithOrder(PROJECT_B, 1);
  }, 120_000);

  afterAll(async () => {
    const prisma = prismaOf();
    const claims = await prisma.spPcbClaim.findMany({
      where: { specId: { in: specIds } },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: { refType: 'sp_pcb_claim', refId: { in: claims.map((c: any) => c.id) } },
    });
    await prisma.spPcbClaim.deleteMany({ where: { specId: { in: specIds } } });
    const cases = await prisma.spPcbAsCase.findMany({
      where: { specId: { in: specIds } },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: { refType: 'sp_pcb_as_case', refId: { in: cases.map((c: any) => c.id) } },
    });
    await prisma.spPcbAsCase.deleteMany({ where: { specId: { in: specIds } } });
    // 회차 발주(proceed 생성)는 poIds 레지스트리 밖 — 스펙 축으로 걷는다(선적·EQ 첨부 포함).
    const allPos = await prisma.spPcbPo.findMany({
      where: { specId: { in: specIds } },
      select: { id: true },
    });
    const allPoIds = allPos.map((p: any) => p.id);
    const ships = await prisma.spPcbShipment.findMany({
      where: { poId: { in: allPoIds } },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: { refType: 'sp_pcb_shipment', refId: { in: ships.map((s: any) => s.id) } },
    });
    await cleanupPcbPos(allPoIds);
    await prisma.spMailLog.deleteMany({
      where: { refType: 'pcb_spec', refId: { in: specIds.map(String) } },
    });
    await prisma.spOrderSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.spQuote.deleteMany({ where: { id: { in: quoteIds } } });
    if (ctIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
    }
    if (odIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_order WHERE od_id IN (${odIds.map(() => '?').join(',')})`,
        ...odIds,
      );
    }
    const residue = await countPcbResidue(allPoIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('J1. 고객 접수(A) — 사진 2장, open·원문 박제', async () => {
    const created = await fetch(`${API_URL}/api/pcb-claims`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CU}` },
      body: claimForm(
        {
          specId: String(specIds[0]),
          kind: 'quality',
          affectedQty: '5',
          description: '20장 중 5장이 전원 인가 직후 리셋을 반복합니다.',
          requestedRemedy: 'reproduce',
          acknowledge: '1',
        },
        [
          ['defect-front.pdf', '%PDF-1.4 front %%EOF'],
          ['defect-back.pdf', '%PDF-1.4 back %%EOF'],
        ],
      ),
    });
    const json: any = await created.json();
    expect(created.status, JSON.stringify(json)).toBe(200);
    claimAId = String(json?.data?.claim?.id ?? '');
    claimAVersion = Number(json?.data?.claim?.version ?? 1);
    expect(json?.data?.claim?.status).toBe('open');
    expect((json?.data?.claim?.files ?? []).length, '사진 2장').toBe(2);
    expect(json?.data?.claim?.orderedQty).toBe(20);
    expect(json?.data?.claim?.affectedQty).toBe(5);
  }, 120_000);

  test('J2. 검토·회수 기록·판정(재생산) — 케이스 자동 생성·연결', async (ctx) => {
    if (claimAId === null) return ctx.skip();
    const review = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimAId}`, {
      action: 'start_review',
      expectedVersion: claimAVersion,
    });
    expect(review.status, JSON.stringify(review.json)).toBe(200);
    claimAVersion = Number(review.json?.data?.claim?.version);

    // 회수 기록 — 판정 전 검토 노트(버전 잠금 밖, 최종쓰기 우선).
    const ret = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimAId}/return`, {
      returnRequired: true,
      returnNote: '고객 반송 운송장 CJ-000-1234 — 도착 후 협력사 이관',
    });
    expect(ret.status, JSON.stringify(ret.json)).toBe(200);
    expect(ret.json?.data?.claim?.returnRequired).toBe(true);

    const resolve = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimAId}`, {
      action: 'resolve',
      expectedVersion: claimAVersion,
      resolutionKind: 'reproduce',
      faultType: 'manufacturing',
      response: '제조 불량으로 확인되어 5장 무상 재생산으로 진행합니다. 완제품은 재발송됩니다.',
      targetPartnerId: num(partner.id),
    });
    expect(resolve.status, JSON.stringify(resolve.json)).toBe(200);
    const claim = resolve.json?.data?.claim;
    expect(claim?.status).toBe('resolved');
    asCaseId = claim?.asCaseId ?? null;
    expect(asCaseId, '케이스 자동 생성·연결').not.toBeNull();

    const cases = await api(A, 'GET', `/api/admin/pcb-projects/${String(specIds[0])}/as-cases`);
    const created = (cases.json?.data?.cases ?? []).find((c: any) => c.id === asCaseId);
    expect(created?.status).toBe('draft');
    expect(created?.caseType).toBe('product_defect');
    expect(created?.chargeType, '제조 귀책 → 무상 기본').toBe('free');
    expect(created?.claimId, '케이스→클레임 역참조').toBe(claimAId);
    expect(String(created?.description ?? '')).toContain('클레임 #');
  }, 120_000);

  test('J3. 협력사 합의 — 원문·사진 확인 후 재생산 가능 회신', async (ctx) => {
    if (asCaseId === null) return ctx.skip();
    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);

    const view = await api(P, 'GET', `/api/partner/pcb-as-cases/${String(asCaseId)}`);
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    const brief = view.json?.data?.asCase?.claim;
    expect(brief, '협력사에 클레임 요약').not.toBeNull();
    expect(brief?.affectedQty).toBe(5);
    expect((brief?.files ?? []).length, '고객 사진 2장 참조').toBe(2);
    const dl = await fetch(
      `${API_URL}/api/partner/pcb-as-cases/${String(asCaseId)}/claim-files/${String(brief?.files?.[0]?.fileId)}`,
      { headers: { authorization: `Bearer ${P}` } },
    );
    expect(dl.status, '사진 다운로드').toBe(200);

    const accept = await api(P, 'POST', `/api/partner/pcb-as-cases/${String(asCaseId)}/accept`, {
      reason: '불량 사진 확인 — 재생산 가능합니다(리드타임 5일).',
    });
    expect(accept.status, JSON.stringify(accept.json)).toBe(200);
  }, 120_000);

  test('J4. 재발주 진행 — 회차 1 채번·조건 복사·납기 비움', async (ctx) => {
    if (asCaseId === null) return ctx.skip();
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/proceed`, {});
    expect(proceed.status, JSON.stringify(proceed.json)).toBe(200);
    expect(proceed.json?.data?.reorderRound).toBe(1);
    roundPoId = Number(proceed.json?.data?.poId ?? 0);
    expect(roundPoId).toBeGreaterThan(0);

    const round = await prismaOf().spPcbPo.findUnique({ where: { id: BigInt(roundPoId) } });
    expect(round?.reorderRound).toBe(1);
    expect(String(round?.status)).toBe('issued');
    expect(Number(round?.priceOriginal), '원발주 조건 복사').toBe(180);
    expect(round?.deliveryDate, '납기는 비운다(회차 새 일정)').toBeNull();
  }, 120_000);

  test('J5. 회차 실행 — EQ 완주 → 담기(회차 박스) → 선적 요청', async (ctx) => {
    if (roundPoId === null) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', new File([bytes], `${fileType}-jclaim.zip`, { type: 'application/zip' }));
      const up = await fetch(`${API_URL}/api/partner/pcb-pos/${String(roundPoId)}/eq-files`, {
        method: 'POST',
        headers: { authorization: `Bearer ${P}` },
        body: form,
      });
      expect(up.status, `${fileType} 업로드`).toBe(200);
    }
    for (const [path, token] of [
      [`/api/partner/pcb-pos/${String(roundPoId)}/eq-request`, P],
      [`/api/admin/pcb-projects/${String(specIds[0])}/pos/${String(roundPoId)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(roundPoId)}/production-start`, P],
      [`/api/partner/pcb-pos/${String(roundPoId)}/production-complete`, P],
    ] as const) {
      const r = await api(token, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }

    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: roundPoId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    // 보드 뷰 — 회차 박스가 'A/S 1차'로 갈려 선다(reorderRound 파생).
    const board = await api(P, 'GET', '/api/partner/pcb-shipments');
    const myBox = (board.json?.data?.boxes ?? []).find((b: any) =>
      (b.groupPos ?? []).some((g: any) => Number(g.poId) === roundPoId),
    );
    expect(myBox, '보드 준비 박스').toBeTruthy();
    expect(myBox?.reorderRound, '회차 배지 데이터').toBe(1);

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const invForm = new FormData();
    invForm.set('fileType', 'invoice');
    invForm.set('file', new File([pdf], 'invoice-jclaim.pdf', { type: 'application/pdf' }));
    const inv = await fetch(`${API_URL}/api/partner/pcb-pos/${String(roundPoId)}/shipment/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: invForm,
    });
    expect(inv.status, 'Invoice 첨부').toBe(200);
    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(roundPoId)}/shipment/advance`, {
      shipDate: '2026-08-25',
    });
    expect(reqd.status, `선적 요청: ${JSON.stringify(reqd.json)}`).toBe(200);
  }, 180_000);

  test('J6. 환불 갈래(B) — 대리 접수 → 판정(환불 협의) → 주문 환불 실집행', async () => {
    const specB = specIds[1];
    const odB = odIds[1] ?? '';
    const created = await api(A, 'POST', `/api/admin/pcb-projects/${String(specB)}/claims`, {
      kind: 'damaged',
      affectedQty: 20,
      description: '전화 접수 — 전량 모서리 파손 상태로 도착했다고 하십니다.',
      requestedRemedy: 'refund',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    claimBId = String(created.json?.data?.claim?.id ?? '');
    let version = Number(created.json?.data?.claim?.version ?? 1);

    const review = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimBId}`, {
      action: 'start_review',
      expectedVersion: version,
    });
    expect(review.status).toBe(200);
    version = Number(review.json?.data?.claim?.version);

    const resolve = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimBId}`, {
      action: 'resolve',
      expectedVersion: version,
      resolutionKind: 'refund_coordination',
      faultType: 'shipping_damage',
      response: `운송 중 파손으로 확인되어 ₩${REFUND_KRW.toLocaleString('ko-KR')} 환불로 협의드립니다.`,
      refundAmount: REFUND_KRW,
    });
    expect(resolve.status, JSON.stringify(resolve.json)).toBe(200);
    expect(resolve.json?.data?.claim?.refundAmount, '환불 협의액 기록').toBe(REFUND_KRW);
    expect(resolve.json?.data?.claim?.asCaseId, '환불 갈래는 케이스 없음').toBeNull();

    // 실집행은 기존 주문 환불 기록 창구 — 돈은 사람이 보내고 사실만 원장에 남는다.
    const refund = await api(A, 'PATCH', `/api/admin/orders/${odB}/refund`, {
      refundPrice: REFUND_KRW,
      note: `[클레임 #${claimBId}] 운송 파손 환불`,
    });
    expect(refund.status, JSON.stringify(refund.json)).toBe(200);
    const row: any[] = await prismaOf().$queryRawUnsafe(
      `SELECT od_refund_price FROM g5_shop_order WHERE od_id = ?`,
      odB,
    );
    expect(Number(row[0]?.od_refund_price ?? 0), 'od_refund_price 반영').toBe(REFUND_KRW);
  }, 120_000);

  test('J7. 고객 조회·재접수 개방·메일 원장', async () => {
    // 고객 화면 데이터 — 답변·처리방식이 스펙별로 선다.
    const odA = odIds[0] ?? '';
    const listA = await api(CU, 'GET', `/api/pcb-claims?odId=${odA}`);
    expect(listA.status).toBe(200);
    const specViewA = (listA.json?.data?.specs ?? []).find(
      (s: any) => String(s.specId) === String(specIds[0]),
    );
    const doneClaim = (specViewA?.claims ?? []).find((c: any) => String(c.id) === claimAId);
    expect(doneClaim?.status).toBe('resolved');
    expect(doneClaim?.resolutionKind).toBe('reproduce');
    expect(String(doneClaim?.adminResponse ?? '')).toContain('무상 재생산');
    // 종결로 activeKey 가 풀려 같은 스펙 재접수가 열려 있다.
    expect(specViewA?.eligibility?.canSubmit, '종결 후 재접수 개방').toBe(true);

    const logs = await prismaOf().spMailLog.findMany({
      where: { refType: 'pcb_spec', refId: { in: specIds.map(String) } },
      select: { kind: true },
    });
    const kinds = logs.map((l: any) => String(l.kind));
    expect(kinds.filter((k: string) => k === 'pcb_claim_received').length, '접수 확인 2건(고객+대리)').toBe(2);
    expect(kinds.filter((k: string) => k === 'pcb_claim_decided').length, '판정 회신 2건').toBe(2);
    expect(kinds, 'A/S 접수 전송 메일').toContain('pcb_as_submitted');
    expect(kinds, 'A/S 회신 메일').toContain('pcb_as_replied');
  }, 60_000);
});
