<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop-c/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS } from '../../components/admin/develop-c/develop-queue';

// 납품·검수 큐(docs/DEVELOP_FLOW.md §14) — tab `delivered`. 잔금 마일스톤 상태는
// latestQuote 로 알 수 없어 견적 열을 두지 않는다. 행 클릭은 상세 「타임라인」 탭.
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.developC.queue.deliveries.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.developC.queue.deliveries.desc') }}</p>
    </div>
    <DevelopQueueTable
      :tabs="['delivered']"
      default-tab="delivered"
      :columns="DEVELOP_QUEUE_PRESETS.deliveries"
      detail-tab="timeline"
    />
  </div>
</template>
