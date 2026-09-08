<script setup lang="ts">
import { computed } from 'vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 사이드(≥lg) — 5스텝 내비 + 도움 카드(프로토타입 그대로, 2026-09-08 간소화로 초안 요약 카드는 뺐다).
// 내비는 **지나온 스텝으로만** 간다(앞 스텝의 필수 입력을 건너뛰지 못하게). 임시저장 시각만 내비 아래 한 줄.
const props = defineProps<{ form: DevelopRequestForm }>();
const { steps, stepIndex, goToStep, draftSavedAt } = props.form;

const savedLabel = computed(() => {
  const at = draftSavedAt.value;
  if (at === null) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});
</script>

<template>
  <aside class="grid gap-4">
    <ol class="grid gap-1.5 rounded-2xl border border-line bg-white p-4">
      <li v-for="(s, i) in steps" :key="s.key">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition"
          :class="i === stepIndex ? 'bg-ink-950 text-white' : i < stepIndex ? 'text-tx-1 hover:bg-paper' : 'text-tx-3'"
          :disabled="i > stepIndex"
          @click="goToStep(s.key)"
        >
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold"
            :class="i === stepIndex ? 'bg-brand-500 text-white' : i < stepIndex ? 'bg-brand-50 text-brand-700' : 'bg-paper text-tx-3'"
          >{{ i < stepIndex ? '✓' : i + 1 }}</span>
          <span class="grid min-w-0 gap-0.5">
            <span class="text-body font-bold">{{ s.label }}</span>
            <span class="truncate text-micro" :class="i === stepIndex ? 'text-dk-tx-2' : 'text-tx-3'">{{ s.sub }}</span>
          </span>
        </button>
      </li>
      <li v-if="savedLabel !== ''" class="px-3 pt-1 text-micro text-tx-3">임시저장됨 · {{ savedLabel }}</li>
    </ol>

    <div class="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper text-label font-black text-tx-2" aria-hidden="true">?</span>
      <p class="text-label leading-relaxed text-tx-2">
        <b class="font-bold text-tx-1">기술 내용을 잘 모르시나요?</b><br>
        아는 내용만 작성하고 '전문가에게 맡김'을 선택하셔도 됩니다.
      </p>
    </div>
  </aside>
</template>
