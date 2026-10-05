<script setup lang="ts">
// 섹션·대화상자 안의 작은 테두리 상자(요약 수치·묶음 정보·표 칸 안 메모 등). 문장으로 상태를 알리는
// 상자는 Panel 이 아니라 ui/alert(Alert) — Panel 의 tone 은 "값에 따라 칸 색이 바뀌는" 결론 칸(미지급
// 잔액 등)과 칸 안 메모에 쓴다. 여백은 xs(표 칸 안)·sm·md 세 단계로만.
const props = withDefaults(
  defineProps<{
    size?: 'xs' | 'sm' | 'md';
    tone?: 'default' | 'muted' | 'info' | 'warning' | 'success' | 'destructive';
    /** @deprecated tone="muted" 와 같다(이전 API). */
    muted?: boolean;
  }>(),
  { size: 'sm', tone: 'default', muted: false },
);

const SIZE: Record<NonNullable<typeof props.size>, string> = {
  xs: 'px-2 py-1',
  sm: 'p-3',
  md: 'p-4',
};
const TONE: Record<NonNullable<typeof props.tone>, string> = {
  default: '',
  muted: 'bg-muted/40',
  info: 'border-info/30 bg-info-soft text-info',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  success: 'border-success/30 bg-success-soft text-success',
  destructive: 'border-destructive/30 bg-destructive-soft text-destructive',
};
</script>

<template>
  <div class="rounded-lg border" :class="[SIZE[props.size], TONE[props.muted ? 'muted' : props.tone]]">
    <slot />
  </div>
</template>
