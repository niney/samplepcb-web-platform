import { z } from 'zod';

// BOM 추출 + 공급사 검색 — sp-engine(Python) 프록시 계약.
// sp-node 는 엔진 응답을 {result:true,data} 봉투로 감싸 전달한다. 엔진 결과(G-shape
// AnalysisResult)는 필드가 방대하므로, UI 가 읽는 필드만 타입화하고 나머지는
// .passthrough() 로 보존한다(엔진 계약의 단일 진실원본은 Python pydantic).

// ── 추출 결과(G-shape) — 표시용 부분 타입 ────────────────────────────────────
export const BomComponent = z
  .object({
    sheet_name: z.string().optional(),
    part_number: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    quantity: z.union([z.string(), z.number()]).nullable().optional(),
    package: z.string().nullable().optional(),
    component_type: z.string().nullable().optional(),
    reference_designators: z.array(z.string()).optional(),
    review_status: z.string().optional(),
    confidence: z.number().nullable().optional(),
  })
  .passthrough();
export type BomComponentType = z.infer<typeof BomComponent>;

export const BomResultSummary = z
  .object({
    component_count: z.number().int(),
    sheet_count: z.number().int().optional(),
    parsed_sheet_count: z.number().int().optional(),
    header_not_found_sheet_count: z.number().int().optional(),
    review_component_count: z.number().int().optional(),
    failure_count: z.number().int().optional(),
    processing_ms: z.number().optional(),
  })
  .passthrough();

export const BomResult = z
  .object({
    schema_version: z.string(),
    engine: z.string(),
    source_file: z.string(),
    summary: BomResultSummary,
    components: z.array(BomComponent),
  })
  .passthrough();
export type BomResultType = z.infer<typeof BomResult>;

export const BomResultResponse = z.object({ result: z.literal(true), data: BomResult });
export type BomResultResponseType = z.infer<typeof BomResultResponse>;

// ── 잡 뷰(폴링 대상) ─────────────────────────────────────────────────────────
export const BomSupplierView = z.object({
  status: z.string().nullable(),      // null|running|completed|failed
  progress: z.number().int(),
  message: z.string(),
  error: z.string().nullable(),
  result_available: z.boolean(),
});
export type BomSupplierViewType = z.infer<typeof BomSupplierView>;

export const BomJobView = z.object({
  job_id: z.string(),
  engine: z.string(),
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

// ── 공급사 검색 뷰/결과 ──────────────────────────────────────────────────────
export const BomSupplierStartResponse = z.object({ result: z.literal(true), data: BomSupplierView });
export type BomSupplierStartResponseType = z.infer<typeof BomSupplierStartResponse>;

export const BomSupplierResult = z
  .object({
    supplier_search_schema_version: z.string(),
    analysis_job_id: z.string(),
    summary: z
      .object({
        component_count: z.number().int(),
        status_counts: z.record(z.string(), z.number()),
        api_calls: z.number().int(),
        cache_hits: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

export const BomSupplierResultResponse = z.object({ result: z.literal(true), data: BomSupplierResult });
export type BomSupplierResultResponseType = z.infer<typeof BomSupplierResultResponse>;
