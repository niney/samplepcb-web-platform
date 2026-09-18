<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  BomPartHitType,
  BomPartOfferOptionType,
  BomPartSearchSupplementResponseType,
  BomSearchCartAddBodyType,
} from '@sp/api-contract';
import { useBomPartsSearch } from '../../bom/useBom';
import { SUPPLIER_META } from '../../bom/supplier-meta';
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
  /** 협력사 보유 담기 — 구매 조건이 없어 offer 인자가 없다(docs/PARTNER_PARTS.md). */
  addPartner: [body: BomSearchCartAddBodyType, key: string, part: BomPartHitType];
  add: [
    body: BomSearchCartAddBodyType,
    key: string,
    part: BomPartHitType,
    offer: BomPartOfferOptionType,
  ];
  remove: [partId: string, key: string];
  queryChange: [query: string];
}>();

const searchInput = ref<HTMLInputElement | null>(null);
const { t } = useI18n();
const actionErrorElement = ref<HTMLElement | null>(null);
const input = ref(props.initialQuery);
const q = ref(props.initialQuery.trim());
const safeSupplementNeeded = computed(() => {
  const needed = Math.floor(props.supplementNeeded);
  if (!Number.isFinite(needed)) return 1;
  return Math.min(1_000_000, Math.max(1, needed));
});
const search = useBomPartsSearch(q, computed(() => true), safeSupplementNeeded);
const supplierResult = ref<BomPartSearchSupplementResponseType['data'] | null>(null);
const searchRevision = ref(0);
type SupplierSearchState = 'idle' | 'searching' | 'complete' | 'failed';
const supplierSearchState = ref<SupplierSearchState>(q.value === '' ? 'idle' : 'searching');
const supplierSearching = computed(() => supplierSearchState.value === 'searching');
const localItems = computed(() => search.data.value?.data.items ?? []);
const items = computed(() => {
  const localById = new Map(localItems.value.map((item) => [item.id, item]));
  const merged = new Map<string, BomPartHitType>();
  for (const item of supplierResult.value?.items ?? []) {
    const local = localById.get(item.id);
    const existing = merged.get(item.id);
    if (existing !== undefined) {
      // 엔진의 기술 근거 그룹이 같은 카탈로그 부품에 연결돼도 구매 조건은 보존한다.
      const offers = new Map(existing.offerOptions.map((offer) => [
        `${offer.supplier}\u001f${offer.supplierSku}\u001f${offer.packaging ?? ''}`, offer,
      ]));
      for (const offer of item.offerOptions) {
        const key = `${offer.supplier}\u001f${offer.supplierSku}\u001f${offer.packaging ?? ''}`;
        if (!offers.has(key)) offers.set(key, offer);
      }
      merged.set(item.id, { ...existing, offerOptions: [...offers.values()] });
    } else {
      merged.set(item.id, {
        ...item,
        imageUrl: item.imageUrl ?? local?.imageUrl ?? null,
        hasPartnerStock: local?.hasPartnerStock ?? item.hasPartnerStock,
        partnerStock: local?.partnerStock ?? item.partnerStock,
      });
    }
  }
  for (const item of localItems.value) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()];
});
const total = computed(() => items.value.length);
const incompleteSuppliers = computed(() => (supplierResult.value?.engine.incompleteSuppliers ?? [])
  .map((supplier) => SUPPLIER_META[supplier]?.name ?? supplier)
  .join(', '));
const pricingContext = computed(() => supplierResult.value?.pricingContext
  ?? search.data.value?.data.pricingContext
  ?? null);
