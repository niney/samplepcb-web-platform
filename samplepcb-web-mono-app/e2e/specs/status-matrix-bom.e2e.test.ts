// 상태 매트릭스 실측 — **BOM 전 구간**(견적요청 → RFQ → 회신 → 주문 → 입금 → 발주 → 발송 → 입고 →
// 배송 → 완료)을 실흐름으로 밟으며 단계마다 관리자와 고객이 무엇을 보는지 표로 뽑는다.
//
// status-matrix(시드 직삽입)는 quote 상태와 od 상태를 **따로** 돌린 것이라 그 사이 — RFQ·발주·
// 선적·입고 — 가 비어 있었다. 이 편은 journey-bom-domestic 의 12단계를 그대로 밟되(전이는 API,
// 업로드만 UI — 엔진 분석을 서버가 그 경로로 시작한다) 어서션 대신 **관측**을 남긴다.
// 산출물: e2e/output/status-matrix-bom.md + status-matrix-bom/*.png. 끝나면 Case 강제 삭제로 정리.
//
// 실행: pnpm -F e2e e2e:status-matrix-bom  (PORTAL_E2E=1 — nginx·API·웹·PHP·BOM 엔진(8400)·협력1 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPartner,
  getPrisma,
  monoRoot,
  newPhpSession,
  newSession,
  num,
  outputDir,
  placeOrderFromBomQuote,
  requireCustomerCreds,
  resetSupplierSearchQuota,
  signJwt,
  snap,
  type E2eSession,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const FIXTURE_CSV = join(monoRoot, 'e2e', 'fixtures', 'bom-journey-1-diverse.csv');
const PARTNER_NAME = '협력1'; // KR·KRW·bom_rfq — 마스터는 읽기만
const RUN_TAG = String(Date.now()).slice(-6);
const QUOTE_TITLE = `SMB-${RUN_TAG} 전 구간 실측`;
const SHOT_DIR = 'status-matrix-bom';
const BOM_ORDER_TABS = ['all', 'awaiting_payment', 'paid', 'paid_unissued', 'to_ship', 'shipping', 'completed'] as const;
const BOM_LABEL_CANDIDATES = [
  '작성 중', '견적요청', '견적 요청', '견적요청 접수', '검토 중', '담당자 검토 중', '회신 완료', '답변 완료',
  '견적 회신 완료', '마감', '종료', '취소됨', '취소',
];

