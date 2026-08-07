import { describe, expect, it } from 'vitest';
import { splitVatIncluded } from './vat';

describe('splitVatIncluded', () => {
  it.each([
    [110_000, { supply: 100_000, vat: 10_000, total: 110_000 }],
    [100_000, { supply: 90_909, vat: 9_091, total: 100_000 }],
    [1, { supply: 1, vat: 0, total: 1 }],
    [0, { supply: 0, vat: 0, total: 0 }],
  ])('%i원의 공급가액과 부가세를 합계 오차 없이 역산한다', (total, expected) => {
    expect(splitVatIncluded(total)).toEqual(expected);
  });
});
