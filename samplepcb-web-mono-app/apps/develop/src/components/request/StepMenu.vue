<script setup lang="ts">
import { computed } from 'vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import radioOn from '../../assets/wizard/radio-on.svg';
import radioOff from '../../assets/wizard/radio-off.svg';
import photoSystem from '../../assets/wizard/photo-system.jpg';
import photoPcb from '../../assets/wizard/photo-pcb.jpg';
import photoApp from '../../assets/wizard/photo-app.jpg';
import photoServer from '../../assets/wizard/photo-server.jpg';
import photoMech from '../../assets/wizard/photo-mech.jpg';

// 위저드 1스텝 — 개발 메뉴. 피그마 01-1(70:800): 510×120 카드 2열 — 라디오(30) · 이름(22 굵게) · 오른쪽 사진 170×120.
// 시안은 6장(펌웨어·'기타 소프트웨어 개발'·'디자인 및 기구 설계')이지만 메뉴는 계약 5개 그대로(사용자 결정 2026-10-22):
// 시안 자리 순서대로 시스템·PCB / 앱(시안 '기타 소프트웨어' 사진) · 서버 / 기구(시안 '디자인 및 기구' 사진). 펌웨어 카드는 없다.
// 사진은 시안 마스크 안에서 보이는 영역만 2배로 잘라 둔 것(assets/wizard/photo-*.jpg). 시스템 개발은 단독 선택(계약 규칙).
// 수정 화면도 이 컴포넌트를 그대로 쓴다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { individualAreas, systemMenu, isSystem, isAreaPicked, selectSystemMenu, toggleIndividualArea } = props.form;

const PHOTOS: Record<string, string> = { pcb: photoPcb, app: photoApp, server: photoServer, mech: photoMech };
const ORDER = ['pcb', 'app', 'server', 'mech'];
const areaCards = computed(() =>
  [...individualAreas].sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code)).map((a) => ({ code: a.code, label: a.label, photo: PHOTOS[a.code] ?? null })),
);

const CARD = 'relative flex h-[100px] w-full items-center overflow-hidden rounded-[14px] bg-white pl-[24px] text-left transition-shadow hover:shadow-[0_6px_14px_rgba(0,0,0,0.06)] sm:h-[120px] sm:pl-[34px]';
</script>

<template>
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
      <img :src="photoSystem" alt="" width="170" height="120" class="hidden h-full w-[142px] shrink-0 rounded-r-[14px] object-cover min-[400px]:block sm:w-[170px]">
      <span class="pointer-events-none absolute inset-0 rounded-[14px]" :class="isSystem ? 'border-2 border-[#2945e8]' : 'border border-[#d9d9d9]'" aria-hidden="true" />
    </button>

    <!-- 개별 견적 4분야(복수 선택) -->
    <button
      v-for="area in areaCards"
      :key="area.code"
      type="button"
      :class="CARD"
      :aria-pressed="isAreaPicked(area.code)"
      @click="toggleIndividualArea(area.code)"
    >
      <span class="flex min-w-0 flex-1 items-center gap-[16px] pr-[12px] sm:gap-[22px]">
        <img :src="isAreaPicked(area.code) ? radioOn : radioOff" alt="" width="30" height="30" class="block size-[30px] shrink-0">
        <span class="text-[19px] font-bold leading-[1.2] text-black sm:text-[22px]">{{ area.label }}</span>
      </span>
      <img v-if="area.photo !== null" :src="area.photo" alt="" width="170" height="120" class="hidden h-full w-[142px] shrink-0 rounded-r-[14px] object-cover min-[400px]:block sm:w-[170px]">
      <span class="pointer-events-none absolute inset-0 rounded-[14px]" :class="isAreaPicked(area.code) ? 'border-2 border-[#2945e8]' : 'border border-[#d9d9d9]'" aria-hidden="true" />
    </button>
  </div>
</template>
