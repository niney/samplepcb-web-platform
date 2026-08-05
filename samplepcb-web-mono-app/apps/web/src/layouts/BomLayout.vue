<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useBomQuote, useMyBomQuotes, usePatchBomQuote } from '../bom/useBom';
import { useBomProcurementMode } from '../bom/useProcurementMode';
import { useBomPanels } from '../bom/usePanels';
import { useTheme } from '../bom/useTheme';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';
import logoPartseyes from '../assets/bom/logo-partseyes.svg';
import icFold from '../assets/bom/ic-fold.svg';
import icMenuBomActive from '../assets/bom/ic-menu-bom.svg';
import icMenuBomInactive from '../assets/bom/ic-menu-bom-inactive.svg';
import icMenuSearchActive from '../assets/bom/ic-menu-search-active.svg';
import icMenuSearchInactive from '../assets/bom/ic-menu-search.svg';
import icMenuUploadActive from '../assets/bom/ic-menu-upload.svg';
import icMenuUploadInactive from '../assets/bom/ic-menu-upload-inactive.svg';
import icTrailSearchActive from '../assets/bom/ic-trail-search-active.svg';
import icTrailSearchInactive from '../assets/bom/ic-trail-search.svg';
import icFile from '../assets/bom/ic-file.svg';
import icRecentSearch from '../assets/bom/ic-recent-search.svg';
import promoZip from '../assets/bom/promo-zip.png';
import promoVideo from '../assets/bom/promo-video.png';

// 스마트 BOM 전용 앱 셸 — Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(87:9037) 이식.
// 시안의 다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환, 구조·치수는 동일.
// 미구현(표시만): 프로모 카드 링크.

const route = useRoute();
const auth = useAuthStore();

// 사이드바 접기 — 좌(메뉴)/우(페이지별 우측 패널) 토글. 상세 페이지의 정보 패널
// (AI 분석결과·주문 정보·예상 견적)도 같은 rightOpen 을 공유한다(usePanels 싱글턴).
const { leftOpen, rightOpen, compactLeftOpen, compactRightOpen } = useBomPanels();
const { isDark, toggleTheme } = useTheme();

// 1600px 미만에서는 좌측 탐색을 먼저 드로어로 전환해 표와 우측 분석 패널에 공간을 준다.
// 우측 정보 패널은 1280px까지 본문에 유지하고, 그 미만에서만 드로어/바텀시트가 된다.
const leftPanelWideMedia = window.matchMedia('(min-width: 1600px)');
const rightPanelWideMedia = window.matchMedia('(min-width: 1280px)');
const leftPanelWide = ref(leftPanelWideMedia.matches);
const rightPanelWide = ref(rightPanelWideMedia.matches);
const compactLeftCloseButton = ref<HTMLButtonElement | null>(null);
const onLeftPanelWideChange = (event: MediaQueryListEvent): void => {
  leftPanelWide.value = event.matches;
  if (event.matches) compactLeftOpen.value = false;
};
const onRightPanelWideChange = (event: MediaQueryListEvent): void => {
  rightPanelWide.value = event.matches;
  if (event.matches) compactRightOpen.value = false;
};

// Recent file — 남은 사이드바 높이에 맞춰 최신 견적을 최대한 채우고, 전체 이력 화면 진입점은 항상 유지한다.
const list = useMyBomQuotes(ref(1), computed(() => auth.isLoggedIn), { pageSize: 50 });
const recentViewport = ref<HTMLElement | null>(null);
const recentCapacity = ref(4);
const RECENT_ROW_HEIGHT = 27;
const RECENT_ROW_GAP = 2;
let recentResizeObserver: ResizeObserver | null = null;

const recent = computed(() => (list.data.value?.data.items ?? []).slice(0, recentCapacity.value));
const recentTotal = computed(() => list.data.value?.data.total ?? 0);

onMounted(() => {
  leftPanelWideMedia.addEventListener('change', onLeftPanelWideChange);
  rightPanelWideMedia.addEventListener('change', onRightPanelWideChange);
  window.addEventListener('keydown', onShellPanelKeydown);
  recentResizeObserver = new ResizeObserver(([entry]) => {
    if (entry === undefined || entry.contentRect.height <= 0) return;
    recentCapacity.value = Math.max(
      1,
      Math.floor((entry.contentRect.height + RECENT_ROW_GAP) / (RECENT_ROW_HEIGHT + RECENT_ROW_GAP)),
    );
  });
  if (recentViewport.value !== null) recentResizeObserver.observe(recentViewport.value);
});

