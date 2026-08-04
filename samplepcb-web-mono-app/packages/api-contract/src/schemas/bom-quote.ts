import { z } from 'zod';
import { AdminEstimateCompany } from './admin';
import { PartOfferKind } from './parts';

// 고객 BOM 견적(스마트 BOM) — 업로드→파싱→매칭→검토→견적요청(RFQ) 계약.
// 설계: docs/BOM_QUOTE.md. 수량·금액의 단일 진실은 저장된 orderQty·selectedOffer
// 스냅샷이며(레거시 '박제' 원칙 보존), 합계는 항상 서버가 재계산한다(클라 금액 불신).

export const BomQuoteStatus = z.enum(['draft', 'requested', 'reviewing', 'answered', 'closed', 'canceled']);
export type BomQuoteStatusType = z.infer<typeof BomQuoteStatus>;

/** 견적 생성 출처 — 업로드 파일과 단일검색 카트를 화면에서 추측 없이 구분한다. */
export const BomQuoteSourceKind = z.enum(['upload', 'single_search']);
export type BomQuoteSourceKindType = z.infer<typeof BomQuoteSourceKind>;

/** 견적 조달 모드 — 샘플은 현행 실효비용 우선, 양산은 안전한 Reel 구매 조건을 우선한다. */
export const BomQuoteProcurementMode = z.enum(['sample', 'mass']);
export type BomQuoteProcurementModeType = z.infer<typeof BomQuoteProcurementMode>;

export const BomQuoteMatchStatus = z.enum(['auto', 'manual', 'none']);
export type BomQuoteMatchStatusType = z.infer<typeof BomQuoteMatchStatus>;

// partner = 협력사 RFQ 회신 선정(docs/SMARTBOM_PARTNER_RFQ.md §2.2)
export const BomQuoteSelectionSource = z.enum(['none', 'auto', 'customer', 'catalog', 'admin', 'legacy', 'partner']);
export type BomQuoteSelectionSourceType = z.infer<typeof BomQuoteSelectionSource>;

export const BomQuoteSelectionApplicationState = z.enum([
  'automatic_selected',
  'provisional_selected',
  'not_selected',
]);
export type BomQuoteSelectionApplicationStateType = z.infer<typeof BomQuoteSelectionApplicationState>;

/** 원본 BOM 수량의 조달 적용 상태. missing은 기술선정만 유지하고 합계에서 제외한다. */
export const BomQuoteQuantityState = z.enum([
  'verified',
  'missing',
  'confirmed',
  'excluded',
]);
export type BomQuoteQuantityStateType = z.infer<typeof BomQuoteQuantityState>;

export const BomQuoteRecommendationType = z.enum([
  'none',
  'identity',
  'technical',
  'price',
  'purchase-fit',
  'lifecycle',
  'availability',
]);
export type BomQuoteRecommendationTypeType = z.infer<typeof BomQuoteRecommendationType>;

export const BomQuoteDecisionReason = z.enum([
  'identity-exact',
  'identity-variant',
  'technical-top',
  'same-part-lowest-total',
  'strict-spec-price-saving',
  'purchase-fit',
  'lifecycle-improvement',
  'availability',
  'customer-choice',
  'admin-choice',
  'admin-force-choice',
  'admin-add',
  'catalog-choice',
  'offer-choice',
  'engine-catalog-selection',
  'engine-procurement-recommendation',
  'engine-manual-review',
  'engine-technical-fallback',
  'quantity-confirmation-required',
  'engine-procurement-unavailable',
  'mass-production-reel-preferred',
  'mass-production-reel-unavailable',
  'no-safe-candidate',
]);
export type BomQuoteDecisionReasonType = z.infer<typeof BomQuoteDecisionReason>;

export const BomQuotePriceEvidence = z.object({
  neededQty: z.number().int().min(1),
  orderQty: z.number().int().min(1),
  lineTotalKrw: z.number().nullable(),
  technicalTopLineTotalKrw: z.number().nullable(),
  savingsKrw: z.number().nullable(),
  savingsRate: z.number().nullable(),
});
export type BomQuotePriceEvidenceType = z.infer<typeof BomQuotePriceEvidence>;

export const BomQuoteSearchTraceSource = z.enum([
  'live_api',
  'fresh_cache',
  'stale_cache',
  'coalesced',
  'prefetch_cache',
  'batch_reuse',
  'not_executed',
]);
export const BomQuoteSearchTraceOutcome = z.enum([
  'results',
  'empty',
  'error',
  'skipped',
  'budget_exhausted',
]);
export const BomQuoteSupplierSearchLimitReason = z.enum([
  'job_call_limit',
  'supplier_quota',
]);
export type BomQuoteSupplierSearchLimitReasonType = z.infer<
  typeof BomQuoteSupplierSearchLimitReason
>;
export const BomQuoteSearchTraceAttempt = z.object({
  sequence: z.number().int().min(1),
  stage: z.enum(['primary', 'identity_fallback', 'stock_alternative']),
  supplier: z.string(),
  strategy: z.string(),
  query: z.string(),
  source: BomQuoteSearchTraceSource,
  outcome: BomQuoteSearchTraceOutcome,
  resultCount: z.number().int().min(0),
  apiCalls: z.number().int().min(0),
  httpAttemptCount: z.number().int().min(0),
  elapsedMs: z.number().min(0),
  fallbackReason: z.string().nullable(),
  errorType: z.string().nullable(),
});
export type BomQuoteSearchTraceAttemptType = z.infer<typeof BomQuoteSearchTraceAttempt>;

export const BomQuoteSearchTraceSummary = z.object({
  version: z.literal('supplier-search-trace-v1'),
  primaryQuery: z.string(),
  fallbackQuery: z.string().nullable(),
  fallbackUsed: z.boolean(),
  attemptCount: z.number().int().min(0),
  /** 이 행에서 실제 공급사 호출이 실행되지 않았거나 중단된 한도 사유. 구형 견적에는 없다. */
  limitReasons: z.array(BomQuoteSupplierSearchLimitReason).optional(),
});
export type BomQuoteSearchTraceSummaryType = z.infer<typeof BomQuoteSearchTraceSummary>;

export const BomQuoteSearchTrace = BomQuoteSearchTraceSummary.extend({
  attempts: z.array(BomQuoteSearchTraceAttempt),
});
export type BomQuoteSearchTraceType = z.infer<typeof BomQuoteSearchTrace>;

export const BomQuoteLocalCatalogOutcome = z.enum([
  'selected',
  'no_candidates',
  'rejected',
  'skipped',
  'error',
]);
export type BomQuoteLocalCatalogOutcomeType = z.infer<
  typeof BomQuoteLocalCatalogOutcome
>;

export const BomQuoteLocalCatalogType = z.enum([
  'samplepcb_rc',
  'connector',
  'ingested_rc',
]);
export type BomQuoteLocalCatalogTypeType = z.infer<
  typeof BomQuoteLocalCatalogType
>;

export const BomQuoteLocalCatalogReasonKind = z.enum([
  'conflict',
  'missing_requirement',
  'decision',
]);

export const BomQuoteLocalCatalogReasonCount = z.object({
  kind: BomQuoteLocalCatalogReasonKind,
  code: z.string(),
  count: z.number().int().min(1),
});

export const BomQuoteLocalCatalogRequirementAssessment = z.object({
  key: z.string(),
  comparison: z.enum(['eq', 'gte', 'lte', 'contains', 'category']),
  state: z.enum(['match', 'mismatch', 'missing', 'not_applicable', 'unverified']),
  verified: z.boolean(),
  expectedDisplay: z.string().nullable(),
  actualDisplay: z.string().nullable(),
  source: z.enum(['bom', 'user', 'policy_default', 'unknown']),
});

export const BomQuoteLocalCatalogRepresentativeCandidate = z.object({
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  status: z.string(),
  selectionEligibility: z.enum(['automatic', 'manual_review', 'blocked']).nullable(),
  verifiedRequirementCount: z.number().int().min(0),
  requiredRequirementCount: z.number().int().min(0),
  conflicts: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  reasonCodes: z.array(z.string()),
  requirementAssessments: z.array(BomQuoteLocalCatalogRequirementAssessment),
});

/**
 * 로컬 후보 전체 원문 대신 저장하는 표시용 엔진 판정 요약.
 * 기술·조달 판단은 sp-engine 결과를 그대로 투영하며 Node가 재판정하지 않는다.
 */
export const BomQuoteLocalCatalogDecisionSummary = z.object({
  componentStatus: z.string(),
  procurementStatus: z.string().nullable(),
  selectionApplicationState: BomQuoteSelectionApplicationState.nullable(),
  primaryUnavailabilityReason: z.string().nullable(),
  recommendationReasonCodes: z.array(z.string()),
  automaticCandidateCount: z.number().int().min(0),
  reviewCandidateCount: z.number().int().min(0),
  blockedCandidateCount: z.number().int().min(0),
  unclassifiedCandidateCount: z.number().int().min(0),
  reasonCounts: z.array(BomQuoteLocalCatalogReasonCount),
  representativeCandidate: BomQuoteLocalCatalogRepresentativeCandidate.nullable(),
});

