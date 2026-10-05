<script setup lang="ts">
// 섹션 안 전폭 안내 띠 — SectionCard 의 #notice 자리(머리 아래)에 깐다. 테두리 상자인 Alert 와 달리
// 카드 가장자리까지 꽉 채우는 얇은 띠라 섹션 흐름을 끊지 않는다. 띠끼리는 아래 구분선으로 나뉘고,
// 본문이 없는 섹션의 마지막 띠 구분선은 SectionCard 가 지운다.
// tone: muted=일반 안내, info=진행 안내, warning=주의, success=완료, destructive=오류.
const props = withDefaults(
  defineProps<{ tone?: 'muted' | 'info' | 'warning' | 'success' | 'destructive' }>(),
  { tone: 'muted' },
);

const TONE: Record<NonNullable<typeof props.tone>, string> = {
  muted: 'bg-muted/40 text-muted-foreground',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  destructive: 'bg-destructive-soft text-destructive',
};
</script>

<template>
  <div class="border-b px-4 py-2 text-sm" :class="TONE[props.tone]">
    <slot />
  </div>
</template>
