// 데모 주행 — **국제 발송 시작 전**(생산완료·미편성)에서 멈추고 남긴다
// (정리 없음 · 2026-08-13 사용자 요청).
//
// demo-bulk3-keep(완주·세 탭 분포)의 자매편: 그쪽이 "보낸 뒤"의 화면을 채웠다면,
// 이 편은 **보내기 전**을 채운다 — 협력사(CN, 국제)가 생산을 끝냈는데 아직 아무
// 발송 행동을 하지 않은 상태. 그래서 남는 자리가 둘이다:
//   ① 관리자 선적·배송 워크큐 '발송 대기' 탭(발주서 축 — 선적 문서가 아직 없는 모수)
//   ② 협력사 포털 [📦 PCB 보내기] 보드의 **선반**(담기 전) — 여기서 담기→선적 요청을
//      사람이 직접 이어가며 국제 발송 흐름을 관찰할 수 있다.
// 확정가·입금 주문까지 실물처럼 세워 두므로(작성 사전은 demo-bulk3-keep D1과 동일)
// 이어가면 입고확인→고객 배송→구매확정까지 완주 가능하다.
//
// 실행: cd e2e && PORTAL_E2E=1 DEMO_KEEP=1 npx vitest run demo-intl-preship-keep
// 정리(원할 때 수동): projectName LIKE 'DEMO-INTL-%' — wipe 순서는 demo-bulk3-keep 동일.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const DEMO = process.env.DEMO_KEEP === '1';
const PARTNER_NAME = 'tester2협력'; // CN 조직(계정 tester2) — 국제 컨텍스트
const SEED_SIZE = 3;
const CUSTOMERS = [
  { mbId: 'demo-cust1', name: '김데모', finalPrice: 55000 },
  { mbId: 'demo-cust2', name: '이샘플', finalPrice: 60500 },
  { mbId: 'demo-cust3', name: '박테스트', finalPrice: 77000 },
] as const;

