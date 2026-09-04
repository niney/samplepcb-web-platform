<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_AREAS, marketArea, sortMarketAreas } from '@sp/api-contract';
import type { MarketAreaDef } from '@sp/api-contract';

// 전문가 등록·프로필 공용 — 제공 분야(레지스트리 5종) + 선택 분야마다 다룰 수 있는 툴·언어.
// 분야별 툴 목록은 레지스트리에서 오므로 분야가 늘어도 이 컴포넌트는 안 바뀐다.
// tools 는 { [area]: string[] } — 빈 배열 = 무엇이든(제한 없음).
const props = defineProps<{
  serviceAreas: string[];
  tools: Record<string, string[]>;
}>();
const emit = defineEmits<{ toggleArea: [code: string]; toggleTool: [area: string, code: string] }>();

const areaDefs = computed<MarketAreaDef[]>(() =>
  sortMarketAreas(props.serviceAreas).map((c) => marketArea(c)).filter((d): d is MarketAreaDef => d !== undefined),
);
const has = (area: string, code: string): boolean => (props.tools[area] ?? []).includes(code);
</script>

<template>
  <div class="grid gap-4">
    <div>
      <p class="text-xs font-bold text-tx-2">
        제공 가능한 개발 분야 <span class="font-normal text-tx-3">(복수 선택)</span> <span class="text-red-500">*</span>
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="area in MARKET_AREAS"
          :key="area.code"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="serviceAreas.includes(area.code) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
          @click="emit('toggleArea', area.code)"
        >
          {{ area.label }}
        </button>
      </div>
      <p v-if="serviceAreas.length === 0" class="mt-2 text-xs text-red-500">개발 분야를 1개 이상 선택해 주세요.</p>
    </div>

    <div v-for="area in areaDefs" :key="area.code">
      <p class="text-xs font-bold text-tx-2">
        {{ area.label }} · {{ area.tools.label }}
        <span class="font-normal text-tx-3">(복수 선택 · 비우면 제한 없음)</span>
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="opt in area.tools.options"
          :key="opt.code"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="has(area.code, opt.code) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
          @click="emit('toggleTool', area.code, opt.code)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
  </div>
</template>
