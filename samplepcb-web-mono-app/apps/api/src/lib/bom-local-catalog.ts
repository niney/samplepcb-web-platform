import { z } from 'zod';
import { normalizeMpn } from '@sp/utils';
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

type LocalFallbackEnvelopeType = z.infer<typeof LocalFallbackEnvelope>;
type LocalFallbackComponentType = z.infer<typeof LocalFallbackComponent>;
type LocalCatalogProductType = z.infer<typeof LocalCatalogProduct>;
type CatalogEvaluationItemType = z.infer<typeof CatalogEvaluationResponse>['items'][number];

interface CatalogPartRow {
  mpnNorm: string;
  manufacturerNorm: string;
  offers: { rawJson: unknown }[];
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
  inputs: LocalCatalogEvaluationInput[],
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
