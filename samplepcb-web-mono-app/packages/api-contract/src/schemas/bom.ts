import { z } from 'zod';

// BOM 추출 + 공급사 검색 — sp-engine(Python) 프록시 계약.
// Python의 pydantic 계약이 엔진 출력의 정본이며, 이 파일은 관리자 화면에서
// 실제로 검토·표시하는 G-shape 전체를 타입 안전하게 소비하기 위한 미러다.

const BomRawValue = z.union([z.string(), z.number(), z.null()]);

export const BomEvidence = z.object({
  cell: z.string(),
  raw_value: z.string(),
  supports: z.string(),
});
export type BomEvidenceType = z.infer<typeof BomEvidence>;

export const BomFieldState = z
  .object({
    value: BomRawValue,
    status: z.enum(['extracted', 'review', 'not_found']),
    evidence: z.array(BomEvidence).optional(),
    source: z.enum(['col', 'text', 'infer']).nullable().optional(),
  })
  .passthrough();
export type BomFieldStateType = z.infer<typeof BomFieldState>;

export const BomAttribute = z
  .object({
    name: z.string(),
    raw_value: BomRawValue.optional(),
    normalized_value: z.union([z.string(), z.number(), z.null()]).optional(),
    unit: z.string().nullable().optional(),
    evidence: z.array(BomEvidence).optional(),
  })
  .passthrough();

export const BomComponent = z
  .object({
    source_file: z.string().optional(),
    sheet_name: z.string(),
    sheet_index_0based: z.number().int().optional(),
    source_rows_1based: z.array(z.number().int()).optional(),
    component_type: z.string().nullable().optional(),
    part_number: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    quantity: z.number().int().nullable().optional(),
    reference_designators: z.array(z.string()).optional(),
    package: z.string().nullable().optional(),
    footprint: z.string().nullable().optional(),
    size_code: z.string().nullable().optional(),
    value_raw: z.string().nullable().optional(),
    raw_fields: z.record(z.string(), BomRawValue).optional(),
    field_states: z.record(z.string(), BomFieldState).optional(),
    evidence: z.array(BomEvidence).optional(),
    attributes: z.array(BomAttribute).optional(),
    uncertain_fields: z.array(z.string()).optional(),
    quality_flags: z.array(z.string()).optional(),
    review_status: z.enum(['extracted', 'review']).optional(),
    resistance_ohm: z.number().nullable().optional(),
    capacitance_f: z.number().nullable().optional(),
    inductance_h: z.number().nullable().optional(),
    power_w: z.number().nullable().optional(),
    tolerance_percent: z.number().nullable().optional(),
    voltage_v: z.number().nullable().optional(),
    current_a: z.number().nullable().optional(),
    frequency_hz: z.number().nullable().optional(),
    temperature_min_c: z.number().nullable().optional(),
    temperature_max_c: z.number().nullable().optional(),
    evidence_exact_rate: z.number().nullable().optional(),
    part_number_supported: z.boolean().nullable().optional(),
    confidence: z.number().nullable().optional(),
  })
  .passthrough();
export type BomComponentType = z.infer<typeof BomComponent>;

export const BomSheet = z
  .object({
    sheet_index_0based: z.number().int(),
    sheet_name: z.string(),
    status: z.enum(['parsed', 'not_bom', 'error']),
    component_count: z.number().int(),
    column_count: z.number().int(),
    header_rows_1based: z.array(z.number().int()).optional(),
    header_labels: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
    unparsed_reason: z.string().nullable().optional(),
  })
  .passthrough();
export type BomSheetType = z.infer<typeof BomSheet>;

export const BomHeader = z
  .object({
    source_file: z.string().optional(),
    sheet_name: z.string(),
    header_rows_1based: z.array(z.number().int()).optional(),
    column_1based: z.number().int(),
    raw_header: z.string(),
    semantic_field: z.string(),
    confidence: z.number(),
    source: z.enum(['rule', 'local_model']).optional(),
  })
  .passthrough();
