import { describe, expect, it } from 'vitest';
import { pcbMarginPercent, pcbSellingPrice } from '@sp/api-contract';

// 원가↔판매가 환산(선정 모달 · RFQ 워크큐 마진 배지 공용) — 명세는 셋이다:
// ① 판매가는 VAT 를 포함한다 ② 역산은 그 VAT 를 반드시 걷어낸다 ③ 원가보다 싼 값도 말한다.
describe('pcbSellingPrice', () => {
  it('판매가 = 원가 × (1+마진%) × 1.1(VAT)', () => {
    expect(pcbSellingPrice(100_000, 20)).toBe(132_000);
    expect(pcbSellingPrice(50_000, 0)).toBe(55_000); // 마진 0 이어도 VAT 는 붙는다
  });

  it('원 단위로 반올림한다 — 화면이 소수 원을 말하지 않게', () => {
    expect(pcbSellingPrice(33_333, 15)).toBe(Math.round(33_333 * 1.15 * 1.1));
    expect(Number.isInteger(pcbSellingPrice(12_345, 7))).toBe(true);
  });
});

describe('pcbMarginPercent', () => {
  it('VAT 를 걷어낸 뒤 원가와 비교한다 — 안 걷어내면 마진이 10%p 가까이 부풀어 보인다', () => {
    // 확정가 60,000 / 원가 50,000: 눈으로 빼면 20% 지만 VAT 를 빼면 9.1% 다.
    expect(pcbMarginPercent(60_000, 50_000)).toBe(9.1);
    expect(pcbMarginPercent(132_000, 100_000)).toBe(20);
  });

  it('정방향과 왕복이 맞는다 — 선정 모달에서 넣은 마진%가 목록 배지에 그대로 나와야 한다', () => {
    for (const [cost, margin] of [
      [100_000, 20],
      [280_000, 35],
      [57_178, 12.5],
    ] as const) {
      expect(pcbMarginPercent(pcbSellingPrice(cost, margin), cost)).toBe(margin);
    }
  });

  it('원가가 0 이하면 나눌 수 없어 null', () => {
    expect(pcbMarginPercent(60_000, 0)).toBeNull();
    expect(pcbMarginPercent(60_000, -1)).toBeNull();
  });

  it('원가보다 싸게 판 건은 음수 그대로 — 감출 게 아니라 보여야 할 신호다', () => {
    expect(pcbMarginPercent(50_000, 60_000)).toBe(-24.2);
  });

  it('소수 첫째 자리까지만 말한다', () => {
    expect(pcbMarginPercent(60_001, 50_000)).toBe(9.1);
  });
});
