<script setup lang="ts">
import { computed } from 'vue';

// 분야 아이콘 타일(docs/AI_DEV_REVIEW.md §13.9) — 분야 색은 이 타일에만 싣는다(카드 왼쪽 띠 폐기).
// 레지스트리 코드 5종(circuit·pcb·firmware·app·server)에 선 아이콘 하나씩, 그 외 코드는 점 하나(분야가 늘면 여기에 추가).
// 색은 style.css 의 --color-area-<code> 토큰, 없는 코드는 잉크색.
const props = withDefaults(defineProps<{ code: string; size?: 'sm' | 'md' }>(), { size: 'md' });
const KNOWN = new Set(['circuit', 'pcb', 'firmware', 'app', 'server']);
const bg = computed(() => (KNOWN.has(props.code) ? `var(--color-area-${props.code})` : 'var(--color-ink-900)'));
const box = computed(() => (props.size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl'));
const glyph = computed(() => (props.size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'));
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center text-white" :class="box" :style="{ backgroundColor: bg }" aria-hidden="true">
    <!-- 회로: 저항 기호 -->
    <svg v-if="code === 'circuit'" :class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h4l2-4 3 8 3-8 3 8 2-4h3" />
    </svg>
    <!-- PCB: 기판 + 패드 -->
    <svg v-else-if="code === 'pcb'" :class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.6" /><circle cx="16" cy="16" r="1.6" />
      <path d="M8 9.6V13a2 2 0 0 0 2 2h4.4" />
    </svg>
    <!-- 펌웨어: 칩 -->
    <svg v-else-if="code === 'firmware'" :class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </svg>
    <!-- 앱: 휴대폰 -->
    <svg v-else-if="code === 'app'" :class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 18h3" />
    </svg>
    <!-- 서버: 랙 2단 -->
    <svg v-else-if="code === 'server'" :class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" stroke-width="2.6" />
    </svg>
    <svg v-else :class="glyph" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4" /></svg>
  </span>
</template>
