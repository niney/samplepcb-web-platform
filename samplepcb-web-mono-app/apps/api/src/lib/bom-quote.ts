import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  BomQuoteDecisionReason,
  BomQuoteExchangeRateSnapshot,
  BomQuoteMatchEvidence,
  BomQuoteSelectionSource,
  BomQuoteSelectedOffer,
  type AdminBomQuoteDetailType,
  type AdminBomQuoteSummaryType,
  type BomQuoteDetailType,
  type BomQuoteCandidateOfferType,
  type BomQuoteCandidateSafetyType,
  type BomQuoteCandidateType,
  type BomQuoteComparisonRowType,
  type BomQuoteComparisonType,
  type BomQuoteDecisionReasonType,
  type BomQuoteExchangeRateSnapshotType,
  type BomQuoteExtractionSourceType,
  type BomQuoteItemCandidatesType,
  type BomQuoteItemInputType,
  type BomQuoteItemType,
  type BomQuoteMatchEvidenceType,
  type BomQuoteRecommendationTypeType,
  type BomQuoteSelectionEventType,
  type BomQuoteSelectionSourceType,
  type BomQuoteSheetType,
  type BomQuoteSelectedOfferType,
  type BomQuoteStatusType,
  type BomQuoteSummaryType,
} from '@sp/api-contract';
import {
  applyQtyToOffer,
  computeTotals,
  neededQty,
  normalizeMpn,
  pickBreak,
  pickDefaultOffer,
  toKrw,
  type BomOfferInput,
  type OfferPick,
} from '@sp/utils';
import { prisma } from './prisma';
import { engineFetch } from './engine-client';
import { resolveManufacturer } from './manufacturer-alias';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import { getBomQuoteRuntimeConfig } from './exchange-rate';
import { normalizeSupplierPackaging } from './supplier-packaging';

// 고객 BOM 견적 핵심 로직 — 회원/관리자 라우트가 공유. 설계: docs/BOM_QUOTE.md.
// 원칙: 수량·오퍼는 스냅샷 박제가 단일 진실, 금액은 항상 서버가 스냅샷에서 재계산
// (클라 금액 불신 — 단 스냅샷 단가 자체는 카탈로그 매칭이 서버측에서 기록한 값이고,
//  최종 확정가는 관리자 검토가 결정하는 RFQ 모델이라 조작 이득이 없다).

export type QuoteRow = Prisma.SpBomQuoteGetPayload<object>;
export type QuoteItemRow = Prisma.SpBomQuoteItemGetPayload<object>;
export type QuoteSheetRow = Prisma.SpBomQuoteSheetGetPayload<object>;
export type QuoteCandidateRow = Prisma.SpBomQuoteCandidateGetPayload<object>;
export type QuoteSelectionEventRow = Prisma.SpBomQuoteSelectionEventGetPayload<object>;

// ── 상태 전이 ────────────────────────────────────────────────────────────────
export const QUOTE_TRANSITIONS: Record<string, BomQuoteStatusType[]> = {
  draft: ['requested', 'canceled'],
  requested: ['reviewing', 'answered', 'canceled'],
  reviewing: ['answered', 'closed', 'canceled'],
  answered: ['closed'],
  closed: [],
  canceled: [],
};

export function canTransition(from: string, to: BomQuoteStatusType): boolean {
  return (QUOTE_TRANSITIONS[from] ?? []).includes(to);
}

// ── 엔진 파싱 결과 → 라인 초안 ───────────────────────────────────────────────
const EngineComponentLoose = z
  .object({
    part_number: z.string().nullish(),
    manufacturer: z.string().nullish(),
    description: z.string().nullish(),
    quantity: z.number().int().nullish(),
    reference_designators: z.array(z.string()).optional(),
    package: z.string().nullish(),
    value_raw: z.string().nullish(),
    sheet_name: z.string().optional(),
    sheet_index_0based: z.number().int().min(0),
    source_rows_1based: z.array(z.number().int()).optional(),
  })
  .passthrough();

const EngineSheetLoose = z
  .object({
    sheet_index_0based: z.number().int().min(0),
    sheet_name: z.string(),
    status: z.string(),
    component_count: z.number().int().min(0).default(0),
    warnings: z.array(z.string()).default([]),
    unparsed_reason: z.string().nullish(),
  })
  .passthrough();

const EngineResultLoose = z
  .object({
    components: z.array(EngineComponentLoose).default([]),
    sheets: z.array(EngineSheetLoose).default([]),
    source_file: z.string().default(''),
  })
  .passthrough();

const EngineSupplierOffer = z
  .object({
    supplier: z.string(),
    supplier_sku: z.string().nullish(),
    packaging: z.string().nullish(),
    stock: z.number().int().nullish(),
    moq: z.number().int().nullish(),
    order_multiple: z.number().int().nullish(),
    product_url: z.string().nullish(),
    lead_time: z.string().nullish(),
    price_breaks: z
      .array(
        z.object({
          quantity: z.number().int().positive(),
          unit_price: z.number().positive(),
          currency: z.string(),
        }),
      )
      .default([]),
    fetched_at: z.string(),
  })
  .passthrough();

const EngineSupplierCandidate = z
  .object({
    status: z.string(),
    identity_confidence: z.number().default(0),
    specification_confidence: z.number().default(0),
    conflicts: z.array(z.string()).default([]),
    missing_requirements: z.array(z.string()).default([]),
    reasons: z.array(z.string()).default([]),
    corroborating_suppliers: z.array(z.string()).default([]),
    product: z
      .object({
        supplier: z.string(),
        manufacturer_part_number: z.string(),
        manufacturer: z.string().nullish(),
        description: z.string().nullish(),
        category: z.string().nullish(),
        package: z.string().nullish(),
        lifecycle_status: z.string().nullish(),
        discontinued: z.boolean().nullish(),
        end_of_life: z.boolean().nullish(),
        datasheet_url: z.string().nullish(),
        image_url: z.string().nullish(),
        normalized_specs: z.record(z.string(), z.unknown()).default({}),
        attributes: z.record(z.string(), z.unknown()).default({}),
        offers: z.array(EngineSupplierOffer).default([]),
      })
      .passthrough(),
    package_comparison: z.record(z.string(), z.unknown()).nullish(),
    spec_comparisons: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

const EngineSupplierQuery = z
  .object({
    mode: z.string(),
    part_number: z.string().nullish(),
  })
  .passthrough();

const EngineSupplierComponent = z
  .object({
    component_id: z.string(),
    mode: z.string().optional(),
    status: z.string(),
    query: EngineSupplierQuery.nullish(),
    initial_query: EngineSupplierQuery.nullish(),
    candidates: z.array(EngineSupplierCandidate).default([]),
  })
  .passthrough();

const EngineSupplierEnvelope = z
  .object({
    search: z
      .object({
        components: z.array(EngineSupplierComponent).default([]),
      })
      .passthrough(),
  })
  .passthrough();

type EngineSupplierCandidateType = z.infer<typeof EngineSupplierCandidate>;
type EngineSupplierComponentType = z.infer<typeof EngineSupplierComponent>;

export const BOM_ENGINE_SELECTION_POLICY_VERSION = 'engine-hybrid-purchase-fit-v5';

/** 엔진 시트 결과를 고객·관리자 공용 선택 스냅샷으로 축약한다. */
export function extractEngineSheets(result: unknown): BomQuoteSheetType[] {
  const parsed = EngineResultLoose.safeParse(result);
  if (!parsed.success) return [];
  return parsed.data.sheets.map((sheet) => ({
    sheetIndex: sheet.sheet_index_0based,
    sheetName: sheet.sheet_name.slice(0, 191),
    status: sheet.status === 'parsed' ? 'parsed' : sheet.status === 'not_bom' ? 'not_bom' : 'error',
    componentCount: sheet.component_count,
    selected: false,
    failureReason: sheet.unparsed_reason?.slice(0, 500) ?? null,
    warnings: sheet.warnings,
  }));
}

/**
 * G-shape 파싱 결과에서 견적 라인 초안 생성.
 *
 * 선택한 시트에서 엔진이 컴포넌트로 판정한 행은 MPN 유무와 관계없이 모두 보존한다.
 * 순서는 워크북 시트 순서 → 원본 행 번호 → 엔진 입력 순서로 고정한다. MPN이 없는
 * 행은 빈 문자열로 두어 value_raw를 MPN처럼 카탈로그에 오매칭하지 않는다.
 */
export function buildItemsFromEngineResult(
  result: unknown,
  selectedSheetIndexes: readonly number[],
): BomQuoteItemInputType[] {
  const parsed = EngineResultLoose.safeParse(result);
  if (!parsed.success) return [];
  const selected = new Set(selectedSheetIndexes);
  const components = parsed.data.components
    .map((component, inputIndex) => ({ component, inputIndex }))
    .filter(({ component }) => selected.has(component.sheet_index_0based))
    .sort((a, b) => {
      const sheetOrder = a.component.sheet_index_0based - b.component.sheet_index_0based;
      if (sheetOrder !== 0) return sheetOrder;
      const aRow = Math.min(...(a.component.source_rows_1based ?? []), Number.MAX_SAFE_INTEGER);
      const bRow = Math.min(...(b.component.source_rows_1based ?? []), Number.MAX_SAFE_INTEGER);
      return aRow - bRow || a.inputIndex - b.inputIndex;
    });
  const items: BomQuoteItemInputType[] = [];
  for (const { component: c } of components) {
    const mpn = (c.part_number ?? '').trim();
    const sourceRows = c.source_rows_1based ?? [];
    const componentId = createHash('sha256')
      .update(`${parsed.data.source_file}\0${String(c.sheet_index_0based)}\0${sourceRows.join(',')}`)
      .digest('hex')
      .slice(0, 24);
    items.push({
      rowIdx: items.length,
      included: true,
      mpn: mpn.slice(0, 191),
      manufacturerName: c.manufacturer?.trim().slice(0, 191) ?? null,
      description: c.description?.trim().slice(0, 1000) ?? null,
      bomQty: Math.max(1, c.quantity ?? 1),
      orderQty: 0, // 매칭·수량 박제 전 — catalog-match/재계산이 채운다
      matchStatus: 'none',
      matchEvidence: null,
      recommendedCandidateKey: null,
      selectedCandidateKey: null,
      selectionSource: 'none',
      partId: null,
      selectedOffer: null,
      sourceSheetIndex: c.sheet_index_0based,
      sourceSheetName: c.sheet_name?.slice(0, 191) ?? null,
      sourceRow: {
        sheetName: c.sheet_name ?? null,
        sourceRows,
        componentId,
        referenceDesignators: c.reference_designators ?? [],
        packageCode: c.package ?? null,
        valueRaw: c.value_raw ?? null,
        inputPartNumber: mpn === '' ? null : mpn,
        inputManufacturer: c.manufacturer ?? null,
      },
    });
  }
  return items;
}

// ── 카탈로그 매칭 + 재계산 ───────────────────────────────────────────────────

export type PartWithOffers = Prisma.SpPartGetPayload<{ include: { offers: { include: { priceBreaks: true } } } }>;

// 단일 검색 라우트(bom.ts)도 대표 구매 조건 계산에 재사용한다.
export function toOfferInputs(part: PartWithOffers): BomOfferInput[] {
  return part.offers
    .filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER)
    .map((o) => ({
      supplier: o.supplier,
      supplierSku: o.supplierSku,
      packaging: normalizeSupplierPackaging(o.supplier, o.packaging),
      currency: o.currency,
      stock: o.stock,
      moq: o.moq,
      orderMultiple: o.orderMultiple,
      fetchedAt: o.fetchedAt.toISOString(),
      priceBreaks: o.priceBreaks.map((pb) => ({ qty: pb.qty, price: Number(pb.price), currency: pb.currency })),
    }));
}

function snapshotFromPick(pick: OfferPick, pinned: boolean, offerKey: string | null = null): BomQuoteSelectedOfferType {
  return {
    offerKey,
    supplier: pick.offer.supplier,
    supplierSku: pick.offer.supplierSku,
    packaging: pick.offer.packaging,
    breakQty: pick.breakQty,
    unitPrice: pick.unitPrice,
    currency: pick.currency,
    unitPriceKrw: pick.unitPriceKrw,
    moq: pick.offer.moq,
    orderMultiple: pick.offer.orderMultiple,
    stock: pick.offer.stock,
    priceBreaks: pick.offer.priceBreaks.map((pb) => ({ qty: pb.qty, price: pb.price })),
    fetchedAt: pick.offer.fetchedAt,
    pinned,
  };
}

/**
 * 카탈로그(sp_part) 매칭 — 미매칭(또는 전체) 라인에 기본 오퍼를 자동 선정한다.
 * pinned(사용자 명시 선택) 라인은 onlyUnmatched=false 여도 보존한다.
 * 공급사 검색 완료 후 재호출하면 자동 인제스트된 신규 오퍼가 반영된다.
 */
export async function catalogMatchItems(
  items: BomQuoteItemInputType[],
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
  onlyUnmatched: boolean,
): Promise<void> {
  for (const item of items) {
    if (item.selectedOffer?.pinned === true) continue;
    // 공급사 엔진이 판정을 끝낸 행은 느슨한 MPN 카탈로그 조회로 덮어쓰지 않는다.
    // 검토/미매칭도 엔진의 최종 BOM 문맥 판정이므로 그대로 보존한다.
    if (item.matchEvidence !== null) continue;
    if (onlyUnmatched && item.partId !== null) continue;
    const mpnNorm = normalizeMpn(item.mpn);
    if (mpnNorm === '') continue;

    let parts = await prisma.spPart.findMany({
      where: { mpnNorm },
      include: { offers: { include: { priceBreaks: true } } },
      take: 5,
    });
    if (parts.length === 0 && mpnNorm.length >= 6) {
      // 포장 접미사 변형 폴백(엔진 verified_variant 와 동일 취지) — 고객은 베이스 품번
      // (TLV70225DBV)만 적고 공급사는 접미사형(…DBVR/…DBVT)만 파는 관행 대응.
      // 잔여 접미사 ≤4자(R·T·TR·CT·G4·RG4…)만 허용해 다른 부품 오인을 차단한다.
      const prefixed = await prisma.spPart.findMany({
        where: { mpnNorm: { startsWith: mpnNorm } },
        include: { offers: { include: { priceBreaks: true } } },
        take: 10,
      });
      parts = prefixed.filter((p) => p.mpnNorm.length - mpnNorm.length <= 4);
    }
    if (parts.length === 0) {
      if (!onlyUnmatched) {
        item.partId = null;
        item.matchStatus = 'none';
        item.selectedOffer = null;
      }
      continue;
    }

    // 제조사 일치 우선, 없으면 실공급사 재고 합 최대(결정적)
    const mfrNorm = item.manufacturerName === null ? '' : resolveManufacturer(item.manufacturerName).norm;
    const byMfr = mfrNorm === '' ? undefined : parts.find((p) => p.manufacturerNorm === mfrNorm);
    const part =
      byMfr ??
      [...parts].sort((a, b) => {
        const stockOf = (p: PartWithOffers): number =>
          p.offers.filter((o) => o.supplier !== SAMPLEPCB_SUPPLIER).reduce((s, o) => s + (o.stock ?? 0), 0);
        return stockOf(b) - stockOf(a) || Number(a.id - b.id);
      })[0];
    if (part === undefined) continue;

    const needed = neededQty(item.bomQty, setQty, spareQty);
    const pick = pickDefaultOffer(toOfferInputs(part), needed, usdKrwRate);
    item.partId = String(part.id);
    item.matchStatus = 'auto';
    item.recommendedCandidateKey = null;
    item.selectedCandidateKey = null;
    item.selectionSource = 'auto';
    item.selectedOffer = pick === null ? null : snapshotFromPick(pick, false);
    item.orderQty = pick === null ? needed : pick.orderQty;
    // 소스 BOM 에 제조사·설명 열이 없으면 카탈로그 정본으로 보강(화면 공백 방지)
    if (item.manufacturerName === null || item.manufacturerName.trim() === '') {
      item.manufacturerName = part.manufacturerName;
    }
    if (item.description === null || item.description.trim() === '') {
      item.description = part.description?.slice(0, 1000) ?? null;
    }
  }
}

type SelectionMode = BomQuoteMatchEvidenceType['selectionMode'];
type AutomaticSelectionMode = Exclude<SelectionMode, 'review' | 'unmatched'>;

const StoredCandidateOffer = z.object({
  offerKey: z.string(),
  supplier: z.string(),
  supplierSku: z.string(),
  packaging: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  productUrl: z.string().nullable(),
  leadTime: z.string().nullable(),
  fetchedAt: z.string(),
  priceBreaks: z.array(z.object({ qty: z.number().int().positive(), price: z.number().positive(), currency: z.string() })),
});

const StoredCandidate = z.object({
  candidateKey: z.string(),
  technicalRank: z.number().int().positive(),
  status: z.string(),
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review']),
  safety: z.enum(['safe', 'caution', 'blocked']),
  autoEligible: z.boolean(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycleStatus: z.string().nullable(),
  datasheetUrl: z.string().nullable(),
  imageUrl: z.string().nullable().catch(null), // 도입 전 저장 스냅샷 호환
  identityConfidence: z.number(),
  specificationConfidence: z.number(),
  conflicts: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  reasons: z.array(z.string()),
  corroboratingSuppliers: z.array(z.string()),
  verifiedRequirementCount: z.number().int().min(0),
  requiredRequirementCount: z.number().int().min(0),
  normalizedSpecs: z.record(z.string(), z.unknown()),
  specComparisons: z.record(z.string(), z.unknown()),
  packageComparison: z.record(z.string(), z.unknown()).nullable(),
  offers: z.array(StoredCandidateOffer),
});

type StoredCandidateType = z.infer<typeof StoredCandidate>;
type StoredCandidateOfferType = z.infer<typeof StoredCandidateOffer>;

export interface QuoteComparisonCandidateSnapshotRow {
  itemId: string;
  payload: Prisma.JsonValue;
}

export interface QuoteComparisonSourceRow {
  itemId: string;
  rowIdx: number;
  extraction: BomQuoteExtractionSourceType | null;
}

interface AnalysisComponentExtractionRow {
  id: bigint;
  engineComponentId: string;
  reviewStatus: string;
  confidence: number | null;
  payload: Prisma.JsonValue;
}

/** 비교 모달과 후보 패널이 같은 영속 ComponentRecord를 읽도록 응답 변환을 일원화한다. */
export function toBomExtractionSource(
  component: AnalysisComponentExtractionRow | null,
): BomQuoteExtractionSourceType | null {
  if (component === null) return null;
  if (
    component.payload === null
    || typeof component.payload !== 'object'
    || Array.isArray(component.payload)
  ) return null;
  return {
    analysisComponentId: String(component.id),
    engineComponentId: component.engineComponentId,
    reviewStatus: component.reviewStatus === 'review' ? 'review' : 'extracted',
    confidence: component.confidence,
    payload: component.payload,
  };
}

/**
 * 전체 BOM 비교용 영속 뷰. 엔진 잡은 재시작 시 소멸하므로 이미 박제한 후보 payload만
 * 사용하고, 손상되거나 구버전인 개별 후보는 해당 행 전체가 아니라 그 후보만 격리한다.
 */
export function buildQuoteComparisonRows(
  rows: readonly QuoteComparisonCandidateSnapshotRow[],
  sources: readonly QuoteComparisonSourceRow[],
): BomQuoteComparisonRowType[] {
  const byItem = new Map<string, BomQuoteComparisonRowType['candidates']>();
  for (const row of rows) {
    const parsed = StoredCandidate.safeParse(row.payload);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    const candidates = byItem.get(row.itemId) ?? [];
    candidates.push({
      candidateKey: candidate.candidateKey,
      technicalRank: candidate.technicalRank,
      status: candidate.status,
      safety: candidate.safety,
      mpn: candidate.mpn,
      manufacturerName: candidate.manufacturerName,
      description: candidate.description,
      category: candidate.category,
      packageCode: candidate.packageCode,
      lifecycleStatus: candidate.lifecycleStatus,
      identityConfidence: candidate.identityConfidence,
      specificationConfidence: candidate.specificationConfidence,
      conflicts: candidate.conflicts,
      missingRequirements: candidate.missingRequirements,
      reasons: candidate.reasons,
      normalizedSpecs: candidate.normalizedSpecs,
      specComparisons: candidate.specComparisons,
      packageComparison: candidate.packageComparison,
      offers: candidate.offers.map((offer) => ({
        offerKey: offer.offerKey,
        supplier: offer.supplier,
        supplierSku: offer.supplierSku,
        packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging),
        stock: offer.stock,
        moq: offer.moq,
        orderMultiple: offer.orderMultiple,
        productUrl: offer.productUrl,
        fetchedAt: offer.fetchedAt,
        priceBreaks: offer.priceBreaks,
      })),
    });
    byItem.set(row.itemId, candidates);
  }
  return [...sources]
    .sort((left, right) => left.rowIdx - right.rowIdx)
    .map((source) => ({
      itemId: source.itemId,
      rowIdx: source.rowIdx,
      extraction: source.extraction,
      candidates: (byItem.get(source.itemId) ?? [])
        .sort((left, right) => left.technicalRank - right.technicalRank),
    }));
}

export interface QuoteComparisonPageQuery {
  page: number;
  pageSize: number;
  search?: string | undefined;
  sheet?: string | undefined;
  status?: 'matched' | 'attention' | 'not_found' | undefined;
}

const COMPARISON_MATCHED_STATUSES = new Set(['verified_exact', 'verified_variant', 'spec_compatible']);

function comparisonStatus(matchStatus: string, matchEvidence: Prisma.JsonValue | null): 'matched' | 'attention' | 'not_found' {
  const componentStatus = typeof matchEvidence === 'object' && matchEvidence !== null && !Array.isArray(matchEvidence)
    ? matchEvidence.componentStatus
    : null;
  if (typeof componentStatus === 'string') {
    if (COMPARISON_MATCHED_STATUSES.has(componentStatus)) return 'matched';
    if (componentStatus === 'not_found') return 'not_found';
    return 'attention';
  }
  return matchStatus === 'none' ? 'not_found' : 'matched';
}

/** 고객/관리자가 공유하는 페이지 단위 비교 읽기 모델. 후보가 없어도 원본 추출행을 반환한다. */
export async function loadQuoteComparisonPage(
  quoteId: bigint,
  query: QuoteComparisonPageQuery,
): Promise<BomQuoteComparisonType | null> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, select: { id: true } });
  if (quote === null) return null;
  const search = query.search?.trim() ?? '';
  const itemRows = await prisma.spBomQuoteItem.findMany({
    where: {
      quoteId,
      ...(query.sheet === undefined ? {} : { sourceSheetName: query.sheet }),
      ...(search === ''
        ? {}
        : {
            OR: [
              { mpn: { contains: search } },
              { manufacturerName: { contains: search } },
              { description: { contains: search } },
              { sourceSheetName: { contains: search } },
              { analysisComponent: { is: { searchText: { contains: search } } } },
            ],
          }),
    },
    orderBy: { rowIdx: 'asc' },
    select: {
      id: true,
      rowIdx: true,
      matchStatus: true,
      matchEvidence: true,
      sourceSheetName: true,
      analysisComponent: {
        select: {
          id: true,
          engineComponentId: true,
          reviewStatus: true,
          confidence: true,
          payload: true,
        },
      },
    },
  });
  const categorized = itemRows.map((item) => ({
    item,
    status: comparisonStatus(item.matchStatus, item.matchEvidence),
  }));
  const summary = categorized.reduce(
    (counts, entry) => ({ ...counts, [entry.status]: counts[entry.status] + 1 }),
    { matched: 0, attention: 0, not_found: 0 },
  );
  const filtered = query.status === undefined
    ? categorized
    : categorized.filter((entry) => entry.status === query.status);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const pageItems = filtered.slice((page - 1) * query.pageSize, page * query.pageSize).map((entry) => entry.item);
  const pageItemIds = pageItems.map((item) => item.id);
  const candidateRows = pageItemIds.length === 0
    ? []
    : await prisma.spBomQuoteCandidate.findMany({
        where: { quoteId, quoteItemId: { in: pageItemIds } },
        orderBy: [{ quoteItemId: 'asc' }, { technicalRank: 'asc' }],
        select: { quoteItemId: true, payload: true },
      });
  const sources: QuoteComparisonSourceRow[] = pageItems.map((item) => {
    const extraction = toBomExtractionSource(item.analysisComponent);
    return { itemId: String(item.id), rowIdx: item.rowIdx, extraction };
  });
  return {
    quoteId: String(quoteId),
    page,
    pageSize: query.pageSize,
    total,
    totalPages,
    summary: { matched: summary.matched, attention: summary.attention, notFound: summary.not_found },
    sheets: [...new Set(itemRows.flatMap((item) => item.sourceSheetName === null ? [] : [item.sourceSheetName]))],
    rows: buildQuoteComparisonRows(
      candidateRows.map((row) => ({ itemId: String(row.quoteItemId), payload: row.payload })),
      sources,
    ),
  };
}

