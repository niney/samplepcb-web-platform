<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from '../bom/useTheme';
import icHomeBom from '../assets/bom/ic-home.svg';
import icHomeBomDark from '../assets/bom/ic-home-dark.svg';

withDefaults(defineProps<{
  variant?: 'default' | 'bom';
}>(), {
  variant: 'default',
});

// bom variant 아이콘은 색이 베이크된 SVG 라 테마로 스왑한다(라이트 #727680 · 다크 #B6B6B8).
const { isDark } = useTheme();
const homeIcon = computed(() => (isDark.value ? icHomeBomDark : icHomeBom));
</script>

<template>
  <a
    href="/"
    class="grid place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-brand"
    :class="variant === 'bom' ? 'size-[26px]' : 'size-[32px]'"
    :aria-label="$t('common.siteHome')"
    :title="$t('common.siteHome')"
  >
    <span v-if="variant === 'bom'" class="relative block size-[20px] overflow-hidden" aria-hidden="true">
      <span class="absolute inset-[8.33%_12.5%_12.5%_12.5%]">
        <span class="absolute inset-[-4.74%_-5%]">
          <img :src="homeIcon" alt="" class="block size-full max-w-none">
        </span>
      </span>
    </span>
    <svg v-else viewBox="0 0 24 24" class="size-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="m3.5 10.5 8.5-7 8.5 7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" stroke-linecap="round" />
    </svg>
  </a>
</template>
