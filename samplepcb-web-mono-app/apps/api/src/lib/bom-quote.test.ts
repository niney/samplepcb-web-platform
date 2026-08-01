import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminBomQuoteItemSelectionBody,
  BomQuoteSearchRequirements,
  BomQuoteSearchRequirementsBody,
} from '@sp/api-contract';
import { prisma } from './prisma';
import {
  analysisComponentLookupWhere,
  adminQuoteSelectionBlockReason,
  applyEngineSupplierResult,
  buildItemsFromEngineResult,
  catalogIngestRunReady,
  extractEngineSheets,
  filterActiveQuoteItems,
  isEngineManagedQuoteSelection,
  loadLatestQuoteLocalCatalogTrace,
  loadSupplierSearchSummary,
  projectEnginePartSearchResult,
  quoteNeedsEnrichment,
  quoteLocalCatalogTrace,
  quoteCandidatePartsSearchable,
  retainQuoteCandidateSnapshots,
  resolvePartDataStatus,
  rfqRequestsQuoteItem,
  selectEngineMatch,
} from './bom-quote';

describe('관리자 견적 부품 교체 정책', () => {
  const allowed = {
    status: 'reviewing',
    buildStatus: 'ready',
    enrichStatus: 'done',
    ctId: null,
    poCount: 0,
    rfqTargetsItem: false,
    quoteUpdatedAt: '2026-08-02T10:00:00.000Z',
    expectedQuoteUpdatedAt: '2026-08-02T10:00:00.000Z',
    force: false,
  };

  it('요청·검토 중이며 RFQ·주문·발주가 없는 최신 행만 허용한다', () => {
    expect(adminQuoteSelectionBlockReason(allowed)).toBeNull();
    expect(adminQuoteSelectionBlockReason({ ...allowed, status: 'requested' })).toBeNull();
  });

  it('오래된 화면과 진행 중 계산을 먼저 차단한다', () => {
    expect(adminQuoteSelectionBlockReason({
      ...allowed,
      expectedQuoteUpdatedAt: '2026-08-02T09:59:59.000Z',
    })).toBe('stale-quote');
    expect(adminQuoteSelectionBlockReason({ ...allowed, buildStatus: 'building' })).toBe('quote-busy');
    expect(adminQuoteSelectionBlockReason({ ...allowed, enrichStatus: 'searching' })).toBe('quote-busy');
  });

  it('회신 이후 상태와 주문·발주·RFQ 연결을 각각 차단한다', () => {
    expect(adminQuoteSelectionBlockReason({ ...allowed, status: 'answered' })).toBe('invalid-status');
    expect(adminQuoteSelectionBlockReason({ ...allowed, ctId: 123 })).toBe('order-started');
    expect(adminQuoteSelectionBlockReason({ ...allowed, poCount: 1 })).toBe('po-issued');
    expect(adminQuoteSelectionBlockReason({ ...allowed, rfqTargetsItem: true })).toBe('rfq-sent');
  });

  it('관리자 강제 변경은 업무 상태를 우회하되 오래된 화면과 진행 중 계산은 우회하지 않는다', () => {
    const forced = {
      ...allowed,
      force: true,
      status: 'closed',
      ctId: 123,
      poCount: 1,
      rfqTargetsItem: true,
    };
    expect(adminQuoteSelectionBlockReason(forced)).toBeNull();
    expect(adminQuoteSelectionBlockReason({ ...forced, buildStatus: 'building' })).toBe('quote-busy');
    expect(adminQuoteSelectionBlockReason({
      ...forced,
      expectedQuoteUpdatedAt: '2026-08-02T09:59:59.000Z',
    })).toBe('stale-quote');
  });

  it('전체 RFQ는 포함 행만, 부분 RFQ는 저장된 행 ID만 대상으로 판정한다', () => {
    expect(rfqRequestsQuoteItem(null, '10', true)).toBe(true);
    expect(rfqRequestsQuoteItem(null, '10', false)).toBe(false);
    expect(rfqRequestsQuoteItem(['10', '12'], '10', false)).toBe(true);
    expect(rfqRequestsQuoteItem(['11', '12'], '10', true)).toBe(false);
  });

  it('교체 계약은 force를 기본 false로 두고 클라이언트 계산값을 받지 않는다', () => {
    const parsed = AdminBomQuoteItemSelectionBody.parse({
      kind: 'candidate',
      candidateKey: 'candidate-1',
      offerKey: null,
      expectedQuoteUpdatedAt: allowed.expectedQuoteUpdatedAt,
    });
    expect(parsed.force).toBe(false);
    expect(AdminBomQuoteItemSelectionBody.safeParse({
      kind: 'catalog',
      partId: '123',
      offer: null,
      expectedQuoteUpdatedAt: allowed.expectedQuoteUpdatedAt,
      force: true,
      lineTotalKrw: 1,
    }).success).toBe(false);
  });
});

describe('견적 자동 보강 필요 판정', () => {
  const base = {
    included: false,
    matchStatus: 'none',
    matchEvidence: null,
    sourceRow: null,
    selectedOffer: null,
  };

  it('수량 미입력 행도 기술 후보가 없으면 최초 보강 대상으로 삼는다', () => {
    expect(quoteNeedsEnrichment([{
      ...base,
      sourceRow: {
        procurementDisposition: 'quantity_confirmation_required',
        quantityConfirmed: false,
      },
    }], 24)).toBe(true);
  });

  it('기술 후보가 이미 선정된 수량 미입력 행은 다시 보강하지 않는다', () => {
    expect(quoteNeedsEnrichment([{
      ...base,
      matchStatus: 'auto',
      matchEvidence: {},
      sourceRow: {
        procurementDisposition: 'quantity_confirmation_required',
        quantityConfirmed: false,
      },
    }], 24)).toBe(false);
  });

  it('일반 제외 행은 미매칭이어도 보강하지 않는다', () => {
    expect(quoteNeedsEnrichment([base], 24)).toBe(false);
  });

  it('수량 확인 후 포함된 미매칭 행은 보강한다', () => {
    expect(quoteNeedsEnrichment([{
      ...base,
      included: true,
      sourceRow: {
        procurementDisposition: 'quantity_confirmation_required',
        quantityConfirmed: true,
      },
    }], 24)).toBe(true);
  });
});

