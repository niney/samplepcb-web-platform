<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteDecisionReasonType,
  BomQuoteItemCandidatesType,
  BomQuoteLocalCatalogTraceType,
  BomQuoteRequirementAssessmentType,
  BomQuoteSearchRequirementsBodyType,
  BomQuoteSearchTraceAttemptType,
  BomQuoteSelectionSourceType,
  PartHitType,
} from '@sp/api-contract';
import { isSevereOrderSurplus, type OfferPick } from '@sp/utils';
import {
  extractionAlerts,
  extractionDisplayFields,
  extractionDisplaySummary,
  type ExtractionCertainty,
  type ExtractionDisplayField,
} from '../../../bom/extraction-display';
import BomPartSearchPanel from './BomPartSearchPanel.vue';
import PartImage from '../../ui/PartImage.vue';

const props = withDefaults(defineProps<{
  open: boolean;
  context: BomQuoteItemCandidatesType | null;
  loading: boolean;
  failed: boolean;
  readOnly?: boolean;
  selecting?: boolean;
  catalogSelecting?: boolean;
  hasCatalogPart?: boolean;
  selectionError?: string;
  requirementsSaving?: boolean;
  requirementsError?: string;
  requirementsProgress?: string;
  requirementsNotice?: string;
  externalSearchRunning?: boolean;
  externalSearchError?: string;
  interactionLocked?: boolean;
  initialView?: SelectionView;
  searchInitialQuery?: string;
  currentPartId?: string | null;
  needed?: number;
  usdKrwRate?: number | null;
}>(), {
  readOnly: false,
  selecting: false,
  catalogSelecting: false,
  hasCatalogPart: false,
  selectionError: '',
  requirementsSaving: false,
  requirementsError: '',
  requirementsProgress: '',
  requirementsNotice: '',
  externalSearchRunning: false,
  externalSearchError: '',
  interactionLocked: false,
  initialView: 'candidates',
  searchInitialQuery: '',
  currentPartId: null,
  needed: 1,
  usdKrwRate: null,
});

const emit = defineEmits<{
  close: [];
  select: [candidateKey: string, offerKey: string | null];
  catalogSelect: [part: PartHitType, pick: OfferPick | null];
  catalogOffers: [];
  searchRequirements: [requirements: BomQuoteSearchRequirementsBodyType];
  externalSupplierSearch: [];
}>();

const i18n = useI18n();
const { t } = i18n;

type SelectionView = 'candidates' | 'search';
type CandidateTab = 'selectable' | 'all' | 'review';
type LocalCatalogDecisionSummary = NonNullable<
  BomQuoteLocalCatalogTraceType['decisionSummary']
>;
type LocalCatalogReasonCount = LocalCatalogDecisionSummary['reasonCounts'][number];
type LocalCatalogRepresentativeCandidate = NonNullable<
  LocalCatalogDecisionSummary['representativeCandidate']
>;
type RequirementComponentType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'transistor'
  | 'led'
  | 'crystal'
  | 'connector'
  | 'switch';
type CapacitorType = 'ceramic' | 'electrolytic' | 'tantalum' | 'film';
type InductorType = 'standard' | 'ferrite';
type DiodeType = 'rectifier' | 'signal' | 'schottky' | 'zener' | 'tvs' | 'photodiode';
type TransistorType = 'bjt' | 'mosfet';
type TransistorPolarity = 'npn' | 'pnp' | 'n-channel' | 'p-channel';
type CrystalType = 'crystal' | 'oscillator' | 'resonator';
type ConnectorGender = 'male' | 'female' | 'genderless';
type ConnectorOrientation = 'straight' | 'right-angle' | 'vertical';
type SwitchType = 'tactile' | 'pushbutton' | 'slide' | 'toggle' | 'dip' | 'rotary' | 'reed' | 'other';

