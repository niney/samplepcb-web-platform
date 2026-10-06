<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlertIcon } from '@lucide/vue';
import type { AdminOrderActionResponseType } from '@sp/api-contract';
import { useOrderItemStatusMutation, type CancelItemTarget } from '@/admin/useAdminOrders';
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
import OrderActionResult from '../OrderActionResult.vue';
import { useOrderErrorText } from './order-detail';

// 카트행 취소/반품/품절 확인(위험) — 되돌릴 수 없다(복귀 경로 없음). 옛 components/admin/OrderItemCancelModal.vue
// 와 같은 props·emits·단계: 확인 → PATCH /items/status → 결과(processed/skipped + 전량 취소 전환 안내).
// 결과를 보여 준 뒤 닫으면 done, 실행 전에 닫으면 close. 실행 중에는 닫히지 않는다. 부모가 v-if 로 띄운다.
const props = defineProps<{
  odId: string;
  ctIds: number[];
  target: CancelItemTarget;
  itemLabel: string;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
const { t } = useI18n();
const errorText = useOrderErrorText();

const TARGET_SLUG: Record<CancelItemTarget, string> = {
  취소: 'cancel',
  반품: 'return',
  품절: 'soldOut',
};
const targetLabel = computed(() => t(`admin.orders.itemCancel.target.${TARGET_SLUG[props.target]}`));

const { mutate, data, isPending, error } = useOrderItemStatusMutation();
const result = computed(() => data.value?.data ?? null);

// 결과 패널은 { processed:string[], skipped:[{odId,reason}], notify } 형태라 카트행 응답
// (processed:number[], skipped:[{ctId,reason}])을 맞춘다.
const resultForPanel = computed<AdminOrderActionResponseType['data'] | null>(() => {
  const r = result.value;
  if (r === null) return null;
  return {
    processed: r.processed.map((n) => String(n)),
    skipped: r.skipped.map((s) => ({ odId: String(s.ctId), reason: s.reason })),
    notify: [],
  };
});
const errorMessage = computed(() => errorText(error.value));

const onConfirm = (): void => {
  if (props.ctIds.length === 0) return;
  mutate({ odId: props.odId, ctIds: [...props.ctIds], target: props.target });
};
const onClose = (): void => {
  if (isPending.value) return;
  if (result.value !== null) emit('done');
  else emit('close');
};
const onOpenChange = (open: boolean): void => {
  if (!open) onClose();
};
</script>

<template>
  <AlertDialog :open="true" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          <span class="text-destructive flex items-center gap-2">
            <TriangleAlertIcon class="size-5" />
            {{ t('admin.orders.itemCancel.title', { target: targetLabel }) }}
          </span>
        </AlertDialogTitle>
        <AlertDialogDescription v-if="result === null">
          {{ t('admin.orders.itemCancel.warn', { target: targetLabel }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div v-if="result === null" class="flex flex-col gap-3">
        <Panel tone="muted" class="text-sm break-words">{{ props.itemLabel }}</Panel>
        <p v-if="errorMessage !== null" class="text-destructive text-sm">{{ errorMessage }}</p>
      </div>
      <div v-else class="flex flex-col gap-2">
        <Alert v-if="result.orderCancelled" variant="destructive" size="sm">
          <AlertDescription>{{ t('admin.orders.itemCancel.orderCancelled') }}</AlertDescription>
        </Alert>
        <OrderActionResult v-if="resultForPanel !== null" :data="resultForPanel" />
      </div>

      <AlertDialogFooter>
        <Button variant="outline" :disabled="isPending" @click="onClose">
          {{ result !== null ? t('admin.orders.itemCancel.close') : t('admin.orders.itemCancel.cancel') }}
        </Button>
        <Button v-if="result === null" variant="destructive" :disabled="isPending" @click="onConfirm">
          {{ isPending ? t('admin.orders.itemCancel.processing') : t('admin.orders.itemCancel.confirm', { target: targetLabel }) }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
