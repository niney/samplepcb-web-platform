<script setup lang="ts">
import { computed } from 'vue';
import { PCB_RFQ_STATUS_LABELS, type PartnerPcbRfqListItemType } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { pcbMoneyWithSub } from '../../lib/pcb-money';

// PCB 견적요청 한 줄(R3) — 홈 '회신할 견적'과 견적요청 목록이 같은 줄을 쓴다.
// ⚠ 바깥 flex 에 min-w-0 — 프로젝트명은 고객이 올린 파일명이라 길이를 정할 수 없다(여정 36호).
const props = defineProps<{ rfq: PartnerPcbRfqListItemType }>();

const todo = computed(() => props.rfq.status === 'requested');
const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};
</script>

<template>
  <RouterLink
    :to="{ name: 'partner-pcb-rfq', params: { id: String(rfq.rfqId) } }"
    class="flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-4 py-3"
    :class="todo ? 'border-cyan-200 hover:border-cyan-300 hover:bg-cyan-50/40' : 'border-gray-200 hover:bg-gray-50'"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.projectName }}</p>
      <p class="mt-0.5 text-sm text-gray-500">
        {{ rfq.category }} · {{ rfq.qty }}매 · {{ rfq.requesterName }} · 요청일 {{ fmtKstDate(rfq.requestedAt) }}
        <template v-if="rfq.suggestedDeliveryDate !== null">
          · 희망 납기 {{ fmtKstDate(rfq.suggestedDeliveryDate) }}
        </template>
        <template v-if="!todo && rfq.priceOriginal !== null">
          · <span class="tabular-nums">{{ pcbMoneyWithSub(rfq.currency, rfq.priceOriginal, rfq.subCurrency, rfq.subPriceOriginal) }}</span>
        </template>
      </p>
    </div>
    <span v-if="!todo" class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[rfq.status]">
      {{ PCB_RFQ_STATUS_LABELS[rfq.status] }}
    </span>
    <span v-if="todo" class="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-bold text-white">회신하기</span>
    <span v-else class="shrink-0 text-sm text-gray-400">보기 →</span>
  </RouterLink>
</template>