/** 외부 공급사 호출보다 먼저 수행한 부품 유형별 자체 카탈로그 조회 한 단계. */
export const BomQuoteLocalCatalogTrace = z.object({
  version: z.literal('local-catalog-trace-v3'),
  catalogType: BomQuoteLocalCatalogType,
  query: z.string(),
  outcome: BomQuoteLocalCatalogOutcome,
  candidateCount: z.number().int().min(0),
  evaluatedCandidateCount: z.number().int().min(0),
  selectedCandidateCount: z.number().int().min(0),
  apiCalls: z.literal(0),
  elapsedMs: z.number().min(0),
  reason: z.string().nullable(),
  /** v1·v2 저장 기록은 null로 호환 투영한다. */
  decisionSummary: BomQuoteLocalCatalogDecisionSummary.nullable(),
});
export type BomQuoteLocalCatalogTraceType = z.infer<
  typeof BomQuoteLocalCatalogTrace
>;

/** sp-engine이 구매 후보를 선정하지 못했을 때의 대표 사유. */
export const BomQuoteProcurementUnavailabilityReason = z.enum([
  'out_of_stock',
  'insufficient_stock',
  'stock_unverified',
  'catalog_inquiry',
  'price_unavailable',
  'technical_unavailable',
  'supplier_unavailable',
  'no_offer',
  'input_incomplete',
  'other',
]);
export type BomQuoteProcurementUnavailabilityReasonType = z.infer<
  typeof BomQuoteProcurementUnavailabilityReason
>;

export const BomQuoteSearchRequirementComponentType = z.enum([
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'transistor',
  'led',
  'crystal',
  'connector',
  'switch',
]);
export type BomQuoteSearchRequirementComponentTypeType = z.infer<
  typeof BomQuoteSearchRequirementComponentType
>;

/** sp-engine이 추출·검색계획으로 확정한 행별 검색 준비 상태. */
export const BomQuoteSearchRequirementGuidance = z.object({
  policyVersion: z.literal('bom-search-requirement-policy-v1'),
  componentType: BomQuoteSearchRequirementComponentType.nullable(),
  readiness: z.enum(['searchable', 'needs_user_input', 'excluded']),
  requiredFields: z.array(z.string()),
  missingFields: z.array(z.string()),
  values: z.record(z.string(), z.unknown()),
});
export type BomQuoteSearchRequirementGuidanceType = z.infer<
  typeof BomQuoteSearchRequirementGuidance
>;

/** 공급사 원문을 sp-engine이 표시용으로 정규화한 부품 수명주기. */
export const BomQuoteLifecycleCode = z.enum([
  'active',
  'nrnd',
  'eol',
  'discontinued',
  'obsolete',
  'inactive',
  'unknown',
]);
export type BomQuoteLifecycleCodeType = z.infer<typeof BomQuoteLifecycleCode>;

export const BomQuoteReplacementSource = z.enum([
  'digikey_substitution',
  'mouser_suggested',
  'engine_stock_fallback',
  'engine_mpn_fallback',
]);
export type BomQuoteReplacementSourceType = z.infer<typeof BomQuoteReplacementSource>;

export const BomQuoteLifecycleSource = z.object({
  supplier: z.string(),
  code: BomQuoteLifecycleCode,
  status: z.string().nullable(),
  lastBuyDate: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});
export type BomQuoteLifecycleSourceType = z.infer<typeof BomQuoteLifecycleSource>;

export const BomQuoteLifecycleSummary = z.object({
  state: z.enum(['active', 'caution', 'unknown']),
  code: BomQuoteLifecycleCode,
  status: z.string().nullable(),
  lastBuyDate: z.string().nullable(),
  sources: z.array(BomQuoteLifecycleSource),
});
export type BomQuoteLifecycleSummaryType = z.infer<typeof BomQuoteLifecycleSummary>;

/**
 * 공급사 검색 엔진의 BOM 문맥 판정과 자동 선정 근거.
 * 카탈로그 사실 데이터와 분리해 견적 라인에 스냅샷으로 보존한다.
 */
export const BomQuoteMatchEvidence = z.object({
  policyVersion: z.string(),
  componentId: z.string(),
  componentStatus: z.string(),
  /** sp-engine이 결정한 적용 상태. 사용자 확인 여부와 분리한다. */
  selectionApplicationState: BomQuoteSelectionApplicationState.optional(),
  /** 엔진 선정 결과를 최종 확정하기 전에 사용자 확인이 필요한지 여부. */
  confirmationRequired: z.boolean().optional(),
  /** 선정되지 않은 행의 대표 구매 불가 사유. 구 엔진 결과에는 없을 수 있다. */
  procurementUnavailabilityReason: BomQuoteProcurementUnavailabilityReason.nullable().optional(),
  /** 가격·재고와 무관한 엔진 기술 사전 선정 후보. 기존 견적은 생략될 수 있다. */
  technicalPreselectionCandidateKey: z.string().nullable().optional(),
  /** 기술 사전 선정 후보가 구매 불가해 다음 기술 후보를 적용했는지 여부. */
  technicalFallbackUsed: z.boolean().optional(),
  /** 품번 검색에서 신뢰 후보가 없어 엔진이 확정 스펙 검색으로 전환했는지 여부. */
  identityFallback: z.boolean(),
  /** MPN·제조사 제한 없이 스펙으로 검색한 결과인지 여부. 구 견적에는 없을 수 있다. */
  anyVendorSpecSearch: z.boolean().optional(),
  /** 검색 조건의 기술 준비 상태 — Node/화면은 재판정하지 않고 엔진 결과를 표시한다. */
  searchRequirementGuidance: BomQuoteSearchRequirementGuidance.nullable().optional(),
  /** 전체 이력은 후보 API에서 지연 조회하고 목록에는 엔진 trace의 compact 요약만 둔다. */
  searchTraceSummary: BomQuoteSearchTraceSummary.nullable().optional(),
  candidateStatus: z.string().nullable(),
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review', 'unmatched']),
  candidateCount: z.number().int().min(0),
  eligibleCandidateCount: z.number().int().min(0),
  selectedMpn: z.string().nullable(),
  selectedManufacturer: z.string().nullable(),
  selectedSupplier: z.string().nullable(),
  selectedSupplierSku: z.string().nullable(),
  /** BOM 원품번과 실제 선정품의 수명주기를 분리해 단종 대체를 숨기지 않는다. */
  requestedLifecycle: BomQuoteLifecycleSummary.nullable().optional(),
  selectedLifecycle: BomQuoteLifecycleSummary.nullable().optional(),
  selectedReplacementSources: z.array(BomQuoteReplacementSource).optional(),
  selectedReplacementForMpn: z.string().nullable().optional(),
  identityConfidence: z.number().nullable(),
  specificationConfidence: z.number().nullable(),
  conflicts: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  reasons: z.array(z.string()),
  corroboratingSuppliers: z.array(z.string()),
  /** 공급사 중복을 제조사+MPN으로 묶은 실제 부품 후보 수. */
  groupedCandidateCount: z.number().int().min(0),
  alternativeCandidateCount: z.number().int().min(0),
  recommendedCandidateKey: z.string().nullable(),
  selectedCandidateKey: z.string().nullable(),
  selectedTechnicalRank: z.number().int().min(1).nullable(),
  recommendationType: BomQuoteRecommendationType,
  decisionReasonCodes: z.array(BomQuoteDecisionReason),
  verifiedRequirementCount: z.number().int().min(0),
  requiredRequirementCount: z.number().int().min(0),
  priceEvidence: BomQuotePriceEvidence.nullable(),
});
export type BomQuoteMatchEvidenceType = z.infer<typeof BomQuoteMatchEvidence>;

/** 업로드 파싱부터 선택 시트 계산 완료까지의 생명주기. */
export const BomQuoteBuildStatus = z.enum(['parsing', 'selecting', 'building', 'ready', 'failed']);
export type BomQuoteBuildStatusType = z.infer<typeof BomQuoteBuildStatus>;

export const BomQuoteSheetStatus = z.enum(['parsed', 'not_bom', 'error']);
export type BomQuoteSheetStatusType = z.infer<typeof BomQuoteSheetStatus>;

