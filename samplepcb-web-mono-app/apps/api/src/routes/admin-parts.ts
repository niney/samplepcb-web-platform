import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';
import {
  PartDetailResponse,
  PartRefreshResponse,
  PartSearchQuery,
  PartSearchResponse,
  type PartHitType,
  type PartSearchQueryType,
} from '@sp/api-contract';
import { SPEC_SI_FIELD, normalizeMpn, packageVariants, parseQuery, siRange } from '@sp/utils';
import { esClient } from '../es/client';
import { F, SP_PARTS_READ, type SpPartDoc } from '../es/sp-parts-index';
import { prisma } from '../lib/prisma';
import { specsSiRecord } from '../lib/parts-es';
import { engineFetch } from '../lib/engine-client';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';

// ── /api/admin/parts — 부품 카탈로그 검색(ES) + 상세(DB) (requireAdmin) ──────
// 쿼리 이해: @sp/utils parseQuery 의 다중 해석을 전부 should(가산점)로 편성 —
// 해석을 배타 필터로 승격하지 않는다(잘못된 해석은 히트가 없어 무해, 랭킹이 결정).
// 예외: 패키지 코드는 "메트릭 대응이 있는 알려진 코드"(0402↔1005)일 때만 필터 승격 —
// "4700" 같은 값-토큰이 패키지로 오인돼 전체를 걸러버리는 사고를 막는 안전핀.

const IdParams = z.object({ id: z.coerce.bigint() });

const BOOST = { mpnExact: 10, mpnPrefix: 8, specHigh: 6, variantExact: 6, mpnNgram: 4, variantPrefix: 3, specLow: 2, description: 1 } as const;

type Query = estypes.QueryDslQueryContainer;

export function buildSearchQuery(params: PartSearchQueryType): Query {
  const parsed = parseQuery(params.q);
  const should: Query[] = [];
  const filter: Query[] = [];

  // 텍스트 토큰 → MPN(정확·프리픽스·인픽스)·제조사·설명
  for (const tok of parsed.texts) {
    const norm = normalizeMpn(tok);
    if (norm.length >= 2) {
      should.push({ term: { [F.mpnNormKeyword]: { value: norm, boost: BOOST.mpnExact } } });
      should.push({ match: { [F.mpnNorm]: { query: norm, boost: BOOST.mpnPrefix } } });
      if (norm.length >= 4) {
        // ngram 인덱스 + AND = 인픽스 포함 의미("155R71C" 가 MPN 중간이어도 히트)
        should.push({ match: { [F.mpnNormNgram]: { query: norm, operator: 'and', boost: BOOST.mpnNgram } } });
      }
    }
    const lower = tok.toLowerCase();
    should.push({ term: { 'manufacturerName.norm': { value: lower, boost: BOOST.specHigh } } });
    should.push({ match: { [F.description]: { query: tok, boost: BOOST.description } } });
    // Track B: 관행 표기 정확·프리픽스("2p"→"2p2")
    should.push({ term: { [F.specVariants]: { value: lower, boost: BOOST.variantExact } } });
    if (/\d/.test(lower)) should.push({ match: { [F.specVariantsPrefix]: { query: lower, boost: BOOST.variantPrefix } } });
  }

  // Track A: 스펙 다중 해석 → SI range (high/low 부스트 차등)
  for (const s of parsed.specs) {
    const field = SPEC_SI_FIELD[s.kind];
    should.push({ range: { [field]: { ...siRange(s.si), boost: s.confidence === 'high' ? BOOST.specHigh : BOOST.specLow } } });
  }

  // 패키지: 알려진 코드(메트릭 대응 존재)만 필터 승격, 나머지는 위 should 가 커버
  const knownPkgs = parsed.packageCodes.filter((c) => packageVariants(c).length > 1);
  if (knownPkgs.length > 0) {
    filter.push({ terms: { [F.packageVariants]: knownPkgs } });
    // "1005"처럼 패키지 토큰만 입력해도 minimum_should_match=1을 만족해야 한다.
    // 필터는 후보 범위를 제한하고, 이 절은 패키지 자체를 유효한 검색 의도로 인정한다.
    should.push({ terms: { [F.packageVariants]: knownPkgs, boost: BOOST.specHigh } });
  }

  // 구조화 필터(패싯 클릭·범위 입력) — 여기만 배타 필터
  if (params.manufacturer !== undefined) filter.push({ term: { [F.manufacturerName]: params.manufacturer } });
  if (params.packageCode !== undefined) filter.push({ terms: { [F.packageVariants]: [params.packageCode] } });
  if (params.supplier !== undefined) filter.push({ term: { [F.suppliers]: params.supplier } });
  if (params.inStockOnly) filter.push({ range: { [F.totalStock]: { gt: 0 } } });
  const ranges: [string, number | undefined, number | undefined][] = [
    ['resistanceOhm', params.resistanceMin, params.resistanceMax],
    ['capacitanceF', params.capacitanceMin, params.capacitanceMax],
    ['inductanceH', params.inductanceMin, params.inductanceMax],
    ['voltageV', params.voltageMin, params.voltageMax],
  ];
  for (const [field, min, max] of ranges) {
    if (min === undefined && max === undefined) continue;
    filter.push({ range: { [field]: { ...(min === undefined ? {} : { gte: min }), ...(max === undefined ? {} : { lte: max }) } } });
  }

  const bool: estypes.QueryDslBoolQuery = { filter };
  if (should.length > 0) {
    bool.should = should;
    bool.minimum_should_match = 1;
  }
  return { bool };
}

