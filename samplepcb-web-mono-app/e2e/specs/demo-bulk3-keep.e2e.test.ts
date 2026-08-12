// 데모 주행 — **3건 다중 고객 묶음을 고객 배송·구매확정까지 완주하고 남긴다**
// (정리 없음 · 2026-08-13 사용자 요청, 완주 확장 같은 날).
//
// 여정 19호(대량 묶음)의 축소 미러이되 목적이 다르다: 검증이 아니라 **화면 관찰용
// 실데이터**다. 현재 dev DB 는 예전 백업 복구본이라 e2e 상설 픽스처가 없다. 그래서
// ① 데모 고객 3명을 g5 에 직접 세우고(tester 행 복제 — 비밀번호 해시 승계, 로컬 전용),
// ② 스펙마다 실제 sp_quote 행 + **확정가(finalPrice·quoted)** 를 채운다 — Case 상세
//    확정가 영역은 `spec.finalPrice ?? quote.autoPrice` 라 둘 다 없으면 빈다(1차 시드의
//    구멍 — 사용자 관찰로 발각),
// ③ **고객 주문(od·cart)도 실주문 행 복제로 세운다** — 고객 배송 큐는 주문 축이라
//    (listPcbOrderSpecs INNER JOIN + PCB_TO_SHIP = 입금류 ∧ 입고확인) 주문이 없으면
//    입고 뒤 흐름이 화면에 아예 없다(1차 완주 불가의 원인),
// ④ 입고확인 → 배송 처리(force-status 배송+운송장) → 구매확정(완료)까지 완주하고,
// ⑤ afterAll 정리를 하지 않는다. 재실행 시 이전 데모 산출물(프로젝트명 DEMO-3BOX-
//    접두)은 주문·카트까지 지우고 새로 만든다(멱등 데모).
//
// 실행: cd e2e && PORTAL_E2E=1 DEMO_KEEP=1 npx vitest run demo-bulk3-keep
// 정리(원할 때 수동): projectName LIKE 'DEMO-3BOX-%' 스펙의 shipment→po→spec→quote→
// cart→order 순 삭제(이 파일 wipeDemo 와 동일), 데모 고객은 g5_member demo-cust1~3.
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
const PARTNER_NAME = 'tester2협력'; // 현 DB 의 CN 조직(계정 tester2) — 국제 체인 데모
const BOX_SIZE = 3;
const TRACKING = 'DEMO-3BOX-0813';
/** 데모 고객 3명 — g5 실회원으로 세워야 고객명 사전(mb_name fallback)이 이름을 찾는다. */
const CUSTOMERS = [
  { mbId: 'demo-cust1', name: '김데모', finalPrice: 66000 },
  { mbId: 'demo-cust2', name: '이샘플', finalPrice: 72000 },
  { mbId: 'demo-cust3', name: '박테스트', finalPrice: 85000 },
] as const;

