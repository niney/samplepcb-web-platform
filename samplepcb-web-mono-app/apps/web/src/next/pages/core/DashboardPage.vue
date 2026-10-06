<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRightIcon, CircleCheckIcon } from '@lucide/vue';
import { emptyMailLogFilters, useAdminMailLogList, type AdminMailLogFilters } from '@/admin/useAdminMailLogs';
import { useBomQuoteRetentionStatus } from '@/admin/useAdminDeleteAudits';
import { formatDate, formatDateTime } from '@/lib/format';
import { NEXT_CORE_ROUTES } from '@/next/core-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 관리자 대시보드 — 옛 pages/admin/AdminDashboard.vue 의 짝. 위젯 둘 다 "조치가 필요한가"의 신호다.
//   · 최근 7일 발송 실패 — skipped 는 게이트의 정상 동작이 다수라 빼고, 전체는 [발송 이력] status=failed 로 연다.
//   · 취소 견적 자동 정리 — 되돌릴 수 없는 자동 삭제라 멈췄거나 밀린 것을 먼저 알린다(자세히·[지금 실행]은 삭제 기록).
const i18n = useI18n();
const { t } = i18n;

// kind 라벨 — i18n 미등록 코드는 원문 노출(MailLogList 와 같은 catchall).
const kindLabel = (kind: string): string =>
  i18n.te(`admin.mailLogs.kind.${kind}`) ? t(`admin.mailLogs.kind.${kind}`) : kind;
// '모두 보기 →' 문구의 글자 화살표는 떼고 아이콘으로 단다(키트 링크 버튼 모양 — 옛 화면과 같은 i18n 키).
const linkText = (key: string): string => t(key).replace(/\s*→\s*$/, '');

// KST 기준 7일 전 날짜(YYYY-MM-DD) — 목록 API 의 dateFrom 계약과 같은 축.
const weekAgo = formatDate(new Date(Date.now() - 7 * 86_400_000).toISOString());
const filters = ref<AdminMailLogFilters>(emptyMailLogFilters({ status: 'failed', dateFrom: weekAgo, pageSize: 5 }));
const { data, isFetching } = useAdminMailLogList(filters);
const failedTotal = computed(() => data.value?.data.total ?? 0);
const failedItems = computed(() => data.value?.data.items ?? []);

const { data: retentionData, isFetching: retentionFetching } = useBomQuoteRetentionStatus();
const retention = computed(() => retentionData.value?.data ?? null);
const retentionText = computed(() => {
  const status = retention.value;
  if (status === null) return '';
  if (status.health === 'ok') return t('admin.dashboard.retention.ok', { pending: status.pendingCount });
  if (status.health === 'backlog') return t('admin.dashboard.retention.backlog', { n: status.overdueCount });
  return t(`admin.dashboard.retention.${status.health}`);
});
const retentionAttention = computed(
  () => retention.value !== null && (retention.value.health === 'stale' || retention.value.health === 'backlog'),
);
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <PageHeader :title="t('admin.menu.dashboard')" />

    <SectionCard :title="t('admin.dashboard.mailFailures.title')">
      <template #meta>
        <Badge v-if="failedTotal > 0" variant="warning" class="tabular-nums">
          {{ t('admin.dashboard.mailFailures.count', { n: failedTotal }) }}
        </Badge>
      </template>
      <template #actions>
        <Button variant="link" size="sm" as-child>
          <RouterLink :to="{ name: NEXT_CORE_ROUTES.mailLogs, query: { status: 'failed' } }">
            {{ linkText('admin.dashboard.mailFailures.viewAll') }}
            <ArrowRightIcon />
          </RouterLink>
        </Button>
      </template>

      <p v-if="isFetching && failedItems.length === 0" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Spinner />
        {{ t('admin.mailLogs.loading') }}
      </p>
      <p v-else-if="failedTotal === 0" class="text-success inline-flex items-center gap-1.5 text-sm">
        <CircleCheckIcon class="size-4" />
        {{ t('admin.dashboard.mailFailures.empty') }}
      </p>
      <ul v-else class="divide-y">
        <li
          v-for="item in failedItems"
          :key="item.logId"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
        >
          <span class="text-muted-foreground whitespace-nowrap tabular-nums">{{ formatDateTime(item.createdAt) }}</span>
          <span class="font-medium">{{ kindLabel(item.kind) }}</span>
          <span class="text-muted-foreground max-w-56 truncate" :title="item.recipient">
            {{ item.recipient === '' ? t('admin.mailLogs.unknownRecipient') : item.recipient }}
          </span>
          <span v-if="item.reason !== null" class="text-destructive max-w-72 truncate text-xs" :title="item.reason">
            {{ item.reason }}
          </span>
        </li>
      </ul>
    </SectionCard>

    <SectionCard :title="t('admin.dashboard.retention.title')" data-testid="dashboard-retention">
      <template #meta>
        <Badge v-if="retention !== null && retentionAttention" variant="warning">
          {{ t(`admin.deleteAudits.retention.health.${retention.health}`) }}
        </Badge>
      </template>
      <template #actions>
        <Button variant="link" size="sm" as-child>
          <RouterLink :to="{ name: NEXT_CORE_ROUTES.deleteAudits }">
            {{ linkText('admin.dashboard.retention.viewAll') }}
            <ArrowRightIcon />
          </RouterLink>
        </Button>
      </template>

      <p v-if="retention === null" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <template v-if="retentionFetching">
          <Spinner />
          {{ t('admin.deleteAudits.loading') }}
        </template>
        <template v-else>—</template>
      </p>
      <p
        v-else
        class="inline-flex items-center gap-1.5 text-sm"
        :class="retention.health === 'ok' ? 'text-success' : retention.health === 'disabled' ? 'text-muted-foreground' : 'text-warning'"
      >
        <CircleCheckIcon v-if="retention.health === 'ok'" class="size-4" />
        {{ retentionText }}
      </p>
    </SectionCard>
  </div>
</template>
