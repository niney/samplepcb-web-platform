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
  BOM_QUOTE_CONFIG_DEFAULTS,
  getBomQuoteConfig,
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
