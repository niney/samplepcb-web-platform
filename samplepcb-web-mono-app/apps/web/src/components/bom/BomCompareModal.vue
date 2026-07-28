<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type {
  BomQuoteComparisonCandidateType,
  BomQuoteComparisonRowType,
  BomQuoteComparisonType,
  BomQuoteItemType,
} from '@sp/api-contract';
import icCompareClose from '../../assets/bom/ic-compare-close.svg';
import icCompareEye from '../../assets/bom/ic-compare-eye.svg';
import icSearch from '../../assets/bom/ic-search-20.svg';
import icSelectCaret from '../../assets/bom/ic-select-caret.svg';

type Candidate = BomQuoteComparisonCandidateType;
type CellState = 'match' | 'mismatch' | 'missing' | 'neutral';
type StatusFilter = 'all' | 'matched' | 'attention' | 'not_found';

interface ComparisonItem {
  id: string;
  quoteItem: BomQuoteItemType;
  comparison?: BomQuoteComparisonRowType;
}

interface DisplayField {
  key: string;
  label: string;
  multiline?: boolean;
}

const props = defineProps<{
  open: boolean;
  title: string;
  items: BomQuoteItemType[];
  comparison: BomQuoteComparisonType | null;
  loading: boolean;
  failed: boolean;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
  'query-change': [query: {
    page: number;
    search: string;
    status: StatusFilter;
    sheet: string;
  }];
}>();

const closeButton = ref<HTMLButtonElement | null>(null);
let previousBodyOverflow = '';
let previousFocus: HTMLElement | null = null;

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

function unlockPage(): void {
  document.body.style.overflow = previousBodyOverflow;
  window.removeEventListener('keydown', onWindowKeydown);
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      unlockPage();
      previousFocus?.focus();
      previousFocus = null;
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onWindowKeydown);
    await nextTick();
    closeButton.value?.focus();
  },
  { immediate: true },
);

onBeforeUnmount(unlockPage);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
}

function sourceRow(item: BomQuoteItemType): Record<string, unknown> | null {
  return asRecord(item.sourceRow);
}

function extractionPayload(item: ComparisonItem): Record<string, unknown> | null {
  return item.comparison?.extraction?.payload ?? null;
}

function quoteRows(item: ComparisonItem): number[] {
  const extracted = numberArray(extractionPayload(item)?.source_rows_1based);
  return extracted.length > 0 ? extracted : numberArray(sourceRow(item.quoteItem)?.sourceRows);
}

function quoteRefs(item: ComparisonItem): string[] {
  const extracted = stringArray(extractionPayload(item)?.reference_designators);
  return extracted.length > 0 ? extracted : stringArray(sourceRow(item.quoteItem)?.referenceDesignators);
}

function quoteSheet(item: ComparisonItem): string {
  const value = extractionPayload(item)?.sheet_name ?? item.quoteItem.sourceSheetName ?? sourceRow(item.quoteItem)?.sheetName;
  return typeof value === 'string' && value !== '' ? value : '시트 미확인';
}

function sourceText(item: ComparisonItem, key: string): string | null {
  const value = extractionPayload(item)?.[key] ?? sourceRow(item.quoteItem)?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const comparisonItems = computed<ComparisonItem[]>(() => {
  const quoteItems = new Map(props.items.map((item) => [item.id, item] as const));
  return (props.comparison?.rows ?? []).flatMap((comparison) => {
    const quoteItem = quoteItems.get(comparison.itemId);
    return quoteItem === undefined
      ? []
      : [{ id: `quote-${quoteItem.id}`, quoteItem, comparison }];
  });
});

const MATCHED_STATUSES = new Set(['verified_exact', 'verified_variant', 'spec_compatible']);
function itemStatus(item: ComparisonItem): string {
  const componentStatus = asRecord(item.quoteItem.matchEvidence)?.componentStatus;
  if (typeof componentStatus === 'string') return componentStatus;
  return item.comparison?.candidates[0]?.status ?? 'not_found';
}

function statusCategory(item: ComparisonItem): Exclude<StatusFilter, 'all'> {
  const status = itemStatus(item);
  if (MATCHED_STATUSES.has(status)) return 'matched';
  if (status === 'not_found') return 'not_found';
  return 'attention';
}

const matchedCount = computed(() => props.comparison?.summary.matched ?? 0);
const attentionCount = computed(() => props.comparison?.summary.attention ?? 0);
const notFoundCount = computed(() => props.comparison?.summary.notFound ?? 0);
const totalCount = computed(() => matchedCount.value + attentionCount.value + notFoundCount.value);

const preferredSuppliers = ['mouser', 'digikey', 'unikeyic'];
const supplierLabels: Record<string, string> = {
  mouser: 'Mouser',
  digikey: 'Digikey',
  unikeyic: 'UnikeyIC',
};
const suppliers = computed(() => {
  const discovered = new Set(
    comparisonItems.value.flatMap((item) =>
      (item.comparison?.candidates ?? []).flatMap((candidate) =>
        candidate.offers.map((offer) => offer.supplier.toLocaleLowerCase()),
      ),
    ),
  );
  return [...new Set([...preferredSuppliers, ...discovered])].sort((left, right) => {
    const leftIndex = preferredSuppliers.indexOf(left);
    const rightIndex = preferredSuppliers.indexOf(right);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right);
  });
});

