<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderActionResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useOrderItemStatusMutation,
  type CancelItemTarget,
} from '../../admin/useAdminOrders';
import OrderActionResult from './OrderActionResult.vue';

// 카트행 취소/반품/품절 확인 모달(danger) — 되돌릴 수 없음(복귀 경로 없음). OrderDeleteModal 패턴.
// 처리 결과(processed/skipped)는 OrderActionResult 를 어댑터로 재사용하고, 전량 취소 전환 시
// 별도 안내 문구를 덧붙인다.
const props = defineProps<{
  odId: string;
  ctIds: number[];
  target: CancelItemTarget;
  itemLabel: string;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
const i18n = useI18n();
const { t } = i18n;

const TARGET_SLUG: Record<CancelItemTarget, string> = {
  취소: 'cancel',
  반품: 'return',
  품절: 'soldOut',
};
const targetLabel = computed<string>(() =>
  t(`admin.orders.itemCancel.target.${TARGET_SLUG[props.target]}`),
);

const { mutate, data, isPending, error } = useOrderItemStatusMutation();
const result = computed(() => data.value?.data ?? null);

// OrderActionResult 는 { processed:string[], skipped:[{odId,reason}], notify } 형태라
// 카트행 응답(processed:number[], skipped:[{ctId,reason}])을 어댑터로 맞춘다.
const resultForPanel = computed<AdminOrderActionResponseType['data'] | null>(() => {
  const r = result.value;
  if (r === null) return null;
  return {
    processed: r.processed.map((n) => String(n)),
    skipped: r.skipped.map((s) => ({ odId: String(s.ctId), reason: s.reason })),
    notify: [],
  };
});

const onConfirm = (): void => {
  if (props.ctIds.length === 0) return;
  mutate({ odId: props.odId, ctIds: [...props.ctIds], target: props.target });
};

const onClose = (): void => {
  if (isPending.value) return;
  if (result.value !== null) emit('done');
  else emit('close');
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
          <h2 class="text-base font-bold text-red-700">
            {{ t('admin.orders.itemCancel.title', { target: targetLabel }) }}
          </h2>
        </header>

        <div class="px-5 py-4">
          <template v-if="result === null">
            <p class="text-sm text-gray-700">
              {{ t('admin.orders.itemCancel.warn', { target: targetLabel }) }}
            </p>
            <p class="mt-2 break-words rounded-md bg-gray-50 p-2 text-sm text-gray-800">
              {{ props.itemLabel }}
            </p>
            <p v-if="errorMessage !== null" class="mt-3 text-sm text-red-600">{{ errorMessage }}</p>
          </template>
          <template v-else>
            <p v-if="result.orderCancelled" class="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {{ t('admin.orders.itemCancel.orderCancelled') }}
            </p>
            <OrderActionResult v-if="resultForPanel !== null" :data="resultForPanel" />
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            :disabled="isPending"
            @click="onClose"
          >
            {{ result !== null ? t('admin.orders.itemCancel.close') : t('admin.orders.itemCancel.cancel') }}
          </button>
          <button
            v-if="result === null"
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="isPending"
            @click="onConfirm"
          >
            {{ isPending ? t('admin.orders.itemCancel.processing') : t('admin.orders.itemCancel.confirm', { target: targetLabel }) }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
