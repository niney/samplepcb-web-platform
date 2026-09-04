<script setup lang="ts">
import { MARKET_UNKNOWN_CHOICE } from '@sp/api-contract';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { QuestionState } from '../../composables/useRequestWizardForm';

// 질문 하나(칩 선택 + 메모) — 공통 4문항과 분야별 질문이 같은 모양이라 하나로 그린다.
// '잘 모르겠어요' 는 점선 칩으로 구분해 탈출구임을 보인다(모름은 검토서의 상의 항목으로 흐른다).
defineProps<{
  question: MarketQuestionDef;
  state: QuestionState;
  noteMissing: boolean;
}>();
const emit = defineEmits<{ toggle: [choice: string]; note: [value: string] }>();
const unknown = MARKET_UNKNOWN_CHOICE;
</script>

<template>
  <div class="grid gap-1.5">
    <p class="text-xs font-semibold text-tx-2">
      {{ question.label }}
      <span v-if="question.multi" class="font-normal text-tx-3">(여러 개 가능)</span>
    </p>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="opt in question.options"
        :key="opt.code"
        type="button"
        class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
        :class="[
          state.choices.includes(opt.code)
            ? opt.code === unknown
              ? 'border-tx-3 bg-tx-3 text-white'
              : 'border-ink-900 bg-ink-900 text-white'
            : opt.code === unknown
              ? 'border-dashed border-line-2 bg-white text-tx-3 hover:border-tx-3'
              : 'border-line bg-white text-tx-2 hover:border-line-2',
        ]"
        @click="emit('toggle', opt.code)"
      >
        {{ opt.label }}
      </button>
    </div>
    <label v-if="question.notePlaceholder !== undefined" class="grid gap-1">
      <input
        :value="state.note"
        type="text"
        :placeholder="question.notePlaceholder"
        maxlength="500"
        class="h-9 rounded-lg border bg-white px-3 text-xs font-normal"
        :class="noteMissing ? 'border-red-400' : 'border-line'"
        @input="emit('note', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="noteMissing" class="text-[11px] font-semibold text-red-500">
        이 선택지는 내용을 적어 주셔야 합니다.
      </span>
    </label>
  </div>
</template>
