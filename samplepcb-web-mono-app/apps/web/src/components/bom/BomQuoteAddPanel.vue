<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { BomQuoteItemType } from '@sp/api-contract';
import { SUPPLIER_META } from '../../bom/supplier-meta';
import PartImage from '../ui/PartImage.vue';

const props = defineProps<{
  items: BomQuoteItemType[];
  pendingItemId: string | null;
  removingItemId: string | null;
  actionError: string | null;
}>();

const emit = defineEmits<{
  quantity: [item: BomQuoteItemType, quantity: number];
  remove: [item: BomQuoteItemType];
  complete: [];
}>();

const quantities = ref<Record<string, number>>({});
const actionErrorElement = ref<HTMLElement | null>(null);
function syncQuantities(): void {
  quantities.value = Object.fromEntries(props.items.map((item) => [item.id, item.bomQty]));
}

watch(
  () => props.items.map((item) => `${item.id}:${String(item.bomQty)}`).join(','),
  syncQuantities,
  { immediate: true },
);
watch(
  () => props.actionError,
  async (value) => {
    if (value === null) return;
    syncQuantities();
    await nextTick();
    actionErrorElement.value?.focus();
  },
);

const pricedTotal = computed(() => props.items.reduce(
  (sum, item) => sum + (item.lineTotalKrw ?? 0),
  0,
));
const inquiryCount = computed(() => props.items.filter((item) => item.selectedOffer === null).length);

function supplierName(item: BomQuoteItemType): string {
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
  if (commit && next !== item.bomQty) emit('quantity', item, next);
}

function money(value: number | null): string {
  return value === null ? '문의 견적' : `${Math.round(value).toLocaleString('ko-KR')}원`;
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col border-l border-line bg-search-cart font-noto xl:min-h-[520px] xl:w-[300px] xl:min-w-[300px]">
    <div class="border-b border-line px-[16px] pb-[12px] pt-[15px]">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="text-[14px] font-bold leading-[20px] text-ink-strong">현재 BOM에 추가</h2>
          <p class="mt-[2px] text-[11px] leading-[16px] text-ink-subtle">직접 추가 부품 {{ items.length.toLocaleString('ko-KR') }}개</p>
        </div>
        <span class="grid min-w-[24px] place-items-center rounded-full bg-brand px-[6px] py-[2px] text-[11px] font-bold text-white">{{ items.length }}</span>
      </div>
    </div>

    <p v-if="actionError !== null" ref="actionErrorElement" class="mx-[16px] mt-[10px] rounded-[6px] border border-red-200 bg-red-50 px-[10px] py-[7px] text-[11px] leading-[16px] text-red-700 outline-none focus:ring-2 focus:ring-red-300" role="alert" tabindex="-1">{{ actionError }}</p>

    <div class="min-h-0 flex-1 overflow-y-auto px-[16px] py-[10px]">
      <div v-if="items.length === 0" class="rounded-[8px] border border-dashed border-line-strong bg-search-row px-3 py-10 text-center text-[11px] leading-[18px] text-ink-subtle">
        검색 결과에서 구매 조건과 BOM 수량을 확인한 뒤 추가해 주세요.
      </div>
      <article v-for="item in items" v-else :key="item.id" class="border-b border-line-soft py-[12px] last:border-b-0">
        <div class="flex items-start gap-[9px]">
          <PartImage :src="item.partImageUrl" class="size-[38px] shrink-0 rounded-[6px] bg-surface-neutral" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[12px] font-bold leading-[16px] text-ink-strong" :title="item.mpn">{{ item.mpn }}</p>
            <p class="mt-[1px] truncate text-[10px] leading-[14px] text-ink-subtle">{{ supplierName(item) }}<span v-if="item.selectedOffer?.packaging"> · {{ item.selectedOffer.packaging }}</span></p>
          </div>
          <button
            type="button"
            class="grid size-[24px] shrink-0 place-items-center rounded-[4px] text-[17px] leading-none text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-40"
            :disabled="removingItemId !== null || pendingItemId !== null"
            aria-label="추가 부품 제거"
            @click="emit('remove', item)"
          >
            ×
          </button>
        </div>
        <div class="mt-[9px] flex items-center justify-between gap-2">
          <div class="flex h-[26px] w-[86px] items-center overflow-hidden rounded-[5px] border border-line-strong bg-search-input">
            <button type="button" class="w-[22px] shrink-0 text-[12px] text-ink-muted hover:bg-surface-raised disabled:opacity-40" :disabled="pendingItemId !== null || removingItemId !== null" aria-label="BOM 수량 감소" @click="setQuantity(item, quantity(item) - 1, true)">−</button>
            <input :value="quantity(item)" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" class="h-full min-w-0 flex-1 border-x border-line-soft bg-transparent text-center font-sans text-[11px] font-medium tabular-nums text-ink outline-none" aria-label="BOM 수량" :disabled="pendingItemId !== null || removingItemId !== null" @input="setQuantity(item, ($event.target as HTMLInputElement).value, false)" @change="setQuantity(item, ($event.target as HTMLInputElement).value, true)">
            <button type="button" class="w-[22px] shrink-0 text-[12px] text-ink-muted hover:bg-surface-raised disabled:opacity-40" :disabled="pendingItemId !== null || removingItemId !== null" aria-label="BOM 수량 증가" @click="setQuantity(item, quantity(item) + 1, true)">+</button>
          </div>
          <strong class="text-right text-[12px] font-bold tabular-nums" :class="item.lineTotalKrw === null ? 'text-brand-soft' : 'text-ink-strong'">{{ money(item.lineTotalKrw) }}</strong>
        </div>
      </article>
    </div>

    <div class="border-t border-line px-[16px] pb-[16px] pt-[12px]">
      <div class="flex items-center justify-between text-[11px] text-ink-subtle">
        <span>가격 확인 합계</span>
        <strong class="text-[14px] font-bold tabular-nums text-ink-strong">{{ Math.round(pricedTotal).toLocaleString('ko-KR') }}원</strong>
      </div>
      <p v-if="inquiryCount > 0" class="mt-[4px] text-[10px] leading-[15px] text-brand-soft">문의 견적 {{ inquiryCount }}개는 확정 합계에서 제외됩니다.</p>
      <button type="button" class="mt-[12px] flex h-[40px] w-full items-center justify-center rounded-[8px] bg-brand px-[16px] font-sans text-[14px] font-bold text-white transition hover:bg-brand-strong disabled:cursor-wait disabled:bg-action-quiet disabled:text-ink-faint" :disabled="pendingItemId !== null || removingItemId !== null" @click="emit('complete')">
        추가 완료 · BOM으로 돌아가기
      </button>
    </div>
  </aside>
</template>
