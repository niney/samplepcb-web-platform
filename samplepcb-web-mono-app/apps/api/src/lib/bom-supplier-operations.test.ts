import { describe, expect, it } from 'vitest';
import { kstDayKey, supplierRunSummarySnapshot } from './bom-supplier-operations';

describe('BOM 공급사 검색 운영 지표', () => {
  it('KST 자정 경계에서 일일 사용량 키를 계산한다', () => {
    expect(kstDayKey(new Date('2026-07-20T14:59:59.000Z'))).toBe('2026-07-20');
    expect(kstDayKey(new Date('2026-07-20T15:00:00.000Z'))).toBe('2026-07-21');
  });

  it('엔진 결과에서 실제 호출과 작업 예산 소진 행을 compact 지표로 만든다', () => {
    const summary = supplierRunSummarySnapshot({
      supplier_search_schema_version: '1.1',
      analysis_job_id: 'job-1',
      timing: {
        analysis_elapsed_ms: 1,
        preflight_elapsed_ms: 2,
        cache_reset_elapsed_ms: 0,
        search_elapsed_ms: 3000,
        known_pipeline_elapsed_ms: 3002,
      },
      summary: {
        component_count: 2,
        status_counts: { spec_compatible: 1, supplier_error: 1 },
        api_calls: 1,
        cache_hits: 0,
      },
      preflight: {
        preflight_schema_version: '1.0',
        source_file: 'bom.xlsx',
        component_count: 2,
        unique_query_count: 2,
        unique_supplier_request_count: 2,
        estimated_api_calls: 2,
        retry_worst_case_api_calls: 6,
        job_call_limit: 1,
        estimated_within_job_limit: false,
        retry_worst_case_within_job_limit: false,
        cache_only: false,
        fresh_cache_requests: 0,
        stale_cache_requests: 0,
        uncallable_requests: 0,
        supplier_budgets: [],
        components: [],
        created_at: '2026-07-21T00:00:00Z',
      },
      search: {
        api_calls: 1,
        cache_hits: 0,
        components: [
          { component_id: 'a', status: 'spec_compatible', reference_designators: [], api_calls: 1, candidates: [] },
          {
            component_id: 'b',
            status: 'supplier_error',
            reference_designators: [],
            api_calls: 0,
            candidates: [],
            warnings: ['digikey: job_call_limit_exhausted'],
          },
        ],
      },
    });

    expect(summary).toMatchObject({
      componentCount: 2,
      apiCalls: 1,
      cacheHits: 0,
      budgetExhaustedCount: 1,
      elapsedMs: 3002,
      engineElapsedMs: 3002,
    });
  });
});
