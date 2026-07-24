import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  BomQuoteDecisionReason,
  BomQuoteExchangeRateSnapshot,
  BomQuoteMatchEvidence,
  BomQuoteRequirementAssessment,
  BomQuoteSearchRequirements,
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
  type BomQuotePatchBodyType,
  type BomQuoteRecommendationTypeType,
  type BomQuoteRequirementAssessmentType,
  type BomQuoteSelectionEventType,
  type BomQuoteSelectionSourceType,
  type BomQuoteSearchTraceSummaryType,
  type BomQuoteSearchTraceType,
  type BomQuoteSheetType,
  type BomQuoteSelectedOfferType,
  type BomQuoteStatusType,
  type BomQuoteSummaryType,
  type BomPartHitType,
} from '@sp/api-contract';
import {
  applyQtyToOffer,
  computeTotals,
  neededQty,
  normalizeMpn,
  pickBreak,
  pickDefaultOffer,
  stampOrderQty,
  toKrw,
  type BomOfferInput,
  type OfferPick,
} from '@sp/utils';
import { prisma } from './prisma';
import { engineFetch } from './engine-client';
import { buildEngineProcurementPolicy } from './bom-procurement-policy';
import { resolveManufacturer } from './manufacturer-alias';
import { SAMPLEPCB_SUPPLIER } from './parts-facts';
import { getBomQuoteRuntimeConfig } from './exchange-rate';
import { normalizeSupplierPackaging } from './supplier-packaging';
import { supplierRunLimitedComponentCount } from './bom-supplier-operations';

// 고객 BOM 견적 핵심 로직 — 회원/관리자 라우트가 공유. 설계: docs/BOM_QUOTE.md.
// 원칙: 수량·오퍼는 스냅샷 박제가 단일 진실, 금액은 항상 서버가 스냅샷에서 재계산
// (클라 금액 불신 — 단 스냅샷 단가 자체는 엔진 공급사 검색을 서버가 기록한 값이고,
//  최종 확정가는 관리자 검토가 결정하는 RFQ 모델이라 조작 이득이 없다).

export type QuoteRow = Prisma.SpBomQuoteGetPayload<object>;
export type QuoteItemRow = Prisma.SpBomQuoteItemGetPayload<object>;
export type QuoteSheetRow = Prisma.SpBomQuoteSheetGetPayload<object>;
export type QuoteCandidateRow = Prisma.SpBomQuoteCandidateGetPayload<object>;
export type QuoteSelectionEventRow = Prisma.SpBomQuoteSelectionEventGetPayload<object>;

/**
 * 견적 화면·계산에 활성인 라인만 고른다. 수동 추가 행은 항상 활성이고, 업로드 행은
 * sp_bom_quote_sheet.selected가 단일 진실이다. 시트 스냅샷이 없는 구형 견적은 전 행을
 * 유지해 읽기 호환한다.
 */
export function filterActiveQuoteItems<
  TItem extends { sourceSheetIndex: number | null },
>(items: readonly TItem[], sheets: readonly { sheetIndex: number; selected: boolean }[]): TItem[] {
  if (sheets.length === 0) return [...items];
  const selected = new Set(sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex));
  return items.filter((item) => item.sourceSheetIndex === null || selected.has(item.sourceSheetIndex));
}

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
    procurement_disposition: z.enum(['eligible', 'excluded', 'quantity_confirmation_required']).optional(),
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

const EnginePositiveDecimal = z.coerce.number().positive();

const EngineOfferProcurementDecision = z
  .object({
    procurement_policy_version: z.literal('supplier-procurement-decision-v1'),
    offer_key_version: z.enum(['supplier-offer-key-v1', 'supplier-offer-key-v2']),
    rank_scope: z.literal('identity_and_technical_evidence'),
    offer_key: z.string().regex(/^ok[12]:/).nullable(),
    calculation_status: z.enum(['calculated', 'unavailable', 'supplier_not_allowed']),
    required_quantity: z.number().int().positive().nullish(),
    order_quantity: z.number().int().positive().nullish(),
    applied_price_break_quantity: z.number().int().positive().nullish(),
    source_unit_price: EnginePositiveDecimal.nullish(),
    source_currency: z.string().nullish(),
    exchange_rate: EnginePositiveDecimal.nullish(),
    target_currency: z.string(),
    converted_unit_price: EnginePositiveDecimal.nullish(),
    line_total: EnginePositiveDecimal.nullish(),
    stock_short: z.boolean().nullish(),
    stock_short_quantity: z.number().int().min(0).nullish(),
    surplus_quantity: z.number().int().min(0).nullish(),
    excessive_order: z.boolean().nullish(),
    price_rank: z.number().int().positive().nullish(),
    purchase_fit_rank: z.number().int().positive().nullish(),
    purchasable: z.boolean(),
    recommendation: z.enum(['automatic', 'manual_review', 'none']),
    reason_codes: z.array(z.string()).default([]),
  })
  .passthrough()
  .superRefine((decision, ctx) => {
    const expectedPrefix = decision.offer_key_version === 'supplier-offer-key-v1' ? 'ok1:' : 'ok2:';
    if (decision.offer_key !== null && !decision.offer_key.startsWith(expectedPrefix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offer_key'],
        message: 'offer_key must match offer_key_version',
      });
    }
  });

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
    procurement_decision: EngineOfferProcurementDecision.nullish(),
  })
  .passthrough();

const EngineLegacyCandidateDecision = z
  .object({
    policy_version: z.string(),
    selection_eligibility: z.enum(['automatic', 'manual_review', 'blocked']),
    selection_mode: z.enum(['exact', 'variant', 'spec-compatible', 'review']),
    auto_eligible: z.boolean(),
    manual_selectable: z.boolean(),
    reason_codes: z.array(z.string()).default([]),
    identity_key: z.string(),
    technical_evidence_key: z.string(),
    verified_requirement_count: z.number().int().min(0),
    required_requirement_count: z.number().int().min(0),
    verification_complete: z.boolean(),
    strict_category_coverage: z.boolean(),
    lifecycle_state: z.enum(['active', 'caution', 'unknown']),
  })
  .passthrough();

const EngineRequirementAssessment = z.object({
  key: z.string(),
  comparison: z.enum(['eq', 'gte', 'lte', 'contains', 'category']),
  state: z.enum(['match', 'mismatch', 'missing', 'not_applicable', 'unverified']),
  verified: z.boolean(),
  expected_display: z.string().nullable(),
  actual_display: z.string().nullable(),
});

const EngineCandidateDecisionV1 = z
  .object({
    decision_policy_version: z.string(),
    category_policy_version: z.string(),
    identity_key_version: z.string(),
    evidence_key_version: z.string(),
    selection_recommendation_policy_version: z.string().optional(),
    match_relation: z.enum(['exact', 'variant', 'spec-compatible', 'unresolved']),
    selection_eligibility: z.enum(['automatic', 'manual_review', 'blocked']),
    auto_eligible: z.boolean(),
    manual_selectable: z.boolean(),
    reason_codes: z.array(z.string()).default([]),
    identity_key: z.string(),
    technical_evidence_key: z.string(),
    verified_requirement_count: z.number().int().min(0),
    required_requirement_count: z.number().int().min(0),
    requirement_assessments: z.array(EngineRequirementAssessment).default([]),
    verification_complete: z.boolean(),
    strict_category_coverage: z.boolean(),
    lifecycle_state: z.enum(['active', 'caution', 'unknown']),
    technical_review_rank: z.number().int().min(1).nullish(),
    selection_recommendation: z.enum(['preselect', 'candidate_only', 'exclude']).optional(),
    review_recommended: z.boolean().optional(),
  })
  .passthrough();

const EngineCandidateDecision = z.union([
  EngineCandidateDecisionV1,
  EngineLegacyCandidateDecision,
]);

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
        supplier_product_id: z.string().nullish(),
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
    // 순차 배포 중 이전 엔진 결과도 읽되 자체 규칙으로 복원하지 않고 차단한다.
    decision: EngineCandidateDecision.nullish(),
  })
  .passthrough();

const EngineSupplierQuery = z
  .object({
    mode: z.string(),
    part_number: z.string().nullish(),
  })
  .passthrough();

const EngineSupplierSearchTraceAttempt = z.object({
  sequence: z.number().int().min(1),
  stage: z.enum(['primary', 'identity_fallback']),
  supplier: z.string(),
  strategy: z.string(),
  query: z.string(),
  source: z.enum([
    'live_api',
    'fresh_cache',
    'stale_cache',
    'coalesced',
    'prefetch_cache',
    'batch_reuse',
    'not_executed',
  ]),
  outcome: z.enum(['results', 'empty', 'error', 'skipped', 'budget_exhausted']),
  result_count: z.number().int().min(0),
  api_calls: z.number().int().min(0),
  http_attempt_count: z.number().int().min(0),
  elapsed_ms: z.number().min(0),
  fallback_reason: z.string().nullish(),
  error_type: z.string().nullish(),
});

const EngineSupplierSearchTrace = z.object({
  version: z.literal('supplier-search-trace-v1'),
  primary_query: z.string(),
  fallback_query: z.string().nullish(),
  fallback_used: z.boolean(),
  attempts: z.array(EngineSupplierSearchTraceAttempt),
});

const EngineProcurementUnavailabilityReason = z.enum([
  'out_of_stock',
  'insufficient_stock',
  'stock_unverified',
  'price_unavailable',
  'technical_unavailable',
  'supplier_unavailable',
  'no_offer',
  'input_incomplete',
  'other',
]);
type EngineProcurementUnavailabilityReasonType = z.infer<
  typeof EngineProcurementUnavailabilityReason
>;

const EngineComponentProcurementDecisionV1 = z
  .object({
    procurement_policy_version: z.literal('supplier-procurement-decision-v1'),
    selection_application_policy_version: z.literal('supplier-selection-application-v1'),
    status: z.enum([
      'automatic_recommended',
      'review_recommended',
      'no_recommendation',
      'input_incomplete',
    ]),
    selection_application_state: z.enum([
      'automatic_selected',
      'provisional_selected',
      'not_selected',
    ]),
    confirmation_required: z.boolean(),
    unavailability_reason_policy_version: z
      .literal('supplier-procurement-unavailability-v1')
      .optional(),
    primary_unavailability_reason: EngineProcurementUnavailabilityReason.nullish(),
    required_quantity: z.number().int().positive().nullish(),
    target_currency: z.string(),
    currency_rate_snapshot_id: z.string().min(1),
    currency_rate_as_of: z.string().datetime({ offset: true }),
    currency_rate_source: z.string().min(1),
    technical_preselection_identity_key: z.string().startsWith('ik1:').nullish(),
    technical_preselection_evidence_key: z.string().startsWith('ek1:').nullish(),
    automatic_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    review_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    recommendation_reason_codes: z.array(z.string()).default([]),
  })
  .passthrough();

const EngineComponentProcurementDecisionV2 = z
  .object({
    procurement_policy_version: z.literal('supplier-procurement-decision-v1'),
    selection_application_policy_version: z.literal('supplier-selection-application-v2'),
    status: z.enum([
      'automatic_recommended',
      'review_recommended',
      'no_recommendation',
      'input_incomplete',
    ]),
    selection_application_state: z.enum([
      'automatic_selected',
      'provisional_selected',
      'not_selected',
    ]),
    confirmation_required: z.boolean(),
    unavailability_reason_policy_version: z
      .literal('supplier-procurement-unavailability-v1')
      .optional(),
    primary_unavailability_reason: EngineProcurementUnavailabilityReason.nullish(),
    required_quantity: z.number().int().positive().nullish(),
    target_currency: z.string(),
    currency_rate_snapshot_id: z.string().min(1),
    currency_rate_as_of: z.string().datetime({ offset: true }),
    currency_rate_source: z.string().min(1),
    technical_preselection_identity_key: z.string().startsWith('ik1:').nullish(),
    technical_preselection_evidence_key: z.string().startsWith('ek1:').nullish(),
    application_candidate_identity_key: z.string().startsWith('ik1:').nullish(),
    application_candidate_evidence_key: z.string().startsWith('ek1:').nullish(),
    technical_fallback_used: z.boolean(),
    automatic_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    review_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    recommendation_reason_codes: z.array(z.string()).default([]),
  })
  .passthrough();

const EngineComponentProcurementDecisionV3 = z
  .object({
    procurement_policy_version: z.literal('supplier-procurement-decision-v1'),
    selection_application_policy_version: z.literal('supplier-selection-application-v3'),
    status: z.enum([
      'automatic_recommended',
      'review_recommended',
      'no_recommendation',
      'input_incomplete',
    ]),
    selection_application_state: z.enum([
      'automatic_selected',
      'provisional_selected',
      'not_selected',
    ]),
    confirmation_required: z.boolean(),
    unavailability_reason_policy_version: z
      .literal('supplier-procurement-unavailability-v1')
      .optional(),
    primary_unavailability_reason: EngineProcurementUnavailabilityReason.nullish(),
    required_quantity: z.number().int().positive().nullish(),
    target_currency: z.string(),
    currency_rate_snapshot_id: z.string().min(1),
    currency_rate_as_of: z.string().datetime({ offset: true }),
    currency_rate_source: z.string().min(1),
    technical_preselection_identity_key: z.string().startsWith('ik1:').nullish(),
    technical_preselection_evidence_key: z.string().startsWith('ek1:').nullish(),
    application_candidate_identity_key: z.string().startsWith('ik1:').nullish(),
    application_candidate_evidence_key: z.string().startsWith('ek1:').nullish(),
    technical_fallback_used: z.boolean(),
    price_optimization_used: z.boolean(),
    automatic_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    review_offer_key: z.string().regex(/^ok[12]:/).nullish(),
    recommendation_reason_codes: z.array(z.string()).default([]),
  })
  .passthrough();

const EngineComponentProcurementDecision = z.discriminatedUnion(
  'selection_application_policy_version',
  [
    EngineComponentProcurementDecisionV1,
    EngineComponentProcurementDecisionV2,
    EngineComponentProcurementDecisionV3,
  ],
);

