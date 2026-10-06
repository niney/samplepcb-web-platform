<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, Trash2Icon, XIcon } from '@lucide/vue';
import type { PartBulkDeleteFilterType, PartBulkDeletePreviewDataType, PartHitType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { parseSpecToken, type SpecKind } from '@sp/utils';
import {
  useBulkDeleteParts,
  usePartSearch,
  usePreviewPartBulkDelete,
  useResetParts,
  type PartSearchFilters,
} from '@/admin/useAdminParts';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import PartImage from '@/next/components/bom/PartImage.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Empty, EmptyDescription } from '@/next/components/ui/empty';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/next/components/ui/input-group';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import PartBulkDeletePanel from '@/next/components/core/parts/PartBulkDeletePanel.vue';
import PartDetailPanel from '@/next/components/core/parts/PartDetailPanel.vue';
import PartFacets from '@/next/components/core/parts/PartFacets.vue';
import { fmtAge, fmtPrice, specSummary, supplierLabel, type PartFacetKey } from '@/next/components/core/parts/part-format';

// 부품 카탈로그 검색 — 옛 pages/admin/AdminParts.vue 의 리뉴얼. "검색 콘솔" 카드가 이 화면의 주인공이다:
// 단위·표기 자유 검색이 본질이라 검색·정렬·재고·스펙 범위를 한 카드로 모은다. 데이터는 BOM 공급사 검색이
// 자동 적재한 카탈로그(sp_part*/sp-parts). 결과 행을 누르면 그 자리에서 구매 조건·가격 구간이 펼쳐진다.

const input = ref('');
const q = ref('');
const filters = ref<PartSearchFilters>({ page: 1, pageSize: 20, sort: 'relevance' });
const enabled = ref(false);
const detailId = ref<string | null>(null);
const sortSel = ref<'relevance' | 'price' | 'stock'>('relevance');
const inStockOnly = ref(false);
const rangeOpen = ref(false);

// 클릭하면 바로 검색되는 예시 — 단위 자유 검색이라는 도메인 특성을 화면으로 보여 준다.
const EXAMPLES = ['4k7', '104K', '0.1uF 0402', '0.0047M', 'GRM155'] as const;

// 스펙 범위(자유 표기) — kind 별 min/max 텍스트 입력, spec-units 파서가 SI 로 변환.
interface RangeInput {
  kind: SpecKind;
  label: string;
  minKey: 'resistanceMin' | 'capacitanceMin' | 'inductanceMin' | 'voltageMin';
  maxKey: 'resistanceMax' | 'capacitanceMax' | 'inductanceMax' | 'voltageMax';
  min: string;
  max: string;
  placeholder: string;
}
const rangeInputs = ref<RangeInput[]>([
  { kind: 'resistance', label: '저항', minKey: 'resistanceMin', maxKey: 'resistanceMax', min: '', max: '', placeholder: '1k · 4k7 · 10kΩ' },
  { kind: 'capacitance', label: '용량', minKey: 'capacitanceMin', maxKey: 'capacitanceMax', min: '', max: '', placeholder: '100n · 2.2uF · 104' },
  { kind: 'inductance', label: '인덕턴스', minKey: 'inductanceMin', maxKey: 'inductanceMax', min: '', max: '', placeholder: '10uH · 1mH' },
  { kind: 'voltage', label: '전압', minKey: 'voltageMin', maxKey: 'voltageMax', min: '', max: '', placeholder: '6.3V · 16V' },
]);

/** 자유 표기 → 해당 kind 의 SI 값(파싱 실패·kind 불일치는 undefined = 무시). */
function toSiFor(kind: SpecKind, raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const hit = parseSpecToken(t)
    .filter((s) => s.kind === kind)
    .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1))[0];
  return hit?.si;
}

const search = usePartSearch(q, filters, enabled);
const data = computed(() => search.data.value?.data ?? null);
const items = computed<PartHitType[]>(() => data.value?.items ?? []);
const searchFailed = computed(() => search.isError.value);

// ── 카탈로그 초기화 — 전체 하드 삭제(자동 인제스트로 다시 자란다). 되돌릴 수 없어 2단계 인라인 확인. ──
const resetParts = useResetParts();
const resetArm = ref(false);
const resetMsg = ref('');
const resetFailed = ref(false);

function armReset(): void {
  resetArm.value = true;
  resetMsg.value = '';
  setTimeout(() => (resetArm.value = false), 5_000);
}

