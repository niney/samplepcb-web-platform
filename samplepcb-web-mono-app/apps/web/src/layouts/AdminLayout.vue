<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import type { RouteLocationRaw } from 'vue-router';
import { adminModules, resolveAdminModuleKey, type AdminMenuItem } from '../admin/menu';
import { useRfqCount } from '../admin/useAdminQuotes';
import { useBomOrdersAwaitingCount, useBomPosAwaitingCount } from '../admin/useAdminBomOrders';
import { useBomQuotesRequestedCount, useBomShipmentPendingCount } from '../admin/useAdminBomQuotes';
import { usePcbRfqPendingCount } from '../admin/useAdminPcbRfqs';
import { usePcbPoWorkCounts, usePcbShipmentPendingCount } from '../admin/useAdminPcbPos';
import { usePcbOrdersAwaitingCount } from '../admin/useAdminPcbOrders';
import { useAdminPcbTodoCounts } from '../admin/useAdminPcbCases';
import { useTheme } from '../bom/useTheme';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';

const auth = useAuthStore();
const route = useRoute();
const contentFlush = computed(() => route.meta.adminContentFlush === true);
const currentRouteName = computed(() => (typeof route.name === 'string' ? route.name : ''));

// Case 상세의 활성 메뉴 = 진입 워크큐(§6.12 ?from=)와 동기화 — 견적관리에서 들어온
// 상세는 견적관리가 켜져야 길을 잃지 않는다. from 없음(진행현황·북마크)=진행현황.
// PCB 모듈도 같은 규약(from=cases|rfqs|orders|pos|shipments) — 워크큐가 이미 ?from= 을
// 넘기고 있었는데 이 매핑이 SmartBOM 전용이라 어디서 들어와도 진행현황이 켜졌다.
const CASE_FROM_MENU: Record<string, Record<string, string>> = {
  'admin-smartbom-case': {
    quotes: 'admin-smartbom-quotes',
    orders: 'admin-smartbom-orders',
    pos: 'admin-smartbom-pos',
    logistics: 'admin-smartbom-logistics',
  },
  'admin-pcb-case': {
    cases: 'admin-pcb-cases',
    rfqs: 'admin-pcb-rfqs',
    orders: 'admin-pcb-orders',
    pos: 'admin-pcb-pos',
    shipments: 'admin-pcb-shipments',
  },
};
const effectiveRouteName = computed(() => {
  const map = CASE_FROM_MENU[currentRouteName.value];
  if (map === undefined) return currentRouteName.value;
  const from = route.query.from;
  return (typeof from === 'string' ? map[from] : undefined) ?? currentRouteName.value;
});
const menuRouteName = (to: RouteLocationRaw): string | null =>
  typeof to === 'object' && 'name' in to && typeof to.name === 'string' ? to.name : null;
const isMenuActive = (item: AdminMenuItem): boolean =>
  menuRouteName(item.to) === effectiveRouteName.value ||
  item.activeRouteNames?.includes(effectiveRouteName.value) === true;
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

// 메뉴 뱃지 데이터 — 관리자로 로그인했을 때만 조회. 역할별 메뉴마다 "지금 움직여야
// 하는 수" 하나: rfqCount=거버 견적 대기, bomQuotesRequested=BOM 검토 대기(견적관리),
// bomOrdersAwaiting=입금 대기(주문·결제), bomPosAwaiting=발주 대기(발주),
// bomShipmentPending=관리자 차례 선적(선적·배송, D22).
const isAdminUser = computed(() => auth.me?.isAdmin === true);
const { data: rfqCount } = useRfqCount(isAdminUser);
const { data: bomQuotesRequested } = useBomQuotesRequestedCount(isAdminUser);
const { data: bomOrdersAwaiting } = useBomOrdersAwaitingCount(isAdminUser);
const { data: bomPosAwaiting } = useBomPosAwaitingCount(isAdminUser);
const { data: bomShipmentPending } = useBomShipmentPendingCount(isAdminUser);
const { data: pcbRfqPending } = usePcbRfqPendingCount(isAdminUser);
const { eqPending: pcbEqPending, toShip: pcbToShip } = usePcbPoWorkCounts(isAdminUser);
const { data: pcbShipmentPending } = usePcbShipmentPendingCount(isAdminUser);
const { data: pcbOrdersAwaiting } = usePcbOrdersAwaitingCount(isAdminUser);
// PCB 대기 큐 — 각 역할이 "아직 시작하지 않은" 수(요청 대기·발주 대기).
const { todoRfq: pcbTodoRfq, todoPo: pcbTodoPo } = useAdminPcbTodoCounts(isAdminUser);
// PCB 배지는 합산이다 — SmartBOM 과 달리 시작 전(대기 큐)과 진행 중 내 차례가 모두
// 관리자 몫이라, 하나만 세면 나머지가 묻힌다("이 역할이 지금 움직여야 하는 수").
const badgeValue = (badge: NonNullable<AdminMenuItem['badge']>): number | undefined =>
  badge === 'rfqCount'
    ? rfqCount.value
    : badge === 'bomQuotesRequested'
      ? bomQuotesRequested.value
      : badge === 'bomOrdersAwaiting'
        ? bomOrdersAwaiting.value
        : badge === 'bomPosAwaiting'
          ? bomPosAwaiting.value
          : badge === 'pcbRfqPending'
            ? pcbTodoRfq.value + (pcbRfqPending.value ?? 0)
            : badge === 'pcbPosPending'
              ? pcbTodoPo.value + pcbEqPending.value
              : badge === 'pcbShipmentPending'
                ? pcbToShip.value + (pcbShipmentPending.value ?? 0)
                : badge === 'pcbOrdersAwaiting'
                  ? pcbOrdersAwaiting.value
                  : bomShipmentPending.value;
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
          :class="isMenuActive(item) ? 'bg-blue-50 text-blue-700' : ''"
          exact-active-class="bg-blue-50 text-blue-700"
        >
          <span>{{ $t(item.labelKey) }}</span>
          <span
            v-if="item.badge !== undefined && (badgeValue(item.badge) ?? 0) > 0"
            class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
          >
            {{ badgeValue(item.badge) }}
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
        <!-- 테마 전환 — BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="grid size-[30px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
            :aria-label="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
            :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
            @click="toggleTheme"
          >
            <svg v-if="isDark" viewBox="0 0 24 24" class="size-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="size-[22px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" stroke-linejoin="round" />
            </svg>
          </button>
          <AppSiteHomeButton />
          <AppProfileMenu :show-bom="true" />
        </div>
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
