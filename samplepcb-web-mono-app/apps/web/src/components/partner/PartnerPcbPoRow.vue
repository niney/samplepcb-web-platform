<script setup lang="ts">
import { computed } from 'vue';
import {
  PCB_PO_FULFILLMENT_MODE_LABELS,
  PCB_PO_STATUS_LABELS,
  type PartnerPcbPoListItemType,
} from '@sp/api-contract';

// PCB 발주서 한 줄(R3) — 홈 '진행할 발주'·'진행 중 발주(관전)'와 발주서 목록이 같은 줄을 쓴다.
// 내 차례(myTurn)는 CTA [진행하기]. '내 차례'만으로는 **왜** 내 차례인지 모른다 — 첫 EQ 요청과
// 반려 뒤 보완, MD 의 하위 발주 대기가 같은 얼굴이 되므로 배지로 들어오자마자 갈리게 한다.
// apiGet<T>(schema: ZodType<T>) 는 .default() 필드(eqBlocked·rejectedAt)를 입력형(optional)으로 추론해
// 목록 아이템이 계약의 출력형과 어긋난다 — 줄 컴포넌트는 그 둘을 다 받도록 느슨하게 받는다.
export type PartnerPcbPoRowItem = Omit<PartnerPcbPoListItemType, 'eqBlocked' | 'rejectedAt'> & {
  eqBlocked?: boolean | undefined;
  rejectedAt?: string | null | undefined;
};

const props = defineProps<{ po: PartnerPcbPoRowItem }>();

const todo = computed(() => props.po.myTurn);
const rejected = computed(
  () => props.po.status === 'issued' && (props.po.rejectedAt ?? null) !== null,
);
const eqBlocked = computed(() => props.po.eqBlocked === true);
</script>

<template>
  <RouterLink
    :to="{ name: 'partner-pcb-po', params: { id: String(po.poId) } }"
    class="flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-4 py-3"
    :class="todo ? 'border-teal-200 hover:border-teal-300 hover:bg-teal-50/40' : 'border-gray-200 hover:bg-gray-50'"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-gray-900">
        <!-- MD 의 하위 발주만 방향 배지 — 수주가 기본이라 매 줄 '수주'는 소음이다 -->
        <span
          v-if="po.direction === 'issued'"
          class="mr-1 rounded bg-indigo-100 px-1 text-[11px] font-bold text-indigo-700"
        >하위 발주</span>
        {{ po.projectName }}
        <span v-if="po.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-700">
          A/S {{ po.reorderRound }}차
        </span>
        <span v-if="rejected" class="ml-1 rounded bg-red-100 px-1 text-[11px] font-bold text-red-700">
          {{ po.direction === 'issued' ? '반려 — 보완 대기' : '반려됨 — 보완 필요' }}
        </span>
        <!-- MD 수주의 하위 발주 대기 — EQ 를 열려면 먼저 하위에 발주해야 한다 -->
        <span v-if="eqBlocked" class="ml-1 rounded bg-indigo-100 px-1 text-[11px] font-bold text-indigo-700">
          하위 발주 필요
        </span>
        <span
          v-else-if="po.direction === 'received' && po.fulfillmentMode === 'self'"
          class="ml-1 rounded bg-teal-100 px-1 text-[11px] font-bold text-teal-700"
        >{{ PCB_PO_FULFILLMENT_MODE_LABELS.self }}</span>
      </p>
      <p class="mt-0.5 text-sm text-gray-500">
        {{ po.qty }}매 · {{ po.counterpartyName }} ·
        <span class="tabular-nums">{{ po.priceOriginal.toLocaleString('en-US') }} {{ po.currency }}</span>
      </p>
    </div>
    <span class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
      {{ PCB_PO_STATUS_LABELS[po.track][po.status] }}
    </span>
    <span v-if="todo" class="shrink-0 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-bold text-white">진행하기</span>
    <span v-else class="shrink-0 text-sm text-gray-400">보기 →</span>
  </RouterLink>
</template>
