<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CircleCheckIcon, PlayIcon, TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { BomQuoteRetentionHealthType } from '@sp/api-contract';
import { useBomQuoteRetentionStatus, useRunBomQuoteRetention } from '@/admin/useAdminDeleteAudits';
import { formatDate, formatDateTime } from '@/lib/format';
import { confirmDialog } from '@/next/lib/dialog';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 취소 견적 자동 정리(보존 기간 배치)의 상태 — 옛 components/admin/BomQuoteRetentionPanel.vue 의 짝.
// "제대로 돌고 있는가"를 두 가지로 본다:
//   돌고 있는가 = 마지막 실행이 두 주기 안에 있다(서버가 실행 요약을 남긴다)
//   지워졌는가 = 기한이 지났는데 남아 있는 취소 견적이 없다(실행 기록이 아니라 데이터에서 센다)
// 못 지운 견적은 해결될 때까지 아래 목록에 계속 뜬다 — 실패 이력을 따로 뒤질 필요가 없다.
const i18n = useI18n();
const { t } = i18n;

const { data, isFetching } = useBomQuoteRetentionStatus();
const status = computed(() => data.value?.data ?? null);

// 배지 뜻 — 정상=끝남(success), 멈춤·밀림=주의(warning), 꺼짐=중립(secondary).
const HEALTH_VARIANT: Record<BomQuoteRetentionHealthType, BadgeVariant> = {
  ok: 'success',
  stale: 'warning',
  backlog: 'warning',
  disabled: 'secondary',
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
        text: error instanceof ApiRequestError ? error.message : t('admin.deleteAudits.retention.runFailed'),
      };
    },
  });
}
</script>

