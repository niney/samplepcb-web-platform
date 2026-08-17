// 여정 16호 — **동시 조작 경합**(두 손이 같은 것을 동시에 민다).
//
// 앞의 열다섯 편은 전부 **한 번에 한 사람**이 조작했다. 실무는 그렇지 않다 — 관리자 둘이
// 같은 큐를 보고 있고, 관리자와 협력사가 같은 발주를 동시에 민다. 낙관적 잠금(버전 컬럼)이
// 없는 자리에서 같은 요청이 겹치면 무슨 일이 생기는지 아무도 확인하지 않았다.
//
// 이 편은 **불변식**을 본다(응답 하나하나의 성패가 아니라 "끝난 뒤 세상이 성립하는가"):
//   ① 상태는 한 칸만 움직인다 — 같은 전이를 둘이 밀어도 두 칸 가지 않는다.
//   ② 발주서는 하나다 — 같은 (스펙·조직·회차) 조합에 두 장이 생기지 않는다(UK).
//   ③ **박스는 하나다** — 담기는 "같은 컨텍스트면 합류, 없으면 생성"이라 조회와 생성 사이에
//      경합 창이 있다. 동시에 담으면 박스가 둘 생길 수 있는 구조다(이 편의 주 표적).
//   ④ 선정은 한 번만 — 동시 선정이 확정가를 두 번 쓰지 않는다.
//
// 어서션은 "둘 다 200 이어야 한다"가 아니다. 한쪽이 409 로 지든 둘 다 이기든, **결과가
// 하나면 통과**다 — 경합 해소 방식은 구현의 자유이고 불변식만 지켜지면 된다.
//
// 실행: pnpm -F e2e journey:concurrency  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 스크린샷 접두사는 **C** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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

