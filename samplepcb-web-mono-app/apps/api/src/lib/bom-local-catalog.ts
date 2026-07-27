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
    // 로컬 판정 입력은 catalogOnly 기술 후보만 허용한다. 실제 구매 오퍼의
    // 가격·재고는 이 경로에서 전달하지 않고 외부 공급사 검색이 다시 확인한다.
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

const CatalogEvaluationRequirementAssessment = z
  .object({
    key: z.string(),
    comparison: z.enum(['eq', 'gte', 'lte', 'contains', 'category']),
    state: z.enum(['match', 'mismatch', 'missing', 'not_applicable', 'unverified']),
    verified: z.boolean(),
    source: z.enum(['bom', 'user', 'policy_default', 'unknown']).default('unknown'),
    expected_display: z.string().nullish(),
    actual_display: z.string().nullish(),
  })
  .passthrough();

const CatalogEvaluationCandidateDecision = z
  .object({
    selection_eligibility: z.enum(['automatic', 'manual_review', 'blocked']),
    reason_codes: z.array(z.string()).default([]),
    verified_requirement_count: z.number().int().min(0).default(0),
    required_requirement_count: z.number().int().min(0).default(0),
    requirement_assessments: z.array(CatalogEvaluationRequirementAssessment).default([]),
    identity_key: z.string().nullish(),
    technical_evidence_key: z.string().nullish(),
    selection_recommendation: z.string().nullish(),
  })
  .passthrough();

const CatalogEvaluationCandidate = z
  .object({
    status: z.string().default('unknown'),
    conflicts: z.array(z.string()).default([]),
    missing_requirements: z.array(z.string()).default([]),
    product: z
      .object({
        manufacturer_part_number: z.string(),
        manufacturer: z.string().nullish(),
      })
      .passthrough(),
    decision: CatalogEvaluationCandidateDecision.nullish(),
  })
  .passthrough();

const CatalogEvaluationProcurementDecision = z
  .object({
    status: z.string().nullish(),
    selection_application_state: z
      .enum(['automatic_selected', 'provisional_selected', 'not_selected'])
      .nullish(),
    primary_unavailability_reason: z.string().nullish(),
    recommendation_reason_codes: z.array(z.string()).default([]),
    technical_preselection_identity_key: z.string().nullish(),
    technical_preselection_evidence_key: z.string().nullish(),
  })
  .passthrough();

