// 재작업 프로브 — **서버가 막지 않음이 코드로 확정된 조합**을 실제로 재현해 무엇이
// 어긋나는지 증거를 남긴다(findings-rework.md). 목적은 가드 신설 여부의 결정 근거다.
//
// ⚠ 여기의 200 어서션들은 "현재 동작의 기록"이지 바람직함의 승인이 아니다. 가드가
//   생기면 이 스펙이 빨갛게 되는 것이 곧 신호이고, 그때 해당 어서션을 409 로 뒤집어
//   회귀로 승격한다(계획 3단계).
//
// 재현하는 조합(전부 원본 코드로 확정 — docs/PCB_PARTNER_TRACK.md 재작업 조사):
//   W2  선정 해제가 발주 존재를 안 본다(unselectPcbRfq 에 spPcbPo 참조 0건)
//   W3  발주는 RFQ 상태를 안 본다(selected 불요) → PO 2장 공존 + 발주 후 회신가 수정
//   W4  발주 취소가 송금 원장을 cascade 로 지운다(증빙 sp_file 은 잔존)
//   W5  발주 취소가 선적 멤버십을 고아로 만든다(shipment_po.poId 에 FK 없음)
//   W6  주문 완료 건 사양 수정 무가드(ordered 통과, 확정가 유지)
//   W7  Invoice 를 선적요청 진입 후 삭제해도 다음 단계가 진행된다
//   W8  선적 생성 후 destinationCountry 변경 — 박제된 선적과 어긋난다
//
// 실행: pnpm -F e2e probe  (PORTAL_E2E=1 + JOURNEY=1 — 거버 8040 필요)
// 생성물은 자동 정리하지 않는다(대장 → 수동). W7·W8 시드만 레지스트리로 정리.
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
  pickFreeSpecs,
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

