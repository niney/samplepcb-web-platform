<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop-c/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS } from '../../components/admin/develop-c/develop-queue';

// 접수·검토 큐(docs/DEVELOP_FLOW.md §14) — tab `intake` = received + reviewing.
// 행 클릭은 상세 「AI 검토서」 탭으로 딥링크한다(이 단계에서 손대는 곳).
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.developC.queue.intake.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.developC.queue.intake.desc') }}</p>
    </div>
    <DevelopQueueTable
      :tabs="['intake', 'received', 'reviewing']"
      default-tab="intake"
      :columns="DEVELOP_QUEUE_PRESETS.intake"
      detail-tab="review"
    />
  </div>
</template>
