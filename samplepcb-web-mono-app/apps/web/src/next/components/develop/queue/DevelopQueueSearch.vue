<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/next/components/ui/button';
import SearchInput from '@/next/components/common/SearchInput.vue';

// 큐 검색 — 검색창(Enter 확정) + 옛 화면의 '검색' 버튼 짝. 탭 줄 오른쪽(QueueTabs #end)이나 탭 아래 줄에 둔다.
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ search: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-2">
    <SearchInput v-model="model" :placeholder="t('admin.develop.searchPlaceholder')" class="sm:w-72" @search="emit('search')" />
    <Button type="button" variant="outline" @click="emit('search')">{{ t('admin.develop.search') }}</Button>
  </div>
</template>
