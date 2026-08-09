<script setup lang="ts">
import type { AdminCaseCustomerType } from '@sp/api-contract';

defineProps<{
  customer: AdminCaseCustomerType | null;
}>();

const displayValue = (value: string | null): string => {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? '-' : normalized;
};
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-surface p-4" aria-label="고객 정보">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-bold text-gray-700">고객 정보</h2>
      <span
        v-if="customer !== null"
        class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
        :class="
          customer.source === 'order_snapshot'
            ? 'bg-violet-100 text-violet-700'
            : 'bg-blue-100 text-blue-700'
        "
      >
        {{ customer.source === 'order_snapshot' ? '주문 시점 정보' : '견적 신청자' }}
      </span>
    </div>

    <dl
      v-if="customer !== null"
      class="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4"
    >
      <div class="min-w-0">
        <dt class="text-xs text-gray-400">회사명</dt>
        <dd class="mt-0.5 truncate font-medium text-gray-800" :title="customer.companyName ?? ''">
          {{ displayValue(customer.companyName) }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-gray-400">이름 · 회원 ID</dt>
        <dd class="mt-0.5 min-w-0 text-gray-800">
          <span class="font-medium">{{ displayValue(customer.name) }}</span>
          <span v-if="customer.mbId !== null" class="ml-1 break-all text-xs text-gray-400">
            {{ customer.mbId }}
          </span>
          <span v-else class="ml-1 text-xs text-gray-400">비회원</span>
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-gray-400">연락처</dt>
        <dd class="mt-0.5 text-gray-800">{{ displayValue(customer.phone) }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs text-gray-400">이메일</dt>
        <dd class="mt-0.5 break-all text-gray-800">{{ displayValue(customer.email) }}</dd>
      </div>
    </dl>

    <p v-else class="mt-2 text-sm text-gray-400">저장된 신청자 정보가 없습니다.</p>
  </section>
</template>