export type BomHeaderType = z.infer<typeof BomHeader>;

export const BomFailure = z
  .object({
    source_file: z.string().optional(),
    sheet_name: z.string(),
    status: z.string(),
    reason: z.string().nullable().optional(),
  })
  .passthrough();
export type BomFailureType = z.infer<typeof BomFailure>;

export const BomResultSummary = z
  .object({
    component_count: z.number().int(),
    sheet_count: z.number().int().optional(),
    parsed_sheet_count: z.number().int().optional(),
    header_not_found_sheet_count: z.number().int().optional(),
    header_mapping_count: z.number().int().optional(),
    review_component_count: z.number().int().optional(),
    failure_count: z.number().int().optional(),
    field_status_counts: z.record(z.string(), z.number()).optional(),
    sheet_status_counts: z.record(z.string(), z.number()).optional(),
    processing_ms: z.number().optional(),
    parser_version: z.string().optional(),
    header_embedding: z.string().optional(),
  })
  .passthrough();
export type BomResultSummaryType = z.infer<typeof BomResultSummary>;

export const BomResult = z
  .object({
    schema_version: z.string(),
    engine: z.literal('smartbom'),
    model: z.string().nullable().optional(),
    prompt_version: z.string().nullable().optional(),
    parser_version: z.string().optional(),
    source_file: z.string(),
    summary: BomResultSummary,
    sheets: z.array(BomSheet),
    components: z.array(BomComponent),
    headers: z.array(BomHeader),
    failures: z.array(BomFailure),
  })
  .passthrough();
export type BomResultType = z.infer<typeof BomResult>;

export const BomResultResponse = z.object({ result: z.literal(true), data: BomResult });
export type BomResultResponseType = z.infer<typeof BomResultResponse>;

// ── 잡 뷰(폴링 대상) ─────────────────────────────────────────────────────────
export const BomSupplierView = z.object({
  status: z.enum(['running', 'completed', 'failed']).nullable(),
  progress: z.number().int(),
  message: z.string(),
  error: z.string().nullable(),
  result_available: z.boolean(),
});
export type BomSupplierViewType = z.infer<typeof BomSupplierView>;

export const BomJobView = z.object({
  job_id: z.string(),
  engine: z.literal('smartbom'),
  filename: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  progress: z.number().int(),
  message: z.string(),
  error: z.string().nullable(),
  result_available: z.boolean(),
  supplier_search: BomSupplierView,
});
export type BomJobViewType = z.infer<typeof BomJobView>;

export const BomJobResponse = z.object({ result: z.literal(true), data: BomJobView });
export type BomJobResponseType = z.infer<typeof BomJobResponse>;

// ── 공급사 검색: 사전점검 → 승인 실행 → 결과 ─────────────────────────────────
export const BomSupplierOptions = z
  .object({
    max_calls: z.number().int().min(1).max(1_000).default(700),
    cache_only: z.boolean().default(false),
    reset_cache: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.cache_only && value.reset_cache) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'cache_only와 reset_cache는 동시에 사용할 수 없습니다.' });
    }
  });
export type BomSupplierOptionsType = z.infer<typeof BomSupplierOptions>;

const BomSupplierBudget = z
  .object({
    supplier: z.string(),
    configured: z.boolean().optional(),
    daily_remaining: z.number().int().nullable().optional(),
    minute_remaining: z.number().int().nullable().optional(),
    estimated_calls: z.number().int(),
    retry_worst_case_calls: z.number().int(),
  })
  .passthrough();

export const BomSupplierPlan = z
  .object({
    component_count: z.number().int(),
    unique_query_count: z.number().int(),
    unique_supplier_request_count: z.number().int().optional(),
    estimated_api_calls: z.number().int(),
    retry_worst_case_api_calls: z.number().int(),
    job_call_limit: z.number().int(),
    estimated_within_job_limit: z.boolean(),
    retry_worst_case_within_job_limit: z.boolean(),
    cache_only: z.boolean(),
    fresh_cache_requests: z.number().int(),
    stale_cache_requests: z.number().int(),
    uncallable_requests: z.number().int(),
    supplier_budgets: z.array(BomSupplierBudget),
  })
  .passthrough();
