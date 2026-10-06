<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminOrderDetailOrderType } from '@sp/api-contract';
import { deliveryMethodSlug, displayCompany } from '@/admin/useAdminOrders';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 배송(읽기 전용) — 운송장 입력·수집은 처리 섹션의 배송 처리에서 한다(옛 서랍과 같음).
defineProps<{ order: AdminOrderDetailOrderType }>();
const { t } = useI18n();

// 배송방법 라벨 — 미등록/''(미지정)은 '-'.
const deliveryMethodLabel = (method: string): string => {
  const slug = deliveryMethodSlug(method);
  return slug !== null ? t(`admin.orders.deliveryMethod.${slug}`) : '-';
};
</script>

<template>
  <SectionCard :title="t('admin.orders.drawer.delivery')">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.deliveryMethod') }}</dt>
        <dd>{{ deliveryMethodLabel(order.deliveryMethod) }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.deliveryCompany') }}</dt>
        <dd>{{ displayCompany(order.deliveryCompany) }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.invoiceNo') }}</dt>
        <dd class="break-all tabular-nums">{{ order.invoiceNo ?? '-' }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.invoiceTime') }}</dt>
        <dd class="tabular-nums">{{ order.invoiceTime ?? '-' }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.hopeDate') }}</dt>
        <dd class="tabular-nums">{{ order.hopeDate ?? '-' }}</dd>
      </div>
    </dl>
  </SectionCard>
</template>
