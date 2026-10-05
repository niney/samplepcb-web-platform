// Smart BOM 여정 25호 — 고객 견적 취소: **현행 동작 관찰**(정책 결정 전 박제).
//
// 고객이 견적을 거둬들일 때 실제로 무슨 일이 벌어지는지를 상태별로 끝까지 따라가 본다.
// 고치기 전에 "지금 어떻게 되는가"를 눈으로 보려는 편이라, 어서션은 **현재 동작**을 못박고
// 문제로 보이는 지점은 리포트에 bug/ux 로 남긴다(정책을 바꾸면 이 스펙의 기대값도 같이 바뀐다).
//
//   K01~K03  견적요청(requested) — 협력사 RFQ 가 나간 뒤 화면의 [요청 취소]
//   K04      취소한 견적을 고객이 삭제 — 협력사 회신 기록의 행방
//   K05      검토 중(reviewing) — 화면엔 버튼이 없는데 API 는?
//   K06      회신 완료(answered)
//   K07      공급사 검색이 도는 중의 취소
//   K08      대조 — 같은 취소를 관리자 경로로 하면(RFQ 가 닫힌다)
//   K09      관리자 회신 확정과 고객 취소가 겹치는 빈도(자연 타이밍 — 비결정적 관찰)
//   K10      겹쳤을 때의 결과(테스트가 견적 행을 잠가 순서를 고정한 재현)
//
// 무대는 DB 직삽입 시드(엔진·공급사 API 불필요). 협력사 메일은 로컬 Mailpit 이 받는다.
// 생성물은 자동 정리하지 않는다 — 리포트의 대장으로 화면에서 직접 열어 볼 수 있게 남긴다.
// 리포트: output/journey/findings-bom-quote-cancel.md · 스크린샷: output/journey/cancel-K*.png
// 실행: pnpm -F e2e journey:bom:25
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newSession,
  num,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const CUSTOMER_MB_ID = 'e2e-customer';
const PARTNER_NAME = '협력1';
// K09 — 회신 확정을 보낸 뒤 취소를 끼워 넣는 시점(확정 처리 시간 대비 비율).
const RACE_OFFSETS = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1] as const;
// K10 — 잠긴 행 앞에서 요청이 "읽고, 쓰기 직전"까지 가도록 기다리는 시간(읽기는 수십 ms 면 끝난다).
const LOCK_SETTLE_MS = 700;

interface SeedLine {
  mpn: string;
  manufacturerName: string;
  description: string;
  bomQty: number;
  orderQty: number;
  unitPrice: number;
}

const LINES: readonly SeedLine[] = [
  { mpn: 'STM32F103C8T6', manufacturerName: 'STMicroelectronics', description: 'Arm Cortex-M3 MCU 64 KB LQFP-48', bomQty: 1, orderQty: 5, unitPrice: 4_850 },
  { mpn: 'GRM188R71H104KA93D', manufacturerName: 'Murata', description: '0.1 µF 50 V X7R 0603 MLCC', bomQty: 4, orderQty: 20, unitPrice: 405 },
  { mpn: 'B2B-XH-A', manufacturerName: 'JST', description: '2-position 2.5 mm wire-to-board header', bomQty: 2, orderQty: 10, unitPrice: 1_240 },
] as const;
const REPLY_TOTAL = LINES.reduce((sum, line) => sum + line.unitPrice * line.orderQty, 0);
const SHIPPING_FEE = 5_000;
const MANAGEMENT_FEE = 3_500;

interface Seeded {
  quoteId: string;
  title: string;
  itemIds: string[];
}

