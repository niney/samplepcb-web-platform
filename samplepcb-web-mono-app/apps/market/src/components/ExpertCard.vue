<script setup lang="ts">
import { computed } from 'vue';
import {
  MARKET_CAD_TOOL_LABELS,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_REGION_LABELS,
} from '@sp/api-contract';
import type { MarketExpertPublicType } from '@sp/api-contract';
import { avatarHue } from '../lib/market-format';

const props = defineProps<{ item: MarketExpertPublicType }>();

// 지정 1번(당사)·2번(파트너사)·3번(프리랜서) 배지 — 프로토타입 designation 이식.
const typeBadge = computed(() =>
  props.item.expertType === 'house'
    ? { label: '지정 1번 · 당사진행', cls: 'bg-copper-500 text-white' }
    : props.item.expertType === 'company'
      ? { label: '지정 2번 · 파트너사', cls: 'bg-ink-900 text-white' }
      : { label: '지정 3번 · 프리랜서', cls: 'bg-line text-tx-2' },
);
const hue = computed(() => avatarHue(props.item.displayName));
const visibleCategories = computed(() => props.item.categories.slice(0, 3));
</script>

<template>
  <RouterLink
    :to="`/experts/${String(item.expertId)}`"
    class="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-copper-400 hover:shadow-lg"
  >
    <div class="flex items-center gap-3">
      <span
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white"
        :style="{ backgroundColor: `hsl(${String(hue)} 45% 38%)` }"
      >
        {{ item.displayName.slice(0, 1) }}
      </span>
      <div class="min-w-0">
        <p class="truncate text-[15px] font-bold text-tx-1 group-hover:text-copper-600">
          {{ item.displayName }}
        </p>
        <p class="text-xs text-tx-3">
          경력 {{ MARKET_CAREER_RANGE_LABELS[item.careerRange] }}
          <template v-if="item.region !== null"> · {{ MARKET_REGION_LABELS[item.region] }}</template>
        </p>
      </div>
    </div>

    <span class="mt-3 self-start rounded-md px-2 py-0.5 text-[11px] font-bold" :class="typeBadge.cls">
      {{ typeBadge.label }}
    </span>

    <div class="mt-3 flex flex-wrap gap-1.5 text-xs">
      <span
        v-for="c in visibleCategories"
        :key="c"
        class="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700"
      >
        {{ MARKET_CATEGORY_LABELS[c] }}
      </span>
      <span v-if="item.categories.length > 3" class="rounded-full bg-line px-2 py-0.5 text-tx-3">
        +{{ item.categories.length - 3 }}
      </span>
    </div>

    <p v-if="item.cadTools.length > 0" class="mt-2 line-clamp-1 font-mono text-[11px] text-tx-3">
      {{ item.cadTools.map((c) => MARKET_CAD_TOOL_LABELS[c]).join(' · ') }}
    </p>

    <p v-if="item.intro !== null" class="mt-3 line-clamp-2 border-t border-line pt-3 text-xs leading-relaxed text-tx-2">
      {{ item.intro }}
    </p>
  </RouterLink>
</template>
