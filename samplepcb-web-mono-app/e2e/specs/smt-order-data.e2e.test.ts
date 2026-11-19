// SMT 의뢰 데이터 — samplepcb 가 보관하고 SmartSMT 가 읽어 간다 (docs/SMARTSMT_INTEGRATION.md §10)
//
// 무엇을 지키는가:
//   ① SmartSMT 가 견적서와 함께 보낸 작업 상태(state) · 원본 파일 · 의뢰 이름을 그대로 보관하고,
//      읽기 주소(목록 · 한 건 · 파일)가 **그 회원에게만** 보낸 그대로 돌려준다(작업 상태는 뜻을 보지 않는다)
//   ② 다른 회원 아이디로는 없는 의뢰와 똑같이 404 다
//   ③ 마이페이지 견적관리(/shop/quotes)에 그 의뢰가 PCB · 부품 견적과 함께 보인다 — 검토 중에는 가견적("예상"),
//      제목은 SmartSMT 화면으로 가는 링크, [SMT] 필터로 거를 수 있다
//   ④ 담당자가 항목 금액을 확정하면 읽기 주소가 확정 금액을 채운 견적서를 주고, 견적관리의 금액 · 표지도 바뀐다
//
// 준비: 고객 계정(e2e/.env.e2e)을 주인으로 한 견적서 1건을 SmartSMT 처럼 보낸다(가짜 견본 판 9 모양 + 파일 3개 + 작업 상태).
// 주문 번호는 SIM-E2E-<실행 꼬리>- 로 시작한다. 정리(afterAll)는 실패해도 돌고, 이 실행이 만든 것만 지운다:
//   파일서버 파일 → sp_file(refType sp_smt_quote) → sp_smt_order(견적 · 확정은 cascade) → sp_smt_receive_log(이 주문 번호).
//
// 실행: cd e2e && PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca npx vitest run smt-order-data
// 사전: API(3333) · nginx · PHP(8888) · e2e/.env.e2e 고객 자격 · apps/api/.env 의 SMARTSMT_SHARED_SECRET · 파일서버
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  apiDir,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  outputDir,
  requireCustomerCreds,
  signJwt,
  snap,
  type PhpLoginResult,
} from '../helpers';
import { buildSampleEnvelope, buildSampleMultipart, sampleFiles } from '../../apps/api/src/lib/smartsmt-sample';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken } from '../../apps/api/src/lib/smartsmt-token';

/** apps/api/.env 의 값 하나 — 비밀은 로그·단언 메시지에 싣지 않는다. */
function readApiEnv(key: string): string | null {
  const text = readFileSync(join(apiDir, '.env'), 'utf8');
  const value = new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
  return value === '' ? null : value;
}

const RUN_TAG = Date.now().toString(36).toUpperCase();
const PREFIX = `SIM-E2E-${RUN_TAG}-`;
const ORDER = `${PREFIX}DATA`;
const QUOTE = `Q-E2E-${RUN_TAG}-DATA`;
const TITLE = `E2E-의뢰-${RUN_TAG}`;
const STATE = { step: 'order', options: { rush: false, note: '한글 메모 "따옴표" <b>태그</b>' }, parts: [{ ref: 'C1', qty: 2 }], run: RUN_TAG };
const FILE_SERVER_URL = process.env.FILE_SERVER_URL ?? readApiEnv('FILE_SERVER_URL') ?? 'https://file.samplepcb.kr';
const ADMIN = { mbId: 'e2e-admin', isAdmin: true } as const;

interface FileRow {
  id: bigint;
  pathToken: string;
}
interface OrderRow {
  quotes: { id: bigint }[];
}
interface ListItem {
  order_id: string;
  title: string;
  processes: string[];
  quote_id: string;
  review_status: string;
  estimated_total: number | null;
  confirmed_total: number | null;
}
interface Detail {
  order_id: string;
  title: string;
  quote_id: string;
  review_status: string;
  confirmed_at: string | null;
  customer_note: string;
  envelope: { header: { order_id: string }; quote: { quote_status: string; integrated: { totals: { total: number | null } } } };
  confirmed_envelope: {
    review_status: string;
    customer_note: string;
    quote: { quote_status: string; lines: { code: string; amount: number }[]; integrated: { blocked_by: unknown[]; totals: Record<string, number> } };
  } | null;
  state: unknown;
  files: { part: string; name: string; bytes: number; sha256: string | null }[];
}

