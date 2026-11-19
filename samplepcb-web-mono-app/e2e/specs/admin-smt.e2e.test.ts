// SMT 관리자 화면 — 받은 견적 목록 · 견적 상세 · 연동 상태 (docs/SMARTSMT_INTEGRATION.md §4.6)
//
// 무엇을 지키는가:
//   ① 목록: 주문 단위 한 줄 · 탭 건수 · 최종 금액이 null 이면 '미정'(0원이 아니다) + SMT 작업비 보조 · 상태/막힘/회원 아님 표지
//   ② 상세: 금액(통합 합계) · 견적 줄 · 블록 사유("합계에 드는가") · 동봉 파일 · 이력, 파일 내려받기가 실제 내용을 준다
//   ③ 이력에서 이전 견적으로 옮겨 가고 '최신 견적 아님'이 붙는다, 목록 복귀가 검색을 지킨다
//   ④ 연동 상태에 수신 기록이 보인다(SmartSMT 가 보낸 시도)
//   ⑤ 가져오기 대화상자가 실패하면 입력을 둔 채 서버 문장을 보인다
//
// 준비: 수신 주소(POST /api/smartsmt/quotes)에 견적 4건을 SmartSMT 처럼 보낸다(가짜 견본 + SmartSMT 전용 토큰).
//   (a) 주문 A 정상  (b) 주문 A 두 번째 견적 — 검토 필요 + 합계 막힘  (c) 주문 C 파일 없이  (d) 주문 D 우리 회원이 아닌 주인
// 주문 번호는 SIM-E2E-<실행 꼬리>- 로 시작한다. 정리(afterAll)는 실패해도 돌고, 이 실행이 만든 것만 지운다:
//   파일서버 파일 → sp_file(refType sp_smt_quote) → sp_smt_order(견적은 cascade) → sp_smt_receive_log(이 주문 번호).
//
// ⚠ 가져오기 시험(⑤)은 실제 SmartSMT 개발 서버로 나간다 — 한 번만 부른다. 2026-11-13 현재 SmartSMT 가 아직
//   X-API-Key 방식이라 SMARTSMT_AUTH_REJECTED 가 온다(토큰 방식으로 바뀌면 404 NOT_FOUND 가 온다 — 둘 다 실패 문장).
//
// 실행: cd e2e && PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca npx vitest run admin-smt
// 사전: API(3333) · 웹(5173, nginx local-web) · apps/api/.env 의 SMARTSMT_SHARED_SECRET · 파일서버
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  apiDir,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newSession,
  signJwt,
  snap,
  type E2eSession,
} from '../helpers';
import { buildSampleEnvelope, buildSampleMultipart, sampleFiles } from '../../apps/api/src/lib/smartsmt-sample';
import type { SmartsmtSampleOptions } from '../../apps/api/src/lib/smartsmt-sample';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken } from '../../apps/api/src/lib/smartsmt-token';

/** apps/api/.env 의 값 하나 — 비밀은 로그·단언 메시지에 싣지 않는다. */
function readApiEnv(key: string): string | null {
  const text = readFileSync(join(apiDir, '.env'), 'utf8');
  const value = new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
  return value === '' ? null : value;
}

const RUN_TAG = Date.now().toString(36).toUpperCase();
const PREFIX = `SIM-E2E-${RUN_TAG}-`;
const ORDER_A = `${PREFIX}A`;
const ORDER_C = `${PREFIX}C`;
const ORDER_D = `${PREFIX}D`;
const ORDER_E = `${PREFIX}E`;
const QUOTE_A1 = `Q-E2E-${RUN_TAG}-A1`;
const QUOTE_A2 = `Q-E2E-${RUN_TAG}-A2`;
const QUOTE_C1 = `Q-E2E-${RUN_TAG}-C1`;
const QUOTE_D1 = `Q-E2E-${RUN_TAG}-D1`;
const QUOTE_E1 = `Q-E2E-${RUN_TAG}-E1`;
const NON_MEMBER = `sim-e2e-nobody-${RUN_TAG.toLowerCase()}`;

