<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQueryClient } from '@tanstack/vue-query';
import { AdminOrderActionResponse, ApiError, apiRoutes } from '@sp/api-contract';
import type { AdminOrderActionResponseType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { downloadDeliveryExcel } from '../../admin/useAdminOrders';
import OrderActionResult from './OrderActionResult.vue';

// 엑셀배송 모달 — 준비 주문 양식 다운로드 → 운송장 채워 업로드 → 일괄 배송처리 결과.
// 업로드는 multipart 라 apiSend(JSON 전용) 불가 · @sp/shared 에 form 헬퍼도 없어(authFetch 비공개)
// auth store 토큰으로 직접 fetch 한다(401 시 bootstrap 1회 재시도). 필드명 'file' 고정(BE 계약).
const emit = defineEmits<{ close: [] }>();
const i18n = useI18n();
const { t } = i18n;
const auth = useAuthStore();
const queryClient = useQueryClient();

const downloading = ref(false);
const downloadError = ref<string | null>(null);
const uploading = ref(false);
const uploadError = ref<string | null>(null);
const result = ref<AdminOrderActionResponseType['data'] | null>(null);

const busy = computed<boolean>(() => downloading.value || uploading.value);

const onDownload = (): void => {
  if (busy.value) return;
  downloading.value = true;
  downloadError.value = null;
  void downloadDeliveryExcel()
    .catch(() => {
      downloadError.value = t('admin.orders.excel.downloadFailed');
    })
    .finally(() => {
      downloading.value = false;
    });
};

const upload = async (file: File): Promise<void> => {
  uploading.value = true;
  uploadError.value = null;
  result.value = null;
  try {
    const form = new FormData();
    form.append('file', file);
    const url = `${apiRoutes.adminOrders}/delivery-excel`;
    const send = (): Promise<Response> => {
      const headers = new Headers({ Accept: 'application/json' });
      // Content-Type 은 지정하지 않는다 — 브라우저가 multipart boundary 를 자동 설정.
      if (auth.token !== null) headers.set('Authorization', `Bearer ${auth.token}`);
      return fetch(url, { method: 'POST', headers, body: form });
    };
    let res = await send();
    if (res.status === 401 && auth.token !== null) {
      await auth.bootstrap();
      res = await send();
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ApiError.safeParse(json);
      uploadError.value =
        parsed.success && parsed.data.message !== ''
          ? parsed.data.message
          : t('admin.orders.excel.uploadFailed');
      return;
    }
    const parsed = AdminOrderActionResponse.safeParse(json);
    if (!parsed.success) {
      uploadError.value = t('admin.orders.excel.uploadFailed');
      return;
    }
    result.value = parsed.data.data;
    await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
  } catch {
    uploadError.value = t('admin.orders.excel.uploadFailed');
  } finally {
    uploading.value = false;
  }
};

const onFileChange = (e: Event): void => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  void upload(file).finally(() => {
    input.value = ''; // 같은 파일 재선택 허용
  });
};

const onClose = (): void => {
  if (busy.value) return;
  emit('close');
};

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
      <div class="relative w-full max-w-md rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true">
        <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 class="text-base font-bold text-gray-900">{{ t('admin.orders.excel.title') }}</h2>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            :disabled="busy"
            @click="onClose"
          >
            {{ t('admin.orders.excel.close') }}
          </button>
        </header>

        <div class="space-y-4 px-5 py-4">
          <!-- 다운로드 -->
          <div>
            <p class="text-sm font-semibold text-gray-800">{{ t('admin.orders.excel.downloadTitle') }}</p>
            <p class="mt-0.5 text-xs text-gray-500">{{ t('admin.orders.excel.downloadHint') }}</p>
            <button
              type="button"
              class="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              :disabled="busy"
              @click="onDownload"
            >
              {{ downloading ? t('admin.orders.excel.downloading') : t('admin.orders.excel.download') }}
            </button>
            <p v-if="downloadError !== null" class="mt-1 text-xs text-red-600">{{ downloadError }}</p>
          </div>

          <!-- 업로드 -->
          <div class="border-t border-gray-200 pt-4">
            <p class="text-sm font-semibold text-gray-800">{{ t('admin.orders.excel.uploadTitle') }}</p>
            <p class="mt-0.5 text-xs text-gray-500">{{ t('admin.orders.excel.uploadHint') }}</p>
            <label
              class="mt-2 inline-flex cursor-pointer items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              :class="{ 'pointer-events-none opacity-50': busy }"
            >
              {{ uploading ? t('admin.orders.excel.uploading') : t('admin.orders.excel.choose') }}
              <input
                type="file"
                accept=".xls,.xlsx"
                class="hidden"
                :disabled="busy"
                @change="onFileChange"
              >
            </label>
            <p v-if="uploadError !== null" class="mt-1 text-xs text-red-600">{{ uploadError }}</p>
          </div>

          <OrderActionResult v-if="result !== null" :data="result" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
