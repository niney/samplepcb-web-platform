<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ExternalLinkIcon } from '@lucide/vue';
import type { AdminDevelopRequestListItemType, DevelopRequestStatusType } from '@sp/api-contract';
import { emptyDevelopFilters, useAdminDevelopList } from '@/admin/useAdminDevelop';
import { NEXT_DEVELOP_ROUTES } from '@/next/develop-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import DevelopHomeCard from '@/next/components/develop/queue/DevelopHomeCard.vue';

// 개발 모듈 홈 = 진행현황(docs/DEVELOP_FLOW.md §14) — 옛 pages/admin/AdminDevelopHome.vue 의 리뉴얼.
// 활성 의뢰(접수~납품·검수)의 횡단 조감. 건 하나의 00 현황은 상세 「프로젝트 문서」 탭 상단 띠가 맡으므로,
// 여기는 여러 건을 한 화면에서 훑고 "내 차례"인 건을 위로 올리는 데만 쓴다.
// 데이터는 목록 호출 한 번(tab=all&pageSize=100) — 활성 상태 추리기는 클라이언트에서(옛 화면과 같음).
const { t } = useI18n();

const filters = ref({ ...emptyDevelopFilters(), pageSize: 100 });
const { data, isFetching } = useAdminDevelopList(filters);

const ACTIVE_STATUSES: readonly DevelopRequestStatusType[] = [
  'received',
  'reviewing',
  'quoted',
  'accepted',
  'in_progress',
  'delivered',
];

// 정렬 = "내 차례" 순: 기한 초과 → 확인 대기 → 열어야 할 청구 → 미답변 문의 → 지연 작업 → 최신.
const rank = (r: AdminDevelopRequestListItemType): number =>
  (r.ops.replyOverdue ? 1_000_000 : 0) +
  r.ops.pendingApprovals * 1_000 +
  r.ops.openableMilestones * 100 +
  r.ops.openInquiries * 10 +
  r.ops.overdueTasks;
const activeItems = computed(() =>
  (data.value?.data.items ?? [])
    .filter((r) => ACTIVE_STATUSES.includes(r.status))
    .sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt)),
);

// 요약 칩 — counts(단계별 큐와 같은 수) + signals(활성 의뢰 전체 기준 신호). 누르면 그 큐로.
type ChipTone = 'gray' | 'amber' | 'red';
const chips = computed(() => {
  const d = data.value?.data;
  if (d === undefined) return [];
  return [
    { key: 'intake', n: d.counts.intake, to: NEXT_DEVELOP_ROUTES.intake, tone: 'gray' },
    { key: 'contract', n: d.counts.contract, to: NEXT_DEVELOP_ROUTES.contracts, tone: 'gray' },
    { key: 'inProgress', n: d.counts.in_progress, to: NEXT_DEVELOP_ROUTES.projects, tone: 'gray' },
    { key: 'delivered', n: d.counts.delivered, to: NEXT_DEVELOP_ROUTES.deliveries, tone: 'gray' },
    { key: 'docsAwaiting', n: d.signals.docsAwaiting, to: NEXT_DEVELOP_ROUTES.projects, tone: 'amber' },
    { key: 'replyOverdue', n: d.signals.replyOverdue, to: NEXT_DEVELOP_ROUTES.projects, tone: 'red' },
    { key: 'inquiriesOpen', n: d.signals.inquiriesOpen, to: NEXT_DEVELOP_ROUTES.inquiries, tone: 'amber' },
  ] as const satisfies readonly { key: string; n: number; to: string; tone: ChipTone }[];
});
// 0 건은 테두리만(조용히), 신호 칩은 주의·위험색으로 — 옛 칩의 색 규칙과 같다.
const chipVariant = (tone: ChipTone, n: number): BadgeVariant =>
  n === 0 ? 'outline' : tone === 'red' ? 'danger' : tone === 'amber' ? 'warning' : 'secondary';
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.home.title')" :description="t('admin.develop.home.desc')">
      <template #actions>
        <Button variant="outline" as-child>
          <a href="/develop/request" target="_blank" rel="noopener">
            {{ t('admin.prototypeRequest') }}
            <ExternalLinkIcon />
          </a>
        </Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap gap-2">
      <Button v-for="chip in chips" :key="chip.key" variant="outline" size="sm" as-child>
        <RouterLink :to="{ name: chip.to }">
          {{ t(`admin.develop.home.chip.${chip.key}`) }}
          <Badge :variant="chipVariant(chip.tone, chip.n)" class="tabular-nums">{{ chip.n }}</Badge>
        </RouterLink>
      </Button>
    </div>

    <div v-if="activeItems.length > 0" class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      <DevelopHomeCard v-for="item in activeItems" :key="item.requestId" :item="item" />
    </div>
    <Panel v-else size="md" class="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
      <Spinner v-if="isFetching" />
      {{ isFetching ? t('admin.develop.loading') : t('admin.develop.home.empty') }}
    </Panel>
  </div>
</template>
