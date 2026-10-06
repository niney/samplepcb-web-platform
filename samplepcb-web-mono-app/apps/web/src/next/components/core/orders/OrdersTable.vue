<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AcceptableValue } from 'reka-ui';
import type { AdminOrderListItemType, AdminOrderTabType } from '@sp/api-contract';
import {
  SELECTABLE_DELIVERY_METHODS,
  deliveryMethodSlug,
  displayCompany,
  formatOdId,
  isParcelDeliveryMethod,
  orderStatusSlug,
  type DeliveryInput,
} from '@/admin/useAdminOrders';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Badge } from '@/next/components/ui/badge';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import { orderStatusBadgeVariant } from './order-badges';

// 주문 목록 표 — 옛 components/admin/OrdersTable.vue 와 같은 props·emits·열 순서.
// 행 클릭=상세 서랍, 체크=일괄 처리 선택. 생산완료 탭은 운송장 열이 인라인 입력(방법·배송회사·운송장번호·일시)이다.
// 옛 화면의 '취소액 있는 행 노란 바탕'은 행 색을 쓰지 않는 규칙(docs/ADMIN_NEXT_UI.md §8)에 따라 취소액 칸의
// 붉은 굵은 글자로만 남긴다.
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

const COLSPAN = 14;

// 선택(체크박스) — 현재 페이지 기준 전체/부분 선택.
const allSelected = computed<boolean>(
  () => props.items.length > 0 && props.items.every((i) => props.selectedIds.includes(i.odId)),
);
const someSelected = computed<boolean>(
  () => props.items.some((i) => props.selectedIds.includes(i.odId)) && !allSelected.value,
);
const headChecked = computed<boolean | 'indeterminate'>(() =>
  allSelected.value ? true : someSelected.value ? 'indeterminate' : false,
);
const isSelected = (odId: string): boolean => props.selectedIds.includes(odId);

// 생산완료 탭 운송장 인라인 입력값(부모 소유 deliveryInputs 에서 조회, 없으면 빈값).
const methodOf = (odId: string): string => props.deliveryInputs[odId]?.method ?? 'parcel';
const companyOf = (odId: string): string => props.deliveryInputs[odId]?.deliveryCompany ?? '';
const invoiceNoOf = (odId: string): string => props.deliveryInputs[odId]?.invoiceNo ?? '';
const invoiceTimeOf = (odId: string): string => props.deliveryInputs[odId]?.invoiceTime ?? '';

const updateDelivery = (odId: string, field: keyof DeliveryInput, value: string | number): void => {
  emit('updateDelivery', odId, field, String(value));
};

// 행마다의 배송방법 선택 — ui NativeSelect 의 update 이벤트 타입이 v-model 경로로만 맞아서, 행별 get/set 묶음을
// v-model 로 준다(값은 부모 소유 deliveryInputs 에서 읽고, 바꾸면 updateDelivery 로 올린다).
const methodModel = (odId: string): { value: AcceptableValue } => ({
  get value(): AcceptableValue {
    return methodOf(odId);
  },
  set value(next: AcceptableValue) {
    emit('updateDelivery', odId, 'method', typeof next === 'string' ? next : '');
  },
});

// 배송방법 라벨 — 미등록/''(미지정)은 null(택배 기본이라 표기 생략).
const methodLabel = (method: string): string | null => {
  const slug = deliveryMethodSlug(method);
  return slug !== null ? t(`admin.orders.deliveryMethod.${slug}`) : null;
};
const isNonParcelRecord = (item: AdminOrderListItemType): boolean =>
  item.invoiceNo === null && methodLabel(item.deliveryMethod) !== null && !isParcelDeliveryMethod(item.deliveryMethod);

// 금액 — 라벨은 머리에 있으므로 칸은 숫자(천 단위)만.
const won = (n: number): string => n.toLocaleString('ko-KR');

// od_status(DB 원문) → 라벨. 미등록 slug 는 원문 노출(운영 커스텀 상태 방어).
const statusLabel = (s: string): string => {
  const slug = orderStatusSlug(s);
  return slug !== null ? t(`admin.orders.status.${slug}`) : s;
};

