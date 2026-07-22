import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';
import {
  BomPartSearchQuery,
  BomPartSearchResponse,
  BomPartSearchSupplementBody,
  BomPartSearchSupplementResponse,
  BomSupplierOptions,
  PartDetailResponse,
} from '@sp/api-contract';
import { pickDefaultOffer } from '@sp/utils';
import { esClient } from '../es/client';
import { SP_PARTS_READ, type SpPartDoc } from '../es/sp-parts-index';
import { ingestJobResult, jobOwnedBy, proxyEngine, recordJobOwner, startIngestPoller } from '../lib/bom-engine-jobs';
import { refreshQuotesForJob, toOfferInputs } from '../lib/bom-quote';
import { reserveDailySupplierSearch } from '../lib/bom-supplier-operations';
import { getBomQuoteConfig } from '../lib/sp-config';
import { engineFetch } from '../lib/engine-client';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';
import { loadPartDetailDto } from '../lib/parts-read';
import { prisma } from '../lib/prisma';
import { buildExactSearchIntent, buildPartSort, buildSearchQuery, toHit } from './admin-parts';

// ── /api/bom — 고객(회원) 스마트 BOM: 엔진 잡 프록시 + 카탈로그 검색 ──────────
// 잡 생성은 견적 생성(POST /api/bom/quotes)이 담당 — 여기는 폴링·공급사 검색.
// 소유 확인: 잡은 만든 회원만(타인·미기록 잡은 404 로 은닉, 엔진 잡과 함께 인메모리).
// 비용 게이트: 공급사 검색은 회원별 일일 한도 + max_calls 클램프(sp_config).

const IdParams = z.object({ id: z.string().min(1) });
const PartSearchSupplementError = z.object({ result: z.literal(false), error: z.string() });

