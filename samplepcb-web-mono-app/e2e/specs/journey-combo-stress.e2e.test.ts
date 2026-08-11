// 여정 11호 — **조합 스트레스(묶음 × A/S 회차 × 직송)**. 지금까지 각 축은 **따로** 검증됐다:
// 묶음(3·9호)·A/S 회차(5·7호)·직송(6호)·돈(8호). 그런데 박스 합류 키는 넷을 한 문자열에
// 담는다 — `contextKey = 받는측:조직:직송지:회차`(`lib/pcb-shipment.ts` pcbShipContextKey).
// **축이 교차할 때** 그 판정이 유지되는지는 아무도 안 봤다. 11호가 그 칸이다.
//
// 실증 축(전부 협력2 CN 직거래 한 조직 안에서 — 조직 축을 고정해야 키의 나머지 두 축만 남는다):
//   ① 회차 축이 **가른다**   — r0 묶음 박스(A·B)에 r1(C′)은 못 들어간다(`:r0` vs `:r1`)
//   ② 회차 축이 **묶는다**   — 같은 r1 끼리(C′·A′)는 스펙이 달라도 한 박스로 합류한다
//   ③ 직송지 축이 **가른다** — 같은 r1 인데 직송지만 다르면(`:-` vs `:CN`) 또 갈린다
//   ④ 두 축이 **동시에**     — 최종 3박스: `admin:0:-:r0` · `admin:0:-:r1` · `admin:0:CN:r1`
//
// 그리고 그 위에 얹힌 것들이 교차를 견디는지: 재작업 가드 W8(담긴 발주의 직송지 변경
// 409 IN_SHIPMENT → detach → 변경 → 재담기)·대표 승계(대표를 꺼내면 남은 발주가 상속하고
// 발송의 specId 까지 따라간다)·돈 축(무상/유상 A/S 회차가 **박스가 아니라 발주**로 갈린다)·
// 화면(선적 큐에 묶음·회차·직송 배지가 **동시에** 서는가).
//
// ⚠ 함정 셋(전부 이 파일이 밟는다):
//   - 박스 합류는 **대표 발주 기준**이다(findPreparingPcbShipment 가 대표의 partnerId·
//     reorderRound 를 본다) — 어서션 전에 대표가 누구인지 먼저 확인한다.
//   - A/S proceed 는 원발주 조건을 **복사**하고 납기만 비운다 — 직송지도 복사되므로(§P4.12,
//     `pcb-as-case.ts` proceedPcbAsCase `destinationCountry: origin.destinationCountry`)
//     "직송 회차"는 **복사 후 수정**으로만 만들 수 있다.
//   - 원발주의 직송지가 아니라 **최상위·최신 회차 발주**의 직송지가 고객 배송 큐의 종결
//     동선을 정한다(`routes/admin-pcb-orders.ts` directShipPoBySpec) — X9 가 그 교차를 박제한다.
//
// 실행(옵트인 2중 게이트): pnpm -F e2e journey:combo  (PORTAL_E2E=1 + JOURNEY=1)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(GERBER_URL)·Mailpit + e2e/.env.e2e 고객 자격.
// **생성물은 정리하지 않는다** — 대장(ledger) 기록 후 output/cleanup-probe.mts(고객 축 훑기,
// 상설 픽스처 무접촉). A/S 케이스는 스펙 FK cascade 로 스펙과 함께 소멸한다.
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
const PARTNER_NAME = '협력2'; // CN·USD 직거래 — 국제(Invoice 필수)와 직송 CN(비KR 국내)이 한 조직에서 다 나온다

// 돈의 숫자(교차 어서션이 상수를 읽는다) — 발주 3건 모두 같은 조건이라 델타가 곧 건수다.
const PO_USD = 300;
const PO_RATE = 1400;

/** 한 레인(고객 주문 1건 = 스펙 1건 = 원발주 1건) — 셋을 같은 절차로 민다. */
interface Lane {
  label: string;
  specId: number | null;
  odId: string | null;
  poId: number | null;
}

