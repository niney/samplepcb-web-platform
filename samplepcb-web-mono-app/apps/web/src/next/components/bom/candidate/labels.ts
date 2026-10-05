import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteDecisionReasonType,
  BomQuoteLifecycleCodeType,
  BomQuoteLocalCatalogTraceType,
  BomQuoteRequirementAssessmentType,
} from '@sp/api-contract';
import type { ExtractionCertainty, ExtractionDisplayField } from '@/bom/extraction-display';
import { lifecycleSummaryTitle, replacementSourcesTitle } from '@/bom/lifecycle-presentation';
import type { CandidateTone } from './types';

// 후보 서랍의 순수 문구·판정 사전 — 옛 BomCandidateDrawer 의 함수를 그대로 옮기고, 색 클래스를 돌려주던
// 함수는 뜻(CandidateTone)을 돌려주게 바꿨다(Badge·Alert·Panel 변형이 색을 정한다).

type LocalCatalogDecisionSummary = NonNullable<BomQuoteLocalCatalogTraceType['decisionSummary']>;
type LocalCatalogReasonCount = LocalCatalogDecisionSummary['reasonCounts'][number];
export type LocalCatalogRepresentativeCandidate = NonNullable<LocalCatalogDecisionSummary['representativeCandidate']>;

export function traceElapsedLabel(elapsedMs: number): string {
  return elapsedMs < 1000
    ? `${Math.round(elapsedMs).toLocaleString('ko-KR')}ms`
    : `${(elapsedMs / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}s`;
}

export function localCatalogOutcomeLabel(trace: BomQuoteLocalCatalogTraceType): string {
  switch (trace.outcome) {
    case 'selected':
      return `${String(trace.selectedCandidateCount)}개 선정`;
    case 'no_candidates':
      return '사용 가능 후보 없음';
    case 'rejected':
      return '엔진 판정 미선정';
    case 'skipped':
      return '조회 생략';
    case 'error':
      return '조회 오류';
  }
}

export function localCatalogOutcomeTone(trace: BomQuoteLocalCatalogTraceType): 'success' | 'warning' | 'destructive' {
  switch (trace.outcome) {
    case 'selected':
      return 'success';
    case 'no_candidates':
    case 'rejected':
    case 'skipped':
      return 'warning';
    case 'error':
      return 'destructive';
  }
}

export function localCatalogTitle(trace: BomQuoteLocalCatalogTraceType): string {
  if (trace.catalogType === 'ingested_rc') return '저장된 부품 우선 검색';
  return trace.catalogType === 'connector' ? '커넥터 자체 카탈로그' : 'SamplePCB R/C 자체 카탈로그';
}

export function requirementLabel(code: string): string {
  const labels: Record<string, string> = {
    mount_style: '실장 방식',
    package: '패키지',
    diameter_mm: '직경',
    capacitance_f: '정전용량',
    voltage_v: '정격전압',
    tolerance_percent: '허용오차',
    dielectric: '유전체',
    resistance_ohm: '저항값',
    power_w: '정격전력',
    inductance_h: '인덕턴스',
    impedance_ohm: '임피던스',
    impedance_frequency_hz: '임피던스 기준 주파수',
    current_a: '정격전류',
    frequency_hz: '주파수',
    color: '발광색',
    pin_count: '핀 수',
    row_count: '열 수',
    pitch_mm: '피치',
    part_type: '부품 유형',
    manufacturer: '제조사',
    part_number: '품번',
  };
  return labels[code] ?? code;
}

export function conflictLabel(code: string): string {
  if (code.endsWith('_mismatch')) return `${requirementLabel(code.slice(0, -'_mismatch'.length))} 불일치`;
  if (code.endsWith('_source_conflict')) {
    return `${requirementLabel(code.slice(0, -'_source_conflict'.length))} 공급사 정보 충돌`;
  }
  return requirementLabel(code);
}

