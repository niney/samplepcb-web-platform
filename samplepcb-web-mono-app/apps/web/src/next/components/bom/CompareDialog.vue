<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { SearchIcon } from '@lucide/vue';
import type {
  BomQuoteComparisonCandidateType,
  BomQuoteComparisonRowType,
  BomQuoteComparisonType,
  BomQuoteItemType,
} from '@sp/api-contract';
import ListPagination from '@/next/components/common/ListPagination.vue';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/next/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';

// BOM 비교 — 옛 components/admin/bom/BomCompareModal.vue 의 짝(같은 props·emits). Excel 원본과 공급사 검색
// 결과를 같은 라인에서 비교한다. 색과 판정은 엔진의 검증 결과를 그대로 쓴다. 옛 모달이 손으로 하던
// 포커스 가두기·스크롤 잠금·Esc 는 Dialog 가 한다. 비교 격자는 표(머리 열 두 개 고정)로 옮겼다.

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

const errorPanelRef = ref<HTMLElement | null>(null);

watch(
  () => props.failed,
  async (failed) => {
    if (!failed || !props.open) return;
    await nextTick();
    errorPanelRef.value?.focus();
  },
);

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

const STATUS_CATEGORY_VARIANT = {
  matched: 'success',
  attention: 'warning',
  not_found: 'danger',
} as const;

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
const visibleItems = computed(() => comparisonItems.value);
const visibleSuppliers = computed(() =>
  supplierFilter.value === 'all' ? suppliers.value : suppliers.value.filter((name) => name === supplierFilter.value),
);

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
watch(() => props.comparison?.totalPages, (count) => {
  if (count !== undefined && page.value > count) page.value = count;
});
watch(suppliers, (values) => {
  if (supplierFilter.value !== 'all' && !values.includes(supplierFilter.value)) supplierFilter.value = 'all';
});

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'matched', 'attention', 'not_found'];
const selectValue = (event: Event): string => (event.target instanceof HTMLSelectElement ? event.target.value : '');
const onStatusChange = (event: Event): void => {
  const value = selectValue(event);
  statusFilter.value = STATUS_FILTERS.find((entry) => entry === value) ?? 'all';
};
const onSheetChange = (event: Event): void => {
  sheetFilter.value = selectValue(event) || 'all';
};
const onSupplierChange = (event: Event): void => {
  supplierFilter.value = selectValue(event) || 'all';
};

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

// 비교 격자의 칸 색 — 공지 상자가 아니라 데이터 판정 히트맵이라 상태 토큰의 옅은 바탕을 칸에 직접 깐다.
const CELL_CLASS: Record<CellState, string> = {
  match: 'bg-success-soft',
  mismatch: 'bg-destructive-soft',
  missing: 'bg-warning-soft text-warning',
  neutral: 'bg-background',
};
const cellClass = (item: ComparisonItem, supplier: string, key: string): string =>
  CELL_CLASS[cellState(item, supplier, key)];
const sourceCellClass = (item: ComparisonItem, key: string): string =>
  sourceVerified(item, key) ? 'border-l-2 border-l-success bg-success-soft text-success' : 'bg-card';

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
  if (candidate === undefined) return '검색 결과 없음';
  const status = statusLabels[candidate.status] ?? candidate.status;
  if (candidate.reviewRecommended) return `${status} · 검토 권장`;
  if (candidate.selectionRecommendation === 'preselect') return `${status} · 기술 사전 선정`;
  if (candidate.selectionRecommendation === 'exclude') return `${status} · 선정 제외`;
  return status;
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
  return `${quoteSheet(item)} · 행 ${rows.length > 0 ? rows.join(', ') : '—'} · BOM 수량 ${formatValue(item.quoteItem.bomQty)}`;
}

function supplierLabel(value: string): string {
  return supplierLabels[value] ?? value;
}

