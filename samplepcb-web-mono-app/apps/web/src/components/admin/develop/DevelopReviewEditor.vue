<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEV_REVIEW_GENERAL_AREA, marketAreaLabel } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { DEVELOP_REVIEW_LIMITS, cloneDevelopReview } from './develop-review-edit';

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
</script>

<template>
  <fieldset class="grid gap-5" :disabled="props.disabled">
    <!-- 요약 -->
    <label class="grid gap-1 text-sm">
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
        <span class="text-sm font-semibold text-gray-800">{{ t('admin.develop.editor.requirements') }}</span>
        <span class="text-[11px] text-gray-400">{{ local.requirements.length }} / {{ L.requirements }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
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
            class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
            @click="local.requirements.splice(i, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
        <p v-if="row.evidence !== null && row.evidence !== ''" class="text-[11px] text-gray-400">
          {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
        </p>
      </div>
      <p v-if="local.requirements.length === 0" class="text-xs text-gray-400">{{ t('admin.develop.editor.noRows') }}</p>
    </div>

    <!-- 분야별 검토 -->
    <div v-for="(area, ai) in local.areas" :key="`area-${area.area}-${ai}`" class="grid gap-3 rounded-lg border border-gray-200 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{{ areaTitle(area.area) }}</span>
      </div>
      <label class="grid gap-1 text-sm">
        <span class="text-xs font-semibold text-gray-600">{{ t('admin.develop.editor.areaSummary') }}</span>
        <input v-model="area.summary" type="text" :maxlength="L.areaSummaryLen" class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
      </label>

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-600">{{ t('admin.develop.editor.spec') }}</span>
          <span class="text-[11px] text-gray-400">{{ area.spec.length }} / {{ L.spec }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
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
              class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
              @click="area.spec.splice(si, 1)"
            >
              {{ t('admin.develop.editor.removeRow') }}
            </button>
          </div>
          <p v-if="row.evidence !== null && row.evidence !== ''" class="text-[11px] text-gray-400">
            {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
          </p>
        </div>
      </div>

      <div class="grid gap-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-600">{{ t('admin.develop.editor.observations') }}</span>
          <span class="text-[11px] text-gray-400">{{ area.observations.length }} / {{ L.observations }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
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
            class="shrink-0 rounded-md border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
            @click="area.observations.splice(oi, 1)"
          >
            {{ t('admin.develop.editor.removeRow') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 상의 항목 + 확인 결과 -->
    <div class="grid gap-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-gray-800">{{ t('admin.develop.editor.openQuestions') }}</span>
        <span class="text-[11px] text-gray-400">{{ local.openQuestions.length }} / {{ L.openQuestions }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="local.openQuestions.length >= L.openQuestions"
          @click="addQuestion"
        >
          {{ t('admin.develop.editor.addRow') }}
        </button>
      </div>
      <div v-for="(row, qi) in local.openQuestions" :key="`q-${qi}`" class="grid gap-1.5 rounded-md border border-amber-100 bg-amber-50/30 p-2">
        <div class="flex items-start gap-2">
          <span class="mt-1.5 shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-amber-700">{{ areaTitle(row.area) }}</span>
          <input
            v-model="row.question"
            type="text"
            :maxlength="L.questionLen"
            :placeholder="t('admin.develop.editor.questionPlaceholder')"
            class="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          >
          <button
            type="button"
            class="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
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
      <p v-if="local.openQuestions.length === 0" class="text-xs text-gray-400">{{ t('admin.develop.editor.noRows') }}</p>
    </div>

    <!-- 답변↔자료 정합(표시만) -->
    <div v-if="local.checks.length > 0" class="grid gap-1 rounded-md border border-gray-100 bg-gray-50/60 p-3">
      <span class="text-xs font-semibold text-gray-600">{{ t('admin.devReview.check') }}</span>
      <p v-for="(c, ci) in local.checks" :key="`chk-${ci}`" class="text-xs text-gray-600">{{ c.text }}</p>
    </div>

    <!-- 담당자 의견 -->
    <label class="grid gap-1 text-sm">
      <span class="font-semibold text-gray-800">{{ t('admin.develop.editor.adminComment') }}</span>
      <textarea
        v-model="local.adminComment"
        rows="4"
        :maxlength="L.adminCommentLen"
        :placeholder="t('admin.develop.editor.adminCommentPlaceholder')"
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
      />
      <span class="text-[11px] text-gray-500">{{ t('admin.develop.editor.adminCommentHint') }}</span>
    </label>
  </fieldset>
</template>
