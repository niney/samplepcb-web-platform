<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import { useDeletePreview, useDeleteQuote } from '../../admin/useAdminQuotes';
import { formatKrw } from '../../lib/format';

// 견적 완전삭제 확인 모달(danger) — 삭제 전 "무엇이 함께 지워지는지"를 서버 프리뷰로
// 보여주고 확인받는다. 결제완료 주문이 묶인 견적은 서버가 deletable=false 로 내려주므로
// 삭제 버튼 대신 차단 사유를 노출한다(진짜 경계는 서버 409 PAID_ORDER). 견적↔주문 1:N
// 이라 같은 주문에 묶인 다른 견적명도 함께 경고한다.
const props = defineProps<{ projectId: number }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

const projectIdRef = computed(() => props.projectId);
const { data, isLoading, isError } = useDeletePreview(projectIdRef);
const preview = computed(() => data.value?.data ?? null);

const { mutate: deleteQuote, isPending: deleting, error: deleteError } = useDeleteQuote();

const onConfirm = (): void => {
  const p = preview.value;
  if (p?.deletable !== true) return;
  deleteQuote(p.projectId, {
    onSuccess: () => {
      emit('deleted');
    },
  });
};

const errorMessage = computed<string | null>(() => {
  const err = deleteError.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.quotes.error.${code}`)) {
      return t(`admin.quotes.error.${code}`);
    }
    return err.payload?.message ?? t('admin.quotes.error.UNKNOWN');
  }
  return t('admin.quotes.error.UNKNOWN');
});

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && !deleting.value) emit('close');
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
      <div class="absolute inset-0 bg-black/40" @click="!deleting && emit('close')" />
      <div
        class="relative w-full max-w-md rounded-lg bg-white shadow-xl"
        role="alertdialog"
        aria-modal="true"
      >
        <header class="border-b border-gray-200 px-5 py-3">
          <h2 class="text-base font-bold text-red-700">
            {{ t('admin.quotes.deleteModal.title') }}
          </h2>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
          <p v-if="isLoading" class="py-6 text-center text-sm text-gray-400">
            {{ t('admin.quotes.deleteModal.loading') }}
          </p>
          <p
            v-else-if="isError || preview === null"
            class="py-6 text-center text-sm text-red-600"
          >
            {{ t('admin.quotes.error.UNKNOWN') }}
          </p>
          <template v-else>
            <!-- 차단(결제완료 주문) -->
            <div
              v-if="!preview.deletable"
              class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {{
                t('admin.quotes.deleteModal.blockedPaid', {
                  status: preview.order?.odStatus ?? '',
                })
              }}
            </div>

            <template v-else>
              <p class="text-sm text-gray-700">{{ t('admin.quotes.deleteModal.intro') }}</p>
              <ul class="mt-3 space-y-1.5 text-sm text-gray-800">
                <li class="flex gap-2">
                  <span class="text-gray-400">•</span>
                  <span>
                    {{ t('admin.quotes.deleteModal.targetProject') }}:
                    <b>{{ preview.projectName }}</b> (#{{ preview.projectId }})
                  </span>
                </li>
                <li v-if="preview.fileCount > 0" class="flex gap-2">
                  <span class="text-gray-400">•</span>
                  <span>{{ t('admin.quotes.deleteModal.targetFiles', { n: preview.fileCount }) }}</span>
                </li>
                <li v-if="preview.removesCartRow" class="flex gap-2">
                  <span class="text-gray-400">•</span>
                  <span>{{ t('admin.quotes.deleteModal.cartRemove') }}</span>
                </li>
              </ul>

              <!-- 연결된 주문 -->
              <div
                v-if="preview.order !== null"
                class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm"
              >
                <p class="font-semibold text-amber-800">
                  {{ t('admin.quotes.deleteModal.orderTitle') }} #{{ preview.order.odId }}
                </p>
                <dl class="mt-1 space-y-0.5 text-amber-900">
                  <div class="flex gap-2">
                    <dt class="w-16 shrink-0 text-amber-600">
                      {{ t('admin.quotes.deleteModal.orderStatus') }}
                    </dt>
                    <dd>{{ preview.order.odStatus }}</dd>
                  </div>
                  <div class="flex gap-2">
                    <dt class="w-16 shrink-0 text-amber-600">
                      {{ t('admin.quotes.deleteModal.orderReceipt') }}
                    </dt>
                    <dd>{{ formatKrw(preview.order.receiptPrice) }}</dd>
                  </div>
                  <div v-if="preview.order.settleCase !== ''" class="flex gap-2">
                    <dt class="w-16 shrink-0 text-amber-600">
                      {{ t('admin.quotes.deleteModal.orderPg') }}
                    </dt>
                    <dd>{{ preview.order.settleCase }}</dd>
                  </div>
                </dl>
                <p v-if="preview.deletesOrder" class="mt-1.5 font-medium text-amber-800">
                  {{ t('admin.quotes.deleteModal.orderDeletes', { od: preview.order.odId }) }}
                </p>
                <div v-if="preview.order.siblings.length > 0" class="mt-1.5">
                  <p class="font-medium text-red-700">
                    {{ t('admin.quotes.deleteModal.siblingsWarn') }}
                  </p>
                  <ul class="ml-4 list-disc text-red-700">
                    <li v-for="(name, i) in preview.order.siblings" :key="i">{{ name }}</li>
                  </ul>
                </div>
              </div>
            </template>

            <p v-if="errorMessage !== null" class="mt-3 text-sm text-red-600">
              {{ errorMessage }}
            </p>
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            :disabled="deleting"
            @click="emit('close')"
          >
            {{ t('admin.quotes.deleteModal.cancel') }}
          </button>
          <button
            v-if="preview !== null && preview.deletable"
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="deleting"
            @click="onConfirm"
          >
            {{
              deleting
                ? t('admin.quotes.deleteModal.deleting')
                : t('admin.quotes.deleteModal.confirm')
            }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