const search = ref('');
const statusFilter = ref<StatusFilter>('all');
const supplierFilter = ref('all');
const sheetFilter = ref('all');
const page = ref(1);

const sheets = computed(() => props.comparison?.sheets ?? []);
const pageCount = computed(() => props.comparison?.totalPages ?? 1);
const visibleItems = computed(() => comparisonItems.value);
const visibleSuppliers = computed(() =>
  supplierFilter.value === 'all' ? suppliers.value : suppliers.value.filter((name) => name === supplierFilter.value),
);
const gridStyle = computed(() => ({
  gridTemplateColumns: `152px repeat(${String(visibleSuppliers.value.length + 1)}, minmax(300px, 1fr))`,
  minWidth: `${String(152 + (visibleSuppliers.value.length + 1) * 430)}px`,
}));

let queryTimer: ReturnType<typeof setTimeout> | null = null;
onBeforeUnmount(() => {
  if (queryTimer !== null) clearTimeout(queryTimer);
});
watch([search, statusFilter, sheetFilter], () => {
  page.value = 1;
  if (queryTimer !== null) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => {
    emit('query-change', {
      page: 1,
      search: search.value,
      status: statusFilter.value,
      sheet: sheetFilter.value,
    });
  }, 250);
});
watch(page, (next, previous) => {
  if (next === previous) return;
  emit('query-change', {
    page: next,
    search: search.value,
    status: statusFilter.value,
    sheet: sheetFilter.value,
  });
});
watch(() => props.comparison?.page, (serverPage) => {
  if (serverPage !== undefined && page.value !== serverPage) page.value = serverPage;
});
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});
watch(suppliers, (values) => {
  if (supplierFilter.value !== 'all' && !values.includes(supplierFilter.value)) supplierFilter.value = 'all';
});

const statusLabels: Record<string, string> = {
  verified_exact: '정확 일치',
  verified_variant: '변형 일치',
  spec_compatible: '스펙 호환',
  spec_partial: '스펙 일부',
  input_conflict: 'BOM 입력 충돌',
  ambiguous: '판정 모호',
  not_found: '검색 결과 없음',
  supplier_error: '공급사 오류',
  insufficient_input: '검색 정보 부족',
};

const fieldLabels: Record<string, string> = {
  part_number: '품번',
  manufacturer: '제조사',
  part_type: '부품 종류',
  package: '패키지 / 크기',
  footprint: '풋프린트',
  value_raw: '원본 값',
  size_code: '사이즈 코드',
  description: '설명',
  quantity: 'BOM 수량',
  source_cells: 'Excel 원본 위치',
  resistance: 'resistance',
  resistance_ohm: 'resistance',
  capacitance: 'capacitance',
  capacitance_f: 'capacitance',
  inductance: 'inductance',
  inductance_h: 'inductance',
  power: 'power',
  power_w: 'power',
  tolerance: 'tolerance',
  tolerance_percent: 'tolerance',
  voltage: 'voltage',
  voltage_v: 'voltage',
  current: 'current',
  current_a: 'current',
  frequency: 'frequency',
  frequency_hz: 'frequency',
  temperature: 'temperature',
  temperature_c: 'temperature',
  temperature_range_c: 'temperature',
  temperature_min_c: 'temperature',
  temperature_max_c: 'temperature',
  dielectric: '유전체 특성',
  stock: '재고',
  moq: '최소 주문 수량',
  best_price: '최저 단가',
  lifecycle: '수명주기',
};
const specOrder = [
  'resistance',
  'resistance_ohm',
  'capacitance',
  'capacitance_f',
  'inductance',
  'inductance_h',
  'power',
  'power_w',
  'tolerance',
  'tolerance_percent',
  'voltage',
  'voltage_v',
  'current',
  'current_a',
  'frequency',
  'frequency_hz',
  'temperature',
  'temperature_c',
  'temperature_range_c',
  'temperature_min_c',
  'temperature_max_c',
  'footprint',
  'value_raw',
  'dielectric',
];

