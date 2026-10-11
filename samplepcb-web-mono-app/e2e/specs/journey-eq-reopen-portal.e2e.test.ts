// 추가 EQ 요청 — 협력사 포털 화면(D20 후속 R-1·R-2·R-4).
//
// 승인 뒤 협력사가 할 수 있는 건 [생산 시작]뿐이었다 — 고객 회신을 읽고 더 물을 것이 생기면 관리자가
// 승인 취소 → 반려를 대신 눌러 줘야 했다. 이제 승인이 회신을 자동 전달하고(R-1), 협력사는 생산 시작 전까지
// 사유와 함께 EQ 를 다시 연다(R-2, eq_done → issued). 이 주행은 그 갈림길이 **화면에서** 읽히는지를 본다.
//
// 표적:
//   ① 승인 뒤 포털에 '고객 회신'이 뜨고(자동 전달) [생산 시작] 옆에 [추가 EQ 요청]이 선다.
//   ② 사유 없이는 못 보낸다 — 빈 칸은 버튼이 잠기고, 한 글자는 대화상자 안에서 막는다(요청 0건).
//   ③ 보내면 발주접수로 돌아간다 — "추가 EQ를 준비 중"·내가 쓴 사유·업로드 버튼, **반려 문구는 없다**.
//   ④ 타임라인 — 추가 EQ 요청 말풍선(사유, 붉지 않다) 뒤에 새 회차 머리.
//   ⑤ 새 파일을 올리면 안내가 바뀌고, 다시 승인되면 이전 회차의 답을 "확인하라"고 하지 않는다.
//   ⑥ 생산 시작 뒤·스텐실·위임 상위에는 버튼이 없다(서버도 409). MD 는 하위 발주서에서 대행한다.
//   ⑦ en/zh-CN 한글 잔류 없음(고객 의견 원문 제외) · 390px 가로 넘침 0.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-reopen-portal
// 사전: API(3333)·웹(5173, nginx 경유)·e2e/.env.e2e 고객 아이디. 스크린샷은 리포 루트 .tmp/eq-portal-shots/reopen-*.png.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 세우고 지운다. MD 무대 계정·조직·관계는 상설(md-eq-observe 와 공유).
// ⚠ AI 분석 설정(pcbEqParse)은 건드리지 않는다 — EQ 질의서를 .pdf 로 올려, 켜져 있어도 분석이 모델을 부르지 않게 한다.
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

const OWNER = '협력2';
const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };
const SHOTS = join(monoRoot, '..', '.tmp', 'eq-portal-shots');
const HANGUL = /[가-힣]/;

/** 포털이 실제로 쓰는 사전으로 기대 문구를 만든다(병합 순서는 apps/web/src/partner/i18n.ts 와 같다). */
const partnerMessages: PartnerMessages = {
  ...childrenMessages, ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages,
};
const tr = (source: string, locale: PartnerLocale, params?: Record<string, string | number>): string =>
  translatePartnerMessage(partnerMessages, source, locale, true, params);

const START = '생산 시작';
const REOPEN = '추가 EQ 요청';
const TODO_REVIEW = '고객 회신을 확인해 주세요 — 회신대로 생산할 수 있으면 [{value1}], 더 확인할 것이 있으면 [{value2}]을 눌러 주세요.';
const TODO_APPROVED = 'EQ가 승인됐습니다 — 생산을 시작해 주세요.';
const HINT_REOPEN_OPEN = '더 확인할 것이 있으면 생산을 시작하기 전에 [{value1}]으로 EQ를 다시 열 수 있습니다.';
const TODO_PREPARING = '추가 EQ를 준비 중입니다 — 수정한 EQ를 올리고 다시 승인요청해 주세요.';
const HINT_NO_NEW_FILE = '아직 추가 EQ 요청 후 새로 올린 파일이 없습니다 — 지금 올라 있는 EQ는 이미 승인된 것입니다.';
const HINT_NEW_FILE = '추가 EQ 요청 후 새 파일을 올렸습니다 — 승인요청을 진행해 주세요.';
const TODO_REJECTED = '반려된 건입니다 — 보완 파일을 올리고 다시 승인요청해 주세요.';
const DIALOG_DESC =
  '고객 회신을 보고 더 확인할 것이 있을 때 씁니다. 발주가 발주접수로 돌아가 EQ 파일을 다시 올릴 수 있고, 샘플피씨비 담당자에게 사유가 전달됩니다.';
