import { beforeEach, describe, expect, it, vi } from 'vitest';

// 러너의 분기 — 가드(자동은 조용히 건너뜀)·잡 수명·재시도·재사용·적용/미적용. LLM·DB·파일 서버는 전부 가짜다
// (분석 자체는 lib/pcb-eq-extract/analyze 의 테스트가, 써 넣기는 e2e 가 본다).

interface JobRow {
  id: string;
  useCase: string;
  targetType: string | null;
  targetId: bigint | null;
  mbId: string;
  status: string;
  stage: string | null;
  model: string;
  promptVersion: string;
  inputHash: string;
  resultJson: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

// vi.mock 팩토리가 끌어 쓰는 것은 전부 hoisted 안에 둔다(가짜 잡 테이블 포함).
const h = vi.hoisted(() => {
  const table: JobRow[] = [];
  // 조건(where)의 일부만 흉내 낸다 — 러너가 쓰는 모양(status·id·inputHash·startedAt lt/gte)만.
  const matches = (row: JobRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { lt?: Date; gte?: Date };
        const time = value instanceof Date ? value.getTime() : 0;
        if (c.lt !== undefined) return time < c.lt.getTime();
        if (c.gte !== undefined) return time >= c.gte.getTime();
        return true;
      }
      return value === cond;
    });
  const spAiJob = {
    findFirst: (args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        [...table].sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime()).find((r) => matches(r, args.where)) ?? null,
      ),
    findUnique: (args: { where: { id: string } }) => Promise.resolve(table.find((r) => r.id === args.where.id) ?? null),
    findMany: (args: { where: Record<string, unknown> }) => Promise.resolve(table.filter((r) => matches(r, args.where))),
    create: (args: { data: Omit<JobRow, 'error' | 'finishedAt'> }) => {
      const row: JobRow = { ...args.data, error: null, finishedAt: null };
      table.push(row);
      return Promise.resolve(row);
    },
    updateMany: (args: { where: Record<string, unknown>; data: Partial<JobRow> }) => {
      const hit = table.filter((r) => matches(r, args.where));
      for (const row of hit) Object.assign(row, args.data);
      return Promise.resolve({ count: hit.length });
    },
  };
  return {
    table,
    spAiJob,
    poFindUnique: vi.fn(),
    reviewFindFirst: vi.fn(),
    fileFindMany: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    analyze: vi.fn(),
    apply: vi.fn(),
    cleanup: vi.fn(),
    runtime: vi.fn(),
    chat: vi.fn(),
  };
});

const jobs = (): JobRow[] => h.table;

vi.mock('../prisma', () => ({
  prisma: {
    spPcbPo: { findUnique: h.poFindUnique },
    spPcbEqReview: { findFirst: h.reviewFindFirst },
    spFile: { findMany: h.fileFindMany },
    spAiJob: h.spAiJob,
    $transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({ $queryRaw: () => Promise.resolve([{ id: 7n }]), spAiJob: h.spAiJob }),
  },
}));
vi.mock('../file-server', () => ({ downloadFromFileServer: h.download, uploadToFileServer: h.upload }));
vi.mock('../pcb-eq-extract/analyze', () => ({ analyzeEqFile: h.analyze }));
vi.mock('../pcb-eq-review', () => ({
  PCB_EQ_OPEN_STATUSES: ['draft', 'requested'],
  applyEqAiDraft: h.apply,
  deleteUnsharedEqFigureBlobs: h.cleanup,
}));
vi.mock('./usecases', () => ({
  PCB_EQ_PARSE_USECASE: 'pcb.eq-parse',
  getAiUsecaseRuntime: h.runtime,
  getAiConnection: () => Promise.resolve({ baseUrl: 'http://ai.local', apiKey: null }),
  toOllamaThink: (level: string) => (level === 'off' ? false : level),
}));
vi.mock('./runner', () => ({ chatWithOptionFallback: h.chat }));