export interface QuoteCandidateSnapshotInput {
  rowIdx: number;
  candidate: StoredCandidateType;
}

interface CandidateGroup {
  snapshot: StoredCandidateType;
  representative: EngineSupplierCandidateType;
  offerInputs: Map<string, BomOfferInput>;
}

interface EngineMatchDecision {
  evidence: BomQuoteMatchEvidenceType;
  candidate: EngineSupplierCandidateType | null;
  candidateKey: string | null;
  recommendedCandidateKey: string | null;
  offerKey: string | null;
  pick: OfferPick | null;
  snapshots: StoredCandidateType[];
}

type MountStyle = 'smd' | 'through-hole';

interface OriginalSelectionContext {
  valueRaw: string | null;
  packageCode: string | null;
  manufacturerName: string | null;
}

interface PhysicalRequirements {
  mountStyle: MountStyle | null;
  diameterMm: number | null;
}

interface CandidatePhysicalFacts {
  mountStyle: MountStyle | null;
  diameterMm: number | null;
  mountConflict: boolean;
  diameterConflict: boolean;
}

interface PhysicalValidation {
  reasons: string[];
  conflicts: string[];
  missingRequirements: string[];
  comparison: Record<string, unknown> | null;
}

const STRICT_CATEGORY_RULES: readonly {
  tokens: readonly string[];
  fields: readonly string[];
}[] = [
  // 전해 커패시터는 유전체 코드가 적용되지 않는다. 용량·전압과 물리 패키지를 필수로 본다.
  { tokens: ['electrolytic', '전해'], fields: ['capacitance_f', 'voltage_v', 'package'] },
  { tokens: ['resistor', '저항'], fields: ['resistance_ohm', 'power_w', 'tolerance_percent', 'package'] },
  { tokens: ['capacitor', '커패시터', '콘덴서'], fields: ['capacitance_f', 'voltage_v', 'tolerance_percent', 'dielectric', 'package'] },
  { tokens: ['inductor', '인덕터', '코일'], fields: ['inductance_h', 'current_a', 'tolerance_percent', 'package'] },
  { tokens: ['crystal', '크리스털', '수정'], fields: ['frequency_hz', 'tolerance_percent', 'package'] },
];

const PRICE_SAVING_RATE_MIN = 0.1;
const PRICE_SAVING_KRW_MIN = 500;

function candidateMode(status: string): AutomaticSelectionMode | null {
  if (status === 'verified_exact') return 'exact';
  if (status === 'verified_variant') return 'variant';
  if (status === 'spec_compatible') return 'spec-compatible';
  return null;
}

function lifecycleCaution(value: string | null, discontinued: boolean | null, endOfLife: boolean | null): boolean {
  if (discontinued === true || endOfLife === true) return true;
  const normalized = (value ?? '').toLocaleLowerCase();
  return ['nrnd', 'eol', 'end of life', 'obsolete', 'discontinued', '기존 설계'].some((token) => normalized.includes(token));
}

