<script setup lang="ts">
import { slotKey } from '../../composables/useRequestWizardForm';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import QuestionField from './QuestionField.vue';

// 스텝 2 — 몇 가지만 더(docs/AI_DEV_REVIEW.md §13.4): 공통 4문항 + 선택 분야마다 카드 하나
// [분야별 질문 · 희망 개발툴·언어("전문가 추천"이 기본, 접힘) · 추가자료 슬롯]. 카드는 레지스트리
// 데이터로만 그린다 — 분야가 늘어도 이 컴포넌트는 안 바뀐다. 전부 선택 사항이다.
const props = defineProps<{ form: RequestWizardForm }>();
const {
  commonQuestions,
  areaDefs,
  stateOf,
  toggleChoice,
  noteMissingCodes,
  tools,
  toggleTool,
  clearTools,
  isRecommended,
  slotFiles,
  pickSlotFiles,
} = props.form;

const slotCount = (area: string, slot: string): number => slotFiles[slotKey(area, slot)]?.length ?? 0;
</script>

<template>
  <div class="grid gap-6">
    <!-- 공통 질문 4문항 -->
    <div class="grid gap-4 rounded-2xl bg-paper p-4">
      <p class="text-xs font-bold text-tx-2">
        몇 가지만 더 알려주세요 <span class="font-normal text-tx-3">(전부 선택 — 모르면 '잘 모르겠어요')</span>
      </p>
      <QuestionField
        v-for="q in commonQuestions"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />
    </div>

    <!-- 분야별 카드 -->
    <div v-for="area in areaDefs" :key="area.code" class="grid gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-tx-3">{{ area.code.toUpperCase() }}</p>
        <p class="text-sm font-extrabold text-tx-1">{{ area.label }}</p>
        <p class="text-[11px] text-tx-3">{{ area.hint }}</p>
      </div>

      <!-- 분야별 질문(있을 때만) -->
      <QuestionField
        v-for="q in area.questions"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />

      <!-- 희망 툴·언어 — 전문가 추천 기본 -->
      <details class="group rounded-xl border border-line bg-paper" :open="!isRecommended(area.code)">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs">
          <span class="font-bold text-tx-2">{{ area.tools.label }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-bold"
            :class="isRecommended(area.code) ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-900 text-white'"
          >
            {{ isRecommended(area.code) ? '전문가 추천' : `${(tools[area.code] ?? []).length}개 지정` }}
          </span>
          <span class="ml-auto text-[11px] text-tx-3">기존 프로젝트와 맞춰야 하면 펼쳐서 지정하세요</span>
        </summary>
        <div class="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-3">
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="isRecommended(area.code) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line bg-white text-tx-2 hover:border-line-2'"
            @click="clearTools(area.code)"
          >
            전문가 추천
          </button>
          <button
            v-for="opt in area.tools.options"
            :key="opt.code"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="(tools[area.code] ?? []).includes(opt.code) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-tx-2 hover:border-line-2'"
            @click="toggleTool(area.code, opt.code)"
          >
            {{ opt.label }}
          </button>
        </div>
      </details>

      <!-- 추가자료 슬롯 -->
      <div>
        <p class="text-xs font-bold text-tx-2">
          {{ area.short }} 관련 자료 <span class="font-normal text-tx-3">(있는 것만 · 없으면 전문가 검토 후 보완)</span>
        </p>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <label
            v-for="slot in area.attachmentSlots"
            :key="slot.code"
            class="grid gap-1 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs"
            :class="slotCount(area.code, slot.code) > 0 ? 'border-ink-900 bg-white' : 'bg-paper'"
          >
            <span class="font-bold text-tx-1">
              {{ slot.label }}
              <span v-if="slotCount(area.code, slot.code) > 0" class="ml-1 rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] text-white">
                {{ slotCount(area.code, slot.code) }}개
              </span>
            </span>
            <span class="font-normal text-tx-3">{{ slot.hint }}</span>
            <input type="file" multiple class="mt-1 text-xs font-normal" @change="pickSlotFiles(area.code, slot.code, $event)">
          </label>
        </div>
      </div>
    </div>

    <p class="rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-relaxed text-blue-900">
      기술 사항은 묻지 않습니다 — 통신 방식·MCU·기판 층수·서버 구조는 사용 목적을 기준으로 AI 검토서와 전문가가 제안합니다.
    </p>
  </div>
</template>
