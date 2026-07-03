<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@sp/shared';
import { adminMenu } from '../admin/menu';
import { useRfqCount } from '../admin/useAdminQuotes';

const auth = useAuthStore();

// "견적 관리" 메뉴의 견적 대기(rfq) 수 뱃지 — 관리자로 로그인했을 때만 조회
const { data: rfqCount } = useRfqCount(computed(() => auth.me?.isAdmin === true));
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
        <!-- exact-active 사용: 대시보드는 /admin 의 빈 경로 자식이라 기본(포함) 매칭으로는
             /admin/* 어디서나 활성 처리된다. 하위 상세 라우트가 생기면 항목별 매칭 재검토. -->
        <RouterLink
          v-for="item in adminMenu"
          :key="item.labelKey"
          :to="item.to"
          class="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          exact-active-class="bg-blue-50 text-blue-700"
        >
          <span>{{ $t(item.labelKey) }}</span>
          <span
            v-if="item.badge === 'rfqCount' && rfqCount !== undefined && rfqCount > 0"
            class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
          >
            {{ rfqCount }}
          </span>
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
