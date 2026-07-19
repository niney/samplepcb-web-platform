<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PartFacetBucketType, PartHitType } from '@sp/api-contract';
import { parseSpecToken, type SpecKind } from '@sp/utils';
import { useDeletePart, usePartDetail, usePartSearch, useRefreshPart, useResetParts, type PartSearchFilters } from '../../admin/useAdminParts';
import PartImage from '../../components/ui/PartImage.vue';

// 부품 카탈로그 검색 — "검색 콘솔" 카드가 페이지의 시그니처: 단위·표기 자유 검색이
// 이 페이지의 본질이므로 검색 도구를 하나의 카드로 통합해 주인공으로 세운다.
// gray-50 레이아웃 위에서 콘텐츠가 묻히지 않도록 패싯·결과도 카드로 띄운다.
// 데이터는 BOM 공급사 검색이 자동 적재한 카탈로그(sp_part*/sp-parts).

const input = ref('');
const q = ref('');
const filters = ref<PartSearchFilters>({ page: 1, pageSize: 20, sort: 'relevance' });
const enabled = ref(false);
const detailId = ref<string | null>(null);
const sortSel = ref<'relevance' | 'price' | 'stock'>('relevance');
const inStockOnly = ref(false);

// 클릭하면 바로 검색되는 예시 칩 — 단위 자유 검색이라는 도메인 특성을 UI 로 시연
const EXAMPLES = ['4k7', '104K', '0.1uF 0402', '0.0047M', 'GRM155'] as const;

// 스펙 범위(자유 표기) — kind 별 min/max 텍스트 입력, spec-units 파서가 SI 로 변환
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
const detail = usePartDetail(detailId);
const detailData = computed(() => detail.data.value?.data ?? null);
const refresh = useRefreshPart();
const refreshError = ref('');

async function onRefresh(partId: string): Promise<void> {
  refreshError.value = '';
  try {
    await refresh.mutateAsync(partId); // 성공 시 검색·상세 쿼리 자동 무효화 → 화면 갱신
  } catch {
    refreshError.value = '갱신 실패 — 엔진(sp-engine) 상태를 확인하세요.';
  }
}

// ── 하드 삭제·카탈로그 초기화 — 되돌릴 수 없어 2단계 인라인 확인(네이티브 confirm 미사용) ──
const del = useDeletePart();
const resetParts = useResetParts();
const deleteArmId = ref<string | null>(null); // 1차 클릭한 부품 — 같은 버튼이 확정으로 변전
const deleteError = ref('');
const resetArm = ref(false);
const resetMsg = ref('');

function armDelete(partId: string): void {
  deleteArmId.value = partId;
  setTimeout(() => {
    if (deleteArmId.value === partId) deleteArmId.value = null; // 5초 내 미확정 시 해제
  }, 5_000);
}

async function onDeletePart(partId: string): Promise<void> {
  deleteError.value = '';
  deleteArmId.value = null;
  try {
    await del.mutateAsync(partId);
    detailId.value = null;
  } catch {
    deleteError.value = '삭제 실패 — 잠시 후 다시 시도하세요.';
  }
}

function armReset(): void {
  resetArm.value = true;
  resetMsg.value = '';
  setTimeout(() => (resetArm.value = false), 5_000);
}

async function onReset(): Promise<void> {
  resetArm.value = false;
  try {
    const res = await resetParts.mutateAsync();
    resetMsg.value = `카탈로그 초기화 완료 — 부품 ${String(res.data.parts)}건 삭제(견적 스냅샷은 보존)`;
  } catch {
    resetMsg.value = '초기화 실패 — 잠시 후 다시 시도하세요.';
  }
}

