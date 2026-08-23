<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { usePartnerAccess } from '../partner/usePartnerAccess';
import { usePartnerBomWork, usePartnerPcbWork } from '../partner/usePartnerWork';
import { readPartnerModule, type PartnerModuleKey } from '../partner/partnerModule';
import {
  partnerCommonMenu,
  partnerModules,
  resolvePartnerModuleKey,
  type PartnerBadgeKey,
  type PartnerMenuItem,
} from '../partner/menu';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';
import AppThemeToggle from '../components/AppThemeToggle.vue';

// 협력사 포털 셸(포털 재설계 R3) — 관리자 콘솔 셸의 미러: 좌측 사이드바(모듈 메뉴 + 공통
// 그룹 + 배지) + 헤더(모듈 스위처·테마·프로필). 포털의 기존 방식(모듈 홈 = 오늘 할 일
// 카드, 진입 리졸버, 모듈 기억)은 그대로 두고 그 위에 "지도"를 얹는다(하이브리드).
// 모듈(BOM 부품/PCB 제작) 노출 근거는 서버 tracks(조직 capabilities)뿐이고, 소속·권한
// 판정은 서버(requirePartner)가 한다. 배지는 홈 카드와 같은 쿼리 캐시(usePartnerWork)를
// 구독하므로 숫자가 어긋나지 않고 추가 요청도 없다.

const auth = useAuthStore();
const route = useRoute();
const { data } = usePartnerAccess();
const mobileMenuOpen = ref(false);

const access = computed(() => data.value?.data ?? null);
const isPartner = computed(() => access.value?.isPartner === true);
const tracks = computed(() => access.value?.tracks ?? { bom: false, pcb: false, parts: false });
const partnerName = computed(() => access.value?.partnerName ?? null);
const ownedModules = computed(() =>
  partnerModules.filter((m) => isPartner.value && tracks.value[m.key]),
);
// 스위처는 고를 게 있을 때만(2트랙) — 1트랙 조직은 사이드바 상단의 모듈명이 정체성이다.
const showSwitcher = computed(() => ownedModules.value.length > 1);

const currentRouteName = computed(() => (typeof route.name === 'string' ? route.name : ''));
// 활성 모듈 = 라우트에서 파생(단일 진실). 리졸버·공통 영역(수금)처럼 모듈 밖 라우트에선
// 리졸버와 같은 규칙(기억값이 현재 트랙에 유효하면 그것, 아니면 보유 첫 모듈)으로 메뉴를 고른다.
const activeModuleKey = computed<PartnerModuleKey | null>(() => {
  const fromRoute = resolvePartnerModuleKey(currentRouteName.value);
  if (fromRoute !== null) return fromRoute;
  const remembered = readPartnerModule();
  if (remembered !== null && isPartner.value && tracks.value[remembered]) return remembered;
  return ownedModules.value[0]?.key ?? null;
});
const activeModule = computed(
  () => partnerModules.find((m) => m.key === activeModuleKey.value) ?? null,
);
// 보유하지 않은 모듈 URL 로 직접 들어온 경우 메뉴는 그 모듈을 그리지 않는다(홈이 안내).
const activeMenu = computed<PartnerMenuItem[]>(() =>
  activeModule.value !== null && isPartner.value && tracks.value[activeModule.value.key]
    ? activeModule.value.menu
    : [],
);
// 공통 영역 — 항목마다 노출 트랙이 다르다(수금=PCB 발주 대금, 보유 부품=part_sale).
const commonMenu = computed<PartnerMenuItem[]>(() =>
  isPartner.value
    ? partnerCommonMenu.filter(
        (item) => item.requiresTrack === undefined || tracks.value[item.requiresTrack],
      )
    : [],
);
const showCommon = computed(() => commonMenu.value.length > 0);

const menuRouteName = (to: RouteLocationRaw): string | null =>
  typeof to === 'object' && 'name' in to && typeof to.name === 'string' ? to.name : null;
const isMenuActive = (item: PartnerMenuItem): boolean =>
  menuRouteName(item.to) === currentRouteName.value ||
  item.activeRouteNames?.includes(currentRouteName.value) === true;

