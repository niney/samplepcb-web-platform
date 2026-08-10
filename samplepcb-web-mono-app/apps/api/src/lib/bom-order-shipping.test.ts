import { describe, expect, it } from 'vitest';
import { areAllBomOrderCasesReceived } from './bom-order-shipping';

describe('Smart BOM 고객 배송 입고 게이트', () => {
  it('발주가 없거나 한 건도 입고되지 않은 주문은 배송 큐를 열지 않는다', () => {
    expect(areAllBomOrderCasesReceived([])).toBe(false);
    expect(
      areAllBomOrderCasesReceived([{ poCount: 0, poReceivedCount: 0, openShortageCount: 0 }]),
    ).toBe(false);
    expect(
      areAllBomOrderCasesReceived([{ poCount: 2, poReceivedCount: 0, openShortageCount: 0 }]),
    ).toBe(false);
  });

  it('여러 발주 가운데 일부만 입고된 주문은 배송 큐를 열지 않는다', () => {
    expect(
      areAllBomOrderCasesReceived([{ poCount: 2, poReceivedCount: 1, openShortageCount: 0 }]),
    ).toBe(false);
    expect(
      areAllBomOrderCasesReceived([
        { poCount: 1, poReceivedCount: 1, openShortageCount: 0 },
        { poCount: 1, poReceivedCount: 0, openShortageCount: 0 },
      ]),
    ).toBe(false);
  });

  it('모든 Case의 모든 발주가 입고된 경우에만 배송 큐를 연다', () => {
    expect(
      areAllBomOrderCasesReceived([{ poCount: 2, poReceivedCount: 2, openShortageCount: 0 }]),
    ).toBe(true);
    expect(
      areAllBomOrderCasesReceived([
        { poCount: 1, poReceivedCount: 1, openShortageCount: 0 },
        { poCount: 2, poReceivedCount: 2, openShortageCount: 0 },
      ]),
    ).toBe(true);
  });

  it('입고 수가 맞아도 대체발주가 연결되지 않은 부족분이 있으면 배송을 막는다', () => {
    expect(
      areAllBomOrderCasesReceived([{ poCount: 1, poReceivedCount: 1, openShortageCount: 1 }]),
    ).toBe(false);
  });
});
