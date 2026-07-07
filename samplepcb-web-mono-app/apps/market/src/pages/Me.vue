<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  MARKET_BID_STATUS_LABELS,
  MARKET_EXPERT_STATUS_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_PROJECT_STATUS_LABELS,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { ApiRequestError } from '@sp/shared';
import ExpertProfileForm from '../components/ExpertProfileForm.vue';
import UiPagination from '../components/UiPagination.vue';
import { useMyBidList, useTargetedProjects } from '../api/useMarketBids';
import type { MyBidFilters } from '../api/useMarketBids';
import { useExpertMe } from '../api/useMarketExpertMe';
import { useMyProjectList } from '../api/useMarketProjects';
import type { MyProjectFilters } from '../api/useMarketProjects';
import { loginUrl, marketPath } from '../lib/auth-urls';
import { dateShort, ddayBadge, ddayToneClass, won } from '../lib/market-format';

// 마이페이지 — 탭 3: 내 의뢰(의뢰인) / 내 입찰+지정 인박스(전문가) / 전문가 프로필.
// 프로토타입 dashboard 2종의 1차 축약(칸반·정산은 2차).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);

const tab = ref<'projects' | 'bids' | 'expert'>('projects');

// 내 의뢰
const projectFilters = ref<MyProjectFilters>({ page: 1, pageSize: 20, tab: 'all' });
const myProjects = useMyProjectList(projectFilters, loggedIn);
const projectTabs = [
  { key: 'all', label: '전체' },
  { key: 'bidding', label: '입찰중' },
  { key: 'awarded', label: '선정완료' },
  { key: 'closed', label: '마감' },
  { key: 'cancelled', label: '취소' },
] as const;

// 내 입찰 + 지정 인박스
const bidFilters = ref<MyBidFilters>({ page: 1, pageSize: 20, status: '' });
const bidsEnabled = computed(() => loggedIn.value && tab.value === 'bids');
const myBids = useMyBidList(bidFilters, bidsEnabled);
const targetedPage = ref(1);
const targeted = useTargetedProjects(targetedPage, bidsEnabled);

// 전문가 프로필
const expertEnabled = computed(() => loggedIn.value && tab.value === 'expert');
const expertMe = useExpertMe(expertEnabled);
const expertNotRegistered = computed(
  () => expertMe.error.value instanceof ApiRequestError && expertMe.error.value.status === 404,
);
const me = computed(() => expertMe.data.value?.data);

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}
</script>

