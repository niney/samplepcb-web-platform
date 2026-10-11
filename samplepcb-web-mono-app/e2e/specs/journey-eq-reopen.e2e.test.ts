// EQ 승인 뒤의 두 가지(D20 후속) — **승인하면 고객 회신이 전달되고, 협력사가 추가 EQ 를 요청한다**.
//
// P1 은 둘 다 빠져 있었다: ① 전달이 승인과 별개의 버튼이라 전달 없이 승인하면 공장이 고객 답을 모른 채
// 생산을 시작할 수 있었고, ② 승인 뒤 협력사가 할 수 있는 건 [생산 시작]뿐이라 추가 질문이 생기면 관리자가
// 승인 취소 → 반려를 대신 눌러 줘야 했다. 이 주행이 그 두 경로와 경계를 API 로 박제한다.
//
// 표적:
//   R1 문항형 회차 발송 → 고객 회신 — 승인 전에는 협력사가 못 본다(전달 전)
//   R2 **승인 = 자동 전달** — forwardedAt·이벤트·포털 노출, 승인 메일 한 통에 회신 요약(전달 메일 없음)
//   R3 **추가 EQ 요청** — 사유 필수 · eq_done → issued · 이력 note · reopenedAt · 관리자 메일 · 첨부 잠금 해제
//   R4 새 EQ → 재승인요청 → 관리자 fromPrevious 초안이 직전(고객이 본) 회차에 이어진다
//   R5 생산이 시작된 뒤에는 추가 EQ 요청 불가(EQ 가 아니라 A/S 의 일) · 남의 발주서는 404
//   R6 메탈마스크(스텐실)는 대상이 아니다 — 409 NOT_EQ_TRACK(협력사·관리자 대행 모두)
//   R7 MD 위임 상위에서는 차단, 하위 발주서에서 가능 — 상위 상태 미러
//   R8 관리자 대행(D11) — 이력 byRole ADMIN·운영자 메일 없음 · 이미 수동 전달한 회차는 승인이 건드리지 않는다
// 옵트인(EQ_AI_E2E=1 — 실 LLM):
//   L1 AI 초안 → 발송 → 회신 → 승인(자동 전달) → 추가 EQ 요청 → 개정 엑셀로 재요청 → 2차 AI 초안이 동일·변경·신규로 연결
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-reopen
//       실 LLM 까지: … cross-env PORTAL_E2E=1 EQ_AI_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-reopen
// 사전: API(3333)·파일서버·Mailpit(8025, 없으면 sp_mail_log 대조만) · e2e/.env.e2e 고객 아이디.
// ⚠ L1 은 전역 설정 `pcbEqParse.enabled` 를 켰다 되돌린다 — 다른 AI 스펙(journey-eq-items-ai·-ai-admin)과
//   **동시에 돌리지 말 것**(한 vitest 실행에 묶으면 fileParallelism=false 라 안 겹친다).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  MAILPIT_URL,
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
  ensureMdRelation,
  ensureStagePartner,
  getPartner,
  getPrisma,
  mailpitDelete,
  mailpitMessage,
  mailpitSearch,
  requireCustomerCreds,
  signJwt,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

