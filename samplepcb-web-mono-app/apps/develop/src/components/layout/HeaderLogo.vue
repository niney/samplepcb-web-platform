<script setup lang="ts">
import mark from '../../assets/brand/logo-mark.png';
import word from '../../assets/brand/logo-word.png';
import dotLight from '../../assets/brand/logo-dot-light.svg';
import dotDark from '../../assets/brand/logo-dot-dark.svg';
import union from '../../assets/brand/logo-union.svg';
import union1 from '../../assets/brand/logo-union-1.svg';

// SAMPLEPCB 로고 — 피그마 개발의뢰 「00-1 랜딩 페이지」 top > logo(37:6775), 177×30.
// 피그마 구성 그대로: 심볼 이미지(30×30) + 워드마크 스프라이트 크롭(147×22) 위에 점 9개·연결선 2개를 얹는다.
const dots: readonly { src: string; left: number; top: number }[] = [
  { src: dotLight, left: 12, top: 23 },
  { src: dotLight, left: 12, top: 1 },
  { src: dotLight, left: 6.5, top: 17.5 },
  { src: dotDark, left: 18, top: 17.5 },
  { src: dotLight, left: 6.5, top: 6.5 },
  { src: dotDark, left: 18, top: 6.5 },
  { src: dotLight, left: 12, top: 12 },
  { src: dotDark, left: 23.5, top: 12 },
  { src: dotDark, left: 1, top: 12 },
];
</script>

<template>
  <span class="relative flex h-[30px] w-[177px] shrink-0 items-center" aria-hidden="true">
    <img :src="mark" alt="" class="block size-[30px] shrink-0 object-bottom">
    <span class="relative block h-[22px] w-[147px] shrink-0 overflow-hidden">
      <img :src="word" alt="" class="absolute left-[-68.24%] top-[-623.66%] h-[1265.5%] w-[190.53%] max-w-none">
    </span>
    <img
      v-for="(d, i) in dots"
      :key="i"
      :src="d.src"
      alt=""
      class="absolute block size-[6px] max-w-none"
      :style="{ left: `${d.left}px`, top: `${d.top}px` }"
    >
    <img :src="union" alt="" class="absolute left-[21px] top-[9.5px] block h-[11px] w-[5.5px] max-w-none">
    <img :src="union1" alt="" class="absolute left-[9.5px] top-[4px] block h-[22px] w-[5.5px] max-w-none">
  </span>
</template>