describe.skipIf(!RUN || !DEMO)('데모 — 국제 발송 시작 전(남김)', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  const specIds: bigint[] = [];
  const poIds: bigint[] = [];
  const odIds: string[] = [];

  /** demo-bulk3-keep 과 같은 복제 시드 — 고객은 상설이라 있으면 그대로 쓴다. */
  const ensureDemoCustomer = async (mbId: string, name: string): Promise<void> => {
    const prisma = getPrisma();
    const found: any[] = await prisma.$queryRawUnsafe(
      `SELECT mb_id FROM g5_member WHERE mb_id = ?`,
      mbId,
    );
    if (found.length > 0) return;
    const cols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_member' AND COLUMN_NAME <> 'mb_no'`,
    );
    const overrides: Record<string, string> = {
      mb_id: `'${mbId}'`,
      mb_name: `'${name}'`,
      mb_nick: `'${name}'`,
      mb_email: `'${mbId}@test.local'`,
      mb_datetime: 'NOW()',
    };
    const names = cols.map((c) => String(c.COLUMN_NAME));
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_member (${names.map((n) => `\`${n}\``).join(', ')})
        SELECT ${names.map((n) => overrides[n] ?? `\`${n}\``).join(', ')}
          FROM g5_member WHERE mb_id = 'tester'`,
    );
  };

  const wipeDemo = async (): Promise<void> => {
    const prisma = getPrisma();
    const specs = await prisma.spOrderSpec.findMany({
      where: { projectName: { startsWith: 'DEMO-INTL-' } },
      select: { id: true, quoteId: true, ctId: true },
    });
    if (specs.length === 0) return;
    const ids = specs.map((s) => s.id);
    const pos = await prisma.spPcbPo.findMany({ where: { specId: { in: ids } }, select: { id: true } });
    await prisma.spPcbShipment.deleteMany({ where: { poId: { in: pos.map((p) => p.id) } } });
    await prisma.spPcbShipmentPo.deleteMany({ where: { poId: { in: pos.map((p) => p.id) } } });
    await prisma.spPcbPo.deleteMany({ where: { specId: { in: ids } } });
    const ctIds = specs.map((s) => s.ctId).filter((v): v is number => v !== null);
    if (ctIds.length > 0) {
      const carts: any[] = await prisma.$queryRawUnsafe(
        `SELECT ct_id, od_id FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      const odList = [...new Set(carts.map((c) => String(c.od_id)))];
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      if (odList.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM g5_shop_order WHERE od_id IN (${odList.map(() => '?').join(',')})`,
          ...odList,
        );
      }
    }
    await prisma.spOrderSpec.deleteMany({ where: { id: { in: ids } } });
    await prisma.spQuote.deleteMany({ where: { id: { in: specs.map((s) => s.quoteId) } } });
    console.log(`[demo-intl] 이전 데모 정리 — spec ${ids.map(String).join(', ')}`);
  };

  const seedDemoOrder = async (
    odId: string,
    cust: { mbId: string; name: string; finalPrice: number },
    projectName: string,
  ): Promise<number> => {
    const prisma = getPrisma();
    const orderCols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_order'`,
    );
    const odOverrides: Record<string, string> = {
      od_id: `'${odId}'`,
      mb_id: `'${cust.mbId}'`,
      od_name: `'${cust.name}'`,
      od_email: `'${cust.mbId}@test.local'`,
      od_status: `'입금'`,
      od_settle_case: `'무통장'`,
      od_cart_price: String(cust.finalPrice),
      od_cart_coupon: '0',
      od_send_cost: '0',
      od_send_coupon: '0',
      od_receipt_price: String(cust.finalPrice),
      od_misu: '0',
      od_cancel_price: '0',
      od_refund_price: '0',
      od_receipt_time: 'NOW()',
      od_delivery_company: `''`,
      od_invoice: `''`,
      od_invoice_time: `'0000-00-00 00:00:00'`,
      od_time: 'NOW()',
    };
    const odNames = orderCols.map((c) => String(c.COLUMN_NAME));
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_shop_order (${odNames.map((n) => `\`${n}\``).join(', ')})
        SELECT ${odNames.map((n) => odOverrides[n] ?? `\`${n}\``).join(', ')}
          FROM g5_shop_order WHERE od_status = '완료' ORDER BY od_id DESC LIMIT 1`,
    );
    const cartCols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'g5_shop_cart' AND COLUMN_NAME <> 'ct_id'`,
    );
    const ctOverrides: Record<string, string> = {
      od_id: `'${odId}'`,
      mb_id: `'${cust.mbId}'`,
      it_name: `'${projectName}'`,
      ct_status: `'입금'`,
      ct_price: String(cust.finalPrice), // 라인가 VAT 포함 전제(demo-bulk3-keep 실측 사전)
      ct_qty: '1',
      io_id: `''`,
      io_price: '0',
      ct_point: '0',
      ct_send_cost: '0',
      ct_time: 'NOW()',
    };
    const ctNames = cartCols.map((c) => String(c.COLUMN_NAME));
    await prisma.$executeRawUnsafe(
      `INSERT INTO g5_shop_cart (${ctNames.map((n) => `\`${n}\``).join(', ')})
        SELECT ${ctNames.map((n) => ctOverrides[n] ?? `\`${n}\``).join(', ')}
          FROM g5_shop_cart WHERE ct_status <> '쇼핑' ORDER BY ct_id DESC LIMIT 1`,
    );
    const inserted: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_id FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id DESC LIMIT 1`,
      odId,
    );
    return Number(inserted[0]?.ct_id ?? 0);
  };

  afterAll(async () => {
    console.log(
      `[demo-intl-preship] 남긴 것(발송 시작 전): PO ${poIds.map(String).join(', ')} · ` +
        `spec ${specIds.map(String).join(', ')} · 주문 ${odIds.join(', ')}`,
    );
    await disconnectPrisma();
  });

  test('I1. 시드 — 국제(CN) 생산완료 발주 3장 + 확정가·입금 주문(발송 행동 없음)', async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — API dev 서버 확인`);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    await wipeDemo();
    const prisma = getPrisma();
    for (const [i, cust] of CUSTOMERS.entries()) {
      await ensureDemoCustomer(cust.mbId, cust.name);
      const projectName = `DEMO-INTL-${'ABC'[i] ?? ''}-board.zip`;
      const specJson = { width: '80', length: '60', layers: '4', thickness: '1.6' };
      const quote = await prisma.spQuote.create({
        data: {
          category: 'standard',
          orderCategory: 'sample',
          qty: 5 * (i + 1),
          specJson,
          specHash: `demo-intl-${cust.mbId}`,
          autoPrice: cust.finalPrice,
          priceVersion: 'demo-intl',
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });
      const kst = new Date(Date.now() + 9 * 3600 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace(/[-T:]/g, '');
      const odId = String(Number(kst) + i);
      odIds.push(odId);
      const ctId = await seedDemoOrder(odId, cust, projectName);
      expect(ctId, '카트 행 생성').toBeGreaterThan(0);
      const spec = await prisma.spOrderSpec.create({
        data: {
          mbId: cust.mbId,
          quoteId: quote.id,
          ctId,
          projectName,
          category: 'standard',
          orderCategory: 'sample',
          qty: 5 * (i + 1),
          specJson,
          status: 'active',
          quoteStatus: 'quoted',
          finalPrice: cust.finalPrice,
          pricedBy: 'admin',
          pricedAt: new Date(),
        },
      });
      specIds.push(spec.id);
      const po = await createPcbPo({
        specId: spec.id,
        partnerId: partner.id,
        status: 'produced',
        currency: 'USD',
        priceOriginal: 90 + 10 * i,
      });
      poIds.push(po.id);
      console.log(
        `[demo-intl] ${cust.name}(${cust.mbId}) spec ${String(spec.id)} 주문 ${odId}(입금) → PO #${String(po.id)} 생산완료`,
      );
    }
    // 발송 시작 전 — 선적 문서·멤버십이 하나도 없어야 한다.
    const memberships = await prisma.spPcbShipmentPo.count({ where: { poId: { in: poIds } } });
    expect(memberships, '박스 미편성(발송 행동 0)').toBe(0);
  }, 180_000);

  test('I2. 관리자 워크큐 — 발송 대기(발주서 축)에 3건이 선다', async (ctx) => {
    if (poIds.length < SEED_SIZE) return ctx.skip();
    const q = await api(A, 'GET', '/api/admin/pcb-pos?tab=to_ship&pageSize=50');
    expect(q.status).toBe(200);
    const rows: any[] = q.json?.data?.items ?? [];
    const mine = rows.filter((r: any) => poIds.some((id) => Number(id) === Number(r.poId)));
    expect(mine.length, '발송 대기 3건').toBe(SEED_SIZE);
    for (const r of mine) {
      expect(String(r.status), `PO-${String(r.poId)} 생산완료`).toBe('produced');
    }
    console.log(
      `[demo-intl] 발송 대기 실측 — ${mine.map((r: any) => `PO-${String(r.poId)} ${String(r.customerName)}`).join(' · ')}`,
    );
  }, 60_000);

  test('I3. 협력사 보내기 보드 — 선반에 3건(담기 전·국제 컨텍스트)', async (ctx) => {
    if (poIds.length < SEED_SIZE) return ctx.skip();
    const board = await api(P, 'GET', '/api/partner/pcb-shipments');
    expect(board.status, `보드: ${JSON.stringify(board.json).slice(0, 200)}`).toBe(200);
    const shelf: any[] = board.json?.data?.shelf ?? [];
    const mine = shelf.filter((s: any) => poIds.some((id) => Number(id) === Number(s.poId)));
    expect(mine.length, '선반 3건(보내기 전)').toBe(SEED_SIZE);
    for (const s of mine) {
      // 받는 곳 = 자사(직송·MD 아님) — 국제 여부는 조직 국가(CN→KR)로 담기 때 파생된다.
      expect(String(s.contextKey).startsWith('admin:'), `컨텍스트 ${String(s.contextKey)}`).toBe(true);
    }
    // 이 발주들로 만든 박스·진행 발송이 없어야 "보내기 단계 전"이다.
    const boxes: any[] = board.json?.data?.boxes ?? [];
    const active: any[] = board.json?.data?.active ?? [];
    const touched = [...boxes, ...active].filter((b: any) =>
      (b.poIds ?? []).some((pid: number) => poIds.some((id) => Number(id) === pid)),
    );
    expect(touched.length, '박스·진행 발송 0').toBe(0);
    console.log(
      `[demo-intl] 선반 실측 — ${mine.map((s: any) => `PO-${String(s.poId)} ${String(s.projectName)} → ${String(s.receiverLabel)}`).join(' · ')}`,
    );
  }, 60_000);
});
