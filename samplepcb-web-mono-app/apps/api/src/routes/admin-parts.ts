import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';
import {
  ApiError,
  PartBulkDeleteBody,
  PartBulkDeletePreviewBody,
  PartBulkDeletePreviewResponse,
  PartBulkDeleteResponse,
  PartDeleteResponse,
  PartDetailResponse,
  PartRefreshResponse,
  PartSearchQuery,
  PartSearchResponse,
  PartsResetBody,
  PartsResetResponse,
  type PartBulkDeleteFilterType,
  type PartBulkDeletePreviewDataType,
  type PartHitType,
  type PartSearchQueryType,
} from '@sp/api-contract';
import { SPEC_SI_FIELD, normalizeMpn, packageVariants, parseQuery, siRange } from '@sp/utils';
import { esClient } from '../es/client';
import { F, SP_PARTS_READ, SP_PARTS_WRITE, type SpPartDoc } from '../es/sp-parts-index';
import { prisma } from '../lib/prisma';
import { deleteBomFiles, forceDeleteCatalogRelatedBomQuotes } from '../lib/bom-quote-delete';
import { engineFetch } from '../lib/engine-client';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';
import { refreshPartsIndex } from '../lib/parts-es';
import { loadPartDetailDto } from '../lib/parts-read';
import { partOffersForDisplay } from '../lib/parts-offer-kind';

// ── /api/admin/parts — 부품 카탈로그 검색(ES) + 상세(DB) (requireAdmin) ──────
// 쿼리 이해: @sp/utils parseQuery 의 다중 해석을 전부 should(가산점)로 편성 —
// 해석을 배타 필터로 승격하지 않는다(잘못된 해석은 히트가 없어 무해, 랭킹이 결정).
// 예외: 패키지 코드는 "메트릭 대응이 있는 알려진 코드"(0402↔1005)일 때만 필터 승격 —
// "4700" 같은 값-토큰이 패키지로 오인돼 전체를 걸러버리는 사고를 막는 안전핀.

const IdParams = z.object({ id: z.coerce.bigint() });

const BOOST = { mpnExact: 10, mpnPrefix: 8, specHigh: 6, variantExact: 6, mpnNgram: 4, variantPrefix: 3, specLow: 2, description: 1 } as const;

type Query = estypes.QueryDslQueryContainer;

interface SearchQueryOptions {
  /** BOM 사용자 검색에서 신뢰도 높은 규격을 모두 만족해야 하는 필터로 승격한다. */
  exactSpecs?: boolean;
}

interface ExactSearchIntent {
  query: Query;
  interpretedSpecCount: number;
}

function buildSearchQueryInternal(params: PartSearchQueryType, options: SearchQueryOptions): Query {
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
    const range = { range: { [field]: { ...siRange(s.si), boost: s.confidence === 'high' ? BOOST.specHigh : BOOST.specLow } } };
    should.push(range);
    if (options.exactSpecs === true && s.confidence === 'high') {
      filter.push({ range: { [field]: siRange(s.si) } });
    }
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
    // 정확 규격 필터가 있으면 should 는 관련도 계산용이다. broad 검색은 기존처럼
    // 하나 이상 일치해야 하며 관리자 검색 동작은 그대로 유지된다.
    if (options.exactSpecs !== true) bool.minimum_should_match = 1;
  }
  return { bool };
}

export function buildSearchQuery(params: PartSearchQueryType): Query {
  return buildSearchQueryInternal(params, {});
}

/**
 * 해석 신뢰도가 높은 규격/알려진 패키지를 모두 만족하는 BOM 검색 쿼리.
 * 텍스트/MPN만 있는 검색은 null — 품번 검색의 기존 관련도 정책을 유지한다.
 */
