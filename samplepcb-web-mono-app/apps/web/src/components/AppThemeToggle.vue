<script setup lang="ts">
import { useTheme } from '../bom/useTheme';

// 테마 전환 버튼 — 관리자·기본·협력사 셸이 같은 SVG 를 세 벌 들고 있던 것을 모았다.
// 상태는 useTheme 싱글턴이라 어느 셸에서 바꿔도 함께 바뀐다. (BOM 셸은 Figma 크롬 색을
// 따로 쓰므로 자체 버튼 유지.)
withDefaults(defineProps<{ iconClass?: string }>(), { iconClass: 'size-[17px]' });

const { isDark, toggleTheme } = useTheme();
</script>

<template>
  <button
    type="button"
    class="grid size-[30px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
    :aria-label="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
    :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
    @click="toggleTheme"
  >
    <svg v-if="isDark" viewBox="0 0 24 24" :class="iconClass" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
    </svg>
    <svg v-else viewBox="0 0 24 24" :class="iconClass" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" stroke-linejoin="round" />
    </svg>
  </button>
</template>
