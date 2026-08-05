<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BomSearchCartAddBodyType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAddBomSearchCartItem,
  useBomSearchCart,
  usePatchBomSearchCartItem,
  useRemoveBomSearchCartItem,
  useRequestBomQuote,
} from '../../bom/useBom';
import { useBomPanels } from '../../bom/usePanels';
import { bomQuoteItemSelectionKey } from '../../bom/search-selection';
import BomLandingCard from '../../components/bom/BomLandingCard.vue';
import BomLandingIntro from '../../components/bom/BomLandingIntro.vue';
import BomLandingToggle from '../../components/bom/BomLandingToggle.vue';
import BomPartSearchWorkspace from '../../components/bom/BomPartSearchWorkspace.vue';
import BomSearchCartPanel from '../../components/bom/BomSearchCartPanel.vue';
import searchIcon from '../../assets/bom/ic-search-20.svg';

const route = useRoute();
const router = useRouter();
const { rightOpen } = useBomPanels();
const initialQuery = typeof route.query.q === 'string' ? route.query.q : '';
const landingInput = ref(initialQuery);
const q = ref(initialQuery.trim());

const cartQuery = useBomSearchCart(computed(() => true));
const cart = computed(() => cartQuery.data.value?.data ?? null);
const cartPartIds = computed(() => new Set(
  (cart.value?.items ?? []).flatMap((item) => item.partId === null ? [] : [item.partId]),
));
const cartSelectionKeys = computed(() => new Set(
  (cart.value?.items ?? []).flatMap((item) => {
    const key = bomQuoteItemSelectionKey(item);
    return key === null ? [] : [key];
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

function submitLanding(): void {
  const nextQuery = landingInput.value.trim();
  q.value = nextQuery;
  actionError.value = null;
  void router.replace({ query: q.value === '' ? {} : { q: q.value } });
}

function updateWorkspaceQuery(query: string): void {
  q.value = query;
  actionError.value = null;
  void router.replace({ query: query === '' ? {} : { q: query } });
}

function mutationMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 409) return error.message || '선택한 구매 조건이 변경되었습니다. 다시 검색해 주세요.';
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

</script>

<template>
  <div v-if="q === ''" class="relative flex h-full flex-col items-center overflow-y-auto px-6 pb-[60px] font-noto">
    <RouterLink :to="{ name: 'bom' }" class="absolute right-[26px] top-[16px] z-20 flex h-[36px] items-center justify-center gap-1 rounded-[6px] bg-brand-strong px-[20px] text-[13px] font-medium text-white transition hover:bg-blue-700">
      <span class="text-[15px] leading-none">+</span> BOM
    </RouterLink>

    <BomLandingToggle active="search" />

    <!-- search card (2282:61416) — 배경은 텍스트 없는 공용 베이크, 로고·타이틀은 실 DOM
         (BomLandingCard 참조). BOM 분석 탭과 텍스트 위치를 공유하고 검색 폼만 겹친다. -->
    <section class="relative mt-[50px] h-[524px] w-[640px] shrink-0 overflow-hidden rounded-[8px]" aria-label="부품 단일 검색">
      <BomLandingCard title="Search for parts" subtitle="Enter the MPN or part name, and you can start right away" />
      <form class="absolute left-1/2 top-[226px] z-10 flex h-[48px] w-[426px] -translate-x-1/2" role="search" @submit.prevent="submitLanding">
        <label class="flex min-w-0 w-[340px] flex-1 items-center gap-[8px] rounded-l-[8px] bg-[#fdfdff] pl-[20px] pr-[16px]">
          <img :src="searchIcon" alt="" class="size-[20px] shrink-0">
          <input v-model="landingInput" type="search" aria-label="부품 검색어" placeholder="예: GRM155R71C104KA88, 100nF..." class="min-w-0 flex-1 bg-transparent text-[14px] font-normal leading-[24px] text-[#061023] outline-none placeholder:text-[#5b6a7e]">
        </label>
        <button type="submit" class="flex h-[48px] w-[86px] shrink-0 items-center justify-center rounded-r-[8px] bg-[#1e64fd] text-[16px] font-bold leading-[24px] text-white transition hover:bg-blue-700">검색</button>
      </form>
    </section>

    <BomLandingIntro />
  </div>

  <div v-else class="flex h-full min-h-0 bg-surface-sunken">
    <BomPartSearchWorkspace
      :initial-query="q"
      title="전자부품 단일 검색"
      :selected-part-ids="cartPartIds"
      :selected-selection-keys="cartSelectionKeys"
      :pending-key="pendingAddKey"
      :busy="removingItemId !== null"
      :action-error="actionError"
      @query-change="updateWorkspaceQuery"
      @add="(body, key) => addToCart(body, key)"
      @remove="(partId) => removePartFromCart(partId)"
    >
      <template #title-actions>
        <RouterLink :to="{ name: 'bom' }" class="flex h-[32px] items-center gap-[4px] rounded-[6px] border border-brand-soft bg-search-row px-[10px] font-noto text-[14px] font-bold leading-[24px] text-brand-soft hover:bg-surface-brand-soft"><span class="text-[18px] font-normal leading-none">+</span> BOM</RouterLink>
      </template>
    </BomPartSearchWorkspace>

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
