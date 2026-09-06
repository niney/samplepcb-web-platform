import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import {
  formatPartnerDate, formatPartnerMoney, interpolatePartnerMessage,
  isPartnerLocale, translatePartnerMessage, type PartnerMessages,
} from '../../apps/web/src/partner/i18n-core';
import { commonMessages } from '../../apps/web/src/partner/locales/common';
import { bomMessages } from '../../apps/web/src/partner/locales/bom';
import { pcbMessages } from '../../apps/web/src/partner/locales/pcb';
import { partsMessages } from '../../apps/web/src/partner/locales/parts';
import { shipmentMessages } from '../../apps/web/src/partner/locales/shipment';

const catalogs = { commonMessages, bomMessages, pcbMessages, partsMessages, shipmentMessages };
const messages: PartnerMessages = { ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages };
const paramsOf = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort();

describe('partner language contracts', () => {
  it('has three nonempty translations with matching interpolation variables', () => {
    const problems: string[] = [];
    const sources = new Set<string>();
    for (const [catalog, entries] of Object.entries(catalogs)) {
      for (const [source, translations] of Object.entries(entries)) {
        if (sources.has(source)) problems.push(`Duplicate source key: ${source}`);
        sources.add(source);
        for (const [index, translation] of translations.entries()) {
          if (!translation.trim() || JSON.stringify(paramsOf(source)) !== JSON.stringify(paramsOf(translation))) {
            problems.push(`${catalog}: ${source} [${index}]`);
          }
          if (index > 0 && /[가-힣]/.test(translation)) problems.push(`${catalog}: Korean remains in ${source} [${index}]`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps original shared component copy outside the partner scope', () => {
    for (const source of Object.keys(messages)) {
      expect(translatePartnerMessage(messages, source, 'zh-CN', false)).toBe(source);
    }
    expect(translatePartnerMessage(messages, '보유 부품', 'en', true)).toBe('Inventory');
    expect(translatePartnerMessage(messages, '고객이 작성한 설명', 'en', true)).toBe('고객이 작성한 설명');
    expect(translatePartnerMessage(messages, 'toString', 'en', true)).toBe('toString');
  });

  it('preserves parameter data without interpreting it as a translation or template', () => {
    expect(interpolatePartnerMessage('{name}: {count}', { name: '$& {count} 원문', count: 3 })).toBe('$& {count} 원문: 3');
    expect(isPartnerLocale('zh-CN')).toBe(true);
    expect(isPartnerLocale('zh-TW')).toBe(false);
    expect(isPartnerLocale('<script>')).toBe(false);
  });

  it('keeps currencies separate and business dates on the Korean calendar', () => {
    expect(formatPartnerMoney(16270, 'KRW', 'ko')).toBe('16,270원');
    expect(formatPartnerMoney(16270.25, 'USD', 'zh-CN')).toContain('USD');
    expect(formatPartnerMoney(16270.25, 'USD', 'en')).toContain('16,270.25');
    expect(formatPartnerDate('2026-09-05T15:00:00.000Z', 'en')).toBe('09/06/2026');
    expect(formatPartnerDate('2026-09-06', 'zh-CN')).toBe('2026/09/06');
    expect(formatPartnerDate(null, 'en')).toBe('—');
  });
});

// Browser fixtures never contact the database, mutate business data or send notifications.
describe.skipIf(process.env['PARTNER_I18N_E2E'] !== '1')('partner language browser isolation', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const pageErrors: string[] = [];
  const origin = process.env['PARTNER_I18N_URL'] ?? 'http://localhost:5173';
  const userText = '고객 원문 유지';
  const part = {
    partId: 1, partnerId: 1, partnerName: 'Test partner', uploadId: 1,
    mpn: 'TEST-123', mpnRaw: 'TEST-123', manufacturer: 'Test manufacturer', description: userText,
    stockQty: 12175, dateCode: '2609', leadTime: 'Stock', unitPrice: 1.25, currency: 'USD', moq: 1,
    sourceSheetName: 'Sheet1', sourceRow: 2, flags: [], isActive: true,
    uploadedAt: '2026-09-05T15:00:00.000Z', editedAt: null, editedBy: null,
  };
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(10_000);
    await context.route('**/spcb/api/me', (route) => route.fulfill({ json: {
      token: 'local-browser-fixture', member: { mbId: 'test', mbNick: 'Test user', level: 10, isAdmin: true },
    } }));
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/spcb/api/me') { await route.fallback(); return; }
      let data: unknown = { items: [], partnerName: 'Test partner', total: 0, page: 1, pageSize: 10 };
      if (path === '/api/partner/access') data = { isPartner: true, partnerName: 'Test partner', tracks: { bom: true, pcb: true, parts: true } };
      if (path === '/api/partner/shipments') data = { items: [], total: 0, page: 1, pageSize: 10, counts: { active: 0, done: 0 } };
      if (path === '/api/partner/pcb-shipments') data = { shelf: [], producing: [], boxes: [], active: [], doneCount: 0 };
      if (path === '/api/partner/pcb-as-cases') data = { cases: [], partnerId: 1, partnerName: 'Test partner' };
      if (path === '/api/partner/pcb-remittances') data = { items: [], totals: [
        { currency: 'KRW', poAmount: 16270, paidAmount: 0, balance: 16270, poCount: 1 },
        { currency: 'USD', poAmount: 25.5, paidAmount: 5, balance: 20.5, poCount: 1 },
      ], unpaidCount: 2 };
      if (path === '/api/partner/parts') data = { items: [part], total: 1, page: 1, pageSize: 50 };
      if (path === '/api/partner/rfqs/1') data = {
        rfqId: 1, quoteTitle: 'Test quotation', status: 'requested', currency: 'USD',
        deliveryDate: '2026-09-05T15:00:00.000Z', memo: null, totalAmount: null,
        requestedAt: '2026-09-05T15:00:00.000Z', respondedAt: null,
        items: [{ quoteItemId: '1', mpn: 'TEST-123', manufacturerName: 'Test manufacturer',
          description: userText, orderQty: 10, reply: null }],
      };
      if (path === '/api/partner/parts/summary') data = { summary: { partnerId: 1, partnerName: 'Test partner', activeCount: 1, inactiveCount: 0, lastUploadedAt: part.uploadedAt, lastUploadFileName: 'inventory.xlsx', ageDays: 0, stale: false }, staleAfterDays: 90 };
      await route.fulfill({ json: { result: true, data } });
    });
    page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
  });
  afterAll(async () => { await context?.close(); await browser?.close(); });

  const goto = async (path: string): Promise<void> => {
    await page.goto(`/app${path}`);
    await page.locator('h1').first().waitFor();
  };
  const language = () => page.getByTestId('partner-language');

  it('switches languages, persists on reload, translates data tables and keeps editable data', async () => {
    await goto('/partner/parts');
    expect(await page.locator('h1').textContent()).toContain('보유 재고');
    await language().selectOption('en');
    await page.getByRole('heading', { name: 'Inventory', exact: true }).waitFor();
    expect(await page.locator('tbody').innerText()).toContain('12,175');
    expect(await page.locator('tbody').innerText()).toContain('In stock');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    expect(await page.locator('input').filter({ visible: true }).count()).toBeGreaterThan(5);
    expect(await page.locator('input').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toContain(userText);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await language().selectOption('zh-CN');
    await page.getByRole('heading', { name: '库存管理', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '库存管理', exact: true }).waitFor();
    expect(await language().inputValue()).toBe('zh-CN');
    expect(await page.locator('tbody').innerText()).toContain('有库存');
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    expect(await page.getByRole('alertdialog').innerText()).toContain('取消');
    expect(await page.getByRole('alertdialog').innerText()).not.toMatch(/[가-힣]/);
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  });

  it('covers BOM and PCB lists, currency totals and a narrow viewport in both foreign languages', async () => {
    const routes = ['/partner/bom', '/partner/bom/rfqs', '/partner/bom/pos', '/partner/bom/ship', '/partner/bom/shipments/done', '/partner/pcb', '/partner/pcb/rfqs', '/partner/pcb/pos', '/partner/pcb/ship', '/partner/pcb/shipments/done', '/partner/pcb/as', '/partner/remittances'];
    for (const locale of ['en', 'zh-CN']) {
      await language().selectOption(locale);
      for (const path of routes) {
        await goto(path);
        const text = await page.locator('main').innerText();
        expect(text, `${locale} ${path}`).not.toMatch(/[가-힣]/);
        expect(await language().inputValue()).toBe(locale);
      }
      expect(await page.locator('main').innerText()).toContain('USD');
      expect(await page.locator('main').innerText()).toContain('KRW');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await goto('/partner/parts');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    mkdirSync('output/partner-i18n', { recursive: true });
    await page.screenshot({ path: 'output/partner-i18n/zh-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await language().selectOption('en');
    await page.screenshot({ path: 'output/partner-i18n/en-inventory.png', fullPage: true });
  });

  it('keeps quotation inputs and dates when translating validation feedback', async () => {
    await goto('/partner/bom/rfqs/1');
    await language().selectOption('en');
    const price = page.locator('input[data-rfq-key$=":unitPrice"]');
    const memo = page.locator('input[data-rfq-key="rfq:memo"]');
    await price.fill('-1');
    await memo.fill(userText);
    expect(await page.locator('input[type="date"]').inputValue()).toBe('2026-09-06');
    await page.getByRole('button', { name: translatePartnerMessage(messages, '회신 저장', 'en', true), exact: true }).click();
    await page.locator('#rfq-reply-validation-error').waitFor();
    expect(await page.locator('#rfq-reply-validation-error').innerText()).not.toMatch(/[가-힣]/);
    await language().selectOption('zh-CN');
    expect(await price.inputValue()).toBe('-1');
    expect(await memo.inputValue()).toBe(userText);
    expect(await page.locator('input[type="date"]').inputValue()).toBe('2026-09-06');
    expect(await page.locator('#rfq-reply-validation-error').count()).toBe(0);
    await price.fill('1.25');
    const requestPromise = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/api/partner/rfqs/1'));
    await page.getByRole('button', { name: translatePartnerMessage(messages, '회신 저장', 'zh-CN', true), exact: true }).click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({ memo: userText, deliveryDate: '2026-09-06', items: [{ quoteItemId: '1', unitPrice: 1.25 }] });
    await language().selectOption('en');
  });

  it('leaves the administrator language unchanged and restores the partner preference', async () => {
    await goto('/admin');
    expect(await language().count()).toBe(0);
    expect(await page.locator('body').innerText()).toMatch(/[가-힣]/);
    await page.getByRole('button', { name: '프로필 메뉴 열기' }).waitFor();
    await goto('/partner/parts');
    expect(await language().inputValue()).toBe('en');
    expect(await page.locator('h1').textContent()).toBe('Inventory');
    expect(pageErrors).toEqual([]);
  });
});
