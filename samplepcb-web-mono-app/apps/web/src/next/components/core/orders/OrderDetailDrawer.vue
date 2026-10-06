<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ExternalLinkIcon, PrinterIcon } from '@lucide/vue';
import type { AdminOrderForceStatusRequestType } from '@sp/api-contract';
import { formatOdId, useAdminOrderDetail, type CancelItemTarget, type OrderForceTarget } from '@/admin/useAdminOrders';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/next/components/ui/sheet';
import { Spinner } from '@/next/components/ui/spinner';
import AmountsSection from './detail/AmountsSection.vue';
import DeliverySection from './detail/DeliverySection.vue';
import ForceStatusDialog from './detail/ForceStatusDialog.vue';
import ItemCancelDialog from './detail/ItemCancelDialog.vue';
import ItemsSection from './detail/ItemsSection.vue';
import MemoSection from './detail/MemoSection.vue';
import OrderOverview from './detail/OrderOverview.vue';
import OrderPrintDialog from './detail/OrderPrintDialog.vue';
import OrdererSection from './detail/OrdererSection.vue';
import ProcessSection from './detail/ProcessSection.vue';
import ReceiverSection from './detail/ReceiverSection.vue';
import { useOrderErrorText, useOrderStatusLabel } from './detail/order-detail';

// 주문 상세 서랍(오른쪽, 넓은 2단) — 옛 components/admin/OrderDetailDrawer.vue 의 짝(같은 props·emits).
// odId=null 이면 닫힘. 읽기 + 부분 편집(주문자·받는분·메모·무통장 입금 조정·환불 기록) + 서랍 안 다음 단계
// 처리 + 상태 직접 변경 + 행별 취소/반품/품절 + 주문서 인쇄. 배치·정보 순서는 옛 서랍과 같다:
//   좌 = 개요 → 주문자 → 받는분 → 배송 → 메모, 우 = 처리 → 금액 → 주문 상품, 아래 = PHP 관리자 위임.
// 구역은 detail/ 조각들이 맡고, 조각은 주문번호로 key 를 걸어 다른 주문을 열면 편집 중이던 값·결과가
// 새로 시작한다(옛 서랍의 "주문 전환 때만 리셋" 규칙 — 같은 주문 다시 불러오기에는 편집 값이 남는다).
// 확인 대화상자 셋(인쇄·행 처리·상태 직접 변경)은 여기서 띄운다 — 떠 있는 동안 Esc·바깥 클릭이 서랍을 닫지 않는다.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const statusLabel = useOrderStatusLabel();

const odIdRef = computed(() => props.odId);
const { data, isLoading, error } = useAdminOrderDetail(odIdRef);
const errorText = useOrderErrorText();
// 불러오기 실패(없는 주문 등) — 옛 서랍은 빈 본문이었다. 왜 비었는지 한 줄로 알린다.
const loadError = computed(() => (props.odId === null ? null : errorText(error.value)));
const detail = computed(() => data.value?.data ?? null);
const order = computed(() => detail.value?.order ?? null);
const isBankTransfer = computed(() => order.value?.settleCase === '무통장');

type ForceDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;
const printOpen = ref<string | null>(null);
// 카트행 취소/반품/품절 대상(확인 대화상자). null = 닫힘.
const itemAction = ref<{ ctId: number; target: CancelItemTarget; label: string } | null>(null);
// 상태 직접 변경 — 펼침(처리 섹션) + 확인 대화상자 대상.
const forceOpen = ref(false);
const forceConfirm = ref<{ target: OrderForceTarget; delivery: ForceDelivery | null } | null>(null);

// 다른 주문을 열거나 서랍이 닫히면 펼침·대화상자를 정리한다(옛 서랍의 주문 전환 리셋·닫힘 정리).
watch(odIdRef, () => {
  printOpen.value = null;
  itemAction.value = null;
  forceConfirm.value = null;
  forceOpen.value = false;
});

const onForceDone = (): void => {
  forceConfirm.value = null;
  forceOpen.value = false;
};

const openPrint = (): void => {
  if (order.value !== null) printOpen.value = order.value.odId;
};

// 심층 편집(주문정보 전체·부분취소)만 PHP 위임(새 탭, SPA base 밖).
const phpUrl = computed(() =>
  order.value === null ? '#' : `/adm/shop_admin/orderform.php?od_id=${encodeURIComponent(order.value.odId)}`,
);

