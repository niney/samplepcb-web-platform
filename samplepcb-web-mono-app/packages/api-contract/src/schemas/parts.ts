import { z } from 'zod';

// 부품 카탈로그 검색 — sp-node 저장(DB)·색인(ES)·검색 계약 (설계: docs/PARTS_SEARCH.md).
// 카탈로그(부품·오퍼)는 BOM 매칭 결과(문맥)와 분리된 사실 데이터다.

export const PartPriceBreak = z.object({
  qty: z.number().int(),
  price: z.number(),
});
export type PartPriceBreakType = z.infer<typeof PartPriceBreak>;

export const PartOfferKind = z.enum(['supplier_offer', 'manufacturer_catalog']);
export type PartOfferKindType = z.infer<typeof PartOfferKind>;

export const PartOfferView = z.object({
  supplier: z.string(), // mouser|digikey|unikeyic|samplepcb|… (공급사 추가 = 값 추가, 스키마 무변경)
  offerKind: PartOfferKind,
  supplierSku: z.string(),
  productUrl: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  packaging: z.string().nullable(),
  leadTime: z.string().nullable(),
  currency: z.string().nullable(),
  priceBreaks: z.array(PartPriceBreak),
  fetchedAt: z.string(),
  /** samplepcb 자체(파생) 오퍼의 원천 — 실공급사 오퍼는 null. */
  derivedFrom: z.object({ supplier: z.string(), supplierSku: z.string(), fetchedAt: z.string() }).nullable(),
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
  /** 공급사 제품 사진 직링크 — 표시 전용. */
  imageUrl: z.string().nullable(),
  /** SI 정준 스펙 (resistanceOhm·capacitanceF·… — @sp/utils SPEC_SI_FIELD 키) */
  specsSi: z.record(z.string(), z.number()),
  /** 구매·문의 가능한 공급사 채널. 제조사 카탈로그 원천은 포함하지 않는다. */
  suppliers: z.array(z.string()),
  offerCount: z.number().int(),
  minPrice: z.number().nullable(),
  minPriceCurrency: z.string().nullable(), // KRW·USD… — UI 가 통화 기호를 결정
  totalStock: z.number().int(),
  /** 오퍼(재고·가격) 최신 fetchedAt — 데이터 나이 표시용. null=오퍼 없음/구 색인. */
  offersFetchedAt: z.string().nullable(),
  /** 공급사 간 스펙 실충돌 존재 — 관리자 배지용(구 색인 문서는 서버가 false 로 보정). */
  hasSpecConflict: z.boolean(),
  /** 가격·실재고 없이 취급 가능성만 확인된 제조사 카탈로그 오퍼가 존재한다. */
  hasCatalogInquiryOffer: z.boolean(),
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

// ── 고객 단일 검색(/api/bom/parts-search) — 결과 행에 대표 구매 조건 첨부 ──────
// 서버가 필요수량과 동일한 환율 스냅샷으로 대표 오퍼를 선정해 내린다.

export const PartSearchPricingContext = z.object({
  targetCurrency: z.literal('KRW'),
  usdKrwRate: z.number().positive().nullable(),
  rateDate: z.string().nullable(),
  source: z.enum(['manual', 'koreaexim']).nullable(),
  stale: z.boolean(),
});
export type PartSearchPricingContextType = z.infer<typeof PartSearchPricingContext>;

export const PartAppliedOffer = z.object({
  supplier: z.string(),
  supplierSku: z.string(),
  packaging: z.string().nullable(),
  currency: z.string(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  fetchedAt: z.string(),
  priceBreaks: z.array(PartPriceBreak),
  /** 적용 단가·구간·실효 주문수량(MOQ·배수 보정) — 필요수량(needed) 기준. */
  unitPrice: z.number(),
  /** 원화 환산 단가·합계. 환율이 없거나 지원하지 않는 통화면 null. */
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
  breakQty: z.number().int(),
  orderQty: z.number().int(),
  stockShort: z.boolean(),
});
export type PartAppliedOfferType = z.infer<typeof PartAppliedOffer>;

/** 단일검색 결과표의 공급사별 한 행. 오퍼 원문과 필요수량 적용 결과를 함께 내린다. */
export const BomPartOfferOption = PartOfferView.extend({
  applied: PartAppliedOffer.nullable(),
});
export type BomPartOfferOptionType = z.infer<typeof BomPartOfferOption>;

export const BomPartSearchQuery = PartSearchQuery.extend({
  needed: z.coerce.number().int().min(1).max(1_000_000).default(1),
});
export type BomPartSearchQueryType = z.infer<typeof BomPartSearchQuery>;

export const BomPartHit = PartHit.extend({
  /** catalog=DB/ES 즉시 결과, supplier=현재 공급사 검색 결과. */
  source: z.enum(['catalog', 'supplier']),
  /** 공급사 즉시 결과는 DB 상세 저장을 기다리지 않고 오퍼를 함께 제공한다. */
  inlineOffers: z.array(PartOfferView).nullable(),
  /** 공급사별 가격·재고 행. 제조사 카탈로그 문의 오퍼는 applied=null이다. */
  offerOptions: z.array(BomPartOfferOption),
  /** 필요수량 기준 대표 구매 조건 — 가격 있는 실공급사 오퍼가 없으면 null. */
  applied: PartAppliedOffer.nullable(),
});
export type BomPartHitType = z.infer<typeof BomPartHit>;

export const BomPartSearchResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(BomPartHit),
    total: z.number().int(),
    /** mpn=정확 MPN, exact=해석 규격 전부 일치, similar=완화 검색, text=일반 텍스트. */
    searchMode: z.enum(['mpn', 'exact', 'similar', 'text']),
    interpretedSpecCount: z.number().int().min(0),
    pricingContext: PartSearchPricingContext,
    page: z.number().int(),
    pageSize: z.number().int(),
    facets: PartSearchFacets,
  }),
});
export type BomPartSearchResponseType = z.infer<typeof BomPartSearchResponse>;

