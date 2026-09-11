<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_REQUEST_STATUS_LABELS,
  DEVELOP_TASK_PHASES,
  DEVELOP_TASK_PHASE_LABELS,
} from '@sp/api-contract';
import type { AdminDevelopRequestListItemType } from '@sp/api-contract';
import { developDetailTo } from '../../../admin/develop-navigation';
import { developStatusBadgeClass } from './develop-badge';
import { formatDateTime, formatKrw } from '../../../lib/format';

// 진행현황 홈의 의뢰 카드(docs/DEVELOP_FLOW.md §14) — 건 하나의 00 현황(상세 「프로젝트
// 문서」 탭 상단 띠)을 횡단으로 압축한 판. 값은 전부 서버 파생(ops)이라 다시 계산하지 않고,
// 버튼 3개가 상세의 해당 탭으로 딥링크한다.
const props = defineProps<{ item: AdminDevelopRequestListItemType }>();

const { t } = useI18n();

// 상세 딥링크 — from=홈이라 「← 목록으로」가 홈으로 돌아온다.
const to = (tab: string) => developDetailTo(props.item.requestId, { tab, from: 'admin-develop' });
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
    ? 'bg-gray-200'
    : index === phaseIndex.value
      ? 'bg-blue-600 ring-4 ring-blue-100'
      : 'bg-blue-600';
</script>

<template>
  <article
    class="grid gap-2.5 rounded-xl border bg-white p-4"
    :class="item.ops.replyOverdue ? 'border-red-200 shadow-sm' : 'border-gray-200'"
  >
    <div class="flex flex-wrap items-start gap-2">
      <RouterLink :to="to('content')" class="min-w-0 flex-1 truncate text-base font-bold text-gray-900 hover:text-blue-700 hover:underline">
        {{ item.title }}
      </RouterLink>
      <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" :class="developStatusBadgeClass(item.status)">
        {{ DEVELOP_REQUEST_STATUS_LABELS[item.status] }}
      </span>
    </div>
    <p class="-mt-1 text-xs text-gray-500">
      {{ item.contact.name }}<span v-if="item.contact.company !== null"> · {{ item.contact.company }}</span>
      <span class="text-gray-400"> · {{ t('admin.develop.home.assignee') }} {{ item.assigneeMbId ?? '—' }}</span>
    </p>

    <!-- 달성도 + 현재 단계 -->
    <div class="flex items-center gap-2">
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
        <i class="block h-full rounded-full bg-blue-600" :style="{ width: `${String(item.ops.progressPct)}%` }" />
      </div>
      <span class="text-xs font-bold text-gray-700">{{ item.ops.progressPct }}%</span>
      <span class="text-xs text-gray-500">
        {{ item.ops.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[item.ops.currentPhase] }}
      </span>
    </div>

    <!-- 6단계 미니 점 -->
    <ol class="flex items-center gap-1">
      <li
        v-for="(phase, index) in DEVELOP_TASK_PHASES"
        :key="phase"
        class="h-2 w-2 rounded-full"
        :class="phaseClass(index)"
        :title="DEVELOP_TASK_PHASE_LABELS[phase]"
      />
    </ol>

    <!-- 확인 대기 · 미답변 문의 -->
    <div class="grid gap-1 text-xs">
      <p v-if="item.ops.pendingApprovals > 0" :class="item.ops.replyOverdue ? 'font-bold text-red-600' : 'text-amber-700'">
        {{ t('admin.develop.home.pending', { n: item.ops.pendingApprovals }) }}
        <span v-if="item.ops.nextReplyDueOn !== null"> · {{ t('admin.develop.queue.replyDue', { date: item.ops.nextReplyDueOn }) }}</span>
        <span v-if="item.ops.replyOverdue"> · {{ t('admin.develop.queue.overdue') }}</span>
      </p>
      <template v-if="item.ops.openInquiries > 0">
        <p class="font-bold text-amber-700">{{ t('admin.develop.queue.inquiryOpen', { n: item.ops.openInquiries }) }}</p>
        <p v-if="item.ops.lastInquiry !== null" class="truncate text-gray-600">
          <span v-if="item.ops.lastInquiry.type === 'as_request'" class="mr-1 rounded bg-red-50 px-1 font-bold text-red-600">
            {{ t('admin.develop.queue.asRequest') }}
          </span>
          {{ item.ops.lastInquiry.excerpt }}
          <span class="text-gray-400">{{ formatDateTime(item.ops.lastInquiry.at) }}</span>
        </p>
      </template>
      <!-- 지연 작업 · 열어야 할 청구 · 수납/미수 — 2026-09-10 G 이식(전부 서버 ops). -->
      <p v-if="item.ops.overdueTasks > 0" class="font-bold text-red-600">{{ t('admin.develop.home.overdueTasks', { n: item.ops.overdueTasks }) }}</p>
      <p v-if="item.ops.openableMilestones > 0" class="font-bold text-amber-700">
        {{ t('admin.develop.home.openable', { n: item.ops.openableMilestones }) }}
      </p>
      <p v-if="item.ops.paidAmount > 0 || item.ops.pendingAmount > 0" class="text-gray-500">
        {{ t('admin.develop.home.money', { paid: formatKrw(item.ops.paidAmount), pending: formatKrw(item.ops.pendingAmount) }) }}
      </p>
      <p v-if="quiet" class="text-gray-400">
        {{ t('admin.develop.home.noSignal') }}
      </p>
    </div>

    <!-- 딥링크 3개 — 건 안에서 다음에 열 곳. -->
    <div class="flex flex-wrap gap-1.5">
      <RouterLink
        v-for="link in [{ tab: 'review', key: 'review' }, { tab: 'quotes', key: 'quotes' }, { tab: 'documents', key: 'documents' }]"
        :key="link.key"
        :to="to(link.tab)"
        class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
      >
        {{ t(`admin.develop.home.open.${link.key}`) }}
      </RouterLink>
    </div>
  </article>
</template>
