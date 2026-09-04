<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import type { RouteLocationRaw } from 'vue-router';
import { adminModules, resolveAdminModuleKey, type AdminMenuItem } from '../admin/menu';
import { useRfqCount } from '../admin/useAdminQuotes';
import { useBomOrdersAwaitingCount, useBomPosAwaitingCount } from '../admin/useAdminBomOrders';
import { useBomQuotesRequestedCount, useBomShipmentPendingCount } from '../admin/useAdminBomQuotes';
import { usePcbRfqPendingCount } from '../admin/useAdminPcbRfqs';
import { usePcbPoWorkCounts, usePcbShipmentPendingCount } from '../admin/useAdminPcbPos';
import { usePcbOrdersAwaitingCount, usePcbOrdersToShipCount } from '../admin/useAdminPcbOrders';
import { usePcbRemittancePendingCount } from '../admin/useAdminPcbRemittances';
import { useAdminPcbTodoCounts } from '../admin/useAdminPcbCases';
import { useBomClaimsPendingCount } from '../admin/useAdminBomClaims';
import { usePcbClaimsPendingCount } from '../admin/useAdminPcbClaims';
import { useDevelopReceivedCount } from '../admin/useAdminDevelop';
import {
  pcbAdminEntryTo,
  pcbAdminSectionTo,
  readPcbAdminMemory,
  rememberPcbAdminView,
  resolvePcbAdminSection,
} from '../admin/pcb-navigation';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';
import AppThemeToggle from '../components/AppThemeToggle.vue';

const auth = useAuthStore();
const route = useRoute();
const mobileMenuOpen = ref(false);
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
    claims: 'admin-smartbom-claims',
  },
  'admin-pcb-case': {
    cases: 'admin-pcb-cases',
    rfqs: 'admin-pcb-rfqs',
    orders: 'admin-pcb-orders',
    pos: 'admin-pcb-pos',
    shipments: 'admin-pcb-shipments',
    remittances: 'admin-pcb-remittances',
    claims: 'admin-pcb-claims',
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

// 활성 모듈 = 현재 라우트에서 순수 파생(단일 진실) — 북마크/새로고침 진입에도 안전.
// localStorage 는 "마지막 사용 모듈" 기억용 기록만(후속: 진입 리다이렉트에 활용 가능).
const MODULE_STORAGE_KEY = 'sp:admin-module';
const activeModuleKey = computed(() => resolveAdminModuleKey(currentRouteName.value));
const activeModule = computed(
  () => adminModules.find((m) => m.key === activeModuleKey.value) ?? adminModules[0],
);
const pcbMemory = ref(readPcbAdminMemory(auth.me?.mbId));
watch(
  () => auth.me?.mbId,
  (mbId) => {
    pcbMemory.value = readPcbAdminMemory(mbId);
  },
);
watch(
  [currentRouteName, () => route.query.tab],
  ([routeName, rawTab]) => {
    const section = resolvePcbAdminSection(routeName);
    if (section === null) return;
    const tab = typeof rawTab === 'string' ? rawTab : undefined;
    pcbMemory.value = rememberPcbAdminView(auth.me?.mbId, section, tab);
  },
  { immediate: true },
);
const moduleTo = (moduleKey: string, fallback: RouteLocationRaw): RouteLocationRaw =>
  moduleKey === 'pcb' ? pcbAdminEntryTo(pcbMemory.value) : fallback;
const menuTo = (item: AdminMenuItem): RouteLocationRaw => {
  if (activeModuleKey.value !== 'pcb') return item.to;
  const routeName = menuRouteName(item.to);
  const section = routeName === null ? null : resolvePcbAdminSection(routeName);
  return section === null ? item.to : pcbAdminSectionTo(pcbMemory.value, section);
};
watch(activeModuleKey, (key) => {
  try {
    localStorage.setItem(MODULE_STORAGE_KEY, key);
  } catch {
    /* 프라이빗 모드 등 저장 불가 환경 무시 */
  }
});
watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  },
);

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
const { data: bomClaimsPending } = useBomClaimsPendingCount(isAdminUser);
const { data: pcbRfqPending } = usePcbRfqPendingCount(isAdminUser);
const { eqPending: pcbEqPending, toShip: pcbToShip } = usePcbPoWorkCounts(isAdminUser);
const { data: pcbShipmentPending } = usePcbShipmentPendingCount(isAdminUser);
const { data: pcbOrdersAwaiting } = usePcbOrdersAwaitingCount(isAdminUser);
// 고객 배송 대기(P4.6) — 입고확인이 끝났는데 od 가 배송 전인 주문(선적·배송 배지 합산분).
const { data: pcbCustomerToShip } = usePcbOrdersToShipCount(isAdminUser);
// 송금 대기 — 발주됐는데 한 푼도 안 나간 건(P3.11).
const pcbRemittancePending = usePcbRemittancePendingCount(isAdminUser);
// PCB 클레임(A/S 접수) — 접수+검토 중 관리자 미처리 건수(P5).
const { data: pcbClaimsPending } = usePcbClaimsPendingCount(isAdminUser);
// PCB 대기 큐 — 각 역할이 "아직 시작하지 않은" 수(요청 대기·발주 대기).
const { todoRfq: pcbTodoRfq, todoPo: pcbTodoPo } = useAdminPcbTodoCounts(isAdminUser);
// 개발의뢰 — 아직 검토를 시작하지 않은 접수 건(docs/DEVELOP_FLOW.md §7.3).
const { data: developReceived } = useDevelopReceivedCount(isAdminUser);
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
          : badge === 'bomClaimsPending'
            ? bomClaimsPending.value
          : badge === 'pcbRfqPending'
            ? pcbTodoRfq.value + (pcbRfqPending.value ?? 0)
            : badge === 'pcbPosPending'
              ? pcbTodoPo.value + pcbEqPending.value
              : badge === 'pcbShipmentPending'
                ? pcbToShip.value + (pcbShipmentPending.value ?? 0) + (pcbCustomerToShip.value ?? 0)
                : badge === 'pcbOrdersAwaiting'
                  ? pcbOrdersAwaiting.value
                  : badge === 'pcbRemittancePending'
                    ? pcbRemittancePending.value
                    : badge === 'pcbClaimsPending'
                      ? pcbClaimsPending.value
                      : badge === 'developReceived'
                        ? developReceived.value
                        : bomShipmentPending.value;
