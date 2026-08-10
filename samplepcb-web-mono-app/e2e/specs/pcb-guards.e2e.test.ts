// PCB 트랙 가드 회귀 — "서버가 이미 막고 있다"를 코드로 박제한다.
// 스토리 스펙(pcb-ship-board)이 정상 경로를 잇는다면, 이 파일은 **거절**만 모은다.
// 각 테스트의 `근거:` 주석(파일:줄)이 이 스펙의 정체성이다 — 가드를 옮기거나 순서를
// 바꾸면 여기가 먼저 빨개져야 한다. 새 가드를 세울 때도 같은 형식으로 한 줄 추가할 것.
//
// 안전 규약(HANDOFF §5): 쓰기 시드는 **협력2 명의**만. 협력1 은 진행 중 실데이터라
// 읽기 전용이되, "하위(MD) 발주" 처럼 신규 행을 협력1 명의로 만드는 것은 허용된다
// (기존 행을 건드리지 않으므로 — pcb-ship-board 테스트 4 와 같은 판단).
// 마지막 세 케이스는 실데이터를 **읽기만** 한다: 기대값이 409 라 쓰기가 일어나지 않는
// 것을 코드로 확인한 것들이며(게이트가 어떤 write 보다 앞선다), 조건에 맞는 실데이터가
// 없으면 조용히 skip 하는 대신 사유를 콘솔에 남긴다.
//
// 실행: pnpm -F e2e e2e pcb-guards   (PORTAL_E2E=1 은 스크립트가 건다)
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
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
  type PcbPoSeed,
} from '../helpers';

