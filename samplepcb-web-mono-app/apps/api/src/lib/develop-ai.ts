import type { FastifyBaseLogger } from 'fastify';
import type { SpDevelopRequest } from '@prisma/client';
import { requestDevDiagramForDevelop } from './ai/dev-diagram-runner';
import { startDevReviewJob } from './ai/runner';
import { DEVELOP_DIAGRAM_USECASE, DEVELOP_REVIEW_USECASE, getAiUsecaseRuntime, toOllamaThink } from './ai/usecases';
import { buildDevelopReviewSource } from './develop-ai-source';
import { getDevelopSettings } from './develop-settings';
import { prisma } from './prisma';

// ── 개발의뢰 AI 오케스트레이션(docs/DEVELOP_FLOW.md §6) ─────────────────────────────
// 등록 직후(자동 초안)와 관리자 재생성이 같은 진입점을 쓴다. 고객은 기다리지 않는다 — 결과는 관리자 전용 초안/현재본으로만
// 들어가고, 공개는 관리자가 따로 한다. 미동의(aiConsent=false)면 어떤 경로로도 외부 LLM 에 보내지 않는다.

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

export interface DevelopAiStartResult {
  review: { jobId: string; cached: boolean } | { skipped: 'CONSENT' | 'DISABLED' | 'RUNNING' | 'AUTO_OFF' };
  diagram: { status: string } | { skipped: 'CONSENT' | 'DISABLED' | 'RUNNING' | 'AUTO_OFF' | 'GATE' };
}

// 초안 잡이 아직 돌고 있는지 — devReviewDraftJobId 의 잡 상태로 판정한다.
export async function developReviewDraftRunning(request: Pick<SpDevelopRequest, 'devReviewDraftJobId'>): Promise<boolean> {
  if (request.devReviewDraftJobId === null) return false;
  const job = await prisma.spAiJob.findUnique({ where: { id: request.devReviewDraftJobId }, select: { status: true } });
  return job?.status === 'running';
}

export async function startDevelopAiDrafts(
  request: SpDevelopRequest,
  log: AiRunLogger,
  options: { review: boolean; diagram: boolean; auto: boolean; force?: boolean },
): Promise<DevelopAiStartResult> {
  const result: DevelopAiStartResult = { review: { skipped: 'DISABLED' }, diagram: { skipped: 'DISABLED' } };
  if (!request.aiConsent) return { review: { skipped: 'CONSENT' }, diagram: { skipped: 'CONSENT' } };

  const settings = options.auto ? await getDevelopSettings() : null;
  const wantReview = options.review && (settings === null || settings.aiAutoDraft);
  const wantDiagram = options.diagram && (settings === null || settings.aiDiagramAutoDraft);
  if (!wantReview) result.review = { skipped: 'AUTO_OFF' };
  if (!wantDiagram) result.diagram = { skipped: 'AUTO_OFF' };
  if (!wantReview && !wantDiagram) return result;

  const [reviewRuntime, diagramRuntime] = await Promise.all([
    getAiUsecaseRuntime(DEVELOP_REVIEW_USECASE),
    getAiUsecaseRuntime(DEVELOP_DIAGRAM_USECASE),
  ]);
  const reviewOn = wantReview && (reviewRuntime.enabled || options.force === true);
  const diagramOn = wantDiagram && (diagramRuntime.enabled || options.force === true);
  if (wantReview && !reviewOn) result.review = { skipped: 'DISABLED' };
  if (wantDiagram && !diagramOn) result.diagram = { skipped: 'DISABLED' };
  if (!reviewOn && !diagramOn) return result;

  if (reviewOn && (await developReviewDraftRunning(request))) {
    result.review = { skipped: 'RUNNING' };
  }

  // 코퍼스는 한 번만 만든다(참고 자료 다운로드·추출 + 보충 메모).
  const bundle = await buildDevelopReviewSource(request);

  if (reviewOn && !('skipped' in result.review && result.review.skipped === 'RUNNING')) {
    const started = await startDevReviewJob({
      mbId: request.mbId, // 잡 소유자 = 의뢰인(관리자가 돌려도 의뢰인 것으로 남긴다 — 마켓 재생성 관례)
      model: reviewRuntime.model,
      think: toOllamaThink(reviewRuntime.think),
      extraInstructions: reviewRuntime.extraInstructions,
      source: bundle.source,
      images: bundle.images,
      inputHash: bundle.signature,
      log,
      useCase: DEVELOP_REVIEW_USECASE,
      target: { kind: 'develop', requestId: request.id },
      timeoutMs: reviewRuntime.def.timeoutMs,
      reuseCompleted: options.force !== true,
    });
    await prisma.spDevelopRequest.update({
      where: { id: request.id },
      data: { devReviewInputHash: bundle.signature },
    });
    result.review = { jobId: started.job.id, cached: started.cached };
  }

  if (diagramOn) {
    const queued = await requestDevDiagramForDevelop(request, bundle.source, log, {
      ...(options.force === undefined ? {} : { force: options.force }),
    });
    result.diagram = queued.ok
      ? queued.meta.status === 'skipped'
        ? { skipped: 'GATE' }
        : { status: queued.meta.status }
      : { skipped: queued.reason };
  }
  return result;
}
