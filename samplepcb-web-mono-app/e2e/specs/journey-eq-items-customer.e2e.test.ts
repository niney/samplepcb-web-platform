// 제조 확인 문항형 회차(D20) — **고객 화면**(sp-php 주문 상세 #eq-{id} · /shop/eq).
//
// journey-eq-items 가 API 왕복과 경계를 박제했다면, 이 주행은 그 회차를 고객이 **화면에서**
// 읽고 고르고 보내는 길을 박제한다. 고객 화면은 sp-php 테마(_pcb_eq_items_round.php)이고
// 회신은 POST+CSRF 브리지(spcb/api/eq-answer.php)를 지나 sp-node 로 간다.
//
// 표적:
//   ① **보이는 것** — 항목 카드(번호·유형·변화 배지)·질문·'제조사 권장'·의견 필요 표시·진행 n/N,
//      그림은 공개된 것만(비공개 id 는 브리지에서도 404), 인라인 이미지·nosniff·중립 파일명.
//   ② **막는 것** — 누락·의견 필수 미기재·미동의는 화면이 먼저 막고(POST 없음), 화면 검사를
//      건너 보내면 서버가 거절한다 — 그때 **고른 값이 살아 있고** 문제 항목이 표시된다.
//   ③ **보내는 것** — 확인 대화(취소에 초점) → 회신 완료 요약 → 사이드바 배지 감소 → 목록 라벨.
//   ④ **개정 회차** — '동일' 항목은 이전 답으로 미리 골라 접히고(바꾸기로 펼침), 접힌 채로도
//      그 답이 실제로 제출된다. '변경'은 지난번 답을 참고로 보이되 미리 고르지 않는다.
//   ⑤ **대리 회신** — 담당자가 대신 넣은 회차에는 그렇다고 말한다.
//   ⑥ **좁은 폭**(390px) 가로 넘침 0 · **어휘** — 화면에 'EQ'·협력사명·공장 원문·그림 원본명이 없다.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items-customer
// 사전: nginx(local-web) · API(3333) · PHP(8888) · 파일서버(그림 업로드) · e2e/.env.e2e 고객 자격.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 통째로 세우고 지운다(실주문 무접촉).
// 스크린샷: <platform>/.tmp/eq-customer-shots/
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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
  getPartner,
  getPrisma,
  mailpitDelete,
  mailpitSearch,
  monoRoot,
  newPhpSession,
  requireCustomerCreds,
  signJwt,
  type G5OrderFixture,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

// 수주 조직 — journey-eq-items 와 같은 조직(EQ 첨부·승인요청 경로가 검증돼 있다).
const OWNER = '협력2';
const SHOT_DIR = join(monoRoot, '..', '.tmp', 'eq-customer-shots');

// ── 눈으로 구분되는 PNG(스크린샷에서 공개/비공개 그림이 섞이지 않았는지 보이게) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const makePng = (w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Buffer => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = paint(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** 공개 그림 — 초록 보드 위 노란 마킹 자리. */
const PNG_SHARED = makePng(240, 160, (x, y) =>
  x > 150 && x < 220 && y > 110 && y < 145 ? [250, 204, 21] : (x + y) % 40 < 2 ? [21, 128, 61] : [22, 101, 52],
);
/** 비공개 그림(공장 로고 자리) — 고객에게 절대 안 간다. */
const PNG_PRIVATE = makePng(120, 120, () => [220, 38, 38]);

