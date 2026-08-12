// 여정 30호 — **송금 다회·증빙**(나눠 보낼수록 잔액이 정확해야 한다).
//
// 8호가 부분 송금 2회와 환차를 봤다. 실무는 더 잘게 나뉜다 — 계약금·중도금·잔금처럼 세 번,
// 네 번이 흔하고 각 회차에 이체 확인증이 붙는다. 그때 **잔액이 한 번이라도 틀리면** 과지급이나
// 미지급이 생기고, 원장이 정본이므로 화면·큐·포털이 모두 같이 틀린다.
//
// 표적:
//   ① **다회 송금의 누적** — 3회로 나눠도 합계·잔액이 정확하다.
//   ② **완납 판정** — 잔액 0 이 되면 그 발주가 지급 대기 큐에서 빠진다.
//   ③ **증빙이 회차마다 붙는다** — 어느 송금의 증빙인지 섞이지 않는다.
//   ④ **수정·삭제가 합계에 반영된다** — 원장은 정정되는 기록이다(잘못 적은 회차를 고치면
//      잔액이 즉시 따라와야 한다).
//   ⑤ **과지급은 막거나 드러난다** — 남은 잔액보다 많이 보내려 할 때.
//   ⑥ **환율 자동/가드** — 오늘은 TTS 자동 박제, 과거일 누락은 400 으로 회계 공백을 막는다.
//   ⑦ **송금 예정일** — NET 7은 발주일+7일 서버 계산, CUSTOM은 명시 날짜 필수.
//
// 시드 발주(협력2·USD)로 돈 축만 본다 — 주문·생산은 8호가 이미 밟았다.
//
// 실행: pnpm -F e2e journey:remitmulti  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createJourneyReport,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  pickFreeSpecs,
  signJwt,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const PARTNER_NAME = '협력2';
/** 발주가는 $300 — 100/100/100 세 번으로 나눠 보낸다. */
const PRICE = 300;
const RATE = 1400;
const PAYMENT_TERM_NET_7 = 'NET 7 DAYS';
const PAYMENT_TERM_CUSTOM_DATE = 'CUSTOM PAYMENT DATE';

