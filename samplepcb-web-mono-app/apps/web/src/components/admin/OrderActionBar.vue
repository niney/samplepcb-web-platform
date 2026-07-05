<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderStatusRequestType, AdminOrderTabType } from '@sp/api-contract';
import {
  smsAvailableForTarget,
  toG5DateTime,
  useAdminNotifyConfig,
  useOrderStatusMutation,
  type DeliveryInput,
} from '../../admin/useAdminOrders';
import OrderActionResult from './OrderActionResult.vue';

// 주문 액션바 — 현재 탭 기준 일괄 상태 전이(레거시 orderlist.php 시맨틱). 상태 전이 뮤테이션과
// 결과 패널을 여기서 소유하고, 삭제·엑셀은 부모에 열기만 위임한다. 선택/운송장입력은 부모 소유(prop).
const props = defineProps<{
  tab: AdminOrderTabType;
  selectedIds: string[];
  deliveryInputs: Record<string, DeliveryInput>;
}>();
const emit = defineEmits<{ done: []; clear: []; openDelete: []; openExcel: [] }>();
const { t } = useI18n();

// 탭 → 전이 액션. notify(메일/SMS 노출) 는 target ∈ {입금,배송} 전이에만(코어가 그 전이만 알림).
//   주문 탭 → [입금 처리](target 입금, notify) + [선택 삭제]
//   입금 탭 → [준비 처리]          준비 탭 → [배송 처리](notify) + [엑셀배송]      배송 탭 → [완료 처리]
//   전체/완료/취소/부분취소 탭 → 액션 없음
interface TabAction {
  target: AdminOrderStatusRequestType['target'];
  labelKey: string;
  notify: boolean;
  canDelete: boolean;
  excel: boolean;
}
const TAB_ACTION: Partial<Record<AdminOrderTabType, TabAction>> = {
  주문: { target: '입금', labelKey: 'toDeposit', notify: true, canDelete: true, excel: false },
  입금: { target: '준비', labelKey: 'toReady', notify: false, canDelete: false, excel: false },
  준비: { target: '배송', labelKey: 'toShipping', notify: true, canDelete: false, excel: true },
  배송: { target: '완료', labelKey: 'toDone', notify: false, canDelete: false, excel: false },
};
const action = computed<TabAction | undefined>(() => TAB_ACTION[props.tab]);

const sendMail = ref(false);
const sendSms = ref(false);
const localError = ref<string | null>(null);

// 메일/SMS 발송 설정 게이트 — 코어 orderform.php 처럼 설정이 켜진 채널만 체크박스 노출.
// mail=cf_email_use, sms=전이별(입금/배송) available(실발송 정합). 미로딩/꺼짐이면 숨김.
const { data: notifyConfig } = useAdminNotifyConfig();
const notifyData = computed(() => notifyConfig.value?.data);
const mailAvailable = computed<boolean>(() => notifyData.value?.mailAvailable ?? false);
const smsAvailable = computed<boolean>(() =>
  action.value === undefined ? false : smsAvailableForTarget(notifyData.value, action.value.target),
);

const { mutate, data, isPending, reset } = useOrderStatusMutation();
const resultData = computed(() => data.value?.data ?? null);

// 탭 전환 시 알림 플래그·결과·에러 초기화(선택은 부모가 초기화).
watch(
  () => props.tab,
  () => {
    sendMail.value = false;
    sendSms.value = false;
    localError.value = null;
    reset();
  },
);

const submit = (): void => {
  const a = action.value;
  if (a === undefined) return;
  localError.value = null;
  if (props.selectedIds.length === 0) return;

  if (a.target === '배송') {
    // 선택 행의 운송장 입력을 delivery[] 로 수집 — 3필드 모두 채운 행만. 미입력 행은 odIds 에는
    // 남겨 서버가 MISSING_INVOICE 로 돌려주게 한다(계약 refine: delivery 는 최소 1건 필요).
    const delivery = props.selectedIds
      .map((odId) => ({ odId, input: props.deliveryInputs[odId] }))
      .filter(
        (r): r is { odId: string; input: DeliveryInput } =>
          r.input !== undefined &&
          r.input.deliveryCompany.trim() !== '' &&
          r.input.invoiceNo.trim() !== '' &&
          r.input.invoiceTime !== '',
      )
      .map((r) => ({
        odId: r.odId,
        deliveryCompany: r.input.deliveryCompany.trim(),
        invoiceNo: r.input.invoiceNo.trim(),
        invoiceTime: toG5DateTime(r.input.invoiceTime),
      }));
    if (delivery.length === 0) {
      localError.value = t('admin.orders.action.noInvoice');
      return;
    }
    mutate(
      {
        target: a.target,
        odIds: [...props.selectedIds],
        sendMail: sendMail.value,
        sendSms: sendSms.value,
        delivery,
      },
      {
        onSuccess: () => {
          emit('done');
        },
      },
    );
    return;
  }

  mutate(
    {
      target: a.target,
      odIds: [...props.selectedIds],
      sendMail: a.notify && sendMail.value,
      sendSms: a.notify && sendSms.value,
    },
    {
      onSuccess: () => {
        emit('done');
      },
    },
  );
};
</script>

<template>
  <div v-if="action !== undefined" class="space-y-2">
    <div
      class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2"
    >
      <template v-if="props.selectedIds.length > 0">
        <span class="text-sm font-medium text-gray-700">
          {{ t('admin.orders.action.selected', { n: props.selectedIds.length }) }}
        </span>
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="isPending"
          @click="submit"
        >
          {{ isPending ? t('admin.orders.action.processing') : t(`admin.orders.action.${action.labelKey}`) }}
        </button>
        <button
          v-if="action.canDelete"
          type="button"
          class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          @click="emit('openDelete')"
        >
          {{ t('admin.orders.action.delete') }}
        </button>
        <label v-if="action.notify && mailAvailable" class="flex cursor-pointer items-center gap-1 text-sm text-gray-600">
          <input v-model="sendMail" type="checkbox" class="rounded border-gray-300">
          {{ t('admin.orders.action.sendMail') }}
        </label>
        <label v-if="action.notify && smsAvailable" class="flex cursor-pointer items-center gap-1 text-sm text-gray-600">
          <input v-model="sendSms" type="checkbox" class="rounded border-gray-300">
          {{ t('admin.orders.action.sendSms') }}
        </label>
        <button
          type="button"
          class="text-sm text-gray-500 hover:underline"
          @click="emit('clear')"
        >
          {{ t('admin.orders.action.clear') }}
        </button>
      </template>
      <span v-else class="text-sm text-gray-400">{{ t('admin.orders.action.selectHint') }}</span>

      <button
        v-if="action.excel"
        type="button"
        class="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        @click="emit('openExcel')"
      >
        {{ t('admin.orders.action.excel') }}
      </button>
      <span v-if="localError !== null" class="w-full text-sm text-red-600">{{ localError }}</span>
    </div>

    <OrderActionResult v-if="resultData !== null" :data="resultData" />
  </div>
</template>
