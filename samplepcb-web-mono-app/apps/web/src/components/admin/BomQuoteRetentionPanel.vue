<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import type { BomQuoteRetentionHealthType } from '@sp/api-contract';
import {
  useBomQuoteRetentionStatus,
  useRunBomQuoteRetention,
} from '../../admin/useAdminDeleteAudits';
import { confirmDialog } from '../../lib/confirmDialog';
import { formatDate, formatDateTime } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';

// 취소 견적 자동 정리(보존 기간 배치)의 상태 — "제대로 돌고 있는가"를 두 가지로 본다:
//   돌고 있는가      = 마지막 실행이 두 주기 안에 있다(서버가 실행 요약을 남긴다)
//   지워졌는가       = 기한이 지났는데 남아 있는 취소 견적이 없다(실행 기록이 아니라 데이터에서 센다)
// 못 지운 견적은 해결될 때까지 아래 목록에 계속 뜬다 — 실패 이력을 따로 뒤질 필요가 없다.
const i18n = useI18n();
const { t } = i18n;

const { data, isFetching } = useBomQuoteRetentionStatus();
const status = computed(() => data.value?.data ?? null);

// 배지 색 — .vue 에서 온 타입을 주석에 물리지 않는다(ESLint 오탐), 리터럴 유니온으로 둔다.
const HEALTH_VARIANT: Record<BomQuoteRetentionHealthType, 'success' | 'warn' | 'muted'> = {
  ok: 'success',
  stale: 'warn',
  backlog: 'warn',
  disabled: 'muted',
};

const lastRunTrigger = computed(() => {
  const run = status.value?.lastRun ?? null;
  if (run === null) return '';
  return run.trigger === 'manual'
    ? t('admin.deleteAudits.retention.triggerManual', { actor: run.actorMbId ?? '-' })
    : t('admin.deleteAudits.retention.triggerTimer');
});

// 차단 사유 코드는 사전에 있으면 풀어 쓰고, 없으면(오류 문구 등) 원문을 보여 준다.
const reasonLabel = (reason: string): string => {
  const key = `admin.deleteAudits.retention.blocker.${reason}`;
  return i18n.te(key) ? t(key) : reason;
};

const run = useRunBomQuoteRetention();
const notice = ref<{ ok: boolean; text: string } | null>(null);

