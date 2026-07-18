<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PartFacetBucketType, PartHitType } from '@sp/api-contract';
import { usePartDetail, usePartSearch, type PartSearchFilters } from '../../admin/useAdminParts';

// 부품 카탈로그 검색 — 검색창(단위·표기 자유: 4k7 · 0.0047M · 104K · 2p · 0402) + 패싯 + 결과.
// 데이터는 BOM 공급사 검색이 자동 적재한 카탈로그(sp_part*/sp-parts).

const input = ref('');
const q = ref('');
const filters = ref<PartSearchFilters>({ page: 1, pageSize: 20, sort: 'relevance' });
const enabled = ref(false);
const detailId = ref<string | null>(null);

const search = usePartSearch(q, filters, enabled);
const data = computed(() => search.data.value?.data ?? null);
const items = computed<PartHitType[]>(() => data.value?.items ?? []);
const detail = usePartDetail(detailId);
const detailData = computed(() => detail.data.value?.data ?? null);

const searchFailed = computed(() => search.isError.value);

function onSearch(): void {
  q.value = input.value.trim();
  filters.value = { ...filters.value, page: 1 };
  enabled.value = true;
}

function toggleFacet(key: 'manufacturer' | 'packageCode' | 'supplier', value: string): void {
  const current = filters.value[key];
  filters.value = { ...filters.value, [key]: current === value ? undefined : value, page: 1 };
}

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

function fmtPrice(p: number | null): string {
  return p === null ? '' : `$${String(Number(p.toPrecision(4)))}`;
}

function facetLabel(b: PartFacetBucketType): string {
  return `${b.value} (${String(b.count)})`;
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-semibold text-gray-900">부품 검색</h1>
      <p class="mt-1 text-sm text-gray-500">
        단위·표기 자유 검색 — 예: <code class="rounded bg-gray-100 px-1">4k7</code>
        <code class="rounded bg-gray-100 px-1">0.0047M</code>
        <code class="rounded bg-gray-100 px-1">104K</code>
        <code class="rounded bg-gray-100 px-1">0.1uF 0402</code>
        <code class="rounded bg-gray-100 px-1">GRM155</code>
      </p>
    </div>

    <!-- 검색창 -->
    <div class="flex gap-2">
      <input
        v-model="input"
        type="text"
        placeholder="MPN · 스펙(4k7, 100nF…) · 제조사 · 패키지"
        class="w-full max-w-xl rounded-md border border-gray-300 px-3 py-2 text-sm"
        @keydown.enter="onSearch"
      >
      <button
        type="button"
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="search.isFetching.value"
        @click="onSearch"
      >
        검색
      </button>
    </div>

    <p v-if="searchFailed" class="text-sm text-red-600">
      검색을 사용할 수 없습니다 — Elasticsearch 상태를 확인하세요.
    </p>

    <div v-if="data !== null" class="flex gap-6">
      <!-- 패싯 -->
      <aside class="w-52 shrink-0 space-y-4 text-sm">
        <div v-for="facet in ([['제조사', 'manufacturer', data.facets.manufacturers], ['패키지', 'packageCode', data.facets.packages], ['공급사', 'supplier', data.facets.suppliers]] as const)" :key="facet[1]">
          <h3 class="mb-1 font-medium text-gray-700">{{ facet[0] }}</h3>
          <ul class="space-y-0.5">
            <li v-for="b in facet[2]" :key="b.value">
              <button
                type="button"
                class="w-full truncate rounded px-2 py-0.5 text-left hover:bg-gray-100"
                :class="{ 'bg-blue-50 font-medium text-blue-700': filters[facet[1]] === b.value }"
                @click="toggleFacet(facet[1], b.value)"
              >
                {{ facetLabel(b) }}
              </button>
            </li>
            <li v-if="facet[2].length === 0" class="px-2 text-gray-400">—</li>
          </ul>
        </div>
      </aside>

      <!-- 결과 -->
      <div class="min-w-0 flex-1 space-y-3">
        <p class="text-sm text-gray-500">
          총 <span class="font-semibold text-gray-800">{{ data.total }}</span>건
        </p>
        <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2">MPN</th>
                <th class="px-3 py-2">제조사</th>
                <th class="min-w-24 whitespace-nowrap px-3 py-2">패키지</th>
                <th class="px-3 py-2">스펙</th>
                <th class="px-3 py-2">설명</th>
                <th class="min-w-20 whitespace-nowrap px-3 py-2">재고</th>
                <th class="min-w-20 whitespace-nowrap px-3 py-2">최저가</th>
                <th class="px-3 py-2">공급사</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template v-for="p in items" :key="p.id">
                <tr class="cursor-pointer hover:bg-blue-50/40" @click="toggleDetail(p.id)">
                  <td class="px-3 py-2 font-medium text-gray-900">{{ p.mpn }}</td>
                  <td class="px-3 py-2">{{ p.manufacturerName }}</td>
                  <td class="px-3 py-2">{{ p.packageCode }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-gray-600">{{ specSummary(p.specsSi) }}</td>
                  <td class="max-w-xs truncate px-3 py-2 text-gray-500">{{ p.description }}</td>
                  <td class="px-3 py-2">{{ p.totalStock }}</td>
                  <td class="px-3 py-2">{{ fmtPrice(p.minPrice) }}</td>
                  <td class="px-3 py-2 text-gray-500">{{ p.suppliers.join(', ') }}</td>
                </tr>
                <!-- 상세(오퍼·가격구간) 확장 행 -->
                <tr v-if="detailId === p.id">
                  <td colspan="8" class="bg-gray-50 px-4 py-3">
                    <p v-if="detail.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
                    <div v-else-if="detailData !== null" class="space-y-2">
                      <div
                        v-for="offer in detailData.offers"
                        :key="`${offer.supplier}-${offer.supplierSku}`"
                        class="rounded border border-gray-200 bg-white p-3 text-sm"
                      >
                        <div class="flex flex-wrap items-center gap-3">
                          <span class="font-medium">{{ offer.supplier }}</span>
                          <span class="text-gray-500">{{ offer.supplierSku }}</span>
                          <span>재고 {{ offer.stock ?? '—' }}</span>
                          <span>MOQ {{ offer.moq ?? '—' }}</span>
                          <a
                            v-if="offer.productUrl !== null"
                            :href="offer.productUrl"
                            target="_blank"
                            rel="noopener"
                            class="text-blue-600 hover:underline"
                          >제품 페이지 ↗</a>
                        </div>
                        <div v-if="offer.priceBreaks.length > 0" class="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                          <span
                            v-for="pb in offer.priceBreaks"
                            :key="pb.qty"
                            class="rounded bg-gray-100 px-1.5 py-0.5"
                          >{{ pb.qty }}+ : {{ fmtPrice(pb.price) }}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="items.length === 0">
                <td colspan="8" class="px-3 py-6 text-center text-gray-400">검색 결과가 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 페이지네이션 -->
        <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
          <button
            type="button"
            class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            :disabled="(filters.page ?? 1) <= 1"
            @click="setPage((filters.page ?? 1) - 1)"
          >
            이전
          </button>
          <span class="text-gray-600">{{ filters.page ?? 1 }} / {{ totalPages }}</span>
          <button
            type="button"
            class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            :disabled="(filters.page ?? 1) >= totalPages"
            @click="setPage((filters.page ?? 1) + 1)"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
