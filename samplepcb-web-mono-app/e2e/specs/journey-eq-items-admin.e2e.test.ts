// EQ 문항형 회차(D20) — **관리자 작업공간 화면**을 손으로 주행한다.
//
// journey-eq-items 가 API 왕복과 경계를 박제했다면, 이 주행은 관리자 sp-vue 화면(Case 상세의 넓은 오른쪽 패널)을
// 조작한다: 행 칩 + [EQ 열기] → 새 회차 카드 [직접 작성] → 문항 2개(유형·공장 번호·한국어↔원문·선택지 권장/의견
// 필수·그림 업로드·고객 공개) → 임시저장 → 고객 미리보기(원문·비공개 그림 없음) → 작성 이어가기 → 고객에게
// 보내기(확인창 "문항 N·공개 그림 M") → (API) 고객 회신 → 답 표시·[협력사에 전달] → 워크큐 회차 칩 →
// (API) 반려·재요청 → 새 회차 [직전 회차에서 가져오기] → 발송 → 대리 회신 대화상자(필수 입력 검증) →
// 1280px 미만 탭 전환 · 390px 가로 넘침 0.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items-admin
// 사전: API(3333)·web(5173, nginx 통합 도메인)·파일서버(그림 업로드) · e2e/.env.e2e 고객 아이디.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 세우고 **이 주행이 만든 것만** 지운다(다른 트랙 e2e 와 공존).
// 화면 캡처: <리포>/.tmp/eq-admin-shots/*.png
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Dialog, Locator, Page } from 'playwright-core';
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
  fetchXlsx,
  getPartner,
  getPrisma,
  mailpitDelete,
  mailpitSearch,
  monoRoot,
  newSession,
  requireCustomerCreds,
  signJwt,
  xlsxText,
  type E2eSession,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const OWNER = '협력2';
const SHOTS = join(monoRoot, '..', '.tmp', 'eq-admin-shots');

/** 1×1 PNG 두 장(내용이 달라야 파일서버가 같은 것으로 묶지 않는다) — 화면은 형식·소유·공개만 본다. */
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/** 세 번째 그림 — IEND 뒤의 꼬리 바이트는 디코더가 무시한다(내용만 다르게). */
const PNG_C = Buffer.concat([PNG_A, Buffer.from([0x00])]);

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

