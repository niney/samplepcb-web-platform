// 여정 38호 — **수신자 없는 알림**(보낼 곳이 없을 때 무슨 일이 나는가).
//
// 31호는 "설정이 발송을 막는가"(게이트)를 봤고 28호는 "보낸 것이 남는가"(원장)를 봤다.
// 이 편은 그 사이 — **보낼 주소 자체가 없을 때**다. 협력사 담당자 메일이 비어 있는 조직은
// 실제로 있다(전화로만 거래하던 곳, 이관 데이터, 방금 등록한 조직).
//
// 그때 두 가지가 갈릴 수 있다:
//   ① 발송이 **조용히 사라진다** — 관리자는 보냈다고 믿고 협력사는 못 받는다. 최악이다.
//   ② 원장에 **왜 안 갔는지** 남는다(skipped/missing_recipient) — 나중에 되짚을 수 있다.
// `sendPcbMail` 은 후자를 하도록 쓰여 있다. 실제로 그런지, 그리고 **화면이 그 사실을
// 관리자에게 알려 주는지**를 본다.
//
// ⚠ 이 편은 **상설 픽스처(협력2)의 담당자 메일을 잠시 비운다**. 31호가 전역 설정을 다룬
//   방식 그대로 try/finally + 원복 어서션으로 감싼다 — 안 되돌리면 이후 모든 주행의
//   협력사 메일이 사라진다.
//
// 실행: pnpm -F e2e journey:recipient  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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
  requireCustomerCreds,
  signJwt,
  submitGerberRfq,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 38호 — 수신자 없는 알림', () => {
  const rp = createJourneyReport('findings-recipient', '여정 38호 수신자 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner2: PartnerFixture;
  let A = '';
  /**
   * 견적을 셋으로 나눈다 — 같은 협력사에 **같은 견적으로 RFQ 를 다시 보내면 중복이라
   * 아무 일도 일어나지 않는다**(1차 주행에서 R3·R5 가 "발송 0건"으로 실패했다). 단계마다
   * 새 견적을 써야 발송 경로가 실제로 한 번씩 돈다.
   */
  const specIds: (number | null)[] = [null, null, null];
  let startedAt: Date | null = null;
  /** 원복용 — 주행이 비우기 전의 담당자 메일. */
  let savedEmail: string | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const partnerRow = async (): Promise<any> =>
    getPrisma().spPartner.findUnique({ where: { id: BigInt(partner2.id) } });

  const setContactEmail = async (v: string): Promise<void> => {
    await getPrisma().spPartner.update({
      where: { id: BigInt(partner2.id) },
      data: { contactEmail: v },
    });
  };

  /** 이번 주행에 남은 발송 기록(스펙 컨텍스트). */
  const logsForSpec = async (id: number | null): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: { refId: String(id ?? ''), createdAt: { gte: startedAt ?? new Date(0) } },
      orderBy: { id: 'asc' },
    });

  /** 그 견적으로 협력2에 RFQ 를 보낸다(발송 경로를 한 번 태운다). */
  const sendRfq = async (id: number | null): Promise<{ status: number; json: any }> =>
    api(A, 'POST', `/api/admin/pcb-projects/${String(id)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    partner2 = await getPartner('협력2');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    startedAt = new Date(Date.now() - 5_000);
    savedEmail = (await partnerRow())?.contactEmail ?? '';
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    // ⚠ **반드시** 되돌린다 — 안 되돌리면 이후 모든 주행에서 협력사 메일이 사라진다.
    if (savedEmail !== null) {
      await setContactEmail(savedEmail);
      const now = (await partnerRow())?.contactEmail ?? '';
      F(
        'R9',
        now === savedEmail ? 'obs' : 'bug',
        `담당자 메일 원복 — '${String(now)}'(주행 전 '${String(savedEmail)}')`,
      );
    }
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('R1. 준비 — 견적 3건(단계마다 새 RFQ 를 태우기 위해)', async () => {
    for (const i of [0, 1, 2]) {
      specIds[i] = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 38호-${String(i + 1)}] 수신자 축 — 확인 후 정리 예정`,
        prefix: `R01-${String(i + 1)}`,
      });
      ledger.push(`sp_order_spec #${String(specIds[i])}`);
    }
    expect(savedEmail, '기준선: 협력2에 담당자 메일이 있다').not.toBe('');
  }, 900_000);

  test('R2. 주소가 있을 때 — 보내지고 원장에 sent 로 남는다', async (ctx) => {
    const specId = specIds[0];
    if (specId === null || specId === undefined) return ctx.skip();
    const send = await sendRfq(specId);
    expect(send.status, `RFQ 발송: ${JSON.stringify(send.json)}`).toBe(200);
    ledger.push(`sp_pcb_rfq (spec ${String(specId)})`);

    await new Promise((r) => setTimeout(r, 2_500));
    const logs = await logsForSpec(specId);
    const sent = logs.filter((l: any) => String(l.status) === 'sent');
    // 이 성공이 있어야 아래 skipped 가 "주소가 없어서"임이 증명된다(양성 대조).
    expect(sent.length, '주소가 있으면 실제로 나간다').toBeGreaterThan(0);
    F(
      'R2',
      'obs',
      `양성 대조 — RFQ 발송 후 sent ${String(sent.length)}건(수신 ${String(sent[0]?.recipient)})`,
    );
  }, 300_000);

  test('R3. 주소를 비우면 — 조용히 사라지지 않고 이유가 남는다', async (ctx) => {
    const specId = specIds[1];
    if (specId === null || specId === undefined) return ctx.skip();
    await setContactEmail('');
    expect((await partnerRow())?.contactEmail, '메일 비움').toBe('');

    // **두 번째 견적**으로 보낸다 — 같은 견적 재발송은 중복이라 시도조차 없다.
    const again = await sendRfq(specId);
    // 발송 실패가 API 를 무너뜨리면 안 된다 — 메일은 부수효과다.
    expect(again.status, `주소 없이 RFQ: ${JSON.stringify(again.json)}`).toBeLessThan(500);

    await new Promise((r) => setTimeout(r, 2_500));
    const added = await logsForSpec(specId);
    const skipped = added.filter((l: any) => String(l.status) === 'skipped');
    const sent = added.filter((l: any) => String(l.status) === 'sent');

    // ① 조용히 사라지지 않는다 ② 왜 안 갔는지가 남는다 ③ 실제로 나가지 않았다
    expect(added.length, '시도 자체는 기록된다').toBeGreaterThan(0);
    expect(sent.length, '주소가 없으면 나가지 않는다').toBe(0);
    expect(skipped.length, 'skipped 로 남는다').toBeGreaterThan(0);
    expect(String(skipped[0]?.reason), '사유가 명시된다').toContain('recipient');
    F(
      'R3',
      'obs',
      `수신자 없음 실측 — 신규 기록 ${String(added.length)}건 중 sent 0 · skipped ` +
        `${String(skipped.length)}(사유 '${String(skipped[0]?.reason)}') · API ${String(again.status)}` +
        `(메일 실패가 요청을 무너뜨리지 않는다)`,
    );
  }, 300_000);

  test('R4. 관리자가 그 사실을 볼 수 있는가 — 발송 이력 화면', async (ctx) => {
    const specId = specIds[1];
    if (specId === null || specId === undefined) return ctx.skip();
    await rp.view(adminView, '/app/admin/mail-logs', 'R04-mail-logs');
    const box = adminView.page.getByPlaceholder(/검색|수신|제목/).first();
    if ((await box.count()) > 0) {
      await box.fill(String(specId));
      await adminView.page.keyboard.press('Enter');
      await adminView.page.waitForTimeout(1_500);
    }
    const text = await adminView.page.evaluate(() => document.body.innerText).catch(() => '');
    await rp.shot(adminView, 'R04-mail-logs');
    // '건너뜀'·'skipped' 같은 표시가 있어야 관리자가 "안 갔다"를 알아본다.
    const speaks = ['건너', 'skip', '실패', '미발송'].filter((w) => text.includes(w));
    F(
      'R4',
      speaks.length === 0 ? 'bug' : 'obs',
      speaks.length === 0
        ? `**발송 이력 화면이 '안 감'을 말하지 않는다** — 원장에는 skipped 로 남는데 화면에서 ` +
          `구별되지 않으면 관리자는 보냈다고 믿는다.`
        : `발송 이력 화면 실측 — 상태 표시 ${speaks.join('/')} 로 미발송이 드러난다`,
    );
  }, 300_000);

  test('R5. 주소를 되돌리면 다시 나간다', async (ctx) => {
    const specId = specIds[2];
    if (specId === null || specId === undefined || savedEmail === null) return ctx.skip();
    await setContactEmail(savedEmail);
    const again = await sendRfq(specId);
    expect(again.status, `원복 후 RFQ: ${JSON.stringify(again.json)}`).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 2_500));
    const added = await logsForSpec(specId);
    const sent = added.filter((l: any) => String(l.status) === 'sent');
    expect(sent.length, '주소가 돌아오면 다시 나간다').toBeGreaterThan(0);
    F('R5', 'obs', `원복 실측 — 신규 ${String(added.length)}건 중 sent ${String(sent.length)}`);
  }, 300_000);
});
