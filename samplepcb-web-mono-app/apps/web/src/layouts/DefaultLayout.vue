<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';

const auth = useAuthStore();
const route = useRoute();
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
      <div class="text-sm">
        <span v-if="auth.isLoggedIn" class="text-gray-700">
          {{ $t('auth.greeting', { nick: auth.me?.mbNick ?? '' }) }}
          <span
            v-if="auth.me?.isAdmin"
            class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700"
          >
            {{ $t('auth.admin') }}
          </span>
        </span>
        <span v-else class="text-gray-400">{{ $t('auth.notLoggedIn') }}</span>
      </div>
    </header>

    <main :class="route.meta.wide === true ? 'mx-auto max-w-7xl px-6 py-8' : 'mx-auto max-w-3xl px-6 py-8'">
      <RouterView />
    </main>
  </div>
</template>