// 로컬 색인에 정확 규격이 없을 때 사용자가 명시적으로 공급사 검색을 요청한다.
// GET 검색은 읽기 전용으로 유지하고, 비용·일일 한도가 있는 보강만 POST 로 분리한다.
export const BomPartSearchSupplementBody = z.object({
  q: z.string().trim().min(1).max(200),
  needed: z.number().int().min(1).max(1_000_000).default(1),
  /** 부품 변경 화면은 partId가 필요하므로 카탈로그 반영까지 기다린다. */
  waitForCatalog: z.boolean().default(false),
});
export type BomPartSearchSupplementBodyType = z.infer<typeof BomPartSearchSupplementBody>;

export const BomPartSearchSupplementResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(BomPartHit),
    total: z.number().int(),
    pricingContext: PartSearchPricingContext,
    engine: z.object({
      apiCalls: z.number().int().min(0),
      cacheHits: z.number().int().min(0),
      warnings: z.array(z.string()),
    }),
    catalog: z.object({
      status: z.enum(['queued', 'completed']),
      stats: z.object({
        parts: z.number().int(),
        offers: z.number().int(),
        indexed: z.number().int(),
        queued: z.number().int(),
      }).nullable(),
    }),
  }),
});
export type BomPartSearchSupplementResponseType = z.infer<typeof BomPartSearchSupplementResponse>;

export const PartSpecConflictGroup = z.object({
  value: z.unknown(),
  suppliers: z.array(z.string()),
  fetchedAt: z.string(),
});
export type PartSpecConflictGroupType = z.infer<typeof PartSpecConflictGroup>;

