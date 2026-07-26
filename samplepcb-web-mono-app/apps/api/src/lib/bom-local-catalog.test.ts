import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  engineFetch: vi.fn(),
  search: vi.fn(),
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

vi.mock('../es/client', () => ({
  esClient: () => ({
    search: mocks.search,
  }),
}));

import {
  applyLocalCatalogFallback,
  evaluatePreferredLocalCatalog,
} from './bom-local-catalog';

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
      items: {
        query: { component_id: string };
        products: { offers: { offer_kind?: string }[] }[];
      }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.query.component_id).toBe('component-1');
    expect(body.items[0]?.products).toHaveLength(1);
    expect(body.items[0]?.products[0]?.offers[0]?.offer_kind).toBe(
      'manufacturer_catalog',
    );

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

describe('BOM SamplePCB R/C 로컬 우선 검색', () => {
  const preferredProduct = {
    supplier: 'walsin',
    manufacturer_part_number: 'WR06X1002FTL',
    manufacturer: 'Walsin',
    description: 'Chip Resistor',
    category: 'Chip Resistor',
    package: '0603',
    normalized_specs: {
      part_type: 'resistor',
      resistance_ohm: 10_000,
      tolerance_percent: 1,
      package: '0603',
    },
    catalog_metadata: {
      catalogOnly: true,
      samplepcbPreferred: true,
      samplepcbPreferenceRank: 0,
      autoQuoteEligible: true,
      apiVerificationRequired: false,
    },
    offers: [
      {
        supplier: 'walsin',
        offer_kind: 'manufacturer_catalog',
        supplier_sku: 'WR06X1002FTL',
        price_breaks: [],
        fetched_at: '2026-07-06T00:00:00+09:00',
      },
      {
        supplier: 'samplepcb',
        offer_kind: 'manufacturer_catalog',
        supplier_sku: 'WR06X1002FTL',
        price_breaks: [],
        fetched_at: '2026-07-06T00:00:00+09:00',
      },
    ],
  };

  const preflight = {
    plan: {
      components: [
        {
          component_id: 'resistor-1',
          planned_queries: [
            {
              component_id: 'resistor-1',
              mode: 'parametric',
              part_number: null,
              manufacturer: null,
              part_type: 'resistor',
              category_policy: 'resistor',
              package: '0603',
              keywords: '10k 0603 1% resistor',
              requirements: {
                part_type: {
                  normalized_value: 'resistor',
                  hard: true,
                  comparison: 'category',
                },
                resistance_ohm: {
                  normalized_value: 10_000,
                  hard: true,
                  comparison: 'eq',
                },
                package: {
                  normalized_value: '0603',
                  hard: true,
                  comparison: 'eq',
                },
                tolerance_percent: {
                  normalized_value: 1,
                  hard: true,
                  comparison: 'lte',
                },
              },
            },
          ],
        },
        {
          component_id: 'connector-1',
          planned_queries: [
            {
              component_id: 'connector-1',
              mode: 'identity',
              part_number: '10038WR-08',
              manufacturer: 'YEONHO ELECTRONICS',
              part_type: 'connector',
              category_policy: 'connector',
              requirements: {},
            },
          ],
        },
      ],
    },
  };

  it('엔진 정규 쿼리로 ES 후보만 찾고 엔진 automatic_selected만 해결로 인정한다', async () => {
    mocks.search.mockResolvedValue({
      hits: { hits: [{ _source: { partId: '77' } }] },
    });
    mocks.findMany.mockResolvedValue([
      {
        id: 77n,
        offers: [
          {
            supplier: 'samplepcb',
            supplierSku: 'WR06X1002FTL',
            productUrl: null,
            stock: null,
            moq: null,
            orderMultiple: null,
            packaging: null,
            currency: null,
            leadTime: null,
            fetchedAt: new Date('2026-07-06T00:00:00+09:00'),
            rawJson: preferredProduct,
            priceBreaks: [],
          },
        ],
      },
    ]);
    mocks.engineFetch.mockImplementation((_path: string, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
      const body = JSON.parse(init.body) as {
        items: { query: { component_id: string }; products: unknown[] }[];
      };
      return Promise.resolve(new Response(JSON.stringify({
        items: body.items.map((item) => ({
          component_id: item.query.component_id,
          status: 'spec_compatible',
          candidates: [{ product: item.products[0] }],
          procurement_decision: {
            status: 'catalog_selected',
            selection_application_state: 'automatic_selected',
          },
          warnings: [],
        })),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });

    const result = await evaluatePreferredLocalCatalog(
      preflight,
      { target_currency: 'KRW' },
    );

    expect(mocks.search).toHaveBeenCalledTimes(1);
    const searchRequest = mocks.search.mock.calls[0]?.[0] as {
      query: { bool: { filter: Record<string, unknown>[] } };
    };
    expect(searchRequest.query.bool.filter).toEqual(expect.arrayContaining([
      { term: { suppliers: 'samplepcb' } },
      { term: { partType: 'resistor' } },
      { terms: { packageVariants: ['0603', '1608'] } },
    ]));
    const [, evaluationInit] = mocks.engineFetch.mock.calls[0] as [string, RequestInit];
    if (typeof evaluationInit.body !== 'string') throw new Error('요청 본문이 문자열이 아닙니다');
    const evaluationBody = JSON.parse(evaluationInit.body) as {
      items: { products: { supplier: string; offers: { supplier: string; stock: number | null }[] }[] }[];
    };
    expect(evaluationBody.items[0]?.products[0]).toMatchObject({
      supplier: 'samplepcb',
      offers: [{ supplier: 'samplepcb', stock: null }],
    });
    expect(result.resolvedComponentIds).toEqual(['resistor-1']);
    expect(result.unresolvedComponentIds).toEqual(['connector-1']);
    expect(result.envelope).not.toBeNull();
    expect(result.traces).toEqual([
      expect.objectContaining({
        componentId: 'resistor-1',
        query: '10k 0603 1% resistor',
        outcome: 'selected',
        candidateCount: 1,
        evaluatedCandidateCount: 1,
        selectedCandidateCount: 1,
        reason: null,
      }),
    ]);
  });

  it('엔진이 선정하지 않은 로컬 후보는 외부 검색 대상으로 남긴다', async () => {
    mocks.search.mockResolvedValue({
      hits: { hits: [{ _source: { partId: '77' } }] },
    });
    mocks.findMany.mockResolvedValue([
      {
        id: 77n,
        offers: [
          {
            supplier: 'samplepcb',
            supplierSku: 'WR06X1002FTL',
            productUrl: null,
            stock: null,
            moq: null,
            orderMultiple: null,
            packaging: null,
            currency: null,
            leadTime: null,
            fetchedAt: new Date('2026-07-06T00:00:00+09:00'),
            rawJson: preferredProduct,
            priceBreaks: [],
          },
        ],
      },
    ]);
    mocks.engineFetch.mockResolvedValue(new Response(JSON.stringify({
      items: [
        {
          component_id: 'resistor-1',
          status: 'spec_partial',
          candidates: [],
          procurement_decision: {
            status: 'no_recommendation',
            selection_application_state: 'not_selected',
          },
          warnings: [],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await evaluatePreferredLocalCatalog(preflight, {});

    expect(result.resolvedComponentIds).toEqual([]);
    expect(result.unresolvedComponentIds).toEqual(['resistor-1', 'connector-1']);
    expect(result.envelope).toBeNull();
    expect(result.traces).toEqual([
      expect.objectContaining({
        componentId: 'resistor-1',
        outcome: 'rejected',
        candidateCount: 1,
        evaluatedCandidateCount: 1,
        selectedCandidateCount: 0,
        reason: 'engine_not_selected',
      }),
    ]);
  });

  it('SamplePCB ES 후보가 없으면 외부 호출 전 단계를 후보 없음으로 기록한다', async () => {
    mocks.search.mockResolvedValue({ hits: { hits: [] } });

    const result = await evaluatePreferredLocalCatalog(preflight, {});

    expect(mocks.engineFetch).not.toHaveBeenCalled();
    expect(result.resolvedComponentIds).toEqual([]);
    expect(result.unresolvedComponentIds).toEqual(['resistor-1', 'connector-1']);
    expect(result.traces).toEqual([
      expect.objectContaining({
        componentId: 'resistor-1',
        query: '10k 0603 1% resistor',
        outcome: 'no_candidates',
        candidateCount: 0,
        evaluatedCandidateCount: 0,
        selectedCandidateCount: 0,
        reason: 'catalog_candidates_not_found',
      }),
    ]);
  });
});
