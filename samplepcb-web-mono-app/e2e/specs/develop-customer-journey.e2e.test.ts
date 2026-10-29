// 개발의뢰 고객 화면 여정 — 첫 의뢰부터 완료·A/S 까지 **고객 화면**을 실제로 눌러 몰고, 관리자 쪽은 관리자 API 로 낸다
// (admin-develop-journey 의 거울상 — 그쪽은 관리자 화면·고객 API). 피그마 랜딩·내 의뢰·의뢰 상세(탭형) 재구현의 고객 행동 검증.
//
//   1. 랜딩 분야 카드(PCB 설계) → 위저드(미리 선택 + 앱 추가) → 접수 → 내 의뢰 '접수됨'
//   2. 관리자: 검토 시작 · 검토서(일정 8단계·전문가 검토·담당자 의견) 공개 · 구성도(도면 2장 HTML) 공개 → 검토서 탭
//   3. 관리자: 견적 v1 발송 → 내 의뢰 '견적 확인' 칩·'견적서 확인' 버튼 → 견적 탭 → 견적 수정 요청 → 관리자 v2 → 동의·성함 → 수락
//   4. 착수금 결제 버튼 → 쇼핑몰 주문서로 이동 → 관리자 수동 입금 확인 → 개발 진행 중
//   5. 관리자: 착수 확인서 발송 → 진행 현황 탭 배너 '확인하러 가기' → 회신(승인) → 배너 해소
//   6. 관리자: 중간 확인 요청 → 진행·문의 탭 '확인 · 승인'
//   7. 문의(파일 첨부) → 관리자 답변 → 진행 사항에 보인다
//   8. 관리자: 최종 납품(잠금) → 🔒 → 검수 확정 → 완료 → 잔금 결제 버튼 → 주문서 → 수동 입금 확인 → 다운로드 열림
//   9. 완료 뒤 A/S 요청 → 진행 사항 'A/S 요청'
//  10. 내 의뢰 '완료' · 390px 가로 넘침 0 · 고객 알림 메일(Mailpit) · pageErrors 0
//  11. '출력하기' 출력물 — 완료 뒤 '개발 진행 보고서'(구성도 이미지 2장·조작 UI 0·PDF 여러 쪽).
//      접수 직후 판('제품 개발 제안서', 내용 없는 섹션 생략)은 1-1 에서 본다.
//
// 데이터는 **지우지 않는다**(사용자 요청 2026-10-22 — 화면으로 다시 볼 수 있게). 실행마다 제목에 시각을 붙여 새 의뢰를 만든다.
// 의뢰인 = cf_admin(로컬에서 평소 로그인으로 내 의뢰에 바로 보인다). DEVELOP_JOURNEY_MB 로 다른 계정을 지정할 수 있다.
// 결제는 실제 PG 대신 관리자 '수동 입금 확인'(mark-paid) — 주문(g5_shop_order)을 만들지 않는다. 결제 버튼이 장바구니에
// 넣은 행(체크아웃 산물, 합성 버킷)만 지운다. AI 유스케이스(develop.*)는 실행 중 끄고 끝나면 되돌린다(실 LLM 호출 0).
// 실행: PORTAL_E2E=1 pnpm -F e2e e2e develop-customer-journey
// 사전 조건: sp-node(3333)·nginx(local-web)·sp-develop(5177)·Mailpit. 관리자 화면(sp-vue)은 필요 없다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { API_URL, RUN, closeBrowser, disconnectPrisma, getPrisma, mailpitMessage, mailpitSearch, newSession, signJwt } from '../helpers';
import type { E2eSession } from '../helpers';
import { developAdminIdentity } from '../helpers/develop-admin';

