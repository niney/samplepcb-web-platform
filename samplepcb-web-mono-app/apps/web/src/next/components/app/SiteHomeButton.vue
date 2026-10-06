<script setup lang="ts">
import { House } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 사이트 홈(그누보드 '/') — SPA 밖이라 RouterLink 가 아닌 a 로 나간다.
</script>

<template>
  <!-- 셸 헤더 크기 — 36px·아이콘 20px(옛 헤더와 같은 체감, 선은 조금 가늘게) -->
  <Button variant="ghost" size="icon-md" as-child>
    <a href="/" :aria-label="$t('common.siteHome')" :title="$t('common.siteHome')">
      <House class="size-5" :stroke-width="1.75" />
    </a>
  </Button>
</template>
