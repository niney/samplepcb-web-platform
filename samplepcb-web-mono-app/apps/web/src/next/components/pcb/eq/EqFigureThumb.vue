<script setup lang="ts">
// 문항 그림 한 장 — 관리자 그림 GET 은 Bearer 가 필요해 `<img src>` 로 바로 못 건다. 부모가 넘긴
// 캐시(createEqFigureUrls)에서 objectURL 을 받아 그린다. 누르면 확대(부모가 띄운다).
import { ref, watch } from 'vue';
import { ImageOffIcon } from '@lucide/vue';
import type { EqFigureUrls } from './useAdminPcbEqRounds';

const props = withDefaults(defineProps<{
  urls: EqFigureUrls;
  poId: number;
  reviewId: number;
  fileId: number;
  name: string;
  /** 칸 크기 — 편집기는 크게, 미리보기는 작게. */
  size?: 'sm' | 'md';
}>(), { size: 'md' });

const emit = defineEmits<{ zoom: [url: string, name: string] }>();

const url = ref<string | null>(null);
const failed = ref(false);

watch(
  () => [props.poId, props.reviewId, props.fileId] as const,
  ([poId, reviewId, fileId]) => {
    url.value = null;
    failed.value = false;
    void props.urls.get(poId, reviewId, fileId).then(
      (value) => {
        if (props.fileId === fileId) url.value = value;
      },
      () => {
        if (props.fileId === fileId) failed.value = true;
      },
    );
  },
  { immediate: true },
);

const zoom = (): void => {
  if (url.value !== null) emit('zoom', url.value, props.name);
};
</script>

<template>
  <span
    class="bg-muted/40 grid shrink-0 place-items-center overflow-hidden rounded-md border"
    :class="size === 'md' ? 'size-24' : 'size-16'"
    :data-eq-figure="fileId"
  >
    <img
      v-if="url !== null"
      :src="url"
      :alt="name"
      :title="`${name} — 눌러서 크게 보기`"
      class="size-full cursor-zoom-in object-contain"
      role="button"
      tabindex="0"
      @click="zoom"
      @keydown.enter="zoom"
    >
    <ImageOffIcon v-else-if="failed" class="text-muted-foreground size-4" />
    <span v-else class="text-muted-foreground text-xs">불러오는 중</span>
  </span>
</template>
