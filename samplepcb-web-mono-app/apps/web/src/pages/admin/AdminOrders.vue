<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminOrderList, type AdminOrderFilters } from '../../admin/useAdminOrders';
import OrderStatusTabs from '../../components/admin/OrderStatusTabs.vue';
import OrderFilterBar from '../../components/admin/OrderFilterBar.vue';
import OrdersTable from '../../components/admin/OrdersTable.vue';
import OrderDetailDrawer from '../../components/admin/OrderDetailDrawer.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 관리자 주문내역(읽기) — 영카트 orderlist.php 를 sp-vue 로 마이그레이션한 목록·상세.
// 필터 상태는 이 페이지가 단일 소유하고, 탭/필터 변경 시 1페이지로 리셋한다.
const { t } = useI18n();

const filters = ref<AdminOrderFilters>({
  page: 1,
  pageSize: 20,
  tab: '전체',
  qField: 'od_id',
  q: '',
  from: '',
  to: '',
  settleCase: '',
  misu: false,
  cancelled: false,
  refund: false,
  point: false,
  coupon: false,
  sort: '',
  order: 'desc',
});

const { data, isFetching } = useAdminOrderList(filters);
const selectedOdId = ref<string | null>(null);

const setTab = (tab: AdminOrderFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applyFilters = (patch: Partial<AdminOrderFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.orders.title') }}</h1>

    <OrderStatusTabs :tab="filters.tab" :counts="data?.data.counts" @update:tab="setTab" />
    <OrderFilterBar :filters="filters" @change="applyFilters" />
    <OrdersTable
      :items="data?.data.items ?? []"
      :loading="isFetching"
      @select="selectedOdId = $event"
    />

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">
        {{ t('admin.orders.table.total', { n: data.data.total }) }}
      </p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="setPage"
      />
    </div>

    <OrderDetailDrawer :od-id="selectedOdId" @close="selectedOdId = null" />
  </div>
</template>
