<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { DEVELOP_AREA_CUSTOM_PREFIX, isTextQuestion } from '@sp/api-contract';
import type { MarketQuestionDef } from '@sp/api-contract';
import type { QuestionState } from '@sp/ui';
import { WIZ, chipClass } from '../../lib/wizard-copy';

// 질문 하나 — 공용 QuestionField(@sp/ui, 마켓 공용)와 동작이 같은 개발의뢰 위저드 전용 모양(피그마 01-3 135:21721·135:21815):
// 22px 질문 + (선택지형) 56px 알약 칩 / (서술형) 140px 흰 입력 상자. 문항 설명(why)은 시안처럼 질문 뒤 괄호로 붙인다.
// 메모 칸은 그 선택지를 고를 때만(noteVisibleFor). 마켓 화면은 공용 QuestionField 그대로다.
// 슬롯: badge = 질문 끝의 작은 표시(AI 질문·AI 가 채움), hint = 질문 바로 아래 한 줄(채운 답의 근거).
// '기타'(otherInline, 레지스트리 문항만) — 디자인 체크리스트(10-30, 피그마 259:25239~25252): 기타를 누르면 옆에 입력칸이 열리고,
// 입력을 마치면(Enter·칸 밖) 기타 칩이 적은 글로 바뀐다. 다시 누르면 고치고, 비우고 마치면 기타를 푼다(Esc 는 취소).
// 적은 글은 새 선택지 표기('~글')로 상태에 들고 저장할 때 'other' + 메모가 된다(developAreaStateToAnswer — AI 맞춤 질문의
// 새 선택지와 같은 길). 세부 정보 칸(notePlaceholder)은 기타와 따로 남는다 — 어떤 선택지를 골라도 견적에 필요한 값(전압·모델명 등).
const props = defineProps<{
  question: MarketQuestionDef;
  state: QuestionState;
  noteMissing: boolean;
  otherInline?: boolean;
}>();
const emit = defineEmits<{ toggle: [choice: string]; note: [value: string]; other: [text: string] }>();
const textKind = computed(() => isTextQuestion(props.question));
const noteVisible = computed(() => props.question.noteVisibleFor === undefined
  || props.question.noteVisibleFor.some((code) => props.state.choices.includes(code)));
const textPlaceholder = computed(() => `${props.question.notePlaceholder ?? ''} / 담당자 제안 필요`.replace(/^ \/ /, ''));
// 설명이 한 마디면 시안처럼 질문 뒤 괄호로, 문장 여럿이면(역설계 분해 허용 안내 등) 칩 아래 줄로 내린다 — 괄호가 질문을 덮지 않게.
const WHY_INLINE_MAX = 40;
const whyInline = computed(() => !textKind.value && (props.question.why?.length ?? 0) <= WHY_INLINE_MAX);