async function onReset(): Promise<void> {
  resetArm.value = false;
  try {
    const res = await resetParts.mutateAsync();
    resetFailed.value = false;
    resetMsg.value = `카탈로그 초기화 완료 — 부품 ${String(res.data.parts)}건 · 관련 견적 ${String(res.data.quotes)}건(${String(res.data.quoteItems)}개 연결 라인) 삭제`;
  } catch {
    resetFailed.value = true;
    resetMsg.value = '초기화 실패 — 잠시 후 다시 시도하세요.';
  }
}

// ── 현재 필터 결과 전체 삭제 — 서버 미리보기 hash + 건수 확인 문구 ──
const bulkPreviewMutation = usePreviewPartBulkDelete();
const bulkDeleteMutation = useBulkDeleteParts();
const bulkPreview = ref<PartBulkDeletePreviewDataType | null>(null);
const bulkConfirmation = ref('');
const bulkDeleteError = ref('');
const bulkDeleteMsg = ref('');

function currentBulkDeleteFilter(): PartBulkDeleteFilterType {
  const value = filters.value;
  return {
    q: q.value,
    inStockOnly: value.inStockOnly ?? false,
    ...(value.manufacturer === undefined ? {} : { manufacturer: value.manufacturer }),
    ...(value.packageCode === undefined ? {} : { packageCode: value.packageCode }),
    ...(value.supplier === undefined ? {} : { supplier: value.supplier }),
    ...(value.resistanceMin === undefined ? {} : { resistanceMin: value.resistanceMin }),
    ...(value.resistanceMax === undefined ? {} : { resistanceMax: value.resistanceMax }),
    ...(value.capacitanceMin === undefined ? {} : { capacitanceMin: value.capacitanceMin }),
    ...(value.capacitanceMax === undefined ? {} : { capacitanceMax: value.capacitanceMax }),
    ...(value.inductanceMin === undefined ? {} : { inductanceMin: value.inductanceMin }),
    ...(value.inductanceMax === undefined ? {} : { inductanceMax: value.inductanceMax }),
    ...(value.voltageMin === undefined ? {} : { voltageMin: value.voltageMin }),
    ...(value.voltageMax === undefined ? {} : { voltageMax: value.voltageMax }),
  };
}

const hasBulkDeleteFilter = computed(() => {
  const value = currentBulkDeleteFilter();
  return (
    value.q !== '' ||
    value.manufacturer !== undefined ||
    value.packageCode !== undefined ||
    value.supplier !== undefined ||
    value.inStockOnly ||
    value.resistanceMin !== undefined ||
    value.resistanceMax !== undefined ||
    value.capacitanceMin !== undefined ||
    value.capacitanceMax !== undefined ||
    value.inductanceMin !== undefined ||
    value.inductanceMax !== undefined ||
    value.voltageMin !== undefined ||
    value.voltageMax !== undefined
  );
});

function closeBulkDelete(): void {
  bulkPreview.value = null;
  bulkConfirmation.value = '';
  bulkDeleteError.value = '';
}

async function previewBulkDelete(): Promise<void> {
  bulkDeleteError.value = '';
  bulkDeleteMsg.value = '';
  try {
    const response = await bulkPreviewMutation.mutateAsync(currentBulkDeleteFilter());
    bulkPreview.value = response.data;
    bulkConfirmation.value = '';
  } catch {
    bulkDeleteError.value = '삭제 대상을 확인할 수 없습니다. 검색 서비스 상태를 확인하세요.';
  }
}

async function executeBulkDelete(): Promise<void> {
  const preview = bulkPreview.value;
  if (preview === null) return;
  bulkDeleteError.value = '';
  try {
    const response = await bulkDeleteMutation.mutateAsync({
      filter: currentBulkDeleteFilter(),
      previewHash: preview.previewHash,
      confirmation: bulkConfirmation.value,
    });
    const result = response.data;
    bulkDeleteMsg.value = `필터 결과 ${String(result.deletedParts)}건 삭제 · 견적 연결 ${String(result.protectedParts)}건 보호${
      result.esCleanupPending ? ' · 검색 색인 정리 재시도 필요' : ''
    }`;
    detailId.value = null;
    closeBulkDelete();
  } catch (error) {
    if (error instanceof ApiRequestError && error.payload?.error === 'BULK_DELETE_PREVIEW_STALE') {
      bulkDeleteError.value = '대상 또는 견적 연결이 변경되었습니다. 미리보기를 다시 확인하세요.';
      return;
    }
    bulkDeleteError.value =
      error instanceof ApiRequestError
        ? (error.payload?.message ?? '필터 결과 삭제에 실패했습니다.')
        : '필터 결과 삭제에 실패했습니다.';
  }
}