describe.skipIf(!RUN)('EQ 문항형 회차(D20) — 관리자 작업공간 화면', () => {
  let owner: PartnerFixture;
  let A = '';
  let P = '';
  let C = '';
  let customerId = '';
  let order: G5OrderFixture | undefined;
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  const seeded: bigint[] = [];
  const startedAt = new Date();
  const token = `e2eeqa${String(Date.now())}`;
  let mailpitUp = false;
  let admin!: E2eSession;
  let page!: Page;

  let r1 = 0;
  let r2 = 0;

  const adminBase = (): string => `/api/admin/pcb-eq-reviews/${String(poId)}`;
  const adminReviews = async (): Promise<any[]> => {
    const res = await api(A, 'GET', adminBase());
    expect(res.status, `관리자 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json?.data?.reviews ?? [];
  };
  const adminReview = async (id: number): Promise<any> => (await adminReviews()).find((r) => r.id === id) ?? null;
  const poStatus = async (): Promise<string> =>
    String((await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } }))?.status);

  const uploadEq = async (name: string): Promise<void> => {
    const form = new FormData();
    form.set('fileType', 'eq');
    form.set('file', new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, Date.now() % 251])], name, { type: 'application/vnd.ms-excel' }));
    const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(poId)}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: form,
    });
    expect(res.status, `EQ 업로드 ${name}`).toBe(200);
  };

  const shot = async (name: string): Promise<void> => {
    await sleep(400); // 패널 미끄러짐·확인창 페이드가 끝난 뒤
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  };
  const ws = (): Locator => page.locator('[data-eq-workspace]');
  const footer = (): Locator => ws().locator('footer');
  const confirmAlert = (): Locator => page.getByRole('alertdialog');
  /** 확인창 버튼을 누르고 닫힐 때까지 — 열린 동안엔 패널이 aria-hidden 이라 역할 질의가 비어 보인다. */
  const confirmWith = async (name: string): Promise<void> => {
    await confirmAlert().getByRole('button', { name }).click();
    await confirmAlert().waitFor({ state: 'hidden' });
  };
  const openCase = async (): Promise<void> => {
    await page.goto(`${BASE_URL}/app/admin/pcb/cases/${specId.toString()}?_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /EQ 열기|작성 이어가기/ }).first().waitFor({ state: 'visible', timeout: 30_000 });
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

    order = await createG5OrderFixture(customerId, 'e2e EQ 문항형 관리자 화면');
    projectName = `E2E-EQA-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);

    // 협력사가 EQ 질의서를 올리고 승인요청(기존 경로) — 관리자 차례가 된다.
    await uploadEq('EQ-factory-r1.xls');
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(req.status, `승인요청: ${JSON.stringify(req.json)}`).toBe(200);

    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    page = admin.page;
  }, 120_000);

  afterAll(async () => {
    await admin?.close().catch(() => undefined);
    await closeBrowser();
    const prisma = getPrisma();
    if (poId > 0) {
      // 그림·EQ 첨부는 refType/refId 규약(FK 없음) — 회차·발주 cascade 로 안 지워진다.
      const reviews = await prisma.spPcbEqReview.findMany({ where: { poId: BigInt(poId) }, select: { id: true } });
      if (reviews.length > 0) {
        await prisma.spFile.deleteMany({
          where: { refType: 'sp_pcb_eq_review', refId: { in: reviews.map((r: any) => r.id) } },
        });
      }
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) } });
      // AI 분석 유스케이스(D20 P2)가 켜진 환경에서는 승인요청마다 잡이 생긴다 — 발주서에 FK 가 없어 cascade 로 안 지워진다.
      await prisma.spAiJob.deleteMany({ where: { useCase: 'pcb.eq-parse', targetType: 'pcb_po', targetId: BigInt(poId) } });
    }
    if (specId > 0n) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: specId.toString(), createdAt: { gte: startedAt } },
      });
    }
    await cleanupPcbPos(seeded);
    if (specId > 0n) await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    if (order !== undefined) await deleteOrderHard(order.odId);
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }
    expect((await countPcbResidue(seeded)).pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spPcbEqReview.count({ where: { poId: BigInt(poId) } }), '회차 잔재').toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  // 2026-10-11 — 좁은 'EQ 첨부' 칸 대신 발주 행 아래에 전체 폭 **EQ 줄**이 선다: 협력사 제출(파일명) → 고객 확인
  // (칩·[EQ 열기]) → 판정(EQ 승인·반려). 행 액션에는 발주 자체에 대한 것(송금·조건 수정)만 남는다.
  test('A1. Case 행 + EQ 줄 — [EQ 열기] 하나, 판정은 EQ 줄에·송금과 조건 수정은 행에, 협력사 대행은 스위치로', async () => {
    await openCase();
    const band = page.locator('tr[data-eq-band]').first();
    const row = page.locator('tr[data-po-row]').first();
    expect(await band.getByRole('button', { name: 'EQ 열기' }).count(), '[EQ 열기]').toBe(1);
    // 옛 '고객 확인' 버튼은 사라졌다(작업공간 안 [간단 문구로 묻기]로 옮김).
    expect(await band.getByRole('button', { name: /^고객 확인/ }).count(), '옛 고객 확인 버튼').toBe(0);
    for (const name of ['EQ 승인', '반려']) {
      expect(await band.getByRole('button', { name, exact: true }).count(), `EQ 줄의 판정 ${name}`).toBe(1);
      expect(await row.getByRole('button', { name, exact: true }).count(), `행 액션에는 없다 ${name}`).toBe(0);
    }
    for (const name of ['송금', '조건 수정']) {
      expect(await row.getByRole('button', { name, exact: true }).count(), `행 액션 ${name}`).toBe(1);
    }
    // 협력사가 올린 파일이 **이름으로** 보인다(전에는 종류만 보이고 이름은 툴팁이었다).
    expect(await band.locator('[data-eq-band-submit]').innerText(), '파일명').toContain('EQ-factory-r1.xls');
    expect(await band.locator('[data-eq-band-submit]').innerText(), '승인요청 시각').toContain('EQ 승인요청');
    // 회차가 하나뿐이면 회차 칩이 없다(고를 것이 없다).
    expect(await band.locator('[data-eq-round]').count(), '회차 칩').toBe(0);
    // 협력사 대행 동작 — 포털 계정이 있는 조직이라 기본은 숨김. 스위치를 켜면 보이고 끄면 다시 숨는다.
    const sw = page.locator('[data-pcb-proxy-switch]');
    expect(await sw.getAttribute('aria-checked'), '기본은 꺼짐').toBe('false');
    expect(await page.locator('[data-pcb-proxy-hidden]').count(), '숨김 표시').toBe(1);
    expect(await page.locator('[data-eq-band-proxy], [data-eq-band-proxy-upload], [data-po-proxy]').count(), '대행 동작은 숨어 있다').toBe(0);
    await shot('01-case-row');
    await sw.click();
    expect(await sw.getAttribute('aria-checked')).toBe('true');
    expect(await page.locator('[data-pcb-proxy-hidden]').count(), '켜면 숨김 표시가 없다').toBe(0);
    // 승인요청 중이라 지금 대행할 것(승인요청·첨부·생산)은 없다 — 켜도 판정 버튼만 선다.
    expect(await band.getByRole('button', { name: 'EQ 승인', exact: true }).count()).toBe(1);
    await sw.click();
    expect(await sw.getAttribute('aria-checked'), '다시 끈다(이 스펙의 나머지는 기본 상태로)').toBe('false');
  });

  test('A2. 새 회차 카드 — 근거 첨부 기본 선택, [직접 작성]으로 초안', async () => {
    await openWorkspace();
    const card = ws().locator('[data-eq-new-round]');
    await card.waitFor({ state: 'visible' });
    expect(await card.innerText()).toContain('1차 회차 시작');
    expect(await card.getByRole('button', { name: '직전 회차에서 가져오기' }).count(), '첫 회차엔 가져올 것이 없다').toBe(0);
    // [AI 분석]은 유스케이스(설정 > AI 연동)가 켜져 있을 때만 살아 있다 — 이 주행은 그 전역 설정을 건드리지 않으므로
    // 켜짐/꺼짐을 단정하지 않고, 꺼짐 안내가 떠 있으면 비활성·없으면 활성인지만 본다(AI 화면은 journey-eq-items-ai-admin).
    const aiOff = (await card.locator('[data-eq-ai-disabled]').count()) > 0;
    expect(await card.getByRole('button', { name: /AI 분석/ }).isDisabled(), `[AI 분석] 꺼짐 안내=${String(aiOff)}`).toBe(aiOff);
    expect(await card.getByRole('checkbox').first().getAttribute('aria-checked'), '근거 첨부 기본 선택').toBe('true');
    await shot('02-new-round');

    await card.getByRole('button', { name: '직접 작성' }).click();
    await untilText('작성 중 배지', ws().locator('[data-eq-round-status]'), '작성 중');
    const reviews = await adminReviews();
    const draft = reviews.find((r) => r.status === 'draft');
    expect(draft, '초안').toBeTruthy();
    r1 = Number(draft.id);
    const eqFile = await getPrisma().spFile.findFirst({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) } });
    expect(draft).toMatchObject({ format: 'items', roundNo: 1, items: [], sourceFileIds: [Number(eqFile?.id)] });
  });

  test('A3. 문항 2개 작성 — 한국어↔원문·선택지(권장·의견 필수)·그림 업로드·공개 토글 → 임시저장', async () => {
    const w = ws();
    // 문항 1 — 마킹, 그림 두 장 중 한 장만 공개
    await w.getByRole('button', { name: '문항 추가' }).click();
    await w.getByLabel('유형').selectOption('marking');
    await w.getByLabel('공장 번호').fill('1');
    await w.getByLabel(/한국어 질문/).fill(`보드에 UL 마킹을 넣을까요? (${token})`);
    await w.getByLabel(/공장 원문/).first().fill('是否需要在板上加UL标记？');
    await w.getByLabel('선택지 A 한국어 문구').fill('공장 제안대로 넣지 않음');
    await w.getByLabel('선택지 A 공장 원문').fill('按我司建议不加');
    await w.getByLabel('선택지 B 한국어 문구').fill('위치를 지정하겠습니다');
    await w.getByLabel('선택지 B 공장 원문').fill('贵司指示位置');
    await w.getByLabel('제조사 권장').first().click();
    await w.getByLabel('의견 필수').nth(1).click();
    await w.locator('[data-eq-figure-input]').setInputFiles({ name: 'ul-mark.png', mimeType: 'image/png', buffer: PNG_A });
    await until('그림 1', async () => (await w.locator('[data-eq-figure]').count()) === 1);
    await w.locator('[data-eq-figure-input]').setInputFiles({ name: 'factory-logo.png', mimeType: 'image/png', buffer: PNG_B });
    await until('그림 2', async () => (await w.locator('[data-eq-figure]').count()) === 2);
    await w.getByLabel('고객 공개').first().click();

    // 문항 2 — 드릴, 선택지 C(의견 필수) 추가
    await w.getByRole('button', { name: '문항 추가' }).click();
    await w.getByLabel('유형').selectOption('drill');
    await w.getByLabel('공장 번호').fill('2');
    await w.getByLabel(/한국어 질문/).fill('0.2mm 비아를 0.25mm 로 키워도 될까요?');
    await w.getByLabel(/공장 원문/).first().fill('0.2mm孔径加大到0.25mm可以吗？');
    await w.getByLabel('선택지 A 한국어 문구').fill('키워도 됩니다');
    await w.getByLabel('선택지 B 한국어 문구').fill('안 됩니다');
    await w.getByRole('button', { name: '선택지 추가' }).click();
    await w.getByLabel('선택지 C 한국어 문구').fill('기타(의견)');
    await w.getByLabel('의견 필수').nth(2).click();

    await untilText('저장 안 된 변경', footer(), '저장 안 된 변경');
    await shot('03-draft-edit');
    await footer().getByRole('button', { name: '임시저장' }).click();
    await until('저장 반영', async () => (await adminReview(r1))?.items?.length === 2);
    await until(
      '저장 뒤 dirty 해제',
      async () => {
        const t = await footer().innerText();
        return t.includes('문항 2 · 공개 그림 1') && !t.includes('저장 안 된 변경');
      },
      15_000,
      () => footer().innerText(),
    );
    const saved = await adminReview(r1);
    expect(saved.version, '저장이 버전을 올린다').toBe(2);
    expect(saved.items.map((i: any) => [i.factoryNo, i.category, i.options.map((o: any) => o.key).join('')])).toEqual([
      ['1', 'marking', 'AB'],
      ['2', 'drill', 'ABC'],
    ]);
    expect(saved.items[0].options[0]).toMatchObject({ recommended: true, labelOrig: '按我司建议不加' });
    expect(saved.items[0].options[1]).toMatchObject({ requiresComment: true });
    expect(saved.items[0].figures.map((f: any) => [f.name, f.shared])).toEqual([
      ['ul-mark.png', true],
      ['factory-logo.png', false],
    ]);
    expect(saved.items[1].options[2]).toMatchObject({ key: 'C', requiresComment: true });
  });

  test('A4. 고객 미리보기는 원문·비공개 그림을 그리지 않고, 활동에 작성 시작이 있다', async () => {
    const w = ws();
    await w.locator('[data-eq-item="1"]').getByRole('button').first().click();
    const side = w.locator('[data-eq-side]');
    const preview = await side.innerText();
    expect(preview).toContain('고객에게 보일 모습');
    expect(preview).toContain('UL 마킹');
    expect(preview, '원문 질문 미노출').not.toContain('是否需要');
    expect(preview, '원문 선택지 미노출').not.toContain('按我司建议不加');
    expect(await side.locator('[data-eq-figure]').count(), '미리보기는 공개 그림 1장만').toBe(1);
    await side.getByRole('tab', { name: '활동' }).click();
    await untilText('활동', side, '문항 작성 시작');
    await shot('04-preview-activity');
    await side.getByRole('tab', { name: '고객 미리보기' }).click();
  });

  test('A4b. 붙지 않은 그림 — 올리고 저장 없이 떠났다 돌아와도 편집기에서 다시 붙인다', async () => {
    // 문항 2 에 그림을 올린다(편집 버퍼에만 붙는다) → 저장하지 않고 화면을 떠난다.
    await ws().locator('[data-eq-item="2"]').getByRole('button').first().click();
    await ws().locator('[data-eq-figure-input]').setInputFiles({ name: 'drill-map.png', mimeType: 'image/png', buffer: PNG_C });
    await untilText('버퍼에 붙음', ws(), 'drill-map.png');
    await untilText('저장 안 된 변경', footer(), '저장 안 된 변경');
    const before = await adminReview(r1);
    expect(before.looseFigures.map((f: any) => [f.name, f.shared]), '서버에서는 아직 붙지 않은 그림').toEqual([['drill-map.png', false]]);
    expect(before.items[1].figures, '문항에는 아직 없다').toEqual([]);

    // 떠날 때 묻는 창(beforeunload)이 뜨면 떠난다 — 저장 안 된 변경은 버려진다.
    const leave = (dialog: Dialog): void => {
      void dialog.accept();
    };
    page.on('dialog', leave);
    await openCase();
    page.off('dialog', leave);
    await openWorkspace();

    // 돌아오면 문항 그림 목록에는 없지만 '아직 문항에 안 붙은 그림' 줄에 남아 있다.
    await ws().locator('[data-eq-item="2"]').getByRole('button').first().click();
    const loose = ws().locator('[data-eq-loose-figures]');
    await loose.waitFor({ state: 'visible' });
    const looseText = await loose.innerText();
    expect(looseText).toContain('아직 문항에 안 붙은 그림 1');
    expect(looseText).toContain('drill-map.png');
    expect(await footer().innerText(), '돌아온 직후는 저장된 판 그대로').not.toContain('저장 안 된 변경');
    await loose.getByRole('button', { name: '이 문항에 붙이기' }).scrollIntoViewIfNeeded();
    await shot('17-loose-figures');

    // [이 문항에 붙이기] → 줄이 사라지고 문항 그림이 된다(비공개로) → 임시저장하면 서버에서도 붙는다.
    await loose.getByRole('button', { name: '이 문항에 붙이기' }).click();
    await loose.waitFor({ state: 'hidden' });
    await untilText('붙인 뒤 저장 안 된 변경', footer(), '저장 안 된 변경');
    await footer().getByRole('button', { name: '임시저장' }).click();
    await until('붙여 저장', async () => (await adminReview(r1))?.items?.[1]?.figures?.length === 1);
    const after = await adminReview(r1);
    expect(after.looseFigures, '붙이면 빠진다').toEqual([]);
    expect(after.items[1].figures.map((f: any) => [f.name, f.shared])).toEqual([['drill-map.png', false]]);
    expect(after.items[0].figures.map((f: any) => f.name), '다른 문항 그림은 그대로').toEqual(['ul-mark.png', 'factory-logo.png']);
  });

  test('A5. 작성 이어가기 — 닫아도 저장 안 된 변경이 남고, 행 칩은 "고객 확인 1차 · 작성 중"', async () => {
    await ws().locator('#eq-round-message').fill(`머리말 ${token}`);
    await closeWorkspace();
    await untilText('행 칩', rowChip(), '고객 확인 1차 · 작성 중');
    expect(await rowChip().getByRole('button', { name: '작성 이어가기' }).count(), '작성 이어가기').toBe(1);
    await shot('05-row-continue');
    await openWorkspace();
    expect(await ws().locator('#eq-round-message').inputValue(), '버퍼 유지').toBe(`머리말 ${token}`);
  });

  test('A6. 고객에게 보내기 — 저장 안 된 변경은 먼저 저장, 확인창에 문항·공개 그림·기한', async () => {
    await footer().getByRole('button', { name: '고객에게 보내기' }).click();
    await confirmAlert().waitFor({ state: 'visible' });
    const ask = await confirmAlert().innerText();
    expect(ask).toContain('문항 2 · 공개 그림 1 · 기한 없음');
    await shot('06-send-confirm');
    await confirmWith('고객에게 보내기');
    await until('발송', async () => (await adminReview(r1))?.status === 'requested');
    expect((await adminReview(r1)).message, '보내기 전에 저장').toBe(`머리말 ${token}`);
    await untilText('회신 대기 배지', ws().locator('[data-eq-round-status]'), '회신 대기 D+0');
    expect(await footer().getByRole('button', { name: '대리 회신' }).count()).toBe(1);
    expect(await footer().getByRole('button', { name: '요청 취소' }).count()).toBe(1);
    // 회신서 엑셀(D20 P3) — 답이 없는 회신서는 없다. 버튼이 없고 서버도 그렇게 답한다.
    expect(await ws().locator('[data-eq-reply-xlsx]').count(), '회신 전엔 [회신서 엑셀]이 없다').toBe(0);
    expect(await fetchXlsx(A, `${adminBase()}/${String(r1)}/reply-xlsx`), '회신 전 회신서').toMatchObject({ status: 409, error: 'NOT_ANSWERED' });
    await shot('07-requested');
  });

  test('A7. (API) 고객 회신 → 답 표시 · [협력사에 전달] → 전달됨', async () => {
    const review = await adminReview(r1);
    const [m, d] = review.items;
    const answer = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r1)}/answer`, {
      expectedVersion: review.version,
      answers: [
        { itemId: m.id, key: 'B', comment: '좌측 하단 실크 옆에 넣어 주세요' },
        { itemId: d.id, key: 'A' },
      ],
      agree: true,
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);

    // 새로 연 화면 — 이번 요청의 회차(회신 도착)가 기본으로 열린다('+ 새 회차' 카드가 아니라).
    await openCase();
    await openWorkspace();
    await until(
      '전달 필요(이번 요청의 회차가 기본 선택)',
      async () => (await textOf(ws().locator('[data-eq-round-status]'))).includes('회신 도착 · 전달 필요'),
      15_000,
      () => ws().locator('header').innerText(),
    );
    const w = ws();
    expect(await w.locator('[data-eq-item="1"]').innerText()).toContain('답 B');
    await w.locator('[data-eq-item="1"]').getByRole('button').first().click();
    await untilText('고객 선택', w, '좌측 하단 실크 옆에 넣어 주세요');
    expect(await w.innerText()).toContain('고객 선택');
    await untilText('행 칩 전달 필요', rowChip(), '회신 도착 · 전달 필요');
    // ── 회신서 엑셀(D20 P3) — 회신이 오면 전달 전에도 받는다(관리자는 보관·검토용). 한국어 + 고객이 본 문장 열.
    const downloading = page.waitForEvent('download');
    await ws().locator('[data-eq-reply-xlsx]').click();
    const file = await downloading;
    expect(file.suggestedFilename(), '파일 이름').toBe(`EQ-Reply_${projectName}_PO-${String(poId)}_1차.xlsx`);
    const sheet = xlsxText(readFileSync(await file.path()));
    expect(sheet).toContain('EQ 회신서');
    expect(sheet, '관리자용 열').toContain('고객이 본 문장(한국어)');
    expect(sheet, '고객 의견').toContain('좌측 하단 실크 옆에 넣어 주세요');
    expect(sheet, '전달 전').toContain('아직 협력사에 전달하지 않음');
    expect(sheet, '고객이 직접 답했다').not.toContain('대리 입력');
    expect(sheet, 'EQ 요청 회차와 고객 확인 회차를 이름으로 가른다').toContain('EQ 요청: 1차');
    expect(sheet).toContain('고객 확인: 1차');

    // ── 고객 의견 번역(D20 P4) — 협력사 화면·회신서에 원문과 함께 나가는 문장을 여기서 보고 고친다.
    // 고객 회신 때 AI 가 뒤에서 번역해 두지만(켜져 있으면), 단언이 모델 답에 기대지 않게 사람이 적는 경로로 확인한다.
    const trBox = w.locator('[data-eq-comment-translation]');
    await trBox.waitFor({ state: 'visible' });
    await trBox.locator('[data-eq-translation-edit]').click();
    const TR_EN = `Next to the silkscreen at the lower left ${token}`;
    const TR_ZH = `放在左下角丝印旁边 ${token}`;
    await trBox.getByLabel('English').fill(TR_EN);
    await trBox.getByLabel('简体中文').fill(TR_ZH);
    await trBox.locator('[data-eq-translation-save]').click();
    await untilText('담당자 수정 표시', trBox.locator('[data-eq-translation-by]'), '담당자 수정');
    expect(await trBox.locator('[data-eq-translation-en]').innerText()).toBe(TR_EN);
    expect(await trBox.locator('[data-eq-translation-zh]').innerText()).toBe(TR_ZH);
    expect((await adminReview(r1)).items[0].commentI18n, '저장된 번역').toMatchObject({ en: TR_EN, 'zh-CN': TR_ZH, by: 'admin' });
    await shot('08b-comment-translation');
    // 의견이 없는 문항에는 번역 칸도 없고, 서버도 받지 않는다.
    const noComment = await api(A, 'PUT', `${adminBase()}/${String(r1)}/items/${String(d.id)}/comment-translation`, { en: 'x', 'zh-CN': 'y' });
    expect(noComment.status, JSON.stringify(noComment.json)).toBe(409);
    expect(noComment.json?.error).toBe('NO_COMMENT');
    // 두 칸을 다 비우면 번역을 지운다 — 다시 적으면 그 문장이 선다.
    const cleared = await api(A, 'PUT', `${adminBase()}/${String(r1)}/items/${String(m.id)}/comment-translation`, { en: '', 'zh-CN': '' });
    expect(cleared.json?.data?.review?.items?.[0]?.commentI18n, '지운 직후의 응답').toBeNull();
    const again = await api(A, 'PUT', `${adminBase()}/${String(r1)}/items/${String(m.id)}/comment-translation`, { en: TR_EN, 'zh-CN': TR_ZH });
    expect(again.json?.data?.review?.items?.[0]?.commentI18n).toMatchObject({ en: TR_EN, by: 'admin' });
    await shot('08-answered');

    await footer().getByRole('button', { name: '협력사에 전달' }).click();
    await confirmWith('협력사에 전달');
    await until('전달', async () => (await adminReview(r1))?.forwardedAt !== null);
    // 전달되면 협력사 포털 응답에 번역이 실린다(화면은 포털 언어가 영어·중국어일 때 번역문을 원문 위에 세운다).
    const portal = await api(P, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    expect(portal.json?.data?.eqRounds?.[0]?.items?.[0]?.commentI18n, '포털에 실린 번역').toMatchObject({ en: TR_EN, 'zh-CN': TR_ZH });
    await untilText('전달됨', ws().locator('[data-eq-round-status]'), '전달됨');
    expect(await footer().getByRole('button', { name: '고객 회신대로 EQ 승인' }).count()).toBe(1);
    expect(await footer().getByRole('button', { name: '개정 EQ 요청(반려)' }).count()).toBe(1);
    await shot('09-forwarded');
    await closeWorkspace();
    await untilText('행 칩 전달됨', rowChip(), '고객 확인 1차 · 전달됨');
  });

  test('A8. 워크큐 EQ 승인 대기 — 회차 칩', async () => {
    await page.goto(`${BASE_URL}/app/admin/pcb/pos?tab=eq_pending&q=${encodeURIComponent(projectName)}&_t=${String(Date.now())}`, {
      waitUntil: 'domcontentloaded',
    });
    const row = page.locator('tr', { hasText: projectName }).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    await untilText('워크큐 칩', row, '고객 확인 1차 · 전달됨');
    await shot('10-workqueue');
  });

  test('A9. 개정 — (API) 반려·재요청 → [직전 회차에서 가져오기] → 동일 문항 연결 → 보내기', async () => {
    const reject = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: '고객 회신 반영 개정 EQ 요청',
    });
    expect(reject.status, JSON.stringify(reject.json)).toBe(200);
    await uploadEq('EQ-factory-r2.xls');
    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(await poStatus()).toBe('eq_requested');

    await openCase();
    await openWorkspace();
    const card = ws().locator('[data-eq-new-round]');
    await card.waitFor({ state: 'visible' });
    expect(await card.innerText()).toContain('2차 회차 시작');
    await card.getByRole('button', { name: '직전 회차에서 가져오기' }).click();
    await untilText('2차 작성 중', ws().locator('[data-eq-round-status]'), '작성 중');
    const draft = (await adminReviews()).find((r) => r.status === 'draft');
    r2 = Number(draft.id);
    expect(draft).toMatchObject({ roundNo: 2, prevReviewId: r1 });
    expect(draft.items.map((i: any) => i.change)).toEqual(['same', 'same']);
    const w = ws();
    expect(await w.locator('[data-eq-item="1"]').innerText()).toContain('동일');
    // 문항 2 를 '변경'으로 — 직전 회차 질문·답이 편집기에 보인다.
    await w.locator('[data-eq-item="2"]').getByRole('button').first().click();
    await untilText('이전 답', w, '이전 답');
    await w.getByRole('radio', { name: '변경' }).click();
    await w.getByLabel(/한국어 질문/).fill('0.2mm 비아를 0.3mm 로 키워도 될까요? (개정)');
    await shot('11-revision-draft');
    await footer().getByRole('button', { name: '고객에게 보내기' }).click();
    await confirmWith('고객에게 보내기');
    await until('2차 발송', async () => (await adminReview(r2))?.status === 'requested');
    const sent = await adminReview(r2);
    expect(sent.items.map((i: any) => i.change)).toEqual(['same', 'changed']);
    // 회차 전환 탭 — 1차로 돌아가 볼 수 있다.
    expect(await ws().getByRole('tab', { name: /1차/ }).count()).toBe(1);
  });

  test('A10. 대리 회신 — 전 문항·의견 필수·근거 메모가 차야 저장된다', async () => {
    await footer().getByRole('button', { name: '대리 회신' }).click();
    const dialog = page.getByRole('dialog', { name: /대리 회신/ });
    await dialog.waitFor({ state: 'visible' });
    const save = dialog.getByRole('button', { name: '대리 회신 저장' });
    expect(await save.isDisabled(), '빈 상태').toBe(true);
    const problems = dialog.locator('[data-eq-proxy-problems]');
    expect(await problems.innerText()).toContain('답을 고르지 않은 항목 1·2');
    expect(await problems.innerText()).toContain('근거 메모 2자 이상');

    await dialog.locator('[data-eq-proxy-item="1"]').getByRole('radio', { name: /위치를 지정하겠습니다/ }).click();
    await untilText('의견 필수', problems, '의견 2자 이상이 필요한 항목 1');
    await shot('12-proxy-validation');
    await dialog.locator('[data-eq-proxy-item="1"]').getByRole('textbox').fill('우측 상단');
    await dialog.locator('[data-eq-proxy-item="2"]').getByRole('radio', { name: /키워도 됩니다/ }).click();
    await dialog.getByLabel(/근거 메모/).fill('1');
    expect(await save.isDisabled(), '메모 1자').toBe(true);
    await dialog.getByLabel(/근거 메모/).fill(`10/11 고객 전화 확인 ${token}`);
    expect(await save.isDisabled(), '다 채움').toBe(false);

    // 의견을 적은 뒤 선택을 바꾸면 알린다(고객 화면과 같은 규칙, 2026-10-11) — 지우지 않고, 저장 때 한 번 묻는다.
    const item1 = dialog.locator('[data-eq-proxy-item="1"]');
    const stale = dialog.locator('[data-eq-proxy-stale="1"]');
    const optA = item1.getByRole('radio', { name: /넣지 않음/ });
    const optB = item1.getByRole('radio', { name: /위치를 지정하겠습니다/ });
    expect(await stale.count(), 'B 에 적은 의견 — 아직 띠 없음').toBe(0);
    await optA.click();
    await stale.waitFor({ state: 'visible' });
    expect(await textOf(stale)).toContain('선택을 바꿨습니다(B → A)');
    expect(await item1.getByRole('textbox').inputValue(), '의견은 지우지 않는다').toBe('우측 상단');
    await shot('12b-proxy-stale');
    await optB.click();
    await until('원래 선택으로 돌아오면 걷힌다', async () => (await stale.count()) === 0);
    await optA.click();
    await stale.waitFor({ state: 'visible' });
    await stale.getByRole('button', { name: '의견 지우기' }).click();
    await until('지우면 걷힌다', async () => (await stale.count()) === 0);
    expect(await item1.getByRole('textbox').inputValue()).toBe('');
    await item1.getByRole('textbox').fill('납기가 급하다고 함');
    await optB.click();
    await stale.waitFor({ state: 'visible' });
    expect(await textOf(stale)).toContain('(A → B)');
    await stale.getByRole('button', { name: '이 의견 그대로 둠' }).click();
    await until('그대로 두면 걷힌다', async () => (await stale.count()) === 0);
    expect(await item1.getByRole('textbox').inputValue(), '의견은 남는다').toBe('납기가 급하다고 함');
    // 띠가 남은 채 저장 — 한 번 묻고, [돌아가서 확인]이면 저장하지 않는다.
    await optA.click();
    await stale.waitFor({ state: 'visible' });
    await save.click();
    await confirmAlert().waitFor({ state: 'visible' });
    expect(await textOf(confirmAlert())).toContain('항목 1: 선택을 바꾼 뒤 의견을 확인하지 않았습니다');
    await shot('12c-proxy-stale-confirm');
    await confirmAlert().getByRole('button', { name: '돌아가서 확인' }).click();
    await confirmAlert().waitFor({ state: 'hidden' });
    expect((await adminReview(r2))?.status, '저장되지 않았다').toBe('requested');
    expect(await dialog.isVisible(), '대리 회신 창은 그대로').toBe(true);
    // 고쳐서 저장 — 띠가 없으면 묻지 않는다.
    await optB.click();
    await item1.getByRole('textbox').fill('우측 상단');
    await until('의견을 고치면 걷힌다', async () => (await stale.count()) === 0);
    await save.click();
    await until('대리 회신', async () => (await adminReview(r2))?.status === 'answered');
    const answered = await adminReview(r2);
    expect(answered).toMatchObject({ answeredRole: 'admin', answerChannel: 'phone' });
    expect(answered.items.map((i: any) => [i.answer?.key, i.answer?.comment ?? null])).toEqual([
      ['B', '우측 상단'],
      ['A', null],
    ]);
    await untilText('대리 회신 경로', ws().locator('header'), '대리 회신 · 전화');
    // 회신서 엑셀 — 담당자가 대신 넣은 답이면 그 사실과 경로가 관리자용 파일에 적힌다(2차는 A9 의 반려·재요청 뒤 = EQ 요청 2차).
    const proxySheet = await fetchXlsx(A, `${adminBase()}/${String(r2)}/reply-xlsx`);
    expect(proxySheet).toMatchObject({ status: 200, fileName: `EQ-Reply_${projectName}_PO-${String(poId)}_2차.xlsx` });
    const proxyText = xlsxText(proxySheet.buffer);
    expect(proxyText).toContain('담당자 대리 입력 — 경로: 전화');
    expect(proxyText).toContain('EQ 요청: 2차');
    expect(proxyText).toContain('고객 확인: 2차');
    expect(proxyText, '대리로 넣은 의견').toContain('우측 상단');
    await shot('13-proxy-answered');
  });

  test('A11. 1280px 미만은 편집 칸 안에서 미리보기·활동 탭, 390px 은 가로 넘침 0', async () => {
    await page.setViewportSize({ width: 1100, height: 900 });
    const w = ws();
    const midTabs = w.getByRole('tablist', { name: '편집·고객 미리보기·활동 전환' });
    await midTabs.waitFor({ state: 'visible' });
    await midTabs.getByRole('tab', { name: '고객 미리보기' }).click();
    await untilText('좁은 화면 미리보기', w, '고객에게 보일 모습');
    await shot('14-1100-preview');
    await midTabs.getByRole('tab', { name: '활동' }).click();
    await untilText('좁은 화면 활동', w, '관리자 대리 회신');
    await shot('15-1100-activity');
    await midTabs.getByRole('tab', { name: /문항|편집/ }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(400);
    const overflow = await page.evaluate(() => {
      const out: string[] = [];
      const root = document.documentElement;
      if (root.scrollWidth > window.innerWidth + 1) out.push(`document ${String(root.scrollWidth)}>${String(window.innerWidth)}`);
      const sheet = document.querySelector<HTMLElement>('[data-eq-workspace]');
      if (sheet === null) return ['작업공간 없음'];
      if (sheet.scrollWidth > sheet.clientWidth + 1) out.push(`sheet ${String(sheet.scrollWidth)}>${String(sheet.clientWidth)}`);
      for (const el of Array.from(sheet.querySelectorAll<HTMLElement>('header, footer, .overflow-y-auto'))) {
        if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName}.${el.className.slice(0, 40)} ${String(el.scrollWidth)}>${String(el.clientWidth)}`);
      }
      return out;
    });
    expect(overflow, '390px 가로 넘침').toEqual([]);
    await shot('16-390');
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(admin.pageErrors, '페이지 오류').toEqual([]);
  });

  // 2026-10-11 — 생산이 시작되면 EQ 는 끝난 일이다. EQ 줄은 한 줄로 접히고, [이력 보기]로 펴면 요청 회차마다
  // 그때의 파일·고객 확인·결말이 읽기 전용으로 보인다(조작은 없다).
  test('A12. 생산 시작 뒤 — EQ 줄이 한 줄로 접히고, [이력 보기]로 회차별 기록을 읽기 전용으로 본다', async () => {
    await closeWorkspace().catch(() => undefined);
    const approved = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-approve`, {});
    expect(approved.status, `EQ 승인: ${JSON.stringify(approved.json)}`).toBe(200);
    const started = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/production-start`);
    expect(started.status, `생산 시작: ${JSON.stringify(started.json)}`).toBe(200);
    expect(await poStatus()).toBe('producing');

    await openCase();
    const band = page.locator('tr[data-eq-band]').first();
    await band.locator('[data-eq-band-collapsed]').waitFor();
    const line = (await band.innerText()).replace(/\s+/g, ' ');
    expect(line).toContain('EQ 완료');
    expect(line, '요청 회차 — A9 의 반려·재요청으로 둘').toContain('요청 2회');
    expect(line, '고객 확인 회차 — 1차·2차').toContain('고객 확인 2회');
    expect(await band.getByRole('button', { name: 'EQ 열기', exact: true }).count(), '접혀도 [EQ 열기]는 남는다').toBe(1);
    expect(await band.locator('[data-eq-round]').count(), '접힌 동안엔 회차 칩이 없다').toBe(0);
    // 행 액션 — 협력2 는 포털 계정이 있어 생산 완료 대행은 스위치가 꺼진 동안 숨는다. 송금·조건 수정은 그대로.
    const row = page.locator('tr[data-po-row]').first();
    expect(await row.getByRole('button', { name: '생산 완료 대행', exact: true }).count(), '대행은 숨김').toBe(0);
    expect(await row.getByRole('button', { name: '송금', exact: true }).count()).toBe(1);
    await shot('17-band-collapsed');

    await band.locator('[data-eq-band-toggle]').click();
    const chips = band.locator('[data-eq-round]');
    expect(await chips.allInnerTexts().then((t) => t.map((x) => x.trim())), '회차 칩').toEqual(['1차', '2차']);
    expect(await chips.nth(0).getAttribute('data-eq-round-outcome'), '1차 = 반려로 닫힘').toBe('rejected');
    expect(await chips.nth(1).getAttribute('data-eq-round-outcome'), '2차 = 승인').toBe('approved');
    expect(await chips.nth(1).getAttribute('aria-pressed'), '기본은 최신').toBe('true');
    expect(await band.locator('[data-eq-band-submit]').innerText(), '2차의 파일').toContain('EQ-factory-r2.xls');
    await untilText('2차의 고객 확인', rowChip(), '고객 확인 2차');
    expect(await band.locator('[data-eq-band-judge]').innerText(), '2차의 결말').toContain('EQ 승인');
    // 생산이 시작된 뒤에는 판정·대행·첨부 어느 것도 없다 — 기록이다.
    expect(await band.getByRole('button', { name: /^(EQ 승인|반려|승인 취소|회신 첨부)$/ }).count(), '조작 버튼 없음').toBe(0);
    await shot('18-band-expanded');

    // 1차 — 반려로 닫혔다. 그때의 파일·고객 답·반려 사유 전문.
    await chips.nth(0).click();
    await band.locator('[data-eq-band-readonly]').waitFor();
    expect(await band.locator('[data-eq-band-submit]').innerText(), '1차의 파일').toContain('EQ-factory-r1.xls');
    await untilText('1차의 고객 확인', rowChip(), '고객 확인 1차 · 전달됨');
    expect(await band.locator('[data-eq-band-judge]').innerText(), '1차의 결말').toContain('반려됨');
    expect(await band.locator('[data-eq-band-note]').innerText(), '반려 사유 전문').toContain('고객 회신 반영 개정 EQ 요청');
    await shot('19-band-round1');

    await band.locator('[data-eq-band-toggle]').click();
    await band.locator('[data-eq-band-collapsed]').waitFor();
    expect(admin.pageErrors, '페이지 오류').toEqual([]);
  });
});
