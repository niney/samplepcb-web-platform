import { z } from 'zod';
import type { estypes } from '@elastic/elasticsearch';
import { normalizeMpn, normalizePackageCode, packageVariants } from '@sp/utils';
import { esClient } from '../es/client';
import { F, SP_PARTS_READ, type SpPartDoc } from '../es/sp-parts-index';
import { engineFetch } from './engine-client';
import { resolveManufacturer } from './manufacturer-alias';
import { prisma } from './prisma';

const LocalCatalogOffer = z
  .object({
    supplier: z.string().min(1),
    // 이 경로는 catalog_metadata.catalogOnly=true인 제조사 원장만 허용한다.
    // 기존 적재 데이터에 필드가 없어도 엔진에는 구매 오퍼와 구분해 전달한다.
    offer_kind: z.literal('manufacturer_catalog').default('manufacturer_catalog'),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nonnegative().nullish(),
    moq: z.number().int().positive().nullish(),
    order_multiple: z.number().int().positive().nullish(),
    price_breaks: z.array(z.unknown()).default([]),
    lead_time: z.string().nullish(),
    product_url: z.string().nullish(),
    fetched_at: z.string().min(1),
  })
  .passthrough();

const LocalCatalogProduct = z
  .object({
    supplier: z.string().min(1),
    manufacturer_part_number: z.string().min(1),
    manufacturer: z.string().min(1),
    catalog_metadata: z
      .object({
        catalogOnly: z.literal(true),
      })
      .passthrough(),
    offers: z.array(LocalCatalogOffer).default([]),
  })
  .passthrough();

const LocalFallbackQuery = z
  .object({
    component_id: z.string(),
    mode: z.string(),
    part_number: z.string().nullish(),
    manufacturer: z.string().nullish(),
  })
  .passthrough();