function lifecycleActive(value: string | null, discontinued: boolean | null, endOfLife: boolean | null): boolean {
  if (discontinued === true || endOfLife === true) return false;
  const normalized = (value ?? '').toLocaleLowerCase();
  if (normalized.includes('inactive') || normalized.includes('비활성')) return false;
  return /(?:^|\W)active(?:\W|$)/.test(normalized) || normalized === '활성' || normalized.includes('신규 설계') || normalized.includes('양산');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function detectMountStyle(value: string): MountStyle | null {
  const normalized = value.toLocaleLowerCase().replaceAll('_', ' ');
  if (
    /(?:^|[^a-z])(smd|smt)(?:[^a-z]|$)/i.test(normalized) ||
    /surface[ -]?mount/i.test(normalized) ||
    /표면\s*실장/.test(normalized) ||
    /칩\s*(?:전해|저항|커패시터|콘덴서)/.test(normalized)
  ) {
    return 'smd';
  }
  if (
    /(?:^|[^a-z])(tht)(?:[^a-z]|$)/i.test(normalized) ||
    /through[ -]?hole/i.test(normalized) ||
    /스루\s*홀|삽입형|리드형/.test(normalized)
  ) {
    return 'through-hole';
  }
  // 공급사 패키지의 "방사형, 캔 - SMD"는 위에서 먼저 SMD로 판정한다.
  if (/방사형\s*,?\s*캔|radial\s*,?\s*can/i.test(normalized)) return 'through-hole';
  return null;
}

function firstPositiveNumber(value: string, patterns: readonly RegExp[]): number | null {
  for (const pattern of patterns) {
    const raw = value.match(pattern)?.[1];
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function sourceDiameterMm(value: string): number | null {
  return firstPositiveNumber(value, [
    /(?:ø|Ø|φ|Φ)\s*(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*(?:파이|ø|Ø|φ|Φ)/,
    /(?:dia(?:meter)?|직경|지름)\D{0,8}(\d+(?:\.\d+)?)\s*mm/i,
    /(\d+(?:\.\d+)?)\s*mm\D{0,8}(?:dia(?:meter)?|직경|지름)/i,
  ]);
}

function candidateDiameterMm(candidate: EngineSupplierCandidateType): number | null {
  for (const [key, value] of Object.entries(candidate.product.normalized_specs)) {
    if (!/(?:^|_)(?:case_|body_)?diameter(?:_mm)?$/i.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }

  const attributeValues = Object.entries(candidate.product.attributes)
    .filter(([key]) => /크기\s*\/\s*치수|diameter|dimensions?|size/i.test(key))
    .flatMap(([, value]) => (typeof value === 'string' ? [value] : []));
  const texts = [
    ...attributeValues,
    candidate.product.package ?? '',
    candidate.product.description ?? '',
    candidate.product.manufacturer_part_number,
  ];
  for (const text of texts) {
    const explicit = firstPositiveNumber(text, [
      /(?:dia(?:meter)?|직경|지름)\D{0,8}(\d+(?:\.\d+)?)\s*mm/i,
      /(\d+(?:\.\d+)?)\s*mm\D{0,8}(?:dia(?:meter)?|직경|지름)/i,
      /(?:ø|Ø|φ|Φ)\s*(\d+(?:\.\d+)?)\s*mm?/,
    ]);
    if (explicit !== null) return explicit;
  }
  for (const text of texts) {
    const dimensional = firstPositiveNumber(text, [
      /(?:^|[^0-9])(\d{1,2}(?:\.\d+)?)\s*(?:mm\s*)?[x×]\s*\d{1,3}(?:\.\d+)?(?:\s*mm|[^0-9]|$)/i,
    ]);
    if (dimensional !== null) return dimensional;
  }
  return null;
}

function candidateMountStyle(candidate: EngineSupplierCandidateType): MountStyle | null {
  const mountAttributes = Object.entries(candidate.product.attributes)
    .filter(([key]) => /mount(?:ing)?\s*type|실장\s*유형|장착\s*유형/i.test(key))
    .flatMap(([, value]) => (typeof value === 'string' ? [value] : []));
  const normalizedPackage = candidate.product.normalized_specs.package;
  const texts = [
    ...mountAttributes,
    typeof normalizedPackage === 'string' ? normalizedPackage : '',
    candidate.product.package ?? '',
    candidate.product.description ?? '',
  ];
  for (const text of texts) {
    const style = detectMountStyle(text);
    if (style !== null) return style;
  }
  return null;
}

function candidateGroupPhysicalFacts(members: readonly EngineSupplierCandidateType[]): CandidatePhysicalFacts {
  const mounts = uniqueStrings(members.flatMap((member) => {
    const value = candidateMountStyle(member);
    return value === null ? [] : [value];
  })) as MountStyle[];
  const diameters = members.flatMap((member) => {
    const value = candidateDiameterMm(member);
    return value === null ? [] : [value];
  });
  const firstDiameter = diameters[0] ?? null;
  const diameterConflict =
    firstDiameter !== null && diameters.some((diameter) => Math.abs(diameter - firstDiameter) > 0.25);
  return {
    mountStyle: mounts.length === 1 ? mounts[0] ?? null : null,
    diameterMm: diameterConflict ? null : firstDiameter,
    mountConflict: mounts.length > 1,
    diameterConflict,
  };
}

function originalPhysicalRequirements(context: OriginalSelectionContext | null): PhysicalRequirements {
  if (context === null) return { mountStyle: null, diameterMm: null };
  const sourceText = `${context.packageCode ?? ''} ${context.valueRaw ?? ''}`.trim();
  return {
    mountStyle: detectMountStyle(sourceText),
    diameterMm: sourceDiameterMm(sourceText),
  };
}

function validatePhysicalRequirements(
  requirements: PhysicalRequirements,
  facts: CandidatePhysicalFacts,
  engineComparison: Record<string, unknown> | null,
): PhysicalValidation {
  if (requirements.mountStyle === null && requirements.diameterMm === null) {
    return { reasons: [], conflicts: [], missingRequirements: [], comparison: engineComparison };
  }

  const reasons: string[] = [];
  const conflicts: string[] = [];
  const missingRequirements: string[] = [];
  let mountResult: 'not-required' | 'match' | 'mismatch' | 'unknown' = 'not-required';
  let diameterResult: 'not-required' | 'match' | 'mismatch' | 'unknown' = 'not-required';

  if (requirements.mountStyle !== null) {
    if (facts.mountConflict) {
      conflicts.push('mount_style_source_conflict');
      mountResult = 'unknown';
    } else if (facts.mountStyle === null) {
      missingRequirements.push('mount_style');
      mountResult = 'unknown';
    } else if (facts.mountStyle !== requirements.mountStyle) {
      conflicts.push('mount_style_mismatch');
      mountResult = 'mismatch';
    } else {
      reasons.push('mount_style_match');
      mountResult = 'match';
    }
  }

  if (requirements.diameterMm !== null) {
    if (facts.diameterConflict) {
      conflicts.push('diameter_mm_source_conflict');
      diameterResult = 'unknown';
    } else if (facts.diameterMm === null) {
      missingRequirements.push('diameter_mm');
      diameterResult = 'unknown';
    } else if (Math.abs(facts.diameterMm - requirements.diameterMm) > 0.25) {
      conflicts.push('diameter_mm_mismatch');
      diameterResult = 'mismatch';
    } else {
      reasons.push('diameter_mm_match');
      diameterResult = 'match';
    }
  }

  return {
    reasons,
    conflicts,
    missingRequirements,
    comparison: {
      policy: 'source-physical-v1',
      source: requirements,
      candidate: { mountStyle: facts.mountStyle, diameterMm: facts.diameterMm },
      checks: { mountStyle: mountResult, diameterMm: diameterResult },
      engine: engineComparison,
    },
  };
}

function candidateSafety(
  candidate: EngineSupplierCandidateType,
  originalHasMpn: boolean,
  identityFallback: boolean,
  conflicts: readonly string[] = candidate.conflicts,
  missingRequirements: readonly string[] = candidate.missing_requirements,
): BomQuoteCandidateSafetyType {
  const mode = candidateMode(candidate.status);
  if (mode === null || normalizeMpn(candidate.product.manufacturer_part_number) === '') return 'blocked';
  if (mode === 'spec-compatible' && originalHasMpn && !identityFallback) return 'blocked';
  if (conflicts.length > 0) return 'blocked';
  if (mode === 'spec-compatible' && missingRequirements.length > 0) return 'blocked';
  if (lifecycleCaution(candidate.product.lifecycle_status ?? null, candidate.product.discontinued ?? null, candidate.product.end_of_life ?? null)) {
    return 'caution';
  }
  return 'safe';
}

function engineOfferInput(offer: z.infer<typeof EngineSupplierOffer>): BomOfferInput {
  return {
    supplier: offer.supplier,
    supplierSku: (offer.supplier_sku ?? '').slice(0, 191),
    packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging),
    currency: offer.price_breaks[0]?.currency ?? null,
    stock: offer.stock ?? null,
    moq: offer.moq ?? null,
    orderMultiple: offer.order_multiple ?? null,
    fetchedAt: offer.fetched_at,
    priceBreaks: offer.price_breaks.map((step) => ({
      qty: step.quantity,
      price: step.unit_price,
      currency: step.currency,
    })),
  };
}

function offerKey(candidateKey: string, offer: z.infer<typeof EngineSupplierOffer>): string {
  return createHash('sha256')
    .update(`${candidateKey}\0${offer.supplier.toLocaleLowerCase()}\0${offer.supplier_sku ?? ''}\0${offer.packaging ?? ''}`)
    .digest('hex')
    .slice(0, 32);
}

function requirementCounts(
  reasons: readonly string[],
  missingRequirements: readonly string[],
  conflicts: readonly string[],
): { verified: number; required: number } {
  const verified = new Set<string>();
  for (const reason of reasons) {
    if (!reason.endsWith('_match')) continue;
    if (reason === 'manufacturer_match' || reason.startsWith('manufacturer_part_number_')) continue;
    verified.add(reason.slice(0, -'_match'.length));
  }
  if (reasons.includes('tolerance_not_applicable_for_zero_ohm')) verified.add('tolerance_percent');
  const required = new Set(verified);
  for (const missing of missingRequirements) required.add(missing);
  for (const conflict of conflicts) {
    if (conflict.endsWith('_mismatch')) required.add(conflict.slice(0, -'_mismatch'.length));
    if (conflict.endsWith('_source_conflict')) required.add(conflict.slice(0, -'_source_conflict'.length));
  }
  return { verified: verified.size, required: required.size };
}

function buildCandidateGroups(
  component: EngineSupplierComponentType,
  originalHasMpn: boolean,
  identityFallback: boolean,
  physicalRequirements: PhysicalRequirements,
): CandidateGroup[] {
  const grouped: { mpnNorm: string; manufacturerNorms: Set<string>; members: EngineSupplierCandidateType[] }[] = [];
  for (const candidate of component.candidates) {
    const mpnNorm = normalizeMpn(candidate.product.manufacturer_part_number);
    if (mpnNorm === '') continue;
    const manufacturerNorm = resolveManufacturer(candidate.product.manufacturer).norm;
    const sameMpn = grouped.filter((item) => item.mpnNorm === mpnNorm);
    const unknownOnly = sameMpn.find(
      (item) => item.manufacturerNorms.size === 1 && item.manufacturerNorms.has('unknown'),
    );
    let group: (typeof grouped)[number] | undefined;
    if (manufacturerNorm === 'unknown') {
      const knownGroups = sameMpn.filter((item) =>
        [...item.manufacturerNorms].some((value) => value !== 'unknown'),
      );
      group = knownGroups.length === 1 ? knownGroups[0] : unknownOnly;
    } else {
      group = sameMpn.find((item) => item.manufacturerNorms.has(manufacturerNorm)) ?? unknownOnly;
    }
    if (group === undefined) {
      grouped.push({ mpnNorm, manufacturerNorms: new Set([manufacturerNorm]), members: [candidate] });
    } else {
      group.manufacturerNorms.add(manufacturerNorm);
      group.members.push(candidate);
    }
  }

  return grouped.map((group, index) => {
    const representative = group.members[0];
    if (representative === undefined) throw new Error('BOM candidate group invariant');
    const manufacturerNorm = [...group.manufacturerNorms].find((value) => value !== 'unknown') ?? 'unknown';
    const candidateKey = createHash('sha256')
      .update(`${group.mpnNorm}\0${manufacturerNorm}`)
      .digest('hex')
      .slice(0, 32);
    const offers: StoredCandidateOfferType[] = [];
    const offerInputs = new Map<string, BomOfferInput>();
    const seenOffers = new Set<string>();
    for (const member of group.members) {
      for (const offer of member.product.offers) {
        const key = offerKey(candidateKey, offer);
        if (seenOffers.has(key)) continue;
        seenOffers.add(key);
        const input = engineOfferInput(offer);
        offerInputs.set(key, input);
        offers.push({
          offerKey: key,
          supplier: input.supplier,
          supplierSku: input.supplierSku,
          packaging: input.packaging,
          stock: input.stock,
          moq: input.moq,
          orderMultiple: input.orderMultiple,
          productUrl: offer.product_url ?? null,
          leadTime: offer.lead_time ?? null,
          fetchedAt: input.fetchedAt,
          priceBreaks: input.priceBreaks.map((step) => ({
            qty: step.qty,
            price: step.price,
            currency: step.currency ?? input.currency ?? '',
          })),
        });
      }
    }
    const metadataMember = group.members.find((member) => Object.keys(member.product.attributes).length > 0)
      ?? representative;
    const physical = validatePhysicalRequirements(
      physicalRequirements,
      candidateGroupPhysicalFacts(group.members),
      group.members.find((member) => member.package_comparison != null)?.package_comparison ?? null,
    );
    const reasons = uniqueStrings([...representative.reasons, ...physical.reasons]);
    const conflicts = uniqueStrings([...representative.conflicts, ...physical.conflicts]);
    const missingRequirements = uniqueStrings([
      ...representative.missing_requirements,
      ...physical.missingRequirements,
    ]);
    const counts = requirementCounts(reasons, missingRequirements, conflicts);
    const safety = candidateSafety(
      representative,
      originalHasMpn,
      identityFallback,
      conflicts,
      missingRequirements,
    );
    const mode = candidateMode(representative.status) ?? 'review';
    const corroborating = new Set(representative.corroborating_suppliers);
    for (const member of group.members) {
      corroborating.add(member.product.supplier);
      for (const supplier of member.corroborating_suppliers) corroborating.add(supplier);
    }
    return {
      representative,
      offerInputs,
      snapshot: {
        candidateKey,
        technicalRank: index + 1,
        status: representative.status,
        selectionMode: mode,
        safety,
        autoEligible: safety !== 'blocked' && candidateMode(representative.status) !== null,
        mpn: representative.product.manufacturer_part_number.trim().slice(0, 191),
        manufacturerName: metadataMember.product.manufacturer?.trim().slice(0, 191) ?? null,
        description: metadataMember.product.description?.trim().slice(0, 1000) ?? null,
        category: metadataMember.product.category?.trim().slice(0, 191) ?? null,
        packageCode: metadataMember.product.package?.trim().slice(0, 64) ?? null,
        lifecycleStatus: representative.product.lifecycle_status?.trim().slice(0, 64) ?? null,
        datasheetUrl: metadataMember.product.datasheet_url?.trim().slice(0, 500) ?? null,
        imageUrl: metadataMember.product.image_url?.trim().slice(0, 500) ?? null,
        identityConfidence: representative.identity_confidence,
        specificationConfidence: representative.specification_confidence,
        conflicts,
        missingRequirements,
        reasons,
        corroboratingSuppliers: [...corroborating].sort(),
        verifiedRequirementCount: counts.verified,
        requiredRequirementCount: counts.required,
        normalizedSpecs: metadataMember.product.normalized_specs,
        specComparisons: representative.spec_comparisons,
        packageComparison: physical.comparison,
        offers,
      },
    };
  });
}

function groupBestPick(
  group: CandidateGroup,
  needed: number,
  usdKrwRate: number | null,
): { pick: OfferPick | null; offerKey: string | null } {
  const inputs = [...group.offerInputs.entries()];
  const pick = pickDefaultOffer(inputs.map(([, input]) => input), needed, usdKrwRate);
  if (pick === null) return { pick: null, offerKey: null };
  return { pick, offerKey: inputs.find(([, input]) => input === pick.offer)?.[0] ?? null };
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return a.every((value) => right.has(value));
}

/** 엔진 순위를 제외한 판정 근거가 같은 후보만 구매조건 비교를 허용한다. */
function hasEquivalentTechnicalEvidence(a: StoredCandidateType, b: StoredCandidateType): boolean {
  return (
    a.status === b.status &&
    a.selectionMode === b.selectionMode &&
    a.safety === b.safety &&
    a.identityConfidence === b.identityConfidence &&
    a.specificationConfidence === b.specificationConfidence &&
    a.verifiedRequirementCount === b.verifiedRequirementCount &&
    a.requiredRequirementCount === b.requiredRequirementCount &&
    sameStringSet(a.conflicts, b.conflicts) &&
    sameStringSet(a.missingRequirements, b.missingRequirements) &&
    sameStringSet(a.reasons, b.reasons)
  );
}

function hasIncompleteVerification(candidate: StoredCandidateType): boolean {
  return (
    candidate.requiredRequirementCount === 0 ||
    candidate.verifiedRequirementCount < candidate.requiredRequirementCount ||
    candidate.missingRequirements.length > 0
  );
}

const EXCESSIVE_ORDER_RATIO_MIN = 100;
const EXCESSIVE_SURPLUS_VALUE_KRW_MIN = 10_000;

/** 수량과 금액이 함께 비정상적으로 커야 과다구매로 본다(저가 릴 포장은 허용). */
function purchaseRiskRank(pick: OfferPick | null, needed: number): number {
  if (pick === null) return 4;
  if (pick.stockShort) return 3;
  if (pick.unitPriceKrw === null) return 2;
  const surplusQty = Math.max(0, pick.orderQty - needed);
  const excessive =
    pick.orderQty >= needed * EXCESSIVE_ORDER_RATIO_MIN &&
    surplusQty * pick.unitPriceKrw >= EXCESSIVE_SURPLUS_VALUE_KRW_MIN;
  return excessive ? 1 : 0;
}

interface PurchaseFitEntry<T> {
  value: T;
  snapshot: StoredCandidateType;
  result: { pick: OfferPick | null; offerKey: string | null };
}

/** 기술 근거가 같은 후보는 과다구매 위험→총액→주문수량 순으로 결정한다. */
function pickPurchaseFit<T>(entries: PurchaseFitEntry<T>[], needed: number): PurchaseFitEntry<T> | null {
  return [...entries].sort((a, b) => {
    const risk = purchaseRiskRank(a.result.pick, needed) - purchaseRiskRank(b.result.pick, needed);
    if (risk !== 0) return risk;
    const total = (pickLineTotal(a.result.pick) ?? Number.POSITIVE_INFINITY) -
      (pickLineTotal(b.result.pick) ?? Number.POSITIVE_INFINITY);
    if (total !== 0) return total;
    const orderQty = (a.result.pick?.orderQty ?? Number.POSITIVE_INFINITY) -
      (b.result.pick?.orderQty ?? Number.POSITIVE_INFINITY);
    return orderQty || a.snapshot.technicalRank - b.snapshot.technicalRank;
  })[0] ?? null;
}

function pickLineTotal(pick: OfferPick | null): number | null {
  if (pick?.unitPriceKrw == null) return null;
  return Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
}

function hasStrictCategoryCoverage(candidate: StoredCandidateType): boolean {
  if (
    candidate.safety === 'blocked' ||
    candidate.conflicts.length > 0 ||
    candidate.missingRequirements.length > 0 ||
    candidate.requiredRequirementCount === 0 ||
    candidate.verifiedRequirementCount !== candidate.requiredRequirementCount
  ) {
    return false;
  }
  const categoryText = `${candidate.category ?? ''} ${candidate.description ?? ''}`.toLocaleLowerCase();
  const rule = STRICT_CATEGORY_RULES.find((entry) => entry.tokens.some((token) => categoryText.includes(token)));
  if (rule === undefined) return false;
  const matched = new Set(
    candidate.reasons
      .filter((reason) => reason.endsWith('_match'))
      .map((reason) => reason.slice(0, -'_match'.length)),
  );
  if (candidate.reasons.includes('tolerance_not_applicable_for_zero_ohm')) matched.add('tolerance_percent');
  // 원본의 칩/SMD 요구를 공급사 실장 속성으로 확인한 것도 패키지 완전 검증으로 취급한다.
  if (matched.has('mount_style')) matched.add('package');
  return rule.fields.every((field) => matched.has(field));
}

function evidenceFromDecision(
  component: EngineSupplierComponentType,
  identityFallback: boolean,
  groups: CandidateGroup[],
  eligible: CandidateGroup[],
  selected: CandidateGroup | null,
  recommendedCandidateKey: string | null,
  pick: OfferPick | null,
  mode: SelectionMode,
  recommendationType: BomQuoteRecommendationTypeType,
  reasonCodes: BomQuoteDecisionReasonType[],
  needed: number,
  technicalTopPick: OfferPick | null,
): BomQuoteMatchEvidenceType {
  const reviewGroup = selected ?? groups[0] ?? null;
  const reviewCandidate = reviewGroup?.representative ?? component.candidates[0] ?? null;
  const evidenceSnapshot = reviewGroup?.snapshot ?? null;
  const selectedTotal = pickLineTotal(pick);
  const technicalTotal = pickLineTotal(technicalTopPick);
  const savings = selectedTotal === null || technicalTotal === null ? null : Math.round((technicalTotal - selectedTotal) * 100) / 100;
  const savingsRate = savings === null || technicalTotal === null || technicalTotal <= 0 ? null : savings / technicalTotal;
  return {
    policyVersion: BOM_ENGINE_SELECTION_POLICY_VERSION,
    componentId: component.component_id,
    componentStatus: component.status,
    identityFallback,
    candidateStatus: evidenceSnapshot?.status ?? reviewCandidate?.status ?? null,
    selectionMode: mode,
    candidateCount: component.candidates.length,
    eligibleCandidateCount: eligible.length,
    selectedMpn: selected?.snapshot.mpn ?? null,
    selectedManufacturer: selected?.snapshot.manufacturerName ?? null,
    selectedSupplier: pick?.offer.supplier ?? null,
    selectedSupplierSku: pick?.offer.supplierSku ?? null,
    identityConfidence: reviewCandidate?.identity_confidence ?? null,
    specificationConfidence: reviewCandidate?.specification_confidence ?? null,
    conflicts: evidenceSnapshot?.conflicts ?? reviewCandidate?.conflicts ?? [],
    missingRequirements: evidenceSnapshot?.missingRequirements ?? reviewCandidate?.missing_requirements ?? [],
    reasons: evidenceSnapshot?.reasons ?? reviewCandidate?.reasons ?? [],
    corroboratingSuppliers: evidenceSnapshot?.corroboratingSuppliers ?? reviewCandidate?.corroborating_suppliers ?? [],
    groupedCandidateCount: groups.length,
    alternativeCandidateCount: Math.max(0, eligible.length - (selected === null ? 0 : 1)),
    recommendedCandidateKey,
    selectedCandidateKey: selected?.snapshot.candidateKey ?? null,
    selectedTechnicalRank: selected?.snapshot.technicalRank ?? null,
    recommendationType,
    decisionReasonCodes: reasonCodes,
    verifiedRequirementCount: evidenceSnapshot?.verifiedRequirementCount ?? 0,
    requiredRequirementCount: evidenceSnapshot?.requiredRequirementCount ?? 0,
    priceEvidence:
      pick === null
        ? null
        : {
            neededQty: needed,
            orderQty: pick.orderQty,
            lineTotalKrw: selectedTotal,
            technicalTopLineTotalKrw: technicalTotal,
            savingsKrw: savings,
            savingsRate,
          },
  };
}

/**
 * 엔진만이 생성하는 두 단계 검색 계보를 확인한다. 단순 spec_compatible 상태나
 * 원본 MPN 문자열만으로는 예외를 열지 않아 일반 대체품 자동선정을 방지한다.
 */
function isIdentityMissSpecFallback(component: EngineSupplierComponentType): boolean {
  const initial = component.initial_query;
  const final = component.query;
  return (
    component.mode === 'parametric' &&
    final?.mode === 'parametric' &&
    (initial?.mode === 'identity' || initial?.mode === 'hybrid') &&
    normalizeMpn(initial.part_number ?? '') !== ''
  );
}

/**
 * 기술 순위와 구매 순위를 분리한 하이브리드 추천.
 * - 원본 MPN: 기술 최상위 부품 고정 + 동일 MPN 안에서 실효 총비용 최저 오퍼.
 * - 스펙 입력: 원본의 실장 방식·치수까지 공급사 속성과 교차 검증한다. 물리 조건과
 *   카테고리 필수 스펙을 전부 확인하고 재고가 충분하며 10%·500원 이상 절감
 *   (또는 NRND/EOL 개선)될 때만 다른 MPN을 자동 추천한다.
 */
export function selectEngineMatch(
  componentValue: unknown,
  originalHasMpn: boolean,
  needed: number,
  usdKrwRate: number | null,
  sourceContext: OriginalSelectionContext | null = null,
): EngineMatchDecision | null {
  const parsed = EngineSupplierComponent.safeParse(componentValue);
  if (!parsed.success) return null;
  const component = parsed.data;
  const identityFallback = isIdentityMissSpecFallback(component);
  const specificationSelection = !originalHasMpn || identityFallback;
  const groups = buildCandidateGroups(
    component,
    originalHasMpn,
    identityFallback,
    originalPhysicalRequirements(specificationSelection ? sourceContext : null),
  );
  const tierOrder: SelectionMode[] = specificationSelection
    ? ['exact', 'variant', 'spec-compatible']
    : ['exact', 'variant'];
  const selectedMode = tierOrder.find((mode) =>
    groups.some((group) => group.snapshot.autoEligible && group.snapshot.selectionMode === mode),
  );
  if (selectedMode === undefined) {
    const mode = component.status === 'not_found' ? 'unmatched' : 'review';
    const reasonCodes: BomQuoteDecisionReasonType[] = ['no-safe-candidate'];
    return {
      evidence: evidenceFromDecision(
        component,
        identityFallback,
        groups,
        [],
        null,
        null,
        null,
        mode,
        'none',
        reasonCodes,
        needed,
        null,
      ),
      candidate: null,
      candidateKey: null,
      recommendedCandidateKey: null,
      offerKey: null,
      pick: null,
      snapshots: groups.map((group) => group.snapshot),
    };
  }

  const eligible = groups.filter(
    (group) => group.snapshot.autoEligible && group.snapshot.selectionMode === selectedMode,
  );
  const technicalTop = eligible[0] ?? null;
  if (technicalTop === null) return null;
  let selected = technicalTop;
  let selectedPick = groupBestPick(technicalTop, needed, usdKrwRate);
  const technicalPick = selectedPick.pick;
  let recommendationType: BomQuoteRecommendationTypeType = specificationSelection ? 'technical' : 'identity';
  const reasonCodes: BomQuoteDecisionReasonType[] = [
    selectedMode === 'exact' ? 'identity-exact' : selectedMode === 'variant' ? 'identity-variant' : 'technical-top',
    'same-part-lowest-total',
  ];

  const originalManufacturerMissing = sourceContext?.manufacturerName?.trim() === '' || sourceContext?.manufacturerName == null;
  if (
    originalHasMpn &&
    originalManufacturerMissing &&
    (selectedMode === 'exact' || selectedMode === 'variant') &&
    hasIncompleteVerification(technicalTop.snapshot)
  ) {
    const equivalent = eligible
      .filter((group) => hasEquivalentTechnicalEvidence(technicalTop.snapshot, group.snapshot))
      .map((group) => ({
        value: group,
        snapshot: group.snapshot,
        result: groupBestPick(group, needed, usdKrwRate),
      }));
    const purchaseFit = pickPurchaseFit(equivalent, needed);
    if (purchaseFit !== null && purchaseFit.value !== technicalTop) {
      selected = purchaseFit.value;
      selectedPick = purchaseFit.result;
      recommendationType = 'purchase-fit';
      reasonCodes.splice(
        0,
        reasonCodes.length,
        selectedMode === 'exact' ? 'identity-exact' : 'identity-variant',
        'purchase-fit',
        'same-part-lowest-total',
      );
    }
  } else if (specificationSelection && selectedMode === 'spec-compatible' && hasStrictCategoryCoverage(technicalTop.snapshot)) {
    const alternatives = eligible
      .slice(1)
      .filter((group) => hasStrictCategoryCoverage(group.snapshot))
      .map((group) => ({ group, result: groupBestPick(group, needed, usdKrwRate) }))
      .filter((entry) => entry.result.pick !== null && !entry.result.pick.stockShort)
      .sort((a, b) => (pickLineTotal(a.result.pick) ?? Number.POSITIVE_INFINITY) - (pickLineTotal(b.result.pick) ?? Number.POSITIVE_INFINITY));
    const activeAlternative = alternatives.find((entry) =>
      lifecycleActive(
        entry.group.representative.product.lifecycle_status ?? null,
        entry.group.representative.product.discontinued ?? null,
        entry.group.representative.product.end_of_life ?? null,
      ),
    );
    if (
      lifecycleCaution(
        technicalTop.representative.product.lifecycle_status ?? null,
        technicalTop.representative.product.discontinued ?? null,
        technicalTop.representative.product.end_of_life ?? null,
      ) &&
      activeAlternative !== undefined
    ) {
      selected = activeAlternative.group;
      selectedPick = activeAlternative.result;
      recommendationType = 'lifecycle';
      reasonCodes.splice(0, reasonCodes.length, 'lifecycle-improvement', 'same-part-lowest-total');
    } else if ((technicalPick === null || technicalPick.stockShort) && alternatives[0] !== undefined) {
      selected = alternatives[0].group;
      selectedPick = alternatives[0].result;
      recommendationType = 'availability';
      reasonCodes.splice(0, reasonCodes.length, 'availability', 'same-part-lowest-total');
    } else {
      const technicalTotal = pickLineTotal(technicalPick);
      const cheapest = alternatives[0];
      const cheapestTotal = cheapest === undefined ? null : pickLineTotal(cheapest.result.pick);
      const saving = technicalTotal === null || cheapestTotal === null ? null : technicalTotal - cheapestTotal;
      const savingRate = saving === null || technicalTotal === null || technicalTotal <= 0 ? null : saving / technicalTotal;
      if (
        cheapest !== undefined &&
        saving !== null &&
        savingRate !== null &&
        saving >= PRICE_SAVING_KRW_MIN &&
        savingRate >= PRICE_SAVING_RATE_MIN
      ) {
        selected = cheapest.group;
        selectedPick = cheapest.result;
        recommendationType = 'price';
        reasonCodes.splice(0, reasonCodes.length, 'strict-spec-price-saving', 'same-part-lowest-total');
      }
    }
  }

  const recommendedCandidateKey = selected.snapshot.candidateKey;
  return {
    evidence: evidenceFromDecision(
      component,
      identityFallback,
      groups,
      eligible,
      selected,
      recommendedCandidateKey,
      selectedPick.pick,
      selectedMode,
      recommendationType,
      reasonCodes,
      needed,
      technicalPick,
    ),
    candidate: selected.representative,
    candidateKey: selected.snapshot.candidateKey,
    recommendedCandidateKey,
    offerKey: selectedPick.offerKey,
    pick: selectedPick.pick,
    snapshots: groups.map((group) => ({
      ...group.snapshot,
      autoEligible: eligible.includes(group),
    })),
  };
}

function originalPartNumber(item: BomQuoteItemInputType): string {
  const raw = item.sourceRow?.inputPartNumber;
  if (typeof raw === 'string') return raw.trim();
  if (raw === null) return '';
  if (item.matchEvidence?.selectionMode === 'spec-compatible') return '';
  return item.mpn.trim();
}

function remapExplicitCandidate(
  item: BomQuoteItemInputType,
  snapshots: StoredCandidateType[],
): StoredCandidateType | null {
  const mpnNorm = normalizeMpn(item.mpn);
  if (mpnNorm === '') return null;
  const sameMpn = snapshots.filter((candidate) => normalizeMpn(candidate.mpn) === mpnNorm);
  if (sameMpn.length === 0) return null;
  const manufacturerNorm = resolveManufacturer(item.manufacturerName).norm;
  if (manufacturerNorm !== 'unknown') {
    const byManufacturer = sameMpn.find(
      (candidate) => resolveManufacturer(candidate.manufacturerName).norm === manufacturerNorm,
    );
    if (byManufacturer !== undefined) return byManufacturer;
  }
  const currentOffer = item.selectedOffer;
  if (currentOffer !== null) {
    const byOffer = sameMpn.find((candidate) => candidate.offers.some((offer) =>
      offer.supplier.toLocaleLowerCase() === currentOffer.supplier.toLocaleLowerCase() &&
      offer.supplierSku === currentOffer.supplierSku,
    ));
    if (byOffer !== undefined) return byOffer;
  }
  return sameMpn.length === 1 ? (sameMpn[0] ?? null) : null;
}

function remappedPinnedOfferKey(
  item: BomQuoteItemInputType,
  candidate: StoredCandidateType,
): string | null {
  const current = item.selectedOffer;
  if (current?.pinned !== true) return null;
  return candidate.offers.find((offer) =>
    offer.supplier.toLocaleLowerCase() === current.supplier.toLocaleLowerCase() &&
    offer.supplierSku === current.supplierSku &&
    offer.packaging === current.packaging,
  )?.offerKey ?? null;
}

async function partIdForCandidate(candidate: EngineSupplierCandidateType): Promise<string | null> {
  const mpnNorm = normalizeMpn(candidate.product.manufacturer_part_number);
  if (mpnNorm === '') return null;
  const manufacturer = resolveManufacturer(candidate.product.manufacturer);
  const exact = await prisma.spPart.findUnique({
    where: { mpnNorm_manufacturerNorm: { mpnNorm, manufacturerNorm: manufacturer.norm } },
    select: { id: true },
  });
  if (exact !== null) return String(exact.id);
  // 공급사별 제조사 표기가 아직 별칭 사전에 없더라도 같은 MPN 인제스트 행을 연결한다.
  const byMpn = await prisma.spPart.findFirst({ where: { mpnNorm }, orderBy: { lastSeenAt: 'desc' }, select: { id: true } });
  return byMpn === null ? null : String(byMpn.id);
}

export interface ApplyEngineSupplierResult {
  applied: boolean;
  candidateSnapshots: QuoteCandidateSnapshotInput[];
}

/** 관리자와 동일한 공급사 검색 결과를 견적 행에 직접 반영한다. */
export async function applyEngineSupplierResult(
  items: BomQuoteItemInputType[],
  envelopeValue: unknown,
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
): Promise<ApplyEngineSupplierResult> {
  const parsed = EngineSupplierEnvelope.safeParse(envelopeValue);
  if (!parsed.success) return { applied: false, candidateSnapshots: [] };
  const components = new Map(parsed.data.search.components.map((component) => [component.component_id, component]));
  const candidateSnapshots: QuoteCandidateSnapshotInput[] = [];

  for (const item of items) {
    const componentId = item.sourceRow?.componentId;
    if (typeof componentId !== 'string') continue; // 수동 추가 행은 카탈로그/사용자 선택을 유지
    const component = components.get(componentId);
    if (component === undefined) continue;

    const inputPartNumber = originalPartNumber(item);
    const needed = neededQty(item.bomQty, setQty, spareQty);
    const rawValue = item.sourceRow?.valueRaw;
    const rawPackage = item.sourceRow?.packageCode;
    const rawManufacturer = item.sourceRow?.inputManufacturer;
    const decision = selectEngineMatch(component, inputPartNumber !== '', needed, usdKrwRate, {
      valueRaw: typeof rawValue === 'string' ? rawValue : null,
      packageCode: typeof rawPackage === 'string' ? rawPackage : null,
      manufacturerName: typeof rawManufacturer === 'string' ? rawManufacturer : null,
    });
    if (decision === null) continue;
    candidateSnapshots.push(...decision.snapshots.map((candidate) => ({ rowIdx: item.rowIdx, candidate })));

    // 고객/관리자의 명시 선택은 후보 목록·자동 추천만 최신화하고 현재 선택은 보존한다.
    // 후보 키는 제조사 별칭/그룹화 정책이 바뀌면 달라질 수 있어 현재 MPN·제조사·오퍼로 재연결한다.
    const explicitSelection =
      item.matchStatus === 'manual' ||
      ['customer', 'catalog', 'admin'].includes(item.selectionSource) ||
      item.selectedOffer?.pinned === true;
    if (explicitSelection) {
      item.recommendedCandidateKey = decision.recommendedCandidateKey;
      const currentReasons = item.matchEvidence?.decisionReasonCodes ?? (
        item.selectionSource === 'catalog' ? ['catalog-choice'] as const : ['customer-choice'] as const
      );
      const remapped = item.selectedCandidateKey === null
        ? null
        : remapExplicitCandidate(item, decision.snapshots);
      if (remapped === null) {
        item.selectedCandidateKey = null;
        item.matchEvidence = {
          ...decision.evidence,
          selectedCandidateKey: null,
          selectedTechnicalRank: null,
          selectedMpn: item.mpn === '' ? null : item.mpn,
          selectedManufacturer: item.manufacturerName,
          selectedSupplier: item.selectedOffer?.supplier ?? null,
          selectedSupplierSku: item.selectedOffer?.supplierSku ?? null,
          decisionReasonCodes: [...currentReasons],
          priceEvidence: null,
        };
        continue;
      }
      const pinnedOfferKey = remappedPinnedOfferKey(item, remapped);
      const pinnedOfferMissing = item.selectedOffer?.pinned === true && pinnedOfferKey === null;
      const remappedPick = pinnedOfferMissing
        ? { pick: null, offerKey: null }
        : storedCandidatePick(remapped, needed, usdKrwRate, pinnedOfferKey);
      item.selectedCandidateKey = remapped.candidateKey;
      if (remappedPick.pick !== null) {
        item.selectedOffer = snapshotFromPick(
          remappedPick.pick,
          item.selectedOffer?.pinned === true,
          remappedPick.offerKey,
        );
        item.orderQty = remappedPick.pick.orderQty;
      } else if (item.selectedOffer !== null) {
        item.selectedOffer = { ...item.selectedOffer, offerKey: null };
      }
      item.matchEvidence = selectedEvidence(
        decision.evidence,
        remapped,
        remappedPick.pick,
        needed,
        decision.evidence.priceEvidence?.technicalTopLineTotalKrw ?? null,
        [...currentReasons],
      );
      continue;
    }
    item.matchEvidence = decision.evidence;
    item.recommendedCandidateKey = decision.recommendedCandidateKey;
    item.selectedCandidateKey = decision.candidateKey;

    if (decision.candidate === null) {
      item.mpn = inputPartNumber.slice(0, 191);
      item.partId = null;
      item.matchStatus = 'none';
      item.selectedOffer = null;
      item.orderQty = needed;
      item.selectionSource = 'none';
      continue;
    }

    const product = decision.candidate.product;
    item.mpn = product.manufacturer_part_number.trim().slice(0, 191);
    if (product.manufacturer !== null && product.manufacturer !== undefined && product.manufacturer.trim() !== '') {
      item.manufacturerName = product.manufacturer.trim().slice(0, 191);
    }
    if (product.description !== null && product.description !== undefined && product.description.trim() !== '') {
      item.description = product.description.trim().slice(0, 1000);
    }
    item.partId = await partIdForCandidate(decision.candidate);
    item.matchStatus = 'auto';
    item.selectionSource = 'auto';
    item.selectedOffer = decision.pick === null ? null : snapshotFromPick(decision.pick, false, decision.offerKey);
    item.orderQty = decision.pick?.orderQty ?? needed;
  }
  return { applied: true, candidateSnapshots };
}

function storedOfferInput(offer: StoredCandidateOfferType): BomOfferInput {
  return {
    supplier: offer.supplier,
    supplierSku: offer.supplierSku,
    packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging),
    currency: offer.priceBreaks[0]?.currency ?? null,
    stock: offer.stock,
    moq: offer.moq,
    orderMultiple: offer.orderMultiple,
    fetchedAt: offer.fetchedAt,
    priceBreaks: offer.priceBreaks,
  };
}

function storedCandidatePick(
  candidate: StoredCandidateType,
  needed: number,
  usdKrwRate: number | null,
  requestedOfferKey: string | null = null,
): { pick: OfferPick | null; offerKey: string | null } {
  if (requestedOfferKey !== null) {
    const offer = candidate.offers.find((item) => item.offerKey === requestedOfferKey);
    if (offer === undefined) return { pick: null, offerKey: null };
    return { pick: applyQtyToOffer(storedOfferInput(offer), needed, usdKrwRate), offerKey: requestedOfferKey };
  }
  const inputs = candidate.offers.map((offer) => ({ offer, input: storedOfferInput(offer) }));
  const pick = pickDefaultOffer(inputs.map(({ input }) => input), needed, usdKrwRate);
  if (pick === null) return { pick: null, offerKey: null };
  return {
    pick,
    offerKey: inputs.find(({ input }) => input === pick.offer)?.offer.offerKey ?? null,
  };
}

async function partIdForStoredCandidate(candidate: StoredCandidateType): Promise<string | null> {
  const mpnNorm = normalizeMpn(candidate.mpn);
  if (mpnNorm === '') return null;
  const manufacturer = resolveManufacturer(candidate.manufacturerName);
  const exact = await prisma.spPart.findUnique({
    where: { mpnNorm_manufacturerNorm: { mpnNorm, manufacturerNorm: manufacturer.norm } },
    select: { id: true },
  });
  if (exact !== null) return String(exact.id);
  const byMpn = await prisma.spPart.findFirst({
    where: { mpnNorm },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });
  return byMpn === null ? null : String(byMpn.id);
}

interface StoredRecommendation {
  candidate: StoredCandidateType;
  pick: OfferPick | null;
  offerKey: string | null;
  technicalTopLineTotalKrw: number | null;
  recommendationType: BomQuoteRecommendationTypeType;
  reasonCodes: BomQuoteDecisionReasonType[];
}

/** 저장된 후보에 현재 수량을 다시 적용해 자동 추천을 재현한다. 명시 선택에는 적용하지 않는다. */
function recommendStoredCandidate(
  candidates: StoredCandidateType[],
  needed: number,
  usdKrwRate: number | null,
  allowAmbiguousPurchaseFit: boolean,
): StoredRecommendation | null {
  const eligible = candidates
    .filter((candidate) => candidate.autoEligible)
    .sort((a, b) => a.technicalRank - b.technicalRank);
  const technicalTop = eligible[0];
  if (technicalTop === undefined) return null;
  const technicalResult = storedCandidatePick(technicalTop, needed, usdKrwRate);
  let selected = technicalTop;
  let selectedResult = technicalResult;
  let recommendationType: BomQuoteRecommendationTypeType =
    technicalTop.selectionMode === 'exact' || technicalTop.selectionMode === 'variant' ? 'identity' : 'technical';
  const reasonCodes: BomQuoteDecisionReasonType[] = [
    technicalTop.selectionMode === 'exact'
      ? 'identity-exact'
      : technicalTop.selectionMode === 'variant'
        ? 'identity-variant'
        : 'technical-top',
    'same-part-lowest-total',
  ];

  if (
    allowAmbiguousPurchaseFit &&
    (technicalTop.selectionMode === 'exact' || technicalTop.selectionMode === 'variant') &&
    hasIncompleteVerification(technicalTop)
  ) {
    const equivalent = eligible
      .filter((candidate) => hasEquivalentTechnicalEvidence(technicalTop, candidate))
      .map((candidate) => ({
        value: candidate,
        snapshot: candidate,
        result: storedCandidatePick(candidate, needed, usdKrwRate),
      }));
    const purchaseFit = pickPurchaseFit(equivalent, needed);
    if (purchaseFit !== null && purchaseFit.value !== technicalTop) {
      selected = purchaseFit.value;
      selectedResult = purchaseFit.result;
      recommendationType = 'purchase-fit';
      reasonCodes.splice(
        0,
        reasonCodes.length,
        technicalTop.selectionMode === 'exact' ? 'identity-exact' : 'identity-variant',
        'purchase-fit',
        'same-part-lowest-total',
      );
    }
  } else if (technicalTop.selectionMode === 'spec-compatible' && hasStrictCategoryCoverage(technicalTop)) {
    const alternatives = eligible
      .slice(1)
      .filter(hasStrictCategoryCoverage)
      .map((candidate) => ({ candidate, result: storedCandidatePick(candidate, needed, usdKrwRate) }))
      .filter((entry) => entry.result.pick !== null && !entry.result.pick.stockShort)
      .sort((a, b) =>
        (pickLineTotal(a.result.pick) ?? Number.POSITIVE_INFINITY) -
        (pickLineTotal(b.result.pick) ?? Number.POSITIVE_INFINITY),
      );
    const activeAlternative = alternatives.find((entry) =>
      lifecycleActive(entry.candidate.lifecycleStatus, null, null),
    );
    if (lifecycleCaution(technicalTop.lifecycleStatus, null, null) && activeAlternative !== undefined) {
      selected = activeAlternative.candidate;
      selectedResult = activeAlternative.result;
      recommendationType = 'lifecycle';
      reasonCodes.splice(0, reasonCodes.length, 'lifecycle-improvement', 'same-part-lowest-total');
    } else if (
      (technicalResult.pick === null || technicalResult.pick.stockShort) &&
      alternatives[0] !== undefined
    ) {
      selected = alternatives[0].candidate;
      selectedResult = alternatives[0].result;
      recommendationType = 'availability';
      reasonCodes.splice(0, reasonCodes.length, 'availability', 'same-part-lowest-total');
    } else {
      const technicalTotal = pickLineTotal(technicalResult.pick);
      const cheapest = alternatives[0];
      const cheapestTotal = cheapest === undefined ? null : pickLineTotal(cheapest.result.pick);
      const saving = technicalTotal === null || cheapestTotal === null ? null : technicalTotal - cheapestTotal;
      const savingRate = saving === null || technicalTotal === null || technicalTotal <= 0 ? null : saving / technicalTotal;
      if (
        cheapest !== undefined &&
        saving !== null &&
        savingRate !== null &&
        saving >= PRICE_SAVING_KRW_MIN &&
        savingRate >= PRICE_SAVING_RATE_MIN
      ) {
        selected = cheapest.candidate;
        selectedResult = cheapest.result;
        recommendationType = 'price';
        reasonCodes.splice(0, reasonCodes.length, 'strict-spec-price-saving', 'same-part-lowest-total');
      }
    }
  }

  return {
    candidate: selected,
    pick: selectedResult.pick,
    offerKey: selectedResult.offerKey,
    technicalTopLineTotalKrw: pickLineTotal(technicalResult.pick),
    recommendationType,
    reasonCodes,
  };
}

function selectedEvidence(
  previous: BomQuoteMatchEvidenceType | null,
  candidate: StoredCandidateType,
  pick: OfferPick | null,
  needed: number,
  technicalTopLineTotalKrw: number | null,
  reasonCodes: BomQuoteDecisionReasonType[],
  recommendation?: StoredRecommendation | null,
): BomQuoteMatchEvidenceType | null {
  if (previous === null) return null;
  const lineTotal = pickLineTotal(pick);
  const savings = lineTotal === null || technicalTopLineTotalKrw === null
    ? null
    : Math.round((technicalTopLineTotalKrw - lineTotal) * 100) / 100;
  return {
    ...previous,
    candidateStatus: candidate.status,
    selectionMode: candidate.selectionMode,
    selectedMpn: candidate.mpn,
    selectedManufacturer: candidate.manufacturerName,
    selectedSupplier: pick?.offer.supplier ?? null,
    selectedSupplierSku: pick?.offer.supplierSku ?? null,
    identityConfidence: candidate.identityConfidence,
    specificationConfidence: candidate.specificationConfidence,
    conflicts: candidate.conflicts,
    missingRequirements: candidate.missingRequirements,
    reasons: candidate.reasons,
    corroboratingSuppliers: candidate.corroboratingSuppliers,
    ...(recommendation === undefined
      ? {}
      : {
          recommendedCandidateKey: recommendation?.candidate.candidateKey ?? null,
          recommendationType: recommendation?.recommendationType ?? 'none',
        }),
    selectedCandidateKey: candidate.candidateKey,
    selectedTechnicalRank: candidate.technicalRank,
    decisionReasonCodes: reasonCodes,
    verifiedRequirementCount: candidate.verifiedRequirementCount,
    requiredRequirementCount: candidate.requiredRequirementCount,
    priceEvidence:
      pick === null
        ? null
        : {
            neededQty: needed,
            orderQty: pick.orderQty,
            lineTotalKrw: lineTotal,
            technicalTopLineTotalKrw,
            savingsKrw: savings,
            savingsRate:
              savings === null || technicalTopLineTotalKrw === null || technicalTopLineTotalKrw <= 0
                ? null
                : savings / technicalTopLineTotalKrw,
          },
  };
}

/** 수량 변경 시 후보 스냅샷에서 가격을 다시 계산해 클라이언트 단가 변조를 차단한다. */
export async function repriceCandidateSelections(
  quoteId: bigint,
  items: (BomQuoteItemInputType & { id?: string })[],
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
): Promise<void> {
  const relevantItemIds = items.flatMap((item) =>
    (item.selectedCandidateKey !== null || item.recommendedCandidateKey !== null) && item.id !== undefined
      ? [BigInt(item.id)]
      : [],
  );
  if (relevantItemIds.length === 0) return;
  const rows = await prisma.spBomQuoteCandidate.findMany({
    where: { quoteId, quoteItemId: { in: relevantItemIds } },
    orderBy: [{ quoteItemId: 'asc' }, { technicalRank: 'asc' }],
  });
  const candidates = new Map<string, StoredCandidateType[]>();
  for (const row of rows) {
    const parsed = StoredCandidate.safeParse(row.payload);
    if (!parsed.success) continue;
    const itemId = String(row.quoteItemId);
    const current = candidates.get(itemId) ?? [];
    current.push(parsed.data);
    candidates.set(itemId, current);
  }
  for (const item of items) {
    const rowCandidates = item.id === undefined ? undefined : candidates.get(item.id);
    if (rowCandidates === undefined) continue;
    const needed = neededQty(item.bomQty, setQty, spareQty);
    const originalManufacturer = item.sourceRow?.inputManufacturer;
    const recommendation = recommendStoredCandidate(
      rowCandidates,
      needed,
      usdKrwRate,
      typeof originalManufacturer !== 'string' || originalManufacturer.trim() === '',
    );
    item.recommendedCandidateKey = recommendation?.candidate.candidateKey ?? null;
    if (item.matchEvidence !== null) {
      item.matchEvidence = {
        ...item.matchEvidence,
        recommendedCandidateKey: item.recommendedCandidateKey,
        recommendationType: recommendation?.recommendationType ?? 'none',
      };
    }
    const selectedCandidateKey = item.selectionSource === 'auto'
      ? (recommendation?.candidate.candidateKey ?? item.selectedCandidateKey)
      : item.selectedCandidateKey;
    if (selectedCandidateKey === null) continue;
    const candidate = rowCandidates.find((entry) => entry.candidateKey === selectedCandidateKey);
    if (candidate === undefined) continue;
    const requestedOfferKey = item.selectedOffer?.pinned === true ? item.selectedOffer.offerKey : null;
    const selected = item.selectionSource === 'auto' && recommendation?.candidate.candidateKey === candidate.candidateKey
      ? { pick: recommendation.pick, offerKey: recommendation.offerKey }
      : storedCandidatePick(candidate, needed, usdKrwRate, requestedOfferKey);
    const candidateChanged = item.selectedCandidateKey !== candidate.candidateKey;
    item.mpn = candidate.mpn;
    item.manufacturerName = candidate.manufacturerName;
    item.description = candidate.description;
    item.selectedCandidateKey = candidate.candidateKey;
    if (candidateChanged) item.partId = await partIdForStoredCandidate(candidate);
    item.orderQty = selected.pick?.orderQty ?? needed;
    item.selectedOffer = selected.pick === null
      ? null
      : snapshotFromPick(selected.pick, requestedOfferKey !== null, selected.offerKey);
    item.matchEvidence = selectedEvidence(
      item.matchEvidence,
      candidate,
      selected.pick,
      needed,
      recommendation?.technicalTopLineTotalKrw ?? null,
      item.selectionSource === 'customer'
        ? ['customer-choice', ...(requestedOfferKey === null ? [] : ['offer-choice'] as const)]
        : (recommendation?.reasonCodes ?? item.matchEvidence?.decisionReasonCodes ?? []),
      item.selectionSource === 'auto' ? recommendation : undefined,
    );
  }
}

function candidateOfferView(
  offer: StoredCandidateOfferType,
  needed: number,
  usdKrwRate: number | null,
): BomQuoteCandidateOfferType {
  const pick = applyQtyToOffer(storedOfferInput(offer), needed, usdKrwRate);
  return {
    offerKey: offer.offerKey,
    supplier: offer.supplier,
    supplierSku: offer.supplierSku,
    packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging),
    stock: offer.stock,
    moq: offer.moq,
    orderMultiple: offer.orderMultiple,
    productUrl: offer.productUrl,
    fetchedAt: offer.fetchedAt,
    priceBreaks: offer.priceBreaks,
    applied:
      pick === null
        ? null
        : {
            orderQty: pick.orderQty,
            breakQty: pick.breakQty,
            unitPrice: pick.unitPrice,
            currency: pick.currency,
            unitPriceKrw: pick.unitPriceKrw,
            lineTotalKrw: pickLineTotal(pick),
            stockShort: pick.stockShort,
          },
  };
}

function selectionEventDto(row: QuoteSelectionEventRow): BomQuoteSelectionEventType {
  const source = BomQuoteSelectionSource.safeParse(row.source);
  const rawCodes = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
  return {
    id: String(row.id),
    source: source.success ? source.data : 'legacy',
    actorId: row.actorId,
    previousCandidateKey: row.previousCandidateKey,
    selectedCandidateKey: row.selectedCandidateKey,
    previousMpn: row.previousMpn,
    selectedMpn: row.selectedMpn,
    previousOfferKey: row.previousOfferKey,
    selectedOfferKey: row.selectedOfferKey,
    previousLineTotalKrw: row.previousLineTotalKrw === null ? null : Number(row.previousLineTotalKrw),
    selectedLineTotalKrw: row.selectedLineTotalKrw === null ? null : Number(row.selectedLineTotalKrw),
    reasonCodes: rawCodes.flatMap((code) => {
      const parsed = BomQuoteDecisionReason.safeParse(code);
      return parsed.success ? [parsed.data] : [];
    }),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 엔진 재시작과 무관한 DB 후보 비교 응답 — 고객/관리자가 같은 함수를 사용한다. */
export async function getQuoteItemCandidates(
  quoteId: bigint,
  itemId: bigint,
): Promise<BomQuoteItemCandidatesType | null> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId } });
  if (quote === null) return null;
  const [itemRow, candidateRows, eventRows] = await Promise.all([
    prisma.spBomQuoteItem.findFirst({
      where: { id: itemId, quoteId },
      include: {
        analysisComponent: {
          select: {
            id: true,
            engineComponentId: true,
            reviewStatus: true,
            confidence: true,
            payload: true,
          },
        },
      },
    }),
    prisma.spBomQuoteCandidate.findMany({ where: { quoteId, quoteItemId: itemId }, orderBy: { technicalRank: 'asc' } }),
    prisma.spBomQuoteSelectionEvent.findMany({ where: { quoteId, quoteItemId: itemId }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  if (itemRow === null) return null;
  const item = toItemDto(itemRow);
  const needed = neededQty(item.bomQty, quote.setQty, quote.spareQty);
  const stored = candidateRows.flatMap((row) => {
    const parsed = StoredCandidate.safeParse(row.payload);
    return parsed.success ? [parsed.data] : [];
  });
  // 후보 imageUrl 은 검색 당시 스냅샷이므로 도입 전 후보에는 비어 있을 수 있다.
  // 선택 여부와 무관하게 MPN+제조사 정본(없으면 최신 MPN 정본)으로 표시만 보완한다.
  const candidateMpnNorms = uniqueStrings(stored.map((candidate) => normalizeMpn(candidate.mpn))).filter((value) => value !== '');
  const catalogParts = candidateMpnNorms.length === 0
    ? []
    : await prisma.spPart.findMany({
        where: { mpnNorm: { in: candidateMpnNorms } },
        orderBy: { lastSeenAt: 'desc' },
        select: { mpnNorm: true, manufacturerNorm: true, imageUrl: true },
      });
  const catalogImageByExact = new Map<string, string | null>();
  const catalogImageByMpn = new Map<string, string | null>();
  for (const part of catalogParts) {
    catalogImageByExact.set(`${part.mpnNorm}\u0000${part.manufacturerNorm}`, part.imageUrl);
    if (!catalogImageByMpn.has(part.mpnNorm)) catalogImageByMpn.set(part.mpnNorm, part.imageUrl);
  }
  const catalogImageByCandidate = new Map<string, string>();
  for (const candidate of stored) {
    const mpnNorm = normalizeMpn(candidate.mpn);
    if (mpnNorm === '') continue;
    const manufacturerNorm = resolveManufacturer(candidate.manufacturerName).norm;
    const exactKey = `${mpnNorm}\u0000${manufacturerNorm}`;
    const imageUrl = catalogImageByExact.has(exactKey)
      ? (catalogImageByExact.get(exactKey) ?? null)
      : (catalogImageByMpn.get(mpnNorm) ?? null);
    if (imageUrl !== null) catalogImageByCandidate.set(candidate.candidateKey, imageUrl);
  }
  const picks = new Map<string, { pick: OfferPick | null; offerKey: string | null }>();
  for (const candidate of stored) picks.set(candidate.candidateKey, storedCandidatePick(candidate, needed, quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed)));
  const priced = stored
    .map((candidate) => ({ candidate, total: pickLineTotal(picks.get(candidate.candidateKey)?.pick ?? null) }))
    .filter((entry): entry is { candidate: StoredCandidateType; total: number } => entry.total !== null)
    .sort((a, b) => a.total - b.total || a.candidate.technicalRank - b.candidate.technicalRank);
  const priceRanks = new Map(priced.map((entry, index) => [entry.candidate.candidateKey, index + 1]));
  const technicalTop = stored
    .filter((candidate) => candidate.autoEligible)
    .sort((a, b) => a.technicalRank - b.technicalRank)[0] ?? null;
  const technicalTopTotal = technicalTop === null ? null : pickLineTotal(picks.get(technicalTop.candidateKey)?.pick ?? null);
  const currentTotal = item.lineTotalKrw;
  const rate = quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed);
  const candidates: BomQuoteCandidateType[] = stored.map((candidate) => {
    const result = picks.get(candidate.candidateKey) ?? { pick: null, offerKey: null };
    const bestTotal = pickLineTotal(result.pick);
    const savings = bestTotal === null || technicalTopTotal === null ? null : Math.round((technicalTopTotal - bestTotal) * 100) / 100;
    const selected = candidate.candidateKey === item.selectedCandidateKey;
    return {
      candidateKey: candidate.candidateKey,
      technicalRank: candidate.technicalRank,
      priceRank: priceRanks.get(candidate.candidateKey) ?? null,
      status: candidate.status,
      selectionMode: candidate.selectionMode,
      safety: candidate.safety,
      autoEligible: candidate.autoEligible,
      selected,
      recommended: candidate.candidateKey === item.recommendedCandidateKey,
      mpn: candidate.mpn,
      manufacturerName: candidate.manufacturerName,
      description: candidate.description,
      category: candidate.category,
      packageCode: candidate.packageCode,
      lifecycleStatus: candidate.lifecycleStatus,
      datasheetUrl: candidate.datasheetUrl,
      imageUrl: candidate.imageUrl ?? catalogImageByCandidate.get(candidate.candidateKey) ?? null,
      identityConfidence: candidate.identityConfidence,
      specificationConfidence: candidate.specificationConfidence,
      conflicts: candidate.conflicts,
      missingRequirements: candidate.missingRequirements,
      reasons: candidate.reasons,
      corroboratingSuppliers: candidate.corroboratingSuppliers,
      verifiedRequirementCount: candidate.verifiedRequirementCount,
      requiredRequirementCount: candidate.requiredRequirementCount,
      normalizedSpecs: candidate.normalizedSpecs,
      specComparisons: candidate.specComparisons,
      packageComparison: candidate.packageComparison,
      offers: candidate.offers
        .map((offer) => candidateOfferView(offer, needed, rate))
        .sort((a, b) => (a.applied?.lineTotalKrw ?? Number.POSITIVE_INFINITY) - (b.applied?.lineTotalKrw ?? Number.POSITIVE_INFINITY)),
      bestOfferKey: result.offerKey,
      bestLineTotalKrw: bestTotal,
      lineDeltaKrw: bestTotal === null || currentTotal === null ? null : Math.round((bestTotal - currentTotal) * 100) / 100,
      savingsVsTechnicalKrw: savings,
      savingsVsTechnicalRate:
        savings === null || technicalTopTotal === null || technicalTopTotal <= 0 ? null : savings / technicalTopTotal,
    };
  });
  const originalMpnRaw = item.sourceRow?.inputPartNumber;
  const originalValueRaw = item.sourceRow?.valueRaw;
  const originalRowsRaw = item.sourceRow?.sourceRows;
  const originalRefsRaw = item.sourceRow?.referenceDesignators;
  const originalManufacturerRaw = item.sourceRow?.inputManufacturer;
  const originalPackageCodeRaw = item.sourceRow?.packageCode;
  return {
    quoteId: String(quoteId),
    itemId: String(itemRow.id),
    rowIdx: item.rowIdx,
    extraction: toBomExtractionSource(itemRow.analysisComponent),
    originalMpn: typeof originalMpnRaw === 'string' && originalMpnRaw.trim() !== '' ? originalMpnRaw : null,
    originalValue: typeof originalValueRaw === 'string' && originalValueRaw.trim() !== '' ? originalValueRaw : null,
    originalSheetName: item.sourceSheetName,
    originalRows: Array.isArray(originalRowsRaw)
      ? originalRowsRaw.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0)
      : [],
    originalReferenceDesignators: Array.isArray(originalRefsRaw)
      ? originalRefsRaw.filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '').map((ref) => ref.trim())
      : [],
    originalManufacturer:
      typeof originalManufacturerRaw === 'string' && originalManufacturerRaw.trim() !== ''
        ? originalManufacturerRaw
        : null,
    originalPackageCode:
      typeof originalPackageCodeRaw === 'string' && originalPackageCodeRaw.trim() !== ''
        ? originalPackageCodeRaw
        : null,
    bomQty: item.bomQty,
    neededQty: needed,
    currentMpn: item.mpn,
    currentLineTotalKrw: item.lineTotalKrw,
    selectionSource: item.selectionSource,
    selectedCandidateKey: item.selectedCandidateKey,
    selectedOfferKey: item.selectedOffer?.offerKey ?? null,
    recommendedCandidateKey: item.recommendedCandidateKey,
    technicalTopCandidateKey: technicalTop?.candidateKey ?? null,
    technicalTopLineTotalKrw: technicalTopTotal,
    decisionReasonCodes: item.matchEvidence?.decisionReasonCodes ?? [],
    candidates,
    events: eventRows.map(selectionEventDto),
  };
}

