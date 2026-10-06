// 관리자 「개발」 화면 e2e 공용 — 시드(고객 API)·정리·옛/새 화면 차이 어댑터.
//
// 같은 시나리오를 옛 화면(/app/admin/develop)과 리뉴얼 화면(/app/admin/next/develop)에서 돌린다(env DEVELOP_ADMIN_UI=old|next,
// 기본 old). 옛 화면에서 green 이면 시나리오가 맞고, 새 화면도 green 이면 동작이 같다는 대조가 된다.
// 선택자는 role·이름(문구) 중심 — 두 화면이 같은 문구를 쓰기로 했다(docs/ADMIN_NEXT_UI.md). 구조가 다른 곳(탭 버튼 vs role=tab,
// 네이티브 체크박스 vs role=checkbox 버튼, 인라인 확인 vs 포털 대화상자, 사이드바 마크업)은 이 파일의 어댑터 함수가 가린다.
//
// 데이터 원칙(공유 DB): e2e 전용 계정(DEVELOP_UI_MB)이 고객 API 로 의뢰를 만들고 cleanupDevelopUi 가 그 계정의 의뢰를
// 통째로 지운다(이벤트·견적·마일스톤·문서·업무·버전은 cascade). aiConsent=false 로 등록해 AI 잡이 돌지 않는다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { API_URL } from './env';
import { getPrisma } from './db';
import { signJwt } from './jwt';
import { mailpitDelete, mailpitSearch } from './mailpit';

export type DevelopAdminUi = 'old' | 'next';
export const DEVELOP_ADMIN_UI: DevelopAdminUi = process.env.DEVELOP_ADMIN_UI === 'next' ? 'next' : 'old';

/** vue-router base(/app) 포함 경로 접두. */
export const DEVELOP_ADMIN_BASE = DEVELOP_ADMIN_UI === 'next' ? '/app/admin/next/develop' : '/app/admin/develop';

const ROUTE_PREFIX = DEVELOP_ADMIN_UI === 'next' ? 'admin-next-develop' : 'admin-develop';
export type DevelopQueueKey = 'home' | 'intake' | 'contracts' | 'projects' | 'deliveries' | 'inquiries' | 'requests';
const QUEUE_PATHS: Record<DevelopQueueKey, string> = {
  home: '',
  intake: '/intake',
  contracts: '/contracts',
  projects: '/projects',
  deliveries: '/deliveries',
  inquiries: '/inquiries',
  requests: '/requests',
};
/** 큐 라우트 이름(상세 `?from=` 값) — 옛 'admin-develop-intake' · 새 'admin-next-develop-intake'. */
export const developQueueRouteName = (key: DevelopQueueKey): string =>
  key === 'home' ? ROUTE_PREFIX : `${ROUTE_PREFIX}-${key}`;
export const developQueuePath = (key: DevelopQueueKey): string => `${DEVELOP_ADMIN_BASE}${QUEUE_PATHS[key]}`;
export const developDetailPath = (requestId: number): string => `${DEVELOP_ADMIN_BASE}/requests/${String(requestId)}`;

// ── 주체·API ─────────────────────────────────────────────────────────────────

/** e2e 전용 의뢰인(실회원 아님 — 회원 행 없이도 개발의뢰 API 는 JWT 의 mbId 로 돈다, develop-wizard 관례). */
export const DEVELOP_UI_MB = 'e2e-develop-admin-ui';
export const developCustomer = { mbId: DEVELOP_UI_MB, mbNick: '개발화면고객' };
export const DEVELOP_UI_CONTACT_EMAIL = 'e2e-develop-admin-ui@example.com';

/** 관리자 = cf_admin(검토 시작이 담당자를 이 mbId 로 채운다). */
export async function developAdminIdentity(): Promise<{ mbId: string; mbNick: string; isAdmin: true }> {
  const rows: any[] = await getPrisma().$queryRawUnsafe('SELECT cf_admin FROM g5_config LIMIT 1');
  const cfAdmin = String(rows[0]?.cf_admin ?? '');
  if (cfAdmin === '') throw new Error('g5_config.cf_admin 없음');
  return { mbId: cfAdmin, mbNick: '최고관리자', isAdmin: true };
}

export interface DevelopApiResult {
  status: number;
  json: any;
}

