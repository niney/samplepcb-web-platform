<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  BomPartSearchSupplementResponseType,
  BomSearchCartAddBodyType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAddBomSearchCartItem,
  useBomPartsSearch,
  useBomSearchCart,
  usePatchBomSearchCartItem,
  useRemoveBomSearchCartItem,
  useRequestBomQuote,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import BomPartSearchNotice from '../../components/bom/BomPartSearchNotice.vue';
import BomSearchCartPanel from '../../components/bom/BomSearchCartPanel.vue';
import BomSearchOfferTable from '../../components/bom/BomSearchOfferTable.vue';
import logoIcon from '../../assets/bom/logo-partseyes-icon.png';
import searchIcon from '../../assets/bom/ic-search-20.svg';
import uploadCard from '../../assets/bom/upload-card.jpg';
import pillUnikey from '../../assets/bom/pill-unikey.png';
import pillDigikey from '../../assets/bom/pill-digikey.png';
import pillMouser from '../../assets/bom/pill-mouser.png';

const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', src: pillUnikey },
  { name: 'DigiKey', src: pillDigikey },
  { name: 'Mouser Electronics', src: pillMouser },
];

const route = useRoute();
const router = useRouter();
const { rightOpen } = useBomPanels();
const initialQuery = typeof route.query.q === 'string' ? route.query.q : '';
const input = ref(initialQuery);
const q = ref(initialQuery.trim());
const needed = ref<number | string>(1);
const neededSafe = computed(() => {
  const raw = needed.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1
    ? Math.min(1_000_000, Math.floor(raw))
    : 1;
});
const submittedNeeded = ref(neededSafe.value);

const search = useBomPartsSearch(q, computed(() => true), submittedNeeded);
const supplierResult = ref<BomPartSearchSupplementResponseType['data'] | null>(null);
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

const cartQuery = useBomSearchCart(computed(() => true));
const cart = computed(() => cartQuery.data.value?.data ?? null);
const cartPartIds = computed(() => new Set(
  (cart.value?.items ?? []).flatMap((item) => item.partId === null ? [] : [item.partId]),
));
const cartSelectionKeys = computed(() => new Set(
  (cart.value?.items ?? []).flatMap((item) => {
    if (item.partId === null) return [];
    if (item.selectedOffer === null) return [`${item.partId}\u001fmanufacturer_catalog`];
    return [`${item.partId}\u001fsupplier_offer\u001f${item.selectedOffer.supplier}\u001f${item.selectedOffer.supplierSku}`];
  }),
));
const addCartItem = useAddBomSearchCartItem();
const patchCartItem = usePatchBomSearchCartItem();
const removeCartItem = useRemoveBomSearchCartItem();
const requestQuote = useRequestBomQuote();
const pendingAddKey = ref<string | null>(null);
const pendingItemId = ref<string | null>(null);
const removingItemId = ref<string | null>(null);
const actionError = ref<string | null>(null);
const mobileCartOpen = ref(false);
const cartItemCount = computed(() => cart.value?.items.length ?? 0);

function submit(): void {
  supplierResult.value = null;
  q.value = input.value.trim();
  submittedNeeded.value = neededSafe.value;
  actionError.value = null;
  void router.replace({ query: q.value === '' ? {} : { q: q.value } });
}

async function acceptSupplierResult(data: BomPartSearchSupplementResponseType['data']): Promise<void> {
  if (data.catalog.status === 'completed') {
    // 카트는 숫자 partId만 받는다. 인제스트·색인이 끝난 뒤 같은 검색을 다시 읽어
    // 화면 후보와 서버 카탈로그 정체성을 정확히 일치시킨다.
    supplierResult.value = null;
    await search.refetch();
    return;
  }
  supplierResult.value = data;
}

function mutationMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 409) return error.message || '선택한 구매조건이 변경되었습니다. 다시 검색해 주세요.';
  if (error.status === 404) return '부품 또는 견적 바구니를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.';
  return error.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function addToCart(body: BomSearchCartAddBodyType, key: string): Promise<void> {
  pendingAddKey.value = key;
  actionError.value = null;
  try {
    await addCartItem.mutateAsync(body);
  } catch (error: unknown) {
    actionError.value = mutationMessage(error);
  } finally {
    pendingAddKey.value = null;
  }
}

async function updateCartQuantity(itemId: string, quantity: number): Promise<void> {
  pendingItemId.value = itemId;
  actionError.value = null;
  try {
    await patchCartItem.mutateAsync({ itemId, body: { bomQty: quantity } });
  } catch (error: unknown) {
    actionError.value = mutationMessage(error);
  } finally {
    pendingItemId.value = null;
  }
}

