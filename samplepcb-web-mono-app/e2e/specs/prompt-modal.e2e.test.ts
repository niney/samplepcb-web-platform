// window.prompt 를 대신한 입력 모달(UiPromptModal)이 실제로 뜨는지 — 관리자 Case 의
// EQ 반려·입고 확인 두 자리를 실 화면에서 연다. prompt 였다면 브라우저 대화상자라
// DOM 에 흔적이 없다: 모달 요소가 보인다는 것 자체가 교체의 증거다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  RUN,
  cleanupPcbPos,
  closeBrowser,
  createPcbPo,
  disconnectPrisma,
  getPartner,
  getPrisma,
  gotoApp,
  newSession,
  num,
  pickFreeSpecs,
  snap,
  type E2eSession,
} from '../helpers';

describe.skipIf(!RUN)('입력 모달(UiPromptModal) — prompt 대체', () => {
  let admin: E2eSession;
  let poId: bigint | null = null;
  let specId: bigint | null = null;
  const createdPoIds: bigint[] = [];

  beforeAll(async () => {
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const partner = await getPartner('협력2');
    // EQ 반려 버튼이 보이려면 발주가 eq_requested 여야 한다 — 시드로 그 상태를 만든다.
    const [spec] = await pickFreeSpecs(1);
    const po = await createPcbPo({
      specId: spec.id,
      partnerId: partner.id,
      status: 'eq_requested',
    });
    poId = po.id;
    specId = po.specId;
    createdPoIds.push(po.id);
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(createdPoIds);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('EQ [반려]가 모달을 연다 — 사유 없이는 확인이 잠긴다', async (ctx) => {
    if (specId === null) return ctx.skip();
    const page = admin.page;
    await gotoApp(page, `/admin/pcb/cases/${String(num(specId))}`); // gotoApp 이 /app 을 붙인다
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await snap(page, 'prompt-modal/case-open');

    const rejectBtn = page.getByRole('button', { name: '반려', exact: true }).first();
    await rejectBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await rejectBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await dialog.getByText('EQ 반려 —').isVisible(), '모달 제목').toBe(true);
    await snap(page, 'prompt-modal/eq-reject');

    // 필수값이 비면 확인 버튼이 잠겨 있어야 한다(prompt 로는 못 하던 것).
    const confirm = dialog.getByRole('button', { name: '반려하고 알리기' });
    expect(await confirm.isDisabled(), '사유 없이 확인').toBe(true);
    await dialog.locator('textarea').fill('실크 위치 확인 부탁드립니다');
    expect(await confirm.isEnabled(), '사유 입력 후 확인').toBe(true);

    // 취소로 닫아도 화면이 그대로여야 한다(반려는 실행하지 않는다).
    await dialog.getByRole('button', { name: '취소' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  }, 120_000);

  test('Esc 로 닫힌다', async (ctx) => {
    if (specId === null) return ctx.skip();
    const page = admin.page;
    const rejectBtn = page.getByRole('button', { name: '반려', exact: true }).first();
    await rejectBtn.click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  }, 60_000);

  test('반려 사유가 서버까지 간다', async (ctx) => {
    if (specId === null || poId === null) return ctx.skip();
    const page = admin.page;
    await page.getByRole('button', { name: '반려', exact: true }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.locator('textarea').fill('[모달 검증] 실크 위치를 좌측으로');
    await dialog.getByRole('button', { name: '반려하고 알리기' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

    const prisma = getPrisma();
    const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
    expect(po?.status, '반려 후 발주 상태').toBe('issued');
    const history = Array.isArray(po?.eqHistory) ? (po.eqHistory as any[]) : [];
    expect(history.at(-1)?.note, '반려 사유 기록').toBe('[모달 검증] 실크 위치를 좌측으로');
  }, 120_000);
});
