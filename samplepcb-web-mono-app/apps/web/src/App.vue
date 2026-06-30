<script setup lang="ts">
import { useAuthStore } from '@sp/shared';

const auth = useAuthStore();
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 shadow-sm"
    >
      <RouterLink to="/" class="text-lg font-bold text-blue-600">samplePCB</RouterLink>
      <div class="text-sm">
        <span v-if="auth.isLoggedIn" class="text-gray-700">
          {{ auth.me?.mbNick }} 님
          <span
            v-if="auth.me?.isAdmin"
            class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700"
          >
            관리자
          </span>
        </span>
        <span v-else class="text-gray-400">로그인하지 않음</span>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
