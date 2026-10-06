<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { useOrderDeleteMutation } from '@/admin/useAdminOrders';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import OrderActionResult from './OrderActionResult.vue';

// 주문 선택삭제 확인 — 옛 components/admin/OrderDeleteModal.vue 와 같은 props·emits·동작.
// 미입금('주문')만 대상, 되돌릴 수 없음 경고. 견적 삭제와 달리 미리보기 API 가 없어 확인 한 단계만 두고,
// 미입금이 아닌 건은 서버가 skipped(NOT_ORDER_STATUS)로 돌려주므로 결과 패널로 안내한다.
// 호출부가 v-if 로 띄운다(열린 채 마운트). 결과가 나온 뒤 닫으면 deleted, 그 전이면 close.
const props = defineProps<{ odIds: string[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const { t } = useI18n();

const { mutate: runDelete, data, isPending: deleting, error: deleteError } = useOrderDeleteMutation();
const result = computed(() => data.value?.data ?? null);

const onConfirm = (): void => {
  if (props.odIds.length === 0) return;
  runDelete([...props.odIds]);
};

const onClose = (): void => {
  if (deleting.value) return;
  if (result.value !== null) emit('deleted');
  else emit('close');
};
const onOpenChange = (open: boolean): void => {
  if (!open) onClose();
};

const errorMessage = computed<string | null>(() => {
  const err = deleteError.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) return err.payload?.message ?? t('admin.orders.deleteModal.failed');
  return t('admin.orders.deleteModal.failed');
});
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md" :show-close-button="false">
      <DialogHeader>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            {{ t('admin.orders.deleteModal.title') }}
          </span>
        </DialogTitle>
        <DialogDescription v-if="result === null">
          {{ t('admin.orders.deleteModal.warn', { n: props.odIds.length }) }}
        </DialogDescription>
      </DialogHeader>

      <template v-if="result === null">
        <p class="text-muted-foreground text-xs break-all tabular-nums">{{ props.odIds.join(', ') }}</p>
        <Alert v-if="errorMessage !== null" variant="destructive" size="sm">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>
      </template>
      <OrderActionResult v-else :data="result" />

      <DialogFooter>
        <Button variant="outline" :disabled="deleting" @click="onClose">
          {{ result !== null ? t('admin.orders.deleteModal.close') : t('admin.orders.deleteModal.cancel') }}
        </Button>
        <Button v-if="result === null" variant="destructive" :disabled="deleting" @click="onConfirm">
          <Spinner v-if="deleting" />
          {{
            deleting
              ? t('admin.orders.deleteModal.deleting')
              : t('admin.orders.deleteModal.confirm', { n: props.odIds.length })
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
