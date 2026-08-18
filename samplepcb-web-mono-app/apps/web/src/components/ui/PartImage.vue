<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import brandMark from '../../assets/bom/logo-partseyes-stack.svg';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  src: string | null;
  alt?: string;
  /** 이미지가 없을 때: 'brand'(기본)=시안 2282:80418 의 Parts Eyes 타일 · null=아무것도 안 그림 · 그 밖의 문자열은 글자로. */
  placeholder?: string | null;
}>(), {
  alt: '',
  placeholder: 'brand',
});

const broken = ref(false);
watch(() => props.src, () => { broken.value = false; });

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
  <!-- 이미지 없음 — 시안은 밝은 타일 위에 세로 조합 로고를 앉힌다(64px 타일 안쪽 62px 에 50px).
       테두리·모서리는 호출부가 실사진과 같은 값으로 주므로 여기서는 면과 로고만 그린다. -->
  <div
    v-else-if="placeholder === 'brand'"
    v-bind="$attrs"
    class="grid place-items-center overflow-hidden bg-bom-thumb-empty"
    aria-hidden="true"
  >
    <img :src="brandMark" alt="" class="w-[80%]">
  </div>
  <div
    v-else-if="placeholder !== null"
    v-bind="$attrs"
    class="grid place-items-center bg-gray-50 text-[10px] text-gray-300"
    aria-hidden="true"
  >
    {{ placeholder }}
  </div>
</template>
