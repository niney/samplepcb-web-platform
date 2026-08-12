// 여정 20호 — **환율·통화 축**(어느 시점 값이 어디에 박히는가).
//
// 8호가 다룬 것은 **지급 환율**(송금 시점, 원장)이었다. 이 편은 그 앞이다 — **배정·회신·발주**
// 각 시점에 환율이 어떻게 정해지고 **박제**되는가. 통화가 섞인 트랙에서 값이 나중에 흔들리면
// 원가 회계가 통째로 틀어지므로, "언제 값이 굳는가"가 곧 신뢰의 근거다.
//
// 표적:
//   ① **KRW 는 환율이 없다**(null) — 있는 척하면 1.0 을 곱하는 코드가 생기고 그게 버그의 씨앗이다.
//   ② **선정 시 환율은 당일 자동**(P4.7) — 명시하면 그 값이 이기고, 생략하면 캐시가 채운다.
//   ③ **회신 없는 수동 발주는 환율이 필수**(EXCHANGE_RATE_REQUIRED) — 근거 없이 원가를 KRW 로
//      환산하면 그 숫자의 출처가 사라진다.
//   ④ **발주된 뒤에는 박제** — 조직 기본통화를 바꿔도 **기존 발주의 통화·환율·KRW 는 불변**.
//      배정 시점 박제(P1 결정)가 발주까지 이어지는지를 실제로 흔들어 본다.
//
// 실행: pnpm -F e2e journey:currency  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요, 시드 발주)
// 스크린샷 접두사는 **X** 가 아니라 **U** 전용(X 는 11호가 쓴다).
// 발주 UI의 선정 필수 UX는 pcb-po-selection-guide 에서 외부 거버 없이 별도 회귀한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'node:path';
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
const USD_ORG = '협력2'; // CN·USD
const KRW_ORG = 'e2e한국협력'; // KR·KRW(계정 없음 — 관리자 대행)
const FIXTURE_ZIP = join(monoRoot, 'e2e', 'fixtures', 'arduino-uno.zip');

