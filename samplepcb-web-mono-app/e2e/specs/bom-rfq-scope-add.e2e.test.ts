// BOM 협력사 견적요청 — 부분 행 요청의 '행 추가'(docs/SMARTBOM_PARTNER_RFQ.md §6.13 개정).
//
// 일부 행만 받은 **미회신** 요청에 나중에 행을 더할 수 있다(합집합 — 줄이지 않는다). 전체를 덮으면
// null(=전체)로 정규화, 회신한 요청은 409 로 잠긴다. 매직링크는 그대로 살아 있고 추가분만 회신 범위가
// 넓어진다. 화면은 발송 버튼의 선택 표시·[품목 표에서 고르기]·협력사별 [행 추가] 토글을 본다.
// 생성물(견적·RFQ·메일 로그)은 끝에 지운다 — 무대 협력사 2곳은 상설 픽스처로 남긴다.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  outputDir,
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  ensureStagePartner,
  getPrisma,
  newSession,
  num,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const RUN_KEY = String(Date.now());
const OUT = join(outputDir, 'bom-rfq-scope-add');
mkdirSync(OUT, { recursive: true });

// 무대 — e2e 전용 계정·조직. 이름에 검사 문구를 넣지 않는다.
const STAGE = {
  a: { mbId: 'e2e-bomscope-a', orgName: 'e2e범위협력가', country: 'KR', currency: 'KRW' },
  b: { mbId: 'e2e-bomscope-b', orgName: 'e2e범위협력나', country: 'KR', currency: 'KRW' },
} as const;

const LINES = [
  { mpn: 'RC0402FR-0710KL', manufacturerName: 'YAGEO', description: '10 kΩ 0402 resistor' },
  { mpn: 'GRM155R71C104KA88D', manufacturerName: 'Murata', description: '100 nF 0402 capacitor' },
  { mpn: 'STM32F103C8T6', manufacturerName: 'STMicroelectronics', description: 'Cortex-M3 MCU' },
  { mpn: 'AMS1117-3.3', manufacturerName: 'AMS', description: '3.3 V LDO' },
  { mpn: 'B2B-XH-A', manufacturerName: 'JST', description: '2-pin header' },
] as const;

interface RfqRow {
  rfqId: number;
  partnerId: number;
  status: string;
  magicToken: string | null;
  requestedAt: string;
  requestedItemIds: string[] | null;
}