async function call(
  method: string,
  path: string,
  token: string,
  init: { body?: unknown; form?: FormData } = {},
): Promise<DevelopApiResult> {
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

const payloadForm = (payload: unknown): FormData => {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  return form;
};

export const customerApi = {
  token: (): string => signJwt({ ...developCustomer }),
  get: (path: string) => call('GET', path, customerApi.token()),
  post: (path: string, body: unknown) => call('POST', path, customerApi.token(), { body }),
  postForm: (path: string, payload: unknown) => call('POST', path, customerApi.token(), { form: payloadForm(payload) }),
};

export function adminApi(identity: { mbId: string; mbNick: string; isAdmin: true }) {
  const token = (): string => signJwt(identity);
  return {
    get: (path: string) => call('GET', path, token()),
  };
}

/** 고객 등록 — 개별 견적(PCB+앱) 최소 payload. aiConsent=false(AI 잡 없음). 하네스 basePayload 와 같은 모양. */
export async function createDevelopRequestAsCustomer(title: string): Promise<number> {
  const res = await customerApi.postForm('/api/develop/requests', {
    title,
    requestMode: 'individual',
    serviceAreas: ['pcb', 'app'],
    tools: { version: 1, byArea: {} },
    description: '[e2e-ui] 관리자 개발 화면 여정 픽스처입니다. BLE 온습도 로거, 배터리 구동, 스마트폰 앱 연동.',
    answers: [
      { code: 'pcb.type', choices: ['new'] },
      { code: 'app.flow', choices: [], note: '로그인 → 제품 등록 → 상태 확인' },
    ],
    currentStage: 'idea',
    targetStage: 'prototype_done',
    wishDate: null,
    wishNote: '계약 후 3개월',
    budgetRange: 'r1000_3000',
    expertDelegate: false,
    production: { prototype: 'count', prototypeQty: 3, scopes: ['pcb_fab'], annualQty: 100, priority: 'cost', sourcing: 'samplepcb_all', delivery: 'pcba' },
    ndaWanted: false,
    aiConsent: false,
    contact: { name: '이투이', company: '이투이랩', phone: '010-1234-5678', email: DEVELOP_UI_CONTACT_EMAIL, hours: null },
  });
  if (res.status !== 200 || typeof res.json?.data?.requestId !== 'number') {
    throw new Error(`의뢰 등록 실패: ${String(res.status)} ${JSON.stringify(res.json)}`);
  }
  return res.json.data.requestId as number;
}

/** 정리 — e2e 계정 의뢰를 통째로(cascade) + 그 의뢰의 발송 원장·파일 행. 남은 의뢰 수를 돌려준다(0 기대). */
export async function cleanupDevelopUi(): Promise<number> {
  const prisma = getPrisma();
  const requests: { id: bigint }[] = await prisma.spDevelopRequest.findMany({ where: { mbId: DEVELOP_UI_MB }, select: { id: true } });
  const rids = requests.map((r) => r.id);
  if (rids.length > 0) {
    const [events, quotes, docs] = await Promise.all([
      prisma.spDevelopEvent.findMany({ where: { requestId: { in: rids } }, select: { id: true } }),
      prisma.spDevelopQuote.findMany({ where: { requestId: { in: rids } }, select: { id: true } }),
      prisma.spDevelopDocument.findMany({ where: { requestId: { in: rids } }, select: { id: true } }),
    ]);
    const refs: { refType: string; refId: bigint }[] = [
      ...rids.map((id) => ({ refType: 'sp_develop_request', refId: id })),
      ...events.map((e: { id: bigint }) => ({ refType: 'sp_develop_event', refId: e.id })),
      ...quotes.map((q: { id: bigint }) => ({ refType: 'sp_develop_quote', refId: q.id })),
      ...docs.map((d: { id: bigint }) => ({ refType: 'sp_develop_document', refId: d.id })),
    ];
    // 이 시나리오는 파일을 올리지 않는다 — 행이 있으면 실파일은 남기고(파일서버 삭제는 하네스 몫) 행만 걷는다.
    for (const ref of refs) await prisma.spFile.deleteMany({ where: ref });
    await prisma.spMailLog.deleteMany({ where: { refType: 'develop_request', refId: { in: rids.map((id) => String(id)) } } });
    await prisma.spDevelopRequest.deleteMany({ where: { id: { in: rids } } });
  }
  return prisma.spDevelopRequest.count({ where: { mbId: DEVELOP_UI_MB } });
}

/** 이 시나리오가 유발한 메일(고객 연락처 주소로 간 것)만 Mailpit 에서 지운다. Mailpit 이 없으면 조용히 넘어간다. */
export async function purgeDevelopUiMail(): Promise<number> {
  try {
    const found = await mailpitSearch(`to:${DEVELOP_UI_CONTACT_EMAIL}`);
    const ids: string[] = (found?.messages ?? []).map((m: any) => String(m.ID));
    await mailpitDelete(ids);
    return ids.length;
  } catch {
    return 0;
  }
}

/**
 * dev 서버의 vite 오류 오버레이 끄기 — vite 는 컴파일 오류를 **모든 클라이언트**에 방송한다. 다른 작업이 src 를 고치는 중이면
 * 지금 화면과 무관한 파일 오류 오버레이가 클릭을 가로챈다(2026-10-07 실측). 화면 동작 검증에는 무관하니 끈다 — 실제 런타임
 * 오류는 pageErrors 게이트가 잡는다.
 */
export async function hideViteOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'vite-error-overlay{display:none!important;pointer-events:none!important}';
    const attach = (): void => {
      document.head.appendChild(style);
    };
    if (document.head !== null) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  });
}

// ── 화면 어댑터 ──────────────────────────────────────────────────────────────

/** 좌측 사이드바(옛 aside · 새 shadcn Sidebar). */
export const sidebarOf = (page: Page): Locator =>
  DEVELOP_ADMIN_UI === 'next' ? page.locator('[data-sidebar="sidebar"]').first() : page.locator('aside').first();

