import { describe, expect, it } from 'vitest';
import { AdminOrderInfoBody, AdminOrderReceiptBody } from '@sp/api-contract';
import { orderInfoBodyToFields } from './order-edit';

// 주문 상세 편집 순수 로직 — 계약 refine·가드 + 화이트리스트 매퍼.

describe('AdminOrderInfoBody — refine(최소 1개 필드)', () => {
  it('빈 바디는 거부', () => {
    expect(AdminOrderInfoBody.safeParse({}).success).toBe(false);
  });
  it('필드 1개면 통과', () => {
    const r = AdminOrderInfoBody.safeParse({ odName: '홍길동' });
    expect(r.success).toBe(true);
  });
  it("addrJibeon 은 'R'|'J'|'' 만 허용", () => {
    expect(AdminOrderInfoBody.safeParse({ addrJibeon: 'R' }).success).toBe(true);
    expect(AdminOrderInfoBody.safeParse({ addrJibeon: 'X' }).success).toBe(false);
  });
  it('hopeDate 는 YYYY-MM-DD 또는 빈 문자열', () => {
    expect(AdminOrderInfoBody.safeParse({ hopeDate: '2026-07-05' }).success).toBe(true);
    expect(AdminOrderInfoBody.safeParse({ hopeDate: '' }).success).toBe(true);
    expect(AdminOrderInfoBody.safeParse({ hopeDate: '2026/07/05' }).success).toBe(false);
  });
});

describe('AdminOrderReceiptBody — 입금 조정 검증', () => {
  it('정상 파싱', () => {
    const r = AdminOrderReceiptBody.safeParse({
      receiptPrice: 93000,
      receiptTime: '2026-07-05 10:00:00',
      depositName: '홍길동',
    });
    expect(r.success).toBe(true);
  });
  it('receiptPrice 음수 거부·receiptTime 형식 거부', () => {
    expect(
      AdminOrderReceiptBody.safeParse({
        receiptPrice: -1,
        receiptTime: '2026-07-05 10:00:00',
        depositName: 'x',
      }).success,
    ).toBe(false);
    expect(
      AdminOrderReceiptBody.safeParse({
        receiptPrice: 1000,
        receiptTime: '2026-07-05',
        depositName: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('orderInfoBodyToFields — 카멜→od_ 화이트리스트 매핑', () => {
  it('빈 바디는 빈 맵', () => {
    expect(orderInfoBodyToFields({})).toEqual({});
  });
  it('보낸 필드만 매핑(주문자·받는분·희망일)', () => {
    expect(
      orderInfoBodyToFields({
        odName: '홍길동',
        odHp: '010-1',
        zip1: '123',
        zip2: '45',
        addr1: '서울',
        addrJibeon: 'R',
        bName: '김철수',
        bZip1: '678',
        hopeDate: '2026-07-10',
        depositName: '입금자',
      }),
    ).toEqual({
      od_name: '홍길동',
      od_hp: '010-1',
      od_zip1: '123',
      od_zip2: '45',
      od_addr1: '서울',
      od_addr_jibeon: 'R',
      od_b_name: '김철수',
      od_b_zip1: '678',
      od_hope_date: '2026-07-10',
      od_deposit_name: '입금자',
    });
  });
  it("jibeon 패스스루 — ''(초기화 지시)도 그대로 매핑(회원 ⑨-b 자동 초기화와 다름)", () => {
    expect(orderInfoBodyToFields({ addr1: '새주소', addrJibeon: '' })).toEqual({
      od_addr1: '새주소',
      od_addr_jibeon: '',
    });
    // addrJibeon 미제공 시 addr1 만 바뀌어도 od_addr_jibeon 은 건드리지 않는다(코어 패스스루).
    expect(orderInfoBodyToFields({ addr1: '새주소' })).toEqual({ od_addr1: '새주소' });
  });
});