onBeforeUnmount(() => {
  leftPanelWideMedia.removeEventListener('change', onLeftPanelWideChange);
  rightPanelWideMedia.removeEventListener('change', onRightPanelWideChange);
  window.removeEventListener('keydown', onShellPanelKeydown);
  recentResizeObserver?.disconnect();
});

const currentQuoteId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));
const currentQuote = useBomQuote(currentQuoteId);
const patchQuote = usePatchBomQuote();
const { preferredMode, setPreferredMode } = useBomProcurementMode();
const procurementMode = computed(() =>
  currentQuoteId.value === null
    ? preferredMode.value
    : currentQuote.data.value?.data.procurementMode ?? preferredMode.value,
);
const procurementModeDisabled = computed(() => {
  if (patchQuote.isPending.value) return true;
  if (currentQuoteId.value === null) return false;
  const quote = currentQuote.data.value?.data;
  return quote?.status !== 'draft'
    || quote.buildStatus !== 'ready'
    || quote.enrichStatus === 'searching';
});

async function toggleProcurementMode(): Promise<void> {
  if (procurementModeDisabled.value) return;
  const next = procurementMode.value === 'sample' ? 'mass' : 'sample';
  if (currentQuoteId.value === null) {
    setPreferredMode(next);
    return;
  }
  try {
    await patchQuote.mutateAsync({
      quoteId: currentQuoteId.value,
      body: { procurementMode: next },
    });
    setPreferredMode(next);
  } catch {
    // 상세 캐시는 서버 응답 전 상태를 유지한다. 재시도는 같은 토글에서 가능하다.
  }
}

const onSearch = computed(() => route.name === 'bom-search');
const onHistory = computed(() => route.name === 'bom-history');
const onQuote = computed(() => route.name === 'bom-quote');
const onBomPrimary = computed(() => !onSearch.value && !onHistory.value);
const onSearchLanding = computed(() =>
  onSearch.value
  && (typeof route.query.q !== 'string' || route.query.q.trim() === ''),
);
const fullBleedContent = computed(() =>
  route.name === 'bom-quote' || (onSearch.value && !onSearchLanding.value),
);
const showLandingPromos = computed(() => route.name === 'bom' || onSearchLanding.value);
const effectiveLeftOpen = computed(() => (
  leftPanelWide.value ? leftOpen.value : compactLeftOpen.value
));
const effectiveRightOpen = computed(() => (
  onQuote.value && !rightPanelWide.value ? compactRightOpen.value : rightOpen.value
));

function closeCompactLeftPanel(): void {
  compactLeftOpen.value = false;
}

function toggleLeftPanel(): void {
  if (!leftPanelWide.value) {
    compactRightOpen.value = false;
    compactLeftOpen.value = !compactLeftOpen.value;
    return;
  }
  leftOpen.value = !leftOpen.value;
}

function toggleRightPanel(): void {
  compactLeftOpen.value = false;
  if (onQuote.value && !rightPanelWide.value) {
    compactRightOpen.value = !compactRightOpen.value;
    return;
  }
  rightOpen.value = !rightOpen.value;
}

function onShellPanelKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !compactLeftOpen.value) return;
  event.preventDefault();
  closeCompactLeftPanel();
}

watch(compactLeftOpen, (active) => {
  if (active) void nextTick(() => compactLeftCloseButton.value?.focus());
});

watch(onQuote, (active) => {
  if (!active) compactRightOpen.value = false;
});
watch(() => route.fullPath, () => {
  compactLeftOpen.value = false;
});
</script>

