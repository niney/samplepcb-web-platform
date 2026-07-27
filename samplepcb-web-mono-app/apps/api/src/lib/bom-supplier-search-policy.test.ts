import { describe, expect, it } from 'vitest';
import {
  decideAutomaticSupplierSearch,
  supplierSearchRunPolicyFromOptions,
} from './bom-supplier-search-policy';

describe('BOM 자동 공급사 검색 정책', () => {
  it('예상 호출이 작업 한도를 넘어도 실제 엔진 예산 안에서 검색을 시작한다', () => {
    const decision = decideAutomaticSupplierSearch(
      { estimated_api_calls: 360, estimated_within_job_limit: false },
      true,
    );

    expect(decision).toEqual({
      start: true,
      estimatedApiCalls: 360,
      estimateExceedsJobLimit: true,
      blockedReason: null,
    });
  });

  it('회원 일일 한도 소진은 캐시 전용으로 축퇴하지 않고 명시적으로 차단한다', () => {
    const decision = decideAutomaticSupplierSearch(
      { estimated_api_calls: 3, estimated_within_job_limit: true },
      false,
    );

    expect(decision.start).toBe(false);
    expect(decision.blockedReason).toBe('member_daily_search_limit_exceeded');
  });

  it('외부 호출이 필요 없으면 일일 슬롯 없이도 캐시 결과 검증을 허용한다', () => {
    const decision = decideAutomaticSupplierSearch(
      { estimated_api_calls: 0, estimated_within_job_limit: true },
      false,
    );

    expect(decision.start).toBe(true);
    expect(decision.blockedReason).toBeNull();
  });
});

describe('BOM 공급사 검색 실행 정책 스냅샷', () => {
  it('저장 부품 실험과 로컬 우회 값을 복구한다', () => {
    expect(supplierSearchRunPolicyFromOptions({
      local_catalog_bypass: true,
      stored_part_priority_search_enabled: false,
    })).toEqual({
      localCatalogBypass: true,
      storedPartPrioritySearchEnabled: false,
    });
  });

  it('구형 실행은 저장 부품 실험 설정을 미기록 상태로 읽는다', () => {
    expect(supplierSearchRunPolicyFromOptions({ max_calls: 300 })).toEqual({
      localCatalogBypass: false,
      storedPartPrioritySearchEnabled: null,
    });
  });
});
