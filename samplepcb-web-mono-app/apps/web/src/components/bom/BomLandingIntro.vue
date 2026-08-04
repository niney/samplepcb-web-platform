<script setup lang="ts">
import pillUnikey from '../../assets/bom/pill-unikey.png';
import pillDigikey from '../../assets/bom/pill-digikey.png';
import pillMouser from '../../assets/bom/pill-mouser.png';

// 랜딩 카드 아래 소개 문구+공급사 로고(Figma 2282:60901·61708). 두 탭이 공유해
// 서체(Figma 기준 Noto)·좌표를 고정한다. 필 로고는 사용자 지시로 3종만.
const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', src: pillUnikey },
  { name: 'DigiKey', src: pillDigikey },
  { name: 'Mouser Electronics', src: pillMouser },
];
</script>

<template>
  <h2 class="mt-[50px] text-center font-noto text-[26px] font-bold leading-[32px] text-ink-strong">전자부품 2,000만+ 다양한 제조사</h2>
  <p class="mt-[8px] text-center font-noto text-[18px] leading-[32px] text-ink-neutral">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
  <div class="mt-[22px] flex flex-wrap items-center justify-center gap-[12px]">
    <img
      v-for="logo in SUPPLIER_LOGOS"
      :key="logo.name"
      :src="logo.src"
      :alt="logo.name"
      class="h-[66px] w-[148px] mix-blend-multiply"
    >
  </div>
</template>
