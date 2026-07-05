<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  displayCompany,
  g5ToLocal,
  nowLocalDateTime,
  useAdminOrderList,
  type AdminOrderFilters,
  type DeliveryInput,
} from '../../admin/useAdminOrders';
import OrderStatusTabs from '../../components/admin/OrderStatusTabs.vue';
import OrderFilterBar from '../../components/admin/OrderFilterBar.vue';
import OrderActionBar from '../../components/admin/OrderActionBar.vue';
import OrdersTable from '../../components/admin/OrdersTable.vue';
import OrderDetailDrawer from '../../components/admin/OrderDetailDrawer.vue';
import OrderDeleteModal from '../../components/admin/OrderDeleteModal.vue';
import ExcelDeliveryModal from '../../components/admin/ExcelDeliveryModal.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 관리자 주문내역 — 영카트 orderlist.php 를 sp-vue 로 마이그레이션(목록·상세 + 상태 전이·삭제·엑셀배송).
// 필터·선택은 이 페이지가 단일 소유하고, 탭/필터/페이지 변경 시 1페이지 리셋 + 선택·운송장입력 초기화.
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

// 배치 선택 + 준비 탭 운송장 인라인 입력(부모 소유). lastCompany = 직전 입력 배송회사(다음 행 기본값).
const selectedIds = ref<string[]>([]);
const deliveryInputs = ref<Record<string, DeliveryInput>>({});
const lastCompany = ref('');
const deleteOpen = ref(false);
const excelOpen = ref(false);

const clearSelection = (): void => {
  selectedIds.value = [];
  deliveryInputs.value = {};
};

const toggleOne = (odId: string): void => {
  selectedIds.value = selectedIds.value.includes(odId)
    ? selectedIds.value.filter((id) => id !== odId)
    : [...selectedIds.value, odId];
};
const toggleAll = (checked: boolean): void => {
  const pageIds = (data.value?.data.items ?? []).map((i) => i.odId);
  const pageSet = new Set(pageIds);
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, ...pageIds])]
    : selectedIds.value.filter((id) => !pageSet.has(id));
};

const updateDelivery = (odId: string, field: keyof DeliveryInput, value: string): void => {
  const cur = deliveryInputs.value[odId] ?? {
    deliveryCompany: '',
    invoiceNo: '',
    invoiceTime: nowLocalDateTime(),
  };
  const next: DeliveryInput = { ...cur };
  next[field] = value;
  deliveryInputs.value = { ...deliveryInputs.value, [odId]: next };
  if (field === 'deliveryCompany' && value.trim() !== '') lastCompany.value = value;
};

// 준비 탭 진입/목록 변경 시 각 행 운송장 입력 기본값 채움(배송일시=현재, 배송회사=기존값 또는 직전 입력).
watch(
  [() => data.value?.data.items, () => filters.value.tab],
  ([items, tab]) => {
    if (tab !== '준비' || items === undefined) return;
    const next = { ...deliveryInputs.value };
    for (const it of items) {
      if (next[it.odId] === undefined) {
        const existingCompany = displayCompany(it.deliveryCompany);
        next[it.odId] = {
          deliveryCompany: existingCompany !== '-' ? existingCompany : lastCompany.value,
          invoiceNo: it.invoiceNo ?? '',
          invoiceTime: it.invoiceTime !== null ? g5ToLocal(it.invoiceTime) : nowLocalDateTime(),
        };
      }
    }
    deliveryInputs.value = next;
  },
  { immediate: true },
);

const setTab = (tab: AdminOrderFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
  clearSelection();
};
const applyFilters = (patch: Partial<AdminOrderFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
  clearSelection();
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
  clearSelection();
};
// 페이지당 건수(계약 pageSize max100) — 변경 시 1페이지 리셋.
const PAGE_SIZES = [20, 50, 100] as const;
const setPageSize = (e: Event): void => {
  const size = Number((e.target as HTMLSelectElement).value);
  filters.value = { ...filters.value, pageSize: size, page: 1 };
  clearSelection();
};

const onDeleted = (): void => {
  deleteOpen.value = false;
  clearSelection();
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.orders.title') }}</h1>

    <OrderStatusTabs :tab="filters.tab" :counts="data?.data.counts" @update:tab="setTab" />
    <OrderFilterBar :filters="filters" @change="applyFilters" />
    <OrderActionBar
      :tab="filters.tab"
      :selected-ids="selectedIds"
      :delivery-inputs="deliveryInputs"
      @done="clearSelection"
      @clear="clearSelection"
      @open-delete="deleteOpen = true"
      @open-excel="excelOpen = true"
    />
    <OrdersTable
      :items="data?.data.items ?? []"
      :loading="isFetching"
      :tab="filters.tab"
      :selected-ids="selectedIds"
      :delivery-inputs="deliveryInputs"
      @select="selectedOdId = $event"
      @toggle="toggleOne"
      @toggle-all="toggleAll"
      @update-delivery="updateDelivery"
    />

    <div v-if="data !== undefined" class="flex items-center justify-between gap-3">
      <p class="text-sm text-gray-500">
        {{ t('admin.orders.table.total', { n: data.data.total }) }}
      </p>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 text-sm text-gray-500">
          <span>{{ t('admin.orders.table.perPage') }}</span>
          <select
            class="rounded-md border border-gray-300 px-2 py-1 text-sm"
            :value="filters.pageSize"
            @change="setPageSize"
          >
            <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <UiPagination
          :page="filters.page"
          :page-size="filters.pageSize"
          :total="data.data.total"
          @update:page="setPage"
        />
      </div>
    </div>

    <OrderDetailDrawer :od-id="selectedOdId" @close="selectedOdId = null" />
    <OrderDeleteModal
      v-if="deleteOpen"
      :od-ids="selectedIds"
      @close="deleteOpen = false"
      @deleted="onDeleted"
    />
    <ExcelDeliveryModal v-if="excelOpen" @close="excelOpen = false" />
  </div>
</template>
