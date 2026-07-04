<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import { useDeletePreview, useDeleteQuotes } from '../../admin/useAdminQuotes';
import { formatKrw } from '../../lib/format';

// 견적 완전삭제 확인 모달(danger) — 단건/다중 공통(ids 1개 = 단건). 삭제 전 서버 프리뷰로
// "무엇이 함께 지워지는지"를 건별 분류(삭제가능/차단=결제완료)해 보여주고, 견적↔주문 1:N
// 이라 같은 주문에 묶인 미선택 형제 견적도 경고한다. 삭제 후엔 건별 결과 요약을 보여준다.
const props = defineProps<{ ids: number[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

const {
  mutate: loadPreview,
  data: previewData,
  isPending: previewLoading,
  isError: previewFailed,
} = useDeletePreview();
const preview = computed(() => previewData.value?.data ?? null);

const {
  mutate: runDelete,
  data: deleteData,
  isPending: deleting,
  error: deleteError,
} = useDeleteQuotes();
const deleteResult = computed(() => deleteData.value?.data ?? null);

const deletableItems = computed(() => preview.value?.items.filter((i) => i.deletable) ?? []);
const blockedItems = computed(() => preview.value?.items.filter((i) => !i.deletable) ?? []);

const onConfirm = (): void => {
  const p = preview.value;
  if (p === null || p.summary.deletableCount === 0) return;
  runDelete(props.ids);
};

const onClose = (): void => {
  if (deleting.value) return;
  if (deleteResult.value !== null) emit('deleted');
  else emit('close');
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
  if (e.key === 'Escape') onClose();
};
onMounted(() => {
  loadPreview(props.ids);
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
        class="relative w-full max-w-lg rounded-lg bg-white shadow-xl"
        role="alertdialog"
        aria-modal="true"
      >
        <header class="border-b border-gray-200 px-5 py-3">
          <h2 class="text-base font-bold text-red-700">
            {{ t('admin.quotes.deleteModal.title') }}
          </h2>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
          <p v-if="previewLoading" class="py-6 text-center text-sm text-gray-400">
            {{ t('admin.quotes.deleteModal.loading') }}
          </p>
          <p
            v-else-if="previewFailed || preview === null"
            class="py-6 text-center text-sm text-red-600"
          >
            {{ t('admin.quotes.error.UNKNOWN') }}
          </p>

          <!-- 삭제 결과 -->
          <p v-else-if="deleteResult !== null" class="py-2 text-sm text-gray-800">
            {{
              t('admin.quotes.deleteModal.resultSummary', {
                deleted: deleteResult.summary.deleted,
                blocked: deleteResult.summary.blocked,
                failed: deleteResult.summary.failed,
              })
            }}
          </p>

          <!-- 삭제 전 프리뷰 -->
          <template v-else>
            <p class="text-sm text-gray-700">{{ t('admin.quotes.deleteModal.intro') }}</p>

            <!-- 삭제 대상 -->
            <div v-if="deletableItems.length > 0" class="mt-3">
              <p class="text-xs font-semibold text-gray-500">
                {{ t('admin.quotes.deleteModal.willDelete', { n: preview.summary.deletableCount }) }}
                · {{ t('admin.quotes.deleteModal.totalFiles', { n: preview.summary.totalFileCount }) }}
              </p>
              <ul class="mt-1 space-y-1 text-sm text-gray-800">
                <li
                  v-for="it in deletableItems"
                  :key="it.projectId"
                  class="flex items-center gap-2"
                >
                  <span class="text-gray-400">•</span>
                  <span class="truncate">
                    {{ it.projectName }}
                    <span class="text-xs text-gray-400">#{{ it.projectId }}</span>
                  </span>
                  <span
                    v-if="it.deletesOrder"
                    class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700"
                  >
                    {{ t('admin.quotes.deleteModal.tagOrder') }}
                  </span>
                  <span
                    v-else-if="it.removesCartRow"
                    class="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
                  >
                    {{ t('admin.quotes.deleteModal.tagCart') }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- 차단(결제완료) -->
            <div
              v-if="blockedItems.length > 0"
              class="mt-3 rounded-md border border-red-200 bg-red-50 p-3"
            >
              <p class="text-xs font-semibold text-red-700">
                {{ t('admin.quotes.deleteModal.willBlock', { n: preview.summary.blockedCount }) }}
              </p>
              <ul class="mt-1 space-y-0.5 text-sm text-red-700">
                <li v-for="it in blockedItems" :key="it.projectId" class="truncate">
                  {{ it.projectName }} —
                  {{ t('admin.quotes.deleteModal.blockedShort', { status: it.odStatus ?? '' }) }}
                </li>
              </ul>
              <p class="mt-1 text-xs text-red-600">
                {{ t('admin.quotes.deleteModal.blockedHint') }}
              </p>
            </div>

            <!-- 주문 그룹 경고(1:N) -->
            <div
              v-for="g in preview.orderGroups"
              :key="g.odId"
              class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm"
            >
              <p class="font-semibold text-amber-800">
                {{ t('admin.quotes.deleteModal.orderTitle') }} #{{ g.odId }}
                <span class="font-normal text-amber-600">
                  ({{ g.odStatus }} · {{ formatKrw(g.receiptPrice) }})
                </span>
              </p>
              <p v-if="g.selectedCount > 1" class="text-amber-900">
                {{ t('admin.quotes.deleteModal.orderSelected', { n: g.selectedCount }) }}
              </p>
              <div v-if="g.unselectedSiblings.length > 0" class="mt-1">
                <p class="font-medium text-red-700">
                  {{ t('admin.quotes.deleteModal.siblingsWarn') }}
                </p>
                <ul class="ml-4 list-disc text-red-700">
                  <li v-for="(name, i) in g.unselectedSiblings" :key="i">{{ name }}</li>
                </ul>
              </div>
            </div>

            <p v-if="preview.notFound.length > 0" class="mt-3 text-xs text-gray-400">
              {{ t('admin.quotes.deleteModal.notFound', { n: preview.notFound.length }) }}
            </p>
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
            @click="onClose"
          >
            {{
              deleteResult !== null
                ? t('admin.quotes.deleteModal.close')
                : t('admin.quotes.deleteModal.cancel')
            }}
          </button>
          <button
            v-if="deleteResult === null && preview !== null && preview.summary.deletableCount > 0"
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="deleting"
            @click="onConfirm"
          >
            {{
              deleting
                ? t('admin.quotes.deleteModal.deleting')
                : t('admin.quotes.deleteModal.confirmN', { n: preview.summary.deletableCount })
            }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