describe.skipIf(!RUN || !JOURNEY)('여정 11호 — 조합 스트레스(묶음 × A/S 회차 × 직송)', () => {
  const rp = createJourneyReport('findings-combo', '여정 11호 조합 스트레스(묶음×회차×직송) 리포트');
  const { F, ledger, view, shot } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let p2: PartnerFixture;
  let A = ''; // 관리자 토큰
  let P = ''; // 협력2 토큰

  const lanes: Lane[] = [
    { label: 'A', specId: null, odId: null, poId: null },
    { label: 'B', specId: null, odId: null, poId: null },
    { label: 'C', specId: null, odId: null, poId: null },
  ];
  const lane = (label: string): Lane => {
    const found = lanes.find((l) => l.label === label);
    if (found === undefined) throw new Error(`레인 ${label} 없음`);
    return found;
  };

  // 박스 — 키의 두 축이 만드는 세 칸
  let box0Id: string | null = null; // admin:0:-:r0  (A+B 묶음)
  let box1Id: string | null = null; // admin:0:-:r1  (C′ → A′ 합류 → C′ 이탈)
  let box2Id: string | null = null; // admin:0:CN:r1 (직송 C′)

  // A/S 축 — C′=무상(product_defect), A′=유상(admin_fault)
  let caseCId: number | null = null;
  let caseAId: number | null = null;
  let poCPrime: number | null = null;
  let poAPrime: number | null = null;

  // 돈 축 스냅샷(공유 DB라 절대값 금지 — 델타로만 판단)
  let aggAfterIssue: { row: any; usd: any } | null = null;
  let portalUsdAfterIssue: any = null;

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
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

  /** EQ 2종 → 승인요청 → 관리자 승인 → 생산 시작·완료. 원발주와 회차가 같은 손놀림이다. */
  const runEqToProduced = async (specId: number, poId: number, tag: string): Promise<void> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-${tag}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${tag} ${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    for (const [path, tk] of [
      [`/api/partner/pcb-pos/${String(poId)}/eq-request`, P],
      [`/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}/eq-approve`, A],
      [`/api/partner/pcb-pos/${String(poId)}/production-start`, P],
      [`/api/partner/pcb-pos/${String(poId)}/production-complete`, P],
    ] as const) {
      const r = await api(tk, 'POST', path, {});
      expect(r.status, `${tag} ${path}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  };

  const uploadInvoice = async (poId: number, fileName: string): Promise<void> => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/shipment/files`,
      { fileType: 'invoice' },
      fileName,
      pdf,
      'application/pdf',
    );
    expect(up.status, `invoice(${fileName}): ${JSON.stringify(up.json)}`).toBe(200);
  };

  /** 발주서 → 소속 선적 문서(대표·구성 포함). 어서션이 "대표가 누구인가"부터 묻기 때문에 공용화. */
  const boxOf = async (
    poId: number,
  ): Promise<{ id: string; repPoId: string; specId: string; mode: string; dest: string | null; size: number }> => {
    const prisma = getPrisma();
    const link = await prisma.spPcbShipmentPo.findUnique({ where: { poId: BigInt(poId) } });
    expect(link, `발주 #${String(poId)} 선적 멤버십`).toBeTruthy();
    const ship = await prisma.spPcbShipment.findUnique({ where: { id: link.shipmentId } });
    const size = await prisma.spPcbShipmentPo.count({ where: { shipmentId: link.shipmentId } });
    return {
      id: String(ship.id),
      repPoId: String(ship.poId),
      specId: String(ship.specId),
      mode: String(ship.mode),
      dest: ship.destinationCountry === null ? null : String(ship.destinationCountry),
      size,
    };
  };

  /** 협력2 보내기 보드 — 이 주행이 만든 박스만 골라 본다(공유 DB의 남의 preparing 박스 배제). */
  const myBoxes = async (): Promise<any[]> => {
    const board = await api(P, 'GET', '/api/partner/pcb-shipments');
    expect(board.status, `보드: ${JSON.stringify(board.json)}`).toBe(200);
    const mine = [lane('A').poId, lane('B').poId, lane('C').poId, poCPrime, poAPrime].filter(
      (v): v is number => v !== null,
    );
    return (board.json?.data?.boxes ?? []).filter((b: any) =>
      (b.groupPos ?? []).some((g: any) => mine.includes(g.poId)),
    );
  };

  /** 송금 워크큐(스펙 스코프 — q=specId 라 counts·소계가 이 스펙의 발주만 센다). */
  const queue = async (
    specId: number,
    tab: string,
  ): Promise<{ items: any[]; counts: any; byCurrency: any[] }> => {
    const r = await api(
      A,
      'GET',
      `/api/admin/pcb-remittances?tab=${tab}&q=${String(specId)}&page=1&pageSize=50`,
    );
    expect(r.status, `송금 워크큐(${tab}): ${JSON.stringify(r.json)}`).toBe(200);
    return {
      items: r.json?.data?.items ?? [],
      counts: r.json?.data?.counts ?? {},
      byCurrency: r.json?.data?.byCurrency ?? [],
    };
  };

  /** 협력사별 집계 한 줄(행 + USD 통화칸) — 다른 주행이 섞이므로 **델타**로만 판단. */
  const partnerAgg = async (): Promise<{ row: any; usd: any }> => {
    const r = await api(A, 'GET', '/api/admin/pcb-remittances/partners');
    expect(r.status, `협력사별 집계: ${JSON.stringify(r.json)}`).toBe(200);
    const row = (r.json?.data?.rows ?? []).find((x: any) => x.partnerId === num(p2.id));
    return { row, usd: row?.byCurrency?.find((c: any) => c.currency === 'USD') ?? null };
  };

  /** 협력사 포털 수금 현황(협력2 토큰). */
  const portal = async (): Promise<{ items: any[]; totals: any[] }> => {
    const r = await api(P, 'GET', '/api/partner/pcb-remittances');
    expect(r.status, `포털 수금: ${JSON.stringify(r.json)}`).toBe(200);
    return { items: r.json?.data?.items ?? [], totals: r.json?.data?.totals ?? [] };
  };

  /** A/S 케이스 한 바퀴(접수 → 수락 → 진행) → 회차 발주 id. */
  const runAsCase = async (
    specId: number,
    caseType: 'product_defect' | 'admin_fault',
    expectCharge: 'free' | 'paid',
    tag: string,
  ): Promise<{ caseId: number; poId: number; round: number }> => {
    const create = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/as-cases`, {
      targetPartnerId: num(p2.id),
      caseType,
      description: `[여정 11호 ${tag}] 조합 스트레스 A/S — 확인 후 정리 예정`,
    });
    expect(create.status, `${tag} 케이스 생성: ${JSON.stringify(create.json)}`).toBe(200);
    expect(create.json?.data?.asCase?.chargeType, `${tag} 과금 기본값`).toBe(expectCharge);
    const caseId: number = create.json?.data?.asCase?.id;
    ledger.push(`sp_pcb_as_case #${String(caseId)} (spec ${String(specId)} — ${expectCharge})`);

    const submit = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/submit`, {});
    expect(submit.status, `${tag} 접수: ${JSON.stringify(submit.json)}`).toBe(200);
    const accept = await api(P, 'POST', `/api/partner/pcb-as-cases/${String(caseId)}/accept`, {
      reason: `[여정 11호 ${tag}] 재생산 가능`,
    });
    expect(accept.status, `${tag} 수락: ${JSON.stringify(accept.json)}`).toBe(200);
    const proceed = await api(A, 'POST', `/api/admin/pcb-as-cases/${String(caseId)}/proceed`, {});
    expect(proceed.status, `${tag} 진행: ${JSON.stringify(proceed.json)}`).toBe(200);
    const poId: number = proceed.json?.data?.poId;
    const round: number = proceed.json?.data?.reorderRound;
    expect(poId, `${tag} 회차 발주`).toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)} (협력2 — A/S ${String(round)}차 ${expectCharge})`);
    return { caseId, poId, round };
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();

    p2 = await getPartner(PARTNER_NAME);
    if (p2.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    // 국제 판정 전제(발송자 CN ≠ 받는측 KR) — 깨지면 ①의 박스가 국제가 아니게 된다.
    expect(p2.country, `${PARTNER_NAME} 국가(국제·직송 파생 전제)`).not.toBe('KR');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7200 });
    P = signJwt({ mbId: p2.mbId, ttlSec: 7200 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: p2.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('X1. 준비 — 거버 3건 → 확정가 → 주문·입금 → 협력2 발주 3건(A·B·C)', async () => {
    for (const l of lanes) {
      l.specId = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 11호-${l.label}] 조합 스트레스 — 확인 후 정리 예정`,
        prefix: `X01-${l.label}`,
      });
      ledger.push(`sp_order_spec #${String(l.specId)} (${l.label})`);

      // 확정가는 RFQ 없이 직접(6호 prepPaidSpec 관례) — 이 여정의 관심사는 발주 뒤다.
      const price = await api(A, 'PATCH', `/api/admin/pcb-projects/${String(l.specId)}/price`, {
        finalPrice: 60_000,
      });
      expect(price.status, `${l.label} 확정가: ${JSON.stringify(price.json)}`).toBe(200);

      const order = await placeOrderFromQuotes(customer, rp, {
        specId: l.specId,
        step: 'X1',
        prefix: `X01-${l.label}`,
        buyerName: 'e2e조합고객',
      });
      l.odId = order.odId;
      ledger.push(`g5_shop_order od_id=${order.odId} (${l.label})`);

      const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [order.odId],
        sendMail: false,
        sendSms: false,
      });
      expect(paid.status, `${l.label} 입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

      // 수동 발주(외화라 회계 환율 명시) — 직송지 없음. 셋 다 같은 조건이라야 키의 나머지
      // 두 축(직송지·회차)만 남는다.
      const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(l.specId)}/pos`, {
        partnerId: num(p2.id),
        priceOriginal: PO_USD,
        exchangeRate: PO_RATE,
      });
      expect(issue.status, `${l.label} 발주: ${JSON.stringify(issue.json)}`).toBe(200);
      l.poId = (issue.json?.data?.pos ?? []).find((x: any) => x.partnerId === num(p2.id))?.poId ?? null;
      expect(l.poId, `${l.label} 발주서`).not.toBeNull();
      ledger.push(`sp_pcb_po #${String(l.poId)} (협력2 — ${l.label} round 0)`);
    }
    // 세 레인이 실제로 갈라져 있어야 이후 전 단계가 성립한다.
    expect(new Set(lanes.map((l) => l.specId)).size, '스펙 3건 분리').toBe(3);
    expect(new Set(lanes.map((l) => l.odId)).size, '주문 3건 분리').toBe(3);

    // 돈 축 기준점 — A/S 회차가 서기 전의 모수(무상 제외 여부는 이 델타로 판정한다).
    aggAfterIssue = await partnerAgg();
    expect(aggAfterIssue.usd, '협력2 USD 집계 행').toBeTruthy();
    portalUsdAfterIssue = (await portal()).totals.find((t: any) => t.currency === 'USD');
    expect(portalUsdAfterIssue, '포털 USD 총계 행').toBeTruthy();
    F('X1', 'obs', `준비 완료 — ${lanes.map((l) => `${l.label}:po${String(l.poId)}`).join(' ')}`);
  }, 1_200_000);

  test('X2. 회차 0 묶음 — A·B 생산완료 → 한 박스(`admin:0:-:r0`)로 합류', async (ctx) => {
    if (lanes.some((l) => l.poId === null)) return ctx.skip();
    for (const label of ['A', 'B']) {
      const l = lane(label);
      await runEqToProduced(l.specId ?? 0, l.poId ?? 0, `r0-${label}`);
      const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: l.poId });
      expect(box.status, `${label} 담기: ${JSON.stringify(box.json)}`).toBe(200);
    }
    const a = await boxOf(lane('A').poId ?? 0);
    const b = await boxOf(lane('B').poId ?? 0);
    expect(b.id, 'A·B 한 박스(받는측·회차·직송지 동일)').toBe(a.id);
    expect(a.size, '박스 구성 2건').toBe(2);
    expect(a.mode, 'CN → KR 국제').toBe('international');
    expect(a.dest, '직송 아님').toBeNull();
    // 함정 — 합류 판정은 대표 기준이다. 먼저 담은 A 가 대표이고, 이후 어서션의 기준점이다.
    expect(a.repPoId, '대표 = 먼저 담은 A').toBe(String(lane('A').poId));
    box0Id = a.id;
    ledger.push(`sp_pcb_shipment #${box0Id} (r0 묶음 — A+B)`);

    const boxes = await myBoxes();
    expect(boxes.map((x: any) => x.contextKey), 'r0 컨텍스트 키').toContain('admin:0:-:r0');
    expect(boxes.length, '이 시점의 내 박스는 하나').toBe(1);
    F('X2', 'obs', `r0 묶음 박스 #${box0Id} — 대표 po${String(lane('A').poId)} · 구성 2건 · admin:0:-:r0`);
  }, 300_000);

  test('X3. 회차 축이 **가른다** — C 무상 A/S → C′(r1) 은 r0 박스에 못 들어간다', async (ctx) => {
    if (box0Id === null) return ctx.skip();
    const specC = lane('C').specId ?? 0;
    const cand = await api(A, 'GET', `/api/admin/pcb-projects/${String(specC)}/as-candidates`);
    expect(cand.status, JSON.stringify(cand.json)).toBe(200);
    const c = (cand.json?.data?.candidates ?? []).find((x: any) => x.partnerId === num(p2.id));
    expect(c?.poId, 'A/S 후보의 근거 발주 = C(round 0)').toBe(lane('C').poId);

    const as = await runAsCase(specC, 'product_defect', 'free', 'C');
    caseCId = as.caseId;
    poCPrime = as.poId;
    expect(as.round, 'C 1차 회차 채번').toBe(1);

    // proceed 복사 규약 — 직송지도 복사된다(원발주가 null 이라 여기서도 null).
    // S4(X5)가 "복사 후 수정"이어야 하는 이유가 이 줄이다.
    const prisma = getPrisma();
    const cp = await prisma.spPcbPo.findUnique({ where: { id: BigInt(poCPrime) } });
    expect(cp?.reorderRound, '회차 1').toBe(1);
    expect(cp?.destinationCountry, '직송지 복사(원발주 null → 회차도 null)').toBeNull();
    expect(cp?.deliveryDate, '납기만 비운다').toBeNull();
    expect(Number(cp?.priceOriginal), '발주가 복사').toBe(PO_USD);

    await runEqToProduced(specC, poCPrime, 'r1-C');
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: poCPrime });
    expect(box.status, `C′ 담기: ${JSON.stringify(box.json)}`).toBe(200);

    const cbox = await boxOf(poCPrime);
    expect(cbox.id, '회차 축 분리 — r0 박스에 합류하지 않는다').not.toBe(box0Id);
    expect(cbox.size, '새 박스 구성 1건').toBe(1);
    expect(cbox.repPoId, '새 박스 대표 = C′').toBe(String(poCPrime));
    expect(cbox.mode, 'CN → KR 국제').toBe('international');
    box1Id = cbox.id;
    ledger.push(`sp_pcb_shipment #${box1Id} (r1 박스 — C′ 로 생성)`);

    const keys = (await myBoxes()).map((x: any) => x.contextKey);
    expect(keys, 'r0 키 유지').toContain('admin:0:-:r0');
    expect(keys, 'r1 키 신설').toContain('admin:0:-:r1');
    F(
      'X3',
      'obs',
      `회차 축 분리 실증 — 같은 받는측·같은 직송지(null)인데 :r0(#${box0Id}) ≠ :r1(#${box1Id})`,
    );
  }, 300_000);

  test('X4. 회차 축이 **묶는다** — A 유상 A/S → A′(r1) 이 C′ 의 박스로 합류(스펙이 달라도)', async (ctx) => {
    if (box1Id === null) return ctx.skip();
    const specA = lane('A').specId ?? 0;
    const as = await runAsCase(specA, 'admin_fault', 'paid', 'A');
    caseAId = as.caseId;
    poAPrime = as.poId;
    expect(as.round, 'A 1차 회차 채번(스펙마다 독립)').toBe(1);

    await runEqToProduced(specA, poAPrime, 'r1-A');
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: poAPrime });
    expect(box.status, `A′ 담기: ${JSON.stringify(box.json)}`).toBe(200);

    const abox = await boxOf(poAPrime);
    // 회차 축은 가르기만 하는 게 아니다 — **같은 회차·같은 받는측**이면 스펙(고객 Case)이
    // 달라도 한 박스로 묶는다. 키에 스펙 축이 없다는 설계의 회차판 실증.
    expect(abox.id, 'A′ 와 C′ 는 같은 r1 박스').toBe(box1Id);
    expect(abox.size, 'r1 박스 구성 2건').toBe(2);
    expect(abox.repPoId, '대표는 먼저 담은 C′ 유지').toBe(String(poCPrime));
    expect(abox.specId, '발송 문서의 specId 는 대표(C)의 것').toBe(String(lane('C').specId));

    const boxes = await myBoxes();
    expect(boxes.length, '내 박스 2개(r0·r1)').toBe(2);
    const r1 = boxes.find((x: any) => x.contextKey === 'admin:0:-:r1');
    expect(r1?.groupPos?.length, 'r1 박스에 2건 담김').toBe(2);
    F(
      'X4',
      'obs',
      `회차 축 합류 실증 — 스펙 ${String(lane('C').specId)}(C′)·${String(specA)}(A′) 가 ` +
        `한 박스 #${box1Id}(admin:0:-:r1) · 대표 C′ 유지`,
    );
  }, 300_000);

  test('X5. 직송 × 회차 — C′ 직송 CN 지정: 409 IN_SHIPMENT → detach(대표 승계) → 변경 → 별도 박스', async (ctx) => {
    if (box1Id === null || poCPrime === null || poAPrime === null) return ctx.skip();
    const specC = lane('C').specId ?? 0;

    // ① 잠김 — 담긴 발주의 직송지 변경은 재작업 가드 W8(문서와 실물 경로가 갈라진다).
    const locked = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(specC)}/pos/${String(poCPrime)}`,
      { destinationCountry: 'CN' },
    );
    expect(locked.status, `담긴 발주 직송지 변경: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '재작업 가드 W8').toBe('IN_SHIPMENT');
    expect(String(locked.json?.message ?? ''), '정리 안내 문구').toContain('발송을 정리한 뒤');

    // ② 정리 — 박스에서 꺼낸다. C′ 는 대표라 남은 A′ 가 대표를 승계하고 발송의 specId 도 따라간다.
    const detach = await api(P, 'DELETE', `/api/partner/pcb-pos/${String(poCPrime)}/shipment/membership`);
    expect(detach.status, `detach: ${JSON.stringify(detach.json)}`).toBe(200);
    const afterDetach = await boxOf(poAPrime);
    expect(afterDetach.id, '남은 박스는 그대로').toBe(box1Id);
    expect(afterDetach.size, '구성 1건으로').toBe(1);
    expect(afterDetach.repPoId, '대표 승계 — A′').toBe(String(poAPrime));
    expect(afterDetach.specId, '발송 specId 도 상속인 따라 이동').toBe(String(lane('A').specId));

    // ③ 열림 — 이제 직송지를 바꿀 수 있다(생산완료 상태여도 가격이 아니라 조건이라 통과).
    const open = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(specC)}/pos/${String(poCPrime)}`,
      { destinationCountry: 'CN' },
    );
    expect(open.status, `detach 후 직송지 변경: ${JSON.stringify(open.json)}`).toBe(200);
    const prisma = getPrisma();
    const cp = await prisma.spPcbPo.findUnique({ where: { id: BigInt(poCPrime) } });
    expect(String(cp?.destinationCountry), '직송지 CN 반영').toBe('CN');

    // ④ 재담기 — 같은 회차(r1)·같은 받는측인데 직송지가 달라 A′ 박스에 합류하지 못한다.
    const rebox = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: poCPrime });
    expect(rebox.status, `C′ 재담기: ${JSON.stringify(rebox.json)}`).toBe(200);
    const cbox = await boxOf(poCPrime);
    expect(cbox.id, '직송지 축 분리 — A′ 박스와 다른 박스').not.toBe(box1Id);
    expect(cbox.id, 'r0 박스와도 다르다').not.toBe(box0Id);
    expect(cbox.dest, '직송지 박제').toBe('CN');
    // 모드는 국적이 아니라 f(발송자국가, 직송지) — CN 발 CN 행이라 **비KR 국내**다.
    expect(cbox.mode, '협력2(CN) → 직송 CN = 국내').toBe('domestic');
    box2Id = cbox.id;
    ledger.push(`sp_pcb_shipment #${box2Id} (r1 직송 CN — 국내)`);

    // 최종 — 키의 두 축이 만든 세 칸이 동시에 서 있다.
    const keys = (await myBoxes()).map((x: any) => x.contextKey).sort();
    expect(keys, '세 박스의 contextKey').toEqual(['admin:0:-:r0', 'admin:0:-:r1', 'admin:0:CN:r1']);
    F(
      'X5',
      'obs',
      `키 두 축 동시 작동 — admin:0:-:r0(#${box0Id} A+B) · admin:0:-:r1(#${box1Id} A′) · ` +
        `admin:0:CN:r1(#${box2Id} C′ 직송). 순환 잠김(409 IN_SHIPMENT)→detach(대표 승계)→변경→재담기 완주.`,
    );
  }, 180_000);

  test('X6. 돈 축 교차 — 무상 C′ 제외 · 유상 A′ 포함(판정 축은 박스가 아니라 발주)', async (ctx) => {
    if (poCPrime === null || poAPrime === null || aggAfterIssue === null) return ctx.skip();
    const specA = lane('A').specId ?? 0;
    const specC = lane('C').specId ?? 0;

    // ── 유상 회차(A′) — 묶음 박스에 담긴 채로도 지급 축에 그대로 선다.
    const aAll = await queue(specA, 'all');
    const rA0 = aAll.items.find((x: any) => x.poId === lane('A').poId);
    const rA1 = aAll.items.find((x: any) => x.poId === poAPrime);
    expect(rA0, '원발주 A 행').toBeTruthy();
    expect(rA1, '유상 회차 A′ 행').toBeTruthy();
    expect(rA1.isFreeAs, 'A′ 는 유상').toBe(false);
    expect(rA1.reorderRound, 'A′ 회차 1').toBe(1);
    expect(rA1.summary.balance, '유상 회차 잔액이 산다').toBe(PO_USD);
    expect(aAll.byCurrency, '스펙 A 소계 — 두 발주 모두 모수').toEqual([
      { currency: 'USD', poAmount: PO_USD * 2, paidAmount: 0, balance: PO_USD * 2, poCount: 2 },
    ]);
    const aPending = await queue(specA, 'pending');
    expect(aPending.items.map((x: any) => x.poId), '유상 회차도 지급 대기 큐에').toContain(poAPrime);

    // ── 무상 회차(C′) — 직송 박스로 갈라져 나갔어도 판정은 chargeType 하나다.
    const cAll = await queue(specC, 'all');
    const rC1 = cAll.items.find((x: any) => x.poId === poCPrime);
    expect(rC1, '무상 회차 C′ 행(전체 탭엔 보인다)').toBeTruthy();
    expect(rC1.isFreeAs, 'C′ 는 무상').toBe(true);
    expect(rC1.reorderRound, 'C′ 회차 1').toBe(1);
    expect(rC1.summary.poAmount, '발주가는 사실 그대로').toBe(PO_USD);
    expect(rC1.summary.balance, '무상 회차 잔액 0(지급 대상 아님)').toBe(0);
    expect(cAll.byCurrency, '스펙 C 소계 — 무상 회차 제외').toEqual([
      { currency: 'USD', poAmount: PO_USD, paidAmount: 0, balance: PO_USD, poCount: 1 },
    ]);
    for (const tab of ['pending', 'partial', 'done'] as const) {
      const q = await queue(specC, tab);
      expect(q.items.map((x: any) => x.poId), `무상 회차 ${tab} 탭 제외`).not.toContain(poCPrime);
    }

    // ── 협력사별 집계 — 회차 2건이 섰는데 모수는 유상 1건만 늘어야 한다.
    const agg = await partnerAgg();
    expect(agg.usd.poCount - aggAfterIssue.usd.poCount, '집계 발주 수 델타(+유상 1건만)').toBe(1);
    expect(agg.usd.poAmount - aggAfterIssue.usd.poAmount, '집계 발주가 델타').toBe(PO_USD);
    expect(agg.usd.balance - aggAfterIssue.usd.balance, '집계 잔액 델타').toBe(PO_USD);
    expect(agg.row.krwPoAmount - aggAfterIssue.row.krwPoAmount, 'KRW 환산 델타(무상 미편입)').toBe(
      PO_USD * PO_RATE,
    );

    // ── 포털 수금 — 같은 규율. 행은 보이되 총계 모수에서 빠진다.
    const p = await portal();
    const pC1 = p.items.find((x: any) => x.poId === poCPrime);
    const pA1 = p.items.find((x: any) => x.poId === poAPrime);
    expect(pC1?.isFreeAs, '포털 무상 배지').toBe(true);
    expect(pC1?.summary?.balance, '포털 무상 미수 0').toBe(0);
    expect(pC1?.remittances, '무상 회차엔 입금 내역 없음').toEqual([]);
    expect(pA1?.isFreeAs, '포털 유상 회차').toBe(false);
    expect(pA1?.summary?.balance, '포털 유상 미수').toBe(PO_USD);
    const usdTotal = p.totals.find((t: any) => t.currency === 'USD');
    expect(usdTotal.poCount - portalUsdAfterIssue.poCount, '포털 총계 발주 수 델타').toBe(1);
    expect(usdTotal.poAmount - portalUsdAfterIssue.poAmount, '포털 총계 발주가 델타').toBe(PO_USD);
    F(
      'X6',
      'obs',
      `돈 축은 박스를 안 본다 — 유상 A′(묶음 박스 #${String(box1Id)})는 대기 큐·집계·포털에 ` +
        `+$${String(PO_USD)}, 무상 C′(직송 박스 #${String(box2Id)})는 세 창구 전부 제외(잔액 0·모수 불변).`,
    );
  }, 180_000);

  test('X7. 화면 — 선적 큐(묶음·회차·직송 동시 표기) · Case 회차 접힘 · 포털 3박스', async (ctx) => {
    if (box2Id === null) return ctx.skip();
    // ── 관리자 선적 큐: 기본 탭은 '발송 대기'(발주서 축)라 선적 문서를 보려면 '전체'로 옮긴다.
    await view(adminView, '/app/admin/pcb/shipments', 'X07-admin-ship-default');
    await adminView.page.getByRole('button', { name: /^전체/ }).first().click();
    await adminView.page.waitForLoadState('networkidle').catch(() => undefined);
    await adminView.page
      .getByText(`SH-${box2Id}`, { exact: false })
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await shot(adminView, 'X07-admin-ship-queue-all');
    const queueBody: string = await adminView.page.evaluate(() => document.body.innerText);
    // 세 배지가 **한 화면에** 동시에 서는지 — 여기가 11호의 화면 몫이다.
    expect(queueBody, '묶음 배지(r0 박스 2건)').toContain('묶음 2');
    expect(queueBody, 'A/S 회차 배지').toContain('1차');
    expect(queueBody, '직송 배지').toContain('직송 CN');
    // 묶음 구성 링크(동반 건) — 대표만 보이면 동반 스펙이 큐에서 사라진다(9호 교정 회귀선).
    expect(queueBody, '묶음 동반 건 링크(+Q…)').toContain(`+ Q${String(lane('B').specId)}`);

    // ── Case 상세(스펙 A): 회차가 둘이라 이전 회차가 접힌 채로 서야 한다.
    await view(adminView, `/app/admin/pcb/cases/${String(lane('A').specId)}`, 'X07-admin-case-rounds');
    const caseBody: string = await adminView.page.evaluate(() => document.body.innerText);
    if (/이전 회차 발주·견적/.test(caseBody)) {
      F('X7', 'obs', 'Case 상세 — 이전 회차 접힘 토글 노출 확인');
    } else {
      F('X7', 'ux', 'Case 상세에서 이전 회차 접힘 토글 미검출 — 스크린샷 확인 필요');
    }
    expect(caseBody, 'Case 상세 A/S 재발주 패널').toContain('A/S 재발주');

    // ── 포털 보드: 박스가 회차·직송지로 세 칸으로 갈린 상태.
    await view(partnerView, '/app/partner/pcb/ship', 'X07-portal-three-boxes');
    const boardBody: string = await partnerView.page.evaluate(() => document.body.innerText);
    expect(boardBody, '포털 박스에 직송 CN 표기').toContain('직송 CN');
    expect(boardBody, 'r0 묶음 박스 구성 표기').toContain('2건 담김');
    expect((await myBoxes()).length, '포털 보드 내 박스 3개').toBe(3);

    // ⚠ 현재 동작 박제(고치지 않는다) — 박스 헤더는 받는곳·모드·건수만 낸다. 직송지는
    //   실리지만(`· 직송 CN`) **회차는 안 실린다**: r0 박스와 r1 박스의 헤더가
    //   '→ SamplePCB · 국외 발송' 으로 글자까지 같아, 협력사는 화면만 보고 "왜 두 박스로
    //   갈렸는지" 알 수 없다. 회차 배지('A/S N회차')는 선반 항목에만 있고 박스 안에는 없다
    //   (apps/web/src/pages/partner/PartnerPcbShip.vue:118 선반 vs 185~200 박스).
    //   지금은 선반이 비어 있으므로 보드 전체에 'A/S' 문자열이 없는 것이 그 증거다.
    expect(boardBody.includes('A/S'), '포털 박스에 회차 표기 없음(현재 동작 박제)').toBe(false);
    F(
      'X7',
      'ux',
      '포털 보드 — r0 박스와 r1 박스의 헤더가 동일("→ SamplePCB · 국외 발송")해 회차로 갈린 ' +
        '이유가 화면에 없다. 직송지는 헤더에 실리는데(`· 직송 CN`) 회차는 선반 배지에만 있다 ' +
        '(PartnerPcbShip.vue:118 vs 185~200). 관찰만 하고 고치지 않음.',
    );
    F('X7', 'obs', '선적 큐에 묶음·회차·직송 배지 동시 표기 · 포털 3박스 확인');
  }, 240_000);

  test('X8. 완주 — r0 묶음 박스 국제 6단계+입고확인 · 회차 박스 2개는 각 1칸 전이', async (ctx) => {
    if (box0Id === null || box1Id === null || box2Id === null) return ctx.skip();
    const prisma = getPrisma();

    // ── ① 직송 박스(국내 CN→CN): Invoice 불요, 배송 중 한 칸.
    const cnAdv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poCPrime)}/shipment/advance`, {
      carrier: 'SF Express',
      trackingNumber: 'COMBO-CN-0811',
    });
    expect(cnAdv.status, `직송 박스 전이: ${JSON.stringify(cnAdv.json)}`).toBe(200);
    const s2 = await prisma.spPcbShipment.findUnique({ where: { id: BigInt(box2Id) } });
    expect(String(s2?.status), '국내 체인 한 칸(배송 중)').toBe('shipping');

    // ── ② 회차 박스(국제, 대표 A′): Invoice 첨부 후 선적요청 한 칸.
    await uploadInvoice(poAPrime ?? 0, 'invoice-combo-r1.pdf');
    const r1Adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poAPrime)}/shipment/advance`, {
      shipDate: '2026-08-14',
    });
    expect(r1Adv.status, `회차 박스 선적요청: ${JSON.stringify(r1Adv.json)}`).toBe(200);
    const s1 = await prisma.spPcbShipment.findUnique({ where: { id: BigInt(box1Id) } });
    expect(String(s1?.status), '국제 체인 한 칸(선적요청)').toBe('requested');

    // ── ③ r0 묶음 박스: 국제 6단계 완주 + 입고확인 1회(대표 A 로 전이 — 동반 B 도 함께 간다).
    const repPoId = lane('A').poId ?? 0;
    const repSpec = lane('A').specId ?? 0;
    await uploadInvoice(repPoId, 'invoice-combo-r0-batch.pdf');
    const r0Req = await api(P, 'POST', `/api/partner/pcb-pos/${String(repPoId)}/shipment/advance`, {
      shipDate: '2026-08-12',
    });
    expect(r0Req.status, `묶음 선적요청: ${JSON.stringify(r0Req.json)}`).toBe(200);
    for (let i = 0; i < 6; i += 1) {
      const adv = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(repSpec)}/pos/${String(repPoId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: 'COMBO-R0-0811', trackingUrl: null },
      );
      if (adv.status !== 200) {
        expect(adv.json?.error, `묶음 체인 중단: ${JSON.stringify(adv.json)}`).toBe('ALREADY_FINAL');
        break;
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(repSpec)}/pos/${String(repPoId)}/shipment/receive`,
      { note: '[여정 11호] r0 묶음 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);
    const s0 = await prisma.spPcbShipment.findUnique({ where: { id: BigInt(box0Id) } });
    expect(s0?.receivedAt, '묶음 입고 시각').not.toBeNull();
    // 회차 박스들은 원발주 전이에 흔들리지 않는다(축 분리의 종점 확인).
    expect(String(s1?.status), '회차 박스 무간섭').toBe('requested');

    // ── 고객 배송 큐 — 묶음이라 두 주문이 함께 서고, A 는 회차가 미입고라 부분 입고로 보인다.
    const q = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=100');
    expect(q.status, JSON.stringify(q.json)).toBe(200);
    const items = q.json?.data?.items ?? [];
    const rowA = items.find((x: any) => x.odId === lane('A').odId);
    const rowB = items.find((x: any) => x.odId === lane('B').odId);
    expect(rowA, 'A 주문 배송 대기 진입').toBeTruthy();
    expect(rowB, 'B 주문 배송 대기 진입(묶음 cross-spec 조인)').toBeTruthy();
    // 회차가 얹힌 스펙은 발주가 2건이라 '입고 1/2' 로 보인다 — 회차 축이 큐 표기에 비치는 지점.
    expect(rowA.poCount, 'A 스펙 발주 수(원발주+회차)').toBe(2);
    expect(rowA.receivedPoCount, 'A 입고 수(원발주만)').toBe(1);
    expect(rowB.poCount, 'B 스펙 발주 수').toBe(1);
    expect(rowB.receivedPoCount, 'B 입고 수').toBe(1);
    expect(rowA.directShipCountry, 'A 는 직송 아님').toBeNull();
    F(
      'X8',
      'obs',
      `완주 — r0 묶음 #${box0Id} done·입고확인(주문 2건 배송 대기, A 는 회차 미입고라 1/2) · ` +
        `r1 국제 #${box1Id} requested · r1 직송 CN #${box2Id} shipping`,
    );
  }, 300_000);

  test('X9. 교차의 잔상(박제) — 회차 발주의 직송지가 원주문의 종결 동선을 뒤집는다', async (ctx) => {
    if (box0Id === null) return ctx.skip();
    const specB = lane('B').specId ?? 0;
    const odB = lane('B').odId ?? '';

    // 전제 확인 — B 는 원발주가 KR 로 실제 입고됐고(X8), 지금은 정상 배송 동선이다.
    const before = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(odB)}&page=1&pageSize=5`,
    );
    const beforeRow = (before.json?.data?.items ?? []).find((x: any) => x.odId === odB);
    expect(beforeRow?.directShipCountry, '입고 직후 — 직송 아님(정상 [배송 처리])').toBeNull();

    // B 에 A/S 회차를 세우고 그 회차에만 직송지를 준다(담기 전이라 가드 없이 200).
    const as = await runAsCase(specB, 'admin_fault', 'paid', 'B');
    const patch = await api(
      A,
      'PATCH',
      `/api/admin/pcb-projects/${String(specB)}/pos/${String(as.poId)}`,
      { destinationCountry: 'CN' },
    );
    expect(patch.status, `회차 발주 직송지 지정: ${JSON.stringify(patch.json)}`).toBe(200);

    const after = await api(
      A,
      'GET',
      `/api/admin/pcb-orders?tab=to_ship&q=${encodeURIComponent(odB)}&page=1&pageSize=5`,
    );
    const afterRow = (after.json?.data?.items ?? []).find((x: any) => x.odId === odB);
    expect(afterRow, 'B 주문 배송 대기 유지').toBeTruthy();

    // ⚠ 현재 동작 박제 — 고치지 않는다(관찰 전용).
    //   판정 축이 '최상위·**최신 회차** 발주의 직송지'(routes/admin-pcb-orders.ts
    //   directShipPoBySpec)라, 원발주가 KR 로 입고된 주문인데도 회차의 직송지가 행을
    //   '직송 CN' 으로 뒤집고 종결 버튼이 [배송 처리] → [직송 완료](운송장 없이 완료)로 바뀐다.
    //   실물은 자사 창고에 있는데 "현지에서 수령했다"로 닫히는 경로가 열린다.
    if (afterRow?.directShipCountry === 'CN') {
      F(
        'X9',
        'bug',
        `회차 직송지가 원주문 종결 동선을 뒤집는다 — od=${odB} 는 원발주(round 0)가 ` +
          `KR 입고 완료인데, 회차 발주 #${String(as.poId)} 에 직송 CN 을 주자 배송 큐 행이 ` +
          `directShipCountry='CN' 으로 바뀌었다. 화면은 [직송 완료](운송장 없이 완료 종결)를 낸다. ` +
          `판정 축: apps/api/src/routes/admin-pcb-orders.ts:56-66 (directShipPoBySpec — 최신 회차 우선). ` +
          `실물은 자사 입고 상태라 오종결 경로. 관찰만 하고 고치지 않음(현재 동작 박제).`,
      );
      await view(adminView, '/app/admin/pcb/shipments', 'X09-order-direct-flip');
      const body: string = await adminView.page.evaluate(() => document.body.innerText);
      if (/직송 완료/.test(body)) F('X9', 'obs', '화면에서도 [직송 완료] 버튼으로 바뀐 것 확인');
      await shot(adminView, 'X09-order-direct-flip-shot');
    } else {
      F(
        'X9',
        'obs',
        `회차 직송지가 원주문 배송 큐에 전파되지 않음(directShipCountry=` +
          `${String(afterRow?.directShipCountry)}) — 교차 오판 없음`,
      );
    }
    expect(afterRow.directShipCountry, '현재 동작 박제(교정 시 이 줄이 먼저 깨진다)').toBe('CN');
    F('X9', 'obs', `케이스 요약 — caseA=${String(caseAId)} caseC=${String(caseCId)} caseB=${String(as.caseId)}`);
  }, 180_000);
});
