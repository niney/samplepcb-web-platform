<script setup lang="ts">
import { useAuthStore } from '@sp/shared';

// 협력사 포털 경량 셸(docs/SMARTBOM_PARTNER_RFQ.md §4) — 관리자 셸과 분리된
// 단일 목적 레이아웃. 소속·권한 판정은 서버(requirePartner)가 한다.

const auth = useAuthStore();
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header class="border-b border-gray-200 bg-surface">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <RouterLink :to="{ name: 'partner' }" class="text-lg font-bold text-blue-600">
          SAMPLEPCB <span class="text-sm font-semibold text-gray-500">파트너 포털</span>
        </RouterLink>
        <div class="flex items-center gap-3 text-sm">
          <span v-if="auth.isLoggedIn" class="text-gray-700">
            {{ auth.me?.mbNick ?? '' }}님
          </span>
          <a href="/" class="rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            사이트로
          </a>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