export const PartDetail = PartHit.extend({
  specsJson: z.record(z.string(), z.unknown()),
  /** field → 값 그룹들(채택 그룹이 첫 번째). null=충돌 없음. */
  specConflicts: z.record(z.string(), z.array(PartSpecConflictGroup)).nullable(),
  offers: z.array(PartOfferView),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type PartDetailType = z.infer<typeof PartDetail>;

export const PartDetailResponse = z.object({ result: z.literal(true), data: PartDetail });
export type PartDetailResponseType = z.infer<typeof PartDetailResponse>;

// 수동 갱신([공급사 갱신] 버튼) — 강제 라이브 검색 후 재인제스트 통계
export const PartRefreshResponse = z.object({
  result: z.literal(true),
  data: z.object({
    parts: z.number().int(),
    offers: z.number().int(),
    indexed: z.number().int(),
    queued: z.number().int(),
  }),
});
export type PartRefreshResponseType = z.infer<typeof PartRefreshResponse>;

// 하드 삭제(관리자) — 오퍼·가격구간 cascade, 견적 연결 부품은 409로 보호.
export const PartDeleteResponse = z.object({ result: z.literal(true) });
export type PartDeleteResponseType = z.infer<typeof PartDeleteResponse>;

// 카탈로그 초기화(관리자) — 연결된 견적까지 강제 삭제하므로 전용 confirm 리터럴로 오호출 방어.
export const PartsResetBody = z.object({ confirm: z.literal('RESET_WITH_QUOTES') });
export type PartsResetBodyType = z.infer<typeof PartsResetBody>;
export const PartsResetResponse = z.object({
  result: z.literal(true),
  data: z.object({
    parts: z.number().int(),
    quotes: z.number().int(),
    quoteItems: z.number().int(),
  }),
});
export type PartsResetResponseType = z.infer<typeof PartsResetResponse>;

// 현재 관리자 검색 조건과 정확히 일치하는 부품 전체 삭제. 페이지·정렬은 대상 범위가 아니며,
// 무필터 전체 삭제는 기존 카탈로그 초기화와 구분하기 위해 계약에서 거부한다.
const PartBulkDeleteFilterBase = PartSearchQuery.omit({
  sort: true,
  page: true,
  pageSize: true,
});
export const PartBulkDeleteFilter = PartBulkDeleteFilterBase.refine(
  (value) =>
    value.q !== ''
    || value.manufacturer !== undefined
    || value.packageCode !== undefined
    || value.supplier !== undefined
    || value.inStockOnly
    || value.resistanceMin !== undefined
    || value.resistanceMax !== undefined
    || value.capacitanceMin !== undefined
    || value.capacitanceMax !== undefined
    || value.inductanceMin !== undefined
    || value.inductanceMax !== undefined
    || value.voltageMin !== undefined
    || value.voltageMax !== undefined,
  { message: '필터 결과 삭제에는 검색어나 필터가 하나 이상 필요합니다' },
);
export type PartBulkDeleteFilterType = z.infer<typeof PartBulkDeleteFilter>;

export const PartBulkDeletePreviewBody = z.object({ filter: PartBulkDeleteFilter });
export type PartBulkDeletePreviewBodyType = z.infer<typeof PartBulkDeletePreviewBody>;

const PartBulkDeleteFacetCount = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

const PartBulkDeleteCatalogSource = z.object({
  supplier: z.string(),
  sourceDataset: z.string(),
  sourceSha256: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

const PartBulkDeleteProtectedPart = z.object({
  partId: z.string(),
  mpn: z.string(),
  manufacturerName: z.string(),
  quoteCount: z.number().int().positive(),
  quoteIds: z.array(z.string()),
});

export const PartBulkDeletePreviewData = z.object({
  matchedParts: z.number().int().nonnegative(),
  existingParts: z.number().int().nonnegative(),
  deletableParts: z.number().int().nonnegative(),
  protectedParts: z.number().int().nonnegative(),
  protectedQuoteItems: z.number().int().nonnegative(),
  staleIndexDocuments: z.number().int().nonnegative(),
  multiSupplierParts: z.number().int().nonnegative(),
  supplierOffers: z.array(PartBulkDeleteFacetCount),
  catalogSources: z.array(PartBulkDeleteCatalogSource),
  protectedSample: z.array(PartBulkDeleteProtectedPart),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
  confirmation: z.string(),
});
export type PartBulkDeletePreviewDataType = z.infer<typeof PartBulkDeletePreviewData>;
export const PartBulkDeletePreviewResponse = z.object({
  result: z.literal(true),
  data: PartBulkDeletePreviewData,
});
export type PartBulkDeletePreviewResponseType = z.infer<typeof PartBulkDeletePreviewResponse>;

export const PartBulkDeleteBody = z.object({
  filter: PartBulkDeleteFilter,
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
  confirmation: z.string().max(64),
});
export type PartBulkDeleteBodyType = z.infer<typeof PartBulkDeleteBody>;

export const PartBulkDeleteResponse = z.object({
  result: z.literal(true),
  data: z.object({
    matchedParts: z.number().int().nonnegative(),
    deletedParts: z.number().int().nonnegative(),
    protectedParts: z.number().int().nonnegative(),
    protectedQuoteItems: z.number().int().nonnegative(),
    staleIndexDocuments: z.number().int().nonnegative(),
    esCleanupPending: z.boolean(),
  }),
});
export type PartBulkDeleteResponseType = z.infer<typeof PartBulkDeleteResponse>;
