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

  it('인증 실패(result=3)를 "고시 없음"으로 오진하지 않고 키 확인을 안내한다', async () => {
    vi.stubEnv('KOREAEXIM_API_KEY', 'bad-key');
    const fetcher = vi.fn((): Promise<Response> => Promise.resolve(
      new Response(JSON.stringify([{ result: 3 }]), { status: 200, headers: { 'content-type': 'application/json' } }),
    )) as unknown as typeof fetch;

    await expect(refreshKoreaEximUsdExchangeRate(fetcher, new Date('2026-07-20T04:00:00.000Z')))
      .rejects.toThrow(/KOREAEXIM_API_KEY/);
    expect(fetcher).toHaveBeenCalledTimes(1); // 역탐색 없이 즉시 중단
    expect(prismaMocks.upsert).not.toHaveBeenCalled();
  });

  it('일일 호출 한도 초과(result=4)는 전용 메시지로 중단한다', async () => {
    vi.stubEnv('KOREAEXIM_API_KEY', 'test-key');
    const fetcher = vi.fn((): Promise<Response> => Promise.resolve(
      new Response(JSON.stringify([{ result: 4 }]), { status: 200, headers: { 'content-type': 'application/json' } }),
    )) as unknown as typeof fetch;

    await expect(refreshKoreaEximUsdExchangeRate(fetcher, new Date('2026-07-20T04:00:00.000Z')))
      .rejects.toThrow(/일일 호출 한도/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('API 지연이 전체 예산(15초)을 넘기면 역탐색을 중단한다', async () => {
    vi.stubEnv('KOREAEXIM_API_KEY', 'test-key');
    // Date.now 흐름: 예산 계산 시 0ms → 1회차 잔여 검사 0ms → 2회차 잔여 검사 16,000ms(예산 초과)
    const nowValues = [0, 0, 16_000];
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 16_000);
    try {
      const fetcher = vi.fn((): Promise<Response> => Promise.resolve(
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      )) as unknown as typeof fetch;

      await expect(refreshKoreaEximUsdExchangeRate(fetcher, new Date('2026-07-20T04:00:00.000Z')))
        .rejects.toThrow(/예산을 초과/);
      expect(fetcher).toHaveBeenCalledTimes(1); // 빈 응답 1회 후 예산 초과로 중단
    } finally {
      nowSpy.mockRestore();
    }
  });
});