const FILE_SERVER_URL = process.env.FILE_SERVER_URL ?? readApiEnv('FILE_SERVER_URL') ?? 'https://file.samplepcb.kr';
const ADMIN = { mbId: 'e2e-admin', isAdmin: true } as const;

interface Counts {
  all: number;
  review: number;
  undetermined: number;
}
interface FileRow {
  id: bigint;
  pathToken: string;
}
interface OrderRow {
  quotes: { id: bigint }[];
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
  } catch (e) {
    throw new Error(`${url} 도달 실패 — ${hint}\n(${e instanceof Error ? e.message : String(e)})`);
  }
}

async function adminCounts(): Promise<Counts> {
  const r = await api(signJwt(ADMIN), 'GET', '/api/admin/smt/orders?page=1&pageSize=1');
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const counts = r.json?.data?.counts as Counts | undefined;
  if (counts === undefined) throw new Error('목록 응답에 counts 가 없습니다');
  return counts;
}

interface SendOptions {
  orderId: string;
  quoteId: string;
  madeAt: string;
  owner: { mbId: string; name: string };
  withFiles: boolean;
  review?: boolean;
  blocked?: boolean;
  /** 실제로 받은 모양(envelope_version 9) — 확정 금액 미정 + 추정 금액. */
  version9?: boolean;
}

/** SmartSMT 처럼 견적서를 보낸다 — multipart(envelope + 번호 + 파일) + SmartSMT 전용 토큰(iss=smartsmt, aud=samplepcb). */
async function sendQuote(secret: string, o: SendOptions): Promise<void> {
  const files = o.withFiles ? sampleFiles() : [];
  const options: SmartsmtSampleOptions = {
    orderId: o.orderId,
    quoteId: o.quoteId,
    madeAt: o.madeAt,
    ownerMbId: o.owner.mbId,
    ownerName: o.owner.name,
    files,
    blocked: o.blocked === true,
    quoteStatus: o.review === true ? 'REVIEW_REQUIRED' : 'CALCULATED',
    review: o.version9 === true,
  };
  const { boundary, body } = buildSampleMultipart(buildSampleEnvelope(options), files, {
    quoteId: o.quoteId,
    orderId: o.orderId,
  });
  const token = signSmartsmtToken(secret, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF });
  const res = await fetch(`${API_URL}/api/smartsmt/quotes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const text = await res.text();
  expect(res.status, `${o.quoteId}: ${text}`).toBe(200);
  expect((JSON.parse(text) as { data: { duplicate: boolean } }).data.duplicate).toBe(false);
}

/** 이 실행이 만든 것만 지운다 — 파일서버 → sp_file → 주문(견적 cascade) → 수신 기록. 남은 행 수를 돌려준다. */
async function cleanup(): Promise<number> {
  const prisma = getPrisma();
  const orders = (await prisma.spSmtOrder.findMany({
    where: { orderId: { startsWith: PREFIX } },
    select: { quotes: { select: { id: true } } },
  })) as OrderRow[];
  const quoteIds = orders.flatMap((order) => order.quotes.map((quote) => quote.id));
  const files =
    quoteIds.length === 0
      ? []
      : ((await prisma.spFile.findMany({
          where: { refType: 'sp_smt_quote', refId: { in: quoteIds } },
          select: { id: true, pathToken: true },
        })) as FileRow[]);
  for (const file of files) {
    const res = await fetch(`${FILE_SERVER_URL}/api/delete/${encodeURIComponent(file.pathToken)}`).catch(() => null);
    if (res === null || (!res.ok && res.status !== 404)) {
      console.warn(`[admin-smt] 파일서버 삭제 실패 sp_file#${String(file.id)} http=${String(res?.status ?? 'network')}`);
    }
  }
  if (files.length > 0) await prisma.spFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
  await prisma.spSmtOrder.deleteMany({ where: { orderId: { startsWith: PREFIX } } });
  await prisma.spSmtReceiveLog.deleteMany({ where: { orderId: { startsWith: PREFIX } } });

  const left =
    ((await prisma.spSmtOrder.count({ where: { orderId: { startsWith: PREFIX } } })) as number) +
    ((await prisma.spSmtQuote.count({ where: { quoteId: { startsWith: `Q-E2E-${RUN_TAG}-` } } })) as number) +
    ((await prisma.spSmtReceiveLog.count({ where: { orderId: { startsWith: PREFIX } } })) as number) +
    (quoteIds.length === 0
      ? 0
      : ((await prisma.spFile.count({ where: { refType: 'sp_smt_quote', refId: { in: quoteIds } } })) as number));
  return left;
}

