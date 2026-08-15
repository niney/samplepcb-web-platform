// 데모 주행 — **실계정 mdtester 무대에서 MD 릴레이를 밟고, MD 자신의 선적 준비
// (체크리스트)에서 멈춰 남긴다**(정리 없음 · 2026-08-15 사용자 요청 3연: "MD 가 하위
// 협력사까지 요청" → "선적 진행 전까지" → "mdtester/mdtester 계정으로").
//
// 무대는 **만들지 않고 실측 재사용**한다(실계정 멤버십 직삽입 금지 — seed.ts 규율):
//   MD  = mdtester 의 기존 조직 #6 '마스터딜러'(CN·USD, pcb_rfq)
//   하위 = tester3 의 기존 조직 #10 'tester3협력'(CN·KRW) — 관계 #6→#10(USD) 상설
// 두 조직이 같은 CN 이라 **하위→MD 구간은 국내 3단계**다(모드=국가 비교). 그래서
// 관찰 목적(국제 선적준비 체크리스트)은 하위가 아니라 **MD 자신의 상위 구간**
// (MD CN→관리자 KR = 국제)에 있다 — 하위 구간은 완주(MD 입고)시켜 상위 출고
// 게이트를 열고, MD 가 담기+서류(인보이스·TEST Report)까지 한 뒤 멈춘다:
//   - [선적 요청 진행]은 누르지 않는다 — **mdtester 로 로그인하면**
//     /app/partner/pcb/ship 보드에 준비 체크리스트가 산 채로 열려 있다:
//     운송회사 셀렉트(DHL/FedEx/UPS/SF Express+직접입력)·운송장 번호 입력(08-15
//     신설)은 비워 두고, 인보이스+TEST Report(08-15 enum) ✓ 첨부 상태를 보여 준다
//   - 견적 루프(관리자 RFQ→MD 하위 배정→하위 회신→MD 마진→선정+확정가)와 발주
//     릴레이·하위 EQ 도 실제 API 로 밟아 관전 이력이 온전히 남는다
//   - USD 회신 선정은 당일 환율 캐시 자동, 미준비 로컬이면 명시 환율 폴백(P4.7)
//
// 실행: cd e2e && PORTAL_E2E=1 DEMO_KEEP=1 npx vitest run demo-md-ship-keep
// 재실행: 이전 산출물(projectName DEMO-MDSHIP-*)을 지우고 새로 만든다(멱등 데모).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  cleanupPcbPos,
  disconnectPrisma,
  ensureMdRelation,
  getPrisma,
  num,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const DEMO = process.env.DEMO_KEEP === '1';
const MD_MB_ID = 'mdtester'; // 실계정 — 사용자가 이 아이디로 로그인해 관찰한다
const SUB_MB_ID = 'tester3'; // tester3협력(#10) 연결 계정 — 하위 조작 토큰용
const PROJECT = 'DEMO-MDSHIP-board.zip';
const CUSTOMER = { mbId: 'demo-mdship-cust', name: '엠디십데모', finalPrice: 620000 };
const DELIVERY_DATE = '2026-08-22'; // 하위 회신 납기
const CN_CARRIER = 'SF Express'; // 하위(CN)→MD(CN) 국내 구간 택배
const CN_TRACKING = 'DEMO-MDSHIP-CN-0815';

