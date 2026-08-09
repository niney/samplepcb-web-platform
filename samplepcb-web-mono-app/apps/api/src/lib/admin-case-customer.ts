import type { AdminCaseCustomerType } from '@sp/api-contract';

interface ContactFields {
  name: string;
  email: string;
  hp: string;
  tel: string;
}

export interface CaseApplicantInput {
  mbId: string | null;
  companyName: string | null;
  member: ContactFields | undefined;
}

export interface CaseOrdererInput extends ContactFields {
  mbId: string;
  companyName: string | null;
}

const clean = (value: string | null | undefined): string => value?.trim() ?? '';
export const trimmedOrNull = (value: string | null | undefined): string | null => {
  const normalized = clean(value);
  return normalized === '' ? null : normalized;
};

/**
 * 관리자 PCB·SmartBOM Case 의 고객 표시값을 한 규칙으로 합성한다.
 * 주문자 스냅샷이 있으면 현재 회원정보보다 항상 우선한다. 주문 전 회원 행이 소실된
 * 경우에도 mbId 는 남겨 운영자가 견적 소유자를 식별할 수 있게 한다.
 */
export function toAdminCaseCustomer(input: {
  applicant: CaseApplicantInput;
  orderer: CaseOrdererInput | null;
}): AdminCaseCustomerType | null {
  if (input.orderer !== null) {
    const orderer = input.orderer;
    const hp = clean(orderer.hp);
    return {
      source: 'order_snapshot',
      mbId: trimmedOrNull(orderer.mbId),
      companyName: trimmedOrNull(orderer.companyName),
      name: clean(orderer.name),
      email: clean(orderer.email),
      phone: hp || clean(orderer.tel),
    };
  }

  const applicant = input.applicant;
  const companyName = trimmedOrNull(applicant.companyName);
  if (applicant.mbId === null && applicant.member === undefined && companyName === null) {
    return null;
  }
  const hp = clean(applicant.member?.hp);
  return {
    source: 'applicant',
    mbId: trimmedOrNull(applicant.mbId),
    companyName,
    name: clean(applicant.member?.name),
    email: clean(applicant.member?.email),
    phone: hp || clean(applicant.member?.tel),
  };
}
