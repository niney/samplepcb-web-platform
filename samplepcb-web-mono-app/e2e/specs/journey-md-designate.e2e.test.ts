// 여정 — **마스터딜러 지정**(하위 협력사가 없어도 관리자가 처음부터 마스터딜러로 만든다).
//
// 그전에는 "하위 소속 링크가 하나라도 있으면 마스터딜러"라는 파생 판정뿐이었다. 이제 조직에 표시
// (`sp_partner.isMasterDealer`)가 있고 그것이 역할의 정본이다(docs/PARTNER_PORTAL.md "마스터딜러 지정"):
//   ① 관리자가 등록 화면에서 '마스터딜러'를 켜고 만든다 — 하위 0명이어도 목록·상세·필터에 마스터딜러.
//   ② 지정된 조직은 하위 후보에서 빠지고, 하위로 연결하려 하면 거절된다(2단 제한).
//   ③ 포털 하위 협력사 화면은 하위 0명이어도 마스터딜러 안내를 띄운다.
//   ④ 포털에서 첫 하위를 등록해도 지정은 그대로, 하위가 있는 동안에는 지정을 끌 수 없다.
//   ⑤ 지정 없이 포털에서 첫 하위를 등록한 조직은 그 순간 마스터딜러가 된다.
//
// 무대는 이 편이 만들고 지우는 조직뿐(공유 DB) — 이름 접두사 `e2e-mdd-`.
// 실행: pnpm -F e2e journey:mddesignate  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newSession,
  signJwt,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const PREFIX = 'e2e-mdd-';
const ACT_AS = 'x-sp-act-as-partner';

async function actAs(
  token: string,
  partnerId: number,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [ACT_AS]: String(partnerId),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없는 응답 */
  }
  return { status: res.status, json };
}

