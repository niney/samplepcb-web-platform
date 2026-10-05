<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import brandMark from '@/assets/bom/logo-partseyes-stack.svg';

// 부품 사진 — 옛 components/ui/PartImage.vue 의 짝(같은 props). 테두리·모서리·크기는 호출부가 준다.
// 사진은 흰 바탕 제품 컷이 대부분이라 다크 모드에서도 흰 면에 앉힌다.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src: string | null;
    alt?: string;
    /** 이미지가 없을 때: 'brand'(기본)=Parts Eyes 타일 · null=아무것도 안 그림 · 그 밖의 문자열은 글자로. */
    placeholder?: string | null;
  }>(),
  {
    alt: '',
    placeholder: 'brand',
  },
);

const broken = ref(false);
watch(
  () => props.src,
  () => {
    broken.value = false;
  },
);

const imageSrc = computed(() => (broken.value ? null : props.src));
</script>

<template>
  <img
    v-if="imageSrc !== null"
    v-bind="$attrs"
    :src="imageSrc"
    :alt="alt"
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    class="bg-white object-contain"
    @error="broken = true"
  >
  <!-- 이미지 없음 — 밝은 타일 위에 세로 조합 로고. -->
  <div v-else-if="placeholder === 'brand'" v-bind="$attrs" class="bg-muted grid place-items-center overflow-hidden" aria-hidden="true">
    <img :src="brandMark" alt="" class="w-4/5">
  </div>
  <div
    v-else-if="placeholder !== null"
    v-bind="$attrs"
    class="bg-muted text-muted-foreground grid place-items-center text-xs"
    aria-hidden="true"
  >
    {{ placeholder }}
  </div>
</template>
