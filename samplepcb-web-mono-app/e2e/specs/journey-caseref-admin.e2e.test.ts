// 발송 참조번호(Case ID) 갈래 — 관리자 Case 화면의 선적 줄(2026-10-11 정리)을 화면으로 따라간다.
//
// 정리 전에는 윗줄의 [선적 진행]과 [Case ID 입력]이 같은 값을 따로 물었고, [Case ID 입력]만 누르면
// 협력사에게 "이 번호로 발송을 진행하고 운송장 번호를 입력해 주세요"가 나갔다 — 이 갈래에서 운송장은
// 관리자 몫이라 협력사가 할 수 없는 일이다. 이 주행이 보는 것:
//   ① 처리 스트립이 유일한 작업 자리다 — 윗줄에 [선적 진행]·[Case ID 입력]·[송장]이 없다
//   ② 순서가 보인다 — ③ 은 운송서류를 붙이기 전까지 잠겨 있고 이유를 말한다
//   ③ 운송수단은 ② 에서 정한다(붙이는 서류가 곧 수단) — 마지막 창은 묻지 않는다
//   ④ 협력사 통지는 선적 때 한 번(Case ID·운송장 동봉). 발송 전 단독 입력은 메일이 없다
//   ⑤ 발송 뒤에는 [Case ID 정정]만 남고, 값이 바뀔 때만 정정 메일이 나간다
//
// 실행: pnpm -F e2e e2e journey-caseref-admin
// 정리: 시드한 발주서·선적·발송 기록·메일(이 주행분)만 지운다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  MAILPIT_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  countPcbResidue,
  createPcbPo,
  disconnectPrisma,
  ensureStagePartner,
  getPrisma,
  mailpitDelete,
  mailpitList,
  mailpitMessage,
  monoRoot,
  newSession,
  pickFreeSpecs,
  signJwt,
  type E2eSession,
  type PartnerFixture,
} from '../helpers';

const PARTNER = { mbId: 'e2e-mdsub2', orgName: '협력2', country: 'CN', currency: 'USD' }; // CN — 국제 체인
const SHOTS = join(monoRoot, '..', '.tmp', 'caseref-admin-shots');
const NOTE = 'DHL 착불 계정번호가 필요합니다';
const CASE_REF = 'KR-IMP-1011-A';
const CASE_REF_FIXED = 'KR-IMP-1011-A2';
const TRACKING = 'E2E-AWB-10110001';

const uploadShipFile = async (token: string, path: string, fileType: string, name: string): Promise<number> => {
  const form = new FormData();
  form.set('fileType', fileType);
  form.set('file', new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer], name));
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return res.status;
};

