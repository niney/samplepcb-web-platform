<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteDecisionReasonType,
  BomQuoteItemCandidatesType,
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
} from '../../bom/extraction-display';
import BomPartSearchPanel from './BomPartSearchPanel.vue';
import PartImage from '../ui/PartImage.vue';

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
}>();

const i18n = useI18n();
const { t } = i18n;

type SelectionView = 'candidates' | 'search';
type CandidateTab = 'selectable' | 'all' | 'review';
type RequirementComponentType = 'resistor' | 'capacitor';
type CapacitorType = 'ceramic' | 'electrolytic' | 'tantalum' | 'film';

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
const resistance = ref('');
const capacitance = ref('');
const packageCode = ref('');
const tolerance = ref('');
const voltage = ref('');
const power = ref('');
const dielectric = ref('');
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
    default:
      return null;
  }
});

function traceCodeLabel(section: 'stage' | 'strategy' | 'source' | 'fallbackReason', code: string): string {
  const key = `bomSearchTrace.${section}.${code}`;
  return i18n.te(key) ? t(key) : code;
}

function traceOutcomeLabel(attempt: BomQuoteSearchTraceAttemptType): string {
  const key = `bomSearchTrace.outcome.${attempt.outcome}`;
  if (!i18n.te(key)) return attempt.outcome;
  return t(key, { count: attempt.resultCount });
}

