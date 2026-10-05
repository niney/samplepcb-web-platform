<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { AdminBomOrderListItemType } from '@sp/api-contract';
import { useShipBomOrder } from '@/admin/useAdminBomOrders';
import {
  SELECTABLE_DELIVERY_METHODS,
  isParcelDeliveryMethod,
  nowLocalDateTime,
  toG5DateTime,
  type DeliveryMethodType,
} from '@/admin/useAdminOrders';
import { Alert, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import Panel from '@/next/components/common/Panel.vue';
import { allOrderCasesReceived } from './order-receipt';

// 고객 배송 처리(D21-3) — 선적·배송 화면 ② 표의 [배송 처리]. 방법+운송장 입력 → force-status '배송'
// (부품 주문은 제작 단계 생략). 비택배(퀵/방문수령/직배송)는 송장 없이 처리(서버가 od_delivery_company
// 표준 라벨 기록). 옛 AdminSmartbomLogistics 의 인라인 대화상자를 떼어 왔다.

const props = defineProps<{ item: AdminBomOrderListItemType | null }>();
const emit = defineEmits<{
  close: [];
  /** 처리 끝 — 메일 발송 결과를 화면 위 알림으로 남긴다. */
  done: [feedback: { tone: 'success' | 'warning'; text: string }];
}>();

const SHIP_METHOD_LABELS: Record<string, string> = {
  parcel: '택배',
  quick_cod: '퀵서비스(착불)',
  pickup: '방문수령',
  direct: '직배송',
};

const shipMut = useShipBomOrder();
const method = ref<DeliveryMethodType>('parcel');
const company = ref('');
const invoiceNo = ref('');
const invoiceTime = ref('');
const sendMail = ref(true);
const error = ref('');

watch(
  () => props.item,
  (item) => {
    if (item === null) return;
    method.value = 'parcel';
    company.value = '';
    invoiceNo.value = '';
    invoiceTime.value = nowLocalDateTime();
    sendMail.value = item.customerEmail.trim() !== '';
    error.value = '';
  },
  { immediate: true },
);

const isParcel = computed(() => isParcelDeliveryMethod(method.value));
const received = computed(() => props.item !== null && allOrderCasesReceived(props.item));

const onMethodChange = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const match = SELECTABLE_DELIVERY_METHODS.find((entry) => entry === value);
  if (match !== undefined) method.value = match;
};
const onSendMail = (value: boolean | 'indeterminate'): void => {
  sendMail.value = value === true;
};
const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

async function submit(): Promise<void> {
  const item = props.item;
  if (item === null) return;
  error.value = '';
  if (isParcel.value && (company.value.trim() === '' || invoiceNo.value.trim() === '')) {
    error.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  if (!allOrderCasesReceived(item)) {
    error.value = '대체발주와 모든 발주서 입고를 완료한 뒤 배송 처리할 수 있습니다.';
    return;
  }
  try {
    const response = await shipMut.mutateAsync({
      odId: item.odId,
      delivery: {
        method: method.value,
        deliveryCompany: isParcel.value ? company.value.trim() : '',
        invoiceNo: isParcel.value ? invoiceNo.value.trim() : '',
        invoiceTime: toG5DateTime(invoiceTime.value),
      },
      sendMail: sendMail.value,
    });
    if (sendMail.value) {
      const mailStatus = response.data.notify?.mail;
      emit(
        'done',
        mailStatus === 'sent'
          ? { tone: 'success', text: `${item.customerEmail}로 배송 안내 이메일을 발송했습니다.` }
          : {
              tone: 'warning',
              text: `${item.customerEmail}로 배송 안내를 요청했지만 메일 설정 또는 발송 상태를 확인해야 합니다. 주문 상태와 운송장은 정상 반영됐습니다.`,
            },
      );
    } else {
      emit('done', {
        tone: 'warning',
        text:
          item.customerEmail.trim() === ''
            ? '주문 이메일이 없어 배송 안내 메일은 보내지 않고 운송장만 반영했습니다.'
            : '배송 안내 메일을 보내지 않고 운송장만 반영했습니다.',
      });
    }
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '배송 처리에 실패했습니다.';
  }
}
</script>

<template>
  <Dialog :open="item !== null" @update:open="onOpenChange">
    <DialogContent v-if="item !== null" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>배송 처리 — {{ item.odId }}</DialogTitle>
        <DialogDescription>운송장을 입력하면 주문이 '배송'으로 넘어갑니다.</DialogDescription>
      </DialogHeader>

      <Alert v-if="!received" variant="warning" size="sm">
        <TriangleAlertIcon />
        <AlertTitle>조달 복구 또는 입고 확인이 끝나지 않아 배송 처리할 수 없습니다.</AlertTitle>
      </Alert>

      <Panel muted class="text-xs leading-5">
        <p class="font-semibold">받는 분 {{ item.recipientName || '미입력' }}</p>
        <p>{{ item.recipientPhone || '연락처 없음' }}</p>
        <p class="break-words">
          <template v-if="item.recipientZip !== ''">[{{ item.recipientZip }}] </template>{{ item.recipientAddress || '배송지 미입력' }}
        </p>
        <p class="text-muted-foreground mt-1 border-t pt-1">
          배송 안내 이메일 · <b class="text-foreground">{{ item.customerEmail || '없음' }}</b>
        </p>
      </Panel>

      <form class="grid gap-4" @submit.prevent="submit">
        <Field>
          <FieldLabel for="bom-ship-method">배송방법</FieldLabel>
          <NativeSelect id="bom-ship-method" :model-value="method" @change="onMethodChange">
            <NativeSelectOption v-for="m in SELECTABLE_DELIVERY_METHODS" :key="m" :value="m">
              {{ SHIP_METHOD_LABELS[m] }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <template v-if="isParcel">
          <Field>
            <FieldLabel for="bom-ship-company">택배사</FieldLabel>
            <Input id="bom-ship-company" v-model="company" type="text" maxlength="50" placeholder="예: CJ대한통운" />
          </Field>
          <Field>
            <FieldLabel for="bom-ship-invoice">송장번호</FieldLabel>
            <Input id="bom-ship-invoice" v-model="invoiceNo" type="text" maxlength="100" />
          </Field>
        </template>
        <Field>
          <FieldLabel for="bom-ship-time">발송일시</FieldLabel>
          <Input id="bom-ship-time" v-model="invoiceTime" type="datetime-local" />
          <FieldDescription v-if="!isParcel">택배 외 방법은 송장 없이 처리되며, 배송 정보에는 방법명이 기록됩니다.</FieldDescription>
        </Field>
        <FieldLabel for="bom-ship-mail">
          <Field orientation="horizontal" :data-disabled="item.customerEmail === '' ? true : undefined">
            <Checkbox
              id="bom-ship-mail"
              :model-value="sendMail"
              :disabled="item.customerEmail === ''"
              @update:model-value="onSendMail"
            />
            <FieldContent>
              <FieldTitle>배송 안내 이메일 발송</FieldTitle>
              <FieldDescription>
                기존 영카트 주문 메일 양식으로 {{ item.customerEmail || '주문 이메일 없음' }}에 보냅니다.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
        <p v-if="error !== ''" class="text-destructive text-sm font-medium" role="alert">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">취소</Button>
        <Button :disabled="shipMut.isPending.value || !received" @click="void submit()">
          {{ sendMail ? '배송 처리 · 메일 발송' : '배송 처리' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
