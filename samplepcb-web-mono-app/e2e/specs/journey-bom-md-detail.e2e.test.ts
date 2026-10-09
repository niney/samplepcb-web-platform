// Smart BOM 여정 — 외화 회신 + 마스터딜러 중개 **상세 검증**(docs/SMARTBOM_PARTNER_RFQ.md §6.41~6.44).
//
// 앞선 세 여정(journey-bom-partner-fx · md-rfq · md-po)이 API 로 약속을 확인했다면, 이 여정은
// ① 사람이 실제로 누르는 화면 동선(관리자 환율 입력·선정, 마스터딜러 재요청·품목별 선정·하위 발주
//   대행, 관리자 송금 기록)을 화면으로 밟고 ② 경계(부분 범위·마감 뒤·삭제 연쇄·공급 부족·공급사
//   발주·원화 송금)를 찌르고 ③ 화면 두 벌(옛 관리자·새 관리자)·포털 언어·감사 흔적까지 본다.
// 한 견적을 칸칸이 올리며 검증한다(helpers/bom-md-flow.ts). 생성물은 자동 정리하지 않는다 —
// output/journey/findings-bom-md-detail.md 대장. 실행: pnpm -F e2e journey:bom:detail
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  BOM_MD_CHILDREN,
  BOM_MD_ORGS,
  BomMdCase,
  FLOW_LINES,
  FLOW_PRICES,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  ensureBomMdStage,
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  newPhpSession,
  newSession,
  num,
  requireCustomerCreds,
  round2,
  round4,
  signJwt,
  type BomMdStage,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const ACT_AS = 'x-sp-act-as-partner';
