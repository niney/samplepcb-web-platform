<template>
  <a
    href="/"
    class="grid size-[32px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
    :aria-label="$t('common.siteHome')"
    :title="$t('common.siteHome')"
  >
    <svg viewBox="0 0 24 24" class="size-[19px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="m3.5 10.5 8.5-7 8.5 7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" stroke-linecap="round" />
    </svg>
  </a>
</template>
