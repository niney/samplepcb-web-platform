// 여정 10호 — **주문 취소·부분 취소**(고객 축). 지금까지의 아홉 여정은 모두 "주문은 앞으로만
// 간다"를 전제했다. 이 여정만 **거꾸로 가는 주문**을 밟는다.
//
// 미검증 영역이 둘이었다.
//   ① **1주문 = 1스펙** — 3호·9호는 주문이 둘이어도 주문서가 둘이었다. 견적관리에서 여러 건을
//      함께 체크해 **한 주문서에 카트 n 줄**을 만드는 경로(quotes.php → POST /api/pcb-projects/
//      order 의 ids 배열 → 한 번의 ct_select)는 한 번도 안 밟혔다. 부분 취소는 그 조합이
//      있어야만 성립하므로 이 여정이 그 길을 처음 낸다.
//   ② **부분 취소가 협력 트랙에 어떻게 비치는가** — 첫 주행(08-11)의 답은 "전혀 비치지 않는다"
//      였다: 가드가 **od_status='취소'** 하나만 봐서, 부분 취소(od 는 '입금')면 담기·EQ 전진·
//      A/S 접수가 모두 200 으로 통과했다. 취소된 보드가 계속 생산돼 박스에 담길 수 있었다는 뜻이다.
//      **교정 후(같은 날)** 판정 축이 둘이 됐다 — 주문 헤더 '취소' **또는** 그 줄 ct_status 가
//      취소류(isPcbOrderLineCanceled, lib/pcb-shipment.ts). 이 스펙은 이제 그 가드의 회귀선이다:
//      X6 이 다시 200 이 되면 부분 취소가 새어 나간 것이다.
//
// 대조 구조가 이 여정의 골격이다: **같은 3종 프로브**(EQ 전진 · 발송 담기 · A/S 접수)를
// **부분 취소(X6)** 와 **전량 취소(X11)** 에 각각 쳐서, ORDER_CANCELED 가드가 양쪽에서
// 똑같이 서는지를 나란히 세운다. 정리 경로(EQ 되돌리기)는 양쪽 모두 200 이어야 한다 —
// 가드가 정리까지 막으면 취소 뒷정리(발주 취소·재고 해제)가 통째로 죽는다.
//
// 실행: pnpm -F e2e journey:cancel  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 사전 조건: nginx·API(3333)·웹(5173)·거버(GERBER_URL)·Mailpit + e2e/.env.e2e 고객 자격.
// 생성물은 자동 정리하지 않는다(대장 → cleanup-probe.mts, e2e-customer 축 훑기).
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
const PARTNER_NAME = '협력2'; // CN — 관리자행이라 국제(Invoice 필수) 경로가 된다(3호와 동일)
/** 주행마다 갈리는 표식 — 같은 픽스처 zip 이라 프로젝트명이 겹치면 줄 구별이 안 된다. */
const RUN_TAG = String(Date.now()).slice(-6);

/** 한 카트 줄 — 견적(spec) 하나가 곧 주문서의 한 줄이다. */
interface Line {
  label: string;
  projectName: string;
  specId: number | null;
  rfqId: number | null;
  /** 담기 후 g5_shop_cart.ct_id — 부분 취소는 이 단위로 친다. */
  ctId: number | null;
  poId: number | null;
  price: number;
}

/** 협력 트랙 3종 프로브 결과 — 부분 취소(X6)와 전량 취소(X11)를 같은 잣대로 세운다. */
interface TrackProbe {
  box: { status: number; error: string };
  eqRevert: { status: number; error: string };
  eqAdvance: { status: number; error: string };
  asCase: { status: number; error: string; caseId: number | null };
}

const mkLine = (label: string, price: number): Line => ({
  label,
  projectName: `J10-${label}-${RUN_TAG}`,
  specId: null,
  rfqId: null,
  ctId: null,
  poId: null,
  price,
});