describe('부품 유형별 로컬 카탈로그 검색 과정', () => {
  it('SamplePCB v1 실행 기록을 현재 API 계약으로 호환 투영한다', () => {
    expect(quoteLocalCatalogTrace({
      local_catalog: {
        version: 'samplepcb-local-catalog-trace-v1',
        evaluated_components: 1,
        resolved_components: 1,
        external_components: 0,
        components: [
          {
            component_id: 'resistor-1',
            query: '10k 0603 1% resistor',
            outcome: 'selected',
            candidate_count: 3,
            evaluated_candidate_count: 3,
            selected_candidate_count: 1,
            api_calls: 0,
            elapsed_ms: 18,
            reason: null,
          },
        ],
      },
    }, 'resistor-1')).toEqual({
      version: 'local-catalog-trace-v3',
      catalogType: 'samplepcb_rc',
      query: '10k 0603 1% resistor',
      outcome: 'selected',
      candidateCount: 3,
      evaluatedCandidateCount: 3,
      selectedCandidateCount: 1,
      apiCalls: 0,
      elapsedMs: 18,
      reason: null,
      decisionSummary: null,
    });
  });

  it('connector 실행 기록의 카탈로그 유형을 그대로 투영한다', () => {
    expect(quoteLocalCatalogTrace({
      local_catalog: {
        version: 'local-catalog-trace-v2',
        components: [
          {
            component_id: 'connector-1',
            catalog_type: 'connector',
            query: 'YEONHO ELECTRONICS 10038WR-08',
            outcome: 'selected',
            candidate_count: 1,
            evaluated_candidate_count: 1,
            selected_candidate_count: 1,
            api_calls: 0,
            elapsed_ms: 7,
            reason: null,
          },
        ],
      },
    }, 'connector-1')).toEqual({
      version: 'local-catalog-trace-v3',
      catalogType: 'connector',
      query: 'YEONHO ELECTRONICS 10038WR-08',
      outcome: 'selected',
      candidateCount: 1,
      evaluatedCandidateCount: 1,
      selectedCandidateCount: 1,
      apiCalls: 0,
      elapsedMs: 7,
      reason: null,
      decisionSummary: null,
    });
  });

  it('인제스트 R/C 실험 실행 기록을 외부 추가 검색용 유형으로 투영한다', () => {
    expect(quoteLocalCatalogTrace({
      local_catalog: {
        version: 'local-catalog-trace-v3',
        components: [
          {
            component_id: 'resistor-ingested',
            catalog_type: 'ingested_rc',
            query: '10k 0603 resistor',
            outcome: 'selected',
            candidate_count: 4,
            evaluated_candidate_count: 4,
            selected_candidate_count: 1,
            api_calls: 0,
            elapsed_ms: 9,
            reason: 'minimum_requirements_matched',
          },
        ],
      },
    }, 'resistor-ingested')).toEqual({
      version: 'local-catalog-trace-v3',
      catalogType: 'ingested_rc',
      query: '10k 0603 resistor',
      outcome: 'selected',
      candidateCount: 4,
      evaluatedCandidateCount: 4,
      selectedCandidateCount: 1,
      apiCalls: 0,
      elapsedMs: 9,
      reason: 'minimum_requirements_matched',
      decisionSummary: null,
    });
  });

  it('v3 실행 기록의 자동선정 탈락 사유와 대표 후보를 표시 계약으로 투영한다', () => {
    expect(quoteLocalCatalogTrace({
      local_catalog: {
        version: 'local-catalog-trace-v3',
        components: [
          {
            component_id: 'resistor-1',
            catalog_type: 'samplepcb_rc',
            query: '10k 0402 resistor',
            outcome: 'rejected',
            candidate_count: 10,
            evaluated_candidate_count: 10,
            selected_candidate_count: 0,
            api_calls: 0,
            elapsed_ms: 597,
            reason: 'engine_not_selected',
            decision_summary: {
              component_status: 'spec_partial',
              procurement_status: 'review_recommended',
              selection_application_state: 'provisional_selected',
              primary_unavailability_reason: 'technical_unavailable',
              recommendation_reason_codes: ['manual_review_required'],
              automatic_candidate_count: 0,
              review_candidate_count: 10,
              blocked_candidate_count: 0,
              unclassified_candidate_count: 0,
              reason_counts: [
                {
                  kind: 'missing_requirement',
                  code: 'part_type',
                  count: 10,
                },
              ],
              representative_candidate: {
                mpn: 'WR04X1002FTL',
                manufacturer_name: 'Walsin',
                status: 'spec_partial',
                selection_eligibility: 'manual_review',
                verified_requirement_count: 3,
                required_requirement_count: 4,
                conflicts: [],
                missing_requirements: ['part_type'],
                reason_codes: ['verification_incomplete'],
                requirement_assessments: [
                  {
                    key: 'part_type',
                    comparison: 'category',
                    state: 'missing',
                    verified: false,
                    expected_display: '저항',
                    actual_display: null,
                    source: 'bom',
                  },
                ],
              },
            },
          },
        ],
      },
    }, 'resistor-1')).toEqual({
      version: 'local-catalog-trace-v3',
      catalogType: 'samplepcb_rc',
      query: '10k 0402 resistor',
      outcome: 'rejected',
      candidateCount: 10,
      evaluatedCandidateCount: 10,
      selectedCandidateCount: 0,
      apiCalls: 0,
      elapsedMs: 597,
      reason: 'engine_not_selected',
      decisionSummary: {
        componentStatus: 'spec_partial',
        procurementStatus: 'review_recommended',
        selectionApplicationState: 'provisional_selected',
        primaryUnavailabilityReason: 'technical_unavailable',
        recommendationReasonCodes: ['manual_review_required'],
        automaticCandidateCount: 0,
        reviewCandidateCount: 10,
        blockedCandidateCount: 0,
        unclassifiedCandidateCount: 0,
        reasonCounts: [
          { kind: 'missing_requirement', code: 'part_type', count: 10 },
        ],
        representativeCandidate: {
          mpn: 'WR04X1002FTL',
          manufacturerName: 'Walsin',
          status: 'spec_partial',
          selectionEligibility: 'manual_review',
          verifiedRequirementCount: 3,
          requiredRequirementCount: 4,
          conflicts: [],
          missingRequirements: ['part_type'],
          reasonCodes: ['verification_incomplete'],
          requirementAssessments: [
            {
              key: 'part_type',
              comparison: 'category',
              state: 'missing',
              verified: false,
              expectedDisplay: '저항',
              actualDisplay: null,
              source: 'bom',
            },
          ],
        },
      },
    });
  });

  it('구형 실행 또는 다른 부품의 로컬 기록은 null로 읽는다', () => {
    expect(quoteLocalCatalogTrace({}, 'resistor-1')).toBeNull();
    expect(quoteLocalCatalogTrace({
      local_catalog: {
        version: 'samplepcb-local-catalog-trace-v1',
        components: [],
      },
    }, 'resistor-1')).toBeNull();
  });
});