const LONG = 180_000;
const CART_BUCKET = '7777000003'; // 다른 하네스(…001 마켓·…002 개발 API)와 다른 합성 장바구니 버킷
const JOURNEY_EMAIL = 'e2e-develop-journey@example.com';
const USECASES = ['develop.dev-review', 'develop.dev-diagram', 'develop.followup', 'develop.doc-mail'];
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
  // 출력물 — 섹션 제목·표지 제목·조작 UI 수를 읽는다(이미지는 디코드까지 기다린다).
  const openPrint = async (): Promise<{ cover: string; sections: string[]; buttons: number; iframes: number; figures: number[] }> => {
    await s.page.goto(`/develop/requests/${String(rid)}/print?_t=${String(Date.now())}`);
    await s.page.getByRole('heading', { name: '1. 상세 의뢰 내용' }).waitFor({ timeout: 20_000 });
    return s.page.evaluate(async () => {
      await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
      const root = document.querySelector('.develop-print');
      return {
        cover: root?.querySelector('h1')?.textContent?.trim() ?? '',
        sections: [...(root?.querySelectorAll('[data-print-section] > h2') ?? [])].map((h) => h.textContent?.trim() ?? ''),
        buttons: root?.querySelectorAll('button, a, input, textarea, select, details').length ?? -1,
        iframes: root?.querySelectorAll('iframe').length ?? -1,
        figures: [...(root?.querySelectorAll('figure img') ?? [])].map((i) => (i as HTMLImageElement).naturalWidth),
      };
    });
  };
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
    await page.getByRole('button', { name: /^앱 개발/ }).click();
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
    await page.getByRole('button', { name: 'KiCad', exact: true }).click();
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

  test('1-1. 접수 직후 출력물 — 제품 개발 제안서, 내용 없는 섹션은 뺀다', async () => {
    await s.page.goto(`/develop/requests/${String(rid)}`);
    const link = s.page.getByRole('link', { name: '출력하기' });
    await link.waitFor();
    expect(await link.getAttribute('href')).toBe(`/develop/requests/${String(rid)}/print`);
    expect(await link.getAttribute('target')).toBe('_blank');
    const p = await openPrint();
    expect(p.cover).toBe('제품 개발 제안서');
    expect(p.sections).toEqual(['1. 상세 의뢰 내용', '2. 진행 사항']);
    expect(p.buttons, '출력물에 누를 것이 없다').toBe(0);
  }, LONG);

  test('2. 관리자 검토서·구성도 공개 → 검토서 탭(요약·도면 2장·간트·전문가 검토·모델명 숨김)', async () => {
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/status`, { to: 'reviewing' }), '검토 시작');
    ok(await admin.put(`/api/admin/develop/requests/${String(rid)}/review`, { review: REVIEW }), '검토서 작업본 저장');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/review/publish`), '검토서 공개');
    const form = new FormData();
    form.append('file', new Blob([DIAGRAM_HTML], { type: 'text/html' }), 'diagram.html');
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/diagram/upload`, form), '구성도 업로드');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/diagram/publish`), '구성도 공개');

    const page = s.page;
    await openTab('#review', '2. AI 사전 검토서');
    await page.getByText(REVIEW.summary).waitFor();
    // 소제목 번호 — 시안 70:7029 처럼 2-1(요약)~2-4(명세서)
    expect(await page.getByRole('heading', { name: `2-1. ${REVIEW.summary}` }).count()).toBe(1);
    for (const h of ['2-2. 시스템 구성도', '2-3. 예상 개발 일정', '2-4. 개발 명세서']) {
      expect(await page.getByRole('heading', { name: h, exact: true }).count(), h).toBe(1);
    }
    for (const r of REVIEW.requirements) expect(await page.getByText(r.text, { exact: true }).count()).toBe(1);
    expect(await page.getByText('e2e-model-hidden').count(), '모델명은 고객에게 안 보인다').toBe(0);
    // 구성도 — 문서를 읽어 요약·도면 2장·정리로 가른다
    await page.getByText('시스템 토폴로지 및 하드웨어 기능 블록도').waitFor();
    expect(await page.getByText('요구사항 확인 요약').count()).toBe(1);
    await page.getByText('1 / 2').waitFor();
    expect(await page.getByText('① 시스템 토폴로지 — 장치와 앱 사이 BLE 만 선으로 표시.').count()).toBe(1);
    await page.getByRole('button', { name: '다음 도면' }).click();
    await page.getByText('2 / 2').waitFor();
    expect(await page.getByText('② 하드웨어 블록도 — MCU 중심, 센서 입력 왼쪽.').count()).toBe(1);
    expect(await page.getByText('확정된 구성').count()).toBe(1);
    expect(await page.getByText('미확정 항목').count()).toBe(1);
    // 간트·합계
    expect(await page.locator('main [title$="주"]').count()).toBe(PHASES.length);
    await page.getByText(`${String(MIN_SUM)}주~${String(MAX_SUM)}주`).waitFor();
    // 명세서 — 전문가 검토 펼침 → 확인 결과 · 담당자 의견
    expect(await page.getByText('상담 결과: 3D 프린팅 외장으로 진행').count()).toBe(0);
    await page.getByRole('button', { name: '내용 보기' }).first().click();
    await page.getByText('상담 결과: 3D 프린팅 외장으로 진행').waitFor();
    expect(await page.getByText(REVIEW.adminComment).count()).toBe(1);
    // 희망 완료 시점 — 검토서 wishCode(마켓 코드)가 아니라 의뢰의 희망 시기(자유문)를 보인다('미응답' 회귀 방지)
    expect(await page.getByText('계약 후 3개월', { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.getByText('미응답', { exact: true }).count()).toBe(0);

    await page.goto('/develop/me');
    const row = page.locator('main li', { hasText: TITLE });
    await row.waitFor();
    for (const chip of ['검토 중', '검토서', '구성도']) expect(await row.getByText(chip, { exact: true }).count(), chip).toBe(1);
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
    await page.getByRole('button', { name: '수정 요청 보내기' }).click();
    await page.getByText(/수정 요청함 · 앱은 Android 만 먼저/).waitFor();
    // 고객 어휘 — 상태 칩도 '거절'이 아니라 '수정 요청'
    expect(await page.getByText('거절', { exact: true }).count()).toBe(0);
    expect(await page.getByText('수정 요청', { exact: true }).count()).toBe(1);

    const q2 = ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/quotes`, quoteBody('revision', '2차 견적(Android 우선)')), '견적 v2 초안');
    ok(await admin.post(`/api/admin/develop/quotes/${String(q2.quoteId)}/send`), '견적 v2 발송');
    await openTab('#quotes', '3. 견적서');
    await page.getByText('2차 견적(Android 우선)').waitFor();
    const accept = page.getByRole('button', { name: '견적 수락' });
    expect(await accept.isDisabled(), '동의 전엔 수락이 막힌다').toBe(true);
    await page.getByText('위 조건에 동의합니다', { exact: true }).click();
    await page.getByPlaceholder('성함').fill('여정고객');
    await accept.click();
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('accepted');
    // '착수금 대기'는 스텝퍼 라벨에도 늘 있어 기다림이 못 된다 — 결제 버튼 자체를 기다린다.
    await page.getByRole('button', { name: /원 결제$/ }).first().waitFor({ timeout: 20_000 });
    expect(await page.getByRole('button', { name: /원 결제$/ }).count(), '착수금 결제 버튼').toBe(1);
  }, LONG);

  test('4. 착수금 결제 버튼 → 주문서 → 수동 입금 확인 → 개발 진행 중', async () => {
    await payMilestone('착수금');
    await expect.poll(async () => (await customerDetail())?.status, { timeout: 20_000 }).toBe('in_progress');
    await openTab('#quotes', '3. 견적서');
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

  test('11. 완료 뒤 출력물 — 개발 진행 보고서(섹션 5·구성도 이미지 2장·조작 UI 0·PDF 여러 쪽)', async () => {
    const p = await openPrint();
    expect(p.cover).toBe('개발 진행 보고서');
    expect(p.sections).toEqual(['1. 상세 의뢰 내용', '2. AI 사전 검토서', '3. 견적서', '4. 진행 현황 · 프로젝트 문서', '5. 진행 사항']);
    expect(p.buttons, '출력물에 누를 것이 없다(수락·결제·검수·받기·접기)').toBe(0);
    expect(p.iframes, '구성도는 iframe 이 아니라 이미지로').toBe(0);
    expect(p.figures.length).toBe(2);
    expect(p.figures.every((w) => w > 0), '도면 이미지가 디코드된다').toBe(true);
    const page = s.page;
    // 견적서는 수락한 v2 하나 — 수정 요청한 v1 은 싣지 않는다
    const quotes = page.locator('[data-print-section="quotes"]');
    expect(await quotes.locator('article').count()).toBe(1);
    expect(await quotes.getByText('수락', { exact: true }).count()).toBe(1);
    expect(await quotes.getByText('수정 요청', { exact: true }).count()).toBe(0);
    // 인쇄(A4 가로) — 표지 + 섹션마다 새 쪽이라 최소 6쪽. 배경 그래픽을 끈 기본 설정으로도 찍힌다(print-color-adjust).
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(6);
    expect(s.pageErrors).toEqual([]);
  }, LONG);
});
