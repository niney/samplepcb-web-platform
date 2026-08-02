<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useTheme } from '../bom/useTheme';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';

const auth = useAuthStore();
const route = useRoute();
const { isDark, toggleTheme } = useTheme();
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 shadow-sm"
    >
      <div class="flex items-center gap-3">
        <RouterLink to="/" class="text-lg font-bold text-blue-600">{{ $t('app.name') }}</RouterLink>
        <RouterLink
          :to="{ name: 'bom' }"
          class="rounded-md px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
          active-class="bg-blue-50 text-blue-700"
        >
          {{ $t('nav.smartBom') }}
        </RouterLink>
        <RouterLink
          v-if="auth.me?.isAdmin"
          :to="{ name: 'admin' }"
          class="rounded-md border border-blue-200 px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
        >
          {{ $t('admin.title') }}
        </RouterLink>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="grid size-[30px] place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-blue-600"
          :aria-label="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
          :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
          @click="toggleTheme"
        >
          <svg v-if="isDark" viewBox="0 0 24 24" class="size-[17px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
          </svg>
          <svg v-else viewBox="0 0 24 24" class="size-[17px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" stroke-linejoin="round" />
          </svg>
        </button>
        <AppSiteHomeButton />
        <AppProfileMenu :show-bom="true" :show-admin="auth.me?.isAdmin === true" />
      </div>
    </header>

    <main :class="route.meta.wide === true ? 'mx-auto max-w-7xl px-6 py-8' : 'mx-auto max-w-3xl px-6 py-8'">
      <RouterView />
    </main>
  </div>
</template>