export type QuoteCandidateSelectionResult =
  | 'ok'
  | 'quote-not-found'
  | 'item-not-found'
  | 'candidate-not-found'
  | 'candidate-blocked'
  | 'offer-not-found'
  | 'offer-not-priced';

/** 고객 명시 선택 — 후보/오퍼 키만 신뢰하고 가격·합계는 서버 스냅샷에서 재계산한다. */
export async function applyQuoteCandidateSelection(
  quoteId: bigint,
  itemId: bigint,
  candidateKeyValue: string,
  requestedOfferKey: string | null,
  actorId: string,
): Promise<QuoteCandidateSelectionResult> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
  if (quote === null) return 'quote-not-found';
  const itemRow = quote.items.find((row) => row.id === itemId);
  if (itemRow === undefined) return 'item-not-found';
  const candidateRow = await prisma.spBomQuoteCandidate.findUnique({
    where: { quoteItemId_candidateKey: { quoteItemId: itemId, candidateKey: candidateKeyValue } },
  });
  if (candidateRow === null) return 'candidate-not-found';
  const parsed = StoredCandidate.safeParse(candidateRow.payload);
  if (!parsed.success) return 'candidate-not-found';
  const candidate = parsed.data;
  if (candidate.safety === 'blocked') return 'candidate-blocked';
  if (requestedOfferKey !== null && !candidate.offers.some((offer) => offer.offerKey === requestedOfferKey)) {
    return 'offer-not-found';
  }
  const config = await getBomQuoteRuntimeConfig();
  const items = quote.items.map((row) => toItemDto(row));
  const item = items.find((entry) => entry.id === String(itemId));
  if (item === undefined) return 'item-not-found';
  const needed = neededQty(item.bomQty, quote.setQty, quote.spareQty);
  const selected = storedCandidatePick(candidate, needed, config.usdKrwRate, requestedOfferKey);
  if (requestedOfferKey !== null && selected.pick === null) return 'offer-not-priced';
  const technicalTop = await prisma.spBomQuoteCandidate.findFirst({
    where: { quoteId, quoteItemId: itemId, autoEligible: true },
    orderBy: { technicalRank: 'asc' },
  });
  const technicalParsed = technicalTop === null ? null : StoredCandidate.safeParse(technicalTop.payload);
  const technicalPick = technicalParsed?.success === true
    ? storedCandidatePick(technicalParsed.data, needed, config.usdKrwRate).pick
    : null;
  const previous = {
    candidateKey: item.selectedCandidateKey,
    mpn: item.mpn,
    offerKey: item.selectedOffer?.offerKey ?? null,
    lineTotalKrw: item.lineTotalKrw,
  };
  const reasonCodes: BomQuoteDecisionReasonType[] = [
    'customer-choice',
    ...(requestedOfferKey === null ? [] : ['offer-choice'] as const),
  ];
  item.mpn = candidate.mpn;
  item.manufacturerName = candidate.manufacturerName;
  item.description = candidate.description;
  item.partId = await partIdForStoredCandidate(candidate);
  item.matchStatus = 'manual';
  item.selectedCandidateKey = candidate.candidateKey;
  item.selectionSource = 'customer';
  item.selectedOffer = selected.pick === null
    ? null
    : snapshotFromPick(selected.pick, requestedOfferKey !== null, selected.offerKey);
  item.orderQty = selected.pick?.orderQty ?? needed;
  item.matchEvidence = selectedEvidence(
    item.matchEvidence,
    candidate,
    selected.pick,
    needed,
    pickLineTotal(technicalPick),
    reasonCodes,
  );
  const computed = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
  const selectedComputed = computed.items.find((entry) => entry.id === String(itemId));
  await persistQuoteComputed(quoteId, computed, config.usdKrwRate, {
    exchangeRateSnapshot: config.exchangeRateSnapshot,
    selectionEvent: {
      itemId: String(itemId),
      source: 'customer',
      actorId,
      previousCandidateKey: previous.candidateKey,
      selectedCandidateKey: candidate.candidateKey,
      previousMpn: previous.mpn,
      selectedMpn: candidate.mpn,
      previousOfferKey: previous.offerKey,
      selectedOfferKey: selected.offerKey,
      previousLineTotalKrw: previous.lineTotalKrw,
      selectedLineTotalKrw: selectedComputed?.lineTotalKrw ?? null,
      reasonCodes,
    },
  });
  return 'ok';
}

