// 마스터딜러 견적 화면(포털) — 2026-10-11 재편을 화면으로 따라간다.
//
// 재편 전 화면의 문제 넷이 이 주행의 명세다:
//   ① 일이 일어나는 곳(하위 견적)이 사양·회신 폼 아래 맨 끝에 있었다           → 회신 만들기가 사양보다 위
//   ② 결과 메시지가 페이지 맨 위 한 곳이라, 맨 아래에서 누르고 맨 위를 봐야 했다 → 누른 버튼 바로 아래
//   ③ 하위를 선정해도 회신 입력칸은 빈 채였다(새로고침해야 보였다)               → 선정 즉시 입력칸·내 회신 띠에 반영
//   ④ 저장 버튼이 둘이고 하나를 누르면 다른 쪽이 말없이 지워졌다                 → 한 카드 안에서 고르고, 바뀔 때 묻는다
// 같이 고친 것: 마진 복원·계산 근거, 저장 전 미리보기(서버와 같은 계약 함수), 통화 환산 비교·최저가,
// 납기 조정(하위 납기 그대로가 아니라 여유를 둘 수 있다), 제시 납기, 재조회가 고르던 선택을 지우지 않기,
// 하위 선정 회신의 관리자 통지, 목록의 하위 진행 표시, 하위 회신 메일의 딥링크.
//
// 실행: pnpm -F e2e e2e journey-md-rfq-portal   (RUN 게이트만 — 거버·고객 자격 불필요)
// 정리: 이 주행이 만든 RFQ 행·메일만 지운다(스펙은 빌려 쓴 것, 조직·관계는 상설 무대).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { pcbMdQuoteAmount, roundPcbAmount } from '@sp/api-contract';
import { translatePartnerMessage, type PartnerLocale, type PartnerMessages } from '../../apps/web/src/partner/i18n-core';
import { bomMessages } from '../../apps/web/src/partner/locales/bom';
import { childrenMessages } from '../../apps/web/src/partner/locales/children';
import { commonMessages } from '../../apps/web/src/partner/locales/common';
import { partsMessages } from '../../apps/web/src/partner/locales/parts';
import { pcbMessages } from '../../apps/web/src/partner/locales/pcb';
import { shipmentMessages } from '../../apps/web/src/partner/locales/shipment';
import {
  MAILPIT_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  ensureMdRelation,
  ensureStagePartner,
  getPrisma,
  gotoApp,
  mailpitDelete,
  mailpitList,
  mailpitMessage,
  monoRoot,
  newSession,
  num,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const CHILD_A = { mbId: 'e2e-mdsub2', orgName: '협력2', country: 'CN', currency: 'USD' };
const CHILD_B = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };
const SHOTS = join(monoRoot, '..', '.tmp', 'md-rfq-shots');
const HANGUL = /[가-힣]/;

const partnerMessages: PartnerMessages = {
  ...childrenMessages, ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages,
};
const tr = (source: string, locale: PartnerLocale = 'ko', params?: Record<string, string | number>): string =>
  translatePartnerMessage(partnerMessages, source, locale, true, params);

const PRICE_A = 200;
const PRICE_B = 180;
const DATE_A = '2026-11-20';
const DATE_B = '2026-11-25';
const SUGGESTED = '2026-11-15'; // 관리자 제시보다 이르게 — 마스터딜러의 여유
const MY_DATE = '2026-11-24'; // 하위 A 납기 + 4일
const MARGIN = 15;