/** 검색 API와 실 ES 통합 테스트가 같은 정렬 계약을 사용한다. */
export function buildPartSort(sort: PartSearchQueryType['sort']): estypes.Sort {
  if (sort === 'price') return [{ [F.minPrice]: { order: 'asc', missing: '_last' } }];
  if (sort === 'stock') return [{ [F.totalStock]: { order: 'desc' } }];
  return ['_score'];
}

function toHit(doc: SpPartDoc, score: number | null | undefined): PartHitType {
  const specsSi: Record<string, number> = {};
  for (const field of Object.values(SPEC_SI_FIELD)) {
    const v = (doc as unknown as Record<string, unknown>)[field];
    if (typeof v === 'number') specsSi[field] = v;
  }
  return {
    id: doc.partId,
    mpn: doc.mpn,
    manufacturerName: doc.manufacturerName,
    description: doc.description,
    category: doc.category,
    packageCode: doc.packageCode,
    lifecycle: doc.lifecycle,
    specsSi,
    suppliers: doc.suppliers,
    offerCount: doc.offerCount,
    minPrice: doc.minPrice,
    minPriceCurrency: doc.minPriceCurrency ?? null, // 구 문서(필드 이전 색인) 호환
    totalStock: doc.totalStock,
    offersFetchedAt: doc.offersFetchedAt ?? null,
    score: score ?? null,
  };
}

function facetBuckets(aggs: Record<string, estypes.AggregationsAggregate> | undefined, name: string): { value: string; count: number }[] {
  const agg = aggs?.[name] as estypes.AggregationsStringTermsAggregate | undefined;
  const buckets = agg?.buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets.map((b) => ({ value: String(b.key), count: b.doc_count }));
}