export function buildExactSearchIntent(params: PartSearchQueryType): ExactSearchIntent | null {
  const parsed = parseQuery(params.q);
  const highSpecCount = parsed.specs.filter((spec) => spec.confidence === 'high').length;
  const hasKnownPackage = parsed.packageCodes.some((code) => packageVariants(code).length > 1);
  const interpretedSpecCount = highSpecCount + (hasKnownPackage ? 1 : 0);
  if (interpretedSpecCount === 0) return null;
  return {
    query: buildSearchQueryInternal(params, { exactSpecs: true }),
    interpretedSpecCount,
  };
}

/** 검색 API와 실 ES 통합 테스트가 같은 정렬 계약을 사용한다. */
export function buildPartSort(sort: PartSearchQueryType['sort']): estypes.Sort {
  if (sort === 'price') return [{ [F.minPrice]: { order: 'asc', missing: '_last' } }];
  if (sort === 'stock') return [{ [F.totalStock]: { order: 'desc' } }];
  return ['_score'];
}

export function toHit(doc: SpPartDoc, score: number | null | undefined): PartHitType {
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
    imageUrl: doc.imageUrl ?? null, // 구 문서(필드 이전 색인) 호환
    specsSi,
    suppliers: doc.suppliers,
    offerCount: doc.offerCount,
    minPrice: doc.minPrice,
    minPriceCurrency: doc.minPriceCurrency ?? null, // 구 문서(필드 이전 색인) 호환
    totalStock: doc.totalStock,
    offersFetchedAt: doc.offersFetchedAt ?? null,
    hasSpecConflict: doc.hasSpecConflict ?? false, // 구 문서 호환
    hasCatalogInquiryOffer: doc.hasCatalogInquiryOffer ?? false, // 구 문서 호환
    score: score ?? null,
  };
}


function facetBuckets(aggs: Record<string, estypes.AggregationsAggregate> | undefined, name: string): { value: string; count: number }[] {
  const agg = aggs?.[name] as estypes.AggregationsStringTermsAggregate | undefined;
  const buckets = agg?.buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets.map((b) => ({ value: String(b.key), count: b.doc_count }));
}

export interface PartDeletionPreviewPart {
  id: string;
  mpn: string;
  manufacturerName: string;
  offers: { supplier: string; supplierSku: string; rawJson: unknown }[];
}

export interface PartDeletionQuoteReference {
  partId: string;
  quoteId: string;
}

