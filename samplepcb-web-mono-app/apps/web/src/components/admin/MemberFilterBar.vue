<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminMemberFilters } from '../../admin/useAdminMembers';

// 필터 행 — 통합검색(디바운스 300ms)·가입일 기간·정렬. 상태는 부모(AdminMembers)가
// 단일 소유하고, 여기서는 변경분만 emit 한다(견적 관리 QuoteFilterBar 관례).
const props = defineProps<{ filters: AdminMemberFilters }>();
const emit = defineEmits<{ change: [patch: Partial<AdminMemberFilters>] }>();
const { t } = useI18n();

const SORTS = ['joined', 'lastLogin'] as const;

const q = ref(props.filters.q);
let debounceId: ReturnType<typeof setTimeout> | null = null;

const onSearchInput = (): void => {
  if (debounceId !== null) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    emit('change', { q: q.value });
  }, 300);
};

const onSortChange = (e: Event): void => {
  emit('change', { sort: (e.target as HTMLSelectElement).value as AdminMemberFilters['sort'] });
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
      class="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      :placeholder="t('admin.members.filter.searchPlaceholder')"
      @input="onSearchInput"
      @keydown.enter="emit('change', { q })"
    >
    <label class="flex items-center gap-1 text-sm text-gray-600">
      <span class="sr-only">{{ t('admin.members.filter.from') }}</span>
      <input
        type="date"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.from"
        @change="emit('change', { from: ($event.target as HTMLInputElement).value })"
      >
      <span class="text-gray-400">~</span>
      <span class="sr-only">{{ t('admin.members.filter.to') }}</span>
      <input
        type="date"
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.to"
        @change="emit('change', { to: ($event.target as HTMLInputElement).value })"
      >
    </label>
    <label class="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
      <span class="text-gray-400">{{ t('admin.members.filter.sortLabel') }}</span>
      <select
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.sort"
        @change="onSortChange"
      >
        <option v-for="s in SORTS" :key="s" :value="s">
          {{ t(`admin.members.filter.sort.${s}`) }}
        </option>
      </select>
    </label>
  </div>
</template>
