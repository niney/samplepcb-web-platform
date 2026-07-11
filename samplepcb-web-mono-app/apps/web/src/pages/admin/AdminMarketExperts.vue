<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  MARKET_TOOL_LABELS,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_EXPERT_STATUS_LABELS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_REGION_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  MARKET_TRAVEL_RANGE_LABELS,
  apiRoutes,
} from '@sp/api-contract';
import { apiGetBlob } from '@sp/shared';
import {
  useAdminMarketExpertDetail,
  useAdminMarketExpertList,
  useExpertDecision,
  type AdminMarketExpertFilters,
} from '../../admin/useAdminMarket';
import UiPagination from '../../components/ui/UiPagination.vue';

// 재능마켓 전문가 심사 — 목록(탭 counts)·상세 드로어·승인/반려/정지/해제.
// 도메인 라벨은 @sp/api-contract MARKET_*_LABELS 정본을 그대로 쓴다.

const filters = ref<AdminMarketExpertFilters>({ page: 1, pageSize: 20, tab: 'pending', q: '' });
const qInput = ref('');
const { data, isFetching } = useAdminMarketExpertList(filters);

const selectedId = ref<number | null>(null);
const detailQ = useAdminMarketExpertDetail(selectedId);
const detail = computed(() => detailQ.data.value?.data);

const decision = useExpertDecision();
const reason = ref('');
const decisionError = ref('');

const TABS = ['pending', 'approved', 'rejected', 'suspended', 'all'] as const;
const tabLabel: Record<(typeof TABS)[number], string> = {
  pending: '심사 대기',
  approved: '활동 중',
  rejected: '반려',
  suspended: '정지',
  all: '전체',
};

