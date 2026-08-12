import { describe, expect, it } from 'vitest';
import { AdminPcbRemittanceListQuery } from '@sp/api-contract';
import { matchesPcbLastRemittedRange } from './pcb-remittance-filter';

describe('PCB 최근 송금일 필터', () => {
  it('단일일과 양끝 포함 기간을 같은 범위 계약으로 받는다', () => {
    expect(
      AdminPcbRemittanceListQuery.safeParse({
        lastRemittedFrom: '2026-08-20',
        lastRemittedTo: '2026-08-20',
      }).success,
    ).toBe(true);
    expect(
      AdminPcbRemittanceListQuery.safeParse({
        lastRemittedFrom: '2026-08-20',
        lastRemittedTo: '2026-08-31',
      }).success,
    ).toBe(true);
  });

  it('한쪽 날짜 누락·역전 기간·실재하지 않는 날짜를 거부한다', () => {
    expect(
      AdminPcbRemittanceListQuery.safeParse({ lastRemittedFrom: '2026-08-20' }).success,
    ).toBe(false);
    expect(
      AdminPcbRemittanceListQuery.safeParse({
        lastRemittedFrom: '2026-08-31',
        lastRemittedTo: '2026-08-20',
      }).success,
    ).toBe(false);
    expect(
      AdminPcbRemittanceListQuery.safeParse({
        lastRemittedFrom: '2026-02-30',
        lastRemittedTo: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('KST 날짜로 양끝을 포함하고 송금 전 행은 제외한다', () => {
    const lastRemittedOn = '2026-08-19T15:00:00.000Z'; // KST 2026-08-20 00:00

    expect(matchesPcbLastRemittedRange(lastRemittedOn, '2026-08-20', '2026-08-20')).toBe(
      true,
    );
    expect(matchesPcbLastRemittedRange(lastRemittedOn, '2026-08-19', '2026-08-20')).toBe(
      true,
    );
    expect(matchesPcbLastRemittedRange(lastRemittedOn, '2026-08-19', '2026-08-19')).toBe(
      false,
    );
    expect(matchesPcbLastRemittedRange(null, '2026-08-20', '2026-08-20')).toBe(false);
  });

  it('필터가 없으면 최근 송금 여부와 관계없이 통과시킨다', () => {
    expect(matchesPcbLastRemittedRange(null, undefined, undefined)).toBe(true);
  });
});
