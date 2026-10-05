import { computed, inject, onBeforeUnmount, provide, ref, watch, type InjectionKey } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteSearchTraceAttemptType,
  BomQuoteSelectionSourceType,
  PartHitType,
} from '@sp/api-contract';
import {
  hasBomQuotePurchasableOffer,
  isSevereOrderSurplus,
  summarizeBomQuoteCandidateOfferIssues,
  type OfferPick,
} from '@sp/utils';
import {
  extractionAlerts,
  extractionDisplayFields,
  extractionDisplaySummary,
  type ExtractionCertainty,
  type ExtractionDisplayField,
} from '@/bom/extraction-display';
import {
  candidateHasCatalogInquiry,
  comparableSpec,
  compareCandidatesForDisplay,
  conflictText,
  extractedFieldTitle,
  fmtUnit,
  fmtWon,
  formatOriginalRows,
  missingText,
  offerStockActionLabel,
  offerStockLabel,
  offerStockState,
} from './labels';
import type { CandidateDrawerEmit, CandidateTone, ResolvedCandidateDrawerProps, SelectionView } from './types';
import { useRequirementsForm } from './useRequirementsForm';

// 후보 서랍의 상태·판정 — 옛 BomCandidateDrawer 스크립트를 의미를 바꾸지 않고 옮겼다. 서랍 틀(CandidateDrawer.vue)이
// 한 번 만들어 provide 하고 섹션 컴포넌트들이 inject 한다. 문구 사전은 labels.ts, 검색 조건 보완 폼은
// useRequirementsForm.ts. 색은 뜻(CandidateTone)으로만 내보내고 화면이 Badge·Alert 변형으로 그린다.

export type CandidateTab = 'selectable' | 'purchasable' | 'all' | 'review';

export interface OriginalField {
  key: string;
  label: string;
  value: string;
  title: string;
  wide?: boolean;
  summarySpan?: string;
  normalizedValue?: string | null;
  provenance?: string;
  certainty?: ExtractionCertainty;
  evidenceCells?: string[];
}

interface PendingReviewSelection {
  candidate: BomQuoteCandidateType;
  offerKey: string | null;
}

export interface ProcurementAlert {
  title: string;
  detail: string;
  tone: 'warning' | 'destructive' | 'info';
}

function summaryCertainty(fields: readonly OriginalField[]): ExtractionCertainty | undefined {
  if (fields.some((field) => field.certainty === 'review')) return 'review';
  if (fields.some((field) => field.certainty === 'inferred')) return 'inferred';
  if (fields.some((field) => field.certainty === 'unknown')) return 'unknown';
  if (fields.some((field) => field.certainty === 'verified')) return 'verified';
  return undefined;
}

