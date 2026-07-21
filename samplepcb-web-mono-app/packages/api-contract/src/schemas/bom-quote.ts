import { z } from 'zod';

// 고객 BOM 견적(스마트 BOM) — 업로드→파싱→매칭→검토→견적요청(RFQ) 계약.
// 설계: docs/BOM_QUOTE.md. 수량·금액의 단일 진실은 저장된 orderQty·selectedOffer
// 스냅샷이며(레거시 '박제' 원칙 보존), 합계는 항상 서버가 재계산한다(클라 금액 불신).

export const BomQuoteStatus = z.enum(['draft', 'requested', 'reviewing', 'answered', 'closed', 'canceled']);
export type BomQuoteStatusType = z.infer<typeof BomQuoteStatus>;

export const BomQuoteMatchStatus = z.enum(['auto', 'manual', 'none']);
export type BomQuoteMatchStatusType = z.infer<typeof BomQuoteMatchStatus>;

export const BomQuoteSelectionSource = z.enum(['none', 'auto', 'customer', 'catalog', 'admin', 'legacy']);
export type BomQuoteSelectionSourceType = z.infer<typeof BomQuoteSelectionSource>;

export const BomQuoteSelectionApplicationState = z.enum([
  'automatic_selected',
  'provisional_selected',
  'not_selected',
]);
export type BomQuoteSelectionApplicationStateType = z.infer<typeof BomQuoteSelectionApplicationState>;

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
  'catalog-choice',
  'offer-choice',
  'engine-procurement-recommendation',
  'engine-manual-review',
  'engine-technical-fallback',
  'engine-procurement-unavailable',
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
  /** 가격·재고와 무관한 엔진 기술 사전 선정 후보. 기존 견적은 생략될 수 있다. */
  technicalPreselectionCandidateKey: z.string().nullable().optional(),
  /** 기술 사전 선정 후보가 구매 불가해 다음 기술 후보를 적용했는지 여부. */
  technicalFallbackUsed: z.boolean().optional(),
  /** 품번 검색에서 신뢰 후보가 없어 엔진이 확정 스펙 검색으로 전환했는지 여부. */
  identityFallback: z.boolean(),
  candidateStatus: z.string().nullable(),
  selectionMode: z.enum(['exact', 'variant', 'spec-compatible', 'review', 'unmatched']),
  candidateCount: z.number().int().min(0),
  eligibleCandidateCount: z.number().int().min(0),
  selectedMpn: z.string().nullable(),
  selectedManufacturer: z.string().nullable(),
  selectedSupplier: z.string().nullable(),
  selectedSupplierSku: z.string().nullable(),
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
  failureReason: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type BomQuoteSheetType = z.infer<typeof BomQuoteSheet>;

/** 라인에 박제되는 오퍼 스냅샷 — 견적요청 후 재선정하지 않는다(시점 고정). */
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
  /** 사용자가 명시 선택(고정) — 수량 변경 시 이 오퍼 안에서만 구간 재계산. */
  pinned: z.boolean(),
});
export type BomQuoteSelectedOfferType = z.infer<typeof BomQuoteSelectedOffer>;

export const BomQuoteCandidateSafety = z.enum(['safe', 'caution', 'blocked']);
export type BomQuoteCandidateSafetyType = z.infer<typeof BomQuoteCandidateSafety>;

export const BomQuoteCandidateSelectionEligibility = z.enum(['automatic', 'manual_review', 'blocked']);
export type BomQuoteCandidateSelectionEligibilityType = z.infer<typeof BomQuoteCandidateSelectionEligibility>;

export const BomQuoteCandidateSelectionRecommendation = z.enum(['preselect', 'candidate_only', 'exclude']);
export type BomQuoteCandidateSelectionRecommendationType = z.infer<typeof BomQuoteCandidateSelectionRecommendation>;