// ── 검색 ──
function onSearch(): void {
  q.value = input.value.trim();
  const next: PartSearchFilters = {
    ...filters.value,
    page: 1,
    sort: sortSel.value,
    inStockOnly: inStockOnly.value,
  };
  for (const r of rangeInputs.value) {
    next[r.minKey] = toSiFor(r.kind, r.min);
    next[r.maxKey] = toSiFor(r.kind, r.max);
  }
  filters.value = next;
  enabled.value = true;
}

function runExample(example: string): void {
  input.value = example;
  onSearch();
}

function toggleFacet(key: PartFacetKey, value: string): void {
  const current = filters.value[key];
  filters.value = { ...filters.value, [key]: current === value ? undefined : value, page: 1 };
}

const onSort = (event: Event): void => {
  sortSel.value = (event.target as HTMLSelectElement).value as typeof sortSel.value;
  onSearch();
};
const onInStock = (checked: boolean | 'indeterminate'): void => {
  inStockOnly.value = checked === true;
  onSearch();
};

// 활성 필터 칩 — 지금 걸린 조건을 결과 위에 보이고 눌러 푼다.
interface ActiveChip {
  label: string;
  clear: () => void;
}
const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  const f = filters.value;
  if (f.manufacturer !== undefined) {
    chips.push({ label: `제조사: ${f.manufacturer}`, clear: () => { toggleFacet('manufacturer', f.manufacturer ?? ''); } });
  }
  if (f.packageCode !== undefined) {
    chips.push({ label: `패키지: ${f.packageCode}`, clear: () => { toggleFacet('packageCode', f.packageCode ?? ''); } });
  }
  if (f.supplier !== undefined) {
    chips.push({ label: `공급사: ${supplierLabel(f.supplier)}`, clear: () => { toggleFacet('supplier', f.supplier ?? ''); } });
  }
  if (f.inStockOnly === true) {
    chips.push({
      label: '재고 있음',
      clear: () => {
        inStockOnly.value = false;
        onSearch();
      },
    });
  }
  for (const r of rangeInputs.value) {
    if (r.min.trim() !== '' || r.max.trim() !== '') {
      chips.push({
        label: `${r.label}: ${r.min.trim() === '' ? '~' : r.min}${r.max.trim() === '' ? '~' : ` ~ ${r.max}`}`,
        clear: () => {
          r.min = '';
          r.max = '';
          onSearch();
        },
      });
    }
  }
  return chips;
});

const facetSelected = computed<Partial<Record<PartFacetKey, string>>>(() => ({
  ...(filters.value.manufacturer === undefined ? {} : { manufacturer: filters.value.manufacturer }),
  ...(filters.value.packageCode === undefined ? {} : { packageCode: filters.value.packageCode }),
  ...(filters.value.supplier === undefined ? {} : { supplier: filters.value.supplier }),
}));

function setPage(page: number): void {
  filters.value = { ...filters.value, page };
}

function toggleDetail(id: string): void {
  detailId.value = detailId.value === id ? null : id;
}

watch(q, () => {
  detailId.value = null;
});
watch([q, filters], () => {
  if (bulkPreview.value !== null) closeBulkDelete();
  bulkDeleteMsg.value = '';
});

