<script setup lang="ts">
import { computed } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { BomQuoteItemType } from '@sp/api-contract';
import { neededQty } from '@sp/utils';
import QuoteRow from '../QuoteRow.vue';

// 작업대 결과 표의 <tbody> — 가상 스크롤(보이는 행 + overscan 만 DOM)과 위아래 스페이서 행.
// 옛 화면은 이 상태를 페이지가 직접 읽었다. 리뉴얼 페이지는 머리·우측 패널이 키트 컴포넌트라, 스크롤 프레임마다
// 페이지 전체가 다시 그려지면 그 컴포넌트들(v-for 칸·선택 목록 등)도 같이 다시 그려진다. 그래서 스크롤마다
// 바뀌는 가상 행 상태는 이 컴포넌트만 읽게 떼어 뒀다(실측·근거 workbench/row-classes.ts).
// 행 격리는 그대로다 — 각 행은 QuoteRow 이고 item 참조가 같으면 patch 를 건너뛴다.

const props = defineProps<{
  items: BomQuoteItemType[];
  scrollElement: HTMLElement | null;
  setQty: number;
  spareQty: number;
  isDraft: boolean;
  editingLocked: boolean;
  enriching: boolean;
  emptyText: string;
}>();

const emit = defineEmits<{
  'toggle-include': [item: BomQuoteItemType];
  'qty-change': [item: BomQuoteItemType, qty: number];
  'confirm-quantity': [item: BomQuoteItemType, qty: number];
  'open-offers': [item: BomQuoteItemType];
  'open-candidates': [item: BomQuoteItemType];
  'open-search': [item: BomQuoteItemType];
}>();

// 행 높이는 가격구간 확장·수량 확인 버튼·상태 배지 수에 따라 달라서 고정값을 쓸 수 없고,
// estimateSize 는 첫 배치용 추정치일 뿐 실제 높이는 measureRow 가 ResizeObserver 로 잰다.
const ROW_ESTIMATED_HEIGHT = 128;

const rowVirtualizer = useVirtualizer(computed(() => {
  // 스크롤 요소를 여기서 꺼내 둬야 이 computed 의 의존성으로 등록된다. getScrollElement 안에서만
  // 읽으면 null → 요소로 바뀌어도 옵션이 갱신되지 않아 스크롤에 반응하지 않는다.
  const scrollElement = props.scrollElement;
  const items = props.items;
  return {
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATED_HEIGHT,
    overscan: 6,
    getItemKey: (index: number) => items[index]?.id ?? index,
  };
}));

// 가상 행과 실제 항목을 짝지어 둔다 — 목록이 줄어드는 순간의 인덱스 불일치를 여기서 흡수한다.
const virtualRowItems = computed(() => rowVirtualizer.value.getVirtualItems().flatMap((row) => {
  const item = props.items[row.index];
  return item === undefined ? [] : [{ row, item }];
}));

// 위아래 여백은 스페이서 행으로 채운다 — table-fixed 라 열 폭은 렌더된 행 수와 무관하다.
const virtualPaddingTop = computed(() => virtualRowItems.value[0]?.row.start ?? 0);
const virtualPaddingBottom = computed(() => {
  const last = virtualRowItems.value.at(-1);
  return last === undefined ? 0 : rowVirtualizer.value.getTotalSize() - last.row.end;
});

function measureRow(el: unknown): void {
  const dom = el !== null && typeof el === 'object' && '$el' in el ? el.$el : el;
  if (dom instanceof HTMLElement) rowVirtualizer.value.measureElement(dom);
}
</script>

<template>
  <tbody>
    <tr v-if="virtualPaddingTop > 0" aria-hidden="true">
      <td colspan="8" class="h-(--pad)" :style="{ '--pad': `${String(virtualPaddingTop)}px` }" />
    </tr>
    <QuoteRow
      v-for="entry in virtualRowItems"
      :key="entry.item.id"
      :ref="measureRow"
      :data-index="entry.row.index"
      :item="entry.item"
      :needed="neededQty(entry.item.bomQty, setQty, spareQty)"
      :is-draft="isDraft"
      :editing-locked="editingLocked"
      :enriching="enriching"
      @toggle-include="emit('toggle-include', entry.item)"
      @qty-change="emit('qty-change', entry.item, $event)"
      @confirm-quantity="emit('confirm-quantity', entry.item, $event)"
      @open-offers="emit('open-offers', entry.item)"
      @open-candidates="emit('open-candidates', entry.item)"
      @open-search="emit('open-search', entry.item)"
    />
    <tr v-if="virtualPaddingBottom > 0" aria-hidden="true">
      <td colspan="8" class="h-(--pad)" :style="{ '--pad': `${String(virtualPaddingBottom)}px` }" />
    </tr>
    <tr v-if="items.length === 0">
      <td colspan="8" class="text-muted-foreground px-3 py-10 text-center text-sm">{{ emptyText }}</td>
    </tr>
  </tbody>
</template>