export function localCatalogUnavailabilityLabel(reason: string | null): string | null {
  if (reason === null) return null;
  const labels: Record<string, string> = {
    out_of_stock: '재고 없음',
    insufficient_stock: '재고 부족',
    stock_unverified: '재고 미확인',
    catalog_inquiry: '재고·가격 문의 필요',
    price_unavailable: '가격 미확인',
    technical_unavailable: '기술 조건 미충족',
    supplier_unavailable: '허용 공급사 구매 조건 없음',
    no_offer: '구매 조건 없음',
    input_incomplete: '입력 정보 부족',
    other: '구매 조건 미충족',
  };
  return labels[reason] ?? reason;
}

export function localCatalogReasonLabel(trace: BomQuoteLocalCatalogTraceType): string | null {
  const reason = trace.reason;
  if (reason === null) return null;
  if (reason === 'engine_not_selected' && trace.decisionSummary !== null) {
    const summary = trace.decisionSummary;
    const finalCandidateCount = summary.automaticCandidateCount
      + summary.reviewCandidateCount
      + summary.blockedCandidateCount
      + summary.unclassifiedCandidateCount;
    if (summary.automaticCandidateCount > 0) {
      const cause = localCatalogUnavailabilityLabel(summary.primaryUnavailabilityReason);
      return `기술 자동선정 가능 후보 ${summary.automaticCandidateCount.toLocaleString('ko-KR')}개가 있었지만 ${cause ?? '구매 조건 판정'} 때문에 자체 카탈로그에서 선정하지 않았습니다.`;
    }
    if (finalCandidateCount > 0) {
      const results = [
        summary.reviewCandidateCount > 0 ? `검토 필요 ${summary.reviewCandidateCount.toLocaleString('ko-KR')}개` : null,
        summary.blockedCandidateCount > 0 ? `선정 제외 ${summary.blockedCandidateCount.toLocaleString('ko-KR')}개` : null,
        summary.unclassifiedCandidateCount > 0
          ? `상세 판정 없음 ${summary.unclassifiedCandidateCount.toLocaleString('ko-KR')}개`
          : null,
      ].filter((value): value is string => value !== null);
      return `저장된 후보 ${trace.evaluatedCandidateCount.toLocaleString('ko-KR')}개를 엔진이 최종 ${finalCandidateCount.toLocaleString('ko-KR')}개로 정리했으며, ${results.join(' · ')}로 판정돼 자동선정하지 않았습니다.`;
    }
  }
  const reasons: Record<string, string> = {
    multiple_query_plans: '입력 충돌로 검색 계획이 여러 개여서 저장된 부품 조회를 생략했습니다.',
    query_not_eligible: '자체 카탈로그 조회에 필요한 조건이 부족하거나 검색 제외 상태입니다.',
    catalog_candidates_not_found: '자체 카탈로그에서 일치 후보를 찾지 못했습니다.',
    catalog_products_unavailable: '저장된 후보를 엔진 판정 입력으로 만들 수 없습니다.',
    minimum_requirements_matched: '저장된 부품 중 값과 패키지가 일치해 외부 공급사 호출을 생략했습니다.',
    engine_not_selected: '후보는 찾았지만 엔진 자동선정 조건을 통과하지 못했습니다.',
    evaluation_result_missing: '엔진 판정 결과에서 이 부품을 확인할 수 없습니다.',
    lookup_failed: '자체 카탈로그 조회 또는 엔진 판정에 실패했습니다.',
    quote_apply_failed: '저장된 부품 선정 결과를 견적에 반영하지 못해 외부 검색으로 전환했습니다.',
  };
  return reasons[reason] ?? reason;
}

export function localCatalogDecisionStatusLabel(status: string | null): string {
  if (status === null) return '판정 정보 없음';
  const labels: Record<string, string> = {
    automatic_recommended: '자동선정 권장',
    catalog_selected: '카탈로그 선정',
    review_recommended: '검토 권장',
    no_recommendation: '추천 없음',
    input_incomplete: '입력 보완 필요',
  };
  return labels[status] ?? status;
}