describe.skipIf(!RUN)('마스터딜러 견적 화면(포털) — 하위 견적으로 회신 만들기', () => {
  let md: PartnerFixture;
  let childA: PartnerFixture;
  let childB: PartnerFixture;
  let A = '';
  let M = '';
  let CA = '';
  let CB = '';
  let mailpitUp = false;
  const startedAt = new Date();

  let specId = 0;
  let projectName = '';
  let topRfqId = 0;
  let rfqA = 0;
  let rfqB = 0;
  const createdRfqIds: bigint[] = [];
  const sessions: E2eSession[] = [];
  let page: Page;

  const topRow = async (): Promise<any> => getPrisma().spPcbRfq.findUnique({ where: { id: BigInt(topRfqId) } });
  const detailApi = async (): Promise<any> =>
    (await api(M, 'GET', `/api/partner/pcb-rfqs/${String(topRfqId)}`)).json?.data;
  const open = async (mbId: string, rfqId: number): Promise<Page> => {
    const s = await newSession({ mbId, ttlSec: 3600 }, { partnerModule: 'pcb' });
    sessions.push(s);
    await gotoApp(s.page, `/partner/pcb/rfqs/${String(rfqId)}`);
    await s.page.locator('h1', { hasText: projectName }).waitFor({ timeout: 30_000 });
    await s.page.waitForLoadState('networkidle');
    return s.page;
  };
  const reload = async (): Promise<void> => {
    await page.reload();
    await page.locator('h1', { hasText: projectName }).waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
  };
  const shot = async (target: Page, name: string): Promise<void> => {
    mkdirSync(SHOTS, { recursive: true });
    await target.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  const top = (el: Locator): Promise<number> => el.boundingBox().then((box) => box?.y ?? Number.NaN);
  const setLocale = async (target: Page, locale: PartnerLocale): Promise<void> => {
    await target.getByTestId('partner-language').selectOption(locale);
    await target.waitForFunction((lang) => document.documentElement.lang === lang, locale);
  };
  const until = async (label: string, fn: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await fn()) return;
      if (Date.now() > deadline) throw new Error(`대기 초과: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };
  /**
   * 이 주행이 만든 메일 — 제목에 프로젝트명이 있고 주행 시작 뒤에 온 것. 제목 검색(subject:"…")은 쓰지 않는다:
   * 빌려 쓰는 스펙의 이름에 따옴표가 섞여 있으면 검색식이 깨져 0건이 된다(실측 — 험한 이름 픽스처).
   */
  const mailsOfRun = async (): Promise<any[]> =>
    (((await mailpitList(200))?.messages ?? []) as any[]).filter(
      (m) => String(m.Subject).includes(projectName) && new Date(String(m.Created)).getTime() >= startedAt.getTime() - 2_000,
    );
  const strip = (target: Page = page) => target.getByTestId('partner-pcb-rfq-my-reply');
  const compose = (target: Page = page) => target.getByTestId('partner-pcb-rfq-compose');
  const childRow = (rfqId: number) => page.locator(`[data-testid="partner-pcb-md-child-row"][data-child-rfq="${String(rfqId)}"]`);
  const confirmBox = () => page.getByRole('alertdialog');

  beforeAll(async () => {
    md = await ensureStagePartner(MD);
    childA = await ensureStagePartner(CHILD_A);
    childB = await ensureStagePartner(CHILD_B);
    await ensureMdRelation(md, childA, 'USD');
    await ensureMdRelation(md, childB, 'USD');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    M = signJwt({ mbId: MD.mbId, ttlSec: 3600 });
    CA = signJwt({ mbId: CHILD_A.mbId, ttlSec: 3600 });
    CB = signJwt({ mbId: CHILD_B.mbId, ttlSec: 3600 });
    mailpitUp = await fetch(`${MAILPIT_URL}/api/v1/info`).then((r) => r.ok).catch(() => false);
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdRfqIds.length > 0) await prisma.spPcbRfq.deleteMany({ where: { id: { in: createdRfqIds } } });
    if (specId !== 0) {
      // 이 주행이 남긴 발송 기록만(스펙은 빌려 쓴 것 — 그 전 기록은 건드리지 않는다).
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: String(specId), kind: { in: ['pcb_rfq_request', 'pcb_rfq_replied'] }, createdAt: { gte: startedAt } },
      });
      expect(await prisma.spPcbRfq.count({ where: { specId: BigInt(specId) } }), 'RFQ 잔재').toBe(0);
    }
    if (mailpitUp && projectName !== '') await mailpitDelete((await mailsOfRun()).map((m) => String(m.ID)));
    for (const s of sessions) await s.close().catch(() => undefined);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('P1. 관리자가 마스터딜러에 견적요청 — 상세 응답이 마스터딜러 화면의 재료를 싣는다', async () => {
    const prisma = getPrisma();
    const usedSpecIds = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map((r: { specId: bigint }) => r.specId);
    const spec = await prisma.spOrderSpec.findFirst({
      where: { status: 'active', ctId: null, id: { notIn: usedSpecIds }, pcbRfqs: { none: {} } },
      orderBy: { id: 'desc' },
    });
    if (spec === null) throw new Error('게이트 통과 자유 스펙이 없습니다');
    specId = num(spec.id);
    projectName = spec.projectName;

    const send = await api(A, 'POST', `/api/admin/pcb-projects/${String(specId)}/rfqs`, { partnerIds: [num(md.id)] });
    expect(send.status, JSON.stringify(send.json)).toBe(200);
    topRfqId = (send.json?.data?.rfqs ?? []).find((v: any) => v.partnerId === num(md.id))?.rfqId ?? 0;
    expect(topRfqId, 'MD RFQ 행').toBeGreaterThan(0);
    createdRfqIds.push(BigInt(topRfqId));

    const detail = await detailApi();
    expect(detail.isAdminTrack, '관리자가 보낸 행').toBe(true);
    expect(detail.mdQuote, '아직 하위 선정 없음').toBeNull();
    expect(detail.childRates, '하위 없음 → 환율 없음').toEqual({});
    const mine = ((await api(M, 'GET', '/api/partner/pcb-rfqs')).json?.data?.items ?? []).find((r: any) => r.rfqId === topRfqId);
    expect([mine?.childCount, mine?.childQuotedCount], '목록: 하위 진행 0/0').toEqual([0, 0]);
  });

  test('P2. 화면 배치와 ① 요청 보내기 — 회신 만들기가 사양보다 위, 메시지는 누른 버튼 아래', async (ctx) => {
    if (topRfqId === 0) return ctx.skip();
    page = await open(MD.mbId, topRfqId);

    // 배치: 요약 → 내 회신 → 회신 만들기 → 제작 사양.
    const ys = await Promise.all([
      top(page.getByTestId('partner-pcb-rfq-summary')),
      top(strip()),
      top(compose()),
      top(page.getByTestId('partner-pcb-rfq-spec')),
    ]);
    expect([...ys].sort((a, b) => a - b), `세로 순서 ${JSON.stringify(ys)}`).toEqual(ys);
    expect(await page.getByTestId('partner-pcb-rfq-reply').count(), '일반 협력사용 회신 카드는 없다').toBe(0);
    expect(await strip().getAttribute('data-reply-mode')).toBe('none');
    expect(await strip().innerText()).toContain(tr('아직 회신 전입니다.'));
    expect(await page.getByTestId('partner-pcb-rfq-mode-child').getAttribute('aria-selected'), '기본 탭 = 하위 견적').toBe('true');
    // 파일은 한 곳(요약 띠)에만 — 사양 구역에 되풀이하지 않는다.
    const fileButtons = await page.locator('button', { hasText: '⬇' }).count();
    expect(await page.getByTestId('partner-pcb-rfq-spec').locator('button', { hasText: '⬇' }).count(), '사양 구역의 파일 버튼').toBe(0);
    expect(await page.getByTestId('partner-pcb-rfq-summary').locator('button', { hasText: '⬇' }).count()).toBe(fileButtons);

    // ① 요청 보내기 — 아무것도 안 고르면 잠겨 있다.
    const sendBtn = page.getByTestId('partner-pcb-md-send');
    expect(await sendBtn.isDisabled(), '고른 것이 없으면 잠김').toBe(true);
    expect(await page.getByTestId('partner-pcb-md-compare').innerText()).toContain(tr('아직 보낸 요청이 없습니다 — 위에서 협력사를 골라 요청을 보내 주세요.'));
    await page.getByTestId(`partner-pcb-md-pick-${String(num(childA.id))}`).check();
    await page.getByTestId(`partner-pcb-md-pick-${String(num(childB.id))}`).check();
    await page.getByTestId('partner-pcb-md-suggested').fill(SUGGESTED);
    await sendBtn.click();
    const notice = page.getByTestId('partner-pcb-md-assign-notice');
    await notice.waitFor();
    expect(await notice.innerText()).toBe(tr('보냄 {added}곳 · 유지 {kept}곳 · 회수 {removed}곳', 'ko', { added: 2, kept: 0, removed: 0 }));
    // 메시지는 버튼 바로 아래(같은 구역 안, 버튼에서 100px 이내).
    const gap = (await top(notice)) - (await top(sendBtn));
    expect(gap > 0 && gap < 100, `버튼↔메시지 거리 ${String(gap)}px`).toBe(true);

    const prisma = getPrisma();
    const rows = await prisma.spPcbRfq.findMany({ where: { specId: BigInt(specId), parentPartnerId: md.id }, orderBy: { id: 'asc' } });
    expect(rows.length, '하위 RFQ 2건').toBe(2);
    for (const row of rows) createdRfqIds.push(row.id);
    rfqA = num(rows.find((r: any) => r.partnerId === childA.id)?.id ?? 0n);
    rfqB = num(rows.find((r: any) => r.partnerId === childB.id)?.id ?? 0n);
    expect(rows.map((r: any) => r.suggestedDeliveryDate?.toISOString().slice(0, 10)), '제시 납기는 마스터딜러가 정한 날').toEqual([
      // KST 자정 = 전날 15:00Z
      '2026-11-14',
      '2026-11-14',
    ]);

    await childRow(rfqA).waitFor();
    expect(await page.locator('[data-testid="partner-pcb-md-child-row"]').count()).toBe(2);
    expect(await childRow(rfqA).locator('input[type="radio"]').isDisabled(), '회신 전에는 고를 수 없다').toBe(true);
    expect(await sendBtn.isDisabled(), '보낸 뒤에는 다시 잠긴다(바뀐 것이 없다)').toBe(true);
    expect(await page.getByTestId('partner-pcb-md-quote').innerText()).toContain(tr('하위 회신이 오면 여기서 골라 마진을 붙여 회신합니다.'));
    await shot(page, '01-assigned');
  });

  test('P3. 하위 회신 도착 — 메일은 그 견적요청으로 바로 가고, 목록에 하위 진행이 보인다', async (ctx) => {
    if (rfqA === 0 || rfqB === 0) return ctx.skip();
    const a = await api(CA, 'PUT', `/api/partner/pcb-rfqs/${String(rfqA)}`, { price: PRICE_A, quotedDeliveryDate: DATE_A, memo: '[md-portal] A' });
    const b = await api(CB, 'PUT', `/api/partner/pcb-rfqs/${String(rfqB)}`, { price: PRICE_B, quotedDeliveryDate: DATE_B, memo: '[md-portal] B' });
    expect([a.status, b.status], `${JSON.stringify(a.json)} ${JSON.stringify(b.json)}`).toEqual([200, 200]);

    const mine = ((await api(M, 'GET', '/api/partner/pcb-rfqs')).json?.data?.items ?? []).find((r: any) => r.rfqId === topRfqId);
    expect([mine?.childCount, mine?.childQuotedCount], '목록: 하위 진행 2/2').toEqual([2, 2]);

    // 마스터딜러가 받는 "회신 도착" 메일 — 포털 첫 화면이 아니라 그 견적요청을 연다.
    const mdMail = (md.contactEmail ?? '').trim();
    if (mailpitUp && mdMail !== '') {
      const link = `/app/partner/pcb/rfqs/${String(topRfqId)}`;
      await until('하위 회신 도착 메일(딥링크)', async () => {
        const hits = (await mailsOfRun()).filter((m) =>
          (m.To ?? []).some((to: any) => String(to.Address).toLowerCase() === mdMail.toLowerCase()),
        );
        for (const hit of hits) {
          if (String((await mailpitMessage(String(hit.ID)))?.HTML ?? '').includes(link)) return true;
        }
        return false;
      });
    }

    // 목록 화면 — 회신이 왔고 내 회신 전이라 칩이 도드라진다.
    const s = await newSession({ mbId: MD.mbId, ttlSec: 3600 }, { partnerModule: 'pcb' });
    sessions.push(s);
    await gotoApp(s.page, '/partner/pcb/rfqs');
    const row = s.page.locator('a', { hasText: projectName }).first();
    await row.waitFor({ timeout: 30_000 });
    const chip = row.getByTestId('partner-pcb-rfq-child-progress');
    expect((await chip.innerText()).trim()).toBe(tr('하위 회신 {value1}/{value2}', 'ko', { value1: 2, value2: 2 }));
    expect(await chip.getAttribute('class'), '고를 차례 — 초록').toContain('bg-emerald-100');
    await shot(s.page, '02-list-chip');
  });

  test('P4. ② 비교 → ③ 마진·납기 — 저장 전에 회신가가 보이고, 저장하면 내 회신에 바로 선다', async (ctx) => {
    if (rfqA === 0 || rfqB === 0) return ctx.skip();
    await reload();
    const detail = await detailApi();
    const rate = Number(detail.childRates.USD);
    expect(rate, 'USD→KRW 오늘 환율').toBeGreaterThan(0);

    // ① 회신이 온 곳은 회수할 수 없다 — 체크가 잠겨 있다.
    const pickA = page.getByTestId(`partner-pcb-md-pick-${String(num(childA.id))}`);
    expect([await pickA.isChecked(), await pickA.isDisabled()], '회신 온 곳은 체크·잠김').toEqual([true, true]);

    // ② 통화가 달라 환산 열이 서고, 싼 쪽에 최저가.
    const money = (value: number): string => new Intl.NumberFormat('ko-KR').format(value);
    expect(await childRow(rfqA).getByTestId('partner-pcb-md-converted').innerText()).toContain(money(roundPcbAmount(PRICE_A * rate, 'KRW')));
    expect(await childRow(rfqB).getByTestId('partner-pcb-md-converted').innerText()).toContain(money(roundPcbAmount(PRICE_B * rate, 'KRW')));
    expect(await childRow(rfqB).getByTestId('partner-pcb-md-cheapest').count(), '최저가 = B').toBe(1);
    expect(await childRow(rfqA).getByTestId('partner-pcb-md-cheapest').count()).toBe(0);

    // ③ 고르기 전·마진 전 — 안내만.
    const preview = page.getByTestId('partner-pcb-md-preview');
    expect(await preview.innerText()).toContain(tr('위 표에서 회신을 고르면 회신가를 미리 계산합니다.'));
    await childRow(rfqA).locator('input[type="radio"]').check();
    expect(await page.getByTestId('partner-pcb-md-delivery').inputValue(), '납기는 하위 납기에서 출발').toBe(DATE_A);
    expect(await preview.innerText()).toContain(tr('마진을 입력하면 회신가를 미리 계산합니다.'));
    await page.getByTestId('partner-pcb-md-margin').fill(String(MARGIN));
    const expected = pcbMdQuoteAmount(PRICE_A, rate, MARGIN, 'KRW');
    expect(await preview.innerText(), '예상 회신가 표시').toContain(tr('예상 회신가'));
    expect(await page.getByTestId('partner-pcb-md-preview-amount').innerText()).toContain(money(expected));
    expect(await preview.innerText(), '근거 식').toContain(`${String(rate)} × 1.15`);

    // 하위 납기보다 이르면 경고, 늦추면 사라진다.
    await page.getByTestId('partner-pcb-md-delivery').fill('2026-11-18');
    await page.getByTestId('partner-pcb-md-early').waitFor();
    await page.getByTestId('partner-pcb-md-delivery').fill(MY_DATE);
    expect(await page.getByTestId('partner-pcb-md-early').count()).toBe(0);
    await page.getByTestId('partner-pcb-md-memo').fill('검사 4일 포함');

    // 창을 다녀와 재조회가 돌아도 고르던 것이 남는다(예전에는 라디오·체크가 서버 값으로 되돌아갔다).
    const refetched = page.waitForResponse((res) => res.url().endsWith(`/api/partner/pcb-rfqs/${String(topRfqId)}`) && res.request().method() === 'GET');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await refetched;
    await page.waitForLoadState('networkidle');
    expect(await childRow(rfqA).locator('input[type="radio"]').isChecked(), '재조회 뒤에도 고른 라디오').toBe(true);
    expect(await page.getByTestId('partner-pcb-md-margin').inputValue(), '재조회 뒤에도 마진').toBe(String(MARGIN));
    expect(await page.getByTestId('partner-pcb-md-delivery').inputValue()).toBe(MY_DATE);
    await shot(page, '03-preview');

    // 저장 — 메시지는 버튼 아래, 결과는 내 회신 띠.
    const saveBtn = page.getByTestId('partner-pcb-md-save');
    await saveBtn.click();
    const notice = page.getByTestId('partner-pcb-md-save-notice');
    await notice.waitFor();
    const gap = (await top(notice)) - (await top(saveBtn));
    expect(gap > 0 && gap < 100, `버튼↔메시지 거리 ${String(gap)}px`).toBe(true);
    await page.waitForFunction(() => document.querySelector('[data-testid="partner-pcb-rfq-my-reply"]')?.getAttribute('data-reply-mode') === 'child');

    const row = await topRow();
    const stamped = Number(row.sourceRate);
    const amount = pcbMdQuoteAmount(PRICE_A, stamped, MARGIN, 'KRW');
    expect(Number(row.priceOriginal), '회신가 = 하위가 × 환율 × (1+마진%)').toBe(amount);
    expect([Number(row.selectedChildRfqId), row.marginRate, row.status]).toEqual([rfqA, MARGIN, 'quoted']);
    expect(row.quotedDeliveryDate.toISOString(), '납기는 마스터딜러가 정한 날(하위 납기 그대로가 아니다)').toBe(`${'2026-11-23'}T15:00:00.000Z`);
    expect(row.memo).toBe('검사 4일 포함');

    expect(await page.getByTestId('partner-pcb-rfq-my-reply-amount').innerText()).toContain(money(amount));
    const basis = await page.getByTestId('partner-pcb-rfq-my-reply-basis').innerText();
    expect(basis).toContain(tr('하위 선정: {value1} + {value2}%', 'ko', { value1: CHILD_A.orgName, value2: MARGIN }));
    expect(basis, '근거 식(박제된 환율)').toContain(`${String(stamped)} × 1.15`);
    expect(await preview.innerText(), '저장 뒤에는 박제된 값').toContain(tr('저장된 회신가'));
    expect(await saveBtn.isDisabled(), '바뀐 것이 없으면 잠김').toBe(true);
    expect(await page.getByTestId('partner-pcb-md-clear').count(), '선정 해제 버튼').toBe(1);

    // 하위 선정은 곧 회신이다 — 직접 회신과 같은 통지가 관리자에게 간다.
    const logs = await getPrisma().spMailLog.findMany({ where: { kind: 'pcb_rfq_replied', refType: 'pcb_spec', refId: String(specId) } });
    const viaChild = logs.filter((log: any) => log.params?.viaChildRfqId === String(rfqA));
    expect(viaChild.length, '하위 선정 회신 통지 기록').toBe(1);
    expect(viaChild[0].params?.rfqId, '상위(MD) 행의 회신').toBe(String(topRfqId));
    await shot(page, '04-saved');

    // 새로 열어도 마진·납기·메모가 그대로 선다(예전에는 마진 칸이 비어 있었다).
    await reload();
    expect(await page.getByTestId('partner-pcb-md-margin').inputValue()).toBe(String(MARGIN));
    expect(await page.getByTestId('partner-pcb-md-delivery').inputValue()).toBe(MY_DATE);
    expect(await page.getByTestId('partner-pcb-md-memo').inputValue()).toBe('검사 4일 포함');
    expect(await childRow(rfqA).locator('input[type="radio"]').isChecked()).toBe(true);
  });

  test('P5. 직접 입력 탭 — 입력칸이 지금 회신을 보이고, 저장이 하위 선정을 지울 때는 먼저 묻는다', async (ctx) => {
    if (rfqA === 0) return ctx.skip();
    const before = await topRow();
    await page.getByTestId('partner-pcb-rfq-mode-direct').click();
    const priceInput = compose().locator('input[inputmode="decimal"]');
    // 재편 전 결함 — 하위 선정으로 회신가가 생겨도 이 칸은 비어 있었다.
    expect(Number(await priceInput.inputValue()), '입력칸 = 지금 회신가').toBe(Number(before.priceOriginal));
    expect(await compose().locator('input[type="date"]:visible').inputValue()).toBe(MY_DATE);
    await page.getByTestId('partner-pcb-rfq-direct-warn').waitFor();

    await priceInput.fill('333000');
    const saveBtn = compose().getByRole('button', { name: tr('회신 저장'), exact: true });
    await saveBtn.click();
    await confirmBox().waitFor();
    expect(await confirmBox().innerText()).toContain(tr('하위 선정이 풀립니다'));
    expect(await confirmBox().innerText()).toContain(`${CHILD_A.orgName} + ${String(MARGIN)}%`);
    await confirmBox().getByRole('button', { name: '취소' }).click();
    await confirmBox().waitFor({ state: 'detached' });
    expect(Number((await topRow()).selectedChildRfqId), '취소 — 하위 선정 그대로').toBe(rfqA);

    await saveBtn.click();
    await confirmBox().waitFor();
    await confirmBox().getByRole('button', { name: tr('직접 입력으로 저장'), exact: true }).click();
    const notice = page.getByTestId('partner-pcb-rfq-reply-notice');
    await notice.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="partner-pcb-rfq-my-reply"]')?.getAttribute('data-reply-mode') === 'direct');
    const row = await topRow();
    expect([Number(row.priceOriginal), row.selectedChildRfqId, row.marginRate]).toEqual([333000, null, null]);
    expect(await strip().innerText()).toContain(tr('직접 입력한 회신'));
    expect(await page.getByTestId('partner-pcb-rfq-direct-warn').count(), '이제 지울 선정이 없다').toBe(0);
    const statuses = (await getPrisma().spPcbRfq.findMany({ where: { id: { in: [BigInt(rfqA), BigInt(rfqB)] } } })).map((r: any) => r.status);
    expect(statuses, '하위 표시는 회신 완료로 돌아간다').toEqual(['quoted', 'quoted']);
    await shot(page, '05-direct');
  });

  test('P6. 다시 하위 견적으로 — 직접 회신을 바꿀 때도 묻고, 선정 해제는 회신을 함께 지운다', async (ctx) => {
    if (rfqB === 0) return ctx.skip();
    await page.getByTestId('partner-pcb-rfq-mode-child').click();
    expect(await page.getByTestId('partner-pcb-md-margin').inputValue(), '선정이 풀려 마진도 비었다').toBe('');
    await childRow(rfqB).locator('input[type="radio"]').check();
    await page.getByTestId('partner-pcb-md-margin').fill('10');
    await page.getByTestId('partner-pcb-md-save').click();
    await confirmBox().waitFor();
    expect(await confirmBox().innerText()).toContain(tr('직접 입력한 회신을 바꿉니다'));
    await confirmBox().getByRole('button', { name: tr('이 견적으로 회신 저장'), exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="partner-pcb-rfq-my-reply"]')?.getAttribute('data-reply-mode') === 'child');
    let row = await topRow();
    expect([Number(row.selectedChildRfqId), row.marginRate]).toEqual([rfqB, 10]);
    expect(Number(row.priceOriginal)).toBe(pcbMdQuoteAmount(PRICE_B, Number(row.sourceRate), 10, 'KRW'));
    expect(row.quotedDeliveryDate.toISOString(), '납기 = 하위 B 납기에서 출발').toBe(`${'2026-11-24'}T15:00:00.000Z`);

    await page.getByTestId('partner-pcb-md-clear').click();
    await confirmBox().waitFor();
    expect(await confirmBox().innerText()).toContain(tr('하위 선정을 풀면 지금 회신도 함께 지워집니다.'));
    await confirmBox().getByRole('button', { name: tr('선정 해제'), exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="partner-pcb-rfq-my-reply"]')?.getAttribute('data-reply-mode') === 'none');
    expect(await page.getByTestId('partner-pcb-md-save-notice').innerText()).toBe(tr('하위 선정을 해제했습니다 — 회신도 함께 초기화되었습니다.'));
    row = await topRow();
    expect([row.priceOriginal, row.selectedChildRfqId, row.status]).toEqual([null, null, 'requested']);
    expect(await page.getByTestId('partner-pcb-md-clear').count(), '해제 버튼은 선정이 있을 때만').toBe(0);
  });

  test('P7. 영어·중국어 — 마스터딜러 화면에 한글이 남지 않고, 좁은 화면에서 넘치지 않는다', async (ctx) => {
    if (rfqA === 0) return ctx.skip();
    // 선정 상태로 두고 본다(내 회신 띠·저장된 회신가까지 문구가 다 선다).
    const pick = await api(M, 'POST', `/api/partner/pcb-rfqs/${String(topRfqId)}/child-selection`, { childRfqId: rfqA, marginRate: MARGIN });
    expect(pick.status, JSON.stringify(pick.json)).toBe(200);
    await reload();
    // 이름·메모·프로젝트명은 자료라 번역 대상이 아니다.
    const childNames = ((await detailApi()).myChildPartners as { name: string }[]).map((child) => child.name);
    const data = [...childNames, CHILD_A.orgName, CHILD_B.orgName, MD.orgName, projectName, '[md-portal] A', '[md-portal] B', '검사 4일 포함']
      .sort((a, b) => b.length - a.length);
    const stripData = (text: string): string => data.reduce((acc, value) => acc.split(value).join(''), text);
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(page, locale);
      for (const part of [strip(), compose()]) {
        expect(stripData(await part.innerText()), `${locale} 한글 잔류`).not.toMatch(HANGUL);
      }
      expect(await strip().innerText()).toContain(tr('내 회신', locale));
      expect(await compose().innerText()).toContain(tr('저장된 회신가', locale));
      await page.getByTestId('partner-pcb-rfq-mode-direct').click();
      expect(stripData(await compose().innerText()), `${locale} 직접 입력 탭 한글 잔류`).not.toMatch(HANGUL);
      await page.getByTestId('partner-pcb-rfq-mode-child').click();
    }
    await shot(page, '06-zh');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390px 가로 넘침').toBe(true);
    await shot(page, '07-zh-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });
    await setLocale(page, 'ko');
  });

  test('P8. 끝난 건과 일반 협력사 — 선정 뒤에는 읽기 전용, 하위 협력사 화면은 예전 그대로', async (ctx) => {
    if (rfqA === 0) return ctx.skip();
    const prisma = getPrisma();
    // 관리자 선정 뒤의 모습 — 상태만 잠깐 바꿔 본다(선정·해제 경로는 다른 주행이 본다).
    await prisma.spPcbRfq.update({ where: { id: BigInt(topRfqId) }, data: { status: 'selected' } });
    try {
      await reload();
      const readonly = page.getByTestId('partner-pcb-rfq-readonly');
      await readonly.waitFor();
      expect(await readonly.innerText()).toContain(tr('발주서가 발행되면 발주 상세에서 하위 발주를 진행합니다.'));
      expect(await page.getByTestId('partner-pcb-md-assign').count(), '요청 보내기 없음').toBe(0);
      expect(await page.getByTestId('partner-pcb-md-quote').count(), '마진·납기 없음').toBe(0);
      expect(await childRow(rfqA).locator('input[type="radio"]').isDisabled()).toBe(true);
      expect(await strip().getAttribute('data-reply-mode'), '내 회신은 계속 보인다').toBe('child');
      await shot(page, '08-readonly');
    } finally {
      await prisma.spPcbRfq.update({ where: { id: BigInt(topRfqId) }, data: { status: 'quoted' } });
    }

    // 하위 협력사(일반) — 사양 → 회신, 마스터딜러 구역 없음. 메시지는 이쪽도 버튼 아래로 왔다.
    const child = await open(CHILD_B.mbId, rfqB);
    expect(await child.getByTestId('partner-pcb-rfq-compose').count(), '회신 만들기 카드 없음').toBe(0);
    expect(await child.getByTestId('partner-pcb-rfq-my-reply').count()).toBe(0);
    const spec = child.getByTestId('partner-pcb-rfq-spec');
    const reply = child.getByTestId('partner-pcb-rfq-reply');
    expect(await top(spec), '사양이 위').toBeLessThan(await top(reply));
    expect(await spec.locator('button', { hasText: '⬇' }).count(), '파일은 사양 구역에').toBe(await child.locator('button', { hasText: '⬇' }).count());
    expect(Number(await reply.locator('input[inputmode="decimal"]').inputValue()), '자기 회신가').toBe(PRICE_B);
    // 마스터딜러가 A 를 선정해 둔 상태라 B 는 미선정(읽기 전용)이다 — 저장 버튼이 없다.
    expect(await reply.getByRole('button', { name: tr('회신 저장'), exact: true }).count()).toBe(0);
    await shot(child, '09-child-view');
  });
});