function fieldsFor(item: ComparisonItem): DisplayField[] {
  const payload = extractionPayload(item);
  const fieldStates = asRecord(payload?.field_states);
  const rawFields = asRecord(payload?.raw_fields);
  const attributeKeys = Array.isArray(payload?.attributes)
    ? payload.attributes.flatMap((attribute) => {
        const record = asRecord(attribute);
        return typeof record?.name === 'string' ? [record.name] : [];
      })
    : [];
  const candidateKeys = (item.comparison?.candidates ?? [])
    .flatMap((candidate) => Object.keys(candidate.specComparisons));
  const requirementKeys = [...new Set([
    ...Object.keys(fieldStates ?? {}),
    ...Object.keys(rawFields ?? {}),
    ...attributeKeys,
    ...candidateKeys,
  ])]
    .filter((key) => ![
      'part_number',
      'manufacturer',
      'part_type',
      'component_type',
      'package',
      'description',
      'quantity',
    ].includes(key))
    .sort((left, right) => {
      const leftIndex = specOrder.indexOf(left);
      const rightIndex = specOrder.indexOf(right);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
  return [
    { key: 'part_number', label: fieldLabels.part_number ?? '품번' },
    { key: 'manufacturer', label: fieldLabels.manufacturer ?? '제조사' },
    { key: 'part_type', label: fieldLabels.part_type ?? '부품 종류' },
    { key: 'package', label: fieldLabels.package ?? '패키지 / 크기' },
    { key: 'description', label: fieldLabels.description ?? '설명', multiline: true },
    ...requirementKeys.map((key) => ({ key, label: fieldLabels[key] ?? key })),
    { key: 'quantity', label: fieldLabels.quantity ?? 'BOM 수량' },
    { key: 'source_cells', label: fieldLabels.source_cells ?? 'Excel 원본 위치', multiline: true },
    { key: 'stock', label: fieldLabels.stock ?? '재고' },
    { key: 'moq', label: fieldLabels.moq ?? '최소 주문 수량' },
    { key: 'best_price', label: fieldLabels.best_price ?? '최저 단가' },
    { key: 'lifecycle', label: fieldLabels.lifecycle ?? '수명주기' },
  ];
}

function fieldState(item: ComparisonItem, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(extractionPayload(item)?.field_states)?.[key]);
}

function attributeFor(item: ComparisonItem, key: string): Record<string, unknown> | null {
  const attributes = extractionPayload(item)?.attributes;
  if (!Array.isArray(attributes)) return null;
  for (const attribute of attributes) {
    const record = asRecord(attribute);
    if (record?.name === key) return record;
  }
  return null;
}

function sourceProvenance(item: ComparisonItem, key: string): string {
  const state = fieldState(item, key);
  if (state === null) return '';
  if (state.status === 'review') return '검토 필요';
  if (state.status !== 'extracted') return '';
  if (state.source === 'col') return '근거 셀 확인';
  if (state.source === 'text') return '원문 해석';
  if (state.source === 'infer') return '규칙 추론';
  return '근거 유형 미상';
}

function sourceVerified(item: ComparisonItem, key: string): boolean {
  const state = fieldState(item, key);
  return state?.status === 'extracted' && (state.source === 'col' || state.source === 'text');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(formatValue).join(' ~ ');
  if (typeof value === 'number') return value.toLocaleString('ko-KR', { maximumSignificantDigits: 8 });
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? '—';
  return '—';
}

function sourceValue(item: ComparisonItem, key: string): string {
  const quoteItem = item.quoteItem;
  const payload = extractionPayload(item);
  const row = sourceRow(quoteItem);
  const stateValue = fieldState(item, key)?.value;
  const attribute = attributeFor(item, key);
  const rawFieldValue = asRecord(payload?.raw_fields)?.[key];
  const directValue = payload?.[key];
  if (key === 'part_number') return formatValue(payload?.part_number ?? sourceText(item, 'inputPartNumber') ?? payload?.value_raw ?? quoteItem.mpn);
  if (key === 'manufacturer') return formatValue(payload?.manufacturer ?? sourceText(item, 'inputManufacturer'));
  if (key === 'part_type') return formatValue(payload?.component_type ?? stateValue ?? expectedComparisonValue(item, key));
  if (key === 'package') return formatValue(payload?.package ?? row?.packageCode ?? stateValue ?? expectedComparisonValue(item, key));
  if (key === 'description') return formatValue(payload?.description ?? payload?.value_raw ?? quoteItem.description);
  if (key === 'quantity') return formatValue(payload?.quantity ?? quoteItem.bomQty);
  if (key === 'source_cells') {
    const rows = quoteRows(item);
    const refs = quoteRefs(item);
    const rowText = rows.length > 0 ? `행${rows.join(', ')}` : '행 미확인';
    return `${quoteSheet(item)} ${rowText} ${refs.length > 0 ? refs.join(', ') : 'REFDES 없음'}`;
  }
  if (['stock', 'moq', 'best_price', 'lifecycle'].includes(key)) return '—';
  return formatValue(
    attribute?.raw_value
      ?? rawFieldValue
      ?? stateValue
      ?? attribute?.normalized_value
      ?? directValue
      ?? expectedComparisonValue(item, key),
  );
}

function candidateFor(item: ComparisonItem, supplier: string): Candidate | undefined {
  return item.comparison?.candidates.find(
    (candidate) => candidate.offers.some((offer) => offer.supplier.toLocaleLowerCase() === supplier),
  );
}

function normalizedSpecs(candidate: Candidate): Record<string, unknown> {
  return candidate.normalizedSpecs;
}

function comparisonFor(candidate: Candidate, key: string): Record<string, unknown> | null {
  if (key === 'package') return candidate.packageComparison;
  return asRecord(candidate.specComparisons[key]);
}

function expectedComparisonValue(item: ComparisonItem, key: string): string {
  for (const candidate of item.comparison?.candidates ?? []) {
    const comparison = comparisonFor(candidate, key);
    const expected = comparison?.expected_display ?? comparison?.expected_raw;
    if (expected !== null && expected !== undefined && expected !== '') return formatValue(expected);
  }
  return '—';
}

function supplierOffers(candidate: Candidate, supplier: string): Candidate['offers'] {
  return candidate.offers.filter((offer) => offer.supplier.toLocaleLowerCase() === supplier);
}

function maxStock(candidate: Candidate, supplier: string): string {
  const values = supplierOffers(candidate, supplier)
    .map((offer) => offer.stock)
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.max(...values).toLocaleString('ko-KR') : '—';
}

function minimumMoq(candidate: Candidate, supplier: string): string {
  const values = supplierOffers(candidate, supplier)
    .map((offer) => offer.moq)
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.min(...values).toLocaleString('ko-KR') : '—';
}

function bestPrice(candidate: Candidate, supplier: string): string {
  const prices = supplierOffers(candidate, supplier)
    .flatMap((offer) => offer.priceBreaks)
    .sort((left, right) => left.price - right.price);
  const price = prices[0];
  return price === undefined
    ? '—'
    : `${price.price.toLocaleString('ko-KR', { maximumFractionDigits: 6 })} ${price.currency} · ${price.qty.toLocaleString('ko-KR')}+`;
}

function supplierValue(item: ComparisonItem, supplier: string, key: string): string {
  const candidate = candidateFor(item, supplier);
  if (candidate === undefined) return '—';
  const specs = normalizedSpecs(candidate);
  if (key === 'part_number') return formatValue(candidate.mpn);
  if (key === 'manufacturer') return formatValue(candidate.manufacturerName);
  if (key === 'part_type') return formatValue(specs.part_type ?? candidate.category);
  if (key === 'package') {
    return formatValue(comparisonFor(candidate, key)?.actual_display ?? specs.package ?? candidate.packageCode);
  }
  if (key === 'description') return formatValue(candidate.description);
  if (key === 'quantity' || key === 'source_cells') return '—';
  if (key === 'stock') return maxStock(candidate, supplier);
  if (key === 'moq') return minimumMoq(candidate, supplier);
  if (key === 'best_price') return bestPrice(candidate, supplier);
  if (key === 'lifecycle') return formatValue(candidate.lifecycleStatus);
  return formatValue(comparisonFor(candidate, key)?.actual_display ?? specs[key]);
}

function cellState(item: ComparisonItem, supplier: string, key: string): CellState {
  const candidate = candidateFor(item, supplier);
  if (candidate === undefined) return 'missing';
  if (['quantity', 'source_cells', 'description', 'stock', 'moq', 'best_price', 'lifecycle'].includes(key)) {
    return 'neutral';
  }
  const comparisonState = comparisonFor(candidate, key)?.state;
  if (comparisonState === 'match' || comparisonState === 'mismatch' || comparisonState === 'missing') {
    return comparisonState;
  }
  if (candidate.conflicts.includes(`${key}_mismatch`)) return 'mismatch';
  if (candidate.missingRequirements.includes(key)) return 'missing';
  const reasons = candidate.reasons;
  if (key === 'part_number' && reasons.some((reason) => reason.startsWith('manufacturer_part_number_'))) return 'match';
  if (key === 'manufacturer' && reasons.includes('manufacturer_match')) return 'match';
  return reasons.includes(`${key}_match`) ? 'match' : 'neutral';
}

function relationLabel(item: ComparisonItem, supplier: string, key: string): string {
  const candidate = candidateFor(item, supplier);
  if (candidate === undefined) return '';
  const relation = comparisonFor(candidate, key)?.relation;
  const labels: Record<string, string> = {
    exact: '정확 일치',
    alias: '별칭 일치',
    compatible: '호환 규격',
    contains: '범위 충족',
    conditional: '조건부 대체',
    mismatch: '불일치',
    missing: '확인 불가',
    unverified: '검증 안 됨',
  };
  return typeof relation === 'string' ? (labels[relation] ?? relation) : '';
}

function itemRecommendation(item: ComparisonItem): 'preselect' | 'review' | null {
  const candidate = item.comparison?.candidates.find((entry) =>
    entry.selectionRecommendation === 'preselect');
  if (candidate?.reviewRecommended === true) return 'review';
  return candidate === undefined ? null : 'preselect';
}

function itemTitle(item: ComparisonItem): string {
  return formatValue(
    extractionPayload(item)?.part_number
      ?? sourceText(item, 'inputPartNumber')
      ?? extractionPayload(item)?.value_raw
      ?? item.quoteItem.mpn,
  );
}

function itemRefs(item: ComparisonItem): string {
  const refs = quoteRefs(item);
  return refs.length > 0 ? refs.join(', ') : 'REFDES 없음';
}

function itemMeta(item: ComparisonItem): string {
  const rows = quoteRows(item);
  const rowText = rows.length > 0 ? rows.map((row) => `${String(row)}행`).join(', ') : '행 미확인';
  return `${quoteSheet(item)}·${rowText}·수량 ${formatValue(item.quoteItem.bomQty)}`;
}

function supplierLabel(value: string): string {
  return supplierLabels[value] ?? value;
}

function statusLabel(item: ComparisonItem): string {
  const status = itemStatus(item);
  return statusLabels[status] ?? status;
}
</script>

<template>
  <Teleport to="body">
    <section
      v-if="open"
      class="compare-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bom-compare-title"
    >
      <header class="compare-header">
        <div class="compare-heading">
          <div class="compare-kicker">
            <img :src="icCompareEye" alt="">
            <span>BOM 비교</span>
          </div>
          <h2 id="bom-compare-title" :title="title">{{ title }}</h2>
        </div>
        <button ref="closeButton" type="button" class="close-button" aria-label="BOM 비교 닫기" @click="emit('close')">
          <img :src="icCompareClose" alt="">
        </button>
        <div class="header-rule" />
        <section class="summary-strip" aria-label="BOM 비교 요약">
          <article>
            <span>전체 부품</span>
            <strong>{{ totalCount }}</strong>
          </article>
          <article class="matched">
            <span>검증·호환</span>
            <strong>{{ matchedCount }}</strong>
          </article>
          <article class="attention">
            <span>확인 필요</span>
            <strong>{{ attentionCount }}</strong>
          </article>
          <article class="not-found">
            <span>검색 결과 없음</span>
            <strong>{{ notFoundCount }}</strong>
          </article>
        </section>
      </header>

      <section class="toolbar" aria-label="BOM 비교 필터">
        <label class="search-field">
          <span class="sr-only">BOM 비교 검색</span>
          <input
            v-model="search"
            type="search"
            placeholder="REFDES, 품번, 제조사, 설명 검색"
            :disabled="comparison === null || loading"
          >
          <img :src="icSearch" alt="">
        </label>
        <label class="filter-select">
          <span class="sr-only">판정 필터</span>
          <select v-model="statusFilter" :disabled="comparison === null || loading">
            <option value="all">전체 판정</option>
            <option value="matched">검증·호환</option>
            <option value="attention">확인 필요</option>
            <option value="not_found">검색 결과 없음</option>
          </select>
          <img :src="icSelectCaret" alt="">
        </label>
        <label class="filter-select">
          <span class="sr-only">시트 필터</span>
          <select v-model="sheetFilter" :disabled="comparison === null || loading">
            <option value="all">전체 시트</option>
            <option v-for="sheet in sheets" :key="sheet" :value="sheet">{{ sheet }}</option>
          </select>
          <img :src="icSelectCaret" alt="">
        </label>
        <label class="filter-select">
          <span class="sr-only">공급사 필터</span>
          <select v-model="supplierFilter" :disabled="comparison === null || loading">
            <option value="all">전체 공급사</option>
            <option v-for="supplier in suppliers" :key="supplier" :value="supplier">{{ supplierLabel(supplier) }}</option>
          </select>
          <img :src="icSelectCaret" alt="">
        </label>
      </section>

      <main class="modal-content">
        <div v-if="loading" class="state-panel">
          <span class="spinner" aria-hidden="true" />
          <strong>BOM 비교 데이터를 불러오는 중입니다.</strong>
        </div>

        <div v-else-if="failed" class="state-panel error" role="alert">
          <strong>저장된 BOM 비교 데이터를 불러오지 못했습니다.</strong>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button type="button" class="primary-button" @click="emit('retry')">다시 불러오기</button>
        </div>

        <div v-else-if="comparison === null" class="state-panel">
          <strong>비교할 후보 스냅샷이 없습니다.</strong>
          <p>BOM 분석이 완료되면 Excel 원본과 저장된 공급사 후보를 비교할 수 있습니다.</p>
        </div>

        <template v-else>
          <section v-if="visibleItems.length > 0" class="comparison-list">
            <article v-for="item in visibleItems" :key="item.id" class="comparison-item">
              <header class="item-header">
                <div class="item-heading">
                  <h3 :title="itemTitle(item)">{{ itemTitle(item) }}</h3>
                  <div class="item-statuses">
                    <span v-if="itemRecommendation(item) === 'review'" class="recommendation-chip review">검토 필요</span>
                    <span class="status-chip" :class="statusCategory(item)">{{ statusLabel(item) }}</span>
                  </div>
                </div>
                <span class="item-meta" :title="`${itemMeta(item)} · ${itemRefs(item)}`">{{ itemMeta(item) }}</span>
              </header>

              <div class="comparison-scroll">
                <div class="comparison-grid" :style="gridStyle">
                  <div class="column-head field-column">항목</div>
                  <div class="column-head source-column">Excel 원본</div>
                  <div v-for="supplier in visibleSuppliers" :key="`header-${supplier}`" class="column-head">
                    {{ supplierLabel(supplier) }}
                  </div>

                  <template v-for="field in fieldsFor(item)" :key="field.key">
                    <div class="field-cell field-column" :class="{ multiline: field.multiline }">{{ field.label }}</div>
                    <div
                      class="value-cell source-column"
                      :class="{ multiline: field.multiline, verified: sourceVerified(item, field.key) }"
                      :title="sourceValue(item, field.key)"
                    >
                      <span>{{ sourceValue(item, field.key) }}</span>
                      <small v-if="sourceProvenance(item, field.key)" class="source-provenance">
                        {{ sourceProvenance(item, field.key) }}
                      </small>
                    </div>
                    <div
                      v-for="supplier in visibleSuppliers"
                      :key="`${field.key}-${supplier}`"
                      class="value-cell"
                      :class="[cellState(item, supplier, field.key), { multiline: field.multiline }]"
                      :title="[supplierValue(item, supplier, field.key), relationLabel(item, supplier, field.key)].filter(Boolean).join(' · ')"
                    >
                      <span>{{ supplierValue(item, supplier, field.key) }}</span>
                      <small v-if="cellState(item, supplier, field.key) === 'mismatch'" class="relation-chip">
                        검토 권장
                      </small>
                      <small
                        v-else-if="cellState(item, supplier, field.key) === 'missing' && supplierValue(item, supplier, field.key) !== '—'"
                        class="relation-chip missing"
                      >
                        확인 필요
                      </small>
                    </div>
                  </template>
                </div>
              </div>
            </article>
          </section>

          <div v-else class="state-panel compact">
            <strong>조건에 맞는 부품이 없습니다.</strong>
            <p>검색어나 필터를 변경해 주세요.</p>
          </div>

          <nav v-if="pageCount > 1" class="pagination" aria-label="BOM 비교 페이지">
            <button type="button" :disabled="page <= 1" @click="page -= 1">이전</button>
            <span>{{ page }} / {{ pageCount }}</span>
            <button type="button" :disabled="page >= pageCount" @click="page += 1">다음</button>
          </nav>
        </template>
      </main>
    </section>
  </Teleport>
</template>

<style scoped>
.compare-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #37393e;
  background: #ebeef2;
  font-family: "Noto Sans KR", Pretendard, sans-serif;
}
.compare-header {
  position: relative;
  min-height: 172px;
  flex: 0 0 172px;
  padding: 15px 24px 0;
  border: 1px solid #d3d5dc;
  background: #f2f7fc;
}
.compare-heading {
  min-width: 0;
  padding-right: 48px;
}
.compare-kicker {
  height: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(6 16 35 / 70%);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}
