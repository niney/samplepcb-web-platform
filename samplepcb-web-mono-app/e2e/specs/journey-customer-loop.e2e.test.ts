// 여정 18호 — **고객 축 셀프 루프**(고객이 되묻고, 바꾸고, 지우려 할 때).
//
// 열일곱 편이 협력 트랙을 훑는 동안 고객은 대체로 **한 번 주문하고 기다리는 사람**이었다.
// 실제로는 고객도 계속 손을 댄다 — EQ 를 반려하고, 사양을 고쳐 달라 하고, 견적을 지우려 한다.
// 그 조작들이 여러 편에 조각으로 흩어져 있어(2호 반려 1회, W6 사양 수정, D13 삭제 가드) 한
// 주행에서 이어 본 적이 없다.
//
// 표적 넷:
//   ① **주문 후 사양 수정**(W6 종결) — 차단이 아니라 **허용 + 주문행 동기**가 결론이었다.
//      ct_option 만 갱신하고 io_id·ct_price 는 결제 당시 기록이라 불변이다. 그 약속이 지금도
//      지켜지는가(수량을 바꿔야 요약이 실제로 달라진다 — probe W6 의 함정).
//   ② **발주 뒤에는 잠긴다** — 같은 수정이 PO_ISSUED 로 막혀야 한다. 허용과 차단의 경계.
//   ③ **EQ 반려 왕복 2회차** — 1회차 반려 사유가 2회차 요청에 **되살아나면 안 된다**
//      (P4.10 교정: 회차 시작 시각으로 필터). 고객에게 옛 사유를 다시 보내는 사고다.
//   ④ **주문 묶인 견적은 못 지운다** — 지워지면 주문만 남고 근거가 사라진다.
//
// 실행: pnpm -F e2e journey:customer  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 스크린샷 접두사는 **K** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  GERBER_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
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
const PARTNER_NAME = '협력2';

