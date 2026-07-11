<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  MARKET_BID_STATUS_LABELS,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_TOOL_LABELS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  MARKET_PROJECT_STATUS_LABELS,
  apiRoutes,
} from '@sp/api-contract';
import { apiGetBlob } from '@sp/shared';
import {
  useAdminCancelProject,
  useAdminMarketProjectDetail,
  useAdminMarketProjectList,
  type AdminMarketProjectFilters,
} from '../../admin/useAdminMarket';
import UiPagination from '../../components/ui/UiPagination.vue';

// 재능마켓 프로젝트 모니터 — 관리자는 블라인드·마스킹 예외(입찰 전체·의뢰인 원명·NDA 서명자).

const filters = ref<AdminMarketProjectFilters>({
  page: 1,
  pageSize: 20,
  tab: 'all',
  method: '',
  q: '',
});
const qInput = ref('');
const { data, isFetching } = useAdminMarketProjectList(filters);

const selectedId = ref<number | null>(null);
const detailQ = useAdminMarketProjectDetail(selectedId);
const detail = computed(() => detailQ.data.value?.data);

const cancelProject = useAdminCancelProject();
const confirmCancel = ref(false);
const actionError = ref('');

const TABS = ['all', 'bidding', 'awarded', 'closed', 'cancelled'] as const;
const tabLabel: Record<(typeof TABS)[number], string> = {
  all: '전체',
  bidding: '입찰중',
  awarded: '선정완료',
  closed: '마감',
  cancelled: '취소',
};

