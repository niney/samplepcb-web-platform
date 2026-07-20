import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BomQuoteConfigType } from '@sp/api-contract';

interface SpConfigUpsertArgs {
  where: { key: string };
  create: { key: string; value: string };
  update: { value: string };
}

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn<(args: SpConfigUpsertArgs) => unknown>(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spConfig: prismaMocks,
  },
}));

import {
  refreshKoreaEximUsdExchangeRate,
  resolveUsdExchangeRate,
  type ExchangeRateCacheType,
} from './exchange-rate';

const baseConfig: BomQuoteConfigType = {
  defaultShippingFee: 30_000,
  defaultManagementFee: 25_000,
  usdKrwRate: 1_450,
  usdKrwRateMode: 'auto',
  usdKrwAutoRateType: 'dealBasR',
  usdKrwSafetyMarginPercent: 2,
  usdKrwMaxAgeDays: 7,
  supplierSearchMaxCalls: 300,
  memberDailySearchLimit: 20,
  freshnessHours: 24,
};

const cache: ExchangeRateCacheType = {
  source: 'koreaexim',
  currency: 'USD',
  rateDate: '2026-07-20',
  dealBasR: 1_400,
  tts: 1_414,
  fetchedAt: '2026-07-20T03:15:00.000Z',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('resolveUsdExchangeRate', () => {
  it('매매기준율에 안전계수를 적용한다', () => {
    const result = resolveUsdExchangeRate(baseConfig, cache, '2026-07-20');
    expect(result).toMatchObject({
      source: 'koreaexim',
      rateType: 'dealBasR',
      sourceRate: 1_400,
      safetyMarginPercent: 2,
      appliedRate: 1_428,
      stale: false,
      fallbackReason: null,
    });
  });

  it('관리자가 TTS 기준을 선택하면 TTS에 안전계수를 적용한다', () => {
    const result = resolveUsdExchangeRate(
      { ...baseConfig, usdKrwAutoRateType: 'tts', usdKrwSafetyMarginPercent: 1 },
      cache,
      '2026-07-20',
    );
    expect(result?.sourceRate).toBe(1_414);
    expect(result?.appliedRate).toBe(1_428.14);
  });

  it('자동 캐시가 오래됐으면 수동 폴백을 우선한다', () => {
    const result = resolveUsdExchangeRate(baseConfig, cache, '2026-08-01');
    expect(result).toMatchObject({
      mode: 'auto',
      source: 'manual',
      appliedRate: 1_450,
      fallbackReason: 'manual-rate',
    });
  });

  it('수동 폴백도 없으면 오래된 마지막 정상 캐시를 경고와 함께 사용한다', () => {
    const result = resolveUsdExchangeRate({ ...baseConfig, usdKrwRate: null }, cache, '2026-08-01');
    expect(result).toMatchObject({
      source: 'koreaexim',
      appliedRate: 1_428,
      stale: true,
      fallbackReason: 'stale-cache',
    });
  });

  it('manual 모드는 외부 캐시와 안전계수를 무시한다', () => {
    const result = resolveUsdExchangeRate({ ...baseConfig, usdKrwRateMode: 'manual' }, cache, '2026-07-20');
    expect(result).toMatchObject({
      mode: 'manual',
      source: 'manual',
      rateType: 'manual',
      appliedRate: 1_450,
      safetyMarginPercent: 0,
    });
  });
});

describe('refreshKoreaEximUsdExchangeRate', () => {
  it('당일 데이터가 비면 전일을 조회하고 콤마 환율을 정규화해 캐시한다', async () => {
    vi.stubEnv('KOREAEXIM_API_KEY', 'test-key');
    const fetcher = vi.fn((input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('searchdate') === '20260720') {
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([{
        result: 1,
        cur_unit: 'USD',
        deal_bas_r: '1,402.50',
        tts: '1,416.52',
      }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as unknown as typeof fetch;

    const result = await refreshKoreaEximUsdExchangeRate(fetcher, new Date('2026-07-20T04:00:00.000Z'));

    expect(result).toMatchObject({ rateDate: '2026-07-19', dealBasR: 1_402.5, tts: 1_416.52 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(prismaMocks.upsert).toHaveBeenCalledOnce();
    const serialized = prismaMocks.upsert.mock.calls[0]?.[0].create.value;
    expect(typeof serialized).toBe('string');
    expect(String(serialized)).not.toContain('test-key');
  });
});
