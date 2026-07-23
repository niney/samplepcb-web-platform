<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { BomPartSearchSupplementResponseType } from '@sp/api-contract';
import { useBomPartsSearch } from '../../bom/useBom';
import BomPartOfferOptions from '../../components/bom/BomPartOfferOptions.vue';
import BomSearchRow from '../../components/bom/BomSearchRow.vue';
import BomPartSearchNotice from '../../components/bom/BomPartSearchNotice.vue';
import logoIcon from '../../assets/bom/logo-partseyes-icon.png';
import searchIcon from '../../assets/bom/ic-search-20.svg';
import uploadCard from '../../assets/bom/upload-card.jpg';
import pillUnikey from '../../assets/bom/pill-unikey.png';
import pillDigikey from '../../assets/bom/pill-digikey.png';
import pillMouser from '../../assets/bom/pill-mouser.png';

// 단일 검색 — BOM 분석 카드와 동일한 배경 자산·시각 언어를 사용하고,
// 검색 후에는 기존 BOM 분석 결과 표와 같은 비교 테이블을 유지한다.
// 대표 구매 조건은 서버가 필요수량 기준으로 계산한다(pickDefaultOffer — FE와 동일 함수).

const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', src: pillUnikey },
  { name: 'DigiKey', src: pillDigikey },
  { name: 'Mouser Electronics', src: pillMouser },
];

const route = useRoute();
const initialQuery = typeof route.query.q === 'string' ? route.query.q : '';
const input = ref(initialQuery);
const q = ref(initialQuery.trim());
const needed = ref<number | string>(1);
// v-model.number는 빈 입력 시 string을 남긴다 — 검색·비교에는 항상 1 이상의 정수만 전달
const neededSafe = computed(() => {
  const raw = needed.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
});
const submittedNeeded = ref(neededSafe.value);

const search = useBomPartsSearch(q, computed(() => true), submittedNeeded);
const supplierResult = ref<BomPartSearchSupplementResponseType['data'] | null>(null);
const localItems = computed(() => search.data.value?.data.items ?? []);
const useSupplierItems = computed(() => (supplierResult.value?.items.length ?? 0) > 0);
const items = computed(() => useSupplierItems.value ? supplierResult.value?.items ?? [] : localItems.value);
const total = computed(() => useSupplierItems.value
  ? supplierResult.value?.total ?? 0
  : search.data.value?.data.total ?? 0);
const pricingContext = computed(() => supplierResult.value?.pricingContext
  ?? search.data.value?.data.pricingContext
  ?? null);

const expandedId = ref<string | null>(null);

function submit(): void {
  supplierResult.value = null;
  q.value = input.value.trim();
  submittedNeeded.value = neededSafe.value;
  expandedId.value = null;
}

function toggleExpand(partId: string): void {
  expandedId.value = expandedId.value === partId ? null : partId;
}

function acceptSupplierResult(data: BomPartSearchSupplementResponseType['data']): void {
  supplierResult.value = data;
  expandedId.value = null;
}

watch([q, submittedNeeded], () => {
  supplierResult.value = null;
  expandedId.value = null;
});
</script>

