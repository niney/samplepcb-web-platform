// 개발의뢰 고객 화면 여정 — 첫 의뢰부터 완료·A/S 까지 **고객 화면**을 실제로 눌러 몰고, 관리자 쪽은 관리자 API 로 낸다
// (admin-develop-journey 의 거울상 — 그쪽은 관리자 화면·고객 API). 피그마 랜딩·내 의뢰·의뢰 상세(탭형) 재구현의 고객 행동 검증.
//
//   1. 랜딩 분야 카드(PCB 설계) → 위저드(미리 선택 + 앱 및 서버 → 앱만) → 접수 → 내 의뢰 '접수됨'
//   2. 관리자: 검토 시작 · 검토서(일정 8단계·전문가 검토·담당자 의견) 공개 · 구성도(도면 2장 HTML) 공개 → 검토서 탭
//      (출력물과 같은 장으로 넘겨 본다 — 2026-11-13, docs/DEVELOP_FLOW.md §7.2.11)
//   2-1. 확인이 필요한 사항에 고객이 직접 답한다(§7.2.13) → 답변 칸 '고객 답변' · 진행 기록 · 담당자가 문구를 고쳐도 답이 따라가고
//      확인 결과가 적히면 잠긴다
//   3. 관리자: 견적 v1 발송 → 내 의뢰 '견적 확인' 칩·'견적서 확인' 버튼 → 견적 탭 → 견적 수정 요청 → 관리자 v2 → 동의·성함 → 수락
//      (견적서 탭도 장으로 넘겨 본다 — 요약 → 산출 내역, 수락 · 결제는 장 아래 판. 2026-11-13, docs/DEVELOP_FLOW.md §7.2.12)
//   4. 착수금 결제 버튼 → 쇼핑몰 주문서로 이동 → 관리자 수동 입금 확인 → 개발 진행 중
//   5. 관리자: 착수 확인서 발송 → 진행 현황 탭 배너 '확인하러 가기' → 회신(승인) → 배너 해소
//   6. 관리자: 중간 확인 요청 → 진행·문의 탭 '확인 · 승인'
//   7. 문의(파일 첨부) → 관리자 답변 → 진행 사항에 보인다
//   8. 관리자: 최종 납품(잠금) → 🔒 → 검수 확정 → 완료 → 잔금 결제 버튼 → 주문서 → 수동 입금 확인 → 다운로드 열림
//   9. 완료 뒤 A/S 요청 → 진행 사항 'A/S 요청'
//  10. 내 의뢰 '완료' · 390px 가로 넘침 0 · 고객 알림 메일(Mailpit) · pageErrors 0
//  11. '출력하기' 출력물(16:9 장 판) — 완료 뒤 '개발 진행 보고서'(장 순서 · 구성도 도면 2장 · 도면 앞뒤 글 없음 · 조작 UI 0 ·
//      넘친 장 0 · 장 수 = PDF 쪽 수 · 용지 13.33×7.5in). 접수 직후 판('제품 개발 제안서', 내용 없는 장 생략)은 1-1 에서 본다.
//
// 데이터는 **지우지 않는다**(사용자 요청 2026-10-22 — 화면으로 다시 볼 수 있게). 실행마다 제목에 시각을 붙여 새 의뢰를 만든다.
// 의뢰인 = cf_admin(로컬에서 평소 로그인으로 내 의뢰에 바로 보인다). DEVELOP_JOURNEY_MB 로 다른 계정을 지정할 수 있다.
// 결제는 실제 PG 대신 관리자 '수동 입금 확인'(mark-paid) — 주문(g5_shop_order)을 만들지 않는다. 결제 버튼이 장바구니에
// 넣은 행(체크아웃 산물, 합성 버킷)만 지운다. AI 유스케이스(develop.*)는 실행 중 끄고 끝나면 되돌린다(실 LLM 호출 0).
// 실행: PORTAL_E2E=1 pnpm -F e2e e2e develop-customer-journey
// 사전 조건: sp-node(3333)·nginx(local-web)·sp-develop(5177)·Mailpit. 관리자 화면(sp-vue)은 필요 없다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { API_URL, RUN, closeBrowser, disconnectPrisma, getPrisma, mailpitMessage, mailpitSearch, newSession, signJwt, snap, xlsxText } from '../helpers';
import type { E2eSession } from '../helpers';
import { developAdminIdentity } from '../helpers/develop-admin';
import { outputDir } from '../helpers/env';

const LONG = 180_000;
const CART_BUCKET = '7777000003'; // 다른 하네스(…001 마켓·…002 개발 API)와 다른 합성 장바구니 버킷
const JOURNEY_EMAIL = 'e2e-develop-journey@example.com';
const USECASES = ['develop.dev-review', 'develop.dev-diagram', 'develop.followup', 'develop.area-followup', 'develop.doc-mail'];
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' '); // 초까지 — 같은 분에 두 번 돌려도 제목이 겹치지 않게
const TITLE = `[e2e 여정] BLE 온습도 로거 ${stamp}`;

// ── API 호출(관리자·고객 토큰) ─────────────────────────────────────────────────
interface Res {
  status: number;
  json: any;
}
async function call(method: string, path: string, token: string, init: { body?: unknown; form?: FormData } = {}): Promise<Res> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: BodyInit | undefined;
  if (init.form !== undefined) payload = init.form;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(init.body);
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, ...(payload === undefined ? {} : { body: payload }) });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 비 JSON */
  }
  return { status: res.status, json };
}
const eventForm = (payload: unknown, files: { name: string; body: string }[] = []): FormData => {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const f of files) form.append('file', new Blob([f.body], { type: 'text/plain' }), f.name);
  return form;
};

