<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_TASK_PHASE_LABELS,
  DEVELOP_TASK_PHASES,
  DEVELOP_DOC_TYPE_LABELS,
  developDocDecisionLabel,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopProgressViewType } from '@sp/api-contract';
import { formatDateTime } from '../../../lib/format';

// 00 프로젝트 현황(docs/DEVELOP_FLOW.md §13) — 달성도·7단계·확인 대기·최근 결정 한 띠.
// 값은 전부 서버 파생(progress)이라 여기서 계산하지 않는다. 단계 라벨·문서 라벨은 계약 사전이 정본.
const props = defineProps<{
  progress: DevelopProgressViewType;
  documents: readonly AdminDevelopDocumentViewType[];
}>();
const emit = defineEmits<{ focus: [documentId: number] }>();

const { t } = useI18n();

const phaseState = (phase: (typeof DEVELOP_TASK_PHASES)[number]): 'done' | 'now' | 'todo' =>
  props.progress.phases.find((p) => p.phase === phase)?.state ?? 'todo';

// 고객 확인 대기 = 발송된 승인형 문서(서버 pendingApprovals 와 같은 조건).
const pending = computed(() =>
  props.documents.filter((d) => d.status === 'sent' && d.approval).sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? '')),
);

const recentDecisions = computed(() =>
  props.documents
    .filter((d) => d.decision !== null)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
    .slice(0, 3),
);

const dotClass: Record<'done' | 'now' | 'todo', string> = {
  done: 'bg-blue-600',
  now: 'bg-blue-600 ring-4 ring-blue-100',
  todo: 'bg-gray-300',
};
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-white p-4">
    <h2 class="text-base font-bold text-gray-800">{{ t('admin.develop.docs.status.title') }}</h2>

    <div class="mt-3 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <p class="text-xs font-semibold text-gray-500">{{ t('admin.develop.docs.status.progress') }}</p>
        <p class="mt-0.5 text-2xl font-bold text-gray-900">{{ progress.progressPct }}%</p>
        <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
          <i class="block h-full rounded-full bg-blue-600" :style="{ width: `${String(progress.progressPct)}%` }" />
        </div>
      </div>
      <div class="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <p class="text-xs font-semibold text-gray-500">{{ t('admin.develop.docs.status.currentPhase') }}</p>
        <p class="mt-0.5 text-lg font-bold text-gray-900">
          {{ progress.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[progress.currentPhase] }}
        </p>
        <p class="mt-0.5 text-xs text-gray-500">
          {{ t('admin.develop.docs.status.baseStartOn') }}: {{ progress.baseStartOn ?? t('admin.develop.docs.status.undecided') }}
        </p>
      </div>
      <div class="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <p class="text-xs font-semibold text-gray-500">{{ t('admin.develop.docs.status.expectedEndOn') }}</p>
        <p class="mt-0.5 text-lg font-bold text-gray-900">
          {{ progress.expectedEndOn ?? t('admin.develop.docs.status.undecided') }}
        </p>
        <p class="mt-0.5 text-xs text-gray-500">
          {{ t('admin.develop.docs.status.plannedEndOn') }}: {{ progress.plannedEndOn ?? t('admin.develop.docs.status.undecided') }}
        </p>
      </div>
    </div>

    <!-- 7단계 — 업무표에서 파생된다(의뢰 status 를 늘리지 않는다는 계약 결정). -->
    <ol class="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
      <li v-for="phase in DEVELOP_TASK_PHASES" :key="phase" class="grid justify-items-center gap-1 text-center">
        <span class="h-2.5 w-2.5 rounded-full" :class="dotClass[phaseState(phase)]" />
        <span
          class="text-[11px] leading-tight"
          :class="phaseState(phase) === 'now' ? 'font-bold text-blue-700' : phaseState(phase) === 'done' ? 'text-gray-700' : 'text-gray-400'"
        >{{ DEVELOP_TASK_PHASE_LABELS[phase] }}</span>
      </li>
    </ol>

    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <!-- 고객 확인 대기 -->
      <div class="rounded-lg border p-3" :class="pending.length > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100'">
        <p class="text-xs font-bold text-gray-700">
          {{ t('admin.develop.docs.status.pending') }}
          <span v-if="pending.length > 0" class="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">{{ pending.length }}</span>
        </p>
        <ul v-if="pending.length > 0" class="mt-1.5 grid gap-1">
          <li v-for="d in pending" :key="d.documentId">
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-1.5 rounded border border-amber-200 bg-white px-2 py-1 text-left text-xs hover:bg-amber-50"
              @click="emit('focus', d.documentId)"
            >
              <b class="font-mono text-gray-800">{{ d.docNo }}</b>
              <span class="text-gray-700">{{ DEVELOP_DOC_TYPE_LABELS[d.type] }}</span>
              <span v-if="d.sentAt !== null" class="text-gray-400">{{ formatDateTime(d.sentAt) }}</span>
              <span v-if="d.replyDueOn !== null" class="ml-auto font-semibold text-amber-700">
                {{ t('admin.develop.docs.status.replyDue', { date: d.replyDueOn }) }}
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="mt-1.5 text-xs text-gray-400">{{ t('admin.develop.docs.status.pendingNone') }}</p>
      </div>

      <!-- 최근 결정 -->
      <div class="rounded-lg border border-gray-100 p-3">
        <p class="text-xs font-bold text-gray-700">{{ t('admin.develop.docs.status.decisions') }}</p>
        <ul v-if="recentDecisions.length > 0" class="mt-1.5 grid gap-1">
          <li v-for="d in recentDecisions" :key="d.documentId" class="flex flex-wrap items-center gap-1.5 text-xs">
            <button type="button" class="font-mono font-bold text-blue-700 hover:underline" @click="emit('focus', d.documentId)">{{ d.docNo }}</button>
            <span class="text-gray-700">{{ d.decision === null ? '' : developDocDecisionLabel(d.type, d.decision) }}</span>
            <span class="text-gray-400">{{ d.decidedName ?? '' }}</span>
            <span v-if="d.decidedAt !== null" class="ml-auto text-gray-400">{{ formatDateTime(d.decidedAt) }}</span>
          </li>
        </ul>
        <p v-else class="mt-1.5 text-xs text-gray-400">{{ t('admin.develop.docs.status.decisionsNone') }}</p>
      </div>
    </div>
  </section>
</template>
