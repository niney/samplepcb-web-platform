<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { fmtAge } from '@/bom/format';
import { ROW_LINK_BUTTON } from './workbench/row-classes';

// 가격구간 셀 — 옛 components/admin/bom/BomPriceBreaks.vue 의 짝(같은 props). 4행 창(적용 구간이 뒤쪽이어도
// 강조가 접힌 목록에서 사라지지 않게 슬라이딩) + 적용 구간 강조 + 상세 확장 + 데이터 나이.
// 작업대 행(QuoteRow)과 단일 검색 행이 공유한다 — 시각 일관성의 단일 소스.
// 가상 스크롤 행 안에 매번 마운트되므로 펼침 버튼은 Button 컴포넌트 대신 같은 클래스의 네이티브 버튼이다(workbench/row-classes.ts).

const props = withDefaults(
  defineProps<{
    priceBreaks: { qty: number; price: number }[];
    /** 적용(강조) 구간 qty — null 이면 강조 없음. */
    activeQty: number | null;
    currency: string;
    fetchedAt?: string | null;
    locked?: boolean;
    lockedTitle?: string;
  }>(),
  {
    fetchedAt: null,
    locked: false,
    lockedTitle: '',
  },
);

const expanded = ref(false);
const sorted = computed(() => [...props.priceBreaks].sort((a, b) => a.qty - b.qty));
const hasMore = computed(() => sorted.value.length > 4);

const visible = computed(() => {
  const rows = sorted.value;
  if (expanded.value || rows.length <= 4) return rows;
  const activeIndex = rows.findIndex((row) => row.qty === props.activeQty);
  if (activeIndex < 4) return rows.slice(0, 4);
  const start = Math.min(Math.max(activeIndex - 1, 0), rows.length - 4);
  return rows.slice(start, start + 4);
});

const prefix = computed(() => (props.currency === 'KRW' ? '' : props.currency === 'USD' ? '$' : `${props.currency} `));
const suffix = computed(() => (props.currency === 'KRW' ? '원' : ''));

function fmtBreakNumber(price: number): string {
  return price.toLocaleString('ko-KR', { maximumFractionDigits: props.currency === 'KRW' ? 2 : 4 });
}

function toggle(): void {
  if (!hasMore.value) return;
  expanded.value = !expanded.value;
}
</script>

<template>
  <div>
    <div class="flex flex-col gap-1">
      <div
        v-for="priceBreak in visible"
        :key="priceBreak.qty"
        class="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap tabular-nums"
        :class="priceBreak.qty === activeQty ? 'text-primary font-bold' : 'text-muted-foreground font-medium'"
      >
        <span class="w-12 shrink-0 text-right">{{ priceBreak.qty.toLocaleString('ko-KR') }}+</span>
        <span class="shrink-0 text-right">
          {{ prefix }}{{ fmtBreakNumber(priceBreak.price) }}<span class="font-normal">{{ suffix }}</span>
        </span>
      </div>
    </div>
    <div v-if="hasMore" class="mt-1 flex justify-center border-t pt-1">
      <!-- ui-audit-allow: 가상 스크롤 행 성능 — buttonVariants(link·xs) 를 그대로 쓴 버튼(workbench/row-classes.ts 실측) -->
      <button
        type="button"
        :class="ROW_LINK_BUTTON"
        :disabled="locked"
        :title="locked ? lockedTitle : `전체 ${String(sorted.length)}개 가격구간 ${expanded ? '접기' : '보기'}`"
        @click="toggle"
      >
        가격 상세
        <ChevronUpIcon v-if="expanded" />
        <ChevronDownIcon v-else />
      </button>
    </div>
    <p
      v-if="fetchedAt !== null"
      class="text-muted-foreground mt-0.5 text-center text-xs"
      title="이 가격·재고를 공급사에서 가져온 시각"
    >
      기준 {{ fmtAge(fetchedAt) }}
    </p>
  </div>
</template>
