// 여정 15호 — **되돌리기 전 구간 순환**(잘못 눌렀을 때 되돌아갈 수 있는가).
//
// 가드 체계는 "못 하게 막는" 절반만 검증돼 왔다(pcb-guards·rework-probe 의 409 목록).
// 반대편 절반이 이 편이다: **되돌리기**. 실무에서 오조작은 반드시 생기고, 출구 없는 잠금은
// 일을 멈춘다 — 그래서 재작업 2단계가 가드를 세울 때도 "잠김 → 정리 → 열림" 순환을 함께
// 못 박았다. 그런데 **한 주행에서 끝까지 되돌렸다가 다시 진행하는** 경로는 아무도 밟지 않았다.
//
// 겨냥하는 것 넷:
//   ① **주체 규칙** — revert 는 "직전에 **자기가** 진행한 전이만"이다(D22). 협력사가 민 것을
//      관리자가 되돌리려 하면 거절돼야 하고, 그 반대도 마찬가지다. 섞어 밀어 놓고 확인한다.
//   ② **체인 되돌리기** — produced 에서 issued 까지 한 단계씩 내려갈 수 있는가. 어디서 멈추나.
//   ③ **되돌린 뒤 재진행** — 다시 끝까지 갔을 때 처음과 같은 상태가 되는가(첨부·입력값이
//      살아 있고 이력이 이상하게 겹치지 않는가). 되돌리기의 값어치는 여기서 판가름 난다.
//   ④ **선정 해제 순환** — 발주가 있으면 PO_ISSUED 로 잠기고, 발주를 취소하면 열리고,
//      다시 선정할 수 있는가(재작업 2단계가 세운 순환의 완주).
//
// 협력2(CN/USD·계정 있음)를 쓴다 — 협력사와 관리자가 **번갈아 미는** 상황이라야 주체 규칙이
// 시험되고, 국제 체인이라 선적 되돌리기 단계도 길다.
//
// 실행: pnpm -F e2e journey:rewind  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
// 스크린샷 접두사는 **R** 전용(여정 공용 폴더라 겹치면 남의 캡처를 덮어쓴다).
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