// 배지 — 트랙 있는 모듈만 켠다(트랙 없는 모듈의 목록은 부르지 않는다).
const bomEnabled = computed(() => isPartner.value && tracks.value.bom);
const pcbEnabled = computed(() => isPartner.value && tracks.value.pcb);
const bom = usePartnerBomWork(bomEnabled);
const pcb = usePartnerPcbWork(pcbEnabled);
const badgeValue = (badge: PartnerBadgeKey): number => {
  switch (badge) {
    case 'bomRfqsTodo':
      return bom.pendingRfqs.value.length;
    case 'bomPosTodo':
      return bom.toConfirm.value.length;
    case 'bomShipTodo':
      return bom.shipTodoCount.value;
    case 'pcbRfqsTodo':
      return pcb.pendingRfqs.value.length;
    case 'pcbPosTodo':
      return pcb.myTurnPos.value.length;
    case 'pcbShipTodo':
      return pcb.shipTodoCount.value;
    case 'pcbAsTodo':
      return pcb.pendingAsCount.value;
    case 'unpaid':
      return pcb.unpaidCount.value;
  }
};

// 모듈 색 = 포털의 정체성(BOM indigo / PCB teal / 공통 amber) — 각 화면의 버튼 색과 같은 결.
const MODULE_ACTIVE_CLS: Record<PartnerModuleKey, string> = {
  bom: 'bg-indigo-50 text-indigo-700',
  pcb: 'bg-teal-50 text-teal-700',
};
const SWITCH_ACTIVE_CLS: Record<PartnerModuleKey, string> = {
  bom: 'bg-surface text-indigo-700 shadow-sm',
  pcb: 'bg-surface text-teal-700 shadow-sm',
};
const COMMON_ACTIVE_CLS = 'bg-amber-50 text-amber-800';
const MENU_BASE_CLS =
  'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900';
const BADGE_CLS =
  'shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-700';

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  },
);
</script>

