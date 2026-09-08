<script setup lang="ts">
import { computed } from 'vue';
import {
  DEVELOP_BUDGET_RANGES,
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGES,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_TARGET_STAGES,
  DEVELOP_TARGET_STAGE_LABELS,
} from '@sp/api-contract';
import { FileDropZone } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 2스텝 — 의뢰 내용(2026-09-08 v2).
// 제목 · 개발 목적(≥10자) · 현재/목표 개발단계 · 희망 완료 시기(날짜 또는 자유문) · 예상 예산
// · 참고 자료 + AI 사전 검토 동의 · 비밀유지 계약 · (시스템개발일 때) 후속 질문 방식.
// 단계·예산 라벨은 계약 사전(DEVELOP_*_LABELS)에서만 온다.
// 수정 화면도 이 컴포넌트를 쓴다 — 다만 첨부는 거기서 서버에 즉시 반영하므로 그 블록을 끈다.
const props = withDefaults(defineProps<{ form: DevelopRequestForm; showAttachments?: boolean }>(), {
  showAttachments: true,
});
const { fields, isSystem, attachments, addAttachments, removeAttachment } = props.form;

const currentStages = DEVELOP_CURRENT_STAGES;
const currentStageLabels = DEVELOP_CURRENT_STAGE_LABELS;
const targetStages = DEVELOP_TARGET_STAGES;
const targetStageLabels = DEVELOP_TARGET_STAGE_LABELS;
const budgetRanges = DEVELOP_BUDGET_RANGES;
const budgetLabels = DEVELOP_BUDGET_RANGE_LABELS;

const titleLength = computed(() => fields.title.length);
const descriptionLength = computed(() => fields.description.length);
const chipClass = (on: boolean): string =>
  on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 bg-white text-tx-2 hover:border-tx-3';
</script>