describe.skipIf(!RUN || !JOURNEY)('여정 15호 — 되돌리기 전 구간 순환', () => {
  const rp = createJourneyReport('findings-rewind', '여정 15호 되돌리기 탐색 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner: PartnerFixture;
  let A = '';
  let P = '';

  let specId: number | null = null;
  let rfqId: number | null = null;
  let odId: string | null = null;
  let poId: number | null = null;
  let shipmentId: bigint | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  // multipart 업로드(EQ 첨부) — File 은 Node 20+ 글로벌.
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

  const poRow = async (): Promise<any> =>
    getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId ?? 0) } });

  const eqHistory = async (): Promise<any[]> => {
    const row = await poRow();
    return Array.isArray(row?.eqHistory) ? row.eqHistory : [];
  };

  const statusOf = async (): Promise<string> => String((await poRow())?.status ?? '');

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

  test('R1. 준비 — 협력사·관리자가 번갈아 밀어 생산완료까지', async () => {
    const prisma = getPrisma();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;

    specId = await submitGerberRfq(customer, rp, {
      fixtureZip: FIXTURE_ZIP,
      projectName: 'arduino-uno.zip',
      memo: '[여정 15호] 왕복 검증 — 확인 후 정리 예정',
      prefix: 'R01',
    });
    ledger.push(`sp_order_spec #${String(specId)} (mbId=${customer.mbId} — 거버 rfq 제출)`);

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    rfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner.id))?.rfqId;
    expect(rfqId, 'RFQ 행').toBeTruthy();
    ledger.push(`sp_pcb_rfq #${String(rfqId)} (spec ${String(specId)} → ${PARTNER_NAME})`);

    // 회신은 협력사 포털로(주체를 섞는 것이 이 편의 전제다).
    const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(rfqId)}`, {
      price: 45,
      quotedDeliveryDate: '2026-09-05',
      memo: '[여정 15호] 포털 회신',
    });
    expect(reply.status, `포털 회신: ${JSON.stringify(reply.json)}`).toBe(200);

    const sel = await api(
      A,
      'POST',
      `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}/select`,
      { finalPrice: 85_000 },
    );
    expect(sel.status, `선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);

    const order = await placeOrderFromQuotes(customer, rp, {
      specId,
      step: 'R1',
      prefix: 'R01',
      buyerName: 'e2e되돌리기고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} + g5_shop_cart (${customer.mbId})`);
    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/pos`, {
      partnerId: num(partner.id),
      rfqId,
    });
    expect(issue.status, `발행: ${JSON.stringify(issue.json)}`).toBe(200);
    poId = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner.id))?.poId;
    expect(poId, '발주서 행').toBeTruthy();
    ledger.push(`sp_pcb_po #${String(poId)} (${PARTNER_NAME} — 되돌리기 대상)`);

    // 협력사: EQ 첨부 2종 → 승인요청  /  관리자: 승인  /  협력사: 생산 시작·완료
    for (const fileType of ['eq', 'working'] as const) {
      const up = await apiForm(
        P,
        `/api/partner/pcb-pos/${String(poId)}/eq-files`,
        { fileType },
        `${fileType}-rewind.zip`,
        bytes,
      );
      expect(up.status, `${fileType} 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    }
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {})).status,
      '협력사 EQ 승인요청',
    ).toBe(200);
    expect((await api(A, 'POST', `${adminBase()}/eq-approve`, {})).status, '관리자 EQ 승인').toBe(200);
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {})).status,
      '협력사 생산 시작',
    ).toBe(200);
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {})).status,
      '협력사 생산 완료',
    ).toBe(200);

    expect(await statusOf(), '준비 도달 상태').toBe('produced');
    const files = await prisma.spFile.count({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId ?? 0) },
    });
    expect(files, 'EQ 첨부 2건').toBe(2);
    const h = await eqHistory();
    F(
      'R1',
      'obs',
      `준비 완료 — po=${String(poId)} produced. 주체 섞임: ` +
        `[${h.map((e: any) => `${String(e.toStatus)}:${String(e.byRole)}`).join(' · ')}]`,
    );
  }, 600_000);

  test('R2. 주체 규칙은 **비대칭**이다 — 관리자는 만능, 협력사는 자기 차례만', async (ctx) => {
    if (poId === null) return ctx.skip();

    // 마지막 전이(생산완료)는 **협력사**가 밀었다. 그런데 관리자는 그것도 되돌린다 —
    // D11 만능 대행이 advance 와 똑같이 revert 에도 걸려 있다(pcb-po.ts revertPcbPoEq:
    // `role !== revert.actor && actor.kind !== 'admin'`). 협력사가 연락이 끊긴 채 잘못
    // 밀어 놓은 건을 관리자가 못 물리면 트랙이 멈추므로, 이 방향은 열려 있어야 한다.
    const adminBack = await api(A, 'POST', `${adminBase()}/eq-revert`, {});
    expect(adminBack.status, `관리자 되돌리기(협력사 전이): ${JSON.stringify(adminBack.json)}`).toBe(
      200,
    );
    expect(await statusOf(), '생산완료 → 생산중').toBe('producing');

    // 협력사 몫 한 칸 더(생산 시작 되돌리기) — 자기가 민 것이니 열린다.
    const ownBack = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-revert`, {});
    expect(ownBack.status, `협력사 되돌리기(자기 전이): ${JSON.stringify(ownBack.json)}`).toBe(200);
    expect(await statusOf(), '생산중 → EQ 완료').toBe('eq_done');

    // ── 반대 방향은 막힌다: EQ 승인은 **관리자**가 한 결정이라 협력사가 물릴 수 없다.
    //    이 비대칭이 없으면 협력사가 관리자의 승인을 조용히 되돌릴 수 있다.
    const notYours = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-revert`, {});
    expect(notYours.status, `협력사가 관리자 결정 되돌리기: ${JSON.stringify(notYours.json)}`).toBe(
      409,
    );
    expect(await statusOf(), '거절됐으니 상태 불변').toBe('eq_done');
    F(
      'R2',
      'obs',
      `되돌리기 주체는 비대칭 — 관리자는 협력사 전이도 되돌린다(D11 만능 대행, produced→` +
        `producing 200) · 협력사는 자기 전이만(producing→eq_done 200, 관리자 승인 되돌리기는 409).`,
    );
  }, 240_000);

  test('R3. 체인 되돌리기 — issued 까지 내려간다', async (ctx) => {
    if (poId === null) return ctx.skip();
    const seen: string[] = [await statusOf()];

    // 각 단계의 주체를 따라가며 최대 6번까지 시도한다(무한 루프 방지).
    for (let i = 0; i < 6; i += 1) {
      const cur = await statusOf();
      if (cur === 'issued') break;
      // 협력사가 민 것(producing·produced·eq_requested)은 협력사가, 관리자가 민 것
      // (eq_done=승인)은 관리자가 되돌린다.
      const asPartner = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-revert`, {});
      if (asPartner.status !== 200) {
        const asAdmin = await api(A, 'POST', `${adminBase()}/eq-revert`, {});
        expect(asAdmin.status, `관리자 되돌리기(${cur}): ${JSON.stringify(asAdmin.json)}`).toBe(200);
      }
      const next = await statusOf();
      expect(next, `되돌리기가 진행돼야 한다(${cur})`).not.toBe(cur);
      seen.push(next);
    }

    expect(await statusOf(), '체인 끝 = 발주접수').toBe('issued');
    // 첨부는 살아 있어야 한다 — 되돌린 뒤 다시 올리라고 하면 되돌리기의 값어치가 없다.
    const files = await getPrisma().spFile.count({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId ?? 0) },
    });
    expect(files, '되돌려도 EQ 첨부 유지').toBe(2);
    F(
      'R3',
      'obs',
      `체인 되돌리기 완주 — ${seen.join(' → ')} · EQ 첨부 ${String(files)}건 유지 ` +
        `(단계마다 민 주체가 되돌린다).`,
    );
  }, 300_000);

  test('R4. 되돌린 뒤 재진행 — 처음과 같은 자리에 닿는가', async (ctx) => {
    if (poId === null) return ctx.skip();

    // issued 로 내려왔으니 첨부 교체도 열려 있어야 한다(EQ_LOCKED 는 승인요청 뒤 규칙).
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const re = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { fileType: 'eq' },
      'eq-rewind-v2.zip',
      bytes,
    );
    expect(re.status, `되돌린 뒤 첨부 교체: ${JSON.stringify(re.json)}`).toBe(200);

    // 같은 길을 다시 간다.
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`, {})).status,
      '재진행 — EQ 승인요청',
    ).toBe(200);
    expect((await api(A, 'POST', `${adminBase()}/eq-approve`, {})).status, '재진행 — 승인').toBe(200);
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`, {})).status,
      '재진행 — 생산 시작',
    ).toBe(200);
    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-complete`, {})).status,
      '재진행 — 생산 완료',
    ).toBe(200);
    expect(await statusOf(), '재진행 도달').toBe('produced');

    // 이력은 **왕복이 다 남아야** 한다 — 되돌린 사실이 지워지면 "왜 두 번 만들었나"를
    // 나중에 설명할 수 없다.
    //
    // ⚠ 되돌림을 note='되돌리기' 로 세던 것을 **전이 방향**으로 바꿨다(2026-08-16 교정).
    //   그 표식이 사유 자리를 차지하는 바람에 협력사의 '요청 취소'가 반려로 읽혔다
    //   (journey-eq-reply E1b). 되돌림의 정의는 애초에 "뒤로 간 전이"이지 특정 문자열이
    //   아니다 — 상태 순서로 세면 표식 없이도 정확하다.
    // 진행 순서(계약 PCB_PO_STATUSES 와 같은 사전 — e2e 는 계약을 의존하지 않아 인라인).
    const order = ['issued', 'eq_requested', 'eq_done', 'producing', 'produced'];
    const h = await eqHistory();
    const backwards = h.filter(
      (e: any) => order.indexOf(String(e.toStatus)) < order.indexOf(String(e.fromStatus)),
    );
    expect(backwards.length, '되돌린 사실이 이력에 남는다').toBeGreaterThan(0);
    // 앞으로 민 칸도 그대로 남아야 한다(덮어쓰기가 아니라 누적).
    expect(h.length, '왕복이 누적된다(앞 4칸 + 되돌림 4칸 + 재진행 4칸)').toBe(12);
    F(
      'R4',
      'obs',
      `재진행 완주 — produced 재도달. eqHistory ${String(h.length)}칸 누적(되돌림 ` +
        `${String(backwards.length)}칸을 전이 방향으로 식별) — 왕복이 통째로 감사에 남는다.`,
    );
  }, 300_000);

  test('R5. 선적 되돌리기 순환 — 담기 → 전이 → 되돌리기 → 재전이', async (ctx) => {
    if (poId === null) return ctx.skip();
    const prisma = getPrisma();

    // 담기(협력사 포털) — 국제 체인이라 첫 전이는 선적 요청(출고예정일+Invoice).
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(box.status, `담기: ${JSON.stringify(box.json)}`).toBe(200);
    const shipment = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    shipmentId = shipment?.id ?? null;
    expect(shipment?.status, '담기 직후').toBe('preparing');
    expect(shipment?.mode, '국제 파생(CN → 관리자 KR)').toBe('international');
    ledger.push(`sp_pcb_shipment #${String(shipmentId)} (po ${String(poId)} — 되돌리기 검증)`);

    // 선적 요청에는 Invoice 첨부가 필요하다 — 없으면 막히는 것이 정상(가드 확인).
    const noDoc = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-09-10',
    });
    expect(noDoc.status, '첨부 없이 선적 요청은 막힌다').toBe(409);
    expect(noDoc.json?.error, '거절 코드').toBe('MISSING_INVOICE_FILE');

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // %PDF
    const up = await apiForm(
      P,
      `/api/partner/pcb-pos/${String(poId)}/shipment/files`,
      { fileType: 'invoice' },
      'invoice-rewind.pdf',
      bytes,
    );
    expect(up.status, `Invoice 첨부: ${JSON.stringify(up.json)}`).toBe(200);

    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-09-10',
    });
    expect(adv.status, `선적 요청: ${JSON.stringify(adv.json)}`).toBe(200);
    const afterAdv = await prisma.spPcbShipment.findUnique({ where: { id: shipmentId ?? 0n } });
    expect(afterAdv?.status, '선적 요청 도달').toBe('requested');

    // 되돌리기 — 입력값(출고예정일)과 첨부가 유지돼야 한다(D22 "입력값·첨부 유지").
    const rev = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/revert`, {});
    expect(rev.status, `선적 되돌리기: ${JSON.stringify(rev.json)}`).toBe(200);
    const afterRev = await prisma.spPcbShipment.findUnique({ where: { id: shipmentId ?? 0n } });
    expect(afterRev?.status, '되돌리기 도달').toBe('preparing');
    const keptFiles = await prisma.spFile.count({
      where: { refType: 'sp_pcb_shipment', refId: shipmentId ?? 0n },
    });
    expect(keptFiles, '되돌려도 Invoice 유지').toBe(1);
    expect(afterRev?.shipDate, '되돌려도 출고예정일 유지').not.toBeNull();

    // 재전이 — 첨부가 살아 있으니 다시 요구하지 않아야 한다.
    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-09-11',
    });
    expect(again.status, `재전이: ${JSON.stringify(again.json)}`).toBe(200);
    F(
      'R5',
      'obs',
      `선적 왕복 실동작 — preparing → requested → (revert) preparing → requested. ` +
        `Invoice 1건·출고예정일 유지(다시 올리라고 하지 않는다).`,
    );
  }, 300_000);

  test('R6. 선적 취소(문서 삭제) → 재담기', async (ctx) => {
    if (poId === null) return ctx.skip();
    const prisma = getPrisma();

    // 발송이 시작된 선적은 취소할 수 없다 — 먼저 되돌려 preparing 으로 내린다.
    const tooLate = await api(A, 'DELETE', `${adminBase()}/shipment`);
    expect(tooLate.status, '진행 중 선적 취소는 막힌다').toBe(409);
    expect(tooLate.json?.error, '거절 코드').toBe('NOT_PREPARING');

    expect(
      (await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/revert`, {})).status,
      '되돌려 preparing 으로',
    ).toBe(200);
    const del = await api(A, 'DELETE', `${adminBase()}/shipment`);
    expect(del.status, `선적 취소: ${JSON.stringify(del.json)}`).toBe(200);
    expect(
      await prisma.spPcbShipment.count({ where: { id: shipmentId ?? 0n } }),
      '선적 문서 삭제',
    ).toBe(0);

    // 다시 담을 수 있어야 한다 — 취소가 막다른 길이면 오조작이 곧 사고다.
    const rebox = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId });
    expect(rebox.status, `재담기: ${JSON.stringify(rebox.json)}`).toBe(200);
    const fresh = await prisma.spPcbShipment.findFirst({
      where: { pos: { some: { poId: BigInt(poId) } } },
      orderBy: { id: 'desc' },
    });
    shipmentId = fresh?.id ?? null;
    expect(fresh?.status, '새 박스는 준비 상태').toBe('preparing');
    ledger.push(`sp_pcb_shipment #${String(shipmentId)} (재담기)`);
    F(
      'R6',
      'obs',
      `선적 취소 순환 — 진행 중 409 NOT_PREPARING → 되돌리기 → 취소 200(문서 소멸) → 재담기 ` +
        `#${String(shipmentId)}. 취소가 막다른 길이 아니다.`,
    );
  }, 300_000);

  test('R7. 선정 해제 순환 — 잠김 → 정리 → 열림 → 재선정', async (ctx) => {
    if (specId === null || rfqId === null || poId === null) return ctx.skip();
    const prisma = getPrisma();
    const rfqBase = `/api/admin/pcb-projects/${String(specId)}/rfqs/${String(rfqId)}`;

    // 발주가 살아 있으면 선정 해제가 잠긴다(재작업 2단계 W2).
    const locked = await api(A, 'POST', `${rfqBase}/unselect`, {});
    expect(locked.status, `발주 있는 선정 해제: ${JSON.stringify(locked.json)}`).toBe(409);
    expect(locked.json?.error, '거절 코드').toBe('PO_ISSUED');

    // ⚠ 잠금은 **겹겹이** 걸려 있고 검사 순서가 있다 — 발주 취소는 상태(NOT_ISSUED)를
    //   선적 소속(IN_SHIPMENT)보다 **먼저** 본다. 그래서 EQ 를 먼저 발주접수까지 되돌려야
    //   비로소 "담겨 있어서 못 지운다"는 진짜 이유가 드러난다(첫 주행이 순서를 뒤집어 걸렸다).
    const notIssued = await api(A, 'DELETE', `${adminBase()}`);
    expect(notIssued.status, '진행 중 발주 취소는 막힌다').toBe(409);
    expect(notIssued.json?.error, '먼저 걸리는 거절 코드').toBe('NOT_ISSUED');

    // 발주는 발주접수(issued)에서만 취소된다 — 관리자 만능 대행으로 한 칸씩 내린다.
    for (let i = 0; i < 6; i += 1) {
      if ((await statusOf()) === 'issued') break;
      expect((await api(A, 'POST', `${adminBase()}/eq-revert`, {})).status, '관리자 되돌리기').toBe(
        200,
      );
    }
    expect(await statusOf(), '발주 취소 가능 상태').toBe('issued');

    // 이제 진짜 이유가 나온다 — 담긴 발주는 선적에서 먼저 빼야 한다.
    const inShipment = await api(A, 'DELETE', `${adminBase()}`);
    expect(inShipment.status, '담긴 발주 취소는 막힌다').toBe(409);
    expect(inShipment.json?.error, '거절 코드').toBe('IN_SHIPMENT');
    expect((await api(A, 'DELETE', `${adminBase()}/shipment`)).status, '선적 취소').toBe(200);

    expect((await api(A, 'DELETE', `${adminBase()}`)).status, '발주 취소').toBe(200);
    expect(await prisma.spPcbPo.count({ where: { id: BigInt(poId) } }), '발주 소멸').toBe(0);

    // 이제 열린다 — 그리고 다시 선정할 수 있다(순환의 완주).
    const opened = await api(A, 'POST', `${rfqBase}/unselect`, {});
    expect(opened.status, `정리 후 선정 해제: ${JSON.stringify(opened.json)}`).toBe(200);
    const rfqAfter = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId) } });
    expect(rfqAfter?.status, '해제 후 상태').toBe('quoted');

    const reselect = await api(A, 'POST', `${rfqBase}/select`, {});
    expect(reselect.status, `재선정: ${JSON.stringify(reselect.json)}`).toBe(200);
    const rfqFinal = await prisma.spPcbRfq.findUnique({ where: { id: BigInt(rfqId) } });
    expect(rfqFinal?.status, '재선정 후 상태').toBe('selected');
    poId = null; // 발주는 지워졌다 — 이후 단계가 잘못 참조하지 않게
    F(
      'R7',
      'obs',
      `선정 해제 순환 완주 — PO_ISSUED 409 → 선적 취소(IN_SHIPMENT 먼저) → EQ 되돌려 issued ` +
        `→ 발주 취소 → unselect 200(quoted) → 재선정 200(selected).`,
    );
  }, 480_000);

  test('R8. 화면 관찰 + 정리 준비', async (ctx) => {
    if (specId === null || odId === null) return ctx.skip();

    await rp.view(adminView, `/app/admin/pcb/cases/${String(specId)}`, 'R08-case-after-rewind');
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('R8', 'obs', `정리 준비 — od=${odId} '주문' 복귀(재고 복원). 문서는 cleanup-probe 로.`);
  }, 180_000);
});