const totalPages = computed(() => {
  const d = data.value;
  if (d === null || d.total === 0) return 1;
  return Math.ceil(d.total / d.pageSize);
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="부품 검색">
      <template #description>
        단위·표기를 자유롭게 — 접두 환산(4k7=4700=0.0047M)과 관행 표기(104·2p2)를 모두 이해합니다.
        <span class="mt-0.5 block text-xs">
          검색은 색인된 카탈로그로 즉시 응답 · 카탈로그는 BOM 공급사 검색이 자동 적재 · 재고·가격 최신화는 부품 상세의 [공급사 갱신]
        </span>
      </template>
      <!-- 카탈로그 초기화 — 전체 하드 삭제(자동 인제스트로 재성장), 2단계 확인 -->
      <template #actions>
        <span v-if="resetMsg !== ''" class="text-xs" :class="resetFailed ? 'text-destructive' : 'text-success'">{{ resetMsg }}</span>
        <Button v-if="!resetArm" variant="outline" size="sm" :disabled="resetParts.isPending.value" @click="armReset">
          <Trash2Icon class="text-destructive" />
          <span class="text-destructive">{{ resetParts.isPending.value ? '초기화 중…' : '카탈로그 초기화' }}</span>
        </Button>
        <Button v-else variant="destructive" size="sm" @click="void onReset()">
          부품 전체와 연결된 견적을 모두 삭제합니다 — 되돌릴 수 없습니다. 확정하려면 클릭
        </Button>
      </template>
    </PageHeader>

    <!-- 검색 콘솔 — 검색·정렬·재고·스펙 범위를 한 카드로 -->
    <Panel size="md" tone="card" class="flex flex-col gap-3 shadow-xs">
      <form role="search" class="flex flex-wrap items-center gap-2" @submit.prevent="onSearch">
        <InputGroup class="w-full max-w-xl">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput v-model="input" type="text" placeholder="MPN · 스펙(4k7, 100nF…) · 제조사 · 패키지" aria-label="부품 검색어" />
        </InputGroup>
        <NativeSelect :model-value="sortSel" aria-label="정렬" @change="onSort">
          <NativeSelectOption value="relevance">관련도순</NativeSelectOption>
          <NativeSelectOption value="price">최저가순</NativeSelectOption>
          <NativeSelectOption value="stock">재고순</NativeSelectOption>
        </NativeSelect>
        <div class="flex items-center gap-2">
          <Checkbox id="parts-in-stock" :model-value="inStockOnly" @update:model-value="onInStock" />
          <Label for="parts-in-stock">재고 있음</Label>
        </div>
        <Button type="submit" :disabled="search.isFetching.value">검색</Button>
      </form>

      <!-- 예시 — 누르면 바로 검색 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground text-xs">예시</span>
        <Button v-for="ex in EXAMPLES" :key="ex" variant="outline" size="xs" @click="runExample(ex)">
          <span class="font-mono">{{ ex }}</span>
        </Button>
      </div>

      <!-- 스펙 범위(자유 표기 → SI 변환) -->
      <div class="border-t pt-3">
        <Button variant="ghost" size="sm" :aria-expanded="rangeOpen" @click="rangeOpen = !rangeOpen">
          <ChevronDownIcon v-if="rangeOpen" />
          <ChevronRightIcon v-else />
          스펙 범위 필터
        </Button>
        <div v-if="rangeOpen" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field v-for="r in rangeInputs" :key="r.kind">
            <FieldLabel :for="`parts-range-${r.kind}-min`">
              <span>{{ r.label }} <span class="text-muted-foreground font-normal">({{ r.placeholder }})</span></span>
            </FieldLabel>
            <div class="flex items-center gap-1">
              <Input
                :id="`parts-range-${r.kind}-min`"
                v-model="r.min"
                type="text"
                placeholder="최소"
                :aria-label="`${r.label} 최소`"
                @keydown.enter="onSearch"
              />
              <span class="text-muted-foreground">~</span>
              <Input v-model="r.max" type="text" placeholder="최대" :aria-label="`${r.label} 최대`" @keydown.enter="onSearch" />
            </div>
          </Field>
        </div>
      </div>
    </Panel>

    <Alert v-if="searchFailed" variant="destructive" size="sm">
      <AlertDescription>검색을 사용할 수 없습니다 — Elasticsearch 상태를 확인하세요.</AlertDescription>
    </Alert>

    <div v-if="data !== null" class="flex gap-5">
      <PartFacets class="w-52 shrink-0 self-start" :facets="data.facets" :selected="facetSelected" @toggle="toggleFacet" />

      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-muted-foreground">
            총 <span class="text-foreground font-semibold tabular-nums">{{ data.total }}</span>건
          </span>
          <!-- 활성 필터 칩 — 눌러 해제 -->
          <Button v-for="chip in activeChips" :key="chip.label" variant="secondary" size="xs" @click="chip.clear()">
            {{ chip.label }}
            <XIcon />
          </Button>
          <span v-if="bulkDeleteMsg !== ''" class="text-success text-xs">{{ bulkDeleteMsg }}</span>
          <span v-if="bulkPreview === null && bulkDeleteError !== ''" class="text-destructive text-xs">{{ bulkDeleteError }}</span>
          <Button
            v-if="hasBulkDeleteFilter && data.total > 0"
            variant="outline"
            size="sm"
            class="ml-auto"
            :disabled="bulkPreviewMutation.isPending.value || bulkDeleteMutation.isPending.value"
            @click="void previewBulkDelete()"
          >
            <Trash2Icon class="text-destructive" />
            <span class="text-destructive">
              {{ bulkPreviewMutation.isPending.value ? '대상 확인 중…' : `필터 결과 ${String(data.total)}건 전체 삭제` }}
            </span>
          </Button>
        </div>

        <PartBulkDeletePanel
          v-if="bulkPreview !== null"
          v-model:confirmation="bulkConfirmation"
          :preview="bulkPreview"
          :error="bulkDeleteError"
          :pending="bulkDeleteMutation.isPending.value"
          @close="closeBulkDelete"
          @execute="void executeBulkDelete()"
        />

        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MPN</TableHead>
                <TableHead>제조사</TableHead>
                <TableHead class="min-w-24">패키지</TableHead>
                <TableHead>스펙</TableHead>
                <TableHead>설명</TableHead>
                <TableHead class="min-w-20">재고</TableHead>
                <TableHead class="min-w-20">최저가</TableHead>
                <TableHead>공급사</TableHead>
                <TableHead class="min-w-20">데이터 기준</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="p in items" :key="p.id">
                <TableRow
                  class="cursor-pointer"
                  :data-state="detailId === p.id ? 'selected' : undefined"
                  :aria-expanded="detailId === p.id"
                  @click="toggleDetail(p.id)"
                >
                  <TableCell class="font-medium">
                    <span class="inline-flex items-center gap-1.5">
                      <PartImage :src="p.imageUrl" :placeholder="null" class="size-7 shrink-0 rounded border" />
                      {{ p.mpn }}
                      <Badge v-if="p.hasSpecConflict" variant="warning" title="공급사 간 스펙이 서로 다릅니다 — 상세에서 확인">
                        스펙 충돌
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell class="min-w-28 whitespace-normal">{{ p.manufacturerName }}</TableCell>
                  <TableCell>{{ p.packageCode }}</TableCell>
                  <TableCell class="text-muted-foreground min-w-28 whitespace-normal">{{ specSummary(p.specsSi) }}</TableCell>
                  <TableCell class="text-muted-foreground whitespace-normal">
                    <span class="line-clamp-2 min-w-40" :title="p.description ?? undefined">{{ p.description }}</span>
                  </TableCell>
                  <TableCell class="tabular-nums">
                    <Badge v-if="p.hasCatalogInquiryOffer && p.totalStock === 0" variant="info">취급 가능 · 재고 확인</Badge>
                    <template v-else>{{ p.totalStock }}</template>
                  </TableCell>
                  <TableCell class="tabular-nums">
                    <span v-if="p.hasCatalogInquiryOffer && p.minPrice === null" class="text-info font-semibold">문의 견적</span>
                    <template v-else>{{ fmtPrice(p.minPrice, p.minPriceCurrency) }}</template>
                  </TableCell>
                  <TableCell class="text-muted-foreground min-w-24 whitespace-normal">{{ p.suppliers.map(supplierLabel).join(', ') }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ fmtAge(p.offersFetchedAt) }}</TableCell>
                </TableRow>
                <!-- 상세(구매 조건·가격 구간) 펼침 행 -->
                <TableRow v-if="detailId === p.id">
                  <TableCell :colspan="9" class="bg-muted/40 whitespace-normal">
                    <PartDetailPanel :part-id="p.id" @deleted="detailId = null" />
                  </TableCell>
                </TableRow>
              </template>
              <TableEmptyRow
                v-if="items.length === 0"
                :colspan="9"
                text="검색 결과가 없습니다 — 다른 표기로 시도해 보세요 (예: 4.7k ↔ 4k7 ↔ 472)"
              />
            </TableBody>
          </Table>
        </TableCard>

        <ListPagination
          v-if="totalPages > 1"
          :page="filters.page ?? 1"
          :page-size="data.pageSize"
          :total="data.total"
          @update:page="setPage"
        >
          <template #summary>
            <span class="tabular-nums">{{ filters.page ?? 1 }} / {{ totalPages }}</span>쪽
          </template>
        </ListPagination>
      </div>
    </div>

    <!-- 첫 진입(검색 전) 안내 -->
    <Empty v-else-if="!searchFailed">
      <EmptyDescription>
        검색어를 입력하거나 위의 예시를 눌러보세요 — 카탈로그는 BOM 공급사 검색으로 자동 성장합니다.
      </EmptyDescription>
    </Empty>
  </div>
</template>
