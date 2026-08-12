// 다건 PCB 주문·결제 진단 — 같은 영카트 주문(od_id)에 PCB 견적 두 줄이 들어갈 때
// 저장 금액, 관리자 워크큐, 입금확인 동시성, 고객 화면의 단위가 서로 맞는지 본다.
//
// 돈 원장 불변식(줄 합계, 한 번만 수납, 두 줄 동시 전이)과 주문/PCB 표시 단위,
// 부분취소·환불 뒤 순결제 표시를 모두 hard assertion으로 고정한다.
// 외부 거버 서비스 없이 가격 확정 견적 두 건을 직삽입하고, 실제 PHP 주문서를 제출한다.
// 각 반복이 만든 quote/spec/cart/order/option 행만 finally 에서 정리한다.
//
// 실행: PORTAL_E2E=1 JOURNEY=1 pnpm -F e2e exec vitest run \
//         specs/journey-multi-item-payment.e2e.test.ts --no-file-parallelism
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  deleteOrderHard,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  newSession,
  placeOrderFromQuotes,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const REPEATS = [1, 2, 3] as const;
const RUN_TAG = String(Date.now()).slice(-7);

interface SeedPair {
  quoteIds: string[];
  specIds: number[];
  prices: number[];
  odId: string | null;
}

interface OrderRow {
  od_status: string;
  od_cart_count: number | bigint | string;
  od_cart_price: number | bigint | string;
  od_cancel_price: number | bigint | string;
  od_receipt_price: number | bigint | string;
  od_refund_price: number | bigint | string;
  od_misu: number | bigint | string;
  od_send_cost: number | bigint | string;
  od_send_cost2: number | bigint | string;
}

