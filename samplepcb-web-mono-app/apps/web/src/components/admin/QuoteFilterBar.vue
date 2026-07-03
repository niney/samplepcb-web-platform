<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminQuoteFilters } from '../../admin/useAdminQuotes';

// 필터 행 — 검색어(디바운스 300ms)·기간·카테고리·보관함 토글.
// 상태는 부모(AdminQuotes)가 단일 소유하고, 여기서는 변경분만 emit 한다.
const props = defineProps<{ filters: AdminQuoteFilters }>();
const emit = defineEmits<{ change: [patch: Partial<AdminQuoteFilters>] }>();
const { t } = useI18n();

// 스냅샷 모델의 category 4종 고정 (SpQuote 주석·TEMPLATE_ITEMS 기준)
const CATEGORIES = ['standard', 'metalMask', 'advance', 'flexible'] as const;

const q = ref(props.filters.q);
let debounceId: ReturnType<typeof setTimeout> | null = null;

const onSearchInput = (): void => {
  if (debounceId !== null) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    emit('change', { q: q.value });
  }, 300);
};

onBeforeUnmount(() => {
  if (debounceId !== null) clearTimeout(debounceId);
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
    <input
      v-model="q"
      type="search"
      class="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      :placeholder="t('admin.quotes.filter.searchPlaceholder')"
      @input="onSearchInput"
      @keydown.enter="emit('change', { q })"
    >
    <label class="flex items-center gap-1 text-sm text-gray-600">
      <span class="sr-only">{{ t('admin.quotes.filter.from') }}</span>
      <input
        type="date"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.from"
        @change="emit('change', { from: ($event.target as HTMLInputElement).value })"
      >
      <span class="text-gray-400">~</span>
      <span class="sr-only">{{ t('admin.quotes.filter.to') }}</span>
      <input
        type="date"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.to"
        @change="emit('change', { to: ($event.target as HTMLInputElement).value })"
      >
    </label>
    <select
      class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      :value="props.filters.category"
      @change="emit('change', { category: ($event.target as HTMLSelectElement).value })"
    >
      <option value="">{{ t('admin.quotes.filter.allCategories') }}</option>
      <option v-for="c in CATEGORIES" :key="c" :value="c">
        {{ t(`admin.quotes.categories.${c}`) }}
      </option>
    </select>
    <label class="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
      <input
        type="checkbox"
        class="rounded border-gray-300"
        :checked="props.filters.includeDeleted"
        @change="emit('change', { includeDeleted: ($event.target as HTMLInputElement).checked })"
      >
      {{ t('admin.quotes.filter.includeDeleted') }}
    </label>
  </div>
</template>
