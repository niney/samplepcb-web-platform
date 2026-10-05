<script setup lang="ts">
import { computed } from 'vue';
import { Moon, Sun } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import { useTheme } from '@/bom/useTheme';

// 테마 전환 — 상태는 옛 셸과 같은 싱글턴(useTheme)이라 어느 셸에서 바꿔도 함께 바뀐다.
// 색은 <html data-theme> 하나로 정해지고 next/theme.css 가 그 속성을 본다.
const { isDark, toggleTheme } = useTheme();
const label = computed(() => (isDark.value ? '라이트 모드로 전환' : '다크 모드로 전환'));
</script>

<template>
  <Button variant="ghost" size="icon" :aria-label="label" :title="label" @click="toggleTheme">
    <Sun v-if="isDark" />
    <Moon v-else />
  </Button>
</template>
