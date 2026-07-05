<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderForceStatusRequestType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useOrderForceStatusMutation, type OrderForceTarget } from '../../admin/useAdminOrders';

// 주문 임의 상태 변경 확인 모달(danger) — 수납·알림·운송장 필수검증 없이 상태만 강제 변경(역방향 가능).
// 응답은 { odId } 에코 없음이라 성공 시 invalidate 로 상세·목록 갱신(뮤테이션 onSuccess).
type ForceDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;
const props = defineProps<{
  odId: string;
  target: OrderForceTarget;
  targetLabel: string;
  delivery: ForceDelivery | null;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
const i18n = useI18n();
const { t } = i18n;

const { mutate, isPending, isSuccess, error } = useOrderForceStatusMutation();

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

const errorMessage = computed<string | null>(() => {
  const err = error.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.orders.error.${code}`)) {
      return t(`admin.orders.error.${code}`);
    }
    return err.payload?.message ?? t('admin.orders.error.UNKNOWN');
  }
  return t('admin.orders.error.UNKNOWN');
});

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') onClose();
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40" @click="onClose" />
      <div
        class="relative w-full max-w-md rounded-lg bg-white shadow-xl"
        role="alertdialog"
        aria-modal="true"
      >
        <header class="border-b border-gray-200 px-5 py-3">
          <h2 class="text-base font-bold text-amber-700">
            {{ t('admin.orders.force.confirmTitle', { target: props.targetLabel }) }}
          </h2>
        </header>

        <div class="px-5 py-4">
          <p class="text-sm text-gray-700">
            {{ t('admin.orders.force.confirmWarn', { target: props.targetLabel }) }}
          </p>
          <p v-if="props.delivery !== null" class="mt-2 break-words rounded-md bg-gray-50 p-2 text-xs text-gray-600">
            {{ t('admin.orders.force.deliveryIncluded') }}:
            {{ props.delivery.deliveryCompany }} / {{ props.delivery.invoiceNo }} / {{ props.delivery.invoiceTime }}
          </p>
          <p v-if="errorMessage !== null" class="mt-3 text-sm text-red-600">{{ errorMessage }}</p>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            :disabled="isPending"
            @click="onClose"
          >
            {{ t('admin.orders.force.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            :disabled="isPending || isSuccess"
            @click="onConfirm"
          >
            {{ isPending ? t('admin.orders.force.applying') : t('admin.orders.force.confirm') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
