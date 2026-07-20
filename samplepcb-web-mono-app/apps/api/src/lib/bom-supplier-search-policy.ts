export interface SupplierPreflightBudget {
  estimated_api_calls?: number;
  estimated_within_job_limit?: boolean;
}

export interface AutomaticSupplierSearchDecision {
  start: boolean;
  estimatedApiCalls: number;
  estimateExceedsJobLimit: boolean;
  blockedReason: 'member_daily_search_limit_exceeded' | null;
}

/**
 * 사전 예상치는 실행 여부를 막는 하드 게이트가 아니다. 실제 호출 상한은
 * sp-engine의 원자적 job budget이 강제한다. 회원 일일 정책만 명시적 차단으로
 * 처리하고, 캐시 전용 모드로 조용히 의미를 바꾸지 않는다.
 */
export function decideAutomaticSupplierSearch(
  plan: SupplierPreflightBudget | undefined,
  dailySlotAvailable: boolean,
): AutomaticSupplierSearchDecision {
  const rawCalls = plan?.estimated_api_calls;
  const estimatedApiCalls =
    typeof rawCalls === 'number' && Number.isFinite(rawCalls)
      ? Math.max(0, Math.trunc(rawCalls))
      : 0;
  const needsLiveCalls = estimatedApiCalls > 0;
  const blockedReason = needsLiveCalls && !dailySlotAvailable
    ? 'member_daily_search_limit_exceeded'
    : null;
  return {
    start: blockedReason === null,
    estimatedApiCalls,
    estimateExceedsJobLimit: plan?.estimated_within_job_limit === false,
    blockedReason,
  };
}
