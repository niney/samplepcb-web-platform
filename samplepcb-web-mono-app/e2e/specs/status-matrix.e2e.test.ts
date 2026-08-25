// 상태 매트릭스 실측 — **관리자가 바꾼 상태가 고객에게 어떻게 보이는가**를 PCB·BOM 로 갈라 표로 뽑는다.
//
// 상태는 축이 넷이다(od_status / sp_pcb_po / sp_bom_quote / 취소류). 어느 축을 관리자가 바꾸면
// 고객 주문내역(목록·상세)·제작 진행 카드·/app/bom 에 무엇이 찍히는지를 **화면에서 읽어** 기록한다.
// 어서션은 최소(조작 API 가 200 인가)만 두고, 결과는 e2e/output/status-matrix.md 표가 산출물이다 —
// 시안(스텝퍼) 매핑을 정하기 전에 "지금 무엇이 보이는가"를 확정하는 관측 러너.
//
// 시드는 직삽입(실주문 복제, od_id 8-접두 16자리 = 목록 최상단·2^53 이하)이고, 끝나면 되돌리고 지운다.
// 실행: pnpm -F e2e e2e:status-matrix  (PORTAL_E2E=1 — 거버·엔진 불필요, nginx·API·웹·PHP 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  cleanupPcbPos,
  createOrderSpec,
  createPcbPo,
  deleteOrderHard,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newPhpSession,
  newSession,
  outputDir,
  requireCustomerCreds,
  signJwt,
  snap,
  type E2eSession,
  type PhpLoginResult,
} from '../helpers';

const RUN_TAG = String(Date.now()).slice(-6);
const SHOT_DIR = 'status-matrix';

/** 관리자 force-status 허용 13종 — 계약 AdminOrderForceStatusRequest.target 과 같은 순서(체인 순). */
const FORCE_TARGETS = [
  '주문', '입금', '준비', '가격확인', '파일검사', 'EQ', '생산시작', '생산중', '품질시험', '생산완료', 'A/S', '배송', '완료',
] as const;
const CANCEL_TARGETS = ['취소', '반품', '품절'] as const;
/** 모바일 폭 사진을 남길 관측점 — 미입금(입금 안내)·제작 중(카드)·부분 취소·BOM 입금. */
const MOBILE_SHOT_TAGS = new Set(['pcb-od-1-주문', 'pcb-po-producing', 'pcb-od-cancel-partial', 'bom-od-2-입금']);
const PCB_QUEUE_TABS = ['awaiting', 'active', 'done', 'canceled', 'all', 'to_ship', 'shipping'] as const;
/** 계약 PCB_PO_STATUS_LABELS.eq 사본(관리자 Case 화면이 찍는 라벨) — 화면 텍스트 매칭용. */
const PO_LABELS: Record<string, string> = {
  issued: '발주접수', eq_requested: 'EQ 승인요청', eq_done: 'EQ 완료', producing: '생산시작', produced: '생산완료',
};
/** 관리자 Case 배지(smartbom.ts SMARTBOM_STATUS_META) · 고객 히스토리 · 고객 상세 — 세 벌을 화면에서 찾는다. */
const BOM_LABEL_CANDIDATES = [
  '작성 중', '견적요청', '견적 요청', '견적요청 접수', '검토 중', '담당자 검토 중', '회신 완료', '답변 완료',
  '견적 회신 완료', '마감', '종료', '취소됨', '취소',
];

type CustomerView = {
  listFound: boolean;
  listLabel: string;
  listCls: string;
  detailLines: { name: string; status: string }[];
  /** 주문 진행 스텝퍼 현재 칸(08-25 신설). */
  stepper: string;
  progress: string[];
  progressCls: string[];
  cancelNotice: boolean;
  customerCancelBtn: boolean;
};
type AdminView = {
  status: string;
  cancelPrice: number;
  misu: number;
  uiLabel: string;
  /** 드로어 '협력 트랙 진행' 줄(08-25 신설) — 없으면 빈 문자열. */
  trackProgress: string;
  tabs: string[];
  pcbQueue: { odStatus: string; ctStatus: string; lineCanceled: boolean }[];
  pcbTabs: string[];
};
interface Row {
  track: 'PCB' | 'BOM';
  axis: string;
  action: string;
  db: string;
  admin: Partial<AdminView> & Record<string, unknown>;
  customer: Partial<CustomerView> & Record<string, unknown>;
  note: string;
}