const initialCatalogLoading = computed(() => search.isFetching.value && search.data.value === undefined);
const awaitingSupplierResults = computed(() => q.value !== '' && supplierSearching.value);
const resultsPending = computed(() => initialCatalogLoading.value || awaitingSupplierResults.value);
const resultStatus = computed(() => {
  if (q.value === '') return '품번·규격·패키지로 검색할 수 있습니다.';
  if (resultsPending.value) return awaitingSupplierResults.value ? '공급사 검색 중' : '부품 검색 중';
  if (supplierSearchState.value === 'failed' && items.value.length === 0) return t('bomPartSearch.failed');
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

watch(
  () => props.actionError,
  async (value) => {
    if (value === null) return;
    await nextTick();
    actionErrorElement.value?.focus();
  },
);

function focusSearch(): void {
  searchInput.value?.focus();
}

defineExpose({ focusSearch });

function submit(): void {
  const nextQuery = input.value.trim();
  const searchChanged = nextQuery !== q.value;
  supplierResult.value = null;
  if (nextQuery === '') supplierSearchState.value = 'idle';
  else supplierSearchState.value = 'searching';
  if (!searchChanged) searchRevision.value += 1;
  q.value = nextQuery;
  emit('queryChange', nextQuery);
}

function beginSupplierSearch(): void {
  supplierResult.value = null;
  supplierSearchState.value = 'searching';
}

function acceptSupplierResult(data: BomPartSearchSupplementResponseType['data']): void {
  supplierSearchState.value = 'complete';
  supplierResult.value = data;
}

function failSupplierSearch(): void {
  supplierSearchState.value = 'failed';
}
</script>

<template>
  <section class="min-w-0 flex-1 overflow-y-auto px-[24px] pb-[32px] pt-[10px]">
    <div class="flex min-h-[44px] flex-wrap items-start justify-between gap-[16px]">
      <div class="flex min-w-0 items-start gap-[16px] font-noto">
        <div class="min-w-0">
          <h1 class="truncate font-sans text-[18px] font-medium leading-[21px] text-ink-strong">{{ title }}</h1>
          <p class="mt-[4px] font-noto text-[13px] font-medium leading-[16px] text-ink-subtle">{{ resultStatus }}</p>
        </div>
        <slot name="title-actions" />
      </div>
      <div v-if="q !== ''" class="max-w-[560px]">
        <BomPartSearchNotice
          :key="`${q}\u001f${safeSupplementNeeded}\u001f${searchRevision}`"
          :query="q"
          :mode="search.data.value?.data.searchMode ?? 'text'"
          :interpreted-spec-count="search.data.value?.data.interpretedSpecCount ?? 0"
          :needed="safeSupplementNeeded"
          :result-count="total"
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
        <input ref="searchInput" v-model="input" type="search" aria-label="부품 검색어" placeholder="MPN, 사양 또는 패키지로 검색" class="min-w-0 flex-1 bg-transparent font-noto text-[14px] font-normal leading-[20px] text-ink outline-none placeholder:text-ink-faint">
      </label>
      <button type="submit" class="flex h-full w-[94px] shrink-0 items-center justify-center gap-[8px] rounded-[8px] bg-brand px-[14px] font-sans text-[16px] font-bold text-white transition hover:bg-brand-strong">
        <img :src="searchIcon" alt="" class="size-[18px] brightness-0 invert">
        검색
      </button>
    </form>

    <p v-if="actionError !== null" ref="actionErrorElement" class="mt-[8px] rounded-[5px] border border-red-200 bg-red-50 px-[10px] py-[7px] font-noto text-[11px] leading-[16px] text-red-700 outline-none focus:ring-2 focus:ring-red-300" role="alert" tabindex="-1">{{ actionError }}</p>
    <p v-if="!resultsPending && incompleteSuppliers !== ''" class="mt-[12px] rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 font-noto text-[12px] text-amber-900" role="status">{{ t('bomPartSearch.incompleteSuppliers', { suppliers: incompleteSuppliers }) }}</p>
    <p v-if="!resultsPending && supplierSearchState === 'failed' && items.length > 0" class="mt-[12px] rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 font-noto text-[12px] text-amber-900" role="status">{{ t('bomPartSearch.catalogFallback') }}</p>
    <p v-if="!resultsPending && search.isError.value && supplierResult !== null" class="mt-[12px] rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 font-noto text-[12px] text-amber-900" role="status">{{ t('bomPartSearch.supplierFallback') }}</p>
    <div v-if="q === ''" class="mt-[12px] rounded-[8px] border border-dashed border-line-strong bg-surface px-4 py-12 text-center font-noto text-[12px] text-ink-subtle">{{ emptyPrompt }}</div>
    <div v-else-if="resultsPending" class="mt-[12px] flex h-[94px] items-center justify-center gap-2 rounded-[8px] border border-line-strong bg-surface font-noto text-[12px] font-medium text-brand" aria-live="polite">
      <span class="size-4 animate-spin rounded-full border-2 border-line border-t-brand" />{{ awaitingSupplierResults ? t('bomPartSearch.checking') : '카탈로그를 검색하고 있습니다.' }}
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
      @add-partner="(body, key, part) => emit('addPartner', body, key, part)"
      @remove="(partId, key) => emit('remove', partId, key)"
    />
  </section>
</template>
