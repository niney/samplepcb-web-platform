import { describe, expect, it } from 'vitest';
import { applyGerberPriceMode } from './gerber-price-mode';

// 거버 가격 정규화 — supply 부가세 10% 부가 / order 무변 / rfq(null) 불변 / 왕복 정합 고정.
describe('applyGerberPriceMode (거버 가격 정규화)', () => {
  it('order 모드는 그대로 통과(주문가 = 부가세 포함 총액)', () => {
    expect(applyGerberPriceMode(100_000, 'order')).toBe(100_000);
    expect(applyGerberPriceMode(93_000, 'order')).toBe(93_000);
  });

  it('supply 모드는 round(×1.1)로 부가세 10% 부가', () => {
    // 공급가 100,000 → 결제 110,000 (사용자 확인 시나리오)
    expect(applyGerberPriceMode(100_000, 'supply')).toBe(110_000);
    // 소수 반올림: 84,545 × 1.1 = 92,999.5 → 93,000
    expect(applyGerberPriceMode(84_545, 'supply')).toBe(93_000);
    // 12,345 × 1.1 = 13,579.5 → 13,580
    expect(applyGerberPriceMode(12_345, 'supply')).toBe(13_580);
  });

  it('rfq(null) 는 어느 모드든 불변', () => {
    expect(applyGerberPriceMode(null, 'order')).toBeNull();
    expect(applyGerberPriceMode(null, 'supply')).toBeNull();
  });

  it('왕복 정합 — supply 총액을 코어 역산하면 공급가 복원', () => {
    // 코어 get_order_info: od_tax_mny = round(총액/1.1) = 공급가
    const supply = 100_000;
    const total = applyGerberPriceMode(supply, 'supply');
    expect(total).toBe(110_000);
    expect(Math.round((total as number) / 1.1)).toBe(supply);
  });
});
