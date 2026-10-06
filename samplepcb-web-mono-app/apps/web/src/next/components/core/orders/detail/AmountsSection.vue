<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PencilIcon } from '@lucide/vue';
import type { AdminOrderDetailOrderType } from '@sp/api-contract';
import {
  g5ToLocal,
  nowLocalDateTime,
  toG5DateTime,
  useOrderReceiptMutation,
  useOrderRefundMutation,
} from '@/admin/useAdminOrders';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { useOrderErrorText } from './order-detail';

// 금액 — 합계·배송비·입금·포인트·쿠폰·취소·환불·미수(또는 과입금)·과세 내역 + 무통장 입금 조정
// (PATCH /receipt) + 환불 처리 기록(PATCH /refund, 여정 10호). 옛 서랍의 금액 섹션 그대로.
const props = defineProps<{ order: AdminOrderDetailOrderType }>();
const { t } = useI18n();
const errorText = useOrderErrorText();

// 입금 조정은 무통장 한정(그 외 결제수단은 PG 원장이 진실이라 수동 조정 금지 — 서버 409).
const isBankTransfer = computed(() => props.order.settleCase === '무통장');

// ── 무통장 입금 조정 ────────────────────────────────────────────────────────
const receiptEditing = ref(false);
const receiptForm = ref<{ receiptPrice: number; receiptTime: string; depositName: string }>({
  receiptPrice: 0,
  receiptTime: '',
  depositName: '',
});
const receiptFull = ref(false);
const receiptPrevPrice = ref(0);
const { mutate: saveReceipt, isPending: receiptPending, error: receiptErr, reset: resetReceipt } =
  useOrderReceiptMutation();
const receiptError = computed(() => errorText(receiptErr.value));

const startReceiptEdit = (): void => {
  const o = props.order;
  receiptForm.value = {
    receiptPrice: o.receiptPrice > 0 ? o.receiptPrice : o.orderPrice,
    receiptTime: o.receiptTime !== null ? g5ToLocal(o.receiptTime) : nowLocalDateTime(),
    depositName: o.depositName !== '' ? o.depositName : o.odName,
  };
  receiptFull.value = false;
  receiptPrevPrice.value = 0;
  resetReceipt();
  receiptEditing.value = true;
};
// '미수금 전액 입력'(PHP 결제금액 입력) — 켜면 입금액=기존 입금액+미수금(=미수 0 되는 값), 끄면 직전 값 복원.
const fullReceiptAmount = computed(() => props.order.receiptPrice + props.order.misu);
const onReceiptFullToggle = (value: boolean | 'indeterminate'): void => {
  receiptFull.value = value === true;
  if (receiptFull.value) {
    receiptPrevPrice.value = receiptForm.value.receiptPrice;
    receiptForm.value.receiptPrice = fullReceiptAmount.value;
  } else {
    receiptForm.value.receiptPrice = receiptPrevPrice.value;
  }
};
const submitReceipt = (): void => {
  const o = props.order;
  const f = receiptForm.value;
  if (f.receiptTime === '' || !Number.isFinite(f.receiptPrice) || f.receiptPrice < 0) return;
  resetReceipt();
  saveReceipt(
    {
      odId: o.odId,
      receiptPrice: Math.trunc(f.receiptPrice),
      receiptTime: toG5DateTime(f.receiptTime),
      depositName: f.depositName,
    },
    {
      onSuccess: () => {
        receiptEditing.value = false;
      },
    },
  );
};

// ── 환불 처리 기록(여정 10호) ────────────────────────────────────────────────
// 이 창구는 **돈을 보내지 않는다** — 실제 환불은 결제사·계좌에서 사람이 하고, 여기엔 "돌려줬다"는 사실만
// 남는다. od_refund_price 는 미수 산식에 들어 있어 저장 즉시 과입금이 0 으로 준다.
// ⚠ 금액은 **누계**다(코어 orderform.php 입력란과 같은 필드) — 기존 환불액에 이번 금액을 더해 보낸다.
//   프리필은 "과입금 전액을 지금 돌려준다"에 해당하는 값이다.
const refundEditing = ref(false);
const refundForm = ref<{ refundPrice: number; note: string }>({ refundPrice: 0, note: '' });
const { mutate: saveRefund, isPending: refundPending, error: refundErr, reset: resetRefund } =
  useOrderRefundMutation();
const refundError = computed(() => errorText(refundErr.value));
const refundFullAmount = computed(() => props.order.amounts.refundPrice + Math.max(0, -props.order.misu));

