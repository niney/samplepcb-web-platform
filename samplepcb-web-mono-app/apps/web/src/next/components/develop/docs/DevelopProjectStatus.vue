<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_DOC_TYPE_LABELS,
  DEVELOP_TASK_PHASE_LABELS,
  DEVELOP_TASK_PHASES,
  developDocDecisionLabel,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopProgressViewType, DevelopTaskPhaseType } from '@sp/api-contract';
import { formatDateTime } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Item } from '@/next/components/ui/item';
import DevelopProgressBar from '@/next/components/develop/DevelopProgressBar.vue';

// 00 프로젝트 현황(docs/DEVELOP_FLOW.md §13) — 달성도·6단계·확인 대기·최근 결정 한 띠.
// 옛 components/admin/develop/DevelopProjectStatus.vue 의 짝. 값은 전부 서버 파생(progress)이라 여기서 계산하지 않는다.
const props = defineProps<{
  progress: DevelopProgressViewType;
  documents: readonly AdminDevelopDocumentViewType[];
}>();
const emit = defineEmits<{ focus: [documentId: number] }>();

const { t } = useI18n();

type PhaseState = 'done' | 'now' | 'todo';
const phaseState = (phase: DevelopTaskPhaseType): PhaseState =>
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

// 6단계 점 — 지난 단계는 주 색, 지금 단계는 주 색 + 옅은 고리, 남은 단계는 흐리게.
const DOT: Record<PhaseState, string> = {
  done: 'bg-primary',
  now: 'bg-primary ring-4 ring-primary/20',
  todo: 'bg-muted-foreground/30',
};
const PHASE_TEXT: Record<PhaseState, string> = {
  done: 'text-foreground',
  now: 'text-primary font-semibold',
  todo: 'text-muted-foreground',
};
</script>

<template>
  <SectionCard :title="t('admin.develop.docs.status.title')">
    <div class="grid gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <Panel tone="muted">
          <p class="text-muted-foreground text-xs font-medium">{{ t('admin.develop.docs.status.progress') }}</p>
          <p class="mt-0.5 text-2xl font-semibold tabular-nums">{{ progress.progressPct }}%</p>
          <DevelopProgressBar class="mt-1.5" :pct="progress.progressPct" :label="t('admin.develop.docs.status.progress')" />
          <!-- 지연 = 완료일 경과 ∧ 미완료(서버 파생). -->
          <p v-if="progress.overdueTasks > 0" class="text-destructive mt-1 text-xs font-semibold">
            {{ t('admin.develop.docs.status.overdueTasks', { n: progress.overdueTasks }) }}
          </p>
        </Panel>
        <Panel tone="muted">
          <p class="text-muted-foreground text-xs font-medium">{{ t('admin.develop.docs.status.currentPhase') }}</p>
          <p class="mt-0.5 text-lg font-semibold">
            {{ progress.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[progress.currentPhase] }}
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            {{ t('admin.develop.docs.status.baseStartOn') }}: {{ progress.baseStartOn ?? t('admin.develop.docs.status.undecided') }}
          </p>
        </Panel>
        <Panel tone="muted">
          <p class="text-muted-foreground text-xs font-medium">{{ t('admin.develop.docs.status.expectedEndOn') }}</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums">
            {{ progress.expectedEndOn ?? t('admin.develop.docs.status.undecided') }}
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            {{ t('admin.develop.docs.status.plannedEndOn') }}: {{ progress.plannedEndOn ?? t('admin.develop.docs.status.undecided') }}
          </p>
        </Panel>
      </div>

      <!-- 6단계 — 업무표에서 파생된다(의뢰 status 를 늘리지 않는다는 계약 결정). -->
      <ol class="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <li v-for="phase in DEVELOP_TASK_PHASES" :key="phase" class="grid justify-items-center gap-1.5 text-center">
          <span class="size-2.5 rounded-full" :class="DOT[phaseState(phase)]" />
          <span class="text-xs leading-tight" :class="PHASE_TEXT[phaseState(phase)]">{{ DEVELOP_TASK_PHASE_LABELS[phase] }}</span>
        </li>
      </ol>

      <div class="grid gap-3 lg:grid-cols-2">
        <!-- 고객 확인 대기 -->
        <Panel :tone="pending.length > 0 ? 'warning' : 'default'">
          <p class="flex items-center gap-1.5 text-xs font-semibold">
            {{ t('admin.develop.docs.status.pending') }}
            <Badge v-if="pending.length > 0" variant="warning" class="tabular-nums">{{ pending.length }}</Badge>
          </p>
          <ul v-if="pending.length > 0" class="mt-2 grid gap-1.5">
            <li v-for="d in pending" :key="d.documentId">
              <Item as="button" type="button" variant="outline" size="xs" class="w-full" @click="emit('focus', d.documentId)">
                <span class="text-foreground flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <b class="font-mono">{{ d.docNo }}</b>
                  <span>{{ DEVELOP_DOC_TYPE_LABELS[d.type] }}</span>
                  <span v-if="d.sentAt !== null" class="text-muted-foreground tabular-nums">{{ formatDateTime(d.sentAt) }}</span>
                  <span v-if="d.replyDueOn !== null" class="text-warning ml-auto font-semibold tabular-nums">
                    {{ t('admin.develop.docs.status.replyDue', { date: d.replyDueOn }) }}
                  </span>
                </span>
              </Item>
            </li>
          </ul>
          <p v-else class="text-muted-foreground mt-1.5 text-xs">{{ t('admin.develop.docs.status.pendingNone') }}</p>
        </Panel>

        <!-- 최근 결정 -->
        <Panel>
          <p class="text-xs font-semibold">{{ t('admin.develop.docs.status.decisions') }}</p>
          <ul v-if="recentDecisions.length > 0" class="mt-1.5 grid gap-1">
            <li v-for="d in recentDecisions" :key="d.documentId" class="flex flex-wrap items-center gap-1.5 text-xs">
              <Button variant="ghost" size="xs" @click="emit('focus', d.documentId)">
                <span class="text-primary font-mono font-semibold">{{ d.docNo }}</span>
              </Button>
              <span>{{ d.decision === null ? '' : developDocDecisionLabel(d.type, d.decision) }}</span>
              <span class="text-muted-foreground">{{ d.decidedName ?? '' }}</span>
              <span v-if="d.decidedAt !== null" class="text-muted-foreground ml-auto tabular-nums">{{ formatDateTime(d.decidedAt) }}</span>
            </li>
          </ul>
          <p v-else class="text-muted-foreground mt-1.5 text-xs">{{ t('admin.develop.docs.status.decisionsNone') }}</p>
        </Panel>
      </div>
    </div>
  </SectionCard>
</template>
