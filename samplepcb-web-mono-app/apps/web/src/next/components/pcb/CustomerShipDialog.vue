<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { usePcbShipCustomerOrder } from '@/admin/useAdminPcbOrders';
import {
  SELECTABLE_DELIVERY_METHODS,
  isParcelDeliveryMethod,
  nowLocalDateTime,
  toG5DateTime,
  type DeliveryMethodType,
} from '@/admin/useAdminOrders';
import { confirmDialog } from '@/next/lib/dialog';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';

// 고객 배송 처리(P4.6) — 입고확인 끝난 PCB 주문을 고객에게 발송한다. 옛 PcbCustomerShipModal 과
// props·emits 가 같다(선적·배송 워크큐와 Case 상세가 함께 쓴다).
// 방법+운송장 → 코어 force-status '배송'(운송장 반영+재고 앵커, 조작 경로 단일). 비택배(퀵/방문
// 수령/직배송)는 송장 없이 처리하고 서버가 od_delivery_company 에 방법명을 기록한다.

const METHOD_LABELS: Record<string, string> = {
  parcel: '택배',
  quick_cod: '퀵서비스(착불)',
  pickup: '방문수령',
  direct: '직배송',
};

const props = defineProps<{
  /** null 이면 닫힘. 열 때마다 입력을 초기화한다. */
  odId: string | null;
  /** 입고확인이 끝나지 않은 발주가 남았는지 — 경고 + 제출 시 확인. */
  incompleteReceipt: boolean;
  /**
   * 누구 것인지 — 주문번호만으로는 확인이 안 된다. 묶음 발송이면 회원이 다른 두 주문을 연달아
   * 처리하게 되므로(여정 9호), 송장을 붙이기 전에 사람이 읽을 이름이 화면에 있어야 오배송이 안 난다.
   */
  customerLabel?: string;
  projectName?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const shipMut = usePcbShipCustomerOrder();
const method = ref<DeliveryMethodType>('parcel');
const company = ref('');
const invoiceNo = ref('');
const invoiceTime = ref('');
const error = ref('');

const isParcel = computed(() => isParcelDeliveryMethod(method.value));

watch(
  () => props.odId,
  (odId) => {
    if (odId === null) return;
    method.value = 'parcel';
    company.value = '';
    invoiceNo.value = '';
    invoiceTime.value = nowLocalDateTime();
    error.value = '';
  },
  { immediate: true },
);

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// NativeSelect 의 update 이벤트 타입이 비어 있어(업스트림) 브라우저 change 이벤트로 값을 받는다.
const onMethodChange = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const match = SELECTABLE_DELIVERY_METHODS.find((m) => m === value);
  if (match !== undefined) method.value = match;
};

async function submit(): Promise<void> {
  if (props.odId === null) return;
  error.value = '';
  if (isParcel.value && (company.value.trim() === '' || invoiceNo.value.trim() === '')) {
    error.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  if (
    props.incompleteReceipt &&
    !(await confirmDialog('아직 입고 확인되지 않은 발주가 있습니다. 그래도 배송 처리할까요?'))
  ) {
    return;
  }
  try {
    await shipMut.mutateAsync({
      odId: props.odId,
      delivery: {
        method: method.value,
        deliveryCompany: isParcel.value ? company.value.trim() : '',
        invoiceNo: isParcel.value ? invoiceNo.value.trim() : '',
        invoiceTime: toG5DateTime(invoiceTime.value),
      },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '배송 처리에 실패했습니다.';
  }
}
</script>

<template>
  <Dialog :open="odId !== null" @update:open="onOpenChange">
    <DialogContent v-if="odId !== null">
      <DialogHeader>
        <DialogTitle>
          배송 처리<template v-if="customerLabel !== undefined && customerLabel !== ''"> — {{ customerLabel }}</template>
        </DialogTitle>
        <DialogDescription>
          <span class="font-mono">{{ odId }}</span>
          <template v-if="projectName !== undefined && projectName !== ''"> · {{ projectName }}</template>
        </DialogDescription>
      </DialogHeader>

      <p
        v-if="incompleteReceipt"
        class="bg-warning-soft text-warning flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium"
      >
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
        입고 확인이 끝나지 않은 발주가 있습니다 — 검수 후 발송을 권장합니다.
      </p>

      <form class="grid gap-4" @submit.prevent="submit">
        <Field>
          <FieldLabel for="pcb-ship-method">배송방법</FieldLabel>
          <NativeSelect id="pcb-ship-method" :model-value="method" @change="onMethodChange">
            <NativeSelectOption v-for="m in SELECTABLE_DELIVERY_METHODS" :key="m" :value="m">
              {{ METHOD_LABELS[m] }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <template v-if="isParcel">
          <Field>
            <FieldLabel for="pcb-ship-company">택배사</FieldLabel>
            <Input id="pcb-ship-company" v-model="company" type="text" maxlength="50" placeholder="예: CJ대한통운" />
          </Field>
          <Field>
            <FieldLabel for="pcb-ship-invoice">송장번호</FieldLabel>
            <Input id="pcb-ship-invoice" v-model="invoiceNo" type="text" maxlength="100" />
          </Field>
        </template>
        <Field>
          <FieldLabel for="pcb-ship-time">발송일시</FieldLabel>
          <Input id="pcb-ship-time" v-model="invoiceTime" type="datetime-local" />
          <FieldDescription v-if="!isParcel">
            택배 외 방법은 송장 없이 처리되며, 배송 정보에는 방법명이 기록됩니다.
          </FieldDescription>
        </Field>
        <p class="text-muted-foreground text-xs">
          알림 메일은 발송되지 않습니다 — 배송 안내가 필요하면
          <RouterLink :to="{ name: 'admin-orders' }" target="_blank" class="text-primary font-medium hover:underline">
            통합 주문내역
          </RouterLink>
          에서 이 주문번호로 찾아 발송해 주세요.
        </p>
        <p v-if="error !== ''" class="text-destructive text-sm font-medium" role="alert">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">취소</Button>
        <Button :disabled="shipMut.isPending.value" @click="submit">배송 처리</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
