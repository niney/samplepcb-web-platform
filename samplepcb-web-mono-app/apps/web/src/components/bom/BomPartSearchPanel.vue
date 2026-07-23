<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomPartHitType, PartHitType } from '@sp/api-contract';
import type { OfferPick } from '@sp/utils';
import { useBomPartsSearch } from '../../bom/useBom';
import PartImage from '../ui/PartImage.vue';
import BomPartOfferOptions from './BomPartOfferOptions.vue';
import BomPartSearchNotice from './BomPartSearchNotice.vue';

// 카탈로그 검색 + 결과 목록 + 부품 1건 구매 조건 비교(BomPartOfferOptions) 셸.
// 견적의 부품 교체/추가(선택 문맥)와 단일 검색 모달류가 공유한다.

const props = withDefaults(defineProps<{
  initialQuery: string;
  currentPartId?: string | null;
  selecting?: boolean;
  needed?: number;
  usdKrwRate?: number | null;
  /** 열람 전용(단일 검색 화면) — 부품 변경 CTA 없이 구매 조건 비교만 제공한다. */
  browse?: boolean;
}>(), {
  currentPartId: null,
  selecting: false,
  needed: 1,
  usdKrwRate: null,
  browse: false,
});

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null];
}>();

const input = ref(props.initialQuery);
const q = ref(props.initialQuery.trim());
const selectedPart = ref<BomPartHitType | null>(null);
const neededRef = computed(() => props.needed);
const search = useBomPartsSearch(q, computed(() => true), neededRef);
const items = computed(() => search.data.value?.data.items ?? []);

watch(
  () => props.initialQuery,
  (value) => {
    input.value = value;
    q.value = value.trim();
    selectedPart.value = null;
  },
);

function submit(): void {
  q.value = input.value.trim();
  selectedPart.value = null;
}

function previewPart(part: BomPartHitType): void {
  if (props.selecting) return;
  selectedPart.value = part;
}

function returnToResults(): void {
  if (props.selecting) return;
  selectedPart.value = null;
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

    <template v-if="selectedPart === null">
      <BomPartSearchNotice
        v-if="search.data.value !== undefined"
        :query="q"
        :mode="search.data.value.data.searchMode"
        :interpreted-spec-count="search.data.value.data.interpretedSpecCount"
        :needed="needed"
        wait-for-catalog
        :disabled="selecting"
      />
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
        로컬 카탈로그에 검색 결과가 없습니다. 규격 검색이라면 위의 공급사 추가 확인을 사용해 보세요.
      </div>

      <div v-else class="mt-4 space-y-2.5">
        <button
          v-for="part in items"
          :key="part.id"
          type="button"
          class="group w-full rounded-xl border p-3.5 text-left transition"
          :class="part.id === currentPartId ? 'border-blue-200 bg-blue-50/70 hover:border-blue-400' : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40'"
          :disabled="selecting"
          @click="previewPart(part)"
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
                <span class="ml-auto font-bold text-blue-700 group-hover:text-blue-900">{{ part.id === currentPartId ? '공급 포장 변경' : '구매 조건 보기' }} →</span>
              </div>
            </div>
          </div>
        </button>
      </div>
    </template>

    <section v-else class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <div class="border-b border-slate-200 bg-white p-4">
        <button type="button" class="text-xs font-bold text-blue-700 hover:text-blue-900" :disabled="selecting" @click="returnToResults">← 검색 결과로</button>
        <div class="mt-3 flex items-start gap-3">
          <PartImage
            :src="selectedPart.imageUrl"
            :alt="`${selectedPart.mpn} 부품 이미지`"
            :placeholder="null"
            class="size-14 shrink-0 rounded-lg border border-slate-200 bg-white"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="break-all text-sm text-slate-950">{{ selectedPart.mpn }}</strong>
              <span v-if="selectedPart.packageCode" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">부품 패키지 {{ selectedPart.packageCode }}</span>
              <span v-if="selectedPart.id === currentPartId" class="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">현재 부품</span>
            </div>
            <p class="mt-1 text-xs text-slate-500">{{ selectedPart.manufacturerName ?? '제조사 미확인' }}</p>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{{ selectedPart.description ?? '설명 없음' }}</p>
          </div>
        </div>
      </div>

      <BomPartOfferOptions
        :part="selectedPart"
        :needed="needed"
        :usd-krw-rate="usdKrwRate"
        :selecting="selecting"
        :browse="browse"
        :current-part-id="currentPartId"
        @select="(part, pick) => emit('select', part, pick)"
      />
    </section>
  </div>
</template>
