<script setup lang="ts">
// BOM 분석·단일 검색 랜딩 공용 토글(Figma 2282:61242·61760). 두 페이지가 같은 마크업과
// 서체(font-noto)를 쓰고, 비활성 pill에는 bold 고스트로 폭을 예약해 활성(bold)↔비활성
// (medium) 전환에도 pill 폭이 변하지 않아 탭 간 토글 위치가 픽셀 단위로 같다.
defineProps<{ active: 'bom' | 'search' }>();

const TABS = [
  { key: 'bom', label: 'BOM 분석', route: 'bom' },
  { key: 'search', label: '단일 검색', route: 'bom-search' },
] as const;
</script>

<template>
  <div class="mt-[46px] flex h-[42px] shrink-0 items-center rounded-full bg-surface-raised font-noto">
    <template v-for="tab in TABS" :key="tab.key">
      <span v-if="tab.key === active" class="flex h-[42px] items-center rounded-full bg-[#061023] px-[24px] text-[16px] font-bold leading-[24px] text-white">{{ tab.label }}</span>
      <RouterLink v-else :to="{ name: tab.route }" class="group grid h-[42px] items-center rounded-full px-[24px]">
        <span aria-hidden="true" class="invisible col-start-1 row-start-1 text-[16px] font-bold leading-[24px]">{{ tab.label }}</span>
        <span class="col-start-1 row-start-1 text-center text-[16px] font-medium leading-[24px] text-ink opacity-80 transition group-hover:opacity-60">{{ tab.label }}</span>
      </RouterLink>
    </template>
  </div>
</template>
