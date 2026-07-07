<script setup lang="ts">
import { ref } from 'vue';
import {
  MARKET_CAD_TOOL_LABELS,
  MARKET_CAD_TOOLS,
  MARKET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
  MARKET_EXPERT_TYPE_LABELS,
} from '@sp/api-contract';
import type { MarketExpertTypeType } from '@sp/api-contract';
import ExpertCard from '../components/ExpertCard.vue';
import UiPagination from '../components/UiPagination.vue';
import { useMarketExpertList } from '../api/useMarketExperts';
import type { ExpertListFilters } from '../api/useMarketExperts';

const filters = ref<ExpertListFilters>({
  page: 1,
  pageSize: 20,
  expertType: '',
  category: '',
  cadTool: '',
  q: '',
});
const qInput = ref('');
const { data, isLoading } = useMarketExpertList(filters);

const typeChips: { key: '' | MarketExpertTypeType; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'house', label: MARKET_EXPERT_TYPE_LABELS.house },
  { key: 'company', label: MARKET_EXPERT_TYPE_LABELS.company },
  { key: 'individual', label: MARKET_EXPERT_TYPE_LABELS.individual },
];

const setType = (key: '' | MarketExpertTypeType): void => {
  filters.value.expertType = key;
  filters.value.page = 1;
};
const applySearch = (): void => {
  filters.value.q = qInput.value;
  filters.value.page = 1;
};
const resetPage = (): void => {
  filters.value.page = 1;
};
</script>

<template>
  <section class="mx-auto w-full max-w-6xl px-4 py-10">
    <p class="font-mono text-[11px] tracking-widest text-tx-3">EXPERTS</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('experts.title') }}</h1>
    <p class="mt-1.5 text-sm text-tx-2">{{ $t('experts.subtitle') }}</p>

    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-line bg-white p-1 text-xs font-bold">
        <button
          v-for="t in typeChips"
          :key="t.key"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.expertType === t.key ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-line'"
          @click="setType(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <select
        v-model="filters.category"
        class="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold text-tx-2"
        @change="resetPage"
      >
        <option value="">{{ $t('experts.allCategories') }}</option>
        <option v-for="c in MARKET_CATEGORIES" :key="c" :value="c">
          {{ MARKET_CATEGORY_LABELS[c] }}
        </option>
      </select>

      <select
        v-model="filters.cadTool"
        class="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold text-tx-2"
        @change="resetPage"
      >
        <option value="">{{ $t('experts.allCadTools') }}</option>
        <option v-for="c in MARKET_CAD_TOOLS" :key="c" :value="c">
          {{ MARKET_CAD_TOOL_LABELS[c] }}
        </option>
      </select>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          :placeholder="$t('experts.searchPlaceholder')"
          class="h-9 w-44 rounded-lg border border-line bg-white px-3 text-xs sm:w-56"
          @keyup.enter="applySearch"
        >
        <button
          type="button"
          class="h-9 rounded-lg bg-ink-900 px-3 text-xs font-bold text-white hover:bg-ink-800"
          @click="applySearch"
        >
          {{ $t('common.search') }}
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="mt-10 text-center text-sm text-tx-3">{{ $t('common.loading') }}</div>
    <template v-else-if="data !== undefined">
      <p class="mt-5 text-xs text-tx-3">{{ $t('experts.total', { n: data.data.total }) }}</p>
      <div v-if="data.data.items.length > 0" class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpertCard v-for="e in data.data.items" :key="e.expertId" :item="e" />
      </div>
      <div v-else class="mt-6 rounded-2xl border border-dashed border-line-2 bg-white p-14 text-center">
        <p class="text-sm text-tx-3">{{ $t('experts.empty') }}</p>
        <RouterLink
          to="/expert/register"
          class="mt-4 inline-block rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600"
        >
          {{ $t('nav.expertRegister') }}
        </RouterLink>
      </div>
      <div class="mt-8">
        <UiPagination
          :page="filters.page"
          :page-size="filters.pageSize"
          :total="data.data.total"
          @update:page="(p) => (filters.page = p)"
        />
      </div>
    </template>
  </section>
</template>