const startRefundEdit = (): void => {
  refundForm.value = { refundPrice: refundFullAmount.value, note: '' };
  resetRefund();
  refundEditing.value = true;
};
const submitRefund = (): void => {
  const o = props.order;
  const f = refundForm.value;
  if (!Number.isFinite(f.refundPrice) || f.refundPrice < 0) return;
  resetRefund();
  saveRefund(
    {
      odId: o.odId,
      refundPrice: Math.trunc(f.refundPrice),
      ...(f.note.trim() === '' ? {} : { note: f.note.trim() }),
    },
    {
      onSuccess: () => {
        refundEditing.value = false;
      },
    },
  );
};

// number 입력 — 비우면 NaN 이 되어 저장 가드(Number.isFinite)에 걸린다(옛 v-model.number 와 같음).
const toNumber = (value: string | number): number => (typeof value === 'number' ? value : value === '' ? Number.NaN : Number(value));
</script>

<template>
  <SectionCard :title="t('admin.orders.drawer.amounts')">
    <template v-if="isBankTransfer && !receiptEditing" #actions>
      <Button variant="outline" size="sm" @click="startReceiptEdit">
        <PencilIcon />
        {{ t('admin.orders.drawer.receipt.adjust') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <dl class="divide-y text-sm">
        <div class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.orderPrice') }}</dt>
          <dd class="font-semibold tabular-nums">{{ formatKrw(order.orderPrice) }}</dd>
        </div>
        <div class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.sendCost') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(order.amounts.sendCost + order.amounts.sendCost2) }}</dd>
        </div>
        <div class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.receiptPrice') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(order.receiptPrice) }}</dd>
        </div>
        <div v-if="order.amounts.receiptPoint !== 0" class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.point') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(order.amounts.receiptPoint) }}</dd>
        </div>
        <div v-if="order.couponPrice !== 0" class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">
            {{ t('admin.orders.drawer.coupon') }}
            <span class="text-xs tabular-nums">
              ({{ t('admin.orders.drawer.cartCoupon') }} {{ formatKrw(order.amounts.cartCoupon) }} ·
              {{ t('admin.orders.drawer.itemCoupon') }} {{ formatKrw(order.amounts.coupon) }} ·
              {{ t('admin.orders.drawer.sendCoupon') }} {{ formatKrw(order.amounts.sendCoupon) }})
            </span>
          </dt>
          <dd class="tabular-nums">{{ formatKrw(order.couponPrice) }}</dd>
        </div>
        <div v-if="order.cancelPrice !== 0" class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.cancelPrice') }}</dt>
          <dd class="text-destructive font-medium tabular-nums">{{ formatKrw(order.cancelPrice) }}</dd>
        </div>
        <!-- 이미 기록된 환불액 — 여기서도 고칠 수 있어야 한다(과입금이 0 이 되면 아래 [환불 처리 기록]
             버튼이 사라지므로, 잘못 적은 값을 고칠 길이 이 행뿐이다). -->
        <div v-if="order.amounts.refundPrice !== 0" class="flex items-center justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.refund') }}</dt>
          <dd class="flex items-center gap-2">
            <span class="text-destructive tabular-nums">{{ formatKrw(order.amounts.refundPrice) }}</span>
            <Button v-if="!refundEditing" variant="outline" size="xs" @click="startRefundEdit">
              {{ t('admin.orders.drawer.refundAction.record') }}
            </Button>
          </dd>
        </div>
        <div v-if="order.misu > 0" class="flex justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.misu') }}</dt>
          <dd class="text-destructive font-semibold tabular-nums">{{ formatKrw(order.misu) }}</dd>
        </div>
        <!-- 음수 미수 = 받을 돈이 아니라 **돌려줄 돈**이다(부분 취소 후 흔히 남는다). 같은 이름에 부호만 달리
             붙이면 "미수금 -55,000원"이 되어 정확히 반대로 읽힌다 — 이름을 갈라 절댓값으로 보인다. 환불 **실행**은
             결제사·계좌에서 사람이 하고, [환불 처리 기록]은 그 사실만 남긴다(여정 10호). -->
        <div v-else-if="order.misu < 0" class="flex items-center justify-between gap-3 py-1.5">
          <dt class="text-muted-foreground">{{ t('admin.orders.drawer.overpaid') }}</dt>
          <dd class="flex items-center gap-2">
            <span class="text-warning font-semibold tabular-nums">{{ formatKrw(-order.misu) }}</span>
            <Button v-if="!refundEditing" variant="warning" size="xs" @click="startRefundEdit">
              {{ t('admin.orders.drawer.refundAction.record') }}
            </Button>
          </dd>
        </div>
        <div class="text-muted-foreground flex justify-between gap-3 py-1.5 text-xs">
          <dt>{{ t('admin.orders.drawer.tax') }}</dt>
          <dd class="tabular-nums">
            {{ t('admin.orders.drawer.taxMny') }} {{ formatKrw(order.amounts.taxMny) }} ·
            {{ t('admin.orders.drawer.vatMny') }} {{ formatKrw(order.amounts.vatMny) }} ·
            {{ t('admin.orders.drawer.freeMny') }} {{ formatKrw(order.amounts.freeMny) }}
          </dd>
        </div>
      </dl>

      <!-- 무통장 입금 조정 -->
      <Panel v-if="receiptEditing" tone="muted" class="flex flex-col gap-3">
        <p class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.receipt.hint') }}</p>
        <Field orientation="horizontal" class="w-auto">
          <Checkbox id="od-receipt-full" :model-value="receiptFull" @update:model-value="onReceiptFullToggle" />
          <FieldLabel for="od-receipt-full">{{ t('admin.orders.drawer.receipt.full') }}</FieldLabel>
        </Field>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="od-receipt-price">{{ t('admin.orders.drawer.receipt.price') }}</FieldLabel>
            <Input
              id="od-receipt-price"
              :model-value="receiptForm.receiptPrice"
              type="number"
              min="0"
              step="1"
              class="text-right tabular-nums"
              @update:model-value="(v) => (receiptForm.receiptPrice = toNumber(v))"
            />
          </Field>
          <Field>
            <FieldLabel for="od-receipt-depositor">{{ t('admin.orders.drawer.receipt.depositName') }}</FieldLabel>
            <Input id="od-receipt-depositor" v-model="receiptForm.depositName" type="text" />
          </Field>
        </div>
        <Field>
          <FieldLabel for="od-receipt-time">{{ t('admin.orders.drawer.receipt.time') }}</FieldLabel>
          <Input id="od-receipt-time" v-model="receiptForm.receiptTime" type="datetime-local" />
        </Field>
        <div class="flex flex-wrap items-center gap-2">
          <Button :disabled="receiptPending" @click="submitReceipt">
            {{ receiptPending ? t('admin.orders.drawer.receipt.saving') : t('admin.orders.drawer.receipt.save') }}
          </Button>
          <Button variant="ghost" @click="receiptEditing = false">{{ t('admin.orders.drawer.receipt.cancel') }}</Button>
          <span v-if="receiptError !== null" class="text-destructive text-xs">{{ receiptError }}</span>
        </div>
      </Panel>

      <!-- 환불 처리 기록(여정 10호) — 돈을 보내지 않는다는 것을 문구가 먼저 말한다 -->
      <Panel v-if="refundEditing" class="flex flex-col gap-3">
        <Alert variant="warning" size="sm">
          <AlertDescription>{{ t('admin.orders.drawer.refundAction.hint') }}</AlertDescription>
        </Alert>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="od-refund-price">{{ t('admin.orders.drawer.refundAction.price') }}</FieldLabel>
            <Input
              id="od-refund-price"
              :model-value="refundForm.refundPrice"
              type="number"
              min="0"
              step="1"
              class="text-right tabular-nums"
              @update:model-value="(v) => (refundForm.refundPrice = toNumber(v))"
            />
            <p class="text-muted-foreground text-xs">{{ t('admin.orders.drawer.refundAction.priceHint') }}</p>
          </Field>
          <Field>
            <FieldLabel for="od-refund-note">{{ t('admin.orders.drawer.refundAction.note') }}</FieldLabel>
            <Input id="od-refund-note" v-model="refundForm.note" type="text" maxlength="255" />
          </Field>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="warning" :disabled="refundPending" @click="submitRefund">
            {{ refundPending ? t('admin.orders.drawer.refundAction.saving') : t('admin.orders.drawer.refundAction.save') }}
          </Button>
          <Button variant="ghost" @click="refundEditing = false">{{ t('admin.orders.drawer.refundAction.cancel') }}</Button>
          <span v-if="refundError !== null" class="text-destructive text-xs">{{ refundError }}</span>
        </div>
      </Panel>
    </div>
  </SectionCard>
</template>