// 위에 대화상자가 떠 있으면 Esc·바깥 클릭은 그 대화상자 몫이다 — 서랍까지 닫히지 않게 막는다.
const layerAbove = (): boolean => printOpen.value !== null || itemAction.value !== null || forceConfirm.value !== null;
const onEscapeKeyDown = (event: KeyboardEvent): void => {
  if (layerAbove()) event.preventDefault();
};
const onInteractOutside = (event: Event): void => {
  if (layerAbove()) event.preventDefault();
};
const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Sheet :open="props.odId !== null" @update:open="onOpenChange">
    <SheetContent
      side="right"
      class="w-full sm:max-w-4xl"
      @escape-key-down="onEscapeKeyDown"
      @interact-outside="onInteractOutside"
    >
      <div class="flex h-full min-h-0 flex-col">
        <header class="flex shrink-0 items-start justify-between gap-3 border-b py-3 pr-12 pl-5">
          <div class="min-w-0">
            <SheetTitle>
              <span class="block truncate tabular-nums">{{ order !== null ? formatOdId(order.odId) : props.odId }}</span>
            </SheetTitle>
            <SheetDescription class="mt-0.5">
              <span v-if="order !== null" class="tabular-nums">
                {{ order.odTime }}
                <template v-if="order.isMobile">· (M)</template>
              </span>
              <template v-else>주문 상세</template>
            </SheetDescription>
          </div>
          <Button v-if="order !== null" variant="outline" size="sm" @click="openPrint">
            <PrinterIcon />
            {{ t('admin.orders.drawer.print') }}
          </Button>
        </header>

        <div class="bg-muted/30 min-h-0 flex-1 overflow-y-auto">
          <p v-if="isLoading" class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Spinner />
            불러오는 중…
          </p>

          <div v-else-if="order !== null && detail !== null" :key="order.odId" class="flex flex-col gap-4 p-4 sm:p-5">
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <!-- 좌: 개요 / 주문자 / 받는분 / 배송 / 메모 -->
              <div class="flex min-w-0 flex-col gap-4">
                <OrderOverview :order="order" :items="detail.items" />
                <OrdererSection :order="order" :member-order-count="detail.memberOrderCount" />
                <ReceiverSection :order="order" />
                <DeliverySection :order="order" />
                <MemoSection :order="order" />
              </div>
              <!-- 우: 처리 / 금액 / 주문 상품 -->
              <div class="flex min-w-0 flex-col gap-4">
                <ProcessSection v-model:force-open="forceOpen" :order="order" @force="forceConfirm = $event" />
                <AmountsSection :order="order" />
                <ItemsSection :items="detail.items" :is-bank-transfer="isBankTransfer" @action="itemAction = $event" />
              </div>
            </div>

            <!-- PHP 관리자 위임 (전체 폭) -->
            <div class="border-t pt-3">
              <p class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.phpNotice') }}</p>
              <Button variant="link" size="sm" as-child class="-ml-2.5">
                <a :href="phpUrl" target="_blank" rel="noopener noreferrer">
                  {{ t('admin.orders.drawer.openPhp') }}
                  <ExternalLinkIcon />
                </a>
              </Button>
            </div>
          </div>

          <div v-else-if="loadError !== null" class="p-4 sm:p-5">
            <Alert variant="destructive" size="sm">
              <AlertDescription>{{ loadError }}</AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <OrderPrintDialog v-if="printOpen !== null" :od-id="printOpen" @close="printOpen = null" />

  <ItemCancelDialog
    v-if="itemAction !== null && order !== null"
    :od-id="order.odId"
    :ct-ids="[itemAction.ctId]"
    :target="itemAction.target"
    :item-label="itemAction.label"
    @close="itemAction = null"
    @done="itemAction = null"
  />

  <ForceStatusDialog
    v-if="forceConfirm !== null && order !== null"
    :od-id="order.odId"
    :target="forceConfirm.target"
    :target-label="statusLabel(forceConfirm.target)"
    :delivery="forceConfirm.delivery"
    :misu="order.misu"
    @close="forceConfirm = null"
    @done="onForceDone"
  />
</template>
