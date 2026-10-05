<script setup lang="ts">
import { House } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 사이트 홈(그누보드 '/') — SPA 밖이라 RouterLink 가 아닌 a 로 나간다.
</script>

<template>
  <Button variant="ghost" size="icon" as-child>
    <a href="/" :aria-label="$t('common.siteHome')" :title="$t('common.siteHome')">
      <House />
    </a>
  </Button>
</template>