/** 엔진이 발견한 워크북 시트와 고객 선택 스냅샷. */
export const BomQuoteSheet = z.object({
  sheetIndex: z.number().int().min(0),
  sheetName: z.string(),
  status: BomQuoteSheetStatus,
  componentCount: z.number().int().min(0),
  selected: z.boolean(),
  /** 한 번 견적 라인으로 구성된 시트 — 결과 화면에서 제외 후 다시 포함할 수 있다. */
  hasItems: z.boolean(),
  failureReason: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type BomQuoteSheetType = z.infer<typeof BomQuoteSheet>;

/** 라인에 박제되는 구매 조건 스냅샷 — 견적요청 후 재선정하지 않는다(시점 고정). */
export const BomQuoteSelectedOffer = z.object({
  /** 후보 스냅샷 안에서 공급사+SKU+포장을 식별하는 안정 키. 레거시는 null. */
  offerKey: z.string().nullable(),
  supplier: z.string(),
  supplierSku: z.string(),
  packaging: z.string().nullable(),
  /** 적용된 가격구간(주문수량 기준). */
  breakQty: z.number().int(),
  unitPrice: z.number(),
  currency: z.string(),
  /** KRW 환산 단가(예상) — 비KRW·환율 미설정이면 null(미환산). */
  unitPriceKrw: z.number().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  /** 선택 시점의 가격구간 사다리 전체 — 수량 변경 시 구간 재계산의 근거(스냅샷). */
  priceBreaks: z.array(z.object({ qty: z.number().int(), price: z.number() })),
  fetchedAt: z.string(),
  /** 사용자가 명시 선택(고정) — 수량 변경 시 이 구매 조건 안에서만 구간 재계산. */
  pinned: z.boolean(),
});
export type BomQuoteSelectedOfferType = z.infer<typeof BomQuoteSelectedOffer>;

export const BomQuoteCandidateSafety = z.enum(['safe', 'caution', 'blocked']);
export type BomQuoteCandidateSafetyType = z.infer<typeof BomQuoteCandidateSafety>;

export const BomQuoteCandidateSelectionEligibility = z.enum(['automatic', 'manual_review', 'blocked']);
export type BomQuoteCandidateSelectionEligibilityType = z.infer<typeof BomQuoteCandidateSelectionEligibility>;

export const BomQuoteCandidateSelectionRecommendation = z.enum(['preselect', 'candidate_only', 'exclude']);
export type BomQuoteCandidateSelectionRecommendationType = z.infer<typeof BomQuoteCandidateSelectionRecommendation>;

const BomQuoteSearchRequirementsPhysicalBase = z.object({
  mountStyle: z.enum(['smd', 'through-hole']).nullable(),
});

const BomQuoteSearchRequirementsPackagedBase = BomQuoteSearchRequirementsPhysicalBase.extend({
  packageCode: z.string().trim().min(1).max(64),
});

const BomQuoteSearchRequirementsPassiveBase = BomQuoteSearchRequirementsPackagedBase.extend({
  tolerance: z.string().trim().min(1).max(64).nullable(),
});

const BomQuoteResistorSearchRequirements = BomQuoteSearchRequirementsPassiveBase.extend({
  componentType: z.literal('resistor'),
  resistance: z.string().trim().min(1).max(64),
  power: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteCapacitorSearchRequirements = BomQuoteSearchRequirementsPassiveBase.extend({
  componentType: z.literal('capacitor'),
  capacitorType: z.enum(['ceramic', 'electrolytic', 'tantalum', 'film']),
  capacitance: z.string().trim().min(1).max(64),
  voltage: z.string().trim().min(1).max(64).nullable(),
  dielectric: z.string().trim().min(1).max(32).nullable(),
}).strict();

const BomQuoteInductorSearchRequirements = BomQuoteSearchRequirementsPassiveBase.extend({
  componentType: z.literal('inductor'),
  inductorType: z.enum(['standard', 'ferrite']),
  inductance: z.string().trim().min(1).max(64).nullable(),
  impedance: z.string().trim().min(1).max(64).nullable(),
  impedanceFrequency: z.string().trim().min(1).max(64).nullable(),
  current: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteDiodeSearchRequirements = BomQuoteSearchRequirementsPackagedBase.extend({
  componentType: z.literal('diode'),
  diodeType: z.enum(['rectifier', 'signal', 'schottky', 'zener', 'tvs', 'photodiode']),
  voltage: z.string().trim().min(1).max(64).nullable(),
  current: z.string().trim().min(1).max(64).nullable(),
  power: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteTransistorSearchRequirements = BomQuoteSearchRequirementsPackagedBase.extend({
  componentType: z.literal('transistor'),
  transistorType: z.enum(['bjt', 'mosfet']),
  polarity: z.enum(['npn', 'pnp', 'n-channel', 'p-channel']),
  voltage: z.string().trim().min(1).max(64).nullable(),
  current: z.string().trim().min(1).max(64).nullable(),
  power: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteLedSearchRequirements = BomQuoteSearchRequirementsPackagedBase.extend({
  componentType: z.literal('led'),
  color: z.string().trim().min(1).max(32),
  voltage: z.string().trim().min(1).max(64).nullable(),
  current: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteCrystalSearchRequirements = BomQuoteSearchRequirementsPassiveBase.extend({
  componentType: z.literal('crystal'),
  crystalType: z.enum(['crystal', 'oscillator', 'resonator']),
  frequency: z.string().trim().min(1).max(64),
}).strict();

const BomQuoteConnectorSearchRequirements = BomQuoteSearchRequirementsPhysicalBase.extend({
  componentType: z.literal('connector'),
  packageCode: z.string().trim().min(1).max(64).nullable(),
  pinCount: z.number().int().min(1).max(1000),
  pitch: z.string().trim().min(1).max(32),
  rowCount: z.number().int().min(1).max(100).nullable(),
  gender: z.enum(['male', 'female', 'genderless']).nullable(),
  orientation: z.enum(['straight', 'right-angle', 'vertical']).nullable(),
}).strict();

const BomQuoteSwitchSearchRequirements = BomQuoteSearchRequirementsPackagedBase.extend({
  componentType: z.literal('switch'),
  switchType: z.enum([
    'tactile',
    'pushbutton',
    'slide',
    'toggle',
    'dip',
    'rotary',
    'reed',
    'other',
  ]),
  contactForm: z.string().trim().min(1).max(64).nullable(),
  voltage: z.string().trim().min(1).max(64).nullable(),
  current: z.string().trim().min(1).max(64).nullable(),
}).strict();

const BomQuoteSearchRequirementVariants = [
  BomQuoteResistorSearchRequirements,
  BomQuoteCapacitorSearchRequirements,
  BomQuoteInductorSearchRequirements,
  BomQuoteDiodeSearchRequirements,
  BomQuoteTransistorSearchRequirements,
  BomQuoteLedSearchRequirements,
  BomQuoteCrystalSearchRequirements,
  BomQuoteConnectorSearchRequirements,
  BomQuoteSwitchSearchRequirements,
] as const;

/** 원본 BOM을 덮어쓰지 않고 해당 견적 행의 스펙 검색에만 적용하는 사용자 명령. */
export const BomQuoteSearchRequirementsBody = z.discriminatedUnion('componentType', [
  ...BomQuoteSearchRequirementVariants,
]);
export type BomQuoteSearchRequirementsBodyType = z.infer<typeof BomQuoteSearchRequirementsBody>;

/** 견적 전체의 누락 수동소자 조건에 사용자가 한 번 승인해 적용하는 보수적 기본값. */
export const BomQuotePassiveDefaultsBody = z.object({
  resistorTolerance: z.string().trim().min(1).max(64),
  capacitorTolerance: z.string().trim().min(1).max(64),
  capacitorVoltage: z.string().trim().min(1).max(64),
  capacitorDielectricPolicy: z.literal('capacitance-aware-conservative'),
}).strict();
export type BomQuotePassiveDefaultsBodyType = z.infer<typeof BomQuotePassiveDefaultsBody>;

const BomQuoteSearchRequirementsMetadata = {
  version: z.enum([
    'bom-user-search-requirements-v1',
    'bom-user-search-requirements-v2',
  ]),
  updatedAt: z.string(),
  updatedBy: z.string(),
};

export const BomQuoteSearchRequirements = z.discriminatedUnion('componentType', [
  BomQuoteResistorSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteCapacitorSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteInductorSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteDiodeSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteTransistorSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteLedSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteCrystalSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteConnectorSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
  BomQuoteSwitchSearchRequirements.extend(BomQuoteSearchRequirementsMetadata),
]).superRefine((value, context) => {
  if (
    value.version === 'bom-user-search-requirements-v1'
    && !['resistor', 'capacitor'].includes(value.componentType)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['version'],
      message: 'v1은 저항과 캐패시터만 지원합니다',
    });
  }
});
export type BomQuoteSearchRequirementsType = z.infer<typeof BomQuoteSearchRequirements>;

export const BomQuoteCandidateOfferApplied = z.object({
  orderQty: z.number().int().min(1),
  breakQty: z.number().int().min(1),
  unitPrice: z.number(),
  currency: z.string(),
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
  stockShort: z.boolean(),
});

/** 견적 후보에 박제된 공급사 구매 조건과 현재 필요수량 기준 계산 결과. */
export const BomQuoteCandidateOffer = z.object({
  offerKey: z.string(),
  supplier: z.string(),
  offerKind: PartOfferKind,
  supplierSku: z.string(),
  packaging: z.string().nullable(),
  stock: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  productUrl: z.string().nullable(),
  fetchedAt: z.string(),
  priceBreaks: z.array(z.object({ qty: z.number().int().min(1), price: z.number(), currency: z.string() })),
  /** sp-engine의 동일 기술 근거 그룹 내 가격·구매적합 순위. */
  priceRank: z.number().int().min(1).nullable(),
  purchaseFitRank: z.number().int().min(1).nullable(),
  purchasable: z.boolean(),
  recommendation: z.enum(['automatic', 'manual_review', 'none']),
  decisionReasonCodes: z.array(z.string()),
  applied: BomQuoteCandidateOfferApplied.nullable(),
});
export type BomQuoteCandidateOfferType = z.infer<typeof BomQuoteCandidateOffer>;

export const BomQuoteRequirementAssessment = z.object({
  key: z.string(),
  comparison: z.enum(['eq', 'gte', 'lte', 'contains', 'category']),
  state: z.enum(['match', 'mismatch', 'missing', 'not_applicable', 'unverified']),
  verified: z.boolean(),
  expectedDisplay: z.string().nullable(),
  actualDisplay: z.string().nullable(),
  source: z.enum(['bom', 'user', 'policy_default', 'unknown']),
});
export type BomQuoteRequirementAssessmentType = z.infer<typeof BomQuoteRequirementAssessment>;

/** 공급사 행을 제조사+MPN으로 통합한 고객 선택 단위. */
export const BomQuoteCandidate = z.object({
  candidateKey: z.string(),
  technicalRank: z.number().int().min(1),
  /** 엔진이 manual_review 기술 근거 그룹에만 부여한 검토 순위. */
  technicalReviewRank: z.number().int().min(1).nullable(),
  /** 엔진이 지정한 기술 후보군 사전 선정 상태. 기존 스냅샷은 null. */
  selectionRecommendation: BomQuoteCandidateSelectionRecommendation.nullable(),
  reviewRecommended: z.boolean(),
  /** 대표 구매 조건의 엔진 가격 순위. 후보 간 독자 재정렬에는 사용하지 않는다. */
  priceRank: z.number().int().min(1).nullable(),
  status: z.string(),
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review']),
  safety: BomQuoteCandidateSafety,
  selectionEligibility: BomQuoteCandidateSelectionEligibility,
  autoEligible: z.boolean(),
  manualSelectable: z.boolean(),
  selectionReasonCodes: z.array(z.string()),
  selected: z.boolean(),
  recommended: z.boolean(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  packageCode: z.string().nullable(),
  lifecycleStatus: z.string().nullable(),
  lifecycleState: z.enum(['active', 'caution', 'unknown']),
  lifecycleCode: BomQuoteLifecycleCode,
  lastBuyDate: z.string().nullable(),
  lifecycleSources: z.array(BomQuoteLifecycleSource),
  replacementSources: z.array(BomQuoteReplacementSource),
  replacementForMpn: z.string().nullable(),
  replacementType: z.string().nullable(),
  datasheetUrl: z.string().nullable(),
  /** 공급사 제품 사진 직링크 — 표시 전용. */
  imageUrl: z.string().nullable(),
  identityConfidence: z.number(),
  specificationConfidence: z.number(),
  conflicts: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  reasons: z.array(z.string()),
  corroboratingSuppliers: z.array(z.string()),
  verifiedRequirementCount: z.number().int().min(0),
  requiredRequirementCount: z.number().int().min(0),
  /** sp-engine이 백분율과 같은 필수조건 집합으로 확정한 항목별 판정. */
  requirementAssessments: z.array(BomQuoteRequirementAssessment),
  verificationComplete: z.boolean(),
  strictCategoryCoverage: z.boolean(),
  technicalEvidenceKey: z.string(),
  normalizedSpecs: z.record(z.string(), z.unknown()),
  specComparisons: z.record(z.string(), z.unknown()),
  packageComparison: z.record(z.string(), z.unknown()).nullable(),
  offers: z.array(BomQuoteCandidateOffer),
  bestOfferKey: z.string().nullable(),
  bestLineTotalKrw: z.number().nullable(),
  lineDeltaKrw: z.number().nullable(),
  savingsVsTechnicalKrw: z.number().nullable(),
  savingsVsTechnicalRate: z.number().nullable(),
});
export type BomQuoteCandidateType = z.infer<typeof BomQuoteCandidate>;

/** 전체 BOM 비교에서 사용하는 영속 후보 뷰 — 엔진 인메모리 잡과 무관한 DB 스냅샷. */
export const BomQuoteComparisonOffer = BomQuoteCandidateOffer.omit({ applied: true });
export type BomQuoteComparisonOfferType = z.infer<typeof BomQuoteComparisonOffer>;

export const BomQuoteComparisonCandidate = BomQuoteCandidate.pick({
  candidateKey: true,
  technicalRank: true,
  technicalReviewRank: true,
  selectionRecommendation: true,
  reviewRecommended: true,
  status: true,
  safety: true,
  selectionEligibility: true,
  manualSelectable: true,
  selectionReasonCodes: true,
  mpn: true,
  manufacturerName: true,
  description: true,
  category: true,
  packageCode: true,
  lifecycleStatus: true,
  lifecycleCode: true,
  lastBuyDate: true,
  lifecycleSources: true,
  replacementSources: true,
  replacementForMpn: true,
  replacementType: true,
  identityConfidence: true,
  specificationConfidence: true,
  conflicts: true,
  missingRequirements: true,
  reasons: true,
  requirementAssessments: true,
  normalizedSpecs: true,
  specComparisons: true,
  packageComparison: true,
}).extend({ offers: z.array(BomQuoteComparisonOffer) });
export type BomQuoteComparisonCandidateType = z.infer<typeof BomQuoteComparisonCandidate>;

/** 견적과 독립적으로 박제된 엔진 ComponentRecord 원본. payload가 전 필드의 단일 진실이다. */
export const BomQuoteExtractionSource = z.object({
  analysisComponentId: z.string(),
  engineComponentId: z.string(),
  reviewStatus: z.enum(['extracted', 'review']),
  confidence: z.number().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type BomQuoteExtractionSourceType = z.infer<typeof BomQuoteExtractionSource>;

export const BomQuoteComparisonRow = z.object({
  itemId: z.string(),
  rowIdx: z.number().int().min(0),
  extraction: BomQuoteExtractionSource.nullable(),
  candidates: z.array(BomQuoteComparisonCandidate),
});
export type BomQuoteComparisonRowType = z.infer<typeof BomQuoteComparisonRow>;

export const BomQuoteComparison = z.object({
  quoteId: z.string(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(1),
  summary: z.object({
    matched: z.number().int().min(0),
    attention: z.number().int().min(0),
    notFound: z.number().int().min(0),
  }),
  sheets: z.array(z.string()),
  rows: z.array(BomQuoteComparisonRow),
});
export type BomQuoteComparisonType = z.infer<typeof BomQuoteComparison>;

export const BomQuoteSelectionEvent = z.object({
  id: z.string(),
  source: BomQuoteSelectionSource,
  actorId: z.string().nullable(),
  previousCandidateKey: z.string().nullable(),
  selectedCandidateKey: z.string().nullable(),
  previousMpn: z.string().nullable(),
  selectedMpn: z.string().nullable(),
  previousOfferKey: z.string().nullable(),
  selectedOfferKey: z.string().nullable(),
  previousLineTotalKrw: z.number().nullable(),
  selectedLineTotalKrw: z.number().nullable(),
  reasonCodes: z.array(BomQuoteDecisionReason),
  createdAt: z.string(),
});
export type BomQuoteSelectionEventType = z.infer<typeof BomQuoteSelectionEvent>;

export const BomQuoteItemCandidates = z.object({
  quoteId: z.string(),
  itemId: z.string(),
  rowIdx: z.number().int().min(0),
  /** 영속 분석에서 읽은 원본 ComponentRecord. 도입 전/수동 행은 null이다. */
  extraction: BomQuoteExtractionSource.nullable(),
  /** 사용자가 원본 BOM과 별도로 확정한 행 단위 스펙 검색조건. */
  searchRequirements: BomQuoteSearchRequirements.nullable(),
  /** sp-engine이 확정한 검색 가능 상태와 보완 필드. 구버전 결과는 null이다. */
  searchRequirementGuidance: BomQuoteSearchRequirementGuidance.nullable(),
  originalMpn: z.string().nullable(),
  originalValue: z.string().nullable(),
  originalSheetName: z.string().nullable(),
  originalRows: z.array(z.number().int().min(1)),
  originalReferenceDesignators: z.array(z.string()),
  originalManufacturer: z.string().nullable(),
  originalPackageCode: z.string().nullable(),
  bomQty: z.number().int().min(1),
  neededQty: z.number().int().min(1),
  currentMpn: z.string(),
  currentLineTotalKrw: z.number().nullable(),
  selectionSource: BomQuoteSelectionSource,
  selectionApplicationState: BomQuoteSelectionApplicationState,
  confirmationRequired: z.boolean(),
  selectedCandidateKey: z.string().nullable(),
  selectedOfferKey: z.string().nullable(),
  recommendedCandidateKey: z.string().nullable(),
  technicalTopCandidateKey: z.string().nullable(),
  technicalTopLineTotalKrw: z.number().nullable(),
  technicalFallbackUsed: z.boolean(),
  /** sp-engine이 결정한 현재 행의 대표 구매 불가 사유. */
  procurementUnavailabilityReason: BomQuoteProcurementUnavailabilityReason.nullable().optional(),
  decisionReasonCodes: z.array(BomQuoteDecisionReason),
  /** 외부 공급사보다 먼저 조회한 부품 유형별 자체 카탈로그 단계. 구버전 실행은 null이다. */
  localCatalogTrace: BomQuoteLocalCatalogTrace.nullable(),
  /** 활성 공급사 검색 실행에서 영속 조회한 컴포넌트 검색 과정. 구버전 실행은 null이다. */
  searchTrace: BomQuoteSearchTrace.nullable(),
  candidates: z.array(BomQuoteCandidate),
  events: z.array(BomQuoteSelectionEvent),
});
export type BomQuoteItemCandidatesType = z.infer<typeof BomQuoteItemCandidates>;

/** 서버 내부 견적 라인 상태. 클라이언트 PATCH 계약과 분리해 서버 소유 근거를 왕복하지 않는다. */
export const BomQuoteItemInput = z.object({
  rowIdx: z.number().int().min(0),
  /** 합계·견적요청에 포함 여부 — items 와 합계의 기준을 동일하게(레거시 결함 교정). */
  included: z.boolean(),
  /** 원본에 MPN이 없는 스펙 기반 부품행은 빈 문자열로 보존한다. */
  mpn: z.string().max(191),
  manufacturerName: z.string().max(191).nullable(),
  description: z.string().max(1000).nullable(),
  bomQty: z.number().int().min(1),
  /** 박제된 주문수량(=max(BOM수량×세트, MOQ)→배수 올림) — 단일 진실. */
  orderQty: z.number().int().min(0),
  matchStatus: BomQuoteMatchStatus,
  /** 관리자 공급사 엔진과 동일한 판정·자동 선정 근거. 수동 추가는 null. */
  matchEvidence: BomQuoteMatchEvidence.nullable(),
  recommendedCandidateKey: z.string().nullable(),
  selectedCandidateKey: z.string().nullable(),
  selectionSource: BomQuoteSelectionSource,
  /** 카탈로그(sp_part) 연결 — 매칭 안 됐으면 null. */
  partId: z.string().nullable(),
  selectedOffer: BomQuoteSelectedOffer.nullable(),
  /** 원본 행 근거(엑셀 셀 값들) — 검토·감사용. */
  sourceRow: z.record(z.string(), z.unknown()).nullable(),
  /** 시트 필터·그룹에 쓰는 구조화된 원본 위치. 수동 추가 행은 null. */
  sourceSheetIndex: z.number().int().min(0).nullable(),
  sourceSheetName: z.string().nullable(),
});
export type BomQuoteItemInputType = z.infer<typeof BomQuoteItemInput>;

/** 서버 → 클라이언트 항목(서버 계산 필드 포함). */
export const BomQuoteItem = BomQuoteItemInput.extend({
  /** 견적 라인의 영속 식별자. rowIdx는 표시 순서일 뿐 수정·후보 연결 키로 쓰지 않는다. */
  id: z.string(),
  /** 단가×주문수량 KRW 환산(예상) — 미환산이면 null(화면 경고). */
  lineTotalKrw: z.number().nullable(),
  /** 카탈로그 부품 이미지(partId 조회, 서버 채움) — 표시 전용·PATCH 왕복 없음. */
  partImageUrl: z.string().nullable(),
  /** 데이터시트 외부 링크(카탈로그 partId 우선, 없으면 선정 후보 스냅샷) — 표시 전용·PATCH 왕복 없음. */
  partDatasheetUrl: z.string().nullable(),
  /** 현재 카탈로그 연결이 가격·실재고 확인 전인 제조사 카탈로그 부품인지 여부. */
  catalogInquiry: z.boolean(),
  /** 원본 수량 누락 행은 기술선정 상태를 유지하되 확인 전까지 견적 합계에서 제외한다. */
  quantityState: BomQuoteQuantityState,
  /** 업로드 분석 원본과 연결되지 않은 수동 행. 관리자는 이 행만 제거할 수 있다. */
  manualEntry: z.boolean().optional(),
});
export type BomQuoteItemType = z.infer<typeof BomQuoteItem>;

/** 고객이 카탈로그에서 명시적으로 선택한 부품·구매 조건. 엔진 원본/판정과 분리된 사용자 명령이다. */
export const BomQuoteCatalogSelection = z.object({
  mpn: z.string().max(191),
  manufacturerName: z.string().max(191).nullable(),
  description: z.string().max(1000).nullable(),
  partId: z.string().regex(/^\d+$/),
  selectedOffer: BomQuoteSelectedOffer.nullable(),
});
export type BomQuoteCatalogSelectionType = z.infer<typeof BomQuoteCatalogSelection>;

/** 안정 ID 기반 draft 라인 편집. id=null은 카탈로그에서 추가한 신규 수동 행이다. */
export const BomQuoteItemEdit = z.object({
  id: z.string().regex(/^\d+$/).nullable(),
  included: z.boolean(),
  orderQty: z.number().int().min(0),
  /** 원본 수량 누락 행의 명시적 사용자 확인. 단순 자동저장과 구분한다. */
  confirmedBomQty: z.number().int().min(1).optional(),
  catalogSelection: BomQuoteCatalogSelection.optional(),
}).superRefine((item, ctx) => {
  if (item.id === null && item.catalogSelection === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['catalogSelection'],
      message: '신규 견적 행에는 카탈로그 선택 정보가 필요합니다',
    });
  }
});
export type BomQuoteItemEditType = z.infer<typeof BomQuoteItemEdit>;

export const BomQuoteSummary = z.object({
  id: z.string(),
  title: z.string(),
  sourceKind: BomQuoteSourceKind,
  status: BomQuoteStatus,
  fileName: z.string().nullable(),
  itemCount: z.number().int(),
  includedCount: z.number().int(),
  matchedCount: z.number().int(),
  finalTotal: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  requestedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  /** 관리자 확정 총액(VAT 별도) — 목록에서 주문 가능 판정(D16 게이트)용. */
  confirmedTotal: z.number().nullable(),
  /** 영카트 주문 전환 파생 상태(D16) — 저장 아님, ct/od 조인 파생. */
  orderState: z.enum(['none', 'cart', 'ordered']),
});
export type BomQuoteSummaryType = z.infer<typeof BomQuoteSummary>;

export const BomQuoteUsdRateMode = z.enum(['auto', 'manual']);
export type BomQuoteUsdRateModeType = z.infer<typeof BomQuoteUsdRateMode>;

export const BomQuoteUsdRateType = z.enum(['dealBasR', 'tts']);
export type BomQuoteUsdRateTypeType = z.infer<typeof BomQuoteUsdRateType>;

/** 견적 계산에 실제 적용한 환율의 출처·기준일 스냅샷. draft 재계산 중에는 갱신되고 RFQ 요청 후 동결된다. */
export const BomQuoteExchangeRateSnapshot = z.object({
  mode: BomQuoteUsdRateMode,
  source: z.enum(['koreaexim', 'manual']),
  rateType: z.enum(['dealBasR', 'tts', 'manual']),
  sourceRate: z.number().positive(),
  safetyMarginPercent: z.number().min(0).max(20),
  appliedRate: z.number().positive(),
  rateDate: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  stale: z.boolean(),
  /** auto 모드에서 수동값 또는 오래된 캐시를 쓴 경우의 축퇴 사유. */
  fallbackReason: z.enum(['manual-rate', 'stale-cache']).nullable(),
});
export type BomQuoteExchangeRateSnapshotType = z.infer<typeof BomQuoteExchangeRateSnapshot>;

export const BomQuoteDetail = BomQuoteSummary.extend({
  engineJobId: z.string().nullable(),
  /** 견적별 조달 정책. 새 업로드 기본은 sample이며 draft에서만 전환할 수 있다. */
  procurementMode: BomQuoteProcurementMode,
  /** 전체 시트 파싱→선택→선택 시트 계산의 서버 영속 단일 진실. */
  buildStatus: BomQuoteBuildStatus,
  sheets: z.array(BomQuoteSheet),
  /** 자동 보강 생명주기(서버 영속 단일 진실) — searching 동안 FE 는 "확인 중" UI + 폴링. */
  enrichStatus: z.enum(['idle', 'searching', 'done', 'failed']),
  /** 마지막 보강 반영(재매칭 저장) 시각. */
  enrichedAt: z.string().nullable(),
  /** 활성 공급사 검색에서 실제 호출 한도 때문에 일부 공급사 확인이 제한된 부품 수. */
  supplierSearchLimitedCount: z.number().int().nonnegative(),
  /** 호출 상한 안내를 정확히 표시하기 위한 활성 검색 실행의 compact 요약. */
  supplierSearchLimitSummary: z.object({
    affectedComponentCount: z.number().int().nonnegative(),
    jobCallLimitComponentCount: z.number().int().nonnegative(),
    supplierQuotaComponentCount: z.number().int().nonnegative(),
    actualApiCalls: z.number().int().nonnegative().nullable(),
    maxCalls: z.number().int().positive().nullable(),
  }).nullable(),
  /** 후보 비교·부품 변경 화면에서 사용할 부품 정보가 검색까지 가능한 상태인지 나타낸다. */
  partDataStatus: z.enum(['preparing', 'ready', 'failed']),
  /** 실패 시 사용자가 다시 준비할 수 있는지, 새 업로드가 필요한지를 구분한다. */
  partDataFailureReason: z.enum(['preparation-failed', 'result-gone']).nullable(),
  setQty: z.number().int().min(1),
  spareQty: z.number().int().min(0),
  /** 부품 합계(KRW, included 라인) — 서버 재계산 스냅샷. */
  itemsTotal: z.number(),
  /** 예상 운송료·관리비(sp_config 기본값 스냅샷, 확정 시 변동 가능). */
  shippingFee: z.number(),
  managementFee: z.number(),
  finalTotal: z.number(),
  /** 환산에 사용한 USD→KRW 환율(미설정 null). */
  usdKrwRateUsed: z.number().nullable(),
  /** 환율 출처·기준일·안전계수 감사 스냅샷(기존 견적은 null). */
  exchangeRateSnapshot: BomQuoteExchangeRateSnapshot.nullable(),
  /** included 인데 금액 미산정(구매 조건 없음·미환산) 라인 수. */
  uncostedCount: z.number().int(),
  customerMemo: z.string().nullable(),
  /** 관리자 확정 회신(answered 이후) — null 이면 미회신. */
  confirmedShippingFee: z.number().nullable(),
  confirmedManagementFee: z.number().nullable(),
  confirmedTotal: z.number().nullable(),
  /** 고객에게 보여줄 회신 메모(내부 adminMemo 와 분리). */
  answerNote: z.string().nullable(),
  items: z.array(BomQuoteItem),
});
export type BomQuoteDetailType = z.infer<typeof BomQuoteDetail>;

// ── 단일검색 견적 바구니 ─────────────────────────────────────────────────
// 브라우저 임시 카트가 아니라 기존 견적 draft를 사용한다. 클라이언트는 가격을 보내지 않고
// 카탈로그 부품·구매 조건 정체성만 보내며, sp-node가 현재 저장 구매 조건으로 수량과 금액을 계산한다.

export const BomSearchCartSelection = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('supplier_offer'),
    supplier: z.string().trim().min(1).max(32),
    supplierSku: z.string().max(191),
  }),
  z.object({ kind: z.literal('manufacturer_catalog') }),
]);
export type BomSearchCartSelectionType = z.infer<typeof BomSearchCartSelection>;

export const BomSearchCartAddBody = z.object({
  partId: z.string().regex(/^\d+$/),
  bomQty: z.number().int().min(1).max(1_000_000),
  selection: BomSearchCartSelection,
});
export type BomSearchCartAddBodyType = z.infer<typeof BomSearchCartAddBody>;

export const BomSearchCartItemPatchBody = z.object({
  bomQty: z.number().int().min(1).max(1_000_000),
});
export type BomSearchCartItemPatchBodyType = z.infer<typeof BomSearchCartItemPatchBody>;

/** 활성 draft가 아직 없으면 data=null. 첫 품목을 담을 때만 견적을 생성한다. */
export const BomSearchCartResponse = z.object({
  result: z.literal(true),
  data: BomQuoteDetail.nullable(),
});
export type BomSearchCartResponseType = z.infer<typeof BomSearchCartResponse>;

// ── 견적서 인쇄(§6.8) — 거버 EstimateSheet 관례 동형(A4·직인·window.print) ────
// 관리자=상태 무관(확정 전이면 "가안" 표시), 고객=회신 완료+확정가 등록 시만.
// 품목·합계는 서버 조립(server-single-truth) — 화면은 뿌리기만 한다.

export const BomQuotePrintItem = z.object({
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  qty: z.number().int(),
  /** 선정 구매 조건 KRW 단가 스냅샷 — 미선정·미환산이면 null('—' 표시). */
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
});
export type BomQuotePrintItemType = z.infer<typeof BomQuotePrintItem>;

export const BomQuotePrint = z.object({
  quoteId: z.string(),
  title: z.string(),
  requestedAt: z.string().nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
  customerName: z.string(),
  /** 발신처 — 영카트 기본환경설정 재사용(주문서 인쇄와 동일 스키마). */
  seller: AdminEstimateCompany,
  items: z.array(BomQuotePrintItem),
  /** 부품 합계(included, 서버 스냅샷 — 고객 화면과 동일 값). */
  itemsTotal: z.number(),
  /** 예상 수수료·합계(확정 전 가안 표시용). */
  estimatedShippingFee: z.number(),
  estimatedManagementFee: z.number(),
  estimatedTotal: z.number(),
  /** 확정 회신 — null 이면 가안(고객 라우트는 404). */
  confirmedShippingFee: z.number().nullable(),
  confirmedManagementFee: z.number().nullable(),
  confirmedTotal: z.number().nullable(),
  answerNote: z.string().nullable(),
});
export type BomQuotePrintType = z.infer<typeof BomQuotePrint>;

export const BomQuotePrintResponse = z.object({
  result: z.literal(true),
  data: BomQuotePrint,
});
export type BomQuotePrintResponseType = z.infer<typeof BomQuotePrintResponse>;

// 주문 전환(D16) — 확정 견적을 영카트 카트에 담고 주문서로 직행.
export const BomQuoteOrderResponse = z.object({
  result: z.literal(true),
  data: z.object({
    ctId: z.number().int(),
    /** 영카트 주문서 URL — 클라이언트는 이 주소로 전체 이동한다. */
    redirectUrl: z.string(),
  }),
});
export type BomQuoteOrderResponseType = z.infer<typeof BomQuoteOrderResponse>;

// 배치 주문(D17) — 여러 확정 견적을 한 주문으로(각 견적은 통째 1카트행 — D16-3 유지,
// 거버 /pcb-projects/order 미러). 실패 건은 failed 로 보고하고 가능한 건만 진행한다.
export const BomQuoteOrderBatchBody = z.object({
  ids: z.array(z.string().regex(/^\d+$/)).min(1).max(50),
});
export type BomQuoteOrderBatchBodyType = z.infer<typeof BomQuoteOrderBatchBody>;

export const BomQuoteOrderBatchFailed = z.object({
  quoteId: z.string(),
  error: z.string(), // NOT_FOUND|NOT_ANSWERED|NOT_CONFIRMED|ALREADY_ORDERED|…
});
export type BomQuoteOrderBatchFailedType = z.infer<typeof BomQuoteOrderBatchFailed>;

export const BomQuoteOrderBatchResponse = z.object({
  result: z.literal(true),
  data: z.object({
    orderedCtIds: z.array(z.number().int()),
    redirectUrl: z.string(),
    failed: z.array(BomQuoteOrderBatchFailed).optional(),
  }),
});
export type BomQuoteOrderBatchResponseType = z.infer<typeof BomQuoteOrderBatchResponse>;

export const BomQuoteOrderBatchError = z.object({
  result: z.literal(false),
  error: z.string(),
  failed: z.array(BomQuoteOrderBatchFailed).optional(),
});
export type BomQuoteOrderBatchErrorType = z.infer<typeof BomQuoteOrderBatchError>;

// ── 요청 바디 ──────────────────────────────────────────────────────────────

/** draft 자동저장(디바운스) — 안정 ID 행 부분 갱신. draft 상태에서만 허용. */
export const BomQuotePatchBody = z.object({
  title: z.string().trim().min(1).max(191).optional(),
  procurementMode: BomQuoteProcurementMode.optional(),
  setQty: z.number().int().min(1).max(100000).optional(),
  spareQty: z.number().int().min(0).max(100000).optional(),
  customerMemo: z.string().max(2000).nullable().optional(),
  items: z.array(BomQuoteItemEdit).max(2000).optional(),
});
export type BomQuotePatchBodyType = z.infer<typeof BomQuotePatchBody>;

/** 파싱 완료 후 실제 견적·공급사 검색에 포함할 시트. */
export const BomQuoteBuildBody = z.object({
  sheetIndexes: z
    .array(z.number().int().min(0))
    .min(1)
    .max(100)
    .refine((indexes) => new Set(indexes).size === indexes.length, '중복된 시트가 있습니다'),
});
export type BomQuoteBuildBodyType = z.infer<typeof BomQuoteBuildBody>;

/** 계산 완료 후 견적에 활성화할 기존 구성 시트 전체 목록. 원본 분석·후보 스냅샷은 보존한다. */
export const BomQuoteSheetSelectionBody = BomQuoteBuildBody;
export type BomQuoteSheetSelectionBodyType = z.infer<typeof BomQuoteSheetSelectionBody>;

/** 엔진 후보를 명시 선택. offerKey=null이면 해당 부품 안의 실효 총비용 최저 구매 조건. */
export const BomQuoteCandidateSelectionBody = z.object({
  candidateKey: z.string().min(1).max(64),
  offerKey: z.string().min(1).max(64).nullable(),
});
export type BomQuoteCandidateSelectionBodyType = z.infer<typeof BomQuoteCandidateSelectionBody>;

export const BomQuoteRequestBody = z.object({
  title: z.string().trim().min(1).max(191),
});
export type BomQuoteRequestBodyType = z.infer<typeof BomQuoteRequestBody>;

const BomQuoteIdString = z.string().regex(/^\d+$/);

/** 고객 목록의 일괄 삭제. 요청·검토·답변 등 확정 흐름에 들어간 견적은 서버가 보존한다. */
export const BomQuoteDeleteManyBody = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('selected'),
    quoteIds: z.array(BomQuoteIdString).min(1).max(200),
  }),
  z.object({ scope: z.literal('all') }),
]).superRefine((value, context) => {
  if (value.scope !== 'selected') return;
  if (new Set(value.quoteIds).size !== value.quoteIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'quoteIds must be unique', path: ['quoteIds'] });
  }
});
export type BomQuoteDeleteManyBodyType = z.infer<typeof BomQuoteDeleteManyBody>;

// ── 응답 ──────────────────────────────────────────────────────────────────

export const BomQuoteOkResponse = z.object({ result: z.literal(true) });
export type BomQuoteOkResponseType = z.infer<typeof BomQuoteOkResponse>;

export const BomQuoteDeleteManyResponse = z.object({
  result: z.literal(true),
  data: z.object({
    requestedCount: z.number().int().nonnegative(),
    deletedCount: z.number().int().nonnegative(),
    retainedCount: z.number().int().nonnegative(),
  }),
});
export type BomQuoteDeleteManyResponseType = z.infer<typeof BomQuoteDeleteManyResponse>;

export const BomQuoteCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ quoteId: z.string(), jobId: z.string() }),
});
export type BomQuoteCreateResponseType = z.infer<typeof BomQuoteCreateResponse>;

