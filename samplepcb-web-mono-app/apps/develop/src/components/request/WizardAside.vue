<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_BUDGET_RANGE_LABELS, marketAreaBadge } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 사이드(≥lg) — 진행 3칸 + 지금까지 적은 것. 스텝을 되짚는 유일한 내비다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { fields, steps, stepIndex, goToStep, buildAnswers, totalAttachmentCount } = props.form;

const areaBadge = computed(() => marketAreaBadge(fields.serviceAreas));
const budgetLabel = computed(() => (fields.budgetRange === null ? '미선택' : MARKET_BUDGET_RANGE_LABELS[fields.budgetRange]));
const answeredCount = computed(() => buildAnswers().length);
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
          <span class="text-body font-bold">{{ s.label }}</span>
        </button>
      </li>
    </ol>

    <dl class="grid gap-3 rounded-2xl border border-line bg-white p-4 text-label">
      <p class="font-mono text-micro tracking-[.14em] text-tx-3">DRAFT</p>
      <div class="grid gap-0.5">
        <dt class="text-tx-3">개발 분야</dt>
        <dd class="font-bold text-tx-1">{{ areaBadge === '' ? '아직 안 골랐습니다' : areaBadge }}</dd>
      </div>
      <div class="grid gap-0.5">
        <dt class="text-tx-3">제목</dt>
        <dd class="truncate font-bold text-tx-1">{{ fields.title.trim() === '' ? '—' : fields.title }}</dd>
      </div>
      <div class="grid gap-0.5">
        <dt class="text-tx-3">예산</dt>
        <dd class="text-tx-1">{{ budgetLabel }}</dd>
      </div>
      <div class="grid gap-0.5">
        <dt class="text-tx-3">답변 · 첨부</dt>
        <dd class="tabular-nums text-tx-1">{{ answeredCount }}개 · {{ totalAttachmentCount }}개</dd>
      </div>
    </dl>

    <p class="rounded-2xl bg-ink-950 px-4 py-3.5 text-label leading-relaxed text-dk-tx-2">
      회로·PCB·펌웨어·앱·서버를 <b class="font-bold text-white">한 곳에서</b> 개발하고, 그대로 양산까지 이어 갑니다.
    </p>
  </aside>
</template>