const setTab = (tab: AdminMarketExpertFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

function openDetail(id: number): void {
  selectedId.value = id;
  reason.value = '';
  decisionError.value = '';
}

async function decide(action: 'approve' | 'reject' | 'suspend' | 'unsuspend'): Promise<void> {
  if (selectedId.value === null) return;
  decisionError.value = '';
  const needsReason = action === 'reject' || action === 'suspend';
  if (needsReason && reason.value.trim() === '') {
    decisionError.value = '사유를 입력해 주세요.';
    return;
  }
  try {
    await decision.mutateAsync({
      expertId: selectedId.value,
      action,
      ...(needsReason ? { reason: reason.value.trim() } : {}),
    });
    reason.value = '';
  } catch {
    decisionError.value = '처리에 실패했습니다. 상태를 새로고침 후 다시 시도해 주세요.';
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminMarketFiles}/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const statusBadge = (s: string): string =>
  s === 'approved'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'pending'
      ? 'bg-amber-100 text-amber-700'
      : s === 'suspended'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600';
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">마켓 전문가 심사</h1>

    <!-- 탭 + 검색 -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-gray-200 bg-white p-1 text-xs font-semibold">
        <button
          v-for="t in TABS"
          :key="t"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(t)"
        >
          {{ tabLabel[t] }}
          <span v-if="data !== undefined" class="ml-1 text-[11px] opacity-70">
            {{ data.data.counts[t] }}
          </span>
        </button>
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          placeholder="이름/상호·회원ID 검색"
          class="h-9 w-56 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button
          type="button"
          class="h-9 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white"
          @click="applySearch"
        >
          검색
        </button>
      </div>
    </div>

    <!-- 목록 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3">이름/상호</th>
            <th class="px-4 py-3">유형</th>
            <th class="px-4 py-3">경력</th>
            <th class="px-4 py-3">회원</th>
            <th class="px-4 py-3">상태</th>
            <th class="px-4 py-3">신청일</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in data?.data.items ?? []"
            :key="e.expertId"
            class="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
            @click="openDetail(e.expertId)"
          >
            <td class="px-4 py-3 font-semibold text-gray-900">{{ e.displayName }}</td>
            <td class="px-4 py-3 text-xs">{{ MARKET_EXPERT_TYPE_LABELS[e.expertType] }}</td>
            <td class="px-4 py-3 text-xs">{{ MARKET_CAREER_RANGE_LABELS[e.careerRange] }}</td>
            <td class="px-4 py-3 text-xs text-gray-500">
              {{ e.member !== null ? `${e.member.name} (${e.mbId})` : e.mbId }}
            </td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(e.status)">
                {{ MARKET_EXPERT_STATUS_LABELS[e.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ e.createdAt.slice(0, 10) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-xs text-gray-400">
              {{ isFetching ? '불러오는 중…' : '대상이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ data.data.total }}명</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>

    <!-- 상세 드로어 -->
    <div v-if="selectedId !== null" class="fixed inset-0 z-40 flex justify-end bg-black/30" @click.self="selectedId = null">
      <div class="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">전문가 상세</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="selectedId = null">✕</button>
        </div>

        <div v-if="detail === undefined" class="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
        <template v-else>
          <div class="mt-4 flex items-center gap-2">
            <span class="text-base font-bold text-gray-900">{{ detail.displayName }}</span>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(detail.status)">
              {{ MARKET_EXPERT_STATUS_LABELS[detail.status] }}
            </span>
            <span class="text-xs text-gray-500">{{ MARKET_EXPERT_TYPE_LABELS[detail.expertType] }}</span>
          </div>
          <p v-if="detail.statusReason !== null" class="mt-1 text-xs text-red-600">
            사유: {{ detail.statusReason }}
          </p>

          <dl class="mt-4 grid grid-cols-[96px_1fr] gap-y-2 text-xs">
            <dt class="text-gray-500">회원</dt>
            <dd>{{ detail.member !== null ? `${detail.member.name} · ${detail.member.email} · ${detail.member.hp}` : detail.mbId }}</dd>
            <dt class="text-gray-500">연락처</dt>
            <dd>{{ detail.phone }}<span v-if="detail.contactHours !== null" class="text-gray-400"> ({{ detail.contactHours }})</span></dd>
            <dt class="text-gray-500">경력/지역</dt>
            <dd>
              {{ MARKET_CAREER_RANGE_LABELS[detail.careerRange] }}
              <template v-if="detail.region !== null"> · {{ MARKET_REGION_LABELS[detail.region] }}</template>
              <template v-if="detail.travelRange !== null"> · {{ MARKET_TRAVEL_RANGE_LABELS[detail.travelRange] }}</template>
            </dd>
            <dt class="text-gray-500">정산계좌</dt>
            <dd>{{ detail.bankName ?? '-' }} {{ detail.bankAccount ?? '' }} ({{ detail.bankHolder ?? '-' }})</dd>
            <dt class="text-gray-500">약관동의</dt>
            <dd>{{ detail.termsAgreedAt.slice(0, 19).replace('T', ' ') }} (UTC)</dd>
          </dl>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">분야 · CAD</p>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span v-for="area in detail.serviceAreas" :key="area" class="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
                {{ MARKET_SERVICE_AREA_LABELS[area] }}
              </span>
              <span v-for="c in detail.categories" :key="c" class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                {{ MARKET_CATEGORY_LABELS[c] }}
              </span>
              <span v-for="c in detail.cadTools" :key="c" class="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
                {{ MARKET_TOOL_LABELS[c] }}
              </span>
            </div>
          </div>

          <div v-if="detail.intro !== null" class="mt-4">
            <p class="text-xs font-bold text-gray-500">소개</p>
            <p class="mt-1 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
              {{ detail.intro }}
            </p>
          </div>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">증빙 파일 ({{ detail.files.length }})</p>
            <ul class="mt-1.5 grid gap-1">
              <li
                v-for="f in detail.files"
                :key="f.fileId"
                class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">{{ f.fileType }}</span>
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <button type="button" class="font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
                  다운로드
                </button>
              </li>
              <li v-if="detail.files.length === 0" class="text-xs text-gray-400">증빙 없음</li>
            </ul>
          </div>

          <!-- 심사 액션 -->
          <div class="mt-6 rounded-xl border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-700">심사 처리</p>
            <input
              v-if="detail.status === 'pending' || detail.status === 'approved'"
              v-model="reason"
              type="text"
              placeholder="반려/정지 사유 (해당 시 필수)"
              class="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
            >
            <p v-if="decisionError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ decisionError }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <template v-if="detail.status === 'pending'">
                <button
                  type="button"
                  class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                  :disabled="decision.isPending.value"
                  @click="decide('approve')"
                >
                  승인
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
                  :disabled="decision.isPending.value"
                  @click="decide('reject')"
                >
                  반려
                </button>
              </template>
              <button
                v-if="detail.status === 'approved'"
                type="button"
                class="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
                :disabled="decision.isPending.value"
                @click="decide('suspend')"
              >
                정지
              </button>
              <button
                v-if="detail.status === 'suspended'"
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="decision.isPending.value"
                @click="decide('unsuspend')"
              >
                정지 해제
              </button>
              <span v-if="detail.status === 'rejected'" class="text-xs text-gray-400">
                반려됨 — 신청자가 수정 후 재제출하면 심사 대기로 돌아옵니다.
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
