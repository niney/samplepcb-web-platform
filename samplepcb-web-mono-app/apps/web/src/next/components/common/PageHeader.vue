<script setup lang="ts">
// 화면 머리 — 제목·설명·우측 동작. 리뉴얼 화면은 전부 이 한 모양으로 시작한다.
// 설명에 강조 등 마크업이 필요하면 description 슬롯을 쓴다(문자열 prop 보다 우선).
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 space-y-1">
      <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="$slots.description !== undefined || description !== undefined" class="text-muted-foreground text-sm">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions !== undefined" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
