<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useMyBomQuotes } from '../bom/useBom';
import { useBomPanels } from '../bom/usePanels';
import logoIcon from '../assets/bom/logo-partseyes-icon.png';
import icProfile from '../assets/bom/ic-profile.svg';
import icFold from '../assets/bom/ic-fold.svg';
import icMenuBom from '../assets/bom/ic-menu-bom.svg';
import icMenuSearch from '../assets/bom/ic-menu-search.svg';
import icMenuUpload from '../assets/bom/ic-menu-upload.svg';
import icTrailSearch from '../assets/bom/ic-trail-search.svg';
import icFile from '../assets/bom/ic-file.svg';
import promoZip from '../assets/bom/promo-zip.png';
import promoVideo from '../assets/bom/promo-video.png';

// 스마트 BOM 전용 앱 셸 — Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(87:9037) 이식.
// 시안의 다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환, 구조·치수는 동일.
// 미구현(표시만): 단일 검색 메뉴·샘플 토글·프로필 메뉴·프로모 카드 링크.

const route = useRoute();
const auth = useAuthStore();

// 사이드바 접기 — 좌(메뉴)/우(페이지별 우측 패널) 토글. 상세 페이지의 정보 패널
// (AI 분석결과·주문 정보·예상 견적)도 같은 rightOpen 을 공유한다(usePanels 싱글턴).
const { leftOpen, rightOpen } = useBomPanels();