interface Row {
  step: string;
  action: string;
  db: string;
  admin: Record<string, string>;
  customer: Record<string, string>;
  note: string;
}

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r, ms));
};
const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!RUN)('상태 매트릭스 실측 — BOM 전 구간(견적요청→배송완료)', () => {
  const prisma = getPrisma();
  const rp = createJourneyReport('findings-status-matrix-bom', 'BOM 전 구간 상태 실측');
  const rows: Row[] = [];
  const notes: string[] = [];
  const ledger: string[] = [];

  let customer: PhpLoginResult;
  let admin: E2eSession;
  let partner: PartnerFixture;
  let mbId = '';
  let A = '';
  let P = '';
  let C = '';

  let quoteId: string | null = null;
  let rfqId: number | null = null;
  let poId: number | null = null;
  let shipmentId: number | null = null;
  let odId: string | null = null;
  let partnerReplyTotal = 0;

  const log = (s: string): void => {
    notes.push(s);
    console.log(`  ${s}`);
  };
  const shot = async (page: any, name: string): Promise<void> => {
    try {
      await snap(page, `${SHOT_DIR}/${name}`);
    } catch {
      /* 스크린샷 실패는 관측을 막지 않는다 */
    }
  };
  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  const errOf = (r: { status: number; json: any }): string =>
    r.status === 200 ? '' : `HTTP${String(r.status)} ${String(r.json?.error ?? r.json?.message ?? '')}`;

  // ── DB 스냅샷 ────────────────────────────────────────────────────────────────
  const dbSnapshot = async (): Promise<string> => {
    const parts: string[] = [];
    if (quoteId !== null) {
      const q = await prisma.spBomQuote.findUnique({ where: { id: BigInt(quoteId) }, select: { status: true, buildStatus: true, enrichStatus: true, confirmedTotal: true } });
      parts.push(`quote=${String(q?.status)}${q?.confirmedTotal === null || q?.confirmedTotal === undefined ? '' : `(확정 ${String(q.confirmedTotal)})`}`);
    }
    if (rfqId !== null) {
      const r = await prisma.spBomRfq.findUnique({ where: { id: BigInt(rfqId) }, select: { status: true } });
      parts.push(`rfq=${String(r?.status)}`);
    }
    if (poId !== null) {
      const p = await prisma.spBomPo.findUnique({ where: { id: BigInt(poId) }, select: { status: true } });
      parts.push(`po=${String(p?.status)}`);
    }
    if (shipmentId !== null) {
      const s = await prisma.spBomShipment.findUnique({ where: { id: BigInt(shipmentId) }, select: { status: true, receivedAt: true } });
      parts.push(`ship=${String(s?.status)}${s?.receivedAt === null || s?.receivedAt === undefined ? '' : '(입고)'}`);
    }
    if (odId !== null) {
      const o: any[] = await prisma.$queryRawUnsafe(`SELECT od_status, od_misu FROM g5_shop_order WHERE od_id = ?`, odId);
      parts.push(`od=${String(o[0]?.od_status)}(미수 ${String(o[0]?.od_misu)})`);
    }
    return parts.join(' · ');
  };

  // ── 관측 ────────────────────────────────────────────────────────────────────
  const observeAdmin = async (tag: string): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    if (quoteId === null) return out;
    const ap = admin.page;
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
        const no = cur?.getAttribute('data-smartbom-step') ?? '';
        const stepText = (cur?.querySelectorAll('span')[1]?.textContent ?? '').trim();
        // '다음 작업' 안내 — Case 화면이 관리자에게 무엇을 하라고 말하는지.
        const next = [...document.querySelectorAll('*')].map((el) => (el.textContent ?? '').trim()).find((t) => t.startsWith('다음 작업') && t.length < 60) ?? '';
        return { badge: (badge?.textContent ?? '').trim(), step: no === '' ? '(현재 단계 없음)' : `${no} ${stepText}`, next };
      }, BOM_LABEL_CANDIDATES);
      out['caseBadge'] = res.badge;
      out['timeline'] = res.step;
      out['next'] = res.next;
      await shot(ap, `${tag}-admin-case`);
    } catch (e) {
      out['caseBadge'] = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    if (odId !== null) {
      const found = await api(A, 'GET', `/api/admin/orders?tab=전체&qField=od_id&q=${odId}&page=1&pageSize=20`);
      const item = (found.json?.data?.items ?? []).find((i: any) => i.odId === odId);
      out['orderStatus'] = String(item?.status ?? '?');
      const tabs: string[] = [];
      for (const tab of BOM_ORDER_TABS) {
        const r = await api(A, 'GET', `/api/admin/bom-orders?tab=${tab}&page=1&pageSize=50`);
        if ((r.json?.data?.items ?? []).some((i: any) => i.odId === odId)) tabs.push(tab);
      }
      out['bomOrderTabs'] = tabs.join(',');
      try {
        await ap.goto(`${BASE_URL}/app/admin/smartbom/orders`, { waitUntil: 'domcontentloaded' });
        await ap.waitForLoadState('networkidle').catch(() => undefined);
        await shot(ap, `${tag}-admin-bom-orders`);
      } catch {
        /* 관측 실패는 진행을 막지 않는다 */
      }
    }
    return out;
  };

  const observeCustomer = async (tag: string): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    if (quoteId === null) return out;
    const page = customer.page;
    try {
      await page.goto(`${BASE_URL}/app/bom/history`, { waitUntil: 'domcontentloaded' });
      // 견적요청 전엔 제목이 파일명 기본값이라 제목으로 못 찾는다 — 상세 링크(/bom/:id)로 행을 잡는다.
      const row = page.locator('tr', { has: page.locator(`a[href$="/bom/${quoteId}"]`) }).first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      out['history'] = (await row.locator('span.rounded-full').first().innerText()).trim();
      // 주문 뒤 진행 칩(08-25 신설) — 없으면 빈 문자열.
      out['historyChip'] = ((await row.locator('[data-testid="bom-order-progress"]').first().textContent().catch(() => '')) ?? '').trim();
      await shot(page, `${tag}-customer-bom-history`);
    } catch (e) {
      out['history'] = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    try {
      await page.goto(`${BASE_URL}/app/bom/${quoteId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(800);
      const res = await page.evaluate((cands: string[]) => {
        const text = document.body.innerText;
        const badge = [...document.querySelectorAll('span')].find((s) => s.className.includes('bg-blue-50') && cands.includes((s.textContent ?? '').trim()));
        const btn = [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).find((t) => /주문하기/.test(t)) ?? '';
        // 조달·물류 낱말 — 고객 상세가 발주·선적·입고를 조금이라도 말하는가.
        const words = ['발주', '선적', '입고', '배송', '주문 완료', '결제', '취소', '조달'].filter((w) => text.includes(w));
        const chip = (document.querySelector('[data-testid="bom-order-progress"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return { badge: (badge?.textContent ?? '').trim(), btn, words: words.join('/'), chip };
      }, BOM_LABEL_CANDIDATES);
      out['detail'] = res.badge;
      out['detailBtn'] = res.btn;
      out['detailWords'] = res.words;
      out['detailChip'] = res.chip;
      await shot(page, `${tag}-customer-bom-detail`);
    } catch (e) {
      out['detail'] = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
    }
    if (odId !== null) {
      try {
        await page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'domcontentloaded' });
        const list = await page.evaluate((id: string) => {
          const tr = [...document.querySelectorAll('tr')].find((r) => (r.textContent ?? '').includes(id));
          const cell = tr?.querySelector('.sod_col_status') as HTMLElement | null;
          return (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
        }, odId);
        out['orderList'] = list;
        await shot(page, `${tag}-customer-order-list`);
        await page.goto(`${BASE_URL}/shop/orderinquiryview.php?od_id=${odId}`, { waitUntil: 'domcontentloaded' });
        const detail = await page.evaluate(() => {
          const table = document.querySelector('#sod_fin_list table');
          const lines = [...(table?.querySelector('tbody')?.rows ?? [])].map((tr) =>
            ((tr.querySelector('td[headers="th_itst"]') as HTMLElement | null)?.textContent ?? '').trim(),
          );
          const progress = [...document.querySelectorAll('#sp_progress_wrap:not(.is-quiet) .sp_eq_badge')].map((b) => (b.textContent ?? '').trim());
          const text = document.body.innerText;
          const delivery = /배송정보[\s\S]{0,120}/.exec(text)?.[0].replace(/\s+/g, ' ').slice(0, 90) ?? '';
          // 스텝퍼(08-25 신설) — 현재 칸 텍스트(취소면 취소 배지).
          const cur = document.querySelector('.sp-steps__item.is-current .sp-steps__dot')?.textContent?.trim()
            ?? document.querySelector('.sp-steps__cancel-badge')?.textContent?.trim() ?? '(스텝퍼 없음)';
          const total = document.querySelectorAll('.sp-steps__item').length;
          const done = document.querySelectorAll('.sp-steps__item.is-done').length;
          return { lines: lines.join(' / '), progress: progress.length === 0 ? '(카드 없음)' : progress.join(' / '), delivery, stepper: `${cur} (${String(done + 1)}/${String(total)})` };
        });
        out['orderLine'] = detail.lines;
        out['progressCard'] = detail.progress;
        out['deliveryInfo'] = detail.delivery;
        out['stepper'] = detail.stepper;
        await shot(page, `${tag}-customer-order-detail`);
      } catch (e) {
        out['orderList'] = `(화면 실패: ${e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e)})`;
      }
    }
    return out;
  };

  const record = async (step: string, action: string, note = ''): Promise<void> => {
    const tag = step.toLowerCase();
    const db = await dbSnapshot();
    const adminV = await observeAdmin(tag);
    const custV = await observeCustomer(tag);
    rows.push({ step, action, db, admin: adminV, customer: custV, note });
    log(`[${step}] ${action} | ${db} | 관리자 ${adminV['caseBadge'] ?? ''}/${adminV['timeline'] ?? ''} 큐=${adminV['bomOrderTabs'] ?? '-'} od=${adminV['orderStatus'] ?? '-'} | 고객 히스토리=${custV['history'] ?? ''}+${custV['historyChip'] ?? ''} 상세=${custV['detail'] ?? ''}+${custV['detailChip'] ?? ''}[${custV['detailBtn'] ?? ''}] 주문목록=${custV['orderList'] ?? '-'} 줄=${custV['orderLine'] ?? '-'} 스텝=${custV['stepper'] ?? '-'} ${note}`);
  };

  const writeReport = (): void => {
    const cols = ['단계', '조작', 'DB', '관리자 Case 배지', '관리자 타임라인', '관리자 다음 작업', '관리자 주문 배지', 'BOM 주문 큐 탭', '고객 히스토리', '히스토리 진행 칩', '고객 상세 라벨', '상세 진행 칩', '고객 상세 버튼', '고객 상세 조달·물류 낱말', '고객 주문목록 배지', '고객 주문상세 줄', '진행 카드', '스텝퍼 현재', '배송정보', '비고'];
    const md = [
      `# BOM 전 구간 상태 실측 (${new Date().toISOString()})`,
      '',
      `Case "${QUOTE_TITLE}" — 업로드부터 배송완료까지 실흐름(전이 API·업로드 UI). 스크린샷: e2e/output/${SHOT_DIR}/*.png`,
      '',
      `| ${cols.join(' | ')} |`,
      `| ${cols.map(() => '---').join(' | ')} |`,
      ...rows.map((r) => `| ${[
        r.step, r.action, r.db, r.admin['caseBadge'] ?? '', r.admin['timeline'] ?? '', r.admin['next'] ?? '', r.admin['orderStatus'] ?? '', r.admin['bomOrderTabs'] ?? '',
        r.customer['history'] ?? '', r.customer['historyChip'] ?? '', r.customer['detail'] ?? '', r.customer['detailChip'] ?? '', r.customer['detailBtn'] ?? '', r.customer['detailWords'] ?? '',
        r.customer['orderList'] ?? '', r.customer['orderLine'] ?? '', r.customer['progressCard'] ?? '', r.customer['stepper'] ?? '', r.customer['deliveryInfo'] ?? '', r.note,
      ].map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`),
      '',
      '## 메모',
      '',
      ...notes.map((n) => `- ${n}`),
      '',
      '## 생성물 대장',
      '',
      ...ledger.map((l) => `- ${l}`),
      '',
    ].join('\n');
    writeFileSync(join(outputDir, 'status-matrix-bom.md'), md, 'utf8');
    writeFileSync(join(outputDir, 'status-matrix-bom.json'), JSON.stringify({ rows, notes, ledger }, null, 2), 'utf8');
    console.log(`\n리포트: e2e/output/status-matrix-bom.md\n${md}`);
  };

  // ── 전후 처리 ────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    await mustReach(`${BOM_ENGINE_URL}/health`, 'samplepcb-parts-engine ./run.sh');
    const creds = requireCustomerCreds();
    mbId = creds.id;
    await resetSupplierSearchQuota(['e2e-admin', creds.id]);
    partner = await getPartner(PARTNER_NAME);
    if (partner.mbId === null) throw new Error(`${PARTNER_NAME} 연결 계정이 없습니다`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    P = signJwt({ mbId: partner.mbId, ttlSec: 3600 });
    C = signJwt({ mbId, ttlSec: 3600 });
    customer = await newPhpSession(creds);
    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    mkdirSync(join(outputDir, SHOT_DIR), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    // 정리 — 재고 앵커(배송·완료 진입 차감)는 '주문' 복귀로 복원한 뒤 Case 강제 삭제(주문·결제 포함).
    try {
      if (odId !== null) await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '주문' });
      if (quoteId !== null) {
        const preview = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/force-delete-preview`);
        const token = preview.json?.data?.previewToken;
        if (typeof token === 'string') {
          const del = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/force-delete`, {
            mode: 'reset', previewToken: token, acknowledgeIrreversible: true, forceDeletePaidOrder: true,
          });
          notes.push(del.status === 200 ? `정리 — Case #${quoteId} 강제 삭제(주문 ${String(odId)} 포함)` : `정리 실패 — force-delete ${errOf(del)} · 대장 수동 정리`);
        } else {
          notes.push(`정리 실패 — 삭제 프리뷰 ${errOf(preview)} · 대장 수동 정리`);
        }
      }
    } catch (e) {
      notes.push(`정리 실패: ${e instanceof Error ? e.message : String(e)} — 대장: ${ledger.join(' | ')}`);
    }
    writeReport();
    await closeBrowser();
    await disconnectPrisma();
  }, 120_000);

  // ── 단계 ────────────────────────────────────────────────────────────────────
  test('S01. 고객: BOM 업로드 → 분석·공급사 확인', async () => {
    const page = customer.page;
    await page.goto(`${BASE_URL}/app/bom`, { waitUntil: 'domcontentloaded' });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
    await fileInput.setInputFiles(FIXTURE_CSV);
    await page.waitForURL((url: URL) => /^\/app\/bom\/\d+$/.test(url.pathname), { timeout: 60_000 });
    const m = /^\/app\/bom\/(\d+)$/.exec(new URL(page.url()).pathname);
    if (m?.[1] === undefined) throw new Error(`업로드 뒤 quoteId 를 찾지 못했습니다: ${page.url()}`);
    quoteId = m[1];
    ledger.push(`sp_bom_quote #${quoteId} (${mbId}, ${QUOTE_TITLE})`);
    const deadline = Date.now() + 600_000;
    let last = '';
    for (;;) {
      const q = await prisma.spBomQuote.findUnique({ where: { id: BigInt(quoteId) }, select: { buildStatus: true, enrichStatus: true } });
      last = `${String(q?.buildStatus)}/${String(q?.enrichStatus)}`;
      if (q?.buildStatus === 'ready' && q.enrichStatus !== 'searching') break;
      if (Date.now() > deadline) throw new Error(`BOM 분석 대기 초과 — ${last}`);
      await delay(1_000);
    }
    await record('S01', '고객 업로드 → 분석 완료', `build/enrich=${last}`);
  }, 660_000);

  test('S02. 고객: 수량 조정 → 견적요청', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const patched = await api(C, 'PATCH', `/api/bom/quotes/${quoteId}`, { setQty: 3, spareQty: 1 });
    expect(patched.status, errOf(patched)).toBe(200);
    const req = await api(C, 'POST', `/api/bom/quotes/${quoteId}/request`, { title: QUOTE_TITLE });
    expect(req.status, errOf(req)).toBe(200);
    await record('S02', '고객 견적요청(POST /bom/quotes/:id/request)');
  }, 180_000);

  test('S03. 관리자: 검토 시작', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const r = await api(A, 'PATCH', `/api/admin/bom-quotes/${quoteId}`, { status: 'reviewing' });
    expect(r.status, errOf(r)).toBe(200);
    await record('S03', '관리자 검토 시작(status=reviewing)');
  }, 180_000);

  test('S04. 관리자: 협력사 RFQ 발송', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const sent = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfqs`, { partnerIds: [num(partner.id)] });
    expect(sent.status, errOf(sent)).toBe(200);
    const list = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    const row = (list.json?.data?.rfqs ?? []).find((e: any) => e.partnerId === num(partner.id));
    if (row === undefined) throw new Error('발송 응답에 협력사 RFQ 가 없습니다');
    rfqId = Number(row.rfqId);
    ledger.push(`sp_bom_rfq #${String(rfqId)}`);
    await record('S04', `RFQ 발송 → ${PARTNER_NAME}`);
  }, 180_000);

  test('S05. 협력사: 품목별 회신', async (ctx) => {
    if (rfqId === null) return ctx.skip();
    const detail = await api(P, 'GET', `/api/partner/rfqs/${String(rfqId)}`);
    expect(detail.status, errOf(detail)).toBe(200);
    const items: any[] = detail.json?.data?.items ?? [];
    partnerReplyTotal = 0;
    const reply = await api(P, 'PUT', `/api/partner/rfqs/${String(rfqId)}`, {
      items: items.map((item, index) => {
        const unitPrice = 90 + index * 15;
        partnerReplyTotal += unitPrice * Number(item.orderQty);
        return {
          quoteItemId: item.quoteItemId, unitPrice, replyQty: item.orderQty, moq: index % 3 === 0 ? 1 : null,
          stock: Number(item.orderQty) + 100 + index, dateCode: index % 2 === 0 ? '25+' : '24+',
          leadTime: index % 2 === 0 ? '재고 보유' : '5영업일', memo: `SMB-${RUN_TAG}`,
        };
      }),
      deliveryDate: futureDate(7),
      memo: `[SMB ${RUN_TAG}] 전 품목 회신`,
    });
    expect(reply.status, errOf(reply)).toBe(200);
    await record('S05', '협력사 회신(rfq quoted)');
  }, 180_000);

  test('S06. 관리자: 회신 선정 · 품목 검토 확인', async (ctx) => {
    if (quoteId === null || rfqId === null) return ctx.skip();
    const list = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}/rfqs`);
    const rfq = (list.json?.data?.rfqs ?? []).find((e: any) => Number(e.rfqId) === rfqId);
    for (const item of rfq?.items ?? []) {
      // 계약은 discriminated union(partner|supplier) — kind 가 없으면 400.
      const sel = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/rfq-selection`, { kind: 'partner', itemId: item.quoteItemId, rfqItemId: item.rfqItemId });
      expect(sel.status, `선정 ${String(item.quoteItemId)}: ${errOf(sel)}`).toBe(200);
    }
    const d = await api(A, 'GET', `/api/admin/bom-quotes/${quoteId}`);
    const pending: any[] = (d.json?.data?.items ?? []).filter((i: any) => i.adminReview?.required && !i.adminReview?.completed);
    if (pending.length > 0) {
      const rv = await api(A, 'PUT', `/api/admin/bom-quotes/${quoteId}/item-reviews`, {
        itemIds: pending.map((i) => i.id), completed: true, expectedQuoteUpdatedAt: d.json?.data?.updatedAt, reason: `[SMB ${RUN_TAG}] 확인`,
      });
      expect(rv.status, errOf(rv)).toBe(200);
    }
    await record('S06', `회신 선정 ${String((rfq?.items ?? []).length)}건 · 검토 확인 ${String(pending.length)}건`);
  }, 180_000);

  test('S07. 관리자: 회신 확정(answered)', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const confirmedTotal = Math.ceil((partnerReplyTotal * 1.15 + 15_000) / 1_000) * 1_000;
    const r = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/complete`, {
      answerNote: `[SMB ${RUN_TAG}] 확정`, confirmedShippingFee: 5_000, confirmedManagementFee: 10_000, confirmedTotal, sendEmail: false,
    });
    expect(r.status, errOf(r)).toBe(200);
    await record('S07', `회신 확정(POST /complete, 확정가 ${String(confirmedTotal)})`);
  }, 180_000);

  test('S08. 고객: 주문(영카트 무통장)', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const order = await placeOrderFromBomQuote(customer, rp, { quoteId, step: 'S08', prefix: 'smb-s08', buyerName: `SMB고객${RUN_TAG}` });
    odId = order.odId;
    ledger.push(`g5_shop_order ${odId}`);
    await record('S08', '고객 주문서 제출(무통장)');
  }, 240_000);

  test('S09. 관리자: 입금 확인', async (ctx) => {
    if (odId === null) return ctx.skip();
    const r = await api(A, 'PATCH', '/api/admin/orders/status', { target: '입금', odIds: [odId], sendMail: false, sendSms: false });
    expect(r.status, errOf(r)).toBe(200);
    await record('S09', '입금 확인(PATCH /admin/orders/status 입금)');
  }, 180_000);

  test('S10. 관리자: 발주', async (ctx) => {
    if (quoteId === null) return ctx.skip();
    const r = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos`, { partnerIds: [num(partner.id)], memo: `[SMB ${RUN_TAG}] 발주` });
    expect(r.status, errOf(r)).toBe(200);
    const po = (r.json?.data?.pos ?? []).find((e: any) => e.partnerId === num(partner.id));
    if (po === undefined) throw new Error('발주 응답에 협력사 발주서가 없습니다');
    poId = Number(po.poId);
    ledger.push(`sp_bom_po #${String(poId)}`);
    await record('S10', '발주(po issued)');
  }, 180_000);

  test('S11. 협력사: 발주 확인', async (ctx) => {
    if (poId === null) return ctx.skip();
    const r = await api(P, 'POST', `/api/partner/pos/${String(poId)}/confirm`);
    expect(r.status, errOf(r)).toBe(200);
    await record('S11', '협력사 발주 확인(po confirmed)');
  }, 180_000);

  test('S12. 협력사: 발송 생성 · 포장', async (ctx) => {
    if (poId === null) return ctx.skip();
    const created = await api(P, 'POST', '/api/partner/shipments', { poIds: [poId] });
    expect(created.status, errOf(created)).toBe(200);
    shipmentId = Number(created.json?.data?.shipmentId);
    ledger.push(`sp_bom_shipment #${String(shipmentId)}`);
    const draft = await api(P, 'GET', `/api/partner/shipments/${String(shipmentId)}/packing-list`);
    expect(draft.status, errOf(draft)).toBe(200);
    const items: any[] = draft.json?.data?.items ?? [];
    const saved = await api(P, 'PUT', `/api/partner/shipments/${String(shipmentId)}/packing-list`, {
      items: items.map((it, index) => ({ poItemId: it.poItemId, packages: [{ packageId: null, quantity: it.expectedQty, lotNo: `LOT-${RUN_TAG}-${String(index + 1).padStart(2, '0')}`, dateCode: '25+' }] })),
    });
    expect(saved.status, errOf(saved)).toBe(200);
    const printed = await api(P, 'POST', `/api/partner/shipments/${String(shipmentId)}/packing-list/print`);
    expect(printed.status, errOf(printed)).toBe(200);
    await record('S12', '발송 생성 · 포장(shipment preparing)');
  }, 180_000);

  test('S13. 협력사: 국내 택배 발송', async (ctx) => {
    if (poId === null) return ctx.skip();
    const r = await api(P, 'POST', `/api/partner/pos/${String(poId)}/shipment/advance`, { carrier: 'CJ대한통운', trackingNumber: `SMB-${RUN_TAG}`, trackingUrl: null });
    expect(r.status, errOf(r)).toBe(200);
    await record('S13', '택배 발송(shipment shipping)');
  }, 180_000);

  test('S14. 관리자: 입고 확인', async (ctx) => {
    if (quoteId === null || poId === null) return ctx.skip();
    const r = await api(A, 'POST', `/api/admin/bom-quotes/${quoteId}/pos/${String(poId)}/shipment/receive`, { note: `[SMB ${RUN_TAG}] 이상 없음` });
    expect(r.status, errOf(r)).toBe(200);
    await record('S14', '입고 확인(shipment delivered)');
  }, 180_000);

  test('S15. 관리자: 고객 배송 처리', async (ctx) => {
    if (odId === null) return ctx.skip();
    const r = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, {
      target: '배송', delivery: { method: 'parcel', deliveryCompany: '우체국택배', invoiceNo: `SMB-${RUN_TAG}`, invoiceTime: new Date().toISOString().slice(0, 16) },
    });
    expect(r.status, errOf(r)).toBe(200);
    await record('S15', '고객 배송 처리(force-status 배송+운송장)');
  }, 180_000);

  test('S16. 관리자: 완료', async (ctx) => {
    if (odId === null) return ctx.skip();
    const r = await api(A, 'PATCH', `/api/admin/orders/${odId}/force-status`, { target: '완료' });
    expect(r.status, errOf(r)).toBe(200);
    await record('S16', '완료(force-status 완료)');
  }, 180_000);
});
