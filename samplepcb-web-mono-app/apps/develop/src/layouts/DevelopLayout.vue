<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { developPath, loginUrl, logoutUrl } from '../lib/auth-urls';

// 개발의뢰 셸(docs/DEVELOP_FLOW.md §7.2) — 밝은 종이 위 짙은 잉크, 브랜드 블루 하나.
// 마켓과 달리 공개 목록·전문가 내비가 없다: 진행 방식 · 개발 분야(홈 앵커) · 내 의뢰 · CTA(의뢰하기).
// 인쇄용 라우트(meta.bare)는 헤더·푸터를 그리지 않는다.
const auth = useAuthStore();
const route = useRoute();
const mobileOpen = ref(false);
const bare = computed(() => route.meta.bare === true);

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function goLogout(): void {
  window.location.assign(logoutUrl(developPath('/')));
}
</script>

<template>
  <RouterView v-if="bare" />
  <div v-else class="flex min-h-screen flex-col bg-paper">
    <header class="print-hidden sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-6 px-6">
        <RouterLink :to="{ name: 'home' }" class="flex shrink-0 items-center gap-2">
          <span class="font-mono text-lg font-bold tracking-tight text-ink-950">SAMPLEPCB</span>
          <span class="rounded-md bg-brand-500 px-1.5 py-0.5 text-[11px] font-extrabold text-white">개발의뢰</span>
        </RouterLink>

        <nav class="hidden items-center gap-5 text-sm font-semibold text-tx-2 md:flex">
          <RouterLink :to="{ name: 'home', hash: '#how' }" class="hover:text-tx-1">{{ $t('nav.how') }}</RouterLink>
          <RouterLink :to="{ name: 'home', hash: '#areas' }" class="hover:text-tx-1">{{ $t('nav.areas') }}</RouterLink>
          <RouterLink v-if="auth.isLoggedIn" to="/me" class="hover:text-tx-1" active-class="text-brand-600">{{ $t('nav.me') }}</RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-3">
          <template v-if="auth.isLoggedIn">
            <RouterLink to="/me" class="hidden text-sm font-medium text-tx-2 hover:text-tx-1 sm:block">
              {{ $t('auth.greeting', { nick: auth.me?.mbNick ?? '' }) }}
            </RouterLink>
            <button type="button" class="hidden text-xs text-tx-3 hover:text-tx-1 sm:block" @click="goLogout">{{ $t('auth.logout') }}</button>
          </template>
          <button v-else type="button" class="text-sm font-medium text-tx-2 hover:text-tx-1" @click="goLogin">{{ $t('auth.login') }}</button>
          <RouterLink
            to="/request"
            class="rounded-lg bg-ink-950 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-600"
          >
            {{ $t('nav.request') }}
          </RouterLink>
          <button type="button" class="text-xl text-tx-2 md:hidden" aria-label="메뉴" @click="mobileOpen = !mobileOpen">☰</button>
        </div>
      </div>

      <div v-if="mobileOpen" class="border-t border-line bg-white md:hidden">
        <nav class="mx-auto flex w-full max-w-[1280px] flex-col px-6 py-2 text-sm font-semibold text-tx-2">
          <RouterLink :to="{ name: 'home', hash: '#how' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.how') }}</RouterLink>
          <RouterLink :to="{ name: 'home', hash: '#areas' }" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.areas') }}</RouterLink>
          <RouterLink v-if="auth.isLoggedIn" to="/me" class="py-2.5" @click="mobileOpen = false">{{ $t('nav.me') }}</RouterLink>
          <button v-if="auth.isLoggedIn" type="button" class="py-2.5 text-left" @click="goLogout">{{ $t('auth.logout') }}</button>
          <button v-else type="button" class="py-2.5 text-left" @click="goLogin">{{ $t('auth.login') }}</button>
        </nav>
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <footer class="print-hidden mt-16 border-t border-line bg-white">
      <div class="mx-auto grid w-full max-w-[1280px] gap-8 px-6 py-10 sm:grid-cols-3">
        <div>
          <p class="font-mono text-sm font-bold text-ink-950">SAMPLEPCB 개발의뢰</p>
          <p class="mt-2 text-xs leading-relaxed text-tx-3">{{ $t('app.tagline') }}</p>
        </div>
        <div class="text-xs text-tx-3">
          <p class="mb-2 font-semibold text-tx-2">{{ $t('footer.service') }}</p>
          <ul class="space-y-1.5">
            <li><RouterLink :to="{ name: 'home', hash: '#how' }" class="hover:text-brand-600">{{ $t('nav.how') }}</RouterLink></li>
            <li><RouterLink to="/request" class="hover:text-brand-600">{{ $t('nav.request') }}</RouterLink></li>
            <li><RouterLink to="/me" class="hover:text-brand-600">{{ $t('nav.me') }}</RouterLink></li>
          </ul>
        </div>
        <div class="text-xs text-tx-3">
          <p class="mb-2 font-semibold text-tx-2">문의</p>
          <p class="font-mono">{{ $t('app.tel') }}</p>
          <p class="mt-1"><a href="/" class="hover:text-brand-600">samplepcb.co.kr</a> · <a href="/market/" class="hover:text-brand-600">재능마켓</a></p>
        </div>
      </div>
      <div class="border-t border-line">
        <p class="mx-auto w-full max-w-[1280px] px-6 py-4 text-[11px] leading-relaxed text-tx-3">{{ $t('footer.corp') }}</p>
      </div>
    </footer>
  </div>
</template>