function statusLabel(item: ComparisonItem): string {
  const status = itemStatus(item);
  return statusLabels[status] ?? status;
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="flex h-[calc(100dvh-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]">
      <DialogHeader>
        <DialogTitle>
          <span class="block truncate" :title="title">BOM 비교 — {{ title }}</span>
        </DialogTitle>
        <DialogDescription>
          Excel 원본과 공급사 검색 결과를 같은 라인에서 비교합니다. 색상과 판정은 엔진의 검증 결과를 사용합니다.
        </DialogDescription>
      </DialogHeader>

      <div class="-mx-6 min-h-0 flex-1 overflow-auto px-6">
        <p v-if="loading" class="text-muted-foreground flex min-h-72 items-center justify-center gap-2 text-sm">
          <Spinner />BOM 비교 데이터를 불러오는 중입니다.
        </p>

        <div v-else-if="failed" ref="errorPanelRef" tabindex="-1" aria-live="assertive" class="outline-none">
          <Alert variant="destructive">
            <AlertTitle>저장된 BOM 비교 데이터를 불러오지 못했습니다.</AlertTitle>
            <AlertDescription>
              잠시 후 다시 시도해 주세요.
              <Button size="sm" class="mt-2" @click="emit('retry')">다시 불러오기</Button>
            </AlertDescription>
          </Alert>
        </div>

        <Alert v-else-if="comparison === null" variant="muted">
          <AlertTitle>비교할 후보 스냅샷이 없습니다.</AlertTitle>
          <AlertDescription>BOM 분석이 완료되면 Excel 원본과 저장된 공급사 후보를 비교할 수 있습니다.</AlertDescription>
        </Alert>

        <template v-else>
          <section class="grid grid-cols-2 gap-2.5 md:grid-cols-4" aria-label="BOM 비교 요약">
            <Panel size="md" class="flex items-end justify-between">
              <span class="text-muted-foreground text-xs font-semibold">전체 부품</span>
              <strong class="text-foreground text-2xl tabular-nums">{{ totalCount }}</strong>
            </Panel>
            <Panel size="md" class="flex items-end justify-between">
              <span class="text-muted-foreground text-xs font-semibold">검증·호환</span>
              <strong class="text-success text-2xl tabular-nums">{{ matchedCount }}</strong>
            </Panel>
            <Panel size="md" class="flex items-end justify-between">
              <span class="text-muted-foreground text-xs font-semibold">확인 필요</span>
              <strong class="text-warning text-2xl tabular-nums">{{ attentionCount }}</strong>
            </Panel>
            <Panel size="md" class="flex items-end justify-between">
              <span class="text-muted-foreground text-xs font-semibold">검색 결과 없음</span>
              <strong class="text-destructive text-2xl tabular-nums">{{ notFoundCount }}</strong>
            </Panel>
          </section>

          <!-- 필터 줄은 스크롤해도 위에 남는다 -->
          <section class="bg-background sticky top-0 z-20 mt-3 flex flex-wrap items-end gap-2.5 border-b py-3" aria-label="BOM 비교 필터">
            <InputGroup class="w-full max-w-sm">
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              <InputGroupInput v-model="search" type="search" aria-label="BOM 비교 검색" placeholder="REFDES, 품번, 제조사, 설명 검색" />
            </InputGroup>
            <label class="grid gap-1">
              <span class="text-muted-foreground text-xs font-semibold">판정</span>
              <NativeSelect :model-value="statusFilter" aria-label="판정 필터" @change="onStatusChange">
                <NativeSelectOption value="all">전체 판정</NativeSelectOption>
                <NativeSelectOption value="matched">검증·호환</NativeSelectOption>
                <NativeSelectOption value="attention">확인 필요</NativeSelectOption>
                <NativeSelectOption value="not_found">검색 결과 없음</NativeSelectOption>
              </NativeSelect>
            </label>
            <label class="grid gap-1">
              <span class="text-muted-foreground text-xs font-semibold">시트</span>
              <NativeSelect :model-value="sheetFilter" aria-label="시트 필터" @change="onSheetChange">
                <NativeSelectOption value="all">전체 시트</NativeSelectOption>
                <NativeSelectOption v-for="sheet in sheets" :key="sheet" :value="sheet">{{ sheet }}</NativeSelectOption>
              </NativeSelect>
            </label>
            <label class="grid gap-1">
              <span class="text-muted-foreground text-xs font-semibold">공급사 열</span>
              <NativeSelect :model-value="supplierFilter" aria-label="공급사 열 필터" @change="onSupplierChange">
                <NativeSelectOption value="all">전체 공급사</NativeSelectOption>
                <NativeSelectOption v-for="supplier in suppliers" :key="supplier" :value="supplier">{{ supplierLabel(supplier) }}</NativeSelectOption>
              </NativeSelect>
            </label>
            <strong class="text-primary ml-auto pb-2 text-sm tabular-nums">{{ comparison.total }}개</strong>
          </section>

          <p class="text-muted-foreground mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span class="inline-flex items-center gap-1.5 font-semibold"><span class="bg-success size-2 rounded-full" />일치·호환</span>
            <span class="inline-flex items-center gap-1.5 font-semibold"><span class="bg-destructive size-2 rounded-full" />불일치</span>
            <span class="inline-flex items-center gap-1.5 font-semibold"><span class="bg-warning size-2 rounded-full" />확인 불가</span>
            <span class="ml-auto">가로로 스크롤하면 모든 공급사 결과를 확인할 수 있습니다.</span>
          </p>

          <section v-if="visibleItems.length > 0" class="mt-3 flex flex-col gap-4 pb-4">
            <Panel v-for="item in visibleItems" :key="item.id" size="md">
              <header class="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div class="flex min-w-0 items-center gap-3.5">
                  <strong class="text-primary w-36 truncate text-xs" :title="itemRefs(item)">{{ itemRefs(item) }}</strong>
                  <div class="grid min-w-0 gap-1">
                    <strong class="text-foreground truncate font-mono text-sm" :title="itemTitle(item)">{{ itemTitle(item) }}</strong>
                    <span class="text-muted-foreground truncate text-xs" :title="itemMeta(item)">{{ itemMeta(item) }}</span>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Badge v-if="itemRecommendation(item) === 'review'" variant="warning">검토 권장</Badge>
                  <Badge v-else-if="itemRecommendation(item) === 'preselect'" variant="success">기술 사전 선정</Badge>
                  <Badge :variant="STATUS_CATEGORY_VARIANT[statusCategory(item)]">{{ statusLabel(item) }}</Badge>
                </div>
              </header>

              <div
                class="overflow-auto rounded-md border"
                role="region"
                :aria-label="`${itemTitle(item)} 공급사 비교표, 좌우로 스크롤`"
                tabindex="0"
              >
                <!-- 항목·Excel 원본 두 열은 가로 스크롤에도 고정(옛 격자와 같음) -->
                <table class="w-max min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th class="bg-muted text-muted-foreground sticky left-0 z-20 w-28 border-r border-b px-2.5 py-2.5 text-left text-xs font-semibold">항목</th>
                      <th class="bg-muted text-foreground sticky left-28 z-10 min-w-64 border-r border-b px-3 py-2.5 text-left text-sm font-semibold">Excel 원본</th>
                      <th
                        v-for="supplier in visibleSuppliers"
                        :key="`header-${supplier}`"
                        class="bg-muted min-w-60 border-r border-b px-3 py-2.5 text-left align-bottom"
                      >
                        <strong class="text-foreground block text-sm">{{ supplierLabel(supplier) }}</strong>
                        <small class="text-muted-foreground block truncate text-xs font-medium">{{ supplierStatus(item, supplier) }}</small>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="field in fieldsFor(item)" :key="field.key">
                      <td class="bg-muted text-muted-foreground sticky left-0 z-20 w-28 border-r border-b px-2.5 py-2 text-xs font-semibold">
                        {{ field.label }}
                      </td>
                      <td
                        class="sticky left-28 z-10 max-w-80 min-w-64 border-r border-b px-3 py-2"
                        :class="sourceCellClass(item, field.key)"
                        :title="sourceValue(item, field.key)"
                      >
                        <span class="flex items-center justify-between gap-2">
                          <span class="min-w-0" :class="field.multiline ? 'line-clamp-2' : 'truncate'">{{ sourceValue(item, field.key) }}</span>
                          <Badge v-if="sourceProvenance(item, field.key)" variant="secondary" class="shrink-0">
                            {{ sourceProvenance(item, field.key) }}
                          </Badge>
                        </span>
                      </td>
                      <td
                        v-for="supplier in visibleSuppliers"
                        :key="`${field.key}-${supplier}`"
                        class="max-w-80 min-w-60 border-r border-b px-3 py-2"
                        :class="cellClass(item, supplier, field.key)"
                        :title="supplierValue(item, supplier, field.key)"
                      >
                        <span class="flex items-center justify-between gap-2">
                          <span class="min-w-0" :class="field.multiline ? 'line-clamp-2' : 'truncate'">{{ supplierValue(item, supplier, field.key) }}</span>
                          <Badge v-if="relationLabel(item, supplier, field.key)" variant="outline" class="shrink-0">
                            {{ relationLabel(item, supplier, field.key) }}
                          </Badge>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <Alert v-else variant="muted" class="mt-3">
            <AlertTitle>조건에 맞는 부품이 없습니다.</AlertTitle>
            <AlertDescription>검색어나 필터를 변경해 주세요.</AlertDescription>
          </Alert>

          <ListPagination
            v-if="comparison.totalPages > 1"
            class="pb-2"
            :page="page"
            :page-size="comparison.pageSize"
            :total="comparison.total"
            @update:page="page = $event"
          />
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
