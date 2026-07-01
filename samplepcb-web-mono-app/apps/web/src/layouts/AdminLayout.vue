<script setup lang="ts">
import { useAuthStore } from '@sp/shared';
import { adminMenu } from '../admin/menu';

const auth = useAuthStore();
</script>

<template>
  <div class="flex min-h-screen bg-gray-50 text-gray-900">
    <!-- 좌측 사이드바 -->
    <aside class="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div class="border-b border-gray-200 px-5 py-4">
        <div class="flex items-center justify-between gap-2">
          <RouterLink to="/" class="text-lg font-bold text-blue-600">{{ $t('app.name') }}</RouterLink>
          <RouterLink
            to="/"
            class="rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            {{ $t('common.backToSite') }}
          </RouterLink>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">{{ $t('admin.title') }}</p>
      </div>
      <nav class="flex-1 space-y-1 p-3">
        <RouterLink
          v-for="item in adminMenu"
          :key="item.labelKey"
          :to="item.to"
          class="block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          active-class="bg-blue-50 text-blue-700"
        >
          {{ $t(item.labelKey) }}
        </RouterLink>
      </nav>
    </aside>

    <!-- 우측 콘텐츠 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-end border-b border-gray-200 bg-white px-6 py-3 text-sm"
      >
        <span v-if="auth.isLoggedIn" class="text-gray-700">
          {{ $t('auth.greeting', { nick: auth.me?.mbNick ?? '' }) }}
        </span>
      </header>
      <main class="flex-1 p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