describe.skipIf(!RUN || !DEMO)('데모 — 3건 다중 고객 묶음(남김)', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  const specIds: bigint[] = [];
  const poIds: bigint[] = [];
  const odIds: string[] = [];
  let repPoId: number | null = null;
  let shipmentId: bigint | null = null;

  /** g5 회원 복제 시드(멱등) — helpers.cloneG5Member 는 소스가 .env 1번 고객 고정이라
   *  (복구본에 없음) 소스만 tester 로 바꾼 로컬판. 해시 승계 원칙은 동일하다. */
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

  /** 이전 데모 산출물 제거(멱등 재실행) — 이 데모가 만든 것만 정확히 겨냥한다. */
  const wipeDemo = async (): Promise<void> => {
    const prisma = getPrisma();
    const specs = await prisma.spOrderSpec.findMany({
      where: { projectName: { startsWith: 'DEMO-3BOX-' } },
      select: { id: true, quoteId: true, ctId: true },
    });
    if (specs.length === 0) return;
    const ids = specs.map((s) => s.id);
    const pos = await prisma.spPcbPo.findMany({ where: { specId: { in: ids } }, select: { id: true } });
    await prisma.spPcbShipment.deleteMany({ where: { poId: { in: pos.map((p) => p.id) } } });
    await prisma.spPcbShipmentPo.deleteMany({ where: { poId: { in: pos.map((p) => p.id) } } });
    await prisma.spPcbPo.deleteMany({ where: { specId: { in: ids } } });
    // 데모 주문·카트 — spec.ctId 로만 겨냥한다(실주문은 ctId 연결이 다른 스펙 소유).
    const ctIds = specs.map((s) => s.ctId).filter((v): v is number => v !== null);
    if (ctIds.length > 0) {
      const carts: any[] = await prisma.$queryRawUnsafe(
        `SELECT ct_id, od_id FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      const odIds = [...new Set(carts.map((c) => String(c.od_id)))];
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      if (odIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM g5_shop_order WHERE od_id IN (${odIds.map(() => '?').join(',')})`,
          ...odIds,
        );
      }
    }
    await prisma.spOrderSpec.deleteMany({ where: { id: { in: ids } } });
    await prisma.spQuote.deleteMany({ where: { id: { in: specs.map((s) => s.quoteId) } } });
    console.log(`[demo] 이전 데모 정리 — spec ${ids.map(String).join(', ')}`);
  };

  /** g5 주문+카트 시드 — 최근 실주문 행을 템플릿으로 복제(회원 복제와 같은 이유:
   *  코어 컬럼 수십 개를 손으로 안 나열해도 스키마 변화를 따라간다). 금액·신원·상태만
   *  갈아끼운다: od_status='입금'(결제 완료·배송 전 — PCB_TO_SHIP 의 전제), 미수 0. */
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
      // 신규 computeOrderMoney 는 라인가 VAT **포함** 전제(레거시 ×1.1 이관 함정과 동일
      // 사전) — 공급가를 넣으면 재계산이 주문금액을 낮게 세워 과입금(−7,727)이 붙는다.
      ct_price: String(cust.finalPrice),
      ct_qty: '1',
      // 템플릿 행의 옵션가(io_price)를 그대로 두면 force-status 의 코어 재계산이
      // (ct_price+io_price)×1.1 로 주문금액을 다시 세워 **미수 198만**이 붙는다(실측).
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
    // 의도적으로 정리하지 않는다 — 이 주행의 산출물이 곧 목적(화면 관찰용).
    console.log(
      `[demo-bulk3-keep] 남긴 것: shipment #${String(shipmentId)} · ` +
        `PO ${poIds.map(String).join(', ')} · spec ${specIds.map(String).join(', ')} · ` +
        `주문 ${odIds.join(', ')}`,
    );
    await disconnectPrisma();
  });

  test('D1. 시드 — 고객 3명 + 확정가 있는 스펙 3장 + 생산완료 발주 3장', async () => {
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
      const projectName = `DEMO-3BOX-${'ABC'[i] ?? ''}-board.zip`;
      const specJson = { width: '50', length: '50', layers: '2', thickness: '1.6' };
      // 확정가 영역의 두 원천 중 finalPrice 가 정본(관리자 확정) — quote 행도 실물로
      // 세워 상세의 spQuote 조회·autoPrice fallback 경로까지 화면과 같은 모양을 만든다.
      const quote = await prisma.spQuote.create({
        data: {
          category: 'standard',
          orderCategory: 'sample',
          qty: 10 * (i + 1),
          specJson,
          specHash: `demo-3box-${cust.mbId}`,
          autoPrice: cust.finalPrice,
          priceVersion: 'demo-3box',
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });
      // 주문 축 — 결제(입금) 완료 주문을 세우고 spec.ctId 로 잇는다. 이 연결이 없으면
      // 고객 배송 큐(od INNER JOIN)에 안 잡혀 입고 뒤 흐름이 화면에 존재하지 않는다.
      // ⚠ od_id 는 코어 관례(YYYYMMDDHHMMSS, 14자리)로 — bigint 컬럼이라 17자리로 만들면
      //   mysql2 가 JS number 로 읽으며 MAX_SAFE_INTEGER 를 넘겨 **끝자리가 변형**되고,
      //   목록 응답의 odId 가 시드 값과 어긋나 어떤 대조도 안 맞는다(1차 완주 실패 원인).
      const kst = new Date(Date.now() + 9 * 3600 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace(/[-T:]/g, ''); // YYYYMMDDHHMMSS(14자리, ≈2e13 — number 안전 범위)
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
          qty: 10 * (i + 1),
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
        priceOriginal: 120 + 10 * i,
      });
      poIds.push(po.id);
      console.log(
        `[demo] ${cust.name}(${cust.mbId}) spec ${String(spec.id)} 확정가 ₩${String(cust.finalPrice)} · 주문 ${odId}(입금) → PO #${String(po.id)}`,
      );
    }
    expect(poIds.length).toBe(BOX_SIZE);
  }, 180_000);

  test('D2. 세 건이 한 박스로 합류한다', async (ctx) => {
    if (poIds.length < BOX_SIZE) return ctx.skip();
    for (const poId of poIds) {
      const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poId) });
      expect(box.status, `담기 #${String(poId)}: ${JSON.stringify(box.json)}`).toBe(200);
    }
    const shipments = await getPrisma().spPcbShipment.findMany({
      where: { pos: { some: { poId: { in: poIds } } } },
      include: { pos: true },
    });
    expect(shipments.length, '박스는 하나').toBe(1);
    shipmentId = shipments[0]?.id ?? null;
    repPoId = Number(shipments[0]?.poId ?? 0);
    expect(shipments[0]?.pos.length, '구성원 3건').toBe(BOX_SIZE);
  }, 120_000);

  test('D3. 이동 중까지 전진(입고확인은 남겨 둔다)', async (ctx) => {
    if (shipmentId === null || repPoId === null) return ctx.skip();

    // 국제 체인 첫 전이(선적 요청)는 Invoice 첨부 + 출고예정일이 필수다.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    const form = new FormData();
    form.set('fileType', 'invoice');
    form.set('file', new File([bytes], 'invoice-demo3.pdf', { type: 'application/pdf' }));
    const up = await fetch(`${API_URL}/api/partner/pcb-pos/${String(repPoId)}/shipment/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: form,
    });
    expect(up.status, 'Invoice 첨부').toBe(200);

    const reqAdv = await api(P, 'POST', `/api/partner/pcb-pos/${String(repPoId)}/shipment/advance`, {
      shipDate: '2026-08-20',
    });
    expect(reqAdv.status, `선적 요청: ${JSON.stringify(reqAdv.json)}`).toBe(200);

    // 서류 체인을 종점(완료)까지 — 중간에 세워 두면 Case 발주 영역에 [국내도착 진행]
    // 같은 잔여 전이 버튼이 남는다(국제 체인은 입고확인이 상태를 닫지 않는다 — 조기
    // 입고확인 허용 설계). 관리자는 양측 만능 대행(D11)이라 관리자 토큰으로 완주한다.
    const specId = (await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(repPoId) } }))
      ?.specId;
    const body = { carrier: 'DHL', trackingNumber: TRACKING };
    for (let i = 0; i < 4; i += 1) {
      const cur = await getPrisma().spPcbShipment.findUnique({ where: { id: shipmentId } });
      if (String(cur?.status) === 'done') break;
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/pos/${String(repPoId)}/shipment/advance`,
        body,
      );
      expect(adv.status, `전이 ${String(i)}: ${JSON.stringify(adv.json)}`).toBe(200);
    }

    const row = await getPrisma().spPcbShipment.findUnique({ where: { id: shipmentId } });
    expect(String(row?.status), '서류 체인 종점(완료)').toBe('done');
    expect(row?.receivedAt, '입고확인은 아직 — 다음 단계의 몫').toBeNull();
    console.log(
      `[demo] shipment #${String(shipmentId)} status=${String(row?.status)} tracking=${TRACKING}`,
    );
  }, 180_000);

  test('D4. 워크큐 3행(고객 3인) + Case 상세 확정가가 채워졌는가', async (ctx) => {
    if (shipmentId === null) return ctx.skip();
    const q = await api(A, 'GET', `/api/admin/pcb-shipments?tab=all&q=${TRACKING}`);
    expect(q.status).toBe(200);
    const items: any[] = q.json?.data?.items ?? [];
    expect(items.length, '운송장 검색 1건').toBe(1);
    const item = items[0];
    expect(item.poCount, '묶음 3').toBe(BOX_SIZE);
    const owners = new Set(item.members.map((m: any) => String(m.mbId)));
    expect(owners.size, '고객 3인이 갈려 실린다').toBe(BOX_SIZE);
    for (const m of item.members) {
      expect(String(m.customerName), `PO-${String(m.poId)} 고객 실명`).not.toBe('');
    }

    // 1차 시드의 구멍 회귀 — Case 상세 확정가(finalPrice ?? autoPrice)가 비지 않아야 한다.
    for (const [i, specId] of specIds.entries()) {
      const d = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}`);
      expect(d.status, `Case 상세 ${String(specId)}`).toBe(200);
      const fp = d.json?.data?.finalPrice ?? null;
      expect(fp, `spec ${String(specId)} 확정가`).toBe(CUSTOMERS[i]?.finalPrice);
    }
    console.log(
      `[demo] 워크큐 실측 — SH-${String(item.shipmentId)}: ` +
        item.members.map((m: any) => `${String(m.mbId)} "${String(m.customerName)}"`).join(' · '),
    );
  }, 120_000);

  test('D5. 입고확인 1회 — 세 주문이 배송 처리 대기로 넘어온다', async (ctx) => {
    if (shipmentId === null || repPoId === null) return ctx.skip();
    const prisma = getPrisma();
    const specId = (await prisma.spPcbPo.findUnique({ where: { id: BigInt(repPoId) } }))?.specId;
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(repPoId)}/shipment/receive`,
      { note: '[데모] 3건 묶음 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    expect(
      (await prisma.spPcbShipment.findUnique({ where: { id: shipmentId } }))?.receivedAt,
      '입고 시각 박제',
    ).not.toBeNull();

    // 파급 실측 — 입고 한 번으로 고객이 다른 세 주문이 **각자** 배송 대기에 선다(주문 축).
    const q = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&pageSize=50');
    expect(q.status).toBe(200);
    const rows: any[] = q.json?.data?.items ?? [];
    const mine = rows.filter((r: any) => odIds.includes(String(r.odId)));
    expect(mine.length, '배송 처리 대기 3건(고객 3인 각자 행)').toBe(BOX_SIZE);
    for (const r of mine) {
      expect(r.receivedPoCount, `주문 ${String(r.odId)} 입고 완료 표기`).toBe(r.poCount);
    }
    console.log(`[demo] 배송 대기 실측 — ${mine.map((r: any) => String(r.odId)).join(', ')}`);
  }, 120_000);

  // 세 주문을 **서로 다른 단계에 남긴다** — 전부 완주하면 고객 배송 큐가 비어(완료는
  // 소거) "화면에 아무것도 없다"가 된다(사용자 관찰). A=배송 처리 대기 · B=배송 중 ·
  // C=구매확정(완주 경로 증명) — 세 탭이 전부 실데이터를 갖는 분포가 이 데모의 목적.
  test('D6. 고객 배송 — B·C만 운송장 달고 배송 진입(A 는 대기로 남긴다)', async (ctx) => {
    if (odIds.length < BOX_SIZE) return ctx.skip();
    for (const [i, odId] of odIds.entries()) {
      if (i === 0) continue; // A(김데모) — 배송 처리 대기 표본
      const res = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
        target: '배송',
        delivery: {
          deliveryCompany: 'CJ대한통운',
          invoiceNo: `DEMO-CJ-000${String(i + 1)}`,
          invoiceTime: '2026-08-13 12:00:00',
        },
      });
      expect(res.status, `배송 처리 ${odId}: ${JSON.stringify(res.json)}`).toBe(200);
    }
    const q = await api(A, 'GET', '/api/admin/pcb-orders?tab=shipping&pageSize=50');
    const rows: any[] = q.json?.data?.items ?? [];
    const mine = rows.filter((r: any) => odIds.includes(String(r.odId)));
    expect(mine.length, '배송 중 2건(B·C)').toBe(2);
    for (const r of mine) {
      expect(String(r.invoiceNo).startsWith('DEMO-CJ-'), `운송장 반영 ${String(r.odId)}`).toBe(true);
    }
    console.log(
      `[demo] 배송 중 실측 — ${mine.map((r: any) => `${String(r.odId)} ${String(r.deliveryCompany)} ${String(r.invoiceNo)}`).join(' · ')}`,
    );
  }, 120_000);

  test('D7. 구매확정 — C 만 완주, 세 단계 분포가 화면에 선다', async (ctx) => {
    if (odIds.length < BOX_SIZE) return ctx.skip();
    const [aOd, bOd, cOd] = odIds;
    const res = await api(A, 'PATCH', `/api/admin/orders/${String(cOd)}/force-status`, {
      target: '완료',
    });
    expect(res.status, `구매확정 ${String(cOd)}: ${JSON.stringify(res.json)}`).toBe(200);

    // 최종 분포 실측 — 배송 대기 A · 배송 중 B · 완료 C(각 탭 1건씩).
    const tab = async (name: string): Promise<string[]> => {
      const r = await api(A, 'GET', `/api/admin/pcb-orders?tab=${name}&pageSize=50`);
      return (r.json?.data?.items ?? [])
        .map((it: any) => String(it.odId))
        .filter((id: string) => odIds.includes(id));
    };
    expect(await tab('to_ship'), '배송 처리 대기 = A').toEqual([String(aOd)]);
    expect(await tab('shipping'), '배송 중 = B').toEqual([String(bOd)]);
    const done = await api(A, 'GET', '/api/admin/pcb-orders?tab=done&pageSize=50');
    const mineDone = (done.json?.data?.items ?? []).filter(
      (r2: any) => String(r2.odId) === String(cOd),
    );
    expect(mineDone.length, '완료 = C').toBe(1);
    // 금액 정합 — 템플릿 잔존값(io_price)이 코어 재계산에 섞이면 미수가 붙는다(실측 교정).
    expect(mineDone[0]?.misu, 'C 미수 0(완납 종결)').toBe(0);
    console.log(
      `[demo] 최종 분포 — 대기 A(${String(aOd)}) · 배송 중 B(${String(bOd)}) · 완료 C(${String(cOd)})`,
    );
  }, 120_000);
});
