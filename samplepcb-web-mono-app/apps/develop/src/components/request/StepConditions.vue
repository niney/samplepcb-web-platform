<script setup lang="ts">
import { MARKET_BUDGET_RANGES, MARKET_BUDGET_RANGE_LABELS, MARKET_EXPERT_PICK_LABEL } from '@sp/api-contract';
import { AreaIcon, FileDropZone, QuestionField } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 2스텝 — 조건·질문(docs/DEVELOP_FLOW.md §7.2).
//   ① 프로젝트 조건(필수): 예산 + 공통 조건 3(완료 시점·목표 단계·인도 범위) + 비밀유지 계약 희망
//   ② 공통 질문 3(선택)  ③ 선택 분야마다 카드 [맞춤 질문 · 희망 툴(접힘, 기본 "전문가 추천") · 추가자료 슬롯]
// 수정 화면도 이 컴포넌트를 그대로 쓴다(슬롯 첨부는 수정에서 새 파일 추가로만 쓰이므로 prop 으로 끈다).
const props = withDefaults(defineProps<{ form: DevelopRequestForm; showSlots?: boolean }>(), { showSlots: true });
const {
  fields,
  conditionQuestions,
  conditionProgress,
  commonQuestions,
  areaDefs,
  areaQuestionsOf,
  stateOf,
  toggleChoice,
  noteMissingCodes,
  tools,
  toggleTool,
  clearTools,
  isRecommended,
  filesOfSlot,
  addSlotFiles,
  removeSlotFile,
} = props.form;

const budgetRanges = MARKET_BUDGET_RANGES;
const budgetLabels = MARKET_BUDGET_RANGE_LABELS;
</script>

<template>
  <div class="grid gap-7">
    <!-- ① 프로젝트 조건 — 이 화면에서 유일하게 테두리를 세우는 블록 -->
    <section class="grid gap-5 rounded-2xl border-2 border-ink-950 bg-white p-5 sm:p-6">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">프로젝트 조건</h2>
        <span class="rounded-full bg-ink-950 px-2.5 py-1 text-micro font-bold text-white">
          {{ conditionProgress.done }} / {{ conditionProgress.total }}
        </span>
        <span class="text-label text-tx-3">견적을 가르는 조건입니다 — 모르면 "협의해서 정할게요"</span>
      </div>

      <label class="grid gap-2">
        <span class="text-label font-semibold text-tx-2">예산은 어느 정도로 보고 계신가요? <span class="text-red-500">*</span></span>
        <select
          v-model="fields.budgetRange"
          class="h-11 rounded-lg border bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
          :class="fields.budgetRange === null ? 'border-line-2' : 'border-ink-900'"
        >
          <option :value="null" disabled>예산 구간을 골라 주세요</option>
          <option v-for="r in budgetRanges" :key="r" :value="r">{{ budgetLabels[r] }}</option>
        </select>
        <span class="text-label text-tx-3">정확한 금액이 아니라 구간입니다. 견적서에서 항목별로 다시 안내드립니다.</span>
      </label>

      <QuestionField
        v-for="q in conditionQuestions"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />

      <label class="flex items-start gap-3 rounded-xl bg-paper p-4">
        <input v-model="fields.ndaWanted" type="checkbox" class="mt-0.5 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]">
        <span class="grid gap-1">
          <span class="text-body font-bold text-tx-1">비밀유지 계약(NDA)을 맺고 싶습니다</span>
          <span class="text-label leading-relaxed text-tx-3">담당자가 계약서를 준비해 연락드립니다. 체크하지 않아도 자료는 외부에 공개되지 않습니다.</span>
        </span>
      </label>
    </section>

    <!-- ② 공통 질문 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">몇 가지만 더</h2>
        <span class="text-label text-tx-3">전부 선택 사항입니다</span>
      </div>
      <QuestionField
        v-for="q in commonQuestions"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />
    </section>

    <!-- ③ 분야별 -->
    <section v-for="area in areaDefs" :key="area.code" class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div class="flex items-center gap-3">
        <AreaIcon :code="area.code" size="sm" />
        <h2 class="text-title font-extrabold text-tx-1">{{ area.label }}</h2>
      </div>

      <QuestionField
        v-for="q in areaQuestionsOf(area.code)"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />

      <details class="rounded-xl border border-line bg-paper px-4 py-3">
        <summary class="cursor-pointer list-none text-label font-semibold text-tx-2">
          {{ area.tools.label }}
          <span class="ml-1.5 font-normal text-tx-3">
            {{ isRecommended(area.code) ? MARKET_EXPERT_PICK_LABEL : `${(tools[area.code] ?? []).length}개 선택` }} · 눌러서 펼치기
          </span>
        </summary>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="isRecommended(area.code) ? 'border-tx-3 bg-tx-3 text-white' : 'border-dashed border-line-2 bg-white text-tx-3 hover:border-tx-3'"
            @click="clearTools(area.code)"
          >
            {{ MARKET_EXPERT_PICK_LABEL }}
          </button>
          <button
            v-for="opt in area.tools.options"
            :key="opt.code"
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="(tools[area.code] ?? []).includes(opt.code) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 bg-white text-tx-2 hover:border-tx-3'"
            @click="toggleTool(area.code, opt.code)"
          >
            {{ opt.label }}
          </button>
        </div>
      </details>

      <div v-if="showSlots && area.attachmentSlots.length > 0" class="grid gap-2.5">
        <p class="text-label font-semibold text-tx-2">있으면 좋은 자료 <span class="font-normal text-tx-3">선택</span></p>
        <div class="grid gap-2.5 sm:grid-cols-2">
          <FileDropZone
            v-for="slot in area.attachmentSlots"
            :key="slot.code"
            :files="filesOfSlot(area.code, slot.code)"
            :label="slot.label"
            :hint="slot.hint"
            variant="slot"
            @add="addSlotFiles(area.code, slot.code, $event)"
            @remove="removeSlotFile(area.code, slot.code, $event)"
          />
        </div>
      </div>
    </section>
  </div>
</template>
