// 추가 EQ 요청 — **관리자 화면**(D20 후속 R-1·R-2·R-4).
//
// 예전엔 관리자가 [협력사에 전달]을 빠뜨린 채 승인하면 공장이 고객 답을 모른 채 생산에 들어갔고, 승인 뒤
// 협력사가 더 물을 것이 생기면 관리자가 승인 취소 → 반려를 대신 눌러 줘야 했다. 이제 승인이 회신을 함께
// 전달하고(R-1), 협력사는 생산 시작 전까지 사유와 함께 EQ 를 다시 연다(R-2, eq_done → issued).
// 이 주행은 그 흐름이 **관리자 Case·워크큐·EQ 작업공간에서 읽히는지**를 본다(포털 쪽은 journey-eq-reopen-portal).
//
// 표적:
//   ① 승인 확인창 — "전달하지 않고 승인?"으로 되묻지 않고 "승인하면 고객 회신이 협력사에 함께 전달됩니다"를
//      알린다(Case 행 [EQ 승인]·작업공간 [고객 회신대로 EQ 승인] 같은 문구). 승인 뒤 칩은 '전달됨'.
//   ② 협력사 추가 EQ 요청 → 발주접수로 돌아온 행에 '추가 EQ 요청 날짜' 배지(주의색, '반려됨' 아님) + 사유 인용,
//      워크큐 '협력사 진행' 탭에도 같은 배지.
//   ③ 새 파일 없이 다시 승인요청 → 승인 버튼 옆 "추가 EQ 요청 후 새 파일 없음"(반려 문구가 아니다).
//   ④ 작업공간 — 새 회차 카드와 초안 머리에 "협력사 추가 EQ 요청: {사유}", 활동 탭에 '추가 EQ 요청'.
//   ⑤ 관리자 대행 — eq_done 행의 [추가 EQ 요청(대행)]: 사유 필수, 이력은 ADMIN, 행 머리말은 '관리자 대행'.
//   ⑥ 스텐실에는 대행 버튼이 없다(서버도 NOT_EQ_TRACK). ⑦ MD 하위 줄에도 같은 배지.
//   ⑧ [EQ 열기]는 회차가 있으면(eqRoundCount) 상태와 무관하게 남는다 — 새 회차 없이 승인된 뒤에도, 반려로
//      발주접수에 돌아온 뒤에도 지난 회차의 고객 답을 읽기 전용으로 연다. 회차가 없던 발주에는 서지 않는다.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-reopen-admin
// 사전: API(3333)·web(5173, nginx 통합 도메인) · e2e/.env.e2e 고객 아이디.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 세우고 **이 주행이 만든 것만** 지운다. MD 무대 계정·조직·관계는
// 상설(md-eq-observe·journey-eq-reopen-portal 과 공유).
// ⚠ AI 분석 설정(pcbEqParse)은 건드리지 않는다 — EQ 질의서를 .pdf 로 올려, 켜져 있어도 분석이 모델을 부르지 않게 한다.
// 화면 캡처: <리포>/.tmp/eq-admin-shots/40-reopen-*.png
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
const SHOTS = join(monoRoot, '..', '.tmp', 'eq-admin-shots');

const APPROVE_NOTICE = '승인하면 고객 회신(1차)이 협력사에 함께 전달됩니다';
const REOPEN_BADGE = '추가 EQ 요청';
const UNFIXED = '추가 EQ 요청 후 새 파일 없음';
const PROXY_BUTTON = '추가 EQ 요청(대행)';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 조건이 참이 될 때까지(기본 15초) — playwright-core 엔 expect 자동 대기가 없다. 실패하면 마지막 관찰을 싣는다. */
async function until(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 15_000,
  observe: () => Promise<string> = () => Promise.resolve(''),
): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`대기 시간 초과: ${what}\n마지막 관찰: ${await observe().catch(() => '')}`);
    await sleep(250);
  }
}
const textOf = async (loc: Locator): Promise<string> => ((await loc.count()) === 0 ? '' : await loc.first().innerText());
const untilText = (what: string, loc: Locator, needle: string | RegExp): Promise<void> =>
  until(
    `${what} — "${String(needle)}"`,
    async () => {
      const t = await textOf(loc);
      return typeof needle === 'string' ? t.includes(needle) : needle.test(t);
    },
    15_000,
    () => textOf(loc),
  );