const LocalFallbackComponent = z
  .object({
    component_id: z.string(),
    status: z.string(),
    query: LocalFallbackQuery.nullish(),
    initial_query: LocalFallbackQuery.nullish(),
    candidates: z.array(z.unknown()).default([]),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();

const LocalFallbackEnvelope = z
  .object({
    search: z
      .object({
        components: z.array(LocalFallbackComponent),
        procurement_policy: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CatalogEvaluationResponse = z.object({
  items: z.array(
    z
      .object({
        component_id: z.string(),
        status: z.string(),
        candidates: z.array(z.unknown()),
        procurement_decision: z.unknown(),
        warnings: z.array(z.string()).default([]),
      })
      .passthrough(),
  ),
});

const PlannedRequirement = z
  .object({
    normalized_value: z.unknown().nullish(),
    hard: z.boolean(),
    comparison: z.enum(['eq', 'gte', 'lte', 'contains', 'category']),
  })
  .passthrough();

const PreferredCatalogQuery = z
  .object({
    component_id: z.string().min(1),
    mode: z.string(),
    part_number: z.string().nullish(),
    manufacturer: z.string().nullish(),
    part_type: z.string().nullish(),
    category_policy: z.string().nullish(),
    package: z.string().nullish(),
    requirements: z.record(z.string(), PlannedRequirement).default({}),
  })
  .passthrough();

const SupplierPreflightPlan = z
  .object({
    plan: z.object({
      components: z.array(
        z
          .object({
            component_id: z.string().min(1),
            planned_queries: z.array(PreferredCatalogQuery).default([]),
          })
          .passthrough(),
      ),
    }).passthrough(),
  })
  .passthrough();

type LocalFallbackEnvelopeType = z.infer<typeof LocalFallbackEnvelope>;
type LocalFallbackComponentType = z.infer<typeof LocalFallbackComponent>;
type LocalCatalogProductType = z.infer<typeof LocalCatalogProduct>;
type CatalogEvaluationItemType = z.infer<typeof CatalogEvaluationResponse>['items'][number];

interface CatalogPartRow {
  mpnNorm: string;
  manufacturerNorm: string;
  offers: { rawJson: unknown }[];
}

interface PreferredCatalogPartRow {
  id: bigint;
  offers: {
    supplier: string;
    supplierSku: string;
    productUrl: string | null;
    stock: number | null;
    moq: number | null;
    orderMultiple: number | null;
    packaging: string | null;
    currency: string | null;
    leadTime: string | null;
    fetchedAt: Date;
    rawJson: unknown;
    priceBreaks: { qty: number; price: { toString(): string }; currency: string }[];
  }[];
}

interface LocalCatalogEvaluationInput {
  component: LocalFallbackComponentType;
  query: z.infer<typeof LocalFallbackQuery>;
  products: LocalCatalogProductType[];
}

export interface LocalCatalogFallbackLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

const LOCAL_FALLBACK_STATUSES = new Set(['not_found', 'supplier_error']);
const CATALOG_EVALUATION_BATCH_SIZE = 200;
const PREFERRED_CATALOG_SEARCH_SIZE = 20;
const PREFERRED_CATALOG_SEARCH_CONCURRENCY = 20;
type EsSearchQuery = NonNullable<estypes.SearchRequest['query']>;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function fallbackComponents(
  envelope: LocalFallbackEnvelopeType,
): LocalFallbackComponentType[] {
  return envelope.search.components.filter((component) => {
    const query = exactIdentityQuery(component);
    return component.candidates.length === 0
      && LOCAL_FALLBACK_STATUSES.has(component.status)
      && query !== null
      && normalizeMpn(query.part_number ?? '') !== '';
  });
}

function exactIdentityQuery(
  component: LocalFallbackComponentType,
): z.infer<typeof LocalFallbackQuery> | null {
  for (const query of [component.initial_query, component.query]) {
    if (
      query !== null
      && query !== undefined
      && normalizeMpn(query.part_number ?? '') !== ''
    ) return query;
  }
  return null;
}

function productsForComponent(
  component: LocalFallbackComponentType,
  partsByMpn: Map<string, CatalogPartRow[]>,
): LocalCatalogProductType[] {
  const query = exactIdentityQuery(component);
  if (query === null) return [];
  const mpnNorm = normalizeMpn(query.part_number ?? '');
  const parts = partsByMpn.get(mpnNorm) ?? [];
  if (parts.length === 0) return [];

  const manufacturerNorm = resolveManufacturer(query.manufacturer).norm;
  const matchedParts = manufacturerNorm === 'unknown'
    ? new Set(parts.map((part) => part.manufacturerNorm)).size === 1
      ? parts
      : []
    : parts.filter((part) => part.manufacturerNorm === manufacturerNorm);
  const products = new Map<string, LocalCatalogProductType>();
  for (const part of matchedParts) {
    for (const offer of part.offers) {
      const parsed = LocalCatalogProduct.safeParse(offer.rawJson);
      if (!parsed.success) continue;
      const product = parsed.data;
      if (
        normalizeMpn(product.manufacturer_part_number) !== part.mpnNorm
        || resolveManufacturer(product.manufacturer).norm !== part.manufacturerNorm
      ) continue;
      const key = [
        product.supplier.toLocaleLowerCase(),
        part.manufacturerNorm,
        part.mpnNorm,
      ].join('\u0000');
      if (!products.has(key)) products.set(key, product);
    }
  }
  return [...products.values()].slice(0, 20);
}

function mergeEvaluations(
  envelope: LocalFallbackEnvelopeType,
  evaluated: CatalogEvaluationItemType[],
  inputs: LocalCatalogEvaluationInput[],
): LocalFallbackEnvelopeType {
  const byComponent = new Map(
    evaluated.map((item) => [item.component_id, item]),
  );
  const evaluatedQueries = new Map(
    inputs.map((input) => [input.component.component_id, input.query]),
  );
  return {
    ...envelope,
    search: {
      ...envelope.search,
      components: envelope.search.components.map((component) => {
        const item = byComponent.get(component.component_id);
        if (item === undefined) return component;
        return {
          ...component,
          query: evaluatedQueries.get(component.component_id) ?? component.query,
          status: item.status,
          candidates: item.candidates,
          procurement_decision: item.procurement_decision,
          warnings: [...new Set([...component.warnings, ...item.warnings])],
        };
      }),
    },
  };
}

async function loadCatalogParts(mpnNorms: string[]): Promise<CatalogPartRow[]> {
  if (mpnNorms.length === 0) return [];
  return prisma.spPart.findMany({
    where: { mpnNorm: { in: mpnNorms } },
    select: {
      mpnNorm: true,
      manufacturerNorm: true,
      offers: { select: { rawJson: true } },
    },
  });
}

async function evaluateCatalogBatch(
  inputs: Pick<LocalCatalogEvaluationInput, 'query' | 'products'>[],
  procurementPolicy: unknown,
): Promise<CatalogEvaluationItemType[]> {
  const evaluated: CatalogEvaluationItemType[] = [];
  for (const batch of chunks(inputs, CATALOG_EVALUATION_BATCH_SIZE)) {
    const response = await engineFetch(
      '/supplier-search/catalog-evaluate-batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: batch.map(({ query, products }) => ({
            query,
            products,
          })),
          ...(procurementPolicy === undefined
            ? {}
            : { procurement_policy: procurementPolicy }),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`catalog_evaluate_failed:${String(response.status)}`);
    }
    const parsed = CatalogEvaluationResponse.safeParse(await response.json());
    if (!parsed.success) throw new Error('catalog_evaluate_invalid_response');
    evaluated.push(...parsed.data.items);
  }
  return evaluated;
}

function numericRequirement(
  query: z.infer<typeof PreferredCatalogQuery>,
  name: string,
): { value: number; comparison: 'eq' | 'gte' | 'lte' } | null {
  const requirement = query.requirements[name];
  if (
    requirement === undefined
    || !requirement.hard
    || typeof requirement.normalized_value !== 'number'
    || !Number.isFinite(requirement.normalized_value)
    || !['eq', 'gte', 'lte'].includes(requirement.comparison)
  ) return null;
  return {
    value: requirement.normalized_value,
    comparison: requirement.comparison as 'eq' | 'gte' | 'lte',
  };
}

function numericFilter(
  field: string,
  requirement: { value: number; comparison: 'eq' | 'gte' | 'lte' },
): EsSearchQuery {
  if (requirement.comparison === 'gte') {
    return { range: { [field]: { gte: requirement.value } } };
  }
  if (requirement.comparison === 'lte') {
    return { range: { [field]: { lte: requirement.value } } };
  }
  const margin = Math.max(Math.abs(requirement.value) * 1e-6, 1e-18);
  return {
    range: {
      [field]: {
        gte: requirement.value - margin,
        lte: requirement.value + margin,
      },
    },
  };
}

function packageFilterValues(value: string): string[] {
  const canonical = normalizePackageCode(value);
  return canonical === null
    ? [value.trim().toUpperCase()]
    : [...new Set(canonical.flatMap((item) => packageVariants(item)))];
}

/** 엔진이 만든 정규 쿼리를 기계적으로 ES 필터로 투영한다. 판정은 여기서 하지 않는다. */
function preferredCatalogSearchQuery(
  query: z.infer<typeof PreferredCatalogQuery>,
): EsSearchQuery | null {
  const partType = (query.part_type ?? query.category_policy ?? '').toLowerCase();
  if (partType !== 'resistor' && partType !== 'capacitor') return null;
  if (query.mode === 'excluded' || query.mode === 'insufficient') return null;

  const filter: EsSearchQuery[] = [
    { term: { [F.suppliers]: 'samplepcb' } },
    { term: { [F.hasCatalogInquiryOffer]: true } },
    { term: { [F.partType]: partType } },
  ];
  const mpnNorm = normalizeMpn(query.part_number ?? '');
  if (mpnNorm !== '') {
    filter.push({ term: { [F.mpnNormKeyword]: mpnNorm } });
    const manufacturerNorm = resolveManufacturer(query.manufacturer).norm;
    if (manufacturerNorm !== 'unknown') {
      filter.push({ term: { [F.manufacturerNorm]: manufacturerNorm } });
    }
    return { bool: { filter } };
  }

  const coreName = partType === 'resistor' ? 'resistance_ohm' : 'capacitance_f';
  const coreField = partType === 'resistor' ? 'resistanceOhm' : 'capacitanceF';
  const core = numericRequirement(query, coreName);
  const packageRequirement = query.requirements.package?.normalized_value ?? query.package;
  if (core === null || typeof packageRequirement !== 'string' || packageRequirement.trim() === '') {
    return null;
  }
  filter.push(numericFilter(coreField, core));
  filter.push({ terms: { [F.packageVariants]: packageFilterValues(packageRequirement) } });

  for (const [name, field] of [
    ['tolerance_percent', 'tolerancePct'],
    ['voltage_v', 'voltageV'],
  ] as const) {
    const requirement = numericRequirement(query, name);
    if (requirement !== null) filter.push(numericFilter(field, requirement));
  }
  const dielectric = query.requirements.dielectric?.normalized_value;
  if (typeof dielectric === 'string' && dielectric.trim() !== '') {
    filter.push({ term: { [F.dielectric]: dielectric.trim().toUpperCase() } });
  }
  return { bool: { filter } };
}

function preferredMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const product = value as Record<string, unknown>;
  const metadataValue = product.catalog_metadata;
  if (metadataValue === null || typeof metadataValue !== 'object' || Array.isArray(metadataValue)) {
    return null;
  }
  const metadata = metadataValue as Record<string, unknown>;
  return metadata.catalogOnly === true && metadata.samplepcbPreferred === true
    ? metadata
    : null;
}

function preferredProductForPart(part: PreferredCatalogPartRow): LocalCatalogProductType | null {
  const samplepcbOffer = part.offers.find(
    (offer) => offer.supplier === 'samplepcb' && preferredMetadata(offer.rawJson) !== null,
  );
  if (samplepcbOffer === undefined) return null;
  const parsed = LocalCatalogProduct.safeParse(samplepcbOffer.rawJson);
  if (!parsed.success || preferredMetadata(parsed.data) === null) return null;
  return {
    ...parsed.data,
    supplier: 'samplepcb',
    offers: [
      {
        supplier: 'samplepcb',
        offer_kind: 'manufacturer_catalog',
        supplier_sku: samplepcbOffer.supplierSku,
        packaging: samplepcbOffer.packaging,
        // 외부 유통사 재고는 SamplePCB 보유 재고가 아니므로 항상 미확인이다.
        stock: null,
        moq: samplepcbOffer.moq,
        order_multiple: samplepcbOffer.orderMultiple,
        price_breaks: samplepcbOffer.priceBreaks.map((priceBreak) => ({
          quantity: priceBreak.qty,
          unit_price: Number(priceBreak.price.toString()),
          currency: priceBreak.currency,
        })),
        lead_time: samplepcbOffer.leadTime,
        product_url: samplepcbOffer.productUrl,
        fetched_at: samplepcbOffer.fetchedAt.toISOString(),
      },
    ],
  };
}

async function searchPreferredPartIds(
  queries: z.infer<typeof PreferredCatalogQuery>[],
): Promise<Map<string, string[]>> {
  const queryByComponent = new Map<string, EsSearchQuery>();
  for (const query of queries) {
    const searchQuery = preferredCatalogSearchQuery(query);
    if (searchQuery !== null) queryByComponent.set(query.component_id, searchQuery);
  }
  const grouped = new Map<string, { query: EsSearchQuery; componentIds: string[] }>();
  for (const [componentId, query] of queryByComponent) {
    const key = JSON.stringify(query);
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, { query, componentIds: [componentId] });
    else existing.componentIds.push(componentId);
  }
  const groups = [...grouped.values()];
  const result = new Map<string, string[]>();
  for (const batch of chunks(groups, PREFERRED_CATALOG_SEARCH_CONCURRENCY)) {
    const responses = await Promise.all(
      batch.map(({ query }) =>
        esClient().search<SpPartDoc>({
          index: SP_PARTS_READ,
          size: PREFERRED_CATALOG_SEARCH_SIZE,
          track_total_hits: false,
          query,
          _source: [F.partId],
        }),
      ),
    );
    for (const [index, response] of responses.entries()) {
      const group = batch[index];
      if (group === undefined) continue;
      const ids = response.hits.hits.flatMap((hit) =>
        hit._source?.partId === undefined ? [] : [hit._source.partId]);
      for (const componentId of group.componentIds) result.set(componentId, ids);
    }
  }
  return result;
}