/**
 * 스냅샷 오퍼를 카탈로그 최신 데이터로 갱신 — 오퍼 정체성(공급사+SKU)은 보존하고
 * 가격구간·재고·fetchedAt 만 최신화(pinned 포함 — 고정은 오퍼 선택이지 옛 숫자가 아니다).
 * 원 오퍼가 카탈로그에서 사라졌으면 비고정 라인만 재선정한다. orderQty 는 보존하되
 * 갱신된 MOQ·배수는 재적용(발주 정합).
 */
export async function refreshOfferSnapshots(items: BomQuoteItemInputType[], usdKrwRate: number | null): Promise<void> {
  for (const item of items) {
    if (item.partId === null || item.selectedOffer === null) continue;
    const part = await prisma.spPart.findUnique({
      where: { id: BigInt(item.partId) },
      include: { offers: { include: { priceBreaks: true } } },
    });
    if (part === null) continue;
    const offers = toOfferInputs(part);
    const current = item.selectedOffer;
    const same = offers.find((o) => o.supplier === current.supplier && o.supplierSku === current.supplierSku);
    if (same !== undefined) {
      const pick = applyQtyToOffer(same, Math.max(1, item.orderQty), usdKrwRate);
      if (pick !== null) {
        item.selectedOffer = snapshotFromPick(pick, current.pinned, current.offerKey);
        item.orderQty = pick.orderQty;
        continue;
      }
    }
    // 엔진 후보 선택은 후보 스냅샷이 가격·오퍼의 정본이다. 카탈로그의 다른 오퍼로
    // 조용히 바꾸면 selectedCandidateKey와 실제 오퍼가 어긋나므로 그대로 보존한다.
    if (item.selectedCandidateKey !== null) continue;
    if (!current.pinned) {
      const pick = pickDefaultOffer(offers, Math.max(1, item.orderQty), usdKrwRate);
      if (pick !== null) {
        item.selectedOffer = snapshotFromPick(pick, false);
        item.orderQty = pick.orderQty;
      }
    }
  }
}

