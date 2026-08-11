// 여정 28호 — **발송 이력 원장**(보냈다는 것을 증명할 수 있는가).
//
// 스물일곱 편이 메일을 보내는 동안, 그 발송이 **`sp_mail_log` 에 제대로 남는지**는 검증된 적이
// 없다. Mailpit 으로 "도착했다"는 여러 번 봤지만 그건 개발 환경의 수신함이고, **원장은 운영에서
// 유일한 증거**다 — 협력사가 "못 받았다"고 할 때 관리자가 댈 근거가 이것뿐이다.
//
// 표적:
//   ① **자동 알림이 기록된다** — 발주서 도착·EQ 결정처럼 트랙이 스스로 보내는 메일.
//   ② **컨텍스트가 정확하다** — `refType`/`refId` 가 그 건을 가리켜야 Case 상세에서 되찾는다.
//      틀리면 원장에는 있는데 **아무 화면에서도 안 보인다**.
//   ③ **주체가 남는다**(`sentBy`) — 관리자가 눌러 나간 메일과 시스템 자동 발송이 구별돼야 한다.
//   ④ **수신처가 남는다** — "어디로 보냈나"가 없으면 증거로 못 쓴다.
//   ⑤ **Case 상세에서 되찾을 수 있다** — 원장에 있는 것이 화면까지 온다.
//
// 실행: pnpm -F e2e journey:maillog  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

