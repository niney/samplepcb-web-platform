// BOM 국제 선적의 샘플피씨비 운송(Case ID) 갈래.
// 협력사 요청 → 관리자 큐 신호 → Case ID/운송장/B/L 게이트 → 실선적을 검증하고
// 만든 quote 이하 원장과 폴리모픽 파일 메타를 정확히 정리한다.
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run bom-caseref
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  disconnectPrisma,
  getPartner,
  getPrisma,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const PARTNER_NAME = 'tester2협력'; // CN — 국제 발송
const RUN_KEY = String(Date.now());
const KEEP_FIXTURE = process.env.KEEP_FIXTURE === '1'; // 브라우저 육안 검증용, 기본은 항상 정리

describe.skipIf(!RUN)('BOM 샘플피씨비 운송(Case ID) 갈래', () => {
  let partner: PartnerFixture;
  let adminToken = '';
  let partnerToken = '';
  let quoteId: bigint | null = null;
  let poId: bigint | null = null;
  let shipmentId: bigint | null = null;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3_600 });
    partnerToken = signJwt({ mbId: partner.mbId, ttlSec: 3_600 });

    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: 'e2e-bom-caseref',
        title: `[BOM Case ID ${RUN_KEY}] 국제 선적`,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
      },
    });
    quoteId = quote.id;
    const quoteItem = await prisma.spBomQuoteItem.create({
      data: {
        quoteId: quote.id,
        rowIdx: 0,
        included: true,
        mpn: 'BOM-CASE-ID-E2E',
        manufacturerName: 'SamplePCB',
        description: 'BOM Case ID shipping fixture',
        bomQty: 10,
        orderQty: 10,
        matchStatus: 'manual',
        selectionSource: 'admin',
        lineTotalKrw: 10_000,
      },
    });
    const po = await prisma.spBomPo.create({
      data: {
        quoteId: quote.id,
        partnerId: partner.id,
        status: 'confirmed',
        totalAmount: 10_000,
        currency: 'USD',
        confirmedAt: new Date(),
        items: {
          create: {
            quoteItemId: quoteItem.id,
            rfqItemId: null,
            mpn: quoteItem.mpn,
            manufacturerName: quoteItem.manufacturerName,
            description: quoteItem.description,
            supplierSku: null,
            qty: 10,
            unitPrice: 1_000,
            lineTotal: 10_000,
          },
        },
      },
    });
    poId = po.id;
  }, 60_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (KEEP_FIXTURE) {
      await disconnectPrisma();
      return;
    }
    const shipments =
      quoteId === null
        ? []
        : await prisma.spBomShipment.findMany({ where: { quoteId }, select: { id: true } });
    if (shipments.length > 0) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_bom_shipment', refId: { in: shipments.map((row: any) => row.id) } },
      });
    }
    if (quoteId !== null) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'bom_quote', refId: String(quoteId) },
      });
      await prisma.spBomQuote.deleteMany({ where: { id: quoteId } });
    }
    await disconnectPrisma();
  }, 60_000);

  test('B1. 협력사 준비 — 포장 원장·Invoice 후 해상 Case ID 운송을 요청한다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const created = await api(partnerToken, 'POST', '/api/partner/shipments', {
      poIds: [Number(poId)],
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    shipmentId = BigInt(created.json?.data?.shipmentId ?? 0);
    expect(shipmentId).toBeGreaterThan(0n);

    const draft = await api(
      partnerToken,
      'GET',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
    );
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const item = draft.json?.data?.items?.[0];
    expect(item?.expectedQty).toBe(10);
    const packed = await api(
      partnerToken,
      'PUT',
      `/api/partner/shipments/${String(shipmentId)}/packing-list`,
      {
        items: [
          {
            poItemId: item.poItemId,
            packages: [
              { packageId: null, quantity: 10, lotNo: `LOT-${RUN_KEY}`, dateCode: '26+' },
            ],
          },
        ],
      },
    );
    expect(packed.status, JSON.stringify(packed.json)).toBe(200);

    await getPrisma().spFile.create({
      data: {
        refType: 'sp_bom_shipment',
        refId: shipmentId,
        uploadFileName: `bom-caseref-${RUN_KEY}-invoice.pdf`,
        originFileName: 'invoice.pdf',
        pathToken: `e2e/bom-caseref/${RUN_KEY}/invoice.pdf`,
        size: 4,
        writeDate: new Date(),
        fileType: 'invoice',
        uploadedBy: 'PARTNER',
      },
    });
    const requested = await api(
      partnerToken,
      'POST',
      `/api/partner/pos/${String(poId)}/shipment/advance`,
      {
        shipDate: '2026-08-28',
        transport: 'sea',
        caseRefRequested: true,
        caseRefNote: '해상 포워더 부킹 Case ID 요청',
      },
    );
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    expect(requested.json?.data?.shipment).toMatchObject({
      status: 'requested',
      transport: 'sea',
      caseRef: null,
      caseRefNote: '해상 포워더 부킹 Case ID 요청',
    });
    expect(requested.json?.data?.shipment?.caseRefRequestedAt).not.toBeNull();
  }, 120_000);

  test('B2. 관리자 큐 — Case ID 요청을 별도 신호로 표시한다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const queue = await api(
      adminToken,
      'GET',
      '/api/admin/bom-shipments?tab=admin_pending&page=1&pageSize=100',
    );
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const row = (queue.json?.data?.items ?? []).find(
      (item: any) => item.groupPos?.some((member: any) => Number(member.poId) === Number(poId)),
    );
    expect(row?.adminPending).toBe(true);
    expect(row?.caseRefPending).toBe(true);
  });

  test('B3. 실선적 게이트 — Case ID 없이 409, B/L 없이 409', async (ctx) => {
    if (quoteId === null || poId === null) return ctx.skip();
    const path = `/api/admin/bom-quotes/${String(quoteId)}/pos/${String(poId)}/shipment`;
    const noCaseRef = await api(adminToken, 'PUT', path, {
      status: 'shipped',
      transport: 'sea',
      carrier: 'E2E Forwarder',
      trackingNumber: `BL-${RUN_KEY}`,
    });
    expect(noCaseRef.status, JSON.stringify(noCaseRef.json)).toBe(409);
    expect(noCaseRef.json?.error).toBe('CASE_REF_REQUIRED');

    const noBl = await api(adminToken, 'PUT', path, {
      status: 'shipped',
      transport: 'sea',
      carrier: 'E2E Forwarder',
      trackingNumber: `BL-${RUN_KEY}`,
      caseRef: `CASE-B-${RUN_KEY}`,
    });
    expect(noBl.status, JSON.stringify(noBl.json)).toBe(409);
    expect(noBl.json?.error).toBe('MISSING_BL_FILE');
  });

  test('B4. 관리자 처리 — B/L·Case ID·운송장을 함께 박제하고 요청 신호를 해제한다', async (ctx) => {
    if (quoteId === null || poId === null || shipmentId === null) return ctx.skip();
    await getPrisma().spFile.create({
      data: {
        refType: 'sp_bom_shipment',
        refId: shipmentId,
        uploadFileName: `bom-caseref-${RUN_KEY}-bl.pdf`,
        originFileName: 'bill-of-lading.pdf',
        pathToken: `e2e/bom-caseref/${RUN_KEY}/bill-of-lading.pdf`,
        size: 4,
        writeDate: new Date(),
        fileType: 'bill_of_lading',
        uploadedBy: 'ADMIN',
      },
    });
    const shipped = await api(
      adminToken,
      'PUT',
      `/api/admin/bom-quotes/${String(quoteId)}/pos/${String(poId)}/shipment`,
      {
        status: 'shipped',
        transport: 'sea',
        carrier: 'E2E Forwarder',
        trackingNumber: `BL-${RUN_KEY}`,
        caseRef: `CASE-B-${RUN_KEY}`,
      },
    );
    expect(shipped.status, JSON.stringify(shipped.json)).toBe(200);
    const shipment = shipped.json?.data?.pos?.find((row: any) => Number(row.poId) === Number(poId))
      ?.shipment;
    expect(shipment).toMatchObject({
      status: 'shipped',
      transport: 'sea',
      carrier: 'E2E Forwarder',
      trackingNumber: `BL-${RUN_KEY}`,
      caseRef: `CASE-B-${RUN_KEY}`,
    });
    expect(shipment?.caseRefFilledAt).not.toBeNull();

    const queue = await api(
      adminToken,
      'GET',
      '/api/admin/bom-shipments?tab=active&page=1&pageSize=100',
    );
    const row = (queue.json?.data?.items ?? []).find(
      (item: any) => Number(item.shipmentId) === Number(shipmentId),
    );
    expect(row?.caseRefPending).toBe(false);
  }, 120_000);
});
