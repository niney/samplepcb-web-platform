<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderActionResponseType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';

// 상태 전이·삭제·엑셀 업로드 공용 결과 패널(옛 components/admin/OrderActionResult.vue 와 같은 props) —
// processed(성공)/skipped(가드 위반 reason별)/알림 실패. 건너뛴 주문번호까지 남겨야 해서 토스트가 아니라
// 그 자리 패널이다(액션바·삭제 대화상자·엑셀 대화상자·상세 서랍이 함께 쓴다).
const props = defineProps<{ data: AdminOrderActionResponseType['data'] }>();
const i18n = useI18n();
const { t } = i18n;

// reason 코드별 그룹(NOT_FOUND·NOT_ORDER_STATUS·… + 서버 확장 대비 원문 fallback).
const skippedByReason = computed<{ reason: string; odIds: string[] }[]>(() => {
  const map = new Map<string, string[]>();
  for (const s of props.data.skipped) {
    const arr = map.get(s.reason) ?? [];
    arr.push(s.odId);
    map.set(s.reason, arr);
  }
  return [...map.entries()].map(([reason, odIds]) => ({ reason, odIds }));
});
const reasonLabel = (reason: string): string =>
  i18n.te(`admin.orders.reason.${reason}`) ? t(`admin.orders.reason.${reason}`) : reason;

const mailFailed = computed<number>(() => props.data.notify.filter((n) => n.mail === 'failed').length);
const smsFailed = computed<number>(() => props.data.notify.filter((n) => n.sms === 'failed').length);
</script>

<template>
  <Panel tone="muted" class="space-y-1.5 text-sm">
    <p v-if="props.data.processed.length > 0" class="text-success font-medium">
      {{ t('admin.orders.result.processed', { n: props.data.processed.length }) }}
    </p>
    <div v-for="grp in skippedByReason" :key="grp.reason" class="text-warning">
      <span class="font-medium">{{ reasonLabel(grp.reason) }}</span>
      <span> · {{ t('admin.orders.result.count', { n: grp.odIds.length }) }}</span>
      <span class="text-muted-foreground ml-1 text-xs break-all tabular-nums">{{ grp.odIds.join(', ') }}</span>
    </div>
    <p v-if="mailFailed > 0" class="text-destructive">
      {{ t('admin.orders.result.mailFailed', { n: mailFailed }) }}
    </p>
    <p v-if="smsFailed > 0" class="text-destructive">
      {{ t('admin.orders.result.smsFailed', { n: smsFailed }) }}
    </p>
    <p v-if="props.data.processed.length === 0 && props.data.skipped.length === 0" class="text-muted-foreground">
      {{ t('admin.orders.result.none') }}
    </p>
  </Panel>
</template>
