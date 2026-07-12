import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AiJobResponse,
  AiRunResponse,
  AiUsecaseKey,
  AiUsecaseStatusResponse,
  ApiMemberError,
} from '@sp/api-contract';
import { extractHtml, ollamaChat } from '../lib/ai/ollama';
import { AI_USECASE_DEFS, getAiConnection, getAiUsecase } from '../lib/ai/usecases';
import { createAiJob, finishAiJob, getAiJob } from '../lib/ai/jobs';

// ── /api/ai — 범용 AI 유스케이스 실행 ───────────────────────────────────────
// 라우트는 범용, 정책(입력 스키마·프롬프트 바인딩)은 레지스트리(lib/ai/usecases.ts)가
// 유스케이스별로 명시. 생성이 수 분이라 run 은 잡을 만들고 즉시 반환 → 폴링(jobs/:id).
// 외부 전송 원칙: 입력 스키마에 선언된 텍스트만 나간다 — 사용자 첨부 파일은 어떤
// 유스케이스에서도 보내지 않는다(NDA 원칙).

const UsecaseParams = z.object({ useCase: AiUsecaseKey });
const JobParams = z.object({ jobId: z.string().uuid() });

// LLM 산출 HTML 상한 — DB(MEDIUMTEXT)·응답 크기 방어.
const MAX_HTML_BYTES = 512_000;

export const aiRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── GET /ai/:useCase/status — 공개(비밀 없음): FE 스텝 게이트용 활성 여부 ──
  fastify.get(
    '/ai/:useCase/status',
    { schema: { params: UsecaseParams, response: { 200: AiUsecaseStatusResponse } } },
    async (request) => {
      const row = await getAiUsecase(request.params.useCase);
      return {
        result: true as const,
        data: { useCase: request.params.useCase, enabled: row?.enabled ?? false },
      };
    },
  );

  // ── POST /ai/:useCase/run — 로그인 사용자, 비동기 잡 시작 ──────────────────
  fastify.post(
    '/ai/:useCase/run',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: UsecaseParams,
        body: z.unknown(), // 실제 검증은 유스케이스 inputSchema (케이스별 상이)
        response: { 200: AiRunResponse, 400: ApiMemberError, 409: ApiMemberError },
      },
    },
    async (request, reply) => {
      const key = request.params.useCase;
      const def = AI_USECASE_DEFS[key];
      const row = await getAiUsecase(key);
      if (!row?.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }
      const input = def.inputSchema.safeParse(request.body);
      if (!input.success) {
        return reply.status(400).send({ result: false, error: 'INPUT_SCHEMA_MISMATCH' });
      }

      const prompt = def.buildPrompt(row.promptTemplate, input.data);
      const conn = await getAiConnection();
      const job = createAiJob(key, request.user.mbId);

      // 백그라운드 생성 — 실패는 잡에 기록(비차단). 서버 재시작 시 잡 소실=클라 재시도.
      void ollamaChat(conn, row.model, prompt)
        .then((raw) => {
          const html = extractHtml(raw);
          if (html === '' || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
            finishAiJob(job.id, { error: html === '' ? 'EMPTY_RESULT' : 'RESULT_TOO_LARGE' });
            return;
          }
          finishAiJob(job.id, { html });
        })
        .catch((err: unknown) => {
          request.log.warn({ err, useCase: key, jobId: job.id }, 'ai generation failed');
          finishAiJob(job.id, { error: 'GENERATION_FAILED' });
        });

      request.log.info({ useCase: key, jobId: job.id, mbId: request.user.mbId, model: row.model }, 'ai job started');
      return { result: true as const, data: { jobId: job.id } };
    },
  );

  // ── GET /ai/jobs/:jobId — 소유자 폴링 ──────────────────────────────────────
  fastify.get(
    '/ai/jobs/:jobId',
    {
      preHandler: [fastify.authenticate],
      schema: { params: JobParams, response: { 200: AiJobResponse, 404: ApiMemberError } },
    },
    async (request, reply) => {
      const job = getAiJob(request.params.jobId);
      // 타인 잡은 존재 자체를 숨긴다(404 동일 응답).
      if (job?.mbId !== request.user.mbId) {
        return reply.status(404).send({ result: false, error: 'JOB_NOT_FOUND' });
      }
      return {
        result: true as const,
        data: {
          jobId: job.id,
          status: job.status,
          html: job.status === 'done' ? job.html : null,
          error: job.error,
          elapsedSecs: Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000),
        },
      };
    },
  );

  done();
};