interface OriginalField {
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

interface RequirementTooltipPosition {
  top: number;
  left: number;
  width: number;
}

const view = ref<SelectionView>(props.initialView);
const tab = ref<CandidateTab>('selectable');
const expanded = ref<Set<string>>(new Set());
const originalDetailsExpanded = ref(false);
const searchTraceExpanded = ref(false);
const requirementComponentType = ref<RequirementComponentType | null>(null);
const capacitorType = ref<CapacitorType | ''>('');
const inductorType = ref<InductorType | ''>('');
const diodeType = ref<DiodeType | ''>('');
const transistorType = ref<TransistorType | ''>('');
const transistorPolarity = ref<TransistorPolarity | ''>('');
const crystalType = ref<CrystalType | ''>('');
const connectorGender = ref<ConnectorGender | ''>('');
const connectorOrientation = ref<ConnectorOrientation | ''>('');
const switchType = ref<SwitchType | ''>('');
const resistance = ref('');
const capacitance = ref('');
const inductance = ref('');
const impedance = ref('');
const impedanceFrequency = ref('');
const frequency = ref('');
const packageCode = ref('');
const tolerance = ref('');
const voltage = ref('');
const current = ref('');
const power = ref('');
const dielectric = ref('');
const color = ref('');
const pinCount = ref('');
const pitch = ref('');
const rowCount = ref('');
const contactForm = ref('');
const mountStyle = ref<'' | 'smd' | 'through-hole'>('');
const pendingReviewSelection = ref<PendingReviewSelection | null>(null);
const requirementTooltipCandidateKey = ref<string | null>(null);
const requirementTooltipPosition = ref<RequirementTooltipPosition>({ top: 0, left: 0, width: 440 });
const requirementTooltipRef = ref<HTMLElement | null>(null);
const requirementTooltipTrigger = ref<HTMLElement | null>(null);
let requirementTooltipCloseTimer: ReturnType<typeof setTimeout> | null = null;

const requirementTooltipCandidate = computed(() =>
  props.context?.candidates.find((candidate) =>
    candidate.candidateKey === requirementTooltipCandidateKey.value) ?? null,
);
const requirementTooltipId = computed(() =>
  requirementTooltipCandidateKey.value === null
    ? undefined
    : `bom-requirements-${requirementTooltipCandidateKey.value.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
);
const requirementTooltipStyle = computed(() => ({
  top: `${String(requirementTooltipPosition.value.top)}px`,
  left: `${String(requirementTooltipPosition.value.left)}px`,
  width: `${String(requirementTooltipPosition.value.width)}px`,
}));

function cancelRequirementTooltipClose(): void {
  if (requirementTooltipCloseTimer === null) return;
  clearTimeout(requirementTooltipCloseTimer);
  requirementTooltipCloseTimer = null;
}

function hideRequirementTooltipNow(): void {
  cancelRequirementTooltipClose();
  requirementTooltipCandidateKey.value = null;
  requirementTooltipTrigger.value = null;
}

function scheduleRequirementTooltipClose(): void {
  cancelRequirementTooltipClose();
  requirementTooltipCloseTimer = setTimeout(() => {
    requirementTooltipCandidateKey.value = null;
    requirementTooltipTrigger.value = null;
    requirementTooltipCloseTimer = null;
  }, 100);
}

function positionRequirementTooltip(trigger: HTMLElement, candidateKey: string): void {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(440, Math.max(280, window.innerWidth - 16));
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    Math.max(8, window.innerWidth - width - 8),
  );
  requirementTooltipPosition.value = { top: rect.bottom + 8, left, width };
  void nextTick(() => {
    if (requirementTooltipCandidateKey.value !== candidateKey) return;
    const tooltip = requirementTooltipRef.value;
    if (tooltip === null) return;
    const height = tooltip.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow < height && rect.top > spaceBelow
      ? Math.max(8, rect.top - height - 8)
      : Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - height - 8));
    requirementTooltipPosition.value = { top, left, width };
  });
}

function showRequirementTooltip(candidate: BomQuoteCandidateType, event: Event): void {
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement)) return;
  cancelRequirementTooltipClose();
  requirementTooltipCandidateKey.value = candidate.candidateKey;
  requirementTooltipTrigger.value = trigger;
  positionRequirementTooltip(trigger, candidate.candidateKey);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (requirementTooltipCandidateKey.value === null) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    requirementTooltipTrigger.value?.contains(target) === true
    || requirementTooltipRef.value?.contains(target) === true
  ) return;
  hideRequirementTooltipNow();
}

function resetCandidatePresentation(): void {
  const recommended = props.context?.candidates.find((candidate) =>
    candidate.recommended
    && candidate.selectionEligibility === 'manual_review');
  tab.value = recommended === undefined ? 'selectable' : 'review';
  expanded.value = new Set();
  pendingReviewSelection.value = null;
  hideRequirementTooltipNow();
  resetSearchRequirementsForm();
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
    if (open) {
      view.value = props.initialView;
      resetCandidatePresentation();
      originalDetailsExpanded.value = false;
      searchTraceExpanded.value = false;
    }
  },
);

watch(
  () => props.initialView,
  (next) => {
    if (props.open) view.value = next;
  },
);

const currentCandidate = computed(() =>
  props.context?.candidates.find((candidate) => candidate.selected) ?? null,
);
const recommendedCandidate = computed(() =>
  props.context?.candidates.find((candidate) => candidate.recommended) ?? null,
);
const technicalTopCandidate = computed(() =>
  props.context?.candidates.find((candidate) =>
    candidate.candidateKey === props.context?.technicalTopCandidateKey) ?? null,
);
const searchTracePrimaryQuery = computed(() => {
  const localQuery = props.context?.localCatalogTrace?.query.trim() ?? '';
  return localQuery !== ''
    ? localQuery
    : props.context?.searchTrace?.primaryQuery ?? '';
});
const searchTraceStageCount = computed(() =>
  (props.context?.localCatalogTrace === null || props.context?.localCatalogTrace === undefined ? 0 : 1)
  + (props.context?.searchTrace?.attemptCount ?? 0),
);
const localCatalogDecisionSummary = computed(
  () => props.context?.localCatalogTrace?.decisionSummary ?? null,
);
const localCatalogRepresentativeCandidate = computed(
  () => localCatalogDecisionSummary.value?.representativeCandidate ?? null,
);
const provisionalSelectionPending = computed(() =>
  props.context?.selectionSource === 'auto'
  && props.context.selectionApplicationState === 'provisional_selected'
  && props.context.confirmationRequired,
);
const reviewSelectionConfirmed = computed(() =>
  props.context?.selectionApplicationState === 'provisional_selected'
  && props.context.confirmationRequired
  && ['customer', 'admin'].includes(props.context.selectionSource)
  && props.context.selectedCandidateKey === recommendedCandidate.value?.candidateKey,
);

const procurementAvailabilityAlert = computed(() => {
  const context = props.context;
  if (context === null) return null;
  const needed = context.neededQty.toLocaleString('ko-KR');
  switch (context.procurementUnavailabilityReason) {
    case 'input_incomplete':
      return {
        title: '구매 수량 확인이 필요합니다',
        detail: '원본 BOM의 수량 또는 참조번호 충돌을 확인한 뒤 구매 가능한 오퍼를 판정할 수 있습니다.',
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        iconClasses: 'bg-amber-500 text-white',
      };
    case 'out_of_stock':
      return {
        title: '모든 구매 가능 오퍼의 재고가 없습니다',
        detail: `재고가 모두 0으로 확인되어 필요수량 ${needed}개를 충족할 수 없습니다.`,
        classes: 'border-red-300 bg-red-50 text-red-900',
        iconClasses: 'bg-red-600 text-white',
      };
    case 'insufficient_stock':
      return {
        title: '모든 구매 가능 오퍼의 재고가 부족합니다',
        detail: `확인된 재고로는 필요수량 ${needed}개를 충족할 수 없습니다.`,
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        iconClasses: 'bg-amber-500 text-white',
      };
    case 'stock_unverified':
      return {
        title: '구매 가능 오퍼의 재고를 확인할 수 없습니다',
        detail: `필요수량 ${needed}개 충족 여부를 공급사에서 확인해 주세요.`,
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        iconClasses: 'bg-amber-500 text-white',
      };
    case 'catalog_inquiry':
      if (
        context.selectionApplicationState !== 'automatic_selected'
        || context.selectedCandidateKey === null
      ) {
        return {
          title: '제조사 카탈로그에서 취급 가능한 후보입니다',
          detail: '자동선정 안전조건을 통과하지 않아 부품은 선정하지 않았습니다. 기술 근거를 검토하고 실제 재고와 가격을 확인해 주세요.',
          classes: 'border-amber-300 bg-amber-50 text-amber-950',
          iconClasses: 'bg-amber-500 text-white',
        };
      }
      return {
        title: '제조사 카탈로그 정확 일치 부품으로 선정했습니다',
        detail: `부품 선정은 완료됐으며 실제 재고 ${needed}개와 가격만 별도 확인이 필요합니다.`,
        classes: 'border-blue-300 bg-blue-50 text-blue-950',
        iconClasses: 'bg-blue-600 text-white',
      };
    case 'price_unavailable':
      return {
        title: '구매 가능한 가격을 확인할 수 없습니다',
        detail: '재고가 있더라도 필요수량에 적용할 가격 또는 환율이 없어 오퍼를 선정하지 않았습니다.',
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        iconClasses: 'bg-amber-500 text-white',
      };
    case 'technical_unavailable':
      return {
        title: '기술 조건 확인이 필요합니다',
        detail: '재고와 가격보다 기술 호환성을 우선해 조건이 충돌하는 후보는 선정하지 않았습니다.',
        classes: 'border-amber-300 bg-amber-50 text-amber-950',
        iconClasses: 'bg-amber-500 text-white',
      };
    default:
      return null;
  }
});

function traceCodeLabel(section: 'stage' | 'strategy' | 'source' | 'fallbackReason', code: string): string {
  const key = `bomSearchTrace.${section}.${code}`;
  return i18n.te(key) ? t(key) : code;
}

function traceOutcomeLabel(attempt: BomQuoteSearchTraceAttemptType): string {
  // resultCount is the supplier-attempt response count captured before the
  // engine's technical validation, deduplication, and final shortlist.
  const key = `bomSearchTrace.outcome.${attempt.outcome}`;
  if (!i18n.te(key)) return attempt.outcome;
  return t(key, { count: attempt.resultCount });
}

function traceElapsedLabel(elapsedMs: number): string {
  return elapsedMs < 1000
    ? `${Math.round(elapsedMs).toLocaleString('ko-KR')}ms`
    : `${(elapsedMs / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}s`;
}

function localCatalogOutcomeLabel(trace: BomQuoteLocalCatalogTraceType): string {
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

function localCatalogOutcomeClasses(trace: BomQuoteLocalCatalogTraceType): string {
  switch (trace.outcome) {
    case 'selected':
      return 'border-emerald-200 bg-emerald-50/70';
    case 'no_candidates':
    case 'rejected':
    case 'skipped':
      return 'border-amber-200 bg-amber-50/70';
    case 'error':
      return 'border-rose-200 bg-rose-50/70';
  }
}

function localCatalogTitle(trace: BomQuoteLocalCatalogTraceType): string {
  if (trace.catalogType === 'ingested_rc') {
    return '저장된 부품 우선 검색';
  }
  return trace.catalogType === 'connector'
    ? '커넥터 자체 카탈로그'
    : 'SamplePCB R/C 자체 카탈로그';
}

function localCatalogReasonLabel(trace: BomQuoteLocalCatalogTraceType): string | null {
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
      return `기술 자동선정 가능 후보 ${summary.automaticCandidateCount.toLocaleString('ko-KR')}개가 있었지만 ${cause ?? '구매조건 판정'} 때문에 자체 카탈로그에서 선정하지 않았습니다.`;
    }
    if (finalCandidateCount > 0) {
      const results = [
        summary.reviewCandidateCount > 0
          ? `검토 필요 ${summary.reviewCandidateCount.toLocaleString('ko-KR')}개`
          : null,
        summary.blockedCandidateCount > 0
          ? `선정 제외 ${summary.blockedCandidateCount.toLocaleString('ko-KR')}개`
          : null,
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

function localCatalogDecisionStatusLabel(status: string | null): string {
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

function localCatalogUnavailabilityLabel(reason: string | null): string | null {
  if (reason === null) return null;
  const labels: Record<string, string> = {
    out_of_stock: '재고 없음',
    insufficient_stock: '재고 부족',
    stock_unverified: '재고 미확인',
    catalog_inquiry: '재고·가격 문의 필요',
    price_unavailable: '가격 미확인',
    technical_unavailable: '기술 조건 미충족',
    supplier_unavailable: '허용 공급사 오퍼 없음',
    no_offer: '구매 오퍼 없음',
    input_incomplete: '입력 정보 부족',
    other: '구매조건 미충족',
  };
  return labels[reason] ?? reason;
}

function localCatalogDecisionCodeLabel(code: string): string {
  const [prefix, detail] = code.split(':', 2);
  if (detail !== undefined) {
    if (prefix === 'conflict') return conflictLabel(detail);
    if (prefix === 'missing') return `${requirementLabel(detail)} 미확인`;
    if (prefix === 'category_coverage_missing') {
      return `${requirementLabel(detail)} 유형 필수조건 미확인`;
    }
    if (prefix === 'policy_default') {
      return `${requirementLabel(detail)} 정책 기본값 적용`;
    }
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
    manual_review_required: '수동 검토 필요',
    technical_selection_blocked: '기술 선정 차단',
    technical_preselection_unavailable: '기술 사전선정 후보 없음',
    technical_preselection_preserved: '기술 1순위 유지',
    technical_preselection_unpurchasable: '기술 1순위 구매조건 미충족',
    technical_preselection_excessive_order: '기술 1순위 주문수량 과다',
    next_purchasable_technical_group_selected: '구매 가능한 차순위 기술 후보 적용',
    no_purchasable_candidate_group: '구매 가능한 후보군 없음',
    equivalent_group_lower_effective_total_selected: '동급 후보 중 실효 총액 최저 적용',
    best_effective_total_in_equivalent_group: '동급 후보 중 실효 총액 최저',
    best_purchase_fit_in_technical_group: '기술 후보군 내 구매조건 최적',
    best_purchase_fit_in_fallback_group: '차순위 후보군 내 구매조건 최적',
    manufacturer_catalog_candidate_selected: '제조사 카탈로그 후보 선정',
    stock_confirmation_required: '재고 확인 필요',
    price_inquiry_required: '가격 문의 필요',
    automatic_candidate: '자동선정 가능 후보',
  };
  return labels[code] ?? code;
}

function localCatalogReasonCountLabel(reason: LocalCatalogReasonCount): string {
  if (reason.kind === 'conflict') return conflictLabel(reason.code);
  if (reason.kind === 'missing_requirement') {
    return `${requirementLabel(reason.code)} 미확인`;
  }
  return localCatalogDecisionCodeLabel(reason.code);
}

function localCatalogEligibilityLabel(
  eligibility: LocalCatalogRepresentativeCandidate['selectionEligibility'],
): string {
  if (eligibility === 'automatic') return '자동선정 가능';
  if (eligibility === 'manual_review') return '검토 필요';
  if (eligibility === 'blocked') return '선정 제외';
  return '판정 정보 없음';
}

function localCatalogEligibilityClasses(
  eligibility: LocalCatalogRepresentativeCandidate['selectionEligibility'],
): string {
  if (eligibility === 'automatic') return 'bg-emerald-100 text-emerald-800';
  if (eligibility === 'manual_review') return 'bg-amber-100 text-amber-800';
  if (eligibility === 'blocked') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function localCatalogAttentionAssessments(
  candidate: LocalCatalogRepresentativeCandidate,
): LocalCatalogRepresentativeCandidate['requirementAssessments'] {
  return candidate.requirementAssessments
    .filter((assessment) =>
      assessment.state === 'mismatch'
      || assessment.state === 'missing'
      || assessment.state === 'unverified')
    .slice(0, 8);
}

function formatOriginalRows(rows: number[], compact: boolean): string {
  if (rows.length === 0) return '';
  if (!compact || rows.length <= 4) return `${rows.join(', ')}행`;
  return `${rows.slice(0, 4).join(', ')}행 외 ${String(rows.length - 4)}개`;
}

const extractedOriginalFields = computed<ExtractionDisplayField[]>(() => {
  const payload = props.context?.extraction?.payload;
  return payload === undefined ? [] : extractionDisplayFields(payload);
});
const originalExtractionSummary = computed(() => extractionDisplaySummary(extractedOriginalFields.value));
const originalExtractionAlerts = computed(() => {
  const payload = props.context?.extraction?.payload;
  return payload === undefined ? [] : extractionAlerts(payload);
});

function extractedFieldTitle(field: ExtractionDisplayField): string {
  return [
    field.value,
    field.normalizedValue === null ? null : `정규화 ${field.normalizedValue}`,
    field.evidenceCells.length === 0 ? null : `근거 ${field.evidenceCells.join(', ')}`,
  ].filter((value): value is string => value !== null).join(' · ');
}

const originalFields = computed<OriginalField[]>(() => {
  const context = props.context;
  if (context === null) return [];

  const rows = formatOriginalRows(context.originalRows, true);
  const fullRows = formatOriginalRows(context.originalRows, false);
  const location = [context.originalSheetName, rows].filter((value): value is string => value !== null && value !== '').join(' · ');
  const locationTitle = [context.originalSheetName, fullRows].filter((value): value is string => value !== null && value !== '').join(' · ');
  const fields: OriginalField[] = [{
    key: 'location',
    label: 'Excel 위치',
    value: location === '' ? '수동 추가' : location,
    title: locationTitle === '' ? '수동 추가' : locationTitle,
  }];

  if (extractedOriginalFields.value.length > 0) {
    fields.push(...extractedOriginalFields.value.map((field) => ({
      ...field,
      title: extractedFieldTitle(field),
    })));
  } else {
    if (context.originalMpn !== null) {
      fields.push({ key: 'mpn', label: '원본 MPN', value: context.originalMpn, title: context.originalMpn, wide: true });
    }
    if (context.originalValue !== null) {
      fields.push({ key: 'value', label: '원본 값 / 설명', value: context.originalValue, title: context.originalValue, wide: true });
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
  const field = originalFields.value.find((candidate) => candidate.key === key);
  return field?.value ?? '';
}

function inferredRequirementComponentType(): RequirementComponentType | null {
  const stored = props.context?.searchRequirements;
  if (stored !== null && stored !== undefined) return stored.componentType;
  const engineType = props.context?.searchRequirementGuidance?.componentType;
  if (engineType !== null && engineType !== undefined) return engineType;
  const payload = props.context?.extraction?.payload;
  const payloadType = typeof payload?.component_type === 'string'
    ? payload.component_type
    : originalFieldValue('part_type');
  const normalized = payloadType.toLocaleLowerCase('en-US');
  if (normalized.includes('resistor') || normalized.includes('저항')) return 'resistor';
  if (
    normalized.includes('capacitor')
    || normalized.includes('capacit')
    || normalized.includes('커패시터')
    || normalized.includes('콘덴서')
  ) return 'capacitor';
  if (normalized.includes('inductor') || normalized.includes('ferrite') || normalized.includes('인덕터') || normalized.includes('비드')) return 'inductor';
  if (normalized.includes('transistor') || /\b(?:mosfet|fet)\b/.test(normalized) || normalized.includes('트랜지스터')) return 'transistor';
  if (normalized.includes('led') || normalized.includes('발광다이오드')) return 'led';
  if (normalized.includes('diode') || normalized.includes('다이오드')) return 'diode';
  if (normalized.includes('crystal') || normalized.includes('oscillator') || normalized.includes('resonator') || normalized.includes('크리스털') || normalized.includes('발진기')) return 'crystal';
  if (normalized.includes('connector') || normalized.includes('header') || normalized.includes('socket') || normalized.includes('커넥터')) return 'connector';
  if (normalized.includes('switch') || normalized.includes('스위치')) return 'switch';
  return null;
}

function guidanceTextValue(field: string): string {
  const value = props.context?.searchRequirementGuidance?.values[field];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function inferCapacitorType(text: string, inferredDielectric: string): CapacitorType | '' {
  const normalized = text.toLocaleLowerCase('en-US');
  if (normalized.includes('electrolytic') || normalized.includes('ecap') || normalized.includes('전해')) {
    return 'electrolytic';
  }
  if (normalized.includes('tantalum') || normalized.includes('탄탈')) return 'tantalum';
  if (normalized.includes('film') || normalized.includes('필름')) return 'film';
  return inferredDielectric === '' ? '' : 'ceramic';
}

function payloadTextValue(...keys: string[]): string {
  const payload = props.context?.extraction?.payload;
  if (payload === undefined) return '';
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function resetSearchRequirementsForm(): void {
  const context = props.context;
  const stored = context?.searchRequirements;
  const componentType = inferredRequirementComponentType();
  requirementComponentType.value = componentType;

  capacitorType.value = '';
  inductorType.value = '';
  diodeType.value = '';
  transistorType.value = '';
  transistorPolarity.value = '';
  crystalType.value = '';
  connectorGender.value = '';
  connectorOrientation.value = '';
  switchType.value = '';
  resistance.value = '';
  capacitance.value = '';
  inductance.value = '';
  impedance.value = '';
  impedanceFrequency.value = '';
  frequency.value = '';
  tolerance.value = '';
  voltage.value = '';
  current.value = '';
  power.value = '';
  dielectric.value = '';
  color.value = '';
  pinCount.value = '';
  pitch.value = '';
  rowCount.value = '';
  contactForm.value = '';

  const extractedPackage = originalFieldValue('package');
  const guidedPackage = guidanceTextValue('packageCode');
  packageCode.value = stored?.packageCode ?? (
    guidedPackage !== ''
      ? guidedPackage
      : extractedPackage === ''
        ? (context?.originalPackageCode ?? '')
        : extractedPackage
  );
  const evidenceText = JSON.stringify(context?.extraction?.payload ?? {});
  const mountText = `${originalFieldValue('package')} ${originalFieldValue('footprint')} ${evidenceText}`;
  mountStyle.value = stored?.mountStyle ?? (/\b(?:THT|THROUGH[ -]?HOLE|DIP)\b/i.test(mountText)
    ? 'through-hole'
    : /\b(?:SMD|SMT)\b/i.test(mountText)
      ? 'smd'
      : '');

  if (stored !== null && stored !== undefined) {
    switch (stored.componentType) {
      case 'resistor':
        resistance.value = stored.resistance;
        tolerance.value = stored.tolerance ?? '';
        power.value = stored.power ?? '';
        break;
      case 'capacitor':
        capacitorType.value = stored.capacitorType;
        capacitance.value = stored.capacitance;
        tolerance.value = stored.tolerance ?? '';
        voltage.value = stored.voltage ?? '';
        dielectric.value = stored.dielectric ?? '';
        break;
      case 'inductor':
        inductorType.value = stored.inductorType;
        inductance.value = stored.inductance ?? '';
        impedance.value = stored.impedance ?? '';
        impedanceFrequency.value = stored.impedanceFrequency ?? '';
        tolerance.value = stored.tolerance ?? '';
        current.value = stored.current ?? '';
        break;
      case 'diode':
        diodeType.value = stored.diodeType;
        voltage.value = stored.voltage ?? '';
        current.value = stored.current ?? '';
        power.value = stored.power ?? '';
        break;
      case 'transistor':
        transistorType.value = stored.transistorType;
        transistorPolarity.value = stored.polarity;
        voltage.value = stored.voltage ?? '';
        current.value = stored.current ?? '';
        power.value = stored.power ?? '';
        break;
      case 'led':
        color.value = stored.color;
        voltage.value = stored.voltage ?? '';
        current.value = stored.current ?? '';
        break;
      case 'crystal':
        crystalType.value = stored.crystalType;
        frequency.value = stored.frequency;
        tolerance.value = stored.tolerance ?? '';
        break;
      case 'connector':
        pinCount.value = String(stored.pinCount);
        pitch.value = stored.pitch;
        rowCount.value = stored.rowCount === null ? '' : String(stored.rowCount);
        connectorGender.value = stored.gender ?? '';
        connectorOrientation.value = stored.orientation ?? '';
        break;
      case 'switch':
        switchType.value = stored.switchType;
        contactForm.value = stored.contactForm ?? '';
        voltage.value = stored.voltage ?? '';
        current.value = stored.current ?? '';
        break;
    }
    return;
  }

  resistance.value = componentType === 'resistor'
    ? (guidanceTextValue('resistance') || originalFieldValue('resistance'))
    : '';
  capacitance.value = componentType === 'capacitor'
    ? (guidanceTextValue('capacitance') || originalFieldValue('capacitance'))
    : '';
  inductance.value = componentType === 'inductor'
    ? (guidanceTextValue('inductance') || originalFieldValue('inductance'))
    : '';
  frequency.value = componentType === 'crystal'
    ? (guidanceTextValue('frequency') || originalFieldValue('frequency'))
    : '';
  tolerance.value = ['resistor', 'capacitor', 'inductor', 'crystal'].includes(componentType ?? '')
    ? (guidanceTextValue('tolerance') || originalFieldValue('tolerance'))
    : '';
  voltage.value = ['capacitor', 'diode', 'transistor', 'led', 'switch'].includes(componentType ?? '')
    ? (guidanceTextValue('voltage') || originalFieldValue('voltage'))
    : '';
  current.value = ['inductor', 'diode', 'transistor', 'led', 'switch'].includes(componentType ?? '')
    ? (guidanceTextValue('current') || originalFieldValue('current'))
    : '';
  power.value = ['resistor', 'diode', 'transistor'].includes(componentType ?? '')
    ? (guidanceTextValue('power') || originalFieldValue('power'))
    : '';
  dielectric.value = componentType === 'capacitor'
      ? (
        guidanceTextValue('dielectric')
        || (/\b(?:C0G|NP0|X5R|X7R|X8R|Y5V)\b/i.exec(evidenceText)?.[0]?.toUpperCase() ?? '')
      )
    : '';
  const guidedCapacitorType = guidanceTextValue('capacitorType');
  capacitorType.value = componentType === 'capacitor'
    ? ['ceramic', 'electrolytic', 'tantalum', 'film'].includes(guidedCapacitorType)
      ? guidedCapacitorType as CapacitorType
      : inferCapacitorType(evidenceText, dielectric.value)
    : '';
  if (componentType === 'inductor') {
    const guidedInductorType = guidanceTextValue('inductorType');
    inductorType.value = ['standard', 'ferrite'].includes(guidedInductorType)
      ? guidedInductorType as InductorType
      : /\b(?:ferrite|bead)\b|비드/i.test(evidenceText) ? 'ferrite' : 'standard';
    impedance.value = guidanceTextValue('impedance') || payloadTextValue('impedance_ohm');
    impedanceFrequency.value = guidanceTextValue('impedanceFrequency')
      || payloadTextValue('impedance_frequency_hz');
  }
  if (componentType === 'diode') {
    const guidedDiodeType = guidanceTextValue('diodeType');
    diodeType.value = [
      'rectifier',
      'signal',
      'schottky',
      'zener',
      'tvs',
      'photodiode',
    ].includes(guidedDiodeType)
      ? guidedDiodeType as DiodeType
      : /\btvs\b/i.test(evidenceText)
      ? 'tvs'
      : /\bzener\b|제너/i.test(evidenceText)
        ? 'zener'
        : /\bschottky\b|쇼트키/i.test(evidenceText)
          ? 'schottky'
          : /\bphoto ?diode\b|포토다이오드/i.test(evidenceText)
            ? 'photodiode'
            : /\bsignal\b/i.test(evidenceText)
              ? 'signal'
              : /\brectifier\b|정류/i.test(evidenceText)
                ? 'rectifier'
                : '';
  }
  if (componentType === 'transistor') {
    const guidedTransistorType = guidanceTextValue('transistorType');
    transistorType.value = ['bjt', 'mosfet'].includes(guidedTransistorType)
      ? guidedTransistorType as TransistorType
      : /\b(?:mosfet|fet)\b/i.test(evidenceText)
      ? 'mosfet'
      : /\bbjt\b|\btransistor\b|트랜지스터/i.test(evidenceText)
        ? 'bjt'
        : '';
    const guidedPolarity = guidanceTextValue('polarity');
    transistorPolarity.value = ['npn', 'pnp', 'n-channel', 'p-channel'].includes(guidedPolarity)
      ? guidedPolarity as TransistorPolarity
      : /\bp[- ]?channel\b/i.test(evidenceText)
      ? 'p-channel'
      : /\bn[- ]?channel\b/i.test(evidenceText)
        ? 'n-channel'
        : /\bpnp\b/i.test(evidenceText)
          ? 'pnp'
          : /\bnpn\b/i.test(evidenceText)
            ? 'npn'
            : '';
  }
  color.value = componentType === 'led'
    ? (
        guidanceTextValue('color')
        || payloadTextValue('color')
        || (/\b(?:red|green|blue|yellow|orange|white|amber)\b/i.exec(evidenceText)?.[0] ?? '')
      )
    : '';
  if (componentType === 'crystal') {
    const guidedCrystalType = guidanceTextValue('crystalType');
    crystalType.value = ['crystal', 'oscillator', 'resonator'].includes(guidedCrystalType)
      ? guidedCrystalType as CrystalType
      : /\boscillator\b|발진기/i.test(evidenceText)
      ? 'oscillator'
      : /\bresonator\b|공진기/i.test(evidenceText)
        ? 'resonator'
        : 'crystal';
  }
  if (componentType === 'connector') {
    pinCount.value = guidanceTextValue('pinCount') || payloadTextValue('pin_count');
    pitch.value = guidanceTextValue('pitch') || payloadTextValue('pitch_mm');
    rowCount.value = guidanceTextValue('rowCount') || payloadTextValue('row_count');
  }
  if (componentType === 'switch') {
    const guidedSwitchType = guidanceTextValue('switchType');
    switchType.value = [
      'tactile',
      'pushbutton',
      'slide',
      'toggle',
      'dip',
      'rotary',
      'reed',
      'other',
    ].includes(guidedSwitchType)
      ? guidedSwitchType as SwitchType
      : '';
  }
}

const searchRequirementsVisible = computed(() => requirementComponentType.value !== null);
const requirementComponentLabel = computed(() => {
  const labels: Record<RequirementComponentType, string> = {
    resistor: '저항',
    capacitor: '캐패시터',
    inductor: '인덕터',
    diode: '다이오드',
    transistor: 'TR / FET',
    led: 'LED',
    crystal: '크리스탈',
    connector: '커넥터',
    switch: '스위치',
  };
  return requirementComponentType.value === null ? '' : labels[requirementComponentType.value];
});
const engineRequirementReadiness = computed(() =>
  props.context?.searchRequirementGuidance?.readiness ?? null);
const engineSearchExcluded = computed(() => engineRequirementReadiness.value === 'excluded');
const engineMissingRequirementLabels = computed(() => {
  const labels: Record<string, string> = {
    resistance: '저항값',
    capacitance: '정전용량',
    inductance: '인덕턴스',
    impedance: '임피던스',
    frequency: '주파수',
    packageCode: '패키지',
    capacitorType: '캐패시터 종류',
    inductorType: '인덕터 종류',
    diodeType: '다이오드 종류',
    transistorType: '소자 종류',
    polarity: '극성/채널',
    color: '색상',
    crystalType: '발진 소자 종류',
    pinCount: '핀 수',
    pitch: '피치',
    switchType: '스위치 종류',
    voltage: '정격전압',
  };
  return (props.context?.searchRequirementGuidance?.missingFields ?? [])
    .map((field) => labels[field] ?? field);
});
const searchRequirementsValid = computed(() => {
  const componentType = requirementComponentType.value;
  if (componentType === null) return false;
  const packaged = packageCode.value.trim() !== '';
  switch (componentType) {
    case 'resistor':
      return packaged && resistance.value.trim() !== '';
    case 'capacitor':
      return packaged && capacitance.value.trim() !== '' && capacitorType.value !== '';
    case 'inductor':
      return packaged
        && inductorType.value !== '';
    case 'diode':
      return packaged
        && diodeType.value !== '';
    case 'transistor':
      return packaged
        && transistorType.value !== ''
        && transistorPolarity.value !== '';
    case 'led':
      return packaged && color.value.trim() !== '';
    case 'crystal':
      return packaged && crystalType.value !== '' && frequency.value.trim() !== '';
    case 'connector':
      return Number.isInteger(Number(pinCount.value))
        && Number(pinCount.value) > 0
        && pitch.value.trim() !== '';
    case 'switch':
      return packaged && switchType.value !== '';
  }
});

function nullableRequirement(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function submitSearchRequirements(): void {
  const componentType = requirementComponentType.value;
  if (props.interactionLocked || !searchRequirementsValid.value || componentType === null) return;
  const physical = {
    mountStyle: mountStyle.value === '' ? null : mountStyle.value,
  };
  const packaged = {
    ...physical,
    packageCode: packageCode.value.trim(),
  };
  switch (componentType) {
    case 'resistor':
      emit('searchRequirements', {
        ...packaged,
        componentType,
        resistance: resistance.value.trim(),
        tolerance: nullableRequirement(tolerance.value),
        power: nullableRequirement(power.value),
      });
      break;
    case 'capacitor':
      if (capacitorType.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        capacitorType: capacitorType.value,
        capacitance: capacitance.value.trim(),
        tolerance: nullableRequirement(tolerance.value),
        voltage: nullableRequirement(voltage.value),
        dielectric: capacitorType.value === 'ceramic'
          ? nullableRequirement(dielectric.value)
          : null,
      });
      break;
    case 'inductor':
      if (inductorType.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        inductorType: inductorType.value,
        inductance: inductorType.value === 'standard' ? nullableRequirement(inductance.value) : null,
        impedance: inductorType.value === 'ferrite' ? nullableRequirement(impedance.value) : null,
        impedanceFrequency: inductorType.value === 'ferrite' ? nullableRequirement(impedanceFrequency.value) : null,
        current: nullableRequirement(current.value),
        tolerance: nullableRequirement(tolerance.value),
      });
      break;
    case 'diode':
      if (diodeType.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        diodeType: diodeType.value,
        voltage: nullableRequirement(voltage.value),
        current: nullableRequirement(current.value),
        power: nullableRequirement(power.value),
      });
      break;
    case 'transistor':
      if (transistorType.value === '' || transistorPolarity.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        transistorType: transistorType.value,
        polarity: transistorPolarity.value,
        voltage: nullableRequirement(voltage.value),
        current: nullableRequirement(current.value),
        power: nullableRequirement(power.value),
      });
      break;
    case 'led':
      emit('searchRequirements', {
        ...packaged,
        componentType,
        color: color.value.trim(),
        voltage: nullableRequirement(voltage.value),
        current: nullableRequirement(current.value),
      });
      break;
    case 'crystal':
      if (crystalType.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        crystalType: crystalType.value,
        frequency: frequency.value.trim(),
        tolerance: nullableRequirement(tolerance.value),
      });
      break;
    case 'connector':
      emit('searchRequirements', {
        ...physical,
        componentType,
        packageCode: nullableRequirement(packageCode.value),
        pinCount: Number(pinCount.value),
        pitch: pitch.value.trim(),
        rowCount: rowCount.value.trim() === '' ? null : Number(rowCount.value),
        gender: connectorGender.value === '' ? null : connectorGender.value,
        orientation: connectorOrientation.value === '' ? null : connectorOrientation.value,
      });
      break;
    case 'switch':
      if (switchType.value === '') return;
      emit('searchRequirements', {
        ...packaged,
        componentType,
        switchType: switchType.value,
        contactForm: nullableRequirement(contactForm.value),
        voltage: nullableRequirement(voltage.value),
        current: nullableRequirement(current.value),
      });
      break;
  }
}

function comparableSpec(value: string): string {
  return value.toLocaleLowerCase('en-US').replaceAll(/\s+/g, '').replaceAll('μ', 'µ');
}

function summaryCertainty(fields: readonly OriginalField[]): ExtractionCertainty | undefined {
  if (fields.some((field) => field.certainty === 'review')) return 'review';
  if (fields.some((field) => field.certainty === 'inferred')) return 'inferred';
  if (fields.some((field) => field.certainty === 'unknown')) return 'unknown';
  if (fields.some((field) => field.certainty === 'verified')) return 'verified';
  return undefined;
}

const originalSummaryFields = computed<OriginalField[]>(() => {
  const fields = originalFields.value;
  const byKey = (...keys: string[]): OriginalField | undefined => keys
    .map((key) => fields.find((field) => field.key === key))
    .find((field) => field !== undefined);
  const withSpan = (field: OriginalField | undefined, summarySpan: string): OriginalField[] => field === undefined
    ? []
    : [{ ...field, summarySpan }];

  const partNumber = byKey('part_number', 'mpn');
  const manufacturer = byKey('manufacturer');
  const rawValue = byKey('value_raw', 'value');
  const primarySpec = byKey('resistance', 'capacitance', 'inductance');
  const value = rawValue ?? primarySpec;
  const footprint = byKey('footprint');
  const packageField = byKey('package');
  const mount = footprint ?? packageField;
  const description = byKey('description');

  const rawComparable = value === undefined ? null : comparableSpec(value.normalizedValue ?? value.value);
  const specFields = fields.filter((field) => [
    'resistance',
    'capacitance',
    'inductance',
    'power',
    'tolerance',
    'voltage',
    'current',
    'frequency',
    'temperature',
  ].includes(field.key) && (
    rawComparable === null
    || comparableSpec(field.normalizedValue ?? field.value) !== rawComparable
  )).slice(0, 4);
  const keySpecCertainty = summaryCertainty(specFields);
  const keySpecs: OriginalField | undefined = specFields.length === 0
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
const originalReviewFields = computed(() => extractedOriginalFields.value.filter((field) => field.certainty === 'review'));

const candidates = computed(() => {
  const source = props.context?.candidates ?? [];
  const filtered = source.filter((candidate) => {
    if (tab.value === 'selectable') return candidate.manualSelectable;
    if (tab.value === 'review') return candidate.selectionEligibility !== 'automatic';
    return true;
  });
  return [...filtered].sort(compareCandidatesForDisplay);
});

const selectableCount = computed(() =>
  props.context?.candidates.filter((candidate) => candidate.manualSelectable).length ?? 0,
);
const reviewCount = computed(() =>
  props.context?.candidates.filter((candidate) => candidate.selectionEligibility !== 'automatic').length ?? 0,
);

function toggleCandidate(candidateKey: string): void {
  const next = new Set(expanded.value);
  if (next.has(candidateKey)) next.delete(candidateKey);
  else next.add(candidateKey);
  expanded.value = next;
}

function offersForDisplay(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType[] {
  return [...candidate.offers].sort((a, b) =>
    offerPresentationRank(a) - offerPresentationRank(b)
    || (a.purchaseFitRank ?? Number.MAX_SAFE_INTEGER) - (b.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
    || (a.priceRank ?? Number.MAX_SAFE_INTEGER) - (b.priceRank ?? Number.MAX_SAFE_INTEGER)
    || a.offerKey.localeCompare(b.offerKey));
}

function statusLabel(status: string): string {
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

function sourceLabel(source: BomQuoteSelectionSourceType): string {
  if (
    source === 'auto'
    && props.context?.procurementUnavailabilityReason === 'catalog_inquiry'
  ) return '제조사 카탈로그 선정';
  const labels: Record<BomQuoteSelectionSourceType, string> = {
    none: '미선정',
    auto: provisionalSelectionPending.value ? '엔진 임시 선정' : '자동 추천',
    customer: '고객 직접 선택',
    catalog: '카탈로그 직접 선택',
    admin: '관리자 선택',
    legacy: '기존 견적',
  };
  return labels[source];
}

function reasonLabel(reason: BomQuoteDecisionReasonType): string {
  const labels: Record<BomQuoteDecisionReasonType, string> = {
    'identity-exact': '원본 품번 정확 일치',
    'identity-variant': '검증된 품번 변형',
    'technical-top': '기술 검증 1순위',
    'same-part-lowest-total': '동일 부품 내 실효 총액 최저',
    'strict-spec-price-saving': '동급 안전·검토 후보 중 실효 총액 절감',
    'purchase-fit': '동급 후보 중 구매조건 최적',
    'lifecycle-improvement': 'NRND/EOL 대신 활성 부품 우선',
    availability: '구매 가능한 재고·가격 우선',
    'customer-choice': '고객 직접 선택',
    'catalog-choice': '카탈로그 직접 선택',
    'offer-choice': '공급사 오퍼 직접 선택',
    'engine-catalog-selection': '제조사 카탈로그 정확 일치 선정',
    'engine-procurement-recommendation': '엔진 구매조건 추천',
    'engine-manual-review': '엔진 수동 검토 권장',
    'engine-technical-fallback': '기술 1순위 구매 불가 · 다음 후보 적용',
    'quantity-confirmation-required': '수량 확인 전 기술 선정',
    'engine-procurement-unavailable': '구매 가능한 추천 오퍼 없음',
    'mass-production-reel-preferred': '양산 모드 · Reel 포장 우선',
    'mass-production-reel-unavailable': '양산 모드 · 구매 가능한 Reel 없음',
    'no-safe-candidate': '안전 자동선정 후보 없음',
  };
  return labels[reason];
}

function safetyClass(candidate: BomQuoteCandidateType): string {
  if (candidate.selected && provisionalSelectionPending.value) {
    return 'border-amber-400 bg-amber-50/70 ring-2 ring-amber-200';
  }
  if (candidate.selected) return 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-200';
  if (candidate.recommended && candidate.selectionEligibility === 'manual_review') {
    return 'border-amber-400 bg-amber-50/60 ring-2 ring-amber-200';
  }
  if (candidate.safety === 'blocked') return 'border-red-200 bg-red-50/30';
  if (candidate.safety === 'caution') return 'border-amber-200 bg-amber-50/30';
  return 'border-slate-200 bg-surface';
}

function recommendationLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.selected && candidateHasCatalogInquiry(candidate)) {
    return '카탈로그 선정 · 문의';
  }
  if (candidate.recommended && props.context?.technicalFallbackUsed === true) {
    return candidate.selectionEligibility === 'manual_review' ? '구매 적용 · 검토' : '구매 적용 후보';
  }
  if (candidate.recommended) {
    return candidate.selectionEligibility === 'manual_review' ? '검토 권장' : '자동 추천';
  }
  if (candidate.candidateKey === props.context?.technicalTopCandidateKey) {
    return candidate.reviewRecommended ? '기술 검토 1순위' : '기술 사전 선정';
  }
  if (candidate.reviewRecommended) return '기술 검토 1순위';
  if (candidate.selectionRecommendation === 'preselect') {
    return '기술 사전 선정';
  }
  if (candidate.selectionRecommendation === 'candidate_only') return '후보만 표시';
  return candidate.selectionRecommendation === 'exclude' ? '선정 제외' : '';
}

function cautionLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'manual_review') {
    return candidate.selectionReasonCodes.includes('manufacturer_confirmation_required')
      ? '제조사 확인 후 선택'
      : '검토 후 선택';
  }
  if (candidate.selectionEligibility === 'automatic' && candidate.conflicts.length > 0) {
    return '선정됨 · 정보 불일치';
  }
  if (candidate.selectionEligibility === 'automatic' && candidate.missingRequirements.length > 0) {
    return '선정됨 · 일부 미확인';
  }
  if (candidate.lifecycleState === 'caution') return '라이프사이클 주의';
  if (candidate.missingRequirements.length > 0) return '검증 보완 필요';
  return '엔진 검토 필요';
}

function verificationPercent(candidate: BomQuoteCandidateType): number | null {
  if (candidate.requiredRequirementCount <= 0) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(candidate.verifiedRequirementCount / candidate.requiredRequirementCount * 100)),
  );
}

function verificationClass(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'blocked') return 'bg-red-100 font-semibold text-red-800';
  if (candidate.selectionEligibility === 'manual_review') return 'bg-amber-100 font-semibold text-amber-800';
  if (candidate.conflicts.length > 0) return 'bg-amber-100 font-semibold text-amber-800';
  if (!candidate.verificationComplete || candidate.requiredRequirementCount <= 0) {
    return 'bg-amber-100 font-semibold text-amber-800';
  }
  return 'bg-emerald-50 font-semibold text-emerald-800';
}

function partTypeEvidenceLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.conflicts.includes('part_type_mismatch')) return '부품 유형 불일치';
  if (candidate.conflicts.includes('part_type_source_conflict')) return '부품 유형 정보 충돌';
  if (candidate.reasons.includes('part_type_match')) return '부품 유형 확인';
  if (candidate.missingRequirements.includes('part_type')) return '부품 유형 미확인';
  return candidate.selectionMode === 'exact' ? '품번 우선 판정' : '부품 유형 미확인';
}

function requirementBadgeLabel(candidate: BomQuoteCandidateType): string {
  if (!candidate.strictCategoryCoverage) {
    return `확인 조건 ${String(candidate.verifiedRequirementCount)}/${String(candidate.requiredRequirementCount)} · ${partTypeEvidenceLabel(candidate)}`;
  }
  const percent = verificationPercent(candidate);
  if (percent === null) return '필수조건 미확인';
  return `필수조건 ${String(candidate.verifiedRequirementCount)}/${String(candidate.requiredRequirementCount)} · ${String(percent)}%`;
}

function requirementLabel(code: string): string {
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

function conflictLabel(code: string): string {
  if (code.endsWith('_mismatch')) return `${requirementLabel(code.slice(0, -'_mismatch'.length))} 불일치`;
  if (code.endsWith('_source_conflict')) return `${requirementLabel(code.slice(0, -'_source_conflict'.length))} 공급사 정보 충돌`;
  return requirementLabel(code);
}

function conflictText(candidate: BomQuoteCandidateType): string {
  return candidate.conflicts.map(conflictLabel).join(', ');
}

function conflictNoticePrefix(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'automatic' && candidate.selectionMode === 'exact') {
    return '품번 일치 우선 선정 · 추가 정보 불일치';
  }
  if (candidate.selectionEligibility === 'manual_review') return '자동선정 보류';
  return '자동선정 제외';
}

function missingText(candidate: BomQuoteCandidateType): string {
  return candidate.missingRequirements.map(requirementLabel).join(', ');
}

function missingNoticePrefix(candidate: BomQuoteCandidateType): string {
  if (candidate.selectionEligibility === 'automatic' && candidate.selectionMode === 'exact') {
    return '품번 일치 우선 선정 · 추가 정보 미확인';
  }
  return '추가 확인 필요';
}

function requirementExpectedLabel(assessment: BomQuoteRequirementAssessmentType): string {
  if (assessment.expectedDisplay === null) return 'BOM 정보 없음';
  if (assessment.comparison === 'gte') return `≥ ${assessment.expectedDisplay}`;
  if (assessment.comparison === 'lte') return `≤ ${assessment.expectedDisplay}`;
  return assessment.expectedDisplay;
}

function requirementStateLabel(assessment: BomQuoteRequirementAssessmentType): string {
  if (assessment.state === 'not_applicable') return '해당 없음 · 충족';
  if (assessment.state === 'mismatch') return '불일치';
  if (assessment.state === 'missing') return '확인 필요';
  if (assessment.state === 'unverified') return '미검증';
  return assessment.comparison === 'eq' || assessment.comparison === 'category' ? '일치' : '충족';
}

function requirementStateClass(assessment: BomQuoteRequirementAssessmentType): string {
  if (assessment.state === 'match' || assessment.state === 'not_applicable') {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (assessment.state === 'mismatch') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

function fmtWon(value: number | null): string {
  if (value === null) return '가격 확인 필요';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function candidateHasCatalogInquiry(candidate: BomQuoteCandidateType): boolean {
  return candidate.offers.length > 0
    && candidate.offers.every((offer) => offer.offerKind === 'manufacturer_catalog');
}

function candidateTotalLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.bestLineTotalKrw !== null) return fmtWon(candidate.bestLineTotalKrw);
  if (candidateHasCatalogInquiry(candidate)) return '문의 견적';
  if (props.context?.procurementUnavailabilityReason === 'input_incomplete') {
    return '수량 확인 후 계산';
  }
  return candidate.offers.length > 0 ? '구매 가능한 오퍼 없음' : '가격 확인 필요';
}

function severeOfferSurplus(offer: BomQuoteCandidateOfferType): boolean {
  if (offer.decisionReasonCodes.includes('automatic_selection_excessive')) return true;
  const orderQty = offer.applied?.orderQty;
  const needed = props.context?.neededQty ?? props.needed;
  if (orderQty === undefined) return false;
  return isSevereOrderSurplus(needed, orderQty);
}

function offerSurplusLabel(offer: BomQuoteCandidateOfferType): string {
  const orderQty = offer.applied?.orderQty;
  const needed = props.context?.neededQty ?? props.needed;
  if (orderQty === undefined) return '';
  const surplus = Math.max(0, orderQty - needed);
  const ratio = orderQty / Math.max(1, needed);
  return `필요 ${needed.toLocaleString('ko-KR')}개 · 주문 ${orderQty.toLocaleString('ko-KR')}개 · 초과 ${surplus.toLocaleString('ko-KR')}개 (${ratio.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}배)`;
}

function candidateBestOffer(candidate: BomQuoteCandidateType): BomQuoteCandidateOfferType | null {
  if (candidate.bestOfferKey === null) return null;
  return candidate.offers.find((offer) => offer.offerKey === candidate.bestOfferKey) ?? null;
}

function candidateHasSevereBestOffer(candidate: BomQuoteCandidateType): boolean {
  const offer = candidateBestOffer(candidate);
  return offer !== null && severeOfferSurplus(offer);
}

function candidateBestOfferSurplusLabel(candidate: BomQuoteCandidateType): string {
  const offer = candidateBestOffer(candidate);
  return offer === null ? '' : offerSurplusLabel(offer);
}

type OfferStockState =
  | 'out_of_stock'
  | 'insufficient_stock'
  | 'stock_unverified'
  | 'catalog_inquiry';

function offerStockState(offer: BomQuoteCandidateOfferType): OfferStockState | null {
  if (offer.offerKind === 'manufacturer_catalog') return 'catalog_inquiry';
  if (offer.stock === 0) return 'out_of_stock';
  if (
    offer.applied?.stockShort === true
    || offer.decisionReasonCodes.includes('stock_short')
  ) return 'insufficient_stock';
  if (offer.stock === null) return 'stock_unverified';
  return null;
}

function offerPresentationRank(offer: BomQuoteCandidateOfferType): number {
  if (offer.recommendation !== 'none') return 0;
  if (offer.purchasable) return 1;
  const state = offerStockState(offer);
  if (
    state === null
    && (
      offer.applied?.stockShort === false
      || offer.decisionReasonCodes.includes('stock_sufficient')
    )
  ) return 2;
  if (state === 'insufficient_stock') return 3;
  if (state === 'catalog_inquiry') return 4;
  if (state === 'stock_unverified') return 5;
  if (state === 'out_of_stock') return 6;
  return 7;
}

function candidateAvailabilityRank(candidate: BomQuoteCandidateType): number {
  if (
    candidate.bestOfferKey !== null
    || candidate.offers.some((offer) => offer.purchasable)
  ) return 0;
  const ranks = candidate.offers.map(offerPresentationRank);
  return ranks.length > 0 ? Math.min(...ranks) : 7;
}

function compareCandidatesForDisplay(
  left: BomQuoteCandidateType,
  right: BomQuoteCandidateType,
): number {
  const leftApplied = left.selected || left.recommended ? 0 : 1;
  const rightApplied = right.selected || right.recommended ? 0 : 1;
  return leftApplied - rightApplied
    || Number(!left.manualSelectable) - Number(!right.manualSelectable)
    || candidateAvailabilityRank(left) - candidateAvailabilityRank(right)
    || left.technicalRank - right.technicalRank
    || left.candidateKey.localeCompare(right.candidateKey);
}

function offerStockLabel(offer: BomQuoteCandidateOfferType): string {
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

function offerStockActionLabel(offer: BomQuoteCandidateOfferType): string {
  const state = offerStockState(offer);
  if (state === 'out_of_stock') return '재고 없음';
  if (state === 'insufficient_stock') return '재고 부족';
  if (state === 'catalog_inquiry') return '문의 견적';
  if (state === 'stock_unverified') return '재고 확인 필요';
  return '선택 불가';
}

function offerStockBadgeClass(offer: BomQuoteCandidateOfferType): string {
  return offerStockState(offer) === 'out_of_stock'
    ? 'bg-red-600 text-white'
    : offerStockState(offer) === 'insufficient_stock'
      ? 'bg-amber-100 text-amber-900'
      : offerStockState(offer) === 'catalog_inquiry'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-200 text-slate-700';
}

function offerStockRowClass(offer: BomQuoteCandidateOfferType): string {
  return offerStockState(offer) === 'out_of_stock'
    ? 'bg-red-50/70'
    : offerStockState(offer) === 'insufficient_stock'
      ? 'bg-amber-50/50'
      : offerStockState(offer) === 'catalog_inquiry'
        ? 'bg-blue-50/40'
        : '';
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
      return '오퍼 없음';
    case 'other':
      return '구매조건 확인 필요';
    case null:
    case undefined:
      break;
  }
  const states = candidate.offers.map(offerStockState);
  if (states.length > 0 && states.every((state) => state === 'out_of_stock')) {
    return '재고 없음';
  }
  if (
    states.length > 0
    && states.every((state) => state === 'out_of_stock' || state === 'insufficient_stock')
  ) return '재고 부족';
  if (states.length > 0 && states.every((state) => state === 'stock_unverified')) {
    return '재고 확인 필요';
  }
  if (states.length > 0 && states.every((state) => state === 'catalog_inquiry')) {
    return candidate.selected ? '선정됨 · 재고/가격 문의' : '취급 가능 · 재고 확인';
  }
  return '재고·가격 구매조건 미충족';
}

function procurementBlockingReason(): string | null {
  switch (props.context?.procurementUnavailabilityReason) {
    case 'input_incomplete':
      return '원본 BOM의 수량 또는 참조번호 충돌을 확인해야 구매조건을 적용할 수 있습니다.';
    case 'price_unavailable':
      return '필요수량에 적용할 가격 또는 환율 정보를 확인할 수 없습니다.';
    case 'catalog_inquiry':
      return '제조사 카탈로그 정확 일치로 부품은 선정됐으며 실제 재고와 가격 문의가 필요합니다.';
    case 'technical_unavailable':
      return '재고가 있더라도 필수 기술 조건을 충족하지 않아 선택할 수 없습니다.';
    case 'supplier_unavailable':
      return '현재 견적에서 허용된 공급사의 구매 가능한 오퍼가 없습니다.';
    case 'no_offer':
      return '구매 가능한 공급사 오퍼를 찾지 못했습니다.';
    case 'other':
      return '엔진 구매조건 판정을 통과한 오퍼가 없습니다.';
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
      return '오퍼 없음';
    case 'other':
      return '구매조건 확인 필요';
    case 'out_of_stock':
    case 'insufficient_stock':
    case 'stock_unverified':
    case null:
    case undefined:
      return null;
  }
}

function candidateBlockingReason(candidate: BomQuoteCandidateType): string {
  if (candidate.conflicts.length > 0) {
    return `기술 조건 충돌: ${conflictText(candidate)}`;
  }
  if (candidate.selectionReasonCodes.includes('identity_exact_requirement_conflict')) {
    return '품번은 일치하지만 요구 사양과 충돌합니다.';
  }
  if (candidate.missingRequirements.length > 0) {
    return `필수조건 확인 필요: ${missingText(candidate)}`;
  }
  if (candidate.selectionReasonCodes.includes('strict_category_coverage_incomplete')) {
    return '부품 유형별 필수조건 검증이 완료되지 않았습니다.';
  }
  if (candidate.selectionReasonCodes.includes('verification_incomplete')) {
    return '필수조건 검증이 완료되지 않았습니다.';
  }
  if (candidate.selectionReasonCodes.includes('relationship_unresolved')) {
    return '원본 BOM과 후보의 동일 부품 관계를 확인할 수 없습니다.';
  }
  return '엔진 기술 판정상 직접 선택할 수 없는 후보입니다.';
}

function offerUnavailableReason(
  candidate: BomQuoteCandidateType,
  offer: BomQuoteCandidateOfferType,
): string {
  if (offer.offerKind === 'manufacturer_catalog') {
    return '제조사 카탈로그 취급 부품입니다. 실제 재고 확인과 가격 문의 후 구매조건을 확정할 수 있습니다.';
  }
  if (!candidate.manualSelectable) return candidateBlockingReason(candidate);
  const reasons = new Set(offer.decisionReasonCodes);
  if (
    reasons.has('procurement_quantity_confirmation_required')
    || reasons.has('quantity_reference_conflict')
  ) {
    return '원본 BOM의 수량 또는 참조번호 충돌을 확인해야 구매조건을 적용할 수 있습니다.';
  }
  const procurementReason = procurementBlockingReason();
  if (procurementReason !== null) return procurementReason;
  if (reasons.has('stock_short') || reasons.has('stock_shortage_not_allowed')) {
    return offerStockLabel(offer) || '필요수량보다 재고가 부족합니다.';
  }
  if (reasons.has('stock_unverified') || reasons.has('stock_unverified_not_allowed')) {
    return '공급사 재고를 확인할 수 없습니다.';
  }
  if (
    reasons.has('price_unavailable')
    || reasons.has('price_break_unavailable_for_quantity')
  ) return '필요수량에 적용할 가격 정보가 없습니다.';
  if (reasons.has('currency_rate_missing')) return '견적 통화로 환산할 환율 정보가 없습니다.';
  if (reasons.has('supplier_not_allowed')) return '현재 견적에서 허용하지 않는 공급사입니다.';
  if (reasons.has('required_quantity_missing')) return '필요수량을 확인할 수 없습니다.';
  if (reasons.has('invalid_moq') || reasons.has('invalid_order_multiple')) {
    return '공급사의 MOQ 또는 주문배수 정보가 올바르지 않습니다.';
  }
  if (reasons.has('stable_offer_identity_unavailable')) {
    return '공급사 오퍼 식별 정보를 확인할 수 없습니다.';
  }
  if (reasons.has('procurement_excluded')) return '조달 대상에서 제외된 행입니다.';
  return '가격·재고 구매조건을 충족하지 못했습니다.';
}

function selectionTemporarilyLocked(): boolean {
  return props.selecting || props.interactionLocked;
}

function candidateActionDisabled(candidate: BomQuoteCandidateType): boolean {
  return selectionTemporarilyLocked()
    || !candidate.manualSelectable
    || candidate.bestOfferKey === null
    || bestOfferAlreadySelected(candidate);
}

function candidateActionLabel(candidate: BomQuoteCandidateType): string {
  if (selectionTemporarilyLocked()) return '선택 적용 중';
  if (candidate.bestOfferKey === null && candidateHasCatalogInquiry(candidate)) {
    return candidate.selected ? '선정됨 · 문의 진행' : '문의 견적';
  }
  if (!candidate.manualSelectable) return '선택 불가';
  if (candidate.bestOfferKey === null) return candidateUnavailableLabel(candidate);
  if (provisionalSelectionPending.value && candidate.selected) return '검토 완료';
  if (bestOfferAlreadySelected(candidate)) return '현재 구매조건 오퍼';
  if (candidate.recommended && candidate.selectionEligibility === 'manual_review') {
    return '권장 후보 검토 후 선택';
  }
  if (candidate.selectionEligibility === 'manual_review') return '검토 후 선택';
  if (candidate.selected) return '구매조건 오퍼로 변경';
  if (candidate.recommended) return '자동 추천 적용';
  return '구매조건 오퍼로 선택';
}

function candidateActionDisabledReason(candidate: BomQuoteCandidateType): string | null {
  if (selectionTemporarilyLocked()) return '다른 선택을 적용하는 중입니다.';
  if (candidate.bestOfferKey === null && candidateHasCatalogInquiry(candidate)) {
    return candidate.selected
      ? '부품은 선정됐습니다. 실제 재고 확인과 가격 문의 후 구매조건을 확정합니다.'
      : '제조사 카탈로그 취급 부품입니다. 실제 재고 확인과 가격 문의가 필요합니다.';
  }
  if (!candidate.manualSelectable) return candidateBlockingReason(candidate);
  if (candidate.bestOfferKey === null) {
    return procurementBlockingReason() ?? `구매 불가: ${candidateUnavailableLabel(candidate)}`;
  }
  return null;
}

function offerActionDisabled(
  candidate: BomQuoteCandidateType,
  offer: BomQuoteCandidateOfferType,
): boolean {
  return selectionTemporarilyLocked()
    || !candidate.manualSelectable
    || !offer.purchasable
    || offer.applied === null
    || offerAlreadyConfirmed(candidate, offer);
}

function offerActionLabel(
  candidate: BomQuoteCandidateType,
  offer: BomQuoteCandidateOfferType,
): string {
  if (selectionTemporarilyLocked()) return '선택 적용 중';
  if (offer.offerKind === 'manufacturer_catalog') return '문의 견적';
  if (!candidate.manualSelectable) return '선택 불가';
  if (offerAlreadyConfirmed(candidate, offer)) return '현재 사용 중';
  if (!offer.purchasable || offer.applied === null) {
    return procurementBlockingActionLabel() ?? offerStockActionLabel(offer);
  }
  if (
    provisionalSelectionPending.value
    && candidate.selected
    && props.context?.selectedOfferKey === offer.offerKey
  ) return '이 오퍼 확인 완료';
  return '이 오퍼 선택';
}

function offerActionDisabledReason(
  candidate: BomQuoteCandidateType,
  offer: BomQuoteCandidateOfferType,
): string | null {
  if (selectionTemporarilyLocked()) return '다른 선택을 적용하는 중입니다.';
  if (!candidate.manualSelectable || !offer.purchasable || offer.applied === null) {
    return offerUnavailableReason(candidate, offer);
  }
  return null;
}

function candidateActionReasonId(candidate: BomQuoteCandidateType): string {
  return `candidate-action-reason-${candidate.candidateKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function offerActionReasonId(offer: BomQuoteCandidateOfferType): string {
  return `offer-action-reason-${offer.offerKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function fmtDelta(value: number | null): string {
  if (value === null || value === 0) return '현재와 동일';
  return `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`;
}

function fmtRate(value: number | null): string {
  if (value === null) return '';
  return `${Math.abs(value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
}

function fmtUnit(offer: BomQuoteCandidateOfferType): string {
  if (offer.offerKind === 'manufacturer_catalog') return '문의 견적';
  const applied = offer.applied;
  if (applied === null) return '가격 없음';
  const prefix = applied.currency === 'KRW' ? '₩' : applied.currency === 'USD' ? '$' : `${applied.currency} `;
  return `${prefix}${applied.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

function fmtOfferTotal(offer: BomQuoteCandidateOfferType): string {
  return offer.offerKind === 'manufacturer_catalog'
    ? '문의 견적'
    : fmtWon(offer.applied?.lineTotalKrw ?? null);
}

function fmtAge(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '방금';
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}분 전`;
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}시간 전`;
  return `${String(Math.floor(elapsed / 86_400_000))}일 전`;
}

const pendingReviewOffer = computed(() => {
  const pending = pendingReviewSelection.value;
  if (pending === null) return null;
  const offerKey = pending.offerKey ?? pending.candidate.bestOfferKey;
  return pending.candidate.offers.find((offer) => offer.offerKey === offerKey) ?? null;
});

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
    props.readOnly
    || props.selecting
    || props.interactionLocked
    || !candidate.manualSelectable
    || candidate.bestOfferKey === null
  ) return;
  requestSelection(candidate, null);
}

function bestOfferAlreadySelected(candidate: BomQuoteCandidateType): boolean {
  return candidate.selected
    && candidate.bestOfferKey === props.context?.selectedOfferKey
    && !provisionalSelectionPending.value;
}

function offerAlreadyConfirmed(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): boolean {
  return candidate.selected
    && props.context?.selectedOfferKey === offer.offerKey
    && !provisionalSelectionPending.value;
}

function selectOffer(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): void {
  if (
    props.readOnly
    || props.selecting
    || props.interactionLocked
    || !candidate.manualSelectable
    || !offer.purchasable
    || offer.applied === null
  ) return;
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

function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape') return;
  if (requirementTooltipCandidateKey.value !== null) {
    hideRequirementTooltipNow();
    return;
  }
  if (pendingReviewSelection.value !== null) {
    pendingReviewSelection.value = null;
    return;
  }
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', hideRequirementTooltipNow);
  document.addEventListener('pointerdown', onDocumentPointerDown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', hideRequirementTooltipNow);
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  cancelRequirementTooltipClose();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] flex justify-end bg-slate-950/50" role="presentation" @mousedown.self="emit('close')">
      <aside class="flex h-full w-full max-w-4xl flex-col bg-surface-raised shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="candidate-drawer-title">
        <header class="shrink-0 border-b border-slate-200 bg-surface px-5 py-2.5 sm:px-6">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex min-w-0 items-baseline gap-2">
                <h2 id="candidate-drawer-title" class="truncate text-lg font-bold text-slate-950">부품 선택</h2>
                <p class="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Part selection</p>
              </div>
              <p v-if="context !== null" class="mt-0.5 truncate text-sm text-slate-500">
                Excel 원본 {{ context.originalMpn ?? context.originalValue ?? '품번 미기재' }} · 필요수량 {{ context.neededQty.toLocaleString('ko-KR') }}개
              </p>
              <p v-else-if="searchInitialQuery !== ''" class="mt-0.5 truncate text-sm text-slate-500">현재 품번 {{ searchInitialQuery }}</p>
            </div>
            <button type="button" class="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-surface text-xl text-slate-500 hover:bg-slate-100" aria-label="후보 패널 닫기" @click="emit('close')">×</button>
          </div>
        </header>

        <nav class="grid shrink-0 grid-cols-2 gap-1 border-b border-slate-200 bg-surface px-5 pt-1 sm:px-6" aria-label="부품 선택 방식">
          <button
            type="button"
            class="border-b-2 px-3 py-2 text-sm font-bold transition"
            :class="view === 'candidates' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
            @click="view = 'candidates'"
          >
            추천 후보
            <span v-if="context !== null" class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{{ context.candidates.length }}</span>
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="border-b-2 px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
            :class="view === 'search' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
            :disabled="interactionLocked"
            @click="view = 'search'"
          >
            전체 부품 검색
          </button>
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto" @scroll="hideRequirementTooltipNow">
          <div v-if="view === 'search'" class="space-y-4 p-4 sm:p-6">
            <div v-if="selectionError !== ''" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{{ selectionError }}</div>
            <section class="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p class="text-xs font-bold uppercase tracking-wide text-blue-600">Manual catalog selection</p>
                  <h3 class="mt-1 text-base font-bold text-slate-950">엔진 후보 밖에서 직접 찾기</h3>
                  <p class="mt-1 text-xs leading-5 text-slate-600">품번·스펙·패키지로 전체 카탈로그를 검색합니다. 선택 결과는 엔진 추천과 섞지 않고 <b class="text-slate-800">직접 검색</b>으로 기록됩니다.</p>
                </div>
                <div class="shrink-0 rounded-xl border border-blue-100 bg-surface px-3 py-2 text-xs text-slate-600 sm:text-right">
                  <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-400">현재 부품</span>
                  <b class="mt-0.5 block max-w-64 break-all text-slate-900">{{ context?.currentMpn || searchInitialQuery || '미선정' }}</b>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-5">
              <div class="mb-4">
                <h3 class="font-bold text-slate-900">카탈로그 검색</h3>
                <p class="mt-1 text-xs text-slate-500">부품을 고른 뒤 공급 포장·공급사·실제 주문수량과 총액을 확인하고 적용합니다.</p>
              </div>
              <BomPartSearchPanel
                :initial-query="searchInitialQuery"
                :current-part-id="currentPartId"
                :selecting="catalogSelecting || interactionLocked"
                :needed="needed"
                :usd-krw-rate="usdKrwRate"
                @select="selectCatalogPart"
              />
            </section>
          </div>
          <div v-else-if="loading" class="grid min-h-80 place-items-center p-8 text-sm text-slate-500">
            <div class="text-center"><span class="mx-auto mb-3 block size-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />후보 스냅샷을 불러오는 중입니다.</div>
          </div>
          <div v-else-if="failed" class="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <strong>후보 정보를 불러오지 못했습니다.</strong>
            <p class="mt-1">견적은 유지되어 있습니다. 패널을 닫고 다시 시도해 주세요.</p>
          </div>
          <template v-else-if="context !== null">
            <div class="space-y-2.5 p-3">
              <div v-if="selectionError !== ''" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{{ selectionError }}</div>
              <div
                v-if="requirementsProgress !== ''"
                class="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm"
                role="status"
                aria-live="polite"
              >
                <span class="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden="true" />
                <div>
                  <p class="font-bold">{{ requirementsProgress }}</p>
                  <p class="mt-0.5 text-xs leading-5 text-blue-700">현재 후보는 이전 검색 결과이며, 완료되면 이 패널 안에서 자동으로 교체됩니다.</p>
                </div>
              </div>
              <div
                v-else-if="requirementsNotice !== ''"
                class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm"
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true">✓</span>
                {{ requirementsNotice }}
              </div>
              <section class="rounded-xl border border-slate-200 bg-surface px-3 py-2 shadow-sm" aria-labelledby="original-bom-title">
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                    <div class="flex items-baseline gap-2">
                      <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Excel source</p>
                      <h3 id="original-bom-title" class="font-bold text-slate-950">원본 BOM</h3>
                    </div>
                    <span v-if="originalLocation !== null" class="truncate text-[11px] font-medium text-slate-500" :title="originalLocation.title">
                      {{ originalLocation.value }}
                    </span>
                    <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      BOM {{ context.bomQty.toLocaleString('ko-KR') }} · 필요 {{ context.neededQty.toLocaleString('ko-KR') }}
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-1.5">
                    <template v-if="context.extraction !== null">
                      <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        근거 {{ originalExtractionSummary.verified }}/{{ originalExtractionSummary.extracted }}
                      </span>
                      <span v-if="originalExtractionSummary.inferred > 0" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                        추론 {{ originalExtractionSummary.inferred }}
                      </span>
                      <span v-if="engineSearchExcluded" class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                        검색 제외
                      </span>
                      <span v-else-if="originalExtractionSummary.review > 0 || context.extraction.reviewStatus !== 'extracted'" class="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                        검토 {{ Math.max(originalExtractionSummary.review, 1) }}
                      </span>
                    </template>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-surface px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700"
                      :aria-expanded="originalDetailsExpanded"
                      aria-controls="original-bom-details"
                      @click="originalDetailsExpanded = !originalDetailsExpanded"
                    >
                      {{ originalDetailsExpanded ? '전체 추출값 접기' : `전체 추출값 ${String(originalDetailCount)}개` }}
                      <span aria-hidden="true">{{ originalDetailsExpanded ? '▴' : '▾' }}</span>
                    </button>
                  </div>
                </div>

                <dl class="mt-1.5 grid grid-cols-2 gap-1 border-t border-slate-100 pt-1.5 sm:grid-cols-6">
                  <div
                    v-for="field in originalSummaryFields"
                    :key="field.key"
                    class="min-w-0 rounded-md border px-2 py-1"
                    :class="[
                      field.summarySpan,
                      field.certainty === 'inferred'
                        ? 'border-amber-200 bg-amber-50/50'
                        : field.certainty === 'review'
                          ? 'border-rose-200 bg-rose-50/60'
                          : 'border-slate-100 bg-slate-50/60',
                    ]"
                  >
                    <dt class="flex items-center justify-between gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <span>{{ field.label }}</span>
                      <span
                        v-if="field.certainty !== undefined"
                        class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold normal-case tracking-normal"
                        :class="field.certainty === 'verified'
                          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                          : field.certainty === 'inferred'
                            ? 'bg-amber-100 text-amber-700'
                            : field.certainty === 'review'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-slate-200 text-slate-600'"
                        :title="field.provenance"
                      >
                        {{ field.certainty === 'verified' ? '✓ 확인' : field.certainty === 'inferred' ? '≈ 추론' : field.certainty === 'review' ? '! 검토' : '? 미상' }}
                      </span>
                    </dt>
                    <dd
                      class="mt-0.5 truncate text-sm leading-5"
                      :class="field.certainty === 'verified' ? 'font-bold text-slate-950' : 'font-semibold text-slate-800'"
                      :title="field.title"
                    >
                      {{ field.value }}
                    </dd>
                    <p v-if="field.normalizedValue !== undefined && field.normalizedValue !== null" class="truncate text-[11px] font-medium text-blue-700">
                      정규화 {{ field.normalizedValue }}
                    </p>
                  </div>
                </dl>

                <div v-if="engineSearchExcluded" class="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5">
                  <span class="text-[11px] font-bold text-slate-800">검색 제외</span>
                  <span v-if="originalExtractionAlerts.length === 0" class="text-[11px] text-slate-600">엔진이 공급사 검색 대상이 아닌 행으로 판정했습니다.</span>
                  <span v-for="alert in originalExtractionAlerts" :key="`excluded-${alert}`" class="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-700">{{ alert }}</span>
                </div>
                <div v-else-if="originalReviewFields.length > 0 || originalExtractionAlerts.length > 0" class="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5">
                  <span class="text-[11px] font-bold text-rose-700">검토 필요</span>
                  <span v-for="field in originalReviewFields" :key="`review-${field.key}`" class="text-[11px] text-rose-700">{{ field.label }} {{ field.value }}</span>
                  <span v-for="alert in originalExtractionAlerts" :key="alert" class="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-rose-700">{{ alert }}</span>
                </div>

                <div v-show="originalDetailsExpanded" id="original-bom-details" class="mt-2 border-t border-slate-200 pt-2">
                  <div class="flex flex-wrap items-center justify-between gap-1">
                    <p class="text-xs font-bold text-slate-700">전체 추출값과 근거</p>
                    <p class="text-[11px] text-slate-500">원문 우선 · 정규화값 보조</p>
                  </div>
                  <dl class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <div
                      v-for="field in originalFields"
                      :key="`detail-${field.key}`"
                      class="min-w-0 rounded-md border px-2.5 py-1.5"
                      :class="[
                        field.wide ? 'col-span-2' : '',
                        field.certainty === 'inferred'
                          ? 'border-amber-200 bg-amber-50/40'
                          : field.certainty === 'review'
                            ? 'border-rose-200 bg-rose-50/50'
                            : 'border-slate-100 bg-surface',
                      ]"
                    >
                      <dt class="flex flex-wrap items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <span>{{ field.label }}</span>
                        <span
                          v-if="field.provenance !== undefined"
                          class="rounded-full px-1.5 py-0.5 normal-case tracking-normal"
                          :class="field.certainty === 'verified'
                            ? 'bg-emerald-50 text-emerald-700'
                            : field.certainty === 'inferred'
                              ? 'bg-amber-50 text-amber-700'
                              : field.certainty === 'review'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-600'"
                        >{{ field.certainty === 'verified' ? '✓ ' : field.certainty === 'inferred' ? '≈ ' : field.certainty === 'review' ? '! ' : '? ' }}{{ field.provenance }}</span>
                      </dt>
                      <dd class="mt-0.5 break-words text-sm font-semibold leading-5 text-slate-800" :title="field.title">{{ field.value }}</dd>
                      <p v-if="field.normalizedValue !== undefined && field.normalizedValue !== null" class="mt-0.5 text-xs font-medium text-blue-700">
                        정규화 {{ field.normalizedValue }}
                      </p>
                      <p v-if="field.evidenceCells !== undefined && field.evidenceCells.length > 0" class="mt-0.5 text-[11px] text-slate-500">
                        근거 {{ field.evidenceCells.join(', ') }}
                      </p>
                    </div>
                  </dl>
                </div>
              </section>
              <section
                v-if="searchRequirementsVisible && !readOnly"
                class="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 shadow-sm"
                aria-labelledby="search-requirements-title"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 id="search-requirements-title" class="font-bold text-slate-950">검색 조건 보완</h3>
                      <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                        {{ requirementComponentLabel }}
                      </span>
                      <span
                        v-if="engineRequirementReadiness !== null"
                        class="rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset"
                        :class="engineRequirementReadiness === 'searchable'
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : engineRequirementReadiness === 'needs_user_input'
                            ? 'bg-amber-50 text-amber-700 ring-amber-200'
                            : 'bg-slate-100 text-slate-600 ring-slate-200'"
                      >
                        {{ engineRequirementReadiness === 'searchable' ? '엔진 검색 가능' : engineRequirementReadiness === 'needs_user_input' ? '엔진 보완 필요' : '검색 제외' }}
                      </span>
                      <span v-if="context.searchRequirements !== null" class="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">사용자 조건 저장됨</span>
                    </div>
                    <p v-if="engineSearchExcluded" class="mt-1 text-xs font-semibold leading-5 text-slate-600">
                      이 행은 엔진 판정에 따라 공급사 검색에서 제외되었습니다. 필요한 경우 전체 부품 검색에서 직접 선택할 수 있습니다.
                    </p>
                    <p v-else class="mt-1 text-xs leading-5 text-slate-600">
                      원본 BOM은 유지하고 이 행의 공급사 검색에만 적용합니다. 비워 둔 선택 조건은 자동선정을 막고 후보 검토 항목으로 남습니다.
                    </p>
                    <p
                      v-if="engineMissingRequirementLabels.length > 0"
                      class="mt-1 text-xs font-semibold text-amber-700"
                    >
                      엔진이 확인한 보완 항목: {{ engineMissingRequirementLabels.join(', ') }}
                    </p>
                  </div>
                </div>

                <form class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" :aria-busy="requirementsProgress !== ''" @submit.prevent="submitSearchRequirements">
                  <fieldset class="contents" :disabled="requirementsSaving || interactionLocked || engineSearchExcluded">
                    <label v-if="requirementComponentType === 'resistor'" class="text-xs font-semibold text-slate-700">
                      저항값 <b class="text-rose-600">*</b>
                      <input v-model.trim="resistance" type="text" maxlength="64" placeholder="예: 10kΩ" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'capacitor'" class="text-xs font-semibold text-slate-700">
                      정전용량 <b class="text-rose-600">*</b>
                      <input v-model.trim="capacitance" type="text" maxlength="64" placeholder="예: 100nF" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="requirementComponentType === 'capacitor'" class="text-xs font-semibold text-slate-700">
                      캐패시터 종류 <b class="text-rose-600">*</b>
                      <select v-model="capacitorType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="ceramic">MLCC / 세라믹</option>
                        <option value="electrolytic">전해</option>
                        <option value="tantalum">탄탈</option>
                        <option value="film">필름</option>
                      </select>
                    </label>

                    <label v-if="requirementComponentType === 'inductor'" class="text-xs font-semibold text-slate-700">
                      인덕터 종류 <b class="text-rose-600">*</b>
                      <select v-model="inductorType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="standard">일반 인덕터</option>
                        <option value="ferrite">페라이트 비드</option>
                      </select>
                    </label>
                    <label v-if="requirementComponentType === 'inductor' && inductorType === 'standard'" class="text-xs font-semibold text-slate-700">
                      인덕턴스 <b class="text-rose-600">*</b>
                      <input v-model.trim="inductance" type="text" maxlength="64" placeholder="예: 10uH" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'inductor' && inductorType === 'ferrite'" class="text-xs font-semibold text-slate-700">
                      임피던스 <b class="text-rose-600">*</b>
                      <input v-model.trim="impedance" type="text" maxlength="64" placeholder="예: 120Ω" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'inductor' && inductorType === 'ferrite'" class="text-xs font-semibold text-slate-700">
                      임피던스 기준 주파수
                      <input v-model.trim="impedanceFrequency" type="text" maxlength="64" placeholder="예: 100MHz" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="requirementComponentType === 'diode'" class="text-xs font-semibold text-slate-700">
                      다이오드 종류 <b class="text-rose-600">*</b>
                      <select v-model="diodeType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="rectifier">정류</option>
                        <option value="signal">신호</option>
                        <option value="schottky">쇼트키</option>
                        <option value="zener">제너</option>
                        <option value="tvs">TVS</option>
                        <option value="photodiode">포토다이오드</option>
                      </select>
                    </label>

                    <label v-if="requirementComponentType === 'transistor'" class="text-xs font-semibold text-slate-700">
                      소자 종류 <b class="text-rose-600">*</b>
                      <select v-model="transistorType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="bjt">BJT</option>
                        <option value="mosfet">MOSFET</option>
                      </select>
                    </label>
                    <label v-if="requirementComponentType === 'transistor'" class="text-xs font-semibold text-slate-700">
                      극성 / 채널 <b class="text-rose-600">*</b>
                      <select v-model="transistorPolarity" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option v-if="transistorType !== 'mosfet'" value="npn">NPN</option>
                        <option v-if="transistorType !== 'mosfet'" value="pnp">PNP</option>
                        <option v-if="transistorType !== 'bjt'" value="n-channel">N-Channel</option>
                        <option v-if="transistorType !== 'bjt'" value="p-channel">P-Channel</option>
                      </select>
                    </label>

                    <label v-if="requirementComponentType === 'led'" class="text-xs font-semibold text-slate-700">
                      발광색 <b class="text-rose-600">*</b>
                      <input v-model.trim="color" type="text" maxlength="32" placeholder="예: Red / Green / White" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="requirementComponentType === 'crystal'" class="text-xs font-semibold text-slate-700">
                      소자 종류 <b class="text-rose-600">*</b>
                      <select v-model="crystalType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="crystal">크리스탈</option>
                        <option value="oscillator">오실레이터</option>
                        <option value="resonator">레조네이터</option>
                      </select>
                    </label>
                    <label v-if="requirementComponentType === 'crystal'" class="text-xs font-semibold text-slate-700">
                      주파수 <b class="text-rose-600">*</b>
                      <input v-model.trim="frequency" type="text" maxlength="64" placeholder="예: 16MHz" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="requirementComponentType === 'connector'" class="text-xs font-semibold text-slate-700">
                      핀 수 <b class="text-rose-600">*</b>
                      <input v-model.trim="pinCount" type="number" min="1" max="1000" step="1" placeholder="예: 4" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'connector'" class="text-xs font-semibold text-slate-700">
                      피치 <b class="text-rose-600">*</b>
                      <input v-model.trim="pitch" type="text" maxlength="32" placeholder="예: 2.54mm" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'connector'" class="text-xs font-semibold text-slate-700">
                      열 수
                      <input v-model.trim="rowCount" type="number" min="1" max="100" step="1" placeholder="모름 또는 예: 2" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>
                    <label v-if="requirementComponentType === 'connector'" class="text-xs font-semibold text-slate-700">
                      성별
                      <select v-model="connectorGender" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">모름 · 직접 검토</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="genderless">Genderless</option>
                      </select>
                    </label>
                    <label v-if="requirementComponentType === 'connector'" class="text-xs font-semibold text-slate-700">
                      방향
                      <select v-model="connectorOrientation" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">모름 · 직접 검토</option>
                        <option value="straight">Straight</option>
                        <option value="right-angle">Right Angle</option>
                        <option value="vertical">Vertical</option>
                      </select>
                    </label>

                    <label v-if="requirementComponentType === 'switch'" class="text-xs font-semibold text-slate-700">
                      스위치 종류 <b class="text-rose-600">*</b>
                      <select v-model="switchType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">선택 필요</option>
                        <option value="tactile">택트</option>
                        <option value="pushbutton">푸시버튼</option>
                        <option value="slide">슬라이드</option>
                        <option value="toggle">토글</option>
                        <option value="dip">DIP</option>
                        <option value="rotary">로터리</option>
                        <option value="reed">리드</option>
                        <option value="other">기타</option>
                      </select>
                    </label>
                    <label v-if="requirementComponentType === 'switch'" class="text-xs font-semibold text-slate-700">
                      접점 구성
                      <input v-model.trim="contactForm" type="text" maxlength="64" placeholder="모름 또는 예: SPST-NO" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label class="text-xs font-semibold text-slate-700">
                      패키지 / 외형 <b v-if="requirementComponentType !== 'connector'" class="text-rose-600">*</b>
                      <input v-model.trim="packageCode" type="text" maxlength="64" :placeholder="requirementComponentType === 'connector' ? '선택 · 예: 2x2 Header' : '예: 0603 / SOT-23 / 6x6mm'" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="['resistor', 'capacitor', 'inductor', 'crystal'].includes(requirementComponentType ?? '')" class="text-xs font-semibold text-slate-700">
                      허용오차
                      <input v-model.trim="tolerance" type="text" maxlength="64" placeholder="모름 또는 예: 10%" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="['resistor', 'diode', 'transistor'].includes(requirementComponentType ?? '')" class="text-xs font-semibold text-slate-700">
                      정격전력
                      <input v-model.trim="power" type="text" maxlength="64" placeholder="조건 없음 또는 예: 0.1W" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="['capacitor', 'diode', 'transistor', 'led', 'switch'].includes(requirementComponentType ?? '')" class="text-xs font-semibold text-slate-700">
                      정격전압 <b v-if="requirementComponentType === 'diode' && ['zener', 'tvs'].includes(diodeType)" class="text-rose-600">*</b>
                      <input v-model.trim="voltage" type="text" maxlength="64" placeholder="모름 또는 예: 25V" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="['inductor', 'diode', 'transistor', 'led', 'switch'].includes(requirementComponentType ?? '')" class="text-xs font-semibold text-slate-700">
                      정격전류
                      <input v-model.trim="current" type="text" maxlength="64" placeholder="모름 또는 예: 1A" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                    </label>

                    <label v-if="requirementComponentType === 'capacitor' && capacitorType === 'ceramic'" class="text-xs font-semibold text-slate-700">
                      유전체
                      <select v-model="dielectric" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">모름 · 직접 검토</option>
                        <option value="C0G">C0G / NP0</option>
                        <option value="X5R">X5R</option>
                        <option value="X7R">X7R</option>
                        <option value="X8R">X8R</option>
                        <option value="Y5V">Y5V</option>
                      </select>
                    </label>

                    <label class="text-xs font-semibold text-slate-700">
                      실장방식
                      <select v-model="mountStyle" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                        <option value="">자동 판정</option>
                        <option value="smd">SMD</option>
                        <option value="through-hole">THT</option>
                      </select>
                    </label>

                    <div class="flex flex-col justify-end sm:col-span-2 lg:col-span-4">
                      <p v-if="requirementsError !== ''" class="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{{ requirementsError }}</p>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-[11px] text-slate-500">
                          {{ engineSearchExcluded
                            ? '검색 제외 사유는 원본 BOM에 유지되며, 검색 조건 재검색은 실행하지 않습니다.'
                            : '정격은 이상(≥), 허용오차는 이하(≤)로 검증합니다. 신규 유형의 최소 조건 검색은 후보 검토 대상으로 유지됩니다.' }}
                        </p>
                        <button type="submit" class="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="requirementsSaving || interactionLocked || engineSearchExcluded || !searchRequirementsValid">
                          {{ engineSearchExcluded ? '검색 제외 행' : requirementsSaving ? '행 재검색 시작 중…' : context.searchRequirements === null ? '조건 저장 후 검색' : '조건 변경 후 재검색' }}
                        </button>
                      </div>
                    </div>
                  </fieldset>
                </form>
              </section>
              <section
                v-if="context.localCatalogTrace?.catalogType === 'ingested_rc' && context.localCatalogTrace.outcome === 'selected' && !readOnly"
                class="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950 shadow-sm"
              >
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p class="font-bold">실험: 저장된 부품을 먼저 검색했습니다</p>
                    <p class="mt-0.5 text-violet-800">
                      기존에 저장된 공급사 부품 중 값과 패키지가 일치하는 후보를 엔진이 확인해 외부 API 호출을 생략했습니다. 추가 검색을 실행하면 기존 외부 공급사 판단 결과로 이 행의 후보와 선정을 갱신합니다.
                    </p>
                    <p v-if="externalSearchError !== ''" class="mt-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                      {{ externalSearchError }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded-md bg-violet-700 px-3 py-2 font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    :disabled="externalSearchRunning || interactionLocked"
                    @click="emit('externalSupplierSearch')"
                  >
                    {{ externalSearchRunning ? '외부 공급사 검색 중…' : '외부 공급사 추가 검색' }}
                  </button>
                </div>
              </section>
              <section
                v-if="context.localCatalogTrace !== null || context.searchTrace !== null"
                class="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm"
              >
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  :aria-expanded="searchTraceExpanded"
                  aria-controls="supplier-search-trace"
                  @click="searchTraceExpanded = !searchTraceExpanded"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 text-xs font-bold text-slate-800">{{ t('bomSearchTrace.process') }}</span>
                    <span class="min-w-0 truncate text-xs text-slate-600" :title="searchTracePrimaryQuery">{{ searchTracePrimaryQuery }}</span>
                    <span v-if="context.searchTrace?.fallbackUsed" class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{{ t('bomSearchTrace.fallbackBadge') }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-slate-500">
                    {{ t('bomSearchTrace.attempts', { count: searchTraceStageCount }) }}
                    <span aria-hidden="true">{{ searchTraceExpanded ? '▴' : '▾' }}</span>
                  </span>
                </button>
                <div v-show="searchTraceExpanded" id="supplier-search-trace" class="border-t border-slate-200 bg-slate-50/60 px-3 py-2.5">
                  <div class="mb-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-[11px] text-blue-800">
                    <p class="font-bold">{{ t('bomSearchTrace.finalCandidates', { count: context.candidates.length }) }}</p>
                    <p class="mt-0.5 text-blue-700">{{ t('bomSearchTrace.rawResponseHelp') }}</p>
                  </div>
                  <div v-if="context.searchTrace?.fallbackQuery" class="mb-2 grid min-w-0 gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] sm:grid-cols-[auto_1fr]">
                    <b class="text-amber-800">{{ t('bomSearchTrace.fallbackBadge') }}</b>
                    <span class="break-words text-amber-900">{{ context.searchTrace.fallbackQuery }}</span>
                  </div>
                  <ol class="space-y-1.5">
                    <li
                      v-if="context.localCatalogTrace !== null"
                      :class="[
                        'grid gap-x-2 gap-y-1 rounded-md border px-2.5 py-2 text-[11px] sm:grid-cols-[24px_132px_minmax(0,1fr)_auto] sm:items-start',
                        localCatalogOutcomeClasses(context.localCatalogTrace),
                      ]"
                    >
                      <span class="flex size-5 items-center justify-center rounded-full bg-white/80 font-bold tabular-nums text-slate-600">1</span>
                      <span class="font-semibold text-slate-800">
                        {{ localCatalogTitle(context.localCatalogTrace) }}
                        <small class="block font-normal uppercase text-slate-500">저장된 부품 조회 · 외부 API 0회</small>
                      </span>
                      <div class="min-w-0">
                        <span class="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">우선 조회</span>
                        <span class="break-words text-slate-700">{{ context.localCatalogTrace.query || '엔진 정규 검색조건' }}</span>
                        <span
                          v-if="localCatalogReasonLabel(context.localCatalogTrace) !== null"
                          class="mt-1 block text-slate-600"
                        >{{ localCatalogReasonLabel(context.localCatalogTrace) }}</span>
                        <div
                          v-if="localCatalogDecisionSummary !== null"
                          class="mt-2 space-y-1.5 rounded-md border border-slate-200/80 bg-white/80 p-2"
                        >
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="font-bold text-slate-700">
                              엔진 결론: {{ localCatalogDecisionStatusLabel(localCatalogDecisionSummary.procurementStatus) }}
                            </span>
                            <span
                              v-if="localCatalogUnavailabilityLabel(localCatalogDecisionSummary.primaryUnavailabilityReason) !== null"
                              class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"
                            >
                              {{ localCatalogUnavailabilityLabel(localCatalogDecisionSummary.primaryUnavailabilityReason) }}
                            </span>
                          </div>
                          <div class="flex flex-wrap gap-1">
                            <span class="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">
                              자동 가능 {{ localCatalogDecisionSummary.automaticCandidateCount.toLocaleString('ko-KR') }}
                            </span>
                            <span
                              v-if="localCatalogDecisionSummary.reviewCandidateCount > 0"
                              class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"
                            >
                              검토 필요 {{ localCatalogDecisionSummary.reviewCandidateCount.toLocaleString('ko-KR') }}
                            </span>
                            <span
                              v-if="localCatalogDecisionSummary.blockedCandidateCount > 0"
                              class="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800"
                            >
                              선정 제외 {{ localCatalogDecisionSummary.blockedCandidateCount.toLocaleString('ko-KR') }}
                            </span>
                            <span
                              v-if="localCatalogDecisionSummary.unclassifiedCandidateCount > 0"
                              class="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700"
                            >
                              상세 판정 없음 {{ localCatalogDecisionSummary.unclassifiedCandidateCount.toLocaleString('ko-KR') }}
                            </span>
                          </div>
                          <div
                            v-if="localCatalogDecisionSummary.reasonCounts.length > 0"
                            class="flex flex-wrap gap-1"
                            aria-label="자동선정 보류 주요 사유"
                          >
                            <span
                              v-for="reasonCount in localCatalogDecisionSummary.reasonCounts"
                              :key="`${reasonCount.kind}:${reasonCount.code}`"
                              class="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700"
                            >
                              {{ localCatalogReasonCountLabel(reasonCount) }}
                              {{ reasonCount.count.toLocaleString('ko-KR') }}개
                            </span>
                          </div>
                          <div
                            v-if="localCatalogDecisionSummary.recommendationReasonCodes.length > 0"
                            class="flex flex-wrap gap-1 text-slate-600"
                          >
                            <span
                              v-for="code in localCatalogDecisionSummary.recommendationReasonCodes.slice(0, 4)"
                              :key="code"
                              class="rounded bg-slate-100 px-1.5 py-0.5"
                            >
                              {{ localCatalogDecisionCodeLabel(code) }}
                            </span>
                          </div>
                          <details
                            v-if="localCatalogRepresentativeCandidate !== null"
                            class="rounded border border-slate-200 bg-slate-50/80 px-2 py-1.5"
                          >
                            <summary class="cursor-pointer font-semibold text-slate-700">
                              대표 후보 {{ localCatalogRepresentativeCandidate.mpn }}
                              <span v-if="localCatalogRepresentativeCandidate.manufacturerName !== null" class="font-normal text-slate-500">
                                · {{ localCatalogRepresentativeCandidate.manufacturerName }}
                              </span>
                            </summary>
                            <div class="mt-1.5 space-y-1.5 border-t border-slate-200 pt-1.5">
                              <div class="flex flex-wrap items-center gap-1.5">
                                <span
                                  :class="[
                                    'rounded px-1.5 py-0.5 font-semibold',
                                    localCatalogEligibilityClasses(localCatalogRepresentativeCandidate.selectionEligibility),
                                  ]"
                                >
                                  {{ localCatalogEligibilityLabel(localCatalogRepresentativeCandidate.selectionEligibility) }}
                                </span>
                                <span class="text-slate-600">
                                  {{ statusLabel(localCatalogRepresentativeCandidate.status) }}
                                  · 확인 조건
                                  {{ localCatalogRepresentativeCandidate.verifiedRequirementCount }}/{{ localCatalogRepresentativeCandidate.requiredRequirementCount }}
                                </span>
                              </div>
                              <div
                                v-if="localCatalogAttentionAssessments(localCatalogRepresentativeCandidate).length > 0"
                                class="space-y-1"
                              >
                                <div
                                  v-for="assessment in localCatalogAttentionAssessments(localCatalogRepresentativeCandidate)"
                                  :key="assessment.key"
                                  class="grid gap-x-2 rounded bg-surface px-2 py-1 sm:grid-cols-[100px_1fr_auto]"
                                >
                                  <b class="text-slate-700">{{ requirementLabel(assessment.key) }}</b>
                                  <span class="text-slate-600">
                                    요구 {{ requirementExpectedLabel(assessment) }}
                                    · 후보 {{ assessment.actualDisplay ?? '정보 없음' }}
                                  </span>
                                  <span :class="['rounded px-1.5 py-0.5 font-semibold', requirementStateClass(assessment)]">
                                    {{ requirementStateLabel(assessment) }}
                                  </span>
                                </div>
                              </div>
                              <p v-else class="text-slate-500">
                                항목별 미충족 정보는 없으며 엔진 정책 사유로 자동선정되지 않았습니다.
                              </p>
                            </div>
                          </details>
                        </div>
                      </div>
                      <span class="whitespace-nowrap text-right text-slate-500">
                        <b class="text-slate-800">{{ localCatalogOutcomeLabel(context.localCatalogTrace) }}</b>
                        <small class="block">
                          후보 {{ context.localCatalogTrace.candidateCount.toLocaleString('ko-KR') }}개
                          · 판정 {{ context.localCatalogTrace.evaluatedCandidateCount.toLocaleString('ko-KR') }}개
                        </small>
                        <small class="block">{{ traceElapsedLabel(context.localCatalogTrace.elapsedMs) }}</small>
                      </span>
                    </li>
                    <template v-if="context.searchTrace !== null">
                      <li
                        v-for="attempt in context.searchTrace.attempts"
                        :key="attempt.sequence"
                        class="grid gap-x-2 gap-y-1 rounded-md border border-slate-200 bg-surface px-2.5 py-2 text-[11px] sm:grid-cols-[24px_108px_minmax(0,1fr)_auto] sm:items-start"
                      >
                        <span class="flex size-5 items-center justify-center rounded-full bg-slate-100 font-bold tabular-nums text-slate-600">
                          {{ attempt.sequence + (context.localCatalogTrace === null ? 0 : 1) }}
                        </span>
                        <span class="font-semibold text-slate-700">
                          {{ traceCodeLabel('stage', attempt.stage) }}
                          <small class="block truncate font-normal uppercase text-slate-400">{{ attempt.supplier }}</small>
                        </span>
                        <span class="min-w-0">
                          <span class="mr-1.5 rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">{{ traceCodeLabel('strategy', attempt.strategy) }}</span>
                          <span class="break-words text-slate-700">{{ attempt.query }}</span>
                          <span v-if="attempt.fallbackReason !== null" class="mt-1 block text-amber-700">{{ traceCodeLabel('fallbackReason', attempt.fallbackReason) }}</span>
                          <span v-if="attempt.errorType !== null" class="mt-1 block text-rose-700">{{ attempt.errorType }}</span>
                        </span>
                        <span class="whitespace-nowrap text-right text-slate-500">
                          <b class="text-slate-700">{{ traceOutcomeLabel(attempt) }}</b>
                          <small class="block">{{ traceCodeLabel('source', attempt.source) }} · {{ traceElapsedLabel(attempt.elapsedMs) }}</small>
                        </span>
                      </li>
                    </template>
                  </ol>
                </div>
              </section>
              <section class="overflow-hidden rounded-xl border border-blue-200 bg-surface shadow-sm">
                <div class="flex flex-col gap-2 bg-gradient-to-r from-blue-700 to-blue-600 px-3 py-2.5 text-white sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{{ sourceLabel(context.selectionSource) }}</span>
                      <span v-if="provisionalSelectionPending" class="rounded-full bg-amber-300 px-2.5 py-1 text-xs font-bold text-amber-950">선정됨 · 검토 대기</span>
                      <span v-else-if="reviewSelectionConfirmed" class="rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-950">검토 완료</span>
                      <span v-else-if="currentCandidate?.recommended" class="rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-950">자동 추천과 동일</span>
                      <span v-else-if="currentCandidate !== null" class="rounded-full bg-amber-300 px-2.5 py-1 text-xs font-bold text-amber-950">추천에서 변경됨</span>
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 class="break-words text-lg font-bold">{{ context.currentMpn || '선정 부품 없음' }}</h3>
                      <p v-if="currentCandidate?.manufacturerName" class="text-sm text-blue-100">{{ currentCandidate.manufacturerName }}</p>
                    </div>
                  </div>
                  <div class="shrink-0 text-left sm:text-right">
                    <p class="text-xs text-blue-100">현재 행 예상금액</p>
                    <strong class="block text-xl tabular-nums">{{ fmtWon(context.currentLineTotalKrw) }}</strong>
                    <p class="text-xs text-blue-100">공급사 배송비·세금 제외</p>
                  </div>
                </div>
                <div class="flex flex-col gap-2 px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p class="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-400">선정 이유</p>
                    <div v-if="engineSearchExcluded" class="flex flex-wrap gap-1">
                      <span class="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700">공급사 검색 제외</span>
                      <span v-for="alert in originalExtractionAlerts" :key="`selection-excluded-${alert}`" class="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{{ alert }}</span>
                    </div>
                    <div v-else-if="context.decisionReasonCodes.length > 0" class="flex flex-wrap gap-1">
                      <span v-for="reason in context.decisionReasonCodes" :key="reason" class="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{{ reasonLabel(reason) }}</span>
                    </div>
                    <p v-else class="text-sm text-slate-500">기존 견적 또는 직접 검색으로 선정된 부품입니다.</p>
                  </div>
                  <div v-if="currentCandidate !== null" class="flex shrink-0 flex-wrap gap-x-3 gap-y-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <p>기술 <b class="text-slate-900">{{ currentCandidate.technicalRank }}위</b></p>
                    <p>구매조건 <b class="text-slate-900">{{ currentCandidate.priceRank === null ? '산정 불가' : `오퍼 ${String(currentCandidate.priceRank)}위` }}</b></p>
                    <button
                      type="button"
                      class="rounded px-1 text-left hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      :aria-describedby="requirementTooltipCandidateKey === currentCandidate.candidateKey ? requirementTooltipId : undefined"
                      @mouseenter="showRequirementTooltip(currentCandidate, $event)"
                      @mouseleave="scheduleRequirementTooltipClose"
                      @focus="showRequirementTooltip(currentCandidate, $event)"
                      @blur="scheduleRequirementTooltipClose"
                      @click.stop="showRequirementTooltip(currentCandidate, $event)"
                    >
                      {{ requirementBadgeLabel(currentCandidate) }}
                    </button>
                  </div>
                </div>
                <div
                  v-if="currentCandidate !== null && currentCandidate.selectionEligibility === 'automatic' && (currentCandidate.conflicts.length > 0 || currentCandidate.missingRequirements.length > 0)"
                  class="mx-3 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"
                  role="status"
                >
                  <b>품번 정확 일치로 선정했습니다.</b>
                  <span v-if="currentCandidate.conflicts.length > 0"> 추가 정보 불일치: {{ conflictText(currentCandidate) }}.</span>
                  <span v-if="currentCandidate.missingRequirements.length > 0"> 미확인 정보: {{ missingText(currentCandidate) }}.</span>
                </div>
                <div v-if="context.decisionReasonCodes.includes('purchase-fit')" class="mx-3 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                  일부 조건은 추가 확인이 필요하지만, 기술 근거가 같은 후보 중 필요수량·MOQ·예상금액이 가장 적합한 부품을 선택했습니다.
                </div>
              </section>

              <section class="rounded-xl border border-slate-200 bg-surface shadow-sm">
                <div class="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="font-bold text-slate-900">부품 후보</h3>
                    <p class="mt-1 text-xs text-slate-500">sp-engine의 기술 안전성 안에서 현재 선택·추천과 구매 가능한 재고를 먼저 표시합니다.</p>
                  </div>
                  <span class="rounded-md bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">추천·재고 우선 · 기술 순위 유지</span>
                </div>
                <div
                  v-if="procurementAvailabilityAlert !== null"
                  class="mx-3 mt-2 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                  :class="procurementAvailabilityAlert.classes"
                  role="status"
                >
                  <span class="grid size-6 shrink-0 place-items-center rounded-full text-sm font-black" :class="procurementAvailabilityAlert.iconClasses">!</span>
                  <div class="min-w-0">
                    <p class="text-sm font-extrabold">{{ procurementAvailabilityAlert.title }}</p>
                    <p class="mt-0.5 text-xs leading-5 opacity-90">{{ procurementAvailabilityAlert.detail }}</p>
                  </div>
                </div>
                <div v-if="recommendedCandidate !== null && recommendedCandidate.selectionEligibility === 'manual_review'" class="mx-3 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs" :class="reviewSelectionConfirmed ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'">
                  <p v-if="provisionalSelectionPending">
                    <b>선정됨 · 검토 대기</b> {{ recommendedCandidate.mpn }} —
                    <template v-if="context.technicalFallbackUsed">기술 1순위의 구매 가능한 오퍼가 없어 엔진이 다음 안전 후보를 임시 선정했습니다.</template>
                    <template v-else>엔진 임시 선정으로 예상 견적에 반영했습니다.</template>
                  </p>
                  <p v-else-if="reviewSelectionConfirmed"><b>검토 완료</b> {{ recommendedCandidate.mpn }} — 사용자가 엔진 검토 권장 후보를 확인했습니다.</p>
                  <p v-else><b>검토 권장</b> {{ recommendedCandidate.mpn }} — 엔진이 실제 적용 후보로 지정했습니다.</p>
                  <span v-if="recommendedCandidate.technicalReviewRank !== null" class="rounded-full bg-amber-200 px-2 py-0.5 font-bold">검토 {{ recommendedCandidate.technicalReviewRank }}순위</span>
                </div>
                <div class="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold" :class="tab === 'selectable' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'selectable'">선택 가능 {{ selectableCount }}</button>
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold" :class="tab === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'all'">전체 {{ context.candidates.length }}</button>
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold" :class="tab === 'review' ? 'bg-amber-50 text-amber-800' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'review'">검토 필요 {{ reviewCount }}</button>
                </div>

                <div v-if="candidates.length > 0" class="space-y-2 p-3">
                  <article v-for="candidate in candidates" :key="candidate.candidateKey" class="overflow-hidden rounded-lg border transition" :class="safetyClass(candidate)">
                    <div class="p-3">
                      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div class="flex min-w-0 flex-1 items-start gap-2.5">
                          <PartImage
                            :src="candidate.imageUrl"
                            :alt="`${candidate.mpn} 부품 이미지`"
                            class="size-14 shrink-0 rounded-md border border-slate-200"
                          />
                          <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-1.5">
                              <span v-if="candidate.selected" class="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" :class="provisionalSelectionPending ? 'bg-amber-600' : 'bg-blue-600'">{{ provisionalSelectionPending ? '현재 선택 · 검토 대기' : candidateHasCatalogInquiry(candidate) ? '현재 선정 · 문의' : '현재 선택' }}</span>
                              <span
                                v-if="recommendationLabel(candidate) !== ''"
                                class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                                :class="candidate.recommended && candidate.selectionEligibility === 'manual_review' ? 'bg-amber-200 text-amber-950' : candidate.recommended ? 'bg-emerald-100 text-emerald-800' : candidate.selectionRecommendation === 'exclude' ? 'bg-red-100 text-red-800' : candidate.selectionRecommendation === 'candidate_only' ? 'bg-slate-200 text-slate-700' : 'bg-violet-100 text-violet-800'"
                              >{{ recommendationLabel(candidate) }}</span>
                              <span v-if="candidate.technicalReviewRank !== null" class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">검토 {{ candidate.technicalReviewRank }}순위</span>
                              <span v-if="candidate.candidateKey === context.technicalTopCandidateKey" class="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">기술 1위</span>
                              <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{{ statusLabel(candidate.status) }}</span>
                              <span v-if="candidate.safety === 'caution'" class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{{ cautionLabel(candidate) }}</span>
                              <span v-if="candidate.safety === 'blocked'" class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">호환성 확인 필요</span>
                            </div>
                            <h4 class="mt-1.5 break-words text-base font-bold text-slate-950">{{ candidate.mpn }}</h4>
                            <p class="mt-1 text-sm text-slate-500">{{ candidate.manufacturerName ?? '제조사 미확인' }}<span v-if="candidate.packageCode"> · {{ candidate.packageCode }}</span><span v-if="candidate.lifecycleStatus"> · {{ candidate.lifecycleStatus }}</span></p>
                            <p v-if="candidate.description" class="mt-1 line-clamp-1 text-xs leading-5 text-slate-500" :title="candidate.description">{{ candidate.description }}</p>
                            <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                              <button
                                type="button"
                                class="rounded px-2 py-0.5 text-left transition hover:ring-2 hover:ring-current/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                :class="verificationClass(candidate)"
                                :aria-describedby="requirementTooltipCandidateKey === candidate.candidateKey ? requirementTooltipId : undefined"
                                @mouseenter="showRequirementTooltip(candidate, $event)"
                                @mouseleave="scheduleRequirementTooltipClose"
                                @focus="showRequirementTooltip(candidate, $event)"
                                @blur="scheduleRequirementTooltipClose"
                                @click.stop="showRequirementTooltip(candidate, $event)"
                              >
                                {{ requirementBadgeLabel(candidate) }}
                              </button>
                              <span v-if="context.originalMpn !== null" class="rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">품번 {{ Math.round(candidate.identityConfidence * 100) }}%</span>
                              <span class="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">공급사 {{ candidate.corroboratingSuppliers.length }}</span>
                            </div>
                          </div>
                        </div>
                        <div class="w-full shrink-0 rounded-lg border border-slate-200 bg-surface p-3 md:w-52">
                          <p class="text-xs text-slate-400">필요수량 기준 최적 오퍼</p>
                          <strong class="mt-0.5 block text-lg tabular-nums text-slate-950">{{ candidateTotalLabel(candidate) }}</strong>
                          <p v-if="candidate.bestLineTotalKrw !== null" class="mt-1 text-xs font-semibold" :class="(candidate.lineDeltaKrw ?? 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'">현재 대비 {{ fmtDelta(candidate.lineDeltaKrw) }}</p>
                          <p v-else class="mt-1 text-xs font-bold" :class="candidateUnavailableLabel(candidate) === '재고 없음' ? 'text-red-700' : 'text-amber-700'">{{ candidateUnavailableLabel(candidate) }}</p>
                          <p
                            v-if="candidateHasSevereBestOffer(candidate)"
                            class="mt-1 rounded bg-orange-100 px-2 py-1 text-[11px] font-bold leading-4 text-orange-800"
                            :title="candidateBestOfferSurplusLabel(candidate)"
                          >
                            과다 주문수량 · 자동추천 제외
                          </p>
                          <p v-if="candidate.savingsVsTechnicalKrw !== null && candidate.savingsVsTechnicalKrw > 0" class="mt-1 text-[11px] text-slate-500">기술 1위 대비 {{ fmtWon(candidate.savingsVsTechnicalKrw) }} 절감 {{ fmtRate(candidate.savingsVsTechnicalRate) }}</p>
                          <button
                            v-if="!readOnly"
                            type="button"
                            class="mt-2 h-9 w-full rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            :disabled="candidateActionDisabled(candidate)"
                            :aria-describedby="candidateActionDisabledReason(candidate) === null ? undefined : candidateActionReasonId(candidate)"
                            @click="selectBest(candidate)"
                          >
                            {{ candidateActionLabel(candidate) }}
                          </button>
                          <p
                            v-if="candidateActionDisabledReason(candidate) !== null"
                            :id="candidateActionReasonId(candidate)"
                            class="mt-1.5 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700"
                          >
                            {{ candidate.selected && candidateHasCatalogInquiry(candidate) ? '선정 완료:' : '선택 비활성:' }} {{ candidateActionDisabledReason(candidate) }}
                          </p>
                        </div>
                      </div>

                      <div
                        v-if="candidate.conflicts.length > 0"
                        class="mt-2 rounded-md px-2.5 py-1.5 text-xs"
                        :class="candidate.selectionEligibility === 'blocked' ? 'bg-red-100/70 text-red-800' : 'bg-amber-100/70 text-amber-900'"
                      >
                        <b>{{ conflictNoticePrefix(candidate) }}:</b> {{ conflictText(candidate) }}
                      </div>
                      <div v-if="candidate.selectionEligibility === 'manual_review'" class="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900">
                        <template v-if="candidateHasCatalogInquiry(candidate)"><b>제조사 카탈로그 취급:</b> 부품 식별은 확인됐지만 실제 재고와 가격은 문의 후 확정해야 합니다.</template>
                        <template v-else-if="candidate.recommended"><b>엔진 검토 권장:</b> 구매 가능한 재고·가격을 포함해 실제 적용 후보로 임시 선정했습니다. 예상 견적에는 반영되며, 확인 후 검토를 완료할 수 있습니다.</template>
                        <template v-else-if="context.technicalFallbackUsed && candidate.candidateKey === technicalTopCandidate?.candidateKey"><b>기술 1순위:</b> 기술 근거상 가장 앞선 후보지만 구매 가능한 오퍼가 없어 현재 견적에는 적용하지 않았습니다.</template>
                        <template v-else-if="candidate.reviewRecommended"><b>엔진 기술 검토 1순위:</b> 기술 근거상 가장 유력하지만 구매조건을 충족하지 못해 적용 후보와 분리했습니다.</template>
                        <template v-else><b>엔진 검토 필요:</b> 자동 선정 조건을 충족하지 않았습니다. 근거와 누락·충돌 항목을 확인한 뒤 직접 선택할 수 있습니다.</template>
                      </div>
                      <div v-if="candidate.missingRequirements.length > 0" class="mt-1.5 rounded-md bg-amber-100/70 px-2.5 py-1.5 text-xs text-amber-800"><b>{{ missingNoticePrefix(candidate) }}:</b> {{ missingText(candidate) }}</div>

                      <button type="button" class="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900" @click="toggleCandidate(candidate.candidateKey)">
                        공급사 오퍼 {{ candidate.offers.length }}개 {{ expanded.has(candidate.candidateKey) ? '접기 ▴' : '보기 ▾' }}
                      </button>
                    </div>

                    <div v-if="expanded.has(candidate.candidateKey)" class="border-t border-slate-200 bg-surface">
                      <div v-if="candidate.offers.length > 0" class="divide-y divide-slate-100">
                        <div v-for="offer in offersForDisplay(candidate)" :key="offer.offerKey" class="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center" :class="offerStockRowClass(offer)">
                          <div>
                            <div class="flex flex-wrap items-center gap-2 text-sm">
                              <strong class="uppercase text-slate-900">{{ offer.supplier }}</strong>
                              <span class="text-xs text-slate-500">{{ offer.supplierSku || 'SKU 미확인' }}</span>
                              <span v-if="offer.packaging" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{{ offer.packaging }}</span>
                              <span v-if="offerStockState(offer) !== null" class="rounded px-1.5 py-0.5 text-[11px] font-bold" :class="offerStockBadgeClass(offer)">{{ offerStockLabel(offer) }}</span>
                              <span v-if="severeOfferSurplus(offer)" class="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-bold text-orange-800" :title="offerSurplusLabel(offer)">과다수량 · 자동추천 제외</span>
                              <span v-if="offer.recommendation === 'automatic'" class="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">자동 추천 오퍼</span>
                              <span v-else-if="offer.recommendation === 'manual_review'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">검토 권장 오퍼</span>
                              <span v-else-if="candidate.bestOfferKey === offer.offerKey" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">구매조건 1위</span>
                              <span v-if="context.selectedOfferKey === offer.offerKey" class="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700">사용 중</span>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                              <span>단가 <b>{{ fmtUnit(offer) }}</b></span>
                              <span>주문 <b>{{ offer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span v-if="severeOfferSurplus(offer)" class="font-bold text-orange-700">{{ offerSurplusLabel(offer) }}</span>
                              <span>합계 <b>{{ fmtOfferTotal(offer) }}</b></span>
                              <span v-if="offer.purchaseFitRank !== null">구매적합 <b>{{ offer.purchaseFitRank }}위</b></span>
                              <span v-if="offer.priceRank !== null">가격 <b>{{ offer.priceRank }}위</b></span>
                              <span>재고 <b>{{ offer.offerKind === 'manufacturer_catalog' ? '확인 필요' : (offer.stock?.toLocaleString('ko-KR') ?? '—') }}</b></span>
                              <span>MOQ <b>{{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span class="text-slate-400">기준 {{ fmtAge(offer.fetchedAt) }}</span>
                            </div>
                          </div>
                          <div class="flex items-start gap-2">
                            <a v-if="offer.productUrl" :href="offer.productUrl" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">제품</a>
                            <div v-if="!readOnly" class="max-w-48">
                              <button
                                type="button"
                                class="w-full rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                                :disabled="offerActionDisabled(candidate, offer)"
                                :aria-describedby="offerActionDisabledReason(candidate, offer) === null ? undefined : offerActionReasonId(offer)"
                                @click="selectOffer(candidate, offer)"
                              >
                                {{ offerActionLabel(candidate, offer) }}
                              </button>
                              <p
                                v-if="offerActionDisabledReason(candidate, offer) !== null"
                                :id="offerActionReasonId(offer)"
                                class="mt-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700"
                              >
                                선택 비활성: {{ offerActionDisabledReason(candidate, offer) }}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <p v-else class="p-4 text-sm text-slate-400">가격이 있는 공급사 오퍼가 없습니다.</p>
                    </div>
                  </article>
                </div>
                <div v-else class="p-10 text-center text-sm text-slate-400">이 조건에 해당하는 후보가 없습니다.</div>
              </section>

              <section v-if="context.events.length > 0" class="rounded-xl border border-slate-200 bg-surface p-3 shadow-sm">
                <h3 class="font-bold text-slate-900">선택 이력</h3>
                <div class="mt-3 space-y-2">
                  <div v-for="event in context.events.slice(0, 5)" :key="event.id" class="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <span><b>{{ sourceLabel(event.source) }}</b> · {{ event.previousMpn ?? '미선정' }} → {{ event.selectedMpn ?? '미선정' }}</span>
                    <span class="text-slate-400">{{ new Date(event.createdAt).toLocaleString('ko-KR') }}</span>
                  </div>
                </div>
              </section>

              <section v-if="!readOnly" class="rounded-xl border border-dashed border-slate-300 bg-surface p-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 class="text-sm font-bold text-slate-900">엔진 후보 밖에서 찾기</h3><p class="mt-1 text-xs text-slate-500">품번·스펙으로 카탈로그를 직접 검색할 수 있습니다.</p></div>
                  <div class="flex flex-wrap gap-2">
                    <button v-if="hasCatalogPart" type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" :disabled="interactionLocked" @click="emit('catalogOffers')">현재 부품 오퍼</button>
                    <button type="button" class="rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40" :disabled="interactionLocked" @click="view = 'search'">전체 부품 검색</button>
                  </div>
                </div>
              </section>
            </div>
          </template>
        </div>

        <footer class="shrink-0 border-t border-slate-200 bg-surface px-5 py-2 text-[11px] leading-5 text-slate-500 sm:px-6">
          <template v-if="view === 'candidates'">가격은 필요수량·MOQ·주문배수·재고·환율을 반영한 부품 예상금액입니다. 운송료·관리비·세금은 전체 견적에서 별도로 계산됩니다.</template>
          <template v-else>전체 부품 검색 선택은 엔진 추천을 덮어쓰지 않고 고객의 카탈로그 직접 선택으로 별도 기록됩니다.</template>
        </footer>
      </aside>

      <div
        v-if="pendingReviewSelection !== null"
        class="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4"
        role="presentation"
        @mousedown.self="pendingReviewSelection = null"
      >
        <section
          class="w-full max-w-lg overflow-hidden rounded-2xl border border-amber-200 bg-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-selection-title"
        >
          <header class="border-b border-amber-200 bg-amber-50 px-5 py-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">Manual review</p>
                <h3 id="review-selection-title" class="mt-1 text-lg font-bold text-slate-950">검토 후보를 선택할까요?</h3>
                <p class="mt-1 text-xs leading-5 text-amber-900">자동 선정 조건을 충족하지 않은 후보입니다. 아래 근거와 구매조건을 확인해 주세요.</p>
              </div>
              <button type="button" class="grid size-8 shrink-0 place-items-center rounded-lg text-lg text-slate-500 hover:bg-amber-100" aria-label="선택 확인창 닫기" @click="pendingReviewSelection = null">×</button>
            </div>
          </header>

          <div class="space-y-3 p-5">
            <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="break-all text-base font-bold text-slate-950">{{ pendingReviewSelection.candidate.mpn }}</p>
                  <p class="mt-0.5 text-xs text-slate-500">{{ pendingReviewSelection.candidate.manufacturerName ?? '제조사 미확인' }}</p>
                </div>
                <div class="shrink-0 text-right">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">예상 행 금액</p>
                  <p class="mt-0.5 text-lg font-bold tabular-nums text-slate-950">{{ fmtWon(pendingReviewOffer?.applied?.lineTotalKrw ?? pendingReviewSelection.candidate.bestLineTotalKrw) }}</p>
                </div>
              </div>
              <div v-if="pendingReviewOffer !== null" class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
                <span>공급사 <b class="uppercase text-slate-900">{{ pendingReviewOffer.supplier }}</b></span>
                <span>주문 <b class="text-slate-900">{{ pendingReviewOffer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}개</b></span>
                <span>재고 <b class="text-slate-900">{{ pendingReviewOffer.stock?.toLocaleString('ko-KR') ?? '미확인' }}</b></span>
                <span>MOQ <b class="text-slate-900">{{ pendingReviewOffer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
              </div>
            </div>

            <div v-if="pendingReviewSelection.candidate.conflicts.length > 0" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-900">
              <b>충돌 확인:</b> {{ conflictText(pendingReviewSelection.candidate) }}
            </div>
            <div v-if="pendingReviewSelection.candidate.missingRequirements.length > 0" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              <b>추가 확인:</b> {{ missingText(pendingReviewSelection.candidate) }}
            </div>
            <p v-if="pendingReviewSelection.candidate.conflicts.length === 0 && pendingReviewSelection.candidate.missingRequirements.length === 0" class="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              엔진 판정상 사용자 확인이 필요한 후보입니다. 선택하면 명시적인 고객 선택으로 기록됩니다.
            </p>
          </div>

          <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button type="button" class="h-10 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100" @click="pendingReviewSelection = null">취소</button>
            <button type="button" class="h-10 rounded-lg bg-amber-600 px-5 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="selecting || interactionLocked" @click="confirmPendingReviewSelection">
              {{ pendingReviewSelection.candidate.selected && provisionalSelectionPending ? '검토 완료' : '확인 후 선택' }}
            </button>
          </footer>
        </section>
      </div>
    </div>
    <div
      v-if="open && requirementTooltipCandidate !== null"
      :id="requirementTooltipId"
      ref="requirementTooltipRef"
      role="tooltip"
      class="fixed z-[90] overflow-hidden rounded-xl border border-slate-300 bg-surface text-xs text-slate-700 shadow-2xl ring-1 ring-slate-950/5"
      :style="requirementTooltipStyle"
      @mouseenter="cancelRequirementTooltipClose"
      @mouseleave="scheduleRequirementTooltipClose"
    >
      <div class="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div class="min-w-0">
          <p class="font-bold text-slate-950">{{ requirementTooltipCandidate.strictCategoryCoverage ? '필수조건 상세' : '확인 조건 상세' }}</p>
          <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ requirementTooltipCandidate.mpn }}</p>
        </div>
        <span class="shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums" :class="verificationClass(requirementTooltipCandidate)">
          {{ requirementBadgeLabel(requirementTooltipCandidate) }}
        </span>
      </div>
      <div v-if="requirementTooltipCandidate.requirementAssessments.length > 0" class="max-h-[70vh] overflow-auto">
        <div class="grid min-w-[400px] grid-cols-[minmax(76px,0.8fr)_minmax(96px,1fr)_minmax(96px,1fr)_auto] gap-x-2 border-b border-slate-200 bg-surface px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <span>항목</span>
          <span>요구 조건</span>
          <span>후보값</span>
          <span>판정</span>
        </div>
        <div
          v-for="assessment in requirementTooltipCandidate.requirementAssessments"
          :key="assessment.key"
          class="grid min-w-[400px] grid-cols-[minmax(76px,0.8fr)_minmax(96px,1fr)_minmax(96px,1fr)_auto] items-center gap-x-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
        >
          <span class="font-semibold text-slate-800">
            {{ requirementLabel(assessment.key) }}
            <span v-if="assessment.source === 'policy_default'" class="mt-0.5 block text-[9px] font-bold text-blue-600">승인 기본값</span>
          </span>
          <span class="break-words text-slate-600">{{ requirementExpectedLabel(assessment) }}</span>
          <span class="break-words" :class="assessment.actualDisplay === null ? 'text-amber-700' : 'text-slate-800'">{{ assessment.actualDisplay ?? '정보 없음' }}</span>
          <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold" :class="requirementStateClass(assessment)">{{ requirementStateLabel(assessment) }}</span>
        </div>
      </div>
      <p v-else class="px-3 py-3 leading-5 text-slate-600">
        기존 분석 결과에는 항목별 근거가 없습니다. 새로 분석한 견적부터 상세값을 표시합니다.
      </p>
    </div>
  </Teleport>
</template>
