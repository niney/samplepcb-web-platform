// Smart BOM 여정 25호 — 고객 견적 취소와 보존 기간 자동 정리.
//
// 정책(2026-10-05, docs/BOM_QUOTE.md "취소와 보존 기간"):
//   · 취소된 견적은 **아무 일도 하지 않는 기록**이다 — 협력사 RFQ 는 닫히고, 고객은 지울 수 없다.
//   · 고객 취소는 요청·검토 중에서 확인창을 거쳐 한다. 확인창이 "며칠 뒤 삭제되는지"를 미리 알린다.
//   · 고지한 날이 지나면 자동 정리가 관리자 강제 삭제와 같은 경로로 지우고 감사 기록을 남긴다.
//   · 관리자는 "삭제 기록" 화면에서 무엇이 지워졌는지와 정리가 제대로 도는지를 본다.
//
// 이 편은 처음에 정책을 정하기 전의 **현행 동작 관찰**로 세워졌다(취소 뒤 열린 RFQ·삭제 시 회신
// 유실·검토 중 화면/서버 불일치·검색 중 굳음·확정↔취소 겹침). 지금은 그 다섯이 닫혔는지를 지킨다.
//
//   K01~K03  견적요청 + 협력사 RFQ → 확인창 → 취소 → RFQ 마감
//   K04      취소한 견적은 고객이 지울 수 없고 협력사 회신이 남는다
//   K05      검토 중에도 화면에서 취소할 수 있다
//   K06      회신 완료는 취소할 수 없다
//   K07      검색이 도는 중에 취소해도 "확인 중"이 남지 않는다
//   K08      관리자 경로 취소도 같은 값을 남긴다
//   K09·K10  관리자 회신 확정과 겹치면 한쪽만 성공한다
//   K11      보존 기간 자동 정리 — 지금 실행·삭제 기록·정상 판정
//   K12      고객에게 보이는 삭제 예정 고지(내역·PHP 견적관리)
//
// 무대는 DB 직삽입 시드(엔진·공급사 API 불필요). 협력사 메일은 로컬 Mailpit 이 받는다.
// 취소로 남긴 무대는 정리하지 않는다 — 리포트 대장으로 화면에서 열어 볼 수 있고, 30일 뒤 자동 정리가 지운다.
// 리포트: output/journey/findings-bom-quote-cancel.md · 스크린샷: output/journey/cancel-K*.png
// 실행: pnpm -F e2e journey:bom:25
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from 'node:url';
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
  newPhpSession,
  newSession,
  num,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const CUSTOMER_MB_ID = 'e2e-customer';
const PARTNER_NAME = '협력1';
const SYSTEM_ACTOR = 'system:retention';
const DAY_MS = 86_400_000;
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

interface SeedState {
  status: 'requested' | 'answered' | 'canceled';
  enrichStatus?: 'done' | 'searching';
  canceledAt?: Date;
  purgeAfter?: Date | null;
  ctId?: number;
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

/** 고객 화면이 삭제 예정일을 쓰는 방식 그대로(한국 날짜, "2026년 11월 4일"). */
const kstLongDate = (value: Date): string =>
  value.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });

