<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderActionResponseType } from '@sp/api-contract';

// 상태 전이·삭제·엑셀업로드 공용 결과 패널 — processed(성공)/skipped(가드 위반 reason별)/notify 실패.
// 토스트 시스템이 없어 인라인 패널로 표시한다(액션바·삭제모달·엑셀모달이 공유).
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
  <div class="space-y-1.5 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
    <p v-if="props.data.processed.length > 0" class="font-medium text-green-700">
      {{ t('admin.orders.result.processed', { n: props.data.processed.length }) }}
    </p>
    <div v-for="grp in skippedByReason" :key="grp.reason" class="text-amber-700">
      <span class="font-medium">{{ reasonLabel(grp.reason) }}</span>
      <span class="text-amber-600"> · {{ t('admin.orders.result.count', { n: grp.odIds.length }) }}</span>
      <span class="ml-1 break-all text-xs text-amber-500">{{ grp.odIds.join(', ') }}</span>
    </div>
    <p v-if="mailFailed > 0" class="text-red-600">
      {{ t('admin.orders.result.mailFailed', { n: mailFailed }) }}
    </p>
    <p v-if="smsFailed > 0" class="text-red-600">
      {{ t('admin.orders.result.smsFailed', { n: smsFailed }) }}
    </p>
    <p
      v-if="props.data.processed.length === 0 && props.data.skipped.length === 0"
      class="text-gray-500"
    >
      {{ t('admin.orders.result.none') }}
    </p>
  </div>
</template>