describe.skipIf(!RUN || !JOURNEY)('다건 PCB 주문·결제 단위 진단(3회 반복)', () => {
  const rp = createJourneyReport(
    'findings-multi-item-payment',
    '다건 PCB 주문·결제 단위 진단 리포트',
  );
  const { F, ledger } = rp;

  let admin: E2eSession;
  let adminToken = '';

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const seedPair = async (mbId: string, repeat: number): Promise<SeedPair> => {
    const prisma = getPrisma();
    const baseSpec = await prisma.spOrderSpec.findFirst({
      where: { category: 'standard' },
      orderBy: { id: 'desc' },
    });
    if (baseSpec === null) throw new Error('복제할 standard PCB 사양이 없습니다');
    const baseQuote = await prisma.spQuote.findUnique({ where: { id: baseSpec.quoteId } });
    if (baseQuote === null) throw new Error('복제할 PCB 견적 스냅샷이 없습니다');

    // 서로 다른 줄 금액이어야 Case 의 줄 금액과 주문 전체 금액 혼동을 눈으로 잡을 수 있다.
    const prices = [41_000 + repeat * 100, 59_000 + repeat * 100];
    const quoteIds: string[] = [];
    const specIds: number[] = [];
    for (const [index, price] of prices.entries()) {
      const quoteId = randomUUID();
      const projectName = `E2E-MULTI-PAY-${RUN_TAG}-R${String(repeat)}-${index === 0 ? 'A' : 'B'}.zip`;
      await prisma.spQuote.create({
        data: {
          id: quoteId,
          category: baseSpec.category,
          orderCategory: baseSpec.orderCategory,
          qty: baseSpec.qty,
          specJson: baseSpec.specJson as any,
          specHash: baseQuote.specHash,
          autoPrice: price,
          eta: baseQuote.eta,
          priceVersion: `e2e-multi-payment-${RUN_TAG}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      const spec = await prisma.spOrderSpec.create({
        data: {
          mbId,
          quoteId,
          projectName,
          category: baseSpec.category,
          orderCategory: baseSpec.orderCategory,
          qty: baseSpec.qty,
          message: `[다건 결제 진단 R${String(repeat)}] 실행 후 자동 정리`,
          specJson: baseSpec.specJson as any,
          status: 'active',
          quoteStatus: 'priced',
        },
      });
      quoteIds.push(quoteId);
      specIds.push(Number(spec.id));
      ledger.push(`R${String(repeat)} sp_order_spec #${String(spec.id)} / quote ${quoteId}`);
    }
    return { quoteIds, specIds, prices, odId: null };
  };

  const cleanup = async (seed: SeedPair): Promise<void> => {
    const prisma = getPrisma();
    if (seed.odId !== null) {
      // 이 여정은 입금까지만 가므로 재고 차감은 없다. 주문에 딸린 보조 원장도 정확한 od 만 지운다.
      await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_order_data WHERE od_id = ?`, seed.odId);
      await prisma.$executeRawUnsafe(`DELETE FROM g5_shop_coupon_log WHERE od_id = ?`, seed.odId);
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_point WHERE po_rel_table = '@shop_order' AND po_rel_id = ?`,
        seed.odId,
      );
      await prisma.spOrderBizInfo.deleteMany({ where: { odId: seed.odId } });
      await deleteOrderHard(seed.odId);
    }
    if (seed.quoteIds.length > 0) {
      const placeholders = seed.quoteIds.map(() => '?').join(',');
      await prisma.$executeRawUnsafe(
        `DELETE FROM g5_shop_item_option WHERE io_id IN (${placeholders})`,
        ...seed.quoteIds,
      );
    }
    await prisma.spOrderSpec.deleteMany({
      where: { id: { in: seed.specIds.map((id) => BigInt(id)) } },
    });
    await prisma.spQuote.deleteMany({ where: { id: { in: seed.quoteIds } } });
  };

  const loadOrder = async (odId: string): Promise<OrderRow> => {
    const rows: OrderRow[] = await getPrisma().$queryRawUnsafe(
      `SELECT od_status, od_cart_count, od_cart_price, od_cancel_price,
              od_receipt_price, od_refund_price, od_misu, od_send_cost, od_send_cost2
         FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`주문 ${odId} 헤더가 없습니다`);
    return row;
  };

  const loadCart = async (odId: string): Promise<any[]> =>
    getPrisma().$queryRawUnsafe(
      `SELECT ct_id, ct_status, it_id, it_name,
              IF(io_type = 1, io_price * ct_qty, (ct_price + io_price) * ct_qty) AS line_price
         FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id`,
      odId,
    );

  const searchAdminRows = async (
    odId: string,
    tab: 'awaiting' | 'active',
  ): Promise<any> => {
    await admin.page.goto(`${BASE_URL}/app/admin/pcb/orders`, { waitUntil: 'domcontentloaded' });
    await admin.page.getByRole('heading', { name: 'PCB 주문·결제' }).waitFor({ timeout: 30_000 });
    if (tab === 'active') await admin.page.getByRole('button', { name: /^진행 중/ }).click();
    const search = admin.page.getByPlaceholder('프로젝트·고객명·아이디·주문번호 검색');
    await search.fill(odId);
    await search.press('Enter');
    const rows = admin.page.locator('tbody tr').filter({ hasText: odId });
    await rows.first().waitFor({ state: 'visible', timeout: 30_000 });
    return rows;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm --filter api dev');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    adminToken = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    rp.watchHttp(admin, '관리자');
  }, 180_000);

  afterAll(async () => {
    rp.write({ 관리자: admin });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test.each(REPEATS)('R%s. PCB 두 줄 주문→동시 입금확인→표시 단위 대조', async (repeat) => {
    let customer: PhpLoginResult | undefined;
    let seed: SeedPair | undefined;
    try {
      customer = await newPhpSession(requireCustomerCreds());
      rp.watchHttp(customer, `고객-R${String(repeat)}`);
      seed = await seedPair(customer.mbId, repeat);
      const [specA, specB] = seed.specIds;
      if (specA === undefined || specB === undefined) throw new Error('시드 사양 두 건이 없습니다');

      const placed = await placeOrderFromQuotes(customer, rp, {
        specId: specA,
        alsoSpecIds: [specB],
        step: `R${String(repeat)}-ORDER`,
        prefix: `M${String(repeat)}-ORDER`,
        buyerName: `e2e다건결제${String(repeat)}`,
      });
      seed.odId = placed.odId;
      ledger.push(`R${String(repeat)} g5_shop_order od_id=${placed.odId} (PCB 2줄)`);

      const before = await loadOrder(placed.odId);
      const cartBefore = await loadCart(placed.odId);
      const linePrices = cartBefore.map((row) => Number(row.line_price)).sort((a, b) => a - b);
      const expectedPrices = [...seed.prices].sort((a, b) => a - b);
      const cartPrice = Number(before.od_cart_price);
      const due = Number(before.od_misu);
      expect(cartBefore, '한 od 아래 PCB 카트행 두 줄').toHaveLength(2);
      expect(linePrices, '각 줄 가격 스냅샷').toEqual(expectedPrices);
      expect(cartPrice, '주문상품 합계 = 줄 금액 합').toBe(
        seed.prices.reduce((sum, price) => sum + price, 0),
      );
      expect(due, '미수 = 상품합 + 배송비').toBe(
        cartPrice + Number(before.od_send_cost) + Number(before.od_send_cost2),
      );
      F(
        `R${String(repeat)}-원장`,
        'obs',
        `od=${placed.odId} 두 줄 ${linePrices.join(' + ')} = 상품합 ${String(cartPrice)}, 결제예정 ${String(due)}원 — 줄/헤더 금액은 일치`,
      );

      // 커스텀 견적 행은 같은 템플릿 it_id를 공유해도 실제 ct_id 행마다 상품수 1건이다.
      const storedCount = Number(before.od_cart_count);
      expect(storedCount, '주문 헤더 상품수 = 실제 PCB 줄 수').toBe(cartBefore.length);
      F(
        `R${String(repeat)}-상품수`,
        'obs',
        `od_cart_count=${String(storedCount)} — 같은 템플릿 PCB 두 줄도 실제 줄 수와 일치`,
      );

      // 과거에 잘못 저장된 주문도 목록에서 소급 보정되는지, 헤더만 의도적으로 1로 낮춰 재현한다.
      await getPrisma().$executeRawUnsafe(
        `UPDATE g5_shop_order SET od_cart_count = 1 WHERE od_id = ?`,
        placed.odId,
      );
      await customer.page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
      const inquiryRow = customer.page.locator('tbody tr').filter({ hasText: placed.odId }).first();
      await inquiryRow.waitFor({ state: 'visible', timeout: 30_000 });
      const customerCount = Number(
        (await inquiryRow.locator('td[data-th="상품수"]').innerText()).replace(/[^0-9-]/g, ''),
      );
      expect(customerCount, '기존 오저장 주문도 고객 목록은 실제 PCB 줄 수로 보정').toBe(
        cartBefore.length,
      );
      const legacyAdminOrder = await api(
        adminToken,
        'GET',
        `/api/admin/orders?page=1&pageSize=20&qField=od_id&q=${encodeURIComponent(placed.odId)}`,
      );
      expect(legacyAdminOrder.status).toBe(200);
      const legacyAdminItem = (legacyAdminOrder.json?.data?.items ?? []).find(
        (item: any) => item.odId === placed.odId,
      );
      expect(Number(legacyAdminItem?.cartCount), '통합 관리자도 실제 PCB 줄 수로 보정').toBe(
        cartBefore.length,
      );
      await getPrisma().$executeRawUnsafe(
        `UPDATE g5_shop_order SET od_cart_count = ? WHERE od_id = ?`,
        storedCount,
        placed.odId,
      );
      F(
        `R${String(repeat)}-기존주문상품수`,
        'obs',
        `저장값을 1로 낮춘 과거 주문 재현에서도 고객·통합 관리자 목록은 실제 PCB ${String(customerCount)}건으로 표시`,
      );

      // 주문상세의 줄 가격은 정상 — 잘못된 것은 줄 가격이 아니라 주문/줄 표시 단위의 혼합이다.
      await customer.page.goto(
        `${BASE_URL}/shop/orderinquiryview.php?od_id=${encodeURIComponent(placed.odId)}`,
        { waitUntil: 'domcontentloaded' },
      );
      const detailRows = customer.page.locator('#sod_fin_list tbody tr');
      await detailRows.first().waitFor({ state: 'visible', timeout: 30_000 });
      const customerLinePrices = (await detailRows.locator('td[headers="th_itsum"]').allInnerTexts())
        .map((text) => Number(text.replace(/[^0-9-]/g, '')))
        .sort((a, b) => a - b);
      expect(customerLinePrices, '고객 상세의 PCB 줄별 소계').toEqual(expectedPrices);

      const awaitingApi = await api(
        adminToken,
        'GET',
        `/api/admin/pcb-orders?tab=awaiting&page=1&pageSize=1&q=${encodeURIComponent(placed.odId)}`,
      );
      expect(awaitingApi.status).toBe(200);
      const awaitingItems: any[] = awaitingApi.json?.data?.items ?? [];
      expect(awaitingItems, '관리자 큐는 한 주문을 PCB 두 행으로 반환').toHaveLength(2);
      expect(new Set(awaitingItems.map((item) => item.odId)).size).toBe(1);
      expect(Number(awaitingApi.json?.data?.counts?.awaiting ?? 0), '대기 카운트는 주문 단위').toBe(1);
      expect(Number(awaitingApi.json?.data?.total ?? 0), '페이지 total도 주문 단위').toBe(1);
      expect(
        awaitingItems.map((item) => Number(item.lineAmount)).sort((a, b) => a - b),
        '관리자 큐 PCB 줄 금액',
      ).toEqual(expectedPrices);
      expect(awaitingItems.map((item) => Number(item.orderPcbCount))).toEqual([2, 2]);
      F(
        `R${String(repeat)}-대기카운트`,
        'obs',
        `pageSize=1이어도 입금 대기 total은 주문 1건, 같은 주문의 하위 PCB 2줄은 한 페이지에 유지(od=${placed.odId}).`,
      );

      const awaitingRows = await searchAdminRows(placed.odId, 'awaiting');
      expect(await awaitingRows.count(), '화면에도 같은 od 행 두 개').toBe(2);
      const receiptButtons = awaitingRows.getByRole('button', { name: '입금확인' });
      expect(await receiptButtons.count(), '주문 단위 입금확인 버튼은 한 개').toBe(1);
      await receiptButtons.first().click();
      const confirm = admin.page.getByRole('alertdialog');
      await confirm.waitFor({ state: 'visible' });
      const confirmText = (await confirm.innerText()).replace(/\s+/g, ' ').trim();
      expect(confirmText).toContain('PCB 2건 포함');
      expect(confirmText).toContain('모든 상품이 함께 입금 상태');
      await confirm.getByRole('button', { name: '취소' }).click();
      F(
        `R${String(repeat)}-입금UI`,
        'obs',
        `같은 od의 버튼은 1개이고 확인문이 주문 전체 PCB 2건의 동시 전이를 알린다: "${confirmText}"`,
      );

      // 두 관리자가 두 행의 버튼을 거의 동시에 눌렀다고 가정한다. 돈은 한 번만 잡혀야 한다.
      const paymentBody = {
        target: '입금',
        odIds: [placed.odId],
        sendMail: false,
        sendSms: false,
      };
      const [payA, payB] = await Promise.all([
        api(adminToken, 'PATCH', '/api/admin/orders/status', paymentBody),
        api(adminToken, 'PATCH', '/api/admin/orders/status', paymentBody),
      ]);
      expect([payA.status, payB.status]).toEqual([200, 200]);
      const processed = [payA, payB].flatMap((res) => res.json?.data?.processed ?? []);
      expect(processed.filter((id) => id === placed.odId), '수납 처리는 한 요청만 승리').toHaveLength(1);

      const after = await loadOrder(placed.odId);
      const cartAfter = await loadCart(placed.odId);
      expect(String(after.od_status), '주문 헤더 입금').toBe('입금');
      expect(Number(after.od_receipt_price), '주문 전체 수납액은 한 번만').toBe(due);
      expect(Number(after.od_misu), '입금 후 미수 0').toBe(0);
      expect(cartAfter.map((row) => String(row.ct_status)), '두 PCB 줄을 함께 입금 전이').toEqual([
        '입금',
        '입금',
      ]);
      F(
        `R${String(repeat)}-입금원장`,
        'obs',
        `동시 입금확인 2요청 중 1건만 처리 — 주문 전체 수납 ${String(due)}원, 두 카트행 모두 입금, 중복 수납 없음`,
      );

      const activeApi = await api(
        adminToken,
        'GET',
        `/api/admin/pcb-orders?tab=active&page=1&pageSize=20&q=${encodeURIComponent(placed.odId)}`,
      );
      expect(activeApi.status).toBe(200);
      const activeItems: any[] = activeApi.json?.data?.items ?? [];
      expect(activeItems).toHaveLength(2);
      expect(activeItems.map((item) => Number(item.receiptPrice))).toEqual([due, due]);
      expect(
        activeItems.map((item) => Number(item.lineAmount)).sort((a, b) => a - b),
        '입금 뒤에도 PCB 줄 금액 보존',
      ).toEqual(expectedPrices);
      expect(activeItems.map((item) => Number(item.orderAmount))).toEqual([due, due]);
      expect(activeItems.map((item) => Number(item.netReceipt))).toEqual([due, due]);
      F(
        `R${String(repeat)}-수납표시`,
        'obs',
        `API가 PCB 줄 금액(${expectedPrices.join(', ')})과 주문 전체 수납 ${String(due)}원의 단위를 명시해 전달한다.`,
      );

      const activeRows = await searchAdminRows(placed.odId, 'active');
      expect(await activeRows.count()).toBe(2);
      expect(
        await activeRows.getByText('현금수납', { exact: true }).count(),
        '주문 전체 결제 블록은 묶음당 한 번만 표시',
      ).toBe(1);
      for (const price of expectedPrices) {
        await activeRows.getByText(`₩${price.toLocaleString('en-US')}`, { exact: true }).first().waitFor();
      }
      await rp.shot(admin, `M${String(repeat)}-admin-grouped-payment`);

      // Case 는 스펙 단위인데 order 카드가 두 Case 모두 주문 헤더 전체 금액을 보여준다.
      const caseResults = await Promise.all(
        seed.specIds.map((id) => api(adminToken, 'GET', `/api/admin/pcb-projects/${String(id)}`)),
      );
      expect(caseResults.map((result) => result.status)).toEqual([200, 200]);
      const caseOrders = caseResults.map((result) => result.json?.data?.order);
      expect(caseOrders.map((order) => Number(order?.lineAmount))).toEqual(seed.prices);
      expect(caseOrders.map((order) => Number(order?.orderPcbCount))).toEqual([2, 2]);
      expect(caseOrders.map((order) => Number(order?.cartPrice))).toEqual([cartPrice, cartPrice]);
      expect(caseOrders.map((order) => Number(order?.orderPrice))).toEqual([due, due]);
      expect(caseOrders.map((order) => Number(order?.receiptPrice))).toEqual([due, due]);
      F(
        `R${String(repeat)}-Case금액`,
        'obs',
        `Case 두 곳이 각 PCB 금액(${seed.prices.join(', ')})을 따로 주고, 주문 전체 결제대상 ` +
          `${String(due)}원·PCB 2건 포함 범위를 함께 명시한다.`,
      );
      await admin.page.goto(`${BASE_URL}/app/admin/pcb/cases/${String(specA)}`, {
        waitUntil: 'domcontentloaded',
      });
      await admin.page.getByText('이 PCB 주문금액', { exact: true }).waitFor({ timeout: 30_000 });
      await admin.page.getByText('주문 전체 결제대상', { exact: true }).waitFor();
      await admin.page.getByText('PCB 2건 포함', { exact: true }).waitFor();

      // 결제 후 한 줄 취소·환불 — 다건 주문에서만 생기는 순수납(수납-환불) 표시 경계다.
      const canceledCtId = Number(cartAfter[0]?.ct_id ?? 0);
      const canceledLinePrice = Number(cartAfter[0]?.line_price ?? 0);
      const cancel = await api(
        adminToken,
        'PATCH',
        `/api/admin/orders/${encodeURIComponent(placed.odId)}/items/status`,
        { ctIds: [canceledCtId], target: '취소' },
      );
      expect(cancel.status, `부분 취소: ${JSON.stringify(cancel.json)}`).toBe(200);
      const afterCancel = await loadOrder(placed.odId);
      expect(Number(afterCancel.od_cancel_price), '취소금액 = 취소한 PCB 줄').toBe(
        canceledLinePrice,
      );
      expect(Number(afterCancel.od_misu), '환불 전 과입금').toBe(-canceledLinePrice);

      const refund = await api(
        adminToken,
        'PATCH',
        `/api/admin/orders/${encodeURIComponent(placed.odId)}/refund`,
        {
          refundPrice: canceledLinePrice,
          note: `[다건 결제 진단 R${String(repeat)}] 취소 줄 환불 기록`,
        },
      );
      expect(refund.status, `환불 기록: ${JSON.stringify(refund.json)}`).toBe(200);
      const afterRefund = await loadOrder(placed.odId);
      expect(Number(afterRefund.od_refund_price), '환불 누계').toBe(canceledLinePrice);
      expect(Number(afterRefund.od_misu), '수납-환불 후 실잔액 0').toBe(0);

      const afterRefundApi = await api(
        adminToken,
        'GET',
        `/api/admin/pcb-orders?tab=active&page=1&pageSize=20&q=${encodeURIComponent(placed.odId)}`,
      );
      expect(afterRefundApi.status).toBe(200);
      const remainingItems: any[] = afterRefundApi.json?.data?.items ?? [];
      expect(remainingItems, '부분 취소 뒤 활성 PCB 한 줄').toHaveLength(1);
      const cartAfterRefund = await loadCart(placed.odId);
      const remainingPrice = Number(
        cartAfterRefund.find((row) => String(row.ct_status) !== '취소')?.line_price ?? 0,
      );
      const remaining = remainingItems[0];
      expect(Number(remaining?.lineAmount), '활성 PCB 줄 금액').toBe(remainingPrice);
      expect(Number(remaining?.orderAmount), '취소 후 주문 전체 결제대상').toBe(remainingPrice);
      expect(Number(remaining?.receiptPrice), '현금 총수납').toBe(due);
      expect(Number(remaining?.refundPrice), '환불 누계').toBe(canceledLinePrice);
      expect(Number(remaining?.netReceipt), '환불 반영 순결제').toBe(remainingPrice);
      expect(Number(remaining?.misu), '환불 뒤 미수 없음').toBe(0);
      F(
        `R${String(repeat)}-환불후PCB표시`,
        'obs',
        `한 줄 취소·${String(canceledLinePrice)}원 환불 후 활성 PCB ${String(remainingPrice)}원, ` +
          `현금수납 ${String(due)}원, 환불 ${String(canceledLinePrice)}원, 순결제 ${String(remainingPrice)}원, 미수 0을 분리한다.`,
      );
      const refundRows = await searchAdminRows(placed.odId, 'active');
      expect(await refundRows.getByText('환불', { exact: true }).count()).toBe(1);
      expect(await refundRows.getByText('순결제', { exact: true }).count()).toBe(1);
      await admin.page.goto(
        `${BASE_URL}/app/admin/pcb/cases/${String(Number(remaining?.specId ?? 0))}`,
        { waitUntil: 'domcontentloaded' },
      );
      await admin.page.getByText('환불 누계', { exact: true }).waitFor({ timeout: 30_000 });
      await admin.page.getByText('순결제액', { exact: true }).waitFor();

      await customer.page.goto(
        `${BASE_URL}/shop/orderinquiryview.php?od_id=${encodeURIComponent(placed.odId)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await customer.page.getByText('환불 금액', { exact: true }).waitFor({ timeout: 30_000 });
      const paidSummary = (await customer.page.locator('#alrdy').innerText()).replace(/\s+/g, ' ');
      expect(paidSummary, '고객 상세도 저장된 od_misu=0을 따라 완불 표시').toContain('완불');
      F(
        `R${String(repeat)}-환불후고객표시`,
        'obs',
        `환불 후 DB 실잔액(od_misu)=0과 고객 결제 요약이 모두 완불 — ${paidSummary}`,
      );
      await customer.page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
      const refundedInquiryRow = customer.page
        .locator('tbody tr')
        .filter({ hasText: placed.odId })
        .first();
      await refundedInquiryRow.waitFor({ state: 'visible', timeout: 30_000 });
      const customerNetReceipt = Number(
        (await refundedInquiryRow.locator('td[data-th="결제액"]').innerText()).replace(/[^0-9-]/g, ''),
      );
      expect(customerNetReceipt, '고객 주문목록 결제액도 환불 반영 순결제').toBe(remainingPrice);

      expect(admin.pageErrors, '관리자 Vue pageerror 없음').toEqual([]);
      expect(customer.pageErrors, '고객 PHP pageerror 없음').toEqual([]);
    } finally {
      if (customer !== undefined) await customer.close().catch(() => undefined);
      if (seed !== undefined) await cleanup(seed);
    }
  }, 360_000);
});
