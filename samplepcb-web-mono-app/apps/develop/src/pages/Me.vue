<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
import { developAreaBadge } from '@sp/api-contract';
import type { DevelopRequestListItemType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { UiPagination } from '@sp/ui';
import { useMyDevelopRequests } from '../api/useDevelopRequests';
import type { MyRequestFilters } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import { dateDot, nextActionLabel, statusLabel, statusToneClass } from '../lib/format';
import icoReceived from '../assets/me/ico-received.svg';

// 내 의뢰(docs/DEVELOP_FLOW.md §7.2) — 피그마 개발의뢰 「00-2 내의뢰」 37:7619(= Design done 70:11488), 2026-10-22.
// 1280 폭 표: 검정 윗줄 · '전체 N건' · 행(95) 사이 회색 줄. 한 행이 답하는 것 = 무엇을 맡겼나 · 지금 어디까지 왔나 ·
// **내가 할 일이 있나**. 할 일이 있으면 상태 칩 자리에 파란 할 일 칩이 서고(사용자 결정), 오른쪽에 그 일로 가는
// 검정 버튼이 '진행 상태' 앞에 붙는다. 행 아무 곳이나 누르면 상세(제목 링크를 행 전체로 늘림 — 버튼은 그 위에).
// 시안에 없는 상태(비로그인·불러오는 중·빈 목록·오류)는 같은 표 안에 가운데 문구로.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);

const filters = ref<MyRequestFilters>({ page: 1, pageSize: 20 });
const listQ = useMyDevelopRequests(filters, loggedIn);
const items = computed(() => listQ.data.value?.data.items ?? []);
const total = computed(() => listQ.data.value?.data.total ?? 0);

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function setPage(p: number): void {
  filters.value = { ...filters.value, page: p };
  window.scrollTo({ top: 0 });
}

// 할 일 버튼 — 상세의 그 섹션으로 바로 보낸다(견적 확인·결제 → 견적서, 검수·확인 답변 → 진행·문의, 문서 → 프로젝트 문서).
const ACTIONS = {
  review_quote: { hash: '#quotes', button: '견적서 확인' },
  pay: { hash: '#quotes', button: '결제하기' },
  inspect: { hash: '#timeline', button: '검수하기' },
  answer_document: { hash: '#documents', button: '문서 확인·회신' },
  answer_review: { hash: '#timeline', button: '확인 요청 답변' },
} as const satisfies Record<NonNullable<DevelopRequestListItemType['nextAction']>, { hash: string; button: string }>;

const detailTo = (r: DevelopRequestListItemType, hash = ''): RouteLocationRaw => ({
  name: 'request-detail',
  params: { id: String(r.requestId) },
  hash,
});
</script>

<template>
  <section class="px-5 pb-[60px] pt-[60px] tracking-normal">
    <div class="mx-auto w-full max-w-[1280px]">
      <h1 class="text-[32px] font-bold leading-[1.2] text-black sm:text-[40px]">내 의뢰</h1>
      <div class="mt-[16px] h-px bg-[#0a151e]" />

      <!-- 비로그인 -->
      <div v-if="!loggedIn" class="border-b border-[#d9d9d9] px-[10px] py-[60px] text-center">
        <p class="text-[15px] leading-[1.3] text-[#666]">내 의뢰는 로그인 후 확인할 수 있습니다.</p>
        <button
          type="button"
          class="mt-[20px] h-[34px] rounded-[6px] border border-[#1b2b39] bg-[#1b2b39] px-[14px] text-[14px] font-medium leading-[1.3] text-white transition-colors hover:bg-[#0a151e]"
          @click="goLogin"
        >
          로그인
        </button>
      </div>

      <template v-else>
        <p v-if="listQ.isPending.value" class="border-b border-[#d9d9d9] px-[10px] py-[60px] text-center text-[15px] leading-[1.3] text-[#666]">
          {{ $t('common.loading') }}
        </p>
        <p v-else-if="listQ.isError.value" class="border-b border-[#d9d9d9] px-[10px] py-[60px] text-center text-[15px] font-semibold leading-[1.3] text-red-700">
          {{ errorMessage(listQ.error.value) }}
        </p>

        <!-- 빈 상태 -->
        <div v-else-if="items.length === 0" class="border-b border-[#d9d9d9] px-[10px] py-[60px] text-center">
          <p class="text-[18px] font-bold leading-[1.3] text-[#141e34]">아직 맡기신 개발이 없습니다</p>
          <p class="mx-auto mt-[8px] max-w-[460px] text-[15px] leading-[1.5] text-[#666]">
            자료가 없어도, 분야를 몰라도 괜찮습니다. 무엇을 만들고 싶은지만 적어 주시면 담당자가 함께 정리해 드립니다.
          </p>
          <RouterLink
            :to="{ name: 'request' }"
            class="mt-[20px] inline-flex h-[34px] items-center rounded-[6px] border border-[#1b2b39] bg-[#1b2b39] px-[14px] text-[14px] font-medium leading-[1.3] text-white transition-colors hover:bg-[#0a151e]"
          >
            개발 의뢰하기
          </RouterLink>
        </div>

        <template v-else>
          <p class="h-[50px] px-[10px] pt-[16px] text-[15px] leading-[1.3] text-[#666]">
            전체 <b class="font-bold text-[#654eff]">{{ total }}</b><b class="font-bold text-black">건</b>
          </p>
          <ul class="border-b border-[#d9d9d9]">
            <li
              v-for="r in items"
              :key="r.requestId"
              class="relative flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[#d9d9d9] px-[10px] py-[18.5px] transition-colors hover:bg-[#fafbfc] sm:flex-nowrap"
            >
              <!-- 시안: 제목 위 20 · 칩 아래 17, 버튼은 행 높이 95 의 가운데 — 패딩을 고르게 두고 왼쪽 묶음만 1.5px 내린다 -->
              <div class="-mb-[1.5px] mt-[1.5px] min-w-0 basis-full sm:flex-1 sm:basis-auto">
                <RouterLink
                  :to="detailTo(r)"
                  class="block truncate text-[18px] font-bold leading-[1.3] text-[#141e34] after:absolute after:inset-0 after:content-['']"
                >
                  {{ r.title }}
                </RouterLink>
                <div class="mt-[10.6px] flex min-h-[24px] flex-wrap items-center gap-x-[10px] gap-y-1 text-[14px] leading-[1.3] text-[#666]">
                  <span>{{ developAreaBadge(r.serviceAreas) }}</span>
                  <span aria-hidden="true">|</span>
                  <span class="flex items-center gap-[6px]">
                    <img :src="icoReceived" alt="" class="block size-[16px] shrink-0">접수 {{ dateDot(r.createdAt) }}
                  </span>
                  <span aria-hidden="true">|</span>
                  <span class="flex flex-wrap items-center gap-[6px] text-[12px] font-semibold">
                    <span v-if="r.nextAction !== null" class="rounded-[37px] bg-[#1b6ff3] px-[8px] py-[4px] text-white">
                      {{ nextActionLabel(r.nextAction) }}
                    </span>
                    <span v-else class="rounded-[37px] px-[8px] py-[4px]" :class="statusToneClass[r.status]">{{ statusLabel(r.status) }}</span>
                    <span v-if="r.reviewPublished" class="rounded-[37px] bg-[#f5f6f8] px-[8px] py-[4px] text-[#475569]">검토서</span>
                    <span v-if="r.diagramPublished" class="rounded-[37px] bg-[#f5f6f8] px-[8px] py-[4px] text-[#475569]">구성도</span>
                  </span>
                </div>
              </div>
              <div class="relative z-10 ml-auto flex shrink-0 items-center gap-[10px] text-[14px] leading-[1.3]">
                <RouterLink
                  v-if="r.nextAction !== null"
                  :to="detailTo(r, ACTIONS[r.nextAction].hash)"
                  class="flex h-[34px] items-center rounded-[6px] border border-[#1b2b39] bg-[#1b2b39] px-[10px] font-medium text-white transition-colors hover:bg-[#0a151e]"
                >
                  {{ ACTIONS[r.nextAction].button }}
                </RouterLink>
                <RouterLink
                  :to="detailTo(r)"
                  class="flex h-[34px] items-center rounded-[6px] border border-[#d8d8d8] bg-white px-[10px] text-[#141e34] transition-colors hover:border-[#9aa3ad]"
                >
                  진행 상태
                </RouterLink>
              </div>
            </li>
          </ul>

          <div v-if="total > filters.pageSize" class="mt-[40px]">
            <UiPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
