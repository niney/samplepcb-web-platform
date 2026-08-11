// 여정 33호 — **미결 판단 3건의 구현 검증**.
//
// 앞선 여정들이 "여기가 문제다"까지 밝혀 놓고 **사람의 결정을 기다리던** 항목이 셋 있었다.
// 결정이 내려졌고(2026-08-11), 이 편은 그 셋이 실제로 그렇게 동작하는지 본다.
//
//   ① EQ 첨부 최신 구분(22호) — 파일은 **누적 유지**하되 화면이 최신을 갈라 준다.
//      교체로 바꾸면 다층 보드처럼 여러 장 올리는 실무를 막고, 덮어쓰기는 되돌릴 수 없다.
//   ② 환불 처리 기록(10호) — 돈은 결제사·계좌에서 사람이 보내고, **기록만** 시스템에 남긴다.
//      기록이 없으면 같은 건을 두 번 돌려주거나 영영 안 돌려준다.
//   ③ 송금 완납 통지(8호) — **잔액 0 이 된 순간 1회만**. 원장은 정정·삭제되는 기록이라
//      회차마다 보내면 알림이 사실보다 앞선다(30호 실측).
//
// 셋 다 "서버가 옳게 판단하는데 사람에게 전달되지 않는다"는 같은 뿌리에서 나왔다 —
// 그래서 이 편의 어서션도 **전달 경로**(응답 필드·화면 텍스트·발송 원장)에 걸린다.
//
// 실행: pnpm -F e2e journey:decisions  (PORTAL_E2E=1 + JOURNEY=1 — 거버 필요)
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

/** 협력사 회신가(USD — 협력2 조직 기본 통화). 완납 판정은 통화와 무관하지만 외화가 더 험하다. */
const PO_USD = 300;
const HALF = 150;

const num = (v: unknown): number => Number(v);

