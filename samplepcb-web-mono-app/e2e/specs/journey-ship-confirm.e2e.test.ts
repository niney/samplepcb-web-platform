// 협력사 '선적 완료' 확인(2026-10-11) — 국제 발송에서 받는 쪽이 '선적'을 진행한 뒤, 보내는 쪽이
// "실제로 넘겼다"를 남기고 자기 일을 끝낸다.
//
// 바뀌기 전: 국제 발송은 '선적'부터 끝까지 받는 쪽 단계라, 협력사 보내기 화면에 할 일 없는 건이 입고 확인까지
// 남아 있었다. 자사 주선(Case ID) 건은 실물이 운송사로 넘어갔는지가 어디에도 남지 않았다.
// 이 주행이 보는 것:
//   ① 선적 뒤 협력사 카드가 '선적 완료' 차례가 된다(스텝퍼의 가상 단계 · 버튼 · 내 차례 신호 · 메일의 다음 할 일)
//   ② 누르면 보내기에서 완료 내역으로 넘어가고, 받는 쪽에 한 번 알린다. 상태는 그대로 '선적'이다
//   ③ 국내도착·통관·완료는 협력사에게 흐리게 보여 주기만 하고, 그 단계의 메일은 가지 않는다
//   ④ 협력사가 안 눌러도 관리자는 넘길 수 있고, 넘기면 협력사 쪽은 끝난 것으로 본다(뒤늦은 확인은 막힌다)
//   ⑤ 관리자 대행(스위치를 켰을 때만) · 선적을 되돌리면 확인도 지워진다
//
// 실행: pnpm -F e2e e2e journey-ship-confirm
// 정리: 시드한 발주서·선적·발송 기록·메일(이 주행분)만 지운다. 무대 조직(e2e-선적확인)은 상설.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { translatePartnerMessage, type PartnerLocale, type PartnerMessages } from '../../apps/web/src/partner/i18n-core';
import { bomMessages } from '../../apps/web/src/partner/locales/bom';
import { childrenMessages } from '../../apps/web/src/partner/locales/children';
import { commonMessages } from '../../apps/web/src/partner/locales/common';
import { partsMessages } from '../../apps/web/src/partner/locales/parts';
import { pcbMessages } from '../../apps/web/src/partner/locales/pcb';
import { shipmentMessages } from '../../apps/web/src/partner/locales/shipment';
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
  gotoApp,
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

// 이 주행 전용 조직 — 보내기 보드의 건수를 정확히 세려면 다른 주행의 발송이 섞이지 않아야 한다.
const PARTNER = { mbId: 'e2e-shipconfirm', orgName: 'e2e-선적확인', country: 'CN', currency: 'USD' };
const SHOTS = join(monoRoot, '..', '.tmp', 'ship-confirm-shots');
const HANGUL = /[가-힣]/;
const CONFIRM = '선적 완료';

const partnerMessages: PartnerMessages = {
  ...childrenMessages, ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages,
};
const tr = (source: string, locale: PartnerLocale = 'ko', params?: Record<string, string | number>): string =>
  translatePartnerMessage(partnerMessages, source, locale, true, params);

const uploadShipFile = async (token: string, path: string, fileType: string, name: string): Promise<number> => {
  const form = new FormData();
  form.set('fileType', fileType);
  form.set('file', new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer], name));
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return res.status;
};

