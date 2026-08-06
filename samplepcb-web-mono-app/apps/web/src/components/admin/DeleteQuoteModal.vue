<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import { ADMIN_DELETE_BLOCK_TEXT, ADMIN_DELETE_WARNING_TEXT } from '@sp/api-contract';
import { useDeletePreview, useDeleteQuotes } from '../../admin/useAdminQuotes';
import { formatKrw } from '../../lib/format';

// 견적 완전삭제 확인 모달(danger) — 단건/다중 공통(ids 1개 = 단건). 삭제 전 서버 프리뷰로
// "무엇이 함께 지워지는지"를 건별 분류해 보여주고, 견적↔주문 1:N 이라 같은 주문에 묶인
// 미선택 형제 견적도 경고한다. 삭제 후엔 건별 결과 요약을 보여준다.
//
// 차단(blocker)은 서버 판정이 정본이다. 우회 체크는 **결제 주문 하나뿐** — 발주·선적은
// 협력사와 합의된 기록이라 체크 하나로 넘길 수 없고, Case 상세에서 먼저 정리해야 한다.
// 실행에는 사유가 필수다(감사 원장 sp_delete_audit 에 건별로 남는다).
const props = defineProps<{ ids: number[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

const reason = ref('');
const forceDeletePaidOrder = ref(false);
const acknowledged = ref(false);

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

// 강제 해제를 켜면 "결제만 걸린 건"이 삭제 대상으로 옮겨온다 — 서버 판정과 같은 규칙.
const onlyPaidBlocked = (reasons: readonly string[]): boolean =>
  reasons.length === 1 && reasons[0] === 'PAID_ORDER';
const isDeletable = (item: { deletable: boolean; blockReasons: string[] }): boolean =>
  item.deletable || (forceDeletePaidOrder.value && onlyPaidBlocked(item.blockReasons));

const deletableItems = computed(() => preview.value?.items.filter(isDeletable) ?? []);
const blockedItems = computed(() => preview.value?.items.filter((i) => !isDeletable(i)) ?? []);
/** 강제 해제 체크를 노출할지 — 결제만 걸린 건이 하나라도 있을 때만. */
const paidForceAvailable = computed(() => (preview.value?.summary.forceableCount ?? 0) > 0);
const summaryWarnings = computed(() => preview.value?.summary.warnings ?? []);
const reasonValid = computed(() => reason.value.trim().length >= 2);
const canSubmit = computed(
  () => deletableItems.value.length > 0 && reasonValid.value && acknowledged.value,
);

const onConfirm = (): void => {
  if (preview.value === null || !canSubmit.value) return;
  runDelete({
    ids: props.ids,
    reason: reason.value.trim(),
    ...(forceDeletePaidOrder.value ? { forceDeletePaidOrder: true } : {}),
  });
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
                  <span
                    v-if="it.isLegacy"
                    class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
                  >
                    이관
                  </span>
                  <span
                    v-if="it.pcb.rfqs + it.pcb.pos + it.pcb.shipments > 0"
                    class="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700"
                    :title="`협력사 RFQ ${it.pcb.rfqs} · 발주 ${it.pcb.pos} · 선적 ${it.pcb.shipments} · 첨부 ${it.pcb.attachments}`"
                  >
                    협력 {{ it.pcb.rfqs }}/{{ it.pcb.pos }}/{{ it.pcb.shipments }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- 차단 — 사유별로 무엇을 먼저 해야 하는지 알려준다(서버 판정이 정본) -->
            <div
              v-if="blockedItems.length > 0"
              class="mt-3 rounded-md border border-red-200 bg-red-50 p-3"
            >
              <p class="text-xs font-semibold text-red-700">
                {{ t('admin.quotes.deleteModal.willBlock', { n: blockedItems.length }) }}
              </p>
              <!-- 사유는 **전부** 보인다 — 하나만 보이면 "강제 삭제하면 되겠네"로 오해한다
                   (결제·발주·선적이 동시에 걸린 건이 실제로 있다). -->
              <ul class="mt-1 space-y-1.5 text-sm text-red-700">
                <li v-for="it in blockedItems" :key="it.projectId">
                  <p class="truncate font-semibold">{{ it.projectName }}</p>
                  <ul class="ml-4 list-disc">
                    <li v-for="code in it.blockReasons" :key="code" class="leading-5">
                      {{ ADMIN_DELETE_BLOCK_TEXT[code] }}
                    </li>
                  </ul>
                </li>
              </ul>
            </div>

            <!-- 되돌릴 수 없는 부수효과(경고 레이어) -->
            <div
              v-if="summaryWarnings.length > 0"
              class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3"
            >
              <p class="text-xs font-semibold text-amber-800">삭제하면 이렇게 됩니다</p>
              <ul class="mt-1 ml-4 list-disc space-y-0.5 text-sm text-amber-900">
                <li v-for="w in summaryWarnings" :key="w">{{ ADMIN_DELETE_WARNING_TEXT[w] }}</li>
              </ul>
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

            <!-- 결제 주문 강제 해제 — 유일하게 우회 가능한 차단 -->
            <label
              v-if="paidForceAvailable"
              class="mt-3 flex cursor-pointer gap-2 rounded-md border-2 border-red-400 bg-red-50 p-3"
            >
              <input v-model="forceDeletePaidOrder" type="checkbox" class="mt-0.5 size-4 accent-red-700">
              <span>
                <b class="text-sm text-red-900">
                  결제 이력·주문까지 강제 삭제 ({{ preview.summary.forceableCount }}건)
                </b>
                <span class="mt-0.5 block text-xs leading-5 text-red-700">
                  영카트 주문과 장바구니 행을 함께 삭제합니다. 외부 결제사 승인 취소·환불은
                  별도로 처리해야 합니다.
                </span>
              </span>
            </label>

            <label class="mt-3 block text-xs font-semibold text-gray-700">
              삭제 사유 <span class="text-red-600">필수</span>
              <textarea
                v-model="reason"
                rows="2"
                maxlength="1000"
                class="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-normal outline-none focus:border-red-400"
                placeholder="중복 등록, 잘못 생성된 견적 등"
              />
            </label>

            <label class="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">
              <input v-model="acknowledged" type="checkbox" class="mt-0.5 size-4 accent-red-700">
              <span>외부 메일·협력사 작업은 회수되지 않으며 삭제 데이터는 복구할 수 없음을 확인했습니다.</span>
            </label>

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
            v-if="deleteResult === null && preview !== null && deletableItems.length > 0"
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="deleting || !canSubmit"
            :title="canSubmit ? '' : '삭제 사유와 확인 체크가 필요합니다'"
            @click="onConfirm"
          >
            {{
              deleting
                ? t('admin.quotes.deleteModal.deleting')
                : t('admin.quotes.deleteModal.confirmN', { n: deletableItems.length })
            }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