export interface PreferredLocalCatalogResult {
  envelope: unknown;
  resolvedComponentIds: string[];
  unresolvedComponentIds: string[];
  evaluatedComponentIds: string[];
}

/**
 * 외부 공급사 호출 전에 SamplePCB R/C 카탈로그를 조회한다.
 *
 * Node는 엔진 preflight의 정규 쿼리로 후보만 가져오고, 후보의 기술·조달 판정과
 * 최종 resolved 여부는 catalog-evaluate-batch의 automatic_selected만 신뢰한다.
 * 입력 충돌로 계획이 둘 이상인 행은 로컬에서 추정하지 않고 외부 기존 경로로 넘긴다.
 */
export async function evaluatePreferredLocalCatalog(
  preflightValue: unknown,
  procurementPolicy: unknown,
  log?: LocalCatalogFallbackLog,
): Promise<PreferredLocalCatalogResult> {
  const parsed = SupplierPreflightPlan.safeParse(preflightValue);
  if (!parsed.success) {
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: [],
      evaluatedComponentIds: [],
    };
  }
  const allComponentIds = parsed.data.plan.components.map((component) => component.component_id);
  const queries = parsed.data.plan.components.flatMap((component) =>
    component.planned_queries.length === 1
      ? component.planned_queries
      : [],
  );
  try {
    const partIdsByComponent = await searchPreferredPartIds(queries);
    const partIds = [...new Set([...partIdsByComponent.values()].flat())];
    const parts: PreferredCatalogPartRow[] = partIds.length === 0
      ? []
      : await prisma.spPart.findMany({
          where: { id: { in: partIds.map((id) => BigInt(id)) } },
          select: {
            id: true,
            offers: {
              select: {
                supplier: true,
                supplierSku: true,
                productUrl: true,
                stock: true,
                moq: true,
                orderMultiple: true,
                packaging: true,
                currency: true,
                leadTime: true,
                fetchedAt: true,
                rawJson: true,
                priceBreaks: {
                  select: { qty: true, price: true, currency: true },
                  orderBy: { qty: 'asc' },
                },
              },
            },
          },
        });
    const productsByPartId = new Map(
      parts.flatMap((part) => {
        const product = preferredProductForPart(part);
        return product === null ? [] : [[String(part.id), product] as const];
      }),
    );
    const inputs = queries.flatMap((query) => {
      const products = (partIdsByComponent.get(query.component_id) ?? [])
        .flatMap((partId) => {
          const product = productsByPartId.get(partId);
          return product === undefined ? [] : [product];
        })
        .slice(0, PREFERRED_CATALOG_SEARCH_SIZE);
      return products.length === 0 ? [] : [{ query, products }];
    });
    if (inputs.length === 0) {
      return {
        envelope: null,
        resolvedComponentIds: [],
        unresolvedComponentIds: allComponentIds,
        evaluatedComponentIds: [],
      };
    }
    const evaluated = await evaluateCatalogBatch(inputs, procurementPolicy);
    const queryByComponent = new Map(inputs.map((input) => [input.query.component_id, input.query]));
    const resolved = evaluated.filter((item) => {
      const decision = item.procurement_decision;
      return decision !== null
        && typeof decision === 'object'
        && !Array.isArray(decision)
        && (decision as Record<string, unknown>).selection_application_state === 'automatic_selected';
    });
    const resolvedIds = [...new Set(resolved.map((item) => item.component_id))];
    const resolvedSet = new Set(resolvedIds);
    return {
      envelope: resolved.length === 0
        ? null
        : {
            supplier_search_schema_version: 'sp-supplier-search-envelope/v1',
            procurement_decision_contract_status: 'current',
            search: {
              search_schema_version: '1.7',
              procurement_policy: procurementPolicy,
              components: resolved.map((item) => ({
                ...item,
                mode: queryByComponent.get(item.component_id)?.mode,
                query: queryByComponent.get(item.component_id),
              })),
              unique_query_count: inputs.length,
              api_calls: 0,
              cache_hits: 0,
              elapsed_ms: 0,
            },
          },
      resolvedComponentIds: resolvedIds,
      unresolvedComponentIds: allComponentIds.filter((componentId) => !resolvedSet.has(componentId)),
      evaluatedComponentIds: [...new Set(evaluated.map((item) => item.component_id))],
    };
  } catch (error) {
    log?.warn({ err: String(error) }, 'SamplePCB 로컬 우선 카탈로그 평가 실패');
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: allComponentIds,
      evaluatedComponentIds: [],
    };
  }
}

