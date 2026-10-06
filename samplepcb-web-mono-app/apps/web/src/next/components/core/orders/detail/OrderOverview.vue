<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType, AdminOrderDetailOrderType } from '@sp/api-contract';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { orderStatusBadgeVariant } from '../order-badges';
import OrderStatusStepper from './OrderStatusStepper.vue';
import { useOrderStatusLabel } from './order-detail';

// 주문 개요 — 상태·테스트 표지·결제수단, 진행 스텝퍼, 협력 트랙 진행, PG 거래 정보(옛 서랍 맨 위 블록).
const props = defineProps<{
  order: AdminOrderDetailOrderType;
  items: readonly AdminOrderCartItemType[];
}>();
const { t } = useI18n();
const statusLabel = useOrderStatusLabel();

// 협력 트랙 진행 — 줄마다 다르면 가장 느린 줄(서버 사전 순서 = stage 배열 순서)을 주문의 현재로.
const TRACK_STAGE_ORDER = ['eq_pending', 'eq', 'eq_done', 'producing', 'produced', 'shipping', 'received'];
// 고객 화면과 같은 규칙 — 배송·완료·취소 뒤에는 코어 배송정보가 정본이라 협력 트랙 줄을 접는다.
const TRACK_CLOSED_OD = new Set(['배송', '완료', '취소']);
const trackProgress = computed(() => {
  if (TRACK_CLOSED_OD.has(props.order.status)) return null;
  let out: { stage: string; label: string; shortLabel: string } | null = null;
  for (const it of props.items) {
    const p = it.pcbProgress;
    if (p === null) continue;
    if (out === null || TRACK_STAGE_ORDER.indexOf(p.stage) < TRACK_STAGE_ORDER.indexOf(out.stage)) out = p;
  }
  return out;
});

const payment = computed(() => props.order.payment);
const hasPayment = computed(() => payment.value.pg !== '' || payment.value.tno !== '' || payment.value.appNo !== '');
</script>

<template>
  <SectionCard>
    <template #title>
      <span class="flex flex-wrap items-center gap-1.5">
        <Badge :variant="orderStatusBadgeVariant(order.status)">{{ statusLabel(order.status) }}</Badge>
        <Badge v-if="order.isTest" variant="warning">{{ t('admin.orders.table.test') }}</Badge>
      </span>
    </template>
    <template #meta>
      {{ order.settleCase !== '' ? order.settleCase : t('admin.orders.drawer.noSettle') }}
    </template>

    <div class="space-y-3">
      <!-- 상태 진행 스텝퍼(선형 파이프라인 상 현재 위치) -->
      <OrderStatusStepper :status="order.status" />
      <!-- 협력 트랙 진행(od 무접촉) — od 가 '입금'에 머물러도 실제 제작이 어디까지 왔는지.
           여러 줄이면 가장 느린 줄이 이 주문의 현재다. -->
      <Alert v-if="trackProgress !== null" variant="info" size="sm">
        <AlertDescription>
          <span class="text-info font-semibold">{{ t('admin.orders.drawer.trackProgress') }}</span>
          · {{ trackProgress.label }}
        </AlertDescription>
      </Alert>
      <dl v-if="hasPayment" class="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
        <div v-if="payment.pg !== ''" class="min-w-0">
          <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.pg') }}</dt>
          <dd class="break-all">{{ payment.pg }}</dd>
        </div>
        <div v-if="payment.tno !== ''" class="min-w-0">
          <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.tno') }}</dt>
          <dd class="break-all tabular-nums">{{ payment.tno }}</dd>
        </div>
        <div v-if="payment.appNo !== ''" class="min-w-0">
          <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.appNo') }}</dt>
          <dd class="break-all tabular-nums">{{ payment.appNo }}</dd>
        </div>
      </dl>
    </div>
  </SectionCard>
</template>