describe.skipIf(!RUN || !JOURNEY)('여정 28호 — 발송 이력 원장', () => {
  const rp = createJourneyReport('findings-maillog', '여정 28호 발송 이력 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  /** 주행 시작 시각 — 이 뒤에 생긴 기록만 본다(지난 주행분과 섞이지 않게). */
  let startedAt: Date | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 이 스펙 컨텍스트로 이번 주행에 남은 발송 기록. */
  const logsOfSpec = async (): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: {
        refType: 'pcb_spec',
        refId: String(specId ?? 0),
        createdAt: { gte: startedAt ?? new Date(0) },
      },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    startedAt = new Date(Date.now() - 5_000); // 약간의 여유(시계 오차)
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

  test('N1. 견적요청 발송이 원장에 남는다', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 28호] 발송 이력 검증 — 확인 후 정리 예정',
      prefix: 'M01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId;
    ledger.push(`sp_pcb_rfq #${String(rfqId)}`);

    // 메일은 비동기(void sendPcbMail)라 잠깐 기다린다 — 기록이 늦게 붙을 수 있다.
    await new Promise((r) => setTimeout(r, 3_000));
    const logs = await logsOfSpec();
    expect(logs.length, '견적요청 발송 기록').toBeGreaterThan(0);

    const rfqLog = logs[0];
    // 컨텍스트가 틀리면 원장에는 있는데 **아무 화면에서도 안 보인다**.
    expect(String(rfqLog.refType), 'refType').toBe('pcb_spec');
    expect(String(rfqLog.refId), 'refId = 이 스펙').toBe(String(specId));
    expect(String(rfqLog.channel), '채널').toBe('email');
    // 수신처가 없으면 증거로 못 쓴다.
    expect(String(rfqLog.recipient ?? ''), '수신처 기록').not.toBe('');
    F(
      'N1',
      'obs',
      `견적요청 기록 — kind=${String(rfqLog.kind)} status=${String(rfqLog.status)} ` +
        `recipient=${String(rfqLog.recipient)} sentBy=${String(rfqLog.sentBy ?? '(시스템)')}`,
    );
  }, 600_000);

  test('N2. 발주서 발행도 남는다 — 주체와 함께', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();

    expect(
      (
        await api(A, 'PUT', `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/reply`, {
          price: 80,
          quotedDeliveryDate: '2026-10-30',
        })
      ).status,
      '대리 회신',
    ).toBe(200);
    expect(
      (
        await api(
          A,
          'POST',
          `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
          { finalPrice: 150_000, exchangeRate: 1400 },
        )
      ).status,
      '선정+확정가',
    ).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'N2',
      prefix: 'M02',
      buyerName: 'e2e발송이력고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart`);
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

    const before = (await logsOfSpec()).length;
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id))?.poId;
    ledger.push(`sp_pcb_po #${String(poId)}`);

    await new Promise((r) => setTimeout(r, 3_000));
    const logs = await logsOfSpec();
    expect(logs.length, '발주서 발행 기록이 추가된다').toBeGreaterThan(before);

    const poLog = logs[logs.length - 1];
    expect(String(poLog.refId), 'refId = 이 스펙').toBe(String(specId));
    // 관리자가 눌러서 나간 메일이므로 주체가 남아야 한다(시스템 자동과 구별된다).
    expect(String(poLog.sentBy ?? ''), '트리거 주체(관리자)').toBe('e2e-admin');
    F(
      'N2',
      'obs',
      `발주서 기록 — kind=${String(poLog.kind)} sentBy=${String(poLog.sentBy)} ` +
        `recipient=${String(poLog.recipient)} (총 ${String(logs.length)}건 누적)`,
    );
  }, 600_000);

  test('N3. 종류가 갈리고 상태가 남는다', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();

    // EQ 승인요청·승인 — 트랙이 스스로 보내는 알림 두 종을 더 만든다.
    const base = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;
    // 첨부가 있어야 승인요청이 열린다.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', new File([bytes], `${fileType}-log.zip`, { type: 'application/zip' }));
      const up = await fetch(`${API_URL}${base}/eq-files`, {
        method: 'POST',
        headers: { authorization: `Bearer ${A}` },
        body: form,
      });
      expect(up.status, `${fileType} 대행 업로드`).toBe(200);
    }
    expect((await api(A, 'POST', `${base}/eq-request`, {})).status, 'EQ 승인요청').toBe(200);
    expect((await api(A, 'POST', `${base}/eq-approve`, {})).status, 'EQ 승인').toBe(200);

    await new Promise((r) => setTimeout(r, 3_000));
    const logs = await logsOfSpec();
    const kinds = [...new Set(logs.map((l: any) => String(l.kind)))];
    // 종류가 하나로 뭉뚱그려지면 "무슨 메일이었나"를 나중에 못 가린다.
    expect(kinds.length, '발송 종류가 갈린다').toBeGreaterThan(1);
    // 상태는 전부 유효한 값이어야 한다(빈 문자열·미지정이면 집계가 깨진다).
    for (const l of logs) {
      expect(['sent', 'failed', 'skipped'], `status 유효(${String(l.kind)})`).toContain(
        String(l.status),
      );
    }
    const failed = logs.filter((l: any) => String(l.status) !== 'sent');
    F(
      'N3',
      'obs',
      `종류·상태 실측 — ${String(logs.length)}건 · kinds=[${kinds.join(', ')}] · ` +
        `비정상 ${String(failed.length)}건${failed.length > 0 ? `(${failed.map((l: any) => `${String(l.kind)}:${String(l.status)}/${String(l.reason ?? '')}`).join(', ')})` : ''}`,
    );
  }, 600_000);

  test('N4. Case 상세에서 되찾을 수 있다', async (ctx) => {
    if (specId === null) return ctx.skip();

    // 원장에 있는 것이 화면까지 와야 한다 — refType/refId 가 맞아야 성립하는 연결이다.
    const res = await api(A, 'GET', `/api/admin/mail-logs?refType=pcb_spec&refId=${String(specId)}`);
    expect(res.status, `이력 조회: ${JSON.stringify(res.json)}`).toBe(200);
    const items: any[] = res.json?.data?.items ?? [];
    expect(items.length, 'Case 컨텍스트로 조회된다').toBeGreaterThan(0);

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'M04-case-maillog');
    const text = (await adminView.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    expect(text, "Case 상세에 '보낸 메일' 섹션").toContain('보낸 메일');
    F(
      'N4',
      'obs',
      `되찾기 실측 — API ${String(items.length)}건 · Case 상세 '보낸 메일' 섹션 노출`,
    );
  }, 300_000);

  test('N5. 정리 준비 — 주문 되돌리기', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('N5', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 문서는 cleanup-probe 로.`);
  }, 180_000);
});