export function localCatalogDecisionCodeLabel(code: string): string {
  const [prefix, detail] = code.split(':', 2);
  if (detail !== undefined) {
    if (prefix === 'conflict') return conflictLabel(detail);
    if (prefix === 'missing') return `${requirementLabel(detail)} 미확인`;
    if (prefix === 'category_coverage_missing') return `${requirementLabel(detail)} 유형 필수조건 미확인`;
    if (prefix === 'policy_default') return `${requirementLabel(detail)} 정책 기본값 적용`;
    if (prefix === 'replacement_source') return `대체품 출처: ${detail}`;
  }
  const labels: Record<string, string> = {
    identity_exact: '품번 정확 일치',
    identity_variant: '품번 변형 일치',
    specification_compatible: '사양 호환',
    relationship_unresolved: '원본과 동일 부품 관계 미확인',
    manufacturer_confirmation_required: '제조사 확인 필요',
    identity_exact_requirement_conflict: '품번 일치지만 요구 사양 충돌',
    manufacturer_inferred: '제조사 추정',
    verification_incomplete: '필수조건 검증 미완료',
    strict_category_coverage_incomplete: '부품 유형 필수조건 미완료',
    category_manual_selection_only: '유형 정책상 수동 검토',
    lifecycle_caution: '라이프사이클 주의',
    supplier_suggested_replacement: '공급사 제안 대체품',
    replacement_manual_confirmation_required: '대체품 수동 확인 필요',
    manual_review_required: '수동 검토 필요',
    technical_selection_blocked: '기술 선정 차단',
    technical_preselection_unavailable: '기술 사전선정 후보 없음',
    technical_preselection_preserved: '기술 1순위 유지',
    technical_preselection_unpurchasable: '기술 1순위 구매 조건 미충족',
    technical_preselection_excessive_order: '기술 1순위 주문수량 과다',
    next_purchasable_technical_group_selected: '구매 가능한 차순위 기술 후보 적용',
    no_purchasable_candidate_group: '구매 가능한 후보군 없음',
    equivalent_group_lower_effective_total_selected: '동급 후보 중 실효 총액 최저 적용',
    best_effective_total_in_equivalent_group: '동급 후보 중 실효 총액 최저',
    best_purchase_fit_in_technical_group: '기술 후보군 내 구매 조건 최적',
    best_purchase_fit_in_fallback_group: '차순위 후보군 내 구매 조건 최적',
    manufacturer_catalog_candidate_selected: '제조사 카탈로그 후보 선정',
    stock_confirmation_required: '재고 확인 필요',
    price_inquiry_required: '가격 문의 필요',
    automatic_candidate: '자동선정 가능 후보',
  };
  return labels[code] ?? code;
}

export function localCatalogReasonCountLabel(reason: LocalCatalogReasonCount): string {
  if (reason.kind === 'conflict') return conflictLabel(reason.code);
  if (reason.kind === 'missing_requirement') return `${requirementLabel(reason.code)} 미확인`;
  return localCatalogDecisionCodeLabel(reason.code);
}

export function localCatalogEligibilityLabel(
  eligibility: LocalCatalogRepresentativeCandidate['selectionEligibility'],
): string {
  if (eligibility === 'automatic') return '자동선정 가능';
  if (eligibility === 'manual_review') return '검토 필요';
  if (eligibility === 'blocked') return '선정 제외';
  return '판정 정보 없음';
}

export function localCatalogEligibilityTone(
  eligibility: LocalCatalogRepresentativeCandidate['selectionEligibility'],
): CandidateTone {
  if (eligibility === 'automatic') return 'success';
  if (eligibility === 'manual_review') return 'warning';
  if (eligibility === 'blocked') return 'danger';
  return 'secondary';
}

