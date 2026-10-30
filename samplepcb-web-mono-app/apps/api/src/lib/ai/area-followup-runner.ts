import type { FastifyBaseLogger } from 'fastify';
import { ATTACHMENT_READ_JSON_SCHEMA, buildAttachmentReadPrompt, parseAttachmentReadResult } from './dev-review';
import {
  DEVELOP_AREA_FOLLOWUP_JSON_SCHEMA,
  DEVELOP_AREA_FOLLOWUP_PROMPT_VERSION,
  buildDevelopAreaFollowupPrompt,
  parseDevelopAreaFollowupLlmOutput,
  toDevelopAreaFollowupResult,
} from './develop-area-followup';
import type { DevelopAreaFollowupSource } from './develop-area-followup';
import { createAiJob, findReusableAiJob, finishAiJob, setAiJobStage, type AiJob } from './jobs';
import type { OllamaChatExtra, OllamaThink } from './ollama';
import { chatWithOptionFallback } from './runner';
import { DEVELOP_AREA_FOLLOWUP_USECASE, getAiConnection, getAiVisionModel } from './usecases';

// ── 개발의뢰 개별 메뉴 AI 맞춤 질문 러너(docs/DEVELOP_FLOW.md §7.2.4) ────────────────────────────
// 시스템개발 후속 질문 러너(followup-runner.ts)와 같은 2단: ① 첨부 이미지 판독(있을 때만) ② 기본 질문 처리(주모델, format 강제)
// → 정규화 → sp_ai_job. 같은 입력(제목·설명·분야·첨부 해시)의 완료 잡은 1시간 안에 재사용한다(3스텝 재진입).
// 실패는 조용히 error 로 끝내고, 위저드가 기본 질문 그대로 묻는다.

const ATTACHMENT_TIMEOUT_MS = 180_000;
type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export interface StartDevelopAreaFollowupJobOptions {
  mbId: string;
  model: string;
  think: OllamaThink;
  extraInstructions: string;
  source: DevelopAreaFollowupSource;
  images: readonly string[]; // base64 래스터 미리보기(비전 판독 대상)
  inputHash: string;
  timeoutMs: number;
  log: AiRunLogger;
}

export async function startDevelopAreaFollowupJob(options: StartDevelopAreaFollowupJobOptions): Promise<{ job: AiJob; cached: boolean }> {
  const { mbId, model, think, extraInstructions, source, images, inputHash, timeoutMs, log } = options;
  const jobSource = { model, promptVersion: DEVELOP_AREA_FOLLOWUP_PROMPT_VERSION, inputHash };
  const reusable = await findReusableAiJob(DEVELOP_AREA_FOLLOWUP_USECASE, mbId, jobSource);
  if (reusable !== null) {
    log.info({ useCase: DEVELOP_AREA_FOLLOWUP_USECASE, jobId: reusable.id, mbId }, 'ai job cache hit');
    return { job: reusable, cached: true };
  }

  const conn = await getAiConnection();
  const job = await createAiJob({
    useCase: DEVELOP_AREA_FOLLOWUP_USECASE,
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
        log.warn({ err, jobId: job.id, visionModel }, 'area followup attachment read failed — text only');
      }
    }

    await setAiJobStage(job.id, 'followup');
    const prompt = buildDevelopAreaFollowupPrompt(effective, extraInstructions);
    const extra: OllamaChatExtra = { format: DEVELOP_AREA_FOLLOWUP_JSON_SCHEMA, think };
    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const raw = await chatWithOptionFallback(conn, model, prompt, timeoutMs, [], extra, log);
      if (raw.text.trim() === '') {
        lastError = new Error('EMPTY_RESULT');
        continue;
      }
      try {
        const parsed = parseDevelopAreaFollowupLlmOutput(raw.text, effective.areas);
        const result = toDevelopAreaFollowupResult(parsed, {
          jobId: job.id,
          model,
          promptVersion: DEVELOP_AREA_FOLLOWUP_PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
          areas: [...effective.areas],
          attachmentFiles: [...effective.attachmentFiles].slice(0, 20),
        });
        await finishAiJob(job.id, { areaFollowup: result });
        log.info(
          { jobId: job.id, elapsedMs: raw.elapsedMs, covered: result.covered.length, asked: result.asked.length, added: result.added.length, dropped: parsed.dropped.length, attempt },
          'develop area followup job done',
        );
        return;
      } catch (err) {
        lastError = err;
        log.warn({ jobId: job.id, attempt }, 'develop area followup parse failed — retrying');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GENERATION_FAILED');
  })().catch(async (err: unknown) => {
    log.warn({ err, jobId: job.id }, 'develop area followup generation failed');
    try {
      await finishAiJob(job.id, { error: err instanceof Error ? err.message : 'GENERATION_FAILED' });
    } catch (finishErr) {
      log.warn({ err: finishErr, jobId: job.id }, 'develop area followup job failure could not be recorded');
    }
  });

  return { job, cached: false };
}