const tabText = async (page: Page, name: string): Promise<string> =>
  ((await page.getByRole('tab', { name: new RegExp(`^${name}`) }).textContent()) ?? '').replace(/\s+/g, '');

const orderRow = (page: Page, orderId: string) => page.getByTestId(`smt-order-${orderId}`);

/** 전체 쪽 스크린샷 — 맨 위로 올린 뒤 찍는다(고정 사이드바·머리가 스크롤 자리에 찍혀 본문을 가리지 않게). */
async function snapTop(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await snap(page, name);
}

describe.skipIf(!RUN)('SMT 관리자 화면 — 받은 견적 · 상세 · 연동 상태', () => {
  let baseline: Counts;
  let member: string;
  let session: E2eSession;
  let detailA2Url = '';
  let sharedSecret = '';

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'API 서버를 켜세요 (127.0.0.1:3333)');
    await mustReach(`${BASE_URL}/app/`, 'nginx 와 웹(5173)을 확인하세요');
    const secret = readApiEnv('SMARTSMT_SHARED_SECRET');
    if (secret === null) throw new Error('apps/api/.env 에 SMARTSMT_SHARED_SECRET 이 없습니다');
    sharedSecret = secret;

    // 회원 대조에 쓸 실제 회원 하나(dev 상비 계정 tester 우선).
    const rows = (await getPrisma().$queryRawUnsafe(
      `SELECT mb_id FROM g5_member ORDER BY (mb_id = 'tester') DESC, mb_no ASC LIMIT 1`,
    )) as { mb_id: string }[];
    const found = rows[0]?.mb_id;
    if (found === undefined) throw new Error('g5_member 에 회원이 없습니다');
    member = found;

    baseline = await adminCounts();
    const now = Date.now();
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    const owner = { mbId: member, name: 'E2E 고객' };
    await sendQuote(secret, { orderId: ORDER_A, quoteId: QUOTE_A1, madeAt: at(120), owner, withFiles: true });
    await sendQuote(secret, {
      orderId: ORDER_A,
      quoteId: QUOTE_A2,
      madeAt: at(60),
      owner,
      withFiles: true,
      review: true,
      blocked: true,
    });
    await sendQuote(secret, { orderId: ORDER_C, quoteId: QUOTE_C1, madeAt: at(30), owner, withFiles: false });
    await sendQuote(secret, {
      orderId: ORDER_D,
      quoteId: QUOTE_D1,
      madeAt: at(20),
      owner: { mbId: NON_MEMBER, name: '외부 고객' },
      withFiles: false,
    });

    session = await newSession(ADMIN, { localStorage: { 'sp-theme': 'light' } });
  });

  afterAll(async () => {
    let left = -1;
    try {
      left = await cleanup();
    } finally {
      await session?.close();
      await closeBrowser();
      await disconnectPrisma();
    }
    if (left !== 0) throw new Error(`정리 뒤 ${PREFIX} 잔재 ${String(left)}행`);
  });

  test('목록 — 주문 한 줄 · 탭 건수 · 미정 표기 · 배지', async () => {
    const { page } = session;
    await page.goto(`/app/admin/smt/quotes?q=${encodeURIComponent(PREFIX)}`);
    await orderRow(page, ORDER_A).waitFor();
    expect(await page.locator(`[data-testid^="smt-order-${PREFIX}"]`).count()).toBe(3);

    // 탭 건수는 검색어를 뺀 전체 기준 — 이 실행이 더한 만큼 늘었다.
    expect(await tabText(page, '전체')).toBe(`전체${String(baseline.all + 3)}`);
    expect(await tabText(page, '검토 필요')).toBe(`검토필요${String(baseline.review + 1)}`);
    expect(await tabText(page, '합계 미확정')).toBe(`합계미확정${String(baseline.undetermined + 1)}`);

    // 주문 A — 마지막 견적(A2)이 대표: 최종 금액 미정 + SMT 작업비 보조, 검토 필요 · 합계 막힘, 견적 2건.
    const rowA = (await orderRow(page, ORDER_A).textContent()) ?? '';
    expect(rowA).toContain('미정');
    expect(rowA).toContain('SMT 작업비 1,042,826원');
    expect(rowA).toContain('검토 필요');
    expect(rowA).toContain('합계 막힘: PCB');
    expect(rowA).toContain(member);
    expect(rowA).toContain('샘플');
    expect(rowA).not.toContain('회원 아님');
    expect(((await orderRow(page, ORDER_A).locator('td').nth(6).textContent()) ?? '').trim()).toBe('2');

    // 주문 C — 정상: 최종 금액(통합 합계)이 금액으로, 미정 아님.
    const rowC = (await orderRow(page, ORDER_C).textContent()) ?? '';
    expect(rowC).toContain('1,186,232원');
    expect(rowC).toContain('계산 완료');
    expect(rowC).not.toContain('미정');

    // 주문 D — 우리 회원이 아닌 주인.
    const rowD = (await orderRow(page, ORDER_D).textContent()) ?? '';
    expect(rowD).toContain('회원 아님');
    expect(rowD).toContain(NON_MEMBER);

    // 모듈 배선 — 스위처의 SMT 가 켜지고, 옛 화면이 없으니 '이전 화면'이 없다.
    expect(await page.locator('nav[aria-label="업무 모듈"] a[aria-current="page"]').textContent()).toContain('SMT');
    expect(await page.getByRole('link', { name: /이전 화면/ }).count()).toBe(0);

    await snapTop(page, 'admin-smt-list');

    // 탭 — 검토 필요 · 합계 미확정에는 주문 A 만.
    for (const name of ['검토 필요', '합계 미확정']) {
      await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      await page.waitForURL(/tab=(review|undetermined)/);
      await expect.poll(() => page.locator(`[data-testid^="smt-order-${PREFIX}"]`).count()).toBe(1);
      expect(await orderRow(page, ORDER_A).count()).toBe(1);
    }
    await page.getByRole('tab', { name: /^전체/ }).click();
    await expect.poll(() => page.locator(`[data-testid^="smt-order-${PREFIX}"]`).count()).toBe(3);
  });

  test('줄을 눌러 상세 — 금액 · 견적 줄 · 블록 사유 · 파일 · 이력', async () => {
    const { page } = session;
    await orderRow(page, ORDER_A).click();
    await page.waitForURL(/\/app\/admin\/smt\/quotes\/\d+/);
    await page.getByTestId('smt-lines').waitFor();
    detailA2Url = page.url();

    const heading = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
    expect(heading).toContain(ORDER_A);
    expect(heading).toContain(QUOTE_A2);

    const amounts = (await page.getByTestId('smt-amounts').textContent()) ?? '';
    expect(amounts).toContain('미정');
    expect(amounts).toContain('1,042,826원');
    expect(amounts).toContain('KRW');
    await page.getByText('합계가 막혔습니다: PCB').waitFor();

    // 주문 정보 — 견적서 머리의 칸을 라벨 사전으로(양면·도급·샘플), 요율 판, 고객.
    const body = await page.locator('body').innerText();
    for (const text of ['주문 정보', 'PRICING_V1', '양면', '도급', '대기', 'E2E 고객', member]) expect(body).toContain(text);

    const lines = (await page.getByTestId('smt-lines').textContent()) ?? '';
    for (const text of ['STN-01', '메탈마스크 제작', '120,000원 × 1 SET', '간접비', '기업이윤']) expect(lines).toContain(text);
    // 합계는 항목에서 계산된다 — 줄 120,000 → 간접비 9,600 · 이윤 12,960 = 공급가액 142,560(PCB 는 금액이 비어 0 으로 센다).
    const costs = (await page.getByTestId('smt-costs').textContent()) ?? '';
    for (const text of ['120,000원', '22,560원', '142,560원', '14,256원', '156,816원']) expect(costs).toContain(text);
    expect((await page.getByTestId('smt-review-status').textContent()) ?? '').toContain('고치지 않음');

    const blocks = (await page.getByTestId('smt-blocks').textContent()) ?? '';
    for (const text of ['PCB', 'GerberEye', '몇 장분인지 확인되지 않음', 'QTY_UNVERIFIED', '금액은 있지만 안 든다']) {
      expect(blocks).toContain(text);
    }

    const files = page.getByTestId('smt-files');
    expect(await files.locator('tbody tr').count()).toBe(3);
    const filesText = (await files.textContent()) ?? '';
    for (const text of ['sample-board.zip', 'sample-bom.csv', 'sample-cpl.csv', '제조 파일 묶음', 'BOM', 'CPL']) {
      expect(filesText).toContain(text);
    }
    expect(await files.getByText('일치').count()).toBe(3);

    const history = page.getByTestId('smt-history');
    expect(await history.locator('tbody tr').count()).toBe(2);
    const historyText = (await history.textContent()) ?? '';
    expect(historyText).toContain(QUOTE_A1);
    expect(historyText).toContain(QUOTE_A2);
    expect(historyText).toContain('최신');

    // 처음 연 모양(요율·원문은 접힘) 그대로 한 장 — 그다음 접힌 섹션을 펴서 확인한다.
    await snapTop(page, 'admin-smt-detail');
    await page.getByRole('button', { name: /요율 · 제어값/ }).click();
    const settings = await page.locator('body').innerText();
    for (const text of ['policy.vat_rate', 'stencil.fixed', '120000']) expect(settings).toContain(text);
    await page.getByRole('button', { name: /원문/ }).click();
    expect((await page.getByTestId('smt-raw').textContent()) ?? '').toContain(`"order_id": "${ORDER_A}"`);
    await snapTop(page, 'admin-smt-detail-expanded');
  });

  test('동봉 파일 내려받기 — 실제 내용을 준다', async () => {
    const { page } = session;
    const expected = sampleFiles().find((file) => file.part === 'bom')?.buffer.toString('utf8');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'sample-bom.csv 내려받기' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('sample-bom.csv');
    expect(readFileSync(await download.path(), 'utf8')).toBe(expected);
  });

  test('이력에서 이전 견적으로 — 최신 견적 아님, 목록 복귀는 검색을 지킨다', async () => {
    const { page } = session;
    await page.getByTestId('smt-history').locator('tbody tr').filter({ hasText: QUOTE_A1 }).click();
    await page.getByRole('heading', { level: 1, name: new RegExp(QUOTE_A1) }).waitFor();
    expect(page.url()).not.toBe(detailA2Url);
    await page.getByText('최신 견적 아님').waitFor();
    const amounts = (await page.getByTestId('smt-amounts').textContent()) ?? '';
    expect(amounts).toContain('1,186,232원');
    expect(amounts).not.toContain('미정');
    expect(await page.getByText('합계가 막혔습니다').count()).toBe(0);

    await page.getByRole('link', { name: '받은 견적으로' }).click();
    await page.waitForURL(/\/app\/admin\/smt\/quotes\?/);
    expect(new URL(page.url()).searchParams.get('q')).toBe(PREFIX);
    await orderRow(page, ORDER_A).waitFor();
  });

  test('어두운 테마의 상세 한 장', async () => {
    const dark = await newSession(ADMIN, { localStorage: { 'sp-theme': 'dark' } });
    try {
      await dark.page.goto(detailA2Url);
      await dark.page.getByTestId('smt-lines').waitFor();
      expect(await dark.page.locator('html').getAttribute('data-theme')).toBe('dark');
      await snapTop(dark.page, 'admin-smt-detail-dark');
      expect(dark.pageErrors).toEqual([]);
    } finally {
      await dark.close();
    }
  });

  test('연동 상태 — 설정과 수신 기록', async () => {
    const { page } = session;
    await page.locator('[data-sidebar="sidebar"] a[href="/app/admin/smt/link"]').click();
    await page.getByTestId('smt-link-settings').waitFor();
    const settings = (await page.getByTestId('smt-link-settings').textContent()) ?? '';
    expect(settings).toContain('/api/smartsmt/quotes');
    expect(settings).toContain('/spcb/sso/smartsmt');
    expect(settings).toContain('설정됨');

    await page.getByTestId('smt-log-filter').selectOption('accepted');
    const logs = page.getByTestId('smt-receive-logs');
    await expect.poll(async () => logs.locator('tbody tr').filter({ hasText: PREFIX }).count()).toBe(4);
    for (const quoteId of [QUOTE_A1, QUOTE_A2, QUOTE_C1, QUOTE_D1]) {
      const row = logs.locator('tbody tr').filter({ hasText: quoteId });
      expect((await row.textContent()) ?? '').toContain('받음');
    }
    await snapTop(page, 'admin-smt-link');

    // 주문 번호 → 받은 견적 검색.
    await logs.getByRole('link', { name: ORDER_C }).click();
    await page.waitForURL(/\/app\/admin\/smt\/quotes\?/);
    await orderRow(page, ORDER_C).waitFor();
  });

  test('옛 셸의 모듈 스위처도 SMT 를 리뉴얼 화면으로 건다(옛 SMT 화면은 없다)', async () => {
    // 옛 화면 안에서 스위처는 이름을 'admin-legacy-*' 로 바꿔 건다 — SMT 는 옛 이름이 없으니 그대로 둬야 한다
    // (바꾸면 없는 라우트라 옛 셸 머리가 그려지지 않는다). 옛 대시보드는 이 시험의 대상이 아니라 별도 세션으로 연다.
    const legacy = await newSession(ADMIN, { localStorage: { 'sp-theme': 'light' } });
    try {
      await legacy.page.goto('/app/admin/legacy');
      const link = legacy.page.locator('header nav a', { hasText: 'SMT' });
      await link.waitFor();
      expect(await link.getAttribute('href')).toBe('/app/admin/smt/quotes');
      await link.click();
      await legacy.page.getByRole('heading', { level: 1, name: '받은 견적' }).waitFor();
    } finally {
      await legacy.close();
    }
  });

  test('가져오기 대화상자 — 실패하면 입력을 둔 채 서버 문장을 보인다 (실제 SmartSMT 1회)', async () => {
    const { page } = session;
    const pullOrder = `${PREFIX}PULL`;
    await page.getByRole('button', { name: '견적서 가져오기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const input = dialog.getByRole('textbox');
    await input.fill(pullOrder);
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click();

    const alert = dialog.getByRole('alert');
    await alert.waitFor({ timeout: 30_000 });
    const message = (await alert.textContent()) ?? '';
    console.log(`[admin-smt] 가져오기 실패 문장: ${message}`);
    expect(message).toMatch(/SmartSMT/);
    expect(await input.inputValue()).toBe(pullOrder);
    expect(await dialog.isVisible()).toBe(true);

    await dialog.getByRole('button', { name: '취소' }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(session.pageErrors).toEqual([]);
  });

  // 2026-11-18 에 실제로 받은 견적서의 모양 — 확정 금액은 전부 미정이고 추정 금액이 따로 온다.
  // 앞의 건수 검증이 끝난 뒤에 보낸다(탭 건수를 흔들지 않게). 정리는 PREFIX 로 함께 된다.
  test('실제로 받은 모양(판 9) — 확정은 미정, 추정 금액 · 수량 · 공정 · 블록 이름을 읽는다', async () => {
    const { page } = session;
    await sendQuote(sharedSecret, {
      orderId: ORDER_E,
      quoteId: QUOTE_E1,
      madeAt: new Date().toISOString(),
      owner: { mbId: member, name: 'E2E 고객' },
      withFiles: false,
      version9: true,
    });

    await page.goto(`/app/admin/smt/quotes?q=${encodeURIComponent(ORDER_E)}`);
    await orderRow(page, ORDER_E).waitFor();
    const rowE = (await orderRow(page, ORDER_E).textContent()) ?? '';
    expect(rowE).toContain('미정');
    expect(rowE).toContain('추정 509,575원');
    expect(rowE).not.toContain('SMT 작업비 미정');
    expect(rowE).toContain('합계 막힘: 부품, 배송, SMT 작업비');

    await orderRow(page, ORDER_E).click();
    await page.waitForURL(/\/app\/admin\/smt\/quotes\/\d+/);
    await page.getByTestId('smt-lines').waitFor();

    // 확정 금액은 미정 그대로 — 추정은 이름을 붙여 따로.
    expect((await page.getByTestId('smt-amounts').textContent()) ?? '').toContain('미정');
    const estimates = (await page.getByTestId('smt-estimates').textContent()) ?? '';
    for (const text of ['확정 금액이 아닙니다', '463,250원', '46,325원', '509,575원', '396,979원', '추정에 든 블록: PCB, 부품, SMT 작업비']) {
      expect(estimates).toContain(text);
    }
    await page.getByText('합계가 막혔습니다: 부품, 배송, SMT 작업비').waitFor();

    const body = await page.locator('body').innerText();
    for (const text of [
      '주문 공정',
      'PCB · 부품 · 메탈마스크 · SMT',
      '제작 수량 (SET)',
      '가격 기준 수량 (SET)',
      '기본 포장',
      'PCB 사양 (고객 입력)',
      'surfaceFinish',
      '긴급 제작',
      '긴급 제작 테스트입니다',
    ]) {
      expect(body).toContain(text);
    }
    // 고객 요청은 글만 — 쓴 사람 정보(JSON)를 그대로 쏟지 않는다.
    expect(body).not.toContain('"mb_id"');

    const lines = (await page.getByTestId('smt-lines').textContent()) ?? '';
    for (const text of ['메탈마스크', 'SMT', '피더 작업비', '입력값 없음', '배송', '관리자가 정합니다']) expect(lines).toContain(text);

    const blocks = (await page.getByTestId('smt-blocks').textContent()) ?? '';
    for (const text of ['부품', '배송', 'GerberEye', 'PartsEyes', '사람이 입력', '입력 대기', '추정', '일부', '사람이 적을 값이 오지 않음']) {
      expect(blocks).toContain(text);
    }
    expect(blocks).not.toContain('WAITING_INPUT');

    await snapTop(page, 'admin-smt-detail-v9');

    // ── 항목별로 금액을 고친다 — 총액은 입력하지 않고 계산돼 나온다 ──────────────────────────────────
    const total = page.getByTestId('smt-review-total');
    const confirm = page.getByTestId('smt-review-confirm');
    // SmartSMT 금액 그대로: 줄 120,000 → 간접비 9,600 · 이윤 12,960, + PCB 87,000 + 부품 15,360 = 244,920 → 합계 269,412.
    expect(((await total.textContent()) ?? '').trim()).toBe('269,412원');
    const empty = (await page.getByTestId('smt-sheet-empty').textContent()) ?? '';
    expect(empty).toContain('2건');
    expect(empty).toContain('피더 작업비');
    expect(empty).toContain('배송');
    expect(await confirm.isDisabled()).toBe(true);

    // 빈 항목 둘을 채운다 — 피더 작업비 30,000 · 배송 5,000.
    await page.getByTestId('smt-row-SMT-P03').getByRole('textbox').fill('30,000');
    await expect.poll(async () => ((await total.textContent()) ?? '').trim()).toBe('308,616원');
    await page.getByTestId('smt-row-SHIPPING').getByRole('textbox').fill('5000');
    // 줄 150,000 → 간접비 12,000 · 이윤 16,200, + 87,000 + 15,360 + 5,000 = 285,560 → 부가세 28,556 → 314,116.
    await expect.poll(async () => ((await total.textContent()) ?? '').trim()).toBe('314,116원');
    expect((await page.getByTestId('smt-row-indirect').textContent()) ?? '').toContain('12,000원');
    expect((await page.getByTestId('smt-row-profit').textContent()) ?? '').toContain('16,200원');
    expect(await page.getByTestId('smt-sheet-empty').count()).toBe(0);
    expect(await confirm.isDisabled()).toBe(false);

    // 숫자가 아니면 저장할 수 없다.
    await page.getByTestId('smt-row-STN-01').getByRole('textbox').fill('십만원');
    await page.getByText('금액은 0 이상의 숫자로 넣어 주세요.').waitFor();
    expect(await page.getByTestId('smt-review-save').isDisabled()).toBe(true);
    await page.getByTestId('smt-row-STN-01').getByRole('textbox').fill('');

    // 임시 저장 → 새로 불러와도 남아 있다.
    await page.locator('#smt-review-note').fill('피더 작업비와 배송비를 반영했습니다.');
    await page.getByTestId('smt-review-save').click();
    await page.getByText('임시 저장했습니다.').waitFor();
    await expect.poll(async () => (await page.getByTestId('smt-review-status').textContent()) ?? '').toContain('임시 저장');
    await page.reload();
    await page.getByTestId('smt-lines').waitFor();
    expect(await page.getByTestId('smt-row-SMT-P03').getByRole('textbox').inputValue()).toBe('30000');
    expect(await page.getByTestId('smt-row-SHIPPING').getByRole('textbox').inputValue()).toBe('5000');
    expect(await page.locator('#smt-review-note').inputValue()).toBe('피더 작업비와 배송비를 반영했습니다.');
    expect(((await page.getByTestId('smt-review-total').textContent()) ?? '').trim()).toBe('314,116원');

    // 확정 → 목록에 확정 합계가 보인다.
    await page.getByTestId('smt-review-confirm').click();
    await page.getByText('확정했습니다.').waitFor();
    await expect.poll(async () => (await page.getByTestId('smt-review-status').textContent()) ?? '').toContain('확정');
    await page.goto(`/app/admin/smt/quotes?q=${encodeURIComponent(ORDER_E)}`);
    await orderRow(page, ORDER_E).waitFor();
    expect((await orderRow(page, ORDER_E).getByTestId('smt-row-confirmed').textContent()) ?? '').toContain('확정 314,116원');

    // 되돌리기 → SmartSMT 금액으로.
    await orderRow(page, ORDER_E).click();
    await page.getByTestId('smt-lines').waitFor();
    await page.getByTestId('smt-review-revert').click();
    await page.getByText('SmartSMT 가 보낸 금액으로 되돌렸습니다.').waitFor();
    await expect.poll(async () => (await page.getByTestId('smt-review-status').textContent()) ?? '').toContain('고치지 않음');
    expect(await page.getByTestId('smt-row-SMT-P03').getByRole('textbox').inputValue()).toBe('');
    expect(((await page.getByTestId('smt-review-total').textContent()) ?? '').trim()).toBe('269,412원');
    expect(session.pageErrors).toEqual([]);
  });
});
