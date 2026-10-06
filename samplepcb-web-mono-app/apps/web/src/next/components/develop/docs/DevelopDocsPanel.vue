<script setup lang="ts">
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import type { PreviewTarget } from '@sp/ui';

// 자리표시 — 옛 components/admin/develop/DevelopDocsPanel.vue 와 같은 props·emits. 작업 중.
defineProps<{ detail: AdminDevelopRequestDetailType }>();
defineEmits<{ dirty: [value: boolean]; preview: [file: PreviewTarget] }>();
</script>

<template>
  <p class="text-muted-foreground text-sm">작업 중</p>
</template>
