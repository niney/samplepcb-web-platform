// 여정 26호 — **재고 축**(정리 관례의 근거를 확인한다).
//
// 이 편에는 특별한 동기가 있다. **스물다섯 편의 정리 관례가 전부** "주문을 `force-status '주문'`
// 으로 되돌려 **재고를 복원**한다"에 기대고 있는데, 그게 실제로 맞는지 검증한 적이 없다. 근거가
// 틀렸다면 지금까지의 주행이 조용히 재고를 갉아먹고 있었다는 뜻이다.
//
// 영카트의 재고는 **'준비' → '배송'** 전이에서 차감된다(그때 `ct_stock_use=1` 이 찍힌다).
// 주문·입금 단계에서는 **차감이 없다** — 그래서 대부분의 여정(입금까지만 가는 편)은 애초에
// 복원할 것이 없고, 배송까지 민 편만 실제 복원이 필요하다. 복원은 `ct_stock_use=1` 인 행만
// 대상이라 **차감 안 된 행을 되돌려도 재고가 늘지 않는다**(이중 복원 방지).
//
// PCB 견적은 **견적마다 자기 옵션 행**을 갖는다(`io_id=quoteId`, 초기 재고 9999999) — 그래서
// 재고가 다른 건과 섞이지 않는다. 이 편은 그 행 하나를 추적한다.
//
// 표적:
//   ① 주문·입금 단계에서는 **재고 불변**(차감이 없다)
//   ② '배송' 전이에서 **차감**(io_stock_qty -= ct_qty) + `ct_stock_use=1`
//   ③ '주문' 복귀에서 **복원**(정리 관례의 근거)
//   ④ **이중 복원이 없다** — 복원 뒤 다시 되돌려도 재고가 늘지 않는다
//
// 실행: pnpm -F e2e journey:stock  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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
  getPrisma,
  monoRoot,
  newPhpSession,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

describe.skipIf(!RUN || !JOURNEY)('여정 26호 — 재고 축(정리 관례의 근거)', () => {
  const rp = createJourneyReport('findings-stock', '여정 26호 재고 축 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let A = '';
  let specId: number | null = null;
  let odId: string | null = null;
  let ctId: number | null = null;
  let ioId = '';
  let qty = 0;
  let baseStock = 0;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 이 견적 전용 옵션 행의 재고 — 다른 건과 섞이지 않는 관찰 지점. */
  const stockOf = async (): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT io_stock_qty FROM g5_shop_item_option WHERE io_id = ?`,
      ioId,
    );
    return Number(rows[0]?.io_stock_qty ?? -1);
  };

  /** 카트 행의 차감 표시 — 복원 대상 여부를 가르는 플래그. */
  const stockUse = async (): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT ct_stock_use FROM g5_shop_cart WHERE ct_id = ?`,
      ctId,
    );
    return Number(rows[0]?.ct_stock_use ?? -1);
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('K1. 주문·입금에서는 재고가 움직이지 않는다', async () => {
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 26호] 재고 축 검증 — 확인 후 정리 예정',
      prefix: 'R01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (거버 rfq 제출)`);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'K1',
      prefix: 'R01',
      buyerName: 'e2e재고검증고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart`);

    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    ctId = spec?.ctId === null || spec?.ctId === undefined ? null : Number(spec.ctId);
    expect(ctId, '주문 줄 연결').not.toBeNull();
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT io_id, ct_qty FROM g5_shop_cart WHERE ct_id = ?`,
      ctId,
    );
    ioId = String(rows[0]?.io_id ?? '');
    qty = Number(rows[0]?.ct_qty ?? 0);
    expect(ioId, '견적 전용 옵션 행(io_id)').not.toBe('');
    expect(qty, '주문 수량').toBeGreaterThan(0);

    baseStock = await stockOf();
    // 견적 옵션 행은 9999999 로 생성된다 — 주문했다고 줄지 않는다(차감은 배송 전이에서).
    expect(baseStock, '주문 직후 재고(차감 없음)').toBe(9_999_999);
    expect(await stockUse(), '주문 직후 차감 표시 없음').toBe(0);

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
    expect(await stockOf(), '입금 후에도 재고 불변').toBe(baseStock);
    expect(await stockUse(), '입금 후에도 차감 표시 없음').toBe(0);
    F(
      'K1',
      'obs',
      `주문·입금 재고 불변 — io_id=${ioId} qty=${String(qty)} stock=${String(baseStock)} · ` +
        `ct_stock_use=0(차감은 배송 전이에서 일어난다)`,
    );
  }, 600_000);

  test('K2. 배송 전이에서 차감된다', async (ctx) => {
    if (odId === null) return ctx.skip();

    // '준비'를 거쳐 '배송'으로 — 운송장이 필수다(차감은 이 전이의 부수효과).
    expect(
      (await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '준비' })).status,
      '준비 전이',
    ).toBe(200);
    expect(await stockOf(), '준비에서도 재고 불변').toBe(baseStock);

    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송',
      deliveryCompany: 'CJ대한통운',
      invoiceNo: 'STOCK-0811',
    });
    expect(ship.status, `배송 전이: ${JSON.stringify(ship.json)}`).toBe(200);

    expect(await stockOf(), '배송 전이에서 수량만큼 차감').toBe(baseStock - qty);
    expect(await stockUse(), '차감 표시가 찍힌다').toBe(1);
    F(
      'K2',
      'obs',
      `배송 차감 실측 — ${String(baseStock)} → ${String(baseStock - qty)}(-${String(qty)}) · ` +
        `ct_stock_use=1`,
    );
  }, 300_000);

  test('K3. 주문 복귀에서 복원된다 — 정리 관례의 근거', async (ctx) => {
    if (odId === null) return ctx.skip();

    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 복귀: ${JSON.stringify(back.json)}`).toBe(200);

    // 스물다섯 편의 정리가 이 한 줄에 기대고 있다 — 여기가 틀리면 주행마다 재고가 샌다.
    expect(await stockOf(), '주문 복귀에서 재고 복원').toBe(baseStock);
    expect(await stockUse(), '차감 표시 해제').toBe(0);
    F(
      'K3',
      'obs',
      `복원 실측 — ${String(baseStock - qty)} → ${String(baseStock)}(+${String(qty)}) · ` +
        `ct_stock_use=0. **여정 정리 관례(force-status '주문')의 근거가 실측으로 확인됐다.**`,
    );
  }, 300_000);

  test('K4. 이중 복원이 없다', async (ctx) => {
    if (odId === null) return ctx.skip();

    // 이미 '주문'인 건을 다시 되돌려도 재고가 늘면 안 된다(복원은 차감 표시가 있는 행만).
    const again = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    // 같은 상태 재설정은 거절될 수도, 무해하게 통과할 수도 있다 — 어느 쪽이든 **재고는 불변**이다.
    expect(await stockOf(), '재복원 시도 후에도 재고 불변').toBe(baseStock);
    F(
      'K4',
      'obs',
      `이중 복원 없음 — 재시도 응답 ${String(again.status)} · 재고 ${String(baseStock)} 유지 ` +
        `(복원 대상은 ct_stock_use=1 인 행뿐이다)`,
    );
  }, 300_000);
});
