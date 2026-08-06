import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spConfig: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import {
  BOM_ESTIMATE_CONTACT_DEFAULTS,
  BOM_QUOTE_CONFIG_DEFAULTS,
  getBomEstimateContact,
  getBomQuoteConfig,
  resolveBomEstimateContact,
  setBomEstimateContact,
} from './sp-config';

afterEach(() => {
  vi.clearAllMocks();
});

describe('BOM 견적 설정 승격', () => {
  it('실험 필드 도입 전 JSON에는 현재 동작을 유지하는 true를 병합한다', async () => {
    const legacyConfig: Record<string, unknown> = {
      ...BOM_QUOTE_CONFIG_DEFAULTS,
    };
    delete legacyConfig.storedPartPrioritySearchEnabled;
    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify(legacyConfig),
    });

    await expect(getBomQuoteConfig()).resolves.toMatchObject({
      storedPartPrioritySearchEnabled: true,
    });
  });

  it('관리자가 저장한 false는 기본값으로 덮지 않는다', async () => {
    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify({
        ...BOM_QUOTE_CONFIG_DEFAULTS,
        storedPartPrioritySearchEnabled: false,
      }),
    });

    await expect(getBomQuoteConfig()).resolves.toMatchObject({
      storedPartPrioritySearchEnabled: false,
    });
  });
});

describe('BOM 견적서 담당자 설정', () => {
  it('설정이 없으면 정보관리책임자 폴백을 뜻하는 빈 쌍을 반환한다', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(getBomEstimateContact()).resolves.toEqual(BOM_ESTIMATE_CONTACT_DEFAULTS);
  });

  it('부분 입력이나 손상 JSON은 안전한 빈 쌍으로 축퇴한다', async () => {
    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify({ managerName: 'BOM 담당자', managerEmail: '' }),
    });

    await expect(getBomEstimateContact()).resolves.toEqual(BOM_ESTIMATE_CONTACT_DEFAULTS);
  });

  it('전용 담당자 쌍을 독립 sp_config 키에 저장한다', async () => {
    const contact = { managerName: 'BOM 담당자', managerEmail: 'bom@example.com' };

    await setBomEstimateContact(contact);

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: 'bom_estimate_contact' },
      create: { key: 'bom_estimate_contact', value: JSON.stringify(contact) },
      update: { value: JSON.stringify(contact) },
    });
  });

  it('전용 값이 있으면 우선하고 빈 쌍이면 기존 정보관리책임자를 사용한다', () => {
    const fallback = { managerName: '정보 책임자', managerEmail: 'privacy@example.com' };
    expect(resolveBomEstimateContact(
      { managerName: 'BOM 담당자', managerEmail: 'bom@example.com' },
      fallback,
    )).toEqual({ managerName: 'BOM 담당자', managerEmail: 'bom@example.com' });
    expect(resolveBomEstimateContact(BOM_ESTIMATE_CONTACT_DEFAULTS, fallback)).toEqual(fallback);
  });
});