describe.skipIf(!RUN || !JOURNEY)('여정 — 마스터딜러 지정', () => {
  const admin = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3_600 });

  const cleanup = async (): Promise<void> => {
    const prisma = getPrisma();
    const rows = await prisma.spPartner.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    await prisma.spPartnerRelation.deleteMany({
      where: { OR: [{ parentPartnerId: { in: ids } }, { childPartnerId: { in: ids } }] },
    });
    await prisma.spPartnerActLog.deleteMany({ where: { partnerId: { in: ids } } });
    await prisma.spMailLog.deleteMany({
      where: { refType: 'partner', refId: { in: ids.map((id) => id.toString()) } },
    });
    // 하위(소유 조직)를 먼저 — 소유 FK 는 SetNull 이지만 순서를 지켜 둔다.
    await prisma.spPartner.deleteMany({ where: { id: { in: ids }, NOT: { ownerPartnerId: null } } });
    await prisma.spPartner.deleteMany({ where: { id: { in: ids } } });
  };

  const create = async (name: string, isMasterDealer: boolean): Promise<number> => {
    const res = await api(admin, 'POST', '/api/admin/partners', {
      type: 'partner',
      name: `${PREFIX}${name}`,
      country: 'KR',
      capabilities: ['pcb_rfq', 'bom_rfq'],
      isMasterDealer,
    });
    expect(res.status).toBe(200);
    return res.json.data.partnerId as number;
  };

  beforeAll(cleanup, 60_000);
  afterAll(async () => {
    await cleanup();
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  let mdId = 0;
  let plainId = 0;

  test('M01. 하위 없이 마스터딜러로 등록 — 상세·목록 필터·표시', async () => {
    mdId = await create('지정딜러', true);
    plainId = await create('일반협력', false);

    const detail = await api(admin, 'GET', `/api/admin/partners/${String(mdId)}`);
    expect(detail.json.data.isMasterDealer).toBe(true);

    const list = await api(admin, 'GET', `/api/admin/partners?role=md&q=${encodeURIComponent(PREFIX)}`);
    const names = list.json.data.items.map((p: any) => p.name);
    expect(names).toContain(`${PREFIX}지정딜러`);
    expect(names).not.toContain(`${PREFIX}일반협력`);

    // 공급사에는 지정할 수 없다.
    const bad = await api(admin, 'POST', '/api/admin/partners', {
      type: 'supplier',
      name: `${PREFIX}공급사`,
      supplierCode: 'e2emddsup',
      isMasterDealer: true,
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('NOT_PARTNER_TYPE');
  });

  test('M02. 지정된 조직은 하위 후보에서 빠지고, 하위로 연결할 수 없다', async () => {
    const rel = await api(admin, 'GET', `/api/admin/partners/${String(plainId)}/relations`);
    const candidateIds = rel.json.data.candidates.map((c: any) => c.partnerId);
    expect(candidateIds).not.toContain(mdId);

    const link = await api(admin, 'POST', `/api/admin/partners/${String(plainId)}/relations`, {
      childPartnerId: mdId,
    });
    expect(link.status).toBe(400);
    expect(link.json.error).toBe('CHILD_IS_MD');
  });

  test('M03. 포털 — 하위 0명이어도 마스터딜러 안내, 등록이 열려 있다', async () => {
    const res = await actAs(admin, mdId, 'GET', '/api/partner/children');
    expect(res.status).toBe(200);
    expect(res.json.data.isMasterDealer).toBe(true);
    expect(res.json.data.items).toHaveLength(0);
    expect(res.json.data.eligibility.allowed).toBe(true);

    const s = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    await s.page.goto(`${BASE_URL}/app/partner/children?actAs=${String(mdId)}`, { waitUntil: 'domcontentloaded' });
    await s.page.getByTestId('partner-child-md-onboarding').waitFor({ timeout: 15_000 });
    expect(s.pageErrors).toEqual([]);
    await s.close();
  });

  test('M04. 첫 하위 등록 뒤에도 지정 유지 — 하위가 있으면 끌 수 없고, 없어지면 끈다', async () => {
    const reg = await actAs(admin, mdId, 'POST', '/api/partner/children', {
      name: `${PREFIX}하위1`,
      country: 'CN',
      settlementCurrency: 'USD',
    });
    expect(reg.status).toBe(200);
    const childId = reg.json.data.items[0].partnerId as number;

    const off = await api(admin, 'PUT', `/api/admin/partners/${String(mdId)}`, { isMasterDealer: false });
    expect(off.status).toBe(409);
    expect(off.json.error).toBe('HAS_CHILDREN');

    // 하위를 지우면(이력 없음 → 진짜 삭제) 지정을 끌 수 있다.
    const del = await actAs(admin, mdId, 'DELETE', `/api/partner/children/${String(childId)}`);
    expect(del.status).toBe(200);
    expect(del.json.data.outcome).toBe('deleted');
    const off2 = await api(admin, 'PUT', `/api/admin/partners/${String(mdId)}`, { isMasterDealer: false });
    expect(off2.status).toBe(200);
    expect(off2.json.data.isMasterDealer).toBe(false);
  });

  test('M05. 지정 없이 포털에서 첫 하위를 등록하면 그 순간 마스터딜러가 된다', async () => {
    const before = await api(admin, 'GET', `/api/admin/partners/${String(plainId)}`);
    expect(before.json.data.isMasterDealer).toBe(false);
    const reg = await actAs(admin, plainId, 'POST', '/api/partner/children', {
      name: `${PREFIX}하위2`,
      country: 'KR',
      settlementCurrency: 'KRW',
    });
    expect(reg.status).toBe(200);
    expect(reg.json.data.isMasterDealer).toBe(true);
    const after = await api(admin, 'GET', `/api/admin/partners/${String(plainId)}`);
    expect(after.json.data.isMasterDealer).toBe(true);
  });

  test('M06. 관리자 화면 — 등록 대화상자의 마스터딜러 체크로 만든다', async () => {
    const s = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const page = s.page;
    await page.goto(`${BASE_URL}/app/admin/partners`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '파트너 등록' }).click();
    // 등록 뒤 상세 서랍(역시 dialog)이 열린다 — 이름으로 좁힌다.
    const dialog = page.getByRole('dialog', { name: '파트너 등록' });
    await dialog.locator('#partner-create-name').fill(`${PREFIX}화면등록`);
    await dialog.locator('#partner-create-country').fill('KR');
    await dialog.getByTestId('partner-master-dealer').click();
    await dialog.getByRole('button', { name: /등록\(즉시 승인\)/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

    const prisma = getPrisma();
    const row = await prisma.spPartner.findFirst({ where: { name: `${PREFIX}화면등록` } });
    expect(row?.isMasterDealer).toBe(true);

    // 상세 서랍의 마스터딜러 배지 → 닫고 목록 배지·필터
    await page.getByRole('dialog', { name: '파트너 상세' }).getByText('마스터딜러', { exact: true }).first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '파트너 상세' }).waitFor({ state: 'hidden' });
    await page.getByTestId('partner-role-md').click();
    await page.getByRole('row', { name: new RegExp(`${PREFIX}화면등록`) }).getByText('마스터딜러', { exact: true }).waitFor();
    expect(s.pageErrors).toEqual([]);
    await s.close();
  }, 60_000);

  test('M07. 관리자 화면 — 하위가 연결된 마스터딜러는 체크를 끌 수 없게 잠긴다', async () => {
    // M05 에서 일반협력이 포털로 하위를 등록해 마스터딜러가 됐다.
    const s = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    const page = s.page;
    await page.goto(`${BASE_URL}/app/admin/partners`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('row', { name: new RegExp(`${PREFIX}일반협력`) }).click();
    const sheet = page.getByRole('dialog', { name: '파트너 상세' });
    const box = sheet.getByTestId('partner-master-dealer');
    await expect.poll(async () => box.isDisabled(), { timeout: 15_000 }).toBe(true);
    expect(await box.getAttribute('data-state')).toBe('checked');
    expect(s.pageErrors).toEqual([]);
    await s.close();
  }, 60_000);
});
