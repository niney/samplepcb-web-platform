<script setup lang="ts">
import { computed } from 'vue';

// 달성도 막대 — 워크큐 진척 열·홈 카드·상세 현황 띠가 함께 쓴다(값은 서버 ops.progressPct, 다시 계산하지 않는다).
// 폭은 CSS 변수로만 넘긴다(BOM 작업대 분석 막대와 같은 방식 — 인라인 폭 값 대신 w-(--pct)).
const props = defineProps<{ pct: number; label: string }>();
const clamped = computed(() => Math.min(100, Math.max(0, props.pct)));
</script>

<template>
  <div
    class="bg-muted h-2 w-full overflow-hidden rounded-full"
    role="progressbar"
    :aria-label="props.label"
    :aria-valuenow="clamped"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="bg-primary h-full w-(--pct) rounded-full" :style="{ '--pct': `${String(clamped)}%` }" />
  </div>
</template>
