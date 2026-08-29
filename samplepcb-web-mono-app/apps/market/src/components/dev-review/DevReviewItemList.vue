<script setup lang="ts">
import type { GroundedItemType } from '@sp/api-contract';

// 근거 붙은 항목(GroundedItem) 목록 — 검토서 전역에서 같은 어휘·같은 모양으로 쓴다.
// 확정 = 본문 그대로, 확인 필요 = 회색 배경 + '확인 필요' 배지 + 물어볼 질문(+왜 필요한지).
// 배지 어휘는 '확정'·'확인 필요' 두 단어뿐이다(판정어·등급·금액·주수 금지).
defineProps<{ items: readonly GroundedItemType[] }>();
</script>

<template>
  <ul class="grid gap-2">
    <li
      v-for="(item, i) in items"
      :key="i"
      class="rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed"
      :class="
        item.status === 'confirmed'
          ? 'border-line bg-white text-tx-2'
          : 'border-line bg-paper text-tx-3'
      "
    >
      <div class="flex items-start gap-2">
        <span
          class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
          :class="item.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
        >
          {{ item.status === 'confirmed' ? '확정' : '확인 필요' }}
        </span>
        <span class="min-w-0 flex-1" :class="item.status === 'confirmed' ? 'text-tx-1' : ''">
          {{ item.text }}
        </span>
      </div>
      <p v-if="item.status !== 'confirmed' && item.question !== null" class="mt-1.5 pl-1 font-semibold text-amber-800">
        ❓ {{ item.question }}
      </p>
      <p v-if="item.status !== 'confirmed' && item.why !== null && item.why !== ''" class="mt-1 pl-1 text-tx-3">
        {{ item.why }}
      </p>
      <details v-if="item.evidence !== null && item.evidence !== ''" class="mt-1.5 pl-1">
        <summary class="cursor-pointer text-[11px] font-semibold text-tx-3">출처 보기</summary>
        <p class="mt-1 border-l-2 border-line-2 pl-2 text-[11px] text-tx-3">“{{ item.evidence }}”</p>
      </details>
    </li>
  </ul>
</template>
