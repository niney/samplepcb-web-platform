<script setup lang="ts">
import { DEV_REVIEW_QUESTIONS, DEV_REVIEW_UNKNOWN_CHOICE } from '@sp/api-contract';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';

// 스텝 2 — 고정 9문항 한 화면(docs/AI_DEV_REVIEW.md §2). AI 호출 없음.
// 전 문항 선택 사항이고 모든 문항에 "잘 모르겠어요" 탈출구가 있다 — 모름은 검토서에서
// '확인 필요'로 흘러간다. 미응답 문항은 등록 payload 에서 아예 빠진다.
const props = defineProps<{ form: RequestWizardForm }>();
const { questionState, toggleChoice, noteMissingCodes } = props.form;

const unknown = DEV_REVIEW_UNKNOWN_CHOICE;
</script>

<template>
  <div class="grid gap-6">
    <p class="text-xs leading-relaxed text-tx-3">
      아는 것만 골라 주세요. 모르는 항목은 <b class="text-tx-2">잘 모르겠어요</b>를 고르면
      검토서에 <b class="text-tx-2">확인 필요</b>로 남아 전문가 상담에서 확정됩니다.
    </p>

    <div v-for="q in DEV_REVIEW_QUESTIONS" :key="q.code" class="grid gap-2">
      <p class="text-xs font-bold text-tx-2">
        {{ q.label }}
        <span v-if="q.multi" class="font-normal text-tx-3">(복수 선택)</span>
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="opt in q.options"
          :key="opt.code"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="[
            questionState[q.code].choices.includes(opt.code)
              ? opt.code === unknown
                ? 'border-tx-3 bg-tx-3 text-white'
                : 'border-ink-900 bg-ink-900 text-white'
              : opt.code === unknown
                ? 'border-dashed border-line-2 text-tx-3 hover:border-tx-3'
                : 'border-line text-tx-2 hover:border-line-2',
          ]"
          @click="toggleChoice(q.code, opt.code)"
        >
          {{ opt.label }}
        </button>
      </div>
      <label v-if="q.notePlaceholder !== undefined" class="grid gap-1">
        <input
          v-model="questionState[q.code].note"
          type="text"
          :placeholder="q.notePlaceholder"
          maxlength="500"
          class="h-9 rounded-lg border px-3 text-xs font-normal"
          :class="noteMissingCodes.includes(q.code) ? 'border-red-400' : 'border-line'"
        >
        <span v-if="noteMissingCodes.includes(q.code)" class="text-[11px] font-semibold text-red-500">
          이 선택지는 내용을 적어 주셔야 합니다.
        </span>
      </label>
    </div>
  </div>
</template>
