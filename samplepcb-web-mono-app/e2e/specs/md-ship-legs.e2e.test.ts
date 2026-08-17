// MD 경유 선적의 두 구간(하위→MD·MD→자사) 처리 회귀(2026-08-14 검토 확정).
//
// 한 건이 선적 두 장으로 갈라지는 것은 물리 현실이고, 위험한 축들은 구간을 갈라 봐야 한다:
//   ① 협력사 구간(받는곳=MD)은 관리자 차례가 아니다 — adminTurn=false, pending 탭 불오염
//   ② 협력사 구간 숨김 토글(mdLegs=hide)은 서버 필터 — counts 와 목록이 함께 움직이고,
//      걸러진 수(hiddenMdCount)가 응답에 실려 소실이 침묵하지 않는다
//   ③ **MD 입고(leg1 received)는 고객 배송 대기(to_ship)를 열지 않는다** — 자사 입고
//      (receiverKind='admin')만 연다(PCB_SHIP_JOIN 의 계약)
//   ④ 자사향 행의 구성원에 앞 구간 요약(mdLeg)이 실린다 — 협력사 구간을 숨겨도
//      병목(하위가 어디까지 왔나)이 읽힌다. 협력사 구간 행 자신에는 싣지 않는다.
//
// 무대: md-eq-observe 와 같은 자기창조(e2e 전용 계정) + 국내 하위(협력1·KR)로
// 두 구간 모두 domestic — 게이트가 운송장뿐이라 시드가 가볍다.
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run md-ship-legs
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
  signJwt,
  type PartnerFixture,
} from '../helpers';

const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub1', orgName: '협력1', country: 'KR', currency: 'KRW' };
const PROJECT = 'E2E-MDLEGS-board.zip';
const CUSTOMER = { mbId: 'e2e-mdlegs-cust', name: '엠디레그고객', finalPrice: 55000 };

