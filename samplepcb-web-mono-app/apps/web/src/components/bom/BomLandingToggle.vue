<script setup lang="ts">
// BOM 분석·단일 검색 랜딩 공용 토글(Figma 2282:61242·61760). 두 탭의 시안 폭
// (118px·111px)을 고정해 활성 굵기가 바뀌어도 전체 229px 위치가 흔들리지 않는다.
defineProps<{ active: 'bom' | 'search' }>();

const TABS = [
  { key: 'bom', label: 'BOM 분석', route: 'bom' },
  { key: 'search', label: '단일 검색', route: 'bom-search' },
] as const;
</script>

<template>
  <div class="mt-[46px] flex h-[42px] w-[229px] shrink-0 items-center rounded-[50px] bg-bom-landing-toggle font-noto">
    <template v-for="tab in TABS" :key="tab.key">
      <span
        v-if="tab.key === active"
        class="flex h-[42px] shrink-0 items-center justify-center rounded-[50px] bg-bom-landing-toggle-active px-[24px] text-center text-[16px] font-bold leading-[24px] text-white whitespace-nowrap"
        :class="tab.key === 'bom' ? 'w-[118px]' : 'w-[111px]'"
      >{{ tab.label }}</span>
      <RouterLink
        v-else
        :to="{ name: tab.route }"
        class="flex h-[42px] shrink-0 items-center justify-center rounded-[50px] bg-bom-landing-toggle px-[24px] text-center text-[16px] font-medium leading-[24px] text-bom-landing-toggle-inactive opacity-80 transition hover:opacity-60 whitespace-nowrap"
        :class="tab.key === 'bom' ? 'w-[118px]' : 'w-[111px]'"
      >
        {{ tab.label }}
      </RouterLink>
    </template>
  </div>
</template>
