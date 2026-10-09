import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { bomMdPoActionsFor, bomMdPoCanDelete } from '@sp/api-contract';
import { bomFxDiffKrw, bomRemittanceStatusOf, summarizeBomRemittances } from './bom-remittance';

// BOM 송금 원장(D48)·마스터딜러 하위 발주 진행 규칙(D47) — docs/SMARTBOM_PARTNER_RFQ.md §6.43·§6.44.

const row = (amount: string, krwAmount: number | null, day = '2026-10-09') => ({
  amount: new Prisma.Decimal(amount),
  krwAmount,
  remittedOn: new Date(`${day}T00:00:00+09:00`),
});

describe('bomRemittanceStatusOf', () => {
  it('미지급 · 일부 · 완료 · 초과', () => {
    expect(bomRemittanceStatusOf(100, 0)).toBe('unpaid');
    expect(bomRemittanceStatusOf(100, 40)).toBe('partial');
    expect(bomRemittanceStatusOf(100, 100)).toBe('paid');
    expect(bomRemittanceStatusOf(100, 100.004), '소수 2자리 밖은 잡음').toBe('paid');
    expect(bomRemittanceStatusOf(100, 101)).toBe('over');
  });
});

describe('summarizeBomRemittances', () => {
  const usdPo = { currency: 'USD', exchangeRate: new Prisma.Decimal('1352.59') };

  it('원화 발주 — 환율·환차가 없다', () => {
    const summary = summarizeBomRemittances(
      { currency: 'KRW', exchangeRate: null },
      46_100,
      [row('20000', null)],
    );
    expect(summary).toMatchObject({
      currency: 'KRW',
      poAmount: 46_100,
      paidAmount: 20_000,
      balance: 26_100,
      status: 'partial',
      count: 1,
      fxDiffKrw: null,
    });
  });

  it('외화 발주 — 잔액은 결제통화로, 환차는 실제 원화 − 장부 환율 원화', () => {
    // 40.86 달러를 장부(1,352.59)보다 30원 비싼 환율로 보냈다.
    const paidKrw = Math.round(40.86 * 1382.59);
    const summary = summarizeBomRemittances(usdPo, 81.72, [row('40.86', paidKrw)]);
    expect(summary.balance).toBe(40.86);
    expect(summary.status).toBe('partial');
    expect(summary.fxDiffKrw).toBe(paidKrw - Math.round(40.86 * 1352.59));
    expect(summary.fxDiffKrw).toBe(1226);
  });

  it('나눠 보낸 송금의 환차는 합쳐서 본다 — 가장 늦은 송금일을 남긴다', () => {
    const summary = summarizeBomRemittances(usdPo, 100, [
      row('60', Math.round(60 * 1400), '2026-10-01'),
      row('40', Math.round(40 * 1300), '2026-10-05'),
    ]);
    expect(summary.status).toBe('paid');
    expect(summary.balance).toBe(0);
    expect(summary.fxDiffKrw).toBe(
      Math.round(60 * 1400) - Math.round(60 * 1352.59) + (Math.round(40 * 1300) - Math.round(40 * 1352.59)),
    );
    expect(summary.lastRemittedOn).toBe(new Date('2026-10-05T00:00:00+09:00').toISOString());
  });

  it('장부 환율이 없는 외화 발주는 환차를 낼 수 없다', () => {
    expect(bomFxDiffKrw({ currency: 'USD', exchangeRate: null }, row('10', 14_000))).toBeNull();
  });
});

describe('하위 발주 진행 규칙', () => {
  it('하위는 확인·출고까지 — 수령은 발주처의 것', () => {
    expect(bomMdPoActionsFor('issued', 'child')).toEqual(['confirm']);
    expect(bomMdPoActionsFor('confirmed', 'child')).toEqual(['ship', 'revert']);
    expect(bomMdPoActionsFor('shipped', 'child')).toEqual(['revert']);
    expect(bomMdPoActionsFor('received', 'child'), '수령 뒤에는 하위가 되돌릴 수 없다').toEqual([]);
  });

  it('발주처는 전부(대행 포함) — 어느 단계든 한 칸 되돌린다', () => {
    expect(bomMdPoActionsFor('issued', 'parent')).toEqual(['confirm']);
    expect(bomMdPoActionsFor('confirmed', 'parent')).toEqual(['ship', 'revert']);
    expect(bomMdPoActionsFor('shipped', 'parent')).toEqual(['receive', 'revert']);
    expect(bomMdPoActionsFor('received', 'parent')).toEqual(['revert']);
  });

  it('삭제는 발주처만, 출고 전에만', () => {
    expect(bomMdPoCanDelete('issued', 'parent')).toBe(true);
    expect(bomMdPoCanDelete('confirmed', 'parent')).toBe(true);
    expect(bomMdPoCanDelete('shipped', 'parent')).toBe(false);
    expect(bomMdPoCanDelete('issued', 'child')).toBe(false);
  });
});