describe.skipIf(!RUN || !JOURNEY)('여정 30호 — 송금 다회·증빙', () => {
  const rp = createJourneyReport('findings-remitmulti', '여정 30호 송금 다회 탐색 주행 리포트');
  const { F, ledger } = rp;

  let partner: PartnerFixture;
  let A = '';
  const poIds: bigint[] = [];
  let specId: bigint | null = null;
  let poId: number | null = null;
  const remitIds: number[] = [];

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** 이 발주의 송금 내역 + 요약(잔액이 정본인 자리). */
  const ledgerOf = async (): Promise<{ items: any[]; summary: any }> => {
    const res = await api(A, 'GET', `/api/admin/pcb-remittances/${String(poId)}`);
    expect(res.status, `송금 내역: ${JSON.stringify(res.json)}`).toBe(200);
    const d = res.json?.data ?? {};
    return { items: d.remittances ?? [], summary: d.summary ?? {} };
  };

  // ⚠ 계약(PcbRemittanceCreateBody)은 `remittedOn` 을 받고 **통화는 받지 않는다**(발주 통화를
  //   따른다 — 원장이 발주에 매달린 기록이라 통화가 갈릴 여지를 두지 않는다).
  const pay = async (amount: number, memo: string): Promise<{ status: number; json: any }> =>
    api(A, 'POST', `/api/admin/pcb-remittances/${String(poId)}`, {
      remittedOn: '2026-08-11',
      amount,
      exchangeRate: RATE,
      memo,
    });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await getPartner(PARTNER_NAME);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    const residue = await countPcbResidue(poIds);
    F('P6', 'obs', `정리 — 발주 ${String(poIds.length)}건 삭제 · 잔재 pos=${String(residue.pos)}`);
    rp.write({});
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('P1. 준비 — $300 발주(지급 대기)', async () => {
    const specs = await pickFreeSpecs(1);
    const pickedSpecId = specs[0].id;
    specId = pickedSpecId;
    const po = await createPcbPo({
      specId: pickedSpecId,
      partnerId: partner.id,
      status: 'produced',
      currency: 'USD',
      priceOriginal: PRICE,
    });
    poId = Number(po.id);
    poIds.push(po.id);
    ledger.push(`sp_pcb_po #${String(poId)} ($${String(PRICE)} — 송금 다회 대상)`);

    const { summary } = await ledgerOf();
    expect(Number(summary.paidAmount ?? 0), '초기 지급액 0').toBe(0);
    expect(Number(summary.balance ?? -1), '초기 잔액 = 발주가').toBe(PRICE);
    F('P1', 'obs', `준비 — po #${String(poId)} $${String(PRICE)} · 지급 0 · 잔액 ${String(PRICE)}`);
  }, 180_000);

  test('P1a. 결제조건 — NET 7 자동 예정일·CUSTOM 날짜 필수', async (ctx) => {
    if (poId === null || specId === null) return ctx.skip();
    const path = `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

    const missing = await api(A, 'PATCH', path, {
      paymentTerms: PAYMENT_TERM_CUSTOM_DATE,
      remittanceDueOn: null,
    });
    expect(missing.status, `CUSTOM 날짜 누락: ${JSON.stringify(missing.json)}`).toBe(400);
    expect(missing.json?.error, 'CUSTOM 날짜 필수 오류').toBe('REMITTANCE_DUE_REQUIRED');

    const net7 = await api(A, 'PATCH', path, {
      paymentTerms: PAYMENT_TERM_NET_7,
      // 서버 계산이 정본 — 클라이언트가 보낸 날짜는 이 값으로 박제되면 안 된다.
      remittanceDueOn: '2099-01-01',
    });
    expect(net7.status, `NET 7 조건 저장: ${JSON.stringify(net7.json)}`).toBe(200);
    const net7Row = (net7.json?.data?.pos ?? []).find((p: any) => Number(p.poId) === poId);
    const issuedKstPlus7 = new Date(
      Date.parse(String(net7Row.issuedAt)) + 7 * 86_400_000 + 9 * 3_600_000,
    )
      .toISOString()
      .slice(0, 10);
    const dueKst = new Date(Date.parse(String(net7Row.remittanceDueOn)) + 9 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    expect(net7Row.paymentTerms, 'NET 7 조건 박제').toBe(PAYMENT_TERM_NET_7);
    expect(dueKst, '발주 KST 날짜+7일 서버 계산').toBe(issuedKstPlus7);

    const customOn = '2026-08-28';
    const custom = await api(A, 'PATCH', path, {
      paymentTerms: PAYMENT_TERM_CUSTOM_DATE,
      remittanceDueOn: customOn,
    });
    expect(custom.status, `CUSTOM 예정일 저장: ${JSON.stringify(custom.json)}`).toBe(200);
    const customRow = (custom.json?.data?.pos ?? []).find((p: any) => Number(p.poId) === poId);
    const customKst = new Date(Date.parse(String(customRow.remittanceDueOn)) + 9 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    expect(customKst, 'CUSTOM KST 날짜 왕복').toBe(customOn);

    const restored = await api(A, 'PATCH', path, { paymentTerms: PAYMENT_TERM_NET_7 });
    expect(restored.status, `NET 7 복원: ${JSON.stringify(restored.json)}`).toBe(200);
    const pending = await api(A, 'GET', '/api/admin/pcb-remittances?tab=pending&page=1&pageSize=100');
    const queueRow = (pending.json?.data?.items ?? []).find((p: any) => Number(p.poId) === poId);
    expect(queueRow?.remittanceDueOn, '송금 대기 큐에도 예정일 노출').toBeTruthy();

    const dbPo = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    expect(dbPo?.remittedAt, '예정일 저장이 실제 송금 완료를 만들지 않는다').toBeNull();
    F(
      'P1a',
      'obs',
      `결제 일정 — CUSTOM 누락 400 · NET 7 ${issuedKstPlus7} 서버 계산 · CUSTOM ${customOn} 왕복 · 실제 송금 0건`,
    );
  }, 180_000);

  test('P1b. 외화 환율 — 오늘은 TTS 자동 박제, 과거일 누락은 거부', async (ctx) => {
    if (poId === null) return ctx.skip();

    const past = await api(A, 'POST', `/api/admin/pcb-remittances/${String(poId)}`, {
      remittedOn: '2026-08-11',
      amount: 1,
      memo: '[여정 30호] 과거일 환율 누락 가드',
    });
    expect(past.status, `과거일 환율 누락: ${JSON.stringify(past.json)}`).toBe(400);
    expect(past.json?.error, '과거일은 명시 환율 요구').toBe('EXCHANGE_RATE_REQUIRED');

    const rateRes = await api(A, 'GET', '/api/admin/pcb-exchange-rate?from=USD');
    expect(rateRes.status, `당일 환율 조회: ${JSON.stringify(rateRes.json)}`).toBe(200);
    const dailyRate = Number(rateRes.json?.data?.rate);
    expect(Number.isFinite(dailyRate) && dailyRate > 0, 'USD→KRW TTS 캐시').toBe(true);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const auto = await api(A, 'POST', `/api/admin/pcb-remittances/${String(poId)}`, {
      remittedOn: today,
      amount: 1,
      memo: '[여정 30호] 당일 자동 환율',
    });
    expect(auto.status, `당일 자동 환율 송금: ${JSON.stringify(auto.json)}`).toBe(200);
    const row = (auto.json?.data?.remittances ?? []).at(-1);
    expect(row.exchangeRate, '생략 환율은 TTS 박제').toBe(dailyRate);
    expect(row.krwAmount, '자동 환율 KRW 환산').toBe(Math.round(dailyRate));

    const removed = await api(
      A,
      'DELETE',
      `/api/admin/pcb-remittances/${String(poId)}/${String(row.id)}`,
    );
    expect(removed.status, `자동 환율 프로브 정리: ${JSON.stringify(removed.json)}`).toBe(200);
    expect(removed.json?.data?.summary?.paidAmount, '프로브 정리 후 지급액 원복').toBe(0);
    F('P1b', 'obs', `환율 — 과거일 누락 400 · 오늘 생략 TTS @${String(dailyRate)} 자동 박제 · 정리 완료`);
  }, 180_000);

  test('P2. 세 번에 나눠 보내도 합계·잔액이 정확하다', async (ctx) => {
    if (poId === null) return ctx.skip();

    const steps = [100, 100, 100];
    let expectedPaid = 0;
    for (const [i, amount] of steps.entries()) {
      const res = await pay(amount, `[여정 30호] ${String(i + 1)}회차`);
      expect(res.status, `${String(i + 1)}회차 송금: ${JSON.stringify(res.json)}`).toBe(200);
      expectedPaid += amount;

      const { items, summary } = await ledgerOf();
      expect(items.length, `${String(i + 1)}회차 후 원장 건수`).toBe(i + 1);
      expect(Number(summary.paidAmount ?? -1), `${String(i + 1)}회차 후 누적 지급액`).toBe(
        expectedPaid,
      );
      expect(Number(summary.balance ?? -1), `${String(i + 1)}회차 후 잔액`).toBe(PRICE - expectedPaid);
    }

    const { items } = await ledgerOf();
    for (const it of items) remitIds.push(Number(it.id ?? it.remittanceId));
    F(
      'P2',
      'obs',
      `다회 송금 실측 — ${steps.join('+')}=$${String(expectedPaid)} · 잔액 0 · 원장 ` +
        `${String(items.length)}건(회차가 뭉치지 않는다)`,
    );
  }, 300_000);

  test('P3. 완납이면 지급 대기 큐에서 빠진다', async (ctx) => {
    if (poId === null) return ctx.skip();

    const pending = await api(A, 'GET', '/api/admin/pcb-remittances?tab=pending&page=1&pageSize=100');
    expect(pending.status, JSON.stringify(pending.json)).toBe(200);
    const inPending = (pending.json?.data?.items ?? []).some((i: any) => Number(i.poId) === poId);
    // 잔액 0 인데 대기 큐에 남으면 관리자가 또 보낸다 — 과지급의 시작이다.
    expect(inPending, '완납 건은 지급 대기에 없다').toBe(false);

    const done = await api(A, 'GET', '/api/admin/pcb-remittances?tab=done&page=1&pageSize=100');
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    const inDone = (done.json?.data?.items ?? []).some((i: any) => Number(i.poId) === poId);
    F(
      'P3',
      'obs',
      `완납 판정 실측 — pending 제외 ✓ · done 포함=${String(inDone)}(잔액 0 이 큐를 가른다)`,
    );
  }, 300_000);

  test('P4. 증빙이 회차마다 붙는다', async (ctx) => {
    if (poId === null || remitIds.length < 2) return ctx.skip();
    const prisma = getPrisma();

    // 서로 다른 두 회차에 각각 증빙을 붙인다 — 섞이면 "어느 송금의 확인증인가"를 못 가린다.
    for (const [i, remitId] of remitIds.slice(0, 2).entries()) {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
      const form = new FormData();
      form.set('file', new File([bytes], `receipt-${String(i + 1)}.pdf`, { type: 'application/pdf' }));
      const up = await fetch(
        `${API_URL}/api/admin/pcb-remittances/${String(poId)}/${String(remitId)}/files`,
        { method: 'POST', headers: { authorization: `Bearer ${A}` }, body: form },
      );
      expect(up.status, `${String(i + 1)}회차 증빙 업로드`).toBe(200);
    }

    // 증빙은 송금 행에 매달린다 — 회차별로 1건씩이어야 한다.
    for (const [i, remitId] of remitIds.slice(0, 2).entries()) {
      const count = await prisma.spFile.count({
        where: { refType: 'sp_pcb_remittance', refId: BigInt(remitId) },
      });
      expect(count, `${String(i + 1)}회차 증빙 1건`).toBe(1);
    }
    // 증빙 없는 회차는 그대로 0 — 한 곳에 몰리지 않았다는 증거다.
    if (remitIds.length >= 3) {
      const third = await prisma.spFile.count({
        where: { refType: 'sp_pcb_remittance', refId: BigInt(remitIds[2] ?? 0) },
      });
      expect(third, '3회차는 증빙 없음').toBe(0);
    }
    F('P4', 'obs', `증빙 분리 실측 — 1·2회차 각 1건 · 3회차 0건(회차별로 매달린다)`);
  }, 300_000);

  test('P5. 정정이 합계에 즉시 반영된다', async (ctx) => {
    if (poId === null || remitIds.length === 0) return ctx.skip();

    // 원장은 **정정되는 기록**이다 — 잘못 적은 회차를 고치면 잔액이 따라와야 한다.
    const target = remitIds[remitIds.length - 1] ?? 0;
    const patch = await api(
      A,
      'PATCH',
      `/api/admin/pcb-remittances/${String(poId)}/${String(target)}`,
      { amount: 50, exchangeRate: RATE, remittedOn: '2026-08-11', memo: '[여정 30호] 정정' },
    );
    expect(patch.status, `정정: ${JSON.stringify(patch.json)}`).toBe(200);

    const { summary } = await ledgerOf();
    // 100 → 50 으로 줄였으니 지급 250, 잔액 50 이어야 한다.
    expect(Number(summary.paidAmount ?? -1), '정정 후 누적 지급액').toBe(250);
    expect(Number(summary.balance ?? -1), '정정 후 잔액').toBe(50);

    // 삭제도 마찬가지 — 지운 회차만큼 잔액이 돌아온다.
    const del = await api(A, 'DELETE', `/api/admin/pcb-remittances/${String(poId)}/${String(target)}`);
    expect(del.status, `삭제: ${JSON.stringify(del.json)}`).toBe(200);
    const after = await ledgerOf();
    expect(Number(after.summary.paidAmount ?? -1), '삭제 후 누적 지급액').toBe(200);
    expect(Number(after.summary.balance ?? -1), '삭제 후 잔액').toBe(100);
    F(
      'P5',
      'obs',
      `정정·삭제 실측 — 100→50 정정 시 지급 250/잔액 50 · 삭제 후 지급 200/잔액 100 ` +
        `(원장이 정본이라 합계가 즉시 따라온다)`,
    );
  }, 300_000);
});
