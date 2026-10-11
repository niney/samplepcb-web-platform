// EQ 문항형 회차(D20 P2) — **AI 분석의 관리자 화면**을 주행한다.
//
// 협력사가 승인요청을 누르면 서버가 EQ 엑셀을 자동 분석해 문항 초안을 만든다(유스케이스 pcb.eq-parse 가 켜져 있을 때).
// 이 주행은 그 잡이 관리자에게 어떻게 보이는지를 본다 — 대부분 **LLM 없이**:
//   P1 유스케이스 꺼짐 → 새 회차 카드의 [AI 분석] 비활성 + 설정 안내(링크)
//   P2 설정 > AI 연동에서 'PCB EQ 분석' 토글 저장
//   P3 켠 뒤 엑셀이 아닌(.txt) EQ 로 승인요청 → 행·워크큐 칩 "AI 분석 안 됨" + 작업공간 띠(사유) + [AI 다시 분석]·[직접 작성]
//   P4 문항의 AI 검토 표시(aiFlags) — 목록 배지·편집기 표시 상자·[확인함]·저장이 **남은 표시를 실어 보낸다**·보내기 경고
//   P4c 분석이 됐을 때의 주의 문구(ai.detail) — 완료 잡 행을 직접 넣어 **서버가 만든 문구**가 주의 띠에 그대로 뜨는지
//   P5 (옵트인 EQ_AI_E2E=1, 실 LLM) 합성 픽스처 엑셀로 승인요청 → "AI 분석 중" → "AI 초안 · 검토 필요" → 문항·그림·활동
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items-ai-admin
//       실 LLM 경로까지: … cross-env PORTAL_E2E=1 EQ_AI_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items-ai-admin
// 사전: API(3333)·web(5173, nginx 통합 도메인)·파일서버 · e2e/.env.e2e 고객 아이디. P5 는 AI 연결(설정 > AI 연동)까지.
// 유스케이스 on/off·모델 등 설정은 **원래 값으로 되돌린다**. 무대는 e2e 소유 픽스처로 세우고 이 주행이 만든 것만 지운다.
// ⚠ pcb.eq-parse 설정은 전역 하나다 — 같은 설정을 켰다 끄는 다른 주행(journey-eq-items-ai)과 **따로 띄워 동시에**
//   돌리면 서로의 '원래 값'을 잘못 읽고 중간에 꺼 버린다(2026-10-11 실측). 한 vitest 실행에 함께 넣으면 파일이
//   차례로 돌아 겹치지 않는다. 각 단계는 켜짐을 다시 확인하고 시작한다(멱등).
// 화면 캡처: <리포>/.tmp/eq-admin-shots/20-ai-*.png …
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  apiDir,
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
  monoRoot,
  newSession,
  requireCustomerCreds,
  signJwt,
  type E2eSession,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const OWNER = '협력2';
const SHOTS = join(monoRoot, '..', '.tmp', 'eq-admin-shots');
/** 실 LLM 경로 옵트인 — 꺼져 있으면 P5 는 건너뛴다(분석 한 번에 10~20초, 모델 호출 비용). */
const EQ_AI = process.env.EQ_AI_E2E === '1';
const FIXTURE_XLSX = join(apiDir, 'src', 'lib', 'pcb-eq-extract', '__fixtures__', 'a-lhd-bilingual.xlsx');
/** 계약 PCB_EQ_AI_FAIL_LABELS.unsupported_file — 화면이 이 문구를 그대로 낸다. */
const UNSUPPORTED_LABEL = '엑셀(.xls·.xlsx·.zip)이 아니라 자동 분석하지 못했습니다';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 조건이 참이 될 때까지 — playwright-core 엔 expect 자동 대기가 없다. 실패하면 마지막 관찰을 싣는다. */
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
    await sleep(300);
  }
}
const textOf = async (loc: Locator): Promise<string> => ((await loc.count()) === 0 ? '' : await loc.first().innerText());
const untilText = (what: string, loc: Locator, needle: string, timeoutMs = 15_000): Promise<void> =>
  until(`${what} — "${needle}"`, async () => (await textOf(loc)).includes(needle), timeoutMs, () => textOf(loc));

