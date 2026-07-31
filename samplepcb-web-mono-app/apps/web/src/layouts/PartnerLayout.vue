<script setup lang="ts">
import { useAuthStore } from '@sp/shared';
import { useTheme } from '../bom/useTheme';

// 협력사 포털 경량 셸(docs/SMARTBOM_PARTNER_RFQ.md §4) — 관리자 셸과 분리된
// 단일 목적 레이아웃. 소속·권한 판정은 서버(requirePartner)가 한다.

const auth = useAuthStore();
const { isDark, toggleTheme } = useTheme();
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header class="border-b border-gray-200 bg-surface">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <RouterLink :to="{ name: 'partner' }" class="text-lg font-bold text-blue-600">
          SAMPLEPCB <span class="text-sm font-semibold text-gray-500">파트너 포털</span>
        </RouterLink>
        <div class="flex items-center gap-3 text-sm">
          <span v-if="auth.isLoggedIn" class="text-gray-700">
            {{ auth.me?.mbNick ?? '' }}님
          </span>
          <a href="/" class="rounded-md border border-gray-200 px-2 py-0.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            사이트로
          </a>
          <!-- 테마 전환 — 관리자·BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
          <button
            type="button"
            class="grid size-[30px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
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
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
