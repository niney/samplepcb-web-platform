import { describe, expect, it } from 'vitest';
import {
  analysisComponentLookupWhere,
  buildItemsFromEngineResult,
  extractEngineSheets,
  selectEngineMatch,
} from './bom-quote';

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
  it('영속 분석 component를 실제 analysisRunId 필드로 조회한다', () => {
    expect(analysisComponentLookupWhere(3n, ['component-a', 'component-b'])).toEqual({
      analysisRunId: 3n,
      engineComponentId: { in: ['component-a', 'component-b'] },
    });
  });

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
  options: {
    category?: string;
    reasons?: string[];
    stock?: number;
    lifecycleStatus?: string;
    manufacturer?: string | null;
    description?: string;
    packageCode?: string | null;
    normalizedSpecs?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    missingRequirements?: string[];
  } = {},
) {
  return {
    status,
    identity_confidence: status === 'verified_exact' ? 1 : 0,
    specification_confidence: status === 'spec_compatible' ? 1 : 0,
    conflicts,
    missing_requirements: options.missingRequirements ?? [],
    reasons: options.reasons ?? [`${status}_reason`],
    corroborating_suppliers: [],
    product: {
      supplier,
      manufacturer_part_number: mpn,
      manufacturer: options.manufacturer === undefined ? 'Test Mfr' : options.manufacturer,
      description: options.description ?? mpn,
      category: options.category,
      package: options.packageCode,
      lifecycle_status: options.lifecycleStatus,
      normalized_specs: options.normalizedSpecs ?? {},
      attributes: options.attributes ?? {},
      offers: [
        {
          supplier,
          supplier_sku: `${supplier}-${mpn}`,
          packaging: 'Cut Tape',
          stock: options.stock ?? 1_000,
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
  it('제조사 없는 MPN의 동급 불완전 후보는 과다구매 대신 구매조건이 가까운 후보를 고른다', () => {
    const shared = {
      reasons: ['manufacturer_part_number_exact', 'part_type_match'],
      missingRequirements: ['package'],
    };
    const decision = selectEngineMatch(
      {
        component_id: 'component-ambiguous-purchase-fit',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'M7', 'digikey', 104.958, 20_000, [], {
            ...shared,
            manufacturer: 'MDD',
          }),
          candidate('verified_exact', 'M7', 'digikey', 191, 1, [], {
            ...shared,
            manufacturer: 'Diotec Semiconductor',
          }),
        ],
      },
      true,
      3,
      null,
      { valueRaw: 'M7(1N4007SMD)', packageCode: 'DO214 SMAJ', manufacturerName: null },
    );

    expect(decision?.candidate?.product.manufacturer).toBe('Diotec Semiconductor');
    expect(decision?.pick?.orderQty).toBe(3);
    expect(decision?.evidence).toMatchObject({
      selectedTechnicalRank: 2,
      recommendationType: 'purchase-fit',
      decisionReasonCodes: ['identity-exact', 'purchase-fit', 'same-part-lowest-total'],
      missingRequirements: ['package'],
      priceEvidence: { neededQty: 3, orderQty: 3, lineTotalKrw: 573 },
    });
  });

  it('원본 제조사가 있으면 동급 후보라도 다른 제조사로 구매조건 전환하지 않는다', () => {
    const shared = {
      reasons: ['manufacturer_part_number_exact', 'part_type_match'],
      missingRequirements: ['package'],
    };
    const decision = selectEngineMatch(
      {
        component_id: 'component-original-manufacturer',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'M7', 'digikey', 104.958, 20_000, [], { ...shared, manufacturer: 'MDD' }),
          candidate('verified_exact', 'M7', 'digikey', 191, 1, [], { ...shared, manufacturer: 'Diotec Semiconductor' }),
        ],
      },
      true,
      3,
      null,
      { valueRaw: 'M7', packageCode: null, manufacturerName: 'MDD' },
    );

    expect(decision?.candidate?.product.manufacturer).toBe('MDD');
    expect(decision?.evidence.recommendationType).toBe('identity');
  });

  it('MPN 없는 행도 필수 스펙 검증 근거가 없으면 가격만으로 기술 1순위를 뒤집지 않는다', () => {
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

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('CHEAP-UNIT-HIGH-MOQ');
    expect(decision?.pick?.offer.supplier).toBe('digikey');
    expect(decision?.evidence).toMatchObject({
      selectionMode: 'spec-compatible',
      eligibleCandidateCount: 2,
      selectedTechnicalRank: 1,
      recommendationType: 'technical',
      decisionReasonCodes: ['technical-top', 'same-part-lowest-total'],
    });
  });

  it('필수 스펙이 모두 검증되고 10%·500원 이상 절감되면 가격 대체품을 추천한다', () => {
    const fullSpecReasons = [
      'resistance_ohm_match',
      'power_w_match',
      'tolerance_percent_match',
      'package_match',
    ];
    const decision = selectEngineMatch(
      {
        component_id: 'component-price-saving',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'TECHNICAL-TOP', 'digikey', 2_000, 1, [], {
            category: 'resistor',
            reasons: fullSpecReasons,
          }),
          candidate('spec_compatible', 'SAFE-SAVING', 'mouser', 1_000, 1, [], {
            category: 'resistor',
            reasons: fullSpecReasons,
          }),
        ],
      },
      false,
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('SAFE-SAVING');
    expect(decision?.evidence).toMatchObject({
      selectedTechnicalRank: 2,
      recommendationType: 'price',
      decisionReasonCodes: ['strict-spec-price-saving', 'same-part-lowest-total'],
      verifiedRequirementCount: 4,
      requiredRequirementCount: 4,
      priceEvidence: {
        lineTotalKrw: 1_000,
        technicalTopLineTotalKrw: 2_000,
        savingsKrw: 1_000,
        savingsRate: 0.5,
      },
    });
  });

  it('필수 스펙이 같아도 절감액이 500원 미만이면 기술 1순위를 유지한다', () => {
    const fullSpecReasons = [
      'resistance_ohm_match',
      'power_w_match',
      'tolerance_percent_match',
      'package_match',
    ];
    const decision = selectEngineMatch(
      {
        component_id: 'component-small-saving',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'TECHNICAL-TOP', 'digikey', 1_200, 1, [], {
            category: 'resistor',
            reasons: fullSpecReasons,
          }),
          candidate('spec_compatible', 'SMALL-SAVING', 'mouser', 800, 1, [], {
            category: 'resistor',
            reasons: fullSpecReasons,
          }),
        ],
      },
      false,
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('TECHNICAL-TOP');
    expect(decision?.evidence).toMatchObject({ selectedTechnicalRank: 1, recommendationType: 'technical' });
  });

  it('칩전해 원본은 동일 직경 스루홀을 차단하고 검증된 활성 SMD 후보를 우선한다', () => {
    const electricalReasons = ['capacitance_f_match', 'voltage_v_match', 'part_type_match'];
    const decision = selectEngineMatch(
      {
        component_id: 'component-chip-electrolytic',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'EEE-1HA221P', 'mouser', 1_326, 1, [], {
            category: '커패시터',
            description: '알루미늄 전해 커패시터 220 µF 50 V 방사형, 캔 - SMD',
            packageCode: '방사형, 캔 - SMD',
            lifecycleStatus: '기존 설계 전용',
            reasons: electricalReasons,
            normalizedSpecs: { package: 'SMD' },
            attributes: {
              '실장 유형': '표면 실장',
              '크기/치수': '0.394" Dia(10.00mm)',
            },
          }),
          candidate('spec_compatible', 'UWT1H221MNL1GS', 'digikey', 1_273, 1, [], {
            category: '커패시터',
            description: '알루미늄 전해 커패시터 220 µF 50 V 방사형, 캔 - SMD',
            packageCode: '방사형, 캔 - SMD',
            lifecycleStatus: '활성',
            reasons: electricalReasons,
            normalizedSpecs: { package: 'SMD' },
            attributes: {
              '실장 유형': '표면 실장',
              '크기/치수': '0.394" Dia(10.00mm)',
            },
          }),
          candidate('spec_compatible', '50ZLH220MEFC10X16', 'digikey', 1_066, 1, [], {
            category: '커패시터',
            description: '알루미늄 전해 커패시터 220 µF 50 V 방사형, 캔',
            packageCode: '방사형, 캔',
            lifecycleStatus: '활성',
            reasons: electricalReasons,
            attributes: {
              '실장 유형': '스루홀',
              '크기/치수': '0.394" Dia(10.00mm)',
            },
          }),
        ],
      },
      false,
      2,
      null,
      { valueRaw: '220uF/50V/칩전해10파이', packageCode: null, manufacturerName: null },
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('UWT1H221MNL1GS');
    expect(decision?.evidence).toMatchObject({
      selectedTechnicalRank: 2,
      recommendationType: 'lifecycle',
      decisionReasonCodes: ['lifecycle-improvement', 'same-part-lowest-total'],
      verifiedRequirementCount: 5,
      requiredRequirementCount: 5,
    });
    const blocked = decision?.snapshots.find((snapshot) => snapshot.mpn === '50ZLH220MEFC10X16');
    expect(blocked).toMatchObject({
      safety: 'blocked',
      autoEligible: false,
      conflicts: ['mount_style_mismatch'],
      verifiedRequirementCount: 4,
      requiredRequirementCount: 5,
      packageComparison: {
        source: { mountStyle: 'smd', diameterMm: 10 },
        candidate: { mountStyle: 'through-hole', diameterMm: 10 },
        checks: { mountStyle: 'mismatch', diameterMm: 'match' },
      },
    });
    expect(blocked?.reasons).toContain('diameter_mm_match');
  });

  it('같은 제조사·MPN의 공급사 행은 하나의 부품 후보로 묶고 실효 총비용 최저 오퍼를 고른다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-same-part',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'SAME-MPN', 'digikey', 100, 1, [], { manufacturer: 'Panasonic' }),
          candidate('verified_exact', 'SAME-MPN', 'mouser', 10, 1, [], { manufacturer: 'Panasonic Industry' }),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.snapshots).toHaveLength(1);
    expect(decision?.snapshots[0]?.offers).toHaveLength(2);
    expect(decision?.pick?.offer.supplier).toBe('mouser');
    expect(decision?.evidence).toMatchObject({
      candidateCount: 2,
      groupedCandidateCount: 1,
      selectedTechnicalRank: 1,
      recommendationType: 'identity',
    });
  });

  it('같은 MPN이라도 제조사가 다르면 미확인 제조사 행이 두 제조사를 합치는 연결고리가 되지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-manufacturer-boundary',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'SHARED-MPN', 'digikey', 100, 1, [], { manufacturer: 'Maker A' }),
          candidate('verified_exact', 'SHARED-MPN', 'mouser', 90, 1, [], { manufacturer: 'Maker B' }),
          candidate('verified_exact', 'SHARED-MPN', 'unikey', 80, 1, [], { manufacturer: null }),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.snapshots).toHaveLength(3);
    expect(new Set(decision?.snapshots.map((snapshot) => snapshot.candidateKey)).size).toBe(3);
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
    expect(decision?.evidence.identityFallback).toBe(false);
  });

  it('품번 미검색 뒤 엔진이 만든 스펙 폴백 후보는 원본 MPN이 있어도 안전 후보로 적용한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-identity-fallback',
        mode: 'parametric',
        status: 'spec_compatible',
        initial_query: {
          mode: 'identity',
          part_number: '0603X03L_C',
        },
        query: {
          mode: 'parametric',
          part_number: null,
        },
        candidates: [
          candidate('spec_compatible', 'RC0402FR-071KL', 'digikey', 10, 1, [], {
            category: 'Chip Resistor',
            reasons: ['resistance_ohm_match', 'part_type_match'],
          }),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('RC0402FR-071KL');
    expect(decision?.evidence).toMatchObject({
      identityFallback: true,
      selectionMode: 'spec-compatible',
      eligibleCandidateCount: 1,
      recommendationType: 'technical',
    });
  });

  it('품번 미검색 폴백이어도 필수 스펙이 누락된 후보는 적용하지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-identity-fallback-missing-spec',
        mode: 'parametric',
        status: 'spec_partial',
        initial_query: {
          mode: 'identity',
          part_number: '0603X03L_C',
        },
        query: {
          mode: 'parametric',
          part_number: null,
        },
        candidates: [
          candidate('spec_compatible', 'UNVERIFIED-PACKAGE', 'digikey', 10, 1, [], {
            missingRequirements: ['package'],
          }),
        ],
      },
      true,
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.pick).toBeNull();
    expect(decision?.evidence).toMatchObject({
      identityFallback: true,
      selectionMode: 'review',
      eligibleCandidateCount: 0,
      missingRequirements: ['package'],
    });
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
