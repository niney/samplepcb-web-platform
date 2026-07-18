<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type {
  BomSupplierPriceBreakType,
  BomSupplierSearchComponentType,
} from '@sp/api-contract';

const props = defineProps<{ component: BomSupplierSearchComponentType | null }>();
const emit = defineEmits<{ close: [] }>();

type Candidate = BomSupplierSearchComponentType['candidates'][number];

const bestCandidates = computed(() => {
  const result: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of props.component?.candidates ?? []) {
    if (!seen.has(candidate.product.supplier)) {
      seen.add(candidate.product.supplier);
      result.push(candidate);
    }
  }
  return result;
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

function maxStock(candidate: Candidate): string {
  const stocks = candidate.product.offers
    .map((offer) => offer.stock)
    .filter((value): value is number => value !== null && value !== undefined);
  return stocks.length === 0 ? '확인 불가' : Math.max(...stocks).toLocaleString('ko-KR');
}

function minimumMoq(candidate: Candidate): string {
  const quantities = candidate.product.offers
    .map((offer) => offer.moq)
    .filter((value): value is number => value !== null && value !== undefined);
  return quantities.length === 0 ? '확인 불가' : Math.min(...quantities).toLocaleString('ko-KR');
}

function lowestPrice(candidate: Candidate): string {
  const prices = candidate.product.offers.flatMap((offer) => offer.price_breaks ?? []);
  const lowest = prices.reduce<BomSupplierPriceBreakType | null>((current, price) => (
    current === null || price.unit_price < current.unit_price ? price : current
  ), null);
  if (lowest === null) return '확인 불가';
  return `${lowest.unit_price.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} ${lowest.currency} · ${lowest.quantity.toLocaleString('ko-KR')}개 구간`;
}

function packaging(candidate: Candidate): string {
  return candidate.product.offers
    .map((offer) => offer.packaging)
    .find((value): value is string => value !== null && value !== undefined && value !== '')
    ?? '확인 불가';
}

function productUrl(candidate: Candidate): string | null {
  return candidate.product.offers
    .map((offer) => offer.product_url)
    .find((value): value is string => value !== null && value !== undefined && value !== '')
    ?? null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="component !== null" class="fixed inset-0 z-[60] flex justify-end bg-slate-950/45" role="presentation" @mousedown.self="emit('close')">
      <aside class="h-full w-full max-w-5xl overflow-y-auto bg-gray-50 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="supplier-detail-title">
        <header class="sticky top-0 z-10 flex items-start justify-between gap-5 bg-slate-900 px-7 py-5 text-white">
          <div class="min-w-0">
            <p class="text-xs font-bold tracking-[0.16em] text-emerald-300">SUPPLIER COMPARISON</p>
            <h2 id="supplier-detail-title" class="mt-2 break-words text-xl font-semibold">{{ component.reference_designators.join(', ') || component.component_id }}</h2>
            <p class="mt-2 text-sm text-slate-300">{{ statusLabel(component.status) }} · 후보 {{ component.candidates.length }}개 · API {{ component.api_calls }}회</p>
          </div>
          <button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-2xl hover:bg-white/20" aria-label="공급사 상세 닫기" @click="emit('close')">×</button>
        </header>

        <div class="space-y-6 p-6 lg:p-7">
          <section v-if="component.warnings?.length" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>확인 필요</strong>
            <p class="mt-1">{{ component.warnings.join(' · ') }}</p>
          </section>

          <section>
            <div>
              <h3 class="font-semibold text-gray-900">공급사별 최상위 후보</h3>
              <p class="mt-1 text-sm text-gray-500">각 공급사의 가장 높은 순위 후보와 구매 정보를 비교합니다.</p>
            </div>
            <div v-if="bestCandidates.length > 0" class="mt-4 grid gap-3 lg:grid-cols-3">
              <article v-for="candidate in bestCandidates" :key="candidate.product.supplier" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs font-bold uppercase tracking-wide text-blue-700">{{ candidate.product.supplier }}</p>
                    <h4 class="mt-2 break-words font-semibold text-gray-900">{{ candidate.product.manufacturer_part_number }}</h4>
                    <p class="mt-1 text-sm text-gray-500">{{ candidate.product.manufacturer ?? '제조사 미확인' }}</p>
                  </div>
                  <span class="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">{{ statusLabel(candidate.status) }}</span>
                </div>

                <p v-if="candidate.product.description" class="mt-3 line-clamp-3 text-sm leading-5 text-gray-600">{{ candidate.product.description }}</p>

                <dl class="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 text-sm">
                  <div class="border-b border-r border-gray-200 p-3"><dt class="text-xs text-gray-400">재고</dt><dd class="mt-1 font-semibold text-gray-900">{{ maxStock(candidate) }}</dd></div>
                  <div class="border-b border-gray-200 p-3"><dt class="text-xs text-gray-400">MOQ</dt><dd class="mt-1 font-semibold text-gray-900">{{ minimumMoq(candidate) }}</dd></div>
                  <div class="border-r border-gray-200 p-3"><dt class="text-xs text-gray-400">최저 구간가</dt><dd class="mt-1 font-semibold text-gray-900">{{ lowestPrice(candidate) }}</dd></div>
                  <div class="p-3"><dt class="text-xs text-gray-400">포장</dt><dd class="mt-1 font-semibold text-gray-900">{{ packaging(candidate) }}</dd></div>
                </dl>

                <div class="mt-4 flex flex-wrap gap-2 text-xs">
                  <span class="rounded bg-emerald-50 px-2 py-1 font-medium text-emerald-800">품번 {{ Math.round(candidate.identity_confidence * 100) }}%</span>
                  <span class="rounded bg-blue-50 px-2 py-1 font-medium text-blue-800">스펙 {{ Math.round(candidate.specification_confidence * 100) }}%</span>
                </div>

                <div v-if="candidate.conflicts.length > 0" class="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">충돌: {{ candidate.conflicts.join(', ') }}</div>
                <div v-if="candidate.missing_requirements.length > 0" class="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">확인 불가: {{ candidate.missing_requirements.join(', ') }}</div>

                <div class="mt-4 flex gap-2">
                  <a v-if="productUrl(candidate) !== null" :href="productUrl(candidate) ?? undefined" target="_blank" rel="noopener noreferrer" class="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">제품 페이지</a>
                  <a v-if="candidate.product.datasheet_url" :href="candidate.product.datasheet_url" target="_blank" rel="noopener noreferrer" class="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">데이터시트</a>
                </div>
              </article>
            </div>
            <p v-else class="mt-4 rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">표시할 공급사 후보가 없습니다.</p>
          </section>

          <section v-if="component.candidates.length > bestCandidates.length" class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-200 p-4"><h3 class="font-semibold text-gray-900">차순위 후보</h3><p class="mt-1 text-sm text-gray-500">공급사별 추가 후보입니다.</p></div>
            <div class="divide-y divide-gray-100">
              <article v-for="candidate in component.candidates.filter((candidate) => !bestCandidates.includes(candidate))" :key="`${candidate.product.supplier}-${candidate.product.manufacturer_part_number}`" class="grid gap-2 p-4 text-sm md:grid-cols-[8rem_1fr_auto] md:items-center">
                <strong class="uppercase text-blue-700">{{ candidate.product.supplier }}</strong>
                <div><p class="font-semibold text-gray-900">{{ candidate.product.manufacturer_part_number }}</p><p class="mt-1 text-xs text-gray-500">{{ candidate.product.manufacturer ?? '제조사 미확인' }}</p></div>
                <span class="text-xs text-gray-500">품번 {{ Math.round(candidate.identity_confidence * 100) }}% · 스펙 {{ Math.round(candidate.specification_confidence * 100) }}%</span>
              </article>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
