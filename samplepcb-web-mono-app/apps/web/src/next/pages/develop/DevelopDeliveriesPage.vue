<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUEUE_PRESETS } from '@/components/admin/develop/develop-queue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import DevelopQueueTable from '@/next/components/develop/queue/DevelopQueueTable.vue';

// 납품·검수 큐(docs/DEVELOP_FLOW.md §14) — tab `delivered`. 잔금 마일스톤 상태는
// latestQuote 로 알 수 없어 견적 열을 두지 않는다. 행 클릭은 상세 「타임라인」 탭.
// 옛 pages/admin/AdminDevelopDeliveries.vue 의 리뉴얼 — 탭·열·신호는 같다.
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.queue.deliveries.title')" :description="t('admin.develop.queue.deliveries.desc')" />
    <DevelopQueueTable
      :tabs="['delivered']"
      default-tab="delivered"
      :columns="DEVELOP_QUEUE_PRESETS.deliveries"
      detail-tab="timeline"
    />
  </div>
</template>