export function localCatalogAttentionAssessments(
  candidate: LocalCatalogRepresentativeCandidate,
): LocalCatalogRepresentativeCandidate['requirementAssessments'] {
  return candidate.requirementAssessments
    .filter((assessment) =>
      assessment.state === 'mismatch' || assessment.state === 'missing' || assessment.state === 'unverified')
    .slice(0, 8);
}

export function formatOriginalRows(rows: number[], compact: boolean): string {
  if (rows.length === 0) return '';
  if (!compact || rows.length <= 4) return `${rows.join(', ')}행`;
  return `${rows.slice(0, 4).join(', ')}행 외 ${String(rows.length - 4)}개`;
}

export function extractedFieldTitle(field: ExtractionDisplayField): string {
  return [
    field.value,
    field.normalizedValue === null ? null : `정규화 ${field.normalizedValue}`,
    field.evidenceCells.length === 0 ? null : `근거 ${field.evidenceCells.join(', ')}`,
  ].filter((value): value is string => value !== null).join(' · ');
}

export function comparableSpec(value: string): string {
  return value.toLocaleLowerCase('en-US').replaceAll(/\s+/g, '').replaceAll('μ', 'µ');
}

/** 추출값 확신도 — 확인(초록)·추론(주의)·검토(문제)·미상(중립). */
export function certaintyTone(certainty: ExtractionCertainty | undefined): CandidateTone {
  if (certainty === 'verified') return 'success';
  if (certainty === 'inferred') return 'warning';
  if (certainty === 'review') return 'danger';
  return 'secondary';
}

export function certaintyMark(certainty: ExtractionCertainty | undefined): string {
  if (certainty === 'verified') return '✓';
  if (certainty === 'inferred') return '≈';
  if (certainty === 'review') return '!';
  return '?';
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    verified_exact: '정확 일치',
    verified_variant: '검증 변형',
    spec_compatible: '스펙 호환',
    spec_partial: '스펙 일부',
    input_conflict: '입력 충돌',
    ambiguous: '모호함',
    not_found: '미검색',
    supplier_error: '공급사 오류',
    insufficient_input: '정보 부족',
  };
  return labels[status] ?? status;
}

export function reasonLabel(reason: BomQuoteDecisionReasonType): string {
  const labels: Record<BomQuoteDecisionReasonType, string> = {
    'identity-exact': '원본 품번 정확 일치',
    'identity-variant': '검증된 품번 변형',
    'technical-top': '기술 검증 1순위',
    'same-part-lowest-total': '동일 부품 내 실효 총액 최저',
    'strict-spec-price-saving': '동급 안전·검토 후보 중 실효 총액 절감',
    'purchase-fit': '동급 후보 중 구매 조건 최적',
    'lifecycle-improvement': 'NRND/EOL 대신 활성 부품 우선',
    availability: '구매 가능한 재고·가격 우선',
    'customer-choice': '고객 직접 선택',
    'admin-choice': '관리자 직접 선택',
    'admin-force-choice': '관리자 강제 변경',
    'admin-add': '관리자 수동 추가',
    'post-order-amend': '결제 후 부품 확인 반영',
    'catalog-choice': '카탈로그 직접 선택',
    'offer-choice': '공급사 구매 조건 직접 선택',
    'engine-catalog-selection': '제조사 카탈로그 정확 일치 선정',
    'engine-procurement-recommendation': '엔진 구매 조건 추천',
    'engine-manual-review': '엔진 수동 검토 권장',
    'engine-technical-fallback': '기술 1순위 구매 불가 · 다음 후보 적용',
    'quantity-confirmation-required': '수량 확인 전 기술 선정',
    'engine-procurement-unavailable': '적용 가능한 추천 구매 조건 없음',
    'mass-production-reel-preferred': '양산 모드 · Reel 포장 우선',
    'mass-production-reel-unavailable': '양산 모드 · 구매 가능한 Reel 없음',
    'no-safe-candidate': '안전 자동선정 후보 없음',
  };
  return labels[reason];
}

