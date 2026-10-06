<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import type { AdminMailLogFilters } from '@/admin/useAdminMailLogs';
import MailLogList from '@/next/components/common/MailLogList.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';

// 발송 이력(전 채널: 메일·알림톡·SMS) 전역 조회 — 옛 pages/admin/AdminMailLogs.vue 의 짝. 필터·목록·펼침은
// MailLogList(Case 상세 '보낸 메일' 임베드와 공용 키트)가 맡는다.
// URL 쿼리(status·kind·channel·dateFrom·dateTo)는 초기 필터 프리셋 — 대시보드 실패 위젯 링크 진입용.
const { t } = useI18n();
const route = useRoute();

const qs = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStatus = (v: string): AdminMailLogFilters['status'] =>
  v === 'sent' || v === 'failed' || v === 'skipped' ? v : '';
const asChannel = (v: string): AdminMailLogFilters['channel'] =>
  v === 'email' || v === 'alimtalk' || v === 'sms' ? v : '';
const initial: Partial<AdminMailLogFilters> = {
  status: asStatus(qs(route.query.status)),
  channel: asChannel(qs(route.query.channel)),
  kind: qs(route.query.kind),
  dateFrom: qs(route.query.dateFrom),
  dateTo: qs(route.query.dateTo),
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="t('admin.mailLogs.title')" :description="t('admin.mailLogs.subtitle')" />
    <MailLogList :initial="initial" />
  </div>
</template>
