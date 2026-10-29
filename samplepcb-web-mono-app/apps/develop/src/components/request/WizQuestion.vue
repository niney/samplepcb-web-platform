<script setup lang="ts">
import { computed } from 'vue';
import { isTextQuestion } from '@sp/api-contract';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { QuestionState } from '@sp/ui';
import { WIZ, chipClass } from '../../lib/wizard-copy';

// 질문 하나 — 공용 QuestionField(@sp/ui, 마켓 공용)와 동작이 같은 개발의뢰 위저드 전용 모양(피그마 01-3 135:21721·135:21815):
// 22px 질문 + (선택지형) 56px 알약 칩 / (서술형) 140px 흰 입력 상자. 문항 설명(why)은 시안처럼 질문 뒤 괄호로 붙인다.
// 메모 칸은 그 선택지를 고를 때만(noteVisibleFor). 마켓 화면은 공용 QuestionField 그대로다.
const props = defineProps<{
  question: MarketQuestionDef;
  state: QuestionState;
  noteMissing: boolean;
}>();
const emit = defineEmits<{ toggle: [choice: string]; note: [value: string] }>();
const textKind = computed(() => isTextQuestion(props.question));
const noteVisible = computed(() => props.question.noteVisibleFor === undefined
  || props.question.noteVisibleFor.some((code) => props.state.choices.includes(code)));
const textPlaceholder = computed(() => `${props.question.notePlaceholder ?? ''} / 담당자 제안 필요`.replace(/^ \/ /, ''));
// 설명이 한 마디면 시안처럼 질문 뒤 괄호로, 문장 여럿이면(역설계 분해 허용 안내 등) 칩 아래 줄로 내린다 — 괄호가 질문을 덮지 않게.
const WHY_INLINE_MAX = 40;
const whyInline = computed(() => !textKind.value && (props.question.why?.length ?? 0) <= WHY_INLINE_MAX);
</script>

<template>
  <div class="flex flex-col gap-[16px] sm:gap-[26px]">
    <p :class="WIZ.sectionTitle">
      {{ question.label }}
      <span v-if="question.why !== undefined && whyInline">({{ question.why }})</span>
      <span v-if="question.required" class="text-red-500">*</span>
      <span v-if="question.multi && !textKind" class="text-[#999]"> (여러 개 가능)</span>
    </p>
    <textarea
      v-if="textKind"
      :value="state.note"
      rows="4"
      :placeholder="textPlaceholder"
      maxlength="2000"
      class="h-[140px] resize-y"
      :class="[WIZ.textarea, noteMissing ? 'border-red-400' : '']"
      @input="emit('note', ($event.target as HTMLTextAreaElement).value)"
    />
    <div v-else class="flex flex-wrap gap-[12px] sm:gap-[20px]">
      <button
        v-for="opt in question.options"
        :key="opt.code"
        type="button"
        :class="chipClass(state.choices.includes(opt.code))"
        :aria-pressed="state.choices.includes(opt.code)"
        @click="emit('toggle', opt.code)"
      >
        {{ opt.label }}
      </button>
    </div>
    <p v-if="question.why !== undefined && !whyInline" class="text-[15px] font-medium leading-[1.6] text-[#666]">{{ question.why }}</p>
    <label v-if="!textKind && noteVisible && question.notePlaceholder !== undefined" class="flex flex-col gap-[6px]">
      <input
        :value="state.note"
        type="text"
        :placeholder="question.notePlaceholder"
        maxlength="500"
        :class="[WIZ.input, noteMissing ? 'border-red-400' : '']"
        @input="emit('note', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="noteMissing" class="text-[15px] font-semibold text-red-500">이 선택지는 내용을 적어 주셔야 합니다.</span>
    </label>
  </div>
</template>