export function cautionLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'manual_review') {
    return candidate.selectionReasonCodes.includes('manufacturer_confirmation_required')
      ? '제조사 확인 후 선택'
      : '검토 후 선택';
  }
  if (candidate.selectionEligibility === 'automatic' && candidate.conflicts.length > 0) return '선정됨 · 정보 불일치';
  if (candidate.selectionEligibility === 'automatic' && candidate.missingRequirements.length > 0) {
    return '선정됨 · 일부 미확인';
  }
  if (candidate.lifecycleState === 'caution') return '라이프사이클 주의';
  if (candidate.missingRequirements.length > 0) return '검증 보완 필요';
  return '엔진 검토 필요';
}

export function candidateLifecycleTitle(candidate: BomQuoteCandidateType): string {
  return lifecycleSummaryTitle(
    {
      state: candidate.lifecycleState,
      code: candidate.lifecycleCode,
      status: candidate.lifecycleStatus,
      lastBuyDate: candidate.lastBuyDate,
      sources: candidate.lifecycleSources,
    },
    '후보품',
  );
}

/** 라이프사이클 — 활성(초록)·NRND/비활성(주의)·미상(중립)·단종 등(문제). 옛 lifecycleBadgeClass 의 뜻 그대로. */
export function lifecycleTone(code: BomQuoteLifecycleCodeType): CandidateTone {
  if (code === 'active') return 'success';
  if (code === 'nrnd' || code === 'inactive') return 'warning';
  if (code === 'unknown') return 'secondary';
  return 'danger';
}

export function candidateReplacementTitle(candidate: BomQuoteCandidateType): string {
  const title = replacementSourcesTitle(candidate.replacementSources);
  return candidate.replacementForMpn === null ? title : `원품번: ${candidate.replacementForMpn}\n${title}`;
}

export function verificationPercent(candidate: BomQuoteCandidateType): number | null {
  if (candidate.requiredRequirementCount <= 0) return null;
  return Math.max(
    0,
    Math.min(100, Math.round((candidate.verifiedRequirementCount / candidate.requiredRequirementCount) * 100)),
  );
}

export function verificationTone(candidate: BomQuoteCandidateType): CandidateTone {
  if (candidate.selectionEligibility === 'blocked') return 'danger';
  if (candidate.selectionEligibility === 'manual_review') return 'warning';
  if (candidate.conflicts.length > 0) return 'warning';
  if (!candidate.verificationComplete || candidate.requiredRequirementCount <= 0) return 'warning';
  return 'success';
}

function partTypeEvidenceLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.conflicts.includes('part_type_mismatch')) return '부품 유형 불일치';
  if (candidate.conflicts.includes('part_type_source_conflict')) return '부품 유형 정보 충돌';
  if (candidate.reasons.includes('part_type_match')) return '부품 유형 확인';
  if (candidate.missingRequirements.includes('part_type')) return '부품 유형 미확인';
  return candidate.selectionMode === 'exact' ? '품번 우선 판정' : '부품 유형 미확인';
}

export function requirementBadgeLabel(candidate: BomQuoteCandidateType): string {
  if (!candidate.strictCategoryCoverage) {
    return `확인 조건 ${String(candidate.verifiedRequirementCount)}/${String(candidate.requiredRequirementCount)} · ${partTypeEvidenceLabel(candidate)}`;
  }
  const percent = verificationPercent(candidate);
  if (percent === null) return '필수조건 미확인';
  return `필수조건 ${String(candidate.verifiedRequirementCount)}/${String(candidate.requiredRequirementCount)} · ${String(percent)}%`;
}

export function conflictText(candidate: BomQuoteCandidateType): string {
  return candidate.conflicts.map(conflictLabel).join(', ');
}

export function conflictNoticePrefix(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'automatic' && candidate.selectionMode === 'exact') {
    return '품번 일치 우선 선정 · 추가 정보 불일치';
  }
  if (candidate.selectionEligibility === 'manual_review') return '자동선정 보류';
  return '자동선정 제외';
}

