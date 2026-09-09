// 실 Vue 위저드 + 연락처 API 응답 스텁. DB 쓰기/접수/메일/LLM 호출 없이 입력 경합과 초안 소유권 검증.
import { afterAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import { closeBrowser, newSession, snap } from '../helpers/browser';
import { RUN, outputDir } from '../helpers/env';

const identity = { mbId: 'e2e-contact-owner', mbNick: '이름으로 쓰면 안 되는 닉네임' };
const contact = { mbId: identity.mbId, name: '홍담당', company: '샘플 회사', phone: '010-1234-5678', email: 'contact@example.com' };
const prefix = 'sp-develop-request-draft';
const key = `${prefix}:${encodeURIComponent(identity.mbId)}`;
const notice = '회원정보로 채웠습니다. 이번 의뢰의 담당자 정보로 수정할 수 있습니다.';

async function next(page: Page): Promise<void> {
  await page.getByRole('button', { name: /다음 단계/ }).click();
}

async function reachReview(page: Page): Promise<void> {
  await page.getByText('시스템개발', { exact: true }).first().click();
  await next(page);
  await page.getByPlaceholder('예: 매장용 자동 음료 디스펜서 개발').fill('연락처 자동 입력 확인');
  await page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill('센서의 값을 모아 펌프를 자동 제어하는 장비 개발');
  await page.getByRole('button', { name: '아이디어', exact: true }).click();
  await page.getByRole('button', { name: '시제품 완성', exact: true }).click();
  await page.getByPlaceholder('계약 후 3개월').fill('계약 후 3개월');
  await page.locator('select').first().selectOption({ label: '1천만~3천만원' });
  await page.getByText('입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다.').click();
  await page.getByText('전문가에게 맡김', { exact: false }).first().click();
  await next(page);
  await page.getByText('전문가 검토로 접수합니다').waitFor();
  await next(page);
  await page.getByText('수량 미정', { exact: true }).click();
  await next(page);
  await page.getByRole('heading', { name: '어떻게 연락드릴까요?' }).waitFor();
}

async function values(page: Page): Promise<string[]> {
  return Promise.all(['홍길동', '(주)샘플피씨비', '010-0000-0000', 'name@company.com'].map((p) => page.getByPlaceholder(p).inputValue()));
}

function draft(mbId: string) {
  return {
    v: 3, mbId, savedAt: '2026-09-10T00:00:00.000Z', stepIndex: 4,
    fields: { title: '담당자가 다른 의뢰', requestMode: 'system' },
    contact: { name: '다른 담당자', company: '', phone: '02-123-4567', email: 'other@example.com', hours: '' },
    questions: {},
  };
}

describe.skipIf(!RUN)('개발의뢰 회원정보 자동 채움', () => {
  afterAll(closeBrowser);

  test('실명·회사·전화·메일 자동 입력, 수정 보존, 처음부터, 데스크톱·모바일 표시', async () => {
    const s = await newSession(identity);
    let requests = 0;
    try {
      await s.context.route('**/api/me/contact', async (route) => {
        requests += 1;
        await route.fulfill({ json: contact });
      });
      await s.page.goto('/develop/request');
      await reachReview(s.page);
      expect(await values(s.page)).toEqual([contact.name, contact.company, contact.phone, contact.email]);
      await s.page.getByText(notice).waitFor();
      await snap(s.page, 'develop-contact-desktop');
      await s.page.setViewportSize({ width: 390, height: 844 });
      await s.page.getByText(notice).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await s.page.screenshot({ path: `${outputDir}/develop-contact-mobile.png` });
      expect(await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await s.page.getByPlaceholder('홍길동').fill('이번 의뢰 담당자');
      await s.page.getByPlaceholder('(주)샘플피씨비').fill('');
      await s.page.getByRole('button', { name: '이전', exact: true }).click();
      await next(s.page);
      expect((await values(s.page)).slice(0, 2)).toEqual(['이번 의뢰 담당자', '']);
      expect(requests).toBe(1);
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      await s.page.reload();
      await s.page.getByRole('button', { name: '이어쓰기', exact: true }).click();
      expect((await values(s.page)).slice(0, 2)).toEqual(['이번 의뢰 담당자', '']);
      await s.page.getByRole('button', { name: '처음부터', exact: true }).click();
      await s.page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
      await reachReview(s.page);
      expect(await values(s.page)).toEqual([contact.name, contact.company, contact.phone, contact.email]);
      expect(requests).toBe(2);
      expect(s.pageErrors).toEqual([]);
    } finally { await s.close(); }
  });

  test('늦은 응답은 사용자가 입력하거나 지운 칸을 덮어쓰지 않는다', async () => {
    const s = await newSession(identity);
    let release = (): void => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    try {
      await s.context.route('**/api/me/contact', async (route) => { await pending; await route.fulfill({ json: contact }); });
      await s.page.goto('/develop/request');
      await reachReview(s.page);
      expect(await s.page.getByPlaceholder('홍길동').inputValue()).toBe('');
      await s.page.getByPlaceholder('홍길동').fill('직접 입력');
      await s.page.getByPlaceholder('010-0000-0000').fill('010-9999-9999');
      await s.page.getByPlaceholder('010-0000-0000').fill('');
      release();
      await s.page.getByText(notice).waitFor();
      expect(await values(s.page)).toEqual(['직접 입력', contact.company, '', contact.email]);
      expect(s.pageErrors).toEqual([]);
    } finally { release(); await s.close(); }
  });

  test('임시저장의 빈 회사명까지 늦은 회원정보보다 우선한다', async () => {
    const s = await newSession(identity, { localStorage: { [key]: JSON.stringify(draft(identity.mbId)) } });
    let release = (): void => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    try {
      await s.context.route('**/api/me/contact', async (route) => { await pending; await route.fulfill({ json: contact }); });
      await s.page.goto('/develop/request');
      await s.page.getByRole('button', { name: '이어쓰기', exact: true }).click();
      await s.page.getByRole('heading', { name: '어떻게 연락드릴까요?' }).waitFor();
      const response = s.page.waitForResponse('**/api/me/contact');
      release();
      await response;
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      expect(await values(s.page)).toEqual(['다른 담당자', '', '02-123-4567', 'other@example.com']);
      expect(await s.page.getByText(notice).count()).toBe(0);
      expect(s.pageErrors).toEqual([]);
    } finally { release(); await s.close(); }
  });

  test('구 공용 초안·타 계정 초안을 복원하지 않고 본인 키에만 저장한다', async () => {
    const otherKey = `${prefix}:other-member`;
    const legacy = JSON.stringify({ ...draft('other-member'), v: 2, mbId: undefined });
    const foreign = JSON.stringify(draft('other-member'));
    const s = await newSession(identity, { localStorage: { [prefix]: legacy, [otherKey]: foreign, [key]: foreign } });
    try {
      await s.context.route('**/api/me/contact', (route) => route.fulfill({ json: contact }));
      await s.page.goto('/develop/request');
      await reachReview(s.page);
      expect(await s.page.getByRole('heading', { name: '이어서 작성할까요?' }).count()).toBe(0);
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      const saved = await s.page.evaluate(({ key, otherKey, prefix }) => ({
        own: JSON.parse(localStorage.getItem(key) ?? '{}') as { mbId?: string; v?: number },
        other: localStorage.getItem(otherKey), legacy: localStorage.getItem(prefix),
      }), { key, otherKey, prefix });
      expect(saved.own).toMatchObject({ mbId: identity.mbId, v: 3 });
      expect(saved.other).toBe(foreign);
      expect(saved.legacy).toBe(legacy);
      expect(s.pageErrors).toEqual([]);
    } finally { await s.close(); }
  });

  test('401 인증 갱신 중 계정 변경은 이전 폼·응답을 버리고 새 회원만 채운다', async () => {
    const s = await newSession(identity);
    const nextId = 'next-contact-owner';
    const nextContact = { ...contact, mbId: nextId, name: '다음 회원' };
    let switched = false;
    let first = true;
    let release = (): void => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    try {
      await s.context.route('**/spcb/api/me', (route) => route.fulfill({ json: {
        token: switched ? 'next-token' : 'initial-token',
        member: { mbId: switched ? nextId : identity.mbId, mbNick: '닉네임', level: 2, isAdmin: false },
      } }));
      await s.context.route('**/api/me/contact', async (route) => {
        if (first) {
          first = false;
          await pending;
          await route.fulfill({ status: 401, json: { error: 'EXPIRED' } });
        } else {
          await route.fulfill({ json: nextContact });
        }
      });
      await s.page.goto('/develop/request');
      await reachReview(s.page);
      await s.page.getByPlaceholder('홍길동').fill('이전 회원 작성값');
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      switched = true;
      release();
      await s.page.getByText('어떤 개발이 필요하신가요?').waitFor();
      expect(await s.page.getByRole('heading', { name: '이어서 작성할까요?' }).count()).toBe(0);
      await reachReview(s.page);
      expect(await values(s.page)).toEqual([nextContact.name, nextContact.company, nextContact.phone, nextContact.email]);
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      const owners = await s.page.evaluate(({ key, nextKey }) => [key, nextKey].map((k) => {
        const value = JSON.parse(localStorage.getItem(k) ?? '{}') as { mbId?: string; contact?: { name?: string } };
        return [value.mbId, value.contact?.name];
      }), { key, nextKey: `${prefix}:${nextId}` });
      expect(owners).toEqual([[identity.mbId, '이전 회원 작성값'], [nextId, '다음 회원']]);
      expect(s.pageErrors).toEqual([]);
    } finally { release(); await s.close(); }
  });

  test.each(['missing', 'failed', 'different-member'] as const)('%s 회원정보여도 닉네임을 채우지 않고 직접 입력할 수 있다', async (mode) => {
    const s = await newSession(identity);
    try {
      await s.context.route('**/api/me/contact', (route) => route.fulfill(mode === 'failed'
        ? { status: 503, json: { error: 'UNAVAILABLE' } }
        : { json: mode === 'missing'
          ? { mbId: identity.mbId, name: null, company: null, phone: null, email: null }
          : { ...contact, mbId: 'someone-else' } }));
      await s.page.goto('/develop/request');
      await reachReview(s.page);
      expect(await values(s.page)).toEqual(['', '', '', '']);
      expect(await s.page.getByText(notice).count()).toBe(0);
      await s.page.getByPlaceholder('홍길동').fill('직접 담당자');
      await s.page.getByPlaceholder('010-0000-0000').fill('010-1111-2222');
      await s.page.getByPlaceholder('name@company.com').fill('manual@example.com');
      await s.page.getByRole('button', { name: '임시저장', exact: true }).click();
      expect((await values(s.page))[0]).toBe('직접 담당자');
      expect(s.pageErrors).toEqual([]);
    } finally { await s.close(); }
  });
});
