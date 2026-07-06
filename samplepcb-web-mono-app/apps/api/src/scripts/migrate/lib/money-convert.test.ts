import { describe, expect, it } from 'vitest';
import { allocateVatIncl, convertOrderLineMoney } from './money-convert';

// 레거시 미수금 산식(shop.lib.php:1739-1743)의 VAT 항: (int)(cart_price*0.1) = trunc
const legacyVat = (sum: number): number => Math.floor(sum * 0.1);

describe('allocateVatIncl — 그룹 VAT 최대잔여법 배분', () => {
  it('단일 라인: 31,000 → 34,100 (레거시 미수금 항등)', () => {
    expect(allocateVatIncl([31000])).toEqual([34100]);
  });

  it('배분 합 불변식: Σincl == Σsupply + floor(Σsupply×0.1)', () => {
    const cases: number[][] = [
      [105, 105, 105], // 개별 floor 합(30) < 전체 floor(31) — 잔여 1 배분
      [33, 33, 33],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [0, 0, 35000],
      [12345, 67890, 11111, 99999],
      [],
    ];
    for (const supplies of cases) {
      const incls = allocateVatIncl(supplies);
      const supplySum = supplies.reduce((a, b) => a + b, 0);
      expect(incls.reduce((a, b) => a + b, 0)).toBe(supplySum + legacyVat(supplySum));
      // 라인별 오차는 최대 1원(잔여 배분 단위)
      incls.forEach((incl, i) => {
        const s = supplies[i] ?? 0;
        expect(incl - s).toBeGreaterThanOrEqual(Math.floor(s * 0.1));
        expect(incl - s).toBeLessThanOrEqual(Math.floor(s * 0.1) + 1);
      });
    }
  });

  it('잔여 배분은 소수부 큰 순, 동률은 앞 라인 우선(결정적)', () => {
    // 105×3: frac 0.5 동률 → 첫 라인이 +1
    expect(allocateVatIncl([105, 105, 105])).toEqual([116, 115, 115]);
    // 19(1.9→frac .9) vs 12(1.2→frac .2): 합 31, vat 3, base 1+1=2 → 잔여 1은 19 쪽
    expect(allocateVatIncl([19, 12])).toEqual([21, 13]);
  });
});

describe('convertOrderLineMoney — 활성/취소 그룹 분리', () => {
  it('활성·취소를 각자 그룹으로 VAT 배분한다', () => {
    const r = convertOrderLineMoney([
      { key: 'a', supply: 1000, cancelled: false },
      { key: 'b', supply: 500, cancelled: true },
    ]);
    expect(r.inclByKey.a).toBe(1100);
    expect(r.inclByKey.b).toBe(550);
    expect(r.activeIncl).toBe(1100); // → od_cart_price
    expect(r.cancelIncl).toBe(550); // → od_cancel_price
    expect(r.activeSupply).toBe(1000);
    expect(r.activeVat).toBe(100);
  });

  it('전액 취소 주문: activeIncl 0', () => {
    const r = convertOrderLineMoney([{ key: 'x', supply: 80000, cancelled: true }]);
    expect(r.activeIncl).toBe(0);
    expect(r.cancelIncl).toBe(88000);
  });

  it('빈 주문(라인 0)도 안전', () => {
    const r = convertOrderLineMoney([]);
    expect(r.activeIncl).toBe(0);
    expect(r.cancelIncl).toBe(0);
    expect(Object.keys(r.inclByKey)).toHaveLength(0);
  });

  it('레거시 misu 항등: 활성 Σincl == 활성 Σsupply + floor(Σ×0.1) — 다건 케이스', () => {
    const supplies = [31000, 64000, 105, 77, 123456];
    const r = convertOrderLineMoney(supplies.map((s, i) => ({ key: String(i), supply: s, cancelled: false })));
    const sum = supplies.reduce((a, b) => a + b, 0);
    expect(r.activeIncl).toBe(sum + legacyVat(sum));
  });
});
