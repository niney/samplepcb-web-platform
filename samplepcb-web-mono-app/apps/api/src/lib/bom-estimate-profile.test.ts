import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getShopEstimateProfile: vi.fn(),
  getBomEstimateContact: vi.fn(),
  resolveBomEstimateContact: vi.fn(),
}));

vi.mock('./g5-db', () => ({
  getShopEstimateProfile: mocks.getShopEstimateProfile,
}));

vi.mock('./sp-config', () => ({
  getBomEstimateContact: mocks.getBomEstimateContact,
  resolveBomEstimateContact: mocks.resolveBomEstimateContact,
}));

import {
  getBomEstimateContactSettings,
  getBomEstimateSellerProfile,
} from './bom-estimate-profile';

const profile = {
  name: 'SamplePCB',
  owner: '대표자',
  tel: '02-0000-0000',
  zip: '00000',
  addr: '서울시',
  managerName: '정보 책임자',
  managerEmail: 'privacy@example.com',
  bankAccount: '은행 000-000',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getShopEstimateProfile.mockResolvedValue(profile);
  mocks.resolveBomEstimateContact.mockImplementation(
    (configured: { managerName: string; managerEmail: string }, fallback: typeof configured) => (
      configured.managerName !== '' && configured.managerEmail !== '' ? configured : fallback
    ),
  );
});

describe('BOM 견적서 공급자 프로필', () => {
  it('회사 정보는 유지하고 담당자 두 필드만 BOM 전용 값으로 교체한다', async () => {
    mocks.getBomEstimateContact.mockResolvedValue({
      managerName: 'BOM 담당자',
      managerEmail: 'bom@example.com',
    });

    await expect(getBomEstimateSellerProfile()).resolves.toEqual({
      ...profile,
      managerName: 'BOM 담당자',
      managerEmail: 'bom@example.com',
    });
  });

  it('전용 값이 비어 있으면 기존 정보관리책임자를 실제 출력값으로 설명한다', async () => {
    mocks.getBomEstimateContact.mockResolvedValue({ managerName: '', managerEmail: '' });

    await expect(getBomEstimateContactSettings()).resolves.toEqual({
      data: { managerName: '', managerEmail: '' },
      fallback: {
        managerName: '정보 책임자',
        managerEmail: 'privacy@example.com',
      },
      effective: {
        managerName: '정보 책임자',
        managerEmail: 'privacy@example.com',
      },
    });
  });

  it('영카트 기본 행이 없어도 저장된 BOM 담당자는 견적서에 유지한다', async () => {
    mocks.getShopEstimateProfile.mockResolvedValue(null);
    mocks.getBomEstimateContact.mockResolvedValue({
      managerName: 'BOM 담당자',
      managerEmail: 'bom@example.com',
    });

    await expect(getBomEstimateSellerProfile()).resolves.toMatchObject({
      name: '',
      managerName: 'BOM 담당자',
      managerEmail: 'bom@example.com',
    });
  });
});
