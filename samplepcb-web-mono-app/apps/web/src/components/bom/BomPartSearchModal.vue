<script setup lang="ts">
import type { PartHitType } from '@sp/api-contract';
import type { OfferPick } from '@sp/utils';
import BomPartSearchPanel from './BomPartSearchPanel.vue';

// 부품 교체/추가 모달 — 카탈로그(sp-parts) 검색. 단위·표기 자유(4k7=0.0047M=472).

defineProps<{
  initialQuery: string;
  mode: 'swap' | 'add';
  needed: number;
  usdKrwRate: number | null;
}>();

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null];
  close: [];
}>();

function onSelect(part: PartHitType, pick: OfferPick | null): void {
  emit('select', part, pick);
}

</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-gray-900">{{ mode === 'swap' ? '부품 교체' : '부품 추가' }}</h3>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <p class="mt-1 text-xs text-gray-500">{{ mode === 'swap' ? '부품과 공급 포장·공급사를 확인한 뒤 카탈로그 선택으로 변경합니다.' : '부품과 구매 조건을 확인한 뒤 견적에 추가합니다.' }}</p>
      <BomPartSearchPanel
        class="mt-4"
        :initial-query="initialQuery"
        :needed="needed"
        :usd-krw-rate="usdKrwRate"
        @select="onSelect"
      />
    </div>
  </div>
</template>
