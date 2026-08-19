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

export interface SupplierSearchRunPolicySnapshot {
  localCatalogBypass: boolean;
  storedPartPrioritySearchEnabled: boolean | null;
  forceLive: boolean;
  purpose: 'admin_rfq_compare' | null;
}

/** DB에만 저장하는 실행 정책을 안전하게 읽는다. 구형 실행의 미기록 값은 null이다. */
export function supplierSearchRunPolicyFromOptions(
  options: unknown,
): SupplierSearchRunPolicySnapshot {
  if (
    options === null
    || typeof options !== 'object'
    || Array.isArray(options)
  ) {
    return {
      localCatalogBypass: false,
      storedPartPrioritySearchEnabled: null,
      forceLive: false,
      purpose: null,
    };
  }
  const stored = options as Record<string, unknown>;
  return {
    localCatalogBypass: stored.local_catalog_bypass === true,
    storedPartPrioritySearchEnabled:
      typeof stored.stored_part_priority_search_enabled === 'boolean'
        ? stored.stored_part_priority_search_enabled
        : null,
    forceLive: stored.force_live === true,
    purpose: stored.purpose === 'admin_rfq_compare' ? 'admin_rfq_compare' : null,
  };
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