export function missingText(candidate: BomQuoteCandidateType): string {
  return candidate.missingRequirements.map(requirementLabel).join(', ');
}

export function missingNoticePrefix(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'automatic' && candidate.selectionMode === 'exact') {
    return '품번 일치 우선 선정 · 추가 정보 미확인';
  }
  return '추가 확인 필요';
}

export function requirementExpectedLabel(assessment: BomQuoteRequirementAssessmentType): string {
  if (assessment.expectedDisplay === null) return 'BOM 정보 없음';
  if (assessment.comparison === 'gte') return `≥ ${assessment.expectedDisplay}`;
  if (assessment.comparison === 'lte') return `≤ ${assessment.expectedDisplay}`;
  return assessment.expectedDisplay;
}

export function requirementStateLabel(assessment: BomQuoteRequirementAssessmentType): string {
  if (assessment.state === 'not_applicable') return '해당 없음 · 충족';
  if (assessment.state === 'mismatch') return '불일치';
  if (assessment.state === 'missing') return '확인 필요';
  if (assessment.state === 'unverified') return '미검증';
  return assessment.comparison === 'eq' || assessment.comparison === 'category' ? '일치' : '충족';
}

export function requirementStateTone(assessment: BomQuoteRequirementAssessmentType): CandidateTone {
  if (assessment.state === 'match' || assessment.state === 'not_applicable') return 'success';
  if (assessment.state === 'mismatch') return 'danger';
  return 'warning';
}

