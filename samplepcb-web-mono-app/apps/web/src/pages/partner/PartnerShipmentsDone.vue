<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePartnerDoneShipments } from '../../partner/usePartnerRfqs';
import PartnerShipmentCard from '../../components/partner/PartnerShipmentCard.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 완료된 발송(§6.11 분리) — 협력사 관점 완료(최종 상태 도달·입고 확인) 아카이브.
// 누적되는 목록이라 홈이 아니라 별도 페이지+페이지네이션. 조회 전용(핑퐁 조작 없음).

const PAGE_SIZE = 10;
const page = ref(1);
const query = usePartnerDoneShipments(page, PAGE_SIZE);
const items = computed(() => query.data.value?.data.items ?? []);
const total = computed(() => query.data.value?.data.total ?? 0);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 홈
      </RouterLink>
      <h1 class="text-xl font-bold">완료된 발송</h1>
      <p class="text-sm text-gray-400">발송이 끝났거나 입고 확인된 기록입니다.</p>
    </div>

    <p v-if="query.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p
      v-else-if="items.length === 0"
      class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400"
    >
      완료된 발송이 없습니다.
    </p>

    <template v-else>
      <div class="space-y-3">
        <PartnerShipmentCard v-for="s in items" :key="s.shipmentId" :shipment="s" />
      </div>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">총 {{ total }}건</p>
        <UiPagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          @update:page="(p) => (page = p)"
        />
      </div>
    </template>
  </div>
</template>
