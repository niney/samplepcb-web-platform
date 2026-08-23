<script setup lang="ts">
import { computed } from 'vue';
import { BOM_RFQ_STATUS_LABELS, type PartnerRfqListItemType } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// BOM 견적요청 한 줄(R3) — 홈 '회신할 견적'과 견적요청 목록이 같은 줄을 쓴다.
// 회신 대기(requested)는 CTA [회신하기], 그 외는 상태 배지 + 회신 요약.
const props = defineProps<{ rfq: PartnerRfqListItemType }>();

const todo = computed(() => props.rfq.status === 'requested');
const statusCls = computed(() =>
  props.rfq.status === 'quoted' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600',
);
const fmtWon = (v: number | null, currency: string): string =>
  v === null ? '—' : `${v.toLocaleString('ko-KR')} ${currency}`;
</script>

<template>
  <RouterLink
    :to="{ name: 'partner-bom-rfq', params: { id: String(rfq.rfqId) } }"
    class="flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-4 py-3"
    :class="todo ? 'border-blue-200 hover:border-blue-300 hover:bg-blue-50/40' : 'border-gray-200 hover:bg-gray-50'"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.quoteTitle }}</p>
      <p class="mt-0.5 text-sm text-gray-500">
        {{ rfq.itemCount }}개 품목 · 요청일 {{ fmtKstDate(rfq.requestedAt) }}
        <template v-if="!todo">
          · 회신 {{ rfq.repliedItemCount }}/{{ rfq.itemCount }}행 · {{ fmtWon(rfq.totalAmount, rfq.currency) }}
        </template>
      </p>
    </div>
    <span v-if="!todo" class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold" :class="statusCls">
      {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
    </span>
    <span v-if="todo" class="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">회신하기</span>
    <span v-else class="shrink-0 text-sm text-gray-400">보기 →</span>
  </RouterLink>
</template>
