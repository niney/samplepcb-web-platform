<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAdminQuoteList, type AdminQuoteFilters } from '../../admin/useAdminQuotes';
import QuoteStatusTabs from '../../components/admin/QuoteStatusTabs.vue';
import QuoteFilterBar from '../../components/admin/QuoteFilterBar.vue';
import QuotesTable from '../../components/admin/QuotesTable.vue';
import QuoteDetailDrawer from '../../components/admin/QuoteDetailDrawer.vue';
import DeleteQuoteModal from '../../components/admin/DeleteQuoteModal.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 관리자 견적 관리 — 전 사용자 거버 견적 목록·상세·가격 확정(rfq→quoted)·완전삭제.
// 필터 상태는 이 페이지가 단일 소유하고, 탭/필터/페이지 변경 시 1페이지 리셋 + 선택 해제.
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

// 배치 삭제 선택 — 페이지/필터가 바뀌면 목록이 달라지므로 선택을 비운다(전체선택은
// 현재 페이지 범위만 다룬다). 삭제 성공(onDeleted) 시에도 선택을 해제한다.
const selectedIds = ref<number[]>([]);
const deleteIds = ref<number[] | null>(null);
const clearSelection = (): void => {
  selectedIds.value = [];
};
const toggleOne = (projectId: number): void => {
  selectedIds.value = selectedIds.value.includes(projectId)
    ? selectedIds.value.filter((id) => id !== projectId)
    : [...selectedIds.value, projectId];
};
const toggleAll = (checked: boolean): void => {
  const pageIds = (data.value?.data.items ?? []).map((i) => i.projectId);
  const pageSet = new Set(pageIds);
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, ...pageIds])]
    : selectedIds.value.filter((id) => !pageSet.has(id));
};
const onDeleted = (): void => {
  deleteIds.value = null;
  clearSelection();
};

const setTab = (tab: AdminQuoteFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
  clearSelection();
};
const applyFilters = (patch: Partial<AdminQuoteFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
  clearSelection();
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
  clearSelection();
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.quotes.title') }}</h1>

    <QuoteStatusTabs :tab="filters.tab" :counts="data?.data.counts" @update:tab="setTab" />
    <QuoteFilterBar :filters="filters" @change="applyFilters" />

    <!-- 선택 삭제 툴바 -->
    <div
      v-if="selectedIds.length > 0"
      class="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2"
    >
      <span class="text-sm font-medium text-red-700">
        {{ t('admin.quotes.selection.count', { n: selectedIds.length }) }}
      </span>
      <button
        type="button"
        class="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
        @click="deleteIds = [...selectedIds]"
      >
        {{ t('admin.quotes.selection.delete') }}
      </button>
      <button type="button" class="text-sm text-gray-500 hover:underline" @click="clearSelection">
        {{ t('admin.quotes.selection.clear') }}
      </button>
    </div>

    <QuotesTable
      :items="data?.data.items ?? []"
      :loading="isFetching"
      :selected-ids="selectedIds"
      @select="selectedId = $event"
      @toggle="toggleOne"
      @toggle-all="toggleAll"
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
    <DeleteQuoteModal
      v-if="deleteIds !== null"
      :ids="deleteIds"
      @close="deleteIds = null"
      @deleted="onDeleted"
    />
  </div>
</template>
