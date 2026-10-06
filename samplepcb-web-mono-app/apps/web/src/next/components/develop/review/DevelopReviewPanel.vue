<script setup lang="ts">
import type { AdminDevelopReviewStateType } from '@sp/api-contract';

// 자리표시 — 옛 components/admin/develop/DevelopReviewPanel.vue 와 같은 props·emits. 작업 중.
defineProps<{
  requestId: number;
  review: AdminDevelopReviewStateType;
  aiConsent: boolean;
  aiSupplement: string | null;
  title: string;
}>();
defineEmits<{ dirty: [value: boolean] }>();
</script>

<template>
  <p class="text-muted-foreground text-sm">작업 중</p>
</template>