const OTHER = 'other';
const inlineOther = computed(() => props.otherInline && props.question.options.some((o) => o.code === OTHER));
// 기타는 맨 끝에 — 열린 입력칸이 마지막 줄의 남은 폭을 쓴다(체크리스트 목업 259:25264 도 '잘 모르겠음' 뒤에 기타).
const chipOptions = computed(() =>
  inlineOther.value
    ? [...props.question.options.filter((o) => o.code !== OTHER), ...props.question.options.filter((o) => o.code === OTHER)]
    : props.question.options,
);
// 고객이 기타에 적은 글 — 상태의 새 선택지 표기 중 선택지 목록에 없는 것(AI 가 낸 새 선택지는 목록에 있어 따로 칩이 된다).
const customText = computed(() =>
  props.state.choices
    .filter((c) => c.startsWith(DEVELOP_AREA_CUSTOM_PREFIX) && !props.question.options.some((o) => o.code === c))
    .map((c) => c.slice(DEVELOP_AREA_CUSTOM_PREFIX.length))
    .join(', '),
);
const otherOn = computed(() => customText.value !== '' || props.state.choices.includes(OTHER));
const editing = ref(false);
const draft = ref('');
let otherInput: HTMLInputElement | null = null;
let otherChip: HTMLButtonElement | null = null;
const setOtherInput = (el: unknown): void => {
  otherInput = el instanceof HTMLInputElement ? el : null;
};
const setOtherChip = (el: unknown): void => {
  otherChip = el instanceof HTMLButtonElement ? el : null;
};
async function startOther(): Promise<void> {
  draft.value = customText.value;
  editing.value = true;
  await nextTick();
  otherInput?.focus();
}
function commitOther(): void {
  if (!editing.value) return;
  editing.value = false;
  const text = draft.value.trim();
  // 그대로면 알리지 않는다 — 단, 글 없이 기타만 골라 둔 상태(옛 저장분)를 비우고 마치면 푼다.
  if (text === customText.value && (text !== '' || !props.state.choices.includes(OTHER))) return;
  emit('other', text);
}
function cancelOther(): void {
  editing.value = false;
  otherChip?.focus();
}
// 입력 중에 기타 칩을 누르면 마침 — 칸의 blur 가 먼저 마치고 클릭이 다시 여는 일이 없게 mousedown 기본 동작(포커스 이동)을 막는다.
function onOtherChipDown(e: MouseEvent): void {
  if (editing.value) e.preventDefault();
}
function onOtherChipClick(): void {
  if (editing.value) commitOther();
  else void startOther();
}
</script>

<template>
  <div class="flex flex-col gap-[16px] sm:gap-[20px]">
    <p :class="WIZ.sectionTitle">
      {{ question.label }}
      <span v-if="question.why !== undefined && whyInline">({{ question.why }})</span>
      <span v-if="question.required" class="text-red-500">*</span>
      <span v-if="question.multi && !textKind" class="text-[#999]"> (여러 개 가능)</span>
      <slot name="badge" />
    </p>
    <slot name="hint" />
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
      <template v-for="opt in chipOptions" :key="opt.code">
        <template v-if="inlineOther && opt.code === OTHER">
          <button
            :ref="setOtherChip"
            type="button"
            class="min-w-[100px] max-w-full [overflow-wrap:anywhere]"
            :class="chipClass(editing || otherOn)"
            :aria-pressed="otherOn"
            :aria-expanded="editing"
            @mousedown="onOtherChipDown"
            @click="onOtherChipClick"
          >
            {{ customText !== '' && !editing ? customText : opt.label }}
          </button>
          <input
            v-if="editing"
            :ref="setOtherInput"
            v-model="draft"
            type="text"
            maxlength="100"
            placeholder="내용을 입력해 주세요."
            :aria-label="`${question.short} 기타 내용`"
            class="min-w-0 flex-1 basis-[240px]"
            :class="WIZ.pillInput"
            @keydown.enter.prevent="commitOther"
            @keydown.esc.prevent="cancelOther"
            @blur="commitOther"
          >
        </template>
        <button
          v-else
          type="button"
          :class="chipClass(state.choices.includes(opt.code))"
          :aria-pressed="state.choices.includes(opt.code)"
          @click="emit('toggle', opt.code)"
        >
          {{ opt.label }}
        </button>
      </template>
    </div>
    <p v-if="question.why !== undefined && !whyInline" class="text-[15px] font-normal leading-[1.8] text-[#888]">{{ question.why }}</p>
    <label v-if="!textKind && noteVisible && question.notePlaceholder !== undefined" class="flex flex-col gap-[6px]">
      <input
        :value="state.note"
        type="text"
        :placeholder="question.notePlaceholder"
        maxlength="500"
        class="w-full focus:border-[#2945e8]"
        :class="[WIZ.pillInput, noteMissing ? 'border-red-400' : '']"
        @input="emit('note', ($event.target as HTMLInputElement).value)"
      >
      <span v-if="noteMissing" class="text-[15px] font-semibold text-red-500">이 선택지는 내용을 적어 주셔야 합니다.</span>
    </label>
  </div>
</template>