describe.skipIf(!RUN)('Case ID 갈래 — 관리자 선적 줄의 순차 처리', () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let mailpitUp = false;
  const startedAt = new Date();
  const poIds: bigint[] = [];
  const specs: { id: bigint; projectName: string }[] = [];
  let admin: E2eSession;
  let page: Page;

  const shipmentOf = async (poId: bigint): Promise<any> => {
    const link = await getPrisma().spPcbShipmentPo.findFirst({ where: { poId } });
    return link === null ? null : getPrisma().spPcbShipment.findUnique({ where: { id: link.shipmentId } });
  };
  const mailLogs = async (specId: bigint, kind: string): Promise<any[]> =>
    getPrisma().spMailLog.findMany({ where: { kind, refType: 'pcb_spec', refId: String(specId), createdAt: { gte: startedAt } } });
  /** 이 주행이 만든 메일 — 제목 검색은 쓰지 않는다(빌려 쓰는 스펙 이름에 따옴표가 있으면 검색식이 깨진다). */
  const mailsOfRun = async (): Promise<any[]> =>
    (((await mailpitList(200))?.messages ?? []) as any[]).filter(
      (m) => specs.some((s) => String(m.Subject).includes(s.projectName)) && new Date(String(m.Created)).getTime() >= startedAt.getTime() - 2_000,
    );
  const until = async (label: string, fn: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await fn()) return;
      if (Date.now() > deadline) throw new Error(`대기 초과: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };
  /** 협력사 쪽 준비 — 담기 → 인보이스 → 선적 요청(+Case ID 체크). */
  const requestWithCaseRef = async (poId: bigint): Promise<void> => {
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(poId) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    expect(await uploadShipFile(P, `/api/partner/pcb-pos/${String(poId)}/shipment/files`, 'invoice', 'inv.xlsx'), 'Invoice').toBe(200);
    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/shipment/advance`, {
      shipDate: '2026-11-12',
      caseRefRequested: true,
      caseRefNote: NOTE,
    });
    expect(adv.status, `선적 요청+체크: ${JSON.stringify(adv.json)}`).toBe(200);
  };
  const openCase = async (specId: bigint): Promise<void> => {
    await page.goto(`${BASE_URL}/app/admin/pcb/cases/${specId.toString()}?_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-ship-row]').first().waitFor({ state: 'visible', timeout: 30_000 });
  };
  const shot = async (name: string): Promise<void> => {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  const strip = (): Locator => page.locator('[data-caseref-strip]');
  const step = (name: 'invoice' | 'doc' | 'ship'): Locator => strip().locator(`[data-caseref-step="${name}"]`);
  const shipBtn = (): Locator => strip().locator('[data-caseref-ship]');
  /** 선적 줄(스트립을 품은 표 줄) — 윗줄 버튼을 여기서 센다. */
  const shipCell = (): Locator => page.locator('[data-ship-row]').first();
  const button = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true });
  const dialog = (): Locator => page.getByRole('dialog');
  const attach = async (trigger: Locator, name: string): Promise<void> => {
    const chooser = page.waitForEvent('filechooser');
    await trigger.click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  };

  beforeAll(async () => {
    partner = await ensureStagePartner(PARTNER);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: PARTNER.mbId, ttlSec: 3600 });
    mailpitUp = await fetch(`${MAILPIT_URL}/api/v1/info`).then((r) => r.ok).catch(() => false);
    for (const spec of await pickFreeSpecs(2)) {
      const po = await createPcbPo({ specId: spec.id, partnerId: partner.id, status: 'produced', currency: 'USD', priceOriginal: 100 });
      poIds.push(po.id);
      specs.push({ id: spec.id, projectName: spec.projectName });
    }
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    page = admin.page;
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    await getPrisma().spMailLog.deleteMany({
      where: { refType: 'pcb_spec', refId: { in: specs.map((s) => String(s.id)) }, kind: { startsWith: 'pcb_ship' }, createdAt: { gte: startedAt } },
    });
    if (mailpitUp) await mailpitDelete((await mailsOfRun()).map((m) => String(m.ID)));
    expect(await countPcbResidue(poIds), '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    await admin.close().catch(() => undefined);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('R1. 스트립이 유일한 작업 자리 — 윗줄에 같은 일을 하는 버튼이 없고, ③ 은 잠겨 이유를 말한다', async () => {
    const [poId] = poIds;
    const [spec] = specs;
    if (poId === undefined || spec === undefined) throw new Error('시드 없음');
    await requestWithCaseRef(poId);
    await openCase(spec.id);
    await strip().waitFor();

    // 윗줄 — 상태·되돌리기만. 같은 값을 묻던 두 버튼과 송장(생성기)은 스트립으로 들어갔다.
    for (const name of ['선적 진행', 'Case ID 입력', 'Case ID 정정', '송장']) {
      expect(await button(shipCell(), name).count(), `윗줄 [${name}]`).toBe(0);
    }
    expect(await button(shipCell(), '되돌리기').count(), '되돌리기는 남는다').toBe(1);
    expect(await shipCell().innerText()).toContain('Case ID 요청');
    expect(await strip().locator('[data-caseref-note]').innerText()).toContain(NOTE);

    // 세 단계가 순서대로(왼쪽 → 오른쪽) 서 있다.
    const xs = await Promise.all((['invoice', 'doc', 'ship'] as const).map((name) => step(name).boundingBox().then((box) => box?.x ?? Number.NaN)));
    expect([...xs].sort((a, b) => a - b), `가로 순서 ${JSON.stringify(xs)}`).toEqual(xs);
    expect(await step('invoice').innerText()).toContain('(선택)');
    expect(await button(step('invoice'), '생성기').count(), '생성기는 ① 안에').toBe(1);
    expect(await step('doc').innerText()).toContain('AWB 필요');

    // ③ — 운송서류 전에는 잠겨 있고 이유를 말한다(눌러 보고 409 로 배우지 않는다).
    expect(await shipBtn().isDisabled(), '③ 잠김').toBe(true);
    expect(await strip().locator('[data-caseref-ship-lock]').innerText()).toContain('AWB 를 먼저 첨부');

    // 운송수단은 ② 에서 — 해상으로 바꾸면 필요한 서류와 ③ 의 이유가 함께 바뀐다.
    await step('doc').locator('[data-caseref-transport="sea"]').click();
    expect(await step('doc').innerText()).toContain('B/L 필요');
    expect(await strip().locator('[data-caseref-ship-lock]').innerText()).toContain('B/L 를 먼저 첨부');
    await step('doc').locator('[data-caseref-transport="air"]').click();
    expect(await step('doc').innerText()).toContain('AWB 필요');
    await shot('01-locked');
  });

  test('R2. ② 를 붙이면 ③ 이 열리고, 입력 한 번으로 선적 — 협력사 메일은 그때 한 번', async () => {
    const [poId] = poIds;
    const [spec] = specs;
    if (poId === undefined || spec === undefined) throw new Error('시드 없음');

    await attach(step('doc').locator('[data-caseref-doc-upload]'), 'awb.pdf');
    await page.waitForFunction(() => document.querySelector('[data-caseref-step="doc"]')?.hasAttribute('data-step-done') === true);
    expect(await strip().locator('[data-caseref-ship-lock]').count(), '이유가 사라진다').toBe(0);
    expect(await shipBtn().isDisabled(), '③ 열림').toBe(false);
    expect((await mailLogs(spec.id, 'pcb_ship_caseref')).length, '아직 협력사에게 Case ID 메일은 없다').toBe(0);
    await shot('02-ready');

    await shipBtn().click();
    await dialog().waitFor();
    expect(await dialog().innerText()).toContain('Case ID·운송장 입력');
    expect(await dialog().innerText(), '운송수단은 설명에 고정값으로').toContain('운송수단 항공');
    expect(await dialog().getByLabel('운송수단').count(), '마지막 창은 운송수단을 묻지 않는다').toBe(0);
    expect(await dialog().innerText()).toContain(`협력사 요청 메모: ${NOTE}`);
    await dialog().getByLabel('발송 참조번호(Case ID)').fill(CASE_REF);
    await dialog().getByLabel('운송회사').selectOption('DHL');
    await dialog().getByLabel('트래킹 번호(AWB)').fill(TRACKING);
    await shot('03-dialog');
    await button(dialog(), '선적 진행').click();
    await dialog().waitFor({ state: 'hidden' });
    await strip().waitFor({ state: 'detached' });

    const ship = await shipmentOf(poId);
    expect([ship.status, ship.caseRef, ship.transport, ship.carrier, ship.trackingNumber]).toEqual(['shipped', CASE_REF, 'air', 'DHL', TRACKING]);

    // 발송 뒤 — 스트립은 걷히고, 윗줄에는 정정 버튼만 남는다.
    expect(await shipCell().innerText()).toContain(CASE_REF);
    expect(await button(shipCell(), 'Case ID 정정').count(), '[Case ID 정정]').toBe(1);
    expect(await button(shipCell(), 'Case ID 입력').count()).toBe(0);
    expect(await button(shipCell(), '송장').count(), '스트립이 걷히면 송장은 윗줄로').toBe(1);

    // 통지 — 선적 때 한 번, Case ID 를 싣고. 단독 안내 메일(pcb_ship_caseref)은 없다.
    expect((await mailLogs(spec.id, 'pcb_ship_caseref')).length, 'Case ID 단독 메일 없음').toBe(0);
    const partnerMail = (partner.contactEmail ?? '').trim().toLowerCase();
    if (mailpitUp && partnerMail !== '') {
      let withRef = 0;
      await until('선적 통지 메일', async () => {
        const hits = (await mailsOfRun()).filter(
          (m) => String(m.Subject).includes(spec.projectName) && (m.To ?? []).some((to: any) => String(to.Address).toLowerCase() === partnerMail),
        );
        withRef = 0;
        for (const hit of hits) {
          if (String((await mailpitMessage(String(hit.ID)))?.HTML ?? '').includes(CASE_REF)) withRef += 1;
        }
        return withRef > 0;
      });
      expect(withRef, 'Case ID 를 실은 메일은 한 통').toBe(1);
    }
    await shot('04-shipped');
  });

  test('R3. 발송 뒤 정정 — 값이 바뀔 때만 정정 메일이 나간다', async () => {
    const [poId] = poIds;
    const [spec] = specs;
    if (poId === undefined || spec === undefined) throw new Error('시드 없음');

    await button(shipCell(), 'Case ID 정정').click();
    await dialog().waitFor();
    expect(await dialog().innerText()).toContain('발송 참조번호(Case ID) 정정');
    expect(await dialog().innerText()).toContain('발송 뒤 정정입니다');
    const input = dialog().getByLabel('발송 참조번호(Case ID)');
    expect(await input.inputValue(), '지금 값이 채워져 있다').toBe(CASE_REF);
    await input.fill(CASE_REF_FIXED);
    await button(dialog(), '정정').click();
    await dialog().waitFor({ state: 'hidden' });
    expect((await shipmentOf(poId)).caseRef).toBe(CASE_REF_FIXED);
    await until('정정 메일 기록', async () => (await mailLogs(spec.id, 'pcb_ship_caseref')).length === 1);
    const [log] = await mailLogs(spec.id, 'pcb_ship_caseref');
    expect(String(log.subject), '제목이 정정을 말한다').toContain('발송 참조번호(Case ID) 정정');

    // 같은 값으로 다시 저장 — 바뀐 것이 없으니 메일도 없다.
    const same = await api(A, 'POST', `/api/admin/pcb-projects/${String(spec.id)}/pos/${String(poId)}/shipment/case-ref`, { caseRef: CASE_REF_FIXED });
    expect(same.status, JSON.stringify(same.json)).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await mailLogs(spec.id, 'pcb_ship_caseref')).length, '같은 값은 통지하지 않는다').toBe(1);
  });

  test('R4. 해상 — ② 에서 B/L 을 고르면 그 값이 선적까지 간다. 발송 전 단독 입력은 메일이 없다', async () => {
    const poId = poIds[1];
    const spec = specs[1];
    if (poId === undefined || spec === undefined) throw new Error('시드 없음');
    await requestWithCaseRef(poId);

    // 발송 전 단독 입력(API — 화면에는 이 길이 없다): 값은 적히지만 협력사 메일은 나가지 않는다.
    const early = await api(A, 'POST', `/api/admin/pcb-projects/${String(spec.id)}/pos/${String(poId)}/shipment/case-ref`, { caseRef: 'KR-SEA-EARLY' });
    expect(early.status, JSON.stringify(early.json)).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await mailLogs(spec.id, 'pcb_ship_caseref')).length, '발송 전 단독 입력은 통지하지 않는다').toBe(0);

    await openCase(spec.id);
    await strip().waitFor();
    expect(await step('ship').innerText(), '적어 둔 값이 보인다').toContain('KR-SEA-EARLY');
    // 값이 먼저 적혀도 순서는 그대로다 — 운송서류 전에는 ③ 이 잠겨 있다.
    expect(await shipBtn().isDisabled()).toBe(true);

    await step('doc').locator('[data-caseref-transport="sea"]').click();
    await attach(step('doc').locator('[data-caseref-doc-upload]'), 'bl.pdf');
    await page.waitForFunction(() => document.querySelector('[data-caseref-step="doc"]')?.hasAttribute('data-step-done') === true);
    expect(await step('doc').innerText()).toContain('B/L');

    // 새로 열어도 해상이다 — 붙어 있는 서류에서 되짚는다(박제값은 아직 협력사가 적은 항공).
    expect((await shipmentOf(poId)).transport ?? 'air', '아직 박제 전').toBe('air');
    await openCase(spec.id);
    await strip().waitFor();
    expect(await step('doc').locator('[data-caseref-transport="sea"]').getAttribute('aria-pressed')).toBe('true');
    expect(await shipBtn().isDisabled(), '③ 열림').toBe(false);

    await shipBtn().click();
    await dialog().waitFor();
    expect(await dialog().innerText()).toContain('운송수단 해상');
    expect(await dialog().getByLabel('발송 참조번호(Case ID)').inputValue(), '적어 둔 값이 채워진다').toBe('KR-SEA-EARLY');
    // 해상은 포워더를 바로 적는다(프리셋 셀렉트가 아니다).
    await dialog().getByLabel('선사·포워더').fill('E2E Forwarding');
    await dialog().getByLabel('트래킹 번호(B/L)').fill('E2E-BL-10110002');
    await shot('05-sea-dialog');
    await button(dialog(), '선적 진행').click();
    await dialog().waitFor({ state: 'hidden' });
    await strip().waitFor({ state: 'detached' });
    const ship = await shipmentOf(poId);
    expect([ship.status, ship.transport, ship.caseRef, ship.trackingNumber]).toEqual(['shipped', 'sea', 'KR-SEA-EARLY', 'E2E-BL-10110002']);
    expect(ship.carrier).toBe('E2E Forwarding');
    expect(admin.pageErrors, '화면 오류 없음').toEqual([]);
  });
});
