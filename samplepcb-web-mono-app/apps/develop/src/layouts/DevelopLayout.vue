<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { developPath, loginUrl, logoutUrl, registerUrl } from '../lib/auth-urls';
import HeaderLogo from '../components/layout/HeaderLogo.vue';
import SiteFooter from '../components/layout/SiteFooter.vue';

// 개발의뢰 셸(docs/DEVELOP_FLOW.md §7.2) — 헤더는 피그마 개발의뢰 「00-1 랜딩 페이지」 top(37:6772):
// 72px 흰 바 · 안쪽 1280 space-between · [로고 177×30] +50+ [진행 방식 · 개발 분야 · 내 의뢰 · 개발 의뢰하기(검정 버튼)]
// … [로그인 검정 알약 + 회원가입 회색 알약]. 로그인 상태는 피그마에 없어 메인 사이트 헤더 관례(로그아웃 회색 알약)를 따른다.
// 푸터는 메인 사이트 공용 푸터 이식(SiteFooter). 인쇄용 라우트(meta.bare)는 헤더·푸터를 그리지 않는다.
const auth = useAuthStore();
const route = useRoute();
const mobileOpen = ref(false);
const bare = computed(() => route.meta.bare === true);
// 랜딩은 하단 CTA 띠가 푸터에 바로 붙는다(피그마 4636). 다른 화면은 본문과 푸터 사이를 띄운다.
const isHome = computed(() => route.name === 'home');

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function goRegister(): void {
  window.location.assign(registerUrl());
}
function goLogout(): void {
  window.location.assign(logoutUrl(developPath('/')));
}
</script>

<template>
  <RouterView v-if="bare" />
  <div v-else class="flex min-h-screen flex-col" :class="route.meta.bg === 'white' ? 'bg-white' : 'bg-paper'">
    <header class="print-hidden sticky top-0 z-40 bg-white px-5 tracking-normal shadow-[0_8px_10px_rgba(168,185,205,0.1)]">
      <div class="mx-auto flex h-[72px] w-full max-w-[1280px] items-center justify-between gap-6">
        <div class="flex min-w-0 items-center gap-[50px]">
          <RouterLink :to="{ name: 'home' }" class="flex shrink-0 items-center justify-center" aria-label="SAMPLEPCB 개발의뢰 홈">
            <HeaderLogo />
          </RouterLink>
          <nav class="hidden items-center gap-[24px] text-[16px] font-medium leading-[1.3] text-[#0a151e] md:flex">
            <RouterLink :to="{ name: 'home', hash: '#how' }" class="whitespace-nowrap hover:opacity-60">{{ $t('nav.how') }}</RouterLink>
            <RouterLink :to="{ name: 'home', hash: '#areas' }" class="whitespace-nowrap hover:opacity-60">{{ $t('nav.areas') }}</RouterLink>
            <RouterLink :to="{ name: 'me' }" class="whitespace-nowrap hover:opacity-60">{{ $t('nav.me') }}</RouterLink>
            <RouterLink
              :to="{ name: 'request' }"
              class="flex items-center justify-center whitespace-nowrap rounded-[6px] bg-[#0a1220] px-[14px] py-[8px] text-white transition-colors hover:bg-[#22303b]"
            >
              {{ $t('nav.request') }}
            </RouterLink>
          </nav>
        </div>

        <div class="flex shrink-0 items-center gap-[10px] text-[13px] font-medium leading-[1.3]">
          <button
            v-if="auth.isLoggedIn"
            type="button"
            class="flex items-center justify-center whitespace-nowrap rounded-[48px] bg-[#f0f3f5] px-[10px] py-[6px] text-[#576065] transition-colors hover:bg-[#e3e8ec] hover:text-[#0a151e]"
            @click="goLogout"
          >
            {{ $t('auth.logout') }}
          </button>
          <template v-else>
            <button
              type="button"
              class="flex items-center justify-center whitespace-nowrap rounded-[48px] bg-[#0a151e] px-[10px] py-[6px] text-[#fcfdfd] transition-colors hover:bg-[#22303b]"
              @click="goLogin"
            >
              {{ $t('auth.login') }}
            </button>
            <!-- 좁은 화면은 로고·로그인·메뉴만 — 회원가입은 펼친 메뉴로 -->
            <button
              type="button"
              class="flex items-center justify-center whitespace-nowrap rounded-[48px] bg-[#f0f3f5] px-[10px] py-[6px] text-[#576065] transition-colors hover:bg-[#e3e8ec] hover:text-[#0a151e] max-sm:hidden"
              @click="goRegister"
            >
              {{ $t('auth.register') }}
            </button>
          </template>
          <button
            type="button"
            class="flex size-10 items-center justify-center text-[19px] text-[#0a151e] md:hidden"
            :aria-expanded="mobileOpen"
            aria-label="메뉴"
            @click="mobileOpen = !mobileOpen"
          >
            ☰
          </button>
        </div>
      </div>

      <div v-if="mobileOpen" class="-mx-5 border-t border-[#eaeef7] bg-white md:hidden">
        <nav class="flex flex-col px-5 py-2 text-[16px] font-medium text-[#0a151e]">
          <RouterLink :to="{ name: 'home', hash: '#how' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.how') }}</RouterLink>
          <RouterLink :to="{ name: 'home', hash: '#areas' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.areas') }}</RouterLink>
          <RouterLink :to="{ name: 'me' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.me') }}</RouterLink>
          <RouterLink :to="{ name: 'request' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.request') }}</RouterLink>
          <button v-if="!auth.isLoggedIn" type="button" class="py-2.5 text-left sm:hidden" @click="goRegister">{{ $t('auth.register') }}</button>
        </nav>
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <SiteFooter :class="isHome ? '' : 'mt-12'" />
  </div>
</template>
