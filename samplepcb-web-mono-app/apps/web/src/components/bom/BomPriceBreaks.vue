<script setup lang="ts">
import { computed, ref } from 'vue';
import { fmtAge } from '../../bom/format';

// 가격구간 셀 — Figma 87:13361. 4행 창(적용 구간이 뒤쪽이어도 파란 강조가 접힌 목록에서
// 사라지지 않게 슬라이딩) + 적용 구간 강조 + 상세 확장 + 데이터 나이.
// BomQuoteRow(견적 행)와 단일 검색 행이 공유한다 — 시각 일관성의 단일 소스.

const props = withDefaults(defineProps<{
  priceBreaks: { qty: number; price: number }[];
  /** 적용(강조) 구간 qty — null 이면 강조 없음. */
  activeQty: number | null;
  currency: string;
  fetchedAt?: string | null;
  locked?: boolean;
  lockedTitle?: string;
}>(), {
  fetchedAt: null,
  locked: false,
  lockedTitle: '',
});

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
    <div class="flex flex-col gap-[4px]">
      <div
        v-for="priceBreak in visible"
        :key="priceBreak.qty"
        class="flex min-h-[14px] items-baseline justify-between gap-3 text-[12px] leading-[14px]"
        :class="priceBreak.qty === activeQty ? 'font-bold text-[#1e64fd]' : 'font-semibold text-[#5f6777]'"
      >
        <span class="w-[32px] shrink-0 text-right tabular-nums">{{ priceBreak.qty.toLocaleString('ko-KR') }}+</span>
        <span class="min-w-0 text-right tabular-nums">
          {{ prefix }}{{ fmtBreakNumber(priceBreak.price) }}<span class="font-normal">{{ suffix }}</span>
        </span>
      </div>
    </div>
    <div v-if="hasMore" class="mt-[6px] border-t border-[#d7dce4] pt-[4px] text-center">
      <button
        type="button"
        class="inline-flex h-[14px] items-center gap-1 text-[12px] font-semibold leading-[14px] text-[#1e64fd] hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="locked"
        :title="locked ? lockedTitle : `전체 ${String(sorted.length)}개 가격구간 ${expanded ? '접기' : '보기'}`"
        @click="toggle"
      >
        가격 상세 <span class="text-[10px]">{{ expanded ? '▴' : '▾' }}</span>
      </button>
    </div>
    <p v-if="fetchedAt !== null" class="mt-[3px] text-center text-[9px] leading-[11px] text-gray-400" title="이 가격·재고를 공급사에서 가져온 시각">기준 {{ fmtAge(fetchedAt) }}</p>
  </div>
</template>
