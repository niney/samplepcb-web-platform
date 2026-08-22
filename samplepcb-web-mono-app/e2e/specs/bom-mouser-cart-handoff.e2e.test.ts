// Mouser 카트 인계(D41, docs/SMARTBOM_PARTNER_RFQ.md §6.34) — 실 Mouser Cart API 를 친다.
//
// 배경: API 카트는 웹 '현재 장바구니'가 아니고 시간이 지나면 비워진다(08-19·08-21 운영 카트 실측).
// 그래서 ① 발주서당 CartKey 고정·전체 교체로 [다시 담기], ② 카트 내용을 발주 품목과 대조하는
// [카트 상태 확인](live*), ③ API 카트와 무관한 가져오기 .csv 를 두었다. 이 스펙은 그 세 길을
// "사라짐·변조"를 Mouser API 로 직접 일으켜 가며 실증하고, 화면(관리자 Case)까지 확인한다.
//
// 옵트인: PORTAL_E2E=1 MOUSER_E2E=1 — SamplePCB Mouser 계정에 e2e 카트가 하나 생긴다(끝에 비운다).
// 실행: pnpm -F e2e e2e:mouser
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newSession,
  num,
  requireMouserOrderKey,
  signJwt,
  snap,
  type E2eSession,
} from '../helpers';

const MOUSER_RUN = process.env.MOUSER_E2E === '1';
const RUN_KEY = String(Date.now());
const SUPPLIER_NAME = 'Mouser Electronics';
const MOUSER_BASE = process.env.MOUSER_ORDER_BASE_URL ?? 'https://api.mouser.com';

// 저렴한 실 SKU(칩 저항 2종) + SKU 없는 행 1개(skippedNoSku·CSV 빈 품번 칸 검증용)
const LINES = [
  { mpn: 'WR04X101 JTL', sku: '791-WR04X101JTL', manufacturerName: 'Walsin', description: '100 OHM 5% 0402', qty: 2, unitPrice: 156 },
  { mpn: 'WR04X103 JTL', sku: '791-WR04X103JTL', manufacturerName: 'Walsin', description: '10K OHM 5% 0402', qty: 1, unitPrice: 156 },
  { mpn: 'NO-SKU-PART-E2E', sku: null, manufacturerName: null, description: 'SKU 없는 행, "따옴표" 포함', qty: 1, unitPrice: 100 },
] as const;
const SKU_LINES = LINES.filter((line) => line.sku !== null);
// DigiKey PO(같은 품목, DigiKey 품번) — 리스트 박스가 Mouser 카트 박스와 같은 틀인지 보는 용도
const DIGIKEY_SKUS: readonly (string | null)[] = ['311-100JRCT-ND', '311-10KJRCT-ND', null];

