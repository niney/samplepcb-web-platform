// 재작업 가드 회귀 — 1단계 프로브가 실증한 무가드 조합(W2~W5·W7·W8)에 2단계에서 가드를
// 신설했고, 이 스펙은 그 409 들을 지킨다. 각 가드의 "잠김 → 정리 → 열림" 순환까지 본다
// (막기만 하고 출구가 없으면 실무가 멈춘다).
//
//   W2  선정 해제는 발주가 있으면 409 PO_ISSUED — 발주 취소가 먼저다
//   W3  견적행 발주는 selected 만 — 미선정이면 409 RFQ_NOT_SELECTED (수동 발주 경로는 유지)
//   W4  송금 기록이 있는 발주 취소 409 HAS_REMITTANCE — 원장을 정리해야 열린다
//   W5  발송에 담긴 발주 취소 409 IN_SHIPMENT — detach 후에만(고아 멤버십 원천 차단)
//   W6  주문 완료 건 사양 수정 **허용**(사용자 결정 08-10 — EQ 고객확인으로 합의한 변경의
//       반영 창구) — 주문행 표기(ct_option) 동기·결제 금액(ct_price) 불변을 지킨다.
//       발주 후는 여전히 PO_ISSUED 로 차단(협력사와 합의된 사양).
//   W7  발송 시작 후 첨부 삭제 409 DOC_LOCKED — 되돌리면 교체 가능, 재진입은 Invoice 재요구
//   W8  발송에 담긴 발주의 직송지 변경 409 IN_SHIPMENT — detach 후에는 변경 가능
//   W9  취소된 주문의 새 작업 시작 409 ORDER_CANCELED — EQ 전진·담기 차단, revert(정리)는 허용
//
// 실행: pnpm -F e2e probe  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 거버 체인 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts). 시드는 레지스트리 정리.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  createJourneyReport,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  monoRoot,
  newPhpSession,
  newSession,
  num,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

