<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import type {
  AdminOrderDetailOrderType,
  AdminOrderForceStatusRequestType,
  AdminOrderStatusRequestType,
} from '@sp/api-contract';
import {
  FORCE_STATUS_TARGETS,
  SELECTABLE_DELIVERY_METHODS,
  deliveryMethodSlug,
  displayCompany,
  g5ToLocal,
  isDeliveryInputComplete,
  isForceTarget,
  isParcelDeliveryMethod,
  nowLocalDateTime,
  smsAvailableForTarget,
  toG5DateTime,
  useAdminNotifyConfig,
  useOrderStatusMutation,
  type DeliveryInput,
  type OrderForceTarget,
} from '@/admin/useAdminOrders';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import OrderActionResult from '../OrderActionResult.vue';
import { useOrderStatusLabel } from './order-detail';

// 처리 — 다음 단계 상태 전이(목록 액션바와 같은 PATCH /status, 단건) + 상태 직접 변경(고급, 접힘).
// 옛 서랍의 [처리] 섹션 그대로: 현재 상태 → 다음 전이(선형 체인), 메일/SMS 는 입금·배송 전이만
// (설정 게이트를 통과한 채널만 체크박스 노출), 입금 처리는 무통장 한정, 생산완료→배송은 운송장 필수.
// 상태 직접 변경의 실제 실행은 확인 대화상자(ForceStatusDialog)가 한다 — 여기서는 대상과 운송장을 모아 올린다.
type ForceDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;

const props = defineProps<{ order: AdminOrderDetailOrderType }>();
const emit = defineEmits<{ force: [payload: { target: OrderForceTarget; delivery: ForceDelivery | null }] }>();
/** 상태 직접 변경 펼침 — 서랍이 쥔다(강제 변경이 끝나면 서랍이 접는다). */
const forceOpen = defineModel<boolean>('forceOpen', { required: true });
const { t } = useI18n();
const statusLabel = useOrderStatusLabel();

const isBankTransfer = computed(() => props.order.settleCase === '무통장');

interface NextAction {
  target: AdminOrderStatusRequestType['target'];
  labelKey: string;
  notify: boolean;
  needsDelivery: boolean;
  bankOnly: boolean;
}
const NEXT_ACTION: Record<string, NextAction> = {
  주문: { target: '입금', labelKey: 'toDeposit', notify: true, needsDelivery: false, bankOnly: true },
  입금: { target: '준비', labelKey: 'toReady', notify: false, needsDelivery: false, bankOnly: false },
  준비: { target: '가격확인', labelKey: 'toPriceCheck', notify: false, needsDelivery: false, bankOnly: false },
  가격확인: { target: '파일검사', labelKey: 'toFileCheck', notify: false, needsDelivery: false, bankOnly: false },
  파일검사: { target: 'EQ', labelKey: 'toEq', notify: false, needsDelivery: false, bankOnly: false },
  EQ: { target: '생산시작', labelKey: 'toProdStart', notify: false, needsDelivery: false, bankOnly: false },
  생산시작: { target: '생산중', labelKey: 'toProducing', notify: false, needsDelivery: false, bankOnly: false },
  생산중: { target: '품질시험', labelKey: 'toQualityTest', notify: false, needsDelivery: false, bankOnly: false },
  품질시험: { target: '생산완료', labelKey: 'toProdDone', notify: false, needsDelivery: false, bankOnly: false },
  생산완료: { target: '배송', labelKey: 'toShipping', notify: true, needsDelivery: true, bankOnly: false },
  배송: { target: '완료', labelKey: 'toDone', notify: false, needsDelivery: false, bankOnly: false },
  // A/S 는 파이프라인 밖(생산완료↔배송 사이의 가지) — 재생산·재배송이 끝나면 배송 단계로 복귀한다.
  'A/S': { target: '배송', labelKey: 'toReship', notify: true, needsDelivery: true, bankOnly: false },
};
const nextAction = computed<NextAction | null>(() => {
  const a = NEXT_ACTION[props.order.status];
  if (a === undefined) return null;
  if (a.bankOnly && !isBankTransfer.value) return null;
  return a;
});

// 메일/SMS 발송 설정 게이트(목록 액션바와 같은 정책) — 코어 orderform.php 처럼 설정이 켜진 채널만 노출.
// mail=cf_email_use, sms=전이별(입금/배송) available(실발송 정합).
const { data: notifyConfig } = useAdminNotifyConfig();
const notifyData = computed(() => notifyConfig.value?.data);
const mailAvailable = computed(() => notifyData.value?.mailAvailable ?? false);
const smsAvailable = computed(() =>
  nextAction.value === null ? false : smsAvailableForTarget(notifyData.value, nextAction.value.target),
);

const sendMail = ref(false);
const sendSms = ref(false);
const processError = ref<string | null>(null);
const deliveryInput = ref<DeliveryInput>({ method: 'parcel', deliveryCompany: '', invoiceNo: '', invoiceTime: '' });

