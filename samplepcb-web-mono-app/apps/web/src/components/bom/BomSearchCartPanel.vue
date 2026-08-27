<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { BomQuoteDetailType, BomQuoteItemType } from '@sp/api-contract';
import quoteTitleIcon from '../../assets/bom/ic-single-search-quote.svg';
import estimateTitleIcon from '../../assets/bom/ic-single-search-estimate.svg';
import quoteRequestIcon from '../../assets/bom/ic-single-search-request.svg';
import { SUPPLIER_META } from '../../bom/supplier-meta';

const props = defineProps<{
  cart: BomQuoteDetailType | null;
  loading: boolean;
  pendingItemId: string | null;
  removingItemId: string | null;
  requesting: boolean;
}>();

const emit = defineEmits<{
  quantity: [itemId: string, quantity: number];
  remove: [itemId: string];
  request: [];
}>();

type CartTab = 'all' | 'priced' | 'inquiry';
interface CartLinePrice {
  amount: string;
  priced: boolean;
}

const tab = ref<CartTab>('all');
const quantities = ref<Record<string, number>>({});
const cartMpnTooltipId = 'bom-search-cart-mpn-tooltip';
const cartMpnTooltipItem = ref<BomQuoteItemType | null>(null);
const cartMpnTooltipRef = ref<HTMLElement | null>(null);
const cartMpnTooltipPosition = ref({ left: 0, top: 0 });
const cartMpnTooltipStyle = computed(() => ({
  left: `${String(cartMpnTooltipPosition.value.left)}px`,
  top: `${String(cartMpnTooltipPosition.value.top)}px`,
}));

const items = computed(() => props.cart?.items ?? []);
const visibleItems = computed(() => items.value.filter((item) =>
  tab.value === 'all'
    || (tab.value === 'priced' && item.selectedOffer !== null)
    || (tab.value === 'inquiry' && item.selectedOffer === null)));

watch(
  () => items.value.map((item) => `${item.id}:${String(item.bomQty)}`).join(','),
  () => {
    quantities.value = Object.fromEntries(items.value.map((item) => [item.id, item.bomQty]));
  },
  { immediate: true },
);

function supplierName(item: BomQuoteItemType): string {
  // 협력사 보유로 담은 행은 우리 재고가 아니라 협력사 재고다 — SamplePCB 로 표기하면
  // 담당자가 어디에 물어야 할지 모른다(docs/PARTNER_PARTS.md).
  if (item.selectedOffer === null && item.selectionSource === 'partner') return '협력사 보유';
  const supplier = item.selectedOffer?.supplier ?? 'samplepcb';
  return SUPPLIER_META[supplier]?.name ?? supplier;
}

function quantity(item: BomQuoteItemType): number {
  return quantities.value[item.id] ?? item.bomQty;
}

function setQuantity(item: BomQuoteItemType, raw: number | string, commit: boolean): void {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  const next = Number.isFinite(parsed)
    ? Math.min(1_000_000, Math.max(1, Math.floor(parsed)))
    : item.bomQty;
  quantities.value[item.id] = next;
  if (commit && next !== item.bomQty) emit('quantity', item.id, next);
}

function wonAmount(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `₩${Math.round(value).toLocaleString('ko-KR')}원`;
}

function linePrice(item: BomQuoteItemType): CartLinePrice {
  if (item.lineTotalKrw !== null) {
    return { amount: wonAmount(item.lineTotalKrw), priced: true };
  }
  const offer = item.selectedOffer;
  if (offer === null) {
    return item.selectionSource === 'partner'
      ? { amount: '견적요청 후 확정', priced: false }
      : { amount: '재고 확인 필요', priced: false };
  }
  if (offer.currency === 'KRW') {
    return { amount: `₩${offer.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}원`, priced: true };
  }
  const prefix = offer.currency === 'USD' ? '$' : `${offer.currency} `;
  return {
    amount: `${prefix}${offer.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`,
    priced: true,
  };
}

function tabClass(target: CartTab): string {
  return tab.value === target
    ? 'border border-brand-soft bg-surface-brand-soft font-bold text-brand-soft'
    : 'border border-transparent bg-surface-raised font-normal text-ink-muted';
}

function showCartMpnTooltip(item: BomQuoteItemType, event: MouseEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement) || target.scrollWidth <= target.clientWidth) return;

  const viewportPadding = 8;
  const gap = 6;
  const targetRect = target.getBoundingClientRect();
  const cartRect = target.closest('aside')?.getBoundingClientRect();
  const preferredLeft = cartRect === undefined ? targetRect.left : cartRect.left + viewportPadding;

  cartMpnTooltipItem.value = item;
  cartMpnTooltipPosition.value = { left: Math.max(viewportPadding, preferredLeft), top: targetRect.bottom + gap };

  void nextTick(() => {
    if (cartMpnTooltipItem.value?.id !== item.id) return;
    const tooltip = cartMpnTooltipRef.value;
    if (tooltip === null) return;

    const tooltipRect = tooltip.getBoundingClientRect();
    const maxLeft = Math.max(viewportPadding, window.innerWidth - tooltipRect.width - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, preferredLeft), maxLeft);
    const tooltipHeight = tooltipRect.height;
    const spaceBelow = window.innerHeight - targetRect.bottom - gap;
    const top = spaceBelow < tooltipHeight && targetRect.top > spaceBelow
      ? Math.max(viewportPadding, targetRect.top - tooltipHeight - gap)
      : Math.min(targetRect.bottom + gap, Math.max(viewportPadding, window.innerHeight - tooltipHeight - viewportPadding));
    cartMpnTooltipPosition.value = { left, top };
  });
}