describe.skipIf(!RUN || !JOURNEY)('여정 10호 — 주문 취소·부분 취소(한 주문서 두 줄)', () => {
  const rp = createJourneyReport('findings-cancel', '여정 10호 주문 취소·부분 취소 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  // 주문 1 — 부분 취소 대상. A 를 취소하고 B 는 완주시킨다.
  const lineA = mkLine('A', 51_000); // 취소될 줄(EQ~생산완료까지 진행된 상태에서 취소)
  const lineB = mkLine('B', 52_000); // 살아남을 줄
  let od1: string | null = null;

  // 주문 2 — 전량 취소 대상(가드 대조군).
  const lineC = mkLine('C', 53_000); // 생산완료까지 — 담기 프로브가 성립하려면 produced 여야 한다
  const lineD = mkLine('D', 54_000);
  let od2: string | null = null;

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

  // ── g5 원장 조회(공유 DB — 읽기만) ─────────────────────────────────────────
  const cartRows = async (odId: string): Promise<any[]> =>
    getPrisma().$queryRawUnsafe(
      `SELECT ct_id, it_id, io_id, io_type, ct_qty, ct_status, ct_price, io_price, ct_stock_use, ct_point
         FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id`,
      odId,
    );

  const orderRow = async (odId: string): Promise<any> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_status, od_cart_price, od_cancel_price, od_misu, od_receipt_price,
              od_send_cost, od_settle_case, od_invoice, od_mod_history
         FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    return rows[0] ?? null;
  };

  const optionStock = async (itId: string, ioId: string): Promise<number> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT io_stock_qty FROM g5_shop_item_option WHERE it_id = ? AND io_id = ?`,
      itId,
      ioId,
    );
    return Number(rows[0]?.io_stock_qty ?? Number.NaN);
  };

  /** 스펙의 카트 줄(ct_id 는 담기 시점에 정해진다 — sp_order_spec.ctId 가 정본). */
  const loadCtId = async (specId: number): Promise<number | null> => {
    const spec = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(specId) } });
    return spec?.ctId ?? null;
  };

  const poStatus = async (poId: number): Promise<string> => {
    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    return po?.status ?? '(없음)';
  };

  /**
   * 고객 본인 토큰 — 로컬 서명(signJwt)엔 **cartId 클레임이 없다**. 재주문(POST
   * /api/pcb-projects/order)은 그 클레임을 세션 장바구니 키로 쓰므로(routes/pcb-projects.ts:571)
   * 서명 토큰으로는 NO_CART_ID 에서 먼저 끊겨 검증이 성립하지 않는다. 화면이 실제로 쓰는
   * 경로(/spcb/api/me 세션→JWT 브리지)를 고객 세션 안에서 그대로 불러 진짜 토큰을 얻는다.
   */
  const customerToken = async (): Promise<string> => {
    const token: string = await customer.page.evaluate(() =>
      fetch('/spcb/api/me', { credentials: 'include' })
        .then((r) => r.json())
        .then((m: any) => String(m.token ?? '')),
    );
    expect(token, '고객 세션 토큰(/spcb/api/me)').not.toBe('');
    return token;
  };

  /**
   * 주문 상세 '주문하신 상품' 표를 실측한다 — 취소 줄이 **화면에서 구별되고 보이는가**가
   * 부분 취소 UX 의 전부라, 텍스트가 DOM 에 있다는 것만으로는 검증이 안 된다.
   * 줄 이름(구별 가능성)과 상태 칸의 오른쪽 끝이 표 컨테이너 안에 들어오는지(가시성)를 잰다.
   * 여정 공용 가드 measureQuotesRowWidths 의 주문 상세판.
   */
  const measureOrderDetailLines = async (): Promise<{
    wrapRight: number;
    overflowX: string;
    rows: { name: string; status: string; statusRight: number }[];
  } | null> =>
    customer.page.evaluate(() => {
      const table = [...document.querySelectorAll('#sod_fin_list table')][0];
      if (table === undefined) return null;
      const wrap = table.parentElement as HTMLElement | null;
      return {
        wrapRight: wrap === null ? -1 : Math.round(wrap.getBoundingClientRect().right),
        overflowX: wrap === null ? '' : getComputedStyle(wrap).overflowX,
        rows: [...(table.querySelector('tbody')?.rows ?? [])].map((tr) => {
          const nameEl = tr.querySelector('.sod_name') as HTMLElement | null;
          const stEl = tr.querySelector('td[headers="th_itst"]') as HTMLElement | null;
          return {
            name: (nameEl?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
            status: (stEl?.textContent ?? '').trim(),
            statusRight: stEl === null ? -1 : Math.round(stEl.getBoundingClientRect().right),
          };
        }),
      };
    });

  const errOf = (r: { status: number; json: any }): string =>
    r.status === 200 ? '' : String(r.json?.error ?? `HTTP${String(r.status)}`);

  // ── 견적 한 건을 확정가까지(RFQ→회신→선정) ─────────────────────────────────
  const priceUp = async (line: Line, step: string): Promise<void> => {
    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(line.specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, `${line.label} RFQ: ${JSON.stringify(send.json)}`).toBe(200);
    const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id));
    expect(row, `${line.label} RFQ 행`).toBeTruthy();
    line.rfqId = row.rfqId;
    ledger.push(`sp_pcb_rfq #${String(line.rfqId)} (${line.label})`);

    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(line.rfqId)}`, {
      price: 300,
      quotedDeliveryDate: '2026-08-25',
      memo: `[여정 10호-${line.label}] 회신`,
    });
    expect(reply.status, `${line.label} 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    // 환율은 당일 수출입은행 캐시가 자동 적용된다(P4.7). 없으면 명시값 폴백.
    let sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(line.specId)}/rfqs/${String(line.rfqId)}/select`,
      { finalPrice: line.price },
    );
    if (sel.status === 400) {
      F(step, 'obs', `${line.label} 당일 환율 캐시 없음 — 명시 환율 폴백`);
      sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(line.specId)}/rfqs/${String(line.rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: line.price },
      );
    }
    expect(sel.status, `${line.label} 선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
  };

  /** 발주 발행 — 입금 뒤에만 성립한다(RFQ 게이트·미입금 가드). */
  const issuePo = async (line: Line): Promise<void> => {
    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(line.specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId: line.rfqId,
    });
    expect(issue.status, `${line.label} 발주: ${JSON.stringify(issue.json)}`).toBe(200);
    const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id));
    expect(po, `${line.label} 발주서 행`).toBeTruthy();
    line.poId = po.poId;
    ledger.push(`sp_pcb_po #${String(line.poId)} (${line.label})`);
  };

  /** EQ~생산완료 — 협력사가 첨부·요청, 관리자가 승인, 협력사가 생산 시작·완료. */
  const produce = async (line: Line): Promise<void> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(line.poId)}/eq-files`,
        { fileType },
        `${fileType}-${line.label}-${RUN_TAG}.zip`,
        bytes,
        'application/zip',
      );
      expect(up.status, `${line.label} ${fileType}: ${JSON.stringify(up.json)}`).toBe(200);
    }
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(line.poId)}/eq-request`, {});
    expect(req.status, `${line.label} 승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    const ap = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(line.specId)}/pos/${String(line.poId)}/eq-approve`,
      {},
    );
    expect(ap.status, `${line.label} EQ 승인: ${JSON.stringify(ap.json)}`).toBe(200);
    const st = await api(P, 'POST', `/api/partner/pcb-pos/${String(line.poId)}/production-start`, {});
    expect(st.status, `${line.label} 생산시작: ${JSON.stringify(st.json)}`).toBe(200);
    const done = await api(P, 'POST', `/api/partner/pcb-pos/${String(line.poId)}/production-complete`, {});
    expect(done.status, `${line.label} 생산완료: ${JSON.stringify(done.json)}`).toBe(200);
  };

  /**
   * 협력 트랙 3종 프로브 — **취소된 라인의 발주가 계속 갈 수 있는가**를 실제로 시도해 본다.
   * 순서가 곧 전제 조건이다: ① 담기(produced 여야 성립) → ② EQ 되돌리기(정리는 취소 주문에서도
   * 허용되어야 한다 — revert 에는 ORDER_CANCELED 가드가 없다) → ③ EQ 전진(여기가 EQ 가드의
   * 사정권) → ④ A/S 접수(createPcbAsCase 가드).
   * 부작용은 이 함수가 되돌린다 — 담긴 박스는 detach, A/S 초안은 삭제. 가드가 서면 담기·A/S 는
   * 애초에 아무것도 안 만들고, 전진만 막힌 발주는 되돌린 자리(producing)에 남는다.
   */
  const probeCollabTrack = async (line: Line, step: string): Promise<TrackProbe> => {
    const before = await poStatus(line.poId ?? 0);
    expect(before, `${line.label} 프로브 전제(생산완료)`).toBe('produced');

    // ① 발송 담기 — ensurePcbShipment(lib/pcb-shipment.ts:206)
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: line.poId });
    if (box.status === 200) {
      // 담겼다면 되돌린다 — 박스가 남으면 형제 줄의 발송에 합류해(같은 contextKey) 이후
      // 단계가 통째로 오염된다.
      const off = await api(P, 'DELETE', `/api/partner/pcb-pos/${String(line.poId)}/shipment/membership`);
      expect(off.status, `${line.label} 프로브 박스 되돌리기: ${JSON.stringify(off.json)}`).toBe(200);
    }

    // ② EQ 되돌리기(정리) — 전진 프로브를 세우려면 종점(produced)에서 한 칸 내려와야 한다.
    const eqRevert = await api(P, 'POST', `/api/partner/pcb-pos/${String(line.poId)}/eq-revert`, {});
    // ③ EQ 전진 — producing → produced
    const eqAdvance =
      eqRevert.status === 200
        ? await api(P, 'POST', `/api/partner/pcb-pos/${String(line.poId)}/production-complete`, {})
        : { status: -1, json: { error: 'REVERT_FAILED' } };

    // ④ A/S 접수 — createPcbAsCase
    const asCase = await api(A, 'POST', `/api/admin/pcb-projects/${String(line.specId)}/as-cases`, {
      targetPartnerId: num(partner.id),
      caseType: 'product_defect',
      description: `[여정 10호-${line.label}] 취소 라인 A/S 프로브 — 생성되면 즉시 삭제`,
    });
    let caseId: number | null = null;
    if (asCase.status === 200) {
      caseId = Number(asCase.json?.data?.asCase?.id ?? 0);
      const del = await api(A, 'DELETE', `/api/admin/pcb-as-cases/${String(caseId)}`);
      if (del.status !== 200) {
        ledger.push(`sp_pcb_as_case #${String(caseId)} (${line.label} 프로브 잔재 — 수동 삭제)`);
        F(step, 'obs', `${line.label} A/S 프로브 초안 삭제 실패(${String(del.status)}) — 대장에 올림`);
      }
    }

    const probe: TrackProbe = {
      box: { status: box.status, error: errOf(box) },
      eqRevert: { status: eqRevert.status, error: errOf(eqRevert) },
      eqAdvance: { status: eqAdvance.status, error: errOf(eqAdvance) },
      asCase: { status: asCase.status, error: errOf(asCase), caseId },
    };
    F(
      step,
      'obs',
      `${line.label} 협력 트랙 프로브 — 담기 ${String(probe.box.status)}${probe.box.error && ` ${probe.box.error}`} · ` +
        `EQ되돌리기 ${String(probe.eqRevert.status)}${probe.eqRevert.error && ` ${probe.eqRevert.error}`} · ` +
        `EQ전진 ${String(probe.eqAdvance.status)}${probe.eqAdvance.error && ` ${probe.eqAdvance.error}`} · ` +
        `A/S접수 ${String(probe.asCase.status)}${probe.asCase.error && ` ${probe.asCase.error}`}`,
    );
    return probe;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev');
    const creds = requireCustomerCreds();

    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    expect(partner.country, `${PARTNER_NAME} 국가(국제 경로 전제)`).not.toBe('KR');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
    partnerView = await newSession({ mbId: partner.mbId }, { partnerModule: 'pcb' });
    rp.watchHttp(partnerView, '파트너');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 파트너: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('X1. 고객: 거버 2건 업로드 → 견적요청 2건(한 주문서에 들어갈 두 줄)', async () => {
    const prisma = getPrisma();
    for (const line of [lineA, lineB]) {
      line.specId = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 10호-${line.label}] 취소 여정 — 확인 후 정리 예정`,
        prefix: `X01-${line.label}`,
      });
      ledger.push(`sp_order_spec #${String(line.specId)} (${line.label})`);
      // 같은 픽스처 zip 이라 이름이 둘 다 'arduino-uno.zip' 이다 — 주문서·주문내역에서
      // "어느 줄이 취소됐나"를 눈으로도 화면 텍스트로도 가르려면 이름이 달라야 한다.
      await prisma.spOrderSpec.update({
        where: { id: BigInt(line.specId) },
        data: { projectName: line.projectName },
      });
    }
    expect(lineA.specId, 'A/B 견적 분리').not.toBe(lineB.specId);
  }, 480_000);

  test('X2. 관리자·파트너: 각 건 RFQ → 회신 → 선정+확정가', async (ctx) => {
    if (lineA.specId === null || lineB.specId === null) return ctx.skip();
    for (const line of [lineA, lineB]) await priceUp(line, 'X2');
  }, 180_000);

  test('X3. 고객: 두 견적을 함께 체크 → **한 주문서**(단일 od·카트 2줄)', async (ctx) => {
    if (lineA.specId === null || lineB.specId === null) return ctx.skip();
    // 이 여정의 첫 새 조합 — 견적관리 [바로 주문]은 체크된 견적을 모두 담고 한 번에
    // ct_select 한다(quotes.php:502-559 → POST /api/pcb-projects/order ids 배열).
    const order = await placeOrderFromQuotes(customer, rp, {
      specId: lineA.specId,
      alsoSpecIds: [lineB.specId],
      step: 'X3',
      prefix: 'X03',
      buyerName: 'e2e취소고객',
    });
    od1 = order.odId;
    ledger.push(`g5_shop_order od_id=${od1} (2줄 — A·B)`);

    const rows = await cartRows(od1);
    expect(rows.length, '한 주문서에 카트 2줄').toBe(2);
    for (const line of [lineA, lineB]) {
      line.ctId = await loadCtId(line.specId ?? 0);
      expect(line.ctId, `${line.label} ct_id`).not.toBeNull();
      const row = rows.find((r) => Number(r.ct_id) === line.ctId);
      expect(row, `${line.label} 줄이 od=${od1} 소속`).toBeTruthy();
      expect(String(row.ct_status), `${line.label} 초기 줄 상태`).toBe('주문');
    }
    expect(lineA.ctId, 'A/B 카트 줄 분리').not.toBe(lineB.ctId);

    // 금액이 두 건 합계여야 한다 — 아니면 "한 주문서 n 줄"이 결제 축에서 깨진 것이다.
    const od = await orderRow(od1);
    const sum = lineA.price + lineB.price;
    expect(Number(od.od_cart_price), '주문 금액 = 두 건 합계').toBe(sum);
    expect(Number(od.od_misu), '미수금 = 합계 + 배송비').toBe(sum + Number(od.od_send_cost ?? 0));
    expect(String(od.od_settle_case), '무통장(카트행 취소의 전제)').toBe('무통장');
    F('X3', 'obs', `단일 주문서 2줄 생성 od=${od1} 합계 ${String(sum)}원 (A ${String(lineA.ctId)} · B ${String(lineB.ctId)})`);
  }, 480_000);

  test('X4. 관리자: 입금확인 → 발주 2건 → A 를 EQ~생산완료까지', async (ctx) => {
    if (od1 === null) return ctx.skip();
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [od1],
      sendMail: true,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    expect(paid.json?.data?.processed, '입금 처리 대상').toContain(od1);

    for (const line of [lineA, lineB]) await issuePo(line);
    // A 만 끝까지 민다 — 취소가 **진행 중이던 발주**에 무엇을 하는지 보려면 그래야 한다.
    await produce(lineA);
    expect(await poStatus(lineA.poId ?? 0), 'A 발주 생산완료').toBe('produced');
    expect(await poStatus(lineB.poId ?? 0), 'B 발주는 아직 발주접수').toBe('issued');

    const od = await orderRow(od1);
    expect(String(od.od_status), '입금 후 주문 상태').toBe('입금');
    expect(Number(od.od_misu), '입금확인 후 미수금 0').toBe(0);
  }, 300_000);

  test('X5. 부분 취소 — A 한 줄만 취소(od 는 취소가 아니다)', async (ctx) => {
    if (od1 === null || lineA.ctId === null) return ctx.skip();
    // 취소 줄의 옵션 재고(io_id = quoteId 라 견적마다 독립 행 — routes/pcb-projects.ts:78)
    const rowsBefore = await cartRows(od1);
    const rawA = rowsBefore.find((r) => Number(r.ct_id) === lineA.ctId);
    const stockBefore = await optionStock(String(rawA?.it_id ?? ''), String(rawA?.io_id ?? ''));

    const res = await api(A, 'PATCH', `/api/admin/orders/${od1}/items/status`, {
      ctIds: [lineA.ctId],
      target: '취소',
    });
    expect(res.status, `부분 취소: ${JSON.stringify(res.json)}`).toBe(200);
    expect(res.json?.data?.processed, '취소 처리된 줄').toEqual([lineA.ctId]);
    expect(res.json?.data?.skipped, 'skip 없음').toEqual([]);

    // ① od_status 는 '취소'가 아니다 — 이것이 부분 취소의 정의이자 X6 물음의 뿌리다.
    expect(res.json?.data?.odStatus, '부분 취소 후 od 상태(유지)').toBe('입금');
    // ② orderCancelled=false
    expect(res.json?.data?.orderCancelled, '전량 취소 아님').toBe(false);

    const rows = await cartRows(od1);
    const rowA = rows.find((r) => Number(r.ct_id) === lineA.ctId);
    const rowB = rows.find((r) => Number(r.ct_id) === lineB.ctId);
    expect(String(rowA?.ct_status), 'A 줄 취소').toBe('취소');
    // ④ 남은 줄 무영향
    expect(String(rowB?.ct_status), 'B 줄 무영향').toBe('입금');

    // ③ 재고 복원 — 배송 전이라 ct_stock_use=0 이었으므로 **복원 대상이 아니다**(코어 미러).
    expect(Number(rowA?.ct_stock_use ?? -1), '취소 줄 stock_use 초기화').toBe(0);
    const stockAfter = await optionStock(String(rowA?.it_id ?? ''), String(rowA?.io_id ?? ''));
    expect(stockAfter, '배송 전 취소는 재고 복원 대상 아님(차감된 적이 없다)').toBe(stockBefore);

    // ③ od_cancel_price·미수 재계산
    const od = await orderRow(od1);
    expect(Number(od.od_cancel_price), '취소 금액 = A 금액').toBe(lineA.price);
    expect(Number(od.od_cart_price), 'od_cart_price = 활성 + 취소류(코어 정의)').toBe(
      lineA.price + lineB.price,
    );
    expect(String(od.od_status), 'od 헤더는 그대로').toBe('입금');
    // 이미 전액을 받은 뒤 한 줄이 사라졌다 — 미수는 **음수**(= 돌려줄 돈)가 된다.
    const misu = Number(od.od_misu);
    expect(misu, '부분 취소 후 미수 재계산').toBe(
      lineB.price + Number(od.od_send_cost ?? 0) - Number(od.od_receipt_price ?? 0),
    );
    if (misu < 0) {
      F(
        'X5',
        'bug',
        `부분 취소로 od_misu=${String(misu)}(음수 = 과입금 ${String(-misu)}원 환불 대상)인데 ` +
          `od_refund_price 는 0 그대로다 — 환불 원장·환불 처리 경로가 없어 "돌려줄 돈"이 ` +
          `음수 미수로만 남는다(g5-db.ts:2490 computeOrderMoney·2954 recomputeOrderMoneyOnItemChange). ` +
          `※ 표기는 교정됨(08-11) — 목록·상세가 '미수금 -N'이 아니라 '과입금'으로 갈라 보인다. ` +
          `남은 것은 환불 **실행** 경로로, 결제수단·회계가 걸린 PG 도메인 별건이다.`,
      );
    }
    // 과입금이 실제로 살아 있는 유일한 국면이다 — 표기 교정(08-11)을 여기서 못 박는다.
    // ⚠ 기본 탭은 '입금 대기'(0건)이고 이 주문은 '진행 중'에 있다. 탭을 옮기고 주문번호로
    //   좁혀야 배지가 화면에 잡힌다(12호 P4 와 같은 탭 함정) — 한 건만 세우면 페이지네이션에
    //   밀릴 일도 없어 어서션을 걸 수 있다.
    await rp.view(adminView, '/app/admin/pcb/orders', 'X05-admin-orders-overpaid');
    await adminView.page.getByRole('button', { name: /^진행 중/ }).click();
    await adminView.page.getByPlaceholder('프로젝트·회원ID·주문번호 검색').fill(od1);
    await adminView.page.keyboard.press('Enter');
    await adminView.page.getByText(od1).first().waitFor({ timeout: 15_000 });
    await rp.shot(adminView, 'X05-admin-orders-overpaid');
    // 취소된 A 줄이 살아 있는 B 줄과 갈려 보이는가(08-11 교정) — 검색으로 이 주문만 세웠으므로
    // 화면에 뜬 두 행이 곧 A·B 다.
    expect(
      await adminView.page.getByText('줄 취소').count(),
      '주문 큐 — 줄 취소 배지',
    ).toBeGreaterThan(0);
    if (misu < 0) {
      // 돌려줄 돈이 목록에서 보여야 한다 — `> 0` 가드만 있던 시절엔 정상 건과 구분되지 않았다.
      expect(
        await adminView.page.getByText('과입금').count(),
        '주문 큐 — 과입금 배지(표기 교정 08-11)',
      ).toBeGreaterThan(0);
    }
    F('X5', 'obs', `부분 취소 확정 — od=${od1} status=${String(od.od_status)} cancel=${String(od.od_cancel_price)} misu=${String(misu)}`);
  }, 120_000);

  test('X6. [핵심] 취소된 라인의 협력 트랙 — 서버가 막는가', async (ctx) => {
    if (od1 === null || lineA.poId === null) return ctx.skip();
    const probe = await probeCollabTrack(lineA, 'X6');

    // 판정 기준은 하나다 — ORDER_CANCELED 로 끊었는가.
    const blocked = {
      box: probe.box.error === 'ORDER_CANCELED',
      eq: probe.eqAdvance.error === 'ORDER_CANCELED',
      as: probe.asCase.error === 'ORDER_CANCELED',
    };
    const allBlocked = blocked.box && blocked.eq && blocked.as;

    if (!allBlocked) {
      F(
        'X6',
        'bug',
        `**부분 취소가 협력 트랙으로 새어 나갔다.** 고객 주문의 그 줄은 '취소'인데 ` +
          `발송 담기(${String(probe.box.status)})·EQ 전진(${String(probe.eqAdvance.status)})·` +
          `A/S 접수(${String(probe.asCase.status)})가 전부 409 로 서지 않았다. 판정 축이 ` +
          `**주문 헤더로만** 되돌아갔는지 보라 — isPcbOrderLineCanceled(lib/pcb-shipment.ts)는 ` +
          `od_status='취소' **또는** 그 줄 ct_status 가 취소류일 때 참이어야 한다. ` +
          `od 단위로만 보면 부분 취소는 od 가 '입금'이라 가드가 통째로 비활성이 되고, ` +
          `취소된 보드가 계속 생산돼 박스에 담겨 나간다(가드 소비처 4곳 — 담기 · EQ 전진 · ` +
          `하위 발주 · A/S 접수/진행).`,
      );
    } else {
      F(
        'X6',
        'obs',
        `부분 취소도 3종 모두 ORDER_CANCELED 로 선다(줄 축 가드 정상) — 정리 경로(EQ 되돌리기)는 ` +
          `${String(probe.eqRevert.status)} 로 열려 있다.`,
      );
    }

    // ── 회귀 감지선 — 줄 축 가드가 빠지면 여기가 먼저 빨개진다 ────────────────
    expect(probe.box.status, 'X6 담기 — 취소 줄 차단').toBe(409);
    expect(probe.box.error, 'X6 담기 거절 코드').toBe('ORDER_CANCELED');
    expect(probe.eqRevert.status, 'X6 EQ 되돌리기(정리는 항상 허용)').toBe(200);
    expect(probe.eqAdvance.status, 'X6 EQ 전진 — 취소 줄 차단').toBe(409);
    expect(probe.eqAdvance.error, 'X6 EQ 전진 거절 코드').toBe('ORDER_CANCELED');
    expect(probe.asCase.status, 'X6 A/S 접수 — 취소 줄 차단').toBe(409);
    expect(probe.asCase.error, 'X6 A/S 거절 코드').toBe('ORDER_CANCELED');
    // 전진이 막혔으니 발주는 되돌린 자리(producing)에 남는다 — 정리 대상 상태로 기록.
    expect(await poStatus(lineA.poId), '차단 후 A 발주 상태').toBe('producing');
    const link = await getPrisma().spPcbShipmentPo.findUnique({
      where: { poId: BigInt(lineA.poId) },
    });
    expect(link, 'A 발주는 박스에 담기지 않았다').toBeNull();
  }, 180_000);

  test('X7. 화면 실측 — 부분 취소가 세 창구에 어떻게 비치는가', async (ctx) => {
    if (od1 === null) return ctx.skip();

    // ① 고객 주문내역 목록·상세 — 취소 줄 표기·금액·제작 진행 카드
    await customer.page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
    await rp.shot(customer, 'X07-customer-orders');
    await customer.page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${od1}`, {
      waitUntil: 'domcontentloaded',
    });
    await rp.shot(customer, 'X07-customer-order-detail');
    const detailText: string = await customer.page.evaluate(() => document.body.innerText);

    // 줄 상태는 sp_order_status_customer 로 '주문취소'가 되어야 한다(extend/sp_order_status.extend.php:26-28).
    expect(detailText, '취소 줄이 고객 화면에 표기').toContain('주문취소');
    expect(detailText, '살아 있는 줄도 함께 보임').toContain(lineB.projectName);
    expect(detailText, '취소된 줄도 주문내역엔 잔존(설계)').toContain(lineA.projectName);

    // ── 표기가 **보이는가**·줄이 **구별되는가** 실측 ─────────────────────────
    const table = await measureOrderDetailLines();
    expect(table, '주문 상세 상품 표').not.toBeNull();
    const lines = table?.rows ?? [];
    expect(lines.length, '상품 표에 두 줄').toBe(2);
    F('X7', 'obs', `상품 표 실측 — wrapRight=${String(table?.wrapRight)} overflowX=${String(table?.overflowX)} ${lines.map((r) => `[${r.name} | ${r.status} | right=${String(r.statusRight)}]`).join(' ')}`);

    // ① 두 줄이 같은 이름으로 찍히면 어느 줄이 취소됐는지 고객이 알 수 없다.
    //    표의 이름은 **줄(ct_id)별** it_name 이어야 한다(그룹 행 이름을 찍으면 PCB 견적은
    //    모두 같은 템플릿 상품이라 한 주문서의 모든 줄이 한 이름으로 뭉갠다).
    const names = new Set(lines.map((r) => r.name));
    if (names.size < lines.length) {
      F(
        'X7',
        'bug',
        `한 주문서 두 줄이 **같은 상품명**으로 표시된다 — 표가 줄별 이름 대신 그룹(it_id) 행의 ` +
          `it_name 을 찍고 있다(theme/sp-lite/shop/orderinquiryview.php 의 \`$opt['it_name']\` ` +
          `→ \`$row['it_name']\` 회귀). 결과: 취소 줄과 살아 있는 줄이 이름·사양 요약까지 ` +
          `똑같이 보여 **고객은 무엇이 취소됐는지 화면에서 구별할 수 없다**(실측 이름: ` +
          `${[...names].join(' / ')}).`,
      );
    }
    expect(names.size, 'X7 줄별 상품명 — 두 줄이 서로 다른 이름으로 구별된다').toBe(lines.length);

    // ② 상태 칸이 컨테이너 밖으로 밀리면 '주문취소' 글자는 DOM 에만 있고 화면엔 없다.
    const clipped = lines.filter(
      (r) => r.statusRight > (table?.wrapRight ?? Number.POSITIVE_INFINITY) + 1,
    );
    if (clipped.length > 0) {
      F(
        'X7',
        'bug',
        `주문 상세 상품 표의 **상태 칸이 잘려 안 보인다**(${String(clipped.length)}행 — ` +
          `상태 칸 오른쪽 ${clipped.map((r) => String(r.statusRight)).join('/')} > 표 영역 ` +
          `${String(table?.wrapRight)}, overflow-x=${String(table?.overflowX)}). ` +
          `'주문취소' 배지는 DOM 에는 있지만 가로 스크롤을 하지 않으면 화면에 나타나지 않는다 — ` +
          `취소를 알리는 유일한 줄 단위 표기가 잘린 셈이다.`,
      );
    }
    expect(clipped.length, 'X7 상태 칸이 표 영역 안에 들어온다(가로 스크롤 없이 보인다)').toBe(0);

    // 제작 진행 카드(P4.13) — od 가 배송/완료/취소가 아니면 카드가 뜬다. 취소된 줄까지 뜨는가?
    const progress = await api(await customerToken(), 'GET', `/api/pcb-progress?odId=${od1}`);
    expect(progress.status, `진행 카드 조회: ${JSON.stringify(progress.json)}`).toBe(200);
    const items: any[] = progress.json?.data?.items ?? [];
    const cardA = items.find((i) => i.specId === lineA.specId);
    if (cardA !== undefined) {
      F(
        'X7',
        'bug',
        `취소된 줄(${lineA.projectName})이 고객 상세의 **제작 진행 상황** 카드에 그대로 남는다 ` +
          `— '${String(cardA.label)}'. listCustomerPcbProgress(lib/pcb-customer-progress.ts)가 ` +
          `**ct_status 를 안 보는 상태로 되돌아갔다**. 라우트(routes/pcb-eq-reviews.ts)는 ` +
          `od_status 가 배송·완료·취소일 때만 카드를 접으므로 부분 취소는 lib 이 안 거르면 ` +
          `어느 층에서도 안 걸러진다. 고객은 "주문취소"라고 쓰인 줄이 동시에 "생산 완료 — ` +
          `발송 준비 중"으로 진행되는 화면을 본다.`,
      );
    }
    expect(cardA, 'X7 취소된 줄은 제작 진행 카드를 내지 않는다').toBeUndefined();
    // 살아 있는 줄은 그대로 — 필터가 과하게 걷어내면 여기가 빨개진다.
    expect(
      items.map((i) => Number(i.specId)),
      'X7 살아 있는 줄의 카드는 유지',
    ).toContain(lineB.specId);
    F('X7', 'obs', `고객 상세 진행 카드 ${String(items.length)}장: ${items.map((i) => `${String(i.projectName)}=${String(i.stage)}`).join(', ')}`);

    // ② 관리자 주문·결제 큐 — 부분 취소 주문이 어느 탭에 서는가(탭 축은 od_status 뿐)
    const queue = await api(A, 'GET', `/api/admin/pcb-orders?tab=all&page=1&pageSize=100&q=${String(od1)}`);
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    const qRows: any[] = queue.json?.data?.items ?? [];
    const qA = qRows.find((r) => r.specId === lineA.specId);
    const qB = qRows.find((r) => r.specId === lineB.specId);
    expect(qA, '취소된 줄도 주문·결제 큐에 남음').toBeTruthy();
    expect(qB, '살아 있는 줄 큐 존재').toBeTruthy();
    if (qA !== undefined && String(qA.odStatus) !== '취소') {
      F(
        'X7',
        'obs',
        `관리자 주문·결제 큐가 줄 축을 안다(08-11 교정) — **탭**은 여전히 o.od_status 축이라 ` +
          `취소된 줄도 활성 탭(odStatus='${String(qA.odStatus)}')에 서지만, 행에 ` +
          `lineCanceled=${String(qA.lineCanceled)} 가 실려 '줄 취소' 배지로 갈린다. ` +
          `탭 분류까지 줄 축으로 바꾸는 것은 별건(모수 정의가 바뀐다).`,
      );
    }
    // 서버 가드와 고객 화면은 이미 줄 축을 본다 — 관리자 목록만 못 보면 "화면은 진행 중인데
    // 서버는 409" 가 된다. 두 줄이 갈리는지를 함께 못 박는다(한쪽만 보면 상수 반환도 통과한다).
    expect(qA?.lineCanceled, '취소된 줄 — 목록이 줄 축을 안다').toBe(true);
    expect(qB?.lineCanceled, '살아 있는 줄은 그대로').toBe(false);
    const canceledTab = await api(A, 'GET', `/api/admin/pcb-orders?tab=canceled&page=1&pageSize=100&q=${String(od1)}`);
    expect(
      (canceledTab.json?.data?.items ?? []).length,
      '부분 취소는 취소 탭에 안 잡힌다(현재 동작 박제)',
    ).toBe(0);
    await rp.view(adminView, '/app/admin/pcb/orders', 'X07-admin-orders-queue');

    // ③ 관리자 Case 상세(취소된 줄) · ④ 협력사 포털(취소된 건의 발주가 보이는가)
    await rp.view(adminView, `/app/admin/pcb/cases/${String(lineA.specId)}`, 'X07-admin-case-canceled-line');
    const portal = await api(P, 'GET', '/api/partner/pcb-pos');
    expect(portal.status, `협력사 발주 목록: ${JSON.stringify(portal.json)}`).toBe(200);
    const mine: any[] = portal.json?.data?.items ?? [];
    const seen = mine.find((p: any) => Number(p.poId) === lineA.poId);
    expect(seen, '취소된 줄의 발주가 협력사 포털에 그대로 보인다(현재 동작)').toBeTruthy();
    if (seen !== undefined) {
      F(
        'X7',
        'obs',
        `협력사 포털에는 취소된 줄의 발주(#${String(lineA.poId)})가 아무 표식 없이 그대로 보인다 ` +
          `— 발주 목록·상세는 주문 축을 싣지 않는다(공급망 반대 방향 비노출 원칙의 이면). ` +
          `취소를 알리는 통로는 서버 가드뿐이라(X6 에서 409 로 선다) 협력사는 **다음 동작을 ` +
          `시도해야** 취소를 안다 — 목록에 표식을 다는 것은 별건(주문 축 노출 정책).`,
      );
    }
    await rp.view(partnerView, '/app/partner/pcb/ship', 'X07-partner-ship-board');
    await rp.view(partnerView, `/app/partner/pcb/pos/${String(lineA.poId)}`, 'X07-partner-po-canceled-line');
  }, 240_000);

  test('X8. 취소된 견적은 견적관리로 돌아오는가 · 같은 스펙 재주문 가능한가', async (ctx) => {
    if (lineA.specId === null) return ctx.skip();
    await customer.page.goto(`${BASE_URL}/shop/quotes`, { waitUntil: 'domcontentloaded' });
    await customer.page.waitForLoadState('networkidle').catch(() => undefined);
    await rp.shot(customer, 'X08-quotes-after-cancel');
    const token = await customerToken();

    // 견적관리(active)는 **ctId 가 없는 건만** 낸다 — "한 건은 한 화면에만"이라는 독립
    // 모델(routes/pcb-projects.ts:298-352). 취소돼도 cart 행은 남아 있으므로(ct_status='취소')
    // 그 필터에 계속 걸린다 → 목록에서 사라진 채다.
    const list = await api(token, 'GET', '/api/pcb-projects?status=active');
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const active: any[] = list.json?.data?.items ?? [];
    expect(
      active.map((r: any) => Number(r.projectId)),
      '취소된 견적이 견적관리로 복귀하지 않는다',
    ).not.toContain(lineA.specId);

    // 보관함(지난 견적)에도 안 간다 — lazy reconcile 은 cart 행이 **사라졌을 때만** 돈다.
    const archive = await api(token, 'GET', '/api/pcb-projects?status=deleted');
    expect(archive.status, JSON.stringify(archive.json)).toBe(200);
    expect(
      (archive.json?.data?.items ?? []).map((r: any) => Number(r.projectId)),
      '보관함에도 없다',
    ).not.toContain(lineA.specId);
    const specA = await getPrisma().spOrderSpec.findUnique({ where: { id: BigInt(lineA.specId) } });
    expect(specA?.status, '스펙은 active 로 남는다(sp 무접촉)').toBe('active');
    expect(specA?.ctId, '취소돼도 ctId 는 그대로 — 주문내역 소관').toBe(lineA.ctId);

    // 재주문 시도 — 화면엔 진입점이 없으므로 API 로 직접 친다(백스톱 확인).
    const reorder = await api(token, 'POST', '/api/pcb-projects/order', { ids: [lineA.specId] });
    expect(reorder.status, '취소된 견적 재주문 차단').toBe(409);
    expect(String(reorder.json?.error), '재주문 거절 코드').toBe('NO_ORDERABLE_ITEMS');
    expect(
      (reorder.json?.failed ?? []).map((f: any) => String(f.error)),
      '재주문 실패 사유',
    ).toContain('ALREADY_ORDERED');

    F(
      'X8',
      'obs',
      `취소된 견적은 견적관리로 **복귀하지 않고 보관함에도 안 간다** — 견적관리는 ctId 없는 건만 ` +
        `내고(routes/pcb-projects.ts:352), 보관함 이관은 cart 행이 사라졌을 때만 도는데 취소 줄은 ` +
        `행이 남아 있기 때문이다(:344). 문서 설계('미복귀·주문내역에 잔존', routes/admin-orders.ts:653)와 ` +
        `일치하되 **화면에서 완전히 증발**한다는 뜻이다: 고객이 취소된 견적을 다시 보거나 다시 사려면 ` +
        `주문내역을 통하는 수밖에 없고 재주문 진입점 자체가 없다(API 백스톱은 ALREADY_ORDERED 로 거절). ` +
        `취소분을 다시 사려면 거버부터 새로 올려야 한다.`,
    );
  }, 120_000);

  test('X9. 남은 B 줄 완주 — EQ~생산~국제 발송~입고확인', async (ctx) => {
    if (lineB.poId === null || od1 === null) return ctx.skip();
    await produce(lineB);

    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: lineB.poId });
    expect(box.status, `B 담기: ${JSON.stringify(box.json)}`).toBe(200);
    const myBox = (box.json?.data?.boxes ?? []).find((b: any) =>
      (b.groupPos ?? []).some((g: any) => g.poId === lineB.poId),
    );
    expect(myBox, 'B 박스').toBeTruthy();
    // 형제(취소된) 줄이 X6 프로브 뒤 제대로 빠졌는지 — 같은 contextKey 라 남아 있었다면
    // 취소된 보드가 이 박스에 실려 그대로 해외로 나갔을 것이다.
    expect(
      (myBox.groupPos ?? []).map((g: any) => g.poId),
      '취소 줄의 발주가 박스에 없다',
    ).not.toContain(lineA.poId);
    expect(myBox.mode, '국제 발송').toBe('international');
    F('X9', 'obs', `B 박스 구성 ${String((myBox.groupPos ?? []).length)}건 — 취소 줄 미포함`);
    ledger.push(`sp_pcb_shipment (B po ${String(lineB.poId)})`);

    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
      .buffer as ArrayBuffer;
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(lineB.poId)}/shipment/files`,
      { fileType: 'invoice' },
      `invoice-cancel-${RUN_TAG}.pdf`,
      pdf,
      'application/pdf',
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);
    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(lineB.poId)}/shipment/advance`, {
      shipDate: '2026-08-14',
    });
    expect(adv.status, `선적요청: ${JSON.stringify(adv.json)}`).toBe(200);

    for (let i = 0; i < 6; i += 1) {
      const step = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(lineB.specId)}/pos/${String(lineB.poId)}/shipment/advance`,
        { carrier: 'DHL', trackingNumber: `CANCEL-${RUN_TAG}`, trackingUrl: null },
      );
      if (step.status !== 200) {
        if (step.json?.error !== 'ALREADY_FINAL') F('X9', 'obs', `체인 중단: ${JSON.stringify(step.json)}`);
        break;
      }
    }
    const recv = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(lineB.specId)}/pos/${String(lineB.poId)}/shipment/receive`,
      { note: '[여정 10호] B 줄 입고' },
    );
    expect(recv.status, `입고확인: ${JSON.stringify(recv.json)}`).toBe(200);

    // 배송 대기 큐 — 부분 취소 주문도 큐에 오른다(od 는 활성이므로).
    const queue = await api(A, 'GET', '/api/admin/pcb-orders?tab=to_ship&page=1&pageSize=100');
    const items: any[] = queue.json?.data?.items ?? [];
    const rowB = items.find((i) => i.odId === od1 && i.specId === lineB.specId);
    expect(rowB, 'B 줄 배송 대기 진입').toBeTruthy();
    const rowA = items.find((i) => i.odId === od1 && i.specId === lineA.specId);
    if (rowA !== undefined) {
      F(
        'X9',
        'obs',
        `취소된 줄(spec #${String(lineA.specId)})도 같은 주문이라 배송 대기 큐(to_ship)에 함께 선다 ` +
          `— 큐 SQL 은 발주 축 입고 신호와 od_status 만 보고 ct_status 를 안 본다(g5-db.ts:3261 PCB_TO_SHIP).`,
      );
    }
    await rp.view(adminView, '/app/admin/pcb/shipments', 'X09-admin-to-ship');
    F('X9', 'obs', `B 줄 완주 — 입고확인까지(발주 #${String(lineB.poId)})`);
  }, 300_000);

  test('X10. 고객 배송 → 완료 — 실제 경로(force-status)가 취소 줄을 어떻게 다루는가', async (ctx) => {
    if (od1 === null) return ctx.skip();
    const before = await cartRows(od1);
    const beforeA = before.find((r) => Number(r.ct_id) === lineA.ctId);
    expect(String(beforeA?.ct_status), '배송 직전 A 줄은 취소').toBe('취소');

    // PCB 고객 배송은 코어 force-status '배송' 을 쓴다 — 주문이 '입금'에 머무는 설계(D6)라
    // 선형 전이가 성립하지 않기 때문이다(components/admin/pcb/PcbCustomerShipModal.vue:9,
    // admin/useAdminPcbOrders.ts:103-112). 즉 이것이 관리자가 실제로 누르는 버튼이다.
    const ship = await api(A, 'PATCH', `/api/admin/orders/${od1}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: `J10-${RUN_TAG}`,
        invoiceTime: '2026-08-11 18:00:00',
      },
    });
    expect(ship.status, `배송 전이: ${JSON.stringify(ship.json)}`).toBe(200);

    const after = await cartRows(od1);
    const afterA = after.find((r) => Number(r.ct_id) === lineA.ctId);
    const afterB = after.find((r) => Number(r.ct_id) === lineB.ctId);
    expect(String(afterB?.ct_status), 'B 줄 배송').toBe('배송');

    const od = await orderRow(od1);
    if (String(afterA?.ct_status) !== '취소') {
      F(
        'X10',
        'bug',
        `**부분 취소한 줄이 배송 처리 한 번에 되살아난다.** 관리자가 살아 있는 줄을 배송하려고 ` +
          `[배송 처리]를 누르면(PCB 고객 배송의 유일한 경로 = force-status '배송') 취소된 줄도 ` +
          `'${String(afterA?.ct_status)}'로 함께 올라가고 od_cancel_price 가 ` +
          `${String(od.od_cancel_price)}(취소 전 ${String(lineA.price)})로 재계산된다. ` +
          `전진 target 의 대상 집합에 **취소류가 다시 들어갔다**(g5-db.ts ` +
          `resolveForceStatusLineStatuses — 취소류 포함은 역방향 '주문'(=un-cancel, 정리 경로) ` +
          `한 곳만이어야 한다). 그 화면엔 줄 선택이 없어 취소 이력·금액·재고가 한꺼번에 되돌아간다.`,
      );
    } else {
      F('X10', 'obs', `force-status '배송'이 취소 줄을 건드리지 않았다 — A 줄 ${String(afterA?.ct_status)} 유지`);
    }
    // 회귀 감지선 — 전진 target 이 취소류를 다시 삼키면 여기가 빨개진다.
    expect(String(afterA?.ct_status), 'X10 취소 줄은 배송 전이에도 취소 유지').toBe('취소');
    expect(Number(od.od_cancel_price), 'X10 취소 금액 보존').toBe(lineA.price);

    const fin = await api(A, 'PATCH', `/api/admin/orders/${od1}/force-status`, { target: '완료' });
    expect(fin.status, `완료 전이: ${JSON.stringify(fin.json)}`).toBe(200);
    const odFin = await orderRow(od1);
    expect(String(odFin.od_status), '최종 주문 상태').toBe('완료');
    expect(String(odFin.od_invoice), '운송장').toBe(`J10-${RUN_TAG}`);
    const finRows = await cartRows(od1);
    expect(
      String(finRows.find((r) => Number(r.ct_id) === lineA.ctId)?.ct_status),
      'X10 완료 전이도 취소 줄을 건드리지 않는다',
    ).toBe('취소');
    expect(
      String(finRows.find((r) => Number(r.ct_id) === lineB.ctId)?.ct_status),
      'B 줄 완료',
    ).toBe('완료');

    await customer.page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${od1}`, {
      waitUntil: 'domcontentloaded',
    });
    await rp.shot(customer, 'X10-customer-detail-after-ship');
    F(
      'X10',
      'obs',
      `완주 — od=${od1} status=${String(odFin.od_status)} cancel=${String(odFin.od_cancel_price)} ` +
        `misu=${String(odFin.od_misu)} 줄상태=[${finRows.map((r) => String(r.ct_status)).join(', ')}]`,
    );
    // 과입금(음수 미수)은 배송·완료 뒤에도 그대로 남는다 — 환불 원장·경로가 없다(정책 보고 사안).
    if (Number(odFin.od_misu) < 0) {
      F(
        'X10',
        'obs',
        `완주 후에도 od_misu=${String(odFin.od_misu)}(과입금 ${String(-Number(odFin.od_misu))}원) · ` +
          `od_cancel_price=${String(odFin.od_cancel_price)} — 취소 이력·금액은 보존되지만 ` +
          `환불 처리 경로는 여전히 없다(X5 와 같은 사안, 정책 결정 대기).`,
      );
    }
  }, 180_000);

  test('X11. 대조군 — 별도 주문 2줄 전량 취소 → ORDER_CANCELED 가드가 서는가', async () => {
    const prisma = getPrisma();
    for (const line of [lineC, lineD]) {
      line.specId = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 10호-${line.label}] 전량 취소 대조군 — 확인 후 정리 예정`,
        prefix: `X11-${line.label}`,
      });
      ledger.push(`sp_order_spec #${String(line.specId)} (${line.label})`);
      await prisma.spOrderSpec.update({
        where: { id: BigInt(line.specId) },
        data: { projectName: line.projectName },
      });
      await priceUp(line, 'X11');
    }

    const order = await placeOrderFromQuotes(customer, rp, {
      specId: lineC.specId ?? 0,
      alsoSpecIds: [lineD.specId ?? 0],
      step: 'X11',
      prefix: 'X11',
      buyerName: 'e2e전량취소고객',
    });
    od2 = order.odId;
    ledger.push(`g5_shop_order od_id=${od2} (2줄 — C·D, 전량 취소)`);
    for (const line of [lineC, lineD]) line.ctId = await loadCtId(line.specId ?? 0);
    expect((await cartRows(od2)).length, '대조군도 한 주문서 2줄').toBe(2);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [od2],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `대조군 입금확인: ${JSON.stringify(paid.json)}`).toBe(200);
    for (const line of [lineC, lineD]) await issuePo(line);
    await produce(lineC); // 담기 프로브 전제

    // 전량 취소 — 두 줄 한 번에
    const res = await api(A, 'PATCH', `/api/admin/orders/${od2}/items/status`, {
      ctIds: [lineC.ctId, lineD.ctId],
      target: '취소',
    });
    expect(res.status, `전량 취소: ${JSON.stringify(res.json)}`).toBe(200);
    expect((res.json?.data?.processed ?? []).length, '두 줄 모두 처리').toBe(2);
    expect(res.json?.data?.odStatus, '전량 취소 → od 취소').toBe('취소');
    expect(res.json?.data?.orderCancelled, 'orderCancelled=true').toBe(true);
    const od = await orderRow(od2);
    expect(String(od.od_status), 'od 헤더 취소').toBe('취소');
    expect(Number(od.od_cancel_price), '취소 금액 = 두 줄 합계').toBe(lineC.price + lineD.price);
    expect(String(od.od_mod_history ?? ''), '취소 이력 append').toContain('주문취소 처리');

    // 전량 취소 주문에 **전진** target 을 실수로 걸면 — 움직일 줄이 하나도 없다. 상태만 올라가
    // 카트행과 어긋나는 대신 409 로 끊고 되돌리는 법(=target '주문')을 안내해야 한다.
    const wrongWay = await api(A, 'PATCH', `/api/admin/orders/${od2}/force-status`, {
      target: '배송',
      delivery: {
        deliveryCompany: 'CJ대한통운',
        invoiceNo: `J10-X11-${RUN_TAG}`,
        invoiceTime: '2026-08-11 18:00:00',
      },
    });
    expect(wrongWay.status, `전량 취소 주문 배송 시도: ${JSON.stringify(wrongWay.json)}`).toBe(409);
    expect(String(wrongWay.json?.error), '거절 코드').toBe('NO_ACTIVE_LINES');
    expect(String(wrongWay.json?.message ?? ''), '되돌리는 법 안내').toContain('주문');
    const odAfterWrong = await orderRow(od2);
    expect(String(odAfterWrong.od_status), '거절됐으니 헤더 불변').toBe('취소');
    expect(
      (await cartRows(od2)).map((r) => String(r.ct_status)),
      '거절됐으니 줄도 불변',
    ).toEqual(['취소', '취소']);
    F(
      'X11',
      'obs',
      `전량 취소 주문의 전진 전이는 409 NO_ACTIVE_LINES — "${String(wrongWay.json?.message ?? '')}"`,
    );

    // 같은 3종 프로브 — 이번엔 막혀야 한다.
    const probe = await probeCollabTrack(lineC, 'X11');
    expect(probe.box.status, '전량 취소 담기 차단').toBe(409);
    expect(probe.box.error, '담기 거절 코드').toBe('ORDER_CANCELED');
    expect(probe.eqRevert.status, '정리(되돌리기)는 취소 주문에서도 허용').toBe(200);
    expect(probe.eqAdvance.status, '전량 취소 EQ 전진 차단').toBe(409);
    expect(probe.eqAdvance.error, 'EQ 전진 거절 코드').toBe('ORDER_CANCELED');
    expect(probe.asCase.status, '전량 취소 A/S 접수 차단').toBe(409);
    expect(probe.asCase.error, 'A/S 거절 코드').toBe('ORDER_CANCELED');
    // 전진이 막혔으니 발주는 되돌린 자리(producing)에 남는다 — 정리 대상 상태로 기록.
    expect(await poStatus(lineC.poId ?? 0), '차단 후 C 발주 상태').toBe('producing');

    F(
      'X11',
      'obs',
      `대조 확정 — **전량 취소와 부분 취소가 3종 모두 같은 ORDER_CANCELED 로 선다.** ` +
        `가드의 판정 축이 둘이라(isPcbOrderLineCanceled, lib/pcb-shipment.ts — od_status='취소' ` +
        `또는 그 줄 ct_status 취소류) 줄 단위 취소도 협력 트랙에 그대로 전달된다. ` +
        `정리 경로(EQ 되돌리기)는 양쪽 모두 200 으로 열려 있다.`,
    );
    await rp.view(adminView, `/app/admin/pcb/cases/${String(lineC.specId)}`, 'X11-admin-case-fully-canceled');
    await rp.view(adminView, '/app/admin/pcb/orders', 'X11-admin-orders-canceled-tab');
  }, 900_000);

  test('X12. 정리 가능성 — 취소된 주문이 force-status 주문 복귀 후 삭제되는가', async (ctx) => {
    if (od1 === null || od2 === null) return ctx.skip();
    // cleanup-probe.mts 가 밟는 첫 단계와 같은 호출이다(force-status '주문' → 재고 복원).
    // 취소류 줄이 정상 상태로 못 돌아오면 정리 스크립트가 재고를 흘린 채 행을 지운다.
    for (const odId of [od1, od2]) {
      const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '주문' });
      expect(back.status, `${odId} 주문 복귀: ${JSON.stringify(back.json)}`).toBe(200);
      const rows = await cartRows(odId);
      const stuck = rows.filter((r) => String(r.ct_status) !== '주문');
      expect(stuck.map((r) => String(r.ct_status)), `${odId} 전 줄 '주문' 복귀`).toEqual([]);
      const used = rows.filter((r) => Number(r.ct_stock_use ?? 0) > 0);
      expect(used.length, `${odId} 재고 점유 해제`).toBe(0);
      const od = await orderRow(odId);
      expect(String(od.od_status), `${odId} 헤더 복귀`).toBe('주문');
    }
    F(
      'X12',
      'obs',
      `취소·부분 취소 주문 모두 force-status '주문' 으로 되돌아온다 — 역방향 '주문' 만은 ` +
        `대상 집합이 취소류를 포함하기 때문이다(g5-db.ts resolveForceStatusLineStatuses). ` +
        `전진 target 에서 취소류를 뺀 교정(X10)이 이 정리 경로를 건드리지 않음을 여기서 확인한다 — ` +
        `cleanup-probe.mts 는 보강 없이 그대로 쓸 수 있다.`,
    );
  }, 120_000);
});
