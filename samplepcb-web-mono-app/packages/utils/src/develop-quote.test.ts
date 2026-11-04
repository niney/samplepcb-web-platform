import { describe, expect, it } from 'vitest';
import {
  AdminDevelopSettings,
  DEVELOP_DEFAULT_LABOR_PRESETS,
  DEVELOP_QUOTE_DEFAULT_UNIT,
  DevelopLaborPreset,
  computeDevelopQuoteAmounts,
  computeDevelopQuoteBreakdown,
  developBpPercent,
  developQuoteFileName,
  developQuoteItemAmount,
  developQuotePdfName,
  developQuoteQtyText,
  developQuoteRemarks,
  developQuoteSheetRows,
  developQuoteSurchargeText,
  developQuoteXlsxName,
  splitDevelopMilestoneAmounts,
} from '@sp/api-contract';

// 개발의뢰 견적 순수 함수(docs/DEVELOP_FLOW.md §5) — VAT 계산·마일스톤 분배·산출 내역.
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

describe('인건비 일 단위·기본값(2026-11-04 저녁)', () => {
  it('인건비 = 일일 노임비 × 참여 일수 — 새 줄의 단위는 일, 반나절(0.5일)도 받는다', () => {
    expect(DEVELOP_QUOTE_DEFAULT_UNIT).toEqual({ labor: '일', direct: '식' });
    expect(developQuoteItemAmount(400_000, 10)).toBe(4_000_000);
    expect(developQuoteItemAmount(325_000, 0.5)).toBe(162_500);
    expect(developQuoteQtyText(10, '일')).toBe('10일');
  });
  it('처음 값 5줄은 스키마를 통과하고, 참고 자동견적 HTML 의 예시 금액을 재현한다', () => {
    expect(DEVELOP_DEFAULT_LABOR_PRESETS.every((p) => DevelopLaborPreset.safeParse(p).success)).toBe(true);
    // PM 10일 · 회로 20일 · PCB 20일 · 펌웨어 14일 · QC 10일 = 20,800,000(참고 HTML 기본 줄)
    const days = [10, 20, 20, 14, 10];
    const sum = DEVELOP_DEFAULT_LABOR_PRESETS.reduce((a, p, i) => a + developQuoteItemAmount(p.dailyRate, days[i] ?? 0), 0);
    expect(sum).toBe(20_800_000);
  });
  it('기본값 검증 — 직무는 필수, 등급·담당 업무는 비워도 되고, 50줄까지', () => {
    expect(DevelopLaborPreset.safeParse({ role: ' ', grade: '', task: '', dailyRate: 1 }).success).toBe(false);
    expect(DevelopLaborPreset.safeParse({ role: 'QA', grade: '', task: '', dailyRate: 0 }).success).toBe(true);
    expect(DevelopLaborPreset.safeParse({ role: 'QA', grade: '', task: '', dailyRate: 1.5 }).success).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ role: 'QA', grade: '', task: '', dailyRate: 1 }));
    expect(AdminDevelopSettings.shape.laborPresets.safeParse(many).success).toBe(false);
  });
});

