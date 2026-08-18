<script setup lang="ts">
import icHomeBom from '../assets/bom/ic-home.svg';

withDefaults(defineProps<{
  variant?: 'default' | 'bom';
}>(), {
  variant: 'default',
});
</script>

<template>
  <a
    href="/"
    class="grid place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
    :class="variant === 'bom' ? 'size-[26px]' : 'size-[32px]'"
    :aria-label="$t('common.siteHome')"
    :title="$t('common.siteHome')"
  >
    <span v-if="variant === 'bom'" class="relative block size-[20px] overflow-hidden" aria-hidden="true">
      <span class="absolute inset-[8.33%_12.5%_12.5%_12.5%]">
        <span class="absolute inset-[-4.74%_-5%]">
          <img :src="icHomeBom" alt="" class="block size-full max-w-none">
        </span>
      </span>
    </span>
    <svg v-else viewBox="0 0 24 24" class="size-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="m3.5 10.5 8.5-7 8.5 7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" stroke-linecap="round" />
    </svg>
  </a>
</template>
