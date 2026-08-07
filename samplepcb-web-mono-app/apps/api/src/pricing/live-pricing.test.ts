// live-pricing 폴백 사다리 검증 — 라이브 → 마지막 성공본 → 번들 스냅샷.
// 모듈 캐시가 상태라 테스트마다 vi.resetModules() 로 새로 불러온다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateQuote, PRICE_VERSION, type QuoteInput } from './engine';
import pricingDataJson from './pricing-data.json';

const importFresh = async () => {
  vi.resetModules();
  return await import('./live-pricing');
};

// 번들 스냅샷을 복제해 환율만 바꾼 "라이브 표" — 형태 검증을 통과하는 실전형 데이터.
const liveJsonWithRate = (rate: string): unknown => {
  const clone = structuredClone(pricingDataJson) as {
    menus: { name: string; rate?: string }[];
  };
  const std = clone.menus.find((m) => m.name === 'Standard');
  if (std !== undefined) std.rate = rate;
  return clone;
};

const okFetch = (json: unknown): typeof fetch =>
  vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) }),
  ) as unknown as typeof fetch;

const STD_INPUT: QuoteInput = {
  category: 'standard',
  orderCategory: 'sample',
  qty: 5,
  spec: {
    layers: '2',
    width: '160',
    length: '156',
    panel: 'No',
    edgeRail: 'no',
    differentDesign: '1',
    surfaceFinish: 'hasl',
    pcbThickness: '1.6',
    copperWeights: '1oz',
    solderMask: 'green',
    goldFingers: 'no',
    minTraceSpacing: '6/6mil',
    minHole: '0.3mm',
    impedance: 'none',
    halfHole: 'no',
    cutting: 'Single',
  },
  now: new Date('2026-08-07T00:00:00Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getFreshPricingData', () => {
  it('라이브 성공 — 그 표로 계산되고 version 에 live-오늘이 찍힌다', async () => {
    vi.stubGlobal('fetch', okFetch(liveJsonWithRate('2840')));
    const { getFreshPricingData } = await importFresh();
    const src = await getFreshPricingData();

    expect(src.version).toMatch(/^live-20\d{2}-\d{2}-\d{2}$/);
    expect(src.version).not.toBe(PRICE_VERSION);
    const live = calculateQuote(STD_INPUT, src);
    const bundled = calculateQuote(STD_INPUT);
    // 환율을 2배로 올린 표 — 가격이 실제로 달라져야 주입이 관통된 것이다.
    expect(live.listPrice).not.toBe(bundled.listPrice);
    expect(live.priceVersion).toBe(src.version);
    expect(bundled.priceVersion).toBe(PRICE_VERSION);
  });

  it('60초 내 재호출은 fetch 없이 캐시를 재사용한다', async () => {
    const f = okFetch(liveJsonWithRate('1470'));
    vi.stubGlobal('fetch', f);
    const { getFreshPricingData } = await importFresh();
    const a = await getFreshPricingData();
    const b = await getFreshPricingData();
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('HTTP 오류 — 성공본이 없으면 번들 스냅샷으로 물러난다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })),
    );
    const { getFreshPricingData } = await importFresh();
    const src = await getFreshPricingData();
    expect(src.version).toBe(PRICE_VERSION);
  });

  it('형태 불량(JSON 이지만 가격표가 아님) — 폴백한다', async () => {
    vi.stubGlobal('fetch', okFetch({ hello: 'world' }));
    const { getFreshPricingData } = await importFresh();
    const src = await getFreshPricingData();
    expect(src.version).toBe(PRICE_VERSION);
  });

  it('실패 직후 재호출은 재시도 없이 즉시 폴백한다(타임아웃 연타 방지)', async () => {
    const f = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    vi.stubGlobal('fetch', f);
    const { getFreshPricingData } = await importFresh();
    await getFreshPricingData();
    await getFreshPricingData();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('한 번 성공한 뒤의 실패 — 번들이 아니라 마지막 성공본을 쓴다', async () => {
    vi.useFakeTimers();
    try {
      const f = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(liveJsonWithRate('1470')),
        })
        .mockRejectedValue(new Error('down'));
      vi.stubGlobal('fetch', f);
      const { getFreshPricingData } = await importFresh();
      const first = await getFreshPricingData();

      vi.setSystemTime(Date.now() + 61_000); // TTL 을 넘겨 재조회를 강제한다
      const second = await getFreshPricingData();
      expect(second).toBe(first);
      expect(f).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
