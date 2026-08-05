<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  BomPartHitType,
  BomPartOfferOptionType,
  BomPartSearchSupplementResponseType,
  BomSearchCartAddBodyType,
} from '@sp/api-contract';
import { useBomPartsSearch } from '../../bom/useBom';
import searchIcon from '../../assets/bom/ic-search-20.svg';
import BomPartSearchNotice from './BomPartSearchNotice.vue';
import BomSearchOfferTable from './BomSearchOfferTable.vue';

const props = withDefaults(defineProps<{
  initialQuery?: string;
  title: string;
  emptyPrompt?: string;
  supplementNeeded?: number;
  quantityMultiplier?: number;
  selectedPartIds: Set<string>;
  selectedSelectionKeys: Set<string>;
  pendingKey: string | null;
  busy: boolean;
  actionError?: string | null;
  actionContext?: 'cart' | 'quote';
}>(), {
  initialQuery: '',
  emptyPrompt: 'MPN, 규격 또는 패키지를 입력해 부품을 검색해 주세요.',
  supplementNeeded: 1,
  quantityMultiplier: 1,
  actionError: null,
  actionContext: 'cart',
});

const emit = defineEmits<{
  add: [
    body: BomSearchCartAddBodyType,
    key: string,
    part: BomPartHitType,
    offer: BomPartOfferOptionType,
  ];
  remove: [partId: string, key: string];
  queryChange: [query: string];
}>();

const input = ref(props.initialQuery);
const q = ref(props.initialQuery.trim());
const safeSupplementNeeded = computed(() => {
  const needed = Math.floor(props.supplementNeeded);
  if (!Number.isFinite(needed)) return 1;
  return Math.min(1_000_000, Math.max(1, needed));
});
const search = useBomPartsSearch(q, computed(() => true), safeSupplementNeeded);
const supplierResult = ref<BomPartSearchSupplementResponseType['data'] | null>(null);
type SupplierSearchState = 'idle' | 'searching' | 'complete' | 'failed';
const supplierSearchState = ref<SupplierSearchState>(q.value === '' ? 'idle' : 'searching');
const supplierSearching = computed(() => supplierSearchState.value === 'searching');
const localItems = computed(() => search.data.value?.data.items ?? []);
const useSupplierItems = computed(() => (supplierResult.value?.items.length ?? 0) > 0);
const items = computed(() => useSupplierItems.value
  ? supplierResult.value?.items ?? []
  : localItems.value);
const total = computed(() => useSupplierItems.value
  ? supplierResult.value?.total ?? 0
  : search.data.value?.data.total ?? 0);
const pricingContext = computed(() => supplierResult.value?.pricingContext
  ?? search.data.value?.data.pricingContext
  ?? null);
const hasPricedSupplierOffer = computed(() => items.value.some((item) => item.applied !== null));
const initialCatalogLoading = computed(() => search.isFetching.value && search.data.value === undefined);
const awaitingSupplierResults = computed(() => (
  search.data.value !== undefined
  && supplierSearching.value
  && !hasPricedSupplierOffer.value
));
const resultsPending = computed(() => initialCatalogLoading.value || awaitingSupplierResults.value);
const resultStatus = computed(() => {
  if (q.value === '') return '품번·규격·패키지로 검색할 수 있습니다.';
  if (resultsPending.value) return awaitingSupplierResults.value ? '공급사 검색 중' : '부품 검색 중';
  return `검색 결과 - ${total.value.toLocaleString('ko-KR')}개 부품`;
});

watch(
  () => props.initialQuery,
  (value) => {
    if (value.trim() === q.value && value === input.value) return;
    input.value = value;
    q.value = value.trim();
    supplierResult.value = null;
    supplierSearchState.value = q.value === '' ? 'idle' : 'searching';
  },
);

watch(safeSupplementNeeded, () => {
  supplierResult.value = null;
  supplierSearchState.value = q.value === '' ? 'idle' : 'searching';
});

function submit(): void {
  const nextQuery = input.value.trim();
  const searchChanged = nextQuery !== q.value;
  supplierResult.value = null;
  if (nextQuery === '') supplierSearchState.value = 'idle';
  else if (searchChanged) supplierSearchState.value = 'searching';
  q.value = nextQuery;
  emit('queryChange', nextQuery);
}

function beginSupplierSearch(): void {
  supplierSearchState.value = 'searching';
}

function acceptSupplierResult(data: BomPartSearchSupplementResponseType['data']): void {
  supplierSearchState.value = 'complete';
  if (data.catalog.status === 'completed') {
    // 공통 supplement mutation이 parts-search 캐시를 무효화하므로 인라인 결과를
    // 따로 붙이지 않고 갱신된 카탈로그 응답을 사용한다.
    supplierResult.value = null;
    return;
  }
  supplierResult.value = data;
}

