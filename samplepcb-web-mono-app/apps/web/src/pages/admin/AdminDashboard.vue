<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  emptyMailLogFilters,
  useAdminMailLogList,
  type AdminMailLogFilters,
} from '../../admin/useAdminMailLogs';
import { formatDate, formatDateTime } from '../../lib/format';
import UiBadge from '../../components/ui/UiBadge.vue';

// 관리자 대시보드 — 첫 위젯: 최근 7일 발송 실패(조치 필요 신호). skipped 는 게이트의
// 정상 동작이 다수라 위젯에선 제외하고, 전체는 [발송 이력] status=failed 프리셋으로 연다.
const i18n = useI18n();
const { t } = i18n;

// kind 라벨 — i18n 미등록 코드는 원문 노출(MailLogList 와 동일 catchall).
const kindLabel = (kind: string): string =>
  i18n.te(`admin.mailLogs.kind.${kind}`) ? t(`admin.mailLogs.kind.${kind}`) : kind;

// KST 기준 7일 전 날짜(YYYY-MM-DD) — 목록 API 의 dateFrom 계약과 동일 축.
const weekAgo = formatDate(new Date(Date.now() - 7 * 86_400_000).toISOString());
const filters = ref<AdminMailLogFilters>(
  emptyMailLogFilters({ status: 'failed', dateFrom: weekAgo, pageSize: 5 }),
);
const { data, isFetching } = useAdminMailLogList(filters);
const failedTotal = computed(() => data.value?.data.total ?? 0);
const failedItems = computed(() => data.value?.data.items ?? []);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.menu.dashboard') }}</h1>

    <section class="max-w-3xl rounded-xl border border-gray-200 bg-surface p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-bold text-gray-800">
          {{ t('admin.dashboard.mailFailures.title') }}
          <UiBadge
            v-if="failedTotal > 0"
            variant="warn"
            :label="t('admin.dashboard.mailFailures.count', { n: failedTotal })"
          />
        </h2>
        <RouterLink
          :to="{ name: 'admin-mail-logs', query: { status: 'failed' } }"
          class="text-xs font-semibold text-blue-600 hover:underline"
        >
          {{ t('admin.dashboard.mailFailures.viewAll') }}
        </RouterLink>
      </div>

      <p v-if="isFetching && failedItems.length === 0" class="mt-3 text-sm text-gray-400">
        {{ t('admin.mailLogs.loading') }}
      </p>
      <p v-else-if="failedTotal === 0" class="mt-3 text-sm text-green-700">
        ✓ {{ t('admin.dashboard.mailFailures.empty') }}
      </p>
      <ul v-else class="mt-3 divide-y divide-gray-100">
        <li
          v-for="item in failedItems"
          :key="item.logId"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
        >
          <span class="whitespace-nowrap text-gray-500">{{ formatDateTime(item.createdAt) }}</span>
          <span class="font-medium">{{ kindLabel(item.kind) }}</span>
          <span class="max-w-[14rem] truncate text-gray-600" :title="item.recipient">
            {{ item.recipient === '' ? t('admin.mailLogs.unknownRecipient') : item.recipient }}
          </span>
          <span v-if="item.reason !== null" class="max-w-[18rem] truncate text-xs text-red-600" :title="item.reason">
            {{ item.reason }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
