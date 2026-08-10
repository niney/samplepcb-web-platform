<script setup lang="ts">
import cardBg from '../../assets/bom/bom-card-bg.jpg';
import cardLogo from '../../assets/bom/bom-card-logo.svg';

// BOM 분석·단일 검색 랜딩 카드 공용 비주얼(Figma 2282:60957·61416). 배경(그라데이션×
// 글로우×하단 사진)은 두 시안에서 동일하므로 텍스트 없는 베이크 한 장을 공유하고 —
// luminosity 블렌드가 CSS 격리 컨텍스트에서 깨져 라이브 재조합이 불가한 부분 —
// 로고·타이틀은 실 DOM으로 얹어 탭 전환 시 위치가 픽셀 단위로 일치하게 한다.
// 액션 요소(업로드 버튼·검색 폼)는 각 페이지가 top-[226px]에 겹쳐 올린다.
defineProps<{ title: string; subtitle: string }>();
</script>

<template>
  <img :src="cardBg" alt="" class="pointer-events-none absolute inset-0 size-full">
  <img :src="cardLogo" alt="Parts Eyes" class="pointer-events-none absolute left-1/2 top-[68px] w-[240px] -translate-x-1/2 sm:w-[290px]">
  <div class="pointer-events-none absolute inset-x-0 top-[134px] flex flex-col items-center gap-[6px] px-4 text-center font-noto text-[#fdfdff]">
    <p class="text-[20px] font-medium leading-[32px]">{{ title }}</p>
    <p class="max-w-full text-[13px] font-normal leading-[20px] opacity-70 sm:text-[16px] sm:leading-[24px]">{{ subtitle }}</p>
  </div>
</template>
