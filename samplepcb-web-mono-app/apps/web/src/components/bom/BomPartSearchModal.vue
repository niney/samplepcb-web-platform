<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PartHitType } from '@sp/api-contract';
import { useBomPartsSearch } from '../../bom/useBom';
import PartImage from '../ui/PartImage.vue';

// 부품 교체/추가 모달 — 카탈로그(sp-parts) 검색. 단위·표기 자유(4k7=0.0047M=472).

const props = defineProps<{
  initialQuery: string;
  mode: 'swap' | 'add';
}>();

const emit = defineEmits<{
  select: [part: PartHitType];
  close: [];
}>();

const input = ref(props.initialQuery);
const q = ref(props.initialQuery);
const search = useBomPartsSearch(q, computed(() => true));
const items = computed(() => search.data.value?.data.items ?? []);

function submit(): void {
  q.value = input.value.trim();
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-gray-900">{{ mode === 'swap' ? '부품 교체' : '부품 추가' }}</h3>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <form class="mt-3 flex gap-2" @submit.prevent="submit">
        <input
          v-model="input"
          type="text"
          placeholder="품번·스펙·패키지 자유 검색 (예: GRM155 / 4k7 0402 / 100nF 16V)"
          class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
        <button type="submit" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">검색</button>
      </form>

      <p v-if="search.isLoading.value" class="mt-6 text-sm text-gray-400">검색 중…</p>
      <p v-else-if="q !== '' && items.length === 0" class="mt-6 text-sm text-gray-400">검색 결과가 없습니다 — 다른 표기로 시도해 보세요.</p>

      <div v-else class="mt-4 space-y-2">
        <button
          v-for="p in items"
          :key="p.id"
          type="button"
          class="w-full rounded-lg border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"
          @click="emit('select', p)"
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <PartImage
              :src="p.imageUrl"
              :placeholder="null"
              class="size-[32px] rounded border border-gray-200"
            />
            <span class="font-semibold">{{ p.mpn }}</span>
            <span class="text-gray-500">{{ p.manufacturerName }}</span>
            <span v-if="p.packageCode" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{{ p.packageCode }}</span>
          </div>
          <p class="mt-0.5 truncate text-xs text-gray-500">{{ p.description }}</p>
          <p class="mt-0.5 text-xs text-gray-400">재고 {{ p.totalStock.toLocaleString('ko-KR') }} · 공급사 {{ p.suppliers.filter((s) => s !== 'samplepcb').join(', ') }}</p>
        </button>
      </div>
    </div>
  </div>
</template>