function failSupplierSearch(): void {
  supplierSearchState.value = 'failed';
}
</script>

<template>
  <section class="min-w-0 flex-1 overflow-y-auto px-[24px] pb-[32px] pt-[10px]">
    <div class="flex min-h-[44px] items-start justify-between gap-[16px]">
      <div class="flex min-w-0 items-start gap-[16px] font-noto">
        <div class="min-w-0">
          <h1 class="truncate font-sans text-[18px] font-medium leading-[21px] text-ink-strong">{{ title }}</h1>
          <p class="mt-[4px] font-noto text-[13px] font-medium leading-[16px] text-ink-subtle">{{ resultStatus }}</p>
        </div>
        <slot name="title-actions" />
      </div>
      <div v-if="search.data.value !== undefined" class="hidden max-w-[560px] lg:block">
        <BomPartSearchNotice
          :query="q"
          :mode="search.data.value.data.searchMode"
          :interpreted-spec-count="search.data.value.data.interpretedSpecCount"
          :needed="safeSupplementNeeded"
          auto
          wait-for-catalog
          compact
          @start="beginSupplierSearch"
          @complete="acceptSupplierResult"
          @failed="failSupplierSearch"
        />
      </div>
    </div>

    <form class="mt-[31px] flex h-[48px] w-full gap-[10px]" role="search" @submit.prevent="submit">
      <label class="flex min-w-0 flex-1 items-center rounded-[8px] border border-search-input bg-search-input px-[20px] shadow-sm">
        <input v-model="input" type="search" placeholder="MPN, 사양 또는 패키지로 검색" class="min-w-0 flex-1 bg-transparent font-noto text-[14px] font-normal leading-[20px] text-ink outline-none placeholder:text-ink-faint">
      </label>
      <button type="submit" class="flex h-full w-[94px] shrink-0 items-center justify-center gap-[8px] rounded-[8px] bg-brand px-[14px] font-sans text-[16px] font-bold text-white transition hover:bg-brand-strong">
        <img :src="searchIcon" alt="" class="size-[18px] brightness-0 invert">
        검색
      </button>
    </form>

    <p v-if="actionError !== null" class="mt-[8px] rounded-[5px] border border-red-200 bg-red-50 px-[10px] py-[7px] font-noto text-[11px] leading-[16px] text-red-700" role="alert">{{ actionError }}</p>
    <div v-if="q === ''" class="mt-[12px] rounded-[8px] border border-dashed border-line-strong bg-surface px-4 py-12 text-center font-noto text-[12px] text-ink-subtle">{{ emptyPrompt }}</div>
    <div v-else-if="search.isError.value && search.data.value === undefined" class="mt-[12px] rounded-[8px] border border-red-200 bg-red-50 px-4 py-6 text-center font-noto text-[12px] text-red-700">검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</div>
    <div v-else-if="resultsPending" class="mt-[12px] flex h-[94px] items-center justify-center gap-2 rounded-[8px] border border-line-strong bg-surface font-noto text-[12px] font-medium text-brand" aria-live="polite">
      <span class="size-4 animate-spin rounded-full border-2 border-line border-t-brand" />{{ awaitingSupplierResults ? '공급사에서 부품과 구매 조건을 검색하고 있습니다.' : '카탈로그를 검색하고 있습니다.' }}
    </div>
    <div v-else-if="supplierSearchState === 'failed' && items.length === 0" class="mt-[12px] rounded-[8px] border border-red-200 bg-red-50 px-4 py-6 text-center font-noto text-[12px] text-red-700" role="alert">공급사 검색을 완료하지 못했습니다. 상단에서 다시 검색해 주세요.</div>
    <div v-else-if="items.length === 0" class="mt-[12px] rounded-[8px] border border-dashed border-line-strong bg-surface px-4 py-12 text-center font-noto text-[12px] text-ink-subtle">검색 결과가 없습니다. 품번 또는 규격을 다시 확인해 주세요.</div>
    <BomSearchOfferTable
      v-else
      class="mt-[12px]"
      :items="items"
      :initial-quantity="1"
      :quantity-multiplier="quantityMultiplier"
      :usd-krw-rate="pricingContext?.usdKrwRate ?? null"
      :cart-part-ids="selectedPartIds"
      :cart-selection-keys="selectedSelectionKeys"
      :pending-key="pendingKey"
      :cart-busy="busy"
      :supplier-search-state="supplierSearchState"
      :action-context="actionContext"
      @add="(body, key, part, offer) => emit('add', body, key, part, offer)"
      @remove="(partId, key) => emit('remove', partId, key)"
    />
  </section>
</template>