/**
 * 자동 보강 완료 후 견적 반영 — draft 한정. 기존 라인은 스냅샷 최신화(정체성 보존),
 * 미매칭 라인은 카탈로그 재매칭으로 채운 뒤 합계 재계산·영속.
 * 동시 호출(폴러 onDone+치유+백업 훅)은 직렬화 — 같은 견적 계산 저장이 겹치지 않게.
 */
const refreshInFlight = new Map<string, Promise<void>>();

export async function refreshQuoteFromCatalog(quoteId: bigint): Promise<void> {
  const key = String(quoteId);
  const inFlight = refreshInFlight.get(key);
  if (inFlight !== undefined) return inFlight;
  const run = refreshQuoteFromCatalogInner(quoteId);
  refreshInFlight.set(key, run);
  try {
    await run;
  } finally {
    refreshInFlight.delete(key);
  }
}

async function refreshQuoteFromCatalogInner(quoteId: bigint): Promise<void> {
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
  if (quote?.status !== 'draft') return;
  const config = await getBomQuoteRuntimeConfig();
  const items = quote.items.map((row) => toItemDto(row));
  await refreshOfferSnapshots(items, config.usdKrwRate);
  await catalogMatchItems(items, quote.setQty, quote.spareQty, config.usdKrwRate, true);
  const result = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
  // 라인과 done을 한 트랜잭션으로 공개 — 어떤 상세 GET도 중간 상태를 볼 수 없다.
  await persistQuoteComputed(quoteId, result, config.usdKrwRate, {
    exchangeRateSnapshot: config.exchangeRateSnapshot,
    enrichStatus: 'done',
    enrichedAt: new Date(),
  });
}

