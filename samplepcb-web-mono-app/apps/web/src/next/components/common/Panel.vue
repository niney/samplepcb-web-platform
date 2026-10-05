<script setup lang="ts">
// 섹션·대화상자 안의 작은 테두리 상자(요약 수치·묶음 정보 등). 상태를 알리는 상자는 Panel 이 아니라
// ui/alert(Alert variant=info|warning|success|destructive)를 쓴다. 여백은 두 단계로만.
const props = withDefaults(defineProps<{ size?: 'sm' | 'md'; muted?: boolean }>(), {
  size: 'sm',
  muted: false,
});
</script>

<template>
  <div class="rounded-lg border" :class="[props.size === 'md' ? 'p-4' : 'p-3', props.muted ? 'bg-muted/40' : '']">
    <slot />
  </div>
</template>
