<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useBomQuote, useMyBomQuotes, usePatchBomQuote } from '../bom/useBom';
import { useBomProcurementMode } from '../bom/useProcurementMode';
import { useBomPanels } from '../bom/usePanels';
import { useTheme } from '../bom/useTheme';
import logoIcon from '../assets/bom/logo-partseyes-icon.png';
import icProfile from '../assets/bom/ic-profile.svg';
import icFold from '../assets/bom/ic-fold.svg';
import icMenuBom from '../assets/bom/ic-menu-bom.svg';
import icMenuSearch from '../assets/bom/ic-menu-search.svg';
import icMenuUpload from '../assets/bom/ic-menu-upload.svg';
import icTrailSearch from '../assets/bom/ic-trail-search.svg';
import icFile from '../assets/bom/ic-file.svg';
import promoZip from '../assets/bom/promo-zip.png';
import promoVideo from '../assets/bom/promo-video.png';

// 스마트 BOM 전용 앱 셸 — Figma "Smart BOM_Web 2.0 / 01 BOM 업로드"(87:9037) 이식.
// 시안의 다크 배경(상단바·사이드바)은 사용자 결정으로 라이트 모드 치환, 구조·치수는 동일.
// 미구현(표시만): 프로필 메뉴·프로모 카드 링크.

const route = useRoute();
const auth = useAuthStore();

// 사이드바 접기 — 좌(메뉴)/우(페이지별 우측 패널) 토글. 상세 페이지의 정보 패널
// (AI 분석결과·주문 정보·예상 견적)도 같은 rightOpen 을 공유한다(usePanels 싱글턴).
const { leftOpen, rightOpen } = useBomPanels();
const { isDark, toggleTheme } = useTheme();

// Recent file — 남은 사이드바 높이에 맞춰 최신 견적을 최대한 채우고, 전체 이력 화면 진입점은 항상 유지한다.
const list = useMyBomQuotes(ref(1), computed(() => auth.isLoggedIn), { pageSize: 50 });
const recentViewport = ref<HTMLElement | null>(null);
const recentCapacity = ref(4);
const RECENT_ROW_HEIGHT = 30;
const RECENT_ROW_GAP = 2;
let recentResizeObserver: ResizeObserver | null = null;

const recent = computed(() => (list.data.value?.data.items ?? []).slice(0, recentCapacity.value));
const recentTotal = computed(() => list.data.value?.data.total ?? 0);