describe('견적서 표기', () => {
  it('비율·수량 문구', () => {
    expect(developBpPercent(1500)).toBe('15');
    expect(developBpPercent(250)).toBe('2.5');
    expect(developQuoteSurchargeText('indirect', 1500)).toBe('15% (인건비+직접비)');
    expect(developQuoteQtyText(0.5, '개월')).toBe('0.5개월'); // 옛 줄은 저장된 단위 그대로
    expect(developQuoteQtyText(2, 'EA')).toBe('2 EA');
    expect(developQuoteQtyText(1.25, '')).toBe('1.25');
  });

  it('Remark — 납기·유효기간·결제 조건(명칭 비율%(시점))·산출물·별도 실비·승인 문구', () => {
    const remarks = developQuoteRemarks({
      durationDays: 120,
      scheduleNote: '1차 시제품 12월 말',
      validUntil: '2026-12-04',
      milestones: [
        { title: '계약금', ratioBp: 4000, trigger: 'on_accept' },
        { title: '중도금', ratioBp: 3000, trigger: 'manual' },
        { title: '잔금', ratioBp: 3000, trigger: 'on_completion' },
      ],
      deliverables: ['회로도', ' 거버 ', '', '펌웨어 소스'],
      exclusions: 'PCB 제작비·부품비 별도\n인증 시험비 별도',
    });
    expect(remarks.map((r) => [r.label, r.text])).toEqual([
      ['납기', '착수 후 120일 · 1차 시제품 12월 말'],
      ['견적 유효기간', '2026-12-04까지'],
      ['결제 조건', '계약금 40%(견적 수락 시), 중도금 30%(담당자가 청구할 때), 잔금 30%(검수 확정 시)'],
      ['산출물', '회로도 · 거버 · 펌웨어 소스'],
      ['별도 실비', 'PCB 제작비·부품비 별도\n인증 시험비 별도'],
      [null, '단계별 설계 및 개발 과정은 모두 발주처 승인 후 진행합니다.'],
    ]);
  });

  it('Remark — 산출물·별도 실비가 비어 있으면 그 줄을 뺀다', () => {
    const remarks = developQuoteRemarks({
      durationDays: null,
      scheduleNote: null,
      validUntil: '2026-12-04',
      milestones: [],
      deliverables: [' ', ''],
      exclusions: '   ',
    });
    expect(remarks.map((r) => r.label)).toEqual(['납기', '견적 유효기간', '결제 조건', null]);
  });

  it('Remark 결제 조건 — 명칭 안의 " (" 는 그대로 둔다(문자열 치환 없이 조립)', () => {
    const remarks = developQuoteRemarks({
      durationDays: null,
      scheduleNote: null,
      validUntil: '2026-12-04',
      milestones: [
        { title: '착수금 (1차)', ratioBp: 10_000, trigger: 'on_accept' },
        { title: '잔금', ratioBp: null, trigger: 'manual' },
      ],
      deliverables: [],
      exclusions: null,
    });
    expect(remarks[2]?.text).toBe('착수금 (1차) 100%(견적 수락 시), 잔금(담당자가 청구할 때)');
  });

  it('엑셀 파일 이름 — 80자는 글자 단위로 자른다(이모지를 반으로 쪼개면 encodeURIComponent 가 URIError)', () => {
    const name = developQuoteXlsxName({ title: `${'가'.repeat(79)}😀끝`, requestId: 12, version: 3 });
    expect(name).toBe(`${'가'.repeat(79)}😀 견적서 Q12-v3.xlsx`);
    expect(() => encodeURIComponent(name)).not.toThrow();
    // 짝 없는 서로게이트·경로 문자는 지운다
    const odd = developQuoteXlsxName({ title: 'A/B\uD83D: 견적', requestId: 1, version: 1 });
    expect(odd).toBe('A B 견적 견적서 Q1-v1.xlsx');
    expect(() => encodeURIComponent(odd)).not.toThrow();
  });

  it('PDF 파일 이름 — 엑셀과 같은 규칙, 발송 전 미리보기는 견적번호 자리에 그 글', () => {
    expect(developQuotePdfName({ title: 'RF 감지기 개발', requestId: 12, version: 3 })).toBe('RF 감지기 개발 견적서 Q12-v3.pdf');
    expect(developQuoteFileName('RF/감지기', '발송 전', 'pdf')).toBe('RF 감지기 견적서 발송 전.pdf');
    expect(developQuoteFileName('  ', 'Q1-v1', 'xlsx')).toBe('견적서 Q1-v1.xlsx');
  });

  it('표의 행 — 직접비 줄엔 기술등급을 싣지 않는다(칸이 없다)', () => {
    const items = [
      { itemId: 1, seq: 1, category: 'direct' as const, title: 'PCB 제작', grade: '무시됨', description: '4층', unitPrice: 1000, qty: 1, unit: '식', amount: 1000, durationDays: null },
    ];
    const rows = developQuoteSheetRows({ items, breakdown: computeDevelopQuoteBreakdown(items, { indirectBp: 0, overheadBp: 0, profitBp: 0 }, 'separate'), indirectBp: 0, overheadBp: 0, profitBp: 0 });
    expect(rows[0]?.kind === 'item' && rows[0].grade).toBeNull();
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
