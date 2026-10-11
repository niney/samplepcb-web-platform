// EQ 문항형 회차(D20 P2) — 승인요청 때 **자동 AI 분석**(API 주행).
//
// 협력사가 [승인요청]을 누르면(관리자 대행도 같다) 서버가 최신 EQ 질의서를 분석해 문항 초안을 만든다.
// 자동은 초안까지다 — 고객 발송은 관리자가 검토한 뒤(D20-1). 분석이 안 되면 초안 없이 화면에만 알린다(P2-3).
// 이 주행은 그 잡의 수명과 경계를 박제한다. 화면은 journey-eq-items-ai-admin 이 본다.
//
// LLM 없이 항상 도는 것:
//   A1 유스케이스 꺼짐 → 잡 없음·aiEnabled=false·칩 없음·수동은 409 AI_DISABLED (트리거가 붙어도 부작용 0)
//   A2 켜고 엑셀이 아닌 EQ(.txt·.pdf)로 승인요청 → 잡 failed(unsupported_file)·행 eqAi failed·초안 없음
//   A3 관리자 **대행** 승인요청도 같은 자동 분석을 건다(P2-1)
//   A4 EQ 질의서 없이(Working 만) 승인요청 → 잡 없음 — 지난 승인요청의 분석은 이번 것이 아니다
//   A5 수동 [AI 분석] 가드 — NOT_EQ_REQUESTED·NO_SOURCE·DRAFT_EXISTS·ALREADY_OPEN, replaceDraft 는 통과
// 옵트인(EQ_AI_E2E=1 — 실 LLM, 분석 한 번에 10~40초):
//   L1 합성 픽스처(a-lhd-bilingual.xlsx)로 승인요청 → 초안·aiDraft·문항·그림(공개)·이벤트 ai_drafted·행 요약
//   L2 발송 → 반려 → 개정 픽스처(e-lhd-v2.xlsx)로 재요청 → 2차 초안의 동일·변경·신규 연결(결정적 대조)
//   L3 관리자가 먼저 초안을 연 뒤 [AI 결과를 초안에 적용](replaceDraft) — 같은 파일이라 모델을 다시 부르지 않는다
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run specs/journey-eq-items-ai.e2e.test.ts
//       실 LLM 까지: … cross-env PORTAL_E2E=1 EQ_AI_E2E=1 NODE_OPTIONS=--use-system-ca vitest run specs/journey-eq-items-ai.e2e.test.ts
// 사전: API(3333)·파일서버 · e2e/.env.e2e 고객 아이디. 옵트인은 AI 연결(설정 > AI 연동)까지.
// ⚠ 유스케이스 on/off 는 **로컬 설정을 바꾼다** — 끝나면 원래 값으로 되돌린다. 무대는 e2e 소유 픽스처로 세우고 지운다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  api,
  apiDir,
  cleanupPcbPos,
  countCartRows,
  countPcbResidue,
  createG5OrderFixture,
  createOrderSpec,
  createPcbPo,
  deleteOrderHard,
  disconnectPrisma,
  getPartner,
  getPrisma,
  requireCustomerCreds,
  signJwt,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const OWNER = '협력2';