const OWNER = '협력2';
const MD = { mbId: 'e2e-mdtester', orgName: '마스터딜러상사', country: 'KR', currency: 'KRW' };
const SUB = { mbId: 'e2e-mdsub', orgName: 'e2e-md하위', country: 'CN', currency: 'USD' };
/** 실 LLM 경로 옵트인. */
const EQ_AI = process.env.EQ_AI_E2E === '1';
const FIXTURES = join(apiDir, 'src', 'lib', 'pcb-eq-extract', '__fixtures__');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('EQ 승인 뒤(D20 후속) — 승인 시 자동 전달 · 추가 EQ 요청', () => {
  let owner: PartnerFixture;
  let md: PartnerFixture;
  let sub: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 수주 협력사
  let C = ''; // 고객
  let M = ''; // 마스터딜러
  let S = ''; // MD 의 하위 협력사
  let customerId = '';
  let order: G5OrderFixture | undefined;
  const seeded: bigint[] = [];
  const specIds: bigint[] = [];
  const startedAt = new Date();
  const token = `e2eeqro${String(Date.now())}`; // 메일 검색 키(공백 없는 한 낱말)
  let mailpitUp = false;

  // 본 흐름(R1~R5)의 발주서.
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  let r1 = 0;
  let r1Items: any[] = [];

  const reviewsBase = (po: number): string => `/api/admin/pcb-eq-reviews/${String(po)}`;
  const adminPo = (spec: bigint, po: number): string =>
    `/api/admin/pcb-projects/${spec.toString()}/pos/${String(po)}`;
  const partnerPo = (po: number): string => `/api/partner/pcb-pos/${String(po)}`;

  const adminReview = async (po: number, reviewId: number): Promise<any> => {
    const res = await api(A, 'GET', reviewsBase(po));
    expect(res.status, `관리자 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.reviews ?? []).find((r: any) => r.id === reviewId) ?? null;
  };
  const poRow = async (po: number): Promise<any> => getPrisma().spPcbPo.findUnique({ where: { id: BigInt(po) } });
  const partnerDetail = async (tok: string, po: number): Promise<any> => {
    const res = await api(tok, 'GET', partnerPo(po));
    expect(res.status, `포털 상세: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json.data;
  };
  const workRow = async (name: string, po: number): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-pos?tab=all&pageSize=100&q=${encodeURIComponent(name)}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.items ?? []).find((i: any) => i.poId === po) ?? null;
  };
  /** Case 상세의 발주 행(AdminPcbPoView). */
  const caseRow = async (spec: bigint, po: number): Promise<any> => {
    const res = await api(A, 'GET', `/api/admin/pcb-projects/${spec.toString()}/pos`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.pos ?? []).find((i: any) => i.poId === po) ?? null;
  };
  const partnerListRow = async (tok: string, po: number): Promise<any> => {
    const res = await api(tok, 'GET', '/api/partner/pcb-pos');
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.items ?? []).find((i: any) => Number(i.poId) === po) ?? null;
  };

  /** 협력사 EQ 첨부 업로드 — 상태 코드만 돌려준다(잠금 검사에 쓴다). */
  const uploadEq = async (tok: string, po: number, name: string, bytes?: Uint8Array, type = 'application/vnd.ms-excel'): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    form.set('fileType', 'eq');
    form.set('file', new File([new Uint8Array(bytes ?? new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))], name, { type }));
    const res = await fetch(`${API_URL}${partnerPo(po)}/eq-files`, {
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

  /** 이 주행의 메일 원장(sp_mail_log). */
  const mailLogs = async (kind: string, spec: bigint): Promise<any[]> =>
    getPrisma().spMailLog.findMany({
      where: { kind, refType: 'pcb_spec', refId: spec.toString(), createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
    });
  /** 메일은 비동기(void send) — 원장에 n 건이 찰 때까지 폴링한다. */
  const waitMailLogs = async (kind: string, spec: bigint, count: number): Promise<any[]> => {
    let rows: any[] = [];
    for (let i = 0; i < 20; i += 1) {
      rows = await mailLogs(kind, spec);
      if (rows.length >= count) return rows;
      await sleep(500);
    }
    return rows;
  };
  const mailpitHit = async (query: string, mustContain: string): Promise<any> => {
    for (let i = 0; i < 20; i += 1) {
      const list = ((await mailpitSearch(query))?.messages ?? []) as any[];
      for (const m of list) {
        const full = await mailpitMessage(String(m.ID));
        if (String(full?.HTML ?? '').includes(mustContain)) return full;
      }
      await sleep(500);
    }
    return null;
  };

  const ITEMS = [
    {
      factoryNo: '1',
      category: 'marking',
      question: 'UL 마킹을 보드에 넣을까요?',
      questionOrig: '是否需要在板上加UL标记？',
      options: [
        { key: 'A', label: '넣지 않음', labelOrig: '不加', recommended: true, requiresComment: false },
        { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置', recommended: false, requiresComment: true },
      ],
    },
    {
      factoryNo: '2',
      category: 'drill',
      question: '0.2mm 비아를 0.25mm 로 키워도 될까요?',
      questionOrig: '0.2mm孔径加大到0.25mm可以吗？',
      options: [
        { key: 'A', label: '키워도 됩니다', labelOrig: '可以', recommended: true, requiresComment: false },
        { key: 'B', label: '안 됩니다', labelOrig: '不可以', recommended: false, requiresComment: false },
      ],
    },
  ];

  /** 발주서 하나에서 "초안 → 문항 저장 → 발송 → 고객 회신"까지 — 회신된 회차(미전달)를 돌려준다. */
  const askAndAnswer = async (po: number, comment: string): Promise<{ reviewId: number; items: any[] }> => {
    const draft = await api(A, 'POST', `${reviewsBase(po)}/drafts`, {});
    expect(draft.status, `초안: ${JSON.stringify(draft.json)}`).toBe(201);
    const reviewId = Number(draft.json.data.review.id);
    const saved = await api(A, 'PUT', `${reviewsBase(po)}/${String(reviewId)}/draft`, { expectedVersion: 1, items: ITEMS });
    expect(saved.status, `저장: ${JSON.stringify(saved.json)}`).toBe(200);
    const sent = await api(A, 'POST', `${reviewsBase(po)}/${String(reviewId)}/send`, { expectedVersion: 2 });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    const items: any[] = sent.json.data.review.items;
    const answered = await api(C, 'POST', `/api/pcb-eq-reviews/${String(reviewId)}/answer`, {
      expectedVersion: 3,
      answers: [
        { itemId: items[0].id, key: 'B', comment },
        { itemId: items[1].id, key: 'A' },
      ],
      agree: true,
    });
    expect(answered.status, `고객 회신: ${JSON.stringify(answered.json)}`).toBe(200);
    return { reviewId, items };
  };

  /** e2e 소유 스펙 + 발주서 — 같은 주문(카트 줄)에 스펙을 여럿 건다(고객 소유 판정은 spec.mbId). */
  const stage = async (
    name: string,
    category: string,
    po: { partnerId: bigint; status: string; fulfillmentMode?: 'self' | 'delegated' },
  ): Promise<{ specId: bigint; poId: number; name: string }> => {
    if (order === undefined) throw new Error('주문 픽스처 없음');
    const spec = await createOrderSpec({ mbId: customerId, ctId: order.ctId, projectName: name, category });
    specIds.push(spec.id as bigint);
    const row = await createPcbPo({ specId: spec.id as bigint, ...po });
    seeded.push(row.id);
    return { specId: spec.id as bigint, poId: Number(row.id), name };
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    mailpitUp = (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null))?.ok === true;

    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    md = await ensureStagePartner(MD);
    sub = await ensureStagePartner(SUB);
    await ensureMdRelation(md, sub, 'USD');
    if (md.mbId === null || sub.mbId === null) throw new Error('MD 무대 계정 연결 실패');

    A = signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 3600 });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    M = signJwt({ mbId: md.mbId, ttlSec: 3600 });
    S = signJwt({ mbId: sub.mbId, ttlSec: 3600 });
    customerId = requireCustomerCreds(1).id;
    C = signJwt({ mbId: customerId, ttlSec: 3600 });

    order = await createG5OrderFixture(customerId, 'e2e EQ 추가요청');
    projectName = `E2E-REOPEN-${token}`;
    const main = await stage(projectName, 'standard', { partnerId: owner.id, status: 'issued' });
    specId = main.specId;
    poId = main.poId;
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (seeded.length > 0) {
      // 그림·EQ 첨부는 refType/refId 규약(FK 없음) — 회차·발주 cascade 로 안 지워진다.
      const reviews: any[] = await prisma.spPcbEqReview.findMany({
        where: { poId: { in: seeded } },
        select: { id: true },
      });
      if (reviews.length > 0) {
        await prisma.spFile.deleteMany({
          where: { refType: 'sp_pcb_eq_review', refId: { in: reviews.map((r) => r.id) } },
        });
      }
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_po_eq', refId: { in: seeded } } });
    }
    if (specIds.length > 0) {
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: { in: specIds.map((id) => id.toString()) }, createdAt: { gte: startedAt } },
      });
    }
    await cleanupPcbPos(seeded); // 회차·문항·이벤트는 발주 cascade, AI 잡은 헬퍼가 거둔다
    if (specIds.length > 0) await prisma.spOrderSpec.deleteMany({ where: { id: { in: specIds } } });
    if (order !== undefined) await deleteOrderHard(order.odId);
    if (mailpitUp) {
      const ids = (((await mailpitSearch(token))?.messages ?? []) as any[]).map((m) => String(m.ID));
      await mailpitDelete(ids);
    }

    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    expect(await prisma.spPcbEqReview.count({ where: { poId: { in: seeded } } }), '회차 잔재').toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('R1. 문항형 회차 발송 → 고객 회신 — 승인 전에는 협력사가 고객 답을 못 본다', async () => {
    expect((await uploadEq(P, poId, 'EQ-v1.xls')).status, 'EQ 업로드').toBe(200);
    const req = await api(P, 'POST', `${partnerPo(poId)}/eq-request`);
    expect(req.status, `승인요청: ${JSON.stringify(req.json)}`).toBe(200);

    const round = await askAndAnswer(poId, `좌측 하단에 넣어 주세요 ${token}`);
    r1 = round.reviewId;
    r1Items = round.items;
    expect(await adminReview(poId, r1)).toMatchObject({ status: 'answered', forwardedAt: null, version: 4 });
    expect((await partnerDetail(P, poId)).eqRounds, '전달 전 포털').toEqual([]);
    // 승인 전에는 추가 EQ 요청이 열리지 않는다(아직 승인된 것이 없다).
    const early = await api(P, 'POST', `${partnerPo(poId)}/eq-reopen`, { reason: '아직 승인 전입니다' });
    expect(early.status, JSON.stringify(early.json)).toBe(409);
    expect(early.json?.error).toBe('INVALID_STATUS');
  });

  test('R2. 승인 = 자동 전달 — forwardedAt·이벤트·포털 노출, 승인 메일 한 통에 회신 요약(전달 메일 없음)', async () => {
    const approve = await api(A, 'POST', `${adminPo(specId, poId)}/eq-approve`);
    expect(approve.status, `EQ 승인: ${JSON.stringify(approve.json)}`).toBe(200);
    expect((await poRow(poId))?.status).toBe('eq_done');

    const review = await adminReview(poId, r1);
    expect(review.status, '회신은 이력으로 남는다').toBe('answered');
    expect(review.forwardedAt, '승인과 함께 전달').not.toBeNull();
    expect(review.forwardedBy, '전달 주체 = 승인한 관리자').toBe('e2e-admin');
    expect(review.version, '전달도 버전을 올린다').toBe(5);
    expect(review.events.map((e: any) => e.action)).toEqual(['drafted', 'sent', 'answered', 'forwarded']);
    expect(review.events.at(-1)).toMatchObject({ actorRole: 'admin', actorMbId: 'e2e-admin', note: '승인과 함께 전달' });

    const rounds = (await partnerDetail(P, poId)).eqRounds;
    expect(rounds, '포털에 회신이 열린다').toHaveLength(1);
    expect(rounds[0]).toMatchObject({ reviewId: r1, roundNo: 1 });
    expect(rounds[0].items.map((i: any) => i.answer?.key)).toEqual(['B', 'A']);
    expect(rounds[0].items[0].answer.comment).toContain(token);

    // 메일 — 승인 알림 한 통에 회신 요약. 전달 메일은 따로 나가지 않는다.
    const decisions = await waitMailLogs('pcb_eq_decision', specId, 1);
    expect(decisions, '승인 메일 원장').toHaveLength(1);
    expect(decisions[0].params).toMatchObject({ approved: true, forwardedReviewIds: [String(r1)] });
    await sleep(800);
    expect(await mailLogs('pcb_eq_answer_forwarded', specId), '전달 메일은 따로 없다').toEqual([]);
    if (mailpitUp && decisions[0].status === 'sent') {
      const mail = await mailpitHit(projectName, '고객 회신 2문항');
      expect(mail, '승인 메일 수신').toBeTruthy();
      const html = String(mail.HTML);
      expect(String(mail.Subject)).toContain('EQ 승인');
      expect(html, '문항 번호:기호 요약').toContain('1:<b>B</b> · 2:<b>A</b>');
      expect(html).toContain('[고객 회신]에서');
      expect(html, '다음 행동 — 진행하거나 다시 묻는다').toContain('[추가 EQ 요청]');
      expect(html, '고객 신원 미노출').not.toContain(customerId);
    }
    // 이미 전달된 회차는 다시 전달할 수 없다(수동 버튼도 같은 사실을 본다).
    const again = await api(A, 'POST', `${reviewsBase(poId)}/${String(r1)}/forward`, { expectedVersion: 5 });
    expect(again.status).toBe(409);
    expect(again.json?.error).toBe('ALREADY_FORWARDED');
  });

  test('R3. 협력사 추가 EQ 요청 — 사유 필수 · 발주접수로 · 이력·reopenedAt·관리자 메일 · 첨부 잠금 해제', async () => {
    // 승인된 동안에는 첨부가 잠겨 있다.
    const locked = await uploadEq(P, poId, 'EQ-v2-early.xls');
    expect(locked.status, '승인 뒤 첨부는 잠김').toBe(409);
    expect(locked.json?.error).toBe('EQ_LOCKED');

    const noReason = await api(P, 'POST', `${partnerPo(poId)}/eq-reopen`, {});
    expect(noReason.status, '사유 없음').toBe(400);
    const blank = await api(P, 'POST', `${partnerPo(poId)}/eq-reopen`, { reason: ' ' });
    expect(blank.status, '빈 사유').toBe(400);
    expect((await poRow(poId))?.status, '거절되면 상태는 그대로').toBe('eq_done');

    const reason = `2번 답대로면 랜드가 부족합니다 — 패드 확대안 확인 필요 (${token})`;
    const reopen = await api(P, 'POST', `${partnerPo(poId)}/eq-reopen`, { reason });
    expect(reopen.status, `추가 EQ 요청: ${JSON.stringify(reopen.json)}`).toBe(200);

    const po = await poRow(poId);
    expect(po?.status).toBe('issued');
    expect((po?.eqHistory as any[]).at(-1)).toMatchObject({
      byRole: 'PARTNER',
      fromStatus: 'eq_done',
      toStatus: 'issued',
      note: reason,
    });
    // 회신 끝난 회차는 이력으로 남는다(닫히지 않는다).
    expect(await adminReview(poId, r1)).toMatchObject({ status: 'answered' });

    // 목록 — 왜 발주접수로 돌아왔는지: 반려가 아니라 추가 EQ 요청.
    const row = await workRow(projectName, poId);
    expect(row?.status).toBe('issued');
    expect(row?.reopenedAt, '워크큐 reopenedAt').not.toBeNull();
    expect(row?.rejectedAt, '반려가 아니다').toBeNull();
    const mine = await partnerListRow(P, poId);
    expect(mine?.reopenedAt, '포털 목록 reopenedAt').toBe(row.reopenedAt);
    expect(mine?.rejectedAt).toBeNull();
    expect(mine?.myTurn, '수정한 EQ 를 올릴 차례').toBe(true);

    // 운영자 메일 — 사유가 그대로 간다.
    const logs = await waitMailLogs('pcb_eq_reopened', specId, 1);
    expect(logs, '추가 EQ 요청 메일 원장').toHaveLength(1);
    expect(logs[0].params).toMatchObject({ poId: String(poId), partnerName: OWNER });
    expect(String(logs[0].params.reason)).toContain(token);
    expect(logs[0].sentBy).toBe(owner.mbId);
    if (mailpitUp && logs[0].status === 'sent') {
      const mail = await mailpitHit(token, '추가 EQ 를 요청했습니다');
      expect(mail, '운영자 메일 수신').toBeTruthy();
      expect(String(mail.Subject)).toContain('추가 EQ 요청');
      expect(String(mail.HTML)).toContain('패드 확대안 확인 필요');
      expect(String(mail.HTML)).toContain(`/app/admin/pcb/cases/${specId.toString()}`);
    }

    // 첨부 잠금이 풀린다 — 새로 올린 파일은 경계(추가 EQ 요청) 뒤의 보완분이다.
    const up = await uploadEq(P, poId, 'EQ-v2.xls');
    expect(up.status, `수정 EQ 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const files: any[] = (await partnerDetail(P, poId)).eq.files;
    expect(files.find((f) => f.name === 'EQ-v2.xls'), '보완분 표시').toMatchObject({ isLatest: true, afterReject: true });
    expect(files.find((f) => f.name === 'EQ-v1.xls')?.afterReject, '옛 파일은 보완분이 아니다').toBe(false);
  });

  test('R4. 재승인요청 → 관리자 fromPrevious 초안이 고객이 본 직전 회차에 이어진다', async () => {
    const req = await api(P, 'POST', `${partnerPo(poId)}/eq-request`);
    expect(req.status, `재승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    expect((await poRow(poId))?.status).toBe('eq_requested');
    // 이번 승인요청에는 아직 회차가 없어 행 요약은 비지만, 지난 회차가 있다는 것은 행이 안다(eqRoundCount).
    expect(await caseRow(specId, poId)).toMatchObject({ eqReview: null, eqRoundCount: 1 });

    const created = await api(A, 'POST', `${reviewsBase(poId)}/drafts`, { fromPrevious: true });
    expect(created.status, `개정 초안: ${JSON.stringify(created.json)}`).toBe(201);
    const r2 = created.json.data.review;
    expect(r2).toMatchObject({ status: 'draft', roundNo: 2, prevReviewId: r1 });
    expect(r2.items.map((i: any) => [i.prevItemId, i.change])).toEqual([
      [r1Items[0].id, 'same'],
      [r1Items[1].id, 'same'],
    ]);
    expect(r2.items[0].prev?.answer, '이전 답이 실린다').toMatchObject({ key: 'B' });
    // 행 요약은 새 회차(작성 중)를 말한다 — 1차의 전달 표시가 남아 있지 않다.
    expect((await workRow(projectName, poId))?.eqReview).toMatchObject({ status: 'draft', roundNo: 2, forwardedAt: null });
    expect((await caseRow(specId, poId))?.eqRoundCount, '작성 중인 초안도 번호가 있어 센다').toBe(2);
  });

  test('R5. 생산이 시작된 뒤에는 추가 EQ 요청 불가 — 남의 발주서는 404', async () => {
    // 승인이 작성 중인 초안을 닫는다(기존 규칙). 전달할 회신이 없으면 승인 메일에 회신 요약도 없다.
    const approve = await api(A, 'POST', `${adminPo(specId, poId)}/eq-approve`);
    expect(approve.status, JSON.stringify(approve.json)).toBe(200);
    // 안 나간 채 닫힌 초안은 번호도 작업공간 탭도 없다 — 회차 수가 1로 돌아온다.
    expect((await caseRow(specId, poId))?.eqRoundCount).toBe(1);
    const decisions = await waitMailLogs('pcb_eq_decision', specId, 2);
    expect(decisions.at(-1)?.params, '전달한 회신이 없는 승인').not.toHaveProperty('forwardedReviewIds');

    const stranger = await api(S, 'POST', `${partnerPo(poId)}/eq-reopen`, { reason: '남의 발주서' });
    expect(stranger.status, '남의 발주서').toBe(404);

    const start = await api(P, 'POST', `${partnerPo(poId)}/production-start`);
    expect(start.status, `생산 시작: ${JSON.stringify(start.json)}`).toBe(200);
    const late = await api(P, 'POST', `${partnerPo(poId)}/eq-reopen`, { reason: '생산 중인데 다시 묻고 싶습니다' });
    expect(late.status, JSON.stringify(late.json)).toBe(409);
    expect(late.json?.error).toBe('INVALID_STATUS');
    expect(String(late.json?.message)).toContain('생산 시작 전');
    const proxy = await api(A, 'POST', `${adminPo(specId, poId)}/eq-reopen`, { reason: '대행도 같은 문턱' });
    expect(proxy.status).toBe(409);
    expect(proxy.json?.error).toBe('INVALID_STATUS');
    expect((await poRow(poId))?.status).toBe('producing');
  });

  test('R6. 메탈마스크(스텐실)는 대상이 아니다 — 409 NOT_EQ_TRACK', async () => {
    // 확인 완료(eq_done)까지 간 스텐실 발주 — 좌표파일이 이미 고객에게 공개된 상태다.
    const mm = await stage(`E2E-REOPEN-MM-${token}`, 'metalMask', { partnerId: owner.id, status: 'eq_done' });
    const res = await api(P, 'POST', `${partnerPo(mm.poId)}/eq-reopen`, { reason: '좌표를 고치고 싶습니다' });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(res.json?.error).toBe('NOT_EQ_TRACK');
    const proxy = await api(A, 'POST', `${adminPo(mm.specId, mm.poId)}/eq-reopen`, { reason: '대행도 안 된다' });
    expect(proxy.status).toBe(409);
    expect(proxy.json?.error).toBe('NOT_EQ_TRACK');
    expect((await poRow(mm.poId))?.status, '상태는 그대로').toBe('eq_done');
    // 스텐실의 승인 취소(관리자 확인 취소)는 여전히 된다 — 고쳐야 하면 그 길이다.
    const revert = await api(A, 'POST', `${adminPo(mm.specId, mm.poId)}/eq-revert`);
    expect(revert.status, JSON.stringify(revert.json)).toBe(200);
  });

  test('R7. MD 위임 — 상위(MD 수주)에서는 차단, 하위 발주서에서 가능하고 상위에 미러된다', async () => {
    const name = `E2E-REOPEN-MD-${token}`;
    const top = await stage(name, 'standard', { partnerId: md.id, status: 'eq_done', fulfillmentMode: 'delegated' });
    const child = await createPcbPo({ specId: top.specId, partnerId: sub.id, parentPartnerId: md.id, status: 'eq_done' });
    seeded.push(child.id);
    const childPoId = Number(child.id);

    const onTop = await api(M, 'POST', `${partnerPo(top.poId)}/eq-reopen`, { reason: '상위에서 눌러 본다' });
    expect(onTop.status, JSON.stringify(onTop.json)).toBe(409);
    expect(onTop.json?.error).toBe('DELEGATED');

    const reason = `임피던스 재확인 필요 (${token}-md)`;
    const onChild = await api(S, 'POST', `${partnerPo(childPoId)}/eq-reopen`, { reason });
    expect(onChild.status, `하위 추가 EQ 요청: ${JSON.stringify(onChild.json)}`).toBe(200);
    const childRow = await poRow(childPoId);
    expect(childRow?.status).toBe('issued');
    expect((childRow?.eqHistory as any[]).at(-1)).toMatchObject({ byRole: 'PARTNER', toStatus: 'issued', note: reason });
    expect((await poRow(top.poId))?.status, '상위 상태 미러').toBe('issued');

    // MD 가 내려다보는 하위 발주 줄에도 이유가 선다.
    const watched = await partnerListRow(M, childPoId);
    expect(watched?.direction).toBe('issued');
    expect(watched?.reopenedAt, 'MD 목록 reopenedAt').not.toBeNull();
    const logs = await waitMailLogs('pcb_eq_reopened', top.specId, 1);
    expect(logs).toHaveLength(1);
    expect(logs[0].params).toMatchObject({ poId: String(childPoId), partnerName: sub.name });
  });

  test('R8. 관리자 대행 — byRole ADMIN·운영자 메일 없음 · 이미 수동 전달한 회차는 승인이 건드리지 않는다', async () => {
    const name = `E2E-REOPEN-PX-${token}`;
    const px = await stage(name, 'standard', { partnerId: owner.id, status: 'eq_requested' });
    const round = await askAndAnswer(px.poId, '대행 흐름 의견');

    // 승인 전에 수동으로 먼저 전달한다(협력사 의견을 먼저 들을 때의 길).
    const manual = await api(A, 'POST', `${reviewsBase(px.poId)}/${String(round.reviewId)}/forward`, { expectedVersion: 4 });
    expect(manual.status, JSON.stringify(manual.json)).toBe(200);
    const forwardedAt = manual.json.data.review.forwardedAt;
    expect((await waitMailLogs('pcb_eq_answer_forwarded', px.specId, 1)).length, '수동 전달 메일').toBe(1);

    const approve = await api(A, 'POST', `${adminPo(px.specId, px.poId)}/eq-approve`);
    expect(approve.status, JSON.stringify(approve.json)).toBe(200);
    const review = await adminReview(px.poId, round.reviewId);
    expect(review.forwardedAt, '이미 전달된 회차는 그대로').toBe(forwardedAt);
    expect(review.version).toBe(5);
    expect(review.events.filter((e: any) => e.action === 'forwarded'), '전달 이벤트는 하나').toHaveLength(1);
    const decision = (await waitMailLogs('pcb_eq_decision', px.specId, 1))[0];
    expect(decision?.params, '승인 메일에 회신 요약 없음').not.toHaveProperty('forwardedReviewIds');

    // 대행 — 협력사 라우트와 같은 본문·같은 가드.
    const noReason = await api(A, 'POST', `${adminPo(px.specId, px.poId)}/eq-reopen`, {});
    expect(noReason.status, '대행도 사유 필수').toBe(400);
    const wrongSpec = await api(A, 'POST', `${adminPo(specId, px.poId)}/eq-reopen`, { reason: '다른 Case 경로' });
    expect(wrongSpec.status, '경로의 Case 가 다르면 404').toBe(404);
    const reason = '협력사가 전화로 추가 확인을 요청(대행)';
    const proxy = await api(A, 'POST', `${adminPo(px.specId, px.poId)}/eq-reopen`, { reason });
    expect(proxy.status, `대행 추가 EQ 요청: ${JSON.stringify(proxy.json)}`).toBe(200);
    const po = await poRow(px.poId);
    expect(po?.status).toBe('issued');
    expect((po?.eqHistory as any[]).at(-1)).toMatchObject({ byRole: 'ADMIN', fromStatus: 'eq_done', toStatus: 'issued', note: reason });
    expect((await workRow(name, px.poId))?.reopenedAt).not.toBeNull();
    await sleep(800);
    expect(await mailLogs('pcb_eq_reopened', px.specId), '관리자가 직접 누른 것이라 운영자 메일 없음').toEqual([]);
  });

  test.skipIf(!EQ_AI)('L1. (실 LLM) 추가 EQ 요청 뒤 개정 엑셀로 재요청 → 2차 AI 초안이 동일·변경·신규로 이어진다', async () => {
    const settings = await api(A, 'GET', '/api/admin/settings/ai');
    expect(settings.status, JSON.stringify(settings.json)).toBe(200);
    const cur = settings.json.data.pcbEqParse;
    const original = { enabled: cur.enabled === true, model: String(cur.model), think: String(cur.think), extraInstructions: String(cur.extraInstructions ?? '') };
    const name = `E2E-REOPEN-AI-${token}`;
    const ai = await stage(name, 'standard', { partnerId: owner.id, status: 'issued' });
    const list = async (): Promise<any> => (await api(A, 'GET', reviewsBase(ai.poId))).json.data;
    const waitAi = async (jobIdNot?: string): Promise<any> => {
      const until = Date.now() + 150_000;
      let last: any = null;
      while (Date.now() < until) {
        last = await list();
        if (last.ai !== null && last.ai.status !== 'running' && last.ai.jobId !== jobIdNot) return last;
        await sleep(500);
      }
      throw new Error(`AI 분석이 끝나지 않았습니다: ${JSON.stringify(last?.ai)}`);
    };
    try {
      const on = await api(A, 'PATCH', '/api/admin/settings/ai', { pcbEqParse: { ...original, enabled: true } });
      expect(on.status).toBe(200);

      // 1차 — 승인요청 때 AI 가 초안을 만든다 → 발송 → 고객 회신.
      expect((await uploadEq(P, ai.poId, 'EQ-LHD-v1.xlsx', readFileSync(join(FIXTURES, 'a-lhd-bilingual.xlsx')), XLSX_MIME)).status).toBe(200);
      expect((await api(P, 'POST', `${partnerPo(ai.poId)}/eq-request`)).status).toBe(200);
      const first = await waitAi();
      expect(first.ai, JSON.stringify(first.ai)).toMatchObject({ status: 'done', trigger: 'auto' });
      const d1 = first.reviews[0];
      expect(d1).toMatchObject({ status: 'draft', aiDraft: true, roundNo: 1 });
      const sent = await api(A, 'POST', `${reviewsBase(ai.poId)}/${String(d1.id)}/send`, { expectedVersion: d1.version });
      expect(sent.status, JSON.stringify(sent.json)).toBe(200);
      // 고객은 문항마다 의견이 필요 없는 첫 선택지를 고른다(없으면 의견을 단다).
      const answers = sent.json.data.review.items.map((i: any) => {
        const plain = i.options.find((o: any) => !o.requiresComment);
        return plain !== undefined ? { itemId: i.id, key: plain.key } : { itemId: i.id, key: i.options[0].key, comment: '확인했습니다' };
      });
      const answered = await api(C, 'POST', `/api/pcb-eq-reviews/${String(d1.id)}/answer`, { expectedVersion: sent.json.data.review.version, answers, agree: true });
      expect(answered.status, JSON.stringify(answered.json)).toBe(200);

      // 승인(자동 전달) → 협력사가 회신을 보고 추가 EQ 를 요청한다.
      expect((await api(A, 'POST', `${adminPo(ai.specId, ai.poId)}/eq-approve`)).status).toBe(200);
      expect((await adminReview(ai.poId, d1.id)).forwardedAt, '승인과 함께 전달').not.toBeNull();
      const reopen = await api(P, 'POST', `${partnerPo(ai.poId)}/eq-reopen`, { reason: '고객 회신을 보고 2번 안을 바꿉니다(개정 EQ)' });
      expect(reopen.status, JSON.stringify(reopen.json)).toBe(200);

      // 개정 EQ(1·4·5 그대로, 2 변경, 3 삭제, 6 신규)를 올리고 다시 승인요청 → 2차 AI 초안.
      expect((await uploadEq(P, ai.poId, 'EQ-LHD-v2.xlsx', readFileSync(join(FIXTURES, 'e-lhd-v2.xlsx')), XLSX_MIME)).status).toBe(200);
      expect((await api(P, 'POST', `${partnerPo(ai.poId)}/eq-request`)).status).toBe(200);
      const second = await waitAi(first.ai.jobId);
      expect(second.ai, JSON.stringify(second.ai)).toMatchObject({ status: 'done', trigger: 'auto' });
      const d2 = second.reviews[0];
      expect(d2).toMatchObject({ status: 'draft', aiDraft: true, roundNo: 2, prevReviewId: d1.id });
      expect(second.ai.appliedReviewId).toBe(d2.id);
      const byNo = new Map<string, any>(d2.items.map((i: any) => [String(i.factoryNo), i]));
      const prevByNo = new Map<string, any>(sent.json.data.review.items.map((i: any) => [String(i.factoryNo), i]));
      expect([...byNo.keys()]).toEqual(['1', '2', '4', '5', '6']);
      for (const no of ['1', '4', '5']) {
        expect(byNo.get(no), `${no}번 동일`).toMatchObject({ change: 'same', prevItemId: prevByNo.get(no).id });
        // 고객이 1차에 고른 답이 이전 답으로 실린다(고객 화면이 미리 골라 준다).
        expect(byNo.get(no).prev?.answer?.key, `${no}번 이전 답`).toBe(answers.find((a: any) => a.itemId === prevByNo.get(no).id)?.key);
      }
      expect(byNo.get('2'), '2번 변경').toMatchObject({ change: 'changed', prevItemId: prevByNo.get('2').id });
      expect(byNo.get('6'), '6번 신규').toMatchObject({ change: 'new', prevItemId: null });
      // 분석 근거 = 추가 EQ 요청 뒤에 올린 최신 질의서.
      const v2: any = await getPrisma().spFile.findFirst({ where: { refType: 'sp_pcb_po_eq', refId: BigInt(ai.poId), originFileName: 'EQ-LHD-v2.xlsx' } });
      expect(d2.sourceFileIds).toEqual([Number(v2.id)]);
    } finally {
      const back = await api(A, 'PATCH', '/api/admin/settings/ai', { pcbEqParse: original });
      expect(back.status, '유스케이스 설정 복원').toBe(200);
    }
  }, 400_000);
});
