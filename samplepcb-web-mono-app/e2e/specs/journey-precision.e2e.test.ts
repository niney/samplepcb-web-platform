// 여정 37호 — **금액 정밀도**(나눠서 낸 돈의 합이 원금과 같은가).
//
// 8호가 잡은 것은 **환차**(발주 환율과 실제 송금 환율의 차이)였다. 이 편은 그 옆의 다른
// 오차 — **반올림 누적**이다. 같은 금액을 한 번에 보내느냐 세 번에 나눠 보내느냐로
// 원화 환산 합계가 달라진다. 회계에서 이 몇 원이 계정을 안 맞게 만든다.
//
// 두 축을 본다:
//   ① **외화 소수 2자리** — Decimal(15,2)에 안 떨어지는 값을 넣으면 어떻게 되나.
//      100.03 을 셋으로 나누면 33.34+33.34+33.35 다. 잔액이 정확히 0 이 되는가?
//   ② **KRW 환산 누적** — 회차마다 반올림하면 합계가 한 번에 곱한 값과 어긋난다.
//      그 차이가 화면 어디에도 안 나타나면 "다 줬는데 장부가 안 맞는" 상태가 된다.
//
// 판정 기준은 계약이 이미 정해 두었다: `EPSILON=0.005`(Decimal 2자리 밖은 잡음),
// `roundPcbAmount`(KRW 0자리·외화 2자리). 그 규칙이 실제로 지켜지는지 실측한다.
//
// 실행: pnpm -F e2e journey:precision  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

