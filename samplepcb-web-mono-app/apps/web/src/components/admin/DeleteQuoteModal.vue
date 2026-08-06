<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import { ADMIN_DELETE_BLOCK_TEXT, ADMIN_DELETE_WARNING_TEXT } from '@sp/api-contract';
import { useDeletePreview, useDeleteQuotes } from '../../admin/useAdminQuotes';
import { formatKrw } from '../../lib/format';

// 견적 완전삭제 확인 모달(danger) — 단건/다중 공통(ids 1개 = 단건).
//
// 구조는 SmartBOM Case 삭제(BomCaseDeleteModal)와 같은 **2단계**다(사용자 결정 2026-08-06):
//   1차 = 삭제 영향 확인(무엇이 함께 지워지는지 · 무엇이 막고 있는지)
//   2차 = 되돌릴 수 없음 최종 확인(강제 해제 체크 · 사유 · 확인 체크)
// 되돌릴 수 없는 배치 작업이라 "보고 나서 한 번 더 결심"하는 층을 두는 것이 요지다.
//
// 차단(blocker)은 서버 판정이 정본이다. 우회 체크는 **결제 주문 하나뿐** — 발주·선적은
// 협력사와 합의된 기록이라 체크 하나로 넘길 수 없고, Case 상세에서 먼저 정리해야 한다.
// 실행에는 사유가 필수다(감사 원장 sp_delete_audit 에 건별로 남는다).
const props = defineProps<{ ids: number[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

const step = ref<'impact' | 'confirm'>('impact');
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

/** 삭제 대상의 협력 트랙 합계 — "무엇이 함께 사라지는지"의 근거 숫자. */
const impact = computed(() => {
  const rows = deletableItems.value;
  const sum = (pick: (r: (typeof rows)[number]) => number): number =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  return {
    cases: rows.length,
    files: sum((r) => r.fileCount),
    rfqs: sum((r) => r.pcb.rfqs),
    pos: sum((r) => r.pcb.pos),
    shipments: sum((r) => r.pcb.shipments),
    attachments: sum((r) => r.pcb.attachments),
    orders: rows.filter((r) => r.deletesOrder).length,
    carts: rows.filter((r) => r.removesCartRow).length,
    legacy: rows.filter((r) => r.isLegacy).length,
  };
});

const reasonValid = computed(() => reason.value.trim().length >= 2);
const canContinue = computed(() => deletableItems.value.length > 0);
const canSubmit = computed(() => canContinue.value && reasonValid.value && acknowledged.value);

// 체크 상태를 바꾸면 삭제 대상 집합이 달라지므로 1차로 되돌려 다시 보게 한다.
const backToImpact = (): void => {
  step.value = 'impact';
  acknowledged.value = false;
};

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
      <div class="absolute inset-0 bg-black/45" @click="onClose" />

      <!-- 삭제 결과 -->
      <section
        v-if="deleteResult !== null"
        class="relative w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
      >
        <header class="border-b border-gray-200 px-6 py-4">
          <h2 class="text-lg font-extrabold text-gray-900">삭제 완료</h2>
        </header>
        <div class="px-6 py-5 text-sm text-gray-800">
          {{
            t('admin.quotes.deleteModal.resultSummary', {
              deleted: deleteResult.summary.deleted,
              blocked: deleteResult.summary.blocked,
              failed: deleteResult.summary.failed,
            })
          }}
        </div>
        <footer class="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900"
            @click="onClose"
          >
            {{ t('admin.quotes.deleteModal.close') }}
          </button>
        </footer>
      </section>

      <!-- 1차 레이어: 서버가 계산한 삭제 영향 -->
      <section
        v-else-if="step === 'impact'"
        class="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quote-delete-impact-title"
      >
        <header class="border-b border-red-100 bg-red-50 px-6 py-4">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-500">
            1차 경고 · 삭제 영향 확인
          </p>
          <h2 id="quote-delete-impact-title" class="mt-1 text-lg font-extrabold text-red-800">
            견적 {{ ids.length }}건을 영구 삭제합니다
          </h2>
        </header>

        <div class="max-h-[68vh] overflow-y-auto px-6 py-5">
          <p v-if="previewLoading" class="py-12 text-center text-sm text-gray-400">
            주문·협력사 발주·선적·파일 관계를 확인하는 중…
          </p>
          <div
            v-else-if="previewFailed || preview === null"
            class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            삭제 영향을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
          <template v-else>
            <!-- 차단 — 사유는 항목별로 전부 보인다(하나만 보이면 "강제하면 되겠네"로 오해) -->
            <div
              v-if="blockedItems.length > 0"
              class="rounded-xl border border-red-300 bg-red-50 p-4"
            >
              <p class="text-sm font-extrabold text-red-800">
                {{
                  paidForceAvailable
                    ? '결제 주문 강제 삭제 확인이 필요합니다'
                    : `이 견적 ${blockedItems.length}건은 영구 삭제할 수 없습니다`
                }}
              </p>
              <ul class="mt-2 space-y-2 text-xs leading-5 text-red-700">
                <li v-for="it in blockedItems" :key="it.projectId">
                  <p class="truncate font-bold">
                    {{ it.projectName }}
                    <span class="font-mono font-normal opacity-70">#{{ it.projectId }}</span>
                  </p>
                  <ul class="ml-3 mt-0.5 space-y-0.5">
                    <li v-for="code in it.blockReasons" :key="code">
                      • {{ ADMIN_DELETE_BLOCK_TEXT[code] }}
                    </li>
                  </ul>
                </li>
              </ul>
            </div>

            <!-- 함께 사라지는 것 -->
            <div :class="blockedItems.length > 0 ? 'mt-4' : ''">
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">삭제 견적 · 이관분</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.cases }} · {{ impact.legacy }}</p>
                </div>
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">거버·썸네일 파일</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.files }}</p>
                </div>
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">협력 첨부(EQ·송장)</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.attachments }}</p>
                </div>
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">협력사 견적요청</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.rfqs }}</p>
                </div>
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">발주서 · 선적</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.pos }} · {{ impact.shipments }}</p>
                </div>
                <div class="rounded-lg border border-gray-200 p-3">
                  <p class="text-[11px] text-gray-500">삭제 주문 · 장바구니 행</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.orders }} · {{ impact.carts }}</p>
                </div>
              </div>
            </div>

            <!-- 삭제 대상 목록 -->
            <div v-if="deletableItems.length > 0" class="mt-4 rounded-xl border border-gray-200 p-4">
              <p class="text-xs font-bold text-gray-800">
                {{ t('admin.quotes.deleteModal.willDelete', { n: deletableItems.length }) }}
              </p>
              <ul class="mt-2 space-y-1 text-sm text-gray-800">
                <li v-for="it in deletableItems" :key="it.projectId" class="flex items-center gap-2">
                  <span class="text-gray-300">•</span>
                  <span class="truncate">
                    {{ it.projectName }}
                    <span class="font-mono text-xs text-gray-400">#{{ it.projectId }}</span>
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

            <!-- 주문 연결(1:N) — 미선택 형제 견적 경고 -->
            <div
              v-for="g in preview.orderGroups"
              :key="g.odId"
              class="mt-3 rounded-xl border border-gray-200 p-4 text-xs"
            >
              <p class="font-bold text-gray-800">
                주문 연결 · {{ g.odId }}
                <span class="font-normal text-gray-500">
                  ({{ g.odStatus }} · {{ formatKrw(g.receiptPrice) }})
                </span>
              </p>
              <p v-if="g.selectedCount > 1" class="mt-1 text-gray-600">
                이 주문에 선택된 견적 {{ g.selectedCount }}건
              </p>
              <div v-if="g.unselectedSiblings.length > 0" class="mt-1">
                <p class="font-semibold text-red-700">
                  같은 주문의 선택되지 않은 견적이 함께 영향받습니다
                </p>
                <ul class="ml-4 list-disc text-red-700">
                  <li v-for="(name, i) in g.unselectedSiblings" :key="i">{{ name }}</li>
                </ul>
              </div>
            </div>

            <ul
              v-if="summaryWarnings.length > 0"
              class="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800"
            >
              <li v-for="w in summaryWarnings" :key="w">⚠ {{ ADMIN_DELETE_WARNING_TEXT[w] }}</li>
            </ul>

            <p v-if="preview.notFound.length > 0" class="mt-3 text-xs text-gray-400">
              {{ t('admin.quotes.deleteModal.notFound', { n: preview.notFound.length }) }}
            </p>
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            @click="onClose"
          >
            {{ t('admin.quotes.deleteModal.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canContinue"
            :title="canContinue ? '' : '삭제할 수 있는 건이 없습니다 — 차단 사유를 먼저 정리하세요'"
            @click="step = 'confirm'"
          >
            영구 삭제 계속 ({{ deletableItems.length }}건)
          </button>
        </footer>
      </section>

      <!-- 2차 레이어: 강제 해제 + 사유 + 복구 불가 최종 확인 -->
      <section
        v-else-if="preview !== null"
        class="relative max-h-[90vh] w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quote-delete-confirm-title"
      >
        <header class="border-b border-red-200 bg-red-700 px-6 py-4 text-white">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-100">
            2차 경고 · 최종 확인
          </p>
          <h2 id="quote-delete-confirm-title" class="mt-1 text-lg font-extrabold">
            되돌릴 수 없는 영구 삭제입니다
          </h2>
        </header>

        <div class="max-h-[68vh] space-y-4 overflow-y-auto px-6 py-5">
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p class="font-bold">견적 {{ deletableItems.length }}건을 삭제합니다</p>
            <p class="mt-2 text-xs leading-5">
              거버 원본·협력사 견적요청·발주서·선적과 그 첨부가 함께 사라지며 복원할 수 없습니다.
              삭제 기록(사유·처리자)은 감사 원장에 남습니다.
            </p>
          </div>

          <label
            v-if="paidForceAvailable"
            class="flex cursor-pointer gap-3 rounded-xl border-2 border-red-500 bg-red-50 p-4"
          >
            <input
              v-model="forceDeletePaidOrder"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="backToImpact"
            >
            <span>
              <b class="text-sm text-red-900">
                결제 이력·주문까지 강제 삭제 ({{ preview.summary.forceableCount }}건)
              </b>
              <span class="mt-1 block text-xs font-semibold leading-5 text-red-700">
                영카트 주문과 장바구니 행을 함께 삭제합니다. 외부 결제사 승인 취소·환불은 별도로
                처리해야 합니다.
              </span>
            </span>
          </label>

          <label class="block text-xs font-semibold text-gray-700">
            삭제 사유 <span class="text-red-600">필수</span>
            <textarea
              v-model="reason"
              rows="3"
              maxlength="1000"
              class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              placeholder="중복 등록, 잘못 생성된 견적 등"
            />
          </label>

          <label
            class="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            <input v-model="acknowledged" type="checkbox" class="mt-0.5 size-4 accent-red-700">
            <span>
              외부 메일·협력사 작업은 회수되지 않으며 삭제 데이터는 복구할 수 없음을 확인했습니다.
            </span>
          </label>

          <p v-if="errorMessage !== null" class="text-sm font-semibold text-red-600">
            {{ errorMessage }}
          </p>
        </div>

        <footer class="flex justify-between border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            :disabled="deleting"
            @click="backToImpact"
          >
            이전
          </button>
          <button
            type="button"
            class="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
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
      </section>
    </div>
  </Teleport>
</template>
