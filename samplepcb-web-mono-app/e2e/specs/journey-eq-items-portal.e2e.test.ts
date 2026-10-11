// EQ 고객 회신 — 협력사 포털 화면(D20 P1 화면 트랙).
//
// API 왕복은 journey-eq-items 가 박제했다. 이 주행은 **공장이 화면에서 읽을 수 있는가**를 본다 —
// 공장은 자기 EQ 표의 선택지 기호(A/B/C)로 답을 읽고, 화면 언어는 대개 중국어다.
//
// 표적:
//   ① **전달 전엔 영역이 없다** — 고객이 답해도 관리자가 전달하기 전까지는 포털에 안 보이고,
//      '지금 할 일'도 승인 대기 그대로다.
//   ② **전달 뒤 문항별로 읽힌다** — 공장 원문 질문·원문 선택지·고른 기호 강조·고객 의견(원문 표시).
//   ③ **'지금 할 일'이 다음 수를 말한다** — 승인을 기다리거나, [EQ 요청 취소] 후 수정 EQ 를 올린다.
//   ④ **언어 전환** — en/zh 에서 화면 문구는 번역되고 데이터(고객 의견)만 원문으로 남는다.
//   ⑤ **좁은 화면** — 390px 에서 가로 넘침 0(긴 원문·의견이 카드를 터뜨리지 않는다).
//   ⑥ **회차** — 이전 요청에 대한 답은 "도착"으로 말하지 않고, 새 회차가 오면 회차를 고를 수 있다.
//   ⑦ **MD 관전** — 위임 상위는 하위 발주서의 회차를 받고, 하위 발주 관전은 MD 문구로 말한다.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items-portal
// 사전: API(3333)·웹(5173, nginx 경유)·e2e/.env.e2e 고객 아이디. 스크린샷은 리포 루트 .tmp/eq-portal-shots/.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 세우고 지운다. MD 무대 계정·조직·관계는 상설(md-eq-observe 와 공유).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import { translatePartnerMessage, type PartnerLocale, type PartnerMessages } from '../../apps/web/src/partner/i18n-core';
import { bomMessages } from '../../apps/web/src/partner/locales/bom';
import { childrenMessages } from '../../apps/web/src/partner/locales/children';
import { commonMessages } from '../../apps/web/src/partner/locales/common';
import { partsMessages } from '../../apps/web/src/partner/locales/parts';
import { pcbMessages } from '../../apps/web/src/partner/locales/pcb';
import { shipmentMessages } from '../../apps/web/src/partner/locales/shipment';
import {
  API_URL,
  MAILPIT_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countCartRows,
  countPcbResidue,
  createG5OrderFixture,
  createOrderSpec,
  createPcbPo,
  deleteOrderHard,
  disconnectPrisma,
  ensureMdRelation,
  ensureStagePartner,
  getPartner,
  getPrisma,
  gotoApp,
  mailpitDelete,
  mailpitSearch,
  monoRoot,
  newSession,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

// 수주 조직 — journey-eq-items 와 같은 협력2(전달 메일 수신처가 있다).
const OWNER = '협력2';
const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };
const SHOTS = join(monoRoot, '..', '.tmp', 'eq-portal-shots');
const HANGUL = /[가-힣]/;

/** 포털이 실제로 쓰는 사전으로 기대 문구를 만든다 — 화면 문구를 테스트에 두 벌 적지 않는다.
 *  병합 순서는 apps/web/src/partner/i18n.ts 의 partnerMessages 와 같다(그 파일은 vue 를 끌어온다). */
const partnerMessages: PartnerMessages = {
  ...childrenMessages, ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages,
};
const tr = (source: string, locale: PartnerLocale, params?: Record<string, string | number>): string =>
  translatePartnerMessage(partnerMessages, source, locale, true, params);

