<script setup lang="ts">
import type { DeckQa } from '../../lib/deck-content';

// AI 추가 질문 한 문항 — 파란 Q + 굵은 질문 → 답(미응답 · 모름은 흐리게). 답변 칸은 없다(이미 받은 답이다).
defineProps<{ item: DeckQa }>();
</script>

<template>
  <div class="flex flex-col">
    <p class="flex gap-[10px] text-[19px] font-bold leading-[1.45]">
      <span class="shrink-0 text-brand-600">Q</span><span class="min-w-0">{{ item.question }}</span>
    </p>
    <p class="mt-[3px] whitespace-pre-wrap pl-[25px] text-[17px] leading-[1.55]" :class="item.muted ? 'text-tx-3' : 'text-[#3b4558]'">{{ item.answer }}</p>
  </div>
</template>
