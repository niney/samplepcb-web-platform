<script setup lang="ts">
import { computed } from 'vue';
import type { PartnerPoListItemType } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { partnerPoDisplayStatus } from '../../partner/partnerPoStatus';

// BOM 발주서 한 줄(R3) — 홈 '확인할 발주'와 발주서 목록이 같은 줄을 쓴다.
// 상태는 협력사 관점(partnerPoDisplayStatus — '마감' 같은 관리자 내부 용어 미노출).
const props = defineProps<{ po: PartnerPoListItemType }>();

const todo = computed(() => props.po.status === 'issued');
const badge = computed(() =>
  partnerPoDisplayStatus({
    poStatus: props.po.status,
    attached: props.po.shipmentAttached,
    shipmentMode: props.po.shipmentMode,
    shipmentStatus: props.po.shipmentStatus,
    received: props.po.shipmentReceived,
  }),
);
</script>

<template>
  <RouterLink
    :to="{ name: 'partner-bom-po', params: { id: String(po.poId) } }"
    class="flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-4 py-3"
    :class="todo ? 'border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50/40' : 'border-gray-200 hover:bg-gray-50'"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-gray-900">{{ po.quoteTitle }}</p>
      <p class="mt-0.5 text-sm text-gray-500">
        {{ po.itemCount }}개 품목 · {{ po.totalAmount.toLocaleString('ko-KR') }} {{ po.currency }} (VAT 별도)
        · 발주일 {{ fmtKstDate(po.issuedAt) }}
      </p>
    </div>
    <span v-if="!todo" class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold" :class="badge.cls">
      {{ badge.label }}
    </span>
    <span v-if="todo" class="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white">확인하기</span>
    <span v-else class="shrink-0 text-sm text-gray-400">보기 →</span>
  </RouterLink>
</template>
