import { describe, expect, it } from 'vitest';
import { buildItemsFromEngineResult, extractEngineSheets, selectEngineMatch } from './bom-quote';

const ENGINE_RESULT = {
  schema_version: '1.0',
  source_file: 'multi.xlsx',
  sheets: [
    {
      sheet_index_0based: 0,
      sheet_name: 'BOARD_A',
      status: 'parsed',
      component_count: 2,
      warnings: [],
      unparsed_reason: null,
    },
    {
      sheet_index_0based: 1,
      sheet_name: 'BOARD_B',
      status: 'parsed',
      component_count: 1,
      warnings: ['검토 필요'],
      unparsed_reason: null,
    },
    {
      sheet_index_0based: 2,
      sheet_name: 'README',
      status: 'not_bom',
      component_count: 0,
      warnings: [],
      unparsed_reason: 'header_not_found',
    },
  ],
  components: [
    {
      sheet_index_0based: 0,
      sheet_name: 'BOARD_A',
      source_rows_1based: [3],
      reference_designators: ['U1'],
      part_number: 'STM32F103C8T6',
      quantity: 1,
    },
    {
      sheet_index_0based: 1,
      sheet_name: 'BOARD_B',
      source_rows_1based: [2],
      reference_designators: ['R1'],
      part_number: 'RC0603FR-0710KL',
      manufacturer: 'Yageo',
      quantity: 1,
    },
    {
      sheet_index_0based: 0,
      sheet_name: 'BOARD_A',
      source_rows_1based: [2],
      reference_designators: ['R1', 'R2'],
      part_number: null,
      value_raw: '10k/1005',
      description: '10k resistor',
      quantity: 2,
    },
  ],
};

describe('BOM 견적 시트 선택', () => {
  it('엔진 시트 상태와 제외 사유를 선택 스냅샷으로 변환한다', () => {
    expect(extractEngineSheets(ENGINE_RESULT)).toEqual([
      expect.objectContaining({ sheetIndex: 0, sheetName: 'BOARD_A', status: 'parsed', componentCount: 2 }),
      expect.objectContaining({ sheetIndex: 1, sheetName: 'BOARD_B', status: 'parsed', componentCount: 1 }),
      expect.objectContaining({
        sheetIndex: 2,
        sheetName: 'README',
        status: 'not_bom',
        componentCount: 0,
        failureReason: 'header_not_found',
      }),
    ]);
  });

  it('선택한 시트의 모든 컴포넌트를 MPN 유무와 관계없이 원본 행 순서로 보존한다', () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [0]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sourceRow?.sourceRows)).toEqual([[2], [3]]);
    expect(items[0]).toMatchObject({
      rowIdx: 0,
      mpn: '',
      bomQty: 2,
      sourceSheetIndex: 0,
      sourceSheetName: 'BOARD_A',
      sourceRow: { valueRaw: '10k/1005' },
    });
    expect(items[1]).toMatchObject({ rowIdx: 1, mpn: 'STM32F103C8T6' });
  });

  it('선택한 시트의 시트·행 근거와 component id를 보존한다', () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [1]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      rowIdx: 0,
      mpn: 'RC0603FR-0710KL',
      bomQty: 1,
      sourceSheetIndex: 1,
      sourceSheetName: 'BOARD_B',
    });
    expect(items[0]?.sourceRow).toMatchObject({
      sheetName: 'BOARD_B',
      sourceRows: [2],
      referenceDesignators: ['R1'],
    });
    const componentId = items[0]?.sourceRow?.componentId;
    expect(typeof componentId).toBe('string');
    if (typeof componentId === 'string') expect(componentId).toMatch(/^[a-f0-9]{24}$/);
  });

  it('여러 시트를 선택해도 각 원본 행을 임의 병합하지 않는다', () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [0, 1]);

    expect(items).toHaveLength(3);
    expect(items.map((item) => [item.sourceSheetIndex, item.sourceRow?.sourceRows])).toEqual([
      [0, [2]],
      [0, [3]],
      [1, [2]],
    ]);
    expect(items.filter((item) => item.mpn === 'RC0603FR-0710KL')).toHaveLength(1);
    expect(new Set(items.map((item) => item.sourceSheetIndex))).toEqual(new Set([0, 1]));
  });
});

function candidate(
  status: string,
  mpn: string,
  supplier: string,
  unitPrice: number,
  moq: number,
  conflicts: string[] = [],
) {
  return {
    status,
    identity_confidence: status === 'verified_exact' ? 1 : 0,
    specification_confidence: status === 'spec_compatible' ? 1 : 0,
    conflicts,
    missing_requirements: [],
    reasons: [`${status}_reason`],
    corroborating_suppliers: [],
    product: {
      supplier,
      manufacturer_part_number: mpn,
      manufacturer: 'Test Mfr',
      description: mpn,
      offers: [
        {
          supplier,
          supplier_sku: `${supplier}-${mpn}`,
          packaging: 'Cut Tape',
          stock: 1_000,
          moq,
          order_multiple: 1,
          price_breaks: [{ quantity: 1, unit_price: unitPrice, currency: 'KRW' }],
          fetched_at: '2026-07-20T00:00:00.000Z',
        },
      ],
    },
  };
}

describe('BOM 엔진 후보 자동 선정', () => {
  it('MPN 없는 행은 충돌 없는 스펙 호환 후보 중 MOQ 포함 실효 총비용 최저를 고른다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-1',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'CHEAP-UNIT-HIGH-MOQ', 'digikey', 1, 100),
          candidate('spec_compatible', 'LOWEST-TOTAL', 'mouser', 5, 1),
        ],
      },
      false,
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('LOWEST-TOTAL');
    expect(decision?.pick?.offer.supplier).toBe('mouser');
    expect(decision?.evidence).toMatchObject({
      selectionMode: 'spec-compatible',
      eligibleCandidateCount: 2,
      selectedSupplier: 'mouser',
    });
  });

  it('원본 MPN이 있으면 더 싼 스펙 대체품보다 정확 일치를 우선한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-2',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'INPUT-MPN', 'digikey', 100, 1),
          candidate('spec_compatible', 'CHEAP-SUBSTITUTE', 'mouser', 1, 1),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('INPUT-MPN');
    expect(decision?.evidence.selectionMode).toBe('exact');
    expect(decision?.evidence.eligibleCandidateCount).toBe(1);
  });

  it('모호·충돌 후보와 MPN 입력 행의 스펙 대체품은 자동 선정하지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-3',
        status: 'input_conflict',
        candidates: [
          candidate('spec_compatible', 'CONFLICTED', 'digikey', 1, 1, ['package_mismatch']),
          candidate('ambiguous', 'AMBIGUOUS', 'mouser', 1, 1),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.pick).toBeNull();
    expect(decision?.evidence).toMatchObject({ selectionMode: 'review', eligibleCandidateCount: 0 });
  });
});