// 운송장 시각은 KST 원문 — 앞 16자(YYYY-MM-DD HH:mm)만.
const shortTime = (s: string): string => s.slice(0, 16);

// 쪽 합계(tfoot) — 레거시 orderlist.php tfoot 와 같은 항목.
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
  <TableCard class="transition-opacity" :class="props.loading && props.items.length > 0 ? 'opacity-60' : ''">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-10">
            <RowCheckbox :checked="headChecked" label="이 페이지 전체 선택" @change="emit('toggleAll', $event)" />
          </TableHead>
          <TableHead>{{ t('admin.orders.table.odId') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.odTime') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.orderer') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.receiver') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.itemCount') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.orderPrice') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.receiptPrice') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.cancelPrice') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.coupon') }}</TableHead>
          <TableHead class="text-right">{{ t('admin.orders.table.misu') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.status') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.settleCase') }}</TableHead>
          <TableHead>{{ t('admin.orders.table.delivery') }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="item in props.items"
          :key="item.odId"
          class="cursor-pointer"
          :data-state="isSelected(item.odId) ? 'selected' : undefined"
          @click="emit('select', item.odId)"
        >
          <TableCell class="w-10" @click.stop>
            <RowCheckbox
              :checked="isSelected(item.odId)"
              :label="`${formatOdId(item.odId)} 선택`"
              @change="emit('toggle', item.odId)"
            />
          </TableCell>
          <!-- 주문번호 + (M) 모바일 + 테스트 배지 -->
          <TableCell class="whitespace-nowrap">
            <span class="font-medium tabular-nums">{{ formatOdId(item.odId) }}</span>
            <span v-if="item.isMobile" class="text-muted-foreground ml-1 text-xs">(M)</span>
            <Badge v-if="item.isTest" variant="warning" class="ml-1.5">{{ t('admin.orders.table.test') }}</Badge>
          </TableCell>
          <TableCell class="text-muted-foreground whitespace-nowrap tabular-nums">{{ item.odTime }}</TableCell>
          <!-- 주문자 + 회원ID(비회원) + 누적 주문 수 -->
          <TableCell>
            <!-- PCB 주문은 주문자 칸에 회사·프로젝트·파일명까지 붙어 길다 — 두 줄까지 접고 전체는 title 로. -->
            <span class="line-clamp-2 max-w-xs min-w-40 whitespace-normal" :title="item.odName">
              {{ item.odName !== '' ? item.odName : '-' }}
            </span>
            <span class="text-muted-foreground block text-xs">
              {{ item.mbId !== '' ? item.mbId : t('admin.orders.table.guest') }}
              <span v-if="item.memberOrderCount > 0" class="tabular-nums">({{ item.memberOrderCount }})</span>
            </span>
          </TableCell>
          <TableCell>
            <span class="block max-w-40 truncate" :title="item.odBName">{{ item.odBName !== '' ? item.odBName : '-' }}</span>
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ item.cartCount }}</TableCell>
          <TableCell class="text-right font-medium tabular-nums">{{ won(item.orderPrice) }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ won(item.receiptPrice) }}</TableCell>
          <TableCell
            class="text-right tabular-nums"
            :class="item.cancelPrice > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'"
          >
            {{ won(item.cancelPrice) }}
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ won(item.couponPrice) }}</TableCell>
          <TableCell
            class="text-right tabular-nums"
            :class="item.misu !== 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'"
          >
            {{ won(item.misu) }}
          </TableCell>
          <TableCell>
            <Badge :variant="orderStatusBadgeVariant(item.status)">{{ statusLabel(item.status) }}</Badge>
          </TableCell>
          <TableCell class="text-muted-foreground">{{ item.settleCase !== '' ? item.settleCase : '-' }}</TableCell>
          <!-- 운송장 — 생산완료 탭은 인라인 입력, 그 외는 읽기. 비택배(퀵·방문수령·직배송)면 회사·송장 입력을 접는다. -->
          <TableCell @click.stop>
            <!-- 두 줄: [방법][일시] / [배송회사][운송장번호] — 옛 화면의 세로 4단보다 행 높이가 절반이다. -->
            <div v-if="props.tab === '생산완료'" class="flex flex-col gap-1">
              <div class="flex gap-1">
                <NativeSelect v-model="methodModel(item.odId).value" class="w-36" aria-label="배송 방법">
                  <NativeSelectOption v-for="m in SELECTABLE_DELIVERY_METHODS" :key="m" :value="m">
                    {{ t(`admin.orders.deliveryMethod.${m}`) }}
                  </NativeSelectOption>
                </NativeSelect>
                <Input
                  type="datetime-local"
                  :model-value="invoiceTimeOf(item.odId)"
                  aria-label="배송 일시"
                  class="w-52 shrink-0 tabular-nums"
                  @update:model-value="updateDelivery(item.odId, 'invoiceTime', $event)"
                />
              </div>
              <div v-if="isParcelDeliveryMethod(methodOf(item.odId))" class="flex gap-1">
                <Input
                  :model-value="companyOf(item.odId)"
                  :placeholder="t('admin.orders.table.companyPh')"
                  :aria-label="t('admin.orders.table.companyPh')"
                  class="w-36 shrink-0"
                  @update:model-value="updateDelivery(item.odId, 'deliveryCompany', $event)"
                />
                <Input
                  :model-value="invoiceNoOf(item.odId)"
                  :placeholder="t('admin.orders.table.invoicePh')"
                  :aria-label="t('admin.orders.table.invoicePh')"
                  class="w-52 shrink-0 tabular-nums"
                  @update:model-value="updateDelivery(item.odId, 'invoiceNo', $event)"
                />
              </div>
            </div>
            <!-- 비택배 처리 건 — 송장 대신 방법 라벨이 첫 줄(운영 관행: 퀵·방문수령은 송장 공란) -->
            <template v-else-if="isNonParcelRecord(item)">
              <span class="block font-medium">{{ methodLabel(item.deliveryMethod) }}</span>
              <span v-if="item.invoiceTime !== null" class="text-muted-foreground block text-xs tabular-nums">
                {{ shortTime(item.invoiceTime) }}
              </span>
            </template>
            <template v-else-if="item.invoiceNo !== null">
              <span class="block tabular-nums">{{ item.invoiceNo }}</span>
              <span class="text-muted-foreground block text-xs tabular-nums">
                <template v-if="displayCompany(item.deliveryCompany) !== '-'">{{ displayCompany(item.deliveryCompany) }}</template>
                <template v-if="item.invoiceTime !== null"> · {{ shortTime(item.invoiceTime) }}</template>
              </span>
            </template>
            <span v-else class="text-muted-foreground">-</span>
          </TableCell>
        </TableRow>
        <TableEmptyRow
          v-if="props.items.length === 0"
          :colspan="COLSPAN"
          :loading="props.loading"
          :text="t('admin.orders.table.empty')"
        />
      </TableBody>
      <TableFooter v-if="props.items.length > 0">
        <TableRow>
          <TableHead colspan="5" class="text-right">{{ t('admin.orders.table.sum') }}</TableHead>
          <TableCell class="text-right tabular-nums">{{ totals.cartCount }}</TableCell>
          <TableCell class="text-right font-semibold tabular-nums">{{ won(totals.orderPrice) }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ won(totals.receiptPrice) }}</TableCell>
          <TableCell class="text-destructive text-right tabular-nums">{{ won(totals.cancelPrice) }}</TableCell>
          <TableCell class="text-right tabular-nums">{{ won(totals.couponPrice) }}</TableCell>
          <TableCell class="text-destructive text-right tabular-nums">{{ won(totals.misu) }}</TableCell>
          <TableCell colspan="3" />
        </TableRow>
      </TableFooter>
    </Table>
  </TableCard>
</template>
