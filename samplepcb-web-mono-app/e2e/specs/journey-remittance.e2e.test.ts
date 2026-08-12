// 8호 완주 여정 — **돈 축(송금 원장) 완주**. 다른 여정이 물건(거버→생산→선적→배송)을
// 끝까지 따라갔다면, 이 여정은 **발주 뒤에 나가는 돈**을 끝까지 따라간다: 부분 송금 →
// 증빙 → 잔금 → 잔액 0 → 협력사별 집계·포털 수금 대조 → 무상 A/S 제외 → 가드 순환.
//
// 협력2(CN·USD)를 쓰는 이유가 이 여정의 전부다 — **외화라야 환율이 의미를 갖는다**.
// 원장의 통화는 발주 통화로 고정이고(클라이언트가 못 정한다) KRW 환산만 송금 건마다
// 실적용 환율로 따로 박제된다. 그래서 **원장 KRW 합계 ≠ 발주 KRW 회계**가 정상이며,
// 그 차이가 곧 환차손익이다. 이 여정은 그 부등식을 수치로 못 박는다(발주 회계 1,380 /
// 1차 송금 1,340 / 잔금 1,410 — 셋이 다 다른 것이 실무다).
//
// 7호(A/S 심화)와 겹치지 않는다: 7호 T3d 는 **무상/유상 회차가 큐에 서는지**를 API 로
// 대조했을 뿐, 송금을 한 푼도 기록하지 않았다(잔액은 늘 발주가 전액). 8호는 실제로
// 돈을 두 번 보내고 증빙을 붙이고 잔액을 0 으로 만든 뒤, 그 상태에서 무상 A/S 회차가
// **관리자 집계와 협력사 포털 양쪽에서** 제외되는지를 스냅샷 델타로 본다(7호는 포털을
// 안 봤다). 가드도 rework-probe W4(잠김→원장 정리까지)에서 한 칸 더 간다 — **정리 후
// 취소 200 까지**, 그리고 증빙 파일이 원장과 함께 사라지는 것까지.
//
// 완주 구간은 발주까지다(EQ~생산~선적 없음) — 돈은 발주에서 시작하고, M7 가드가 요구하는
// 상태(issued·하위 없음·발송 없음)를 그대로 유지해야 취소 가드의 잠김/열림이 성립한다.
//
// ⚠ 테스트 순서: M8(화면 실측)을 M7(가드 순환) **앞**에 둔다. 가드 순환의 종착이
//   원장 삭제 + 발주 취소라, 뒤에 찍으면 텅 빈 화면을 찍게 된다(번호는 시나리오 정의를
//   따르고 실행 순서만 뒤집는다 — 파일 순서가 곧 실행 순서다).
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:money  (PORTAL_E2E=1 + JOURNEY=1)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(GERBER_URL)·Mailpit + e2e/.env.e2e 고객 자격.
// **생성물은 정리하지 않는다** — 대장(ledger) 기록 후 output/cleanup-probe.mts(고객 축
// 훑기 — 상설 픽스처 무접촉). 증빙 파일은 M7 이 원장과 함께 지운다(잔재 0 확인 포함).
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
  measurePoRowPartnerWidths,
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

// ── 돈의 숫자들(전부 이 블록에서만 나온다 — 어서션이 상수를 읽는다) ──────────
const PO_USD = 300; // 발주가(USD)
const PO_RATE = 1380; // 발주 회계 환율 → krwAmount 414,000
const SELECT_RATE = 1400; // 선정 시점 박제(RFQ) — 발주 명시 환율이 이를 이겨야 한다
const FINAL_PRICE_KRW = 520_000; // 고객 판매 확정가(원가 414,000 위)
const R1 = { on: '2026-08-08', amount: 150, rate: 1340 }; // 1차 부분 송금 → 201,000
const R2 = { on: '2026-08-11', amount: 150, rate: 1410 }; // 잔금 → 211,500
const PO_KRW = PO_USD * PO_RATE; // 414,000
const LEDGER_KRW = R1.amount * R1.rate + R2.amount * R2.rate; // 412,500
const FX_DIFF = LEDGER_KRW - PO_KRW; // -1,500 (실지급 원화 < 회계 박제 = 환차익)
const PAYMENT_TERMS = '50% PRE-PAID / 50% BEFORE SHIPMENT';
const RECEIPT_NAME = 'receipt-journey8.png';

