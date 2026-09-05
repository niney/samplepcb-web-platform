<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEV_REVIEW_GENERAL_AREA,
  devReviewScheduleFit,
  devReviewScheduleTotals,
  marketAreaLabel,
} from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import {
  DEVELOP_REVIEW_LIMITS,
  cloneDevelopReview,
  emptyDevelopSchedule,
  emptyDevelopSchedulePhase,
} from './develop-review-edit';

// 검토서 작업본 구조 편집기 — 요약·핵심 요구사항·분야별 명세/관찰·상의 항목(확인 결과)·담당자 의견.
// 로컬 상태는 서버 응답의 **복사본**이다(같은 객체를 참조하면 미리보기가 저장 전 값으로 튄다).
// 재시드는 seedKey 가 바뀔 때만 — 폴링 재조회가 편집 중인 내용을 지우면 안 된다.
// `evidence`(근거)와 `checks`(답변↔자료 정합)는 AI 산출 사실이라 표시만 한다.
const props = defineProps<{ source: MarketDevReviewType; seedKey: string; disabled: boolean }>();
const emit = defineEmits<{ update: [review: MarketDevReviewType, dirty: boolean] }>();

const { t } = useI18n();
const L = DEVELOP_REVIEW_LIMITS;

const local = ref(cloneDevelopReview(props.source));
const seedJson = ref(JSON.stringify(local.value));

watch(
  () => props.seedKey,
  () => {
    local.value = cloneDevelopReview(props.source);
    seedJson.value = JSON.stringify(local.value);
    emit('update', local.value, false);
  },
);

watch(
  local,
  (value) => {
    emit('update', value, JSON.stringify(value) !== seedJson.value);
  },
  { deep: true, immediate: true },
);

const areaTitle = (area: string): string =>
  area === DEV_REVIEW_GENERAL_AREA ? t('admin.devReview.generalArea') : marketAreaLabel(area);

const addRequirement = (): void => {
  if (local.value.requirements.length >= L.requirements) return;
  local.value.requirements.push({ text: '', evidence: null });
};
const addSpec = (index: number): void => {
  const area = local.value.areas[index];
  if (area === undefined || area.spec.length >= L.spec) return;
  area.spec.push({ item: '', text: '', evidence: null });
};
const addObservation = (index: number): void => {
  const area = local.value.areas[index];
  if (area === undefined || area.observations.length >= L.observations) return;
  area.observations.push({ text: '', evidence: null });
};
const addQuestion = (): void => {
  if (local.value.openQuestions.length >= L.openQuestions) return;
  local.value.openQuestions.push({ question: '', why: '', area: DEV_REVIEW_GENERAL_AREA, resolution: null });
};

// ── 개발 일정(예상) ──────────────────────────────────────────────────────────
// 합계·희망 시점 대조는 계약의 순수 함수로 매 입력마다 다시 낸다(저장값이 아니다).
const schedulePhases = computed(() => local.value.schedule?.phases ?? []);
const scheduleTotals = computed(() => devReviewScheduleTotals(local.value.schedule));
const scheduleFit = computed(() => devReviewScheduleFit(local.value.schedule));
const FIT_CLASS = {
  ok: 'text-emerald-700',
  tight: 'text-amber-700',
  over: 'text-red-600',
  unknown: 'text-gray-500',
} as const;

// 일정이 없을 때 '단계 추가'는 빈 일정을 만든다(wishCode 는 고객 답변에서 온다).
const addSchedulePhase = (): void => {
  const schedule = local.value.schedule;
  if (schedule === null || schedule === undefined) {
    local.value.schedule = emptyDevelopSchedule(local.value);
    return;
  }
  if (schedule.phases.length >= L.schedulePhases) return;
  schedule.phases.push(emptyDevelopSchedulePhase());
};

const moveSchedulePhase = (index: number, delta: number): void => {
  const rows = local.value.schedule?.phases;
  if (rows === undefined) return;
  const next = index + delta;
  const from = rows[index];
  const to = rows[next];
  if (from === undefined || to === undefined) return;
  rows[index] = to;
  rows[next] = from;
};

