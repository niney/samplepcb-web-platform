import path from 'node:path';
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AiJobResponse,
  AiRunResponse,
  ApiMemberError,
  RndAiJobQuery,
  RndAiModelsResponse,
  RndFileClassifyInput,
  RndFileClassifyPayload,
} from '@sp/api-contract';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import { getAiJob } from '../lib/ai/jobs';
import { ollamaListModels } from '../lib/ai/ollama';
import { startAiJob } from '../lib/ai/runner';
import { AI_USECASE_DEFS, getAiConnection } from '../lib/ai/usecases';
import { collectMultipart } from '../lib/market';

const RND_FILE_CLASSIFY_USECASE = 'rnd.file-classify' as const;
const JobParams = z.object({ jobId: z.string().uuid() });
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// 실제 PCB설계.zip으로 2026-07-17 프로빙해 이미지 입력을 수용한 현재 Ollama 모델.
// 파일 분류는 PDF/회로도/외형도 PNG를 함께 보므로 텍스트 전용 모델은 선택지에서 제외한다.
const RND_VISION_MODELS = new Set([
  'minimax-m3',
  'gemma4:31b',
  'qwen3.5:397b',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'mistral-large-3:675b',
]);

// 로그인 없는 로컬 연구 도구. 원본은 multipart 요청 처리 메모리에만 존재하고, 결과 잡도
// 1시간 TTL의 인메모리 상태다. clientId는 브라우저가 가진 난수로 잡을 다시 읽을 때만 쓴다.
export const rndAiRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/rnd/ai/models',
    { schema: { response: { 200: RndAiModelsResponse, 502: ApiMemberError } } },
    async (request, reply) => {
      try {
        const models = (await ollamaListModels(await getAiConnection())).filter((model) => RND_VISION_MODELS.has(model));
        return { result: true as const, data: { models } };
      } catch (err) {
        request.log.warn({ err }, 'rnd ai models fetch failed');
        return reply.status(502).send({ result: false, error: 'AI_CONNECTION_FAILED' });
      }
    },
  );

  fastify.post(
    '/rnd/ai/file-classify',
    { schema: { response: { 200: AiRunResponse, 400: ApiMemberError, 502: ApiMemberError } } },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.status(400).send({ result: false, error: 'MULTIPART_REQUIRED' });
      const { files, rawPayload } = await collectMultipart(request);
      if (rawPayload === undefined) return reply.status(400).send({ result: false, error: 'PAYLOAD_REQUIRED' });
      let payloadJson: unknown;
      try {
        payloadJson = JSON.parse(rawPayload);
      } catch {
        return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      }
      const payload = RndFileClassifyPayload.safeParse(payloadJson);
      if (!payload.success) return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
      if (files.length === 0) return reply.status(400).send({ result: false, error: 'FILE_REQUIRED' });
      const uploadBytes = files.reduce((total, file) => total + file.buffer.byteLength, 0);
      if (uploadBytes > MAX_UPLOAD_BYTES) {
        return reply.status(400).send({ result: false, error: 'UPLOAD_TOO_LARGE' });
      }

      let availableModels: string[];
      try {
        availableModels = await ollamaListModels(await getAiConnection());
      } catch (err) {
        request.log.warn({ err }, 'rnd ai model validation failed');
        return reply.status(502).send({ result: false, error: 'AI_CONNECTION_FAILED' });
      }
      if (!availableModels.includes(payload.data.model)) {
        return reply.status(400).send({ result: false, error: 'MODEL_NOT_AVAILABLE' });
      }
      if (!RND_VISION_MODELS.has(payload.data.model)) {
        return reply.status(400).send({ result: false, error: 'MODEL_NOT_VISION_CAPABLE' });
      }

      const expanded = expandAiArchives(files);
      if (expanded.files.length === 0) {
        return reply.status(400).send({ result: false, error: 'NO_ANALYZABLE_FILES' });
      }
      const numbered = expanded.files.map((file, index) => ({
        ...file,
        filename: `[F${String(index + 1).padStart(4, '0')}] ${file.displayPath}`,
      }));
      const prepared = await prepareAiAttachments(numbered, { maxFiles: 300 });
      const input = RndFileClassifyInput.parse({
        requirements: payload.data.requirements,
        files: expanded.files.map((file, index) => ({
          id: `F${String(index + 1).padStart(4, '0')}`,
          path: file.displayPath,
          extension: path.extname(file.displayPath).toLowerCase(),
          size: file.buffer.byteLength,
          extracted: file.extracted,
        })),
        attachmentContext: [
          prepared.context,
          ...(expanded.warnings.length === 0 ? [] : [`[압축 해제 경고]\n${expanded.warnings.map((warning) => `- ${warning}`).join('\n')}`]),
        ].join('\n\n'),
      });
      const def = AI_USECASE_DEFS[RND_FILE_CLASSIFY_USECASE];
      const prompt = def.buildPrompt(def.defaultPrompt, input);
      const started = await startAiJob({
        useCase: RND_FILE_CLASSIFY_USECASE,
        mbId: payload.data.clientId,
        model: payload.data.model,
        promptTemplate: def.defaultPrompt,
        input,
        prompt,
        log: request.log,
        images: prepared.images,
      });
      return { result: true as const, data: { jobId: started.job.id, cached: started.cached } };
    },
  );

  fastify.get(
    '/rnd/ai/jobs/:jobId',
    { schema: { params: JobParams, querystring: RndAiJobQuery, response: { 200: AiJobResponse, 404: ApiMemberError } } },
    async (request, reply) => {
      const job = getAiJob(request.params.jobId);
      if (job?.useCase !== RND_FILE_CLASSIFY_USECASE || job.mbId !== request.query.clientId) {
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
