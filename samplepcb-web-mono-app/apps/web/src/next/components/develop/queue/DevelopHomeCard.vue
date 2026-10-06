<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_TASK_PHASES, DEVELOP_TASK_PHASE_LABELS } from '@sp/api-contract';
import type { AdminDevelopRequestListItemType } from '@sp/api-contract';
import { formatDateTime, formatKrw } from '@/lib/format';
import { developDetailTo, NEXT_DEVELOP_ROUTES } from '@/next/develop-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { developStatusBadge } from '@/next/components/develop/develop-badges';
import DevelopProgressBar from '@/next/components/develop/DevelopProgressBar.vue';

// 진행현황 홈의 의뢰 카드(옛 components/admin/develop/DevelopHomeCard.vue 의 짝, 같은 props) — 건 하나의 00 현황
// (상세 「프로젝트 문서」 탭 상단 띠)을 횡단으로 압축한 판. 값은 전부 서버 파생(ops)이라 다시 계산하지 않고,
// 버튼 3개가 상세의 해당 탭으로 딥링크한다. 회신 기한 초과 카드는 옛 화면의 붉은 테두리 대신 머리에 '기한 초과' 배지.
const props = defineProps<{ item: AdminDevelopRequestListItemType }>();

const { t } = useI18n();

// 상세 딥링크 — from=홈이라 「← 목록으로」가 홈으로 돌아온다.
const to = (tab: string) => developDetailTo(props.item.requestId, { tab, from: NEXT_DEVELOP_ROUTES.home });
const status = computed(() => developStatusBadge(props.item.status));
const quiet = computed(
  () =>
    props.item.ops.pendingApprovals === 0 &&
    props.item.ops.openInquiries === 0 &&
    props.item.ops.overdueTasks === 0 &&
    props.item.ops.openableMilestones === 0,
);

// 6단계 미니 점 — currentPhase 앞은 done, 그 칸은 now, 뒤는 todo(업무표가 없으면 전부 todo).
const phaseIndex = computed(() =>
  props.item.ops.currentPhase === null ? -1 : DEVELOP_TASK_PHASES.indexOf(props.item.ops.currentPhase),
);
const phaseClass = (index: number): string =>
  phaseIndex.value < 0 || index > phaseIndex.value
    ? 'bg-muted-foreground/25'
    : index === phaseIndex.value
      ? 'bg-primary ring-primary/20 ring-4'
      : 'bg-primary';

const LINKS = [
  { tab: 'review', key: 'review' },
  { tab: 'quotes', key: 'quotes' },
  { tab: 'documents', key: 'documents' },
] as const;
</script>

<template>
  <Card class="gap-3 p-4">
    <div class="flex flex-wrap items-start gap-2">
      <RouterLink
        :to="to('content')"
        class="hover:text-primary min-w-0 flex-1 truncate text-base font-semibold hover:underline"
        :title="item.title"
      >
        {{ item.title }}
      </RouterLink>
      <Badge v-if="item.ops.replyOverdue" variant="danger">{{ t('admin.develop.queue.overdue') }}</Badge>
      <Badge :variant="status.variant">{{ status.label }}</Badge>
    </div>
    <p class="text-muted-foreground -mt-1 text-xs">
      {{ item.contact.name }}<template v-if="item.contact.company !== null"> · {{ item.contact.company }}</template>
      · {{ t('admin.develop.home.assignee') }} {{ item.assigneeMbId ?? '—' }}
    </p>

    <!-- 달성도 + 현재 단계 -->
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1"><DevelopProgressBar :pct="item.ops.progressPct" :label="t('admin.develop.col.progress')" /></span>
      <span class="text-xs font-semibold tabular-nums">{{ item.ops.progressPct }}%</span>
      <span class="text-muted-foreground text-xs">
        {{ item.ops.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[item.ops.currentPhase] }}
      </span>
    </div>

    <!-- 6단계 미니 점 -->
    <ol class="flex items-center gap-1.5">
      <li
        v-for="(phase, index) in DEVELOP_TASK_PHASES"
        :key="phase"
        class="size-2 rounded-full"
        :class="phaseClass(index)"
        :title="DEVELOP_TASK_PHASE_LABELS[phase]"
      />
    </ol>

    <!-- 확인 대기 · 미답변 문의 · 지연 작업 · 열어야 할 청구 · 수납/미수(전부 서버 ops) -->
    <div class="grid gap-1 text-xs">
      <p v-if="item.ops.pendingApprovals > 0" :class="item.ops.replyOverdue ? 'text-destructive font-semibold' : 'text-warning'">
        {{ t('admin.develop.home.pending', { n: item.ops.pendingApprovals }) }}
        <template v-if="item.ops.nextReplyDueOn !== null"> · {{ t('admin.develop.queue.replyDue', { date: item.ops.nextReplyDueOn }) }}</template>
        <template v-if="item.ops.replyOverdue"> · {{ t('admin.develop.queue.overdue') }}</template>
      </p>
      <template v-if="item.ops.openInquiries > 0">
        <p class="text-warning font-semibold">{{ t('admin.develop.queue.inquiryOpen', { n: item.ops.openInquiries }) }}</p>
        <p v-if="item.ops.lastInquiry !== null" class="flex min-w-0 items-center gap-1">
          <Badge v-if="item.ops.lastInquiry.type === 'as_request'" variant="danger">{{ t('admin.develop.queue.asRequest') }}</Badge>
          <span class="truncate" :title="item.ops.lastInquiry.excerpt">{{ item.ops.lastInquiry.excerpt }}</span>
          <span class="text-muted-foreground shrink-0 tabular-nums">{{ formatDateTime(item.ops.lastInquiry.at) }}</span>
        </p>
      </template>
      <p v-if="item.ops.overdueTasks > 0" class="text-destructive font-semibold">
        {{ t('admin.develop.home.overdueTasks', { n: item.ops.overdueTasks }) }}
      </p>
      <p v-if="item.ops.openableMilestones > 0" class="text-warning font-semibold">
        {{ t('admin.develop.home.openable', { n: item.ops.openableMilestones }) }}
      </p>
      <p v-if="item.ops.paidAmount > 0 || item.ops.pendingAmount > 0" class="text-muted-foreground tabular-nums">
        {{ t('admin.develop.home.money', { paid: formatKrw(item.ops.paidAmount), pending: formatKrw(item.ops.pendingAmount) }) }}
      </p>
      <p v-if="quiet" class="text-muted-foreground">{{ t('admin.develop.home.noSignal') }}</p>
    </div>

    <!-- 딥링크 3개 — 건 안에서 다음에 열 곳. -->
    <div class="flex flex-wrap gap-1.5">
      <Button v-for="link in LINKS" :key="link.key" variant="outline" size="sm" as-child>
        <RouterLink :to="to(link.tab)">{{ t(`admin.develop.home.open.${link.key}`) }}</RouterLink>
      </Button>
    </div>
  </Card>
</template>
