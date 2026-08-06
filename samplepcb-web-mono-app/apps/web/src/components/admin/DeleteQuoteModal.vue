<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import {
  ADMIN_DELETE_BLOCK_TEXT,
  ADMIN_DELETE_WARNING_TEXT,
  type AdminDeletePreviewItemType,
} from '@sp/api-contract';
import { useDeletePreview, useDeleteQuotes } from '../../admin/useAdminQuotes';
import { formatKrw } from '../../lib/format';

// 견적 완전삭제 — 단건/다중 공통(ids 1개 = 단건). 견적 관리와 PCB(진행현황·Case 상세)가
// 같은 모달을 쓴다(창구는 여럿, 판정·화면은 하나).
//
// 위험 레이어는 SmartBOM Case 삭제와 같은 3단 구성이다:
//   ① impact  — 서버가 계산한 삭제 영향과 차단 사유를 건별로 확인
//   ② confirm — 강제 해제·감사 생략·사유·복구 불가 최종 확인
//   ③ result  — 삭제/차단/실패를 한 화면에서 정직하게 보고
// 차단(blocker)은 서버 판정이 정본이지만 **전부 우회할 수 있다**(관리자 결정 2026-08-06).
// 그래서 이 화면의 일은 막는 게 아니라 무엇을 각오하는지 끝까지 보여주는 것이다 —
// 차단 사유는 건별로 하나도 빠짐없이 나열하고, 특히 SHARED_ORDER 는 선택하지 않은
// 형제 견적의 주문까지 지운다는 사실을 강제 체크 옆에 붙인다.
const props = defineProps<{ ids: number[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

type Step = 'impact' | 'confirm' | 'result';
const step = ref<Step>('impact');
const reason = ref('');
const forceDeleteAll = ref(false);
const skipAudit = ref(false);
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

// 강제 해제를 켜면 차단된 건이 **전부** 삭제 대상으로 옮겨온다 — 서버 판정과 같은 규칙.
const items = computed<AdminDeletePreviewItemType[]>(() => preview.value?.items ?? []);
const blockedItems = computed(() => items.value.filter((i) => !i.deletable));
/** 이번 실행에서 실제로 지워질 건(강제 체크 반영). */
const targetItems = computed(() =>
  items.value.filter((i) => i.deletable || forceDeleteAll.value),
);
/** 강제 체크 시 형제 견적의 주문까지 지워지는지 — 체크 옆에 붙일 최상위 경고. */
const sharedOrderItems = computed(() =>
  items.value.filter((i) => i.blockReasons.includes('SHARED_ORDER')),
);

// 1차 레이어의 합산은 **선택분 전체** 기준이다 — 강제 체크는 2차에 있으므로, 여기서
// 삭제 가능분만 세면 "강제하면 무엇이 더 사라지는지"가 감춰진다.
const impact = computed(() => {
  const t0 = { files: 0, rfqs: 0, pos: 0, shipments: 0, attachments: 0, orders: 0, carts: 0 };
  for (const i of items.value) {
    t0.files += i.fileCount;
    t0.rfqs += i.pcb.rfqs;
    t0.pos += i.pcb.pos;
    t0.shipments += i.pcb.shipments;
    t0.attachments += i.pcb.attachments;
    if (i.deletesOrder || i.odId !== null) t0.orders += 1;
    if (i.removesCartRow) t0.carts += 1;
  }
  return t0;
});
const summaryWarnings = computed(() => preview.value?.summary.warnings ?? []);

const canContinue = computed(() => !previewLoading.value && items.value.length > 0);
const canSubmit = computed(() => targetItems.value.length > 0 && acknowledged.value);

const badgeOf = (item: AdminDeletePreviewItemType): { label: string; cls: string } =>
  item.deletable
    ? { label: t('admin.quotes.deleteModal.badgeDeletable'), cls: 'bg-emerald-100 text-emerald-700' }
    : { label: t('admin.quotes.deleteModal.badgeForceable'), cls: 'bg-orange-100 text-orange-800' };
const cardCls = (item: AdminDeletePreviewItemType): string =>
  item.deletable ? 'border-gray-200' : 'border-orange-300 bg-orange-50/60';

const errorMessage = computed<string>(() => {
  const err = deleteError.value;
  if (err === null) return '';
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.quotes.error.${code}`)) {
      return t(`admin.quotes.error.${code}`);
    }
    return err.payload?.message ?? t('admin.quotes.error.UNKNOWN');
  }
  return t('admin.quotes.error.UNKNOWN');
});

function openConfirm(): void {
  if (!canContinue.value) return;
  step.value = 'confirm';
}
function backToImpact(): void {
  if (deleting.value) return;
  step.value = 'impact';
  forceDeleteAll.value = false;
  skipAudit.value = false;
  reason.value = '';
  acknowledged.value = false;
}
function submitDelete(): void {
  if (!canSubmit.value) return;
  runDelete(
    {
      ids: props.ids,
      reason: reason.value.trim(),
      ...(forceDeleteAll.value ? { forceDeleteAll: true } : {}),
      ...(skipAudit.value ? { skipAudit: true } : {}),
    },
    { onSuccess: () => (step.value = 'result') },
  );
}
function close(): void {
  if (deleting.value) return;
  if (deleteResult.value !== null) emit('deleted');
  else emit('close');
}

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') close();
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
      <div class="absolute inset-0 bg-black/45" @click="close" />

      <!-- ① 1차 레이어 — 서버가 계산한 삭제 영향과 차단 사유 -->
      <section
        v-if="step === 'impact'"
        class="relative max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quote-delete-impact-title"
      >
        <header class="border-b border-red-100 bg-red-50 px-6 py-4">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-500">
            {{ t('admin.quotes.deleteModal.step1Over') }}
          </p>
          <h2 id="quote-delete-impact-title" class="mt-1 text-lg font-extrabold text-red-800">
            {{ t('admin.quotes.deleteModal.step1Title', { n: ids.length }) }}
          </h2>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-6 py-5">
          <p v-if="previewLoading" class="py-14 text-center text-sm text-gray-400">
            {{ t('admin.quotes.deleteModal.loading') }}
          </p>
          <div
            v-else-if="previewFailed || preview === null"
            class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {{ t('admin.quotes.error.UNKNOWN') }}
          </div>
          <template v-else>
            <!-- 통계 3칸 — 차단은 전부 강제 가능하므로 '보호됨' 칸은 없다 -->
            <div class="grid grid-cols-3 gap-2">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
                <p class="text-[11px] text-gray-500">{{ t('admin.quotes.deleteModal.statSelected') }}</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-gray-900">{{ ids.length }}</p>
              </div>
              <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p class="text-[11px] text-emerald-700">{{ t('admin.quotes.deleteModal.statDeletable') }}</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-emerald-800">
                  {{ preview.summary.deletableCount }}
                </p>
              </div>
              <div class="rounded-xl border border-orange-300 bg-orange-50 p-3 text-center">
                <p class="text-[11px] text-orange-700">{{ t('admin.quotes.deleteModal.statForceable') }}</p>
                <p class="mt-1 text-xl font-extrabold tabular-nums text-orange-800">
                  {{ blockedItems.length }}
                </p>
              </div>
            </div>

            <!-- 합산 영향 -->
            <div v-if="items.length > 0" class="mt-4 rounded-xl border border-red-200 p-4">
              <p class="text-sm font-extrabold text-red-800">
                {{ t('admin.quotes.deleteModal.impactTitle', { n: items.length }) }}
              </p>
              <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">{{ t('admin.quotes.deleteModal.impactFiles') }}</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.files }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">{{ t('admin.quotes.deleteModal.impactPartner') }}</p>
                  <p class="mt-1 font-bold tabular-nums">
                    {{ impact.rfqs }} · {{ impact.pos }} · {{ impact.shipments }}
                  </p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">{{ t('admin.quotes.deleteModal.impactAttach') }}</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.attachments }}</p>
                </div>
                <div class="rounded-lg bg-gray-50 p-3">
                  <p class="text-gray-500">{{ t('admin.quotes.deleteModal.impactOrder') }}</p>
                  <p class="mt-1 font-bold tabular-nums">{{ impact.orders }} · {{ impact.carts }}</p>
                </div>
              </div>
            </div>

            <!-- 건별 카드 -->
            <div class="mt-4 space-y-2">
              <div
                v-for="it in items"
                :key="it.projectId"
                class="rounded-xl border p-3"
                :class="cardCls(it)"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-mono text-[11px] font-bold text-gray-500">
                      Q{{ it.projectId }}
                      <span
                        v-if="it.isLegacy"
                        class="ml-1 rounded bg-gray-200 px-1 font-sans text-[10px] text-gray-600"
                      >
                        {{ t('admin.quotes.deleteModal.tagLegacy') }}
                      </span>
                    </p>
                    <p class="truncate text-sm font-bold text-gray-900">{{ it.projectName }}</p>
                    <p class="mt-0.5 text-[11px] text-gray-500">
                      <template v-if="it.odId !== null">
                        {{ t('admin.quotes.deleteModal.orderTitle') }} {{ it.odId }} ({{ it.odStatus }})
                      </template>
                      <template v-else-if="it.cartState === 'cart'">
                        {{ t('admin.quotes.deleteModal.tagCart') }}
                      </template>
                      <template v-else>—</template>
                    </p>
                  </div>
                  <span class="rounded-full px-2.5 py-1 text-[11px] font-extrabold" :class="badgeOf(it).cls">
                    {{ badgeOf(it).label }}
                  </span>
                </div>
                <p class="mt-2 text-[11px] text-gray-500">
                  {{ t('admin.quotes.deleteModal.totalFiles', { n: it.fileCount }) }} ·
                  RFQ {{ it.pcb.rfqs }} · 발주 {{ it.pcb.pos }} · 선적 {{ it.pcb.shipments }}
                </p>
                <!-- 차단 사유는 전부 — 강제 삭제로 넘길 수 있는 만큼 대가를 다 보여준다 -->
                <ul v-if="it.blockReasons.length > 0" class="mt-2 space-y-1 text-xs leading-5 text-orange-800">
                  <li v-for="code in it.blockReasons" :key="code">
                    • {{ ADMIN_DELETE_BLOCK_TEXT[code] }}
                  </li>
                </ul>
              </div>
            </div>

            <!-- 주문 그룹(1:N) — 선택 안 된 형제 견적 경고 -->
            <div
              v-for="g in preview.orderGroups"
              :key="g.odId"
              class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs"
            >
              <p class="font-bold text-amber-800">
                {{ t('admin.quotes.deleteModal.orderTitle') }} #{{ g.odId }}
                <span class="font-normal text-amber-600">
                  ({{ g.odStatus }} · {{ formatKrw(g.receiptPrice) }})
                </span>
              </p>
              <p v-if="g.selectedCount > 1" class="mt-1 text-amber-900">
                {{ t('admin.quotes.deleteModal.orderSelected', { n: g.selectedCount }) }}
              </p>
              <div v-if="g.unselectedSiblings.length > 0" class="mt-1">
                <p class="font-semibold text-red-700">
                  {{ t('admin.quotes.deleteModal.siblingsWarn') }}
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

            <p v-if="blockedItems.length > 0" class="mt-3 text-xs font-semibold text-orange-800">
              {{ t('admin.quotes.deleteModal.blockedForceable', { n: blockedItems.length }) }}
            </p>
            <p v-if="preview.notFound.length > 0" class="mt-2 text-xs text-gray-400">
              {{ t('admin.quotes.deleteModal.notFound', { n: preview.notFound.length }) }}
            </p>
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            @click="close"
          >
            {{ t('admin.quotes.deleteModal.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canContinue"
            @click="openConfirm"
          >
            {{
              items.length === 0
                ? t('admin.quotes.deleteModal.continueNone')
                : t('admin.quotes.deleteModal.continueN', { n: items.length })
            }}
          </button>
        </footer>
      </section>

      <!-- ② 2차 레이어 — 강제 해제·사유·복구 불가 최종 확인 -->
      <section
        v-else-if="step === 'confirm' && preview !== null"
        class="relative max-h-[92vh] w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quote-delete-confirm-title"
      >
        <header class="border-b border-red-200 bg-red-700 px-6 py-4 text-white">
          <p class="text-[11px] font-bold uppercase tracking-wider text-red-100">
            {{ t('admin.quotes.deleteModal.step2Over') }}
          </p>
          <h2 id="quote-delete-confirm-title" class="mt-1 text-lg font-extrabold">
            {{ t('admin.quotes.deleteModal.step2Title') }}
          </h2>
        </header>

        <div class="max-h-[68vh] space-y-4 overflow-y-auto px-6 py-5">
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p class="font-extrabold">
              {{ t('admin.quotes.deleteModal.confirmN', { n: targetItems.length }) }}
            </p>
            <ul class="mt-2 space-y-0.5 text-xs leading-5">
              <li v-for="it in targetItems" :key="it.projectId" class="truncate">
                <span class="font-mono">Q{{ it.projectId }}</span> {{ it.projectName }}
              </li>
            </ul>
          </div>

          <!-- 강제 해제 — 차단 전부를 넘긴다. 넘기는 대가를 사유별로 나열한다. -->
          <label
            v-if="blockedItems.length > 0"
            class="flex cursor-pointer gap-3 rounded-xl border-2 border-red-500 bg-red-50 p-4"
          >
            <input
              v-model="forceDeleteAll"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="acknowledged = false"
            >
            <span>
              <b class="text-sm text-red-900">
                {{ t('admin.quotes.deleteModal.forceLabel', { n: blockedItems.length }) }}
              </b>
              <span class="mt-1 block text-xs font-semibold leading-5 text-red-700">
                {{ t('admin.quotes.deleteModal.forceDesc') }}
              </span>
              <ul class="mt-2 space-y-0.5 text-[11px] leading-5 text-red-800">
                <li v-for="code in preview.summary.blockReasons" :key="code">
                  • {{ ADMIN_DELETE_BLOCK_TEXT[code] }}
                </li>
              </ul>
              <!-- 남의 견적까지 지우는 유일한 사유라 따로 못 박는다 -->
              <span
                v-if="sharedOrderItems.length > 0"
                class="mt-2 block rounded-lg bg-red-700 px-3 py-2 text-[11px] font-extrabold leading-5 text-white"
              >
                {{ t('admin.quotes.deleteModal.forceSharedWarn', { n: sharedOrderItems.length }) }}
              </span>
            </span>
          </label>

          <!-- 감사기록 생략 — SmartBOM reset 모드와 같은 선택 -->
          <label class="flex cursor-pointer gap-3 rounded-xl border-2 border-red-300 bg-red-50/70 p-4">
            <input
              v-model="skipAudit"
              type="checkbox"
              class="mt-0.5 size-4 accent-red-700"
              @change="acknowledged = false"
            >
            <span>
              <b class="text-sm text-red-800">{{ t('admin.quotes.deleteModal.skipAuditLabel') }}</b>
              <span class="mt-1 block text-xs font-semibold leading-5 text-red-700">
                {{ t('admin.quotes.deleteModal.skipAuditDesc') }}
              </span>
            </span>
          </label>

          <label v-if="!skipAudit" class="block text-xs font-semibold text-gray-700">
            {{ t('admin.quotes.deleteModal.reasonLabel') }}
            <span class="text-gray-400">{{ t('admin.quotes.deleteModal.optional') }}</span>
            <textarea
              v-model="reason"
              rows="3"
              maxlength="1000"
              class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              :placeholder="t('admin.quotes.deleteModal.reasonPlaceholder')"
            />
          </label>

          <label
            class="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          >
            <input v-model="acknowledged" type="checkbox" class="mt-0.5 size-4 accent-red-700">
            <span>{{ t('admin.quotes.deleteModal.ackLabel') }}</span>
          </label>

          <p v-if="errorMessage !== ''" class="text-sm font-semibold text-red-600">
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
            {{ t('admin.quotes.deleteModal.back') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-red-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSubmit || deleting"
            @click="submitDelete"
          >
            {{
              deleting
                ? t('admin.quotes.deleteModal.deleting')
                : t('admin.quotes.deleteModal.confirmN', { n: targetItems.length })
            }}
          </button>
        </footer>
      </section>

      <!-- ③ 결과 — 삭제·차단·실패를 한 화면에서 -->
      <section
        v-else-if="step === 'result' && deleteResult !== null"
        class="relative max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-delete-result-title"
      >
        <div class="max-h-[75vh] overflow-y-auto p-6">
          <p class="text-xs font-bold uppercase tracking-wider text-emerald-600">
            {{ t('admin.quotes.deleteModal.resultOver') }}
          </p>
          <h2 id="quote-delete-result-title" class="mt-1 text-lg font-extrabold text-gray-900">
            {{
              t('admin.quotes.deleteModal.resultTitle', {
                deleted: deleteResult.summary.deleted,
                kept: ids.length - deleteResult.summary.deleted,
              })
            }}
          </h2>

          <div
            v-if="deleteResult.summary.deleted > 0"
            class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          >
            <p class="font-extrabold">
              {{ t('admin.quotes.deleteModal.confirmN', { n: deleteResult.summary.deleted }) }}
            </p>
            <p class="mt-2 text-xs leading-5">
              {{
                skipAudit
                  ? t('admin.quotes.deleteModal.resultAuditSkipped')
                  : t('admin.quotes.deleteModal.resultAudit')
              }}
            </p>
          </div>

          <div
            v-if="deleteResult.summary.blocked > 0 || deleteResult.summary.failed > 0"
            class="mt-3 rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <p class="text-sm font-extrabold text-red-800">
              {{
                t('admin.quotes.deleteModal.resultSummary', {
                  deleted: deleteResult.summary.deleted,
                  blocked: deleteResult.summary.blocked,
                  failed: deleteResult.summary.failed,
                })
              }}
            </p>
            <ul class="mt-2 space-y-1 text-xs leading-5 text-red-700">
              <li
                v-for="r in deleteResult.results.filter((x) => x.outcome !== 'deleted')"
                :key="r.projectId"
              >
                <b class="font-mono">Q{{ r.projectId }}</b> —
                {{ r.blockReason === null ? '실패' : ADMIN_DELETE_BLOCK_TEXT[r.blockReason] }}
              </li>
            </ul>
          </div>
        </div>
        <footer class="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black"
            @click="close"
          >
            {{ t('admin.quotes.deleteModal.toList') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
