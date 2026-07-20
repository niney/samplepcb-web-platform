<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PartHitType } from '@sp/api-contract';
import { useBomPartsSearch } from '../../bom/useBom';
import PartImage from '../ui/PartImage.vue';

const props = withDefaults(defineProps<{
  initialQuery: string;
  currentPartId?: string | null;
  selecting?: boolean;
}>(), {
  currentPartId: null,
  selecting: false,
});

const emit = defineEmits<{
  select: [part: PartHitType];
}>();

const input = ref(props.initialQuery);
const q = ref(props.initialQuery.trim());
const search = useBomPartsSearch(q, computed(() => true));
const items = computed(() => search.data.value?.data.items ?? []);

watch(
  () => props.initialQuery,
  (value) => {
    input.value = value;
    q.value = value.trim();
  },
);

function submit(): void {
  q.value = input.value.trim();
}
</script>

<template>
  <div>
    <form class="flex flex-col gap-2 sm:flex-row" role="search" @submit.prevent="submit">
      <input
        v-model="input"
        type="search"
        placeholder="품번·스펙·패키지 자유 검색 (예: GRM155 / 4k7 0402 / 100nF 16V)"
        class="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
      <button
        type="submit"
        class="h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        :disabled="selecting"
      >
        검색
      </button>
    </form>

    <div v-if="search.isFetching.value" class="mt-5 flex items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-5 text-sm font-medium text-blue-700" aria-live="polite">
      <span class="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      카탈로그를 검색하고 있습니다.
    </div>
    <div v-else-if="search.isError.value" class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
      검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.
    </div>
    <div v-else-if="q === ''" class="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      품번이나 스펙을 입력해 부품을 검색해 주세요.
    </div>
    <div v-else-if="items.length === 0" class="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      검색 결과가 없습니다. 다른 품번 또는 스펙 표기로 시도해 보세요.
    </div>

    <div v-else class="mt-4 space-y-2.5">
      <button
        v-for="part in items"
        :key="part.id"
        type="button"
        class="group w-full rounded-xl border p-3.5 text-left transition"
        :class="part.id === currentPartId ? 'cursor-default border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40'"
        :disabled="selecting || part.id === currentPartId"
        @click="emit('select', part)"
      >
        <div class="flex items-start gap-3">
          <PartImage
            :src="part.imageUrl"
            :alt="`${part.mpn} 부품 이미지`"
            :placeholder="null"
            class="size-12 shrink-0 rounded-lg border border-slate-200 bg-white"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <strong class="break-all text-slate-950">{{ part.mpn }}</strong>
              <span class="text-slate-500">{{ part.manufacturerName ?? '제조사 미확인' }}</span>
              <span v-if="part.packageCode" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{{ part.packageCode }}</span>
              <span v-if="part.id === currentPartId" class="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">현재 부품</span>
            </div>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{{ part.description ?? '설명 없음' }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>재고 <b class="text-slate-700">{{ part.totalStock.toLocaleString('ko-KR') }}</b></span>
              <span>공급사 <b class="text-slate-700">{{ part.suppliers.filter((supplier) => supplier !== 'samplepcb').join(', ') || '외부 공급사 없음' }}</b></span>
              <span v-if="part.id !== currentPartId" class="ml-auto font-bold text-blue-700 group-hover:text-blue-900">이 부품으로 변경 →</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
