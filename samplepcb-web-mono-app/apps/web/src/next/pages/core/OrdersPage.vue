<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { AcceptableValue } from 'reka-ui';
import type { AdminOrderTabType } from '@sp/api-contract';
import {
  deliveryMethodSlug,
  displayCompany,
  g5ToLocal,
  nowLocalDateTime,
  useAdminOrderList,
  type AdminOrderFilters,
  type DeliveryInput,
} from '@/admin/useAdminOrders';
import { queryPage, queryTab, replaceListQuery } from '@/next/lib/list-query';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import ExcelDeliveryDialog from '@/next/components/core/orders/ExcelDeliveryDialog.vue';
import OrderActionBar from '@/next/components/core/orders/OrderActionBar.vue';
import OrderDeleteDialog from '@/next/components/core/orders/OrderDeleteDialog.vue';
import OrderDetailDrawer from '@/next/components/core/orders/OrderDetailDrawer.vue';
import OrderFilterBar from '@/next/components/core/orders/OrderFilterBar.vue';
import OrdersTable from '@/next/components/core/orders/OrdersTable.vue';

// 통합 주문내역 — 옛 pages/admin/AdminOrders.vue(영카트 orderlist.php 이식)의 리뉴얼. 배치·동작은 같다:
// 상태 탭 → 필터 → 일괄 처리 바 → 표 → 쪽 넘김, 행을 누르면 상세 서랍.
// 필터·선택은 이 화면이 단일 소유하고, 탭/필터/쪽 변경 시 1쪽으로 + 선택·운송장 입력을 비운다.
// 탭·쪽은 주소에도 싣는다(리뉴얼 목록 공통 — 새로고침·뒤로가기에 같은 자리). 검색·기간 등 필터는 옛 화면처럼 화면 상태만.
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// 주문상태 탭 — 계약 AdminOrderTab 16종(표준 8 + 제작 8, 한글 리터럴). i18n 라벨은 slug 로 우회한다.
// counts 는 탭 미반영 분포라 탭을 오가도 숫자가 유지된다.
const TABS: readonly { key: AdminOrderTabType; slug: string }[] = [
  { key: '전체', slug: 'all' },
  { key: '주문', slug: 'order' },
  { key: '입금', slug: 'deposit' },
  { key: '준비', slug: 'ready' },
  // PCB 제작 단계(레거시 이식) — '준비'와 '배송' 사이.
  { key: '가격확인', slug: 'priceCheck' },
  { key: '파일검사', slug: 'fileCheck' },
  { key: 'EQ', slug: 'eq' },
  { key: '생산시작', slug: 'prodStart' },
  { key: '생산중', slug: 'producing' },
  { key: '품질시험', slug: 'qualityTest' },
  { key: '생산완료', slug: 'prodDone' },
  { key: 'A/S', slug: 'afterService' },
  { key: '배송', slug: 'shipping' },
  { key: '완료', slug: 'done' },
  { key: '취소', slug: 'cancelled' },
  { key: '부분취소', slug: 'partialCancel' },
];
const TAB_KEYS = TABS.map((tab) => tab.key);

const tab = ref<AdminOrderTabType>(queryTab(route.query.tab, TAB_KEYS, '전체'));
const filters = ref<AdminOrderFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: tab.value,
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
const items = computed(() => data.value?.data.items ?? []);
const counts = computed(() => data.value?.data.counts);

// 취소·부분취소는 주의가 필요한 상태 — 건수가 있으면 경고 배지로 띄운다(옛 화면의 amber 건수).
const tabs = computed<QueueTab<AdminOrderTabType>[]>(() =>
  TABS.map(({ key, slug }) => ({
    key,
    label: t(`admin.orders.tabs.${slug}`),
    count: counts.value === undefined ? null : counts.value[key],
    attention: key === '취소' || key === '부분취소',
  })),
);

const selectedOdId = ref<string | null>(null);

