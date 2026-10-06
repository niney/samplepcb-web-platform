<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RefreshCwIcon } from '@lucide/vue';
import { formatDateTime } from '@/lib/format';
import { useAiJobLog, useInvalidateAiJobLog } from '@/admin/useAdminSettings';
import ListPagination from '@/next/components/common/ListPagination.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { aiJobStageLabel, aiJobStatusBadge } from './ai-labels';

// 실행 이력(sp_ai_job) — 옛 AiSettingsForm 마지막 블록. 쪽 20건, 수동 새로고침. 샘플 테스트가 끝나면
// AiSampleTest 가 같은 키를 무효화해 방금 실행이 위에 보인다. 회원 식별자는 서버가 마스킹해서만 준다.
const { t } = useI18n();
const jobPage = ref(1);
const JOB_PAGE_SIZE = 20;
const jobLog = useAiJobLog(jobPage, JOB_PAGE_SIZE);
const invalidateJobLog = useInvalidateAiJobLog();
</script>

<template>
  <SectionCard :title="t('admin.settings.ai.jobs.title')" flush>
    <template #actions>
      <Button type="button" variant="outline" size="sm" :disabled="jobLog.isFetching.value" @click="invalidateJobLog">
        <RefreshCwIcon />
        {{ t('admin.settings.ai.jobs.refresh') }}
      </Button>
    </template>

    <TableCard bare>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('admin.settings.ai.jobs.colStartedAt') }}</TableHead>
            <TableHead>{{ t('admin.settings.ai.jobs.colStage') }}</TableHead>
            <TableHead>{{ t('admin.settings.ai.jobs.colModel') }}</TableHead>
            <TableHead>{{ t('admin.settings.ai.jobs.colStatus') }}</TableHead>
            <TableHead class="text-right">{{ t('admin.settings.ai.jobs.colElapsed') }}</TableHead>
            <TableHead>{{ t('admin.settings.ai.jobs.colError') }}</TableHead>
            <TableHead>{{ t('admin.settings.ai.jobs.colMember') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="j in jobLog.data.value?.data.items ?? []" :key="j.jobId">
            <TableCell class="text-muted-foreground tabular-nums">{{ formatDateTime(j.startedAt) }}</TableCell>
            <TableCell>{{ aiJobStageLabel(t, j.stage) }}</TableCell>
            <TableCell class="font-mono text-xs">{{ j.model }}</TableCell>
            <TableCell>
              <Badge :variant="aiJobStatusBadge(t, j.status).variant">{{ aiJobStatusBadge(t, j.status).label }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground text-right tabular-nums">{{ j.elapsedSecs }}</TableCell>
            <TableCell class="text-destructive">
              <span class="block max-w-64 truncate" :title="j.error ?? ''">{{ j.error ?? '-' }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ j.mbIdMasked }}</TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="(jobLog.data.value?.data.items ?? []).length === 0"
            :colspan="7"
            :text="t('admin.settings.ai.jobs.empty')"
            :loading="jobLog.isFetching.value"
          />
        </TableBody>
      </Table>
    </TableCard>

    <div v-if="jobLog.data.value !== undefined" class="border-t p-4">
      <ListPagination
        :page="jobPage"
        :page-size="JOB_PAGE_SIZE"
        :total="jobLog.data.value.data.total"
        @update:page="(p) => (jobPage = p)"
      >
        <template #summary>{{ t('admin.settings.ai.jobs.total', { total: jobLog.data.value.data.total }) }}</template>
      </ListPagination>
    </div>
  </SectionCard>
</template>
