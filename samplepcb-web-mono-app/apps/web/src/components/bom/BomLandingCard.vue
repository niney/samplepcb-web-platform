<script setup lang="ts">
import cardLogo from '../../assets/bom/logo-partseyes.svg';
import glow from '../../assets/bom/bom-card-glow.svg';

// BOM 분석·단일 검색 랜딩 카드 공용 프레임(Figma 2593:7901·2595:10378). 그라데이션·
// 글로우·로고·타이틀은 실 DOM 라이브 레이어 — Figma 다운로드 export 가 전부 흰 배경으로
// 평탄화돼 베이크가 불가하고, 일러스트 원본 PNG 가 자체 알파로 블렌드돼 라이브 합성이
// 시안과 일치한다. 탭별 일러스트는 기본 슬롯으로 받아 글로우 위·텍스트 아래에 깐다.
// 카드 테두리·그림자는 클리핑 밖이어야 해서 페이지 컨테이너가 갖고, 액션 요소(업로드
// 버튼·검색 폼)는 각 페이지가 top-[165px]에 겹쳐 올린다.
defineProps<{ subtitle: string }>();
</script>

<template>
  <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#f0f8fe] via-[#eef7ff] via-[42.8%] to-[#eef8ff]" />
  <img :src="cardLogo" alt="Parts Eyes" class="pointer-events-none absolute left-[24px] top-[18px] h-[26px] w-[150px]">
  <div class="pointer-events-none absolute left-1/2 top-[-205px] h-[387px] w-[1098px] -translate-x-1/2">
    <div class="absolute inset-[-15.5%_-5.46%]">
      <img :src="glow" alt="" class="block size-full max-w-none">
    </div>
  </div>
  <slot />
  <div class="pointer-events-none absolute inset-x-0 top-[85px] flex flex-col items-center gap-[6px] px-4 text-center">
    <!-- 타이틀은 Pretendard(시안 SemiBold) 고정 — 단일 검색 페이지 루트의 font-noto 를
         상속받으면 탭 전환 때 글꼴이 바뀐다. -->
    <p class="font-sans text-[24px] font-semibold leading-[24px] text-[#2076ff]">One BOM. Every Parts.</p>
    <p class="max-w-full font-noto text-[13px] font-medium leading-[20px] text-[#252a31] opacity-60 sm:text-[16px] sm:leading-[32px]">{{ subtitle }}</p>
  </div>
</template>