const CatalogEvaluationResponse = z.object({
  items: z.array(
    z
      .object({
        component_id: z.string(),
        status: z.string(),
        candidates: z.array(CatalogEvaluationCandidate),
        procurement_decision: CatalogEvaluationProcurementDecision.nullish(),
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
    keywords: z.string().default(''),
    requirements: z.record(z.string(), PlannedRequirement).default({}),
    procurement_disposition: z
      .enum(['eligible', 'excluded', 'quantity_confirmation_required'])
      .default('eligible'),
    quantity_resolution: z.enum(['verified', 'conflict', 'missing']).default('verified'),
    disposition_reason_codes: z.array(z.string()).default([]),
  })
  .passthrough();

const SupplierPreflightPlan = z
  .object({
    plan: z.object({
      components: z.array(
        z
          .object({
            component_id: z.string().min(1),
            mode: z.string().default(''),
            part_number: z.string().nullish(),
            manufacturer: z.string().nullish(),
            keywords: z.string().default(''),
            planned_queries: z.array(PreferredCatalogQuery).default([]),
            requirement_guidance: z
              .object({
                component_type: z.string().nullish(),
              })
              .nullish(),
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
  mpnNorm: string;
  manufacturerNorm: string;
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

interface IngestedRcPartRow {
  id: bigint;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  description: string | null;
  category: string | null;
  packageCode: string | null;
  lifecycle: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
  specsJson: unknown;
  offers: {
    supplier: string;
    supplierSku: string;
    productUrl: string | null;
    packaging: string | null;
    leadTime: string | null;
    fetchedAt: Date;
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
const PREFERRED_CATALOG_REASON_COUNT_LIMIT = 8;
const PREFERRED_CATALOG_REQUIREMENT_ASSESSMENT_LIMIT = 20;
const INGESTED_RC_EXPERIMENT_ENV = 'BOM_INGESTED_RC_EXPERIMENT';
const ENGINE_SUPPLIER_IDENTITIES = new Set([
  'digikey',
  'mouser',
  'unikeyic',
  'samplepcb',
  'yeonho',
  'walsin',
  'yageo',
  'samsung',
  'murata',
  'tdk',
  'vishay',
  'koa',
  'eleparts',
  'icbanq',
]);
type EsSearchQuery = NonNullable<estypes.SearchRequest['query']>;

export type PreferredLocalCatalogType =
  | 'samplepcb_rc'
  | 'connector'
  | 'ingested_rc';

interface PreferredCatalogPlan {
  query: z.infer<typeof PreferredCatalogQuery>;
  catalogType: Exclude<PreferredLocalCatalogType, 'ingested_rc'>;
}

interface IngestedRcCatalogPlan {
  evaluationQuery: z.infer<typeof PreferredCatalogQuery>;
  partType: 'resistor' | 'capacitor';
}

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

function preferredCatalogTypeForPartType(
  partType: string,
): Exclude<PreferredLocalCatalogType, 'ingested_rc'> | null {
  const normalized = partType.toLowerCase();
  if (normalized === 'resistor' || normalized === 'capacitor') return 'samplepcb_rc';
  if (normalized === 'connector') return 'connector';
  return null;
}

function preferredCatalogType(
  query: z.infer<typeof PreferredCatalogQuery>,
  fallbackPartType = '',
): Exclude<PreferredLocalCatalogType, 'ingested_rc'> | null {
  return preferredCatalogTypeForPartType(
    query.part_type ?? query.category_policy ?? fallbackPartType,
  );
}

/** 엔진이 만든 정규 쿼리를 기계적으로 ES 필터로 투영한다. 판정은 여기서 하지 않는다. */
function preferredCatalogSearchQuery(
  query: z.infer<typeof PreferredCatalogQuery>,
  catalogType: Exclude<PreferredLocalCatalogType, 'ingested_rc'>,
): EsSearchQuery | null {
  if (query.mode === 'excluded' || query.mode === 'insufficient') return null;

  const mpnNorm = normalizeMpn(query.part_number ?? '');
  if (catalogType === 'connector') {
    if (mpnNorm === '') return null;
    const filter: EsSearchQuery[] = [
      { term: { [F.partType]: 'connector' } },
      { term: { [F.hasCatalogInquiryOffer]: true } },
      { term: { [F.mpnNormKeyword]: mpnNorm } },
    ];
    const manufacturerNorm = resolveManufacturer(query.manufacturer).norm;
    if (manufacturerNorm !== 'unknown') {
      filter.push({ term: { [F.manufacturerNorm]: manufacturerNorm } });
    }
    return { bool: { filter } };
  }

  const partType = (query.part_type ?? query.category_policy ?? '').toLowerCase();
  if (partType !== 'resistor' && partType !== 'capacitor') return null;
  const filter: EsSearchQuery[] = [
    { term: { [F.suppliers]: 'samplepcb' } },
    { term: { [F.hasCatalogInquiryOffer]: true } },
    { term: { [F.partType]: partType } },
  ];
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

/** `false`로만 끌 수 있는 실험 플래그. 운영 롤백은 코드 되돌림 없이 가능하다. */
export function ingestedRcCatalogExperimentEnabled(): boolean {
  return process.env[INGESTED_RC_EXPERIMENT_ENV]?.trim().toLowerCase() !== 'false';
}

function ingestedRcCatalogPlan(
  query: z.infer<typeof PreferredCatalogQuery>,
): IngestedRcCatalogPlan | null {
  if (
    query.mode === 'excluded'
    || query.mode === 'insufficient'
    || normalizeMpn(query.part_number ?? '') !== ''
  ) return null;
  const partType = (query.part_type ?? '').trim().toLowerCase();
  if (partType !== 'resistor' && partType !== 'capacitor') return null;
  const partTypeRequirement = query.requirements.part_type;
  const coreName = partType === 'resistor' ? 'resistance_ohm' : 'capacitance_f';
  const coreRequirement = query.requirements[coreName];
  const packageRequirement = query.requirements.package;
  if (
    partTypeRequirement === undefined
    || !partTypeRequirement.hard
    || partTypeRequirement.comparison !== 'category'
    || typeof partTypeRequirement.normalized_value !== 'string'
    || partTypeRequirement.normalized_value.trim().toLowerCase() !== partType
    || coreRequirement === undefined
    || !coreRequirement.hard
    || coreRequirement.comparison !== 'eq'
    || typeof coreRequirement.normalized_value !== 'number'
    || !Number.isFinite(coreRequirement.normalized_value)
    || packageRequirement === undefined
    || !packageRequirement.hard
    || packageRequirement.comparison !== 'eq'
    || typeof packageRequirement.normalized_value !== 'string'
    || packageRequirement.normalized_value.trim() === ''
  ) return null;

  return {
    partType,
    evaluationQuery: {
      ...query,
      mode: 'parametric',
      part_number: null,
      manufacturer: null,
      part_type: partType,
      category_policy:
        partType === 'resistor' ? 'resistor_minimum' : 'capacitor_minimum',
      package: packageRequirement.normalized_value,
      requirements: {
        part_type: partTypeRequirement,
        [coreName]: coreRequirement,
        package: packageRequirement,
      },
      // 값/패키지가 서로 갈린 입력은 planner가 복수 분기를 만들므로 위에서
      // 이미 제외된다. 완화 대상이 아닌 공차·전압 등의 충돌은 이 실험 판정에
      // 끌고 오지 않는다.
      input_source_conflicts: [],
    },
  };
}

function ingestedRcSearchQuery(plan: IngestedRcCatalogPlan): EsSearchQuery {
  const coreName = plan.partType === 'resistor'
    ? 'resistance_ohm'
    : 'capacitance_f';
  const coreField = plan.partType === 'resistor'
    ? 'resistanceOhm'
    : 'capacitanceF';
  const core = numericRequirement(plan.evaluationQuery, coreName);
  const packageValue =
    plan.evaluationQuery.requirements.package?.normalized_value;
  if (core === null || typeof packageValue !== 'string') {
    throw new Error('ingested_rc_plan_invariant');
  }
  return {
    bool: {
      filter: [
        { term: { [F.partType]: plan.partType } },
        { range: { [F.offerCount]: { gte: 1 } } },
        numericFilter(coreField, core),
        {
          terms: {
            [F.packageVariants]: packageFilterValues(packageValue),
          },
        },
      ],
    },
  };
}

function engineNormalizedSpecs(value: unknown): Record<
  string,
  number | string | (number | null)[] | null
> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, number | string | (number | null)[] | null> = {};
  for (const [key, item] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      item === null
      || typeof item === 'string'
      || (typeof item === 'number' && Number.isFinite(item))
    ) {
      result[key] = item;
      continue;
    }
    if (Array.isArray(item)) {
      const values: unknown[] = item;
      const numericItems = values.flatMap((entry) =>
        entry === null
        || (typeof entry === 'number' && Number.isFinite(entry))
          ? [entry]
          : []);
      if (numericItems.length === values.length) result[key] = numericItems;
    }
  }
  return result;
}

function ingestedRcProductForPart(
  part: IngestedRcPartRow,
  partType: 'resistor' | 'capacitor',
): LocalCatalogProductType | null {
  const offer = part.offers.find((candidate) =>
    ENGINE_SUPPLIER_IDENTITIES.has(candidate.supplier.trim().toLowerCase()));
  if (offer === undefined) return null;
  const supplier = offer.supplier.trim().toLowerCase();
  const specs = engineNormalizedSpecs(part.specsJson);
  specs.part_type = partType;
  if (part.packageCode !== null && part.packageCode.trim() !== '') {
    specs.package = part.packageCode;
  }
  const parsed = LocalCatalogProduct.safeParse({
    supplier,
    supplier_product_id:
      `${supplier}:${offer.supplierSku.trim() === '' ? part.mpnNorm : offer.supplierSku}`,
    manufacturer_part_number: part.mpn,
    manufacturer: part.manufacturerName,
    description: part.description,
    category: part.category ?? (partType === 'resistor' ? 'Resistor' : 'Capacitor'),
    package: part.packageCode,
    lifecycle_status: part.lifecycle,
    datasheet_url: part.datasheetUrl,
    image_url: part.imageUrl,
    normalized_specs: specs,
    catalog_metadata: {
      catalogOnly: true,
      autoQuoteEligible: true,
      apiVerificationRequired: false,
      ingestedRcMinimum: true,
    },
    offers: [
      {
        supplier,
        offer_kind: 'manufacturer_catalog',
        supplier_sku: offer.supplierSku.trim() === '' ? part.mpn : offer.supplierSku,
        packaging: offer.packaging,
        stock: null,
        moq: null,
        order_multiple: null,
        price_breaks: [],
        lead_time: offer.leadTime,
        product_url: offer.productUrl,
        fetched_at: offer.fetchedAt.toISOString(),
      },
    ],
  });
  return parsed.success ? parsed.data : null;
}

function catalogMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const product = value as Record<string, unknown>;
  const metadataValue = product.catalog_metadata;
  if (metadataValue === null || typeof metadataValue !== 'object' || Array.isArray(metadataValue)) {
    return null;
  }
  const metadata = metadataValue as Record<string, unknown>;
  return metadata.catalogOnly === true ? metadata : null;
}

function preferredMetadata(value: unknown): Record<string, unknown> | null {
  const metadata = catalogMetadata(value);
  return metadata?.samplepcbPreferred === true ? metadata : null;
}

function preferredRcProductForPart(part: PreferredCatalogPartRow): LocalCatalogProductType | null {
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

function connectorCatalogProducts(
  query: z.infer<typeof PreferredCatalogQuery>,
  parts: PreferredCatalogPartRow[],
): LocalCatalogProductType[] {
  const mpnNorm = normalizeMpn(query.part_number ?? '');
  if (mpnNorm === '') return [];
  const exactParts = parts.filter((part) => part.mpnNorm === mpnNorm);
  const manufacturerNorm = resolveManufacturer(query.manufacturer).norm;
  const matchedParts = manufacturerNorm === 'unknown'
    ? new Set(exactParts.map((part) => part.manufacturerNorm)).size === 1
      ? exactParts
      : []
    : exactParts.filter((part) => part.manufacturerNorm === manufacturerNorm);
  const products = new Map<string, LocalCatalogProductType>();
  for (const part of matchedParts) {
    for (const offer of part.offers) {
      const parsed = LocalCatalogProduct.safeParse(offer.rawJson);
      if (
        !parsed.success
        || catalogMetadata(parsed.data) === null
        || normalizeMpn(parsed.data.manufacturer_part_number) !== part.mpnNorm
        || resolveManufacturer(parsed.data.manufacturer).norm !== part.manufacturerNorm
      ) continue;
      const key = [
        parsed.data.supplier.toLocaleLowerCase(),
        part.manufacturerNorm,
        part.mpnNorm,
      ].join('\u0000');
      if (!products.has(key)) products.set(key, parsed.data);
    }
  }
  return [...products.values()].slice(0, PREFERRED_CATALOG_SEARCH_SIZE);
}

async function searchPreferredPartIds(
  plans: PreferredCatalogPlan[],
): Promise<Map<string, string[]>> {
  const queryByComponent = new Map<string, EsSearchQuery>();
  for (const plan of plans) {
    const searchQuery = preferredCatalogSearchQuery(plan.query, plan.catalogType);
    if (searchQuery !== null) {
      queryByComponent.set(plan.query.component_id, searchQuery);
    }
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
      const ids = [...new Set(response.hits.hits.flatMap((hit) =>
        hit._source?.partId === undefined ? [] : [hit._source.partId]))];
      for (const componentId of group.componentIds) result.set(componentId, ids);
    }
  }
  return result;
}

async function searchIngestedRcPartIds(
  plans: IngestedRcCatalogPlan[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<
    string,
    { query: EsSearchQuery; componentIds: string[] }
  >();
  for (const plan of plans) {
    const query = ingestedRcSearchQuery(plan);
    const key = JSON.stringify(query);
    const componentId = plan.evaluationQuery.component_id;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { query, componentIds: [componentId] });
    } else {
      existing.componentIds.push(componentId);
    }
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
      const ids = [...new Set(response.hits.hits.flatMap((hit) =>
        hit._source?.partId === undefined ? [] : [hit._source.partId]))];
      for (const componentId of group.componentIds) {
        result.set(componentId, ids);
      }
    }
  }
  return result;
}

async function loadIngestedRcParts(
  partIds: string[],
): Promise<IngestedRcPartRow[]> {
  if (partIds.length === 0) return [];
  return prisma.spPart.findMany({
    where: { id: { in: partIds.map((id) => BigInt(id)) } },
    select: {
      id: true,
      mpn: true,
      mpnNorm: true,
      manufacturerName: true,
      description: true,
      category: true,
      packageCode: true,
      lifecycle: true,
      datasheetUrl: true,
      imageUrl: true,
      specsJson: true,
      offers: {
        select: {
          supplier: true,
          supplierSku: true,
          productUrl: true,
          packaging: true,
          leadTime: true,
          fetchedAt: true,
        },
        orderBy: [
          { fetchedAt: 'desc' },
          { supplier: 'asc' },
          { supplierSku: 'asc' },
        ],
      },
    },
  });
}

export type PreferredLocalCatalogOutcome =
  | 'selected'
  | 'no_candidates'
  | 'rejected'
  | 'skipped'
  | 'error';

export interface PreferredLocalCatalogTrace {
  componentId: string;
  catalogType: PreferredLocalCatalogType;
  query: string;
  outcome: PreferredLocalCatalogOutcome;
  candidateCount: number;
  evaluatedCandidateCount: number;
  selectedCandidateCount: number;
  elapsedMs: number;
  reason: string | null;
  decisionSummary: PreferredLocalCatalogDecisionSummary | null;
}

export interface PreferredLocalCatalogDecisionSummary {
  componentStatus: string;
  procurementStatus: string | null;
  selectionApplicationState:
    | 'automatic_selected'
    | 'provisional_selected'
    | 'not_selected'
    | null;
  primaryUnavailabilityReason: string | null;
  recommendationReasonCodes: string[];
  automaticCandidateCount: number;
  reviewCandidateCount: number;
  blockedCandidateCount: number;
  unclassifiedCandidateCount: number;
  reasonCounts: {
    kind: 'conflict' | 'missing_requirement' | 'decision';
    code: string;
    count: number;
  }[];
  representativeCandidate: {
    mpn: string;
    manufacturerName: string | null;
    status: string;
    selectionEligibility: 'automatic' | 'manual_review' | 'blocked' | null;
    verifiedRequirementCount: number;
    requiredRequirementCount: number;
    conflicts: string[];
    missingRequirements: string[];
    reasonCodes: string[];
    requirementAssessments: {
      key: string;
      comparison: 'eq' | 'gte' | 'lte' | 'contains' | 'category';
      state: 'match' | 'mismatch' | 'missing' | 'not_applicable' | 'unverified';
      verified: boolean;
      expectedDisplay: string | null;
      actualDisplay: string | null;
      source: 'bom' | 'user' | 'policy_default' | 'unknown';
    }[];
  } | null;
}

export interface PreferredLocalCatalogResult {
  envelope: unknown;
  resolvedComponentIds: string[];
  unresolvedComponentIds: string[];
  evaluatedComponentIds: string[];
  traces: PreferredLocalCatalogTrace[];
}

function preferredCatalogDecisionSummary(
  item: CatalogEvaluationItemType,
): PreferredLocalCatalogDecisionSummary {
  const reasonCounts = new Map<
    string,
    PreferredLocalCatalogDecisionSummary['reasonCounts'][number]
  >();
  let automaticCandidateCount = 0;
  let reviewCandidateCount = 0;
  let blockedCandidateCount = 0;
  let unclassifiedCandidateCount = 0;

  const countReasons = (
    kind: PreferredLocalCatalogDecisionSummary['reasonCounts'][number]['kind'],
    codes: readonly string[],
  ): void => {
    for (const code of new Set(codes.map((value) => value.trim()).filter(Boolean))) {
      const key = `${kind}:${code}`;
      const current = reasonCounts.get(key);
      reasonCounts.set(key, {
        kind,
        code,
        count: (current?.count ?? 0) + 1,
      });
    }
  };

  for (const candidate of item.candidates) {
    switch (candidate.decision?.selection_eligibility) {
      case 'automatic':
        automaticCandidateCount += 1;
        break;
      case 'manual_review':
        reviewCandidateCount += 1;
        break;
      case 'blocked':
        blockedCandidateCount += 1;
        break;
      case undefined:
        unclassifiedCandidateCount += 1;
        break;
    }
    countReasons('conflict', candidate.conflicts);
    countReasons('missing_requirement', candidate.missing_requirements);
    countReasons('decision', candidate.decision?.reason_codes ?? []);
  }

  const kindRank: Record<
    PreferredLocalCatalogDecisionSummary['reasonCounts'][number]['kind'],
    number
  > = {
    conflict: 0,
    missing_requirement: 1,
    decision: 2,
  };
  const representative = item.candidates.find((candidate) => candidate.decision != null)
    ?? item.candidates[0];

  return {
    componentStatus: item.status,
    procurementStatus: item.procurement_decision?.status ?? null,
    selectionApplicationState:
      item.procurement_decision?.selection_application_state ?? null,
    primaryUnavailabilityReason:
      item.procurement_decision?.primary_unavailability_reason ?? null,
    recommendationReasonCodes: [
      ...new Set(item.procurement_decision?.recommendation_reason_codes ?? []),
    ],
    automaticCandidateCount,
    reviewCandidateCount,
    blockedCandidateCount,
    unclassifiedCandidateCount,
    reasonCounts: [...reasonCounts.values()]
      .sort((left, right) =>
        right.count - left.count
        || kindRank[left.kind] - kindRank[right.kind]
        || left.code.localeCompare(right.code))
      .slice(0, PREFERRED_CATALOG_REASON_COUNT_LIMIT),
    representativeCandidate: representative === undefined
      ? null
      : {
          mpn: representative.product.manufacturer_part_number,
          manufacturerName: representative.product.manufacturer ?? null,
          status: representative.status,
          selectionEligibility: representative.decision?.selection_eligibility ?? null,
          verifiedRequirementCount:
            representative.decision?.verified_requirement_count ?? 0,
          requiredRequirementCount:
            representative.decision?.required_requirement_count ?? 0,
          conflicts: representative.conflicts,
          missingRequirements: representative.missing_requirements,
          reasonCodes: representative.decision?.reason_codes ?? [],
          requirementAssessments:
            representative.decision?.requirement_assessments
              .slice(0, PREFERRED_CATALOG_REQUIREMENT_ASSESSMENT_LIMIT)
              .map((assessment) => ({
                key: assessment.key,
                comparison: assessment.comparison,
                state: assessment.state,
                verified: assessment.verified,
                expectedDisplay: assessment.expected_display ?? null,
                actualDisplay: assessment.actual_display ?? null,
                source: assessment.source,
              })) ?? [],
        },
  };
}

function preferredCatalogQueryLabel(
  query: Pick<
    z.infer<typeof PreferredCatalogQuery>,
    'keywords' | 'manufacturer' | 'part_number' | 'part_type' | 'category_policy' | 'package'
  >,
): string {
  const keywords = query.keywords.trim();
  if (keywords !== '') return keywords;
  const identity = [query.manufacturer, query.part_number]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
    .join(' ');
  if (identity !== '') return identity;
  return [
    query.part_type ?? query.category_policy,
    query.package,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
    .join(' ');
}

/**
 * 외부 공급사 호출 전에 엔진 유형별 자체 카탈로그를 조회한다.
 *
 * R/C는 SamplePCB 스펙 카탈로그, connector는 exact MPN 로컬 카탈로그 후보만
 * 가져오고, 기술·조달 판정은 catalog-evaluate-batch만 신뢰한다. 최종 resolved는
 * automatic_selected 또는 수량 미확인 상태의 안전한 technical preselection만 인정한다.
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
      traces: [],
    };
  }
  const startedAt = Date.now();
  const allComponentIds = parsed.data.plan.components.map((component) => component.component_id);
  const tracesByComponent = new Map<string, PreferredLocalCatalogTrace>();
  const plans: PreferredCatalogPlan[] = [];
  for (const component of parsed.data.plan.components) {
    const componentType = component.requirement_guidance?.component_type?.toLowerCase() ?? '';
    const fallbackCatalogType = preferredCatalogTypeForPartType(componentType);
    const preferredPlans = component.planned_queries.flatMap((query) => {
      const catalogType = preferredCatalogType(query, componentType);
      return catalogType === null ? [] : [{ query, catalogType }];
    });
    if (
      preferredPlans.length === 0
      && fallbackCatalogType === null
    ) continue;
    const plan = preferredPlans[0];
    const query = plan?.query;
    const catalogType = plan?.catalogType ?? fallbackCatalogType;
    if (catalogType === null) continue;
    const queryLabel = query === undefined
      ? component.keywords.trim() !== ''
        ? component.keywords.trim()
        : [component.manufacturer, component.part_number]
            .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
            .map((value) => value.trim())
            .join(' ')
      : preferredCatalogQueryLabel(query);
    const trace: PreferredLocalCatalogTrace = {
      componentId: component.component_id,
      catalogType,
      query: queryLabel,
      outcome: 'skipped',
      candidateCount: 0,
      evaluatedCandidateCount: 0,
      selectedCandidateCount: 0,
      elapsedMs: 0,
      reason: 'query_not_eligible',
      decisionSummary: null,
    };
    tracesByComponent.set(component.component_id, trace);
    if (
      component.planned_queries.length !== 1
      || preferredPlans.length !== 1
      || query === undefined
      || plan === undefined
    ) {
      trace.reason = component.planned_queries.length > 1
        ? 'multiple_query_plans'
        : 'query_not_eligible';
      continue;
    }
    if (preferredCatalogSearchQuery(query, catalogType) === null) continue;
    plans.push(plan);
  }
  const traces = (): PreferredLocalCatalogTrace[] => {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    return [...tracesByComponent.values()].map((trace) => ({
      ...trace,
      elapsedMs,
    }));
  };
  try {
    const partIdsByComponent = await searchPreferredPartIds(plans);
    for (const plan of plans) {
      const trace = tracesByComponent.get(plan.query.component_id);
      if (trace === undefined) continue;
      const candidateCount = partIdsByComponent.get(plan.query.component_id)?.length ?? 0;
      trace.candidateCount = candidateCount;
      trace.outcome = candidateCount === 0 ? 'no_candidates' : 'skipped';
      trace.reason = candidateCount === 0
        ? 'catalog_candidates_not_found'
        : 'catalog_products_unavailable';
    }
    const partIds = [...new Set([...partIdsByComponent.values()].flat())];
    const parts: PreferredCatalogPartRow[] = partIds.length === 0
      ? []
      : await prisma.spPart.findMany({
          where: { id: { in: partIds.map((id) => BigInt(id)) } },
          select: {
            id: true,
            mpnNorm: true,
            manufacturerNorm: true,
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
    const partsById = new Map(parts.map((part) => [String(part.id), part]));
    const rcProductsByPartId = new Map(
      parts.flatMap((part) => {
        const product = preferredRcProductForPart(part);
        return product === null ? [] : [[String(part.id), product] as const];
      }),
    );
    const inputs = plans.flatMap((plan) => {
      const partIds = partIdsByComponent.get(plan.query.component_id) ?? [];
      const products = plan.catalogType === 'connector'
        ? connectorCatalogProducts(
            plan.query,
            partIds.flatMap((partId) => {
              const part = partsById.get(partId);
              return part === undefined ? [] : [part];
            }),
          )
        : partIds
            .flatMap((partId) => {
              const product = rcProductsByPartId.get(partId);
              return product === undefined ? [] : [product];
            })
            .slice(0, PREFERRED_CATALOG_SEARCH_SIZE);
      const trace = tracesByComponent.get(plan.query.component_id);
      if (trace !== undefined) {
        trace.evaluatedCandidateCount = products.length;
        if (products.length === 0 && trace.candidateCount > 0) {
          trace.outcome = 'no_candidates';
        }
      }
      return products.length === 0 ? [] : [{ query: plan.query, products }];
    });
    if (inputs.length === 0) {
      return {
        envelope: null,
        resolvedComponentIds: [],
        unresolvedComponentIds: allComponentIds,
        evaluatedComponentIds: [],
        traces: traces(),
      };
    }
    const queryByComponent = new Map(inputs.map((input) => [input.query.component_id, input.query]));
    const evaluated = await evaluateCatalogBatch(inputs, procurementPolicy);
    const isQuantityDeferredSelection = (item: CatalogEvaluationItemType): boolean => {
      const query = queryByComponent.get(item.component_id);
      const decision = item.procurement_decision;
      if (
        query?.procurement_disposition !== 'quantity_confirmation_required'
        || query.quantity_resolution !== 'missing'
        || decision?.status !== 'input_incomplete'
        || decision.selection_application_state !== 'not_selected'
        || decision.primary_unavailability_reason !== 'input_incomplete'
        || decision.technical_preselection_identity_key === null
        || decision.technical_preselection_identity_key === undefined
        || decision.technical_preselection_evidence_key === null
        || decision.technical_preselection_evidence_key === undefined
      ) return false;
      return item.candidates.some((candidate) =>
        candidate.decision?.selection_eligibility === 'automatic'
        && candidate.decision.identity_key === decision.technical_preselection_identity_key
        && candidate.decision.technical_evidence_key === decision.technical_preselection_evidence_key);
    };
    const quantityDeferredIds = new Set(
      evaluated.filter(isQuantityDeferredSelection).map((item) => item.component_id),
    );
    const resolved = evaluated.filter(
      (item) =>
        item.procurement_decision?.selection_application_state === 'automatic_selected'
        || quantityDeferredIds.has(item.component_id),
    );
    const resolvedIds = [...new Set(resolved.map((item) => item.component_id))];
    const resolvedSet = new Set(resolvedIds);
    const evaluatedIds = [...new Set(evaluated.map((item) => item.component_id))];
    const evaluatedSet = new Set(evaluatedIds);
    const evaluatedByComponent = new Map(
      evaluated.map((item) => [item.component_id, item]),
    );
    for (const input of inputs) {
      const trace = tracesByComponent.get(input.query.component_id);
      if (trace === undefined) continue;
      const evaluatedItem = evaluatedByComponent.get(input.query.component_id);
      trace.decisionSummary = evaluatedItem === undefined
        ? null
        : preferredCatalogDecisionSummary(evaluatedItem);
      if (resolvedSet.has(input.query.component_id)) {
        trace.outcome = 'selected';
        trace.selectedCandidateCount = 1;
        trace.reason = quantityDeferredIds.has(input.query.component_id)
          ? 'quantity_confirmation_required'
          : null;
      } else if (evaluatedSet.has(input.query.component_id)) {
        trace.outcome = 'rejected';
        trace.reason = 'engine_not_selected';
      } else {
        trace.outcome = 'error';
        trace.reason = 'evaluation_result_missing';
      }
    }
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
                procurement_disposition:
                  queryByComponent.get(item.component_id)?.procurement_disposition,
                quantity_resolution:
                  queryByComponent.get(item.component_id)?.quantity_resolution,
                disposition_reason_codes:
                  queryByComponent.get(item.component_id)?.disposition_reason_codes,
              })),
              unique_query_count: inputs.length,
              api_calls: 0,
              cache_hits: 0,
              elapsed_ms: 0,
            },
          },
      resolvedComponentIds: resolvedIds,
      unresolvedComponentIds: allComponentIds.filter((componentId) => !resolvedSet.has(componentId)),
      evaluatedComponentIds: evaluatedIds,
      traces: traces(),
    };
  } catch (error) {
    log?.warn({ err: String(error) }, '자체 로컬 우선 카탈로그 평가 실패');
    for (const plan of plans) {
      const trace = tracesByComponent.get(plan.query.component_id);
      if (trace === undefined) continue;
      trace.outcome = 'error';
      trace.selectedCandidateCount = 0;
      trace.reason = 'lookup_failed';
    }
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: allComponentIds,
      evaluatedComponentIds: [],
      traces: traces(),
    };
  }
}

/**
 * MPN 없는 R/C를 모든 로컬 인제스트 공급사 데이터에서 값+패키지로 찾는다.
 *
 * ES는 후보 조회만 담당한다. 원본 검색계획에서 최소조건만 남긴 별도 쿼리를
 * sp-engine이 다시 검증하고 `automatic_selected`한 경우에만 외부 호출을
 * 생략한다. 저장된 가격·재고는 오래됐을 수 있으므로 평가 입력에서 제외한다.
 */
export async function evaluateIngestedRcCatalog(
  preflightValue: unknown,
  procurementPolicy: unknown,
  excludedComponentIds: readonly string[] = [],
  log?: LocalCatalogFallbackLog,
): Promise<PreferredLocalCatalogResult> {
  const parsed = SupplierPreflightPlan.safeParse(preflightValue);
  if (!parsed.success || !ingestedRcCatalogExperimentEnabled()) {
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: [],
      evaluatedComponentIds: [],
      traces: [],
    };
  }

  const startedAt = Date.now();
  const allComponentIds = parsed.data.plan.components.map(
    (component) => component.component_id,
  );
  const excluded = new Set(excludedComponentIds);
  const tracesByComponent = new Map<string, PreferredLocalCatalogTrace>();
  const plans: IngestedRcCatalogPlan[] = [];
  for (const component of parsed.data.plan.components) {
    if (excluded.has(component.component_id)) continue;
    if (component.planned_queries.length !== 1) continue;
    const sourceQuery = component.planned_queries[0];
    if (sourceQuery === undefined) continue;
    const plan = ingestedRcCatalogPlan(sourceQuery);
    if (plan === null) continue;
    plans.push(plan);
    tracesByComponent.set(component.component_id, {
      componentId: component.component_id,
      catalogType: 'ingested_rc',
      query: preferredCatalogQueryLabel(sourceQuery),
      outcome: 'skipped',
      candidateCount: 0,
      evaluatedCandidateCount: 0,
      selectedCandidateCount: 0,
      elapsedMs: 0,
      reason: 'query_not_eligible',
      decisionSummary: null,
    });
  }

  const traces = (): PreferredLocalCatalogTrace[] => {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    return [...tracesByComponent.values()].map((trace) => ({
      ...trace,
      elapsedMs,
    }));
  };
  if (plans.length === 0) {
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: allComponentIds,
      evaluatedComponentIds: [],
      traces: [],
    };
  }

  try {
    const partIdsByComponent = await searchIngestedRcPartIds(plans);
    for (const plan of plans) {
      const componentId = plan.evaluationQuery.component_id;
      const trace = tracesByComponent.get(componentId);
      if (trace === undefined) continue;
      const candidateCount = partIdsByComponent.get(componentId)?.length ?? 0;
      trace.candidateCount = candidateCount;
      trace.outcome = candidateCount === 0 ? 'no_candidates' : 'skipped';
      trace.reason = candidateCount === 0
        ? 'catalog_candidates_not_found'
        : 'catalog_products_unavailable';
    }

    const uniquePartIds = [
      ...new Set([...partIdsByComponent.values()].flat()),
    ];
    const parts = await loadIngestedRcParts(uniquePartIds);
    const partsById = new Map(parts.map((part) => [String(part.id), part]));
    const inputs = plans.flatMap((plan) => {
      const componentId = plan.evaluationQuery.component_id;
      const products = (partIdsByComponent.get(componentId) ?? [])
        .flatMap((partId) => {
          const part = partsById.get(partId);
          if (part === undefined) return [];
          const product = ingestedRcProductForPart(part, plan.partType);
          return product === null ? [] : [product];
        })
        .slice(0, PREFERRED_CATALOG_SEARCH_SIZE);
      const trace = tracesByComponent.get(componentId);
      if (trace !== undefined) {
        trace.evaluatedCandidateCount = products.length;
        if (products.length === 0 && trace.candidateCount > 0) {
          trace.outcome = 'no_candidates';
        }
      }
      return products.length === 0
        ? []
        : [{ query: plan.evaluationQuery, products }];
    });
    if (inputs.length === 0) {
      return {
        envelope: null,
        resolvedComponentIds: [],
        unresolvedComponentIds: allComponentIds,
        evaluatedComponentIds: [],
        traces: traces(),
      };
    }

    const queryByComponent = new Map(
      inputs.map((input) => [input.query.component_id, input.query]),
    );
    const evaluated = await evaluateCatalogBatch(inputs, procurementPolicy);
    const isQuantityDeferredSelection = (
      item: CatalogEvaluationItemType,
    ): boolean => {
      const query = queryByComponent.get(item.component_id);
      const decision = item.procurement_decision;
      if (
        query?.procurement_disposition !== 'quantity_confirmation_required'
        || query.quantity_resolution !== 'missing'
        || decision?.status !== 'input_incomplete'
        || decision.selection_application_state !== 'not_selected'
        || decision.primary_unavailability_reason !== 'input_incomplete'
        || decision.technical_preselection_identity_key === null
        || decision.technical_preselection_identity_key === undefined
        || decision.technical_preselection_evidence_key === null
        || decision.technical_preselection_evidence_key === undefined
      ) return false;
      return item.candidates.some((candidate) =>
        candidate.decision?.selection_eligibility === 'automatic'
        && candidate.decision.identity_key
          === decision.technical_preselection_identity_key
        && candidate.decision.technical_evidence_key
          === decision.technical_preselection_evidence_key);
    };
    const quantityDeferredIds = new Set(
      evaluated
        .filter(isQuantityDeferredSelection)
        .map((item) => item.component_id),
    );
    const resolved = evaluated.filter((item) =>
      item.procurement_decision?.selection_application_state
        === 'automatic_selected'
      || quantityDeferredIds.has(item.component_id));
    const resolvedIds = [...new Set(
      resolved.map((item) => item.component_id),
    )];
    const resolvedSet = new Set(resolvedIds);
    const evaluatedIds = [...new Set(
      evaluated.map((item) => item.component_id),
    )];
    const evaluatedSet = new Set(evaluatedIds);
    const evaluatedByComponent = new Map(
      evaluated.map((item) => [item.component_id, item]),
    );
    for (const input of inputs) {
      const componentId = input.query.component_id;
      const trace = tracesByComponent.get(componentId);
      if (trace === undefined) continue;
      const item = evaluatedByComponent.get(componentId);
      trace.decisionSummary = item === undefined
        ? null
        : preferredCatalogDecisionSummary(item);
      if (resolvedSet.has(componentId)) {
        trace.outcome = 'selected';
        trace.selectedCandidateCount = 1;
        trace.reason = quantityDeferredIds.has(componentId)
          ? 'quantity_confirmation_required'
          : 'minimum_requirements_matched';
      } else if (evaluatedSet.has(componentId)) {
        trace.outcome = 'rejected';
        trace.reason = 'engine_not_selected';
      } else {
        trace.outcome = 'error';
        trace.reason = 'evaluation_result_missing';
      }
    }

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
                procurement_disposition:
                  queryByComponent.get(item.component_id)
                    ?.procurement_disposition,
                quantity_resolution:
                  queryByComponent.get(item.component_id)?.quantity_resolution,
                disposition_reason_codes:
                  queryByComponent.get(item.component_id)
                    ?.disposition_reason_codes,
              })),
              unique_query_count: inputs.length,
              api_calls: 0,
              cache_hits: 0,
              elapsed_ms: 0,
            },
          },
      resolvedComponentIds: resolvedIds,
      unresolvedComponentIds: allComponentIds.filter(
        (componentId) => !resolvedSet.has(componentId),
      ),
      evaluatedComponentIds: evaluatedIds,
      traces: traces(),
    };
  } catch (error) {
    log?.warn(
      { err: String(error) },
      '인제스트 R/C 최소조건 카탈로그 평가 실패',
    );
    for (const plan of plans) {
      const trace = tracesByComponent.get(plan.evaluationQuery.component_id);
      if (trace === undefined) continue;
      trace.outcome = 'error';
      trace.selectedCandidateCount = 0;
      trace.reason = 'lookup_failed';
    }
    return {
      envelope: null,
      resolvedComponentIds: [],
      unresolvedComponentIds: allComponentIds,
      evaluatedComponentIds: [],
      traces: traces(),
    };
  }
}

/** 두 로컬 단계를 한 개의 저장/표시 trace로 합친다. 뒤 단계가 같은 행을 대체한다. */
export function mergeLocalCatalogResults(
  first: PreferredLocalCatalogResult,
  second: PreferredLocalCatalogResult,
): PreferredLocalCatalogResult {
  const resolvedComponentIds = [
    ...new Set([
      ...first.resolvedComponentIds,
      ...second.resolvedComponentIds,
    ]),
  ];
  const resolved = new Set(resolvedComponentIds);
  const allComponentIds = new Set([
    ...first.resolvedComponentIds,
    ...first.unresolvedComponentIds,
    ...second.resolvedComponentIds,
    ...second.unresolvedComponentIds,
  ]);
  const traces = new Map(
    first.traces.map((trace) => [trace.componentId, trace]),
  );
  for (const trace of second.traces) traces.set(trace.componentId, trace);
  return {
    envelope: null,
    resolvedComponentIds,
    unresolvedComponentIds: [...allComponentIds].filter(
      (componentId) => !resolved.has(componentId),
    ),
    evaluatedComponentIds: [
      ...new Set([
        ...first.evaluatedComponentIds,
        ...second.evaluatedComponentIds,
      ]),
    ],
    traces: [...traces.values()],
  };
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
