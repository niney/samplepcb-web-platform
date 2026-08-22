// 입고 스캔(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) — 공급사 봉투 라벨(ECIA 2D)을 찍어 발주 품목 입고를
// 남긴다. 라벨 파싱은 로컬(외부 API 없음)이라 RUN 게이트만. 골든 라벨은 InvenTree 공급사 바코드 테스트의
// DigiKey/Mouser 문자열을 승계했고, 품번은 시드 발주 품목과 맞춘다.
// 실행: pnpm -F e2e e2e:receiving
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
  signJwt,
  snap,
} from '../helpers';

const RUN_KEY = String(Date.now());
// RECEIVING_E2E_KEEP=1 — 주행이 만든 견적·발주·스캔·선적을 지우지 않고 남긴다(사람이 화면에서 결과를 볼 때). 기본은 정리.
const KEEP = process.env.RECEIVING_E2E_KEEP === '1';
// RECEIVING_E2E_SEED_ONLY=1 — 검사는 돌리지 않고 DigiKey·Mouser 발주서(둘 다 issued = 발주한 상태)만 만들어 남긴다(KEEP 함의). 사람이 화면에서 스캔부터 해 볼 무대.
const SEED_ONLY = process.env.RECEIVING_E2E_SEED_ONLY === '1';
const RS = String.fromCharCode(0x1e);
const GS = String.fromCharCode(0x1d);
const ecia = (...fields: string[]): string => `[)>${RS}06${GS}${fields.join(GS)}`;

// DigiKey 봉투(P 공급사 품번 + 1P MPN + Q 10) / Mouser 봉투(1P MPN + Q 3, K 주문번호, 1V 제조사)
// 기본 주행은 품번에 RUN_KEY 꼬리를 붙여 남겨 둔 무대(KEEP/SEED_ONLY)와 후보가 섞이지 않게 한다. SEED_ONLY 는 사람이 칠 라벨이라 실제 품번 그대로.
const TAIL = SEED_ONLY ? '' : `-E2E${RUN_KEY.slice(-6)}`;
const DIGIKEY_SKU = `296-LM358BIDDFRCT${TAIL}-ND`;
const DIGIKEY_MPN = `LM358BIDDFR${TAIL}`;
const MOUSER_MPN = `MC34063ADR${TAIL}`;
const DIGIKEY_LABEL = ecia(`P${DIGIKEY_SKU}`, `1P${DIGIKEY_MPN}`, 'K', '1K72991337', '10K85781337', '11K1', '4LPH', 'Q10', '11ZPICK');
const MOUSER_LABEL = ecia('KP0-1337', '14K011', `1P${MOUSER_MPN}`, 'Q3', '11K073121337', '4LMX', '1VTI', '1TLOT-A1', '9D2534');
const UNMATCHED_LABEL = ecia(`1PE2E-NOPE-${RUN_KEY}`, 'Q7', '1VACME');
const NO_QTY_LABEL = ecia(`1PE2E-NOQTY-${RUN_KEY}`);