export const bomRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // 인메모리 소유가 sp-node 재시작으로 유실돼도 견적 행(engineJobId+mbId)이 소유를
  // 증명한다 — 엔진 잡이 살아있는 한 기존 draft 의 공급사 검색이 계속 동작.
  const assertJobAccess = async (jobId: string, mbId: string): Promise<boolean> => {
    if (jobOwnedBy(jobId, mbId)) return true;
    const quote = await prisma.spBomQuote.findFirst({
      where: { engineJobId: jobId, mbId },
      select: { id: true },
    });
    if (quote === null) return false;
    recordJobOwner(jobId, mbId);
    return true;
  };

  fastify.get('/bom/jobs/:id', { schema: { params: IdParams } }, async (request, reply) => {
    if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}`, undefined, 200);
  });

  fastify.get('/bom/jobs/:id/result', { schema: { params: IdParams } }, async (request, reply) => {
    if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/result`, undefined, 200);
  });

  fastify.post(
    '/bom/jobs/:id/supplier-search/preflight',
    { schema: { params: IdParams, body: BomSupplierOptions } },
    async (request, reply) => {
      if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
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
      if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
      const config = await getBomQuoteConfig();
      if (!(await reserveDailySupplierSearch(request.user.mbId, config.memberDailySearchLimit))) {
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
    if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
    return proxyEngine(reply, `/jobs/${encodeURIComponent(request.params.id)}/supplier-search`, undefined, 200);
  });

  fastify.get('/bom/jobs/:id/supplier-search/result', { schema: { params: IdParams } }, async (request, reply) => {
    if (!(await assertJobAccess(request.params.id, request.user.mbId))) return reply.notFound('잡을 찾을 수 없습니다');
    const out = await proxyEngine(
      reply,
      `/jobs/${encodeURIComponent(request.params.id)}/supplier-search/result`,
      undefined,
      200,
    );
    if (reply.statusCode === 200) {
      // 백업 훅 — 인제스트 후 연결된 draft 견적까지 재매칭(폴러 유실·재시작 내성)
      void ingestJobResult(request.params.id, request.log)
        .then(async (ingested) => {
          if (ingested) await refreshQuotesForJob(request.params.id, request.log);
        })
        .catch((error: unknown) => {
          request.log.warn({ jobId: request.params.id, err: String(error) }, '백업 견적 재매칭 실패');
        });
    }
    return out;
  });

  // ── 카탈로그 검색(단일 검색 화면·부품 교체/추가 모달) — admin-parts 쿼리 빌더
  // 재사용, 패싯 생략. 결과 행에는 필요수량(needed) 기준 대표 구매 조건을 서버가 계산해
  // 첨부한다(FE 와 동일한 pickDefaultOffer — 환율 문맥이 없어 KRW 환산 없이 원통화).
  fastify.get('/bom/parts-search', { schema: { querystring: BomPartSearchQuery, response: { 200: BomPartSearchResponse } } }, async (request) => {
    const q = request.query;
    const exactIntent = buildExactSearchIntent(q);
    const makeSearchRequest = (query: estypes.QueryDslQueryContainer): estypes.SearchRequest => ({
      index: SP_PARTS_READ,
      from: (q.page - 1) * q.pageSize,
      size: q.pageSize,
      query,
      sort: buildPartSort(q.sort),
    } as unknown as estypes.SearchRequest);
    let searchMode: 'exact' | 'similar' | 'text' = exactIntent === null ? 'text' : 'exact';
    let res = await esClient().search<SpPartDoc>(
      makeSearchRequest(exactIntent?.query ?? buildSearchQuery(q)),
    );
    let total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
    // 해석된 모든 규격을 만족하는 문서가 없을 때만 기존 broad 검색을 별도
    // "유사 결과"로 보여준다. 정확/부분 일치를 한 목록에 섞지 않는다.
    if (exactIntent !== null && total === 0) {
      searchMode = 'similar';
      res = await esClient().search<SpPartDoc>(makeSearchRequest(buildSearchQuery(q)));
      total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
    }
    const hits = res.hits.hits.flatMap((h) => (h._source === undefined ? [] : [toHit(h._source, h._score)]));
    const parts = hits.length === 0
      ? []
      : await prisma.spPart.findMany({
          where: { id: { in: hits.map((h) => BigInt(h.id)) } },
          include: { offers: { include: { priceBreaks: true } } },
        });
    const applied = new Map(parts.map((part) => [String(part.id), pickDefaultOffer(toOfferInputs(part), q.needed, null)] as const));
    return {
      result: true as const,
      data: {
        items: hits.map((hit) => {
          const pick = applied.get(hit.id) ?? null;
          return {
            ...hit,
            applied:
              pick === null
                ? null
                : {
                    supplier: pick.offer.supplier,
                    supplierSku: pick.offer.supplierSku,
                    packaging: pick.offer.packaging,
                    currency: pick.currency,
                    stock: pick.offer.stock,
                    moq: pick.offer.moq,
                    orderMultiple: pick.offer.orderMultiple,
                    fetchedAt: pick.offer.fetchedAt,
                    priceBreaks: pick.offer.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
                    unitPrice: pick.unitPrice,
                    breakQty: pick.breakQty,
                    orderQty: pick.orderQty,
                    stockShort: pick.stockShort,
                  },
          };
        }),
        total,
        searchMode,
        interpretedSpecCount: exactIntent?.interpretedSpecCount ?? 0,
        page: q.page,
        pageSize: q.pageSize,
        facets: { manufacturers: [], packages: [], suppliers: [] }, // 모달 용도 — 패싯 불필요
      },
    };
  });

  // 로컬 색인 exact miss 보강 — 공급사 캐시/API 검색 → 즉시 인제스트·색인.
  // 사용자가 명시적으로 눌렀을 때만 호출하며 기존 회원별 일일 한도를 공유한다.
  fastify.post(
    '/bom/parts-search/supplement',
    {
      schema: {
        body: BomPartSearchSupplementBody,
        response: {
          200: BomPartSearchSupplementResponse,
          429: PartSearchSupplementError,
          503: PartSearchSupplementError,
        },
      },
    },
    async (request, reply) => {
      const parsedQuery = BomPartSearchQuery.parse({ q: request.body.q });
      const exactIntent = buildExactSearchIntent(parsedQuery);
      if (exactIntent === null || exactIntent.interpretedSpecCount < 2) {
        return reply.badRequest('두 개 이상의 명확한 규격이 있는 검색어만 공급사에서 추가 확인할 수 있습니다');
      }
      // 화면 조회 뒤 다른 작업이 같은 규격을 이미 색인했을 수 있다. 외부 API·일일
      // 횟수를 소모하기 직전에 한 번 더 확인해 중복 보강을 막는다.
      const existing = await esClient().count({
        index: SP_PARTS_READ,
        query: exactIntent.query,
      } as unknown as estypes.CountRequest);
      if (existing.count > 0) {
        return { result: true as const, data: { parts: 0, offers: 0, indexed: 0, queued: 0 } };
      }
      const config = await getBomQuoteConfig();
      if (!(await reserveDailySupplierSearch(request.user.mbId, config.memberDailySearchLimit))) {
        return reply.status(429).send({ result: false, error: 'SEARCH_DAILY_LIMIT' });
      }
      let response: Response;
      try {
        response = await engineFetch('/parts/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: request.body.q, max_calls: Math.min(config.supplierSearchMaxCalls, 12) }),
        });
      } catch {
        return reply.status(503).send({ result: false, error: 'BOM_ENGINE_UNREACHABLE' });
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        request.log.warn({ statusCode: response.status, query: request.body.q }, '부품 공급사 추가 검색 실패');
        return reply.status(503).send({ result: false, error: 'BOM_ENGINE_ERROR' });
      }
      const stats = await ingestSupplierSearchResult(body);
      return { result: true as const, data: stats };
    },
  );

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