/** 사이드바 메뉴 배지 숫자(없으면 0). 링크 글자 = 라벨 + 배지. */
export async function menuBadge(page: Page, label: string): Promise<number> {
  const link = sidebarOf(page).getByRole('link', { name: new RegExp(`^${escapeRe(label)}`) }).first();
  await link.waitFor();
  const text = (await link.innerText()).replace(/\s+/g, ' ').trim();
  const m = /(\d+)\s*$/.exec(text.slice(label.length));
  return m?.[1] === undefined ? 0 : Number(m[1]);
}

/** 큐 탭(옛 버튼 · 새 role=tab). 이름은 "라벨 + 건수"라 앞부분으로 찾는다. */
export function queueTab(page: Page, label: string): Locator {
  const name = new RegExp(`^${escapeRe(label)}(\\s|\\d|$)`);
  return DEVELOP_ADMIN_UI === 'next' ? page.getByRole('tab', { name }).first() : page.getByRole('button', { name }).first();
}

/** 큐 검색(두 화면 다 Enter 로 확정 — 옛 화면은 keyup.enter, 새 화면은 SearchInput 제출). */
export async function searchQueue(page: Page, q: string): Promise<void> {
  const box = page.getByRole('searchbox').first();
  await box.fill(q);
  await box.press('Enter');
}

/** 상세 탭 — 두 화면 다 role=tab(이름은 "라벨 + 배지"). */
export const detailTab = (page: Page, label: string): Locator =>
  page.getByRole('tab', { name: new RegExp(`^${escapeRe(label)}`) }).first();

/**
 * 확인 단계 — 옛 화면은 그 자리 인라인 패널, 새 화면은 포털 대화상자. 둘 다 "문구와 확인 버튼을 함께 품은 가장 안쪽 상자"로 찾는다.
 * (대화상자면 내용 상자, 인라인이면 패널 div — 바깥의 같은 이름 버튼(예: 머리의 「발송」)과 섞이지 않는다.)
 */
export async function answerConfirm(page: Page, message: RegExp | string, button: string): Promise<void> {
  const box = page
    .locator('div, section, form, [role="dialog"], [role="alertdialog"]')
    .filter({ hasText: message })
    .filter({ has: page.getByRole('button', { name: button, exact: true }) })
    .last();
  await box.waitFor();
  await box.getByRole('button', { name: button, exact: true }).last().click();
}

/** "제목(heading)과 버튼을 함께 품은 가장 안쪽 상자" — 같은 이름 버튼이 여러 구역에 있을 때(업무표 저장 vs 문서 저장). */
export function scopeWith(page: Page, text: RegExp | string, button: string | RegExp): Locator {
  return page
    .locator('section, article, div, form')
    .filter({ hasText: text })
    .filter({ has: page.getByRole('button', { name: button }) })
    .last();
}

/** 체크박스 켜기/끄기 — 옛 input[type=checkbox] · 새 role=checkbox(reka) 둘 다 getByRole('checkbox') 로 잡힌다. */
export async function setCheck(scope: Page | Locator, label: string, checked: boolean): Promise<void> {
  await scope.getByRole('checkbox', { name: label }).first().setChecked(checked);
}

/**
 * 선택 상자에서 보이는 글자로 고르기 — 네이티브 select 면 selectOption, shadcn Select(role=combobox) 면 열고 option 클릭.
 * scope 안의 첫 select/combobox 중 그 글자를 옵션으로 가진 것.
 */
export async function chooseOption(scope: Locator, optionLabel: string): Promise<void> {
  // 화면이 아직 그려지는 중이면 개수가 0 으로 읽힌다 — 선택 상자 하나가 보일 때까지 기다린 뒤 센다.
  await scope.locator('select, button[role="combobox"]').first().waitFor();
  const selects = scope.locator('select');
  const n = await selects.count();
  for (let i = 0; i < n; i += 1) {
    const sel = selects.nth(i);
    const labels = (await sel.locator('option').allTextContents()).map((text) => text.trim());
    if (labels.includes(optionLabel)) {
      await sel.selectOption({ label: optionLabel });
      return;
    }
  }
  // shadcn Select(reka) — 트리거(role=combobox, button)를 열고 목록의 option 을 누른다.
  const combo = scope.locator('button[role="combobox"]').first();
  await combo.click();
  await scope.page().getByRole('option', { name: optionLabel, exact: true }).click();
}

/** 글자 칸(라벨 연결이 있으면 getByLabel, 없으면 "라벨 글자 + 입력칸"을 함께 품은 가장 안쪽 상자). */
export async function fillByLabel(scope: Page | Locator, label: string, value: string): Promise<void> {
  const byLabel = scope.getByLabel(label, { exact: true });
  if ((await byLabel.count()) > 0) {
    await byLabel.first().fill(value);
    return;
  }
  const page: Page = typeof (scope as Locator).page === 'function' ? (scope as Locator).page() : (scope as Page);
  const box = scope
    .locator('div, label')
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.locator('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file])') })
    .last();
  await box.locator('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file])').first().fill(value);
}

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
