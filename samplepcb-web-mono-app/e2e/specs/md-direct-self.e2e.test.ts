// MD 직접 제작 회귀 — 하위 견적·하위 발주 없이 직접 회신한 건은 관리자→MD 발주서
// 자체가 EQ·생산·발송의 작업 단위다. 조직에 하위 관계가 있어도 이 건만 self 로 박제된다.
//
// 실행: pnpm -F e2e e2e md-direct-self (RUN 게이트만 — 거버·실로그인 자격 불필요)
// 생성물: e2e 전용 주문·스펙·RFQ·PO·선적을 afterAll 에서 leaf-first 전부 회수한다.
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
  createG5OrderFixture,
  deleteOrderHard,
  disconnectPrisma,
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  newSession,
  num,
  signJwt,
  snap,
  type E2eSession,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };

describe.skipIf(!RUN)('MD 직접 제작 — 하위 견적·발주 없이 완주', () => {
  let md: PartnerFixture;
  let order: G5OrderFixture | null = null;
  let view: E2eSession | null = null;
  let A = '';
  let M = '';
  let specId: bigint | null = null;
  let rfqId: bigint | null = null;
  let poId: bigint | null = null;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);

    md = await ensureStagePartner(MD);
    const sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'USD');
    if (md.mbId === null) throw new Error('MD 무대 계정 연결 실패');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    const spec = await getPrisma().spOrderSpec.create({
      data: {
        mbId: 'e2e-md-direct-customer',
        quoteId: `e2e-md-direct-${String(Date.now())}`,
        ctId: null,
        projectName: `e2e-md-direct-${String(Date.now())}.zip`,
        category: 'standard',
        orderCategory: 'sample',
        qty: 5,
        specJson: { kindPcb: 'Standard', layer: 2, quantity: 5 },
        status: 'active',
        quoteStatus: 'rfq',
      },
    });
    specId = spec.id;

    const rfq = await getPrisma().spPcbRfq.create({
      data: {
        specId: spec.id,
        partnerId: md.id,
        parentPartnerId: 0n,
        reorderRound: 0,
        status: 'requested',
        currency: 'KRW',
        requestedAt: new Date(),
      },
    });
    rfqId = rfq.id;
    view = await newSession({ mbId: md.mbId }, { partnerModule: 'pcb' });
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (poId !== null) await cleanupPcbPos([poId]);
    if (specId !== null) {
      await prisma.spMailLog.deleteMany({ where: { refType: 'pcb_spec', refId: String(specId) } });
    }
    if (rfqId !== null) await prisma.spPcbRfq.deleteMany({ where: { id: rfqId } });
    if (specId !== null) await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    if (order !== null) await deleteOrderHard(order.odId);

    if (poId !== null) {
      expect(await countPcbResidue([poId]), '직접 제작 PO 잔재').toEqual({
        pos: 0,
        shipments: 0,
        memberships: 0,
      });
    }
    if (rfqId !== null) {
      expect(await prisma.spPcbRfq.count({ where: { id: rfqId } }), '직접 회신 RFQ 잔재').toBe(0);
    }
    await view?.close();
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('S1. 하위 RFQ 0건으로 MD가 직접 회신하고 관리자 선정까지 간다', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    const replied = await api(M, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 510_000,
      quotedDeliveryDate: '2026-08-31',
      memo: '[E2E] MD 직접 회신·직접 제작',
    });
    expect(replied.status, JSON.stringify(replied.json)).toBe(200);

    const prisma = getPrisma();
    const direct = await prisma.spPcbRfq.findUnique({ where: { id: rfqId } });
    expect(direct?.selectedChildRfqId, '하위 선정 없음').toBeNull();
    expect(
      await prisma.spPcbRfq.count({ where: { specId, parentPartnerId: md.id } }),
      '하위 RFQ 없음',
    ).toBe(0);

    const selected = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 650_000 },
    );
    expect(selected.status, JSON.stringify(selected.json)).toBe(200);
  });

  test('S2. 관리자→MD 발주는 self로 박제되고 직접 EQ 버튼이 열린다', async (ctx) => {
    if (specId === null || rfqId === null || view === null) return ctx.skip();
    order = await createG5OrderFixture('e2e-md-direct-customer', 'e2e MD 직접제작 고객');
    await getPrisma().spOrderSpec.update({ where: { id: specId }, data: { ctId: order.ctId } });
    const issued = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(md.id),
      rfqId: num(rfqId),
    });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const po = (issued.json?.data?.pos ?? []).find(
      (row: any) => row.partnerId === num(md.id) && row.parentPartnerId === 0,
    );
    expect(po, '관리자→MD 발주서').toBeTruthy();
    poId = BigInt(po.poId);
    expect(po.fulfillmentMode, '직접 제작 박제').toBe('self');
    expect(po.eqBlocked, '하위 관계가 있어도 차단 안 함').toBe(false);
    expect(po.eqDelegatePoId).toBeNull();

    const childAttempt = await api(
      M,
      'POST',
      `/api/partner/pcb-pos/${String(poId)}/children`,
      {},
    );
    expect(childAttempt.status, JSON.stringify(childAttempt.json)).toBe(409);
    expect(childAttempt.json?.error).toBe('SELF_FULFILLMENT');

    await view.page.goto(`${BASE_URL}/app/partner/pcb/pos/${String(poId)}`);
    await view.page.waitForLoadState('networkidle').catch(() => undefined);
    const body = await view.page.locator('body').innerText();
    expect(body).toContain('직접 제작 발주입니다');
    expect(body).not.toContain('하위 발주 필요');
    expect(await view.page.getByRole('button', { name: 'EQ 승인요청' }).isVisible()).toBe(true);
    expect(await view.page.getByRole('button', { name: '하위 발주' }).count()).toBe(0);
    await snap(view.page, 'md-direct-self/S02-self-po-ready');
  });

  test('S3. MD가 상위 발주서에서 EQ·생산을 직접 끝내고 관리자행 발송을 연다', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    for (const [method, path, token] of [
      ['POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, M],
      ['POST', `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`, A],
      ['POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, M],
      ['POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, M],
    ] as const) {
      const result = await api(token, method, path, {});
      expect(result.status, `${path}: ${JSON.stringify(result.json)}`).toBe(200);
    }

    const detail = await api(M, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    expect(detail.json?.data?.status).toBe('produced');
    expect(detail.json?.data?.fulfillmentMode).toBe('self');
    expect(detail.json?.data?.children).toEqual([]);

    const currentPoId = num(poId);
    const boxed = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: currentPoId });
    expect(boxed.status, JSON.stringify(boxed.json)).toBe(200);
    const box = (boxed.json?.data?.boxes ?? []).find((row: any) =>
      row.poIds?.includes(currentPoId),
    );
    expect(box, '직접 제작 발송 박스').toBeTruthy();
    expect(box.receiverKind, 'MD→관리자 직접 발송').toBe('admin');
  });
});
