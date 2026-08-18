<script setup lang="ts">
import pillUnikey from '../../assets/bom/pill-unikey.png';
import pillDigikey from '../../assets/bom/pill-digikey.png';
import pillMouser from '../../assets/bom/pill-mouser.png';

// 랜딩 카드 아래 소개 문구+공급사 로고(라이트 2282:60328·다크 2282:53271 — 필은
// 두 테마 동일한 흰 캡슐). 두 탭이 공유해 서체(Figma 기준 Noto)·좌표를 고정한다.
// 필 로고는 사용자 지시로 3종만. 베이크는 캡슐 경계(140x58)로 정확히 잘라
// rounded-full 클리핑과 일치시켰다 — 블렌드 없이 다크 캔버스에서도 시안 그대로다.
const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', src: pillUnikey },
  { name: 'DigiKey', src: pillDigikey },
  { name: 'Mouser Electronics', src: pillMouser },
];
</script>

<template>
  <h2 class="mt-[38px] text-center font-noto text-[22px] font-bold leading-[30px] text-ink-strong sm:mt-[50px] sm:text-[26px] sm:leading-[32px]">전자부품 2,000만+ 다양한 제조사</h2>
  <p class="mt-[8px] max-w-xl px-2 text-center font-noto text-[15px] leading-[26px] text-ink-neutral sm:text-[18px] sm:leading-[32px]">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
  <div class="mt-[22px] flex flex-wrap items-center justify-center gap-[20px]">
    <img
      v-for="logo in SUPPLIER_LOGOS"
      :key="logo.name"
      :src="logo.src"
      :alt="logo.name"
      class="h-[58px] w-[140px] rounded-full"
    >
  </div>
</template>
