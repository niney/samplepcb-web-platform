<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePartnerPcbDoneShipments } from '../../partner/usePartnerPcbPos';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PcbShipmentCard from '../../components/pcb/PcbShipmentCard.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// PCB 완료된 발송(포털 재설계 R2 — BOM §6.11 done 분리 미러) — 협력사 관점 완료
// (최종 상태 도달·입고 확인) 아카이브. 누적 목록이라 별도 페이지+페이지네이션.
// 조회 전용 — 카드는 readonly 로, 조작은 [📦 PCB 보내기] 보드가 전담한다.

const PAGE_SIZE = 10;
const page = ref(1);
const query = usePartnerPcbDoneShipments(page, PAGE_SIZE);
const items = computed(() => query.data.value?.data.items ?? []);
const total = computed(() => query.data.value?.data.total ?? 0);
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader title="완료된 발송" subtitle="발송이 끝났거나 입고 확인된 기록입니다." />

    <p v-if="query.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p
      v-else-if="items.length === 0"
      class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400"
    >
      완료된 발송이 없습니다.
    </p>

    <template v-else>
      <div class="space-y-3">
        <PcbShipmentCard v-for="s in items" :key="s.shipmentId" :shipment="s" readonly />
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