describe.skipIf(!RUN)('BOM RFQ — 미회신 요청에 행 추가(§6.13 개정)', () => {
  const partners = {} as Record<keyof typeof STAGE, PartnerFixture>;
  let A = '';
  let quoteId = '';
  let ids: string[] = [];
  let admin: E2eSession | null = null;

  const partnerId = (key: keyof typeof STAGE): number => num(partners[key].id);

  async function rfqs(): Promise<RfqRow[]> {
    const res = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data.rfqs as RfqRow[];
  }
  async function rfqOf(key: keyof typeof STAGE): Promise<RfqRow> {
    const row = (await rfqs()).find((r) => r.partnerId === partnerId(key));
    if (row === undefined) throw new Error(`${STAGE[key].orgName} RFQ 가 없습니다`);
    return row;
  }
  const send = (body: unknown) => api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, body);

  /** 메일은 비차단 발송이라 원장 기록을 잠깐 기다린다. */
  async function scopeMailCount(key: keyof typeof STAGE, expected: number): Promise<number> {
    const prisma = getPrisma();
    let count = -1;
    for (let i = 0; i < 20; i += 1) {
      const logs = await prisma.spMailLog.findMany({
        where: { refType: 'bom_quote', refId: quoteId, kind: 'bom_rfq_scope_added' },
      });
      count = logs.filter((log: { params: { partnerId?: string } | null }) => log.params?.partnerId === String(partnerId(key))).length;
      if (count >= expected) return count;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return count;
  }

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health?.ok !== true) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api`);
    for (const key of Object.keys(STAGE) as (keyof typeof STAGE)[]) {
      partners[key] = await ensureStagePartner({ ...STAGE[key], capabilities: ['bom_rfq'] });
    }
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3_600 });
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: requireCustomerCreds().id,
        title: `[e2e] RFQ 행 추가 ${RUN_KEY}`,
        sourceKind: 'single_search',
        status: 'reviewing',
        buildStatus: 'ready',
        enrichStatus: 'done',
        setQty: 10,
        spareQty: 0,
        itemsTotal: 0,
        finalTotal: 0,
        uncostedCount: LINES.length,
        requestedAt: new Date(),
        adminMemo: `[e2e ${RUN_KEY}] rfq scope add`,
      },
    });
    quoteId = String(quote.id);
    ids = [];
    for (const [index, line] of LINES.entries()) {
      const item = await prisma.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          rowIdx: index,
          included: true,
          ...line,
          bomQty: 1,
          orderQty: 10,
          matchStatus: 'manual',
          selectionSource: 'none',
          sourceRow: { quantityConfirmed: true, procurementDisposition: 'included' },
        },
      });
      ids.push(String(item.id));
    }
  }, 120_000);

  afterAll(async () => {
    await admin?.close();
    await closeBrowser();
    if (quoteId !== '') {
      const prisma = getPrisma();
      await prisma.spBomRfq.deleteMany({ where: { quoteId: BigInt(quoteId) } });
      await prisma.spMailLog.deleteMany({ where: { refType: 'bom_quote', refId: quoteId } });
      await prisma.spBomQuote.delete({ where: { id: BigInt(quoteId) } }).catch(() => undefined);
    }
    await disconnectPrisma();
  }, 60_000);

  test('S1 부분 발송 — A 는 1·2행만 받는다', async () => {
    const res = await send({ partnerIds: [partnerId('a')], itemIds: [ids[0], ids[1]] });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.added).toBe(1);
    expect(res.json.data.expanded).toBe(0);
    expect((await rfqOf('a')).requestedItemIds).toEqual([ids[0], ids[1]]);
  });

  test('S2 B 신규 발송과 함께 A 에 3·4행 추가 — 링크 유지·발송 시각 갱신·품목 추가 메일', async () => {
    const before = await rfqOf('a');
    const res = await send({
      partnerIds: [partnerId('a'), partnerId('b')],
      itemIds: [ids[2], ids[3]],
      expandPartnerIds: [partnerId('a')],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ added: 1, kept: 1, removed: 0, expanded: 1 });
    const a = await rfqOf('a');
    expect(a.requestedItemIds).toEqual([ids[0], ids[1], ids[2], ids[3]]);
    expect(a.magicToken).toBe(before.magicToken);
    expect(new Date(a.requestedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.requestedAt).getTime());
    expect((await rfqOf('b')).requestedItemIds).toEqual([ids[2], ids[3]]);
    expect(await scopeMailCount('a', 1)).toBe(1);
  });

  test('S3 이미 받은 행만 고르면 아무것도 바뀌지 않고 메일도 없다', async () => {
    const res = await send({
      partnerIds: [partnerId('a'), partnerId('b')],
      itemIds: [ids[0]],
      expandPartnerIds: [partnerId('a')],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.expanded).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await scopeMailCount('a', 2)).toBe(1);
  });

  test('S4 발송 대상에서 뺀 협력사에는 더할 수 없다(400)', async () => {
    const res = await send({ partnerIds: [partnerId('b')], expandPartnerIds: [partnerId('a')] });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(res.json.error).toBe('EXPAND_NOT_SELECTED');
    expect((await rfqOf('a')).status).toBe('requested'); // 회수되지 않았다
  });

  test('S5 매직링크 범위가 함께 넓어지고, 전체 추가는 null(=전체)로 정규화', async () => {
    const token = (await rfqOf('a')).magicToken;
    if (token === null) throw new Error('매직링크가 없습니다');
    const partial = await api(null, 'GET', `/api/rfq-reply/${token}`);
    expect(partial.status).toBe(200);
    expect(partial.json.data.rfq.items).toHaveLength(4);

    const full = await send({ partnerIds: [partnerId('a'), partnerId('b')], expandPartnerIds: [partnerId('a')] });
    expect(full.status, JSON.stringify(full.json)).toBe(200);
    expect(full.json.data.expanded).toBe(1);
    expect((await rfqOf('a')).requestedItemIds).toBeNull();
    expect(await scopeMailCount('a', 2)).toBe(2);
    // B 는 고르지 않았으니 그대로다.
    expect((await rfqOf('b')).requestedItemIds).toEqual([ids[2], ids[3]]);

    const after = await api(null, 'GET', `/api/rfq-reply/${token}`);
    expect(after.json.data.rfq.items).toHaveLength(5);
    const reply = await api(null, 'PUT', `/api/rfq-reply/${token}`, {
      items: [
        { quoteItemId: ids[4], unitPrice: 120, replyQty: null, moq: null, stock: null, dateCode: null, leadTime: null, memo: null },
      ],
    });
    expect(reply.status, JSON.stringify(reply.json)).toBe(200);
  });

  test('S6 회신한 요청에는 더할 수 없다(409) — 같은 요청의 다른 변경도 함께 되돌린다', async () => {
    // A 를 부분 범위로 되돌려 '더할 행이 있는' 회신 요청을 만든다(회신 뒤 행 추가 시도 재현).
    const prisma = getPrisma();
    await prisma.spBomRfq.update({ where: { id: BigInt((await rfqOf('a')).rfqId) }, data: { requestedItemIds: [ids[4]] } });
    const res = await send({
      partnerIds: [partnerId('a'), partnerId('b')],
      itemIds: [ids[0]],
      expandPartnerIds: [partnerId('a'), partnerId('b')],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json.error).toBe('RFQ_ALREADY_REPLIED');
    expect(res.json.message).toContain(STAGE.a.orgName);
    expect((await rfqOf('a')).requestedItemIds).toEqual([ids[4]]);
    expect((await rfqOf('b')).requestedItemIds).toEqual([ids[2], ids[3]]); // B 확장도 반영되지 않았다
    await prisma.spBomRfq.update({ where: { id: BigInt((await rfqOf('a')).rfqId) }, data: { requestedItemIds: null } });
  });

  test('S7 화면 — 선택 표시·[품목 표에서 고르기]·협력사별 [행 추가]', async () => {
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const page = admin.page;
    await page.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, { waitUntil: 'domcontentloaded' });
    const sendButton = page.getByRole('button', { name: '협력사 견적요청 보내기' });
    await sendButton.waitFor({ state: 'visible', timeout: 60_000 });

    // 선택이 없으면 대화상자가 고르는 자리를 알려 주고, 누르면 품목 표 선택 줄로 데려간다.
    await sendButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '품목 표에서 고르기' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.id === 'smartbom-rfq-row-picker', null, { timeout: 5_000 });
    await page.waitForTimeout(600); // smooth 스크롤이 멈출 때까지
    const inView = await page.evaluate(() => {
      const rect = document.getElementById('smartbom-rfq-row-picker')?.getBoundingClientRect();
      return rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inView).toBe(true);
    await page.screenshot({ path: `${OUT}/rfq-scope-add-1-picker.png` });

    // 1행을 체크하면 발송 버튼이 선택을 말한다.
    await page.getByRole('checkbox', { name: `${LINES[0].mpn} RFQ 포함` }).click();
    await expect.poll(() => sendButton.textContent()).toContain('1행 선택');

    // B(3·4행만 받은 미회신)는 1행을 더할 수 있고, A(전체·회신)는 토글이 없다.
    await sendButton.click();
    await dialog.getByText('선택 행 중 1행을 기존 요청에 추가').click();
    expect(await dialog.getByTestId('rfq-send-expand').count()).toBe(1);
    await page.screenshot({ path: `${OUT}/rfq-scope-add-2-dialog.png` });
    await dialog.getByRole('button', { name: '발송 (2곳 · 행 추가 1곳)' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

    expect((await rfqOf('b')).requestedItemIds).toEqual([ids[2], ids[3], ids[0]]);
    expect(await scopeMailCount('b', 1)).toBe(1);
    await expect.poll(() => sendButton.textContent()).not.toContain('행 선택');
    expect(admin.pageErrors).toEqual([]);
  }, 120_000);
});
