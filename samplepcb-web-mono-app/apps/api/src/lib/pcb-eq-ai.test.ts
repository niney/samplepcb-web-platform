import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobFindFirst: vi.fn(),
  runtime: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: { spAiJob: { findMany: mocks.jobFindMany, findFirst: mocks.jobFindFirst } },
}));
vi.mock('./ai/usecases', () => ({
  PCB_EQ_PARSE_USECASE: 'pcb.eq-parse',
  getAiUsecaseRuntime: mocks.runtime,
}));

import {
  ZOMBIE_DETAIL,
  eqAiJobStatus,
  eqAiWarningDetail,
  eqAiZombieMs,
  loadEqAiRowSummaries,
  newEqAiJobMeta,
  parseEqAiJobMeta,
  pickEqSourceFile,
  toEqAiState,
} from './pcb-eq-ai';

// D20 P2 — AI 분석 잡을 화면이 읽는 모양으로. 대상 파일 선택·멈춘 잡·행 요약(분석 중·안 됨일 때만).

const at = (iso: string): Date => new Date(iso);
const NOW = at('2026-10-11T03:00:00Z');
const ZOMBIE = eqAiZombieMs(120_000); // 270초

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockResolvedValue({ enabled: true, timeoutMs: 120_000 });
});

describe('분석 대상 파일 — EQ 질의서의 최신 1건', () => {
  const file = (id: bigint, fileType: string | null) => ({ id, fileType, writeDate: at('2026-10-11T00:00:00Z') });

  it('질의서(eq) 중 fileId 가 가장 큰 것 — Working·회신·좌표는 대상이 아니다', () => {
    const files = [file(10n, 'eq'), file(12n, 'eq'), file(13n, 'working'), file(14n, 'reply'), file(15n, 'coord')];
    expect(pickEqSourceFile(files)?.id).toBe(12n);
  });

  it('종류가 비어 있는 옛 행은 eq 로 읽는다', () => {
    expect(pickEqSourceFile([file(3n, null), file(2n, 'eq')])?.id).toBe(3n);
  });

  it('질의서가 없으면 null(잡을 만들지 않는다)', () => {
    expect(pickEqSourceFile([file(13n, 'working'), file(14n, 'reply')])).toBeNull();
    expect(pickEqSourceFile([])).toBeNull();
  });
});

describe('잡 상태 — 멈춘 running 은 실패로 본다', () => {
  const head = (over: Record<string, unknown> = {}) => ({
    status: 'running',
    error: null,
    startedAt: at('2026-10-11T02:59:00Z'),
    finishedAt: null,
    ...over,
  });

  it('예산(timeout×2) + 30초 안의 running 은 분석 중', () => {
    expect(eqAiJobStatus(head(), ZOMBIE, NOW)).toEqual({ status: 'running', reason: null, zombie: false });
  });

  it('그보다 오래 running 이면 llm_failed(서버 재시작으로 끊긴 잡)', () => {
    const stuck = head({ startedAt: at('2026-10-11T02:50:00Z') });
    expect(eqAiJobStatus(stuck, ZOMBIE, NOW)).toEqual({ status: 'failed', reason: 'llm_failed', zombie: true });
    const state = toEqAiState({ ...stuck, id: 'j1', model: 'kimi-k3', resultJson: null }, ZOMBIE, NOW);
    expect(state).toMatchObject({ status: 'failed', reason: 'llm_failed', detail: ZOMBIE_DETAIL });
  });

  it('error 잡은 사유 코드 그대로, 모르는 코드는 llm_failed', () => {
    expect(eqAiJobStatus(head({ status: 'error', error: 'unsupported_file' }), ZOMBIE, NOW).reason).toBe('unsupported_file');
    expect(eqAiJobStatus(head({ status: 'error', error: 'TIMEOUT' }), ZOMBIE, NOW).reason).toBe('llm_failed');
  });

  it('done 은 적용 회차를 싣고, 실패·진행 중에는 싣지 않는다', () => {
    const meta = { ...newEqAiJobMeta({ trigger: 'manual', sourceFileId: 7, sourceFileName: 'EQ.xlsx', replaceDraft: true, actorMbId: 'admin' }), appliedReviewId: 55, detail: '덧말' };
    const row = { id: 'j2', model: 'kimi-k3', resultJson: JSON.stringify(meta), ...head({ status: 'done', finishedAt: NOW }) };
    expect(toEqAiState(row, ZOMBIE, NOW)).toEqual({
      jobId: 'j2',
      status: 'done',
      trigger: 'manual',
      reason: null,
      detail: null,
      model: 'kimi-k3',
      startedAt: '2026-10-11T02:59:00.000Z',
      finishedAt: '2026-10-11T03:00:00.000Z',
      appliedReviewId: 55,
    });
    const failed = toEqAiState({ ...row, status: 'error', error: 'no_items' }, ZOMBIE, NOW);
    expect(failed).toMatchObject({ status: 'failed', reason: 'no_items', detail: '덧말', appliedReviewId: null });
  });

  it('성공해도 분석이 남긴 주의는 덧말로 싣는다 — 여러 건은 이어 붙이고 300자에서 자른다', () => {
    const base = newEqAiJobMeta({ trigger: 'auto', sourceFileId: 7, sourceFileName: 'EQ.xlsx', replaceDraft: false, actorMbId: null });
    const row = (warnings: string[]) => ({
      id: 'j3',
      model: 'kimi-k3',
      resultJson: JSON.stringify({ ...base, appliedReviewId: 9, warnings }),
      ...head({ status: 'done', finishedAt: NOW }),
    });
    expect(toEqAiState(row(['표 규칙으로는 문항 5 도 읽혔으나 AI 초안에 없습니다', 'AI 출력 정리: 빈 선택지 제거']), ZOMBIE, NOW).detail).toBe(
      '표 규칙으로는 문항 5 도 읽혔으나 AI 초안에 없습니다 · AI 출력 정리: 빈 선택지 제거',
    );
    expect(toEqAiState(row([]), ZOMBIE, NOW).detail).toBeNull();
    expect(eqAiWarningDetail(['  ', ''])).toBeNull();
    const long = eqAiWarningDetail(['가'.repeat(200), '나'.repeat(200)]);
    expect(long).toHaveLength(300);
    expect(long?.endsWith('…')).toBe(true);
    // 분석 중에는 아직 말할 것이 없다.
    expect(toEqAiState({ ...row(['주의']), status: 'running', finishedAt: null }, ZOMBIE, NOW).detail).toBeNull();
  });

  it('깨진 resultJson 도 죽지 않는다(자동·미적용으로 읽는다)', () => {
    expect(parseEqAiJobMeta('{not json')).toMatchObject({ trigger: 'auto', appliedReviewId: null, responses: [] });
    expect(parseEqAiJobMeta(JSON.stringify({ responses: ['a', 1], skipped: 'DRAFT_EXISTS', itemFlags: [[{ code: 'figure', detail: 'x' }, 'bad']] }))).toMatchObject({
      responses: ['a'],
      skipped: 'DRAFT_EXISTS',
      itemFlags: [[{ code: 'figure', detail: 'x' }]],
    });
  });
});

