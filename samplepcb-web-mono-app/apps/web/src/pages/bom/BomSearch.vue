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
import cardIllust from '../../assets/bom/bom-card-illust-search.png';

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
  <div v-if="q === ''" class="relative flex h-full flex-col items-center overflow-y-auto px-4 pb-[60px] font-noto sm:px-6">
    <RouterLink :to="{ name: 'bom' }" class="absolute right-[26px] top-[16px] z-20 hidden h-[36px] items-center justify-center gap-1 rounded-[6px] bg-brand-strong px-[20px] text-[13px] font-medium text-white transition hover:bg-blue-700 sm:flex">
      <span class="text-[15px] leading-none">+</span> BOM
    </RouterLink>

    <BomLandingToggle active="search" />

    <!-- search card (2595:10378) — 카드 프레임·글로우·텍스트는 BomLandingCard, 탭별
         일러스트는 슬롯으로 겹친다. BOM 분석 탭과 텍스트 위치를 공유하고 검색 폼만 다르다. -->
    <!-- mt 는 BOM 분석 탭과 동일한 50px 고정 — 탭 전환 때 카드·타이틀 위치가 흔들리면 안 된다. -->
    <section class="relative mt-[50px] h-[524px] w-full max-w-[640px] shrink-0 overflow-hidden rounded-[8px] border border-[#d1e9f9] shadow-[0px_10px_30px_0px_var(--color-bom-landing-card-shadow)]" aria-label="부품 단일 검색">
      <BomLandingCard subtitle="Enter the MPN or part name, and you can start right away">
        <!-- 부품 카드 일러스트(2595:10414 — 1024x683 원본을 시안 프레임에 비율 무시
             스트레치, Figma fill 과 동일) -->
        <img :src="cardIllust" alt="" class="pointer-events-none absolute left-1/2 top-[286px] h-[214px] w-[595px] max-w-none -translate-x-1/2">
      </BomLandingCard>
      <form class="absolute left-[16px] right-[16px] top-[165px] z-10 flex h-[48px] sm:left-1/2 sm:right-auto sm:w-[426px] sm:-translate-x-1/2" role="search" @submit.prevent="submitLanding">
        <label class="flex min-w-0 flex-1 items-center gap-[8px] rounded-l-[8px] bg-[#fdfdff] pl-[12px] pr-[10px] sm:w-[340px] sm:pl-[20px] sm:pr-[16px]">
          <img :src="searchIcon" alt="" class="size-[20px] shrink-0">
          <input v-model="landingInput" type="search" aria-label="부품 검색어" placeholder="예: GRM155R71C104KA88, 100nF..." class="min-w-0 flex-1 bg-transparent text-[14px] font-normal leading-[24px] text-[#061023] outline-none placeholder:text-[#5b6a7e]">
        </label>
        <button type="submit" class="flex h-[48px] w-[72px] shrink-0 items-center justify-center rounded-r-[8px] bg-[#1e64fd] text-[15px] font-bold leading-[24px] text-white transition hover:bg-blue-700 sm:w-[86px] sm:text-[16px]">Search</button>
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
      @add-partner="(body, key) => addToCart(body, key)"
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
