// 여정 31호 — **알림 게이트**(설정이 실제로 발송을 막는가).
//
// 28호가 "보낸 것이 원장에 남는가"였다면 이 편은 그 앞 — **보낼지 말지를 무엇이 정하는가**다.
// 설정이 있는데 무시되면 **고객에게 원치 않는 알림이 나가고**, 반대로 설정이 켜져 있는데 안
// 나가면 고객은 "연락을 못 받았다"고 한다. 둘 다 되돌릴 수 없다.
//
// 게이트는 두 층이다(g5-db `getNotifyConfig`):
//   • **메일** — `cf_email_use`
//   • **SMS** — `cf_sms_use='icode'` **그리고** 전이별 `de_sms_use4`(입금)/`de_sms_use5`(배송)
//     — 코어 상세(truthy)보다 좁혀 **실발송 조건과 같게** 맞춘 것이다(노출-발송 정합).
// 그 위에 요청 단위 스위치(`sendMail`/`sendSms`)가 얹힌다.
//
// 표적:
//   ① **요청이 끄면 안 나간다** — `sendMail:false` 면 원장에 기록조차 없다.
//   ② **설정이 꺼져 있으면 요청이 켜도 안 나간다** — 설정이 상위다.
//   ③ **게이트 판정이 화면·API 에서 같다** — 노출과 실발송이 어긋나면 관리자가 헛 체크한다.
//
// ⚠ 설정은 **전역**이라 잠깐 끄고 **반드시 되돌린다**(try/finally + 원복 어서션).
//    이 편은 순차 주행 전제다(병렬 주행 중이면 다른 편의 메일을 막을 수 있다).
//
// 실행: pnpm -F e2e journey:notify  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