<template>
  <section class="mx-auto w-full max-w-5xl px-4 py-10">
    <p class="font-mono text-[11px] tracking-widest text-tx-3">MY PAGE</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('nav.me') }}</h1>

    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-sm text-tx-2">로그인 후 이용할 수 있습니다.</p>
      <button
        type="button"
        class="mt-4 rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
        @click="goLogin"
      >
        {{ $t('auth.login') }}
      </button>
    </div>

    <template v-else>
      <!-- 탭 -->
      <div class="mt-6 flex rounded-lg border border-line bg-white p-1 text-xs font-bold">
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2"
          :class="tab === 'projects' ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-line'"
          @click="tab = 'projects'"
        >
          내 의뢰
        </button>
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2"
          :class="tab === 'bids' ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-line'"
          @click="tab = 'bids'"
        >
          내 입찰
        </button>
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2"
          :class="tab === 'expert' ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-line'"
          @click="tab = 'expert'"
        >
          전문가 프로필
        </button>
      </div>

      <!-- 내 의뢰 -->
      <div v-if="tab === 'projects'" class="mt-5">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="t in projectTabs"
            :key="t.key"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold"
            :class="
              projectFilters.tab === t.key
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-line text-tx-2 hover:border-line-2'
            "
            @click="
              projectFilters.tab = t.key;
              projectFilters.page = 1;
            "
          >
            {{ t.label }}
          </button>
          <RouterLink
            to="/request"
            class="ml-auto rounded-lg bg-copper-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-copper-600"
          >
            + {{ $t('nav.request') }}
          </RouterLink>
        </div>

        <div v-if="(myProjects.data.value?.data.items ?? []).length === 0" class="mt-4 rounded-2xl border border-dashed border-line-2 bg-white p-12 text-center text-sm text-tx-3">
          의뢰 내역이 없습니다.
        </div>
        <div v-else class="mt-4 grid gap-3">
          <RouterLink
            v-for="p in myProjects.data.value?.data.items ?? []"
            :key="p.projectId"
            :to="`/projects/${String(p.projectId)}`"
            class="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 transition hover:border-copper-400"
          >
            <span class="rounded-md px-2 py-0.5 text-[11px] font-bold" :class="ddayToneClass[ddayBadge(p).tone]">
              {{ ddayBadge(p).label }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold text-tx-1">{{ p.title }}</p>
              <p class="mt-0.5 text-xs text-tx-3">
                {{ MARKET_METHOD_LABELS[p.method] }} · 견적 {{ p.bidCount }}건 ·
                {{ dateShort(p.createdAt) }} 등록
              </p>
            </div>
            <div v-if="p.awardedBid !== null" class="text-right text-xs">
              <p class="font-bold text-copper-600">{{ p.awardedBid.expertDisplayName }} 선정</p>
              <p class="text-tx-2">{{ won(p.awardedBid.amount) }}</p>
            </div>
          </RouterLink>
          <UiPagination
            :page="projectFilters.page"
            :page-size="projectFilters.pageSize"
            :total="myProjects.data.value?.data.total ?? 0"
            @update:page="(p) => (projectFilters.page = p)"
          />
        </div>
      </div>

      <!-- 내 입찰 -->
      <div v-else-if="tab === 'bids'" class="mt-5 grid gap-6">
        <!-- 지정 인박스 -->
        <div v-if="(targeted.data.value?.data.items ?? []).length > 0">
          <h2 class="text-sm font-extrabold text-tx-1">나를 지정한 의뢰</h2>
          <div class="mt-3 grid gap-3">
            <RouterLink
              v-for="p in targeted.data.value?.data.items ?? []"
              :key="p.projectId"
              :to="`/projects/${String(p.projectId)}`"
              class="flex flex-wrap items-center gap-3 rounded-2xl border border-copper-100 bg-copper-50 px-5 py-4 transition hover:border-copper-400"
            >
              <span class="rounded-md px-2 py-0.5 text-[11px] font-bold" :class="ddayToneClass[ddayBadge(p).tone]">
                {{ ddayBadge(p).label }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-bold text-tx-1">{{ p.title }}</p>
                <p class="mt-0.5 text-xs text-tx-3">{{ p.ownerName }} · {{ dateShort(p.createdAt) }} 등록</p>
              </div>
              <span class="text-xs font-bold" :class="p.myBidStatus === null ? 'text-copper-600' : 'text-tx-2'">
                {{ p.myBidStatus === null ? '견적 제출 대기' : MARKET_BID_STATUS_LABELS[p.myBidStatus] }}
              </span>
            </RouterLink>
          </div>
        </div>

        <!-- 입찰 목록 -->
        <div>
          <h2 class="text-sm font-extrabold text-tx-1">제출한 견적</h2>
          <div v-if="(myBids.data.value?.data.items ?? []).length === 0" class="mt-3 rounded-2xl border border-dashed border-line-2 bg-white p-12 text-center text-sm text-tx-3">
            제출한 견적이 없습니다.
            <RouterLink to="/projects" class="mt-2 block text-xs font-bold text-copper-600">
              공개 프로젝트 둘러보기 →
            </RouterLink>
          </div>
          <div v-else class="mt-3 grid gap-3">
            <RouterLink
              v-for="b in myBids.data.value?.data.items ?? []"
              :key="b.bidId"
              :to="`/projects/${String(b.project.projectId)}`"
              class="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 transition hover:border-copper-400"
            >
              <span
                class="rounded-md px-2 py-0.5 text-[11px] font-bold"
                :class="
                  b.status === 'awarded'
                    ? 'bg-copper-500 text-white'
                    : b.status === 'submitted'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-line text-tx-3'
                "
              >
                {{ MARKET_BID_STATUS_LABELS[b.status] }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-bold text-tx-1">{{ b.project.title }}</p>
                <p class="mt-0.5 text-xs text-tx-3">
                  {{ MARKET_PROJECT_STATUS_LABELS[b.project.status] }} ·
                  {{ dateShort(b.updatedAt) }} 제출
                </p>
              </div>
              <div class="text-right text-xs">
                <p class="font-extrabold text-tx-1">{{ won(b.amount) }}</p>
                <p class="text-tx-3">{{ b.durationDays }}일</p>
              </div>
            </RouterLink>
            <UiPagination
              :page="bidFilters.page"
              :page-size="bidFilters.pageSize"
              :total="myBids.data.value?.data.total ?? 0"
              @update:page="(p) => (bidFilters.page = p)"
            />
          </div>
        </div>
      </div>

      <!-- 전문가 프로필 -->
      <div v-else class="mt-5">
        <div v-if="expertMe.isLoading.value" class="py-10 text-center text-sm text-tx-3">
          {{ $t('common.loading') }}
        </div>

        <!-- 미등록 -->
        <div v-else-if="expertNotRegistered" class="rounded-2xl border border-line bg-white p-10 text-center">
          <p class="text-sm font-bold text-tx-1">아직 전문가로 등록하지 않았습니다.</p>
          <p class="mt-1.5 text-xs text-tx-3">등록·승인 후 공개 프로젝트 입찰과 지정견적 수신이 가능합니다.</p>
          <RouterLink
            to="/expert/register"
            class="mt-4 inline-block rounded-lg bg-copper-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-copper-600"
          >
            {{ $t('nav.expertRegister') }}
          </RouterLink>
        </div>

        <template v-else-if="me !== undefined">
          <!-- 상태 배너 -->
          <div
            class="rounded-2xl border p-5"
            :class="
              me.status === 'approved'
                ? 'border-emerald-200 bg-emerald-50'
                : me.status === 'pending'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-red-200 bg-red-50'
            "
          >
            <p class="text-sm font-extrabold text-tx-1">
              전문가 상태: {{ MARKET_EXPERT_STATUS_LABELS[me.status] }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-tx-2">
              <template v-if="me.status === 'pending'">심사 중입니다. 결과는 이메일로 안내드립니다.</template>
              <template v-else-if="me.status === 'approved'">
                공개 프로필로 활동 중입니다.
                <RouterLink :to="`/experts/${String(me.expertId)}`" class="font-bold text-copper-600">
                  내 공개 프로필 보기 →
                </RouterLink>
              </template>
              <template v-else-if="me.status === 'rejected'">
                반려 사유: <b class="text-red-600">{{ me.statusReason ?? '-' }}</b> — 아래에서 수정 후 재제출해 주세요.
              </template>
              <template v-else>
                운영 정책에 따라 활동이 정지되었습니다{{ me.statusReason !== null ? ` (사유: ${me.statusReason})` : '' }}.
                문의: 070-8667-1080
              </template>
            </p>
          </div>

          <!-- 수정 폼(심사 전/반려만) / 승인 후 읽기 안내 -->
          <div v-if="me.status === 'pending' || me.status === 'rejected'" class="mt-4 rounded-2xl border border-line bg-white p-6">
            <ExpertProfileForm :me="me" />
          </div>
          <div v-else class="mt-4 rounded-2xl border border-line bg-white p-6 text-xs leading-relaxed text-tx-3">
            승인된 프로필의 수정(재승인 절차)은 준비 중입니다. 변경이 필요하면 고객센터(070-8667-1080)로 연락해 주세요.
          </div>
        </template>
      </div>
    </template>
  </section>
</template>
