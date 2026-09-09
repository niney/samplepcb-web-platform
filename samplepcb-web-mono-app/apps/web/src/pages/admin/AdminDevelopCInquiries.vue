<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DevelopQueueTable from '../../components/admin/develop-c/DevelopQueueTable.vue';
import { DEVELOP_QUEUE_PRESETS } from '../../components/admin/develop-c/develop-queue';

// 문의·A/S 큐(docs/DEVELOP_FLOW.md §14) — tab `all` + signal `inquiries_open`(마지막
// 담당자 답변 뒤에 온 고객 문의·A/S). 정렬은 서버 순(id desc). 행 클릭은 「타임라인」 탭.
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-bold">{{ t('admin.developC.queue.inquiries.title') }}</h1>
      <p class="mt-0.5 text-sm text-gray-500">{{ t('admin.developC.queue.inquiries.desc') }}</p>
    </div>
    <DevelopQueueTable
      :tabs="['all']"
      default-tab="all"
      signal="inquiries_open"
      :columns="DEVELOP_QUEUE_PRESETS.inquiries"
      detail-tab="timeline"
      :empty-text="t('admin.developC.queue.emptyInquiries')"
    />
  </div>
</template>
