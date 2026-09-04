<script setup lang="ts">
import { computed } from 'vue';
import {
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_METHOD_LABELS,
  marketAreaBadge,
  marketToolRows,
} from '@sp/api-contract';
import type { MarketProjectListItemType } from '@sp/api-contract';
import { dateShort, ddayBadge, ddayToneClass } from '../lib/market-format';

const props = defineProps<{ item: MarketProjectListItemType }>();

const dday = computed(() => ddayBadge(props.item));
// 분야 배지 하나로 통일("회로 + PCB"·"풀 개발(…)") — 레지스트리에 없는 옛 코드는 "(종료)" 라벨.
const areaBadge = computed(() => marketAreaBadge(props.item.serviceAreas));
// 희망 툴 요약 — 지정한 분야만 "분야: 툴·툴", 전부 비었으면 "툴·언어는 전문가 추천".
const toolSummary = computed(() => {
  const rows = marketToolRows(props.item.tools, props.item.serviceAreas).filter((r) => r.labels.length > 0);
  return rows.length === 0 ? '툴·언어는 전문가 추천' : rows.map((r) => `${r.areaLabel}: ${r.labels.join('·')}`).join(' / ');
});
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
      <span v-if="areaBadge !== ''" class="rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-teal-700">
        {{ areaBadge }}
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
      <span v-if="item.hasDevReview" class="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
        AI 사전 검토서
      </span>
      <span v-if="item.devDiagramStatus === 'done'" class="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
        정밀 구성도
      </span>
    </div>

    <p class="mt-2 line-clamp-1 text-xs text-tx-3">{{ toolSummary }}</p>

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
