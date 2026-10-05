<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isCustomerDeletableBomQuoteStatus } from '@sp/api-contract';
import type { BomQuoteSummaryType } from '@sp/api-contract';
import { ApiRequestError, useAuthStore } from '@sp/shared';
import { useBomQuote, useDeleteBomQuote, useMyBomQuotes, usePatchBomQuote } from '../bom/useBom';
import { useBomProcurementMode } from '../bom/useProcurementMode';
import { useBomPanels } from '../bom/usePanels';
import { useTheme } from '../bom/useTheme';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';
import { isPositiveBigIntId } from '../lib/route-ids';
import logoPartseyes from '../assets/bom/logo-partseyes.svg';
import icGlobe from '../assets/bom/ic-globe.svg';
// 크롬 아이콘은 어두운 크롬용(2751:19710 원본과 바이트 동일) — 활성 #4DAAFF·비활성 흰색,
// 글리프가 배경색으로 뚫린다.
import icFold from '../assets/bom/ic-fold-dark.svg';
import icMenuBomActive from '../assets/bom/ic-menu-bom-dark.svg';
import icMenuBomInactive from '../assets/bom/ic-menu-bom-inactive-dark.svg';
import icMenuSearchActive from '../assets/bom/ic-menu-search-active-dark.svg';
import icMenuSearchInactive from '../assets/bom/ic-menu-search-dark.svg';
import icMenuUploadActive from '../assets/bom/ic-menu-upload-dark.svg';
import icMenuUploadInactive from '../assets/bom/ic-menu-upload-inactive-dark.svg';
import icTrailSearchActive from '../assets/bom/ic-trail-search-active-dark.svg';
import icTrailSearchInactive from '../assets/bom/ic-trail-search-dark.svg';
import icFile from '../assets/bom/ic-file-dark.svg';
import icRecentSearch from '../assets/bom/ic-recent-search-dark.svg';
import promoZip from '../assets/bom/promo-zip.png';
import promoVideo from '../assets/bom/promo-video.png';

// 스마트 BOM 전용 앱 셸 — Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(2751:18829) 이식.
// 단일 모드: 크롬(상단바·좌우 사이드바)은 어둡고 본문은 밝다. 라이트/다크 전환은 없고,
// 관리자·파트너에서 고른 테마는 저장된 채로 이 셸에서만 무시된다(pinTheme).
// 미구현(표시만): 프로모 카드 링크, EN 언어 전환.

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// 사이드바 접기 — 좌(메뉴)/우(페이지별 우측 패널) 토글. 상세 페이지의 정보 패널
// (AI 분석결과·주문 정보·예상 견적)도 같은 rightOpen 을 공유한다(usePanels 싱글턴).
const { leftOpen, rightOpen, compactLeftOpen, compactRightOpen } = useBomPanels();

// 첫 렌더 전에 고정해야 저장된 다크 테마로 한 번 그려지지 않는다(index.html 부팅 스크립트와 같은 규칙).
const { pinTheme } = useTheme();
pinTheme('light');

// EN 언어 전환 — 시안 모양만 둔다. 누르면 준비 중 안내를 잠깐 띄운다.
const langNoticeOpen = ref(false);
let langNoticeTimer: ReturnType<typeof setTimeout> | undefined;
function showLangNotice(): void {
  langNoticeOpen.value = true;
  clearTimeout(langNoticeTimer);
  langNoticeTimer = setTimeout(() => {
    langNoticeOpen.value = false;
  }, 2000);
}

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
const deleteRecentQuote = useDeleteBomQuote();
const recentDeleteTarget = ref<BomQuoteSummaryType | null>(null);
const recentDeleteError = ref('');
const recentDeleteDialog = ref<HTMLElement | null>(null);
let recentDeleteOpener: HTMLElement | null = null;
let recentDeleteBodyOverflow = '';

const RECENT_DELETE_FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function recentDisplayName(quote: BomQuoteSummaryType): string {
  return quote.fileName ?? quote.title;
}

