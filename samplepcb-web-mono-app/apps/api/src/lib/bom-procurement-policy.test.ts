import { describe, expect, it } from 'vitest';
import { buildEngineProcurementPolicy } from './bom-procurement-policy';

describe('BOM 엔진 조달 정책 입력', () => {
  it('동일 환율 스냅샷을 결정론적인 엔진 입력으로 변환한다', () => {
    const snapshot = {
      mode: 'auto' as const,
      source: 'koreaexim' as const,
      rateType: 'dealBasR' as const,
      sourceRate: 1_300,
      safetyMarginPercent: 2,
      appliedRate: 1_326,
      rateDate: '2026-07-20',
      fetchedAt: '2026-07-21T00:00:00.000Z',
      stale: false,
      fallbackReason: null,
    };

    const first = buildEngineProcurementPolicy(1_326, snapshot);
    const second = buildEngineProcurementPolicy(1_326, snapshot);

    expect(first).toEqual(second);
    expect(first.currency_rates).toEqual([
      { source_currency: 'USD', target_currency: 'KRW', rate: 1_326 },
    ]);
    expect(first.currency_rate_as_of).toBe(snapshot.fetchedAt);
    expect(first.currency_rate_snapshot_id).toMatch(/^sp-node:[a-f0-9]{24}$/);
  });
});