/** ISO 시각 → 상대 나이("3시간 전"). null=오퍼 없음. */
function fmtAge(iso: string | null): string {
  if (iso === null) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${String(min)}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${String(hours)}시간 전`;
  return `${String(Math.floor(hours / 24))}일 전`;
}

const searchFailed = computed(() => search.isError.value);

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

function toggleFacet(key: 'manufacturer' | 'packageCode' | 'supplier', value: string): void {
  const current = filters.value[key];
  filters.value = { ...filters.value, [key]: current === value ? undefined : value, page: 1 };
}

// 활성 필터 칩 — 현재 걸린 조건을 결과 위에 보여주고 클릭으로 해제
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
    chips.push({ label: `공급사: ${f.supplier}`, clear: () => { toggleFacet('supplier', f.supplier ?? ''); } });
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

function setPage(page: number): void {
  filters.value = { ...filters.value, page };
}

function toggleDetail(id: string): void {
  detailId.value = detailId.value === id ? null : id;
}

watch(q, () => {
  detailId.value = null;
});

const totalPages = computed(() => {
  const d = data.value;
  if (d === null || d.total === 0) return 1;
  return Math.ceil(d.total / d.pageSize);
});

// SI 값 → 사람이 읽는 표기 (표시는 최적 접두 1개면 충분)
const SI_LABELS: [string, string, (v: number) => string][] = [
  ['resistanceOhm', 'Ω', (v) => (v >= 1e6 ? `${trim(v / 1e6)}MΩ` : v >= 1e3 ? `${trim(v / 1e3)}kΩ` : `${trim(v)}Ω`)],
  ['capacitanceF', 'F', (v) => (v >= 1e-6 ? `${trim(v * 1e6)}µF` : v >= 1e-9 ? `${trim(v * 1e9)}nF` : `${trim(v * 1e12)}pF`)],
  ['inductanceH', 'H', (v) => (v >= 1e-3 ? `${trim(v * 1e3)}mH` : v >= 1e-6 ? `${trim(v * 1e6)}µH` : `${trim(v * 1e9)}nH`)],
  ['voltageV', 'V', (v) => `${trim(v)}V`],
  ['currentA', 'A', (v) => (v >= 1 ? `${trim(v)}A` : `${trim(v * 1e3)}mA`)],
  ['powerW', 'W', (v) => (v >= 1 ? `${trim(v)}W` : `${trim(v * 1e3)}mW`)],
  ['frequencyHz', 'Hz', (v) => (v >= 1e6 ? `${trim(v / 1e6)}MHz` : v >= 1e3 ? `${trim(v / 1e3)}kHz` : `${trim(v)}Hz`)],
  ['tolerancePct', '%', (v) => `±${trim(v)}%`],
];

function trim(v: number): string {
  return String(Number(v.toPrecision(4)));
}

function specSummary(specsSi: Record<string, number>): string {
  const parts: string[] = [];
  for (const [field, , fmtFn] of SI_LABELS) {
    const v = specsSi[field];
    if (v !== undefined) parts.push(fmtFn(v));
  }
  return parts.join(' · ');
}

const CURRENCY_SYMBOL: Record<string, string> = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥' };

function fmtPrice(p: number | null, currency: string | null): string {
  if (p === null) return '';
  const n = String(Number(p.toPrecision(4)));
  if (currency === null || currency === '') return n;
  const sym = CURRENCY_SYMBOL[currency];
  return sym === undefined ? `${n} ${currency}` : `${sym}${n}`;
}

function facetLabel(b: PartFacetBucketType): string {
  return b.value;
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">부품 검색</h1>
        <p class="mt-1 text-sm text-gray-500">
          단위·표기를 자유롭게 — 접두 환산(4k7=4700=0.0047M)과 관행 표기(104·2p2)를 모두 이해합니다.
        </p>
        <p class="mt-0.5 text-xs text-gray-400">
          검색은 색인된 카탈로그로 즉시 응답 · 카탈로그는 BOM 공급사 검색이 자동 적재 · 재고·가격 최신화는 부품 상세의 [공급사 갱신]
        </p>
      </div>
      <!-- 카탈로그 초기화 — 전체 하드 삭제(자동 인제스트로 재성장), 2단계 확인 -->
      <div class="flex items-center gap-2">
        <span v-if="resetMsg !== ''" class="text-xs" :class="resetMsg.includes('실패') ? 'text-red-600' : 'text-emerald-700'">{{ resetMsg }}</span>
        <button
          v-if="!resetArm"
          type="button"
          class="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          :disabled="resetParts.isPending.value"
          @click="armReset"
        >
          {{ resetParts.isPending.value ? '초기화 중…' : '카탈로그 초기화' }}
        </button>
        <button
          v-else
          type="button"
          class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          @click="onReset"
        >
          부품 전체 삭제 — 되돌릴 수 없습니다. 확정하려면 클릭
        </button>
      </div>
    </div>

    <!-- 검색 콘솔 — 이 페이지의 시그니처: 검색·정렬·재고·스펙범위를 한 카드로 -->
    <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative w-full max-w-xl">
          <svg
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.34-4.34M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
          </svg>
          <input
            v-model="input"
            type="text"
            placeholder="MPN · 스펙(4k7, 100nF…) · 제조사 · 패키지"
            class="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            @keydown.enter="onSearch"
          >
        </div>
        <select
          v-model="sortSel"
          class="rounded-lg border border-gray-300 px-2 py-2.5 text-sm outline-none focus:border-blue-500"
          @change="onSearch"
        >
          <option value="relevance">관련도순</option>
          <option value="price">최저가순</option>
          <option value="stock">재고순</option>
        </select>
        <label class="flex items-center gap-1.5 text-sm text-gray-600">
          <input v-model="inStockOnly" type="checkbox" class="accent-blue-600" @change="onSearch">
          재고 있음
        </label>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="search.isFetching.value"
          @click="onSearch"
        >
          검색
        </button>
      </div>

      <!-- 예시 칩 — 클릭하면 바로 검색 -->
      <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-gray-400">예시</span>
        <button
          v-for="ex in EXAMPLES"
          :key="ex"
          type="button"
          class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          @click="runExample(ex)"
        >
          {{ ex }}
        </button>
      </div>

      <!-- 스펙 범위 (자유 표기 → SI 변환) -->
      <details class="mt-3 border-t border-gray-100 pt-3 text-sm">
        <summary class="cursor-pointer select-none font-medium text-gray-600 hover:text-gray-900">스펙 범위 필터</summary>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="r in rangeInputs" :key="r.kind">
            <p class="mb-1 text-xs font-medium text-gray-500">
              {{ r.label }} <span class="font-normal text-gray-400">({{ r.placeholder }})</span>
            </p>
            <div class="flex items-center gap-1">
              <input
                v-model="r.min"
                type="text"
                placeholder="최소"
                class="w-full rounded-md border border-gray-300 px-2 py-1 outline-none focus:border-blue-500"
                @keydown.enter="onSearch"
              >
              <span class="text-gray-400">~</span>
              <input
                v-model="r.max"
                type="text"
                placeholder="최대"
                class="w-full rounded-md border border-gray-300 px-2 py-1 outline-none focus:border-blue-500"
                @keydown.enter="onSearch"
              >
            </div>
          </div>
        </div>
      </details>
    </div>

    <p v-if="searchFailed" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      검색을 사용할 수 없습니다 — Elasticsearch 상태를 확인하세요.
    </p>

    <div v-if="data !== null" class="flex gap-5">
      <!-- 패싯 카드 -->
      <aside class="w-52 shrink-0 self-start rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-sm">
        <div
          v-for="(facet, fi) in ([['제조사', 'manufacturer', data.facets.manufacturers], ['패키지', 'packageCode', data.facets.packages], ['공급사', 'supplier', data.facets.suppliers]] as const)"
          :key="facet[1]"
          :class="{ 'mt-4 border-t border-gray-100 pt-3': fi > 0 }"
        >
          <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{{ facet[0] }}</h3>
          <ul class="space-y-0.5">
            <li v-for="b in facet[2]" :key="b.value">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-gray-50"
                :class="filters[facet[1]] === b.value ? 'bg-blue-50 font-medium text-blue-700 hover:bg-blue-50' : 'text-gray-700'"
                @click="toggleFacet(facet[1], b.value)"
              >
                <span class="truncate">{{ facetLabel(b) }}</span>
                <span class="shrink-0 text-xs tabular-nums text-gray-400">{{ b.count }}</span>
              </button>
            </li>
            <li v-if="facet[2].length === 0" class="px-2 text-gray-300">—</li>
          </ul>
        </div>
      </aside>

      <!-- 결과 -->
      <div class="min-w-0 flex-1 space-y-3">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-gray-500">
            총 <span class="font-semibold tabular-nums text-gray-900">{{ data.total }}</span>건
          </span>
          <!-- 활성 필터 칩 — 클릭으로 해제 -->
          <button
            v-for="chip in activeChips"
            :key="chip.label"
            type="button"
            class="group flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            @click="chip.clear()"
          >
            {{ chip.label }}
            <span class="text-blue-400 group-hover:text-blue-600">✕</span>
          </button>
        </div>

        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2.5">MPN</th>
                <th class="px-3 py-2.5">제조사</th>
                <th class="min-w-24 whitespace-nowrap px-3 py-2.5">패키지</th>
                <th class="px-3 py-2.5">스펙</th>
                <th class="px-3 py-2.5">설명</th>
                <th class="min-w-20 whitespace-nowrap px-3 py-2.5">재고</th>
                <th class="min-w-20 whitespace-nowrap px-3 py-2.5">최저가</th>
                <th class="px-3 py-2.5">공급사</th>
                <th class="min-w-20 whitespace-nowrap px-3 py-2.5">데이터 기준</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template v-for="p in items" :key="p.id">
                <tr
                  class="cursor-pointer hover:bg-blue-50/40"
                  :class="{ 'bg-blue-50/60': detailId === p.id }"
                  @click="toggleDetail(p.id)"
                >
                  <td class="px-3 py-2 font-medium text-gray-900">
                    <PartImage
                      :src="p.imageUrl"
                      :placeholder="null"
                      class="mr-1.5 inline-block size-[28px] rounded border border-gray-200 align-middle"
                    />
                    {{ p.mpn }}
                    <span
                      v-if="p.hasSpecConflict"
                      class="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                      title="공급사 간 스펙이 서로 다릅니다 — 상세에서 확인"
                    >스펙 충돌</span>
                  </td>
                  <td class="px-3 py-2">{{ p.manufacturerName }}</td>
                  <td class="px-3 py-2">{{ p.packageCode }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-gray-600">{{ specSummary(p.specsSi) }}</td>
                  <td class="max-w-xs truncate px-3 py-2 text-gray-500">{{ p.description }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ p.totalStock }}</td>
                  <td class="whitespace-nowrap px-3 py-2 tabular-nums">{{ fmtPrice(p.minPrice, p.minPriceCurrency) }}</td>
                  <td class="px-3 py-2 text-gray-500">{{ p.suppliers.join(', ') }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-gray-400">{{ fmtAge(p.offersFetchedAt) }}</td>
                </tr>
                <!-- 상세(오퍼·가격구간) 확장 행 -->
                <tr v-if="detailId === p.id">
                  <td colspan="9" class="bg-gray-50 px-4 py-3">
                    <p v-if="detail.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
                    <div v-else-if="detailData !== null" class="space-y-2">
                      <!-- 수동 갱신 — 공급사 API 강제 호출 후 재색인 -->
                      <div class="flex flex-wrap items-center gap-3 text-sm">
                        <button
                          type="button"
                          class="rounded-md border border-blue-600 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                          :disabled="refresh.isPending.value"
                          @click="onRefresh(p.id)"
                        >
                          {{ refresh.isPending.value ? '공급사 조회 중…' : '공급사 갱신' }}
                        </button>
                        <!-- 하드 삭제 — 2단계 확인. 견적 라인은 스냅샷 보존(partId 만 해제) -->
                        <button
                          v-if="deleteArmId !== p.id"
                          type="button"
                          class="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          :disabled="del.isPending.value"
                          @click="armDelete(p.id)"
                        >
                          {{ del.isPending.value ? '삭제 중…' : '삭제' }}
                        </button>
                        <button
                          v-else
                          type="button"
                          class="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                          @click="onDeletePart(p.id)"
                        >
                          정말 삭제 — 되돌릴 수 없습니다
                        </button>
                        <span class="text-xs text-gray-400">데이터 기준: {{ fmtAge(detailData.offersFetchedAt) }}</span>
                        <span v-if="refreshError !== ''" class="text-xs text-red-600">{{ refreshError }}</span>
                        <span v-if="deleteError !== ''" class="text-xs text-red-600">{{ deleteError }}</span>
                      </div>
                      <!-- 스펙 충돌 — 채택값(첫 그룹)과 나머지 공급사 값을 병기 -->
                      <div
                        v-if="detailData.specConflicts !== null"
                        class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                      >
                        <p class="mb-1 font-semibold">공급사 간 스펙 충돌 — 첫 값이 채택값(다수결→신뢰순위→최신)</p>
                        <div v-for="(groups, field) in detailData.specConflicts" :key="field" class="mt-0.5">
                          <span class="font-medium">{{ field }}</span>:
                          <span v-for="(g, gi) in groups" :key="gi" class="ml-1.5">
                            <span :class="gi === 0 ? 'font-semibold' : 'line-through opacity-70'">{{ g.value }}</span>
                            <span class="opacity-70">({{ g.suppliers.join(',') }})</span>
                          </span>
                        </div>
                      </div>
                      <div
                        v-for="offer in detailData.offers"
                        :key="`${offer.supplier}-${offer.supplierSku}`"
                        class="rounded-lg border border-gray-200 bg-white p-3 text-sm"
                      >
                        <div class="flex flex-wrap items-center gap-3">
                          <span class="font-medium">{{ offer.supplier }}</span>
                          <span
                            v-if="offer.derivedFrom !== null"
                            class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                            :title="`원천: ${offer.derivedFrom.supplier} ${offer.derivedFrom.supplierSku}`"
                          >자체 · {{ offer.derivedFrom.supplier }} 기반</span>
                          <span class="text-gray-500">{{ offer.supplierSku }}</span>
                          <span>재고 <span class="tabular-nums">{{ offer.stock ?? '—' }}</span></span>
                          <span>MOQ <span class="tabular-nums">{{ offer.moq ?? '—' }}</span></span>
                          <span class="text-xs text-gray-400">{{ fmtAge(offer.fetchedAt) }}</span>
                          <a
                            v-if="offer.productUrl !== null"
                            :href="offer.productUrl"
                            target="_blank"
                            rel="noopener"
                            class="text-blue-600 hover:underline"
                          >제품 페이지 ↗</a>
                        </div>
                        <div v-if="offer.priceBreaks.length > 0" class="mt-1.5 flex flex-wrap gap-1.5 text-xs text-gray-600">
                          <span
                            v-for="pb in offer.priceBreaks"
                            :key="pb.qty"
                            class="rounded bg-gray-100 px-1.5 py-0.5 tabular-nums"
                          >{{ pb.qty }}+ : {{ fmtPrice(pb.price, offer.currency) }}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="items.length === 0">
                <td colspan="9" class="px-3 py-10 text-center text-sm text-gray-400">
                  검색 결과가 없습니다 — 다른 표기로 시도해 보세요 (예: 4.7k ↔ 4k7 ↔ 472)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 페이지네이션 -->
        <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="(filters.page ?? 1) <= 1"
            @click="setPage((filters.page ?? 1) - 1)"
          >
            이전
          </button>
          <span class="tabular-nums text-gray-600">{{ filters.page ?? 1 }} / {{ totalPages }}</span>
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="(filters.page ?? 1) >= totalPages"
            @click="setPage((filters.page ?? 1) + 1)"
          >
            다음
          </button>
        </div>
      </div>
    </div>

    <!-- 첫 진입(검색 전) 안내 -->
    <div
      v-else-if="!searchFailed"
      class="rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center text-sm text-gray-400"
    >
      검색어를 입력하거나 위의 예시를 눌러보세요 — 카탈로그는 BOM 공급사 검색으로 자동 성장합니다.
    </div>
  </div>
</template>