// 고객이 지울 수 있는 것은 작성 중뿐이다(계약 사전) — 취소 견적은 보존 기간 뒤 자동 삭제된다.
function canDeleteRecent(quote: BomQuoteSummaryType): boolean {
  return isCustomerDeletableBomQuoteStatus(quote.status);
}

function recentDeleteFocusableElements(): HTMLElement[] {
  const dialog = recentDeleteDialog.value;
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(RECENT_DELETE_FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

async function openRecentDelete(quote: BomQuoteSummaryType, event: MouseEvent): Promise<void> {
  if (!canDeleteRecent(quote)) return;
  recentDeleteOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  recentDeleteBodyOverflow = document.body.style.overflow;
  recentDeleteError.value = '';
  deleteRecentQuote.reset();
  recentDeleteTarget.value = quote;
  document.body.style.overflow = 'hidden';
  await nextTick();
  recentDeleteDialog.value?.focus();
}

async function closeRecentDelete(restoreFocus = true, force = false): Promise<void> {
  if (deleteRecentQuote.isPending.value && !force) return;
  recentDeleteTarget.value = null;
  recentDeleteError.value = '';
  document.body.style.overflow = recentDeleteBodyOverflow;
  const opener = recentDeleteOpener;
  recentDeleteOpener = null;
  if (!restoreFocus) return;
  await nextTick();
  opener?.focus();
}

async function confirmRecentDelete(): Promise<void> {
  const target = recentDeleteTarget.value;
  if (target === null) return;
  recentDeleteError.value = '';
  try {
    await deleteRecentQuote.mutateAsync(target.id);
    await closeRecentDelete(false, true);
    if (currentQuoteId.value === target.id) {
      await router.push({ name: 'bom' });
    }
    await list.refetch();
  } catch (reason) {
    recentDeleteError.value = reason instanceof ApiRequestError
      ? reason.message
      : '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

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
  clearTimeout(langNoticeTimer);
  pinTheme(null);
  if (recentDeleteTarget.value !== null) document.body.style.overflow = recentDeleteBodyOverflow;
});

const currentQuoteId = computed(() => (
  isPositiveBigIntId(route.params.id) ? route.params.id : null
));
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
  if (recentDeleteTarget.value !== null) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!deleteRecentQuote.isPending.value) void closeRecentDelete();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = recentDeleteDialog.value;
    if (dialog === null) return;
    const focusable = recentDeleteFocusableElements();
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
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
    <!-- top (2751:19786) — 어두운 크롬 -->
    <header data-theme="dark" class="relative z-10 flex h-[58px] shrink-0 items-center border-b border-bom-chrome-border bg-bom-chrome">
      <!-- 작은 화면에서는 프로필까지 한 줄에 남기고, sm 이상에서 시안의 220px 정렬을 복원한다. -->
      <div class="flex w-[176px] shrink-0 items-center pl-[12px] sm:w-[220px] sm:pl-[24px]">
        <RouterLink :to="{ name: 'bom' }" class="relative top-[1.5px] block h-[26px] w-[150px] shrink-0">
          <img :src="logoPartseyes" alt="Parts Eyes" class="size-full">
        </RouterLink>
      </div>
      <div class="h-[30px] w-px bg-bom-chrome-border" />
      <button
        type="button"
        class="ml-[11px] grid size-[26px] place-items-center rounded-md hover:bg-surface-raised"
        :title="effectiveLeftOpen ? '사이드바 접기' : '사이드바 펼치기'"
        :aria-expanded="effectiveLeftOpen"
        aria-controls="bom-left-navigation"
        @click="toggleLeftPanel"
      >
        <img :src="icFold" alt="" class="size-[18px] transition-transform" :class="effectiveLeftOpen ? '' : '-scale-x-100'">
      </button>
      <AppSiteHomeButton variant="bom" class="ml-[12px] shrink-0" />
      <!-- 견적별 조달 모드 — 기술 적합성은 동일하고 양산에서만 안전한 Reel 구매 조건을 우선한다. -->
      <button
        type="button"
        role="switch"
        class="relative ml-[24px] hidden h-[36px] w-[111px] shrink-0 rounded-[48px] border border-bom-mode-border bg-bom-mode-bg font-noto disabled:cursor-not-allowed disabled:opacity-50 sm:block"
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

      <!-- 중앙 태그라인 (2282:79899) — 접힘 시안(2282:54200)에서 뷰포트 정중앙이라 left-1/2 고정.
           1280px 미만은 좌측 그룹(로고~조달 스위치 ≈400px)과 겹쳐 숨긴다. -->
      <p class="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-noto text-[18px] font-medium leading-[24px] text-ink-soft min-[1280px]:block">
        AI 기반 전자부품 검색 엔진
      </p>

      <!-- 우측 묶음(2751:19825·19788·19799) — 패널 접기 → 프로필(24px) → EN(16px). 시안의 테마
           전환 아이콘(19810)은 단일 모드라 두지 않는다. -->
      <div class="ml-auto flex items-center gap-[8px] pr-[8px] sm:gap-[16px] sm:pr-[18px]">
        <button
          type="button"
          class="hidden size-[26px] place-items-center rounded-md hover:bg-surface-raised min-[1280px]:mr-[8px] min-[1280px]:grid"
          :title="effectiveRightOpen ? '패널 접기' : '패널 펼치기'"
          :aria-expanded="effectiveRightOpen"
          @click="toggleRightPanel"
        >
          <img :src="icFold" alt="" class="size-[18px] transition-transform" :class="effectiveRightOpen ? '-scale-x-100' : ''">
        </button>
        <AppProfileMenu variant="bom" :show-admin="auth.me?.isAdmin === true" />
        <div class="relative hidden sm:block">
          <button
            type="button"
            class="flex h-[32px] items-center gap-[2px] rounded-[6px] bg-white/10 px-[12px] font-noto text-[13px] font-medium text-[#f7f7f7] hover:bg-white/15"
            aria-describedby="bom-lang-notice"
            title="영문 화면 준비 중"
            @click="showLangNotice"
          >
            <img :src="icGlobe" alt="" class="size-[16px]">
            EN
          </button>
          <p
            v-show="langNoticeOpen"
            id="bom-lang-notice"
            role="status"
            class="absolute right-0 top-[calc(100%+8px)] z-[70] whitespace-nowrap rounded-lg bg-surface px-3 py-2 text-[12px] font-medium text-ink shadow-lg ring-1 ring-line"
          >
            영문 화면은 준비 중입니다
          </p>
        </div>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <div
        v-if="compactLeftOpen"
        class="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] min-[1600px]:hidden"
        aria-hidden="true"
        @click="closeCompactLeftPanel"
      />
      <!-- left side bar (2751:19710) — 어두운 크롬 -->
      <aside
        id="bom-left-navigation"
        data-theme="dark"
        :class="[
          compactLeftOpen ? 'flex' : 'hidden',
          leftOpen ? 'min-[1600px]:flex' : 'min-[1600px]:hidden',
        ]"
        class="fixed bottom-0 left-0 top-[58px] z-50 w-[220px] shrink-0 flex-col bg-bom-sidebar pt-[35px] shadow-[8px_0_28px_rgba(15,23,42,0.18)] min-[1600px]:static min-[1600px]:z-auto min-[1600px]:shadow-none"
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
        <button
          type="button"
          role="switch"
          class="mx-[12px] mb-4 flex h-10 w-[196px] shrink-0 items-center justify-between rounded-lg border border-bom-mode-border bg-bom-mode-bg px-3 text-xs text-bom-mode-inactive disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
          :aria-label="`조달 모드: ${procurementMode === 'sample' ? '샘플' : '양산'}`"
          :aria-checked="procurementMode === 'mass'"
          :disabled="procurementModeDisabled"
          @click="toggleProcurementMode"
        >
          <span>조달 모드</span>
          <strong class="rounded-full bg-bom-mode-active px-3 py-1 text-white">{{ procurementMode === 'sample' ? '샘플' : '양산' }}</strong>
          <span class="text-[10px]">전환</span>
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
            <div
              v-for="q in recent"
              :key="q.id"
              class="group relative h-[27px] shrink-0"
            >
              <RouterLink
                :to="{ name: 'bom-quote', params: { id: q.id } }"
                class="flex h-full items-center gap-[4px] rounded-[4px] border pl-[8px] pr-[32px]"
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
                <span class="truncate font-noto text-[12px] font-normal leading-[14px] text-bom-recent-text">{{ recentDisplayName(q) }}</span>
              </RouterLink>
              <button
                v-if="canDeleteRecent(q)"
                type="button"
                class="absolute right-[2px] top-[2px] z-10 grid size-[23px] place-items-center rounded-[4px] text-ink-faint transition hover:bg-rose-500/15 hover:text-rose-400 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400"
                :class="leftPanelWide ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100' : 'opacity-70'"
                :aria-label="`${recentDisplayName(q)} 삭제`"
                title="Recent file 삭제"
                @click.stop.prevent="openRecentDelete(q, $event)"
              >
                <svg viewBox="0 0 20 20" class="size-[16px]" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                  <path d="M4.75 6.25h10.5M8 3.75h4M6.25 6.25l.5 9h6.5l.5-9M8.25 8.5v4.5M11.75 8.5v4.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
            <p v-if="recent.length === 0" class="px-[8px] py-[6px] text-[12px] text-gray-400">아직 업로드한 BOM이 없습니다</p>
          </div>
          <div class="mt-1 h-[30px] w-[179px] shrink-0" style="margin-left: 21px">
            <RouterLink
              :to="{ name: 'bom-history' }"
              class="flex h-full items-center justify-between rounded-[4px] px-[8px] text-[12px] font-semibold text-brand hover:bg-surface-raised"
              :class="onHistory ? 'bg-surface-raised' : ''"
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

      <!-- right side bar (2751:18832) — 어두운 크롬 위에 밝은 프로모 카드(프로모 토큰은 다크 값이 없다).
           상세(bom-quote)에서는 페이지 자체 우측 패널(주문 정보·예상 견적)이 대신한다. -->
      <aside v-show="rightOpen && showLandingPromos" data-theme="dark" class="hidden w-[334px] shrink-0 flex-col gap-[12px] bg-bom-chrome px-[24px] pt-[24px] xl:flex">
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
  <Teleport to="body">
    <div v-if="recentDeleteTarget !== null" class="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4" @mousedown.self="closeRecentDelete()">
      <section
        ref="recentDeleteDialog"
        class="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl outline-none focus:ring-2 focus:ring-rose-200"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recent-delete-title"
        aria-describedby="recent-delete-description"
        tabindex="-1"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-500">Delete recent BOM</p>
            <h2 id="recent-delete-title" class="mt-1 truncate text-[18px] font-bold text-ink-strong" :title="recentDisplayName(recentDeleteTarget)">{{ recentDisplayName(recentDeleteTarget) }} 삭제</h2>
          </div>
          <button type="button" class="grid size-8 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100" aria-label="삭제 확인 닫기" :disabled="deleteRecentQuote.isPending.value" @click="closeRecentDelete()">×</button>
        </div>
        <p id="recent-delete-description" class="mt-4 text-[13px] leading-6 text-ink-muted">이 작업은 되돌릴 수 없으며 업로드한 원본 파일과 분석 결과가 함께 삭제됩니다.</p>
        <div v-if="recentDeleteError !== ''" class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-800" role="alert">
          <p class="font-bold">삭제를 완료하지 못했습니다.</p>
          <p>{{ recentDeleteError }}</p>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="h-9 rounded-lg border border-gray-300 px-4 text-[13px] font-semibold text-gray-600 hover:bg-gray-50" :disabled="deleteRecentQuote.isPending.value" @click="closeRecentDelete()">취소</button>
          <button type="button" class="h-9 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50" :disabled="deleteRecentQuote.isPending.value" @click="confirmRecentDelete">
            {{ deleteRecentQuote.isPending.value ? '삭제 중…' : recentDeleteError !== '' ? '다시 삭제 시도' : '삭제 확인' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
  <!-- 시안 대비 미구현 기능(리스트업): 프로모 카드 링크(튜토리얼/Gerber Eyes) —
       사이드바/패널 접기·단일 검색·프로필 메뉴는 구현됨 -->
</template>