import { parseEqAiJobMeta } from '../pcb-eq-ai';
import { isRetryableChatError, startEqAnalysis } from './pcb-eq-runner';

const log = { info: vi.fn(), warn: vi.fn() };
const auto = { trigger: 'auto' as const, actorMbId: null, replaceDraft: false, log };
const manual = (replaceDraft = false) => ({ trigger: 'manual' as const, actorMbId: 'admin', replaceDraft, log });

const DRAFT = {
  header: { customerPartNo: null, factoryPartNo: null, issuedOn: null },
  items: [
    {
      factoryNo: '1',
      category: 'marking',
      question: 'UL 마킹을 넣을까요?',
      questionOrig: '是否加UL标记?',
      options: [{ key: 'A', label: '넣음', labelOrig: '加', recommended: false, requiresComment: false }],
      figureRefs: ['img-2'],
    },
    {
      factoryNo: '2',
      category: 'drill',
      question: '비아를 키워도 될까요?',
      questionOrig: '孔径加大可以吗?',
      options: [{ key: 'A', label: '됨', labelOrig: '可以', recommended: false, requiresComment: false }],
      figureRefs: [],
    },
  ],
};
const OK_RESULT = {
  ok: true as const,
  draft: DRAFT,
  itemFlags: [[], [{ code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' }]],
  images: [{ ref: 'img-2', name: 'figure-2.png', ext: 'png', mime: 'image/png', data: Buffer.from('png') }],
  warnings: ['AI 출력 정리: 빈 선택지 제거'],
  promptChars: 1234,
};

/** analyze 가짜 — 러너가 준 chat 을 한 번 부르고(LLM 원출력이 잡에 남는지 보려고) 정해 둔 결과를 돌려준다. */
const analyzeReturning = (result: unknown) =>
  h.analyze.mockImplementation(async (_input: unknown, chat: (p: string, s: unknown) => Promise<string>) => {
    await chat('PROMPT', { type: 'object' });
    return result;
  });

const lastJob = (): JobRow => {
  const row = jobs().at(-1);
  if (row === undefined) throw new Error('잡이 없습니다');
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.table.length = 0;
  h.poFindUnique.mockResolvedValue({ status: 'eq_requested', spec: { category: 'standard' } });
  h.reviewFindFirst.mockResolvedValue(null);
  h.fileFindMany.mockResolvedValue([
    { id: 31n, fileType: 'eq', writeDate: new Date('2026-10-11T00:00:00Z'), originFileName: 'EQ-v1.xlsx', pathToken: 'tok-31' },
    { id: 32n, fileType: 'working', writeDate: new Date('2026-10-11T00:00:01Z'), originFileName: 'working.zip', pathToken: 'tok-32' },
  ]);
  h.download.mockResolvedValue({ buffer: Buffer.from('xlsx-bytes'), contentType: 'application/octet-stream' });
  h.upload.mockResolvedValue([{ uploadFileName: 'up.png', originFileName: 'figure-2.png', pathToken: 'fig-tok', size: 3 }]);
  h.runtime.mockResolvedValue({
    enabled: true,
    model: 'kimi-k3',
    think: 'low',
    extraInstructions: '',
    timeoutMs: 120_000,
    def: { defaultModel: 'kimi-k3', promptVersion: 'eq-parse-v3', think: 'low', temperature: 0, timeoutMs: 120_000 },
  });
  h.chat.mockResolvedValue({ text: '{"items":[]}', thinkingChars: 0, elapsedMs: 5 });
  h.apply.mockResolvedValue({ ok: true, reviewId: 900n, replaced: false, staleTokens: [] });
  h.cleanup.mockResolvedValue([]);
  analyzeReturning(OK_RESULT);
});

describe('가드 — 자동은 걸리면 잡을 만들지 않는다', () => {
  it('유스케이스가 꺼져 있으면 AI_DISABLED, 잡 없음', async () => {
    h.runtime.mockResolvedValue({ enabled: false });
    expect(await startEqAnalysis(7n, auto)).toEqual({ ok: false, error: 'AI_DISABLED' });
    expect(jobs()).toHaveLength(0);
    expect(h.download).not.toHaveBeenCalled();
  });

  it('승인요청 상태가 아니거나 스텐실 트랙이면 시작하지 않는다', async () => {
    h.poFindUnique.mockResolvedValueOnce({ status: 'issued', spec: { category: 'standard' } });
    expect(await startEqAnalysis(7n, auto)).toEqual({ ok: false, error: 'NOT_EQ_REQUESTED' });
    h.poFindUnique.mockResolvedValueOnce({ status: 'eq_requested', spec: { category: 'metalMask' } });
    expect(await startEqAnalysis(7n, auto)).toEqual({ ok: false, error: 'NOT_EQ_TRACK' });
    h.poFindUnique.mockResolvedValueOnce(null);
    expect(await startEqAnalysis(7n, manual())).toEqual({ ok: false, error: 'PO_NOT_FOUND' });
    expect(jobs()).toHaveLength(0);
  });

  it('EQ 질의서가 없으면(Working 만 있어도) NO_SOURCE', async () => {
    h.fileFindMany.mockResolvedValue([{ id: 32n, fileType: 'working', writeDate: new Date(), originFileName: 'w.zip', pathToken: 't' }]);
    expect(await startEqAnalysis(7n, auto)).toEqual({ ok: false, error: 'NO_SOURCE' });
    expect(jobs()).toHaveLength(0);
  });

  it('수동 — 발송한 회차가 열려 있으면 ALREADY_OPEN, 초안이 있는데 replaceDraft 가 아니면 DRAFT_EXISTS', async () => {
    h.reviewFindFirst.mockResolvedValue({ status: 'requested' });
    expect(await startEqAnalysis(7n, manual(true))).toEqual({ ok: false, error: 'ALREADY_OPEN' });
    h.reviewFindFirst.mockResolvedValue({ status: 'draft' });
    expect(await startEqAnalysis(7n, manual(false))).toEqual({ ok: false, error: 'DRAFT_EXISTS' });
    expect(jobs()).toHaveLength(0);
  });
});

describe('분석 → 초안', () => {
  it('성공 — 그림을 올리고 초안으로 써 넣은 뒤 잡이 done(적용 회차·LLM 원출력 기록)', async () => {
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    expect(started.state).toMatchObject({ status: 'running', trigger: 'auto', model: 'kimi-k3', appliedReviewId: null });
    expect(lastJob()).toMatchObject({
      useCase: 'pcb.eq-parse',
      targetType: 'pcb_po',
      targetId: 7n,
      mbId: 'system',
      stage: 'eqparse',
      promptVersion: 'eq-parse-v3',
    });
    await started.settled;

    // 분석 대상은 질의서 최신본, LLM 호출은 유스케이스 설정대로(think·temperature·format·120초 이내).
    expect(h.download).toHaveBeenCalledWith('tok-31');
    expect(h.analyze.mock.calls[0]?.[0]).toMatchObject({ fileName: 'EQ-v1.xlsx' });
    const chatArgs = h.chat.mock.calls[0] as unknown[];
    expect(chatArgs[1]).toBe('kimi-k3');
    expect(chatArgs[3]).toBeLessThanOrEqual(120_000);
    expect(chatArgs[5]).toEqual({ think: 'low', format: { type: 'object' }, temperature: 0 });

    expect(h.upload).toHaveBeenCalledTimes(1);
    const applied = h.apply.mock.calls[0] as [bigint, Record<string, unknown>];
    expect(applied[0]).toBe(7n);
    expect(applied[1]).toMatchObject({
      replaceDraft: false,
      sourceFileId: 31n,
      actorMbId: null,
      figures: [{ ref: 'img-2', pathToken: 'fig-tok', originFileName: 'figure-2.png', size: 3 }],
    });
    const items = applied[1].items as { aiFlags: unknown[]; figureRefs: string[] }[];
    expect(items.map((i) => i.aiFlags.length)).toEqual([0, 1]);
    expect(items[0]?.figureRefs).toEqual(['img-2']);
    expect(String(applied[1].note)).toContain('kimi-k3 · eq-parse-v3 · 문항 2개 · 그림 1장');
    expect(String(applied[1].note)).toContain('주의: AI 출력 정리');

    const job = lastJob();
    expect(job).toMatchObject({ status: 'done', error: null, stage: null });
    expect(parseEqAiJobMeta(job.resultJson)).toMatchObject({
      appliedReviewId: 900,
      skipped: null,
      responses: ['{"items":[]}'],
      promptChars: 1234,
    });
  });

  it('관리자가 먼저 초안을 열었으면(자동) 그림도 안 올리고 써 넣지도 않는다 — 잡은 done·미적용', async () => {
    // 수동 가드는 자동에 없다 — 분석이 끝난 뒤의 사전 확인에서 걸린다.
    h.reviewFindFirst.mockResolvedValue({ status: 'draft' });
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
    expect(lastJob().status).toBe('done');
    expect(parseEqAiJobMeta(lastJob().resultJson)).toMatchObject({ appliedReviewId: null, skipped: 'DRAFT_EXISTS' });
  });

  it('써 넣는 순간 밀리면(그사이 발송) 올린 그림을 거두고 미적용으로 끝난다', async () => {
    h.apply.mockResolvedValue({ ok: false, reason: 'ALREADY_OPEN' });
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.cleanup).toHaveBeenCalledWith(['fig-tok']);
    expect(parseEqAiJobMeta(lastJob().resultJson)).toMatchObject({ appliedReviewId: null, skipped: 'ALREADY_OPEN' });
    expect(lastJob().status).toBe('done');
  });

  it('수동 replaceDraft — 초안을 바꿔 끼우고 옛 그림 실파일을 거둔다', async () => {
    h.reviewFindFirst.mockResolvedValue({ status: 'draft' });
    h.apply.mockResolvedValue({ ok: true, reviewId: 901n, replaced: true, staleTokens: ['old-1', 'old-2'] });
    const started = await startEqAnalysis(7n, manual(true));
    if (!started.ok) throw new Error(started.error);
    expect(lastJob().mbId).toBe('admin');
    await started.settled;
    expect((h.apply.mock.calls[0] as [bigint, Record<string, unknown>])[1]).toMatchObject({ replaceDraft: true, actorMbId: 'admin' });
    expect(h.cleanup).toHaveBeenCalledWith(['old-1', 'old-2']);
    expect(parseEqAiJobMeta(lastJob().resultJson)).toMatchObject({ trigger: 'manual', appliedReviewId: 901 });
  });
});

describe('실패 — 잡에 사유를 남길 뿐 던지지 않는다', () => {
  it('엑셀이 아니면 unsupported_file — 재시도하지 않는다', async () => {
    h.analyze.mockResolvedValue({ ok: false, reason: 'unsupported_file', detail: 'EQ.pdf: 엑셀(.xls·.xlsx·.zip)이 아닙니다' });
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.analyze).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: 'error', error: 'unsupported_file' });
    expect(parseEqAiJobMeta(lastJob().resultJson).detail).toContain('엑셀');
    expect(h.apply).not.toHaveBeenCalled();
  });

  // 재시도는 두 겹이다 — 출력이 계약을 못 넘으면 analyze 가 chat 을 한 번 더 부르고(여기선 안 본다),
  // **전송 실패는 러너의 chat 이 한 번 더** 부른다. analyze 는 chat 이 던지면 llm_failed 로 끝낸다(진짜와 같게 흉내).
  const analyzeLikeReal = () =>
    h.analyze.mockImplementation(async (_input: unknown, chat: (p: string, s: unknown) => Promise<string>) => {
      try {
        await chat('PROMPT', { type: 'object' });
      } catch (err) {
        return { ok: false, reason: 'llm_failed', detail: `AI 호출 실패: ${err instanceof Error ? err.message : String(err)}` };
      }
      return OK_RESULT;
    });

  it('전송 실패(5xx)는 chat 이 한 번 더 부른다 — 두 번째에 되면 초안이 만들어진다', async () => {
    analyzeLikeReal();
    h.chat.mockRejectedValueOnce(new Error('ollama chat HTTP 502: bad gateway'));
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.chat).toHaveBeenCalledTimes(2);
    expect(h.analyze).toHaveBeenCalledTimes(1); // 분석을 통째로 다시 돌리지 않는다
    expect(lastJob().status).toBe('done');
    expect(h.apply).toHaveBeenCalledTimes(1);
    // 잡에 남는 원출력은 성공한 호출의 것 하나(재생용).
    expect(parseEqAiJobMeta(lastJob().resultJson).responses).toEqual(['{"items":[]}']);
  });

  it('시간 초과·429 도 한 번 더 — 그래도 안 되면 llm_failed', async () => {
    analyzeLikeReal();
    h.chat
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockRejectedValueOnce(new Error('ollama chat HTTP 429: rate limited'));
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.chat).toHaveBeenCalledTimes(2);
    expect(lastJob()).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(parseEqAiJobMeta(lastJob().resultJson).detail).toContain('HTTP 429');
  });

  it('인증·요청 오류(401·400)는 다시 부르지 않는다 — 같은 답이 온다', async () => {
    analyzeLikeReal();
    h.chat.mockRejectedValue(new Error('ollama chat HTTP 401: unauthorized'));
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.chat).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(isRetryableChatError(new Error('ollama chat HTTP 400: bad request'))).toBe(false);
    expect(isRetryableChatError(new Error('ollama chat HTTP 503: unavailable'))).toBe(true);
    expect(isRetryableChatError(new Error('fetch failed'))).toBe(true);
  });

  it('analyze 가 llm_failed 를 돌려주면(출력이 끝내 계약을 못 넘음) 그대로 잡에 적는다 — 분석을 다시 돌리지 않는다', async () => {
    h.analyze.mockResolvedValue({ ok: false, reason: 'llm_failed', detail: 'AI 출력이 문항 초안 모양(계약)이 아닙니다 — 2회 시도' });
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.analyze).toHaveBeenCalledTimes(1);
    expect(lastJob()).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(parseEqAiJobMeta(lastJob().resultJson).detail).toContain('2회 시도');
  });

  it('분석이 던져도(예상 밖) 잡이 llm_failed 로 닫히고 settled 는 거절되지 않는다', async () => {
    h.analyze.mockRejectedValue(new Error('boom'));
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await expect(started.settled).resolves.toBeUndefined();
    expect(lastJob()).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(parseEqAiJobMeta(lastJob().resultJson).detail).toContain('boom');
  });

  it('써 넣기가 던지면 올린 그림을 거두고 llm_failed', async () => {
    h.apply.mockRejectedValue(new Error('db down'));
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(h.cleanup).toHaveBeenCalledWith(['fig-tok']);
    expect(lastJob()).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(parseEqAiJobMeta(lastJob().resultJson).detail).toContain('초안에 써 넣지 못했습니다');
  });

  it('파일 서버에 파일이 없으면 unreadable, 순단이면 llm_failed — 분석은 돌지 않는다', async () => {
    h.download.mockResolvedValueOnce(null);
    const missing = await startEqAnalysis(7n, auto);
    expect(missing).toMatchObject({ ok: true, state: { status: 'failed', reason: 'unreadable' } });
    h.download.mockRejectedValueOnce(new Error('file server download HTTP 503'));
    const down = await startEqAnalysis(7n, manual());
    expect(down).toMatchObject({ ok: true, state: { status: 'failed', reason: 'llm_failed' } });
    expect(h.analyze).not.toHaveBeenCalled();
    expect(jobs().map((j) => j.status)).toEqual(['error', 'error']);
  });
});