describe.skipIf(!RUN || !DEMO)('데모 — 실계정 MD 릴레이, MD 선적 준비까지(남김)', () => {
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = '';
  let M = '';
  let C = '';
  let specId: bigint | null = null;
  let odId: string | null = null;
  let ctId: number | null = null;
  let topRfqId: number | null = null;
  let childRfqId: number | null = null;
  let topPoId: number | null = null;
  let childPoId: number | null = null;
  let legSubId: bigint | null = null; // 하위→MD(국내, 완주)
  let legTopId: bigint | null = null; // MD→관리자(국제, 준비에서 멈춤)

  /** 실계정의 기존 조직을 멤버십으로 해석 — 없으면 만들지 않고 멈춘다(무대 오염 금지). */
  const resolveRealPartner = async (mbId: string): Promise<PartnerFixture> => {
    const prisma = getPrisma();
    const membership = await prisma.spPartnerMember.findFirst({
      where: { mbId },
      include: { partner: true },
      orderBy: { id: 'asc' },
    });
    if (membership === null) {
      throw new Error(`실계정 ${mbId} 의 조직 멤버십이 없습니다 — 무대 실측과 어긋남(중단)`);
    }
    const p = membership.partner;
    return {
      id: p.id,
      name: p.name,
      country: p.country ?? null,
      capabilities: p.capabilities,
      contactEmail: p.contactEmail ?? null,
      mbId,
    };
  };

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: contentType }));
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, json };
  };

  /** 이전 데모 산출물 제거(멱등 재실행) — 이 데모가 만든 것만 정확히 겨냥한다. */
  const wipeDemo = async (): Promise<void> => {
    const prisma = getPrisma();
    const specs = await prisma.spOrderSpec.findMany({
      where: { projectName: { startsWith: 'DEMO-MDSHIP-' } },
      select: { id: true, quoteId: true, ctId: true },
    });
    if (specs.length === 0) return;
    const ids = specs.map((s: any) => s.id);
    const pos = await prisma.spPcbPo.findMany({
      where: { specId: { in: ids } },
      select: { id: true },
    });
    const poIds = pos.map((p: any) => p.id);
    // 선적 첨부(spFile)는 발송 행 삭제로 고아가 되므로 먼저 지운다(인보이스·TEST Report).
    const ships = await prisma.spPcbShipment.findMany({
      where: { poId: { in: poIds } },
      select: { id: true },
    });
    if (ships.length > 0) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_pcb_shipment', refId: { in: ships.map((s: any) => s.id) } },
      });
    }
    await cleanupPcbPos(poIds);
    await prisma.spPcbRfq.deleteMany({ where: { specId: { in: ids } } });
    await prisma.spMailLog.deleteMany({
      where: { refType: 'pcb_spec', refId: { in: ids.map(String) } },
    });
    const ctIds: number[] = specs.map((s: any) => s.ctId).filter((v: any) => v !== null);
    if (ctIds.length > 0) {
      const carts: any[] = await prisma.$queryRawUnsafe(
        `SELECT ct_id, od_id FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      const olds = [...new Set(carts.map((c) => String(c.od_id)))];
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_cart WHERE ct_id IN (${ctIds.map(() => '?').join(',')})`,
        ...ctIds,
      );
      if (olds.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM g5_shop_order WHERE od_id IN (${olds.map(() => '?').join(',')})`,
          ...olds,
        );
      }
    }
    await prisma.spOrderSpec.deleteMany({ where: { id: { in: ids } } });
    await prisma.spQuote.deleteMany({ where: { id: { in: specs.map((s: any) => s.quoteId) } } });
    console.log(`[demo] 이전 데모 정리 — spec ${ids.map(String).join(', ')}`);
  };

  /** g5 회원·결제(입금) 주문 직시드 — demo-bulk3-keep 패턴(행 복제·신원·금액만 교체). */
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

    // od_id 는 코어 관례 14자리(YYYYMMDDHHMMSS) — 자릿수를 늘리면 bigint 컬럼이
    // number 안전 범위를 넘어 끝자리가 변형된다(demo-bulk3-keep 실측).
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
      // 라인가는 VAT 포함 전제 + 템플릿 잔존 io_price 는 0 으로(둘 다 demo 실측 교정).
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
    md = await resolveRealPartner(MD_MB_ID);
    sub = await resolveRealPartner(SUB_MB_ID);
    // 상설 관계(#6→#10, USD) 확인 — 있으면 no-op, 없으면 관리자 API 로 복구(멱등).
    await ensureMdRelation(md, sub, 'USD');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD_MB_ID, ttlSec: 3600 });
    C = signJwt({ mbId: SUB_MB_ID, ttlSec: 3600 });
    await wipeDemo();
  }, 120_000);

  afterAll(async () => {
    // 의도적으로 정리하지 않는다 — 이 주행의 산출물이 곧 목적(화면 관찰용).
    console.log(
      `[demo-md-ship-keep] 남긴 것: spec #${String(specId)} · 주문 ${String(odId)} · ` +
        `상위 PO #${String(topPoId)}(${md?.name ?? 'MD'}) · 하위 PO #${String(childPoId)}(${sub?.name ?? '하위'}) · ` +
        `하위 구간 SH-${String(legSubId)}(입고완료) · 상위 구간 SH-${String(legTopId)}(준비 — 선적 요청 전, 인보이스+TEST Report 첨부)`,
    );
    console.log(
      `[demo-md-ship-keep] 관찰: **${MD_MB_ID} 로그인** → /app/partner/pcb/ship 준비 체크리스트 · ` +
        `/app/partner/pcb/pos/${String(childPoId)} 하위 관전 · 관리자 /app/admin/pcb/cases/${String(specId)}`,
    );
    await disconnectPrisma();
  });

  test('K1. 견적 루프 — 관리자 RFQ→MD 하위 배정→하위 회신→MD 마진→선정+확정가', async () => {
    const prisma = getPrisma();
    const quote = await prisma.spQuote.create({
      data: {
        category: 'standard',
        orderCategory: 'sample',
        qty: 20,
        specJson: { width: '80', length: '60', layers: '4', thickness: '1.6' },
        specHash: 'demo-mdship',
        autoPrice: CUSTOMER.finalPrice,
        priceVersion: 'demo-mdship',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    });
    // 주문(ctId)은 아직 없다 — 확정가 게이트가 주문됨을 거부하므로 실순서(견적→주문)대로.
    const spec = await prisma.spOrderSpec.create({
      data: {
        mbId: CUSTOMER.mbId,
        quoteId: quote.id,
        projectName: PROJECT,
        category: 'standard',
        orderCategory: 'sample',
        qty: 20,
        specJson: { width: '80', length: '60', layers: '4', thickness: '1.6' },
        status: 'active',
        quoteStatus: 'quoted',
      },
    });
    specId = spec.id;

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(md.id)],
    });
    expect(send.status, `RFQ 발송: ${JSON.stringify(send.json)}`).toBe(200);
    topRfqId =
      (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(md.id))?.rfqId ?? null;
    expect(topRfqId, 'MD RFQ id').not.toBeNull();

    // MD 가 하위 협력사에 견적을 **요청**한다(사용자 시나리오의 축).
    const assign = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/children`, {
      partnerIds: [num(sub.id)],
      suggestedDeliveryDate: null,
    });
    expect(assign.status, `하위 배정: ${JSON.stringify(assign.json)}`).toBe(200);
    const childRfq = await prisma.spPcbRfq.findFirst({
      where: { specId: spec.id, partnerId: sub.id, parentPartnerId: md.id },
      orderBy: { id: 'desc' },
    });
    expect(childRfq, '하위 RFQ 행').not.toBeNull();
    childRfqId = num(childRfq?.id ?? 0n);

    const reply = await api(C, 'PUT', `/api/partner/pcb-rfqs/${String(childRfqId)}`, {
      price: 250,
      quotedDeliveryDate: DELIVERY_DATE,
      memo: '[데모] 하위 회신 — USD 250',
    });
    expect(reply.status, `하위 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, {
      childRfqId,
      marginRate: 15,
    });
    expect(pick.status, `MD 마진 선정: ${JSON.stringify(pick.json)}`).toBe(200);

    // USD 선정은 KRW 환산 필요 — 당일 환율 캐시 자동, 미준비 로컬이면 명시 환율 폴백(P4.7).
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
      { finalPrice: CUSTOMER.finalPrice },
    );
    if (sel.status === 400) {
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(topRfqId)}/select`,
        { exchangeRate: 1400, finalPrice: CUSTOMER.finalPrice },
      );
    }
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  }, 300_000);

  test('K2. 주문(입금) 시드 → 관리자→MD 발주 → MD→하위 발주(EQ 위임)', async (ctx) => {
    if (specId === null || topRfqId === null || childRfqId === null) return ctx.skip();
    await seedPaidOrder();
    expect(ctId, '카트 행').not.toBeNull();
    const prisma = getPrisma();
    await prisma.spOrderSpec.update({ where: { id: specId }, data: { ctId } });

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(md.id),
      rfqId: topRfqId,
    });
    expect(issue.status, `MD 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    topPoId =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(md.id))?.poId ?? null;
    expect(topPoId, 'MD 발주서 id').not.toBeNull();

    const create = await api(M, 'POST', `/api/partner/pcb-pos/${String(topPoId)}/children`, {
      childRfqId,
    });
    expect(create.status, `하위 발주: ${JSON.stringify(create.json)}`).toBe(200);
    const childPo = await prisma.spPcbPo.findFirst({
      where: { specId, partnerId: sub.id, parentPartnerId: md.id },
      orderBy: { id: 'desc' },
    });
    expect(childPo, '하위 발주서 행').not.toBeNull();
    childPoId = num(childPo?.id ?? 0n);

    const after = await api(M, 'GET', `/api/partner/pcb-pos/${String(topPoId)}`);
    expect(after.json?.data?.eq?.delegatePoId, 'EQ 위임 대상 = 하위 발주').toBe(childPoId);
  }, 240_000);

  test('K3. 하위 EQ 완주 — 업로드→승인요청→관리자 승인→생산→생산완료', async (ctx) => {
    if (specId === null || childPoId === null) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        C,
        `/api/partner/pcb-pos/${String(childPoId)}/eq-files`,
        { fileType },
        `${fileType}-demo-mdship.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const [path, token] of [
      [`/api/partner/pcb-pos/${String(childPoId)}/eq-request`, C],
      [`/api/admin/pcb-projects/${String(specId)}/pos/${String(childPoId)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(childPoId)}/production-start`, C],
      [`/api/partner/pcb-pos/${String(childPoId)}/production-complete`, C],
    ] as const) {
      const r = await api(token, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  }, 240_000);

  test('K4. 하위(CN)→MD(CN) 국내 구간 완주 — 배송·MD 입고(상위 출고 게이트 개방)', async (ctx) => {
    if (childPoId === null) return ctx.skip();
    const box = await api(C, 'POST', '/api/partner/pcb-shipments/box', { poId: childPoId });
    expect(box.status, `하위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const legSub = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(childPoId) } } },
      orderBy: { id: 'desc' },
    });
    expect(legSub?.receiverKind, '받는측 md').toBe('md');
    expect(legSub?.mode, '같은 CN — 국내 3단계').toBe('domestic');
    legSubId = legSub?.id ?? null;

    const adv = await api(C, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/advance`, {
      carrier: CN_CARRIER,
      trackingNumber: CN_TRACKING,
    });
    expect(adv.status, `국내 배송 중: ${JSON.stringify(adv.json)}`).toBe(200);
    const recv = await api(M, 'POST', `/api/partner/pcb-pos/${String(childPoId)}/shipment/receive`, {
      note: '[데모] MD 검수 입고',
    });
    expect(recv.status, `MD 입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const closed = await prisma.spPcbShipment.findUnique({ where: { id: legSubId ?? 0n } });
    expect(closed?.receivedAt, '하위 구간 입고 박제').not.toBeNull();
  }, 240_000);

  test('K5. MD 상위 담기+서류 — 인보이스·TEST Report 첨부, 선적 요청은 누르지 않는다', async (ctx) => {
    if (topPoId === null) return ctx.skip();
    // 하위 입고로 방금 열린 상위 출고 게이트 — MD 가 자기 박스를 만든다.
    const box = await api(M, 'POST', '/api/partner/pcb-shipments/box', { poId: topPoId });
    expect(box.status, `상위 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const legTop = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(topPoId) } } },
      orderBy: { id: 'desc' },
    });
    expect(legTop?.receiverKind, '받는측 관리자').toBe('admin');
    expect(legTop?.mode, 'MD(CN)→관리자(KR) 국제 — 체크리스트의 전제').toBe('international');
    legTopId = legTop?.id ?? null;

    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const inv = await apiForm(
      M,
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-demo-mdship.pdf',
      pdf,
      'application/pdf',
    );
    expect(inv.status, `Invoice: ${JSON.stringify(inv.json)}`).toBe(200);
    // 08-15 신설 enum — 서버가 구코드면 여기서 400 으로 즉시 드러난다.
    const tr = await apiForm(
      M,
      `/api/partner/pcb-pos/${String(topPoId)}/shipment/files`,
      { fileType: 'test_report' },
      'test-report-demo-mdship.pdf',
      pdf,
      'application/pdf',
    );
    expect(tr.status, `TEST Report: ${JSON.stringify(tr.json)}`).toBe(200);

    // [선적 요청 진행]은 누르지 않는다 — mdtester 화면에 체크리스트(운송회사 셀렉트·
    // 운송장 번호·출고예정일)가 산 채로 남아야 관찰 목적이 성립한다.
    const row = await prisma.spPcbShipment.findUnique({ where: { id: legTopId ?? 0n } });
    expect(String(row?.status), '준비(선적 요청 전)에서 멈춘다').toBe('preparing');
    expect(row?.carrier, '운송회사는 화면 입력 몫으로 비워 둔다').toBeNull();
    expect(row?.trackingNumber, '운송장 번호도 비워 둔다').toBeNull();
    const files = await prisma.spFile.findMany({
      where: { refType: 'sp_pcb_shipment', refId: legTopId ?? 0n },
      select: { fileType: true },
    });
    const kinds = files.map((f: any) => String(f.fileType)).sort();
    expect(kinds, '첨부 = Invoice + TEST Report').toEqual(['invoice', 'test_report']);
  }, 240_000);

  test('K6. 관찰 지점 검증 — mdtester 보드 준비 박스·하위 관전 상세', async (ctx) => {
    if (legTopId === null || childPoId === null) return ctx.skip();
    // mdtester [📦 PCB 보내기] 보드 — 준비 중 박스로 잡혀야 체크리스트가 보인다.
    const board = await api(M, 'GET', '/api/partner/pcb-shipments');
    expect(board.status).toBe(200);
    const boxes: any[] = board.json?.data?.boxes ?? [];
    const mine = boxes.find((b: any) => Number(b.shipmentId) === Number(legTopId));
    expect(mine, '보드 준비 중 박스').toBeTruthy();
    expect(String(mine.status), '박스 상태 preparing').toBe('preparing');

    // MD 쪽 하위 발주 상세(관전 지점) — 도달만 확인.
    const view = await api(M, 'GET', `/api/partner/pcb-pos/${String(childPoId)}`);
    expect(view.status, 'MD 하위 발주 상세 도달').toBe(200);
  }, 120_000);
});