describe.skipIf(!RUN || !JOURNEY)('여정 31호 — 알림 게이트', () => {
  const rp = createJourneyReport('findings-notify', '여정 31호 알림 게이트 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let A = '';
  let specId: number | null = null;
  let odId: string | null = null;
  let startedAt: Date | null = null;
  /** 원복용 — 주행이 만지기 전의 값. */
  let savedEmailUse: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const emailUse = async (): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT cf_email_use FROM g5_config LIMIT 1`,
    );
    return Number(rows[0]?.cf_email_use ?? 0);
  };

  const setEmailUse = async (v: number): Promise<void> => {
    await getPrisma().$executeRawUnsafe(`UPDATE g5_config SET cf_email_use = ?`, v);
  };

  /** 이 주문 컨텍스트로 이번 주행에 남은 발송 기록. */
  const orderLogs = async (): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: { refId: String(odId ?? ''), createdAt: { gte: startedAt ?? new Date(0) } },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    startedAt = new Date(Date.now() - 5_000);
    savedEmailUse = await emailUse();
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
  }, 180_000);

  afterAll(async () => {
    // ⚠ 전역 설정은 **반드시** 되돌린다 — 안 되돌리면 이후 모든 주행의 메일이 막힌다.
    if (savedEmailUse !== null) {
      await setEmailUse(savedEmailUse);
      const now = await emailUse();
      F(
        'G5',
        now === savedEmailUse ? 'obs' : 'bug',
        `전역 설정 원복 — cf_email_use=${String(now)}(주행 전 ${String(savedEmailUse)})`,
      );
    }
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('G1. 게이트 판정이 API 로 드러난다', async () => {
    const res = await api(A, 'GET', '/api/admin/orders/notify-config');
    expect(res.status, `알림 설정 조회: ${JSON.stringify(res.json)}`).toBe(200);
    const cfg = res.json?.data ?? {};
    // 화면이 체크박스를 그릴 때 쓰는 값 — DB 실값과 같아야 "노출-발송 정합"이 성립한다.
    expect(Boolean(cfg.mailAvailable), 'mailAvailable 이 DB 와 일치').toBe(
      (savedEmailUse ?? 0) > 0,
    );
    F(
      'G1',
      'obs',
      `게이트 실측 — mailAvailable=${String(cfg.mailAvailable)}(cf_email_use=${String(savedEmailUse)}) · ` +
        `smsDeposit=${String(cfg.smsDepositAvailable)} · smsShipping=${String(cfg.smsShippingAvailable)}`,
    );
  }, 180_000);

  test('G2. 요청이 끄면 기록조차 없다', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 31호] 알림 게이트 검증 — 확인 후 정리 예정',
      prefix: 'G01',
    });
    ledger.push(`sp_order_spec #${String(specId)}`);
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'G2',
      prefix: 'G01',
      buyerName: 'e2e알림게이트고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart`);

    // sendMail:false — 다른 여정이 늘 쓰는 형태다(주행이 고객에게 메일을 보내지 않게).
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인(알림 끔): ${JSON.stringify(paid.json)}`).toBe(200);

    await new Promise((r) => setTimeout(r, 2_000));
    const logs = await orderLogs();
    // 요청이 껐으면 **시도 자체가 없어야** 한다(skipped 기록도 없다 — 보내려 하지 않았다).
    expect(logs.length, '알림 끈 전이는 기록 없음').toBe(0);
    F('G2', 'obs', `요청 스위치 실측 — sendMail:false → 발송 기록 0건(시도 자체가 없다)`);
  }, 600_000);

  test('G3. 설정이 꺼지면 요청이 켜도 안 나간다 — 설정이 상위다', async (ctx) => {
    if (odId === null) return ctx.skip();

    // 준비 → 배송 전이로 알림을 한 번 더 보낼 수 있다. 그 전에 **설정을 끈다**.
    await setEmailUse(0);
    expect(await emailUse(), '설정 끔').toBe(0);

    const cfg = await api(A, 'GET', '/api/admin/orders/notify-config');
    expect(Boolean(cfg.json?.data?.mailAvailable), '설정 끔이 API 에 반영').toBe(false);

    const before = (await orderLogs()).length;
    const ship = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '준비',
      sendMail: true,
    });
    expect(ship.status, `준비 전이(알림 켬·설정 끔): ${JSON.stringify(ship.json)}`).toBe(200);

    await new Promise((r) => setTimeout(r, 2_000));
    const logs = await orderLogs();
    const added = logs.slice(before);
    // 설정이 꺼졌으면 실제로 나가면 안 된다. 기록이 생겼다면 **status 가 sent 이면 안 된다**
    // (skipped/failed 로 남는 것은 오히려 좋다 — 왜 안 갔는지가 남는다).
    const sentOnes = added.filter((l: any) => String(l.status) === 'sent');
    expect(sentOnes.length, '설정 꺼짐 — 실제 발송 0건').toBe(0);
    F(
      'G3',
      'obs',
      `설정 우선 실측 — cf_email_use=0 에서 sendMail:true 전이 → 신규 기록 ` +
        `${String(added.length)}건 중 sent 0건` +
        `${added.length > 0 ? `(${added.map((l: any) => `${String(l.kind)}:${String(l.status)}/${String(l.reason ?? '')}`).join(', ')})` : ''}`,
    );
  }, 600_000);

  test('G4. 설정을 되돌리면 다시 열린다', async (ctx) => {
    if (savedEmailUse === null) return ctx.skip();

    await setEmailUse(savedEmailUse);
    expect(await emailUse(), '설정 원복').toBe(savedEmailUse);
    const cfg = await api(A, 'GET', '/api/admin/orders/notify-config');
    expect(Boolean(cfg.json?.data?.mailAvailable), '원복이 API 에 반영').toBe(savedEmailUse > 0);
    F(
      'G4',
      'obs',
      `원복 실측 — cf_email_use=${String(savedEmailUse)} · mailAvailable=` +
        `${String(cfg.json?.data?.mailAvailable)}(게이트가 즉시 따라온다)`,
    );
  }, 300_000);

  test('G5. 정리 준비 — 주문 되돌리기', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('G5', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 문서는 cleanup-probe 로.`);
  }, 180_000);
});
