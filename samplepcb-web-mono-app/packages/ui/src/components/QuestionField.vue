<script setup lang="ts">
import { MARKET_UNKNOWN_CHOICE } from '@sp/api-contract';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { QuestionState } from '../types';

// 질문 하나(칩 선택 + "왜 묻나요" 한 줄 + 메모) — 공통 조건·공통 질문·분야 맞춤 질문이 같은 모양이라 하나로 그린다.
// 탈출구(코드 unknown, 라벨은 문항마다 "잘 모르겠어요"·"전문가 추천"·"협의해서 정할게요")는 점선 칩으로
// 구분한다(모름은 검토서의 상의 항목으로 흐른다). required 문항은 * 표시 — 미응답이면 2스텝 "다음"이 막힌다.
// 크기는 style.css 타입 스케일(text-label 13 · text-body 14)만 쓴다(§13.9).
defineProps<{
  question: MarketQuestionDef;
  state: QuestionState;
  noteMissing: boolean;
}>();
const emit = defineEmits<{ toggle: [choice: string]; note: [value: string] }>();
const unknown = MARKET_UNKNOWN_CHOICE;
</script>

<template>
  <div class="grid gap-2">
    <p class="text-label font-semibold text-tx-2">
      {{ question.label }}
      <span v-if="question.required" class="text-red-500">*</span>
      <span v-if="question.multi" class="font-normal text-tx-3">(여러 개 가능)</span>
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="opt in question.options"
        :key="opt.code"
        type="button"
        class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
        :class="[
          state.choices.includes(opt.code)
            ? opt.code === unknown
              ? 'border-tx-3 bg-tx-3 text-white'
              : 'border-ink-900 bg-ink-900 text-white'
            : opt.code === unknown
              ? 'border-dashed border-line-2 bg-white text-tx-3 hover:border-tx-3'
              : 'border-line-2 bg-white text-tx-2 hover:border-tx-3',
        ]"
        @click="emit('toggle', opt.code)"
      >
        {{ opt.label }}
      </button>
    </div>
    <p v-if="question.why !== undefined" class="text-label text-tx-3">{{ question.why }}</p>
    <label v-if="question.notePlaceholder !== undefined" class="grid gap-1">
      <input
        :value="state.note"
        type="text"
        :placeholder="question.notePlaceholder"
        maxlength="500"
        class="h-10 rounded-lg border bg-white px-3 text-body font-normal"
        :class="noteMissing ? 'border-red-400' : 'border-line-2'"
        @input="emit('note', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="noteMissing" class="text-label font-semibold text-red-500">
        이 선택지는 내용을 적어 주셔야 합니다.
      </span>
    </label>
  </div>
</template>
