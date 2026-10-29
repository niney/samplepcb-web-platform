<script setup lang="ts">
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import radioOn from '../../assets/wizard/radio-on.svg';
import radioOff from '../../assets/wizard/radio-off.svg';
import photoSystem from '../../assets/wizard/photo-system.jpg';
import photoCircuit from '../../assets/wizard/photo-circuit.jpg';
import photoPcb from '../../assets/wizard/photo-pcb.jpg';
import photoFirmware from '../../assets/wizard/photo-firmware.jpg';
import photoReverse from '../../assets/wizard/photo-reverse.jpg';
import photoAppServer from '../../assets/wizard/photo-appserver.jpg';

// 위저드 1스텝 — 개발 메뉴. 피그마 01-1(70:566 · 카드 70:802): 510×120 카드 2열 3줄 — 라디오(30) · 이름(22 굵게) · 오른쪽 사진 170×120.
// 카드 6장 = 시스템 개발(통합) · 회로 설계 / PCB 설계 · 펌웨어 개발 / 역설계 · 앱 및 서버 개발(사용자 결정 2026-10-29 "피그마 시안대로",
// 계약 DEVELOP_MENU_CARDS). 시스템 개발은 단독 선택, 나머지는 복수 선택이고 '앱 및 서버'는 카드 한 장이 앱·서버 두 분야를 고른다.
// 사진은 시안 마스크 안에서 맨 위에 보이는 레이어만 2배(340×240)로 구워 둔 것(assets/wizard/photo-*.jpg — 회로 카드는 시안의 밝은 덧칠까지).
// 개별 메뉴를 3개 이상 고르면 시스템 개발을 권하는 안내를 카드 아래에 띄운다(질문 수는 그대로 — 검토 회신 5, 2026-10-30).
// 수정 화면도 이 컴포넌트를 그대로 쓴다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { menuCards, systemMenu, isSystem, isCardPicked, suggestSystem, selectSystemMenu, toggleMenuCard } = props.form;

const PHOTOS: Readonly<Record<string, string>> = {
  circuit: photoCircuit,
  pcb: photoPcb,
  firmware: photoFirmware,
  reverse: photoReverse,
  appserver: photoAppServer,
};
const cards = menuCards.map((c) => ({ card: c, photo: PHOTOS[c.code] ?? null }));

const CARD = 'relative flex h-[100px] w-full items-center overflow-hidden rounded-[14px] bg-white pl-[24px] text-left transition-shadow hover:shadow-[0_6px_14px_rgba(0,0,0,0.06)] sm:h-[120px] sm:pl-[34px]';
const PHOTO = 'hidden h-full w-[142px] shrink-0 rounded-r-[14px] object-cover min-[400px]:block sm:w-[170px]';
</script>

<template>
  <div class="flex flex-col gap-[24px] sm:gap-[30px]">
    <div class="grid gap-[16px] md:grid-cols-2 md:gap-x-[40px] md:gap-y-[30px]">
      <!-- 시스템 개발(단독) -->
      <button type="button" :class="CARD" :aria-pressed="isSystem" @click="selectSystemMenu">
        <span class="flex min-w-0 flex-1 items-center gap-[16px] pr-[12px] sm:gap-[22px]">
          <img :src="isSystem ? radioOn : radioOff" alt="" width="30" height="30" class="block size-[30px] shrink-0">
          <span class="flex flex-wrap items-baseline gap-x-[8px] leading-[1.2]">
            <span class="text-[19px] font-bold text-black sm:text-[22px]">{{ systemMenu.label }}</span>
            <span class="text-[15px] font-medium text-[#595e67] sm:text-[16px]">(통합)</span>
          </span>
        </span>
        <img :src="photoSystem" alt="" width="170" height="120" :class="PHOTO">
        <span class="pointer-events-none absolute inset-0 rounded-[14px]" :class="isSystem ? 'border-2 border-[#2945e8]' : 'border border-[#d9d9d9]'" aria-hidden="true" />
      </button>

      <!-- 개별 메뉴 5장(복수 선택) -->
      <button
        v-for="{ card, photo } in cards"
        :key="card.code"
        type="button"
        :class="CARD"
        :aria-pressed="isCardPicked(card)"
        @click="toggleMenuCard(card.code)"
      >
        <span class="flex min-w-0 flex-1 items-center gap-[16px] pr-[12px] sm:gap-[22px]">
          <img :src="isCardPicked(card) ? radioOn : radioOff" alt="" width="30" height="30" class="block size-[30px] shrink-0">
          <span class="text-[19px] font-bold leading-[1.2] text-black sm:text-[22px]">{{ card.label }}</span>
        </span>
        <img v-if="photo !== null" :src="photo" alt="" width="170" height="120" :class="PHOTO">
        <span class="pointer-events-none absolute inset-0 rounded-[14px]" :class="isCardPicked(card) ? 'border-2 border-[#2945e8]' : 'border border-[#d9d9d9]'" aria-hidden="true" />
      </button>
    </div>

    <!-- 3개 이상 — 시스템 개발 권유(시안 없음 — 연한 파랑 안내 상자, 고르지 않아도 다음으로 갈 수 있다) -->
    <div v-if="suggestSystem" class="flex flex-col gap-[12px] rounded-[14px] border border-[#c9d4ff] bg-[#f4f6ff] px-[24px] py-[20px] sm:flex-row sm:items-center sm:justify-between" role="status">
      <p class="text-[16px] font-medium leading-[1.6] text-[#333] sm:text-[17px]">
        여러 분야를 함께 개발하신다면 <b class="font-bold text-black">시스템 개발</b>로 의뢰하시면 전체를 한 번에 검토해 드립니다.
        이대로 진행하셔도 됩니다.
      </p>
      <button
        type="button"
        class="flex h-[44px] shrink-0 items-center justify-center rounded-[8px] border border-[#2945e8] px-[18px] text-[15px] font-bold text-[#2945e8] transition-colors hover:bg-white"
        @click="selectSystemMenu"
      >
        시스템 개발로 바꾸기
      </button>
    </div>
  </div>
</template>
