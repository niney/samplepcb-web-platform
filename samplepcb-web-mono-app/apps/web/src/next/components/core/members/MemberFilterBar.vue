<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminMemberFilters } from '@/admin/useAdminMembers';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import SearchInput from '@/next/components/common/SearchInput.vue';

// 필터 행 — 통합검색·가입일 기간·정렬(옛 MemberFilterBar 와 같은 props·emits). 상태는 부모(MembersPage)가
// 단일 소유하고 여기서는 변경분만 낸다. 검색은 옛 화면처럼 입력 300ms 뒤 자동 조회 + Enter 즉시 조회.
const props = defineProps<{ filters: AdminMemberFilters }>();
const emit = defineEmits<{ change: [patch: Partial<AdminMemberFilters>] }>();
const { t } = useI18n();

const SORTS = ['joined', 'lastLogin'] as const;

const q = ref(props.filters.q);
let debounceId: ReturnType<typeof setTimeout> | null = null;
const clearDebounce = (): void => {
  if (debounceId !== null) clearTimeout(debounceId);
  debounceId = null;
};

watch(q, () => {
  clearDebounce();
  debounceId = setTimeout(() => {
    debounceId = null;
    emit('change', { q: q.value });
  }, 300);
});

const submitSearch = (): void => {
  clearDebounce();
  emit('change', { q: q.value });
};

const eventValue = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value;

const onSortChange = (e: Event): void => {
  const value = eventValue(e);
  const sort = SORTS.find((s) => s === value);
  if (sort !== undefined) emit('change', { sort });
};

onBeforeUnmount(clearDebounce);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <SearchInput v-model="q" class="sm:w-80" :placeholder="t('admin.members.filter.searchPlaceholder')" @search="submitSearch" />
    <div class="flex items-center gap-1.5">
      <Input
        :model-value="props.filters.from"
        type="date"
        class="w-36"
        :aria-label="t('admin.members.filter.from')"
        @change="(e: Event) => emit('change', { from: eventValue(e) })"
      />
      <span class="text-muted-foreground text-sm">~</span>
      <Input
        :model-value="props.filters.to"
        type="date"
        class="w-36"
        :aria-label="t('admin.members.filter.to')"
        @change="(e: Event) => emit('change', { to: eventValue(e) })"
      />
    </div>
    <label class="ml-auto flex items-center gap-1.5 text-sm">
      <span class="text-muted-foreground">{{ t('admin.members.filter.sortLabel') }}</span>
      <NativeSelect :model-value="props.filters.sort" @change="onSortChange">
        <NativeSelectOption v-for="s in SORTS" :key="s" :value="s">
          {{ t(`admin.members.filter.sort.${s}`) }}
        </NativeSelectOption>
      </NativeSelect>
    </label>
  </div>
</template>
