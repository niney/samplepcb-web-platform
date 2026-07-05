<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType } from '@sp/api-contract';
import {
  formatOdId,
  orderStatusSlug,
  orderStatusVariant,
  useAdminOrderDetail,
} from '../../admin/useAdminOrders';
import { formatKrw } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';

// 주문 상세 드로어(우측 슬라이드 오버, 읽기 전용). odId=null 이면 닫힘.
// 상태 전이·운송장 입력 등 처리 액션은 WP4 전까지 PHP 관리자(orderform.php)에 위임한다.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const odIdRef = computed(() => props.odId);
const { data, isLoading } = useAdminOrderDetail(odIdRef);
const detail = computed(() => data.value?.data ?? null);
const order = computed(() => detail.value?.order ?? null);

// 주소 조합("[우편] 기본 상세 참고") — 빈 조각은 제외. 전부 비면 ''(템플릿이 '-' 처리).
const formatAddr = (a: {
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
}): string => {
  const zip = [a.zip1, a.zip2].filter((x) => x !== '').join('-');
  const rest = [a.addr1, a.addr2, a.addr3].filter((x) => x !== '').join(' ');
  return `${zip !== '' ? `[${zip}] ` : ''}${rest}`.trim();
};

// 카트행 표시 금액 — 개별 io 가격(ioPrice>0)이 있으면 그것, 없으면 품목가(ctPrice).
const linePrice = (it: AdminOrderCartItemType): number => (it.ioPrice > 0 ? it.ioPrice : it.ctPrice);

// od_status 라벨 — 미등록 slug 는 원문 노출(OrdersTable 과 동일 규칙).
const statusLabel = (s: string): string => {
  const slug = orderStatusSlug(s);
  return slug !== null ? t(`admin.orders.status.${slug}`) : s;
};

