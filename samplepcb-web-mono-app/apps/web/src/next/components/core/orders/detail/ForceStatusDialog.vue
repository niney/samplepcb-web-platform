<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlertIcon } from '@lucide/vue';
import type { AdminOrderForceStatusRequestType } from '@sp/api-contract';
import { useOrderForceStatusMutation, type OrderForceTarget } from '@/admin/useAdminOrders';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/next/components/ui/alert-dialog';
import { Button } from '@/next/components/ui/button';
import { useOrderErrorText } from './order-detail';

// 주문 상태 직접 변경 확인(위험) — 수납·알림·운송장 필수검증 없이 상태만 강제 변경(역방향 가능).
// 옛 components/admin/OrderForceStatusModal.vue 와 같은 props·emits: PATCH /force-status 성공이면 done,
// 실패하면 대화상자 안에 오류를 두고 열린 채로 남는다. 실행 중에는 닫히지 않는다. 부모가 v-if 로 띄운다.
type ForceDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;
const props = defineProps<{
  odId: string;
  target: OrderForceTarget;
  targetLabel: string;
  delivery: ForceDelivery | null;
  /** 현재 잔여 미수금 — 강제 전이는 수납을 건드리지 않아 그대로 남는다(경고 판단용). */
  misu?: number;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
const { t } = useI18n();
const errorText = useOrderErrorText();

const { mutate, isPending, isSuccess, error } = useOrderForceStatusMutation();
const errorMessage = computed(() => errorText(error.value));

const onConfirm = (): void => {
  mutate(
    {
      odId: props.odId,
      target: props.target,
      ...(props.delivery !== null ? { delivery: props.delivery } : {}),
    },
    {
      onSuccess: () => {
        emit('done');
      },
    },
  );
};
const onClose = (): void => {
  if (isPending.value) return;
  emit('close');
};
const onOpenChange = (open: boolean): void => {
  if (!open) onClose();
};

// 결제 이후 단계로 강제 이동하는데 미수가 남아 있으면 "완료인데 미결제" 주문이 만들어진다. 그 상태는
// 고객 주문내역에도 미결제액으로 그대로 노출되므로 누르기 전에 알려 준다.
const misuWarning = computed<number | null>(() => {
  const misu = props.misu ?? 0;
  if (misu <= 0) return null;
  return ['입금', '준비', '배송', '완료'].includes(props.target) ? misu : null;
});
</script>

<template>
  <AlertDialog :open="true" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          <span class="text-warning flex items-center gap-2">
            <TriangleAlertIcon class="size-5" />
            {{ t('admin.orders.force.confirmTitle', { target: props.targetLabel }) }}
          </span>
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t('admin.orders.force.confirmWarn', { target: props.targetLabel }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div v-if="props.delivery !== null || misuWarning !== null || errorMessage !== null" class="flex flex-col gap-2">
        <Panel v-if="props.delivery !== null" tone="muted" class="text-muted-foreground text-xs break-words">
          {{ t('admin.orders.force.deliveryIncluded') }}:
          {{ props.delivery.deliveryCompany }} / {{ props.delivery.invoiceNo }} / {{ props.delivery.invoiceTime }}
        </Panel>
        <Alert v-if="misuWarning !== null" variant="destructive" size="sm">
          <AlertDescription>{{ t('admin.orders.force.misuWarn', { misu: misuWarning.toLocaleString() }) }}</AlertDescription>
        </Alert>
        <p v-if="errorMessage !== null" class="text-destructive text-sm">{{ errorMessage }}</p>
      </div>

      <AlertDialogFooter>
        <Button variant="outline" :disabled="isPending" @click="onClose">{{ t('admin.orders.force.cancel') }}</Button>
        <Button variant="warning" :disabled="isPending || isSuccess" @click="onConfirm">
          {{ isPending ? t('admin.orders.force.applying') : t('admin.orders.force.confirm') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
