import { describe, expect, it } from 'vitest';
import { computeSmartsmtSheet, pickSmartsmtSheetEdits, readSmartsmtSheetInput } from '@sp/api-contract';
import type { SmartsmtSheetInput } from '@sp/api-contract';
import { buildSampleEnvelope } from './smartsmt-sample';

// 관리자 확정의 계산 — 항목 금액에서 합계를 낸다(계약 smartsmt-review.ts). 순수 함수만 본다.
// 기대값은 2026-11-18~19 에 실제로 받은 견적서 3건의 숫자다(SmartSMT 화면의 공급가액 · 부가세 · 최종합계와 같다).

const NONE = { lineAmounts: {}, blockAmounts: {} };
const rates = { indirect: 8, profit: 10, vat: 10 };

describe('SmartSMT 견적 계산 — 항목에서 합계로', () => {
  it('실제 견적(PCB+부품+SMT): 줄 합 873,750 → 공급가액 1,944,500 · 부가세 194,450 · 합계 2,138,950', () => {
    const input: SmartsmtSheetInput = {
      lines: [
        { code: 'SMT', amount: 790000 },
        { code: 'POST-01', amount: 83750 },
        { code: 'SMT-P03', amount: null },
      ],
      blocks: [
        { block: 'PCB', included: true, amount: 61000 },
        { block: 'PARTS', included: true, amount: 845485 },
        { block: 'SHIPPING', included: true, amount: null },
      ],
      rates,
    };
    expect(computeSmartsmtSheet(input, NONE)).toMatchObject({
      directCost: 873750,
      indirectCost: 69900,
      profit: 94365,
      smtSupplyPrice: 1038015,
      blockSum: 906485,
      supplyPrice: 1944500,
      vat: 194450,
      total: 2138950,
      unknownLines: ['SMT-P03'],
      unknownBlocks: ['SHIPPING'],
      complete: false,
    });
  });

  it('반올림 — 간접비 24,302.4 → 24,302, 부가세 103,801.5 → 103,802', () => {
    const small = computeSmartsmtSheet({ lines: [{ code: 'A', amount: 303780 }], blocks: [], rates }, NONE);
    expect(small).toMatchObject({ indirectCost: 24302, profit: 32808, smtSupplyPrice: 360890 });
    const smtOnly = computeSmartsmtSheet({ lines: [{ code: 'A', amount: 873750 }], blocks: [], rates }, NONE);
    expect(smtOnly).toMatchObject({ supplyPrice: 1038015, vat: 103802, total: 1141817, complete: true });
  });

  it('고친 금액이 SmartSMT 금액을 덮고, 빈 항목을 채우면 확정할 수 있다', () => {
    const input = readSmartsmtSheetInput(buildSampleEnvelope({ review: true }));
    const before = computeSmartsmtSheet(input, NONE);
    expect(before).toMatchObject({ directCost: 120000, unknownLines: ['SMT-P03'], unknownBlocks: ['SHIPPING'], complete: false });

    const after = computeSmartsmtSheet(input, {
      lineAmounts: { 'STN-01': 100000, 'SMT-P03': 30000 },
      blockAmounts: { SHIPPING: 5000 },
    });
    expect(after).toMatchObject({
      directCost: 130000,
      indirectCost: 10400,
      profit: 14040,
      smtSupplyPrice: 154440,
      blockSum: 107360, // PCB 87,000 + 부품 15,360 + 배송 5,000
      supplyPrice: 261800,
      vat: 26180,
      total: 287980,
      unknownLines: [],
      unknownBlocks: [],
      complete: true,
    });
  });

  it('0원은 정한 금액이다 — 빈 항목으로 세지 않는다', () => {
    const input = readSmartsmtSheetInput(buildSampleEnvelope({ review: true }));
    const totals = computeSmartsmtSheet(input, { lineAmounts: { 'SMT-P03': 0 }, blockAmounts: { SHIPPING: 0 } });
    expect(totals.complete).toBe(true);
    expect(totals.directCost).toBe(120000);
  });

  it('이 주문에서 사지 않는 블록은 합계에 들지 않고 빈 항목으로도 세지 않는다', () => {
    const totals = computeSmartsmtSheet(
      {
        lines: [{ code: 'A', amount: 1000 }],
        blocks: [
          { block: 'PCB', included: false, amount: null },
          { block: 'PARTS', included: false, amount: 999 },
        ],
        rates: { indirect: 0, profit: 0, vat: 10 },
      },
      NONE,
    );
    expect(totals).toMatchObject({ blockSum: 0, supplyPrice: 1000, vat: 100, total: 1100, complete: true });
  });

  it('이 견적에 없는 줄 · 사지 않는 블록의 금액은 버린다', () => {
    const input = readSmartsmtSheetInput(buildSampleEnvelope({ review: true }));
    expect(
      pickSmartsmtSheetEdits(input, {
        lineAmounts: { 'STN-01': 1, 'NO-SUCH': 2 },
        blockAmounts: { SHIPPING: 3, GHOST: 4 },
      }),
    ).toEqual({ lineAmounts: { 'STN-01': 1 }, blockAmounts: { SHIPPING: 3 } });
  });

  it('견적서를 읽을 수 없어도 죽지 않는다 — 항목 없음, 요율은 0 · 0 · 10', () => {
    for (const broken of [null, 'x', {}, { quote: { lines: 'no', integrated: { blocks: 3 } }, header: { controls: null } }]) {
      const input = readSmartsmtSheetInput(broken);
      expect(input).toEqual({ lines: [], blocks: [], rates: { indirect: 0, profit: 0, vat: 10 } });
      expect(computeSmartsmtSheet(input, NONE)).toMatchObject({ total: 0, complete: true });
    }
  });

  it('요율은 견적서가 실어 온 값을 쓴다 — SmartSMT 가 바꾸면 그대로 반영된다', () => {
    const envelope = buildSampleEnvelope({ review: true }) as { header: { controls: Record<string, number> } };
    envelope.header.controls['markup.indirect_cost_rate'] = 5;
    envelope.header.controls['markup.profit_rate'] = 20;
    const totals = computeSmartsmtSheet(readSmartsmtSheetInput(envelope), NONE);
    expect(totals).toMatchObject({ directCost: 120000, indirectCost: 6000, profit: 25200, rates: { indirect: 5, profit: 20, vat: 10 } });
  });
});
