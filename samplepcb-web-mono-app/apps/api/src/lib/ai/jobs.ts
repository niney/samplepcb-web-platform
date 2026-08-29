import { randomUUID } from 'node:crypto';
import { MarketDevReview } from '@sp/api-contract';
import type { AiJobStageType, AiJobStatusType, AiUsecaseKeyType, MarketDevReviewType } from '@sp/api-contract';
import { prisma } from '../prisma';

// AI 잡 저장소 — sp_ai_job(DB). 인메모리 스토어를 대체(2026-08-28, docs/AI_DEV_REVIEW.md §3):
// 서버 재시작에 견디고, 의뢰 등록 시점의 소유자·완료·신선도(inputHash) 대조가 DB 사실
// 하나로 끝난다(클라이언트가 산출물 본문을 보내지 않는 구조의 전제).
// resultJson 은 MarketDevReview.parse 를 통과한 객체의 직렬화 — 읽을 때 파손이면 error 취급.

export interface AiJob {
  id: string;
  useCase: string;
  mbId: string; // 소유자 — 본인 잡만 조회 가능
  status: AiJobStatusType;
  stage: AiJobStageType | null;
  model: string;
  promptVersion: string;
  inputHash: string;
  review: MarketDevReviewType | null; // done 이고 파손이 아닐 때만
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

const REUSE_WINDOW_MS = 60 * 60 * 1000; // 동일 입력 done 잡 재사용 창(1시간)

interface AiJobRow {
  id: string;
  useCase: string;
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

const asStatus = (v: string): AiJobStatusType =>
  v === 'done' || v === 'error' ? v : 'running';

const asStage = (v: string | null): AiJobStageType | null =>
  v === 'attachments' || v === 'review' ? v : null;

// 저장분 파손(스키마 변경·수기 수정)은 조용히 통과시키지 않는다 — 검토서 없는 error 잡으로
// 보여 재생성을 유도한다(등록 라우트도 done 이 아니면 거절).
const parseReview = (json: string): MarketDevReviewType | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null; // 저장분 파손 — 폴링이 500 으로 죽는 대신 error 잡으로 보인다
  }
  const parsed = MarketDevReview.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const toAiJob = (row: AiJobRow): AiJob => {
  const status = asStatus(row.status);
  let review: MarketDevReviewType | null = null;
  let error = row.error;
  if (status === 'done' && row.resultJson !== null) {
    review = parseReview(row.resultJson);
    if (review === null) error = 'RESULT_CORRUPTED';
  }
  return {
    id: row.id,
    useCase: row.useCase,
    mbId: row.mbId,
    status: status === 'done' && review === null ? 'error' : status,
    stage: asStage(row.stage),
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    review,
    error: status === 'done' && review === null ? (error ?? 'RESULT_CORRUPTED') : error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
};

export interface AiJobSource {
  model: string;
  promptVersion: string;
  inputHash: string;
}

export async function createAiJob(input: {
  useCase: AiUsecaseKeyType;
  mbId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
}): Promise<AiJob> {
  const row = await prisma.spAiJob.create({
    data: {
      id: randomUUID(),
      useCase: input.useCase,
      mbId: input.mbId,
      status: 'running',
      stage: null,
      model: input.model,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
      startedAt: new Date(),
    },
  });
  return toAiJob(row);
}

export async function setAiJobStage(id: string, stage: AiJobStageType): Promise<void> {
  await prisma.spAiJob.updateMany({ where: { id, status: 'running' }, data: { stage } });
}

export async function finishAiJob(
  id: string,
  result: { review: MarketDevReviewType } | { error: string },
): Promise<void> {
  const finishedAt = new Date();
  await prisma.spAiJob.updateMany({
    where: { id },
    data:
      'review' in result
        ? { status: 'done', stage: null, resultJson: JSON.stringify(result.review), error: null, finishedAt }
        : { status: 'error', error: result.error.slice(0, 100), finishedAt },
  });
}

export async function getAiJob(id: string): Promise<AiJob | null> {
  const row = await prisma.spAiJob.findUnique({ where: { id } });
  return row === null ? null : toAiJob(row);
}

// 동일 회원·유스케이스·모델·프롬프트 버전·입력의 성공 결과는 창 안에서 재사용한다.
// 사용자 간 결과 공유는 자유 입력의 기밀 경계를 흐리므로 하지 않는다.
export async function findReusableAiJob(
  useCase: AiUsecaseKeyType,
  mbId: string,
  source: AiJobSource,
): Promise<AiJob | null> {
  const row = await prisma.spAiJob.findFirst({
    where: {
      useCase,
      mbId,
      model: source.model,
      promptVersion: source.promptVersion,
      inputHash: source.inputHash,
      status: 'done',
      finishedAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
    },
    orderBy: { startedAt: 'desc' },
  });
  if (row === null) return null;
  const job = toAiJob(row);
  return job.review === null ? null : job; // 파손 저장분은 캐시로 쓰지 않는다
}

// 관리자 실행 이력 — 본문(resultJson, MEDIUMTEXT)은 읽지 않는다(목록에 필요 없고 비싸다).
export interface AiJobLogRow {
  id: string;
  useCase: string;
  mbId: string;
  status: AiJobStatusType;
  stage: AiJobStageType | null;
  model: string;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export async function listAiJobs(query: {
  page: number;
  pageSize: number;
}): Promise<{ items: AiJobLogRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.spAiJob.findMany({
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, useCase: true, mbId: true, status: true, stage: true,
        model: true, error: true, startedAt: true, finishedAt: true,
      },
    }),
    prisma.spAiJob.count(),
  ]);
  return {
    items: rows.map((r) => ({ ...r, status: asStatus(r.status), stage: asStage(r.stage) })),
    total,
  };
}