describe.skipIf(!RUN)('상태 매트릭스 실측 — 관리자 상태 ↔ 고객 표시(PCB·BOM)', () => {
  const prisma = getPrisma();
  const A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
  const rows: Row[] = [];
  const notes: string[] = [];
  const ledger: string[] = [];

  let customer: PhpLoginResult;
  let admin: E2eSession;
  let mbId = '';

  // 시드 산출물
  let pcbOd = '';
  let pcbCts: number[] = [];
  let pcbSpecIds: bigint[] = [];
  let pcbPoId: bigint | null = null;
  let bomOd = '';
  let bomCts: number[] = [];
  let quoteWalk = '';
  let quoteCancel = '';
  let quoteOrder = '';

  const log = (s: string): void => {
    notes.push(s);
    console.log(`  ${s}`);
  };

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const shot = async (page: any, name: string): Promise<void> => {
    try {
      await snap(page, `${SHOT_DIR}/${name}`);
    } catch {
      /* 스크린샷 실패는 관측을 막지 않는다 */
    }
  };

  // ── 시드(직삽입) ─────────────────────────────────────────────────────────────
  const tableCols = async (table: string, exclude: string[]): Promise<string[]> => {
    const cols: any[] = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      table,
    );
    return cols.map((c) => String(c.COLUMN_NAME)).filter((n) => !exclude.includes(n));
  };
  const insertCopy = async (
    table: string,
    names: string[],
    overrides: Record<string, string>,
    sourceWhere: string,
  ): Promise<void> => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (${names.map((n) => `\`${n}\``).join(', ')})
         SELECT ${names.map((n) => overrides[n] ?? `\`${n}\``).join(', ')} FROM ${table} ${sourceWhere} LIMIT 1`,
    );
  };

  /** 실주문 복제 — od_id 8-접두 16자리(코어 od_id 는 2026… 이라 DESC 정렬에서 맨 위). */
  const seedOrder = async (
    kind: 'pcb' | 'bom',
    label: string,
    lineCount: number,
    bomQuoteId?: string,
  ): Promise<{ odId: string; ctIds: number[] }> => {
    // 8-접두 16자리: 코어 od_id(2026…)보다 커서 목록 맨 위에 서고, 2^53(9.007e15) 아래라 JS Number 를
    // 거치는 관리자 API 에서도 자릿수가 안 깨진다(9-접두 홀수는 …601→…600 으로 반올림돼 못 찾았다 — 1차 실측).
    const odId = `8${String(Date.now())}${kind === 'pcb' ? '01' : '02'}`;
    const oCols = await tableCols('g5_shop_order', []);
    await insertCopy(
      'g5_shop_order',
      oCols,
      {
        od_id: odId,
        mb_id: `'${mbId}'`,
        od_name: `'${label}'`,
        od_status: `'입금'`,
        od_time: 'NOW()',
        od_cancel_price: '0',
        od_refund_price: '0',
        od_misu: '0',
        od_receipt_point: '0',
        od_invoice: `''`,
        od_delivery_company: `''`,
      },
      `WHERE mb_id = '${mbId}' AND od_settle_case = '무통장' AND od_id < 8000000000000000 ORDER BY od_id DESC`,
    );
    const cCols = await tableCols('g5_shop_cart', ['ct_id']);
    const itId = kind === 'pcb' ? 'sp-pcb-std' : 'sp-bom-parts';
    for (let i = 1; i <= lineCount; i += 1) {
      await insertCopy(
        'g5_shop_cart',
        cCols,
        {
          od_id: `'${odId}'`,
          mb_id: `'${mbId}'`,
          ct_status: `'입금'`,
          ct_time: 'NOW()',
          ct_point: '0',
          ct_stock_use: '0',
          ct_select: '1',
          ct_qty: '1',
          it_name: `'${label} 줄${String(i)}'`,
          ...(bomQuoteId === undefined ? {} : { io_id: `'bom-${bomQuoteId}'` }),
        },
        `WHERE it_id = '${itId}' AND od_id <> '' AND od_id < 8000000000000000 ORDER BY ct_id DESC`,
      );
    }
    const made: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_id FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id ASC`,
      odId,
    );
    const ctIds = made.map((r) => Number(r.ct_id));
    if (ctIds.length !== lineCount) throw new Error(`카트 행 시드 실패(${label})`);
    ledger.push(`g5_shop_order ${odId} + cart ${ctIds.join(',')} (${label})`);
    return { odId, ctIds };
  };

  const odRow = async (odId: string): Promise<{ status: string; cancel: number; misu: number }> => {
    const r: any[] = await prisma.$queryRawUnsafe(
      `SELECT od_status, od_cancel_price, od_misu FROM g5_shop_order WHERE od_id = ?`,
      odId,
    );
    return { status: String(r[0]?.od_status ?? ''), cancel: Number(r[0]?.od_cancel_price ?? 0), misu: Number(r[0]?.od_misu ?? 0) };
  };
  const ctStatuses = async (odId: string): Promise<string[]> => {
    const r: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct_status FROM g5_shop_cart WHERE od_id = ? ORDER BY ct_id ASC`,
      odId,
    );
    return r.map((x) => String(x.ct_status));
  };

  // ── 조작 ────────────────────────────────────────────────────────────────────
  const force = async (odId: string, target: string, extra: Record<string, unknown> = {}): Promise<{ status: number; json: any }> =>
    api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target, ...extra });
  const cancelLines = async (odId: string, ctIds: number[], target: string): Promise<{ status: number; json: any }> =>
    api(A, 'PATCH', `/api/admin/orders/${odId}/items/status`, { ctIds, target });
  /** 취소류 뒤 되살리기 — '주문'(역방향, 취소 줄 포함) → '입금'. */
  const revive = async (odId: string): Promise<void> => {
    const back = await force(odId, '주문');
    expect(back.status, `되살리기(주문): ${JSON.stringify(back.json)}`).toBe(200);
    const paid = await force(odId, '입금');
    expect(paid.status, `되살리기(입금): ${JSON.stringify(paid.json)}`).toBe(200);
  };

  // ── 관측 ────────────────────────────────────────────────────────────────────
  const observeCustomer = async (odId: string, tag: string): Promise<CustomerView> => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
    const list = await page.evaluate((id: string) => {
      const tr = [...document.querySelectorAll('tr')].find((r) => (r.textContent ?? '').includes(id));
      const cell = tr?.querySelector('.sod_col_status') as HTMLElement | null;
      const span = cell?.querySelector('span') as HTMLElement | null;
      return {
        listFound: tr !== undefined,
        listLabel: (span?.textContent ?? cell?.textContent ?? '').trim(),
        listCls: span?.className ?? '',
      };
    }, odId);
    await shot(page, `${tag}-customer-list`);
    await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, { waitUntil: 'domcontentloaded' });
    const detail = await page.evaluate(() => {
      const table = document.querySelector('#sod_fin_list table');
      const lines = [...(table?.querySelector('tbody')?.rows ?? [])].map((tr) => ({
        name: ((tr.querySelector('.sod_name') as HTMLElement | null)?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
        status: ((tr.querySelector('td[headers="th_itst"]') as HTMLElement | null)?.textContent ?? '').trim(),
      }));
      const badges = [...document.querySelectorAll('#sp_progress_wrap:not(.is-quiet) .sp_eq_badge')] as HTMLElement[];
      const text = document.body.innerText;
      // 스텝퍼(08-25 신설) — 현재 칸(취소면 취소 배지) + 위치.
      const cur = document.querySelector('.sp-steps__item.is-current .sp-steps__dot')?.textContent?.trim()
        ?? document.querySelector('.sp-steps__cancel-badge')?.textContent?.trim() ?? '(스텝퍼 없음)';
      const total = document.querySelectorAll('.sp-steps__item').length;
      const done = document.querySelectorAll('.sp-steps__item.is-done').length;
      return {
        detailLines: lines,
        stepper: `${cur} (${String(done + 1)}/${String(total)})`,
        progress: badges.map((b) => (b.textContent ?? '').trim().replace(/\s+/g, ' ')),
        progressCls: badges.map((b) => b.className.trim()),
        cancelNotice: text.includes('주문 취소, 반품, 품절된 내역이 있습니다'),
        customerCancelBtn: [...document.querySelectorAll('a,button,input')].some((el) =>
          /주문취소|주문 취소/.test((el as HTMLElement).textContent ?? (el as HTMLInputElement).value ?? ''),
        ),
      };
    });
    await shot(page, `${tag}-customer-detail`);
    // 단계 설명(옛 상태설명 재배치) 펼친 화면 — 아래 ⑩ 변형의 주입 CSS 가 섞이지 않게 먼저 찍는다.
    const help = MOBILE_SHOT_TAGS.has(tag) ? await page.$('#sod_sts_explan_open') : null;
    if (help !== null) {
      await help.click();
      await page.waitForTimeout(400);
      await shot(page, `${tag}-customer-detail-legend`);
    }
    // ⑩ 비교용(08-25) — 카드가 auto 규칙으로 숨은 화면이면 '항상 표시' 변형도 한 장.
    if ((await page.$('#sp_progress_wrap.is-quiet')) !== null) {
      await page.addStyleTag({ content: '#sod_fin #sp_progress_wrap.is-quiet{display:block !important}' });
      await shot(page, `${tag}-customer-detail-card-always`);
    }
    // 모바일 폭(시안은 1920 한 장 — 좁은 폭 규칙은 이쪽 판단이라 사진으로 남긴다)
    if (MOBILE_SHOT_TAGS.has(tag)) {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await shot(page, `${tag}-customer-detail-mobile`);
      if (vp !== null) await page.setViewportSize(vp);
    }
    return { ...list, ...detail };
  };

  const observeAdmin = async (odId: string, tag: string, withPcbQueue: boolean): Promise<AdminView> => {
    const found = await api(A, 'GET', `/api/admin/orders?tab=전체&qField=od_id&q=${odId}&page=1&pageSize=20`);
    const item = (found.json?.data?.items ?? []).find((i: any) => i.odId === odId);
    const status = String(item?.status ?? '?');
    // 어느 탭에 서는가 — 탭은 od_status 리터럴이라 그 탭 + 부분취소 탭만 찔러 본다.
    const tabs: string[] = [];
    for (const tab of [status, '부분취소']) {
      if (tab === '?') continue;
      const r = await api(A, 'GET', `/api/admin/orders?tab=${encodeURIComponent(tab)}&qField=od_id&q=${odId}&page=1&pageSize=20`);
      if ((r.json?.data?.items ?? []).some((i: any) => i.odId === odId)) tabs.push(tab);
    }
    // 관리자 통합 주문내역 화면 — 목록 배지 + 드로어
    const page = admin.page;
    let uiLabel = '';
    let trackProgress = '';
    try {
      await page.goto(`${BASE_URL}/app/admin/orders`, { waitUntil: 'domcontentloaded' });
      const formatted = `${odId.slice(0, 8)}-${odId.slice(8)}`;
      const row = page.locator('tr', { hasText: formatted }).first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      uiLabel = (await row.locator('td').nth(11).innerText()).trim();
      await shot(page, `${tag}-admin-list`);
      await row.click();
      await page.waitForTimeout(1_200);
      // 드로어의 협력 트랙 진행 줄(08-25 신설) — 있으면 od 스텝퍼 옆에 실제 제작 진행이 찍힌다.
      trackProgress = await page.evaluate(() => {
        const el = document.querySelector('.bg-violet-50');
        return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      await shot(page, `${tag}-admin-drawer`);
    } catch (e) {
      uiLabel = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    let pcbQueue: AdminView['pcbQueue'] = [];
    const pcbTabs: string[] = [];
    if (withPcbQueue) {
      for (const tab of PCB_QUEUE_TABS) {
        const r = await api(A, 'GET', `/api/admin/pcb-orders?tab=${tab}&q=${odId}&page=1&pageSize=50`);
        const hits: any[] = (r.json?.data?.items ?? []).filter((i: any) => i.odId === odId);
        if (hits.length > 0) pcbTabs.push(tab);
        if (tab === 'all') pcbQueue = hits.map((h) => ({ odStatus: String(h.odStatus), ctStatus: String(h.ctStatus), lineCanceled: Boolean(h.lineCanceled) }));
      }
    }
    return {
      status,
      cancelPrice: Number(item?.cancelPrice ?? 0),
      misu: Number(item?.misu ?? 0),
      uiLabel,
      trackProgress,
      tabs,
      pcbQueue,
      pcbTabs,
    };
  };

  /** 관리자 PCB Case 화면에서 발주 상태 라벨 실측. */
  const observeAdminPcbCase = async (specId: bigint, tag: string): Promise<{ label: string; api: string }> => {
    const page = admin.page;
    let label = '';
    try {
      await page.goto(`${BASE_URL}/app/admin/pcb/cases/${String(specId)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(600);
      // 발주 표의 상태 배지(span.px-1.5.font-semibold) 만 읽는다 — 본문 전체에는 탭·범례로 다른 라벨도 섞인다.
      label = await page.evaluate((cands: string[]) => {
        const spans = [...document.querySelectorAll('span')].filter(
          (s) => s.className.includes('px-1.5') && s.className.includes('font-semibold') && cands.includes((s.textContent ?? '').trim()),
        );
        return spans.map((s) => (s.textContent ?? '').trim()).join('/');
      }, Object.values(PO_LABELS));
      await shot(page, `${tag}-admin-pcb-case`);
    } catch (e) {
      label = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    const r = await api(A, 'GET', `/api/admin/pcb-projects/${String(specId)}/pos`);
    const d = r.json?.data;
    const pos: any[] = Array.isArray(d) ? d : (d?.pos ?? d?.items ?? []);
    const apiStatus = pos.length > 0 ? pos.map((p) => String(p.status)).join(',') : `(pos 없음: keys=${Object.keys(r.json?.data ?? {}).slice(0, 12).join(',')})`;
    return { label, api: apiStatus };
  };

  /** BOM 견적 한 상태에서 고객 히스토리·고객 상세·관리자 Case 를 읽는다. */
  const observeBomQuote = async (
    quoteId: string,
    title: string,
    tag: string,
  ): Promise<{ db: string; adminApi: string; adminBadge: string; adminStep: string; historyLabel: string; detailLabel: string; detailError: string }> => {
    const q = await prisma.spBomQuote.findUnique({ where: { id: BigInt(quoteId) }, select: { status: true } });
    const r = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const adminApi = String(r.json?.data?.status ?? `HTTP${String(r.status)}`);

    const page = customer.page;
    let historyLabel = '';
    let detailLabel = '';
    let detailError = '';
    try {
      await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
      await page.locator('tr', { hasText: title }).first().waitFor({ state: 'visible', timeout: 30_000 });
      historyLabel = (await page.locator('tr', { hasText: title }).first().locator('span.rounded-full').first().innerText()).trim();
      await shot(page, `${tag}-customer-bom-history`);
    } catch (e) {
      historyLabel = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    try {
      await page.goto(`${BASE_URL}/app/bom/${quoteId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(800);
      const res = await page.evaluate((cands: string[]) => {
        const text = document.body.innerText;
        const badge = [...document.querySelectorAll('span')].find((s) => s.className.includes('bg-blue-50') && cands.includes((s.textContent ?? '').trim()));
        const err = /오류|실패|찾을 수 없|불러오지 못/.exec(text)?.[0] ?? '';
        return { badge: (badge?.textContent ?? '').trim(), err };
      }, BOM_LABEL_CANDIDATES);
      detailLabel = res.badge;
      detailError = res.err;
      await shot(page, `${tag}-customer-bom-detail`);
    } catch (e) {
      detailLabel = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }

    const ap = admin.page;
    let adminBadge = '';
    let adminStep = '';
    try {
      await ap.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteId}`, { waitUntil: 'domcontentloaded' });
      await ap.waitForLoadState('networkidle').catch(() => undefined);
      await ap.waitForTimeout(800);
      const res = await ap.evaluate((cands: string[]) => {
        const badge = [...document.querySelectorAll('span')].find(
          (s) => s.className.includes('font-semibold') && s.className.includes('px-2') && cands.includes((s.textContent ?? '').trim()),
        );
        const cur = [...document.querySelectorAll('li[data-smartbom-step]')].find((li) => {
          const dot = li.querySelector('span');
          return dot !== null && (dot.className.includes('bg-blue-600') || dot.className.includes('bg-red-600'));
        });
        const stepNo = cur?.getAttribute('data-smartbom-step') ?? '';
        const stepText = (cur?.querySelectorAll('span')[1]?.textContent ?? '').trim();
        return { badge: (badge?.textContent ?? '').trim(), step: stepNo === '' ? '(현재 단계 없음)' : `${stepNo} ${stepText}` };
      }, BOM_LABEL_CANDIDATES);
      adminBadge = res.badge;
      adminStep = res.step;
      await shot(ap, `${tag}-admin-bom-case`);
    } catch (e) {
      adminBadge = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    return { db: String(q?.status ?? '?'), adminApi, adminBadge, adminStep, historyLabel, detailLabel, detailError };
  };

  const fmtLines = (v: Partial<CustomerView>): string =>
    (v.detailLines ?? []).map((l) => l.status === '' ? '(빈칸)' : l.status).join(' / ');
  const fmtProgress = (v: Partial<CustomerView>): string =>
    (v.progress ?? []).length === 0 ? '(카드 없음)' : (v.progress ?? []).join(' / ');

  // ── 전후 처리 ────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    const creds = requireCustomerCreds();
    mbId = creds.id;
    customer = await newPhpSession(creds);
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mkdirSync(join(outputDir, SHOT_DIR), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    // 정리 — 재고 앵커: 배송/완료를 거쳤으면 '주문' 으로 되돌려 재고를 복원한 뒤 삭제.
    for (const odId of [pcbOd, bomOd]) {
      if (odId === '') continue;
      try {
        await force(odId, '주문');
      } catch {
        /* 되돌리기 실패해도 삭제는 진행 */
      }
    }
    try {
      if (pcbPoId !== null) await cleanupPcbPos([pcbPoId]);
      if (pcbSpecIds.length > 0) await prisma.spOrderSpec.deleteMany({ where: { id: { in: pcbSpecIds } } });
      for (const odId of [pcbOd, bomOd]) if (odId !== '') await deleteOrderHard(odId);
      const quoteIds = [quoteWalk, quoteCancel, quoteOrder].filter((q) => q !== '').map((q) => BigInt(q));
      if (quoteIds.length > 0) await prisma.spBomQuote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.spMailLog.deleteMany({ where: { refType: 'order', refId: { in: [pcbOd, bomOd].filter((o) => o !== '') } } }).catch(() => undefined);
    } catch (e) {
      notes.push(`정리 실패: ${e instanceof Error ? e.message : String(e)} — 대장: ${ledger.join(' | ')}`);
    }
    writeReport();
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  const writeReport = (): void => {
    const md: string[] = [
      `# 상태 매트릭스 실측 (${new Date().toISOString()})`,
      '',
      '관리자가 바꾼 상태 → 고객 화면 표기. 시드는 실주문 복제(직삽입), 끝난 뒤 삭제. 스크린샷: e2e/output/status-matrix/*.png',
      '',
    ];
    const section = (title: string, cols: string[], pick: (r: Row) => string[], filter: (r: Row) => boolean): void => {
      const list = rows.filter(filter);
      if (list.length === 0) return;
      md.push(`## ${title}`, '', `| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`);
      for (const r of list) md.push(`| ${pick(r).map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
      md.push('');
    };
    section(
      'PCB — od_status 축 (관리자 통합 주문내역 force-status / 줄 취소)',
      ['관리자 조작', 'DB od_status', '관리자 배지(목록)', '드로어 협력 트랙 줄', '관리자 탭', 'PCB 큐 탭', 'PCB 큐 od/ct', '고객 목록 배지', '고객 목록 class', '고객 상세 줄 상태', '제작 진행 카드', '스텝퍼 현재', '비고'],
      (r) => [r.action, r.db, String(r.admin.uiLabel ?? ''), String(r.admin.trackProgress ?? ''), (r.admin.tabs ?? []).join(','), (r.admin.pcbTabs ?? []).join(','),
        (r.admin.pcbQueue ?? []).map((q) => `${q.odStatus}/${q.ctStatus}${q.lineCanceled ? '(줄취소)' : ''}`).join(' '),
        String(r.customer.listLabel ?? ''), String(r.customer.listCls ?? ''), fmtLines(r.customer), fmtProgress(r.customer), String(r.customer.stepper ?? ''), r.note],
      (r) => r.track === 'PCB' && r.axis === 'od_status',
    );
    section(
      'PCB — 협력 트랙 축 (sp_pcb_po.status → 고객 제작 진행 카드, od 무접촉)',
      ['발주 상태(DB)', '관리자 Case 라벨', '관리자 API', 'od_status', '관리자 배지(목록)', '드로어 협력 트랙 줄', '고객 목록 배지', '고객 목록 class', '고객 상세 줄 상태', '제작 진행 카드', '카드 class', '스텝퍼 현재', '비고'],
      (r) => [r.db, String(r.admin.caseLabel ?? ''), String(r.admin.apiStatus ?? ''), String(r.admin.odStatus ?? ''), String(r.admin.uiLabel ?? ''), String(r.admin.trackProgress ?? ''),
        String(r.customer.listLabel ?? ''), String(r.customer.listCls ?? ''), fmtLines(r.customer), fmtProgress(r.customer), (r.customer.progressCls ?? []).join(' / '), String(r.customer.stepper ?? ''), r.note],
      (r) => r.track === 'PCB' && r.axis === 'pcb_po',
    );
    section(
      'BOM — 견적 축 (sp_bom_quote.status)',
      ['관리자 조작', 'DB status', '관리자 API', '관리자 Case 배지', '관리자 타임라인 현재 단계', '고객 히스토리 라벨', '고객 상세 라벨', '고객 상세 오류문구', '비고'],
      (r) => [r.action, r.db, String(r.admin.apiStatus ?? ''), String(r.admin.badge ?? ''), String(r.admin.step ?? ''), String(r.customer.historyLabel ?? ''), String(r.customer.detailLabel ?? ''), String(r.customer.detailError ?? ''), r.note],
      (r) => r.track === 'BOM' && r.axis === 'bom_quote',
    );
    section(
      'BOM — od_status 축 (부품 주문의 영카트 상태)',
      ['관리자 조작', 'DB od_status', '관리자 배지(목록)', '관리자 탭', '고객 목록 배지', '고객 목록 class', '고객 상세 줄 상태', '제작 진행 카드', '스텝퍼 현재', 'Case 타임라인 단계', '비고'],
      (r) => [r.action, r.db, String(r.admin.uiLabel ?? ''), (r.admin.tabs ?? []).join(','), String(r.customer.listLabel ?? ''), String(r.customer.listCls ?? ''), fmtLines(r.customer), fmtProgress(r.customer), String(r.customer.stepper ?? ''), String(r.admin.step ?? ''), r.note],
      (r) => r.track === 'BOM' && r.axis === 'od_status',
    );
    md.push('## 메모', '', ...notes.map((n) => `- ${n}`), '', '## 생성물 대장(정리됨)', '', ...ledger.map((l) => `- ${l}`), '');
    writeFileSync(join(outputDir, 'status-matrix.md'), md.join('\n'), 'utf8');
    writeFileSync(join(outputDir, 'status-matrix.json'), JSON.stringify({ rows, notes, ledger }, null, 2), 'utf8');
    console.log(`\n리포트: e2e/output/status-matrix.md\n${md.join('\n')}`);
  };

  // ── T0 시드 ──────────────────────────────────────────────────────────────────
  test('T0. 시드 — PCB 주문(2줄+스펙) · BOM 견적 3건 · BOM 주문(1줄)', async () => {
    const pcb = await seedOrder('pcb', `상태매트릭스PCB-${RUN_TAG}`, 2);
    pcbOd = pcb.odId;
    pcbCts = pcb.ctIds;
    for (const [i, ctId] of pcbCts.entries()) {
      const spec = await createOrderSpec({
        mbId,
        ctId,
        projectName: `SM-${RUN_TAG}-L${String(i + 1)}`,
        category: 'standard',
        specJson: { note: 'status-matrix' },
      });
      pcbSpecIds.push(BigInt(spec.id));
    }
    ledger.push(`sp_order_spec ${pcbSpecIds.map(String).join(',')}`);

    const mkQuote = async (title: string, status: string): Promise<string> => {
      const q = await prisma.spBomQuote.create({
        data: { mbId, title, status, fileName: 'status-matrix.csv', buildStatus: 'ready', enrichStatus: 'done', setQty: 1 },
        select: { id: true },
      });
      ledger.push(`sp_bom_quote #${String(q.id)} (${title})`);
      return String(q.id);
    };
    quoteWalk = await mkQuote(`SM-${RUN_TAG} 견적축 순회`, 'draft');
    quoteCancel = await mkQuote(`SM-${RUN_TAG} 견적축 취소`, 'draft');
    quoteOrder = await mkQuote(`SM-${RUN_TAG} 주문 연결`, 'answered');
    await prisma.spBomQuote.update({ where: { id: BigInt(quoteOrder) }, data: { confirmedTotal: 60_000, answeredAt: new Date() } });

    const bom = await seedOrder('bom', `상태매트릭스BOM-${RUN_TAG}`, 1, quoteOrder);
    bomOd = bom.odId;
    bomCts = bom.ctIds;
    await prisma.spBomQuote.update({ where: { id: BigInt(quoteOrder) }, data: { ctId: bomCts[0] ?? null } });
    log(`시드 — PCB od=${pcbOd} ct=${pcbCts.join(',')} spec=${pcbSpecIds.map(String).join(',')} · BOM od=${bomOd} ct=${bomCts.join(',')} quotes=${quoteWalk}/${quoteCancel}/${quoteOrder}`);
  }, 120_000);

  // ── T1 PCB od 축: force-status 13종 ─────────────────────────────────────────
  test('T1. PCB od_status 축 — force-status 13종 순회', async (ctx) => {
    if (pcbOd === '') return ctx.skip();
    for (const target of FORCE_TARGETS) {
      const r = await force(pcbOd, target);
      const db = await odRow(pcbOd);
      const cts = await ctStatuses(pcbOd);
      const tag = `pcb-od-${FORCE_TARGETS.indexOf(target) + 1}-${target.replace('/', '')}`;
      const note = r.status === 200 ? '' : `force-status ${String(r.status)} ${String(r.json?.error ?? '')}`;
      const adminV = await observeAdmin(pcbOd, tag, true);
      const custV = await observeCustomer(pcbOd, tag);
      rows.push({
        track: 'PCB', axis: 'od_status', action: `force-status → ${target}`,
        db: `${db.status} (ct: ${cts.join(',')})`, admin: adminV, customer: custV, note,
      });
      log(`[PCB od] ${target}: db=${db.status} admin=${adminV.uiLabel} pcbTabs=${adminV.pcbTabs.join(',')} | 고객 목록=${custV.listLabel}(${custV.listCls}) 상세=${fmtLines(custV)} 카드=${fmtProgress(custV)}`);
    }
  }, 900_000);

  // ── T2 PCB od 축: 취소류 ─────────────────────────────────────────────────────
  test('T2. PCB od_status 축 — 부분 취소 · 전량 취소/반품/품절', async (ctx) => {
    if (pcbOd === '' || pcbCts.length < 2) return ctx.skip();
    // '완료' 에서 끝났으므로 '주문' → '입금' 으로 되돌린 뒤 시작(재고 앵커 복원 포함).
    await revive(pcbOd);

    const partial = await cancelLines(pcbOd, [pcbCts[1] ?? 0], '취소');
    {
      const db = await odRow(pcbOd);
      const cts = await ctStatuses(pcbOd);
      const tag = 'pcb-od-cancel-partial';
      const adminV = await observeAdmin(pcbOd, tag, true);
      const custV = await observeCustomer(pcbOd, tag);
      rows.push({
        track: 'PCB', axis: 'od_status', action: 'items/status 취소 (2줄 중 1줄 = 부분 취소)',
        db: `${db.status} cancel=${String(db.cancel)} (ct: ${cts.join(',')})`, admin: adminV, customer: custV,
        note: partial.status === 200 ? `orderCancelled=${String(partial.json?.data?.orderCancelled)}` : `items/status ${String(partial.status)} ${String(partial.json?.error ?? '')}`,
      });
      log(`[PCB od] 부분취소: db=${db.status}/${cts.join(',')} admin=${adminV.uiLabel} tabs=${adminV.tabs.join(',')} | 고객 목록=${custV.listLabel} 상세=${fmtLines(custV)}`);
    }
    await revive(pcbOd);

    for (const target of CANCEL_TARGETS) {
      const r = await cancelLines(pcbOd, pcbCts, target);
      const db = await odRow(pcbOd);
      const cts = await ctStatuses(pcbOd);
      const tag = `pcb-od-cancel-all-${target}`;
      const adminV = await observeAdmin(pcbOd, tag, true);
      const custV = await observeCustomer(pcbOd, tag);
      rows.push({
        track: 'PCB', axis: 'od_status', action: `items/status ${target} (전량)`,
        db: `${db.status} cancel=${String(db.cancel)} (ct: ${cts.join(',')})`, admin: adminV, customer: custV,
        note: r.status === 200 ? `orderCancelled=${String(r.json?.data?.orderCancelled)}` : `items/status ${String(r.status)} ${String(r.json?.error ?? '')}`,
      });
      log(`[PCB od] 전량 ${target}: db=${db.status}/${cts.join(',')} admin=${adminV.uiLabel} tabs=${adminV.tabs.join(',')} pcbTabs=${adminV.pcbTabs.join(',')} | 고객 목록=${custV.listLabel}(${custV.listCls}) 상세=${fmtLines(custV)}`);
      await revive(pcbOd);
    }
  }, 900_000);

  // ── T3 PCB 협력 트랙 축 ───────────────────────────────────────────────────────
  test('T3. PCB 협력 트랙 축 — 발주 5상태 + 선적 2단계 → 고객 제작 진행 카드', async (ctx) => {
    if (pcbOd === '' || pcbSpecIds.length === 0) return ctx.skip();
    const partner = await getPartner('협력1');
    const specId = pcbSpecIds[0] as bigint;
    const po = await createPcbPo({ specId, partnerId: partner.id, status: 'issued', destinationCountry: null });
    pcbPoId = BigInt(po.id);
    ledger.push(`sp_pcb_po #${String(pcbPoId)} (spec ${String(specId)}, ${partner.name})`);

    const observeTrack = async (label: string, tag: string, note: string): Promise<void> => {
      const poRow = await prisma.spPcbPo.findUnique({ where: { id: pcbPoId as bigint }, select: { status: true } });
      const ship = await prisma.spPcbShipment.findFirst({ where: { poId: pcbPoId as bigint }, select: { status: true, receivedAt: true } });
      const db = `${String(poRow?.status)}${ship === null ? '' : ` + shipment ${ship.status}${ship.receivedAt === null ? '' : '(received)'}`}`;
      const od = await odRow(pcbOd);
      const caseV = await observeAdminPcbCase(specId, tag);
      const adminV = await observeAdmin(pcbOd, tag, false);
      const custV = await observeCustomer(pcbOd, tag);
      rows.push({
        track: 'PCB', axis: 'pcb_po', action: label, db,
        admin: { caseLabel: caseV.label, apiStatus: caseV.api, odStatus: od.status, uiLabel: adminV.uiLabel, trackProgress: adminV.trackProgress },
        customer: custV, note,
      });
      log(`[PCB po] ${label}: db=${db} case=${caseV.label} api=${caseV.api} od=${od.status} drawer=${adminV.trackProgress} | 목록=${custV.listLabel}(${custV.listCls}) 줄=${fmtLines(custV)} 카드=${fmtProgress(custV)}`);
    };

    for (const st of ['issued', 'eq_requested', 'eq_done', 'producing', 'produced']) {
      await prisma.spPcbPo.update({ where: { id: pcbPoId }, data: { status: st } });
      await observeTrack(`po.status = ${st}`, `pcb-po-${st}`, 'DB 직접 전이(파생 규칙 관측)');
    }
    // 선적 — 관리자향(receiverKind admin) 발송이 붙으면 shipping → 입고확인으로 received.
    const shipment = await prisma.spPcbShipment.create({
      data: {
        poId: pcbPoId, specId, mode: 'domestic', status: 'shipping', receiverKind: 'admin', shippedAt: new Date(),
        pos: { create: { poId: pcbPoId } },
      },
      select: { id: true },
    });
    ledger.push(`sp_pcb_shipment #${String(shipment.id)}`);
    await observeTrack('shipment.status = shipping (입고 운송)', 'pcb-po-shipping', '선적 직삽입(domestic·admin 수신)');
    await prisma.spPcbShipment.update({ where: { id: shipment.id }, data: { status: 'delivered', receivedAt: new Date() } });
    await observeTrack('shipment.receivedAt 세팅 (입고 확인)', 'pcb-po-received', '');
    // od 가 배송으로 넘어가면 카드가 접힌다(PROGRESS_CLOSED_OD) — 그 경계도 실측.
    const ship = await force(pcbOd, '배송');
    await observeTrack('(od force-status → 배송, po 그대로)', 'pcb-po-od-shipping', ship.status === 200 ? 'od 배송 진입 시 카드 접힘 경계' : `force ${String(ship.status)}`);
    await force(pcbOd, '주문');
    await force(pcbOd, '입금');
  }, 900_000);

  // ── T4 BOM 견적 축 ──────────────────────────────────────────────────────────
  test('T4. BOM 견적 축 — draft→requested→reviewing→answered→closed · draft→canceled', async (ctx) => {
    if (quoteWalk === '') return ctx.skip();
    const titleWalk = `SM-${RUN_TAG} 견적축 순회`;
    const titleCancel = `SM-${RUN_TAG} 견적축 취소`;

    const record = async (quoteId: string, title: string, action: string, tag: string, note: string): Promise<void> => {
      const v = await observeBomQuote(quoteId, title, tag);
      rows.push({
        track: 'BOM', axis: 'bom_quote', action, db: v.db,
        admin: { apiStatus: v.adminApi, badge: v.adminBadge, step: v.adminStep },
        customer: { historyLabel: v.historyLabel, detailLabel: v.detailLabel, detailError: v.detailError }, note,
      });
      log(`[BOM quote] ${action}: db=${v.db} admin=${v.adminBadge}/${v.adminStep} | 고객 히스토리=${v.historyLabel} 상세=${v.detailLabel} ${v.detailError}`);
    };

    await record(quoteWalk, titleWalk, '(시드) draft', 'bom-quote-1-draft', '');
    const step = async (target: string, tag: string): Promise<void> => {
      const r = await api(A, 'PATCH', `/api/admin/bom-quotes/${quoteWalk}`, { status: target });
      let note = r.status === 200 ? 'PATCH /admin/bom-quotes/:id' : `PATCH ${String(r.status)} ${String(r.json?.error ?? r.json?.message ?? '')}`;
      if (r.status !== 200) {
        await prisma.spBomQuote.update({ where: { id: BigInt(quoteWalk) }, data: { status: target } });
        note += ' → DB 직접 전이';
      }
      await record(quoteWalk, titleWalk, `→ ${target}`, tag, note);
    };
    await step('requested', 'bom-quote-2-requested');
    await step('reviewing', 'bom-quote-3-reviewing');
    {
      const r = await api(A, 'POST', `/api/admin/bom-quotes/${quoteWalk}/complete`, {
        answerNote: '상태 매트릭스 실측 회신', confirmedShippingFee: 0, confirmedManagementFee: 0, confirmedTotal: 10_000, sendEmail: false,
      });
      let note = r.status === 200 ? 'POST /complete (회신 확정)' : `complete ${String(r.status)} ${String(r.json?.error ?? r.json?.message ?? '')}`;
      if (r.status !== 200) {
        await prisma.spBomQuote.update({ where: { id: BigInt(quoteWalk) }, data: { status: 'answered', answeredAt: new Date(), confirmedTotal: 10_000 } });
        note += ' → DB 직접 전이';
      }
      await record(quoteWalk, titleWalk, '→ answered', 'bom-quote-4-answered', note);
    }
    await step('closed', 'bom-quote-5-closed');

    await record(quoteCancel, titleCancel, '(시드) draft', 'bom-quote-c1-draft', '');
    {
      const r = await api(A, 'PATCH', `/api/admin/bom-quotes/${quoteCancel}`, { status: 'canceled' });
      let note = r.status === 200 ? 'PATCH /admin/bom-quotes/:id' : `PATCH ${String(r.status)} ${String(r.json?.error ?? r.json?.message ?? '')}`;
      if (r.status !== 200) {
        await prisma.spBomQuote.update({ where: { id: BigInt(quoteCancel) }, data: { status: 'canceled' } });
        note += ' → DB 직접 전이';
      }
      await record(quoteCancel, titleCancel, '→ canceled', 'bom-quote-c2-canceled', note);
    }
  }, 900_000);

  // ── T5 BOM od 축 ────────────────────────────────────────────────────────────
  test('T5. BOM od_status 축 — force-status 13종 + 취소', async (ctx) => {
    if (bomOd === '') return ctx.skip();
    const titleOrder = `SM-${RUN_TAG} 주문 연결`;
    const caseStep = async (tag: string): Promise<string> => {
      const ap = admin.page;
      try {
        await ap.goto(`${BASE_URL}/app/admin/smartbom/cases/${quoteOrder}`, { waitUntil: 'domcontentloaded' });
        await ap.waitForLoadState('networkidle').catch(() => undefined);
        await ap.waitForTimeout(800);
        const s: string = await ap.evaluate(() => {
          const cur = [...document.querySelectorAll('li[data-smartbom-step]')].find((li) => {
            const dot = li.querySelector('span');
            return dot !== null && (dot.className.includes('bg-blue-600') || dot.className.includes('bg-red-600'));
          });
          const no = cur?.getAttribute('data-smartbom-step') ?? '';
          return no === '' ? '(현재 단계 없음)' : `${no} ${(cur?.querySelectorAll('span')[1]?.textContent ?? '').trim()}`;
        });
        await shot(ap, `${tag}-admin-bom-case`);
        return s;
      } catch (e) {
        return `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
      }
    };

    for (const target of FORCE_TARGETS) {
      const r = await force(bomOd, target);
      const db = await odRow(bomOd);
      const cts = await ctStatuses(bomOd);
      const tag = `bom-od-${FORCE_TARGETS.indexOf(target) + 1}-${target.replace('/', '')}`;
      const adminV = await observeAdmin(bomOd, tag, false);
      const custV = await observeCustomer(bomOd, tag);
      const step = await caseStep(tag);
      rows.push({
        track: 'BOM', axis: 'od_status', action: `force-status → ${target}`,
        db: `${db.status} (ct: ${cts.join(',')})`, admin: { ...adminV, step }, customer: custV,
        note: r.status === 200 ? '' : `force-status ${String(r.status)} ${String(r.json?.error ?? '')}`,
      });
      log(`[BOM od] ${target}: db=${db.status} admin=${adminV.uiLabel} step=${step} | 고객 목록=${custV.listLabel}(${custV.listCls}) 상세=${fmtLines(custV)} 카드=${fmtProgress(custV)}`);
    }
    await revive(bomOd);
    {
      const r = await cancelLines(bomOd, bomCts, '취소');
      const db = await odRow(bomOd);
      const cts = await ctStatuses(bomOd);
      const tag = 'bom-od-cancel';
      const adminV = await observeAdmin(bomOd, tag, false);
      const custV = await observeCustomer(bomOd, tag);
      const step = await caseStep(tag);
      rows.push({
        track: 'BOM', axis: 'od_status', action: 'items/status 취소 (전량)',
        db: `${db.status} cancel=${String(db.cancel)} (ct: ${cts.join(',')})`, admin: { ...adminV, step }, customer: custV,
        note: r.status === 200 ? `orderCancelled=${String(r.json?.data?.orderCancelled)}` : `items/status ${String(r.status)} ${String(r.json?.error ?? '')}`,
      });
      log(`[BOM od] 취소: db=${db.status} admin=${adminV.uiLabel} step=${step} | 고객 목록=${custV.listLabel}(${custV.listCls}) 상세=${fmtLines(custV)}`);
      void titleOrder;
    }
  }, 900_000);
});
