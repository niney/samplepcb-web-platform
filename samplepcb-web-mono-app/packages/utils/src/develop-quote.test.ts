import { describe, expect, it } from 'vitest';
import {
  computeDevelopQuoteAmounts,
  computeDevelopQuoteBreakdown,
  computeDevelopQuoteMargin,
  developBpPercent,
  developQuoteItemAmount,
  developQuoteQtyText,
  developQuoteRemarks,
  developQuoteSheetRows,
  developQuoteSurchargeText,
  parseDevelopQuoteLines,
  splitDevelopMilestoneAmounts,
} from '@sp/api-contract';

// 개발의뢰 견적 순수 함수(docs/DEVELOP_FLOW.md §5) — 붙여넣기 파싱·VAT 계산·마일스톤 분배.
describe('parseDevelopQuoteLines', () => {
  it('사용자 예시 4줄을 항목으로 읽는다', () => {
    const text = ['H/W 회로·PCB 설계 3,600,000원', '펌웨어·BLE 통신 3,200,000원', 'Android 앱 2,800,000원', '시제품·통합 검증 2,100,000원'].join('\n');
    const r = parseDevelopQuoteLines(text);
    expect(r.rejected).toEqual([]);
    expect(r.items).toEqual([
      { title: 'H/W 회로·PCB 설계', amount: 3_600_000 },
      { title: '펌웨어·BLE 통신', amount: 3_200_000 },
      { title: 'Android 앱', amount: 2_800_000 },
      { title: '시제품·통합 검증', amount: 2_100_000 },
    ]);
  });

  it('만원 단위·콜론·탭·KRW 표기를 허용하고 금액 없는 줄은 rejected', () => {
    const r = parseDevelopQuoteLines('회로 설계: 320만원\n앱\t2800000\n검증 - 1,000 KRW\n총액은 협의\n\n');
    expect(r.items).toEqual([
      { title: '회로 설계', amount: 3_200_000 },
      { title: '앱', amount: 2_800_000 },
      { title: '검증', amount: 1_000 },
    ]);
    expect(r.rejected).toEqual(['총액은 협의']);
  });

  it('0 원·제목 없음은 rejected', () => {
    const r = parseDevelopQuoteLines('0원\n설계 0');
    expect(r.items).toEqual([]);
    expect(r.rejected).toHaveLength(2);
  });
});

describe('computeDevelopQuoteAmounts', () => {
  it('separate: 공급가 합 + 10%', () => {
    expect(computeDevelopQuoteAmounts([3_600_000, 3_200_000, 2_800_000, 2_100_000], 'separate')).toEqual({
      supplyAmount: 11_700_000,
      vatAmount: 1_170_000,
      totalAmount: 12_870_000,
    });
  });
  it('included: 합계에서 공급가 역산, 합은 보존', () => {
    const a = computeDevelopQuoteAmounts([1_100_000], 'included');
    expect(a.totalAmount).toBe(1_100_000);
    expect(a.supplyAmount + a.vatAmount).toBe(1_100_000);
    expect(a.supplyAmount).toBe(1_000_000);
  });
  it('exempt: VAT 0', () => {
    expect(computeDevelopQuoteAmounts([500], 'exempt')).toEqual({ supplyAmount: 500, vatAmount: 0, totalAmount: 500 });
  });
});