/** 계정이 있는 하위 — 관리자가 연결한 조직(마스터딜러 소유가 아니다). */
const CHILD_WITH_ACCOUNT = { mbId: 'e2e-bommd-c', orgName: 'e2e하위부품다', country: 'KR', currency: 'KRW' } as const;

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(
      `${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function actAs(token: string, partnerId: bigint | number, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [ACT_AS]: String(partnerId),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const flat = (raw: string): string => raw.replace(/[\s\u00a0]+/g, ' ');
const text = async (session: { page: any }): Promise<string> =>
  flat((await session.page.locator('body').innerText()) as string);
const textOf = async (locator: any): Promise<string> => flat((await locator.innerText()) as string);

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 — 외화·마스터딜러 상세 검증(화면 동선 + 경계)', () => {
  const rp = createJourneyReport('findings-bom-md-detail', 'BOM 외화·마스터딜러 상세 검증 리포트');
  const { F, ledger } = rp;

  let stage: BomMdStage;
  let customer: PhpLoginResult;
  let adminView: E2eSession;
  let mdView: E2eSession;
  let flow: BomMdCase;

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    stage = await ensureBomMdStage();
    customer = await newPhpSession(requireCustomerCreds());
    adminView = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mdView = await newSession({ mbId: stage.md.mbId ?? '' }, { partnerModule: 'bom' });
    rp.watchHttp(customer, '고객');
    rp.watchHttp(adminView, '관리자');
    rp.watchHttp(mdView, '마스터딜러');
    flow = await BomMdCase.seed(
      stage,
      customer.mbId,
      `[BOM 여정] 외화·중개 상세 ${RUN_KEY}`,
      `[BOM 여정 ${RUN_KEY}] detail fixture`,
    );
    ledger.push(`sp_bom_quote #${flow.quoteId}(본편)`);
  }, 240_000);

  afterAll(async () => {
    rp.write({ 고객: customer, 관리자: adminView, 마스터딜러: mdView });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  const caseUrl = (): string => `/app/admin/smartbom/cases/${flow.quoteId}`;

  test('D01. 발송 — 통화는 보낸 순간에 박제되고, 그 뒤 조직의 통화를 바꿔도 그대로다', async () => {
    await flow.advanceTo(1);
    const prisma = getPrisma();
    await prisma.spPartner.update({ where: { id: stage.cny.id }, data: { defaultCurrency: 'KRW' } });
    try {
      const rfq = (await flow.adminRfqs()).rfqs.find((row) => row.rfqId === flow.cnyRfqId);
      expect(rfq.currency, '이미 보낸 견적요청').toBe('CNY');
    } finally {
      await prisma.spPartner.update({ where: { id: stage.cny.id }, data: { defaultCurrency: 'CNY' } });
    }
    // 발송 알림은 원장에 남는다 — 누구에게 무슨 종류로 갔는지.
    await expect
      .poll(
        async () =>
          prisma.spMailLog.count({ where: { refType: 'bom_quote', refId: flow.quoteId, kind: 'bom_rfq_request' } }),
        { timeout: 15_000, message: '직접 협력사 3곳 발송 기록' },
      )
      .toBe(3);
  }, 120_000);

  test('D02. (화면) 마스터딜러가 포털에서 하위를 골라 다시 요청한다', async () => {
    const page = mdView.page;
    await page.goto(`${BASE_URL}/app/partner/bom/rfqs/${String(flow.mdRfqId)}`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('[data-testid="partner-rfq-children"]');
    await panel.waitFor({ state: 'visible', timeout: 60_000 });
    const sendButton = panel.getByRole('button', { name: '선택한 협력사에 요청 보내기' });
    // 아무것도 고르지 않았으면 보낼 것이 없다.
    expect(await sendButton.isDisabled(), '고른 하위가 없으면 비활성').toBe(true);
    for (const child of [BOM_MD_CHILDREN.a, BOM_MD_CHILDREN.b]) {
      await panel.locator('label').filter({ hasText: child.name }).locator('input[type="checkbox"]').check();
    }
    // 이메일도 계정도 없는 하위는 미리 알린다.
    expect(await panel.locator('label').filter({ hasText: BOM_MD_CHILDREN.b.name }).innerText()).toContain('연락처 없음');
    const sent = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/partner/rfqs/${String(flow.mdRfqId)}/children`),
      { timeout: 30_000 },
    );
    await sendButton.click();
    expect((await sent).status()).toBe(200);
    await panel.getByRole('status').filter({ hasText: '보냄 2곳' }).waitFor({ timeout: 30_000 });
    // 표는 보낸 뒤 목록을 다시 받아 그린다.
    await expect
      .poll(async () => panel.locator('[data-testid="partner-rfq-child-row"]').count(), { timeout: 30_000 })
      .toBe(2);
    await rp.shot(mdView, 'D02-md-fanout');

    // 흐름 도구가 다음 칸을 이어 가도록 하위 재요청을 읽어 온다.
    const children = await api(stage.M, 'GET', `/api/partner/rfqs/${String(flow.mdRfqId)}/children`);
    const rows: any[] = children.json?.data?.rfqs ?? [];
    flow.childA = rows.find((row) => row.partnerId === stage.childAId);
    flow.childB = rows.find((row) => row.partnerId === stage.childBId);
    flow.step = 2;
    expect(flow.childA?.magicToken).toBeTruthy();

    // 하위 재요청 메일도 원장에 남고, 중개 트랙임이 표시된다(발송은 비차단이라 잠깐 기다린다).
    await expect
      .poll(
        async () => {
          const logs = await getPrisma().spMailLog.findMany({
            where: { refType: 'bom_quote', refId: flow.quoteId, kind: 'bom_rfq_request' },
          });
          return logs.filter((log: any) => (log.params as any)?.mdTrack === true).length;
        },
        { timeout: 15_000, message: '하위 재요청 발송 기록(연락처 없는 하위 포함)' },
      )
      .toBe(2);
  }, 180_000);

  test('D03. (화면) 마스터딜러가 품목마다 하위 회신을 골라 마진을 넣는다 — 미리보기가 저장값과 같다', async () => {
    await flow.advanceTo(3);
    const page = mdView.page;
    await page.goto(`${BASE_URL}/app/partner/bom/rfqs/${String(flow.mdRfqId)}`, { waitUntil: 'domcontentloaded' });
    const pick = async (index: number, childRfqId: number, margin: number): Promise<number> => {
      const mpn = FLOW_LINES[index]!.mpn;
      const select = page.getByLabel(`${mpn} 공급 경로`);
      await select.waitFor({ state: 'visible', timeout: 60_000 });
      await select.selectOption(String(childRfqId));
      const marginInput = page.getByLabel(`${mpn} 마진율(%)`);
      await marginInput.fill(String(margin));
      // 하위를 고르면 그 회신의 수량·재고·납기가 따라온다.
      expect(await page.getByLabel(new RegExp(`${mpn} 회신 ?수량`)).inputValue()).toBe(String(FLOW_LINES[index]!.orderQty));
      const row = page.locator('tr').filter({ has: select }).first();
      const preview = await row.locator('td').nth(3).innerText();
      return Number(preview.replace(/[^0-9.]/g, ''));
    };
    const previewA = await pick(0, flow.childA?.rfqId ?? 0, FLOW_PRICES.marginA);
    const previewB = await pick(1, flow.childB?.rfqId ?? 0, FLOW_PRICES.marginB);
    // 하위 회신이 없는 품목은 직접 단가를 넣는다.
    await page.getByLabel(`${FLOW_LINES[2].mpn} 단가(USD)`).fill(String(FLOW_PRICES.mdDirect));
    expect(await page.getByLabel(`${FLOW_LINES[3].mpn} 공급 경로`).locator('option').count(), '회신 없는 품목은 직접 회신뿐').toBe(1);
    await rp.shot(mdView, 'D03-md-selection-before-save');

    const saved = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith(`/api/partner/rfqs/${String(flow.mdRfqId)}`),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '회신 저장', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const items: any[] = (await response.json()).data.items;
    const l0 = items.find((item) => item.quoteItemId === flow.itemIds[0]).reply;
    const l1 = items.find((item) => item.quoteItemId === flow.itemIds[1]).reply;
    flow.crossRate = l0.childSelection.sourceRate;
    expect(l0.unitPrice).toBe(round4(FLOW_PRICES.childA * flow.crossRate * (1 + FLOW_PRICES.marginA / 100)));
    expect(previewA, '화면 미리보기 = 서버 산출값(0번)').toBe(l0.unitPrice);
    expect(previewB, '화면 미리보기 = 서버 산출값(1번)').toBe(l1.unitPrice);
    expect(items.find((item) => item.quoteItemId === flow.itemIds[2]).reply.childSelection ?? null).toBeNull();
    flow.step = 4;
    F('D03', 'obs', `화면 미리보기 ${String(previewA)} · ${String(previewB)} USD = 서버 저장값(위안→달러 ${String(flow.crossRate)})`);

    // 다시 열어도 고른 하위·마진이 그대로 보인다.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(async () => page.getByLabel(`${FLOW_LINES[0].mpn} 마진율(%)`).inputValue(), { timeout: 30_000 })
      .toBe(String(FLOW_PRICES.marginA));
  }, 240_000);

  test('D04. (화면) 관리자가 비교표에서 위안 환율을 직접 넣고 품목별로 선정한다', async () => {
    const page = adminView.page;
    await page.goto(`${BASE_URL}${caseUrl()}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '공급사 비교·선정', exact: true }).click();
    await page.getByText('협력사 외화 환율(이 견적에 고정)').waitFor({ timeout: 60_000 });

    // 환율 직접 입력 — 띠의 표기와 위안 칸의 원화 환산이 따라 바뀐다.
    const rateInput = page.getByLabel('CNY 환율 직접 입력');
    await rateInput.fill(String(FLOW_PRICES.manualCnyRate));
    const fxSaved = page.waitForResponse(
      (response: any) =>
        response.request().method() === 'PUT' && response.url().endsWith(`/api/admin/bom-quotes/${flow.quoteId}/partner-fx`),
      { timeout: 30_000 },
    );
    await rateInput.locator('xpath=following-sibling::button[1]').click();
    expect((await fxSaved).status()).toBe(200);
    flow.cnyRate = FLOW_PRICES.manualCnyRate;
    const expectedKrw = round4(FLOW_PRICES.cny[0] * flow.cnyRate);
    await expect
      .poll(async () => (await text(adminView)).includes(`≈ ${expectedKrw.toLocaleString('ko-KR')}원`), { timeout: 30_000 })
      .toBe(true);
    expect(await text(adminView)).toContain('직접 입력');

    // 품목별 선정 — 0~2번 마스터딜러, 3번 위안 협력사, 4번 원화 협력사.
    const choose = async (index: number, partnerName: string): Promise<void> => {
      await page.getByLabel(`${FLOW_LINES[index]!.mpn} ${partnerName} 회신 선정`).check();
    };
    await choose(0, BOM_MD_ORGS.md.orgName);
    await choose(1, BOM_MD_ORGS.md.orgName);
    await choose(2, BOM_MD_ORGS.md.orgName);
    await choose(3, BOM_MD_ORGS.cny.orgName);
    await choose(4, BOM_MD_ORGS.krw.orgName);
    // 마스터딜러 칸에는 근거 한 줄(하위·원가·환율·마진)이 붙는다.
    expect(await text(adminView)).toContain(`하위 ${BOM_MD_CHILDREN.a.name}`);
    await rp.shot(adminView, 'D04-admin-compare-chosen');
    await page.getByRole('button', { name: '선정 적용', exact: true }).click();
    await page.getByText('협력사 외화 환율(이 견적에 고정)').waitFor({ state: 'hidden', timeout: 90_000 });

    const quote = await flow.adminQuote();
    const offer = (index: number): any => quote.items.find((item: any) => item.id === flow.itemIds[index]).selectedOffer;
    for (const index of [0, 1, 2, 3, 4]) expect(offer(index).currency, `${String(index)}번 박제 통화`).toBe('KRW');
    expect(offer(3).unitPriceKrw).toBe(expectedKrw);
    expect(offer(3).sourcePrice).toEqual({ currency: 'CNY', unitPrice: FLOW_PRICES.cny[0], rate: flow.cnyRate });
    expect(offer(0).sourcePrice.currency).toBe('USD');
    expect(offer(0).sourcePrice.rate).toBe(flow.usdRate);
    flow.itemsTotal = quote.itemsTotal;
    flow.step = 5;

    // 환율을 다시 바꾸면 그 통화로 고른 품목만 재환산된다(화면이 아닌 값으로 확인).
    const bumped = await api(stage.A, 'PUT', `/api/admin/bom-quotes/${flow.quoteId}/partner-fx`, { currency: 'CNY', rate: 210 });
    expect(bumped.status).toBe(200);
    const after = await flow.adminQuote();
    const offerAfter = (index: number): any => after.items.find((item: any) => item.id === flow.itemIds[index]).selectedOffer;
    expect(offerAfter(3).unitPriceKrw).toBe(round4(FLOW_PRICES.cny[0] * 210));
    expect(offerAfter(0).unitPriceKrw, '달러 품목은 그대로').toBe(offer(0).unitPriceKrw);
    expect(offerAfter(4).unitPriceKrw, '원화 품목은 그대로').toBe(offer(4).unitPriceKrw);
    flow.cnyRate = 210;
    flow.itemsTotal = after.itemsTotal;
  }, 300_000);

  test('D05. 새 관리자 화면(shadcn)에도 같은 정보가 선다', async () => {
    const page = adminView.page;
    await rp.assertView(adminView, `/app/admin/next/smartbom/cases/${flow.quoteId}`, 'D05-next-case', [
      flow.title,
      '마스터딜러 하위 재요청',
      BOM_MD_CHILDREN.a.name,
      '마스터딜러 포털로 대리 접속',
    ]);
    await page.getByRole('button', { name: '공급사 비교·선정' }).first().click();
    await page.getByText('협력사 외화 환율(이 견적에 고정)').waitFor({ timeout: 60_000 });
    const dialog = page.getByRole('dialog');
    await expect.poll(async () => (await textOf(dialog)).includes('1 CNY ='), { timeout: 30_000 }).toBe(true);
    const body = await textOf(dialog);
    expect(body).toContain('1 USD =');
    expect(body).toContain('직접 입력');
    expect(body).toContain(`하위 ${BOM_MD_CHILDREN.a.name}`);
    expect(body, '통화 배지').toContain('CNY');
    await rp.shot(adminView, 'D05-next-compare');
  }, 180_000);

  test('D06. 고객에게는 협력사 통화·환율이 나가지 않고, 확정 뒤에는 견적요청·환율이 잠긴다', async () => {
    const C = signJwt({ mbId: customer.mbId, ttlSec: 600 });
    const before = await api(C, 'GET', `/api/bom/quotes/${flow.quoteId}`);
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    const raw = JSON.stringify(before.json);
    expect(raw).not.toContain('"sourcePrice":{');
    expect(raw, '위안 회신 단가').not.toContain(String(FLOW_PRICES.cny[0]));
    expect(raw, '하위 회신 단가').not.toContain(String(FLOW_PRICES.childB));

    await flow.advanceTo(6);
    // 마감 — 하위 매직링크·마스터딜러 재요청·마스터딜러 회신·환율 변경이 전부 거절된다.
    const line = { quoteItemId: flow.itemIds[0], unitPrice: 1, replyQty: null, moq: null, stock: null, dateCode: null, leadTime: null, memo: null };
    const childWrite = await api(null, 'PUT', `/api/rfq-reply/${flow.childA?.magicToken ?? ''}`, { items: [line], deliveryDate: null, memo: null });
    expect(childWrite.status, '하위 매직링크 회신').toBe(409);
    const refan = await api(stage.M, 'POST', `/api/partner/rfqs/${String(flow.mdRfqId)}/children`, { partnerIds: [stage.childAId] });
    expect(refan.status, '마감 뒤 재요청').toBe(409);
    expect(refan.json?.error).toBe('RFQ_CLOSED');
    const mdWrite = await api(stage.M, 'PUT', `/api/partner/rfqs/${String(flow.mdRfqId)}`, { items: [line], deliveryDate: null, memo: null });
    expect(mdWrite.status, '마감 뒤 마스터딜러 회신').toBe(409);
    const fx = await api(stage.A, 'PUT', `/api/admin/bom-quotes/${flow.quoteId}/partner-fx`, { currency: 'USD', rate: 1500 });
    expect(fx.status, '확정 뒤 환율 변경').toBe(409);
    // 화면 — 마스터딜러 포털은 읽기 전용으로 남고 재요청 영역은 사라진다.
    await rp.assertView(mdView, `/app/partner/bom/rfqs/${String(flow.mdRfqId)}`, 'D06-md-closed', [
      flow.title,
      '마감된 견적 요청입니다',
    ]);
    expect(await mdView.page.getByRole('button', { name: '회신 저장' }).count()).toBe(0);
    expect(await mdView.page.locator('[data-testid="partner-rfq-children"]').count(), '마감 뒤 재요청 영역 없음').toBe(0);
  }, 180_000);

  test('D07. 발주 — 원장에 결제통화·장부 환율이 박제되고, 상위 발주서를 지우면 하위 발주도 사라진다', async () => {
    await flow.advanceTo(8, { customer, rp, prefix: 'D07-detail-order' });
    ledger.push(`g5_shop_order ${flow.odId}`, `sp_bom_po #${String(flow.mdPoId)}·#${String(flow.cnyPoId)}·#${String(flow.krwPoId)}`);
    const prisma = getPrisma();
    const row = await prisma.spBomPo.findUnique({ where: { id: BigInt(flow.cnyPoId) }, include: { items: true } });
    expect(row.currency).toBe('CNY');
    expect(Number(row.totalOriginal)).toBe(round2(FLOW_PRICES.cny[0] * FLOW_LINES[3].orderQty));
    expect(Number(row.items[0].unitPriceOriginal)).toBe(FLOW_PRICES.cny[0]);
    // 원화 회계값 = 결제통화 금액 × 발행일 실제 환율.
    expect(row.totalAmount).toBe(Math.round(Number(row.totalOriginal) * Number(row.exchangeRate)));

    // 마스터딜러가 확인하기 전(발행됨) — 하위 발주를 먼저 냈어도 상위 발주서 삭제에 딸려 간다.
    const early = await api(stage.M, 'POST', `/api/partner/pos/${String(flow.mdPoId)}/child-pos`, { partnerIds: [stage.childAId] });
    expect(early.status, JSON.stringify(early.json)).toBe(200);
    expect(await prisma.spBomMdPo.count({ where: { poId: BigInt(flow.mdPoId) } })).toBe(1);
    const earlyMdPoId: number = (early.json?.data?.groups ?? []).find((group: any) => group.partnerId === stage.childAId).mdPo.mdPoId;
    const deletePo = () => api(stage.A, 'DELETE', `/api/admin/bom-quotes/${flow.quoteId}/pos/${String(flow.mdPoId)}`);
    const advanceEarly = (action: string) =>
      api(stage.M, 'POST', `/api/partner/md-pos/${String(earlyMdPoId)}/advance`, { action });

    // 하위가 이미 확인한 발주가 있으면 상위 발주서를 지울 수 없다 — 되돌리면 다시 열린다.
    expect((await advanceEarly('confirm')).status).toBe(200);
    const blockedByChild = await deletePo();
    expect(blockedByChild.status, JSON.stringify(blockedByChild.json)).toBe(409);
    expect(blockedByChild.json?.error).toBe('HAS_ACTIVE_CHILD_POS');
    expect((await advanceEarly('revert')).status).toBe(200);

    // 송금 기록이 있는 발주서도 지울 수 없다 — 돈 기록이 조용히 사라지면 안 된다.
    const remitPath = `/api/admin/bom-pos/${String(flow.mdPoId)}/remittances`;
    const remitted = await api(stage.A, 'POST', remitPath, {
      remittedOn: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
      amount: 1,
      exchangeRate: 1_400,
    });
    expect(remitted.status, JSON.stringify(remitted.json)).toBe(200);
    const blockedByMoney = await deletePo();
    expect(blockedByMoney.status, JSON.stringify(blockedByMoney.json)).toBe(409);
    expect(blockedByMoney.json?.error).toBe('HAS_REMITTANCE');
    expect(await prisma.spBomRemittance.count({ where: { poId: BigInt(flow.mdPoId) } }), '송금 기록 보존').toBe(1);
    expect(await prisma.spBomMdPo.count({ where: { poId: BigInt(flow.mdPoId) } }), '하위 발주 보존').toBe(1);
    const cleared = await api(stage.A, 'DELETE', `${remitPath}/${String(remitted.json?.data?.items?.[0]?.id)}`);
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);

    // 아무도 손대지 않은 하위 발주(확인 대기)는 발주서와 함께 거둔다.
    const removed = await deletePo();
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect(await prisma.spBomMdPo.count({ where: { poId: BigInt(flow.mdPoId) } }), '하위 발주 연쇄 삭제').toBe(0);
    expect((await actAs(stage.A, stage.childAId, 'GET', '/api/partner/md-pos')).json?.data?.items?.some((item: any) => item.poId === flow.mdPoId) ?? false).toBe(false);

    // 다시 발행 — 흐름을 잇는다.
    const reissued = await api(stage.A, 'POST', `/api/admin/bom-quotes/${flow.quoteId}/pos`, { partnerIds: [num(stage.md.id)] });
    expect(reissued.status, JSON.stringify(reissued.json)).toBe(200);
    const mdPo = (reissued.json?.data?.pos ?? []).find((po: any) => po.partnerId === num(stage.md.id));
    flow.mdPoId = mdPo.poId;
    flow.mdPoTotal = mdPo.totalOriginal;
    flow.mdPoBookedRate = mdPo.exchangeRate;
    ledger.push(`sp_bom_po #${String(flow.mdPoId)}(마스터딜러 재발행)`);
  }, 420_000);

  test('D08. (화면) 마스터딜러가 하위 발주를 보내고 대행으로 확인·출고·수령까지 찍는다', async () => {
    const confirmed = await api(stage.M, 'POST', `/api/partner/pos/${String(flow.mdPoId)}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    const page = mdView.page;
    await page.goto(`${BASE_URL}/app/partner/bom/pos/${String(flow.mdPoId)}`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('[data-testid="partner-po-children"]');
    await panel.waitFor({ state: 'visible', timeout: 60_000 });
    // 안 보낸 하위는 기본으로 전부 골라져 있다.
    expect(await panel.locator('input[type="checkbox"]:checked').count()).toBe(2);
    await panel.getByLabel('발주 메모').fill(`[BOM 여정 ${RUN_KEY}] 화면에서 보낸 하위 발주`);
    await panel.getByRole('button', { name: '하위 발주서 보내기' }).click();
    const cards = panel.locator('[data-testid="partner-md-po"]');
    await expect.poll(async () => cards.count(), { timeout: 30_000 }).toBe(2);
    const cardA = cards.filter({ hasText: BOM_MD_CHILDREN.a.name });
    expect(await textOf(cardA)).toContain('포털 계정 없음');
    expect(await textOf(cardA)).toContain('CNY 48.00');

    // 대행 — 확인 → (택배사·송장) 출고 → 수령.
    await cardA.getByRole('button', { name: '확인 처리(대행)' }).click();
    await cardA.getByLabel('택배사').fill('SF Express');
    await cardA.getByLabel('송장번호').fill(`SF-${RUN_KEY}`);
    await cardA.getByRole('button', { name: '출고 처리(대행)' }).click();
    await cardA.getByRole('button', { name: '수령 확인' }).waitFor({ timeout: 30_000 });
    expect(await textOf(cardA)).toContain(`SF-${RUN_KEY}`);
    // 아직 받지 않은 발주가 있다고 알린다.
    expect(await textOf(panel)).toContain('아직 받지 않은 발주가 2건');
    // 출고된 문서에는 삭제 버튼이 없다.
    expect(await cardA.getByRole('button', { name: '삭제' }).count()).toBe(0);
    await rp.shot(mdView, 'D08-md-child-po-shipped');
    await cardA.getByRole('button', { name: '수령 확인' }).click();
    await expect.poll(async () => (await textOf(cardA)).includes('수령 완료'), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await textOf(panel)).includes('아직 받지 않은 발주가 1건'), { timeout: 30_000 }).toBe(true);

    const plan = await api(stage.M, 'GET', `/api/partner/pos/${String(flow.mdPoId)}/child-pos`);
    const groups: any[] = plan.json?.data?.groups ?? [];
    flow.mdPoA = groups.find((group) => group.partnerId === stage.childAId).mdPo.mdPoId;
    flow.mdPoB = groups.find((group) => group.partnerId === stage.childBId).mdPo.mdPoId;
    expect(groups.find((group) => group.partnerId === stage.childAId).mdPo.status).toBe('received');
    ledger.push(`sp_bom_md_po #${String(flow.mdPoA)}·#${String(flow.mdPoB)}`);
    // 하위 발주 메일도 원장에 남는다(연락처 없는 하위는 건너뜀으로).
    await expect
      .poll(
        async () =>
          getPrisma().spMailLog.count({ where: { refType: 'bom_quote', refId: flow.quoteId, kind: 'bom_md_po_issued' } }),
        { timeout: 15_000, message: '하위 발주 발송 기록' },
      )
      .toBeGreaterThanOrEqual(2);
  }, 240_000);

  test('D09. (화면) 관리자가 송금을 적는다 — 일부 지급·환차·잔액 채우기·삭제', async () => {
    const page = adminView.page;
    await page.goto(`${BASE_URL}${caseUrl()}`, { waitUntil: 'domcontentloaded' });
    const extras = page.locator(`[data-testid="bom-po-extras"][data-po-id="${String(flow.mdPoId)}"]`);
    await extras.waitFor({ state: 'visible', timeout: 60_000 });
    expect(await extras.innerText()).toContain('미지급');
    expect(await extras.innerText()).toContain('하위 발주 2건');
    await extras.getByRole('button', { name: '송금 기록', exact: true }).click();
    const editor = extras.locator('[data-testid="bom-remittance-editor"]');
    await editor.getByText('아직 송금 기록이 없습니다.').waitFor({ timeout: 30_000 });

    // 금액 없이 누르면 화면이 막는다.
    await editor.getByRole('button', { name: '송금 기록 추가' }).click();
    await editor.getByRole('alert').filter({ hasText: '금액은 0보다 큰 숫자로' }).waitFor({ timeout: 10_000 });

    // 1차 — 절반을 장부보다 30원 비싼 환율로.
    const half = round2(flow.mdPoTotal / 2);
    const paidRate = flow.mdPoBookedRate + 30;
    await editor.getByLabel('송금 금액').fill(String(half));
    await editor.getByLabel('실제 적용 환율').fill(String(paidRate));
    await editor.getByRole('button', { name: '송금 기록 추가' }).click();
    await expect.poll(async () => editor.locator('tbody tr').count(), { timeout: 30_000 }).toBe(1);
    const diff = Math.round(half * paidRate) - Math.round(half * flow.mdPoBookedRate);
    await expect.poll(async () => (await extras.innerText()).includes('일부 지급'), { timeout: 30_000 }).toBe(true);
    expect((await extras.innerText()).replace(/\s+/g, ' ')).toContain(`환차 +${diff.toLocaleString('ko-KR')}원`);

    // 2차 — [잔액 채우기]가 남은 금액을 채운다. 환율은 비워 고시 환율로.
    await editor.getByRole('button', { name: '잔액 채우기' }).click();
    expect(await editor.getByLabel('송금 금액').inputValue()).toBe(String(round2(flow.mdPoTotal - half)));
    await editor.getByRole('button', { name: '송금 기록 추가' }).click();
    await expect.poll(async () => editor.locator('tbody tr').count(), { timeout: 30_000 }).toBe(2);
    await expect.poll(async () => (await extras.innerText()).includes('지급 완료'), { timeout: 30_000 }).toBe(true);
    await rp.shot(adminView, 'D09-admin-remittance-paid');

    // 잘못 적은 기록은 지운다 — 요약이 되돌아간다.
    await editor.locator('tbody tr').nth(1).getByRole('button', { name: '삭제' }).click();
    await expect.poll(async () => editor.locator('tbody tr').count(), { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => (await extras.innerText()).includes('일부 지급'), { timeout: 30_000 }).toBe(true);

    const summary = (await flow.adminPos()).find((po) => po.poId === flow.mdPoId).remittance;
    expect(summary).toMatchObject({ status: 'partial', paidAmount: half, balance: round2(flow.mdPoTotal - half), fxDiffKrw: diff });
    // 협력사 포털 — 받은 금액·잔액만.
    await rp.assertView(mdView, `/app/partner/bom/pos/${String(flow.mdPoId)}`, 'D09-md-remittance', ['입금', '잔액']);
    expect(await text(mdView)).not.toContain('환차');
  }, 240_000);

  test('D10. 송금의 경계 — 원화 발주·공급 부족·공급사 발주', async () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    // 원화 발주 — 환율을 보내도 무시한다(환율·원화 환산·환차가 없다).
    const krw = await api(stage.A, 'POST', `/api/admin/bom-pos/${String(flow.krwPoId)}/remittances`, {
      remittedOn: today,
      amount: 1_000,
      exchangeRate: 1_400,
    });
    expect(krw.status, JSON.stringify(krw.json)).toBe(200);
    expect(krw.json?.data?.items?.[0]).toMatchObject({ currency: 'KRW', exchangeRate: null, krwAmount: null, fxDiffKrw: null });
    expect(krw.json?.data?.summary).toMatchObject({ status: 'partial', fxDiffKrw: null });
    expect(krw.json?.data?.bookedRate).toBeNull();

    // 공급 부족 — 위안 협력사가 400개 중 100개를 못 준다고 신고하면 지급할 금액이 줄어든다.
    const confirmed = await api(stage.C, 'POST', `/api/partner/pos/${String(flow.cnyPoId)}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    const poItemId: number = confirmed.json?.data?.items?.[0]?.poItemId;
    const shortage = await api(stage.C, 'POST', `/api/partner/pos/${String(flow.cnyPoId)}/shortages`, {
      poItemId,
      shortageQty: 100,
      reason: 'insufficient_stock',
      note: `[BOM 여정 ${RUN_KEY}] 300개만 공급 가능`,
    });
    expect(shortage.status, JSON.stringify(shortage.json)).toBe(200);
    // 협력사에게는 결제통화 금액(2자리)으로.
    expect(shortage.json?.data?.actualSupplyAmount).toBe(round2(FLOW_PRICES.cny[0] * 300));
    const cnyPo = (await flow.adminPos()).find((po) => po.poId === flow.cnyPoId);
    expect(cnyPo.remittance.poAmount, '지급할 금액 = 실제 공급 금액').toBe(round2(FLOW_PRICES.cny[0] * 300));
    expect(cnyPo.totalOriginal, '발주 문서 금액은 그대로').toBe(round2(FLOW_PRICES.cny[0] * 400));

    // 공급사 발주 — 송금 기록 대상이 아니다(공급사 사이트에서 결제).
    const prisma = getPrisma();
    const supplier = await prisma.spPartner.findFirst({ where: { type: 'supplier' } });
    const supplierPo = await prisma.spBomPo.create({
      data: { quoteId: BigInt(flow.quoteId), partnerId: supplier.id, status: 'issued', totalAmount: 1_000 },
    });
    try {
      const denied = await api(stage.A, 'GET', `/api/admin/bom-pos/${String(supplierPo.id)}/remittances`);
      expect(denied.status).toBe(409);
      expect(denied.json?.error).toBe('NOT_PARTNER_PO');
      const write = await api(stage.A, 'POST', `/api/admin/bom-pos/${String(supplierPo.id)}/remittances`, { remittedOn: today, amount: 10 });
      expect(write.status).toBe(409);
    } finally {
      await prisma.spBomPo.delete({ where: { id: supplierPo.id } });
    }
    // 협력사는 남의 송금 기록 주소를 쓸 수 없다(관리자 전용).
    expect((await api(stage.M, 'GET', `/api/admin/bom-pos/${String(flow.mdPoId)}/remittances`)).status).toBe(403);
  }, 180_000);

  test('D11. 해외 송장 초안은 결제통화로 — 공급 부족분을 뺀 수량', async () => {
    const created = await api(stage.C, 'POST', '/api/partner/shipments', { poIds: [flow.cnyPoId] });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    expect(created.json?.data?.mode).toBe('international');
    ledger.push(`sp_bom_shipment #${String(created.json?.data?.shipmentId)}(위안 협력사)`);
    const draft = await api(stage.C, 'GET', `/api/partner/pos/${String(flow.cnyPoId)}/shipment/invoice?fresh=true`);
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    const invoice = draft.json?.data;
    expect(invoice.currency).toBe('CNY');
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]).toMatchObject({
      currency: 'CNY',
      qty: '300',
      unitValue: FLOW_PRICES.cny[0],
      totalValue: round2(FLOW_PRICES.cny[0] * 300),
    });
    expect(invoice.totalValue).toBe(round2(FLOW_PRICES.cny[0] * 300));
  }, 120_000);

  test('D12. 감사 흔적 — 관리자 대리 접속으로 한 쓰기가 원장에 남는다', async () => {
    const prisma = getPrisma();
    const before = await prisma.spPartnerActLog.count({ where: { partnerId: stage.md.id } });
    const acted = await actAs(stage.A, stage.md.id, 'POST', `/api/partner/md-pos/${String(flow.mdPoB)}/advance`, { action: 'confirm' });
    expect(acted.status, JSON.stringify(acted.json)).toBe(200);
    await expect
      .poll(async () => prisma.spPartnerActLog.count({ where: { partnerId: stage.md.id } }), { timeout: 10_000 })
      .toBe(before + 1);
    const last = await prisma.spPartnerActLog.findFirst({ where: { partnerId: stage.md.id }, orderBy: { id: 'desc' } });
    expect(last).toMatchObject({ adminMbId: 'e2e-admin', method: 'POST', statusCode: 200 });
    expect(last.path).toContain(`/md-pos/${String(flow.mdPoB)}/advance`);
    // 하위 발주에는 누가 냈는지가 남는다.
    const mdPo = await prisma.spBomMdPo.findUnique({ where: { id: BigInt(flow.mdPoB) } });
    expect(mdPo.issuedBy).toBe(stage.md.mbId);
  }, 60_000);

  test('D13. 포털은 영어·중국어로도 선다 — 통화와 금액은 그대로', async () => {
    for (const [locale, heading, source] of [
      ['en', 'Sub-partner orders', 'Received'],
      ['zh-CN', '下级合作伙伴订单', '已收货'],
    ] as const) {
      const session = await newSession(
        { mbId: stage.md.mbId ?? '' },
        { partnerModule: 'bom', localStorage: { 'sp.partner.locale': locale } },
      );
      try {
        await rp.assertView(session, `/app/partner/bom/pos/${String(flow.mdPoId)}`, `D13-md-po-${locale}`, [heading]);
        // 하위 나는 확인까지 갔다 — 출고 대행 버튼이 그 언어로 보인다.
        const body = await text(session);
        expect(body, `${locale} 포털에 한국어 원문이 새지 않는다`).not.toContain('하위 협력사 발주');
        expect(body, '통화와 금액은 언어와 무관').toMatch(/CNY\s?48\.00/);
        expect(body, '수령 완료된 하위 발주의 상태 문구').toContain(source);
      } finally {
        await session.close();
      }
    }
  }, 180_000);

  test('D14. 부분 범위 — 마스터딜러가 일부만 받았으면 하위도 그 안에서만 본다', async () => {
    const second = await BomMdCase.seed(stage, customer.mbId, `[BOM 여정] 부분 범위 ${RUN_KEY}`, `[BOM 여정 ${RUN_KEY}] partial scope`);
    ledger.push(`sp_bom_quote #${second.quoteId}(부분 범위)`);
    const scope = [second.itemIds[0], second.itemIds[1]];
    const sent = await api(stage.A, 'POST', `/api/admin/bom-quotes/${second.quoteId}/rfqs`, {
      partnerIds: [num(stage.md.id)],
      itemIds: scope,
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const mdRfqId: number = sent.json?.data?.rfqs?.[0]?.rfqId;
    expect(sent.json?.data?.rfqs?.[0]?.requestedItemIds).toEqual(scope);

    // 받지 않은 품목은 하위에게 보낼 수 없다.
    const outside = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [stage.childAId],
      requestedItemIds: [second.itemIds[2]],
    });
    expect(outside.status).toBe(400);
    expect(outside.json?.error).toBe('ITEM_OUT_OF_SCOPE');
    // 범위를 생략하면 "견적 전체"가 아니라 내가 받은 집합이 박제된다.
    const fanned = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, { partnerIds: [stage.childAId] });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);
    const child = fanned.json?.data?.rfqs?.[0];
    expect([...child.requestedItemIds].sort()).toEqual([...scope].sort());
    const opened = await api(null, 'GET', `/api/rfq-reply/${String(child.magicToken)}`);
    expect(opened.json?.data?.rfq?.items).toHaveLength(2);
    // 받은 범위 안의 부분집합은 보낼 수 있다.
    const subset = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, {
      partnerIds: [stage.childAId, stage.childBId],
      requestedItemIds: [second.itemIds[1]],
    });
    expect(subset.status, JSON.stringify(subset.json)).toBe(200);
    const childB = (subset.json?.data?.rfqs ?? []).find((row: any) => row.partnerId === stage.childBId);
    expect(childB.requestedItemIds).toEqual([second.itemIds[1]]);
    // 범위 밖 품목에 대한 하위 회신은 거절된다.
    const wrong = await api(null, 'PUT', `/api/rfq-reply/${String(childB.magicToken)}`, {
      items: [{ quoteItemId: second.itemIds[0], unitPrice: 1, replyQty: null, moq: null, stock: null, dateCode: null, leadTime: null, memo: null }],
      deliveryDate: null,
      memo: null,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json?.error).toBe('ITEM_OUT_OF_SCOPE');
  }, 180_000);

  test('D16. 진행 중인 부품 조달 거래가 있으면 하위 협력사를 지우거나 소속을 풀 수 없다', async () => {
    // 무대 조직을 건드리지 않게 이 케이스만의 하위를 만들고, 끝에서 지운다.
    const name = `e2e임시하위${RUN_KEY}`;
    const created = await api(stage.M, 'POST', '/api/partner/children', {
      name,
      country: 'CN',
      settlementCurrency: 'USD',
      contactEmail: null,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const tempId: number = (created.json?.data?.items ?? []).find((item: any) => item.name === name).partnerId;

    const fourth = await BomMdCase.seed(stage, customer.mbId, `[BOM 여정] 진행 중 가드 ${RUN_KEY}`, `[BOM 여정 ${RUN_KEY}] active guard`);
    ledger.push(`sp_bom_quote #${fourth.quoteId}(진행 중 가드)`);
    const sent = await api(stage.A, 'POST', `/api/admin/bom-quotes/${fourth.quoteId}/rfqs`, { partnerIds: [num(stage.md.id)] });
    const mdRfqId: number = sent.json?.data?.rfqs?.[0]?.rfqId;
    const fanned = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, { partnerIds: [tempId] });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);

    const activeOf = async (): Promise<number> =>
      ((await api(stage.M, 'GET', '/api/partner/children')).json?.data?.items ?? []).find((item: any) => item.partnerId === tempId).activeCount;
    expect(await activeOf(), '포털 목록의 진행 중 건수').toBe(1);

    // 마스터딜러 — 삭제·사용 중지 거절.
    const removeChild = () => api(stage.M, 'DELETE', `/api/partner/children/${String(tempId)}`);
    const blocked = await removeChild();
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409);
    expect(blocked.json?.error).toBe('RELATION_ACTIVE');
    expect((await getPrisma().spPartner.findUnique({ where: { id: BigInt(tempId) } })).status, '조직은 그대로').toBe('approved');

    // 관리자 — 소속 해제 거절, 화면 숫자도 같은 판정.
    const relations = await api(stage.A, 'GET', `/api/admin/partners/${String(num(stage.md.id))}/relations`);
    expect((relations.json?.data?.children ?? []).find((link: any) => link.partnerId === tempId)?.activeCount).toBe(1);
    const unlink = await api(stage.A, 'DELETE', `/api/admin/partners/${String(num(stage.md.id))}/relations/${String(tempId)}`);
    expect(unlink.status, JSON.stringify(unlink.json)).toBe(409);
    expect(unlink.json?.error).toBe('RELATION_ACTIVE');

    // 하위 재요청을 회수하면 풀린다 — 이력이 없으니 실제로 지워진다.
    const withdrawn = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, { partnerIds: [] });
    expect(withdrawn.json?.data?.removed).toBe(1);
    expect(await activeOf()).toBe(0);
    const gone = await removeChild();
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(gone.json?.data?.outcome).toBe('deleted');
  }, 180_000);

  test('D15. 계정이 있는 하위 — 포털에서 누가 요청했는지 보고 회신한다(원화 하위 → 달러 마스터딜러)', async () => {
    const child = await ensureStagePartner({ ...CHILD_WITH_ACCOUNT, capabilities: ['bom_rfq'] });
    await ensureMdRelation(stage.md, child, 'KRW');
    const token = signJwt({ mbId: child.mbId ?? '', ttlSec: 3_600 });

    const third = await BomMdCase.seed(stage, customer.mbId, `[BOM 여정] 계정 있는 하위 ${RUN_KEY}`, `[BOM 여정 ${RUN_KEY}] child with account`);
    ledger.push(`sp_bom_quote #${third.quoteId}(계정 있는 하위)`);
    const sent = await api(stage.A, 'POST', `/api/admin/bom-quotes/${third.quoteId}/rfqs`, { partnerIds: [num(stage.md.id)] });
    const mdRfqId: number = sent.json?.data?.rfqs?.[0]?.rfqId;

    // 관리자가 연결한 하위도 재요청 후보다(소유가 아니어도 소속이면 된다).
    const candidates = await api(stage.M, 'GET', `/api/partner/rfqs/${String(mdRfqId)}/children`);
    const candidate = (candidates.json?.data?.candidates ?? []).find((row: any) => row.partnerId === num(child.id));
    expect(candidate).toMatchObject({ currency: 'KRW', hasPortalAccount: true });
    const fanned = await api(stage.M, 'POST', `/api/partner/rfqs/${String(mdRfqId)}/children`, { partnerIds: [num(child.id)] });
    expect(fanned.status, JSON.stringify(fanned.json)).toBe(200);
    const childRfq = fanned.json?.data?.rfqs?.[0];
    expect(childRfq.currency).toBe('KRW');

    // 하위 포털 — 목록과 상세에 요청 조직이 보이고, 자기는 다시 재요청할 수 없다.
    const list = await api(token, 'GET', '/api/partner/rfqs');
    const mine = (list.json?.data?.items ?? []).find((row: any) => row.rfqId === childRfq.rfqId);
    expect(mine.requesterName).toBe(BOM_MD_ORGS.md.orgName);
    const childView = await newSession({ mbId: child.mbId ?? '' }, { partnerModule: 'bom' });
    try {
      await rp.assertView(childView, `/app/partner/bom/rfqs/${String(childRfq.rfqId)}`, 'D15-child-portal-rfq', [
        third.title,
        `요청처 ${BOM_MD_ORGS.md.orgName}`,
        '단가(KRW)',
      ]);
      expect(await childView.page.locator('[data-testid="partner-rfq-children"]').count(), '하위에게는 재요청 영역이 없다').toBe(0);
    } finally {
      await childView.close();
    }
    const replied = await api(token, 'PUT', `/api/partner/rfqs/${String(childRfq.rfqId)}`, {
      items: [{ quoteItemId: third.itemIds[0], unitPrice: 5, replyQty: 2_000, moq: 1, stock: 9_000, dateCode: '25+', leadTime: '국내 재고', memo: null }],
      deliveryDate: null,
      memo: null,
    });
    expect(replied.status, JSON.stringify(replied.json)).toBe(200);

    // 마스터딜러 — 원화 하위 회신을 달러로 환산(원→달러 환율 < 1)해 마진을 얹는다.
    const mdReply = await api(stage.M, 'PUT', `/api/partner/rfqs/${String(mdRfqId)}`, {
      items: [{ quoteItemId: third.itemIds[0], unitPrice: 0, replyQty: 2_000, moq: 1, stock: 9_000, dateCode: '25+', leadTime: '국내 재고', memo: null, childRfqId: childRfq.rfqId, marginRate: 20 }],
      deliveryDate: null,
      memo: null,
    });
    expect(mdReply.status, JSON.stringify(mdReply.json)).toBe(200);
    const reply = mdReply.json?.data?.items?.find((item: any) => item.quoteItemId === third.itemIds[0]).reply;
    expect(reply.childSelection.sourceCurrency).toBe('KRW');
    expect(reply.childSelection.sourceRate, '원→달러').toBeLessThan(0.01);
    expect(reply.unitPrice).toBe(round4(5 * reply.childSelection.sourceRate * 1.2));
    F('D15', 'obs', `원화 하위 5원 × ${String(reply.childSelection.sourceRate)}(원→달러) × 1.2 = $${String(reply.unitPrice)}`);
  }, 240_000);
});