export const adminPartsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const SearchUnavailable = z.object({ result: z.literal(false), error: z.string() });

  fastify.get(
    '/parts/search',
    { schema: { querystring: PartSearchQuery, response: { 200: PartSearchResponse, 503: SearchUnavailable } } },
    async (request, reply) => {
      const q = request.query;
      const sort = buildPartSort(q.sort);
      // exactOptionalPropertyTypes 와 ES 클라이언트 타입의 알려진 비호환 — 변수로 전달되는
      // QueryDslQueryContainer 가 EOPT 하에서 거부되므로 요청 객체만 명시 캐스트한다.
      const searchRequest = {
        index: SP_PARTS_READ,
        from: (q.page - 1) * q.pageSize,
        size: q.pageSize,
        query: buildSearchQuery(q),
        sort,
        aggs: {
          manufacturers: { terms: { field: F.manufacturerName, size: 20 } },
          packages: { terms: { field: F.packageCode, size: 20 } },
          suppliers: { terms: { field: F.suppliers, size: 10 } },
        },
      } as unknown as estypes.SearchRequest;
      let res: estypes.SearchResponse<SpPartDoc>;
      try {
        res = await esClient().search<SpPartDoc>(searchRequest);
      } catch {
        return reply.status(503).send({ result: false as const, error: 'SEARCH_UNAVAILABLE' });
      }
      const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
      return {
        result: true as const,
        data: {
          items: res.hits.hits.flatMap((h) => (h._source === undefined ? [] : [toHit(h._source, h._score)])),
          total,
          page: q.page,
          pageSize: q.pageSize,
          facets: {
            manufacturers: facetBuckets(res.aggregations, 'manufacturers'),
            packages: facetBuckets(res.aggregations, 'packages'),
            suppliers: facetBuckets(res.aggregations, 'suppliers'),
          },
        },
      };
    },
  );

  // 상세 — DB(진실원본)에서 오퍼·가격구간 포함
  fastify.get(
    '/parts/:id',
    { schema: { params: IdParams, response: { 200: PartDetailResponse } } },
    async (request, reply) => {
      const part = await prisma.spPart.findUnique({
        where: { id: request.params.id },
        include: { offers: { include: { priceBreaks: true } } },
      });
      if (part === null) return reply.notFound('부품을 찾을 수 없습니다');
      return {
        result: true as const,
        data: {
          id: String(part.id),
          mpn: part.mpn,
          manufacturerName: part.manufacturerName,
          description: part.description,
          category: part.category,
          packageCode: part.packageCode,
          lifecycle: part.lifecycle,
          specsSi: specsSiRecord(part.specsSi),
          specsJson: (typeof part.specsJson === 'object' && part.specsJson !== null && !Array.isArray(part.specsJson)
            ? part.specsJson
            : {}),
          suppliers: [...new Set(part.offers.map((o) => o.supplier))],
          offerCount: part.offers.length,
          minPrice: null,
          minPriceCurrency: null,
          totalStock: part.offers.reduce((sum, o) => sum + (o.stock ?? 0), 0),
          offersFetchedAt:
            part.offers.length === 0
              ? null
              : new Date(Math.max(...part.offers.map((o) => o.fetchedAt.getTime()))).toISOString(),
          score: null,
          firstSeenAt: part.firstSeenAt.toISOString(),
          lastSeenAt: part.lastSeenAt.toISOString(),
          offers: part.offers.map((o) => ({
            supplier: o.supplier,
            supplierSku: o.supplierSku,
            productUrl: o.productUrl,
            stock: o.stock,
            moq: o.moq,
            orderMultiple: o.orderMultiple,
            packaging: o.packaging,
            currency: o.currency,
            priceBreaks: [...o.priceBreaks]
              .sort((a, b) => a.qty - b.qty)
              .map((pb) => ({ qty: pb.qty, price: Number(pb.price) })),
            fetchedAt: o.fetchedAt.toISOString(),
          })),
        },
      };
    },
  );

  // 수동 갱신 — 엔진 강제 라이브 단건 검색(캐시 읽기 무시) → 재인제스트.
  // 자동 갱신은 의도적으로 없다: 검색은 항상 색인 응답, 최신화는 관리자가 이 버튼으로.
  fastify.post(
    '/parts/:id/refresh',
    { schema: { params: IdParams, response: { 200: PartRefreshResponse, 503: SearchUnavailable } } },
    async (request, reply) => {
      const part = await prisma.spPart.findUnique({
        where: { id: request.params.id },
        select: { mpn: true, manufacturerName: true },
      });
      if (part === null) return reply.notFound('부품을 찾을 수 없습니다');
      let res: Response;
      try {
        res = await engineFetch('/parts/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ part_number: part.mpn, manufacturer: part.manufacturerName }),
        });
      } catch {
        return reply.status(503).send({ result: false as const, error: 'BOM_ENGINE_UNREACHABLE' });
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) return reply.status(503).send({ result: false as const, error: 'BOM_ENGINE_ERROR' });
      const stats = await ingestSupplierSearchResult(body);
      return { result: true as const, data: stats };
    },
  );

  done();
};
