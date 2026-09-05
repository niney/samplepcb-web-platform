<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  DEVELOP_ADMIN_TABS,
  DEVELOP_ADMIN_TAB_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_REQUEST_STATUS_LABELS,
  MARKET_BUDGET_RANGE_LABELS,
  marketAreaBadge,
} from '@sp/api-contract';
import type { DevelopAdminTabType } from '@sp/api-contract';
import { UiPagination } from '@sp/ui';
import { useAdminDevelopList, emptyDevelopFilters } from '../../admin/useAdminDevelop';
import DevelopAiChips from '../../components/admin/develop/DevelopAiChips.vue';
import { developStatusBadgeClass } from '../../components/admin/develop/develop-badge';
import { formatDate, formatKrw } from '../../lib/format';

// 개발의뢰 워크큐(docs/DEVELOP_FLOW.md §7.3) — 탭 counts · 검색 · 행 클릭으로 전면 상세.
// 관리자 기본 탭은 `all`(다른 워크큐와 달리 "내 차례" 탭이 따로 없다 — 전이가 상태 하나에 담긴다).

const { t } = useI18n();
const router = useRouter();

const filters = ref(emptyDevelopFilters());
const qInput = ref('');
const { data, isFetching } = useAdminDevelopList(filters);

const setTab = (tab: DevelopAdminTabType): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};
const openDetail = (requestId: number): void => {
  void router.push({ name: 'admin-develop-request', params: { id: String(requestId) } });
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold">{{ t('admin.develop.title') }}</h1>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 text-sm font-semibold">
        <button
          v-for="tabKey in DEVELOP_ADMIN_TABS"
          :key="tabKey"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === tabKey ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(tabKey)"
        >
          {{ DEVELOP_ADMIN_TAB_LABELS[tabKey] }}
          <span v-if="data !== undefined" class="ml-1 text-xs opacity-70">{{ data.data.counts[tabKey] }}</span>
        </button>
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          :placeholder="t('admin.develop.searchPlaceholder')"
          class="h-9 w-64 rounded-lg border border-gray-200 bg-white px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button type="button" class="h-9 rounded-lg bg-gray-800 px-3 text-sm font-bold text-white" @click="applySearch">
          {{ t('admin.develop.search') }}
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full text-left text-base">
        <thead class="border-b border-gray-200 text-sm text-gray-500">
          <tr>
            <th class="px-4 py-3">{{ t('admin.develop.col.title') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.status') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.owner') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.contact') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.ai') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.quote') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.assignee') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.createdAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in data?.data.items ?? []"
            :key="r.requestId"
            class="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/40"
            @click="openDetail(r.requestId)"
          >
            <td class="max-w-72 px-4 py-3">
              <p class="truncate font-semibold text-gray-900">{{ r.title }}</p>
              <p class="mt-0.5 text-xs text-gray-500">
                <span v-if="marketAreaBadge(r.serviceAreas) !== ''">{{ marketAreaBadge(r.serviceAreas) }} · </span>
                {{ MARKET_BUDGET_RANGE_LABELS[r.budgetRange] }}
              </p>
            </td>
            <td class="px-4 py-3">
              <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" :class="developStatusBadgeClass(r.status)">
                {{ DEVELOP_REQUEST_STATUS_LABELS[r.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">
              <p>{{ r.owner.name === '' ? r.owner.mbId : r.owner.name }}</p>
              <p class="text-xs text-gray-400">{{ r.owner.email ?? r.owner.mbId }}</p>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">
              <p>{{ r.contact.name }}<span v-if="r.contact.company !== null"> · {{ r.contact.company }}</span></p>
              <p class="text-xs text-gray-400">{{ r.contact.phone }}</p>
            </td>
            <td class="px-4 py-3">
              <DevelopAiChips :ai="r.ai" :ai-consent="r.aiConsent" />
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">
              <template v-if="r.latestQuote !== null">
                <p>
                  v{{ r.latestQuote.version }} · {{ DEVELOP_QUOTE_KIND_LABELS[r.latestQuote.kind] }}
                  <span class="text-gray-400">({{ DEVELOP_QUOTE_STATUS_LABELS[r.latestQuote.status] }})</span>
                </p>
                <p class="text-xs font-semibold text-gray-700">{{ formatKrw(r.latestQuote.totalAmount) }}</p>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">{{ r.assigneeMbId ?? '—' }}</td>
            <td class="px-4 py-3 text-sm text-gray-500">{{ formatDate(r.createdAt) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="8" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ isFetching ? t('admin.develop.loading') : t('admin.develop.empty') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-base text-gray-500">{{ t('admin.develop.total', { total: data.data.total }) }}</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p: number) => (filters = { ...filters, page: p })"
      />
    </div>
  </div>
</template>
