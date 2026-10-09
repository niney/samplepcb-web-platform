<script setup lang="ts">
import { computed } from 'vue';
import type { AdminPartnerDetailType } from '@sp/api-contract';
import { useAdminPartnerActLogs } from '@/admin/useAdminPartners';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';

// 관리자 대리 접속 이력 — 관리자가 이 조직의 포털에 들어가 한 쓰기 요청(sp_partner_act_log, 최근 50건).
// 발주·발송 이력은 각자의 주체 표기(관리자 대행)를 따르지만, 표기 자리가 없는 쓰기도 있어 이 원장이
// "누가 이 조직으로 무엇을 했는가"의 단일 근거다. 기록이 없으면 섹션을 그리지 않는다.
const props = defineProps<{ detail: AdminPartnerDetailType }>();

const partnerId = computed<number | null>(() => props.detail.partnerId);
const logsQ = useAdminPartnerActLogs(partnerId);
const logs = computed(() => logsQ.data.value?.data.items ?? []);

// 서버가 KST 로 내려주지 않는다 — 화면에서 한국 시각으로 읽는다.
const fmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const when = (iso: string): string => fmt.format(new Date(iso));
</script>

<template>
  <SectionCard v-if="logs.length > 0" title="대리 접속 이력">
    <template #meta>관리자가 이 조직의 포털에서 한 일(최근 {{ logs.length }}건)</template>
    <ul class="flex flex-col gap-1.5 text-xs">
      <li v-for="log in logs" :key="log.id" class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span class="text-muted-foreground tabular-nums">{{ when(log.createdAt) }}</span>
        <span class="font-medium">{{ log.adminMbId }}</span>
        <Badge :variant="log.statusCode < 400 ? 'secondary' : 'danger'" class="tabular-nums">
          {{ log.method }} {{ log.statusCode }}
        </Badge>
        <span class="text-muted-foreground min-w-0 truncate font-mono" :title="log.path">{{ log.path }}</span>
      </li>
    </ul>
  </SectionCard>
</template>