// 생산완료(배송 직전)면 운송장 입력 기본값(배송일시=현재, 배송회사·방법=기존값), 그 외는 비운다.
const initDelivery = (o: AdminOrderDetailOrderType): void => {
  if (o.status === '생산완료') {
    const existing = displayCompany(o.deliveryCompany);
    const method = deliveryMethodSlug(o.deliveryMethod);
    deliveryInput.value = {
      method: method !== null ? (method as DeliveryInput['method']) : 'parcel',
      deliveryCompany: existing !== '-' ? existing : '',
      invoiceNo: o.invoiceNo ?? '',
      invoiceTime: o.invoiceTime !== null ? g5ToLocal(o.invoiceTime) : nowLocalDateTime(),
    };
  } else {
    deliveryInput.value = { method: 'parcel', deliveryCompany: '', invoiceNo: '', invoiceTime: '' };
  }
};
initDelivery(props.order);
// 이 섹션에서의 전이로 상태가 생산완료(배송 직전)로 바뀌면(같은 주문 다시 불러오기) 운송장 기본값을 다시 채운다.
watch(
  () => props.order.status,
  (status, prev) => {
    if (status === '생산완료' && prev !== '생산완료') initDelivery(props.order);
  },
);

const { mutate: processStatus, data: statusData, isPending: statusPending } = useOrderStatusMutation();
const statusResult = computed(() => statusData.value?.data ?? null);

const submitNextStep = (): void => {
  const o = props.order;
  const a = nextAction.value;
  if (a === null) return;
  processError.value = null;
  if (a.needsDelivery) {
    const di = deliveryInput.value;
    // 방법별 필수 — 택배=3필드 · 비택배(퀵/방문수령/직배송)=일시만(회사는 서버가 표준 라벨 기록).
    if (!isDeliveryInputComplete(di)) {
      processError.value = t('admin.orders.process.noInvoice');
      return;
    }
    const isParcel = isParcelDeliveryMethod(di.method);
    processStatus({
      target: a.target,
      odIds: [o.odId],
      sendMail: a.notify && sendMail.value,
      sendSms: a.notify && sendSms.value,
      delivery: [
        {
          odId: o.odId,
          method: di.method,
          deliveryCompany: isParcel ? di.deliveryCompany.trim() : '',
          invoiceNo: isParcel ? di.invoiceNo.trim() : '',
          invoiceTime: toG5DateTime(di.invoiceTime),
        },
      ],
    });
    return;
  }
  processStatus({
    target: a.target,
    odIds: [o.odId],
    sendMail: a.notify && sendMail.value,
    sendSms: a.notify && sendSms.value,
  });
};

// ── 상태 직접 변경(고급) — 대상 + (배송이면 선택 운송장). [적용] 은 확인 대화상자로 넘긴다.
const forceTarget = ref<OrderForceTarget>(isForceTarget(props.order.status) ? props.order.status : '주문');
const forceDelivery = ref<DeliveryInput>({
  method: 'parcel',
  deliveryCompany: '',
  invoiceNo: '',
  invoiceTime: nowLocalDateTime(),
});
const forceTargetModel = computed<string>({
  get: () => forceTarget.value,
  set: (value) => {
    if (isForceTarget(value)) forceTarget.value = value;
  },
});

// 배송이면 방법별 필수(택배=3필드·비택배=일시만)를 채웠을 때만 delivery 동봉, 비우면 상태만 강제 변경.
const openForceConfirm = (): void => {
  const target = forceTarget.value;
  let delivery: ForceDelivery | null = null;
  if (target === '배송') {
    const d = forceDelivery.value;
    if (isDeliveryInputComplete(d)) {
      const isParcel = isParcelDeliveryMethod(d.method);
      delivery = {
        method: d.method,
        deliveryCompany: isParcel ? d.deliveryCompany.trim() : '',
        invoiceNo: isParcel ? d.invoiceNo.trim() : '',
        invoiceTime: toG5DateTime(d.invoiceTime),
      };
    }
  }
  emit('force', { target, delivery });
};
</script>

