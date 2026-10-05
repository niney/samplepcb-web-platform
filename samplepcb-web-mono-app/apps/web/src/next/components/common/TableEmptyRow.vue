<script setup lang="ts">
import { TableEmpty } from '@/next/components/ui/table';
import { Spinner } from '@/next/components/ui/spinner';

// 표가 비었을 때 한 줄 — 불러오는 중이면 스피너와 함께 '불러오는 중…', 아니면 빈 상태 문구.
defineProps<{
  colspan: number;
  text: string;
  loading?: boolean;
}>();
</script>

<template>
  <TableEmpty :colspan="colspan">
    <span class="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <Spinner v-if="loading === true" />
      {{ loading === true ? '불러오는 중…' : text }}
    </span>
  </TableEmpty>
</template>
