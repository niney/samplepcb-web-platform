// 개발의뢰 출력물(16:9 장 판, docs/DEVELOP_FLOW.md §7.2.10) — **실전 규모** 검증.
// 고객 여정 e2e(develop-customer-journey 11번)의 픽스처는 분야 2 · 명세 3/2 라 장이 거의 비어, 배분(단 쌓기 · 고르게 나누기 ·
// 넘침 허용 · 표 이어 붙이기 · 글자 맞춤)이 한 번도 일어나지 않는다. 여기서는 로컬 #257(실데이터)과 같은 크기의 의뢰를 만든다 —
// 시스템개발 6분야 · 명세 6/5/6/2/1/0 · 확인 사항 6 · 일정 8단계 · 도면 2장(1900×1200) · 업무 8행 · 문서 3건 · AI 추가 질문 6
// (fixtures/develop-deck-rich.ts — 내용은 지어낸 제품, 크기만 실전).
//
//   1. 준비 — 고객 API 로 접수 → 관리자 API 로 검토서 · 구성도 공개 → 견적 발송 · 수락 · 착수금 확인(개발 진행 중) →
//      업무표 · 일정 → 착수 확인서(승인) · 단계 검토(조건부 승인) · 정기 진행보고(공유)
//   2. 장 구성 — 순서 · 분야 6개가 두 장 안팎 · 문항 고르게 · 일정 한 장 · 진행 현황에 문서 표 · AI 추가 질문 · 도면만
//   3. 품질 — 넘친 장 0 · 글자 줄임 15% 이내 · 주요 장은 본문의 40% 이상 참 · 도면 가로 900px 이상
//   4. 인쇄 — 장 수 = PDF 쪽 수 · 용지 16:9 · 장마다 PNG(output/develop-print-deck/)
//   5. 의뢰 상세(PC) — 읽는 탭 셋(상세 의뢰 내용 · AI 사전 검토서 · 진행 현황)과 견적서를 같은 장으로 넘겨 본다(§7.2.11 · §7.2.12): 넘긴 장이 창 안에
//      통째로 · 마지막 장의 다음은 다음 탭 · ←/→ 키 · 구성도 설명은 옆 판(기본 닫힘) · 문서 목록은 장 아래 그대로
//      · 견적서는 요약 → 산출 내역, 수락 · 결제는 장 아래 판 · 진행·문의 / 첨부는 넘기지 않고 장과 같은 폭의 판
//   6. 의뢰 상세(390px) — 같은 덩어리를 세로 흐름으로: 가로 넘침 0 · 내용 누락 없음 · 구성도 설명은 그 자리에서 펼침 · 견적 판 뒤에 수락 · 결제 판
//
// 데이터: 기본은 e2e 전용 계정(e2e-develop-deck)으로 만들고 끝나면 통째로 지운다(공유 DB — 스스로 만들고 스스로 지운다).
// DEVELOP_DECK_KEEP=1 이면 의뢰인을 cf_admin 으로 해 남긴다 — 평소 로그인으로 /develop/requests/:id/print 를 열어 볼 수 있다.
// 실 LLM 호출 0(aiConsent=false · develop.* 유스케이스를 끄고 되돌린다). 첨부 · AI 추가 질문은 행을 직접 넣는다(파일서버 · 잡 없이).
// 실행: PORTAL_E2E=1 pnpm -F e2e e2e develop-print-deck
// 사전 조건: sp-node(3333) · nginx(local-web) · sp-develop(5177). Mailpit 은 없어도 된다(메일은 비차단).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { API_URL, RUN, closeBrowser, disconnectPrisma, getPrisma, mailpitDelete, mailpitSearch, newSession, signJwt } from '../helpers';
import type { E2eSession } from '../helpers';
import { developAdminIdentity } from '../helpers/develop-admin';
import { outputDir } from '../helpers/env';
import {
  DECK_AI_QUESTIONS,
  DECK_ANSWERS,
  DECK_AREAS,
  DECK_DESCRIPTION,
  DECK_DIAGRAM_CAPTIONS,
  DECK_DIAGRAM_HTML,
  DECK_DIAGRAM_ONLY_TEXTS,
  DECK_MAX_WEEKS,
  DECK_MIN_WEEKS,
  DECK_PHASES,
  DECK_QUOTE,
  DECK_REVIEW,
  DECK_SCHEDULE,
  DECK_TASKS,
} from '../fixtures/develop-deck-rich';

const LONG = 180_000;
const KEEP = process.env.DEVELOP_DECK_KEEP === '1';
const DECK_MB = 'e2e-develop-deck';
const DECK_EMAIL = 'e2e-develop-deck@example.com';
const USECASES = ['develop.dev-review', 'develop.dev-diagram', 'develop.followup', 'develop.area-followup', 'develop.doc-mail'];
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
const TITLE = `[e2e 출력물] 설비 진동·온도 감시 센서 노드 개발 ${stamp}`;
const FILES = ['설비_진동감시_요구사항_v2.docx', '참고_외함_치수도.pdf'];
const SHOT_DIR = join(outputDir, 'develop-print-deck');

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
const ok = (r: Res, label: string): any => {
  expect(r.status, `${label}: ${JSON.stringify(r.json)}`).toBe(200);
  return r.json?.data;
};

