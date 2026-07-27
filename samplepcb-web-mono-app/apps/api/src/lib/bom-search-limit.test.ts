import { describe, expect, it } from 'vitest';
import { BomQuoteConfig, BomSupplierOptions } from '@sp/api-contract';

const config = {
  defaultShippingFee: 30_000,
  defaultManagementFee: 25_000,
  usdKrwRate: null,
  usdKrwRateMode: 'auto',
  usdKrwAutoRateType: 'dealBasR',
  usdKrwSafetyMarginPercent: 2,
  usdKrwMaxAgeDays: 7,
  supplierSearchMaxCalls: 3_000,
  memberDailySearchLimit: 20,
  freshnessHours: 24,
  storedPartPrioritySearchEnabled: true,
} as const;

describe('BOM 공급사 검색 호출 상한', () => {
  it('작업과 관리자 설정에서 3,000회를 허용한다', () => {
    expect(BomSupplierOptions.parse({ max_calls: 3_000 }).max_calls).toBe(3_000);
    const parsed = BomQuoteConfig.parse(config);
    expect(parsed.supplierSearchMaxCalls).toBe(3_000);
    expect(parsed.storedPartPrioritySearchEnabled).toBe(true);
  });

  it('3,001회는 작업과 관리자 설정에서 모두 거부한다', () => {
    expect(() => BomSupplierOptions.parse({ max_calls: 3_001 })).toThrow();
    expect(() => BomQuoteConfig.parse({
      ...config,
      supplierSearchMaxCalls: 3_001,
    })).toThrow();
  });

  it('관리자가 저장 부품 우선 검색 실험을 명시적으로 끌 수 있다', () => {
    expect(BomQuoteConfig.parse({
      ...config,
      storedPartPrioritySearchEnabled: false,
    }).storedPartPrioritySearchEnabled).toBe(false);
  });
});
