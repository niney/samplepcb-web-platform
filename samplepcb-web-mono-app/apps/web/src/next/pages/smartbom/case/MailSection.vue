<script setup lang="ts">
import MailLogList from '@/next/components/common/MailLogList.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 보낸 메일 — 이 Case 컨텍스트의 발송 이력(§6.19 후속, 전 채널 원장 임베드). 조회용이라 기본 접힘.
const { detailId, mailLogOpen } = useSmartbomCaseContext();
</script>

<template>
  <SectionCard v-model:open="mailLogOpen" title="보낸 메일" collapsible>
    <MailLogList v-if="detailId !== null" :fixed="{ refType: 'bom_quote', refId: detailId }" :page-size="10" />
  </SectionCard>
</template>
