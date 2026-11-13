<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_TASK_PHASE_LABELS } from '@sp/api-contract';
import type { DevelopPhaseStateType, DevelopProgressViewType } from '@sp/api-contract';

// 진행 현황 머리 — 큰 달성도 + 날짜 넷 → 단계 띠(진행 중인 한 칸만 진하게). 서버가 계산한 값을 그대로 그린다(docs/DEVELOP_FLOW.md §13).
// 진행 현황 첫 장의 공유된 업무 표 위에 놓인다.
const props = defineProps<{ progress: DevelopProgressViewType; stack?: boolean }>(); // stack = 좁은 화면 — 단계 띠를 세 칸씩 두 줄로

const facts = computed(() => {
  const p = props.progress;
  return [
    { label: '현재 단계', value: p.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[p.currentPhase] },
    { label: '예상 완료일', value: p.expectedEndOn ?? '미정' },
    { label: '기준 착수일', value: p.baseStartOn ?? '—' },
    { label: '계획 완료일', value: p.plannedEndOn ?? '—' },
  ];
});
const barClass = (state: DevelopPhaseStateType): string => (state === 'done' ? 'bg-brand-300' : state === 'now' ? 'bg-brand-600' : 'bg-line');
const textClass = (state: DevelopPhaseStateType): string => (state === 'now' ? 'font-bold text-brand-600' : state === 'done' ? 'text-[#3b4558]' : 'text-tx-3');
</script>

<template>
  <div class="flex flex-col gap-[16px]">
    <div class="flex flex-wrap items-end gap-x-[44px] gap-y-[10px]">
      <div class="shrink-0">
        <p class="text-[14px] leading-[1.4] text-tx-2">달성도</p>
        <p class="text-[46px] font-bold leading-[1.05] tabular-nums text-brand-600">{{ progress.progressPct }}%</p>
      </div>
      <dl :class="stack ? 'grid w-full grid-cols-2 gap-x-[24px] gap-y-[8px] sm:flex sm:w-auto sm:flex-1 sm:flex-wrap sm:gap-x-[40px]' : 'flex min-w-0 flex-1 flex-wrap gap-x-[40px] gap-y-[6px] pb-[4px]'">
        <div v-for="f in facts" :key="f.label">
          <dt class="text-[14px] leading-[1.4] text-tx-2">{{ f.label }}</dt>
          <dd class="text-[19px] font-semibold leading-[1.35] tabular-nums">{{ f.value }}</dd>
        </div>
      </dl>
    </div>
    <ol
      class="grid gap-x-[8px] gap-y-[12px]"
      :class="stack ? 'grid-cols-3 sm:grid-cols-6' : ''"
      :style="stack ? undefined : { gridTemplateColumns: `repeat(${String(Math.max(1, progress.phases.length))}, minmax(0, 1fr))` }"
    >
      <li v-for="p in progress.phases" :key="p.phase" class="flex flex-col gap-[6px]">
        <span class="h-[8px] rounded-full" :class="barClass(p.state)" />
        <span class="text-[14px] leading-[1.3]" :class="textClass(p.state)">
          {{ DEVELOP_TASK_PHASE_LABELS[p.phase] }}<span v-if="p.taskCount > 0" class="ml-[6px] font-normal tabular-nums text-tx-3">{{ p.progressPct }}%</span>
        </span>
      </li>
    </ol>
  </div>
</template>