describe.skipIf(!RUN || !JOURNEY)('여정 16호 — 동시 조작 경합', () => {
  const rp = createJourneyReport('findings-concurrency', '여정 16호 동시 조작 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let A2 = ''; // 두 번째 관리자 토큰(같은 계정의 다른 세션 — 두 창을 연 상황)
  let P = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
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

  const apiForm = async (
    token: string,
    path: string,
    fields: Record<string, string>,
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([bytes], fileName, { type: 'application/zip' }));
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

  /** 두 요청을 **동시에** 던진다 — 순차 실행이면 경합이 아니다. */
  const race = async <T>(a: Promise<T>, b: Promise<T>): Promise<[T, T]> => Promise.all([a, b]);

  const statusOf = async (): Promise<string> =>
    String((await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId ?? 0) } }))?.status ?? '');

  const adminBase = (): string =>
    `/api/admin/pcb-projects/${String(specId)}/pos/${String(poId)}`;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    const creds = requireCustomerCreds();
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    A2 = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });

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

  test('C1. 준비 — 발주까지(동시 발행도 함께 시험)', async () => {
    const prisma = getPrisma();

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 16호] 동시 조작 검증 — 확인 후 정리 예정',
      prefix: 'C01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId;
    expect(rfqId, 'RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${PARTNER_NAME})`);

    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 55,
      quotedDeliveryDate: '2026-09-15',
      memo: '[여정 16호] 포털 회신',
    });
    expect(reply.status, `포털 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    // ── ④ 동시 선정 — 두 관리자가 같은 순간 [선정+확정가]를 누른다.
    const rfqBase = `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}`;
    const [s1, s2] = await race(
      api(A, 'POST', `${rfqBase}/select`, { finalPrice: 95_000 }),
      api(A2, 'POST', `${rfqBase}/select`, { finalPrice: 95_000 }),
    );
    const selOk = [s1, s2].filter((r) => r.status === 200).length;
    const rfqAfter = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId ?? 0) } });
    expect(rfqAfter?.status, '동시 선정 후 상태는 하나').toBe('selected');
    // 형제 회신이 없으니 둘 다 200 일 수 있다 — 불변식은 "결과가 하나"다.
    const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(specId ?? 0) } });
    expect(Number(spec?.finalPrice ?? 0), '확정가는 한 값').toBe(95_000);
    F('C1', 'obs', `동시 선정 — 200 ${String(selOk)}/2 · rfq=selected · 확정가 ₩95,000 하나`);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'C1',
      prefix: 'C01',
      buyerName: 'e2e동시조작고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);

    // ── 동시 입금확인 — 두 관리자가 같은 주문을 함께 확인 처리한다.
    const [p1, p2] = await race(
      api(A, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: false,
        sendSms: false,
      }),
      api(A2, 'PATCH', '/api/admin/orders/status', {
        target: '입금',
        odIds: [odId],
        sendMail: false,
        sendSms: false,
      }),
    );
    expect([p1.status, p2.status].includes(200), '입금확인 최소 1건 성공').toBe(true);
    const odRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_receipt_price, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    // 수납액이 두 번 더해지면 결제금액을 넘는다 — 돈이 겹치는지가 진짜 표적이다.
    expect(String(odRow[0]?.od_status), '입금 상태').toBe('입금');
    expect(Number(odRow[0]?.od_receipt_price ?? 0), '수납액은 한 번만').toBe(95_000);
    expect(Number(odRow[0]?.od_misu ?? -1), '미수 0').toBe(0);
    F(
      'C1',
      'obs',
      `동시 입금확인 — 응답 [${String(p1.status)}, ${String(p2.status)}] · 수납액 ₩95,000 ` +
        `(두 번 더해지지 않음) · 미수 0`,
    );

    // ── ② 동시 발행 — 같은 (스펙·조직·회차) 조합에 발주서 두 장이 생기면 UK 가 깨진 것이다.
    const [i1, i2] = await race(
      api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
        partnerId: num(partner.id),
        rfqId,
      }),
      api(A2, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
        partnerId: num(partner.id),
        rfqId,
      }),
    );
    const pos = await prisma.spPcbPo.findMany({ where: { specId: BigInt(specId ?? 0) } });
    expect(pos.length, '발주서는 한 장').toBe(1);
    // 데이터가 지켜지는 것만으로는 부족하다 — 진 쪽이 **안내 없는 500** 을 보면 안 된다
    // (두 창을 연 관리자가 겪는다). 유니크 위반은 "이미 발행됨"으로 옮겨졌다(교정 08-11).
    expect([i1.status, i2.status].filter((s) => s >= 500), '동시 발행 — 500 없음').toEqual([]);
    const loser = [i1, i2].find((r) => r.status !== 200);
    if (loser !== undefined) {
      expect(loser.status, '진 쪽은 409 로 안내').toBe(409);
      expect(loser.json?.error, '안내 코드').toBe('ALREADY_ISSUED');
    }
    poId = Number(pos[0]?.id);
    ledger.push(`sp_pcb_po #${String(poId)} (${PARTNER_NAME} — 동시 발행 결과)`);
    F(
      'C1',
      'obs',
      `동시 발행 — 응답 [${String(i1.status)}, ${String(i2.status)}] · sp_pcb_po ${String(pos.length)}장 ` +
        `(UK specId+partnerId+parentPartnerId+reorderRound 가 지킨다)`,
    );
  }, 600_000);

  test('C2. 동시 전이 — 상태가 두 칸 가지 않는다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-conc.zip`,
        bytes,
      );
      expect(up.status, `${fileType} 업로드`).toBe(200);
    }

    // 협력사와 관리자가 **같은 순간** 같은 전이를 민다(포털 버튼 + 관리자 대행 버튼).
    const [r1, r2] = await race(
      api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {}),
      api(A, 'POST', `${adminBase()}/eq-request`, {}),
    );
    const after = await statusOf();
    // issued → eq_requested 한 칸. 두 번 먹으면 eq_done 까지 가 버린다(승인이 아닌데 승인됨).
    expect(after, '한 칸만 움직인다').toBe('eq_requested');

    const po = await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } });
    const history: any[] = Array.isArray(po?.eqHistory) ? po.eqHistory : [];
    // 전진만 센다 — 되돌리기(eq_done→eq_requested)는 **전이 방향**으로 거른다.
    // (note==='되돌리기' 표식은 2026-08-16 교정으로 더는 안 쓰인다 — journey-rewind R4 동형)
    const forwardCount = history.filter(
      (e: any) => String(e.fromStatus) === 'issued' && String(e.toStatus) === 'eq_requested',
    ).length;
    // 이력이 두 줄이면 상태는 하나인데 기록만 겹친 것 — 그것도 사실과 다르다.
    expect(forwardCount, '전이 이력도 한 줄').toBe(1);
    F(
      'C2',
      'obs',
      `동시 전이 — 응답 [${String(r1.status)}, ${String(r2.status)}] · 상태 ${after} 한 칸 · ` +
        `eq_requested 이력 ${String(forwardCount)}줄`,
    );
  }, 300_000);

  test('C3. 동시 담기 — 박스가 둘 생기지 않는가(주 표적)', async (ctx) => {
    if (poId === null || specId === null) return ctx.skip();
    const prisma = getPrisma();

    // 생산완료까지 밀어 담기 가능 상태로.
    expect((await api(A, 'POST', `${adminBase()}/eq-approve`, {})).status, 'EQ 승인').toBe(200);
    expect((await api(A, 'POST', `${adminBase()}/production-start`, {})).status, '생산 시작').toBe(200);
    expect((await api(A, 'POST', `${adminBase()}/production-complete`, {})).status, '생산 완료').toBe(
      200,
    );

    // 협력사 포털 [담기]와 관리자 [발송 시작]이 같은 순간에 눌린다. ensurePcbShipment 는
    // "같은 컨텍스트의 preparing 박스를 찾고, 없으면 만든다" — 그 사이가 경합 창이다.
    const [b1, b2] = await race(
      api(P, 'POST', '/api/partner/pcb-shipments/box', { poId }),
      api(A, 'POST', `${adminBase()}/shipment/box`, {}),
    );
    const links = await prisma.spPcbShipmentPo.findMany({ where: { poId: BigInt(poId) } });
    const shipments: any[] = await prisma.spPcbShipment.findMany({
      where: { pos: { some: { poId: BigInt(poId) } } },
    });
    for (const s of shipments) ledger.push(`sp_pcb_shipment #${String(s.id)} (동시 담기 결과)`);

    // 불변식 둘: 발주는 박스 하나에만 속하고(멤버십 1행), 그 발주를 품은 박스도 하나다.
    expect(links.length, '발주의 박스 소속은 1건').toBe(1);
    expect(shipments.length, '이 발주를 품은 박스는 1개').toBe(1);
    // 합류 의미론에서 "이미 담겼다"는 실패가 아니다 — 진 쪽도 그 박스를 받아야 한다
    // (교정 08-11: P2002 → 재조회 후 같은 박스 반환). 500 이면 관리자가 오류를 본다.
    expect([b1.status, b2.status], '동시 담기 — 둘 다 성공(같은 박스)').toEqual([200, 200]);
    F(
      'C3',
      'obs',
      `동시 담기 — 응답 [${String(b1.status)}, ${String(b2.status)}] · 멤버십 ${String(links.length)}행 · ` +
        `박스 ${String(shipments.length)}개(#${shipments.map((s) => String(s.id)).join(',')})`,
    );
  }, 420_000);

  test('C4. 동시 전이(선적) — 단계가 두 칸 가지 않는다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const prisma = getPrisma();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-conc.pdf',
      bytes,
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);

    const [a1, a2] = await race(
      api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
        shipDate: '2026-09-20',
      }),
      api(A, 'POST', `${adminBase()}/shipment/advance`, { shipDate: '2026-09-20' }),
    );
    const ship = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    // preparing → requested 한 칸. 두 번 먹으면 shipped(발송됨)까지 가 버린다.
    expect(ship?.status, '선적 단계 한 칸').toBe('requested');
    F(
      'C4',
      'obs',
      `동시 선적 전이 — 응답 [${String(a1.status)}, ${String(a2.status)}] · 상태 ${String(ship?.status)} 한 칸`,
    );
  }, 300_000);

  test('C5. 정리 준비 — 주문 되돌리기(재고 복원)', async (ctx) => {
    if (odId === null) return ctx.skip();
    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'C05-case-after-races');
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('C5', 'obs', `정리 준비 — od=${odId} '주문' 복귀(재고 복원). 문서는 cleanup-probe 로.`);
  }, 180_000);
});
