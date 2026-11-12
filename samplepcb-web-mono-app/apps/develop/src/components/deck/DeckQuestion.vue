<script setup lang="ts">
import type { DeckQuestion } from '../../lib/deck-content';

// 확인이 필요한 사항 한 문항 — 번호 + 굵은 질문 → 회색 한 줄(왜 묻는지) → 답변 칸.
// 담당자가 상담 뒤 적은 확인 결과가 있으면 칸에 적고, 없으면 빈 칸(인쇄해서 적어 오거나 상담에서 채운다).
// 장에 남는 높이는 문항이 고르게 나눠 갖고 빈 답변 칸이 그만큼 커진다(한도 110 — 문항이 하나뿐인 장에서 칸만 커지지 않게).
// 확인 결과가 적힌 칸은 글 높이 그대로다.
defineProps<{ item: DeckQuestion }>();
</script>

<template>
  <div class="flex flex-col" :class="item.resolution === '' ? 'flex-1' : ''">
    <p class="flex gap-[10px] text-[20px] font-bold leading-[1.4]">
      <span class="shrink-0 tabular-nums">{{ item.no }}.</span><span class="min-w-0">{{ item.question }}</span>
    </p>
    <p v-if="item.why !== ''" class="mt-[4px] text-[15px] leading-[1.5] text-tx-2">{{ item.why }}</p>
    <p
      class="mt-[10px] flex min-h-[50px] gap-[12px] rounded-[4px] border px-[16px] py-[12px] text-[16px] leading-[1.55]"
      :class="item.resolution !== '' ? 'border-brand-200 bg-brand-50' : 'max-h-[110px] flex-1 border-line-2'"
    >
      <span class="shrink-0" :class="item.resolution !== '' ? 'font-bold text-brand-600' : 'text-tx-3'">{{ item.resolution !== '' ? '확인 결과' : '답변' }}</span>
      <span class="min-w-0 whitespace-pre-line">{{ item.resolution }}</span>
    </p>
  </div>
</template>
