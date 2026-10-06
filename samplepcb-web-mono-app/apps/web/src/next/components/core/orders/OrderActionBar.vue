<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileSpreadsheetIcon, Trash2Icon } from '@lucide/vue';
import type { AdminOrderStatusRequestType, AdminOrderTabType } from '@sp/api-contract';
import {
  isDeliveryInputComplete,
  isParcelDeliveryMethod,
  smsAvailableForTarget,
  toG5DateTime,
  useAdminNotifyConfig,
  useOrderStatusMutation,
  type DeliveryInput,
} from '@/admin/useAdminOrders';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Spinner } from '@/next/components/ui/spinner';
import OrderActionResult from './OrderActionResult.vue';

// 주문 액션바 — 옛 components/admin/OrderActionBar.vue 와 같은 props·emits·동작.
// 현재 탭 기준 일괄 상태 전이(레거시 orderlist.php 시맨틱). 상태 전이 뮤테이션과 결과 패널을 여기서 소유하고,
// 삭제·엑셀은 부모에 열기만 위임한다. 선택/운송장 입력은 부모 소유(prop).
const props = defineProps<{
  tab: AdminOrderTabType;
  selectedIds: string[];
  deliveryInputs: Record<string, DeliveryInput>;
}>();
const emit = defineEmits<{ done: []; clear: []; openDelete: []; openExcel: [] }>();
const { t } = useI18n();

// 탭 → 전이 액션(선형 체인). notify(메일/SMS 노출)는 target ∈ {입금,배송} 전이에만(코어가 그 전이만 알림).
//   주문→[입금](notify)+[삭제] · 입금→[준비] · 준비→[가격확인] · …제작 단계 순차… ·
//   생산완료→[배송](notify)+[엑셀배송] · 배송→[완료]
//   전체/완료/취소/부분취소/A/S 탭 → 액션 없음(A/S 는 상세의 상태 직접 변경 전용)
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
  준비: { target: '가격확인', labelKey: 'toPriceCheck', notify: false, canDelete: false, excel: false },
  가격확인: { target: '파일검사', labelKey: 'toFileCheck', notify: false, canDelete: false, excel: false },
  파일검사: { target: 'EQ', labelKey: 'toEq', notify: false, canDelete: false, excel: false },
  EQ: { target: '생산시작', labelKey: 'toProdStart', notify: false, canDelete: false, excel: false },
  생산시작: { target: '생산중', labelKey: 'toProducing', notify: false, canDelete: false, excel: false },
  생산중: { target: '품질시험', labelKey: 'toQualityTest', notify: false, canDelete: false, excel: false },
  품질시험: { target: '생산완료', labelKey: 'toProdDone', notify: false, canDelete: false, excel: false },
  생산완료: { target: '배송', labelKey: 'toShipping', notify: true, canDelete: false, excel: true },
  배송: { target: '완료', labelKey: 'toDone', notify: false, canDelete: false, excel: false },
};
const action = computed<TabAction | undefined>(() => TAB_ACTION[props.tab]);

const sendMail = ref(false);
const sendSms = ref(false);
const localError = ref<string | null>(null);

// 메일/SMS 발송 설정 게이트(docs/order-notify-gating.md) — 코어 orderform.php 처럼 설정이 켜진 채널만
// 체크박스를 보인다. mail=cf_email_use, sms=전이별(입금/배송) available(실발송 정합). 미로딩/꺼짐이면 숨김.
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
    // 선택 행의 운송장 입력을 delivery[] 로 수집 — 방법별 필수(택배=3필드, 비택배=일시만)를 채운 행만.
    // 미입력 행은 odIds 에는 남겨 서버가 MISSING_INVOICE 로 돌려주게 한다(계약 refine: delivery 최소 1건).
    // 비택배는 회사·송장을 비워 보낸다(서버가 표준 라벨·'' 기록).
    const delivery = props.selectedIds
      .map((odId) => ({ odId, input: props.deliveryInputs[odId] }))
      .filter(
        (r): r is { odId: string; input: DeliveryInput } =>
          r.input !== undefined && isDeliveryInputComplete(r.input),
      )
      .map((r) => ({
        odId: r.odId,
        method: r.input.method,
        deliveryCompany: isParcelDeliveryMethod(r.input.method) ? r.input.deliveryCompany.trim() : '',
        invoiceNo: isParcelDeliveryMethod(r.input.method) ? r.input.invoiceNo.trim() : '',
        invoiceTime: toG5DateTime(r.input.invoiceTime),
      }));
    if (delivery.length === 0) {
      localError.value = t('admin.orders.action.noInvoice');
      return;
    }
    mutate(
      { target: a.target, odIds: [...props.selectedIds], sendMail: sendMail.value, sendSms: sendSms.value, delivery },
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
  <div v-if="action !== undefined" class="flex flex-col gap-2">
    <Panel tone="muted" class="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2">
      <template v-if="props.selectedIds.length > 0">
        <span class="text-sm font-medium tabular-nums">
          {{ t('admin.orders.action.selected', { n: props.selectedIds.length }) }}
        </span>
        <Button size="sm" :disabled="isPending" @click="submit">
          <Spinner v-if="isPending" />
          {{ isPending ? t('admin.orders.action.processing') : t(`admin.orders.action.${action.labelKey}`) }}
        </Button>
        <Button v-if="action.canDelete" variant="destructive" size="sm" @click="emit('openDelete')">
          <Trash2Icon />
          {{ t('admin.orders.action.delete') }}
        </Button>
        <label v-if="action.notify && mailAvailable" class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox v-model="sendMail" />
          {{ t('admin.orders.action.sendMail') }}
        </label>
        <label v-if="action.notify && smsAvailable" class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox v-model="sendSms" />
          {{ t('admin.orders.action.sendSms') }}
        </label>
        <Button variant="ghost" size="sm" @click="emit('clear')">
          {{ t('admin.orders.action.clear') }}
        </Button>
      </template>
      <span v-else class="text-muted-foreground text-sm">{{ t('admin.orders.action.selectHint') }}</span>

      <Button v-if="action.excel" variant="outline" size="sm" class="ml-auto" @click="emit('openExcel')">
        <FileSpreadsheetIcon />
        {{ t('admin.orders.action.excel') }}
      </Button>
    </Panel>

    <Alert v-if="localError !== null" variant="destructive" size="sm">
      <AlertDescription>{{ localError }}</AlertDescription>
    </Alert>
    <OrderActionResult v-if="resultData !== null" :data="resultData" />
  </div>
</template>