describe('행별 로컬 카탈로그 실행 이력', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ingestedPreflight = {
    local_catalog: {
      version: 'local-catalog-trace-v3',
      components: [{
        component_id: 'resistor-ingested',
        catalog_type: 'ingested_rc',
        query: '10k 0603 resistor',
        outcome: 'selected',
        candidate_count: 2,
        evaluated_candidate_count: 2,
        selected_candidate_count: 1,
        api_calls: 0,
        elapsed_ms: 5,
        reason: 'minimum_requirements_matched',
      }],
    },
  };

  it('자체 선정 후 외부 대상 목록에서 제거된 행도 저장된 trace를 노출한다', async () => {
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findMany').mockResolvedValue([
      {
        status: 'completed',
        options: { component_ids: ['external-component'] },
        preflight: ingestedPreflight,
      },
    ] as never);

    await expect(loadLatestQuoteLocalCatalogTrace(
      1n,
      'resistor-ingested',
    )).resolves.toMatchObject({
      catalogType: 'ingested_rc',
      outcome: 'selected',
      reason: 'minimum_requirements_matched',
    });
  });

  it('다른 행의 최신 재검색은 건너뛰고 이 행의 실험 trace를 유지한다', async () => {
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findMany').mockResolvedValue([
      {
        options: { component_ids: ['other-component'] },
        preflight: {},
      },
      {
        options: { component_ids: [] },
        preflight: ingestedPreflight,
      },
    ] as never);

    const trace = await loadLatestQuoteLocalCatalogTrace(
      1n,
      'resistor-ingested',
    );

    expect(trace).toMatchObject({
      catalogType: 'ingested_rc',
      outcome: 'selected',
      reason: 'minimum_requirements_matched',
    });
  });

  it('이 행의 명시적 외부 검색 실행은 과거 실험 trace를 가린다', async () => {
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findMany').mockResolvedValue([
      {
        options: {
          component_ids: ['resistor-ingested'],
          local_catalog_bypass: true,
        },
        preflight: {},
      },
      {
        options: { component_ids: [] },
        preflight: ingestedPreflight,
      },
    ] as never);

    await expect(loadLatestQuoteLocalCatalogTrace(
      1n,
      'resistor-ingested',
    )).resolves.toBeNull();
  });

  it('실패한 외부 검색은 과거 실험 trace를 가리지 않아 재시도할 수 있다', async () => {
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findMany').mockResolvedValue([
      {
        status: 'failed',
        options: {
          component_ids: ['resistor-ingested'],
          local_catalog_bypass: true,
        },
        preflight: {},
      },
      {
        status: 'completed',
        options: { component_ids: [] },
        preflight: ingestedPreflight,
      },
    ] as never);

    await expect(loadLatestQuoteLocalCatalogTrace(
      1n,
      'resistor-ingested',
    )).resolves.toMatchObject({
      catalogType: 'ingested_rc',
      outcome: 'selected',
    });
  });

  it('다른 행의 외부 실패가 섞여도 이미 적용된 실험 선정을 유지한다', async () => {
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findMany').mockResolvedValue([
      {
        status: 'failed',
        options: { component_ids: [] },
        preflight: ingestedPreflight,
      },
    ] as never);

    await expect(loadLatestQuoteLocalCatalogTrace(
      1n,
      'resistor-ingested',
    )).resolves.toMatchObject({
      catalogType: 'ingested_rc',
      outcome: 'selected',
    });
  });
});

describe('사용자 행 검색조건 계약', () => {
  it('저항 핵심값과 패키지를 받고 TCR은 계약에서 제외한다', () => {
    expect(BomQuoteSearchRequirementsBody.safeParse({
      componentType: 'resistor',
      resistance: '10kΩ',
      packageCode: '0603',
      tolerance: '1%',
      power: null,
      mountStyle: 'smd',
    }).success).toBe(true);
    expect(BomQuoteSearchRequirementsBody.safeParse({
      componentType: 'resistor',
      resistance: '10kΩ',
      packageCode: '0603',
      tolerance: '1%',
      power: null,
      mountStyle: 'smd',
      tcr: '100ppm/°C',
    }).success).toBe(false);
  });

  it('전송 계약은 유전체 기술 조합을 재판정하지 않는다', () => {
    expect(BomQuoteSearchRequirementsBody.safeParse({
      componentType: 'capacitor',
      capacitorType: 'electrolytic',
      capacitance: '100uF',
      packageCode: '8x10.2mm',
      tolerance: '20%',
      voltage: '25V',
      dielectric: 'X7R',
      mountStyle: 'smd',
    }).success).toBe(true);
  });

  it('저장 계약은 검색조건과 수정 provenance를 함께 수신한다', () => {
    expect(BomQuoteSearchRequirements.safeParse({
      version: 'bom-user-search-requirements-v1',
      componentType: 'resistor',
      resistance: '10kΩ',
      packageCode: '0603',
      tolerance: '1%',
      power: null,
      mountStyle: 'smd',
      updatedAt: '2026-07-24T00:00:00.000Z',
      updatedBy: 'member-1',
    }).success).toBe(true);
  });

  it.each([
    {
      componentType: 'inductor',
      inductorType: 'standard',
      inductance: '10uH',
      impedance: null,
      impedanceFrequency: null,
      current: null,
      packageCode: '0603',
      tolerance: null,
      mountStyle: 'smd',
    },
    {
      componentType: 'diode',
      diodeType: 'rectifier',
      voltage: null,
      current: null,
      power: null,
      packageCode: 'SOD-123',
      mountStyle: 'smd',
    },
    {
      componentType: 'transistor',
      transistorType: 'mosfet',
      polarity: 'n-channel',
      voltage: null,
      current: null,
      power: null,
      packageCode: 'SOT-23',
      mountStyle: 'smd',
    },
    {
      componentType: 'led',
      color: 'red',
      voltage: null,
      current: null,
      packageCode: '0603',
      mountStyle: 'smd',
    },
    {
      componentType: 'crystal',
      crystalType: 'crystal',
      frequency: '16MHz',
      packageCode: '3225',
      tolerance: null,
      mountStyle: 'smd',
    },
    {
      componentType: 'connector',
      pinCount: 4,
      pitch: '2.54mm',
      rowCount: 2,
      gender: null,
      orientation: 'straight',
      packageCode: null,
      mountStyle: 'through-hole',
    },
    {
      componentType: 'switch',
      switchType: 'tactile',
      contactForm: null,
      voltage: null,
      current: null,
      packageCode: '6x6mm',
      mountStyle: 'smd',
    },
  ])('$componentType 최소 검색조건을 수신한다', (body) => {
    expect(BomQuoteSearchRequirementsBody.safeParse(body).success).toBe(true);
  });

  it('조건부 안전 최소값은 엔진에 맡기고 v1 저장 범위만 계약에서 검증한다', () => {
    expect(BomQuoteSearchRequirementsBody.safeParse({
      componentType: 'diode',
      diodeType: 'zener',
      voltage: null,
      current: null,
      power: null,
      packageCode: 'SOD-123',
      mountStyle: 'smd',
    }).success).toBe(true);
    expect(BomQuoteSearchRequirements.safeParse({
      version: 'bom-user-search-requirements-v1',
      componentType: 'led',
      color: 'red',
      voltage: null,
      current: null,
      packageCode: '0603',
      mountStyle: 'smd',
      updatedAt: '2026-07-25T00:00:00.000Z',
      updatedBy: 'member-1',
    }).success).toBe(false);
  });
});

describe('후보 화면 부품 정보 준비 상태', () => {
  it('DB 처리가 끝나도 검색 색인 대기 항목이 있으면 완료로 보지 않는다', () => {
    expect(catalogIngestRunReady({ status: 'completed', stats: { queued: 1 } })).toBe(false);
    expect(catalogIngestRunReady({ status: 'completed', stats: { queued: 0 } })).toBe(true);
  });

  it('실패하거나 진행 중인 실행은 완료로 보지 않는다', () => {
    expect(catalogIngestRunReady({ status: 'failed', stats: { queued: 0 } })).toBe(false);
    expect(catalogIngestRunReady({ status: 'running', stats: null })).toBe(false);
  });

  it('저장 ready를 가장 먼저 신뢰한다', () => {
    expect(resolvePartDataStatus({
      storedStatus: 'ready',
      runReady: false,
      candidatesSearchable: false,
    })).toBe('ready');
  });

  it('전역 실행 ready가 저장 failed보다 우선한다', () => {
    expect(resolvePartDataStatus({
      storedStatus: 'failed',
      runReady: true,
      candidatesSearchable: false,
    })).toBe('ready');
  });

  it('후보 전부 검색 가능하면 저장 failed보다 ready가 우선한다', () => {
    expect(resolvePartDataStatus({
      storedStatus: 'failed',
      runReady: false,
      candidatesSearchable: true,
    })).toBe('ready');
  });

  it('ready 근거가 없을 때만 저장 failed를 반환한다', () => {
    expect(resolvePartDataStatus({
      storedStatus: 'failed',
      runReady: false,
      candidatesSearchable: false,
    })).toBe('failed');
  });

  it('확정 근거가 없으면 preparing을 유지한다', () => {
    expect(resolvePartDataStatus({
      storedStatus: 'preparing',
      runReady: false,
      candidatesSearchable: null,
    })).toBe('preparing');
  });
});

