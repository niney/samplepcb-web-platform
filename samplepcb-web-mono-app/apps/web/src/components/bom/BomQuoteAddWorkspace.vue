<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type {
  BomPartHitType,
  BomPartOfferOptionType,
  BomQuoteItemType,
  BomSearchCartAddBodyType,
} from '@sp/api-contract';
import { bomQuoteItemSelectionKey } from '../../bom/search-selection';
import BomPartSearchWorkspace from './BomPartSearchWorkspace.vue';
import BomQuoteAddPanel from './BomQuoteAddPanel.vue';

const props = defineProps<{
  quoteTitle: string;
  items: BomQuoteItemType[];
  setQty: number;
  spareQty: number;
  pendingKey: string | null;
  pendingItemId: string | null;
  removingItemId: string | null;
  actionError: string | null;
}>();

const emit = defineEmits<{
  add: [
    body: BomSearchCartAddBodyType,
    key: string,
    part: BomPartHitType,
    offer: BomPartOfferOptionType,
  ];
  removeSelection: [partId: string, key: string];
  removeItem: [item: BomQuoteItemType];
  quantity: [item: BomQuoteItemType, quantity: number];
  close: [];
}>();

const mobilePanelOpen = ref(false);
const manualItems = computed(() => props.items.filter((item) =>
  item.manualEntry === true
  && item.selectionSource === 'catalog'
  && item.partId !== null
  && (item.selectedOffer !== null || item.catalogInquiry)));
const selectedPartIds = computed(() => new Set(
  manualItems.value.flatMap((item) => item.partId === null ? [] : [item.partId]),
));
const selectedSelectionKeys = computed(() => new Set(
  manualItems.value.flatMap((item) => {
    const key = bomQuoteItemSelectionKey(item);
    return key === null ? [] : [key];
  }),
));
const quantityMultiplier = computed(() => Math.max(1, props.setQty + props.spareQty));
const busy = computed(() => props.pendingKey !== null
  || props.pendingItemId !== null
  || props.removingItemId !== null);

function close(): void {
  if (busy.value) return;
  mobilePanelOpen.value = false;
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  close();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] flex min-h-0 bg-surface-sunken" role="dialog" aria-modal="true" aria-label="BOM에 부품 추가">
      <BomPartSearchWorkspace
        title="BOM에 부품 추가"
        empty-prompt="추가할 부품의 MPN, 규격 또는 패키지를 검색해 주세요. 여러 부품을 연속으로 추가할 수 있습니다."
        :supplement-needed="quantityMultiplier"
        :quantity-multiplier="quantityMultiplier"
        :selected-part-ids="selectedPartIds"
        :selected-selection-keys="selectedSelectionKeys"
        :pending-key="pendingKey"
        :busy="busy"
        :action-error="actionError"
        action-context="quote"
        @add="(body, key, part, offer) => emit('add', body, key, part, offer)"
        @remove="(partId, key) => emit('removeSelection', partId, key)"
      >
        <template #title-actions>
          <span class="hidden h-[32px] max-w-[260px] items-center truncate rounded-[6px] border border-line-strong bg-search-row px-[10px] text-[11px] font-medium text-ink-muted md:flex" :title="quoteTitle">{{ quoteTitle }}</span>
          <button type="button" class="flex h-[32px] items-center gap-[5px] rounded-[6px] border border-line-strong bg-search-row px-[10px] text-[12px] font-bold text-ink-neutral hover:border-brand-soft hover:text-brand-soft disabled:cursor-wait disabled:opacity-50" :disabled="busy" @click="close">← BOM으로</button>
        </template>
      </BomPartSearchWorkspace>

      <BomQuoteAddPanel
        class="hidden xl:flex"
        :items="manualItems"
        :pending-item-id="pendingItemId"
        :removing-item-id="removingItemId"
        @quantity="(item, quantity) => emit('quantity', item, quantity)"
        @remove="(item) => emit('removeItem', item)"
        @complete="close"
      />

      <button
        type="button"
        class="fixed bottom-[18px] right-[18px] z-[95] flex h-[44px] items-center gap-[7px] rounded-full bg-action-primary px-[16px] font-noto text-[12px] font-bold text-white shadow-lg transition hover:bg-action-primary-hover xl:hidden"
        aria-label="추가 부품 목록 열기"
        @click="mobilePanelOpen = true"
      >
        추가 부품
        <span class="grid min-w-[20px] place-items-center rounded-full bg-white/20 px-[5px] py-[1px] text-[11px] tabular-nums">{{ manualItems.length }}</span>
      </button>

      <div v-if="mobilePanelOpen" class="fixed inset-0 z-[100] xl:hidden">
        <button type="button" class="absolute inset-0 size-full bg-black/45" aria-label="추가 부품 목록 닫기" @click="mobilePanelOpen = false" />
        <div class="absolute inset-x-0 bottom-0 h-[82dvh] min-h-0 overflow-hidden rounded-t-[14px] border-t border-line bg-search-cart shadow-2xl">
          <button type="button" class="absolute right-[8px] top-[8px] z-10 grid size-[30px] place-items-center rounded-full text-[20px] leading-none text-ink-muted hover:bg-surface-raised" aria-label="추가 부품 목록 닫기" @click="mobilePanelOpen = false">×</button>
          <BomQuoteAddPanel
            :items="manualItems"
            :pending-item-id="pendingItemId"
            :removing-item-id="removingItemId"
            @quantity="(item, quantity) => emit('quantity', item, quantity)"
            @remove="(item) => emit('removeItem', item)"
            @complete="close"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
