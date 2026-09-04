import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AiJobResponse,
  AiRunResponse,
  AiUsecaseStatusResponse,
  ApiMemberError,
  DevReviewRunPayload,
  MARKET_ATTACHMENT_FIELD,
  parseMarketAttachmentField,
} from '@sp/api-contract';
import { DEV_REVIEW_USECASE, getAiUsecaseRuntime, toOllamaThink } from '../lib/ai/usecases';
import { getAiJob } from '../lib/ai/jobs';
import { devReviewInputHash } from '../lib/ai/dev-review';
import type { DevReviewSource } from '../lib/ai/dev-review';
import { hashAiBytes } from '../lib/ai/hash';
import { startDevReviewJob } from '../lib/ai/runner';
import { startDevDiagramJob } from '../lib/ai/dev-diagram-runner';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import { collectMultipart, splitMarketAttachments } from '../lib/market';

// ── /api/ai — AI 사전 검토서 실행 ───────────────────────────────────────────
// docs/AI_DEV_REVIEW.md §3·§13·§13.7: run 은 검토서 잡을 만들고 **시스템 구성도 잡을 병렬로** 시작한 뒤
// 즉시 반환 → 클라이언트가 /ai/jobs/:id 를 폴링한다. 구성도는 게이트(자료 부족)·유스케이스 비활성이면
// 시작하지 않고 diagramSkipReason 으로 알린다. 등록 시 devDiagramJobId 로 프로젝트에 연결된다.
// 외부 전송 원칙: 제한 추출한 문서 텍스트 + 래스터 미리보기(비전 판독)만 나간다.

const JobParams = z.object({ jobId: z.string().uuid() });

// 첨부 원본(zip 전개 **전**) 앞 10개의 SHA-256 — 캐시·신선도 판정의 원천. **1스텝 참고 자료
// (`attachment`)만** 잰다: 2스텝 분야 슬롯 자료는 AI 분석 대상이 아니므로(§13.10) 슬롯 파일을
// 더하거나 빼도 검토서가 오래되지 않는다. 파트 이름 순으로 정렬한다(순서가 달라도 같은 해시).
// ⚠ 의뢰 등록 라우트(market-projects create)가 같은 함수를 쓴다 — 규칙이 어긋나면 정상 등록이
// REVIEW_STALE 로 튕긴다.
export const devReviewAttachmentHashes = (files: readonly { field: string; buffer: Buffer }[]): string[] =>
  files
    .filter((f) => f.field === MARKET_ATTACHMENT_FIELD)
    .map((f) => `${f.field}:${hashAiBytes(f.buffer)}`)
    .sort()
    .slice(0, 10);

export const aiRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── GET /ai/market.dev-review/status — 공개(비밀 없음): FE 스텝 게이트용 ──
  fastify.get(
    '/ai/market.dev-review/status',
    { schema: { response: { 200: AiUsecaseStatusResponse } } },
    async () => {
      const runtime = await getAiUsecaseRuntime(DEV_REVIEW_USECASE);
      return {
        result: true as const,
        data: { useCase: DEV_REVIEW_USECASE, enabled: runtime.enabled },
      };
    },
  );

  // ── POST /ai/market.dev-review/run — 로그인 사용자, 비동기 잡 시작 ─────────
  // multipart(payload JSON + attachment[] + attachment:<area>:<slot>[]). @fastify/multipart 제약상
  // 본문을 먼저 소비한 뒤 jwtVerify 한다(등록 라우트와 같은 관례).
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

      const runtime = await getAiUsecaseRuntime(DEV_REVIEW_USECASE);
      if (!runtime.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }

      // 첨부 — 사전에 없는 파트 이름은 거절(레지스트리 정합).
      const split = splitMarketAttachments(files, payload.serviceAreas);
      if (split.invalid.length > 0) {
        return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
      }
      // AI 가 읽는 것은 **1스텝 참고 자료뿐**(§13.10). 2스텝 분야 슬롯 자료는 전문가에게만 간다 —
      // 현재 FE 는 아예 보내지 않지만, 옛 클라이언트가 보내도 400 없이 조용히 뺀다.
      const attachments = split.accepted.filter((f) => f.area === null);
      // zip 은 전개해서 내용까지 읽되, 해시는 고객이 올린 원본 파일 기준(등록 시 재현 가능).
      const attachmentHashes = devReviewAttachmentHashes(attachments);
      const expanded = expandAiArchives(
        attachments.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, filename: f.labeledName })),
      );
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
      const inputHash = devReviewInputHash({ ...payload, attachmentHashes });
      const started = await startDevReviewJob({
        mbId: request.user.mbId,
        model: runtime.model,
        think: toOllamaThink(runtime.think),
        extraInstructions: runtime.extraInstructions,
        source,
        images: prepared.images,
        inputHash,
        log: request.log,
      });
      // 시스템 구성도 — 같은 입력·같은 해시로 병렬 시작(§13.7). 첨부 이미지 판독 결과는 안 기다린다(텍스트 코퍼스만).
      const diagram = await startDevDiagramJob({ mbId: request.user.mbId, source, inputHash, log: request.log });
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
      return {
        result: true as const,
        data: {
          jobId: started.job.id,
          cached: started.cached,
          diagramJobId: diagram.ok ? diagram.job.id : null,
          diagramSkipReason: diagram.ok ? null : diagram.reason === 'DISABLED' ? 'DISABLED' : diagram.skipReason,
          diagramCached: diagram.ok ? diagram.cached : false,
        },
      };
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
          diagram: job.diagram,
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

// parseMarketAttachmentField 는 lib/market splitMarketAttachments 가 쓴다 — 여기서 재export 하지 않는다.
void parseMarketAttachmentField;
