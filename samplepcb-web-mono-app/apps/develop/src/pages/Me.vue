<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { marketAreaBadge } from '@sp/api-contract';
import type { DevelopRequestListItemType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { UiPagination } from '@sp/ui';
import { useMyDevelopRequests } from '../api/useDevelopRequests';
import type { MyRequestFilters } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import { dateShort, nextActionLabel, statusLabel, statusToneClass } from '../lib/format';

// 내 의뢰(docs/DEVELOP_FLOW.md §7.2) — 공개 목록이 없으므로 이 화면이 유일한 목록이다.
// 한 행이 답해야 하는 것: 무엇을 맡겼나 · 지금 어디까지 왔나 · **내가 할 일이 있나**.
// 그래서 상태 배지 옆에 nextAction 칩을 세우고, 그 행만 테두리를 굵게 한다.

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

// 할 일이 있는 행은 상세의 그 섹션으로 바로 보낸다(견적 확인·결제 → 견적서, 검수·확인 답변 → 진행·문의).
// 칩만 따로 링크로 만들면 카드 링크 안에 링크가 들어가 유효하지 않은 마크업이 되므로 카드 자체에 앵커를 건다.
const ACTION_ANCHOR = {
  review_quote: '#quotes',
  pay: '#quotes',
  inspect: '#timeline',
  answer_review: '#timeline',
} as const;

const detailTo = (r: DevelopRequestListItemType): string =>
  `/requests/${String(r.requestId)}${r.nextAction === null ? '' : ACTION_ANCHOR[r.nextAction]}`;
</script>

<template>
  <section class="mx-auto w-full max-w-[1080px] px-6 py-9">
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-tx-3">MY REQUESTS</p>
        <h1 class="mt-1.5 text-h1 font-extrabold text-tx-1">내 의뢰</h1>
      </div>
      <RouterLink
        v-if="loggedIn"
        to="/request"
        class="ml-auto h-11 rounded-lg bg-ink-950 px-5 text-body font-bold leading-[2.75rem] text-white transition hover:bg-brand-600"
      >
        새 의뢰
      </RouterLink>
    </div>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">내 의뢰는 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600" @click="goLogin">
        로그인
      </button>
    </div>

    <template v-else>
      <p v-if="listQ.isPending.value" class="mt-8 rounded-2xl border border-line bg-white px-6 py-12 text-center text-body text-tx-3">
        {{ $t('common.loading') }}
      </p>
      <p v-else-if="listQ.isError.value" class="mt-8 rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">
        {{ errorMessage(listQ.error.value) }}
      </p>

      <!-- 빈 상태 -->
      <div v-else-if="items.length === 0" class="mt-8 rounded-2xl border border-dashed border-line-2 bg-white px-6 py-14 text-center">
        <p class="text-title font-extrabold text-tx-1">아직 맡기신 개발이 없습니다</p>
        <p class="mx-auto mt-2 max-w-md text-body leading-relaxed text-tx-2">
          자료가 없어도, 분야를 몰라도 괜찮습니다. 무엇을 만들고 싶은지만 적어 주시면 담당자가 함께 정리해 드립니다.
        </p>
        <RouterLink
          to="/request"
          class="mt-6 inline-block h-11 rounded-lg bg-brand-500 px-6 text-body font-bold leading-[2.75rem] text-white transition hover:bg-brand-600"
        >
          개발 의뢰하기
        </RouterLink>
      </div>

      <template v-else>
        <p class="mt-6 font-mono text-micro tabular-nums text-tx-3">전체 {{ total }}건</p>
        <ul class="mt-2.5 grid gap-2.5">
          <li v-for="r in items" :key="r.requestId">
            <RouterLink
              :to="detailTo(r)"
              class="grid gap-3 rounded-2xl border bg-white p-5 transition sm:grid-cols-[1fr_auto] sm:items-center"
              :class="r.nextAction === null ? 'border-line hover:border-line-2' : 'border-2 border-brand-500'"
            >
              <div class="grid min-w-0 gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full px-2.5 py-1 text-micro font-bold" :class="statusToneClass[r.status]">{{ statusLabel(r.status) }}</span>
                  <span v-if="r.nextAction !== null" class="rounded-full bg-brand-500 px-2.5 py-1 text-micro font-bold text-white">
                    {{ nextActionLabel(r.nextAction) }}
                  </span>
                  <span v-if="r.reviewPublished" class="rounded-full bg-paper px-2.5 py-1 text-micro font-bold text-tx-2">검토서</span>
                  <span v-if="r.diagramPublished" class="rounded-full bg-paper px-2.5 py-1 text-micro font-bold text-tx-2">구성도</span>
                </div>
                <p class="truncate text-title font-extrabold text-tx-1">{{ r.title }}</p>
                <p class="text-label text-tx-3">
                  {{ marketAreaBadge(r.serviceAreas) }} · 접수 {{ dateShort(r.createdAt) }}
                </p>
              </div>
              <span class="font-mono text-micro tabular-nums text-tx-3 sm:text-right">#{{ r.requestId }}</span>
            </RouterLink>
          </li>
        </ul>

        <div v-if="total > filters.pageSize" class="mt-8">
          <UiPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
        </div>
      </template>
    </template>
  </section>
</template>
