<script setup lang="ts">
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';

// 자리표시 — 옛 components/admin/develop/DevelopQuoteSection.vue 와 같은 props·emits. 작업 중.
defineProps<{ detail: AdminDevelopRequestDetailType }>();
defineEmits<{ editing: [value: boolean] }>();
</script>

<template>
  <p class="text-muted-foreground text-sm">작업 중</p>
</template>
