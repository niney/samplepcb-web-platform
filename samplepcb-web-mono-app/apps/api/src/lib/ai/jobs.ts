import { randomUUID } from 'node:crypto';
import { DevDiagramJobResult, MarketDevReview } from '@sp/api-contract';
import type {
  AiJobStageType,
  AiJobStatusType,
  AiUsecaseKeyType,
  MarketDevDiagramType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { prisma } from '../prisma';

// AI 잡 저장소 — sp_ai_job(DB). 서버 재시작에 견디고, 의뢰 등록 시점의 소유자·완료·신선도
// (inputHash) 대조가 DB 사실 하나로 끝난다(docs/AI_DEV_REVIEW.md §3).
// resultJson 은 유스케이스별로 다르다: dev-review = MarketDevReview 직렬화(등록 시 프로젝트로 복사),
// dev-diagram = { meta: MarketDevDiagram, html }(§13.7 — 3단계에서 프로젝트 없이 시작되므로 본문도 잡에
// 두고, 등록 시 프로젝트 컬럼으로 복사한다).

export interface AiJob {
  id: string;
  useCase: string;
  mbId: string; // 소유자 — 본인 잡만 조회 가능
  status: AiJobStatusType;
  stage: AiJobStageType | null;
  model: string;
  promptVersion: string;
  inputHash: string;
  review: MarketDevReviewType | null; // dev-review 가 done 이고 파손이 아닐 때만
  diagram: MarketDevDiagramType | null; // dev-diagram 의 메타(done 이면 결과, running 이면 진행 메타)
  diagramHtml: string | null; // dev-diagram 이 done 일 때
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
  v === 'attachments' || v === 'review' || v === 'diagram' ? v : null;

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return undefined; // 저장분 파손 — 폴링이 500 으로 죽는 대신 error 잡으로 보인다
  }
};

// 저장분 파손(스키마 변경·수기 수정)은 조용히 통과시키지 않는다 — 결과 없는 error 잡으로
// 보여 재생성을 유도한다(등록 라우트도 done 이 아니면 거절).
// dev-diagram 은 running 중에도 진행 메타를 resultJson 에 둔다(위저드·플로팅이 상태를 읽는다).
const toAiJob = (row: AiJobRow): AiJob => {
  const status = asStatus(row.status);
  let review: MarketDevReviewType | null = null;
  let diagram: MarketDevDiagramType | null = null;
  let diagramHtml: string | null = null;
  let corrupted = false;
  if (row.resultJson !== null) {
    const raw = parseJson(row.resultJson);
    // market.* 와 develop.* 가 같은 결과 모양을 쓴다 — 접미(.dev-review/.dev-diagram)로 가른다.
    if (row.useCase.endsWith('.dev-review') && status === 'done') {
      const parsed = MarketDevReview.safeParse(raw);
      if (parsed.success) review = parsed.data;
      else corrupted = true;
    } else if (row.useCase.endsWith('.dev-diagram')) {
      const parsed = DevDiagramJobResult.safeParse(raw);
      if (parsed.success) {
        diagram = parsed.data.meta;
        diagramHtml = parsed.data.html === '' ? null : parsed.data.html;
      } else if (status === 'done') {
        corrupted = true;
      }
    }
  }
  return {
    id: row.id,
    useCase: row.useCase,
    mbId: row.mbId,
    status: corrupted ? 'error' : status,
    stage: asStage(row.stage),
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    review,
    diagram,
    diagramHtml,
    error: corrupted ? 'RESULT_CORRUPTED' : row.error,
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
  stage?: AiJobStageType;
  resultJson?: string; // 진행 메타(dev-diagram)
}): Promise<AiJob> {
  const row = await prisma.spAiJob.create({
    data: {
      id: randomUUID(),
      useCase: input.useCase,
      mbId: input.mbId,
      status: 'running',
      stage: input.stage ?? null,
      model: input.model,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
      resultJson: input.resultJson ?? null,
      startedAt: new Date(),
    },
  });
  return toAiJob(row);
}

export async function setAiJobStage(id: string, stage: AiJobStageType): Promise<void> {
  await prisma.spAiJob.updateMany({ where: { id, status: 'running' }, data: { stage } });
}

// 진행 중 잡의 결과 본문 갱신(dev-diagram 진행 메타) — 상태는 바꾸지 않는다.
export async function updateAiJobResult(id: string, resultJson: string): Promise<void> {
  await prisma.spAiJob.updateMany({ where: { id, status: 'running' }, data: { resultJson } });
}

export async function finishAiJob(
  id: string,
  result: { review: MarketDevReviewType } | { diagram: MarketDevDiagramType; html: string } | { error: string; diagram?: MarketDevDiagramType },
): Promise<void> {
  const finishedAt = new Date();
  if ('review' in result) {
    await prisma.spAiJob.updateMany({
      where: { id },
      data: { status: 'done', stage: null, resultJson: JSON.stringify(result.review), error: null, finishedAt },
    });
    return;
  }
  if ('html' in result) {
    await prisma.spAiJob.updateMany({
      where: { id },
      data: { status: 'done', stage: null, resultJson: JSON.stringify({ meta: result.diagram, html: result.html }), error: null, finishedAt },
    });
    return;
  }
  await prisma.spAiJob.updateMany({
    where: { id },
    data: {
      status: 'error',
      error: result.error.slice(0, 100),
      finishedAt,
      // 실패·생략 메타도 남긴다(플로팅·상세가 사유를 보여준다).
      ...(result.diagram === undefined ? {} : { resultJson: JSON.stringify({ meta: result.diagram, html: '' }) }),
    },
  });
}

export async function getAiJob(id: string): Promise<AiJob | null> {
  const row = await prisma.spAiJob.findUnique({ where: { id } });
  return row === null ? null : toAiJob(row);
}

// 동일 회원·유스케이스·모델·프롬프트 버전·입력의 성공 결과는 창 안에서 재사용한다.
// 사용자 간 결과 공유는 자유 입력의 기밀 경계를 흐리므로 하지 않는다.
// dev-diagram 은 **진행 중 잡도** 재사용한다(3단계 재진입·검토서 재생성 때 10분짜리 kimi 를 다시 돌리지 않는다).
export async function findReusableAiJob(
  useCase: AiUsecaseKeyType,
  mbId: string,
  source: AiJobSource,
  options: { includeRunning?: boolean } = {},
): Promise<AiJob | null> {
  const row = await prisma.spAiJob.findFirst({
    where: {
      useCase,
      mbId,
      model: source.model,
      promptVersion: source.promptVersion,
      inputHash: source.inputHash,
      status: options.includeRunning === true ? { in: ['done', 'running'] } : 'done',
      startedAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
    },
    orderBy: { startedAt: 'desc' },
  });
  if (row === null) return null;
  const job = toAiJob(row);
  if (job.status === 'error') return null; // 파손 저장분은 캐시로 쓰지 않는다
  if (job.useCase.endsWith('.dev-review') && job.review === null) return null;
  return job;
}

// 재시작 복구 — 진행 중으로 남은 잡(유스케이스별).
export async function listRunningAiJobs(useCase: AiUsecaseKeyType): Promise<AiJob[]> {
  const rows = await prisma.spAiJob.findMany({ where: { useCase, status: 'running' }, orderBy: { startedAt: 'asc' } });
  return rows.map(toAiJob);
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
