import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';
import { BomSupplierOptions, PartDetailResponse, PartSearchQuery, PartSearchResponse } from '@sp/api-contract';
import { esClient } from '../es/client';
import { SP_PARTS_READ, type SpPartDoc } from '../es/sp-parts-index';
import { ingestJobResult, jobOwnedBy, proxyEngine, startIngestPoller, tryCountDailySearch } from '../lib/bom-engine-jobs';
import { getBomQuoteConfig } from '../lib/sp-config';
import { loadPartDetailDto } from '../lib/parts-read';
import { buildPartSort, buildSearchQuery, toHit } from './admin-parts';

// ── /api/bom — 고객(회원) 스마트 BOM: 엔진 잡 프록시 + 카탈로그 검색 ──────────
// 잡 생성은 견적 생성(POST /api/bom/quotes)이 담당 — 여기는 폴링·공급사 검색.
// 소유 확인: 잡은 만든 회원만(타인·미기록 잡은 404 로 은닉, 엔진 잡과 함께 인메모리).
// 비용 게이트: 공급사 검색은 회원별 일일 한도 + max_calls 클램프(sp_config).

const IdParams = z.object({ id: z.string().min(1) });

export const bomRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  const assertJobAccess = (jobId: string, mbId: string): boolean => jobOwnedBy(jobId, mbId);

  fastify.get('/bom/jobs/:id', { schema: { params: IdParams } }, async (request, reply) => {
    if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}`, undefined, 200);
  });

  fastify.get('/bom/jobs/:id/result', { schema: { params: IdParams } }, async (request, reply) => {
    if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/result`, undefined, 200);
  });

  fastify.post(
    '/bom/jobs/:id/supplier-search/preflight',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) => {
      if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
      const config = await getBomQuoteConfig();
      const body = { ...request.body, max_calls: Math.min(request.body.max_calls, config.supplierSearchMaxCalls) };
      return proxyEngine(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/preflight`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        200,
      );
    },
  );

  fastify.post(
    '/bom/jobs/:id/supplier-search',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) => {
      if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
      const config = await getBomQuoteConfig();
      if (!tryCountDailySearch(request.user.mbId, config.memberDailySearchLimit)) {
        return reply.status(429).send({ result: false, error: 'SEARCH_DAILY_LIMIT' });
      }
      const body = { ...request.body, max_calls: Math.min(request.body.max_calls, config.supplierSearchMaxCalls) };
      const out = await proxyEngine(
        reply,
        `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        202,
      );
      if (reply.statusCode === 202) startIngestPoller(request.params.id, request.log); // 카탈로그 자동 인제스트
      return out;
    },
  );

  fastify.get('/bom/jobs/:id/supplier-search', { schema: { params: IdParams } }, async (request, reply) => {
    if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, undefined, 200);
  });

  fastify.get('/bom/jobs/:id/supplier-search/result', { schema: { params: IdParams } }, async (request, reply) => {
    if (!assertJobAccess(request.params.id, request.user.mbId)) return reply.notFound('잡을 찾을 수 없습니다');
    const out = await proxyEngine(
      reply,
      `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/result`,
      undefined,
      200,
    );
    if (reply.statusCode === 200) void ingestJobResult(request.params.id, request.log); // 백업 훅
    return out;
  });

  // ── 카탈로그 검색(부품 교체·추가 모달) — admin-parts 쿼리 빌더 재사용, 패싯 생략 ──
  fastify.get('/bom/parts-search', { schema: { querystring: PartSearchQuery, response: { 200: PartSearchResponse } } }, async (request) => {
    const q = request.query;
    const searchRequest = {
      index: SP_PARTS_READ,
      from: (q.page - 1) * q.pageSize,
      size: q.pageSize,
      query: buildSearchQuery(q),
      sort: buildPartSort(q.sort),
    };
    const res = await esClient().search<SpPartDoc>(searchRequest as unknown as estypes.SearchRequest);
    const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
    return {
      result: true as const,
      data: {
        items: res.hits.hits.flatMap((h) => (h._source === undefined ? [] : [toHit(h._source, h._score)])),
        total,
        page: q.page,
        pageSize: q.pageSize,
        facets: { manufacturers: [], packages: [], suppliers: [] }, // 모달 용도 — 패싯 불필요
      },
    };
  });

  // 부품 상세(오퍼·가격구간) — 오퍼 변경 모달
  fastify.get(
    '/bom/parts/:id',
    { schema: { params: z.object({ id: z.coerce.bigint() }), response: { 200: PartDetailResponse } } },
    async (request, reply) => {
      const detail = await loadPartDetailDto(request.params.id);
      if (detail === null) return reply.notFound('부품을 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  done();
};