const todoReview = (locale: PartnerLocale): string =>
  tr(TODO_REVIEW, locale, { value1: tr(START, locale), value2: tr(REOPEN, locale) });

describe.skipIf(!RUN)('추가 EQ 요청 — 협력사 포털 화면(D20 후속)', () => {
  let owner: PartnerFixture;
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 협력사(협력2)
  let C = ''; // 고객(주문자)
  let M = ''; // MD
  let S = ''; // MD 하위
  let customerId = '';
  const token = `e2eeqr${String(Date.now())}`;
  const startedAt = new Date();
  const orders: G5OrderFixture[] = [];
  const specIds: bigint[] = [];
  const seeded: bigint[] = [];
  const sessions: E2eSession[] = [];
  let childRfqId: bigint | null = null;

  let specId = 0n;
  let poId = 0;
  let projectName = '';

  const COMMENT = `좌측 하단에 넣어 주세요 ${token}`;
  // 사유는 쓴 그대로 화면에 나온다(번역하지 않는다) — 한글을 넣지 않아 en/zh 화면의 한글 잔류 검사가
  // 화면 문구만 겨누게 한다. 공장이 실제로 쓰는 모양(중문 + 영문)이기도 하다.
  const REASON = `阻抗条位置需再确认 — please confirm the impedance coupon position (${token})`;
  const ITEMS = [
    {
      factoryNo: '1',
      category: 'marking',
      question: 'UL 마킹을 보드에 넣을까요?',
      questionOrig: '是否需要在板上加UL标记？',
      options: [
        { key: 'A', label: '공장 제안대로 넣지 않음', labelOrig: '按我司建议不加', recommended: true, requiresComment: false },
        { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置', recommended: false, requiresComment: true },
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
    form.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' }));
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
  const eqApprove = async (spec: bigint, id: number): Promise<void> => {
    const res = await api(A, 'POST', `/api/admin/pcb-projects/${spec.toString()}/pos/${String(id)}/eq-approve`, {});
    expect(res.status, `EQ 승인: ${JSON.stringify(res.json)}`).toBe(200);
  };
  const eqReopen = (tok: string, id: number, reason: string) =>
    api(tok, 'POST', `/api/partner/pcb-pos/${String(id)}/eq-reopen`, { reason });
  /** 초안 → 문항 저장 → 발송 → 고객 회신(전달은 하지 않는다 — 승인이 한다). */
  const sendAndAnswer = async (id: number): Promise<any> => {
    const base = `/api/admin/pcb-eq-reviews/${String(id)}`;
    const created = await api(A, 'POST', `${base}/drafts`, {});
    expect(created.status, `초안: ${JSON.stringify(created.json)}`).toBe(201);
    const draft = created.json.data.review;
    const saved = await api(A, 'PUT', `${base}/${String(draft.id)}/draft`, {
      expectedVersion: draft.version,
      message: '',
      dueOn: null,
      items: ITEMS,
    });
    expect(saved.status, `문항 저장: ${JSON.stringify(saved.json)}`).toBe(200);
    const sent = await api(A, 'POST', `${base}/${String(draft.id)}/send`, {
      expectedVersion: saved.json.data.review.version,
    });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    const review = sent.json.data.review;
    const answered = await api(C, 'POST', `/api/pcb-eq-reviews/${String(review.id)}/answer`, {
      expectedVersion: review.version,
      answers: [{ itemId: review.items[0].id, key: 'B', comment: COMMENT }],
      agree: true,
    });
    expect(answered.status, `고객 회신: ${JSON.stringify(answered.json)}`).toBe(200);
    return answered.json.data.review;
  };
  const portalDetail = async (tok: string, id: number): Promise<any> => {
    const res = await api(tok, 'GET', `/api/partner/pcb-pos/${String(id)}`);
    expect(res.status, `포털 상세: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data;
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
    await page.screenshot({ path: join(SHOTS, `reopen-${name}.png`), fullPage: true });
  };
  const area = (page: Page) => page.getByTestId('partner-eq-answers');
  const todo = (page: Page) => page.getByTestId('partner-eq-now-todo');
  const reopenBtn = (page: Page) => page.getByTestId('partner-eq-reopen');
  const dialog = (page: Page) => page.getByRole('dialog');
  /** 'EQ · 생산 진행' 카드 — 스텝퍼·타임라인·고객 회신·지금 할 일·액션 줄이 다 여기 있다. */
  const eqSection = (page: Page) => page.locator('section', { has: page.getByTestId('partner-eq-now-todo') });
  const setLocale = async (page: Page, locale: PartnerLocale): Promise<void> => {
    await page.getByTestId('partner-language').selectOption(locale);
    await page.waitForFunction((lang) => document.documentElement.lang === lang, locale);
  };
  const assertNoOverflow = async (page: Page, label: string): Promise<void> => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${label} 문서 가로 넘침`,
    ).toBe(true);
  };
  const listRow = async (tok: string, id: number): Promise<any> => {
    const res = await api(tok, 'GET', '/api/partner/pcb-pos');
    expect(res.status, `포털 목록: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.items ?? []).find((r: any) => Number(r.poId) === id) ?? null;
  };
  /** 발주 관리 목록에서 프로젝트명으로 좁힌 그 한 줄의 글자(탭 '전체' — 기본 탭은 내 차례뿐이다). */
  const openListRow = async (page: Page, title: string): Promise<string> => {
    await gotoApp(page, '/partner/pcb/pos?tab=all');
    await page.locator('input[type="search"]').fill(title);
    const row = page.locator('a', { hasText: title });
    await row.waitFor({ timeout: 30_000 });
    expect(await row.count(), '검색으로 좁힌 한 줄').toBe(1);
    return row.innerText();
  };
  const narrow = async (page: Page, label: string, name: string): Promise<void> => {
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page, `${label} 390`);
    await shot(page, name);
    await page.setViewportSize({ width: 1440, height: 900 });
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
    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청');
    orders.push(order);
    projectName = `E2E-EQR-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    specIds.push(specId);
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
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

  test('R1. 승인 — 회신이 자동 전달되고, 포털은 [생산 시작]·[추가 EQ 요청] 갈림길을 보인다', async () => {
    expect(await uploadEq(P, poId, 'EQ-factory.pdf'), 'EQ 업로드').toBe(200);
    await eqRequest(P, poId);
    const answered = await sendAndAnswer(poId);
    expect((await portalDetail(P, poId)).eqRounds, '승인 전·전달 전 포털').toEqual([]);

    await eqApprove(specId, poId);
    const detail = await portalDetail(P, poId);
    expect(detail.status).toBe('eq_done');
    expect(detail.eqRounds.map((r: any) => r.reviewId), '승인이 회신을 전달한다(R-1)').toEqual([answered.id]);

    const page = await openPo(owner.mbId ?? '', poId, projectName);
    await area(page).waitFor();
    expect(await area(page).innerText(), '승인 뒤 고객 회신 영역').toContain(COMMENT);

    const start = page.getByRole('button', { name: tr(START, 'ko'), exact: true });
    expect(await start.count(), '[생산 시작]').toBe(1);
    expect((await reopenBtn(page).innerText()).trim(), '[추가 EQ 요청]').toBe(tr(REOPEN, 'ko'));
    // 주 동작은 생산 시작 — 추가 EQ 요청은 그 옆(뒤)에 보조 모양으로 선다.
    const [startBox, reopenBox] = [await start.boundingBox(), await reopenBtn(page).boundingBox()];
    expect(Math.abs((startBox?.y ?? 0) - (reopenBox?.y ?? 99)), '같은 줄').toBeLessThan(8);
    expect(reopenBox?.x ?? 0, '생산 시작 오른쪽').toBeGreaterThan(startBox?.x ?? 0);

    const todoText = await todo(page).innerText();
    expect(todoText, '갈림길 안내').toContain(todoReview('ko'));
    expect(await page.getByTestId('partner-eq-reopen-reason').count(), '아직 요청 전').toBe(0);
    await shot(page, 'ko-eq-done');
    await assertNoOverflow(page, 'ko eq_done 1440');
    await narrow(page, 'ko eq_done', 'ko-eq-done-390');
  });

  test('R2. 대화상자 — 사유 없이는 못 보내고, 보내면 발주접수로 돌아가 "추가 EQ를 준비 중"(반려 문구 없음)', async () => {
    const page = await openPo(owner.mbId ?? '', poId, projectName);
    await reopenBtn(page).waitFor();
    let reopenCalls = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/eq-reopen')) reopenCalls += 1;
    });

    // en/zh-CN — 승인 뒤 화면과 대화상자 문구가 번역된다.
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(page, locale);
      expect((await reopenBtn(page).innerText()).trim()).toBe(tr(REOPEN, locale));
      const todoText = await todo(page).innerText();
      expect(todoText, `${locale} 지금 할 일`).toContain(todoReview(locale));
      expect(todoText, `${locale} 지금 할 일 한글 잔류`).not.toMatch(HANGUL);
      expect((await eqSection(page).innerText()).replace(COMMENT, ''), `${locale} EQ 카드 한글 잔류`).not.toMatch(HANGUL);

      await reopenBtn(page).click();
      await dialog(page).waitFor();
      const text = await dialog(page).innerText();
      expect(text, `${locale} 대화상자 한글 잔류`).not.toMatch(HANGUL);
      expect(text).toContain(tr(DIALOG_DESC, locale));
      expect(text).toContain(tr('요청 사유', locale));
      expect(await dialog(page).locator('textarea').getAttribute('placeholder')).toBe(
        tr('무엇을 더 확인해야 하는지 적어 주세요.', locale),
      );
      await shot(page, `${locale}-dialog`);
      await page.keyboard.press('Escape');
      await dialog(page).waitFor({ state: 'hidden' });
      await narrow(page, `${locale} eq_done`, `${locale}-eq-done-390`);
    }
    await setLocale(page, 'ko');

    // 사유 없이 — 확인 버튼이 잠겨 있다.
    await reopenBtn(page).click();
    await dialog(page).waitFor();
    expect(await dialog(page).getByRole('heading').innerText()).toBe(tr(REOPEN, 'ko'));
    expect(await dialog(page).innerText()).toContain(tr(DIALOG_DESC, 'ko'));
    const confirm = dialog(page).getByRole('button', { name: tr(REOPEN, 'ko'), exact: true });
    expect(await confirm.isDisabled(), '빈 사유는 제출 불가').toBe(true);
    await dialog(page).locator('textarea').fill('   ');
    expect(await confirm.isDisabled(), '공백만으로도 불가').toBe(true);
    // 한 글자 — 눌리지만 대화상자 안에서 막고 서버에 가지 않는다.
    await dialog(page).locator('textarea').fill('x');
    await confirm.click();
    await dialog(page).getByText(tr('사유를 2자 이상 적어 주세요.', 'ko')).waitFor();
    expect(reopenCalls, '검증에 걸린 제출은 요청을 보내지 않는다').toBe(0);
    expect((await portalDetail(P, poId)).status, '아직 그대로').toBe('eq_done');
    await shot(page, 'ko-dialog-invalid');

    // 사유를 적어 보낸다.
    await dialog(page).locator('textarea').fill(REASON);
    await confirm.click();
    await dialog(page).waitFor({ state: 'hidden' });
    await page.getByTestId('partner-eq-reopen-reason').waitFor();
    expect(reopenCalls).toBe(1);

    const detail = await portalDetail(P, poId);
    expect(detail.status, '발주접수로 돌아간다').toBe('issued');
    expect(detail.eq.history.at(-1), '이력에 사유가 남는다').toMatchObject({
      fromStatus: 'eq_done',
      toStatus: 'issued',
      byRole: 'PARTNER',
      note: REASON,
    });

    const todoText = await todo(page).innerText();
    expect(todoText).toContain(tr(TODO_PREPARING, 'ko'));
    expect(todoText, '아직 새 파일 없음').toContain(tr(HINT_NO_NEW_FILE, 'ko'));
    expect(todoText, '반려 문구가 뜨면 안 된다').not.toContain(tr(TODO_REJECTED, 'ko'));
    expect(await page.getByTestId('partner-eq-reopen-reason').innerText(), '내가 쓴 사유').toContain(REASON);
    const card = await eqSection(page).innerText();
    expect(card, '아무도 반려하지 않았다').not.toContain(tr('EQ 반려', 'ko'));
    expect(card, '새 회차 머리').toContain(tr('{value1}차 요청', 'ko', { value1: 2 }));
    // 타임라인 말풍선 — 라벨·사유, 붉은 반려 모양이 아니다.
    const bubble = page.locator('[data-eq-event="reopen"]');
    expect(await bubble.count()).toBe(1);
    const bubbleText = await bubble.innerText();
    expect(bubbleText).toContain(tr(REOPEN, 'ko'));
    expect(bubbleText).toContain(REASON);
    const bubbleCls = (await bubble.getAttribute('class')) ?? '';
    expect(bubbleCls).toContain('amber');
    expect(bubbleCls).not.toContain('red');
    expect(await page.locator('[data-eq-event="reject"]').count(), '반려 말풍선 없음').toBe(0);
    // 첨부가 다시 열리고, 갈림길 버튼은 사라진다(다음 수는 승인요청).
    expect(await page.getByRole('button', { name: tr('＋ EQ 질의서', 'ko'), exact: true }).isEnabled(), '업로드 버튼').toBe(true);
    expect(await reopenBtn(page).count(), '돌아온 뒤엔 버튼 없음').toBe(0);
    expect(await page.getByRole('button', { name: tr('EQ 승인요청', 'ko'), exact: true }).count(), '다음 수 = 승인요청').toBe(1);
    expect(await area(page).count(), '고객 회신은 계속 보인다').toBe(1);

    await shot(page, 'ko-issued');
    await assertNoOverflow(page, 'ko issued 1440');
    await narrow(page, 'ko issued', 'ko-issued-390');

    // 목록 — 발주 직후의 '발주접수'와 같은 얼굴이 아니다(추가 EQ 준비 중 배지, 반려 배지는 아니다).
    const row = await listRow(P, poId);
    expect(row, '목록 행').toMatchObject({ status: 'issued', myTurn: true, rejectedAt: null });
    expect(row.reopenedAt, '추가 EQ 요청 시각').not.toBeNull();
    const rowText = await openListRow(page, projectName);
    expect(rowText).toContain(tr('추가 EQ 준비 중', 'ko'));
    expect(rowText, '반려 배지가 아니다').not.toContain(tr('반려됨 — 보완 필요', 'ko'));
    await shot(page, 'ko-list');
  });

  test('R3. 돌아온 뒤 — en/zh-CN 에 한글이 남지 않고 390px 넘침 0', async () => {
    const page = await openPo(owner.mbId ?? '', poId, projectName);
    await page.getByTestId('partner-eq-reopen-reason').waitFor();
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(page, locale);
      const todoText = await todo(page).innerText();
      expect(todoText).toContain(tr(TODO_PREPARING, locale));
      expect(todoText).toContain(tr('추가 EQ 요청 사유', locale));
      expect(todoText, `${locale} 사유는 쓴 그대로`).toContain(REASON);
      expect(todoText, `${locale} 지금 할 일 한글 잔류`).not.toMatch(HANGUL);
      expect(await page.locator('[data-eq-event="reopen"]').innerText()).toContain(tr(REOPEN, locale));
      expect((await eqSection(page).innerText()).replace(COMMENT, ''), `${locale} EQ 카드 한글 잔류`).not.toMatch(HANGUL);
      await assertNoOverflow(page, `${locale} issued 1440`);
      await shot(page, `${locale}-issued`);
      await narrow(page, `${locale} issued`, `${locale}-issued-390`);
    }
    await setLocale(page, 'ko');
  });

  test('R4. 새 파일 → 재승인 → 생산 시작 — 이전 회차의 답을 다시 확인하라 하지 않고, 시작 뒤엔 버튼이 없다', async () => {
    // 수정한 EQ 를 올리면 안내가 "승인요청을 진행"으로 바뀐다.
    expect(await uploadEq(P, poId, 'EQ-factory-rev2.pdf'), '수정 EQ 업로드').toBe(200);
    let page = await openPo(owner.mbId ?? '', poId, projectName);
    expect(await todo(page).innerText()).toContain(tr(HINT_NEW_FILE, 'ko'));

    // 다시 승인요청 → 승인. 이번 요청에는 고객 확인 회차가 없었다 — 1차의 답은 이미 읽은 것이다.
    await eqRequest(P, poId);
    await eqApprove(specId, poId);
    page = await openPo(owner.mbId ?? '', poId, projectName);
    await reopenBtn(page).waitFor();
    let todoText = await todo(page).innerText();
    expect(todoText, '이전 요청의 답을 다시 확인하라 하지 않는다').not.toContain(todoReview('ko'));
    expect(todoText).toContain(tr(TODO_APPROVED, 'ko'));
    expect(todoText, '그래도 다시 열 수 있음은 알린다').toContain(tr(HINT_REOPEN_OPEN, 'ko', { value1: tr(REOPEN, 'ko') }));
    expect(await area(page).count(), '고객 회신은 이력으로 남는다').toBe(1);
    await shot(page, 'ko-eq-done-again');

    // 생산을 시작하면 문이 닫힌다 — 화면에도 서버에도.
    const started = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`);
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    page = await openPo(owner.mbId ?? '', poId, projectName);
    await todo(page).waitFor();
    expect(await reopenBtn(page).count(), '생산 시작 뒤엔 버튼 없음').toBe(0);
    todoText = await todo(page).innerText();
    expect(todoText).not.toContain(tr(REOPEN, 'ko'));
    const late = await eqReopen(P, poId, '늦은 요청');
    expect(late.status, `생산 중 추가 EQ: ${JSON.stringify(late.json)}`).toBe(409);
    expect(late.json?.error).toBe('INVALID_STATUS');
    await shot(page, 'ko-producing');
  });

  test('R5. 스텐실에는 버튼이 없다 — 확인 완료 뒤 좌표파일은 바뀌지 않는다(R-4)', async () => {
    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청 스텐실');
    orders.push(order);
    const name = `E2E-EQR-MM-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: name, category: 'metalMask' });
    specIds.push(spec.id as bigint);
    const po = await createPcbPo({ specId: spec.id, partnerId: owner.id, status: 'eq_done' });
    seeded.push(po.id);
    const id = Number(po.id);
    expect((await portalDetail(P, id)).track).toBe('stencil');

    const page = await openPo(owner.mbId ?? '', id, name);
    await todo(page).waitFor();
    expect(await page.getByRole('button', { name: tr(START, 'ko'), exact: true }).count(), '[생산 시작]은 있다').toBe(1);
    expect(await reopenBtn(page).count(), '스텐실엔 [추가 EQ 요청] 없음').toBe(0);
    expect(await todo(page).innerText()).not.toContain(tr(REOPEN, 'ko'));
    const res = await eqReopen(P, id, '좌표를 고치고 싶습니다');
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json?.error).toBe('NOT_EQ_TRACK');
    await shot(page, 'ko-stencil');
  });

  test('R6. MD — 위임 상위엔 버튼이 없고, 하위 발주서에서 대행으로 다시 연다', async () => {
    const prisma = getPrisma();
    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청 MD');
    orders.push(order);
    const name = `E2E-EQR-MD-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: name, category: 'standard' });
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
    const topId = Number(top.id);
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
    const created = await api(M, 'POST', `/api/partner/pcb-pos/${String(topId)}/children`, { childRfqId: Number(rfq.id) });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const childId = Number(created.json.data.children[0].poId);
    seeded.push(BigInt(childId));

    expect(await uploadEq(S, childId, 'EQ-sub.pdf'), '하위 EQ 업로드').toBe(200);
    await eqRequest(S, childId);
    await eqApprove(spec.id as bigint, childId);

    // 위임 상위 — EQ 는 하위에서 돈다. 버튼도 할 일 칸도 없고 서버도 거절한다.
    let page = await openPo(md.mbId ?? '', topId, name);
    await page.getByText(tr('하위 발주서', 'ko')).first().waitFor();
    expect(await reopenBtn(page).count(), '위임 상위엔 버튼 없음').toBe(0);
    const onTop = await eqReopen(M, topId, '상위에서 요청');
    expect(onTop.status, JSON.stringify(onTop.json)).toBe(409);
    expect(onTop.json?.error).toBe('DELEGATED');

    // 하위 수주자 본인 — 협력사 문구 그대로.
    page = await openPo(sub.mbId ?? '', childId, name);
    await reopenBtn(page).waitFor();
    expect((await reopenBtn(page).innerText()).trim()).toBe(tr(REOPEN, 'ko'));

    // 하위 발주 관전(MD) — 주어는 하위 협력사, 버튼은 대행 표기.
    page = await openPo(md.mbId ?? '', childId, name);
    await reopenBtn(page).waitFor();
    expect((await reopenBtn(page).innerText()).trim()).toBe(
      tr('(MD 대행) {value1}', 'ko', { value1: tr(REOPEN, 'ko') }),
    );
    const mdTodo = await todo(page).innerText();
    expect(mdTodo, '주어 = 하위 협력사').toContain(sub.name);
    expect(mdTodo).toContain(
      tr('필요하면 MD 대행으로 [{value1}] 또는 [{value2}]을 진행할 수 있습니다.', 'ko', {
        value1: tr(START, 'ko'),
        value2: tr(REOPEN, 'ko'),
      }),
    );
    await shot(page, 'md-child-eq-done');

    // MD 가 대행으로 다시 연다 — 화면에서.
    await reopenBtn(page).click();
    await dialog(page).waitFor();
    await dialog(page).locator('textarea').fill(REASON);
    await dialog(page).getByRole('button', { name: tr(REOPEN, 'ko'), exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await page.getByTestId('partner-eq-reopen-reason').waitFor();
    const child = await portalDetail(M, childId);
    expect(child.status).toBe('issued');
    expect(child.eq.history.at(-1), '대행 주체가 이력에 남는다').toMatchObject({
      fromStatus: 'eq_done',
      toStatus: 'issued',
      byRole: 'MASTER_DEALER',
      note: REASON,
    });
    const reopened = await todo(page).innerText();
    expect(reopened, 'MD 관전 문구').toContain(
      tr('추가 EQ 요청 건입니다 — {value1}가 수정한 EQ를 올리고 다시 승인요청해야 합니다.', 'ko', {
        value1: tr('하위 협력사({value1})', 'ko', { value1: sub.name }),
      }),
    );
    expect(reopened, '반려 문구가 아니다').not.toContain(tr('반려된', 'ko'));
    expect(reopened).toContain(REASON);
    expect((await portalDetail(M, topId)).status, '위임 상위는 상태가 미러된다').toBe('issued');
    await shot(page, 'md-child-issued');
    await narrow(page, 'MD 하위 issued', 'md-child-issued-390');

    // MD 목록 — 하위 발주 줄에 관전 배지(하위가 수정 EQ 를 올릴 차례). 상위·하위가 같은 프로젝트명이라 배지로 찾는다.
    const childRow = await listRow(M, childId);
    expect(childRow, 'MD 목록의 하위 발주 행').toMatchObject({ direction: 'issued', status: 'issued', rejectedAt: null });
    expect(childRow.reopenedAt).not.toBeNull();
    await gotoApp(page, '/partner/pcb/pos?tab=all');
    await page.locator('input[type="search"]').fill(name);
    await page.getByTestId('partner-pcb-po-reopened').first().waitFor({ timeout: 30_000 });
    expect(
      (await page.getByTestId('partner-pcb-po-reopened').allInnerTexts()).map((t) => t.trim()),
      'MD 관전 배지',
    ).toContain(tr('추가 EQ 요청 — 수정 대기', 'ko'));
    await shot(page, 'md-list');

    for (const s of sessions) expect(s.pageErrors, '화면 예외').toEqual([]);
  });
});
