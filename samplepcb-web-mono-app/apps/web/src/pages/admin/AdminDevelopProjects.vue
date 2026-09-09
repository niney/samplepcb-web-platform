<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS } from '../../components/admin/develop/develop-queue';

// 진행 프로젝트 큐(docs/DEVELOP_FLOW.md §14) — tab `in_progress` 하나라 탭 바 대신
// 신호 토글(회신 대기만 · 기한 초과만)을 세운다. 행 클릭은 상세 「프로젝트 문서」 탭.
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.develop.queue.projects.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.develop.queue.projects.desc') }}</p>
    </div>
    <DevelopQueueTable
      :tabs="['in_progress']"
      default-tab="in_progress"
      :columns="DEVELOP_QUEUE_PRESETS.projects"
      :signal-toggles="['docs_awaiting', 'reply_overdue']"
      detail-tab="documents"
    />
  </div>
</template>
