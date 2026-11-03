<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { APP_BAR } from '../lib/app-bar';
import { developPath, logoutUrl } from '../lib/auth-urls';
import logoMark from '../assets/wizard/logo-mark.png';
import navRequest from '../assets/wizard/nav-request.svg';
import navMe from '../assets/wizard/nav-me.svg';
import navProgress from '../assets/wizard/nav-progress.svg';
import userChevron from '../assets/wizard/user-chevron.svg';

// 개발의뢰 앱 셸 — 피그마 「개발 의뢰」 01-0~01-5(Design done 183:22384·70:566 등)의 어두운 틀: 바탕 #191a1e · 왼쪽 아이콘 사이드바
// (신규 의뢰·내 의뢰·진행 사항 — 2026-10 시안 3항목, 사용자 결정) · 위 48px 바(제목 + 버튼 | 안내 + 버튼 | 사용자) · 둥근 밝은 본문 판.
// 로그인한 고객이 쓰는 화면 전부가 이 틀 안이다 — 위저드·내 의뢰·진행 사항·의뢰 상세·의뢰 수정(사용자 결정 2026-11-03: 사이드바를
// 누르면 흰 사이트 화면으로 통째로 바뀌던 것을 없앤다. 목록↔상세를 오갈 때 틀이 바뀌지 않게 상세까지 함께). 사이트 헤더·푸터는
// 랜딩에만(DevelopLayout). 레이아웃 라우트라 화면을 옮겨도 틀은 그대로이고, 위 바의 제목·안내·버튼은 화면이 AppBar 로 채운다.
// 사용자 칸은 시안의 사진 대신 이니셜 원. 좁은 화면은 사이드바를 접고(세 항목은 사용자 메뉴로) 바를 두 줄로.
const auth = useAuthStore();
const route = useRoute();
const nick = computed(() => auth.me?.mbNick ?? '');
const initial = computed(() => (nick.value === '' ? '?' : nick.value.slice(0, 1)));

// 진행 사항 = 내 의뢰를 종결(완료·취소·진행 불가) 빼고 보기(scope=active) — 시안에 목적지가 없어 정했다(사용자 결정 2026-10-29).
const NAV = [
  { key: 'request', label: '신규 의뢰', icon: navRequest, to: { name: 'request' } },
  { key: 'me', label: '내 의뢰', icon: navMe, to: { name: 'me' } },
  { key: 'active', label: '진행 사항', icon: navProgress, to: { name: 'me', query: { scope: 'active' } } },
] as const;
// 지금 항목 — 두 목록은 같은 라우트라 scope 로 가른다. 상세·수정은 '내 의뢰' 아래 화면으로 본다.
const current = computed(() => {
  if (route.name === 'request') return 'request';
  if (route.name === 'me') return route.query.scope === 'active' ? 'active' : 'me';
  if (route.name === 'request-detail' || route.name === 'request-edit') return 'me';
  return null;
});

// 본문 판 바탕 — meta.bg(라우트 표). 없으면 위저드 시안의 흰→회색 그라데이션.
const BG: Record<string, string> = { white: 'bg-white', soft: 'bg-[#fdfdfd]' };
const panelBg = computed(() => {
  const bg = route.meta.bg;
  return (typeof bg === 'string' ? BG[bg] : undefined) ?? 'bg-[linear-gradient(to_bottom,#fefeff,#ebecec)]';
});