// 상태 전이·삭제는 PHP 관리자 위임 — 새 탭(SPA base /app 밖 절대경로).
const phpUrl = computed<string>(() =>
  order.value === null
    ? '#'
    : `/adm/shop_admin/orderform.php?od_id=${encodeURIComponent(order.value.odId)}`,
);

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props.odId !== null" class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/30" @click="emit('close')" />
      <aside
        class="absolute right-0 top-0 flex h-full w-[36rem] max-w-full flex-col bg-white shadow-xl"
      >
        <!-- 헤더 -->
        <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-gray-900">
              {{ order !== null ? formatOdId(order.odId) : props.odId }}
            </h2>
            <p v-if="order !== null" class="text-xs text-gray-400">
              {{ order.odTime }}
              <span v-if="order.isMobile">· (M)</span>
            </p>
          </div>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            @click="emit('close')"
          >
            {{ t('admin.orders.drawer.close') }}
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <p v-if="isLoading" class="py-8 text-center text-sm text-gray-400">…</p>

          <template v-else-if="order !== null && detail !== null">
            <!-- 주문 개요 -->
            <div class="flex flex-wrap items-center gap-1.5">
              <UiBadge :variant="orderStatusVariant(order.status)" :label="statusLabel(order.status)" />
              <span v-if="order.isTest" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {{ t('admin.orders.table.test') }}
              </span>
              <span class="text-sm text-gray-500">
                {{ order.settleCase !== '' ? order.settleCase : t('admin.orders.drawer.noSettle') }}
              </span>
            </div>
            <dl
              v-if="order.payment.pg !== '' || order.payment.tno !== '' || order.payment.appNo !== ''"
              class="mt-3 grid grid-cols-3 gap-x-4 gap-y-1 text-sm"
            >
              <div v-if="order.payment.pg !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.pg') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.pg }}</dd>
              </div>
              <div v-if="order.payment.tno !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.tno') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.tno }}</dd>
              </div>
              <div v-if="order.payment.appNo !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.appNo') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.appNo }}</dd>
              </div>
            </dl>

            <!-- 주문자 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.orderer') }}
              </h3>
              <dl class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.name') }}</dt>
                  <dd class="text-gray-800">
                    {{ order.odName !== '' ? order.odName : '-' }}
                    <span class="ml-1 text-xs text-gray-400">
                      {{ order.mbId !== '' ? order.mbId : t('admin.orders.table.guest') }}
                      <span v-if="detail.memberOrderCount > 0">({{ detail.memberOrderCount }})</span>
                    </span>
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.email') }}</dt>
                  <dd class="min-w-0 break-all text-gray-800">{{ order.email !== '' ? order.email : '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.tel') }}</dt>
                  <dd class="text-gray-800">{{ order.odHp !== '' ? order.odHp : (order.odTel !== '' ? order.odTel : '-') }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.address') }}</dt>
                  <dd class="min-w-0 text-gray-800">{{ formatAddr(order.addr) !== '' ? formatAddr(order.addr) : '-' }}</dd>
                </div>
                <div v-if="order.depositName !== ''" class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.depositName') }}</dt>
                  <dd class="text-gray-800">{{ order.depositName }}</dd>
                </div>
              </dl>
            </section>

            <!-- 받는분 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.receiver') }}
              </h3>
              <dl class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.name') }}</dt>
                  <dd class="text-gray-800">{{ order.receiver.name !== '' ? order.receiver.name : '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.tel') }}</dt>
                  <dd class="text-gray-800">
                    {{ order.receiver.hp !== '' ? order.receiver.hp : (order.receiver.tel !== '' ? order.receiver.tel : '-') }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.address') }}</dt>
                  <dd class="min-w-0 text-gray-800">
                    {{ formatAddr(order.receiver) !== '' ? formatAddr(order.receiver) : '-' }}
                  </dd>
                </div>
              </dl>
            </section>

            <!-- 배송 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.delivery') }}
              </h3>
              <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.invoiceNo') }}</dt>
                  <dd class="text-gray-800">{{ order.invoiceNo ?? '-' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.deliveryCompany') }}</dt>
                  <dd class="text-gray-800">{{ order.deliveryCompany ?? '-' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.invoiceTime') }}</dt>
                  <dd class="text-gray-800">{{ order.invoiceTime ?? '-' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.hopeDate') }}</dt>
                  <dd class="text-gray-800">{{ order.hopeDate ?? '-' }}</dd>
                </div>
              </dl>
            </section>

            <!-- 금액 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.amounts') }}
              </h3>
              <dl class="mt-2 divide-y divide-gray-100 text-sm">
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.orderPrice') }}</dt>
                  <dd class="tabular-nums font-medium text-gray-900">{{ formatKrw(order.orderPrice) }}</dd>
                </div>
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.sendCost') }}</dt>
                  <dd class="tabular-nums text-gray-800">
                    {{ formatKrw(order.amounts.sendCost + order.amounts.sendCost2) }}
                  </dd>
                </div>
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.receiptPrice') }}</dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.receiptPrice) }}</dd>
                </div>
                <div v-if="order.amounts.receiptPoint !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.point') }}</dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.amounts.receiptPoint) }}</dd>
                </div>
                <div v-if="order.couponPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">
                    {{ t('admin.orders.drawer.coupon') }}
                    <span class="text-xs text-gray-400">
                      ({{ t('admin.orders.drawer.cartCoupon') }} {{ formatKrw(order.amounts.cartCoupon) }} ·
                      {{ t('admin.orders.drawer.itemCoupon') }} {{ formatKrw(order.amounts.coupon) }} ·
                      {{ t('admin.orders.drawer.sendCoupon') }} {{ formatKrw(order.amounts.sendCoupon) }})
                    </span>
                  </dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.couponPrice) }}</dd>
                </div>
                <div v-if="order.cancelPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.cancelPrice') }}</dt>
                  <dd class="tabular-nums font-medium text-red-600">{{ formatKrw(order.cancelPrice) }}</dd>
                </div>
                <div v-if="order.amounts.refundPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.refund') }}</dt>
                  <dd class="tabular-nums text-red-600">{{ formatKrw(order.amounts.refundPrice) }}</dd>
                </div>
                <div v-if="order.misu !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.misu') }}</dt>
                  <dd class="tabular-nums font-medium text-red-600">{{ formatKrw(order.misu) }}</dd>
                </div>
                <div class="flex justify-between py-1 text-xs text-gray-400">
                  <dt>{{ t('admin.orders.drawer.tax') }}</dt>
                  <dd class="tabular-nums">
                    {{ t('admin.orders.drawer.taxMny') }} {{ formatKrw(order.amounts.taxMny) }} ·
                    {{ t('admin.orders.drawer.vatMny') }} {{ formatKrw(order.amounts.vatMny) }} ·
                    {{ t('admin.orders.drawer.freeMny') }} {{ formatKrw(order.amounts.freeMny) }}
                  </dd>
                </div>
              </dl>
            </section>

            <!-- 메모 -->
            <section v-if="order.memo !== '' || order.shopMemo !== ''" class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.memo') }}
              </h3>
              <div v-if="order.memo !== ''" class="mt-2">
                <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.customerMemo') }}</p>
                <p class="whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                  {{ order.memo }}
                </p>
              </div>
              <div v-if="order.shopMemo !== ''" class="mt-2">
                <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.shopMemo') }}</p>
                <p class="whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                  {{ order.shopMemo }}
                </p>
              </div>
            </section>

            <!-- 주문 상품(카트행 ct_id 단위) -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.items') }}
                <span class="text-gray-400">({{ detail.items.length }})</span>
              </h3>
              <ul v-if="detail.items.length > 0" class="mt-2 space-y-2">
                <li
                  v-for="it in detail.items"
                  :key="it.ctId"
                  class="flex gap-3 rounded-md border border-gray-200 p-2"
                >
                  <img
                    v-if="it.quote !== null && it.quote.thumbUrl !== null"
                    :src="it.quote.thumbUrl"
                    alt=""
                    class="h-14 w-14 shrink-0 rounded border border-gray-200 object-cover"
                  >
                  <div
                    v-else
                    class="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-gray-200 text-[10px] text-gray-300"
                  >
                    PCB
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <p class="min-w-0 break-words text-sm text-gray-900">{{ it.itName }}</p>
                      <span class="shrink-0 tabular-nums text-sm text-gray-800">
                        {{ formatKrw(linePrice(it)) }}
                      </span>
                    </div>
                    <p v-if="it.quote !== null && it.quote.specSummary !== ''" class="mt-0.5 text-xs text-gray-500">
                      {{ it.quote.specSummary }}
                    </p>
                    <p v-else-if="it.ctOption !== ''" class="mt-0.5 text-xs text-gray-500">
                      {{ it.ctOption }}
                    </p>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      <span class="text-xs text-gray-400">
                        {{ t('admin.orders.drawer.itemQty', { n: it.ctQty }) }}
                      </span>
                      <span v-if="it.ctStatus !== ''" class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {{ it.ctStatus }}
                      </span>
                      <UiBadge
                        v-if="it.quote !== null"
                        :variant="it.quote.quoteStatus"
                        :label="t(`admin.quotes.badge.${it.quote.quoteStatus}`)"
                      />
                      <span
                        v-if="it.quote !== null && it.quote.finalPrice !== null"
                        class="text-xs tabular-nums text-gray-500"
                      >
                        {{ t('admin.orders.drawer.finalPrice') }} {{ formatKrw(it.quote.finalPrice) }}
                      </span>
                    </div>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-2 text-sm text-gray-400">{{ t('admin.orders.drawer.noItems') }}</p>
            </section>

            <!-- PHP 관리자 위임 -->
            <div class="mt-6 border-t border-gray-200 pt-4">
              <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.phpNotice') }}</p>
              <a
                :href="phpUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="mt-1 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                {{ t('admin.orders.drawer.openPhp') }} ↗
              </a>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
