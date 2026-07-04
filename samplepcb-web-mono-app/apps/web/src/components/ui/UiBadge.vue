<script setup lang="ts">
// 상태 pill 뱃지 — 색 관례는 sp-php 사용자 화면(.sp-badge, default_shop.css)을 이식:
// rfq=amber · priced=blue · quoted=green · cart/ordered/deleted=gray.
// 범용 variant(success/warn/muted/info)는 견적 외 화면(회원 관리 상태·구분 뱃지 등)용.
export type BadgeVariant =
  | 'rfq'
  | 'priced'
  | 'quoted'
  | 'cart'
  | 'ordered'
  | 'deleted'
  | 'success'
  | 'warn'
  | 'muted'
  | 'info';

const props = defineProps<{ variant: BadgeVariant; label: string }>();

const variantClass: Record<BadgeVariant, string> = {
  rfq: 'bg-amber-100 text-amber-700',
  priced: 'bg-blue-100 text-blue-700',
  quoted: 'bg-green-100 text-green-700',
  cart: 'bg-gray-100 text-gray-600',
  ordered: 'bg-gray-200 text-gray-700',
  deleted: 'bg-gray-100 text-gray-500',
  success: 'bg-green-100 text-green-700',
  warn: 'bg-amber-100 text-amber-700',
  muted: 'bg-gray-100 text-gray-500',
  info: 'bg-blue-100 text-blue-700',
};
</script>

<template>
  <span
    class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
    :class="variantClass[props.variant]"
  >
    {{ props.label }}
  </span>
</template>