/** 셋으로 나누면 딱 떨어지지 않는 발주가 — 33.343... 이 된다. */
const PO_USD = 100.03;
const PARTS = [33.34, 33.34, 33.35]; // 합 100.03
/** 소수 4자리 환율 — KRW 환산에서 반올림이 반드시 일어난다. */
const RATE = 1384.5678;

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 37호 — 금액 정밀도', () => {
  const rp = createJourneyReport('findings-precision', '여정 37호 금액 정밀도 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let partner2: PartnerFixture;
  let A = '';
  let P = '';
  let specId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const remitPath = (id?: number): string =>
    `/api/admin/pcb-remittances/${String(poId)}${id === undefined ? '' : `/${String(id)}`}`;

  const detail = async (): Promise<any> => {
    const r = await api(A, 'GET', remitPath());
    expect(r.status, `송금 상세: ${JSON.stringify(r.json)}`).toBe(200);
    return r.json?.data ?? {};
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

  test('Y1. 준비 — 소수가 붙은 발주가로 발주까지', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 37호] 금액 정밀도 — 확인 후 정리 예정',
      prefix: 'Y01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, `RFQ: ${JSON.stringify(send.json)}`).toBe(200);
    const rfqId = (send.json?.data?.rfqs ?? [])[0]?.rfqId;
    // 회신가에 소수를 넣는다 — 협력사가 실제로 이렇게 준다(단가 × 수량의 결과).
    expect(
      (await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
        price: PO_USD,
        quotedDeliveryDate: '2026-08-28',
      })).status,
      '회신',
    ).toBe(200);
    expect(
      (await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
        { exchangeRate: RATE, finalPrice: 300_000 },
      )).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'Y1',
      prefix: 'Y01',
      buyerName: 'e2e정밀도고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId}`);
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
      exchangeRate: RATE,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? [])[0];
    poId = po?.poId ?? null;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);

    // 발주가는 소수 2자리 그대로, KRW 회계 박제는 0자리로 접힌다(roundPcbAmount).
    expect(po.priceOriginal, '발주가 소수 보존').toBe(PO_USD);
    const expectedKrw = Math.round(PO_USD * RATE);
    F(
      'Y1',
      Math.abs(Number(po.krwAmount) - expectedKrw) <= 1 ? 'obs' : 'bug',
      `발주 박제 실측 — USD ${String(po.priceOriginal)} @${String(RATE)} → krwAmount ` +
        `${String(po.krwAmount)}(기대 ${String(expectedKrw)}) · 환율 소수 4자리 보존 ` +
        `${String(po.exchangeRate)}`,
    );
  }, 900_000);

  test('Y2. 셋으로 나눠 보낸다 — 잔액이 정확히 0 이 되는가', async (ctx) => {
    if (poId === null) return ctx.skip();
    const seen: string[] = [];
    for (const [i, amount] of PARTS.entries()) {
      const r = await api(A, 'POST', remitPath(), {
        remittedOn: '2026-08-11',
        amount,
        exchangeRate: RATE,
        memo: `[여정 37호] ${String(i + 1)}차`,
      });
      expect(r.status, `${String(i + 1)}차 송금: ${JSON.stringify(r.json)}`).toBe(200);
      const s = r.json?.data?.summary ?? {};
      seen.push(`${String(i + 1)}차 후 지급 ${String(s.paidAmount)}/잔액 ${String(s.balance)}(${String(s.status)})`);
    }
    const d = await detail();
    const s = d.summary ?? {};
    // 33.34+33.34+33.35 = 100.03 — 부동소수 합이라 0.0000000001 이 남을 수 있다.
    // 그래서 계약이 EPSILON(0.005)을 두었다. 화면에 찍히는 값은 **정확히 0** 이어야 한다.
    expect(s.paidAmount, '지급 합계 = 발주가').toBe(PO_USD);
    expect(s.balance, '잔액 0(반올림 뒤)').toBe(0);
    expect(s.status, '완납 판정').toBe('paid');
    F(
      'Y2',
      'obs',
      `분할 송금 실측 — ${seen.join(' · ')} · 최종 지급 ${String(s.paidAmount)} / 잔액 ` +
        `${String(s.balance)} / ${String(s.status)}(부동소수 잔여를 EPSILON 이 흡수한다)`,
    );
  }, 600_000);

  test('Y3. 회차마다 반올림한 KRW 합이 한 번에 곱한 값과 얼마나 벌어지나', async (ctx) => {
    if (poId === null) return ctx.skip();
    const rows = await getPrisma().spPcbRemittance.findMany({
      where: { poId: BigInt(poId) },
      orderBy: { id: 'asc' },
    });
    expect(rows.length, '송금 3건').toBe(3);

    const perRow = rows.map((r: any) => Number(r.krwAmount ?? 0));
    const sumOfRounded = perRow.reduce((a: number, b: number) => a + b, 0);
    const roundedOfSum = Math.round(PO_USD * RATE);
    const gap = sumOfRounded - roundedOfSum;

    // 각 회차는 반올림해 저장된다(krwAmount 는 정수 KRW). 그 합이 총액 반올림과 다를 수 있다.
    // 이 편의 물음은 "차이가 있는가"가 아니라 **"얼마나 크고, 어디에 드러나는가"**다.
    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    F(
      'Y3',
      Math.abs(gap) > 2 ? 'bug' : 'obs',
      `반올림 누적 실측 — 회차별 KRW [${perRow.join(', ')}] 합 ${String(sumOfRounded)} vs ` +
        `총액 일괄 환산 ${String(roundedOfSum)} → **차이 ${String(gap)}원** · 발주 회계 박제 ` +
        `krwAmount=${String(po?.krwAmount)}. 협력사별 집계는 지급액을 **원장 실합**으로 세므로` +
        `(8호 확정) 이 차이가 그대로 화면에 남는다 — 발주가와 지급액이 몇 원 어긋나 보인다.`,
    );
  }, 300_000);

  test('Y4. 1원(1센트) 남기면 미완납인가 — 경계 판정', async (ctx) => {
    if (poId === null) return ctx.skip();
    const d = await detail();
    const last = (d.remittances ?? []).at(-1);
    expect(last, '마지막 송금 행').toBeTruthy();

    // 마지막 회차를 1센트 줄인다 → 잔액 0.01. EPSILON(0.005)보다 크므로 **미완납**이라야 한다.
    const patched = await api(A, 'PATCH', remitPath(last.id), { amount: Number(last.amount) - 0.01 });
    expect(patched.status, `1센트 감액: ${JSON.stringify(patched.json)}`).toBe(200);
    const s1 = patched.json?.data?.summary ?? {};
    expect(s1.balance, '잔액 0.01').toBeCloseTo(0.01, 2);
    expect(s1.status, '1센트가 남으면 부분 지급').toBe('partial');

    // 되돌리면 다시 완납 — 경계가 양방향으로 동작하는지 본다.
    const restored = await api(A, 'PATCH', remitPath(last.id), { amount: Number(last.amount) });
    expect(restored.status, '원복').toBe(200);
    expect(restored.json?.data?.summary?.status, '되돌리면 완납').toBe('paid');
    F(
      'Y4',
      'obs',
      `경계 실측 — 1센트 부족(잔액 0.01) → '${String(s1.status)}' · 원복 → ` +
        `'${String(restored.json?.data?.summary?.status)}'. EPSILON(0.005)은 부동소수 잡음만 ` +
        `흡수하고 **실제 1센트는 흡수하지 않는다**.`,
    );
  }, 600_000);

  test('Y5. 정리 준비 — 원장 비우고 주문 되돌리기', async (ctx) => {
    if (poId === null || odId === null) return ctx.skip();
    const d = await detail();
    for (const r of d.remittances ?? []) {
      const rm = await api(A, 'DELETE', remitPath(r.id));
      expect(rm.status, `송금 삭제 #${String(r.id)}`).toBe(200);
    }
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('Y5', 'obs', `정리 준비 — 송금 원장 비움 · od=${odId} '주문' 복귀. 나머지는 cleanup-probe 로.`);
  }, 300_000);
});