export const BomQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(BomQuoteSummary),
    total: z.number().int(),
    /** 전체 목록 중 고객이 즉시 삭제할 수 있는 작성 중·취소 견적 수. */
    deletableCount: z.number().int().nonnegative(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});
export type BomQuoteListResponseType = z.infer<typeof BomQuoteListResponse>;

export const BomQuoteDetailResponse = z.object({ result: z.literal(true), data: BomQuoteDetail });
export type BomQuoteDetailResponseType = z.infer<typeof BomQuoteDetailResponse>;

export const BomQuoteItemCandidatesResponse = z.object({ result: z.literal(true), data: BomQuoteItemCandidates });
export type BomQuoteItemCandidatesResponseType = z.infer<typeof BomQuoteItemCandidatesResponse>;

export const BomQuoteComparisonResponse = z.object({ result: z.literal(true), data: BomQuoteComparison });
export type BomQuoteComparisonResponseType = z.infer<typeof BomQuoteComparisonResponse>;

// ── 관리자 ────────────────────────────────────────────────────────────────

export const AdminBomQuoteSummary = BomQuoteSummary.extend({
  mbId: z.string(),
  /** 발주서 수(D18) — 진행현황의 "발주 전" 표시·타임라인 ⑧ 판정용 파생. */
  poCount: z.number().int(),
  /** 입고 확인된 발주서 수(D21) — 타임라인 ⑩(검수) 판정용 파생. */
  poReceivedCount: z.number().int(),
  /** 선적 중 다음 단계가 관리자 차례인 건 존재(D22) — 목록 "선적 처리 필요" 칩. */
  shipmentAdminPending: z.boolean(),
  /** 발송한 RFQ 수 — 견적관리 목록의 RFQ 실황(0=미발송 강조). */
  rfqTotal: z.number().int(),
  /** 회신 완료(quoted) RFQ 수 — "회신 m/n" 표시. */
  rfqReplied: z.number().int(),
});
export type AdminBomQuoteSummaryType = z.infer<typeof AdminBomQuoteSummary>;