const TODO_ARRIVED = '고객 회신이 도착했습니다 — 아래 \'고객 회신\'에서 문항별 선택을 확인해 주세요.';
const TODO_WAITING = '샘플피씨비 관리자의 EQ 승인을 기다리고 있습니다.';

describe.skipIf(!RUN)('EQ 고객 회신 — 협력사 포털 화면(D20)', () => {
  let owner: PartnerFixture;
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 협력사(협력2)
  let C = ''; // 고객(주문자)
  let M = ''; // MD
  let S = ''; // MD 하위
  let customerId = '';
  const token = `e2eeqp${String(Date.now())}`;
  const startedAt = new Date();
  const orders: G5OrderFixture[] = [];
  const specIds: bigint[] = [];
  const seeded: bigint[] = [];
  const sessions: E2eSession[] = [];
  let childRfqId: bigint | null = null;

  let poId = 0;
  let projectName = '';
  let r1: any = null; // 1차(전달 대상) — 고객 회신 뒤 모양
  let mdTopPoId = 0;
  let mdChildPoId = 0;
  let mdProjectName = '';

  const COMMENT = `좌측 하단에 넣어 주세요 ${token}`;
  const ITEMS = [
    {
      factoryNo: '1',
      category: 'marking',
      question: 'UL 마킹을 보드에 넣을까요?',
      questionOrig: '是否需要在板上加UL标记？请贵司确认标记位置，如不需要请选择A。',
      options: [
        { key: 'A', label: '공장 제안대로 넣지 않음', labelOrig: '按我司建议不加', recommended: true, requiresComment: false },
        { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置（请在意见栏注明具体位置及方向）', recommended: false, requiresComment: true },
      ],
      figures: [],
      prevItemId: null,
      change: null,
    },
    {
      factoryNo: '2',
      category: 'drill',
      question: '0.2mm 비아를 0.25mm 로 키워도 될까요?',
      questionOrig: '0.2mm孔径加大到0.25mm可以吗？',
      options: [
        { key: 'A', label: '키워도 됩니다', labelOrig: '可以', recommended: true, requiresComment: false },
        { key: 'B', label: '안 됩니다', labelOrig: '不可以', recommended: false, requiresComment: false },
      ],
      figures: [],
      prevItemId: null,
      change: null,
    },
  ];

  // ── API 조각 ───────────────────────────────────────────────────────────────
  const uploadEq = async (tok: string, id: number, name: string): Promise<number> => {
    const form = new FormData();
    form.set('fileType', 'eq');
    form.set('file', new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], name, { type: 'application/vnd.ms-excel' }));
    const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(id)}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}` },
      body: form,
    });
    return res.status;
  };
  const eqRequest = async (tok: string, id: number): Promise<void> => {
    const res = await api(tok, 'POST', `/api/partner/pcb-pos/${String(id)}/eq-request`);
    expect(res.status, `승인요청: ${JSON.stringify(res.json)}`).toBe(200);
  };
  /** 초안 → (문항 저장) → 발송. items=null 이면 fromPrevious 로 직전 회차를 그대로 보낸다. */
  const sendRound = async (id: number, items: unknown[] | null): Promise<any> => {
    const base = `/api/admin/pcb-eq-reviews/${String(id)}`;
    const created = await api(A, 'POST', `${base}/drafts`, items === null ? { fromPrevious: true } : {});
    expect(created.status, `초안: ${JSON.stringify(created.json)}`).toBe(201);
    let review = created.json.data.review;
    if (items !== null) {
      const saved = await api(A, 'PUT', `${base}/${String(review.id)}/draft`, {
        expectedVersion: review.version,
        message: '',
        dueOn: null,
        items,
      });
      expect(saved.status, `문항 저장: ${JSON.stringify(saved.json)}`).toBe(200);
      review = saved.json.data.review;
    }
    const sent = await api(A, 'POST', `${base}/${String(review.id)}/send`, { expectedVersion: review.version });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    return sent.json.data.review;
  };
  const answerAs = async (review: any, picks: { key: string; comment?: string }[]): Promise<any> => {
    const res = await api(C, 'POST', `/api/pcb-eq-reviews/${String(review.id)}/answer`, {
      expectedVersion: review.version,
      answers: review.items.map((item: any, i: number) => ({ itemId: item.id, ...picks[i] })),
      agree: true,
    });
    expect(res.status, `고객 회신: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data.review;
  };
  const forward = async (id: number, review: any): Promise<void> => {
    const res = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(id)}/${String(review.id)}/forward`, {
      expectedVersion: review.version,
    });
    expect(res.status, `전달: ${JSON.stringify(res.json)}`).toBe(200);
  };
  const portalRounds = async (tok: string, id: number): Promise<any[]> => {
    const res = await api(tok, 'GET', `/api/partner/pcb-pos/${String(id)}`);
    expect(res.status, `포털 상세: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data.eqRounds;
  };

  // ── 화면 조각 ──────────────────────────────────────────────────────────────
  const openPo = async (mbId: string, id: number, title: string): Promise<Page> => {
    const s = await newSession({ mbId, ttlSec: 3600 });
    sessions.push(s);
    await gotoApp(s.page, `/partner/pcb/pos/${String(id)}`);
    await s.page.locator('h1', { hasText: title }).waitFor({ timeout: 30_000 });
    await s.page.waitForLoadState('networkidle');
    return s.page;
  };
  const shot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  const area = (page: Page) => page.getByTestId('partner-eq-answers');
  const todo = (page: Page) => page.getByTestId('partner-eq-now-todo');
  /** 문서 전체·영역·문항 카드 모두 가로로 넘치지 않는다. */
  const assertNoOverflow = async (page: Page, label: string): Promise<void> => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${label} 문서 가로 넘침`,
    ).toBe(true);
    if ((await area(page).count()) > 0) {
      const wide = await area(page).evaluate((root) =>
        [root, ...root.querySelectorAll('[data-testid="partner-eq-answer-item"]')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.getAttribute('data-testid') ?? 'root'),
      );
      expect(wide, `${label} 영역 넘침`).toEqual([]);
    }
  };
  /** 문항은 한 줄(번호·유형·질문·선택·의견)이다 — 전체 선택지는 [자세히]로 펼쳐야 보인다. */
  const expandItem = async (page: Page, itemIndex: number): Promise<void> => {
    const btn = page.getByTestId('partner-eq-answer-item').nth(itemIndex).getByTestId('partner-eq-answer-expand');
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  };
  const chosenOf = async (page: Page, itemIndex: number): Promise<string[]> => {
    await expandItem(page, itemIndex);
    return page
      .getByTestId('partner-eq-answer-item')
      .nth(itemIndex)
      .getByTestId('partner-eq-option')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-chosen') ?? ''));
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mkdirSync(SHOTS, { recursive: true });

    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    md = await ensureStagePartner(MD);
    sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'USD');
    if (md.mbId === null || sub.mbId === null) throw new Error('MD 무대 계정 연결 실패');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    customerId = requireCustomerCreds(1).id;
    C = signJwt({ mbId: customerId, ttlSec: 3600 });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    S = signJwt({ mbId: sub.mbId, ttlSec: 3600 });

    // 무대 1 — 협력2 직접 수주(주문+카트+스펙+발주, 전부 e2e 소유).
    const order = await createG5OrderFixture(customerId, 'e2e EQ 포털 회신');
    orders.push(order);
    projectName = `E2E-EQP-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specIds.push(spec.id as bigint);
    const po = await createPcbPo({ specId: spec.id, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);
  }, 120_000);

  afterAll(async () => {
    for (const s of sessions) await s.close().catch(() => undefined);
    await closeBrowser();
    const prisma = getPrisma();
    const poIds = [...seeded];
    // 그림·EQ 첨부는 refType/refId 규약(FK 없음) — 발주 cascade 로 안 지워진다.
    const reviews = await prisma.spPcbEqReview.findMany({ where: { poId: { in: poIds } }, select: { id: true } });
    if (reviews.length > 0) {
      await prisma.spFile.deleteMany({
        where: { refType: 'sp_pcb_eq_review', refId: { in: reviews.map((r: any) => r.id) } },
      });
    }
    await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: { in: poIds } } });
    if (specIds.length > 0) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: { in: specIds.map((id) => id.toString()) }, createdAt: { gte: startedAt } },
      });
    }
    await cleanupPcbPos(poIds); // 회차·문항·이벤트는 발주 cascade
    if (childRfqId !== null) await prisma.spPcbRfq.deleteMany({ where: { id: childRfqId } });
    if (specIds.length > 0) await prisma.spOrderSpec.deleteMany({ where: { id: { in: specIds } } });
    for (const o of orders) await deleteOrderHard(o.odId);
    const mailpitUp = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null))?.ok === true;
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }

    const residue = await countPcbResidue(poIds);
    expect(residue, '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    expect(await prisma.spPcbEqReview.count({ where: { poId: { in: poIds } } }), '회차 잔재').toBe(0);
    for (const o of orders) expect(await countCartRows(o.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 120_000);

  test('P1. 전달 전 — 고객이 답해도 포털엔 영역이 없고, 할 일은 승인 대기 그대로', async () => {
    expect(await uploadEq(P, poId, 'EQ-factory.xls'), 'EQ 업로드').toBe(200);
    await eqRequest(P, poId);
    const sent = await sendRound(poId, ITEMS);
    r1 = await answerAs(sent, [{ key: 'B', comment: COMMENT }, { key: 'A' }]);
    expect(r1.status).toBe('answered');

    expect(await portalRounds(P, poId), '전달 전 API').toEqual([]);
    const page = await openPo(owner.mbId ?? '', poId, projectName);
    expect(await area(page).count(), '전달 전 화면에 영역 없음').toBe(0);
    const text = await todo(page).innerText();
    expect(text).toContain(tr(TODO_WAITING, 'ko'));
    expect(text).not.toContain(tr(TODO_ARRIVED, 'ko'));
  });

  test('P2. 전달 — 원문 질문·원문 선택지·고른 기호 강조·고객 의견, 지금 할 일이 다음 수를 말한다', async () => {
    await forward(poId, r1);
    const page = await openPo(owner.mbId ?? '', poId, projectName);
    await area(page).waitFor();
    const box = area(page);
    const boxText = await box.innerText();
    expect(boxText).toContain(tr('고객 회신', 'ko'));
    expect(boxText).toContain(tr('{value1}차', 'ko', { value1: 1 }));
    expect(boxText, '전달 시각은 기준 시간대를 글자로').toContain('KST');
    expect(boxText).toContain('1: B');
    expect(boxText).toContain('2: A');

    const items = page.getByTestId('partner-eq-answer-item');
    expect(await items.count()).toBe(2);
    const first = items.nth(0);
    expect(await first.getByTestId('partner-eq-question').innerText(), '공장 원문 질문').toBe(ITEMS[0]?.questionOrig);
    expect(await first.innerText()).toContain(tr('마킹(UL·주기)', 'ko'));
    // 한 줄에 고른 것이 이미 보인다 — 펼치지 않아도 기호와 원문 선택지를 읽는다(기호는 크게).
    const chosenCell = first.getByTestId('partner-eq-chosen');
    expect(await chosenCell.innerText(), '줄에 고른 기호·원문').toContain('贵司指示位置');
    expect((await chosenCell.locator('span').first().boundingBox())?.height ?? 0, '줄의 선택 기호 크기').toBeGreaterThanOrEqual(28);
    expect(await first.getByTestId('partner-eq-option').count(), '펼치기 전엔 전체 선택지가 없다').toBe(0);
    await expandItem(page, 0);
    const optTexts = await first.getByTestId('partner-eq-option').allInnerTexts();
    expect(optTexts[0], '원문 선택지').toContain('按我司建议不加');
    expect(optTexts[1]).toContain('贵司指示位置');
    expect(await chosenOf(page, 0), '고른 기호 강조').toEqual(['false', 'true']);
    expect(optTexts[1]).toContain(tr('고객 선택', 'ko'));
    expect(optTexts[0]).not.toContain(tr('고객 선택', 'ko'));
    // 기호는 공장이 읽는 키 — 문장보다 크게(h-8 = 32px).
    const keyBox = await first.getByTestId('partner-eq-option').nth(1).locator('span').first().boundingBox();
    expect(keyBox?.height ?? 0, '선택 기호 크기').toBeGreaterThanOrEqual(28);

    const comment = await first.getByTestId('partner-eq-comment').innerText();
    expect(comment).toContain(COMMENT);
    expect(comment).toContain(tr('고객 원문(한국어)', 'ko'));
    expect(await items.nth(1).getByTestId('partner-eq-comment').count(), '의견 없는 문항엔 칸이 없다').toBe(0);
    expect(await chosenOf(page, 1)).toEqual(['true', 'false']);

    // 고객이 읽은 한국어 문장은 접어 둔다 — 펼치면 보인다.
    await first.locator('summary').click();
    expect(await first.locator('details').innerText()).toContain(ITEMS[0]?.question);

    const todoText = await todo(page).innerText();
    expect(todoText).toContain(tr(TODO_ARRIVED, 'ko'));
    expect(todoText, '되돌리기 버튼 이름으로 안내').toContain(`[${tr('EQ 요청 취소', 'ko')}]`);
    expect(await page.getByRole('button', { name: tr('EQ 요청 취소', 'ko') }).count(), '안내한 버튼이 실제로 있다').toBe(1);
    // 고객 회신은 EQ 카드 **아래의 별도 카드**다(2026-10-11) — 안내가 "아래 '고객 회신'"이라 말하고,
    // '지금 할 일'이 요약 한 줄과 [회신 보기]로 그 카드를 가리킨다.
    const [areaTop, todoTop] = [(await box.boundingBox())?.y ?? 0, (await todo(page).boundingBox())?.y ?? 0];
    expect(areaTop, '고객 회신은 할 일 칸 아래').toBeGreaterThan(todoTop);
    const pointer = page.getByTestId('partner-eq-answer-pointer');
    expect(await pointer.innerText(), '할 일 칸의 선택 요약').toContain('1: B');
    expect(await pointer.innerText()).toContain('2: A');
    await page.getByTestId('partner-eq-answers-toggle').click();
    await page.getByTestId('partner-eq-answers-collapsed').waitFor();
    await page.getByTestId('partner-eq-answer-jump').click();
    await page.getByTestId('partner-eq-answer-item').first().waitFor();
    expect(await page.getByTestId('partner-eq-answers-collapsed').count(), '[회신 보기]가 카드를 펼친다').toBe(0);

    await shot(page, 'ko-desktop');
    await box.screenshot({ path: join(SHOTS, 'ko-area.png') });
    await assertNoOverflow(page, 'ko 1440');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page, 'ko 390');
    await shot(page, 'ko-390');
  });

  test('P3. 언어 전환 — en/zh 에서 화면 문구는 번역되고 고객 의견만 원문, 390px 넘침 0', async () => {
    const page = await openPo(owner.mbId ?? '', poId, projectName);
    await area(page).waitFor();
    for (const locale of ['en', 'zh-CN'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId('partner-language').selectOption(locale);
      await area(page).getByRole('heading', { name: tr('고객 회신', locale), exact: true }).waitFor();

      const boxText = await area(page).innerText();
      expect(boxText.replace(COMMENT, ''), `${locale} 영역에 한국어 문구가 남지 않는다`).not.toMatch(HANGUL);
      expect(boxText, `${locale} 고객 의견은 원문 그대로`).toContain(COMMENT);
      expect(boxText).toContain(tr('고객 선택', locale));
      expect(boxText).toContain(tr('고객 원문(한국어)', locale));
      expect(boxText).toContain(tr('마킹(UL·주기)', locale));
      expect(boxText).toContain(tr('{value1}차', locale, { value1: 1 }));
      expect(await chosenOf(page, 0), `${locale} 강조 유지`).toEqual(['false', 'true']);

      const todoText = await todo(page).innerText();
      expect(todoText, `${locale} 지금 할 일 번역`).not.toMatch(HANGUL);
      expect(todoText).toContain(tr(TODO_ARRIVED, locale));
      expect(todoText).toContain(`[${tr('EQ 요청 취소', locale)}]`);

      await assertNoOverflow(page, `${locale} 1440`);
      await shot(page, `${locale}-desktop`);
      await page.setViewportSize({ width: 390, height: 844 });
      await assertNoOverflow(page, `${locale} 390`);
      await shot(page, `${locale}-390`);
    }
    await page.getByTestId('partner-language').selectOption('ko');
  });

  test('P4. 개정 회차 — 이전 요청의 답은 "도착"이라 하지 않고, 새 회차가 오면 회차를 고른다', async () => {
    const specId = specIds[0] ?? 0n;
    const reject = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: '공장 개정 EQ 대기',
    });
    expect(reject.status, JSON.stringify(reject.json)).toBe(200);
    await eqRequest(P, poId);

    // 다시 승인요청했지만 아직 이번 요청에 대한 회신은 없다 — 1차 답은 이력으로만 보인다.
    let page = await openPo(owner.mbId ?? '', poId, projectName);
    await area(page).waitFor();
    expect(await page.getByTestId('partner-eq-round-tab').count(), '회차 하나면 전환 없음').toBe(0);
    let todoText = await todo(page).innerText();
    expect(todoText).toContain(tr(TODO_WAITING, 'ko'));
    expect(todoText, '이전 요청의 답을 "도착"이라 하지 않는다').not.toContain(tr(TODO_ARRIVED, 'ko'));

    // 2차 — 직전 회차에서 가져와 보내고, 고객은 답을 바꾼다.
    const sent2 = await sendRound(poId, null);
    expect(sent2.roundNo).toBe(2);
    const r2 = await answerAs(sent2, [{ key: 'A' }, { key: 'B' }]);
    await forward(poId, r2);
    expect((await portalRounds(P, poId)).map((r) => r.roundNo), '최신 먼저').toEqual([2, 1]);

    page = await openPo(owner.mbId ?? '', poId, projectName);
    await area(page).waitFor();
    const tabs = page.getByTestId('partner-eq-round-tab');
    expect(await tabs.allInnerTexts()).toEqual([
      `${tr('{value1}차', 'ko', { value1: 2 })} · ${tr('최신', 'ko')}`,
      tr('{value1}차', 'ko', { value1: 1 }),
    ]);
    expect(await tabs.nth(0).getAttribute('aria-selected'), '기본은 최신').toBe('true');
    expect(await chosenOf(page, 0)).toEqual(['true', 'false']);
    expect(await chosenOf(page, 1)).toEqual(['false', 'true']);
    expect(await page.getByTestId('partner-eq-comment').count(), '2차엔 의견 없음').toBe(0);
    expect(await area(page).innerText()).toContain('1: A');
    todoText = await todo(page).innerText();
    expect(todoText, '이번 요청의 답은 도착이라 말한다').toContain(tr(TODO_ARRIVED, 'ko'));
    await shot(page, 'ko-rounds-latest');

    await tabs.nth(1).click();
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true');
    expect(await chosenOf(page, 0), '1차의 답').toEqual(['false', 'true']);
    expect(await page.getByTestId('partner-eq-comment').innerText()).toContain(COMMENT);
    await shot(page, 'ko-rounds-first');
  });

  test('P5. MD 관전 — 위임 상위는 하위의 회차를, 하위 발주 관전은 MD 문구로 말한다', async () => {
    const prisma = getPrisma();
    const order = await createG5OrderFixture(customerId, 'e2e EQ 포털 회신 MD');
    orders.push(order);
    mdProjectName = `E2E-EQP-MD-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: mdProjectName, category: 'standard' });
    specIds.push(spec.id as bigint);
    const top = await createPcbPo({
      specId: spec.id,
      partnerId: md.id,
      status: 'issued',
      currency: 'KRW',
      priceOriginal: 700000,
      fulfillmentMode: 'delegated',
    });
    seeded.push(top.id);
    mdTopPoId = Number(top.id);
    // 하위 회신(selected) 직삽입 — round 0 하위 발주는 childRfqId 필수(md-eq-observe 관례).
    const rfq = await prisma.spPcbRfq.create({
      data: {
        specId: spec.id,
        partnerId: sub.id,
        parentPartnerId: md.id,
        reorderRound: 0,
        status: 'selected',
        currency: 'USD',
        priceOriginal: 400,
        quotedDeliveryDate: new Date('2099-12-31T00:00:00+09:00'),
        requestedAt: new Date(),
        respondedAt: new Date(),
      },
    });
    childRfqId = rfq.id;
    const created = await api(M, 'POST', `/api/partner/pcb-pos/${String(mdTopPoId)}/children`, { childRfqId: Number(rfq.id) });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    mdChildPoId = Number(created.json.data.children[0].poId);
    seeded.push(BigInt(mdChildPoId));

    expect(await uploadEq(S, mdChildPoId, 'EQ-sub.xls'), '하위 EQ 업로드').toBe(200);
    await eqRequest(S, mdChildPoId);
    const sent = await sendRound(mdChildPoId, ITEMS);
    const answered = await answerAs(sent, [{ key: 'B', comment: COMMENT }, { key: 'A' }]);
    await forward(mdChildPoId, answered);

    // 위임 상위 — EQ 는 하위에서 돈다. 상위 응답은 하위의 회차를 싣는다.
    expect((await portalRounds(M, mdTopPoId)).map((r) => r.reviewId), '상위는 하위의 회차').toEqual([answered.id]);
    let page = await openPo(md.mbId ?? '', mdTopPoId, mdProjectName);
    await area(page).waitFor();
    expect(await chosenOf(page, 0)).toEqual(['false', 'true']);
    expect(await todo(page).count(), '위임 상위엔 할 일 칸이 없다(하위에서 진행)').toBe(0);
    expect(await page.locator('main').innerText()).toContain(tr('하위 발주서', 'ko'));
    await assertNoOverflow(page, 'MD 상위 1440');
    await shot(page, 'md-top');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page, 'MD 상위 390');
    await shot(page, 'md-top-390');

    // 하위 발주 관전(MD) — 주어가 하위 협력사다.
    page = await openPo(md.mbId ?? '', mdChildPoId, mdProjectName);
    await area(page).waitFor();
    const mdTodo = await todo(page).innerText();
    expect(mdTodo).toContain(tr(TODO_ARRIVED, 'ko'));
    expect(mdTodo, '주어 = 하위 협력사').toContain(sub.name);
    expect(mdTodo, 'MD 대행 안내').toContain('MD 대행');
    await assertNoOverflow(page, 'MD 하위 1440');
    await shot(page, 'md-child');

    // 하위 수주자 본인 — 협력사 문구.
    page = await openPo(sub.mbId ?? '', mdChildPoId, mdProjectName);
    await area(page).waitFor();
    const subTodo = await todo(page).innerText();
    expect(subTodo).toContain(tr(TODO_ARRIVED, 'ko'));
    expect(subTodo).not.toContain('MD 대행');

    for (const s of sessions) expect(s.pageErrors, '화면 예외').toEqual([]);
  });
});