// 한 계정의 의뢰를 통째로(이벤트 · 견적 · 마일스톤 · 문서 · 업무 · 버전은 cascade) + 파일 행 · 발송 원장. 남은 수를 돌려준다.
async function cleanup(mbId: string): Promise<number> {
  const prisma = getPrisma();
  const requests: { id: bigint }[] = await prisma.spDevelopRequest.findMany({ where: { mbId }, select: { id: true } });
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
    for (const ref of refs) await prisma.spFile.deleteMany({ where: ref });
    await prisma.spMailLog.deleteMany({ where: { refType: 'develop_request', refId: { in: rids.map((id) => String(id)) } } });
    await prisma.spDevelopRequest.deleteMany({ where: { id: { in: rids } } });
  }
  return prisma.spDevelopRequest.count({ where: { mbId } });
}

interface SlideInfo {
  page: number;
  kind: string;
  title: string;
  zoom: number;
  overflow: boolean;
  fill: number | null; // 본문이 찬 비율(0~1) — 도면 장(본문 상자가 없다)은 null
  questions: number;
  size: string;
}

describe.skipIf(!RUN)('개발의뢰 출력물(16:9 장) — 실전 규모', () => {
  let s: E2eSession;
  let adminToken = '';
  let customerToken = '';
  let customerMb = DECK_MB;
  let rid = 0;
  let slides: SlideInfo[] = [];
  const usecaseBefore: Record<string, boolean> = {};

  const admin = {
    post: (p: string, body: unknown = {}) => call('POST', p, adminToken, { body }),
    put: (p: string, body: unknown) => call('PUT', p, adminToken, { body }),
    form: (p: string, form: FormData) => call('POST', p, adminToken, { form }),
  };
  const customer = {
    get: (p: string) => call('GET', p, customerToken),
    post: (p: string, body: unknown = {}) => call('POST', p, customerToken, { body }),
    form: (p: string, form: FormData) => call('POST', p, customerToken, { form }),
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null || health.status >= 500) throw new Error('API 서버를 켜세요: pnpm dev:api (127.0.0.1:3333)');
    const adminId = await developAdminIdentity();
    adminToken = signJwt(adminId);
    customerMb = KEEP ? adminId.mbId : DECK_MB;
    const identity = { mbId: customerMb, mbNick: '출력물고객', isAdmin: customerMb === adminId.mbId };
    customerToken = signJwt(identity);
    const prisma = getPrisma();
    if (!KEEP) await cleanup(DECK_MB); // 지난 실행이 중간에 죽어 남긴 것
    for (const useCase of USECASES) {
      const row = await prisma.spAiUsecase.findUnique({ where: { useCase } });
      if (row === null) continue;
      usecaseBefore[useCase] = row.enabled;
      await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled: false } });
    }
    s = await newSession(identity);
  }, LONG);

  afterAll(async () => {
    const prisma = getPrisma();
    for (const [useCase, enabled] of Object.entries(usecaseBefore)) {
      await prisma.spAiUsecase.update({ where: { useCase }, data: { enabled } });
    }
    await s?.close();
    if (KEEP) {
      console.log(`[develop-print-deck] 남긴 의뢰 #${String(rid)} — /develop/requests/${String(rid)}/print`);
    } else {
      const left = await cleanup(DECK_MB);
      const mails = await mailpitSearch(`to:${DECK_EMAIL}`).catch(() => null);
      await mailpitDelete((mails?.messages ?? []).map((m: any) => String(m.ID))).catch(() => undefined);
      console.log(`[develop-print-deck] 정리 — 남은 의뢰 ${String(left)}`);
    }
    await disconnectPrisma();
    await closeBrowser();
  });

  test('1. 준비 — #257 규모 의뢰: 접수 → 검토서 · 구성도 공개 → 수락 · 착수 → 업무 8 · 문서 3', async () => {
    const form = new FormData();
    form.append(
      'payload',
      JSON.stringify({
        title: TITLE,
        requestMode: 'system',
        serviceAreas: [...DECK_AREAS],
        tools: { version: 1, byArea: {} },
        description: DECK_DESCRIPTION,
        answers: DECK_ANSWERS,
        currentStage: 'requirements',
        targetStage: 'spec_fixed',
        wishDate: null,
        wishNote: '계약 후 5개월',
        budgetRange: 'r1000_3000',
        expertDelegate: false,
        production: { prototype: 'count', prototypeQty: 10, scopes: ['pcb_fab'], annualQty: 500, priority: 'durability', sourcing: 'samplepcb_all', delivery: 'pcba' },
        ndaWanted: true,
        aiConsent: false,
        contact: { name: '김현장', company: '한빛설비', phone: '010-1234-5678', email: DECK_EMAIL, hours: '평일 10~17시' },
      }),
    );
    const created = await customer.form('/api/develop/requests', form);
    expect(created.status, `의뢰 등록: ${JSON.stringify(created.json)}`).toBe(200);
    rid = Number(created.json?.data?.requestId);
    expect(rid).toBeGreaterThan(0);

    // AI 추가 질문 · 첨부 — 잡 · 파일서버 없이 행만(출력물은 질문 · 답과 파일 이름 · 크기만 읽는다).
    const prisma = getPrisma();
    await prisma.spDevelopRequest.update({ where: { id: BigInt(rid) }, data: { aiQuestions: DECK_AI_QUESTIONS } });
    for (const [i, name] of FILES.entries()) {
      await prisma.spFile.create({
        data: {
          refType: 'sp_develop_request', refId: BigInt(rid), uploadFileName: `e2e-deck-${String(i)}`, originFileName: name,
          pathToken: 'e2e/develop-print-deck', size: BigInt(48_000 + i * 1_250_000), writeDate: new Date(), fileType: 'attachment', uploadedBy: 'USER',
        },
      });
    }

    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/status`, { to: 'reviewing' }), '검토 시작');
    ok(await admin.put(`/api/admin/develop/requests/${String(rid)}/review`, { review: DECK_REVIEW }), '검토서 작업본 저장');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/review/publish`), '검토서 공개');
    const diagram = new FormData();
    diagram.append('file', new Blob([DECK_DIAGRAM_HTML], { type: 'text/html' }), 'diagram.html');
    ok(await admin.form(`/api/admin/develop/requests/${String(rid)}/diagram/upload`, diagram), '구성도 업로드');
    ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/diagram/publish`), '구성도 공개');

    const quote = ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/quotes`, DECK_QUOTE), '견적 초안');
    ok(await admin.post(`/api/admin/develop/quotes/${String(quote.quoteId)}/send`), '견적 발송');
    ok(await customer.post(`/api/develop/requests/${String(rid)}/quotes/${String(quote.quoteId)}/accept`, { agree: true, name: '김현장' }), '견적 수락');
    const deposit = await prisma.spDevelopMilestone.findFirst({ where: { requestId: BigInt(rid), title: '착수금', status: 'pending' } });
    expect(deposit, '착수금 결제 대기 마일스톤').not.toBeNull();
    ok(await admin.post(`/api/admin/develop/milestones/${String(deposit.id)}/mark-paid`, { note: '[e2e 출력물] 수동 입금 확인' }), '착수금 수동 입금 확인');

    ok(await admin.put(`/api/admin/develop/requests/${String(rid)}/tasks`, { tasks: DECK_TASKS, schedule: DECK_SCHEDULE }), '업무표 · 일정 저장');

    // 문서 — 착수 확인서는 서버가 수락 견적에서 본문을 채우고, 나머지는 본문이 있어야 보낼 수 있다.
    const decide = async (type: string, mail: string, decision: string | null, note: string, content?: Record<string, string>): Promise<void> => {
      const doc = ok(await admin.post(`/api/admin/develop/requests/${String(rid)}/documents`, { type, ...(content === undefined ? {} : { content }) }), `${type} 초안`);
      ok(await admin.post(`/api/admin/develop/documents/${String(doc.documentId)}/send`, { mailSubject: `[샘플피씨비] ${mail}`, mailBody: `${mail} 을 확인해 주세요.` }), `${type} 발송`);
      if (decision === null) return;
      ok(await customer.post(`/api/develop/requests/${String(rid)}/documents/${String(doc.documentId)}/decide`, { decision, name: '김현장', ...(note === '' ? {} : { note }) }), `${type} 회신`);
    };
    await decide('kickoff', '착수 확인 요청', 'approved', '현장 실측은 12월 첫 주 정기 보수 기간에 진행해 주세요.');
    await decide('stage_review', '회로 설계 검토 요청', 'conditional', '무선 방식은 두 안의 전류 비교표를 받은 뒤 확정하겠습니다. 온도 센서는 접촉식으로 진행해 주세요.', {
      doneWork: '센서부 · 전원부 회로 설계와 무선 방식 두 안의 비교를 마쳤습니다.',
      asks: '무선 방식(두 안)과 온도 센서 방식을 확인해 주세요.',
    });
    await decide('progress_report', '정기 진행보고', null, '', {
      reportOn: '2026-12-11',
      doneWork: '현장 실측과 외함 구조안을 마쳤습니다.',
      currentWork: '회로 설계와 펌웨어 골격을 진행하고 있습니다.',
      nextWork: '회로 검토 뒤 PCB 부품 배치를 시작합니다.',
    });

    const d = (await customer.get(`/api/develop/requests/${String(rid)}`)).json?.data;
    expect(d?.status, '착수금 확인 뒤 개발 진행 중').toBe('in_progress');
    expect(d?.review?.areas?.length).toBe(6);
    expect(d?.diagram).not.toBeNull();
    expect(d?.progress?.tasks?.length, '공유된 업무').toBe(DECK_TASKS.length);
    expect(d?.documents?.length, '보낸 문서').toBe(3);
    expect(d?.files?.length).toBe(FILES.length);
    expect(d?.aiQuestions?.questions?.length).toBe(DECK_AI_QUESTIONS.questions.length);
  }, LONG);

  test('2. 장 구성 — 순서 · 분야 · 문항 · 일정 · 진행 현황 · AI 추가 질문, 구성도는 도면만', async () => {
    const page = s.page;
    await page.goto(`/develop/requests/${String(rid)}/print?_t=${String(Date.now())}`);
    await page.locator('.develop-deck .deck-slide').first().waitFor({ timeout: 20_000 });
    const info = await page.evaluate(async () => {
      await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
      const root = document.querySelector('.develop-deck');
      const list = [...(root?.querySelectorAll<HTMLElement>('.deck-slide') ?? [])];
      return {
        slides: list.map((el) => {
          const body = el.querySelector('[data-deck-body]');
          let fill: number | null = null;
          if (body !== null) {
            const box = body.getBoundingClientRect();
            const bottoms = [...body.querySelectorAll('*')].filter((n) => n.children.length === 0).map((n) => n.getBoundingClientRect().bottom);
            fill = box.height <= 0 || bottoms.length === 0 ? 0 : (Math.max(...bottoms) - box.top) / box.height;
          }
          return {
            page: Number(el.getAttribute('data-deck-slide')),
            kind: el.getAttribute('data-deck-kind') ?? '',
            title: el.querySelector('h2')?.textContent?.trim() ?? '',
            zoom: Number(el.getAttribute('data-deck-zoom') ?? '1'),
            overflow: el.hasAttribute('data-deck-overflow'),
            fill,
            questions: [...el.querySelectorAll('p')].filter((p) => /^\d+\.$/.test(p.firstElementChild?.textContent?.trim() ?? '')).length,
            size: `${String(el.offsetWidth)}x${String(el.offsetHeight)}`,
          };
        }),
        tables: [...(root?.querySelectorAll('[data-deck-table]') ?? [])].map((el) => ({
          table: el.getAttribute('data-deck-table') ?? '',
          page: Number(el.closest('.deck-slide')?.getAttribute('data-deck-slide') ?? '0'),
        })),
        figures: [...(root?.querySelectorAll<HTMLImageElement>('img[data-deck="diagram"]') ?? [])].map((img) => {
          const r = img.getBoundingClientRect();
          const zoomed = r.width / Math.max(1, img.offsetWidth); // 화면 맞춤(장 묶음 zoom) 보정
          const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
          const w = Math.min(img.offsetWidth, img.offsetHeight * ratio);
          return { natural: img.naturalWidth, width: Math.round(w), height: Math.round(w / ratio), zoomed };
        }),
        buttons: root?.querySelectorAll('button, a, input, textarea, select, details').length ?? -1,
        iframes: root?.querySelectorAll('iframe').length ?? -1,
        doc: root?.querySelector('[data-deck="doc-name"]')?.textContent?.trim() ?? '',
        text: root?.textContent ?? '',
      };
    });
    slides = info.slides;
    console.table(slides.map((x) => ({ ...x, fill: x.fill === null ? '—' : `${String(Math.round(x.fill * 100))}%` })));
    const kinds = slides.map((x) => x.kind);
    const pagesOf = (kind: string): SlideInfo[] => slides.filter((x) => x.kind === kind);

    expect(info.doc, '착수 뒤는 진행 보고서').toBe('개발 진행 보고서');
    // 순서 — 같은 종류가 이어지면 하나로. 내용 양에 따라 제 장을 갖는 것(세부 답변 · 첨부 · 문서 · 긴 글)은 뺀다.
    const optional = ['brief', 'files', 'docs', 'text'];
    const order = kinds.filter((k) => !optional.includes(k)).filter((k, i, all) => i === 0 || all[i - 1] !== k);
    expect(order).toEqual(['cover', 'overview', 'qa', 'summary', 'diagram', 'area', 'schedule', 'questions', 'tasks']);
    expect(slides.length, '실전 규모가 스무 장을 넘지 않는다(4:3 판은 #257 이 28쪽)').toBeLessThanOrEqual(20);

    // 표 — 의뢰 조건 · 세부 답변 · 첨부 · 일정 · 업무 · 문서가 어딘가에 실린다. 문서 표는 진행 현황 마지막 장에 이어 붙거나 제 장.
    const tableNames = info.tables.map((t) => t.table);
    for (const name of ['overview', 'brief', 'files', 'schedule', 'tasks', 'docs']) expect(tableNames, `${name} 표`).toContain(name);
    const lastTasks = pagesOf('tasks').at(-1)?.page ?? 0;
    const docsPage = info.tables.find((t) => t.table === 'docs')?.page ?? 0;
    expect(docsPage === lastTasks || kinds[docsPage - 1] === 'docs', '문서 표는 진행 현황 마지막 장 또는 제 장').toBe(true);

    // 개발 분석 — 분야 6개가 순서대로 장 제목에 나오고, 두세 장에 든다(분야마다 한 장씩 쓰지 않는다).
    const areaTitles = pagesOf('area').map((x) => x.title.replace('개발 분석: ', '')).join(' · ');
    expect(areaTitles).toBe('회로 설계 · PCB 설계 · 펌웨어 개발 · 기구 설계 · 앱 개발 · 서버 개발');
    expect(pagesOf('area').length).toBeGreaterThanOrEqual(2);
    expect(pagesOf('area').length).toBeLessThanOrEqual(3);

    // 일정 8단계는 한 장(합계 띠 포함), 확인 사항 6문항은 장마다 고르게(차이 1 이하) · 번호는 이어진다.
    expect(pagesOf('schedule').length, '일정 8단계 한 장').toBe(1);
    const perSlide = pagesOf('questions').map((x) => x.questions);
    expect(perSlide.reduce((a, b) => a + b, 0)).toBe(DECK_REVIEW.openQuestions.length);
    expect(Math.max(...perSlide) - Math.min(...perSlide), `문항 배분 ${perSlide.join('+')}`).toBeLessThanOrEqual(1);
    expect(pagesOf('questions').map((x) => x.title).join(' / ')).toMatch(/^확인이 필요한 사항: 공통/);

    // 구성도 — 도면 한 장에 한 장, 이미지로, 크게. 도면 앞뒤 글은 없다(사용자 결정 2026-11-12). 도면 설명 한 줄은 싣는다.
    expect(pagesOf('diagram').length).toBe(2);
    expect(info.iframes).toBe(0);
    expect(info.figures.length).toBe(2);
    for (const f of info.figures) {
      expect(f.natural, '도면 이미지가 디코드된다').toBeGreaterThan(0);
      expect(f.width, `도면 가로(${String(f.width)}×${String(f.height)}) — 4:3 판은 760`).toBeGreaterThanOrEqual(900);
    }
    for (const gone of DECK_DIAGRAM_ONLY_TEXTS) expect(info.text, `도면 앞뒤 글: ${gone}`).not.toContain(gone);
    for (const caption of DECK_DIAGRAM_CAPTIONS) expect(info.text).toContain(caption);

    // 내용이 빠지지 않았다 — 요구사항 · 분야 명세 · 검토 관찰 · 일정 단계와 합계 · 확인 사항과 확인 결과 · 담당자 의견 ·
    // AI 추가 질문과 답(미응답 포함) · 업무 · 문서 회신 · 첨부. 생성 모델명은 싣지 않는다.
    const expected: string[] = [
      TITLE,
      ...DECK_REVIEW.requirements.map((r: any) => r.text),
      ...DECK_REVIEW.areas.flatMap((a: any) => [a.summary, ...a.spec.map((x: any) => x.text), ...a.observations.map((x: any) => x.text)]),
      ...DECK_PHASES.map((p) => p[0]),
      `${String(DECK_MIN_WEEKS)}~${String(DECK_MAX_WEEKS)}주`,
      ...DECK_REVIEW.openQuestions.map((q: any) => q.question),
      '상담 결과: 12월 첫 주 정기 보수 기간에 펌프 2대 실측 가능',
      DECK_REVIEW.adminComment,
      DECK_AI_QUESTIONS.understood,
      ...DECK_AI_QUESTIONS.questions.map((q) => q.question),
      '평소 10분마다 요약값, 임계값을 넘으면 그 즉시 원본 2초 분량을 보내면 됩니다.',
      '답하지 않음',
      ...DECK_TASKS.map((t) => t.name),
      '계약·개발착수 확인',
      '무선 방식은 두 안의 전류 비교표를 받은 뒤 확정하겠습니다.',
      '정기 진행보고',
      ...FILES,
      '한빛설비',
    ];
    const flat = info.text.replace(/\s+/g, ' ');
    for (const text of expected) expect(flat, `출력물에 있어야 한다: ${text.slice(0, 40)}`).toContain(text.replace(/\s+/g, ' '));
    expect(info.text).not.toContain('e2e-model-hidden');
    expect(info.buttons, '출력물에 누를 것이 없다').toBe(0);
    expect(s.pageErrors).toEqual([]);
  }, LONG);

  test('3. 품질 — 넘친 장 0 · 글자 줄임 15% 이내 · 주요 장은 본문 40% 이상 · 장 1280×720', () => {
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.filter((x) => x.overflow).map((x) => x.page), '넘친 장').toEqual([]);
    expect([...new Set(slides.map((x) => x.size))]).toEqual(['1280x720']);
    // 실전 규모에서 글자를 크게 줄이는 장이 나오면 배분이 틀린 것이다(줄임은 8% 넘침까지만 쓰는 마지막 수단).
    const shrunk = slides.filter((x) => x.zoom < 0.85).map((x) => `${String(x.page)}쪽 ${x.title} ×${String(x.zoom)}`);
    expect(shrunk, '15% 넘게 줄인 장').toEqual([]);
    // '한 화면에 딱 담긴다' — 주제 장이 반도 안 차면 앞뒤 장에 합쳐야 한다. 첨부 · 세부 답변처럼 행 수가 적을 수 있는 표와
    // 이어지는 장의 마지막 조각은 빼고 본다.
    const main = ['overview', 'qa', 'summary', 'area', 'schedule', 'questions', 'tasks'];
    const sparse = slides
      .filter((x, i) => main.includes(x.kind) && x.fill !== null && x.fill < 0.4 && slides[i + 1]?.kind !== undefined && !(slides[i - 1]?.kind === x.kind && slides[i + 1]?.kind !== x.kind))
      .map((x) => `${String(x.page)}쪽 ${x.title} ${String(Math.round((x.fill ?? 0) * 100))}%`);
    expect(sparse, '본문이 40% 도 안 찬 주요 장').toEqual([]);
  });

  test('4. 인쇄 — 장 수 = PDF 쪽 수 · 용지 16:9 · 장마다 PNG', async () => {
    const page = s.page;
    rmSync(SHOT_DIR, { recursive: true, force: true }); // 지난 실행의 장(장 수가 달랐으면 이름이 섞인다)
    mkdirSync(SHOT_DIR, { recursive: true });
    const locator = page.locator('.develop-deck .deck-slide');
    const count = await locator.count();
    expect(count).toBe(slides.length);
    for (let i = 0; i < count; i += 1) {
      await locator.nth(i).screenshot({ path: join(SHOT_DIR, `${String(i + 1).padStart(2, '0')}-${slides[i]?.kind ?? 'slide'}.png`) });
    }
    // 배경 그래픽을 끈 기본 설정으로 뽑는다(옅은 파랑 바탕 · 표 머리줄은 print-color-adjust 로 찍힌다).
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    await page.emulateMedia({ media: 'screen' });
    writeFileSync(join(SHOT_DIR, 'print.pdf'), pdf);
    const raw = pdf.toString('latin1');
    expect((raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length, '장 수 = 인쇄 쪽 수').toBe(count);
    const box = (/\/MediaBox\s*\[([^\]]+)\]/.exec(raw)?.[1] ?? '').trim().split(/\s+/).map(Number);
    expect(box.slice(2).map((n) => Math.round(n)), '용지 = 13.333×7.5in').toEqual([960, 540]);
    expect(s.pageErrors).toEqual([]);
  }, LONG);

  // ── 의뢰 상세 — 같은 장을 탭 안에서 ──────────────────────────────────────────────
  interface StageInfo {
    page: number;
    count: number;
    scale: number;
    kind: string;
    title: string;
    overflow: boolean;
    inView: boolean;
    text: string;
    next: string;
  }
  const stageInfo = (): Promise<StageInfo> =>
    s.page.evaluate(() => {
      const stage = document.querySelector('[data-deck-stage]');
      const slide = stage?.querySelector('.deck-slide');
      const nav = document.querySelector('nav[aria-label="의뢰 상세 탭"]');
      const r = slide?.getBoundingClientRect();
      const n = nav?.getBoundingClientRect();
      return {
        page: Number(stage?.getAttribute('data-deck-page') ?? '0'),
        count: Number(/\/\s*(\d+)/.exec(stage?.querySelector('footer')?.textContent ?? '')?.[1] ?? '0'),
        scale: Number(stage?.getAttribute('data-deck-scale') ?? '0'),
        kind: slide?.getAttribute('data-deck-kind') ?? '',
        title: slide?.querySelector('h2')?.textContent?.trim() ?? '',
        overflow: slide?.hasAttribute('data-deck-overflow') ?? true,
        inView: r !== undefined && n !== undefined && r.top >= n.bottom - 1 && r.bottom <= window.innerHeight + 1,
        text: (slide?.textContent ?? '').replace(/\s+/g, ' '),
        next: stage?.querySelector('[data-deck="next"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
  // 탭을 열어 첫 장부터 끝 장까지 넘긴다 — 넘길 때마다 그 장이 탭 줄 아래 창 안에 통째로 들어와야 한다.
  const walk = async (hash: string, heading: string): Promise<StageInfo[]> => {
    const page = s.page;
    await page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}${hash}`);
    await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 }); // 넘겨 보는 중엔 화면에서만 숨긴 제목
    await page.locator('[data-deck-stage] .deck-slide').first().waitFor({ timeout: 20_000 });
    const first = await stageInfo();
    const seen = [first];
    for (let i = 2; i <= first.count; i += 1) {
      await page.locator('[data-deck="next"]').click();
      await expect.poll(async () => (await stageInfo()).page, { timeout: 10_000 }).toBe(i);
      await expect.poll(async () => (await stageInfo()).inView, { timeout: 10_000, message: `${hash} ${String(i)}번째 장이 창 안에` }).toBe(true);
      seen.push(await stageInfo());
    }
    return seen;
  };
  const flat = (text: string): string => text.replace(/\s+/g, ' ');

  test('5. 의뢰 상세(PC) — 읽는 탭 셋을 같은 장으로 넘겨 본다 · 문서 목록은 장 아래', async () => {
    const page = s.page;
    // 상세 의뢰 내용 — 의뢰 개요 + AI 추가 질문
    const content = await walk('#content', '1. 상세 의뢰 내용');
    expect(content.map((x) => x.kind)).toEqual(['overview', 'qa']);
    expect(content[0]?.text).toContain('한빛설비');
    expect(content[1]?.text).toContain(flat(DECK_AI_QUESTIONS.understood));
    expect(content.at(-1)?.next, '마지막 장의 다음 = 다음 탭').toContain('AI 사전 검토서');

    // AI 사전 검토서 — 출력물의 그 묶음과 같은 장
    const review = await walk('#review', '2. AI 사전 검토서');
    const printed = slides.filter((x) => ['summary', 'diagram', 'area', 'schedule', 'questions'].includes(x.kind));
    expect(review.map((x) => x.title), '출력물과 같은 장').toEqual(printed.map((x) => x.title));
    expect(review.every((x) => !x.overflow), '넘친 장 없음').toBe(true);
    expect(review[0]?.scale, '1440×900 에서는 줄이지 않는다').toBe(1);
    const reviewText = review.map((x) => x.text).join(' ');
    for (const text of [
      ...DECK_REVIEW.requirements.map((r: any) => r.text),
      ...DECK_REVIEW.areas.flatMap((a: any) => [...a.spec.map((x: any) => x.text), ...a.observations.map((x: any) => x.text)]),
      ...DECK_PHASES.map((p) => p[0]),
      ...DECK_REVIEW.openQuestions.map((q: any) => q.question),
      DECK_REVIEW.adminComment,
    ]) {
      expect(reviewText, `검토서 탭에 있어야 한다: ${String(text).slice(0, 40)}`).toContain(flat(String(text)));
    }
    expect(review.at(-1)?.next).toContain('견적서');
    // ← → 키로도 넘긴다
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await stageInfo()).page).toBe(review.length - 1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await stageInfo()).page).toBe(review.length);
    // 마지막 장의 다음 → 견적서 탭
    await page.locator('[data-deck="next"]').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#quotes');
    // 구성도 설명 — 기본 닫힘, 버튼으로 옆 판
    await page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}#review`);
    await page.locator('[data-deck-stage] .deck-slide').first().waitFor({ timeout: 20_000 });
    await page.locator('[data-deck="next"]').click();
    await page.locator('[data-deck="notes-toggle"]').waitFor();
    expect(await page.locator('[data-deck-overlay="notes"]').count(), '기본 닫힘').toBe(0);
    await page.locator('[data-deck="notes-toggle"]').click();
    const notes = page.locator('[data-deck-overlay="notes"]');
    for (const text of DECK_DIAGRAM_ONLY_TEXTS.slice(0, 4)) await notes.getByText(text, { exact: false }).first().waitFor();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('[data-deck-overlay="notes"]').count()).toBe(0);

    // 진행 현황 — 달성도 · 업무만 장으로, 문서 표는 싣지 않고 장 아래 문서 목록(본문 · 회신)이 그대로
    const progress = await walk('#documents', '4. 진행 현황 · 프로젝트 문서');
    expect([...new Set(progress.map((x) => x.kind))]).toEqual(['tasks']);
    const progressText = progress.map((x) => x.text).join(' ');
    for (const t of DECK_TASKS) expect(progressText).toContain(t.name);
    expect(await page.locator('[data-deck-stage] [data-deck-table="docs"]').count(), '문서 표는 장에 싣지 않는다').toBe(0);
    expect(await page.getByText('계약·개발착수 확인', { exact: true }).count(), '장 아래 문서 목록').toBeGreaterThan(0);
    expect(progress.at(-1)?.next).toContain('진행·문의');

    // 견적서 — 견적마다 요약 → 산출 내역. 수락 · 결제 · 받기는 장에 넣지 않고 장 아래 판에
    const quotes = await walk('#quotes', '3. 견적서');
    expect([...new Set(quotes.map((x) => x.kind))]).toEqual(['quote', 'quote-items']);
    expect(quotes[0]?.title).toBe(DECK_QUOTE.title);
    expect(quotes.every((x) => !x.overflow), '넘친 견적 장 없음').toBe(true);
    const quoteText = quotes.map((x) => x.text).join(' ');
    for (const it of DECK_QUOTE.items) expect(quoteText, `산출 내역: ${String(it.title)}`).toContain(flat(String(it.title)));
    for (const m of DECK_QUOTE.milestones) expect(quoteText, `결제 조건: ${String(m.title)}`).toContain(String(m.title));
    expect(await page.locator('[data-deck-stage] button', { hasText: /원 결제$/ }).count(), '장 안에 결제 단추 없음').toBe(0);
    expect(await page.locator('[data-deck-below] [data-quote-actions]').count(), '장 아래 수락 · 결제 판').toBe(1);
    expect(await page.locator('[data-quote-actions]').getByRole('link', { name: '인쇄용 보기' }).count()).toBe(1);
    expect(quotes.at(-1)?.next).toContain('진행 현황·문서');

    // 넘기지 않는 탭 — 장과 같은 폭 · 같은 왼쪽 선의 판(제목은 판이 갖는다)
    const stageBox = await page.locator('[data-deck-stage]').boundingBox();
    for (const [hash, heading, title] of [['#timeline', '5. 진행 · 문의', '진행 · 문의'], ['#files', '6. 첨부 자료', '첨부 자료']] as const) {
      await page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}${hash}`);
      await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 });
      const panel = page.locator('.deck-panel').first();
      await panel.waitFor();
      expect(await page.locator('[data-deck-stage]').count(), `${hash} 는 넘기지 않는다`).toBe(0);
      expect(await panel.locator('h3').first().innerText(), `${hash} 판 제목`).toBe(title);
      const box = await panel.boundingBox();
      expect(Math.round(box?.width ?? 0), `${hash} 판 폭 = 장 폭`).toBe(Math.round(stageBox?.width ?? -1));
      expect(Math.round(box?.x ?? 0), `${hash} 판 왼쪽 = 장 왼쪽`).toBe(Math.round(stageBox?.x ?? -1));
    }
    expect(s.pageErrors).toEqual([]);
  }, LONG);

  test('6. 의뢰 상세(390px) — 같은 덩어리를 세로 흐름으로 · 가로 넘침 0', async () => {
    const page = s.page;
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      const flowText = async (hash: string, heading: string): Promise<string> => {
        await page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}${hash}`);
        await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 });
        await page.locator('.deck-flow').first().waitFor({ timeout: 20_000 });
        expect(await page.locator('[data-deck-stage]').count(), `${hash} 좁은 화면은 넘겨 보기가 아니다`).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${hash} 가로 넘침`).toBeLessThanOrEqual(390);
        return flat(await page.locator('.develop-deck').innerText());
      };
      const content = await flowText('#content', '1. 상세 의뢰 내용');
      for (const text of ['한빛설비', DECK_AI_QUESTIONS.understood, ...DECK_AI_QUESTIONS.questions.map((q) => q.question)]) expect(content).toContain(flat(text));

      const review = await flowText('#review', '2. AI 사전 검토서');
      for (const text of [
        ...DECK_REVIEW.requirements.map((r: any) => r.text),
        ...DECK_REVIEW.areas.flatMap((a: any) => a.spec.map((x: any) => x.text)),
        ...DECK_PHASES.map((p) => p[0]),
        ...DECK_REVIEW.openQuestions.map((q: any) => q.question),
      ]) {
        expect(review, `세로 흐름에 있어야 한다: ${String(text).slice(0, 40)}`).toContain(flat(String(text)));
      }
      // 구성도 설명 — 그 자리에서 펼치고 접는다(기본 접힘)
      expect(await page.locator('[data-deck="notes"]').count()).toBe(0);
      const toggle = page.locator('[data-deck="notes-toggle"]').first();
      await toggle.click();
      await page.locator('[data-deck="notes"]').first().getByText('확정된 구성').waitFor();
      await toggle.click();
      await expect.poll(() => page.locator('[data-deck="notes"]').count()).toBe(0);

      const progress = await flowText('#documents', '4. 진행 현황 · 프로젝트 문서');
      for (const t of DECK_TASKS) expect(progress).toContain(t.name);

      // 견적서 — 견적 판(요약 · 산출 내역) 뒤에 그 견적의 수락 · 결제 판
      const quotes = await flowText('#quotes', '3. 견적서');
      for (const it of DECK_QUOTE.items) expect(quotes).toContain(flat(String(it.title)));
      expect(await page.locator('.deck-flow').evaluateAll((els) => els.map((el) => el.getAttribute('data-deck-kind')))).toEqual(['quote', 'quote-items']);
      expect(await page.locator('.develop-deck [data-quote-actions]').count(), '견적 판 뒤 수락 · 결제 판').toBe(1);
      // 진행·문의 · 첨부 — 판, 가로 넘침 0
      for (const [hash, heading] of [['#timeline', '5. 진행 · 문의'], ['#files', '6. 첨부 자료']] as const) {
        await page.goto(`/develop/requests/${String(rid)}?_t=${String(Date.now())}${hash}`);
        await page.getByRole('heading', { name: heading }).waitFor({ timeout: 20_000 });
        await page.locator('.deck-panel').first().waitFor();
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${hash} 가로 넘침`).toBeLessThanOrEqual(390);
      }
      expect(s.pageErrors).toEqual([]);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }, LONG);
});
