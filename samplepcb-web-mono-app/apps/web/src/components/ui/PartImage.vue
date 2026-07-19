<script setup lang="ts">
import { computed, ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  src: string | null;
  alt?: string;
  placeholder?: string | null;
}>(), {
  alt: '',
  placeholder: 'IMG',
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
    referrerpolicy="no-referrer"
    class="bg-white object-contain"
    @error="broken = true"
  >
  <div
    v-else-if="placeholder !== null"
    v-bind="$attrs"
    class="grid place-items-center bg-gray-50 text-[10px] text-gray-300"
    aria-hidden="true"
  >
    {{ placeholder }}
  </div>
</template>