describe.skipIf(!RUN)("협력사 '선적 완료' 확인 — 국제 발송", () => {
  let partner: PartnerFixture;
  let A = '';
  let P = '';
  let mailpitUp = false;
  const startedAt = new Date();
  const poIds: bigint[] = [];
  const specs: { id: bigint; projectName: string }[] = [];
  const sessions: E2eSession[] = [];
  let portal: Page;
  let admin: Page;

  const po = (i: number): bigint => {
    const id = poIds[i];
    if (id === undefined) throw new Error('시드 없음');
    return id;
  };
  const spec = (i: number): { id: bigint; projectName: string } => {
    const s = specs[i];
    if (s === undefined) throw new Error('시드 없음');
    return s;
  };
  const shipmentOf = async (poId: bigint): Promise<any> => {
    const link = await getPrisma().spPcbShipmentPo.findFirst({ where: { poId } });
    return link === null ? null : getPrisma().spPcbShipment.findUnique({ where: { id: link.shipmentId } });
  };
  const mailLogs = async (specId: bigint, kind: string): Promise<any[]> =>
    getPrisma().spMailLog.findMany({ where: { kind, refType: 'pcb_spec', refId: String(specId), createdAt: { gte: startedAt } } });
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
  const adminBase = (i: number): string => `/api/admin/pcb-projects/${String(spec(i).id)}/pos/${String(po(i))}/shipment`;
  /** 협력사 — 담기 → 인보이스 → 선적 요청. 한 건씩 요청까지 올려야 다음 건이 같은 박스에 합류하지 않는다. */
  const request = async (i: number, caseRef: boolean): Promise<void> => {
    const box = await api(P, 'POST', '/api/partner/pcb-shipments/box', { poId: Number(po(i)) });
    expect(box.status, JSON.stringify(box.json)).toBe(200);
    expect(await uploadShipFile(P, `/api/partner/pcb-pos/${String(po(i))}/shipment/files`, 'invoice', 'inv.xlsx'), 'Invoice').toBe(200);
    const adv = await api(P, 'POST', `/api/partner/pcb-pos/${String(po(i))}/shipment/advance`, {
      shipDate: '2026-11-12',
      ...(caseRef ? { caseRefRequested: true } : {}),
    });
    expect(adv.status, `선적 요청: ${JSON.stringify(adv.json)}`).toBe(200);
  };
  const adminAdvance = async (i: number, body: Record<string, unknown> = {}): Promise<void> => {
    const res = await api(A, 'POST', `${adminBase(i)}/advance`, body);
    expect(res.status, `관리자 전이: ${JSON.stringify(res.json)}`).toBe(200);
  };
  const openBoard = async (): Promise<void> => {
    await gotoApp(portal, `/partner/pcb/ship?_t=${String(Date.now())}`);
    await portal.waitForLoadState('networkidle');
  };
  const openDone = async (): Promise<void> => {
    await gotoApp(portal, `/partner/pcb/shipments/done?_t=${String(Date.now())}`);
    await portal.waitForLoadState('networkidle');
  };
  const openCase = async (i: number): Promise<void> => {
    await admin.goto(`${BASE_URL}/app/admin/pcb/cases/${spec(i).id.toString()}?_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    await admin.locator('[data-ship-row]').first().waitFor({ state: 'visible', timeout: 30_000 });
  };
  const shot = async (page: Page, name: string): Promise<void> => {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  /** 발송 카드 — 발송 번호로 찾는다. */
  const card = async (i: number): Promise<Locator> => {
    const ship = await shipmentOf(po(i));
    return portal.locator(`[data-testid="pcb-ship-card"][data-shipment="${String(ship.id)}"]`);
  };
  const stepState = (scope: Locator, key: string): Promise<string | null> =>
    scope.locator(`[data-step="${key}"]`).getAttribute('data-step-state');
  const setLocale = async (locale: PartnerLocale): Promise<void> => {
    await portal.getByTestId('partner-language').selectOption(locale);
    await portal.waitForFunction((lang) => document.documentElement.lang === lang, locale);
  };

  beforeAll(async () => {
    partner = await ensureStagePartner(PARTNER);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: PARTNER.mbId, ttlSec: 3600 });
    mailpitUp = await fetch(`${MAILPIT_URL}/api/v1/info`).then((r) => r.ok).catch(() => false);
    const leftover = await getPrisma().spPcbPo.count({ where: { partnerId: partner.id } });
    if (leftover > 0) throw new Error(`${PARTNER.orgName} 에 기존 발주서 ${String(leftover)}건 — 앞선 주행의 잔재를 먼저 정리하세요`);
    for (const s of await pickFreeSpecs(3)) {
      const row = await createPcbPo({ specId: s.id, partnerId: partner.id, status: 'produced', currency: 'USD', priceOriginal: 100 });
      poIds.push(row.id);
      specs.push({ id: s.id, projectName: s.projectName });
    }
    const ps = await newSession({ mbId: PARTNER.mbId, ttlSec: 3600 }, { partnerModule: 'pcb' });
    const as = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    sessions.push(ps, as);
    portal = ps.page;
    admin = as.page;
  }, 120_000);

  afterAll(async () => {
    await cleanupPcbPos(poIds);
    await getPrisma().spMailLog.deleteMany({
      where: { refType: 'pcb_spec', refId: { in: specs.map((s) => String(s.id)) }, kind: { startsWith: 'pcb_ship' }, createdAt: { gte: startedAt } },
    });
    if (mailpitUp) await mailpitDelete((await mailsOfRun()).map((m) => String(m.ID)));
    expect(await countPcbResidue(poIds), '시드 잔재').toEqual({ pos: 0, shipments: 0, memberships: 0 });
    for (const s of sessions) await s.close().catch(() => undefined);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test("S1. 관리자가 선적하면 협력사 카드가 '선적 완료' 차례가 된다", async () => {
    await request(0, false);
    await adminAdvance(0); // 직접 발송 갈래 — 무입력 '선적'
    const ship = await shipmentOf(po(0));
    expect([ship.status, ship.shipConfirmedAt]).toEqual(['shipped', null]);

    // 내 차례 신호 — 발주 목록(홈·사이드바 배지의 원천)과 보내기 보드.
    const mine = ((await api(P, 'GET', '/api/partner/pcb-pos')).json?.data?.items ?? []).find((r: any) => r.poId === Number(po(0)));
    expect(mine?.myTurn, '발주 목록 — 내 차례').toBe(true);
    const board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect([board.active.length, board.doneCount], '보드 — 진행 1 · 완료 0').toEqual([1, 0]);

    // 선적 통지 메일이 다음 할 일을 말한다.
    const partnerMail = (partner.contactEmail ?? '').trim().toLowerCase();
    if (mailpitUp && partnerMail !== '') {
      await until("선적 통지 — 다음 단계 '선적 완료'", async () => {
        const hits = (await mailsOfRun()).filter((m) => (m.To ?? []).some((to: any) => String(to.Address).toLowerCase() === partnerMail));
        for (const hit of hits) {
          const html = String((await mailpitMessage(String(hit.ID)))?.HTML ?? '');
          if (html.includes(CONFIRM) && html.includes('다음 단계')) return true;
        }
        return false;
      });
    }

    await openBoard();
    const c = await card(0);
    await c.waitFor();
    // 스텝퍼 — '선적'은 끝났고 강조는 '선적 완료'에. 그 뒤는 받는 쪽 단계라 흐리게.
    expect(await stepState(c, 'shipped')).toBe('done');
    expect(await stepState(c, 'ship_confirm')).toBe('current');
    for (const key of ['arrived', 'customs', 'done']) expect(await stepState(c, key), key).toBe('theirs-todo');
    const order = await c.locator('[data-step]').evaluateAll((els) => els.map((el) => el.getAttribute('data-step')));
    expect(order, '단계 순서').toEqual(['preparing', 'requested', 'shipped', 'ship_confirm', 'arrived', 'customs', 'done']);
    expect(await c.getByTestId('pcb-ship-steps-note').innerText()).toContain('참고용');
    expect(await c.getByTestId('pcb-ship-confirm-button').innerText()).toContain(CONFIRM);
    expect(await c.innerText(), "'받는 쪽 처리를 기다리고 있습니다' 자리를 버튼이 대신한다").not.toContain(tr('{p0} 측 처리를 기다리고 있습니다.', 'ko', { p0: '샘플피씨비' }));
    await shot(portal, '01-confirm-pending');

    // 영어·중국어 — 확인 구역에 한글이 남지 않는다(받는 곳 이름은 자료).
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(locale);
      const text = (await c.getByTestId('pcb-ship-confirm').innerText()).split('샘플피씨비').join('');
      expect(text, `${locale} 한글 잔류`).not.toMatch(HANGUL);
      expect(await c.locator('[data-step="ship_confirm"]').innerText()).toBe(tr(CONFIRM, locale));
    }
    await setLocale('ko');
  });

  test('S2. 선적 완료를 누르면 완료 내역으로 넘어가고, 받는 쪽에 한 번 알린다', async () => {
    const c = await card(0);
    await c.getByTestId('pcb-ship-confirm-button').click();
    const box = portal.getByRole('alertdialog');
    await box.waitFor();
    expect(await box.innerText()).toContain('운송사에 넘겼습니까');
    await box.getByRole('button', { name: CONFIRM, exact: true }).click();
    await c.waitFor({ state: 'detached' });

    const ship = await shipmentOf(po(0));
    expect(ship.status, '상태는 그대로 — 사전에 없는 기록이다').toBe('shipped');
    expect([ship.shipConfirmedAt !== null, ship.shipConfirmedBy]).toEqual([true, 'PARTNER']);
    const board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect([board.active.length, board.doneCount], '보드 — 진행 0 · 완료 1').toEqual([0, 1]);
    const mine = ((await api(P, 'GET', '/api/partner/pcb-pos')).json?.data?.items ?? []).find((r: any) => r.poId === Number(po(0)));
    expect(mine?.myTurn, '내 차례 해제').toBe(false);

    // 받는 쪽 통지 — 한 통. 다시 눌러도(API) 처음 시각을 지키고 통지는 늘지 않는다.
    await until('확인 통지 기록', async () => (await mailLogs(spec(0).id, 'pcb_ship_confirmed')).length === 1);
    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(po(0))}/shipment/ship-confirm`, {});
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await mailLogs(spec(0).id, 'pcb_ship_confirmed')).length, '두 번 눌러도 한 통').toBe(1);
    expect((await shipmentOf(po(0))).shipConfirmedAt.getTime(), '처음 시각 유지').toBe(ship.shipConfirmedAt.getTime());

    // 완료 내역 — 읽기 전용 카드. 확인 시각이 보이고 버튼은 없다.
    await openDone();
    const done = await card(0);
    await done.waitFor();
    expect(await stepState(done, 'ship_confirm')).toBe('done');
    expect(await done.getByTestId('pcb-ship-confirmed').innerText()).toContain(tr('선적 완료 확인 {p0}', 'ko', { p0: '' }).trim());
    expect(await done.getByTestId('pcb-ship-confirm-button').count()).toBe(0);
    await shot(portal, '02-done-list');

    // 발주 상세 — 같은 단계, '보내기에서 진행' 안내는 걷힌다.
    await gotoApp(portal, `/partner/pcb/pos/${String(po(0))}`);
    const steps = portal.getByTestId('partner-po-ship-steps');
    await steps.waitFor({ timeout: 30_000 });
    expect(await stepState(steps, 'ship_confirm')).toBe('done');
    expect(await portal.getByTestId('partner-po-ship-confirmed').count()).toBe(1);
    expect(await portal.getByText(tr('📦 발송 진행·서류는 PCB 보내기에서 →')).count(), '끝난 발송에 진행 안내 없음').toBe(0);

    // 관리자 Case — 선적 줄에 확인이 보인다.
    await openCase(0);
    expect(await admin.locator('[data-ship-confirm="done"]').innerText()).toContain('협력사 선적 완료');
    await shot(admin, '03-admin-confirmed');
  });

  test('S3. 국내도착·통관·완료는 협력사에게 보여 주기만 한다 — 그 단계의 메일은 가지 않는다', async () => {
    for (const _step of ['arrived', 'customs', 'done']) await adminAdvance(0);
    expect((await shipmentOf(po(0))).status).toBe('done');
    await new Promise((resolve) => setTimeout(resolve, 800));
    const turns = await mailLogs(spec(0).id, 'pcb_shipment_turn');
    const statuses = turns.map((log: any) => String(log.params?.status));
    expect(statuses.filter((s) => ['arrived', 'customs', 'done'].includes(s)), `전이 통지 ${JSON.stringify(statuses)}`).toEqual([]);
    expect(statuses, '선적 통지는 나갔다').toContain('shipped');

    await openDone();
    const done = await card(0);
    await done.waitFor();
    expect([await stepState(done, 'arrived'), await stepState(done, 'customs'), await stepState(done, 'done')]).toEqual([
      'theirs-done',
      'theirs-done',
      'theirs-current',
    ]);
  });

  test('S4. 협력사가 안 눌러도 관리자는 넘길 수 있고, 넘기면 협력사 쪽은 끝난다', async () => {
    await request(1, false);
    await adminAdvance(1); // 선적
    let board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect(board.active.length, '선적 직후 — 협력사 차례로 진행 중').toBe(1);

    await adminAdvance(1); // 국내도착 — 협력사 확인을 기다리지 않는다
    const ship = await shipmentOf(po(1));
    expect([ship.status, ship.shipConfirmedAt]).toEqual(['arrived', null]);
    board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect([board.active.length, board.doneCount], '보드 — 진행 0 · 완료 2').toEqual([0, 2]);
    const mine = ((await api(P, 'GET', '/api/partner/pcb-pos')).json?.data?.items ?? []).find((r: any) => r.poId === Number(po(1)));
    expect(mine?.myTurn, '할 일로 남지 않는다').toBe(false);

    // 뒤늦은 확인은 막힌다(이미 다음 단계다).
    const late = await api(P, 'POST', `/api/partner/pcb-pos/${String(po(1))}/shipment/ship-confirm`, {});
    expect([late.status, late.json?.error]).toEqual([409, 'SHIP_CONFIRM_UNAVAILABLE']);

    await openDone();
    const done = await card(1);
    await done.waitFor();
    expect(await stepState(done, 'ship_confirm'), '확인이 없어도 지난 단계다').toBe('done');
    expect(await done.getByTestId('pcb-ship-confirmed').count(), '확인 기록은 없다(지어내지 않는다)').toBe(0);
    await openCase(1);
    expect(await admin.locator('[data-ship-confirm]').count(), '관리자 줄 — 대기도 완료도 아니다').toBe(0);
  });

  test('S5. Case ID 건 — 관리자 대행은 스위치를 켰을 때만, 선적을 되돌리면 확인도 지워진다', async () => {
    await request(2, true);
    expect(await uploadShipFile(A, `${adminBase(2)}/files`, 'airwaybill', 'awb.pdf'), 'AWB').toBe(200);
    await adminAdvance(2, { caseRef: 'KR-CONFIRM-1', carrier: 'DHL', trackingNumber: 'E2E-AWB-CONFIRM' });

    // 협력사 — Case ID 건의 안내 문구(라벨링·인계).
    await openBoard();
    const c = await card(2);
    await c.waitFor();
    expect(await c.getByTestId('pcb-ship-confirm').innerText()).toContain(tr('라벨을 붙여 운송사에 넘겼으면 선적 완료를 눌러 주세요.'));

    // 관리자 — 대기 표시. 대행 버튼은 [협력사 대행 동작 보기]를 켜야 나온다.
    await openCase(2);
    expect(await admin.locator('[data-ship-confirm="pending"]').innerText()).toContain('협력사 선적 완료 대기');
    expect(await admin.locator('[data-ship-confirm-proxy]').count(), '기본은 숨김').toBe(0);
    await admin.locator('[data-pcb-proxy-switch]').click();
    await admin.locator('[data-ship-confirm-proxy]').click();
    const box = admin.getByRole('alertdialog');
    await box.waitFor();
    await box.getByRole('button', { name: '선적 완료 대행', exact: true }).click();
    await admin.locator('[data-ship-confirm="done"]').waitFor();
    expect(await admin.locator('[data-ship-confirm="done"]').innerText()).toContain('(대행)');
    let ship = await shipmentOf(po(2));
    expect([ship.shipConfirmedAt !== null, ship.shipConfirmedBy, ship.status]).toEqual([true, 'ADMIN', 'shipped']);
    expect((await mailLogs(spec(2).id, 'pcb_ship_confirmed')).length, '대행은 받는 쪽 통지가 없다').toBe(0);
    let board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect(board.active.length, '협력사 보드에서 빠진다').toBe(0);
    await shot(admin, '04-admin-proxy');

    // 선적을 되돌리면 확인도 없던 일이 된다.
    const revert = await api(A, 'POST', `${adminBase(2)}/revert`, {});
    expect(revert.status, JSON.stringify(revert.json)).toBe(200);
    ship = await shipmentOf(po(2));
    expect([ship.status, ship.shipConfirmedAt, ship.shipConfirmedBy]).toEqual(['requested', null, null]);
    board = (await api(P, 'GET', '/api/partner/pcb-shipments')).json?.data;
    expect(board.active.length, '다시 진행 중으로').toBe(1);
    expect(sessions.flatMap((s) => s.pageErrors), '화면 오류 없음').toEqual([]);
  });
});
