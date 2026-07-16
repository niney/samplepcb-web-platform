import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AiJobResponse,
  AiQuestionPreanalysisRunBody,
  AiRunResponse,
  AiStructurizeRunBody,
  AiUsecaseKey,
  AiUsecaseStatusResponse,
  ApiMemberError,
} from '@sp/api-contract';
import {
  AI_QUESTION_PREANALYSIS_PROMPT,
  AI_USECASE_DEFS,
  buildQuestionPreanalysisPrompt,
  getAiUsecase,
  parseQuestionPreanalysisResult,
  questionPreanalysisJobSourceInput,
  structurizeJobSourceInput,
} from '../lib/ai/usecases';
import { getAiJob } from '../lib/ai/jobs';
import { startAiJob } from '../lib/ai/runner';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import { collectMultipart } from '../lib/market';

// ── /api/ai — 범용 AI 유스케이스 실행 ───────────────────────────────────────
// 라우트는 범용, 정책(입력 스키마·프롬프트 바인딩)은 레지스트리(lib/ai/usecases.ts)가
// 유스케이스별로 명시. 생성이 수 분이라 run 은 잡을 만들고 즉시 반환 → 폴링(jobs/:id).
// 외부 전송 원칙: 일반 run은 입력 스키마 텍스트만, 첨부 전용 structurize 라우트는
// 사용자 고지 뒤 제한 추출한 문서 텍스트·래스터 미리보기를 비전 모델에 전달한다.

const UsecaseParams = z.object({ useCase: AiUsecaseKey });
const JobParams = z.object({ jobId: z.string().uuid() });
const attachmentVisionModel = (): string => {
  const configured = process.env.AI_ATTACHMENT_VISION_MODEL?.trim() ?? '';
  return configured === '' ? 'qwen3.5:cloud' : configured;
};

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
      if (def.isApplicable !== undefined && !def.isApplicable(input.data)) {
        return reply.status(409).send({ result: false, error: 'USECASE_NOT_APPLICABLE' });
      }

      // 깊은 입력 검증(예: spec JSON 파손)은 buildPrompt 가 throw — 잡 시작 전 400.
      let prompt: string;
      try {
        prompt = def.buildPrompt(row.promptTemplate, input.data);
      } catch {
        return reply.status(400).send({ result: false, error: 'INPUT_SCHEMA_MISMATCH' });
      }
      const started = await startAiJob({
        useCase: key,
        mbId: request.user.mbId,
        model: row.model,
        promptTemplate: row.promptTemplate,
        input: input.data,
        prompt,
        log: request.log,
      });
      return {
        result: true as const,
        data: { jobId: started.job.id, cached: started.cached },
      };
    },
  );

  // ── POST /ai/market.request-structurize/preanalyze-questions ────────────
  // 설명·첨부에서 이미 답이 확인된 정책 질문을 먼저 골라 최초 질문 수를 줄인다. 별도
  // 관리자 유스케이스를 늘리지 않고 활성화된 structurize의 연결·모델 설정을 재사용한다.
  fastify.post(
    '/ai/market.request-structurize/preanalyze-questions',
    {
      schema: {
        response: { 200: AiRunResponse, 400: ApiMemberError, 401: ApiMemberError, 409: ApiMemberError },
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
      const baseInput = AiQuestionPreanalysisRunBody.safeParse(payloadJson);
      if (!baseInput.success) {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      }

      const key = 'market.request-structurize' as const;
      const row = await getAiUsecase(key);
      if (!row?.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }
      const attachments = files.filter((file) => file.field === 'attachment');
      const prepared = await prepareAiAttachments(attachments);
      const input = AiQuestionPreanalysisRunBody.parse({
        ...baseInput.data,
        ...(prepared.context === '' ? {} : { attachmentContext: prepared.context }),
        ...(prepared.hashes.length === 0 ? {} : { attachmentHashes: prepared.hashes }),
      });
      const prompt = buildQuestionPreanalysisPrompt(input);
      const started = await startAiJob({
        useCase: key,
        mbId: request.user.mbId,
        model: prepared.images.length > 0 ? attachmentVisionModel() : row.model,
        promptTemplate: AI_QUESTION_PREANALYSIS_PROMPT,
        input,
        sourceInput: questionPreanalysisJobSourceInput(input),
        prompt,
        images: prepared.images,
        parseResult: parseQuestionPreanalysisResult,
        retries: 1,
        log: request.log,
      });
      request.log.info({
        jobId: started.job.id,
        candidateCount: input.candidateQuestionCodes.length,
        analyzedFiles: prepared.analyzedFiles,
        imageCount: prepared.images.length,
      }, 'question preanalysis job started');
      return { result: true as const, data: { jobId: started.job.id, cached: started.cached } };
    },
  );

  // ── POST /ai/market.request-structurize/run-with-attachments ─────────────
  // 질문/설명 payload + 아직 등록 전인 attachment[]를 한 번에 받아 문서 텍스트와
  // 이미지 근거까지 포함한 명세 잡을 시작한다. multipart 제약상 본문 소비 뒤 JWT 검증.
  fastify.post(
    '/ai/market.request-structurize/run-with-attachments',
    {
      schema: {
        response: { 200: AiRunResponse, 400: ApiMemberError, 401: ApiMemberError, 409: ApiMemberError },
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
      const baseInput = AiStructurizeRunBody.safeParse(payloadJson);
      if (!baseInput.success) {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      }
      const attachments = files.filter((file) => file.field === 'attachment');
      if (attachments.length === 0) {
        return reply.status(400).send({ result: false, error: 'ATTACHMENT_REQUIRED' });
      }

      const key = 'market.request-structurize' as const;
      const def = AI_USECASE_DEFS[key];
      const row = await getAiUsecase(key);
      if (!row?.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }
      const prepared = await prepareAiAttachments(attachments);
      const input = AiStructurizeRunBody.parse({
        ...baseInput.data,
        attachmentContext: prepared.context,
        attachmentHashes: prepared.hashes,
      });
      let prompt: string;
      try {
        prompt = def.buildPrompt(row.promptTemplate, input);
      } catch {
        return reply.status(400).send({ result: false, error: 'INPUT_SCHEMA_MISMATCH' });
      }
      const started = await startAiJob({
        useCase: key,
        mbId: request.user.mbId,
        model: prepared.images.length > 0 ? attachmentVisionModel() : row.model,
        promptTemplate: row.promptTemplate,
        input,
        sourceInput: structurizeJobSourceInput(input),
        prompt,
        images: prepared.images,
        log: request.log,
      });
      request.log.info({
        jobId: started.job.id,
        analyzedFiles: prepared.analyzedFiles,
        imageCount: prepared.images.length,
        warningCount: prepared.warnings.length,
      }, 'attachment-aware structurize job started');
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
          json: job.status === 'done' ? job.json : null,
          md: job.status === 'done' ? job.md : null,
          error: job.error,
          elapsedSecs: Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000),
        },
      };
    },
  );

  done();
};