describe.skipIf(!RUN || !JOURNEY)('재작업 프로브 — 막지 않는 조합의 실증(탐색 주행)', () => {
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

  test('W2. 선정 해제가 발주 존재를 안 본다 — 해제 200, 발주는 그대로', async (ctx) => {
    if (specA === null || rfq1 === null || po1 === null) return ctx.skip();
    // 코드 확정: unselectPcbRfq 는 RFQ 게이트만 본다(결제된 진행 중 주문은 통과, D10).
    const un = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specA)}/rfqs/${String(rfq1)}/unselect`,
      {},
    );
    expect(un.status, `발주 존재 중 선정 해제(현재 동작): ${JSON.stringify(un.json)}`).toBe(200);

    const prisma = getPrisma();
    const po = await prisma.spPcbPo.findUnique({ where: { id: BigInt(po1) } });
    const rfq = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfq1) } });
    F(
      'W2',
      'bug',
      `선정 해제 후에도 발주 잔존 — po#${String(po1)}=${String(po?.status)} / rfq1=${String(rfq?.status)}(부활) — 발주 근거(선정)가 사라진 채 협력1 트랙 계속 가능`,
    );
    expect(po?.status, '발주 잔존').toBe('issued');
    expect(rfq?.status, '해제된 행 부활').toBe('quoted');
  });

  test('W3. 발주는 RFQ 상태를 안 본다 — 미선정(quoted) 협력2 발주 → PO 2장 공존, 발주 후 회신가 수정', async (ctx) => {
    if (specA === null || rfq2 === null) return ctx.skip();
    // 서버는 rfq 의 spec·parent·partner 일치만 본다 — status(selected) 검사가 없다.
    // 외화는 환율만 별도로 요구한다(선정 박제가 없어서) — 그게 상태 검사를 대신하진 않는다.
    // 1차 주행 실측: 환율 없이 400 EXCHANGE_RATE_REQUIRED, 환율을 주면 미선정 그대로 통과.
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specA)}/pos`, {
      partnerId: num(p2.id),
      rfqId: rfq2, // status='quoted' — 선정된 적 없음
      exchangeRate: 1400,
    });
    expect(issue.status, `미선정 RFQ 로 발주(현재 동작): ${JSON.stringify(issue.json)}`).toBe(200);
    po2 = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(p2.id))?.poId ?? null;
    expect(po2, '협력2 발주서').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(po2)} (협력2 — A 체인)`);

    const prisma = getPrisma();
    const count = await prisma.spPcbPo.count({ where: { specId: BigInt(specA) } });
    F('W3', 'bug', `같은 견적에 발주서 ${String(count)}장 공존(협력1 해제됐는데 잔존 + 미선정 협력2 신규)`);
    expect(count, 'PO 2장 공존').toBe(2);

    // 발주에 연결된 RFQ 가 여전히 quoted 라 협력사가 회신가를 바꿀 수 있다(NOT_EDITABLE 은
    // selected/unselected 만 막는다). 발주 스냅샷(priceOriginal)과 회신가가 갈라진다.
    const edit = await api(P2, 'PUT', `/api/partner/pcb-rfqs/${String(rfq2)}`, {
      price: 999,
      quotedDeliveryDate: '2026-08-25',
      memo: '[프로브] 발주 후 수정',
    });
    expect(edit.status, `발주 후 회신 수정(현재 동작): ${JSON.stringify(edit.json)}`).toBe(200);
    const po = await prisma.spPcbPo.findUnique({ where: { id: BigInt(po2 ?? 0) } });
    const rfq = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfq2) } });
    F(
      'W3',
      'bug',
      `발주 후 회신가 수정됨 — 발주 스냅샷 ${String(Number(po?.priceOriginal))} vs 회신가 ${String(Number(rfq?.priceOriginal))} (어긋남)`,
    );
  });

  test('W4. 발주 취소가 송금 원장을 지운다 — cascade 소멸, 증빙 파일은 잔존', async (ctx) => {
    if (specA === null || po2 === null) return ctx.skip();
    // 송금 기록(issued 발주 — 상태 가드 없음 확정) + 증빙 업로드
    const remit = await api(A, 'POST', `/api/admin/pcb-remittances/${String(po2)}`, {
      remittedOn: '2026-08-10',
      amount: 300,
      exchangeRate: 1400,
      memo: '[프로브] 선지급',
    });
    expect(remit.status, `송금 기록: ${JSON.stringify(remit.json)}`).toBe(200);

    const prisma = getPrisma();
    const row = await prisma.spPcbRemittance.findFirst({
      where: { poId: BigInt(po2) },
      orderBy: { id: 'desc' },
    });
    expect(row, '송금 원장 행').not.toBeNull();
    const up = await apiForm(
      A,
      `/api/admin/pcb-remittances/${String(po2)}/${String(row?.id)}/files`,
      {},
      'receipt-probe.pdf',
      new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer,
      'application/pdf',
    );
    expect(up.status, `증빙 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const fileCount = await prisma.spFile.count({
      where: { refType: 'sp_pcb_remittance', refId: row?.id ?? 0n },
    });
    expect(fileCount, '증빙 파일 행').toBe(1);
    ledger.push(`sp_file(sp_pcb_remittance, ref #${String(row?.id)}) — W4 잔존 확인 대상`);

    // 발주 취소(issued) — 송금 원장 존재를 보지 않는다(deletePcbPo 확정).
    const del = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specA)}/pos/${String(po2)}`);
    expect(del.status, `송금 기록 있는 발주 취소(현재 동작): ${JSON.stringify(del.json)}`).toBe(200);

    const remitLeft = await prisma.spPcbRemittance.count({ where: { poId: BigInt(po2) } });
    const fileLeft = await prisma.spFile.count({
      where: { refType: 'sp_pcb_remittance', refId: row?.id ?? 0n },
    });
    F(
      'W4',
      'bug',
      `발주 취소로 송금 원장 소멸(cascade): ${String(remitLeft)}건 잔존 — 돈 기록이 조용히 사라짐. 증빙 sp_file 은 ${String(fileLeft)}건 고아로 잔존`,
    );
    expect(remitLeft, '송금 원장 cascade 소멸').toBe(0);
    expect(fileLeft, '증빙 파일 고아 잔존').toBe(1);
    po2 = null; // 삭제됨 — 이후 정리 대장에서 제외
  });

  test('W5. 발주 취소가 선적 멤버십을 고아로 만든다 — FK 없음', async (ctx) => {
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

    const prisma = getPrisma();
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(po1) } } },
    });
    expect(shipment, '선적 문서').not.toBeNull();
    ledger.push(`sp_pcb_shipment #${String(shipment?.id)} (W5 고아 관찰 대상)`);

    // 담긴 채 EQ 를 issued 까지 하강(revert 에 선적 멤버십 가드 없음 — 확정) → 발주 취소
    for (let i = 0; i < 4; i += 1) {
      const rv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}/eq-revert`,
        {},
      );
      expect(rv.status, `revert ${String(i + 1)}: ${JSON.stringify(rv.json)}`).toBe(200);
    }
    const del = await api(A, 'DELETE', `/api/admin/pcb-projects/${String(specA)}/pos/${String(po1)}`);
    expect(del.status, `담긴 발주 취소(현재 동작): ${JSON.stringify(del.json)}`).toBe(200);

    const orphanLinks = await prisma.spPcbShipmentPo.count({ where: { poId: BigInt(po1) } });
    const shipLeft = await prisma.spPcbShipment.findUnique({ where: { id: shipment?.id ?? 0n } });
    F(
      'W5',
      'bug',
      `발주 취소 후 선적 멤버십 ${String(orphanLinks)}건 고아 잔존(FK 없음) — 선적 #${String(shipment?.id)} 대표 po=${String(shipLeft?.poId)} 는 삭제된 발주를 가리킴`,
    );
    expect(orphanLinks, '고아 멤버십').toBe(1);
    expect(shipLeft, '대표 없는 선적 잔존').not.toBeNull();

    // 화면·API 가 이 고아를 어떻게 견디는지 — 협력1 보드 응답(500 이면 watchHttp 에 잡힌다).
    const boardAfter = await api(P1, 'GET', '/api/partner/pcb-shipments');
    F('W5', 'obs', `고아 상태 협력1 보드 GET → ${String(boardAfter.status)}`);
    po1 = null; // 삭제됨
  }, 240_000);

  test('W6. 주문 완료 건 사양 수정 무가드 — 200, 확정가·quoted 유지, 주문행은 옛값', async (ctx) => {
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
      `SELECT ct_option, ct_price FROM g5_shop_cart WHERE ct_id = ?`,
      before?.ctId,
    );

    // 결제 완료 주문의 사양을 바꾼다 — 가드는 PO_ISSUED 뿐(발주 전이면 통과, 확정 코드).
    const revised = { ...beforeSpec, silkscreen: beforeSpec.silkscreen === 'white' ? 'black' : 'white' };
    const revise = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specB)}/spec`, {
      spec: revised,
      reason: '[프로브] 주문 후 사양 변경',
    });
    expect(revise.status, `주문 완료 건 사양 수정(현재 동작): ${JSON.stringify(revise.json)}`).toBe(200);
    F(
      'W6',
      'bug',
      `입금 완료 주문의 사양 수정 통과 — finalPriceStale=${String(revise.json?.data?.finalPriceStale)} changed=${JSON.stringify(revise.json?.data?.changedKeys)}`,
    );

    const after = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specB) } });
    const cartAfter: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_option, ct_price FROM g5_shop_cart WHERE ct_id = ?`,
      before?.ctId,
    );
    expect(Number(after?.finalPrice ?? 0), '확정가 유지(안 지움)').toBe(60_000);
    expect(after?.quoteStatus, 'quoted 유지').toBe('quoted');
    const specChanged =
      String((after?.specJson as any)?.silkscreen) !== String(beforeSpec.silkscreen);
    const cartChanged = String(cartBefore[0]?.ct_option) !== String(cartAfter[0]?.ct_option);
    F(
      'W6',
      'bug',
      `사양은 바뀌고(silkscreen ${String(beforeSpec.silkscreen)}→${String((after?.specJson as any)?.silkscreen)}) ` +
        `주문행 옵션은 ${cartChanged ? '함께 갱신됨' : '옛값 그대로'} — 고객이 결제한 사양과 ${cartChanged ? '동기화' : '불일치'}`,
    );
    expect(specChanged, '사양 변경 반영').toBe(true);
  }, 480_000);

  test('W7. Invoice 를 선적요청 진입 후 삭제 — 다음 단계 진행됨', async (ctx) => {
    void ctx;
    const [seed] = await pickFreeSpecs(1);
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

    // 진입 후 삭제 — 삭제 라우트에 상태 가드 없음(확정). 이후 단계는 tracking 만 본다.
    const del = await api(
      P2,
      'DELETE',
      `/api/partner/pcb-pos/${String(num(po.id))}/shipment/files/${String(fileId)}`,
    );
    expect(del.status, `진입 후 Invoice 삭제(현재 동작): ${JSON.stringify(del.json)}`).toBe(200);
    // 국제 requested 다음(shipped)은 받는측(관리자) 차례 — 진행은 A 토큰으로.
    const shipped = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(num(po.specId))}/pos/${String(num(po.id))}/shipment/advance`,
      { trackingNumber: 'PROBE-AWB-1' },
    );
    expect(shipped.status, `Invoice 없이 선적 진행(현재 동작): ${JSON.stringify(shipped.json)}`).toBe(200);
    F('W7', 'bug', 'Invoice 첨부를 선적요청 진입 후 삭제해도 선적(shipped) 진행됨 — 필수 서류 없는 국제 선적');
  }, 120_000);

  test('W8. 선적 생성 후 destinationCountry 변경 — 박제된 선적과 어긋남', async (ctx) => {
    void ctx;
    const [seed] = await pickFreeSpecs(1);
    const po = await createPcbPo({ specId: seed.id, partnerId: p2.id, status: 'produced' });
    createdPoIds.push(po.id);

    const box = await api(P2, 'POST', '/api/partner/pcb-shipments/box', { poId: num(po.id) });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const prisma = getPrisma();
    const before = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: po.id } } },
    });
    expect(before?.mode, '생성 시 국제(CN→관리자 KR)').toBe('international');
    expect(before?.destinationCountry, '선적 박제 직송지').toBeNull();

    // 발주 목적지 사후 변경 — patchPo 의 비가격 필드는 상태 무관(확정).
    const patch = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(num(po.specId))}/pos/${String(num(po.id))}`, {
      destinationCountry: 'CN',
    });
    expect(patch.status, `선적 생성 후 목적지 변경(현재 동작): ${JSON.stringify(patch.json)}`).toBe(200);

    const after = await prisma.spPcbShipment.findFirst({ where: { id: before?.id ?? 0n } });
    const poAfter = await prisma.spPcbPo.findUnique({ where: { id: po.id } });
    F(
      'W8',
      'bug',
      `발주 목적지=CN(직송)인데 선적은 생성 시 박제 그대로(mode=${String(after?.mode)}, dest=${String(after?.destinationCountry)}) — 문서와 실물 경로 불일치`,
    );
    expect(poAfter?.destinationCountry, '발주 목적지 변경됨').toBe('CN');
    expect(after?.destinationCountry, '선적은 그대로').toBeNull();
  }, 120_000);
});
