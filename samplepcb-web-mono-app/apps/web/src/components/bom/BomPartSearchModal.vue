<script setup lang="ts">
import type { PartHitType } from '@sp/api-contract';
import BomPartSearchPanel from './BomPartSearchPanel.vue';

// 부품 교체/추가 모달 — 카탈로그(sp-parts) 검색. 단위·표기 자유(4k7=0.0047M=472).

defineProps<{
  initialQuery: string;
  mode: 'swap' | 'add';
}>();

const emit = defineEmits<{
  select: [part: PartHitType];
  close: [];
}>();

</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-gray-900">{{ mode === 'swap' ? '부품 교체' : '부품 추가' }}</h3>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <p class="mt-1 text-xs text-gray-500">{{ mode === 'swap' ? '선택한 부품으로 즉시 교체하고 카탈로그 선택으로 기록합니다.' : '검색 결과에서 견적에 추가할 부품을 선택해 주세요.' }}</p>
      <BomPartSearchPanel class="mt-4" :initial-query="initialQuery" @select="emit('select', $event)" />
    </div>
  </div>
</template>