describe.skipIf(!RUN || !JOURNEY)('여정 20호 — 환율·통화 축', () => {
  const rp = createJourneyReport('findings-currency', '여정 20호 환율·통화 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let usdOrg: PartnerFixture;
  let krwOrg: PartnerFixture;
  let A = '';

  const poIds: bigint[] = [];
  let specUsd: number | null = null;
  let specKrw: number | null = null;
  let odId: string | null = null;
  let rfqUsd: number | null = null;
  let rfqKrw: number | null = null;
  let stampedRate: number | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const rfqRow = async (id: number): Promise<any> =>
    getPrisma().spPcbRfq.findUnique({ where: { id: BigInt(id) } });
  const poRow = async (id: number): Promise<any> =>
    getPrisma().spPcbPo.findUnique({ where: { id: BigInt(id) } });

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    usdOrg = await getPartner(USD_ORG);
    krwOrg = await getPartner(KRW_ORG);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    const prisma = getPrisma();
    for (const id of [rfqUsd, rfqKrw]) {
      if (id !== null) await prisma.spPcbRfq.deleteMany({ where: { id: BigInt(id) } });
    }
    const residue = await countPcbResidue(poIds);
    F('U6', 'obs', `정리 — 발주 ${String(poIds.length)}건·RFQ 2건 삭제 · 잔재 pos=${String(residue.pos)}`);
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  test('U1. 준비 + KRW 조직은 환율이 없다 — 있는 척하면 안 된다', async () => {
    // ⚠ 발주는 **결제된 주문**이 있어야 선다(NOT_ORDERED·NOT_PAID 게이트) — 시드 스펙으로는
    //   RFQ 까지만 된다. 그래서 거버 제출로 주문 하나를 만들고, **그 한 스펙에 두 조직**
    //   (KRW·USD)을 배정해 양쪽 축을 한 번에 본다(거버 두 번은 주행만 길어진다).
    specUsd = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 20호] 환율 축 검증 — 확인 후 정리 예정',
      prefix: 'U01',
    });
    specKrw = specUsd; // 같은 스펙에 두 조직 RFQ(조직마다 통화가 갈린다)
    ledger.push(`sp_order_spec #${String(specUsd)} (거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specKrw)}/rfqs`, {
      partnerIds: [num(krwOrg.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqKrw = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(krwOrg.id))?.rfqId;
    expect(rfqKrw, 'KRW RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqKrw)} (KRW 조직)`);

    const row = await rfqRow(rfqKrw ?? 0);
    expect(String(row?.currency), '배정 통화(KR 조직)').toBe('KRW');
    // 회신 전이라 환율은 애초에 없다 — 회신·선정 뒤에도 KRW 는 null 이어야 한다.
    const reply = await api(
      A,
      'PUT',
      `/api/admin/pcb-projects/${String(specKrw)}/rfqs/${String(rfqKrw)}/reply`,
      { price: 50_000, quotedDeliveryDate: '2026-10-01' },
    );
    expect(reply.status, `KRW 회신: ${JSON.stringify(reply.json)}`).toBe(200);
    const replied = await rfqRow(rfqKrw ?? 0);
    expect(replied?.exchangeRate, 'KRW 회신 — 환율 null').toBeNull();
    expect(Number(replied?.krwAmount ?? 0), 'KRW 는 회신가가 곧 원가').toBe(50_000);
    F('U1', 'obs', `KRW 축 — 통화 KRW · exchangeRate null · krwAmount=회신가(₩50,000)`);
  }, 240_000);

  test('U2. USD 선정 — 환율은 당일 자동, 명시하면 그 값이 이긴다', async (ctx) => {
    if (specUsd === null) return ctx.skip();

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specUsd)}/rfqs`, {
      partnerIds: [num(usdOrg.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqUsd = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(usdOrg.id))?.rfqId;
    expect(rfqUsd, 'USD RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqUsd)} (USD 조직)`);
    expect(String((await rfqRow(rfqUsd ?? 0))?.currency), '배정 통화(CN 조직)').toBe('USD');

    // 화면이 프리필에 쓰는 조회 — 당일 고시가 있어야 자동 경로가 성립한다.
    const rate = await api(A, 'GET', '/api/admin/pcb-exchange-rate?from=USD');
    expect(rate.status, `환율 조회: ${JSON.stringify(rate.json)}`).toBe(200);
    const today = Number(rate.json?.data?.rate ?? 0);
    expect(today, '당일 USD 고시').toBeGreaterThan(0);

    // ① 회신 — **환율을 받지 않는다**(계약 `PcbRfqReplyBody` 에 그 키가 없다). 협력사는
    //    자기 통화의 금액만 말하고, KRW 환산은 **선정 시점**에 정해진다(P4.7). 회신 단계에
    //    환율을 박으면 "언제 정한 값인가"가 흐려진다 — 회신은 며칠 전일 수 있다.
    const reply = await api(
      A,
      'PUT',
      `/api/admin/pcb-projects/${String(specUsd)}/rfqs/${String(rfqUsd)}/reply`,
      { price: 100, quotedDeliveryDate: '2026-10-05' },
    );
    expect(reply.status, `USD 회신: ${JSON.stringify(reply.json)}`).toBe(200);
    const replied = await rfqRow(rfqUsd ?? 0);
    expect(replied?.exchangeRate, '회신 단계에는 환율이 없다(선정에서 정한다)').toBeNull();
    expect(Number(replied?.priceOriginal ?? 0), '회신가는 외화 그대로').toBe(100);

    // ② 선정 — **명시하면 그 값이 박힌다**(관리자가 계약 환율을 쓰는 경로).
    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specUsd)}/rfqs/${String(rfqUsd)}/select`,
      { exchangeRate: 1400 },
    );
    expect(sel.status, `선정(환율 명시): ${JSON.stringify(sel.json)}`).toBe(200);
    const selected = await rfqRow(rfqUsd ?? 0);
    expect(String(selected?.status), '선정 상태').toBe('selected');
    stampedRate = Number(selected?.exchangeRate ?? 0);
    expect(stampedRate, '명시 환율이 박힌다').toBe(1400);
    expect(Number(selected?.krwAmount ?? 0), '원가 = 회신가 × 명시 환율').toBe(140_000);
    F(
      'U2',
      'obs',
      `USD 축 — 당일 고시 ${String(today)} 조회 가능 · **회신엔 환율 없음**(계약에 키가 없다) · ` +
        `선정에서 명시 @1400 박제 → 원가 ₩140,000`,
    );
  }, 300_000);

  test('U3. 주문·입금 뒤 — 회신 없는 수동 발주는 환율이 필수다', async (ctx) => {
    if (specUsd === null) return ctx.skip();

    // 발주 게이트를 통과시키려면 주문·입금이 먼저다(그게 이 트랙의 규칙이다).
    const order = await placeOrderFromQuotes(customer, rp, {
      specId: specUsd,
      step: 'U3',
      prefix: 'U03',
      buyerName: 'e2e환율검증고객',
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

    // USD 조직에 **회신 근거 없이**(rfqId 미지정) 발주하면 KRW 환산 근거가 없다 —
    // 숫자의 출처가 사라진다.
    const noRate = await api(A, 'POST', `/api/admin/pcb-projects/${String(specUsd)}/pos`, {
      partnerId: num(usdOrg.id),
      priceOriginal: 200,
    });
    expect(noRate.status, `환율 없는 수동 발주: ${JSON.stringify(noRate.json)}`).toBe(400);
    expect(noRate.json?.error, '거절 코드').toBe('EXCHANGE_RATE_REQUIRED');

    // 환율을 주면 통과하고 그 값이 박힌다.
    const withRate = await api(A, 'POST', `/api/admin/pcb-projects/${String(specKrw)}/pos`, {
      partnerId: num(usdOrg.id),
      priceOriginal: 200,
      exchangeRate: 1350,
    });
    expect(withRate.status, `환율 명시 발주: ${JSON.stringify(withRate.json)}`).toBe(200);
    const created = (withRate.json?.data?.pos ?? []).find(
      (p: any) => p.partnerId === num(usdOrg.id),
    );
    expect(created, '수동 발주 행').toBeTruthy();
    poIds.push(BigInt(created.poId));
    ledger.push(`sp_pcb_po #${String(created.poId)} (수동 발주 @1350)`);
    const row = await poRow(Number(created.poId));
    expect(Number(row?.exchangeRate ?? 0), '발주 환율 박제').toBe(1350);
    expect(Number(row?.krwAmount ?? 0), '발주 원가 = 200 × 1350').toBe(270_000);
    F(
      'U3',
      'obs',
      `수동 발주 축 — 환율 없으면 409 EXCHANGE_RATE_REQUIRED · 명시하면 @1350 박제(₩270,000)`,
    );
  }, 300_000);

  test('U4. 발주된 뒤에는 박제 — 조직 통화를 바꿔도 흔들리지 않는다', async (ctx) => {
    if (poIds.length === 0) return ctx.skip();
    const prisma = getPrisma();
    const target = Number(poIds[0] ?? 0n);

    const before = await poRow(target);
    const beforeSnapshot = {
      currency: String(before?.currency),
      rate: Number(before?.exchangeRate ?? 0),
      krw: Number(before?.krwAmount ?? 0),
    };

    // 조직 기본통화를 흔든다(USD → CNY). 배정 시점 박제(P1)가 발주까지 이어진다면 기존
    // 발주는 미동이어야 한다 — 흔들리면 지난 원가가 오늘 환율로 다시 계산되는 셈이다.
    const orgBefore = await prisma.spPartner.findUnique({ where: { id: usdOrg.id } });
    const patched = await api(A, 'PUT', `/api/admin/partners/${String(usdOrg.id)}`, {
      defaultCurrency: 'CNY',
    });
    expect(patched.status, `조직 통화 변경: ${JSON.stringify(patched.json)}`).toBe(200);

    const after = await poRow(target);
    expect(String(after?.currency), '발주 통화 불변').toBe(beforeSnapshot.currency);
    expect(Number(after?.exchangeRate ?? 0), '발주 환율 불변').toBe(beforeSnapshot.rate);
    expect(Number(after?.krwAmount ?? 0), '발주 원가 불변').toBe(beforeSnapshot.krw);

    // 원상복구 — 협력2 는 다른 여정이 USD 로 쓰는 상설 픽스처다(오염 금지).
    const restore = await api(A, 'PUT', `/api/admin/partners/${String(usdOrg.id)}`, {
      defaultCurrency: String(orgBefore?.defaultCurrency ?? 'USD'),
    });
    expect(restore.status, '조직 통화 원복').toBe(200);
    const restored = await prisma.spPartner.findUnique({ where: { id: usdOrg.id } });
    expect(String(restored?.defaultCurrency), '상설 픽스처 원복 확인').toBe(
      String(orgBefore?.defaultCurrency ?? 'USD'),
    );
    F(
      'U4',
      'obs',
      `박제 실측 — 조직 기본통화 ${String(orgBefore?.defaultCurrency)}→CNY 로 흔들어도 기존 발주는 ` +
        `${beforeSnapshot.currency} @${String(beforeSnapshot.rate)} ₩${String(beforeSnapshot.krw)} 그대로 · 원복 완료`,
    );
  }, 300_000);

  test('U5. 화면 — 어느 시점 환율인지 읽히는가', async (ctx) => {
    if (specKrw === null) return ctx.skip();

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specKrw)}`, 'U05-case-currency');
    const text = (await adminView.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    expect(text.length, 'Case 화면 렌더').toBeGreaterThan(200);
    // 발주 원가가 KRW 로 환산돼 보여야 한다(외화 발주의 회계 면).
    expect(text.includes('270,000') || text.includes('₩270,000'), '환산 원가 표기').toBe(true);
    F('U5', 'obs', `화면 관찰 — 외화 발주의 KRW 환산 원가(₩270,000) 노출 확인`);
  }, 240_000);
});