// ── 픽스처 ────────────────────────────────────────────────────────────────────
const PHASES: [string, number, number, string, string, string][] = [
  ['요구사항 분석·실측', 1, 2, '실측 결과·회로 구성안', 'Reference 실물 1대', ''],
  ['회로설계', 2, 4, '회로도·부품 목록(BOM)', '', ''],
  ['PCB 아트웍', 2, 4, '기판 도면·거버', '', ''],
  ['펌웨어 개발', 3, 6, '제어 FW(BLE·센서)', '앱 BLE 규약 합의', '기판 제작과 병행 가능'],
  ['PCB 제작·SMT', 2, 4, '1차 PCBA', '', '외부 리드타임'],
  ['Bring-up·디버깅', 2, 3, '기능시험 결과', '', ''],
  ['보드 Revision 1회', 2, 4, '2차 PCBA', '', '재제작 리드타임'],
  ['앱 연동·통합 검증', 2, 3, '앱 연동 시험 결과', '', ''],
];
const MIN_SUM = PHASES.reduce((s, p) => s + p[1], 0);
const MAX_SUM = PHASES.reduce((s, p) => s + p[2], 0);
const REVIEW = {
  version: 4,
  brief: { serviceAreas: ['pcb', 'app'], answers: [{ code: 'pcb.type', choices: ['new'] }] },
  summary: '[e2e 여정] BLE 온습도 로거의 신규 PCB 와 모바일 앱 연동 개발 의뢰',
  requirements: [
    { text: '배터리 구동 · 저전력 BLE 광고 1초 주기', evidence: 'e2e' },
    { text: '온습도 센서 1채널 · 10분 주기 기록', evidence: 'e2e' },
    { text: '스마트폰 앱에서 기록 조회·내보내기', evidence: 'e2e' },
    { text: '양산 전 기능시제품 3대', evidence: 'e2e' },
  ],
  areas: [
    { area: 'pcb', summary: '신규 2층 보드', spec: [{ item: '기판 크기', text: '40×30mm 이내', evidence: 'e2e' }, { item: '전원', text: 'CR2032 · LDO 3.0V', evidence: 'e2e' }, { item: '안테나', text: '칩 안테나', evidence: 'e2e' }], observations: [] },
    { area: 'app', summary: 'Android·iOS 앱', spec: [{ item: '플랫폼', text: 'Android·iOS', evidence: 'e2e' }, { item: '연결', text: 'BLE GATT 직접 연결', evidence: 'e2e' }], observations: [] },
  ],
  openQuestions: [
    { question: '외장 케이스는 정해졌나요?', why: '안테나 배치와 기판 외형이 달라집니다.', area: 'pcb', resolution: '상담 결과: 3D 프린팅 외장으로 진행' },
    { question: '기록 내보내기 형식은 CSV 면 되나요?', why: '앱 화면 범위가 달라집니다.', area: 'app' },
  ],
  checks: [],
  meta: { jobId: 'e2e', model: 'e2e-model-hidden', promptVersion: 'dev-review.v5', inputHash: 'e2e', generatedAt: '2026-10-22T01:00:00.000Z', attachmentFiles: [] },
  adminComment: '담당자 의견: 배터리 수명 목표(1년)를 먼저 정하면 회로가 단순해집니다.',
  schedule: {
    phases: PHASES.map(([name, minWeeks, maxWeeks, output, prerequisite, note]) => ({ name, minWeeks, maxWeeks, output, prerequisite, note })),
    wishCode: 'm2_3',
    assumptions: '고객 자료 회신 3일 이내 기준',
  },
};
const svg = (title: string, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1900 1200"><rect width="1900" height="1200" fill="#fff"/><text x="950" y="80" font-size="44" text-anchor="middle">${title}</text><rect x="760" y="420" width="380" height="360" rx="16" fill="none" stroke="${color}" stroke-width="6"/><text x="950" y="610" font-size="40" text-anchor="middle">MCU (TBD)</text></svg>`;
const DIAGRAM_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>시스템 토폴로지 및 하드웨어 기능 블록도</h1>
<h2>요구사항 확인 요약</h2><ul><li>의뢰: BLE 온습도 로거의 신규 PCB 와 앱 연동.</li><li>통신: BLE 만 확인 — 서버는 TBD.</li></ul>
${svg('① 시스템 토폴로지', '#2945e8')}<p>① 시스템 토폴로지 — 장치와 앱 사이 BLE 만 선으로 표시.</p>
${svg('② 하드웨어 블록도', '#e85d29')}<p>② 하드웨어 블록도 — MCU 중심, 센서 입력 왼쪽.</p>
<h2>확정된 구성</h2><ul><li>신규 2층 보드 · CR2032 전원.</li></ul>
<h2>미확정 항목</h2><ul><li>MCU 부품명 — TBD</li></ul>
</body></html>`;
const quoteBody = (kind: 'initial' | 'revision', title: string): any => ({
  kind,
  title,
  vatMode: 'separate',
  durationDays: 60,
  scheduleNote: '착수 후 8주',
  deliverables: ['회로도', '거버', '펌웨어 소스', '앱 소스'],
  exclusions: 'PCB 제작비·부품비 별도',
  terms: '표준 조건 e2e',
  warrantyDays: 180,
  reviewDays: 7,
  validUntil: '2099-12-31',
  note: null,
  internalNote: '내부 메모',
  items: [
    { title: 'H/W 회로·PCB 설계', description: null, amount: 3_600_000, durationDays: 30 },
    { title: '펌웨어·앱 연동', description: null, amount: 3_200_000, durationDays: 30 },
  ],
  milestones: [
    { title: '착수금', ratioBp: 5000, trigger: 'on_accept', unlocksDeliverables: false },
    { title: '잔금', ratioBp: 5000, trigger: 'on_delivery', unlocksDeliverables: true },
  ],
});

describe.skipIf(!RUN)('개발의뢰 고객 화면 여정', () => {
  let s: E2eSession;
  let adminToken = '';
  let customerToken = '';
  let rid = 0;
  const usecaseBefore: Record<string, boolean> = {};

  const admin = {
    get: (p: string) => call('GET', p, adminToken),
    post: (p: string, body: unknown = {}) => call('POST', p, adminToken, { body }),
    put: (p: string, body: unknown) => call('PUT', p, adminToken, { body }),
    patch: (p: string, body: unknown) => call('PATCH', p, adminToken, { body }),
    form: (p: string, form: FormData) => call('POST', p, adminToken, { form }),
  };
  const ok = (r: Res, label: string): any => {
    expect(r.status, `${label}: ${JSON.stringify(r.json)}`).toBe(200);
    return r.json?.data;
  };
  const customerDetail = async (): Promise<any> => (await call('GET', `/api/develop/requests/${String(rid)}`, customerToken)).json?.data;
  const openTab = async (hash: string, heading: string): Promise<void> => {
    await s.page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}${hash}`);
    await s.page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 });
  };
  // 출력물(16:9 장 판) — 장 종류 · 표지의 문서 이름 · 실린 표 · 조작 UI 수 · 넘친 장 수를 읽는다(이미지는 디코드까지 기다린다).
  // 장은 높이를 잰 뒤에 그려지므로 첫 장이 뜰 때까지 기다린다.
  interface PrintInfo {
    doc: string;
    kinds: string[];
    tables: string[];
    buttons: number;
    iframes: number;
    figures: number[];
    overflow: number;
    sizes: string[];
    text: string;
  }
  const openPrint = async (): Promise<PrintInfo> => {
    await s.page.goto(`/develop/requests/${String(rid)}/print?_t=${String(Date.now())}`);
    await s.page.locator('.develop-deck .deck-slide').first().waitFor({ timeout: 20_000 });
    return s.page.evaluate(async () => {
      await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
      const root = document.querySelector('.develop-deck');
      const slides = [...(root?.querySelectorAll<HTMLElement>('.deck-slide') ?? [])];
      return {
        doc: root?.querySelector('[data-deck="doc-name"]')?.textContent?.trim() ?? '',
        kinds: slides.map((el) => el.getAttribute('data-deck-kind') ?? ''),
        tables: [...(root?.querySelectorAll('[data-deck-table]') ?? [])].map((el) => el.getAttribute('data-deck-table') ?? ''),
        buttons: root?.querySelectorAll('button, a, input, textarea, select, details').length ?? -1,
        iframes: root?.querySelectorAll('iframe').length ?? -1,
        figures: [...(root?.querySelectorAll('img[data-deck="diagram"]') ?? [])].map((i) => (i as HTMLImageElement).naturalWidth),
        overflow: root?.querySelectorAll('[data-deck-overflow]').length ?? -1,
        sizes: [...new Set(slides.map((el) => `${String(el.offsetWidth)}x${String(el.offsetHeight)}`))],
        text: root?.textContent ?? '',
      };
    });
  };
  // 장 종류의 차례 — 같은 종류가 이어지면 하나로, 내용 양에 따라 생기는 장(세부 답변 · 첨부 · 문서가 제 장을 가질 때)은 뺀다.
  const OPTIONAL_KINDS = ['brief', 'files', 'docs', 'text', 'qa'];
  const kindOrder = (kinds: readonly string[]): string[] =>
    kinds.filter((k) => !OPTIONAL_KINDS.includes(k)).filter((k, i, all) => i === 0 || all[i - 1] !== k);
  // 마일스톤 결제 — 화면의 결제 버튼이 주문서로 보내는지까지 보고, 완료는 관리자 수동 입금 확인. 체크아웃이 넣은 장바구니 행만 지운다.
  const payMilestone = async (title: string): Promise<void> => {
    await openTab('#quotes', '3. 견적서');
    await s.page.getByRole('button', { name: /원 결제$/ }).first().click();
    await s.page.waitForURL(/\/shop\/orderform\.php|\/bbs\/login\.php/, { timeout: 20_000 });
    const prisma = getPrisma();
    const ms = await prisma.spDevelopMilestone.findFirst({ where: { requestId: BigInt(rid), title, status: 'pending' } });
    expect(ms, `${title} 결제 대기 마일스톤`).not.toBeNull();
    ok(await admin.post(`/api/admin/develop/milestones/${String(ms.id)}/mark-paid`, { note: '[e2e 여정] 수동 입금 확인' }), `${title} 수동 입금 확인`);
    await prisma.$executeRawUnsafe('DELETE FROM g5_shop_cart WHERE io_id = ?', ms.paymentKey);
    await prisma.$executeRawUnsafe('DELETE FROM g5_shop_item_option WHERE io_id = ?', ms.paymentKey);
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null || health.status >= 500) throw new Error('API 서버를 켜세요: pnpm dev:api (127.0.0.1:3333)');
    const adminId = await developAdminIdentity();
    adminToken = signJwt(adminId);
    const mbId = process.env.DEVELOP_JOURNEY_MB ?? adminId.mbId;
    const customer = { mbId, mbNick: '여정고객', isAdmin: mbId === adminId.mbId, cartId: CART_BUCKET };
    customerToken = signJwt(customer);
    // 실 LLM 차단 — develop.* 유스케이스를 끄고 끝나면 되돌린다.
    const prisma = getPrisma();
    for (const useCase of USECASES) {
      const row = await prisma.spAiUsecase.findUnique({ where: { useCase } });
      if (row === null) continue;
      usecaseBefore[useCase] = row.enabled;
      await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled: false } });
    }
    s = await newSession(customer);
  }, LONG);

  afterAll(async () => {
    const prisma = getPrisma();
    for (const [useCase, enabled] of Object.entries(usecaseBefore)) {
      await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled } });
    }
    await s?.close();
    await disconnectPrisma();
    await closeBrowser();
    // 의뢰·문서·첨부는 남긴다(사용자 요청). 어느 의뢰인지 남겨 둔다.
    console.log(`[develop-customer-journey] 남긴 의뢰 #${String(rid)} — ${TITLE}`);
  });

  test('1. 랜딩 분야 카드 → 위저드 → 접수 → 내 의뢰 접수됨', async () => {
    const page = s.page;
    await page.goto('/develop/');
    await page.getByRole('link', { name: /PCB 설계/ }).first().click();
    await page.getByText('어떤 개발이 필요하신가요?').waitFor();
    expect(await page.getByRole('button', { name: /^PCB 설계/ }).getAttribute('aria-pressed')).toBe('true');
    // 2026-10-30 메뉴 6장 — '앱 및 서버 개발' 카드(앱·서버 두 분야) + 3스텝 첫 문항에서 '앱만'으로 줄인다.
    await page.getByRole('button', { name: /^앱 및 서버 개발/ }).click();
    await page.getByRole('button', { name: /^NEXT/ }).click();

    await page.getByPlaceholder('의뢰 제목을 입력하세요.').fill(TITLE);
    await page.getByPlaceholder(/여러 센서의 값을 수집하고/).fill('[e2e 여정] 배터리로 1년 동작하는 BLE 온습도 로거. 스마트폰 앱에서 기록을 조회하고 내보냅니다.');
    await page.getByRole('button', { name: '아이디어', exact: true }).click();
    await page.getByRole('button', { name: '시제품 완성', exact: true }).click();
    await page.getByLabel('희망 기간', { exact: true }).fill('계약 후 3개월');
    await page.locator('select').first().selectOption({ label: '1천만~3천만원' });
    await page.getByText('입력한 내용과 자료를 견적 검토와 AI 사전 검토 목적으로 사용하는 것에 동의합니다.').click();
    await page.getByRole('button', { name: /^NEXT/ }).click();

    await page.getByText('개별 개발 전문 질문').waitFor();
    await page.getByRole('button', { name: '신규 설계', exact: true }).click();
    // PCB 회로도·BOM 은 필수(2026-11-02) — 다른 분야와 같이 고르면 3스텝에서 첨부 칸 없이 묻는다.
    await page.getByRole('button', { name: '회로도 원본 파일', exact: true }).click();
    await page.getByRole('button', { name: '일부만 있음', exact: true }).click();
    await page.getByRole('button', { name: 'KiCad', exact: true }).click();
    await page.getByRole('button', { name: '앱만', exact: true }).click();
    await page.getByRole('button', { name: /^NEXT/ }).click();
    await page.getByText('제작 없음', { exact: true }).click();
    await page.getByRole('button', { name: /^NEXT/ }).click();

    await page.getByPlaceholder('홍길동').fill('여정고객');
    await page.getByPlaceholder('010-0000-0000').fill('010-2345-6789');
    await page.getByPlaceholder('name@company.com').fill(JOURNEY_EMAIL);
    await page.getByRole('button', { name: /^DONE/ }).click();
    await page.getByText('개발의뢰가 접수되었습니다').waitFor({ timeout: 20_000 });

    const list = await call('GET', '/api/develop/my/requests?pageSize=50', customerToken);
    const hit = list.json?.data?.items?.find((i: any) => i.title === TITLE);
    expect(hit, '내 의뢰 목록에 방금 접수한 건').toBeTruthy();
    rid = hit.requestId;
    expect(hit.serviceAreas).toEqual(['pcb', 'app']);

    await page.goto('/develop/me');
    const row = page.locator('main li', { hasText: TITLE });
    await row.waitFor();
    expect(await row.getByText('접수됨', { exact: true }).count()).toBe(1);
    expect(await row.getByText('PCB + 앱', { exact: true }).count()).toBe(1);
  }, LONG);

  test('1-1. 접수 직후 출력물 — 제품 개발 제안서, 내용 없는 장은 만들지 않는다', async () => {
    await s.page.goto(`/develop/requests/${String(rid)}`);
    const link = s.page.getByRole('link', { name: '출력하기' });
    await link.waitFor();
    expect(await link.getAttribute('href')).toBe(`/develop/requests/${String(rid)}/print`);
    expect(await link.getAttribute('target')).toBe('_blank');
    const p = await openPrint();
    expect(p.doc).toBe('제품 개발 제안서');
    expect(kindOrder(p.kinds), '검토서 · 진행 현황 장은 아직 없다(견적서 · 진행 · 문의는 원래 싣지 않는다 — 2026-11-06)').toEqual(['cover', 'overview']);
    expect(p.tables, '의뢰 조건 표').toContain('overview');
    expect(p.text).toContain(TITLE);
    expect(p.buttons, '출력물에 누를 것이 없다').toBe(0);
    expect(p.overflow, '넘친 장 없음').toBe(0);
  }, LONG);

  test('2. 관리자 검토서·구성도 공개 → 검토서 탭(장 넘겨 보기 — 요약·도면 2장·분석·일정·확인 사항·모델명 숨김)', async () => {
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/status`, { to: 'reviewing' }), '검토 시작');
    ok(await admin.put(`/api/admin/develop/requests/${String(rid)}/review`, { review: REVIEW }), '검토서 작업본 저장');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/review/publish`), '검토서 공개');
    const form = new FormData();
    form.append('file', new Blob([DIAGRAM_HTML], { type: 'text/html' }), 'diagram.html');
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/diagram/upload`, form), '구성도 업로드');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/diagram/publish`), '구성도 공개');

    const page = s.page;
    await openTab('#review', '2. AI 사전 검토서');
    // 읽는 탭은 출력물과 같은 장으로, 한 번에 하나씩 넘겨 본다: 요약 → 구성도 2 → 개발 분석 → 일정 → 확인 사항(여섯 장)
    const stage = page.locator('[data-deck-stage]');
    const slideTitle = (): Promise<string> => stage.locator('.deck-slide h2').innerText();
    const next = async (): Promise<void> => {
      await stage.locator('[data-deck="next"]').click();
    };
    await stage.getByText(REVIEW.summary).waitFor();
    expect(await slideTitle()).toBe('AI 사전 검토 요약');
    for (const r of REVIEW.requirements) expect(await stage.getByText(r.text, { exact: true }).count()).toBe(1);
    expect(await stage.getByText(REVIEW.adminComment).count(), '담당자 의견은 요약 장의 옅은 판에').toBe(1);
    expect(await page.getByText('e2e-model-hidden').count(), '모델명은 고객에게 안 보인다').toBe(0);
    // 구성도 — 도면 한 장에 한 장. 글(요약·정리)은 버튼으로 여는 옆 판 안, 기본 닫힘(2026-11-05 기본 접힘 그대로)
    await next();
    await stage.getByText('1 / 2').waitFor();
    expect(await slideTitle()).toBe('시스템 구성도');
    expect(await stage.getByText('① 시스템 토폴로지 — 장치와 앱 사이 BLE 만 선으로 표시.').count()).toBe(1);
    expect(await page.getByText('요구사항 확인 요약').count(), '글은 기본 닫힘').toBe(0);
    expect(await page.getByText('확정된 구성').count()).toBe(0);
    const notesToggle = stage.getByRole('button', { name: /구성도 설명 보기/ });
    expect(await notesToggle.getAttribute('aria-expanded')).toBe('false');
    await notesToggle.click();
    const notes = page.locator('[data-deck-overlay="notes"]');
    await notes.getByText('요구사항 확인 요약').waitFor();
    expect(await notes.getByText('의뢰: BLE 온습도 로거의 신규 PCB 와 앱 연동.').count()).toBe(1);
    expect(await notes.getByText('확정된 구성').count()).toBe(1);
    expect(await notes.getByText('미확정 항목').count()).toBe(1);
    await notes.getByRole('button', { name: /닫기/ }).click();
    expect(await page.getByText('확정된 구성').count(), '다시 닫힘').toBe(0);
    await next();
    await stage.getByText('2 / 2').waitFor();
    expect(await stage.getByText('② 하드웨어 블록도 — MCU 중심, 센서 입력 왼쪽.').count()).toBe(1);
    // 개발 분석 — 분야 명세
    await next();
    await stage.getByText('개발 분석: PCB 설계 · 앱 개발').waitFor();
    expect(await stage.getByText('CR2032 · LDO 3.0V', { exact: true }).count()).toBe(1);
    // 일정 — 단계 표 · 합계
    await next();
    await stage.getByText(`${String(MIN_SUM)}~${String(MAX_SUM)}주`).waitFor();
    expect(await slideTitle()).toBe('예상 개발 일정');
    for (const p of PHASES) expect(await stage.getByText(p[0], { exact: true }).count(), p[0]).toBe(1);
    // 희망 완료 시점 — 검토서 wishCode(마켓 코드)가 아니라 의뢰의 희망 시기(자유문)를 보인다('미응답' 회귀 방지)
    expect(await stage.getByText('계약 후 3개월', { exact: true }).count()).toBeGreaterThan(0);
    expect(await stage.getByText('미응답', { exact: true }).count()).toBe(0);
    // 확인이 필요한 사항 — 담당자 확인 결과가 답변 칸에. 마지막 장의 다음은 다음 탭
    await next();
    await stage.getByText('상담 결과: 3D 프린팅 외장으로 진행').waitFor();
    expect(Number(await stage.getAttribute('data-deck-page')), '여섯 장').toBe(6);
    expect(await stage.locator('[data-deck="next"]').innerText()).toContain('견적서');
    expect(await stage.locator('[data-deck-overflow]').count(), '넘친 장 없음').toBe(0);

    await page.goto('/develop/me');
    const row = page.locator('main li', { hasText: TITLE });
    await row.waitFor();
    for (const chip of ['검토 중', '검토서', '구성도']) expect(await row.getByText(chip, { exact: true }).count(), chip).toBe(1);
  }, LONG);

  test('2-1. 확인 사항에 직접 답한다 → 답변 칸 · 진행 기록 · 담당자가 문구를 고쳐도 답이 따라가고 확인 결과 뒤엔 잠긴다', async () => {
    const page = s.page;
    const ANSWER = 'CSV 면 충분합니다. 엑셀로 열 수 있으면 됩니다.';
    const stage = page.locator('[data-deck-stage]');
    const toQuestions = async (): Promise<void> => {
      await openTab('#review', '2. AI 사전 검토서');
      await stage.locator('.deck-slide').waitFor();
      await stage.locator('footer button[aria-label$="번째 장"]').last().click(); // 마지막 장 = 확인이 필요한 사항
      await stage.locator('.deck-slide[data-deck-kind="questions"]').waitFor();
    };
    await toQuestions();
    // 확인 결과가 이미 적힌 문항은 잠겨 있다 — 단추는 빈 문항 하나에만
    const open = stage.locator('[data-deck="answer-open"]');
    expect(await open.count(), '답할 수 있는 문항').toBe(1);
    expect((await open.innerText()).trim()).toBe('답변하기');
    await open.click();
    const panel = page.locator('[data-deck-overlay="answers"]');
    await panel.waitFor();
    expect(await panel.locator('textarea').count(), '잠긴 문항에는 입력 칸이 없다').toBe(1);
    expect(await panel.getByText('상담 결과: 3D 프린팅 외장으로 진행').count()).toBe(1);
    const save = panel.getByRole('button', { name: '답변 저장' });
    expect(await save.isDisabled(), '쓴 것이 없으면 저장이 막힌다').toBe(true);
    await panel.locator('textarea').fill(ANSWER);
    await save.click();
    await panel.waitFor({ state: 'detached' });
    // 장의 답변 칸에 '고객 답변'으로, 단추는 '고치기'로
    const answerBox = stage.locator('[data-deck="answer"]');
    await answerBox.waitFor();
    expect(await answerBox.innerText()).toContain(ANSWER);
    expect(await answerBox.innerText()).toContain('고객 답변');
    expect((await stage.locator('[data-deck="answer-open"]').innerText()).trim()).toBe('고치기');
    expect(await stage.locator('[data-deck-overflow]').count(), '넘친 장 없음').toBe(0);

    // 서버 — 지금 답변 · 진행 기록 · 관리자 상세(편집기가 문항 옆에 보인다)
    const d = await customerDetail();
    expect(d.questionAnswers.map((a: any) => a.answer)).toEqual([ANSWER]);
    const answered = d.events.filter((e: any) => e.type === 'question_answered');
    expect(answered.map((e: any) => e.title)).toEqual(['확인 사항 1건에 답했습니다']);
    expect(answered[0].body).toBe(`Q. 기록 내보내기 형식은 CSV 면 되나요?\nA. ${ANSWER}`);
    const adminDetail = ok(await admin.get(`/api/admin/develop/requests/${String(rid)}`), '관리자 상세');
    expect(adminDetail.questionAnswers.map((a: any) => a.answer)).toEqual([ANSWER]);
    // 같은 답을 다시 보내면 기록이 늘지 않는다
    const qid = d.questionAnswers[0].qid;
    const same = await call('PUT', `/api/develop/requests/${String(rid)}/review/answers`, customerToken, { body: { answers: [{ qid, answer: ANSWER }] } });
    expect(same.status).toBe(200);
    expect((await customerDetail()).events.filter((e: any) => e.type === 'question_answered').length).toBe(1);
    // 없는 문항
    const unknown = await call('PUT', `/api/develop/requests/${String(rid)}/review/answers`, customerToken, { body: { answers: [{ qid: 'q-none', answer: 'x' }] } });
    expect(unknown.status).toBe(409);
    expect(unknown.json?.error).toBe('QUESTION_NOT_FOUND');

    // 담당자가 문구를 고치고 확인 결과를 적어 다시 공개 — 문항 번호가 남아 답이 따라가고, 확인 결과가 적힌 문항은 잠긴다
    const working = adminDetail.review.working;
    const row = working.openQuestions.find((q: any) => String(q.question).startsWith('기록 내보내기'));
    expect(row.id, '편집기가 받는 문항 번호 = 답이 붙은 번호').toBe(qid);
    row.question = '기록 내보내기 형식은 CSV 로 확정할까요?';
    row.resolution = '확인: CSV 로 진행합니다';
    ok(await admin.put(`/api/admin/develop/requests/${String(rid)}/review`, { review: working }), '검토서 다시 저장');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/review/publish`), '검토서 다시 공개');
    await toQuestions();
    await stage.getByText('기록 내보내기 형식은 CSV 로 확정할까요?').waitFor();
    expect(await stage.locator('[data-deck="answer"]').innerText(), '문구를 고쳐도 답이 남는다').toContain(ANSWER);
    expect(await stage.getByText('확인: CSV 로 진행합니다', { exact: true }).count()).toBe(1);
    expect(await stage.locator('[data-deck="answer-open"]').count(), '확인 결과가 적히면 답을 더 고칠 수 없다').toBe(0);
    const locked = await call('PUT', `/api/develop/requests/${String(rid)}/review/answers`, customerToken, { body: { answers: [{ qid, answer: '바꾸고 싶습니다' }] } });
    expect(locked.status).toBe(409);
    expect(locked.json?.error).toBe('QUESTION_RESOLVED');
    // 진행·문의에 기록
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('확인 사항 1건에 답했습니다', { exact: true }).waitFor();
    expect(await page.getByText('확인 사항 답변', { exact: true }).count(), '종류 칩').toBe(1);
  }, LONG);

  test('3. 견적 — 내 의뢰 버튼 → 견적 수정 요청 → 새 견적 → 동의·성함 → 수락', async () => {
    const q1 = ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/quotes`, quoteBody('initial', '1차 견적')), '견적 v1 초안');
    ok(await admin.post(`/api/admin/develop/quotes/${String(q1.quoteId)}/send`), '견적 v1 발송');

    const page = s.page;
    await page.goto(`/develop/me?_t=${String(Date.now())}`);
    const row = page.locator('main li', { hasText: TITLE });
    await row.waitFor();
    expect(await row.getByText('견적 확인', { exact: true }).count()).toBe(1);
    await row.getByRole('link', { name: '견적서 확인' }).click();
    await page.getByRole('heading', { name: '3. 견적서' }).waitFor();
    expect(new URL(page.url()).hash).toBe('#quotes');

    await page.getByRole('button', { name: '견적 수정 요청' }).click();
    await page.getByPlaceholder('수정하고 싶은 내용 (선택)').fill('앱은 Android 만 먼저 진행하고 싶습니다');
    // 쓰는 도중에 의뢰가 갱신돼도(창으로 돌아오면 다시 읽는다) 입력이 지워지지 않는다 — 장을 다시 재는 동안 장 아래 판을 걷지 않는다
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/events`, eventForm({ type: 'comment', body: '[e2e 여정] 견적 검토 중 안내' })), '갱신 유발');
    const refetched = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/develop/requests/${String(rid)}`);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await refetched;
    await expect.poll(async () => ((await customerDetail())?.events ?? []).some((e: any) => e.body === '[e2e 여정] 견적 검토 중 안내')).toBe(true);
    await page.waitForTimeout(300); // 다시 재고 그릴 틈
    expect(await page.getByPlaceholder('수정하고 싶은 내용 (선택)').inputValue(), '갱신 뒤에도 쓰던 글이 남는다').toBe('앱은 Android 만 먼저 진행하고 싶습니다');
    await page.getByRole('button', { name: '수정 요청 보내기' }).click();
    await page.getByText(/수정 요청함 · 앱은 Android 만 먼저/).waitFor();
    // 고객 어휘 — 상태 칩도 '거절'이 아니라 '수정 요청'
    expect(await page.getByText('거절', { exact: true }).count()).toBe(0);
    expect(await page.getByText('수정 요청', { exact: true }).count()).toBe(1);

    // v2 = 산출 내역 견적(§5.1) — 인건비 일일 노임비 × 참여 일수 + 직접비 + 가산율. 인건비 350,000 × 10일 + 직접비 1,300,000 × 3회 = 7,400,000
    // → 간접비 15% 1,110,000 → 제경비 5%(8,510,000 × 5% = 425,500) 425,000 → 이윤 10%(8,935,000 × 10% = 893,500) 893,000 → 공급가 9,828,000
    const q2 = ok(
      await admin.post(`/api/admin/develop/requests/${String(rid)}/quotes`, {
        ...quoteBody('revision', '2차 견적(Android 우선)'),
        indirectBp: 1500,
        overheadBp: 500,
        profitBp: 1000,
        recipientDept: '연구소',
        note: '함체는 사급 지원',
        items: [
          { category: 'labor', title: 'PM', grade: '특급', description: '시스템 설계', unitPrice: 350_000, qty: 10, unit: '일' },
          { category: 'direct', title: 'PCB 제작', description: '4층', unitPrice: 1_300_000, qty: 3, unit: '회' },
        ],
      }),
      '견적 v2 초안(산출 내역)',
    );
    ok(await admin.post(`/api/admin/develop/quotes/${String(q2.quoteId)}/send`), '견적 v2 발송');
    await openTab('#quotes', '3. 견적서');
    // 견적서 탭도 장으로 넘겨 본다 — 최신 견적이 첫 장: 요약(금액 · 결제 조건 · 견적 조건) → 산출 내역 → 앞 견적(v1)의 두 장
    const stage = page.locator('[data-deck-stage]');
    await stage.getByRole('heading', { name: '2차 견적(Android 우선)' }).waitFor();
    expect(await stage.locator('.deck-slide').getAttribute('data-deck-kind')).toBe('quote');
    expect(await stage.locator('[data-deck="quote-total"]').innerText()).toBe('10,810,800원');
    expect(await stage.getByText(/^수정 견적 v\d+ · 발송 · /).count(), '부제 — 종류 · 판 · 상태').toBe(1);
    for (const text of ['착수금', '잔금', '견적 수락 시', '함체는 사급 지원', 'PCB 제작비·부품비 별도']) {
      expect(await stage.getByText(text, { exact: true }).count(), `견적 요약 장: ${text}`).toBe(1);
    }
    // 답할 견적이면 요약 장에 안내와 장 아래 판으로 내려가는 단추가 있다
    expect(await stage.locator('[data-deck="quote-jump"]').innerText()).toContain('수락 · 수정 요청');
    // 산출 내역 — 항목(등급 · 담당업무) / 단가 × 수량 / 구분 소계 / 가산
    await stage.locator('[data-deck="next"]').click();
    await stage.getByRole('heading', { name: /^산출 내역: 수정 견적 v\d+$/ }).waitFor();
    for (const text of ['특급 · 시스템 설계', '350,000원 × 10일', '인건비 소계', '15% (인건비+직접비)']) {
      expect(await stage.getByText(text, { exact: true }).count(), `산출 내역 장: ${text}`).toBe(1);
    }
    // 앞 견적(수정 요청한 v1)은 그 뒤 — 모두 네 장, 넘친 장 없음. 장 아래 판은 지금 장의 견적을 따라간다(v1 은 수락 단추가 없다)
    await stage.locator('[data-deck="next"]').click();
    await stage.getByRole('heading', { name: '1차 견적' }).waitFor();
    expect(await stage.locator('footer').innerText()).toMatch(/3\s*\/\s*4/);
    expect(await stage.locator('[data-deck-overflow]').count(), '넘친 장 없음').toBe(0);
    expect(await page.locator('[data-quote-actions]').count(), '장 아래 판은 하나').toBe(1);
    expect(await page.locator('[data-quote-actions]').getByRole('button', { name: '견적 수락' }).count()).toBe(0);
    await stage.locator('[data-deck="prev"]').click();
    await stage.locator('[data-deck="prev"]').click();
    await stage.getByRole('heading', { name: '2차 견적(Android 우선)' }).waitFor();
    const v2card = page.locator('[data-quote-actions]', { hasText: '2차 견적(Android 우선)' });
    // 엑셀 — 장 아래 판의 단추(Authorization 이 필요한 blob 저장). 서버가 1쪽과 같은 표로 만든다.
    const downloading = page.waitForEvent('download');
    await v2card.getByRole('button', { name: '엑셀', exact: true }).click();
    const file = await downloading;
    expect(file.suggestedFilename(), '파일 이름').toBe(`2차 견적(Android 우선) 견적서 Q${String(rid)}-v${String(q2.version)}.xlsx`);
    const sheetText = xlsxText(readFileSync(await file.path()));
    for (const text of ['견적서', '인건비 소계', '15% (인건비+직접비)', '10일', '함체는 사급 지원', '박승한 상무', '연구소', '산출물 : 회로도 · 거버 · 펌웨어 소스 · 앱 소스', '별도 실비 : PCB 제작비·부품비 별도']) {
      expect(sheetText, `엑셀: ${text}`).toContain(text);
    }
    // 판의 「PDF」 = 인쇄용 보기를 ?download=pdf 로 연다(그려지자마자 한 번 내려받는다)
    expect(await v2card.getByRole('link', { name: 'PDF', exact: true }).getAttribute('href')).toContain(`/quotes/${String(q2.quoteId)}/print?download=pdf`);
    // 인쇄용 보기 — 1쪽 견적서(공용 시트) + 별지
    await page.goto(`/develop/requests/${String(rid)}/quotes/${String(q2.quoteId)}/print?_t=${String(Date.now())}`);
    const printSheet = page.getByTestId('develop-quote-sheet');
    await printSheet.waitFor();
    expect(await printSheet.getByTestId('develop-quote-no').textContent()).toBe(`Q${String(rid)}-v${String(q2.version)}`);
    expect(await printSheet.getByTestId('develop-quote-supply').textContent()).toBe('9,828,000');
    expect(await printSheet.getByTestId('develop-quote-total').textContent()).toBe('10,810,800');
    expect(await printSheet.getByText('3회', { exact: true }).count()).toBe(1);
    // 1쪽 Remark 에 산출물·별도 실비(별지에도 그대로 있다)
    expect(await printSheet.getByText('회로도 · 거버 · 펌웨어 소스 · 앱 소스', { exact: true }).count()).toBe(1);
    expect(await printSheet.getByText('PCB 제작비·부품비 별도', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('heading', { name: '견적서 별지' }).count()).toBe(1);
    expect(await page.getByRole('button', { name: '엑셀 내려받기' }).count()).toBe(1);
    await snap(page, 'develop-quote-print');
    // PDF 내려받기 — 화면의 1쪽 견적서 + 별지를 찍은 A4 PDF(2쪽 이상), 이름은 엑셀과 같은 규칙
    const pdfName = `2차 견적(Android 우선) 견적서 Q${String(rid)}-v${String(q2.version)}.pdf`;
    const pageCount = (buf: Buffer): number => buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
    const pdfDownloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF 내려받기', exact: true }).click();
    const pdfFile = await pdfDownloading;
    expect(pdfFile.suggestedFilename(), 'PDF 파일 이름').toBe(pdfName);
    const pdfBuf = readFileSync(await pdfFile.path());
    expect(pdfBuf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdfBuf), 'PDF 쪽 수(견적서 + 별지)').toBeGreaterThanOrEqual(2);
    await pdfFile.saveAs(join(outputDir, 'develop-quote.pdf')); // 눈으로 확인할 산출물(output 은 git 밖)
    // 브라우저 인쇄(A4 · @page 여백 = 화면 견적서 안쪽 여백, 인쇄에선 견적서 패딩을 푼다) — 견적서 1쪽 + 별지 1쪽
    const printPdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    writeFileSync(join(outputDir, 'develop-quote-print.pdf'), printPdf); // 눈으로 확인할 산출물
    expect(pageCount(printPdf), '인쇄 쪽 수(견적서 + 별지)').toBe(2);
    // ?download=pdf 로 열면 그려지자마자 받고, 주소에서 그 쿼리를 지운다
    const autoDownloading = page.waitForEvent('download');
    await page.goto(`/develop/requests/${String(rid)}/quotes/${String(q2.quoteId)}/print?download=pdf&_t=${String(Date.now())}`);
    const autoFile = await autoDownloading;
    expect(autoFile.suggestedFilename()).toBe(pdfName);
    await expect.poll(() => new URL(page.url()).searchParams.has('download')).toBe(false);
    await openTab('#quotes', '3. 견적서');
    await stage.getByRole('heading', { name: '2차 견적(Android 우선)' }).waitFor();
    const accept = page.getByRole('button', { name: '견적 수락' });
    // 요약 장의 단추 → 장 아래 수락 판이 창 안으로
    await stage.locator('[data-deck="quote-jump"]').click();
    await expect
      .poll(() => accept.evaluate((el) => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= window.innerHeight), { timeout: 10_000 })
      .toBe(true);
    expect(await accept.isDisabled(), '동의 전엔 수락이 막힌다').toBe(true);
    await page.getByText('위 조건에 동의합니다', { exact: true }).click();
    await page.getByPlaceholder('성함').fill('여정고객');
    await accept.click();
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('accepted');
    // '착수금 대기'는 스텝퍼 라벨에도 늘 있어 기다림이 못 된다 — 결제 버튼 자체를 기다린다.
    await page.getByRole('button', { name: /원 결제$/ }).first().waitFor({ timeout: 20_000 });
    expect(await page.getByRole('button', { name: /원 결제$/ }).count(), '착수금 결제 버튼').toBe(1);
    // 수락 뒤 요약 장의 안내는 결제로 바뀐다
    expect(await stage.locator('[data-deck="quote-jump"]').innerText()).toContain('결제하기');
  }, LONG);

  test('4. 착수금 결제 버튼 → 주문서 → 수동 입금 확인 → 개발 진행 중', async () => {
    await payMilestone('착수금');
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('in_progress');
    await openTab('#quotes', '3. 견적서');
    // 견적 요약 장의 결제 조건 표(장은 높이를 잰 뒤에 그려진다)
    await s.page.locator('[data-deck-stage]').getByText('결제 완료', { exact: true }).waitFor();
    expect(await s.page.getByText('결제 완료', { exact: true }).count()).toBe(1);
    expect(await s.page.getByText('개발 진행 중', { exact: true }).count()).toBeGreaterThan(0);
  }, LONG);

  test('5. 착수 확인서 → 진행 현황 배너 → 회신(승인) → 해소', async () => {
    const doc = ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/documents`, { type: 'kickoff' }), '착수 확인서 초안');
    ok(await admin.post(`/api/admin/develop/documents/${String(doc.documentId)}/send`, { mailSubject: '[샘플피씨비] 착수 확인 요청', mailBody: '착수 내용을 확인해 주세요.' }), '착수 확인서 발송');

    const page = s.page;
    await openTab('#documents', '4. 진행 현황 · 프로젝트 문서');
    await page.getByText('담당자가 확인을 요청한 문서 1건이 있습니다').waitFor();
    await page.getByRole('button', { name: '확인하러 가기' }).click();
    await page.getByText('승인합니다', { exact: true }).click();
    await page.getByPlaceholder('성함').fill('여정고객');
    await page.getByText('문서 내용을 확인했으며 위 결정을 담당자에게 전달합니다').click();
    await page.getByRole('button', { name: '회신 보내기' }).click();
    await expect.poll(async () => (await page.getByText('담당자가 확인을 요청한 문서').count()), { timeout: 20_000 }).toBe(0);
    const d = await customerDetail();
    expect(d.documents.find((x: any) => x.documentId === doc.documentId)?.status).toBe('approved');
  }, LONG);

  test('6. 중간 확인 요청 → 진행·문의 탭 확인 · 승인', async () => {
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/events`, eventForm({ type: 'review_request', title: '회로도 v1 확인 요청', body: '회로도 v1 을 확인해 주세요' }, [{ name: 'schematic-v1.txt', body: '[e2e 여정] 회로도' }])), '중간 확인 요청');

    const page = s.page;
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('담당자가 중간 결과 확인을 요청했습니다', { exact: false }).waitFor();
    await page.getByRole('button', { name: '확인 · 승인' }).click();
    await expect.poll(async () => ((await customerDetail())?.events ?? []).some((e: any) => e.type === 'review_approved'), { timeout: 20_000 }).toBe(true);
    await page.getByText('확인 승인', { exact: true }).first().waitFor();
  }, LONG);

  test('7. 문의(파일 첨부) → 관리자 답변 → 진행 사항', async () => {
    const page = s.page;
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByPlaceholder('궁금한 점이나 전달할 내용을 적어 주세요. 담당자에게 바로 전달됩니다.').fill('[e2e 여정] 케이스 도면을 첨부합니다');
    await page.locator('input[type="file"]').setInputFiles({ name: 'case-drawing.txt', mimeType: 'text/plain', buffer: Buffer.from('[e2e 여정] 케이스 도면') });
    await page.getByText('case-drawing.txt').waitFor();
    await page.getByRole('button', { name: '문의 제출' }).click();
    await page.getByText('[e2e 여정] 케이스 도면을 첨부합니다').waitFor({ timeout: 20_000 });
    expect(await page.getByText('case-drawing.txt').count()).toBeGreaterThan(0);

    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/events`, eventForm({ type: 'comment', body: '[e2e 여정] 도면 확인했습니다. 반영하겠습니다.' })), '관리자 답변');
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('[e2e 여정] 도면 확인했습니다. 반영하겠습니다.').waitFor();
  }, LONG);

  test('8. 최종 납품(잠금) → 검수 확정 → 완료 → 잔금 결제 → 다운로드 열림', async () => {
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/events`, eventForm({ type: 'deliverable', final: true, locked: true, body: '[e2e 여정] 최종 산출물' }, [{ name: 'gerber-final.txt', body: '[e2e 여정] 거버' }])), '최종 납품');
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('delivered');

    const page = s.page;
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('잔금 결제 후 내려받기').first().waitFor();
    // 잔금 조건이 '납품 시'라 이미 결제할 수 있다 — 안내가 "확정하면 열린다"고 하지 않는다
    expect(await page.getByText(/잔금은 견적서 탭에서 지금 결제하실 수 있습니다/).count()).toBe(1);
    expect(await page.getByText(/잔금 결제가 열립니다/).count()).toBe(0);
    // 진행 사항 문구 — 상태 변경은 어느 상태로 갔는지, 견적 거절은 수정 요청으로
    expect(await page.getByText('진행 상태: 납품 · 검수 중', { exact: true }).count()).toBe(1);
    expect(await page.getByText('견적서 v1 수정을 요청했습니다', { exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: '검수 확정' }).click();
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('completed');

    await payMilestone('잔금');
    await expect.poll(async () => {
      const d = await customerDetail();
      const deliv = (d?.events ?? []).find((e: any) => e.type === 'deliverable');
      return deliv?.files?.[0]?.locked;
    }, { timeout: 20_000 }).toBe(false);
    await openTab('#timeline', '5. 진행 · 문의');
    expect(await page.getByText('잔금 결제 후 내려받기').count()).toBe(0);
    const delivRow = page.locator('li', { hasText: 'gerber-final.txt' }).last();
    expect(await delivRow.getByRole('button', { name: '다운로드' }).count()).toBe(1);
  }, LONG);

  test('9. 완료 뒤 A/S 요청', async () => {
    const page = s.page;
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('A/S 요청으로 보내기').click();
    await page.getByPlaceholder('궁금한 점이나 전달할 내용을 적어 주세요. 담당자에게 바로 전달됩니다.').fill('[e2e 여정] 전원이 가끔 꺼집니다');
    await page.getByRole('button', { name: 'A/S 요청', exact: true }).click();
    await expect.poll(async () => ((await customerDetail())?.events ?? []).some((e: any) => e.type === 'as_request'), { timeout: 20_000 }).toBe(true);
    await openTab('#timeline', '5. 진행 · 문의');
    await page.getByText('[e2e 여정] 전원이 가끔 꺼집니다').waitFor();
  }, LONG);

  test('10. 내 의뢰 완료 · 390px 가로 넘침 0 · 고객 알림 메일 · pageErrors 0', async () => {
    const page = s.page;
    await page.goto(`/develop/me?_t=${String(Date.now())}`);
    const row = page.locator('main li', { hasText: TITLE });
    await row.waitFor();
    expect(await row.getByText('완료', { exact: true }).count()).toBe(1);
    // 완료된 의뢰에서는 확인 사항 답변을 받지 않는다(바꿀 것은 문의 · A/S 로)
    const late = await call('PUT', `/api/develop/requests/${String(rid)}/review/answers`, customerToken, { body: { answers: [{ qid: 'q-any', answer: '완료 뒤 답변' }] } });
    expect(late.status).toBe(409);
    expect(late.json?.error).toBe('INVALID_TRANSITION');

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [hash, heading] of [['#content', '1. 상세 의뢰 내용'], ['#review', '2. AI 사전 검토서'], ['#quotes', '3. 견적서'], ['#documents', '4. 진행 현황 · 프로젝트 문서'], ['#timeline', '5. 진행 · 문의']] as const) {
      await openTab(hash, heading);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `${hash} 가로 넘침`).toBeLessThanOrEqual(390);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 고객 알림 — 이번 실행 제목이 들어간 메일(접수·견적 2·착수금·중간 확인 요청·문의 답변·납품·잔금). 고객이 답할 차례인
    // 관리자 기록(확인 요청·답변)도 메일로 알린다(사용자 결정 2026-10-22). 착수 확인서 메일은 관리자가 쓴 제목 그대로라 대조에서 빠진다.
    // 제목 검색은 따옴표·괄호에 약해 받는 사람으로 찾고 걸러 낸다.
    const kinds = ['접수되었습니다', '견적서가 도착했습니다', '착수금 결제가 확인되었습니다', '확인 요청이 도착했습니다', '담당자 답변', '납품되었습니다', '잔금 결제가 확인되었습니다'];
    let subjects: string[] = [];
    await expect
      .poll(async () => {
        const mails = await mailpitSearch(`to:${JOURNEY_EMAIL}`);
        subjects = (mails?.messages ?? []).map((m: any) => String(m.Subject)).filter((t: string) => t.includes(TITLE));
        return kinds.filter((k) => !subjects.some((t) => t.includes(k)));
      }, { timeout: 15_000 })
      .toEqual([]);
    expect(subjects.filter((t) => t.includes('견적서가 도착했습니다')).length, '견적 v1·v2 메일').toBe(2);
    // 메일 링크는 할 일이 있는 탭으로 바로 연다(탭 구조)
    const mails = await mailpitSearch(`to:${JOURNEY_EMAIL}`);
    const hrefOf = async (kind: string): Promise<string> => {
      const m = (mails?.messages ?? []).find((x: any) => String(x.Subject).includes(TITLE) && String(x.Subject).includes(kind));
      const full = await mailpitMessage(String(m?.ID));
      return /href="([^"]+)"/.exec(String(full?.HTML ?? ''))?.[1] ?? '';
    };
    expect(await hrefOf('견적서가 도착했습니다')).toMatch(/\/develop\/requests\/\d+#quotes$/);
    expect(await hrefOf('납품되었습니다')).toMatch(/\/develop\/requests\/\d+#timeline$/);
    expect(await hrefOf('착수금 결제가 확인되었습니다')).toMatch(/\/develop\/requests\/\d+#documents$/);
    expect(await hrefOf('확인 요청이 도착했습니다')).toMatch(/\/develop\/requests\/\d+#timeline$/);
    expect(await hrefOf('담당자 답변')).toMatch(/\/develop\/requests\/\d+#timeline$/);
    expect(s.pageErrors).toEqual([]);
  }, LONG);

  test('11. 완료 뒤 출력물 — 개발 진행 보고서(16:9 장 · 구성도 도면 2장 · 조작 UI 0 · 장 수 = PDF 쪽 수)', async () => {
    const p = await openPrint();
    expect(p.doc).toBe('개발 진행 보고서');
    // 장 순서 — 표지 → 의뢰 개요 → 검토 요약 → 구성도 → 개발 분석 → 일정 → 확인 사항 → 진행 현황.
    // 견적서 · 진행 · 문의는 싣지 않는다(2026-11-06 사용자 결정 — 견적서는 견적서 인쇄 · PDF 가 따로 있다).
    expect(kindOrder(p.kinds)).toEqual(['cover', 'overview', 'summary', 'diagram', 'area', 'schedule', 'questions', 'tasks']);
    expect(p.kinds.filter((k) => k === 'diagram').length, '도면 한 장에 한 장').toBe(2);
    expect(p.tables, '의뢰 조건 · 일정 · 프로젝트 문서 표').toEqual(expect.arrayContaining(['overview', 'schedule', 'docs']));
    expect(p.buttons, '출력물에 누를 것이 없다(수락 · 결제 · 검수 · 받기 · 접기)').toBe(0);
    expect(p.iframes, '구성도는 iframe 이 아니라 이미지로').toBe(0);
    expect(p.figures.length).toBe(2);
    expect(p.figures.every((w) => w > 0), '도면 이미지가 디코드된다').toBe(true);
    expect(p.overflow, '넘친 장 없음(배분 · 글자 맞춤이 다 담았다)').toBe(0);
    expect(p.sizes, '장은 모두 1280×720').toEqual(['1280x720']);
    // 구성도는 도면만 — 도면 앞뒤 글(요구사항 확인 요약 · 확정된 구성 · 미확정 항목)은 싣지 않는다(2026-11-12 사용자 결정).
    for (const gone of ['요구사항 확인 요약', '확정된 구성', '미확정 항목']) expect(p.text, gone).not.toContain(gone);
    // 검토서 내용 — 요구사항 · 분야 명세 · 일정 합계 · 확인 결과 · 담당자 의견이 실린다. 생성 모델명은 싣지 않는다.
    for (const kept of ['배터리 구동 · 저전력 BLE 광고 1초 주기', 'CR2032 · LDO 3.0V', `${String(MIN_SUM)}~${String(MAX_SUM)}주`, '상담 결과: 3D 프린팅 외장으로 진행', '배터리 수명 목표(1년)']) {
      expect(p.text, kept).toContain(kept);
    }
    expect(p.text).not.toContain('e2e-model-hidden');
    const page = s.page;
    expect(await page.getByTestId('develop-quote-sheet').count(), '견적서 문서 없음').toBe(0);
    // 인쇄 — 장마다 한 쪽이고 용지는 장 크기 그대로(13.333×7.5in = 960×540pt). 배경 그래픽을 끈 기본 설정으로 뽑는다(print-color-adjust).
    const slideCount = Number(await page.locator('.develop-deck').getAttribute('data-slides'));
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    await page.emulateMedia({ media: 'screen' });
    writeFileSync(join(outputDir, 'develop-request-print.pdf'), pdf); // 눈으로 확인할 산출물(output 은 git 밖)
    const raw = pdf.toString('latin1');
    const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(slideCount).toBe(p.kinds.length);
    expect(pages, '장 수 = 인쇄 쪽 수').toBe(slideCount);
    const box = (/\/MediaBox\s*\[([^\]]+)\]/.exec(raw)?.[1] ?? '').trim().split(/\s+/).map(Number);
    expect(box.slice(2).map((n) => Math.round(n)), '용지 = 16:9 장').toEqual([960, 540]);
    expect(s.pageErrors).toEqual([]);
  }, LONG);
});