const engineRefreshInFlight = new Map<string, Promise<boolean>>();

/**
 * 검색 완료 결과를 componentId로 견적에 직접 반영한다. 카탈로그 인제스트 이후 호출되어
 * partId도 연결하지만, 매칭 판정과 오퍼 선택의 진실원본은 이 엔진 봉투다.
 */
export async function refreshQuoteFromSupplierResult(quoteId: bigint, envelope: unknown): Promise<boolean> {
  const key = String(quoteId);
  const inFlight = engineRefreshInFlight.get(key);
  if (inFlight !== undefined) return inFlight;
  const run = (async (): Promise<boolean> => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true } });
    if (quote?.status !== 'draft') return false;
    const config = await getBomQuoteRuntimeConfig();
    const items = quote.items.map((row) => toItemDto(row));
    const applied = await applyEngineSupplierResult(items, envelope, quote.setQty, quote.spareQty, config.usdKrwRate);
    if (!applied.applied) return false;
    const result = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quoteId, result, config.usdKrwRate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
      enrichStatus: 'done',
      enrichedAt: new Date(),
      candidateSnapshots: applied.candidateSnapshots,
    });
    return true;
  })();
  engineRefreshInFlight.set(key, run);
  try {
    return await run;
  } finally {
    engineRefreshInFlight.delete(key);
  }
}

/**
 * 잡의 검색 결과가 (백업 훅 등으로) 인제스트된 뒤, 그 잡에 연결된 draft 견적을 재매칭.
 * sp-node 재시작으로 인제스트 폴러(onDone)가 유실됐을 때의 내성 — "카탈로그엔 있는데
 * 견적은 미매칭" 고착 방지. 미매칭 라인이 없으면 건드리지 않는다.
 */
export async function refreshQuotesForJob(jobId: string): Promise<void> {
  const response = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!response.ok) return;
  const envelope: unknown = await response.json();
  const quotes = await prisma.spBomQuote.findMany({
    where: { engineJobId: jobId, status: 'draft' },
    select: { id: true, enrichStatus: true, items: { select: { included: true, matchStatus: true } } },
  });
  for (const quote of quotes) {
    const hasUnmatched = quote.items.some((i) => i.included && i.matchStatus === 'none');
    // searching 은 미매칭이 없어도 최신 엔진 판정·가격을 반영해 done 으로 종결시킨다.
    if (quote.enrichStatus !== 'searching' && !hasUnmatched) continue;
    await refreshQuoteFromSupplierResult(quote.id, envelope);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type QuoteComputedItem<T extends BomQuoteItemInputType = BomQuoteItemInputType> = T & {
  lineTotalKrw: number | null;
};

/** 스냅샷 기준 라인 재계산 — 입력의 안정 ID를 보존하면서 금액만 서버에서 다시 계산한다. */
export function recalcItems<T extends BomQuoteItemInputType>(
  items: T[],
  usdKrwRate: number | null,
): QuoteComputedItem<T>[] {
  return items.map((item) => {
    const offer = item.selectedOffer;
    // partImageUrl·partDatasheetUrl 은 응답 시 toDetailDto 가 카탈로그에서 채운다(여긴 계산 전용)
    if (offer === null) return { ...item, lineTotalKrw: null, partImageUrl: null, partDatasheetUrl: null };
    const orderQty = Math.max(1, item.orderQty);
    const step = pickBreak(offer.priceBreaks, orderQty);
    const unitPrice = step === null ? offer.unitPrice : step.price;
    const breakQty = step === null ? offer.breakQty : step.qty;
    const unitPriceKrw = toKrw(unitPrice, offer.currency, usdKrwRate);
    return {
      ...item,
      orderQty,
      selectedOffer: { ...offer, breakQty, unitPrice, unitPriceKrw },
      lineTotalKrw: unitPriceKrw === null ? null : round2(unitPriceKrw * orderQty),
    };
  });
}

// ── 영속화 ──────────────────────────────────────────────────────────────────

/** 기존 영속 ID를 유지하며 계산 결과를 갱신한다. 최초 build의 신규 행만 INSERT한다. */
export async function replaceQuoteItems(
  quoteId: bigint,
  items: QuoteComputedItem<BomQuoteItemType>[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await persistQuoteItemsInTransaction(tx, quoteId, items);
  });
}

/** 분석 component 조회 조건을 Prisma 실제 필드명으로 고정하는 회귀 방어선. */
export function analysisComponentLookupWhere(
  analysisRunId: bigint,
  engineComponentIds: readonly string[],
): Prisma.SpBomAnalysisComponentWhereInput {
  return {
    analysisRunId,
    engineComponentId: { in: [...engineComponentIds] },
  };
}

async function persistQuoteItemsInTransaction<T extends BomQuoteItemInputType>(
  tx: Prisma.TransactionClient,
  quoteId: bigint,
  items: QuoteComputedItem<T>[],
): Promise<void> {
  if (items.length === 0) return;

  const quote = await tx.spBomQuote.findUnique({
    where: { id: quoteId },
    select: {
      activeAnalysisRunId: true,
      items: { select: { id: true } },
    },
  });
  if (quote === null) throw new Error(`BOM quote ${String(quoteId)} not found`);

  const existingIds = new Set(quote.items.map((item) => String(item.id)));
  const suppliedIds = items.flatMap((item) => {
    const id = 'id' in item && typeof item.id === 'string' ? item.id : null;
    return id === null ? [] : [id];
  });
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    throw new Error(`Duplicate BOM quote item id for quote ${String(quoteId)}`);
  }
  for (const id of suppliedIds) {
    if (!existingIds.has(id)) throw new Error(`BOM quote item ${id} does not belong to quote ${String(quoteId)}`);
  }

  const componentIds = items.flatMap((item) => {
    const source = item.sourceRow;
    const componentId = source !== null && typeof source.componentId === 'string' ? source.componentId : null;
    return componentId === null ? [] : [componentId];
  });
  const analysisComponents = quote.activeAnalysisRunId === null || componentIds.length === 0
    ? []
    : await tx.spBomAnalysisComponent.findMany({
        where: analysisComponentLookupWhere(quote.activeAnalysisRunId, [...new Set(componentIds)]),
        select: { id: true, engineComponentId: true },
      });
  const analysisComponentByEngineId = new Map(
    analysisComponents.map((component) => [component.engineComponentId, component.id] as const),
  );

  const dataFor = (item: QuoteComputedItem<T>) => {
    const source = item.sourceRow;
    const componentId = source !== null && typeof source.componentId === 'string' ? source.componentId : null;
    return {
      quoteId,
      analysisComponentId: componentId === null ? null : (analysisComponentByEngineId.get(componentId) ?? null),
      rowIdx: item.rowIdx,
      included: item.included,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      bomQty: item.bomQty,
      orderQty: item.orderQty,
      matchStatus: item.matchStatus,
      matchEvidence: item.matchEvidence === null ? Prisma.DbNull : (item.matchEvidence as Prisma.InputJsonValue),
      recommendedCandidateKey: item.recommendedCandidateKey,
      selectedCandidateKey: item.selectedCandidateKey,
      selectionSource: item.selectionSource,
      partId: item.partId === null ? null : BigInt(item.partId),
      selectedOffer: item.selectedOffer === null ? Prisma.DbNull : (item.selectedOffer as Prisma.InputJsonValue),
      lineTotalKrw: item.lineTotalKrw,
      sourceRow: item.sourceRow === null ? Prisma.DbNull : (item.sourceRow as Prisma.InputJsonValue),
      sourceSheetIndex: item.sourceSheetIndex,
      sourceSheetName: item.sourceSheetName,
    };
  };

  const creates: Prisma.SpBomQuoteItemCreateManyInput[] = [];
  for (const item of items) {
    const id = 'id' in item && typeof item.id === 'string' ? item.id : null;
    const data = dataFor(item);
    if (id === null) {
      creates.push(data);
      continue;
    }
    const { quoteId: _quoteId, ...updateData } = data;
    void _quoteId;
    const updated = await tx.spBomQuoteItem.updateMany({
      where: { id: BigInt(id), quoteId },
      data: updateData,
    });
    if (updated.count !== 1) throw new Error(`BOM quote item ${id} update lost`);
  }
  if (creates.length > 0) await tx.spBomQuoteItem.createMany({ data: creates });
}

