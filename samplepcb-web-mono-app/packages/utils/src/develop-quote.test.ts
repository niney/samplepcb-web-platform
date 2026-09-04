import { describe, expect, it } from 'vitest';
import { computeDevelopQuoteAmounts, parseDevelopQuoteLines, splitDevelopMilestoneAmounts } from '@sp/api-contract';

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
