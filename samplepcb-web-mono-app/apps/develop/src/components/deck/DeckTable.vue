<script setup lang="ts">
import { computed } from 'vue';
import type { DeckCol, DeckRow } from '../../lib/deck-content';

// 의뢰 출력물의 표 — 파란 머리줄 + 줄무늬 행. `table` 이 아니라 행마다 독립된 격자다:
// 행을 하나씩 재어(measure) 장 · 단에 나눠 실어야 하고, 나눈 조각마다 머리줄을 다시 붙이기 때문이다.
// dense = 한 단 폭에 싣는 촘촘한 판. 머리줄 높이는 lib/deck-layout DECK_TABLE_HEAD 와 같아야 한다(46 · 38).
// scroll = 좁은 화면의 세로 흐름에서 열이 많은 표 — 표 폭을 지키고(minWidth) 가로로 민다.
const props = defineProps<{
  cols: DeckCol[];
  rows: DeckRow[];
  dense?: boolean;
  measure?: string; // 높이 재는 자리에서만 — 행마다 data-measure 를 단다
  scroll?: boolean;
}>();

const template = computed(() => ({ gridTemplateColumns: props.cols.map((c) => c.width).join(' ') }));
const pad = computed(() => (props.dense ? 'px-[12px] py-[7px]' : 'px-[16px] py-[10px]'));
const pct = (n: number | undefined, total: number | undefined): string => `${String(((n ?? 0) / Math.max(1, total ?? 1)) * 100)}%`;
</script>

<template>
  <div :class="scroll ? 'overflow-x-auto' : undefined">
    <div class="border border-line" :class="[dense ? 'text-[15px]' : 'text-[17px]', scroll ? 'min-w-[1040px]' : '']">
      <div class="grid bg-brand-600 font-bold text-white" :class="dense ? 'h-[38px]' : 'h-[46px]'" :style="template">
        <span
          v-for="c in cols"
          :key="c.key"
          class="flex min-w-0 items-center truncate"
          :class="[dense ? 'px-[12px]' : 'px-[16px]', c.align === 'right' ? 'justify-end' : '']"
        >{{ c.label }}</span>
      </div>
      <div
        v-for="(row, ri) in rows"
        :key="row.key"
        class="grid border-t border-line leading-[1.5]"
        :class="ri % 2 === 1 ? 'bg-brand-50' : 'bg-white'"
        :style="template"
        :data-measure="measure"
      >
        <div
          v-for="(c, ci) in cols"
          :key="c.key"
          class="min-w-0 [overflow-wrap:anywhere]"
          :class="[
            pad,
            ci > 0 && c.kind !== 'range' && cols[ci - 1]?.kind !== 'index' ? 'border-l border-line' : '',
            c.align === 'right' ? 'text-right' : '',
            c.nowrap === true ? 'whitespace-nowrap' : '',
            c.pre === true ? 'whitespace-pre-line' : '',
            c.kind === 'index' ? '!pr-0' : '',
            ci === 0 || c.strong === true || row.strong?.includes(c.key) === true ? 'font-semibold' : '',
            row.muted?.includes(c.key) === true ? 'text-tx-3' : '',
          ]"
        >
          <!-- 일정 막대 — 옅은 띠가 최대, 진한 띠가 최소 기간 -->
          <span v-if="c.kind === 'range'" class="relative mt-[5px] block h-[14px] rounded-full bg-line/70">
            <span
              class="absolute inset-y-0 rounded-full bg-brand-200"
              :style="{ left: pct(row.data?.start, row.data?.total), width: pct(row.data?.max, row.data?.total) }"
            />
            <span
              class="absolute inset-y-0 rounded-full bg-brand-600"
              :style="{ left: pct(row.data?.start, row.data?.total), width: pct(row.data?.min, row.data?.total) }"
            />
          </span>
          <!-- 진행률 — 막대 + 숫자 -->
          <span v-else-if="c.kind === 'progress'" class="flex items-center justify-end gap-[10px]">
            <span class="h-[8px] w-[72px] overflow-hidden rounded-full bg-line">
              <span class="block h-full rounded-full bg-brand-600" :style="{ width: pct(row.data?.pct, 100) }" />
            </span>
            <span class="w-[44px] shrink-0 tabular-nums">{{ row.cells[c.key] }}</span>
          </span>
          <span v-else :class="c.kind === 'index' ? 'font-bold tabular-nums text-brand-600' : ''">{{ row.cells[c.key] }}</span>
          <p v-if="row.sub?.[c.key] !== undefined" class="text-[13px] font-normal leading-[1.45] text-tx-3">{{ row.sub[c.key] }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