describe.skipIf(!RUN)('EQ 문항형 회차(D20 P2) — AI 분석의 관리자 화면', () => {
  let owner: PartnerFixture;
  let A = '';
  let P = '';
  let customerId = '';
  let order: G5OrderFixture | undefined;
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  const seeded: bigint[] = [];
  const startedAt = new Date();
  const token = `e2eeqai${String(Date.now())}`;
  let admin!: E2eSession;
  let page!: Page;
  /** 주행 전 유스케이스 설정 — afterAll 이 그대로 되돌린다. */
  let originalUsecase: { enabled: boolean; model: string; think: string; extraInstructions: string } | null = null;
  let r1 = 0;

  const adminBase = (): string => `/api/admin/pcb-eq-reviews/${String(poId)}`;
  const eqList = async (): Promise<any> => {
    const res = await api(A, 'GET', adminBase());
    expect(res.status, `회차 목록: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data;
  };
  const poRow = async (): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-projects/${specId.toString()}/pos`);
    expect(res.status, `발주 목록: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.pos ?? []).find((p: any) => p.poId === poId) ?? null;
  };
  const aiSettings = async (): Promise<any> => {
    const res = await api(A, 'GET', '/api/admin/settings/ai');
    expect(res.status, `AI 설정: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data;
  };
  const setUsecase = async (patch: { enabled: boolean }): Promise<void> => {
    if (originalUsecase === null) throw new Error('원래 설정을 읽기 전에는 바꾸지 않는다');
    const res = await api(A, 'PATCH', '/api/admin/settings/ai', {
      pcbEqParse: { ...originalUsecase, enabled: patch.enabled },
    });
    expect(res.status, `유스케이스 저장: ${JSON.stringify(res.json)}`).toBe(200);
  };

  const uploadEq = async (name: string, type: string, bytes: Uint8Array): Promise<void> => {
    const form = new FormData();
    form.set('fileType', 'eq');
    form.set('file', new File([new Uint8Array(bytes)], name, { type }));
    const res = await fetch(`${API_URL}/api/partner/pcb-pos/${String(poId)}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: form,
    });
    expect(res.status, `EQ 업로드 ${name}`).toBe(200);
  };
  const eqRequest = async (): Promise<void> => {
    const res = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(res.status, `승인요청: ${JSON.stringify(res.json)}`).toBe(200);
  };
  const eqReject = async (reason: string): Promise<void> => {
    const res = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, { reason });
    expect(res.status, `반려: ${JSON.stringify(res.json)}`).toBe(200);
  };

  const shot = async (name: string): Promise<void> => {
    await sleep(400); // 패널 미끄러짐·확인창 페이드가 끝난 뒤
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  };
  /** 발주 행 캡처 — 행이 화면 아래에 걸려 있으면 칩이 잘린다. */
  const shotRow = async (name: string): Promise<void> => {
    await rowChip().scrollIntoViewIfNeeded();
    await shot(name);
  };
  const ws = (): Locator => page.locator('[data-eq-workspace]');
  const footer = (): Locator => ws().locator('footer');
  const banner = (): Locator => ws().locator('[data-eq-ai-banner]');
  const confirmAlert = (): Locator => page.getByRole('alertdialog');
  const rowChip = (): Locator => page.locator('[data-eq-row-chip]').first();
  const openCase = async (): Promise<void> => {
    await page.goto(`${BASE_URL}/app/admin/pcb/cases/${specId.toString()}?_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /EQ 열기|작성 이어가기/ }).first().waitFor({ state: 'visible', timeout: 30_000 });
  };
  const openWorkspace = async (): Promise<void> => {
    await rowChip().getByRole('button').first().click();
    await ws().waitFor({ state: 'visible' });
  };
  const closeWorkspace = async (): Promise<void> => {
    await footer().getByRole('button', { name: '닫기', exact: true }).click();
    await ws().waitFor({ state: 'hidden' });
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mkdirSync(SHOTS, { recursive: true });

    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    customerId = requireCustomerCreds(1).id;

    const settings = await aiSettings();
    if (settings?.pcbEqParse === undefined) throw new Error('AI 설정 응답에 pcbEqParse 가 없습니다 — D20 P2 백엔드 반영 전');
    originalUsecase = {
      enabled: settings.pcbEqParse.enabled,
      model: settings.pcbEqParse.model,
      think: settings.pcbEqParse.think,
      extraInstructions: settings.pcbEqParse.extraInstructions,
    };
    // P1 은 꺼진 상태에서 시작한다(승인요청이 분석을 띄우지 않는다).
    await setUsecase({ enabled: false });

    order = await createG5OrderFixture(customerId, 'e2e EQ AI 분석 화면');
    projectName = `E2E-EQAI-${token}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);

    // 엑셀이 아닌 EQ — 유스케이스가 켜져 있으면 LLM 을 부르기 전에 '지원하지 않는 파일'로 끝난다.
    await uploadEq('EQ-notes.txt', 'text/plain', new TextEncoder().encode(`EQ notes ${token}`));
    await eqRequest();

    admin = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    page = admin.page;
  }, 120_000);

  afterAll(async () => {
    await admin?.close().catch(() => undefined);
    await closeBrowser();
    const prisma = getPrisma();
    // 설정을 원래대로 — 주행이 실패해도 되돌린다. API 가 죽어 있어도(개발 서버 재시작 중) 켜진 채 남기지 않게
    // DB 로 한 번 더 되돌리고, 되돌리기가 실패해도 아래 픽스처 정리는 계속한다(2026-10-11 실측: 재시작에 걸려
    // PATCH 가 던지면서 정리 전체가 건너뛰어졌다).
    let restored = false;
    if (originalUsecase !== null) {
      const res = await api(A, 'PATCH', '/api/admin/settings/ai', { pcbEqParse: originalUsecase }).catch(() => null);
      restored = res?.status === 200;
      if (!restored) {
        await prisma.spAiUsecase
          .updateMany({
            where: { useCase: 'pcb.eq-parse' },
            data: {
              enabled: originalUsecase.enabled,
              model: originalUsecase.model,
              think: originalUsecase.think,
              extraInstructions: originalUsecase.extraInstructions,
            },
          })
          .catch(() => undefined);
      }
    }
    if (poId > 0) {
      const reviews = await prisma.spPcbEqReview.findMany({ where: { poId: BigInt(poId) }, select: { id: true } });
      if (reviews.length > 0) {
        await prisma.spFile.deleteMany({
          where: { refType: 'sp_pcb_eq_review', refId: { in: reviews.map((r: any) => r.id) } },
        });
      }
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) } });
      // 이 발주서의 AI 분석 잡(sp_ai_job target=발주서)도 이 주행의 것이다.
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
    expect((await countPcbResidue(seeded)).pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spPcbEqReview.count({ where: { poId: BigInt(poId) } }), '회차 잔재').toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    // 원복 확인은 DB 로 읽는다 — API 가 죽어 있어도 단언이 던져서 뒤가 건너뛰어지지 않게.
    const usecase = await prisma.spAiUsecase.findUnique({ where: { useCase: 'pcb.eq-parse' }, select: { enabled: true } });
    await disconnectPrisma();
    if (originalUsecase !== null) {
      expect(usecase?.enabled, `유스케이스 on/off 원복(${restored ? 'API' : 'DB'})`).toBe(originalUsecase.enabled);
    }
  }, 60_000);

  test('P1. 유스케이스 꺼짐 — 승인요청이 분석을 띄우지 않고, [AI 분석]은 설정 안내만 한다', async () => {
    const list = await eqList();
    expect(list.aiEnabled, '목록 응답 aiEnabled').toBe(false);
    expect(list.ai, '꺼져 있으면 잡이 없다').toBeNull();
    expect((await poRow())?.eqAi ?? null, '행 요약도 없다').toBeNull();

    await openCase();
    expect(await rowChip().innerText(), '칩 없이 [EQ 열기]만').not.toContain('AI 분석');
    await openWorkspace();
    const card = ws().locator('[data-eq-new-round]');
    await card.waitFor({ state: 'visible' });
    expect(await card.locator('[data-eq-ai-analyze]').isDisabled(), '[AI 분석] 비활성').toBe(true);
    const hint = card.locator('[data-eq-ai-disabled]');
    expect(await hint.innerText()).toContain('AI 분석이 꺼져 있습니다');
    expect(await hint.getByRole('link').getAttribute('href'), '설정 > AI 연동 링크').toContain('/admin/settings?tab=aiIntegration');
    expect(await banner().count(), '분석이 없으면 띠도 없다').toBe(0);
    await shot('20-ai-disabled');
    await closeWorkspace();
  });

  test('P2. 설정 > AI 연동 — "PCB EQ 분석" 구역을 켜고 저장', async () => {
    await page.goto(`${BASE_URL}/app/admin/settings?tab=aiIntegration&_t=${String(Date.now())}`, { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('#ai-eqp-enabled');
    await toggle.waitFor({ state: 'visible', timeout: 30_000 });
    const section = page.locator('section, div', { has: toggle }).filter({ hasText: 'pcb.eq-parse' }).last();
    expect(await section.innerText()).toContain('PCB EQ 분석');
    expect(await section.innerText()).toContain('고객 발송은 관리자 검토 뒤');
    expect(await toggle.getAttribute('aria-checked'), '꺼진 채 시작').toBe('false');
    await toggle.click();
    expect(await toggle.getAttribute('aria-checked')).toBe('true');
    await toggle.scrollIntoViewIfNeeded();
    await shot('21-ai-settings');
    await page.locator('form').getByRole('button', { name: '저장', exact: true }).click();
    await until('유스케이스 켜짐 저장', async () => (await aiSettings()).pcbEqParse.enabled === true);
    const saved = await aiSettings();
    expect(saved.pcbEqParse.model, '모델은 그대로').toBe(originalUsecase?.model);
    expect(saved.pcbEqParse.think, 'thinking 은 그대로').toBe(originalUsecase?.think);
  });

  test('P3. 켠 뒤 엑셀이 아닌 EQ 로 승인요청 — 행·워크큐 칩 "AI 분석 안 됨", 작업공간 띠에 사유와 다음 행동', async () => {
    // 같은 발주서를 반려 → 재요청: 이번 승인요청은 유스케이스가 켜져 있어 자동 분석이 돈다(.txt → 지원하지 않는 파일).
    await setUsecase({ enabled: true });
    await eqReject('e2e — AI 분석 재요청');
    await eqRequest();
    await until('분석 실패 기록', async () => (await poRow())?.eqAi?.status === 'failed', 60_000, async () =>
      JSON.stringify((await poRow())?.eqAi ?? null),
    );
    expect((await poRow()).eqAi).toMatchObject({ status: 'failed', reason: 'unsupported_file' });
    const list = await eqList();
    expect(list.aiEnabled).toBe(true);
    expect(list.ai).toMatchObject({ status: 'failed', reason: 'unsupported_file', trigger: 'auto', appliedReviewId: null });
    expect(list.reviews, '실패하면 초안이 없다').toEqual([]);

    await openCase();
    await untilText('행 칩', rowChip(), 'AI 분석 안 됨');
    expect(await rowChip().locator('[title]').first().getAttribute('title'), '칩 툴팁 = 사유').toContain(UNSUPPORTED_LABEL);
    await shotRow('22-ai-failed-row');

    await openWorkspace();
    await banner().waitFor({ state: 'visible' });
    expect(await banner().getAttribute('data-eq-ai-kind')).toBe('failed');
    expect(await banner().locator('[data-eq-ai-reason]').innerText()).toContain(UNSUPPORTED_LABEL);
    expect(await banner().getByRole('button', { name: 'AI 다시 분석' }).isEnabled()).toBe(true);
    expect(await banner().getByRole('button', { name: '직접 작성' }).count()).toBe(1);
    // 켜져 있으니 새 회차 카드의 [AI 분석]도 살아 있다.
    expect(await ws().locator('[data-eq-ai-analyze]').isEnabled(), '[AI 분석] 활성').toBe(true);
    expect(await ws().locator('[data-eq-ai-disabled]').count(), '설정 안내는 사라진다').toBe(0);
    await shot('23-ai-failed-banner');

    // [AI 다시 분석] — 잡을 다시 띄운다(같은 .txt 라 다시 '안 됨'으로 끝난다). 분석 중에는 목록을 다시 읽는다.
    const firstJob = list.ai.jobId as string;
    await banner().getByRole('button', { name: 'AI 다시 분석' }).click();
    await until(
      '재분석 종료',
      async () => {
        const now = (await eqList()).ai;
        return now !== null && now.status === 'failed' && now.jobId !== firstJob;
      },
      60_000,
      async () => JSON.stringify((await eqList()).ai),
    );
    expect((await eqList()).ai).toMatchObject({ trigger: 'manual', reason: 'unsupported_file' });
    await until('띠가 다시 안 됨', async () => (await banner().getAttribute('data-eq-ai-kind')) === 'failed', 30_000);

    // 워크큐도 같은 칩.
    await closeWorkspace();
    await page.goto(`${BASE_URL}/app/admin/pcb/pos?tab=eq_pending&q=${encodeURIComponent(projectName)}&_t=${String(Date.now())}`, {
      waitUntil: 'domcontentloaded',
    });
    const queueRow = page.locator('tr', { hasText: projectName }).first();
    await queueRow.waitFor({ state: 'visible', timeout: 30_000 });
    await untilText('워크큐 칩', queueRow, 'AI 분석 안 됨');
    await shot('24-ai-failed-workqueue');

    // [직접 작성] → 초안. 초안이 생기면 행 칩은 회차 칩이 우선이다(실패 칩은 초안이 없을 때만).
    await openCase();
    await openWorkspace();
    await banner().getByRole('button', { name: '직접 작성' }).click();
    await untilText('작성 중', ws().locator('[data-eq-round-status]'), '작성 중');
    const draft = (await eqList()).reviews.find((r: any) => r.status === 'draft');
    expect(draft, '직접 작성 초안').toMatchObject({ format: 'items', aiDraft: false, roundNo: 1 });
    r1 = Number(draft.id);
    await closeWorkspace();
    await untilText('행 칩은 회차 칩', rowChip(), 'EQ 1차 · 작성 중');
    expect(await rowChip().innerText()).not.toContain('AI 분석 안 됨');
  });

  test('P4. AI 검토 표시 — 목록 배지·편집기 [확인함]·저장은 남은 표시를 실어 보내고, 보내기 전에 경고한다', async () => {
    // AI 초안이 붙였을 표시를 API 로 넣는다(저장 PUT 이 aiFlags 를 받는다) — 화면은 표시가 어디서 왔는지 가리지 않는다.
    const before = (await eqList()).reviews.find((r: any) => r.id === r1);
    const put = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: before.version,
      message: '',
      dueOn: null,
      items: [
        {
          factoryNo: '1',
          category: 'drill',
          question: '0.2mm 비아를 키워도 될까요?',
          questionOrig: '0.2mm孔径加大到0.25mm可以吗？',
          options: [
            { key: 'A', label: '키워도 됩니다', labelOrig: '可以', recommended: true, requiresComment: false },
            { key: 'B', label: '안 됩니다', labelOrig: '不可以', recommended: false, requiresComment: false },
          ],
          figures: [],
          prevItemId: null,
          change: null,
          aiFlags: [
            { code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' },
            { code: 'structure', detail: '템플릿 파서는 선택지 3개, AI 는 2개로 읽었습니다' },
          ],
        },
        {
          factoryNo: '2',
          category: 'marking',
          question: `UL 마킹을 넣을까요? (${token})`,
          questionOrig: '是否加UL标记？',
          options: [{ key: 'A', label: '넣지 않음', labelOrig: '不加', recommended: false, requiresComment: false }],
          figures: [],
          prevItemId: null,
          change: null,
          aiFlags: [{ code: 'figure', detail: '图 2 는 EMF 형식이라 올리지 않았습니다' }],
        },
      ],
    });
    expect(put.status, `표시 넣기: ${JSON.stringify(put.json)}`).toBe(200);
    expect(put.json.data.review.items.map((i: any) => i.aiFlags.map((f: any) => f.code))).toEqual([
      ['translation', 'structure'],
      ['figure'],
    ]);

    await openCase();
    await openWorkspace();
    const w = ws();
    await untilText('문항 1 표시 배지', w.locator('[data-eq-item="1"] [data-eq-item-flags]'), '번역 확인 필요');
    expect(await w.locator('[data-eq-item="1"] [data-eq-item-flags]').innerText()).toContain('구조 확인 필요');
    expect(await w.locator('[data-eq-item="2"] [data-eq-item-flags]').innerText()).toContain('그림 확인 필요');
    const box = w.locator('[data-eq-ai-flags]');
    expect(await box.innerText()).toContain('AI 검토 표시 2건');
    expect(await box.innerText()).toContain('원문의 0.25mm 가 번역에 없습니다');
    expect(await footer().innerText()).toContain('확인 안 한 AI 표시 3');
    await shot('25-ai-flags');

    // [확인함] — 그 표시만 버퍼에서 빠진다. 저장은 **남은 표시를 실어** 보낸다(안 실으면 서버가 전부 지운다).
    await box.getByRole('button', { name: '번역 확인 필요 확인함' }).click();
    await untilText('표시 1건 남음', box, 'AI 검토 표시 1건');
    await untilText('저장 안 된 변경', footer(), '저장 안 된 변경');
    await footer().getByRole('button', { name: '임시저장' }).click();
    await until('표시 저장', async () => {
      const now = (await eqList()).reviews.find((r: any) => r.id === r1);
      return now.items[0].aiFlags.length === 1;
    });
    const saved = (await eqList()).reviews.find((r: any) => r.id === r1);
    expect(saved.items.map((i: any) => i.aiFlags.map((f: any) => f.code)), '확인한 것만 지워지고 나머지는 남는다').toEqual([
      ['structure'],
      ['figure'],
    ]);

    // 보내기 확인창 — 확인 안 한 표시가 남아 있다고 알린다(막지는 않는다). 여기서는 보내지 않는다.
    await until('저장 뒤 dirty 해제', async () => !(await footer().innerText()).includes('저장 안 된 변경'));
    await footer().getByRole('button', { name: '고객에게 보내기' }).click();
    await confirmAlert().waitFor({ state: 'visible' });
    const ask = await confirmAlert().innerText();
    expect(ask).toContain('확인 안 한 AI 표시 2건(문항 1·2)');
    expect(await confirmAlert().getByRole('button', { name: '고객에게 보내기' }).isEnabled(), '막지는 않는다').toBe(true);
    await shot('26-ai-send-warning');
    await confirmAlert().getByRole('button', { name: '취소' }).click();
    await confirmAlert().waitFor({ state: 'hidden' });
    expect((await eqList()).reviews.find((r: any) => r.id === r1).status, '취소하면 그대로 초안').toBe('draft');
    await closeWorkspace();
    expect(admin.pageErrors, '페이지 오류').toEqual([]);
  });

  test('P4b. (응답 덧씌우기) 분석 중은 보는 동안만 다시 읽고, 결과 준비는 초안에 적용을 묻고, AI 초안은 배지로 가른다', async () => {
    // LLM 없이는 '분석 중'·'결과 준비'·'AI 초안'이 서버에 생기지 않는다 — 실제 응답 위에 그 상태만 덧씌워 화면 규칙을 본다
    // (서버 데이터는 건드리지 않는다). 실 경로는 P5(옵트인)가 끝까지 간다.
    await setUsecase({ enabled: true });
    const fakeAi = (over: Record<string, unknown>): Record<string, unknown> => ({
      jobId: `e2e-fake-${token}`,
      status: 'running',
      trigger: 'manual',
      reason: null,
      detail: null,
      model: 'e2e-fake-model',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      appliedReviewId: null,
      ...over,
    });
    const overlay: {
      ai?: Record<string, unknown> | undefined;
      review?: Record<string, unknown> | undefined;
      row?: ((po: any) => any) | undefined;
      listGets: number;
      posGets: number;
      analyzeBodies: any[];
    } = { listGets: 0, posGets: 0, analyzeBodies: [] };
    /** 분석이 됐을 때 서버가 잡에 남기는 주의 문구(ai.detail) — 초안 위 주의 띠의 원문. */
    const CAUTION = '표에는 있는데 AI 가 빠뜨렸을 수 있는 문항 3';
    const listUrl = `**/api/admin/pcb-eq-reviews/${String(poId)}`;
    const posUrl = `**/api/admin/pcb-projects/${specId.toString()}/pos`;
    const analyzeUrl = `**/api/admin/pcb-eq-reviews/${String(poId)}/ai-analyze`;
    await page.route(listUrl, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      overlay.listGets += 1;
      const res = await route.fetch();
      const json = await res.json();
      if (overlay.ai !== undefined) json.data.ai = overlay.ai;
      if (overlay.review !== undefined) {
        json.data.reviews = json.data.reviews.map((r: any) => (r.id === r1 ? { ...r, ...overlay.review } : r));
      }
      await route.fulfill({ response: res, json });
    });
    await page.route(posUrl, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      overlay.posGets += 1;
      const res = await route.fetch();
      const json = await res.json();
      if (overlay.row !== undefined) json.data.pos = json.data.pos.map((p: any) => (p.poId === poId ? overlay.row?.(p) : p));
      await route.fulfill({ response: res, json });
    });
    await page.route(analyzeUrl, async (route) => {
      overlay.analyzeBodies.push(route.request().postDataJSON());
      // 같은 파일의 최근 결과를 바로 적용한 경우(잡 재사용) — done·적용됨으로 돌아온다.
      overlay.ai = fakeAi({ status: 'done', finishedAt: new Date().toISOString(), appliedReviewId: r1, detail: CAUTION });
      overlay.review = { aiDraft: true };
      overlay.row = (p) => ({ ...p, eqAi: null, eqReview: { ...p.eqReview, aiDraft: true } });
      await route.fulfill({ status: 202, json: { result: true, data: { ai: overlay.ai } } });
    });

    try {
      // ① 행 칩 'AI 분석 중' — 분석 중인 줄이 있는 동안만 발주 목록을 다시 읽고, 끝나면 멈춘다.
      overlay.row = (p) => ({ ...p, eqReview: null, eqAi: { status: 'running', reason: null, at: new Date().toISOString() } });
      await openCase();
      await untilText('행 칩 분석 중', rowChip(), 'AI 분석 중');
      await shotRow('27-ai-running-row');
      const pos0 = overlay.posGets;
      await until('분석 중이면 행을 다시 읽는다', () => Promise.resolve(overlay.posGets >= pos0 + 1), 12_000);
      overlay.row = undefined;
      await untilText('분석이 끝나면 회차 칩', rowChip(), 'EQ 1차 · 작성 중', 12_000);
      const pos1 = overlay.posGets;
      await sleep(6_500);
      expect(overlay.posGets, '분석 중인 줄이 없으면 다시 읽지 않는다').toBe(pos1);

      // ② 작업공간 띠 '분석 중' — 열려 있는 동안만 목록을 다시 읽는다.
      overlay.ai = fakeAi({ status: 'running' });
      await openWorkspace();
      await until('분석 중 띠', async () => (await banner().getAttribute('data-eq-ai-kind')) === 'running');
      expect(await banner().innerText()).toContain('AI 가 EQ 파일을 분석 중입니다');
      await shot('28-ai-running-banner');
      const list0 = overlay.listGets;
      await until('열려 있으면 다시 읽는다', () => Promise.resolve(overlay.listGets >= list0 + 2), 15_000);
      await closeWorkspace();
      const list1 = overlay.listGets;
      await sleep(6_000);
      expect(overlay.listGets, '닫혀 있으면 폴링하지 않는다').toBe(list1);

      // ③ 결과 준비(관리자가 먼저 초안을 열었다) → [AI 결과를 초안에 적용] — 저장 안 된 변경까지 사라진다고 묻는다.
      overlay.ai = fakeAi({ status: 'done', finishedAt: new Date().toISOString(), appliedReviewId: null });
      await openWorkspace();
      await until('결과 준비 띠', async () => (await banner().getAttribute('data-eq-ai-kind')) === 'ready');
      await ws().locator('#eq-round-message').fill(`버릴 머리말 ${token}`);
      await untilText('저장 안 된 변경', footer(), '저장 안 된 변경');
      await shot('29-ai-ready-banner');
      await banner().getByRole('button', { name: 'AI 결과를 초안에 적용' }).click();
      await confirmAlert().waitFor({ state: 'visible' });
      const ask = await confirmAlert().innerText();
      expect(ask).toContain('AI 분석 결과로 통째로 바뀝니다');
      expect(ask).toContain('저장 안 된 변경이 사라집니다');
      await shot('30-ai-apply-confirm');
      await confirmAlert().getByRole('button', { name: 'AI 결과로 바꾸기' }).click();
      await confirmAlert().waitFor({ state: 'hidden' });
      await until('적용 요청', () => Promise.resolve(overlay.analyzeBodies.length === 1));
      expect(overlay.analyzeBodies[0], '열린 초안이 있으면 replaceDraft').toEqual({ replaceDraft: true });

      // ④ AI 초안 — 띠는 사라지고 머리 배지·행 칩이 'AI 초안 · 검토 필요'로 가른다. 버린 변경은 남지 않는다.
      await untilText('머리 배지', ws().locator('[data-eq-round-status]'), 'AI 초안 · 검토 필요');
      await until('잡 띠는 사라지고 주의만', async () => (await banner().getAttribute('data-eq-ai-kind')) === 'none');
      // 분석은 됐지만 서버가 주의 문구를 남겼다 — 초안 위에 주의 띠가 서고, 닫으면 같은 분석에 대해 다시 뜨지 않는다.
      const caution = ws().locator('[data-eq-ai-caution]');
      expect(await caution.innerText()).toContain(`AI 분석 주의: ${CAUTION} — 원본 EQ 와 대조해 주세요.`);
      expect(await ws().locator('#eq-round-message').inputValue(), '저장 안 된 변경은 버려졌다').toBe('');
      expect(await ws().getByRole('button', { name: 'AI 다시 분석' }).count(), '초안 머리의 [AI 다시 분석]').toBe(1);
      await shot('31-ai-draft-badge');
      await caution.getByRole('button', { name: 'AI 분석 주의 닫기' }).click();
      await until('주의 띠 닫힘', async () => (await banner().count()) === 0);
      await closeWorkspace();
      await untilText('행 칩 AI 초안', rowChip(), 'EQ 1차 · AI 초안 · 검토 필요');
      await shotRow('32-ai-draft-row');
      await openWorkspace();
      await untilText('다시 열어도 배지', ws().locator('[data-eq-round-status]'), 'AI 초안 · 검토 필요');
      expect(await banner().count(), '닫은 주의는 다시 열어도 안 뜬다').toBe(0);
      await closeWorkspace();
    } finally {
      await page.unroute(listUrl);
      await page.unroute(posUrl);
      await page.unroute(analyzeUrl);
    }
    // 덧씌우기였을 뿐 — 서버의 초안·분석 상태는 그대로다.
    const after = await eqList();
    expect(after.ai).toMatchObject({ status: 'failed' });
    expect(after.reviews.find((r: any) => r.id === r1)).toMatchObject({ status: 'draft', aiDraft: false });
    expect(admin.pageErrors, '페이지 오류').toEqual([]);
  }, 180_000);

  test('P4c. 분석 주의(ai.detail) — 서버가 잡의 주의 사항으로 만든 문구가 초안 위 주의 띠에 그대로 뜨고, 닫을 수 있다', async () => {
    // 분석이 **됐을 때의 주의**는 모델 출력·추출 경고에 달려 있어 픽스처로는 나오지 않는다 — 이번 승인요청 뒤에 완료 잡
    // 행을 직접 넣는다(LLM 없음). 문구는 서버가 진짜 경로(toEqAiState)로 만든다: 여러 건은 ' · ' 로 잇고 300자에서 자른다.
    // 유스케이스 on/off 와 무관하다(목록의 `ai` 는 발주가 승인요청 중이고 이번 요청 뒤의 최신 잡이면 실린다).
    const W1 = '표 규칙으로는 문항 5 도 읽혔으나 AI 초안에 없습니다 — 빠진 문항이 없는지 확인해 주세요';
    const W2 = `AI 출력 정리: 선택지 기호를 원문대로 되돌렸습니다(${token})`;
    const jobId = randomUUID();
    const metaOf = (warnings: string[]): string =>
      JSON.stringify({
        v: 1,
        trigger: 'auto',
        sourceFileId: 0,
        sourceFileName: 'EQ.xlsx',
        replaceDraft: false,
        actorMbId: null,
        detail: null,
        appliedReviewId: r1,
        skipped: null,
        responses: [],
        draft: null,
        itemFlags: [],
        promptChars: null,
        warnings,
      });
    const prisma = getPrisma();
    await prisma.spAiJob.create({
      data: {
        id: jobId,
        useCase: 'pcb.eq-parse',
        targetType: 'pcb_po',
        targetId: BigInt(poId),
        mbId: 'system',
        status: 'done',
        stage: null,
        model: 'kimi-k3',
        promptVersion: 'eq-parse-v3',
        inputHash: 'e2e',
        startedAt: new Date(),
        finishedAt: new Date(),
        resultJson: metaOf([W1, W2]),
      },
    });
    try {
      const list = await eqList();
      expect(list.ai, '이번 요청의 최신 잡').toMatchObject({ jobId, status: 'done', reason: null, appliedReviewId: r1 });
      expect(list.ai.detail, "주의 사항은 ' · ' 로 이어 한 줄").toBe(`${W1} · ${W2}`);
      expect((await poRow())?.eqAi ?? null, '됐으면 행 요약은 없다(회차 칩이 말한다)').toBeNull();

      await openCase();
      await openWorkspace();
      const caution = ws().locator('[data-eq-ai-caution]');
      await caution.waitFor({ state: 'visible' });
      expect(await caution.innerText(), '서버 문구 그대로').toContain(`AI 분석 주의: ${W1} · ${W2} — 원본 EQ 와 대조해 주세요.`);
      expect(await banner().getAttribute('data-eq-ai-kind'), '초안에 들어간 분석이라 잡의 띠는 없다').toBe('none');
      await untilText('초안은 그대로 열려 있다', ws().locator('[data-eq-round-status]'), '작성 중');
      await shot('37-ai-caution-live');
      await caution.getByRole('button', { name: 'AI 분석 주의 닫기' }).click();
      await until('주의 띠 닫힘', async () => (await banner().count()) === 0);
      await closeWorkspace();

      // 주의가 길면 300자에서 자른다(말줄임표) — 화면이 아니라 서버 응답으로 본다.
      await prisma.spAiJob.update({
        where: { id: jobId },
        data: { resultJson: metaOf(Array.from({ length: 12 }, (_, i) => `주의 ${String(i + 1)} — ${'가'.repeat(40)}`)) },
      });
      const long = (await eqList()).ai.detail as string;
      expect(long.length, '300자').toBe(300);
      expect(long.endsWith('…'), '잘렸다는 표시').toBe(true);
    } finally {
      // 이 케이스가 넣은 잡만 지운다 — 뒤 케이스는 다시 '분석 안 됨' 상태에서 이어 간다.
      await prisma.spAiJob.deleteMany({ where: { id: jobId } });
    }
    expect((await eqList()).ai, '넣은 잡을 빼면 원래 상태').toMatchObject({ status: 'failed' });
    expect(admin.pageErrors, '페이지 오류').toEqual([]);
  });

  test.skipIf(!EQ_AI)(
    'P5. (실 LLM) 엑셀 EQ 로 승인요청 — "AI 분석 중" → "AI 초안 · 검토 필요" → 문항·그림·활동',
    async () => {
      // 직접 쓴 초안을 지우고 반려 → 합성 픽스처 엑셀을 올려 재요청한다. 이번에는 분석이 끝까지 간다.
      await setUsecase({ enabled: true });
      const del = await api(A, 'DELETE', `${adminBase()}/${String(r1)}`);
      expect(del.status, JSON.stringify(del.json)).toBe(200);
      await eqReject('e2e — 엑셀 EQ 로 재요청');
      await uploadEq(
        'EQ-a-lhd-bilingual.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        new Uint8Array(readFileSync(FIXTURE_XLSX)),
      );
      await eqRequest();

      await openCase();
      // 분석은 10~20초 — 열었을 때 아직 도는 중이면 'AI 분석 중', 이미 끝났으면 바로 초안 칩이다.
      await until('AI 칩', async () => /AI 분석 중|AI 초안 · 검토 필요/.test(await rowChip().innerText()), 30_000, () => rowChip().innerText());
      if ((await rowChip().innerText()).includes('AI 분석 중')) await shotRow('33-ai-live-running-row');

      // 분석 중에 작업공간을 열어 둔다 — 띠가 '분석 중'을 말하고, 끝나면 **다시 열지 않아도** 새 회차 카드에서
      // AI 초안으로 넘어간다(목록 폴링 → 초안이 생기면 그 회차가 선택된다).
      await openWorkspace();
      // 목록이 오면 띠(분석 중) 아니면 이미 끝난 초안 배지 — 둘 중 하나가 설 때까지 기다린 뒤, 띠였으면 찍어 둔다.
      const roundStatus = ws().locator('[data-eq-round-status]');
      await until(
        '띠 또는 초안',
        async () => (await banner().count()) > 0 || (await textOf(roundStatus)).includes('AI 초안'),
        20_000,
      );
      const sawRunning = (await banner().count()) > 0 && (await banner().getAttribute('data-eq-ai-kind')) === 'running';
      if (sawRunning) await shot('33b-ai-live-running-banner');
      await untilText('열어 둔 채 AI 초안으로', ws().locator('[data-eq-round-status]'), 'AI 초안 · 검토 필요', 240_000);
      // 잡의 띠(분석 중)는 사라진다 — 남는다면 서버가 남긴 주의 문구의 띠뿐이다(아래에서 문구를 대조한다).
      await until('분석 중 띠 사라짐', async () => (await banner().count()) === 0 || (await banner().getAttribute('data-eq-ai-kind')) === 'none');
      await closeWorkspace();
      // 행도 분석 중인 동안 스스로 다시 읽는다 — 새로고침 없이 초안 칩으로 넘어간다.
      await untilText('AI 초안 칩', rowChip(), 'AI 초안 · 검토 필요', 60_000);
      await shotRow('34-ai-live-draft-row');

      const list = await eqList();
      expect(list.ai).toMatchObject({ status: 'done', trigger: 'auto' });
      const draft = list.reviews.find((r: any) => r.status === 'draft');
      expect(draft, 'AI 초안').toMatchObject({ format: 'items', aiDraft: true });
      expect(list.ai.appliedReviewId, '결과가 초안에 들어갔다').toBe(draft.id);
      expect(draft.items.length, '문항이 있다').toBeGreaterThan(0);
      expect(draft.events.map((e: any) => e.action), '이벤트 ai_drafted').toContain('ai_drafted');

      await openWorkspace();
      const w = ws();
      await untilText('머리 배지', w.locator('[data-eq-round-status]'), 'AI 초안 · 검토 필요');
      expect(await w.locator('[data-eq-item]').count(), '문항 목록').toBe(draft.items.length);
      // 분석이 됐을 때의 주의 문구(ai.detail)가 있으면 초안 위 주의 띠에 그대로 실리고, 없으면 띠가 없다.
      const detail = typeof list.ai.detail === 'string' ? list.ai.detail.trim() : '';
      if (detail === '') {
        expect(await banner().count(), '주의가 없으면 띠도 없다').toBe(0);
      } else {
        const caution = w.locator('[data-eq-ai-caution]');
        await caution.waitFor({ state: 'visible' });
        expect(await caution.innerText(), '서버 주의 문구').toContain(`AI 분석 주의: ${detail}`);
        expect(await banner().getAttribute('data-eq-ai-kind'), '잡의 띠는 없다').toBe('none');
      }
      console.warn(`[P5] ai.detail = ${detail === '' ? '(없음)' : detail}`);
      await shot('35-ai-live-workspace');
      const side = w.locator('[data-eq-side]');
      await side.getByRole('tab', { name: '활동' }).click();
      await untilText('활동', side, 'AI 가 초안 작성');
      await shot('36-ai-live-activity');
      await closeWorkspace();
      expect(admin.pageErrors, '페이지 오류').toEqual([]);
    },
    360_000,
  );
});