describe.skipIf(!RUN || !JOURNEY)('여정 8호 — 송금 원장 완주(돈 축·협력2 CN/USD)', () => {
  const rp = createJourneyReport('findings-money', '여정 8호 송금 원장 완주(돈 축) 리포트');
  const { F, ledger, view, shot } = rp;

  let customer: PhpLoginResult; // 실로그인(PHP+거버 — 원주문 구간)
  let adminView: E2eSession; // 관리자 화면 관찰용(스텁)
  let partnerView: E2eSession; // 협력2 화면 관찰용(스텁)
  let partner2: PartnerFixture; // 협력2(CN·USD) — 협력1 은 실데이터라 쓰기 금지
  let A = ''; // 관리자 API 토큰
  let P = ''; // 협력2 API 토큰

  // 여정 상태 — 앞 단계가 만들면 뒷 단계가 쓴다(실패 시 ctx.skip)
  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null; // 원발주(round 0) — 돈이 오가는 그 발주
  let asCaseId: number | null = null; // 무상 A/S 케이스
  let freePoId: number | null = null; // 무상 A/S 회차 발주(round 1)
  let remit1Id: number | null = null;
  let remit2Id: number | null = null;
  let receiptFileId: number | null = null;

  // 협력사별 집계·포털 총계 스냅샷(델타 어서션용 — 공유 DB라 절대값은 못 쓴다)
  let aggAfterIssue: { row: any; usd: any } | null = null;
  let aggAfterPaid: { row: any; usd: any } | null = null;
  let portalUsdAfterPaid: any = null;

  const remitPath = (id?: number | null): string =>
    `/api/admin/pcb-remittances/${String(poId)}${id === undefined || id === null ? '' : `/${String(id)}`}`;

  /** 워크큐(스펙 스코프) — q=specId 라 counts 가 이 스펙의 발주만 센다(서버가 필터 후 집계).
   *  q 는 화면 표기 그대로(Q21195)도 받는다 — 기본은 숫자, 'Q' 접두 경로는 M1c 가 대조한다. */
  const queue = async (
    tab: string,
    q?: string,
  ): Promise<{ items: any[]; counts: any; total: number; byCurrency: any[] }> => {
    const r = await api(
      A,
      'GET',
      `/api/admin/pcb-remittances?tab=${tab}&q=${q ?? String(specId)}&page=1&pageSize=50`,
    );
    expect(r.status, `송금 워크큐(${tab}): ${JSON.stringify(r.json)}`).toBe(200);
    return {
      items: r.json?.data?.items ?? [],
      counts: r.json?.data?.counts ?? {},
      total: r.json?.data?.total ?? 0,
      byCurrency: r.json?.data?.byCurrency ?? [],
    };
  };

  /** 협력2 집계 한 줄(행 + USD 통화칸) — 다른 주행의 발주가 섞이므로 **델타**로만 판단한다. */
  const partnerAgg = async (): Promise<{ row: any; usd: any }> => {
    const r = await api(A, 'GET', '/api/admin/pcb-remittances/partners');
    expect(r.status, `협력사별 집계: ${JSON.stringify(r.json)}`).toBe(200);
    const row = (r.json?.data?.rows ?? []).find((x: any) => x.partnerId === num(partner2.id));
    return { row, usd: row?.byCurrency?.find((c: any) => c.currency === 'USD') ?? null };
  };

  /** 협력사 포털 수금 현황(협력2 토큰). */
  const portal = async (): Promise<{ items: any[]; totals: any[]; unpaidCount: number }> => {
    const r = await api(P, 'GET', '/api/partner/pcb-remittances');
    expect(r.status, `포털 수금: ${JSON.stringify(r.json)}`).toBe(200);
    return {
      items: r.json?.data?.items ?? [],
      totals: r.json?.data?.totals ?? [],
      unpaidCount: r.json?.data?.unpaidCount ?? -1,
    };
  };

  const poRow = async (): Promise<any> => {
    const prisma = getPrisma();
    return prisma.spPcbPo.findUnique({ where: { id: BigInt(poId ?? 0) } });
  };

  // multipart 업로드(증빙) — File 은 Node 20+ 글로벌
  const apiForm = async (
    token: string,
    path: string,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    form.set('file', new File([bytes], fileName, { type: contentType }));
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

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();

    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    expect(partner2.country, '협력2 = 해외(CN) — 외화 전제').toBe('CN');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  // ── M1. 원주문 압축 — 거버→RFQ→회신(USD)→선정·확정가→주문→입금→발주 ──────────
  test('M1a. 고객: 거버 업로드 → 견적요청 제출', async () => {
    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 8호] 송금 원장 완주 — 확인 후 정리 예정',
      prefix: 'M01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '제출 직후 상태').toBe('rfq');
  }, 180_000);

  test('M1b. 관리자: RFQ(협력2) → 협력2 회신(USD) → 선정+확정가', async (ctx) => {
    if (specId === null) return ctx.skip();
    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner2.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner2.id));
    expect(row, 'RFQ 행 생성').toBeTruthy();
    rfqId = row.rfqId;
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → 협력2)`);
    // 링크 통화는 조직 기본(협력2=USD) — 외화 축의 출발점이라 여기서 못 박는다.
    expect(row.currency, '협력2 링크 통화').toBe('USD');

    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: PO_USD,
      quotedDeliveryDate: '2026-08-25',
      memo: '[여정 8호] USD 회신',
    });
    expect(reply.status, JSON.stringify(reply.json)).toBe(200);

    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { exchangeRate: SELECT_RATE, finalPrice: FINAL_PRICE_KRW },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
    const prisma = getPrisma();
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    expect(spec?.quoteStatus, '선정+확정가 후 상태').toBe('quoted');
    expect(Number(spec?.finalPrice ?? 0), '확정가 반영').toBe(FINAL_PRICE_KRW);
  }, 120_000);

  test('M1c. 고객 주문 → 관리자 입금확인 → 발주(USD·환율 명시) + 결제조건(PATCH)', async (ctx) => {
    if (specId === null || rfqId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'M1c',
      prefix: 'M01',
      buyerName: 'e2e여정고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    // 발주 — 환율을 **명시**한다. rfq 선정 박제(1400)를 이겨야 한다(발주 회계는 발주 시점).
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner2.id),
      rfqId,
      exchangeRate: PO_RATE,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner2.id));
    expect(po, '발주서 행').toBeTruthy();
    poId = po.poId;
    ledger.push(`sp_pcb_po #${String(poId)} (협력2 · USD ${String(PO_USD)} @${String(PO_RATE)})`);

    // 발주 KRW 회계 박제 — 환차 어서션(M4)의 기준선.
    expect(po.currency, '발주 통화').toBe('USD');
    expect(po.priceOriginal, '발주가').toBe(PO_USD);
    expect(po.exchangeRate, '발주 바디 환율이 rfq 선정 박제를 이긴다').toBe(PO_RATE);
    expect(po.krwAmount, 'KRW 회계 박제 = 발주가 × 발주 환율').toBe(PO_KRW);
    expect(po.remittedAt, '발주 시점 송금 캐시는 비어 있다(원장이 정본)').toBeNull();

    // 결제조건 — 부분 송금이 자연스러운 값. 발주 바디가 아니라 **조건 수정 창구**로(P3.10).
    const patch = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`,
      { paymentTerms: PAYMENT_TERMS },
    );
    expect(patch.status, `결제조건 수정: ${JSON.stringify(patch.json)}`).toBe(200);
    const patched = (patch.json?.data?.pos ?? []).find((p: any) => p.poId === poId);
    expect(patched?.paymentTerms, '결제조건 반영').toBe(PAYMENT_TERMS);

    // 송금 전 기준선 — 잔액=발주가 전액, 대기 큐 1건.
    const q = await queue('pending');
    const mine = q.items.find((r: any) => r.poId === poId);
    expect(mine, '발주 직후 = 송금 대기 큐').toBeTruthy();
    expect(mine.summary.currency, '요약 통화').toBe('USD');
    expect(mine.summary.poAmount, '요약 발주가').toBe(PO_USD);
    expect(mine.summary.paidAmount, '송금 전 합계 0').toBe(0);
    expect(mine.summary.balance, '송금 전 잔액=발주가').toBe(PO_USD);
    expect(mine.summary.status, '송금 전 상태').toBe('unpaid');
    expect(mine.summary.count, '송금 건수 0').toBe(0);
    expect(mine.isFreeAs, '원발주는 무상 A/S 가 아니다').toBe(false);
    expect(mine.reorderRound, '원발주 회차 0 — 목록 배지의 근거(재점검 #6)').toBe(0);
    expect(mine.paymentTerms, '큐 행에도 결제조건이 실린다').toBe(PAYMENT_TERMS);
    expect(mine.issuedAt, '발주일(경과일 표시의 근거)').toBeTruthy();
    expect(q.counts, '스펙 스코프 counts(송금 전)').toEqual({
      pending: 1,
      partial: 0,
      done: 0,
      all: 1,
    });
    // 통화별 소계(재점검 #14) — 한 열에 ₩·$가 섞이므로 합계는 서버가 통화별로 낸다.
    expect(q.byCurrency, 'USD 소계 1종').toEqual([
      { currency: 'USD', poAmount: PO_USD, paidAmount: 0, balance: PO_USD, poCount: 1 },
    ]);
    // 화면은 견적을 'Q21195' 로 찍는다 — 보이는 그대로 붙여 넣어도 같은 결과라야 한다(#12).
    const byQ = await queue('pending', `Q${String(specId)}`);
    expect(byQ.items.map((x: any) => x.poId), "'Q' 접두 검색도 같은 행").toContain(poId);
    expect(byQ.total, "'Q' 접두 검색 건수 = 숫자 검색 건수").toBe(q.total);

    aggAfterIssue = await partnerAgg();
    expect(aggAfterIssue.usd, '협력2 USD 집계 행').toBeTruthy();
    F(
      'M1',
      'obs',
      `발주 박제 — USD ${String(PO_USD)} @${String(PO_RATE)} = ₩${PO_KRW.toLocaleString()} · 결제조건 '${PAYMENT_TERMS}'`,
    );
  }, 300_000);

  // ── M2. 1차 부분 송금 — 발주 환율과 다른 실적용 환율 ──────────────────────────
  test('M2. 1차 부분 송금(발주가의 절반·다른 환율) → 잔액·부분 상태·탭 이동·remittedAt 파생', async (ctx) => {
    if (poId === null) return ctx.skip();
    const r = await api(A, 'POST', remitPath(), {
      remittedOn: R1.on,
      amount: R1.amount,
      exchangeRate: R1.rate,
      memo: '[여정 8호] 선급 50%',
    });
    expect(r.status, `1차 송금: ${JSON.stringify(r.json)}`).toBe(200);

    const s = r.json?.data?.summary;
    expect(s.paidAmount, '송금 합계').toBe(R1.amount);
    expect(s.balance, '잔액 = 발주가 − 송금 합계').toBe(PO_USD - R1.amount);
    expect(s.status, '부분 송금').toBe('partial');
    expect(s.count, '송금 건수').toBe(1);

    const rows = r.json?.data?.remittances ?? [];
    expect(rows).toHaveLength(1);
    const row0 = rows[0];
    remit1Id = row0.id;
    ledger.push(`sp_pcb_remittance #${String(remit1Id)} (po ${String(poId)} · USD ${String(R1.amount)} @${String(R1.rate)})`);
    // 통화는 발주에서 가져온다(클라이언트가 못 정한다) + KRW 는 **송금 시점 실환율**로 박제.
    expect(row0.currency, '송금 통화 = 발주 통화 고정').toBe('USD');
    expect(row0.amount, '송금액').toBe(R1.amount);
    expect(row0.exchangeRate, '실적용 환율(발주 환율과 다르다)').toBe(R1.rate);
    expect(row0.exchangeRate, '발주 회계 환율과 분리').not.toBe(PO_RATE);
    expect(row0.krwAmount, 'KRW 환산 = 송금액 × 실적용 환율').toBe(R1.amount * R1.rate);
    expect(row0.createdBy, '기록자').toBe('e2e-admin');
    expect(row0.files, '증빙은 아직 없다').toEqual([]);

    // 워크큐 이동 — 대기에서 빠지고 부분으로. counts 는 같은 호출이 함께 돌려준다.
    const partial = await queue('partial');
    expect(partial.items.map((x: any) => x.poId), '부분 송금 탭 편입').toContain(poId);
    expect(partial.counts, '스펙 스코프 counts(부분)').toEqual({
      pending: 0,
      partial: 1,
      done: 0,
      all: 1,
    });
    const pending = await queue('pending');
    expect(pending.items.map((x: any) => x.poId), '대기 큐에서 빠진다').not.toContain(poId);

    // 발주서 remittedAt 은 원장 파생 캐시 — 마지막 송금일, KST 자정 앵커.
    const po = await poRow();
    expect(po?.remittedAt?.toISOString(), 'remittedAt 파생(KST 앵커)').toBe('2026-08-07T15:00:00.000Z');
    F(
      'M2',
      'obs',
      `1차 송금 USD ${String(R1.amount)} @${String(R1.rate)} = ₩${(R1.amount * R1.rate).toLocaleString()} · 잔액 USD ${String(s.balance)} · remittedAt=${R1.on}`,
    );
  });

  // ── M3. 증빙(이체 확인증) ────────────────────────────────────────────────────
  test('M3. 증빙 첨부 — 업로드 → 목록·상세 노출 → 다운로드 1회(+포털 비노출)', async (ctx) => {
    if (poId === null || remit1Id === null) return ctx.skip();
    // 최소 PNG(시그니처 + 표식) — 다운로드 바이트 동일성 비교용.
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode('J8-RECEIPT'),
    ]);
    const up = await apiForm(
      A,
      `${remitPath(remit1Id)}/files`,
      RECEIPT_NAME,
      bytes.buffer as ArrayBuffer,
      'image/png',
    );
    expect(up.status, `증빙 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const uploaded = (up.json?.data?.remittances ?? []).find((x: any) => x.id === remit1Id);
    expect(uploaded?.files ?? [], '변경 응답이 증빙을 함께 돌려준다').toHaveLength(1);
    receiptFileId = uploaded.files[0].fileId;
    expect(uploaded.files[0].name, '원본 파일명 보존').toBe(RECEIPT_NAME);
    expect(uploaded.files[0].size, '파일 크기').toBe(bytes.byteLength);
    ledger.push(`sp_file(sp_pcb_remittance) #${String(receiptFileId)} — ${RECEIPT_NAME}`);

    // 상세(패널이 읽는 그 라우트)에도 실린다.
    const detail = await api(A, 'GET', remitPath());
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    expect(detail.json?.data?.partnerName, '상세 협력사명').toBe('협력2');
    expect(detail.json?.data?.isFreeAs, '유상 원발주 — 상세도 지급 대상 판정을 싣는다').toBe(false);
    expect(detail.json?.data?.poKrwAmount, '상세에 발주 KRW 회계 박제(환차 표시의 기준)').toBe(PO_KRW);
    const dRow = (detail.json?.data?.remittances ?? []).find((x: any) => x.id === remit1Id);
    expect(dRow?.files?.[0]?.fileId, '상세 증빙 노출').toBe(receiptFileId);

    // 다운로드 1회 — 바이트가 같아야 '증빙'이다.
    const res = await fetch(`${API_URL}${remitPath(remit1Id)}/files/${String(receiptFileId)}`, {
      headers: { authorization: `Bearer ${A}` },
    });
    expect(res.status, '증빙 다운로드').toBe(200);
    expect(res.headers.get('content-disposition') ?? '', '다운로드 파일명').toContain(
      encodeURIComponent(RECEIPT_NAME),
    );
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.byteLength, '다운로드 바이트 길이').toBe(bytes.byteLength);
    expect([...got], '다운로드 바이트 동일').toEqual([...bytes]);

    // 증빙은 **내부 자료** — 협력사 포털엔 싣지 않는다(계약에 files 자체가 없다).
    const p = await portal();
    const mine = p.items.find((x: any) => x.poId === poId);
    expect(mine, '포털 수금 현황에 이 발주가 있다').toBeTruthy();
    expect(mine.remittances[0], '포털 입금 건별 내역').toBeTruthy();
    expect(Object.keys(mine.remittances[0]), '포털엔 증빙 키가 없다').not.toContain('files');
    F('M3', 'obs', `증빙 1건 업로드·다운로드 왕복(${String(bytes.byteLength)}B) — 포털 비노출 확인`);
  }, 120_000);

  // ── M4. 잔금 송금 → 잔액 0·완료 + 환차 실측 ──────────────────────────────────
  test('M4. 잔금 송금(또 다른 환율) → 잔액 0·완료 · 원장 KRW 합계 ≠ 발주 KRW 회계', async (ctx) => {
    if (poId === null) return ctx.skip();
    const r = await api(A, 'POST', remitPath(), {
      remittedOn: R2.on,
      amount: R2.amount,
      exchangeRate: R2.rate,
      memo: '[여정 8호] 잔금 50%',
    });
    expect(r.status, `잔금 송금: ${JSON.stringify(r.json)}`).toBe(200);

    const s = r.json?.data?.summary;
    expect(s.paidAmount, '송금 합계 = 발주가').toBe(PO_USD);
    expect(s.balance, '잔액 0').toBe(0);
    expect(s.status, '송금 완료').toBe('paid');
    expect(s.count, '송금 2건').toBe(2);
    const rows = r.json?.data?.remittances ?? [];
    expect(rows, '원장 2행(송금일 오름차순)').toHaveLength(2);
    remit2Id = rows[1].id;
    ledger.push(`sp_pcb_remittance #${String(remit2Id)} (po ${String(poId)} · USD ${String(R2.amount)} @${String(R2.rate)})`);
    expect(rows.map((x: any) => x.currency), '두 행 모두 발주 통화').toEqual(['USD', 'USD']);

    const done = await queue('done');
    expect(done.items.map((x: any) => x.poId), '완료 탭 편입').toContain(poId);
    expect(done.counts, '스펙 스코프 counts(완료)').toEqual({
      pending: 0,
      partial: 0,
      done: 1,
      all: 1,
    });

    const po = await poRow();
    expect(po?.remittedAt?.toISOString(), 'remittedAt = 마지막 송금일(KST 앵커)').toBe(
      '2026-08-10T15:00:00.000Z',
    );

    // ── 환차손익의 근거 — 같은 USD 300 인데 원화는 두 값이 다르다 ──────────────
    // 원장 KRW 합계(실지급) vs 발주 KRW 회계(박제). 하나로 뭉개면 이 차이가 사라진다.
    const prisma = getPrisma();
    const ledgerRows = await prisma.spPcbRemittance.findMany({ where: { poId: BigInt(poId) } });
    const krwSum = ledgerRows.reduce((acc: number, x: any) => acc + Number(x.krwAmount ?? 0), 0);
    const usdSum = ledgerRows.reduce((acc: number, x: any) => acc + Number(x.amount), 0);
    expect(usdSum, '원화(外)는 갈려도 외화 합계는 발주가와 같다').toBe(PO_USD);
    expect(krwSum, '원장 KRW 합계(실지급)').toBe(LEDGER_KRW);
    expect(Number(po?.krwAmount), '발주 KRW 회계(박제)').toBe(PO_KRW);
    expect(krwSum, '두 값은 같지 않다 — 그 차이가 환차손익이다').not.toBe(Number(po?.krwAmount));
    expect(krwSum - Number(po?.krwAmount), '환차 실측').toBe(FX_DIFF);
    // 평균 실효 환율(가중) — 리포트가 읽을 수 있는 수치로 남긴다.
    const effRate = krwSum / usdSum;
    expect(effRate, '실효 환율은 두 송금 환율 사이').toBeGreaterThan(R1.rate);
    expect(effRate, '실효 환율은 두 송금 환율 사이').toBeLessThan(R2.rate);
    F(
      'M4',
      'obs',
      `환차 실측 — 발주 회계 ₩${PO_KRW.toLocaleString()}(@${String(PO_RATE)}) vs 원장 실지급 ₩${LEDGER_KRW.toLocaleString()}` +
        `(₩${(R1.amount * R1.rate).toLocaleString()}@${String(R1.rate)} + ₩${(R2.amount * R2.rate).toLocaleString()}@${String(R2.rate)})` +
        ` = 차 ₩${FX_DIFF.toLocaleString()} (실효 환율 ${effRate.toFixed(2)})`,
    );
  });

  // ── M5. 협력사별 집계 · 포털 수금 대조 ───────────────────────────────────────
  test('M5. 협력사별 잔액 집계 델타(+300 지급) · 포털 수금(발주처·금액·미수 0) 대조', async (ctx) => {
    if (poId === null || aggAfterIssue === null) return ctx.skip();
    aggAfterPaid = await partnerAgg();
    expect(aggAfterPaid.usd, '협력2 USD 집계 행').toBeTruthy();
    // 공유 DB — 절대값이 아니라 이 여정이 만든 **델타**로 판단한다.
    expect(aggAfterPaid.usd.paidAmount - aggAfterIssue.usd.paidAmount, '집계 지급액 델타').toBe(
      PO_USD,
    );
    expect(aggAfterPaid.usd.balance - aggAfterIssue.usd.balance, '집계 잔액 델타').toBe(-PO_USD);
    expect(aggAfterPaid.usd.poCount - aggAfterIssue.usd.poCount, '발주 수 불변').toBe(0);

    // ✅ 08-11 교정(재점검 확정 #8) — 협력사별 집계의 **KRW 지급액은 원장 실합**이다.
    //   종전엔 발주 회계 × 지급비율(비례배분)이라 화면이 늘 ₩414,000 을 되불러, 실제로
    //   나간 ₩412,500 과 그 차이(환차)가 집계에서 사라졌다. 이제 두 기준을 나눠 낸다:
    //   지급 = 원장 실지급, 잔액 = 발주 회계 환율 환산. 그래서 krwPo ≠ krwPaid + krwBalance
    //   가 **정상**이고 그 차이가 곧 환차다(화면 캡션이 이 사실을 말한다).
    expect(
      aggAfterPaid.row.krwPaidAmount - aggAfterIssue.row.krwPaidAmount,
      'KRW 지급 델타 = 원장 실지급 합(비례배분 아님)',
    ).toBe(LEDGER_KRW);
    expect(
      aggAfterPaid.row.krwPaidAmount - aggAfterIssue.row.krwPaidAmount,
      '발주 회계 박제와는 다르다 — 그 차이가 환차',
    ).not.toBe(PO_KRW);
    expect(aggAfterPaid.row.krwPaidRateMissing, '이 주행의 두 건은 환율을 다 적었다').toBe(false);
    expect(aggAfterPaid.row.krwBalance - aggAfterIssue.row.krwBalance, 'KRW 환산 잔액 델타').toBe(
      -PO_KRW,
    );
    // 잔여 발주(잔액>0) — '미착수 0인데 잔액이 있다'는 모순을 없앤 짝(재점검 #5·가드 ③).
    expect(aggAfterIssue.row.openPoCount, '발주 직후엔 잔여 발주가 최소 1건(이 주행분)').toBeGreaterThan(0);
    expect(
      aggAfterPaid.row.openPoCount - aggAfterIssue.row.openPoCount,
      '완납하면 잔여 발주에서 빠진다(−1)',
    ).toBe(-1);
    expect(
      aggAfterPaid.row.unpaidPoCount - aggAfterIssue.row.unpaidPoCount,
      '미착수 발주도 −1(첫 송금에 이미 빠졌다)',
    ).toBe(-1);
    // 가드 ③ — '잔여 발주 0' 과 '통화별 잔액>0' 은 동시에 성립할 수 없다.
    if (aggAfterPaid.row.openPoCount === 0) {
      expect(
        (aggAfterPaid.row.byCurrency ?? []).filter((c: any) => c.balance > 0),
        '잔여 발주가 0이면 잔액이 남은 통화도 없다',
      ).toEqual([]);
    }

    const p = await portal();
    portalUsdAfterPaid = p.totals.find((t: any) => t.currency === 'USD');
    const mine = p.items.find((x: any) => x.poId === poId);
    expect(mine, '포털에 이 발주가 있다').toBeTruthy();
    expect(mine.ordererName, '발주처(우리=하우스) 표기').toBeTruthy();
    expect(mine.ordererName, '발주처는 자기 조직이 아니다').not.toBe(partner2.name);
    expect(mine.summary.currency, '포털 통화').toBe('USD');
    expect(mine.summary.poAmount, '포털 발주가').toBe(PO_USD);
    expect(mine.summary.paidAmount, '포털 입금 합계').toBe(PO_USD);
    expect(mine.summary.balance, '포털 미수금 0').toBe(0);
    expect(mine.summary.status, '포털 상태').toBe('paid');
    expect(mine.remittances, '포털 입금 건별 2건').toHaveLength(2);
    expect(mine.remittances.map((x: any) => x.amount), '건별 금액이 관리자 원장과 같다').toEqual([
      R1.amount,
      R2.amount,
    ]);
    expect(mine.isFreeAs, '유상 원발주').toBe(false);

    // 관리자 상세와 포털이 같은 계산기를 쓰는지 — 금액이 두 화면에서 갈라지면 그게 결함.
    const detail = await api(A, 'GET', remitPath());
    expect(detail.json?.data?.summary?.balance, '관리자 상세 잔액').toBe(mine.summary.balance);
    expect(detail.json?.data?.summary?.paidAmount, '관리자 상세 지급합계').toBe(
      mine.summary.paidAmount,
    );
    F(
      'M5',
      'obs',
      `집계 델타 +$${String(PO_USD)} 지급/−$${String(PO_USD)} 잔액 · 포털 발주처 '${String(mine.ordererName)}' 미수 0` +
        ` — 협력사별 KRW 지급은 **원장 실지급** ₩${LEDGER_KRW.toLocaleString()}(비례배분 ₩${PO_KRW.toLocaleString()} 폐기, 08-11 교정)` +
        ` · 잔여 발주 −1 · 잔액 환산은 발주 회계 기준이라 두 값의 차 ₩${FX_DIFF.toLocaleString()} 가 환차로 남는다`,
    );
  });

  // ── M6. 무상 A/S 회차 대조(08-10 수정분 회귀) ────────────────────────────────
  test('M6. 무상 A/S 회차 — 송금 큐 제외·isFreeAs·잔액 0 · 집계/포털 총계 불변', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(partner2.id),
      caseType: 'product_defect',
      description: '[여정 8호] 불량 재생산 — 무상(돈 축 대조)',
    });
    expect(create.status, JSON.stringify(create.json)).toBe(200);
    asCaseId = create.json?.data?.asCase?.id ?? null;
    expect(create.json?.data?.asCase?.chargeType, '제품 불량 = 무상 기본').toBe('free');
    ledger.push(`sp_pcb_as_case #${String(asCaseId)} (무상)`);

    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/submit`, {});
    expect(submit.status, JSON.stringify(submit.json)).toBe(200);
    const accept = await api(P, 'POST', `/api/partner/pcb-as-cases/${String(asCaseId)}/accept`, {
      reason: '[여정 8호] 무상 재생산 수락',
    });
    expect(accept.status, `수락: ${JSON.stringify(accept.json)}`).toBe(200);
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(asCaseId)}/proceed`, {});
    expect(proceed.status, `진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    expect(proceed.json?.data?.reorderRound, '1회차 채번').toBe(1);
    freePoId = proceed.json?.data?.poId ?? null;
    expect(freePoId, '회차 발주 생성').not.toBeNull();
    ledger.push(`sp_pcb_po #${String(freePoId)} (협력2 · A/S round 1 — 무상)`);

    // 회차 발주는 원발주의 **원가 회계를 그대로 복사**한다(지급 대상이 아닌 것과 별개).
    const prisma = getPrisma();
    const freePo = await prisma.spPcbPo.findUnique({ where: { id: BigInt(freePoId ?? 0) } });
    expect(Number(freePo?.priceOriginal), '회차 발주가 = 원발주 복사').toBe(PO_USD);
    expect(Number(freePo?.krwAmount), '회차 KRW 회계 = 원발주 복사').toBe(PO_KRW);
    expect(freePo?.remittedAt, '회차 발주 송금 캐시 비어 있음').toBeNull();

    const all = await queue('all');
    const freeRow = all.items.find((x: any) => x.poId === freePoId);
    expect(freeRow, "'전체' 탭엔 회차 행이 보인다").toBeTruthy();
    expect(freeRow.isFreeAs, '무상 A/S 배지').toBe(true);
    expect(freeRow.reorderRound, '회차 표기 1차').toBe(1);
    expect(freeRow.summary.poAmount, '발주가는 사실 그대로').toBe(PO_USD);
    expect(freeRow.summary.balance, '무상 회차 잔액 0(지급 대상 아님)').toBe(0);
    // 소계는 지급 축이므로 무상 회차를 빼고 센다 — 안 빼면 '줄 돈'이 두 배로 보인다.
    expect(all.byCurrency, "'전체' 탭 소계에도 무상 회차는 안 들어간다").toEqual([
      { currency: 'USD', poAmount: PO_USD, paidAmount: PO_USD, balance: 0, poCount: 1 },
    ]);

    // ★ 가드 ① — **상세도 목록과 같은 판정**을 해야 한다. 여기가 갈라졌던 탓에 패널이
    //   무상 회차에 잔액 $300 을 프리필해 "안 줘도 될 돈"을 한 번에 보낼 뻔했다(#1).
    const freeDetail = await api(A, 'GET', `/api/admin/pcb-remittances/${String(freePoId)}`);
    expect(freeDetail.status, `무상 회차 상세: ${JSON.stringify(freeDetail.json)}`).toBe(200);
    expect(freeDetail.json?.data?.isFreeAs, '상세 isFreeAs').toBe(true);
    expect(freeDetail.json?.data?.summary?.balance, '상세 잔액 0(목록과 일치)').toBe(0);
    expect(freeDetail.json?.data?.summary?.poAmount, '발주가는 원가 회계 그대로').toBe(PO_USD);
    expect(freeDetail.json?.data?.remittances, '무상 회차엔 원장이 없다').toEqual([]);
    expect(all.counts, "무상 회차는 'all' 에만 선다").toEqual({
      pending: 0,
      partial: 0,
      done: 1,
      all: 2,
    });
    const pending = await queue('pending');
    expect(pending.items.map((x: any) => x.poId), '대기 큐 제외').not.toContain(freePoId);
    const partial = await queue('partial');
    expect(partial.items.map((x: any) => x.poId), '부분 탭 제외').not.toContain(freePoId);
    const done = await queue('done');
    expect(done.items.map((x: any) => x.poId), '완료 탭도 제외(지급 축 전체에서 빠진다)').not.toContain(
      freePoId,
    );

    // 집계 모수에서도 빠진다 — 무상 회차가 섞이면 '줄 돈'이 300 늘어난 것처럼 보인다.
    const after = await partnerAgg();
    expect(after.usd.poCount, '협력사별 집계 발주 수 불변').toBe(aggAfterPaid?.usd.poCount);
    expect(after.usd.poAmount, '집계 발주가 총계 불변').toBe(aggAfterPaid?.usd.poAmount);
    expect(after.usd.balance, '집계 잔액 불변').toBe(aggAfterPaid?.usd.balance);
    expect(after.row.krwPoAmount, 'KRW 환산 총계도 불변(무상 회차 krwAmount 미편입)').toBe(
      aggAfterPaid?.row.krwPoAmount,
    );

    // 포털 수금도 같은 규율 — 행은 보이되 미수 총계·미수 건수에서 빠진다.
    const p = await portal();
    const freeItem = p.items.find((x: any) => x.poId === freePoId);
    expect(freeItem, '포털에 회차 행이 보인다').toBeTruthy();
    expect(freeItem.isFreeAs, '포털 무상 A/S 배지').toBe(true);
    expect(freeItem.reorderRound, '포털에도 회차 표기(같은 프로젝트 두 줄 구분)').toBe(1);
    expect(
      p.items.find((x: any) => x.poId === poId)?.reorderRound,
      '원발주는 0차',
    ).toBe(0);
    expect(freeItem.summary.balance, '포털 미수 0').toBe(0);
    expect(freeItem.remittances, '무상 회차엔 입금 내역이 없다').toEqual([]);
    const usdTotal = p.totals.find((t: any) => t.currency === 'USD');
    expect(usdTotal, '포털 USD 총계 행').toBeTruthy();
    expect(usdTotal.poCount, '포털 총계 발주 수 불변').toBe(portalUsdAfterPaid.poCount);
    expect(usdTotal.poAmount, '포털 총계 발주가 불변').toBe(portalUsdAfterPaid.poAmount);
    expect(usdTotal.balance, '포털 총계 미수 불변').toBe(portalUsdAfterPaid.balance);
    F(
      'M6',
      'obs',
      `무상 A/S 회차 po#${String(freePoId)} — isFreeAs·잔액 0·pending/partial/done 전부 제외 · 관리자 집계·포털 총계 불변`,
    );
  }, 180_000);

  // ── M8(선행 실행). 화면 실측 — 가드 순환이 원장을 지우기 전에 찍는다 ──────────
  test('M8. 화면 실측 — 송금 워크큐(탭별)·Case 발주 패널 송금 섹션·포털 수금 현황', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const page = adminView.page;
    // 탭 전환은 재조회다 — networkidle 만 믿고 찍으면 '불러오는 중…' 화면이 남는다
    // (1차 주행 실측: 탭 4장이 전부 로딩 자리표시자였다). 자리표시자가 사라질 때까지 기다린다.
    const settled = async (s: E2eSession): Promise<void> => {
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
      await s.page
        .waitForFunction(() => !document.body.innerText.includes('불러오는 중'), undefined, {
          timeout: 20_000,
        })
        .catch(() => undefined);
    };

    // ① 관리자 송금 워크큐 — 탭은 URL 쿼리를 안 받으므로 클릭으로 이동한다.
    await view(adminView, '/app/admin/pcb/remittances', 'M08-admin-remit-queue-open');
    await page.fill('input[type="search"]', String(specId));
    await page.press('input[type="search"]', 'Enter');
    await settled(adminView);
    await shot(adminView, 'M08-admin-remit-pending');
    for (const [label, name] of [
      ['전체', 'M08-admin-remit-all'],
      ['부분 송금', 'M08-admin-remit-partial'],
      ['송금 완료', 'M08-admin-remit-done'],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
      await settled(adminView);
      await shot(adminView, name);
    }
    // '전체' 로 돌아와 두 행(유상 원발주·무상 회차)이 함께 보이는 것을 텍스트로 확인.
    await page.getByRole('button', { name: /^전체/ }).first().click();
    await settled(adminView);
    const queueText: string = await page.evaluate(() => document.body.innerText);
    expect(queueText, '워크큐에 무상 A/S 배지').toContain('무상 A/S');
    expect(queueText, '워크큐에 송금 완료 배지').toContain('송금 완료');
    expect(queueText, '워크큐에 A/S 회차 배지(#6)').toContain('1차');
    expect(queueText, '워크큐에 결제조건 열(#13)').toContain(PAYMENT_TERMS);
    expect(queueText, '워크큐에 통화별 소계(#14)').toContain('통화별 소계');

    // ★ 화면 확증 #1 — 무상 A/S 행의 패널: 프리필 없음 · 배너 · [기록] 기본 잠금.
    const freeAsRow = page.locator('tbody tr').filter({ hasText: '무상 A/S' }).first();
    await freeAsRow.getByRole('button', { name: '송금 기록' }).first().click();
    await page.getByText('송금 원장').first().waitFor({ timeout: 15_000 });
    await settled(adminView);
    await shot(adminView, 'M08-admin-remit-freeas-panel');
    const freePanelText: string = await page.evaluate(() => document.body.innerText);
    expect(freePanelText, '무상 A/S 배너').toContain('지급 대상이 아님');
    expect(
      await page.locator('input[inputmode="decimal"]').first().inputValue(),
      '무상 회차엔 금액 프리필 금지(이 값이 곧 오지급 버튼이었다)',
    ).toBe('');
    expect(
      await page.getByRole('button', { name: '기록', exact: true }).first().isDisabled(),
      '[기록] 기본 비활성(명시 해제 시에만 활성)',
    ).toBe(true);
    await page.getByRole('button', { name: '닫기' }).first().click();
    await settled(adminView);

    await page.getByRole('button', { name: '협력사별' }).first().click();
    await settled(adminView);
    await shot(adminView, 'M08-admin-remit-partners');
    const partnersText: string = await page.evaluate(() => document.body.innerText);
    expect(partnersText, '협력사별 탭에 협력2').toContain('협력2');
    expect(partnersText, "'미송금'→'미착수'로 정정 + 잔여 발주 열(#5)").toContain('미착수 발주');
    expect(partnersText, '잔여 발주 열').toContain('잔여 발주');
    expect(partnersText, '실지급은 원장 실합(#8②)').toContain('실지급');
    expect(partnersText, '무상 A/S 제외 규율 문구(#10)').toContain('무상 A/S 회차는 모수에서 제외');

    // ② Case 발주 패널의 송금 섹션 — 같은 패널 컴포넌트(창구는 여럿, 원장은 하나).
    // ⚠ A/S 회차가 생기면 상세는 **최신 회차만 펼치고 원발주를 접는다** — 돈이 걸린
    //   원발주의 원장은 그 접힘 아래에 있다(첫 [송금] 버튼은 무상 회차의 것이다).
    //   접힘을 열고 금액 배지('송금 $300.00/$300.00')가 붙은 행을 짚는다 — 08-11 이전엔
    //   날짜 배지('송금 2026-08-11')였으나 부분/완납이 구분되지 않아 금액으로 바꿨다(#7).
    await view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'M08-admin-case-top');
    const expand = page.getByRole('button', { name: /이전 회차 발주·견적/ }).first();
    if ((await expand.count()) > 0) {
      await expand.click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      F('M8', 'obs', 'A/S 회차 발생 후 원발주 송금 패널은 [이전 회차 … 보기] 접힘 아래에 있다');
    }

    // ★ 가드 ② — 발주 표 협력사 열이 0폭으로 붕괴하지 않는다(결제조건 문자열이 폭을
    //   다 가져가던 결함 #2 의 회귀 가드 — 견적관리 measureQuotesRowWidths 의 미러).
    const poRowWidths = await measurePoRowPartnerWidths(page);
    expect(poRowWidths.length, '발주 표 행을 실제로 쟀다').toBeGreaterThan(0);
    expect(
      poRowWidths.filter((w) => w.partnerW <= 0),
      `협력사 열 붕괴 행(0폭): ${JSON.stringify(poRowWidths)}`,
    ).toEqual([]);
    const caseText: string = await page.evaluate(() => document.body.innerText);
    expect(caseText, 'Case 발주 행이 송금 금액을 말한다(부분/완납 구분)').toContain('송금 $300.00/$300.00');
    expect(caseText, '환산 시점 꼬리표 — 발주 시점').toContain(`@${String(PO_RATE)} 발주 시점`);
    expect(caseText, '환산 시점 꼬리표 — 선정 시점').toContain(`@${String(SELECT_RATE)} 선정 시점`);

    const paidRow = page.locator('tbody tr').filter({ hasText: /송금 \$/ }).first();
    await paidRow.waitFor({ state: 'visible', timeout: 20_000 });
    const remitBtn = paidRow.getByRole('button', { name: '송금', exact: true }).first();
    await remitBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await remitBtn.click();
    await page.getByText('송금 원장').first().waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await shot(adminView, 'M08-admin-case-remit-panel');
    const panelText: string = await page.evaluate(() => document.body.innerText);
    expect(panelText, '패널 3칸 요약').toContain('미지급 잔액');
    expect(panelText, '원발주의 원장 — 송금 2회').toMatch(/2회/);
    expect(panelText, '증빙 파일명').toContain(RECEIPT_NAME);
    expect(panelText, '두 송금일이 다 보인다').toContain(R1.on);
    expect(panelText, '두 송금일이 다 보인다').toContain(R2.on);
    // 외화 패널의 KRW 한 줄(재점검 #8①) — 3칸이 전부 USD 라 통장에서 나간 원화가 없었다.
    expect(panelText, '원장 실지급 KRW').toContain(`원장 실지급 ₩${LEDGER_KRW.toLocaleString()}`);
    expect(panelText, '환차 표기(발주 회계 대비)').toContain(
      `환차 -₩${Math.abs(FX_DIFF).toLocaleString()}`,
    );

    // ③ 협력사 포털 — 홈이 '받을 돈'을 먼저 알리는가(P3.11 이 약속한 홈 요약 카드, #17).
    //    협력2 는 다른 주행의 발주도 갖고 있어 절대 수를 못 박을 수 없다 — API 의
    //    unpaidCount 와 화면이 **일치하는지**로 본다(카드 유무 자체가 규율).
    await view(partnerView, '/app/partner/pcb', 'M08-partner-home');
    await settled(partnerView);
    const homeText: string = await partnerView.page.evaluate(() => document.body.innerText);
    const portalNow = await portal();
    if (portalNow.unpaidCount > 0) {
      expect(homeText, '미수금이 있으면 홈 카드가 그 수를 말한다').toContain(
        `미수금 ${String(portalNow.unpaidCount)}건`,
      );
    } else {
      expect(homeText, '미수금이 없으면 홈에 카드도 없다').not.toContain('미수금 ');
    }

    // ④ 협력사 포털 수금 현황 — 같은 두 건이 협력사 눈으로 어떻게 보이는가.
    await view(partnerView, '/app/partner/remittances', 'M08-partner-remittances-open');
    await settled(partnerView);
    await shot(partnerView, 'M08-partner-remittances');
    const portalText: string = await partnerView.page.evaluate(() => document.body.innerText);
    expect(portalText, '포털 수금 화면 도달').toMatch(/수금|미수/);
    expect(portalText, '포털에도 무상 A/S 배지').toContain('무상 A/S');
    expect(portalText, '포털 입금 완료 배지').toContain('입금 완료');
    expect(portalText, '포털에도 A/S 회차 표기(#6)').toContain('A/S 1차');
    expect(portalText, '총계 제외 규율을 표에서도 말한다(#10)').toContain('총계 제외');
    expect(portalText, '총계 캡션의 무상 제외 문구(#10)').toContain('무상 A/S 재생산 건을 제외');
    F('M8', 'obs', '화면 실측 — 워크큐 4탭+협력사별·Case 송금 패널(2회·증빙)·포털 수금 캡처');
  }, 180_000);

  // ── M7(후행 실행). 가드 순환 — 잠김 → 정리 → 열림 ───────────────────────────
  test('M7. 가드 순환 — 입력 검증 · 당일 자동 환율/과거일 가드 · HAS_REMITTANCE 409 → 정리 → 취소 200', async (ctx) => {
    if (specId === null || poId === null || remit1Id === null || remit2Id === null) return ctx.skip();
    const prisma = getPrisma();

    // (1) 입력 계약 — 금액은 양수여야 하고, 없는 발주엔 기록할 수 없다.
    const zero = await api(A, 'POST', remitPath(), { remittedOn: R2.on, amount: 0 });
    expect(zero.status, '0원 송금 거부').toBe(400);
    const ghost = await api(A, 'POST', '/api/admin/pcb-remittances/99999999', {
      remittedOn: R2.on,
      amount: 10,
    });
    expect(ghost.status, '없는 발주서').toBe(404);

    // (2) 과거 송금일에 최신 자동 환율을 붙이면 시점이 거짓말하므로 명시 환율을 요구한다.
    const pastWithoutRate = await api(A, 'POST', remitPath(), {
      remittedOn: R2.on,
      amount: 10,
      memo: '[여정 8호] 과거일 환율 누락 가드',
    });
    expect(pastWithoutRate.status, `과거일 환율 누락: ${JSON.stringify(pastWithoutRate.json)}`).toBe(400);
    expect(pastWithoutRate.json?.error, '과거일은 수동 환율 요구').toBe('EXCHANGE_RATE_REQUIRED');

    // 오늘은 같은 PCB 공용 TTS 캐시를 서버가 자동 박제한다. 바디의 currency 는 무시하고
    // 발주 통화(USD)를 지키며, 환율 누락 행이 회계 합계에서 사라지는 경로를 닫는다.
    const rateRes = await api(A, 'GET', '/api/admin/pcb-exchange-rate?from=USD');
    expect(rateRes.status, `당일 환율 조회: ${JSON.stringify(rateRes.json)}`).toBe(200);
    const dailyRate = Number(rateRes.json?.data?.rate);
    expect(Number.isFinite(dailyRate) && dailyRate > 0, '당일 USD→KRW TTS 캐시').toBe(true);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const extra = await api(A, 'POST', remitPath(), {
      remittedOn: today,
      amount: 10,
      currency: 'KRW',
      memo: '[여정 8호] 과지급·당일 자동 환율 프로브',
    });
    expect(extra.status, `과지급 기록: ${JSON.stringify(extra.json)}`).toBe(200);
    const extraRow = (extra.json?.data?.remittances ?? []).at(-1);
    expect(extraRow.currency, '통화는 발주 통화로 고정(바디 KRW 무시)').toBe('USD');
    expect(extraRow.exchangeRate, '생략 환율 = 당일 TTS 자동 박제').toBe(dailyRate);
    expect(extraRow.krwAmount, '자동 환율로 KRW 환산 박제').toBe(Math.round(10 * dailyRate));
    expect(extra.json?.data?.summary?.status, '발주가 초과 = 과지급(감추지 않는다)').toBe('over');
    expect(extra.json?.data?.summary?.balance, '과지급 잔액은 음수').toBe(-10);
    F(
      'M7',
      'obs',
      `외화 송금 환율 — 과거일 누락 400 · 오늘 생략은 TTS @${String(dailyRate)} 자동 박제`,
    );

    const overQueue = await queue('done');
    expect(overQueue.items.map((x: any) => x.poId), '과지급도 완료 축(done) 탭에 선다').toContain(poId);

    const rmExtra = await api(A, 'DELETE', remitPath(extraRow.id));
    expect(rmExtra.status, `과지급 행 삭제: ${JSON.stringify(rmExtra.json)}`).toBe(200);
    expect(rmExtra.json?.data?.summary?.status, '삭제로 완료 복귀').toBe('paid');
    expect(rmExtra.json?.data?.summary?.balance, '잔액 0 복귀').toBe(0);

    // (3) 잠김 — 돈 기록이 있는 발주는 취소되지 않는다(원장이 조용히 cascade 소멸).
    const locked = await api(
      A,
      'DELETE',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`,
    );
    expect(locked.status, `송금 기록 발주 취소: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '취소 가드').toBe('HAS_REMITTANCE');
    expect(await prisma.spPcbRemittance.count({ where: { poId: BigInt(poId) } }), '원장 보존').toBe(2);
    expect(
      await prisma.spPcbPo.count({ where: { id: BigInt(poId) } }),
      '발주서 보존',
    ).toBe(1);

    // (4) 정리 — 원장 삭제. 증빙 파일도 함께 사라져야 한다(고아 방지).
    for (const id of [remit1Id, remit2Id]) {
      const rm = await api(A, 'DELETE', remitPath(id));
      expect(rm.status, `원장 정리 #${String(id)}: ${JSON.stringify(rm.json)}`).toBe(200);
    }
    expect(await prisma.spPcbRemittance.count({ where: { poId: BigInt(poId) } }), '원장 0').toBe(0);
    expect(
      await prisma.spFile.count({
        where: { refType: 'sp_pcb_remittance', refId: BigInt(remit1Id) },
      }),
      '증빙 파일도 함께 정리(고아 0)',
    ).toBe(0);
    // 파생 캐시도 원장을 따라 비워진다 — 남으면 "송금했다"는 거짓 표시가 남는다.
    const cleared = await poRow();
    expect(cleared?.remittedAt, 'remittedAt 파생 캐시 원복').toBeNull();
    const backToPending = await queue('pending');
    expect(backToPending.items.map((x: any) => x.poId), '대기 큐로 복귀').toContain(poId);

    // (5) 열림 — 이제 취소가 통한다.
    const opened = await api(
      A,
      'DELETE',
      `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`,
    );
    expect(opened.status, `정리 후 발주 취소: ${JSON.stringify(opened.json)}`).toBe(200);
    expect(await prisma.spPcbPo.count({ where: { id: BigInt(poId) } }), '발주서 삭제됨').toBe(0);
    F('M7', 'obs', '가드 순환 확인 — 409 HAS_REMITTANCE → 원장·증빙 정리(잔재 0) → 취소 200');
  }, 120_000);
});
