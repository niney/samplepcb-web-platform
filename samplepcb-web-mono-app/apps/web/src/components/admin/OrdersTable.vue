<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderListItemType, AdminOrderTabType } from '@sp/api-contract';
import {
  displayCompany,
  formatOdId,
  orderStatusSlug,
  orderStatusVariant,
  type DeliveryInput,
} from '../../admin/useAdminOrders';
import UiBadge from '../ui/UiBadge.vue';

const props = defineProps<{
  items: AdminOrderListItemType[];
  loading: boolean;
  tab: AdminOrderTabType;
  selectedIds: string[];
  deliveryInputs: Record<string, DeliveryInput>;
}>();
const emit = defineEmits<{
  select: [odId: string];
  toggle: [odId: string];
  toggleAll: [checked: boolean];
  updateDelivery: [odId: string, field: keyof DeliveryInput, value: string];
}>();
const { t } = useI18n();

// 선택(체크박스) — 현재 페이지 기준 전체선택/부분선택(QuotesTable 관례).
const allSelected = computed<boolean>(
  () => props.items.length > 0 && props.items.every((i) => props.selectedIds.includes(i.odId)),
);
const someSelected = computed<boolean>(
  () => props.items.some((i) => props.selectedIds.includes(i.odId)) && !allSelected.value,
);
const isSelected = (odId: string): boolean => props.selectedIds.includes(odId);

// 준비 탭 운송장 인라인 입력값(부모 소유 deliveryInputs 에서 조회, 없으면 빈값).
const companyOf = (odId: string): string => props.deliveryInputs[odId]?.deliveryCompany ?? '';
const invoiceNoOf = (odId: string): string => props.deliveryInputs[odId]?.invoiceNo ?? '';
const invoiceTimeOf = (odId: string): string => props.deliveryInputs[odId]?.invoiceTime ?? '';

// 금액 표기 — 라벨은 헤더에 있으므로 셀은 순수 숫자(천단위)만.
const won = (n: number): string => n.toLocaleString('ko-KR');

// od_status(DB 패스스루) → 라벨. 미등록 slug 는 원문 노출(운영 커스텀 상태 방어).
const statusLabel = (s: string): string => {
  const slug = orderStatusSlug(s);
  return slug !== null ? t(`admin.orders.status.${slug}`) : s;
};
const statusVariant = orderStatusVariant;

// 운송장 시각은 KST native 문자열 — 재파싱 없이 앞 16자(YYYY-MM-DD HH:mm)만 노출.
const shortTime = (s: string): string => s.slice(0, 16);

