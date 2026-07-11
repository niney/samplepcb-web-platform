<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  MARKET_TOOL_LABELS,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_REGION_LABELS,
  MARKET_SERVICE_AREA_LABELS,
} from '@sp/api-contract';
import { useMarketExpertDetail } from '../api/useMarketExperts';
import { avatarHue } from '../lib/market-format';

const route = useRoute();
const expertId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const { data, isLoading, isError } = useMarketExpertDetail(expertId);

const expert = computed(() => data.value?.data);
const typeBadge = computed(() => {
  const t = expert.value?.expertType;
  return t === 'house'
    ? { label: '지정 1번 · 당사진행', cls: 'bg-copper-500 text-white' }
    : t === 'company'
      ? { label: '지정 2번 · 파트너사', cls: 'bg-ink-900 text-white' }
      : { label: '지정 3번 · 프리랜서', cls: 'bg-line text-tx-2' };
});
</script>

<template>
  <section class="mx-auto w-full max-w-4xl px-4 py-10">
    <div v-if="isLoading" class="py-20 text-center text-sm text-tx-3">{{ $t('common.loading') }}</div>

    <div v-else-if="isError || expert === undefined" class="rounded-2xl border border-line bg-white p-14 text-center">
      <p class="text-sm text-tx-3">전문가를 찾을 수 없습니다.</p>
      <RouterLink
        to="/experts"
        class="mt-4 inline-block rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
      >
        {{ $t('nav.experts') }}
      </RouterLink>
    </div>

    <template v-else>
      <!-- 프로필 헤더 -->
      <div class="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div class="flex flex-wrap items-center gap-4">
          <span
            class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-extrabold text-white"
            :style="{ backgroundColor: `hsl(${String(avatarHue(expert.displayName))} 45% 38%)` }"
          >
            {{ expert.displayName.slice(0, 1) }}
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-extrabold text-tx-1">{{ expert.displayName }}</h1>
              <span class="rounded-md px-2 py-0.5 text-[11px] font-bold" :class="typeBadge.cls">
                {{ typeBadge.label }}
              </span>
            </div>
            <p class="mt-1 text-sm text-tx-2">
              경력 {{ MARKET_CAREER_RANGE_LABELS[expert.careerRange] }}
              <template v-if="expert.region !== null">
                · {{ MARKET_REGION_LABELS[expert.region] }}
              </template>
            </p>
          </div>
          <RouterLink
            :to="{ path: '/request', query: { expert: String(expert.expertId) } }"
            class="ml-auto rounded-lg bg-copper-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-copper-600"
          >
            이 전문가에게 지정견적 의뢰
          </RouterLink>
        </div>
        <p class="mt-4 rounded-xl bg-paper p-3 text-[11px] leading-relaxed text-tx-3">
          연락처는 공개되지 않습니다. 의뢰 등록 → 견적 채택 후 플랫폼 안내에 따라 진행됩니다.
        </p>
      </div>

      <!-- 전문 분야 -->
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl border border-line bg-white p-6">
          <p class="font-mono text-[11px] tracking-widest text-tx-3">FIELDS</p>
          <h2 class="mt-1 text-sm font-extrabold text-tx-1">전문 분야</h2>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="area in expert.serviceAreas" :key="area" class="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
              {{ MARKET_SERVICE_AREA_LABELS[area] }}
            </span>
            <span
              v-for="c in expert.categories"
              :key="c"
              class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
            >
              {{ MARKET_CATEGORY_LABELS[c] }}
            </span>
            <span v-if="expert.categories.length === 0" class="text-xs text-tx-3">—</span>
          </div>
        </div>
        <div class="rounded-2xl border border-line bg-white p-6">
          <p class="font-mono text-[11px] tracking-widest text-tx-3">CAD</p>
          <h2 class="mt-1 text-sm font-extrabold text-tx-1">사용 CAD 툴</h2>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="c in expert.cadTools"
              :key="c"
              class="rounded-full bg-teal-50 px-2.5 py-1 font-mono text-xs font-medium text-teal-700"
            >
              {{ MARKET_TOOL_LABELS[c] }}
            </span>
            <span v-if="expert.cadTools.length === 0" class="text-xs text-tx-3">—</span>
          </div>
        </div>
      </div>

      <!-- 소개 -->
      <div v-if="expert.intro !== null" class="mt-4 rounded-2xl border border-line bg-white p-6">
        <p class="font-mono text-[11px] tracking-widest text-tx-3">ABOUT</p>
        <h2 class="mt-1 text-sm font-extrabold text-tx-1">소개</h2>
        <p class="mt-3 whitespace-pre-line text-sm leading-relaxed text-tx-2">{{ expert.intro }}</p>
      </div>
    </template>
  </section>
</template>
