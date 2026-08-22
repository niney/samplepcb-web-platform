// 스캔 행 → 포장 행(D42 2단계) — 봉투 1개 = 포장 1개, 20개 초과는 lot/date code 로 합치고 꼬리는 마지막에 합친다.
import { describe, expect, it } from 'vitest';
import { packagesFromScans } from './bom-receiving-complete';

describe('packagesFromScans', () => {
  it('스캔 1건 = 포장 1개, 수량 0 은 버린다', () => {
    expect(
      packagesFromScans([
        { quantity: 10, lotCode: 'A', dateCode: '2534' },
        { quantity: 0, lotCode: null, dateCode: null },
        { quantity: 5, lotCode: null, dateCode: null },
      ]),
    ).toEqual([
      { quantity: 10, lotNo: 'A', dateCode: '2534' },
      { quantity: 5, lotNo: null, dateCode: null },
    ]);
  });

  it('20개를 넘으면 같은 lot/date code 끼리 합친다(총수량 보존)', () => {
    const scans = Array.from({ length: 25 }, (_, i) => ({ quantity: 1, lotCode: i % 2 === 0 ? 'EVEN' : 'ODD', dateCode: null }));
    const packages = packagesFromScans(scans);
    expect(packages).toHaveLength(2);
    expect(packages.reduce((s, p) => s + p.quantity, 0)).toBe(25);
    expect(packages.map((p) => p.lotNo).sort()).toEqual(['EVEN', 'ODD']);
  });

  it('합쳐도 20개를 넘으면 꼬리를 마지막 포장에 합친다', () => {
    const scans = Array.from({ length: 30 }, (_, i) => ({ quantity: 2, lotCode: `L${String(i)}`, dateCode: null }));
    const packages = packagesFromScans(scans);
    expect(packages).toHaveLength(20);
    expect(packages.reduce((s, p) => s + p.quantity, 0)).toBe(60);
    expect(packages[19]?.quantity).toBe(22); // 19개 + 꼬리 11개×2
  });
});