/**
 * 외부 공급사 후보가 비어 있는 행만 로컬 카탈로그에서 exact identity로 찾고,
 * 기술·조달 판정은 sp-engine에 다시 위임한다. 실패하면 원본 공급사 결과를
 * 그대로 반환해 기존 견적 반영 경로를 방해하지 않는다.
 */
export async function applyLocalCatalogFallback(
  envelopeValue: unknown,
  log?: LocalCatalogFallbackLog,
): Promise<unknown> {
  const parsed = LocalFallbackEnvelope.safeParse(envelopeValue);
  if (!parsed.success) return envelopeValue;
  const components = fallbackComponents(parsed.data);
  if (components.length === 0) return envelopeValue;

  try {
    const mpnNorms = [
      ...new Set(
        components.map((component) =>
          normalizeMpn(exactIdentityQuery(component)?.part_number ?? '')),
      ),
    ];
    const parts = await loadCatalogParts(mpnNorms);
    const partsByMpn = new Map<string, CatalogPartRow[]>();
    for (const part of parts) {
      const values = partsByMpn.get(part.mpnNorm) ?? [];
      values.push(part);
      partsByMpn.set(part.mpnNorm, values);
    }
    const inputs = components.flatMap((component) => {
      const query = exactIdentityQuery(component);
      if (query === null) return [];
      const products = productsForComponent(component, partsByMpn);
      return products.length === 0 ? [] : [{ component, query, products }];
    });
    if (inputs.length === 0) return envelopeValue;
    const evaluated = await evaluateCatalogBatch(
      inputs,
      parsed.data.search.procurement_policy,
    );
    return mergeEvaluations(parsed.data, evaluated, inputs);
  } catch (error) {
    log?.warn(
      { err: String(error) },
      '로컬 부품 카탈로그 후보 판정 실패',
    );
    return envelopeValue;
  }
}
