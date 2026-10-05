<script setup lang="ts">
import type { AdminCaseCustomerType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import SectionCard from '@/next/components/common/SectionCard.vue';

// Case 상세의 '고객 정보' 카드 — 옛 components/admin/AdminCaseCustomerCard.vue 의 짝.
// 정보원이 둘이라 출처를 배지로 밝힌다: 주문이 있으면 주문 시점 정보(od 스냅샷), 없으면 견적 신청자.
defineProps<{
  customer: AdminCaseCustomerType | null;
}>();

const displayValue = (value: string | null): string => {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? '-' : normalized;
};
</script>

<template>
  <SectionCard title="고객 정보" role="region" aria-label="고객 정보">
    <template v-if="customer !== null" #actions>
      <Badge :variant="customer.source === 'order_snapshot' ? 'info' : 'secondary'">
        {{ customer.source === 'order_snapshot' ? '주문 시점 정보' : '견적 신청자' }}
      </Badge>
    </template>

    <dl v-if="customer !== null" class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">회사명</dt>
        <dd class="mt-0.5 truncate font-medium" :title="customer.companyName ?? ''">
          {{ displayValue(customer.companyName) }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">이름 · 회원 ID</dt>
        <dd class="mt-0.5 min-w-0">
          <span class="font-medium">{{ displayValue(customer.name) }}</span>
          <span v-if="customer.mbId !== null" class="text-muted-foreground ml-1 text-xs break-all">
            {{ customer.mbId }}
          </span>
          <span v-else class="text-muted-foreground ml-1 text-xs">비회원</span>
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">연락처</dt>
        <dd class="mt-0.5 tabular-nums">{{ displayValue(customer.phone) }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">이메일</dt>
        <dd class="mt-0.5 break-all">{{ displayValue(customer.email) }}</dd>
      </div>
    </dl>

    <p v-else class="text-muted-foreground text-sm">저장된 신청자 정보가 없습니다.</p>
  </SectionCard>
</template>