describe('잡 수명 — 겹침·재사용·멈춘 잡', () => {
  it('이미 도는 잡이 있으면 새로 만들지 않고 그것을 돌려준다 — 수동 replaceDraft 는 잡에 적어 둔다', async () => {
    let release: (v: unknown) => void = () => undefined;
    h.analyze.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = await startEqAnalysis(7n, auto);
    if (!first.ok) throw new Error(first.error);

    h.reviewFindFirst.mockResolvedValue({ status: 'draft' });
    const second = await startEqAnalysis(7n, manual(true));
    if (!second.ok) throw new Error(second.error);
    expect(second.state.jobId).toBe(first.state.jobId);
    expect(jobs()).toHaveLength(1);
    expect(parseEqAiJobMeta(lastJob().resultJson)).toMatchObject({ replaceDraft: true, actorMbId: 'admin' });

    // 분석이 끝나면 그 뜻대로 초안을 바꿔 끼운다(자동으로 시작했어도).
    release(OK_RESULT);
    await first.settled;
    expect((h.apply.mock.calls[0] as [bigint, Record<string, unknown>])[1]).toMatchObject({ replaceDraft: true, actorMbId: 'admin' });
  });

  it('같은 파일·같은 설정의 완료 결과(1시간)는 모델을 다시 부르지 않는다 — LLM 원출력을 다시 먹인다', async () => {
    const first = await startEqAnalysis(7n, auto);
    if (!first.ok) throw new Error(first.error);
    await first.settled;
    expect(h.chat).toHaveBeenCalledTimes(1);

    const seen: string[] = [];
    h.analyze.mockImplementation(async (_input: unknown, chat: (p: string, s: unknown) => Promise<string>) => {
      seen.push(await chat('PROMPT', {}));
      return OK_RESULT;
    });
    h.reviewFindFirst.mockResolvedValue({ status: 'draft' });
    const second = await startEqAnalysis(7n, manual(true));
    if (!second.ok) throw new Error(second.error);
    await second.settled;
    expect(h.chat).toHaveBeenCalledTimes(1); // 늘지 않았다
    expect(seen).toEqual(['{"items":[]}']);
    expect(jobs()).toHaveLength(2);
    expect(String((h.apply.mock.calls[1] as [bigint, Record<string, unknown>])[1].note)).toContain('이전 분석 재사용');
  });

  it('설정(모델)이 바뀌면 재사용하지 않는다', async () => {
    const first = await startEqAnalysis(7n, auto);
    if (!first.ok) throw new Error(first.error);
    await first.settled;
    h.runtime.mockResolvedValue({
      enabled: true,
      model: 'glm-5.3-flash',
      think: 'low',
      extraInstructions: '',
      timeoutMs: 120_000,
      def: { defaultModel: 'kimi-k3', promptVersion: 'eq-parse-v3', think: 'low', temperature: 0, timeoutMs: 120_000 },
    });
    const second = await startEqAnalysis(7n, manual());
    if (!second.ok) throw new Error(second.error);
    await second.settled;
    expect(h.chat).toHaveBeenCalledTimes(2);
  });

  it('멈춘 running(예산의 2배+30초 초과)은 llm_failed 로 닫고 새 잡을 건다', async () => {
    jobs().push({
      id: 'stuck',
      useCase: 'pcb.eq-parse',
      targetType: 'pcb_po',
      targetId: 7n,
      mbId: 'system',
      status: 'running',
      stage: 'eqparse',
      model: 'kimi-k3',
      promptVersion: 'eq-parse-v3',
      inputHash: 'x',
      resultJson: null,
      error: null,
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      finishedAt: null,
    });
    const started = await startEqAnalysis(7n, auto);
    if (!started.ok) throw new Error(started.error);
    await started.settled;
    expect(started.state.jobId).not.toBe('stuck');
    const stuck = jobs().find((j) => j.id === 'stuck');
    expect(stuck).toMatchObject({ status: 'error', error: 'llm_failed' });
    expect(parseEqAiJobMeta(stuck?.resultJson ?? null).detail).toContain('멈췄습니다');
    expect(jobs()).toHaveLength(2);
  });
});
