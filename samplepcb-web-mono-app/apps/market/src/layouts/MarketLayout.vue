<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { loginUrl, logoutUrl, marketPath } from '../lib/auth-urls';

const auth = useAuthStore();
const route = useRoute();
const mobileOpen = ref(false);

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

function goLogout(): void {
  window.location.assign(logoutUrl(marketPath('/')));
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-paper">
    <!-- 탑바 -->
    <div class="hidden border-b border-line bg-white sm:block">
      <div
        class="mx-auto flex h-9 w-full max-w-6xl items-center justify-between px-4 text-xs text-tx-3"
      >
        <span>{{ $t('app.tagline') }}</span>
        <div class="flex items-center gap-4">
          <RouterLink to="/expert/register" class="font-semibold hover:text-copper-600">
            {{ $t('nav.expertRegister') }}
          </RouterLink>
          <span class="font-mono">{{ $t('app.tel') }}</span>
        </div>
      </div>
    </div>

    <!-- 헤더 -->
    <header class="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4">
        <RouterLink :to="{ name: 'home' }" class="flex shrink-0 items-center gap-1.5">
          <span class="font-mono text-lg font-bold tracking-tight text-ink-950">SAMPLEPCB</span>
          <span class="rounded-md bg-copper-500 px-1.5 py-0.5 text-[11px] font-extrabold text-white">
            재능마켓
          </span>
        </RouterLink>

        <nav class="hidden items-center gap-5 text-sm font-semibold text-tx-2 md:flex">
          <RouterLink to="/projects" class="hover:text-tx-1" active-class="text-copper-600">
            {{ $t('nav.projects') }}
          </RouterLink>
          <RouterLink to="/experts" class="hover:text-tx-1" active-class="text-copper-600">
            {{ $t('nav.experts') }}
          </RouterLink>
          <RouterLink :to="{ name: 'home', hash: '#how' }" class="hover:text-tx-1">
            {{ $t('nav.guide') }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-3">
          <template v-if="auth.isLoggedIn">
            <RouterLink to="/me" class="hidden text-sm font-medium text-tx-2 hover:text-tx-1 sm:block">
              {{ $t('auth.greeting', { nick: auth.me?.mbNick ?? '' }) }}
            </RouterLink>
            <button
              type="button"
              class="hidden text-xs text-tx-3 hover:text-tx-1 sm:block"
              @click="goLogout"
            >
              {{ $t('auth.logout') }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="text-sm font-medium text-tx-2 hover:text-tx-1"
            @click="goLogin"
          >
            {{ $t('auth.login') }}
          </button>
          <RouterLink
            to="/request"
            class="rounded-lg bg-copper-500 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-copper-600"
          >
            {{ $t('nav.request') }}
          </RouterLink>
          <button
            type="button"
            class="text-xl text-tx-2 md:hidden"
            aria-label="메뉴"
            @click="mobileOpen = !mobileOpen"
          >
            ☰
          </button>
        </div>
      </div>

      <!-- 모바일 메뉴 -->
      <div v-if="mobileOpen" class="border-t border-line bg-white md:hidden">
        <nav class="mx-auto flex w-full max-w-6xl flex-col px-4 py-2 text-sm font-semibold text-tx-2">
          <RouterLink to="/projects" class="py-2.5" @click="mobileOpen = false">
            {{ $t('nav.projects') }}
          </RouterLink>
          <RouterLink to="/experts" class="py-2.5" @click="mobileOpen = false">
            {{ $t('nav.experts') }}
          </RouterLink>
          <RouterLink to="/expert/register" class="py-2.5" @click="mobileOpen = false">
            {{ $t('nav.expertRegister') }}
          </RouterLink>
          <RouterLink v-if="auth.isLoggedIn" to="/me" class="py-2.5" @click="mobileOpen = false">
            {{ $t('nav.me') }}
          </RouterLink>
          <button
            v-if="auth.isLoggedIn"
            type="button"
            class="py-2.5 text-left"
            @click="goLogout"
          >
            {{ $t('auth.logout') }}
          </button>
          <button v-else type="button" class="py-2.5 text-left" @click="goLogin">
            {{ $t('auth.login') }}
          </button>
        </nav>
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <footer class="mt-16 border-t border-line bg-white">
      <div class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p class="font-mono text-sm font-bold text-ink-950">SAMPLEPCB 재능마켓</p>
          <p class="mt-2 text-xs leading-relaxed text-tx-3">{{ $t('app.tagline') }}</p>
        </div>
        <div class="text-xs text-tx-3">
          <p class="mb-2 font-semibold text-tx-2">{{ $t('footer.market') }}</p>
          <ul class="space-y-1.5">
            <li>
              <RouterLink to="/projects" class="hover:text-copper-600">{{ $t('nav.projects') }}</RouterLink>
            </li>
            <li>
              <RouterLink to="/experts" class="hover:text-copper-600">{{ $t('nav.experts') }}</RouterLink>
            </li>
            <li>
              <RouterLink to="/request" class="hover:text-copper-600">{{ $t('nav.request') }}</RouterLink>
            </li>
            <li>
              <RouterLink to="/expert/register" class="hover:text-copper-600">
                {{ $t('nav.expertRegister') }}
              </RouterLink>
            </li>
          </ul>
        </div>
        <div class="text-[11px] leading-relaxed text-tx-3">
          {{ $t('footer.corp') }}
        </div>
      </div>
    </footer>
  </div>
</template>