// 일괄 선택 + 생산완료 탭 운송장 인라인 입력(이 화면 소유). lastCompany = 직전 입력 배송회사(다음 행 기본값).
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
  const pageIds = items.value.map((i) => i.odId);
  const pageSet = new Set(pageIds);
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, ...pageIds])]
    : selectedIds.value.filter((id) => !pageSet.has(id));
};

const updateDelivery = (odId: string, field: keyof DeliveryInput, value: string): void => {
  const cur = deliveryInputs.value[odId] ?? {
    method: 'parcel' as const,
    deliveryCompany: '',
    invoiceNo: '',
    invoiceTime: nowLocalDateTime(),
  };
  const next: DeliveryInput = { ...cur };
  if (field === 'method') {
    next.method = deliveryMethodSlug(value) !== null ? (value as DeliveryInput['method']) : 'parcel';
  } else {
    next[field] = value;
  }
  deliveryInputs.value = { ...deliveryInputs.value, [odId]: next };
  if (field === 'deliveryCompany' && value.trim() !== '') lastCompany.value = value;
};

// 생산완료 탭 진입/목록 변경 시 각 행 운송장 입력 기본값(배송일시=지금, 배송회사=기존값 또는 직전 입력).
watch(
  [() => data.value?.data.items, () => filters.value.tab],
  ([list, currentTab]) => {
    if (currentTab !== '생산완료' || list === undefined) return;
    const next = { ...deliveryInputs.value };
    for (const it of list) {
      if (next[it.odId] === undefined) {
        const existingCompany = displayCompany(it.deliveryCompany);
        const method = deliveryMethodSlug(it.deliveryMethod);
        next[it.odId] = {
          method: method !== null ? (method as DeliveryInput['method']) : 'parcel',
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

watch(tab, (key) => {
  filters.value = { ...filters.value, tab: key, page: 1 };
  clearSelection();
});
const applyFilters = (patch: Partial<AdminOrderFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
  clearSelection();
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
  clearSelection();
};
// 페이지당 건수(계약 pageSize max 100) — 바꾸면 1쪽으로.
const PAGE_SIZES = [20, 50, 100] as const;
const pageSizeModel = computed<AcceptableValue>({
  get: () => filters.value.pageSize,
  set: (value) => {
    const size = PAGE_SIZES.find((n) => n === Number(value));
    if (size === undefined) return;
    filters.value = { ...filters.value, pageSize: size, page: 1 };
    clearSelection();
  },
});

watch(
  () => [filters.value.tab, filters.value.page] as const,
  ([currentTab, page]) => {
    replaceListQuery(router, route.query, { tab: currentTab, page, q: '' });
  },
  { immediate: true },
);

const onDeleted = (): void => {
  deleteOpen.value = false;
  clearSelection();
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      :title="t('admin.orders.title')"
      description="영카트 주문 원장 — 상태 탭에서 골라 일괄 처리하고, 행을 누르면 상세(수납·취소·상태 직접 변경)가 열립니다."
    />

    <QueueTabs v-model="tab" :tabs="tabs" />
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
      :items="items"
      :loading="isFetching"
      :tab="filters.tab"
      :selected-ids="selectedIds"
      :delivery-inputs="deliveryInputs"
      @select="selectedOdId = $event"
      @toggle="toggleOne"
      @toggle-all="toggleAll"
      @update-delivery="updateDelivery"
    />

    <div v-if="data !== undefined" class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <ListPagination
        class="flex-1"
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="setPage"
      />
      <div class="flex items-center gap-2">
        <label for="orders-page-size" class="text-muted-foreground text-sm">{{ t('admin.orders.table.perPage') }}</label>
        <NativeSelect id="orders-page-size" v-model="pageSizeModel" class="w-20">
          <NativeSelectOption v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</NativeSelectOption>
        </NativeSelect>
      </div>
    </div>

    <OrderDetailDrawer :od-id="selectedOdId" @close="selectedOdId = null" />
    <OrderDeleteDialog v-if="deleteOpen" :od-ids="selectedIds" @close="deleteOpen = false" @deleted="onDeleted" />
    <ExcelDeliveryDialog v-if="excelOpen" @close="excelOpen = false" />
  </div>
</template>
