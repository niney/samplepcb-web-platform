<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_TASK_PHASE_LABELS, DEVELOP_TASK_STATUS_LABELS } from '@sp/api-contract/develop-c';
import type {
  DevelopPhaseStateType,
  DevelopProgressViewType,
  DevelopRequestStatusType,
  DevelopTaskPhaseType,
  DevelopTaskStatusType,
  DevelopTaskViewType,
} from '@sp/api-contract/develop-c';

// 진행 현황(docs/DEVELOP_FLOW.md §13) — 서버가 계산해 내려준 값을 그대로 그린다(화면이 다시 계산하지 않는다).
// 업무표는 **고객 공개 행만** 오므로 "전부"처럼 보이지 않게 표 위에 공개 범위를 한 줄로 밝힌다.
// 착수 전(received~accepted)에는 업무·달성도가 아직 뜻이 없어 카드 대신 안내 한 줄로 접는다.
const props = defineProps<{ progress: DevelopProgressViewType; status: DevelopRequestStatusType }>();

const BEFORE_START: readonly DevelopRequestStatusType[] = ['received', 'reviewing', 'quoted', 'accepted'];
const beforeStart = computed(() => BEFORE_START.includes(props.status));

const phases = computed(() => props.progress.phases);
const phaseLabel = (p: DevelopTaskPhaseType): string => DEVELOP_TASK_PHASE_LABELS[p];
const currentLabel = computed(() => {
  const p = props.progress.currentPhase;
  return p === null ? '—' : DEVELOP_TASK_PHASE_LABELS[p];
});

// 단계 색 — 진행 중인 한 칸만 브랜드색으로 세운다(스텝퍼와 같은 어휘).
const phaseBarClass = (state: DevelopPhaseStateType): string =>
  state === 'done' ? 'bg-brand-300' : state === 'now' ? 'bg-brand-500' : 'bg-line';
const phaseTextClass = (state: DevelopPhaseStateType): string =>
  state === 'now' ? 'text-brand-700' : state === 'done' ? 'text-tx-2' : 'text-tx-3';

const taskTone: Record<DevelopTaskStatusType, string> = {
  planned: 'bg-line text-tx-3',
  in_progress: 'bg-brand-100 text-brand-700',
  customer_review: 'bg-amber-100 text-amber-800',
  on_hold: 'bg-line text-tx-3',
  delayed: 'bg-red-100 text-red-700',
  done: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-line text-tx-3', // 서버가 고객 응답에서 제외 행을 빼므로 보통 보이지 않는다
};
const taskLabel = (s: DevelopTaskStatusType): string => DEVELOP_TASK_STATUS_LABELS[s];
const period = (t: DevelopTaskViewType): string =>
  t.startOn === null && t.endOn === null ? '—' : `${t.startOn ?? '—'} ~ ${t.endOn ?? '—'}`;
</script>

<template>
  <div v-if="beforeStart" class="rounded-2xl border border-dashed border-line-2 bg-white px-6 py-8 text-center">
    <p class="text-body text-tx-2">착수 뒤 진행 현황이 표시됩니다.</p>
  </div>

  <div v-else class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
    <!-- 달성도 -->
    <div class="grid gap-2.5">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h3 class="text-label font-bold text-tx-3">달성도</h3>
        <span class="font-mono text-h1 font-extrabold tabular-nums text-tx-1">{{ progress.progressPct }}%</span>
        <dl class="ml-auto grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-label">
          <dt class="text-tx-3">현재 단계</dt>
          <dd class="font-bold text-tx-1">{{ currentLabel }}</dd>
          <dt class="text-tx-3">예상 완료일</dt>
          <dd class="font-mono tabular-nums text-tx-1">{{ progress.expectedEndOn ?? '미정' }}</dd>
        </dl>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-line">
        <div class="h-full rounded-full bg-brand-500 transition-[width]" :style="{ width: `${String(progress.progressPct)}%` }" />
      </div>
      <dl
        v-if="progress.baseStartOn !== null || progress.plannedEndOn !== null"
        class="flex flex-wrap gap-x-5 gap-y-1 text-label text-tx-3"
      >
        <div v-if="progress.baseStartOn !== null" class="flex gap-1.5">
          <dt>기준 착수일</dt>
          <dd class="font-mono tabular-nums text-tx-2">{{ progress.baseStartOn }}</dd>
        </div>
        <div v-if="progress.plannedEndOn !== null" class="flex gap-1.5">
          <dt>계획 완료일</dt>
          <dd class="font-mono tabular-nums text-tx-2">{{ progress.plannedEndOn }}</dd>
        </div>
      </dl>
    </div>

    <!-- 7단계 -->
    <ol class="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-7">
      <li v-for="p in phases" :key="p.phase" class="grid gap-1.5">
        <span class="h-1.5 rounded-full" :class="phaseBarClass(p.state)" />
        <span class="text-micro font-bold leading-tight" :class="phaseTextClass(p.state)">{{ phaseLabel(p.phase) }}</span>
        <span v-if="p.taskCount > 0" class="font-mono text-micro tabular-nums text-tx-3">{{ p.progressPct }}%</span>
      </li>
    </ol>

    <!-- 공개 업무표 -->
    <div class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">공유된 업무</h3>
      <div v-if="progress.tasks.length > 0" class="overflow-x-auto">
        <table class="w-full min-w-[560px] border-collapse text-body">
          <thead>
            <tr class="border-b border-line text-label text-tx-3">
              <th class="py-2 text-left font-semibold">업무</th>
              <th class="w-24 py-2 pl-3 text-left font-semibold">단계</th>
              <th class="w-28 py-2 pl-3 text-left font-semibold">상태</th>
              <th class="w-44 py-2 pl-3 text-left font-semibold">기간</th>
              <th class="w-28 py-2 pl-3 text-right font-semibold">진행률</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in progress.tasks" :key="t.taskId" class="border-b border-line align-top">
              <td class="py-2.5 pr-3">
                <p class="font-bold text-tx-1">{{ t.name }}</p>
                <p v-if="t.note !== null" class="mt-0.5 text-label text-tx-3">{{ t.note }}</p>
              </td>
              <td class="py-2.5 pl-3 text-label text-tx-2">{{ phaseLabel(t.phase) }}</td>
              <td class="py-2.5 pl-3">
                <span class="rounded-full px-2 py-0.5 text-micro font-bold" :class="taskTone[t.status]">{{ taskLabel(t.status) }}</span>
              </td>
              <td class="py-2.5 pl-3 font-mono text-label tabular-nums text-tx-2">{{ period(t) }}</td>
              <td class="py-2.5 pl-3">
                <div class="flex items-center justify-end gap-2">
                  <span class="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                    <span class="block h-full rounded-full bg-brand-400" :style="{ width: `${String(t.progressPct)}%` }" />
                  </span>
                  <span class="w-9 shrink-0 text-right font-mono text-label tabular-nums text-tx-2">{{ t.progressPct }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="rounded-xl border border-dashed border-line-2 px-4 py-6 text-center text-body text-tx-3">
        담당자가 일정을 공유하면 여기에 표시됩니다.
      </p>
    </div>
  </div>
</template>
