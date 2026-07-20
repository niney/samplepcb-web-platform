import { describe, expect, it } from 'vitest';
import { normalizeSupplierPackaging } from './supplier-packaging';

describe('공급 포장 정규화', () => {
  it.each([
    ['卷带装', 'Tape & Reel'],
    ['Cut T&R, 卷带装', 'Cut T&R, Tape & Reel'],
    [', 卷带装', 'Tape & Reel'],
    ['托盘装, Tube', 'Tray, Tube'],
    ['0603', '0603'],
    ['', null],
  ])('UniKeyIC 값 %j을 영문 표시로 변환한다', (value, expected) => {
    expect(normalizeSupplierPackaging('unikeyic', value)).toBe(expected);
  });

  it('다른 공급사의 값은 번역하지 않는다', () => {
    expect(normalizeSupplierPackaging('mouser', '卷带装')).toBe('卷带装');
  });

  it('없는 값은 null로 유지한다', () => {
    expect(normalizeSupplierPackaging('unikeyic', null)).toBeNull();
    expect(normalizeSupplierPackaging('unikeyic', undefined)).toBeNull();
  });
});