// 사용자 메뉴 — 바깥을 누르거나 Esc 면 닫는다. 화면이 넣는 항목(#app-bar-menu)이 닫혀 있을 때도 자리를 찾도록 v-show 로 숨긴다.
const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);
function onDocClick(e: MouseEvent): void {
  if (menuEl.value !== null && !menuEl.value.contains(e.target as Node)) menuOpen.value = false;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') menuOpen.value = false;
}
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
});
watch(() => route.fullPath, () => {
  menuOpen.value = false;
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
function logout(): void {
  window.location.assign(logoutUrl(developPath(route.fullPath)));
}
</script>

<template>
  <div class="min-h-screen bg-[#191a1e] tracking-normal text-[#061023]">
    <!-- 위 바 -->
    <header class="sticky top-0 z-40 bg-[#191a1e]">
      <!-- 시안 = 세 덩이 space-between: 제목 | 안내 + 버튼 | 사용자. 2xl(1536+)은 안내와 사용자에 ml-auto 를 줘 빈 폭을
           둘로 나눈다. 좁은 화면은 [로고 · 안내 · 사용자] 한 줄 + 버튼 한 줄(order 로 재배치). 가운데 세 자리는 화면이 채운다(AppBar). -->
      <div class="flex min-h-[62px] flex-wrap items-center gap-x-[10px] gap-y-[8px] px-[10px] py-[7px] lg:flex-nowrap">
        <RouterLink :to="{ name: 'home' }" class="order-1 flex shrink-0 items-center gap-[3px] lg:w-[228px]" aria-label="개발 의뢰 홈">
          <img :src="logoMark" alt="" width="36" height="48" class="block h-[48px] w-[36px]">
          <span class="hidden text-[21px] font-bold leading-[1.3] text-[#fbfbfb] sm:inline">개발 의뢰</span>
        </RouterLink>
        <!-- 제목 + 그 옆 버튼(Save Draft, 시안 16px 간격). 좁은 화면은 제목만 숨기고 버튼은 로고 옆에 남긴다. -->
        <div :id="APP_BAR.title" class="order-2 flex shrink-0 items-center gap-[16px] empty:hidden xl:border-l xl:border-[#666] xl:pl-[12px]" />
        <div :id="APP_BAR.guide" class="order-3 min-w-0 flex-1 lg:text-right 2xl:ml-auto 2xl:flex-none" />
        <div
          :id="APP_BAR.actions"
          class="order-5 flex w-full shrink-0 items-center justify-end gap-[10px] empty:hidden lg:order-4 lg:ml-[26px] lg:w-auto lg:gap-[14px]"
        />

        <div class="order-4 shrink-0 lg:order-5 lg:ml-[26px] 2xl:ml-auto">
          <div v-if="auth.isLoggedIn" ref="menuEl" class="relative shrink-0">
            <button
              type="button"
              class="flex h-[38px] items-center gap-[12px] rounded-[6px] border border-[#666] pl-[10px] pr-[12px] text-[#fdfdfe]"
              :aria-expanded="menuOpen"
              @click="menuOpen = !menuOpen"
            >
              <span class="flex items-center gap-[6px]">
                <span class="flex size-[26px] items-center justify-center rounded-full bg-[#2945e8] text-[13px] font-bold text-white" aria-hidden="true">{{ initial }}</span>
                <span class="max-w-[120px] truncate text-[16px] font-medium">{{ nick }}</span>
              </span>
              <img :src="userChevron" alt="" width="13" height="8.4799" class="block transition-transform" :class="menuOpen ? 'rotate-180' : ''">
            </button>
            <div
              v-show="menuOpen"
              class="absolute right-0 top-[44px] z-50 grid min-w-[140px] gap-[2px] rounded-[8px] border border-[#313542] bg-[#0f1013] p-[6px] text-[14px] text-[#f7f7f9]"
              @click="menuOpen = false"
            >
              <div :id="APP_BAR.menu" class="contents" />
              <!-- 좁은 화면은 사이드바가 접히므로 세 항목을 여기에 -->
              <RouterLink
                v-for="n in NAV"
                :key="n.key"
                :to="n.to"
                class="rounded-[6px] px-[10px] py-[8px] hover:bg-white/10 lg:hidden"
                :class="current === n.key ? 'font-bold' : ''"
                :aria-current="current === n.key ? 'page' : undefined"
              >
                {{ n.label }}
              </RouterLink>
              <button type="button" class="rounded-[6px] px-[10px] py-[8px] text-left hover:bg-white/10" @click="logout">로그아웃</button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="flex">
      <!-- 왼쪽 아이콘 사이드바(≥lg) — 지금 항목은 밝은 바탕. 시안엔 선택 표시가 없어 정했다. -->
      <nav class="sticky top-[62px] hidden h-[calc(100vh-62px)] w-[66px] shrink-0 flex-col items-center gap-[10px] rounded-tr-[10px] border-r border-t border-[#313542] bg-[#0f1013] px-[10px] pt-[10px] lg:flex" aria-label="개발 의뢰 메뉴">
        <RouterLink
          v-for="n in NAV"
          :key="n.key"
          :to="n.to"
          class="flex w-full flex-col items-center gap-[4px] rounded-[8px] pb-[6px] transition-colors"
          :class="current === n.key ? 'bg-white/10' : 'hover:bg-white/5'"
          :aria-current="current === n.key ? 'page' : undefined"
        >
          <span class="flex p-[8px] pb-[4px]"><img :src="n.icon" alt="" width="24" height="24" class="block size-[24px]"></span>
          <span class="whitespace-nowrap text-[11px] font-medium text-[#f7f7f9]" :class="current === n.key ? 'opacity-100' : 'opacity-80'">{{ n.label }}</span>
        </RouterLink>
      </nav>

      <!-- 본문 판 -->
      <main class="min-w-0 flex-1 px-0 pb-[10px] lg:pl-[5px] lg:pr-[10px]">
        <!-- relative = 3스텝 목차(StepQuestions)가 이 판 기준으로 본문 왼쪽에 붙는다 -->
        <div class="relative min-h-[calc(100vh-72px)] rounded-[14px] px-[16px] pb-[80px] pt-[40px] sm:px-[24px] lg:pt-[70px]" :class="panelBg">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