describe('splitDevelopMilestoneAmounts', () => {
  it('비율 분배의 반올림 차액을 마지막이 흡수해 합이 정확하다', () => {
    const out = splitDevelopMilestoneAmounts(1_000_001, [3333, 3333, 3334]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(out).toHaveLength(3);
  });
  it('단일 마일스톤은 전액', () => {
    expect(splitDevelopMilestoneAmounts(12_870_000, [10_000])).toEqual([12_870_000]);
  });
});

// 참고 견적서 '변압기 상태진단 … RF 부분방전 감지기'(2025-09-18) 의 표를 그대로 넣는다(2026-11-04, §5.1).
const REFERENCE_ITEMS = [
  { category: 'labor', title: 'PM', grade: '특급', description: '시스템 설계', unitPrice: 8_000_000, qty: 0.5, unit: '개월' },
  { category: 'labor', title: '회로개발자', grade: '고급', description: 'RF 및 디지털 회로', unitPrice: 7_000_000, qty: 1, unit: '개월' },
  { category: 'labor', title: 'PCB설계자', grade: '고급', description: 'MLB, RF PCB설계', unitPrice: 5_000_000, qty: 1, unit: '개월' },
  { category: 'labor', title: 'FPGA', grade: '고급', description: '신호처리, Verilog', unitPrice: 7_000_000, qty: 2, unit: '개월' },
  { category: 'labor', title: '펌웨어', grade: '중급', description: '임베디드 코딩', unitPrice: 6_500_000, qty: 2, unit: '개월' },
  { category: 'labor', title: 'QC', grade: '중급', description: '디버깅 테스트', unitPrice: 4_500_000, qty: 1, unit: '개월' },
  { category: 'direct', title: 'PCB 제작', grade: null, description: '6층 빌드업, RF매칭', unitPrice: 1_300_000, qty: 3, unit: '회' },
  { category: 'direct', title: '재료비', grade: null, description: '전자부품, 도급', unitPrice: 450_000, qty: 10, unit: '식' },
  { category: 'direct', title: 'SMT', grade: null, description: '양면, 메탈마스크', unitPrice: 1_500_000, qty: 3, unit: '회' },
] as const;
const referenceAmounts = REFERENCE_ITEMS.map((it) => ({ category: it.category, amount: developQuoteItemAmount(it.unitPrice, it.qty) }));

describe('developQuoteItemAmount', () => {
  it('단가 × 수량(소수 둘째 자리) — 0.5개월', () => {
    expect(developQuoteItemAmount(8_000_000, 0.5)).toBe(4_000_000);
    expect(developQuoteItemAmount(1_234_567, 1.25)).toBe(1_543_209); // 1,543,208.75 → 반올림
    expect(developQuoteItemAmount(1000, 0.1 + 0.2)).toBe(300); // 부동소수 0.30000000000000004 → 0.3
  });
});

describe('computeDevelopQuoteBreakdown', () => {
  it('참고 견적서 숫자를 재현한다 — 인건비 47,500,000 · 직접비 12,900,000 · 간접비 15% · 일반관리비 5%', () => {
    const b = computeDevelopQuoteBreakdown(referenceAmounts, { indirectBp: 1500, overheadBp: 500, profitBp: 1000 }, 'separate');
    expect(b.laborSubtotal).toBe(47_500_000);
    expect(b.directSubtotal).toBe(12_900_000);
    expect(b.indirectAmount).toBe(9_060_000);
    expect(b.overheadAmount).toBe(3_473_000);
    // 이윤 10% = 7,293,300 → 천 원 미만 버림. (참고 견적서는 표기 10% 인데 식이 8% 라 5,834,640 이었다)
    expect(b.profitAmount).toBe(7_293_000);
    expect(b.supplyAmount).toBe(80_226_000);
    expect(b.vatAmount).toBe(8_022_600);
    expect(b.totalAmount).toBe(88_248_600);
  });

  it('비율이 모두 0 이면 옛 견적과 같다(공급가 = 항목 합계)', () => {
    const items = [{ category: 'labor' as const, amount: 3_600_000 }, { category: 'direct' as const, amount: 1_234 }];
    expect(computeDevelopQuoteBreakdown(items, { indirectBp: 0, overheadBp: 0, profitBp: 0 }, 'separate')).toMatchObject(
      computeDevelopQuoteAmounts([3_600_000, 1_234], 'separate'),
    );
  });

  it('가산 행 하나만 있어도 앞 합계 기준 — 면세면 VAT 0', () => {
    const b = computeDevelopQuoteBreakdown([{ category: 'labor', amount: 10_000_000 }], { indirectBp: 0, overheadBp: 0, profitBp: 1000 }, 'exempt');
    expect(b.indirectAmount).toBe(0);
    expect(b.overheadAmount).toBe(0);
    expect(b.profitAmount).toBe(1_000_000);
    expect(b).toMatchObject({ supplyAmount: 11_000_000, vatAmount: 0, totalAmount: 11_000_000 });
  });
});

describe('computeDevelopQuoteMargin', () => {
  it('원가 금액 = 원가 단가 × 같은 수량 · 총 마진 = 공급가 − 원가 합계 · 미입력 줄 수', () => {
    const items = [
      { amount: developQuoteItemAmount(8_000_000, 0.5), qty: 0.5, costPrice: 6_000_000 }, // 원가 3,000,000
      { amount: developQuoteItemAmount(1_300_000, 3), qty: 3, costPrice: 900_000 }, // 원가 2,700,000
      { amount: 1_000_000, qty: 1, costPrice: null },
    ];
    const m = computeDevelopQuoteMargin(items, 10_492_000);
    expect(m).toEqual({
      costTotal: 5_700_000,
      costedRows: 2,
      missingRows: 1,
      itemMargin: 4_000_000 - 3_000_000 + 3_900_000 - 2_700_000,
      totalMargin: 10_492_000 - 5_700_000,
      marginRate: (10_492_000 - 5_700_000) / 10_492_000,
    });
  });
  it('공급가 0 이면 마진율 null', () => {
    expect(computeDevelopQuoteMargin([], 0).marginRate).toBeNull();
  });
});

describe('견적서 표기', () => {
  it('비율·수량 문구', () => {
    expect(developBpPercent(1500)).toBe('15');
    expect(developBpPercent(250)).toBe('2.5');
    expect(developQuoteSurchargeText('indirect', 1500)).toBe('15% (인건비+직접비)');
    expect(developQuoteQtyText(0.5, '개월')).toBe('0.5개월');
    expect(developQuoteQtyText(3, 'M/M')).toBe('3 M/M');
    expect(developQuoteQtyText(1.25, '')).toBe('1.25');
  });

  it('Remark — 납기·유효기간·결제 조건(명칭 비율%(시점))·승인 문구', () => {
    const remarks = developQuoteRemarks({
      durationDays: 120,
      scheduleNote: '1차 시제품 12월 말',
      validUntil: '2026-12-04',
      milestones: [
        { title: '계약금', ratioBp: 4000, trigger: 'on_accept' },
        { title: '중도금', ratioBp: 3000, trigger: 'manual' },
        { title: '잔금', ratioBp: 3000, trigger: 'on_completion' },
      ],
    });
    expect(remarks.map((r) => r.text)).toEqual([
      '착수 후 120일 · 1차 시제품 12월 말',
      '2026-12-04까지',
      '계약금 40%(견적 수락 시), 중도금 30%(담당자가 청구할 때), 잔금 30%(검수 확정 시)',
      '단계별 설계 및 개발 과정은 모두 발주처 승인 후 진행합니다.',
    ]);
    expect(remarks[3]?.label).toBeNull();
  });

  it('표의 행 — 순위는 나타난 구분 순서, 가산 0% 행은 빠진다', () => {
    const items = REFERENCE_ITEMS.map((it, i) => ({
      itemId: i + 1,
      seq: i + 1,
      ...it,
      amount: developQuoteItemAmount(it.unitPrice, it.qty),
      durationDays: null,
    }));
    const rates = { indirectBp: 1500, overheadBp: 0, profitBp: 1000 };
    const breakdown = computeDevelopQuoteBreakdown(items, rates, 'separate');
    const rows = developQuoteSheetRows({ items, breakdown, ...rates });
    expect(rows.map((r) => (r.kind === 'item' ? `${String(r.rank)}:${r.title}` : r.kind === 'subtotal' ? r.label : `${String(r.rank)}:${r.label}`))).toEqual([
      '1:PM', '1:회로개발자', '1:PCB설계자', '1:FPGA', '1:펌웨어', '1:QC', '인건비 소계',
      '2:PCB 제작', '2:재료비', '2:SMT', '직접비 소계',
      '3:간접비', '4:기업이윤',
    ]);
    const first = rows[0];
    expect(first?.kind === 'item' && first.groupFirst && first.groupSize === 6 && first.qtyText === '0.5개월').toBe(true);
    // 인건비만 있는 견적은 직접비 소계가 없고 순위가 이어진다.
    const laborOnly = developQuoteSheetRows({ items: items.slice(0, 1), breakdown, indirectBp: 1500, overheadBp: 0, profitBp: 0 });
    expect(laborOnly.map((r) => r.kind)).toEqual(['item', 'subtotal', 'surcharge']);
    expect(laborOnly[2]?.kind === 'surcharge' && laborOnly[2].rank).toBe(2);
  });
});
