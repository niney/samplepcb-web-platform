<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS } from '../../components/admin/develop/develop-queue';

// 견적·계약 큐(docs/DEVELOP_FLOW.md §14) — tab `contract` = quoted + accepted(결제 대기).
// 행 클릭은 상세 「견적서」 탭으로 딥링크한다.
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.develop.queue.contracts.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.develop.queue.contracts.desc') }}</p>
    </div>
    <DevelopQueueTable
      :tabs="['contract', 'quoted', 'accepted']"
      default-tab="contract"
      :columns="DEVELOP_QUEUE_PRESETS.contracts"
      detail-tab="quotes"
    />
  </div>
</template>