<template>
  <div class="grid gap-7">
    <div class="grid gap-1.5">
      <h2 class="text-title font-extrabold text-tx-1">의뢰 내용을 알려주세요</h2>
      <p class="text-body leading-relaxed text-tx-2">기술용어보다 개발 목적과 사용 상황을 중심으로 작성해도 충분합니다.</p>
    </div>

    <!-- 제목 · 목적 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <label class="grid gap-2">
        <span class="flex items-baseline gap-2 text-label font-bold text-tx-2">
          의뢰 제목 <span class="text-red-500">*</span>
          <span class="ml-auto font-mono text-micro tabular-nums text-tx-3">{{ titleLength }} / 200</span>
        </span>
        <input
          v-model="fields.title"
          type="text"
          maxlength="200"
          placeholder="예: 매장용 자동 음료 디스펜서 개발"
          class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
        >
      </label>

      <label class="grid gap-2">
        <span class="flex items-baseline gap-2 text-label font-bold text-tx-2">
          무엇을 개발하고 어떤 문제를 해결하고 싶으신가요? <span class="text-red-500">*</span>
          <span class="ml-auto font-mono text-micro tabular-nums" :class="descriptionLength < 10 ? 'text-tx-3' : 'text-brand-600'">
            {{ descriptionLength }} / 3,000
          </span>
        </span>
        <textarea
          v-model="fields.description"
          rows="7"
          maxlength="3000"
          placeholder="예: 여러 센서의 값을 수집하고 설정 범위를 벗어나면 펌프와 솔레노이드 밸브를 자동으로 제어하는 장비가 필요합니다. 스마트폰에서 상태 확인과 설정 변경도 가능해야 합니다."
          class="rounded-lg border border-line-2 bg-white p-3.5 text-body leading-relaxed text-tx-1 outline-none focus:border-brand-500"
        />
        <span class="text-label text-tx-3">10자 이상. 자세히 적을수록 검토와 견적이 빨라집니다.</span>
      </label>
    </section>

    <!-- 개발단계 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6 md:grid-cols-2">
      <div class="grid content-start gap-2">
        <p class="text-label font-bold text-tx-2">현재 개발단계 <span class="text-red-500">*</span></p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in currentStages"
            :key="s"
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="chipClass(fields.currentStage === s)"
            :aria-pressed="fields.currentStage === s"
            @click="fields.currentStage = s"
          >
            {{ currentStageLabels[s] }}
          </button>
        </div>
      </div>
      <div class="grid content-start gap-2">
        <p class="text-label font-bold text-tx-2">목표 개발단계 <span class="text-red-500">*</span></p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in targetStages"
            :key="s"
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="chipClass(fields.targetStage === s)"
            :aria-pressed="fields.targetStage === s"
            @click="fields.targetStage = s"
          >
            {{ targetStageLabels[s] }}
          </button>
        </div>
      </div>
    </section>

    <!-- 일정 · 예산 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6 md:grid-cols-2">
      <div class="grid content-start gap-2">
        <p class="text-label font-bold text-tx-2">희망 완료 시기 <span class="text-red-500">*</span></p>
        <div class="flex flex-wrap items-center gap-2.5">
          <input
            v-model="fields.wishDate"
            type="date"
            class="h-11 min-w-[10.5rem] rounded-lg border border-line-2 bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
          >
          <span class="text-label text-tx-3">또는</span>
          <input
            v-model="fields.wishNote"
            type="text"
            maxlength="200"
            placeholder="계약 후 3개월"
            class="h-11 min-w-0 flex-1 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
          >
        </div>
        <span class="text-label text-tx-3">날짜와 기간 중 하나만 적으셔도 됩니다.</span>
      </div>

      <label class="grid content-start gap-2">
        <span class="text-label font-bold text-tx-2">예상 개발 예산 <span class="text-red-500">*</span></span>
        <select
          v-model="fields.budgetRange"
          class="h-11 rounded-lg border bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
          :class="fields.budgetRange === null ? 'border-line-2' : 'border-ink-900'"
        >
          <option :value="null" disabled>선택해 주세요</option>
          <option v-for="r in budgetRanges" :key="r" :value="r">{{ budgetLabels[r] }}</option>
        </select>
        <span class="text-label text-tx-3">정확한 금액이 아니라 구간입니다. 견적서에서 항목별로 다시 안내드립니다.</span>
      </label>
    </section>

    <!-- 참고 자료 — 수정 화면은 첨부를 즉시 반영으로 따로 다룬다(showAttachments=false) -->
    <section v-if="showAttachments" class="grid gap-3.5">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">개발명세서와 참고자료를 올려주세요</h2>
        <span class="rounded-full bg-brand-50 px-2.5 py-1 text-micro font-bold text-brand-700">AI 분석 대상</span>
        <span class="text-label text-tx-3">선택 · 없어도 접수됩니다</span>
      </div>
      <FileDropZone
        :files="attachments"
        label="회로도, PCB 원본, Gerber, DXF·STEP, BOM, 데이터시트, 사진·영상 등을 한 번만 등록합니다."
        hint="pdf · 이미지 · 엑셀 · 압축 파일 — 끌어다 놓거나 눌러서 선택"
        variant="panel"
        @add="addAttachments"
        @remove="removeAttachment"
      />
    </section>

    <!-- 후속 질문 방식 — 시스템개발에서만. AI 동의·비밀유지 체크는 5스텝(검토·접수)으로 옮겼다(2026-09-08 간소화). -->
    <section v-if="isSystem" class="grid gap-3 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <h2 class="text-title font-extrabold text-tx-1">후속 질문 방식</h2>
      <button
        type="button"
        class="flex items-start gap-3 rounded-xl border-2 p-4 text-left transition"
        :class="fields.expertDelegate ? 'border-line bg-white hover:border-line-2' : 'border-brand-500 bg-brand-50'"
        :aria-pressed="!fields.expertDelegate"
        @click="fields.expertDelegate = false"
      >
        <span
          class="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2"
          :class="fields.expertDelegate ? 'border-line-2 bg-white' : 'border-brand-500 bg-brand-500'"
        ><span class="h-1.5 w-1.5 rounded-full bg-white" /></span>
        <span class="grid gap-1">
          <span class="text-body font-bold text-tx-1">몇 가지 질문에 답하기</span>
          <span class="text-label leading-relaxed text-tx-3">사용 상황·입출력·장애 시 동작 3가지만 묻습니다.</span>
        </span>
      </button>
      <button
        type="button"
        class="flex items-start gap-3 rounded-xl border-2 p-4 text-left transition"
        :class="fields.expertDelegate ? 'border-brand-500 bg-brand-50' : 'border-line bg-white hover:border-line-2'"
        :aria-pressed="fields.expertDelegate"
        @click="fields.expertDelegate = true"
      >
        <span
          class="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2"
          :class="fields.expertDelegate ? 'border-brand-500 bg-brand-500' : 'border-line-2 bg-white'"
        ><span class="h-1.5 w-1.5 rounded-full bg-white" /></span>
        <span class="grid gap-1">
          <span class="text-body font-bold text-tx-1">전문가에게 맡김</span>
          <span class="text-label leading-relaxed text-tx-3">기술값을 묻지 않고 담당자가 제안합니다.</span>
        </span>
      </button>
    </section>
  </div>
</template>