const setTab = (tab: AdminMarketProjectFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

function openDetail(id: number): void {
  selectedId.value = id;
  confirmCancel.value = false;
  actionError.value = '';
}

async function onCancel(): Promise<void> {
  if (selectedId.value === null) return;
  actionError.value = '';
  try {
    await cancelProject.mutateAsync(selectedId.value);
    confirmCancel.value = false;
  } catch {
    actionError.value = '취소 처리에 실패했습니다(상태 변경됨?). 새로고침 후 다시 확인해 주세요.';
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
  s === 'awarded' || s === 'working' || s === 'completed'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'bidding'
      ? 'bg-blue-100 text-blue-700'
      : s === 'cancelled'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600';
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">마켓 프로젝트</h1>

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
      <select
        v-model="filters.method"
        class="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs"
        @change="filters = { ...filters, page: 1 }"
      >
        <option value="">방식 전체</option>
        <option value="open">역견적</option>
        <option value="targeted">지정견적</option>
      </select>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          placeholder="제목·의뢰인ID 검색"
          class="h-9 w-56 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button type="button" class="h-9 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white" @click="applySearch">
          검색
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3">제목</th>
            <th class="px-4 py-3">의뢰인</th>
            <th class="px-4 py-3">방식</th>
            <th class="px-4 py-3">견적</th>
            <th class="px-4 py-3">상태</th>
            <th class="px-4 py-3">마감</th>
            <th class="px-4 py-3">등록일</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in data?.data.items ?? []"
            :key="p.projectId"
            class="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
            @click="openDetail(p.projectId)"
          >
            <td class="max-w-64 truncate px-4 py-3 font-semibold text-gray-900">
              {{ p.title }}
              <span v-if="p.ndaRequired" class="ml-1 text-[10px] text-amber-600">NDA</span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.owner.name }} ({{ p.owner.mbId }})</td>
            <td class="px-4 py-3 text-xs">{{ MARKET_METHOD_LABELS[p.method] }}</td>
            <td class="px-4 py-3 text-xs">{{ p.bidCount }}건</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(p.status)">
                {{ MARKET_PROJECT_STATUS_LABELS[p.status] }}{{ p.status === 'bidding' && p.biddingClosed ? ' (기한만료)' : '' }}
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.bidDeadlineAt.slice(0, 10) }}</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.createdAt.slice(0, 10) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="7" class="px-4 py-10 text-center text-xs text-gray-400">
              {{ isFetching ? '불러오는 중…' : '대상이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ data.data.total }}건</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>

    <!-- 상세 드로어 -->
    <div v-if="selectedId !== null" class="fixed inset-0 z-40 flex justify-end bg-black/30" @click.self="selectedId = null">
      <div class="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">프로젝트 상세</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="selectedId = null">✕</button>
        </div>

        <div v-if="detail === undefined" class="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
        <template v-else>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusBadge(detail.status)">
              {{ MARKET_PROJECT_STATUS_LABELS[detail.status] }}
            </span>
            <span class="text-xs text-gray-500">{{ MARKET_METHOD_LABELS[detail.method] }}</span>
            <span class="text-xs text-gray-500">{{ MARKET_REQUEST_TYPE_LABELS[detail.requestType] }} · {{ detail.serviceAreas.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join(' · ') }}</span>
            <span v-if="detail.ndaRequired" class="text-xs font-bold text-amber-600">NDA</span>
          </div>
          <h3 class="mt-2 text-base font-bold text-gray-900">{{ detail.title }}</h3>

          <dl class="mt-3 grid grid-cols-[96px_1fr] gap-y-2 text-xs">
            <dt class="text-gray-500">의뢰인</dt>
            <dd>{{ detail.owner.name }} ({{ detail.owner.mbId }}) · {{ detail.owner.email ?? '-' }}</dd>
            <dt class="text-gray-500">예산</dt>
            <dd>{{ MARKET_BUDGET_RANGE_LABELS[detail.budgetRange] }}</dd>
            <dt v-if="detail.categories.length > 0" class="text-gray-500">세부분야</dt>
            <dd v-if="detail.categories.length > 0">
              {{ detail.categories.map((c) => MARKET_CATEGORY_LABELS[c]).join(' · ') }}
            </dd>
            <dt class="text-gray-500">요구 툴</dt>
            <dd>{{ detail.cadTools.length > 0 ? detail.cadTools.map((c) => MARKET_TOOL_LABELS[c]).join(' · ') : '특정 툴 요구 없음' }}</dd>
            <dt class="text-gray-500">마감</dt>
            <dd>{{ detail.bidDeadlineAt.slice(0, 16).replace('T', ' ') }} (UTC)</dd>
            <dt v-if="detail.targetExpert !== null" class="text-gray-500">지정 전문가</dt>
            <dd v-if="detail.targetExpert !== null">
              {{ detail.targetExpert.displayName }} ({{ detail.targetExpert.mbId }})
            </dd>
          </dl>

          <p class="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
            {{ detail.description }}
          </p>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">첨부 ({{ detail.attachments.length }})</p>
            <ul class="mt-1.5 grid gap-1">
              <li
                v-for="f in detail.attachments"
                :key="f.fileId"
                class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <button type="button" class="font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
                  다운로드
                </button>
              </li>
              <li v-if="detail.attachments.length === 0" class="text-xs text-gray-400">없음</li>
            </ul>
          </div>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">입찰 ({{ detail.bids.length }})</p>
            <div class="mt-1.5 grid gap-2">
              <div
                v-for="b in detail.bids"
                :key="b.bidId"
                class="rounded-lg border p-3 text-xs"
                :class="b.status === 'awarded' ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100'"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <b>{{ b.expert.displayName }}</b>
                  <span class="text-gray-500">{{ MARKET_EXPERT_TYPE_LABELS[b.expert.expertType] }} · {{ b.mbId }}</span>
                  <span class="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                    {{ MARKET_BID_STATUS_LABELS[b.status] }}
                  </span>
                </div>
                <p class="mt-1">
                  <b>{{ b.amount.toLocaleString('ko-KR') }}원</b> · {{ b.durationDays }}일
                  <span v-if="b.warranty !== null"> · {{ b.warranty }}</span>
                </p>
                <p class="mt-1 whitespace-pre-line text-gray-600">{{ b.message }}</p>
              </div>
              <p v-if="detail.bids.length === 0" class="text-xs text-gray-400">입찰 없음</p>
            </div>
          </div>

          <div class="mt-4">
            <p class="text-xs font-bold text-gray-500">NDA 서명 ({{ detail.ndaSigns.length }})</p>
            <ul class="mt-1.5 grid gap-1 text-xs text-gray-600">
              <li v-for="s in detail.ndaSigns" :key="s.mbId">
                {{ s.signedName }} ({{ s.mbId }}) · {{ s.textVersion }} · {{ s.signedAt.slice(0, 16).replace('T', ' ') }}
              </li>
              <li v-if="detail.ndaSigns.length === 0" class="text-gray-400">서명 없음</li>
            </ul>
          </div>

          <!-- 운영 취소 -->
          <div
            v-if="detail.status !== 'cancelled' && detail.status !== 'completed'"
            class="mt-6 rounded-xl border border-red-200 p-4"
          >
            <p class="text-xs font-bold text-red-600">운영 취소 (신고·분쟁 대응)</p>
            <p v-if="actionError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ actionError }}</p>
            <div class="mt-2 flex gap-2">
              <template v-if="confirmCancel">
                <button
                  type="button"
                  class="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
                  :disabled="cancelProject.isPending.value"
                  @click="onCancel"
                >
                  취소 확정
                </button>
                <button type="button" class="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600" @click="confirmCancel = false">
                  닫기
                </button>
              </template>
              <button
                v-else
                type="button"
                class="rounded-lg border border-red-300 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                @click="confirmCancel = true"
              >
                프로젝트 취소
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
