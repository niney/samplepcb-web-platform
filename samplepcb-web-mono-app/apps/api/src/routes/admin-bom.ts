import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BomSupplierOptions } from '@sp/api-contract';
import { collectMultipart } from '../lib/market';
import { ingestJobResult, proxyEngine, startIngestPoller } from '../lib/bom-engine-jobs';

// ── /api/admin/bom — BOM 추출 + 공급사 검색 (sp-engine Python 프록시, requireAdmin) ──
// 프록시·폴러·자동 인제스트 본체는 lib/bom-engine-jobs(고객 /api/bom 라우트와 공유).
// 응답은 엔진 원본(G-shape 등)을 {result:true,data} 봉투로 감싸 그대로 전달(직렬화
// 스키마 미지정 → 방대한 결과가 탈락 없이 통과, 클라이언트가 Zod 로 검증).

const IdParams = z.object({ id: z.string().min(1) });

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
    return proxyEngine(reply, '/jobs', { method: 'POST', body: form }, 202);
  });

  // 잡 상태 폴링
  fastify.get('/bom/jobs/:id', { schema: { params: IdParams } }, async (request, reply) =>
    proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}`, undefined, 200),
  );

  // 추출 결과(G-shape)
  fastify.get('/bom/jobs/:id/result', { schema: { params: IdParams } }, async (request, reply) =>
    proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/result`, undefined, 200),
  );

  // 공급사 검색은 사전점검으로 호출량·캐시·키 상태를 확인한 뒤에만 실행한다.
  fastify.post(
    '/bom/jobs/:id/supplier-search/preflight',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) =>
      proxyEngine(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/preflight`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        },
        200,
      ),
  );

  fastify.post(
    '/bom/jobs/:id/supplier-search',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) => {
      const out = await proxyEngine(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        },
        202,
      );
      if (reply.statusCode === 202) startIngestPoller(request.params.id, request.log); // 주 훅
      return out;
    },
  );

  fastify.get('/bom/jobs/:id/supplier-search', { schema: { params: IdParams } }, async (request, reply) =>
    proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, undefined, 200),
  );

  fastify.get('/bom/jobs/:id/supplier-search/result', { schema: { params: IdParams } }, async (request, reply) => {
    const out = await proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/result`, undefined, 200);
    if (reply.statusCode === 200) void ingestJobResult(request.params.id, request.log); // 백업 훅
    return out;
  });

  done();
};
