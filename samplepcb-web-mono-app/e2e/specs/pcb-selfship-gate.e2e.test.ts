// 직접 발송(Case ID 미체크) '선적' 게이트 완화 회귀(2026-08-15) — 국제 '선적'의
// 운송장 필수는 Case ID 갈래 한정으로 좁혀졌다. 직접 발송은 운송 계약 주체가 협력사라
// 받는측(관리자·MD)이 값을 모르므로, 운송장·운송회사 없이도 전이가 열려야 한다
// (협력사가 준비 단계에 적어 둔 값이 있으면 body ?? 박제값으로 그대로 실린다).
// Case ID 갈래의 필수(CASE_REF_REQUIRED·MISSING_AWB_FILE·운송장)는 pcb-caseref 가 지킨다.
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run pcb-selfship-gate
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
  signJwt,
  type PartnerFixture,
} from '../helpers';

const PARTNER_NAME = 'tester2협력'; // CN 조직 — 관리자행(KR) 국제 체인
const PROJECT = 'E2E-SELFSHIP-board.zip';

describe.skipIf(!RUN)('직접 발송 선적 게이트 — 운송장 없이 받는측 전이', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let specId: bigint | null = null;
  let quoteId: bigint | null = null;
  let poId: number | null = null;
  let shipmentId: bigint | null = null;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    const prisma = getPrisma();
    const quote = await prisma.spQuote.create({
      data: {
        category: 'standard',
        orderCategory: 'sample',
        qty: 10,
        specJson: { layers: '2' },
        specHash: 'e2e-selfship-gate',
        autoPrice: 50000,
        priceVersion: 'e2e-selfship-gate',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    });
    quoteId = quote.id;
    const spec = await prisma.spOrderSpec.create({
      data: {
        mbId: 'tester',
        quoteId: quote.id,
        projectName: PROJECT,
        category: 'standard',
        orderCategory: 'sample',
        qty: 10,
        specJson: { layers: '2' },
        status: 'active',
        quoteStatus: 'quoted',
      },
    });
    specId = spec.id;
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: partner.id,
      status: 'produced',
      currency: 'USD',
      priceOriginal: 120,
    });
    poId = Number(po.id);
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (shipmentId !== null) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_pcb_shipment', refId: shipmentId },
      });
    }
    const poIds = poId === null ? [] : [BigInt(poId)];
    await cleanupPcbPos(poIds);
    if (specId !== null) {
      await prisma.spMailLog.deleteMany({ where: { refType: 'pcb_spec', refId: String(specId) } });
      await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    }
    if (quoteId !== null) await prisma.spQuote.deleteMany({ where: { id: quoteId } });
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('G1. 준비→선적 요청 — 운송장 없이(인보이스+출고예정일만)', async (ctx) => {
    if (poId === null) return ctx.skip();
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const created = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    expect(created?.mode, '국제 체인').toBe('international');
    shipmentId = created?.id ?? null;

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const form = new FormData();
    form.set('fileType', 'invoice');
    form.set('file', new File([pdf], 'invoice-selfship.pdf', { type: 'application/pdf' }));
    const up = await fetch(`${API_URL}/api/partner/pcb-pos/${String(poId)}/shipment/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: form,
    });
    expect(up.status, 'Invoice 첨부').toBe(200);

    const reqd = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-08-30',
    });
    expect(reqd.status, `선적 요청: ${JSON.stringify(reqd.json)}`).toBe(200);
  }, 120_000);

  test('G2. 받는측(관리자) 선적 — 무입력 전이가 열리고 운송장은 빈 채로 남는다', async (ctx) => {
    if (poId === null || specId === null || shipmentId === null) return ctx.skip();
    const adv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/shipment/advance`,
      {},
    );
    expect(adv.status, `선적: ${JSON.stringify(adv.json)}`).toBe(200);

    const row = await getPrisma().spPcbShipment.findUnique({ where: { id: shipmentId } });
    expect(String(row?.status), '선적 진입').toBe('shipped');
    expect(row?.trackingNumber, '운송장은 강제되지 않는다(원천=협력사)').toBeNull();
    expect(row?.carrier, '운송회사도 빈 채 허용').toBeNull();
    expect(row?.shippedAt, '선적 박제').not.toBeNull();
  }, 120_000);
});
