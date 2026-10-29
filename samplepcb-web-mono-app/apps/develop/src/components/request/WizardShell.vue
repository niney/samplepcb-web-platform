<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { developPath, logoutUrl } from '../../lib/auth-urls';
import logoMark from '../../assets/wizard/logo-mark.png';
import navRequest from '../../assets/wizard/nav-request.svg';
import navMe from '../../assets/wizard/nav-me.svg';
import navProgress from '../../assets/wizard/nav-progress.svg';
import userChevron from '../../assets/wizard/user-chevron.svg';

// 위저드 전용 앱 셸 — 피그마 「개발 의뢰」 01-0~01-5(Design done 183:22384·70:566 등): 어두운 바탕(#191a1e) · 왼쪽 아이콘 사이드바
// (신규 의뢰·내 의뢰·진행 사항 — 2026-10 시안 3항목으로 통일, 사용자 결정) · 위 48px 바(스텝 제목 + Save Draft | 안내 + 이전/다음 |
// 사용자) · 둥근 밝은 본문 판. 사이트 헤더·푸터는 없다(라우트 meta.bare — DevelopLayout 이 그리지 않는다). 사용자 칸은 시안의
// 사진 대신 이니셜 원. 버튼은 부모가 슬롯으로 꽂는다(셸은 배치만 한다): title-actions = 스텝 제목 옆, actions = 안내 옆,
// menu = 사용자 메뉴 맨 위. 좁은 화면은 사이드바를 접고 바를 두 줄로.
defineProps<{
  barTitle: string;
  guide: string;
  guideError?: boolean; // 안내 자리에 오류 문구를 띄울 때(빨강)
}>();

const auth = useAuthStore();
const route = useRoute();
const nick = computed(() => auth.me?.mbNick ?? '');
const initial = computed(() => (nick.value === '' ? '?' : nick.value.slice(0, 1)));

// 진행 사항 = 내 의뢰를 종결(완료·취소·진행 불가) 빼고 보기(scope=active) — 시안에 목적지가 없어 정했다(사용자 결정 2026-10-29).
const NAV = [
  { label: '신규 의뢰', icon: navRequest, to: { name: 'request' } },
  { label: '내 의뢰', icon: navMe, to: { name: 'me' } },
  { label: '진행 사항', icon: navProgress, to: { name: 'me', query: { scope: 'active' } } },
] as const;

// 사용자 메뉴 — 바깥을 누르거나 Esc 면 닫는다.
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
      <!-- 시안 = 세 덩이 space-between: 스텝 제목 | 안내 + 버튼 | 사용자. 2xl(1536+)은 안내와 사용자에 ml-auto 를 줘 빈 폭을
           둘로 나눈다. 좁은 화면은 [로고 · 안내 · 사용자] 한 줄 + 버튼 한 줄(order 로 재배치). -->
      <div class="flex min-h-[62px] flex-wrap items-center gap-x-[10px] gap-y-[8px] px-[10px] py-[7px] lg:flex-nowrap">
        <RouterLink :to="{ name: 'home' }" class="order-1 flex shrink-0 items-center gap-[3px] lg:w-[228px]" aria-label="개발 의뢰 홈">
          <img :src="logoMark" alt="" width="36" height="48" class="block h-[48px] w-[36px]">
          <span class="hidden text-[21px] font-bold leading-[1.3] text-[#fbfbfb] sm:inline">개발 의뢰</span>
        </RouterLink>
        <!-- 스텝 제목 + 그 옆 버튼(Save Draft, 시안 16px 간격). 좁은 화면은 제목만 숨기고 버튼은 로고 옆에 남긴다. -->
        <div class="order-2 flex shrink-0 items-center gap-[16px] xl:border-l xl:border-[#666] xl:pl-[12px]">
          <p class="hidden text-[21px] font-bold leading-[1.3] text-white xl:block">{{ barTitle }}</p>
          <slot name="title-actions" />
        </div>
        <p
          class="order-3 min-w-0 flex-1 text-[15px] font-bold leading-[1.3] lg:text-right lg:text-[18px] 2xl:ml-auto 2xl:flex-none 2xl:text-[21px]"
          :class="guideError ? 'text-[#ff8f8f]' : 'text-[#1bfffb]'"
          :role="guideError ? 'alert' : undefined"
        >
          {{ guide }}
        </p>
        <div class="order-5 flex w-full shrink-0 items-center justify-end gap-[10px] empty:hidden lg:order-4 lg:ml-[26px] lg:w-auto lg:gap-[14px]">
          <slot name="actions" />
        </div>

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
              v-if="menuOpen"
              class="absolute right-0 top-[44px] z-50 grid min-w-[140px] gap-[2px] rounded-[8px] border border-[#313542] bg-[#0f1013] p-[6px] text-[14px] text-[#f7f7f9]"
              @click="menuOpen = false"
            >
              <slot name="menu" />
              <RouterLink :to="{ name: 'me' }" class="rounded-[6px] px-[10px] py-[8px] hover:bg-white/10" @click="menuOpen = false">내 의뢰</RouterLink>
              <button type="button" class="rounded-[6px] px-[10px] py-[8px] text-left hover:bg-white/10" @click="logout">로그아웃</button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="flex">
      <!-- 왼쪽 아이콘 사이드바(≥lg) -->
      <nav class="sticky top-[62px] hidden h-[calc(100vh-62px)] w-[66px] shrink-0 flex-col items-center gap-[10px] rounded-tr-[10px] border-r border-t border-[#313542] bg-[#0f1013] px-[10px] pt-[10px] lg:flex" aria-label="개발 의뢰 메뉴">
        <RouterLink v-for="n in NAV" :key="n.label" :to="n.to" class="flex flex-col items-center gap-[4px] rounded-[8px] hover:bg-white/5">
          <span class="flex p-[8px]"><img :src="n.icon" alt="" width="24" height="24" class="block size-[24px]"></span>
          <span class="whitespace-nowrap text-[11px] font-medium text-[#f7f7f9] opacity-80">{{ n.label }}</span>
        </RouterLink>
      </nav>

      <!-- 본문 판 -->
      <main class="min-w-0 flex-1 px-0 pb-[10px] lg:pl-[5px] lg:pr-[10px]">
        <!-- relative = 3스텝 목차(StepQuestions)가 이 판 기준으로 본문 왼쪽에 붙는다 -->
        <div class="relative min-h-[calc(100vh-72px)] rounded-[14px] bg-[linear-gradient(to_bottom,#fefeff,#ebecec)] px-[16px] pb-[80px] pt-[40px] sm:px-[24px] lg:pt-[70px]">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