describe.skipIf(!RUN || !JOURNEY)('여정 18호 — 고객 축 셀프 루프', () => {
  const rp = createJourneyReport('findings-customer', '여정 18호 고객 셀프 루프 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let C = ''; // 고객 토큰(API 축 — 화면은 PHP 세션)

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let ctId: bigint | null = null;
  let poId: number | null = null;
  let firstReviewId: number | null = null;
  let secondReviewId: number | null = null;

  const REJECT_1 = '[여정 18호] 1회차 반려 — 실크 위치 확인 필요';
  const REJECT_2 = '[여정 18호] 2회차 의견 — 확인했습니다';

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: 'application/zip' }));
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

  /** 주문 줄의 옵션 요약(ct_option) — 사양 동기의 관찰 지점. */
  const cartOption = async (): Promise<string> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT ct_option, io_id, ct_price FROM g5_shop_cart WHERE ct_id = ?`,
      Number(ctId ?? 0),
    );
    return String(rows[0]?.ct_option ?? '');
  };

  const cartFrozen = async (): Promise<{ ioId: string; price: number }> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT io_id, ct_price FROM g5_shop_cart WHERE ct_id = ?`,
      Number(ctId ?? 0),
    );
    return { ioId: String(rows[0]?.io_id ?? ''), price: Number(rows[0]?.ct_price ?? 0) };
  };

  const bodyTextOf = async (s: E2eSession): Promise<string> =>
    (await s.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K1. 준비 — 주문·입금까지(발주 전)', async () => {
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 18호] 고객 셀프 루프 — 확인 후 정리 예정',
      prefix: 'K01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId;
    expect(rfqId, 'RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)}`);

    expect(
      (
        await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
          price: 60,
          quotedDeliveryDate: '2026-09-25',
        })
      ).status,
      '포털 회신',
    ).toBe(200);
    expect(
      (
        await api(
          A,
          'POST',
          `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
          { finalPrice: 110_000 },
        )
      ).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'K1',
      prefix: 'K01',
      buyerName: 'e2e고객루프',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);
    expect(
      (
        await api(A, 'PATCH', '/api/admin/orders/status', {
          target: '입금',
          odIds: [odId],
          sendMail: false,
          sendSms: false,
        })
      ).status,
      '입금확인',
    ).toBe(200);

    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    ctId = spec?.ctId ?? null;
    expect(ctId, '주문 줄 연결(ctId)').not.toBeNull();
    F('K1', 'obs', `준비 완료 — spec=${String(specId)} od=${odId} ct=${String(ctId)} (발주 전)`);
  }, 600_000);

  test('K2. 주문 뒤 사양 수정 — 허용하되 결제 기록은 건드리지 않는다(W6)', async (ctx) => {
    if (specId === null || ctId === null) return ctx.skip();

    const prisma = getPrisma();
    const before = await cartOption();
    const frozenBefore = await cartFrozen();

    // ⚠ `spec` 은 **필수이고 전체 교체**다(부분 병합이 아니다) — 바꿀 키만 보내면 나머지
    //   사양이 통째로 날아간다(첫 주행에서 요약이 "10pcs" 만 남았다). 화면이 하는 대로
    //   현재 사양을 읽어 덮어쓸 키만 얹는다.
    const cur = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    const curSpec = (cur?.specJson ?? {}) as Record<string, unknown>;
    // ⚠ ct_option 요약에는 **수량**이 들어간다 — 실크색만 바꾸면 요약이 그대로라 동기 여부를
    //   가릴 수 없다(probe W6 의 함정). 수량을 함께 바꿔야 검증이 성립한다.
    const patch = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specId)}/spec`, {
      qty: 10,
      spec: { ...curSpec, silkscreen: 'black' },
    });
    expect(patch.status, `주문 뒤 사양 수정: ${JSON.stringify(patch.json)}`).toBe(200);
    expect(patch.json?.data?.orderRowSynced, '주문행 동기 고지').toBe(true);

    const after = await cartOption();
    const frozenAfter = await cartFrozen();
    expect(after, 'ct_option 이 새 사양으로 갱신').not.toBe(before);
    expect(after.includes('10pcs'), '수량 변경이 요약에 반영').toBe(true);
    // 나머지 사양이 살아 있어야 한다 — 요약이 수량만 남으면 주문 상세에서 무슨 보드인지
    // 알 수 없다(전체 교체 계약이라 호출부가 병합을 빠뜨리면 실제로 그렇게 된다).
    expect(after.includes('TG130-140'), '재질 표기 유지').toBe(true);
    expect(after.includes('2L'), '층수 표기 유지').toBe(true);
    // 결제 당시 기록은 불변이어야 한다 — 여기가 흔들리면 "결제한 금액"이 사후에 달라진다.
    expect(frozenAfter.ioId, 'io_id 불변(결제 당시 옵션 행)').toBe(frozenBefore.ioId);
    expect(frozenAfter.price, 'ct_price 불변(결제 당시 금액)').toBe(frozenBefore.price);
    F(
      'K2',
      'obs',
      `주문 뒤 사양 수정 — ct_option 갱신("${before.slice(0, 40)}" → "${after.slice(0, 40)}") · ` +
        `io_id·ct_price 불변(결제 기록 보존)`,
    );
  }, 300_000);

  test('K3. 발주 뒤에는 잠긴다 — 허용과 차단의 경계', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id))?.poId;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);

    const cur = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    const locked = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(specId)}/spec`, {
      qty: 20,
      spec: (cur?.specJson ?? {}) as Record<string, unknown>,
    });
    expect(locked.status, `발주 뒤 사양 수정: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '거절 코드').toBe('PO_ISSUED');
    F('K3', 'obs', `발주 뒤 사양 수정 차단 — 409 PO_ISSUED(협력사가 그 사양으로 이미 움직인다)`);
  }, 300_000);

  test('K4. EQ 반려 왕복 2회차 — 옛 사유가 되살아나지 않는가', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const prisma = getPrisma();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-loop.zip`,
        bytes,
      );
      expect(up.status, `${fileType} 업로드`).toBe(200);
    }
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {})).status,
      'EQ 승인요청(1회차)',
    ).toBe(200);

    // ── 1회차: 관리자가 고객에게 묻고, 고객이 **반려**한다.
    const ask1 = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 18호] 1회차 확인 요청',
    });
    expect(ask1.status, `1회차 요청: ${JSON.stringify(ask1.json)}`).toBe(200);
    const r1 = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'desc' },
    });
    firstReviewId = r1 === null ? null : Number(r1.id);
    ledger.push(`sp_pcb_eq_review #${String(firstReviewId)} (1회차)`);

    const dec1 = await api(C, 'POST', `/api/pcb-eq-reviews/${String(firstReviewId)}/decide`, {
      decision: 'reject',
      note: REJECT_1,
    });
    expect(dec1.status, `고객 반려: ${JSON.stringify(dec1.json)}`).toBe(200);

    // 관리자가 그 사유로 협력사에 반려 → 발주가 발주접수로 내려간다.
    const rej = await api(A, 'POST', `${base}/eq-reject`, { reason: REJECT_1 });
    expect(rej.status, `협력사 반려: ${JSON.stringify(rej.json)}`).toBe(200);

    // ── 2회차: 협력사가 고치고 다시 올린다.
    const re = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { fileType: 'eq' },
      'eq-loop-v2.zip',
      bytes,
    );
    expect(re.status, `재업로드: ${JSON.stringify(re.json)}`).toBe(200);
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {})).status,
      'EQ 승인요청(2회차)',
    ).toBe(200);

    // ── 핵심: 2회차 화면·요약에 **1회차 반려 사유가 되살아나면 안 된다**(P4.10 교정).
    //    회차 시작(마지막 →eq_requested 시각)으로 필터하지 않으면 옛 사유가 프리필돼
    //    고객에게 다시 발송된다.
    const queue = await api(A, 'GET', '/api/admin/pcb-pos?tab=eq_pending&page=1&pageSize=100');
    const mine = (queue.json?.data?.items ?? []).find((i: any) => i.poId === poId);
    expect(mine, '2회차 EQ 승인 대기 진입').toBeTruthy();
    expect(mine?.eqReview ?? null, '2회차에는 열린 고객 확인이 없다(요약 null)').toBeNull();

    // 2회차 요청을 새로 보내고 고객이 승인한다.
    const ask2 = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(poId)}`, {
      message: '[여정 18호] 2회차 확인 요청',
    });
    expect(ask2.status, `2회차 요청: ${JSON.stringify(ask2.json)}`).toBe(200);
    const r2 = await prisma.spPcbEqReview.findFirst({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'desc' },
    });
    secondReviewId = r2 === null ? null : Number(r2.id);
    expect(secondReviewId, '2회차 리뷰 행').not.toBe(firstReviewId);
    ledger.push(`sp_pcb_eq_review #${String(secondReviewId)} (2회차)`);
    expect(String(r2?.message ?? ''), '2회차 메시지는 새 것').toContain('2회차');
    expect(String(r2?.message ?? '').includes(REJECT_1), '옛 반려 사유 미유입').toBe(false);

    const dec2 = await api(C, 'POST', `/api/pcb-eq-reviews/${String(secondReviewId)}/decide`, {
      decision: 'approve',
      note: REJECT_2,
    });
    expect(dec2.status, `고객 승인: ${JSON.stringify(dec2.json)}`).toBe(200);
    F(
      'K4',
      'obs',
      `EQ 반려 왕복 2회차 — 1회차 반려(#${String(firstReviewId)}) → 협력사 재작업 → 2회차 ` +
        `요청(#${String(secondReviewId)})에 옛 사유 미유입 → 고객 승인. 회차 격리 유지.`,
    );
  }, 480_000);

  test('K5. 주문 묶인 견적은 지울 수 없다 — 근거가 사라지면 안 된다', async (ctx) => {
    if (specId === null) return ctx.skip();

    // 고객 경로(자기 견적 삭제) — 주문된 건은 기록이라 거부돼야 한다.
    const asCustomer = await api(C, 'DELETE', `/api/pcb-projects/${String(specId)}`);
    expect(asCustomer.status >= 400, `고객 삭제 시도: ${JSON.stringify(asCustomer.json)}`).toBe(true);
    const stillThere = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(stillThere, '견적은 남아 있다').toBeTruthy();
    expect(String(stillThere?.status ?? ''), '상태도 그대로').toBe('active');
    F(
      'K5',
      'obs',
      `주문 묶인 견적 삭제 차단 — 고객 경로 ${String(asCustomer.status)} ` +
        `${String(asCustomer.json?.error ?? '')} · 견적 존속`,
    );
  }, 240_000);

  test('K6. 고객 화면 — 되묻고 바꾼 흔적이 주문 상세에 보이는가', async (ctx) => {
    if (odId === null) return ctx.skip();

    await rp.view(customer, `/shop/orderinquiryview.php?od_id=${odId}`, 'K06-customer-detail');
    const text = await bodyTextOf(customer);
    // 진행 카드(P4.13) — EQ 승인 뒤이므로 생산 이전 단계가 떠야 한다.
    expect(text, '제작 진행 상황 섹션').toContain('제작 진행 상황');
    // 사양 수정이 주문 줄에 반영됐는지(K2 의 동기가 고객 눈에도 보이는 자리).
    expect(text.includes('10'), '변경된 수량이 주문 상세에 보인다').toBe(true);
    F(
      'K6',
      'obs',
      `고객 주문 상세 관찰 — 제작 진행 상황 노출 · 수정된 수량 반영(${String(text.length)}자)`,
    );
  }, 240_000);

  test('K7. 정리 준비 — 주문 되돌리기(재고 복원)', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('K7', 'obs', `정리 준비 — od=${odId} '주문' 복귀(재고 복원). 문서는 cleanup-probe 로.`);
  }, 180_000);
});