describe.skipIf(!RUN || !JOURNEY)('여정 33호 — 미결 판단 3건 구현 검증', () => {
  const rp = createJourneyReport('findings-decisions', '여정 33호 판단 구현 검증 주행 리포트');
  const { F, ledger } = rp;

  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let partner2: PartnerFixture;
  let A = '';
  let P = '';

  /** 한 주문서에 들어갈 두 줄 — A 는 취소해 과입금을 만들고, B 로 EQ·송금을 본다. */
  const lineA = { label: 'A', projectName: 'D33-취소줄.zip', specId: null as number | null, rfqId: null as number | null, ctId: null as number | null, poId: null as number | null, price: 0 };
  const lineB = { label: 'B', projectName: 'D33-진행줄.zip', specId: null as number | null, rfqId: null as number | null, ctId: null as number | null, poId: null as number | null, price: 0 };

  let odId: string | null = null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  /** EQ 첨부 업로드(협력사 포털 경로) — 파일 내용은 무의미하고 **몇 번째인지**가 관심사다. */
  const uploadEq = async (
    poId: number,
    fileType: 'eq' | 'working',
    fileName: string,
  ): Promise<{ status: number; json: any }> => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const form = new FormData();
    form.set('fileType', fileType);
    form.set('file', new File([bytes], fileName, { type: 'application/zip' }));
    const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(poId)}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
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

  /** 관리자 Case 패널이 보는 발주 1건(화면이 쓰는 바로 그 응답). */
  const poView = async (specId: number, poId: number): Promise<any> => {
    const r = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/pos`);
    expect(r.status, `발주 현황 조회: ${JSON.stringify(r.json)}`).toBe(200);
    return (r.json?.data?.pos ?? []).find((p: any) => p.poId === poId) ?? null;
  };

  const orderRow = async (od: string): Promise<any> => {
    const rows: any[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_misu, od_refund_price, od_cancel_price, od_mod_history, od_status
         FROM g5_shop_order WHERE od_id = ?`,
      od,
    );
    return rows[0] ?? {};
  };

  /** 완납 통지 발송 기록 — '1회'의 근거는 원장이다. */
  const settledLogs = async (poId: number): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: { kind: 'pcb_remit_settled', refType: 'pcb_po', refId: String(poId) },
      orderBy: { id: 'asc' },
    });

  const remit = async (poId: number, body: Record<string, unknown>) =>
    api(A, 'POST', `/api/admin/pcb-remittances/${String(poId)}`, body);

  /** 메일은 비차단(void)이라 응답보다 늦게 남는다 — 원장을 보기 전에 잠깐 기다린다. */
  const settle = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 2_500));
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(GERBER_URL, 'sp-gerber-eye-v3 에서 pnpm dev (8040)');
    partner2 = await getPartner('협력2');
    if (partner2.mbId === null) throw new Error('협력2 연결 계정 없음');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: partner2.mbId, ttlSec: 3600 });
    customer = await newPhpSession(requireCustomerCreds());
    rp.watchHttp(customer, '고객');
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(adminView, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  // ── 준비: 두 줄짜리 주문 → 입금 → 발주 2건 ──────────────────────────────────
  test('D1. 고객: 거버 2건 → 견적요청 2건', async () => {
    const prisma = getPrisma();
    for (const line of [lineA, lineB]) {
      line.specId = await submitGerberRfq(customer, rp, {
        fixtureZip: FIXTURE_ZIP,
        projectName: 'arduino-uno.zip',
        memo: `[여정 33호-${line.label}] 판단 구현 검증 — 확인 후 정리 예정`,
        prefix: `D01-${line.label}`,
      });
      ledger.push(`sp_order_spec #${String(line.specId)} (${line.label})`);
      // 같은 픽스처라 이름이 겹친다 — 화면에서 두 줄을 가르려면 이름이 달라야 한다(10호 교훈).
      await prisma.spOrderSpec.update({
        where: { id: BigInt(line.specId) },
        data: { projectName: line.projectName },
      });
    }
    expect(lineA.specId, 'A/B 견적 분리').not.toBe(lineB.specId);
  }, 600_000);

  test('D2. 관리자·협력2: 각 건 RFQ → 회신(USD) → 선정+확정가', async (ctx) => {
    if (lineA.specId === null || lineB.specId === null) return ctx.skip();
    for (const line of [lineA, lineB]) {
      const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(line.specId)}/rfqs`, {
        partnerIds: [num(partner2.id)],
      });
      expect(send.status, `${line.label} RFQ: ${JSON.stringify(send.json)}`).toBe(200);
      const row = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(partner2.id));
      expect(row, `${line.label} RFQ 행`).toBeTruthy();
      line.rfqId = row.rfqId;
      ledger.push(`sp_pcb_rfq #${String(line.rfqId)} (${line.label})`);

      const reply = await api(P, 'PUT', `/api/partner/pcb-rfqs/${String(line.rfqId)}`, {
        price: PO_USD,
        quotedDeliveryDate: '2026-08-28',
        memo: `[여정 33호] ${line.label} 회신`,
      });
      expect(reply.status, `${line.label} 회신: ${JSON.stringify(reply.json)}`).toBe(200);

      line.price = 500_000;
      const sel = await api(
        A,
        'POST',
        `/api/admin/pcb-projects/${String(line.specId)}/rfqs/${String(line.rfqId)}/select`,
        { exchangeRate: 1400, finalPrice: line.price },
      );
      expect(sel.status, `${line.label} 선정+확정가: ${JSON.stringify(sel.json)}`).toBe(200);
    }
  }, 300_000);

  test('D3. 고객 주문(2줄) → 입금확인 → 발주 2건', async (ctx) => {
    if (lineA.specId === null || lineB.specId === null) return ctx.skip();
    const order = await placeOrderFromQuotes(customer, rp, {
      specId: lineA.specId,
      alsoSpecIds: [lineB.specId],
      step: 'D3',
      prefix: 'D03',
      buyerName: 'e2e판단검증고객',
    });
    odId = order.odId;
    ledger.push(`g5_shop_order od_id=${odId} (2줄)`);

    const paid = await api(A, 'PATCH', '/api/admin/orders/status', {
      target: '입금',
      odIds: [odId],
      sendMail: false,
      sendSms: false,
    });
    expect(paid.status, `입금확인: ${JSON.stringify(paid.json)}`).toBe(200);

    const prisma = getPrisma();
    for (const line of [lineA, lineB]) {
      // 스펙이 자기 카트 줄을 안다(sp_order_spec.ctId) — 조인할 것 없다(10호 loadCtId 동형).
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: BigInt(line.specId ?? 0) } });
      line.ctId = spec?.ctId === null || spec?.ctId === undefined ? null : Number(spec.ctId);
      expect(line.ctId, `${line.label} ct_id`).not.toBeNull();

      const issue = await api(A, 'POST', `/api/admin/pcb-projects/${String(line.specId)}/pos`, {
        partnerId: num(partner2.id),
        rfqId: line.rfqId,
        exchangeRate: 1400,
      });
      expect(issue.status, `${line.label} 발행: ${JSON.stringify(issue.json)}`).toBe(200);
      const po = (issue.json?.data?.pos ?? []).find((p: any) => p.partnerId === num(partner2.id));
      expect(po, `${line.label} 발주서 행`).toBeTruthy();
      line.poId = po.poId;
      ledger.push(`sp_pcb_po #${String(line.poId)} (${line.label})`);
    }
    F(
      'D3',
      'obs',
      `준비 완료 — od=${odId} 2줄(A ct=${String(lineA.ctId)} · B ct=${String(lineB.ctId)}) · ` +
        `발주 A#${String(lineA.poId)} B#${String(lineB.poId)}`,
    );
  }, 600_000);

  // ── ① EQ 첨부 최신 구분(22호 결정) ──────────────────────────────────────────
  test('D4. 같은 종류를 다시 올려도 남는다 — 그러나 최신이 갈린다', async (ctx) => {
    if (lineB.poId === null || lineB.specId === null) return ctx.skip();

    // eq 두 번, working 한 번 — "이전 것이 남는다"와 "종류가 서로를 밀어내지 않는다"를 한 번에.
    const up1 = await uploadEq(lineB.poId, 'eq', 'eq-v1.zip');
    expect(up1.status, `eq v1: ${JSON.stringify(up1.json)}`).toBe(200);
    const up2 = await uploadEq(lineB.poId, 'working', 'working-v1.zip');
    expect(up2.status, `working v1: ${JSON.stringify(up2.json)}`).toBe(200);
    const up3 = await uploadEq(lineB.poId, 'eq', 'eq-v2.zip');
    expect(up3.status, `eq v2: ${JSON.stringify(up3.json)}`).toBe(200);

    const po = await poView(lineB.specId, lineB.poId);
    expect(po, '발주 행').toBeTruthy();
    const files: any[] = po.eqFiles ?? [];

    // 결정 ①의 앞면 — 파일은 지우지 않는다(여러 장 올리는 실무를 막지 않는다).
    expect(files.length, 'EQ 첨부 3건 모두 남는다').toBe(3);

    // 결정 ①의 뒷면 — 종류별 **최신 1건**만 isLatest 다.
    const latest = files.filter((f) => f.isLatest === true);
    expect(latest.length, '최신은 종류당 하나(eq·working)').toBe(2);
    expect(
      latest.map((f) => f.name).sort(),
      'eq 는 v2 가, working 은 v1 이 최신',
    ).toEqual(['eq-v2.zip', 'working-v1.zip']);

    // 정렬 — **최신이 앞**이라야 관리자가 누르는 첫 버튼이 옛 도면이 아니다.
    expect(files[0]?.isLatest, '첫 항목은 최신').toBe(true);
    expect(files[files.length - 1]?.name, '마지막 항목이 이전 회차').toBe('eq-v1.zip');
    expect(files[files.length - 1]?.isLatest, '이전 회차는 최신 아님').toBe(false);

    F(
      'D4',
      'obs',
      `EQ 첨부 최신 판정 실측 — 3건 보존(${files.map((f: any) => String(f.name)).join(', ')}) · ` +
        `isLatest [${files.map((f: any) => `${String(f.name)}:${String(f.isLatest)}`).join(' · ')}] · ` +
        `첫 항목=최신(옛 도면이 첫 버튼이 되지 않는다)`,
    );
  }, 300_000);

  test('D5. 관리자 화면 — 이전 회차는 접혀 있고 펼치면 표가 붙는다', async (ctx) => {
    if (lineB.specId === null) return ctx.skip();
    await rp.view(adminView, `/app/admin/pcb/cases/${String(lineB.specId)}`, 'D05-case-eq');

    // 접힌 상태 — 최신 두 개만 버튼으로 서고, 이전 1건은 [이전 1] 뒤에 있다.
    const older = adminView.page.getByRole('button', { name: '이전 1' });
    await older.first().waitFor({ timeout: 20_000 });
    const beforeExpand = await adminView.page.getByText('· 이전').count();
    expect(beforeExpand, '펼치기 전에는 이전 파일 버튼이 없다').toBe(0);
    await rp.shot(adminView, 'D05-case-eq-collapsed');

    // 펼치면 나온다 — 지운 것이 아니라 접어 둔 것임이 화면으로 증명된다.
    await older.first().click();
    await adminView.page.getByText('· 이전').first().waitFor({ timeout: 15_000 });
    const afterExpand = await adminView.page.getByText('· 이전').count();
    expect(afterExpand, '펼치면 이전 파일이 드러난다').toBeGreaterThan(0);
    await rp.shot(adminView, 'D05-case-eq-expanded');

    F(
      'D5',
      'obs',
      `관리자 Case 화면 실측 — 접힘 상태 '· 이전' 0개 → [이전 1] 클릭 후 ${String(afterExpand)}개. ` +
        `최신만 먼저 보이고 이전은 눌러야 나온다(옛 도면 오승인 방지).`,
    );
  }, 300_000);

  // ── ③ 송금 완납 통지(8호 결정) ──────────────────────────────────────────────
  test('D6. 부분 송금은 알리지 않는다 — 원장은 아직 확정이 아니다', async (ctx) => {
    if (lineB.poId === null) return ctx.skip();
    const r = await remit(lineB.poId, {
      remittedOn: '2026-08-11',
      amount: HALF,
      exchangeRate: 1380,
      memo: '[여정 33호] 선급 50%',
    });
    expect(r.status, `1차 부분 송금: ${JSON.stringify(r.json)}`).toBe(200);
    expect(r.json?.data?.summary?.status, '부분 송금 상태').toBe('partial');
    expect(r.json?.data?.summary?.balance, '잔액 절반 남음').toBe(HALF);

    await settle();
    const logs = await settledLogs(lineB.poId);
    // 결정 ③의 핵심 — 회차마다 보내면 알림이 사실보다 앞선다(원장은 정정·삭제된다).
    expect(logs.length, '부분 송금은 완납 통지를 만들지 않는다').toBe(0);
    F('D6', 'obs', `부분 송금(${String(HALF)}/${String(PO_USD)}) → 완납 통지 0건(잔액 ${String(HALF)} 남음)`);
  }, 300_000);

  test('D7. 잔액이 0 이 되는 순간 1회 — 그 1회가 원장에 남는다', async (ctx) => {
    if (lineB.poId === null) return ctx.skip();
    const r = await remit(lineB.poId, {
      remittedOn: '2026-08-11',
      amount: HALF,
      exchangeRate: 1395,
      memo: '[여정 33호] 잔금',
    });
    expect(r.status, `2차 잔금 송금: ${JSON.stringify(r.json)}`).toBe(200);
    expect(r.json?.data?.summary?.status, '완납 상태').toBe('paid');
    expect(r.json?.data?.summary?.balance, '잔액 0').toBe(0);

    await settle();
    const logs = await settledLogs(lineB.poId);
    expect(logs.length, '완납 통지 1건').toBe(1);
    const log = logs[0];
    expect(String(log.status), '실제 발송').toBe('sent');
    expect(String(log.recipient), '수신자 = 수주 협력사').toBeTruthy();
    expect(String(log.subject), '제목에 완납이 드러난다').toContain('대금 지급 완료');
    // 총액은 **실제로 보낸 금액**이다(발주가가 아니라 원장 합) — 과지급이면 발주가보다 크다.
    expect(Number((log.params as any)?.paidAmount ?? 0), '기록된 지급 총액').toBe(PO_USD);
    expect(Number((log.params as any)?.count ?? 0), '기록된 송금 회차').toBe(2);
    F(
      'D7',
      'obs',
      `완납 통지 실측 — 1건 sent · 수신 ${String(log.recipient)} · 제목 "${String(log.subject)}" · ` +
        `총액 ${String((log.params as any)?.paidAmount)} ${String((log.params as any)?.currency)} (${String((log.params as any)?.count)}회 분할)`,
    );
  }, 300_000);

  test('D8. 더 보내도 다시 알리지 않는다 — 1회는 발주서당 1회다', async (ctx) => {
    if (lineB.poId === null) return ctx.skip();
    // 과지급(over)으로 만든다. 상태가 바뀌어도 "완납했다"는 안내는 이미 나갔다.
    const extra = await remit(lineB.poId, {
      remittedOn: '2026-08-11',
      amount: 20,
      exchangeRate: 1400,
      memo: '[여정 33호] 추가 송금(과지급)',
    });
    expect(extra.status, `추가 송금: ${JSON.stringify(extra.json)}`).toBe(200);
    expect(extra.json?.data?.summary?.status, '과지급 상태').toBe('over');

    await settle();
    const logs = await settledLogs(lineB.poId);
    expect(logs.length, '추가 송금은 통지를 늘리지 않는다').toBe(1);

    // 삭제로 잔액을 되살렸다가 다시 0 을 만들어도 마찬가지다 — 이미 나간 메일은 못 되돌린다.
    const list = await api(A, 'GET', `/api/admin/pcb-remittances/${String(lineB.poId)}`);
    const extraRow = (list.json?.data?.remittances ?? []).find((x: any) => x.amount === 20);
    expect(extraRow, '추가 송금 행').toBeTruthy();
    const rm = await api(
      A,
      'DELETE',
      `/api/admin/pcb-remittances/${String(lineB.poId)}/${String(extraRow.id)}`,
    );
    expect(rm.status, `추가 송금 삭제: ${JSON.stringify(rm.json)}`).toBe(200);
    expect(rm.json?.data?.summary?.status, '삭제 후 다시 완납').toBe('paid');

    await settle();
    expect((await settledLogs(lineB.poId)).length, '재-완납도 통지를 늘리지 않는다').toBe(1);
    F(
      'D8',
      'obs',
      `중복 방지 실측 — 과지급 전이·행 삭제로 재-완납까지 겪었지만 통지는 1건 그대로. ` +
        `'1회'의 근거는 sp_mail_log(kind=pcb_remit_settled, refType=pcb_po) 조회다.`,
    );
  }, 300_000);

  // ── ② 환불 처리 기록(10호 결정) ─────────────────────────────────────────────
  test('D9. 부분 취소 → 과입금이 생긴다(돌려줄 돈)', async (ctx) => {
    if (odId === null || lineA.ctId === null) return ctx.skip();
    const res = await api(A, 'PATCH', `/api/admin/orders/${odId}/items/status`, {
      ctIds: [lineA.ctId],
      target: '취소',
    });
    expect(res.status, `부분 취소: ${JSON.stringify(res.json)}`).toBe(200);
    expect(res.json?.data?.processed, '취소된 줄').toEqual([lineA.ctId]);
    expect(res.json?.data?.orderCancelled, '전량 취소 아님').toBe(false);

    const od = await orderRow(odId);
    const misu = Number(od.od_misu);
    // 전액을 이미 받은 뒤 한 줄이 사라졌으니 미수는 음수 = 돌려줄 돈이다.
    expect(misu, '부분 취소 후 과입금 발생').toBeLessThan(0);
    expect(Number(od.od_refund_price), '아직 아무것도 돌려주지 않았다').toBe(0);
    F('D9', 'obs', `부분 취소 → od_misu=${String(misu)}(과입금 ${String(-misu)}원) · od_refund_price=0`);
  }, 300_000);

  test('D10. 환불 처리 기록 → 과입금이 0 으로 닫히고 이력이 남는다', async (ctx) => {
    if (odId === null) return ctx.skip();
    const before = await orderRow(odId);
    const overpaid = -Number(before.od_misu);
    expect(overpaid, '기준선: 돌려줄 돈이 있다').toBeGreaterThan(0);

    const rec = await api(A, 'PATCH', `/api/admin/orders/${odId}/refund`, {
      refundPrice: overpaid,
      note: '[여정 33호] 계좌 이체 확인',
    });
    expect(rec.status, `환불 기록: ${JSON.stringify(rec.json)}`).toBe(200);

    const after = await orderRow(odId);
    expect(Number(after.od_refund_price), '환불 누계가 기록된다').toBe(overpaid);
    // 결정 ②의 요점 — od_refund_price 는 미수 산식에 이미 들어 있어 과입금이 스스로 닫힌다.
    expect(Number(after.od_misu), '과입금이 0 으로 닫힌다').toBe(0);
    // 금액만 남으면 "두 번 줬나"를 되짚을 수 없다 — 누가·언제·얼마가 함께 남아야 한다.
    const history = String(after.od_mod_history ?? '');
    expect(history, '이력에 환불이 남는다').toContain('환불');
    expect(history, '이력에 처리자가 남는다').toContain('e2e-admin');
    expect(history, '이력에 메모가 남는다').toContain('계좌 이체 확인');

    F(
      'D10',
      'obs',
      `환불 기록 실측 — ${String(overpaid)}원 기록 후 od_misu ${String(before.od_misu)}→0 · ` +
        `od_refund_price=${String(after.od_refund_price)} · 이력 "${history.trim().split('\n').pop() ?? ''}"`,
    );
  }, 300_000);

  test('D11. 관리자 화면 — 과입금 자리에 [환불 처리 기록]이 서 있다', async (ctx) => {
    if (odId === null) return ctx.skip();
    // ⚠ 목록은 주문번호를 **하이픈 표기**로 찍는다(formatOdId — 16자리면 8-8). 원본 문자열로
    //   찾으면 영영 못 만난다. 검색 필드 기본값은 od_id 라 입력만 하면 좁혀진다.
    const shown = odId.length === 16 ? `${odId.slice(0, 8)}-${odId.slice(8)}` : odId;
    await rp.view(adminView, '/app/admin/orders', 'D11-admin-orders');
    await adminView.page.getByPlaceholder('검색어').first().fill(odId);
    await adminView.page.keyboard.press('Enter');
    await adminView.page.getByText(shown).first().waitFor({ timeout: 20_000 });
    await adminView.page.getByText(shown).first().click();

    // 드로어의 금액 블록 — 이미 D10 에서 정리했으므로 '환불액' 행에 기록 버튼이 선다.
    const btn = adminView.page.getByRole('button', { name: '환불 처리 기록' });
    await btn.first().waitFor({ timeout: 20_000 });
    await rp.shot(adminView, 'D11-drawer-refund');

    // 눌러 보면 **돈을 보내지 않는다**는 것을 문구가 먼저 말한다 — 그래야 실제 송금을
    // 빠뜨리지 않는다.
    await btn.first().click();
    const hint = adminView.page.getByText(/실제 환불은 결제사·계좌에서 처리/);
    await hint.first().waitFor({ timeout: 15_000 });
    await rp.shot(adminView, 'D11-drawer-refund-open');
    F(
      'D11',
      'obs',
      `관리자 드로어 실측 — 환불액 행에 [환불 처리 기록] 노출 · 패널 문구가 "실제 환불은 ` +
        `결제사·계좌에서 처리"를 먼저 말한다(기록과 실행의 경계).`,
    );
  }, 300_000);

  test('D12. 정리 준비 — 주문 되돌리기', async (ctx) => {
    if (odId === null) return ctx.skip();
    const back = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '주문',
    });
    expect(back.status, `주문 되돌리기: ${JSON.stringify(back.json)}`).toBe(200);
    F('D12', 'obs', `정리 준비 — od=${odId} '주문' 복귀. 문서·발주는 cleanup-probe 로.`);
  }, 180_000);
});
