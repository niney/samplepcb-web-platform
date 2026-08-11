// 여정 40호 — **전량 취소 뒤 되살리기**(끝난 줄 알았던 주문을 다시 세울 수 있는가).
//
// 15호는 EQ·선적을 **한 칸씩** 되돌렸다. 10호는 두 줄 중 **한 줄만** 취소했다. 이 편은
// 그 둘이 안 본 자리다 — **전량 취소로 주문 헤더까지 '취소'가 된 뒤**, 고객이 "역시
// 진행해 주세요" 하면 무슨 일이 나는가.
//
// 코드는 이 경로를 알고 있다: force-status 의 역방향 '주문' 은 **취소류 행까지 포함**해
// un-cancel 한다(⑯ 주석). 여정들의 정리 관례가 기대는 바로 그 동작이다. 하지만 지금까지
// 아무도 **되살린 뒤 다시 앞으로 갈 수 있는지**는 확인하지 않았다.
//
// 표적:
//   ① 전량 취소 → od 헤더가 '취소'가 되고 협력 트랙 가드가 잠긴다(ORDER_CANCELED)
//   ② 되살리기 → 줄·헤더가 함께 '주문'으로 돌아오고 **재고 점유가 풀린다**
//   ③ 되살린 뒤 **다시 입금·발주가 된다** — 잠금이 실제로 열렸는가
//
// 실행: pnpm -F e2e journey:revive  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 40호 — 전량 취소 뒤 되살리기', () => {
  const rp = createJourneyReport('findings-revive', '여정 40호 되살리기 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let partner2: PartnerFixture;
  let A = '';
  let P = '';
  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let ctId: number | null = null;
  let poId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const orderRow = async (): Promise<any> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_status, od_cancel_price, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    return rows[0] ?? {};
  };

  const cartRow = async (): Promise<any> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT ct_status, ct_stock_use FROM g5_shop_cart WHERE ct_id = ?`,
      ctId,
    );
    return rows[0] ?? {};
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K1. 준비 — 견적 → 주문 → 입금 → 발주', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 40호] 되살리기 — 확인 후 정리 예정',
      prefix: 'K01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, `RFQ: ${JSON.stringify(send.json)}`).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? [])[0]?.rfqId ?? null;
    expect(
      (await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
        price: 200,
        quotedDeliveryDate: '2026-08-28',
      })).status,
      '회신',
    ).toBe(200);
    expect(
      (await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: 300_000 },
      )).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'K1',
      prefix: 'K01',
      buyerName: 'e2e되살리기고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId}`);
    const spec = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    ctId = spec?.ctId ?? null;
    expect(ctId, 'ct_id').not.toBeNull();

    expect(
      (await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: false,
        sendSms: false,
      })).status,
      '입금확인',
    ).toBe(200);
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId,
      exchangeRate: 1400,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? [])[0]?.poId ?? null;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);
    F('K1', 'obs', `준비 — od=${odId} · ct=${String(ctId)} · po #${String(poId)}`);
  }, 900_000);

  test('K2. 전량 취소 — 헤더까지 취소가 되고 협력 트랙이 잠긴다', async (ctx) => {
    if (odId === null || ctId === null) return ctx.skip();
    const res = await api(A, 'PATCH', `/api/admin/orders/${odId}/items/status`, {
      ctIds: [ctId],
      target: '취소',
    });
    expect(res.status, `전량 취소: ${JSON.stringify(res.json)}`).toBe(200);
    // 줄이 하나뿐이라 이 취소가 곧 전량 취소다 — 헤더까지 '취소'가 된다(⑮).
    expect(res.json?.data?.orderCancelled, '전량 취소 판정').toBe(true);
    expect(String(res.json?.data?.odStatus), 'od 헤더 상태').toBe('취소');

    const od = await orderRow();
    expect(String(od.od_status), 'DB 헤더도 취소').toBe('취소');

    // 취소된 주문의 보드를 계속 만들지 않는다 — EQ 전진이 막혀야 한다(ORDER_CANCELED).
    const advance = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(advance.status, `취소 주문의 EQ 전진: ${JSON.stringify(advance.json)}`).toBe(409);
    expect(String(advance.json?.error), '가드 코드').toBe('ORDER_CANCELED');
    F(
      'K2',
      'obs',
      `전량 취소 실측 — od_status='${String(od.od_status)}' · 취소액 ${String(od.od_cancel_price)} · ` +
        `협력 트랙 전진 409 ${String(advance.json?.error)}(만들던 보드를 멈춘다)`,
    );
  }, 300_000);

  test('K3. 되살리기 — 줄과 헤더가 함께 돌아온다', async (ctx) => {
    if (odId === null || ctId === null) return ctx.skip();
    const before = await cartRow();
    expect(String(before.ct_status), '되살리기 전 줄 상태').toBe('취소');

    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `되살리기: ${JSON.stringify(back.json)}`).toBe(200);

    const od = await orderRow();
    const ct = await cartRow();
    // 역방향 '주문'은 취소류까지 포함해 un-cancel 한다 — 헤더만 돌아오고 줄이 남으면
    // 화면과 원장이 딴말을 한다(⑯이 취소류를 포함하는 이유).
    expect(String(od.od_status), '헤더 복귀').toBe('주문');
    expect(String(ct.ct_status), '줄도 함께 복귀').toBe('주문');
    // 배송 전이라 애초에 차감된 적이 없다 — 복원 대상도 아니다(26호가 밝힌 규칙).
    expect(Number(ct.ct_stock_use ?? -1), '재고 점유 표시 해제').toBe(0);
    expect(Number(od.od_cancel_price ?? -1), '취소액 소멸').toBe(0);
    F(
      'K3',
      'obs',
      `되살리기 실측 — 헤더 '${String(od.od_status)}' · 줄 '${String(ct.ct_status)}' · ` +
        `stock_use ${String(ct.ct_stock_use)} · 취소액 ${String(od.od_cancel_price)}`,
    );
  }, 300_000);

  test('K4. 되살린 뒤 다시 앞으로 — 잠금이 정말 열렸는가', async (ctx) => {
    if (odId === null) return ctx.skip();
    // 다시 입금 → 협력 트랙 전진. "되살렸다"의 증명은 여기다.
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `재입금: ${JSON.stringify(paid.json)}`).toBe(200);
    expect(paid.json?.data?.processed, '재입금 처리').toContain(odId);

    const advance = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {});
    expect(advance.status, `되살린 뒤 EQ 전진: ${JSON.stringify(advance.json)}`).toBe(200);

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId ?? 0) } });
    expect(String(po?.status), 'EQ 승인요청으로 전진').toBe('eq_requested');
    F(
      'K4',
      'obs',
      `재진행 실측 — 재입금 200 · EQ 전진 200 → 발주 상태 '${String(po?.status)}'. ` +
        `전량 취소는 **되돌릴 수 있는 종결**이다(발주서를 새로 만들 필요가 없다).`,
    );
  }, 300_000);

  test('K5. 정리 준비 — 주문 되돌리기', async (ctx) => {
    if (odId === null || poId === null) return ctx.skip();
    // 발주를 EQ 이전으로 되돌려 정리 스크립트가 지울 수 있게 한다.
    await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-revert`, {});
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('K5', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 나머지는 cleanup-probe 로.`);
  }, 180_000);
});
