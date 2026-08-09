import { describe, expect, it } from 'vitest';
import { toAdminCaseCustomer } from './admin-case-customer';

const applicant = {
  mbId: 'customer1',
  companyName: '샘플전자',
  member: {
    name: '홍길동',
    email: 'customer@example.com',
    hp: '010-1111-2222',
    tel: '02-111-2222',
  },
};

describe('toAdminCaseCustomer', () => {
  it('주문 전에는 견적 신청 회원 정보를 표시한다', () => {
    expect(toAdminCaseCustomer({ applicant, orderer: null })).toEqual({
      source: 'applicant',
      mbId: 'customer1',
      companyName: '샘플전자',
      name: '홍길동',
      email: 'customer@example.com',
      phone: '010-1111-2222',
    });
  });

  it('주문자 스냅샷이 있으면 회원정보보다 우선하고 일반전화를 보조값으로 쓴다', () => {
    expect(
      toAdminCaseCustomer({
        applicant,
        orderer: {
          mbId: 'orderer2',
          companyName: '주문회사',
          name: '주문 당시 이름',
          email: 'order@example.com',
          hp: ' ',
          tel: '031-123-4567',
        },
      }),
    ).toEqual({
      source: 'order_snapshot',
      mbId: 'orderer2',
      companyName: '주문회사',
      name: '주문 당시 이름',
      email: 'order@example.com',
      phone: '031-123-4567',
    });
  });

  it('비회원 주문의 빈 회원 ID를 null로 정규화한다', () => {
    const customer = toAdminCaseCustomer({
      applicant: { mbId: null, companyName: null, member: undefined },
      orderer: {
        mbId: '',
        companyName: null,
        name: '비회원',
        email: 'guest@example.com',
        hp: '',
        tel: '',
      },
    });
    expect(customer?.source).toBe('order_snapshot');
    expect(customer?.mbId).toBeNull();
  });

  it('회원과 회사명 모두 없는 주문 전 Case는 null을 반환한다', () => {
    expect(
      toAdminCaseCustomer({
        applicant: { mbId: null, companyName: null, member: undefined },
        orderer: null,
      }),
    ).toBeNull();
  });
});