describe('견적 후보 부품 검색 가능성', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('후보가 0건이면 기존 전역 판정만 쓰도록 null을 반환한다', async () => {
    vi.spyOn(prisma.spBomQuoteCandidate, 'findMany').mockResolvedValue([] as never);
    const partFindMany = vi.spyOn(prisma.spPart, 'findMany').mockResolvedValue([] as never);

    await expect(quoteCandidatePartsSearchable(42n)).resolves.toBeNull();
    expect(partFindMany).not.toHaveBeenCalled();
  });

  it('후보 중 하나라도 미색인이면 false를 반환한다', async () => {
    vi.spyOn(prisma.spBomQuoteCandidate, 'findMany').mockResolvedValue([
      { mpn: 'RC0402FR-0710KL', manufacturerName: 'Yageo' },
      { mpn: 'GRM155R71C104KA88D', manufacturerName: 'Murata' },
    ] as never);
    vi.spyOn(prisma.spPart, 'findMany').mockResolvedValue([
      {
        id: 1n,
        mpnNorm: 'RC0402FR0710KL',
        manufacturerNorm: 'yageo',
        indexedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
      {
        id: 2n,
        mpnNorm: 'GRM155R71C104KA88D',
        manufacturerNorm: 'murata',
        indexedAt: null,
      },
    ] as never);

    await expect(quoteCandidatePartsSearchable(42n)).resolves.toBe(false);
  });

  it('제조사가 확인된 후보는 같은 MPN의 다른 제조사 부품으로 교차 해소하지 않는다', async () => {
    vi.spyOn(prisma.spBomQuoteCandidate, 'findMany').mockResolvedValue([
      { mpn: '1N4148', manufacturerName: 'onsemi' },
    ] as never);
    vi.spyOn(prisma.spPart, 'findMany').mockResolvedValue([
      {
        id: 3n,
        mpnNorm: '1N4148',
        manufacturerNorm: 'vishay',
        indexedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    ] as never);

    await expect(quoteCandidatePartsSearchable(42n)).resolves.toBe(false);
  });

  it('제조사 미상 후보는 MPN 단독 최신 부품으로 fallback한다', async () => {
    vi.spyOn(prisma.spBomQuoteCandidate, 'findMany').mockResolvedValue([
      { mpn: '1N4148', manufacturerName: null },
    ] as never);
    vi.spyOn(prisma.spPart, 'findMany').mockResolvedValue([
      {
        id: 4n,
        mpnNorm: '1N4148',
        manufacturerNorm: 'vishay',
        indexedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    ] as never);

    await expect(quoteCandidatePartsSearchable(42n)).resolves.toBe(true);
  });

  it('failed여도 후보 전부 색인 시 ready를 스탬프하고 다음 폴부터 후보 조회를 생략한다', async () => {
    const summary = {
      catalogStatus: 'failed',
      catalogError: 'SEARCH_INDEX_UNAVAILABLE',
      catalogRetryAt: '2026-07-23T01:00:00.000Z',
      budgetExhaustedCount: 0,
      budgetExhaustedDetectionVersion: 2,
    };
    vi.spyOn(prisma.spBomSupplierSearchRun, 'findUnique')
      .mockResolvedValueOnce({
        quoteId: 42n,
        resultSummary: summary,
        catalogIngestRun: { status: 'failed', stats: { queued: 1 } },
      } as never)
      .mockResolvedValueOnce({
        quoteId: 42n,
        resultSummary: { ...summary, catalogStatus: 'ready', catalogScope: 'candidates' },
        catalogIngestRun: { status: 'failed', stats: { queued: 1 } },
      } as never);
    const candidateFindMany = vi.spyOn(prisma.spBomQuoteCandidate, 'findMany').mockResolvedValue([
      { mpn: 'RC0402FR-0710KL', manufacturerName: 'Yageo' },
    ] as never);
    vi.spyOn(prisma.spPart, 'findMany').mockResolvedValue([
      {
        id: 1n,
        mpnNorm: 'RC0402FR0710KL',
        manufacturerNorm: 'yageo',
        indexedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    ] as never);
    const itemFindMany = vi.spyOn(prisma.spBomQuoteItem, 'findMany').mockResolvedValue([] as never);
    const runUpdateMany = vi.spyOn(prisma.spBomSupplierSearchRun, 'updateMany').mockResolvedValue({ count: 1 });

    await expect(loadSupplierSearchSummary(9n, 'done')).resolves.toMatchObject({
      partDataStatus: 'ready',
      partDataFailureReason: null,
    });
    const stampCall = runUpdateMany.mock.calls[0]?.[0];
    expect(stampCall?.where).toEqual({ id: 9n, quoteId: 42n });
    const stampedSummary = stampCall?.data.resultSummary;
    if (typeof stampedSummary !== 'object' || Array.isArray(stampedSummary)) {
      throw new Error('candidate catalog ready summary was not stamped');
    }
    const stampedRecord = stampedSummary as Record<string, unknown>;
    expect(stampedRecord.catalogStatus).toBe('ready');
    expect(typeof stampedRecord.catalogReadyAt).toBe('string');
    expect(stampedRecord.catalogScope).toBe('candidates');
    expect(stampedRecord.catalogError).toBeNull();
    expect(stampedRecord.catalogRetryAt).toBeNull();
    await expect(loadSupplierSearchSummary(9n, 'done')).resolves.toMatchObject({ partDataStatus: 'ready' });
    expect(candidateFindMany).toHaveBeenCalledOnce();
    expect(itemFindMany).toHaveBeenCalledOnce();
    expect(runUpdateMany).toHaveBeenCalledOnce();
  });
});

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

  it('원본 수량 누락 행은 보존하되 확인 전 견적 포함에서는 제외한다', () => {
    const items = buildItemsFromEngineResult({
      source_file: 'catalog.xlsx',
      components: [{
        sheet_index_0based: 0,
        sheet_name: 'R_1005',
        source_rows_1based: [2],
        part_number: 'WR04X1001FTL',
        quantity: null,
        procurement_disposition: 'quantity_confirmation_required',
        quantity_resolution: 'missing',
      }],
    }, [0]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      included: false,
      bomQty: 1,
      mpn: 'WR04X1001FTL',
      sourceRow: {
        procurementDisposition: 'quantity_confirmation_required',
        quantityResolution: 'missing',
        quantityConfirmed: false,
      },
    });
  });
});