describe.skipIf(!RUN)('제조 확인 문항형(D20) — 고객 주문 상세 화면', () => {
  let owner: PartnerFixture;
  let customer: PhpLoginResult;
  let A = ''; // 관리자
  let P = ''; // 협력사(수주)
  let C = ''; // 고객(주문자)
  let order: G5OrderFixture | undefined;
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  const seeded: bigint[] = [];
  const startedAt = new Date();
  const token = `e2eeqc${String(Date.now())}`; // Mailpit 검색 키(공백 없는 한 낱말)
  let mailpitUp = false;
  let openBase = 0; // 이 주행 전의 '확인 대기' 수(다른 주행의 잔재가 있어도 차이만 본다)

  let eqFileId = 0;
  let r1 = 0;
  let r1Items: any[] = [];
  let sharedFigId = 0;
  let privateFigId = 0;
  let r2 = 0;
  let r2Items: any[] = [];
  let r3 = 0;
  /** 따옴표·백슬래시 — 그누보드가 $_POST 에 addslashes 를 거는 함정(브리지가 되돌리는지) */
  const COMMENT_2 = `"좌측" 하단 빈 곳에 넣어 주세요 (it's ok \\ ${token})`;
  /** 의견이 선택 사항인 선택지(A)에 붙인 말 — 개정 회차에 '이전 답변'으로 실려 온다. */
  const COMMENT_1 = '비아 주변 여유도 함께 봐 주세요';
  /** 선택과 무관한 메모 — 선택을 바꿔도 그대로 보내는 것이 맞는 경우. */
  const MEMO = '참고로 납기가 급합니다';

  const adminBase = (): string => `/api/admin/pcb-eq-reviews/${String(poId)}`;
  const adminReview = async (reviewId: number): Promise<any> => {
    const res = await api(A, 'GET', adminBase());
    expect(res.status, `관리자 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.reviews ?? []).find((r: any) => r.id === reviewId) ?? null;
  };
  const openCount = async (): Promise<number> => {
    const res = await api(C, 'GET', '/api/pcb-eq-reviews/mine?scope=open');
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return Number(res.json?.data?.openCount ?? -1);
  };

  /** multipart 업로드(관리자 그림·협력사 EQ 첨부 공용). */
  const upload = async (
    tok: string,
    path: string,
    file: { name: string; type: string; bytes: Uint8Array },
    fields: Record<string, string> = {},
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}` },
      body: form,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, json };
  };

  // ── 화면 도우미 ──────────────────────────────────────────────────────────────
  const shot = async (page: Page, name: string, selector?: string): Promise<void> => {
    mkdirSync(SHOT_DIR, { recursive: true });
    const path = join(SHOT_DIR, `${name}.png`);
    if (selector !== undefined) await page.locator(selector).first().screenshot({ path });
    else await page.screenshot({ path, fullPage: true });
  };
  /** 주문 상세를 **새 문서로** 연다 — 해시만 다른 goto 는 다시 불러오지 않는다(e2e 메모). */
  const openOrder = async (hash = ''): Promise<void> => {
    const url = `${BASE_URL}/shop/orderinquiryview.php?od_id=${order?.odId ?? ''}&_t=${String(Date.now())}${hash}`;
    await customer.page.goto(url, { waitUntil: 'networkidle' });
  };
  const dialogText = async (): Promise<string> => {
    const msg = customer.page.locator('.sp-dlg');
    await msg.waitFor({ state: 'visible', timeout: 10_000 });
    return (await msg.innerText()).trim();
  };
  const closeDialog = async (which: 'ok' | 'cancel' = 'ok'): Promise<void> => {
    await customer.page.locator(which === 'ok' ? '.sp-dlg-ok' : '.sp-dlg-cancel').click();
    await customer.page.locator('.sp-dlg').waitFor({ state: 'detached', timeout: 5_000 });
  };
  /** 사이드바 '제조 확인' 배지(DB 직접 count) — 없으면 0. */
  const navBadge = async (): Promise<number> =>
    customer.page.evaluate(() => {
      const link = [...document.querySelectorAll('.smb_nav a')].find(
        (a) => a.querySelector('.lbl')?.textContent?.trim() === '제조 확인',
      );
      return Number(link?.querySelector('.nav_badge')?.textContent?.trim() ?? 0);
    });
  /** 가로 넘침 — 넘치면 범인 요소를 같이 돌려준다(진단용). */
  const overflow = async (): Promise<{ over: boolean; width: number; culprits: string[] }> =>
    customer.page.evaluate(() => {
      const vw = window.innerWidth;
      const culprits: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1 && culprits.length < 6) {
          culprits.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} → ${String(Math.round(r.right))}`);
        }
      }
      return { over: document.documentElement.scrollWidth > vw + 1, width: document.documentElement.scrollWidth, culprits };
    });
  /** 카드 안 상태를 한 번에 읽는다. */
  const readCard = async (itemId: number): Promise<any> =>
    customer.page.evaluate((id: number) => {
      const card = document.getElementById(`eqi-${String(id)}`);
      if (card === null) return null;
      const body = card.querySelector('.sp_eqi_body') as HTMLElement | null;
      return {
        classes: card.className,
        head: card.querySelector('.sp_eqi_h')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        bodyHidden: body?.hidden ?? null,
        checked: (card.querySelector('input[type=radio]:checked') as HTMLInputElement | null)?.value ?? null,
        comment: (card.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? null,
        // innerText — 접힘/펼침 문구는 CSS 로 갈리므로 보이는 글자만 읽는다(textContent 는 둘 다 읽는다).
        keep: (card.querySelector('.sp_eqi_keep') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        prev: card.querySelector('.sp_eqi_prev')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        hint: card.querySelector('[data-eqi-cmt-hint]')?.textContent?.trim() ?? '',
        err: (card.querySelector('[data-eqi-err]') as HTMLElement | null)?.hidden === false
          ? card.querySelector('[data-eqi-err]')?.textContent?.trim() ?? ''
          : '',
        ans: card.querySelector('.sp_eqi_ans')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        text: (card as HTMLElement).innerText,
      };
    }, itemId);
  /** 확인 대화 → 승낙 → 리다이렉트 결과 대화까지. */
  const submitAndConfirm = async (reviewId: number): Promise<{ confirm: string; cancelFocused: boolean; result: string }> => {
    const { page } = customer;
    await page.locator(`#eq-${String(reviewId)} .sp_eqi_submit`).click();
    const confirm = await dialogText();
    const cancelFocused = await page.evaluate(() => document.activeElement?.classList.contains('sp-dlg-cancel') === true);
    await shot(page, `confirm-r${String(reviewId === r1 ? 1 : reviewId === r2 ? 2 : 3)}`, '.sp-dlg');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }), page.locator('.sp-dlg-ok').click()]);
    const result = await dialogText();
    return { confirm, cancelFocused, result };
  };

  // ── 문항 정의(관리자 입력) ───────────────────────────────────────────────────
  const ITEM_GENERAL = (over: Record<string, unknown> = {}) => ({
    factoryNo: '1',
    category: 'drill',
    question: '0.2mm 비아를 0.25mm 로 키워도 될까요?',
    questionOrig: '0.2mm孔径加大到0.25mm可以吗？',
    options: [
      { key: 'A', label: '키워도 됩니다', labelOrig: '可以', recommended: true, requiresComment: false },
      { key: 'B', label: '안 됩니다 — 원래대로 해 주세요', labelOrig: '不可以', recommended: false, requiresComment: false },
    ],
    figures: [] as { fileId: number; shared: boolean }[],
    prevItemId: null,
    change: null,
    ...over,
  });
  const ITEM_COMMENT = (over: Record<string, unknown> = {}) => ({
    factoryNo: '2',
    category: 'marking',
    question: `UL 마킹을 보드에 넣을까요?\n넣는다면 위치를 알려 주세요. (${token})`,
    questionOrig: '是否需要在板上加UL标记？',
    options: [
      { key: 'A', label: '제조사 제안대로 넣지 않음', labelOrig: '按我司建议不加', recommended: true, requiresComment: false },
      { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置', recommended: false, requiresComment: true },
    ],
    figures: [] as { fileId: number; shared: boolean }[],
    prevItemId: null,
    change: null,
    ...over,
  });
  // 띄어쓰기 없는 긴 낱말 — 좁은 화면에서 질문이 가로로 터지지 않는지(여정 36·39호 유형).
  const ITEM_FIGURE = (over: Record<string, unknown> = {}) => ({
    factoryNo: '3',
    category: 'legend',
    question: '실크 문자 높이가 0.6mm 라 흐릴 수 있습니다. 0.8mm 로 키워도 될까요? 참조 레이어: TOP_SILKSCREEN_REFERENCE_DESIGNATOR_HEIGHT_0.6MM_TO_0.8MM',
    questionOrig: '丝印字高0.6mm，是否可以加大到0.8mm？',
    options: [
      { key: 'A', label: '0.8mm 로 키워 주세요', labelOrig: '加大', recommended: true, requiresComment: false },
      { key: 'B', label: '그대로 두세요', labelOrig: '保持', recommended: false, requiresComment: false },
      { key: 'C', label: '기타(의견)', labelOrig: '其他', recommended: false, requiresComment: true },
    ],
    figures: [] as { fileId: number; shared: boolean }[],
    prevItemId: null,
    change: null,
    ...over,
  });

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mailpitUp = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null))?.ok === true;

    const creds = requireCustomerCreds();
    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });

    order = await createG5OrderFixture(creds.id, 'e2e 제조확인 고객화면');
    // 긴 프로젝트명 — 회차 머리줄이 좁은 화면에서 터지지 않는지 함께 본다.
    // ⚠ 이름에 'EQ' 를 넣지 않는다 — C9 가 화면의 'EQ' 를 찾는다(픽스처에 검사 키워드 금지, 여정 규율).
    projectName = `E2E-MFC-${token}-${'아주긴프로젝트이름'.repeat(4)}.zip`;
    const spec = await createOrderSpec({ mbId: creds.id, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);

    // 협력사가 EQ 질의서를 올리고 승인요청한다(기존 경로) — 회차는 eq_requested 에서만 열린다.
    const up = await upload(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { name: 'EQ-factory.xls', type: 'application/vnd.ms-excel', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
      { fileType: 'eq' },
    );
    expect(up.status, `EQ 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(req.status, `승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    eqFileId = Number(
      (await getPrisma().spFile.findFirst({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) } }))?.id ?? 0,
    );

    customer = await newPhpSession(creds);
    openBase = await openCount();
  }, 180_000);

  afterAll(async () => {
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
    }
    if (specId > 0n) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: specId.toString(), createdAt: { gte: startedAt } },
      });
    }
    await cleanupPcbPos(seeded); // 회차·문항·이벤트는 발주 cascade
    if (specId > 0n) await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    if (order !== undefined) await deleteOrderHard(order.odId);
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }
    await closeBrowser();

    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spPcbEqReview.count({ where: { poId: BigInt(poId) } }), '회차 잔재').toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('C1. 무대 — 관리자가 문항 3개(일반·의견 필수·그림 공개1/비공개1) 회차를 보낸다', async () => {
    const created = await api(A, 'POST', `${adminBase()}/drafts`, { sourceFileIds: [eqFileId] });
    expect(created.status, `초안: ${JSON.stringify(created.json)}`).toBe(201);
    r1 = Number(created.json.data.review.id);

    const figPath = `${adminBase()}/${String(r1)}/figures`;
    // 원본명에 공장 이름이 섞인 경우를 흉내 낸다 — 고객 화면·다운로드 이름에 나오면 안 된다.
    const shared = await upload(A, figPath, { name: `${OWNER}-silk-ref.png`, type: 'image/png', bytes: PNG_SHARED });
    expect(shared.status, `공개 그림: ${JSON.stringify(shared.json)}`).toBe(200);
    sharedFigId = Number(shared.json.data.figure.fileId);
    const priv = await upload(A, figPath, { name: 'factory-logo.png', type: 'image/png', bytes: PNG_PRIVATE });
    expect(priv.status).toBe(200);
    privateFigId = Number(priv.json.data.figure.fileId);

    const saved = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 1,
      message: '',
      dueOn: '2099-12-31',
      items: [
        ITEM_GENERAL(),
        ITEM_COMMENT(),
        ITEM_FIGURE({
          figures: [
            { fileId: sharedFigId, shared: true },
            { fileId: privateFigId, shared: false },
          ],
        }),
      ],
    });
    expect(saved.status, `저장: ${JSON.stringify(saved.json)}`).toBe(200);
    r1Items = saved.json.data.review.items;
    const sent = await api(A, 'POST', `${adminBase()}/${String(r1)}/send`, { expectedVersion: 2 });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    expect(sent.json.data.review).toMatchObject({ status: 'requested', roundNo: 1 });
    expect(await openCount(), '배지 모수 +1').toBe(openBase + 1);
  });

  test('C2. 주문 상세 — 항목 카드·제조사 권장·의견 필요·진행 0/3, 그림은 공개 1장만(인라인·nosniff·중립 이름)', async () => {
    const { page } = customer;
    await openOrder(`#eq-${String(r1)}`);
    // 그림은 loading=lazy — 화면에 들여와 실제로 받은 뒤에 잰다.
    const thumb = page.locator(`#eq-${String(r1)} .sp_eqi_figs img`).first();
    await thumb.scrollIntoViewIfNeeded();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 10_000 }).toBe(240);
    const view = await page.evaluate(
      ({ rid, priv }) => {
        const round = document.getElementById(`eq-${String(rid)}`);
        if (round === null) return null;
        const imgs = [...round.querySelectorAll('.sp_eqi_figs img')] as HTMLImageElement[];
        return {
          badge: round.querySelector('.sp_eq_head .sp_eq_badge')?.textContent?.trim() ?? '',
          roundLabel: round.querySelector('.sp_eqi_round_no')?.textContent?.trim() ?? '',
          due: round.querySelector('.sp_eq_due')?.textContent?.trim() ?? '',
          msg: round.querySelector('.sp_eq_msg')?.textContent?.trim() ?? '',
          cards: round.querySelectorAll('.sp_eqi_card').length,
          cats: [...round.querySelectorAll('.sp_eqi_cat')].map((e) => e.textContent?.trim()),
          recs: round.querySelectorAll('.sp_eqi_opts .sp_eqi_rec').length,
          needs: round.querySelectorAll('.sp_eqi_needtag').length,
          progress: round.querySelector('[data-eqi-progress]')?.textContent?.trim() ?? '',
          action: round.querySelector('form.sp_eqi_form')?.getAttribute('action') ?? '',
          tokenLen: (round.querySelector('input[name=token]') as HTMLInputElement | null)?.value.length ?? 0,
          decideButtons: round.querySelectorAll('[data-decision]').length,
          imgs: imgs.map((i) => ({ src: i.getAttribute('src') ?? '', w: i.naturalWidth, alt: i.alt })),
          privRef: document.documentElement.innerHTML.includes(`file=${String(priv)}`),
          qWhiteSpace: getComputedStyle(round.querySelector('.sp_eqi_q') as Element).whiteSpace,
        };
      },
      { rid: r1, priv: privateFigId },
    );
    expect(view, '회차 카드(#eq-{id})').not.toBeNull();
    expect(view).toMatchObject({
      badge: '확인 대기',
      roundLabel: '', // 첫 회차엔 "N차"를 붙이지 않는다
      due: '회신 기한 2099-12-31',
      cards: 3,
      cats: ['드릴(홀)', '마킹(UL·주기)', '실크(문자)'],
      recs: 3,
      needs: 2,
      progress: '0/3',
      decideButtons: 0, // 문구형 승인·반려 버튼이 아니다(누르면 409 WRONG_FORMAT 이던 결함)
      privRef: false,
      qWhiteSpace: 'pre-wrap',
    });
    expect(view?.msg, '빈 머리말은 기본 안내문').toContain('항목마다');
    expect(view?.action).toMatch(/\/spcb\/api\/eq-answer$/);
    expect(view?.tokenLen, 'CSRF 토큰 hidden(get_token 함정)').toBeGreaterThan(10);
    expect(view?.imgs, '공개 그림 1장만').toHaveLength(1);
    expect(view?.imgs[0]?.src).toContain(`file=${String(sharedFigId)}`);
    expect(view?.imgs[0]?.w, '브리지가 이미지를 실제로 내준다').toBe(240);
    expect(view?.imgs[0]?.alt).toBe('항목 3 참고 그림');

    // 브리지 직접 — 공개는 인라인 이미지(중립 이름·nosniff), 비공개는 404.
    const figUrl = (fid: number): string =>
      `${BASE_URL}/spcb/api/eq-file?review=${String(r1)}&file=${String(fid)}&view=1`;
    const ok = await page.request.get(figUrl(sharedFigId), { maxRedirects: 0 });
    expect(ok.status(), '공개 그림').toBe(200);
    const h = ok.headers();
    expect(h['content-type']).toContain('image/png');
    expect(h['content-disposition'] ?? '').toBe(`inline; filename="figure-${String(sharedFigId)}.png"`);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-disposition'] ?? '', '원본명(공장명) 미노출').not.toContain(OWNER);
    const hidden = await page.request.get(figUrl(privateFigId), { maxRedirects: 0 });
    expect(hidden.status(), '비공개 그림은 브리지에서도 404').toBe(404);

    // 그림 확대 — <dialog> 로 크게.
    await page.locator(`#eq-${String(r1)} [data-eqi-fig]`).first().click();
    await page.locator('#sp_eqi_figdlg[open]').waitFor({ state: 'visible' });
    expect(await page.locator('#sp_eqi_figdlg img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(240);
    await shot(page, 'c2-figure-zoom');
    await page.keyboard.press('Escape');
    await page.locator('#sp_eqi_figdlg[open]').waitFor({ state: 'detached' }).catch(() => undefined);
    expect(await page.locator('#sp_eqi_figdlg').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);

    // 사이드바 배지 = API openCount(같은 모수).
    expect(await navBadge(), '사이드바 배지').toBe(openBase + 1);
    await shot(page, 'c2-order-round1-open', `#eq-${String(r1)}`);

    // 목록 — 항목 수만 알리고 폼은 없다(딥링크만).
    await page.goto(`${BASE_URL}/shop/eq`, { waitUntil: 'networkidle' });
    const row = await page.evaluate((rid: number) => {
      const li = [...document.querySelectorAll('.sp-eqm__item')].find((x) =>
        (x.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href.includes(`#eq-${String(rid)}`),
      );
      return li === undefined
        ? null
        : {
            badge: li.querySelector('.sp_eq_badge')?.textContent?.trim() ?? '',
            meta: li.querySelector('.sp-eqm__meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            go: li.querySelector('.sp-eqm__go')?.textContent?.trim() ?? '',
            forms: document.querySelectorAll('.sp-eqm form, .sp-eqm input[type=radio]').length,
          };
    }, r1);
    expect(row, '목록 행').not.toBeNull();
    expect(row).toMatchObject({ badge: '확인 대기', go: '확인하고 회신하기', forms: 0 });
    expect(row?.meta).toContain('확인 항목 3개');
    await shot(page, 'c2-list-open', '.sp-eqm');
  });

  test('C3. 화면이 먼저 막는다 — 누락·의견 필수 미기재·미동의(POST 없음)', async () => {
    const { page } = customer;
    await openOrder(`#eq-${String(r1)}`);
    const [i1 = 0, i2 = 0, i3 = 0] = r1Items.map((i: any) => Number(i.id));
    const form = `#eq-${String(r1)}`;

    // (a) 아무것도 안 고름 — 첫 문제 항목을 말하고, 세 카드 모두 표시된다.
    await page.locator(`${form} .sp_eqi_submit`).click();
    const a = await dialogText();
    expect(a).toContain('모든 항목에 답해 주세요');
    expect(a).toContain('항목 1');
    await closeDialog();
    expect(await page.locator(`${form} .sp_eqi_card.is-invalid`).count(), '세 카드 표시').toBe(3);
    expect((await readCard(i1)).err).toContain('골라 주세요');

    // (b) 의견 필요한 선택지를 고르고 의견을 비움 — 그 항목만 남는다.
    await page.locator(`#eqi-${String(i1)} input[value="A"]`).check();
    await page.locator(`#eqi-${String(i2)} input[value="B"]`).check();
    await page.locator(`#eqi-${String(i3)} input[value="A"]`).check();
    const c2 = await readCard(i2);
    expect(c2.hint, '의견 필수 표시').toBe('(필수 — 2자 이상)');
    expect(c2.classes).toContain('is-need-comment');
    expect(await page.locator(`${form} [data-eqi-progress]`).innerText(), '진행').toBe('3/3');
    await page.locator(`${form} .sp_eqi_submit`).click();
    const b = await dialogText();
    expect(b).toContain('항목 2');
    expect(b).toContain('의견');
    await closeDialog();
    expect(await page.locator(`${form} .sp_eqi_card.is-invalid`).count(), '남은 문제는 항목 2 하나').toBe(1);
    await shot(page, 'c3-comment-required-client', form);

    // (c) 의견을 적고 동의를 빼먹음.
    await page.locator(`#eqi-${String(i2)} textarea`).fill('좌측 하단');
    expect(await page.locator(`${form} .sp_eqi_card.is-invalid`).count(), '고치는 대로 표시가 걷힌다').toBe(0);
    await page.locator(`${form} .sp_eqi_submit`).click();
    expect(await dialogText()).toContain('동의');
    await closeDialog();

    // 세 번 다 서버로 안 갔다 — 주소에 결과 문구가 없고 회차는 그대로 대기.
    expect(page.url()).not.toContain('sp_msg');
    expect((await adminReview(r1))?.status).toBe('requested');
  });

  test('C4. 화면 검사를 건너 보내면 서버가 거절 — 문구에 항목 번호, 고른 값은 살아 있다', async () => {
    const { page } = customer;
    const [i1 = 0, i2 = 0, i3 = 0] = r1Items.map((i: any) => Number(i.id));
    const form = `#eq-${String(r1)} form.sp_eqi_form`;
    const before = await adminReview(r1);
    // 항목 2 = B(의견 필수)인데 의견을 비우고, 동의는 체크한 채 — 클라이언트 검사를 우회해 바로 제출.
    await page.locator(`#eqi-${String(i2)} textarea`).fill('');
    await page.locator(`#eq-${String(r1)} input[name=agree]`).check();
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
      page.locator(form).evaluate((f: HTMLFormElement) => {
        f.dataset.spConfirmed = '1';
        f.submit();
      }),
    ]);
    const msg = await dialogText();
    expect(msg, '서버(sp-node) 문구').toContain('이 선택지는 의견을 2자 이상 적어 주세요');
    expect(msg, '브리지가 문제 항목을 붙인다').toContain('항목 2');
    expect(msg).not.toContain('EQ');
    await shot(page, 'c4-server-reject-dialog');
    await closeDialog();

    expect(page.url(), '문제 항목으로 착지').toContain(`#eqi-${String(i2)}`);
    const [c1, c2, c3] = [await readCard(i1), await readCard(i2), await readCard(i3)];
    expect([c1.checked, c2.checked, c3.checked], '고른 값 복원').toEqual(['A', 'B', 'A']);
    expect(c2.classes, '문제 항목 표시').toContain('is-invalid');
    expect(c1.classes).not.toContain('is-invalid');
    expect(await page.locator(`#eq-${String(r1)} input[name=agree]`).isChecked(), '동의 체크도 복원').toBe(true);
    await shot(page, 'c4-restored', `#eq-${String(r1)}`);

    const after = await adminReview(r1);
    expect(after.status).toBe('requested');
    expect(after.version, '거절은 판본을 올리지 않는다').toBe(before.version);

    // 복원은 한 번뿐 — 새로 열면 빈 화면(세션 플래시).
    await openOrder();
    expect((await readCard(i2)).checked, '두 번째 열람엔 복원 없음').toBeNull();
  });

  // 2026-10-11 사용자 지적: 의견 칸은 항목당 하나라, B 에 적은 의견이 A 로 바꾼 뒤에도 그대로 나간다(공장은 기호를
  // 먼저 읽는다). 조용히 지우지도, 바꿀 때마다 묻지도 않는다 — 띠로 알리고 회신 버튼에서 한 번 묻는다.
  test('C4b. 의견을 적은 뒤 처리 방법을 바꾸면 알린다 — 지우지 않고, 회신 버튼에서 한 번 묻는다(POST 없음)', async () => {
    const { page } = customer;
    const [i1 = 0, i2 = 0, i3 = 0] = r1Items.map((i: any) => Number(i.id));
    await openOrder(`#eq-${String(r1)}`);
    const card = `#eqi-${String(i2)}`;
    const band = page.locator(`${card} [data-eqi-stale]`);
    const ta = page.locator(`${card} textarea`);
    const pick = (key: string) => page.locator(`${card} input[value="${key}"]`).check();
    const bandText = async (): Promise<string> => (await band.innerText()).replace(/\s+/g, ' ');
    expect(await band.isHidden(), '처음엔 띠가 없다').toBe(true);

    // ① B(위치 지정)에 의견을 적고 A(넣지 않음)로 바꾼다 — 의견은 그대로, 띠가 선다.
    await pick('B');
    await ta.fill('좌측 하단에 넣어 주세요');
    expect(await band.isHidden(), '적는 동안엔 띠가 없다').toBe(true);
    await pick('A');
    await band.waitFor({ state: 'visible' });
    expect(await bandText()).toContain('처리 방법을 바꾸셨습니다 (B → A)');
    expect(await ta.inputValue(), '의견은 지우지 않는다').toBe('좌측 하단에 넣어 주세요');
    expect((await readCard(i2)).classes).toContain('is-stale');
    await shot(page, 'c4b-stale-band', card);

    // ② 원래 선택으로 돌아오면 걷힌다.
    await pick('B');
    expect(await band.isHidden(), '원래 선택으로 돌아옴').toBe(true);

    // ③ 다시 바꾸고 [의견 지우기] — 비워지고 띠가 걷히고 초점이 의견 칸에 간다.
    await pick('A');
    await band.waitFor({ state: 'visible' });
    await band.getByRole('button', { name: '의견 지우기' }).click();
    expect(await ta.inputValue(), '지워졌다').toBe('');
    expect(await band.isHidden()).toBe(true);
    expect(await ta.evaluate((el) => el === document.activeElement), '초점은 의견 칸').toBe(true);

    // ④ 의견이 없으면 눌러 보며 비교해도 조용하다.
    await pick('B');
    await pick('A');
    expect(await band.isHidden(), '의견 없이 바꾸면 띠가 없다').toBe(true);

    // ⑤ A 에 메모를 적고 B 로 → 띠(A → B) → [이 의견 그대로 둠] — 걷히고 의견은 남는다.
    await ta.fill(MEMO);
    await pick('B');
    await band.waitFor({ state: 'visible' });
    expect(await bandText()).toContain('(A → B)');
    await band.getByRole('button', { name: '이 의견 그대로 둠' }).click();
    expect(await band.isHidden()).toBe(true);
    expect(await ta.inputValue(), '그대로 둔다').toBe(MEMO);

    // ⑥ 의견을 고치면 걷힌다 — 지금 선택을 보고 쓴 말이다.
    await pick('A');
    await band.waitFor({ state: 'visible' });
    expect(await bandText()).toContain('(B → A)');
    await ta.fill(`${MEMO}.`);
    expect(await band.isHidden(), '고치면 걷힌다').toBe(true);

    // ⑦ 띠가 남은 채 회신 — 확인창이 그것부터 묻고, [돌아가서 확인]은 그 의견 칸으로 보낸다.
    await pick('B');
    await band.waitFor({ state: 'visible' });
    await page.locator(`#eqi-${String(i1)} input[value="A"]`).check();
    await page.locator(`#eqi-${String(i3)} input[value="A"]`).check();
    await page.locator(`#eq-${String(r1)} input[name=agree]`).check();
    await page.locator(`#eq-${String(r1)} .sp_eqi_submit`).click();
    const ask = await dialogText();
    expect(ask).toContain('의견을 확인해 주세요');
    expect(ask).toContain('항목 2');
    expect(ask).toContain('처리 방법을 바꾼 뒤 의견을 확인하지 않으셨습니다');
    expect(ask, '되돌릴 수 없음은 여전히 알린다').toContain('회신 뒤에는 이 화면에서 바꿀 수 없습니다');
    expect(ask).not.toContain('EQ');
    expect((await page.locator('.sp-dlg-ok').innerText()).trim()).toBe('그대로 회신');
    expect((await page.locator('.sp-dlg-cancel').innerText()).trim()).toBe('돌아가서 확인');
    await shot(page, 'c4b-stale-confirm', '.sp-dlg');
    await closeDialog('cancel');
    expect(await ta.evaluate((el) => el === document.activeElement), '그 의견 칸으로 돌아간다').toBe(true);
    expect(page.url(), '서버로 가지 않았다').not.toContain('sp_msg');
    expect((await adminReview(r1))?.status).toBe('requested');

    // 390px — 띠가 가로로 터지지 않는다.
    await page.setViewportSize({ width: 390, height: 900 });
    const narrow = await overflow();
    expect(narrow.over, `390px 가로 넘침(${String(narrow.width)}px): ${narrow.culprits.join(' | ')}`).toBe(false);
    await shot(page, 'c4b-stale-390', card);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('C5. 정상 제출 — 확인 대화(취소에 초점) → 회신 완료 요약·배지 감소·목록 라벨', async () => {
    const { page } = customer;
    const [i1 = 0, i2 = 0, i3 = 0] = r1Items.map((i: any) => Number(i.id));
    await page.locator(`#eqi-${String(i1)} input[value="A"]`).check();
    await page.locator(`#eqi-${String(i1)} textarea`).fill(COMMENT_1);
    await page.locator(`#eqi-${String(i2)} input[value="B"]`).check();
    await page.locator(`#eqi-${String(i2)} textarea`).fill(COMMENT_2);
    await page.locator(`#eqi-${String(i3)} input[value="A"]`).check();
    await page.locator(`#eq-${String(r1)} input[name=agree]`).check();
    // C4b 가 남긴 띠는 의견을 다시 적는 순간 걷혔다 — 평소 확인창이 뜬다.
    expect(await page.locator(`#eq-${String(r1)} .sp_eqi_card.is-stale`).count(), '남은 띠 없음').toBe(0);
    await shot(page, 'c5-filled', `#eq-${String(r1)}`);

    const r = await submitAndConfirm(r1);
    expect(r.confirm).toContain('이 답변으로 회신하시겠습니까');
    expect(r.cancelFocused, '확인 대화는 취소에 초점').toBe(true);
    expect(r.result).toContain('회신을 보냈습니다');
    await closeDialog();

    // 서버 원장 — 답·의견이 그대로(따옴표·백슬래시에 군더더기 없이).
    const review = await adminReview(r1);
    expect(review).toMatchObject({ status: 'answered', answeredRole: 'customer', answerChannel: 'web' });
    expect(review.items.map((i: any) => i.answer?.key)).toEqual(['A', 'B', 'A']);
    expect(review.items[1].answer.comment, 'addslashes 되돌림').toBe(COMMENT_2);
    expect(review.items[0].answer.comment, '선택 의견도 나간다').toBe(COMMENT_1);

    // 화면 — 읽기 전용 요약.
    const round = page.locator(`#eq-${String(r1)}`);
    expect(await round.locator('.sp_eq_head .sp_eq_badge').innerText()).toBe('회신 완료');
    expect(await round.locator('form').count(), '폼이 사라진다').toBe(0);
    const s1 = await readCard(i1);
    const s2 = await readCard(i2);
    expect(s1.ans).toContain('A. 키워도 됩니다');
    expect(s1.ans, '고른 것이 권장안이면 그렇게 표시').toContain('제조사 권장');
    expect(s2.ans).toContain('B. 위치를 지정하겠습니다');
    expect(s2.ans).toContain(COMMENT_2.replace(/\s+/g, ' '));
    expect(await round.locator('.sp_eq_done').innerText()).not.toContain('대신 입력');
    await shot(page, 'c5-answered-summary', `#eq-${String(r1)}`);

    expect(await navBadge(), '사이드바 배지 감소').toBe(openBase);
    expect(await openCount()).toBe(openBase);

    await page.goto(`${BASE_URL}/shop/eq?scope=all`, { waitUntil: 'networkidle' });
    const row = await page.evaluate((rid: number) => {
      const li = [...document.querySelectorAll('.sp-eqm__item')].find((x) =>
        (x.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href.includes(`#eq-${String(rid)}`),
      );
      return li === undefined
        ? null
        : {
            badge: li.querySelector('.sp_eq_badge')?.textContent?.trim() ?? '',
            meta: li.querySelector('.sp-eqm__meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            go: li.querySelector('.sp-eqm__go')?.textContent?.trim() ?? '',
          };
    }, r1);
    expect(row).toMatchObject({ badge: '회신 완료', go: '내용 보기' });
    expect(row?.meta).toContain('확인 항목 3개');
    await shot(page, 'c5-list-answered', '.sp-eqm');
  });

  test('C6. 개정 회차 — 동일 항목은 이전 답으로 접히고(바꾸기로 펼침) 그 답이 실제로 나간다, 390px 넘침 0', async () => {
    const { page } = customer;
    // 공장이 개정 EQ 를 낸다 — 관리자 반려 → 협력사 재요청 → 직전 회차에서 가져오기.
    const rej = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: '공장 개정 EQ 대기',
    });
    expect(rej.status, JSON.stringify(rej.json)).toBe(200);
    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const created = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(created.status, `개정 초안: ${JSON.stringify(created.json)}`).toBe(201);
    r2 = Number(created.json.data.review.id);
    const copied = created.json.data.review.items;
    const saved = await api(A, 'PUT', `${adminBase()}/${String(r2)}/draft`, {
      expectedVersion: 1,
      items: [
        ITEM_GENERAL({ id: copied[0].id, prevItemId: r1Items[0].id, change: 'same' }),
        ITEM_COMMENT({
          id: copied[1].id,
          prevItemId: r1Items[1].id,
          change: 'changed',
          question: 'UL 마킹 위치를 좌측 하단으로 하면 부품과 겹칩니다. 우측 상단으로 옮겨도 될까요?',
        }),
        ITEM_FIGURE({
          id: copied[2].id,
          prevItemId: r1Items[2].id,
          change: 'same',
          figures: copied[2].figures.map((f: any) => ({ fileId: f.fileId, shared: f.shared })),
        }),
        ITEM_GENERAL({ factoryNo: '4', category: 'outline', question: '외형 공차를 ±0.15mm 로 해도 될까요?', change: 'new' }),
      ],
    });
    expect(saved.status, `개정 저장: ${JSON.stringify(saved.json)}`).toBe(200);
    r2Items = saved.json.data.review.items;
    const sent = await api(A, 'POST', `${adminBase()}/${String(r2)}/send`, { expectedVersion: 2 });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(sent.json.data.review.roundNo).toBe(2);

    await openOrder(`#eq-${String(r2)}`);
    const [j1 = 0, j2 = 0, j3 = 0, j4 = 0] = r2Items.map((i: any) => Number(i.id));
    const head = await page.locator(`#eq-${String(r2)} .sp_eq_head`).innerText();
    expect(head, '회차 번호').toContain('2차 확인');
    expect(await page.locator(`#eq-${String(r2)} .sp_eqi_revnote`).count(), '개정 안내').toBe(1);
    const [k1, k2, k3, k4] = [await readCard(j1), await readCard(j2), await readCard(j3), await readCard(j4)];
    // 동일 — 이전 답(A)을 미리 고른 채 접힘.
    expect(k1.classes).toContain('is-kept');
    expect(k1.bodyHidden, '본문 접힘').toBe(true);
    expect(k1.checked).toBe('A');
    expect(k1.keep).toContain('이전 답변 유지');
    expect(k1.keep).toContain('A. 키워도 됩니다');
    expect(k3.classes).toContain('is-kept');
    expect(k3.checked).toBe('A');
    // 변경 — 배지 + 지난번 답은 참고로만, 미리 고르지 않는다.
    expect(k2.head).toContain('변경');
    expect(k2.bodyHidden).toBe(false);
    expect(k2.checked).toBeNull();
    expect(k2.prev).toContain('지난번 답변');
    expect(k2.prev).toContain('B. 위치를 지정하겠습니다');
    // 신규.
    expect(k4.head).toContain('신규');
    expect(k4.checked).toBeNull();
    expect(await page.locator(`#eq-${String(r2)} [data-eqi-progress]`).innerText(), '미리 고른 2개').toBe('2/4');
    await shot(page, 'c6-round2-kept', `#eq-${String(r2)}`);

    // 바꾸기 — 펼쳐지고, 말이 '지난번 답변'으로 바뀐다.
    await page.locator(`#eqi-${String(j1)} .sp_eqi_unfold`).click();
    const opened = await readCard(j1);
    expect(opened.bodyHidden).toBe(false);
    expect(opened.classes).toContain('is-unfolded');
    expect(opened.keep).toContain('지난번 답변');
    expect(opened.keep).not.toContain('이전 답변 유지');
    await shot(page, 'c6-round2-unfolded', `#eqi-${String(j1)}`);
    // 이전 회차에서 실려 온 의견도 같은 규칙 — 처리 방법을 바꾸면 띠가 서고(오래 전에 쓴 말이라 더 잊기 쉽다), 되돌리면 걷힌다.
    expect(opened.comment, '이전 의견이 채워져 있다').toBe(COMMENT_1);
    const carried = page.locator(`#eqi-${String(j1)} [data-eqi-stale]`);
    expect(await carried.isHidden(), '펼치기만 해서는 띠가 없다').toBe(true);
    await page.locator(`#eqi-${String(j1)} input[value="B"]`).check();
    await carried.waitFor({ state: 'visible' });
    expect((await carried.innerText()).replace(/\s+/g, ' ')).toContain('(A → B)');
    await shot(page, 'c6-round2-carried-stale', `#eqi-${String(j1)}`);
    await page.locator(`#eqi-${String(j1)} input[value="A"]`).check();
    expect(await carried.isHidden(), '되돌리면 걷힌다').toBe(true);

    // 390px — 열린 폼(접힘·펼침·그림·긴 낱말 질문·긴 프로젝트명)이 가로로 터지지 않는다.
    await page.setViewportSize({ width: 390, height: 900 });
    await openOrder(`#eq-${String(r2)}`);
    const narrow = await overflow();
    expect(narrow.over, `390px 가로 넘침(${String(narrow.width)}px): ${narrow.culprits.join(' | ')}`).toBe(false);
    await shot(page, 'c6-round2-390', `#eq-${String(r2)}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOrder(`#eq-${String(r2)}`);

    // 바뀐 것만 골라 보낸다 — 접힌 1·3번은 손대지 않는다.
    // 항목 2 — B 에 메모를 적었다가 A 로 바꾼 채 보낸다. 확인창이 한 번 묻고, [그대로 회신]이면 의견째 나간다
    // (막지 않는다 — 의견이 선택과 무관한 메모일 수 있다).
    await page.locator(`#eqi-${String(j2)} input[value="B"]`).check();
    await page.locator(`#eqi-${String(j2)} textarea`).fill(MEMO);
    await page.locator(`#eqi-${String(j2)} input[value="A"]`).check();
    await page.locator(`#eqi-${String(j2)} [data-eqi-stale]`).waitFor({ state: 'visible' });
    await page.locator(`#eqi-${String(j4)} input[value="A"]`).check();
    await page.locator(`#eq-${String(r2)} input[name=agree]`).check();
    const r = await submitAndConfirm(r2);
    expect(r.confirm, '띠가 남아 있으면 그것부터 묻는다').toContain('항목 2: 처리 방법을 바꾼 뒤 의견을 확인하지 않으셨습니다');
    expect(r.cancelFocused, '이 확인창도 취소에 초점').toBe(true);
    expect(r.result).toContain('회신을 보냈습니다');
    await closeDialog();
    const review = await adminReview(r2);
    expect(review.status).toBe('answered');
    expect(review.items.map((i: any) => i.answer?.key), '접힌 항목의 이전 답도 제출됐다').toEqual(['A', 'A', 'A', 'A']);
    expect(review.items.map((i: any) => i.answer?.comment ?? null), '접힌 항목의 이전 의견 · 그대로 보낸 메모').toEqual([
      COMMENT_1,
      MEMO,
      null,
      null,
    ]);
  });

  test('C7. 대리 회신 회차 — 담당자가 대신 입력한 답변이라고 말한다', async () => {
    const { page } = customer;
    const rej = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: '공장 2차 개정 대기',
    });
    expect(rej.status, JSON.stringify(rej.json)).toBe(200);
    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const created = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    r3 = Number(created.json.data.review.id);
    const sent = await api(A, 'POST', `${adminBase()}/${String(r3)}/send`, {
      expectedVersion: created.json.data.review.version,
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const proxy = await api(A, 'POST', `${adminBase()}/${String(r3)}/answer`, {
      expectedVersion: sent.json.data.review.version,
      answers: sent.json.data.review.items.map((i: any) => ({ itemId: i.id, key: 'A' })),
      channel: 'phone',
      note: `고객 담당자와 통화로 확인 ${token}`,
    });
    expect(proxy.status, `대리 회신: ${JSON.stringify(proxy.json)}`).toBe(200);

    await openOrder(`#eq-${String(r3)}`);
    const round = page.locator(`#eq-${String(r3)}`);
    expect(await round.locator('.sp_eq_head').innerText()).toContain('3차 확인');
    expect(await round.locator('.sp_eq_head .sp_eq_badge').innerText()).toBe('회신 완료');
    const done = await round.locator('.sp_eq_done').innerText();
    expect(done).toContain('담당자가 확인해 대신 입력한 답변입니다');
    expect(done, '관리자 근거 메모는 고객에게 안 간다').not.toContain('통화로 확인');
    // 지난 회차들도 이력으로 남는다(최신이 위).
    const rounds = await page.evaluate(() =>
      [...document.querySelectorAll('#sp_eq_wrap > .sp_eq_item')].map((e) => e.id),
    );
    expect(rounds).toEqual([`eq-${String(r3)}`, `eq-${String(r2)}`, `eq-${String(r1)}`]);
    expect(await page.locator('#sp_eq_wrap > h2').innerText(), '열린 회차가 없으면 이력 제목').toBe('제조 확인 이력');
    await shot(page, 'c7-proxy-answered', `#eq-${String(r3)}`);
    await shot(page, 'c7-order-full');
  });

  test('C8. 좁은 폭(390px) — 회신 완료 요약·목록도 가로로 터지지 않는다', async () => {
    const { page } = customer;
    await page.setViewportSize({ width: 390, height: 900 });
    try {
      await openOrder(`#eq-${String(r1)}`);
      const detail = await overflow();
      expect(detail.over, `주문 상세 가로 넘침(${String(detail.width)}px): ${detail.culprits.join(' | ')}`).toBe(false);
      await shot(page, 'c8-order-390');
      await page.goto(`${BASE_URL}/shop/eq?scope=all`, { waitUntil: 'networkidle' });
      const list = await overflow();
      expect(list.over, `목록 가로 넘침(${String(list.width)}px): ${list.culprits.join(' | ')}`).toBe(false);
      await shot(page, 'c8-list-390');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test('C9. 어휘 — 제조 확인 영역·목록에 EQ·협력사명·공장 원문·그림 원본명이 없다, 스크립트 오류 0', async () => {
    const { page } = customer;
    const banned = [OWNER, '是否', '贵司', '可以', '丝印', 'factory-logo', 'silk-ref', 'questionOrig', 'labelOrig'];
    await openOrder();
    const section = await page.locator('#sp_eq_wrap').innerText();
    const sectionHtml = await page.locator('#sp_eq_wrap').innerHTML();
    expect(section, '제조 확인 영역에 EQ').not.toMatch(/EQ/);
    for (const w of banned) {
      expect(section, `제조 확인 영역에 '${w}'`).not.toContain(w);
      expect(sectionHtml, `제조 확인 마크업에 '${w}'`).not.toContain(w);
    }
    // 페이지 전체(보이는 글자) — 진행 단계·상품 줄 상태 칸까지 포함해 고객 화면 어디에도.
    const body = await page.locator('body').innerText();
    expect(body.match(/.{0,20}EQ.{0,20}/g) ?? [], '주문 상세 어딘가에 EQ').toEqual([]);
    for (const w of banned) expect(body, `주문 상세에 '${w}'`).not.toContain(w);
    await page.goto(`${BASE_URL}/shop/eq?scope=all`, { waitUntil: 'networkidle' });
    const list = await page.locator('.sp-eqm').innerText();
    expect(list, '목록에 EQ').not.toMatch(/EQ/);
    for (const w of banned) expect(list, `목록에 '${w}'`).not.toContain(w);
    expect(customer.pageErrors, '페이지 스크립트 오류').toEqual([]);
  });
});