let secret = '';
const peerToken = (): string => signSmartsmtToken(secret, { iss: SMARTSMT_PEER, aud: SMARTSMT_SELF });

/** SmartSMT 서버처럼 읽기 주소를 부른다. */
async function peerGet(path: string): Promise<{ status: number; type: string; json: unknown; bytes: Buffer }> {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${peerToken()}` } });
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  let json: unknown = null;
  if (type.includes('json')) json = JSON.parse(bytes.toString('utf8')) as unknown;
  return { status: res.status, type, json, bytes };
}

/** 이 실행이 만든 것만 지운다 — 파일서버 → sp_file → 주문(견적 · 확정 cascade) → 수신 기록. 남은 행 수를 돌려준다. */
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
      console.warn(`[smt-order-data] 파일서버 삭제 실패 sp_file#${String(file.id)} http=${String(res?.status ?? 'network')}`);
    }
  }
  if (files.length > 0) await prisma.spFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
  await prisma.spSmtOrder.deleteMany({ where: { orderId: { startsWith: PREFIX } } });
  await prisma.spSmtReceiveLog.deleteMany({ where: { orderId: { startsWith: PREFIX } } });
  return (
    ((await prisma.spSmtOrder.count({ where: { orderId: { startsWith: PREFIX } } })) as number) +
    (quoteIds.length === 0
      ? 0
      : ((await prisma.spFile.count({ where: { refType: 'sp_smt_quote', refId: { in: quoteIds } } })) as number))
  );
}

