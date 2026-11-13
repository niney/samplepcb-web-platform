<script setup lang="ts">
import { computed } from 'vue';
import type { DeckQuestion } from '../../lib/deck-content';

// 확인이 필요한 사항 한 문항 — 번호 + 굵은 질문 → 회색 한 줄(왜 묻는지) → 답변 칸.
// 칸에 들어가는 것은 둘이다: 고객이 직접 적은 답('고객 답변', §7.2.13)과 담당자가 상담 뒤 적은 '확인 결과'. 둘 다 있으면 위아래로 둔다
// (고객이 "잘 모르겠다"고 적어도 확정은 담당자의 확인 결과다 — 누가 적었는지 섞지 않는다).
// 둘 다 없으면 빈 칸(인쇄해서 적어 오거나 상담에서 채운다) — 장에 남는 높이는 문항이 고르게 나눠 갖고 빈 칸이 그만큼 커진다
// (한도 110 — 문항이 하나뿐인 장에서 칸만 커지지 않게). 글이 적힌 칸은 글 높이 그대로다.
// answerable = 화면에서 고객이 답할 수 있다 — 확인 결과가 적히기 전인 문항의 칸에 '답변하기 / 고치기' 단추(출력물엔 없다).
const props = defineProps<{ item: DeckQuestion; answerable?: boolean }>();
const emit = defineEmits<{ answer: [] }>();

const empty = computed(() => props.item.answer === '' && props.item.resolution === '');
const canAnswer = computed(() => props.answerable && props.item.resolution === '');
const BOX = 'flex gap-[12px] rounded-[4px] border px-[16px] py-[12px] text-[16px] leading-[1.55]';
const BTN =
  'flex h-[30px] shrink-0 items-center self-start rounded-[6px] border border-line-2 bg-white px-[10px] text-[14px] leading-[1.3] text-[#141e34] transition-colors hover:bg-brand-50';
</script>

<template>
  <div class="flex flex-col" :class="empty ? 'flex-1' : ''" :data-question="item.qid">
    <p class="flex gap-[10px] text-[20px] font-bold leading-[1.4]">
      <span class="shrink-0 tabular-nums">{{ item.no }}.</span><span class="min-w-0">{{ item.question }}</span>
    </p>
    <p v-if="item.why !== ''" class="mt-[4px] text-[15px] leading-[1.5] text-tx-2">{{ item.why }}</p>
    <p v-if="item.answer !== ''" class="mt-[10px] border-line-2" :class="BOX" data-deck="answer">
      <span class="shrink-0 font-bold text-[#3b4558]">고객 답변</span>
      <span class="min-w-0 flex-1 whitespace-pre-line">{{ item.answer }}</span>
      <button v-if="canAnswer" type="button" :class="BTN" data-deck="answer-open" @click="emit('answer')">고치기</button>
    </p>
    <p v-if="item.resolution !== ''" class="border-brand-200 bg-brand-50" :class="[BOX, item.answer !== '' ? 'mt-[8px]' : 'mt-[10px]']" data-deck="resolution">
      <span class="shrink-0 font-bold text-brand-600">확인 결과</span>
      <span class="min-w-0 whitespace-pre-line">{{ item.resolution }}</span>
    </p>
    <p v-if="empty" class="mt-[10px] max-h-[110px] min-h-[50px] flex-1 border-line-2" :class="BOX">
      <span class="shrink-0 text-tx-3">답변</span>
      <span class="min-w-0 flex-1" />
      <button v-if="canAnswer" type="button" :class="BTN" data-deck="answer-open" @click="emit('answer')">답변하기</button>
    </p>
  </div>
</template>
