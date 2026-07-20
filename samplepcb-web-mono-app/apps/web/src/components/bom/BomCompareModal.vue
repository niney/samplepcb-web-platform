<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type {
  BomQuoteComparisonCandidateType,
  BomQuoteComparisonRowType,
  BomQuoteComparisonType,
  BomQuoteItemType,
} from '@sp/api-contract';

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
  digikey: 'DigiKey',
  unikeyic: 'UniKeyIC',
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
  gridTemplateColumns: `112px minmax(260px, 1.08fr) repeat(${String(visibleSuppliers.value.length)}, minmax(235px, 1fr))`,
  minWidth: `${String(372 + visibleSuppliers.value.length * 245)}px`,
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
  resistance_ohm: '저항',
  capacitance_f: '정전용량',
  inductance_h: '인덕턴스',
  power_w: '정격 전력',
  tolerance_percent: '허용오차',
  voltage_v: '정격 전압',
  current_a: '정격 전류',
  frequency_hz: '주파수',
  temperature_c: '온도',
  temperature_range_c: '동작 온도 범위',
  temperature_min_c: '최저 동작 온도',
  temperature_max_c: '최고 동작 온도',
  dielectric: '유전체 특성',
  stock: '재고',
  moq: '최소 주문 수량',
  best_price: '최저 단가',
  lifecycle: '수명주기',
};
const specOrder = [
  'resistance_ohm',
  'capacitance_f',
  'inductance_h',
  'power_w',
  'tolerance_percent',
  'voltage_v',
  'current_a',
  'frequency_hz',
  'temperature_c',
  'temperature_range_c',
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
  if (state === null) return item.comparison?.extraction?.reviewStatus === 'extracted' ? '엔진 추출' : '';
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
    return `${quoteSheet(item)} · 행 ${rows.length > 0 ? rows.join(', ') : '—'} · ${refs.length > 0 ? refs.join(', ') : 'REFDES 없음'}`;
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

function supplierStatus(item: ComparisonItem, supplier: string): string {
  const candidate = candidateFor(item, supplier);
  return candidate === undefined ? '검색 결과 없음' : (statusLabels[candidate.status] ?? candidate.status);
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
  return `${quoteSheet(item)} · 행 ${rows.length > 0 ? rows.join(', ') : '—'} · BOM 수량 ${formatValue(item.quoteItem.bomQty)}`;
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
      <header class="modal-header">
        <div class="min-w-0">
          <p class="kicker">SMART BOM · BOM COMPARISON</p>
          <h2 id="bom-compare-title" :title="title">{{ title }}</h2>
          <p>Excel 원본과 공급사 검색 결과를 같은 라인에서 비교합니다. 색상과 판정은 엔진의 검증 결과를 사용합니다.</p>
        </div>
        <button ref="closeButton" type="button" class="close-button" aria-label="BOM 비교 닫기" @click="emit('close')">×</button>
      </header>

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
          <section class="summary-grid" aria-label="BOM 비교 요약">
            <article><span>전체 부품</span><strong>{{ totalCount }}</strong></article>
            <article class="matched"><span>검증·호환</span><strong>{{ matchedCount }}</strong></article>
            <article class="attention"><span>확인 필요</span><strong>{{ attentionCount }}</strong></article>
            <article class="not-found"><span>검색 결과 없음</span><strong>{{ notFoundCount }}</strong></article>
          </section>

          <section class="toolbar" aria-label="BOM 비교 필터">
            <label class="search-field">
              <span aria-hidden="true">⌕</span>
              <input v-model="search" type="search" placeholder="REFDES, 품번, 제조사, 설명 검색">
            </label>
            <label>
              <span>판정</span>
              <select v-model="statusFilter">
                <option value="all">전체 판정</option>
                <option value="matched">검증·호환</option>
                <option value="attention">확인 필요</option>
                <option value="not_found">검색 결과 없음</option>
              </select>
            </label>
            <label>
              <span>시트</span>
              <select v-model="sheetFilter">
                <option value="all">전체 시트</option>
                <option v-for="sheet in sheets" :key="sheet" :value="sheet">{{ sheet }}</option>
              </select>
            </label>
            <label>
              <span>공급사 열</span>
              <select v-model="supplierFilter">
                <option value="all">전체 공급사</option>
                <option v-for="supplier in suppliers" :key="supplier" :value="supplier">{{ supplierLabel(supplier) }}</option>
              </select>
            </label>
            <strong class="result-count">{{ comparison.total }}개</strong>
          </section>

          <p class="comparison-guide">
            <span class="match">일치·호환</span>
            <span class="mismatch">불일치</span>
            <span class="missing">확인 불가</span>
            <em>가로로 스크롤하면 모든 공급사 결과를 확인할 수 있습니다.</em>
          </p>

          <section v-if="visibleItems.length > 0" class="comparison-list">
            <article v-for="item in visibleItems" :key="item.id" class="comparison-item">
              <header class="item-header">
                <div class="item-identity">
                  <strong class="refs" :title="itemRefs(item)">{{ itemRefs(item) }}</strong>
                  <div>
                    <strong class="item-title" :title="itemTitle(item)">{{ itemTitle(item) }}</strong>
                    <span class="item-meta" :title="itemMeta(item)">{{ itemMeta(item) }}</span>
                  </div>
                </div>
                <span class="status-chip" :class="statusCategory(item)">{{ statusLabel(item) }}</span>
              </header>

              <div class="comparison-scroll">
                <div class="comparison-grid" :style="gridStyle">
                  <div class="column-head field-column"><span>COMPARE FIELD</span><strong>항목</strong></div>
                  <div class="column-head source-column"><span>EXCEL SOURCE</span><strong>Excel 원본</strong></div>
                  <div v-for="supplier in visibleSuppliers" :key="`header-${supplier}`" class="column-head">
                    <span>SUPPLIER RESULT</span>
                    <strong>{{ supplierLabel(supplier) }}</strong>
                    <small>{{ supplierStatus(item, supplier) }}</small>
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
                      :title="supplierValue(item, supplier, field.key)"
                    >
                      <span>{{ supplierValue(item, supplier, field.key) }}</span>
                      <small v-if="relationLabel(item, supplier, field.key)" class="relation-chip">
                        {{ relationLabel(item, supplier, field.key) }}
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
.compare-modal { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; color: #142033; background: #f4f7fb; }
.modal-header { flex: 0 0 auto; min-height: 92px; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; color: white; background: #061023; box-shadow: 0 3px 16px rgb(15 23 42 / 18%); }
.modal-header > div { min-width: 0; }
.modal-header .kicker { margin: 0 0 4px; color: #8fb8ff; font-size: 10px; font-weight: 800; letter-spacing: .11em; }
.modal-header h2 { margin: 0; max-width: min(900px, 75vw); overflow: hidden; color: white; font-size: 21px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.modal-header p:last-child { margin: 5px 0 0; color: #aebbd0; font-size: 12px; }
.close-button { width: 44px; height: 44px; flex: 0 0 auto; border: 1px solid rgb(255 255 255 / 24%); border-radius: 11px; color: white; background: rgb(255 255 255 / 8%); font-size: 30px; line-height: 1; cursor: pointer; }
.close-button:hover, .close-button:focus-visible { background: rgb(255 255 255 / 18%); outline: 2px solid #8fb8ff; outline-offset: 2px; }
.modal-content { min-height: 0; flex: 1; padding: 20px 24px 32px; overflow: auto; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary-grid article { min-height: 80px; padding: 14px 16px; display: flex; align-items: flex-end; justify-content: space-between; border: 1px solid #dfe4ec; border-radius: 12px; background: white; }
.summary-grid span { color: #6b7280; font-size: 12px; font-weight: 700; }
.summary-grid strong { color: #142033; font-size: 25px; }
.summary-grid .matched strong { color: #078461; }
.summary-grid .attention strong { color: #b16a08; }
.summary-grid .not-found strong { color: #c03b42; }
.toolbar { position: sticky; top: -20px; z-index: 20; margin-top: 12px; padding: 12px; display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; border: 1px solid #dfe4ec; border-radius: 12px; background: rgb(255 255 255 / 96%); box-shadow: 0 7px 18px rgb(15 23 42 / 6%); backdrop-filter: blur(8px); }
.toolbar > label:not(.search-field) { display: grid; gap: 4px; }
.toolbar label > span { color: #737d8f; font-size: 10px; font-weight: 800; }
.toolbar select { height: 38px; min-width: 136px; padding: 0 30px 0 10px; border: 1px solid #d5dbe5; border-radius: 8px; color: #374151; background: #f8fafc; font-size: 12px; }
.search-field { width: min(350px, 100%); height: 38px; padding: 0 12px; display: flex; align-items: center; gap: 7px; border: 1px solid #d5dbe5; border-radius: 8px; background: #f8fafc; }
.search-field input { min-width: 0; width: 100%; height: 100%; border: 0; outline: 0; background: transparent; font-size: 12px; }
.result-count { margin: 0 4px 10px auto; color: #1e64fd; font-size: 12px; }
.comparison-guide { margin: 13px 2px 0; display: flex; align-items: center; gap: 13px; color: #788395; font-size: 11px; }
.comparison-guide > span { display: inline-flex; align-items: center; gap: 5px; font-weight: 800; }
.comparison-guide > span::before { content: ''; width: 8px; height: 8px; border-radius: 50%; }
.comparison-guide .match::before { background: #42a486; }
.comparison-guide .mismatch::before { background: #d76d72; }
.comparison-guide .missing::before { background: #d6a94f; }
.comparison-guide em { margin-left: auto; font-style: normal; }
.comparison-list { margin-top: 12px; display: grid; gap: 16px; }
.comparison-item { padding: 14px; overflow: hidden; border: 1px solid #dfe4ec; border-radius: 14px; background: white; box-shadow: 0 3px 12px rgb(15 23 42 / 4%); }
.item-header { min-height: 54px; padding: 0 2px 12px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.item-identity { min-width: 0; display: flex; align-items: center; gap: 14px; }
.item-identity .refs { width: 150px; overflow: hidden; color: #1e64fd; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.item-identity > div { min-width: 0; display: grid; gap: 4px; }
.item-title, .item-meta { max-width: 740px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-title { color: #142033; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
.item-meta { color: #8490a2; font-size: 10px; }
.status-chip { flex: 0 0 auto; padding: 5px 9px; border-radius: 99px; color: #596579; background: #edf0f4; font-size: 10px; font-weight: 800; }
.status-chip.matched { color: #08785b; background: #e1f5ee; }
.status-chip.attention { color: #98600d; background: #fff3d7; }
.status-chip.not_found { color: #a33b42; background: #feecee; }
.comparison-scroll { overflow: auto; border: 1px solid #dfe4ec; border-radius: 11px; }
.comparison-grid { display: grid; align-items: stretch; }
.column-head { min-width: 0; min-height: 68px; padding: 11px 13px; display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; border-right: 1px solid #dfe4ec; border-bottom: 1px solid #dfe4ec; background: #f2f5f9; }
.column-head span { color: #8b95a4; font-size: 8px; font-weight: 900; letter-spacing: .09em; }
.column-head strong { color: #263348; font-size: 14px; }
.column-head small { overflow: hidden; color: #788395; font-size: 9px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.field-cell, .value-cell { min-width: 0; min-height: 50px; border-right: 1px solid #e5e9ef; border-bottom: 1px solid #e5e9ef; }
.field-cell { padding: 9px 10px; display: flex; align-items: center; color: #687386; background: #f5f7fa; font-size: 10px; font-weight: 800; }
.value-cell { padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 7px; color: #344054; background: white; font-size: 12px; font-weight: 650; }
.value-cell > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-cell.multiline, .value-cell.multiline { min-height: 62px; }
.value-cell.multiline > span { display: -webkit-box; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.value-cell.match { background: #ecf9f4; }
.value-cell.mismatch { background: #fff0f1; }
.value-cell.missing { color: #8a681e; background: #fff9ea; }
.relation-chip { flex: 0 0 auto; padding: 3px 5px; border-radius: 5px; color: #5c6879; background: #e9edf2; font-size: 8px; white-space: nowrap; }
.source-provenance { flex: 0 0 auto; padding: 3px 5px; border-radius: 5px; color: #526273; background: #e8edf3; font-size: 8px; font-weight: 800; white-space: nowrap; }
.value-cell.match .relation-chip { color: #08785b; background: #d4eee5; }
.value-cell.mismatch .relation-chip { color: #963d43; background: #f6d6d8; }
.field-column { position: sticky; left: 0; z-index: 3; }
.source-column { position: sticky; left: 112px; z-index: 2; box-shadow: 7px 0 13px rgb(23 48 46 / 4%); }
.column-head.field-column { z-index: 5; background: #e4eaf2; }
.column-head.source-column { z-index: 4; background: #eaf1fb; }
.value-cell.source-column { background: #fbfcfe; }
.value-cell.source-column.verified { color: #076c53; background: #edf9f5; box-shadow: inset 3px 0 #20a77d; }
.value-cell.source-column.verified .source-provenance { color: #076c53; background: #d4eee5; }
.state-panel { min-height: 300px; padding: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 1px solid #dfe4ec; border-radius: 14px; color: #667085; background: white; text-align: center; }
.state-panel strong { color: #263348; font-size: 17px; }
.state-panel p { margin: 0; font-size: 12px; }
.state-panel.error { border-color: #fecdd3; background: #fffafb; }
.state-panel.error strong { color: #b42336; }
.state-panel.compact { min-height: 180px; margin-top: 12px; }
.spinner { width: 28px; height: 28px; border: 3px solid #dbe7ff; border-top-color: #1e64fd; border-radius: 50%; animation: spin .8s linear infinite; }
.primary-button, .pagination button { height: 36px; padding: 0 14px; border: 1px solid #cfd6e2; border-radius: 8px; color: #374151; background: white; font-size: 12px; font-weight: 700; cursor: pointer; }
.primary-button { margin-top: 7px; border-color: #1e64fd; color: white; background: #1e64fd; }
.pagination { min-height: 62px; display: flex; align-items: center; justify-content: center; gap: 16px; color: #667085; font-size: 12px; }
.pagination button:disabled { cursor: default; opacity: .4; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 800px) {
  .modal-header { padding: 14px 16px; }
  .modal-header p:last-child { display: none; }
  .modal-content { padding: 14px 12px 24px; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar { top: -14px; }
  .result-count { width: 100%; margin: 0; }
  .comparison-guide { align-items: flex-start; flex-wrap: wrap; }
  .comparison-guide em { width: 100%; margin-left: 0; }
  .item-header { align-items: flex-start; }
  .item-identity { align-items: flex-start; flex-direction: column; gap: 5px; }
  .item-identity .refs { width: 190px; }
}
</style>
