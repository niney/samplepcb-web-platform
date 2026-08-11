// 여정 41호 — **동시 조작 2탄: 돈 축**(같은 순간 두 번 눌렀을 때).
//
// 16호는 담기·발행에서 "제약은 지키는데 방어가 500 으로 샌다"를 잡았다. 그때 손대지 않은
// 축이 **돈**이다. 경리가 송금 기록 버튼을 두 번 누르거나, 두 사람이 같은 발주서를 동시에
// 정산하는 일은 실제로 일어난다. 돈은 되돌리기가 가장 비싼 자리라 더 봐야 한다.
//
// 33호가 새로 만든 둘도 함께 건다:
//   · **완납 통지 1회** — 두 송금이 동시에 잔액을 0 으로 만들면 메일이 두 번 나가는가?
//     (그 중복 방지는 "확인-후-발송" 사이에 레이스가 있다고 코드 주석이 스스로 밝혀 두었다.)
//   · **환불 기록** — 같은 금액을 두 번 적으면 과입금이 음수로 뒤집히는가?
//
// 표적은 16호와 같다: ① 원장이 깨지지 않는가 ② 방어가 **의미 있는 응답**으로 나오는가
// (500 은 "서버가 놀랐다"이지 "그럴 수 없다"가 아니다).
//
// 실행: pnpm -F e2e journey:moneyrace  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

