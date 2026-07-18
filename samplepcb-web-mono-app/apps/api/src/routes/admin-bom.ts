import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { collectMultipart } from '../lib/market';

// ── /api/admin/bom — BOM 추출 + 공급사 검색 (sp-engine Python 프록시, requireAdmin) ──
// sp-node 는 인증 경계 + 얇은 프록시. 엔진은 사설망·무인증이며 잡 상태를 소유한다.
// 응답은 엔진 원본(G-shape 등)을 {result:true,data} 봉투로 감싸 그대로 전달(직렬화
// 스키마 미지정 → 방대한 결과가 탈락 없이 통과, 클라이언트가 Zod 로 검증).
const BOM_ENGINE_URL = process.env.BOM_ENGINE_URL ?? 'http://127.0.0.1:8400';
const BOM_ENGINE_TIMEOUT_MS = Number(process.env.BOM_ENGINE_TIMEOUT_MS ?? 120_000);

const IdParams = z.object({ id: z.string().min(1) });

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, BOM_ENGINE_TIMEOUT_MS);
  try {
    return await fetch(`${BOM_ENGINE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(
  reply: FastifyReply,
  path: string,
  init: RequestInit | undefined,
  okStatus: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await engineFetch(path, init);
  } catch {
    return reply.status(502).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return reply.status(res.status).send({ result: false, error: 'BOM_ENGINE_ERROR', detail: body });
  }
  return reply.status(okStatus).send({ result: true, data: body });
}

export const adminBomRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 업로드 → 파싱 잡 생성(멀티파트: file + 선택 engine)
  fastify.post('/bom/jobs', async (request, reply) => {
    if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
    const { files, fields } = await collectMultipart(request);
    const file = files.find((f) => f.field === 'file') ?? files[0];
    if (file === undefined) return reply.badRequest('file 파트가 없습니다');
    const form = new FormData();
    form.append('file', new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimetype }));
    form.append('engine', fields.engine ?? 'smartbom');
    return proxy(reply, '/jobs', { method: 'POST', body: form }, 202);
  });

  // 잡 상태 폴링
  fastify.get('/bom/jobs/:id', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}`, undefined, 200),
  );

  // 추출 결과(G-shape)
  fastify.get('/bom/jobs/:id/result', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/result`, undefined, 200),
  );

  // 공급사 검색 시작/상태/결과
  fastify.post('/bom/jobs/:id/supplier-search', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, { method: 'POST' }, 202),
  );

  fastify.get('/bom/jobs/:id/supplier-search', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, undefined, 200),
  );

  fastify.get('/bom/jobs/:id/supplier-search/result', { schema: { params: IdParams } }, async (request, reply) =>
    proxy(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/result`, undefined, 200),
  );

  done();
};