<template>
  <div class="relative flex min-h-screen bg-gray-50 text-gray-900">
    <button
      v-if="mobileMenuOpen"
      type="button"
      class="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
      :aria-label="$t('partner.shell.closeMenu')"
      @click="mobileMenuOpen = false"
    />

    <!-- 좌측 사이드바 — 데스크톱 고정, lg 미만은 드로어(관리자 셸 동형) -->
    <aside
      :class="mobileMenuOpen ? 'flex' : 'hidden lg:flex'"
      class="fixed inset-y-0 left-0 z-50 w-60 shrink-0 flex-col border-r border-gray-200 bg-surface shadow-2xl lg:static lg:z-auto lg:shadow-none"
    >
      <div class="border-b border-gray-200 px-5 py-4">
        <div class="flex items-center justify-between gap-2">
          <RouterLink :to="{ name: 'partner' }" class="text-lg font-bold text-blue-600">
            SAMPLEPCB
          </RouterLink>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-md text-lg text-gray-500 hover:bg-gray-100 lg:hidden"
            :aria-label="$t('partner.shell.closeMenu')"
            @click="mobileMenuOpen = false"
          >
            ×
          </button>
        </div>
        <p class="mt-0.5 text-xs text-gray-400">{{ $t('partner.title') }}</p>
        <p
          v-if="partnerName !== null"
          class="mt-1 truncate text-sm font-semibold text-gray-700"
          :title="partnerName"
        >
          {{ partnerName }}
        </p>
      </div>

      <nav class="flex-1 space-y-5 overflow-y-auto p-3" :aria-label="$t('partner.title')">
        <!-- 접근 판정 전 — 메뉴 자리를 비워 두지 않고 흔들림을 막는다 -->
        <div v-if="access === null" class="space-y-2 px-3 py-1" aria-hidden="true">
          <div v-for="i in 4" :key="i" class="h-4 animate-pulse rounded bg-gray-100" />
        </div>
        <template v-else>
          <div v-if="activeModule !== null && activeMenu.length > 0">
            <p class="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              {{ $t(activeModule.labelKey) }}
            </p>
            <div class="space-y-0.5">
              <RouterLink
                v-for="item in activeMenu"
                :key="item.labelKey"
                :to="item.to"
                :class="[MENU_BASE_CLS, isMenuActive(item) ? MODULE_ACTIVE_CLS[activeModule.key] : '']"
                :aria-current="isMenuActive(item) ? 'page' : undefined"
              >
                <span class="truncate">{{ $t(item.labelKey) }}</span>
                <span v-if="item.badge !== undefined && badgeValue(item.badge) > 0" :class="BADGE_CLS">
                  {{ badgeValue(item.badge) }}
                </span>
              </RouterLink>
            </div>
          </div>
          <!-- 공통 영역 — 모듈 소속이 아닌 화면(수금·보유 부품). 항목별 트랙 조건은 menu.ts -->
          <!-- 공통 영역 — 모듈 소속이 아닌 화면(현재 데이터는 PCB 발주 대금) -->
          <div v-if="showCommon">
            <p class="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              {{ $t('partner.common') }}
            </p>
            <div class="space-y-0.5">
              <RouterLink
                v-for="item in commonMenu"
                :key="item.labelKey"
                :to="item.to"
                :class="[MENU_BASE_CLS, isMenuActive(item) ? COMMON_ACTIVE_CLS : '']"
                :aria-current="isMenuActive(item) ? 'page' : undefined"
              >
                <span class="truncate">{{ $t(item.labelKey) }}</span>
                <span
                  v-if="item.badge !== undefined && badgeValue(item.badge) > 0"
                  :class="BADGE_CLS"
                  title="미수금이 남은 발주 수"
                >
                  {{ badgeValue(item.badge) }}
                </span>
              </RouterLink>
            </div>
          </div>
        </template>
      </nav>
    </aside>

    <!-- 우측: 헤더 + 본문 -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header
        class="flex min-w-0 items-center gap-2 border-b border-gray-200 bg-surface px-3 py-3 text-sm sm:px-6"
      >
        <button
          type="button"
          class="grid size-9 shrink-0 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 lg:hidden"
          :aria-label="$t('partner.shell.openMenu')"
          :aria-expanded="mobileMenuOpen"
          @click="mobileMenuOpen = true"
        >
          <svg viewBox="0 0 20 20" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke-linecap="round" />
          </svg>
        </button>

        <!-- 모듈 스위처 — 2트랙 조직만. 활성 모듈은 라우트 파생(클릭 = 모듈 홈) -->
        <nav
          v-if="showSwitcher"
          class="flex min-w-0 overflow-x-auto rounded-lg border border-gray-200 bg-surface-sunken p-0.5 text-xs font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          :aria-label="$t('partner.shell.modules')"
        >
          <RouterLink
            v-for="mod in ownedModules"
            :key="mod.key"
            :to="mod.homeTo"
            class="whitespace-nowrap rounded-md px-3 py-1.5"
            :class="activeModuleKey === mod.key ? SWITCH_ACTIVE_CLS[mod.key] : 'text-gray-500 hover:text-gray-800'"
          >
            {{ $t(mod.labelKey) }}
          </RouterLink>
        </nav>
        <!-- 1트랙·좁은 화면 — 드로어가 닫혀 있어도 어느 모듈인지 헤더가 말한다 -->
        <p
          v-else-if="activeModule !== null && activeMenu.length > 0"
          class="truncate text-sm font-semibold text-gray-700 lg:hidden"
        >
          {{ $t(activeModule.labelKey) }}
        </p>

        <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <!-- 테마 전환 — 관리자·BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
          <AppThemeToggle />
          <AppSiteHomeButton />
          <AppProfileMenu :show-admin="auth.me?.isAdmin === true" />
        </div>
      </header>

      <!-- 본문 — 관리자와 같이 좌측 정렬(가운데 띄우지 않음)하되, 초광폭에서 줄이 무한정 길어지지
           않게 최대 너비만 건다(1440px — 사이드바 240+여백 48 을 더해도 1920 안, 보내기 보드 2열 충분).
           사용자 결정 2026-08-22. -->
      <main class="min-w-0 flex-1 p-3 sm:p-6">
        <div class="max-w-[1440px]">
          <!-- 배제·미승인 계정은 **어느 경로로 들어와도** 이유를 본다(여정 13호 S4).
               안내는 /partner 진입 리졸버에만 있어서, 메일 딥링크로 하위 화면(발주 상세·
               A/S 등)에 바로 들어온 협력사는 셸만 뜬 빈 화면을 봤다 — 서버는 403 을 주는데
               화면에는 아무 설명이 없어 "무엇이 잘못됐는지" 알 길이 없었다. -->
          <div
            v-if="access !== null && !access.isPartner"
            class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
          >
            <p class="font-semibold">포털을 이용할 수 없는 계정입니다.</p>
            <p class="mt-1">
              거래가 중지되었거나 아직 승인되지 않은 조직입니다 — 진행 중인 건은 샘플피씨비
              담당자가 대신 처리합니다. 문의는 담당자에게 부탁드립니다.
            </p>
          </div>
          <RouterView v-else />
        </div>
      </main>
    </div>
  </div>
</template>