describe.skipIf(!RUN || !JOURNEY)('재작업 가드 회귀 — 잠김·정리·열림 순환', () => {
  const rp = createJourneyReport('findings-rework', '재작업 프로브 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let p1: PartnerFixture; // 협력1(KR·KRW)
  let p2: PartnerFixture; // 협력2(CN·USD)
  let A = '';
  let P2 = '';

  // 거버 A 체인(W1~W5)
  let specA: number | null = null;
  let rfq1: number | null = null; // 협력1 행
  let rfq2: number | null = null; // 협력2 행
  let odA: string | null = null;
  let po1: number | null = null; // 협력1 발주
  let po2: number | null = null; // 협력2 발주
  // 거버 B 체인(W6)
  let specB: number | null = null;
  let odB: string | null = null;
  // 시드(W7·W8) — 레지스트리 정리
  const createdPoIds: bigint[] = [];

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

  // 시드용 자유 스펙 — pickFreeSpecs 는 PO 유무만 봐서 **이 주행이 방금 만든 거버 스펙**
  // (최신·PO 없음)을 집어 온다. 그러면 W7 시드가 specB 에 붙어 W9 의 발주와 UK 충돌
  // (실제로 그렇게 실패했다). 주문 연결이 없는(ctId null) 스펙으로 좁힌다.
  const pickSeedSpec = async (): Promise<any> => {
    const prisma = getPrisma();
    const usedSpecIds = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
      (r: { specId: bigint }) => r.specId,
    );
    const spec = await prisma.spOrderSpec.findFirst({
      where: { status: 'active', ctId: null, id: { notIn: usedSpecIds } },
      orderBy: { id: 'desc' },
    });
    if (spec === null) throw new Error('시드용 자유 스펙이 없습니다');
    return spec;
  };

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();

    p1 = await getPartner('협력1');
    p2 = await getPartner('협력2');
    if (p2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P2 = signJwt({ mbId: p2.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    await cleanupPcbPos(createdPoIds); // W7·W8 시드만 — 거버 체인은 대장 → 수동 정리
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('W1. 준비: 거버 A → RFQ 2곳 → 회신 2건 → 협력1 선정+확정가 → 주문 → 입금 → 협력1 발주', async () => {
    specA = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[프로브 A] 재작업 조합 실증 — 확인 후 정리 예정',
      prefix: 'W01',
    });
    ledger.push(`sp_order_spec #${String(specA)} (A 체인)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specA)}/rfqs`, {
      partnerIds: [num(p1.id), num(p2.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const rows = send.json?.data?.rfqs ?? [];
    rfq1 = rows.find((v: any) => v.partnerId === num(p1.id))?.rfqId ?? null;
    rfq2 = rows.find((v: any) => v.partnerId === num(p2.id))?.rfqId ?? null;
    expect(rfq1, '협력1 RFQ').not.toBeNull();
    expect(rfq2, '협력2 RFQ').not.toBeNull();
    ledger.push(`sp_pcb_rfq #${String(rfq1)}·#${String(rfq2)} (A 체인)`);

    const P1 = p1.mbId === null ? null : signJwt({ mbId: p1.mbId, ttlSec: 3600 });
    expect(P1, '협력1 연결 계정').not.toBeNull();
    const r1 = await api(P1 ?? '', 'PUT', `/api/partner/pcb-rfqs/${String(rfq1)}`, {
      price: 40_000,
      quotedDeliveryDate: '2026-08-20',
      memo: '[프로브] 협력1 회신',
    });
    expect(r1.status, `협력1 회신: ${JSON.stringify(r1.json)}`).toBe(200);
    const r2 = await api(P2, 'PUT', `/api/partner/pcb-rfqs/${String(rfq2)}`, {
      price: 300,
      quotedDeliveryDate: '2026-08-21',
      memo: '[프로브] 협력2 회신',
    });
    expect(r2.status, `협력2 회신: ${JSON.stringify(r2.json)}`).toBe(200);

    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specA)}/rfqs/${String(rfq1)}/select`,
      { finalPrice: 55_000 },
    );
    expect(sel.status, `협력1 선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId: specA,
      step: 'W1',
      prefix: 'W01',
      buyerName: 'e2e프로브고객',
    });
    odA = order.odId;
    ledger.push(`g5_shop_order od_id=${odA} (A 체인)`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odA],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specA)}/pos`, {
      partnerId: num(p1.id),
      rfqId: rfq1,
    });
    expect(issue.status, `협력1 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    po1 = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(p1.id))?.poId ?? null;
    expect(po1, '협력1 발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(po1)} (협력1 — A 체인)`);
  }, 480_000);

  test('W2. 선정 해제는 발주가 있으면 409 — 선정이 계약의 근거로 남는다', async (ctx) => {
    if (specA === null || rfq1 === null || po1 === null) return ctx.skip();
    const un = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specA)}/rfqs/${String(rfq1)}/unselect`,
      {},
    );
    expect(un.status, `발주 존재 중 선정 해제: ${JSON.stringify(un.json)}`).toBe(409);
    expect(un.json?.error, '해제 가드').toBe('PO_ISSUED');

    const prisma = getPrisma();
    const rfq = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfq1) } });
    expect(rfq?.status, '선정 유지(거절은 write 앞단)').toBe('selected');
    F('W2', 'obs', '발주 존재 시 선정 해제 409 PO_ISSUED — 선정·발주 정합 가드 확인');
  });

  test('W3. 견적행 발주는 selected 만 — 미선정이면 409, 발주서는 늘지 않는다', async (ctx) => {
    if (specA === null || rfq2 === null) return ctx.skip();
    // 협력2 행은 협력1 선정 때 unselected 로 밀린 상태 — 견적행 발주의 근거가 못 된다.
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specA)}/pos`, {
      partnerId: num(p2.id),
      rfqId: rfq2,
      exchangeRate: 1400,
    });
    expect(issue.status, `미선정 RFQ 로 발주: ${JSON.stringify(issue.json)}`).toBe(409);
    expect(issue.json?.error, '발주 가드').toBe('RFQ_NOT_SELECTED');

    const prisma = getPrisma();
    const count = await prisma.spPcbPo.count({ where: { specId: BigInt(specA) } });
    expect(count, '발주서는 협력1 1장뿐').toBe(1);
    F('W3', 'obs', '미선정 견적행 발주 409 RFQ_NOT_SELECTED — PO 2장 공존 경로 차단 확인');
  });

  test('W4. 송금 기록이 있는 발주 취소 409 — 원장을 정리해야 열린다', async (ctx) => {
    if (specA === null || po1 === null) return ctx.skip();
    void po2;
    // 협력1 발주(issued)에 선지급 기록 — 송금 기록 자체는 상태 무관(정상 실무).
    const remit = await api(A, 'POST', `/api/admin/pcb-remittances/${String(po1)}`, {
      remittedOn: '2026-08-10',
      amount: 40_000,
      memo: '[프로브] 선지급',
    });
    expect(remit.status, `송금 기록: ${JSON.stringify(remit.json)}`).toBe(200);
    const prisma = getPrisma();
    const row = await prisma.spPcbRemittance.findFirst({
      where: { poId: BigInt(po1) },
      orderBy: { id: 'desc' },
    });
    expect(row, '송금 원장 행').not.toBeNull();

    // 잠김 — 돈 기록이 함께 사라지는 삭제를 막는다.
    const del = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}`);
    expect(del.status, `송금 기록 있는 발주 취소: ${JSON.stringify(del.json)}`).toBe(409);
    expect(del.json?.error, '취소 가드').toBe('HAS_REMITTANCE');
    const remitKept = await prisma.spPcbRemittance.count({ where: { poId: BigInt(po1) } });
    expect(remitKept, '원장 보존').toBe(1);

    // 정리 → 열림 — 원장을 지우면(전용 라우트) 삭제 경로가 다시 열린다. 실제 삭제는
    // W5 가 담기 가드 검증에 쓰므로 여기서는 원장 정리까지만.
    const rmRemit = await api(
      A,
      'DELETE',
      `/api/admin/pcb-remittances/${String(po1)}/${String(row?.id)}`,
    );
    expect(rmRemit.status, `원장 정리: ${JSON.stringify(rmRemit.json)}`).toBe(200);
    F('W4', 'obs', '송금 기록 발주 취소 409 HAS_REMITTANCE — 원장 정리 후에만 열림(순환 확인)');
  });

  test('W5. 발송에 담긴 발주 취소 409 — detach 후에만 열린다(고아 원천 차단)', async (ctx) => {
    if (specA === null || po1 === null) return ctx.skip();
    // 협력1 발주를 EQ 완주 → produced → 담기(관리자행 국제 박스)
    const P1 = p1.mbId === null ? '' : signJwt({ mbId: p1.mbId, ttlSec: 3600 });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P1,
        `/api/partner/pcb-pos/${String(po1)}/eq-files`,
        { fileType },
        `${fileType}-probe.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const [path, token] of [
      [`/api/partner/pcb-pos/${String(po1)}/eq-request`, P1],
      [`/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(po1)}/production-start`, P1],
      [`/api/partner/pcb-pos/${String(po1)}/production-complete`, P1],
    ] as const) {
      const r = await api(token, 'POST', path, {});
      expect(r.status, `${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
    const box = await api(P1, 'POST', '/api/partner/pcb-shipments/box', { poId: po1 });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);

    // 담긴 채 EQ 를 issued 까지 하강해도(revert 는 선적을 안 본다 — 되돌리기 자체는 정당한
    // 작업) 삭제는 멤버십 가드에 막힌다. 고아 멤버십이 생길 길이 없어진다.
    for (let i = 0; i < 4; i += 1) {
      const rv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}/eq-revert`,
        {},
      );
      expect(rv.status, `revert ${String(i + 1)}: ${JSON.stringify(rv.json)}`).toBe(200);
    }
    const blocked = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}`);
    expect(blocked.status, `담긴 발주 취소: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error, '취소 가드').toBe('IN_SHIPMENT');

    const prisma = getPrisma();
    const linkKept = await prisma.spPcbShipmentPo.count({ where: { poId: BigInt(po1) } });
    expect(linkKept, '멤버십 보존(거절은 write 앞단)').toBe(1);

    // 정리 → 열림 — detach(마지막 1건이라 박스 소멸)하면 삭제가 통과한다.
    const detach = await api(P1, 'DELETE', `/api/partner/pcb-pos/${String(po1)}/shipment/membership`, {});
    expect(detach.status, `detach: ${JSON.stringify(detach.json)}`).toBe(200);
    const del = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}`);
    expect(del.status, `detach 후 발주 취소: ${JSON.stringify(del.json)}`).toBe(200);

    const orphanLinks = await prisma.spPcbShipmentPo.count({ where: { poId: BigInt(po1) } });
    expect(orphanLinks, '고아 멤버십 없음').toBe(0);
    F('W5', 'obs', '담긴 발주 취소 409 IN_SHIPMENT → detach 후 200 — 고아 멤버십 원천 차단(순환 확인)');
    po1 = null; // 정상 경로로 삭제됨
  }, 240_000);

  // ⚠ W6 은 가드 신설을 **보류**한 유일한 조합 — 주문 후 사양 협의(EQ 고객확인으로 합의한
  // 변경을 관리자가 반영하는 흐름)가 실무에 있어, 서버가 막으면 그 창구가 사라진다. 아래
  // 200 어서션은 현재 동작의 기록이며, 정책이 정해지면(차단 또는 주문행 동기·고객 통지)
  // 그에 맞춰 뒤집는다. findings 의 bug 표기는 "미해결 결함 후보"라는 뜻으로 유지한다.
  test('W6. 주문 완료 건 사양 수정 허용 — 주문행 표기 동기, 결제 금액 불변', async (ctx) => {
    void ctx;
    specB = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[프로브 B] 주문 후 사양 수정 — 확인 후 정리 예정',
      prefix: 'W06',
    });
    ledger.push(`sp_order_spec #${String(specB)} (B 체인)`);

    const price = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specB)}/price`, {
      finalPrice: 60_000,
    });
    expect(price.status, `확정가: ${JSON.stringify(price.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId: specB,
      step: 'W6',
      prefix: 'W06',
      buyerName: 'e2e프로브고객',
    });
    odB = order.odId;
    ledger.push(`g5_shop_order od_id=${odB} (B 체인)`);
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odB],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const prisma = getPrisma();
    const before = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specB) } });
    const beforeSpec = (before?.specJson ?? {}) as Record<string, unknown>;
    const cartBefore: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_option, ct_price, io_id, io_price FROM g5_shop_cart WHERE ct_id = ?`,
      before?.ctId,
    );

    // 결제 완료 주문의 사양을 바꾼다(사용자 결정: 허용) — 가드는 PO_ISSUED 뿐. 수량도
    // 함께 바꾼다: ct_option 요약(재질/층수/크기/수량)에 silkscreen 은 안 실리므로,
    // 문자열에 드러나는 수량(`Npcs`)이 주문행 동기의 확정 증거다.
    const beforeQty = Number(before?.qty ?? 0);
    const revised = { ...beforeSpec, silkscreen: beforeSpec.silkscreen === 'white' ? 'black' : 'white' };
    const revise = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specB)}/spec`, {
      spec: revised,
      qty: beforeQty + 100,
      reason: '[프로브] 주문 후 사양 변경',
    });
    expect(revise.status, `주문 완료 건 사양 수정: ${JSON.stringify(revise.json)}`).toBe(200);
    expect(revise.json?.data?.orderRowSynced, '주문행 동기 응답 표시').toBe(true);

    const after = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specB) } });
    const cartAfter: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_option, ct_price, io_id, io_price FROM g5_shop_cart WHERE ct_id = ?`,
      before?.ctId,
    );
    expect(Number(after?.finalPrice ?? 0), '확정가 유지(안 지움)').toBe(60_000);
    expect(after?.quoteStatus, 'quoted 유지').toBe('quoted');
    expect(
      String((after?.specJson as any)?.silkscreen),
      '사양 변경 반영',
    ).not.toBe(String(beforeSpec.silkscreen));
    // 주문행: 표기는 새 사양(수량 포함), 결제 흔적(금액·결제 검증 링크)은 그대로.
    expect(String(cartAfter[0]?.ct_option), '주문행 표기 동기(새 수량)').toContain(
      `${String(beforeQty + 100)}pcs`,
    );
    expect(Number(cartAfter[0]?.ct_price), '결제 금액 불변').toBe(Number(cartBefore[0]?.ct_price));
    expect(String(cartAfter[0]?.io_id), '결제 검증 링크(io_id) 불변').toBe(
      String(cartBefore[0]?.io_id),
    );
    expect(Number(cartAfter[0]?.io_price), '결제 당시 견적가(io_price) 불변').toBe(
      Number(cartBefore[0]?.io_price),
    );
    F(
      'W6',
      'obs',
      `주문 후 사양 수정 허용 — 주문행 ct_option 동기(${String(cartBefore[0]?.ct_option)} → ` +
        `${String(cartAfter[0]?.ct_option)}), ct_price 불변, finalPriceStale=${String(revise.json?.data?.finalPriceStale)}`,
    );
  }, 480_000);

  test('W7. 발송 시작 후 첨부 삭제 409 — 되돌리면 교체 가능, 재진입은 Invoice 재요구', async (ctx) => {
    void ctx;
    const seed = await pickSeedSpec();
    const po = await createPcbPo({ specId: seed.id, partnerId: p2.id, status: 'produced' });
    createdPoIds.push(po.id);

    const box = await api(P2, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po.id) });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
    const up = await apiForm(
      P2,
      `/api/partner/pcb-pos/${String(num(po.id))}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-probe.pdf',
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice: ${JSON.stringify(up.json)}`).toBe(200);
    // 업로드 응답은 발주 상세(PartnerPcbPoDetail) — 파일 목록은 shipment 안에 있다.
    const fileId = up.json?.data?.shipment?.files?.find((f: any) => f.fileType === 'invoice')?.fileId;
    expect(fileId, 'Invoice fileId').toBeTruthy();

    const reqd = await api(P2, 'POST', `/api/partner/pcb-pos/${String(num(po.id))}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reqd.status, `선적요청(Invoice 검사 통과): ${JSON.stringify(reqd.json)}`).toBe(200);

    // 잠김 — 발송이 시작된 뒤에는 필수 서류를 뺄 수 없다.
    const blocked = await api(
      P2,
      'DELETE',
      `/api/partner/pcb-pos/${String(num(po.id))}/shipment/files/${String(fileId)}`,
    );
    expect(blocked.status, `진입 후 Invoice 삭제: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error, '첨부 가드').toBe('DOC_LOCKED');

    // 정리 → 열림 — 되돌려 준비 단계로 내리면 교체할 수 있고, 재진입은 Invoice 를 다시
    // 요구한다(가드 순환 — 빠져나갈 길과 재검사가 함께 있어야 잠금이 실무를 안 막는다).
    const revert = await api(P2, 'POST', `/api/partner/pcb-pos/${String(num(po.id))}/shipment/revert`, {});
    expect(revert.status, `되돌리기: ${JSON.stringify(revert.json)}`).toBe(200);
    const del = await api(
      P2,
      'DELETE',
      `/api/partner/pcb-pos/${String(num(po.id))}/shipment/files/${String(fileId)}`,
    );
    expect(del.status, `준비 단계 삭제: ${JSON.stringify(del.json)}`).toBe(200);
    const reenter = await api(P2, 'POST', `/api/partner/pcb-pos/${String(num(po.id))}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(reenter.status, `Invoice 없이 재진입: ${JSON.stringify(reenter.json)}`).toBe(409);
    expect(reenter.json?.error, '재진입 Invoice 재요구').toBe('MISSING_INVOICE_FILE');
    F('W7', 'obs', '발송 시작 후 첨부 삭제 409 DOC_LOCKED → 되돌리면 교체 가능 → 재진입은 Invoice 재요구(순환 확인)');
  }, 120_000);

  test('W9. 취소된 주문의 새 작업 시작 409 — EQ 전진·담기 차단, 정리는 허용', async (ctx) => {
    if (specB === null || odB === null) return ctx.skip();
    // B 체인(주문·입금 완료, 발주 전)을 재사용 — 발주를 하나 열고 EQ 요청까지 간 뒤
    // 주문을 강제 '취소'로 내리면, 이후의 전진이 전부 막혀야 한다.
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specB)}/pos`, {
      partnerId: num(p2.id),
      priceOriginal: 300,
      exchangeRate: 1400,
    });
    expect(issue.status, `발주(수동 조건): ${JSON.stringify(issue.json)}`).toBe(200);
    const poB =
      (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(p2.id))?.poId ?? null;
    expect(poB, 'B 발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(poB)} (B 체인 — W9)`);

    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P2,
        `/api/partner/pcb-pos/${String(poB)}/eq-files`,
        { fileType },
        `${fileType}-w9.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(P2, 'POST', `/api/partner/pcb-pos/${String(poB)}/eq-request`, {});
    expect(req.status, `승인요청: ${JSON.stringify(req.json)}`).toBe(200);

    // 주문 취소 — 정식 경로는 카트행 취소(items/status). 전량 취소류가 되면 서버가
    // od_status='취소' 로 내린다(force-status 의 target enum 에는 '취소'가 없다).
    const specRow = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specB) } });
    expect(specRow?.ctId, 'B 스펙의 카트행').not.toBeNull();
    const cancel = await api(A, 'PATCH', `/api/admin/orders/${String(odB)}/items/status`, {
      ctIds: [num(specRow?.ctId ?? 0n)],
      target: '취소',
    });
    expect(cancel.status, `주문 취소: ${JSON.stringify(cancel.json)}`).toBe(200);
    expect(cancel.json?.data?.orderCancelled, '전량 취소 → 주문 취소 전환').toBe(true);

    const approve = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}/eq-approve`,
      {},
    );
    expect(approve.status, `취소 주문 EQ 승인: ${JSON.stringify(approve.json)}`).toBe(409);
    expect(approve.json?.error, 'EQ 전진 가드').toBe('ORDER_CANCELED');

    // 정리(revert)는 허용 — 취소 뒷정리를 서버가 막으면 발주 취소 경로가 함께 죽는다.
    const revert = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}/eq-revert`,
      {},
    );
    expect(revert.status, `취소 주문 revert(정리 허용): ${JSON.stringify(revert.json)}`).toBe(200);
    const del = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specB)}/pos/${String(poB)}`);
    expect(del.status, `발주 취소(정리 완료): ${JSON.stringify(del.json)}`).toBe(200);
    F('W9', 'obs', '취소 주문의 EQ 전진 409 ORDER_CANCELED — revert·발주 취소(정리)는 허용(순환 확인)');
  }, 240_000);

  test('W8. 발송에 담긴 발주의 직송지 변경 409 — detach 후에는 변경 가능', async (ctx) => {
    void ctx;
    const seed = await pickSeedSpec();
    const po = await createPcbPo({ specId: seed.id, partnerId: p2.id, status: 'produced' });
    createdPoIds.push(po.id);

    const box = await api(P2, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po.id) });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const before = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: po.id } } },
    });
    expect(before?.mode, '생성 시 국제(CN→관리자 KR)').toBe('international');

    // 잠김 — 직송지는 발송 컨텍스트(모드·받는측·묶음)의 입력이라 발송이 있으면 못 바꾼다.
    const blocked = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(num(po.specId))}/pos/${String(num(po.id))}`,
      { destinationCountry: 'CN' },
    );
    expect(blocked.status, `담긴 발주 직송지 변경: ${JSON.stringify(blocked.json)}`).toBe(409);
    expect(blocked.json?.error, '직송지 가드').toBe('IN_SHIPMENT');
    const poKept = await prisma.spPcbPo.findUnique({ where: { id: po.id } });
    expect(poKept?.destinationCountry, '직송지 보존').toBeNull();
    // 같은 값 재전송·다른 필드(메모 등)는 발송이 있어도 통과해야 한다 — 잠금 범위 확인.
    const memoOnly = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(num(po.specId))}/pos/${String(num(po.id))}`,
      { memo: '[프로브] 발송 중 메모 수정', destinationCountry: null },
    );
    expect(memoOnly.status, `값이 안 바뀌는 변경은 통과: ${JSON.stringify(memoOnly.json)}`).toBe(200);

    // 정리 → 열림 — detach 하면(박스 소멸) 직송지를 바꿀 수 있다.
    const detach = await api(P2, 'DELETE', `/api/partner/pcb-pos/${String(num(po.id))}/shipment/membership`, {});
    expect(detach.status, `detach: ${JSON.stringify(detach.json)}`).toBe(200);
    const patch = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(num(po.specId))}/pos/${String(num(po.id))}`,
      { destinationCountry: 'CN' },
    );
    expect(patch.status, `detach 후 직송지 변경: ${JSON.stringify(patch.json)}`).toBe(200);
    F('W8', 'obs', '담긴 발주 직송지 변경 409 IN_SHIPMENT → detach 후 200 — 박제 불일치 차단(순환 확인)');
  }, 120_000);
});