function traceElapsedLabel(elapsedMs: number): string {
  return elapsedMs < 1000
    ? `${Math.round(elapsedMs).toLocaleString('ko-KR')}ms`
    : `${(elapsedMs / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}s`;
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
  return null;
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

function resetSearchRequirementsForm(): void {
  const context = props.context;
  const stored = context?.searchRequirements;
  const componentType = inferredRequirementComponentType();
  requirementComponentType.value = componentType;
  if (stored?.componentType === 'resistor') {
    resistance.value = stored.resistance;
    packageCode.value = stored.packageCode;
    tolerance.value = stored.tolerance ?? '';
    power.value = stored.power ?? '';
    mountStyle.value = stored.mountStyle ?? '';
    capacitance.value = '';
    voltage.value = '';
    dielectric.value = '';
    capacitorType.value = '';
    return;
  }
  if (stored?.componentType === 'capacitor') {
    capacitance.value = stored.capacitance;
    packageCode.value = stored.packageCode;
    tolerance.value = stored.tolerance ?? '';
    voltage.value = stored.voltage ?? '';
    dielectric.value = stored.dielectric ?? '';
    mountStyle.value = stored.mountStyle ?? '';
    capacitorType.value = stored.capacitorType;
    resistance.value = '';
    power.value = '';
    return;
  }

  resistance.value = componentType === 'resistor' ? originalFieldValue('resistance') : '';
  capacitance.value = componentType === 'capacitor' ? originalFieldValue('capacitance') : '';
  const extractedPackage = originalFieldValue('package');
  packageCode.value = extractedPackage === ''
    ? (context?.originalPackageCode ?? '')
    : extractedPackage;
  tolerance.value = originalFieldValue('tolerance');
  voltage.value = componentType === 'capacitor' ? originalFieldValue('voltage') : '';
  power.value = componentType === 'resistor' ? originalFieldValue('power') : '';
  const evidenceText = JSON.stringify(context?.extraction?.payload ?? {});
  dielectric.value = componentType === 'capacitor'
    ? (/\b(?:C0G|NP0|X5R|X7R|X8R|Y5V)\b/i.exec(evidenceText)?.[0]?.toUpperCase() ?? '')
    : '';
  capacitorType.value = componentType === 'capacitor'
    ? inferCapacitorType(evidenceText, dielectric.value)
    : '';
  const mountText = `${originalFieldValue('package')} ${originalFieldValue('footprint')} ${evidenceText}`;
  mountStyle.value = /\b(?:THT|THROUGH[ -]?HOLE|DIP)\b/i.test(mountText)
    ? 'through-hole'
    : /\b(?:SMD|SMT)\b/i.test(mountText)
      ? 'smd'
      : '';
}

const searchRequirementsVisible = computed(() => requirementComponentType.value !== null);
const searchRequirementsValid = computed(() =>
  packageCode.value.trim() !== ''
  && (
    requirementComponentType.value === 'resistor'
      ? resistance.value.trim() !== ''
      : requirementComponentType.value === 'capacitor'
        && capacitance.value.trim() !== ''
        && capacitorType.value !== ''
  ),
);

function nullableRequirement(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function submitSearchRequirements(): void {
  const componentType = requirementComponentType.value;
  if (!searchRequirementsValid.value || componentType === null) return;
  const common = {
    packageCode: packageCode.value.trim(),
    tolerance: nullableRequirement(tolerance.value),
    mountStyle: mountStyle.value === '' ? null : mountStyle.value,
  };
  if (componentType === 'resistor') {
    emit('searchRequirements', {
      ...common,
      componentType,
      resistance: resistance.value.trim(),
      power: nullableRequirement(power.value),
    });
    return;
  }
  if (capacitorType.value === '') return;
  emit('searchRequirements', {
    ...common,
    componentType,
    capacitorType: capacitorType.value,
    capacitance: capacitance.value.trim(),
    voltage: nullableRequirement(voltage.value),
    dielectric: capacitorType.value === 'ceramic'
      ? nullableRequirement(dielectric.value)
      : null,
  });
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
  return [...filtered].sort((a, b) => a.technicalRank - b.technicalRank);
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
    (a.purchaseFitRank ?? Number.MAX_SAFE_INTEGER) - (b.purchaseFitRank ?? Number.MAX_SAFE_INTEGER)
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
    'engine-procurement-recommendation': '엔진 구매조건 추천',
    'engine-manual-review': '엔진 수동 검토 권장',
    'engine-technical-fallback': '기술 1순위 구매 불가 · 다음 후보 적용',
    'engine-procurement-unavailable': '구매 가능한 추천 오퍼 없음',
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
  return 'border-slate-200 bg-white';
}

function recommendationLabel(candidate: BomQuoteCandidateType): string {
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
  if (candidate.selectionEligibility === 'manual_review') return 'bg-amber-100 font-semibold text-amber-800';
  if (candidate.conflicts.length > 0) return 'bg-red-100 font-semibold text-red-800';
  if (!candidate.verificationComplete || candidate.requiredRequirementCount <= 0) {
    return 'bg-amber-100 font-semibold text-amber-800';
  }
  return 'bg-emerald-50 font-semibold text-emerald-800';
}

function requirementBadgeLabel(candidate: BomQuoteCandidateType): string {
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
    current_a: '정격전류',
    frequency_hz: '주파수',
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

function missingText(candidate: BomQuoteCandidateType): string {
  return candidate.missingRequirements.map(requirementLabel).join(', ');
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

function candidateTotalLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.bestLineTotalKrw !== null) return fmtWon(candidate.bestLineTotalKrw);
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

type OfferStockState = 'out_of_stock' | 'insufficient_stock' | 'stock_unverified';

function offerStockState(offer: BomQuoteCandidateOfferType): OfferStockState | null {
  if (offer.stock === 0) return 'out_of_stock';
  if (
    offer.applied?.stockShort === true
    || offer.decisionReasonCodes.includes('stock_short')
  ) return 'insufficient_stock';
  if (offer.stock === null) return 'stock_unverified';
  return null;
}

function offerStockLabel(offer: BomQuoteCandidateOfferType): string {
  const state = offerStockState(offer);
  if (state === 'out_of_stock') return '재고 없음';
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
  if (state === 'stock_unverified') return '재고 확인 필요';
  return '선택 불가';
}

function offerStockBadgeClass(offer: BomQuoteCandidateOfferType): string {
  return offerStockState(offer) === 'out_of_stock'
    ? 'bg-red-600 text-white'
    : offerStockState(offer) === 'insufficient_stock'
      ? 'bg-amber-100 text-amber-900'
      : 'bg-slate-200 text-slate-700';
}

function offerStockRowClass(offer: BomQuoteCandidateOfferType): string {
  return offerStockState(offer) === 'out_of_stock'
    ? 'bg-red-50/70'
    : offerStockState(offer) === 'insufficient_stock'
      ? 'bg-amber-50/50'
      : '';
}

function candidateUnavailableLabel(candidate: BomQuoteCandidateType): string {
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
  return '재고·가격 구매조건 미충족';
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
  const applied = offer.applied;
  if (applied === null) return '가격 없음';
  const prefix = applied.currency === 'KRW' ? '₩' : applied.currency === 'USD' ? '$' : `${applied.currency} `;
  return `${prefix}${applied.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
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
    || !candidate.manualSelectable
    || !offer.purchasable
    || offer.applied === null
  ) return;
  requestSelection(candidate, offer.offerKey);
}

function confirmPendingReviewSelection(): void {
  const pending = pendingReviewSelection.value;
  if (pending === null || props.selecting) return;
  pendingReviewSelection.value = null;
  emit('select', pending.candidate.candidateKey, pending.offerKey);
}

function selectCatalogPart(part: PartHitType, pick: OfferPick | null): void {
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
      <aside class="flex h-full w-full max-w-4xl flex-col bg-[#f6f8fb] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="candidate-drawer-title">
        <header class="shrink-0 border-b border-slate-200 bg-white px-5 py-2.5 sm:px-6">
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
            <button type="button" class="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xl text-slate-500 hover:bg-slate-100" aria-label="후보 패널 닫기" @click="emit('close')">×</button>
          </div>
        </header>

        <nav class="grid shrink-0 grid-cols-2 gap-1 border-b border-slate-200 bg-white px-5 pt-1 sm:px-6" aria-label="부품 선택 방식">
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
            class="border-b-2 px-3 py-2 text-sm font-bold transition"
            :class="view === 'search' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
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
                <div class="shrink-0 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-slate-600 sm:text-right">
                  <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-400">현재 부품</span>
                  <b class="mt-0.5 block max-w-64 break-all text-slate-900">{{ context?.currentMpn || searchInitialQuery || '미선정' }}</b>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div class="mb-4">
                <h3 class="font-bold text-slate-900">카탈로그 검색</h3>
                <p class="mt-1 text-xs text-slate-500">부품을 고른 뒤 공급 포장·공급사·실제 주문수량과 총액을 확인하고 적용합니다.</p>
              </div>
              <BomPartSearchPanel
                :initial-query="searchInitialQuery"
                :current-part-id="currentPartId"
                :selecting="catalogSelecting"
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
              <section class="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm" aria-labelledby="original-bom-title">
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
                      <span v-if="originalExtractionSummary.review > 0 || context.extraction.reviewStatus !== 'extracted'" class="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                        검토 {{ Math.max(originalExtractionSummary.review, 1) }}
                      </span>
                    </template>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700"
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

                <div v-if="originalReviewFields.length > 0 || originalExtractionAlerts.length > 0" class="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5">
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
                            : 'border-slate-100 bg-white',
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
                        {{ requirementComponentType === 'resistor' ? '저항' : '캐패시터' }}
                      </span>
                      <span v-if="context.searchRequirements !== null" class="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">사용자 조건 저장됨</span>
                    </div>
                    <p class="mt-1 text-xs leading-5 text-slate-600">
                      원본 BOM은 유지하고 이 행의 공급사 검색에만 적용합니다. 비워 둔 선택 조건은 자동선정을 막고 후보 검토 항목으로 남습니다.
                    </p>
                  </div>
                </div>

                <form class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="submitSearchRequirements">
                  <label v-if="requirementComponentType === 'resistor'" class="text-xs font-semibold text-slate-700">
                    저항값 <b class="text-rose-600">*</b>
                    <input v-model.trim="resistance" type="text" maxlength="64" placeholder="예: 10kΩ" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>
                  <label v-else class="text-xs font-semibold text-slate-700">
                    정전용량 <b class="text-rose-600">*</b>
                    <input v-model.trim="capacitance" type="text" maxlength="64" placeholder="예: 100nF" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>

                  <label class="text-xs font-semibold text-slate-700">
                    패키지 <b class="text-rose-600">*</b>
                    <input v-model.trim="packageCode" type="text" maxlength="64" placeholder="예: 0603 / 1608" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>

                  <label v-if="requirementComponentType === 'capacitor'" class="text-xs font-semibold text-slate-700">
                    캐패시터 종류 <b class="text-rose-600">*</b>
                    <select v-model="capacitorType" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                      <option value="">선택 필요</option>
                      <option value="ceramic">MLCC / 세라믹</option>
                      <option value="electrolytic">전해</option>
                      <option value="tantalum">탄탈</option>
                      <option value="film">필름</option>
                    </select>
                  </label>

                  <label class="text-xs font-semibold text-slate-700">
                    허용오차
                    <input v-model.trim="tolerance" type="text" maxlength="64" placeholder="모름 또는 예: 10%" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>

                  <label v-if="requirementComponentType === 'resistor'" class="text-xs font-semibold text-slate-700">
                    정격전력
                    <input v-model.trim="power" type="text" maxlength="64" placeholder="조건 없음 또는 예: 0.1W" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>

                  <label v-if="requirementComponentType === 'capacitor'" class="text-xs font-semibold text-slate-700">
                    정격전압
                    <input v-model.trim="voltage" type="text" maxlength="64" placeholder="모름 또는 예: 25V" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                  </label>

                  <label v-if="requirementComponentType === 'capacitor' && capacitorType === 'ceramic'" class="text-xs font-semibold text-slate-700">
                    유전체
                    <select v-model="dielectric" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
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
                    <select v-model="mountStyle" class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500">
                      <option value="">자동 판정</option>
                      <option value="smd">SMD</option>
                      <option value="through-hole">THT</option>
                    </select>
                  </label>

                  <div class="flex flex-col justify-end sm:col-span-2 lg:col-span-4">
                    <p v-if="requirementsError !== ''" class="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{{ requirementsError }}</p>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="text-[11px] text-slate-500">전압은 이상(≥), 허용오차는 이하(≤), 정격전력은 이상(≥) 조건으로 검증합니다.</p>
                      <button type="submit" class="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="requirementsSaving || !searchRequirementsValid">
                        {{ requirementsSaving ? '행 재검색 시작 중…' : context.searchRequirements === null ? '조건 저장 후 검색' : '조건 변경 후 재검색' }}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
              <section v-if="context.searchTrace !== null" class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  :aria-expanded="searchTraceExpanded"
                  aria-controls="supplier-search-trace"
                  @click="searchTraceExpanded = !searchTraceExpanded"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 text-xs font-bold text-slate-800">{{ t('bomSearchTrace.process') }}</span>
                    <span class="min-w-0 truncate text-xs text-slate-600" :title="context.searchTrace.primaryQuery">{{ context.searchTrace.primaryQuery }}</span>
                    <span v-if="context.searchTrace.fallbackUsed" class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{{ t('bomSearchTrace.fallbackBadge') }}</span>
                  </span>
                  <span class="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-slate-500">
                    {{ t('bomSearchTrace.attempts', { count: context.searchTrace.attemptCount }) }}
                    <span aria-hidden="true">{{ searchTraceExpanded ? '▴' : '▾' }}</span>
                  </span>
                </button>
                <div v-show="searchTraceExpanded" id="supplier-search-trace" class="border-t border-slate-200 bg-slate-50/60 px-3 py-2.5">
                  <div v-if="context.searchTrace.fallbackQuery !== null" class="mb-2 grid min-w-0 gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] sm:grid-cols-[auto_1fr]">
                    <b class="text-amber-800">{{ t('bomSearchTrace.fallbackBadge') }}</b>
                    <span class="break-words text-amber-900">{{ context.searchTrace.fallbackQuery }}</span>
                  </div>
                  <ol class="space-y-1.5">
                    <li
                      v-for="attempt in context.searchTrace.attempts"
                      :key="attempt.sequence"
                      class="grid gap-x-2 gap-y-1 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[11px] sm:grid-cols-[24px_108px_minmax(0,1fr)_auto] sm:items-start"
                    >
                      <span class="flex size-5 items-center justify-center rounded-full bg-slate-100 font-bold tabular-nums text-slate-600">{{ attempt.sequence }}</span>
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
                  </ol>
                </div>
              </section>
              <section class="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
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
                    <div v-if="context.decisionReasonCodes.length > 0" class="flex flex-wrap gap-1">
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
                      필수조건 <b class="text-slate-900">{{ currentCandidate.verifiedRequirementCount }}/{{ currentCandidate.requiredRequirementCount }}</b>
                    </button>
                  </div>
                </div>
                <div v-if="context.decisionReasonCodes.includes('purchase-fit')" class="mx-3 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                  일부 조건은 추가 확인이 필요하지만, 기술 근거가 같은 후보 중 필요수량·MOQ·예상금액이 가장 적합한 부품을 선택했습니다.
                </div>
              </section>

              <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div class="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="font-bold text-slate-900">부품 후보</h3>
                    <p class="mt-1 text-xs text-slate-500">sp-engine의 기술 순서와 현재 수량 기준 구매 판정을 그대로 표시합니다.</p>
                  </div>
                  <span class="rounded-md bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">엔진 순서 고정</span>
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
                              <span v-if="candidate.selected" class="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" :class="provisionalSelectionPending ? 'bg-amber-600' : 'bg-blue-600'">{{ provisionalSelectionPending ? '현재 선택 · 검토 대기' : '현재 선택' }}</span>
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
                        <div class="w-full shrink-0 rounded-lg border border-slate-200 bg-white p-3 md:w-52">
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
                            :disabled="selecting || !candidate.manualSelectable || candidate.bestOfferKey === null || bestOfferAlreadySelected(candidate)"
                            @click="selectBest(candidate)"
                          >
                            {{ candidate.bestOfferKey === null ? candidateUnavailableLabel(candidate) : provisionalSelectionPending && candidate.selected ? '검토 완료' : bestOfferAlreadySelected(candidate) ? '현재 구매조건 오퍼' : candidate.recommended && candidate.selectionEligibility === 'manual_review' ? '권장 후보 검토 후 선택' : candidate.selectionEligibility === 'manual_review' ? '검토 후 선택' : candidate.selected ? '구매조건 오퍼로 변경' : candidate.recommended ? '자동 추천 적용' : '구매조건 오퍼로 선택' }}
                          </button>
                        </div>
                      </div>

                      <div
                        v-if="candidate.conflicts.length > 0"
                        class="mt-2 rounded-md px-2.5 py-1.5 text-xs"
                        :class="candidate.selectionEligibility === 'manual_review' ? 'bg-amber-100/70 text-amber-900' : 'bg-red-100/70 text-red-800'"
                      >
                        자동선정 제외: {{ conflictText(candidate) }}
                      </div>
                      <div v-if="candidate.selectionEligibility === 'manual_review'" class="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900">
                        <template v-if="candidate.recommended"><b>엔진 검토 권장:</b> 구매 가능한 재고·가격을 포함해 실제 적용 후보로 임시 선정했습니다. 예상 견적에는 반영되며, 확인 후 검토를 완료할 수 있습니다.</template>
                        <template v-else-if="context.technicalFallbackUsed && candidate.candidateKey === technicalTopCandidate?.candidateKey"><b>기술 1순위:</b> 기술 근거상 가장 앞선 후보지만 구매 가능한 오퍼가 없어 현재 견적에는 적용하지 않았습니다.</template>
                        <template v-else-if="candidate.reviewRecommended"><b>엔진 기술 검토 1순위:</b> 기술 근거상 가장 유력하지만 구매조건을 충족하지 못해 적용 후보와 분리했습니다.</template>
                        <template v-else><b>엔진 검토 필요:</b> 자동 선정 조건을 충족하지 않았습니다. 근거와 누락·충돌 항목을 확인한 뒤 직접 선택할 수 있습니다.</template>
                      </div>
                      <div v-if="candidate.missingRequirements.length > 0" class="mt-1.5 rounded-md bg-amber-100/70 px-2.5 py-1.5 text-xs text-amber-800">추가 확인 필요: {{ missingText(candidate) }}</div>

                      <button type="button" class="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900" @click="toggleCandidate(candidate.candidateKey)">
                        공급사 오퍼 {{ candidate.offers.length }}개 {{ expanded.has(candidate.candidateKey) ? '접기 ▴' : '보기 ▾' }}
                      </button>
                    </div>

                    <div v-if="expanded.has(candidate.candidateKey)" class="border-t border-slate-200 bg-white">
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
                              <span>합계 <b>{{ fmtWon(offer.applied?.lineTotalKrw ?? null) }}</b></span>
                              <span v-if="offer.purchaseFitRank !== null">구매적합 <b>{{ offer.purchaseFitRank }}위</b></span>
                              <span v-if="offer.priceRank !== null">가격 <b>{{ offer.priceRank }}위</b></span>
                              <span>재고 <b>{{ offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span>MOQ <b>{{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span class="text-slate-400">기준 {{ fmtAge(offer.fetchedAt) }}</span>
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <a v-if="offer.productUrl" :href="offer.productUrl" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">제품</a>
                            <button
                              v-if="!readOnly"
                              type="button"
                              class="rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                              :disabled="selecting || !candidate.manualSelectable || !offer.purchasable || offer.applied === null || offerAlreadyConfirmed(candidate, offer)"
                              @click="selectOffer(candidate, offer)"
                            >
                              {{ provisionalSelectionPending && candidate.selected && context.selectedOfferKey === offer.offerKey ? '이 오퍼 확인 완료' : offer.purchasable ? '이 오퍼 선택' : offerStockActionLabel(offer) }}
                            </button>
                          </div>
                        </div>
                      </div>
                      <p v-else class="p-4 text-sm text-slate-400">가격이 있는 공급사 오퍼가 없습니다.</p>
                    </div>
                  </article>
                </div>
                <div v-else class="p-10 text-center text-sm text-slate-400">이 조건에 해당하는 후보가 없습니다.</div>
              </section>

              <section v-if="context.events.length > 0" class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <h3 class="font-bold text-slate-900">선택 이력</h3>
                <div class="mt-3 space-y-2">
                  <div v-for="event in context.events.slice(0, 5)" :key="event.id" class="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <span><b>{{ sourceLabel(event.source) }}</b> · {{ event.previousMpn ?? '미선정' }} → {{ event.selectedMpn ?? '미선정' }}</span>
                    <span class="text-slate-400">{{ new Date(event.createdAt).toLocaleString('ko-KR') }}</span>
                  </div>
                </div>
              </section>

              <section v-if="!readOnly" class="rounded-xl border border-dashed border-slate-300 bg-white p-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 class="text-sm font-bold text-slate-900">엔진 후보 밖에서 찾기</h3><p class="mt-1 text-xs text-slate-500">품번·스펙으로 카탈로그를 직접 검색할 수 있습니다.</p></div>
                  <div class="flex flex-wrap gap-2">
                    <button v-if="hasCatalogPart" type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" @click="emit('catalogOffers')">현재 부품 오퍼</button>
                    <button type="button" class="rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50" @click="view = 'search'">전체 부품 검색</button>
                  </div>
                </div>
              </section>
            </div>
          </template>
        </div>

        <footer class="shrink-0 border-t border-slate-200 bg-white px-5 py-2 text-[11px] leading-5 text-slate-500 sm:px-6">
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
          class="w-full max-w-lg overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl"
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
            <button type="button" class="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100" @click="pendingReviewSelection = null">취소</button>
            <button type="button" class="h-10 rounded-lg bg-amber-600 px-5 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="selecting" @click="confirmPendingReviewSelection">
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
      class="fixed z-[90] overflow-hidden rounded-xl border border-slate-300 bg-white text-xs text-slate-700 shadow-2xl ring-1 ring-slate-950/5"
      :style="requirementTooltipStyle"
      @mouseenter="cancelRequirementTooltipClose"
      @mouseleave="scheduleRequirementTooltipClose"
    >
      <div class="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div class="min-w-0">
          <p class="font-bold text-slate-950">필수조건 상세</p>
          <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ requirementTooltipCandidate.mpn }}</p>
        </div>
        <span class="shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums" :class="verificationClass(requirementTooltipCandidate)">
          {{ requirementTooltipCandidate.verifiedRequirementCount }}/{{ requirementTooltipCandidate.requiredRequirementCount }} · {{ verificationPercent(requirementTooltipCandidate) ?? 0 }}%
        </span>
      </div>
      <div v-if="requirementTooltipCandidate.requirementAssessments.length > 0" class="max-h-[70vh] overflow-auto">
        <div class="grid min-w-[400px] grid-cols-[minmax(76px,0.8fr)_minmax(96px,1fr)_minmax(96px,1fr)_auto] gap-x-2 border-b border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
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