// 페이지 합계(tfoot) — 레거시 orderlist.php tfoot 와 동일 항목.
const totals = computed(() =>
  props.items.reduce(
    (acc, it) => ({
      cartCount: acc.cartCount + it.cartCount,
      orderPrice: acc.orderPrice + it.orderPrice,
      receiptPrice: acc.receiptPrice + it.receiptPrice,
      cancelPrice: acc.cancelPrice + it.cancelPrice,
      couponPrice: acc.couponPrice + it.couponPrice,
      misu: acc.misu + it.misu,
    }),
    { cartCount: 0, orderPrice: 0, receiptPrice: 0, cancelPrice: 0, couponPrice: 0, misu: 0 },
  ),
);
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
    <table class="w-full min-w-[80rem] text-left text-sm" :class="{ 'opacity-60': props.loading }">
      <thead class="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
        <tr>
          <th class="w-10 px-3 py-2">
            <input
              type="checkbox"
              :checked="allSelected"
              :indeterminate="someSelected"
              class="h-4 w-4 cursor-pointer rounded border-gray-300"
              @change="emit('toggleAll', ($event.target as HTMLInputElement).checked)"
            >
          </th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.odId') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.odTime') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.orderer') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.receiver') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.itemCount') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.orderPrice') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.receiptPrice') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.cancelPrice') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.coupon') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.orders.table.misu') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.status') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.settleCase') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.orders.table.delivery') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!props.loading && props.items.length === 0">
          <td colspan="14" class="px-3 py-12 text-center text-gray-400">
            {{ t('admin.orders.table.empty') }}
          </td>
        </tr>
        <tr
          v-for="item in props.items"
          :key="item.odId"
          class="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
          :class="{ 'bg-amber-50/60': item.cancelPrice > 0 }"
          @click="emit('select', item.odId)"
        >
          <td class="w-10 px-3 py-2" @click.stop>
            <input
              type="checkbox"
              :checked="isSelected(item.odId)"
              class="h-4 w-4 cursor-pointer rounded border-gray-300"
              @change="emit('toggle', item.odId)"
            >
          </td>
          <!-- 주문번호 + (M) 모바일 + 테스트 뱃지 -->
          <td class="px-3 py-2">
            <span class="font-medium text-gray-900">{{ formatOdId(item.odId) }}</span>
            <span v-if="item.isMobile" class="ml-1 text-xs text-gray-400">(M)</span>
            <UiBadge
              v-if="item.isTest"
              variant="warn"
              :label="t('admin.orders.table.test')"
              class="ml-1"
            />
          </td>
          <td class="px-3 py-2 whitespace-nowrap text-gray-500">{{ item.odTime }}</td>
          <!-- 주문자 + 회원ID(비회원) + 누적주문수 -->
          <td class="px-3 py-2">
            <p class="text-gray-900">{{ item.odName !== '' ? item.odName : '-' }}</p>
            <p class="text-xs text-gray-400">
              {{ item.mbId !== '' ? item.mbId : t('admin.orders.table.guest') }}
              <span v-if="item.memberOrderCount > 0">({{ item.memberOrderCount }})</span>
            </p>
          </td>
          <td class="px-3 py-2 text-gray-700">{{ item.odBName !== '' ? item.odBName : '-' }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-700">{{ item.cartCount }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-900">{{ won(item.orderPrice) }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-700">{{ won(item.receiptPrice) }}</td>
          <td
            class="px-3 py-2 text-right tabular-nums"
            :class="item.cancelPrice > 0 ? 'font-semibold text-red-600' : 'text-gray-400'"
          >
            {{ won(item.cancelPrice) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-700">{{ won(item.couponPrice) }}</td>
          <td
            class="px-3 py-2 text-right tabular-nums"
            :class="item.misu !== 0 ? 'font-semibold text-red-600' : 'text-gray-400'"
          >
            {{ won(item.misu) }}
          </td>
          <td class="px-3 py-2">
            <UiBadge :variant="statusVariant(item.status)" :label="statusLabel(item.status)" />
          </td>
          <td class="px-3 py-2 text-gray-600">
            {{ item.settleCase !== '' ? item.settleCase : '-' }}
          </td>
          <!-- 운송장 — 준비 탭은 인라인 입력(배송회사/운송장번호/배송일시), 그 외는 읽기 -->
          <td class="px-3 py-2" @click.stop>
            <div v-if="props.tab === '준비'" class="flex flex-col gap-1">
              <input
                type="text"
                :value="companyOf(item.odId)"
                :placeholder="t('admin.orders.table.companyPh')"
                class="w-32 rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                @input="emit('updateDelivery', item.odId, 'deliveryCompany', ($event.target as HTMLInputElement).value)"
              >
              <input
                type="text"
                :value="invoiceNoOf(item.odId)"
                :placeholder="t('admin.orders.table.invoicePh')"
                class="w-32 rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                @input="emit('updateDelivery', item.odId, 'invoiceNo', ($event.target as HTMLInputElement).value)"
              >
              <input
                type="datetime-local"
                :value="invoiceTimeOf(item.odId)"
                class="w-40 rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                @input="emit('updateDelivery', item.odId, 'invoiceTime', ($event.target as HTMLInputElement).value)"
              >
            </div>
            <template v-else-if="item.invoiceNo !== null">
              <p class="text-gray-700">{{ item.invoiceNo }}</p>
              <p class="text-xs text-gray-400">
                <span v-if="displayCompany(item.deliveryCompany) !== '-'">
                  {{ displayCompany(item.deliveryCompany) }}
                </span>
                <span v-if="item.invoiceTime !== null"> · {{ shortTime(item.invoiceTime) }}</span>
              </p>
            </template>
            <span v-else class="text-gray-300">-</span>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="props.items.length > 0" class="border-t border-gray-200 bg-gray-50 font-medium">
        <tr>
          <th colspan="5" class="px-3 py-2 text-right text-gray-600">
            {{ t('admin.orders.table.sum') }}
          </th>
          <td class="px-3 py-2 text-right tabular-nums text-gray-800">{{ totals.cartCount }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-900">{{ won(totals.orderPrice) }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-800">
            {{ won(totals.receiptPrice) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums text-red-600">{{ won(totals.cancelPrice) }}</td>
          <td class="px-3 py-2 text-right tabular-nums text-gray-800">
            {{ won(totals.couponPrice) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums text-red-600">{{ won(totals.misu) }}</td>
          <td colspan="3" />
        </tr>
      </tfoot>
    </table>
  </div>
</template>