.compare-kicker img {
  width: 16px;
  height: 11px;
  flex: 0 0 auto;
}
.compare-heading h2 {
  margin: 6px 0 0;
  overflow: hidden;
  color: #061023;
  font-size: 20px;
  font-weight: 700;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close-button {
  position: absolute;
  top: 16px;
  right: 24px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.close-button img {
  width: 32px;
  height: 32px;
  display: block;
}
.close-button:hover {
  background: rgb(70 69 76 / 8%);
}
.close-button:focus-visible {
  outline: 2px solid #4798ff;
  outline-offset: 2px;
}
.header-rule {
  position: absolute;
  top: 78px;
  right: 24px;
  left: 24px;
  height: 1px;
  background: #b8cbdb;
}
.summary-strip {
  position: absolute;
  top: 94px;
  left: 24px;
  height: 56px;
  display: flex;
  align-items: flex-start;
}
.summary-strip article {
  width: 170px;
  height: 51px;
  padding: 0 20px 0 0;
  display: grid;
  align-content: start;
  gap: 3px;
  border-right: 1px solid #b8cbdb;
}
.summary-strip article + article {
  padding-left: 20px;
}
.summary-strip span {
  color: #5f6777;
  font-size: 14px;
  font-weight: 500;
  line-height: 16px;
}
.summary-strip strong {
  color: #061023;
  font-size: 32px;
  font-weight: 700;
  line-height: 36px;
}
.summary-strip .matched strong { color: #38b614; }
.summary-strip .attention strong { color: #ff6900; }
.summary-strip .not-found strong { color: #ff5873; }
.toolbar {
  min-height: 71px;
  flex: 0 0 71px;
  padding: 15px 24px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow-x: auto;
  border-bottom: 1px solid #e1e4e9;
  background: white;
  box-shadow: 0 4px 10px rgb(0 0 0 / 5%);
}
.search-field {
  position: relative;
  width: 480px;
  height: 39px;
  flex: 0 0 480px;
  display: flex;
  align-items: center;
  border: 1px solid #d6dae7;
  border-radius: 6px;
  background: white;
}
.search-field input {
  width: 100%;
  height: 100%;
  padding: 0 45px 0 15px;
  border: 0;
  border-radius: inherit;
  outline: 0;
  color: #3f3f40;
  background: transparent;
  font-size: 13px;
  font-weight: 400;
}
.search-field input::placeholder { color: #8e97a5; }
.search-field img {
  position: absolute;
  top: 9px;
  right: 14px;
  width: 20px;
  height: 20px;
  pointer-events: none;
}
.filter-select {
  position: relative;
  width: 180px;
  height: 39px;
  flex: 0 0 180px;
}
.filter-select select {
  width: 100%;
  height: 100%;
  padding: 0 38px 0 16px;
  appearance: none;
  border: 1px solid #d6dae7;
  border-radius: 6px;
  outline: 0;
  color: #3f3f40;
  background: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.filter-select img {
  position: absolute;
  top: 17px;
  right: 13px;
  width: 9px;
  height: 6px;
  pointer-events: none;
}
.search-field:focus-within,
.filter-select:focus-within {
  border-color: #4798ff;
  box-shadow: 0 0 0 2px rgb(71 152 255 / 12%);
}
.search-field input:disabled,
.filter-select select:disabled {
  cursor: default;
  opacity: .55;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.modal-content {
  min-height: 0;
  flex: 1;
  padding: 24px 24px 32px;
  overflow: auto;
}
.comparison-list {
  display: grid;
  gap: 24px;
}
.comparison-item {
  overflow: hidden;
  border: 1px solid #c3c4c6;
  border-radius: 10px;
  background: white;
  box-shadow: 0 4px 10px rgb(0 0 0 / 5%);
}
.item-header {
  min-height: 68px;
  padding: 14px 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.item-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.item-heading h3 {
  max-width: min(720px, 52vw);
  margin: 0;
  overflow: hidden;
  color: #37393e;
  font-size: 22px;
  font-weight: 700;
  line-height: 28px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-statuses {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.recommendation-chip,
.status-chip {
  min-height: 24px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 19px;
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
}
.recommendation-chip.review {
  color: #ff6900;
  background: rgb(250 119 28 / 15%);
}
.status-chip {
  color: #5f6777;
  background: #edf0f4;
}
.status-chip.matched {
  color: #3ca11f;
  background: rgb(56 182 20 / 10%);
}
.status-chip.attention {
  color: #ff6900;
  background: rgb(250 119 28 / 15%);
}
.status-chip.not_found {
  color: #e13f5c;
  background: rgb(255 88 115 / 12%);
}
.item-meta {
  max-width: 380px;
  min-height: 24px;
  padding: 4px 8px;
  overflow: hidden;
  border-radius: 4px;
  color: white;
  background: #4798ff;
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comparison-scroll {
  overflow-x: auto;
  border-top: 1px solid #c3c4c6;
}
.comparison-grid {
  display: grid;
  align-items: stretch;
}
.column-head {
  min-width: 0;
  min-height: 50px;
  padding: 13px 17px;
  display: flex;
  align-items: center;
  border-right: 1px solid #c8ccd3;
  border-bottom: 1px solid #c3c4c6;
  color: #242527;
  background: #dfe3e7;
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
}
.field-cell,
.value-cell {
  min-width: 0;
  min-height: 44px;
  border-right: 1px solid #d6dce5;
  border-bottom: 1px solid #d6dce5;
}
.field-cell {
  padding: 10px 17px;
  display: flex;
  align-items: center;
  color: #4a5465;
  background: #f4f7fb;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}
.value-cell {
  padding: 9px 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #37393e;
  background: white;
  font-size: 14px;
  font-weight: 700;
  line-height: 16px;
}
.value-cell > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-cell.multiline,
.value-cell.multiline {
  min-height: 44px;
}
.value-cell.multiline > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value-cell.match {
  background: #eff9ed;
}
.value-cell.mismatch {
  background: #feebdd;
}
.value-cell.missing {
  color: #6c5b35;
  background: #fff8e8;
}
.relation-chip,
.source-provenance {
  min-height: 24px;
  padding: 5px 8px;
  flex: 0 0 auto;
  border-radius: 40px;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
}
.relation-chip {
  color: #f36907;
  background: rgb(255 255 255 / 60%);
}
.relation-chip.missing {
  color: #996d10;
}
.source-provenance {
  color: #3ca11f;
  background: rgb(255 255 255 / 60%);
}
.field-column {
  position: sticky;
  left: 0;
  z-index: 3;
}
.source-column {
  position: sticky;
  left: 152px;
  z-index: 2;
  box-shadow: 6px 0 12px rgb(34 55 81 / 4%);
}
.column-head.field-column {
  z-index: 5;
  background: #dfe3e7;
}
.column-head.source-column {
  z-index: 4;
  background: #e1ebf6;
}
.value-cell.source-column {
  background: #f8fbff;
}
.value-cell.source-column.verified {
  color: #37393e;
  background: #eff9ed;
}
.state-panel {
  min-height: 320px;
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid #c3c4c6;
  border-radius: 10px;
  color: #667085;
  background: white;
  box-shadow: 0 4px 10px rgb(0 0 0 / 5%);
  text-align: center;
}
.state-panel strong {
  color: #263348;
  font-size: 17px;
}
.state-panel p {
  margin: 0;
  font-size: 12px;
}
.state-panel.error {
  border-color: #fecdd3;
  background: #fffafb;
}
.state-panel.error strong {
  color: #b42336;
}
.state-panel.compact {
  min-height: 180px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #dbe7ff;
  border-top-color: #4798ff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
.primary-button,
.pagination button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid #cfd6e2;
  border-radius: 6px;
  color: #374151;
  background: white;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.primary-button {
  margin-top: 7px;
  border-color: #4798ff;
  color: white;
  background: #4798ff;
}
.pagination {
  min-height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #667085;
  font-size: 12px;
}
.pagination button:disabled {
  cursor: default;
  opacity: .4;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 900px) {
  .compare-header {
    min-height: 178px;
    flex-basis: 178px;
    padding-right: 16px;
    padding-left: 16px;
  }
  .header-rule {
    right: 16px;
    left: 16px;
  }
  .summary-strip {
    left: 16px;
    max-width: calc(100vw - 32px);
    overflow-x: auto;
  }
  .summary-strip article {
    width: 145px;
    flex: 0 0 145px;
  }
  .summary-strip strong {
    font-size: 27px;
  }
  .toolbar {
    padding-right: 16px;
    padding-left: 16px;
  }
  .search-field {
    width: 320px;
    flex-basis: 320px;
  }
  .modal-content {
    padding: 16px 12px 24px;
  }
  .item-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .item-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .item-heading h3 {
    max-width: calc(100vw - 60px);
  }
  .item-meta {
    max-width: 100%;
  }
}
</style>