describe('행 요약(eqAi) — 분석 중·안 됨일 때만, 이번 승인요청 기준', () => {
  const job = (targetId: bigint, status: string, startedAt: string, error: string | null = null) => ({
    targetId,
    status,
    error,
    startedAt: at(startedAt),
    finishedAt: status === 'running' ? null : at(startedAt),
  });

  // 멈춘 잡 판정이 지금 시각을 본다 — 시계를 고정한다.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('승인요청 중인 발주서가 없으면 쿼리도 없다', async () => {
    const out = await loadEqAiRowSummaries([{ id: 1n, status: 'issued', roundStart: null }]);
    expect(out.size).toBe(0);
    expect(mocks.jobFindMany).not.toHaveBeenCalled();
  });

  it('발주서별 최신 잡 하나 — 됐으면 없음, 실패·진행 중이면 요약, 지난 승인요청의 잡은 버린다', async () => {
    mocks.jobFindMany.mockResolvedValue([
      // startedAt desc
      job(1n, 'error', '2026-10-11T02:59:30Z', 'unsupported_file'),
      job(2n, 'done', '2026-10-11T02:59:00Z'),
      job(2n, 'error', '2026-10-11T02:00:00Z', 'llm_failed'), // 최신이 done 이라 안 본다
      job(3n, 'error', '2026-10-10T00:00:00Z', 'no_items'), // 지난 승인요청(반려 전)의 분석
      job(4n, 'running', '2026-10-11T02:59:50Z'),
    ]);
    const round = at('2026-10-11T02:30:00Z');
    const out = await loadEqAiRowSummaries([
      { id: 1n, status: 'eq_requested', roundStart: round },
      { id: 2n, status: 'eq_requested', roundStart: round },
      { id: 3n, status: 'eq_requested', roundStart: round },
      { id: 4n, status: 'eq_requested', roundStart: round },
      { id: 5n, status: 'eq_done', roundStart: round },
    ]);
    expect([...out.keys()].sort()).toEqual(['1', '4']);
    expect(out.get('1')).toEqual({ status: 'failed', reason: 'unsupported_file', at: '2026-10-11T02:59:30.000Z' });
    expect(out.get('4')?.status).toBe('running');
    // 결과 본문(MEDIUMTEXT)은 읽지 않는다.
    const query = mocks.jobFindMany.mock.calls[0]?.[0] as { select: Record<string, boolean>; where: { targetId: { in: bigint[] } } };
    expect(query.select).not.toHaveProperty('resultJson');
    expect(query.where.targetId.in).toEqual([1n, 2n, 3n, 4n]);
  });
});
