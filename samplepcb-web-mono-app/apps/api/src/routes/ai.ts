import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AiJobResponse,
  AiRunResponse,
  AiUsecaseStatusResponse,
  ApiMemberError,
  DevReviewRunPayload,
} from '@sp/api-contract';
import { AI_USECASE_DEFS, DEV_REVIEW_USECASE, getAiUsecase } from '../lib/ai/usecases';
import { getAiJob } from '../lib/ai/jobs';
import { devReviewInputHash } from '../lib/ai/dev-review';
import type { DevReviewSource } from '../lib/ai/dev-review';
import { hashAiBytes } from '../lib/ai/hash';
import { startDevReviewJob } from '../lib/ai/runner';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import { collectMultipart } from '../lib/market';

// ── /api/ai — AI 사전 검토서 실행 ───────────────────────────────────────────
// 2026-08-28 재작성(docs/AI_DEV_REVIEW.md §3): 범용 실행 라우트(/ai/:useCase/run)·선분석·
// 첨부 전용 구조화 라우트를 폐기하고 유스케이스 전용 라우트 하나로 좁혔다. 생성이 수 분이라
// run 은 잡(sp_ai_job)을 만들고 즉시 반환 → 클라이언트가 /ai/jobs/:id 를 폴링한다.
// 외부 전송 원칙: 제한 추출한 문서 텍스트 + 래스터 미리보기(비전 판독)만 나간다.

const JobParams = z.object({ jobId: z.string().uuid() });

// 첨부 원본(zip 전개 **전**) 앞 10개의 SHA-256 — 캐시·신선도 판정의 원천.
// ⚠ 의뢰 등록 라우트(market-projects create)가 같은 규칙으로 다시 계산한다. 두 곳이
// 어긋나면 정상 등록이 REVIEW_STALE 로 튕긴다 — 규칙을 바꾸면 반드시 함께 바꿀 것.
export const devReviewAttachmentHashes = (files: readonly { buffer: Buffer }[]): string[] =>
  files.slice(0, 10).map((f) => hashAiBytes(f.buffer));

export const aiRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── GET /ai/market.dev-review/status — 공개(비밀 없음): FE 스텝 게이트용 ──
  fastify.get(
    '/ai/market.dev-review/status',
    { schema: { response: { 200: AiUsecaseStatusResponse } } },
    async () => {
      const row = await getAiUsecase(DEV_REVIEW_USECASE);
      return {
        result: true as const,
        data: { useCase: DEV_REVIEW_USECASE, enabled: row?.enabled ?? false },
      };
    },
  );

  // ── POST /ai/market.dev-review/run — 로그인 사용자, 비동기 잡 시작 ─────────
  // multipart(payload JSON + attachment[]). @fastify/multipart 제약상 본문을 먼저 소비한
  // 뒤 jwtVerify 한다(등록 라우트와 같은 관례).
  fastify.post(
    '/ai/market.dev-review/run',
    {
      schema: {
        response: {
          200: AiRunResponse,
          400: ApiMemberError,
          401: ApiMemberError,
          409: ApiMemberError,
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.status(400).send({ result: false, error: 'MULTIPART_REQUIRED' });
      }
      const { files, rawPayload } = await collectMultipart(request);
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ result: false, error: 'UNAUTHORIZED' });
      }
      if (rawPayload === undefined) {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_REQUIRED' });
      }
      let payloadJson: unknown;
      try {
        payloadJson = JSON.parse(rawPayload);
      } catch {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      }
      const parsed = DevReviewRunPayload.safeParse(payloadJson);
      if (!parsed.success) {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      }
      const payload = parsed.data;

      const row = await getAiUsecase(DEV_REVIEW_USECASE);
      if (!row?.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }

      // zip 은 전개해서 내용까지 읽되, 해시는 고객이 올린 원본 파일 기준(등록 시 재현 가능).
      const attachments = files.filter((f) => f.field === 'attachment');
      const attachmentHashes = devReviewAttachmentHashes(attachments);
      const expanded = expandAiArchives(attachments);
      const prepared = await prepareAiAttachments(
        expanded.files.map((f) => ({ ...f, filename: f.displayPath })),
        { maxFiles: 50 },
      );

      const source: DevReviewSource = {
        title: payload.title,
        serviceAreas: payload.serviceAreas,
        description: payload.description,
        answers: payload.answers,
        attachmentContext: prepared.context,
        attachmentFiles: attachments.map((f) => f.filename).slice(0, 20),
      };
      const started = await startDevReviewJob({
        mbId: request.user.mbId,
        model: row.model,
        think: AI_USECASE_DEFS[DEV_REVIEW_USECASE].think,
        extraInstructions: row.extraInstructions ?? '',
        source,
        images: prepared.images,
        inputHash: devReviewInputHash({ ...payload, attachmentHashes }),
        log: request.log,
      });
      request.log.info(
        {
          jobId: started.job.id,
          attachments: attachments.length,
          expandedFiles: expanded.files.length,
          analyzedFiles: prepared.analyzedFiles,
          imageCount: prepared.images.length,
        },
        'dev review job requested',
      );
      return { result: true as const, data: { jobId: started.job.id, cached: started.cached } };
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
      const job = await getAiJob(request.params.jobId);
      // 타인 잡은 존재 자체를 숨긴다(404 동일 응답).
      if (job?.mbId !== request.user.mbId) {
        return reply.status(404).send({ result: false, error: 'JOB_NOT_FOUND' });
      }
      return {
        result: true as const,
        data: {
          jobId: job.id,
          status: job.status,
          stage: job.status === 'running' ? job.stage : null,
          review: job.review,
          error: job.error,
          elapsedSecs: Math.round(
            ((job.finishedAt ?? new Date()).getTime() - job.startedAt.getTime()) / 1000,
          ),
        },
      };
    },
  );

  done();
};