onMounted(() => {
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
const onBomPrimary = computed(() => !onSearch.value && !onHistory.value);
</script>

<template>
  <!-- 앱형 고정 레이아웃 — 문서 스크롤 없이 각 영역(테이블·패널)이 내부 스크롤한다 -->
  <div class="flex h-screen flex-col overflow-hidden bg-surface-sunken text-ink-strong [font-family:Pretendard,'Noto_Sans_KR',system-ui,sans-serif]">
    <!-- top (87:9560) — 시안 다크 → 라이트 치환 -->
    <header class="relative z-10 flex h-[58px] shrink-0 items-center border-b border-gray-200 bg-surface">
      <!-- 로고 블록은 시안처럼 사이드바 폭(220px)과 정렬 — 구분선이 경계에 온다 -->
      <div class="flex w-[220px] shrink-0 items-center pl-[24px]">
        <RouterLink :to="{ name: 'bom' }" class="flex items-center gap-[7px]">
          <img :src="logoIcon" alt="Parts Eyes" class="h-[26px] w-auto">
          <span class="text-[21px] font-bold tracking-tight text-ink-strong">Parts Eyes</span>
        </RouterLink>
      </div>
      <div class="h-[30px] w-px bg-gray-200" />
      <button
        type="button"
        class="ml-[12px] grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
        :title="leftOpen ? '사이드바 접기' : '사이드바 펼치기'"
        @click="leftOpen = !leftOpen"
      >
        <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="leftOpen ? '' : '-scale-x-100'">
      </button>
      <!-- 견적별 조달 모드 — 기술 적합성은 동일하고 양산에서만 안전한 Reel 오퍼를 우선한다. -->
      <button
        type="button"
        role="switch"
        class="relative ml-[26px] h-[36px] w-[80px] rounded-full bg-gradient-to-b from-surface-neutral to-surface shadow-[inset_0px_2px_0px_0px_var(--color-surface)] ring-1 ring-gray-200 transition disabled:cursor-not-allowed disabled:opacity-50"
        :aria-checked="procurementMode === 'mass'"
        :disabled="procurementModeDisabled"
        :title="procurementMode === 'sample'
          ? '샘플 모드: 실효 구매가 우선'
          : '양산 모드: 구매 가능한 Reel 포장 우선'"
        @click="toggleProcurementMode"
      >
        <span
          class="absolute top-1/2 -translate-y-1/2 text-[16px] font-extrabold"
          :class="procurementMode === 'sample'
            ? 'left-[9px] text-brand'
            : 'right-[9px] text-[#635bdb]'"
        >{{ procurementMode === 'sample' ? '샘플' : '양산' }}</span>
        <span
          class="absolute top-[4px] size-[28px] rounded-full shadow-[0px_2px_4px_rgba(30,120,220,0.45)] transition-all"
          :class="procurementMode === 'sample'
            ? 'right-[4px] bg-brand-soft'
            : 'left-[4px] bg-[#756cf3]'"
        />
      </button>

      <p class="absolute left-1/2 -translate-x-1/2 text-[18px] font-medium text-ink-subtle">AI 기반 전자부품 검색 엔진</p>

      <div class="ml-auto flex items-center gap-[12px] pr-[18px]">
        <!-- 테마 전환 — 고르기 전까지는 OS 설정을 따르고, 한 번 고르면 그 선택이 유지된다 -->
        <button
          type="button"
          class="grid size-[32px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
          :aria-label="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
          :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
          @click="toggleTheme"
        >
          <svg v-if="isDark" viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
          </svg>
          <svg v-else viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" stroke-linejoin="round" />
          </svg>
        </button>
        <!-- sp-php 도메인 루트 홈으로 이동 — /app 내부 라우트가 아닌 전체 페이지 이동 -->
        <a
          href="/"
          class="grid size-[32px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
          aria-label="홈으로 이동"
          title="홈으로 이동"
        >
          <svg viewBox="0 0 24 24" class="size-[19px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="m3.5 10.5 8.5-7 8.5 7" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <!-- 관리자 콘솔 진입 — 최고관리자(cf_admin)만 노출, BOM 작업 유지를 위해 새 창 -->
        <RouterLink
          v-if="auth.me?.isAdmin"
          :to="{ name: 'admin' }"
          target="_blank"
          rel="noopener"
          class="inline-flex h-[28px] items-center gap-[4px] rounded-md border border-line-brand px-[10px] text-[13px] font-semibold text-brand hover:bg-blue-50"
          title="관리자 페이지 (새 창)"
        >
          <span>관리자</span>
          <span aria-hidden="true" class="text-[11px] leading-none">↗</span>
        </RouterLink>
        <div
          class="flex size-[32px] items-center justify-center overflow-hidden rounded-full bg-ink-faint"
          :title="auth.me?.mbNick ?? ''"
        >
          <img :src="icProfile" alt="프로필" class="size-[32px]">
        </div>
        <button
          type="button"
          class="grid size-[26px] place-items-center rounded-md hover:bg-gray-100"
          :title="rightOpen ? '패널 접기' : '패널 펼치기'"
          @click="rightOpen = !rightOpen"
        >
          <img :src="icFold" alt="" class="size-[22px] transition-transform" :class="rightOpen ? '-scale-x-100' : ''">
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- left side bar (87:9485) — 라이트 치환 -->
      <aside v-show="leftOpen" class="hidden w-[220px] shrink-0 flex-col border-r border-gray-200 bg-surface pt-[36px] lg:flex">
        <RouterLink :to="{ name: 'bom' }" class="flex h-[45px] items-center pl-[21px] pr-[15px]" :class="onBomPrimary ? 'bg-surface-brand' : 'hover:bg-gray-50'">
          <img :src="icMenuBom" alt="" class="size-[18px]">
          <span class="ml-[6px] text-[16px] font-medium" :class="onBomPrimary ? 'text-brand-strong' : 'text-ink'">BOM 분석</span>
          <img :src="icMenuUpload" alt="" class="ml-auto size-[14px]">
        </RouterLink>
        <RouterLink :to="{ name: 'bom-search' }" class="flex h-[45px] items-center pl-[21px] pr-[15px]" :class="onSearch ? 'bg-surface-brand' : 'hover:bg-gray-50'">
          <img :src="icMenuSearch" alt="" class="size-[18px]">
          <span class="ml-[6px] text-[16px] font-medium" :class="onSearch ? 'text-brand-strong' : 'text-ink'">단일 검색</span>
          <img :src="icTrailSearch" alt="" class="ml-auto size-[14px]">
        </RouterLink>

        <section class="mt-[38px] flex min-h-0 flex-1 flex-col pb-4">
          <p class="pl-[21px] text-[13px] font-bold text-ink-faint">Recent file</p>
          <div ref="recentViewport" class="mt-[12px] flex min-h-0 w-[179px] flex-1 flex-col gap-[2px] self-start overflow-hidden" style="margin-left: 21px">
            <RouterLink
              v-for="q in recent"
              :key="q.id"
              :to="{ name: 'bom-quote', params: { id: q.id } }"
              class="flex h-[30px] shrink-0 items-center gap-[4px] rounded-[4px] border px-[8px]"
              :class="currentQuoteId === q.id ? 'border-line bg-surface-raised' : 'border-transparent hover:bg-gray-50'"
            >
              <img :src="icFile" alt="" class="size-[15px] opacity-60">
              <span class="truncate text-[12px] text-ink-subtle">{{ q.fileName ?? q.title }}</span>
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

      <!-- 중앙 흰 패널 (Rectangle 197) — 페이지가 내부 스크롤을 관리한다 -->
      <main class="min-h-0 min-w-0 flex-1 p-[10px]">
        <div class="h-full overflow-hidden rounded-[12px] bg-surface shadow-sm">
          <RouterView />
        </div>
      </main>

      <!-- right side bar (87:21445) — 라이트 치환, 프로모 카드는 시안 그대로.
           상세(bom-quote)에서는 페이지 자체 우측 패널(주문 정보·예상 견적)이 대신한다. -->
      <aside v-show="rightOpen && (route.name === 'bom' || route.name === 'bom-search')" class="hidden w-[334px] shrink-0 flex-col gap-[12px] px-[24px] pt-[24px] xl:flex">
        <!-- con01: Parts Eyes 튜토리얼 — 링크 미구현 -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-gradient-to-l from-surface-raised to-surface-sunken ring-1 ring-black/5" title="튜토리얼 (준비 중)">
          <div class="absolute right-0 top-0 h-full w-[141px] bg-gradient-to-b from-surface-brand to-surface-sunken blur-[10px]" />
          <img :src="promoZip" alt="" class="absolute right-[24px] top-[49px] size-[58px] rounded-[10px] shadow-[0px_4px_10px_rgba(89,129,208,0.4)]">
          <div class="absolute right-[18px] top-[16px] flex h-[18px] items-center gap-[3px] rounded-[10px] bg-surface px-[7px] shadow-[0px_0px_10px_var(--color-line-soft)]">
            <span class="size-[4px] rounded-full bg-brand" />
            <span class="text-[10px] font-bold text-brand">PICK</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px]">
            <p class="text-[11px] leading-[24px] text-brand">Parts Eyes 이용 방법 튜토리얼</p>
            <p class="text-[12px] leading-[18px] text-ink">다양한 제조사의 전자부품을<br>파츠아이에서 빠르게 검색하세요</p>
          </div>
        </div>
        <!-- con02: Gerber Eyes Online 3.0 — 링크 미구현 -->
        <div class="relative h-[132px] w-[286px] overflow-hidden rounded-[10px] bg-gradient-to-l from-surface-brand-soft to-surface-raised ring-1 ring-black/5" title="Gerber Eyes 소개 영상 (준비 중)">
          <div class="absolute right-0 top-0 h-full w-[141px] bg-gradient-to-b from-surface-brand to-surface-raised blur-[10px]" />
          <img :src="promoVideo" alt="" class="absolute right-[28px] top-[44px] size-[54px] rounded-[10px] shadow-[0px_4px_10px_rgba(183,183,183,0.5)]">
          <div class="absolute left-[188px] top-[35px] rounded-[10px] bg-surface/80 px-[6px] py-[3px] backdrop-blur-[10px]">
            <span class="bg-gradient-to-br from-[#ff1e22] to-[#af002f] bg-clip-text text-[10px] font-bold text-transparent">NEW</span>
          </div>
          <div class="absolute left-[16px] top-[52px] w-[188px]">
            <p class="text-[11px] leading-[24px] text-[#e95e49]">Gerber Eyes Online 3.0 출시</p>
            <p class="text-[12px] leading-[18px] text-ink">영상을 통해 편리해진<br>DFM 분석 기능을 확인해 보세요</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
  <!-- 시안 대비 미구현 기능(리스트업): 프로필 메뉴 ·
       프로모 카드 링크(튜토리얼/Gerber Eyes) — 사이드바/패널 접기·단일 검색은 구현됨 -->
</template>
