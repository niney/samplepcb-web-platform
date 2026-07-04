<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAdminQuoteList, type AdminQuoteFilters } from '../../admin/useAdminQuotes';
import QuoteStatusTabs from '../../components/admin/QuoteStatusTabs.vue';
import QuoteFilterBar from '../../components/admin/QuoteFilterBar.vue';
import QuotesTable from '../../components/admin/QuotesTable.vue';
import QuoteDetailDrawer from '../../components/admin/QuoteDetailDrawer.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 관리자 견적 관리 — 전 사용자 거버 견적 목록·상세·가격 확정(rfq→quoted).
// 필터 상태는 이 페이지가 단일 소유하고, 탭/필터 변경 시 1페이지로 리셋한다.
const { t } = useI18n();

// 회원 관리 드로어의 [견적 관리에서 검색] → ?q=mbId 로 진입 시 검색어 초기값으로 1회 반영.
const route = useRoute();
const initialQ = typeof route.query.q === 'string' ? route.query.q : '';

const filters = ref<AdminQuoteFilters>({
  page: 1,
  pageSize: 20,
  tab: 'all',
  includeDeleted: false,
  category: '',
  q: initialQ,
  from: '',
  to: '',
});

const { data, isFetching } = useAdminQuoteList(filters);
const selectedId = ref<number | null>(null);

const setTab = (tab: AdminQuoteFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applyFilters = (patch: Partial<AdminQuoteFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.quotes.title') }}</h1>

    <QuoteStatusTabs :tab="filters.tab" :counts="data?.data.counts" @update:tab="setTab" />
    <QuoteFilterBar :filters="filters" @change="applyFilters" />
    <QuotesTable
      :items="data?.data.items ?? []"
      :loading="isFetching"
      @select="selectedId = $event"
    />

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">
        {{ t('admin.quotes.table.total', { n: data.data.total }) }}
      </p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="setPage"
      />
    </div>

    <QuoteDetailDrawer :project-id="selectedId" @close="selectedId = null" />
  </div>
</template>