interface CandidateOptions {
  currentDecisionContract?: boolean;
  decisionPolicyVersion?:
    | 'supplier-candidate-decision-v1'
    | 'supplier-candidate-decision-v2'
    | 'supplier-candidate-decision-v3';
  categoryPolicyVersion?: 'candidate-category-policy-v1' | 'candidate-category-policy-v2';
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
  lifecycleCode?: 'active' | 'nrnd' | 'eol' | 'discontinued' | 'obsolete' | 'inactive' | 'unknown';
  lifecycleStatus?: string;
  lastBuyDate?: string;
  replacementSource?: 'digikey_substitution' | 'mouser_suggested';
  replacementForMpn?: string;
  replacementType?: string;
  manufacturer?: string | null;
  conflicts?: string[];
  missingRequirements?: string[];
  reasons?: string[];
  reasonCodes?: string[];
  requiredCount?: number;
  verifiedCount?: number;
  requirementAssessments?: {
    key: string;
    comparison: 'eq' | 'gte' | 'lte' | 'contains' | 'category';
    state: 'match' | 'mismatch' | 'missing' | 'not_applicable' | 'unverified';
    verified: boolean;
    source?: 'bom' | 'user' | 'policy_default' | 'unknown';
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
        decision_policy_version: options.decisionPolicyVersion ?? 'supplier-candidate-decision-v1',
        category_policy_version: options.categoryPolicyVersion ?? 'candidate-category-policy-v1',
        identity_key_version: 'candidate-identity-key-v1',
        evidence_key_version: 'candidate-evidence-key-v1',
        match_relation: selectionMode === 'review' ? 'unresolved' : selectionMode,
        selection_eligibility: eligibility,
        auto_eligible: eligibility === 'automatic',
        manual_selectable: eligibility !== 'blocked',
        reason_codes: options.reasonCodes
          ?? (eligibility === 'manual_review' ? ['manufacturer_confirmation_required'] : []),
        identity_key: identityKey,
        technical_evidence_key: technicalEvidenceKey,
        verified_requirement_count: verifiedCount,
        required_requirement_count: requiredCount,
        requirement_assessments: options.requirementAssessments ?? [],
        verification_complete: options.verificationComplete ?? verifiedCount === requiredCount,
        strict_category_coverage: options.strictCategoryCoverage ?? false,
        lifecycle_state: options.lifecycleState ?? 'unknown',
        lifecycle_code: options.lifecycleCode ?? 'unknown',
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
        reason_codes: options.reasonCodes
          ?? (eligibility === 'manual_review' ? ['manufacturer_confirmation_required'] : []),
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
      last_buy_date: options.lastBuyDate,
      replacement_source: options.replacementSource,
      replacement_for_mpn: options.replacementForMpn,
      replacement_type: options.replacementType,
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
  purchaseFitRank = recommendation === 'none' ? 2 : 1,
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
      purchase_fit_rank: purchaseFitRank,
      purchasable: true,
      recommendation,
      reason_codes: ['fixture'],
    },
  });
}

function componentProcurementDecision(
  status:
    | 'automatic_recommended'
    | 'review_recommended'
    | 'catalog_selected'
    | 'no_recommendation'
    | 'input_incomplete',
  offerKey: string | null,
  requiredQuantity = 10,
  options: {
    applicationIdentityKey?: string;
    applicationEvidenceKey?: string;
    technicalFallbackUsed?: boolean;
    priceOptimizationUsed?: boolean;
    includeUnavailabilityContract?: boolean;
    unavailabilityReason?:
      | 'out_of_stock'
      | 'insufficient_stock'
      | 'stock_unverified'
      | 'catalog_inquiry'
      | 'price_unavailable'
      | 'technical_unavailable'
      | 'supplier_unavailable'
      | 'no_offer'
      | 'input_incomplete'
      | 'other'
      | null;
  } = {},
) {
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    selection_application_policy_version: 'supplier-selection-application-v3',
    status,
    selection_application_state:
      status === 'automatic_recommended' || status === 'catalog_selected'
      ? 'automatic_selected'
      : status === 'review_recommended'
        ? 'provisional_selected'
        : 'not_selected',
    confirmation_required: status === 'review_recommended',
    ...(options.includeUnavailabilityContract === false
      ? {}
      : {
          unavailability_reason_policy_version: 'supplier-procurement-unavailability-v1',
          primary_unavailability_reason: options.unavailabilityReason === undefined
            ? status === 'input_incomplete'
              ? 'input_incomplete'
              : status === 'no_recommendation' ? 'no_offer' : null
            : options.unavailabilityReason,
        }),
    required_quantity: requiredQuantity,
    target_currency: 'KRW',
    currency_rate_snapshot_id: 'fixture-snapshot',
    currency_rate_as_of: '2026-07-21T00:00:00+09:00',
    currency_rate_source: 'pytest',
    technical_preselection_identity_key: 'ik1:engine-choice',
    technical_preselection_evidence_key: 'ek1:engine-choice',
    application_candidate_identity_key:
      status === 'no_recommendation' || status === 'input_incomplete'
        ? null
        : options.applicationIdentityKey ?? 'ik1:engine-choice',
    application_candidate_evidence_key:
      status === 'no_recommendation' || status === 'input_incomplete'
        ? null
        : options.applicationEvidenceKey ?? 'ek1:engine-choice',
    technical_fallback_used: options.technicalFallbackUsed ?? false,
    price_optimization_used: options.priceOptimizationUsed ?? false,
    automatic_offer_key: status === 'automatic_recommended' ? offerKey : null,
    review_offer_key: status === 'review_recommended' ? offerKey : null,
    recommendation_reason_codes: ['fixture'],
  };
}

