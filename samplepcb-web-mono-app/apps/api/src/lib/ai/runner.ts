import type { FastifyBaseLogger } from 'fastify';
import { DEV_REVIEW_LLM_JSON_SCHEMA } from '@sp/api-contract';
import type { DevReviewMetaType } from '@sp/api-contract';
import { ollamaChatDetailed } from './ollama';
import type { AiConnection, OllamaChatExtra, OllamaChatResult } from './ollama';
import {
  ATTACHMENT_READ_JSON_SCHEMA,
  DEV_REVIEW_PROMPT_VERSION,
  buildAttachmentReadPrompt,
  buildDevReviewPrompt,
  parseAttachmentReadResult,
  parseDevReviewLlmOutput,
  postProcessDevReview,
} from './dev-review';
import type { DevReviewSource } from './dev-review';
import { getAiConnection, getAiVisionModel } from './usecases';
import { createAiJob, findReusableAiJob, finishAiJob, setAiJobStage, type AiJob } from './jobs';

// AI 사전 검토서 러너 — 실제 의뢰 실행과 관리자 샘플 테스트가 같은 2단 파이프라인을 쓴다.
// ① 첨부 판독(비전 모델, 이미지가 있을 때만) → 텍스트로 근거 코퍼스에 합류
// ② 검토서(주모델, 텍스트 전용) → 파싱 → 결정적 후처리 R1~R7 → sp_ai_job 에 저장.
// 라우트는 권한·입력 정책만 결정하고 장시간 생성은 여기서 비동기 처리한다.

const USE_CASE = 'market.dev-review' as const;
const REVIEW_TIMEOUT_MS = 600_000;
const ATTACHMENT_TIMEOUT_MS = 180_000;

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export interface StartDevReviewJobOptions {
  mbId: string;
  model: string;
  think: boolean;
  extraInstructions: string;
  source: DevReviewSource; // attachmentContext 는 첨부 "텍스트"만 — 이미지 판독은 여기서 붙인다
  images: readonly string[]; // base64 래스터 미리보기
  inputHash: string;
  log: AiRunLogger;
  reuseCompleted?: boolean;
}

export interface StartedAiJob {
  job: AiJob;
  cached: boolean;
}

// 구조화 출력(format)·thinking(think) 미지원 모델은 4xx 로 거절한다 — 그 옵션만 빼고 1회
// 재시도한다(프로브 하네스 chatWithFallback 과 같은 규칙, 여기가 출하 코드의 정본).
export async function chatWithOptionFallback(
  conn: AiConnection,
  model: string,
  prompt: string,
  timeoutMs: number,
  images: readonly string[],
  extra: OllamaChatExtra,
  log: AiRunLogger,
): Promise<OllamaChatResult> {
  try {
    return await ollamaChatDetailed(conn, model, prompt, timeoutMs, images, extra);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP 4\d\d/.test(msg) && (extra.format !== undefined || extra.think !== undefined)) {
      const rest: OllamaChatExtra = { ...extra };
      delete rest.format;
      delete rest.think;
      log.warn({ model, msg: msg.slice(0, 160) }, 'ai: format/think unsupported — retrying without');
      return ollamaChatDetailed(conn, model, prompt, timeoutMs, images, rest);
    }
    throw err;
  }
}

export async function startDevReviewJob(options: StartDevReviewJobOptions): Promise<StartedAiJob> {
  const { mbId, model, think, extraInstructions, source, images, inputHash, log } = options;
  const jobSource = { model, promptVersion: DEV_REVIEW_PROMPT_VERSION, inputHash };
  if (options.reuseCompleted !== false) {
    const reusable = await findReusableAiJob(USE_CASE, mbId, jobSource);
    if (reusable !== null) {
      log.info({ useCase: USE_CASE, jobId: reusable.id, mbId }, 'ai job cache hit');
      return { job: reusable, cached: true };
    }
  }

  const conn = await getAiConnection();
  const job = await createAiJob({ useCase: USE_CASE, mbId, ...jobSource });

  void (async () => {
    let effective = source;
    // ① 첨부 판독 — 실패해도 텍스트만으로 계속한다(근거가 줄 뿐 파이프라인은 살아 있다).
    if (images.length > 0) {
      await setAiJobStage(job.id, 'attachments');
      const visionModel = (await getAiVisionModel()).model;
      try {
        const read = await chatWithOptionFallback(
          conn,
          visionModel,
          buildAttachmentReadPrompt(images.length),
          ATTACHMENT_TIMEOUT_MS,
          images,
          { format: ATTACHMENT_READ_JSON_SCHEMA },
          log,
        );
        const block = parseAttachmentReadResult(read.text);
        if (block !== '') {
          effective = {
            ...source,
            attachmentContext:
              source.attachmentContext === '' ? block : `${source.attachmentContext}\n\n${block}`,
          };
        }
      } catch (err) {
        log.warn({ err, jobId: job.id, visionModel }, 'ai attachment read failed — text only');
      }
    }

    // ② 검토서 — 파싱 실패는 동일 프롬프트로 1회 재시도(러너 관례).
    await setAiJobStage(job.id, 'review');
    const prompt = buildDevReviewPrompt(effective, extraInstructions);
    const extra: OllamaChatExtra = {
      format: DEV_REVIEW_LLM_JSON_SCHEMA,
      think,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const raw = await chatWithOptionFallback(
        conn, model, prompt, REVIEW_TIMEOUT_MS, [], extra, log,
      );
      if (raw.text.trim() === '') {
        lastError = new Error('EMPTY_RESULT');
        continue;
      }
      try {
        const output = parseDevReviewLlmOutput(raw.text);
        const meta: DevReviewMetaType = {
          jobId: job.id,
          model,
          promptVersion: DEV_REVIEW_PROMPT_VERSION,
          inputHash,
          generatedAt: new Date().toISOString(),
          attachmentFiles: [...effective.attachmentFiles],
        };
        const { review, diagnostics } = postProcessDevReview(output, effective, meta);
        await finishAiJob(job.id, { review });
        log.info(
          { jobId: job.id, elapsedMs: raw.elapsedMs, facts: review.requirements.length, openQuestions: review.openQuestions.length, diagnostics },
          'dev review job done',
        );
        return;
      } catch (err) {
        lastError = err;
        log.warn({ jobId: job.id, attempt }, 'dev review parse failed — retrying');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GENERATION_FAILED');
  })().catch((err: unknown) => {
    log.warn({ err, useCase: USE_CASE, jobId: job.id }, 'dev review generation failed');
    const message = err instanceof Error && err.message === 'EMPTY_RESULT'
      ? 'EMPTY_RESULT'
      : 'GENERATION_FAILED';
    void finishAiJob(job.id, { error: message });
  });

  log.info({ useCase: USE_CASE, jobId: job.id, mbId, model, images: images.length }, 'ai job started');
  return { job, cached: false };
}