interface Candidate { poItemId: number; poId: number; matchedBy: string; scannedQty: number; orderedQty: number; supplierCode: string | null }
interface Progress { poId: number; items: { poItemId: number; scannedQty: number; orderedQty: number; scanCount: number }[]; complete: boolean; overReceived: boolean; scannedTotal: number; orderedTotal: number }
interface ScanRecord { scanId: number; poItemId: number | null; poId: number | null; quantity: number; lotCode: string | null; dateCode: string | null; supplierCode: string | null; voidedAt: string | null; mpn: string | null; note: string | null }

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  } catch (error) {
    throw new Error(`${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function ensureSupplier(code: 'digikey' | 'mouser'): Promise<bigint> {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findUnique({ where: { supplierCode: code } });
  if (existing !== null) return existing.id;
  const created = await prisma.spPartner.create({
    data: { type: 'supplier', name: code === 'digikey' ? 'DigiKey' : 'Mouser Electronics', supplierCode: code, country: 'US', defaultCurrency: 'USD', capabilities: ['part_sale'], status: 'approved', memo: `[입고 스캔 e2e ${RUN_KEY}]` },
  });
  return created.id;
}

interface Seed { quoteId: bigint; digikeyPoId: bigint; digikeyItemId: bigint; mouserPoId: bigint; mouserItemId: bigint }

async function seed(digikeyPartnerId: bigint, mouserPartnerId: bigint): Promise<Seed> {
  const prisma = getPrisma();
  const now = new Date();
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId: 'e2e-receiving', title: `[입고 스캔 e2e] ${RUN_KEY}`, sourceKind: 'single_search', status: 'answered', buildStatus: 'ready', enrichStatus: 'done',
        setQty: 1, spareQty: 0, itemsTotal: 0, shippingFee: 0, managementFee: 0, finalTotal: 0, usdKrwRateUsed: 1_400, uncostedCount: 0,
        requestedAt: now, answeredAt: now, answerNote: '입고 스캔 e2e', adminMemo: `[입고 스캔 e2e ${RUN_KEY}]`, confirmedShippingFee: 0, confirmedManagementFee: 0, confirmedTotal: 0,
      },
    });
    const lines = [
      { mpn: DIGIKEY_MPN, sku: DIGIKEY_SKU, manufacturerName: 'Texas Instruments', qty: 20, partnerId: digikeyPartnerId },
      { mpn: MOUSER_MPN, sku: null, manufacturerName: 'Texas Instruments', qty: 6, partnerId: mouserPartnerId },
    ];
    const out: Partial<Seed> = { quoteId: quote.id };
    for (const [index, line] of lines.entries()) {
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id, rowIdx: index, included: true, mpn: line.mpn, manufacturerName: line.manufacturerName, description: 'e2e', bomQty: line.qty, orderQty: line.qty,
          matchStatus: 'auto', selectionSource: 'auto', selectedCandidateKey: `rcv-${String(index)}`, lineTotalKrw: 0,
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
          selectedOffer: { offerKey: `rcv:${String(index)}`, supplier: index === 0 ? 'digikey' : 'mouser', supplierSku: line.sku ?? '', packaging: null, breakQty: line.qty, unitPrice: 0.1, currency: 'USD', unitPriceKrw: 140, moq: 1, orderMultiple: 1, stock: 100, priceBreaks: [{ qty: 1, price: 0.1 }], fetchedAt: now.toISOString(), pinned: true },
        },
      });
      const po = await tx.spBomPo.create({ data: { quoteId: quote.id, partnerId: line.partnerId, status: index === 0 && !SEED_ONLY ? 'confirmed' : 'issued', totalAmount: 0, currency: 'KRW', confirmedAt: index === 0 && !SEED_ONLY ? now : null } });
      const poItem = await tx.spBomPoItem.create({
        data: { poId: po.id, quoteItemId: item.id, rfqItemId: null, mpn: line.mpn, manufacturerName: line.manufacturerName, description: 'e2e', supplierSku: line.sku, qty: line.qty, unitPrice: 140, lineTotal: 140 * line.qty },
      });
      if (index === 0) { out.digikeyPoId = po.id; out.digikeyItemId = poItem.id; } else { out.mouserPoId = po.id; out.mouserItemId = poItem.id; }
    }
    return out as Seed;
  });
}

async function cleanup(seeded: Seed | null): Promise<void> {
  const prisma = getPrisma();
  if (seeded !== null) {
    // R08 이 만든 선적·포장(QR)·선적 품목 — 발주서 삭제 전에 걷는다
    const shipments = await prisma.spBomShipment.findMany({ where: { poId: { in: [seeded.digikeyPoId, seeded.mouserPoId] } }, select: { id: true } });
    const shipmentIds = shipments.map((row: { id: bigint }) => row.id);
    if (shipmentIds.length > 0) {
      await prisma.spBomPartPackage.deleteMany({ where: { shipmentItem: { shipmentId: { in: shipmentIds } } } });
      await prisma.spBomShipmentItem.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.spBomShipmentPo.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.spBomShipment.deleteMany({ where: { id: { in: shipmentIds } } });
    }
  }
  await prisma.spBomReceivingScan.deleteMany({ where: { OR: [{ mpn: { contains: RUN_KEY } }, ...(seeded === null ? [] : [{ poId: { in: [seeded.digikeyPoId, seeded.mouserPoId] } }])] } });
  if (seeded === null) return;
  await prisma.spBomPoItem.deleteMany({ where: { poId: { in: [seeded.digikeyPoId, seeded.mouserPoId] } } });
  await prisma.spBomPo.deleteMany({ where: { id: { in: [seeded.digikeyPoId, seeded.mouserPoId] } } });
  await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: seeded.quoteId } });
  await prisma.spBomQuote.delete({ where: { id: seeded.quoteId } });
}

describe.skipIf(!RUN)('입고 스캔(D42) — ECIA 라벨 파싱·발주 품목 대조·원장·화면', () => {
  let A = '';
  let seeded: Seed | null = null;
  const scanIds: number[] = [];

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    const [dk, mo] = await Promise.all([ensureSupplier('digikey'), ensureSupplier('mouser')]);
    seeded = await seed(dk, mo);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
  }, 120_000);

  afterAll(async () => {
    await closeBrowser();
    if (KEEP || SEED_ONLY) {
      console.log(`[receiving e2e] KEEP — quote #${String(seeded?.quoteId)} · DigiKey PO #${String(seeded?.digikeyPoId)} · Mouser PO #${String(seeded?.mouserPoId)} 를 남겼습니다(제목 '[입고 스캔 e2e] ${RUN_KEY}')`);
    } else {
      await cleanup(seeded);
    }
    await disconnectPrisma();
  }, 60_000);

  test.runIf(SEED_ONLY)('R00. 무대만 — 발주한 상태(issued)의 DigiKey 20개·Mouser 6개 발주서를 만들어 남긴다', async () => {
    if (seeded === null) throw new Error('seed');
    const pos = await getPrisma().spBomPo.findMany({ where: { id: { in: [seeded.digikeyPoId, seeded.mouserPoId] } } });
    expect(pos.map((p: { status: string }) => p.status)).toEqual(['issued', 'issued']);
    console.log(`[receiving e2e] 라벨 예시 — DigiKey: ${DIGIKEY_LABEL.replace(//g, '<RS>').replace(//g, '<GS>')} / Mouser: ${MOUSER_LABEL.replace(//g, '<RS>').replace(//g, '<GS>')}`);
  });

  const progressOf = async (poId: bigint): Promise<Progress> => {
    const r = await api(A, 'GET', `/api/admin/bom-receiving/pos/${String(poId)}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.data as Progress;
  };

  test.skipIf(SEED_ONLY)('R01. 대조 — DigiKey 라벨을 읽어 공급사 품번으로 발주 품목 1건을 찾는다(무부작용)', async () => {
    if (seeded === null) throw new Error('seed');
    const r = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: DIGIKEY_LABEL });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.parsed).toMatchObject({ format: 'ecia2d', supplier: 'digikey', fields: { supplierSku: DIGIKEY_SKU, mpn: DIGIKEY_MPN, quantity: 10, supplierOrderNo: '72991337', invoiceNo: '85781337', countryOfOrigin: 'PH' } });
    const candidates = r.json.data.candidates as Candidate[];
    expect(candidates.map((c) => c.poItemId)).toEqual([num(seeded.digikeyItemId)]);
    expect(candidates[0]).toMatchObject({ matchedBy: 'supplierSku', scannedQty: 0, orderedQty: 20, supplierCode: 'digikey' });
    const count = await getPrisma().spBomReceivingScan.count({ where: { poId: seeded.digikeyPoId } });
    expect(count, '대조는 원장을 만들지 않는다').toBe(0);
  });

  test.skipIf(SEED_ONLY)('R02. 기록 — 라벨 수량(Q)으로 입고 박제, 누적이 발주 수량에 닿으면 complete, 넘으면 overReceived', async () => {
    if (seeded === null) throw new Error('seed');
    const body = { barcode: DIGIKEY_LABEL, poItemId: num(seeded.digikeyItemId), quantity: null, note: null };
    const first = await api(A, 'POST', '/api/admin/bom-receiving/scans', body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const scan = first.json.data.scan as ScanRecord;
    scanIds.push(scan.scanId);
    expect(scan).toMatchObject({ poItemId: num(seeded.digikeyItemId), poId: num(seeded.digikeyPoId), quantity: 10, supplierCode: 'digikey', voidedAt: null });
    expect(first.json.data.progress).toMatchObject({ complete: false, overReceived: false, scannedTotal: 10, orderedTotal: 20 });

    const second = await api(A, 'POST', '/api/admin/bom-receiving/scans', body);
    expect(second.status).toBe(200);
    scanIds.push(second.json.data.scan.scanId);
    expect(second.json.data.progress).toMatchObject({ complete: true, overReceived: false, scannedTotal: 20 });

    const third = await api(A, 'POST', '/api/admin/bom-receiving/scans', { ...body, quantity: 5 });
    expect(third.status).toBe(200);
    scanIds.push(third.json.data.scan.scanId);
    expect(third.json.data.scan.quantity, '수기 수량이 라벨 Q 를 이긴다').toBe(5);
    expect(third.json.data.progress).toMatchObject({ complete: true, overReceived: true, scannedTotal: 25 });
    const progress = await progressOf(seeded.digikeyPoId);
    expect(progress.items[0]).toMatchObject({ scannedQty: 25, orderedQty: 20, scanCount: 3 });
  });

  test.skipIf(SEED_ONLY)('R03. 취소 — 잘못 찍은 건 void(원장 유지), 두 번 취소는 409, 진행은 되돌아간다', async () => {
    if (seeded === null) throw new Error('seed');
    const last = scanIds[scanIds.length - 1];
    const voided = await api(A, 'DELETE', `/api/admin/bom-receiving/scans/${String(last)}`);
    expect(voided.status, JSON.stringify(voided.json)).toBe(200);
    expect(voided.json.data.scan.voidedAt).not.toBeNull();
    expect(voided.json.data.progress).toMatchObject({ scannedTotal: 20, complete: true, overReceived: false });
    const again = await api(A, 'DELETE', `/api/admin/bom-receiving/scans/${String(last)}`);
    expect(again.status).toBe(409);
    expect(again.json?.error).toBe('ALREADY_VOIDED');
    const missing = await api(A, 'DELETE', '/api/admin/bom-receiving/scans/999999999');
    expect(missing.status).toBe(404);
    const recent = await api(A, 'GET', `/api/admin/bom-receiving/scans?poId=${String(seeded.digikeyPoId)}&limit=10`);
    expect((recent.json.data.scans as ScanRecord[]).length, '기본은 취소 제외').toBe(2);
    const withVoided = await api(A, 'GET', `/api/admin/bom-receiving/scans?poId=${String(seeded.digikeyPoId)}&limit=10&includeVoided=1`);
    expect((withVoided.json.data.scans as ScanRecord[]).length).toBe(3);
  });

  test.skipIf(SEED_ONLY)('R04. Mouser 라벨 — MPN 으로 대조, lot·date code·주문번호(K) 박제', async () => {
    if (seeded === null) throw new Error('seed');
    const scan = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: MOUSER_LABEL });
    expect(scan.status).toBe(200);
    expect(scan.json.data.parsed).toMatchObject({ supplier: 'mouser', fields: { mpn: MOUSER_MPN, quantity: 3, supplierOrderNo: 'P0-1337', lotCode: 'LOT-A1', dateCode: '2534', manufacturer: 'TI' } });
    const candidates = scan.json.data.candidates as Candidate[];
    expect(candidates.map((c) => c.poItemId)).toEqual([num(seeded.mouserItemId)]);
    expect(candidates[0]?.matchedBy).toBe('mpn');
    const rec = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: MOUSER_LABEL, poItemId: num(seeded.mouserItemId), quantity: null, note: '1박스째' });
    expect(rec.status, JSON.stringify(rec.json)).toBe(200);
    scanIds.push(rec.json.data.scan.scanId);
    expect(rec.json.data.scan).toMatchObject({ quantity: 3, lotCode: 'LOT-A1', dateCode: '2534', supplierCode: 'mouser', note: '1박스째' });
    expect(rec.json.data.progress).toMatchObject({ scannedTotal: 3, orderedTotal: 6, complete: false });
  });

  test.skipIf(SEED_ONLY)('R05. 경계 — 미매칭 기록(poItemId null)·수량 없는 라벨 409·마감 PO 409·비ECIA 는 parsed null', async () => {
    if (seeded === null) throw new Error('seed');
    const none = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: UNMATCHED_LABEL });
    expect(none.status).toBe(200);
    expect(none.json.data.candidates).toEqual([]);
    const unmatched = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: UNMATCHED_LABEL, poItemId: null, quantity: null, note: null });
    expect(unmatched.status, JSON.stringify(unmatched.json)).toBe(200);
    expect(unmatched.json.data.scan).toMatchObject({ poItemId: null, poId: null, quantity: 7 });
    expect(unmatched.json.data.progress).toBeNull();

    const noQty = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: NO_QTY_LABEL, poItemId: null, quantity: null, note: null });
    expect(noQty.status).toBe(409);
    expect(noQty.json?.error).toBe('QUANTITY_REQUIRED');

    await getPrisma().spBomPo.update({ where: { id: seeded.mouserPoId }, data: { status: 'closed', closedAt: new Date() } });
    try {
      const closed = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: MOUSER_LABEL, poItemId: num(seeded.mouserItemId), quantity: null, note: null });
      expect(closed.status).toBe(409);
      expect(closed.json?.error).toBe('PO_CLOSED');
      const hidden = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: MOUSER_LABEL });
      expect((hidden.json.data.candidates as Candidate[]).some((c) => c.poItemId === num(seeded?.mouserItemId ?? 0n)), '마감 PO 는 후보에서 빠진다').toBe(false);
    } finally {
      await getPrisma().spBomPo.update({ where: { id: seeded.mouserPoId }, data: { status: 'issued', closedAt: null } });
    }

    const lcsc = await api(A, 'POST', '/api/admin/bom-receiving/scan', { barcode: '{pbn:PICK2009291337,on:SO2009291337,pc:C312270,qty:2}' });
    expect(lcsc.status).toBe(200);
    expect(lcsc.json.data.parsed).toBeNull();
    expect(lcsc.json.data.candidates).toEqual([]);
    const anon = await api(null, 'POST', '/api/admin/bom-receiving/scan', { barcode: DIGIKEY_LABEL });
    expect(anon.status).toBe(401);
  });

  test.skipIf(SEED_ONLY)('R06. 화면 — 선적·배송 통합 스캔 박스(PKG 는 추적 화면·봉투 라벨은 입고 패널)·자동 기록·진행 카드·최근 목록·취소', async () => {
    if (seeded === null) throw new Error('seed');
    const s = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    try {
      const page = s.page;
      // 옛 입고 스캔 주소는 선적·배송으로 리다이렉트(쿼리 보존)
      await page.goto(`${BASE_URL}/app/admin/smartbom/receiving?digikey=connected`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/app/admin/smartbom/logistics?digikey=connected', { timeout: 30_000 });
      const input = page.getByTestId('receiving-scan-input');
      await input.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.getByRole('link', { name: '입고 스캔' }).count(), '별도 메뉴 없음').toBe(0);

      // 우리 포장 라벨 코드 → 부품 QR 추적 화면으로
      await input.fill('PKG-E2E-NOPE');
      await input.press('Enter');
      await page.waitForURL('**/app/admin/smartbom/packages/PKG-E2E-NOPE', { timeout: 30_000 });
      await page.goto(`${BASE_URL}/app/admin/smartbom/logistics`, { waitUntil: 'domcontentloaded' });
      await input.waitFor({ state: 'visible', timeout: 30_000 });

      // 스캐너가 ␞␝ 로 치환해 주는 경우 그대로 타이핑 → Enter → 입고 패널 열림 → 후보 1개 → 자동 기록
      const pictures = DIGIKEY_LABEL.replaceAll(RS, '␞').replaceAll(GS, '␝');
      const recordWait = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/admin/bom-receiving/scans'), { timeout: 30_000 });
      await input.fill(pictures);
      await input.press('Enter');
      expect((await recordWait).status()).toBe(200);
      const progress = page.getByTestId('receiving-progress');
      await progress.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await progress.textContent()).toContain('초과 입고'); // 20/20 위에 10 추가
      expect(await progress.textContent()).toContain(DIGIKEY_MPN);

      // 후보 없는 라벨 — 대조 결과에 '찾지 못했습니다', 미매칭 기록 버튼 노출(자동 기록 안 함)
      await input.fill(UNMATCHED_LABEL.replaceAll(RS, '<RS>').replaceAll(GS, '<GS>'));
      await input.press('Enter');
      await page.getByTestId('receiving-no-candidate').waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.getByTestId('receiving-supplier').textContent()).toContain('Mouser');
      expect(await page.getByRole('button', { name: '미매칭으로 기록', exact: true }).count()).toBe(1);

      // 최근 목록에서 방금 자동 기록된 DigiKey 행 취소 → 목록에서 사라짐
      const recent = page.getByTestId('receiving-recent');
      await recent.waitFor({ state: 'visible', timeout: 30_000 });
      const before = await recent.locator('tbody tr').count();
      const firstRow = recent.locator('tbody tr').first();
      expect(await firstRow.textContent()).toContain(DIGIKEY_SKU);
      const voidWait = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/admin/bom-receiving/scans/'), { timeout: 30_000 });
      await firstRow.getByRole('button', { name: '취소', exact: true }).click();
      const dialog = page.getByRole('alertdialog').filter({ hasText: '스캔 취소' });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      await dialog.getByRole('button', { name: '취소 처리', exact: true }).click();
      expect((await voidWait).status()).toBe(200);
      await expect.poll(() => recent.locator('tbody tr').count()).toBe(before - 1);
      await expect.poll(() => progress.textContent()).toContain('전량 입고');
      // 전량·정확 → [입고 완료 처리] 버튼이 뜬다(실행은 R08 에서 API 로)
      expect(await progress.getByTestId('receiving-complete').count()).toBe(1);
      await snap(page, 'bom-receiving-R06');
      expect(s.pageErrors, s.pageErrors.join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  }, 120_000);

  test.skipIf(SEED_ONLY)('R08. 입고 완료 처리 — 전량·정확 스캔 PO 는 선적 단계 없이 닫힌다(선적·QR 포장 자동, ALREADY/NOT_COMPLETE/OVER 가드)', async () => {
    if (seeded === null) throw new Error('seed');
    // DigiKey PO: R02~R06 을 거쳐 20/20(스캔 2건) — 완료
    const done = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(seeded.digikeyPoId)}/complete`);
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json.data).toMatchObject({ poId: num(seeded.digikeyPoId), packages: 2, scans: 2, poConfirmedNow: false });
    const shipmentId = done.json.data.shipmentId as number;
    const shipment = await getPrisma().spBomShipment.findUnique({ where: { id: BigInt(shipmentId) } });
    expect(shipment?.mode, 'DigiKey(US) → 국제').toBe('international');
    expect(shipment?.status, '국제 최종 상태').toBe('done');
    expect(shipment?.receivedAt).not.toBeNull();
    expect(shipment?.packingFinalizedAt).not.toBeNull();
    const packing = await api(A, 'GET', `/api/admin/bom-shipments/${String(shipmentId)}/packing-list`);
    expect(packing.status, JSON.stringify(packing.json)).toBe(200);
    const items = packing.json.data.items as { poItemId: number; packages: { packageId: number | null; quantity: number; status: string }[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.packages.map((p) => p.quantity)).toEqual([10, 10]);
    expect(items[0]?.packages.every((p) => p.packageId !== null && p.status === 'received'), 'QR 포장 발급·입고 상태').toBe(true);
    const again = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(seeded.digikeyPoId)}/complete`);
    expect(again.status).toBe(409);
    expect(again.json?.error).toBe('ALREADY_RECEIVED');

    // Mouser PO: 3/6 → NOT_COMPLETE; 5개 더 찍어 8/6 → OVER_RECEIVED; 취소 후 다시 3/6
    const short = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(seeded.mouserPoId)}/complete`);
    expect(short.status).toBe(409);
    expect(short.json?.error).toBe('NOT_COMPLETE');
    const extra = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: MOUSER_LABEL, poItemId: num(seeded.mouserItemId), quantity: 5, note: null });
    expect(extra.status).toBe(200);
    const over = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(seeded.mouserPoId)}/complete`);
    expect(over.status).toBe(409);
    expect(over.json?.error).toBe('OVER_RECEIVED');
    expect((await api(A, 'DELETE', `/api/admin/bom-receiving/scans/${String(extra.json.data.scan.scanId)}`)).status).toBe(200);
    // 정확히 채우면(3 더) 구매 확인 대기 PO 도 구매 완료 처리와 함께 닫힌다
    const fill = await api(A, 'POST', '/api/admin/bom-receiving/scans', { barcode: MOUSER_LABEL, poItemId: num(seeded.mouserItemId), quantity: 3, note: null });
    expect(fill.status).toBe(200);
    const mouserDone = await api(A, 'POST', `/api/admin/bom-receiving/pos/${String(seeded.mouserPoId)}/complete`);
    expect(mouserDone.status, JSON.stringify(mouserDone.json)).toBe(200);
    expect(mouserDone.json.data).toMatchObject({ poConfirmedNow: true, packages: 2, scans: 2 });
    const mouserPo = await getPrisma().spBomPo.findUnique({ where: { id: seeded.mouserPoId } });
    expect(mouserPo?.status).toBe('confirmed');

    // 워크큐 — 입고 완료 탭에 두 선적이 "입고 스캔 n/n"(전량) 배지로
    const queue = await api(A, 'GET', '/api/admin/bom-shipments?tab=received&page=1&pageSize=100');
    expect(queue.status).toBe(200);
    const rows = queue.json.data.items as { shipmentId: number; receiving: { scannedQty: number; orderedQty: number } | null; receivedAt: string | null }[];
    const mine = rows.find((r) => r.shipmentId === shipmentId);
    expect(mine?.receiving).toEqual({ scannedQty: 20, orderedQty: 20 });
    expect(mine?.receivedAt).not.toBeNull();
  }, 60_000);

  test.skipIf(SEED_ONLY)('R07. DigiKey 3-legged 연결 — 상태·시작 URL·콜백 state 가드·미연결 조회 409·화면 칩(실 로그인은 사람 몫)', async () => {
    const status = await api(A, 'GET', '/api/admin/digikey/status');
    expect(status.status, JSON.stringify(status.json)).toBe(200);
    const before = status.json.data as { configured: boolean; connected: boolean; redirectUri: string };
    expect(before.configured, 'apps/api/.env DIGIKEY_* 설정').toBe(true);
    expect(before.redirectUri).toMatch(/\/api\/admin\/digikey\/oauth\/callback$/);

    const start = await api(A, 'POST', '/api/admin/digikey/oauth/start');
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const url = new URL(start.json.data.url as string);
    expect(url.origin + url.pathname).toBe('https://api.digikey.com/v1/oauth2/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(before.redirectUri);
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);

    // 콜백은 무인증이지만 state 가 틀리면 교환 없이 오류 복귀(302 → receiving?digikey=error)
    const bad = await fetch(`${API_URL}/api/admin/digikey/oauth/callback?code=x&state=wrong`, { redirect: 'manual' });
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location') ?? '').toContain('/app/admin/smartbom/logistics?digikey=error&reason=INVALID_STATE');
    const denied = await fetch(`${API_URL}/api/admin/digikey/oauth/callback?error=access_denied`, { redirect: 'manual' });
    expect(denied.headers.get('location') ?? '').toContain('digikey=error&reason=access_denied');
    // 잘못된 state 검사로 대기 state 는 소진됐다 — 연결 상태는 그대로
    const after = await api(A, 'GET', '/api/admin/digikey/status');
    expect(after.json.data.connected).toBe(before.connected);

    if (!before.connected) {
      const lookup = await api(A, 'POST', '/api/admin/bom-receiving/digikey-lookup', { barcode: DIGIKEY_LABEL });
      expect(lookup.status).toBe(409);
      expect(lookup.json?.error).toBe('NOT_CONNECTED');
    } else if (process.env.DIGIKEY_E2E === '1') {
      // 사람이 [연결]을 마친 환경에서만 — 실 Barcoding 호출(골든 라벨은 DigiKey 계정의 실주문이 아니라 404/오류일 수 있어 상태만 본다)
      const lookup = await api(A, 'POST', '/api/admin/bom-receiving/digikey-lookup', { barcode: DIGIKEY_LABEL });
      expect([200, 409]).toContain(lookup.status);
    }
    expect((await api(null, 'GET', '/api/admin/digikey/status')).status).toBe(401);
    expect((await api(null, 'DELETE', '/api/admin/digikey/connection')).status).toBe(401);

    const s = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    try {
      // OAuth 콜백 복귀 주소 = 선적·배송(?digikey=…) — 칩·알림은 입고 패널 안이라 패널을 연다
      await s.page.goto(`${BASE_URL}/app/admin/smartbom/logistics?digikey=error&reason=INVALID_STATE`, { waitUntil: 'domcontentloaded' });
      await s.page.getByTestId('receiving-toggle').click();
      const chip = s.page.getByTestId('digikey-connection');
      await chip.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await chip.textContent()).toContain(before.connected ? '연결됨' : '미연결');
      expect(await chip.getByRole('button', { name: before.connected ? '해제' : '연결', exact: true }).count()).toBe(1);
      expect(await s.page.getByTestId('digikey-notice').textContent()).toContain('INVALID_STATE');
      expect(s.pageErrors, s.pageErrors.join('\n')).toEqual([]);
    } finally {
      await s.close();
    }
  }, 60_000);
});