describe.skipIf(!RUN)('추가 EQ 요청 — 관리자 화면(D20 후속)', () => {
  let owner: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 협력사(협력2)
  let C = ''; // 고객(주문자)
  let customerId = '';
  const token = `e2eeqro${String(Date.now())}`;
  const startedAt = new Date();
  const orders: G5OrderFixture[] = [];
  const specIds: bigint[] = [];
  const seeded: bigint[] = [];
  let childRfqId: bigint | null = null;
  let mailpitUp = false;
  let admin!: E2eSession;
  let page!: Page;

  let specId = 0n;
  let poId = 0;
  let projectName = '';
  let r1 = 0;

  // 사유는 쓴 그대로 화면에 나온다 — 공장이 실제로 쓰는 모양(중문 + 영문).
  const REASON = `阻抗条位置需再确认 — please confirm the impedance coupon position (${token})`;
  const PROXY_REASON = `전화로 받음: 적층 구조를 다시 확인해야 합니다 (${token})`;
  const REJECT_REASON = `적층 구조 도면이 빠졌습니다 (${token})`;
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
  const uploadEq = async (tok: string, id: number, name: string): Promise<void> => {
    const form = new FormData();
    form.set('fileType', 'eq');
    form.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, Date.now() % 251])], name, { type: 'application/pdf' }));
    const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(id)}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}` },
      body: form,
    });
    expect(res.status, `EQ 업로드 ${name}`).toBe(200);
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
  const adminReviews = async (): Promise<any[]> => {
    const res = await api(A, 'GET', `/api/admin/pcb-eq-reviews/${String(poId)}`);
    expect(res.status, `관리자 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json?.data?.reviews ?? [];
  };
  const poView = async (spec: bigint, id: number): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-projects/${spec.toString()}/pos`);
    expect(res.status, `발주 목록: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.pos ?? []).find((p: any) => p.poId === id) ?? null;
  };
  const poStatus = async (id: number = poId): Promise<string> =>
    String((await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(id) } }))?.status);

  // ── 화면 조각 ──────────────────────────────────────────────────────────────
  /** 캡처 — target 을 주면 그 요소를 화면 안으로 끌어온 뒤 찍는다(발주 행은 새 문서에서 접힌 선 아래에 있다). */
  const shot = async (name: string, target?: Locator): Promise<void> => {
    if (target !== undefined) await target.first().scrollIntoViewIfNeeded();
    await sleep(400); // 패널 미끄러짐·확인창 페이드가 끝난 뒤
    await page.screenshot({ path: join(SHOTS, `40-reopen-${name}.png`) });
  };
  const ws = (): Locator => page.locator('[data-eq-workspace]');
  const footer = (): Locator => ws().locator('footer');
  const confirmAlert = (): Locator => page.getByRole('alertdialog');
  /** 확인창 버튼을 누르고 닫힐 때까지 — 열린 동안엔 패널이 aria-hidden 이라 역할 질의가 비어 보인다. */
  const confirmWith = async (name: string): Promise<void> => {
    await confirmAlert().getByRole('button', { name, exact: true }).click();
    await confirmAlert().waitFor({ state: 'hidden' });
  };
  /** Case 상세를 새 문서로 연다 — 기다릴 표지는 무대마다 다르다(본 무대는 [EQ 열기]). */
  const openCase = async (spec: bigint = specId, ready?: () => Locator): Promise<void> => {
    await page.goto(`${BASE_URL}/app/admin/pcb/cases/${spec.toString()}?_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    const mark = ready === undefined ? page.getByRole('button', { name: /EQ 열기|작성 이어가기/ }).first() : ready();
    await mark.waitFor({ state: 'visible', timeout: 30_000 });
  };
  const openWorkspace = async (): Promise<void> => {
    await page.locator('[data-eq-row-chip]').getByRole('button').first().click();
    await ws().waitFor({ state: 'visible' });
  };
  const closeWorkspace = async (): Promise<void> => {
    await footer().getByRole('button', { name: '닫기', exact: true }).click();
    await ws().waitFor({ state: 'hidden' });
  };
  const rowChip = (): Locator => page.locator('[data-eq-row-chip]').first();
  const mainRow = (): Locator => page.locator('tr', { has: page.locator('[data-eq-row-chip]') }).first();
  const reworkBadge = (): Locator => page.locator('[data-eq-rework-badge]');
  const reworkNote = (): Locator => page.locator('[data-eq-rework-note]');

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mailpitUp = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null))?.ok === true;
    mkdirSync(SHOTS, { recursive: true });

    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    customerId = requireCustomerCreds(1).id;
    C = signJwt({ mbId: customerId, ttlSec: 3600 });

    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청 관리자 화면');
    orders.push(order);
    projectName = `E2E-EQRO-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    specIds.push(specId);
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);

    // 협력사 승인요청 → 관리자 문항 발송 → 고객 회신. **전달은 하지 않는다** — 승인이 한다(R-1).
    await uploadEq(P, poId, 'EQ-factory-r1.pdf');
    await eqRequest(P, poId);
    const base = `/api/admin/pcb-eq-reviews/${String(poId)}`;
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
    const sent = await api(A, 'POST', `${base}/${String(draft.id)}/send`, { expectedVersion: saved.json.data.review.version });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    const review = sent.json.data.review;
    r1 = Number(review.id);
    const answered = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r1)}/answer`, {
      expectedVersion: review.version,
      answers: [{ itemId: review.items[0].id, key: 'B', comment: `좌측 하단에 넣어 주세요 ${token}` }],
      agree: true,
    });
    expect(answered.status, `고객 회신: ${JSON.stringify(answered.json)}`).toBe(200);

    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    page = admin.page;
  }, 120_000);

  afterAll(async () => {
    await admin?.close().catch(() => undefined);
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
    await cleanupPcbPos(poIds); // 회차·문항·이벤트는 발주 cascade, AI 분석 잡도 여기서
    if (childRfqId !== null) await prisma.spPcbRfq.deleteMany({ where: { id: childRfqId } });
    if (specIds.length > 0) await prisma.spOrderSpec.deleteMany({ where: { id: { in: specIds } } });
    for (const o of orders) await deleteOrderHard(o.odId);
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }

    expect((await countPcbResidue(poIds)).pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spPcbEqReview.count({ where: { poId: { in: poIds } } }), '회차 잔재').toBe(0);
    for (const o of orders) expect(await countCartRows(o.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 120_000);

  test('R1. Case 행 [EQ 승인] — 되묻지 않고 "승인하면 고객 회신이 협력사에 함께 전달됩니다"를 알린다', async () => {
    await openCase();
    await untilText('행 칩 전달 필요', rowChip(), '회신 도착 · 전달 필요');
    await mainRow().getByRole('button', { name: 'EQ 승인', exact: true }).click();
    await confirmAlert().waitFor({ state: 'visible' });
    const text = await confirmAlert().innerText();
    expect(text).toContain(APPROVE_NOTICE);
    expect(text, '되묻던 옛 문구').not.toContain('전달하지 않고');
    expect(text, '경고가 아니라 안내').not.toContain('그래도');
    expect(await confirmAlert().getByRole('button', { name: 'EQ 승인', exact: true }).count(), '확인 버튼 = EQ 승인').toBe(1);
    await shot('01-approve-confirm-row');
    // 취소하면 아무 일도 없다 — 전달도 승인도.
    await confirmWith('취소');
    expect(await poStatus()).toBe('eq_requested');
    expect((await adminReviews()).find((r) => r.id === r1)?.forwardedAt, '취소면 전달도 없다').toBeNull();
  });

  test('R2. 작업공간 [고객 회신대로 EQ 승인] — 같은 안내, 승인하면 회신이 함께 전달되고 칩은 \'전달됨\'', async () => {
    await openWorkspace();
    await untilText('전달 필요', ws().locator('[data-eq-round-status]'), '회신 도착 · 전달 필요');
    await untilText('바닥 안내', footer(), 'EQ 승인하면 협력사에 함께 전달됩니다');
    // 수동 전달은 남아 있다(승인 전에 협력사 의견을 먼저 들을 때) — 다만 주 동작은 승인이다.
    expect(await footer().getByRole('button', { name: '협력사에 전달', exact: true }).count(), '[협력사에 전달]은 남는다').toBe(1);
    await shot('02-workspace-answered');

    await footer().getByRole('button', { name: '고객 회신대로 EQ 승인' }).click();
    await confirmAlert().waitFor({ state: 'visible' });
    const text = await confirmAlert().innerText();
    expect(text, '작업공간도 같은 안내 한 번').toContain(APPROVE_NOTICE);
    expect(text).not.toContain('전달하지 않고');
    await shot('03-approve-confirm-workspace');
    await confirmWith('EQ 승인');

    await until('EQ 승인', async () => (await poStatus()) === 'eq_done');
    const review = (await adminReviews()).find((r) => r.id === r1);
    expect(review?.forwardedAt, '승인이 회신을 함께 전달했다').not.toBeNull();
    await untilText('회차 상태 전달됨', ws().locator('[data-eq-round-status]'), '전달됨');
    await closeWorkspace();
    await untilText('행 칩 전달됨', rowChip(), 'EQ 1차 · 전달됨');
    // 승인 뒤·생산 시작 전 — 대행 자리에 [추가 EQ 요청(대행)]이 선다.
    expect(await mainRow().getByRole('button', { name: PROXY_BUTTON, exact: true }).count(), PROXY_BUTTON).toBe(1);
    expect(await reworkBadge().count(), '아직 돌아온 적 없다').toBe(0);
    await shot('04-approved-forwarded', mainRow());
  });

  test('R3. (API) 협력사 추가 EQ 요청 → 발주접수 행에 배지·사유, 워크큐에도 배지', async () => {
    const reopened = await eqReopen(P, poId, REASON);
    expect(reopened.status, `추가 EQ 요청: ${JSON.stringify(reopened.json)}`).toBe(200);
    expect(await poStatus()).toBe('issued');

    await openCase();
    await untilText('행 배지', reworkBadge(), REOPEN_BADGE);
    const row = await mainRow().innerText();
    expect(row).toContain('발주접수');
    expect(row, '반려가 아니다').not.toContain('반려됨');
    expect(await reworkBadge().first().innerText(), '배지 = 추가 EQ 요청 + 날짜').toMatch(/추가 EQ 요청 \d/);
    const note = await reworkNote().first().innerText();
    expect(note, '누구 말인지').toContain('협력사:');
    expect(note, '사유 인용').toContain(REASON);
    // 돌아온 뒤엔 다시 열 것이 없다 — 대행 버튼은 eq_done 에서만.
    expect(await mainRow().getByRole('button', { name: PROXY_BUTTON, exact: true }).count(), '발주접수엔 대행 버튼 없음').toBe(0);
    await shot('05-case-reopened', mainRow());

    const listed = await poView(specId, poId);
    expect(listed.eqHistory.at(-1), '이력 = 협력사가 다시 열었다').toMatchObject({
      fromStatus: 'eq_done',
      toStatus: 'issued',
      byRole: 'PARTNER',
      note: REASON,
    });

    await page.goto(`${BASE_URL}/app/admin/pcb/pos?tab=waiting&q=${encodeURIComponent(projectName)}&_t=${String(Date.now())}`, {
      waitUntil: 'domcontentloaded',
    });
    const wqRow = page.locator('tr', { hasText: projectName }).first();
    await wqRow.waitFor({ state: 'visible', timeout: 30_000 });
    await untilText('워크큐 배지', wqRow.locator('[data-eq-rework-badge]'), REOPEN_BADGE);
    expect(await wqRow.innerText(), '워크큐도 반려가 아니다').not.toContain('반려됨');
    await shot('06-workqueue-reopened');
  });

  test('R4. 새 파일 없이 다시 승인요청 → "추가 EQ 요청 후 새 파일 없음", 작업공간은 협력사 사유를 근거로 보인다', async () => {
    await eqRequest(P, poId);
    expect(await poStatus()).toBe('eq_requested');

    await openCase();
    const unfixed = page.locator('[data-eq-unfixed]');
    await untilText('새 파일 없음 경고', unfixed, UNFIXED);
    expect(await unfixed.first().innerText(), '반려 문구가 아니다').not.toContain('반려');
    // 사유는 승인요청 중에도 남는다(무엇을 확인하려 다시 열었는지 — 승인 판단의 근거).
    expect(await reworkNote().first().innerText()).toContain(REASON);
    await shot('07-case-rerequest-unfixed', mainRow());

    await openWorkspace();
    const card = ws().locator('[data-eq-new-round]');
    await card.waitFor({ state: 'visible' });
    expect(await card.innerText()).toContain('2차 회차 시작');
    const context = card.locator('[data-eq-reopen-context]');
    await untilText('새 회차 카드 근거', context, '협력사 추가 EQ 요청');
    expect(await context.innerText()).toContain(REASON);
    await shot('08-workspace-new-round-context');

    // AI 분석이 켜진 환경이면 방금 승인요청이 분석을 띄웠을 수 있다(.pdf 라 모델은 안 부른다) — 끝난 뒤에 누른다.
    await until('AI 분석 종료', async () => (await ws().locator('[data-eq-ai-kind="running"]').count()) === 0, 60_000);
    await card.getByRole('button', { name: '직전 회차에서 가져오기' }).click();
    await untilText('2차 작성 중', ws().locator('[data-eq-round-status]'), '작성 중');
    const head = ws().locator('[data-eq-reopen-head]');
    await untilText('초안 머리의 사유', head, '협력사 추가 EQ 요청:');
    expect(await head.innerText()).toContain(REASON);

    // 활동 — 발주 EQ 전이에 '추가 EQ 요청'(사유·협력사)이 선다.
    await ws().locator('[data-eq-item="1"]').getByRole('button').first().click();
    const side = ws().locator('[data-eq-side]');
    await side.getByRole('tab', { name: '활동' }).click();
    const reopenRow = side.locator(`[data-eq-activity-label="${REOPEN_BADGE}"]`);
    await untilText('활동의 추가 EQ 요청', reopenRow, REASON);
    expect(await reopenRow.first().innerText()).toContain('협력사');
    await shot('09-workspace-draft-activity');
    await closeWorkspace();
  });

  test('R5. 관리자 대행 — [추가 EQ 요청(대행)]은 사유가 있어야 보내고, 이력은 관리자·행 머리말은 \'관리자 대행\'', async () => {
    // 2차 초안은 닫히고(승인이 닫는다) 발주는 다시 승인 완료 — 이번엔 포털 대신 관리자가 다시 연다.
    await eqApprove(specId, poId);
    expect(await poStatus()).toBe('eq_done');

    // 행 요약(칩)은 이번 승인요청 뒤의 회차만 싣는다 — 2차를 안 보내고 승인했으니 칩은 비지만, [EQ 열기]는 남아
    // 협력사가 읽고 다시 연 그 고객 회신(1차)을 여전히 열어 볼 수 있어야 한다(회차 수로 판정 — 안 나간 2차 초안은 안 센다).
    expect(await poView(specId, poId), '요약은 비고 회차 수는 남는다').toMatchObject({ eqReview: null, eqRoundCount: 1 });
    await openCase();
    const proxy = mainRow().getByRole('button', { name: PROXY_BUTTON, exact: true });
    await proxy.waitFor({ state: 'visible' });
    expect(await reworkBadge().count(), '승인되면 배지는 내린다').toBe(0);
    await openWorkspace();
    await untilText('지난 회차(1차)가 열린다', ws().locator('[data-eq-round-status]'), '전달됨');
    expect(await ws().locator('[data-eq-item="1"]').innerText(), '1차 고객 답').toContain('답 B');
    await closeWorkspace();
    await proxy.click();
    const dialog = page.getByRole('dialog', { name: '추가 EQ 요청 대행' });
    await dialog.waitFor({ state: 'visible' });
    const submit = dialog.getByRole('button', { name: REOPEN_BADGE, exact: true });
    expect(await submit.isDisabled(), '사유 없이는 못 보낸다').toBe(true);
    expect(await dialog.innerText(), '누구 대신인지').toContain(owner.name);
    await dialog.locator('#next-prompt-reason').fill(PROXY_REASON);
    expect(await submit.isDisabled()).toBe(false);
    await shot('10-proxy-dialog');
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });

    await until('발주접수로', async () => (await poStatus()) === 'issued');
    expect((await poView(specId, poId)).eqHistory.at(-1), '이력 = 관리자 대행').toMatchObject({
      fromStatus: 'eq_done',
      toStatus: 'issued',
      byRole: 'ADMIN',
      note: PROXY_REASON,
    });
    await untilText('행 배지', reworkBadge(), REOPEN_BADGE);
    const note = await reworkNote().first().innerText();
    expect(note, '관리자가 대신 쓴 사유').toContain('관리자 대행:');
    expect(note).toContain(PROXY_REASON);
    expect(note, '협력사가 쓴 말로 보이면 안 된다').not.toContain('협력사:');
    await shot('11-case-proxy-reopened', mainRow());
  });

  test('R5b. 반려로 발주접수에 돌아온 행에서도 [EQ 열기] → 지난 회차의 고객 답이 읽기 전용으로 보인다', async () => {
    // 대행으로 다시 연 발주를 협력사가 (새 회차 없이) 다시 올렸고, 관리자가 반려했다 — 가장 최근 경계는 반려다.
    await eqRequest(P, poId);
    const rejected = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: REJECT_REASON,
    });
    expect(rejected.status, `반려: ${JSON.stringify(rejected.json)}`).toBe(200);
    expect(await poStatus()).toBe('issued');
    // 요약은 이번 요청 뒤 회차만이라 비어 있다 — 문은 요약이 아니라 회차 수가 연다.
    expect(await poView(specId, poId)).toMatchObject({ status: 'issued', eqReview: null, eqRoundCount: 1 });

    await openCase();
    await untilText('반려 배지', reworkBadge(), '반려됨');
    expect(await reworkNote().first().innerText()).toContain(REJECT_REASON);
    expect(await mainRow().getByRole('button', { name: 'EQ 열기', exact: true }).count(), '반려 뒤에도 [EQ 열기]').toBe(1);
    await openWorkspace();
    await untilText('지난 회차(1차)', ws().locator('[data-eq-round-status]'), '전달됨');
    expect(await ws().locator('[data-eq-item="1"]').innerText(), '1차 고객 답').toContain('답 B');
    await ws().locator('[data-eq-item="1"]').getByRole('button').first().click();
    await untilText('고객 의견', ws(), `좌측 하단에 넣어 주세요 ${token}`);
    // 읽기 전용 — 승인요청 중이 아니면 새 회차를 시작할 수 없고, 판정·발송 버튼도 없다.
    expect(await ws().getByRole('tab', { name: '+ 새 회차' }).count(), "'+ 새 회차' 탭 없음").toBe(0);
    expect(await ws().locator('[data-eq-new-round]').count(), '새 회차 카드 없음').toBe(0);
    expect(await footer().getByRole('button').allInnerTexts(), '바닥엔 닫기뿐').toEqual(['닫기']);
    expect(await footer().innerText(), '승인요청 중이 아니면 승인·반려를 권하지 않는다').not.toContain('EQ 승인');
    await shot('14-rejected-issued-history');
    await closeWorkspace();
  });

  test('R6. 스텐실에는 대행 버튼이 없다 — 확인 완료 뒤 좌표파일은 바뀌지 않는다(R-4)', async () => {
    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청 관리자 스텐실');
    orders.push(order);
    const name = `E2E-EQRO-MM-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: name, category: 'metalMask' });
    specIds.push(spec.id as bigint);
    const po = await createPcbPo({ specId: spec.id, partnerId: owner.id, status: 'eq_done' });
    seeded.push(po.id);
    expect((await poView(spec.id as bigint, Number(po.id))).track).toBe('stencil');

    await openCase(spec.id as bigint, () => page.getByRole('button', { name: '확인 취소', exact: true }).first());
    expect(await page.getByRole('button', { name: /추가 (EQ|확인) 요청/ }).count(), '스텐실엔 추가 요청 대행 없음').toBe(0);
    // 대행 자리의 다른 동작(생산 시작)은 그대로다.
    expect(await page.getByRole('button', { name: /생산 시작/ }).count(), '생산 시작 대행은 있다').toBeGreaterThan(0);
    const res = await api(A, 'POST', `/api/admin/pcb-projects/${spec.id.toString()}/pos/${String(po.id)}/eq-reopen`, {
      reason: '좌표를 고치고 싶습니다',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json?.error).toBe('NOT_EQ_TRACK');
    await shot('12-stencil-no-proxy', page.getByRole('button', { name: '확인 취소', exact: true }));
  });

  test('R7. MD 경유 — 하위 발주 줄에도 같은 배지(사유는 툴팁), 위임 상위엔 대행 버튼이 없다', async () => {
    const prisma = getPrisma();
    const md = await ensureStagePartner(MD);
    const sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'USD');
    if (md.mbId === null || sub.mbId === null) throw new Error('MD 무대 계정 연결 실패');
    const M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    const S = signJwt({ mbId: sub.mbId, ttlSec: 3600 });

    const order = await createG5OrderFixture(customerId, 'e2e 추가 EQ 요청 관리자 MD');
    orders.push(order);
    const name = `E2E-EQRO-MD-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: name, category: 'standard' });
    const mdSpecId = spec.id as bigint;
    specIds.push(mdSpecId);
    const top = await createPcbPo({
      specId: mdSpecId,
      partnerId: md.id,
      status: 'issued',
      currency: 'KRW',
      priceOriginal: 700000,
      fulfillmentMode: 'delegated',
    });
    seeded.push(top.id);
    // 하위 회신(selected) 직삽입 — round 0 하위 발주는 childRfqId 필수(md-eq-observe 관례).
    const rfq = await prisma.spPcbRfq.create({
      data: {
        specId: mdSpecId,
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
    const created = await api(M, 'POST', `/api/partner/pcb-pos/${String(top.id)}/children`, { childRfqId: Number(rfq.id) });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const childId = Number(created.json.data.children[0].poId);
    seeded.push(BigInt(childId));

    await uploadEq(S, childId, 'EQ-sub.pdf');
    await eqRequest(S, childId);
    await eqApprove(mdSpecId, childId);
    const reopened = await eqReopen(S, childId, REASON);
    expect(reopened.status, `하위 추가 EQ 요청: ${JSON.stringify(reopened.json)}`).toBe(200);
    expect(await poStatus(childId)).toBe('issued');

    const childBadge = (): Locator => page.locator('[data-eq-child-rework-badge]');
    await openCase(mdSpecId, childBadge);
    expect(await childBadge().first().innerText(), '하위 줄 배지').toMatch(/추가 EQ 요청 \d/);
    expect(await childBadge().first().getAttribute('title'), '사유는 툴팁').toBe(REASON);
    expect(await page.getByRole('button', { name: PROXY_BUTTON, exact: true }).count(), '위임 상위엔 대행 버튼 없음').toBe(0);
    // 이 하위 발주는 고객에게 물은 적이 없다(회차 0) — 추가 EQ 요청으로 돌아왔다는 것만으로 [EQ 열기]가 서지 않는다.
    expect((await poView(mdSpecId, childId)).eqRoundCount, '하위 회차 수').toBe(0);
    expect(await page.getByRole('button', { name: 'EQ 열기', exact: true }).count(), '회차 없는 발주엔 [EQ 열기] 없음').toBe(0);
    await shot('13-md-child-reopened', childBadge());
  });
});