interface PoExternalRef {
  state: 'ok' | 'failed';
  supplier: string;
  cartKey?: string;
  lineCount?: number;
  skippedNoSku?: number;
  currencyCode?: string | null;
  merchandiseTotal?: number | null;
  checkedAt?: string;
  liveLineCount?: number;
  liveMatches?: boolean;
  liveDiff?: string[];
  checkError?: string;
  refilledCount?: number;
  error?: string;
}
interface PoRow {
  poId: number;
  partnerId: number;
  partnerName: string;
  supplierCode: string | null;
  status: string;
  externalRef: PoExternalRef | null;
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Mouser Cart API 직접 호출 — "사라짐·변조"를 일으키거나 끝에 비울 때만 쓴다. */
async function mouser(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<any> {
  const key = requireMouserOrderKey();
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${MOUSER_BASE}${path}${sep}apiKey=${encodeURIComponent(key)}`, {
    method: init.method,
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return res.json();
}
const mouserRemoveAll = async (cartKey: string): Promise<void> => {
  for (const line of SKU_LINES) {
    await mouser(
      `/api/v1/cart/item/remove?cartKey=${cartKey}&mouserPartNumber=${encodeURIComponent(line.sku)}`,
      { method: 'POST' },
    );
  }
};

async function ensureMouserSupplier(): Promise<{ id: bigint }> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({ where: { supplierCode: 'mouser' } });
  if (existing !== null) return { id: existing.id };
  const created = await prisma.spPartner.create({
    data: {
      type: 'supplier',
      name: SUPPLIER_NAME,
      supplierCode: 'mouser',
      country: 'US',
      defaultCurrency: 'USD',
      capabilities: ['part_sale'],
      status: 'approved',
      memo: `[Mouser 카트 인계 e2e ${RUN_KEY}] 표준 공급사 시드`,
    },
  });
  return { id: created.id };
}

async function ensureHousePartner(): Promise<{ id: bigint }> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({ where: { supplierCode: 'samplepcb' } });
  if (existing !== null) return { id: existing.id };
  const created = await prisma.spPartner.create({
    data: {
      type: 'house',
      name: '샘플피씨비(자사)',
      supplierCode: 'samplepcb',
      country: 'KR',
      defaultCurrency: 'KRW',
      capabilities: ['part_sale'],
      status: 'approved',
      memo: `[Mouser 카트 인계 e2e ${RUN_KEY}] 자사 시드`,
    },
  });
  return { id: created.id };
}

async function ensureDigikeySupplier(): Promise<{ id: bigint }> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({ where: { supplierCode: 'digikey' } });
  if (existing !== null) return { id: existing.id };
  const created = await prisma.spPartner.create({
    data: {
      type: 'supplier',
      name: 'DigiKey',
      supplierCode: 'digikey',
      country: 'US',
      defaultCurrency: 'USD',
      capabilities: ['part_sale'],
      status: 'approved',
      memo: `[Mouser 카트 인계 e2e ${RUN_KEY}] 표준 공급사 시드`,
    },
  });
  return { id: created.id };
}

/** 발주서까지 직삽입 — 결제·주문 없이 PO 패널·외부 실행만 겨눈다(공급사 PO 는 로그인 주체 없음). */
async function seedQuoteWithPos(
  mouserPartnerId: bigint,
  housePartnerId: bigint,
  digikeyPartnerId: bigint,
): Promise<{ quoteId: bigint; mouserPoId: bigint; housePoId: bigint; digikeyPoId: bigint }> {
  const prisma = getPrisma();
  const now = new Date();
  const itemsTotal = LINES.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId: 'e2e-mouser-handoff',
        title: `[Mouser 카트 인계 e2e] ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'answered',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 1,
        spareQty: 0,
        itemsTotal,
        shippingFee: 0,
        managementFee: 0,
        finalTotal: itemsTotal,
        usdKrwRateUsed: 1_400,
        uncostedCount: 0,
        requestedAt: new Date(now.getTime() - 60_000),
        answeredAt: now,
        answerNote: 'Mouser 카트 인계 e2e 픽스처',
        adminMemo: `[Mouser 카트 인계 e2e ${RUN_KEY}]`,
        confirmedShippingFee: 0,
        confirmedManagementFee: 0,
        confirmedTotal: itemsTotal,
      },
    });
    const quoteItemIds: bigint[] = [];
    for (const [index, line] of LINES.entries()) {
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          bomQty: line.qty,
          orderQty: line.qty,
          matchStatus: 'auto',
          selectionSource: 'auto',
          selectedCandidateKey: `mouser-handoff-${String(index)}`,
          lineTotalKrw: line.unitPrice * line.qty,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: {
            offerKey: `mouser:handoff:${String(index)}`,
            supplier: 'mouser',
            supplierSku: line.sku ?? '',
            packaging: null,
            breakQty: line.qty,
            unitPrice: line.unitPrice / 1_400,
            currency: 'USD',
            unitPriceKrw: line.unitPrice,
            moq: 1,
            orderMultiple: 1,
            stock: 1_000,
            priceBreaks: [{ qty: 1, price: line.unitPrice / 1_400 }],
            fetchedAt: now.toISOString(),
            pinned: true,
          },
        },
      });
      quoteItemIds.push(item.id);
    }
    const createPo = async (partnerId: bigint, skus: readonly (string | null)[]) => {
      const po = await tx.spBomPo.create({
        data: { quoteId: quote.id, partnerId, status: 'issued', totalAmount: itemsTotal, currency: 'KRW' },
      });
      await tx.spBomPoItem.createMany({
        data: LINES.map((line, index) => ({
          poId: po.id,
          quoteItemId: quoteItemIds[index],
          rfqItemId: null,
          mpn: line.mpn,
          manufacturerName: line.manufacturerName,
          description: line.description,
          supplierSku: skus[index] ?? null,
          qty: line.qty,
          unitPrice: line.unitPrice,
          lineTotal: line.unitPrice * line.qty,
        })),
      });
      return po.id;
    };
    const mouserSkus = LINES.map((line) => line.sku);
    const mouserPoId = await createPo(mouserPartnerId, mouserSkus);
    const housePoId = await createPo(housePartnerId, mouserSkus);
    const digikeyPoId = await createPo(digikeyPartnerId, DIGIKEY_SKUS);
    return { quoteId: quote.id, mouserPoId, housePoId, digikeyPoId };
  });
}