const EngineSupplierComponent = z
  .object({
    component_id: z.string(),
    mode: z.string().optional(),
    status: z.string(),
    procurement_disposition: z.enum(['eligible', 'excluded', 'quantity_confirmation_required']).default('eligible'),
    quantity_resolution: z.enum(['verified', 'conflict', 'missing']).default('verified'),
    disposition_reason_codes: z.array(z.string()).default([]),
    query: EngineSupplierQuery.nullish(),
    initial_query: EngineSupplierQuery.nullish(),
    identity_fallback: z.boolean().default(false),
    // trace는 관측 전용이다. 엔진이 enum을 확장해도 후보·조달 계약 파싱을 막지 않도록
    // component 본체와 분리해 아래에서 독립적으로 검증한다.
    search_trace: z.unknown().nullish(),
    candidates: z.array(EngineSupplierCandidate).default([]),
    procurement_decision: EngineComponentProcurementDecision.nullish(),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();

const EngineSupplierEnvelope = z
  .object({
    supplier_search_schema_version: z.string().optional(),
    procurement_decision_contract_status: z.string().optional(),
    search: z
      .object({
        search_schema_version: z.string().optional(),
        components: z.array(EngineSupplierComponent).default([]),
        api_calls: z.number().int().min(0).default(0),
        cache_hits: z.number().int().min(0).default(0),
      })
      .passthrough(),
  })
  .passthrough();

// 벌크 재평가 응답 — 컴포넌트별로 ok/error 가 격리되어 온다(한 컴포넌트 실패가 배치 전체를
// 실패시키지 않는다). requested_offer 는 Node 선정 경로가 쓰지 않아 느슨하게 통과시킨다.
const EngineProcurementReevaluationBatchItem = z.discriminatedUnion('status', [
  z
    .object({
      component_id: z.string(),
      status: z.literal('ok'),
      candidates: z.array(EngineSupplierCandidate),
      procurement_decision: EngineComponentProcurementDecision,
    })
    .passthrough(),
  z
    .object({
      component_id: z.string(),
      status: z.literal('error'),
      error_code: z.string().nullish(),
    })
    .passthrough(),
]);

const EngineProcurementReevaluationBatchResponse = z
  .object({
    components: z.array(EngineProcurementReevaluationBatchItem),
  })
  .passthrough();

type EngineSupplierCandidateType = z.infer<typeof EngineSupplierCandidate>;
type EngineSupplierComponentType = z.infer<typeof EngineSupplierComponent>;
type EngineCandidateDecisionType = z.infer<typeof EngineCandidateDecision>;
type EngineSupplierSearchTraceType = z.infer<typeof EngineSupplierSearchTrace>;

interface ParsedEngineSearchTrace {
  trace: EngineSupplierSearchTraceType | null;
  issues: { code: string; path: string }[];
}

function parseEngineSearchTrace(value: unknown): ParsedEngineSearchTrace {
  if (value === null || value === undefined) return { trace: null, issues: [] };
  const parsed = EngineSupplierSearchTrace.safeParse(value);
  if (parsed.success) return { trace: parsed.data, issues: [] };
  return {
    trace: null,
    issues: parsed.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join('.'),
    })),
  };
}

function quoteSearchTrace(trace: EngineSupplierSearchTraceType): BomQuoteSearchTraceType {
  return {
    version: trace.version,
    primaryQuery: trace.primary_query,
    fallbackQuery: trace.fallback_query ?? null,
    fallbackUsed: trace.fallback_used,
    attemptCount: trace.attempts.length,
    attempts: trace.attempts.map((attempt) => ({
      sequence: attempt.sequence,
      stage: attempt.stage,
      supplier: attempt.supplier,
      strategy: attempt.strategy,
      query: attempt.query,
      source: attempt.source,
      outcome: attempt.outcome,
      resultCount: attempt.result_count,
      apiCalls: attempt.api_calls,
      httpAttemptCount: attempt.http_attempt_count,
      elapsedMs: attempt.elapsed_ms,
      fallbackReason: attempt.fallback_reason ?? null,
      errorType: attempt.error_type ?? null,
    })),
  };
}

function searchTraceSummary(trace: EngineSupplierSearchTraceType | null | undefined): BomQuoteSearchTraceSummaryType | null {
  if (trace === null || trace === undefined) return null;
  const projected = quoteSearchTrace(trace);
  return {
    version: projected.version,
    primaryQuery: projected.primaryQuery,
    fallbackQuery: projected.fallbackQuery,
    fallbackUsed: projected.fallbackUsed,
    attemptCount: projected.attemptCount,
  };
}

export const BOM_ENGINE_SELECTION_POLICY_VERSION = 'engine-procurement-projection-v12';
const SUPPORTED_ENGINE_CANDIDATE_POLICY_VERSIONS: ReadonlySet<string> = new Set([
  'supplier-candidate-decision-v1',
  'supplier-candidate-decision-v2',
  'supplier-candidate-decision-v3',
]);
const SUPPORTED_ENGINE_LEGACY_CANDIDATE_POLICY_VERSION = 'supplier-candidate-decision-v1';
const SUPPORTED_ENGINE_CATEGORY_POLICY_VERSION = 'candidate-category-policy-v1';
const SUPPORTED_ENGINE_IDENTITY_KEY_VERSION = 'candidate-identity-key-v1';
const SUPPORTED_ENGINE_EVIDENCE_KEY_VERSION = 'candidate-evidence-key-v1';
const SUPPORTED_ENGINE_SELECTION_RECOMMENDATION_POLICY_VERSION = 'candidate-selection-recommendation-v1';

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
    hasItems: false,
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
      included: c.procurement_disposition !== 'excluded',
      mpn: mpn.slice(0, 191),
      manufacturerName: c.manufacturer?.trim().slice(0, 191) ?? null,
      description: c.description?.trim().slice(0, 1000) ?? null,
      bomQty: Math.max(1, c.quantity ?? 1),
      orderQty: 0, // 매칭 전 — 세트·여분을 반영한 필요수량은 sp-node가 채운다
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

// ── 공급사 오퍼 변환 + 재계산 ───────────────────────────────────────────────

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

type SelectionMode = BomQuoteMatchEvidenceType['selectionMode'];

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
  procurementDecision: EngineOfferProcurementDecision.nullable().catch(null),
});

const StoredCandidate = z.object({
  candidateKey: z.string(),
  identityKey: z.string().catch(''),
  technicalRank: z.number().int().positive(),
  technicalReviewRank: z.number().int().positive().nullable().catch(null),
  selectionRecommendation: z.enum(['preselect', 'candidate_only', 'exclude']).nullable().catch(null),
  reviewRecommended: z.boolean().catch(false),
  status: z.string(),
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review']),
  safety: z.enum(['safe', 'caution', 'blocked']),
  selectionEligibility: z.enum(['automatic', 'manual_review', 'blocked']).catch('blocked'),
  autoEligible: z.boolean(),
  manualSelectable: z.boolean().catch(false),
  selectionReasonCodes: z.array(z.string()).catch([]),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycleStatus: z.string().nullable(),
  lifecycleState: z.enum(['active', 'caution', 'unknown']).catch('unknown'),
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
  requirementAssessments: z.array(BomQuoteRequirementAssessment).catch([]),
  verificationComplete: z.boolean().catch(false),
  strictCategoryCoverage: z.boolean().catch(false),
  technicalEvidenceKey: z.string().catch(''),
  normalizedSpecs: z.record(z.string(), z.unknown()),
  specComparisons: z.record(z.string(), z.unknown()),
  packageComparison: z.record(z.string(), z.unknown()).nullable(),
  offers: z.array(StoredCandidateOffer),
  procurementDecision: EngineComponentProcurementDecision.nullable().catch(null),
  engineCandidates: z.array(EngineSupplierCandidate).catch([]),
  procurementDisposition: z.enum(['eligible', 'excluded', 'quantity_confirmation_required']).catch('eligible'),
  quantityResolution: z.enum(['verified', 'conflict', 'missing']).catch('verified'),
  dispositionReasonCodes: z.array(z.string()).catch([]),
});

type StoredCandidateType = z.infer<typeof StoredCandidate>;
type StoredCandidateOfferType = z.infer<typeof StoredCandidateOffer>;
const MAX_STORED_CANDIDATES_PER_ITEM = 15;

type StoredCandidateIdentity = Pick<StoredCandidateType, 'mpn' | 'manufacturerName'>;

interface NormalizedStoredCandidateIdentity {
  mpnNorm: string;
  manufacturerNorm: string;
}

function normalizedStoredCandidateIdentity(
  candidate: StoredCandidateIdentity,
): NormalizedStoredCandidateIdentity | null {
  const mpnNorm = normalizeMpn(candidate.mpn);
  if (mpnNorm === '') return null;
  return { mpnNorm, manufacturerNorm: resolveManufacturer(candidate.manufacturerName).norm };
}

function resolvedStoredCandidatePart<T>(
  identity: NormalizedStoredCandidateIdentity,
  exact: T | null | undefined,
  byMpn: T | null | undefined,
): T | null {
  return exact ?? (identity.manufacturerNorm === 'unknown' ? (byMpn ?? null) : null);
}

