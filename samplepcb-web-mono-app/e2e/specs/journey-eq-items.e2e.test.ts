// EQ 문항형 회차(D20) — 공장 EQ 표를 고객이 **문항별로** 답한다.
//
// D16 확인 요청은 "문구 1개 + 승인/반려 1개"라 공장 EQ 표(문항 N개 × 선택지 A/B/C × 그림)를
// 담지 못했다. D20 은 같은 원장을 회차로 넓혀 draft → requested → answered 로 가고, 개정 EQ 는
// 새 회차로 직전 회차에 잇는다. 이 주행이 API 의 왕복 전체와 경계를 박제한다.
//
// 표적:
//   ① **초안은 고객에게 없다** — 목록·배지·결정·다운로드 어디에도(관리자 검토 필수, D20-1).
//   ② **낙관적 잠금** — 낡은 화면의 늦은 저장·발송·회신·전달은 409 VERSION_CONFLICT.
//   ③ **공급망 미노출** — 고객 응답에 공장 원문·원문 선택지·비공개 그림이 없다(D20-5).
//   ④ **회신 검증** — 전 문항·그 문항의 기호·'지시' 선택지의 의견 필수, 남의 회차는 404.
//   ⑤ **전달 전엔 협력사가 못 본다** — 포털 eqRounds 는 전달된 회차만.
//   ⑥ **개정 연결** — 반려 → 재요청 → fromPrevious 가 문항·그림을 잇고 이전 답을 싣는다.
//   ⑦ **대리 회신** — 채널(웹 제외)·근거 필수, 고객 메일 없음, 고객 화면엔 '담당자 확인'.
//   ⑧ **EQ 전이가 열린 초안을 닫는다** — 이벤트를 남기고, 안 나간 초안은 고객·번호에 안 잡힌다.
//
// 실행: cd e2e && pnpm exec cross-env PORTAL_E2E=1 NODE_OPTIONS=--use-system-ca vitest run journey-eq-items
// 사전: API(3333)·파일서버(그림 업로드)·Mailpit(8025, 없으면 sp_mail_log 대조만) · e2e/.env.e2e 고객 아이디.
// 무대는 e2e 소유 픽스처(주문+카트+스펙+발주)로 통째로 세우고 지운다(실주문 무접촉).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  MAILPIT_URL,
  RUN,
  api,
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
  mailpitDelete,
  mailpitMessage,
  mailpitSearch,
  requireCustomerCreds,
  signJwt,
  type G5OrderFixture,
  type PartnerFixture,
} from '../helpers';

// 수주 조직 — contactEmail 이 있어야 전달 메일(pcb_eq_answer_forwarded)이 실제로 나간다.
const OWNER = '협력2';