async function cleanupSeed(quoteId: bigint | null): Promise<void> {
  if (quoteId === null) return;
  const prisma = getPrisma();
  const pos = await prisma.spBomPo.findMany({ where: { quoteId }, select: { id: true } });
  const poIds = pos.map((row: { id: bigint }) => row.id);
  await prisma.spBomPoItem.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.spBomPo.deleteMany({ where: { id: { in: poIds } } });
  await prisma.spBomQuoteItem.deleteMany({ where: { quoteId } });
  await prisma.spBomQuote.delete({ where: { id: quoteId } });
}

describe.skipIf(!RUN || !MOUSER_RUN)('Mouser 카트 인계(D41) — 고정 CartKey 재충전·상태 대조·가져오기 파일', () => {
  let A = '';
  let quoteId: bigint | null = null;
  let mouserPoId: bigint | null = null;
  let housePoId: bigint | null = null;
  let digikeyPoId: bigint | null = null;
  let cartKey: string | null = null;
  let adminView: E2eSession | null = null;

  const base = (): string => `/api/admin/bom-quotes/${String(quoteId)}/pos/${String(mouserPoId)}`;
  const mouserRow = (json: any): PoRow => {
    const row = (json?.data?.pos as PoRow[] | undefined)?.find((po) => po.poId === num(mouserPoId ?? 0n));
    if (row === undefined) throw new Error(`Mouser PO 행이 응답에 없습니다: ${JSON.stringify(json).slice(0, 300)}`);
    return row;
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    requireMouserOrderKey(); // 키가 없으면 여기서 안내와 함께 중단
    const [mouser, house, digikey] = await Promise.all([
      ensureMouserSupplier(),
      ensureHousePartner(),
      ensureDigikeySupplier(),
    ]);
    const seeded = await seedQuoteWithPos(mouser.id, house.id, digikey.id);
    quoteId = seeded.quoteId;
    mouserPoId = seeded.mouserPoId;
    housePoId = seeded.housePoId;
    digikeyPoId = seeded.digikeyPoId;
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 120_000);

  afterAll(async () => {
    // Mouser 계정 정리 — e2e 카트를 비운다(없는 키도 빈 카트 200 이라 idempotent)
    if (cartKey !== null) {
      try {
        await mouserRemoveAll(cartKey);
      } catch {
        /* 정리 실패는 다음 주행의 전체 교체가 덮는다 */
      }
    }
    await adminView?.close();
    await closeBrowser();
    await cleanupSeed(quoteId);
    await disconnectPrisma();
  }, 120_000);

  test('M01. 실행 — 새 카트 담김: CartKey·행 2(SKU 없는 1행 제외)·KRW·live 일치가 한 번에 박제', async () => {
    const r = await api(A, 'POST', `${base()}/external`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const ref = mouserRow(r.json).externalRef;
    expect(ref?.state).toBe('ok');
    expect(ref?.supplier).toBe('mouser');
    expect(ref?.cartKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(ref?.lineCount).toBe(SKU_LINES.length);
    expect(ref?.skippedNoSku).toBe(1);
    expect(ref?.currencyCode).toBe('KRW');
    expect(ref?.merchandiseTotal ?? 0).toBeGreaterThan(0);
    expect(ref?.liveMatches, '실행 응답 자체가 최신 상태 — 확인 1회 절약').toBe(true);
    expect(ref?.liveLineCount).toBe(SKU_LINES.length);
    expect(ref?.checkedAt).toBeDefined();
    expect(ref?.refilledCount).toBeUndefined();
    cartKey = ref?.cartKey ?? null;
  }, 60_000);

  test('M02. 상태 확인 — 지금도 담겨 있으면 live 일치·checkedAt 갱신', async () => {
    const before = (await api(A, 'GET', `/api/admin/bom-quotes/${String(quoteId)}/pos`)).json;
    const prevCheckedAt = mouserRow(before).externalRef?.checkedAt;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const r = await api(A, 'POST', `${base()}/external/check`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const ref = mouserRow(r.json).externalRef;
    expect(ref?.liveMatches).toBe(true);
    expect(ref?.liveLineCount).toBe(SKU_LINES.length);
    expect(ref?.checkError).toBeUndefined();
    expect(ref?.checkedAt).not.toBe(prevCheckedAt);
    expect(ref?.cartKey, '확인은 키를 바꾸지 않는다').toBe(cartKey);
  }, 60_000);

  test('M03. 사라짐 — Mouser 에서 직접 비운 카트는 확인에서 0행·불일치로 드러난다', async () => {
    if (cartKey === null) throw new Error('M01 선행');
    await mouserRemoveAll(cartKey);
    const r = await api(A, 'POST', `${base()}/external/check`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const ref = mouserRow(r.json).externalRef;
    expect(ref?.state, '담았던 사실(state)은 그대로 — 지금 상태만 live 로').toBe('ok');
    expect(ref?.liveLineCount).toBe(0);
    expect(ref?.liveMatches).toBe(false);
    expect(ref?.liveDiff).toEqual(SKU_LINES.map((line) => `${line.sku} 없음`));
  }, 60_000);

  test('M04. 다시 담기 — 같은 CartKey 로 되살아나고(refilledCount 1) 다시 일치', async () => {
    const r = await api(A, 'POST', `${base()}/external`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const ref = mouserRow(r.json).externalRef;
    expect(ref?.state).toBe('ok');
    expect(ref?.cartKey, '발주서당 CartKey 고정').toBe(cartKey);
    expect(ref?.refilledCount).toBe(1);
    expect(ref?.lineCount).toBe(SKU_LINES.length);
    expect(ref?.liveMatches).toBe(true);
    expect(ref?.liveDiff).toBeUndefined();
  }, 60_000);

  test('M05. 변조 — 수량·품번이 달라진 카트는 차이를 품번 단위로 말하고, 다시 담기가 되돌린다', async () => {
    if (cartKey === null) throw new Error('M01 선행');
    const first = SKU_LINES[0];
    const second = SKU_LINES[1];
    if (first === undefined || second === undefined) throw new Error('SKU 행 2개 전제');
    // 전체 교체로 "첫 품번만 5개" 상태를 만든다(둘째 품번은 사라짐)
    await mouser('/api/v1/cart', {
      method: 'POST',
      body: { CartKey: cartKey, CartItems: [{ MouserPartNumber: first.sku, Quantity: 5 }] },
    });
    const checked = await api(A, 'POST', `${base()}/external/check`);
    expect(checked.status, JSON.stringify(checked.json)).toBe(200);
    const ref = mouserRow(checked.json).externalRef;
    expect(ref?.liveMatches).toBe(false);
    expect(ref?.liveLineCount).toBe(1);
    expect(ref?.liveDiff).toEqual([`${second.sku} 없음`, `${first.sku} 수량 ${String(first.qty)}→5`]);

    const refilled = await api(A, 'POST', `${base()}/external`);
    expect(refilled.status).toBe(200);
    const after = mouserRow(refilled.json).externalRef;
    expect(after?.cartKey).toBe(cartKey);
    expect(after?.refilledCount).toBe(2);
    expect(after?.liveMatches).toBe(true);
    // Mouser 쪽 실체도 발주 품목 그대로인지 직접 대조
    const live = await mouser(`/api/v1/cart?cartKey=${cartKey}`, { method: 'GET' });
    const liveItems = (live.CartItems as { MouserPartNumber: string; Quantity: number }[])
      .map((item) => `${item.MouserPartNumber}x${String(item.Quantity)}`)
      .sort();
    expect(liveItems).toEqual(SKU_LINES.map((line) => `${line.sku}x${String(line.qty)}`).sort());
  }, 90_000);

  test('M06. 가져오기 파일 — BOM·헤더·SKU 행·SKU 없는 행(빈 품번 칸·따옴표 escape)', async () => {
    const res = await fetch(`${API_URL}${base()}/external/import-file`, {
      headers: { authorization: `Bearer ${A}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/csv');
    expect(res.headers.get('content-disposition') ?? '').toContain(`mouser-po-${String(mouserPoId)}-import.csv`);
    // fetch().text() 는 선행 BOM 을 떼고 돌려주므로 바이트로 본다(EF BB BF)
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = buf.toString('utf8');
    const rows = csv.slice(1).split('\r\n');
    expect(rows[0]).toBe('Mouser Part Number,Quantity,Manufacturer Part Number,Manufacturer,Description');
    expect(rows[1]).toBe('791-WR04X101JTL,2,WR04X101 JTL,Walsin,100 OHM 5% 0402');
    expect(rows[2]).toBe('791-WR04X103JTL,1,WR04X103 JTL,Walsin,10K OHM 5% 0402');
    expect(rows[3]).toBe(',1,NO-SKU-PART-E2E,,"SKU 없는 행, ""따옴표"" 포함"');
  }, 30_000);

  test('M07. 경계 — Mouser 카트 없는 발주서는 확인 409 NOT_CHECKABLE, 자사 PO 실행은 409 NOT_AUTOMATED', async () => {
    const houseBase = `/api/admin/bom-quotes/${String(quoteId)}/pos/${String(housePoId)}`;
    const check = await api(A, 'POST', `${houseBase}/external/check`);
    expect(check.status).toBe(409);
    expect(check.json?.error).toBe('NOT_CHECKABLE');
    const exec = await api(A, 'POST', `${houseBase}/external`);
    expect(exec.status).toBe(409);
    expect(exec.json?.error).toBe('NOT_AUTOMATED');
    // 자사 PO 도 가져오기 파일은 된다(공급사 발주서라면 — 품번 헤더만 일반형)
    const file = await fetch(`${API_URL}${houseBase}/external/import-file`, { headers: { authorization: `Bearer ${A}` } });
    expect(file.status).toBe(200);
    const houseCsv = Buffer.from(await file.arrayBuffer()).toString('utf8');
    expect(houseCsv.slice(1).split('\r\n')[0]).toMatch(/^Supplier Part Number,/);
    // 남의 견적 경로로는 404
    const wrong = await api(A, 'POST', `/api/admin/bom-quotes/1/pos/${String(mouserPoId)}/external/check`);
    expect(wrong.status).toBe(404);
  }, 30_000);

  test('M08. 관리자 Case 화면 — 카트 박스(담김·CartKey·상태·다시 담기·가져오기)와 [카트 상태 확인] 왕복', async () => {
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${String(quoteId)}`, { waitUntil: 'domcontentloaded' });
    const expand = page.getByRole('button', { name: /조달 발주 \(\d+건\)/ });
    if (await expand.count()) await expand.first().click();
    const row = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first();
    const box = row.getByTestId('mouser-cart-box');
    await box.waitFor({ state: 'visible', timeout: 30_000 });
    await expect.poll(() => box.textContent()).toContain(`Mouser 카트 담김 · ${String(SKU_LINES.length)}행`);
    // 기본은 접힘(한눈 줄 + 버튼 줄) — 식별자·안내·가져오기는 [자세히] 안
    expect(await box.getByTestId('mouser-cart-detail').count(), '기본 접힘').toBe(0);
    await box.getByRole('button', { name: '자세히', exact: true }).click();
    const detail = box.getByTestId('mouser-cart-detail');
    await detail.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await detail.textContent()).toContain(`CartKey ${(cartKey ?? '').slice(0, 8)}…`);
    expect(await detail.textContent()).toContain('다시 담기 2회');
    expect(await detail.textContent()).toContain('저장한 장바구니');
    for (const name of ['카트 상태 확인', '다시 담기', 'Mouser 열기', '가져오기 파일(.csv)', '접기']) {
      expect(await box.getByRole('button', { name, exact: true }).count(), name).toBe(1);
    }
    const health = box.getByTestId('mouser-cart-health');
    // 진입 자동 확인은 10분 신선도 안이라 건너뛰고 박제된 최신 상태를 그린다 → 일치
    await expect.poll(() => health.textContent()).toContain('일치');

    // 버튼 왕복 — 응답 200 뒤에도 일치
    const wait = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith(`${base()}/external/check`),
      { timeout: 30_000 },
    );
    await box.getByRole('button', { name: '카트 상태 확인', exact: true }).click();
    expect((await wait).status()).toBe(200);
    await expect.poll(() => health.textContent()).toMatch(/✓ 일치/);
    await snap(page, 'mouser-cart-handoff-M08-admin-case');
    expect(adminView.pageErrors, adminView.pageErrors.join('\n')).toEqual([]);
  }, 120_000);

  test('M09. 화면 — 사라진 카트는 진입 자동 확인이 아니어도 [카트 상태 확인]으로 경고·다시 담기로 복귀', async () => {
    if (adminView === null || cartKey === null) throw new Error('M08 선행');
    await mouserRemoveAll(cartKey);
    const page = adminView.page;
    const row = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first();
    const box = row.getByTestId('mouser-cart-box');
    const health = box.getByTestId('mouser-cart-health');
    const checkWait = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`${base()}/external/check`), { timeout: 30_000 });
    await box.getByRole('button', { name: '카트 상태 확인', exact: true }).click();
    expect((await checkWait).status()).toBe(200);
    await expect.poll(() => health.textContent()).toContain('비어 있음');

    const refillWait = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`${base()}/external`), { timeout: 30_000 });
    await box.getByRole('button', { name: '다시 담기', exact: true }).click();
    const dialog = page.getByRole('alertdialog').filter({ hasText: 'Mouser 카트 다시 담기' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.getByRole('button', { name: '다시 담기', exact: true }).click();
    expect((await refillWait).status()).toBe(200);
    await expect.poll(() => health.textContent()).toMatch(/✓ 일치/);
    if ((await box.getByTestId('mouser-cart-detail').count()) === 0) {
      await box.getByRole('button', { name: '자세히', exact: true }).click();
    }
    await expect.poll(() => box.getByTestId('mouser-cart-detail').textContent()).toContain('다시 담기 3회');
    await snap(page, 'mouser-cart-handoff-M09-refilled');
    expect(adminView.pageErrors, adminView.pageErrors.join('\n')).toEqual([]);
  }, 120_000);

  test('M10. 진입 자동 확인 — 마지막 확인이 10분을 넘긴 Mouser PO 는 Case 진입만으로 다시 대조한다', async () => {
    if (adminView === null || cartKey === null || mouserPoId === null) throw new Error('M08 선행');
    // 박제된 확인 시각을 20분 전으로 밀고, Mouser 쪽은 비워 둔다 → 진입 자동 확인이 '비어 있음'을 드러내야 한다
    const prisma = getPrisma();
    const row = await prisma.spBomPo.findUnique({ where: { id: mouserPoId }, select: { externalRef: true } });
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    await prisma.spBomPo.update({
      where: { id: mouserPoId },
      data: { externalRef: { ...(row?.externalRef as Record<string, unknown>), checkedAt: stale } },
    });
    await mouserRemoveAll(cartKey);

    const fresh = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    try {
      const page = fresh.page;
      const autoCheck = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith(`${base()}/external/check`),
        { timeout: 30_000 },
      );
      await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${String(quoteId)}`, { waitUntil: 'domcontentloaded' });
      expect((await autoCheck).status(), '진입만으로 확인 요청이 나간다').toBe(200);
      const expand = page.getByRole('button', { name: /조달 발주 \(\d+건\)/ });
      if (await expand.count()) await expand.first().click();
      const box = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first().getByTestId('mouser-cart-box');
      await box.waitFor({ state: 'visible', timeout: 30_000 });
      await expect.poll(() => box.getByTestId('mouser-cart-health').textContent()).toContain('비어 있음');
      expect(fresh.pageErrors, fresh.pageErrors.join('\n')).toEqual([]);
    } finally {
      await fresh.close();
    }
    // 다음 주행·정리를 위해 원상 복구(같은 키에 다시 담기)
    const refilled = await api(A, 'POST', `${base()}/external`);
    expect(refilled.status).toBe(200);
    expect(mouserRow(refilled.json).externalRef?.liveMatches).toBe(true);
  }, 120_000);

  test('M11. DigiKey 리스트 박스 — Mouser 카트 박스와 같은 틀(사실·식별자·상태·버튼·안내), 실 single-use URL 발급·재발급', async () => {
    if (adminView === null || digikeyPoId === null) throw new Error('M08 선행');
    const dkBase = `/api/admin/bom-quotes/${String(quoteId)}/pos/${String(digikeyPoId)}`;
    const dkRowOf = (json: any): PoRow => {
      const row = (json?.data?.pos as PoRow[] | undefined)?.find((po) => po.poId === num(digikeyPoId ?? 0n));
      if (row === undefined) throw new Error('DigiKey PO 행이 응답에 없습니다');
      return row;
    };
    const issued = await api(A, 'POST', `${dkBase}/external`);
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const first = dkRowOf(issued.json).externalRef as (PoExternalRef & { singleUseUrl?: string; listName?: string }) | null;
    expect(first?.state).toBe('ok');
    expect(first?.lineCount).toBe(2);
    expect(first?.skippedNoSku).toBe(1);
    expect(first?.singleUseUrl ?? '').toMatch(/^https?:\/\//);
    expect(first?.listName ?? '').toMatch(/^SmartBOM-/);
    expect(first?.refilledCount).toBeUndefined();
    // 재발급 → 새 URL, 재발급 횟수 1(화면 '재발급 1회')
    const reissued = await api(A, 'POST', `${dkBase}/external`);
    expect(reissued.status).toBe(200);
    const second = dkRowOf(reissued.json).externalRef as (PoExternalRef & { singleUseUrl?: string }) | null;
    expect(second?.refilledCount).toBe(1);
    expect(second?.singleUseUrl).not.toBe(first?.singleUseUrl);

    const page = adminView.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${String(quoteId)}`, { waitUntil: 'domcontentloaded' });
    const expand = page.getByRole('button', { name: /조달 발주 \(\d+건\)/ });
    if (await expand.count()) await expand.first().click();
    const dkBox = page.locator('tr').filter({ hasText: 'DigiKey' }).first().getByTestId('digikey-list-box');
    await dkBox.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await dkBox.textContent()).toContain('DigiKey 리스트 생성됨 · 2행');
    expect(await dkBox.textContent()).toContain('1회용 URL');
    // 기본은 접힘 — 리스트 이름·재발급 횟수·가져오기는 [자세히] 안
    expect(await dkBox.getByTestId('digikey-list-detail').count(), '기본 접힘').toBe(0);
    await dkBox.getByRole('button', { name: '자세히', exact: true }).click();
    const dkDetail = dkBox.getByTestId('digikey-list-detail');
    await dkDetail.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await dkDetail.textContent()).toContain('재발급 1회');
    expect(await dkDetail.textContent()).toContain('리스트 SmartBOM-');
    for (const name of ['DigiKey 리스트 열기(1회용)', '재발급', '가져오기 파일(.csv)', '접기']) {
      expect(await dkBox.getByRole('button', { name, exact: true }).count(), name).toBe(1);
    }
    // 두 박스의 구조적 동형 — 같은 골격 클래스·같은 섹션 구성(한눈 줄·버튼 줄 + 펼친 상세 p 3)
    const mouserBox = page.locator('tr').filter({ hasText: SUPPLIER_NAME }).first().getByTestId('mouser-cart-box');
    if ((await mouserBox.getByTestId('mouser-cart-detail').count()) === 0) {
      await mouserBox.getByRole('button', { name: '자세히', exact: true }).click();
    }
    const shape = async (box: typeof dkBox) => ({
      skeleton: ((await box.getAttribute('class')) ?? '')
        .split(/\s+/)
        .filter((cls) => /^(mt-1|rounded|border|px-2|py-1|leading-4)$/.test(cls))
        .sort()
        .join(' '),
      lines: await box.locator(':scope > p').count(),
      detailBlocks: await box.locator(':scope > div').count(),
      detailLines: await box.locator(':scope > div > p').count(),
    });
    expect(await shape(dkBox)).toEqual(await shape(mouserBox));
    expect((await shape(dkBox)).lines, '한눈 줄 + 버튼 줄').toBe(2);
    expect((await shape(dkBox)).detailLines, '상세 3줄').toBe(3);
    await snap(page, 'mouser-cart-handoff-M11-digikey-box');
    expect(adminView.pageErrors, adminView.pageErrors.join('\n')).toEqual([]);
  }, 120_000);
});