interface RfqRow {
  rfqId: number;
  partnerId: number;
  status: 'requested' | 'quoted' | 'closed';
  items: { rfqItemId: number; quoteItemId: string; unitPrice: number | null }[];
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

const futureDate = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** 고객이 낸 견적 1건을 원하는 상태로 세운다. 제목에는 화면 검사에 쓰는 낱말(버튼 이름)을 넣지 않는다. */
async function seedQuote(
  label: string,
  state: { status: 'requested' | 'answered'; enrichStatus?: 'done' | 'searching' },
): Promise<Seeded> {
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId: CUSTOMER_MB_ID,
        title: `[BOM 여정 25호] 철회 관찰 ${label} ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: state.status,
        buildStatus: 'ready',
        enrichStatus: state.enrichStatus ?? 'done',
        setQty: 2,
        spareQty: 1,
        itemsTotal: state.status === 'answered' ? REPLY_TOTAL : 0,
        shippingFee: SHIPPING_FEE,
        managementFee: MANAGEMENT_FEE,
        finalTotal: state.status === 'answered' ? REPLY_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE : SHIPPING_FEE + MANAGEMENT_FEE,
        uncostedCount: state.status === 'answered' ? 0 : LINES.length,
        requestedAt: new Date(now.getTime() - 60_000),
        adminMemo: `[BOM 여정 25호 ${RUN_KEY}] fixture ${label}`,
        ...(state.status === 'answered'
          ? {
              answeredAt: now,
              answerNote: '여정 25호 확정 견적 무대입니다.',
              confirmedShippingFee: SHIPPING_FEE,
              confirmedManagementFee: MANAGEMENT_FEE,
              confirmedTotal: REPLY_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE,
            }
          : {}),
      },
    });
    const itemIds: string[] = [];
    for (const [index, line] of LINES.entries()) {
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          bomQty: line.bomQty,
          orderQty: line.orderQty,
          matchStatus: 'manual',
          selectionSource: 'none',
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        },
      });
      itemIds.push(String(item.id));
    }
    return { quoteId: String(quote.id), title: quote.title, itemIds };
  });
}

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 25호 — 고객 견적 취소(현행 동작 관찰)', () => {
  const rp = createJourneyReport(
    'findings-bom-quote-cancel',
    'BOM 여정 25호 고객 견적 취소 — 현행 동작 관찰 리포트',
  );
  const { F, ledger } = rp;

  let customerView: E2eSession;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = ''; // 관리자
  let C = ''; // 고객
  let P = ''; // 협력사

  let qa: Seeded | null = null; // 견적요청 + 미회신 RFQ → 화면 취소(남김)
  let qaRfqId: number | null = null;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 에 연결 계정이 필요합니다`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    C = signJwt({ mbId: CUSTOMER_MB_ID, ttlSec: 7_200 });
    P = signJwt({ mbId: partner.mbId, ttlSec: 7_200 });
    customerView = await newSession({ mbId: CUSTOMER_MB_ID, ttlSec: 7_200 });
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
    partnerView = await newSession({ mbId: partner.mbId, ttlSec: 7_200 }, { partnerModule: 'bom' });
    rp.watchHttp(customerView, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(partnerView, '협력사');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customerView, 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  // ── 공용 조작 ─────────────────────────────────────────────────────────────
  const quoteRow = async (quoteId: string): Promise<{ status: string; enrichStatus: string; answeredAt: Date | null } | null> =>
    getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quoteId) },
      select: { status: true, enrichStatus: true, answeredAt: true },
    });

  const loadRfqs = async (quoteId: string): Promise<RfqRow[]> => {
    const response = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    return response.json?.data?.rfqs ?? [];
  };

  /** 관리자가 협력사 한 곳에 RFQ 를 보낸다(메일은 Mailpit). */
  const sendRfq = async (quoteId: string): Promise<RfqRow> => {
    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, {
      partnerIds: [num(partner.id)],
    });
    expect(sent.status, `RFQ 발송: ${JSON.stringify(sent.json)}`).toBe(200);
    const rfq = (await loadRfqs(quoteId)).find((row) => row.partnerId === num(partner.id));
    if (rfq === undefined) throw new Error('RFQ 가 생성되지 않았습니다');
    return rfq;
  };

  /** 협력사가 포털 API 로 전 품목을 회신한다. 반환은 HTTP 상태(닫힌 RFQ 면 409). */
  const partnerReply = async (rfqId: number, itemIds: readonly string[], memo: string): Promise<{ status: number; error: string | null }> => {
    const reply = await api(P, 'PUT', `/api/partner/rfqs/${String(rfqId)}`, {
      items: LINES.map((line, index) => ({
        quoteItemId: itemIds[index] ?? '',
        unitPrice: line.unitPrice,
        replyQty: line.orderQty,
        moq: 1,
        stock: line.orderQty + 200,
        dateCode: '25+',
        leadTime: '재고 보유',
        memo: null,
      })),
      deliveryDate: futureDate(9),
      memo,
    });
    return { status: reply.status, error: reply.json?.error ?? null };
  };

  const cancelByCustomer = async (quoteId: string): Promise<{ status: number; body: string }> => {
    const res = await api(C, 'POST', `/api/bom/quotes/${quoteId}/cancel`);
    return { status: res.status, body: JSON.stringify(res.json?.error ?? res.json?.message ?? res.json?.data?.status ?? '') };
  };

  const cancelButton = (session: E2eSession) =>
    session.page.getByRole('button', { name: '요청 취소', exact: true });

  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 발송 원장(sp_mail_log — 메일·알림톡·SMS 공용) 행 수. 앞뒤 차이로 "알림이 나갔는가"를 본다.
   * 발송 기록은 응답보다 늦게 적힐 수 있어, 두 번 연속 같은 값이 나올 때까지 기다린 값을 쓴다.
   */
  const mailLedgerCount = async (): Promise<number> => {
    let last: number = await getPrisma().spMailLog.count();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await pause(400);
      const now: number = await getPrisma().spMailLog.count();
      if (now === last) return now;
      last = now;
    }
    return last;
  };

  // ── 경합 무대(K09·K10 공용) ───────────────────────────────────────────────
  const completeBody = {
    answerNote: '여정 25호 경합 관찰',
    confirmedShippingFee: SHIPPING_FEE,
    confirmedManagementFee: MANAGEMENT_FEE,
    confirmedTotal: REPLY_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE,
    sendEmail: false,
  };

  /** 검토를 끝낸(협력사 회신 선정·품목 확인 완료) 견적 — [회신 확정]만 누르면 되는 상태. */
  const prepareCompletable = async (label: string): Promise<Seeded> => {
    const q = await seedQuote(label, { status: 'requested' });
    expect((await api(A, 'PATCH', `/api/admin/bom-quotes/${q.quoteId}`, { status: 'reviewing' })).status).toBe(200);
    const rfq = await sendRfq(q.quoteId);
    expect((await partnerReply(rfq.rfqId, q.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 경합 ${label}`)).status).toBe(200);
    const replied = (await loadRfqs(q.quoteId)).find((row) => row.rfqId === rfq.rfqId);
    for (const item of replied?.items ?? []) {
      const selected = await api(A, 'POST', `/api/admin/bom-quotes/${q.quoteId}/rfq-selection`, {
        kind: 'partner',
        itemId: item.quoteItemId,
        rfqItemId: item.rfqItemId,
      });
      expect(selected.status, JSON.stringify(selected.json)).toBe(200);
    }
    const detail = (await api(A, 'GET', `/api/admin/bom-quotes/${q.quoteId}`)).json?.data;
    const pending = (detail?.items ?? []).filter((item: any) => item.adminReview?.required && !item.adminReview?.completed);
    if (pending.length > 0) {
      const reviewed = await api(A, 'PUT', `/api/admin/bom-quotes/${q.quoteId}/item-reviews`, {
        itemIds: pending.map((item: any) => item.id),
        completed: true,
        expectedQuoteUpdatedAt: detail.updatedAt,
        reason: `[BOM 여정 25호 ${RUN_KEY}] 경합 준비`,
      });
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
    }
    return q;
  };

  // ══════════════════════════════════════════════════════════════════════════
  test('K01. 무대 — 견적요청 상태에서도(검토 시작 전) 협력사 RFQ 가 나간다', async () => {
    qa = await seedQuote('A', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qa.quoteId}(A — 견적요청 + 미회신 RFQ → 화면에서 취소, 삭제하지 않고 남김)`);
    const rfq = await sendRfq(qa.quoteId);
    qaRfqId = rfq.rfqId;
    ledger.push(`sp_bom_rfq #${String(qaRfqId)}(A 의 ${PARTNER_NAME} RFQ)`);
    expect((await quoteRow(qa.quoteId))?.status, '검토 시작 전이다').toBe('requested');
    expect(rfq.status).toBe('requested');

    await rp.assertView(customerView, `/app/bom/${qa.quoteId}`, 'cancel-K01-customer-requested', [qa.title]);
    await cancelButton(customerView).waitFor({ state: 'visible', timeout: 30_000 });
    await rp.assertView(partnerView, `/app/partner/bom/rfqs/${String(qaRfqId)}`, 'cancel-K01-partner-open', [qa.title]);
    F('K01', 'obs', `견적요청(requested) 상태에서 관리자가 RFQ 를 보낼 수 있다 — 고객 화면에는 [요청 취소]가 보이고, ${PARTNER_NAME} 포털에는 회신 대기 RFQ #${String(qaRfqId)} 가 뜬다`);
  }, 180_000);

  test('K02. 고객 화면 [요청 취소] — 확인창 없이 한 번 클릭으로 취소되고 되돌릴 수 없다', async (ctx) => {
    if (qa === null) return ctx.skip();
    const page = customerView.page;
    let nativeDialogs = 0;
    page.on('dialog', (dialog: any) => {
      nativeDialogs += 1;
      void dialog.dismiss();
    });
    const cancelWait = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/bom/quotes/${qa?.quoteId ?? ''}/cancel`),
      { timeout: 30_000 },
    );
    const mailsBefore = await mailLedgerCount();
    await cancelButton(customerView).click();
    // 확인창이 있다면 요청이 나가기 전에 떠 있어야 한다 — 클릭 직후의 대화상자 수를 센다.
    const dialogsRightAfterClick = await page.locator('[role="dialog"], [role="alertdialog"]').count();
    expect((await cancelWait).status()).toBe(200);
    expect((await quoteRow(qa.quoteId))?.status).toBe('canceled');
    expect(nativeDialogs + dialogsRightAfterClick, '현재 동작: 확인 절차가 없다').toBe(0);

    // 응답 직후에는 화면이 아직 취소 전 모습이다 — 배지가 바뀌고 버튼이 사라진 뒤에 찍는다.
    await cancelButton(customerView).waitFor({ state: 'detached', timeout: 15_000 });
    await page.getByText('취소됨', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
    await rp.shot(customerView, 'cancel-K02-customer-canceled');
    expect(await cancelButton(customerView).count(), '취소 뒤에는 버튼이 사라진다').toBe(0);
    const back = await api(C, 'POST', `/api/bom/quotes/${qa.quoteId}/request`, { title: qa.title });
    const notices = (await mailLedgerCount()) - mailsBefore;
    F('K02', 'ux', `[요청 취소]는 확인창 없이 즉시 실행된다(대화상자 0). 취소는 종착 상태라 다시 요청할 수 없다(재요청 ${String(back.status)}) — 잘못 누르면 새로 올려야 한다`);
    F('K02', 'obs', `고객이 취소해도 누구에게도 알림이 가지 않는다(발송 원장 증가 ${String(notices)}건) — RFQ 를 받은 협력사도, 검토하던 관리자도 화면을 열어 봐야 안다`);
  }, 120_000);

  test('K03. 취소 뒤에도 협력사 RFQ 는 열려 있고, 협력사 회신이 그대로 받아들여진다', async (ctx) => {
    if (qa === null || qaRfqId === null) return ctx.skip();
    const before = (await loadRfqs(qa.quoteId)).find((row) => row.rfqId === qaRfqId);
    expect(before?.status, '현재 동작: 고객 취소는 RFQ 를 닫지 않는다').toBe('requested');
    const listedBefore = ((await api(P, 'GET', '/api/partner/rfqs')).json?.data?.items ?? [])
      .find((row: any) => row.rfqId === qaRfqId);
    expect(listedBefore?.status, '협력사 포털 목록에 회신 대기로 남아 있다').toBe('requested');

    await rp.assertView(partnerView, `/app/partner/bom/rfqs/${String(qaRfqId)}`, 'cancel-K03-partner-still-open', [qa.title, '회신 저장']);
    const reply = await partnerReply(qaRfqId, qa.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 취소된 견적에 회신`);
    expect(reply.status, '현재 동작: 취소된 견적의 RFQ 에 회신이 저장된다').toBe(200);
    const after = (await loadRfqs(qa.quoteId)).find((row) => row.rfqId === qaRfqId);
    expect(after?.status).toBe('quoted');

    await rp.view(partnerView, `/app/partner/bom/rfqs/${String(qaRfqId)}`, 'cancel-K03-partner-replied');
    await rp.view(adminView, `/app/admin/smartbom/cases/${qa.quoteId}`, 'cancel-K03-admin-case');
    F('K03', 'bug', `고객이 취소한 견적 #${qa.quoteId} 의 RFQ #${String(qaRfqId)} 가 닫히지 않는다 — 취소 직후에도 협력사 포털 목록에 '회신 대기'(requested)로 떠 있고 입력 칸·[회신 저장]이 그대로 열려 있다. 회신 저장이 200 으로 통과해 '회신 완료'(quoted)가 된다. 협력사는 죽은 견적에 견적을 내고, 관리자 Case 에는 '취소' 배지 옆에 그 회신이 올라온다. 문서 규칙(SMARTBOM_PARTNER_RFQ §2.4-7)은 "취소 시 RFQ 일괄 마감"`);
  }, 180_000);

  test('K04. 취소한 견적을 고객이 삭제하면 협력사가 낸 회신 기록까지 사라진다', async () => {
    const qb = await seedQuote('B', { status: 'requested' });
    const rfq = await sendRfq(qb.quoteId);
    expect((await partnerReply(rfq.rfqId, qb.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 삭제 전 회신`)).status).toBe(200);
    const prisma = getPrisma();
    const rfqItemsBefore = await prisma.spBomRfqItem.count({ where: { rfqId: BigInt(rfq.rfqId) } });
    expect(rfqItemsBefore, '협력사가 3품목 가격을 냈다').toBe(LINES.length);
    await rp.assertView(partnerView, `/app/partner/bom/rfqs/${String(rfq.rfqId)}`, 'cancel-K04-partner-before-delete', [qb.title]);

    expect((await cancelByCustomer(qb.quoteId)).status).toBe(200);
    const deleted = await api(C, 'DELETE', `/api/bom/quotes/${qb.quoteId}`);
    expect(deleted.status, `현재 동작: 취소 견적은 고객이 삭제할 수 있다 ${JSON.stringify(deleted.json)}`).toBe(200);

    expect(await prisma.spBomQuote.findUnique({ where: { id: BigInt(qb.quoteId) } })).toBeNull();
    const rfqLeft = await prisma.spBomRfq.count({ where: { id: BigInt(rfq.rfqId) } });
    const rfqItemsLeft = await prisma.spBomRfqItem.count({ where: { rfqId: BigInt(rfq.rfqId) } });
    expect(rfqLeft, '현재 동작: RFQ 가 견적과 함께 지워진다').toBe(0);
    expect(rfqItemsLeft, '현재 동작: 협력사 회신 행도 함께 지워진다').toBe(0);
    const partnerRead = await api(P, 'GET', `/api/partner/rfqs/${String(rfq.rfqId)}`);
    expect(partnerRead.status).toBe(404);
    const adminRead = await api(A, 'GET', `/api/admin/bom-quotes/${qb.quoteId}`);
    expect(adminRead.status).toBe(404);

    await rp.view(partnerView, `/app/partner/bom/rfqs/${String(rfq.rfqId)}`, 'cancel-K04-partner-after-delete');
    await rp.view(adminView, `/app/admin/smartbom/cases/${qb.quoteId}`, 'cancel-K04-admin-after-delete');
    F('K04', 'bug', `취소 → 삭제 두 번의 고객 조작으로 견적 #${qb.quoteId} 와 함께 RFQ #${String(rfq.rfqId)}·협력사 회신 ${String(rfqItemsBefore)}행이 통째로 사라진다(협력사 포털 404, 관리자 Case 404). PCB 는 같은 문제를 고객 삭제 가드(PARTNER_TRACK_ACTIVE 409)로 막는데 BOM 에는 없다`);
  }, 180_000);

  test('K05. 검토 중 — 화면에는 취소 버튼이 없지만 API 는 취소를 받아 준다', async () => {
    const qc = await seedQuote('C', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qc.quoteId}(C — 검토 중에 API 로 취소, 회신 받은 RFQ 가 열린 채 남음)`);
    const started = await api(A, 'PATCH', `/api/admin/bom-quotes/${qc.quoteId}`, { status: 'reviewing' });
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    const rfq = await sendRfq(qc.quoteId);
    ledger.push(`sp_bom_rfq #${String(rfq.rfqId)}(C 의 ${PARTNER_NAME} RFQ)`);
    expect((await partnerReply(rfq.rfqId, qc.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 검토 중 회신`)).status).toBe(200);

    await rp.assertView(customerView, `/app/bom/${qc.quoteId}`, 'cancel-K05-customer-reviewing', [qc.title]);
    expect(await cancelButton(customerView).count(), '현재 동작: 검토 중에는 화면에 취소 버튼이 없다').toBe(0);

    const canceled = await cancelByCustomer(qc.quoteId);
    expect(canceled.status, `현재 동작: API 는 검토 중 취소를 허용한다 ${canceled.body}`).toBe(200);
    expect((await quoteRow(qc.quoteId))?.status).toBe('canceled');

    // 관리자가 모르고 이어서 조작하면 — 상태 검사로 전부 거절된다.
    const resend = await api(A, 'POST', `/api/admin/bom-quotes/${qc.quoteId}/rfqs`, { partnerIds: [num(partner.id)] });
    const rfqAfter = (await loadRfqs(qc.quoteId)).find((row) => row.rfqId === rfq.rfqId);
    const firstItem = rfqAfter?.items[0];
    const select = await api(A, 'POST', `/api/admin/bom-quotes/${qc.quoteId}/rfq-selection`, {
      kind: 'partner',
      itemId: firstItem?.quoteItemId ?? qc.itemIds[0] ?? '',
      rfqItemId: firstItem?.rfqItemId ?? null,
    });
    const complete = await api(A, 'POST', `/api/admin/bom-quotes/${qc.quoteId}/complete`, {
      confirmedShippingFee: SHIPPING_FEE,
      confirmedManagementFee: MANAGEMENT_FEE,
      confirmedTotal: REPLY_TOTAL + SHIPPING_FEE + MANAGEMENT_FEE,
      sendEmail: false,
    });
    expect([resend.status, select.status, complete.status], '취소된 견적의 관리자 조작은 모두 409').toEqual([409, 409, 409]);
    expect(rfqAfter?.status, '현재 동작: 회신 받은 RFQ 도 열린 채 남는다').toBe('quoted');
    const reReply = await partnerReply(rfq.rfqId, qc.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 취소 뒤 재회신`);

    await rp.view(adminView, `/app/admin/smartbom/cases/${qc.quoteId}`, 'cancel-K05-admin-case-after');
    await rp.view(customerView, `/app/bom/${qc.quoteId}`, 'cancel-K05-customer-after');
    F('K05', 'ux', `검토 중: 화면에는 [요청 취소]가 없는데 API(POST /cancel)는 200 으로 취소한다 — 화면과 서버의 허용 범위가 다르다. 취소 뒤 관리자 조작은 RFQ 발송 ${String(resend.status)}(${String(resend.json?.error)})·선정 ${String(select.status)}(${String(select.json?.error)})·회신 확정 ${String(complete.status)}(${String(complete.json?.error)}) 로 막힌다`);
    F('K05', 'bug', `검토 중 취소에서도 RFQ #${String(rfq.rfqId)} 는 quoted 로 열려 있고 협력사 재회신이 ${String(reReply.status)} 로 통과한다`);
  }, 240_000);

  test('K06. 회신 완료 — 고객 취소는 거절된다(화면에도 버튼 없음)', async () => {
    const qd = await seedQuote('D', { status: 'answered' });
    ledger.push(`sp_bom_quote #${qd.quoteId}(D — 회신 완료, 취소 거절 대조군)`);
    const res = await cancelByCustomer(qd.quoteId);
    expect(res.status, '현재 동작: answered 에서는 취소 불가').toBe(409);
    expect((await quoteRow(qd.quoteId))?.status).toBe('answered');
    await rp.assertView(customerView, `/app/bom/${qd.quoteId}`, 'cancel-K06-customer-answered', [qd.title]);
    expect(await cancelButton(customerView).count()).toBe(0);
    F('K06', 'obs', `회신 완료 견적은 고객이 취소할 수 없다(API ${String(res.status)}, 화면 버튼 없음) — 주문하지 않고 두는 것 말고는 거절할 방법이 없다`);
  }, 120_000);

  test('K07. 공급사 검색이 도는 중에 취소하면 "검색 중" 이 풀리지 않고 화면이 계속 폴링한다', async () => {
    // 관리자의 [최신 시세 확인]이 도는 동안(견적의 enrichStatus=searching)을 직삽입으로 재현한다.
    const qe = await seedQuote('E', { status: 'requested', enrichStatus: 'searching' });
    ledger.push(`sp_bom_quote #${qe.quoteId}(E — 검색 중에 취소, enrichStatus 가 searching 으로 남음)`);
    expect((await cancelByCustomer(qe.quoteId)).status).toBe(200);
    const row = await quoteRow(qe.quoteId);
    expect(row?.status).toBe('canceled');
    expect(row?.enrichStatus, '현재 동작: 검색 중 표시가 그대로 남는다').toBe('searching');

    const page = customerView.page;
    let detailGets = 0;
    const onRequest = (request: any): void => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/bom/quotes/${qe.quoteId}`) {
        detailGets += 1;
      }
    };
    page.on('request', onRequest);
    await page.goto(`${BASE_URL}/app/bom/${qe.quoteId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10_500);
    page.off('request', onRequest);
    await rp.shot(customerView, 'cancel-K07-customer-polling');
    expect(detailGets, '현재 동작: 취소된 견적 화면이 3초마다 상세를 다시 받는다').toBeGreaterThanOrEqual(3);
    F('K07', 'bug', `검색이 도는 중에 취소하면 견적 #${qe.quoteId} 의 enrichStatus 가 searching 으로 굳는다 — 취소는 그 값을 건드리지 않고, 뒤늦게 도착한 검색 결과는 취소 견적에 반영되지 않으며, 그때의 정리(failed 로 되돌림)도 상태가 requested·reviewing 일 때만 걸린다. 화면에는 '취소됨' 배지와 "공급사에서 가격·재고를 확인하고 있습니다 0%" 가 함께 뜨고, 열어 둔 10초 동안 상세 조회가 ${String(detailGets)}번 나갔다(닫을 때까지 계속). 무대는 검색 중 상태를 직삽입한 것(엔진 미기동)`);
  }, 120_000);

  test('K08. 대조 — 같은 취소를 관리자 경로로 하면 RFQ 가 닫히고 협력사 회신이 막힌다', async () => {
    const qf = await seedQuote('F', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qf.quoteId}(F — 대조군: 관리자 API 로 취소, RFQ 가 마감됨)`);
    const rfq = await sendRfq(qf.quoteId);
    ledger.push(`sp_bom_rfq #${String(rfq.rfqId)}(F 의 ${PARTNER_NAME} RFQ — 마감)`);

    const mailsBefore = await mailLedgerCount();
    const canceled = await api(A, 'PATCH', `/api/admin/bom-quotes/${qf.quoteId}`, { status: 'canceled' });
    expect(canceled.status, JSON.stringify(canceled.json)).toBe(200);
    expect((await quoteRow(qf.quoteId))?.status).toBe('canceled');
    const after = (await loadRfqs(qf.quoteId)).find((row) => row.rfqId === rfq.rfqId);
    expect(after?.status, '관리자 경로는 RFQ 를 함께 닫는다').toBe('closed');
    const reply = await partnerReply(rfq.rfqId, qf.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 마감 뒤 회신 시도`);
    expect([reply.status, reply.error], '닫힌 RFQ 에는 회신할 수 없다').toEqual([409, 'RFQ_CLOSED']);

    await rp.view(partnerView, `/app/partner/bom/rfqs/${String(rfq.rfqId)}`, 'cancel-K08-partner-closed');
    const notices = (await mailLedgerCount()) - mailsBefore;
    F('K08', 'obs', `대조: 관리자 API(PATCH status=canceled)로 취소하면 RFQ #${String(rfq.rfqId)} 가 closed 로 닫히고 협력사 회신은 ${String(reply.status)}(${String(reply.error)})로 막힌다 — 닫는 장치(closeRfqsForQuote)는 이미 있고, 고객 취소 경로만 그것을 부르지 않는다(K03·K05). 닫을 때 협력사에게 가는 알림은 없다(발송 원장 증가 ${String(notices)}건 — 상태만 바뀐다)`);
  }, 180_000);

  test('K09. 경합 빈도 — 관리자 회신 확정 도중에 고객 취소가 끼어들 때(시차를 바꿔 가며, 비결정적)', async () => {
    // 경합 무대는 볼거리가 아니라 발판이다 — 겹침이 실제로 난 건만 남기고 끝에서 지운다.
    const scaffoldIds: bigint[] = [];

    // 대조군 — 취소 없이 확정만. 무대가 실제로 확정되는지 보고, 확정에 걸리는 시간을 잰다.
    const control = await prepareCompletable('R0');
    scaffoldIds.push(BigInt(control.quoteId));
    const controlStart = performance.now();
    const controlDone = await api(A, 'POST', `/api/admin/bom-quotes/${control.quoteId}/complete`, completeBody);
    const completeMs = Math.max(1, Math.round(performance.now() - controlStart));
    expect(controlDone.status, `대조군 확정: ${JSON.stringify(controlDone.json)}`).toBe(200);
    expect((await quoteRow(control.quoteId))?.status).toBe('answered');

    // 확정을 먼저 보내고, 그 처리 시간의 0~110% 지점에 취소를 끼워 넣는다.
    const delays = [...new Set(RACE_OFFSETS.map((ratio) => Math.round(completeMs * ratio)))];
    const outcomes: string[] = [];
    let overwritten = 0;
    let completeWon = 0;
    let cancelWon = 0;
    for (const [index, delay] of delays.entries()) {
      const q = await prepareCompletable(`R${String(index + 1)}`);
      const completing = api(A, 'POST', `/api/admin/bom-quotes/${q.quoteId}/complete`, completeBody);
      await pause(delay);
      const canceling = api(C, 'POST', `/api/bom/quotes/${q.quoteId}/cancel`);
      const [complete, cancel] = await Promise.all([completing, canceling]);
      expect([200, 409], `확정 응답 ${JSON.stringify(complete.json?.error ?? '')}`).toContain(complete.status);
      expect([200, 409], `취소 응답 ${JSON.stringify(cancel.json?.error ?? '')}`).toContain(cancel.status);
      const final = await quoteRow(q.quoteId);
      if (complete.status === 200 && cancel.status === 200) {
        overwritten += 1;
        ledger.push(`sp_bom_quote #${q.quoteId}(경합 +${String(delay)}ms — 확정 200·취소 200 이 겹쳐 최종 ${String(final?.status)}, answeredAt ${final?.answeredAt === null ? '없음' : '있음'})`);
      } else {
        scaffoldIds.push(BigInt(q.quoteId));
        if (complete.status === 200) completeWon += 1;
        else cancelWon += 1;
      }
      outcomes.push(`+${String(delay)}ms: 확정 ${String(complete.status)}${complete.status === 200 ? '' : `(${String(complete.json?.error)})`}·취소 ${String(cancel.status)} → ${String(final?.status)}`);
    }
    // e2e 가 방금 만든 발판만(id 로) 지운다 — RFQ·회신은 cascade 로 함께 정리된다.
    await getPrisma().spBomQuote.deleteMany({ where: { id: { in: scaffoldIds }, mbId: CUSTOMER_MB_ID } });
    F(
      'K09',
      overwritten > 0 ? 'bug' : 'obs',
      overwritten > 0
        ? `확정(약 ${String(completeMs)}ms)과 취소가 **둘 다 200** 으로 끝난 경우가 ${String(delays.length)}회 중 ${String(overwritten)}회 나왔다(결과는 K10 과 같다). ${outcomes.join(' / ')}`
        : `자연 타이밍으로는 ${String(delays.length)}회 중 겹침 0회(확정 약 ${String(completeMs)}ms, 취소 승 ${String(cancelWon)}·확정 승 ${String(completeWon)}) — 한쪽이 409 로 깨끗이 진다. 겹치려면 취소가 상태를 읽고 쓰기 전(수 ms) 사이에 확정이 끝나야 한다. 드물지만 막는 장치는 없다(겹쳤을 때의 결과는 K10). ${outcomes.join(' / ')}`,
    );
  }, 600_000);

  test('K10. 경합 결과 — 확정과 취소가 실제로 겹치면(행 잠금으로 순서를 고정한 재현)', async () => {
    // K09 가 보여 주듯 자연 타이밍으로는 좀처럼 겹치지 않는다. 겹쳤을 때 **무슨 일이 남는지**를 보려고
    // 테스트가 견적 행을 잠가 두 요청을 "상태를 읽고, 쓰기 직전"에 세워 둔 뒤 놓는다(확정 → 취소 순).
    // 협력사 회신 저장(saveRfqReply)이 쓰는 것과 같은 잠금(SELECT … FOR UPDATE)이라 제품 코드는 손대지 않는다.
    const q = await prepareCompletable('L');
    ledger.push(`sp_bom_quote #${q.quoteId}(L — 확정과 취소가 겹친 결과: 확정 200·취소 200 인데 최종 취소)`);
    const inFlight: ReturnType<typeof api>[] = [];
    await getPrisma().$transaction(
      async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM sp_bom_quote WHERE id = ${BigInt(q.quoteId)} FOR UPDATE`;
        // 확정: reviewing 을 읽고 품목 확인을 통과한 뒤 상태 쓰기에서 기다린다. 메일은 운영 기본값(발송)대로.
        inFlight.push(api(A, 'POST', `/api/admin/bom-quotes/${q.quoteId}/complete`, { ...completeBody, sendEmail: true }));
        await pause(LOCK_SETTLE_MS);
        // 취소: 아직 reviewing 으로 읽고(확정은 쓰지 못했다) 상태 쓰기에서 확정 뒤에 줄을 선다.
        inFlight.push(api(C, 'POST', `/api/bom/quotes/${q.quoteId}/cancel`));
        await pause(LOCK_SETTLE_MS);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    const [complete, cancel] = await Promise.all(inFlight);
    if (complete === undefined || cancel === undefined) throw new Error('요청이 발사되지 않았습니다');

    const final = await quoteRow(q.quoteId);
    const rfqAfter = (await loadRfqs(q.quoteId))[0];
    expect([complete.status, cancel.status], `현재 동작: 겹치면 둘 다 성공한다 ${JSON.stringify([complete.json?.error, cancel.json?.error])}`).toEqual([200, 200]);
    expect(final?.status, '현재 동작: 나중에 쓴 취소가 확정을 덮는다').toBe('canceled');
    expect(final?.answeredAt, '확정이 실제로 기록됐다는 흔적(회신 시각)').not.toBeNull();
    expect(rfqAfter?.status, '확정이 RFQ 를 닫았다').toBe('closed');

    await rp.view(adminView, `/app/admin/smartbom/cases/${q.quoteId}`, 'cancel-K10-admin-case');
    await rp.view(customerView, `/app/bom/${q.quoteId}`, 'cancel-K10-customer');
    const email = complete.json?.email;
    const mailRow = await getPrisma().spMailLog.findFirst({
      where: { kind: 'bom_quote_answered', refType: 'bom_quote', refId: q.quoteId },
      orderBy: { id: 'desc' },
      select: { status: true, subject: true, recipient: true },
    });
    F('K10', 'bug', `확정과 취소가 겹치면 **둘 다 200** 이다 — 관리자는 "회신 확정" 성공 응답을(응답에 실린 견적 상태는 '${String(complete.json?.data?.status)}'), 고객은 "취소" 성공 응답을 받는다. 남는 것은 status=canceled 인데 answeredAt·확정 금액이 적힌 견적 #${q.quoteId} 이고, 고객 회신 메일은 ${String(email?.status)}${email?.reason === undefined || email?.reason === null ? '' : `(${String(email.reason)})`} → ${String(email?.toEmail)}(발송 원장: ${mailRow === null ? '기록 없음' : `'${String(mailRow.subject)}' ${String(mailRow.status)}`}). 고객은 견적 회신 메일을 받고 들어와 취소된 견적을 본다. 원인은 고객 취소가 상태를 읽은 뒤 조건 없이 쓰기 때문(관리자 쪽은 status+updatedAt 조건부 쓰기). 자연 발생 빈도는 K09`);
  }, 180_000);
});
