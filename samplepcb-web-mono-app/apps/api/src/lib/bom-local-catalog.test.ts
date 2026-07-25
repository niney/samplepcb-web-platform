import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  engineFetch: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spPart: {
      findMany: mocks.findMany,
    },
  },
}));

vi.mock('./engine-client', () => ({
  engineFetch: mocks.engineFetch,
}));

import { applyLocalCatalogFallback } from './bom-local-catalog';

function localProduct(
  mpn = '10038WR-08',
  manufacturer = 'YEONHO ELECTRONICS',
): Record<string, unknown> {
  return {
    supplier: 'yeonho',
    manufacturer_part_number: mpn,
    manufacturer,
    description: 'Wire to Board Connector',
    normalized_specs: {
      part_type: 'connector',
      pin_count: 8,
      pitch_mm: 2.5,
    },
    catalog_metadata: { catalogOnly: true },
    offers: [
      {
        supplier: 'yeonho',
        supplier_sku: mpn,
        stock: null,
        price_breaks: [],
        fetched_at: '2026-07-17T00:00:00+09:00',
      },
    ],
  };
}

function envelope(
  manufacturer: string | null = 'YEONHO ELECTRONICS',
): Record<string, unknown> {
  return {
    supplier_search_schema_version: 'sp-supplier-search-envelope/v1',
    procurement_decision_contract_status: 'current',
    search: {
      procurement_policy: { target_currency: 'KRW' },
      components: [
        {
          component_id: 'component-1',
          mode: 'identity',
          status: 'not_found',
          query: {
            component_id: 'component-1',
            mode: 'identity',
            part_number: '10038WR-08',
            manufacturer,
            quantity: 1,
          },
          candidates: [],
          warnings: [],
        },
        {
          component_id: 'component-with-external-candidate',
          mode: 'identity',
          status: 'verified_exact',
          query: {
            component_id: 'component-with-external-candidate',
            mode: 'identity',
            part_number: '10038WR-08',
            manufacturer,
            quantity: 1,
          },
          candidates: [{ product: { manufacturer_part_number: 'external' } }],
          warnings: [],
        },
        {
          component_id: 'component-insufficient',
          mode: 'insufficient',
          status: 'insufficient_input',
          query: {
            component_id: 'component-insufficient',
            mode: 'insufficient',
            part_number: '10038WR-08',
            manufacturer,
            quantity: 1,
          },
          candidates: [],
          warnings: [],
        },
      ],
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BOM 로컬 카탈로그 fallback', () => {
  it('외부 후보가 빈 exact 제조사·MPN만 한 번에 엔진 판정으로 보낸다', async () => {
    mocks.findMany.mockResolvedValue([
      {
        mpnNorm: '10038WR08',
        manufacturerNorm: 'yeonho',
        offers: [{ rawJson: localProduct() }],
      },
    ]);
    mocks.engineFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              component_id: 'component-1',
              status: 'verified_exact',
              candidates: [{ product: localProduct() }],
              procurement_decision: {
                status: 'no_recommendation',
                selection_application_state: 'not_selected',
              },
              warnings: ['로컬 카탈로그 후보는 자동 선정하지 않습니다.'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await applyLocalCatalogFallback(envelope());

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { mpnNorm: { in: ['10038WR08'] } },
      select: {
        mpnNorm: true,
        manufacturerNorm: true,
        offers: { select: { rawJson: true } },
      },
    });
    expect(mocks.engineFetch).toHaveBeenCalledTimes(1);
    const [, init] = mocks.engineFetch.mock.calls[0] as [string, RequestInit];
    if (typeof init.body !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
    const body = JSON.parse(init.body) as {
      items: { query: { component_id: string }; products: unknown[] }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.query.component_id).toBe('component-1');
    expect(body.items[0]?.products).toHaveLength(1);

    const output = result as {
      search: {
        components: {
          component_id: string;
          status: string;
          candidates: unknown[];
          procurement_decision?: unknown;
        }[];
      };
    };
    expect(output.search.components[0]).toMatchObject({
      component_id: 'component-1',
      status: 'verified_exact',
      procurement_decision: {
        status: 'no_recommendation',
        selection_application_state: 'not_selected',
      },
    });
    expect(output.search.components[0]?.candidates).toHaveLength(1);
    expect(output.search.components[1]?.candidates).toHaveLength(1);
    expect(output.search.components[2]?.candidates).toHaveLength(0);
  });

  it('제조사가 명시되면 같은 MPN의 다른 제조사를 연결하지 않는다', async () => {
    mocks.findMany.mockResolvedValue([
      {
        mpnNorm: '10038WR08',
        manufacturerNorm: 'othermanufacturer',
        offers: [{ rawJson: localProduct('10038WR-08', 'Other Manufacturer') }],
      },
    ]);
    const input = envelope();

    const result = await applyLocalCatalogFallback(input);

    expect(result).toBe(input);
    expect(mocks.engineFetch).not.toHaveBeenCalled();
  });

  it('외부 파라메트릭 fallback 뒤에도 최초 identity MPN으로 로컬 조회한다', async () => {
    mocks.findMany.mockResolvedValue([
      {
        mpnNorm: '10038WR08',
        manufacturerNorm: 'yeonho',
        offers: [{ rawJson: localProduct() }],
      },
    ]);
    mocks.engineFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              component_id: 'component-1',
              status: 'verified_exact',
              candidates: [{ product: localProduct() }],
              procurement_decision: { status: 'no_recommendation' },
              warnings: [],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const input = envelope() as {
      search: { components: Record<string, unknown>[] };
    };
    const target = input.search.components[0];
    if (target === undefined) throw new Error('테스트 컴포넌트가 없습니다');
    target.initial_query = target.query;
    target.query = {
      component_id: 'component-1',
      mode: 'parametric',
      part_number: null,
      manufacturer: null,
      quantity: 1,
    };

    const result = await applyLocalCatalogFallback(input);

    const [, init] = mocks.engineFetch.mock.calls[0] as [string, RequestInit];
    if (typeof init.body !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
    const body = JSON.parse(init.body) as {
      items: { query: { mode: string; part_number: string } }[];
    };
    expect(body.items[0]?.query).toMatchObject({
      mode: 'identity',
      part_number: '10038WR-08',
    });
    const output = result as {
      search: { components: { query: { mode: string; part_number: string } }[] };
    };
    expect(output.search.components[0]?.query).toMatchObject({
      mode: 'identity',
      part_number: '10038WR-08',
    });
  });

  it('제조사 미상 MPN이 여러 제조사에 걸치면 자동 연결하지 않는다', async () => {
    mocks.findMany.mockResolvedValue([
      {
        mpnNorm: '10038WR08',
        manufacturerNorm: 'yeonho',
        offers: [{ rawJson: localProduct() }],
      },
      {
        mpnNorm: '10038WR08',
        manufacturerNorm: 'othermanufacturer',
        offers: [{ rawJson: localProduct('10038WR-08', 'Other Manufacturer') }],
      },
    ]);
    const input = envelope(null);

    const result = await applyLocalCatalogFallback(input);

    expect(result).toBe(input);
    expect(mocks.engineFetch).not.toHaveBeenCalled();
  });

  it('로컬 후보 평가는 200개 단위로 배치한다', async () => {
    const components = Array.from({ length: 201 }, (_, index) => {
      const mpn = `YH-${String(index + 1)}`;
      return {
        component_id: `component-${String(index + 1)}`,
        status: 'not_found',
        query: {
          component_id: `component-${String(index + 1)}`,
          mode: 'identity',
          part_number: mpn,
          manufacturer: 'YEONHO ELECTRONICS',
          quantity: 1,
        },
        candidates: [],
        warnings: [],
      };
    });
    mocks.findMany.mockResolvedValue(
      components.map((component) => {
        const mpn = component.query.part_number;
        return {
          mpnNorm: mpn.replaceAll(/[^A-Za-z0-9]/g, '').toUpperCase(),
          manufacturerNorm: 'yeonho',
          offers: [{ rawJson: localProduct(mpn) }],
        };
      }),
    );
    mocks.engineFetch.mockImplementation(
      (_path: string, init: RequestInit) => {
        if (typeof init.body !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
        const body = JSON.parse(init.body) as {
          items: { query: { component_id: string }; products: unknown[] }[];
        };
        return Promise.resolve(new Response(
          JSON.stringify({
            items: body.items.map((item) => ({
              component_id: item.query.component_id,
              status: 'verified_exact',
              candidates: [{ product: item.products[0] }],
              procurement_decision: { status: 'no_recommendation' },
              warnings: [],
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      },
    );

    const result = await applyLocalCatalogFallback({
      search: { components },
    });

    expect(mocks.engineFetch).toHaveBeenCalledTimes(2);
    const batchSizes = mocks.engineFetch.mock.calls.map(([, init]) => {
      const bodyValue = (init as RequestInit).body;
      if (typeof bodyValue !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
      return (JSON.parse(bodyValue) as { items: unknown[] }).items.length;
    });
    expect(batchSizes).toEqual([200, 1]);
    const output = result as { search: { components: { candidates: unknown[] }[] } };
    expect(output.search.components.every((component) => component.candidates.length === 1)).toBe(true);
  });
});
