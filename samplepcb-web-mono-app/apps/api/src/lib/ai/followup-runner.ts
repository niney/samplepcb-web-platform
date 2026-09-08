import type { FastifyBaseLogger } from 'fastify';
import { DEVELOP_FOLLOWUP_VERSION } from '@sp/api-contract';
import type { DevelopFollowupResultType } from '@sp/api-contract';
import { ATTACHMENT_READ_JSON_SCHEMA, buildAttachmentReadPrompt, parseAttachmentReadResult } from './dev-review';
import {
  DEVELOP_FOLLOWUP_JSON_SCHEMA,
  DEVELOP_FOLLOWUP_PROMPT_VERSION,
  buildDevelopFollowupPrompt,
  parseDevelopFollowupLlmOutput,
} from './develop-followup';
import type { DevelopFollowupSource } from './develop-followup';
import { createAiJob, findReusableAiJob, finishAiJob, setAiJobStage, type AiJob } from './jobs';
import type { OllamaChatExtra, OllamaThink } from './ollama';
import { chatWithOptionFallback } from './runner';
import { DEVELOP_FOLLOWUP_USECASE, getAiConnection, getAiVisionModel } from './usecases';

// ── 개발의뢰 AI 후속 질문 러너(docs/DEVELOP_FLOW.md §7.2.2) ────────────────────────────
// 검토서 러너와 같은 2단 파이프라인: ① 첨부 이미지 판독(비전, 있을 때만) → 텍스트로 합류 ② 질문 생성(주모델, format 강제)
// → 파싱·정규화 → sp_ai_job 에 저장. 같은 입력(제목·설명·첨부 해시)의 완료 잡은 1시간 안에 재사용한다(3스텝 재진입).
// 고객이 기다리는 잡이라 실패는 조용히 error 로 끝내고, 위저드가 고정 3문항으로 폴백한다.

const ATTACHMENT_TIMEOUT_MS = 180_000;
type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export interface StartDevelopFollowupJobOptions {
  mbId: string;
  model: string;
  think: OllamaThink;
  extraInstructions: string;
  source: DevelopFollowupSource;
  images: readonly string[]; // base64 래스터 미리보기(비전 판독 대상)
  inputHash: string;
  timeoutMs: number;
  log: AiRunLogger;
}

export async function startDevelopFollowupJob(options: StartDevelopFollowupJobOptions): Promise<{ job: AiJob; cached: boolean }> {
  const { mbId, model, think, extraInstructions, source, images, inputHash, timeoutMs, log } = options;
  const jobSource = { model, promptVersion: DEVELOP_FOLLOWUP_PROMPT_VERSION, inputHash };
  const reusable = await findReusableAiJob(DEVELOP_FOLLOWUP_USECASE, mbId, jobSource);
  if (reusable !== null) {
    log.info({ useCase: DEVELOP_FOLLOWUP_USECASE, jobId: reusable.id, mbId }, 'ai job cache hit');
    return { job: reusable, cached: true };
  }

  const conn = await getAiConnection();
  const job = await createAiJob({
    useCase: DEVELOP_FOLLOWUP_USECASE,
    mbId,
    ...jobSource,
    stage: images.length > 0 ? 'attachments' : 'followup',
  });

  void (async () => {
    let effective = source;
    if (images.length > 0) {
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
            attachmentContext: source.attachmentContext === '' ? block : `${source.attachmentContext}\n\n${block}`,
          };
        }
      } catch (err) {
        log.warn({ err, jobId: job.id, visionModel }, 'followup attachment read failed — text only');
      }
    }

    await setAiJobStage(job.id, 'followup');
    const prompt = buildDevelopFollowupPrompt(effective, extraInstructions);
    const extra: OllamaChatExtra = { format: DEVELOP_FOLLOWUP_JSON_SCHEMA, think };
    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const raw = await chatWithOptionFallback(conn, model, prompt, timeoutMs, [], extra, log);
      if (raw.text.trim() === '') {
        lastError = new Error('EMPTY_RESULT');
        continue;
      }
      try {
        const parsed = parseDevelopFollowupLlmOutput(raw.text);
        const result: DevelopFollowupResultType = {
          version: DEVELOP_FOLLOWUP_VERSION,
          understood: parsed.understood,
          questions: parsed.questions,
          meta: {
            jobId: job.id,
            model,
            promptVersion: DEVELOP_FOLLOWUP_PROMPT_VERSION,
            generatedAt: new Date().toISOString(),
            attachmentFiles: [...effective.attachmentFiles].slice(0, 20),
          },
        };
        await finishAiJob(job.id, { followup: result });
        log.info({ jobId: job.id, elapsedMs: raw.elapsedMs, questions: result.questions.length, attempt }, 'develop followup job done');
        return;
      } catch (err) {
        lastError = err;
        log.warn({ jobId: job.id, attempt }, 'develop followup parse failed — retrying');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GENERATION_FAILED');
  })().catch(async (err: unknown) => {
    log.warn({ err, jobId: job.id }, 'develop followup generation failed');
    await finishAiJob(job.id, { error: err instanceof Error ? err.message : 'GENERATION_FAILED' });
  });

  return { job, cached: false };
}
