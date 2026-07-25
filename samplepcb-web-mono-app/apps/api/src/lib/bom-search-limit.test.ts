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
} as const;

describe('BOM 공급사 검색 호출 상한', () => {
  it('작업과 관리자 설정에서 3,000회를 허용한다', () => {
    expect(BomSupplierOptions.parse({ max_calls: 3_000 }).max_calls).toBe(3_000);
    expect(BomQuoteConfig.parse(config).supplierSearchMaxCalls).toBe(3_000);
  });

  it('3,001회는 작업과 관리자 설정에서 모두 거부한다', () => {
    expect(() => BomSupplierOptions.parse({ max_calls: 3_001 })).toThrow();
    expect(() => BomQuoteConfig.parse({
      ...config,
      supplierSearchMaxCalls: 3_001,
    })).toThrow();
  });
});