/** 영속 후보는 기술 순위 상위 15개로 제한하되 현재·추천 후보는 상한 안에서 보존한다. */
export function retainQuoteCandidateSnapshots(
  snapshots: readonly StoredCandidateType[],
  preserveCandidateKeys: readonly (string | null | undefined)[] = [],
): StoredCandidateType[] {
  const ordered = [...snapshots].sort((left, right) => left.technicalRank - right.technicalRank);
  if (ordered.length <= MAX_STORED_CANDIDATES_PER_ITEM) return ordered;

  const preserveKeys = new Set(
    preserveCandidateKeys.filter((key): key is string => typeof key === 'string' && key !== ''),
  );
  const preserved = ordered
    .filter((candidate) => preserveKeys.has(candidate.candidateKey))
    .slice(0, MAX_STORED_CANDIDATES_PER_ITEM);
  const retainedKeys = new Set(preserved.map((candidate) => candidate.candidateKey));
  const remaining = ordered
    .filter((candidate) => !retainedKeys.has(candidate.candidateKey))
    .slice(0, MAX_STORED_CANDIDATES_PER_ITEM - preserved.length);
  return [...preserved, ...remaining]
    .sort((left, right) => left.technicalRank - right.technicalRank);
}

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
      technicalReviewRank: candidate.technicalReviewRank,
      selectionRecommendation: candidate.selectionRecommendation,
      reviewRecommended: candidate.reviewRecommended,
      status: candidate.status,
      safety: candidate.safety,
      selectionEligibility: candidate.selectionEligibility,
      manualSelectable: candidate.manualSelectable,
      selectionReasonCodes: candidate.selectionReasonCodes,
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
      requirementAssessments: candidate.requirementAssessments,
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
        priceRank: offer.procurementDecision?.price_rank ?? null,
        purchaseFitRank: offer.procurementDecision?.purchase_fit_rank ?? null,
        purchasable: offer.procurementDecision?.purchasable ?? false,
        recommendation: offer.procurementDecision?.recommendation ?? 'none',
        decisionReasonCodes: offer.procurementDecision?.reason_codes ?? [],
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
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: { id: true, sheets: { select: { sheetIndex: true, selected: true } } },
  });
  if (quote === null) return null;
  const search = query.search?.trim() ?? '';
  const selectedSheetIndexes = quote.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.sheetIndex);
  const activeWhere: Prisma.SpBomQuoteItemWhereInput = quote.sheets.length === 0
    ? {}
    : {
        OR: [
          { sourceSheetIndex: null },
          { sourceSheetIndex: { in: selectedSheetIndexes } },
        ],
      };
  const itemRows = await prisma.spBomQuoteItem.findMany({
    where: {
      quoteId,
      ...activeWhere,
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

interface NormalizedEngineCandidateDecision {
  policyVersion: string;
  selectionEligibility: 'automatic' | 'manual_review' | 'blocked';
  selectionMode: 'exact' | 'variant' | 'spec-compatible' | 'review';
  autoEligible: boolean;
  manualSelectable: boolean;
  reasonCodes: string[];
  identityKey: string;
  technicalEvidenceKey: string;
  verifiedRequirementCount: number;
  requiredRequirementCount: number;
  requirementAssessments: BomQuoteRequirementAssessmentType[];
  verificationComplete: boolean;
  strictCategoryCoverage: boolean;
  lifecycleState: 'active' | 'caution' | 'unknown';
  technicalReviewRank: number | null;
  selectionRecommendation: 'preselect' | 'candidate_only' | 'exclude' | null;
  reviewRecommended: boolean;
}

function normalizeEngineDecision(
  decision: EngineCandidateDecisionType | null | undefined,
): NormalizedEngineCandidateDecision | null {
  if (decision === null || decision === undefined) return null;
  const expectedPermissions = {
    automatic: { autoEligible: true, manualSelectable: true },
    manual_review: { autoEligible: false, manualSelectable: true },
    blocked: { autoEligible: false, manualSelectable: false },
  } as const;
  const expected = expectedPermissions[decision.selection_eligibility];
  if (
    decision.auto_eligible !== expected.autoEligible
    || decision.manual_selectable !== expected.manualSelectable
    || decision.identity_key.trim() === ''
    || decision.technical_evidence_key.trim() === ''
  ) return null;

  const current = EngineCandidateDecisionV1.safeParse(decision);
  if (current.success) {
    const currentDecision = current.data;
    const recommendationFields = [
      currentDecision.selection_recommendation_policy_version,
      currentDecision.selection_recommendation,
      currentDecision.review_recommended,
    ];
    const hasRecommendationContract = recommendationFields.every((value) => value !== undefined);
    const hasPartialRecommendationContract = recommendationFields.some((value) => value !== undefined)
      && !hasRecommendationContract;
    const recommendation = hasRecommendationContract
      ? currentDecision.selection_recommendation ?? null
      : null;
    const reviewRecommended = hasRecommendationContract
      ? currentDecision.review_recommended === true
      : false;
    if (
      !SUPPORTED_ENGINE_CANDIDATE_POLICY_VERSIONS.has(currentDecision.decision_policy_version)
      || currentDecision.category_policy_version !== SUPPORTED_ENGINE_CATEGORY_POLICY_VERSION
      || currentDecision.identity_key_version !== SUPPORTED_ENGINE_IDENTITY_KEY_VERSION
      || currentDecision.evidence_key_version !== SUPPORTED_ENGINE_EVIDENCE_KEY_VERSION
      || (currentDecision.selection_eligibility === 'automatic' && currentDecision.match_relation === 'unresolved')
      || (currentDecision.technical_review_rank != null && currentDecision.selection_eligibility !== 'manual_review')
      || !currentDecision.identity_key.startsWith('ik1:')
      || !currentDecision.technical_evidence_key.startsWith('ek1:')
      || hasPartialRecommendationContract
      || (hasRecommendationContract
        && currentDecision.selection_recommendation_policy_version
          !== SUPPORTED_ENGINE_SELECTION_RECOMMENDATION_POLICY_VERSION)
      || (recommendation === 'exclude' && currentDecision.selection_eligibility !== 'blocked')
      || (currentDecision.selection_eligibility === 'blocked' && recommendation !== 'exclude')
      || (recommendation === 'preselect' && !currentDecision.manual_selectable)
      || reviewRecommended !== (
        recommendation === 'preselect'
        && currentDecision.selection_eligibility === 'manual_review'
      )
    ) return null;
    return {
      policyVersion: currentDecision.decision_policy_version,
      selectionEligibility: currentDecision.selection_eligibility,
      selectionMode: currentDecision.match_relation === 'unresolved' ? 'review' : currentDecision.match_relation,
      autoEligible: currentDecision.auto_eligible,
      manualSelectable: currentDecision.manual_selectable,
      reasonCodes: currentDecision.reason_codes,
      identityKey: currentDecision.identity_key.trim(),
      technicalEvidenceKey: currentDecision.technical_evidence_key.trim(),
      verifiedRequirementCount: currentDecision.verified_requirement_count,
      requiredRequirementCount: currentDecision.required_requirement_count,
      requirementAssessments: currentDecision.requirement_assessments.map((assessment) => ({
        key: assessment.key,
        comparison: assessment.comparison,
        state: assessment.state,
        verified: assessment.verified,
        expectedDisplay: assessment.expected_display,
        actualDisplay: assessment.actual_display,
      })),
      verificationComplete: currentDecision.verification_complete,
      strictCategoryCoverage: currentDecision.strict_category_coverage,
      lifecycleState: currentDecision.lifecycle_state,
      technicalReviewRank: currentDecision.technical_review_rank ?? null,
      selectionRecommendation: recommendation,
      reviewRecommended,
    };
  }

  const legacy = EngineLegacyCandidateDecision.safeParse(decision);
  if (
    !legacy.success
    || legacy.data.policy_version !== SUPPORTED_ENGINE_LEGACY_CANDIDATE_POLICY_VERSION
  ) return null;
  const legacyDecision = legacy.data;
  return {
    policyVersion: legacyDecision.policy_version,
    selectionEligibility: legacyDecision.selection_eligibility,
    selectionMode: legacyDecision.selection_mode,
    autoEligible: legacyDecision.auto_eligible,
    manualSelectable: legacyDecision.manual_selectable,
    reasonCodes: legacyDecision.reason_codes,
    identityKey: legacyDecision.identity_key.trim(),
    technicalEvidenceKey: legacyDecision.technical_evidence_key.trim(),
    verifiedRequirementCount: legacyDecision.verified_requirement_count,
    requiredRequirementCount: legacyDecision.required_requirement_count,
    requirementAssessments: [],
    verificationComplete: legacyDecision.verification_complete,
    strictCategoryCoverage: legacyDecision.strict_category_coverage,
    lifecycleState: legacyDecision.lifecycle_state,
    technicalReviewRank: null,
    selectionRecommendation: null,
    reviewRecommended: false,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
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

function buildCandidateGroups(
  component: EngineSupplierComponentType,
  useProcurementContract: boolean,
): CandidateGroup[] {
  const grouped = new Map<string, EngineSupplierCandidateType[]>();
  component.candidates.forEach((candidate, index) => {
    if (candidate.product.manufacturer_part_number.trim() === '') return;
    // 그룹 정체성은 엔진 결정만 사용한다. 결정이 없는 이전/손상 결과는 서로 합치지 않는다.
    const candidateDecision = normalizeEngineDecision(candidate.decision);
    const engineIdentityKey = candidateDecision?.identityKey ?? '';
    const technicalEvidenceKey = candidateDecision?.technicalEvidenceKey ?? '';
    const groupKey = engineIdentityKey === ''
      ? `untrusted:${component.component_id}:${String(index)}`
      : useProcurementContract
        ? `${engineIdentityKey}\0${technicalEvidenceKey}`
        : engineIdentityKey;
    const members = grouped.get(groupKey);
    if (members === undefined) grouped.set(groupKey, [candidate]);
    else members.push(candidate);
  });

  const identityOccurrences = new Map<string, number>();
  for (const members of grouped.values()) {
    const identityKey = normalizeEngineDecision(members[0]?.decision)?.identityKey ?? '';
    identityOccurrences.set(identityKey, (identityOccurrences.get(identityKey) ?? 0) + 1);
  }

  return [...grouped.entries()].map(([groupKey, members], index) => {
    const representative = members[0];
    if (representative === undefined) throw new Error('BOM candidate group invariant');
    const decision = normalizeEngineDecision(representative.decision);
    const technicalEvidenceKey = decision?.technicalEvidenceKey ?? '';
    // 같은 identity_key라도 공급사별 스펙 근거가 다를 수 있다. 엔진이 가격·재고
    // 비교를 허용한 동일 technical_evidence_key 행의 오퍼만 한 후보에 합친다.
    const evidenceMembers = decision === null || technicalEvidenceKey === ''
      ? [representative]
      : members.filter((member) => {
        const memberDecision = normalizeEngineDecision(member.decision);
        return memberDecision?.policyVersion === decision.policyVersion
          && memberDecision.technicalEvidenceKey === technicalEvidenceKey
          && memberDecision.selectionEligibility === decision.selectionEligibility
          && memberDecision.selectionMode === decision.selectionMode
          && memberDecision.autoEligible === decision.autoEligible
          && memberDecision.manualSelectable === decision.manualSelectable
          && memberDecision.selectionRecommendation === decision.selectionRecommendation
          && memberDecision.reviewRecommended === decision.reviewRecommended;
      });
    const engineCandidateKey = decision?.identityKey ?? '';
    const candidateKey = engineCandidateKey === ''
      ? createHash('sha256').update(groupKey).digest('hex').slice(0, 32)
      : useProcurementContract && (identityOccurrences.get(engineCandidateKey) ?? 0) > 1
        ? createHash('sha256')
          .update(`${engineCandidateKey}\0${technicalEvidenceKey}`)
          .digest('hex')
          .slice(0, 32)
        : engineCandidateKey;
    const offers: StoredCandidateOfferType[] = [];
    const offerInputs = new Map<string, BomOfferInput>();
    const seenOffers = new Set<string>();
    for (const member of evidenceMembers) {
      for (const offer of member.product.offers) {
        const engineOfferKey = offer.procurement_decision?.offer_key;
        const key = useProcurementContract && engineOfferKey !== null && engineOfferKey !== undefined
          ? engineOfferKey
          : offerKey(candidateKey, offer);
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
          procurementDecision: offer.procurement_decision ?? null,
        });
      }
    }
    const metadataMember = evidenceMembers.find((member) => Object.keys(member.product.attributes).length > 0)
      ?? representative;
    const selectionEligibility = decision?.selectionEligibility ?? 'blocked';
    const autoEligible = selectionEligibility === 'automatic' && decision?.autoEligible === true;
    const manualSelectable = selectionEligibility !== 'blocked' && decision?.manualSelectable === true;
    const safety: BomQuoteCandidateSafetyType = selectionEligibility === 'blocked'
      ? 'blocked'
      : selectionEligibility === 'manual_review' || decision?.lifecycleState === 'caution'
        ? 'caution'
        : 'safe';
    const corroborating = new Set<string>();
    for (const member of evidenceMembers) {
      corroborating.add(member.product.supplier);
    }
    return {
      representative,
      offerInputs,
      snapshot: {
        candidateKey,
        identityKey: decision?.identityKey ?? '',
        technicalRank: index + 1,
        technicalReviewRank: decision?.technicalReviewRank ?? null,
        selectionRecommendation: decision?.selectionRecommendation ?? null,
        reviewRecommended: decision?.reviewRecommended ?? false,
        status: representative.status,
        selectionMode: decision?.selectionMode ?? 'review',
        safety,
        selectionEligibility,
        autoEligible,
        manualSelectable,
        selectionReasonCodes: decision?.reasonCodes ?? ['decision_unavailable'],
        mpn: representative.product.manufacturer_part_number.trim().slice(0, 191),
        manufacturerName: metadataMember.product.manufacturer?.trim().slice(0, 191) ?? null,
        description: metadataMember.product.description?.trim().slice(0, 1000) ?? null,
        category: metadataMember.product.category?.trim().slice(0, 191) ?? null,
        packageCode: metadataMember.product.package?.trim().slice(0, 64) ?? null,
        lifecycleStatus: representative.product.lifecycle_status?.trim().slice(0, 64) ?? null,
        lifecycleState: decision?.lifecycleState ?? 'unknown',
        datasheetUrl: metadataMember.product.datasheet_url?.trim().slice(0, 500) ?? null,
        imageUrl: metadataMember.product.image_url?.trim().slice(0, 500) ?? null,
        identityConfidence: representative.identity_confidence,
        specificationConfidence: representative.specification_confidence,
        conflicts: representative.conflicts,
        missingRequirements: representative.missing_requirements,
        reasons: representative.reasons,
        corroboratingSuppliers: [...corroborating].sort(),
        verifiedRequirementCount: decision?.verifiedRequirementCount ?? 0,
        requiredRequirementCount: decision?.requiredRequirementCount ?? 0,
        requirementAssessments: decision?.requirementAssessments ?? [],
        verificationComplete: decision?.verificationComplete ?? false,
        strictCategoryCoverage: decision?.strictCategoryCoverage ?? false,
        technicalEvidenceKey,
        normalizedSpecs: metadataMember.product.normalized_specs,
        specComparisons: representative.spec_comparisons,
        packageComparison: representative.package_comparison ?? null,
        offers,
        procurementDecision: component.procurement_decision ?? null,
        engineCandidates: evidenceMembers,
        procurementDisposition: component.procurement_disposition,
        quantityResolution: component.quantity_resolution,
        dispositionReasonCodes: component.disposition_reason_codes,
      },
    };
  });
}

interface EngineProcurementProjection {
  valid: boolean;
  technicalTop: CandidateGroup | null;
  selected: CandidateGroup | null;
  recommended: CandidateGroup | null;
  offerKey: string | null;
  pick: OfferPick | null;
  applicationState: 'automatic_selected' | 'provisional_selected' | 'not_selected';
  confirmationRequired: boolean;
  technicalFallbackUsed: boolean;
  priceOptimizationUsed: boolean;
  primaryUnavailabilityReason: EngineProcurementUnavailabilityReasonType | null;
}

function storedEngineDecisionPick(
  storedOffer: StoredCandidateOfferType,
  needed: number,
  options: {
    recommendation?: 'automatic' | 'manual_review' | 'none';
    requireTop: boolean;
    requirePurchasable: boolean;
  },
): OfferPick | null {
  const decision = storedOffer.procurementDecision;
  if (
    decision?.offer_key !== storedOffer.offerKey
    || decision.calculation_status !== 'calculated'
    || decision.required_quantity !== needed
    || decision.order_quantity === null
    || decision.order_quantity === undefined
    || decision.applied_price_break_quantity === null
    || decision.applied_price_break_quantity === undefined
    || decision.source_unit_price === null
    || decision.source_unit_price === undefined
    || decision.source_currency === null
    || decision.source_currency === undefined
    || decision.converted_unit_price === null
    || decision.converted_unit_price === undefined
    || decision.line_total === null
    || decision.line_total === undefined
    || decision.stock_short === null
    || decision.stock_short === undefined
    || decision.target_currency.toUpperCase() !== 'KRW'
    || (options.requirePurchasable && !decision.purchasable)
    || (options.requireTop && decision.purchase_fit_rank !== 1)
    || (options.recommendation !== undefined
      && decision.recommendation !== options.recommendation)
    || Math.abs(
      decision.line_total - decision.converted_unit_price * decision.order_quantity
    ) > 0.02
  ) return null;
  return {
    offer: storedOfferInput(storedOffer),
    orderQty: decision.order_quantity,
    breakQty: decision.applied_price_break_quantity,
    unitPrice: decision.source_unit_price,
    currency: decision.source_currency.toUpperCase(),
    unitPriceKrw: decision.converted_unit_price,
    stockShort: decision.stock_short,
  };
}

function engineDecisionPick(
  group: CandidateGroup,
  storedOffer: StoredCandidateOfferType,
  needed: number,
  recommendation: 'automatic' | 'manual_review',
): OfferPick | null {
  const input = group.offerInputs.get(storedOffer.offerKey);
  const pick = storedEngineDecisionPick(storedOffer, needed, {
    recommendation,
    requireTop: true,
    requirePurchasable: true,
  });
  return pick === null || input === undefined ? null : { ...pick, offer: input };
}

/** 현재 엔진의 조달 결정을 검증해 그대로 투영한다. 로컬 가격 정렬은 수행하지 않는다. */
function projectEngineProcurement(
  component: EngineSupplierComponentType,
  groups: CandidateGroup[],
  needed: number,
): EngineProcurementProjection {
  const decision = component.procurement_decision;
  const invalid: EngineProcurementProjection = {
    valid: false,
    technicalTop: null,
    selected: null,
    recommended: null,
    offerKey: null,
    pick: null,
    applicationState: 'not_selected',
    confirmationRequired: false,
    technicalFallbackUsed: false,
    priceOptimizationUsed: false,
    primaryUnavailabilityReason: null,
  };
  const currentApplicationPolicy = (
    decision?.selection_application_policy_version === 'supplier-selection-application-v2'
    || decision?.selection_application_policy_version === 'supplier-selection-application-v3'
  );
  if (
    decision?.required_quantity !== needed
    || !currentApplicationPolicy
    || decision.target_currency.toUpperCase() !== 'KRW'
  ) return invalid;
  const priceOptimizationUsed = (
    decision.selection_application_policy_version === 'supplier-selection-application-v3'
    && decision.price_optimization_used
  );

  const hasUnavailabilityPolicy = decision.unavailability_reason_policy_version !== undefined;
  const hasUnavailabilityReason = decision.primary_unavailability_reason !== undefined;
  if (hasUnavailabilityPolicy !== hasUnavailabilityReason) return invalid;
  const primaryUnavailabilityReason = hasUnavailabilityPolicy
    ? decision.primary_unavailability_reason ?? null
    : null;
  const hasRecommendation = decision.status === 'automatic_recommended'
    || decision.status === 'review_recommended';
  if (
    hasUnavailabilityPolicy
    && hasRecommendation !== (primaryUnavailabilityReason === null)
  ) return invalid;

  const identityKey = decision.technical_preselection_identity_key ?? null;
  const evidenceKey = decision.technical_preselection_evidence_key ?? null;
  if ((identityKey === null) !== (evidenceKey === null)) return invalid;
  const technicalGroup = identityKey === null || evidenceKey === null
    ? null
    : groups.find((group) =>
      group.snapshot.identityKey === identityKey
      && group.snapshot.technicalEvidenceKey === evidenceKey)
      ?? null;
  if (identityKey !== null && technicalGroup === null) return invalid;
  if (
    technicalGroup !== null
    && technicalGroup.snapshot.selectionRecommendation !== 'preselect'
  ) return invalid;

  const applicationIdentityKey = decision.application_candidate_identity_key ?? null;
  const applicationEvidenceKey = decision.application_candidate_evidence_key ?? null;
  if ((applicationIdentityKey === null) !== (applicationEvidenceKey === null)) return invalid;
  const applicationGroup = applicationIdentityKey === null || applicationEvidenceKey === null
    ? null
    : groups.find((group) =>
      group.snapshot.identityKey === applicationIdentityKey
      && group.snapshot.technicalEvidenceKey === applicationEvidenceKey)
      ?? null;
  if (applicationIdentityKey !== null && applicationGroup === null) return invalid;
  const applicationDiffers = applicationGroup !== null && applicationGroup !== technicalGroup;
  if (
    decision.selection_application_policy_version === 'supplier-selection-application-v2'
      ? decision.technical_fallback_used !== applicationDiffers
      : applicationDiffers
        ? decision.technical_fallback_used === priceOptimizationUsed
        : decision.technical_fallback_used || priceOptimizationUsed
  ) return invalid;

  const recommendedOffers = groups.flatMap((group) =>
    group.snapshot.offers.flatMap((offer) =>
      offer.procurementDecision?.recommendation === 'none'
        || offer.procurementDecision === null
        ? []
        : [{ group, offer }]),
  );
  if (
    decision.status === 'no_recommendation'
    || decision.status === 'input_incomplete'
  ) {
    return recommendedOffers.length === 0
      && decision.selection_application_state === 'not_selected'
      && !decision.confirmation_required
      && applicationGroup === null
      && !decision.technical_fallback_used
      && !priceOptimizationUsed
      ? {
          valid: true,
          technicalTop: technicalGroup,
          selected: null,
          recommended: null,
          offerKey: null,
          pick: null,
          applicationState: 'not_selected',
          confirmationRequired: false,
          technicalFallbackUsed: false,
          priceOptimizationUsed: false,
          primaryUnavailabilityReason,
        }
      : invalid;
  }
  if (
    technicalGroup === null
    || applicationGroup === null
  ) return invalid;

  const automatic = decision.status === 'automatic_recommended';
  const expectedApplicationState = automatic
    ? 'automatic_selected'
    : 'provisional_selected';
  if (
    decision.selection_application_state !== expectedApplicationState
    || decision.confirmation_required !== !automatic
  ) return invalid;
  const expectedOfferKey = automatic
    ? decision.automatic_offer_key ?? null
    : decision.review_offer_key ?? null;
  const expectedRecommendation = automatic ? 'automatic' : 'manual_review';
  const matching = recommendedOffers.filter(({ group, offer }) =>
    group === applicationGroup
    && offer.offerKey === expectedOfferKey
    && offer.procurementDecision?.recommendation === expectedRecommendation);
  if (recommendedOffers.length !== 1 || matching.length !== 1) return invalid;
  const selectedOffer = matching[0]?.offer;
  if (selectedOffer === undefined) return invalid;
  const expectedEligibility = automatic ? 'automatic' : 'manual_review';
  if (
    applicationGroup.snapshot.selectionEligibility !== expectedEligibility
    || applicationGroup.snapshot.selectionRecommendation === 'exclude'
    || (
      !decision.technical_fallback_used
      && !priceOptimizationUsed
      && applicationGroup.snapshot.selectionRecommendation !== 'preselect'
    )
  ) return invalid;
  const pick = engineDecisionPick(
    applicationGroup,
    selectedOffer,
    needed,
    expectedRecommendation,
  );
  if (pick === null) return invalid;
  return {
    valid: true,
    technicalTop: technicalGroup,
    selected: applicationGroup,
    recommended: applicationGroup,
    offerKey: selectedOffer.offerKey,
    pick,
    applicationState: expectedApplicationState,
    confirmationRequired: !automatic,
    technicalFallbackUsed: decision.technical_fallback_used,
    priceOptimizationUsed,
    primaryUnavailabilityReason,
  };
}

function pickLineTotal(pick: OfferPick | null): number | null {
  if (pick?.unitPriceKrw == null) return null;
  return Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100;
}

export interface ProjectEnginePartSearchResult {
  items: BomPartHitType[];
  total: number;
  apiCalls: number;
  cacheHits: number;
  warnings: string[];
}

/**
 * 단일 검색의 현재 엔진 후보를 DB/ES 반영과 독립된 화면 계약으로 투영한다.
 * 후보 관계·구매 순위는 엔진 결정을 검증해 사용하고 sp-node가 다시 추측하지 않는다.
 */
export function projectEnginePartSearchResult(
  envelopeValue: unknown,
  needed: number,
): ProjectEnginePartSearchResult | null {
  const parsed = EngineSupplierEnvelope.safeParse(envelopeValue);
  if (
    !parsed.success
    || parsed.data.procurement_decision_contract_status !== 'current'
  ) return null;
  const component = parsed.data.search.components[0];
  if (component === undefined) {
    return {
      items: [],
      total: 0,
      apiCalls: parsed.data.search.api_calls,
      cacheHits: parsed.data.search.cache_hits,
      warnings: [],
    };
  }
  if (component.procurement_decision === null || component.procurement_decision === undefined) return null;

  const groups = buildCandidateGroups(component, true);
  const procurement = projectEngineProcurement(component, groups, needed);
  const prioritizedGroups = procurement.valid && procurement.selected !== null
    ? [
        procurement.selected,
        ...groups.filter((group) => group !== procurement.selected),
      ]
    : groups;
  const visibleGroups = prioritizedGroups.slice(0, MAX_STORED_CANDIDATES_PER_ITEM);
  const items = visibleGroups.map(({ snapshot }) => {
    const { pick } = storedCandidatePick(snapshot, needed, null);
    const inlineOffers = snapshot.offers.map((offer) => ({
      supplier: offer.supplier,
      supplierSku: offer.supplierSku,
      productUrl: offer.productUrl,
      stock: offer.stock,
      moq: offer.moq,
      orderMultiple: offer.orderMultiple,
      packaging: normalizeSupplierPackaging(offer.supplier, offer.packaging),
      currency: offer.priceBreaks[0]?.currency ?? null,
      priceBreaks: offer.priceBreaks.map((priceBreak) => ({
        qty: priceBreak.qty,
        price: priceBreak.price,
      })),
      fetchedAt: offer.fetchedAt,
      derivedFrom: null,
    }));
    const numericSpecs = Object.fromEntries(
      Object.entries(snapshot.normalizedSpecs).flatMap(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value) ? [[key, value] as const] : []),
    );
    const fetchedAt = inlineOffers
      .map((offer) => offer.fetchedAt)
      .sort()
      .at(-1) ?? null;
    return {
      id: snapshot.candidateKey,
      mpn: snapshot.mpn,
      manufacturerName: snapshot.manufacturerName ?? '제조사 미확인',
      description: snapshot.description,
      category: snapshot.category,
      packageCode: snapshot.packageCode,
      lifecycle: snapshot.lifecycleStatus,
      imageUrl: snapshot.imageUrl,
      specsSi: numericSpecs,
      suppliers: uniqueStrings(inlineOffers.map((offer) => offer.supplier)),
      offerCount: inlineOffers.length,
      minPrice: pick?.unitPrice ?? null,
      minPriceCurrency: pick?.currency ?? null,
      totalStock: inlineOffers.reduce((sum, offer) => sum + Math.max(0, offer.stock ?? 0), 0),
      offersFetchedAt: fetchedAt,
      hasSpecConflict: false,
      score: snapshot.specificationConfidence,
      source: 'supplier' as const,
      inlineOffers,
      applied: pick === null
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
            priceBreaks: pick.offer.priceBreaks.map((priceBreak) => ({
              qty: priceBreak.qty,
              price: priceBreak.price,
            })),
            unitPrice: pick.unitPrice,
            unitPriceKrw: pick.unitPriceKrw,
            lineTotalKrw: pickLineTotal(pick),
            breakQty: pick.breakQty,
            orderQty: pick.orderQty,
            stockShort: pick.stockShort,
          },
    } satisfies BomPartHitType;
  });

  return {
    items,
    total: groups.length,
    apiCalls: parsed.data.search.api_calls,
    cacheHits: parsed.data.search.cache_hits,
    warnings: component.warnings,
  };
}

function evidenceFromDecision(
  component: EngineSupplierComponentType,
  identityFallback: boolean,
  selectionApplicationState: 'automatic_selected' | 'provisional_selected' | 'not_selected',
  confirmationRequired: boolean,
  procurementUnavailabilityReason: EngineProcurementUnavailabilityReasonType | null,
  groups: CandidateGroup[],
  eligible: CandidateGroup[],
  selected: CandidateGroup | null,
  technicalTop: CandidateGroup | null,
  technicalFallbackUsed: boolean,
  recommendedCandidateKey: string | null,
  pick: OfferPick | null,
  mode: SelectionMode,
  recommendationType: BomQuoteRecommendationTypeType,
  reasonCodes: BomQuoteDecisionReasonType[],
  needed: number,
  technicalTopPick: OfferPick | null,
  policyVersion: string,
): BomQuoteMatchEvidenceType {
  const reviewGroup = selected ?? groups[0] ?? null;
  const reviewCandidate = reviewGroup?.representative ?? component.candidates[0] ?? null;
  const evidenceSnapshot = reviewGroup?.snapshot ?? null;
  const selectedTotal = pickLineTotal(pick);
  const technicalTotal = pickLineTotal(technicalTopPick);
  const savings = selectedTotal === null || technicalTotal === null ? null : Math.round((technicalTotal - selectedTotal) * 100) / 100;
  const savingsRate = savings === null || technicalTotal === null || technicalTotal <= 0 ? null : savings / technicalTotal;
  return {
    policyVersion,
    componentId: component.component_id,
    componentStatus: component.status,
    selectionApplicationState,
    confirmationRequired,
    procurementUnavailabilityReason,
    technicalPreselectionCandidateKey: technicalTop?.snapshot.candidateKey ?? null,
    technicalFallbackUsed,
    identityFallback,
    searchTraceSummary: searchTraceSummary(parseEngineSearchTrace(component.search_trace).trace),
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

/** 엔진의 기술·구매 결정을 검증해 그대로 투영한다. 조달 계약이 없으면 선정하지 않는다. */
export function selectEngineMatch(
  componentValue: unknown,
  needed: number,
  _usdKrwRate: number | null,
): EngineMatchDecision | null {
  const parsed = EngineSupplierComponent.safeParse(componentValue);
  if (!parsed.success) return null;
  const component = parsed.data;
  const identityFallback = component.identity_fallback;
  const usesProcurementContract = component.procurement_decision !== null
    && component.procurement_decision !== undefined;
  const groups = buildCandidateGroups(component, usesProcurementContract);
  const eligible = groups.filter((group) => group.snapshot.autoEligible);
  if (usesProcurementContract) {
    const procurement = projectEngineProcurement(component, groups, needed);
    const selected = procurement.valid ? procurement.selected : null;
    const recommended = procurement.valid ? procurement.recommended : null;
    const selectedMode = selected?.snapshot.selectionMode
      ?? recommended?.snapshot.selectionMode
      ?? (component.status === 'not_found' ? 'unmatched' : 'review');
    const recommendationType: BomQuoteRecommendationTypeType = selected === null
      ? 'none'
      : procurement.priceOptimizationUsed
        ? 'price'
        : selectedMode === 'spec-compatible'
        ? 'technical'
        : 'identity';
    const applicationReasonCodes: BomQuoteDecisionReasonType[] = procurement.valid
      ? procurement.applicationState === 'provisional_selected'
        ? ['engine-manual-review']
        : procurement.applicationState === 'automatic_selected'
          ? ['engine-procurement-recommendation']
          : ['engine-procurement-unavailable']
      : ['no-safe-candidate'];
    const reasonCodes: BomQuoteDecisionReasonType[] = [
      ...applicationReasonCodes,
      ...(procurement.technicalFallbackUsed
        ? ['engine-technical-fallback'] as const
        : []),
      ...(procurement.priceOptimizationUsed
        ? ['strict-spec-price-saving'] as const
        : []),
    ];
    const recommendedCandidateKey = recommended?.snapshot.candidateKey ?? null;
    const technicalTopPick = procurement.technicalTop === null
      ? null
      : storedCandidatePick(procurement.technicalTop.snapshot, needed, null).pick;
    return {
      evidence: evidenceFromDecision(
        component,
        identityFallback,
        procurement.applicationState,
        procurement.confirmationRequired,
        procurement.primaryUnavailabilityReason,
        groups,
        eligible,
        selected,
        procurement.technicalTop,
        procurement.technicalFallbackUsed,
        recommendedCandidateKey,
        procurement.pick,
        selectedMode,
        recommendationType,
        reasonCodes,
        needed,
        technicalTopPick,
        BOM_ENGINE_SELECTION_POLICY_VERSION,
      ),
      candidate: selected?.representative ?? null,
      candidateKey: selected?.snapshot.candidateKey ?? null,
      recommendedCandidateKey,
      offerKey: selected === null ? null : procurement.offerKey,
      pick: procurement.pick,
      snapshots: groups.map((group) => group.snapshot),
    };
  }
  const selectedMode = component.status === 'not_found'
    ? 'unmatched'
    : groups[0]?.snapshot.selectionMode ?? 'review';
  return {
    evidence: evidenceFromDecision(
      component,
      identityFallback,
      'not_selected',
      false,
      null,
      groups,
      eligible,
      null,
      groups[0] ?? null,
      false,
      null,
      null,
      selectedMode,
      'none',
      ['engine-procurement-unavailable'],
      needed,
      null,
      BOM_ENGINE_SELECTION_POLICY_VERSION,
    ),
    candidate: null,
    candidateKey: null,
    recommendedCandidateKey: null,
    offerKey: null,
    pick: null,
    snapshots: groups.map((group) => group.snapshot),
  };
}

function remapExplicitCandidate(
  item: BomQuoteItemInputType,
  snapshots: StoredCandidateType[],
): StoredCandidateType | null {
  const byEngineKey = snapshots.find((candidate) => candidate.candidateKey === item.selectedCandidateKey);
  if (byEngineKey !== undefined) return byEngineKey;
  const currentOffer = item.selectedOffer;
  if (currentOffer !== null) {
    const byOffer = snapshots.find((candidate) => candidate.offers.some((offer) =>
      offer.supplier.toLocaleLowerCase() === currentOffer.supplier.toLocaleLowerCase() &&
      offer.supplierSku === currentOffer.supplierSku &&
      offer.packaging === currentOffer.packaging,
    ));
    if (byOffer !== undefined) return byOffer;
  }
  return null;
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
  searchTraceSnapshots: QuoteSearchTraceSnapshotInput[];
  processedRowIndexes: number[];
}

export interface QuoteSearchTraceSnapshotInput {
  rowIdx: number;
  componentId: string;
  trace: EngineSupplierSearchTraceType;
}

/** 관리자와 동일한 공급사 검색 결과를 견적 행에 직접 반영한다. */
export async function applyEngineSupplierResult(
  items: BomQuoteItemInputType[],
  envelopeValue: unknown,
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
  log?: Pick<FastifyBaseLogger, 'warn'>,
  preserveExplicitSelections = true,
): Promise<ApplyEngineSupplierResult> {
  const parsed = EngineSupplierEnvelope.safeParse(envelopeValue);
  if (!parsed.success) {
    return {
      applied: false,
      candidateSnapshots: [],
      searchTraceSnapshots: [],
      processedRowIndexes: [],
    };
  }
  if (
    parsed.data.procurement_decision_contract_status !== 'current'
    || parsed.data.search.components.some((component) =>
      component.procurement_decision === null
      || component.procurement_decision === undefined)
  ) {
    return {
      applied: false,
      candidateSnapshots: [],
      searchTraceSnapshots: [],
      processedRowIndexes: [],
    };
  }
  const components = new Map(parsed.data.search.components.map((component) => [component.component_id, component]));
  const candidateSnapshots: QuoteCandidateSnapshotInput[] = [];
  const searchTraceSnapshots: QuoteSearchTraceSnapshotInput[] = [];
  const processedRowIndexes: number[] = [];
  const searchTraceParseFailures: { componentId: string; issues: ParsedEngineSearchTrace['issues'] }[] = [];

  for (const item of items) {
    const componentId = item.sourceRow?.componentId;
    if (typeof componentId !== 'string') continue; // 수동 추가 행은 카탈로그/사용자 선택을 유지
    const component = components.get(componentId);
    if (component === undefined) continue;
    processedRowIndexes.push(item.rowIdx);

    const sourcePartNumber = item.sourceRow?.inputPartNumber;
    const inputPartNumber = typeof sourcePartNumber === 'string' ? sourcePartNumber.trim() : '';
    const needed = neededQty(item.bomQty, setQty, spareQty);
    const parsedTrace = parseEngineSearchTrace(component.search_trace);
    if (parsedTrace.issues.length > 0) {
      searchTraceParseFailures.push({ componentId, issues: parsedTrace.issues });
    }
    if (parsedTrace.trace !== null) {
      searchTraceSnapshots.push({
        rowIdx: item.rowIdx,
        componentId,
        trace: parsedTrace.trace,
      });
    }
    const decision = selectEngineMatch(component, needed, usdKrwRate);
    if (decision === null) continue;

    // 고객/관리자의 명시 선택은 후보 목록·자동 추천만 최신화하고 현재 선택은 보존한다.
    // 후보 키는 제조사 별칭/그룹화 정책이 바뀌면 달라질 수 있어 현재 MPN·제조사·오퍼로 재연결한다.
    const explicitSelection = preserveExplicitSelections && (
      item.matchStatus === 'manual' ||
      ['customer', 'catalog', 'admin'].includes(item.selectionSource) ||
      item.selectedOffer?.pinned === true
    );
    const remappedExplicit = explicitSelection && item.selectedCandidateKey !== null
      ? remapExplicitCandidate(item, decision.snapshots)
      : null;
    const retainedSnapshots = retainQuoteCandidateSnapshots(decision.snapshots, [
      item.selectedCandidateKey,
      remappedExplicit?.candidateKey,
      decision.candidateKey,
      decision.recommendedCandidateKey,
      decision.evidence.technicalPreselectionCandidateKey,
    ]);
    candidateSnapshots.push(
      ...retainedSnapshots.map((candidate) => ({ rowIdx: item.rowIdx, candidate })),
    );
    if (explicitSelection) {
      item.recommendedCandidateKey = decision.recommendedCandidateKey;
      const currentReasons = item.matchEvidence?.decisionReasonCodes ?? (
        item.selectionSource === 'catalog' ? ['catalog-choice'] as const : ['customer-choice'] as const
      );
      const remapped = remappedExplicit;
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
  if (searchTraceParseFailures.length > 0) {
    log?.warn(
      {
        traceFailureCount: searchTraceParseFailures.length,
        traceFailures: searchTraceParseFailures.slice(0, 20),
        omittedTraceFailureCount: Math.max(0, searchTraceParseFailures.length - 20),
      },
      'BOM 공급사 검색 trace 계약 불일치 — 후보 판정은 유지하고 trace만 생략합니다',
    );
  }
  return {
    applied: true,
    candidateSnapshots,
    searchTraceSnapshots,
    processedRowIndexes,
  };
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
  _usdKrwRate: number | null,
  requestedOfferKey: string | null = null,
): { pick: OfferPick | null; offerKey: string | null } {
  if (candidate.procurementDecision === null) return { pick: null, offerKey: null };
  const eligibleOffers = requestedOfferKey === null
    ? candidate.offers.filter((offer) =>
      offer.procurementDecision?.purchase_fit_rank === 1
      && offer.procurementDecision.purchasable)
    : candidate.offers.filter((offer) => offer.offerKey === requestedOfferKey);
  if (eligibleOffers.length !== 1) return { pick: null, offerKey: null };
  const engineOffer = eligibleOffers[0];
  if (engineOffer === undefined) return { pick: null, offerKey: null };
  const pick = storedEngineDecisionPick(engineOffer, needed, {
    requireTop: requestedOfferKey === null,
    requirePurchasable: true,
  });
  return pick === null
    ? { pick: null, offerKey: null }
    : { pick, offerKey: engineOffer.offerKey };
}

async function partIdForStoredCandidate(candidate: StoredCandidateType): Promise<string | null> {
  const identity = normalizedStoredCandidateIdentity(candidate);
  if (identity === null) return null;
  const exact = await prisma.spPart.findUnique({
    where: {
      mpnNorm_manufacturerNorm: {
        mpnNorm: identity.mpnNorm,
        manufacturerNorm: identity.manufacturerNorm,
      },
    },
    select: { id: true },
  });
  const byMpn = exact === null && identity.manufacturerNorm === 'unknown'
    ? await prisma.spPart.findFirst({
        where: { mpnNorm: identity.mpnNorm },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true },
      })
    : null;
  const part = resolvedStoredCandidatePart(identity, exact, byMpn);
  return part === null ? null : String(part.id);
}

/** 견적에 박제된 모든 후보가 현재 검색 색인에 반영됐는지 확인한다. 후보가 없으면 판정하지 않는다. */
export async function quoteCandidatePartsSearchable(quoteId: bigint): Promise<boolean | null> {
  const candidates = await prisma.spBomQuoteCandidate.findMany({
    where: { quoteId },
    select: { mpn: true, manufacturerName: true },
  });
  if (candidates.length === 0) return null;

  const identities: NormalizedStoredCandidateIdentity[] = [];
  for (const candidate of candidates) {
    const identity = normalizedStoredCandidateIdentity(candidate);
    if (identity === null) return false;
    identities.push(identity);
  }
  const mpnNorms = [...new Set(identities.map((identity) => identity.mpnNorm))];
  const parts = await prisma.spPart.findMany({
    where: { mpnNorm: { in: mpnNorms } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, mpnNorm: true, manufacturerNorm: true, indexedAt: true },
  });
  const exact = new Map(parts.map((part) => [`${part.mpnNorm}\u0000${part.manufacturerNorm}`, part] as const));
  const byMpn = new Map<string, (typeof parts)[number]>();
  for (const part of parts) if (!byMpn.has(part.mpnNorm)) byMpn.set(part.mpnNorm, part);

  return identities.every((identity) => {
    const part = resolvedStoredCandidatePart(
      identity,
      exact.get(`${identity.mpnNorm}\u0000${identity.manufacturerNorm}`),
      byMpn.get(identity.mpnNorm),
    );
    return part !== null && part.indexedAt !== null;
  });
}

interface StoredRecommendation {
  applicationState: 'automatic_selected' | 'provisional_selected';
  confirmationRequired: boolean;
  candidate: StoredCandidateType;
  pick: OfferPick | null;
  offerKey: string | null;
  technicalPreselectionCandidateKey: string;
  technicalFallbackUsed: boolean;
  technicalTopLineTotalKrw: number | null;
  recommendationType: BomQuoteRecommendationTypeType;
  reasonCodes: BomQuoteDecisionReasonType[];
}

function hasConsistentProcurementDecision(candidates: StoredCandidateType[]): boolean {
  const first = candidates[0]?.procurementDecision;
  if (first === null || first === undefined) return false;
  const expected = JSON.stringify(first);
  return candidates.every((candidate) =>
    candidate.procurementDecision !== null
    && JSON.stringify(candidate.procurementDecision) === expected);
}

/** 저장된 최신 엔진 조달 결정을 검증해 투영한다. 후보·오퍼 순위는 재계산하지 않는다. */
function recommendStoredCandidate(
  candidates: StoredCandidateType[],
  needed: number,
): StoredRecommendation | null {
  if (!hasConsistentProcurementDecision(candidates)) return null;
  const componentDecision = candidates[0]?.procurementDecision;
  if (componentDecision === null || componentDecision === undefined) return null;
  const currentApplicationPolicy = (
    componentDecision.selection_application_policy_version
      === 'supplier-selection-application-v2'
    || componentDecision.selection_application_policy_version
      === 'supplier-selection-application-v3'
  );
  if (
    !currentApplicationPolicy
    || componentDecision.required_quantity !== needed
    || componentDecision.target_currency.toUpperCase() !== 'KRW'
    || (componentDecision.status !== 'automatic_recommended'
      && componentDecision.status !== 'review_recommended')
  ) return null;
  const automatic = componentDecision.status === 'automatic_recommended';
  const applicationState = componentDecision.selection_application_state;
  if (
    applicationState !== (automatic ? 'automatic_selected' : 'provisional_selected')
    || componentDecision.confirmation_required !== !automatic
  ) return null;
  const technicalIdentityKey = componentDecision.technical_preselection_identity_key;
  const technicalEvidenceKey = componentDecision.technical_preselection_evidence_key;
  const identityKey = componentDecision.application_candidate_identity_key;
  const evidenceKey = componentDecision.application_candidate_evidence_key;
  if (
    technicalIdentityKey === null
    || technicalEvidenceKey === null
    || identityKey === null
    || evidenceKey === null
  ) return null;
  const fallbackUsed = identityKey !== technicalIdentityKey || evidenceKey !== technicalEvidenceKey;
  const priceOptimizationUsed = (
    componentDecision.selection_application_policy_version
      === 'supplier-selection-application-v3'
    && componentDecision.price_optimization_used
  );
  if (
    componentDecision.selection_application_policy_version
      === 'supplier-selection-application-v2'
      ? componentDecision.technical_fallback_used !== fallbackUsed
      : fallbackUsed
        ? componentDecision.technical_fallback_used === priceOptimizationUsed
        : componentDecision.technical_fallback_used || priceOptimizationUsed
  ) return null;
  const technicalTopCandidates = candidates.filter((candidate) =>
    candidate.identityKey === technicalIdentityKey
    && candidate.technicalEvidenceKey === technicalEvidenceKey
    && candidate.selectionRecommendation === 'preselect');
  if (technicalTopCandidates.length !== 1) return null;
  const technicalTop = technicalTopCandidates[0];
  if (technicalTop === undefined) return null;
  const selected = candidates.filter((candidate) =>
    candidate.identityKey === identityKey
    && candidate.technicalEvidenceKey === evidenceKey
    && candidate.selectionRecommendation !== 'exclude');
  if (selected.length !== 1) return null;
  const candidate = selected[0];
  if (
    candidate?.selectionEligibility !== (automatic ? 'automatic' : 'manual_review')
  ) return null;
  const offerKey = automatic
    ? componentDecision.automatic_offer_key
    : componentDecision.review_offer_key;
  if (offerKey === null || offerKey === undefined) return null;
  const offer = candidate.offers.find((entry) => entry.offerKey === offerKey);
  if (offer === undefined) return null;
  const pick = storedEngineDecisionPick(offer, needed, {
    recommendation: automatic ? 'automatic' : 'manual_review',
    requireTop: true,
    requirePurchasable: true,
  });
  if (pick === null) return null;
  const technicalTopPick = storedCandidatePick(technicalTop, needed, null).pick;
  const recommendationType: BomQuoteRecommendationTypeType = priceOptimizationUsed
    ? 'price'
    : automatic
      ? candidate.selectionMode === 'spec-compatible' ? 'technical' : 'identity'
      : 'none';
  const reasonCodes: BomQuoteDecisionReasonType[] = [
    automatic ? 'engine-procurement-recommendation' : 'engine-manual-review',
    ...(componentDecision.technical_fallback_used
      ? ['engine-technical-fallback'] as const
      : []),
    ...(priceOptimizationUsed ? ['strict-spec-price-saving'] as const : []),
  ];
  return {
    applicationState,
    confirmationRequired: componentDecision.confirmation_required,
    candidate,
    pick,
    offerKey,
    technicalPreselectionCandidateKey: technicalTop.candidateKey,
    technicalFallbackUsed: componentDecision.technical_fallback_used,
    technicalTopLineTotalKrw: pickLineTotal(technicalTopPick),
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
    procurementUnavailabilityReason: null,
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
          technicalPreselectionCandidateKey:
            recommendation?.technicalPreselectionCandidateKey
            ?? previous.technicalPreselectionCandidateKey
            ?? null,
          technicalFallbackUsed: recommendation?.technicalFallbackUsed ?? false,
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

function needsEngineProcurementReevaluation(
  candidates: StoredCandidateType[],
  needed: number,
  usdKrwRate: number | null,
): boolean {
  if (candidates.length === 0) return false;
  if (!hasConsistentProcurementDecision(candidates)) {
    return candidates.some((candidate) => candidate.engineCandidates.length > 0);
  }
  if (
    candidates[0]?.procurementDecision?.selection_application_policy_version
    !== 'supplier-selection-application-v3'
  ) return candidates.some((candidate) => candidate.engineCandidates.length > 0);
  return candidates.some((candidate) =>
    candidate.procurementDecision?.required_quantity !== needed
    || candidate.offers.some((offer) => {
      const decision = offer.procurementDecision;
      if (decision?.source_currency?.toUpperCase() !== 'USD') return false;
      return usdKrwRate === null
        ? decision.exchange_rate !== null && decision.exchange_rate !== undefined
        : decision.exchange_rate === null
          || decision.exchange_rate === undefined
          || Math.abs(decision.exchange_rate - usdKrwRate) > 0.000001;
    }),
  );
}

const BATCH_REEVALUATION_CHUNK_SIZE = 50;
const BATCH_REEVALUATION_TIMEOUT_MS = 15_000;

function collectUniqueEngineCandidates(candidates: StoredCandidateType[]): EngineSupplierCandidateType[] {
  const unique = new Map<string, EngineSupplierCandidateType>();
  for (const candidate of candidates) {
    for (const engineCandidate of candidate.engineCandidates) {
      unique.set(JSON.stringify(engineCandidate), engineCandidate);
    }
  }
  return [...unique.values()];
}

function decisionFromBatchCandidates(
  componentId: string,
  candidates: EngineSupplierCandidateType[],
  procurementDecision: z.infer<typeof EngineComponentProcurementDecision>,
  identityFallback: boolean,
  procurementDisposition: StoredCandidateType['procurementDisposition'],
  quantityResolution: StoredCandidateType['quantityResolution'],
  dispositionReasonCodes: string[],
  needed: number,
  usdKrwRate: number | null,
): EngineMatchDecision | null {
  return selectEngineMatch(
    {
      component_id: componentId,
      status: candidates[0]?.status ?? 'not_found',
      identity_fallback: identityFallback,
      procurement_disposition: procurementDisposition,
      quantity_resolution: quantityResolution,
      disposition_reason_codes: dispositionReasonCodes,
      candidates,
      procurement_decision: procurementDecision,
    },
    needed,
    usdKrwRate,
  );
}

interface PendingBatchReevaluation {
  itemId: string;
  componentId: string;
  needed: number;
  requestedOfferKey: string | null;
  identityFallback: boolean;
  engineCandidates: EngineSupplierCandidateType[];
  procurementDisposition: StoredCandidateType['procurementDisposition'];
  quantityResolution: StoredCandidateType['quantityResolution'];
  dispositionReasonCodes: string[];
}

interface BatchReevaluationOutcome {
  succeeded: Map<string, EngineMatchDecision>;
  degradedItemIds: Set<string>;
  errorCodes: Set<string>;
}

/**
 * 저장 후보를 컴포넌트 50개 청크로 묶어 sp-engine 벌크 재평가를 호출한다 — 행별 순차 호출을
 * 제거해 자동저장 지연을 없앤다. 청크 요청 실패·타임아웃·컴포넌트별 오류는 예외를 던지지
 * 않고 degradedItemIds 에만 표시한다(호출부가 해당 행을 stale 유지로 축퇴시킬 신호).
 *
 * 서킷브레이커: 청크 "요청 자체"가 실패(네트워크 예외·타임아웃·비200·파싱 실패)하면 엔진이
 * 완전히 죽었거나 행업 상태일 가능성이 크므로, 잔여 청크는 호출하지 않고 즉시 전부 축퇴시킨
 * 뒤 중단한다(2,000행 상한에서 청크당 15초 타임아웃을 전부 소진하는 최악의 지연을 방지).
 * 컴포넌트별 status:'error'는 엔진이 응답했다는(=살아있다는) 뜻이라 서킷브레이커를 열지
 * 않고 그 컴포넌트만 격리한 채 다음 청크를 계속 시도한다.
 */
async function batchReevaluateStoredProcurement(
  pending: PendingBatchReevaluation[],
  usdKrwRate: number | null,
  exchangeRateSnapshot: BomQuoteExchangeRateSnapshotType | null,
): Promise<BatchReevaluationOutcome> {
  const succeeded = new Map<string, EngineMatchDecision>();
  const degradedItemIds = new Set<string>();
  const errorCodes = new Set<string>();
  const procurementPolicy = buildEngineProcurementPolicy(usdKrwRate, exchangeRateSnapshot);

  for (let offset = 0; offset < pending.length; offset += BATCH_REEVALUATION_CHUNK_SIZE) {
    const chunk = pending.slice(offset, offset + BATCH_REEVALUATION_CHUNK_SIZE);
    let parsed: z.infer<typeof EngineProcurementReevaluationBatchResponse> | null = null;
    try {
      const response = await engineFetch(
        '/supplier-search/procurement/reevaluate-batch',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contract_version: 'supplier-procurement-reevaluation-batch-v1',
            procurement_policy: procurementPolicy,
            components: chunk.map((entry) => ({
              component_id: entry.componentId,
              candidates: entry.engineCandidates,
              required_quantity: entry.needed,
              requested_offer_key: entry.requestedOfferKey,
              procurement_disposition: entry.procurementDisposition,
              quantity_resolution: entry.quantityResolution,
              disposition_reason_codes: entry.dispositionReasonCodes,
            })),
          }),
        },
        BATCH_REEVALUATION_TIMEOUT_MS,
      );
      if (response.ok) {
        const result = EngineProcurementReevaluationBatchResponse.safeParse(await response.json());
        if (result.success) parsed = result.data;
      }
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      for (const entry of chunk) degradedItemIds.add(entry.itemId);
      errorCodes.add('batch-request-failed');
      // 서킷브레이커 — 남은 청크는 호출을 시도조차 하지 않고 곧바로 축퇴시킨다.
      const remaining = pending.slice(offset + BATCH_REEVALUATION_CHUNK_SIZE);
      if (remaining.length > 0) {
        for (const entry of remaining) degradedItemIds.add(entry.itemId);
        errorCodes.add('batch-circuit-open');
      }
      break;
    }
    const byComponentId = new Map(parsed.components.map((entry) => [entry.component_id, entry] as const));
    for (const entry of chunk) {
      const result = byComponentId.get(entry.componentId);
      if (result === undefined) {
        degradedItemIds.add(entry.itemId);
        errorCodes.add('component-result-missing');
        continue;
      }
      if (result.status === 'error') {
        degradedItemIds.add(entry.itemId);
        errorCodes.add(result.error_code ?? 'unknown-error');
        continue;
      }
      const decision = decisionFromBatchCandidates(
        entry.componentId,
        result.candidates,
        result.procurement_decision,
        entry.identityFallback,
        entry.procurementDisposition,
        entry.quantityResolution,
        entry.dispositionReasonCodes,
        entry.needed,
        usdKrwRate,
      );
      if (decision === null) {
        degradedItemIds.add(entry.itemId);
        errorCodes.add('local-projection-rejected');
        continue;
      }
      succeeded.set(entry.itemId, decision);
    }
  }
  return { succeeded, degradedItemIds, errorCodes };
}

/**
 * 배치 재평가가 실패한 행은 recommendStoredCandidate/재선정 경로에 들어가지 않고 현재 선택을
 * 그대로 둔다(selectedCandidateKey/selectedOffer/matchStatus/selectionSource/matchEvidence
 * 는 아래 reason 코드 추가 외엔 불변). 선택된 오퍼가 있으면 주문수량만 FE restampAll과 같은
 * 산수로 로컬 재도장한다 — 후보·오퍼 재순위는 하지 않고, 가격은 이후 computeQuote의 스냅샷
 * 재계산(recalcItems)이 이 orderQty 기준으로 채운다.
 */
function degradeStaleRow(item: BomQuoteItemInputType, needed: number): void {
  if (item.selectedOffer !== null) {
    item.orderQty = stampOrderQty(needed, item.selectedOffer.moq, item.selectedOffer.orderMultiple);
  }
  if (
    item.matchEvidence !== null
    && !item.matchEvidence.decisionReasonCodes.includes('engine-procurement-unavailable')
  ) {
    item.matchEvidence = {
      ...item.matchEvidence,
      decisionReasonCodes: [...item.matchEvidence.decisionReasonCodes, 'engine-procurement-unavailable'],
    };
  }
}

export function isEngineManagedQuoteSelection(
  item: Pick<BomQuoteItemInputType, 'selectionSource' | 'selectedCandidateKey' | 'selectedOffer'>,
): boolean {
  return item.selectionSource === 'auto'
    || (
      item.selectionSource === 'none'
      && item.selectedCandidateKey === null
      && item.selectedOffer === null
    );
}

/** PATCH 바디가 재평가 트리거 필드(items/setQty/spareQty)를 하나도 포함하지 않으면 호출부가
 *  repriceCandidateSelections 자체를 건너뛸 수 있다 — 제목·메모 전용 자동저장이 매번 엔진을
 *  때리던 낭비 제거. computeQuote+persist(저렴한 재계산)는 이 판단과 무관하게 항상 수행한다. */
export function patchNeedsCandidateReprice(
  body: Pick<BomQuotePatchBodyType, 'items' | 'setQty' | 'spareQty'>,
): boolean {
  return body.items !== undefined || body.setQty !== undefined || body.spareQty !== undefined;
}

/**
 * 수량·환율 변경 시 저장 후보를 sp-engine에서 재평가해 클라이언트 단가 변조를 차단한다.
 * 엔진이 부분/전체로 죽어 있어도(청크 실패·타임아웃·컴포넌트별 오류) 예외를 던지지 않는다 —
 * 실패한 행만 degradeStaleRow로 축퇴시키고 나머지 행 저장은 항상 진행한다(PATCH는 항상 200).
 */
export async function repriceCandidateSelections(
  quoteId: bigint,
  items: (BomQuoteItemInputType & { id?: string })[],
  setQty: number,
  spareQty: number,
  usdKrwRate: number | null,
  exchangeRateSnapshot: BomQuoteExchangeRateSnapshotType | null,
  log: FastifyBaseLogger,
): Promise<QuoteCandidateSnapshotInput[] | undefined> {
  const candidateItemIds = items.flatMap((item) =>
    item.id === undefined ? [] : [BigInt(item.id)],
  );
  if (candidateItemIds.length === 0) return undefined;
  const rows = await prisma.spBomQuoteCandidate.findMany({
    where: { quoteId, quoteItemId: { in: candidateItemIds } },
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

  // 1단계 — 재평가가 필요한 행만 모은다. componentId가 없어 애초에 배치에 실을 수 없으면
  // 엔진 호출 없이 바로 축퇴 대상으로 표시한다.
  const itemsNeedingReevaluation = new Set<string>();
  const pending: PendingBatchReevaluation[] = [];
  const degradedItemIds = new Set<string>();
  for (const item of items) {
    if (item.id === undefined) continue;
    const rowCandidates = candidates.get(item.id);
    if (rowCandidates === undefined) continue;
    const needed = neededQty(item.bomQty, setQty, spareQty);
    if (!needsEngineProcurementReevaluation(rowCandidates, needed, usdKrwRate)) continue;
    itemsNeedingReevaluation.add(item.id);
    const componentId = item.matchEvidence?.componentId
      ?? (typeof item.sourceRow?.componentId === 'string' ? item.sourceRow.componentId : null);
    const engineCandidates = collectUniqueEngineCandidates(rowCandidates);
    if (componentId === null || engineCandidates.length === 0) {
      degradedItemIds.add(item.id);
      continue;
    }
    pending.push({
      itemId: item.id,
      componentId,
      needed,
      requestedOfferKey: item.selectedOffer?.pinned === true ? item.selectedOffer.offerKey : null,
      identityFallback: item.matchEvidence?.identityFallback ?? false,
      engineCandidates,
      procurementDisposition: rowCandidates[0]?.procurementDisposition ?? 'eligible',
      quantityResolution: rowCandidates[0]?.quantityResolution ?? 'verified',
      dispositionReasonCodes: rowCandidates[0]?.dispositionReasonCodes ?? [],
    });
  }

  // 2단계 — 50개 컴포넌트 청크로 벌크 재평가(실패는 예외 없이 degradedItemIds 로만 표시).
  const missingComponentIdCount = degradedItemIds.size;
  const batchOutcome = pending.length === 0
    ? { succeeded: new Map<string, EngineMatchDecision>(), degradedItemIds: new Set<string>(), errorCodes: new Set<string>() }
    : await batchReevaluateStoredProcurement(pending, usdKrwRate, exchangeRateSnapshot);
  for (const itemId of batchOutcome.degradedItemIds) degradedItemIds.add(itemId);

  // 3단계 — 결과를 행에 반영한다. 축퇴 행은 recommendStoredCandidate/재선정 경로로 절대
  // 진입시키지 않는다(여기로 새면 selectedCandidateKey=null && selectionSource==='auto'
  // 리셋 분기가 재현되어 자동 선정·가격이 조용히 소거된다).
  let snapshotsChanged = false;
  const candidateSnapshots: QuoteCandidateSnapshotInput[] = [];
  for (const item of items) {
    if (item.id === undefined) continue;
    let rowCandidates = candidates.get(item.id);
    if (rowCandidates === undefined) continue;
    const needed = neededQty(item.bomQty, setQty, spareQty);
    let reevaluatedEvidence: BomQuoteMatchEvidenceType | null = null;

    if (itemsNeedingReevaluation.has(item.id)) {
      if (degradedItemIds.has(item.id)) {
        degradeStaleRow(item, needed);
        continue;
      }
      const decision = batchOutcome.succeeded.get(item.id);
      if (decision === undefined) {
        // 배치 결과 어디에도 없는 예상 밖 상태 — fail-safe로 축퇴(리셋 분기 진입 차단).
        degradedItemIds.add(item.id);
        batchOutcome.errorCodes.add('missing-batch-result');
        degradeStaleRow(item, needed);
        continue;
      }
      rowCandidates = decision.snapshots;
      reevaluatedEvidence = decision.evidence;
      candidates.set(item.id, rowCandidates);
      // 재평가에 실제로 성공한 행의 스냅샷만 반환한다 — persistQuoteComputed가 이 목록으로
      // quoteItemId 단위 부분 교체를 할 수 있도록(전 행 재삽입 방지).
      candidateSnapshots.push(
        ...rowCandidates.map((candidate) => ({ rowIdx: item.rowIdx, candidate })),
      );
      snapshotsChanged = true;
    }

    const recommendation = recommendStoredCandidate(
      rowCandidates,
      needed,
    );
    item.recommendedCandidateKey = recommendation?.candidate.candidateKey ?? null;
    const currentEvidence = reevaluatedEvidence ?? item.matchEvidence;
    if (currentEvidence !== null) {
      item.matchEvidence = {
        ...currentEvidence,
        selectionApplicationState: recommendation?.applicationState ?? 'not_selected',
        confirmationRequired: recommendation?.confirmationRequired ?? false,
        recommendedCandidateKey: item.recommendedCandidateKey,
        recommendationType: recommendation?.recommendationType ?? 'none',
      };
    }
    const engineManagedSelection = isEngineManagedQuoteSelection(item);
    const selectedCandidateKey = engineManagedSelection
      ? (recommendation?.candidate.candidateKey ?? null)
      : item.selectedCandidateKey;
    if (selectedCandidateKey === null) {
      if (item.selectionSource === 'auto') {
        const inputPartNumber = item.sourceRow?.inputPartNumber;
        const inputManufacturer = item.sourceRow?.inputManufacturer;
        item.mpn = typeof inputPartNumber === 'string' ? inputPartNumber.trim().slice(0, 191) : '';
        item.manufacturerName = typeof inputManufacturer === 'string'
          ? inputManufacturer.trim().slice(0, 191) || null
          : null;
        item.partId = null;
        item.selectedCandidateKey = null;
        item.selectedOffer = null;
        item.matchStatus = 'none';
        item.selectionSource = 'none';
        item.orderQty = needed;
        if (item.matchEvidence !== null) {
          item.matchEvidence = {
            ...item.matchEvidence,
            selectedCandidateKey: null,
            selectedTechnicalRank: null,
            selectedMpn: null,
            selectedManufacturer: null,
            selectedSupplier: null,
            selectedSupplierSku: null,
            priceEvidence: null,
          };
        }
      }
      continue;
    }
    const candidate = rowCandidates.find((entry) => entry.candidateKey === selectedCandidateKey);
    if (candidate === undefined) continue;
    const requestedOfferKey = item.selectedOffer?.pinned === true ? item.selectedOffer.offerKey : null;
    const selected = engineManagedSelection
      && recommendation?.candidate.candidateKey === candidate.candidateKey
      ? { pick: recommendation.pick, offerKey: recommendation.offerKey }
      : storedCandidatePick(candidate, needed, usdKrwRate, requestedOfferKey);
    const candidateChanged = item.selectedCandidateKey !== candidate.candidateKey;
    item.mpn = candidate.mpn;
    item.manufacturerName = candidate.manufacturerName;
    item.description = candidate.description;
    item.selectedCandidateKey = candidate.candidateKey;
    if (engineManagedSelection) {
      item.matchStatus = 'auto';
      item.selectionSource = 'auto';
    }
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
      engineManagedSelection ? recommendation : undefined,
    );
  }

  if (degradedItemIds.size > 0) {
    log.warn(
      {
        quoteId: String(quoteId),
        degradedRowCount: degradedItemIds.size,
        missingComponentIdCount,
        engineErrorCodes: [...batchOutcome.errorCodes],
      },
      'BOM 견적 자동저장: sp-engine 재평가 실패로 일부 행을 stale 유지로 축퇴했습니다',
    );
  }

  return snapshotsChanged ? candidateSnapshots : undefined;
}

function candidateOfferView(
  offer: StoredCandidateOfferType,
  needed: number,
  _usdKrwRate: number | null,
): BomQuoteCandidateOfferType {
  const pick = offer.procurementDecision === null
    ? null
    : storedEngineDecisionPick(offer, needed, {
      requireTop: false,
      requirePurchasable: false,
    });
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
    priceRank: offer.procurementDecision?.price_rank ?? null,
    purchaseFitRank: offer.procurementDecision?.purchase_fit_rank ?? null,
    purchasable: offer.procurementDecision?.purchasable ?? false,
    recommendation: offer.procurementDecision?.recommendation ?? 'none',
    decisionReasonCodes: offer.procurementDecision?.reason_codes ?? [],
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
  const searchTraceRow = itemRow.analysisComponent?.engineComponentId === undefined
    ? null
    : await prisma.spBomSupplierSearchTrace.findFirst({
        where: {
          supplierSearchRun: { quoteId },
          engineComponentId: itemRow.analysisComponent.engineComponentId,
        },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      });
  const storedSearchTrace = searchTraceRow === null
    ? null
    : EngineSupplierSearchTrace.safeParse(searchTraceRow.payload);
  const searchTrace = storedSearchTrace?.success === true
    ? quoteSearchTrace(storedSearchTrace.data)
    : null;
  const storedSearchRequirements = BomQuoteSearchRequirements.safeParse(
    itemRow.searchRequirements,
  );
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
  const technicalTop = stored
    .filter((candidate) => candidate.selectionRecommendation === 'preselect')
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
      technicalReviewRank: candidate.technicalReviewRank,
      selectionRecommendation: candidate.selectionRecommendation,
      reviewRecommended: candidate.reviewRecommended,
      priceRank: result.offerKey === null
        ? null
        : candidate.offers.find((offer) => offer.offerKey === result.offerKey)?.procurementDecision?.price_rank ?? null,
      status: candidate.status,
      selectionMode: candidate.selectionMode,
      safety: candidate.safety,
      selectionEligibility: candidate.selectionEligibility,
      autoEligible: candidate.autoEligible,
      manualSelectable: candidate.manualSelectable,
      selectionReasonCodes: candidate.selectionReasonCodes,
      selected,
      recommended: candidate.candidateKey === item.recommendedCandidateKey,
      mpn: candidate.mpn,
      manufacturerName: candidate.manufacturerName,
      description: candidate.description,
      category: candidate.category,
      packageCode: candidate.packageCode,
      lifecycleStatus: candidate.lifecycleStatus,
      lifecycleState: candidate.lifecycleState,
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
      requirementAssessments: candidate.requirementAssessments,
      verificationComplete: candidate.verificationComplete,
      strictCategoryCoverage: candidate.strictCategoryCoverage,
      technicalEvidenceKey: candidate.technicalEvidenceKey,
      normalizedSpecs: candidate.normalizedSpecs,
      specComparisons: candidate.specComparisons,
      packageComparison: candidate.packageComparison,
      offers: candidate.offers
        .map((offer) => candidateOfferView(offer, needed, rate))
        .sort((a, b) =>
          (a.purchaseFitRank ?? Number.MAX_SAFE_INTEGER) - (b.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
          || (a.priceRank ?? Number.MAX_SAFE_INTEGER) - (b.priceRank ?? Number.MAX_SAFE_INTEGER)
          || a.offerKey.localeCompare(b.offerKey)),
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
    searchRequirements: storedSearchRequirements.success
      ? storedSearchRequirements.data
      : null,
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
    selectionApplicationState: item.matchEvidence?.selectionApplicationState ?? 'not_selected',
    confirmationRequired: item.matchEvidence?.confirmationRequired ?? false,
    selectedCandidateKey: item.selectedCandidateKey,
    selectedOfferKey: item.selectedOffer?.offerKey ?? null,
    recommendedCandidateKey: item.recommendedCandidateKey,
    technicalTopCandidateKey: technicalTop?.candidateKey ?? null,
    technicalTopLineTotalKrw: technicalTopTotal,
    technicalFallbackUsed: item.matchEvidence?.technicalFallbackUsed ?? false,
    procurementUnavailabilityReason:
      item.matchEvidence?.procurementUnavailabilityReason ?? null,
    decisionReasonCodes: item.matchEvidence?.decisionReasonCodes ?? [],
    searchTrace,
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
  const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true, sheets: true } });
  if (quote === null) return 'quote-not-found';
  const activeRows = filterActiveQuoteItems(quote.items, quote.sheets);
  const itemRow = activeRows.find((row) => row.id === itemId);
  if (itemRow === undefined) return 'item-not-found';
  const candidateRow = await prisma.spBomQuoteCandidate.findUnique({
    where: { quoteItemId_candidateKey: { quoteItemId: itemId, candidateKey: candidateKeyValue } },
  });
  if (candidateRow === null) return 'candidate-not-found';
  const parsed = StoredCandidate.safeParse(candidateRow.payload);
  if (!parsed.success) return 'candidate-not-found';
  const candidate = parsed.data;
  if (!candidate.manualSelectable) return 'candidate-blocked';
  if (requestedOfferKey !== null && !candidate.offers.some((offer) => offer.offerKey === requestedOfferKey)) {
    return 'offer-not-found';
  }
  const config = await getBomQuoteRuntimeConfig();
  const items = activeRows.map((row) => toItemDto(row));
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
    // 엔진 후보 오퍼는 반드시 procurement reevaluation 경로를 사용한다.
    if (item.selectedCandidateKey !== null) continue;
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
    if (!current.pinned) {
      const pick = pickDefaultOffer(offers, Math.max(1, item.orderQty), usdKrwRate);
      if (pick !== null) {
        item.selectedOffer = snapshotFromPick(pick, false);
        item.orderQty = pick.orderQty;
      }
    }
  }
}

const engineRefreshInFlight = new Map<string, Promise<boolean>>();

/**
 * 검색 완료 결과를 componentId로 견적에 직접 반영한다. 카탈로그 동기화와 독립적으로
 * 먼저 저장하며, 아직 없는 partId는 후속 backfillQuotePartIds가 조건부 연결한다.
 * 매칭 판정과 오퍼 선택의 진실원본은 이 엔진 봉투다.
 */
export async function refreshQuoteFromSupplierResult(
  quoteId: bigint,
  envelope: unknown,
  supplierSearchRunId?: bigint,
  log?: Pick<FastifyBaseLogger, 'warn'>,
  options: { targeted?: boolean } = {},
): Promise<boolean> {
  const key = `${String(quoteId)}:${supplierSearchRunId === undefined ? 'legacy' : String(supplierSearchRunId)}`;
  const inFlight = engineRefreshInFlight.get(key);
  if (inFlight !== undefined) return inFlight;
  const run = (async (): Promise<boolean> => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: quoteId }, include: { items: true, sheets: true } });
    if (quote?.status !== 'draft') return false;
    const config = await getBomQuoteRuntimeConfig();
    const items = filterActiveQuoteItems(quote.items, quote.sheets).map((row) => toItemDto(row));
    const applied = await applyEngineSupplierResult(
      items,
      envelope,
      quote.setQty,
      quote.spareQty,
      config.usdKrwRate,
      log,
      options.targeted !== true,
    );
    if (!applied.applied) return false;
    const result = computeQuote(items, config.usdKrwRate, quote.shippingFee, quote.managementFee);
    await persistQuoteComputed(quoteId, result, config.usdKrwRate, {
      exchangeRateSnapshot: config.exchangeRateSnapshot,
      enrichStatus: 'done',
      enrichedAt: new Date(),
      candidateSnapshots: applied.candidateSnapshots,
      candidateSnapshotScope: options.targeted === true ? 'partial' : 'full',
      candidateSnapshotRowIndexes: applied.processedRowIndexes,
      ...(supplierSearchRunId === undefined
        ? {}
        : {
            supplierSearchRunId,
            searchTraceSnapshots: applied.searchTraceSnapshots,
          }),
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
 * 백그라운드 카탈로그 인제스트 뒤 자동 선정 행의 느슨한 partId 참조만 채운다.
 * 후보·오퍼·가격·사용자 선택에는 손대지 않고, 조회한 스냅샷이 그대로인 행만 갱신한다.
 * 느슨한 참조지만 제조사 교차 연결은 하지 않는다 — 제조사가 확인된 행은 exact(mpn+제조사)만,
 * 제조사 미상 행만 mpn 단독으로 매칭한다(같은 MPN을 여러 제조사가 쓸 때 오연결 방지).
 */
export async function backfillQuotePartIds(quoteId: bigint): Promise<number> {
  const items = await prisma.spBomQuoteItem.findMany({
    where: { quoteId, partId: null, selectionSource: 'auto', selectedCandidateKey: { not: null } },
    select: { id: true, mpn: true, manufacturerName: true, selectedCandidateKey: true },
  });
  const mpnNorms = [...new Set(items.map((item) => normalizeMpn(item.mpn)).filter((value) => value !== ''))];
  if (mpnNorms.length === 0) return 0;
  const parts = await prisma.spPart.findMany({
    where: { mpnNorm: { in: mpnNorms } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, mpnNorm: true, manufacturerNorm: true },
  });
  const exact = new Map(parts.map((part) => [`${part.mpnNorm}\u0000${part.manufacturerNorm}`, part.id]));
  const byMpn = new Map<string, bigint>();
  for (const part of parts) if (!byMpn.has(part.mpnNorm)) byMpn.set(part.mpnNorm, part.id);

  let updated = 0;
  for (const item of items) {
    const mpnNorm = normalizeMpn(item.mpn);
    if (mpnNorm === '') continue;
    const manufacturerNorm = resolveManufacturer(item.manufacturerName).norm;
    // 제조사가 확인되면 exact(mpn+제조사)만 — 미상 행만 mpn 단독 fallback 을 허용한다.
    const partId =
      exact.get(`${mpnNorm}\u0000${manufacturerNorm}`) ??
      (manufacturerNorm === 'unknown' ? byMpn.get(mpnNorm) : undefined);
    if (partId === undefined) continue;
    const result = await prisma.spBomQuoteItem.updateMany({
      where: {
        id: item.id,
        quoteId,
        partId: null,
        selectionSource: 'auto',
        selectedCandidateKey: item.selectedCandidateKey,
        mpn: item.mpn,
        manufacturerName: item.manufacturerName,
      },
      data: { partId },
    });
    updated += result.count;
  }
  return updated;
}

/**
 * 잡의 검색 결과가 (백업 훅 등으로) 인제스트된 뒤, 그 잡에 연결된 draft 견적을 재매칭.
 * sp-node 재시작으로 인제스트 폴러(onDone)가 유실됐을 때의 내성 — "카탈로그엔 있는데
 * 견적은 미매칭" 고착 방지. 미매칭 라인이 없으면 건드리지 않는다.
 */
export async function refreshQuotesForJob(
  jobId: string,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<void> {
  const response = await engineFetch(`/jobs/${encodeURIComponent(jobId)}/supplier-search/result`);
  if (!response.ok) return;
  const envelope: unknown = await response.json();
  const quotes = await prisma.spBomQuote.findMany({
    where: { engineJobId: jobId, status: 'draft' },
    select: {
      id: true,
      enrichStatus: true,
      activeSupplierSearchRunId: true,
      sheets: { select: { sheetIndex: true, selected: true } },
      items: { select: { included: true, matchStatus: true, sourceSheetIndex: true } },
    },
  });
  for (const quote of quotes) {
    const activeItems = filterActiveQuoteItems(quote.items, quote.sheets);
    const hasUnmatched = activeItems.some((i) => i.included && i.matchStatus === 'none');
    // searching 은 미매칭이 없어도 최신 엔진 판정·가격을 반영해 done 으로 종결시킨다.
    if (quote.enrichStatus !== 'searching' && !hasUnmatched) continue;
    await refreshQuoteFromSupplierResult(
      quote.id,
      envelope,
      quote.activeSupplierSearchRunId ?? undefined,
      log,
    );
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
  /**
   * candidateSnapshots 저장 범위. 'full'(기본) = quoteId 전체 후보 교체(공급사 검색 완료
   * 반영처럼 모든 행이 실제로 갱신되는 경로). 'partial' = candidateSnapshots에 등장하는
   * quoteItemId만 교체 — PATCH 자동저장이 실제로 재평가에 성공한 행만 스냅샷을 반환할 때,
   * 무관한 나머지 행의 후보를 지웠다 다시 넣는 전량 재삽입을 피한다.
   */
  candidateSnapshotScope?: 'full' | 'partial';
  /** 후보가 0건인 부분 검색 행도 기존 스냅샷을 정확히 제거하기 위한 대상 목록. */
  candidateSnapshotRowIndexes?: number[];
  supplierSearchRunId?: bigint;
  searchTraceSnapshots?: QuoteSearchTraceSnapshotInput[];
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
  const persist = async (tx: Prisma.TransactionClient): Promise<void> => {
    await persistQuoteItemsInTransaction(tx, quoteId, computed.items);
    if (extra?.candidateSnapshots !== undefined) {
      const scope = extra.candidateSnapshotScope ?? 'full';
      const snapshotRowIndexes = [...new Set(
        extra.candidateSnapshotRowIndexes
        ?? extra.candidateSnapshots.map((snapshot) => snapshot.rowIdx),
      )];
      const quoteItemIdByRowIdx = snapshotRowIndexes.length === 0
        ? new Map<number, bigint>()
        : new Map((await tx.spBomQuoteItem.findMany({
            where: { quoteId, rowIdx: { in: snapshotRowIndexes } },
            select: { id: true, rowIdx: true },
          })).map((item) => [item.rowIdx, item.id] as const));
      if (scope === 'full') {
        await tx.spBomQuoteCandidate.deleteMany({ where: { quoteId } });
      } else {
        const targetItemIds = snapshotRowIndexes.map((rowIdx) => quoteItemIdByRowIdx.get(rowIdx) ?? (() => {
          throw new Error(`BOM quote candidate row ${String(rowIdx)} has no persisted item`);
        })());
        if (targetItemIds.length > 0) {
          await tx.spBomQuoteCandidate.deleteMany({ where: { quoteId, quoteItemId: { in: targetItemIds } } });
        }
      }
      if (extra.candidateSnapshots.length > 0) {
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
    if (
      extra?.supplierSearchRunId !== undefined
      && extra.searchTraceSnapshots !== undefined
    ) {
      const supplierSearchRunId = extra.supplierSearchRunId;
      const run = await tx.spBomSupplierSearchRun.findFirst({
        where: { id: supplierSearchRunId, quoteId },
        select: { id: true },
      });
      if (run === null) {
        throw new Error(`BOM supplier search run ${String(supplierSearchRunId)} does not belong to quote ${String(quoteId)}`);
      }
      const componentIds = extra.searchTraceSnapshots.map((snapshot) => snapshot.componentId);
      if (new Set(componentIds).size !== componentIds.length) {
        throw new Error(`Duplicate BOM supplier search trace component for run ${String(supplierSearchRunId)}`);
      }
      await tx.spBomSupplierSearchTrace.deleteMany({
        where: { supplierSearchRunId },
      });
      const traceRows = extra.searchTraceSnapshots.map(({ rowIdx, componentId, trace }) => ({
        supplierSearchRunId,
        engineComponentId: componentId,
        rowIdx,
        traceVersion: trace.version,
        primaryQuery: trace.primary_query.slice(0, 500),
        fallbackQuery: trace.fallback_query?.slice(0, 500) ?? null,
        fallbackUsed: trace.fallback_used,
        attemptCount: trace.attempts.length,
        payload: trace,
      }));
      for (let offset = 0; offset < traceRows.length; offset += CANDIDATE_INSERT_BATCH_SIZE) {
        await tx.spBomSupplierSearchTrace.createMany({
          data: traceRows.slice(offset, offset + CANDIDATE_INSERT_BATCH_SIZE),
        });
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
  };
  await prisma.$transaction(
    persist,
    // 후보·검색 trace JSON을 배치 저장하는 경로는 운영 DB 부하에서 Prisma 기본 5초를
    // 넘을 수 있다. 카탈로그 인제스트 트랜잭션과 같은 대기 여유를 두되, 대형 BOM의
    // 순차 라인 갱신까지 원자적으로 끝낼 수 있도록 실행 제한은 60초로 둔다.
    { maxWait: 10_000, timeout: 60_000 },
  );
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

function toSheetDto(row: QuoteSheetRow, hasItems: boolean): BomQuoteSheetType {
  return {
    sheetIndex: row.sheetIndex,
    sheetName: row.sheetName,
    status: row.status as BomQuoteSheetType['status'],
    componentCount: row.componentCount,
    selected: row.selected,
    hasItems,
    failureReason: row.failureReason,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((value): value is string => typeof value === 'string') : [],
  };
}

type PartDataStatus = BomQuoteDetailType['partDataStatus'];
type PartDataFailureReason = BomQuoteDetailType['partDataFailureReason'];

function catalogPreparationStatus(value: Prisma.JsonValue | null): PartDataStatus | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, Prisma.JsonValue>).catalogStatus;
  return status === 'preparing' || status === 'ready' || status === 'failed' ? status : null;
}

function catalogPreparationFailureReason(value: Prisma.JsonValue | null): PartDataFailureReason {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  if (record.catalogStatus !== 'failed') return null;
  return typeof record.catalogError === 'string' && record.catalogError.includes('supplier_result_gone')
    ? 'result-gone'
    : 'preparation-failed';
}

export function catalogIngestRunReady(
  run: { status: string; stats: Prisma.JsonValue | null } | null,
): boolean {
  if (run?.status !== 'completed') return false;
  if (run.stats === null || typeof run.stats !== 'object' || Array.isArray(run.stats)) return true;
  const queued = (run.stats as Record<string, Prisma.JsonValue>).queued;
  return typeof queued !== 'number' || queued === 0;
}

export function resolvePartDataStatus({
  storedStatus,
  runReady,
  candidatesSearchable,
}: {
  storedStatus: PartDataStatus | null;
  runReady: boolean;
  candidatesSearchable: boolean | null;
}): PartDataStatus {
  if (storedStatus === 'ready') return 'ready';
  if (runReady) return 'ready';
  if (candidatesSearchable === true) return 'ready';
  if (storedStatus === 'failed') return 'failed';
  return 'preparing';
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function stampCandidatePartsReady(
  quoteId: bigint,
  supplierSearchRunId: bigint,
  resultSummary: Prisma.JsonValue | null,
): Promise<void> {
  await backfillQuotePartIds(quoteId);
  const prior = jsonObject(resultSummary);
  await prisma.spBomSupplierSearchRun.updateMany({
    where: { id: supplierSearchRunId, quoteId },
    data: {
      resultSummary: {
        ...prior,
        catalogStatus: 'ready',
        catalogReadyAt: new Date().toISOString(),
        catalogScope: 'candidates',
        catalogRetryAt: null,
        catalogError: null,
      },
    },
  });
}

export async function loadSupplierSearchSummary(
  supplierSearchRunId: bigint | null,
  enrichStatus: string,
): Promise<{
  supplierSearchLimitedCount: number;
  partDataStatus: PartDataStatus;
  partDataFailureReason: PartDataFailureReason;
}> {
  if (enrichStatus === 'searching') {
    return { supplierSearchLimitedCount: 0, partDataStatus: 'preparing', partDataFailureReason: null };
  }
  if (enrichStatus === 'failed') {
    return { supplierSearchLimitedCount: 0, partDataStatus: 'failed', partDataFailureReason: 'preparation-failed' };
  }
  // 공급사 보강이 필요 없었던 견적과 활성 실행 기록이 없는 구형 견적은 즉시 조회 가능하다.
  if (enrichStatus === 'idle' || supplierSearchRunId === null) {
    return { supplierSearchLimitedCount: 0, partDataStatus: 'ready', partDataFailureReason: null };
  }
  const run = await prisma.spBomSupplierSearchRun.findUnique({
    where: { id: supplierSearchRunId },
    select: {
      quoteId: true,
      resultSummary: true,
      catalogIngestRun: { select: { status: true, stats: true } },
    },
  });
  if (run === null) {
    return { supplierSearchLimitedCount: 0, partDataStatus: 'failed', partDataFailureReason: 'result-gone' };
  }
  const storedStatus = catalogPreparationStatus(run.resultSummary);
  const runReady = catalogIngestRunReady(run.catalogIngestRun);
  let candidatesSearchable: boolean | null = null;
  if (storedStatus !== 'ready' && !runReady) {
    candidatesSearchable = await quoteCandidatePartsSearchable(run.quoteId);
    if (candidatesSearchable === true) {
      await stampCandidatePartsReady(run.quoteId, supplierSearchRunId, run.resultSummary);
    }
  }
  const partDataStatus = resolvePartDataStatus({ storedStatus, runReady, candidatesSearchable });
  const partDataFailureReason = partDataStatus === 'failed'
    ? catalogPreparationFailureReason(run.resultSummary)
    : null;
  const currentCount = supplierRunLimitedComponentCount(run.resultSummary);
  if (currentCount !== null) return { supplierSearchLimitedCount: currentCount, partDataStatus, partDataFailureReason };
  const searchTraces = await prisma.spBomSupplierSearchTrace.findMany({
    where: { supplierSearchRunId },
    select: { payload: true },
  });
  const supplierSearchLimitedCount = supplierRunLimitedComponentCount(
    run.resultSummary,
    searchTraces.map((trace) => trace.payload),
  ) ?? 0;
  return { supplierSearchLimitedCount, partDataStatus, partDataFailureReason };
}

export async function toDetailDto(quote: QuoteRow, items: QuoteItemRow[], sheets: QuoteSheetRow[] = []): Promise<BomQuoteDetailType> {
  const activeItems = filterActiveQuoteItems(items, sheets);
  const itemSheetIndexes = new Set(items.flatMap((item) => item.sourceSheetIndex === null ? [] : [item.sourceSheetIndex]));
  const [partMetaMap, candidateDatasheetMap, supplierSearchSummary] = await Promise.all([
    loadPartMetaMap(activeItems),
    loadCandidateDatasheetMap(quote.id, activeItems),
    loadSupplierSearchSummary(quote.activeSupplierSearchRunId, quote.enrichStatus),
  ]);
  return {
    ...toSummaryDto(quote, summaryCounts(activeItems)),
    engineJobId: quote.engineJobId,
    buildStatus: quote.buildStatus as BomQuoteDetailType['buildStatus'],
    sheets: [...sheets]
      .sort((a, b) => a.sheetIndex - b.sheetIndex)
      .map((sheet) => toSheetDto(sheet, itemSheetIndexes.has(sheet.sheetIndex))),
    enrichStatus: quote.enrichStatus as BomQuoteDetailType['enrichStatus'],
    enrichedAt: quote.enrichedAt?.toISOString() ?? null,
    supplierSearchLimitedCount: supplierSearchSummary.supplierSearchLimitedCount,
    partDataStatus: supplierSearchSummary.partDataStatus,
    partDataFailureReason: supplierSearchSummary.partDataFailureReason,
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
    items: [...activeItems]
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
