<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import { useOrderDeleteMutation } from '../../admin/useAdminOrders';
import OrderActionResult from './OrderActionResult.vue';

// 주문 선택삭제 확인 모달(danger) — 미입금('주문')만 대상, 되돌릴 수 없음 경고.
// 견적 프리뷰(주문↔견적 1:N)가 있는 견적 삭제와 달리 프리뷰 API 가 없어 확인 게이트만 둔다.
// 서버가 미입금이 아닌 건은 skipped(NOT_ORDER_STATUS)로 돌려주므로 결과 패널로 안내한다.
const props = defineProps<{ odIds: string[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

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

const errorMessage = computed<string | null>(() => {
  const err = deleteError.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) return err.payload?.message ?? t('admin.orders.deleteModal.failed');
  return t('admin.orders.deleteModal.failed');
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
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40" @click="onClose" />
      <div
        class="relative w-full max-w-md rounded-lg bg-white shadow-xl"
        role="alertdialog"
        aria-modal="true"
      >
        <header class="border-b border-gray-200 px-5 py-3">
          <h2 class="text-base font-bold text-red-700">{{ t('admin.orders.deleteModal.title') }}</h2>
        </header>

        <div class="px-5 py-4">
          <template v-if="result === null">
            <p class="text-sm text-gray-700">
              {{ t('admin.orders.deleteModal.warn', { n: props.odIds.length }) }}
            </p>
            <p class="mt-2 break-all text-xs text-gray-400">{{ props.odIds.join(', ') }}</p>
            <p v-if="errorMessage !== null" class="mt-3 text-sm text-red-600">{{ errorMessage }}</p>
          </template>
          <OrderActionResult v-else :data="result" />
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            :disabled="deleting"
            @click="onClose"
          >
            {{ result !== null ? t('admin.orders.deleteModal.close') : t('admin.orders.deleteModal.cancel') }}
          </button>
          <button
            v-if="result === null"
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="deleting"
            @click="onConfirm"
          >
            {{ deleting ? t('admin.orders.deleteModal.deleting') : t('admin.orders.deleteModal.confirm', { n: props.odIds.length }) }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
