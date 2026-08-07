<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MailLogList from '../../components/admin/MailLogList.vue';
import type { AdminMailLogFilters } from '../../admin/useAdminMailLogs';

// 발송 이력(전 채널: 메일·알림톡·SMS) 전역 조회 — 코어 모듈. 필터·목록·상세는
// MailLogList 가 소유(Case 상세 '보낸 메일' 임베드와 공용 컴포넌트).
// URL 쿼리(status·kind·channel)는 초기 필터 프리셋 — 대시보드 실패 위젯 링크 진입용.
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
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold">{{ t('admin.mailLogs.title') }}</h1>
      <p class="mt-1 text-sm text-gray-500">{{ t('admin.mailLogs.subtitle') }}</p>
    </div>
    <MailLogList :initial="initial" />
  </div>
</template>
