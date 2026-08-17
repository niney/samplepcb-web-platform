import { describe, expect, it } from 'vitest';
import {
  AdminOrderDeliveryFields,
  AdminOrderDeliveryRow,
  DELIVERY_METHOD_COMPANY_LABEL,
  SELECTABLE_DELIVERY_METHODS,
  deliveryCompanyForMethod,
  isParcelDeliveryMethod,
} from '@sp/api-contract';

// 배송방법(P1) 계약 규칙 박제 — 정본 docs/DELIVERY_METHOD.md.
// 핵심: method 없는 구 호출은 parcel 로 통과(하위호환), 택배만 회사·송장 필수(refine),
// 비택배는 일시만. 라벨 병용(deliveryCompanyForMethod)은 서버 기록 규칙의 단일 원천.

describe('AdminOrderDeliveryRow — 방법별 필수 필드(refine)', () => {
  const base = { odId: 'OD1', invoiceTime: '2026-08-17 10:00:00' };

  it('method 생략(구 계약 호출) → parcel 기본값 + 3필드 채우면 통과', () => {
    const r = AdminOrderDeliveryRow.parse({
      ...base,
      deliveryCompany: 'CJ대한통운',
      invoiceNo: '1234',
    });
    expect(r.method).toBe('parcel');
    expect(r.deliveryCompany).toBe('CJ대한통운');
  });

  it('택배인데 송장이 비면 실패', () => {
    const r = AdminOrderDeliveryRow.safeParse({ ...base, deliveryCompany: 'CJ', invoiceNo: '  ' });
    expect(r.success).toBe(false);
  });

  it('비택배(방문수령)는 회사·송장 생략 가능 — default 로 빈 문자열', () => {
    const r = AdminOrderDeliveryRow.parse({ ...base, method: 'pickup' });
    expect(r.method).toBe('pickup');
    expect(r.deliveryCompany).toBe('');
    expect(r.invoiceNo).toBe('');
  });

  it('비택배도 invoiceTime 은 필수', () => {
    const r = AdminOrderDeliveryRow.safeParse({ odId: 'OD1', method: 'quick_cod', invoiceTime: '' });
    expect(r.success).toBe(false);
  });

  it('force-status 용 Fields(odId 없음)도 같은 규칙', () => {
    expect(
      AdminOrderDeliveryFields.safeParse({ method: 'direct', invoiceTime: '2026-08-17 10:00:00' })
        .success,
    ).toBe(true);
    expect(
      AdminOrderDeliveryFields.safeParse({ invoiceTime: '2026-08-17 10:00:00' }).success,
    ).toBe(false); // method 생략=parcel 인데 회사·송장 없음
  });
});

describe('배송방법 어휘 — 라벨 병용·택배 판정', () => {
  it("''(미지정)·parcel 만 택배로 간주", () => {
    expect(isParcelDeliveryMethod('')).toBe(true);
    expect(isParcelDeliveryMethod('parcel')).toBe(true);
    expect(isParcelDeliveryMethod('pickup')).toBe(false);
    expect(isParcelDeliveryMethod('quick_cod')).toBe(false);
    expect(isParcelDeliveryMethod('direct')).toBe(false);
  });

  it('택배는 입력 택배사명, 비택배는 표준 한글 라벨(입력 무시)', () => {
    expect(deliveryCompanyForMethod('parcel', 'CJ대한통운')).toBe('CJ대한통운');
    expect(deliveryCompanyForMethod('quick_cod', '무시됨')).toBe('퀵배송(착불)');
    expect(deliveryCompanyForMethod('pickup', '')).toBe('방문수령');
    expect(deliveryCompanyForMethod('direct', '')).toBe('직배송');
  });

  it('선택지 목록에 예약값(quick_prepaid)은 없다', () => {
    expect(SELECTABLE_DELIVERY_METHODS).toEqual(['parcel', 'quick_cod', 'pickup', 'direct']);
    // 예약값도 라벨은 정의돼 있어(과거 데이터 표시 대비) 병용 기록이 항상 가능하다.
    expect(DELIVERY_METHOD_COMPANY_LABEL.quick_prepaid).toBe('퀵배송(선불)');
  });
});