async function removeFromCart(itemId: string): Promise<void> {
  removingItemId.value = itemId;
  actionError.value = null;
  try {
    await removeCartItem.mutateAsync(itemId);
  } catch (error: unknown) {
    actionError.value = mutationMessage(error);
  } finally {
    removingItemId.value = null;
  }
}

async function removePartFromCart(partId: string): Promise<void> {
  const item = cart.value?.items.find((candidate) => candidate.partId === partId);
  if (item !== undefined) await removeFromCart(item.id);
}

async function requestCartQuote(): Promise<void> {
  const quoteId = cart.value?.id;
  if (quoteId === undefined) return;
  actionError.value = null;
  try {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    await requestQuote.mutateAsync({ quoteId, title: `단일검색 견적 ${date}` });
    mobileCartOpen.value = false;
    await router.push({ name: 'bom-quote', params: { id: quoteId } });
  } catch (error: unknown) {
    actionError.value = mutationMessage(error);
  }
}

watch([q, submittedNeeded], () => {
  supplierResult.value = null;
  actionError.value = null;
});
</script>

<template>
  <div v-if="q === ''" class="relative flex h-full flex-col items-center overflow-y-auto px-6 pb-[60px]">
    <RouterLink :to="{ name: 'bom' }" class="absolute right-[26px] top-[16px] z-20 flex h-[36px] items-center justify-center gap-1 rounded-[6px] bg-brand-strong px-[20px] text-[13px] font-medium text-white transition hover:bg-blue-700">
      <span class="text-[15px] leading-none">+</span> BOM
    </RouterLink>

    <div class="mt-[46px] flex shrink-0 justify-center">
      <div class="flex h-[42px] items-center rounded-full bg-surface-raised">
        <RouterLink :to="{ name: 'bom' }" class="flex h-[42px] items-center rounded-full px-[24px] text-[16px] font-medium leading-[24px] text-ink opacity-80 transition hover:opacity-60">BOM 분석</RouterLink>
        <span class="flex h-[42px] items-center rounded-full bg-ink-strong px-[24px] text-[16px] font-bold leading-[24px] text-white">단일 검색</span>
      </div>
    </div>

    <section class="relative mt-[50px] h-[524px] w-[640px] max-w-full shrink-0 overflow-hidden rounded-[8px] bg-brand-soft">
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-[260px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]">
        <img :src="uploadCard" alt="" class="absolute inset-x-0 bottom-0 h-[524px] w-full max-w-none object-cover object-bottom">
      </div>
      <div class="pointer-events-none absolute inset-x-0 top-[68px] flex items-center justify-center gap-[10px] text-white">
        <img :src="logoIcon" alt="" class="size-[50px] mix-blend-multiply">
        <span class="text-[46px] font-light leading-[50px] tracking-[-1.8px]">Parts Eyes</span>
      </div>
      <div class="pointer-events-none absolute inset-x-0 top-[134px] text-center text-white">
        <p class="text-[20px] font-medium leading-[32px]">부품 검색</p>
        <p class="mt-[6px] text-[16px] leading-[24px] text-white/70">MPN 또는 부품명을 입력하면 바로 검색할 수 있습니다</p>
      </div>
      <form class="absolute left-1/2 top-[226px] z-10 flex h-[48px] w-[426px] max-w-[calc(100%-32px)] -translate-x-1/2" role="search" @submit.prevent="submit">
        <label class="flex min-w-0 flex-1 items-center gap-[8px] rounded-l-[8px] bg-surface pl-[20px] pr-[12px]">
          <img :src="searchIcon" alt="" class="size-[20px] shrink-0">
          <input v-model="input" type="search" aria-label="부품 검색어" placeholder="예: GRM155R71C104KA88, 100nF..." class="min-w-0 flex-1 bg-transparent text-[14px] leading-[24px] text-ink outline-none placeholder:text-ink-muted">
        </label>
        <button type="submit" class="flex h-[48px] shrink-0 items-center rounded-r-[8px] bg-brand-strong px-[16px] text-[16px] font-bold leading-[24px] text-white transition hover:bg-blue-700">검색</button>
      </form>
    </section>

    <h2 class="mt-[50px] text-center text-[26px] font-bold leading-[32px] text-ink-strong">전자부품 2,000만+ 다양한 제조사</h2>
    <p class="mt-[8px] text-center text-[18px] leading-[32px] text-ink-neutral">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
    <div class="mt-[22px] flex flex-wrap items-center justify-center gap-[12px]">
      <img v-for="logo in SUPPLIER_LOGOS" :key="logo.name" :src="logo.src" :alt="logo.name" class="h-[66px] w-[148px]">
    </div>
  </div>

  <div v-else class="flex h-full min-h-0 bg-surface-sunken">
    <section class="min-w-0 flex-1 overflow-y-auto px-[24px] pb-[32px] pt-[10px]">
      <div class="flex h-[44px] items-start justify-between gap-[16px]">
        <div class="flex items-start gap-[16px] font-noto">
          <div>
            <h1 class="text-[16px] font-bold leading-[21px] text-ink-strong">전자부품 단일 검색</h1>
            <p class="mt-[2px] text-[12px] font-normal leading-[16px] text-ink-subtle">검색 결과 - {{ total.toLocaleString('ko-KR') }}개 부품</p>
          </div>
          <RouterLink :to="{ name: 'bom' }" class="flex h-[32px] items-center gap-[5px] rounded-[6px] border border-brand-soft bg-search-row px-[10px] font-sans text-[14px] font-medium text-brand-soft hover:bg-surface-brand-soft"><span class="text-[18px] font-normal leading-none">+</span> BOM</RouterLink>
        </div>
        <div v-if="search.data.value !== undefined" class="hidden max-w-[560px] lg:block">
          <BomPartSearchNotice
            :query="q"
            :mode="search.data.value.data.searchMode"
            :interpreted-spec-count="search.data.value.data.interpretedSpecCount"
            :needed="submittedNeeded"
            auto
            wait-for-catalog
            compact
            @complete="acceptSupplierResult"
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
      <div v-if="search.isFetching.value" class="mt-[12px] flex h-[94px] items-center justify-center gap-2 rounded-[8px] border border-line-strong bg-surface font-noto text-[12px] font-medium text-brand" aria-live="polite">
        <span class="size-4 animate-spin rounded-full border-2 border-line border-t-brand" />카탈로그를 검색하고 있습니다.
      </div>
      <div v-else-if="search.isError.value" class="mt-[12px] rounded-[8px] border border-red-200 bg-red-50 px-4 py-6 text-center font-noto text-[12px] text-red-700">검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</div>
      <div v-else-if="items.length === 0" class="mt-[12px] rounded-[8px] border border-dashed border-line-strong bg-surface px-4 py-12 text-center font-noto text-[12px] text-ink-subtle">검색 결과가 없습니다. 품번 또는 규격을 다시 확인해 주세요.</div>
      <BomSearchOfferTable
        v-else
        class="mt-[12px]"
        :items="items"
        :needed="submittedNeeded"
        :usd-krw-rate="pricingContext?.usdKrwRate ?? null"
        :cart-part-ids="cartPartIds"
        :cart-selection-keys="cartSelectionKeys"
        :pending-key="pendingAddKey"
        :cart-busy="removingItemId !== null"
        @add="addToCart"
        @remove="removePartFromCart"
      />
    </section>

    <BomSearchCartPanel
      v-show="rightOpen"
      class="hidden xl:flex"
      :cart="cart"
      :loading="cartQuery.isLoading.value"
      :pending-item-id="pendingItemId"
      :removing-item-id="removingItemId"
      :requesting="requestQuote.isPending.value"
      @quantity="updateCartQuantity"
      @remove="removeFromCart"
      @request="requestCartQuote"
    />

    <button
      type="button"
      class="fixed bottom-[18px] right-[18px] z-40 flex h-[44px] items-center gap-[7px] rounded-full bg-action-primary px-[16px] font-noto text-[12px] font-bold text-white shadow-lg transition hover:bg-action-primary-hover xl:hidden"
      aria-label="견적 바구니 열기"
      @click="mobileCartOpen = true"
    >
      견적 바구니
      <span class="grid min-w-[20px] place-items-center rounded-full bg-white/20 px-[5px] py-[1px] text-[11px] tabular-nums">{{ cartItemCount }}</span>
    </button>

    <Teleport to="body">
      <div v-if="mobileCartOpen" class="fixed inset-0 z-[100] xl:hidden">
        <button type="button" class="absolute inset-0 size-full bg-black/45" aria-label="견적 바구니 닫기" @click="mobileCartOpen = false" />
        <div class="absolute inset-x-0 bottom-0 h-[82dvh] min-h-0 overflow-hidden rounded-t-[14px] border-t border-line bg-search-cart shadow-2xl" role="dialog" aria-modal="true" aria-label="견적 바구니">
          <button type="button" class="absolute right-[48px] top-[10px] z-10 grid size-[30px] place-items-center rounded-full text-[20px] leading-none text-ink-muted hover:bg-surface-raised" aria-label="견적 바구니 닫기" @click="mobileCartOpen = false">×</button>
          <BomSearchCartPanel
            :cart="cart"
            :loading="cartQuery.isLoading.value"
            :pending-item-id="pendingItemId"
            :removing-item-id="removingItemId"
            :requesting="requestQuote.isPending.value"
            @quantity="updateCartQuantity"
            @remove="removeFromCart"
            @request="requestCartQuote"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>
