import { describe, expect, it } from 'vitest';
import {
  deriveCatalogStatus,
  kstDayKey,
  supplierRunLimitedComponentCount,
  supplierRunSummarySnapshot,
} from './bom-supplier-operations';

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
            warnings: ['digikey: quota_exhausted'],
            search_trace: {
              attempts: [{ outcome: 'budget_exhausted' }],
            },
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

  it('구형 요약의 0건 오집계는 저장된 검색 trace에서 복구한다', () => {
    expect(supplierRunLimitedComponentCount(
      { budgetExhaustedCount: 0 },
      [
        { attempts: [{ outcome: 'results' }, { outcome: 'budget_exhausted' }] },
        { attempts: [{ outcome: 'empty' }] },
      ],
    )).toBe(1);
  });

  it('trace가 없어도 저장 요약의 제한 건수를 유지한다', () => {
    expect(supplierRunLimitedComponentCount({
      budgetExhaustedCount: 3,
      budgetExhaustedDetectionVersion: 2,
    })).toBe(3);
  });

  it('신규 0건 요약은 trace 복구 조회 없이 확정할 수 있다', () => {
    expect(supplierRunLimitedComponentCount({
      budgetExhaustedCount: 0,
      budgetExhaustedDetectionVersion: 2,
    })).toBe(0);
    expect(supplierRunLimitedComponentCount({ budgetExhaustedCount: 0 })).toBeNull();
  });
});

describe('deriveCatalogStatus 크래시 잔재 정직화', () => {
  const now = new Date('2026-07-22T00:00:00.000Z');

  it('lease가 만료된 running은 크래시 잔재이므로 failed로 표시한다', () => {
    expect(
      deriveCatalogStatus({ status: 'running', leaseUntil: new Date('2026-07-21T23:59:59.000Z') }, now),
    ).toBe('failed');
  });

  it('lease가 없는 running도 잔재로 보아 failed로 표시한다', () => {
    expect(deriveCatalogStatus({ status: 'running', leaseUntil: null }, now)).toBe('failed');
  });

  it('유효한 lease가 남은 running은 그대로 running이다', () => {
    expect(
      deriveCatalogStatus({ status: 'running', leaseUntil: new Date('2026-07-22T00:30:00.000Z') }, now),
    ).toBe('running');
  });

  it('running이 아닌 상태와 원장 없음은 기존 매핑을 유지한다', () => {
    expect(deriveCatalogStatus({ status: 'completed', leaseUntil: null }, now)).toBe('completed');
    expect(deriveCatalogStatus({ status: 'queued', leaseUntil: null }, now)).toBe('queued');
    expect(deriveCatalogStatus(null, now)).toBeNull();
  });
});