// Recent file — 시안의 4행을 실데이터(내 견적 최신 4건)로 채운다
const list = useMyBomQuotes(ref(1), computed(() => auth.isLoggedIn));
const recent = computed(() => (list.data.value?.data.items ?? []).slice(0, 4));
const currentQuoteId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[#eef1f6] text-[#131519] [font-family:Pretendard,'Noto_Sans_KR',system-ui,sans-serif]">
    <!-- top (87:9560) — 시안 다크 → 라이트 치환 -->
    <header class="relative z-10 flex h-[58px] shrink-0 items-center border-b border-gray-200 bg-white">
      <!-- 로고 블록은 시안처럼 사이드바 폭(220px)과 정렬 — 구분선이 경계에 온다 -->
      <div class="flex w-[220px] shrink-0 items-center pl-[24px]">
        <RouterLink :to="{ name: 'bom' }" class="flex items-center gap-[7px]">
          <img :src="logoIcon" alt="Parts Eyes" class="h-[26px] w-auto">
          <span class="text-[21px] font-bold tracking-tight text-[#061023]">Parts Eyes</span>
        </RouterLink>
      </div>
      <div class="h-[30px] w-px bg-gray-200" />
      <button
        type="button"
        class="ml-[12px] grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
        :title="leftOpen ? '사이드바 접기' : '사이드바 펼치기'"
        @click="leftOpen = !leftOpen"
      >
        <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="leftOpen ? '' : '-scale-x-100'">
      </button>
      <!-- 샘플 토글 — 미구현(표시만) -->
      <div
        class="ml-[26px] flex h-[36px] w-[80px] items-center rounded-full bg-gradient-to-b from-[#f3f3f3] to-white pl-[12px] shadow-[inset_0px_2px_0px_0px_white] ring-1 ring-gray-200"
        title="샘플 BOM 체험 (준비 중)"
      >
        <span class="text-[16px] font-extrabold text-[#3288d6]">샘플</span>
        <span class="ml-[9px] size-[28px] rounded-full bg-[#4daaff] shadow-[0px_2px_4px_rgba(30,120,220,0.45)]" />
      </div>

      <p class="absolute left-1/2 -translate-x-1/2 text-[18px] font-medium text-[#7c8698]">AI 기반 전자부품 검색 엔진</p>

      <div class="ml-auto flex items-center gap-[12px] pr-[18px]">
        <button
          type="button"
          class="grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
          :title="rightOpen ? '패널 접기' : '패널 펼치기'"
          @click="rightOpen = !rightOpen"
        >
          <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="rightOpen ? '-scale-x-100' : ''">
        </button>
        <div
          class="flex size-[32px] items-center justify-center overflow-hidden rounded-full bg-[#9aa3b2]"
          :title="auth.me?.mbNick ?? ''"
        >
          <img :src="icProfile" alt="프로필" class="size-[32px]">
        </div>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- left side bar (87:9485) — 라이트 치환 -->
      <aside v-show="leftOpen" class="hidden w-[220px] shrink-0 flex-col border-r border-gray-200 bg-white pt-[36px] lg:flex">
        <RouterLink :to="{ name: 'bom' }" class="flex h-[45px] items-center bg-[#eaf2ff] pl-[21px] pr-[15px]">
          <img :src="icMenuBom" alt="" class="size-[18px]">
          <span class="ml-[6px] text-[16px] font-medium text-[#0e6efd]">BOM 분석</span>
          <img :src="icMenuUpload" alt="" class="ml-auto size-[14px]">
        </RouterLink>
        <!-- 단일 검색 — 미구현(표시만) -->
        <div class="flex h-[45px] cursor-default items-center pl-[21px] pr-[15px] opacity-80" title="단일 검색 (준비 중)">
          <img :src="icMenuSearch" alt="" class="size-[18px]">
          <span class="ml-[6px] text-[16px] font-medium text-[#27292e]">단일 검색</span>
          <img :src="icTrailSearch" alt="" class="ml-auto size-[14px]">
        </div>

        <p class="mt-[38px] pl-[21px] text-[13px] font-bold text-[#8f94a2]">Recent file</p>
        <div class="mt-[16px] flex w-[179px] flex-col gap-[2px] self-start pl-0" style="margin-left: 21px">
          <RouterLink
            v-for="q in recent"
            :key="q.id"
            :to="{ name: 'bom-quote', params: { id: q.id } }"
            class="flex items-center gap-[4px] rounded-[4px] px-[8px] py-[6px]"
            :class="currentQuoteId === q.id ? 'border border-[#dfe3ec] bg-[#f4f6fa]' : 'border border-transparent hover:bg-gray-50'"
          >
            <img :src="icFile" alt="" class="size-[15px] opacity-60">
            <span class="truncate text-[12px] text-[#6b7280]">{{ q.fileName ?? q.title }}</span>
          </RouterLink>
          <p v-if="recent.length === 0" class="px-[8px] py-[6px] text-[12px] text-gray-400">아직 업로드한 BOM이 없습니다</p>
        </div>
      </aside>

      <!-- 중앙 흰 패널 (Rectangle 197) -->
      <main class="min-w-0 flex-1 p-[10px]">
        <div class="min-h-full rounded-[12px] bg-[#fdfdff] shadow-sm">
          <RouterView />
        </div>
      </main>

      <!-- right side bar (87:21445) — 라이트 치환, 프로모 카드는 시안 그대로.
           상세(bom-quote)에서는 페이지 자체 우측 패널(주문 정보·예상 견적)이 대신한다. -->
      <aside v-show="rightOpen && route.name === 'bom'" class="hidden w-[334px] shrink-0 flex-col gap-[12px] px-[24px] pt-[24px] xl:flex">
        <!-- con01: Parts Eyes 튜토리얼 — 링크 미구현 -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-gradient-to-l from-[#f2fdfd] to-[#f7f7fb] ring-1 ring-black/5" title="튜토리얼 (준비 중)">
          <div class="absolute right-0 top-0 h-full w-[141px] bg-gradient-to-b from-[#e3f3ff] to-[#f7f9fb] blur-[10px]" />
          <img :src="promoZip" alt="" class="absolute right-[24px] top-[49px] size-[58px] rounded-[10px] shadow-[0px_4px_10px_rgba(89,129,208,0.4)]">
          <div class="absolute right-[18px] top-[16px] flex h-[18px] items-center gap-[3px] rounded-[10px] bg-white px-[7px] shadow-[0px_0px_10px_#eeedf5]">
            <span class="size-[4px] rounded-full bg-[#3a7cff]" />
            <span class="text-[10px] font-bold text-[#3a7cff]">PICK</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px]">
            <p class="text-[11px] leading-[24px] text-[#3199ff]">Parts Eyes 이용 방법 튜토리얼</p>
            <p class="text-[12px] leading-[18px] text-[#293a5b]">다양한 제조사의 전자부품을<br>파츠아이에서 빠르게 검색하세요</p>
          </div>
        </div>
        <!-- con02: Gerber Eyes Online 3.0 — 링크 미구현 -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-gradient-to-l from-[#edf5fd] to-[#f6f7fa] ring-1 ring-black/5" title="Gerber Eyes 소개 영상 (준비 중)">
          <div class="absolute right-0 top-0 h-full w-[141px] bg-gradient-to-b from-[#e1edff] to-[#f2fafc] blur-[10px]" />
          <img :src="promoVideo" alt="" class="absolute right-[28px] top-[44px] size-[54px] rounded-[10px] shadow-[0px_4px_10px_rgba(183,183,183,0.5)]">
          <div class="absolute left-[188px] top-[35px] rounded-[10px] bg-white/80 px-[6px] py-[3px] backdrop-blur-[10px]">
            <span class="bg-gradient-to-br from-[#ff1e22] to-[#af002f] bg-clip-text text-[10px] font-bold text-transparent">NEW</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px]">
            <p class="text-[11px] leading-[24px] text-[#e95e49]">Gerber Eyes Online 3.0 출시</p>
            <p class="text-[12px] leading-[18px] text-[#293a5b]">영상을 통해 편리해진<br>DFM 분석 기능을 확인해 보세요</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
  <!-- 시안 대비 미구현 기능(리스트업): 단일 검색(메뉴·토글) · 샘플 토글 ·
       프로필 메뉴 · 프로모 카드 링크(튜토리얼/Gerber Eyes) — 사이드바/패널 접기는 구현됨 -->
</template>
