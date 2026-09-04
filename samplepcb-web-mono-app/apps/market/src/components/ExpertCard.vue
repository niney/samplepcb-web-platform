<script setup lang="ts">
import { computed } from 'vue';
import {
  MARKET_CAREER_RANGE_LABELS,
  MARKET_REGION_LABELS,
  marketAreaLabel,
  marketToolRows,
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
// 툴 한 줄 — 분야별로 지정한 툴만(비운 분야는 제한 없음이라 생략).
const toolLine = computed(() =>
  marketToolRows(props.item.tools, props.item.serviceAreas)
    .filter((r) => r.labels.length > 0)
    .map((r) => r.labels.join(' · '))
    .join(' · '),
);
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
      <span v-for="area in item.serviceAreas.slice(0, 5)" :key="area" class="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
        {{ marketAreaLabel(area) }}
      </span>
    </div>

    <p v-if="toolLine !== ''" class="mt-2 line-clamp-1 font-mono text-[11px] text-tx-3">
      {{ toolLine }}
    </p>

    <p v-if="item.intro !== null" class="mt-3 line-clamp-2 border-t border-line pt-3 text-xs leading-relaxed text-tx-2">
      {{ item.intro }}
    </p>
  </RouterLink>
</template>
