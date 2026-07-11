<script setup lang="ts">
import { computed } from 'vue';
import {
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CAD_TOOL_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
} from '@sp/api-contract';
import type { MarketProjectListItemType } from '@sp/api-contract';
import { dateShort, ddayBadge, ddayToneClass } from '../lib/market-format';

const props = defineProps<{ item: MarketProjectListItemType }>();

const dday = computed(() => ddayBadge(props.item));
const categoryChipClass = computed(() =>
  props.item.requestType === 'system' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700',
);
</script>

<template>
  <RouterLink
    :to="`/projects/${String(item.projectId)}`"
    class="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-copper-400 hover:shadow-lg"
  >
    <div class="flex items-center gap-2">
      <span class="font-mono text-[11px] tracking-widest text-tx-3">
        PRJ-{{ String(item.projectId).padStart(4, '0') }}
      </span>
      <span class="ml-auto rounded-md px-2 py-0.5 text-xs font-bold" :class="ddayToneClass[dday.tone]">
        {{ dday.label }}
      </span>
    </div>

    <h3 class="mt-3 line-clamp-2 text-[15px] font-bold leading-snug text-tx-1 group-hover:text-copper-600">
      {{ item.title }}
    </h3>

    <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span class="rounded-full px-2 py-0.5 font-semibold" :class="categoryChipClass">
        {{ MARKET_REQUEST_TYPE_LABELS[item.requestType] }}
      </span>
      <span v-for="area in item.serviceAreas" :key="area" class="rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-teal-700">
        {{ MARKET_SERVICE_AREA_LABELS[area] }}
      </span>
      <span
        class="rounded-full px-2 py-0.5 font-semibold"
        :class="item.method === 'open' ? 'bg-copper-50 text-copper-600' : 'bg-ink-900 text-white'"
      >
        {{ MARKET_METHOD_LABELS[item.method] }}
      </span>
      <span v-if="item.ndaRequired" class="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
        NDA
      </span>
    </div>

    <p class="mt-2 line-clamp-1 text-xs text-tx-3">
      {{ item.cadTools.map((c) => MARKET_CAD_TOOL_LABELS[c]).join(' · ') }}
    </p>

    <div class="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-tx-2">
      <span class="font-semibold text-tx-1">{{ MARKET_BUDGET_RANGE_LABELS[item.budgetRange] }}</span>
      <span>견적 {{ item.bidCount }}건 · 조회 {{ item.viewCount }}</span>
    </div>
    <div class="mt-1.5 flex items-center justify-between text-[11px] text-tx-3">
      <span>{{ item.ownerName }}</span>
      <span>{{ dateShort(item.createdAt) }} 등록</span>
    </div>
  </RouterLink>
</template>
