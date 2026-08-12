import { describe, expect, it } from 'vitest';
import { AdminPcbPoWorkListQuery } from '@sp/api-contract';
import { resolvePcbDeliveryDateRange } from './pcb-delivery-filter';

describe('PCB 발주·EQ 납기 필터', () => {
  it('단일일과 양끝 포함 기간을 같은 범위 계약으로 받는다', () => {
    expect(
      AdminPcbPoWorkListQuery.safeParse({
        deliveryFrom: '2026-08-20',
        deliveryTo: '2026-08-20',
      }).success,
    ).toBe(true);
    expect(
      AdminPcbPoWorkListQuery.safeParse({
        deliveryFrom: '2026-08-20',
        deliveryTo: '2026-08-31',
      }).success,
    ).toBe(true);
  });

  it('한쪽 날짜 누락·역전 기간·실재하지 않는 날짜를 거부한다', () => {
    expect(
      AdminPcbPoWorkListQuery.safeParse({ deliveryFrom: '2026-08-20' }).success,
    ).toBe(false);
    expect(
      AdminPcbPoWorkListQuery.safeParse({
        deliveryFrom: '2026-08-31',
        deliveryTo: '2026-08-20',
      }).success,
    ).toBe(false);
    expect(
      AdminPcbPoWorkListQuery.safeParse({
        deliveryFrom: '2026-02-30',
        deliveryTo: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('KST 시작일 0시 이상·종료 다음 날 0시 미만으로 변환한다', () => {
    const range = resolvePcbDeliveryDateRange('2026-08-20', '2026-08-22');

    expect(range?.from.toISOString()).toBe('2026-08-19T15:00:00.000Z');
    expect(range?.toExclusive.toISOString()).toBe('2026-08-22T15:00:00.000Z');
  });

  it('납기 필터가 없으면 DB 범위를 만들지 않는다', () => {
    expect(resolvePcbDeliveryDateRange(undefined, undefined)).toBeUndefined();
  });
});