describe('BOM 엔진 후보 결정 투영', () => {
  it('수량 누락이어도 엔진의 안전 기술 1순위를 견적 제외 상태로 선정한다', () => {
    const technical = candidate('spec_compatible', 'WR04X1001FTL', 'samplepcb', 1, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      selectionRecommendation: 'preselect',
      verificationComplete: true,
      strictCategoryCoverage: true,
    });
    attachProcurementDecision(technical, 'ok2:deferred', 'none', 10, 'supplier-offer-key-v2');

    const decision = selectEngineMatch({
      component_id: 'quantity-missing',
      status: 'input_incomplete',
      procurement_disposition: 'quantity_confirmation_required',
      quantity_resolution: 'missing',
      disposition_reason_codes: ['quantity_missing'],
      procurement_decision: {
        ...componentProcurementDecision('input_incomplete', null, 10),
        required_quantity: null,
      },
      candidates: [technical],
    }, 10, null);

    expect(decision).toMatchObject({
      candidateKey: 'ik1:engine-choice',
      recommendedCandidateKey: 'ik1:engine-choice',
      offerKey: null,
      pick: null,
      evidence: {
        selectionApplicationState: 'not_selected',
        procurementUnavailabilityReason: 'input_incomplete',
        selectedCandidateKey: 'ik1:engine-choice',
        decisionReasonCodes: ['quantity-confirmation-required'],
      },
    });
  });

  it('단일 공급사 검색 결과를 카탈로그 저장 전 화면 후보로 투영한다', () => {
    const selected = candidate('verified_exact', 'LIVE-MPN-1', 'digikey', 12, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      selectionRecommendation: 'preselect',
    });
    attachProcurementDecision(selected, 'ok2:live-offer', 'automatic', 10, 'supplier-offer-key-v2');

    const result = projectEnginePartSearchResult({
      procurement_decision_contract_status: 'current',
      search: {
        api_calls: 1,
        cache_hits: 2,
        components: [{
          component_id: 'catalog-live',
          status: 'verified_exact',
          warnings: ['cached-result'],
          procurement_decision: componentProcurementDecision(
            'automatic_recommended',
            'ok2:live-offer',
          ),
          candidates: [selected],
        }],
      },
    }, 10);

    expect(result).not.toBeNull();
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]).toMatchObject({
      id: 'ik1:engine-choice',
      mpn: 'LIVE-MPN-1',
      source: 'supplier',
      offerCount: 1,
      applied: {
        supplier: 'digikey',
        orderQty: 10,
        unitPrice: 12,
        unitPriceKrw: 12,
        lineTotalKrw: 120,
      },
    });
    expect(result?.items[0]?.inlineOffers).toHaveLength(1);
    expect(result?.items[0]).toMatchObject({
      hasCatalogInquiryOffer: false,
      inlineOffers: [{ offerKind: 'supplier_offer' }],
    });
    expect(result).toMatchObject({ apiCalls: 1, cacheHits: 2, warnings: ['cached-result'] });
  });

  it('제조사 카탈로그 정확 후보는 가격·재고 없이 부품과 partId만 선정한다', async () => {
    const selected = candidate('verified_exact', '10038WR-08', 'yeonho', 1, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      selectionRecommendation: 'preselect',
    });
    const offer = selected.product.offers[0];
    if (offer === undefined) throw new Error('test offer missing');
    Object.assign(offer, {
      offer_kind: 'manufacturer_catalog',
      stock: null,
      moq: null,
      order_multiple: null,
      price_breaks: [],
      procurement_decision: {
        procurement_policy_version: 'supplier-procurement-decision-v1',
        offer_key_version: 'supplier-offer-key-v2',
        rank_scope: 'identity_and_technical_evidence',
        offer_key: 'ok2:catalog-offer',
        calculation_status: 'supplier_not_allowed',
        required_quantity: 10,
        order_quantity: 10,
        applied_price_break_quantity: null,
        source_unit_price: null,
        source_currency: null,
        exchange_rate: null,
        target_currency: 'KRW',
        converted_unit_price: null,
        line_total: null,
        stock_short: null,
        stock_short_quantity: null,
        surplus_quantity: 0,
        excessive_order: false,
        price_rank: null,
        purchase_fit_rank: null,
        purchasable: false,
        recommendation: 'none',
        reason_codes: [
          'manufacturer_catalog_offer',
          'stock_confirmation_required',
          'price_inquiry_required',
        ],
      },
    });

    const component = {
      component_id: 'catalog-inquiry',
      status: 'verified_exact',
      warnings: [],
      procurement_decision: componentProcurementDecision(
        'catalog_selected',
        null,
        10,
        { unavailabilityReason: 'catalog_inquiry' },
      ),
      candidates: [selected],
    };
    const result = projectEnginePartSearchResult({
      procurement_decision_contract_status: 'current',
      search: {
        api_calls: 0,
        cache_hits: 0,
        components: [component],
      },
    }, 10);

    expect(result?.items[0]).toMatchObject({
      hasCatalogInquiryOffer: true,
      minPrice: null,
      totalStock: 0,
      applied: null,
      inlineOffers: [{
        offerKind: 'manufacturer_catalog',
        stock: null,
        priceBreaks: [],
      }],
    });

    const decision = selectEngineMatch(component, 10, null);
    expect(decision).toMatchObject({
      candidateKey: 'ik1:engine-choice',
      recommendedCandidateKey: 'ik1:engine-choice',
      offerKey: null,
      pick: null,
      evidence: {
        selectionApplicationState: 'automatic_selected',
        confirmationRequired: false,
        procurementUnavailabilityReason: 'catalog_inquiry',
        selectedCandidateKey: 'ik1:engine-choice',
        decisionReasonCodes: ['engine-catalog-selection'],
        priceEvidence: null,
      },
    });

    const items = buildItemsFromEngineResult(ENGINE_RESULT, [1]);
    const item = items[0];
    const componentId = item?.sourceRow?.componentId;
    if (item === undefined || typeof componentId !== 'string') {
      throw new Error('테스트 견적 행의 componentId가 없습니다');
    }
    const partFindUnique = vi.spyOn(prisma.spPart, 'findUnique').mockResolvedValue({
      id: 42n,
    } as never);
    try {
      const applied = await applyEngineSupplierResult(
        items,
        {
          supplier_search_schema_version: '1.7',
          procurement_decision_contract_status: 'current',
          search: {
            search_schema_version: '1.7',
            components: [{ ...component, component_id: componentId }],
          },
        },
        10,
        0,
        null,
      );

      expect(applied.applied).toBe(true);
      expect(item).toMatchObject({
        mpn: '10038WR-08',
        matchStatus: 'auto',
        selectionSource: 'auto',
        partId: '42',
        selectedCandidateKey: 'ik1:engine-choice',
        recommendedCandidateKey: 'ik1:engine-choice',
        selectedOffer: null,
        orderQty: 10,
        matchEvidence: {
          selectionApplicationState: 'automatic_selected',
          procurementUnavailabilityReason: 'catalog_inquiry',
          decisionReasonCodes: ['engine-catalog-selection'],
        },
      });
    } finally {
      partFindUnique.mockRestore();
    }

    const forgedSupplierCandidate = {
      ...structuredClone(selected),
      product: {
        ...structuredClone(selected.product),
        offers: selected.product.offers.map((offer) => ({
          ...structuredClone(offer),
          offer_kind: 'supplier_offer' as const,
        })),
      },
    };
    const rejected = selectEngineMatch(
      { ...component, candidates: [forgedSupplierCandidate] },
      10,
      null,
    );
    expect(rejected).toMatchObject({
      candidate: null,
      candidateKey: null,
      pick: null,
      evidence: {
        selectionApplicationState: 'not_selected',
        decisionReasonCodes: ['no-safe-candidate'],
      },
    });
  });

  it('행당 상위 10개만 영속하되 뒤 순위의 현재·추천 후보는 보존한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-persistence-limit',
        status: 'spec_compatible',
        candidates: Array.from({ length: 20 }, (_, index) => candidate(
          'spec_compatible',
          `CANDIDATE-${String(index + 1).padStart(2, '0')}`,
          'digikey',
          index + 1,
          1,
        )),
      },
      10,
      null,
    );
    expect(decision).not.toBeNull();
    if (decision === null) return;
    const retained = retainQuoteCandidateSnapshots(decision.snapshots, [
      decision.snapshots[18]?.candidateKey,
      decision.snapshots[19]?.candidateKey,
    ]);

    expect(retained).toHaveLength(10);
    expect(retained.map((candidate) => candidate.technicalRank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 19, 20,
    ]);
  });

  it('공급사 결과 반영 경로에서도 명시 선택을 포함해 후보 스냅샷을 10개로 제한한다', async () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [1]);
    const componentId = items[0]?.sourceRow?.componentId;
    expect(typeof componentId).toBe('string');
    if (typeof componentId !== 'string' || items[0] === undefined) return;
    items[0].matchStatus = 'manual';
    items[0].selectionSource = 'customer';
    items[0].selectedCandidateKey = 'ik1:candidate-19';
    const candidates = Array.from({ length: 20 }, (_, index) => candidate(
      'spec_compatible',
      `CANDIDATE-${String(index + 1).padStart(2, '0')}`,
      'digikey',
      index + 1,
      1,
      {
        currentDecisionContract: true,
        selectionRecommendation: index === 0 ? 'preselect' : 'candidate_only',
        identityKey: index === 0 ? 'ik1:engine-choice' : `ik1:candidate-${String(index + 1)}`,
        technicalEvidenceKey: index === 0 ? 'ek1:engine-choice' : `ek1:candidate-${String(index + 1)}`,
      },
    ));

    const result = await applyEngineSupplierResult(
      items,
      {
        supplier_search_schema_version: '1.7',
        procurement_decision_contract_status: 'current',
        search: {
          search_schema_version: '1.7',
          components: [{
            component_id: componentId,
            status: 'spec_compatible',
            procurement_decision: componentProcurementDecision('no_recommendation', null),
            candidates,
          }],
        },
      },
      1,
      0,
      null,
    );

    expect(result.applied).toBe(true);
    expect(result.candidateSnapshots).toHaveLength(10);
    expect(result.candidateSnapshots.map(({ candidate: snapshot }) => snapshot.technicalRank))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 19]);
    expect(items[0].selectedCandidateKey).toBe('ik1:candidate-19');
    expect(items[0].matchEvidence?.procurementUnavailabilityReason).toBeNull();
  });

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

  it('사용자 조건 재검색은 기존 명시 선택을 보존하지 않고 새 엔진 결과로 재검증한다', async () => {
    const items = buildItemsFromEngineResult(ENGINE_RESULT, [1]);
    const item = items[0];
    const componentId = item?.sourceRow?.componentId;
    expect(typeof componentId).toBe('string');
    if (item === undefined || typeof componentId !== 'string') return;
    item.matchStatus = 'manual';
    item.selectionSource = 'customer';
    item.selectedCandidateKey = 'old-customer-candidate';

    const result = await applyEngineSupplierResult(
      items,
      {
        supplier_search_schema_version: '1.7',
        procurement_decision_contract_status: 'current',
        search: {
          search_schema_version: '1.7',
          components: [{
            component_id: componentId,
            status: 'not_found',
            procurement_decision: componentProcurementDecision('no_recommendation', null),
            candidates: [],
          }],
        },
      },
      1,
      0,
      null,
      undefined,
      false,
    );

    expect(result.processedRowIndexes).toEqual([item.rowIdx]);
    expect(item.selectedCandidateKey).toBeNull();
    expect(item.selectionSource).toBe('none');
    expect(item.matchStatus).toBe('none');
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
      processedRowIndexes: [],
    });
  });

  it('현재 엔진의 가격·재고·MOQ 추천 오퍼를 Node 재정렬 없이 투영한다', () => {
    const selected = candidate('verified_exact', 'ENGINE-PICK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      categoryPolicyVersion: 'candidate-category-policy-v2',
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
        source: 'policy_default',
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
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v13');
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
      source: 'policy_default',
      expectedDisplay: '25 V',
      actualDisplay: '50 V',
    }]);
  });

  it('원품번과 선정품의 상세 수명주기 및 마지막 구매일을 행 근거에 보존한다', () => {
    const selected = candidate('verified_exact', 'EOL-PART', 'digikey', 100, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      categoryPolicyVersion: 'candidate-category-policy-v2',
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      lifecycleState: 'caution',
      lifecycleCode: 'eol',
      lifecycleStatus: 'End of Life',
      lastBuyDate: '2026-12-31T00:00:00Z',
    });
    attachProcurementDecision(selected, 'ok2:eol-selected', 'automatic', 10, 'supplier-offer-key-v2');

    const decision = selectEngineMatch({
      component_id: 'component-eol',
      status: 'verified_exact',
      procurement_decision: componentProcurementDecision(
        'automatic_recommended',
        'ok2:eol-selected',
      ),
      candidates: [selected],
    }, 10, null);

    expect(decision?.evidence.requestedLifecycle).toMatchObject({
      state: 'caution',
      code: 'eol',
      status: 'End of Life',
      lastBuyDate: '2026-12-31T00:00:00Z',
    });
    expect(decision?.evidence.selectedLifecycle).toMatchObject({
      code: 'eol',
      sources: [{ supplier: 'digikey', code: 'eol' }],
    });
  });

  it('공급사 제안 대체품 출처를 일반 스펙 후보와 구분해 저장한다', () => {
    const original = candidate('verified_exact', 'EOL-PART', 'digikey', 150, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      categoryPolicyVersion: 'candidate-category-policy-v2',
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      lifecycleState: 'caution',
      lifecycleCode: 'eol',
      lifecycleStatus: 'End of Life',
    });
    attachProcurementDecision(original, 'ok2:eol-original', 'none', 10, 'supplier-offer-key-v2');

    const replacement = candidate('spec_compatible', 'ACTIVE-REPLACEMENT', 'mouser', 120, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      categoryPolicyVersion: 'candidate-category-policy-v2',
      eligibility: 'manual_review',
      selectionMode: 'spec-compatible',
      technicalReviewRank: 1,
      selectionRecommendation: 'candidate_only',
      lifecycleState: 'active',
      lifecycleCode: 'active',
      lifecycleStatus: 'Active',
      replacementSource: 'mouser_suggested',
      replacementForMpn: 'EOL-PART',
      replacementType: 'SuggestedReplacement',
      identityKey: 'ik1:supplier-replacement',
      technicalEvidenceKey: 'ek1:supplier-replacement',
    });
    attachProcurementDecision(
      replacement,
      'ok2:supplier-replacement',
      'manual_review',
      10,
      'supplier-offer-key-v2',
    );

    const decision = selectEngineMatch({
      component_id: 'component-replacement',
      status: 'spec_compatible',
      procurement_decision: componentProcurementDecision(
        'review_recommended',
        'ok2:supplier-replacement',
        10,
        {
          applicationIdentityKey: 'ik1:supplier-replacement',
          applicationEvidenceKey: 'ek1:supplier-replacement',
          technicalFallbackUsed: true,
        },
      ),
      candidates: [original, replacement],
    }, 10, null);

    expect(decision?.snapshots.find((snapshot) =>
      snapshot.candidateKey === 'ik1:supplier-replacement')).toMatchObject({
      lifecycleCode: 'active',
      replacementSources: ['mouser_suggested'],
      replacementForMpn: 'EOL-PART',
      replacementType: 'SuggestedReplacement',
    });
    expect(decision?.evidence).toMatchObject({
      selectionApplicationState: 'provisional_selected',
      confirmationRequired: true,
      requestedLifecycle: { code: 'eol' },
      selectedLifecycle: { code: 'active' },
      selectedReplacementSources: ['mouser_suggested'],
      selectedReplacementForMpn: 'EOL-PART',
    });
  });

  it('동급 후보의 v3 가격 최적 결정을 가격 추천과 절감액으로 투영한다', () => {
    const technicalTop = candidate('spec_compatible', 'TECHNICAL-TOP', 'digikey', 100, 1, {
      currentDecisionContract: true,
      selectionMode: 'spec-compatible',
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      requiredCount: 4,
      verifiedCount: 4,
      verificationComplete: true,
      strictCategoryCoverage: true,
    });
    attachProcurementDecision(
      technicalTop,
      'ok2:technical-top',
      'none',
      10,
      'supplier-offer-key-v2',
      1,
    );

    const lowestTotal = candidate('spec_compatible', 'LOWEST-TOTAL', 'mouser', 10, 1, {
      currentDecisionContract: true,
      selectionMode: 'spec-compatible',
      selectionRecommendation: 'candidate_only',
      identityKey: 'ik1:lowest-total',
      technicalEvidenceKey: 'ek1:lowest-total',
      requiredCount: 4,
      verifiedCount: 4,
      verificationComplete: true,
      strictCategoryCoverage: true,
    });
    attachProcurementDecision(lowestTotal, 'ok2:lowest-total', 'automatic', 10, 'supplier-offer-key-v2');

    const decision = selectEngineMatch(
      {
        component_id: 'component-price-optimized',
        status: 'spec_compatible',
        procurement_decision: componentProcurementDecision(
          'automatic_recommended',
          'ok2:lowest-total',
          10,
          {
            applicationIdentityKey: 'ik1:lowest-total',
            applicationEvidenceKey: 'ek1:lowest-total',
            priceOptimizationUsed: true,
          },
        ),
        candidates: [technicalTop, lowestTotal],
      },
      10,
      null,
    );

    expect(decision?.candidateKey).toBe('ik1:lowest-total');
    expect(decision?.evidence).toMatchObject({
      recommendationType: 'price',
      technicalPreselectionCandidateKey: 'ik1:engine-choice',
      technicalFallbackUsed: false,
      decisionReasonCodes: [
        'engine-procurement-recommendation',
        'strict-spec-price-saving',
      ],
      priceEvidence: {
        lineTotalKrw: 100,
        technicalTopLineTotalKrw: 1_000,
        savingsKrw: 900,
        savingsRate: 0.9,
      },
    });
  });

  it('엔진의 구매 불가 대표 사유를 재판정 없이 견적 근거로 투영한다', () => {
    const unavailable = candidate('verified_exact', 'NO-STOCK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      conflicts: ['resistance_ohm'],
      stock: 0,
    });
    const decision = selectEngineMatch(
      {
        component_id: 'component-no-stock',
        status: 'verified_exact',
        requirement_guidance: {
          policy_version: 'bom-search-requirement-policy-v1',
          component_type: 'diode',
          readiness: 'searchable',
          required_fields: ['diode_type', 'package'],
          missing_fields: ['package'],
          values: { diode_type: 'rectifier' },
        },
        procurement_decision: componentProcurementDecision(
          'no_recommendation',
          null,
          10,
          { unavailabilityReason: 'out_of_stock' },
        ),
        candidates: [unavailable],
      },
      10,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.evidence.procurementUnavailabilityReason).toBe('out_of_stock');
    expect(decision?.evidence.searchRequirementGuidance).toEqual({
      policyVersion: 'bom-search-requirement-policy-v1',
      componentType: 'diode',
      readiness: 'searchable',
      requiredFields: ['diodeType', 'packageCode'],
      missingFields: ['packageCode'],
      values: { diodeType: 'rectifier' },
    });
    expect(decision?.evidence.conflicts).toEqual(['resistance_ohm']);
    expect(decision?.evidence.decisionReasonCodes).toEqual([
      'engine-procurement-unavailable',
    ]);
  });

  it('구형 조달 결정은 구매 불가 대표 사유 없이 계속 투영한다', () => {
    const unavailable = candidate('verified_exact', 'LEGACY-NO-STOCK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    const decision = selectEngineMatch(
      {
        component_id: 'component-legacy-no-stock',
        status: 'verified_exact',
        procurement_decision: componentProcurementDecision(
          'no_recommendation',
          null,
          10,
          { includeUnavailabilityContract: false },
        ),
        candidates: [unavailable],
      },
      10,
      null,
    );

    expect(decision?.evidence.decisionReasonCodes).toEqual([
      'engine-procurement-unavailable',
    ]);
    expect(decision?.evidence.procurementUnavailabilityReason).toBeNull();
  });

  it('구매 불가 사유 계약의 버전과 값이 함께 오지 않으면 fail-closed 처리한다', () => {
    const unavailable = candidate('verified_exact', 'INVALID-NO-STOCK', 'digikey', 1_000, 1, {
      currentDecisionContract: true,
      selectionRecommendation: 'preselect',
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
    });
    const procurementDecision = componentProcurementDecision(
      'no_recommendation',
      null,
      10,
      { unavailabilityReason: 'out_of_stock' },
    );
    Reflect.deleteProperty(procurementDecision, 'primary_unavailability_reason');

    const decision = selectEngineMatch(
      {
        component_id: 'component-invalid-no-stock',
        status: 'verified_exact',
        procurement_decision: procurementDecision,
        candidates: [unavailable],
      },
      10,
      null,
    );

    expect(decision?.candidate).toBeNull();
    expect(decision?.evidence.procurementUnavailabilityReason).toBeNull();
    expect(decision?.evidence.decisionReasonCodes).toEqual(['no-safe-candidate']);
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
            {
              sequence: 2,
              stage: 'primary',
              supplier: 'mouser',
              strategy: 'identity_exact',
              query: '0603X03L_C',
              source: 'not_executed',
              outcome: 'budget_exhausted',
              result_count: 0,
              api_calls: 0,
              http_attempt_count: 0,
              elapsed_ms: 0,
              fallback_reason: 'request_budget_exhausted',
              error_type: 'job_call_limit_exhausted',
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
      attemptCount: 2,
      limitReasons: ['job_call_limit'],
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
              selection_application_policy_version: 'supplier-selection-application-v3',
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
              price_optimization_used: false,
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

  it('v3 정확 MPN 조건 불일치 후보는 자동 선정과 가격으로 그대로 적용한다', () => {
    const review = candidate('input_conflict', 'REVIEW-PICK', 'digikey', 100, 1, {
      currentDecisionContract: true,
      decisionPolicyVersion: 'supplier-candidate-decision-v3',
      eligibility: 'automatic',
      selectionMode: 'exact',
      selectionRecommendation: 'preselect',
      reviewRecommended: false,
      identityKey: 'ik1:engine-choice',
      technicalEvidenceKey: 'ek1:engine-choice',
      reasonCodes: [
        'identity_exact',
        'identity_exact_requirement_conflict',
        'conflict:resistance_ohm_mismatch',
        'manual_review_required',
      ],
    });
    attachProcurementDecision(review, 'ok1:review-selected', 'automatic');

    const decision = selectEngineMatch(
      {
        component_id: 'component-procurement-review',
        status: 'input_conflict',
        procurement_decision: componentProcurementDecision(
          'automatic_recommended',
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
    expect(decision?.snapshots[0]?.selectionReasonCodes).toContain(
      'identity_exact_requirement_conflict',
    );
    expect(decision?.evidence.selectionApplicationState).toBe('automatic_selected');
    expect(decision?.evidence.confirmationRequired).toBe(false);
    expect(decision?.evidence.technicalFallbackUsed).toBe(false);
    expect(decision?.evidence.decisionReasonCodes).toEqual(['engine-procurement-recommendation']);
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
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v13');
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
    expect(decision?.evidence.policyVersion).toBe('engine-procurement-projection-v13');
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

  it('정확 MPN의 추가 정보 불일치는 자동선정을 유지하되 주의 상태로 투영한다', () => {
    const decision = selectEngineMatch(
      {
        component_id: 'component-exact-with-warning',
        status: 'input_conflict',
        candidates: [
          candidate('input_conflict', 'EXACT-WITH-WARNING', 'digikey', 100, 1, {
            selectionMode: 'exact',
            eligibility: 'automatic',
            conflicts: ['voltage_v_mismatch'],
            missingRequirements: ['package'],
          }),
        ],
      },
      1,
      null,
    );

    expect(decision?.snapshots[0]).toMatchObject({
      selectionEligibility: 'automatic',
      safety: 'caution',
      autoEligible: true,
      manualSelectable: true,
      conflicts: ['voltage_v_mismatch'],
      missingRequirements: ['package'],
    });
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
