import { describe, expect, it } from 'vitest';
import { AdminPartnerCreateBody } from '@sp/api-contract';
import { validatePartnerCountry } from './partner';

describe('validatePartnerCountry', () => {
  it('승인된 사람 협력사만 국가를 필수로 요구한다', () => {
    expect(validatePartnerCountry('partner', 'approved', null)).toContain('국가');
    expect(validatePartnerCountry('partner', 'pending', null)).toBeNull();
    expect(validatePartnerCountry('partner', 'suspended', null)).toBeNull();
    expect(validatePartnerCountry('supplier', 'approved', null)).toBeNull();
    expect(validatePartnerCountry('partner', 'approved', 'KR')).toBeNull();
  });

  it('관리자 생성 계약도 즉시 승인 협력사의 국가 누락을 거부한다', () => {
    const base = {
      type: 'partner' as const,
      name: '국가 미등록 협력사',
      capabilities: ['bom_rfq' as const],
    };
    expect(AdminPartnerCreateBody.safeParse(base).success).toBe(false);
    expect(AdminPartnerCreateBody.safeParse({ ...base, country: 'kr' }).success).toBe(true);
  });
});