export type BomSupplierPlanType = z.infer<typeof BomSupplierPlan>;

export const BomSupplierPreflight = z.object({
  analysis_job_id: z.string(),
  analysis_elapsed_ms: z.number().nullable(),
  preflight_elapsed_ms: z.number(),
  reset_cache: z.boolean(),
  plan: BomSupplierPlan,
});
export type BomSupplierPreflightType = z.infer<typeof BomSupplierPreflight>;

export const BomSupplierPreflightResponse = z.object({ result: z.literal(true), data: BomSupplierPreflight });

export const BomSupplierStartResponse = z.object({ result: z.literal(true), data: BomSupplierView });
export type BomSupplierStartResponseType = z.infer<typeof BomSupplierStartResponse>;

export const BomSupplierPriceBreak = z.object({
  quantity: z.number().int(),
  unit_price: z.number(),
  currency: z.string(),
});
export type BomSupplierPriceBreakType = z.infer<typeof BomSupplierPriceBreak>;

export const BomSupplierOffer = z
  .object({
    supplier: z.string(),
    stock: z.number().int().nullable().optional(),
    moq: z.number().int().nullable().optional(),
    order_multiple: z.number().int().nullable().optional(),
    packaging: z.string().nullable().optional(),
    price_breaks: z.array(BomSupplierPriceBreak).optional(),
    lead_time: z.string().nullable().optional(),
    product_url: z.string().nullable().optional(),
  })
  .passthrough();

const BomSupplierCandidate = z
  .object({
    status: z.string(),
    identity_confidence: z.number(),
    specification_confidence: z.number(),
    conflicts: z.array(z.string()),
    missing_requirements: z.array(z.string()),
    corroborating_suppliers: z.array(z.string()),
    product: z
      .object({
        supplier: z.string(),
        manufacturer_part_number: z.string(),
        manufacturer: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        package: z.string().nullable().optional(),
        lifecycle_status: z.string().nullable().optional(),
        datasheet_url: z.string().nullable().optional(),
        offers: z.array(BomSupplierOffer),
      })
      .passthrough(),
  })
  .passthrough();

export const BomSupplierSearchComponent = z
  .object({
    component_id: z.string(),
    status: z.string(),
    reference_designators: z.array(z.string()),
    source_rows_1based: z.array(z.number().int()).optional(),
    api_calls: z.number().int(),
    candidates: z.array(BomSupplierCandidate),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();
export type BomSupplierSearchComponentType = z.infer<typeof BomSupplierSearchComponent>;

export const BomSupplierResult = z
  .object({
    supplier_search_schema_version: z.string(),
    analysis_job_id: z.string(),
    timing: z
      .object({
        analysis_elapsed_ms: z.number().nullable(),
        preflight_elapsed_ms: z.number(),
        cache_reset_elapsed_ms: z.number(),
        search_elapsed_ms: z.number(),
        known_pipeline_elapsed_ms: z.number(),
      })
      .passthrough(),
    summary: z
      .object({
        component_count: z.number().int(),
        status_counts: z.record(z.string(), z.number()),
        api_calls: z.number().int(),
        cache_hits: z.number().int(),
        cache_entries_cleared: z.number().int().optional(),
      })
      .passthrough(),
    preflight: BomSupplierPlan,
    search: z
      .object({
        components: z.array(BomSupplierSearchComponent),
        api_calls: z.number().int(),
        cache_hits: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();
export type BomSupplierResultType = z.infer<typeof BomSupplierResult>;

export const BomSupplierResultResponse = z.object({ result: z.literal(true), data: BomSupplierResult });
export type BomSupplierResultResponseType = z.infer<typeof BomSupplierResultResponse>;