<template>
  <SectionCard :title="t('admin.deleteAudits.retention.title')" data-testid="retention-panel">
    <template #meta>
      <Badge v-if="status !== null" :variant="HEALTH_VARIANT[status.health]" data-testid="retention-health">
        {{ t(`admin.deleteAudits.retention.health.${status.health}`) }}
      </Badge>
    </template>
    <template #actions>
      <Button
        variant="outline"
        size="sm"
        :disabled="status === null || status.health === 'disabled' || run.isPending.value"
        data-testid="retention-run"
        @click="runNow"
      >
        <Spinner v-if="run.isPending.value" />
        <PlayIcon v-else />
        {{ run.isPending.value ? t('admin.deleteAudits.retention.running') : t('admin.deleteAudits.retention.runNow') }}
      </Button>
    </template>

    <p class="text-muted-foreground max-w-3xl text-xs leading-5">{{ t('admin.deleteAudits.retention.description') }}</p>

    <p v-if="status === null" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <template v-if="isFetching">
        <Spinner />
        {{ t('admin.deleteAudits.loading') }}
      </template>
      <template v-else>—</template>
    </p>
    <template v-else>
      <p
        class="inline-flex items-center gap-1.5 text-sm"
        :class="status.health === 'ok' ? 'text-success' : status.health === 'disabled' ? 'text-muted-foreground' : 'text-warning'"
        data-testid="retention-hint"
      >
        <CircleCheckIcon v-if="status.health === 'ok'" class="size-4 shrink-0" />
        {{ t(`admin.deleteAudits.retention.hint.${status.health}`, { hours: status.intervalHours * 2 }) }}
      </p>

      <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Panel tone="muted">
          <dt class="text-muted-foreground text-xs">{{ t('admin.deleteAudits.retention.lastRun') }}</dt>
          <dd v-if="status.lastRun === null" class="mt-1 text-sm font-semibold">
            {{ t('admin.deleteAudits.retention.never') }}
          </dd>
          <dd v-else class="mt-1 text-sm" data-testid="retention-last-run">
            <span class="font-semibold tabular-nums">{{ formatDateTime(status.lastRun.finishedAt) }}</span>
            <span class="text-muted-foreground ml-1 text-xs">{{ lastRunTrigger }}</span>
            <span class="text-muted-foreground mt-0.5 block text-xs tabular-nums">
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
        </Panel>
        <Panel tone="muted">
          <dt class="text-muted-foreground text-xs">{{ t('admin.deleteAudits.retention.overdue') }}</dt>
          <dd
            class="mt-1 text-sm font-semibold tabular-nums"
            :class="status.overdueCount > 0 ? 'text-warning' : ''"
            data-testid="retention-overdue"
          >
            {{ t('admin.deleteAudits.retention.count', { n: status.overdueCount }) }}
          </dd>
        </Panel>
        <Panel tone="muted">
          <dt class="text-muted-foreground text-xs">{{ t('admin.deleteAudits.retention.pending') }}</dt>
          <dd class="mt-1 text-sm" data-testid="retention-pending">
            <span class="font-semibold tabular-nums">
              {{ t('admin.deleteAudits.retention.count', { n: status.pendingCount }) }}
            </span>
            <span v-if="status.nextPurgeAfter !== null" class="text-muted-foreground mt-0.5 block text-xs tabular-nums">
              {{ t('admin.deleteAudits.retention.next') }} {{ formatDate(status.nextPurgeAfter) }}
            </span>
          </dd>
        </Panel>
        <Panel tone="muted">
          <dt class="text-muted-foreground text-xs">{{ t('admin.deleteAudits.retention.retention') }}</dt>
          <dd class="mt-1 text-sm">
            <span class="font-semibold tabular-nums">
              {{ t('admin.deleteAudits.retention.days', { n: status.retentionDays }) }}
            </span>
            <span class="text-muted-foreground mt-0.5 block text-xs tabular-nums">
              {{ t('admin.deleteAudits.retention.interval', { n: status.intervalHours }) }}
            </span>
          </dd>
        </Panel>
      </dl>

      <Alert
        v-if="notice !== null"
        :variant="notice.ok ? 'success' : 'warning'"
        size="sm"
        role="status"
        data-testid="retention-notice"
      >
        <CircleCheckIcon v-if="notice.ok" />
        <TriangleAlertIcon v-else />
        <AlertTitle>{{ notice.text }}</AlertTitle>
      </Alert>

      <!-- 못 지운 견적 — 해결될 때까지 여기 남는다(사유는 마지막 실행이 남긴 것) -->
      <Alert v-if="status.overdueCount > 0" variant="warning" size="sm" data-testid="retention-overdue-list">
        <TriangleAlertIcon />
        <AlertTitle>
          {{ t('admin.deleteAudits.retention.overdueTitle') }}
          <span v-if="status.overdueCount > status.overdue.length" class="text-muted-foreground font-normal">
            ({{ t('admin.deleteAudits.retention.overdueMore', { n: status.overdueCount - status.overdue.length }) }})
          </span>
        </AlertTitle>
        <AlertDescription>
          <ul class="divide-warning/20 w-full divide-y">
            <li
              v-for="item in status.overdue"
              :key="item.quoteId"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 first:pt-0.5 last:pb-0"
            >
              <RouterLink
                :to="smartbomCaseTo(item.quoteId)"
                class="text-primary max-w-88 truncate font-medium underline-offset-4 hover:underline"
                :title="item.title"
              >
                #{{ item.quoteId }} {{ item.title }}
              </RouterLink>
              <span class="text-muted-foreground">{{ item.mbId }}</span>
              <span class="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                {{ t('admin.deleteAudits.retention.purgeAfter') }} {{ formatDate(item.purgeAfter) }}
              </span>
              <span class="text-warning text-xs">
                {{
                  item.reasons.length === 0
                    ? t('admin.deleteAudits.retention.reasonUnknown')
                    : item.reasons.map(reasonLabel).join(', ')
                }}
              </span>
            </li>
          </ul>
        </AlertDescription>
      </Alert>
    </template>
  </SectionCard>
</template>
