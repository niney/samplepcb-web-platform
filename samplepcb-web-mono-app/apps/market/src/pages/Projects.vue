<script setup lang="ts">
import { ref } from 'vue';
import {
  MARKET_METHOD_LABELS,
  MARKET_PROJECT_CATEGORY_LABELS,
  MarketProjectCategory,
  MarketProjectMethod,
} from '@sp/api-contract';
import ProjectCard from '../components/ProjectCard.vue';
import UiPagination from '../components/UiPagination.vue';
import { useMarketProjectList } from '../api/useMarketProjects';
import type { ProjectListFilters } from '../api/useMarketProjects';

const filters = ref<ProjectListFilters>({
  page: 1,
  pageSize: 12,
  tab: 'open',
  category: '',
  method: '',
  q: '',
  sort: 'latest',
});
const qInput = ref('');
const { data, isLoading } = useMarketProjectList(filters);

const tabs = [
  { key: 'open', label: '입찰중' },
  { key: 'closed', label: '견적마감' },
  { key: 'awarded', label: '선정완료' },
  { key: 'all', label: '전체' },
] as const;

const setTab = (tab: ProjectListFilters['tab']): void => {
  filters.value.tab = tab;
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
    <p class="font-mono text-[11px] tracking-widest text-tx-3">OPEN BOARD</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('projects.title') }}</h1>
    <p class="mt-1.5 text-sm text-tx-2">{{ $t('projects.subtitle') }}</p>

    <!-- 탭 + 필터 바 -->
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-line bg-white p-1 text-xs font-bold">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === t.key ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-line'"
          @click="setTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <select
        v-model="filters.category"
        class="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold text-tx-2"
        @change="resetPage"
      >
        <option value="">{{ $t('projects.allCategories') }}</option>
        <option v-for="c in MarketProjectCategory.options" :key="c" :value="c">
          {{ MARKET_PROJECT_CATEGORY_LABELS[c] }}
        </option>
      </select>

      <select
        v-model="filters.method"
        class="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold text-tx-2"
        @change="resetPage"
      >
        <option value="">{{ $t('projects.allMethods') }}</option>
        <option v-for="m in MarketProjectMethod.options" :key="m" :value="m">
          {{ MARKET_METHOD_LABELS[m] }}
        </option>
      </select>

      <select
        v-model="filters.sort"
        class="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold text-tx-2"
        @change="resetPage"
      >
        <option value="latest">{{ $t('projects.sortLatest') }}</option>
        <option value="deadline">{{ $t('projects.sortDeadline') }}</option>
      </select>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          :placeholder="$t('projects.searchPlaceholder')"
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

    <!-- 목록 -->
    <div v-if="isLoading" class="mt-10 text-center text-sm text-tx-3">{{ $t('common.loading') }}</div>
    <template v-else-if="data !== undefined">
      <p class="mt-5 text-xs text-tx-3">{{ $t('projects.total', { n: data.data.total }) }}</p>
      <div v-if="data.data.items.length > 0" class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProjectCard v-for="p in data.data.items" :key="p.projectId" :item="p" />
      </div>
      <div v-else class="mt-6 rounded-2xl border border-dashed border-line-2 bg-white p-14 text-center">
        <p class="text-sm text-tx-3">{{ $t('projects.empty') }}</p>
        <RouterLink
          to="/request"
          class="mt-4 inline-block rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600"
        >
          {{ $t('nav.request') }}
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