export function createCandidateDrawer(props: ResolvedCandidateDrawerProps, emit: CandidateDrawerEmit) {
  const i18n = useI18n();
  const { t } = i18n;

  const view = ref<SelectionView>(props.initialView);
  const tab = ref<CandidateTab>('selectable');
  const expanded = ref<Set<string>>(new Set());
  const originalDetailsExpanded = ref(false);
  const searchTraceExpanded = ref(false);
  const pendingReviewSelection = ref<PendingReviewSelection | null>(null);

  // ── 필수조건 상세(요구 조건 대 후보값) 떠 있는 판 — 배지에 마우스·포커스·클릭으로 열고, 판 위로 옮겨
  //    가는 동안(100ms) 닫지 않는다. 위치는 Popover 가 배지(anchor)에 맞춘다.
  const requirementTooltipCandidateKey = ref<string | null>(null);
  const requirementTooltipAnchor = ref<HTMLElement | null>(null);
  let requirementTooltipCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const requirementTooltipCandidate = computed(
    () => props.context?.candidates.find((candidate) => candidate.candidateKey === requirementTooltipCandidateKey.value) ?? null,
  );
  const requirementTooltipId = computed(() =>
    requirementTooltipCandidateKey.value === null
      ? undefined
      : `bom-requirements-${requirementTooltipCandidateKey.value.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
  );

  function cancelRequirementTooltipClose(): void {
    if (requirementTooltipCloseTimer === null) return;
    clearTimeout(requirementTooltipCloseTimer);
    requirementTooltipCloseTimer = null;
  }
  function hideRequirementTooltipNow(): void {
    cancelRequirementTooltipClose();
    requirementTooltipCandidateKey.value = null;
    requirementTooltipAnchor.value = null;
  }
  function scheduleRequirementTooltipClose(): void {
    cancelRequirementTooltipClose();
    requirementTooltipCloseTimer = setTimeout(() => {
      requirementTooltipCandidateKey.value = null;
      requirementTooltipAnchor.value = null;
      requirementTooltipCloseTimer = null;
    }, 100);
  }
  function showRequirementTooltip(candidate: BomQuoteCandidateType, event: Event): void {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    cancelRequirementTooltipClose();
    requirementTooltipCandidateKey.value = candidate.candidateKey;
    requirementTooltipAnchor.value = trigger;
  }
  onBeforeUnmount(cancelRequirementTooltipClose);

  // ── 원본 BOM(추출값) ───────────────────────────────────────────────────────────
  const extractedOriginalFields = computed<ExtractionDisplayField[]>(() => {
    const payload = props.context?.extraction?.payload;
    return payload === undefined ? [] : extractionDisplayFields(payload);
  });
  const originalExtractionSummary = computed(() => extractionDisplaySummary(extractedOriginalFields.value));
  const originalExtractionAlerts = computed(() => {
    const payload = props.context?.extraction?.payload;
    return payload === undefined ? [] : extractionAlerts(payload);
  });

  const originalFields = computed<OriginalField[]>(() => {
    const context = props.context;
    if (context === null) return [];
    const rows = formatOriginalRows(context.originalRows, true);
    const fullRows = formatOriginalRows(context.originalRows, false);
    const location = [context.originalSheetName, rows]
      .filter((value): value is string => value !== null && value !== '')
      .join(' · ');
    const locationTitle = [context.originalSheetName, fullRows]
      .filter((value): value is string => value !== null && value !== '')
      .join(' · ');
    const fields: OriginalField[] = [
      {
        key: 'location',
        label: 'Excel 위치',
        value: location === '' ? '수동 추가' : location,
        title: locationTitle === '' ? '수동 추가' : locationTitle,
      },
    ];
    if (extractedOriginalFields.value.length > 0) {
      fields.push(...extractedOriginalFields.value.map((field) => ({ ...field, title: extractedFieldTitle(field) })));
    } else {
      if (context.originalMpn !== null) {
        fields.push({ key: 'mpn', label: '원본 MPN', value: context.originalMpn, title: context.originalMpn, wide: true });
      }
      if (context.originalValue !== null) {
        fields.push({
          key: 'value',
          label: '원본 값 / 설명',
          value: context.originalValue,
          title: context.originalValue,
          wide: true,
        });
      }
      if (context.originalManufacturer !== null) {
        fields.push({
          key: 'manufacturer',
          label: '원본 제조사',
          value: context.originalManufacturer,
          title: context.originalManufacturer,
        });
      }
      if (context.originalPackageCode !== null) {
        fields.push({
          key: 'package',
          label: '원본 패키지',
          value: context.originalPackageCode,
          title: context.originalPackageCode,
        });
      }
      if (context.originalReferenceDesignators.length > 0) {
        const references = context.originalReferenceDesignators.join(', ');
        fields.push({ key: 'references', label: 'REFDES', value: references, title: references, wide: true });
      }
    }
    if (!fields.some((field) => field.key === 'quantity')) {
      fields.push({
        key: 'bom-qty',
        label: 'BOM 수량',
        value: `${context.bomQty.toLocaleString('ko-KR')}개`,
        title: `${context.bomQty.toLocaleString('ko-KR')}개`,
      });
    }
    fields.push({
      key: 'needed-qty',
      label: '총 필요수량',
      value: `${context.neededQty.toLocaleString('ko-KR')}개`,
      title: `${context.neededQty.toLocaleString('ko-KR')}개`,
    });
    return fields;
  });

  function originalFieldValue(key: string): string {
    return originalFields.value.find((candidate) => candidate.key === key)?.value ?? '';
  }

  // 요약 칸 — 품번·제조사·값·실장·설명·핵심 사양 여섯 칸(6열 격자에서의 폭을 함께 정한다).
  const originalSummaryFields = computed<OriginalField[]>(() => {
    const fields = originalFields.value;
    const byKey = (...keys: string[]): OriginalField | undefined =>
      keys.map((key) => fields.find((field) => field.key === key)).find((field) => field !== undefined);
    const withSpan = (field: OriginalField | undefined, summarySpan: string): OriginalField[] =>
      field === undefined ? [] : [{ ...field, summarySpan }];

    const partNumber = byKey('part_number', 'mpn');
    const manufacturer = byKey('manufacturer');
    const rawValue = byKey('value_raw', 'value');
    const primarySpec = byKey('resistance', 'capacitance', 'inductance');
    const value = rawValue ?? primarySpec;
    const mount = byKey('footprint') ?? byKey('package');
    const description = byKey('description');

    const rawComparable = value === undefined ? null : comparableSpec(value.normalizedValue ?? value.value);
    const specFields = fields
      .filter(
        (field) =>
          ['resistance', 'capacitance', 'inductance', 'power', 'tolerance', 'voltage', 'current', 'frequency', 'temperature'].includes(
            field.key,
          ) && (rawComparable === null || comparableSpec(field.normalizedValue ?? field.value) !== rawComparable),
      )
      .slice(0, 4);
    const keySpecCertainty = summaryCertainty(specFields);
    const keySpecs: OriginalField | undefined =
      specFields.length === 0
        ? undefined
        : {
            key: 'key-specs',
            label: '핵심 사양',
            value: specFields.map((field) => field.normalizedValue ?? field.value).join(' · '),
            title: specFields.map((field) => `${field.label} ${field.normalizedValue ?? field.value}`).join(' · '),
            ...(keySpecCertainty === undefined ? {} : { certainty: keySpecCertainty }),
            evidenceCells: [...new Set(specFields.flatMap((field) => field.evidenceCells ?? []))],
          };

    return [
      ...withSpan(partNumber, 'sm:col-span-2'),
      ...withSpan(manufacturer, 'sm:col-span-1'),
      ...withSpan(value, 'sm:col-span-1'),
      ...withSpan(mount, 'sm:col-span-2'),
      ...withSpan(description, keySpecs === undefined ? 'sm:col-span-6' : 'sm:col-span-3'),
      ...withSpan(keySpecs, description === undefined ? 'sm:col-span-6' : 'sm:col-span-3'),
    ];
  });

  const originalLocation = computed(() => originalFields.value.find((field) => field.key === 'location') ?? null);
  const originalDetailCount = computed(() => extractedOriginalFields.value.length || originalFields.value.length);
  const originalReviewFields = computed(() =>
    extractedOriginalFields.value.filter((field) => field.certainty === 'review'),
  );

  // ── 검색 조건 보완 폼 ──────────────────────────────────────────────────────────
  const requirements = useRequirementsForm(props, emit, originalFieldValue);

  // ── 선정 상태 ─────────────────────────────────────────────────────────────────
  const currentCandidate = computed(() => props.context?.candidates.find((candidate) => candidate.selected) ?? null);
  const recommendedCandidate = computed(
    () => props.context?.candidates.find((candidate) => candidate.recommended) ?? null,
  );
  const technicalTopCandidate = computed(
    () =>
      props.context?.candidates.find((candidate) => candidate.candidateKey === props.context?.technicalTopCandidateKey) ??
      null,
  );
  const provisionalSelectionPending = computed(
    () =>
      props.context?.selectionSource === 'auto' &&
      props.context.selectionApplicationState === 'provisional_selected' &&
      props.context.confirmationRequired,
  );
  const reviewSelectionConfirmed = computed(
    () =>
      props.context?.selectionApplicationState === 'provisional_selected' &&
      props.context.confirmationRequired &&
      ['customer', 'admin'].includes(props.context.selectionSource) &&
      props.context.selectedCandidateKey === recommendedCandidate.value?.candidateKey,
  );

  // ── 검색 과정 ─────────────────────────────────────────────────────────────────
  const searchTracePrimaryQuery = computed(() => {
    const localQuery = props.context?.localCatalogTrace?.query.trim() ?? '';
    return localQuery !== '' ? localQuery : (props.context?.searchTrace?.primaryQuery ?? '');
  });
  const searchTraceStageCount = computed(
    () =>
      (props.context?.localCatalogTrace === null || props.context?.localCatalogTrace === undefined ? 0 : 1) +
      (props.context?.searchTrace?.attemptCount ?? 0),
  );
  const localCatalogDecisionSummary = computed(() => props.context?.localCatalogTrace?.decisionSummary ?? null);
  const localCatalogRepresentativeCandidate = computed(
    () => localCatalogDecisionSummary.value?.representativeCandidate ?? null,
  );

  function traceCodeLabel(section: 'stage' | 'strategy' | 'source' | 'fallbackReason', code: string): string {
    const key = `bomSearchTrace.${section}.${code}`;
    return i18n.te(key) ? t(key) : code;
  }
  function traceOutcomeLabel(attempt: BomQuoteSearchTraceAttemptType): string {
    // resultCount 는 엔진의 기술 검증·중복 제거·최종 후보 정리 전, 공급사 응답 건수다.
    const key = `bomSearchTrace.outcome.${attempt.outcome}`;
    if (!i18n.te(key)) return attempt.outcome;
    return t(key, { count: attempt.resultCount });
  }

  // ── 구매 가능성 안내(행 단위) ──────────────────────────────────────────────────
  const procurementAvailabilityAlert = computed<ProcurementAlert | null>(() => {
    const context = props.context;
    if (context === null) return null;
    const needed = context.neededQty.toLocaleString('ko-KR');
    switch (context.procurementUnavailabilityReason) {
      case 'input_incomplete':
        return {
          title: '구매 수량 확인이 필요합니다',
          detail: '원본 BOM의 수량 또는 참조번호 충돌을 확인한 뒤 적용 가능한 구매 조건을 판정할 수 있습니다.',
          tone: 'warning',
        };
      case 'out_of_stock':
        return {
          title: '모든 적용 가능한 구매 조건의 재고가 없습니다',
          detail: `재고가 모두 0으로 확인되어 필요수량 ${needed}개를 충족할 수 없습니다.`,
          tone: 'destructive',
        };
      case 'insufficient_stock':
        return {
          title: '모든 적용 가능한 구매 조건의 재고가 부족합니다',
          detail: `확인된 재고로는 필요수량 ${needed}개를 충족할 수 없습니다.`,
          tone: 'warning',
        };
      case 'stock_unverified':
        return {
          title: '적용 가능한 구매 조건의 재고를 확인할 수 없습니다',
          detail: `필요수량 ${needed}개 충족 여부를 공급사에서 확인해 주세요.`,
          tone: 'warning',
        };
      case 'catalog_inquiry':
        if (context.selectionApplicationState !== 'automatic_selected' || context.selectedCandidateKey === null) {
          return {
            title: '제조사 카탈로그에서 취급 가능한 후보입니다',
            detail:
              '자동선정 안전조건을 통과하지 않아 부품은 선정하지 않았습니다. 기술 근거를 검토하고 실제 재고와 가격을 확인해 주세요.',
            tone: 'warning',
          };
        }
        return {
          title: '제조사 카탈로그 정확 일치 부품으로 선정했습니다',
          detail: `부품 선정은 완료됐으며 실제 재고 ${needed}개와 가격만 별도 확인이 필요합니다.`,
          tone: 'info',
        };
      case 'price_unavailable':
        return {
          title: '구매 가능한 가격을 확인할 수 없습니다',
          detail: '재고가 있더라도 필요수량에 적용할 가격 또는 환율이 없어 구매 조건을 선정하지 않았습니다.',
          tone: 'warning',
        };
      case 'technical_unavailable':
        return {
          title: '기술 조건 확인이 필요합니다',
          detail: '재고와 가격보다 기술 호환성을 우선해 조건이 충돌하는 후보는 선정하지 않았습니다.',
          tone: 'warning',
        };
      default:
        return null;
    }
  });

  // ── 후보 목록·탭 ──────────────────────────────────────────────────────────────
  const candidates = computed(() => {
    const source = props.context?.candidates ?? [];
    const filtered = source.filter((candidate) => {
      if (tab.value === 'selectable') return candidate.manualSelectable;
      if (tab.value === 'purchasable') return candidate.manualSelectable && hasBomQuotePurchasableOffer(candidate.offers);
      if (tab.value === 'review') return candidate.selectionEligibility !== 'automatic';
      return true;
    });
    return [...filtered].sort(compareCandidatesForDisplay);
  });
  const selectableCount = computed(
    () => props.context?.candidates.filter((candidate) => candidate.manualSelectable).length ?? 0,
  );
  const purchasableCount = computed(
    () =>
      props.context?.candidates.filter(
        (candidate) => candidate.manualSelectable && hasBomQuotePurchasableOffer(candidate.offers),
      ).length ?? 0,
  );
  const reviewCount = computed(
    () => props.context?.candidates.filter((candidate) => candidate.selectionEligibility !== 'automatic').length ?? 0,
  );

  function toggleCandidate(candidateKey: string): void {
    const next = new Set(expanded.value);
    if (next.has(candidateKey)) next.delete(candidateKey);
    else next.add(candidateKey);
    expanded.value = next;
  }

  function sourceLabel(source: BomQuoteSelectionSourceType): string {
    if (source === 'auto' && props.context?.procurementUnavailabilityReason === 'catalog_inquiry') {
      return '제조사 카탈로그 선정';
    }
    const labels: Record<BomQuoteSelectionSourceType, string> = {
      none: '미선정',
      auto: provisionalSelectionPending.value ? '엔진 임시 선정' : '자동 추천',
      customer: '고객 직접 선택',
      catalog: '카탈로그 직접 선택',
      admin: '관리자 선택',
      legacy: '기존 견적',
      partner: '협력사 견적',
    };
    return labels[source];
  }

  /** 카드 강조 — 검토 대기 선택·검토 권장 추천(주의) / 현재 선택(주 색상) / 차단·주의 후보(옅은 상태색). */
  type CandidateEmphasis = 'pending' | 'selected' | 'blocked' | 'caution' | 'plain';
  function candidateEmphasis(candidate: BomQuoteCandidateType): CandidateEmphasis {
    if (candidate.selected && provisionalSelectionPending.value) return 'pending';
    if (candidate.selected) return 'selected';
    if (candidate.recommended && candidate.selectionEligibility === 'manual_review') return 'pending';
    if (candidate.safety === 'blocked') return 'blocked';
    if (candidate.safety === 'caution') return 'caution';
    return 'plain';
  }

  function recommendationLabel(candidate: BomQuoteCandidateType): string {
    if (candidate.selected && candidateHasCatalogInquiry(candidate)) return '카탈로그 선정 · 문의';
    if (candidate.recommended && props.context?.technicalFallbackUsed === true) {
      return candidate.selectionEligibility === 'manual_review' ? '구매 적용 · 검토' : '구매 적용 후보';
    }
    if (candidate.recommended) return candidate.selectionEligibility === 'manual_review' ? '검토 권장' : '자동 추천';
    if (candidate.candidateKey === props.context?.technicalTopCandidateKey) {
      return candidate.reviewRecommended ? '기술 검토 1순위' : '기술 사전 선정';
    }
    if (candidate.reviewRecommended) return '기술 검토 1순위';
    if (candidate.selectionRecommendation === 'preselect') return '기술 사전 선정';
    if (candidate.selectionRecommendation === 'candidate_only') return '후보만 표시';
    return candidate.selectionRecommendation === 'exclude' ? '선정 제외' : '';
  }

  function recommendationTone(candidate: BomQuoteCandidateType): CandidateTone {
    if (candidate.recommended && candidate.selectionEligibility === 'manual_review') return 'warning';
    if (candidate.recommended) return 'success';
    if (candidate.selectionRecommendation === 'exclude') return 'danger';
    if (candidate.selectionRecommendation === 'candidate_only') return 'secondary';
    return 'info';
  }

  // ── 금액·구매 조건 ─────────────────────────────────────────────────────────────
  function candidateBestOffer(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType | null {
    if (candidate.bestOfferKey === null) return null;
    return candidate.offers.find((offer) => offer.offerKey === candidate.bestOfferKey) ?? null;
  }
  function candidateSelectedOffer(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType | null {
    const selectedOfferKey = props.context?.selectedOfferKey;
    if (!candidate.selected || selectedOfferKey === null || selectedOfferKey === undefined) return null;
    return candidate.offers.find((offer) => offer.offerKey === selectedOfferKey) ?? null;
  }
  function candidateDisplayOffer(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType | null {
    return candidateSelectedOffer(candidate) ?? candidateBestOffer(candidate);
  }
  function candidateDisplayLineTotal(candidate: BomQuoteCandidateType): number | null {
    return candidateSelectedOffer(candidate) !== null && candidate.selected
      ? (props.context?.currentLineTotalKrw ?? candidate.bestLineTotalKrw)
      : candidate.bestLineTotalKrw;
  }
  function candidateTotalLabel(candidate: BomQuoteCandidateType): string {
    const lineTotal = candidateDisplayLineTotal(candidate);
    if (lineTotal !== null) return fmtWon(lineTotal);
    if (candidateHasCatalogInquiry(candidate)) return '문의 견적';
    if (props.context?.procurementUnavailabilityReason === 'input_incomplete') return '수량 확인 후 계산';
    return candidate.offers.length > 0 ? '구매 가능한 조건 없음' : '가격 확인 필요';
  }
  function candidateDisplayOfferUnitLabel(candidate: BomQuoteCandidateType): string | null {
    const offer = candidateDisplayOffer(candidate);
    const applied = offer?.applied;
    if (offer === null || applied === null || applied === undefined) return null;
    if (applied.unitPriceKrw === null) return `${fmtUnit(offer)}/개`;
    const unitPrice = applied.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
    return `${applied.currency === 'KRW' ? '' : '약 '}${unitPrice}원/개`;
  }
  function candidateDisplayOfferCaption(candidate: BomQuoteCandidateType): string | null {
    const offer = candidateSelectedOffer(candidate);
    if (offer === null) return null;
    const packaging = offer.packaging ?? '포장 미상';
    const moq = offer.moq === null ? 'MOQ 미확인' : `MOQ ${offer.moq.toLocaleString('ko-KR')}`;
    return `사용 중 · ${offer.supplier} · ${packaging} · ${moq}`;
  }
  const neededQty = (): number => props.context?.neededQty ?? props.needed;
  function severeOfferSurplus(offer: BomQuoteCandidateOfferType): boolean {
    if (offer.decisionReasonCodes.includes('automatic_selection_excessive')) return true;
    const orderQty = offer.applied?.orderQty;
    if (orderQty === undefined) return false;
    return isSevereOrderSurplus(neededQty(), orderQty);
  }
  function offerSurplusLabel(offer: BomQuoteCandidateOfferType): string {
    const orderQty = offer.applied?.orderQty;
    const needed = neededQty();
    if (orderQty === undefined) return '';
    const surplus = Math.max(0, orderQty - needed);
    const ratio = orderQty / Math.max(1, needed);
    return `필요 ${needed.toLocaleString('ko-KR')}개 · 주문 ${orderQty.toLocaleString('ko-KR')}개 · 초과 ${surplus.toLocaleString('ko-KR')}개 (${ratio.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}배)`;
  }
  function candidateHasSevereDisplayOffer(candidate: BomQuoteCandidateType): boolean {
    const offer = candidateDisplayOffer(candidate);
    return offer !== null && severeOfferSurplus(offer);
  }
  function candidateDisplayOfferSurplusLabel(candidate: BomQuoteCandidateType): string {
    const offer = candidateDisplayOffer(candidate);
    return offer === null ? '' : offerSurplusLabel(offer);
  }
  function candidateOfferIssueSummary(candidate: BomQuoteCandidateType): string | null {
    const counts = summarizeBomQuoteCandidateOfferIssues(candidate.offers, neededQty());
    const labels: string[] = [];
    if (counts.priceUnavailable > 0) labels.push(`가격/환율 없음 ${String(counts.priceUnavailable)}건`);
    if (counts.outOfStock > 0) labels.push(`재고 없음 ${String(counts.outOfStock)}건`);
    if (counts.insufficientStock > 0) labels.push(`재고 부족 ${String(counts.insufficientStock)}건`);
    if (counts.stockUnverified > 0) labels.push(`재고 미확인 ${String(counts.stockUnverified)}건`);
    if (counts.excessiveOrder > 0) labels.push(`과다 주문 조건 ${String(counts.excessiveOrder)}건`);
    if (counts.other > 0) labels.push(`기타 조건 ${String(counts.other)}건`);
    return labels.length === 0 ? null : labels.join(' · ');
  }

  function candidateUnavailableLabel(candidate: BomQuoteCandidateType): string {
    switch (props.context?.procurementUnavailabilityReason) {
      case 'input_incomplete':
        return '수량 확인 필요';
      case 'out_of_stock':
        return '재고 없음';
      case 'insufficient_stock':
        return '재고 부족';
      case 'stock_unverified':
        return '재고 확인 필요';
      case 'catalog_inquiry':
        return '취급 가능 · 재고 확인';
      case 'price_unavailable':
        return '가격 확인 필요';
      case 'technical_unavailable':
        return '기술 조건 확인 필요';
      case 'supplier_unavailable':
        return '공급사 확인 필요';
      case 'no_offer':
        return '구매 조건 없음';
      case 'other':
        return '구매 조건 선택 불가';
      case null:
      case undefined:
        break;
    }
    const states = candidate.offers.map(offerStockState);
    if (states.length > 0 && states.every((state) => state === 'out_of_stock')) return '재고 없음';
    if (states.length > 0 && states.every((state) => state === 'out_of_stock' || state === 'insufficient_stock')) {
      return '재고 부족';
    }
    if (states.length > 0 && states.every((state) => state === 'stock_unverified')) return '재고 확인 필요';
    if (states.length > 0 && states.every((state) => state === 'catalog_inquiry')) {
      return candidate.selected ? '선정됨 · 재고/가격 문의' : '취급 가능 · 재고 확인';
    }
    return '재고·가격 구매 조건 미충족';
  }

  function procurementBlockingReason(): string | null {
    switch (props.context?.procurementUnavailabilityReason) {
      case 'input_incomplete':
        return '원본 BOM의 수량 또는 참조번호 충돌을 확인해야 구매 조건을 적용할 수 있습니다.';
      case 'price_unavailable':
        return '필요수량에 적용할 가격 또는 환율 정보를 확인할 수 없습니다.';
      case 'catalog_inquiry':
        return '제조사 카탈로그 정확 일치로 부품은 선정됐으며 실제 재고와 가격 문의가 필요합니다.';
      case 'technical_unavailable':
        return '재고가 있더라도 필수 기술 조건을 충족하지 않아 선택할 수 없습니다.';
      case 'supplier_unavailable':
        return '현재 견적에서 허용된 공급사의 적용 가능한 구매 조건이 없습니다.';
      case 'no_offer':
        return '적용 가능한 공급사 구매 조건을 찾지 못했습니다.';
      case 'other':
        return '가격·재고·주문수량 중 충족하지 못한 구매 조건이 있습니다.';
      case 'out_of_stock':
      case 'insufficient_stock':
      case 'stock_unverified':
      case null:
      case undefined:
        return null;
    }
  }

  function procurementBlockingActionLabel(): string | null {
    switch (props.context?.procurementUnavailabilityReason) {
      case 'input_incomplete':
        return '수량 확인 필요';
      case 'price_unavailable':
        return '가격 확인 필요';
      case 'catalog_inquiry':
        return '문의 견적';
      case 'technical_unavailable':
        return '기술 조건 확인 필요';
      case 'supplier_unavailable':
        return '공급사 확인 필요';
      case 'no_offer':
        return '구매 조건 없음';
      case 'other':
        return '구매 조건 선택 불가';
      case 'out_of_stock':
      case 'insufficient_stock':
      case 'stock_unverified':
      case null:
      case undefined:
        return null;
    }
  }

  function candidateBlockingReason(candidate: BomQuoteCandidateType): string {
    if (candidate.conflicts.length > 0) return `기술 조건 충돌: ${conflictText(candidate)}`;
    if (candidate.selectionReasonCodes.includes('identity_exact_requirement_conflict')) {
      return '품번은 일치하지만 요구 사양과 충돌합니다.';
    }
    if (candidate.missingRequirements.length > 0) return `필수조건 확인 필요: ${missingText(candidate)}`;
    if (candidate.selectionReasonCodes.includes('strict_category_coverage_incomplete')) {
      return '부품 유형별 필수조건 검증이 완료되지 않았습니다.';
    }
    if (candidate.selectionReasonCodes.includes('verification_incomplete')) return '필수조건 검증이 완료되지 않았습니다.';
    if (candidate.selectionReasonCodes.includes('relationship_unresolved')) {
      return '원본 BOM과 후보의 동일 부품 관계를 확인할 수 없습니다.';
    }
    return '엔진 기술 판정상 직접 선택할 수 없는 후보입니다.';
  }

  function offerUnavailableReason(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): string {
    if (offer.offerKind === 'manufacturer_catalog') {
      return '제조사 카탈로그 취급 부품입니다. 실제 재고 확인과 가격 문의 후 구매 조건을 확정할 수 있습니다.';
    }
    if (!candidate.manualSelectable) return candidateBlockingReason(candidate);
    const reasons = new Set(offer.decisionReasonCodes);
    if (reasons.has('procurement_quantity_confirmation_required') || reasons.has('quantity_reference_conflict')) {
      return '원본 BOM의 수량 또는 참조번호 충돌을 확인해야 구매 조건을 적용할 수 있습니다.';
    }
    if (reasons.has('stock_short') || reasons.has('stock_shortage_not_allowed')) {
      return offerStockLabel(offer) || '필요수량보다 재고가 부족합니다.';
    }
    if (reasons.has('stock_unverified') || reasons.has('stock_unverified_not_allowed')) {
      return '공급사 재고를 확인할 수 없습니다.';
    }
    if (reasons.has('price_unavailable') || reasons.has('price_break_unavailable_for_quantity')) {
      return '필요수량에 적용할 가격 정보가 없습니다.';
    }
    if (reasons.has('currency_rate_missing')) return '견적 통화로 환산할 환율 정보가 없습니다.';
    if (reasons.has('supplier_not_allowed')) return '현재 견적에서 허용하지 않는 공급사입니다.';
    if (reasons.has('required_quantity_missing')) return '필요수량을 확인할 수 없습니다.';
    if (reasons.has('invalid_moq') || reasons.has('invalid_order_multiple')) {
      return '공급사의 MOQ 또는 주문배수 정보가 올바르지 않습니다.';
    }
    if (reasons.has('stable_offer_identity_unavailable')) return '공급사 구매 조건 식별 정보를 확인할 수 없습니다.';
    if (reasons.has('procurement_excluded')) return '조달 대상에서 제외된 행입니다.';
    return procurementBlockingReason() ?? '가격·재고 구매 조건을 충족하지 못했습니다.';
  }

  // ── 선택 동작 ─────────────────────────────────────────────────────────────────
  const selectionTemporarilyLocked = (): boolean => props.selecting || props.interactionLocked;

  function bestOfferAlreadySelected(candidate: BomQuoteCandidateType): boolean {
    return (
      candidate.selected && candidate.bestOfferKey === props.context?.selectedOfferKey && !provisionalSelectionPending.value
    );
  }
  function offerAlreadyConfirmed(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): boolean {
    return candidate.selected && props.context?.selectedOfferKey === offer.offerKey && !provisionalSelectionPending.value;
  }

  function candidateActionDisabled(candidate: BomQuoteCandidateType): boolean {
    return (
      selectionTemporarilyLocked() ||
      !candidate.manualSelectable ||
      candidate.bestOfferKey === null ||
      bestOfferAlreadySelected(candidate)
    );
  }

  function candidateActionLabel(candidate: BomQuoteCandidateType): string {
    if (selectionTemporarilyLocked()) return '선택 적용 중';
    if (candidate.bestOfferKey === null && candidateHasCatalogInquiry(candidate)) {
      return candidate.selected ? '선정됨 · 문의 진행' : '문의 견적';
    }
    if (candidate.bestOfferKey === null && candidateSelectedOffer(candidate) !== null) return '현재 구매 조건';
    if (!candidate.manualSelectable) return '선택 불가';
    if (candidate.bestOfferKey === null) return candidateUnavailableLabel(candidate);
    if (provisionalSelectionPending.value && candidate.selected) return '검토 완료';
    if (bestOfferAlreadySelected(candidate)) return '현재 구매 조건';
    if (candidate.recommended && candidate.selectionEligibility === 'manual_review') return '권장 후보 검토 후 선택';
    if (candidate.selectionEligibility === 'manual_review') return '검토 후 선택';
    if (candidate.selected) return '구매 조건으로 변경';
    if (candidate.recommended) return '자동 추천 적용';
    return '구매 조건으로 선택';
  }

  function candidateActionDisabledReason(candidate: BomQuoteCandidateType): string | null {
    if (selectionTemporarilyLocked()) return '다른 선택을 적용하는 중입니다.';
    if (candidate.bestOfferKey === null && candidateHasCatalogInquiry(candidate)) {
      return candidate.selected
        ? '부품은 선정됐습니다. 실제 재고 확인과 가격 문의 후 구매 조건을 확정합니다.'
        : '제조사 카탈로그 취급 부품입니다. 실제 재고 확인과 가격 문의가 필요합니다.';
    }
    if (candidate.bestOfferKey === null && candidateSelectedOffer(candidate) !== null) return null;
    if (!candidate.manualSelectable) return candidateBlockingReason(candidate);
    if (candidate.bestOfferKey === null) {
      const issueSummary = candidateOfferIssueSummary(candidate);
      if (issueSummary !== null) return `공급사별 차단 사유: ${issueSummary}`;
      return procurementBlockingReason() ?? `구매 불가: ${candidateUnavailableLabel(candidate)}`;
    }
    return null;
  }

  function offerActionDisabled(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): boolean {
    return (
      selectionTemporarilyLocked() ||
      !candidate.manualSelectable ||
      !offer.purchasable ||
      offer.applied === null ||
      offerAlreadyConfirmed(candidate, offer)
    );
  }

  function offerActionLabel(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): string {
    if (selectionTemporarilyLocked()) return '선택 적용 중';
    if (offer.offerKind === 'manufacturer_catalog') return '문의 견적';
    if (!candidate.manualSelectable) return '선택 불가';
    if (offerAlreadyConfirmed(candidate, offer)) return '현재 사용 중';
    if (!offer.purchasable || offer.applied === null) {
      return procurementBlockingActionLabel() ?? offerStockActionLabel(offer);
    }
    if (provisionalSelectionPending.value && candidate.selected && props.context?.selectedOfferKey === offer.offerKey) {
      return '이 구매 조건 확인 완료';
    }
    return '이 구매 조건 선택';
  }

  function offerActionDisabledReason(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): string | null {
    if (selectionTemporarilyLocked()) return '다른 선택을 적용하는 중입니다.';
    if (!candidate.manualSelectable || !offer.purchasable || offer.applied === null) {
      return offerUnavailableReason(candidate, offer);
    }
    return null;
  }

  const pendingReviewOffer = computed(() => {
    const pending = pendingReviewSelection.value;
    if (pending === null) return null;
    const offerKey = pending.offerKey ?? pending.candidate.bestOfferKey;
    return pending.candidate.offers.find((offer) => offer.offerKey === offerKey) ?? null;
  });

  // 검토 후보(manual_review)는 한 번 더 확인받는다 — 확인창의 [확인 후 선택]이 실제 선택이다.
  function requestSelection(candidate: BomQuoteCandidateType, offerKey: string | null): void {
    if (props.interactionLocked) return;
    if (candidate.selectionEligibility === 'manual_review') {
      pendingReviewSelection.value = { candidate, offerKey };
      return;
    }
    emit('select', candidate.candidateKey, offerKey);
  }
  function selectBest(candidate: BomQuoteCandidateType): void {
    if (
      props.readOnly ||
      props.selecting ||
      props.interactionLocked ||
      !candidate.manualSelectable ||
      candidate.bestOfferKey === null
    ) {
      return;
    }
    requestSelection(candidate, null);
  }
  function selectOffer(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): void {
    if (
      props.readOnly ||
      props.selecting ||
      props.interactionLocked ||
      !candidate.manualSelectable ||
      !offer.purchasable ||
      offer.applied === null
    ) {
      return;
    }
    requestSelection(candidate, offer.offerKey);
  }
  function confirmPendingReviewSelection(): void {
    const pending = pendingReviewSelection.value;
    if (pending === null || props.selecting || props.interactionLocked) return;
    pendingReviewSelection.value = null;
    emit('select', pending.candidate.candidateKey, pending.offerKey);
  }
  function selectCatalogPart(part: PartHitType, pick: OfferPick | null): void {
    if (props.interactionLocked) return;
    emit('catalogSelect', part, pick);
  }

  // ── 열림·행 전환 때 표시 상태 초기화 ─────────────────────────────────────────────
  function resetCandidatePresentation(): void {
    const recommended = props.context?.candidates.find(
      (candidate) => candidate.recommended && candidate.selectionEligibility === 'manual_review',
    );
    tab.value = recommended === undefined ? 'selectable' : 'review';
    expanded.value = new Set();
    pendingReviewSelection.value = null;
    hideRequirementTooltipNow();
    requirements.reset();
  }
  watch(
    () => props.context?.rowIdx,
    () => {
      resetCandidatePresentation();
      originalDetailsExpanded.value = false;
      searchTraceExpanded.value = false;
    },
  );
  watch(
    () => props.open,
    (open) => {
      if (!open) return;
      view.value = props.initialView;
      resetCandidatePresentation();
      originalDetailsExpanded.value = false;
      searchTraceExpanded.value = false;
    },
  );
  watch(
    () => props.initialView,
    (next) => {
      if (props.open) view.value = next;
    },
  );

  return {
    props,
    emit,
    t,
    view,
    tab,
    expanded,
    originalDetailsExpanded,
    searchTraceExpanded,
    pendingReviewSelection,
    pendingReviewOffer,
    requirementTooltipCandidate,
    requirementTooltipAnchor,
    requirementTooltipCandidateKey,
    requirementTooltipId,
    showRequirementTooltip,
    scheduleRequirementTooltipClose,
    cancelRequirementTooltipClose,
    hideRequirementTooltipNow,
    originalFields,
    originalSummaryFields,
    originalLocation,
    originalDetailCount,
    originalReviewFields,
    originalExtractionSummary,
    originalExtractionAlerts,
    requirements,
    currentCandidate,
    recommendedCandidate,
    technicalTopCandidate,
    provisionalSelectionPending,
    reviewSelectionConfirmed,
    searchTracePrimaryQuery,
    searchTraceStageCount,
    localCatalogDecisionSummary,
    localCatalogRepresentativeCandidate,
    traceCodeLabel,
    traceOutcomeLabel,
    procurementAvailabilityAlert,
    candidates,
    selectableCount,
    purchasableCount,
    reviewCount,
    toggleCandidate,
    sourceLabel,
    candidateEmphasis,
    recommendationLabel,
    recommendationTone,
    candidateSelectedOffer,
    candidateTotalLabel,
    candidateDisplayOfferUnitLabel,
    candidateDisplayOfferCaption,
    severeOfferSurplus,
    offerSurplusLabel,
    candidateHasSevereDisplayOffer,
    candidateDisplayOfferSurplusLabel,
    candidateOfferIssueSummary,
    candidateUnavailableLabel,
    candidateActionDisabled,
    candidateActionLabel,
    candidateActionDisabledReason,
    offerActionDisabled,
    offerActionLabel,
    offerActionDisabledReason,
    selectBest,
    selectOffer,
    confirmPendingReviewSelection,
    selectCatalogPart,
  };
}

export type CandidateDrawerState = ReturnType<typeof createCandidateDrawer>;

const CANDIDATE_DRAWER_KEY: InjectionKey<CandidateDrawerState> = Symbol('candidate-drawer');

export function provideCandidateDrawer(state: CandidateDrawerState): void {
  provide(CANDIDATE_DRAWER_KEY, state);
}

export function useCandidateDrawer(): CandidateDrawerState {
  const state = inject(CANDIDATE_DRAWER_KEY);
  if (state === undefined) throw new Error('useCandidateDrawer 는 CandidateDrawer 안에서만 쓴다.');
  return state;
}
