import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  analysisComponentLookupWhere,
  applyEngineSupplierResult,
  buildItemsFromEngineResult,
  extractEngineSheets,
  filterActiveQuoteItems,
  isEngineManagedQuoteSelection,
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
      expect.objectContaining({ sheetIndex: 0, sheetName: 'BOARD_A', status: 'parsed', componentCount: 2, hasItems: false }),
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

  it('제외한 시트 라인만 빠지고 직접 추가한 라인은 유지한다', () => {
    const items = [
      { id: 'a', sourceSheetIndex: 0 },
      { id: 'b', sourceSheetIndex: 1 },
      { id: 'manual', sourceSheetIndex: null },
    ];
    const sheets = [
      { sheetIndex: 0, selected: true },
      { sheetIndex: 1, selected: false },
    ];

    expect(filterActiveQuoteItems(items, sheets).map((item) => item.id)).toEqual(['a', 'manual']);
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'manual']);
  });

  it('시트 스냅샷이 없는 구형 견적은 전체 라인을 유지한다', () => {
    const items = [{ id: 'legacy', sourceSheetIndex: 7 }];

    expect(filterActiveQuoteItems(items, [])).toEqual(items);
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

  it('엔진이 구매 제외로 판정한 행은 보존하되 견적 포함에서는 제외한다', () => {
    const items = buildItemsFromEngineResult({
      source_file: 'dnp.xlsx',
      components: [{
        sheet_index_0based: 0,
        sheet_name: 'BOM',
        source_rows_1based: [2],
        part_number: 'DNP-PART',
        quantity: 0,
        procurement_disposition: 'excluded',
      }],
    }, [0]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ included: false, mpn: 'DNP-PART' });
  });
});

