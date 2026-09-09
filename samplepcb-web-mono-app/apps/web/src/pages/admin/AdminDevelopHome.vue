<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopRequestListItemType, DevelopRequestStatusType } from '@sp/api-contract';
import { emptyDevelopFilters, useAdminDevelopList } from '../../admin/useAdminDevelop';
import DevelopHomeCard from '../../components/admin/develop/DevelopHomeCard.vue';

// 개발 모듈 홈 = 진행현황(docs/DEVELOP_FLOW.md §14) — 활성 의뢰(접수~납품·검수)의 횡단 조감.
// 건 하나의 00 현황은 상세 「프로젝트 문서」 탭 상단 띠가 이미 맡으므로, 여기는 여러 건을
// 한 화면에서 훑고 "내 차례"인 건을 위로 올리는 데만 쓴다.
// 데이터는 목록 호출 한 번(tab=all&pageSize=100) — 활성 상태 추리기는 클라이언트에서.
// 100건을 넘는 활성 의뢰가 생기면 서버 탭 하나로 바꿔야 한다(현재 전체 의뢰 6건).
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

// 정렬 = "내 차례" 순: 기한 초과 → 확인 대기 → 미답변 문의 → 최신.
const rank = (r: AdminDevelopRequestListItemType): number =>
  (r.ops.replyOverdue ? 1_000_000 : 0) + r.ops.pendingApprovals * 1_000 + r.ops.openInquiries * 10;
const activeItems = computed(() =>
  (data.value?.data.items ?? [])
    .filter((r) => ACTIVE_STATUSES.includes(r.status))
    .sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt)),
);

// 요약 칩 — counts(단계별 큐와 같은 수) + signals(활성 의뢰 전체 기준 신호). 클릭하면 그 큐로.
const chips = computed(() => {
  const d = data.value?.data;
  if (d === undefined) return [];
  return [
    { key: 'intake', n: d.counts.intake, to: 'admin-develop-intake', tone: 'gray' },
    { key: 'contract', n: d.counts.contract, to: 'admin-develop-contracts', tone: 'gray' },
    { key: 'inProgress', n: d.counts.in_progress, to: 'admin-develop-projects', tone: 'gray' },
    { key: 'delivered', n: d.counts.delivered, to: 'admin-develop-deliveries', tone: 'gray' },
    { key: 'docsAwaiting', n: d.signals.docsAwaiting, to: 'admin-develop-projects', tone: 'amber' },
    { key: 'replyOverdue', n: d.signals.replyOverdue, to: 'admin-develop-projects', tone: 'red' },
    { key: 'inquiriesOpen', n: d.signals.inquiriesOpen, to: 'admin-develop-inquiries', tone: 'amber' },
  ] as const;
});
const chipClass = (tone: 'gray' | 'amber' | 'red', n: number): string =>
  n === 0
    ? 'border-gray-200 bg-white text-gray-400'
    : tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-gray-200 bg-white text-gray-700';
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.develop.home.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.develop.home.desc') }}</p>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <RouterLink
        v-for="chip in chips"
        :key="chip.key"
        :to="{ name: chip.to }"
        class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold hover:brightness-95"
        :class="chipClass(chip.tone, chip.n)"
      >
        {{ t(`admin.develop.home.chip.${chip.key}`) }}
        <b class="text-base">{{ chip.n }}</b>
      </RouterLink>
    </div>

    <div v-if="activeItems.length > 0" class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      <DevelopHomeCard v-for="item in activeItems" :key="item.requestId" :item="item" />
    </div>
    <p v-else class="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
      {{ isFetching ? t('admin.develop.loading') : t('admin.develop.home.empty') }}
    </p>
  </div>
</template>