export function fmtWon(value: number | null): string {
  if (value === null) return '가격 확인 필요';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

export function candidateHasCatalogInquiry(candidate: BomQuoteCandidateType): boolean {
  return candidate.offers.length > 0 && candidate.offers.every((offer) => offer.offerKind === 'manufacturer_catalog');
}

export type OfferStockState = 'out_of_stock' | 'insufficient_stock' | 'stock_unverified' | 'catalog_inquiry';

export function offerStockState(offer: BomQuoteCandidateOfferType): OfferStockState | null {
  if (offer.offerKind === 'manufacturer_catalog') return 'catalog_inquiry';
  if (offer.stock === 0) return 'out_of_stock';
  if (offer.applied?.stockShort === true || offer.decisionReasonCodes.includes('stock_short')) {
    return 'insufficient_stock';
  }
  if (offer.stock === null) return 'stock_unverified';
  return null;
}

export function offerStockLabel(offer: BomQuoteCandidateOfferType): string {
  const state = offerStockState(offer);
  if (state === 'out_of_stock') return '재고 없음';
  if (state === 'catalog_inquiry') return '취급 가능 · 재고 확인';
  if (state === 'stock_unverified') return '재고 확인 필요';
  if (state === 'insufficient_stock') {
    const stock = offer.stock?.toLocaleString('ko-KR') ?? '—';
    const orderQty = offer.applied?.orderQty;
    return orderQty === undefined
      ? `재고 부족 · 보유 ${stock}개`
      : `재고 부족 · ${stock}/${orderQty.toLocaleString('ko-KR')}개`;
  }
  return '';
}

export function offerStockActionLabel(offer: BomQuoteCandidateOfferType): string {
  const state = offerStockState(offer);
  if (state === 'out_of_stock') return '재고 없음';
  if (state === 'insufficient_stock') return '재고 부족';
  if (state === 'catalog_inquiry') return '문의 견적';
  if (state === 'stock_unverified') return '재고 확인 필요';
  return '선택 불가';
}

export function offerStockTone(offer: BomQuoteCandidateOfferType): CandidateTone {
  const state = offerStockState(offer);
  if (state === 'out_of_stock') return 'danger';
  if (state === 'insufficient_stock') return 'warning';
  if (state === 'catalog_inquiry') return 'info';
  return 'secondary';
}

export function offerPresentationRank(offer: BomQuoteCandidateOfferType): number {
  if (offer.recommendation !== 'none') return 0;
  if (offer.purchasable) return 1;
  const state = offerStockState(offer);
  if (state === null && (offer.applied?.stockShort === false || offer.decisionReasonCodes.includes('stock_sufficient'))) {
    return 2;
  }
  if (state === 'insufficient_stock') return 3;
  if (state === 'catalog_inquiry') return 4;
  if (state === 'stock_unverified') return 5;
  if (state === 'out_of_stock') return 6;
  return 7;
}

function candidateAvailabilityRank(candidate: BomQuoteCandidateType): number {
  if (candidate.bestOfferKey !== null || candidate.offers.some((offer) => offer.purchasable)) return 0;
  const ranks = candidate.offers.map(offerPresentationRank);
  return ranks.length > 0 ? Math.min(...ranks) : 7;
}

/** 표시 순서 — 현재 선택·추천 → 직접 선택 가능 → 구매 가능성 → 기술 순위(엔진 순위는 그대로 둔다). */
export function compareCandidatesForDisplay(left: BomQuoteCandidateType, right: BomQuoteCandidateType): number {
  const leftApplied = left.selected || left.recommended ? 0 : 1;
  const rightApplied = right.selected || right.recommended ? 0 : 1;
  return leftApplied - rightApplied
    || Number(!left.manualSelectable) - Number(!right.manualSelectable)
    || candidateAvailabilityRank(left) - candidateAvailabilityRank(right)
    || left.technicalRank - right.technicalRank
    || left.candidateKey.localeCompare(right.candidateKey);
}

export function offersForDisplay(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType[] {
  return [...candidate.offers].sort((a, b) =>
    offerPresentationRank(a) - offerPresentationRank(b)
    || (a.purchaseFitRank ?? Number.MAX_SAFE_INTEGER) - (b.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
    || (a.priceRank ?? Number.MAX_SAFE_INTEGER) - (b.priceRank ?? Number.MAX_SAFE_INTEGER)
    || a.offerKey.localeCompare(b.offerKey));
}

/**
 * 협력사 보유 후보(docs/PARTNER_PARTS.md) — 구매 조건이 없어 카드가 밋밋하다. 가격 없는 후보를 '구매 조건
 * 없음'으로만 보여 주면 담당자가 왜 떴는지 모른다. 값은 협력사의 주장이라 다음 행동(견적요청)만 가리킨다.
 */
export function isPartnerCandidate(candidate: {
  corroboratingSuppliers: readonly string[];
  offers: readonly unknown[];
}): boolean {
  return candidate.offers.length === 0 && candidate.corroboratingSuppliers.includes('partner');
}

export function fmtDelta(value: number | null): string {
  if (value === null || value === 0) return '현재와 동일';
  return `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`;
}

export function fmtRate(value: number | null): string {
  if (value === null) return '';
  return `${Math.abs(value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
}

export function fmtUnit(offer: BomQuoteCandidateOfferType): string {
  if (offer.offerKind === 'manufacturer_catalog') return '문의 견적';
  const applied = offer.applied;
  if (applied === null) return '가격 없음';
  const prefix = applied.currency === 'KRW' ? '₩' : applied.currency === 'USD' ? '$' : `${applied.currency} `;
  return `${prefix}${applied.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

export function fmtOfferTotal(offer: BomQuoteCandidateOfferType): string {
  return offer.offerKind === 'manufacturer_catalog' ? '문의 견적' : fmtWon(offer.applied?.lineTotalKrw ?? null);
}

export function fmtAge(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '방금';
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}분 전`;
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}시간 전`;
  return `${String(Math.floor(elapsed / 86_400_000))}일 전`;
}

export const candidateActionReasonId = (candidate: BomQuoteCandidateType): string =>
  `candidate-action-reason-${candidate.candidateKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

export const offerActionReasonId = (offer: BomQuoteCandidateOfferType): string =>
  `offer-action-reason-${offer.offerKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
