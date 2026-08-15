// PCB 고객 클레임(A/S 접수, P5) 회귀 — 접수→검토→판정의 두 갈래를 실서버로 박제.
//
//   ① 고객 접수(multipart·사진 동반) → 활성 1건 규칙(ACTIVE_CLAIM 409) →
//      관리자 검토→처리 확정(reproduce+대상 협력사) → A/S 케이스 초안 자동 생성·연결
//      → 케이스 전송 후 협력사 상세에 **고객 클레임 원문·사진(claim brief)** 노출
//   ② 관리자 대리 접수(byRole=admin) → 처리 불가(reject) → activeKey 해제로 재접수 개방
//   ③ 메일 원장 — 접수 확인·판정 회신이 sp_mail_log 에 남는다(발송 성패 무관 기록)
//
// 게이트 전제: 클레임은 '배송 후' 주문만 접수 가능 — 주문을 od/ct '완료'로 직시드한다.
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run pcb-claim
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

const PARTNER_NAME = 'tester2협력';
const CUST_MB = 'e2e-claim-cust';
const PROJECT_A = 'E2E-CLAIM-A-board.zip';
const PROJECT_B = 'E2E-CLAIM-B-board.zip';

describe.skipIf(!RUN)('PCB 고객 클레임 — 접수·판정·A/S 핸드오프', () => {
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
  let claimBId: string | null = null;
  let asCaseId: number | null = null;

  const prismaOf = () => getPrisma();

  /** 배송 후(완료) 주문 직시드 — demo 러너 행 복제 패턴, 상태만 '완료'. */
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
      od_name: `'클레임고객'`,
      od_email: `'${CUST_MB}@test.local'`,
      od_status: `'완료'`,
      od_misu: '0',
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
        specHash: `e2e-claim-${String(seq)}`,
        autoPrice: 50000,
        priceVersion: 'e2e-claim',
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
    // 원주문(round 0) 발주 — 재생산 대상 후보의 근거(NO_ORIGIN_PO 게이트).
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: partner.id,
      status: 'produced',
      currency: 'USD',
      priceOriginal: 100,
    });
    poIds.push(po.id);
    return spec.id;
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
    await prisma.spPcbClaim.deleteMany({ where: { specId: { in: specIds } } }); // events cascade
    const cases = await prisma.spPcbAsCase.findMany({
      where: { specId: { in: specIds } },
      select: { id: true },
    });
    await prisma.spFile.deleteMany({
      where: { refType: 'sp_pcb_as_case', refId: { in: cases.map((c: any) => c.id) } },
    });
    await prisma.spPcbAsCase.deleteMany({ where: { specId: { in: specIds } } });
    await cleanupPcbPos(poIds);
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
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('C1. 고객 접수(사진 동반) — 활성 1건 규칙까지', async () => {
    const specA = specIds[0];
    expect(specA).toBeDefined();
    // 접수 가능 판정 — 완료 주문이라 canSubmit.
    const odA = odIds[0] ?? '';
    const list = await api(CU, 'GET', `/api/pcb-claims?odId=${odA}`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const specView = (list.json?.data?.specs ?? []).find(
      (s: any) => String(s.specId) === String(specA),
    );
    expect(specView?.eligibility?.canSubmit, '배송 후 접수 가능').toBe(true);

    const form = new FormData();
    form.set('specId', String(specA));
    form.set('kind', 'quality');
    form.set('affectedQty', '3');
    form.set('description', '10장 중 3장이 전원 인가 시 동작하지 않습니다.');
    form.set('requestedRemedy', 'reproduce');
    form.set('acknowledge', '1');
    form.set(
      'file0',
      new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'defect-photo.pdf', {
        type: 'application/pdf',
      }),
    );
    const created = await fetch(`${API_URL}/api/pcb-claims`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CU}` },
      body: form,
    });
    const createdJson: any = await created.json();
    expect(created.status, JSON.stringify(createdJson)).toBe(200);
    claimAId = String(createdJson?.data?.claim?.id ?? '');
    expect(createdJson?.data?.claim?.status).toBe('open');
    expect(createdJson?.data?.claim?.createdByRole).toBe('customer');
    expect((createdJson?.data?.claim?.files ?? []).length, '사진 첨부 박제').toBe(1);

    // 활성 1건 규칙 — 같은 스펙 재접수는 409 ACTIVE_CLAIM.
    const dupForm = new FormData();
    dupForm.set('specId', String(specA));
    dupForm.set('kind', 'other');
    dupForm.set('affectedQty', '1');
    dupForm.set('description', '중복 접수 시도입니다.');
    dupForm.set('requestedRemedy', 'consult');
    dupForm.set('acknowledge', '1');
    const dup = await fetch(`${API_URL}/api/pcb-claims`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CU}` },
      body: dupForm,
    });
    const dupJson: any = await dup.json();
    expect(dup.status).toBe(409);
    expect(dupJson?.error).toBe('ACTIVE_CLAIM');
  }, 120_000);

  test('C2. 관리자 판정(재생산) — A/S 케이스 자동 생성·연결·협력사 노출', async (ctx) => {
    if (claimAId === null) return ctx.skip();
    const detail0 = await api(A, 'GET', `/api/admin/pcb-claims/${claimAId}`);
    expect(detail0.status).toBe(200);
    let version = Number(detail0.json?.data?.claim?.version ?? 1);

    const review = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimAId}`, {
      action: 'start_review',
      expectedVersion: version,
    });
    expect(review.status, JSON.stringify(review.json)).toBe(200);
    version = Number(review.json?.data?.claim?.version);

    const resolve = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimAId}`, {
      action: 'resolve',
      expectedVersion: version,
      resolutionKind: 'reproduce',
      faultType: 'manufacturing',
      response: '제조 불량으로 확인되어 3장 무상 재생산으로 진행합니다.',
      targetPartnerId: num(partner.id),
    });
    expect(resolve.status, JSON.stringify(resolve.json)).toBe(200);
    const claim = resolve.json?.data?.claim;
    expect(claim?.status).toBe('resolved');
    expect(claim?.faultType).toBe('manufacturing');
    expect(claim?.resolutionKind).toBe('reproduce');
    asCaseId = claim?.asCaseId ?? null;
    expect(asCaseId, 'A/S 케이스 자동 생성·연결').not.toBeNull();

    // 생성된 케이스 — draft·불량 무상 기본·클레임 요약이 설명으로 박제.
    const cases = await api(A, 'GET', `/api/admin/pcb-projects/${String(specIds[0])}/as-cases`);
    const created = (cases.json?.data?.cases ?? []).find((c: any) => c.id === asCaseId);
    expect(created?.status).toBe('draft');
    expect(created?.chargeType, '제조 귀책 → 무상 기본').toBe('free');
    expect(String(created?.description ?? '')).toContain(`클레임 #${claimAId}`);
    expect(created?.claimId, '케이스→클레임 역참조').toBe(claimAId);

    // 접수 전송 후 협력사 상세에 고객 원문·사진이 보인다(참조 노출).
    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);
    const partnerView = await api(P, 'GET', `/api/partner/pcb-as-cases/${String(asCaseId)}`);
    expect(partnerView.status, JSON.stringify(partnerView.json)).toBe(200);
    const brief = partnerView.json?.data?.asCase?.claim;
    expect(brief, '협력사에 클레임 요약 노출').not.toBeNull();
    expect(brief?.affectedQty).toBe(3);
    expect((brief?.files ?? []).length, '고객 사진 참조').toBe(1);
    const fileId = brief?.files?.[0]?.fileId;
    const download = await fetch(
      `${API_URL}/api/partner/pcb-as-cases/${String(asCaseId)}/claim-files/${String(fileId)}`,
      { headers: { authorization: `Bearer ${P}` } },
    );
    expect(download.status, '케이스 경유 클레임 사진 다운로드').toBe(200);
  }, 120_000);

  test('C3. 대리 접수 → 처리 불가 — activeKey 해제로 재접수가 열린다', async () => {
    const specB = specIds[1];
    expect(specB).toBeDefined();
    const created = await api(A, 'POST', `/api/admin/pcb-projects/${String(specB)}/claims`, {
      kind: 'damaged',
      affectedQty: 2,
      description: '전화 접수 — 모서리 파손 2장이라고 하십니다.',
      requestedRemedy: 'refund',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    claimBId = String(created.json?.data?.claim?.id ?? '');
    expect(created.json?.data?.claim?.createdByRole, '대리 접수 byRole').toBe('admin');
    let version = Number(created.json?.data?.claim?.version ?? 1);

    const review = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimBId}`, {
      action: 'start_review',
      expectedVersion: version,
    });
    expect(review.status).toBe(200);
    version = Number(review.json?.data?.claim?.version);

    const reject = await api(A, 'PATCH', `/api/admin/pcb-claims/${claimBId}`, {
      action: 'reject',
      expectedVersion: version,
      faultType: 'shipping_damage',
      response: '운송 중 파손으로 확인되어 운송사 보상 절차를 안내드립니다.',
    });
    expect(reject.status, JSON.stringify(reject.json)).toBe(200);
    expect(reject.json?.data?.claim?.status).toBe('rejected');
    expect(reject.json?.data?.claim?.asCaseId).toBeNull();

    // 종결로 activeKey 가 풀려 같은 스펙 재접수가 다시 열린다.
    const again = await fetch(`${API_URL}/api/pcb-claims`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CU}` },
      body: (() => {
        const f = new FormData();
        f.set('specId', String(specB));
        f.set('kind', 'other');
        f.set('affectedQty', '1');
        f.set('description', '재접수 개방 확인용 접수입니다.');
        f.set('requestedRemedy', 'consult');
        f.set('acknowledge', '1');
        return f;
      })(),
    });
    expect(again.status, '종결 후 재접수 개방').toBe(200);
  }, 120_000);

  test('C4. 메일 원장 — 접수 확인·판정 회신이 kind 로 남는다', async () => {
    const prisma = prismaOf();
    const logs = await prisma.spMailLog.findMany({
      where: { refType: 'pcb_spec', refId: { in: specIds.map(String) } },
      select: { kind: true },
    });
    const kinds = logs.map((l: any) => String(l.kind));
    expect(kinds, '접수 확인 기록').toContain('pcb_claim_received');
    expect(kinds, '판정 회신 기록').toContain('pcb_claim_decided');
  }, 60_000);
});
