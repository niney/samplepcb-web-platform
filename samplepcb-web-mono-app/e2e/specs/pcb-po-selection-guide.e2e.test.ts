// PCB 발주 UI의 선정 선행 회귀.
// 서버 RFQ_NOT_SELECTED 가드까지 잘못된 요청을 보내는 대신, 관리자가 실제 다음 조치인
// RFQ [선정]으로 이동하는지와 선정 뒤 협력사가 발주 모달에서 고정되는지를 함께 박제한다.
//
// 실행: pnpm -F e2e e2e pcb-po-selection-guide
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newSession,
  pickFreeSpecs,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

describe.skipIf(!RUN)('PCB 발주 UI — 협력사 선정 선행 안내', () => {
  let admin!: E2eSession;
  let partner!: PartnerFixture;
  let specId = 0n;
  let rfqId = 0n;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`);
    if (!health.ok) throw new Error(`API health 실패: ${String(health.status)}`);

    partner = await getPartner('협력2');
    const prisma = getPrisma();
    const pool = await pickFreeSpecs(20);
    const rfqRows = await prisma.spPcbRfq.findMany({
      where: { specId: { in: pool.map((spec: any) => spec.id) } },
      select: { specId: true },
    });
    const usedSpecIds = new Set(rfqRows.map((row: any) => String(row.specId)));
    const spec = pool.find(
      (candidate: any) =>
        candidate.status === 'active' &&
        candidate.ctId === null &&
        !usedSpecIds.has(String(candidate.id)),
    );
    if (spec === undefined) throw new Error('선정 안내 검증에 사용할 active·미담김·RFQ 없음 스펙이 없습니다');
    specId = spec.id;

    const rfq = await prisma.spPcbRfq.create({
      data: {
        specId,
        partnerId: partner.id,
        parentPartnerId: 0n,
        reorderRound: 0,
        status: 'quoted',
        currency: 'USD',
        priceOriginal: 100,
        quotedDeliveryDate: new Date('2026-10-01T00:00:00.000Z'),
        respondedAt: new Date(),
      },
      select: { id: true },
    });
    rfqId = rfq.id;
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
  }, 60_000);

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    await closeBrowser();
    const prisma = getPrisma();
    if (rfqId !== 0n) await prisma.spPcbRfq.deleteMany({ where: { id: rfqId } });
    if (specId !== 0n) {
      const leftover = await prisma.spPcbRfq.count({ where: { specId } });
      expect(leftover, '시드 스펙에 RFQ 잔재').toBe(0);
    }
    await disconnectPrisma();
  });

  test('미선정 발주 클릭은 모달 대신 RFQ 선정 위치로 안내한다', async () => {
    const page = admin.page;
    await page.goto(`${BASE_URL}/app/admin/pcb/cases/${String(specId)}?from=pos`, {
      waitUntil: 'domcontentloaded',
    });
    const trigger = page.getByRole('button', { name: '협력사 선정 필요', exact: true });
    await trigger.waitFor({ state: 'visible', timeout: 30_000 });
    await trigger.click();

    const alert = page.getByRole('alert').filter({ hasText: '발주 전에 협력사를 선정해 주세요' });
    await alert.waitFor({ state: 'visible', timeout: 30_000 });
    expect(
      await page.getByRole('dialog', { name: '발주서 발행' }).count(),
      '미선정 상태에서는 발주 모달을 열지 않는다',
    ).toBe(0);

    const selectButton = page.getByRole('button', { name: '선정', exact: true }).first();
    await selectButton.waitFor({ state: 'visible', timeout: 30_000 });
    await expect
      .poll(() => selectButton.evaluate((element) => document.activeElement === element), {
        message: '실제 다음 조치인 [선정] 버튼으로 포커스가 이동해야 한다',
      })
      .toBe(true);
  }, 60_000);

  test('선정 뒤 발주 모달은 선정 협력사를 읽기 전용으로 고정한다', async () => {
    await getPrisma().spPcbRfq.update({
      where: { id: rfqId },
      data: {
        status: 'selected',
        exchangeRate: 1400,
        krwAmount: 140_000,
        selectedAt: new Date(),
      },
    });

    const page = admin.page;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const trigger = page.getByRole('button', { name: '발주서 발행', exact: true });
    await trigger.waitFor({ state: 'visible', timeout: 30_000 });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: '발주서 발행' });
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    await expect.poll(() => dialog.getByText(partner.name, { exact: false }).count()).toBeGreaterThan(0);
    expect(await dialog.locator('select').count(), '협력사를 바꾸는 드롭다운이 없어야 한다').toBe(0);
  }, 60_000);
});
