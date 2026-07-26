import { describe, expect, it } from 'vitest';
import {
  exactCatalogPriceEnvelope,
  parseCatalogPriceRefreshOptions,
} from './refresh-walsin-catalog-prices';

describe('Walsin 카탈로그 가격 갱신', () => {
  it('기본 실행은 API를 호출하지 않는 dry-run이다', () => {
    expect(parseCatalogPriceRefreshOptions([])).toMatchObject({
      apply: false,
      resume: false,
      retryMisses: false,
      concurrency: 2,
      maxCalls: 12,
      limit: null,
    });
  });

  it('resume은 apply 없이 사용할 수 없다', () => {
    expect(() => parseCatalogPriceRefreshOptions(['--resume'])).toThrow(
      '--resume은 --apply와 함께 사용하세요',
    );
  });

  it('정확 MPN과 제조사 후보만 남겨 대체품 인제스트를 차단한다', () => {
    const exact = {
      product: {
        manufacturer_part_number: 'WR06X1002FTL',
        manufacturer: 'Walsin',
        offers: [
          {
            supplier: 'digikey',
            price_breaks: [{ quantity: 1, unit_price: 10, currency: 'KRW' }],
          },
        ],
      },
    };
    const alternative = {
      product: {
        manufacturer_part_number: 'RC0603FR-0710KL',
        manufacturer: 'Yageo',
        offers: [
          {
            supplier: 'digikey',
            price_breaks: [{ quantity: 1, unit_price: 8, currency: 'KRW' }],
          },
        ],
      },
    };
    const wrongManufacturer = {
      product: {
        manufacturer_part_number: 'WR06X1002FTL',
        manufacturer: 'Other',
        offers: [],
      },
    };

    const result = exactCatalogPriceEnvelope(
      {
        search: {
          components: [
            { candidates: [exact, alternative, wrongManufacturer] },
          ],
        },
      },
      {
        mpnNorm: 'WR06X1002FTL',
        manufacturerNorm: 'walsin',
      },
    );

    expect(result.exactCandidates).toBe(1);
    expect(result.pricedCandidates).toBe(1);
    const envelope = result.envelope as {
      search: { components: { candidates: unknown[] }[] };
    };
    expect(envelope.search.components[0]?.candidates).toEqual([exact]);
  });
});