</script>

<template>
  <div
    class="relative flex bg-gray-50 text-gray-900"
    :class="contentFlush ? 'h-screen overflow-hidden' : 'min-h-screen'"
  >
    <button
      v-if="mobileMenuOpen"
      type="button"
      class="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
      aria-label="관리자 메뉴 닫기"
      @click="mobileMenuOpen = false"
    />
    <!-- 좌측 사이드바 -->
    <aside
      :class="mobileMenuOpen ? 'flex' : 'hidden lg:flex'"
      class="fixed inset-y-0 left-0 z-50 w-60 shrink-0 flex-col border-r border-gray-200 bg-surface shadow-2xl lg:static lg:z-auto lg:shadow-none"
    >
      <div class="border-b border-gray-200 px-5 py-4">
        <div class="flex items-center justify-between gap-2">
          <RouterLink to="/" class="text-lg font-bold text-blue-600">{{ $t('app.name') }}</RouterLink>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-md text-lg text-gray-500 hover:bg-gray-100 lg:hidden"
            aria-label="관리자 메뉴 닫기"
            @click="mobileMenuOpen = false"
          >
            ×
          </button>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">{{ $t('admin.title') }}</p>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto p-3">
        <!-- exact-active 사용: 대시보드는 /admin 의 빈 경로 자식이라 기본(포함) 매칭으로는
             /admin/* 어디서나 활성 처리된다. 상세 형제 라우트는 activeRouteNames 로 보완. -->
        <RouterLink
          v-for="item in activeModule?.menu ?? []"
          :key="item.labelKey"
          :to="menuTo(item)"
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
        class="flex min-w-0 items-center gap-2 border-b border-gray-200 bg-surface px-3 py-3 text-sm sm:px-6"
      >
        <button
          type="button"
          class="grid size-9 shrink-0 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 lg:hidden"
          aria-label="관리자 메뉴 열기"
          :aria-expanded="mobileMenuOpen"
          @click="mobileMenuOpen = true"
        >
          <svg viewBox="0 0 20 20" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke-linecap="round" />
          </svg>
        </button>
        <!-- 모듈 스위처 — 활성 모듈은 라우트에서 파생(클릭 = 모듈 홈 이동).
             확장 자리(PCB주문·PCBA주문·기술개발)는 모듈이 실제로 생길 때 추가. -->
        <nav class="flex min-w-0 overflow-x-auto rounded-lg border border-gray-200 bg-surface-sunken p-0.5 text-xs font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <RouterLink
            v-for="mod in adminModules"
            :key="mod.key"
            :to="moduleTo(mod.key, mod.homeTo)"
            class="rounded-md px-3 py-1.5"
            :class="activeModuleKey === mod.key
              ? 'bg-surface text-blue-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-800'"
          >
            {{ $t(mod.labelKey) }}
          </RouterLink>
        </nav>
        <!-- 테마 전환 — BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
        <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <AppThemeToggle icon-class="size-[22px]" />
          <AppSiteHomeButton />
          <AppProfileMenu :show-bom="true" />
        </div>
      </header>
      <main v-if="contentFlush" class="min-h-0 flex-1 overflow-hidden bg-surface-sunken p-[10px]">
        <div class="h-full overflow-hidden rounded-[12px] bg-surface shadow-sm">
          <RouterView />
        </div>
      </main>
      <main v-else class="min-w-0 flex-1 p-3 sm:p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
