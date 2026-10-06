<script setup lang="ts">
import { PlusIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 검토서 편집기의 행 목록 머리 — 제목 · 건수/상한 · 행 추가. 요구사항·명세·관찰·일정 단계·상의 항목이
// 같은 모양을 쓴다(옛 편집기는 다섯 곳에 손으로 반복). 상한에 닿으면 추가 버튼이 잠긴다 —
// 상한은 계약 zod `.max()` 와 같은 값(develop-review-edit.ts DEVELOP_REVIEW_LIMITS)이라 넘기면 PUT 이 400 이다.
const props = withDefaults(
  defineProps<{
    title: string;
    count: number;
    limit: number;
    addLabel: string;
    /** sub = 분야 블록 안의 작은 목록(명세·관찰) */
    size?: 'section' | 'sub';
  }>(),
  { size: 'section' },
);
const emit = defineEmits<{ add: [] }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span :class="props.size === 'section' ? 'text-sm font-semibold' : 'text-muted-foreground text-xs font-semibold'">
      {{ props.title }}
    </span>
    <span class="text-muted-foreground text-xs tabular-nums">{{ props.count }} / {{ props.limit }}</span>
    <Button
      variant="outline"
      size="xs"
      class="ml-auto"
      :disabled="props.count >= props.limit"
      @click="emit('add')"
    >
      <PlusIcon />
      {{ props.addLabel }}
    </Button>
    <!-- 추가 뒤에 붙는 동작(일정: '일정 없이 공개') -->
    <slot name="actions" />
  </div>
</template>