export interface QuoteComputed<T extends BomQuoteItemInputType = BomQuoteItemInputType> {
  items: QuoteComputedItem<T>[];
  itemsTotal: number;
  finalTotal: number;
  uncostedCount: number;
}

export interface QuotePersistenceExtra {
  title?: string;
  setQty?: number;
  spareQty?: number;
  customerMemo?: string | null;
  enrichStatus?: string;
  enrichedAt?: Date | null;
  buildStatus?: string;
  selectedSheetIndexes?: number[];
  candidateSnapshots?: QuoteCandidateSnapshotInput[];
  exchangeRateSnapshot?: BomQuoteExchangeRateSnapshotType | null;
  selectionEvent?: {
    itemId: string;
    source: 'customer' | 'catalog' | 'admin';
    actorId: string | null;
    previousCandidateKey: string | null;
    selectedCandidateKey: string | null;
    previousMpn: string | null;
    selectedMpn: string | null;
    previousOfferKey: string | null;
    selectedOfferKey: string | null;
    previousLineTotalKrw: number | null;
    selectedLineTotalKrw: number | null;
    reasonCodes: BomQuoteDecisionReasonType[];
  };
}

// 후보 payload에는 정규화 스펙·비교 근거·가격구간이 포함된다. 대형 BOM을 한 INSERT로
// 보내면 MariaDB max_allowed_packet을 넘겨 연결이 끊길 수 있어 작은 배치로 나눈다.
const CANDIDATE_INSERT_BATCH_SIZE = 20;

/** 계산 라인과 견적 합계·보강 상태를 한 트랜잭션으로 영속화한다. */
export async function persistQuoteComputed<T extends BomQuoteItemInputType>(
  quoteId: bigint,
  computed: QuoteComputed<T>,
  usdKrwRate: number | null,
  extra?: QuotePersistenceExtra,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await persistQuoteItemsInTransaction(tx, quoteId, computed.items);
    if (extra?.candidateSnapshots !== undefined) {
      await tx.spBomQuoteCandidate.deleteMany({ where: { quoteId } });
      if (extra.candidateSnapshots.length > 0) {
        const snapshotRowIndexes = [...new Set(extra.candidateSnapshots.map((snapshot) => snapshot.rowIdx))];
        const quoteItems = await tx.spBomQuoteItem.findMany({
          where: { quoteId, rowIdx: { in: snapshotRowIndexes } },
          select: { id: true, rowIdx: true },
        });
        const quoteItemIdByRowIdx = new Map(quoteItems.map((item) => [item.rowIdx, item.id] as const));
        const candidateRows = extra.candidateSnapshots.map(({ rowIdx, candidate }) => ({
          quoteId,
          quoteItemId: quoteItemIdByRowIdx.get(rowIdx) ?? (() => {
            throw new Error(`BOM quote candidate row ${String(rowIdx)} has no persisted item`);
          })(),
          candidateKey: candidate.candidateKey,
          technicalRank: candidate.technicalRank,
          status: candidate.status,
          selectionMode: candidate.selectionMode,
          safety: candidate.safety,
          autoEligible: candidate.autoEligible,
          mpn: candidate.mpn,
          manufacturerName: candidate.manufacturerName,
          payload: candidate as Prisma.InputJsonValue,
        }));
        for (let offset = 0; offset < candidateRows.length; offset += CANDIDATE_INSERT_BATCH_SIZE) {
          await tx.spBomQuoteCandidate.createMany({
            data: candidateRows.slice(offset, offset + CANDIDATE_INSERT_BATCH_SIZE),
          });
        }
      }
    }
    if (extra?.selectedSheetIndexes !== undefined) {
      await tx.spBomQuoteSheet.updateMany({ where: { quoteId }, data: { selected: false } });
      await tx.spBomQuoteSheet.updateMany({
        where: { quoteId, sheetIndex: { in: extra.selectedSheetIndexes } },
        data: { selected: true },
      });
    }
    await tx.spBomQuote.update({
      where: { id: quoteId },
      data: {
        itemsTotal: computed.itemsTotal,
        finalTotal: computed.finalTotal,
        uncostedCount: computed.uncostedCount,
        usdKrwRateUsed: usdKrwRate,
        ...(extra?.exchangeRateSnapshot !== undefined
          ? {
              exchangeRateSnapshot: extra.exchangeRateSnapshot === null
                ? Prisma.DbNull
                : (extra.exchangeRateSnapshot as Prisma.InputJsonValue),
            }
          : {}),
        ...(extra?.title !== undefined ? { title: extra.title } : {}),
        ...(extra?.setQty !== undefined ? { setQty: extra.setQty } : {}),
        ...(extra?.spareQty !== undefined ? { spareQty: extra.spareQty } : {}),
        ...(extra?.customerMemo !== undefined ? { customerMemo: extra.customerMemo } : {}),
        ...(extra?.enrichStatus !== undefined ? { enrichStatus: extra.enrichStatus } : {}),
        ...(extra?.enrichedAt !== undefined ? { enrichedAt: extra.enrichedAt } : {}),
        ...(extra?.buildStatus !== undefined ? { buildStatus: extra.buildStatus } : {}),
      },
    });
    if (extra?.selectionEvent !== undefined) {
      const event = extra.selectionEvent;
      await tx.spBomQuoteSelectionEvent.create({
        data: {
          quoteId,
          quoteItemId: BigInt(event.itemId),
          source: event.source,
          actorId: event.actorId,
          previousCandidateKey: event.previousCandidateKey,
          selectedCandidateKey: event.selectedCandidateKey,
          previousMpn: event.previousMpn,
          selectedMpn: event.selectedMpn,
          previousOfferKey: event.previousOfferKey,
          selectedOfferKey: event.selectedOfferKey,
          previousLineTotalKrw: event.previousLineTotalKrw,
          selectedLineTotalKrw: event.selectedLineTotalKrw,
          reasonCodes: event.reasonCodes,
        },
      });
    }
  });
}

/** 라인 재계산 + 합계(운송료·관리비 포함, VAT 별도) — 저장 전 단일 경로. */
export function computeQuote<T extends BomQuoteItemInputType>(
  items: T[],
  usdKrwRate: number | null,
  shippingFee: number,
  managementFee: number,
): QuoteComputed<T> {
  const computed = recalcItems(items, usdKrwRate);
  const totals = computeTotals(
    computed.map((i) => ({ included: i.included, lineTotalKrw: i.lineTotalKrw })),
    shippingFee,
    managementFee,
  );
  return { items: computed, ...totals };
}

// ── DTO 매핑 ────────────────────────────────────────────────────────────────

function legacyCompatibleOffer(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return { offerKey: null, ...value };
}

function legacyCompatibleEvidence(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return {
    identityFallback: false,
    groupedCandidateCount: 0,
    alternativeCandidateCount: 0,
    recommendedCandidateKey: null,
    selectedCandidateKey: null,
    selectedTechnicalRank: null,
    recommendationType: 'none',
    decisionReasonCodes: [],
    verifiedRequirementCount: 0,
    requiredRequirementCount: 0,
    priceEvidence: null,
    ...value,
  };
}

export function toItemDto(row: QuoteItemRow, partImageUrl: string | null = null, partDatasheetUrl: string | null = null): BomQuoteItemType {
  const offer = BomQuoteSelectedOffer.safeParse(legacyCompatibleOffer(row.selectedOffer));
  const evidence = BomQuoteMatchEvidence.safeParse(legacyCompatibleEvidence(row.matchEvidence));
  const selectedOffer = offer.success
    ? { ...offer.data, packaging: normalizeSupplierPackaging(offer.data.supplier, offer.data.packaging) }
    : null;
  return {
    id: String(row.id),
    rowIdx: row.rowIdx,
    included: row.included,
    mpn: row.mpn,
    manufacturerName: row.manufacturerName,
    description: row.description,
    bomQty: row.bomQty,
    orderQty: row.orderQty,
    matchStatus: row.matchStatus as BomQuoteItemType['matchStatus'],
    matchEvidence: evidence.success ? evidence.data : null,
    recommendedCandidateKey: row.recommendedCandidateKey,
    selectedCandidateKey: row.selectedCandidateKey,
    selectionSource: row.selectionSource as BomQuoteSelectionSourceType,
    partId: row.partId === null ? null : String(row.partId),
    selectedOffer,
    sourceSheetIndex: row.sourceSheetIndex,
    sourceSheetName: row.sourceSheetName,
    sourceRow:
      typeof row.sourceRow === 'object' && row.sourceRow !== null && !Array.isArray(row.sourceRow)
        ? (row.sourceRow)
        : null,
    lineTotalKrw: row.lineTotalKrw === null ? null : Number(row.lineTotalKrw),
    partImageUrl,
    partDatasheetUrl,
  };
}

/** 라인 partId → 카탈로그 이미지·데이터시트 일괄 조회 — 스냅샷이 아니라 항상 현재 카탈로그를 따른다. */
async function loadPartMetaMap(items: QuoteItemRow[]): Promise<Map<bigint, { imageUrl: string | null; datasheetUrl: string | null }>> {
  const partIds = [...new Set(items.flatMap((i) => (i.partId === null ? [] : [i.partId])))];
  if (partIds.length === 0) return new Map();
  const parts = await prisma.spPart.findMany({
    where: { id: { in: partIds } },
    select: { id: true, imageUrl: true, datasheetUrl: true },
  });
  return new Map(parts.map((p) => [p.id, { imageUrl: p.imageUrl, datasheetUrl: p.datasheetUrl }] as const));
}

/** 엔진 매칭 라인(partId 없음)용 — 안정 itemId로 후보를 찾고 표시 rowIdx에 투영한다. */
async function loadCandidateDatasheetMap(quoteId: bigint, items: QuoteItemRow[]): Promise<Map<number, string>> {
  const itemIds = items
    .filter((item) => item.partId === null && item.selectedCandidateKey !== null)
    .map((item) => item.id);
  if (itemIds.length === 0) return new Map();
  const selectedKeyByItem = new Map(items.map((item) => [item.id, item.selectedCandidateKey] as const));
  const rowIdxByItem = new Map(items.map((item) => [item.id, item.rowIdx] as const));
  const rows = await prisma.spBomQuoteCandidate.findMany({
    where: { quoteId, quoteItemId: { in: itemIds } },
  });
  const map = new Map<number, string>();
  for (const row of rows) {
    const parsed = StoredCandidate.safeParse(row.payload);
    if (!parsed.success) continue;
    if (parsed.data.candidateKey !== selectedKeyByItem.get(row.quoteItemId)) continue;
    const rowIdx = rowIdxByItem.get(row.quoteItemId);
    if (parsed.data.datasheetUrl !== null && rowIdx !== undefined) map.set(rowIdx, parsed.data.datasheetUrl);
  }
  return map;
}

type SummaryItemRow = Pick<QuoteItemRow, 'included' | 'matchStatus'>;
export interface BomQuoteSummaryCounts {
  itemCount: number;
  includedCount: number;
  matchedCount: number;
}

function summaryCounts(items: SummaryItemRow[]): BomQuoteSummaryCounts {
  return {
    itemCount: items.length,
    includedCount: items.filter((i) => i.included).length,
    matchedCount: items.filter((i) => i.matchStatus !== 'none').length,
  };
}

export function toSummaryDto(quote: QuoteRow, counts: BomQuoteSummaryCounts): BomQuoteSummaryType {
  return {
    id: String(quote.id),
    title: quote.title,
    status: quote.status as BomQuoteStatusType,
    fileName: quote.fileName,
    ...counts,
    finalTotal: quote.finalTotal,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    requestedAt: quote.requestedAt?.toISOString() ?? null,
    answeredAt: quote.answeredAt?.toISOString() ?? null,
  };
}

function toSheetDto(row: QuoteSheetRow): BomQuoteSheetType {
  return {
    sheetIndex: row.sheetIndex,
    sheetName: row.sheetName,
    status: row.status as BomQuoteSheetType['status'],
    componentCount: row.componentCount,
    selected: row.selected,
    failureReason: row.failureReason,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((value): value is string => typeof value === 'string') : [],
  };
}

export async function toDetailDto(quote: QuoteRow, items: QuoteItemRow[], sheets: QuoteSheetRow[] = []): Promise<BomQuoteDetailType> {
  const [partMetaMap, candidateDatasheetMap] = await Promise.all([
    loadPartMetaMap(items),
    loadCandidateDatasheetMap(quote.id, items),
  ]);
  return {
    ...toSummaryDto(quote, summaryCounts(items)),
    engineJobId: quote.engineJobId,
    buildStatus: quote.buildStatus as BomQuoteDetailType['buildStatus'],
    sheets: [...sheets].sort((a, b) => a.sheetIndex - b.sheetIndex).map(toSheetDto),
    enrichStatus: quote.enrichStatus as BomQuoteDetailType['enrichStatus'],
    enrichedAt: quote.enrichedAt?.toISOString() ?? null,
    setQty: quote.setQty,
    spareQty: quote.spareQty,
    itemsTotal: quote.itemsTotal,
    shippingFee: quote.shippingFee,
    managementFee: quote.managementFee,
    finalTotal: quote.finalTotal,
    usdKrwRateUsed: quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed),
    exchangeRateSnapshot: (() => {
      const parsed = BomQuoteExchangeRateSnapshot.safeParse(quote.exchangeRateSnapshot);
      return parsed.success ? parsed.data : null;
    })(),
    uncostedCount: quote.uncostedCount,
    customerMemo: quote.customerMemo,
    confirmedShippingFee: quote.confirmedShippingFee,
    confirmedManagementFee: quote.confirmedManagementFee,
    confirmedTotal: quote.confirmedTotal,
    answerNote: quote.answerNote,
    items: [...items]
      .sort((a, b) => a.rowIdx - b.rowIdx)
      .map((row) => {
        const meta = row.partId === null ? null : (partMetaMap.get(row.partId) ?? null);
        return toItemDto(
          row,
          meta?.imageUrl ?? null,
          meta?.datasheetUrl ?? candidateDatasheetMap.get(row.rowIdx) ?? null,
        );
      }),
  };
}

export function toAdminSummaryDto(quote: QuoteRow, items: SummaryItemRow[]): AdminBomQuoteSummaryType {
  return { ...toSummaryDto(quote, summaryCounts(items)), mbId: quote.mbId };
}

export async function toAdminDetailDto(
  quote: QuoteRow,
  items: QuoteItemRow[],
  sheets: QuoteSheetRow[],
  fileUrl: string | null,
): Promise<AdminBomQuoteDetailType> {
  return { ...(await toDetailDto(quote, items, sheets)), mbId: quote.mbId, adminMemo: quote.adminMemo, fileUrl };
}