/** 주문 헤더 파생(관리자 — ⑧ 결제 판정·주문 링크). 저장 아님, ct→od 조인 파생. */
export const AdminBomQuoteOrderInfo = z.object({
  odId: z.string(),
  odStatus: z.string(), // 영카트 od_status(주문|입금|준비|배송|완료|취소…)
  isPaid: z.boolean(), // od_status !== '주문'
  receiptPrice: z.number(),
  settleCase: z.string(), // 결제수단
});
export type AdminBomQuoteOrderInfoType = z.infer<typeof AdminBomQuoteOrderInfo>;

/** 엔진 판정과 분리된 관리자 업무 확인 상태. 행 내용이 바뀌면 서버가 stale로 무효화한다. */
export const AdminBomQuoteItemReview = z.object({
  required: z.boolean(),
  completed: z.boolean(),
  stale: z.boolean(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reason: z.string().nullable(),
});
export type AdminBomQuoteItemReviewType = z.infer<typeof AdminBomQuoteItemReview>;

export const AdminBomQuoteItem = BomQuoteItem.extend({
  adminReview: AdminBomQuoteItemReview,
});
export type AdminBomQuoteItemType = z.infer<typeof AdminBomQuoteItem>;

export const AdminBomQuoteDetail = BomQuoteDetail.omit({ items: true }).extend({
  items: z.array(AdminBomQuoteItem),
  mbId: z.string(),
  /** 내부 메모 — 고객 응답에는 싣지 않는다. */
  adminMemo: z.string().nullable(),
  /** 원본 파일 다운로드 URL(서명) — 없으면 null. */
  fileUrl: z.string().nullable(),
  /** 주문 헤더 파생 — 주문 전(카트 포함) null. */
  orderInfo: AdminBomQuoteOrderInfo.nullable(),
});
export type AdminBomQuoteDetailType = z.infer<typeof AdminBomQuoteDetail>;

// 진행현황(스마트 BOM 모듈) 요약 카드·탭 — 상태별 전체 분포(상태 필터 미반영).
export const AdminBomQuoteCounts = z.object({
  all: z.number().int(),
  draft: z.number().int(),
  requested: z.number().int(),
  reviewing: z.number().int(),
  answered: z.number().int(),
  closed: z.number().int(),
  canceled: z.number().int(),
  /** 관리자 차례 선적 수(D22, 전역 — 필터 미반영) — 메뉴 배지 소스. */
  shipmentPending: z.number().int(),
});
export type AdminBomQuoteCountsType = z.infer<typeof AdminBomQuoteCounts>;

export const AdminBomQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomQuoteSummary),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: AdminBomQuoteCounts,
  }),
});
export type AdminBomQuoteListResponseType = z.infer<typeof AdminBomQuoteListResponse>;