/** 고객이 낸 견적 1건을 원하는 상태로 세운다. 제목에는 화면 검사에 쓰는 낱말(버튼 이름)을 넣지 않는다. */
async function seedQuote(label: string, state: SeedState): Promise<Seeded> {
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
        ...(state.canceledAt === undefined ? {} : { canceledAt: state.canceledAt }),
        ...(state.purgeAfter === undefined ? {} : { purgeAfter: state.purgeAfter }),
        ...(state.ctId === undefined ? {} : { ctId: state.ctId }),
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

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 25호 — 고객 견적 취소와 보존 기간 자동 정리', () => {
  const rp = createJourneyReport(
    'findings-bom-quote-cancel',
    'BOM 여정 25호 고객 견적 취소·보존 기간 자동 정리 리포트',
  );
  const { F, ledger } = rp;

  let customerView: E2eSession;
  let adminView: E2eSession;
  let partnerView: E2eSession;
  let partner: PartnerFixture;
  let A = ''; // 관리자
  let C = ''; // 고객
  let P = ''; // 협력사
  let retentionDays = 30;

  let qa: Seeded | null = null; // 견적요청 + 미회신 RFQ → 화면에서 취소(남김)
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

    const status = await api(A, 'GET', '/api/admin/bom-quote-retention');
    expect(status.status, JSON.stringify(status.json)).toBe(200);
    retentionDays = status.json.data.retentionDays;
    if (retentionDays === 0) {
      throw new Error('보존 기간이 0(꺼짐)입니다 — sp_config bom_canceled_quote_retention_days 를 지우거나 양수로 두고 돌리세요');
    }
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customerView, 관리자: adminView, 협력사: partnerView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  // ── 공용 조작 ─────────────────────────────────────────────────────────────
  const quoteRow = async (quoteId: string): Promise<{
    status: string;
    enrichStatus: string;
    answeredAt: Date | null;
    canceledAt: Date | null;
    purgeAfter: Date | null;
  } | null> =>
    getPrisma().spBomQuote.findUnique({
      where: { id: BigInt(quoteId) },
      select: { status: true, enrichStatus: true, answeredAt: true, canceledAt: true, purgeAfter: true },
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

  const cancelByCustomer = async (quoteId: string): Promise<{ status: number; message: string }> => {
    const res = await api(C, 'POST', `/api/bom/quotes/${quoteId}/cancel`);
    return { status: res.status, message: String(res.json?.message ?? '') };
  };

  /** 화면의 [요청 취소] — 확인창(본문으로 텔레포트)의 같은 이름 버튼과 섞이지 않게 오른쪽 패널로 좁힌다. */
  const cancelButton = (session: E2eSession) =>
    session.page.locator('aside').getByRole('button', { name: '요청 취소', exact: true });
  const confirmDialog = (session: E2eSession) => session.page.locator('[role="alertdialog"]');

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

  /** 열어 둔 화면이 견적 상세를 몇 번 다시 받는지 센다(폴링 여부). */
  const countDetailPolls = async (session: E2eSession, quoteId: string, ms: number): Promise<number> => {
    const page = session.page;
    let gets = 0;
    const onRequest = (request: any): void => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/bom/quotes/${quoteId}`) gets += 1;
    };
    page.on('request', onRequest);
    await page.goto(`${BASE_URL}/app/bom/${quoteId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(ms);
    page.off('request', onRequest);
    return gets;
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
    ledger.push(`sp_bom_quote #${qa.quoteId}(A — 견적요청 + 미회신 RFQ → 화면에서 취소, RFQ 마감)`);
    const rfq = await sendRfq(qa.quoteId);
    qaRfqId = rfq.rfqId;
    ledger.push(`sp_bom_rfq #${String(qaRfqId)}(A 의 ${PARTNER_NAME} RFQ — 마감)`);
    expect((await quoteRow(qa.quoteId))?.status, '검토 시작 전이다').toBe('requested');
    expect(rfq.status).toBe('requested');

    await rp.assertView(customerView, `/app/bom/${qa.quoteId}`, 'cancel-K01-customer-requested', [qa.title]);
    await cancelButton(customerView).waitFor({ state: 'visible', timeout: 30_000 });
    await rp.assertView(partnerView, `/app/partner/bom/rfqs/${String(qaRfqId)}`, 'cancel-K01-partner-open', [qa.title]);
    F('K01', 'obs', `견적요청(requested) 상태에서 관리자가 RFQ 를 보낼 수 있다 — 고객 화면에는 [요청 취소]가 보이고, ${PARTNER_NAME} 포털에는 회신 대기 RFQ #${String(qaRfqId)} 가 뜬다`);
  }, 180_000);

  test('K02. [요청 취소] — 확인창이 되돌릴 수 없음과 삭제 시점을 알리고, 확인해야 취소된다', async (ctx) => {
    if (qa === null) return ctx.skip();
    const page = customerView.page;
    let cancelCalls = 0;
    const onRequest = (request: any): void => {
      if (request.method() === 'POST' && request.url().endsWith(`/api/bom/quotes/${qa?.quoteId ?? ''}/cancel`)) cancelCalls += 1;
    };
    page.on('request', onRequest);

    // 1) 누르면 확인창이 먼저 뜬다 — 아직 아무것도 바뀌지 않는다.
    await cancelButton(customerView).click();
    const dialog = confirmDialog(customerView);
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ');
    expect(dialogText, '되돌릴 수 없음을 알린다').toContain('취소하면 되돌릴 수 없습니다');
    expect(dialogText, '며칠 뒤 삭제되는지 알린다').toContain(`${String(retentionDays)}일 뒤 자동으로 삭제됩니다`);
    await rp.shot(customerView, 'cancel-K02-confirm-dialog');

    // 2) [계속 진행]은 아무 일도 하지 않는다.
    await dialog.getByRole('button', { name: '계속 진행', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });
    expect(cancelCalls, '확인 전에는 요청이 나가지 않는다').toBe(0);
    expect((await quoteRow(qa.quoteId))?.status).toBe('requested');

    // 3) 다시 눌러 확인하면 취소된다.
    const mailsBefore = await mailLedgerCount();
    const cancelWait = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/bom/quotes/${qa?.quoteId ?? ''}/cancel`),
      { timeout: 30_000 },
    );
    await cancelButton(customerView).click();
    await confirmDialog(customerView).getByRole('button', { name: '요청 취소', exact: true }).click();
    expect((await cancelWait).status()).toBe(200);
    page.off('request', onRequest);

    const row = await quoteRow(qa.quoteId);
    expect(row?.status).toBe('canceled');
    expect(row?.canceledAt, '취소 시각을 남긴다').not.toBeNull();
    expect(row?.purgeAfter, '삭제 예정 시각을 약속한다').not.toBeNull();
    expect(
      (row?.purgeAfter?.getTime() ?? 0) - (row?.canceledAt?.getTime() ?? 0),
      '삭제 예정 = 취소 + 보존 기간',
    ).toBe(retentionDays * DAY_MS);

    // 화면: 배지가 바뀌고 버튼이 사라지며, 언제 삭제되는지가 보인다.
    await cancelButton(customerView).waitFor({ state: 'detached', timeout: 15_000 });
    await page.getByText('취소됨', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
    const purgeText = kstLongDate(row?.purgeAfter ?? new Date());
    expect(await page.getByTestId('bom-purge-date').innerText()).toContain(`${purgeText} 이후 자동 삭제`);
    expect((await page.getByTestId('bom-canceled-notice').innerText()).replace(/\s+/g, ' ')).toContain(
      `${purgeText} 이후 자동으로 삭제됩니다`,
    );
    await rp.shot(customerView, 'cancel-K02-customer-canceled');

    const back = await api(C, 'POST', `/api/bom/quotes/${qa.quoteId}/request`, { title: qa.title });
    expect(back.status, '취소는 종착 상태다').toBe(409);
    const notices = (await mailLedgerCount()) - mailsBefore;
    F('K02', 'obs', `[요청 취소]는 확인창을 거친다 — "취소하면 되돌릴 수 없습니다"와 "${String(retentionDays)}일 뒤 자동으로 삭제됩니다"를 알리고, [계속 진행]은 아무 일도 하지 않는다. 확인하면 취소되고 화면에 "${purgeText} 이후 자동 삭제"가 뜬다`);
    F('K02', 'obs', `취소 알림은 보내지 않는다(발송 원장 증가 ${String(notices)}건) — 협력사는 포털의 '마감'으로, 관리자는 Case 의 '취소'와 조작 시 안내 문구로 안다`);
  }, 180_000);

  test('K03. 취소하면 협력사 RFQ 가 닫히고 회신이 막힌다', async (ctx) => {
    if (qa === null || qaRfqId === null) return ctx.skip();
    const after = (await loadRfqs(qa.quoteId)).find((row) => row.rfqId === qaRfqId);
    expect(after?.status, '고객 취소가 RFQ 를 닫는다').toBe('closed');
    const listed = ((await api(P, 'GET', '/api/partner/rfqs')).json?.data?.items ?? [])
      .find((row: any) => row.rfqId === qaRfqId);
    expect(listed?.status ?? 'closed', '포털 목록에도 열린 채 남지 않는다').toBe('closed');

    const reply = await partnerReply(qaRfqId, qa.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 취소된 견적에 회신 시도`);
    expect([reply.status, reply.error], '취소된 견적에는 회신할 수 없다').toEqual([409, 'RFQ_CLOSED']);
    expect(await getPrisma().spBomRfqItem.count({ where: { rfqId: BigInt(qaRfqId) } }), '회신 행이 생기지 않았다').toBe(0);

    await rp.assertView(partnerView, `/app/partner/bom/rfqs/${String(qaRfqId)}`, 'cancel-K03-partner-closed', [
      qa.title,
      '마감된 견적 요청입니다',
    ]);
    expect(await partnerView.page.getByRole('button', { name: '회신 저장', exact: true }).count(), '저장 버튼이 없다').toBe(0);
    // 관리자 Case 에는 '취소'와 함께 언제 지워지는지가 보인다.
    await rp.assertView(adminView, `/app/admin/smartbom/cases/${qa.quoteId}`, 'cancel-K03-admin-case', [
      qa.title,
      '이후 자동 삭제',
    ]);
    F('K03', 'obs', `고객이 취소하면 RFQ #${String(qaRfqId)} 가 같은 트랜잭션에서 closed 가 된다 — 협력사 포털은 '마감 · 수정 불가'로 바뀌고 회신 저장은 ${String(reply.status)}(${String(reply.error)}). 관리자 Case 에는 '취소'와 삭제 예정일이 뜬다`);
  }, 180_000);

  test('K04. 취소한 견적은 고객이 지울 수 없고, 협력사가 낸 회신이 기록으로 남는다', async () => {
    const qb = await seedQuote('B', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qb.quoteId}(B — 협력사 회신 뒤 취소: 고객 삭제 거절, 회신 3행 보존)`);
    const rfq = await sendRfq(qb.quoteId);
    expect((await partnerReply(rfq.rfqId, qb.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 취소 전 회신`)).status).toBe(200);
    expect((await cancelByCustomer(qb.quoteId)).status).toBe(200);

    const deleted = await api(C, 'DELETE', `/api/bom/quotes/${qb.quoteId}`);
    expect(deleted.status, `취소 견적은 고객이 지울 수 없다 ${JSON.stringify(deleted.json)}`).toBe(409);
    expect(String(deleted.json?.message), '왜 못 지우는지와 언제 사라지는지를 말한다').toContain('자동으로 삭제됩니다');
    const bulk = await api(C, 'POST', '/api/bom/quotes/delete', { scope: 'selected', quoteIds: [qb.quoteId] });
    expect(bulk.status, JSON.stringify(bulk.json)).toBe(200);
    expect([bulk.json?.data?.deletedCount, bulk.json?.data?.retainedCount], '일괄 삭제도 지우지 않고 보호한다').toEqual([0, 1]);

    const prisma = getPrisma();
    expect(await prisma.spBomQuote.count({ where: { id: BigInt(qb.quoteId) } })).toBe(1);
    expect(await prisma.spBomRfqItem.count({ where: { rfqId: BigInt(rfq.rfqId) } }), '협력사 회신이 그대로 있다').toBe(LINES.length);
    expect((await loadRfqs(qb.quoteId)).find((row) => row.rfqId === rfq.rfqId)?.status).toBe('closed');

    // 내역 화면: 취소 견적에는 선택 칸과 삭제 버튼이 없고, 삭제 예정일이 적혀 있다.
    const page = customerView.page;
    await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('파일명 또는 견적명 검색').fill(`철회 관찰 B ${RUN_KEY}`);
    // 검색이 반영돼 이 견적 한 줄만 남을 때까지 기다린다(디바운스 + 재조회).
    await page.waitForFunction(() => document.body.innerText.replace(/\s+/g, ' ').includes('총 1건'), undefined, { timeout: 30_000 });
    const row = page.locator('tbody tr', { hasText: qb.title });
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await row.getByRole('checkbox').count(), '선택 칸이 없다').toBe(0);
    expect(await row.getByRole('button', { name: '삭제', exact: true }).count(), '삭제 버튼이 없다').toBe(0);
    expect(await row.innerText()).toContain('자동 삭제 예정');
    expect(await row.getByTestId('bom-history-purge').innerText()).toContain('이후 자동 삭제');
    await rp.shot(customerView, 'cancel-K04-history-protected');
    await rp.view(adminView, `/app/admin/smartbom/cases/${qb.quoteId}`, 'cancel-K04-admin-case');
    F('K04', 'obs', `취소한 견적 #${qb.quoteId} 는 고객이 지울 수 없다(단건 ${String(deleted.status)}, 일괄 삭제 0건·보호 1건). RFQ #${String(rfq.rfqId)} 는 마감으로, 협력사 회신 ${String(LINES.length)}행은 그대로 남는다. 내역 화면에는 선택 칸·삭제 버튼 대신 삭제 예정일이 뜬다`);
  }, 240_000);

  test('K05. 검토 중에도 화면에서 취소할 수 있고, 관리자에게는 취소를 알리는 문구가 간다', async () => {
    const qc = await seedQuote('C', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qc.quoteId}(C — 검토 중에 화면에서 취소: 회신 받은 RFQ 마감)`);
    const started = await api(A, 'PATCH', `/api/admin/bom-quotes/${qc.quoteId}`, { status: 'reviewing' });
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    const rfq = await sendRfq(qc.quoteId);
    ledger.push(`sp_bom_rfq #${String(rfq.rfqId)}(C 의 ${PARTNER_NAME} RFQ — 마감, 회신 보존)`);
    expect((await partnerReply(rfq.rfqId, qc.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 검토 중 회신`)).status).toBe(200);

    const page = customerView.page;
    await rp.assertView(customerView, `/app/bom/${qc.quoteId}`, 'cancel-K05-customer-reviewing', [qc.title]);
    await cancelButton(customerView).waitFor({ state: 'visible', timeout: 30_000 });
    await cancelButton(customerView).click();
    const dialog = confirmDialog(customerView);
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    expect((await dialog.innerText()).replace(/\s+/g, ' '), '검토 중에는 중단되는 일을 더 알린다').toContain(
      '담당자가 검토하던 내용과 협력사 견적이 모두 중단됩니다',
    );
    await rp.shot(customerView, 'cancel-K05-confirm-dialog');
    const cancelWait = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'POST' && response.url().endsWith(`/api/bom/quotes/${qc.quoteId}/cancel`),
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: '요청 취소', exact: true }).click();
    expect((await cancelWait).status()).toBe(200);
    expect((await quoteRow(qc.quoteId))?.status).toBe('canceled');
    await page.getByText('취소됨', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
    await rp.shot(customerView, 'cancel-K05-customer-after');

    // 회신까지 받은 RFQ 도 닫히고, 받은 회신은 기록으로 남는다.
    const rfqAfter = (await loadRfqs(qc.quoteId)).find((row) => row.rfqId === rfq.rfqId);
    expect(rfqAfter?.status).toBe('closed');
    expect(await getPrisma().spBomRfqItem.count({ where: { rfqId: BigInt(rfq.rfqId) } })).toBe(LINES.length);
    const reReply = await partnerReply(rfq.rfqId, qc.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 취소 뒤 재회신`);
    expect([reReply.status, reReply.error]).toEqual([409, 'RFQ_CLOSED']);

    // 관리자가 모르고 이어서 조작하면 — 막히고, 문구가 "취소된 견적"이라고 알려 준다.
    const resend = await api(A, 'POST', `/api/admin/bom-quotes/${qc.quoteId}/rfqs`, { partnerIds: [num(partner.id)] });
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
    expect(String(resend.json?.message)).toContain('취소된 견적입니다');
    expect(String(select.json?.message)).toContain('취소된 견적입니다');
    expect(String(complete.json?.message)).toContain('취소된 견적입니다');

    await rp.view(adminView, `/app/admin/smartbom/cases/${qc.quoteId}`, 'cancel-K05-admin-case-after');
    F('K05', 'obs', `검토 중에도 화면에 [요청 취소]가 있다 — 확인창이 "담당자가 검토하던 내용과 협력사 견적이 모두 중단됩니다"를 더 알린다. 취소하면 회신까지 받은 RFQ #${String(rfq.rfqId)} 도 마감되고 회신 ${String(LINES.length)}행은 남는다. 관리자의 후속 조작은 409 와 함께 "${String(complete.json?.message)}" 를 받는다`);
  }, 240_000);

  test('K06. 회신 완료 — 고객 취소는 거절된다(화면에도 버튼 없음)', async () => {
    const qd = await seedQuote('D', { status: 'answered' });
    ledger.push(`sp_bom_quote #${qd.quoteId}(D — 회신 완료, 취소 거절 대조군)`);
    const res = await cancelByCustomer(qd.quoteId);
    expect(res.status, 'answered 에서는 취소 불가').toBe(409);
    expect((await quoteRow(qd.quoteId))?.status).toBe('answered');
    await rp.assertView(customerView, `/app/bom/${qd.quoteId}`, 'cancel-K06-customer-answered', [qd.title]);
    expect(await cancelButton(customerView).count()).toBe(0);
    F('K06', 'obs', `회신 완료 견적은 고객이 취소할 수 없다(API ${String(res.status)}, 화면 버튼 없음) — 주문하지 않으면 그대로 아무 일도 없다`);
  }, 120_000);

  test('K07. 검색이 도는 중에 취소해도 "확인 중"이 남지 않는다', async () => {
    // 관리자의 [최신 시세 확인]이 도는 동안(견적의 enrichStatus=searching)을 직삽입으로 재현한다.
    const qe = await seedQuote('E', { status: 'requested', enrichStatus: 'searching' });
    ledger.push(`sp_bom_quote #${qe.quoteId}(E — 검색 중에 취소: 검색 상태가 풀림)`);
    expect((await cancelByCustomer(qe.quoteId)).status).toBe(200);
    const row = await quoteRow(qe.quoteId);
    expect(row?.status).toBe('canceled');
    expect(row?.enrichStatus, '취소가 검색 중 표시를 푼다').toBe('failed');

    const polls = await countDetailPolls(customerView, qe.quoteId, 7_000);
    expect(polls, '취소된 견적 화면은 폴링하지 않는다').toBeLessThanOrEqual(2);
    expect(await customerView.page.getByText('공급사에서 가격·재고를 확인하고 있습니다').count()).toBe(0);
    await rp.shot(customerView, 'cancel-K07-customer-settled');

    // 이 수정 전에 취소돼 값이 굳어 있는 견적 — 화면은 그래도 "확인 중"을 띄우지 않는다.
    const legacy = await seedQuote('E2', { status: 'canceled', enrichStatus: 'searching', canceledAt: new Date(), purgeAfter: new Date(Date.now() + 30 * DAY_MS) });
    ledger.push(`sp_bom_quote #${legacy.quoteId}(E2 — 예전에 검색 중으로 굳은 취소 견적: 화면은 조용하다)`);
    const legacyPolls = await countDetailPolls(customerView, legacy.quoteId, 7_000);
    expect(legacyPolls).toBeLessThanOrEqual(2);
    expect(await customerView.page.getByText('공급사에서 가격·재고를 확인하고 있습니다').count()).toBe(0);
    await rp.shot(customerView, 'cancel-K07-customer-legacy-stuck');
    F('K07', 'obs', `검색 중에 취소하면 enrichStatus 가 searching → ${String(row?.enrichStatus)} 로 풀린다. 열어 둔 7초 동안 상세 조회는 ${String(polls)}번(폴링 없음), "확인 중" 띠도 없다. 예전에 굳은 견적(#${legacy.quoteId})도 화면은 ${String(legacyPolls)}번만 조회한다`);
  }, 180_000);

  test('K08. 관리자 경로로 취소해도 RFQ 가 닫히고 같은 값(취소 시각·삭제 예정)이 남는다', async () => {
    const qf = await seedQuote('F', { status: 'requested' });
    ledger.push(`sp_bom_quote #${qf.quoteId}(F — 관리자 API 로 취소, RFQ 마감)`);
    const rfq = await sendRfq(qf.quoteId);
    ledger.push(`sp_bom_rfq #${String(rfq.rfqId)}(F 의 ${PARTNER_NAME} RFQ — 마감)`);

    const canceled = await api(A, 'PATCH', `/api/admin/bom-quotes/${qf.quoteId}`, { status: 'canceled' });
    expect(canceled.status, JSON.stringify(canceled.json)).toBe(200);
    const row = await quoteRow(qf.quoteId);
    expect(row?.status).toBe('canceled');
    expect(
      (row?.purgeAfter?.getTime() ?? 0) - (row?.canceledAt?.getTime() ?? 0),
      '관리자 취소도 같은 보존 기간을 약속한다',
    ).toBe(retentionDays * DAY_MS);
    expect((await loadRfqs(qf.quoteId)).find((entry) => entry.rfqId === rfq.rfqId)?.status).toBe('closed');
    const reply = await partnerReply(rfq.rfqId, qf.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 마감 뒤 회신 시도`);
    expect([reply.status, reply.error]).toEqual([409, 'RFQ_CLOSED']);
    F('K08', 'obs', `관리자 API(PATCH status=canceled)로 취소해도 RFQ #${String(rfq.rfqId)} 마감·취소 시각·삭제 예정 시각이 고객 취소와 같게 남는다`);
  }, 180_000);

  test('K09. 경합 빈도 — 회신 확정 도중에 취소가 끼어들어도 둘 다 성공하는 일은 없다', async () => {
    const scaffoldIds: bigint[] = [];
    const control = await prepareCompletable('R0');
    scaffoldIds.push(BigInt(control.quoteId));
    const controlStart = performance.now();
    const controlDone = await api(A, 'POST', `/api/admin/bom-quotes/${control.quoteId}/complete`, completeBody);
    const completeMs = Math.max(1, Math.round(performance.now() - controlStart));
    expect(controlDone.status, `대조군 확정: ${JSON.stringify(controlDone.json)}`).toBe(200);

    // 확정을 먼저 보내고, 그 처리 시간의 0~110% 지점에 취소를 끼워 넣는다.
    const delays = [...new Set(RACE_OFFSETS.map((ratio) => Math.round(completeMs * ratio)))];
    const outcomes: string[] = [];
    let completeWon = 0;
    let cancelWon = 0;
    for (const [index, delay] of delays.entries()) {
      const q = await prepareCompletable(`R${String(index + 1)}`);
      scaffoldIds.push(BigInt(q.quoteId));
      const completing = api(A, 'POST', `/api/admin/bom-quotes/${q.quoteId}/complete`, completeBody);
      await pause(delay);
      const canceling = api(C, 'POST', `/api/bom/quotes/${q.quoteId}/cancel`);
      const [complete, cancel] = await Promise.all([completing, canceling]);
      const final = await quoteRow(q.quoteId);
      expect(
        [complete.status, cancel.status].sort(),
        `+${String(delay)}ms: 정확히 한쪽만 성공한다(확정 ${String(complete.json?.error ?? 'ok')} · 취소 ${String(cancel.json?.message ?? 'ok')})`,
      ).toEqual([200, 409]);
      expect(final?.status, '성공한 쪽의 상태로 끝난다').toBe(complete.status === 200 ? 'answered' : 'canceled');
      if (complete.status === 200) completeWon += 1;
      else cancelWon += 1;
      outcomes.push(`+${String(delay)}ms: 확정 ${String(complete.status)}·취소 ${String(cancel.status)} → ${String(final?.status)}`);
    }
    // e2e 가 방금 만든 발판만(id 로) 지운다 — RFQ·회신은 cascade 로 함께 정리된다.
    await getPrisma().spBomQuote.deleteMany({ where: { id: { in: scaffoldIds }, mbId: CUSTOMER_MB_ID } });
    F('K09', 'obs', `확정(약 ${String(completeMs)}ms)과 취소를 ${String(delays.length)}회 겹쳐 보냈다 — 매번 한쪽만 성공(확정 승 ${String(completeWon)}·취소 승 ${String(cancelWon)}). ${outcomes.join(' / ')}`);
  }, 600_000);

  test('K10. 경합 결과 — 확정이 먼저 쓰이면 취소는 409 로 진다(행 잠금으로 순서를 고정)', async () => {
    // 테스트가 견적 행을 잠가 두 요청을 "상태를 읽고, 쓰기 직전"에 세워 둔 뒤 놓는다(확정 → 취소 순).
    // 예전에는 여기서 둘 다 200 이었고 취소가 확정을 덮었다. 지금은 취소의 쓰기가 상태를 조건으로 건다.
    const q = await prepareCompletable('L');
    ledger.push(`sp_bom_quote #${q.quoteId}(L — 확정과 취소가 겹침: 확정 200·취소 409, 최종 회신 완료)`);
    const inFlight: ReturnType<typeof api>[] = [];
    await getPrisma().$transaction(
      async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM sp_bom_quote WHERE id = ${BigInt(q.quoteId)} FOR UPDATE`;
        inFlight.push(api(A, 'POST', `/api/admin/bom-quotes/${q.quoteId}/complete`, { ...completeBody, sendEmail: true }));
        await pause(LOCK_SETTLE_MS);
        inFlight.push(api(C, 'POST', `/api/bom/quotes/${q.quoteId}/cancel`));
        await pause(LOCK_SETTLE_MS);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    const [complete, cancel] = await Promise.all(inFlight);
    if (complete === undefined || cancel === undefined) throw new Error('요청이 발사되지 않았습니다');

    const final = await quoteRow(q.quoteId);
    expect([complete.status, cancel.status], JSON.stringify([complete.json?.error, cancel.json?.message])).toEqual([200, 409]);
    expect(final?.status, '확정이 유지된다').toBe('answered');
    expect(final?.canceledAt, '취소 흔적이 남지 않는다').toBeNull();
    expect(complete.json?.data?.status, '관리자가 받은 응답도 회신 완료다').toBe('answered');

    await rp.assertView(customerView, `/app/bom/${q.quoteId}`, 'cancel-K10-customer', [q.title, '견적 회신 완료']);
    F('K10', 'obs', `확정과 취소가 겹치면 먼저 쓴 확정이 유지된다 — 확정 ${String(complete.status)}, 취소 ${String(cancel.status)}("${String(cancel.json?.message)}"). 견적은 회신 완료로 남고 고객은 회신 메일대로 확정 견적을 본다`);
  }, 180_000);

  test('K11. 보존 기간 자동 정리 — 지금 실행하면 기한 지난 취소 견적만 지워지고 삭제 기록이 남는다', async () => {
    const prisma = getPrisma();
    const now = Date.now();
    // X: 협력사 회신까지 받은 뒤 취소됐고 삭제 예정일이 지났다(실제 취소 흐름 + 시각만 과거로).
    const x = await seedQuote('X', { status: 'requested' });
    const xRfq = await sendRfq(x.quoteId);
    expect((await partnerReply(xRfq.rfqId, x.itemIds, `[BOM 여정 25호 ${RUN_KEY}] 정리 대상의 회신`)).status).toBe(200);
    expect((await cancelByCustomer(x.quoteId)).status).toBe(200);
    await prisma.spBomQuote.update({
      where: { id: BigInt(x.quoteId) },
      data: { canceledAt: new Date(now - 31 * DAY_MS), purgeAfter: new Date(now - DAY_MS) },
    });
    // Z: 예전에 검색 중으로 굳은 채 취소됐고 기한이 지났다 — 정리가 스스로 풀고 지워야 한다.
    const z = await seedQuote('Z', { status: 'canceled', enrichStatus: 'searching', canceledAt: new Date(now - 40 * DAY_MS), purgeAfter: new Date(now - 10 * DAY_MS) });
    // Y: 취소됐지만 아직 기한 전이다 — 건드리면 안 된다.
    const y = await seedQuote('Y', { status: 'canceled', canceledAt: new Date(now - 20 * DAY_MS), purgeAfter: new Date(now + 10 * DAY_MS) });
    ledger.push(`sp_bom_quote #${y.quoteId}(Y — 취소, 삭제 예정일 전: 정리 뒤에도 남음)`);
    // W: 기한이 지났지만 주문 연결 흔적(ctId)이 있다 — 자동으로는 지우지 않고 사람이 보게 남긴다.
    const w = await seedQuote('W', { status: 'canceled', canceledAt: new Date(now - 33 * DAY_MS), purgeAfter: new Date(now - 2 * DAY_MS), ctId: 2_000_000_000 });

    try {
      const before = (await api(A, 'GET', '/api/admin/bom-quote-retention')).json.data;
      const overdueBefore: string[] = before.overdue.map((item: any) => item.quoteId);
      expect(overdueBefore, '기한이 한 주기 넘게 지난 X·Z·W 가 미삭제로 잡힌다').toEqual(
        expect.arrayContaining([x.quoteId, z.quoteId, w.quoteId]),
      );
      expect(overdueBefore).not.toContain(y.quoteId);
      expect(before.health, '지웠어야 할 견적이 남아 있으면 밀림').toBe('backlog');

      // 관리자 화면에서 [지금 실행]
      const page = adminView.page;
      await rp.assertView(adminView, '/app/admin/delete-audits', 'cancel-K11-admin-before-run', ['삭제 기록', '취소 견적 자동 정리']);
      expect(await page.getByTestId('retention-health').innerText()).toBe('밀림');
      await page.getByTestId('retention-run').click();
      const dialog = confirmDialog(adminView);
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      expect((await dialog.innerText()).replace(/\s+/g, ' ')).toContain('되돌릴 수 없습니다');
      const runWait = page.waitForResponse(
        (response: any) =>
          response.request().method() === 'POST' && response.url().endsWith('/api/admin/bom-quote-retention/run'),
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: '지금 실행', exact: true }).click();
      const runResponse = await runWait;
      expect(runResponse.status()).toBe(200);
      const run = (await runResponse.json()).data.run;
      expect(run.trigger).toBe('manual');
      expect(run.actorMbId).toBe('e2e-admin');
      expect(run.deleted, 'X·Z 를 지웠다').toBeGreaterThanOrEqual(2);
      expect(run.skipped.find((entry: any) => entry.quoteId === w.quoteId)?.blockers, 'W 는 건너뛴다').toEqual(['ORDER_LINKED']);
      expect(run.failed, JSON.stringify(run.failed)).toEqual([]);
      await page.getByTestId('retention-notice').waitFor({ state: 'visible', timeout: 15_000 });
      expect(await page.getByTestId('retention-notice').innerText()).toContain('실행 완료');

      // 데이터: X·Z 는 통째로 사라지고(RFQ·회신 포함), Y·W 는 그대로다.
      expect(await prisma.spBomQuote.count({ where: { id: { in: [BigInt(x.quoteId), BigInt(z.quoteId)] } } })).toBe(0);
      expect(await prisma.spBomRfq.count({ where: { id: BigInt(xRfq.rfqId) } })).toBe(0);
      expect(await prisma.spBomRfqItem.count({ where: { rfqId: BigInt(xRfq.rfqId) } })).toBe(0);
      expect(await prisma.spBomQuote.count({ where: { id: { in: [BigInt(y.quoteId), BigInt(w.quoteId)] } } })).toBe(2);
      expect((await api(C, 'GET', `/api/bom/quotes/${x.quoteId}`)).status, '고객에게도 사라졌다').toBe(404);
      expect((await api(P, 'GET', `/api/partner/rfqs/${String(xRfq.rfqId)}`)).status, '협력사 포털에서도 사라졌다').toBe(404);

      // 감사 기록: 누가(시스템)·왜(보존 기간 경과)·무엇을(건수) 지웠는지 남는다.
      const audits = await prisma.spDeleteAudit.findMany({
        where: { subjectType: 'bom_case', subjectId: { in: [x.quoteId, z.quoteId] } },
      });
      expect(audits.map((row: any) => row.subjectId).sort()).toEqual([x.quoteId, z.quoteId].sort());
      for (const audit of audits) {
        expect(audit.actorMbId).toBe(SYSTEM_ACTOR);
        expect(audit.subjectStatus).toBe('canceled');
        expect(audit.mbId).toBe(CUSTOMER_MB_ID);
        expect(audit.reason).toContain('보존 기간 경과');
      }
      const xAudit = audits.find((row: any) => row.subjectId === x.quoteId);
      expect(xAudit?.snapshot?.impact, '지운 건수가 스냅샷에 남는다').toMatchObject({ quoteItems: LINES.length, rfqs: 1, rfqItems: LINES.length });

      // 화면: 삭제 기록 목록에 "자동 정리"로 올라온다.
      await page.getByTestId('audit-filter-actor').selectOption('auto');
      await page.getByTestId('audit-filter-search').fill(`철회 관찰 X ${RUN_KEY}`);
      await page.getByTestId('audit-filter-search').press('Enter');
      const auditRow = page.getByTestId('audit-table').locator('tbody tr', { hasText: x.title });
      await auditRow.waitFor({ state: 'visible', timeout: 30_000 });
      const auditText = (await auditRow.innerText()).replace(/\s+/g, ' ');
      expect(auditText).toContain('자동 정리');
      expect(auditText).toContain(`협력사 회신 ${String(LINES.length)}`);
      await auditRow.click(); // 펼쳐서 스냅샷 원문
      await rp.shot(adminView, 'cancel-K11-admin-audit-row');

      // 정상 판정: W 가 남아 있어 "밀림"이고, 왜 못 지웠는지가 목록에 뜬다.
      await page.getByTestId('audit-filter-search').fill('');
      await page.getByTestId('audit-filter-search').press('Enter');
      const overdueList = page.getByTestId('retention-overdue-list');
      await overdueList.waitFor({ state: 'visible', timeout: 15_000 });
      const overdueText = (await overdueList.innerText()).replace(/\s+/g, ' ');
      expect(overdueText).toContain(w.title);
      expect(overdueText, '차단 사유를 풀어서 보여 준다').toContain('주문·장바구니 연결');
      expect(await page.getByTestId('retention-health').innerText()).toBe('밀림');
      await rp.shot(adminView, 'cancel-K11-admin-after-run');
      F('K11', 'obs', `[지금 실행] — 기한 지난 취소 견적 ${String(run.deleted)}건 삭제(X #${x.quoteId}: RFQ·협력사 회신 포함, Z #${z.quoteId}: 굳은 검색 상태를 풀고 삭제), 기한 전 Y #${y.quoteId} 는 그대로, 주문 연결 흔적이 있는 W #${w.quoteId} 는 건너뜀(${String(run.skipped.find((entry: any) => entry.quoteId === w.quoteId)?.blockers)}). 감사 기록 2건이 실행자 ${SYSTEM_ACTOR} 로 남고, 화면은 W 때문에 '밀림'과 사유를 보여 준다`);
    } finally {
      // W 는 "못 지우는 견적"의 발판이다 — 남기면 로컬 정리 상태가 계속 밀림으로 보인다.
      await prisma.spBomQuote.deleteMany({ where: { id: BigInt(w.quoteId), mbId: CUSTOMER_MB_ID } });
    }

    // 발판을 치우고 다시 돌리면 우리 무대는 더 이상 미삭제에 없다.
    const rerun = await api(A, 'POST', '/api/admin/bom-quote-retention/run');
    expect(rerun.status, JSON.stringify(rerun.json)).toBe(200);
    const after = rerun.json.data.status;
    expect(after.overdue.map((item: any) => item.quoteId)).not.toEqual(expect.arrayContaining([w.quoteId]));
    expect(after.lastRun.trigger).toBe('manual');
    await rp.assertView(adminView, '/app/admin', 'cancel-K11-admin-dashboard', ['취소 견적 자동 정리']);
    F('K11', 'obs', `발판(W)을 치운 뒤 정리 상태: ${String(after.health)} · 기한 경과 미삭제 ${String(after.overdueCount)}건 · 삭제 대기 ${String(after.pendingCount)}건(가장 가까운 삭제 예정 ${String(after.nextPurgeAfter)}) · 보존 ${String(after.retentionDays)}일`);
  }, 300_000);

  test('K12. 고객에게 보이는 고지 — PHP 견적관리에도 삭제 예정일이 뜬다', async (ctx) => {
    if (qa === null) return ctx.skip();
    let creds: { id: string; pw: string };
    try {
      creds = requireCustomerCreds();
    } catch {
      F('K12', 'obs', 'e2e/.env.e2e 에 고객 자격이 없어 PHP 견적관리 확인을 건너뛰었다');
      return ctx.skip();
    }
    if (creds.id !== CUSTOMER_MB_ID) return ctx.skip();
    const php = await newPhpSession(creds);
    try {
      await php.page.goto(`${BASE_URL}/shop/quotes`, { waitUntil: 'domcontentloaded' });
      const row = php.page.locator('li.sp-quotes__item', { hasText: qa.title });
      await row.waitFor({ state: 'visible', timeout: 60_000 });
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      expect(text).toContain('취소');
      expect(text, 'PHP 목록에도 삭제 예정일이 뜬다').toContain('이후 자동 삭제');
      await row.scrollIntoViewIfNeeded();
      await rp.shot(php, 'cancel-K12-php-quotes');
      // 목록이 길어 전체 화면 사진으로는 글씨가 안 보인다 — 그 줄만 따로 찍어 둔다.
      await row
        .screenshot({ path: fileURLToPath(new URL('../output/journey/cancel-K12-php-row.png', import.meta.url)) })
        .catch(() => undefined);
      F('K12', 'obs', `PHP 견적관리(/shop/quotes)의 취소 견적 행: "${text.match(/\d{2}\.\d{2}\.\d{2} 이후 자동 삭제/)?.[0] ?? '이후 자동 삭제'}"`);
    } finally {
      await php.close();
    }
  }, 180_000);
});