<template>
  <div class="relative flex h-full flex-col items-center overflow-y-auto px-6 pb-[60px]">
    <!-- + BOM (87:11220) — 업로드 화면으로 이동 -->
    <RouterLink
      :to="{ name: 'bom' }"
      class="absolute right-[26px] top-[16px] z-20 flex h-[36px] items-center justify-center gap-1 rounded-[6px] bg-[#1e64fd] px-[20px] text-[13px] font-medium text-white transition hover:bg-blue-700"
    >
      <span class="text-[15px] leading-none">+</span> BOM
    </RouterLink>

    <!-- togle btn (87:11163) — 단일 검색 활성 -->
    <div class="mt-[46px] flex shrink-0 justify-center">
      <div class="flex h-[42px] items-center rounded-full bg-[#f0f4fa]">
        <RouterLink
          :to="{ name: 'bom' }"
          class="flex h-[42px] items-center rounded-full px-[24px] text-[16px] font-medium leading-[24px] text-[#27292e] opacity-80 transition hover:opacity-60"
        >
          BOM 분석
        </RouterLink>
        <span class="flex h-[42px] items-center rounded-full bg-[#061023] px-[24px] text-[16px] font-bold leading-[24px] text-white">단일 검색</span>
      </div>
    </div>

    <!-- BOM 분석 카드와 동일한 배경 자산을 사용한다. 검색 후에는 결과 비교 화면으로 전환한다. -->
    <template v-if="q === ''">
      <section class="relative mt-[50px] h-[524px] w-[640px] max-w-full shrink-0 overflow-hidden rounded-[8px] bg-[#9bd6fb]">
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-[260px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]">
          <img :src="uploadCard" alt="" class="absolute inset-x-0 bottom-0 h-[524px] w-full max-w-none object-cover object-bottom">
        </div>

        <div class="pointer-events-none absolute inset-x-0 top-[68px] flex items-center justify-center gap-[10px] text-white">
          <img :src="logoIcon" alt="" class="size-[50px] mix-blend-multiply">
          <span class="text-[46px] font-light leading-[50px] tracking-[-1.8px]">Parts Eyes</span>
        </div>
        <div class="pointer-events-none absolute inset-x-0 top-[134px] text-center text-white">
          <p class="text-[20px] font-medium leading-[32px]">Search for parts</p>
          <p class="mt-[6px] text-[16px] leading-[24px] text-white/70">Enter the MPN or part name, and you can start right away</p>
        </div>

        <form class="absolute left-1/2 top-[226px] z-10 flex h-[48px] w-[426px] max-w-[calc(100%-32px)] -translate-x-1/2" role="search" @submit.prevent="submit">
          <label class="flex min-w-0 flex-1 items-center gap-[8px] rounded-l-[8px] bg-[#fdfdff] pl-[20px] pr-[12px]">
            <img :src="searchIcon" alt="" class="size-[20px] shrink-0">
            <input
              v-model="input"
              type="search"
              aria-label="부품 검색어"
              placeholder="예: GRM155R71C104KA88, 100nF..."
              class="min-w-0 flex-1 bg-transparent text-[14px] leading-[24px] text-[#263248] outline-none placeholder:text-[#5b6a7e]"
            >
          </label>
          <button type="submit" class="flex h-[48px] shrink-0 items-center rounded-r-[8px] bg-[#1e64fd] px-[16px] text-[16px] font-bold leading-[24px] text-white transition hover:bg-blue-700">
            Search
          </button>
        </form>
      </section>

      <!-- contents (BOM 분석과 동일한 3개 공급사만 노출) -->
      <h2 class="mt-[50px] text-center text-[26px] font-bold leading-[32px] text-[#061023]">전자부품 2,000만+ 다양한 제조사</h2>
      <p class="mt-[8px] text-center text-[18px] leading-[32px] text-[#616164]">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
      <div class="mt-[22px] flex flex-wrap items-center justify-center gap-[12px]">
        <img
          v-for="logo in SUPPLIER_LOGOS"
          :key="logo.name"
          :src="logo.src"
          :alt="logo.name"
          class="h-[66px] w-[148px]"
        >
      </div>
    </template>

    <template v-else>
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
            <button type="submit" class="h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700">
              검색
            </button>
          </div>
        </form>

        <BomPartSearchNotice
          v-if="search.data.value !== undefined"
          :query="q"
          :mode="search.data.value.data.searchMode"
          :interpreted-spec-count="search.data.value.data.interpretedSpecCount"
          :needed="submittedNeeded"
          auto
          @complete="acceptSupplierResult"
        />
        <div v-if="search.isFetching.value" class="mt-5 flex items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-5 text-sm font-medium text-blue-700" aria-live="polite">
          <span class="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          카탈로그를 검색하고 있습니다.
        </div>
        <div v-else-if="search.isError.value" class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.
        </div>
        <template v-else>
          <div v-if="items.length === 0" class="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            로컬 카탈로그에 검색 결과가 없습니다. 규격 검색이라면 공급사 추가 확인을 사용해 보세요.
          </div>

          <div v-else class="mt-4">
            <div class="mb-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-slate-400">
              <span v-if="useSupplierItems" class="font-semibold text-blue-600">공급사 현재 후보</span>
              <span>총 {{ total.toLocaleString('ko-KR') }}건 중 {{ items.length.toLocaleString('ko-KR') }}건 · 필요수량 {{ submittedNeeded.toLocaleString('ko-KR') }}개 기준</span>
              <span v-if="pricingContext?.usdKrwRate !== null && pricingContext?.usdKrwRate !== undefined">
                USD 1 = {{ pricingContext.usdKrwRate.toLocaleString('ko-KR') }}원 환산<span v-if="pricingContext.stale" class="ml-1 font-semibold text-amber-600">(이전 기준)</span>
              </span>
              <span v-else class="font-semibold text-amber-600">환율 미확인 통화는 원통화로 표시</span>
            </div>
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
                          <BomPartOfferOptions
                            :part="part"
                            :needed="submittedNeeded"
                            :usd-krw-rate="pricingContext?.usdKrwRate ?? null"
                            browse
                          />
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