async function runNow(): Promise<void> {
  if (run.isPending.value) return;
  const confirmed = await confirmDialog({
    title: t('admin.deleteAudits.retention.runConfirmTitle'),
    message: t('admin.deleteAudits.retention.runConfirm'),
    confirmLabel: t('admin.deleteAudits.retention.runNow'),
    tone: 'danger',
  });
  if (!confirmed) return;
  notice.value = null;
  run.mutate(undefined, {
    onSuccess: (res) => {
      notice.value = {
        ok: res.data.run.failed.length === 0,
        text: t('admin.deleteAudits.retention.runDone', {
          deleted: res.data.run.deleted,
          skipped: res.data.run.skipped.length,
          failed: res.data.run.failed.length,
        }),
      };
    },
    onError: (error) => {
      notice.value = {
        ok: false,
        text:
          error instanceof ApiRequestError
            ? error.message
            : t('admin.deleteAudits.retention.runFailed'),
      };
    },
  });
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-surface p-4" data-testid="retention-panel">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-800">
          {{ t('admin.deleteAudits.retention.title') }}
          <UiBadge
            v-if="status !== null"
            :variant="HEALTH_VARIANT[status.health]"
            :label="t(`admin.deleteAudits.retention.health.${status.health}`)"
            data-testid="retention-health"
          />
        </h2>
        <p class="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
          {{ t('admin.deleteAudits.retention.description') }}
        </p>
      </div>
      <button
        type="button"
        class="rounded border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="status === null || status.health === 'disabled' || run.isPending.value"
        data-testid="retention-run"
        @click="runNow"
      >
        {{ run.isPending.value ? t('admin.deleteAudits.retention.running') : t('admin.deleteAudits.retention.runNow') }}
      </button>
    </div>

    <p v-if="status === null" class="mt-3 text-sm text-gray-400">
      {{ isFetching ? t('admin.deleteAudits.loading') : '—' }}
    </p>
    <template v-else>
      <p
        class="mt-3 text-sm"
        :class="status.health === 'ok' ? 'text-green-700' : status.health === 'disabled' ? 'text-gray-500' : 'text-amber-700'"
        data-testid="retention-hint"
      >
        {{ status.health === 'ok' ? '✓ ' : '' }}{{
          t(`admin.deleteAudits.retention.hint.${status.health}`, { hours: status.intervalHours * 2 })
        }}
      </p>

      <dl class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <dt class="text-xs text-gray-500">{{ t('admin.deleteAudits.retention.lastRun') }}</dt>
          <dd v-if="status.lastRun === null" class="mt-1 text-sm font-semibold text-gray-700">
            {{ t('admin.deleteAudits.retention.never') }}
          </dd>
          <dd v-else class="mt-1 text-sm text-gray-800" data-testid="retention-last-run">
            <span class="font-semibold">{{ formatDateTime(status.lastRun.finishedAt) }}</span>
            <span class="ml-1 text-xs text-gray-500">{{ lastRunTrigger }}</span>
            <span class="mt-0.5 block text-xs text-gray-600">
              {{
                t('admin.deleteAudits.retention.result', {
                  deleted: status.lastRun.deleted,
                  skipped: status.lastRun.skipped.length,
                  failed: status.lastRun.failed.length,
                })
              }}
              <template v-if="status.lastRun.deferred > 0">
                · {{ t('admin.deleteAudits.retention.deferred', { n: status.lastRun.deferred }) }}
              </template>
            </span>
          </dd>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <dt class="text-xs text-gray-500">{{ t('admin.deleteAudits.retention.overdue') }}</dt>
          <dd
            class="mt-1 text-sm font-semibold"
            :class="status.overdueCount > 0 ? 'text-amber-700' : 'text-gray-800'"
            data-testid="retention-overdue"
          >
            {{ t('admin.deleteAudits.retention.count', { n: status.overdueCount }) }}
          </dd>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <dt class="text-xs text-gray-500">{{ t('admin.deleteAudits.retention.pending') }}</dt>
          <dd class="mt-1 text-sm text-gray-800" data-testid="retention-pending">
            <span class="font-semibold">
              {{ t('admin.deleteAudits.retention.count', { n: status.pendingCount }) }}
            </span>
            <span v-if="status.nextPurgeAfter !== null" class="mt-0.5 block text-xs text-gray-600">
              {{ t('admin.deleteAudits.retention.next') }} {{ formatDate(status.nextPurgeAfter) }}
            </span>
          </dd>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2.5">
          <dt class="text-xs text-gray-500">{{ t('admin.deleteAudits.retention.retention') }}</dt>
          <dd class="mt-1 text-sm text-gray-800">
            <span class="font-semibold">
              {{ t('admin.deleteAudits.retention.days', { n: status.retentionDays }) }}
            </span>
            <span class="mt-0.5 block text-xs text-gray-600">
              {{ t('admin.deleteAudits.retention.interval', { n: status.intervalHours }) }}
            </span>
          </dd>
        </div>
      </dl>

      <p
        v-if="notice !== null"
        class="mt-3 rounded-lg px-3 py-2 text-sm"
        :class="notice.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'"
        role="status"
        data-testid="retention-notice"
      >
        {{ notice.text }}
      </p>

      <!-- 못 지운 견적 — 해결될 때까지 여기 남는다(사유는 마지막 실행이 남긴 것) -->
      <div v-if="status.overdueCount > 0" class="mt-3" data-testid="retention-overdue-list">
        <h3 class="text-xs font-bold text-amber-800">
          {{ t('admin.deleteAudits.retention.overdueTitle') }}
          <span v-if="status.overdueCount > status.overdue.length" class="font-normal text-gray-500">
            ({{ t('admin.deleteAudits.retention.overdueMore', { n: status.overdueCount - status.overdue.length }) }})
          </span>
        </h3>
        <ul class="mt-1.5 divide-y divide-amber-100 rounded-lg border border-amber-200 bg-amber-50/40">
          <li
            v-for="item in status.overdue"
            :key="item.quoteId"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <RouterLink
              :to="{ name: 'admin-smartbom-case', params: { id: item.quoteId } }"
              class="max-w-[22rem] truncate font-medium text-blue-600 hover:underline"
              :title="item.title"
            >
              #{{ item.quoteId }} {{ item.title }}
            </RouterLink>
            <span class="text-gray-500">{{ item.mbId }}</span>
            <span class="whitespace-nowrap text-xs text-gray-500">
              {{ t('admin.deleteAudits.retention.purgeAfter') }} {{ formatDate(item.purgeAfter) }}
            </span>
            <span class="text-xs text-amber-800">
              {{
                item.reasons.length === 0
                  ? t('admin.deleteAudits.retention.reasonUnknown')
                  : item.reasons.map(reasonLabel).join(', ')
              }}
            </span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