<template>
  <SectionCard :title="t('admin.orders.process.title')">
    <div class="flex flex-col gap-3">
      <Panel v-if="nextAction !== null" tone="muted" class="space-y-3">
        <div v-if="nextAction.notify && (mailAvailable || smsAvailable)" class="flex flex-wrap gap-x-4 gap-y-1">
          <Field v-if="mailAvailable" orientation="horizontal" class="w-auto">
            <Checkbox
              id="od-process-mail"
              :model-value="sendMail"
              @update:model-value="(v) => (sendMail = v === true)"
            />
            <FieldLabel for="od-process-mail">{{ t('admin.orders.action.sendMail') }}</FieldLabel>
          </Field>
          <Field v-if="smsAvailable" orientation="horizontal" class="w-auto">
            <Checkbox id="od-process-sms" :model-value="sendSms" @update:model-value="(v) => (sendSms = v === true)" />
            <FieldLabel for="od-process-sms">{{ t('admin.orders.action.sendSms') }}</FieldLabel>
          </Field>
        </div>
        <!-- 배송 전이면 방법+운송장을 [배송 처리] 바로 위에서 입력(입력과 실행 한자리).
             비택배(퀵/방문수령/직배송)는 회사·송장 입력을 접는다(서버가 표준 라벨 기록). -->
        <div v-if="nextAction.needsDelivery" class="flex flex-col gap-3">
          <Field>
            <FieldLabel for="od-process-method">{{ t('admin.orders.drawer.deliveryMethod') }}</FieldLabel>
            <NativeSelect id="od-process-method" v-model="deliveryInput.method">
              <NativeSelectOption v-for="m in SELECTABLE_DELIVERY_METHODS" :key="m" :value="m">
                {{ t(`admin.orders.deliveryMethod.${m}`) }}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field v-if="isParcelDeliveryMethod(deliveryInput.method)">
            <FieldLabel for="od-process-company">{{ t('admin.orders.drawer.deliveryCompany') }}</FieldLabel>
            <Input id="od-process-company" v-model="deliveryInput.deliveryCompany" type="text" />
          </Field>
          <div class="grid grid-cols-2 gap-3">
            <Field v-if="isParcelDeliveryMethod(deliveryInput.method)">
              <FieldLabel for="od-process-invoice">{{ t('admin.orders.drawer.invoiceNo') }}</FieldLabel>
              <Input id="od-process-invoice" v-model="deliveryInput.invoiceNo" type="text" />
            </Field>
            <Field>
              <FieldLabel for="od-process-time">{{ t('admin.orders.drawer.invoiceTime') }}</FieldLabel>
              <Input id="od-process-time" v-model="deliveryInput.invoiceTime" type="datetime-local" />
            </Field>
          </div>
          <p v-if="!isParcelDeliveryMethod(deliveryInput.method)" class="text-muted-foreground text-xs">
            {{ t('admin.orders.process.nonParcelHint') }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button :disabled="statusPending" @click="submitNextStep">
            {{ statusPending ? t('admin.orders.action.processing') : t(`admin.orders.action.${nextAction.labelKey}`) }}
          </Button>
        </div>
        <p v-if="processError !== null" class="text-destructive text-sm">{{ processError }}</p>
      </Panel>
      <p v-else class="text-muted-foreground text-sm">{{ t('admin.orders.process.none') }}</p>
      <OrderActionResult v-if="statusResult !== null" :data="statusResult" />

      <!-- 상태 직접 변경(고급) — 접힘. 수납·알림·운송장 필수검증 없이 강제 변경(역방향 가능) -->
      <div class="border-t pt-2">
        <Button variant="ghost" size="xs" :aria-expanded="forceOpen" @click="forceOpen = !forceOpen">
          {{ t('admin.orders.force.toggle') }}
          <ChevronUpIcon v-if="forceOpen" />
          <ChevronDownIcon v-else />
        </Button>
        <Panel v-if="forceOpen" class="mt-2 space-y-3">
          <Alert variant="warning" size="sm">
            <AlertDescription>{{ t('admin.orders.force.warn') }}</AlertDescription>
          </Alert>
          <Field>
            <FieldLabel for="od-force-target">{{ t('admin.orders.force.target') }}</FieldLabel>
            <NativeSelect id="od-force-target" v-model="forceTargetModel">
              <NativeSelectOption v-for="s in FORCE_STATUS_TARGETS" :key="s" :value="s">
                {{ statusLabel(s) }}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <div v-if="forceTarget === '배송'" class="flex flex-col gap-3">
            <FieldDescription>{{ t('admin.orders.force.deliveryOptionalHint') }}</FieldDescription>
            <NativeSelect v-model="forceDelivery.method" :aria-label="t('admin.orders.drawer.deliveryMethod')">
              <NativeSelectOption v-for="m in SELECTABLE_DELIVERY_METHODS" :key="m" :value="m">
                {{ t(`admin.orders.deliveryMethod.${m}`) }}
              </NativeSelectOption>
            </NativeSelect>
            <Input
              v-if="isParcelDeliveryMethod(forceDelivery.method)"
              v-model="forceDelivery.deliveryCompany"
              type="text"
              :placeholder="t('admin.orders.drawer.deliveryCompany')"
              :aria-label="t('admin.orders.drawer.deliveryCompany')"
            />
            <div class="grid grid-cols-2 gap-3">
              <Input
                v-if="isParcelDeliveryMethod(forceDelivery.method)"
                v-model="forceDelivery.invoiceNo"
                type="text"
                :placeholder="t('admin.orders.drawer.invoiceNo')"
                :aria-label="t('admin.orders.drawer.invoiceNo')"
              />
              <Input
                v-model="forceDelivery.invoiceTime"
                type="datetime-local"
                :aria-label="t('admin.orders.drawer.invoiceTime')"
              />
            </div>
          </div>
          <Button variant="warning" @click="openForceConfirm">{{ t('admin.orders.force.apply') }}</Button>
        </Panel>
      </div>
    </div>
  </SectionCard>
</template>
