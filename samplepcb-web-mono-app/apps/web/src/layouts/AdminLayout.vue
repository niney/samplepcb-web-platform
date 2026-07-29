<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { adminModules, resolveAdminModuleKey } from '../admin/menu';
import { useRfqCount } from '../admin/useAdminQuotes';
import { useTheme } from '../bom/useTheme';

const auth = useAuthStore();
const route = useRoute();
const contentFlush = computed(() => route.meta.adminContentFlush === true);
const currentRouteName = computed(() => (typeof route.name === 'string' ? route.name : ''));
const { isDark, toggleTheme } = useTheme();

// 활성 모듈 = 현재 라우트에서 순수 파생(단일 진실) — 북마크/새로고침 진입에도 안전.
// localStorage 는 "마지막 사용 모듈" 기억용 기록만(후속: 진입 리다이렉트에 활용 가능).
const MODULE_STORAGE_KEY = 'sp:admin-module';
const activeModuleKey = computed(() => resolveAdminModuleKey(currentRouteName.value));
const activeModule = computed(
  () => adminModules.find((m) => m.key === activeModuleKey.value) ?? adminModules[0],
);
watch(activeModuleKey, (key) => {
  try {
    localStorage.setItem(MODULE_STORAGE_KEY, key);
  } catch {
    /* 프라이빗 모드 등 저장 불가 환경 무시 */
  }
});

// "견적 관리" 메뉴의 견적 대기(rfq) 수 뱃지 — 관리자로 로그인했을 때만 조회
const { data: rfqCount } = useRfqCount(computed(() => auth.me?.isAdmin === true));
</script>

<template>
  <div
    class="flex bg-gray-50 text-gray-900"
    :class="contentFlush ? 'h-screen overflow-hidden' : 'min-h-screen'"
  >
    <!-- 좌측 사이드바 -->
    <aside class="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-surface">
      <div class="border-b border-gray-200 px-5 py-4">
        <div class="flex items-center justify-between gap-2">
          <RouterLink to="/" class="text-lg font-bold text-blue-600">{{ $t('app.name') }}</RouterLink>
          <!-- sp-php 메인(도메인 루트 = 그누보드 홈)으로 전체 이동. sp-vue 메인(/app)은 당분간
               사용 안 하므로 RouterLink(SPA 내부)가 아니라 일반 앵커로 풀 내비게이션. -->
          <a
            href="/"
            class="rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            {{ $t('common.backToSite') }}
          </a>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">{{ $t('admin.title') }}</p>
      </div>
      <nav class="flex-1 space-y-1 p-3">
        <!-- exact-active 사용: 대시보드는 /admin 의 빈 경로 자식이라 기본(포함) 매칭으로는
             /admin/* 어디서나 활성 처리된다. 상세 형제 라우트는 activeRouteNames 로 보완. -->
        <RouterLink
          v-for="item in activeModule?.menu ?? []"
          :key="item.labelKey"
          :to="item.to"
          class="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          :class="item.activeRouteNames?.includes(currentRouteName) === true ? 'bg-blue-50 text-blue-700' : ''"
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
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between border-b border-gray-200 bg-surface px-6 py-3 text-sm"
      >
        <!-- 모듈 스위처 — 활성 모듈은 라우트에서 파생(클릭 = 모듈 홈 이동).
             확장 자리(PCB주문·PCBA주문·기술개발)는 모듈이 실제로 생길 때 추가. -->
        <nav class="flex rounded-lg border border-gray-200 bg-surface-sunken p-0.5 text-xs font-semibold">
          <RouterLink
            v-for="mod in adminModules"
            :key="mod.key"
            :to="mod.homeTo"
            class="rounded-md px-3 py-1.5"
            :class="activeModuleKey === mod.key
              ? 'bg-surface text-blue-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-800'"
          >
            {{ $t(mod.labelKey) }}
          </RouterLink>
        </nav>
        <span v-if="auth.isLoggedIn" class="text-gray-700">
          {{ $t('auth.greeting', { nick: auth.me?.mbNick ?? '' }) }}
        </span>
        <!-- 테마 전환 — BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
        <button
          type="button"
          class="ml-3 grid size-[30px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
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
      </header>
      <main v-if="contentFlush" class="min-h-0 flex-1 overflow-hidden bg-surface-sunken p-[10px]">
        <div class="h-full overflow-hidden rounded-[12px] bg-surface shadow-sm">
          <RouterView />
        </div>
      </main>
      <main v-else class="flex-1 p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
