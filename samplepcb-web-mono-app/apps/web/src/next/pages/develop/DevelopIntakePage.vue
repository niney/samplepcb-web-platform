<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUEUE_PRESETS } from '@/components/admin/develop/develop-queue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import DevelopQueueTable from '@/next/components/develop/queue/DevelopQueueTable.vue';

// 접수·검토 큐(docs/DEVELOP_FLOW.md §14) — tab `intake` = received + reviewing.
// 행 클릭은 상세 「AI 검토서」 탭으로 딥링크한다(이 단계에서 손대는 곳).
// 옛 pages/admin/AdminDevelopIntake.vue 의 리뉴얼 — 탭·열·신호는 같다.
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.queue.intake.title')" :description="t('admin.develop.queue.intake.desc')" />
    <DevelopQueueTable
      :tabs="['intake', 'received', 'reviewing']"
      default-tab="intake"
      :columns="DEVELOP_QUEUE_PRESETS.intake"
      detail-tab="review"
    />
  </div>
</template>