<template>
  <!-- 앱형 고정 레이아웃 — 문서 스크롤 없이 각 영역(테이블·패널)이 내부 스크롤한다 -->
  <div class="bom-app flex h-screen flex-col overflow-hidden bg-bom-chrome text-ink-strong [font-family:Pretendard,'Noto_Sans_KR',system-ui,sans-serif]">
    <!-- top (87:9560) — 시안 다크 → 라이트 치환 -->
    <header class="relative z-10 flex h-[58px] shrink-0 items-center border-b border-bom-chrome-border bg-bom-chrome">
      <!-- 로고 블록은 시안처럼 사이드바 폭(220px)과 정렬 — 구분선이 경계에 온다 -->
      <div class="flex w-[220px] shrink-0 items-center pl-[24px]">
        <RouterLink :to="{ name: 'bom' }" class="relative top-[1.5px] block h-[26px] w-[150px] shrink-0">
          <img :src="logoPartseyes" alt="Parts Eyes" class="size-full">
        </RouterLink>
      </div>
      <div class="h-[30px] w-px bg-bom-chrome-border" />
      <button
        type="button"
        class="ml-[12px] grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
        :title="effectiveLeftOpen ? '사이드바 접기' : '사이드바 펼치기'"
        :aria-expanded="effectiveLeftOpen"
        aria-controls="bom-left-navigation"
        @click="toggleLeftPanel"
      >
        <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="effectiveLeftOpen ? '' : '-scale-x-100'">
      </button>
      <!-- 견적별 조달 모드 — 기술 적합성은 동일하고 양산에서만 안전한 Reel 구매 조건을 우선한다. -->
      <button
        type="button"
        role="switch"
        class="relative ml-[26px] h-[36px] w-[111px] shrink-0 rounded-[48px] border border-bom-mode-border bg-bom-mode-bg font-noto disabled:cursor-not-allowed disabled:opacity-50"
        :aria-label="procurementMode === 'sample' ? '샘플' : '양산'"
        :aria-checked="procurementMode === 'mass'"
        :disabled="procurementModeDisabled"
        :title="procurementMode === 'sample'
          ? '샘플 모드: 실효 구매가 우선'
          : '양산 모드: 구매 가능한 Reel 포장 우선'"
        @click="toggleProcurementMode"
      >
        <span
          class="absolute flex items-center justify-center whitespace-nowrap text-center text-[14px] leading-[24px]"
          :class="procurementMode === 'sample'
            ? 'left-[2px] top-[2px] h-[30px] w-[54px] rounded-[38px] bg-bom-mode-active font-bold text-white'
            : 'left-[13px] top-[5px] h-[24px] w-[26px] font-medium text-bom-mode-inactive'"
        >샘플</span>
        <span
          class="absolute flex items-center justify-center whitespace-nowrap text-center text-[14px] leading-[24px]"
          :class="procurementMode === 'mass'
            ? 'left-[53px] top-[2px] h-[30px] w-[54px] rounded-[38px] bg-bom-mode-active font-bold text-white'
            : 'left-[70px] top-[5px] h-[24px] w-[26px] font-medium text-bom-mode-inactive'"
        >양산</span>
      </button>

      <div class="ml-auto flex items-center gap-[12px] pr-[18px]">
        <!-- 테마 전환 — 고르기 전까지는 OS 설정을 따르고, 한 번 고르면 그 선택이 유지된다 -->
        <button
          type="button"
          class="grid size-[32px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
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
        <AppProfileMenu :show-admin="auth.me?.isAdmin === true" />
        <button
          type="button"
          class="grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
          :title="effectiveRightOpen ? '패널 접기' : '패널 펼치기'"
          :aria-expanded="effectiveRightOpen"
          @click="toggleRightPanel"
        >
          <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="effectiveRightOpen ? '-scale-x-100' : ''">
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <div
        v-if="compactLeftOpen"
        class="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] min-[1600px]:hidden"
        aria-hidden="true"
        @click="closeCompactLeftPanel"
      />
      <!-- left side bar (87:9485) — 라이트 치환 -->
      <aside
        id="bom-left-navigation"
        :class="[
          compactLeftOpen ? 'flex' : 'hidden',
          leftOpen ? 'min-[1600px]:flex' : 'min-[1600px]:hidden',
        ]"
        class="fixed bottom-0 left-0 top-[58px] z-50 w-[220px] shrink-0 flex-col border-r border-bom-sidebar-border bg-bom-sidebar pt-[35px] shadow-[8px_0_28px_rgba(15,23,42,0.18)] min-[1600px]:static min-[1600px]:z-auto min-[1600px]:shadow-none"
        :role="compactLeftOpen ? 'dialog' : 'complementary'"
        :aria-modal="compactLeftOpen ? 'true' : undefined"
        aria-label="BOM 탐색 메뉴"
      >
        <button
          ref="compactLeftCloseButton"
          type="button"
          class="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-[18px] leading-none text-ink-muted hover:bg-surface-raised hover:text-ink-strong min-[1600px]:hidden"
          aria-label="BOM 탐색 메뉴 닫기"
          @click="closeCompactLeftPanel"
        >
          ×
        </button>
        <RouterLink :to="{ name: 'bom' }" class="relative mx-[12px] flex h-[45px] w-[196px] items-center rounded-[6px] pl-[12px] pr-[16px]" :class="onBomPrimary ? 'bg-bom-nav-active-bg' : 'hover:bg-surface-raised'">
          <span class="relative size-[18px] shrink-0" aria-hidden="true">
            <img :src="onBomPrimary ? icMenuBomActive : icMenuBomInactive" alt="" class="absolute left-[3px] top-[1.5px] h-[15px] w-[12.2px] max-w-none">
          </span>
          <span class="ml-[6px] font-sans text-[16px] font-medium leading-[19px]" :class="onBomPrimary ? 'text-bom-nav-active' : 'text-bom-nav-inactive'">BOM 분석</span>
          <img :src="onBomPrimary ? icMenuUploadActive : icMenuUploadInactive" alt="" class="absolute right-[16px] top-[16px] size-[14px]">
        </RouterLink>
        <RouterLink :to="{ name: 'bom-search' }" class="relative mx-[12px] flex h-[45px] w-[196px] items-center rounded-[6px] pl-[12px] pr-[16px]" :class="onSearch ? 'bg-bom-nav-active-bg' : 'hover:bg-surface-raised'">
          <span class="relative size-[18px] shrink-0" aria-hidden="true">
            <img :src="onSearch ? icMenuSearchActive : icMenuSearchInactive" alt="" class="absolute left-[3px] top-[1.5px] h-[15px] w-[12.2px] max-w-none">
          </span>
          <span class="ml-[6px] font-sans text-[16px] font-medium leading-[19px]" :class="onSearch ? 'text-bom-nav-active' : 'text-bom-nav-inactive'">단일 검색</span>
          <span class="absolute right-[16px] top-[15px] size-[14px] overflow-hidden" aria-hidden="true">
            <img :src="onSearch ? icTrailSearchActive : icTrailSearchInactive" alt="" class="absolute left-[0.4px] top-[0.4px] h-[13.2001px] w-[13.2002px] max-w-none">
          </span>
        </RouterLink>

        <section class="mt-[30px] flex min-h-0 flex-1 flex-col pb-4">
          <p class="h-[16px] pl-[21px] font-noto text-[13px] font-bold leading-[16px] text-bom-nav-heading">Recent file</p>
          <div ref="recentViewport" class="mt-[16px] flex min-h-0 w-[179px] flex-1 flex-col gap-[2px] self-start overflow-hidden" style="margin-left: 21px">
            <RouterLink
              v-for="q in recent"
              :key="q.id"
              :to="{ name: 'bom-quote', params: { id: q.id } }"
              class="flex h-[27px] shrink-0 items-center gap-[4px] rounded-[4px] border px-[8px]"
              :class="currentQuoteId === q.id ? 'border-bom-recent-active-border bg-bom-recent-active-bg' : 'border-transparent hover:bg-surface-raised'"
            >
              <span class="relative size-[15px] shrink-0 opacity-60" aria-hidden="true">
                <img
                  v-if="q.sourceKind === 'single_search'"
                  :src="icRecentSearch"
                  alt=""
                  class="absolute left-[2.25px] top-[2.25px] size-[10.5px] max-w-none"
                >
                <img v-else :src="icFile" alt="" class="absolute left-[3px] top-[2px] h-[11px] w-[9px] max-w-none">
              </span>
              <span class="truncate font-noto text-[12px] font-normal leading-[14px] text-bom-recent-text">{{ q.fileName ?? q.title }}</span>
            </RouterLink>
            <p v-if="recent.length === 0" class="px-[8px] py-[6px] text-[12px] text-gray-400">아직 업로드한 BOM이 없습니다</p>
          </div>
          <div class="mt-1 h-[30px] w-[179px] shrink-0" style="margin-left: 21px">
            <RouterLink
              :to="{ name: 'bom-history' }"
              class="flex h-full items-center justify-between rounded-[4px] px-[8px] text-[12px] font-semibold text-brand hover:bg-blue-50"
              :class="onHistory ? 'bg-blue-50' : ''"
            >
              <span>모두 보기</span>
              <span class="tabular-nums text-ink-subtle">{{ recentTotal }}개 ›</span>
            </RouterLink>
          </div>
        </section>
      </aside>

      <!-- 중앙 콘텐츠 영역 (Rectangle 197) — 랜딩은 피그마의 평면 캔버스, 상세 화면은 기존 패널을 유지한다 -->
      <main class="min-h-0 min-w-0 flex-1" :class="fullBleedContent || showLandingPromos ? 'p-0' : 'p-[10px]'">
        <div
          class="h-full overflow-hidden"
          :class="fullBleedContent
            ? 'bg-bom-workbench'
            : showLandingPromos
              ? 'bg-bom-canvas'
              : 'rounded-[12px] bg-surface shadow-sm'"
        >
          <RouterView />
        </div>
      </main>

      <!-- right side bar (87:21445) — 라이트 치환, 프로모 카드는 시안(2282:60172) 좌표·색 그대로.
           상세(bom-quote)에서는 페이지 자체 우측 패널(주문 정보·예상 견적)이 대신한다. -->
      <aside v-show="rightOpen && showLandingPromos" class="hidden w-[334px] shrink-0 flex-col gap-[12px] px-[24px] pt-[24px] xl:flex">
        <!-- con01: Parts Eyes 튜토리얼 — 링크 미구현 -->
        <!-- 그라데이션은 /srgb 고정 — 피그마는 sRGB 보간이라 Tailwind v4 기본(oklab)과 중간톤이 어긋난다 -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-linear-to-l/srgb from-bom-promo-tuto-bg1 to-bom-promo-tuto-bg2 font-noto" title="튜토리얼 (준비 중)">
          <div class="absolute left-[152.23px] top-[7.49px] h-[143.23px] w-[141.15px] rounded-[10px] bg-linear-to-b/srgb from-bom-promo-tuto-glow1 to-bom-promo-tuto-glow2 blur-[10px]" />
          <!-- 아이콘 그림자는 box-shadow(사각 박스 halo)가 아니라 피그마처럼 알파 실루엣을 따르는 drop-shadow -->
          <img :src="promoZip" alt="" class="absolute left-[203.68px] top-[48.89px] size-[57.62px] rounded-[10px] drop-shadow-[0_4px_10px_rgba(89,129,208,0.4)]">
          <div class="absolute left-[224px] top-[19px] h-[18px] w-[44px] rounded-[10px] bg-bom-promo-badge shadow-[0px_0px_10px_var(--color-bom-promo-badge-glow)]">
            <span class="absolute left-[8.49px] top-[7.21px] h-[3.74px] w-[3.69px] rounded-full bg-bom-promo-pick blur-[4px]" />
            <span class="absolute left-[6px] top-[7px] size-[4px] rounded-full bg-bom-promo-pick" />
            <span class="absolute left-[13px] top-0 text-[10px] font-bold leading-[18px] text-bom-promo-pick">PICK</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px] font-medium">
            <p class="text-[11px] leading-[24px] text-bom-promo-tuto-title">Parts Eyes 이용 방법 튜토리얼</p>
            <p class="text-[12px] leading-[18px] text-bom-promo-ink">다양한 제조사의 전자부품을<br>파츠아이에서 빠르게 검색하세요</p>
          </div>
          <div class="pointer-events-none absolute inset-0 rounded-[10px] border border-bom-promo-line" />
        </div>
        <!-- con02: Gerber Eyes Online 3.0 — 링크 미구현. NEW 배지는 영상 아이콘 위에 얹혀
             backdrop-blur 로 모서리를 비추므로 img 뒤(DOM 순서)에 둔다. -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-linear-to-l/srgb from-bom-promo-video-bg1 to-bom-promo-video-bg2 font-noto" title="Gerber Eyes 소개 영상 (준비 중)">
          <div class="absolute left-[152.23px] top-[7.49px] h-[143.23px] w-[141.15px] rounded-[10px] bg-linear-to-b/srgb from-bom-promo-video-glow1 to-bom-promo-video-glow2 blur-[10px]" />
          <img :src="promoVideo" alt="" class="absolute left-[204.27px] top-[43.65px] size-[53.9px] rounded-[10px] drop-shadow-[0_4px_10px_rgba(183,183,183,0.5)]">
          <div class="absolute left-[188px] top-[35px] h-[18px] w-[35px] rounded-[10px] bg-[linear-gradient(125.617deg,var(--color-bom-promo-new-bg1)_0%,var(--color-bom-promo-new-bg2)_88.578%)] backdrop-blur-[10px]">
            <span class="absolute left-[6px] top-0 bg-[linear-gradient(121.608deg,#ff1e22_11.519%,#af002f_100%)] bg-clip-text text-[10px] font-bold leading-[18px] text-transparent">NEW</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px] font-medium">
            <p class="text-[11px] leading-[24px] text-[#e95e49]">Gerber Eyes Online 3.0 출시</p>
            <p class="text-[12px] leading-[18px] text-bom-promo-ink">영상을 통해 편리해진<br>DFM 분석 기능을 확인해 보세요</p>
          </div>
          <div class="pointer-events-none absolute inset-0 rounded-[10px] border border-bom-promo-line" />
        </div>
      </aside>
    </div>
  </div>
  <!-- 시안 대비 미구현 기능(리스트업): 프로모 카드 링크(튜토리얼/Gerber Eyes) —
       사이드바/패널 접기·단일 검색·프로필 메뉴는 구현됨 -->
</template>
