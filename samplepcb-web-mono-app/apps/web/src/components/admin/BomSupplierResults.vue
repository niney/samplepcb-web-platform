<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  BomSupplierPriceBreakType,
  BomSupplierResultType,
  BomSupplierSearchComponentType,
} from '@sp/api-contract';

const props = defineProps<{ result: BomSupplierResultType }>();
const emit = defineEmits<{ inspect: [component: BomSupplierSearchComponentType] }>();

type Candidate = BomSupplierSearchComponentType['candidates'][number];

const search = ref('');
const status = ref('');
const page = ref(1);
const perPage = 30;

const statusOptions = computed(() => Object.keys(props.result.summary.status_counts));
const filtered = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return props.result.search.components.filter((component) => {
    if (status.value !== '' && component.status !== status.value) return false;
    if (needle === '') return true;
    const candidateText = component.candidates
      .flatMap((candidate) => [
        candidate.product.manufacturer_part_number,
        candidate.product.manufacturer ?? '',
        candidate.product.description ?? '',
      ])
      .join(' ');
    return `${component.reference_designators.join(' ')} ${candidateText}`
      .toLocaleLowerCase()
      .includes(needle);
  });
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage)));
const visible = computed(() => filtered.value.slice((page.value - 1) * perPage, page.value * perPage));

watch([search, status], () => {
  page.value = 1;
});

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    verified_exact: '정확 일치',
    verified_variant: '변형 일치',
    spec_compatible: '스펙 호환',
    spec_partial: '스펙 일부',
    input_conflict: '입력 충돌',
    ambiguous: '모호함',
    not_found: '미검색',
    supplier_error: '공급사 오류',
    insufficient_input: '정보 부족',
  };
  return labels[value] ?? value;
}

function statusClass(value: string): string {
  if (['verified_exact', 'verified_variant', 'spec_compatible'].includes(value)) {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (['input_conflict', 'supplier_error'].includes(value)) {
    return 'bg-red-100 text-red-800';
  }
  if (['spec_partial', 'ambiguous'].includes(value)) {
    return 'bg-amber-100 text-amber-800';
  }
  return 'bg-gray-100 text-gray-700';
}

function topCandidate(component: BomSupplierSearchComponentType): Candidate | undefined {
  return component.candidates[0];
}

function supplierCount(component: BomSupplierSearchComponentType): number {
  return new Set(component.candidates.map((candidate) => candidate.product.supplier)).size;
}

function maxStock(candidate: Candidate | undefined): string {
  if (candidate === undefined) return '—';
  const stocks = candidate.product.offers
    .map((offer) => offer.stock)
    .filter((value): value is number => value !== null && value !== undefined);
  return stocks.length === 0 ? '—' : Math.max(...stocks).toLocaleString('ko-KR');
}

function lowestPrice(candidate: Candidate | undefined): string {
  if (candidate === undefined) return '—';
  const prices = candidate.product.offers.flatMap((offer) => offer.price_breaks ?? []);
  const lowest = prices.reduce<BomSupplierPriceBreakType | null>((current, price) => (
    current === null || price.unit_price < current.unit_price ? price : current
  ), null);
  if (lowest === null) return '—';
  return `${lowest.unit_price.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} ${lowest.currency}`;
}

function formatMs(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}초`;
  }
  return `${Math.round(value).toLocaleString('ko-KR')}ms`;
}
</script>

<template>
  <section class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p class="text-xs text-gray-500">검색 부품</p><strong class="mt-2 block text-2xl text-gray-900">{{ result.summary.component_count.toLocaleString('ko-KR') }}</strong></article>
      <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p class="text-xs text-gray-500">API 호출</p><strong class="mt-2 block text-2xl text-gray-900">{{ result.summary.api_calls.toLocaleString('ko-KR') }}</strong></article>
      <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p class="text-xs text-gray-500">캐시 적중</p><strong class="mt-2 block text-2xl text-gray-900">{{ result.summary.cache_hits.toLocaleString('ko-KR') }}</strong></article>
      <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p class="text-xs text-gray-500">공급사 검색</p><strong class="mt-2 block text-2xl text-gray-900">{{ formatMs(result.timing.search_elapsed_ms) }}</strong></article>
      <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p class="text-xs text-gray-500">전체 처리</p><strong class="mt-2 block text-2xl text-gray-900">{{ formatMs(result.timing.known_pipeline_elapsed_ms) }}</strong></article>
    </div>

    <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="flex flex-col gap-3 border-b border-gray-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 class="font-semibold text-gray-900">공급사 결과</h2>
          <p class="mt-1 text-sm text-gray-500">{{ filtered.length.toLocaleString('ko-KR') }}개 부품 · 행을 선택하면 공급사별 후보를 비교합니다.</p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input v-model="search" type="search" class="h-10 min-w-64 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500" placeholder="REFDES, 품번, 제조사 검색" aria-label="공급사 결과 검색">
          <select v-model="status" class="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 outline-none focus:border-blue-500" aria-label="공급사 판정 필터">
            <option value="">모든 판정</option>
            <option v-for="item in statusOptions" :key="item" :value="item">{{ statusLabel(item) }} ({{ result.summary.status_counts[item] }})</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
        <span v-for="(count, label) in result.summary.status_counts" :key="label" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="statusClass(label)">{{ statusLabel(label) }} {{ count }}</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[1050px] text-left text-sm">
          <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr><th class="px-3 py-3">REFDES</th><th class="px-3 py-3">판정</th><th class="px-3 py-3">최상위 후보</th><th class="px-3 py-3">제조사</th><th class="px-3 py-3">재고</th><th class="px-3 py-3">최저 구간가</th><th class="px-3 py-3">확인 공급사</th><th class="px-3 py-3">API</th><th class="px-3 py-3" /></tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="component in visible" :key="component.component_id" tabindex="0" class="cursor-pointer text-gray-700 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none" @click="emit('inspect', component)" @keydown.enter="emit('inspect', component)">
              <td class="max-w-56 px-3 py-3">{{ component.reference_designators.join(', ') || '—' }}</td>
              <td class="px-3 py-3"><span class="rounded-full px-2 py-1 text-xs font-semibold" :class="statusClass(component.status)">{{ statusLabel(component.status) }}</span></td>
              <td class="px-3 py-3 font-semibold text-gray-900">{{ topCandidate(component)?.product.manufacturer_part_number ?? '후보 없음' }}</td>
              <td class="px-3 py-3">{{ topCandidate(component)?.product.manufacturer ?? '—' }}</td>
              <td class="px-3 py-3">{{ maxStock(topCandidate(component)) }}</td>
              <td class="px-3 py-3 font-medium text-gray-900">{{ lowestPrice(topCandidate(component)) }}</td>
              <td class="px-3 py-3">{{ supplierCount(component) }}</td>
              <td class="px-3 py-3">{{ component.api_calls }}</td>
              <td class="px-3 py-3 text-right font-medium text-blue-700">상세</td>
            </tr>
            <tr v-if="visible.length === 0"><td colspan="9" class="px-3 py-12 text-center text-gray-400">조건에 맞는 공급사 결과가 없습니다.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-center gap-5 border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
        <button type="button" class="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
        <span>{{ filtered.length === 0 ? 0 : (page - 1) * perPage + 1 }}–{{ Math.min(page * perPage, filtered.length) }} / {{ filtered.length }}</span>
        <button type="button" class="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40" :disabled="page >= pageCount" @click="page += 1">다음</button>
      </div>
    </div>
  </section>
</template>
