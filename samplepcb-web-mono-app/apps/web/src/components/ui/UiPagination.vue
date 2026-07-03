<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ page: number; pageSize: number; total: number }>();
const emit = defineEmits<{ 'update:page': [page: number] }>();

const lastPage = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

// 현재 페이지 주변 최대 5개 번호
const pages = computed<number[]>(() => {
  const start = Math.max(1, Math.min(props.page - 2, lastPage.value - 4));
  const end = Math.min(lastPage.value, start + 4);
  const list: number[] = [];
  for (let p = start; p <= end; p += 1) list.push(p);
  return list;
});

const go = (p: number): void => {
  if (p >= 1 && p <= lastPage.value && p !== props.page) emit('update:page', p);
};
</script>

<template>
  <nav class="flex items-center justify-center gap-1 text-sm" aria-label="pagination">
    <button
      type="button"
      class="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      :disabled="props.page <= 1"
      @click="go(props.page - 1)"
    >
      ‹
    </button>
    <button
      v-for="p in pages"
      :key="p"
      type="button"
      class="min-w-8 rounded-md px-2 py-1"
      :class="
        p === props.page
          ? 'bg-blue-600 font-semibold text-white'
          : 'text-gray-700 hover:bg-gray-100'
      "
      @click="go(p)"
    >
      {{ p }}
    </button>
    <button
      type="button"
      class="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      :disabled="props.page >= lastPage"
      @click="go(props.page + 1)"
    >
      ›
    </button>
  </nav>
</template>
