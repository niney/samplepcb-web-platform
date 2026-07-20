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

interface CandidateOptions {
  eligibility?: 'automatic' | 'manual_review' | 'blocked';
  selectionMode?: 'exact' | 'variant' | 'spec-compatible' | 'review';
  identityKey?: string;
  technicalEvidenceKey?: string;
  verificationComplete?: boolean;
  strictCategoryCoverage?: boolean;
  lifecycleState?: 'active' | 'caution' | 'unknown';
  lifecycleStatus?: string;
  manufacturer?: string | null;
  conflicts?: string[];
  missingRequirements?: string[];
  reasons?: string[];
  requiredCount?: number;
  verifiedCount?: number;
  stock?: number;
  corroboratingSuppliers?: string[];
}

function candidate(
  status: string,
  mpn: string,
  supplier: string,
  unitPrice: number,
  moq: number,
  options: CandidateOptions = {},
) {
  const selectionMode = options.selectionMode
    ?? (status === 'verified_exact' ? 'exact' : status === 'verified_variant' ? 'variant' : 'spec-compatible');
  const eligibility = options.eligibility ?? 'automatic';
  const requiredCount = options.requiredCount ?? 0;
  const verifiedCount = options.verifiedCount ?? requiredCount;
  return {
    status,
    identity_confidence: status === 'verified_exact' ? 1 : 0,
    specification_confidence: status === 'spec_compatible' ? 1 : 0,
    conflicts: options.conflicts ?? [],
    missing_requirements: options.missingRequirements ?? [],
    reasons: options.reasons ?? [`${status}_reason`],
    corroborating_suppliers: options.corroboratingSuppliers ?? [],
    decision: {
      policy_version: 'supplier-candidate-decision-v1',
      selection_eligibility: eligibility,
      selection_mode: selectionMode,
      auto_eligible: eligibility === 'automatic',
      manual_selectable: eligibility !== 'blocked',
      reason_codes: eligibility === 'manual_review' ? ['manufacturer_confirmation_required'] : [],
      identity_key: options.identityKey ?? `${mpn}:${options.manufacturer ?? 'Test Mfr'}`,
      technical_evidence_key: options.technicalEvidenceKey ?? `${status}:${mpn}`,
      verified_requirement_count: verifiedCount,
      required_requirement_count: requiredCount,
      verification_complete: options.verificationComplete ?? verifiedCount === requiredCount,
      strict_category_coverage: options.strictCategoryCoverage ?? false,
      lifecycle_state: options.lifecycleState ?? 'unknown',
    },
    product: {
      supplier,
      manufacturer_part_number: mpn,
      manufacturer: options.manufacturer === undefined ? 'Test Mfr' : options.manufacturer,
      description: mpn,
      lifecycle_status: options.lifecycleStatus,
      normalized_specs: {},
      attributes: {},
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

describe('BOM 엔진 후보 결정 투영', () => {
  it('엔진 그룹 키가 같은 공급사 행만 하나의 후보로 합친다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-engine-group',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'SAME-MPN', 'digikey', 100, 1, { identityKey: 'engine-group-1' }),
          candidate('verified_exact', 'SAME-MPN', 'mouser', 10, 1, { identityKey: 'engine-group-1' }),
        ],
      },
      1,
      null,
    );

    expect(decision?.snapshots).toHaveLength(1);
    expect(decision?.snapshots[0]?.offers).toHaveLength(2);
    expect(decision?.pick?.offer.supplier).toBe('mouser');
  });

  it('같은 엔진 그룹에서도 기술 근거가 다른 차단 후보의 오퍼는 합치지 않는다', () => {
    const safe = candidate('verified_exact', 'SAME-MPN', 'digikey', 100, 1, {
      identityKey: 'engine-group-1',
      technicalEvidenceKey: 'safe-evidence',
      corroboratingSuppliers: ['digikey', 'mouser'],
    });
    const decision = selectEngineMatch(
      {
        component_id: 'component-evidence-boundary',
        status: 'verified_exact',
        candidates: [
          safe,
          candidate('input_conflict', 'SAME-MPN', 'mouser', 1, 1, {
            identityKey: 'engine-group-1',
            technicalEvidenceKey: 'blocked-evidence',
            selectionMode: 'exact',
            eligibility: 'blocked',
            conflicts: ['resistance_ohm_mismatch'],
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.snapshots).toHaveLength(1);
    expect(decision?.snapshots[0]?.offers).toHaveLength(1);
    expect(decision?.snapshots[0]?.offers[0]?.supplier).toBe('digikey');
    expect(decision?.snapshots[0]?.corroboratingSuppliers).toEqual(['digikey']);
    expect(decision?.pick?.offer.supplier).toBe('digikey');
  });

  it('같은 MPN도 엔진 그룹 키가 다르면 Node가 제조사 별칭으로 다시 합치지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-engine-boundary',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'SHARED-MPN', 'digikey', 100, 1, { identityKey: 'maker-a' }),
          candidate('verified_exact', 'SHARED-MPN', 'mouser', 90, 1, { identityKey: 'maker-b' }),
        ],
      },
      1,
      null,
    );

    expect(decision?.snapshots).toHaveLength(2);
  });

  it('정확 MPN의 제조사 확인 후보는 자동 선택하지 않고 수동 선택 가능 상태로 보존한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-manufacturer-review',
        status: 'input_conflict',
        candidates: [
          candidate('input_conflict', 'RVT1J101M1010', 'digikey', 100, 1, {
            selectionMode: 'exact',
            eligibility: 'manual_review',
            conflicts: ['manufacturer_mismatch'],
            missingRequirements: ['package'],
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.snapshots[0]).toMatchObject({
      selectionEligibility: 'manual_review',
      safety: 'caution',
      autoEligible: false,
      manualSelectable: true,
      selectionReasonCodes: ['manufacturer_confirmation_required'],
    });
  });

  it('결정 계약이 없는 이전 후보는 Node 규칙으로 복구하지 않고 차단한다', () => {
    const withoutDecision = candidate('verified_exact', 'LEGACY', 'digikey', 100, 1);
    Reflect.deleteProperty(withoutDecision, 'decision');
    const decision = selectEngineMatch(
      { component_id: 'component-legacy', status: 'verified_exact', candidates: [withoutDecision] },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.snapshots[0]).toMatchObject({
      selectionEligibility: 'blocked',
      autoEligible: false,
      manualSelectable: false,
    });
  });

  it('선택 자격과 권한 boolean이 모순된 엔진 결정도 차단한다', () => {
    const inconsistent = candidate('verified_exact', 'INCONSISTENT', 'digikey', 100, 1, {
      eligibility: 'blocked',
    });
    inconsistent.decision.auto_eligible = true;
    inconsistent.decision.manual_selectable = true;

    const decision = selectEngineMatch(
      { component_id: 'component-inconsistent', status: 'verified_exact', candidates: [inconsistent] },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.snapshots[0]).toMatchObject({
      selectionEligibility: 'blocked',
      autoEligible: false,
      manualSelectable: false,
      selectionReasonCodes: ['decision_unavailable'],
    });
  });

  it('엔진이 동등하다고 한 기술 근거 안에서만 MOQ·총액 구매조건을 비교한다', () => {
    const shared = {
      technicalEvidenceKey: 'same-engine-evidence',
      verificationComplete: false,
      requiredCount: 2,
      verifiedCount: 1,
    };
    const decision = selectEngineMatch(
      {
        component_id: 'component-purchase-fit',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'M7-A', 'digikey', 104.958, 20_000, shared),
          candidate('verified_exact', 'M7-B', 'mouser', 191, 1, shared),
        ],
      },
      3,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('M7-B');
    expect(decision?.evidence.recommendationType).toBe('purchase-fit');
    expect(decision?.pick?.orderQty).toBe(3);
  });

  it('엔진이 완전 검증한 스펙 후보들 사이에서만 가격 절감을 적용한다', () => {
    const engineVerified = {
      selectionMode: 'spec-compatible' as const,
      strictCategoryCoverage: true,
      verificationComplete: true,
      requiredCount: 4,
      verifiedCount: 4,
    };
    const decision = selectEngineMatch(
      {
        component_id: 'component-price',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'TECHNICAL-TOP', 'digikey', 2_000, 1, engineVerified),
          candidate('spec_compatible', 'SAFE-SAVING', 'mouser', 1_000, 1, engineVerified),
        ],
      },
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('SAFE-SAVING');
    expect(decision?.evidence).toMatchObject({
      recommendationType: 'price',
      verifiedRequirementCount: 4,
      requiredRequirementCount: 4,
    });
  });

  it('수명주기 개선도 엔진 상태만 사용하며 문자열을 다시 해석하지 않는다', () => {
    const engineVerified = {
      selectionMode: 'spec-compatible' as const,
      strictCategoryCoverage: true,
      lifecycleStatus: 'unrecognized text',
    };
    const decision = selectEngineMatch(
      {
        component_id: 'component-lifecycle',
        status: 'spec_compatible',
        candidates: [
          candidate('spec_compatible', 'OLD', 'digikey', 1_000, 1, {
            ...engineVerified,
            lifecycleState: 'caution',
          }),
          candidate('spec_compatible', 'ACTIVE', 'mouser', 1_100, 1, {
            ...engineVerified,
            lifecycleState: 'active',
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('ACTIVE');
    expect(decision?.evidence.recommendationType).toBe('lifecycle');
  });

  it('품번 미검색 스펙 폴백 여부는 엔진의 명시 필드만 투영한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-fallback',
        status: 'spec_compatible',
        identity_fallback: true,
        candidates: [candidate('spec_compatible', 'SPEC-HIT', 'digikey', 10, 1, {
          selectionMode: 'spec-compatible',
        })],
      },
      1,
      null,
    );

    expect(decision?.evidence.identityFallback).toBe(true);
    expect(decision?.evidence.selectionMode).toBe('spec-compatible');
  });
});