export const AdminBomQuoteDetailResponse = z.object({
  result: z.literal(true),
  data: AdminBomQuoteDetail,
});
export type AdminBomQuoteDetailResponseType = z.infer<typeof AdminBomQuoteDetailResponse>;

/** 관리자 검토 — 상태 전이(requested→reviewing→answered→closed)와 확정가 입력. */
export const AdminBomQuotePatchBody = z.object({
  status: BomQuoteStatus.optional(),
  adminMemo: z.string().max(4000).nullable().optional(),
  answerNote: z.string().max(4000).nullable().optional(),
  confirmedShippingFee: z.number().int().min(0).nullable().optional(),
  confirmedManagementFee: z.number().int().min(0).nullable().optional(),
  confirmedTotal: z.number().int().min(0).nullable().optional(),
});
export type AdminBomQuotePatchBodyType = z.infer<typeof AdminBomQuotePatchBody>;

/** 관리자 품목 확인/재검토. 확인 이력은 행의 현재 판정 지문과 함께 append-only 저장한다. */
export const AdminBomQuoteItemReviewsBody = z.object({
  itemIds: z.array(z.string().regex(/^\d+$/)).min(1).max(2000),
  completed: z.boolean(),
  expectedQuoteUpdatedAt: z.string().datetime(),
  reason: z.string().trim().max(500).nullable().optional(),
});
export type AdminBomQuoteItemReviewsBodyType = z.infer<typeof AdminBomQuoteItemReviewsBody>;

