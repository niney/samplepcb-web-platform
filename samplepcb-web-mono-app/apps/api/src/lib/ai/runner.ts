import type { FastifyBaseLogger } from 'fastify';
import type { AiUsecaseKeyType } from '@sp/api-contract';
import { ollamaChat } from './ollama';
import { AI_USECASE_DEFS, getAiConnection } from './usecases';
import {
  createAiJob,
  findReusableAiJob,
  finishAiJob,
  hashAiInput,
  hashAiText,
  type AiJob,
} from './jobs';

// 실제 의뢰 실행과 관리자 샘플 테스트가 같은 모델 호출·재시도·산출 검증을 쓰게 하는
// 공용 러너. 라우트는 권한과 입력 정책만 결정하고 장시간 생성은 여기서 비동기 처리한다.

const KNOWN_JOB_ERRORS = new Set(['EMPTY_RESULT', 'RESULT_TOO_LARGE']);

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

interface StartAiJobOptions {
  useCase: AiUsecaseKeyType;
  mbId: string;
  model: string;
  promptTemplate: string;
  input: unknown;
  prompt: string;
  log: AiRunLogger;
  reuseCompleted?: boolean;
}

export interface StartedAiJob {
  job: AiJob;
  cached: boolean;
}

export async function startAiJob(options: StartAiJobOptions): Promise<StartedAiJob> {
  const { useCase, mbId, model, promptTemplate, input, prompt, log } = options;
  const source = {
    model,
    promptVersion: hashAiText(promptTemplate),
    inputHash: hashAiInput(input),
  };
  if (options.reuseCompleted !== false) {
    const reusable = findReusableAiJob(useCase, mbId, source);
    if (reusable !== undefined) {
      log.info({ useCase, jobId: reusable.id, mbId }, 'ai job cache hit');
      return { job: reusable, cached: true };
    }
  }

  const conn = await getAiConnection();
  const job = createAiJob(useCase, mbId, source);
  const def = AI_USECASE_DEFS[useCase];

  // 서버 재시작 시 인메모리 잡은 소실되며 클라이언트가 재시도한다. 산출 파싱 실패는
  // 유스케이스별 retries 만큼 동일 프롬프트로 다시 표집한다.
  void (async () => {
    for (let attempt = 0; ; attempt += 1) {
      const raw = await ollamaChat(conn, model, prompt);
      try {
        finishAiJob(job.id, def.parseResult(raw));
        return;
      } catch (err) {
        if (attempt >= def.retries) throw err;
        log.warn({ useCase, jobId: job.id, attempt }, 'ai parse failed — retrying');
      }
    }
  })().catch((err: unknown) => {
    log.warn({ err, useCase, jobId: job.id }, 'ai generation failed');
    const message =
      err instanceof Error && KNOWN_JOB_ERRORS.has(err.message)
        ? err.message
        : 'GENERATION_FAILED';
    finishAiJob(job.id, { error: message });
  });

  log.info({ useCase, jobId: job.id, mbId, model }, 'ai job started');
  return { job, cached: false };
}
