import { z } from 'zod';

// 부품 카탈로그 검색 — sp-node 저장(DB)·색인(ES)·검색 계약 (설계: docs/PARTS_SEARCH.md).
// 카탈로그(부품·오퍼)는 BOM 매칭 결과(문맥)와 분리된 사실 데이터다.

export const PartPriceBreak = z.object({
  qty: z.number().int(),
  price: z.number(),
});
export type PartPriceBreakType = z.infer<typeof PartPriceBreak>;

export const PartOfferView = z.object({
  supplier: z.string(), // mouser|digikey|unikeyic|… (공급사 추가 = 값 추가, 스키마 무변경)
  supplierSku: z.string(),
  productUrl: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  packaging: z.string().nullable(),
  currency: z.string().nullable(),
  priceBreaks: z.array(PartPriceBreak),
  fetchedAt: z.string(),
});
export type PartOfferViewType = z.infer<typeof PartOfferView>;

export const PartHit = z.object({
  id: z.string(),
  mpn: z.string(),
  manufacturerName: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycle: z.string().nullable(),
  /** SI 정준 스펙 (resistanceOhm·capacitanceF·… — @sp/utils SPEC_SI_FIELD 키) */
  specsSi: z.record(z.string(), z.number()),
  suppliers: z.array(z.string()),
  offerCount: z.number().int(),
  minPrice: z.number().nullable(),
  totalStock: z.number().int(),
  score: z.number().nullable(),
});
export type PartHitType = z.infer<typeof PartHit>;

export const PartFacetBucket = z.object({ value: z.string(), count: z.number().int() });
export type PartFacetBucketType = z.infer<typeof PartFacetBucket>;

export const PartSearchFacets = z.object({
  manufacturers: z.array(PartFacetBucket),
  packages: z.array(PartFacetBucket),
  suppliers: z.array(PartFacetBucket),
});
export type PartSearchFacetsType = z.infer<typeof PartSearchFacets>;

// GET 쿼리스트링 — 자유 텍스트 q(다중 해석은 서버가 수행) + 구조화 필터(패싯 클릭 전용).
export const PartSearchQuery = z.object({
  q: z.string().trim().max(200).default(''),
  manufacturer: z.string().optional(),
  packageCode: z.string().optional(),
  supplier: z.string().optional(),
  inStockOnly: z.coerce.boolean().default(false),
  resistanceMin: z.coerce.number().optional(),
  resistanceMax: z.coerce.number().optional(),
  capacitanceMin: z.coerce.number().optional(),
  capacitanceMax: z.coerce.number().optional(),
  inductanceMin: z.coerce.number().optional(),
  inductanceMax: z.coerce.number().optional(),
  voltageMin: z.coerce.number().optional(),
  voltageMax: z.coerce.number().optional(),
  sort: z.enum(['relevance', 'price', 'stock']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PartSearchQueryType = z.infer<typeof PartSearchQuery>;

export const PartSearchResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartHit),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    facets: PartSearchFacets,
  }),
});
export type PartSearchResponseType = z.infer<typeof PartSearchResponse>;

export const PartDetail = PartHit.extend({
  specsJson: z.record(z.string(), z.unknown()),
  offers: z.array(PartOfferView),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type PartDetailType = z.infer<typeof PartDetail>;

export const PartDetailResponse = z.object({ result: z.literal(true), data: PartDetail });
export type PartDetailResponseType = z.infer<typeof PartDetailResponse>;
