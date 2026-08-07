<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import MailLogList from '../../components/admin/MailLogList.vue';

// 발송 이력(전 채널: 메일·알림톡·SMS) 전역 조회 — 코어 모듈. 필터·목록·상세는
// MailLogList 가 소유(Case 상세 '보낸 메일' 임베드와 공용 컴포넌트).
const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold">{{ t('admin.mailLogs.title') }}</h1>
      <p class="mt-1 text-sm text-gray-500">{{ t('admin.mailLogs.subtitle') }}</p>
    </div>
    <MailLogList />
  </div>
</template>
