<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQueryClient } from '@tanstack/vue-query';
import { DownloadIcon, UploadIcon } from '@lucide/vue';
import { AdminOrderActionResponse, ApiError, apiRoutes } from '@sp/api-contract';
import type { AdminOrderActionResponseType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { downloadDeliveryExcel } from '@/admin/useAdminOrders';
import { Button } from '@/next/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/next/components/ui/dialog';
import { Separator } from '@/next/components/ui/separator';
import { Spinner } from '@/next/components/ui/spinner';
import OrderActionResult from './OrderActionResult.vue';

// 엑셀 배송처리 — 옛 components/admin/ExcelDeliveryModal.vue 와 같은 emits·동작.
// 생산완료 주문 양식 다운로드 → 운송장 채워 업로드 → 일괄 배송처리 결과.
// 업로드는 multipart 라 apiSend(JSON 전용) 불가 · @sp/shared 에 form 헬퍼도 없어(authFetch 비공개)
// auth store 토큰으로 직접 fetch 한다(401 시 bootstrap 1회 재시도). 필드명 'file' 고정(BE 계약).
// 호출부가 v-if 로 띄운다. 진행 중에는 닫히지 않는다.
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
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
        parsed.success && parsed.data.message !== '' ? parsed.data.message : t('admin.orders.excel.uploadFailed');
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

const onOpenChange = (open: boolean): void => {
  if (!open && !busy.value) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('admin.orders.excel.title') }}</DialogTitle>
        <DialogDescription>양식을 내려받아 운송장을 채워 올리면 한 번에 배송 처리됩니다.</DialogDescription>
      </DialogHeader>

      <!-- 다운로드 -->
      <section class="flex flex-col gap-2">
        <div class="space-y-0.5">
          <h3 class="text-sm font-semibold">{{ t('admin.orders.excel.downloadTitle') }}</h3>
          <p class="text-muted-foreground text-xs">{{ t('admin.orders.excel.downloadHint') }}</p>
        </div>
        <Button variant="outline" size="sm" class="self-start" :disabled="busy" @click="onDownload">
          <Spinner v-if="downloading" />
          <DownloadIcon v-else />
          {{ downloading ? t('admin.orders.excel.downloading') : t('admin.orders.excel.download') }}
        </Button>
        <p v-if="downloadError !== null" class="text-destructive text-xs">{{ downloadError }}</p>
      </section>

      <Separator />

      <!-- 업로드 — label 안의 숨은 파일 입력(누르면 파일 선택이 열린다). 진행 중에는 막는다. -->
      <section class="flex flex-col gap-2">
        <div class="space-y-0.5">
          <h3 class="text-sm font-semibold">{{ t('admin.orders.excel.uploadTitle') }}</h3>
          <p class="text-muted-foreground text-xs">{{ t('admin.orders.excel.uploadHint') }}</p>
        </div>
        <label
          class="focus-within:ring-ring/50 self-start rounded-md focus-within:ring-3"
          :class="busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'"
        >
          <input type="file" accept=".xls,.xlsx" class="sr-only" :disabled="busy" @change="onFileChange">
          <Button as="span" size="sm">
            <Spinner v-if="uploading" />
            <UploadIcon v-else />
            {{ uploading ? t('admin.orders.excel.uploading') : t('admin.orders.excel.choose') }}
          </Button>
        </label>
        <p v-if="uploadError !== null" class="text-destructive text-xs">{{ uploadError }}</p>
      </section>

      <OrderActionResult v-if="result !== null" :data="result" />
    </DialogContent>
  </Dialog>
</template>