/**
 * 관리자 품목 교체 명령. 후보 선택은 견적 후보 스냅샷 키만 받고, 카탈로그 선택은
 * 영속 부품과 공급사 구매 조건의 정체성만 받는다. 가격·재고·합계는 서버가 다시 조회·계산한다.
 */
const AdminBomQuoteItemMutationGuard = z.object({
  expectedQuoteUpdatedAt: z.string().datetime(),
  /** RFQ·주문·PO·완료 상태의 영향까지 확인한 관리자 강제 변경. */
  force: z.boolean().default(false),
});

export const AdminBomQuoteItemCandidateSelection = BomQuoteCandidateSelectionBody.extend({
  kind: z.literal('candidate'),
  ...AdminBomQuoteItemMutationGuard.shape,
}).strict();

export const AdminBomQuoteCatalogOfferIdentity = z.object({
  supplier: z.string().trim().min(1).max(32),
  supplierSku: z.string().max(191),
}).strict();

export const AdminBomQuoteItemCatalogSelection = z.object({
  kind: z.literal('catalog'),
  partId: z.string().regex(/^\d+$/),
  offer: AdminBomQuoteCatalogOfferIdentity.nullable(),
  ...AdminBomQuoteItemMutationGuard.shape,
}).strict();

export const AdminBomQuoteItemSelectionBody = z.discriminatedUnion('kind', [
  AdminBomQuoteItemCandidateSelection,
  AdminBomQuoteItemCatalogSelection,
]);
export type AdminBomQuoteItemSelectionBodyType = z.infer<typeof AdminBomQuoteItemSelectionBody>;

/** 관리자 카탈로그 수동 행 추가. 서버가 part/offer를 재조회하고 MOQ·주문배수·합계를 계산한다. */
export const AdminBomQuoteItemAddBody = z.object({
  partId: z.string().regex(/^\d+$/),
  offer: AdminBomQuoteCatalogOfferIdentity.nullable(),
  /** 세트당 BOM 수량. 실제 필요수량은 견적의 세트·예비 수량을 서버가 적용한다. */
  bomQty: z.number().int().min(1).max(100000),
  ...AdminBomQuoteItemMutationGuard.shape,
}).strict();
export type AdminBomQuoteItemAddBodyType = z.infer<typeof AdminBomQuoteItemAddBody>;

/** 관리자 수동 추가 행 제거. 업로드 원본 행에는 적용할 수 없다. */
export const AdminBomQuoteItemRemoveBody = AdminBomQuoteItemMutationGuard.strict();
export type AdminBomQuoteItemRemoveBodyType = z.infer<typeof AdminBomQuoteItemRemoveBody>;

// ── 관리자 Case 영구 삭제 ─────────────────────────────────────────────────

/** audited=최소 삭제 감사기록 보존, reset=업무 DB에 삭제 감사기록을 남기지 않는 초기화. */
export const AdminBomCaseDeleteMode = z.enum(['audited', 'reset']);
export type AdminBomCaseDeleteModeType = z.infer<typeof AdminBomCaseDeleteMode>;

/** 견적 상태보다 우선하는 거래·관계 무결성 차단. 강제 삭제도 타 데이터 경계는 넘지 않는다. */
export const AdminBomCaseDeleteBlocker = z.enum([
  'PAID_ORDER',
  'SHARED_ORDER',
  'ORDER_LINK_INCONSISTENT',
  'ENGINE_JOB_IN_PROGRESS',
  'SHIPMENT_LINK_INCONSISTENT',
]);
export type AdminBomCaseDeleteBlockerType = z.infer<typeof AdminBomCaseDeleteBlocker>;

/** 시스템 밖에서 이미 발생한 행위와 공유 데이터 보존을 1차 경고 레이어에 표시한다. */
export const AdminBomCaseDeleteWarning = z.enum([
  'SENT_EMAILS_REMAIN',
  'EXTERNAL_ACTIONS_REMAIN',
  'SHARED_SHIPMENT_PRESERVED',
  'UNPAID_ORDER_DELETED',
  'PAID_ORDER_PERMANENTLY_DELETED',
  'SHIPMENT_HISTORY_PERMANENTLY_DELETED',
  'FILES_PERMANENTLY_DELETED',
]);
export type AdminBomCaseDeleteWarningType = z.infer<typeof AdminBomCaseDeleteWarning>;