function hideCartMpnTooltip(itemId: string): void {
  if (cartMpnTooltipItem.value?.id === itemId) cartMpnTooltipItem.value = null;
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col border-l border-line bg-search-cart font-noto xl:min-h-[520px] xl:w-[286px] xl:min-w-[286px]">
    <div class="shrink-0 border-b border-line px-[16px] pb-[8px] pt-[20px]">
      <h2 class="flex h-[16px] items-center gap-[6px] text-[12px] font-bold leading-[14px] text-ink-strong">
        <img :src="quoteTitleIcon" alt="" class="size-[16px] shrink-0">
        부품 견적
      </h2>
      <div class="mt-[8px] flex h-[24px] items-center gap-[6px]">
        <span class="mr-auto text-[13px] font-medium leading-[16px] text-ink-neutral">
          Cart <strong class="font-bold text-brand-soft">({{ items.length }})</strong>
        </span>
        <button type="button" class="h-[24px] rounded-[4px] px-[10px] text-[11px] leading-[16px]" :class="tabClass('all')" @click="tab = 'all'">전체</button>
        <button type="button" class="h-[24px] rounded-[4px] px-[10px] text-[11px] leading-[16px]" :class="tabClass('priced')" @click="tab = 'priced'">견적 확인</button>
        <button type="button" class="h-[24px] rounded-[4px] px-[10px] text-[11px] leading-[16px]" :class="tabClass('inquiry')" @click="tab = 'inquiry'">견적 요청</button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-[16px]">
      <div v-if="loading" class="flex h-full min-h-[180px] items-center justify-center gap-2 text-[12px] text-ink-subtle">
        <span class="size-4 animate-spin rounded-full border-2 border-line border-t-brand" />
        바구니 확인 중
      </div>
      <div v-else-if="visibleItems.length === 0" class="flex h-full min-h-[180px] flex-col items-center justify-center px-4 text-center">
        <svg viewBox="0 0 24 24" class="size-[28px] text-ink-faint" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M4 5h2l1.4 9.1a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.7L20 8H7" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="10" cy="19" r="1" /><circle cx="17" cy="19" r="1" />
        </svg>
        <p class="mt-[8px] text-[12px] font-medium leading-[18px] text-ink-muted">검색 결과에서 부품을 담아<br>한 번에 견적을 요청하세요.</p>
      </div>

      <article v-for="item in visibleItems" :key="item.id" class="relative min-h-[71px] border-b border-line-soft py-[10px] last:border-b-0">
        <div class="min-w-0 pr-[92px]">
          <p
            class="truncate text-[14px] font-medium leading-[20px] text-ink-strong"
            :aria-describedby="cartMpnTooltipItem?.id === item.id ? cartMpnTooltipId : undefined"
            @mouseenter="showCartMpnTooltip(item, $event)"
            @mouseleave="hideCartMpnTooltip(item.id)"
          >
            {{ item.mpn }}
          </p>
          <p class="truncate text-[11px] font-normal leading-[16px] text-ink-subtle" :title="item.manufacturerName ?? ''">{{ item.manufacturerName ?? '—' }}</p>
        </div>

        <div class="absolute right-0 top-[10px] flex items-center gap-[4px]">
          <div class="flex h-[22px] w-[72px] items-center overflow-hidden rounded-[4px] border border-line-strong bg-search-input">
            <button type="button" class="w-[15px] shrink-0 text-[11px] text-ink-muted hover:bg-surface-raised disabled:opacity-40" :disabled="pendingItemId !== null" aria-label="수량 감소" @click="setQuantity(item, quantity(item) - 1, true)">−</button>
            <input :value="quantity(item)" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" class="h-full min-w-0 flex-1 border-x border-line-soft bg-transparent text-center font-sans text-[11px] font-medium tabular-nums text-ink outline-none" aria-label="품목 수량" :disabled="pendingItemId !== null" @input="setQuantity(item, ($event.target as HTMLInputElement).value, false)" @change="setQuantity(item, ($event.target as HTMLInputElement).value, true)">
            <button type="button" class="w-[15px] shrink-0 text-[11px] text-ink-muted hover:bg-surface-raised disabled:opacity-40" :disabled="pendingItemId !== null" aria-label="수량 증가" @click="setQuantity(item, quantity(item) + 1, true)">+</button>
          </div>
          <button type="button" class="grid size-[16px] shrink-0 place-items-center rounded text-[16px] leading-none text-ink-faint hover:bg-surface-raised hover:text-state-danger disabled:opacity-40" :disabled="removingItemId !== null" aria-label="품목 삭제" @click="emit('remove', item.id)">
            {{ removingItemId === item.id ? '·' : '×' }}
          </button>
        </div>

        <div class="mt-[4px] flex items-center justify-between gap-2 text-[11px] leading-[16px]">
          <span class="truncate font-medium" :class="item.selectedOffer === null ? 'text-ink-muted' : 'text-brand-strong'">{{ supplierName(item) }}</span>
          <span v-if="linePrice(item).priced" class="shrink-0 whitespace-nowrap font-noto leading-[16px] text-brand-soft">
            <strong class="text-[14px] font-bold leading-[16px] tabular-nums">{{ linePrice(item).amount }}</strong>
          </span>
          <strong v-else class="shrink-0 whitespace-nowrap font-noto text-[12px] font-normal leading-[16px] text-ink-muted">{{ linePrice(item).amount }}</strong>
        </div>
      </article>
    </div>

    <div class="shrink-0 border-t border-line bg-search-cart px-[16px] pb-[16px] pt-[10px]">
      <h3 class="flex h-[16px] items-center gap-[6px] font-noto text-[12px] font-bold leading-[14px] text-ink-strong">
        <img :src="estimateTitleIcon" alt="" class="size-[16px] shrink-0">
        예상 견적
      </h3>

      <dl class="mt-[10px] h-[129px] space-y-[14px] rounded-[8px] border border-search-estimate-border bg-search-estimate-bg px-[12px] py-[14px] text-[12px] leading-[14px]">
        <div class="flex items-baseline justify-between"><dt class="font-noto tracking-[-0.48px] text-search-estimate-label">단가</dt><dd class="font-sans text-[13px] font-bold leading-[14px] tabular-nums text-search-estimate-amount">{{ wonAmount(cart?.itemsTotal) }}</dd></div>
        <div class="flex items-baseline justify-between"><dt class="font-noto tracking-[-0.48px] text-search-estimate-label">합계</dt><dd class="font-sans text-[13px] font-bold leading-[14px] tabular-nums text-search-estimate-amount">{{ wonAmount(cart?.itemsTotal) }}</dd></div>
        <div class="flex items-baseline justify-between"><dt class="font-noto tracking-[-0.48px] text-search-estimate-label">운송료</dt><dd class="font-sans text-[13px] font-bold leading-[14px] tabular-nums text-search-estimate-amount">{{ wonAmount(cart?.shippingFee) }}</dd></div>
        <div class="flex items-baseline justify-between"><dt class="font-noto tracking-[-0.48px] text-search-estimate-label">관리비</dt><dd class="font-sans text-[13px] font-bold leading-[14px] tabular-nums text-search-estimate-amount">{{ wonAmount(cart?.managementFee) }}</dd></div>
      </dl>

      <div class="mt-[12px] h-[74px] rounded-[8px] border border-search-total-border bg-search-total-bg px-[12px] py-[10px]">
        <p class="font-noto text-[12px] font-medium leading-[14px] tracking-[-0.44px] text-search-total-label">최종합계 <span class="text-[10px] text-search-total-vat">(VAT 별도)</span></p>
        <p class="mt-[11px] text-right font-sans leading-[14px] text-brand-soft">
          <strong class="text-[19px] font-bold leading-[14px] tabular-nums">{{ wonAmount(cart?.finalTotal) }}</strong>
        </p>
      </div>

      <ul class="mt-[10px] list-disc pl-[15px] text-[10px] leading-[14px] text-ink-muted">
        <li>AI로 산출한 가견적입니다.</li>
        <li>정확한 가격은 견적문의 부탁드립니다.</li>
      </ul>
      <p v-if="(cart?.uncostedCount ?? 0) > 0" class="mt-[5px] text-[10px] leading-[14px] text-state-review">{{ cart?.uncostedCount }}개 품목은 담당자 확인 후 확정됩니다.</p>

      <button type="button" class="mt-[12px] flex h-[40px] w-full items-center justify-center gap-[4px] rounded-[8px] bg-brand px-[16px] font-sans text-[14px] font-bold text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-action-quiet disabled:text-ink-faint" :disabled="items.length === 0 || requesting || pendingItemId !== null || removingItemId !== null" @click="emit('request')">
        <img :src="quoteRequestIcon" alt="" class="size-[20px] shrink-0">
        {{ requesting ? '요청 중…' : '견적요청' }}
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="cartMpnTooltipItem !== null"
        :id="cartMpnTooltipId"
        ref="cartMpnTooltipRef"
        role="tooltip"
        class="pointer-events-none fixed z-[100] flex h-[40px] w-max items-center whitespace-nowrap rounded-[6px] border border-line-search-strong bg-search-head px-[8px] py-[4px] text-[12px] leading-[16px] text-ink shadow-[0px_2px_6px_0px_rgba(0,0,0,0.3)]"
        :style="cartMpnTooltipStyle"
      >
        {{ cartMpnTooltipItem.mpn }}
      </div>
    </Teleport>
  </aside>
</template>
