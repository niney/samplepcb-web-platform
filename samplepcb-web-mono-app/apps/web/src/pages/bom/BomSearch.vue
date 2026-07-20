<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useBomPartsSearch } from '../../bom/useBom';
import BomPartOfferOptions from '../../components/bom/BomPartOfferOptions.vue';
import BomSearchRow from '../../components/bom/BomSearchRow.vue';

// 단일 검색 — BOM 업로드 없이 부품을 검색해 공급사별 구매 조건을 비교하는 화면.
// 결과는 BOM 분석 결과 표(BomQuoteRow)와 같은 시각 언어의 테이블로 보여준다.
// 행의 대표 구매 조건(적용 단가·주문수량)은 서버가 필요수량 기준으로 계산해 내려준다
// (pickDefaultOffer — FE 와 동일 함수). 환율은 견적 문맥에만 있어 원통화 그대로 표시.

const route = useRoute();
const initialQuery = typeof route.query.q === 'string' ? route.query.q : '';
const input = ref(initialQuery);
const q = ref(initialQuery.trim());
const needed = ref<number | string>(1);
// v-model.number 는 빈 입력 시 string 을 남긴다 — 검색·비교에는 항상 1 이상의 정수만 전달
const neededSafe = computed(() => {
  const raw = needed.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
});

const search = useBomPartsSearch(q, computed(() => true), neededSafe);
const items = computed(() => search.data.value?.data.items ?? []);
const total = computed(() => search.data.value?.data.total ?? 0);

const expandedId = ref<string | null>(null);

function submit(): void {
  q.value = input.value.trim();
  expandedId.value = null;
}

function toggleExpand(partId: string): void {
  expandedId.value = expandedId.value === partId ? null : partId;
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto px-6 pb-[60px]">
    <!-- togle btn (87:9712 동형) — 이 화면에선 단일 검색이 활성 -->
    <div class="mt-[46px] flex shrink-0 justify-center">
      <div class="flex h-[42px] items-center rounded-full bg-[#f0f4fa]">
        <RouterLink
          :to="{ name: 'bom' }"
          class="flex h-[42px] items-center rounded-full px-[24px] text-[16px] font-medium leading-[24px] text-[#27292e] transition hover:opacity-70"
        >
          BOM 분석
        </RouterLink>
        <span class="flex h-[42px] items-center rounded-full bg-[#061023] px-[24px] text-[16px] font-bold leading-[24px] text-white">단일 검색</span>
      </div>
    </div>

    <h2 class="mt-[40px] text-center text-[26px] font-bold leading-[32px] text-[#061023]">전자부품 단일 검색</h2>
    <p class="mt-[8px] text-center text-[15px] leading-[24px] text-[#616164]">품번·스펙·패키지로 검색하고 공급사별 구매 조건을 한눈에 비교하세요</p>

    <div class="mx-auto mt-7 w-full max-w-[1160px]">
      <form class="flex flex-col gap-2 sm:flex-row sm:items-center" role="search" @submit.prevent="submit">
        <input
          v-model="input"
          type="search"
          placeholder="품번·스펙·패키지 자유 검색 (예: GRM155 / 4k7 0402 / 100nF 16V)"
          class="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
        <div class="flex items-center gap-2">
          <label for="bom-search-needed" class="shrink-0 text-xs font-medium text-slate-600">필요수량</label>
          <input
            id="bom-search-needed"
            v-model.number="needed"
            type="number"
            min="1"
            step="1"
            class="h-11 w-24 rounded-xl border border-slate-300 bg-white px-3 text-right text-sm tabular-nums outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
          <button
            type="submit"
            class="h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700"
          >
            검색
          </button>
        </div>
      </form>

      <div v-if="search.isFetching.value" class="mt-5 flex items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-5 text-sm font-medium text-blue-700" aria-live="polite">
        <span class="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        카탈로그를 검색하고 있습니다.
      </div>
      <div v-else-if="search.isError.value" class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
        검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.
      </div>
      <div v-else-if="q === ''" class="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        품번이나 스펙을 입력해 부품을 검색해 주세요.
      </div>
      <div v-else-if="items.length === 0" class="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        검색 결과가 없습니다. 다른 품번 또는 스펙 표기로 시도해 보세요.
      </div>

      <div v-else class="mt-4">
        <p class="mb-2 text-right text-[11px] text-slate-400">총 {{ total.toLocaleString('ko-KR') }}건 중 {{ items.length.toLocaleString('ko-KR') }}건 · 필요수량 {{ neededSafe.toLocaleString('ko-KR') }}개 기준</p>
        <div class="overflow-x-auto rounded-[10px] border border-[#e5e8ed] bg-white">
          <table class="w-full min-w-[860px] border-collapse">
            <thead class="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e8ed]">
              <tr class="text-left text-[11px] uppercase tracking-wide text-[#8e97a5]">
                <th class="min-w-[220px] px-2 py-2.5">MPN / Part</th>
                <th class="px-2 py-2.5">Manufacturer</th>
                <th class="px-2 py-2.5">Description</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Unit Price</th>
                <th class="w-[170px] px-2 py-2.5">Packaging / Stock</th>
                <th class="w-[130px] px-2 py-2.5 text-right">Total Price</th>
                <th class="w-[100px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <template v-for="part in items" :key="part.id">
                <BomSearchRow
                  :part="part"
                  :expanded="expandedId === part.id"
                  @toggle="toggleExpand(part.id)"
                />
                <tr v-if="expandedId === part.id" class="border-b border-[#e5e8ed]">
                  <td colspan="7" class="bg-slate-50/70 px-3 py-3">
                    <div class="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <BomPartOfferOptions :part="part" :needed="neededSafe" browse />
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