describe.skipIf(!RUN)('MD 두 구간 선적 — 협력사 구간의 축 분리', () => {
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = '';
  let M = '';
  let C = '';
  let specId: bigint | null = null;
  let quoteId: bigint | null = null;
  let odId: string | null = null;
  let ctId: number | null = null;
  let topPoId: number | null = null;
  let childPoId: number | null = null;
  let leg1Id: number | null = null;
  const poIds: bigint[] = [];

  /** g5 회원·결제(입금) 주문 시드 — demo 러너 로컬판 패턴(행 복제·금액만 교체). */
  const seedPaidOrder = async (): Promise<void> => {
    const prisma = getPrisma();
    const member: any[] = await prisma.$queryRawUnsafe(
      `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
      CUSTOMER.mbId,
    );
    if (member.length === 0) {
      const cols: any[] = await prisma.$queryRawUnsafe(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_member' AND COLUMN_NAME <> 'mb_no'`,
      );
      const overrides: Record<string, string> = {
        mb_id: `'${CUSTOMER.mbId}'`,
        mb_name: `'${CUSTOMER.name}'`,
        mb_nick: `'${CUSTOMER.name}'`,
        mb_email: `'${CUSTOMER.mbId}@test.local'`,
        mb_datetime: 'NOW()',
      };
      const names = cols.map((c: any) => String(c.COLUMN_NAME));
      await prisma.$executeRawUnsafe(
        `INSERT INTO g5_member (${names.map((n: string) => `\`${n}\``).join(', ')})
          SELECT ${names.map((n: string) => overrides[n] ?? `\`${n}\``).join(', ')}
            FROM g5_member WHERE mb_id = 'tester'`,
      );
    }

    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
    odId = kst;
    const orderCols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_order'`,
    );
    const odOverrides: Record<string, string> = {
      od_id: `'${odId}'`,
      mb_id: `'${CUSTOMER.mbId}'`,
      od_name: `'${CUSTOMER.name}'`,
      od_email: `'${CUSTOMER.mbId}@test.local'`,
      od_status: `'입금'`,
      od_settle_case: `'무통장'`,
      od_cart_price: String(CUSTOMER.finalPrice),
      od_cart_coupon: '0',
      od_send_cost: '0',
      od_send_coupon: '0',
      od_receipt_price: String(CUSTOMER.finalPrice),
      od_misu: '0',
      od_cancel_price: '0',
      od_refund_price: '0',
      od_receipt_time: 'NOW()',
      od_delivery_company: `''`,
      od_invoice: `''`,
      od_invoice_time: `'0000-00-00 00:00:00'`,
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
      mb_id: `'${CUSTOMER.mbId}'`,
      it_name: `'${PROJECT}'`,
      ct_status: `'입금'`,
      ct_price: String(CUSTOMER.finalPrice),
      ct_qty: '1',
      io_id: `''`,
      io_price: '0',
      ct_point: '0',
      ct_send_cost: '0',
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
    ctId = Number(inserted[0]?.ct_id ?? 0);
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);

    md = await ensureStagePartner(MD);
    sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'KRW');
    if (md.mbId === null || sub.mbId === null) throw new Error('무대 계정 연결 실패');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: sub.mbId, ttlSec: 3600 });

    // 결제 주문 + 스펙 — ③(to_ship 게이트)은 주문 축이라 실제 od 가 있어야 검증이 된다.
    await seedPaidOrder();
    const prisma = getPrisma();
    const quote = await prisma.spQuote.create({
      data: {
        category: 'standard',
        orderCategory: 'sample',
        qty: 10,
        specJson: { layers: '2' },
        specHash: 'e2e-mdlegs',
        autoPrice: CUSTOMER.finalPrice,
        priceVersion: 'e2e-mdlegs',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    });
    quoteId = quote.id;
    const spec = await prisma.spOrderSpec.create({
      data: {
        mbId: CUSTOMER.mbId,
        quoteId: quote.id,
        ctId,
        projectName: PROJECT,
        category: 'standard',
        orderCategory: 'sample',
        qty: 10,
        specJson: { layers: '2' },
        status: 'active',
        quoteStatus: 'quoted',
        finalPrice: CUSTOMER.finalPrice,
        pricedBy: 'admin',
        pricedAt: new Date(),
      },
    });
    specId = spec.id;

    const top = await createPcbPo({
      specId: spec.id,
      partnerId: md.id,
      status: 'produced',
      currency: 'KRW',
      priceOriginal: 500000,
      fulfillmentMode: 'delegated',
    });
    poIds.push(top.id);
    topPoId = Number(top.id);
    const child = await createPcbPo({
      specId: spec.id,
      partnerId: sub.id,
      parentPartnerId: md.id,
      status: 'produced',
      currency: 'KRW',
      priceOriginal: 400000,
    });
    poIds.push(child.id);
    childPoId = Number(child.id);
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (specId !== null) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: String(specId) },
      });
    }
    await cleanupPcbPos(poIds); // 선적·멤버십·QR 패키지(cascade)까지
    if (specId !== null) await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    if (quoteId !== null) await prisma.spQuote.deleteMany({ where: { id: quoteId } });
    if (ctId !== null) {
      await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_cart WHERE ct_id = ?`, ctId);
    }
    if (odId !== null) {
      await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_order WHERE od_id = ?`, odId);
    }
    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await disconnectPrisma();
  }, 60_000);

  test('S1. 협력사 구간 생성 — adminTurn=false, pending 탭 불오염', async (ctx) => {
    if (childPoId === null) return ctx.skip();
    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    // 국내(하위 KR→MD KR) 첫 전이 — 운송장 게이트.
    const adv = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber: 'MDLEGS-LEG1-001',
    });
    expect(adv.status, JSON.stringify(adv.json)).toBe(200);

    const all = await api(A, 'GET', `/api/admin/pcb-shipments?tab=all&pageSize=100&q=${encodeURIComponent(PROJECT)}`);
    expect(all.status).toBe(200);
    const rows: any[] = all.json?.data?.items ?? [];
    const leg1 = rows.find((r: any) => r.receiverKind === 'md');
    expect(leg1, '협력사 구간 행 존재(기본 표시)').toBeTruthy();
    leg1Id = Number(leg1.shipmentId);
    expect(leg1.adminTurn, '① 관리자 차례 아님').toBe(false);
    expect(leg1.members[0]?.mdLeg ?? null, '④ 자기 자신에는 교차 표기 없음').toBeNull();

    const pending = await api(A, 'GET', `/api/admin/pcb-shipments?tab=pending&pageSize=100&q=${encodeURIComponent(PROJECT)}`);
    const pendingMine = (pending.json?.data?.items ?? []).filter(
      (r: any) => Number(r.shipmentId) === leg1Id,
    );
    expect(pendingMine.length, '① pending 탭 불오염').toBe(0);
  }, 120_000);

  test('S2. 숨김 토글 — 서버 필터·counts 일관·hiddenMdCount', async (ctx) => {
    if (leg1Id === null) return ctx.skip();
    const q = encodeURIComponent(PROJECT);
    const shown = await api(A, 'GET', `/api/admin/pcb-shipments?tab=all&pageSize=100&q=${q}`);
    const hidden = await api(A, 'GET', `/api/admin/pcb-shipments?tab=all&pageSize=100&q=${q}&mdLegs=hide`);
    expect(hidden.status).toBe(200);

    const shownRows: any[] = shown.json?.data?.items ?? [];
    const hiddenRows: any[] = hidden.json?.data?.items ?? [];
    expect(shownRows.some((r: any) => r.receiverKind === 'md'), '표시 모드에 협력사 구간').toBe(true);
    expect(hiddenRows.every((r: any) => r.receiverKind !== 'md'), '숨김 모드는 전량 자사향').toBe(true);
    expect(hidden.json?.data?.hiddenMdCount, '② 걸러진 수가 응답에').toBeGreaterThanOrEqual(1);
    // counts 는 필터 뒤 계산 — 목록과 어긋나지 않는다(all = 숨김 목록의 박스 수).
    expect(hidden.json?.data?.counts.all, '② counts 일관').toBe(hidden.json?.data?.total);
    expect(shown.json?.data?.counts.all - hidden.json?.data?.counts.all).toBe(
      hidden.json?.data?.hiddenMdCount,
    );
  }, 120_000);

  test('S3. MD 입고는 고객 배송 대기(to_ship)를 열지 않는다', async (ctx) => {
    if (childPoId === null || odId === null) return ctx.skip();
    const recv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: 'MD 검수 입고',
    });
    expect(recv.status, JSON.stringify(recv.json)).toBe(200);

    const toShip = await api(A, 'GET', `/api/admin/pcb-orders?tab=to_ship&pageSize=100&q=${encodeURIComponent(odId)}`);
    expect(toShip.status).toBe(200);
    const mine = (toShip.json?.data?.items ?? []).filter((r: any) => String(r.odId) === odId);
    expect(mine.length, '③ MD 입고만으로는 배송 대기에 서지 않는다').toBe(0);
  }, 120_000);

  test('S4. 자사향 구간 — 교차 표기(mdLeg)·자사 입고 후 to_ship 개방', async (ctx) => {
    if (topPoId === null || odId === null || specId === null) return ctx.skip();
    // 하위 입고가 끝났으니 상위 출고 게이팅이 열려 있다.
    const box = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `상위 담기(게이팅 해제): ${JSON.stringify(box.json)}`).toBe(200);
    const adv = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/shipment/advance`, {
      carrier: 'CJ대한통운',
      trackingNumber: 'MDLEGS-LEG2-001',
    });
    expect(adv.status, JSON.stringify(adv.json)).toBe(200);

    const all = await api(A, 'GET', `/api/admin/pcb-shipments?tab=all&pageSize=100&q=${encodeURIComponent(PROJECT)}`);
    const rows: any[] = all.json?.data?.items ?? [];
    const leg2 = rows.find((r: any) => r.receiverKind === 'admin');
    expect(leg2, '자사향 구간 행').toBeTruthy();
    const member = leg2.members.find((m: any) => Number(m.poId) === topPoId);
    expect(member?.mdLeg, '④ 앞 구간 교차 표기').toBeTruthy();
    expect(member?.mdLeg?.receivedAt, '④ MD 입고완료 신호').not.toBeNull();

    // 자사 입고 → 그제서야 고객 배송 대기가 열린다(③의 대조군).
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(topPoId)}/shipment/receive`,
      { note: '자사 입고 검수' },
    );
    expect(recv.status, JSON.stringify(recv.json)).toBe(200);
    const toShip = await api(A, 'GET', `/api/admin/pcb-orders?tab=to_ship&pageSize=100&q=${encodeURIComponent(odId)}`);
    const mine = (toShip.json?.data?.items ?? []).filter((r: any) => String(r.odId) === odId);
    expect(mine.length, '자사 입고 후 배송 대기 개방').toBe(1);
  }, 120_000);
});