export const AdminBomCaseDeleteImpact = z.object({
  quoteItems: z.number().int().nonnegative(),
  quoteSheets: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  selectionEvents: z.number().int().nonnegative(),
  analysisRecords: z.number().int().nonnegative(),
  supplierSearchRecords: z.number().int().nonnegative(),
  engineJobs: z.number().int().nonnegative(),
  rfqs: z.number().int().nonnegative(),
  rfqItems: z.number().int().nonnegative(),
  pos: z.number().int().nonnegative(),
  poItems: z.number().int().nonnegative(),
  quoteFiles: z.number().int().nonnegative(),
  shipments: z.number().int().nonnegative(),
  shipmentFiles: z.number().int().nonnegative(),
  shipmentItems: z.number().int().nonnegative(),
  shipmentPackages: z.number().int().nonnegative(),
  shipmentPackageEvents: z.number().int().nonnegative(),
});
export type AdminBomCaseDeleteImpactType = z.infer<typeof AdminBomCaseDeleteImpact>;

export const AdminBomCaseDeletePreview = z.object({
  case: z.object({
    id: z.string(),
    caseNo: z.string(),
    title: z.string(),
    mbId: z.string(),
    status: BomQuoteStatus,
    createdAt: z.string().datetime(),
    requestedAt: z.string().datetime().nullable(),
  }),
  impact: AdminBomCaseDeleteImpact,
  order: z.object({
    state: z.enum(['none', 'cart', 'ordered']),
    action: z.enum(['none', 'remove-cart-row', 'delete-unpaid-order', 'delete-paid-order']),
    odId: z.string().nullable(),
    odStatus: z.string().nullable(),
    /** 상태 전이뿐 아니라 수납액·포인트/쿠폰·PG 거래번호 흔적까지 포함한 삭제 보호 판정. */
    paymentProtected: z.boolean(),
    siblingCount: z.number().int().nonnegative(),
    /** 주문 헤더·cart 외 od_id로 직접 연결된 쿠폰/PG/포인트/주문 보조 원장 수. */
    relatedRecords: z.number().int().nonnegative(),
  }),
  shipment: z.object({
    total: z.number().int().nonnegative(),
    shared: z.number().int().nonnegative(),
    willDelete: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
  }),
  sentRfqCount: z.number().int().nonnegative(),
  externalPoCount: z.number().int().nonnegative(),
  canDelete: z.boolean(),
  blockers: z.array(AdminBomCaseDeleteBlocker),
  warnings: z.array(AdminBomCaseDeleteWarning),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AdminBomCaseDeletePreviewType = z.infer<typeof AdminBomCaseDeletePreview>;

export const AdminBomCaseDeletePreviewResponse = z.object({
  result: z.literal(true),
  data: AdminBomCaseDeletePreview,
});
export type AdminBomCaseDeletePreviewResponseType = z.infer<
  typeof AdminBomCaseDeletePreviewResponse
>;

const AdminBomCaseDeleteExecutionBase = z.object({
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeIrreversible: z.literal(true),
  /** PAID_ORDER 차단만 명시적으로 해제한다. 공유 주문·연결 불일치는 우회하지 않는다. */
  forceDeletePaidOrder: z.boolean().optional(),
});

export const AdminBomCaseDeleteBody = z.discriminatedUnion('mode', [
  AdminBomCaseDeleteExecutionBase.extend({
    mode: z.literal('audited'),
    reason: z.string().trim().min(2).max(1000),
  }),
  AdminBomCaseDeleteExecutionBase.extend({ mode: z.literal('reset') }),
]);
export type AdminBomCaseDeleteBodyType = z.infer<typeof AdminBomCaseDeleteBody>;

export const AdminBomCaseDeleteResponse = z.object({
  result: z.literal(true),
  data: z.object({
    caseId: z.string(),
    mode: AdminBomCaseDeleteMode,
    deleted: AdminBomCaseDeleteImpact,
    cartRemoved: z.boolean(),
    orderDeleted: z.boolean(),
    paidOrderDeleted: z.boolean(),
    shipmentMembershipsDetached: z.number().int().nonnegative(),
    shipmentsDeleted: z.number().int().nonnegative(),
    engineJobsDeleted: z.number().int().nonnegative(),
    filesDeleted: z.number().int().nonnegative(),
    auditRetained: z.boolean(),
  }),
});
export type AdminBomCaseDeleteResponseType = z.infer<typeof AdminBomCaseDeleteResponse>;

// ── 설정(sp_config bom_quote — 관리자 편집) ────────────────────────────────

export const BomQuoteConfig = z.object({
  /** 예상 운송료 기본값(KRW) — 레거시 하드코딩 30000 의 승격. */
  defaultShippingFee: z.number().int().min(0),
  /** 예상 관리비 기본값(KRW) — 레거시 하드코딩 25000 의 승격. */
  defaultManagementFee: z.number().int().min(0),
  /** 자동 환율 장애 시 폴백하거나 manual 모드에서 적용할 USD→KRW 환율. */
  usdKrwRate: z.number().positive().nullable(),
  /** auto=수출입은행 캐시 우선, manual=관리자 입력값 고정. 기존 설정은 auto로 승격. */
  usdKrwRateMode: BomQuoteUsdRateMode,
  /** 수출입은행 매매기준율(dealBasR) 또는 송금 보낼 때 환율(tts). */
  usdKrwAutoRateType: BomQuoteUsdRateType,
  /** 외화 결제 시점 변동·수수료를 흡수할 자동 환율 안전계수(%). */
  usdKrwSafetyMarginPercent: z.number().min(0).max(20),
  /** 이 기간을 넘긴 자동 환율은 오래된 캐시로 표시(수동값이 있으면 수동 폴백 우선). */
  usdKrwMaxAgeDays: z.number().int().min(1).max(30),
  /** 공급사 검색 1회 최대 외부 호출 수(엔진 max_calls 상한, 엔진 스키마 최대 3000). */
  supplierSearchMaxCalls: z.number().int().min(1).max(3000),
  /** 회원별 1일 공급사 검색 횟수 제한. */
  memberDailySearchLimit: z.number().int().min(1).max(1000),
  /** 구매 조건 데이터 신선 임계(시간) — 초과 라인이 있으면 업로드 시 자동 보강 트리거. */
  freshnessHours: z.number().int().min(1).max(720),
  /** MPN 없는 R/C를 저장된 공급사 부품에서 값·패키지로 우선 검색하는 실험 기능. */
  storedPartPrioritySearchEnabled: z.boolean(),
});
export type BomQuoteConfigType = z.infer<typeof BomQuoteConfig>;

export const BomQuoteExchangeRateStatus = z.object({
  apiConfigured: z.boolean(),
  cache: z.object({
    rateDate: z.string(),
    dealBasR: z.number().positive(),
    tts: z.number().positive(),
    fetchedAt: z.string(),
  }).nullable(),
  effective: BomQuoteExchangeRateSnapshot.nullable(),
  lastRefreshError: z.string().nullable(),
});
export type BomQuoteExchangeRateStatusType = z.infer<typeof BomQuoteExchangeRateStatus>;

export const BomSupplierSearchOperations = z.object({
  configuredMaxCalls: z.number().int().positive(),
  effectiveMaxCalls: z.number().int().positive().nullable(),
  engine: z.object({
    available: z.boolean(),
    maxCallsPerJob: z.number().int().positive().nullable(),
    error: z.string().nullable(),
    suppliers: z.array(z.object({
      supplier: z.enum(['digikey', 'mouser', 'unikeyic']),
      configured: z.boolean(),
    })),
    cache: z.object({
      mode: z.enum(['normal', 'only']),
      entryCount: z.number().int().nonnegative(),
      rawTtlSeconds: z.number().int().nonnegative(),
      keywordTtlSeconds: z.number().int().nonnegative(),
      staleTtlSeconds: z.number().int().nonnegative(),
      staleIfError: z.boolean(),
    }).nullable(),
  }),
  todayUsage: z.object({
    dayKey: z.string(),
    totalSearches: z.number().int().nonnegative(),
    memberCount: z.number().int().nonnegative(),
    maxMemberSearches: z.number().int().nonnegative(),
  }),
  recentRuns: z.array(z.object({
    id: z.string(),
    quoteId: z.string(),
    quoteTitle: z.string(),
    memberId: z.string(),
    status: z.string(),
    componentCount: z.number().int().nonnegative().nullable(),
    estimatedApiCalls: z.number().int().nonnegative().nullable(),
    actualApiCalls: z.number().int().nonnegative().nullable(),
    cacheHits: z.number().int().nonnegative().nullable(),
    maxCalls: z.number().int().positive().nullable(),
    budgetExhaustedCount: z.number().int().nonnegative().nullable(),
    elapsedMs: z.number().nonnegative().nullable(),
    engineElapsedMs: z.number().nonnegative().nullable(),
    quoteApplyMs: z.number().nonnegative().nullable(),
    wallElapsedMs: z.number().nonnegative().nullable(),
    catalogStatus: z.enum(['queued', 'running', 'completed', 'failed']).nullable(),
    catalogElapsedMs: z.number().nonnegative().nullable(),
    catalogDbElapsedMs: z.number().nonnegative().nullable(),
    catalogIndexElapsedMs: z.number().nonnegative().nullable(),
    catalogQueued: z.number().int().nonnegative().nullable(),
    catalogReused: z.boolean().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })),
});
export type BomSupplierSearchOperationsType = z.infer<typeof BomSupplierSearchOperations>;

export const BomQuoteConfigResponse = z.object({
  result: z.literal(true),
  data: BomQuoteConfig,
  exchangeRate: BomQuoteExchangeRateStatus,
  supplierSearch: BomSupplierSearchOperations,
});
export type BomQuoteConfigResponseType = z.infer<typeof BomQuoteConfigResponse>;

export const BomQuoteExchangeRateRefreshResponse = BomQuoteConfigResponse;
export type BomQuoteExchangeRateRefreshResponseType = z.infer<typeof BomQuoteExchangeRateRefreshResponse>;