interface PartBulkDeletePreviewInternal {
  data: PartBulkDeletePreviewDataType;
  matchedIds: string[];
  deletableIds: string[];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function catalogSourceIdentity(
  rawJson: unknown,
): { supplier: string; sourceDataset: string; sourceSha256: string | null } | null {
  const product = objectValue(rawJson);
  const metadata = objectValue(product?.catalog_metadata);
  const supplier = product?.supplier;
  const sourceDataset = metadata?.sourceDataset;
  if (
    metadata?.catalogOnly !== true
    || typeof supplier !== 'string'
    || typeof sourceDataset !== 'string'
  ) return null;
  return {
    supplier,
    sourceDataset,
    sourceSha256: typeof metadata.sourceDatasetSha256 === 'string'
      ? metadata.sourceDatasetSha256
      : null,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = objectValue(value);
  if (record === null) return value;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

function numericIdSort(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return a.localeCompare(b);
}

/**
 * ES 검색 결과와 DB 사실을 결합해 삭제 가능/견적 보호 대상을 나눈다.
 * fingerprint에는 대상 ID·구매 조건 원천·견적 참조가 모두 들어가 미리보기 이후 변화가 있으면 실행을 거부한다.
 */
export function buildPartDeletionPreview(
  filter: PartBulkDeleteFilterType,
  matchedIdsInput: string[],
  partsInput: PartDeletionPreviewPart[],
  quoteReferencesInput: PartDeletionQuoteReference[],
): PartBulkDeletePreviewInternal {
  const matchedIds = [...new Set(matchedIdsInput)].sort(numericIdSort);
  const parts = [...partsInput].sort((a, b) => numericIdSort(a.id, b.id));
  const partById = new Map(parts.map((part) => [part.id, part]));
  const references = [...quoteReferencesInput].sort(
    (a, b) => numericIdSort(a.partId, b.partId) || numericIdSort(a.quoteId, b.quoteId),
  );
  const referencesByPart = new Map<string, string[]>();
  for (const reference of references) {
    const values = referencesByPart.get(reference.partId) ?? [];
    values.push(reference.quoteId);
    referencesByPart.set(reference.partId, values);
  }
  const protectedIds = new Set(referencesByPart.keys());
  const deletableIds = matchedIds.filter((id) => !protectedIds.has(id));

  const supplierCounts = new Map<string, number>();
  const sourceCounts = new Map<string, {
    supplier: string;
    sourceDataset: string;
    sourceSha256: string | null;
    count: number;
  }>();
  let multiSupplierParts = 0;
  for (const part of parts) {
    const realSuppliers = new Set<string>();
    for (const offer of partOffersForDisplay(part.offers)) {
      supplierCounts.set(offer.supplier, (supplierCounts.get(offer.supplier) ?? 0) + 1);
      if (offer.supplier !== 'samplepcb') realSuppliers.add(offer.supplier);
    }
    const partSources = new Map<string, {
      supplier: string;
      sourceDataset: string;
      sourceSha256: string | null;
    }>();
    for (const offer of part.offers) {
      const source = catalogSourceIdentity(offer.rawJson);
      if (source === null) continue;
      const key = `${source.supplier}\u0000${source.sourceDataset}\u0000${source.sourceSha256 ?? ''}`;
      partSources.set(key, source);
    }
    for (const [key, source] of partSources) {
      const current = sourceCounts.get(key);
      if (current === undefined) {
        sourceCounts.set(key, {
          ...source,
          count: 1,
        });
      } else {
        current.count += 1;
      }
    }
    if (realSuppliers.size > 1) multiSupplierParts += 1;
  }

  const protectedSample = [...protectedIds]
    .sort(numericIdSort)
    .flatMap((partId) => {
      const part = partById.get(partId);
      if (part === undefined) return [];
      const quoteIds = [...new Set(referencesByPart.get(partId) ?? [])].sort(numericIdSort);
      return [{
        partId,
        mpn: part.mpn,
        manufacturerName: part.manufacturerName,
        quoteCount: referencesByPart.get(partId)?.length ?? 0,
        quoteIds: quoteIds.slice(0, 20),
      }];
    })
    .slice(0, 50);
  const supplierOffers = [...supplierCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, count }));
  const catalogSources = [...sourceCounts.values()].sort(
    (a, b) =>
      a.supplier.localeCompare(b.supplier)
      || a.sourceDataset.localeCompare(b.sourceDataset)
      || (a.sourceSha256 ?? '').localeCompare(b.sourceSha256 ?? ''),
  );
  const fingerprint = createHash('sha256').update(JSON.stringify(canonicalize({
    filter,
    matchedIds,
    parts: parts.map((part) => ({
      id: part.id,
      offers: part.offers
        .map((offer) => ({
          supplier: offer.supplier,
          supplierSku: offer.supplierSku,
          source: catalogSourceIdentity(offer.rawJson),
        }))
        .sort((a, b) =>
          a.supplier.localeCompare(b.supplier)
          || a.supplierSku.localeCompare(b.supplierSku)
          || JSON.stringify(canonicalize(a.source)).localeCompare(JSON.stringify(canonicalize(b.source))),
        ),
    })),
    references,
  }))).digest('hex');
  const protectedQuoteItems = references.length;
  const protectedParts = protectedIds.size;
  return {
    matchedIds,
    deletableIds,
    data: {
      matchedParts: matchedIds.length,
      existingParts: parts.length,
      deletableParts: deletableIds.length,
      protectedParts,
      protectedQuoteItems,
      staleIndexDocuments: matchedIds.filter((id) => !partById.has(id)).length,
      multiSupplierParts,
      supplierOffers,
      catalogSources,
      protectedSample,
      previewHash: fingerprint,
      confirmation: `DELETE ${String(deletableIds.length)}`,
    },
  };
}

async function collectMatchingPartIds(filter: PartBulkDeleteFilterType): Promise<string[]> {
  const params = PartSearchQuery.parse({ ...filter, page: 1, pageSize: 100, sort: 'relevance' });
  let scrollId: string | undefined;
  const ids: string[] = [];
  try {
    let response = await esClient().search<SpPartDoc>({
      index: SP_PARTS_READ,
      query: buildSearchQuery(params),
      size: 500,
      sort: ['_doc'],
      scroll: '1m',
      _source: [F.partId],
    } as unknown as estypes.SearchRequest);
    scrollId = response._scroll_id;
    for (;;) {
      const hits = response.hits.hits;
      for (const hit of hits) {
        const id = hit._source?.partId ?? hit._id;
        if (id !== undefined) ids.push(id);
      }
      if (hits.length === 0 || scrollId === undefined) break;
      response = await esClient().scroll<SpPartDoc>({ scroll_id: scrollId, scroll: '1m' });
      scrollId = response._scroll_id ?? scrollId;
    }
  } finally {
    if (scrollId !== undefined) {
      await esClient().clearScroll({ scroll_id: scrollId }).catch(() => undefined);
    }
  }
  return [...new Set(ids)];
}

async function loadPartBulkDeletePreview(
  filter: PartBulkDeleteFilterType,
): Promise<PartBulkDeletePreviewInternal> {
  const matchedIds = await collectMatchingPartIds(filter);
  const numericIds = matchedIds.filter((id) => /^\d+$/.test(id)).map((id) => BigInt(id));
  const parts: PartDeletionPreviewPart[] = [];
  for (const batch of chunks(numericIds, 500)) {
    const rows = await prisma.spPart.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        mpn: true,
        manufacturerName: true,
        offers: { select: { supplier: true, supplierSku: true, rawJson: true } },
      },
    });
    parts.push(...rows.map((part) => ({
      id: String(part.id),
      mpn: part.mpn,
      manufacturerName: part.manufacturerName,
      offers: part.offers,
    })));
  }
  const quoteReferences: PartDeletionQuoteReference[] = [];
  for (const batch of chunks(numericIds, 500)) {
    const rows = await prisma.spBomQuoteItem.findMany({
      where: { partId: { in: batch } },
      select: { partId: true, quoteId: true },
    });
    quoteReferences.push(...rows.flatMap((row) =>
      row.partId === null ? [] : [{ partId: String(row.partId), quoteId: String(row.quoteId) }],
    ));
  }
  return buildPartDeletionPreview(filter, matchedIds, parts, quoteReferences);
}