describe.skipIf(!RUN)('PCB 트랙 가드 회귀 — 코드로 확정된 409 박제', () => {
  let seller: PartnerFixture; // 협력2(CN·USD — 쓰기 시드 조직)
  let other: PartnerFixture; // 협력1(읽기 전용 — 하위 발주 명의로만)
  let A = ''; // 관리자 토큰
  let P = ''; // 협력2 토큰

  // 정리 레지스트리 — 어느 지점에서 실패해도 afterAll 이 이 목록만 보고 치운다.
  const createdPoIds: bigint[] = [];
  const createdRfqIds: bigint[] = [];
  // 잔재 검증 축(0n/빈 배열 = 그 단계에 도달 못 함)
  let sellerId = 0n;
  const seededSpecIds: bigint[] = [];
  let rfqSpecId = 0n;

  // 시드 — EQ 잠금 3종은 **같은 발주서 하나**를 공유한다(전부 409 라 상태를 바꾸지 않는다).
  let specEq: any, poEq: any; // eq_requested — NOT_ISSUED · PRICE_LOCKED · EQ_LOCKED
  let specMd: any, poParent: any; // issued + 하위 발주 — HAS_CHILDREN · PO_ISSUED
  let specShip: any, poShip: any; // 직송 CN(국내 모드) — RECEIVE_LOCKED
  let specRfq: any; // RFQ 회신 잠금 — NOT_EDITABLE

  const mkPo = async (seed: PcbPoSeed): Promise<any> => {
    const po = await createPcbPo(seed);
    createdPoIds.push(po.id);
    return po;
  };

  // multipart 업로드(EQ 첨부) — api() 는 JSON 전용이라 여기서 조립한다(여정 스펙 미러).
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
      /* 본문 없는 응답 */
    }
    return { status: res.status, json };
  };

  /** 사양 수정 바디용 — 계약 SpecValue 는 string|number 뿐이라 나머지는 떨군다.
   *  이관 견적의 `_legacy`(객체·PII)를 그대로 되돌려 보내면 400 이 난다(§7-6 함정). */
  const toSpecBody = (specJson: unknown): Record<string, string | number> => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries((specJson ?? {}) as Record<string, unknown>)) {
      if (k.startsWith('_')) continue;
      if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    }
    return out;
  };

  /** 오늘+n일의 KST 날짜 문자열(YYYY-MM-DD) — 회신 납기는 필수 입력. */
  const dateIn = (days: number): string =>
    new Date(Date.now() + days * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    seller = await getPartner('협력2');
    other = await getPartner('협력1');
    if (seller.mbId === null) throw new Error('협력2 조직에 연결 계정이 없습니다');
    sellerId = seller.id;
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: seller.mbId });

    // 전제: 협력2 는 PCB PO 0건 조직 — 잔재가 있으면 지난 실행 실패 흔적일 수 있으니
    // 자동 삭제하지 않고 중단한다(실데이터 오인 삭제 방지, pcb-ship-board 와 같은 규약).
    const prisma = getPrisma();
    const existing = await prisma.spPcbPo.findMany({
      where: { partnerId: seller.id },
      select: { id: true },
    });
    if (existing.length > 0) {
      throw new Error(
        `협력2 에 기존 PCB PO ${String(existing.length)}건(id: ${existing
          .map((r: any) => String(r.id))
          .join(', ')}) — 지난 실행 잔재인지 확인 후 정리하고 재실행하세요`,
      );
    }

    // 시드 스펙 — 발주 미사용(pickFreeSpecs) 위에 두 조건을 더 건다: ① active(RFQ·사양
    // 수정 게이트의 전제) ② 기존 RFQ 행 없음(배정 diff 가 남의 미회신 행을 지우지 않게).
    const pool = await pickFreeSpecs(12);
    const rfqRows = await prisma.spPcbRfq.findMany({
      where: { specId: { in: pool.map((s: any) => s.id) } },
      select: { specId: true },
    });
    const dirty = new Set(rfqRows.map((r: any) => String(r.specId)));
    const free = pool.filter(
      (s: any) => s.status === 'active' && s.ctId === null && !dirty.has(String(s.id)),
    );
    if (free.length < 4) {
      throw new Error(`시드 가능한 여유 스펙 부족: ${String(free.length)}/4 (active·미담김·RFQ 없음)`);
    }
    [specEq, specMd, specShip, specRfq] = free;
    seededSpecIds.push(specEq.id, specMd.id, specShip.id);

    poEq = await mkPo({ specId: specEq.id, partnerId: seller.id, status: 'eq_requested' });
    poParent = await mkPo({ specId: specMd.id, partnerId: seller.id, status: 'issued' });
    // 하위(MD) 발주 — 협력1 **명의의 신규 행**(실데이터 수정 아님)
    await mkPo({ specId: specMd.id, partnerId: other.id, parentPartnerId: seller.id });
    poShip = await mkPo({ specId: specShip.id, partnerId: seller.id, destinationCountry: 'CN' });
  });

  afterAll(async () => {
    await cleanupPcbPos(createdPoIds);
    const prisma = getPrisma();
    if (createdRfqIds.length > 0) {
      // 스펙은 건드리지 않는다 — 이 스펙이 만든 견적행만 id 로 지운다.
      await prisma.spPcbRfq.deleteMany({ where: { id: { in: createdRfqIds } } });
    }

    const residue = await countPcbResidue(createdPoIds);
    expect(residue, '시드 잔재가 남았습니다').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    if (sellerId !== 0n) {
      const leftover = await prisma.spPcbPo.count({ where: { partnerId: sellerId } });
      expect(leftover, '협력2 조직에 PO 잔재').toBe(0);
    }
    if (seededSpecIds.length > 0) {
      // 협력1 명의 하위 발주까지 포함해 스펙 축으로 재확인(레지스트리 누락 방어).
      const bySpec = await prisma.spPcbPo.count({ where: { specId: { in: seededSpecIds } } });
      expect(bySpec, '시드 스펙에 PO 잔재').toBe(0);
    }
    if (rfqSpecId !== 0n) {
      const leftoverRfq = await prisma.spPcbRfq.count({ where: { specId: rfqSpecId } });
      expect(leftoverRfq, '시드 스펙에 RFQ 잔재').toBe(0);
    }
    await disconnectPrisma();
  });

  test('1. NOT_ISSUED — EQ 시작 후 발주서는 삭제할 수 없다', async () => {
    // 근거: lib/pcb-po.ts:526 (deletePcbPo — issued 아니면 거절, 되돌리기가 유일한 출구)
    const r = await api(A, 'DELETE', `/api/admin/pcb-projects/${specEq.id}/pos/${poEq.id}`);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('NOT_ISSUED');

    const still = await getPrisma().spPcbPo.count({ where: { id: poEq.id } });
    expect(still, '거절인데 행이 사라졌다').toBe(1);
  });

  test('2. HAS_CHILDREN — 하위(MD) 발주가 남은 상위는 삭제할 수 없다', async () => {
    // 근거: lib/pcb-po.ts:527-530 (같은 스펙·회차에서 나를 parent 로 둔 발주 수 > 0)
    // 상위가 issued 여야 NOT_ISSUED 를 지나 이 가드에 닿는다 — 가드 순서까지 함께 박제.
    const r = await api(A, 'DELETE', `/api/admin/pcb-projects/${specMd.id}/pos/${poParent.id}`);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('HAS_CHILDREN');

    const alive = await getPrisma().spPcbPo.count({ where: { specId: specMd.id } });
    expect(alive, '상위·하위 둘 다 살아 있어야 한다').toBe(2);
  });

  test('3. PRICE_LOCKED — 발주가는 EQ 시작 전(issued)에만 고칠 수 있다', async () => {
    // 근거: lib/pcb-po.ts:478 (priceOriginal·exchangeRate 변경 요청 + status ≠ issued)
    const r = await api(A, 'PATCH', `/api/admin/pcb-projects/${specEq.id}/pos/${poEq.id}`, {
      priceOriginal: 999,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('PRICE_LOCKED');

    const row = await getPrisma().spPcbPo.findUnique({ where: { id: poEq.id } });
    expect(Number(row.priceOriginal), '거절인데 금액이 바뀌었다').toBe(100000);
  });

  test('4. EQ_LOCKED — 승인요청 후에는 EQ 첨부를 바꿀 수 없다(관리자 대행도)', async () => {
    // 근거: routes/admin-pcb-pos.ts:401-406 (issued 아니면 업로드 전에 거절 — 파일서버 무접촉)
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // 최소 zip 헤더(더미)
    const r = await apiForm(
      A,
      `/api/admin/pcb-projects/${specEq.id}/pos/${poEq.id}/eq-files`,
      { fileType: 'eq' },
      'guard-dummy.zip',
      bytes,
      'application/zip',
    );
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('EQ_LOCKED');
  });

  test('5. PO_ISSUED — 발주된 건의 제작 사양은 여기서 못 고친다', async () => {
    // 근거: routes/admin-pcb-projects.ts:714-720 (스펙에 발주서가 1건이라도 있으면 거절)
    // 사양은 협력사와 **합의된 기록**이라 조용히 바뀌면 안 된다 — 발주 취소나 EQ 가 출구.
    const r = await api(A, 'PATCH', `/api/admin/pcb-projects/${specMd.id}/spec`, {
      spec: toSpecBody(specMd.specJson), // 내용은 그대로 — 막히는 이유가 '발주 존재'임을 고립
      qty: specMd.qty,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('PO_ISSUED');

    const row = await getPrisma().spOrderSpec.findUnique({ where: { id: specMd.id } });
    expect(String(row.quoteId), '거절인데 새 견적 스냅샷이 발급됐다').toBe(String(specMd.quoteId));
  });

  test('6. RECEIVE_LOCKED — 입고확인된 발송은 되돌릴 수 없다', async () => {
    // 근거: lib/pcb-shipment.ts:423 (revertPcbShipment — receivedAt 이 있으면 무조건 거절)
    // 직송 CN = 국내 모드. ⚠ P4.10 이후 국내 입고확인은 상태까지 delivered 로 닫는다.
    let r = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: num(poShip.id) });
    expect(r.status, `담기: ${JSON.stringify(r.json)}`).toBe(200);

    r = await api(P, 'POST', `/api/partner/pcb-pos/${poShip.id}/shipment/advance`, {
      carrier: 'SF Express',
      trackingNumber: 'SF-GUARD-001',
    });
    expect(r.status, `발송 전이: ${JSON.stringify(r.json)}`).toBe(200);
    expect(r.json?.data?.shipment?.status).toBe('shipping');

    r = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${specShip.id}/pos/${poShip.id}/shipment/receive`,
      { note: 'e2e 가드 입고' },
    );
    expect(r.status, `입고확인: ${JSON.stringify(r.json)}`).toBe(200);

    r = await api(P, 'POST', `/api/partner/pcb-pos/${poShip.id}/shipment/revert`, {});
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('RECEIVE_LOCKED');

    const detail = await api(P, 'GET', `/api/partner/pcb-pos/${poShip.id}`);
    expect(detail.json?.data?.shipment?.status, '거절인데 단계가 내려갔다').toBe('delivered');
  });

  test('7. NOT_EDITABLE — 선정이 끝난 견적 회신은 수정할 수 없다', async () => {
    // 근거: lib/pcb-rfq.ts:326-327 (savePcbRfqReply — requested/quoted 외 상태는 편집 불가)
    rfqSpecId = specRfq.id; // 이 시점부터 afterAll 이 RFQ 잔재를 검증한다
    let r = await api(A, 'POST', `/api/admin/pcb-projects/${specRfq.id}/rfqs`, {
      partnerIds: [num(seller.id)],
    });
    expect(r.status, `배정: ${JSON.stringify(r.json)}`).toBe(200);
    const rfqId = r.json?.data?.rfqs?.[0]?.rfqId;
    expect(rfqId, '배정된 견적행').toBeTruthy();
    createdRfqIds.push(BigInt(rfqId));

    r = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 100,
      quotedDeliveryDate: dateIn(30),
    });
    expect(r.status, `회신: ${JSON.stringify(r.json)}`).toBe(200);

    // 협력2 는 USD 결제통화 — 선정 시 KRW 박제 환율이 필요하다(당일 캐시에 기대지 않고 명시).
    r = await api(A, 'POST', `/api/admin/pcb-projects/${specRfq.id}/rfqs/${String(rfqId)}/select`, {
      exchangeRate: 1400,
    });
    expect(r.status, `선정: ${JSON.stringify(r.json)}`).toBe(200);

    r = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 120,
      quotedDeliveryDate: dateIn(45),
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('NOT_EDITABLE');

    const row = await getPrisma().spPcbRfq.findUnique({ where: { id: BigInt(rfqId) } });
    expect(row.status, '선정 상태가 유지돼야 한다').toBe('selected');
    expect(Number(row.priceOriginal), '거절인데 회신가가 바뀌었다').toBe(100);
  });

  // ── 실데이터 read-only 409 — 쓰기 없음(게이트가 어떤 write 보다 앞선다) ───────
  // 대상이 없으면 skip 하고 사유를 남긴다. 조건을 만들려면 실주문을 건드려야 하는데,
  // 그건 이 스펙이 지켜야 할 선 밖이다(HANDOFF §5).

  test('8. ALREADY_ORDERED — 주문된 견적에는 확정가를 매길 수 없다', async (ctx) => {
    // 근거: lib/pcb-price.ts:38-40 (판매가 불변 — cart 상태 'ordered' 는 거절)
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT s.id FROM sp_order_spec s JOIN g5_shop_cart c ON c.ct_id = s.ctId
        WHERE s.status = 'active' AND c.ct_status <> '쇼핑' ORDER BY s.id DESC LIMIT 1`,
    );
    const specId = rows[0]?.id;
    if (specId === undefined) {
      console.log('[skip] 8. ALREADY_ORDERED — 주문 연결(ct_status≠쇼핑) active 스펙 없음');
      return ctx.skip();
    }
    const r = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specId)}/price`, {
      finalPrice: 1000,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('ALREADY_ORDERED');
  });

  test('9. IN_CART — 장바구니에 담긴 견적에는 RFQ 를 못 보낸다', async (ctx) => {
    // 근거: lib/pcb-rfq.ts:85 (checkPcbRfqSpecGate — 담김은 소싱 시작 전 단계)
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT s.id FROM sp_order_spec s JOIN g5_shop_cart c ON c.ct_id = s.ctId
        WHERE s.status = 'active' AND c.ct_status = '쇼핑' ORDER BY s.id DESC LIMIT 1`,
    );
    const specId = rows[0]?.id;
    if (specId === undefined) {
      console.log("[skip] 9. IN_CART — ct_status='쇼핑' 로 연결된 active 스펙 없음(로컬 DB)");
      return ctx.skip();
    }
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(seller.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('IN_CART');
  });

  test('10. ORDER_NOT_PAID — 미입금 주문 건에는 RFQ 를 못 보낸다', async (ctx) => {
    // 근거: lib/pcb-rfq.ts:88 (D10 은 **진행 중** 주문만 연다 — 미입금은 취소 가능성)
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT s.id FROM sp_order_spec s
         JOIN g5_shop_cart c ON c.ct_id = s.ctId
         JOIN g5_shop_order o ON o.od_id = c.od_id
        WHERE s.status = 'active' AND c.ct_status <> '쇼핑' AND o.od_status = '주문'
        ORDER BY s.id DESC LIMIT 1`,
    );
    const specId = rows[0]?.id;
    if (specId === undefined) {
      console.log("[skip] 10. ORDER_NOT_PAID — od_status='주문' 인 주문에 연결된 active 스펙 없음");
      return ctx.skip();
    }
    const r = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(seller.id)],
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(r.json?.error).toBe('ORDER_NOT_PAID');
  });
});