// 주 입력 — 비우면 0 이 되고 저장 전 검사(1~104)가 잡는다. 조용히 1 로 되돌리면 관리자가 못 알아챈다.
const setWeeks = (index: number, key: 'minWeeks' | 'maxWeeks', raw: string): void => {
  const row = local.value.schedule?.phases[index];
  if (row === undefined) return;
  const n = Number.parseInt(raw, 10);
  row[key] = Number.isFinite(n) ? n : 0;
};

const confirmScheduleClear = ref(false);
const clearSchedule = (): void => {
  local.value.schedule = null;
  confirmScheduleClear.value = false;
};
</script>

<template>
  <fieldset class="grid gap-5" :disabled="props.disabled">
    <!-- 요약 -->
    <label class="grid gap-1 text-base">
      <span class="font-semibold text-gray-800">{{ t('admin.develop.editor.summary') }}</span>
      <textarea
        v-model="local.summary"
        rows="2"
        :maxlength="L.summaryLen"
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed disabled:bg-gray-50"
      />
    </label>

    <!-- 핵심 요구사항 -->
    <div class="grid gap-2">
      <div class="flex items-center gap-2">
        <span class="text-base font-semibold text-gray-800">{{ t('admin.develop.editor.requirements') }}</span>
        <span class="text-xs text-gray-400">{{ local.requirements.length }} / {{ L.requirements }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="local.requirements.length >= L.requirements"
          @click="addRequirement"
        >
          {{ t('admin.develop.editor.addRow') }}
        </button>
      </div>
      <div v-for="(row, i) in local.requirements" :key="`req-${i}`" class="grid gap-1 rounded-md border border-gray-100 p-2">
        <div class="flex items-start gap-2">
          <input
            v-model="row.text"
            type="text"
            :maxlength="L.factTextLen"
            :placeholder="t('admin.develop.editor.requirementPlaceholder')"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          >
          <button
            type="button"
            class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            @click="local.requirements.splice(i, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
        <p v-if="row.evidence !== null && row.evidence !== ''" class="text-xs text-gray-400">
          {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
        </p>
      </div>
      <p v-if="local.requirements.length === 0" class="text-sm text-gray-400">{{ t('admin.develop.editor.noRows') }}</p>
    </div>

    <!-- 분야별 검토 -->
    <div v-for="(area, ai) in local.areas" :key="`area-${area.area}-${ai}`" class="grid gap-3 rounded-lg border border-gray-200 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{{ areaTitle(area.area) }}</span>
      </div>
      <label class="grid gap-1 text-base">
        <span class="text-sm font-semibold text-gray-600">{{ t('admin.develop.editor.areaSummary') }}</span>
        <input v-model="area.summary" type="text" :maxlength="L.areaSummaryLen" class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
      </label>

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-600">{{ t('admin.develop.editor.spec') }}</span>
          <span class="text-xs text-gray-400">{{ area.spec.length }} / {{ L.spec }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="area.spec.length >= L.spec"
            @click="addSpec(ai)"
          >
            {{ t('admin.develop.editor.addRow') }}
          </button>
        </div>
        <div v-for="(row, si) in area.spec" :key="`spec-${si}`" class="grid gap-1 rounded-md border border-gray-100 p-2">
          <div class="flex items-start gap-2">
            <input
              v-model="row.item"
              type="text"
              :maxlength="L.specItemLen"
              :placeholder="t('admin.develop.editor.specItemPlaceholder')"
              class="w-32 shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
            <input
              v-model="row.text"
              type="text"
              :maxlength="L.factTextLen"
              :placeholder="t('admin.develop.editor.specTextPlaceholder')"
              class="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
            <button
              type="button"
              class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
              @click="area.spec.splice(si, 1)"
            >
              {{ t('admin.develop.editor.removeRow') }}
            </button>
          </div>
          <p v-if="row.evidence !== null && row.evidence !== ''" class="text-xs text-gray-400">
            {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
          </p>
        </div>
      </div>

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-600">{{ t('admin.develop.editor.observations') }}</span>
          <span class="text-xs text-gray-400">{{ area.observations.length }} / {{ L.observations }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="area.observations.length >= L.observations"
            @click="addObservation(ai)"
          >
            {{ t('admin.develop.editor.addRow') }}
          </button>
        </div>
        <div v-for="(row, oi) in area.observations" :key="`obs-${oi}`" class="flex items-start gap-2">
          <input
            v-model="row.text"
            type="text"
            :maxlength="L.factTextLen"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          >
          <button
            type="button"
            class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            @click="area.observations.splice(oi, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 개발 일정(예상) — 검토서의 일정은 예상이고, 확정 기간은 견적서가 정한다(docs/DEVELOP_FLOW.md §6) -->
    <div class="grid gap-2 rounded-lg border border-gray-200 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base font-semibold text-gray-800">{{ t('admin.develop.review.schedule.title') }}</span>
        <span class="text-xs text-gray-400">{{ schedulePhases.length }} / {{ L.schedulePhases }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="schedulePhases.length >= L.schedulePhases"
          @click="addSchedulePhase"
        >
          {{ t('admin.develop.review.schedule.addPhase') }}
        </button>
        <button
          v-if="local.schedule !== null && local.schedule !== undefined && !confirmScheduleClear"
          type="button"
          class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
          @click="confirmScheduleClear = true"
        >
          {{ t('admin.develop.review.schedule.clear') }}
        </button>
      </div>

      <p class="text-xs text-gray-500">{{ t('admin.develop.review.schedule.hint') }}</p>

      <!-- 통째 삭제 인라인 확인(네이티브 confirm 금지) -->
      <div v-if="confirmScheduleClear" class="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2">
        <span class="text-xs font-bold text-red-800">{{ t('admin.develop.review.schedule.clearConfirm') }}</span>
        <button type="button" class="rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700" @click="clearSchedule">
          {{ t('admin.develop.review.schedule.clearYes') }}
        </button>
        <button type="button" class="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-600" @click="confirmScheduleClear = false">
          {{ t('admin.develop.cancel') }}
        </button>
      </div>

      <div v-for="(phase, pi) in schedulePhases" :key="`phase-${pi}`" class="grid gap-1.5 rounded-md border border-gray-100 p-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="w-5 text-xs font-bold text-gray-400">{{ pi + 1 }}</span>
          <input
            v-model="phase.name"
            type="text"
            :maxlength="L.schedulePhaseNameLen"
            :placeholder="t('admin.develop.review.schedule.namePlaceholder')"
            class="h-9 min-w-32 flex-1 rounded-md border border-gray-300 px-2.5 text-sm"
          >
          <label class="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="number"
              min="1"
              :max="L.scheduleWeeksMax"
              :value="phase.minWeeks"
              class="h-9 w-16 rounded-md border border-gray-300 px-2 text-sm"
              @input="setWeeks(pi, 'minWeeks', ($event.target as HTMLInputElement).value)"
            >
            ~
            <input
              type="number"
              min="1"
              :max="L.scheduleWeeksMax"
              :value="phase.maxWeeks"
              class="h-9 w-16 rounded-md border border-gray-300 px-2 text-sm"
              @input="setWeeks(pi, 'maxWeeks', ($event.target as HTMLInputElement).value)"
            >
            {{ t('admin.develop.review.schedule.weeks') }}
          </label>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            :disabled="pi === 0"
            @click="moveSchedulePhase(pi, -1)"
          >
            {{ t('admin.develop.review.schedule.moveUp') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            :disabled="pi === schedulePhases.length - 1"
            @click="moveSchedulePhase(pi, 1)"
          >
            {{ t('admin.develop.review.schedule.moveDown') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            @click="schedulePhases.splice(pi, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
        <div class="grid gap-1.5 sm:grid-cols-3">
          <input
            v-model="phase.output"
            type="text"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.outputPlaceholder')"
            class="h-9 w-full min-w-0 rounded-md border border-gray-200 px-2.5 text-xs"
          >
          <input
            v-model="phase.prerequisite"
            type="text"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.prerequisitePlaceholder')"
            class="h-9 w-full min-w-0 rounded-md border border-gray-200 px-2.5 text-xs"
          >
          <input
            v-model="phase.note"
            type="text"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.notePlaceholder')"
            class="h-9 w-full min-w-0 rounded-md border border-gray-200 px-2.5 text-xs"
          >
        </div>
      </div>

      <p v-if="schedulePhases.length === 0" class="text-sm text-gray-400">{{ t('admin.develop.review.schedule.empty') }}</p>

      <template v-if="local.schedule !== null && local.schedule !== undefined && schedulePhases.length > 0">
        <label class="grid gap-1">
          <span class="text-sm font-semibold text-gray-600">{{ t('admin.develop.review.schedule.assumptions') }}</span>
          <input
            v-model="local.schedule.assumptions"
            type="text"
            :maxlength="L.scheduleAssumptionsLen"
            :placeholder="t('admin.develop.review.schedule.assumptionsPlaceholder')"
            class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
          >
        </label>
        <p class="text-sm font-semibold text-gray-700">
          {{ t('admin.develop.review.schedule.total', { min: scheduleTotals.minWeeks, max: scheduleTotals.maxWeeks }) }}
        </p>
        <p class="text-xs font-semibold" :class="FIT_CLASS[scheduleFit.status]">{{ scheduleFit.text }}</p>
      </template>
    </div>

    <!-- 상의 항목 + 확인 결과 -->
    <div class="grid gap-2">
      <div class="flex items-center gap-2">
        <span class="text-base font-semibold text-gray-800">{{ t('admin.develop.editor.openQuestions') }}</span>
        <span class="text-xs text-gray-400">{{ local.openQuestions.length }} / {{ L.openQuestions }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="local.openQuestions.length >= L.openQuestions"
          @click="addQuestion"
        >
          {{ t('admin.develop.editor.addRow') }}
        </button>
      </div>
      <div v-for="(row, qi) in local.openQuestions" :key="`q-${qi}`" class="grid gap-1.5 rounded-md border border-amber-100 bg-amber-50/30 p-2">
        <div class="flex items-start gap-2">
          <span class="mt-1.5 shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-amber-700">{{ areaTitle(row.area) }}</span>
          <input
            v-model="row.question"
            type="text"
            :maxlength="L.questionLen"
            :placeholder="t('admin.develop.editor.questionPlaceholder')"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          >
          <button
            type="button"
            class="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            @click="local.openQuestions.splice(qi, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
        <input
          v-model="row.why"
          type="text"
          :maxlength="L.whyLen"
          :placeholder="t('admin.develop.editor.whyPlaceholder')"
          class="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs"
        >
        <textarea
          v-model="row.resolution"
          rows="2"
          :maxlength="L.resolutionLen"
          :placeholder="t('admin.develop.editor.resolutionPlaceholder')"
          class="w-full rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs leading-relaxed"
        />
      </div>
      <p v-if="local.openQuestions.length === 0" class="text-sm text-gray-400">{{ t('admin.develop.editor.noRows') }}</p>
    </div>

    <!-- 답변↔자료 정합(표시만) -->
    <div v-if="local.checks.length > 0" class="grid gap-1 rounded-md border border-gray-100 bg-gray-50/60 p-3">
      <span class="text-sm font-semibold text-gray-600">{{ t('admin.devReview.check') }}</span>
      <p v-for="(c, ci) in local.checks" :key="`chk-${ci}`" class="text-sm text-gray-600">{{ c.text }}</p>
    </div>

    <!-- 담당자 의견 -->
    <label class="grid gap-1 text-base">
      <span class="font-semibold text-gray-800">{{ t('admin.develop.editor.adminComment') }}</span>
      <textarea
        v-model="local.adminComment"
        rows="4"
        :maxlength="L.adminCommentLen"
        :placeholder="t('admin.develop.editor.adminCommentPlaceholder')"
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
      />
      <span class="text-xs text-gray-500">{{ t('admin.develop.editor.adminCommentHint') }}</span>
    </label>
  </fieldset>
</template>
