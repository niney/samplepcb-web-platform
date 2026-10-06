<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUEUE_PRESETS } from '@/components/admin/develop/develop-queue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import DevelopQueueTable from '@/next/components/develop/queue/DevelopQueueTable.vue';

// 진행 프로젝트 큐(docs/DEVELOP_FLOW.md §14) — tab `in_progress` 하나라 탭 바 대신
// 신호 토글(회신 대기만 · 기한 초과만)을 세운다. 행 클릭은 상세 「프로젝트 문서」 탭.
// 옛 pages/admin/AdminDevelopProjects.vue 의 리뉴얼 — 탭·열·신호는 같다.
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.queue.projects.title')" :description="t('admin.develop.queue.projects.desc')" />
    <DevelopQueueTable
      :tabs="['in_progress']"
      default-tab="in_progress"
      :columns="DEVELOP_QUEUE_PRESETS.projects"
      :signal-toggles="['docs_awaiting', 'reply_overdue']"
      detail-tab="documents"
    />
  </div>
</template>
