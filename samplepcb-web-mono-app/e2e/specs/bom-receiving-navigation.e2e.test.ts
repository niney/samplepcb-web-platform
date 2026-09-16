// 입고 이력의 발주번호가 남고 견적 연결은 없는 경우에도 메뉴 이동이 깨지지 않아야 한다.
// 최근 스캔 GET만 대체하며 DB 기록·스캔·메일 발송은 수행하지 않는다.
import { afterAll, describe, expect, test } from 'vitest';
import type { BomReceivingScanRecordType } from '@sp/api-contract';
import { RUN, closeBrowser, newSession } from '../helpers';

const scanRecord = (
  scanId: number,
  overrides: Partial<BomReceivingScanRecordType>,
): BomReceivingScanRecordType => ({
  scanId,
  poItemId: null,
  poId: 901,
  quoteId: null,
  quoteTitle: null,
  partnerName: null,
  poItemMpn: null,
  orderedQty: null,
  supplierCode: 'mouser',
  supplierSku: null,
  mpn: `NAV-REGRESSION-${String(scanId)}`,
  quantity: 1,
  lotCode: null,
  dateCode: null,
  countryOfOrigin: null,
  supplierOrderNo: null,
  customerOrderNo: null,
  invoiceNo: null,
  note: null,
  scannedBy: 'e2e-admin',
  scannedAt: '2026-09-16T00:00:00.000Z',
  voidedAt: null,
  ...overrides,
});

describe.skipIf(!RUN)('입고 이력 견적 연결과 메뉴 이동', () => {
  afterAll(closeBrowser);

  test('견적 ID 없는 이력은 텍스트로 표시하고 다른 업무 메뉴를 왕복한다', async () => {
    const session = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const { page, pageErrors } = session;
    try {
      await page.route('**/api/admin/bom-receiving/scans?*', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ result: true, data: { scans: [
            scanRecord(1, {}),
            scanRecord(2, { poId: 902, quoteId: '' }),
            scanRecord(3, { poId: null }),
            scanRecord(4, {
              poId: 904, poItemId: 9041, quoteId: '904', quoteTitle: '연결된 견적',
              poItemMpn: 'LINKED-PART', orderedQty: 1,
            }),
          ] } }),
        });
      });
      await page.goto('/app/admin/smartbom/logistics');
      await page.getByRole('button', { name: '입고 패널', exact: true }).click();
      await page.locator('summary').filter({ hasText: '최근 입고 스캔' }).click();
      const table = page.getByTestId('receiving-recent');
      await table.waitFor({ state: 'visible' });
      expect(await table.locator('tbody tr').count()).toBe(4);
      expect(await table.textContent()).toContain('PO #901 · 견적 연결 없음');
      expect(await table.textContent()).toContain('PO #902 · 견적 연결 없음');
      expect(await table.textContent()).toContain('미매칭');
      expect(await table.getByRole('link').count()).toBe(1);
      expect(await table.getByRole('link').getAttribute('href'))
        .toBe('/app/admin/smartbom/cases/904?from=logistics');

      await page.locator('aside a[href="/app/admin/smartbom/quotes"]').click();
      await page.getByRole('heading', { name: '견적관리', exact: true }).waitFor();
      await page.locator('aside a[href="/app/admin/smartbom/logistics"]').click();
      await page.getByRole('heading', { name: '선적·배송', exact: true }).waitFor();
      await page.getByRole('button', { name: '입고 패널', exact: true }).click();
      await page.locator('summary').filter({ hasText: '최근 입고 스캔' }).click();
      await table.waitFor({ state: 'visible' });
      expect(await table.locator('tbody tr').count()).toBe(4);
      expect(pageErrors).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
