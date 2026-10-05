<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { History } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import { legacyNextRoute } from '@/next/admin-menu';

// 전환기 비교용 '이전 화면' — 지금 보는 리뉴얼 화면을 같은 params·query 의 옛 화면으로 연다.
// 컷오버(옛 화면 삭제) 때 이 링크도 함께 지운다.
const route = useRoute();
const legacyTo = computed(() =>
  typeof route.name === 'string' ? legacyNextRoute(route.name, route.params, route.query) : null,
);
</script>

<template>
  <Button v-if="legacyTo !== null" variant="ghost" size="sm" as-child>
    <RouterLink :to="legacyTo" title="같은 화면을 이전 디자인으로 엽니다">
      <History />
      <span class="hidden sm:inline">이전 화면</span>
    </RouterLink>
  </Button>
</template>