export const BomQuoteCandidateOfferApplied = z.object({
  orderQty: z.number().int().min(1),
  breakQty: z.number().int().min(1),
  unitPrice: z.number(),
  currency: z.string(),
  unitPriceKrw: z.number().nullable(),
  lineTotalKrw: z.number().nullable(),
  stockShort: z.boolean(),
});

/** 견적 후보에 박제된 공급사 오퍼와 현재 필요수량 기준 계산 결과. */
export const BomQuoteCandidateOffer = z.object({
  offerKey: z.string(),
  supplier: z.string(),
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

/** 공급사 행을 제조사+MPN으로 통합한 고객 선택 단위. */
export const BomQuoteCandidate = z.object({
  candidateKey: z.string(),
  technicalRank: z.number().int().min(1),
  /** 엔진이 manual_review 기술 근거 그룹에만 부여한 검토 순위. */
  technicalReviewRank: z.number().int().min(1).nullable(),
  /** 엔진이 지정한 기술 후보군 사전 선정 상태. 기존 스냅샷은 null. */
  selectionRecommendation: BomQuoteCandidateSelectionRecommendation.nullable(),
  reviewRecommended: z.boolean(),
  /** 대표 오퍼의 엔진 가격 순위. 후보 간 독자 재정렬에는 사용하지 않는다. */
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
  identityConfidence: true,
  specificationConfidence: true,
  conflicts: true,
  missingRequirements: true,
  reasons: true,
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
  decisionReasonCodes: z.array(BomQuoteDecisionReason),
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
});
export type BomQuoteItemType = z.infer<typeof BomQuoteItem>;

/** 고객이 카탈로그에서 명시적으로 선택한 부품·오퍼. 엔진 원본/판정과 분리된 사용자 명령이다. */
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
  /** 전체 시트 파싱→선택→선택 시트 계산의 서버 영속 단일 진실. */
  buildStatus: BomQuoteBuildStatus,
  sheets: z.array(BomQuoteSheet),
  /** 자동 보강 생명주기(서버 영속 단일 진실) — searching 동안 FE 는 "확인 중" UI + 폴링. */
  enrichStatus: z.enum(['idle', 'searching', 'done', 'failed']),
  /** 마지막 보강 반영(재매칭 저장) 시각. */
  enrichedAt: z.string().nullable(),
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
  /** included 인데 금액 미산정(오퍼 없음·미환산) 라인 수. */
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

// ── 요청 바디 ──────────────────────────────────────────────────────────────

/** draft 자동저장(디바운스) — 안정 ID 행 부분 갱신. draft 상태에서만 허용. */
export const BomQuotePatchBody = z.object({
  title: z.string().trim().min(1).max(191).optional(),
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

/** 엔진 후보를 명시 선택. offerKey=null이면 해당 부품 안의 실효 총비용 최저 오퍼. */
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
    /** 전체 목록 중 고객이 즉시 삭제할 수 있는 draft 견적 수. */
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
});
export type AdminBomQuoteSummaryType = z.infer<typeof AdminBomQuoteSummary>;

export const AdminBomQuoteDetail = BomQuoteDetail.extend({
  mbId: z.string(),
  /** 내부 메모 — 고객 응답에는 싣지 않는다. */
  adminMemo: z.string().nullable(),
  /** 원본 파일 다운로드 URL(서명) — 없으면 null. */
  fileUrl: z.string().nullable(),
});
export type AdminBomQuoteDetailType = z.infer<typeof AdminBomQuoteDetail>;

export const AdminBomQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomQuoteSummary),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
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
  /** 공급사 검색 1회 최대 외부 호출 수(엔진 max_calls 상한, 엔진 스키마 최대 1000). */
  supplierSearchMaxCalls: z.number().int().min(1).max(1000),
  /** 회원별 1일 공급사 검색 횟수 제한. */
  memberDailySearchLimit: z.number().int().min(1).max(1000),
  /** 오퍼 데이터 신선 임계(시간) — 초과 라인이 있으면 업로드 시 자동 보강 트리거. */
  freshnessHours: z.number().int().min(1).max(720),
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
