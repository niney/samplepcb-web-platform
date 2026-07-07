<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { loginUrl, logoutUrl, marketPath } from '../lib/auth-urls';

const auth = useAuthStore();
const route = useRoute();

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

function goLogout(): void {
  window.location.assign(logoutUrl(marketPath('/')));
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <RouterLink
          :to="{ name: 'home' }"
          class="text-lg font-extrabold tracking-tight text-slate-900"
        >
          {{ $t('app.name') }}
        </RouterLink>
        <div class="flex items-center gap-3 text-sm">
          <template v-if="auth.isLoggedIn">
            <span class="text-slate-600">{{
              $t('auth.greeting', { nick: auth.me?.mbNick ?? '' })
            }}</span>
            <button type="button" class="text-slate-500 hover:text-slate-900" @click="goLogout">
              {{ $t('auth.logout') }}
            </button>
          </template>
          <button v-else type="button" class="text-slate-500 hover:text-slate-900" @click="goLogin">
            {{ $t('auth.login') }}
          </button>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <footer class="border-t border-slate-200 bg-white">
      <div class="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-slate-400">
        {{ $t('app.tagline') }}
      </div>
    </footer>
  </div>
</template>