/** 실 LLM 경로 옵트인 — 꺼져 있으면 L* 는 건너뛴다. */
const EQ_AI = process.env.EQ_AI_E2E === '1';
const FIXTURES = join(apiDir, 'src', 'lib', 'pcb-eq-extract', '__fixtures__');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('EQ AI 분석(D20 P2) — 승인요청 자동 분석·수동 가드·개정 대조', () => {
  let owner: PartnerFixture;
  let A = '';
  let P = '';
  let order: G5OrderFixture | undefined;
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  const seeded: bigint[] = [];
  /** 주행 전 유스케이스 설정 — 끝나면 그대로 되돌린다. */
  let originalSetting: { enabled: boolean; model: string; think: string; extraInstructions: string } | null = null;

  const adminBase = (): string => `/api/admin/pcb-eq-reviews/${String(poId)}`;
  const poBase = (): string => `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}`;
  const partnerBase = (): string => `/api/partner/pcb-pos/${String(poId)}`;

  const list = async (): Promise<any> => {
    const res = await api(A, 'GET', adminBase());
    expect(res.status, `목록: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data;
  };
  const jobCount = async (): Promise<number> =>
    getPrisma().spAiJob.count({
      where: { useCase: 'pcb.eq-parse', targetType: 'pcb_po', targetId: BigInt(poId) },
    });
  const workRow = async (): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-pos?tab=all&pageSize=100&q=${encodeURIComponent(projectName)}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.items ?? []).find((i: any) => i.poId === poId) ?? null;
  };
  const caseRow = async (): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-projects/${specId.toString()}/pos`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.pos ?? []).find((p: any) => p.poId === poId) ?? null;
  };
  const poStatus = async (): Promise<string> =>
    String((await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } }))?.status);

  const setUsecase = async (enabled: boolean): Promise<void> => {
    if (originalSetting === null) throw new Error('원래 설정을 읽지 못했습니다');
    const res = await api(A, 'PATCH', '/api/admin/settings/ai', {
      pcbEqParse: {
        enabled,
        model: originalSetting.model,
        think: originalSetting.think,
        extraInstructions: originalSetting.extraInstructions,
      },
    });
    expect(res.status, `설정 저장: ${JSON.stringify(res.json)}`).toBe(200);
    expect(res.json?.data?.pcbEqParse?.enabled).toBe(enabled);
  };

  /** 협력사가 EQ 첨부를 올린다(fileType eq|working). */
  const uploadEq = async (name: string, type: string, bytes: Uint8Array, fileType = 'eq'): Promise<void> => {
    const form = new FormData();
    form.set('fileType', fileType);
    form.set('file', new File([new Uint8Array(bytes)], name, { type }));
    const res = await fetch(`${API_URL}${partnerBase()}/eq-files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${P}` },
      body: form,
    });
    expect(res.status, `EQ 업로드(${name})`).toBe(200);
  };
  /** 이 발주서의 EQ 첨부를 전부 지운다(발주접수 상태에서만 지울 수 있다). */
  const clearEqFiles = async (): Promise<void> => {
    const files: any[] = await getPrisma().spFile.findMany({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
      select: { id: true },
    });
    for (const f of files) {
      const res = await api(P, 'DELETE', `${partnerBase()}/eq-files/${String(f.id)}`);
      expect(res.status, `EQ 삭제: ${JSON.stringify(res.json)}`).toBe(200);
    }
  };
  const request = async (): Promise<void> => {
    const res = await api(P, 'POST', `${partnerBase()}/eq-request`);
    expect(res.status, `승인요청: ${JSON.stringify(res.json)}`).toBe(200);
    expect(await poStatus()).toBe('eq_requested');
  };
  /** 요청 취소(eq_requested → issued) — 열린 회차는 전이가 닫는다. */
  const revert = async (): Promise<void> => {
    const res = await api(P, 'POST', `${partnerBase()}/eq-revert`);
    expect(res.status, `요청 취소: ${JSON.stringify(res.json)}`).toBe(200);
    expect(await poStatus()).toBe('issued');
  };
  /** 분석이 끝날 때까지(running 이 아닐 때까지) 목록을 다시 읽는다. */
  const waitAi = async (timeoutMs: number, jobIdNot?: string): Promise<any> => {
    const until = Date.now() + timeoutMs;
    let last: any = null;
    while (Date.now() < until) {
      last = await list();
      const ai = last.ai;
      if (ai !== null && ai.status !== 'running' && ai.jobId !== jobIdNot) return last;
      await sleep(500);
    }
    throw new Error(`AI 분석이 ${String(timeoutMs / 1000)}초 안에 끝나지 않았습니다: ${JSON.stringify(last?.ai)}`);
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });

    const settings = await api(A, 'GET', '/api/admin/settings/ai');
    expect(settings.status, `AI 설정: ${JSON.stringify(settings.json)}`).toBe(200);
    const cur = settings.json?.data?.pcbEqParse;
    expect(cur, '설정 응답에 pcbEqParse 블록').toBeTruthy();
    originalSetting = {
      enabled: cur.enabled === true,
      model: String(cur.model),
      think: String(cur.think),
      extraInstructions: String(cur.extraInstructions ?? ''),
    };

    // 무대 — EQ 트랙(standard) 발주서를 e2e 소유로 세운다(실스펙을 고르면 메탈마스크가 걸릴 수 있다).
    const customerId = requireCustomerCreds(1).id;
    order = await createG5OrderFixture(customerId, 'e2e EQ AI');
    projectName = `E2E-EQAI-${String(Date.now())}`;
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName, category: 'standard' });
    specId = spec.id as bigint;
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);
  }, 120_000);

  afterAll(async () => {
    // 설정부터 되돌린다 — 정리가 중간에 죽어도 로컬 설정이 바뀐 채 남지 않게.
    if (originalSetting !== null) {
      const res = await api(A, 'PATCH', '/api/admin/settings/ai', { pcbEqParse: originalSetting });
      expect(res.status, '유스케이스 설정 복원').toBe(200);
    }
    const prisma = getPrisma();
    if (poId > 0) {
      const reviews: any[] = await prisma.spPcbEqReview.findMany({
        where: { poId: BigInt(poId) },
        select: { id: true },
      });
      if (reviews.length > 0) {
        await prisma.spFile.deleteMany({
          where: { refType: 'sp_pcb_eq_review', refId: { in: reviews.map((r) => r.id) } },
        });
      }
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) } });
      // 잡은 발주서에 FK 가 없다(업무 대상 규약) — 이 주행이 만든 것만 지운다.
      await prisma.spAiJob.deleteMany({
        where: { useCase: 'pcb.eq-parse', targetType: 'pcb_po', targetId: BigInt(poId) },
      });
    }
    if (specId > 0n) {
      await prisma.spMailLog.deleteMany({ where: { refType: 'pcb_spec', refId: specId.toString() } });
    }
    await cleanupPcbPos(seeded);
    if (specId > 0n) await prisma.spOrderSpec.deleteMany({ where: { id: specId } });
    if (order !== undefined) await deleteOrderHard(order.odId);

    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('A1. 유스케이스가 꺼져 있으면 승인요청에 아무 일도 안 붙는다 — 잡·칩 없음, 수동은 AI_DISABLED', async () => {
    await setUsecase(false);
    await uploadEq('EQ-factory.xlsx', XLSX_MIME, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    await request();
    await sleep(1000); // 자동 분석은 응답 뒤에 걸린다 — 걸렸다면 잡이 보일 시간을 준다

    const data = await list();
    expect(data.aiEnabled, 'aiEnabled').toBe(false);
    expect(data.ai, '분석 상태 없음').toBeNull();
    expect(data.reviews, '초안 없음').toEqual([]);
    expect(await jobCount(), '잡 없음').toBe(0);
    expect((await workRow())?.eqAi, '워크큐 칩 없음').toBeNull();
    expect((await caseRow())?.eqAi, 'Case 행 칩 없음').toBeNull();

    const manual = await api(A, 'POST', `${adminBase()}/ai-analyze`, {});
    expect(manual.status, JSON.stringify(manual.json)).toBe(409);
    expect(manual.json?.error).toBe('AI_DISABLED');
    expect(String(manual.json?.message)).toContain('설정');
  });

  test('A2. 켜고 엑셀이 아닌 EQ 로 승인요청 → 분석 안 됨(unsupported_file) — 초안 없이 행에만 알린다', async () => {
    await setUsecase(true);
    await revert();
    await uploadEq('EQ-scan.txt', 'text/plain', new TextEncoder().encode('EQ list — scanned'));
    await request();

    const data = await waitAi(15_000);
    expect(data.aiEnabled).toBe(true);
    expect(data.ai).toMatchObject({
      status: 'failed',
      reason: 'unsupported_file',
      trigger: 'auto',
      appliedReviewId: null,
    });
    // 덧말에는 어느 파일인지가 실린다(질의서 **최신본** = 방금 올린 .txt — 먼저 올린 .xlsx 가 아니다).
    expect(String(data.ai.detail)).toContain('EQ-scan.txt');
    expect(data.ai.finishedAt).not.toBeNull();
    expect(data.reviews, '분석이 안 되면 초안을 만들지 않는다').toEqual([]);

    const row = await workRow();
    expect(row?.eqAi, '워크큐 칩').toMatchObject({ status: 'failed', reason: 'unsupported_file' });
    expect(row?.eqReview, '회차 요약은 미요청').toBeNull();
    expect((await caseRow())?.eqAi, 'Case 행 칩').toMatchObject({ status: 'failed', reason: 'unsupported_file' });
    // 잡 원장 — 자동은 소유자 'system', 사유 코드가 error 컬럼에.
    const job: any = await getPrisma().spAiJob.findFirst({
      where: { useCase: 'pcb.eq-parse', targetType: 'pcb_po', targetId: BigInt(poId) },
      orderBy: { startedAt: 'desc' },
    });
    expect(job).toMatchObject({ mbId: 'system', status: 'error', error: 'unsupported_file', stage: null });

    // 협력사 포털에는 AI 분석 상태가 나가지 않는다(관리자 화면 전용).
    const portal = await api(P, 'GET', partnerBase());
    expect(portal.status).toBe(200);
    expect(JSON.stringify(portal.json)).not.toContain('unsupported_file');
  });

  test('A3. 관리자 대행 승인요청도 자동 분석을 건다 — .pdf 도 엑셀이 아니다', async () => {
    await revert();
    await uploadEq('EQ-final.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.4'));
    const before = (await list()).ai; // 요청을 물렸으니 지금은 승인요청 중이 아니다
    expect(before, '승인요청 중이 아니면 분석 상태를 싣지 않는다').toBeNull();

    const sub = await api(A, 'POST', `${poBase()}/eq-request`, {});
    expect(sub.status, `대행 승인요청: ${JSON.stringify(sub.json)}`).toBe(200);
    const data = await waitAi(15_000);
    expect(data.ai).toMatchObject({ status: 'failed', reason: 'unsupported_file', trigger: 'auto' });
    expect(String(data.ai.detail)).toContain('EQ-final.pdf');
    expect(await jobCount(), '승인요청마다 잡 하나').toBe(2);
  });

  test('A4. EQ 질의서가 없으면(Working 만) 잡을 만들지 않는다 — 지난 승인요청의 분석은 이번 것이 아니다', async () => {
    await revert();
    await clearEqFiles();
    await uploadEq('working.zip', 'application/zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'working');
    await request();
    await sleep(1000);

    const data = await list();
    expect(data.ai, '이번 승인요청에는 분석이 없다').toBeNull();
    expect(await jobCount(), '새 잡 없음').toBe(2);
    expect((await workRow())?.eqAi, '지난 요청의 실패 칩이 남지 않는다').toBeNull();
  });

  test('A5. 수동 [AI 분석] 가드 — 질의서 없음·승인요청 아님·초안 있음·이미 발송', async () => {
    const analyze = (body?: unknown) => api(A, 'POST', `${adminBase()}/ai-analyze`, body);

    const noSource = await analyze({});
    expect(noSource.status, JSON.stringify(noSource.json)).toBe(409);
    expect(noSource.json?.error).toBe('NO_SOURCE');

    await revert();
    const notRequested = await analyze({});
    expect(notRequested.status).toBe(409);
    expect(notRequested.json?.error).toBe('NOT_EQ_REQUESTED');

    // 질의서(.txt)를 올리고 승인요청 — 자동 분석은 안 되고(unsupported), 관리자가 손으로 초안을 연다.
    await uploadEq('EQ-scan-2.txt', 'text/plain', new TextEncoder().encode('EQ list v2'));
    await request();
    const auto = (await waitAi(15_000)).ai;
    expect(auto).toMatchObject({ status: 'failed', trigger: 'auto' });
    const draft = await api(A, 'POST', `${adminBase()}/drafts`, {});
    expect(draft.status, JSON.stringify(draft.json)).toBe(201);
    const reviewId = Number(draft.json.data.review.id);
    expect(draft.json.data.review).toMatchObject({ aiDraft: false, items: [] });

    // 초안이 있으면 그 문항을 바꿔도 된다는 뜻(replaceDraft)이 있어야 한다.
    const draftExists = await analyze({});
    expect(draftExists.status, JSON.stringify(draftExists.json)).toBe(409);
    expect(draftExists.json?.error).toBe('DRAFT_EXISTS');
    const bodyless = await analyze(); // 몸통 없이도 같은 판정(replaceDraft 기본 false)
    expect(bodyless.status).toBe(409);
    expect(bodyless.json?.error).toBe('DRAFT_EXISTS');

    // replaceDraft 는 가드를 지난다 — 202 와 잡 상태. 파일이 엑셀이 아니라 분석은 안 되고 초안은 그대로다.
    const replaced = await analyze({ replaceDraft: true });
    expect(replaced.status, JSON.stringify(replaced.json)).toBe(202);
    expect(replaced.json?.data?.ai).toMatchObject({ trigger: 'manual' });
    const after = await waitAi(15_000, auto.jobId);
    expect(after.ai).toMatchObject({ status: 'failed', reason: 'unsupported_file', trigger: 'manual' });
    expect(after.reviews[0]).toMatchObject({ id: reviewId, status: 'draft', version: 1, aiDraft: false, items: [] });
    const job: any = await getPrisma().spAiJob.findUnique({ where: { id: after.ai.jobId } });
    expect(job?.mbId, '수동 잡의 소유자는 누른 관리자').toBe('e2e-admin');

    // 문항을 채워 고객에게 보낸 뒤에는 AI 로 바꿀 수 없다.
    const saved = await api(A, 'PUT', `${adminBase()}/${String(reviewId)}/draft`, {
      expectedVersion: 1,
      items: [
        {
          factoryNo: '1',
          category: 'other',
          question: '손으로 쓴 문항입니다',
          questionOrig: null,
          options: [{ key: 'A', label: '예', labelOrig: null, recommended: false, requiresComment: false }],
          // AI 검토 표시는 저장 입력에 실어야 남는다(통째 교체) — 실으면 그대로 돌아온다.
          aiFlags: [{ code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' }],
        },
      ],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.data.review.items[0].aiFlags).toEqual([
      { code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' },
    ]);
    // 다시 저장하며 표시를 빼면([확인함]) 지워진다.
    const cleared = await api(A, 'PUT', `${adminBase()}/${String(reviewId)}/draft`, {
      expectedVersion: 2,
      items: [{ ...saved.json.data.review.items[0], figures: [], aiFlags: undefined }],
    });
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
    expect(cleared.json.data.review.items[0].aiFlags, '안 보내면 지워진다').toEqual([]);

    const sent = await api(A, 'POST', `${adminBase()}/${String(reviewId)}/send`, { expectedVersion: 3 });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const alreadyOpen = await analyze({ replaceDraft: true });
    expect(alreadyOpen.status, JSON.stringify(alreadyOpen.json)).toBe(409);
    expect(alreadyOpen.json?.error).toBe('ALREADY_OPEN');
  });

  // ── 실 LLM(옵트인) ─────────────────────────────────────────────────────────
  let r1 = 0;
  let r1Items: any[] = [];

  test.skipIf(!EQ_AI)('L1. 합성 EQ 엑셀로 승인요청 → AI 초안(문항·공개 그림·ai_drafted·행 요약)', async () => {
    await revert(); // 발송해 둔 회차는 전이가 닫는다(canceled)
    // 무대를 비운다 — 위 A5 가 보낸 손 초안이 '고객이 본 회차'로 남아 있으면 첫 AI 초안이 거기에 이어진다
    // (그건 L2 가 볼 일이다). 이 주행이 만든 회차만 지운다(문항·이벤트는 cascade).
    await getPrisma().spPcbEqReview.deleteMany({ where: { poId: BigInt(poId) } });
    await clearEqFiles();
    await uploadEq('EQ-LHD-v1.xlsx', XLSX_MIME, readFileSync(join(FIXTURES, 'a-lhd-bilingual.xlsx')));
    const jobsBefore = await jobCount();
    await request();

    // 분석 중에는 행에 "AI 분석 중"이 뜬다(끝나기 전에 읽히면).
    const early = await list();
    if (early.ai?.status === 'running') {
      expect((await workRow())?.eqAi?.status, '워크큐 칩 — 분석 중').toBe('running');
    }
    const data = await waitAi(150_000);
    expect(data.ai, `분석 결과: ${JSON.stringify(data.ai)}`).toMatchObject({ status: 'done', trigger: 'auto', reason: null });
    expect(await jobCount()).toBe(jobsBefore + 1);

    const review = data.reviews[0];
    r1 = Number(review.id);
    expect(data.ai.appliedReviewId, '초안에 들어갔다').toBe(r1);
    expect(review).toMatchObject({ status: 'draft', format: 'items', aiDraft: true, version: 1, requestedBy: 'system' });
    expect(review.roundNo).toBe(1);
    // 픽스처 a = 문항 5개(1~5), 그림은 1·2·4번 문항(로고는 어느 문항도 안 불러 올리지 않는다).
    r1Items = review.items;
    expect(r1Items.map((i: any) => i.factoryNo), '문항 번호').toEqual(['1', '2', '3', '4', '5']);
    expect(r1Items.every((i: any) => i.question.length > 0 && /[가-힣]/.test(i.question)), '한국어 질문').toBe(true);
    expect(r1Items.every((i: any) => (i.questionOrig ?? '').length > 0), '원문 보존').toBe(true);
    expect(r1Items.map((i: any) => i.options.map((o: any) => o.key).join('')), '선택지 기호').toEqual(['AB', 'ABC', 'ABC', 'AB', 'AB']);
    expect(r1Items.map((i: any) => i.figures.length), '그림 연결').toEqual([1, 1, 0, 2, 0]);
    const figures = r1Items.flatMap((i: any) => i.figures);
    expect(figures.every((f: any) => f.shared === true), '문항에 걸린 그림은 기본 공개(P2-8)').toBe(true);
    expect(figures.every((f: any) => /^figure-\d+\.(png|jpg|gif|webp)$/.test(f.name)), '그림 이름은 중립').toBe(true);
    expect(review.looseFigures, '문항에 안 걸린 그림(로고)은 올리지 않는다').toEqual([]);
    expect(r1Items.every((i: any) => i.change === null && i.prevItemId === null), '고객이 본 문항형 회차가 없으면 변화 표시도 없다').toBe(true);
    expect(r1Items.every((i: any) => Array.isArray(i.aiFlags)), 'aiFlags 는 늘 배열').toBe(true);

    const ev = review.events.at(-1);
    expect(ev).toMatchObject({ action: 'ai_drafted', actorRole: 'system', actorMbId: null });
    expect(String(ev.note)).toContain('문항 5개');
    expect(String(ev.note)).toContain(data.ai.model);
    // 근거 = 분석한 그 파일.
    const eqFile: any = await getPrisma().spFile.findFirst({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId), originFileName: 'EQ-LHD-v1.xlsx' },
    });
    expect(review.sourceFileIds).toEqual([Number(eqFile.id)]);

    const row = await workRow();
    expect(row?.eqReview, '행 요약 — AI 초안').toMatchObject({ status: 'draft', format: 'items', aiDraft: true });
    expect(row?.eqAi, '됐으면 AI 칩은 없다(회차 요약이 말한다)').toBeNull();

    // 그림은 실제로 열린다(관리자 열람).
    const fig = await fetch(`${API_URL}${adminBase()}/${String(r1)}/figures/${String(figures[0].fileId)}`, {
      headers: { authorization: `Bearer ${A}` },
    });
    expect(fig.status).toBe(200);
    expect(fig.headers.get('content-type') ?? '').toMatch(/^image\//);
  }, 200_000);

  test.skipIf(!EQ_AI)('L2. 발송 → 반려 → 개정 EQ 로 재요청 → 2차 초안이 동일·변경·신규로 이어진다', async () => {
    const before = (await list()).reviews.find((r: any) => r.id === r1);
    const sent = await api(A, 'POST', `${adminBase()}/${String(r1)}/send`, { expectedVersion: before.version });
    expect(sent.status, `AI 초안 발송: ${JSON.stringify(sent.json)}`).toBe(200);

    const reject = await api(A, 'POST', `${poBase()}/eq-reject`, { reason: '공장 개정 EQ 대기(e2e)' });
    expect(reject.status, JSON.stringify(reject.json)).toBe(200);
    // 개정 EQ — 1·4·5번 그대로, 2번 문구·선택지 변경, 3번 삭제, 6번 신규.
    await uploadEq('EQ-LHD-v2.xlsx', XLSX_MIME, readFileSync(join(FIXTURES, 'e-lhd-v2.xlsx')));
    const prevJob = (await list()).ai?.jobId as string | undefined;
    await request();
    const data = await waitAi(150_000, prevJob);
    expect(data.ai, JSON.stringify(data.ai)).toMatchObject({ status: 'done', trigger: 'auto' });

    const r2 = data.reviews[0];
    expect(Number(r2.id)).not.toBe(r1);
    expect(r2).toMatchObject({ status: 'draft', aiDraft: true, prevReviewId: r1 });
    expect(data.ai.appliedReviewId).toBe(r2.id);
    const byNo = new Map<string, any>(r2.items.map((i: any) => [String(i.factoryNo), i]));
    const prevByNo = new Map<string, any>(r1Items.map((i: any) => [String(i.factoryNo), i]));
    expect([...byNo.keys()], '개정본 문항 번호').toEqual(['1', '2', '4', '5', '6']);
    // 그대로인 문항 — 직전 문항에 잇고 동일(고객 화면이 이전 답을 미리 골라 준다).
    for (const no of ['1', '4', '5']) {
      expect(byNo.get(no), `${no}번`).toMatchObject({ change: 'same', prevItemId: prevByNo.get(no).id });
    }
    // 고쳐 온 문항 — 같은 번호에 잇되 변경.
    expect(byNo.get('2'), '2번').toMatchObject({ change: 'changed', prevItemId: prevByNo.get('2').id });
    // 새 문항 — 이을 곳이 없다. 빠진 3번은 누구에게도 이어지지 않는다.
    expect(byNo.get('6'), '6번').toMatchObject({ change: 'new', prevItemId: null });
    expect(r2.items.some((i: any) => i.prevItemId === prevByNo.get('3').id), '삭제된 3번').toBe(false);
    r1 = Number(r2.id);
  }, 200_000);

  test.skipIf(!EQ_AI)('L3. 관리자가 먼저 초안을 열었으면 [AI 결과를 초안에 적용] — 같은 파일은 모델을 다시 부르지 않는다', async () => {
    // AI 초안을 버리고 손으로 초안을 연다 — 그 뒤 AI 결과를 그 초안에 넣는다.
    const cancel = await api(A, 'DELETE', `${adminBase()}/${String(r1)}`);
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    const draft = await api(A, 'POST', `${adminBase()}/drafts`, {});
    expect(draft.status, JSON.stringify(draft.json)).toBe(201);
    const reviewId = Number(draft.json.data.review.id);

    const refused = await api(A, 'POST', `${adminBase()}/ai-analyze`, {});
    expect(refused.status).toBe(409);
    expect(refused.json?.error).toBe('DRAFT_EXISTS');

    const prevJob = (await list()).ai?.jobId as string | undefined;
    const startedAt = Date.now();
    const apply = await api(A, 'POST', `${adminBase()}/ai-analyze`, { replaceDraft: true });
    expect(apply.status, JSON.stringify(apply.json)).toBe(202);
    const data = await waitAi(150_000, prevJob);
    expect(data.ai, JSON.stringify(data.ai)).toMatchObject({ status: 'done', trigger: 'manual', appliedReviewId: reviewId });
    expect(Date.now() - startedAt, '이전 분석 재사용 — 모델 호출 없이 끝난다').toBeLessThan(15_000);

    const review = data.reviews.find((r: any) => r.id === reviewId);
    expect(review, '같은 초안에 들어간다(새 회차가 아니다)').toMatchObject({ status: 'draft', aiDraft: true, version: 2 });
    expect(review.items.map((i: any) => i.factoryNo)).toEqual(['1', '2', '4', '5', '6']);
    expect(review.events.map((e: any) => e.action)).toEqual(['drafted', 'ai_drafted']);
    const ev = review.events.at(-1);
    expect(ev).toMatchObject({ actorRole: 'system', actorMbId: 'e2e-admin' });
    expect(String(ev.note)).toContain('이전 분석 재사용');
    // 열어 둔 편집기의 늦은 저장은 덮어쓰지 못한다(버전이 올랐다).
    const stale = await api(A, 'PUT', `${adminBase()}/${String(reviewId)}/draft`, { expectedVersion: 1, items: [] });
    expect(stale.status).toBe(409);
    expect(stale.json?.error).toBe('VERSION_CONFLICT');
  }, 200_000);
});