interface CandidateOptions {
  currentDecisionContract?: boolean;
  eligibility?: 'automatic' | 'manual_review' | 'blocked';
  selectionMode?: 'exact' | 'variant' | 'spec-compatible' | 'review';
  technicalReviewRank?: number | null;
  selectionRecommendation?: 'preselect' | 'candidate_only' | 'exclude';
  reviewRecommended?: boolean;
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
  requirementAssessments?: {
    key: string;
    comparison: 'eq' | 'gte' | 'lte' | 'contains' | 'category';
    state: 'match' | 'mismatch' | 'missing' | 'not_applicable' | 'unverified';
    verified: boolean;
    expected_display: string | null;
    actual_display: string | null;
  }[];
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
  const identityKey = options.identityKey ?? `${mpn}:${options.manufacturer ?? 'Test Mfr'}`;
  const technicalEvidenceKey = options.technicalEvidenceKey ?? `${status}:${mpn}`;
  const decision = options.currentDecisionContract
    ? {
        decision_policy_version: 'supplier-candidate-decision-v1',
        category_policy_version: 'candidate-category-policy-v1',
        identity_key_version: 'candidate-identity-key-v1',
        evidence_key_version: 'candidate-evidence-key-v1',
        match_relation: selectionMode === 'review' ? 'unresolved' : selectionMode,
        selection_eligibility: eligibility,
        auto_eligible: eligibility === 'automatic',
        manual_selectable: eligibility !== 'blocked',
        reason_codes: eligibility === 'manual_review' ? ['manufacturer_confirmation_required'] : [],
        identity_key: identityKey,
        technical_evidence_key: technicalEvidenceKey,
        verified_requirement_count: verifiedCount,
        required_requirement_count: requiredCount,
        requirement_assessments: options.requirementAssessments ?? [],
        verification_complete: options.verificationComplete ?? verifiedCount === requiredCount,
        strict_category_coverage: options.strictCategoryCoverage ?? false,
        lifecycle_state: options.lifecycleState ?? 'unknown',
        technical_review_rank: options.technicalReviewRank ?? null,
        ...(options.selectionRecommendation === undefined
          ? {}
          : {
              selection_recommendation_policy_version: 'candidate-selection-recommendation-v1',
              selection_recommendation: options.selectionRecommendation,
              review_recommended: options.reviewRecommended ?? false,
            }),
      }
    : {
        policy_version: 'supplier-candidate-decision-v1',
        selection_eligibility: eligibility,
        selection_mode: selectionMode,
        auto_eligible: eligibility === 'automatic',
        manual_selectable: eligibility !== 'blocked',
        reason_codes: eligibility === 'manual_review' ? ['manufacturer_confirmation_required'] : [],
        identity_key: identityKey,
        technical_evidence_key: technicalEvidenceKey,
        verified_requirement_count: verifiedCount,
        required_requirement_count: requiredCount,
        verification_complete: options.verificationComplete ?? verifiedCount === requiredCount,
        strict_category_coverage: options.strictCategoryCoverage ?? false,
        lifecycle_state: options.lifecycleState ?? 'unknown',
      };
  return {
    status,
    identity_confidence: status === 'verified_exact' ? 1 : 0,
    specification_confidence: status === 'spec_compatible' ? 1 : 0,
    conflicts: options.conflicts ?? [],
    missing_requirements: options.missingRequirements ?? [],
    reasons: options.reasons ?? [`${status}_reason`],
    corroborating_suppliers: options.corroboratingSuppliers ?? [],
    decision,
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

function attachProcurementDecision(
  value: ReturnType<typeof candidate>,
  offerKey: string,
  recommendation: 'automatic' | 'manual_review' | 'none',
  requiredQuantity = 10,
  offerKeyVersion: 'supplier-offer-key-v1' | 'supplier-offer-key-v2' = 'supplier-offer-key-v1',
): void {
  const offer = value.product.offers[0];
  if (offer === undefined) throw new Error('test offer missing');
  Object.assign(offer, {
    procurement_decision: {
      procurement_policy_version: 'supplier-procurement-decision-v1',
      offer_key_version: offerKeyVersion,
      rank_scope: 'identity_and_technical_evidence',
      offer_key: offerKey,
      calculation_status: 'calculated',
      required_quantity: requiredQuantity,
      order_quantity: requiredQuantity,
      applied_price_break_quantity: 1,
      source_unit_price: String(offer.price_breaks[0]?.unit_price ?? 1),
      source_currency: 'KRW',
      exchange_rate: '1',
      target_currency: 'KRW',
      converted_unit_price: String(offer.price_breaks[0]?.unit_price ?? 1),
      line_total: String((offer.price_breaks[0]?.unit_price ?? 1) * requiredQuantity),
      stock_short: false,
      stock_short_quantity: 0,
      surplus_quantity: 0,
      excessive_order: false,
      price_rank: 1,
      purchase_fit_rank: recommendation === 'none' ? 2 : 1,
      purchasable: true,
      recommendation,
      reason_codes: ['fixture'],
    },
  });
}

function componentProcurementDecision(
  status: 'automatic_recommended' | 'review_recommended' | 'no_recommendation',
  offerKey: string | null,
  requiredQuantity = 10,
  options: {
    applicationIdentityKey?: string;
    applicationEvidenceKey?: string;
    technicalFallbackUsed?: boolean;
  } = {},
) {
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    selection_application_policy_version: 'supplier-selection-application-v2',
    status,
    selection_application_state: status === 'automatic_recommended'
      ? 'automatic_selected'
      : status === 'review_recommended'
        ? 'provisional_selected'
        : 'not_selected',
    confirmation_required: status === 'review_recommended',
    required_quantity: requiredQuantity,
    target_currency: 'KRW',
    currency_rate_snapshot_id: 'fixture-snapshot',
    currency_rate_as_of: '2026-07-21T00:00:00+09:00',
    currency_rate_source: 'pytest',
    technical_preselection_identity_key: 'ik1:engine-choice',
    technical_preselection_evidence_key: 'ek1:engine-choice',
    application_candidate_identity_key:
      status === 'no_recommendation'
        ? null
        : options.applicationIdentityKey ?? 'ik1:engine-choice',
    application_candidate_evidence_key:
      status === 'no_recommendation'
        ? null
        : options.applicationEvidenceKey ?? 'ek1:engine-choice',
    technical_fallback_used: options.technicalFallbackUsed ?? false,
    automatic_offer_key: status === 'automatic_recommended' ? offerKey : null,
    review_offer_key: status === 'review_recommended' ? offerKey : null,
    recommendation_reason_codes: ['fixture'],
  };
}

describe('BOM 엔진 후보 결정 투영', () => {
  it('명시 선택이 없는 none/auto 행만 엔진 적용 상태로 수렴시킨다', () => {
    const state = (selectionSource: 'none' | 'auto' | 'customer' | 'catalog') => ({
      selectionSource,
      selectedCandidateKey: null,
      selectedOffer: null,
    });

    expect(isEngineManagedQuoteSelection(state('none'))).toBe(true);
    expect(isEngineManagedQuoteSelection(state('auto'))).toBe(true);
    expect(isEngineManagedQuoteSelection(state('customer'))).toBe(false);
    expect(isEngineManagedQuoteSelection(state('catalog'))).toBe(false);
    expect(isEngineManagedQuoteSelection({
      selectionSource: 'none',
      selectedCandidateKey: 'customer-kept',
      selectedOffer: null,
    })).toBe(false);
  });

  it.each(['1.2', '1.3'])('%s 봉투가 현재 조달 결정 상태를 명시하지 않으면 전체 반영을 거부한다', async (schemaVersion) => {
    const result = await applyEngineSupplierResult(
      [],
      {
        supplier_search_schema_version: schemaVersion,
        search: { search_schema_version: schemaVersion, components: [] },
      },
      1,
      0,
      null,
    );

    expect(result).toEqual({
      applied: false,
      candidateSnapshots: [],
      searchTraceSnapshots: [],
    });
  });

  it('현재 엔진의 가격·재고·MOQ 추천 오퍼를 Node 재정렬 없이 투영한다', () => {
    const selected = candidate('verified_exact', 'ENGINE-PICK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      requiredCount: 1,
      verifiedCount: 1,
      requirementAssessments: [{
        key: 'voltage_v',
        comparison: 'gte',
        state: 'match',
        verified: true,
        expected_display: '25 V',
        actual_display: '50 V',
      }],
    });
    const cheaper = candidate('verified_exact', 'ENGINE-PICK', 'mouser', 1, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(
      selected,
      'ok2:engine-selected',
      'automatic',
      10,
      'supplier-offer-key-v2',
    );
    attachProcurementDecision(
      cheaper,
      'ok2:cheaper-not-selected',
      'none',
      10,
      'supplier-offer-key-v2',
    );

    const decision = selectEngineMatch(
      {
        component_id: 'component-procurement',
        status: 'verified_exact',
        procurement_decision: componentProcurementDecision(
          'automatic_recommended',
          'ok2:engine-selected',
        ),
        candidates: [selected, cheaper],
      },
      10,
      null,
    );

    expect(decision?.pick?.offer.supplier).toBe('digikey');
    expect(decision?.offerKey).toBe('ok2:engine-selected');
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v10');
    expect(decision?.evidence.selectionApplicationState).toBe('automatic_selected');
    expect(decision?.evidence.confirmationRequired).toBe(false);
    expect(decision?.evidence.technicalFallbackUsed).toBe(false);
    expect(decision?.evidence.decisionReasonCodes).toEqual([
      'engine-procurement-recommendation',
    ]);
    expect(decision?.snapshots[0]?.requirementAssessments).toEqual([{
      key: 'voltage_v',
      comparison: 'gte',
      state: 'match',
      verified: true,
      expectedDisplay: '25 V',
      actualDisplay: '50 V',
    }]);
  });

  it('오퍼 키와 선언된 키 버전이 다르면 엔진 계약을 거부한다', () => {
    const selected = candidate('verified_exact', 'MISMATCHED-KEY', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(
      selected,
      'ok1:legacy-prefix-with-v2-version',
      'automatic',
      10,
      'supplier-offer-key-v2',
    );

    expect(selectEngineMatch({
      component_id: 'component-key-version-mismatch',
      status: 'verified_exact',
      procurement_decision: componentProcurementDecision(
        'automatic_recommended',
        'ok1:legacy-prefix-with-v2-version',
      ),
      candidates: [selected],
    }, 10, null)).toBeNull();
  });

  it('엔진 검색 trace는 판정 없이 compact 요약으로 투영한다', () => {
    const selected = candidate('verified_exact', 'TRACE-PICK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(selected, 'ok1:trace-selected', 'automatic');
    const decision = selectEngineMatch(
      {
        component_id: 'component-trace',
        status: 'verified_exact',
        search_trace: {
          version: 'supplier-search-trace-v1',
          primary_query: '0603X03L_C',
          fallback_query: '1k 0603',
          fallback_used: true,
          attempts: [
            {
              sequence: 1,
              stage: 'primary',
              supplier: 'digikey',
              strategy: 'identity_exact',
              query: '0603X03L_C',
              source: 'live_api',
              outcome: 'empty',
              result_count: 0,
              api_calls: 1,
              http_attempt_count: 1,
              elapsed_ms: 12.5,
              fallback_reason: null,
              error_type: null,
            },
          ],
        },
        procurement_decision: componentProcurementDecision(
          'automatic_recommended',
          'ok1:trace-selected',
        ),
        candidates: [selected],
      },
      10,
      null,
    );

    expect(decision?.evidence.searchTraceSummary).toEqual({
      version: 'supplier-search-trace-v1',
      primaryQuery: '0603X03L_C',
      fallbackQuery: '1k 0603',
      fallbackUsed: true,
      attemptCount: 1,
    });
  });

  it('알 수 없는 trace enum은 견적 판정을 막지 않고 trace만 경고 후 생략한다', async () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [1]);
    const componentId = items[0]?.sourceRow?.componentId;
    expect(typeof componentId).toBe('string');
    if (typeof componentId !== 'string') return;
    const warn = vi.fn();
    const log = { warn } as unknown as Pick<FastifyBaseLogger, 'warn'>;

    const result = await applyEngineSupplierResult(
      items,
      {
        supplier_search_schema_version: '1.5',
        procurement_decision_contract_status: 'current',
        search: {
          search_schema_version: '1.5',
          components: [{
            component_id: componentId,
            status: 'not_found',
            search_trace: {
              version: 'supplier-search-trace-v1',
              primary_query: 'RC0603FR-0710KL',
              fallback_query: null,
              fallback_used: false,
              attempts: [{
                sequence: 1,
                stage: 'primary',
                supplier: 'digikey',
                strategy: 'identity_exact',
                query: 'RC0603FR-0710KL',
                source: 'future_cache_source',
                outcome: 'empty',
                result_count: 0,
                api_calls: 0,
                http_attempt_count: 0,
                elapsed_ms: 1,
                fallback_reason: null,
                error_type: null,
              }],
            },
            procurement_decision: {
              procurement_policy_version: 'supplier-procurement-decision-v1',
              selection_application_policy_version: 'supplier-selection-application-v2',
              status: 'no_recommendation',
              selection_application_state: 'not_selected',
              confirmation_required: false,
              required_quantity: 1,
              target_currency: 'KRW',
              currency_rate_snapshot_id: 'fixture-snapshot',
              currency_rate_as_of: '2026-07-21T00:00:00+09:00',
              currency_rate_source: 'pytest',
              technical_preselection_identity_key: null,
              technical_preselection_evidence_key: null,
              application_candidate_identity_key: null,
              application_candidate_evidence_key: null,
              technical_fallback_used: false,
              automatic_offer_key: null,
              review_offer_key: null,
              recommendation_reason_codes: [],
            },
            candidates: [],
          }],
        },
      },
      1,
      0,
      null,
      log,
    );

    expect(result.applied).toBe(true);
    expect(result.searchTraceSnapshots).toEqual([]);
    expect(items[0]?.matchEvidence?.searchTraceSummary).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceFailureCount: 1,
        traceFailures: [expect.objectContaining({ componentId })],
      }),
      expect.stringContaining('trace 계약 불일치'),
    );
  });

  it('엔진의 조달 수동 검토 추천은 임시 선정과 가격으로 그대로 적용한다', () => {
    const review = candidate('input_conflict', 'REVIEW-PICK', 'digikey', 100, 1, {
      currentDecisionContract: true,
      eligibility: 'manual_review',
      selectionMode: 'exact',
      technicalReviewRank: 1,
      selectionRecommendation: 'preselect',
      reviewRecommended: true,
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(review, 'ok1:review-selected', 'manual_review');

    const decision = selectEngineMatch(
      {
        component_id: 'component-procurement-review',
        status: 'input_conflict',
        procurement_decision: componentProcurementDecision(
          'review_recommended',
          'ok1:review-selected',
        ),
        candidates: [review],
      },
      10,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('REVIEW-PICK');
    expect(decision?.candidateKey).toBe('ik1:engine-choice');
    expect(decision?.offerKey).toBe('ok1:review-selected');
    expect(decision?.pick?.orderQty).toBe(10);
    expect(decision?.recommendedCandidateKey).toBe('ik1:engine-choice');
    expect(decision?.evidence.selectionApplicationState).toBe('provisional_selected');
    expect(decision?.evidence.confirmationRequired).toBe(true);
    expect(decision?.evidence.technicalFallbackUsed).toBe(false);
    expect(decision?.evidence.decisionReasonCodes).toEqual(['engine-manual-review']);
  });

  it('기술 1순위가 구매 불가하면 엔진이 지정한 다음 구매 가능 후보를 적용한다', () => {
    const technicalTop = candidate('input_conflict', 'TECHNICAL-TOP', 'mouser', 100, 1, {
      currentDecisionContract: true,
      eligibility: 'manual_review',
      selectionMode: 'exact',
      technicalReviewRank: 1,
      selectionRecommendation: 'preselect',
      reviewRecommended: true,
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      stock: 0,
    });
    attachProcurementDecision(technicalTop, 'ok1:unavailable-top', 'none');
    const fallback = candidate('input_conflict', 'PURCHASABLE-FALLBACK', 'digikey', 80, 1, {
      currentDecisionContract: true,
      eligibility: 'manual_review',
      selectionMode: 'exact',
      technicalReviewRank: 2,
      selectionRecommendation: 'candidate_only',
      reviewRecommended: false,
      identityKey: 'ik1:fallback',
      technicalEvidenceKey: 'ek1:fallback',
    });
    attachProcurementDecision(fallback, 'ok1:fallback-selected', 'manual_review');

    const decision = selectEngineMatch(
      {
        component_id: 'component-procurement-fallback',
        status: 'input_conflict',
        procurement_decision: componentProcurementDecision(
          'review_recommended',
          'ok1:fallback-selected',
          10,
          {
            applicationIdentityKey: 'ik1:fallback',
            applicationEvidenceKey: 'ek1:fallback',
            technicalFallbackUsed: true,
          },
        ),
        candidates: [technicalTop, fallback],
      },
      10,
      null,
    );

    expect(decision?.candidate?.product.manufacturer_part_number).toBe('PURCHASABLE-FALLBACK');
    expect(decision?.recommendedCandidateKey).toBe('ik1:fallback');
    expect(decision?.evidence.technicalPreselectionCandidateKey).toBe('ik1:engine-choice');
    expect(decision?.evidence.technicalFallbackUsed).toBe(true);
    expect(decision?.evidence.decisionReasonCodes).toEqual([
      'engine-manual-review',
      'engine-technical-fallback',
    ]);
  });

  it('검토 권장인데 엔진 적용 상태가 임시 선정이 아니면 fail-closed 처리한다', () => {
    const review = candidate('input_conflict', 'INVALID-APPLICATION', 'digikey', 100, 1, {
      currentDecisionContract: true,
      eligibility: 'manual_review',
      selectionMode: 'exact',
      technicalReviewRank: 1,
      selectionRecommendation: 'preselect',
      reviewRecommended: true,
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(review, 'ok1:invalid-application', 'manual_review');

    const decision = selectEngineMatch(
      {
        component_id: 'component-invalid-application',
        status: 'input_conflict',
        procurement_decision: {
          ...componentProcurementDecision('review_recommended', 'ok1:invalid-application'),
          selection_application_state: 'automatic_selected',
        },
        candidates: [review],
      },
      10,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.evidence.decisionReasonCodes).toEqual(['no-safe-candidate']);
  });

  it('엔진 조달 결정의 필요수량이 견적 수량과 다르면 fail-closed 처리한다', () => {
    const selected = candidate('verified_exact', 'STALE-PICK', 'digikey', 100, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    attachProcurementDecision(selected, 'ok1:stale-selected', 'automatic', 9);

    const decision = selectEngineMatch(
      {
        component_id: 'component-stale-procurement',
        status: 'verified_exact',
        procurement_decision: componentProcurementDecision(
          'automatic_recommended',
          'ok1:stale-selected',
          9,
        ),
        candidates: [selected],
      },
      10,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.evidence.decisionReasonCodes).toEqual(['no-safe-candidate']);
  });

  it('조달 결정 없는 사전 선정만으로 후보를 자동 적용하지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-engine-preselection',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'ENGINE-PRESELECT', 'digikey', 1_000, 1, {
            currentDecisionContract: true,
            selectionRecommendation: 'preselect',
            identityKey: 'ik1:engine-preselect',
            technicalEvidenceKey: 'ek1:engine-preselect',
          }),
          candidate('verified_exact', 'CHEAPER-CANDIDATE', 'mouser', 1, 1, {
            currentDecisionContract: true,
            selectionRecommendation: 'candidate_only',
            identityKey: 'ik1:cheaper-candidate',
            technicalEvidenceKey: 'ek1:cheaper-candidate',
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v10');
    expect(decision?.evidence.decisionReasonCodes).toEqual(['engine-procurement-unavailable']);
    expect(decision?.snapshots.map((candidate) => candidate.selectionRecommendation)).toEqual([
      'preselect',
      'candidate_only',
    ]);
  });

  it('조달 결정 없는 수동 사전 선정은 검토 권장으로 승격하지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-engine-review-preselection',
        status: 'input_conflict',
        candidates: [candidate('input_conflict', 'REVIEW-PRESELECT', 'digikey', 100, 1, {
          currentDecisionContract: true,
          eligibility: 'manual_review',
          selectionMode: 'exact',
          technicalReviewRank: 1,
          selectionRecommendation: 'preselect',
          reviewRecommended: true,
          identityKey: 'ik1:review-preselect',
          technicalEvidenceKey: 'ek1:review-preselect',
        })],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.candidateKey).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.evidence.decisionReasonCodes).toEqual(['engine-procurement-unavailable']);
    expect(decision?.snapshots[0]).toMatchObject({
      selectionRecommendation: 'preselect',
      reviewRecommended: true,
      technicalReviewRank: 1,
      autoEligible: false,
      manualSelectable: true,
    });
  });

  it('현재 엔진 계약의 수동 검토 순위를 일반 기술 순위와 분리해 보존한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-review-rank',
        status: 'input_conflict',
        candidates: [candidate('input_conflict', 'REVIEW-MPN', 'digikey', 100, 1, {
          currentDecisionContract: true,
          eligibility: 'manual_review',
          selectionMode: 'exact',
          technicalReviewRank: 1,
          identityKey: 'ik1:review-candidate',
          technicalEvidenceKey: 'ek1:review-evidence',
        })],
      },
      1,
      null,
    );

    expect(decision?.snapshots[0]).toMatchObject({
      technicalRank: 1,
      technicalReviewRank: 1,
      selectionEligibility: 'manual_review',
      selectionMode: 'exact',
      autoEligible: false,
      manualSelectable: true,
    });
  });

  it('현재 엔진 계약이 비수동 후보에 검토 순위를 부여하면 fail-closed 처리한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-invalid-review-rank',
        status: 'verified_exact',
        candidates: [candidate('verified_exact', 'INVALID-RANK', 'digikey', 100, 1, {
          currentDecisionContract: true,
          eligibility: 'automatic',
          technicalReviewRank: 1,
          identityKey: 'ik1:invalid-rank',
          technicalEvidenceKey: 'ek1:invalid-rank',
        })],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.snapshots[0]).toMatchObject({
      technicalReviewRank: null,
      selectionEligibility: 'blocked',
      autoEligible: false,
      manualSelectable: false,
      selectionReasonCodes: ['decision_unavailable'],
    });
  });

  it('현재 엔진 계약이 둘 이상의 후보를 사전 선정하면 자동 적용하지 않는다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-duplicate-preselection',
        status: 'verified_exact',
        candidates: [
          candidate('verified_exact', 'PRESELECT-A', 'digikey', 100, 1, {
            currentDecisionContract: true,
            selectionRecommendation: 'preselect',
            identityKey: 'ik1:preselect-a',
            technicalEvidenceKey: 'ek1:preselect-a',
          }),
          candidate('verified_exact', 'PRESELECT-B', 'mouser', 90, 1, {
            currentDecisionContract: true,
            selectionRecommendation: 'preselect',
            identityKey: 'ik1:preselect-b',
            technicalEvidenceKey: 'ek1:preselect-b',
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.snapshots).toHaveLength(2);
  });

  it('차단 후보를 candidate_only로 전달한 엔진 결정은 fail-closed 처리한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-invalid-blocked-recommendation',
        status: 'input_conflict',
        candidates: [candidate('input_conflict', 'INVALID-BLOCKED', 'digikey', 100, 1, {
          currentDecisionContract: true,
          eligibility: 'blocked',
          selectionRecommendation: 'candidate_only',
          identityKey: 'ik1:invalid-blocked',
          technicalEvidenceKey: 'ek1:invalid-blocked',
        })],
      },
      1,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.snapshots[0]).toMatchObject({
      selectionRecommendation: null,
      selectionReasonCodes: ['decision_unavailable'],
      selectionEligibility: 'blocked',
      manualSelectable: false,
    });
  });

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
    expect(decision?.pick).toBeNull();
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v10');
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
    expect(decision?.pick).toBeNull();
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

  it('조달 결정이 없으면 Node가 MOQ·총액으로 후보를 고르지 않는다', () => {
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

    expect(decision?.candidate).toBeNull();
    expect(decision?.recommendedCandidateKey).toBeNull();
    expect(decision?.evidence.decisionReasonCodes).toEqual(['engine-procurement-unavailable']);
  });

  it('조달 결정이 없으면 Node가 스펙 후보를 가격으로 교체하지 않는다', () => {
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

    expect(decision?.candidate).toBeNull();
    expect(decision?.evidence).toMatchObject({
      recommendationType: 'none',
      decisionReasonCodes: ['engine-procurement-unavailable'],
    });
  });

  it('조달 결정이 없으면 Node가 수명주기로 후보를 교체하지 않는다', () => {
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

    expect(decision?.candidate).toBeNull();
    expect(decision?.evidence.recommendationType).toBe('none');
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