describe.skipIf(!RUN)('SMT 의뢰 데이터 — 보관 · 읽기 주소 · 견적관리', () => {
  let customer: PhpLoginResult;
  let owner = '';
  const ownerQuery = (): string => `owner=${encodeURIComponent(owner)}`;
  const orderPath = (): string => `/api/smartsmt/orders/${encodeURIComponent(ORDER)}`;
  const smtRow = () => customer.page.locator('#sp-quotes-rows li[data-type="smt"]').filter({ hasText: TITLE });

  beforeAll(async () => {
    const found = readApiEnv('SMARTSMT_SHARED_SECRET');
    if (found === null) throw new Error('apps/api/.env 에 SMARTSMT_SHARED_SECRET 이 없습니다');
    secret = found;
    customer = await newPhpSession(requireCustomerCreds());
    owner = customer.mbId;

    // SmartSMT 처럼 보낸다 — 견적서(판 9 모양, 의뢰 이름 포함) + 작업 상태 + 파일 3개.
    const files = sampleFiles();
    const envelope = buildSampleEnvelope({ review: true, orderId: ORDER, quoteId: QUOTE, ownerMbId: owner, ownerName: 'E2E 고객', files }) as {
      header: Record<string, unknown>;
    };
    envelope.header.title = TITLE;
    const { boundary, body } = buildSampleMultipart(envelope, files, { quoteId: QUOTE, orderId: ORDER }, { state: JSON.stringify(STATE) });
    const res = await fetch(`${API_URL}/api/smartsmt/quotes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${peerToken()}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    expect(res.status, await res.text()).toBe(200);
  });

  afterAll(async () => {
    let left = -1;
    try {
      left = await cleanup();
    } finally {
      await customer?.close();
      await closeBrowser();
      await disconnectPrisma();
    }
    if (left !== 0) throw new Error(`정리 뒤 ${PREFIX} 잔재 ${String(left)}행`);
  });

  test('읽기 주소 — 목록 · 한 건 · 파일이 보낸 그대로 돌아온다', async () => {
    const list = await peerGet(`/api/smartsmt/orders?${ownerQuery()}&page_size=100`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const item = (list.json as { data: { items: ListItem[] } }).data.items.find((entry) => entry.order_id === ORDER);
    expect(item).toMatchObject({
      order_id: ORDER,
      title: TITLE,
      processes: ['pcb', 'parts', 'stencil', 'smt'],
      quote_id: QUOTE,
      review_status: 'REVIEWING',
      estimated_total: 509575,
      confirmed_total: null,
    });

    const detail = await peerGet(`${orderPath()}?${ownerQuery()}`);
    expect(detail.status, JSON.stringify(detail.json).slice(0, 300)).toBe(200);
    const data = (detail.json as { data: Detail }).data;
    expect(data).toMatchObject({ order_id: ORDER, title: TITLE, quote_id: QUOTE, review_status: 'REVIEWING', confirmed_at: null, customer_note: '', confirmed_envelope: null });
    expect(data.envelope.header.order_id).toBe(ORDER);
    // 작업 상태 — 뜻을 보지 않고 보관했다가 그대로 돌려준다(한글 · 따옴표 · 태그 글자 포함).
    expect(data.state).toEqual(STATE);

    const sent = sampleFiles();
    expect(data.files.map((file) => file.part)).toEqual(['gerber_archive', 'bom', 'cpl']);
    for (const original of sent) {
      const listed = data.files.find((file) => file.part === original.part);
      expect(listed).toMatchObject({ name: original.filename, bytes: original.buffer.length, sha256: createHash('sha256').update(original.buffer).digest('hex') });
      const file = await peerGet(`${orderPath()}/files/${original.part}?${ownerQuery()}`);
      expect(file.status).toBe(200);
      expect(file.type).toBe('application/octet-stream');
      expect(file.bytes.equals(original.buffer)).toBe(true);
    }
  });

  test('다른 회원 아이디 · 없는 주문 · 토큰 없음 — 내주지 않는다', async () => {
    const other = `owner=${encodeURIComponent(`sim-e2e-nobody-${RUN_TAG.toLowerCase()}`)}`;
    const otherList = await peerGet(`/api/smartsmt/orders?${other}`);
    expect((otherList.json as { data: { total: number } }).data.total).toBe(0);
    expect((await peerGet(`${orderPath()}?${other}`)).status).toBe(404);
    expect((await peerGet(`${orderPath()}/files/bom?${other}`)).status).toBe(404);
    expect((await peerGet(`/api/smartsmt/orders/${PREFIX}NOPE?${ownerQuery()}`)).status).toBe(404);
    expect((await peerGet(orderPath())).status).toBe(400);

    const noToken = await fetch(`${API_URL}${orderPath()}?${ownerQuery()}`);
    expect(noToken.status).toBe(401);
    // 관리자 로그인 토큰으로도 이 주소는 열리지 않는다(SmartSMT 전용 토큰만).
    const adminToken = await fetch(`${API_URL}${orderPath()}?${ownerQuery()}`, { headers: { authorization: `Bearer ${signJwt(ADMIN)}` } });
    expect(adminToken.status).toBe(401);
  });

  test('견적관리 — SMT 의뢰가 가견적과 함께 보이고, 제목이 SmartSMT 화면으로 간다', async () => {
    const { page } = customer;
    await page.goto('/shop/quotes');
    await smtRow().waitFor();
    const text = (await smtRow().innerText()).replace(/\s+/g, ' ');
    expect(text).toContain(TITLE);
    expect(text).toContain('SMT 조립');
    expect(text).toContain('공정 PCB · 부품 · 메탈마스크 · SMT');
    expect(text).toContain('509,575원');
    expect(text).toContain('가견적 · 담당자 검토 중');
    expect(text).toContain('검토 중');
    expect(text).not.toContain('견적 확정');
    // 가견적은 "예상", 부가세 포함 — 공급가 463,250 + 부가세 46,325.
    expect(await smtRow().locator('.sp-quotes__vat').getAttribute('data-tip')).toBe('예상 공급가 463,250원 + 부가세 46,325원');

    const base = readApiEnv('SMARTSMT_BASE_URL');
    const link = smtRow().locator('a.sp-smt__name');
    if (base === null) {
      expect(await link.getAttribute('href')).toBeNull();
    } else {
      expect(await link.getAttribute('href')).toBe(
        (readApiEnv('SMARTSMT_OPEN_URL_TEMPLATE') ?? `${base.replace(/\/+$/, '')}/quote?order={order_id}`).replace('{order_id}', encodeURIComponent(ORDER)),
      );
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('rel')).toBe('noopener');
    }

    // 주문 · 삭제 대상이 아니다 — 체크는 잠겨 있고 전체선택 · 합계에 들지 않는다.
    expect(await smtRow().locator('input[type=checkbox]').isDisabled()).toBe(true);

    // [SMT] 필터 — 의뢰가 있으니 보이고, 누르면 SMT 행만 남는다. [PCB] 로 가면 숨는다.
    const tab = page.locator('#sp-quotes-tab-smt');
    expect(await tab.isVisible()).toBe(true);
    await tab.click();
    expect(await page.locator('#sp-quotes-rows > li:not([hidden])').evaluateAll((rows) => rows.every((row) => (row as HTMLElement).dataset.type === 'smt'))).toBe(true);
    expect(await smtRow().isVisible()).toBe(true);
    await page.locator('#sp-quotes-filters [data-filter="pcb"]').click();
    expect(await smtRow().isVisible()).toBe(false);
    await page.locator('#sp-quotes-filters [data-filter="all"]').click();
    await snap(page, 'smt-quotes-reviewing');
    await smtRow().screenshot({ path: join(outputDir, 'smt-quotes-row-reviewing.png') });
    expect(customer.pageErrors).toEqual([]);
  });

  test('담당자가 확정하면 — 읽기 주소가 확정 금액을 채운 견적서를 주고, 견적관리의 금액도 바뀐다', async () => {
    const quote = (await getPrisma().spSmtQuote.findUnique({ where: { quoteId: QUOTE }, select: { id: true } })) as { id: bigint } | null;
    if (quote === null) throw new Error('보낸 견적이 저장되지 않았습니다');
    // 빈 항목 둘을 채워 확정한다 — 피더 작업비 30,000 · 배송 5,000. 합계는 서버가 계산한다(314,116).
    const confirmed = await api(signJwt(ADMIN), 'PUT', `/api/admin/smt/quotes/${String(quote.id)}/review`, {
      lineAmounts: { 'SMT-P03': 30000 },
      blockAmounts: { SHIPPING: 5000 },
      customerNote: '배송비를 반영했습니다.',
      confirm: true,
    });
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);

    const list = await peerGet(`/api/smartsmt/orders?${ownerQuery()}&page_size=100`);
    const item = (list.json as { data: { items: ListItem[] } }).data.items.find((entry) => entry.order_id === ORDER);
    expect(item).toMatchObject({ review_status: 'CONFIRMED', confirmed_total: 314116, estimated_total: 509575 });

    const data = ((await peerGet(`${orderPath()}?${ownerQuery()}`)).json as { data: Detail }).data;
    expect(data.review_status).toBe('CONFIRMED');
    expect(data.customer_note).toBe('배송비를 반영했습니다.');
    expect(data.confirmed_at).not.toBeNull();
    // 받은 견적서는 그대로 — 확정 금액은 따로 만든 견적서에 담긴다.
    expect(data.envelope.quote).toMatchObject({ quote_status: 'REVIEW_REQUIRED', integrated: { totals: { total: null } } });
    expect(data.confirmed_envelope).toMatchObject({
      review_status: 'CONFIRMED',
      customer_note: '배송비를 반영했습니다.',
      quote: { quote_status: 'CALCULATED', integrated: { blocked_by: [], totals: { supply_price: 285560, vat: 28556, total: 314116 } } },
    });
    expect(data.confirmed_envelope?.quote.lines.find((line) => line.code === 'SMT-P03')?.amount).toBe(30000);
    // 작업 상태 · 파일은 그대로다.
    expect(data.state).toEqual(STATE);
    expect(data.files).toHaveLength(3);

    const { page } = customer;
    await page.goto(`/shop/quotes?_t=${String(Date.now())}`);
    await smtRow().waitFor();
    const text = (await smtRow().innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('314,116원');
    expect(text).toContain('견적 확정');
    expect(text).not.toContain('검토 중');
    expect(text).not.toContain('509,575원');
    expect(await smtRow().locator('.sp-quotes__vat').getAttribute('data-tip')).toBe('확정 공급가 285,560원 + 부가세 28,556원');
    await snap(page, 'smt-quotes-confirmed');
    await smtRow().screenshot({ path: join(outputDir, 'smt-quotes-row-confirmed.png') });
    expect(customer.pageErrors).toEqual([]);
  });
});