/** 1×1 투명 PNG — 그림 업로드는 내용이 아니라 형식·소유·공개 규칙을 본다. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe.skipIf(!RUN)('EQ 문항형 회차(D20) — 초안·발송·문항별 회신·전달·개정', () => {
  let owner: PartnerFixture;
  let A = ''; // 관리자
  let P = ''; // 협력사(수주)
  let C = ''; // 고객(주문자)
  let O = ''; // 남(다른 회원)
  let customerId = '';
  let order: G5OrderFixture | undefined;
  let specId = 0n;
  let poId = 0;
  let projectName = '';
  const seeded: bigint[] = [];
  const startedAt = new Date();
  const token = `e2eeqi${String(Date.now())}`; // Mailpit 검색 키(공백 없는 한 낱말)
  let mailpitUp = false;

  // 회차·문항 id — 케이스 사이에 이어 쓴다.
  let eqFileId = 0;
  let r1 = 0; // 1차 회차
  let r1Items: any[] = [];
  let sharedFigId = 0;
  let privateFigId = 0;
  let r2 = 0; // 2차(개정) 회차
  let openCountBase = 0;

  const adminBase = (): string => `/api/admin/pcb-eq-reviews/${String(poId)}`;
  const adminReview = async (reviewId: number): Promise<any> => {
    const res = await api(A, 'GET', adminBase());
    expect(res.status, `관리자 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return (res.json?.data?.reviews ?? []).find((r: any) => r.id === reviewId) ?? null;
  };
  const customerReviews = async (tok = C): Promise<any[]> => {
    const res = await api(tok, 'GET', `/api/pcb-eq-reviews?odId=${encodeURIComponent(order?.odId ?? '')}`);
    expect(res.status, `고객 조회: ${JSON.stringify(res.json)}`).toBe(200);
    return res.json?.data?.reviews ?? [];
  };
  const mine = async (scope: 'open' | 'all' = 'all'): Promise<any> => {
    const res = await api(C, 'GET', `/api/pcb-eq-reviews/mine?scope=${scope}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json?.data;
  };
  const partnerRounds = async (): Promise<any[]> => {
    const res = await api(P, 'GET', `/api/partner/pcb-pos/${String(poId)}`);
    expect(res.status, `포털 상세: ${JSON.stringify(res.json)}`).toBe(200);
    expect(Array.isArray(res.json?.data?.eqRounds), 'eqRounds 는 항상 배열').toBe(true);
    return res.json.data.eqRounds;
  };
  const poStatus = async (): Promise<string> =>
    String((await getPrisma().spPcbPo.findUnique({ where: { id: BigInt(poId) } }))?.status);

  /** multipart 업로드(관리자 그림·협력사 EQ 첨부 공용). */
  const upload = async (
    tok: string,
    path: string,
    file: { name: string; type: string; bytes: Uint8Array },
    fields: Record<string, string> = {},
  ): Promise<{ status: number; json: any }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    // 복사본(Uint8Array<ArrayBuffer>) — Buffer 의 ArrayBufferLike 는 BlobPart 가 아니다.
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

  const get = async (tok: string, path: string): Promise<Response> =>
    fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${tok}` } });

  /** 이 주행의 메일 원장(sp_mail_log) — kind·reviewId 로 좁힌다. */
  const mailLogs = async (kind: string, reviewId: number): Promise<any[]> => {
    const rows: any[] = await getPrisma().spMailLog.findMany({
      where: { kind, refType: 'pcb_spec', refId: specId.toString(), createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
    });
    return rows.filter((r) => String(r.params?.reviewId ?? '') === String(reviewId));
  };
  /** 메일은 비동기(void send) — 원장에 남을 때까지 폴링한다. */
  const waitMailLog = async (kind: string, reviewId: number): Promise<any> => {
    for (let i = 0; i < 20; i += 1) {
      const rows = await mailLogs(kind, reviewId);
      if (rows.length > 0) return rows[rows.length - 1];
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };
  const mailpitHit = async (query: string, mustContain: string): Promise<any> => {
    for (let i = 0; i < 20; i += 1) {
      const list = ((await mailpitSearch(query))?.messages ?? []) as any[];
      for (const m of list) {
        const full = await mailpitMessage(String(m.ID));
        if (String(full?.HTML ?? '').includes(mustContain)) return full;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };

  const ITEM_MARKING = (over: Record<string, unknown> = {}) => ({
    factoryNo: '1',
    category: 'marking',
    question: `UL 마킹을 보드에 넣을까요? (${token})`,
    questionOrig: '是否需要在板上加UL标记？',
    options: [
      { key: 'A', label: '공장 제안대로 넣지 않음', labelOrig: '按我司建议不加', recommended: true, requiresComment: false },
      { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置', recommended: false, requiresComment: true },
    ],
    figures: [] as { fileId: number; shared: boolean }[],
    prevItemId: null,
    change: null,
    ...over,
  });
  const ITEM_DRILL = (over: Record<string, unknown> = {}) => ({
    factoryNo: '2',
    category: 'drill',
    question: '0.2mm 비아를 0.25mm 로 키워도 될까요?',
    questionOrig: '0.2mm孔径加大到0.25mm可以吗？',
    options: [
      { key: 'A', label: '키워도 됩니다', labelOrig: '可以', recommended: true, requiresComment: false },
      { key: 'B', label: '안 됩니다', labelOrig: '不可以', recommended: false, requiresComment: false },
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

    owner = await getPartner(OWNER);
    if (owner.mbId === null) throw new Error(`${OWNER} 연결 계정 없음`);
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    P = signJwt({ mbId: owner.mbId, ttlSec: 3600 });
    customerId = requireCustomerCreds(1).id;
    C = signJwt({ mbId: customerId, ttlSec: 3600 });
    O = signJwt({ mbId: 'e2e-mdsub1', ttlSec: 3600 });

    // 무대 — 주문+카트+스펙+발주를 e2e 소유로(고객 목록은 주문의 카트 줄로 찾아 들어온다).
    order = await createG5OrderFixture(customerId, 'e2e EQ 문항형');
    projectName = `E2E-EQI-${token}`;
    const spec = await createOrderSpec({
      mbId: customerId,
      ctId: order.ctId,
      projectName,
      category: 'standard',
    });
    specId = spec.id as bigint;
    const po = await createPcbPo({ specId, partnerId: owner.id, status: 'issued' });
    poId = Number(po.id);
    seeded.push(po.id);
    openCountBase = Number((await mine('open'))?.openCount ?? 0);
  }, 120_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (poId > 0) {
      // 그림·EQ 첨부는 refType/refId 규약(FK 없음) — 회차·발주 cascade 로 안 지워진다.
      const reviews = await prisma.spPcbEqReview.findMany({
        where: { poId: BigInt(poId) },
        select: { id: true },
      });
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

    const residue = await countPcbResidue(seeded);
    expect(residue.pos, '시드 발주 잔재').toBe(0);
    expect(
      await prisma.spPcbEqReview.count({ where: { poId: BigInt(poId) } }),
      '회차 잔재',
    ).toBe(0);
    if (order !== undefined) expect(await countCartRows(order.odId), '시드 카트 잔재').toBe(0);
    await disconnectPrisma();
  }, 60_000);

  test('Q1. 초안은 EQ 승인요청 중에만 — 열린 회차는 발주서당 하나(작성 중 포함)', async () => {
    const early = await api(A, 'POST', `${adminBase()}/drafts`, {});
    expect(early.status, `발주접수 상태 초안: ${JSON.stringify(early.json)}`).toBe(409);
    expect(early.json?.error).toBe('NOT_EQ_REQUESTED');

    // 협력사가 EQ 질의서를 올리고 승인요청한다(기존 경로).
    const up = await upload(
      P,
      `/api/partner/pcb-pos/${String(poId)}/eq-files`,
      { name: 'EQ-factory.xls', type: 'application/vnd.ms-excel', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
      { fileType: 'eq' },
    );
    expect(up.status, `EQ 업로드: ${JSON.stringify(up.json)}`).toBe(200);
    const req = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(req.status, `승인요청: ${JSON.stringify(req.json)}`).toBe(200);
    expect(await poStatus()).toBe('eq_requested');
    const eqFile = await getPrisma().spFile.findFirst({
      where: { refType: 'sp_pcb_po_eq', refId: BigInt(poId) },
    });
    eqFileId = Number(eqFile?.id ?? 0);

    // 근거 첨부는 이 발주서의 EQ·Working 만.
    const bad = await api(A, 'POST', `${adminBase()}/drafts`, { sourceFileIds: [987654321] });
    expect(bad.status, JSON.stringify(bad.json)).toBe(400);
    expect(bad.json?.error).toBe('BAD_FILES');
    // 가져올 직전 회차가 없으면 fromPrevious 는 거절.
    const noPrev = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(noPrev.status).toBe(409);
    expect(noPrev.json?.error).toBe('NO_PREVIOUS');

    const created = await api(A, 'POST', `${adminBase()}/drafts`, { sourceFileIds: [eqFileId] });
    expect(created.status, `초안: ${JSON.stringify(created.json)}`).toBe(201);
    const review = created.json?.data?.review;
    r1 = Number(review?.id);
    expect(review).toMatchObject({
      status: 'draft',
      format: 'items',
      version: 1,
      roundNo: 1,
      prevReviewId: null,
      sourceFileIds: [eqFileId],
      items: [],
    });
    expect(review.events.map((e: any) => e.action)).toEqual(['drafted']);

    // 작성 중도 열린 회차다 — 초안 둘·문구형 동시 발송 모두 막힌다.
    const dup = await api(A, 'POST', `${adminBase()}/drafts`, {});
    expect(dup.status).toBe(409);
    expect(dup.json?.error).toBe('ALREADY_OPEN');
    const legacy = await api(A, 'POST', adminBase(), { message: '문구형 확인 요청', sharedFileIds: [] });
    expect(legacy.status).toBe(409);
    expect(legacy.json?.error).toBe('ALREADY_OPEN');

    // 관리자 행 요약에는 작성 중이 실린다(칩 "작성 중").
    const work = await api(A, 'GET', `/api/admin/pcb-pos?tab=all&pageSize=100&q=${encodeURIComponent(projectName)}`);
    expect(work.status, JSON.stringify(work.json)).toBe(200);
    const row = (work.json?.data?.items ?? []).find((i: any) => i.poId === poId);
    expect(row?.eqReview, '행 요약').toMatchObject({ status: 'draft', format: 'items', roundNo: 1, forwardedAt: null });
  });

  test('Q2. 초안은 고객에게 없다 — 목록·배지·결정·회신 어디에도', async () => {
    expect((await customerReviews()).some((r) => r.id === r1), '주문 상세 목록').toBe(false);
    const all = await mine('all');
    expect((all?.reviews ?? []).some((r: any) => r.id === r1), '마이페이지 목록').toBe(false);
    expect(Number(all?.openCount), '배지 수는 그대로').toBe(openCountBase);

    const decide = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r1)}/decide`, { decision: 'approve' });
    expect(decide.status, '초안에 결정 — 존재를 알리지 않는다').toBe(404);
    const answer = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r1)}/answer`, {
      expectedVersion: 1,
      answers: [{ itemId: 1, key: 'A' }],
      agree: true,
    });
    expect(answer.status, '초안에 회신').toBe(404);
  });

  test('Q3. 문항 저장 — 빈 초안은 못 보내고, 낡은 저장은 409', async () => {
    const empty = await api(A, 'POST', `${adminBase()}/${String(r1)}/send`, { expectedVersion: 1 });
    expect(empty.status, `빈 문항 발송: ${JSON.stringify(empty.json)}`).toBe(400);
    expect(empty.json?.error).toBe('NO_ITEMS');

    const saved = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 1,
      message: '',
      dueOn: null,
      items: [ITEM_MARKING(), ITEM_DRILL()],
    });
    expect(saved.status, `저장: ${JSON.stringify(saved.json)}`).toBe(200);
    const review = saved.json.data.review;
    expect(review.version).toBe(2);
    expect(review.items.map((i: any) => [i.seq, i.factoryNo, i.category])).toEqual([
      [0, '1', 'marking'],
      [1, '2', 'drill'],
    ]);
    r1Items = review.items;

    // 열어 둔 다른 화면의 늦은 저장 — 덮어쓰지 않는다.
    const stale = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 1,
      items: [ITEM_DRILL()],
    });
    expect(stale.status).toBe(409);
    expect(stale.json?.error).toBe('VERSION_CONFLICT');

    // 한 문항 안에서 기호가 겹치면 답을 가를 수 없다.
    const dupKey = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 2,
      items: [
        ITEM_MARKING({
          options: [
            { key: 'A', label: '하나', labelOrig: null, recommended: false, requiresComment: false },
            { key: 'A', label: '둘', labelOrig: null, recommended: false, requiresComment: false },
          ],
        }),
      ],
    });
    expect(dupKey.status).toBe(400);
    expect(dupKey.json?.error).toBe('DUPLICATE_OPTION_KEY');
    // 남의 문항 id 로 갱신할 수 없다.
    const foreign = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 2,
      items: [ITEM_MARKING({ id: 987654321 })],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.json?.error).toBe('BAD_ITEM');
  });

  test('Q4. 그림 — 이미지만, 공개 여부는 문항별, 지우면 문항에서도 빠진다', async () => {
    const figPath = `${adminBase()}/${String(r1)}/figures`;
    const notImage = await upload(A, figPath, { name: 'factory.xls', type: 'application/vnd.ms-excel', bytes: new Uint8Array([1, 2]) });
    expect(notImage.status, JSON.stringify(notImage.json)).toBe(400);
    expect(notImage.json?.error).toBe('BAD_FIGURE_TYPE');

    const shared = await upload(A, figPath, { name: 'ul-mark.png', type: 'image/png', bytes: PNG_1PX });
    expect(shared.status, `그림 업로드: ${JSON.stringify(shared.json)}`).toBe(200);
    expect(shared.json?.data?.figure).toMatchObject({ name: 'ul-mark.png', shared: false });
    sharedFigId = Number(shared.json.data.figure.fileId);
    const priv = await upload(A, figPath, { name: 'factory-logo.png', type: 'image/png', bytes: PNG_1PX });
    expect(priv.status).toBe(200);
    privateFigId = Number(priv.json.data.figure.fileId);
    const temp = await upload(A, figPath, { name: 'temp.webp', type: 'image/webp', bytes: PNG_1PX });
    expect(temp.status).toBe(200);
    const tempFigId = Number(temp.json.data.figure.fileId);

    // 그림 올리기는 버전을 올리지 않는다 — 열어 둔 편집기가 낡지 않게.
    const uploaded = await adminReview(r1);
    expect(uploaded?.version).toBe(2);
    // 올리고 아직 저장 안 한 그림은 '붙지 않은 그림'으로 보인다(올린 순·비공개) — 화면을 떠났다 와도 다시 붙일 수 있게.
    expect(uploaded?.looseFigures, '붙지 않은 그림').toEqual([
      { fileId: sharedFigId, name: 'ul-mark.png', size: PNG_1PX.length, shared: false },
      { fileId: privateFigId, name: 'factory-logo.png', size: PNG_1PX.length, shared: false },
      { fileId: tempFigId, name: 'temp.webp', size: PNG_1PX.length, shared: false },
    ]);
    expect(uploaded?.items.flatMap((i: any) => i.figures), '아직 어느 문항에도 없다').toEqual([]);

    const [m, d] = r1Items;
    const saved = await api(A, 'PUT', `${adminBase()}/${String(r1)}/draft`, {
      expectedVersion: 2,
      message: '',
      dueOn: '2099-12-31',
      items: [
        ITEM_MARKING({
          id: m.id,
          figures: [
            { fileId: sharedFigId, shared: true },
            { fileId: privateFigId, shared: false }, // 공장 로고 — 고객에게 안 간다
          ],
        }),
        ITEM_DRILL({ id: d.id, figures: [{ fileId: tempFigId, shared: true }] }),
      ],
    });
    expect(saved.status, `그림 붙여 저장: ${JSON.stringify(saved.json)}`).toBe(200);
    expect(saved.json.data.review.version).toBe(3);
    expect(saved.json.data.review.items.map((i: any) => i.id), '문항 id 유지(갱신)').toEqual([m.id, d.id]);
    // 문항에 붙여 저장하면 붙지 않은 그림에서 빠진다(공개 여부와 무관).
    expect(saved.json.data.review.looseFigures, '붙이면 빠진다').toEqual([]);

    // 지우면 붙어 있던 문항에서도 빠진다(버전 그대로).
    const del = await api(A, 'DELETE', `${figPath}/${String(tempFigId)}`);
    expect(del.status, `그림 삭제: ${JSON.stringify(del.json)}`).toBe(200);
    expect(del.json.data.review.version).toBe(3);
    expect(del.json.data.review.items[1].figures).toEqual([]);
    expect(del.json.data.review.looseFigures, '지운 그림은 붙지 않은 그림으로도 안 남는다').toEqual([]);
    expect(
      await getPrisma().spFile.count({ where: { id: BigInt(tempFigId) } }),
      '그림 행 삭제',
    ).toBe(0);

    // 관리자 열람 — 인라인 이미지.
    const view = await get(A, `${figPath}/${String(privateFigId)}`);
    expect(view.status).toBe(200);
    expect(view.headers.get('content-type')).toContain('image/png');
    expect(view.headers.get('content-disposition') ?? '').toMatch(/^inline/);
    r1Items = saved.json.data.review.items;
  });

  test('Q5. 발송 — 낡은 버전은 409, 보내면 requested·이벤트·고객 메일(링크만)', async () => {
    const stale = await api(A, 'POST', `${adminBase()}/${String(r1)}/send`, { expectedVersion: 2 });
    expect(stale.status).toBe(409);
    expect(stale.json?.error).toBe('VERSION_CONFLICT');

    const sent = await api(A, 'POST', `${adminBase()}/${String(r1)}/send`, { expectedVersion: 3 });
    expect(sent.status, `발송: ${JSON.stringify(sent.json)}`).toBe(200);
    const review = sent.json.data.review;
    expect(review).toMatchObject({ status: 'requested', version: 4, roundNo: 1 });
    expect(review.events.map((e: any) => e.action)).toEqual(['drafted', 'sent']);

    const log = await waitMailLog('pcb_eq_customer_request', r1);
    expect(log, '고객 확인 메일 원장').toBeTruthy();
    expect(log.params).toMatchObject({ format: 'items', itemCount: 2 });
    expect(['sent', 'skipped']).toContain(log.status);
    if (mailpitUp && log.status === 'sent') {
      const mail = await mailpitHit(projectName, '확인할 항목');
      expect(mail, '고객 메일 수신').toBeTruthy();
      const html = String(mail.HTML);
      expect(html).toContain('<b>2개</b>');
      expect(html, '버튼은 주문 상세 딥링크 하나').toContain(`#eq-${String(r1)}`);
      expect(html).toContain('누르는 것만으로는 승인되지 않습니다');
      expect(html, '협력사명 금지').not.toContain(OWNER);
      expect(html, '문항 원문을 싣지 않는다').not.toContain('是否需要');
    }
  });

  test('Q6. 고객 조회 — 원문·원문 선택지·비공개 그림이 없고, 공개 그림은 인라인으로 열린다', async () => {
    const review = (await customerReviews()).find((r) => r.id === r1);
    expect(review, '고객 목록에 발송 회차').toBeTruthy();
    expect(review).toMatchObject({ status: 'requested', format: 'items', roundNo: 1, answeredByAdmin: false });
    expect(review.message, '빈 머리말은 기본 안내문').toContain('항목마다');
    expect(review.dueOn).not.toBeNull();
    const raw = JSON.stringify(review);
    expect(raw, '공장 원문 질문').not.toContain('是否需要');
    expect(raw, '공장 원문 선택지').not.toContain('贵司指示');
    expect(raw).not.toContain('labelOrig');
    expect(raw).not.toContain('questionOrig');
    expect(raw, '비공개 그림').not.toContain('factory-logo.png');
    expect(review.items[0].figures).toEqual([{ fileId: sharedFigId, name: 'ul-mark.png', size: PNG_1PX.length }]);
    expect(review.items[0].options[0]).toEqual({
      key: 'A',
      label: '공장 제안대로 넣지 않음',
      recommended: true,
      requiresComment: false,
    });

    expect(Number((await mine('open'))?.openCount), '배지 +1').toBe(openCountBase + 1);

    const fig = await get(C, `/api/pcb-eq-reviews/${String(r1)}/files/${String(sharedFigId)}`);
    expect(fig.status, '공개 그림').toBe(200);
    expect(fig.headers.get('content-type')).toContain('image/png');
    expect(fig.headers.get('content-disposition') ?? '').toMatch(/^inline/);
    expect((await get(C, `/api/pcb-eq-reviews/${String(r1)}/files/${String(privateFigId)}`)).status, '비공개 그림').toBe(404);
    expect((await get(O, `/api/pcb-eq-reviews/${String(r1)}/files/${String(sharedFigId)}`)).status, '남의 그림').toBe(404);
    expect((await get(C, `/api/pcb-eq-reviews/${String(r1)}/files/${String(eqFileId)}`)).status, '협력사 EQ 원본').toBe(404);
    expect((await customerReviews(O)).some((r) => r.id === r1), '남의 주문 목록').toBe(false);
  });

  test('Q7. 고객 회신 — 전 문항·그 문항의 기호·지시 선택지 의견, 남의 회차 404, 문구형 결정 거부', async () => {
    const [m, d] = r1Items;
    const path = `/api/pcb-eq-reviews/${String(r1)}/answer`;
    const send = (tok: string, body: unknown) => api(tok, 'POST', path, body);

    const missing = await send(C, { expectedVersion: 4, answers: [{ itemId: m.id, key: 'A' }], agree: true });
    expect(missing.status, JSON.stringify(missing.json)).toBe(400);
    expect(missing.json?.error).toBe('ANSWERS_INCOMPLETE');

    const badKey = await send(C, {
      expectedVersion: 4,
      answers: [{ itemId: m.id, key: 'Z' }, { itemId: d.id, key: 'A' }],
      agree: true,
    });
    expect(badKey.status).toBe(400);
    expect(badKey.json?.error).toBe('ANSWER_BAD_KEY');

    const noComment = await send(C, {
      expectedVersion: 4,
      answers: [{ itemId: m.id, key: 'B' }, { itemId: d.id, key: 'A' }],
      agree: true,
    });
    expect(noComment.status).toBe(400);
    expect(noComment.json?.error).toBe('COMMENT_REQUIRED');

    const noAgree = await send(C, {
      expectedVersion: 4,
      answers: [{ itemId: m.id, key: 'A' }, { itemId: d.id, key: 'A' }],
      agree: false,
    });
    expect(noAgree.status, '동의 없이는 제출 불가').toBe(400);

    const other = await send(O, {
      expectedVersion: 4,
      answers: [{ itemId: m.id, key: 'A' }, { itemId: d.id, key: 'A' }],
      agree: true,
    });
    expect(other.status, '남의 회차').toBe(404);

    const stale = await send(C, {
      expectedVersion: 3,
      answers: [{ itemId: m.id, key: 'A' }, { itemId: d.id, key: 'A' }],
      agree: true,
    });
    expect(stale.status).toBe(409);
    expect(stale.json?.error).toBe('VERSION_CONFLICT');

    const decide = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r1)}/decide`, { decision: 'approve' });
    expect(decide.status, '문구형 결정은 문항형에 거부').toBe(409);
    expect(decide.json?.error).toBe('WRONG_FORMAT');

    const ok = await send(C, {
      expectedVersion: 4,
      answers: [
        { itemId: m.id, key: 'B', comment: `좌측 하단에 넣어 주세요 ${token}` },
        { itemId: d.id, key: 'A' },
      ],
      agree: true,
    });
    expect(ok.status, `회신: ${JSON.stringify(ok.json)}`).toBe(200);
    expect(ok.json.data.review).toMatchObject({ status: 'answered', answeredByAdmin: false, version: 5 });
    expect(ok.json.data.review.items.map((i: any) => i.answer?.key)).toEqual(['B', 'A']);

    const again = await send(C, {
      expectedVersion: 5,
      answers: [{ itemId: m.id, key: 'A' }, { itemId: d.id, key: 'A' }],
      agree: true,
    });
    expect(again.status, '재제출').toBe(409);
    expect(again.json?.error).toBe('NOT_REQUESTED');
    expect(Number((await mine('open'))?.openCount), '배지는 다시 원래대로').toBe(openCountBase);
  });

  test('Q8. 관리자 화면 — answered·주체·채널·이벤트, 행 요약 "회신 도착 · 전달 필요", 관리자 메일', async () => {
    const review = await adminReview(r1);
    expect(review).toMatchObject({
      status: 'answered',
      answeredRole: 'customer',
      answerChannel: 'web',
      forwardedAt: null,
      decidedBy: customerId,
    });
    expect(review.events.map((e: any) => e.action)).toEqual(['drafted', 'sent', 'answered']);
    expect(review.events[2]).toMatchObject({ actorRole: 'customer', channel: 'web', note: '1:B · 2:A' });
    expect(review.items[0].answer).toEqual({ key: 'B', comment: `좌측 하단에 넣어 주세요 ${token}` });

    const work = await api(A, 'GET', `/api/admin/pcb-pos?tab=all&pageSize=100&q=${encodeURIComponent(projectName)}`);
    const row = (work.json?.data?.items ?? []).find((i: any) => i.poId === poId);
    expect(row?.eqReview).toMatchObject({ status: 'answered', format: 'items', roundNo: 1, forwardedAt: null });
    expect(row?.adminTurn, '회신이 오면 공은 관리자에게').toBe(true);

    // 수신처는 자사 조직 메일 — 로컬 시드엔 비어 있을 수 있다. 그때도 원장에는 skipped 로 남는다.
    const log = await waitMailLog('pcb_eq_customer_decision', r1);
    expect(log, '관리자 알림 원장').toBeTruthy();
    expect(log.params).toMatchObject({ format: 'items' });
    const house = await getPrisma().spPartner.findFirst({ where: { type: 'house' } });
    if ((house?.contactEmail ?? '') === '') {
      expect(log).toMatchObject({ status: 'skipped', reason: 'missing_recipient' });
    } else {
      expect(log.status).toBe('sent');
      expect(String(log.subject)).toContain('고객 회신');
    }
  });

  test('Q9. 전달 — 전엔 포털에 없고, 전달하면 문항별 원문·기호·의견이 보인다(협력사 메일)', async () => {
    expect(await partnerRounds(), '전달 전 포털').toEqual([]);

    const stale = await api(A, 'POST', `${adminBase()}/${String(r1)}/forward`, { expectedVersion: 4 });
    expect(stale.status).toBe(409);
    expect(stale.json?.error).toBe('VERSION_CONFLICT');
    const fwd = await api(A, 'POST', `${adminBase()}/${String(r1)}/forward`, { expectedVersion: 5 });
    expect(fwd.status, `전달: ${JSON.stringify(fwd.json)}`).toBe(200);
    expect(fwd.json.data.review.forwardedAt).not.toBeNull();
    expect(fwd.json.data.review.forwardedBy).toBe('e2e-admin');
    expect(fwd.json.data.review.events.at(-1)?.action).toBe('forwarded');
    const twice = await api(A, 'POST', `${adminBase()}/${String(r1)}/forward`, { expectedVersion: 6 });
    expect(twice.status).toBe(409);
    expect(twice.json?.error).toBe('ALREADY_FORWARDED');

    const rounds = await partnerRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ reviewId: r1, roundNo: 1 });
    expect(rounds[0].items[0]).toMatchObject({
      factoryNo: '1',
      questionOrig: '是否需要在板上加UL标记？',
      answer: { key: 'B', comment: `좌측 하단에 넣어 주세요 ${token}` },
    });
    expect(rounds[0].items[0].options.map((o: any) => o.key)).toEqual(['A', 'B']);
    expect(JSON.stringify(rounds[0]), '고객 신원은 협력사에 안 간다').not.toContain(customerId);

    const log = await waitMailLog('pcb_eq_answer_forwarded', r1);
    expect(log, '협력사 전달 메일 원장').toBeTruthy();
    expect(log.status).toBe('sent');
    if (mailpitUp) {
      const mail = await mailpitHit(token, 'Round 1');
      expect(mail, '협력사 메일 수신').toBeTruthy();
      const html = String(mail.HTML);
      expect(html).toContain('No. 1');
      expect(html).toContain(`/app/partner/pcb/pos/${String(poId)}`);
      expect(html, '고객 신원 미노출').not.toContain(customerId);
    }
  });

  test('Q10. 개정 — 반려 → 재요청 → fromPrevious 가 문항·그림을 잇고 이전 답을 싣는다', async () => {
    const reject = await api(A, 'POST', `/api/admin/pcb-projects/${specId.toString()}/pos/${String(poId)}/eq-reject`, {
      reason: '공장 개정 EQ 대기',
    });
    expect(reject.status, JSON.stringify(reject.json)).toBe(200);
    expect(await poStatus()).toBe('issued');
    expect((await adminReview(r1))?.status, '회신 끝난 회차는 전이로 닫히지 않는다').toBe('answered');

    const again = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);

    const created = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(created.status, `개정 초안: ${JSON.stringify(created.json)}`).toBe(201);
    const review = created.json.data.review;
    r2 = Number(review.id);
    expect(review).toMatchObject({ status: 'draft', roundNo: 2, prevReviewId: r1 });
    expect(review.items.map((i: any) => [i.prevItemId, i.change])).toEqual([
      [r1Items[0].id, 'same'],
      [r1Items[1].id, 'same'],
    ]);
    expect(review.items[0].prev).toMatchObject({
      itemId: r1Items[0].id,
      answer: { key: 'B' },
      answerLabel: '위치를 지정하겠습니다',
    });
    // 그림은 새 회차 앞으로 복제 — 같은 실파일(pathToken), 공개 여부 유지.
    const figs = review.items[0].figures;
    expect(figs.map((f: any) => [f.name, f.shared])).toEqual([
      ['ul-mark.png', true],
      ['factory-logo.png', false],
    ]);
    expect(figs.every((f: any) => f.fileId !== sharedFigId && f.fileId !== privateFigId), '새 행').toBe(true);
    const copy = await getPrisma().spFile.findUnique({ where: { id: BigInt(figs[0].fileId) } });
    const orig = await getPrisma().spFile.findUnique({ where: { id: BigInt(sharedFigId) } });
    expect(copy?.refId).toBe(BigInt(r2));
    expect(copy?.pathToken, '같은 실파일').toBe(orig?.pathToken);
    expect(review.events[0].note).toContain('직전 회차');
  });

  test('Q11. 대리 회신 — 채널·근거 필수, 고객 메일 없음, 고객 화면엔 담당자 확인·이전 답', async () => {
    const before = (await adminReview(r2)).items;
    // 2번 문항은 공장이 고쳐 왔다(변경), 3번 문항은 새로 생겼다(신규).
    const saved = await api(A, 'PUT', `${adminBase()}/${String(r2)}/draft`, {
      expectedVersion: 1,
      items: [
        ITEM_MARKING({ id: before[0].id, prevItemId: r1Items[0].id, change: 'same', figures: before[0].figures.map((f: any) => ({ fileId: f.fileId, shared: f.shared })) }),
        ITEM_DRILL({ id: before[1].id, prevItemId: r1Items[1].id, change: 'changed', question: '0.2mm 비아를 0.3mm 로 키워도 될까요?' }),
        ITEM_DRILL({ factoryNo: '3', category: 'outline', question: '외형 공차를 ±0.15 로 해도 될까요?', change: 'new' }),
      ],
    });
    expect(saved.status, `개정 저장: ${JSON.stringify(saved.json)}`).toBe(200);
    // 직전 회차 밖 문항은 이을 수 없다.
    const badPrev = await api(A, 'PUT', `${adminBase()}/${String(r2)}/draft`, {
      expectedVersion: 2,
      items: [ITEM_MARKING({ prevItemId: 987654321 })],
    });
    expect(badPrev.status).toBe(400);
    expect(badPrev.json?.error).toBe('BAD_PREV_ITEM');

    const sent = await api(A, 'POST', `${adminBase()}/${String(r2)}/send`, { expectedVersion: 2 });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const items = sent.json.data.review.items;

    const cust = (await customerReviews()).find((r) => r.id === r2);
    expect(cust).toMatchObject({ roundNo: 2, status: 'requested' });
    expect(cust.items.map((i: any) => i.change)).toEqual(['same', 'changed', 'new']);
    expect(cust.items[0].prev, '고객이 본 회차의 이전 답').toMatchObject({ answer: { key: 'B' } });

    const path = `${adminBase()}/${String(r2)}/answer`;
    const allA = items.map((i: any) => ({ itemId: i.id, key: 'A' }));
    const web = await api(A, 'POST', path, { expectedVersion: 3, answers: allA, channel: 'web', note: '전화로 확인' });
    expect(web.status, '대리 회신 채널에 웹 불가').toBe(400);
    const noNote = await api(A, 'POST', path, { expectedVersion: 3, answers: allA, channel: 'phone' });
    expect(noNote.status, '근거 메모 필수').toBe(400);
    const partial = await api(A, 'POST', path, {
      expectedVersion: 3,
      answers: allA.slice(0, 2),
      channel: 'phone',
      note: '전화로 확인',
    });
    expect(partial.status).toBe(400);
    expect(partial.json?.error).toBe('ANSWERS_INCOMPLETE');

    const ok = await api(A, 'POST', path, {
      expectedVersion: 3,
      answers: allA,
      channel: 'phone',
      note: '고객 담당자와 통화로 확인',
    });
    expect(ok.status, `대리 회신: ${JSON.stringify(ok.json)}`).toBe(200);
    const review = ok.json.data.review;
    expect(review).toMatchObject({ status: 'answered', answeredRole: 'admin', answerChannel: 'phone', decidedBy: 'e2e-admin' });
    const ev = review.events.at(-1);
    expect(ev).toMatchObject({ action: 'proxy_answered', actorRole: 'admin', channel: 'phone' });
    expect(String(ev.note)).toContain('통화로 확인');

    expect((await customerReviews()).find((r) => r.id === r2)?.answeredByAdmin, '고객 화면 안내').toBe(true);
    // 대리 회신은 관리자 알림 메일을 만들지 않는다(관리자가 넣은 답이다).
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mailLogs('pcb_eq_customer_decision', r2), '대리 회신 메일 없음').toEqual([]);

    // 문구형 결정은 회신 뒤에도 문항형에 거부.
    const decide = await api(C, 'POST', `/api/pcb-eq-reviews/${String(r2)}/decide`, { decision: 'reject', note: '반대' });
    expect(decide.status).toBe(409);
    expect(decide.json?.error).toBe('WRONG_FORMAT');
    // 아직 전달하지 않은 회차는 포털에 없다.
    expect((await partnerRounds()).map((r: any) => r.reviewId)).toEqual([r1]);
  });

  test('Q12. EQ 전이가 열린 초안을 닫는다 — 이벤트를 남기고, 안 나간 초안은 고객·번호에 안 잡힌다', async () => {
    // 2차는 회신 끝(answered)이라 열린 회차가 없다 — 3차 초안을 연다(2차에서 가져오기).
    const r3res = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(r3res.status, JSON.stringify(r3res.json)).toBe(201);
    const r3 = Number(r3res.json.data.review.id);
    expect(r3res.json.data.review.roundNo).toBe(3);

    // 협력사가 요청을 물린다(eq_requested → issued) — 물어볼 EQ 가 사라졌다.
    const revert = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-revert`);
    expect(revert.status, JSON.stringify(revert.json)).toBe(200);
    const closed = await adminReview(r3);
    expect(closed.status).toBe('canceled');
    expect(closed.roundNo, '안 나간 초안은 번호가 없다').toBeNull();
    expect(closed.events.at(-1)).toMatchObject({ action: 'canceled', actorRole: 'system', note: '발주 EQ 상태 변경' });
    expect((await adminReview(r2))?.status, '회신 끝난 2차는 그대로').toBe('answered');
    expect((await mine('all'))?.reviews.some((r: any) => r.id === r3), '고객 이력에 없다').toBe(false);
    expect((await customerReviews()).some((r) => r.id === r3)).toBe(false);

    // 다시 요청 → 직전 회차에서 가져오면 **닫힌 초안의 편집은 살리되** 고객이 본 2차에 잇는다.
    const re = await api(P, 'POST', `/api/partner/pcb-pos/${String(poId)}/eq-request`);
    expect(re.status, JSON.stringify(re.json)).toBe(200);
    const r4res = await api(A, 'POST', `${adminBase()}/drafts`, { fromPrevious: true });
    expect(r4res.status, JSON.stringify(r4res.json)).toBe(201);
    const r4 = r4res.json.data.review;
    const r2Items = (await adminReview(r2)).items;
    expect(r4.roundNo, '닫힌 초안을 건너뛴 번호').toBe(3);
    expect(r4.prevReviewId, '고객이 본 회차에 잇는다').toBe(r2);
    expect(r4.items.map((i: any) => i.prevItemId)).toEqual(r2Items.map((i: any) => i.id));
    expect(r4.items[0].prev?.answer?.key).toBe('A');

    // 관리자 취소(작성 중도 취소할 수 있다) — 이벤트 actorRole admin.
    const cancel = await api(A, 'DELETE', `${adminBase()}/${String(r4.id)}`);
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    const canceled = (cancel.json.data.reviews as any[]).find((r) => r.id === r4.id);
    expect(canceled.status).toBe('canceled');
    expect(canceled.events.at(-1)).toMatchObject({ action: 'canceled', actorRole: 'admin', actorMbId: 'e2e-admin' });

    // 남은 고객 이력 = 1차·2차(둘 다 회신) — 작성 중·안 나간 회차는 끝까지 안 보인다.
    const visible = (await customerReviews()).map((r) => [r.id, r.roundNo, r.status]);
    expect(visible).toEqual([
      [r2, 2, 'answered'],
      [r1, 1, 'answered'],
    ]);
  });
});
