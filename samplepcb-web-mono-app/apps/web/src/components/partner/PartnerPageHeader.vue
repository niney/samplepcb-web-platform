<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

// 협력사 포털 페이지 헤더(포털 재설계 R3) — 제목·부제·복귀 링크·배지·액션을 한 모양으로.
// 사이드바가 전역 이동을 맡으므로 최상위 화면은 복귀 링크가 없고, 상세(견적·발주)만
// "← 목록" 으로 돌아간다. 예전의 "← 홈 / ← 목록 / ← 파트너 홈" 제각각을 이 한 곳으로 모았다.
withDefaults(
  defineProps<{
    /** 제목 — 상세처럼 데이터가 온 뒤 정해지면 비워 두고(null) 로딩 문구만 둔다. */
    title?: string | null;
    subtitle?: string | null;
    back?: { to: RouteLocationRaw; label: string } | null;
  }>(),
  { title: null, subtitle: null, back: null },
);
</script>

<template>
  <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
    <RouterLink
      v-if="back !== null"
      :to="back.to"
      class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
    >
      ← {{ back.label }}
    </RouterLink>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h1 v-if="title !== null && title !== ''" class="min-w-0 break-words text-xl font-bold">{{ title }}</h1>
        <slot name="badges" />
      </div>
      <p v-if="subtitle !== null && subtitle !== ''" class="mt-0.5 text-sm text-gray-500">{{ subtitle }}</p>
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
