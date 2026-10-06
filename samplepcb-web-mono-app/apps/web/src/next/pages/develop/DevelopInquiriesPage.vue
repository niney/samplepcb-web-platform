<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUEUE_PRESETS } from '@/components/admin/develop/develop-queue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import DevelopQueueTable from '@/next/components/develop/queue/DevelopQueueTable.vue';

// 문의·A/S 큐(docs/DEVELOP_FLOW.md §14) — tab `all` + signal `inquiries_open`(마지막
// 담당자 답변 뒤에 온 고객 문의·A/S). 정렬은 서버 순(id desc). 행 클릭은 「타임라인」 탭.
// 옛 pages/admin/AdminDevelopInquiries.vue 의 리뉴얼 — 탭·열·신호는 같다.
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.queue.inquiries.title')" :description="t('admin.develop.queue.inquiries.desc')" />
    <DevelopQueueTable
      :tabs="['all']"
      default-tab="all"
      signal="inquiries_open"
      :columns="DEVELOP_QUEUE_PRESETS.inquiries"
      detail-tab="timeline"
      :empty-text="t('admin.develop.queue.emptyInquiries')"
    />
  </div>
</template>