async function deletePartDocuments(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  let cleanupPending = false;
  try {
    for (const batch of chunks(ids, 500)) {
      const response = await esClient().bulk({
        operations: batch.map((id) => ({ delete: { _index: SP_PARTS_WRITE, _id: id } })),
        refresh: false,
      });
      if (response.items.some((item) => {
        const operation = item.delete;
        return operation?.error !== undefined && operation.status !== 404;
      })) cleanupPending = true;
    }
    await refreshPartsIndex();
  } catch {
    cleanupPending = true;
  }
  return cleanupPending;
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
        track_total_hits: true,
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

  // 현재 검색 조건 전체 삭제 미리보기. 페이지 100건 제한을 사용하지 않고 ES scroll로
  // 정확한 ID 전체를 잡은 뒤 DB 구매 조건·견적 참조를 결합한다.
  fastify.post(
    '/parts/bulk-delete/preview',
    {
      schema: {
        body: PartBulkDeletePreviewBody,
        response: { 200: PartBulkDeletePreviewResponse, 503: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const preview = await loadPartBulkDeletePreview(request.body.filter);
        return { result: true as const, data: preview.data };
      } catch (error) {
        request.log.warn({ err: error }, 'parts bulk delete preview: 검색 실패');
        return reply.status(503).send({
          error: 'SEARCH_UNAVAILABLE',
          message: '필터 삭제 대상을 조회할 수 없습니다',
        });
      }
    },
  );

  // 미리보기와 동일한 필터·대상·구매 조건·견적 참조일 때만 삭제한다. 견적 연결 부품은
  // 미리보기 시점과 실행 직전 모두 제외하며 partId를 임의 해제하지 않는다.
  fastify.post(
    '/parts/bulk-delete',
    {
      schema: {
        body: PartBulkDeleteBody,
        response: {
          200: PartBulkDeleteResponse,
          409: ApiError,
          503: ApiError,
        },
      },
    },
    async (request, reply) => {
      let preview: PartBulkDeletePreviewInternal;
      try {
        preview = await loadPartBulkDeletePreview(request.body.filter);
      } catch (error) {
        request.log.warn({ err: error }, 'parts bulk delete: 대상 재조회 실패');
        return reply.status(503).send({
          error: 'SEARCH_UNAVAILABLE',
          message: '필터 삭제 대상을 다시 조회할 수 없습니다',
        });
      }
      if (preview.data.previewHash !== request.body.previewHash) {
        return reply.status(409).send({
          error: 'BULK_DELETE_PREVIEW_STALE',
          message: '미리보기 이후 대상이나 견적 연결이 변경되었습니다. 다시 확인하세요.',
        });
      }
      if (request.body.confirmation !== preview.data.confirmation) {
        return reply.status(409).send({
          error: 'BULK_DELETE_CONFIRMATION_MISMATCH',
          message: `확인 문구 ${preview.data.confirmation}을 정확히 입력하세요.`,
        });
      }
      if (preview.deletableIds.length === 0) {
        return reply.status(409).send({
          error: 'NO_DELETABLE_PARTS',
          message: '삭제 가능한 부품이 없습니다. 연결된 견적 부품은 보호됩니다.',
        });
      }

      let deletedParts = 0;
      const newlyProtectedIds = new Set<string>();
      const numericDeletableIds = preview.deletableIds
        .filter((id) => /^\d+$/.test(id))
        .map((id) => BigInt(id));
      for (const batch of chunks(numericDeletableIds, 200)) {
        const result = await prisma.$transaction(async (tx) => {
          const references = await tx.spBomQuoteItem.findMany({
            where: { partId: { in: batch } },
            select: { partId: true },
          });
          const protectedIds = new Set(
            references.flatMap((row) => row.partId === null ? [] : [String(row.partId)]),
          );
          const safeIds = batch.filter((id) => !protectedIds.has(String(id)));
          if (safeIds.length === 0) return { deleted: 0, protectedIds };
          await tx.spPartIndexQueue.deleteMany({ where: { partId: { in: safeIds } } });
          const deleted = await tx.spPart.deleteMany({ where: { id: { in: safeIds } } });
          return { deleted: deleted.count, protectedIds };
        });
        deletedParts += result.deleted;
        for (const id of result.protectedIds) newlyProtectedIds.add(id);
      }

      const previewDeletableIds = new Set(preview.deletableIds);
      const initialProtectedIds = preview.matchedIds.filter(
        (id) => !previewDeletableIds.has(id),
      );
      const protectedIds = [...new Set([...initialProtectedIds, ...newlyProtectedIds])];
      const protectedNumericIds = protectedIds.filter((id) => /^\d+$/.test(id)).map((id) => BigInt(id));
      const protectedQuoteItems = protectedNumericIds.length === 0
        ? 0
        : await prisma.spBomQuoteItem.count({ where: { partId: { in: protectedNumericIds } } });
      const esDeleteIds = preview.deletableIds.filter((id) => !newlyProtectedIds.has(id));
      const esCleanupPending = await deletePartDocuments(esDeleteIds);
      request.log.warn({
        filter: request.body.filter,
        matchedParts: preview.data.matchedParts,
        deletedParts,
        protectedParts: protectedIds.length,
        protectedQuoteItems,
        esCleanupPending,
      }, 'parts bulk delete completed');
      return {
        result: true as const,
        data: {
          matchedParts: preview.data.matchedParts,
          deletedParts,
          protectedParts: protectedIds.length,
          protectedQuoteItems,
          staleIndexDocuments: preview.data.staleIndexDocuments,
          esCleanupPending,
        },
      };
    },
  );

  // 상세 — DB(진실원본)에서 구매 조건·가격구간 포함
  fastify.get(
    '/parts/:id',
    { schema: { params: IdParams, response: { 200: PartDetailResponse } } },
    async (request, reply) => {
      const detail = await loadPartDetailDto(request.params.id);
      if (detail === null) return reply.notFound('부품을 찾을 수 없습니다');
      return { result: true as const, data: detail };
    },
  );

  // 카탈로그 초기화 — 연결된 BOM 견적은 상태와 무관하게 견적 단위로 강제 삭제한다.
  // API 확인 리터럴과 관리자 UI 2단계 경고가 부품+견적의 파괴 범위를 함께 명시한다.
  fastify.post(
    '/parts/reset',
    {
      schema: {
        body: PartsResetBody,
        response: { 200: PartsResetResponse },
      },
    },
    async (request) => {
      const deletedQuotes = await forceDeleteCatalogRelatedBomQuotes();
      const [, deletedParts] = await prisma.$transaction([
        prisma.spPartIndexQueue.deleteMany({}),
        prisma.spPart.deleteMany({}),
      ]);
      void deleteBomFiles(deletedQuotes.pathTokens);
      try {
        await esClient().deleteByQuery({ index: SP_PARTS_WRITE, query: { match_all: {} }, refresh: true, conflicts: 'proceed' });
      } catch (err) {
        request.log.warn({ err }, 'parts reset: ES 문서 정리 실패 — parts:reindex 로 정합 회복 가능');
      }
      request.log.warn({
        deletedParts: deletedParts.count,
        deletedQuotes: deletedQuotes.quotes,
        deletedQuoteItems: deletedQuotes.quoteItems,
        deletedQuoteFiles: deletedQuotes.pathTokens.length,
      }, 'parts reset completed with linked BOM quote purge');
      return {
        result: true as const,
        data: {
          parts: deletedParts.count,
          quotes: deletedQuotes.quotes,
          quoteItems: deletedQuotes.quoteItems,
        },
      };
    },
  );

  // 부품 단건 하드 삭제 — 견적이 참조 중이면 409로 보호하고 partId를 임의 해제하지 않는다.
  fastify.delete(
    '/parts/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: PartDeleteResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const id = request.params.id;
      const part = await prisma.spPart.findUnique({ where: { id }, select: { id: true } });
      if (part === null) return reply.notFound('부품을 찾을 수 없습니다');
      const deleted = await prisma.$transaction(async (tx) => {
        const quoteReferences = await tx.spBomQuoteItem.count({ where: { partId: id } });
        if (quoteReferences > 0) return { deleted: false, quoteReferences };
        await tx.spPartIndexQueue.deleteMany({ where: { partId: id } });
        await tx.spPart.delete({ where: { id } });
        return { deleted: true, quoteReferences: 0 };
      });
      if (!deleted.deleted) {
        return reply.status(409).send({
          error: 'PART_IN_USE',
          message: `견적에 연결된 부품은 삭제할 수 없습니다 (${String(deleted.quoteReferences)}개 라인)`,
        });
      }
      try {
        await esClient().delete({ index: SP_PARTS_WRITE, id: String(id), refresh: true });
      } catch (err) {
        request.log.warn({ err, partId: String(id) }, 'part delete: ES 문서 정리 실패 — parts:reindex 로 정합 회복 가능');
      }
      return { result: true as const };
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
