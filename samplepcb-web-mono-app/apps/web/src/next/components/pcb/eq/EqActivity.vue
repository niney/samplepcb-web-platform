<script setup lang="ts">
// EQ 작업공간 3열 '활동' — 이 회차의 이벤트 원장(sp_pcb_eq_review_event: 작성 시작·발송·회신·대리 회신·
// 전달·취소)과 발주서의 EQ 전이(승인요청·반려·승인)를 한 줄기 시간순으로. 회차 이벤트는 덧붙이기만 하는
// 원장이라 화면도 고치지 않고 그대로 읽는다. 대리 회신의 메모는 "누가 어떤 경로로 들었는가"의 근거다.
import { computed } from 'vue';
import {
  PCB_EQ_ANSWER_CHANNEL_LABELS,
  PCB_EQ_REVIEW_EVENT_ACTION_LABELS,
  pcbEqEventLabel,
  type AdminPcbEqReviewViewType,
  type PcbEqEventType,
  type PcbPoTrackType,
} from '@sp/api-contract';
import { formatDateTime } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import type { BadgeVariant } from '@/next/components/common/badge-types';

const props = defineProps<{
  review: AdminPcbEqReviewViewType | null;
  poHistory: PcbEqEventType[];
  track: PcbPoTrackType;
}>();

interface Row {
  key: string;
  at: string;
  source: 'round' | 'po';
  label: string;
  variant: BadgeVariant;
  actor: string;
  note: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '관리자',
  PARTNER: '협력사',
  MASTER_DEALER: '마스터딜러',
};

const rows = computed((): Row[] => {
  const round: Row[] = (props.review?.events ?? []).map((e): Row => ({
    key: `r${String(e.id)}`,
    at: e.createdAt,
    source: 'round',
    label: PCB_EQ_REVIEW_EVENT_ACTION_LABELS[e.action],
    variant: e.action === 'canceled' ? 'secondary' : e.action === 'answered' || e.action === 'proxy_answered' ? 'success' : 'info',
    actor: [
      // 승인요청 때 자동으로 돈 AI 분석은 사람이 아니다(D20 P2) — 관리자가 눌러 돌린 분석은 그 관리자로 남는다.
      e.actorRole === 'customer'
        ? '고객'
        : e.actorRole === 'admin'
          ? `관리자${e.actorMbId === null ? '' : ` ${e.actorMbId}`}`
          : e.action === 'ai_drafted'
            ? 'AI 자동 분석'
            : '시스템',
      e.channel === null ? null : PCB_EQ_ANSWER_CHANNEL_LABELS[e.channel],
    ]
      .filter((part) => part !== null)
      .join(' · '),
    note: e.note,
  }));
  const po: Row[] = props.poHistory.map((e, i): Row => ({
    key: `p${String(i)}`,
    at: e.at,
    source: 'po',
    label: pcbEqEventLabel(e, props.track),
    variant: 'outline',
    actor: ROLE_LABELS[e.byRole] ?? e.byRole,
    note: e.note,
  }));
  return [...round, ...po].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
});
</script>

<template>
  <div class="grid gap-3">
    <div>
      <p class="text-xs font-semibold">활동</p>
      <p class="text-muted-foreground mt-0.5 text-xs">이 회차의 기록과 발주서 EQ 전이를 시간순으로 — 회차 기록은 덧붙이기만 합니다.</p>
    </div>
    <Panel v-if="rows.length === 0" size="md" class="text-muted-foreground border-dashed text-center text-xs">기록이 없습니다.</Panel>
    <ol v-else class="grid gap-2" aria-label="활동 기록">
      <li v-for="row in rows" :key="row.key" :data-eq-activity="row.source">
        <Panel size="xs" :tone="row.source === 'po' ? 'muted' : 'default'" class="grid gap-0.5 text-xs">
          <p class="flex flex-wrap items-center gap-1.5">
            <Badge :variant="row.variant">{{ row.label }}</Badge>
            <span class="text-muted-foreground">{{ row.source === 'po' ? '발주 EQ' : '회차' }} · {{ row.actor }}</span>
            <span class="text-muted-foreground ml-auto tabular-nums">{{ formatDateTime(row.at) }}</span>
          </p>
          <p v-if="row.note !== null && row.note !== ''" class="whitespace-pre-wrap">{{ row.note }}</p>
        </Panel>
      </li>
    </ol>
  </div>
</template>
