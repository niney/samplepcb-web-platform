import type { FastifyBaseLogger } from 'fastify';
import { DEVELOP_DOC_MAIL_VERSION } from '@sp/api-contract';
import type { DevelopDocMailResultType } from '@sp/api-contract';
import {
  DEVELOP_DOC_MAIL_JSON_SCHEMA,
  DEVELOP_DOC_MAIL_PROMPT_VERSION,
  buildDevelopDocMailPrompt,
  parseDevelopDocMailLlmOutput,
} from './develop-doc-mail';
import type { DevelopDocMailSource } from './develop-doc-mail';
import { createAiJob, findReusableAiJob, finishAiJob, type AiJob } from './jobs';
import type { OllamaChatExtra, OllamaThink } from './ollama';
import { chatWithOptionFallback } from './runner';
import { DEVELOP_DOC_MAIL_USECASE, getAiConnection } from './usecases';

// ── 개발의뢰 문서 → 고객 메일 초안 러너(docs/DEVELOP_FLOW.md §13) ─────────────────────────────
// 한 단(텍스트만, 첨부 판독 없음). 관리자가 상세 화면에서 기다리는 짧은 잡이라 후속 질문 러너와 같은 sp_ai_job 폴링을 쓴다.
// 같은 문서 내용(inputHash)의 완료 잡은 1시간 안에 재사용한다(버튼 연타·새로고침). 실패는 error 로 끝나고 화면은 결정적 초안을 쓴다.

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

export interface StartDevelopDocMailJobOptions {
  mbId: string; // 관리자(잡 소유자 — 본인만 폴링)
  model: string;
  think: OllamaThink;
  extraInstructions: string;
  source: DevelopDocMailSource;
  inputHash: string;
  timeoutMs: number;
  log: AiRunLogger;
}

export async function startDevelopDocMailJob(options: StartDevelopDocMailJobOptions): Promise<{ job: AiJob; cached: boolean }> {
  const { mbId, model, think, extraInstructions, source, inputHash, timeoutMs, log } = options;
  const jobSource = { model, promptVersion: DEVELOP_DOC_MAIL_PROMPT_VERSION, inputHash };
  const reusable = await findReusableAiJob(DEVELOP_DOC_MAIL_USECASE, mbId, jobSource);
  if (reusable !== null) {
    log.info({ useCase: DEVELOP_DOC_MAIL_USECASE, jobId: reusable.id, mbId }, 'ai job cache hit');
    return { job: reusable, cached: true };
  }
  const conn = await getAiConnection();
  const job = await createAiJob({ useCase: DEVELOP_DOC_MAIL_USECASE, mbId, ...jobSource, stage: 'docmail' });

  void (async () => {
    const prompt = buildDevelopDocMailPrompt(source, extraInstructions);
    const extra: OllamaChatExtra = { format: DEVELOP_DOC_MAIL_JSON_SCHEMA, think };
    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const raw = await chatWithOptionFallback(conn, model, prompt, timeoutMs, [], extra, log);
      if (raw.text.trim() === '') {
        lastError = new Error('EMPTY_RESULT');
        continue;
      }
      try {
        const parsed = parseDevelopDocMailLlmOutput(raw.text);
        const result: DevelopDocMailResultType = {
          version: DEVELOP_DOC_MAIL_VERSION,
          subject: parsed.subject,
          body: parsed.body,
          meta: { jobId: job.id, model, promptVersion: DEVELOP_DOC_MAIL_PROMPT_VERSION, generatedAt: new Date().toISOString() },
        };
        await finishAiJob(job.id, { docMail: result });
        log.info({ jobId: job.id, elapsedMs: raw.elapsedMs, attempt }, 'develop doc-mail job done');
        return;
      } catch (err) {
        lastError = err;
        log.warn({ jobId: job.id, attempt }, 'develop doc-mail parse failed — retrying');
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GENERATION_FAILED');
  })().catch(async (err: unknown) => {
    log.warn({ err, jobId: job.id }, 'develop doc-mail generation failed');
    await finishAiJob(job.id, { error: err instanceof Error ? err.message : 'GENERATION_FAILED' });
  });

  return { job, cached: false };
}