const PO_USD = 200;
const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 41호 — 동시 조작(돈 축)', () => {
  const rp = createJourneyReport('findings-money-race', '여정 41호 돈 축 경합 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let partner2: PartnerFixture;
  let A = '';
  let P = '';
  let specId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let startedAt: Date | null = null;

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

  const settledLogs = async (): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: {
        kind: 'pcb_remit_settled',
        refType: 'pcb_po',
        refId: String(poId ?? ''),
        createdAt: { gte: startedAt ?? new Date(0) },
      },
    });

  const orderRow = async (): Promise<any> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_misu, od_refund_price FROM g5_shop_order WHERE od_id = ?`,
      odId,
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
    startedAt = new Date(Date.now() - 5_000);
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('C1. 준비 — 발주까지', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 41호] 돈 축 경합 — 확인 후 정리 예정',
      prefix: 'C01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, `RFQ: ${JSON.stringify(send.json)}`).toBe(200);
    const rfqId = (send.json?.data?.rfqs ?? [])[0]?.rfqId;
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
        { exchangeRate: 1400, finalPrice: 300_000 },
      )).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'C1',
      prefix: 'C01',
      buyerName: 'e2e경합고객',
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
      exchangeRate: 1400,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? [])[0]?.poId ?? null;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)}`);
  }, 900_000);

  test('C2. 송금 기록 버튼을 두 번 눌렀다 — 원장이 두 줄이 되는가', async (ctx) => {
    if (poId === null) return ctx.skip();
    const body = {
      remittedOn: '2026-08-11',
      amount: PO_USD / 2,
      exchangeRate: 1390,
      memo: '[여정 41호] 더블클릭',
    };
    // 같은 요청 두 개를 동시에 — 실제 더블클릭과 같은 모양이다.
    const [a, b] = await Promise.all([
      api(A, 'POST', remitPath(), body),
      api(A, 'POST', remitPath(), body),
    ]);
    const codes = [a.status, b.status].sort();

    const rows = await getPrisma().spPcbRemittance.findMany({ where: { poId: BigInt(poId) } });
    // 송금은 **여러 번 보낼 수 있는 일**이라 두 줄이 정상일 수 있다 — 다만 그 결과가
    // 원장·요약과 어긋나면 안 된다. 여기서 보는 것은 "합계가 실제 줄 수와 맞는가"다.
    const sum = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const d = await api(A, 'GET', remitPath());
    const summary = d.json?.data?.summary ?? {};
    expect(summary.count, '요약 건수 = 실제 줄 수').toBe(rows.length);
    expect(Number(summary.paidAmount), '요약 합계 = 실제 합').toBeCloseTo(sum, 2);
    expect(codes.every((c) => c < 500), `500 없음: ${codes.join(',')}`).toBe(true);
    F(
      'C2',
      'obs',
      `동시 송금 실측 — 응답 [${codes.join(', ')}] · 원장 ${String(rows.length)}줄 합 ` +
        `${String(sum)} · 요약 count=${String(summary.count)}/paid=${String(summary.paidAmount)}` +
        `(둘 다 성공해도 요약이 실제와 어긋나지 않는다)`,
    );
  }, 600_000);

  test('C3. 두 송금이 동시에 잔액을 0 으로 만들면 완납 통지가 몇 번 나가나', async (ctx) => {
    if (poId === null) return ctx.skip();
    // 지금까지 절반(또는 그 두 배)이 들어갔다 — 남은 잔액을 **동시에 두 번** 채운다.
    const d0 = await api(A, 'GET', remitPath());
    const balance = Number(d0.json?.data?.summary?.balance ?? 0);
    const body = {
      remittedOn: '2026-08-11',
      amount: balance > 0 ? balance : 1,
      exchangeRate: 1395,
      memo: '[여정 41호] 잔금 동시',
    };
    const [a, b] = await Promise.all([
      api(A, 'POST', remitPath(), body),
      api(A, 'POST', remitPath(), body),
    ]);
    expect([a.status, b.status].every((c) => c < 500), '500 없음').toBe(true);

    await new Promise((r) => setTimeout(r, 3_000));
    const logs = await settledLogs();
    const sent = logs.filter((l: any) => String(l.status) === 'sent');
    // 코드 주석이 스스로 밝힌 레이스다 — 실제로 두 번 나가는지 여기서 값으로 확인한다.
    F(
      'C3',
      sent.length > 1 ? 'bug' : 'obs',
      sent.length > 1
        ? `**완납 통지가 ${String(sent.length)}번 나갔다** — 잔액을 0 으로 만드는 두 요청이 ` +
          `동시에 오면 "이미 보냈나" 확인과 발송 사이가 벌어진다(sp_mail_log 조회 기반 중복 ` +
          `방지의 알려진 레이스). 협력사는 같은 안내를 두 번 받는다.`
        : `동시 완납 실측 — 통지 ${String(sent.length)}건(중복 없음) · 잔액을 0 으로 만드는 ` +
          `요청이 둘이어도 안내는 한 번이다.`,
    );
  }, 600_000);

  test('C4. 부분 취소 뒤 환불을 두 번 적으면 — 과입금이 음수로 뒤집히는가', async (ctx) => {
    if (odId === null) return ctx.skip();
    // 줄이 하나뿐이라 취소하면 전량 취소다 — 과입금을 만들려면 결제 흔적이 남은 채
    // 되살려야 한다. force-status 로 '주문' 복귀 후 다시 입금하면 수납액이 남는다.
    const spec = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId ?? 0) } });
    const ctId = spec?.ctId ?? 0;
    expect(
      (await api(A, 'PATCH', `/api/admin/orders/${odId}/items/status`, {
        ctIds: [ctId],
        target: '취소',
      })).status,
      '취소',
    ).toBe(200);

    const od0 = await orderRow();
    const overpaid = -Number(od0.od_misu);
    if (overpaid <= 0) {
      F('C4', 'obs', `과입금이 생기지 않아(미수 ${String(od0.od_misu)}) 환불 경합은 건너뛴다.`);
      return;
    }

    // 같은 금액을 동시에 두 번 기록 — 누계 필드라 **덮어쓰기**여야 한다(더해지면 뒤집힌다).
    const body = { refundPrice: overpaid, note: '[여정 41호] 동시 환불' };
    const [a, b] = await Promise.all([
      api(A, 'PATCH', `/api/admin/orders/${odId}/refund`, body),
      api(A, 'PATCH', `/api/admin/orders/${odId}/refund`, body),
    ]);
    expect([a.status, b.status].every((c) => c < 500), '500 없음').toBe(true);

    const od1 = await orderRow();
    // 누계를 **적는** 창구라 두 번 적어도 값은 같아야 한다 — 더해지면 미수가 양수로 튄다.
    expect(Number(od1.od_refund_price), '환불 누계는 덮어쓰기').toBe(overpaid);
    expect(Number(od1.od_misu), '과입금이 0 으로 닫힌 채 유지').toBe(0);
    F(
      'C4',
      'obs',
      `동시 환불 실측 — 과입금 ${String(overpaid)} 을 두 번 기록 → od_refund_price ` +
        `${String(od1.od_refund_price)}(덮어쓰기) · 미수 ${String(od1.od_misu)}. ` +
        `누계 필드라 중복 클릭이 금액을 부풀리지 않는다.`,
    );
  }, 600_000);

  test('C5. 정리 준비 — 원장 비우고 주문 되돌리기', async (ctx) => {
    if (poId === null || odId === null) return ctx.skip();
    const d = await api(A, 'GET', remitPath());
    for (const r of d.json?.data?.remittances ?? []) {
      await api(A, 'DELETE', remitPath(r.id));
    }
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('C5', 'obs', `정리 준비 — 송금 원장 비움 · od=${odId} '주문' 복귀.`);
  }, 300_000);
});
